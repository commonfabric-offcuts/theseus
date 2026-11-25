from __future__ import annotations

import copy
import json
import sqlite3
import unittest
from unittest import mock

import reader_fixture


COMMIT = "a" * 40


def payload(**changes):
    value = {"release": 9, "commit": COMMIT, "attempt_id": "attempt-1",
             "state": "going_out", "title": "One Release card",
             "forecasts": {"push_at": "2026-11-25T16:00:00-08:00", "live_at": "2026-11-25T16:45:00-08:00"},
             "summary": "Source is fixed", "evidence": []}
    value.update(changes)
    return value


class ReleaseCardsCase(reader_fixture.ReaderCase):
    def create(self, value=None, actor="owner", op=None):
        return self.command("release_card.create", {"payload": value or payload(), "divergence_reason": "A distinct synthetic release"},
                            target={"topic_id": "t1"}, actor=actor, op=op)

    def card(self, value=None, actor="owner"):
        return self.committed(self.create(value, actor, op="card-create"))["message_id"]

    def update(self, mid, value, revision=1, actor="owner", op=None):
        return self.command("release_card.update", {"payload": value}, target={"message_id": mid},
                            expected={"message_revision": revision}, actor=actor, op=op)

    def read(self, mid, actor="owner", **args):
        answer = self.store.view(actor, "release_card", dict(args, message_id=mid))
        self.assertNotIn("error", answer, answer)
        return answer["release_card"]

    def live(self, commit=COMMIT):
        return self.store.record_release({"release": 9, "commit": commit, "items": [],
                                         "deployed_at": "2026-11-25T13:19:23.456789-08:00", "source": "deploy"})

    def test_one_identity_and_atomic_matching_revisions_keep_original_forecasts(self):
        mid = self.card()
        first = self.source({"kind": "message", "id": mid})
        original = self.sql("SELECT * FROM messages WHERE id=?", (mid,))
        changed = payload(forecasts={"push_at": None, "live_at": "2026-11-25T17:30:00-08:00"})
        self.committed(self.update(mid, changed))
        now = self.read(mid)
        self.assertEqual((now["message_id"], now["revision"], now["format"]), (mid, 2, "release-card-v1"))
        self.assertEqual(now["payload"]["forecasts"], changed["forecasts"])
        self.assertEqual(now["original_forecasts"], payload()["forecasts"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "card-create"})["result"]["release_card"]["payload"], first["release_card"]["payload"])
        self.assertEqual(self.sql("SELECT * FROM messages WHERE id=?", (mid,)), original)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'release_card.v1:%'"), [(2,)])
        self.assertEqual(self.sql("SELECT revision FROM message_revisions WHERE message_id=?", (mid,)), [(2,)])

    def test_named_message_source_and_number_lookup_have_the_same_typed_state(self):
        mid = self.card()
        current = self.read(mid)
        by_number = self.store.view("agent-b", "release_card", {"workspace_id": "w1", "release": 9})
        page = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [mid]})
        self.assertEqual(by_number["release_card"], current)
        self.assertEqual(page["items"][0]["release_card"], current)
        self.assertEqual(self.source({"kind": "message", "id": mid}, "agent-b")["release_card"], current)
        self.assertIn("Going out", self.source({"kind": "message", "id": mid})["body"])
        self.assertNotIn("release_card", self.source({"kind": "message", "id": self.opening["id"]}))

    def test_retry_reuses_original_identity_across_store_reopen_and_changed_payload_refuses(self):
        first = self.create(op="create-once")
        from aim_next import Store
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.create(op="create-once"), first)
        self.rejected(self.create(payload(summary="different"), op="create-once"), "OPERATION_PAYLOAD_MISMATCH")
        mid = self.committed(first)["message_id"]
        update = self.update(mid, payload(summary="Next"), op="update-once")
        self.assertEqual(self.update(mid, payload(summary="Next"), op="update-once"), update)
        self.assertEqual(self.read(mid)["revision"], 2)
        self.rejected(self.create(), "RELEASE_CARD_EXISTS")

    def test_only_writer_updates_and_access_revocation_does_not_leak_card(self):
        mid = self.card(actor="agent-a")
        self.rejected(self.update(mid, payload(summary="wrong writer"), actor="owner"), "FORBIDDEN")
        self.rejected(self.create(actor="outsider"), "FORBIDDEN")
        for view, args in (("release_card", {"message_id": mid}), 
                           ("release_card", {"workspace_id": "w1", "release": 9})):
            answer = self.store.view("outsider", view, args)
            self.assertIn("error", answer)
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-b'")
        self.assertIn("error", self.store.view("agent-b", "release_card", {"message_id": mid}))

    def test_false_live_and_wrong_release_commit_refuse_without_partial_revision(self):
        mid = self.card()
        self.rejected(self.update(mid, payload(state="live")), "RELEASE_NOT_VERIFIED")
        self.assertEqual(self.read(mid)["revision"], 1)
        self.live(commit="b" * 40)
        self.rejected(self.update(mid, payload(state="live")), "RELEASE_SOURCE_MISMATCH")
        self.assertEqual(self.sql("SELECT count(*) FROM message_revisions WHERE message_id=?", (mid,)), [(0,)])

    def test_live_time_is_canonical_and_measured_failure_does_not_undo_live(self):
        mid = self.card()
        record = self.live()["release"]
        self.committed(self.update(mid, payload(state="live")))
        now = self.read(mid)
        self.assertEqual((now["deployed_at"], now["deployed_ms"]), (record["deployed_at"], record["deployed_ms"]))
        self.committed(self.update(mid, payload(state="measured", summary="3 failed checks retained", evidence=["https://example.test/results"]), 2))
        self.assertEqual(self.read(mid)["payload"]["state"], "measured")
        self.assertIn("3 failed checks", self.source({"kind": "message", "id": mid})["body"])
        self.rejected(self.update(mid, payload(state="unknown"), 3), "RELEASE_STATE_REGRESSION")
        self.rejected(self.update(mid, payload(state="live", attempt_id="replacement"), 3), "RELEASE_STATE_REGRESSION")

    def test_failed_and_unknown_attempts_remain_in_history_when_retry_goes_live(self):
        mid = self.card(payload(state="failed", summary="Original failure"))
        self.committed(self.update(mid, payload(state="unknown", summary="Transport result unknown")))
        self.committed(self.update(mid, payload(attempt_id="retry", summary="Retry planned"), 2))
        self.live()
        self.committed(self.update(mid, payload(state="live", attempt_id="retry"), 3))
        states = [__import__('json').loads(row[0])["result"]["release_card"]["payload"]["state"] for row in self.sql("SELECT outcome FROM operations WHERE kind IN ('release_card.create','release_card.update') ORDER BY rowid")]
        self.assertEqual(states, ["failed", "unknown", "going_out", "live"])

    def test_stale_revision_and_plain_edit_cannot_desynchronise_payload_and_words(self):
        mid = self.card()
        self.committed(self.update(mid, payload(summary="new")))
        self.rejected(self.update(mid, payload(summary="stale")), "REVISION_CONFLICT")
        self.rejected(self.command("message.edit", {"body": "Fake Live"}, target={"message_id": mid}, expected={"message_revision": 2}), "TYPED_CARD_UPDATE_REQUIRED")
        self.rejected(self.command("message.edit_open", {"holder": "editor"}, target={"message_id": mid}), "TYPED_CARD_UPDATE_REQUIRED")
        self.assertEqual(self.read(mid)["payload"]["summary"], "new")

    def test_append_failure_rolls_back_message_and_typed_mutation_together(self):
        mid = self.card()
        before = self.source({"kind": "message", "id": mid})
        from aim_next import release_cards
        from aim_next.contract import Refusal
        with mock.patch.object(release_cards, "append_revision", side_effect=Refusal("INJECTED", "Applied append fault")):
            self.rejected(self.update(mid, payload(summary="must roll back")), "INJECTED")
        self.assertEqual(self.source({"kind": "message", "id": mid}), before)
        self.committed(self.update(mid, payload(summary="restored")))
        self.assertEqual(self.read(mid)["revision"], 2)


    def test_payload_validation_rejects_invented_fields_invalid_source_links_and_unbounded_data(self):
        bad = [payload(release=True), payload(commit="abc"), payload(state="done"), payload(title=""),
               payload(evidence=["javascript:alert(1)"]), payload(summary="x" * 2049),
               payload(forecasts={"live_at": "tomorrow"}), payload(deployed_ms=123),
               payload(state="measured"), payload(evidence=["https://example.test/" + "x" * 2050])]
        for value in bad:
            with self.subTest(value=list(value)):
                self.rejected(self.create(value), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'release_card.v1:%'"), [(0,)])

    def test_removal_and_closed_outcome_preserve_data_but_refuse_new_updates(self):
        mid = self.card()
        self.sql("INSERT INTO outcome_ends(workspace_id,seq,state,topics,set_by,set_ms) VALUES ('w1',1,'completed','[]','owner',1)")
        self.rejected(self.update(mid, payload(summary="closed")), "OUTCOME_COMPLETED")
        self.assertEqual(self.read(mid)["revision"], 1)

    def test_revision_rows_are_immutable_and_no_update_changes_unrelated_message(self):
        mid = self.card()
        other = self.source({"kind": "message", "id": self.opening["id"]})
        self.committed(self.update(mid, payload(summary="changed")))
        self.assertEqual(self.source({"kind": "message", "id": self.opening["id"]}), other)
        for sql in ("UPDATE operations SET outcome='{}'", "DELETE FROM operations", "DELETE FROM messages"):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.sql(sql)


if __name__ == "__main__":
    unittest.main()

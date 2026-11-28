from __future__ import annotations

import json
from unittest.mock import patch

from aim_next.message_edit import EDIT_ECHO_UP
from aim_next.migrations import MigrationError, STEPS, migrate
from aim_next.store import Store
from test_conversation import ConversationCase


BEFORE, AFTER, *_ = next(step for step in STEPS if step[2] is EDIT_ECHO_UP)


class EditEchoCase(ConversationCase):
    def edit(self, mid, body, revision=1, actor="agent-a", at=1000, op=None):
        with patch("aim_next.delivery._now_ms", return_value=at):
            return self.command("message.edit", {"body": body}, target={"message_id": mid},
                                expected={"message_revision": revision}, actor=actor, op=op)

    def echo(self, mid, actor="owner", **fields):
        return self.source({"kind": "message", "id": mid, **fields}, actor).get("edit_echo")

    def test_edit_groups_and_retries_keep_immutable_revision_anchors(self):
        mid = self.posted("The meeting is on Friday.", actor="agent-a", topic="t1")
        self.committed(self.edit(mid, "The meeting is on Monday."))
        self.committed(self.edit(mid, "the meeting is on Monday.", revision=2, at=1500))
        self.assertEqual(self.echo(mid)["revision"], 2)
        changed = "The meeting is on Tuesday, in Room 12."
        first = self.edit(mid, changed, revision=3, at=1800, op="edit-tuesday")
        self.committed(first)
        self.assertEqual(self.edit(mid, changed, revision=3, at=1900, op="edit-tuesday"), first)
        self.rejected(self.edit(mid, "Stale changes.", revision=3), "REVISION_CONFLICT")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        grouped = self.echo(mid, "agent-a")
        self.assertEqual((grouped["revision"], grouped["group_revision"]), (4, 2))
        self.assertIn("Tuesday", grouped["summary"])
        self.assertEqual(grouped["diff"]["from_revision"], 1)
        self.assertTrue(grouped["diff"]["cuts"])
        self.committed(self.edit(mid, "The meeting is cancelled.", revision=4, at=122000))
        self.assertEqual(self.echo(mid)["group_revision"], 5)
        old = self.echo(mid, "agent-a", edit_echo_revision=4)
        self.assertEqual((old["revision"], old["group_revision"]), (4, 2))
        self.assertNotIn("cancelled", old["summary"])
        self.assertIsNone(self.echo(mid, "owner", edit_echo_revision=4))
        saved = self.sql("SELECT revision,edit_echo FROM message_revisions WHERE message_id=? ORDER BY revision", (mid,))
        self.assertEqual([number for number, _ in saved], [2, 3, 4, 5])
        self.assertIsNone(saved[1][1])
        self.assertEqual(json.loads(saved[2][1])["group_revision"], 2)

    def test_reversal_creates_a_new_group_with_a_useful_diff(self):
        mid = self.posted("Original route uses Oak Street.", actor="agent-a", topic="t1")
        self.committed(self.edit(mid, "The new route uses King Street."))
        self.committed(self.edit(mid, "Original route uses Oak Street.", revision=2, at=1500))
        echo = self.echo(mid, "agent-a")
        self.assertEqual(echo["group_revision"], 3)
        self.assertEqual(echo["diff"]["from_revision"], 2)
        self.assertIn("Oak", echo["summary"])
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "message_ids": [mid]})
        summary = page["items"][0]["edit_echo"]
        self.assertEqual(summary, {key: value for key, value in echo.items() if key != "diff"})

    def test_topic_summaries_include_older_groups_without_exposing_their_words(self):
        mid = self.posted("Initial schedule.", actor="agent-a", topic="t1")
        self.committed(self.edit(mid, "The press room is Maple."))
        self.committed(self.edit(mid, "The press room is Cedar.", revision=2, at=1500))
        self.committed(self.edit(mid, "The press room is Pine.", revision=3, at=122000))
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "message_ids": [mid]})
        item = page["items"][0]
        self.assertEqual(item["edit_echo"]["group_revision"], 4)
        self.assertIn("Pine", item["edit_echo"]["summary"])
        self.assertEqual(item["previous_edit_echoes"], [{
            "group_revision": 2, "revision": 3, "edited_ms": 1500, "summary": "Revised wording",
        }])
        self.assertNotIn("Cedar", str(item["previous_edit_echoes"]))

    def test_named_echo_keeps_its_own_added_words_when_the_current_body_is_shorter(self):
        mid = self.posted("Alpha.", actor="agent-a", topic="t1")
        historical = "A much longer replacement sentence."
        self.committed(self.edit(mid, historical))
        self.committed(self.edit(mid, "Hi.", revision=2, at=122000))
        source = self.source({"kind": "message", "id": mid, "edit_echo_revision": 2}, "agent-a")
        self.assertEqual(source["body"], "Hi.")
        diff = source["edit_echo"]["diff"]
        self.assertEqual((diff["from_revision"], diff["to_revision"]), (1, 2))
        self.assertIn(historical.rstrip("."), [entry["words"] for entry in diff["added"]])
        self.assertGreater(max(entry["end"] for entry in diff["added"]), len(source["body"]))

    def test_path_case_code_indentation_and_ambiguous_spelling_are_substantive(self):
        for prior, changed in (
            ("Use /srv/Prod.", "Use /srv/prod."),
            ("```py\nif flag:\n    cleanup()\n```", "```py\nif flag:\ncleanup()\n```"),
            ("Take the trial.", "Take the trail."),
        ):
            with self.subTest(prior=prior):
                mid = self.posted(prior, actor="agent-a", topic="t1")
                self.committed(self.edit(mid, changed))
                self.assertIsNotNone(self.echo(mid))

    def test_mechanical_changes_have_no_echo_and_numeric_changes_do(self):
        mid = self.posted("Teh address is Suite 9.", actor="agent-a", topic="t1")
        self.committed(self.edit(mid, "The address is Suite 9."))
        self.assertIsNone(self.echo(mid))
        self.committed(self.edit(mid, "The address is Suite 8.", revision=2))
        self.assertEqual(self.echo(mid)["group_revision"], 3)

    def test_source_and_topic_echoes_obey_whisper_hold_and_previous_word_access(self):
        self.participation("agent-b", True)
        mid = self.posted("Old private words.", topic="t1", whisper=True, addressees=["agent-a"],
                          reply_to=self.opening["id"])
        self.committed(self.edit(mid, "Replacement private words.", actor="owner"))
        self.assertEqual(self.echo(mid, "agent-a")["diff"]["cuts"], [])
        self.assertTrue(self.echo(mid, "owner")["diff"]["cuts"])
        outside = self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": mid}})
        self.assertEqual(outside["error"]["code"], "FORBIDDEN")
        self.committed(self.command("message.edit_open", {"holder": "fixture-device"}, target={"message_id": mid}))
        self.assertIsNone(self.echo(mid, "agent-a"))
        page = self.store.view("agent-a", "topic_messages", {"topic_id": "t1", "message_ids": [mid]})
        self.assertIsNone(page["items"][0].get("edit_echo"))

    def test_empty_echo_step_roundtrip_and_occupied_refusal(self):
        mid = self.posted("Teh meeting is on Monday.", actor="agent-a", topic="t1")
        self.committed(self.edit(mid, "The meeting is on Monday."))
        original = self.source({"kind": "message", "id": mid}, "owner")
        self.assertIsNone(self.echo(mid))
        for target, origin in ((BEFORE, AFTER), (AFTER, BEFORE), (BEFORE, AFTER), (AFTER, BEFORE)):
            result = migrate(self.path, "test-instance", self.binding, target)
            self.assertEqual((result["from_version"], result["schema_version"]), (origin, target))
        restored = self.source({"kind": "message", "id": mid}, "owner")
        for key in ("body", "revision", "edited_ms", "struck"):
            self.assertEqual(restored[key], original[key])
        self.committed(self.edit(mid, "The meeting is on Tuesday.", revision=2))
        snapshot = self.sql("SELECT revision,body,edit_echo FROM message_revisions WHERE message_id=?", (mid,))
        with self.assertRaises(MigrationError) as error:
            migrate(self.path, "test-instance", self.binding, BEFORE)
        self.assertEqual(error.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.sql("SELECT revision,body,edit_echo FROM message_revisions WHERE message_id=?", (mid,)), snapshot)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [(AFTER,)])
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])

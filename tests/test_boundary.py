from __future__ import annotations

import sqlite3
import unittest

from test_store import StoreCase


class BoundaryCase(StoreCase):
    # Keep this subclass's suite focused; the common fixture is inherited.
    def test_malformed_commands_return_structured_attempt_or_business_refusals(self):
        envelopes = [
            {"args": {"title": "No", "team": [[]]}},
            {"args": {"title": "No", "team": [None]}},
            {"args": {"title": "No", "purpose": float("nan")}},
            {"v": True, "args": {"title": "No"}},
            {"kind": "workspace_create", "args": {"title": "No"}},
            {"args": {"title": "\ud800"}},
            {"target": None}, {"expected": []}, {"args": "not an object"},
        ]
        for i, fields in enumerate(envelopes):
            with self.subTest(fields=fields):
                envelope = {"v": 1, "instance_id": "test-instance", "operation_id": "bad-%s" % i,
                            "kind": "workspace.create", "target": {}, "expected": {}, "args": {}}
                envelope.update(fields)
                result = self.store.command("owner", envelope)
                self.assertEqual(result["status"], "rejected", result)
                self.assertIn("error", result)
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces"), [(0,)])
        self.assertEqual(self.workspace()["status"], "committed")

    def test_malformed_views_return_structured_refusals(self):
        self.workspace()
        for name, args in [(None, {}), ("workspace", None), ("workspace", {"workspace_id": []}),
                           ("workspace_topics", {"workspace_id": "w1", "cursor": 1}),
                           ("submissions", {"cursor": []}), ("operation", {"operation_id": []})]:
            with self.subTest(name=name, args=args):
                self.assertIn("error", self.store.view("owner", name, args))

    def test_invalid_ids_across_draft_and_conversation_paths_never_reach_sql_binding(self):
        source = self.create_topic()
        cases = [
            ("submission.prepare", {"draft_id": []}, {"topic_id": "t1"}),
            ("message.send", {"submission_id": []}, {"topic_id": "t1"}),
            ("participation.set", {"actor_id": "agent-a", "present": False}, {"topic_id": []}),
            ("draft.save", {"source_ref": {"kind": "new_topic", "id": "open", "workspace_id": []}, "generation": "g", "topic_id": "t2"}, {"draft_id": "d2"}),
        ]
        for kind, args, target in cases:
            with self.subTest(kind=kind):
                expected = {"topic_revision": 1} if kind == "participation.set" else ({"draft_revision": 0} if kind in ("draft.save", "submission.prepare") else {})
                result = self.command(kind, args, target, expected=expected)
                self.assertEqual(result["status"], "rejected", result)
                self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        editor = self.store.view("owner", "editor_state", {"source_ref": source, "topic_id": []})
        self.assertEqual(editor["error"]["code"], "INVALID_ARGUMENT")

    def test_normalized_envelope_retry_is_the_same_operation(self):
        payload = {"v": 1, "instance_id": "test-instance", "operation_id": "normalized", "kind": "workspace.create",
                   "args": {"id": "w1", "title": "Normalized"}}
        first = self.store.command("owner", payload)
        second = self.store.command("owner", dict(payload, target={}, expected={}))
        self.assertEqual(first, second)

    def test_workspace_create_conflicts_are_explicit_revisions(self):
        denied = self.command("workspace.create", {"id": "w1", "title": "No"}, expected={"workspace_revision": 99})
        self.assertEqual(denied["status"], "rejected", denied)
        self.assertEqual(denied["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(denied["error"]["current_versions"], {"workspace_revision": 0})
        self.workspace()
        collision = self.command("workspace.create", {"id": "w1", "title": "Changed"}, expected={"workspace_revision": 0})
        self.assertEqual(collision["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(collision["error"]["current_versions"], {"workspace_revision": 1})

    def test_workspace_team_counts_distinct_members_under_its_own_capability(self):
        cap = self.store.view("owner", "capabilities", {})["limits"]["workspace_members"]
        self.assertEqual(cap, 128)
        created = self.command("workspace.create", {"id": "w1", "title": "Repeated selection", "team": ["agent-a"] * 150})
        self.assertEqual(created["status"], "committed", created)
        self.assertEqual(self.sql("SELECT count(*) FROM workspace_members"), [(2,)])
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", [("extra-%s" % i, "extra-%s" % i) for i in range(128)])
        over = self.command("workspace.create", {"id": "w2", "title": "Over", "team": ["extra-%s" % i for i in range(128)]})
        self.assertEqual(over["error"]["code"], "TOO_MANY_WORKSPACE_MEMBERS")
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces"), [(1,)])

    def test_private_views_refuse_actor_override_against_existing_foreign_records(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "Owner secret")
        self.prepare("d1", "t1")
        cases = [("operation", {"operation_id": "open-topic"}), ("submission", {"submission_id": "s1"}),
                 ("submissions", {}), ("editor_state", {"source_ref": source, "topic_id": "t1"}), ("deliveries", {})]
        for name, args in cases:
            for key in ("actor", "owner", "actor_id", "owner_id"):
                with self.subTest(name=name, key=key):
                    result = self.store.view("agent-a", name, dict(args, **{key: "owner"}))
                    self.assertEqual(result.get("error", {}).get("code"), "INVALID_ARGUMENT", result)
        own = self.store.view("owner", "submission", {"submission_id": "s1"})
        self.assertEqual(own["body"], "Owner secret")

    def test_disable_does_not_settle_or_erase_lost_result_and_restore_reconciles(self):
        original = self.workspace()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='owner'")
        refused = self.store.view("owner", "operation", {"operation_id": original["operation_id"]})
        self.assertEqual(refused["error"]["code"], "INVALID_ACTOR")
        attempt = self.command("workspace.create", {"id": "w2", "title": "Disabled"})
        self.assertFalse(attempt["recorded"])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=1 WHERE id='owner'")
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": original["operation_id"]}), original)

    def test_unexpected_integrity_failure_is_not_a_permanent_business_outcome(self):
        original = self.store._command_workspace_create

        def broken(db, actor, envelope):
            db.execute("INSERT INTO workspace_members VALUES ('absent',?)", (actor,))
            return {}, []

        self.store._command_workspace_create = broken
        result = self.command("workspace.create", {"id": "w1", "title": "Retry"}, op="fk-defect")
        self.assertFalse(result["recorded"], result)
        self.assertEqual(result["error"]["code"], "INTERNAL_ERROR")
        self.assertFalse(result["error"]["retryable"])
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])
        self.store._command_workspace_create = original
        retried = self.command("workspace.create", {"id": "w1", "title": "Retry"}, op="fk-defect")
        self.assertEqual(retried["status"], "committed", retried)

    def test_foreign_workspace_conflict_does_not_reveal_its_version(self):
        self.command("workspace.create", {"id": "secret", "title": "Private"}, actor="agent-a")
        result = self.command("workspace.create", {"id": "secret", "title": "Collision"})
        self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")
        self.assertNotIn("current_versions", result["error"])

    def test_participant_update_requires_expected_topic_revision(self):
        self.create_topic()
        result = self.store.command("owner", {"v": 1, "instance_id": "test-instance", "operation_id": "unsafe-update",
                                  "kind": "participation.set", "target": {"topic_id": "t1"}, "expected": {},
                                  "args": {"actor_id": "agent-a", "present": False}})
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        self.assertFalse(result["recorded"])
        stale = self.command("participation.set", {"actor_id": "agent-a", "present": False},
                             target={"topic_id": "t1"}, expected={"topic_revision": 0})
        self.assertEqual(stale["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE actor_id='agent-a'"), [(1,)])

    def test_expected_private_slot_collisions_are_recorded_business_refusals(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "Existing")
        collision = self.save_draft("different-id", source, "t1", "Must not replace")
        self.assertTrue(collision["recorded"], collision)
        self.assertEqual(collision["error"]["code"], "REVISION_CONFLICT")
        self.command("note.save", {"source_ref": source, "body": "Existing note"}, target={"note_id": "n1"}, expected={"note_revision": 0})
        collision = self.command("note.save", {"source_ref": source, "body": "Other note"}, target={"note_id": "n2"}, expected={"note_revision": 0})
        self.assertTrue(collision["recorded"], collision)
        self.assertEqual(collision["error"]["code"], "REVISION_CONFLICT")

    def test_wrong_send_identity_cannot_record_a_new_outcome_for_the_frozen_act(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "A")
        self.prepare("d1", "t1")
        attempt = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="replacement-send")
        self.assertEqual(attempt["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        self.assertFalse(attempt["recorded"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "replacement-send"})["status"], "unknown")

    def test_submission_identity_collision_is_recorded_without_rotating_other_draft(self):
        self.workspace()
        for n in (1, 2):
            source = {"kind": "new_topic", "id": "opening-%s" % n, "workspace_id": "w1"}
            self.save_draft("d%s" % n, source, "t%s" % n, "Private %s" % n,
                            opening={"workspace_id": "w1", "title": "Topic", "participants": []})
        self.prepare("d1", "t1", submission="shared", send_op="send-1")
        result = self.prepare("d2", "t2", submission="shared", send_op="send-2")
        self.assertTrue(result["recorded"], result)
        self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT revision FROM drafts WHERE id='d2'"), [(1,)])

    def test_preallocated_topic_collision_is_recorded_without_publication(self):
        self.create_topic()
        source = {"kind": "new_topic", "id": "another-opening", "workspace_id": "w1"}
        self.save_draft("d2", source, "t1", "Must remain private", opening={"workspace_id": "w1", "title": "Collision", "participants": []})
        self.prepare("d2", "t1", submission="collision", send_op="collision-send")
        result = self.command("topic.create_and_send", {"submission_id": "collision"}, target={"topic_id": "t1"}, op="collision-send")
        self.assertTrue(result["recorded"], result)
        self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(1,)])


# Do not run the inherited contract tests twice in discovery.
for _name in list(StoreCase.__dict__):
    if _name.startswith("test_") and _name not in BoundaryCase.__dict__:
        setattr(BoundaryCase, _name, None)
del StoreCase


if __name__ == "__main__":
    unittest.main()

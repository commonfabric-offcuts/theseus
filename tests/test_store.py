from __future__ import annotations

import concurrent.futures
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from aim_next import Store, StoreError, initialize


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aim-next-core-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "instance.sqlite3"
        initialized = initialize(self.path, "test-instance", [
            {"id": "owner", "kind": "human"},
            {"id": "agent-a", "kind": "agent"},
            {"id": "agent-b", "kind": "agent"},
        ], authority_path=Path(self.temp.name).resolve() / "control" / "authority.json")
        self.binding = initialized["binding"]
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.serial = 0

    def command(self, kind, args=None, target=None, expected=None, actor="owner", op=None):
        self.serial += 1
        if kind == "participation.set" and expected is None and isinstance((target or {}).get("topic_id"), str):
            current = self.store.view(actor, "topic", {"topic_id": target["topic_id"]})
            if "topic" in current:
                expected = {"topic_revision": current["topic"]["version"]}
        return self.store.command(actor, {
            "v": 1, "instance_id": "test-instance", "operation_id": op or "op-%s" % self.serial,
            "kind": kind, "target": target or {}, "expected": dict(expected or {}, authority=dict(self.pin)), "args": args or {},
        })

    def workspace(self):
        receipt = self.command("workspace.create", {
            "id": "w1", "title": "Isolated test", "purpose": "Exercise one recorded act",
            "team": ["agent-a", "agent-b"], "coordinator": "agent-a",
        })
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt

    def sql(self, statement, params=()):
        with sqlite3.connect(str(self.path)) as db:
            return db.execute(statement, params).fetchall()

    def test_runtime_and_capabilities_are_actual_and_authoritative(self):
        facts = self.store.view("owner", "capabilities", {})
        self.assertEqual(facts["instance_id"], "test-instance")
        self.assertEqual(facts["limits"]["body_utf8_bytes"], 1048576)
        self.assertEqual(facts["limits"]["recipients"], 32)
        self.assertEqual(facts["limits"]["page_max"], 100)
        self.assertEqual(facts["runtime"]["journal_mode"], "delete")
        self.assertEqual(facts["runtime"]["synchronous"], 3)
        self.assertEqual(facts["runtime"]["fullfsync"], 1)
        self.assertEqual(facts["runtime"]["foreign_keys"], 1)
        self.assertEqual(facts["runtime"]["busy_timeout"], 250)

    def test_workspace_and_outcome_commit_once_across_concurrent_callers(self):
        envelope = {"v": 1, "instance_id": "test-instance", "operation_id": "once",
                    "kind": "workspace.create", "target": {}, "expected": {"authority": self.pin},
                    "args": {"id": "w1", "title": "One", "team": ["agent-a"]}}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.store.command("owner", envelope), range(2)))
        self.assertEqual(receipts[0], receipts[1])
        self.assertTrue(receipts[0]["recorded"])
        self.assertEqual(receipts[0]["status"], "committed")
        self.assertEqual(self.sql("SELECT id, owner_id FROM workspaces"), [("w1", "owner")])
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(1,)])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "once"}), receipts[0])
        topic_list = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})
        self.assertEqual(topic_list["items"], [])

    def test_changed_retry_is_attempt_error_and_cannot_replace_recorded_result(self):
        original = self.command("workspace.create", {"id": "w1", "title": "Original"}, op="same")
        mismatch = self.command("workspace.create", {"id": "w1", "title": "Changed"}, op="same")
        self.assertEqual(mismatch["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        self.assertFalse(mismatch["recorded"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "same"}), original)
        self.assertEqual(self.sql("SELECT title FROM workspaces"), [("Original",)])

    def test_business_refusal_is_recorded_without_partial_state(self):
        refused = self.command("workspace.create", {"id": "w1", "title": "No", "team": ["missing"]})
        self.assertEqual(refused["status"], "rejected")
        self.assertTrue(refused["recorded"])
        self.assertEqual(refused["error"]["code"], "INVALID_RECIPIENT")
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM changes"), [(0,)])

    def test_wrong_instance_and_unknown_operation_do_not_invent_outcomes(self):
        response = self.store.command("owner", {"v": 1, "instance_id": "other", "operation_id": "bad",
                                              "kind": "workspace.create", "args": {"title": "No"}})
        self.assertFalse(response["recorded"])
        self.assertEqual(response["error"]["code"], "INSTANCE_MISMATCH")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])
        unknown = self.store.view("owner", "operation", {"operation_id": "absent"})
        self.assertEqual(unknown["status"], "unknown")
        self.assertFalse(unknown["recorded"])
        with self.assertRaises(StoreError):
            Store(self.path, "other", expected_binding=self.binding)
        missing = self.path.parent / "not-created.sqlite3"
        with self.assertRaises(StoreError):
            Store(missing, "test-instance", expected_binding=self.binding)
        self.assertFalse(missing.exists())

    def test_contended_attempt_is_not_a_recorded_refusal(self):
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        busy = self.command("workspace.create", {"id": "w1", "title": "After lock"}, op="blocked")
        self.assertEqual(busy["status"], "retryable")
        self.assertFalse(busy["recorded"])
        self.assertEqual(busy["error"]["code"], "DATABASE_BUSY")
        blocker.rollback()
        accepted = self.command("workspace.create", {"id": "w1", "title": "After lock"}, op="blocked")
        self.assertEqual(accepted["status"], "committed")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(1,)])

    def test_workspace_team_does_not_grant_operation_or_draft_visibility(self):
        receipt = self.workspace()
        self.assertEqual(self.store.view("agent-a", "workspace", {"workspace_id": "w1"})["workspace"]["owner_id"], "owner")
        other = self.store.view("agent-a", "operation", {"operation_id": receipt["operation_id"]})
        self.assertEqual(other["status"], "unknown")

    def save_draft(self, draft_id, source, topic_id, body, revision=0, generation="gA", **extra):
        return self.command("draft.save", dict(source_ref=source, topic_id=topic_id, body=body,
                            generation=generation, attachments=[], quotes=[], addressees=[], **extra),
                            target={"draft_id": draft_id}, expected={"draft_revision": revision})

    def prepare(self, draft_id, topic_id, revision=1, submission="s1", send_op="send-1"):
        return self.command("submission.prepare", {"draft_id": draft_id, "submission_id": submission,
                            "send_operation_id": send_op}, target={"topic_id": topic_id},
                            expected={"draft_revision": revision})

    def create_topic(self):
        self.workspace()
        source = {"kind": "new_topic", "id": "opening-one", "workspace_id": "w1"}
        saved = self.save_draft("opening-draft", source, "t1", "Opening message",
                                opening={"workspace_id": "w1", "title": "Topic", "participants": ["agent-a"]})
        self.assertEqual(saved["status"], "committed", saved)
        prepared = self.prepare("opening-draft", "t1", submission="opening", send_op="open-topic")
        self.assertEqual(prepared["status"], "committed", prepared)
        created = self.command("topic.create_and_send", {"submission_id": "opening"},
                               target={"topic_id": "t1"}, op="open-topic")
        self.assertEqual(created["status"], "committed", created)
        return {"kind": "message", "id": created["result"]["message_id"]}

    def test_prepare_is_private_and_rotates_draft_without_clearing_new_writing_on_send(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "Submission A")
        self.command("note.save", {"source_ref": source, "body": "Private N"},
                     target={"note_id": "n1"}, expected={"note_revision": 0})
        prepared = self.prepare("d1", "t1")
        self.assertEqual(prepared["status"], "committed", prepared)
        next_draft = prepared["result"]["next_draft"]
        self.assertEqual(next_draft["revision"], 2)
        self.assertNotEqual(next_draft["generation"], "gA")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(1,)])
        b = self.save_draft("d1", source, "t1", "New B", revision=2, generation=next_draft["generation"])
        self.assertEqual(b["status"], "committed", b)
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        again = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(again, sent)
        editor = self.store.view("owner", "editor_state", {"source_ref": source, "topic_id": "t1"})
        self.assertEqual(editor["draft"]["body"], "New B")
        self.assertEqual(editor["draft"]["revision"], 3)
        self.assertEqual(editor["note"]["body"], "Private N")
        self.assertEqual(self.sql("SELECT body FROM messages ORDER BY seq"), [("Opening message",), ("Submission A",)])
        foreign = self.store.view("agent-a", "submission", {"submission_id": "s1"})
        self.assertEqual(foreign["error"]["code"], "FORBIDDEN")
        self.assertIsNone(self.store.view("agent-a", "editor_state", {"source_ref": source, "topic_id": "t1"})["note"])

    def test_old_save_conflicts_and_preparation_retries_return_same_successor(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "A")
        payload = {"v": 1, "instance_id": "test-instance", "operation_id": "prepare-A", "kind": "submission.prepare",
                   "target": {"topic_id": "t1"}, "expected": {"draft_revision": 1, "authority": self.pin},
                   "args": {"draft_id": "d1", "submission_id": "s1", "send_operation_id": "send-A"}}
        prepared = self.store.command("owner", payload)
        self.assertEqual(prepared["status"], "committed", prepared)
        self.assertEqual(prepared, self.store.command("owner", payload))
        stale = self.save_draft("d1", source, "t1", "Old A", revision=1)
        self.assertEqual(stale["error"]["code"], "REVISION_CONFLICT")
        editor = self.store.view("owner", "editor_state", {"source_ref": source, "topic_id": "t1"})
        self.assertEqual(editor["draft"]["body"], "")
        self.assertEqual(len(editor["submissions"]["items"]), 1)
        snapshot = self.store.view("owner", "submission", {"submission_id": "s1"})
        self.assertEqual(snapshot["body"], "A")
        self.assertIsNone(snapshot["send_receipt"])

    def test_participant_changes_between_prepare_and_send_control_subscription_delivery(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "For current participants")
        self.prepare("d1", "t1")
        removal = self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.assertEqual(removal["status"], "committed", removal)
        addition = self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"})
        self.assertEqual(addition["status"], "committed", addition)
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        recipients = self.sql("SELECT recipient_id FROM deliveries WHERE message_id=?", (sent["result"]["message_id"],))
        self.assertEqual(recipients, [("agent-b",)])
        self.assertEqual(self.store.view("agent-a", "deliveries", {})["items"], [])

    def test_removal_cancels_subscription_reason_without_erasing_addressed_reason(self):
        source = self.create_topic()
        saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": "Directed too",
                             "generation": "gA", "addressees": ["agent-a"], "intent": "tell", "attachments": [], "quotes": []},
                             target={"draft_id": "d1"}, expected={"draft_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        self.prepare("d1", "t1")
        self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        pending = self.store.view("agent-a", "deliveries", {})
        self.assertEqual(len(pending["items"]), 1, pending)
        self.assertEqual(pending["items"][0]["reasons"], ["addressed"])
        self.assertEqual(pending["items"][0]["message"]["body"], "Directed too")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(2,)])

    def test_concurrent_public_send_is_one_message_and_one_delivery_per_recipient(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "Once")
        self.prepare("d1", "t1")
        command = {"v": 1, "instance_id": "test-instance", "operation_id": "send-1", "kind": "message.send",
                   "target": {"topic_id": "t1"}, "expected": {"authority": self.pin}, "args": {"submission_id": "s1"}}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.store.command("owner", command), range(2)))
        self.assertEqual(results[0]["status"], "committed", results)
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='Once'"), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE message_id=?", (results[0]["result"]["message_id"],)), [(1,)])

    def test_two_private_openings_have_distinct_saved_drafts_and_do_not_deliver(self):
        self.workspace()
        for n in (1, 2):
            source = {"kind": "new_topic", "id": "opening-%s" % n, "workspace_id": "w1"}
            saved = self.save_draft("d%s" % n, source, "t%s" % n, "Draft %s" % n,
                                   opening={"workspace_id": "w1", "title": "New", "participants": ["agent-a"]})
            self.assertEqual(saved["status"], "committed", saved)
            self.assertEqual(self.store.view("owner", "editor_state", {"source_ref": source, "topic_id": "t%s" % n})["draft"]["body"], "Draft %s" % n)
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries"), [(0,)])

    def test_reserved_send_operation_cannot_be_consumed_by_another_command(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "A")
        self.prepare("d1", "t1")
        attempt = self.command("workspace.create", {"id": "w2", "title": "Unrelated"}, op="send-1")
        self.assertFalse(attempt["recorded"], attempt)
        self.assertEqual(attempt["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        self.assertIsNone(self.store.view("owner", "submission", {"submission_id": "s1"})["send_receipt"])
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertEqual(self.sql("SELECT id FROM workspaces"), [("w1",)])

    def test_remove_and_readd_does_not_revive_old_subscription_deliveries(self):
        source = self.create_topic()
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.command("participation.set", {"actor_id": "agent-a", "present": True}, target={"topic_id": "t1"})
        self.assertEqual(self.store.view("agent-a", "deliveries", {})["items"], [])
        self.save_draft("d1", source, "t1", "New invitation")
        self.prepare("d1", "t1")
        self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        pending = self.store.view("agent-a", "deliveries", {})["items"]
        self.assertEqual([x["message"]["body"] for x in pending], ["New invitation"])

    def test_deliveries_are_previews_and_full_source_retains_exact_writing(self):
        source = self.create_topic()
        body = "A paragraph. " * 100
        self.save_draft("d1", source, "t1", body)
        self.prepare("d1", "t1")
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        delivered = self.store.view("agent-a", "deliveries", {})["items"][-1]
        self.assertTrue(delivered["message"]["preview"])
        full = self.store.view("agent-a", "source", {"kind": "message", "id": sent["result"]["message_id"]})
        self.assertEqual(full["body"], body)

    def test_public_send_cannot_override_frozen_text_and_operation_stays_pending(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "Original A")
        self.prepare("d1", "t1")
        attempt = self.command("message.send", {"submission_id": "s1", "body": "Changed"}, target={"topic_id": "t1"}, op="send-1")
        self.assertFalse(attempt["recorded"], attempt)
        self.assertEqual(attempt["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertEqual(self.sql("SELECT body FROM messages ORDER BY seq"), [("Opening message",), ("Original A",)])

    def test_stale_save_within_generation_cannot_replace_newer_text(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "First")
        self.save_draft("d1", source, "t1", "Second", revision=1)
        stale = self.save_draft("d1", source, "t1", "Old autosave", revision=1)
        self.assertEqual(stale["status"], "rejected", stale)
        self.assertEqual(stale["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(self.store.view("owner", "editor_state", {"source_ref": source, "topic_id": "t1"})["draft"]["body"], "Second")


if __name__ == "__main__":
    unittest.main()

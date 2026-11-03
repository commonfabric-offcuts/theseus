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
        initialize(self.path, "test-instance", [
            {"id": "owner", "kind": "human"},
            {"id": "agent-a", "kind": "agent"},
            {"id": "agent-b", "kind": "agent"},
        ])
        self.store = Store(self.path, "test-instance")
        self.serial = 0

    def command(self, kind, args=None, target=None, expected=None, actor="owner", op=None):
        self.serial += 1
        return self.store.command(actor, {
            "v": 1, "instance_id": "test-instance", "operation_id": op or "op-%s" % self.serial,
            "kind": kind, "target": target or {}, "expected": expected or {}, "args": args or {},
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
                    "kind": "workspace.create", "target": {}, "expected": {},
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
            Store(self.path, "other")
        missing = self.path.parent / "not-created.sqlite3"
        with self.assertRaises(StoreError):
            Store(missing, "test-instance")
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


if __name__ == "__main__":
    unittest.main()

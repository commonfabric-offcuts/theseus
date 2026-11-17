from __future__ import annotations

import json
import unittest
from unittest import mock

import test_agent_verbs as verbs


class Item610(verbs.AgentVerbCase):
    def version(self, kind):
        table, record = ("workspaces", "w1") if kind == "coordinator" else ("topics", "t1")
        return self.sql("SELECT version FROM " + table + " WHERE id=?", (record,))[0][0]

    def request(self, kind, member, actor="agent-b", revision=None, op=None):
        workspace = kind == "coordinator"
        return self.command("workspace.coordinator_set" if workspace else "participation.set",
                            {"actor_id": member, **({} if workspace else {"present": True})},
                            {"workspace_id": "w1"} if workspace else {"topic_id": "t1"},
                            {"workspace_revision" if workspace else "topic_revision":
                             self.version(kind) if revision is None else revision}, actor=actor, op=op)

    def recorded_by_caller(self, op, receipt):
        rows = self.sql("SELECT actor_id,outcome FROM operations WHERE id=?", (op,))
        self.assertEqual([row[0] for row in rows], ["agent-b"], "never record as the owner")
        self.assertEqual(json.loads(rows[0][1]), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": op})["status"], "unknown")

    def test_item_610_ordinary_agent_changes_coordinator_as_itself_and_retries_exactly(self):
        revision = self.version("coordinator")
        before = self.sql("SELECT count(*) FROM operations WHERE actor_id='owner'")
        receipt = self.request("coordinator", "agent-b", revision=revision, op="610-coordinator")
        self.committed(receipt)
        self.assertEqual(self.sql("SELECT owner_id,coordinator_id FROM workspaces WHERE id='w1'"), [("owner", "agent-b")])
        self.recorded_by_caller("610-coordinator", receipt)
        state = self.public_state()
        self.assertEqual(self.request("coordinator", "agent-b", revision=revision, op="610-coordinator"), receipt)
        self.assertEqual(self.public_state(), state)
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE actor_id='owner'"), before)

    def test_item_610_ordinary_agent_adds_people_and_agents_reading_and_delivery_as_members(self):
        for member in ("outsider", "other-reader"):
            with self.subTest(member=member):
                self.rejected(self.store.view(member, "topic", {"topic_id": "t1"}), "FORBIDDEN")
                revision = self.version("participant")
                op = "610-add-" + member
                receipt = self.request("participant", member, revision=revision, op=op)
                self.committed(receipt)
                self.recorded_by_caller(op, receipt)
                self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='t1' AND actor_id=?", (member,)), [(1,)])
                self.assertNotIn("error", self.store.view(member, "topic_messages", {"topic_id": "t1"}))
                state = self.public_state()
                self.assertEqual(self.request("participant", member, revision=revision, op=op), receipt)
                self.assertEqual(self.public_state(), state)
                sent = self.committed(self.command("message.post", {"body": "For the whole topic"}, {"topic_id": "t1"}))
                self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? AND recipient_id=?",
                                          (sent["message_id"], member)), [(member,)])
                self.assertTrue(any(item["message_id"] == sent["message_id"] for item in
                                    self.store.view(member, "deliveries", {})["items"]))

    def test_item_610_each_cli_verb_plain_and_json_retains_caller_and_retry_receipt(self):
        for verb, destination, member, json_mode in (
                ("coordinator", "w1", "owner", False), ("coordinator", "w1", "agent-a", True),
                ("participant", "t1", "outsider", False), ("participant", "t1", "other-reader", True)):
            with self.subTest(verb=verb, json=json_mode):
                before = set(self.saved("agent-b"))
                code, out, err = self.run_cli(*(["--json"] if json_mode else []), verb, destination, member, actor="agent-b")
                self.assertEqual((code, err), (0, ""), out)
                [request_file] = [name for name in set(self.saved("agent-b")) - before if name.endswith(".request.json")]
                op = request_file[:-len(".request.json")]
                receipt = self.store.view("agent-b", "operation", {"operation_id": op})
                self.committed(receipt)
                self.recorded_by_caller(op, receipt)
                if verb == "coordinator":
                    self.assertEqual(self.sql("SELECT coordinator_id FROM workspaces WHERE id='w1'"), [(member,)])
                else:
                    self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='t1' AND actor_id=?", (member,)), [(1,)])
                if json_mode:
                    self.assertEqual(json.loads(out.splitlines()[-1]), receipt)
                else:
                    self.assertIn(member + (" answers" if verb == "coordinator" else " takes part"), out)
                state = self.public_state()
                code, out, err = self.run_cli("--json", "retry", op, actor="agent-b")
                self.assertEqual((code, err, json.loads(out)), (0, "", receipt))
                self.assertEqual(self.public_state(), state)

    def test_item_610_ordinary_refusals_keep_destination_and_caller_identity(self):
        for kind in ("coordinator", "participant"):
            for member, actor, revision, error in (
                    ("missing", "agent-b", None, "INVALID_RECIPIENT"),
                    ("agent-a", "outsider", None, "FORBIDDEN"),
                    ("agent-a", "agent-b", 0, "REVISION_CONFLICT")):
                with self.subTest(kind=kind, error=error):
                    state = self.public_state()
                    receipt = self.request(kind, member, actor=actor, revision=revision)
                    self.rejected(receipt, error)
                    self.assertTrue(receipt["recorded"])
                    self.assertEqual(self.public_state(), state)
            self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
            state = self.public_state()
            self.rejected(self.request(kind, "agent-a"), "INVALID_RECIPIENT")
            self.assertEqual(self.public_state(), state)
            self.sql("UPDATE actors SET enabled=1 WHERE id='agent-a'")

    def test_item_610_cli_refusals_write_no_setting_or_membership(self):
        for verb, destination in (("coordinator", "w1"), ("participant", "t1")):
            for actor, member, error in (("agent-b", "missing", "INVALID_RECIPIENT"),
                                          ("outsider", "agent-a", "FORBIDDEN")):
                with self.subTest(verb=verb, error=error):
                    state = self.public_state()
                    code, out, err = self.run_cli(verb, destination, member, actor=actor)
                    self.assertEqual((code, out), (2, ""))
                    self.assertIn(error, err)
                    self.assertEqual(self.public_state(), state)
            # Another act wins between the verb's read and write: its captured revision still fences it.
            original = verbs.Store.command

            def changed(store, actor, envelope):
                table, record = ("workspaces", "w1") if verb == "coordinator" else ("topics", "t1")
                self.sql("UPDATE " + table + " SET version=version+1 WHERE id=?", (record,))
                return original(store, actor, envelope)

            with mock.patch.object(verbs.Store, "command", changed):
                code, out, err = self.run_cli(verb, destination, "agent-b", actor="agent-b")
            self.assertEqual((code, out), (2, ""))
            self.assertIn("REVISION_CONFLICT", err)
            self.assertEqual(self.sql("SELECT coordinator_id FROM workspaces WHERE id='w1'"), [("agent-a",)])
            self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-b'"), [])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import sqlite3
import unittest

from aim_next import Store
import test_store as fixture


class CommandPinCase(fixture.StoreCase):
    def setUp(self):
        super().setUp()
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}

    def raw(self, operation="raw", expected=None):
        return {"v": 1, "instance_id": "test-instance", "operation_id": operation, "kind": "workspace.create",
                "target": {}, "expected": expected if expected is not None else {"authority": self.pin},
                "args": {"id": "raw-workspace", "title": "Pinned"}}

    def controlled_epoch(self):
        anchor = Path(self.binding["authority_path"])
        fd = os.open(str(anchor) + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            record = json.loads(anchor.read_text())
            record["epoch"] = "isolated-next-epoch"
            record["recovery"] = {"history_complete": False}
            with sqlite3.connect(str(self.path)) as db:
                db.execute("UPDATE metadata SET value=? WHERE key='authority_epoch'", (record["epoch"],))
            anchor.write_text(json.dumps(record))
            self.binding = dict(self.binding, authority_epoch=record["epoch"])
        finally:
            os.close(fd)
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)

    def test_missing_and_malformed_pins_cannot_record_a_command(self):
        cases = [{}, {"authority": None}, {"authority": {}}, {"authority": dict(self.pin, extra=True)},
                 {"authority": dict(self.pin, authority_epoch=1)}]
        for index, expected in enumerate(cases):
            with self.subTest(expected=expected):
                result = self.store.command("owner", self.raw("invalid-%s" % index, expected))
                self.assertFalse(result["recorded"], result)
                self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])

    def test_current_pin_commits_once_and_stale_pin_is_checked_before_deduplication(self):
        envelope = self.raw()
        committed = self.store.command("owner", envelope)
        self.assertEqual(committed["status"], "committed", committed)
        self.assertEqual(self.store.command("owner", envelope), committed)
        before = self.sql("SELECT * FROM operations")
        self.controlled_epoch()
        stale = self.store.command("owner", envelope)
        self.assertFalse(stale["recorded"])
        self.assertEqual(stale["error"]["code"], "AUTHORITY_CHANGED")
        repinned = self.store.command("owner", dict(envelope, expected={"authority": self.pin}))
        self.assertFalse(repinned["recorded"])
        self.assertEqual(repinned["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "raw"}), committed)
        self.assertEqual(self.sql("SELECT * FROM operations"), before)

    def prepare_kind(self, kind):
        if kind == "message.send":
            source = self.create_topic()
            extra, topic = {}, "t1"
        else:
            self.workspace()
            source = {"kind": "new_topic", "id": "private-opening", "workspace_id": "w1"}
            topic = "t2"
            extra = {"opening": {"workspace_id": "w1", "title": "Opening", "participants": ["agent-a"]}}
        self.assertEqual(self.save_draft("frozen", source, topic, "Frozen E1", **extra)["status"], "committed")
        prepared = self.prepare("frozen", topic, submission="frozen", send_op="frozen-send")
        self.assertEqual(prepared["status"], "committed", prepared)
        return topic

    def assert_cross_epoch_reservation_refused(self, kind):
        topic = self.prepare_kind(kind)
        old_pin = dict(self.pin)
        snapshot = self.store.view("owner", "submission", {"submission_id": "frozen"})
        self.assertEqual(snapshot.get("authority"), old_pin)
        before = {table: self.sql("SELECT * FROM " + table) for table in ("submissions", "drafts", "operations", "messages")}
        self.controlled_epoch()
        self.assertEqual(self.store.view("owner", "capabilities", {})["authority"]["continuity"], "incomplete")
        result = self.command(kind, {"submission_id": "frozen"}, target={"topic_id": topic}, op="frozen-send")
        self.assertFalse(result["recorded"], result)
        self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.assertEqual({table: self.sql("SELECT * FROM " + table) for table in before}, before)
        # Fresh, explicit E2 writing gets a new reservation and remains usable.
        source = {"kind": "new_topic", "id": "fresh-e2", "workspace_id": "w1"}
        saved = self.save_draft("fresh-e2", source, "t3", "New E2 writing", opening={"workspace_id": "w1", "title": "Fresh E2", "participants": ["agent-a"]})
        self.assertEqual(saved["status"], "committed", saved)
        self.assertEqual(self.prepare("fresh-e2", "t3", submission="fresh-e2", send_op="fresh-send")["status"], "committed")
        sent = self.command("topic.create_and_send", {"submission_id": "fresh-e2"}, target={"topic_id": "t3"}, op="fresh-send")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertEqual(self.command("topic.create_and_send", {"submission_id": "fresh-e2"}, target={"topic_id": "t3"}, op="fresh-send"), sent)
        if kind == "message.send":
            fresh_source = {"kind": "message", "id": sent["result"]["message_id"]}
            self.assertEqual(self.save_draft("fresh-reply", fresh_source, "t3", "Fresh E2 reply")["status"], "committed")
            self.assertEqual(self.prepare("fresh-reply", "t3", submission="fresh-reply", send_op="fresh-reply-send")["status"], "committed")
            reply = self.command("message.send", {"submission_id": "fresh-reply"}, target={"topic_id": "t3"}, op="fresh-reply-send")
            self.assertEqual(reply["status"], "committed", reply)
            self.assertEqual(self.command("message.send", {"submission_id": "fresh-reply"}, target={"topic_id": "t3"}, op="fresh-reply-send"), reply)

    def test_message_send_cannot_repin_an_earlier_epoch_reservation(self):
        self.assert_cross_epoch_reservation_refused("message.send")

    def test_topic_create_send_cannot_repin_an_earlier_epoch_reservation(self):
        self.assert_cross_epoch_reservation_refused("topic.create_and_send")

    def test_same_epoch_topic_opening_commits_once_without_rewriting_its_pin(self):
        topic = self.prepare_kind("topic.create_and_send")
        before = self.sql("SELECT * FROM submissions")
        result = self.command("topic.create_and_send", {"submission_id": "frozen"}, target={"topic_id": topic}, op="frozen-send")
        self.assertEqual(result["status"], "committed", result)
        self.assertEqual(self.command("topic.create_and_send", {"submission_id": "frozen"}, target={"topic_id": topic}, op="frozen-send"), result)
        self.assertEqual(self.sql("SELECT * FROM submissions"), before)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(1,)])


for _name in list(fixture.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in CommandPinCase.__dict__:
        setattr(CommandPinCase, _name, None)


if __name__ == "__main__":
    unittest.main()

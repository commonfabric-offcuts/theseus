from __future__ import annotations

import json
import sqlite3
import unittest
from unittest import mock

from aim_next.contract import LIMITS, _json
from test_store import StoreCase


class DeliveryCase(StoreCase):
    def send_next(self, body="Next", addressees=None):
        serial = self.serial + 1
        source = {"kind": "message", "id": self.sql("SELECT id FROM messages ORDER BY seq DESC LIMIT 1")[0][0]}
        saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": body,
            "generation": "gA", "addressees": addressees or [], "attachments": [], "quotes": [],
            # A message to someone says it tells them, as the person's page says for them.
            **({"intent": "tell"} if addressees else {})},
            target={"draft_id": "d%s" % serial}, expected={"draft_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        submission, operation = "s%s" % serial, "send%s" % serial
        self.assertEqual(self.prepare("d%s" % serial, "t1", submission=submission, send_op=operation)["status"], "committed")
        result = self.command("message.send", {"submission_id": submission}, target={"topic_id": "t1"}, op=operation)
        self.assertEqual(result["status"], "committed", result)
        return result["result"]["message_id"]

    def pending(self, **args):
        return self.store.view("agent-a", "deliveries", args)

    def ack(self, delivery_id, actor="agent-a", op=None):
        return self.command("delivery.ack", target={"delivery_id": delivery_id}, actor=actor, op=op)

    def test_cancelled_history_does_not_hide_new_work_on_first_page(self):
        self.create_topic()
        old = self.pending()["items"][0]["id"]
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        cancelled = self.ack(old)
        self.assertTrue(cancelled["recorded"], cancelled)
        self.assertEqual(cancelled["result"], {"delivery_id": old, "acknowledged": False, "reason": "not_pending"})
        self.command("participation.set", {"actor_id": "agent-a", "present": True}, target={"topic_id": "t1"})
        fresh = self.send_next("Fresh after re-add")
        page = self.pending(limit=1)
        self.assertEqual([item["message_id"] for item in page["items"]], [fresh], page)
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE id=?", (old,)), [("pending",)])

    def test_ack_is_one_actor_bound_act_and_does_not_change_message_or_work(self):
        self.create_topic()
        delivery = self.pending()["items"][0]["id"]
        messages = self.sql("SELECT * FROM messages")
        topics = self.sql("SELECT * FROM topics")
        first = self.ack(delivery, op="ack-once")
        self.assertEqual(first["status"], "committed", first)
        self.assertTrue(first["result"]["acknowledged"])
        self.assertEqual(self.ack(delivery, op="ack-once"), first)
        again = self.ack(delivery)
        self.assertTrue(again["result"]["already_acknowledged"])
        self.assertEqual(self.pending()["items"], [])
        self.assertEqual(self.sql("SELECT * FROM messages"), messages)
        self.assertEqual(self.sql("SELECT * FROM topics"), topics)
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0,)])
        foreign = self.ack(delivery, actor="agent-b")
        missing = self.ack("absent", actor="agent-b")
        self.assertIn("error", foreign)
        self.assertIn("error", missing)
        self.assertEqual(foreign["error"], missing["error"])

    def test_direct_reason_has_one_group_and_survives_subscription_removal(self):
        self.create_topic()
        message = self.send_next("Explicit too", ["agent-a"])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE message_id=?", (message,)), [(1,)])
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        page = self.pending()
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(page["items"][0]["reasons"], ["addressed"])
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(1,)])
        self.assertEqual(self.sql("SELECT g.kind FROM delivery_groups g JOIN deliveries d ON d.group_id=g.id WHERE d.message_id=?", (message,)), [("direct",)])
        self.assertEqual(self.ack(page["items"][0]["id"])["status"], "committed")
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0,)])

    def test_group_heads_advance_and_actor_disable_is_indexed_without_dropping_work(self):
        self.create_topic()
        self.send_next("Second")
        page = self.pending()
        self.ack(page["items"][0]["id"])
        self.assertEqual(self.sql("SELECT first_pending_seq FROM delivery_groups WHERE active=1 AND pending_count>0"), [(page["items"][1]["seq"],)])
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(1,)])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        self.assertEqual(self.sql("SELECT enabled,pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0, 1)])
        self.assertEqual(self.pending()["error"]["code"], "INVALID_ACTOR")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=1 WHERE id='agent-a'")
        self.assertEqual(len(self.pending()["items"]), 1)

    def test_byte_limited_pages_continue_without_lost_or_duplicate_rows(self):
        self.create_topic()
        for _ in range(4):
            self.send_next("🪴" * 400)
        expected = {row[0] for row in self.sql("SELECT id FROM deliveries")}
        seen, cursor, pages = [], None, 0
        with mock.patch.dict(LIMITS, summary_utf8_bytes=2300):
            while True:
                page = self.pending(**({"cursor": cursor} if cursor is not None else {}))
                self.assertNotIn("error", page)
                self.assertLessEqual(len(_json(page).encode("utf-8")), 2300)
                seen.extend(item["id"] for item in page["items"])
                cursor = page["next_cursor"]
                pages += 1
                self.assertLess(pages, 10)
                if cursor is None:
                    break
                self.assertIsInstance(cursor, str)
        self.assertGreater(pages, 1)
        self.assertEqual(set(seen), expected)
        self.assertEqual(len(seen), len(expected))

    def test_compound_cursor_is_one_traversal_not_an_acknowledgement(self):
        self.create_topic()
        self.send_next("Direct one", ["agent-a"])
        page = self.pending(limit=1)
        cursor = page["next_cursor"]
        self.assertIsInstance(cursor, str)
        self.assertEqual(len(self.pending(cursor=cursor, limit=1)["items"]), 1)
        self.assertEqual(len(self.pending()["items"]), 2)
        for invalid in (0, [], "not-a-cursor"):
            self.assertEqual(self.pending(cursor=invalid)["error"]["code"], "INVALID_ARGUMENT")

    def test_only_reconciliation_of_captured_work_releases_cooldown(self):
        self.create_topic()
        first = self.pending()["items"][0]
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE recipient_schedule SET captured_seq=?,next_due_ms=90000,retry_count=4 WHERE recipient_id='agent-a'", (first["seq"],))
        with mock.patch("aim_next.delivery._now_ms", return_value=1000):
            self.send_next("Later B")
            self.assertEqual(self.sql("SELECT next_due_ms,retry_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(90000, 4)])
            self.ack(first["id"])
            self.assertEqual(self.sql("SELECT pending_count,next_due_ms,retry_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(1, 1000, 0)])
            self.ack(self.pending()["items"][0]["id"])
            self.assertEqual(self.sql("SELECT pending_count,next_due_ms FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0, None)])
        with mock.patch("aim_next.delivery._now_ms", return_value=2000):
            self.send_next("New episode")
        self.assertEqual(self.sql("SELECT pending_count,next_due_ms FROM recipient_schedule WHERE recipient_id='agent-a'"), [(1, 2000)])


for _name in list(StoreCase.__dict__):
    if _name.startswith("test_") and _name not in DeliveryCase.__dict__:
        setattr(DeliveryCase, _name, None)
del StoreCase


if __name__ == "__main__":
    unittest.main()

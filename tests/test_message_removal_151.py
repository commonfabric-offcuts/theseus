from __future__ import annotations

"""151's first bounded red group. All records belong to ReaderCase's temp store."""

import json
from unittest import mock

from aim_next import Store
from aim_next import store as store_module
import reader_fixture as fixtures


class RemovalCase(fixtures.ReaderCase):
    def post(self, body="Removal fixture exact words", actor="owner", **extra):
        args = dict(body=body, addressees=["agent-a"], intent="tell")
        args.update(extra)
        return self.committed(self.command("message.post", args,
            target={"topic_id": "t1"}, actor=actor))["message_id"]

    def remove(self, message, mode="unsend", actor="owner", op=None):
        return self.command("message." + mode, target={"message_id": message}, actor=actor, op=op)

    def source_view(self, message, actor="owner"):
        return self.store.view(actor, "source", {"source_ref": {"kind": "message", "id": message}})

    def test_unseen_unsend_removes_projection_delivery_star_and_unread(self):
        for (delivery_id,) in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-a' AND state='pending'"):
            self.committed(self.command("delivery.ack", target={"delivery_id": delivery_id}, actor="agent-a"))
        message = self.post()
        original = self.sql("SELECT * FROM messages WHERE id=?", (message,))
        self.committed(self.command("message.star", {"starred": True},
            target={"message_id": message}, expected={"star_revision": 0}))
        delivery = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-a'", (message,))[0][0]
        receipt = self.remove(message, op="unsend-once")
        result = self.committed(receipt)
        self.assertEqual(result["removal"]["kind"], "unsent")
        self.assertEqual(self.sql("SELECT * FROM messages WHERE id=?", (message,)), original)
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND state IN ('pending','held')", (message,)), [])
        for actor in ("owner", "agent-a"):
            self.assertEqual(self.source_view(message, actor)["error"]["code"], "FORBIDDEN")
            page = self.store.view(actor, "topic_messages", {"topic_id": "t1"})
            self.assertNotIn(message, [item["id"] for item in page["items"]])
            self.assertNotIn("Removal fixture exact words", json.dumps(page))
        self.assertNotIn(message, [item["message_id"] for item in self.store.view("owner", "stars", {})["items"]])
        self.assertEqual(self.store.view("agent-a", "delivery", {"delivery_id": delivery})["error"]["code"], "FORBIDDEN")
        self.assertIsNone(self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})["oldest_unread"])
        self.assertEqual(self.remove(message, op="unsend-once"), receipt)

    def test_human_content_fetch_counts_even_between_others_and_requires_retract(self):
        self.participation("other-reader", True)
        message = self.post()
        page = self.store.view("other-reader", "topic_messages", {"topic_id": "t1"})
        self.assertIn(message, [item["id"] for item in page["items"]])
        refused = self.remove(message)
        self.rejected(refused, "MESSAGE_SEEN")
        self.assertFalse(refused["recorded"])
        self.assertEqual(self.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (message,)), [("other-reader",)])
        result = self.committed(self.remove(message, "retract"))
        source = self.source_view(message)
        self.assertEqual(source["body"], "Removal fixture exact words")
        self.assertEqual(source["removal"], result["removal"])
        self.assertEqual(source["removal"]["kind"], "retracted")
        self.assertIsInstance(source["removal"]["at_ms"], int)

    def test_already_exposed_human_topic_open_and_own_source_take_no_write_lock(self):
        self.participation("other-reader", True)
        message = self.post()
        page = self.store.view("other-reader", "topic_messages", {"topic_id": "t1"})
        self.assertIn(message, [item["id"] for item in page["items"]])
        self.assertEqual(self.source_view(message).get("removal_action"), "retract",
                         "Core must expose the first fetch's permanent Retract choice")
        first = self.sql("SELECT * FROM message_first_exposures ORDER BY message_id")
        self.assertTrue(first)
        statements = []
        connect_before = store_module._connect

        def traced_connect(*args, **kwargs):
            db, runtime = connect_before(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, runtime

        with mock.patch.object(store_module, "_connect", traced_connect):
            self.assertEqual(self.store.view("other-reader", "topic_messages", {"topic_id": "t1"}), page)
            self.assertEqual(self.source_view(message)["body"], "Removal fixture exact words")
        self.assertIn("BEGIN", statements)
        self.assertFalse(any(sql.lstrip().upper().startswith(("BEGIN IMMEDIATE", "INSERT", "UPDATE", "DELETE", "COMMIT")) for sql in statements), statements)
        self.assertEqual(self.sql("SELECT * FROM message_first_exposures ORDER BY message_id"), first)

    def test_only_human_author_and_private_unknown_have_same_refusal(self):
        message = self.post()
        self.rejected(self.remove(message, actor="agent-a"), "FORBIDDEN")
        agent_message = self.post(actor="agent-a", addressees=["owner"])
        self.rejected(self.remove(agent_message, actor="agent-a"), "FORBIDDEN")
        private = self.post(whisper=True, intent=None)
        hidden = self.remove(private, actor="agent-b")
        unknown = self.remove("missing-removal-source", actor="agent-b")
        self.assertEqual(hidden["error"], unknown["error"])
        self.rejected(hidden, "FORBIDDEN")

    def test_even_authors_own_reply_requires_retract(self):
        message = self.post()
        reply = self.post(body="Author's own follow-up", reply_to=message)
        self.assertEqual(self.sql("SELECT * FROM message_exposures WHERE message_id=?", (message,)), [])
        self.rejected(self.remove(message), "MESSAGE_SEEN")
        self.committed(self.remove(message, "retract"))
        self.assertEqual(self.source_view(reply)["reply_to"], message)

    def test_handover_first_refuses_unsend_and_retraction_has_distinct_notice(self):
        message = self.post()
        self.assertEqual(self.source_view(message, "agent-a")["body"], "Removal fixture exact words")
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-a' AND message_id=?", (message,)), [(1,)])
        refused = self.remove(message)
        self.rejected(refused, "MESSAGE_SEEN")
        original = self.sql("SELECT id FROM deliveries WHERE message_id=?", (message,))
        self.committed(self.remove(message, "retract"))
        notices = [item for item in self.store.view("agent-a", "deliveries", {"limit": 100})["items"] if item.get("retraction")]
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]["retraction"]["message_id"], message)
        self.assertNotIn((notices[0]["id"],), original)
        self.assertIsNone(notices[0]["message_id"])
        self.assertNotIn("retraction", json.dumps(self.store.view("agent-b", "deliveries", {"limit": 100})))
        self.committed(self.command("delivery.ack", target={"delivery_id": notices[0]["id"]}, actor="agent-a"))
        self.assertFalse(any(item.get("retraction") for item in self.store.view("agent-a", "deliveries", {"limit": 100})["items"]))

    def test_unsend_between_agent_read_phases_returns_no_words_or_exposure(self):
        message = self.post()
        receipts = []

        def unsend_before_second_read():
            receipt = self.remove(message, op="win-before-handover")
            receipts.append(receipt)
            self.committed(receipt)

        answer = self.store._view("agent-a", "source", {"source_ref": {"kind": "message", "id": message}},
                                  between=unsend_before_second_read)
        self.assertEqual(len(receipts), 1, "exercise the real two-phase hand-over seam")
        self.assertEqual(answer.get('error', {}).get('code'), "FORBIDDEN", answer)
        self.assertNotIn("Removal fixture exact words", json.dumps(answer))
        self.assertEqual(self.sql("SELECT * FROM message_exposures WHERE message_id=?", (message,)), [])
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND state IN ('pending','held')", (message,)), [])

    def test_injected_failure_retry_and_restart_keep_one_immutable_terminal_act(self):
        message = self.post()
        before = {name: self.sql("SELECT * FROM " + name + " ORDER BY rowid")
                  for name in ("messages", "message_removals", "message_marks", "topic_summaries", "deliveries", "delivery_groups", "recipient_schedule", "operations", "changes")}
        with mock.patch.object(self.store, "_change", side_effect=RuntimeError("151 injected before commit")):
            with self.assertRaisesRegex(RuntimeError, "151 injected before commit"):
                self.remove(message, op="atomic-unsend")
        for name, rows in before.items():
            self.assertEqual(self.sql("SELECT * FROM " + name + " ORDER BY rowid"), rows, name)
        receipt = self.remove(message, op="atomic-unsend")
        self.committed(receipt)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.remove(message, op="atomic-unsend"), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "atomic-unsend"}), receipt)
        self.assertEqual(self.sql("SELECT kind,by FROM message_removals WHERE message_id=?", (message,)), [("unsent", "owner")])

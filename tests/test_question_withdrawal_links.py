from __future__ import annotations

import http.client
import json
from pathlib import Path
import threading
import unittest
from unittest import mock

from aim_next.server import create_server
from test_question_withdrawal import WithdrawalCase


class LinkedWithdrawalCase(WithdrawalCase):
    def cover(self, root):
        return self.store.view("owner", "dossier_cover", {"message_id": root})

    def thumb(self, ask, on):
        revision = self.store.view("owner", "reactions", {"message_id": ask})["reactions"]["thumb_revision"]
        return self.committed(self.command("message.thumb", {"thumbed": on}, target={"message_id": ask},
                                          expected={"thumb_revision": revision}))

    def unchanged_records(self):
        return {table: self.sql("SELECT * FROM " + table + " ORDER BY rowid") for table in
                ("messages", "deliveries", "delivery_reasons", "conversation_items", "conversation_takes", "message_reactions")}

    def test_linked_withdrawal_keeps_second_same_dossier_wait_through_thumb_off_reply_and_retry(self):
        root = self.opening["id"]
        explicit = {"text": "An unrelated explicit decision", "default": "Keep waiting"}
        self.committed(self.command("stack.cover", {"waiting": [explicit]}, target={"message_id": root},
                                    expected={"cover_revision": 0}, actor="agent-a"))
        first = self.ask(asked=["owner"], reply_to=root)
        second = self.ask(asked=["owner"], reply_to=root)
        # An answered thumb predates withdrawal, making thumb-off a real recovery attempt.
        self.thumb(first, True)
        self.thumb(first, False)
        before = self.unchanged_records()
        history = self.sql("SELECT * FROM message_acts WHERE kind='cover' ORDER BY id")
        operation = "linked-withdraw-once"
        receipt = self.withdraw(first, op=operation)
        result = self.committed(receipt)
        self.assertEqual(self.unchanged_records(), before)
        rows = self.sql("SELECT * FROM message_acts WHERE kind='cover' ORDER BY id")
        self.assertEqual(rows[:-1], history)
        self.assertEqual(self.sql("SELECT actor_id FROM message_acts WHERE kind='cover' ORDER BY id DESC LIMIT 1"), [("agent-a",)])
        self.assertEqual(self.sql("SELECT ask_id,active FROM ask_cover_links ORDER BY ask_seq"), [(first, 0), (second, 1)])
        self.assertEqual(self.cover(root)["cover"]["waiting"][0], explicit)
        self.assertEqual([row.get("ask_id") for row in self.cover(root)["cover"]["waiting"]], [None, second])
        self.assertEqual(self.waits(), [("t1", 0, second)])
        self.assertTrue(any(row["kind"] == "acts" for row in receipt["affected"]))
        # A thumb can still acknowledge the retained words, but cannot answer/reopen this question.
        self.thumb(first, True)
        self.thumb(first, False)
        self.committed(self.command("message.post", {"body": "A late retained answer", "reply_to": first}, target={"topic_id": "t1"}))
        self.assertEqual(self.withdraw(first, op=operation), receipt)
        self.assertFalse(self.committed(self.withdraw(first))["changed"])
        self.assertEqual(self.sql("SELECT ask_id,active FROM ask_cover_links ORDER BY ask_seq"), [(first, 0), (second, 1)])
        self.assertEqual([row.get("ask_id") for row in self.cover(root)["cover"]["waiting"]], [None, second])
        self.assertEqual(self.waits(), [("t1", 0, second)])
        self.assertEqual(self.sql("SELECT message_id,by FROM message_withdrawals"), [(first, "agent-a")])
        self.assertEqual(self.source({"kind": "message", "id": first})["withdrawal"], result["withdrawal"])

    def test_already_answered_link_never_returns_when_its_old_yes_thumb_is_removed(self):
        first = self.ask(asked=["owner"])
        self.thumb(first, True)
        self.assertEqual(self.sql("SELECT active FROM ask_cover_links WHERE ask_id=?", (first,)), [(0,)])
        covers = self.sql("SELECT * FROM message_acts WHERE kind='cover'")
        self.committed(self.withdraw(first))
        self.assertEqual(self.sql("SELECT * FROM message_acts WHERE kind='cover'"), covers)
        self.thumb(first, False)
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.cover(first)["cover"]["waiting"], [])
        self.assertEqual(self.sql("SELECT active FROM ask_cover_links WHERE ask_id=?", (first,)), [(0,)])

    def test_every_recipient_link_retires_under_asker_without_fabricating_answers(self):
        revision = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": revision}))
        self.participation("other-reader", True)
        ask = self.ask(asked=["owner", "other-reader", "agent-b"])
        before = self.unchanged_records()
        maximum = self.sql("SELECT max(id) FROM message_acts")[0][0]
        self.committed(self.withdraw(ask))
        self.assertEqual(self.sql("SELECT actor_id,active FROM ask_cover_links WHERE ask_id=? ORDER BY actor_id", (ask,)),
                         [("other-reader", 0), ("owner", 0)])
        self.assertEqual(self.sql("SELECT DISTINCT actor_id FROM message_acts WHERE kind='cover' AND id>?", (maximum,)), [("agent-a",)])
        self.assertEqual(self.unchanged_records(), before)
        for actor in ("owner", "other-reader", "agent-b"):
            self.assertEqual(self.waits(actor), [])
        self.assertEqual(self.cover(ask)["cover"]["waiting"], [])

    def test_link_record_cover_attention_notifications_and_receipt_rollback_together(self):
        ask = self.ask(asked=["owner"])
        tables = ("message_acts", "cover_waiting", "ask_cover_links", "topic_waiting", "changes", "operations", "topics")
        snapshot = {name: self.sql("SELECT * FROM " + name) for name in tables}
        with mock.patch.object(self.store, "_touch_topic", side_effect=RuntimeError("after linked cover changed")):
            with self.assertRaisesRegex(RuntimeError, "after linked cover changed"):
                self.withdraw(ask, op="linked-retry")
        self.assertEqual({name: self.sql("SELECT * FROM " + name) for name in tables}, snapshot)
        self.assertEqual(self.sql("SELECT * FROM message_withdrawals"), [])
        self.committed(self.withdraw(ask, op="linked-retry"))
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.cover(ask)["cover"]["waiting"], [])

    def test_human_legacy_question_leaves_explicit_topic_and_cover_waits_exact(self):
        ask = self.ask(actor="owner", asked=["agent-a"])
        self.committed(self.command("stack.cover", {"waiting": [{"text": "Separate work", "default": "Wait"}]},
                                    target={"message_id": ask}, expected={"cover_revision": 0}))
        revision = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["agent-a"]},
                                    target={"topic_id": "t1"}, expected={"topic_revision": revision}))
        cover = self.cover(ask)
        records = self.unchanged_records()
        self.committed(self.withdraw(ask, actor="owner"))
        self.assertEqual(self.cover(ask), cover)
        self.assertEqual(self.waits("agent-a"), [("t1", 1, None)])
        self.assertEqual(self.unchanged_records(), records)

    def test_http_adapter_uses_same_real_core_author_and_exact_operation(self):
        ask = self.ask(asked=["owner"])
        web = Path(self.temp.name) / "web"
        web.mkdir()
        (web / "index.html").write_text("<p>Isolated withdrawal fixture</p>")
        server = create_server(lambda: self.store, "test-instance", "agent-a", web, token="synthetic-withdrawal")
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        thread.start()
        request = self.envelope("message.withdraw", {"message_id": ask}, {}, op="http-withdraw")
        try:
            results = []
            for _ in range(2):
                connection = http.client.HTTPConnection(*server.server_address, timeout=5)
                try:
                    connection.request("POST", "/api/command", json.dumps(request),
                        {"Authorization": "Bearer synthetic-withdrawal", "Content-Type": "application/json", "Origin": server.origin})
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    results.append(json.loads(response.read()))
                finally:
                    connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.committed(results[0])
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.sql("SELECT message_id,by FROM message_withdrawals"), [(ask, "agent-a")])
        self.assertEqual(self.waits(), [])


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(LinkedWithdrawalCase(name) for name in loader.getTestCaseNames(LinkedWithdrawalCase)
                              if name in LinkedWithdrawalCase.__dict__)

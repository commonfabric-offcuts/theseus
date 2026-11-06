from __future__ import annotations

"""Asking is part of sending: a message to someone says whether it asks or tells."""

import json
import unittest

import reader_fixture as fixtures
import test_agent_verbs


class AskOrTellCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating.

    def post(self, args, actor="agent-a", topic="t1"):
        return self.command("message.post", dict({"body": "Words"}, **args), target={"topic_id": topic}, actor=actor)

    def latest(self):
        return self.sql("SELECT id,author_id,addressees,intent FROM messages ORDER BY seq DESC LIMIT 1")[0]

    def test_a_post_to_someone_that_neither_asks_nor_tells_is_refused_and_sends_nothing(self):
        before = self.public_state()
        receipt = self.post({"addressees": ["owner"]})
        self.rejected(receipt, "INTENT_REQUIRED")
        self.assertIs(receipt["recorded"], False)
        # The refusal names the flags an agent uses, so an older client learns what to send.
        for words in ("--asks", "--tells", "intent"):
            self.assertIn(words, receipt["error"]["message"])
        self.assertEqual(self.public_state(), before)

    def test_a_post_records_whether_it_asks_or_tells_and_every_read_carries_it(self):
        for intent in ("ask", "tell"):
            with self.subTest(intent=intent):
                result = self.committed(self.post({"addressees": ["owner"], "intent": intent}))
                self.assertEqual(self.latest(), (result["message_id"], "agent-a", '["owner"]', intent))
                page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1})
                self.assertEqual([(item["id"], item["intent"]) for item in page["items"]], [(result["message_id"], intent)])
                self.assertEqual(self.source({"kind": "message", "id": result["message_id"]})["intent"], intent)
                inbox = self.store.view("owner", "deliveries", {"limit": 100})["items"]
                self.assertEqual([item["message"]["intent"] for item in inbox if item["message_id"] == result["message_id"]], [intent])

    def test_a_message_to_nobody_neither_asks_nor_tells(self):
        result = self.committed(self.post({}))
        self.assertEqual(self.latest(), (result["message_id"], "agent-a", "[]", None))
        before = self.public_state()
        self.rejected(self.post({"intent": "ask"}), "INVALID_ARGUMENT")
        self.rejected(self.post({"addressees": [], "intent": "tell"}), "INVALID_ARGUMENT")
        for intent in ("question", "", 1, ["ask"]):
            with self.subTest(intent=intent):
                self.rejected(self.post({"addressees": ["owner"], "intent": intent}), "INVALID_ARGUMENT")
        self.assertEqual(self.public_state(), before)

    def test_a_composer_message_to_someone_tells_unless_it_says_it_asks(self):
        told = self.send("Composed for agent-a", addressees=["agent-a"])
        self.assertEqual(self.latest(), (told["id"], "owner", '["agent-a"]', "tell"))
        unaddressed = self.send("Composed for the topic")
        self.assertEqual(self.latest(), (unaddressed["id"], "owner", "[]", None))
        source = {"kind": "message", "id": unaddressed["id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "Can you check this?", "attachments": [], "quotes": [],
                                                    "addressees": ["agent-a"], "intent": "ask"},
                                    target={"draft_id": "asking"}, expected={"draft_revision": 0}))
        # A preparation that names another intent than the saved one is refused.
        self.rejected(self.command("submission.prepare", {"draft_id": "asking", "submission_id": "asking", "send_operation_id": "asking-send",
                                                          "intent": "tell"}, target={"topic_id": "t1"}, expected={"draft_revision": 1}),
                      "REVISION_CONFLICT")
        self.committed(self.prepare("asking", "t1", submission="asking", send_op="asking-send"))
        sent = self.committed(self.command("message.send", {"submission_id": "asking"}, target={"topic_id": "t1"}, op="asking-send"))
        self.assertEqual(self.latest(), (sent["message_id"], "owner", '["agent-a"]', "ask"))
        # A draft keeps only an intent it can send.
        self.rejected(self.command("draft.save", {"source_ref": {"kind": "message", "id": sent["message_id"]}, "topic_id": "t1", "generation": "gA", "body": "x",
                                                  "attachments": [], "quotes": [], "addressees": [], "intent": "maybe"},
                                   target={"draft_id": "unsure"}, expected={"draft_revision": 0}), "INVALID_ARGUMENT")


class AskOrTellVerbCase(test_agent_verbs.AgentVerbCase):
    def message(self):
        return self.sql("SELECT author_id,body,addressees,intent FROM messages ORDER BY seq DESC LIMIT 1")[0]

    def test_post_asks_or_tells_the_people_it_names(self):
        code, out, err = self.run_cli("post", "t1", "--asks", "owner", "Which name do we ship?")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.message(), ("agent-a", "Which name do we ship?", '["owner"]', "ask"))
        code, out, err = self.run_cli("post", "t1", "--tells", "owner,agent-b", "Shipped.")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.message(), ("agent-a", "Shipped.", '["owner","agent-b"]', "tell"))
        # A message to nobody in particular says neither.
        self.assertEqual(self.run_cli("post", "t1", "For the topic")[0], 0)
        self.assertEqual(self.message(), ("agent-a", "For the topic", "[]", None))
        code, out, err = self.run_cli("read", "t1", "--after", "0")
        self.assertIn(" agent-a asks owner\n", out)
        self.assertIn(" agent-a tells owner, agent-b\n", out)

    def test_a_post_that_neither_asks_nor_tells_is_refused_before_anything_is_saved(self):
        before = self.records()
        for argv in (["post", "t1", "--to", "owner", "Hello"], ["post", "t1", "--asks", "owner", "--tells", "agent-b", "Both"]):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv)
                self.assertEqual((code, out), (2, ""))
                self.assertIn("INTENT_REQUIRED", err)
                self.assertIn("--asks", err)
                self.assertIn("--tells", err)
                code, out, err = self.run_cli("--json", *argv)
                self.assertEqual((code, json.loads(out)["error"]["code"]), (2, "INTENT_REQUIRED"))
        self.assertEqual(self.saved(), [])
        self.assertEqual(self.records(), before)


if __name__ == "__main__":
    unittest.main()

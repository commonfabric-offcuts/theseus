from __future__ import annotations

"""Writing from the page that starts with @names goes to exactly those members (item 329,
docs/reader.md "Naming who a message is to", aim_next/addressing.py).

The fixture outcome w1 is owned by owner (a person), with agent-a and agent-b
on its team and agent-a its coordinator; its topic t1 has owner and agent-a
taking part, and its conversation has owner and agent-a."""

import json
from pathlib import Path
import sqlite3
import unittest

import test_conversation

from aim_next import standing_conversation as standing


class AtNamesCase(test_conversation.ConversationCase):
    def page_reply(self, source_id, body, addressees=(), topic="t1"):
        """A reply written in the Reader about source_id (a fresh message of agent-a's when None),
        saved, frozen and sent as the page does."""
        if source_id is None:
            source_id = self.agent_message()
        key = "at-%s" % (self.serial + 1)
        source = {"kind": "message", "id": source_id}
        self.committed(self.command("draft.save", dict(
            {"source_ref": source, "topic_id": topic, "generation": "gA", "body": body,
             "attachments": [], "quotes": [], "addressees": list(addressees)},
            **({"intent": "tell"} if addressees else {})), target={"draft_id": key}, expected={"draft_revision": 0}))
        self.committed(self.prepare(key, topic, submission=key, send_op=key + "-send"))
        return self.committed(self.command("message.send", {"submission_id": key}, target={"topic_id": topic}, op=key + "-send"))["message_id"]

    def agent_message(self, topic="t1"):
        return self.committed(self.command("message.post", {"body": "Seen", "addressees": ["owner"], "intent": "tell"},
                                           target={"topic_id": topic}, actor="agent-a"))["message_id"]

    def topic_message(self, body, topic="t1"):
        """A message from the topic's composer (no message above it), sent as the page does."""
        key = "topic-%s" % (self.serial + 1)
        self.committed(self.command("draft.save", {"source_ref": {"kind": "topic", "id": topic}, "topic_id": topic, "generation": "gA",
                                                    "body": body, "attachments": [], "quotes": [], "addressees": []},
                                    target={"draft_id": key}, expected={"draft_revision": 0}))
        self.committed(self.prepare(key, topic, submission=key, send_op=key + "-send"))
        return self.committed(self.command("message.send", {"submission_id": key}, target={"topic_id": topic}, op=key + "-send"))["message_id"]

    def recorded(self, message_id):
        body, addressees, intent = self.sql("SELECT body,addressees,intent FROM messages WHERE id=?", (message_id,))[0]
        return body, json.loads(addressees), intent

    def addressed_deliveries(self, message_id):
        return sorted(row[0] for row in self.sql(
            "SELECT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id "
            "WHERE d.message_id=? AND r.reason='addressed'", (message_id,)))

    def test_a_reply_that_starts_with_a_members_name_goes_to_them_and_they_answer_it_in_place(self):
        # Tony's case: a reply to fable's message, starting "@auditor", in the outcome's conversation.
        status = self.posted("The wake check is in.", actor="agent-a")
        words = "@agent-b can you reply here when your tool for watching this topic is running?"
        reply = self.page_reply(status, words, addressees=["agent-a"], topic=self.conversation)
        # agent-b answers it where it was asked (the refusal Tony hit), and it was recorded to agent-b alone.
        self.committed(self.post("It is running now.", actor="agent-b", reply_to=reply, addressees=["owner"], intent="tell"))
        self.assertEqual(self.recorded(reply), (words, ["agent-b"], "tell"), "to agent-b alone, the words as written, a tell as the page said")
        self.assertEqual(self.addressed_deliveries(reply), ["agent-b"])
        # agent-a, the author it answered, is not named, and is refused as for any item not addressed to it.
        self.assertEqual(self.refusal(self.post("Me too", actor="agent-a", reply_to=reply), standing.NOT_THE_ANSWERER),
                         "agent-b answers this one; you answer here only when you are named")

    def test_a_reply_in_a_topic_goes_to_the_named_members_in_any_case_and_the_writer_is_not_one(self):
        # agent-b is on the team, not in the topic: still a member a message can go to.
        reply = self.page_reply(None, "  @AGENT-B, @agent-a: both of you, please", addressees=["agent-a"])
        self.assertEqual(self.recorded(reply)[1:], (["agent-b", "agent-a"], "tell"))
        self.assertEqual(self.addressed_deliveries(reply), ["agent-a", "agent-b"])
        # A name, as well as an id, names a member; a name ending in "." or followed by "!" still does.
        self.sql_write("UPDATE actors SET name='Builder' WHERE id='agent-b'")
        self.assertEqual(self.recorded(self.page_reply(None, "@builder. Over to you", addressees=["agent-a"]))[1], ["agent-b"])
        self.assertEqual(self.recorded(self.page_reply(None, "@agent-b! Look", addressees=["agent-a"]))[1], ["agent-b"])
        # The topic's composer, which names nobody by default, names the members too.
        self.assertEqual(self.recorded(self.topic_message("@agent-b see above"))[1:], (["agent-b"], "tell"))

    def test_an_at_word_that_names_no_member_is_plain_text_and_the_default_stands(self):
        cases = (("nobody by that name", "@nobody hello"), ("an actor outside the outcome", "@outsider hello"),
                 ("the writer", "@owner note to self"), ("not a word on its own", "@agent-b's tool is down"),
                 ("not at the start", "Hello @agent-b"), ("an e-mail address", "agent-b@example.com"),
                 ("a member after a name that is not", "@nobody @agent-b hello"))
        for name, body in cases:
            with self.subTest(case=name):
                self.assertEqual(self.recorded(self.page_reply(None, body, addressees=["agent-a"])), (body, ["agent-a"], "tell"))
        # A name stops the run where the next word names nobody: what follows is plain text.
        self.assertEqual(self.recorded(self.page_reply(None, "@agent-b @nobody @agent-a hi", addressees=["agent-a"]))[1], ["agent-b"])
        # A switched-off member is no one to send to.
        self.sql_write("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.assertEqual(self.recorded(self.page_reply(None, "@agent-b hello", addressees=["agent-a"]))[1], ["agent-a"])

    def test_without_a_leading_name_the_message_keeps_todays_addressee(self):
        self.assertEqual(self.recorded(self.page_reply(None, "Thanks", addressees=["agent-a"])), ("Thanks", ["agent-a"], "tell"))
        self.assertEqual(self.recorded(self.topic_message("To everyone")), ("To everyone", [], None))

    def test_an_agents_post_keeps_the_addressees_it_names(self):
        posted = self.committed(self.command("message.post", {"body": "@agent-b over to you", "addressees": ["owner"], "intent": "ask"},
                                             target={"topic_id": "t1"}, actor="agent-a"))["message_id"]
        self.assertEqual(self.recorded(posted)[1:], (["owner"], "ask"))

    def sql_write(self, statement):
        with sqlite3.connect(str(self.path)) as db:
            db.execute(statement)


class LeadingNamesRule(unittest.TestCase):
    """The rule itself, from the cases tests/ui_at_names.test.mjs reads too, so Core and the page agree word for word."""

    def test_the_leading_run_of_member_names(self):
        from aim_next import addressing
        with open(str(Path(__file__).resolve().parent / "fixtures" / "at_names.json"), encoding="utf-8") as cases:
            table = json.load(cases)
        members = [(member["id"], member["name"]) for member in table["members"]]
        for body, named in table["cases"]:
            with self.subTest(body=body):
                self.assertEqual(addressing.leading_names(body, members), named)


if __name__ == "__main__":
    unittest.main()

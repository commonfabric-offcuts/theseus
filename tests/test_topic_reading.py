from __future__ import annotations

"""How a topic page says the reader stands with each message: `unread`, `replied` and `awaiting_reply` (docs/topic-reading.md, items 31, 102, 103, 475).

The fixture outcome w1 is owned by owner, with agent-a and agent-b on its
team; its topic t1 has owner and agent-a taking part.
"""

import unittest

import reader_fixture as fixtures


class TopicReadingCase(fixtures.ReaderCase):
    def post(self, body="Words", actor="agent-a", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def page(self, actor="owner"):
        view = self.store.view(actor, "topic_messages", {"topic_id": "t1", "limit": 50})
        self.assertNotIn("error", view, view)
        return {item["id"]: item for item in view["items"]}

    def test_a_message_waiting_for_the_reader_is_unread_until_it_is_read_and_never_their_own(self):
        told = self.post("For you", addressees=["owner"], intent="tell")
        own = self.post("Mine", actor="owner")
        page = self.page()
        self.assertEqual((page[told]["unread"], page[own]["unread"]), (True, False))
        self.assertEqual(self.page("agent-a")[told]["unread"], False, "the author's own message is never unread to them")
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": told}, expected={"thumb_revision": 0}))
        self.assertEqual(self.page()[told]["unread"], False, "reading it, here by a thumb, settles it")

    def test_replied_names_the_readers_newest_reply_and_no_one_elses(self):
        asked = self.post("Which one?", addressees=["owner"], intent="ask")
        quiet = self.post("Nothing to answer")
        self.assertEqual(self.page()[asked]["replied"], None)
        self.post("By agent-b", actor="agent-b", reply_to=asked)
        self.assertEqual(self.page()[asked]["replied"], None, "someone else's reply is not the reader's")
        self.post("The first", actor="owner", reply_to=asked)
        newest = self.post("The second", actor="owner", reply_to=asked)
        self.assertEqual(self.page()[asked]["replied"], {"id": newest, "sent_ms": self.sql("SELECT sent_ms FROM messages WHERE id=?", (newest,))[0][0]})
        self.assertEqual((self.page()[quiet]["replied"], self.page("agent-b")[asked]["replied"]["id"] != newest), (None, True))

    def awaiting(self, actor="owner", topic="t1"):
        view = self.store.view(actor, "topic_messages", {"topic_id": topic, "limit": 50})
        self.assertNotIn("error", view, view)
        return {item["id"]: item["awaiting_reply"] for item in view["items"]}

    def test_the_readers_message_an_agent_received_waits_for_a_reply_until_anyone_else_replies_in_its_dossier(self):
        # Item 475: the Conversation's three dots on the reader's own message, from the first reply by anyone else.
        asked = self.post("Can you look?", actor="owner", addressees=["agent-a"], intent="ask")
        self.assertIs(self.awaiting()[asked], True, "an agent it is addressed to received it, and nobody has replied")
        self.assertIs(self.awaiting("agent-a")[asked], False, "only on the reader's own message")
        # The reader's own second message, in the same dossier, clears nothing, and waits itself.
        again = self.post("And this too", actor="owner", reply_to=asked)
        self.assertEqual((self.awaiting()[asked], self.awaiting()[again]), (True, True), "the reader's own reply clears nothing")
        # Someone else writing a new message, not in the dossier, is no reply to it.
        elsewhere = self.post("Something else", actor="agent-b")
        self.assertEqual((self.awaiting()[asked], self.awaiting()[again]), (True, True), "a message outside the dossier is no reply")
        self.assertIs(self.awaiting()[elsewhere], False, "someone else's message never waits for the reader")
        # The agent answers the first message: a reply after both, in their dossier, ends the wait on both.
        self.post("Looking now", actor="agent-a", reply_to=asked)
        self.assertEqual((self.awaiting()[asked], self.awaiting()[again]), (False, False), "a reply by someone else ends the wait")
        # The reader's next message waits again, and an earlier reply does not end it.
        later = self.post("Thanks, one more thing", actor="owner", reply_to=asked)
        self.assertIs(self.awaiting()[later], True, "a reply before it is no reply to it")

    def test_a_persons_reply_ends_the_wait_as_an_agents_does(self):
        self.participation("other-reader", True)
        asked = self.post("Over to you all", actor="owner")
        self.assertIs(self.awaiting()[asked], True, "agent-a takes part, switched on, so it received it")
        self.post("I'll answer", actor="other-reader", reply_to=asked)
        self.assertIs(self.awaiting()[asked], False, "a person's reply ends it too")

    def test_a_reply_to_it_in_another_stack_a_message_naming_the_reader_and_an_agents_thumbs_up_each_end_the_wait(self):
        # Item 475's words, "until the first reply from anyone else" (warp's ruling, codex #5267): an answer that is not
        # inside the message's dossier is a reply from someone else too.
        told = self.post("Can you look at the build?", actor="owner", addressees=["agent-a"], intent="ask")
        # agent-b answers in a subject of its own, telling the reader by name.
        self.post("Done: the build is green.", actor="agent-b", addressees=["owner"], intent="tell")
        aside = self.post("A subject of its own", actor="agent-b")
        joined = self.post("Can you check the notes?", actor="owner", addressees=["agent-a"], intent="ask")
        reply = self.post("Checked them.", actor="agent-a", reply_to=joined)
        # Someone joins agent-a's reply to another stack: it answers the message from outside its dossier.
        self.committed(self.command("stack.join", {"into": aside}, target={"message_id": reply}, expected={"join_revision": 0}))
        page = self.page()
        self.assertNotEqual(page[reply]["stack_position"]["root_id"], page[joined]["stack_position"]["root_id"],
                            "the fixture holds: the reply is in another stack")
        thumbed = self.post("And the release?", actor="owner", addressees=["agent-a"], intent="ask")
        thumb = lambda thumbed_up, revision: self.committed(self.command(
            "message.thumb", {"thumbed": thumbed_up}, target={"message_id": thumbed}, expected={"thumb_revision": revision}, actor="agent-a"))
        thumb(True, 0)
        waits = self.awaiting()
        for name, message in (("a tell naming the reader, in a subject of its own", told), ("a reply to it, in another stack", joined),
                              ("an agent's thumbs-up on it", thumbed)):
            with self.subTest(name):
                self.assertIs(waits[message], False, "%s is a reply from someone else: the wait ends" % name)
        # The first reply was given: taking the thumbs-up back starts no new wait.
        thumb(False, 1)
        self.assertIs(self.awaiting()[thumbed], False, "a thumbs-up taken back leaves the wait ended")

    def test_a_persons_thumbs_up_a_message_to_nobody_or_to_someone_else_and_an_agents_whisper_end_no_wait(self):
        self.participation("other-reader", True)
        # A message naming the reader before theirs is no reply to it.
        self.post("Earlier, for you", actor="agent-b", addressees=["owner"], intent="tell")
        asked = self.post("Can you look?", actor="owner", addressees=["agent-a"], intent="ask")
        # A person's thumbs-up says they read it and understand (docs/thumbs.md); it is no reply.
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": asked}, expected={"thumb_revision": 0},
                                    actor="other-reader"))
        self.post("Something for everyone", actor="agent-b")
        self.post("For agent-a only", actor="agent-b", addressees=["agent-a"], intent="tell")
        # The reader's whisper to agent-a, and agent-a's whispered answer to it, by name to the reader: it answers the
        # whisper, not the message on the record.
        whisper = self.committed(self.command("message.post", {"body": "Just you", "whisper": True, "addressees": ["agent-a"]},
                                              target={"topic_id": "t1"}))["message_id"]
        self.committed(self.command("message.post", {"body": "Just you too", "whisper": True, "addressees": ["owner"], "reply_to": whisper},
                                    target={"topic_id": "t1"}, actor="agent-a"))
        self.assertIs(self.awaiting()[asked], True, "none of these is a reply to it, nor agent-b's message to the reader before it")

    def test_a_message_from_before_this_release_never_waits_and_the_first_post_after_it_records_where_the_rule_begins(self):
        # Item 475's words, "after the reader posts" (codex #5267): nothing already in the store starts pulsing when this
        # ships. The release before this one never wrote where the rule begins; the store reads as it left it.
        old = self.post("Asked before the release", actor="owner", addressees=["agent-a"], intent="ask")
        self.sql("DELETE FROM metadata WHERE key='reply_wait_from_seq'")
        self.assertIs(self.awaiting()[old], False, "a message present before the release never starts waiting")
        new = self.post("Asked after it", actor="owner", addressees=["agent-a"], intent="ask")
        later = self.post("And this", actor="owner", addressees=["agent-a"], intent="ask")
        waits = self.awaiting()
        self.assertEqual((waits[old], waits[new], waits[later]), (False, True, True), "the rule holds from the first post after the release")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='reply_wait_from_seq'"),
                         [(str(self.sql("SELECT seq FROM messages WHERE id=?", (new,))[0][0]),)], "recorded once, by the first post")

    def test_no_wait_on_a_whisper_in_a_conversation_or_where_no_agent_received_it(self):
        whisper = self.committed(self.command("message.post", {"body": "Just you", "whisper": True, "addressees": ["agent-a"]},
                                              target={"topic_id": "t1"}))["message_id"]
        self.assertIs(self.awaiting()[whisper], False, "never on a whisper")
        # With agent-a gone from the topic, nobody but people receives a message with no addressee.
        self.participation("agent-a", False)
        self.participation("other-reader", True)
        alone = self.post("Notes to myself", actor="owner")
        to_person = self.post("For you", actor="owner", addressees=["other-reader"], intent="tell")
        to_agent = self.post("For agent-b", actor="owner", addressees=["agent-b"], intent="tell")
        page = self.awaiting()
        self.assertEqual((page[alone], page[to_person], page[to_agent]), (False, False, True),
                         "no agent received the first two; agent-b, addressed, received the third")
        # In an outcome's conversation an item already shows its own dots: no second wait there.
        conversation = self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        item = self.committed(self.command("message.post", {"body": "Where are we?"}, target={"topic_id": conversation}))["message_id"]
        self.assertIs(self.awaiting(topic=conversation)[item], False, "a conversation's item has its own dots")

    def test_a_correction_of_an_edit_is_no_receipt_only_the_first_revision_delivered_counts(self):
        # Item 475, B1: an edit queues a revision-2 correction to every agent that read the old words
        # (docs/message-edit.md); that is not the agent receiving the message.
        self.participation("agent-a", False)
        alone = self.post("Notes to myself", actor="owner")
        asked = self.post("For agent-b", actor="owner", addressees=["agent-b"], intent="tell")
        self.awaiting("agent-b")  # agent-b, on the team, reads the topic: it was handed both messages' words
        for message, words in ((alone, "Notes to myself, edited"), (asked, "For agent-b, edited")):
            self.committed(self.command("message.edit", {"body": words}, target={"message_id": message},
                                        expected={"message_revision": 1}))
        self.assertEqual(self.sql("SELECT revision FROM deliveries d JOIN actors a ON a.id=d.recipient_id "
                                  "WHERE d.message_id=? AND a.kind='agent'", (alone,)), [(2,)],
                         "the fixture holds: agent-b's only delivery of the first message is the edit's correction")
        page = self.awaiting()
        self.assertIs(page[alone], False, "a correction alone is no receipt: no agent received the first revision")
        self.assertIs(page[asked], True, "an agent handed the first revision received it, edited or not")

    def test_reading_the_wait_changes_nothing_stored(self):
        # A read records which words it handed (message_exposures, docs/message-edit.md), as every read does; the
        # records the wait is read from, and every act, stay as they were.
        asked = self.post("Can you look?", actor="owner", addressees=["agent-a"], intent="ask")
        stored = lambda: dict(self.public_state(), acts=self.sql("SELECT * FROM message_acts ORDER BY id"),
                              marks=self.sql("SELECT * FROM message_marks ORDER BY rowid"), summaries=self.sql("SELECT * FROM topic_summaries ORDER BY rowid"))
        before = stored()
        self.assertIs(self.awaiting()[asked], True)
        self.awaiting("agent-a")
        self.assertEqual(stored(), before, "showing the wait stores nothing")


if __name__ == "__main__":
    unittest.main()

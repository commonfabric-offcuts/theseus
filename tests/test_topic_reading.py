from __future__ import annotations

"""How a topic page says the reader stands with each message: `unread`, `replied` and `awaiting_reply` (docs/topic-reading.md, items 31, 102, 103, 475).

The fixture outcome w1 is owned by owner, with agent-a and agent-b on its
team; its topic t1 has owner and agent-a taking part.
"""

import sqlite3
import unittest
from unittest import mock

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

    # Item 127: a card shows the reader's own private note and saved, unsent reply on its message.
    def note(self, message, body, revision=0, actor="owner", note_id="n"):
        return self.committed(self.command("note.save", {"source_ref": {"kind": "message", "id": message}, "body": body},
                                           target={"note_id": note_id}, expected={"note_revision": revision}, actor=actor))

    def draft(self, message, body, revision=0, actor="owner", draft_id="d", **extra):
        return self.committed(self.command("draft.save", dict(dict(source_ref={"kind": "message", "id": message}, topic_id="t1", body=body,
                              generation="gA", attachments=[], quotes=[], addressees=[]), **extra), target={"draft_id": draft_id},
                              expected={"draft_revision": revision}, actor=actor))

    def marks(self, message, actor="owner"):
        yours = self.page(actor)[message]["yours"]
        return yours["note"], yours["reply"]

    def test_your_note_is_the_readers_own_private_note_with_words_and_no_one_elses(self):
        message, other = self.post("Read me"), self.post("Another")
        self.assertEqual(self.marks(message), (False, False))
        self.note(message, "Their note", actor="agent-a", note_id="theirs")
        self.assertEqual(self.marks(message), (False, False), "another reader's note is theirs alone")
        self.assertEqual(self.marks(message, "agent-a"), (True, False))
        self.note(message, "Remember this")
        self.assertEqual((self.marks(message), self.marks(other)), ((True, False), (False, False)))
        self.note(message, "  \n ", revision=1)
        self.assertEqual(self.marks(message), (False, False), "a note emptied of words is no note")

    def test_your_reply_is_the_readers_own_saved_writing_until_its_send_is_accepted(self):
        message = self.post("Answer me")
        self.draft(message, "Their reply", actor="agent-a", draft_id="theirs")
        self.assertEqual(self.marks(message), (False, False), "another reader's saved reply is theirs alone")
        self.assertEqual(self.marks(message, "agent-a"), (False, True))
        self.draft(message, " ", addressees=["agent-a"], intent="tell")
        self.assertEqual(self.marks(message), (False, False), "a reply with no words or images is not saved writing")
        self.draft(message, "My answer", revision=1)
        self.assertEqual(self.marks(message), (False, True))
        self.committed(self.prepare("d", "t1", revision=2, submission="s-reply", send_op="send-reply"))
        self.assertEqual(self.marks(message), (False, True), "a reply prepared to send has not been sent")
        self.committed(self.command("message.send", {"submission_id": "s-reply"}, target={"topic_id": "t1"}, op="send-reply"))
        self.assertEqual(self.marks(message), (False, False), "a reply whose send was accepted is no longer saved writing")
        self.assertEqual(self.marks(message, "agent-a"), (False, True), "the person's send leaves another reader's reply theirs")

    def test_a_reply_whose_send_is_refused_keeps_its_mark_and_only_an_accepted_send_takes_it(self):
        message = self.post("Answer me")
        yours = lambda actor="owner": self.sql("SELECT version FROM changes WHERE scope_kind='actor' AND scope_id=? AND resource_kind='yours' AND resource_id=? ORDER BY seq", (actor, message))
        self.draft(message, "My answer")
        self.committed(self.prepare("d", "t1", revision=1, submission="s-mine", send_op="send-mine"))
        # The authority changed between the preparation and the send: the send is refused, and the reply did not send.
        stale = {"v": 1, "instance_id": "test-instance", "operation_id": "send-mine", "kind": "message.send", "target": {"topic_id": "t1"},
                 "expected": {"authority": dict(self.pin, authority_epoch="an-earlier-epoch")}, "args": {"submission_id": "s-mine"}}
        self.rejected(self.store.command("owner", stale), "AUTHORITY_CHANGED")
        self.assertEqual(self.marks(message), (False, True), "a reply whose send was refused keeps its mark")
        refused = yours()
        # Accepted, the same reply's mark goes, and the person's own changes say so with a newer version.
        self.committed(self.command("message.send", {"submission_id": "s-mine"}, target={"topic_id": "t1"}, op="send-mine"))
        self.assertEqual(self.marks(message), (False, False), "an accepted send takes the mark away")
        self.assertEqual((len(yours()), yours()[-1] > refused[-1]), (len(refused) + 1, True), "the accepted send tells the writer's changes")
        self.assertEqual(self.page()[message]["yours"]["version"], yours()[-1][0])

        # Another person leaves the topic between preparing a reply and sending it: refused, its mark is there when
        # they come back, and the reply prepared again from it and accepted takes it away.
        self.participation("other-reader", True)
        theirs = self.post("Answer me too")
        self.draft(theirs, "Their answer", actor="other-reader", draft_id="o")
        prepared = self.committed(self.command("submission.prepare", {"draft_id": "o", "submission_id": "s-left", "send_operation_id": "send-left"},
                                               target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="other-reader"))
        self.participation("other-reader", False)
        self.rejected(self.command("message.send", {"submission_id": "s-left"}, target={"topic_id": "t1"}, actor="other-reader", op="send-left"), "FORBIDDEN")
        self.participation("other-reader", True)
        self.assertEqual(self.marks(theirs, "other-reader"), (False, True), "a reply refused when its writer left the topic keeps its mark")
        self.draft(theirs, "Their answer", revision=2, actor="other-reader", draft_id="o", generation=prepared["next_draft"]["generation"])
        self.committed(self.command("submission.prepare", {"draft_id": "o", "submission_id": "s-again", "send_operation_id": "send-again"},
                                    target={"topic_id": "t1"}, expected={"draft_revision": 3}, actor="other-reader"))
        self.assertEqual(self.marks(theirs, "other-reader"), (False, True))
        self.committed(self.command("message.send", {"submission_id": "s-again"}, target={"topic_id": "t1"}, actor="other-reader", op="send-again"))
        self.assertEqual(self.marks(theirs, "other-reader"), (False, False), "the reply sent again, accepted, answers for the refused one")

    def test_a_saved_reply_holding_only_an_image_is_saved_writing(self):
        message = self.post("Show me")
        self.committed(self.command("media.begin", {"name": "shot.png", "content_type": "image/png", "size_bytes": 4, "sha256": "0" * 64,
                                                    "publish_operation_id": "shot-publish"}, target={"media_id": "shot"}, expected={"media_revision": 0}))
        self.draft(message, "", attachments=[{"id": "shot"}])
        self.assertEqual(self.marks(message), (False, True))

    def test_private_writing_on_a_message_tells_only_its_writers_own_changes_with_a_growing_version(self):
        message = self.post("Changes")
        yours = lambda actor="owner": self.sql("SELECT resource_id,version FROM changes WHERE scope_kind='actor' AND scope_id=? AND resource_kind='yours' ORDER BY seq", (actor,))
        self.note(message, "One")
        self.draft(message, "Two")
        self.draft(message, "Three", revision=1)
        self.committed(self.prepare("d", "t1", revision=2, submission="s-changes", send_op="send-changes"))
        versions = [version for _, version in yours()]
        self.assertEqual([mid for mid, _ in yours()], [message] * 4)
        self.assertEqual(versions, sorted(set(versions)), "each change is newer than the one before")
        self.assertEqual(self.page()[message]["yours"]["version"], versions[-1], "a page's item says the version its change names")
        self.note(message, "Theirs", actor="agent-a", note_id="theirs")
        self.assertEqual((len(yours()), len(yours("agent-a"))), (4, 1), "another's writing tells only their changes")
        self.save_draft("topic-draft", {"kind": "topic", "id": "t1"}, "t1", "To the topic")
        self.assertEqual(len(yours()), 4, "writing to the topic itself is on no message")

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
        self.assertIs(self.awaiting()[told], False, "a tell naming the reader ends the wait, the newest message in the topic too")
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
        self.post("For agent-a only", actor="agent-b", addressees=["agent-a"], intent="tell")
        # The reader's whisper to agent-a, and agent-a's whispered answer to it, by name to the reader: it answers the
        # whisper, not the message on the record.
        whisper = self.committed(self.command("message.post", {"body": "Just you", "whisper": True, "addressees": ["agent-a"]},
                                              target={"topic_id": "t1"}))["message_id"]
        self.committed(self.command("message.post", {"body": "Just you too", "whisper": True, "addressees": ["owner"], "reply_to": whisper},
                                    target={"topic_id": "t1"}, actor="agent-a"))
        # A message to everyone after the whispers, so the reads reach past them.
        self.post("Something for everyone", actor="agent-b")
        self.assertIs(self.awaiting()[asked], True, "none of these is a reply to it, nor agent-b's message to the reader before it")

    def test_reading_whether_a_message_waits_does_no_more_work_as_the_topic_grows_after_it(self):
        # Reads are scoped and paged: messages after the page, here the reader's own naming themselves, as
        # test_stepping_correction grows them, add no work to reading whether a message on the page waits.
        self.post("Earlier, from agent-a", actor="agent-a")
        asked = self.post("Can you look?", actor="owner", addressees=["agent-a"], intent="ask")
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        def work():
            original, steps = sqlite3.connect, [0]
            def connect(*args, **kwargs):
                db = original(*args, **kwargs)
                db.set_progress_handler(lambda: steps.__setitem__(0, steps[0] + 1) or 0, 1)
                return db
            with mock.patch.object(sqlite3, "connect", connect):
                view = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "cursor": seq + 1, "limit": 1})
            self.assertEqual([(item["id"], item["awaiting_reply"]) for item in view["items"]], [(asked, True)], view)
            return steps[0]
        before = work()
        with sqlite3.connect(str(self.path)) as db:
            for index in range(3000):
                row = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                                 "VALUES (?,'t1','owner','Later','[]','[]','[\"owner\"]',?)", ("later-%s" % index, "later-op-%s" % index)).lastrowid
                db.execute("INSERT INTO message_addressees VALUES ('t1','owner',?)", (row,))
        grown = work()
        self.assertLess(grown, before + 300, (before, grown))

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

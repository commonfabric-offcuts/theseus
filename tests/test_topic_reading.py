from __future__ import annotations

"""How a topic page says the reader stands with each message: `unread` and `replied` (docs/topic-reading.md, items 31, 102, 103).

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

    # Item 127: a card shows the reader's own private note and saved, unsent reply on its message.
    def note(self, message, body, revision=0, actor="owner", note_id="n"):
        return self.committed(self.command("note.save", {"source_ref": {"kind": "message", "id": message}, "body": body},
                                           target={"note_id": note_id}, expected={"note_revision": revision}, actor=actor))

    def draft(self, message, body, revision=0, actor="owner", draft_id="d", **extra):
        return self.committed(self.command("draft.save", dict(dict(source_ref={"kind": "message", "id": message}, topic_id="t1", body=body,
                              generation="gA", attachments=[], quotes=[], addressees=[]), **extra), target={"draft_id": draft_id},
                              expected={"draft_revision": revision}, actor=actor))

    def marks(self, message, actor="owner"):
        item = self.page(actor)[message]
        return item["your_note"], item["your_reply"]

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

    def test_your_reply_is_the_readers_own_saved_writing_until_it_is_prepared(self):
        message = self.post("Answer me")
        self.draft(message, "Their reply", actor="agent-a", draft_id="theirs")
        self.assertEqual(self.marks(message), (False, False), "another reader's saved reply is theirs alone")
        self.assertEqual(self.marks(message, "agent-a"), (False, True))
        self.draft(message, " ", addressees=["agent-a"], intent="tell")
        self.assertEqual(self.marks(message), (False, False), "a reply with no words or images is not saved writing")
        self.draft(message, "My answer", revision=1)
        self.assertEqual(self.marks(message), (False, True))
        self.committed(self.prepare("d", "t1", revision=2, submission="s-reply", send_op="send-reply"))
        self.assertEqual(self.marks(message), (False, False), "a reply on its way is no longer saved writing")

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
        self.note(message, "Theirs", actor="agent-a", note_id="theirs")
        self.assertEqual((len(yours()), len(yours("agent-a"))), (4, 1), "another's writing tells only their changes")
        self.save_draft("topic-draft", {"kind": "topic", "id": "t1"}, "t1", "To the topic")
        self.assertEqual(len(yours()), 4, "writing to the topic itself is on no message")


if __name__ == "__main__":
    unittest.main()

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


if __name__ == "__main__":
    unittest.main()

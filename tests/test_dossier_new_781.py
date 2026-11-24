from __future__ import annotations

"""The header act's existing Core protocol, on isolated records only."""
import unittest
import reader_fixture as fixtures
from tests.historical_fixture import post_fields


class DossierNewCase(fixtures.ReaderCase):
    def post(self, body, reply_to=None, actor="agent-a", **extra):
        args = dict(body=body, addressees=["owner"], intent="tell", **extra)
        if reply_to:
            args["reply_to"] = reply_to
        return self.committed(self.command("message.post", post_fields(self, actor, args), {"topic_id": "t1"}, actor=actor))["message_id"]

    def unread(self):
        return {item["id"] for item in self.store.view("owner", "topic_messages", {"topic_id": "t1", "limit": 50})["items"] if item["unread"]}

    def test_exact_selected_message_settles_real_deliveries_and_keeps_neighbours_and_writing(self):
        head = self.post("Head exact words")
        older = self.post("Older exact words", head)
        newest = self.post("Newest exact words", head)
        foreign = self.post("Another dossier")
        self.committed(self.command("draft.save", {"source_ref": {"kind": "topic", "id": "t1"}, "topic_id": "t1", "body": "Unsent\nexact words", "generation": "gA", "attachments": [], "quotes": [], "addressees": ["agent-a"]},
                                    {"draft_id": "retained"}, {"draft_revision": 0}))
        before = self.sql("SELECT * FROM drafts"), self.sql("SELECT * FROM messages ORDER BY seq")
        self.assertTrue({head, older, newest, foreign}.issubset(self.unread()))
        for selected in [newest, older, head]:
            seq = self.sql("SELECT seq FROM messages WHERE id=?", (selected,))[0][0]
            envelope = self.envelope("topic.read_through", {"topic_id": "t1"}, {"from_seq": seq, "seq": seq})
            pending = self.unread()
            result = self.committed(self.store.command("owner", envelope))
            self.assertGreater(result["acknowledged"], 0, "actual pending deliveries must be mutated")
            self.assertEqual(self.unread(), pending - {selected}, "one message, never a neighbouring range")
            self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='owner' AND message_id=? AND state='pending'", (selected,)), [(0,)])
            self.assertEqual(self.store.command("owner", envelope)["result"], result, "an exact retry returns the original result")
        self.assertEqual(before, (self.sql("SELECT * FROM drafts"), self.sql("SELECT * FROM messages ORDER BY seq")))
        self.assertIn(foreign, self.unread())

    def test_mark_clear_is_separate_fenced_act_and_other_readers_keep_their_state(self):
        head = self.post("Marked head")
        self.participation("other-reader", True)
        message = self.post("Marked latest reply", head)
        for actor in ["owner", "other-reader"]:
            self.committed(self.command("message.mark", {"marked": True}, {"message_id": message}, {"mark_revision": 0}, actor=actor))
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0]
        self.committed(self.command("topic.read_through", {"from_seq": seq, "seq": seq}, {"topic_id": "t1"}))
        self.assertEqual(self.sql("SELECT revision FROM message_marks WHERE actor_id='owner' AND message_id=?", (message,)), [(1,)])
        # A later mark wins over the captured first revision, even after a delivery read.
        self.committed(self.command("message.mark", {"marked": True}, {"message_id": message}, {"mark_revision": 1}))
        self.rejected(self.command("message.mark", {"marked": False}, {"message_id": message}, {"mark_revision": 1}), "REVISION_CONFLICT")
        self.committed(self.command("message.mark", {"marked": False}, {"message_id": message}, {"mark_revision": 3}))
        self.assertEqual(self.sql("SELECT actor_id,revision FROM message_marks WHERE message_id=? ORDER BY actor_id", (message,)), [("other-reader", 1), ("owner", 4)])
        before = self.sql("SELECT * FROM deliveries"), self.sql("SELECT * FROM message_marks")
        self.rejected(self.command("topic.read_through", {"from_seq": seq, "seq": seq}, {"topic_id": "t1"}, actor="outsider"), "FORBIDDEN")
        self.assertEqual(before, (self.sql("SELECT * FROM deliveries"), self.sql("SELECT * FROM message_marks")))

    def test_native_head_fixture_has_one_new_head_and_a_read_reply_between_others(self):
        head = self.post("Head for fixture reader")
        reply = self.committed(self.command("message.post", post_fields(self, "agent-b", {"body": "Between other agents", "reply_to": head,
            "addressees": ["agent-a"], "intent": "tell"}), {"topic_id": "t1"}, actor="agent-b"))["message_id"]
        self.assertIn(head, self.unread())
        self.assertNotIn(reply, self.unread(), "native head/stale fixture must start with only the head New")


if __name__ == "__main__":
    unittest.main()

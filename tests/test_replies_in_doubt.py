from __future__ import annotations

import unittest

from reader_fixture import ReaderCase

TOPIC = {"kind": "topic", "id": "t1"}


class RepliesInDoubt(ReaderCase):
    """Core's answer to which of a person's replies may be in doubt (docs/replies-in-doubt.md)."""

    def reply(self, index, sent=True):
        state = self.store.view("owner", "editor_state", {"source_ref": TOPIC, "topic_id": "t1"})
        draft = state["draft"]
        draft_id, revision, generation = (draft["id"], draft["revision"], draft["generation"]) if draft else ("td", 0, "gA")
        self.committed(self.save_draft(draft_id, TOPIC, "t1", "Message %d" % index, revision=revision, generation=generation))
        prepared = self.committed(self.prepare(draft_id, "t1", revision=revision + 1, submission="sub-%02d" % index, send_op="send-%02d" % index))
        if sent:
            self.committed(self.command("message.send", {"submission_id": "sub-%02d" % index}, target={"topic_id": "t1"}, op="send-%02d" % index))
        return prepared

    def page(self, view="editor_state", **args):
        answer = self.store.view("owner", view, dict({"source_ref": TOPIC, "topic_id": "t1", "limit": 20}, **args))
        self.assertNotIn("error", answer, answer)
        return answer["submissions"] if view == "editor_state" else answer

    def test_the_replies_not_sent_are_listed_whole_however_many_went(self):
        # Twenty replies went from the topic's composer, then one was prepared
        # and its send never landed (as from another device).
        seqs = [self.reply(index, sent=index < 20).get("seq") for index in range(21)]
        self.assertTrue(all(isinstance(seq, int) for seq in seqs), "each prepare answers its reply's place: %r" % seqs)
        self.assertEqual(seqs, sorted(seqs), "in order")
        self.assertEqual(len(set(seqs)), 21)
        for view in ("editor_state", "submissions"):
            page = self.page(view, unsent=True)
            self.assertEqual([(item["id"], item["send_status"]) for item in page["items"]], [("sub-20", "unknown")], view)
            self.assertIsNone(page["next_cursor"], view)
            self.assertEqual(page["through"], seqs[-1], view)
        # Without unsent the list is every reply, oldest first, as before.
        everything = self.page()
        self.assertEqual([item["id"] for item in everything["items"]], ["sub-%02d" % index for index in range(20)])
        self.assertIsNotNone(everything["next_cursor"])
        self.assertEqual(everything["through"], seqs[-1])

    def test_through_is_the_last_reply_a_read_could_see(self):
        self.assertEqual(self.page(unsent=True), {"instance_id": "test-instance", "items": [], "next_cursor": None, "through": 0})
        first = self.reply(0).get("seq")
        self.assertEqual(self.page(unsent=True), {"instance_id": "test-instance", "items": [], "next_cursor": None, "through": first},
                         "a reply that went is not listed, and the read could see it")
        second = self.reply(1, sent=False).get("seq")
        page = self.page(unsent=True)
        self.assertEqual(([item["id"] for item in page["items"]], page["through"]), (["sub-01"], second))
        self.assertGreater(second, first)

    def test_a_long_list_of_replies_not_sent_is_paged(self):
        for index in range(3):
            self.reply(index, sent=index == 1)
        first = self.page(unsent=True, limit=1)
        self.assertEqual([item["id"] for item in first["items"]], ["sub-00"])
        self.assertIsNotNone(first["next_cursor"])
        rest = self.page("submissions", unsent=True, limit=1, cursor=first["next_cursor"])
        self.assertEqual([item["id"] for item in rest["items"]], ["sub-02"], "the reply that went is skipped")
        self.assertIsNone(rest["next_cursor"])

    def test_unsent_is_true_or_false(self):
        for value in ("yes", 1, None):
            for view in ("editor_state", "submissions"):
                answer = self.store.view("owner", view, {"source_ref": TOPIC, "topic_id": "t1", "unsent": value})
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", (view, value, answer))


if __name__ == "__main__":
    unittest.main()

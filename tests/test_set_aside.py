from __future__ import annotations

import sqlite3
import unittest

from reader_fixture import ReaderCase

TOPIC = {"kind": "topic", "id": "t1"}


class SetAside(ReaderCase):
    """A reply in doubt set aside by its own author (item 548, docs/replies-in-doubt.md)."""

    def reply(self, index, sent=False):
        state = self.store.view("owner", "editor_state", {"source_ref": TOPIC, "topic_id": "t1"})
        draft = state["draft"]
        draft_id, revision, generation = (draft["id"], draft["revision"], draft["generation"]) if draft else ("td", 0, "gA")
        self.committed(self.save_draft(draft_id, TOPIC, "t1", "Message %d" % index, revision=revision, generation=generation))
        self.committed(self.prepare(draft_id, "t1", revision=revision + 1, submission="sub-%02d" % index, send_op="send-%02d" % index))
        if sent:
            self.committed(self.command("message.send", {"submission_id": "sub-%02d" % index}, target={"topic_id": "t1"}, op="send-%02d" % index))
        return "sub-%02d" % index

    def aside(self, submission, aside=True, actor="owner", op=None):
        self.serial += 1
        return self.command("submission.set_aside", {"submission_id": submission, "aside": aside}, actor=actor,
                            op=op or "aside:%s:%d" % (submission, self.serial))

    def unsent(self, actor="owner"):
        ids = {}
        for view in ("editor_state", "submissions"):
            answer = self.store.view(actor, view, {"source_ref": TOPIC, "topic_id": "t1", "limit": 20, "unsent": True})
            self.assertNotIn("error", answer, answer)
            page = answer["submissions"] if view == "editor_state" else answer
            ids[view] = [item["id"] for item in page["items"]]
        self.assertEqual(ids["editor_state"], ids["submissions"])
        return ids["submissions"]

    def test_a_reply_set_aside_leaves_the_unsent_list_and_undo_puts_it_back(self):
        first, second = self.reply(0), self.reply(1)
        self.assertEqual(self.unsent(), [first, second])
        result = self.committed(self.aside(first))
        self.assertEqual(result, {"submission_id": first, "aside": True, "changed": True})
        self.assertEqual(self.unsent(), [second], "set aside, it is not in doubt; the other reply still is")
        self.committed(self.aside(first, aside=False))
        self.assertEqual(self.unsent(), [first, second], "Undo puts it back in doubt")

    def test_the_reply_and_its_words_stay_as_they_were(self):
        first = self.reply(0)
        before = self.sql("SELECT * FROM submissions ORDER BY seq")
        words = self.store.view("owner", "submission", {"submission_id": first})
        self.committed(self.aside(first))
        self.assertEqual(self.sql("SELECT * FROM submissions ORDER BY seq"), before, "no submission row changes")
        after = self.store.view("owner", "submission", {"submission_id": first})
        self.assertEqual(after, words, "its words are kept, and the view of it keeps its shape")

    def test_setting_aside_twice_changes_nothing_more(self):
        first = self.reply(0)
        self.committed(self.aside(first))
        again = self.committed(self.aside(first))
        self.assertEqual(again, {"submission_id": first, "aside": True, "changed": False})
        self.assertEqual(self.unsent(), [])
        # The same operation again answers its first receipt and records nothing new.
        op = "aside:%s:same" % first
        receipt = self.aside(first, aside=False, op=op)
        self.assertEqual(self.aside(first, aside=False, op=op), receipt)
        self.assertEqual(self.unsent(), [first])

    def test_only_the_replys_author_can_set_it_aside(self):
        first = self.reply(0)
        self.rejected(self.aside(first, actor="other-reader"), "FORBIDDEN")
        self.assertEqual(self.unsent(), [first], "another reader's act changes nothing")

    def test_a_reply_that_went_cannot_be_set_aside(self):
        sent, unsent = self.reply(0, sent=True), self.reply(1)
        self.rejected(self.aside(sent), "ALREADY_SENT")
        self.rejected(self.aside(sent, aside=False), "ALREADY_SENT")
        self.assertEqual(self.unsent(), [unsent])

    def test_a_reply_set_aside_whose_send_then_lands_is_simply_sent(self):
        first = self.reply(0)
        self.committed(self.aside(first))
        self.committed(self.command("message.send", {"submission_id": first}, target={"topic_id": "t1"}, op="send-00"))
        self.assertEqual(self.unsent(), [])
        self.rejected(self.aside(first, aside=False), "ALREADY_SENT")
        self.assertEqual(self.unsent(), [], "Undo cannot bring a sent reply back into doubt")

    def test_the_operation_names_the_reply_and_the_arguments_are_exact(self):
        first = self.reply(0)
        self.rejected(self.aside(first, op="plain-op"), "INVALID_ARGUMENT")
        self.rejected(self.aside(first, op="aside:%s:" % first), "INVALID_ARGUMENT")
        self.rejected(self.aside(first, op="aside:sub-01:x"), "INVALID_ARGUMENT")
        self.rejected(self.command("submission.set_aside", {"submission_id": first, "aside": 1}, op="aside:%s:n" % first), "INVALID_ARGUMENT")
        self.rejected(self.command("submission.set_aside", {"submission_id": first}, op="aside:%s:m" % first), "INVALID_ARGUMENT")
        self.rejected(self.command("submission.set_aside", {"submission_id": first, "aside": True}, target={"topic_id": "t1"},
                                   op="aside:%s:t" % first), "INVALID_ARGUMENT")
        self.assertEqual(self.unsent(), [first])

    def test_a_reply_whose_id_begins_another_s_is_not_set_aside_with_it(self):
        # aside:sub: begins aside:sub:1:..., so the read matches the id the operation names exactly.
        state = self.store.view("owner", "editor_state", {"source_ref": TOPIC, "topic_id": "t1"})
        self.assertIsNone(state["draft"])
        for submission, revision in (("sub", 0), ("sub:1", 2)):
            generation = "gA" if revision == 0 else self.store.view("owner", "editor_state", {"source_ref": TOPIC, "topic_id": "t1"})["draft"]["generation"]
            self.committed(self.save_draft("td", TOPIC, "t1", submission, revision=revision, generation=generation))
            self.committed(self.prepare("td", "t1", revision=revision + 1, submission=submission, send_op="send-" + submission))
        self.committed(self.aside("sub:1"))
        self.assertEqual(self.unsent(), ["sub"])
        self.committed(self.aside("sub"))
        self.committed(self.aside("sub:1", aside=False))
        self.assertEqual(self.unsent(), ["sub:1"])

    def test_no_schema_step(self):
        first = self.reply(0)
        with sqlite3.connect(str(self.path)) as db:
            tables = db.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall()
        self.committed(self.aside(first))
        with sqlite3.connect(str(self.path)) as db:
            self.assertEqual(db.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall(), tables)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

from test_question_withdrawal import WithdrawalCase


class WithdrawalDecisionCase(WithdrawalCase):
    def go_question(self):
        return self.committed(self.command("message.post", {
            "body": "May I continue this synthetic work?", "intent": "ask", "go_ahead": True,
            "addressees": ["owner"], "ask_wait": {"root_id": None, "cover_revision": 0,
                "questions": [{"actor_id": "owner", "text": "May I continue?", "options": ["Yes", "No"],
                               "default": "No", "reason": None}]}},
            target={"topic_id": "t1"}, actor="agent-a"))["message_id"]

    def answer(self, ask, value, revision=0, op=None):
        return self.command("message.answer", {"answer": value}, target={"message_id": ask},
                            expected={"answer_revision": revision}, op=op)

    def database_records(self):
        names = self.sql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return {name: self.sql('SELECT * FROM "' + name + '" ORDER BY rowid') for (name,) in names}

    def test_withdrawn_go_ahead_decisions_record_nothing_and_words_reply_remains(self):
        ask = self.go_question()
        self.committed(self.withdraw(ask))
        before = self.database_records()
        for value in ("yes", "no"):
            with self.subTest(answer=value):
                operation = "withdrawn-decision-" + value
                refused = self.answer(ask, value, op=operation)
                self.rejected(refused, "QUESTION_WITHDRAWN")
                self.assertFalse(refused["recorded"])
                self.assertFalse(refused["error"]["retryable"])
                self.assertEqual(self.answer(ask, value, op=operation), refused)
                self.assertEqual(self.sql("SELECT * FROM message_reactions WHERE message_id=? AND kind='answer'", (ask,)), [])
                self.assertEqual(self.sql("SELECT id FROM messages WHERE reply_to=?", (ask,)), [])
                self.assertEqual(self.database_records(), before, "no receipt, health, delivery, mark or other side effect")
        words = self.committed(self.command("message.post", {"body": "A later reply in words is retained", "reply_to": ask},
                                            target={"topic_id": "t1"}))["message_id"]
        self.assertEqual(self.sql("SELECT id,body FROM messages WHERE reply_to=?", (ask,)),
                         [(words, "A later reply in words is retained")])
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.sql("SELECT active FROM ask_cover_links WHERE ask_id=?", (ask,)), [(0,)])

    def test_old_decision_receipt_replays_but_a_new_decision_cannot_change_the_record(self):
        ask = self.go_question()
        committed = self.answer(ask, "yes", op="decision-before-withdrawal")
        self.committed(committed)
        self.committed(self.withdraw(ask))
        before = self.database_records()
        self.assertEqual(self.answer(ask, "yes", op="decision-before-withdrawal"), committed)
        self.assertEqual(self.database_records(), before)
        for revision in (0, 1):
            refused = self.answer(ask, "no", revision=revision, op="late-decision-%d" % revision)
            self.rejected(refused, "QUESTION_WITHDRAWN")
            self.assertFalse(refused["recorded"])
            self.assertEqual(self.database_records(), before)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(WithdrawalDecisionCase(name) for name in loader.getTestCaseNames(WithdrawalDecisionCase)
                              if name in WithdrawalDecisionCase.__dict__)

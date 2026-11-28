from __future__ import annotations

from aim_next.questions import EXACT_REPLY_START
from test_conversation import ConversationCase


class ExactAskRepliesCase(ConversationCase):
    def open_asks(self, topic="t1", actor="agent-a"):
        return [ask["message_id"] for ask in self.store.view(actor, "topic", {"topic_id": topic})["topic"]["asks"]
                if ask["actor_id"] == actor]

    def question(self, mid, actor="owner"):
        return self.source({"kind": "message", "id": mid}, actor=actor)["question"]

    def test_unrelated_writing_and_other_authors_leave_the_asks_open(self):
        self.participation("agent-b", True)
        first = self.posted("First question?", topic="t1", intent="ask", addressees=["agent-a"])
        second = self.posted("Second question?", topic="t1", intent="ask", addressees=["agent-a"])
        self.posted("Unrelated answer.", topic="t1", actor="agent-a", reply_to=self.opening["id"])
        self.posted("Reply from a different agent.", topic="t1", actor="agent-b", reply_to=first)
        self.assertEqual(self.open_asks(), [first, second])

    def test_newer_exact_answer_is_idempotent_and_leaves_oldest_wait(self):
        first = self.posted("First question?", topic="t1", intent="ask", addressees=["agent-a"])
        second = self.posted("Second question?", topic="t1", intent="ask", addressees=["agent-a"])
        args = {"body": "Second answer.", "reply_to": second, "reply_without_quote": "The whole fixture question."}
        def send():
            return self.command("message.post", args, target={"topic_id": "t1"}, actor="agent-a", op="exact-second")
        receipt = send()
        answer = self.committed(receipt)["message_id"]
        self.assertEqual(send(), receipt)
        self.assertEqual(self.open_asks(), [first])
        self.assertEqual(self.question(second)["state"], "answered")
        self.assertEqual(self.sql("SELECT id FROM messages WHERE reply_to=?", (second,)), [(answer,)])
        self.posted("First answer.", topic="t1", actor="agent-a", reply_to=first)
        self.assertEqual(self.open_asks(), [])

    def test_first_exact_reply_advances_to_the_next_question(self):
        first = self.posted("First question?", topic="t1", intent="ask", addressees=["agent-a"])
        second = self.posted("Second question?", topic="t1", intent="ask", addressees=["agent-a"])
        self.posted("First answer.", topic="t1", actor="agent-a", reply_to=first)
        self.assertEqual(self.open_asks(), [second])
        self.assertEqual(self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id='t1' AND actor_id='agent-a'"),
                         [(second,)])

    def test_only_the_replying_recipient_is_settled(self):
        self.participation("agent-b", True)
        ask = self.posted("Can both of you check?", topic="t1", intent="ask",
                          addressees=["agent-a", "agent-b"])
        self.posted("Checked.", topic="t1", actor="agent-a", reply_to=ask)
        self.assertEqual(self.question(ask)["waiting_on"], ["agent-b"])

    def test_older_broad_answers_preserve_their_effect_after_cutover(self):
        old = self.posted("Historical question?", topic="t1", intent="ask", addressees=["agent-a"])
        progress = self.posted("Historical status.", topic="t1", actor="agent-a", reply_to=self.opening["id"])
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (progress,))[0][0]
        # A pre-cutover topic cleared the old pointer for this unrelated write.
        self.sql("UPDATE metadata SET value=? WHERE key=?", (str(seq + 1), EXACT_REPLY_START))
        self.sql("DELETE FROM topic_waiting WHERE topic_id='t1' AND actor_id='agent-a'")
        new = self.posted("New question?", topic="t1", intent="ask", addressees=["agent-a"])
        self.posted("Unrelated new status.", topic="t1", actor="agent-a", reply_to=self.opening["id"])
        self.assertEqual(self.open_asks(), [new])
        self.assertEqual(self.question(old)["state"], "answered")

    def test_removing_a_reply_reopens_only_its_exact_ask(self):
        self.participation("agent-b", True)
        first = self.posted("First question?", topic="t1", actor="agent-a", intent="ask",
                            addressees=["owner"], reply_to=self.opening["id"])
        second = self.posted("Second question?", topic="t1", actor="agent-b", intent="ask",
                             addressees=["owner"], reply_to=self.opening["id"])
        self.posted("First answer.", topic="t1", reply_to=first)
        reply = self.posted("Second answer.", topic="t1", reply_to=second)
        self.assertEqual(self.open_asks(actor="owner"), [])
        self.committed(self.command("message.retract", {}, target={"message_id": reply}))
        self.assertEqual(self.open_asks(actor="owner"), [second])
        self.assertEqual(self.question(first)["state"], "answered")

    def test_partial_conversation_answer_records_a_take_and_keeps_the_ask(self):
        ask = self.posted("Can you check both files?", intent="ask", addressees=["agent-b"])
        part = self.posted("The first file is ready.", actor="agent-b", reply_to=ask, part=True)
        self.assertEqual(self.open_asks(self.conversation, "agent-b"), [ask])
        self.assertEqual(self.sql("SELECT ref,part FROM conversation_takes WHERE item_id=?", (ask,)), [(part, 1)])
        self.posted("Both files are ready.", actor="agent-b", reply_to=ask)
        self.assertEqual(self.open_asks(self.conversation, "agent-b"), [])

    def test_prose_keeps_a_go_ahead_open_until_the_person_decides(self):
        for topic in ("t1", self.conversation):
            with self.subTest(topic=topic):
                kwargs = {"reply_to": self.opening["id"]} if topic == "t1" else {"divergence_reason": "Fixture decision."}
                ask = self.posted("May I publish?", topic=topic, actor="agent-a", intent="ask",
                                  addressees=["owner"], go_ahead=True, **kwargs)
                self.posted("I am checking.", topic=topic, reply_to=ask)
                self.assertEqual(self.open_asks(topic, "owner"), [ask])
                decision = self.committed(self.command("message.answer", {"answer": "yes"},
                                                       target={"message_id": ask}, expected={"answer_revision": 0}))
                self.assertEqual(self.open_asks(topic, "owner"), [])
                self.assertEqual(self.question(ask)["state"], "answered")
                self.assertTrue(decision["reply_id"])

    def test_whisper_only_settles_the_exact_ask_for_its_own_asker(self):
        self.participation("agent-b", True)
        first = self.posted("First question?", topic="t1", actor="agent-a", intent="ask",
                            addressees=["owner"], reply_to=self.opening["id"])
        second = self.posted("Second question?", topic="t1", actor="agent-b", intent="ask",
                             addressees=["owner"], reply_to=self.opening["id"])
        self.posted("Private note to somebody else.", topic="t1", whisper=True,
                    addressees=["agent-b"], reply_to=first)
        self.assertEqual(self.open_asks("t1", "owner"), [first, second])
        secret = self.posted("Private exact answer.", topic="t1", whisper=True,
                             addressees=["agent-a"], reply_to=first)
        self.assertEqual(self.open_asks("t1", "owner"), [second])
        outside = self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": secret}})
        self.assertEqual(outside["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.question(first, "agent-b")["state"], "answered")

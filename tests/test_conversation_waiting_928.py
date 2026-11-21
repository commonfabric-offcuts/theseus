from __future__ import annotations

"""Conversation Waiting uses real scratch asks; ordinary workflow stays manual."""

from test_conversation import ConversationCase


class DerivedWaiting928Case(ConversationCase):
    def topic(self):
        return self.store.view("owner", "topic", {"topic_id": self.conversation})["topic"]

    def ask(self, body="Which build should ship?", asked=None):
        return self.posted(body, addressees=asked or ["agent-b"], intent="ask")

    def test_first_ask_derives_waiting_and_final_reply_returns_active(self):
        ask = self.ask()
        self.assertEqual(self.topic()["state"], "waiting")
        self.assertEqual(self.topic()["waiting_on"], [])
        self.assertEqual(self.topic()["asks"][0]["message_id"], ask)
        self.assertEqual(self.topic()["asks"][0]["excerpt"], "Which build should ship?")
        self.posted("Build twelve.", actor="agent-b", reply_to=ask, reply_without_quote="Answering the complete scratch question")
        self.assertEqual((self.topic()["state"], self.topic()["asks"]), ("active", []))
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id=?", (self.conversation,)), [("active",)])

    def test_unrelated_reply_and_nonfinal_answer_do_not_clear_remaining_ask(self):
        first, second = self.ask(), self.ask("Which branch should ship?")
        self.posted("Unrelated status.", actor="agent-b")
        self.posted("Build twelve.", actor="agent-b", reply_to=first, reply_without_quote="Answering the complete scratch question")
        self.assertEqual(self.topic()["state"], "waiting")
        self.assertEqual(self.topic()["asks"][0]["message_id"], second)
        self.committed(self.command("message.withdraw", target={"message_id": second}))
        self.assertEqual((self.topic()["state"], self.waiting()), ("active", []))

    def test_stale_manual_wait_is_not_a_wait_on_read_and_repairs_on_next_touch(self):
        self.sql("UPDATE topics SET state='waiting',state_note='Old manual question',state_by='agent-a' WHERE id=?", (self.conversation,))
        self.sql("INSERT INTO topic_waiting(topic_id,actor_id,said) VALUES (?,'owner',1)", (self.conversation,))
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id=?", (self.conversation,)), [("waiting",)])
        read = self.topic()
        self.assertEqual((read["state"], read["waiting_on"], read["asks"], read["state_note"]), ("active", [], [], ""))
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id=?", (self.conversation,)), [("waiting",)], "reads do not repair durable state")
        mark = self.sql("SELECT coalesce(max(seq),0) FROM changes")[0][0]
        self.posted("A real touching commit.")
        self.assertEqual(self.sql("SELECT state,state_note FROM topics WHERE id=?", (self.conversation,)), [("active", "")])
        self.assertEqual(self.waiting(), [])
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 0)
        self.assertTrue(self.sql("SELECT 1 FROM changes WHERE seq>? AND scope_kind='actor' AND scope_id='owner' AND resource_kind='waiting'", (mark,)))

    def test_repair_preserves_actual_wait_and_discards_only_manual_ghost(self):
        ask = self.ask()
        self.sql("UPDATE topics SET state='active' WHERE id=?", (self.conversation,))
        self.sql("INSERT INTO topic_waiting(topic_id,actor_id,said) VALUES (?,'owner',1)", (self.conversation,))
        self.posted("Another touching commit.")
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id=?", (self.conversation,)), [("waiting",)])
        self.assertEqual(self.waiting(), [("agent-b", ask)])
        self.assertEqual(self.topic()["waiting_on"], [])

    def test_manual_conversation_waiting_is_refused_with_plain_derived_reason_in_cli(self):
        before = self.topic()
        code, out, error = self.run_cli("state", self.conversation, "waiting", "--waiting-on", "agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("open questions", error)
        self.assertEqual(self.topic(), before)

    def test_ordinary_topic_manual_state_and_question_are_unchanged(self):
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "note": "Which name?", "waiting_on": ["agent-b"]},
                                    target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.posted("A touching ordinary message.", topic="t1")
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual((topic["state"], topic["state_note"], topic["waiting_on"]), ("waiting", "Which name?", ["agent-b"]))

    def test_thumb_on_off_and_withdrawal_keep_existing_resolution_authority(self):
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": self.versions()[0]}))
        ask = self.ask(asked=["other-reader"])
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask}, expected={"thumb_revision": 0}, actor="other-reader"))
        self.assertEqual(self.topic()["state"], "active")
        self.committed(self.command("message.thumb", {"thumbed": False}, target={"message_id": ask}, expected={"thumb_revision": 1}, actor="other-reader"))
        self.assertEqual(self.topic()["state"], "waiting")
        self.rejected(self.command("message.withdraw", target={"message_id": ask}, actor="agent-a"), "FORBIDDEN")
        self.committed(self.command("message.withdraw", target={"message_id": ask}))
        self.assertEqual(self.topic()["state"], "active")

    def test_outcome_closure_keeps_its_done_state(self):
        self.ask()
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.committed(self.command("outcome.reach", {"words": "Shipped", "unmet_confirmed": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual((self.topic()["state"], self.topic()["archived"]), ("done", True))

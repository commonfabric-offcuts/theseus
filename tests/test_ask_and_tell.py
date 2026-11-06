from __future__ import annotations

"""Asking is part of sending: a message to someone says whether it asks or tells."""

import json
import sqlite3
import unittest

import reader_fixture as fixtures
import test_agent_verbs
import test_topic_state


class AskOrTellCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating.

    def post(self, args, actor="agent-a", topic="t1"):
        return self.command("message.post", dict({"body": "Words"}, **args), target={"topic_id": topic}, actor=actor)

    def latest(self):
        return self.sql("SELECT id,author_id,addressees,intent FROM messages ORDER BY seq DESC LIMIT 1")[0]

    def test_a_post_to_someone_that_neither_asks_nor_tells_is_refused_and_sends_nothing(self):
        before = self.public_state()
        receipt = self.post({"addressees": ["owner"]})
        self.rejected(receipt, "INTENT_REQUIRED")
        self.assertIs(receipt["recorded"], False)
        # The refusal names the flags an agent uses, so an older client learns what to send.
        for words in ("--asks", "--tells", "intent"):
            self.assertIn(words, receipt["error"]["message"])
        self.assertEqual(self.public_state(), before)

    def test_a_post_records_whether_it_asks_or_tells_and_every_read_carries_it(self):
        for intent in ("ask", "tell"):
            with self.subTest(intent=intent):
                result = self.committed(self.post({"addressees": ["owner"], "intent": intent}))
                self.assertEqual(self.latest(), (result["message_id"], "agent-a", '["owner"]', intent))
                page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1})
                self.assertEqual([(item["id"], item["intent"]) for item in page["items"]], [(result["message_id"], intent)])
                self.assertEqual(self.source({"kind": "message", "id": result["message_id"]})["intent"], intent)
                inbox = self.store.view("owner", "deliveries", {"limit": 100})["items"]
                self.assertEqual([item["message"]["intent"] for item in inbox if item["message_id"] == result["message_id"]], [intent])

    def test_a_message_to_nobody_neither_asks_nor_tells(self):
        result = self.committed(self.post({}))
        self.assertEqual(self.latest(), (result["message_id"], "agent-a", "[]", None))
        before = self.public_state()
        self.rejected(self.post({"intent": "ask"}), "INVALID_ARGUMENT")
        self.rejected(self.post({"addressees": [], "intent": "tell"}), "INVALID_ARGUMENT")
        for intent in ("question", "", 1, ["ask"]):
            with self.subTest(intent=intent):
                self.rejected(self.post({"addressees": ["owner"], "intent": intent}), "INVALID_ARGUMENT")
        self.assertEqual(self.public_state(), before)

    def test_a_prepared_message_to_someone_says_whether_it_asks_or_tells_or_is_refused(self):
        # The composer path holds the same rule as message.post: the sender
        # says ask or tell. Tony's page says tell for him unless he ticks Ask.
        told = self.send("Composed for agent-a", addressees=["agent-a"], intent="tell")
        self.assertEqual(self.latest(), (told["id"], "owner", '["agent-a"]', "tell"))
        unaddressed = self.send("Composed for the topic")
        self.assertEqual(self.latest(), (unaddressed["id"], "owner", "[]", None))
        source = {"kind": "message", "id": unaddressed["id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "Can you check this?", "attachments": [], "quotes": [],
                                                    "addressees": ["agent-a"], "intent": "ask"},
                                    target={"draft_id": "asking"}, expected={"draft_revision": 0}))
        # A preparation that names another intent than the saved one is refused.
        self.rejected(self.command("submission.prepare", {"draft_id": "asking", "submission_id": "asking", "send_operation_id": "asking-send",
                                                          "intent": "tell"}, target={"topic_id": "t1"}, expected={"draft_revision": 1}),
                      "REVISION_CONFLICT")
        self.committed(self.prepare("asking", "t1", submission="asking", send_op="asking-send"))
        sent = self.committed(self.command("message.send", {"submission_id": "asking"}, target={"topic_id": "t1"}, op="asking-send"))
        self.assertEqual(self.latest(), (sent["message_id"], "owner", '["agent-a"]', "ask"))
        # A draft keeps only an intent it can send.
        self.rejected(self.command("draft.save", {"source_ref": {"kind": "message", "id": sent["message_id"]}, "topic_id": "t1", "generation": "gA", "body": "x",
                                                  "attachments": [], "quotes": [], "addressees": [], "intent": "maybe"},
                                   target={"draft_id": "unsure"}, expected={"draft_revision": 0}), "INVALID_ARGUMENT")
        # Saved naming someone but saying neither: a person is not made to
        # choose, so the writing prepares and is sent as a tell. A page left
        # open from an earlier release saves no intent, and its writing goes.
        source = {"kind": "message", "id": sent["message_id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "Saying neither", "attachments": [], "quotes": [], "addressees": ["agent-a"]},
                                    target={"draft_id": "neither"}, expected={"draft_revision": 0}))
        self.committed(self.prepare("neither", "t1", submission="neither", send_op="neither-send"))
        frozen = json.loads(self.sql("SELECT snapshot FROM submissions WHERE id='neither'")[0][0])
        self.assertEqual(frozen.get("intent"), "tell", "the frozen act says what it will send")
        told = self.committed(self.command("message.send", {"submission_id": "neither"}, target={"topic_id": "t1"}, op="neither-send"))
        self.assertEqual(self.latest(), (told["message_id"], "owner", '["agent-a"]', "tell"))
        # An agent saying neither is refused when it prepares, and its writing
        # stays in its draft. Nothing is frozen and nothing is sent.
        source = {"kind": "message", "id": told["message_id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "An agent saying neither", "attachments": [], "quotes": [], "addressees": ["owner"]},
                                    target={"draft_id": "agent-neither"}, expected={"draft_revision": 0}, actor="agent-a"))
        before, drafts = self.public_state(), self.sql("SELECT * FROM drafts ORDER BY rowid")
        receipt = self.command("submission.prepare", {"draft_id": "agent-neither", "submission_id": "agent-neither",
                                                      "send_operation_id": "agent-neither-send"},
                               target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="agent-a")
        self.rejected(receipt, "INTENT_REQUIRED")
        self.assertEqual(self.sql("SELECT count(*) FROM submissions WHERE id='agent-neither'"), [(0,)], "nothing is frozen")
        self.assertEqual(self.sql("SELECT * FROM drafts ORDER BY rowid"), drafts, "the writing stays in its draft")
        self.assertEqual(self.public_state(), before, "nothing was sent")
        # Saying tell, the agent's draft prepares and sends.
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "An agent saying neither", "attachments": [], "quotes": [], "addressees": ["owner"], "intent": "tell"},
                                    target={"draft_id": "agent-neither"}, expected={"draft_revision": 1}, actor="agent-a"))
        self.committed(self.command("submission.prepare", {"draft_id": "agent-neither", "submission_id": "agent-told",
                                                           "send_operation_id": "agent-told-send"},
                                    target={"topic_id": "t1"}, expected={"draft_revision": 2}, actor="agent-a"))
        told = self.committed(self.command("message.send", {"submission_id": "agent-told"}, target={"topic_id": "t1"},
                                           op="agent-told-send", actor="agent-a"))
        self.assertEqual(self.latest(), (told["message_id"], "agent-a", '["owner"]', "tell"))

    def test_a_person_posting_to_someone_without_ask_or_tell_tells_them(self):
        # Asking or telling is a choice agents make; a person's message to
        # someone that says neither is a tell, and an agent's is refused.
        result = self.committed(self.post({"addressees": ["agent-a"]}, actor="owner"))
        self.assertEqual(self.latest(), (result["message_id"], "owner", '["agent-a"]', "tell"))
        self.assertEqual(self.source({"kind": "message", "id": result["message_id"]})["intent"], "tell")
        self.assertEqual(self.sql("SELECT actor_id FROM topic_waiting WHERE topic_id='t1'"), [], "a tell makes nothing wait")
        before = self.public_state()
        self.rejected(self.post({"addressees": ["owner"]}, actor="agent-a"), "INTENT_REQUIRED")
        self.assertEqual(self.public_state(), before)

    def frozen_without_intent(self, actor, addressees, name):
        """A submission frozen by an earlier release: naming someone, saying neither."""
        source = {"kind": "message", "id": self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq DESC LIMIT 1")[0][0]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA",
                                                    "body": "Frozen before the rule", "attachments": [], "quotes": [], "addressees": addressees, "intent": "tell"},
                                    target={"draft_id": name}, expected={"draft_revision": 0}, actor=actor))
        self.committed(self.command("submission.prepare", {"draft_id": name, "submission_id": name, "send_operation_id": name + "-send"},
                                    target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor=actor))
        # The earlier release froze it as it was saved, without the intent.
        row = self.sql("SELECT actor_id,source_key,topic_id,prepare_operation_id,send_kind,authority_id,authority_epoch,metadata,snapshot "
                       "FROM submissions WHERE id=?", (name,))[0]
        snapshot, metadata = json.loads(row[8]), json.loads(row[7])
        del snapshot["intent"]
        frozen = name + "-frozen"
        snapshot.update(id=frozen, send_operation_id=frozen + "-send")
        metadata.update(id=frozen, send_operation_id=frozen + "-send")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO submissions(id,actor_id,source_key,topic_id,prepare_operation_id,send_operation_id,send_kind,authority_id,authority_epoch,metadata,snapshot) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (frozen,) + row[:4] + (frozen + "-send",) + row[4:7] + (json.dumps(metadata), json.dumps(snapshot)))
        return frozen

    def test_a_submission_frozen_before_the_rule_without_ask_or_tell_is_a_persons_tell_and_an_agents_refusal(self):
        # A person's submission frozen by an earlier release, naming someone
        # and saying neither, is sent as a tell: "Prepare this reply again"
        # resends that snapshot as it is, and must not be refused forever.
        frozen = self.frozen_without_intent("owner", ["agent-a"], "earlier")
        sent = self.committed(self.command("message.send", {"submission_id": frozen}, target={"topic_id": "t1"}, op=frozen + "-send"))
        self.assertEqual(self.latest(), (sent["message_id"], "owner", '["agent-a"]', "tell"))
        # An agent's is refused unrecorded when it is sent, and sends nothing.
        frozen = self.frozen_without_intent("agent-a", ["owner"], "agent-earlier")
        before = self.public_state()
        receipt = self.command("message.send", {"submission_id": frozen}, target={"topic_id": "t1"}, op=frozen + "-send", actor="agent-a")
        self.rejected(receipt, "INTENT_REQUIRED")
        self.assertIs(receipt["recorded"], False)
        self.assertEqual(self.public_state(), before, "nothing was sent")


class AskWaitsCase(AskOrTellCase):
    """An asking message makes its topic wait on whoever it asks until they write in it."""

    update = test_topic_state.TopicStateCase.update
    topic = test_topic_state.TopicStateCase.topic
    listed = test_topic_state.TopicStateCase.listed
    waiting_on = test_topic_state.TopicStateCase.waiting_on
    member_set = test_topic_state.TopicStateCase.member_set

    def ask(self, asked, actor="agent-a", topic="t1"):
        result = self.committed(self.post({"addressees": asked, "intent": "ask"}, actor=actor, topic=topic))
        sent = self.sql("SELECT sent_ms FROM messages WHERE id=?", (result["message_id"],))[0][0]
        return result["message_id"], sent

    def latest_waiting(self, actor):
        answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return answer["latest_waiting"]

    def waiting_changes(self, actor):
        return self.sql("SELECT count(*) FROM changes WHERE scope_kind='actor' AND scope_id=? AND resource_kind='waiting'", (actor,))[0][0]

    def test_an_ask_waits_on_whoever_it_asks_in_the_same_act_until_they_write_in_the_topic(self):
        told = self.committed(self.post({"addressees": ["agent-b"], "intent": "tell"}))
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        message, sent = self.ask(["owner"])
        self.assertEqual(self.waiting_on("owner"), (1, ["t1"]))
        [item] = self.latest_waiting("owner")
        self.assertEqual((item["said"], item["ask"], item["state_ms"]), (False, {"message_id": message, "by": "agent-a", "since_ms": sent}, None))
        ask = {"actor_id": "owner", "message_id": message, "by": "agent-a", "since_ms": sent}
        topic = self.topic()
        # The topic's state is what people said; the ask is its own reason to wait.
        self.assertEqual((topic["state"], topic["waiting_on"], topic["asks"]), ("active", [], [ask]))
        self.assertEqual((self.listed()["t1"]["waiting_on"], self.listed()["t1"]["asks"]), ([], [ask]))
        self.assertEqual(self.waiting_changes("owner"), 1)
        # Someone else writing in the topic answers nothing asked of the owner.
        self.committed(self.post({"body": "Meanwhile"}, actor="agent-b"))
        self.assertEqual(self.waiting_on("owner"), (1, ["t1"]))
        # The owner's own message there answers it, whatever it says and whoever it names.
        self.committed(self.post({"body": "Here you go"}, actor="owner"))
        self.assertEqual(self.waiting_on("owner"), (0, []))
        self.assertEqual((self.topic()["asks"], self.listed()["t1"]["asks"]), ([], []))
        self.assertEqual(self.waiting_changes("owner"), 2)
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])
        self.assertTrue(told)

    def test_agents_asking_agents_wait_the_same_way_and_a_message_sent_through_the_composer_answers(self):
        self.ask(["agent-b", "owner"], actor="agent-a")
        self.assertEqual(self.waiting_on("agent-b"), (1, ["t1"]))
        self.assertEqual([ask["actor_id"] for ask in self.topic()["asks"]], ["agent-b", "owner"])
        # Asking yourself waits on nobody.
        self.ask(["agent-a"], actor="agent-a")
        self.assertEqual(self.waiting_on("agent-a"), (0, []))
        self.send("Answered from the page")
        self.assertEqual(self.waiting_on("owner"), (0, []))
        self.assertEqual(self.waiting_on("agent-b"), (1, ["t1"]))
        self.committed(self.post({"addressees": ["agent-a"], "intent": "ask"}, actor="agent-b"))
        # agent-b's ask answered what was asked of agent-b and now waits on agent-a.
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        self.assertEqual(self.waiting_on("agent-a"), (1, ["t1"]))

    def test_a_second_ask_keeps_the_wait_from_the_first(self):
        first, sent = self.ask(["owner"])
        self.ask(["owner"], actor="agent-b")
        self.assertEqual(self.latest_waiting("owner")[0]["ask"], {"message_id": first, "by": "agent-a", "since_ms": sent})
        self.assertEqual(self.waiting_changes("owner"), 1)
        self.committed(self.post({"body": "Both answered"}, actor="owner"))
        self.assertEqual(self.waiting_on("owner"), (0, []))

    def test_a_said_wait_and_an_ask_are_one_wait_and_each_ends_on_its_own(self):
        # Said first: an ask joins it, a reply answers the ask, the said wait stays.
        self.committed(self.update({"state": "waiting", "note": "Your call", "waiting_on": ["agent-a"]}, actor="owner"))
        said_ms = self.topic()["state_ms"]
        message, sent = self.ask(["agent-a"], actor="agent-b")
        self.assertEqual(self.waiting_on("agent-a"), (1, ["t1"]))
        [item] = self.latest_waiting("agent-a")
        self.assertEqual((item["said"], item["ask"]["message_id"], item["state_ms"]), (True, message, said_ms))
        self.committed(self.post({"body": "Answering agent-b"}, actor="agent-a"))
        [item] = self.latest_waiting("agent-a")
        self.assertEqual((item["said"], item["ask"]), (True, None))
        self.assertEqual((self.topic()["state"], self.topic()["waiting_on"], self.topic()["asks"]), ("waiting", ["agent-a"], []))
        # Asked first: a new state ends what was said and leaves the ask, ordered by its own time.
        message, sent = self.ask(["agent-a"], actor="agent-b")
        self.committed(self.update({"state": "review"}, actor="owner"))
        self.assertEqual(self.waiting_on("agent-a"), (1, ["t1"]))
        self.assertEqual(self.sql("SELECT said,state_ms,ask_message_id FROM topic_waiting"), [(0, sent, message)])
        topic = self.topic()
        self.assertEqual((topic["state"], topic["waiting_on"], [ask["actor_id"] for ask in topic["asks"]]), ("review", [], ["agent-a"]))
        # Saying it waits on them again makes the one row said once more, at the state's time.
        self.committed(self.update({"state": "waiting", "waiting_on": ["agent-a", "agent-b"]}, actor="owner"))
        self.assertEqual(self.sql("SELECT actor_id,said,state_ms=?,ask_message_id FROM topic_waiting ORDER BY actor_id", (self.topic()["state_ms"],)),
                         [("agent-a", 1, 1, message), ("agent-b", 1, 1, None)])
        # An update that names nobody keeps who was said, never turning an ask into a said wait.
        self.committed(self.update({"state": "waiting", "waiting_on": ["agent-b"]}, actor="owner"))
        self.committed(self.update({"note": "Still yours"}, actor="owner"))
        self.assertEqual((self.topic()["waiting_on"], [ask["actor_id"] for ask in self.topic()["asks"]]), (["agent-b"], ["agent-a"]))
        self.assertEqual(self.waiting_on("agent-a"), (1, ["t1"]))

    def test_whoever_loses_the_topic_is_no_longer_asked(self):
        # agent-b reads t1 only as a member of the outcome.
        self.ask(["agent-b"])
        self.assertEqual(self.waiting_on("agent-b"), (1, ["t1"]))
        self.member_set("agent-b", False)
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])
        self.member_set("agent-b", True)
        self.assertEqual(self.waiting_on("agent-b"), (0, []))

    def test_an_ask_in_an_archived_topic_waits_without_counting(self):
        self.committed(self.update({"archived": True}))
        self.ask(["owner"])
        self.assertEqual(self.waiting_on("owner"), (0, []))
        self.assertEqual(self.listed(archived=True)["t1"]["asks"][0]["actor_id"], "owner")
        self.committed(self.update({"archived": False}))
        self.assertEqual(self.waiting_on("owner"), (1, ["t1"]))

    def test_what_waits_is_listed_newest_first_whether_said_or_asked(self):
        self.ask(["owner"])
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Second", "participants": ["agent-a"],
                                                     "body": "Opened", "attachments": []}, target={"opening_id": "o2"},
                                    expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}))
        self.committed(self.update({"state": "waiting", "waiting_on": ["owner"]}, actor="agent-a", topic="t2"))
        self.assertEqual(self.waiting_on("owner"), (2, ["t2", "t1"]))


class AskOrTellVerbCase(test_agent_verbs.AgentVerbCase):
    def message(self):
        return self.sql("SELECT author_id,body,addressees,intent FROM messages ORDER BY seq DESC LIMIT 1")[0]

    def test_post_asks_or_tells_the_people_it_names(self):
        code, out, err = self.run_cli("post", "t1", "--asks", "owner", "Which name do we ship?")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.message(), ("agent-a", "Which name do we ship?", '["owner"]', "ask"))
        code, out, err = self.run_cli("post", "t1", "--tells", "owner,agent-b", "Shipped.")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.message(), ("agent-a", "Shipped.", '["owner","agent-b"]', "tell"))
        # A message to nobody in particular says neither.
        self.assertEqual(self.run_cli("post", "t1", "For the topic")[0], 0)
        self.assertEqual(self.message(), ("agent-a", "For the topic", "[]", None))
        code, out, err = self.run_cli("read", "t1", "--after", "0")
        self.assertIn(" agent-a asks owner\n", out)
        self.assertIn(" agent-a tells owner, agent-b\n", out)
        # The topic list says who the topic waits on because they were asked, and since when.
        code, out, err = self.run_cli("topics", "w1")
        self.assertRegex(out, r"t1  .*\[active, asked owner since \d{4}-\d\d-\d\d \d\d:\d\d\]")

    def test_a_post_that_neither_asks_nor_tells_is_refused_before_anything_is_saved(self):
        before = self.records()
        for argv in (["post", "t1", "--to", "owner", "Hello"], ["post", "t1", "--asks", "owner", "--tells", "agent-b", "Both"]):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv)
                self.assertEqual((code, out), (2, ""))
                self.assertIn("INTENT_REQUIRED", err)
                self.assertIn("--asks", err)
                self.assertIn("--tells", err)
                code, out, err = self.run_cli("--json", *argv)
                self.assertEqual((code, json.loads(out)["error"]["code"]), (2, "INTENT_REQUIRED"))
        self.assertEqual(self.saved(), [])
        self.assertEqual(self.records(), before)


    def test_an_ask_or_tell_that_names_nobody_is_refused_before_anything_is_saved(self):
        # "--asks" with no names would otherwise post to nobody, asking no one.
        before = self.records()
        for flag in ("--asks", "--tells"):
            for names in ("", "  ", " , "):
                argv = ["post", "t1", flag, names, "To nobody"]
                with self.subTest(argv=argv):
                    code, out, err = self.run_cli(*argv)
                    self.assertEqual((code, out), (2, ""))
                    self.assertIn("INVALID_ARGUMENT", err)
                    self.assertIn(flag, err)
                    code, out, err = self.run_cli("--json", *argv)
                    self.assertEqual((code, json.loads(out)["error"]["code"]), (2, "INVALID_ARGUMENT"))
        self.assertEqual(self.saved(), [])
        self.assertEqual(self.records(), before)
        # A name among the commas is still a name.
        self.assertEqual(self.run_cli("post", "t1", "--tells", " ,owner, ", "Told")[0], 0)
        self.assertEqual(self.message(), ("agent-a", "Told", '["owner"]', "tell"))

if __name__ == "__main__":
    unittest.main()

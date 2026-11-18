from __future__ import annotations

"""Item 372: real isolated records, count and source identities, no live data."""

import hashlib
import unittest
from unittest import mock

import reader_fixture
from aim_next import Store
from aim_next.outcome_rules import stands


class WaitingQuestions372Case(reader_fixture.ReaderCase):
    def setUp(self):
        super().setUp()
        self.c = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        self.committed(self.command("draft.save", {
            "source_ref": {"kind": "new_topic", "id": "opening-b", "workspace_id": "w1"},
            "topic_id": "t-b", "generation": "b", "body": "Synthetic B opening",
            "opening": {"workspace_id": "w1", "title": "Synthetic B", "participants": ["agent-a"]},
        }, target={"draft_id": "b"}, expected={"draft_revision": 0}))
        self.committed(self.prepare("b", "t-b", submission="b", send_op="b-send"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "b"}, target={"topic_id": "t-b"}, op="b-send"))
        self.a = self.post("t1", "Synthetic A question")
        self.b = self.post("t-b", "Synthetic B question")
        self.c1 = self.post(self.c, "Synthetic Conversation first question")
        self.c2 = self.post(self.c, "Synthetic Conversation second question")

    def post(self, topic, body, actor="agent-a", **extra):
        args = dict(body=body, addressees=["owner"], intent="ask")
        args.update(extra)
        return self.committed(self.command("message.post", args, target={"topic_id": topic}, actor=actor))["message_id"]

    def light(self):
        result = self.store.view("owner", "outcome_light", {"workspace_id": "w1"})
        self.assertNotIn("error", result, result)
        return result

    def identities(self):
        return {(f["topic_id"], f.get("message_id")) for f in self.light()["facts"] if f["kind"] == "ask"}

    def state(self, topic, **args):
        revision = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        self.committed(self.command("topic.update", args, target={"topic_id": topic}, expected={"topic_revision": revision}))

    def test_item_372_four_questions_count_once_and_every_identity_opens_its_source(self):
        expected = {("t1", self.a), ("t-b", self.b), (self.c, self.c1), (self.c, self.c2)}
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        answer = self.light()
        self.assertEqual(answer["light"]["short"], {"kind": "asks", "count": 4})
        self.assertEqual(answer["lead"], {"kind": "asks", "count": 4})
        facts = [f for f in answer["facts"] if f["kind"] == "ask"]
        self.assertEqual(len(facts), 4)
        self.assertEqual(self.identities(), expected)
        for topic, message in expected:
            source = self.source({"kind": "message", "id": message})
            self.assertEqual(source["topic_id"], topic)
            self.assertIn("Synthetic", source["body"])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before, "count and source reads mutate no records")
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 3, "attention still counts places")
        rows = self.store.view("owner", "workspaces", {})["items"]
        self.assertEqual(next(row for row in rows if row["id"] == "w1")["light"]["short"]["count"], 4)

    def test_item_372_topic_and_list_expand_reader_but_keep_other_actor_summary(self):
        a2 = self.post("t1", "Synthetic A second question")
        self.post("t1", "Synthetic question to other agent", addressees=["agent-b"])
        self.post("t1", "Synthetic second to other agent", addressees=["agent-b"])
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        listed = next(t for t in self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"] if t["id"] == "t1")
        for row in (topic, listed):
            self.assertEqual({q["message_id"] for q in row["asks"] if q["actor_id"] == "owner"}, {self.a, a2})
            self.assertEqual(len([q for q in row["asks"] if q["actor_id"] == "agent-b"]), 1)

    def test_item_372_conversation_reply_settles_one_topic_writing_settles_all(self):
        a2 = self.post("t1", "Synthetic A sibling")
        self.post(self.c, "Synthetic reply", actor="owner", addressees=[], intent=None, reply_to=self.c1)
        self.assertEqual(self.identities(), {("t1", self.a), ("t1", a2), ("t-b", self.b), (self.c, self.c2)})
        self.post("t1", "Synthetic ordinary writing", actor="owner", addressees=[], intent=None)
        self.assertEqual(self.identities(), {("t-b", self.b), (self.c, self.c2)})

    def test_item_372_said_plus_asks_no_duplicate_said_only_one_done_and_archive(self):
        self.state("t1", state="waiting", waiting_on=["owner"])
        self.assertEqual(len(self.identities()), 4)
        self.state("t-b", state="done")
        self.assertIn(("t-b", self.b), self.identities())
        self.state("t-b", archived=True)
        self.assertNotIn(("t-b", self.b), self.identities())
        archived = self.store.view("owner", "topic", {"topic_id": "t-b"})["topic"]
        self.assertIn(self.b, [q["message_id"] for q in archived["asks"]])
        self.post("t1", "Synthetic answer", actor="owner", addressees=[], intent=None)
        self.assertEqual(self.identities(), {("t1", None), (self.c, self.c1), (self.c, self.c2)})

    def test_item_372_thumb_ends_one_and_undo_restores_second_conversation_question(self):
        for on, count in ((True, 3), (False, 4)):
            rev = self.store.view("owner", "reactions", {"message_id": self.c2})["reactions"]["thumb_revision"]
            self.committed(self.command("message.thumb", {"thumbed": on}, target={"message_id": self.c2}, expected={"thumb_revision": rev}))
            self.assertEqual(self.light()["lead"]["count"], count)
            self.assertEqual((self.c, self.c2) in self.identities(), not on)

    def test_item_372_metadata_query_is_reader_scoped_and_private_other_asks_do_not_count(self):
        self.post("t1", "Synthetic other-reader ask", addressees=["agent-b"])
        private = self.post("t1", "Synthetic private words", actor="owner", addressees=["agent-a"], intent=None, whisper=True)
        self.assertIn("error", self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": private}}))
        self.post("t1", "Synthetic tell", intent="tell")
        statements = []
        original = Store._waiting_asks

        def traced(store, db, topic, actor, **kwargs):
            db.set_trace_callback(statements.append)
            try:
                return original(store, db, topic, actor, **kwargs)
            finally:
                db.set_trace_callback(None)

        with mock.patch.object(Store, "_waiting_asks", traced):
            self.assertEqual(len(self.identities()), 4)
        candidates = [s for s in statements if "FROM message_addressees a CROSS JOIN messages" in s]
        self.assertEqual(len(candidates), 3)
        for query in candidates:
            self.assertIn("a.actor_id='owner'", query)
            self.assertIn("a.topic_id=", query)
            self.assertNotIn("body", query)
            self.assertNotIn("attachments", query)
        self.assertIn("error", self.store.view("outsider", "outcome_light", {"workspace_id": "w1"}))

    def test_item_372_blocking_marks_exact_question_without_losing_siblings(self):
        asks = [dict(topic_id="c", message_id="c2", ms=2), dict(topic_id="c", message_id="c1", ms=1)]
        blocks = {"kind": "piece", "piece_id": "synthetic", "items": [372]}
        answer = stands(asks, None, [], [], {}, True, None, None, [dict(topic_id="c", message_id="c1", blocks=blocks)])
        self.assertEqual(answer["lead"]["count"], 2)
        self.assertEqual([f["message_id"] for f in answer["facts"]], ["c1", "c2"])
        self.assertEqual(answer["facts"][0]["blocking"], blocks)
        self.assertNotIn("blocking", answer["facts"][1])


if __name__ == "__main__":
    unittest.main()

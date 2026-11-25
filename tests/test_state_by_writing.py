from __future__ import annotations

"""Having written in a topic lets you say where it stands, as its participants
may; writing makes no one a participant, so nobody is woken for what follows."""

import unittest

import reader_fixture as fixtures


class WriterSaysCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating;
    # agent-b can read and write in it as a member but is not a participant.

    def post(self, actor, body="Writing here", topic="t1"):
        return self.command("message.post", {"body": body}, target={"topic_id": topic}, actor=actor)

    def participants(self):
        answer = self.store.view("owner", "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return {row["actor_id"]: row["epoch"] for row in answer["participants"]}

    def topic(self):
        return self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]

    def say(self, actor, **args):
        return self.command("topic.update", args or {"state": "review"}, target={"topic_id": "t1"},
                            expected={"topic_revision": self.topic()["version"]}, actor=actor)

    def deliveries(self, actor):
        return self.sql("SELECT count(*) FROM deliveries WHERE recipient_id=?", (actor,))[0][0]

    def participation_changes(self, actor):
        return self.sql("SELECT resource_id,version FROM changes WHERE scope_kind='actor' AND scope_id=? "
                        "AND resource_kind='participation' ORDER BY seq", (actor,))

    def refused(self, receipt):
        self.rejected(receipt, "FORBIDDEN")
        self.assertIn("once you have written in it", receipt["error"]["message"], receipt)

    def test_a_member_who_wrote_says_where_the_topic_stands_without_becoming_a_participant(self):
        before = self.participants()
        self.refused(self.say("agent-b"))
        result = self.committed(self.post("agent-b"))
        self.assertEqual(set(result), {"message_id", "seq", "topic", "delivery"}, "a post says nothing of joining")
        self.assertEqual(self.sql("SELECT seq FROM messages WHERE id=?", (result["message_id"],)), [(result["seq"],)])
        self.assertEqual(self.participants(), before, "writing adds no participant")
        self.assertEqual(self.sql("SELECT count(*) FROM topic_participants WHERE actor_id='agent-b'"), [(0,)])
        self.assertEqual(self.participation_changes("agent-b"), [])
        # State, note and who it waits on, each as a participant may.
        self.committed(self.say("agent-b", state="review"))
        self.assertEqual((self.topic()["state"], self.topic()["state_by"]), ("review", "agent-b"))
        self.committed(self.say("agent-b", note="Ready to read"))
        self.committed(self.say("agent-b", state="waiting", waiting_on=["owner"]))
        topic = self.topic()
        self.assertEqual((topic["state"], topic["waiting_on"], topic["state_by"]), ("waiting", ["owner"], "agent-b"))
        self.committed(self.say("agent-b", waiting_on=["agent-a"]))
        self.assertEqual(self.topic()["waiting_on"], ["agent-a"])
        # Renaming and archiving stay with its creator and the outcome's owner.
        self.rejected(self.say("agent-b", title="Mine now"), "FORBIDDEN")
        self.rejected(self.say("agent-b", archived=True), "FORBIDDEN")

    def test_the_topic_view_tells_each_reader_whether_they_may_say_where_it_stands(self):
        may = lambda actor: self.store.view(actor, "topic", {"topic_id": "t1"})["topic"]["reader_may_say"]
        self.assertEqual([may(actor) for actor in ("owner", "agent-a", "agent-b")], [True, True, False],
                         "the owner and creator, a participant, and a member who never wrote")
        self.committed(self.post("agent-b"))
        self.assertIs(may("agent-b"), True, "having written")

    def test_a_writer_is_not_woken_by_what_is_written_next(self):
        self.committed(self.post("agent-b"))
        writer, participant = self.deliveries("agent-b"), self.deliveries("agent-a")
        self.committed(self.post("owner", "Next, to the whole topic"))
        self.assertEqual((self.deliveries("agent-b"), self.deliveries("agent-a")), (writer, participant + 1),
                         "the participant hears it; the writer does not")
        self.assertEqual(self.store.view("agent-b", "deliveries", {})["items"], [], "nothing waits in its inbox")

    def test_a_prepared_send_counts_as_writing(self):
        source = {"kind": "message", "id": self.opening["id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA", "body": "Sent",
                                                   "attachments": [], "quotes": [], "addressees": []},
                                    target={"draft_id": "b-draft"}, expected={"draft_revision": 0}, actor="agent-b"))
        self.committed(self.command("submission.prepare", {"draft_id": "b-draft", "submission_id": "b-send", "send_operation_id": "b-op"},
                                    target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="agent-b"))
        self.refused(self.say("agent-b"))
        result = self.committed(self.command("message.send", {"submission_id": "b-send"}, target={"topic_id": "t1"},
                                             actor="agent-b", op="b-op"))
        self.assertNotIn("joined", result)
        self.assertNotIn("agent-b", self.participants())
        self.committed(self.say("agent-b"))

    def test_someone_who_never_wrote_here_is_refused(self):
        # A refused post is no writing.
        self.rejected(self.post("agent-b", body="  "), "EMPTY_MESSAGE")
        for args in ({"state": "done"}, {"note": "Mine"}, {"state": "waiting", "waiting_on": ["owner"]}):
            with self.subTest(args=args):
                self.refused(self.say("agent-b", **args))
        # Writing in another topic of the outcome says nothing about this one.
        saved = self.save_draft("t2-draft", {"kind": "new_topic", "id": "opening-two", "workspace_id": "w1"}, "t2", "Second",
                                opening={"workspace_id": "w1", "title": "Other", "participants": []})
        self.assertEqual(saved["status"], "committed", saved)
        self.committed(self.prepare("t2-draft", "t2", submission="t2-open", send_op="t2-open"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "t2-open"}, target={"topic_id": "t2"}, op="t2-open"))
        self.committed(self.post("agent-b", topic="t2"))
        self.refused(self.say("agent-b"))
        self.assertEqual(self.topic()["state"], "active")

    def test_the_outcome_owner_who_never_wrote_says_where_an_agent_opened_topic_stands(self):
        # agent-a opens t3 with agent-b alone: the owner is neither its creator nor a participant, and never wrote there.
        source = {"kind": "new_topic", "id": "opening-three", "workspace_id": "w1"}
        def as_agent(kind, args, target, expected=None, op=None):
            return self.committed(self.command(kind, args, target=target, expected=expected, actor="agent-a", op=op))
        as_agent("draft.save", dict(source_ref=source, topic_id="t3", body="Agent opening", generation="g3", attachments=[], quotes=[],
                                    addressees=[], opening={"workspace_id": "w1", "title": "Agent's", "participants": ["agent-b"]}),
                 {"draft_id": "t3-draft"}, {"draft_revision": 0})
        as_agent("submission.prepare", {"draft_id": "t3-draft", "submission_id": "t3-open", "send_operation_id": "t3-open"},
                 {"topic_id": "t3"}, {"draft_revision": 1})
        as_agent("topic.create_and_send", {"submission_id": "t3-open"}, {"topic_id": "t3"}, op="t3-open")
        topic = self.store.view("owner", "topic", {"topic_id": "t3"})
        self.assertEqual((topic["topic"]["creator_id"], "owner" in [row["actor_id"] for row in topic["participants"]]), ("agent-a", False))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE topic_id='t3' AND author_id='owner'"), [(0,)])
        self.assertIs(topic["topic"]["reader_may_say"], True)
        self.committed(self.command("topic.update", {"state": "review", "note": "The owner's word"}, target={"topic_id": "t3"},
                                    expected={"topic_revision": topic["topic"]["version"]}))
        self.assertEqual(self.sql("SELECT state,state_by FROM topics WHERE id='t3'"), [("review", "owner")])

    def test_a_writer_who_lost_the_outcome_is_refused(self):
        self.committed(self.post("agent-b"))
        self.committed(self.say("agent-b", state="review"))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.rejected(self.say("agent-b", state="done"), "FORBIDDEN")
        self.assertEqual(self.topic()["state"], "review")

    def test_a_participant_who_writes_stays_as_they_were(self):
        before = self.participation_changes("agent-a")
        self.committed(self.post("agent-a"))
        self.assertEqual(self.sql("SELECT active,epoch FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a'"), [(1, 1)])
        self.assertEqual(self.participation_changes("agent-a"), before)

    def test_someone_who_left_and_writes_stays_out_and_still_says_where_it_stands(self):
        self.participation("agent-b", True)
        self.participation("agent-b", False)
        self.committed(self.post("agent-b"))
        self.assertEqual(self.sql("SELECT active,epoch FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-b'"), [(0, 2)],
                         "writing does not bring them back")
        self.committed(self.say("agent-b", state="done"))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Writing in a topic makes the writer one of its participants, in the same act."""

import unittest
from unittest import mock

from aim_next import contract
import reader_fixture as fixtures


class WritingJoinsCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating;
    # agent-b can read and write in it as a member but is not a participant.

    def post(self, actor, body="Writing here", op=None):
        return self.command("message.post", {"body": body}, target={"topic_id": "t1"}, actor=actor, op=op)

    def participants(self, actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return {row["actor_id"]: row["epoch"] for row in answer["participants"]}

    def row(self, actor):
        rows = self.sql("SELECT active,epoch FROM topic_participants WHERE topic_id='t1' AND actor_id=?", (actor,))
        return rows[0] if rows else None

    def say(self, actor, state):
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        return self.command("topic.update", {"state": state}, target={"topic_id": "t1"},
                            expected={"topic_revision": version}, actor=actor)

    def participation_changes(self, actor):
        return self.sql("SELECT resource_id,version FROM changes WHERE scope_kind='actor' AND scope_id=? "
                        "AND resource_kind='participation' ORDER BY seq", (actor,))

    def test_a_member_who_writes_becomes_a_participant_and_says_where_the_topic_stands(self):
        self.rejected(self.say("agent-b", "review"), "FORBIDDEN")
        self.assertNotIn("agent-b", self.participants())
        result = self.committed(self.post("agent-b"))
        self.assertEqual(self.participants(), {"owner": 1, "agent-a": 1, "agent-b": 1}, "listed among the participants")
        self.assertIs(result.get("joined"), True, result)
        # Their own scope hears of it, as when someone adds them.
        self.assertEqual(self.participation_changes("agent-b"), [("t1", result["topic"]["version"])])
        self.committed(self.say("agent-b", "review"))
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["state_by"], "agent-b")
        # A participant hears what is written next in the topic.
        before = self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-b'")[0][0]
        self.committed(self.post("owner", "Next"))
        reasons = self.sql("SELECT r.reason FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id "
                           "WHERE d.recipient_id='agent-b' ORDER BY d.seq DESC LIMIT 1")
        self.assertEqual((self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-b'")[0][0], reasons),
                         (before + 1, [("subscription",)]))

    def test_a_prepared_send_joins_its_writer_too(self):
        source = {"kind": "message", "id": self.opening["id"]}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t1", "generation": "gA", "body": "Sent",
                                                   "attachments": [], "quotes": [], "addressees": []},
                                    target={"draft_id": "b-draft"}, expected={"draft_revision": 0}, actor="agent-b"))
        self.committed(self.command("submission.prepare", {"draft_id": "b-draft", "submission_id": "b-send", "send_operation_id": "b-op"},
                                    target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="agent-b"))
        result = self.committed(self.command("message.send", {"submission_id": "b-send"}, target={"topic_id": "t1"},
                                             actor="agent-b", op="b-op"))
        self.assertTrue(result.get("joined"))
        self.assertIn("agent-b", self.participants())

    def test_a_participant_who_writes_stays_as_they_were(self):
        before = self.participation_changes("agent-a")
        result = self.committed(self.post("agent-a"))
        self.assertIs(result.get("joined"), False)
        self.assertEqual(self.row("agent-a"), (1, 1), "the same participation, its epoch unchanged")
        self.assertEqual(self.participation_changes("agent-a"), before)

    def test_someone_who_left_rejoins_by_writing_without_reviving_what_they_left(self):
        self.participation("agent-b", True)
        self.participation("agent-b", False)
        self.assertEqual(self.row("agent-b"), (0, 2))
        cancelled = self.sql("SELECT id,active FROM delivery_groups WHERE recipient_id='agent-b' AND kind='subscription'")
        self.assertTrue(self.committed(self.post("agent-b")).get("joined"))
        self.assertEqual(self.row("agent-b"), (1, 3), "rejoining is a new participation, on a new epoch")
        self.assertEqual(self.sql("SELECT id,active FROM delivery_groups WHERE recipient_id='agent-b' AND kind='subscription'"), cancelled)
        self.committed(self.say("agent-b", "done"))

    def test_a_refused_post_joins_nobody(self):
        self.rejected(self.post("agent-b", body="  "), "EMPTY_MESSAGE")
        self.assertIsNone(self.row("agent-b"))
        self.assertEqual(self.participation_changes("agent-b"), [])

    def test_a_full_topic_keeps_the_post_and_says_its_writer_did_not_join(self):
        # owner and agent-a fill a topic of two.
        with mock.patch.dict(contract.LIMITS, {"topic_participants": 2}):
            result = self.committed(self.post("agent-b"))
        self.assertIs(result.get("joined"), False)
        self.assertIsNone(self.row("agent-b"))
        self.assertEqual(self.sql("SELECT author_id FROM messages WHERE id=?", (result["message_id"],)), [("agent-b",)])
        self.rejected(self.say("agent-b", "done"), "FORBIDDEN")
        self.assertEqual(self.participation_changes("agent-b"), [])


if __name__ == "__main__":
    unittest.main()

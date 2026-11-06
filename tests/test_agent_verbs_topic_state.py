from __future__ import annotations

"""Agent verbs for where a topic stands, renaming, archiving and starting an outcome."""

import json
import unittest

from test_agent_verbs import AgentVerbCase


class TopicStateVerbCase(AgentVerbCase):
    # agent-a works in t1, which owner created in owner's outcome w1;
    # agent-b reads w1 as a member; outsider reads nothing.

    def test_state_says_where_the_topic_stands_and_topics_shows_it(self):
        code, out, err = self.run_cli("state", "t1", "waiting", "--note", "Which name do we ship?", "--waiting-on", "agent-b, owner")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "t1 is waiting on agent-b, owner: Which name do we ship?\n")
        self.assertEqual(self.sql("SELECT state,state_note,state_by FROM topics WHERE id='t1'"), [("waiting", "Which name do we ship?", "agent-a")])
        code, out, err = self.run_cli("topics", "w1", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("t1  Topic  [waiting on agent-b, owner: Which name do we ship?]", out)
        code, out, _ = self.run_cli("state", "t1", "done")
        self.assertEqual((code, out), (0, "t1 is done\n"))
        self.assertEqual(self.sql("SELECT state,state_note FROM topics WHERE id='t1'"), [("done", "")])
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])

    def test_state_refusals_change_nothing(self):
        for argv, actor, code, word in ((("state", "t1", "done"), "agent-b", 2, "FORBIDDEN"),
                                        (("state", "t1", "review", "--waiting-on", "owner"), "agent-a", 2, "INVALID_ARGUMENT"),
                                        (("state", "t1", "paused"), "agent-a", 2, "state TOPIC active|waiting|review|done"),
                                        (("rename", "t1", "Mine now"), "agent-a", 2, "FORBIDDEN"),
                                        (("archive", "t1"), "agent-a", 2, "FORBIDDEN"),
                                        (("state", "t-missing", "done"), "agent-a", 2, "FORBIDDEN")):
            with self.subTest(argv=argv):
                result, out, err = self.run_cli(*argv, actor=actor)
                self.assertEqual((result, out), (code, ""))
                self.assertIn(word, err)
        self.assertEqual(self.sql("SELECT title,state,archived,state_by FROM topics WHERE id='t1'"), [("Topic", "active", 0, None)])

    def test_the_creator_renames_and_archives_and_topics_lists_archived_apart(self):
        code, out, err = self.run_cli("start", "w1", "--title", "Agent topic", "Opening words")
        self.assertEqual((code, err), (0, ""))
        topic = out.split()[1]
        self.assertEqual(self.run_cli("rename", topic, "Renamed by its creator"), (0, 'renamed %s "Renamed by its creator"\n' % topic, ""))
        self.assertEqual(self.run_cli("archive", topic), (0, "archived %s\n" % topic, ""))
        _, listed, _ = self.run_cli("topics", "w1")
        self.assertNotIn(topic, listed)
        _, archived, _ = self.run_cli("topics", "w1", "--archived")
        self.assertIn("%s  Renamed by its creator  [active]" % topic, archived)
        self.assertNotIn("t1", archived)
        self.assertEqual(self.run_cli("unarchive", topic), (0, "unarchived %s\n" % topic, ""))
        self.assertIn(topic, self.run_cli("topics", "w1")[1])
        self.assertEqual(self.run_cli("topics", "w1", "--archived")[1], "no archived topics\n")

    def test_new_outcome_creates_one_the_agent_owns(self):
        code, out, err = self.run_cli("new-outcome", "--title", "Agent outcome", "--purpose", "Prove it", "--team", "agent-b")
        self.assertEqual((code, err), (0, ""))
        outcome = out.split()[2]
        self.assertEqual(out, 'created outcome %s "Agent outcome"\n' % outcome)
        self.assertEqual(self.sql("SELECT owner_id,title,purpose FROM workspaces WHERE id=?", (outcome,)), [("agent-a", "Agent outcome", "Prove it")])
        self.assertEqual(self.sql("SELECT actor_id FROM workspace_members WHERE workspace_id=? ORDER BY actor_id", (outcome,)),
                         [("agent-a",), ("agent-b",)])
        self.assertIn(outcome, self.run_cli("outcomes", actor="agent-b")[1])
        self.assertNotIn(outcome, self.run_cli("outcomes", actor="outsider")[1])

    def test_responsible_says_what_the_agent_does_in_a_topic_and_read_shows_it(self):
        code, out, err = self.run_cli("responsible", "t1", "Drafts the release notes")
        self.assertEqual((code, out, err), (0, "agent-a in t1: Drafts the release notes\n", ""))
        self.assertEqual(self.sql("SELECT responsibility,responsibility_revision FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a'"),
                         [("Drafts the release notes", 1)])
        # Every reader of the topic sees it under the title; a participant with no note shows nothing.
        code, out, _ = self.run_cli("read", "t1", "--limit", "1", actor="agent-b")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("t1  Topic\n  agent-a: Drafts the release notes\n\n#"), out)
        # The second note is fenced on the first's revision, read afresh: it lands.
        code, out, _ = self.run_cli("responsible", "t1", "-", stdin="Reviews the copy\n".encode("utf-8"))
        self.assertEqual((code, out), (0, "agent-a in t1: Reviews the copy\n"))
        self.assertEqual(self.run_cli("responsible", "t1", ""), (0, "agent-a in t1: no note\n", ""))
        self.assertEqual(self.sql("SELECT responsibility,responsibility_revision FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a'"),
                         [("", 3)])
        self.assertTrue(self.run_cli("read", "t1", "--limit", "1")[1].startswith("t1  Topic\n\n#"))

    def test_responsible_is_refused_to_someone_not_taking_part(self):
        for actor in ("agent-b", "outsider"):
            with self.subTest(actor=actor):
                code, out, err = self.run_cli("responsible", "t1", "Mine now", actor=actor)
                self.assertEqual((code, out), (2, ""))
                self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM topic_participants WHERE responsibility!=''"), [(0,)])

    def test_json_output_carries_the_receipt(self):
        code, out, err = self.run_cli("--json", "state", "t1", "review")
        self.assertEqual((code, err), (0, ""))
        lines = [json.loads(line) for line in out.splitlines()]
        self.assertEqual(lines[-1]["status"], "committed")
        self.assertEqual(lines[-1]["result"]["state"], "review")


if __name__ == "__main__":
    unittest.main()

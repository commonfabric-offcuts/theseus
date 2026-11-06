from __future__ import annotations

"""Starting a topic from a message with the CLI: the topics already started from it come first."""

import json
import unittest

from test_agent_verbs import AgentVerbCase


class SourceVerbCase(AgentVerbCase):
    # agent-a works in t1 in owner's outcome w1; agent-b reads w1 as a member; outsider reads nothing.

    def setUp(self):
        super().setUp()
        self.message = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]

    def topics_from(self):
        return [row[0] for row in self.sql("SELECT id FROM topics WHERE source_message_id=? ORDER BY id", (self.message,))]

    def test_the_first_start_from_a_message_names_it_and_a_second_sees_the_first_before_anything_is_saved(self):
        code, out, err = self.run_cli("start", "w1", "--title", "Naming the release", "--from", self.message, "Let us settle it here")
        self.assertEqual((code, err), (0, ""))
        first = out.split()[1]
        self.assertEqual(self.topics_from(), [first])
        # The second person is shown the first, and nothing is saved or sent.
        saved = self.saved("agent-b")
        code, out, err = self.run_cli("start", "w1", "--title", "Release name", "--from", self.message, "Me too", actor="agent-b")
        self.assertEqual(code, 2)
        self.assertEqual(out, 'already started %s "Naming the release" in w1 by agent-a  [active]  (1 messages)\n' % first)
        self.assertIn("ALREADY_STARTED", err)
        self.assertIn("--seen %s" % first, err)
        self.assertEqual(self.saved("agent-b"), saved, "no request was saved")
        self.assertEqual(self.sql("SELECT count(*) FROM openings WHERE actor_id='agent-b'"), [(0,)])
        # Having read it, they can still go ahead.
        code, out, err = self.run_cli("start", "w1", "--title", "Release name", "--from", self.message, "--seen", first, "A separate thread", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(sorted(self.topics_from()), sorted([first, out.split()[1]]))

    def test_a_topic_started_meanwhile_refuses_the_publish_and_publish_seen_finishes_it(self):
        # agent-b's opening from the message is saved, then agent-a's topic from it lands first.
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-b", "title": "Mine", "participants": [],
                                                     "body": "Words", "attachments": [], "source_message_id": self.message},
                                    target={"opening_id": "o-b"}, expected={"opening_revision": 0}, actor="agent-b"))
        code, out, _ = self.run_cli("start", "w1", "--title", "First", "--from", self.message, "Words")
        self.assertEqual(code, 0)
        first = out.split()[1]
        code, out, err = self.run_cli("publish", "o-b", actor="agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("ALREADY_STARTED", err)
        self.assertIn(first, err)
        self.assertEqual(self.topics_from(), [first])
        code, out, err = self.run_cli("publish", "o-b", "--seen", first, actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.startswith('started t-b "Mine" in w1 with '), out)

    def test_seen_without_a_message_and_an_unreadable_message_are_refused_before_anything_is_saved(self):
        for argv, actor, word in ((("start", "w1", "--title", "T", "--seen", "t1", "x"), "agent-a", "INVALID_ARGUMENT"),
                                  (("start", "w1", "--title", "T", "--from", self.message, "--seen", "", "x"), "agent-a", "INVALID_ARGUMENT"),
                                  (("start", "w1", "--title", "T", "--from", "m-missing", "x"), "agent-a", "FORBIDDEN")):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv, actor=actor)
                self.assertEqual((code, out), (2, ""))
                self.assertIn(word, err)
        self.assertEqual(self.saved(), [])
        self.assertEqual(self.sql("SELECT count(*) FROM openings"), [(0,)])

    def test_json_lists_the_topics_already_started_then_the_refusal(self):
        self.assertEqual(self.run_cli("start", "w1", "--title", "First", "--from", self.message, "Words")[0], 0)
        code, out, _ = self.run_cli("--json", "start", "w1", "--title", "Second", "--from", self.message, "Words", actor="agent-b")
        self.assertEqual(code, 2)
        lines = [json.loads(line) for line in out.splitlines()]
        self.assertEqual([item["title"] for item in lines[0]["items"]], ["First"])
        self.assertEqual(lines[-1]["error"]["code"], "ALREADY_STARTED")


if __name__ == "__main__":
    unittest.main()

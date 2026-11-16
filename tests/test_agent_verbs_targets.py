from __future__ import annotations

"""Agent verbs for an outcome's kind, its target and its end (items 14, 104; docs/agent-cli.md, "Targets and checks")."""

import unittest

from test_agent_verbs import AgentVerbCase


class OutcomeKindVerbCase(AgentVerbCase):
    # agent-a coordinates owner's outcome w1 and works in t1; agent-b is a member.

    def kinds(self, outcome):
        return self.sql("SELECT kind,origin FROM outcome_kinds WHERE workspace_id=? ORDER BY seq", (outcome,))

    def new_outcome(self, *more):
        code, out, err = self.run_cli("new-outcome", "--title", "Agent outcome", *more)
        self.assertEqual((code, err), (0, ""))
        return out.split()[2]

    def test_new_outcome_needs_no_kind_and_takes_one_when_given(self):
        self.assertEqual(self.kinds(self.new_outcome()), [("keep", "create")], "the kind is chosen on its page; until then it is to keep")
        self.assertEqual(self.kinds(self.new_outcome("--kind", "reach")), [("reach", "create")])
        code, out, err = self.run_cli("new-outcome", "--title", "Bad kind", "--kind", "finish")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("reach", err)
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces WHERE title='Bad kind'"), [(0,)])

    def test_the_owner_changes_the_kind_and_says_reached_and_no_one_else_does(self):
        outcome = self.new_outcome("--kind", "reach")
        self.assertEqual(self.run_cli("outcome-kind", outcome, "reach"), (0, "%s is an outcome to reach (no change)\n" % outcome, ""))
        code, out, err = self.run_cli("outcome-kind", "w1", "reach")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        code, out, err = self.run_cli("reached", outcome, "The deck went out")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("NOT_MET", err)
        self.assertEqual(self.run_cli("reached", outcome, "--unmet", "The deck went out"), (0, "%s reached; 0 topics closed\n" % outcome, ""))
        code, _, err = self.run_cli("outcome-kind", outcome, "keep")
        self.assertEqual(code, 2)
        self.assertIn("OUTCOME_REACHED", err)
        self.assertNotIn(outcome, self.run_cli("outcomes")[1])
        self.assertIn(outcome, self.run_cli("outcomes", "--reached")[1])


class OutcomeEndVerbCase(OutcomeKindVerbCase):
    """outcome-end and outcomes --ended (item 404, docs/agent-cli.md): the owner archives, completes and brings back."""

    def test_the_owner_archives_completes_and_brings_back_and_the_lists_say_so(self):
        outcome = self.new_outcome()
        self.assertEqual(self.run_cli("outcome-end", outcome, "archived"), (0, "archived Agent outcome (1 topic)\n", ""),
                         "its Conversation is its one topic, and the count includes it")
        self.assertEqual(self.run_cli("outcome-end", outcome, "archived"), (0, "Agent outcome is already archived (no change)\n", ""))
        self.assertEqual(self.run_cli("outcome-end", outcome, "completed"), (0, "completed Agent outcome (topics carried)\n", ""))
        code, out, err = self.run_cli("outcomes")
        self.assertEqual((code, err), (0, ""))
        self.assertNotIn(outcome, out)
        self.assertIn("archived or completed (1): outcomes --ended\n", out)
        code, out, err = self.run_cli("outcomes", "--ended")
        self.assertEqual((code, err), (0, ""))
        self.assertRegex(out, r"^%s  Agent outcome  \(owner agent-a, to keep\)  completed [A-Z][a-z]{2} \d{1,2} by agent-a\n$" % outcome)
        self.assertEqual(self.run_cli("outcome-end", outcome, "open"), (0, "brought back Agent outcome (1 topic)\n", ""))
        code, out, _ = self.run_cli("outcomes")
        self.assertIn(outcome, out)
        self.assertNotIn("archived or completed", out)
        self.assertEqual(self.run_cli("outcomes", "--ended"), (0, "no archived or completed outcomes\n", ""))

    def test_only_the_owner_may_and_the_lists_are_asked_for_one_at_a_time(self):
        code, out, err = self.run_cli("outcome-end", "w1", "archived")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_ends"), [(0,)])
        code, out, err = self.run_cli("outcome-end", "w1", "finished")
        self.assertEqual((code, out), (2, ""))
        code, out, err = self.run_cli("outcomes", "--reached", "--ended")
        self.assertEqual((code, out), (2, ""))


class TargetVerbCase(AgentVerbCase):
    def test_the_coordinator_writes_the_first_words_and_asks_the_owner_with_later_ones(self):
        self.assertEqual(self.run_cli("target", "w1", "Every topic keeps its place."), (0, "target revision 1 is current\n", ""))
        code, out, err = self.run_cli("target", "w1", "Every topic keeps its place.")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("ASK_REQUIRED", err)
        self.assertEqual(self.run_cli("target", "w1", "--ask-in", "t1", "Every topic keeps its place, and loads fast."),
                         (0, "target revision 2 waits on the owner\n", ""))
        message = self.latest()
        self.assertEqual((message[2], message[4]), ("agent-a", '["owner"]'))
        self.assertIn("Every topic keeps its place, and loads fast.", message[3])
        self.assertEqual(self.sql("SELECT revision,outcome,ask_message_id FROM outcome_target_revisions ORDER BY revision"),
                         [(1, "accepted", None), (2, None, message[0])])
        code, out, err = self.run_cli("checks", "w1", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Target (revision 1, by agent-a", out)
        self.assertIn("Proposed (revision 2, by agent-a, waiting on owner): Every topic keeps its place, and loads fast.", out)

    def test_a_member_writes_no_target(self):
        code, out, err = self.run_cli("target", "w1", "My words", actor="agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_target_revisions"), [(0,)])


if __name__ == "__main__":
    unittest.main()

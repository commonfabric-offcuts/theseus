from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from aim_next import invite as invitations
import test_store as fixtures


class Assignment(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql

    def invitation(self, harness):
        return invitations.prompt(
            {"agent": {"id": "sample-agent", "name": "Sample agent"},
             "harness": harness, "title": "Isolated outcome"},
            Path(self.temp.name) / "sample-agent.profile.json", self.path)

    def test_codex_invitation_requests_an_ongoing_goal_with_existing_goal_guards(self):
        words = self.invitation("codex")
        for required in ("persistent goal", "existing goal", "unrelated goals", "user pauses",
                         "token budget", "authorized deliveries", "verify and report",
                         "until the user explicitly ends", "same running session"):
            self.assertIn(required, words)
        self.assertLess(words.index("read the agent guide"), words.index("persistent goal"))
        self.assertIn("never print it, copy it or share it", words)
        self.assertIn("Your Theseus ID is sample-agent", words)
        self.assertLess(len(words.split()), 300, "operational detail belongs in the guide")

    def test_claude_gets_the_ongoing_assignment_and_native_wait_without_codex_tools(self):
        words = self.invitation("claude-code")
        for required in ("ongoing assignment", "authorized deliveries", "verify and report",
                         "until the user explicitly ends", "watch --once", "same running session",
                         "Allow Bash to run that command."):
            self.assertIn(required, words)
        for unsupported in ("persistent goal", "get_goal", "create_goal", "update_goal", "/goal"):
            self.assertNotIn(unsupported, words)

    def test_both_entry_points_use_one_harness_assignment_generator(self):
        self.workspace()
        before = self.sql("SELECT count(*) FROM operations"), self.sql("SELECT max(seq) FROM changes")
        for variant, harness in (("codex", "codex"), ("claude", "claude-code")):
            marker = "ASSIGNMENT SENTINEL " + harness
            # create=True lets the unchanged source fail on behavior, not on a missing helper.
            with patch.object(invitations, "assignment_text", return_value=marker, create=True) as shared:
                direct = self.invitation(harness)
                owner = self.store.view("owner", "onboarding_prompt", {"workspace_id": "w1", "variant": variant})["prompt"]
            self.assertEqual(direct.count(marker), 1)
            self.assertEqual(owner.count(marker), 1)
            self.assertEqual([call.args for call in shared.call_args_list], [(harness,), (harness,)])
        self.assertEqual(before, (self.sql("SELECT count(*) FROM operations"), self.sql("SELECT max(seq) FROM changes")))

    def test_guide_separates_goal_limits_waiting_failures_blockers_and_interruption(self):
        guide = " ".join((Path(__file__).resolve().parents[1] / "docs/agent-guide.md").read_text().split())
        for required in ("Persistent assignment in Codex", "same running session", "duplicate watchers",
                         "Normal silence", "Retryable command failure", "Genuine blocker", "User interruption",
                         "get_goal", "create_goal", "update_goal", "not exercised",
                         "three consecutive goal turns", "does not complete the assignment"):
            self.assertIn(required, guide)
        for retained in ("only its `ack` settles it", "correction's own delivery id", "Reading back what you wrote",
                         "Never send the same thing again as a new command"):
            self.assertIn(retained, guide)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""The `owner` verb: the owner of an outcome hands it to another member."""

from pathlib import Path
import json
import unittest

from aim_next.profile import write_profile
from test_agent_verbs import AgentVerbCase


class OwnerVerbCase(AgentVerbCase):
    # w1 is owner's outcome; agent-a (its coordinator) and agent-b are members;
    # outsider belongs to nothing.

    def setUp(self):
        super().setUp()
        path = Path(self.temp.name).resolve() / "owner.json"
        write_profile(path, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        self.profiles["owner"] = path

    def test_the_owner_hands_the_outcome_on_and_outcomes_shows_it(self):
        self.assertEqual(self.run_cli("owner", "w1", "agent-b", actor="owner"), (0, "w1 is now owned by agent-b (was owner)\n", ""))
        self.assertEqual(self.sql("SELECT owner_id,coordinator_id FROM workspaces WHERE id='w1'"), [("agent-b", "agent-a")])
        self.assertEqual(self.run_cli("outcomes", actor="owner"), (0, "w1  Isolated test  (owner agent-b, to keep)  quiet\n", ""))
        self.assertEqual(self.run_cli("owner", "w1", "agent-b", actor="agent-b"), (0, "w1 is already owned by agent-b\n", ""))
        code, out, err = self.run_cli("--json", "owner", "w1", "owner", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        receipt = [json.loads(line) for line in out.splitlines()][-1]
        self.assertEqual(receipt["result"]["owner_id"], "owner")
        self.assertEqual(receipt["result"]["previous_owner_id"], "agent-b")

    def test_refusals_change_nothing(self):
        before = self.sql("SELECT * FROM workspaces")
        for argv, actor, word in ((("owner", "w1", "agent-a"), "agent-a", "FORBIDDEN"),
                                  (("owner", "w1", "outsider"), "owner", "NOT_A_MEMBER"),
                                  (("owner", "w1", "nobody"), "owner", "INVALID_RECIPIENT"),
                                  (("owner", "w-missing", "agent-b"), "owner", "FORBIDDEN"),
                                  (("owner", "w1"), "owner", "owner OUTCOME ACTOR")):
            with self.subTest(argv=argv):
                code, out, err = self.run_cli(*argv, actor=actor)
                self.assertEqual((code, out), (2, ""))
                self.assertIn(word, err)
        self.assertEqual(self.sql("SELECT * FROM workspaces"), before)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Real isolated CLI effects: ordinary replies and deliberately refused roots."""

from test_codex_host import AGENT, HostCase


class SameDossierFixtureCase(HostCase):
    turns = [{"reply": "Default fixture reply"}]

    def test_default_reply_commits_before_the_separate_ack(self):
        runner = self.runner()
        opening = self.open_topic("Answer this actual request")
        runner.event("host_turn_end", status="completed")
        self.assertEqual(self.replies(), ["Default fixture reply"])
        self.assertEqual(self.sql("SELECT reply_to FROM messages WHERE author_id=?", (AGENT,)),
                         [(opening["message_id"],)])
        receipts = [row for row in self.wire() if "cli" in row]
        self.assertEqual([(row["cli"], row["code"]) for row in receipts], [("reply", 0), ("ack", 0)])
        self.assertIn("posted ", receipts[0]["stdout"])
        self.assertIn("acknowledged ", receipts[1]["stdout"])
        self.assertEqual(self.pending(), [])
        self.stopped_cleanly(runner)


class RefusedRootFixtureCase(HostCase):
    turns = [{"reply": "Deliberate invalid root", "reply_to_delivery": False}]

    def test_deliberate_root_refusal_keeps_output_and_actual_command_exit(self):
        runner = self.runner()
        self.open_topic("An existing dossier makes an unexplained root invalid")
        runner.event("host_turn_end", status="completed")
        receipts = [row for row in self.wire() if "cli" in row]
        self.assertEqual([(row["cli"], row["code"]) for row in receipts], [("post", 2), ("ack", 0)])
        refusal = receipts[0]
        self.assertIn("DIVERGENCE_REASON_REQUIRED", refusal["stdout"] + refusal["stderr"])
        self.assertEqual(refusal["args"], ["post", "t1", "-"])
        self.assertEqual(self.replies(), [])
        commands = [row["out"]["params"]["item"] for row in self.wire()
                    if "out" in row and row["out"].get("method") == "item/completed"
                    and row["out"]["params"]["item"]["type"] == "commandExecution"]
        self.assertEqual([item["exitCode"] for item in commands], [2, 0])
        # Recording a refusal does not turn it into a successful reply.
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id=?", (AGENT,)), [(0,)])
        self.stopped_cleanly(runner)

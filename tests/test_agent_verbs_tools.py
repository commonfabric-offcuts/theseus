from __future__ import annotations

"""The skills-and-tools agent verbs (docs/agent-cli.md, "Skills and tools") and the tool step's bridge to them
(tools/tool_check.LiveCli), run as the live server runs them: the real `bin/aim-next` of a copy of this code whose
checkout holds the fixture's records, so its Store reads those records as a deployed one reads its own.

Every outcome and tool here is invented: outcome w1 ("Isolated test", coordinator agent-a, member agent-b, topic t1)
homes a kite flyer (a tool with a check) and a kite guide (a written skill); w2 ("Kite club", agent-b) homes a spool
winder; "outsider" is an agent on neither."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from aim_next import Store
from test_agent_verbs import AgentVerbCase
from test_tool_core import BACK, run, write_tools
from tools import tool_check

ROOT = Path(__file__).resolve().parents[1]


class ToolVerbCase(AgentVerbCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.place = tempfile.TemporaryDirectory(prefix="aim-next-tool-verbs-")
        code = Path(cls.place.name) / "code"
        shutil.copytree(str(ROOT / "aim_next"), str(code / "aim_next"), ignore=shutil.ignore_patterns("__pycache__"))
        (code / "bin").mkdir()
        shutil.copy2(str(ROOT / "bin" / "aim-next"), str(code / "bin" / "aim-next"))
        cls.code = write_tools(code)
        cls.cli = cls.code / "bin" / "aim-next"

    @classmethod
    def tearDownClass(cls):
        cls.place.cleanup()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        # The fixture's own Store over the same records the copied CLI reads.
        self.store = Store(self.path, "test-instance", expected_binding=self.binding, tools=self.code)
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Kite club", "purpose": "", "team": ["agent-b"],
                                                         "coordinator": "agent-b"}))

    def run_cli(self, *argv, actor="agent-a", stdin=b""):
        answer = subprocess.run([sys.executable, "-I", "-B", str(self.cli), "--profile", str(self.profiles[actor])] + list(argv),
                                input=stdin, capture_output=True)
        return answer.returncode, answer.stdout.decode("utf-8"), answer.stderr.decode("utf-8")

    def run_file(self, fields, home="w1", name="run.json"):
        path = Path(self.temp.name) / name
        path.write_text(json.dumps(dict(fields, home_workspace_id=home)))
        return path

    def live_content(self, tool_id="kite-flyer"):
        return self.store.tool_records.content[tool_id]


class UseAndLinkCase(ToolVerbCase):
    def test_tool_use_says_the_outcome_uses_it_and_off_says_it_no_longer_does(self):
        self.assertEqual(self.run_cli("tool-use", "kite-flyer", "w2", actor="agent-b"), (0, "w2 uses kite-flyer\n", ""))
        self.assertEqual(self.sql("SELECT workspace_id,tool_id,used FROM tool_uses ORDER BY seq"), [("w2", "kite-flyer", 1)])
        self.assertEqual(self.run_cli("tool-use", "kite-flyer", "w2", actor="agent-b"), (0, "w2 uses kite-flyer (no change)\n", ""))
        self.assertEqual(self.run_cli("tool-use", "kite-flyer", "w2", "--off", actor="agent-b"), (0, "w2 does not use kite-flyer\n", ""))
        self.assertEqual(self.sql("SELECT used FROM tool_uses ORDER BY seq"), [(1,), (0,)], "the same answer wrote nothing")
        code, out, err = self.run_cli("tool-use", "kite-flyer", "w2", actor="outsider")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_uses"), [(2,)], "a refusal writes no row")

    def test_tool_link_says_a_topic_is_about_it_and_off_says_it_is_not(self):
        self.assertEqual(self.run_cli("tool-link", "kite-flyer", "t1"), (0, "t1 is about kite-flyer\n", ""))
        self.assertEqual(self.sql("SELECT topic_id,tool_id,linked FROM tool_links ORDER BY seq"), [("t1", "kite-flyer", 1)])
        self.assertEqual(self.run_cli("tool-link", "kite-flyer", "t1"), (0, "t1 is about kite-flyer (no change)\n", ""))
        self.assertEqual(self.run_cli("tool-link", "kite-flyer", "t1", "--off"), (0, "t1 is not about kite-flyer\n", ""))
        self.assertEqual(self.sql("SELECT linked FROM tool_links ORDER BY seq"), [(1,), (0,)])
        code, out, err = self.run_cli("tool-link", "spool-winder", "t1")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("TOPIC_NOT_IN_HOME", err)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_links"), [(2,)])


class RecordCase(ToolVerbCase):
    def test_tool_record_records_a_run_once_and_a_version_that_went_back_opens_its_topic(self):
        path = self.run_file(run(**BACK))
        code, out, err = self.run_cli("tool-record", str(path))
        self.assertEqual((code, err), (0, ""))
        [(topic,)] = self.sql("SELECT topic_id FROM tool_runs")
        self.assertIsNotNone(topic)
        self.assertEqual(out, "kite-flyer back recorded (topic %s)\n" % topic)
        self.assertEqual(self.sql("SELECT title,workspace_id FROM topics WHERE id=?", (topic,)), [("Kite flyer went back to its live version", "w1")])
        self.assertEqual(self.run_cli("tool-record", str(path)), (0, "kite-flyer back was already recorded (topic %s)\n" % topic, ""))
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(1,)])

    def test_a_file_with_no_home_or_that_cannot_be_read_sends_nothing(self):
        bare = Path(self.temp.name) / "bare.json"
        bare.write_text(json.dumps(run()))
        for path, words in ((bare, "names its home_workspace_id"), (Path(self.temp.name) / "missing.json", "could not be read")):
            with self.subTest(path=path.name):
                code, out, err = self.run_cli("tool-record", str(path))
                self.assertEqual((code, out), (2, ""))
                self.assertIn(words, err)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])
        code, out, err = self.run_cli("tool-record", str(self.run_file(run())), actor="outsider")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])


class ReadCase(ToolVerbCase):
    def test_tools_prints_each_tool_with_the_word_its_check_reads(self):
        self.assertEqual(self.run_cli("tools", "w1"), (0, "Its own:\n"
                                                          "  kite-flyer  Kite flyer  (tool)  Its check has not run on this version yet\n"
                                                          "  kite-guide  Kite guide  (skill)  Not evaluated yet: it has no check\n"
                                                          "Used here: none\n", ""))
        self.committed(self.command("tool.record", {"run": run(content_id=self.live_content())}, {"workspace_id": "w1"}, actor="agent-a"))
        self.committed(self.command("tool.use", {"tool_id": "kite-flyer", "used": True}, {"workspace_id": "w2"}, actor="agent-b"))
        code, out, err = self.run_cli("tools", "w2", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        lines = out.splitlines()
        self.assertEqual(lines[:3], ["Its own:", "  spool-winder  Spool winder  (tool)  Its check has not run on this version yet", "Used here:"])
        self.assertRegex(lines[3], r"^  kite-flyer  Kite flyer  \(tool\)  Its check passed: 42 of 42 · \d{4}-\d\d-\d\d \d\d:\d\d$")
        self.assertEqual(len(lines), 4)

    def test_tool_prints_its_checks_word_users_went_back_and_topics(self):
        code, out, err = self.run_cli("tool", "kite-flyer")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "Kite flyer  (Tool)  Flies a kite on a schedule\n"
                              "Home: Isolated test\n"
                              "Its check: Its check has not run on this version yet\n"
                              "Used by: No outcome says it uses this yet.\n"
                              "Files: skills/kite-flyer.json\n"
                              "  tools/kite.py\n"
                              "  tests/test_tools_kite.py  (its check)\n")
        # Two versions that went back (each opens its topic, linked), the newer on the live content, so its check reads
        # failed on this version; a user; a linked topic. Read by agent-b, who is on both outcomes.
        older = self.committed(self.command("tool.record", {"run": run(**BACK)}, {"workspace_id": "w1"}, actor="agent-a"))
        newer = self.committed(self.command("tool.record", {"run": run(**dict(BACK, content_id=self.live_content(), tree_sha="c" * 40))},
                                            {"workspace_id": "w1"}, actor="agent-a"))
        topics = [older["run"]["topic"]["topic_id"], newer["run"]["topic"]["topic_id"]]
        self.committed(self.command("tool.use", {"tool_id": "kite-flyer", "used": True}, {"workspace_id": "w2"}, actor="agent-b"))
        self.committed(self.command("tool.link", {"tool_id": "kite-flyer", "linked": True}, {"topic_id": "t1"}, actor="agent-a"))
        code, out, err = self.run_cli("tool", "kite-flyer", "--went-back", "1", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        lines = out.splitlines()
        self.assertEqual(lines[:4], ["Kite flyer  (Tool)  Flies a kite on a schedule", "Home: Isolated test",
                                     "Its check: Its check failed on this version: 3 of 42 failed", "Used by: Kite club"])
        self.assertRegex(lines[4], r"^Went back \d{4}-\d\d-\d\d \d\d:\d\d: A new version failed its check \(3 of 42 failed: "
                                   r"test_reads_the_commit, test_restores, test_control_again\) and went back to its live version\. "
                                   r"Topic: Kite flyer went back to its live version \(%s\)\.$" % topics[1], "the newest, one of them")
        self.assertEqual(lines[5:9], ["  (more went back; --went-back N shows more)"]
                         + ["Topic about it: %s  Kite flyer went back to its live version  [active]" % topic for topic in sorted(topics)]
                         + ["Topic about it: t1  Topic  [active]"])
        self.assertEqual(lines[9:], ["Files: skills/kite-flyer.json", "  tools/kite.py", "  tests/test_tools_kite.py  (its check)"])
        # Someone on neither outcome sees both counted, never named.
        code, out, err = self.run_cli("tool", "kite-flyer", actor="outsider")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Home: an outcome you are not on (w1)\n", out)
        self.assertIn("Used by: 1 outcome you cannot open\n", out)
        self.assertIn("and 3 topics you cannot open\n", out)
        for name in ("Isolated test", "Kite club", "Topic about it"):
            self.assertNotIn(name, out)
        self.assertNotIn("passed", out, "a failed check never reads as a pass")


class LiveCliCase(ToolVerbCase):
    """tools/tool_check.LiveCli, the step's bridge to the live CLI, run against the real copied CLI."""

    def live(self, actor="agent-a"):
        return tool_check.LiveCli(self.cli, self.profiles[actor], python=sys.executable)

    def test_it_reads_the_actor_and_views_and_records_a_run_through_the_cli(self):
        cli = self.live()
        self.assertEqual(cli.actor(), "agent-a")
        self.assertEqual(cli.view("capabilities", {})["actor_kind"], "agent")
        self.assertEqual(cli.view("tool", {"tool_id": "kite-flyer"})["tool"]["word"]["state"], "not_run")
        self.assertEqual(cli.view("tool", {"tool_id": "no-such-tool"})["error"]["code"], "TOOL_NOT_FOUND")
        receipt = cli.record(self.run_file(run(**BACK)))
        self.assertEqual((receipt.get("status"), receipt["result"]["recorded"]), ("committed", True), receipt)
        [(topic,)] = self.sql("SELECT topic_id FROM tool_runs")
        self.assertEqual(receipt["result"]["run"]["topic"]["topic_id"], topic)
        again = cli.record(self.run_file(run(**BACK)))
        self.assertEqual((again.get("status"), again["result"]["recorded"]), ("committed", False))
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(1,)])

    def test_a_refused_record_comes_back_as_its_error_and_records_nothing(self):
        receipt = self.live("outsider").record(self.run_file(run(**BACK)))
        self.assertEqual(receipt["error"]["code"], "FORBIDDEN", receipt)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])


if __name__ == "__main__":
    unittest.main()

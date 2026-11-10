from __future__ import annotations

import functools
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

from tools import acts, mutant


class Acts(unittest.TestCase):
    """A ledger's acts, each with a break and the check that must catch it, run in a folder of their own."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "tests").mkdir()
        self.subject = self.root / "subject.py"
        self.original = "def thumb(on):\n    return 'up' if on else None\n\n\ndef words(on):\n    return 'thumbed up' if on else 'took it back'\n"
        self.subject.write_text(self.original)
        # The check covers thumb() and never looks at words().
        (self.root / "tests" / "test_subject.py").write_text(
            "import unittest\nfrom subject import thumb\n\n\nclass T(unittest.TestCase):\n"
            "    def test_thumb(self):\n        self.assertEqual((thumb(True), thumb(False)), ('up', None))\n")
        self.ledger = self.root / "acts.json"
        self.ledger.write_text(json.dumps({"acts": [
            {"item": 25, "act": "A thumbs-up is kept", "break": [["subject.py", "return 'up' if on else None", "return None"]],
             "check": {"python": "test_subject.py"}},
            {"item": 25, "act": "The words say what was done", "break": [["subject.py", "'thumbed up' if on", "'took it back' if on"]],
             "check": {"python": "test_subject.py"}},
            {"item": 124, "act": "A break that no longer applies", "break": [["subject.py", "return 'yes'", "return 'no'"]],
             "check": {"python": "test_subject.py"}},
        ]}))
        self.evidence = self.root / "evidence"
        # Each check runs where the ledger's files are, as tools/acts.py runs the repository's checks from its root.
        patcher = mock.patch.object(mutant.subprocess, "run", functools.partial(subprocess.run, cwd=str(self.root)))
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def results(self, only=None):
        return [(act["act"], acts.line(act, verdict)) for act, verdict in
                acts.run(self.ledger, self.evidence, only, python=sys.executable, root=self.root)]

    def test_an_act_is_caught_only_when_its_check_fails_on_its_break_and_passes_without_it(self):
        lines = dict(self.results())
        self.assertTrue(lines["A thumbs-up is kept"].endswith("caught: FAIL: test_thumb (test_subject.T)"), lines)
        self.assertTrue(lines["The words say what was done"].endswith("SURVIVED"), lines)
        self.assertIn("refused: \"return 'yes'\" occurs 0 times", lines["A break that no longer applies"])
        self.assertEqual(self.subject.read_text(), self.original)

    def test_only_runs_the_acts_whose_item_or_words_match(self):
        self.assertEqual([act for act, _ in self.results("^124 ")], ["A break that no longer applies"])
        self.assertEqual([act for act, _ in self.results("words say")], ["The words say what was done"])

    def test_main_exits_0_only_when_every_act_chosen_was_caught(self):
        with mock.patch.object(acts.os, "chdir"), mock.patch.object(acts, "REPO", self.root), \
                mock.patch.object(acts, "run", functools.partial(acts.run, python=sys.executable, root=self.root)):
            with redirect_stdout(io.StringIO()) as out:
                self.assertEqual(acts.main([str(self.ledger), "--evidence", str(self.evidence / "all")]), 1)
            self.assertIn("1 of 3 acts caught", out.getvalue())
            with redirect_stdout(io.StringIO()):
                self.assertEqual(acts.main([str(self.ledger), "--evidence", str(self.evidence / "one"), "--only", "is kept"]), 0)
                self.assertEqual(acts.main([str(self.ledger), "--evidence", str(self.evidence / "none"), "--only", "nothing matches"]), 1)
            with mock.patch("sys.stderr", io.StringIO()):
                self.assertEqual(acts.main([str(self.ledger), "--evidence", "relative"]), 2)

    def test_a_browser_case_fails_on_its_failed_line_and_each_run_gets_a_fresh_output_folder(self):
        argv, killed_by = acts.command({"native": "reading", "case": "reading 👍"}, self.evidence, python="/usr/bin/python3")
        self.assertEqual(killed_by, acts.NATIVE_KILLED_BY)
        self.assertEqual(argv[:2], ["/bin/sh", "-c"])
        self.assertEqual(argv[4:], [str(self.evidence), "/usr/bin/python3", "reading", "reading 👍"])
        # Echo stands in for the interpreter: each run names a new folder under the evidence for tools/native.py.
        self.evidence.mkdir()
        echo, _ = acts.command({"native": "reading", "case": "reading 👍"}, self.evidence, python="/bin/echo")
        outs = [subprocess.run(echo, capture_output=True, text=True, check=True).stdout.split() for _ in range(2)]
        self.assertEqual([out[:2] + out[3:] for out in outs], [["tools/native.py", "--out", "reading", "reading", "👍"]] * 2)
        self.assertNotEqual(outs[0][2], outs[1][2])
        self.assertTrue(all(Path(out[2]).parent.parent == self.evidence and Path(out[2]).name == "run" and not Path(out[2]).exists() for out in outs))
        with self.assertRaises(ValueError):
            acts.command({"native": "reading"}, self.evidence)


class Ledger(unittest.TestCase):
    """tests/acts.json: every act names its item, a break and one check of a kind the runner runs."""

    def test_every_act_has_an_item_a_break_and_a_check_the_runner_knows(self):
        ledger = json.loads((acts.REPO / "tests" / "acts.json").read_text())
        self.assertTrue(ledger["acts"])
        for act in ledger["acts"]:
            with self.subTest(act=act.get("act")):
                self.assertIsInstance(act["item"], int)
                self.assertTrue(act["act"].strip())
                self.assertTrue(act["break"] and all(len(change) == 3 and change[1] != change[2] for change in act["break"]))
                acts.command(act["check"], Path("/evidence"))

    def test_every_break_still_applies_to_the_code_it_names(self):
        # A redraw that rewrites a break's text leaves its act with no proof; tools/acts.py would only say "refused".
        for act in json.loads((acts.REPO / "tests" / "acts.json").read_text())["acts"]:
            with self.subTest(item=act["item"], act=act["act"]):
                try:
                    mutant.plan([(str(acts.REPO / name), old, new) for name, old, new in act["break"]])
                except mutant.Refused as refusal:
                    self.fail("item %s: %s: %s" % (act["item"], act["act"], refusal))


if __name__ == "__main__":
    unittest.main()

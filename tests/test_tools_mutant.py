from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import mutant

# A stand-in test: it fails, printing unittest's FAILED line, when the target says "gamma".
CHECK = ("import os, sys; text = open(sys.argv[1]).read(); print('cache=' + os.environ.get('PYTHONPYCACHEPREFIX', ''));"
         "bad = 'gamma' in text; print('FAILED (failures=1)' if bad else 'OK'); sys.exit(int(bad))")


class Mutant(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.target = self.base / "target.py"
        self.original = b"alpha = 'beta'\nomega = 1\n"
        self.target.write_bytes(self.original)
        self.evidence = self.base / "evidence"

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, script=CHECK):
        return [sys.executable, "-c", script, str(self.target)]

    def mutate(self, old="beta", new="gamma", script=CHECK, replacements=None):
        return mutant.mutate(replacements or [(str(self.target), old, new)], self.command(script), self.evidence)

    def test_a_test_that_fails_with_a_failed_line_kills_the_mutant_and_the_file_is_restored(self):
        verdict = self.mutate()
        self.assertEqual((verdict["killed"], verdict["ok"], verdict["failed_line"]), (True, True, "FAILED (failures=1)"))
        self.assertEqual(verdict["mutant_exit"], 1)
        self.assertTrue(verdict["control_passed"])
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertTrue(verdict["applied"])
        caches = [line for name in ("mutant.log", "control.log")
                  for line in (self.evidence / name).read_text().splitlines() if line.startswith("cache=")]
        self.assertEqual(len(caches), 2)
        self.assertNotEqual(caches[0], caches[1])
        self.assertTrue(all(len(line) > len("cache=") for line in caches))
        self.assertEqual(json.loads((self.evidence / "verdict.json").read_text())["ok"], True)

    def test_a_mutant_the_tests_pass_survives(self):
        verdict = self.mutate(old="omega = 1", new="omega = 2")
        self.assertFalse(verdict["killed"])
        self.assertFalse(verdict["ok"])
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_a_crash_or_a_failed_line_alone_is_not_a_kill(self):
        crash = "import sys; text = open(sys.argv[1]).read(); sys.exit(3 if 'gamma' in text else 0)"
        self.assertFalse(self.mutate(script=crash)["killed"])
        printed = "import sys; text = open(sys.argv[1]).read(); print('FAILED' if 'gamma' in text else 'OK')"
        self.assertFalse(self.mutate(script=printed)["killed"])
        node = "import sys; text = open(sys.argv[1]).read(); print('not ok 1 - case' if 'gamma' in text else 'ok'); sys.exit('gamma' in text)"
        self.assertTrue(self.mutate(script=node)["killed"])

    def test_a_control_that_fails_after_restoring_is_not_ok(self):
        always = "print('FAILED (errors=1)'); raise SystemExit(1)"
        verdict = self.mutate(script=always)
        self.assertTrue(verdict["killed"])
        self.assertFalse(verdict["control_passed"])
        self.assertFalse(verdict["ok"])

    def test_refusals_change_nothing(self):
        for old, new in (("absent", "x"), ("a", "x"), ("beta", "beta")):
            with self.subTest(old=old):
                with self.assertRaises(mutant.Refused):
                    self.mutate(old=old, new=new)
                self.assertEqual(self.target.read_bytes(), self.original)
        with self.assertRaises(mutant.Refused):
            self.mutate(replacements=[(str(self.target), "beta", "gamma"), (str(self.base / "missing.py"), "a", "b")])
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertFalse(self.evidence.exists())

    def test_replacements_in_one_file_apply_in_order_and_restore_to_the_original(self):
        verdict = self.mutate(replacements=[(str(self.target), "beta", "delta"), (str(self.target), "delta", "gamma")])
        self.assertTrue(verdict["killed"])
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_the_file_is_restored_when_the_run_is_interrupted_or_cannot_start(self):
        with mock.patch.object(mutant, "run", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.mutate()
        self.assertEqual(self.target.read_bytes(), self.original)
        verdict = mutant.mutate([(str(self.target), "beta", "gamma")], [str(self.base / "no-such-command")],
                                self.base / "evidence-2")
        self.assertEqual((verdict["killed"], verdict["mutant_exit"], verdict["restored"]), (False, None, True))
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_main_exit_codes(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(mutant.main(["--evidence", str(self.evidence), "--replace", str(self.target), "beta", "gamma",
                                          "--"] + self.command()), 0)
        self.assertIn('"killed": true', out.getvalue())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(mutant.main(["--evidence", str(self.base / "e2"), "--replace", str(self.target), "omega = 1",
                                          "omega = 2", "--"] + self.command()), 1)
        with redirect_stderr(io.StringIO()):
            self.assertEqual(mutant.main(["--replace", str(self.target), "absent", "x", "--"] + self.command()), 2)
            self.assertEqual(mutant.main(["--replace", str(self.target), "beta", "gamma"]), 2)
            self.assertEqual(mutant.main(["--replace", str(self.target), "beta", "gamma", "--"]), 2)
        self.assertEqual(self.target.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()

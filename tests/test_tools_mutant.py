from __future__ import annotations

import functools
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import mutant

# A stand-in test: it fails, printing unittest's FAIL and FAILED lines, when the target says "gamma".
CHECK = ("import os, sys; text = open(sys.argv[1]).read(); print('cache=' + os.environ.get('PYTHONPYCACHEPREFIX', ''));"
         "bad = 'gamma' in text; print('FAIL: test_alpha (t.T)\\nFAILED (failures=1)' if bad else 'OK'); sys.exit(int(bad))")


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
        self.assertEqual((verdict["killed"], verdict["ok"], verdict["failed_line"]), (True, True, "FAIL: test_alpha (t.T)"))
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
        node = ("import sys; text = open(sys.argv[1]).read(); print(\"not ok 1 - case\\n  code: 'ERR_ASSERTION'\" if 'gamma' in text"
                " else 'ok'); sys.exit('gamma' in text)")
        self.assertTrue(self.mutate(script=node)["killed"])

    def test_only_a_failed_assertion_kills_a_mutant_not_a_test_run_that_cannot_load(self):
        # A mutant that breaks the syntax of the code under test makes unittest discover and node --test
        # report every test module as an error and print FAILED / not ok, yet no assertion ran.
        package = self.base / "suite"
        (package / "tests").mkdir(parents=True)
        code = package / "subject.py"
        code.write_text("def one():\n    return 1\n")
        (package / "tests" / "__init__.py").write_text("")
        (package / "tests" / "test_code.py").write_text(
            "import unittest\nfrom subject import one\n\n\nclass One(unittest.TestCase):\n"
            "    def test_one(self):\n        self.assertEqual(one(), 1)\n")
        discover = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."]
        with mock.patch.object(mutant.subprocess, "run", functools.partial(subprocess.run, cwd=str(package))):
            crash = mutant.mutate([(str(code), "return 1", "return (")], discover, self.base / "e-syntax")
            self.assertTrue(crash["control_passed"])
            self.assertNotEqual(crash["mutant_exit"], 0)
            self.assertEqual((crash["killed"], crash["ok"], crash["failed_line"]), (False, False, None))
            caught = mutant.mutate([(str(code), "return 1", "return 2")], discover, self.base / "e-assert")
            self.assertEqual((caught["killed"], caught["ok"]), (True, True))
            self.assertTrue(caught["failed_line"].startswith("FAIL: test_one"), caught["failed_line"])
        self.assertEqual(code.read_text(), "def one():\n    return 1\n")
        tap_load_failure = ("print('# SyntaxError: Unexpected token'); print('not ok 1 - a.test.mjs');"
                            "print(\"  code: 'ERR_TEST_FAILURE'\"); raise SystemExit('gamma' in open(__import__('sys').argv[1]).read())")
        self.assertFalse(self.mutate(script=tap_load_failure)["killed"])
        tap_assertion = ("print('not ok 1 - f is one'); print(\"  code: 'ERR_ASSERTION'\");"
                         "raise SystemExit('gamma' in open(__import__('sys').argv[1]).read())")
        self.assertTrue(self.mutate(script=tap_assertion)["killed"])

    def test_a_control_that_fails_after_restoring_is_not_ok(self):
        always = "print('FAIL: test_alpha (t.T)'); raise SystemExit(1)"
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


def sha(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


class KeptEvidence(unittest.TestCase):
    """A verdict names the exact revision, and the mutant checkout stays for the reviewer."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.repo = self.base / "repo"
        (self.repo / "pkg").mkdir(parents=True)
        self.target = self.repo / "pkg" / "target.py"
        self.original = b"alpha = 'beta'\nomega = 1\n"
        self.target.write_bytes(self.original)
        (self.repo / "other.txt").write_bytes(b"committed\n")
        (self.repo / "gone.txt").write_bytes(b"deleted later\n")
        (self.repo / ".gitignore").write_bytes(b"ignored.txt\n")
        for argv in (["init", "-q"], ["add", "-A"],
                     ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "base"]):
            subprocess.run(["git", "-C", str(self.repo)] + argv, check=True, capture_output=True)
        self.head = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"], check=True,
                                   capture_output=True, text=True).stdout.strip()
        self.evidence = self.base / "evidence"

    def tearDown(self):
        self.tmp.cleanup()

    def mutate(self, replacements=None, evidence=None):
        return mutant.mutate(replacements or [(str(self.target), "beta", "gamma")],
                             [sys.executable, "-c", CHECK, str(self.target)], evidence or self.evidence)

    def test_a_clean_checkout_records_its_commit_hashes_and_the_exact_replacement(self):
        verdict = self.mutate()
        self.assertTrue(verdict["ok"])
        self.assertEqual(verdict["revision"], {"root": str(self.repo.resolve()), "commit": self.head, "dirty": []})
        mutated = self.original.replace(b"beta", b"gamma")
        self.assertEqual(verdict["replacements"], [{"file": "pkg/target.py", "old": "beta", "new": "gamma"}])
        self.assertEqual(verdict["hashes"], [{"file": "pkg/target.py", "original_sha256": sha(self.original),
                                              "mutated_sha256": sha(mutated), "restored_sha256": sha(self.original)}])
        self.assertEqual(json.loads((self.evidence / "verdict.json").read_text())["revision"]["commit"], self.head)
        patch = (self.evidence / "mutant.patch").read_text()
        self.assertIn("-alpha = 'beta'", patch)
        self.assertIn("+alpha = 'gamma'", patch)

    def test_the_mutant_checkout_is_kept_with_the_mutant_applied_and_everything_else_as_it_was(self):
        verdict = self.mutate()
        checkout = Path(verdict["checkout"])
        self.assertEqual(checkout, self.evidence / "checkout")
        self.assertEqual((checkout / "pkg" / "target.py").read_bytes(), self.original.replace(b"beta", b"gamma"))
        self.assertEqual((checkout / "other.txt").read_bytes(), b"committed\n")
        self.assertFalse((checkout / ".git").exists(), "the checkout is files, not a second repository")
        # The source tree itself is back as it was.
        self.assertEqual(self.target.read_bytes(), self.original)
        # The same command, run in the kept checkout, still kills the mutant there.
        rerun = subprocess.run([sys.executable, "-c", CHECK, str(checkout / "pkg" / "target.py")],
                               capture_output=True, text=True)
        self.assertEqual(rerun.returncode, 1)
        self.assertIn("FAIL: test_alpha", rerun.stdout)

    def test_a_dirty_tree_is_recorded_and_its_changes_are_in_the_checkout(self):
        (self.repo / "other.txt").write_bytes(b"edited, not committed\n")
        (self.repo / "new.txt").write_bytes(b"untracked\n")
        (self.repo / "ignored.txt").write_bytes(b"ignored\n")
        (self.repo / "gone.txt").unlink()
        verdict = self.mutate()
        self.assertEqual(verdict["revision"]["commit"], self.head)
        self.assertEqual(sorted(verdict["revision"]["dirty"]), [" D gone.txt", " M other.txt", "?? new.txt"])
        checkout = Path(verdict["checkout"])
        self.assertEqual((checkout / "other.txt").read_bytes(), b"edited, not committed\n")
        self.assertEqual((checkout / "new.txt").read_bytes(), b"untracked\n")
        self.assertFalse((checkout / "gone.txt").exists())
        self.assertFalse((checkout / "ignored.txt").exists())

    def test_verify_confirms_each_kill_against_the_recorded_revision_and_catches_a_changed_checkout(self):
        self.mutate()
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(mutant.main(["--verify", str(self.evidence)]), 0)
        self.assertIn("ok pkg/target.py", out.getvalue())
        # A checkout changed after the run no longer speaks for the verdict.
        (self.evidence / "checkout" / "pkg" / "target.py").write_bytes(b"alpha = 'delta'\nomega = 1\n")
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(mutant.main(["--verify", str(self.evidence)]), 1)
        self.assertIn("checkout pkg/target.py", out.getvalue())

    def test_verify_refuses_an_original_that_is_not_the_recorded_commit(self):
        # The file was edited but not committed before the run: the commit alone cannot reproduce it.
        self.target.write_bytes(b"alpha = 'beta'\nomega = 3\n")
        self.mutate()
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(mutant.main(["--verify", str(self.evidence)]), 0)
        self.assertIn("pkg/target.py differs from %s" % self.head, out.getvalue())
        # A copy of the original that does not hash as recorded fails.
        copy = next(self.evidence.glob("original-0-*"))
        copy.write_bytes(b"alpha = 'beta'\nomega = 4\n")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(mutant.main(["--verify", str(self.evidence)]), 1)

    def test_reviewed_removes_the_kept_checkout_and_says_when(self):
        self.mutate()
        with redirect_stdout(io.StringIO()):
            self.assertEqual(mutant.main(["--reviewed", str(self.evidence)]), 0)
        self.assertFalse((self.evidence / "checkout").exists())
        verdict = json.loads((self.evidence / "verdict.json").read_text())
        self.assertTrue(verdict["checkout_removed_at"])
        self.assertTrue((self.evidence / "mutant.patch").is_file())
        with redirect_stderr(io.StringIO()):
            self.assertEqual(mutant.main(["--reviewed", str(self.base / "no-such-evidence")]), 2)

    def test_files_outside_a_git_checkout_keep_a_checkout_of_the_mutated_files(self):
        loose = self.base / "loose"
        loose.mkdir()
        target = loose / "target.py"
        target.write_bytes(self.original)
        verdict = mutant.mutate([(str(target), "beta", "gamma")], [sys.executable, "-c", CHECK, str(target)],
                                self.base / "e-loose")
        self.assertEqual(verdict["revision"], {"root": str(loose.resolve()), "commit": None, "dirty": None})
        self.assertEqual((Path(verdict["checkout"]) / "target.py").read_bytes(), self.original.replace(b"beta", b"gamma"))
        self.assertEqual(target.read_bytes(), self.original)

    def test_files_in_two_checkouts_are_refused_before_anything_changes(self):
        elsewhere = self.base / "elsewhere.py"
        elsewhere.write_bytes(b"x = 1\n")
        with self.assertRaises(mutant.Refused):
            self.mutate(replacements=[(str(self.target), "beta", "gamma"), (str(elsewhere), "x = 1", "x = 2")])
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertFalse(self.evidence.exists())


if __name__ == "__main__":
    unittest.main()

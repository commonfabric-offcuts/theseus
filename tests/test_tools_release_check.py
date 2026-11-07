from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import release_check

ROOT = Path(__file__).resolve().parents[1]

# A stand-in for node: `--test` prints a TAP summary; a harness writes its
# results file into the evidence directory. STUB_FAIL names a step to fail;
# "exit-only-<name>" writes passing results and still exits non-zero.
STUB_NODE = r'''#!%s
import json, os, sys
args = sys.argv[1:]
fail = os.environ.get("STUB_FAIL", "")
if args[0] == "--test":
    bad = int(fail == "node-units")
    print("# tests 2\n# pass %%d\n# fail %%d\n# cancelled 0" %% (2 - bad, bad))
    sys.exit(bad)
harness, chrome, evidence, flags = args[0], args[1], args[2], args[3:]
name = os.path.basename(harness).replace("_native.mjs", "") + "".join(flags)
bad = fail == name
if harness.endswith("reader_native.mjs"):
    results = [{"name": "case", "passed": not bad}]
    report = {"closed": True, "results": results}
    path = "results.json"
else:
    report = {"browserClosed": True, "results": [{"name": "case", "passed": not bad}]}
    path = "native.json"
if fail != "no-results-" + name:
    open(os.path.join(evidence, path), "w").write(json.dumps(report))
sys.exit(int(bad or fail == "exit-only-" + name))
'''

STUB_PYTHON = r'''#!%s
import os, subprocess, sys
if os.environ.get("STUB_FAIL") == "python-units":
    print("Ran 3 tests in 0.1s\n\nFAILED (failures=1)")
    sys.exit(1)
if os.environ.get("STUB_FAIL") == "dirty":
    open("stray.txt", "w").write("left behind")
if os.environ.get("STUB_FAIL") == "commit":
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty",
                    "-m", "moved"], check=True)
print("Ran 3 tests in 0.1s\n\nOK (skipped=1)")
sys.exit(int(os.environ.get("STUB_FAIL") == "exit-only-python-units"))
'''


def script(path, text):
    path.write_text(text % sys.executable)
    path.chmod(0o755)
    return str(path)


def good_summary(commit):
    return {"tool": release_check.TOOL, "commit": commit, "tree_unchanged": True, "passed": True,
            "required": list(release_check.REQUIRED),
            "steps": [{"name": name, "exit": 0, "passed": True} for name in release_check.REQUIRED]}


class FakeCheckout(unittest.TestCase):
    """A committed checkout holding the harness files, and stub interpreters."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "checkout"
        (self.root / "tests").mkdir(parents=True)
        for harness in {step.harness for step in release_check.NATIVE_STEPS}:
            (self.root / harness).write_text("// stand-in\n")
        (self.root / "tests" / "a.test.mjs").write_text("// stand-in\n")
        for argv in (["init", "-q"], ["add", "-A"],
                     ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "base"]):
            subprocess.run(["git", "-C", str(self.root)] + argv, check=True, capture_output=True)
        self.commit = release_check.tree(self.root)[0]
        self.node = script(base / "node", STUB_NODE)
        self.python = script(base / "python", STUB_PYTHON)
        self.out = base / "out"
        patcher = mock.patch.object(release_check, "world_writable_ancestor", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, fail=""):
        with mock.patch.dict(os.environ, {"STUB_FAIL": fail}), redirect_stdout(io.StringIO()):
            return release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX,
                                       self.python, self.node)


class ReleaseCheckRuns(FakeCheckout):
    def test_every_step_passing_writes_a_passed_summary_for_the_commit(self):
        summary = self.check()
        self.assertTrue(summary["passed"])
        self.assertEqual([step["name"] for step in summary["steps"]], list(release_check.REQUIRED))
        written = json.loads((self.out / "summary.json").read_text())
        self.assertEqual(written["commit"], self.commit)
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit), [])
        python = written["steps"][0]
        self.assertEqual((python["counts"]["tests"], python["counts"]["skipped"]), (3, 1))
        # Each step gets its own bytecode cache, never the checkout's.
        self.assertTrue((self.out / "pyc").is_dir())

    def test_one_failing_native_mode_fails_the_run_and_the_summary_names_it(self):
        summary = self.check(fail="reader_persistence--colors")
        self.assertFalse(summary["passed"])
        failed = [step["name"] for step in summary["steps"] if not step["passed"]]
        self.assertEqual(failed, ["native-colors"])
        # The run went on to the steps after the failure, so one run shows everything.
        self.assertEqual(len(summary["steps"]), len(release_check.REQUIRED))
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit),
                         ["native-colors failed (exit 1)"])

    def test_a_harness_that_exits_zero_without_results_fails(self):
        summary = self.check(fail="no-results-reader_openings")
        step = [s for s in summary["steps"] if s["name"] == "native-openings"][0]
        self.assertEqual(step["exit"], 0)
        self.assertFalse(step["passed"])
        self.assertFalse(summary["passed"])

    def test_a_step_that_exits_non_zero_fails_even_when_its_report_passed(self):
        for fail, name, report in (("exit-only-reader_openings", "native-openings", ("pass", 1)),
                                   ("exit-only-python-units", "python-units", ("status", "OK"))):
            with self.subTest(fail):
                self.out = Path(self.tmp.name) / ("out-" + fail)
                summary = self.check(fail=fail)
                step = [s for s in summary["steps"] if s["name"] == name][0]
                # The step's own report passed; only its exit disagrees.
                self.assertEqual((step["exit"], step["counts"][report[0]]), (1, report[1]))
                self.assertFalse(step["passed"])
                self.assertEqual([s["name"] for s in summary["steps"] if not s["passed"]], [name])
                self.assertFalse(summary["passed"])

    def test_failing_units_fail_the_run(self):
        for fail, name in (("python-units", "python-units"), ("node-units", "node-units")):
            with self.subTest(fail):
                self.out = Path(self.tmp.name) / ("out-" + fail)
                summary = self.check(fail=fail)
                self.assertFalse(summary["passed"])
                self.assertEqual([s["name"] for s in summary["steps"] if not s["passed"]], [name])

    def test_a_checkout_whose_head_moved_during_the_run_does_not_pass_even_when_clean(self):
        summary = self.check(fail="commit")
        self.assertTrue(all(step["passed"] for step in summary["steps"]))
        self.assertEqual(summary["tree_after"]["changes"], "")
        self.assertNotEqual(summary["tree_after"]["head"], self.commit)
        self.assertFalse(summary["tree_unchanged"])
        self.assertFalse(summary["passed"])
        self.assertIn("the checkout changed while the release check ran",
                      release_check.verify_summary(self.out / "summary.json", self.commit))

    def test_a_checkout_changed_during_the_run_does_not_pass(self):
        summary = self.check(fail="dirty")
        self.assertTrue(all(step["passed"] for step in summary["steps"]))
        self.assertFalse(summary["tree_unchanged"])
        self.assertFalse(summary["passed"])
        self.assertIn("the checkout changed while the release check ran",
                      release_check.verify_summary(self.out / "summary.json", self.commit))


class ReleaseCheckRefuses(FakeCheckout):
    def refusal(self, **overrides):
        args = dict(root=self.root, out=self.out, chrome="/x" + release_check.CHROME_SUFFIX,
                    python=self.python, node=self.node)
        args.update(overrides)
        with self.assertRaises(release_check.Refused) as caught:
            release_check.check(**args)
        self.assertFalse((self.out / "summary.json").exists())
        return str(caught.exception)

    def test_a_checkout_with_changes_is_refused(self):
        (self.root / "untracked.py").write_text("")
        self.assertIn("has changes", self.refusal())
        (self.root / "untracked.py").unlink()
        (self.root / "tests" / "a.test.mjs").write_text("// edited\n")
        self.assertIn("has changes", self.refusal())

    def test_a_world_writable_parent_is_refused(self):
        with mock.patch.object(release_check, "world_writable_ancestor", return_value=Path("/private/tmp")):
            self.assertIn("test_codex_broker", self.refusal())

    def test_out_must_be_absolute_and_fresh(self):
        self.assertIn("absolute", self.refusal(out=Path("relative")))
        self.out.mkdir()
        (self.out / "summary.json").write_text("{}")
        with self.assertRaises(release_check.Refused):
            release_check.check(self.root, self.out, "/c", self.python, self.node)

    def test_out_inside_the_checkout_must_be_ignored(self):
        self.assertIn("not ignored", self.refusal(out=self.root / "evidence" / "run"))
        (self.root / ".gitignore").write_text("work/\n")
        subprocess.run(["git", "-C", str(self.root), "add", ".gitignore"], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-qm", "ignore"], check=True)
        self.out = self.root / "work" / "evidence" / "run"
        summary = self.check()
        self.assertTrue(summary["passed"], [s for s in summary["steps"] if not s["passed"]])

    def test_missing_interpreter_or_harness_is_refused(self):
        self.assertIn("not an executable", self.refusal(node=None))
        subprocess.run(["git", "-C", str(self.root), "rm", "-q", "tests/reader_native.mjs"], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-qm", "drop"], check=True)
        self.assertIn("tests/reader_native.mjs", self.refusal())

    def test_main_exits_two_on_refusal_and_records_why(self):
        (self.root / "untracked.py").write_text("")
        with mock.patch.object(release_check, "REPO", self.root), redirect_stderr(io.StringIO()), \
                mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX):
            code = release_check.main(["--out", str(self.out), "--python", self.python, "--node", self.node])
        self.assertEqual(code, 2)
        self.assertIn("has changes", json.loads((self.out / "summary.json").read_text())["refused"])

    def main(self, out):
        with mock.patch.object(release_check, "REPO", self.root), redirect_stderr(io.StringIO()) as err, \
                mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX):
            try:
                code = release_check.main(["--out", str(out), "--python", self.python, "--node", self.node])
            except Exception as error:  # a refusal is an answer, not a traceback
                self.fail("main raised instead of refusing: %r" % error)
        return code, err.getvalue()

    def test_a_refusal_never_writes_its_summary_where_the_run_could_not_write(self):
        code, err = self.main(self.root / "evidence" / "run")
        self.assertEqual(code, 2)
        self.assertIn("not ignored", err)
        # The refusal itself must not dirty the checkout, or the next run refuses for that.
        self.assertEqual(release_check.tree(self.root), (self.commit, ""))
        self.out.write_text("a file, not a directory\n")
        code, err = self.main(self.out)
        self.assertEqual(code, 2)
        self.assertIn("not a directory", err)
        self.assertEqual(self.out.read_text(), "a file, not a directory\n")

    def test_main_exits_one_on_a_failed_step_and_zero_when_all_pass(self):
        for fail, expected in (("reader--mutations", 1), ("", 0)):
            out = Path(self.tmp.name) / ("main-" + (fail or "pass"))
            with mock.patch.object(release_check, "REPO", self.root), mock.patch.dict(os.environ, {"STUB_FAIL": fail}), \
                    mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX), \
                    redirect_stdout(io.StringIO()):
                code = release_check.main(["--out", str(out), "--python", self.python, "--node", self.node])
            self.assertEqual(code, expected, fail)


class VerifySummary(unittest.TestCase):
    commit = "a" * 40

    def verdict(self, summary):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "summary.json"
            if summary is not None:
                path.write_text(json.dumps(summary))
            return release_check.verify_summary(path, self.commit)

    def test_a_passed_summary_for_the_commit_is_accepted(self):
        self.assertEqual(self.verdict(good_summary(self.commit)), [])

    def test_every_gap_is_a_reason(self):
        self.assertIn("no readable", self.verdict(None)[0])
        self.assertIn("not a release-check summary", self.verdict({"passed": True})[0])
        self.assertEqual(self.verdict(good_summary("b" * 40)), ["the release check ran on %s, not %s" % ("b" * 40, self.commit)])
        summary = good_summary(self.commit)
        summary["steps"] = [s for s in summary["steps"] if s["name"] != "native-colors"]
        summary["required"] = [n for n in summary["required"] if n != "native-colors"]
        self.assertEqual(self.verdict(summary), ["the release check did not run native-colors"])
        summary = good_summary(self.commit)
        summary["steps"][0].update(passed=False, exit=1)
        self.assertEqual(self.verdict(summary), ["python-units failed (exit 1)"])
        summary = good_summary(self.commit)
        summary["passed"] = False
        self.assertEqual(self.verdict(summary), ["the release check did not pass"])
        summary = good_summary(self.commit)
        summary["required"].append("native-new-mode")
        self.assertEqual(self.verdict(summary), ["the release check did not run native-new-mode"])

    def test_a_refused_run_is_not_a_pass(self):
        self.assertTrue(self.verdict({"tool": release_check.TOOL, "refused": "dirty", "passed": False}))


class Parsers(unittest.TestCase):
    def test_python_counts(self):
        self.assertEqual(release_check.python_counts("Ran 5 tests in 1.0s\n\nOK\n"), ({"tests": 5, "status": "OK"}, True))
        counts, passed = release_check.python_counts("Ran 5 tests in 1.0s\n\nFAILED (failures=1, errors=2)\n")
        self.assertEqual((counts["failures"], counts["errors"], passed), (1, 2, False))
        self.assertFalse(release_check.python_counts("Ran 0 tests in 0.0s\n\nOK\n")[1])
        self.assertFalse(release_check.python_counts("Traceback ...\n")[1])

    def test_node_counts(self):
        self.assertTrue(release_check.node_counts("# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n")[1])
        self.assertFalse(release_check.node_counts("# tests 4\n# pass 3\n# fail 1\n# cancelled 0\n")[1])
        self.assertFalse(release_check.node_counts("# tests 4\n# pass 3\n# fail 0\n# cancelled 1\n")[1])
        self.assertFalse(release_check.node_counts("# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n")[1])
        self.assertFalse(release_check.node_counts("")[1])

    def test_native_counts(self):
        persistence = release_check.NATIVE_STEPS[0]
        reader = [s for s in release_check.NATIVE_STEPS if s.results == "results.json"][0]
        with tempfile.TemporaryDirectory() as tmp:
            evidence = Path(tmp)
            self.assertFalse(release_check.native_counts(persistence, evidence)[1])
            cases = (
                ({"browserClosed": True, "results": [{"name": "a", "passed": True}]}, True),
                ({"browserClosed": True, "results": []}, False),
                ({"browserClosed": False, "results": [{"name": "a", "passed": True}]}, False),
                ({"browserClosed": True, "results": [{"name": "a", "passed": True}, {"name": "b", "passed": False}]}, False),
            )
            for report, expected in cases:
                (evidence / "native.json").write_text(json.dumps(report))
                self.assertEqual(release_check.native_counts(persistence, evidence)[1], expected, report)
            (evidence / "native.json").write_text(json.dumps(cases[3][0]))
            self.assertEqual(release_check.native_counts(persistence, evidence)[0]["failed"], ["b"])
            for results, expected in (([{"name": "m", "expectedFailure": True, "mutationCaught": True}], True),
                                      ([{"name": "m", "expectedFailure": True, "mutationCaught": False}], False),
                                      ([{"name": "m", "expectedFailure": True, "passed": True}], False)):
                (evidence / "results.json").write_text(json.dumps({"closed": True, "results": results}))
                self.assertEqual(release_check.native_counts(reader, evidence)[1], expected, results)


class Environment(unittest.TestCase):
    def test_world_writable_ancestor(self):
        modes = {"/a/b/c": 0o40755, "/a/b": 0o40777, "/a": 0o40755, "/": 0o40755}
        fake = lambda path: os.stat_result((modes[path],) + (0,) * 9)
        self.assertEqual(release_check.world_writable_ancestor("/a/b/c", fake), Path("/a/b"))
        modes["/a/b"] = 0o41775
        self.assertIsNone(release_check.world_writable_ancestor("/a/b/c", fake))

    def test_chrome_path(self):
        with tempfile.TemporaryDirectory() as home:
            cache = Path(home) / release_check.CHROME_CACHE
            with self.assertRaises(release_check.Refused):
                release_check.chrome_path(environ={}, home=home)
            chrome = cache / "v1" / release_check.CHROME_IN_VERSION
            chrome.parent.mkdir(parents=True)
            chrome.write_text("")
            chrome.chmod(0o755)
            self.assertEqual(release_check.chrome_path(environ={}, home=home), str(chrome))
            self.assertEqual(release_check.chrome_path(environ={"AIM_CHROME_FOR_TESTING": str(chrome)}, home="/none"),
                             str(chrome))
            other = cache / "v2" / release_check.CHROME_IN_VERSION
            other.parent.mkdir(parents=True)
            other.write_text("")
            with self.assertRaises(release_check.Refused) as caught:
                release_check.chrome_path(environ={}, home=home)
            self.assertIn("holds 2", str(caught.exception))
            with self.assertRaises(release_check.Refused):
                release_check.chrome_path("/usr/bin/true", environ={})
            chrome.chmod(0o644)
            with self.assertRaises(release_check.Refused):
                release_check.chrome_path(str(chrome), environ={})


class NativeCoverage(unittest.TestCase):
    """The release check runs every mode of every native entry point in the repository."""

    def harness_modes(self):
        found = set()
        for path in sorted((ROOT / "tests").glob("*_native.mjs")):
            source = path.read_text()
            names = re.search(r"const \[([^\]]*)\] = process\.argv\.slice\(2\)", source)
            if not names:
                continue  # a module the entry points import
            harness = "tests/" + path.name
            parameters = [name.strip() for name in names.group(1).split(",")]
            mode = [p for p in parameters if p.split("=")[0].strip() == "mode"]
            accepted = set()
            for listed in re.findall(r"\[([^\[\]]*)\]\.includes\(mode\)", source):
                accepted |= set(re.findall(r"'(--[a-z-]+)'", listed))
            if not mode or ("=" not in mode[0] and "mode === undefined" in source):
                found.add((harness, ()))
            found |= {(harness, (flag,)) for flag in accepted}
        return found

    def test_the_rail_mode_is_a_step(self):
        # The side rail inside an outcome, and the page with no header bar.
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["rail"].harness, steps["rail"].flags), (release_check.PERSISTENCE, ("--rail",)))
        self.assertIn("native-rail", release_check.REQUIRED)

    def test_the_conversation_mode_is_a_step(self):
        # An outcome's conversation: its page, its tags, the Reader's To and Answered by.
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["conversation"].harness, steps["conversation"].flags), (release_check.PERSISTENCE, ("--conversation",)))
        self.assertIn("native-conversation", release_check.REQUIRED)

    def test_the_targets_mode_is_a_step(self):
        # An outcome's target, its kind, its checks, Measurements and Reached (items 14, 104, 12).
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["targets"].harness, steps["targets"].flags), (release_check.PERSISTENCE, ("--targets",)))
        self.assertIn("native-targets", release_check.REQUIRED)

    def test_the_pipeline_mode_is_a_step(self):
        # The pipeline's page, its rail row, its outcome line and Add to pipeline in the Reader (item 84).
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["pipeline"].harness, steps["pipeline"].flags), (release_check.PERSISTENCE, ("--pipeline",)))
        self.assertIn("native-pipeline", release_check.REQUIRED)

    def test_the_finished_reader_mode_is_a_step(self):
        # The Reader and reply box, finished: heading, focus ring, note button, Done, arrows.
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["reader-finished"].harness, steps["reader-finished"].flags), (release_check.READER, ("--finished",)))
        self.assertIn("native-reader-finished", release_check.REQUIRED)

    def test_every_harness_mode_is_a_step(self):
        steps = [(step.harness, tuple(step.flags)) for step in release_check.NATIVE_STEPS]
        self.assertEqual(len(steps), len(set(steps)), "a mode runs twice")
        self.assertEqual(set(steps), self.harness_modes())
        self.assertEqual(len({step.name for step in release_check.NATIVE_STEPS}), len(steps))


if __name__ == "__main__":
    unittest.main()

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
# "exit-only-<name>" writes passing results and still exits non-zero. The persistence harness's stand-in writes
# each case's two lines on its log, as the harness does.
STUB_NODE = r'''#!%s
import json, os, sys
args = sys.argv[1:]
fail = os.environ.get("STUB_FAIL", "")
if args[0] == "--version":
    print("v22.11.0")
    sys.exit(0)
if args[0] == "--test":
    bad = int(fail == "node-units")
    print("# tests 2\n# pass %%d\n# fail %%d\n# cancelled 0" %% (2 - bad, bad))
    sys.exit(bad)
harness, chrome, evidence, flags = args[0], args[1], args[2], args[3:]
name = os.path.basename(harness).replace("_native.mjs", "") + "".join(flags)
# A WebKit mode loads playwright-core from AIM_PLAYWRIGHT_CORE; without it there are no results.
if harness.endswith("webkit_native.mjs") and not os.environ.get("AIM_PLAYWRIGHT_CORE"):
    fail = "no-results-" + name
bad = fail == name
if harness.endswith("reader_native.mjs"):
    results = [{"name": "case", "passed": not bad}]
    report = {"closed": True, "results": results}
    path = "results.json"
else:
    report = {"browserClosed": True, "results": [{"name": "case", "passed": not bad}]}
    path = "native.json"
    if harness.endswith("reader_persistence_native.mjs"):
        # Its case lines on the step's log (tests/native-calls.mjs stamps; release_check.case_lines).
        print(json.dumps({"case": "case", "started": "2026-11-15T01:00:00.000Z"}))
        print(json.dumps(dict(report["results"][0], started="2026-11-15T01:00:00.000Z", finished="2026-11-15T01:00:01.000Z")))
if fail != "no-results-" + name:
    open(os.path.join(evidence, path), "w").write(json.dumps(report))
sys.exit(int(bad or fail == "exit-only-" + name))
'''

STUB_PYTHON = r'''#!%s
import json, os, subprocess, sys
args = sys.argv[1:]
if args[:1] == ["-c"]:
    print("3.9.6")
    sys.exit(0)
if "tools/wake_replay.py" in " ".join(args):
    # A replay run: STUB_FAIL=wake-replay loses one wake; the run's side (base or candidate) is in its --out.
    out = args[args.index("--out") + 1]
    lost = os.environ.get("STUB_FAIL") == "wake-replay"
    median = 2.0 if "/base-" in out else 1.0
    open(os.path.join(out, "replay.json"), "w").write(json.dumps({"agents": {"aim-ux": {
        "median": median, "wakes": 3, "lost": [1200] if lost else [], "delays": [median] * 3}}}))
    open(os.path.join(os.path.dirname(os.path.dirname(out)), "replay-order.txt"), "a").write(os.path.basename(out) + " " + args[args.index("--code") + 1] + "\n")
    sys.exit(1 if lost else 0)
step = "deploy-refusals" if any("DeployRefuses" in arg for arg in args) else "python-units"
if os.environ.get("STUB_FAIL") == step:
    print("Ran 3 tests in 0.1s\n\nFAILED (failures=1)")
    sys.exit(1)
if os.environ.get("STUB_FAIL") == "dirty":
    open("stray.txt", "w").write("left behind")
if os.environ.get("STUB_FAIL") == "commit":
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty",
                    "-m", "moved"], check=True)
print("Ran 3 tests in 0.1s\n\nOK (skipped=1)")
sys.exit(int(os.environ.get("STUB_FAIL") == "exit-only-" + step))
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
        for harness in release_check.harnesses():
            (self.root / harness).parent.mkdir(parents=True, exist_ok=True)
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

    def check(self, fail="", playwright="/stub/playwright-core"):
        with mock.patch.dict(os.environ, {"STUB_FAIL": fail}), redirect_stdout(io.StringIO()):
            os.environ.pop("AIM_PLAYWRIGHT_CORE", None)
            return release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX,
                                       self.python, self.node, playwright)


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

    def test_the_webkit_modes_get_playwright_core_and_fail_without_it(self):
        summary = self.check()
        self.assertTrue(summary["passed"])
        self.assertEqual(summary["playwright"], "/stub/playwright-core")
        self.out = Path(self.tmp.name) / "out-no-playwright"
        summary = self.check(playwright=None)
        self.assertFalse(summary["passed"])
        self.assertEqual([step["name"] for step in summary["steps"] if not step["passed"]],
                         ["native-webkit-" + mode for mode in release_check.WEBKIT_MODES])

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


# A stand-in for the live agent CLI: `releases` names the live release (STUB_LIVE, or none), `pipeline` an open
# release piece in STUB_STAGE (round 1), and every write is recorded in STUB_CALLS and answered as committed;
# STUB_CLI=fail makes every call fail.
STUB_CLI = r"""#!%s
import json, os, sys
args = sys.argv[1:]
verb = args[args.index("--json") + 1]
with open(os.environ["STUB_CALLS"], "a") as handle:
    handle.write(json.dumps(args[args.index("--json") + 1:]) + "\n")
if os.environ.get("STUB_CLI") == "fail":
    print("Traceback: the live store is busy")
    sys.exit(1)
if verb == "releases":
    live = os.environ.get("STUB_LIVE")
    items = [{"release": 19, "commit": live, "measurements": {"native": {"total": 188}}}] if live else []
    print(json.dumps({"instance_id": "i", "items": items, "next_cursor": None}))
elif verb == "checks":
    print(json.dumps({"checks": [], "release_piece": {"id": "p-rel", "release": 20, "stage": os.environ.get("STUB_STAGE", "combine"), "round": 1}}))
else:
    if verb == "stage-note":
        progress = json.loads(open(args[args.index("--progress") + 1]).read())
        with open(os.environ["STUB_CALLS"], "a") as handle:
            handle.write(json.dumps({"progress": progress}) + "\n")
    print(json.dumps({"status": "committed", "result": {"piece_id": "p-rel"}}))
"""


class ReleaseCheckMeasures(FakeCheckout):
    """What the summary says beyond pass or fail: its tools, the deploy's refusals, the wake replay, --only, --base and
    --report (items 12 and 104; 7.1)."""

    def setUp(self):
        super().setUp()
        self.cli = script(Path(self.tmp.name) / "aim-next", STUB_CLI)
        self.calls = Path(self.tmp.name) / "calls.jsonl"

    def run_check(self, fail="", env=None, **options):
        # The WebKit modes need playwright-core; ReleaseCheckRuns holds what happens without it.
        options.setdefault("playwright", "/stub/playwright-core")
        with mock.patch.dict(os.environ, dict({"STUB_FAIL": fail, "STUB_CALLS": str(self.calls)}, **(env or {}))), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
            summary = release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX, self.python, self.node, **options)
        self.stderr = err.getvalue()
        return summary

    def written(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def test_the_summary_names_its_tools_and_an_older_summary_without_them_still_verifies(self):
        tools = self.run_check()["tools"]
        self.assertEqual(set(tools["harnesses"]), set(release_check.harnesses()))
        self.assertIn(release_check.REPLAY_FILE, tools["harnesses"])
        for path, value in tools["harnesses"].items():
            self.assertEqual(value, release_check.git(self.root, "rev-parse", "HEAD:" + path).stdout.strip(), path)
        self.assertEqual((tools["python"], tools["node"], tools["chrome"]), ("3.9.6", "v22.11.0", None))
        self.assertIsNone(tools["release_check"], "this checkout has no tools/release_check.py at HEAD")
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit), [])
        older = json.loads((self.out / "summary.json").read_text())
        del older["tools"]
        (self.out / "summary.json").write_text(json.dumps(older))
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit), [], "a summary written before it named its tools")

    def test_the_deploys_refusals_are_a_required_step(self):
        summary = self.run_check(fail="deploy-refusals")
        self.assertIn(release_check.DEPLOY_REFUSALS, release_check.REQUIRED)
        [step] = [s for s in summary["steps"] if s["name"] == release_check.DEPLOY_REFUSALS] or [None]
        self.assertIsNotNone(step, "the release check runs the deploy's refusals")
        self.assertIn("test_tools_deploy.DeployRefuses", step["argv"])
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit), ["deploy-refusals failed (exit 1)"])
        without = json.loads((self.out / "summary.json").read_text())
        without["steps"] = [s for s in without["steps"] if s["name"] != release_check.DEPLOY_REFUSALS]
        (self.out / "summary.json").write_text(json.dumps(without))
        self.assertIn("the release check did not run deploy-refusals", release_check.verify_summary(self.out / "summary.json", self.commit))

    def test_the_deploys_refusals_step_runs_the_train_refusals_and_only_the_deploys_refusals(self):
        # B9: the step the release check records is run here by unittest's own argument parser against this checkout's
        # tests, collecting what it would run: every test of tests/test_tools_train.py and every DeployRefuses class of
        # tests/test_tools_deploy.py, and nothing else (no full deploy, no other file's tests).
        import test_tools_deploy
        import test_tools_train
        [step] = [s for s in self.run_check()["steps"] if s["name"] == release_check.DEPLOY_REFUSALS]
        argv = list(step["argv"])
        self.assertEqual(argv[1:4], ["-m", "unittest", "discover"])
        argv[argv.index("-s") + 1] = str(ROOT / argv[argv.index("-s") + 1])

        class Collected:
            ids = []

            def run(self, test):
                for found in test:
                    if isinstance(found, unittest.TestSuite):
                        self.run(found)
                    else:
                        self.ids.append(found.id())
                return unittest.TestResult()

        collected = Collected()
        unittest.main(module=None, argv=["unittest"] + argv[3:], testRunner=collected, exit=False)

        def ids(module, keep=lambda name: True):
            suite = unittest.TestLoader().loadTestsFromModule(module)
            return {test.id() for group in suite for test in group if keep(test.id().split(".")[1])}
        train = ids(test_tools_train)
        refusals = ids(test_tools_deploy, lambda name: name.startswith("DeployRefuses"))
        self.assertTrue(train and refusals)
        self.assertTrue({"DeployRefusesTrain", "DeployRefusesJudgedFirst", "GuardedPaths"}
                        <= {name.split(".")[1] for name in train})
        self.assertEqual(sorted(set(collected.ids) - train - refusals), [], "the step runs nothing but these")
        self.assertEqual(sorted(train - set(collected.ids)), [], "every test of tests/test_tools_train.py runs")
        self.assertEqual(sorted(refusals - set(collected.ids)), [], "every DeployRefuses test of tests/test_tools_deploy.py runs")
        self.assertEqual(len(collected.ids), len(set(collected.ids)), "each runs once")

    def test_the_wake_replay_runs_repeats_times_and_a_lost_wake_fails_it(self):
        summary = self.run_check(repeats=3)
        step = summary["steps"][-1]
        self.assertEqual((step["name"], step["passed"], step["series"]["aim-ux"]["runs"], step["series"]["aim-ux"]["median"]),
                         (release_check.WAKE_REPLAY, True, [1.0, 1.0, 1.0], 1.0))
        self.out = Path(self.tmp.name) / "out-lost"
        summary = self.run_check(fail="wake-replay")
        step = summary["steps"][-1]
        self.assertEqual((step["passed"], step["series"]["aim-ux"]["lost"]), (False, [1200]))
        self.assertFalse(summary["passed"])

    def test_the_wake_replay_runs_once_unless_more_are_asked_for(self):
        # Item 166: one replay is about 16 minutes; a combined release's check runs it once, beside its base once.
        live = self.commit_again()
        summary = self.run_check(env={"STUB_LIVE": live}, base=(self.cli, "/profile.json"))
        order = [line.split()[0] for line in (self.out / "replay-order.txt").read_text().splitlines()]
        self.assertEqual(order, ["base-1", "candidate-1"])
        self.assertEqual((summary["steps"][-1]["series"]["aim-ux"]["runs"], summary["base"]["steps"][0]["series"]["aim-ux"]["runs"]), ([1.0], [2.0]))
        self.assertEqual(release_check.replay_runs(summary), 1)
        self.out = Path(self.tmp.name) / "out-main"
        with mock.patch.object(release_check, "check", return_value={"commit": self.commit, "passed": True, "steps": []}) as check, \
                mock.patch.object(release_check, "chrome_path", return_value="/c"), mock.patch.object(release_check, "playwright_path", return_value="/p"), \
                redirect_stdout(io.StringIO()):
            release_check.main(["--out", str(self.out)])
            release_check.main(["--out", str(self.out), "--repeats", "2"])
        self.assertEqual([call.kwargs["repeats"] for call in check.call_args_list], [1, 2])

    def test_only_runs_the_named_steps_says_so_and_does_not_describe_the_commit(self):
        summary = self.run_check(only=["node-units", release_check.WAKE_REPLAY])
        self.assertEqual(([s["name"] for s in summary["steps"]], summary["only"], summary["passed"]),
                         (["node-units", release_check.WAKE_REPLAY], ["node-units", release_check.WAKE_REPLAY], True))
        foreign, _ = release_check.judge_summary(self.out / "summary.json", self.commit)
        self.assertEqual(foreign, ["the release check ran only node-units, wake-replay, so it does not describe %s" % self.commit])
        self.out = Path(self.tmp.name) / "out-unknown"
        with self.assertRaises(release_check.Refused):
            self.run_check(only=["native-nothing"])

    def commit_again(self):
        """A second commit, so the live release (the first) is not HEAD."""
        (self.root / "tests" / "b.test.mjs").write_text("// stand-in\n")
        for argv in (["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "next"]):
            subprocess.run(["git", "-C", str(self.root)] + argv, check=True, capture_output=True)
        live, self.commit = self.commit, release_check.tree(self.root)[0]
        return live

    def test_the_base_reruns_the_replay_on_the_live_releases_code_alternating_with_the_candidate(self):
        live = self.commit_again()
        summary = self.run_check(env={"STUB_LIVE": live}, base=(self.cli, "/profile.json"), repeats=2)
        order = [line.split() for line in (self.out / "replay-order.txt").read_text().splitlines()]
        self.assertEqual([side for side, _ in order], ["base-1", "candidate-1", "base-2", "candidate-2"])
        base_code = {code for side, code in order if side.startswith("base")}
        self.assertEqual({code for side, code in order if side.startswith("candidate")}, {str(self.root)})
        [code] = base_code
        self.assertNotEqual(code, str(self.root))
        self.assertFalse(Path(code).exists(), "the base's code is removed")
        self.assertEqual((summary["base"]["commit"], summary["base"]["tools"]), (live, summary["tools"]))
        [rerun] = summary["base"]["steps"]
        self.assertEqual((rerun["name"], rerun["series"]["aim-ux"]["runs"]), (release_check.WAKE_REPLAY, [2.0, 2.0]))
        self.assertEqual(self.written()[0], ["releases", "--limit", "1"])
        # No live release to read: refused before anything runs.
        self.out = Path(self.tmp.name) / "out-nolive"
        with self.assertRaises(release_check.Refused):
            self.run_check(base=(self.cli, "/profile.json"))
        self.assertFalse((self.out / "summary.json").exists())

    def test_the_report_enters_checks_and_notes_the_steps_so_far_after_every_step(self):
        live = self.commit_again()
        summary = self.run_check(env={"STUB_LIVE": live, "STUB_STAGE": "checks"}, report=(self.cli, "/profile.json", "building-theseus"),
                                 only=["python-units", "native-colors", "native-live"])
        calls = self.written()
        enter = [call for call in calls if isinstance(call, list) and call[0] == "enter-stage"]
        self.assertEqual(enter, [["enter-stage", "p-rel", "checks", "--round", "2", "--left", "held"]], "already in checks: the next round")
        notes = [call for call in calls if isinstance(call, list) and call[0] == "stage-note"]
        progress = [call["progress"] for call in calls if isinstance(call, dict)]
        self.assertEqual(len(notes), 4, "before each step, and after the last")
        self.assertEqual([[step["name"] for step in each["steps"]] for each in progress],
                         [[], ["python-units"], ["python-units", "native-colors"], ["python-units", "native-colors", "native-live"]])
        self.assertEqual([(each["running"] or {}).get("name") for each in progress], ["python-units", "native-colors", "native-live", None])
        self.assertEqual({(each["steps_total"], each["commit"]) for each in progress}, {(3, self.commit)})
        self.assertEqual(notes[-1][2], "2 browser checks run so far, none failed. Release 19 ran 188.")
        self.assertTrue(summary["passed"])
        # From combine it enters checks round 1; with no live record the note says only what it counted.
        self.calls.unlink()
        self.out = Path(self.tmp.name) / "out-combine"
        self.run_check(env={"STUB_STAGE": "combine"}, report=(self.cli, "/profile.json", "building-theseus"), only=["native-colors"], fail="reader_persistence--colors")
        calls = self.written()
        self.assertIn(["enter-stage", "p-rel", "checks", "--left", "passed"], calls)
        self.assertEqual([call for call in calls if isinstance(call, list) and call[0] == "stage-note"][-1][2],
                         "1 browser checks run so far; 1 failed: case.")

    def test_a_report_that_cannot_be_written_never_changes_the_verdict(self):
        for fail, passed in (("", True), ("reader_persistence--colors", False)):
            with self.subTest(fail=fail):
                self.out = Path(self.tmp.name) / ("out-" + (fail or "pass"))
                summary = self.run_check(fail=fail, env={"STUB_CLI": "fail"}, report=(self.cli, "/profile.json", "building-theseus"),
                                         only=["python-units", "native-colors"])
                self.assertEqual(summary["passed"], passed)
                self.assertIn("report: checks was not written", self.stderr)

    def test_a_measure_and_its_base_rerun_compare_as_measured_by_the_same_tools(self):
        # D32 through the deploy's reading of a summary this check wrote (tools/checks.py run_from_summary).
        from tools import checks
        from aim_next import outcome_rules
        live = self.commit_again()
        summary = self.run_check(env={"STUB_LIVE": live}, base=(self.cli, "/profile.json"))
        wake = {"check_id": "wake-time", "name": "Wake time", "kind": "measure", "source": "release-check:wake-replay"}
        run = checks.run_from_summary(summary, [wake], "w1")
        self.assertEqual(run["tools"], summary["tools"])
        self.assertTrue(outcome_rules.comparable(run["base"], run))
        self.assertEqual([step.get("tool") for step in run["steps"]][-1], release_check.REPLAY_TOOL)
        older = dict(summary, tools=None)
        self.assertFalse(outcome_rules.comparable(run["base"], checks.run_from_summary(older, [wake], "w1")),
                         "a summary that names no tools is not compared with a rerun that does")


class ReleaseCheckSkips(FakeCheckout):
    """Item 166: with --live, a change none of whose paths since the live commit the browser modes or the wake replay
    could see skips them, keyed on those paths alone; the summary says so, and only a reader that confirms the diff
    takes it."""

    def setUp(self):
        super().setUp()
        # What the real checkout holds that the rule reads: a fixture the harnesses run that imports a unit module,
        # and a replay that imports a tools module.
        self.live = self.commit_files({"tests/reader_fixture.py": "import test_store as fixtures\n", "tests/test_store.py": "# units\n",
                                       release_check.REPLAY_TOOL: "from tools import replay_helper\n", "tools/replay_helper.py": "# helper\n",
                                       "tools/checks.py": "# trials\n", "tests/test_other.py": "# units\n", "web/app.mjs": "// app\n",
                                       "aim_next/store.py": "# store\n", "docs/tools.md": "# Tools\n"})

    def commit_files(self, files, remove=()):
        for path, text in files.items():
            (self.root / path).parent.mkdir(parents=True, exist_ok=True)
            (self.root / path).write_text(text)
        for path in remove:
            (self.root / path).unlink()
        for argv in (["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "change"]):
            subprocess.run(["git", "-C", str(self.root)] + argv, check=True, capture_output=True)
        self.commit = release_check.tree(self.root)[0]
        return self.commit

    def checked(self, files, remove=(), name="out"):
        self.commit_files(files, remove)
        self.out = Path(self.tmp.name) / name
        with mock.patch.dict(os.environ, {"STUB_FAIL": ""}), redirect_stdout(io.StringIO()):
            return release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX, self.python, self.node, "/stub/playwright-core",
                                       live=self.live)

    def test_a_change_only_they_cannot_see_skips_them_and_says_so_plainly(self):
        summary = self.checked({"docs/tools.md": "# Tools, again\n", "tools/checks.py": "# trials, again\n", "tests/test_other.py": "# more\n",
                                "tests/ui_new.test.mjs": "// new\n"})
        ran = [step["name"] for step in summary["steps"]]
        self.assertEqual(ran, list(release_check.UNIT_STEPS) + [release_check.DEPLOY_REFUSALS])
        self.assertTrue(summary["passed"], "every step it ran passed")
        skipped = summary["skipped"]
        self.assertEqual((skipped["steps"], skipped["live"]), (list(release_check.SKIPPABLE), self.live))
        self.assertEqual(sorted(skipped["changed"]), ["docs/tools.md", "tests/test_other.py", "tests/ui_new.test.mjs", "tools/checks.py"])
        self.assertIn("skipped, not passed", skipped["why"])
        self.assertFalse(set(release_check.SKIPPABLE) & set(ran), "a skipped step never appears as one that ran")
        # Nothing but a reader that confirms the diff takes it: not verify_summary, not a basis of another live commit or a seen path.
        path = self.out / "summary.json"
        [said] = release_check.verify_summary(path, self.commit)
        self.assertIn("skipped the browser modes and the wake replay beside the live commit %s; only the deploy" % self.live, said)
        self.assertEqual(release_check.judge_summary(path, self.commit, lambda: (self.live, [])), ([], []))
        self.assertIn("but %s is live" % ("a" * 40), release_check.judge_summary(path, self.commit, lambda: ("a" * 40, []))[0][0])
        self.assertIn("but web/app.mjs changed since then", release_check.judge_summary(path, self.commit, lambda: (self.live, ["web/app.mjs"]))[0][0])

        def unreadable():
            raise release_check.Refused("git is gone")
        self.assertIn("cannot be taken: git is gone", release_check.judge_summary(path, self.commit, unreadable)[0][0])
        self.assertEqual(release_check.skipped_of(path), skipped["why"])
        # The release record keeps the words beside its empty browser counts, so it never reads as a run of none.
        from tools import releases
        record = releases.measurements(summary)
        self.assertEqual((record.get("skipped"), record["native"]["total"]), ({"live": self.live, "why": skipped["why"]}, 0))
        self.assertNotIn("skipped", releases.measurements(dict(summary, skipped=None)))

    def test_a_change_they_could_see_never_skips(self):
        cases = {"web": ({"web/app.mjs": "// changed\n"}, ()), "aim_next": ({"aim_next/store.py": "# changed\n"}, ()),
                 "deleted web": ({}, ("web/app.mjs",)), "bin": ({"bin/aim-next": "# new\n"}, ()), "top level": ({"README.md": "hi\n"}, ()),
                 "harness": ({release_check.READER: "// changed\n"}, ()), "replay": ({release_check.REPLAY_TOOL: "from tools import replay_helper\n#\n"}, ()),
                 "replay traffic": ({release_check.REPLAY_FILE: "{}\n"}, ()), "this tool": ({"tools/release_check.py": "# changed\n"}, ()),
                 "imported tools module": ({"tools/replay_helper.py": "# changed\n"}, ()),
                 "unit module a fixture imports": ({"tests/test_store.py": "# changed\n"}, ()),
                 "fixture": ({"tests/fixtures/ui_http.py": "# new\n"}, ()),
                 "docs and web together": ({"docs/tools.md": "# again\n", "web/app.mjs": "// again\n"}, ())}
        for case, (files, remove) in sorted(cases.items()):
            with self.subTest(case):
                self.commit_files(files, remove)
                changed = release_check.changed_paths(self.root, self.live, self.commit)
                could = release_check.seen(self.root, self.commit, changed)
                self.assertTrue(could and set(could) <= set(changed) and not could[0].startswith("docs/"), (changed, could))
                # The next case is measured from this one.
                self.live = self.commit
        # The whole check, for one of them: every step runs, and the summary names what it could see.
        summary = self.checked({"web/app.mjs": "// once more\n", "docs/tools.md": "# once more\n"})
        self.assertNotIn("skipped", summary)
        self.assertEqual([step["name"] for step in summary["steps"]], list(release_check.REQUIRED))
        self.assertEqual((summary["ran_all"]["live"], summary["ran_all"]["seen"]), (self.live, ["web/app.mjs"]))
        self.assertEqual(release_check.verify_summary(self.out / "summary.json", self.commit), [])

    def test_without_live_or_with_only_nothing_is_skipped_and_git_that_cannot_say_refuses(self):
        self.commit_files({"docs/tools.md": "# again\n"})
        with mock.patch.dict(os.environ, {"STUB_FAIL": ""}), redirect_stdout(io.StringIO()):
            summary = release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX, self.python, self.node, "/stub/playwright-core")
        self.assertEqual([step["name"] for step in summary["steps"]], list(release_check.REQUIRED))
        self.assertNotIn("skipped", summary)
        for live, only, words in ((self.live, ["node-units"], "give one"), ("f" * 40, None, "cannot be read"), ("HEAD", None, "full 40-character")):
            with self.subTest(words):
                self.out = Path(self.tmp.name) / ("out-" + words.replace(" ", "-"))
                with self.assertRaises(release_check.Refused) as refused:
                    release_check.check(self.root, self.out, "/x" + release_check.CHROME_SUFFIX, self.python, self.node, "/stub/playwright-core",
                                        only=only, live=live)
                self.assertIn(words, str(refused.exception))
                self.assertFalse((self.out / "summary.json").exists())

    def test_a_skipped_summary_that_left_out_more_or_other_steps_is_not_taken(self):
        self.checked({"docs/tools.md": "# again\n"})
        path = self.out / "summary.json"
        written = json.loads(path.read_text())
        fewer = dict(written, steps=[step for step in written["steps"] if step["name"] != "python-units"])
        path.write_text(json.dumps(fewer))
        self.assertEqual(release_check.judge_summary(path, self.commit, lambda: (self.live, [])), ([], ["the release check did not run python-units"]))
        other = dict(written, skipped=dict(written["skipped"], steps=[release_check.WAKE_REPLAY]))
        path.write_text(json.dumps(other))
        foreign, unpassed = release_check.judge_summary(path, self.commit, lambda: (self.live, []))
        self.assertIn("skipped steps it never skips together", foreign[0])
        self.assertIn("the release check did not run native-journal", unpassed)


class EveryCheckHasItsStep(unittest.TestCase):
    """Class 2's guard: every machine-read check source a seed names reads steps the release check runs, and reads
    exactly them: given only its steps it has a reading, and given every other step it has none."""

    def test_each_seeded_release_check_source_is_read_from_its_own_required_steps(self):
        from aim_next import check_reading
        seeds = json.loads((Path(release_check.REPO) / "tools" / "pipeline" / "checks.json").read_text())
        sources = {check["source"] for check in (seeds["checks"] if isinstance(seeds, dict) else seeds) if check["source"].startswith("release-check:")}
        self.assertTrue(sources)
        self.assertLessEqual(sources, set(release_check.SOURCE_STEPS), "a seeded source the release check has no step for")
        for source, names in release_check.SOURCE_STEPS.items():
            with self.subTest(source=source):
                self.assertTrue(names and set(names) <= set(release_check.REQUIRED), names)
                check = {"check_id": "c", "source": source}
                step = lambda name: dict({"name": name, "passed": True, "total": 1, "pass": 1},
                                         **({"values": {"aim-ux": {"median": 1.0, "lost": []}}} if name in release_check.REPLAYED else {}))
                self.assertTrue(check_reading.readings([check], [step(name) for name in names], 0, 60000), "read from its own steps")
                if source != "release-check:duration":
                    others = [step(name) for name in release_check.REQUIRED if name not in names]
                    self.assertEqual(check_reading.readings([check], others, 0, 60000), [], "and from no other step")


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
                mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX), mock.patch.object(release_check, "playwright_path", return_value="/stub/playwright-core"):
            code = release_check.main(["--out", str(self.out), "--python", self.python, "--node", self.node])
        self.assertEqual(code, 2)
        self.assertIn("has changes", json.loads((self.out / "summary.json").read_text())["refused"])

    def main(self, out):
        with mock.patch.object(release_check, "REPO", self.root), redirect_stderr(io.StringIO()) as err, \
                mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX), mock.patch.object(release_check, "playwright_path", return_value="/stub/playwright-core"):
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
                    mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX), mock.patch.object(release_check, "playwright_path", return_value="/stub/playwright-core"), \
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


    def test_a_persistence_step_passes_only_when_its_log_holds_each_case_s_two_lines(self):
        # tests/native-calls.mjs stamps: a start line before each case runs, its result with both times after cleanup.
        persistence = release_check.NATIVE_STEPS[0]
        self.assertEqual(persistence.harness, release_check.PERSISTENCE)
        reader = [s for s in release_check.NATIVE_STEPS if s.harness != release_check.PERSISTENCE][0]
        results = [{"name": "a", "passed": True}, {"name": "b", "passed": True, "cleanupRefused": ["closing page ghost: x"]}]
        start = lambda name, at: json.dumps({"case": name, "started": at})
        end = lambda result, at, done: json.dumps(dict(result, started=at, finished=done))
        good = [start("a", "2026-11-15T01:00:00.000Z"), end(results[0], "2026-11-15T01:00:00.000Z", "2026-11-15T01:00:04.000Z"),
                "a line of the harness's own that is not a case's", start("b", "2026-11-15T01:00:04.000Z"),
                end(results[1], "2026-11-15T01:00:04.000Z", "2026-11-15T01:00:05.000Z")]
        logs = {
            "no start lines (the base harness)": [json.dumps(results[0]), json.dumps(results[1])],
            "a start line but the base result line": [good[0], json.dumps(results[0])] + good[3:],
            "a result line written before cleanup, without what cleanup added": good[:3] + [good[3], end({"name": "b", "passed": True}, "2026-11-15T01:00:04.000Z", "2026-11-15T01:00:05.000Z")],
            "a case that crashed out after its result was kept": good[:4],
            "a result line naming another start": good[:3] + [good[3], end(results[1], "2026-11-15T01:00:00.000Z", "2026-11-15T01:00:05.000Z")],
            "finished before it started": good[:4] + [end(results[1], "2026-11-15T01:00:04.000Z", "2026-11-15T01:00:03.000Z")],
            "a start the results file does not hold": good + [start("c", "2026-11-15T01:00:05.000Z")],
            "cases out of order": good[3:] + good[:2],
        }
        with tempfile.TemporaryDirectory() as tmp:
            evidence = Path(tmp)
            (evidence / "native.json").write_text(json.dumps({"browserClosed": True, "results": results}))
            self.assertEqual(release_check.native_counts(persistence, evidence, "\n".join(good) + "\n"),
                             ({"tests": 2, "pass": 2, "fail": 0, "failed": [], "browser_closed": True}, True))
            self.assertTrue(release_check.native_counts(persistence, evidence)[1], "without its log, the results file alone")
            for why, log in logs.items():
                with self.subTest(why):
                    counts, passed = release_check.native_counts(persistence, evidence, "\n".join(log) + "\n")
                    self.assertFalse(passed)
                    self.assertEqual(len(counts["case_lines"]), 1, counts)
            counts, _ = release_check.native_counts(persistence, evidence, "\n".join(logs["no start lines (the base harness)"]))
            self.assertEqual(counts["case_lines"], ["case 'a': no start line in the step's log where it began (found %s)" % json.dumps(results[0])])
            # Another harness writes no case lines, and is not held to them.
            (evidence / reader.results).write_text(json.dumps({"browserClosed": True, "closed": True, "results": [{"name": "a", "passed": True}]}))
            self.assertTrue(release_check.native_counts(reader, evidence, "")[1])


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


class PlaywrightPath(unittest.TestCase):
    """The WebKit modes load one playwright-core, named or found in its cache, and nothing else."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.cache = self.home / release_check.PLAYWRIGHT_CACHE

    def tearDown(self):
        self.tmp.cleanup()

    def package(self, path, name="playwright-core"):
        path.mkdir(parents=True)
        (path / "package.json").write_text(json.dumps({"name": name}))
        return str(path)

    def test_named_then_environment_then_the_one_cached_version(self):
        named = self.package(self.home / "named")
        env = self.package(self.home / "env")
        cached = self.package(self.cache / "1.63.0")
        self.assertEqual(release_check.playwright_path(named, environ={"AIM_PLAYWRIGHT_CORE": env}, home=self.home), named)
        self.assertEqual(release_check.playwright_path(None, environ={"AIM_PLAYWRIGHT_CORE": env}, home=self.home), env)
        self.assertEqual(release_check.playwright_path(None, environ={}, home=self.home), cached)

    def test_none_several_relative_or_another_package_is_refused(self):
        with self.assertRaises(release_check.Refused):
            release_check.playwright_path(None, environ={}, home=self.home)
        self.package(self.cache / "1.62.0")
        self.package(self.cache / "1.63.0")
        with self.assertRaises(release_check.Refused):
            release_check.playwright_path(None, environ={}, home=self.home)
        with self.assertRaises(release_check.Refused):
            release_check.playwright_path("relative/playwright-core", environ={}, home=self.home)
        other = self.package(self.home / "other", name="playwright")
        with self.assertRaises(release_check.Refused):
            release_check.playwright_path(other, environ={}, home=self.home)


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

    def test_the_webkit_modes_are_steps(self):
        # Safari's engine runs the reading colours, whispers, Notebook pages, the rail, the pipeline
        # page, the topic page's acts and how its cards read (each with its phone layouts), the
        # phone check page and the New line staying.
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual(release_check.WEBKIT_MODES, ("colors", "whispers", "notebook", "rail", "pipeline", "device", "new-line", "reading", "invite", "targets"))
        for mode in release_check.WEBKIT_MODES:
            self.assertEqual((steps["webkit-" + mode].harness, steps["webkit-" + mode].flags), (release_check.WEBKIT, ("--" + mode,)))
            self.assertIn("native-webkit-" + mode, release_check.REQUIRED)

    def test_the_compose_mode_is_a_step(self):
        # The Reader's composer, naming someone in two steps on a phone, in Chrome and Safari's engine (docs/reader.md).
        steps = {step.name: step for step in release_check.NATIVE_STEPS}
        self.assertEqual((steps["compose"].harness, steps["compose"].flags), (release_check.COMPOSE, ()))
        self.assertIn("native-compose", release_check.REQUIRED)
        self.assertIn(release_check.COMPOSE, release_check.PLAYWRIGHT_HARNESSES)

    def test_every_harness_mode_is_a_step(self):
        steps = [(step.harness, tuple(step.flags)) for step in release_check.NATIVE_STEPS]
        self.assertEqual(len(steps), len(set(steps)), "a mode runs twice")
        self.assertEqual(set(steps), self.harness_modes())
        self.assertEqual(len({step.name for step in release_check.NATIVE_STEPS}), len(steps))


if __name__ == "__main__":
    unittest.main()

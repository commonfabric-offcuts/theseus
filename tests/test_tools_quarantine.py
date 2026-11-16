from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import quarantine, release_check

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/checks.yml"
HARNESS = release_check.PERSISTENCE
# The stand-in harness source: a failure's stack names one of these lines, so its stage is read at the checked commit.
HARNESS_TEXT = "// stand-in\nassert.ok(lines >= 7, 'shows lines');\nassert.ok(other, 'other');\n"
STAGE = [{"path": HARNESS, "text": "assert.ok(lines >= 7, 'shows lines');", "count": 1, "index": 0}]

# A stand-in for node. --test prints a passing TAP summary. A persistence harness writes cases "a" and "b" and their
# case lines; STUB_CASES names the failed ones as case:line, the line of HARNESS its stack names, or case:timeout for a
# failure whose stack names no test source line, or case:none for one with no error at all. A run with a failure exits 1
# and ends with known_reds.END_LINE, as the harness does, unless STUB_UNENDED says it stopped before its end. STUB_WRITES
# names a file the harness writes into the checkout, as a step that changes it would.
STUB_NODE = r'''#!%s
import json, os, sys
args = sys.argv[1:]
if args[0] == "--version":
    print("v22.11.0")
    sys.exit(0)
if args[0] == "--test":
    print("# tests 1\n# pass 1\n# fail 0\n# cancelled 0")
    sys.exit(0)
harness, chrome, evidence = args[0], args[1], args[2]
failed = dict(item.split(":") for item in os.environ.get("STUB_CASES", "").split(",") if item)
results = []
for name in ("a", "b"):
    row = {"name": name, "passed": name not in failed}
    if name in failed and failed[name] == "timeout":
        row["error"] = "TimeoutError: page.waitForSelector: Timeout 30000ms exceeded"
    elif name in failed and failed[name] != "none":
        row["error"] = ("AssertionError [ERR_ASSERTION]: shows 6 lines\n    at check (%%s/tests/reader_persistence_native.mjs:%%s:5)"
                        %% (os.getcwd(), failed[name]))
    results.append(row)
    print(json.dumps({"case": name, "started": "2026-11-15T01:00:00.000Z"}))
    print(json.dumps(dict(row, started="2026-11-15T01:00:00.000Z", finished="2026-11-15T01:00:01.000Z")))
report = {"browserClosed": True, "fixtureExitCode": 0, "fixtureExitSignal": None, "results": results}
open(os.path.join(evidence, "native.json"), "w").write(json.dumps(report))
if os.environ.get("STUB_WRITES"):
    open(os.path.join(os.getcwd(), os.environ["STUB_WRITES"]), "w").write("written by the step\n")
if failed and not os.environ.get("STUB_UNENDED"):
    print("AssertionError [ERR_ASSERTION]: see native.json for exact failing assertions")
sys.exit(1 if failed else 0)
'''


def entry(case="a", step="native-colors", stages=(STAGE, STAGE), **changes):
    value = {"step": step, "case": {"name": case, "phase": None, "engine": None, "expectedFailure": False},
             "owner": "runner lane", "leave": "ten of ten whole-step passes on live after its fix",
             "red_in": [{"run": 100 + number, "commit": "%d" % number * 40, "release": 80 + number, "stage": list(stage)}
                        for number, stage in enumerate(stages, 1)]}
    value.update(changes)
    return value


class Fixture(unittest.TestCase):
    """A repository whose earlier commit, the event base, keeps a policy that quarantines case "a" of native-colors at
    HARNESS's second line, and whose HEAD is a later commit the release check runs, with a stand-in node."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.root = base / "checkout"
        (self.root / "tests").mkdir(parents=True)
        for harness in release_check.harnesses():
            (self.root / harness).parent.mkdir(parents=True, exist_ok=True)
            (self.root / harness).write_text("// stand-in\n")
        (self.root / HARNESS).write_text(HARNESS_TEXT)
        (self.root / "tests" / "a.test.mjs").write_text("// stand-in\n")
        self.git("init", "-q")
        self.sources = self.commit_file("README", "sources\n", "sources, no policy")
        self.base = self.commit_policy({"version": 1, "quarantine": [entry()]}, "event base")
        self.head = self.commit_file("application.txt", "the candidate\n", "candidate")
        self.node = base / "node"
        self.node.write_text(STUB_NODE % sys.executable)
        self.node.chmod(0o755)
        self.runs = 0
        patcher = mock.patch.object(release_check, "world_writable_ancestor", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@example.invalid"] + list(args),
                              check=True, capture_output=True, text=True).stdout.strip()

    def commit_file(self, path, text, message):
        (self.root / path).parent.mkdir(parents=True, exist_ok=True)
        (self.root / path).write_text(text)
        self.git("add", "-A")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD")

    def commit_policy(self, policy, message):
        return self.commit_file(quarantine.POLICY, json.dumps(policy), message)

    def out(self):
        self.runs += 1
        return Path(self.tmp.name) / ("out-%d" % self.runs)

    def check(self, cases="", at=None, unended=False, writes=""):
        env = {"STUB_CASES": cases, "STUB_UNENDED": "1" if unended else "", "STUB_WRITES": writes}
        with mock.patch.dict(os.environ, env), redirect_stdout(io.StringIO()) as printed:
            summary = release_check.check(self.root, self.out(), "/x" + release_check.CHROME_SUFFIX, sys.executable,
                                          str(self.node), only=["native-colors"], quarantine_at=self.base if at is None else at)
        self.printed = printed.getvalue()
        return summary, summary["steps"][0]

    def main(self, cases, at=None, writes=""):
        env = {"STUB_CASES": cases, "STUB_UNENDED": "", "STUB_WRITES": writes}
        with mock.patch.object(release_check, "REPO", self.root), mock.patch.dict(os.environ, env), \
                mock.patch.object(release_check, "chrome_path", return_value="/x" + release_check.CHROME_SUFFIX), \
                mock.patch.object(release_check, "playwright_path", return_value="/stub/playwright-core"), \
                redirect_stdout(io.StringIO()) as printed:
            code = release_check.main(["--out", str(self.out()), "--node", str(self.node), "--only", "native-colors",
                                       "--quarantine-at", at or self.base])
        return code, printed.getvalue()


class AStepWithAQuarantinedRed(Fixture):
    def test_a_step_whose_only_failure_is_quarantined_at_its_stage_is_green_and_names_the_case(self):
        summary, step = self.check("a:2")
        # The raw verdict stays: the step failed, its case is failed, and the run did not pass.
        self.assertEqual((step["passed"], step["exit"], step["counts"]["failed"]), (False, 1, ["a"]))
        self.assertFalse(summary["passed"])
        self.assertEqual(step["quarantine"]["held"], ["a"])
        self.assertEqual(step["quarantine"]["unheld"], [])
        self.assertTrue(step["quarantine"]["green"])
        self.assertEqual(summary["quarantine"], {"at": self.base, "entries": 1, "held": [{"step": "native-colors", "case": "a"}],
                                                 "green": True})
        self.assertIn('"quarantined": ["a"]', self.printed)
        code, printed = self.main("a:2")
        self.assertEqual(code, 0)
        last = json.loads(printed.strip().splitlines()[-1])
        self.assertEqual((last["passed"], last["green"], last["quarantined"]), (False, True, [{"step": "native-colors", "case": "a"}]))

    def test_a_step_with_one_red_not_quarantined_is_red(self):
        summary, step = self.check("b:2")
        self.assertEqual(step["quarantine"]["held"], [])
        self.assertEqual(step["quarantine"]["unheld"], [{"case": "b", "why": "not quarantined"}])
        self.assertFalse(step["quarantine"]["green"])
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(self.main("b:2")[0], 1)

    def test_a_quarantined_red_beside_one_that_is_not_leaves_the_step_red_and_still_names_the_quarantined_case(self):
        summary, step = self.check("a:2,b:2")
        self.assertEqual(step["quarantine"]["held"], ["a"])
        self.assertEqual([item["case"] for item in step["quarantine"]["unheld"]], ["b"])
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(summary["quarantine"]["held"], [{"step": "native-colors", "case": "a"}])
        self.assertEqual(self.main("a:2,b:2")[0], 1)

    def test_a_quarantined_case_failing_at_another_stage_is_not_held(self):
        summary, step = self.check("a:3")
        self.assertEqual(step["quarantine"]["held"], [])
        self.assertEqual(step["quarantine"]["unheld"],
                         [{"case": "a", "why": "it failed at another stage than the one it was quarantined at"}])
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(self.main("a:3")[0], 1)

    def test_a_quarantined_case_whose_failure_names_no_test_line_or_has_no_error_is_not_held(self):
        # Missing evidence refuses: a stage that cannot be read is never taken as the stage it was quarantined at.
        for cases, words in (("a:timeout", "no verified test source frames"), ("a:none", "missing assertion evidence")):
            with self.subTest(cases=cases):
                summary, step = self.check(cases)
                self.assertEqual((step["passed"], step["counts"]["failed"]), (False, ["a"]))
                self.assertNotIn("refused", step["quarantine"])
                self.assertEqual(step["quarantine"]["held"], [])
                self.assertEqual(step["quarantine"]["unheld"], [{"case": "a", "why": "its stage cannot be read: " + words}])
                self.assertFalse(step["quarantine"]["green"])
                self.assertEqual(summary["quarantine"]["held"], [])
                self.assertFalse(summary["quarantine"]["green"])
                self.assertEqual(self.main(cases)[0], 1)

    def test_a_case_quarantined_under_another_phase_or_engine_is_not_held(self):
        # The run's case "a" has no phase and no engine; an entry for "a" under either is another case.
        for field, value in (("phase", "stacked"), ("engine", "webkit")):
            with self.subTest(field=field):
                other = entry()
                other["case"][field] = value
                self.git("checkout", "-q", "--detach", self.sources)
                self.base = self.commit_policy({"version": 1, "quarantine": [other]}, "a under another " + field)
                self.head = self.commit_file("application.txt", "the candidate %s\n" % field, "candidate")
                summary, step = self.check("a:2")
                self.assertEqual(summary["quarantine"]["entries"], 1)
                self.assertEqual(step["quarantine"]["held"], [])
                self.assertEqual(step["quarantine"]["unheld"], [{"case": "a", "why": "not quarantined"}])
                self.assertFalse(summary["quarantine"]["green"])
                self.assertEqual(self.main("a:2")[0], 1)

    def test_a_step_that_changed_the_checkout_is_never_green_though_its_only_failure_is_held(self):
        summary, step = self.check("a:2", writes="written-by-the-step.txt")
        self.assertFalse(summary["tree_unchanged"])
        self.assertIn("written-by-the-step.txt", summary["tree_after"]["changes"])
        # The step's own record holds its case; the run is still not green.
        self.assertEqual((step["quarantine"]["held"], step["quarantine"]["green"]), (["a"], True))
        self.assertEqual(summary["quarantine"]["held"], [{"step": "native-colors", "case": "a"}])
        self.assertFalse(summary["quarantine"]["green"])
        (self.root / "written-by-the-step.txt").unlink()
        code, printed = self.main("a:2", writes="written-by-the-step.txt")
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(printed.strip().splitlines()[-1])["green"])
        (self.root / "written-by-the-step.txt").unlink()
        # The same run with the checkout left alone is green.
        summary, _ = self.check("a:2")
        self.assertTrue(summary["tree_unchanged"] and summary["quarantine"]["green"])

    def test_a_run_that_did_not_reach_its_end_holds_nothing(self):
        summary, step = self.check("a:2", unended=True)
        self.assertEqual(step["quarantine"]["held"], [])
        self.assertIn("did not reach its end", step["quarantine"].get("refused", ""))
        self.assertFalse(summary["quarantine"]["green"])

    def test_a_quarantined_case_that_passes_records_its_pass(self):
        summary, step = self.check("")
        self.assertTrue(step["passed"])
        self.assertEqual(step["quarantine"]["cases"], [{"case": "a", "passed": True}])
        self.assertTrue(summary["passed"] and summary["quarantine"]["green"])
        _, step = self.check("a:2")
        self.assertEqual(step["quarantine"]["cases"], [{"case": "a", "passed": False}])

    def test_without_the_flag_nothing_is_quarantined_and_the_run_is_red(self):
        with mock.patch.dict(os.environ, {"STUB_CASES": "a:2", "STUB_UNENDED": ""}), redirect_stdout(io.StringIO()):
            summary = release_check.check(self.root, self.out(), "/x" + release_check.CHROME_SUFFIX, sys.executable,
                                          str(self.node), only=["native-colors"])
        self.assertNotIn("quarantine", summary)
        self.assertNotIn("quarantine", summary["steps"][0])


class PolicyFromTheBase(Fixture):
    def test_a_candidate_that_quarantines_its_own_red_is_not_held(self):
        # The event base keeps no quarantine; the candidate adds its own entry for the case it fails.
        self.git("checkout", "-q", "--detach", self.sources)
        self.base = self.commit_policy({"version": 1, "quarantine": []}, "event base without the entry")
        self.head = self.commit_policy({"version": 1, "quarantine": [entry()]}, "candidate quarantines its own red")
        summary, step = self.check("a:2")
        self.assertEqual(summary["quarantine"]["entries"], 0)
        self.assertEqual(step["quarantine"]["held"], [])
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(step["quarantine"]["unheld"], [{"case": "a", "why": "not quarantined"}])

    def test_the_checked_commit_itself_or_a_commit_after_it_is_never_the_base(self):
        summary, step = self.check("a:2", at=self.head)
        self.assertIn("is the commit checked", summary["quarantine"].get("refused", ""))
        self.assertNotIn("quarantine", step)
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(self.main("a:2", at=self.head)[0], 1)
        # A commit that is not an earlier commit of HEAD.
        self.git("checkout", "-q", "--detach", self.base)
        later = self.commit_file("elsewhere.txt", "x\n", "elsewhere")
        self.git("checkout", "-q", "--detach", self.head)
        summary, _ = self.check("a:2", at=later)
        self.assertIn("not an earlier commit", summary["quarantine"].get("refused", ""))

    def test_a_base_that_cannot_be_read_quarantines_nothing_and_says_why(self):
        summary, step = self.check("a:2", at="f" * 40)
        self.assertIn("cannot be read", summary["quarantine"].get("refused", ""))
        self.assertFalse(summary["quarantine"]["green"])
        self.assertFalse(step["passed"])

    def test_a_quarantine_that_cannot_be_read_never_claims_green_though_every_step_passed(self):
        # The raw verdict passes the run on its own; green speaks only for a quarantine that was read.
        summary, step = self.check("", at="f" * 40)
        self.assertTrue(step["passed"] and summary["passed"])
        self.assertIn("cannot be read", summary["quarantine"].get("refused", ""))
        self.assertFalse(summary["quarantine"]["green"])
        self.assertEqual(self.main("", at="f" * 40)[0], 0)
        summary, _ = self.check("")
        self.assertTrue(summary["quarantine"]["green"])

    def test_a_malformed_quarantine_at_the_base_quarantines_nothing(self):
        self.git("checkout", "-q", "--detach", self.base)
        self.base = self.commit_policy({"version": 1, "quarantine": [entry(stages=(STAGE,))]}, "one run only")
        self.head = self.commit_file("application.txt", "again\n", "candidate")
        summary, _ = self.check("a:2")
        self.assertIn("needs two live runs", summary["quarantine"].get("refused", ""))
        self.assertFalse(summary["quarantine"]["green"])

    def test_the_event_base_is_the_pull_requests_base_or_the_commit_a_push_moved_from(self):
        event = Path(self.tmp.name) / "event.json"
        for name, body, expected in (("pull_request", {"pull_request": {"base": {"sha": "a" * 40}}}, "a" * 40),
                                     ("push", {"before": "b" * 40, "after": "c" * 40}, "b" * 40)):
            event.write_text(json.dumps(body))
            self.assertEqual(quarantine.event_base({"GITHUB_EVENT_NAME": name, "GITHUB_EVENT_PATH": str(event)}), expected)
        for name, body, words in (("push", {"before": "0" * 40}, "does not name the commit the push moved the branch from"),
                                  ("pull_request", {"pull_request": {}}, "does not name the pull request's base"),
                                  ("workflow_dispatch", {"before": "b" * 40}, "a workflow_dispatch run has no event base")):
            event.write_text(json.dumps(body))
            with self.assertRaises(quarantine.Refused) as caught:
                quarantine.event_base({"GITHUB_EVENT_NAME": name, "GITHUB_EVENT_PATH": str(event)})
            self.assertIn(words, str(caught.exception))
        with self.assertRaisesRegex(quarantine.Refused, "cannot be read"):
            quarantine.event_base({"GITHUB_EVENT_NAME": "push", "GITHUB_EVENT_PATH": str(event) + ".missing"})

    def test_event_reads_the_base_from_the_runs_event(self):
        event = Path(self.tmp.name) / "event.json"
        event.write_text(json.dumps({"before": self.base}))
        with mock.patch.dict(os.environ, {"GITHUB_EVENT_NAME": "push", "GITHUB_EVENT_PATH": str(event)}):
            summary, step = self.check("a:2", at="event")
        self.assertEqual(summary["quarantine"]["at"], self.base)
        self.assertTrue(summary["quarantine"]["green"])
        with mock.patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_EVENT_PATH": str(event)}):
            summary, _ = self.check("a:2", at="event")
        self.assertIsNone(summary["quarantine"]["at"])
        self.assertIn("has no event base", summary["quarantine"].get("refused", ""))
        self.assertFalse(summary["quarantine"]["green"])


class Entries(unittest.TestCase):
    def refused(self, entries, words):
        with self.assertRaises(quarantine.Refused) as caught:
            quarantine.load({"quarantine": entries})
        self.assertIn(words, str(caught.exception))

    def test_a_well_formed_entry_loads_and_a_policy_without_the_field_quarantines_nothing(self):
        self.assertEqual(len(quarantine.load({"quarantine": [entry(), entry("b")]})), 2)
        self.assertEqual(quarantine.load({"version": 1}), [])

    def test_a_case_enters_only_red_at_one_stage_in_two_named_runs(self):
        self.refused([entry(stages=(STAGE,))], "needs two live runs")
        other = [dict(STAGE[0], text="assert.ok(other, 'other');")]
        self.refused([entry(stages=(STAGE, other))], "different stages")
        same_run = entry()
        same_run["red_in"][1]["run"] = same_run["red_in"][0]["run"]
        self.refused([same_run], "needs two live runs")
        self.refused([entry(stages=([], []))], "names no stage")
        no_commit = entry()
        no_commit["red_in"][0]["commit"] = "abc"
        self.refused([no_commit], "names no full commit")

    def test_only_a_browser_case_that_is_not_a_mutant_is_quarantined_once_with_an_owner_and_a_rule_to_leave(self):
        self.refused([entry(step="python-units")], "only a browser step")
        mutant = entry()
        mutant["case"]["expectedFailure"] = True
        self.refused([mutant], "never quarantined")
        self.refused([entry(owner=" ")], "has no owner")
        self.refused([entry(leave="")], "has no leave")
        self.refused([entry(), entry()], "quarantined twice")
        missing = entry()
        del missing["leave"]
        self.refused([missing], "each quarantined case is exactly")

    def test_the_live_policy_holds_the_initial_list(self):
        # The list this item seeds: each case red at one stage in at least two live push runs of releases 80 to 82.
        entries = quarantine.load(json.loads((ROOT / quarantine.POLICY).read_text()))
        self.assertEqual(len(entries), 18)
        live = {43756859856: 80, 43762908423: 81, 43771952998: 82}
        for item in entries:
            with self.subTest(case=item["case"]["name"]):
                self.assertTrue(all(live.get(run["run"]) == run["release"] for run in item["red_in"]))
                self.assertEqual(item["owner"], "runner lane")


class Count(Fixture):
    def run_tool(self, *argv):
        with mock.patch.object(quarantine, "REPO", self.root), redirect_stdout(io.StringIO()) as out, \
                redirect_stderr(io.StringIO()) as err:
            code = quarantine.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_count_prints_one_plain_number_from_the_file_or_a_commit(self):
        self.assertEqual(self.run_tool("count"), (0, "1\n", ""))
        self.assertEqual(self.run_tool("count", "--at", self.base), (0, "1\n", ""))
        self.git("checkout", "-q", "--detach", self.base)
        self.commit_policy({"version": 1, "quarantine": [entry(), entry("b")]}, "two")
        self.assertEqual(self.run_tool("count")[1], "2\n")
        self.assertEqual(self.run_tool("count", "--at", self.base)[1], "1\n")

    def test_count_never_prints_a_number_for_a_malformed_list(self):
        (self.root / quarantine.POLICY).write_text(json.dumps({"quarantine": [entry(stages=(STAGE,))]}))
        code, out, err = self.run_tool("count")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("needs two live runs", err)

    def test_passes_reads_each_runs_recorded_pass_for_the_rule_to_leave(self):
        summaries = []
        # The last two runs had no case "a": one step lists no such case, the other records it as not run (null).
        for number, passed in enumerate((True, True, False, None, "not run")):
            path = Path(self.tmp.name) / ("summary-%d.json" % number)
            cases = ([] if passed is None else [{"case": "a", "passed": None}] if passed == "not run"
                     else [{"case": "a", "passed": passed}])
            path.write_text(json.dumps({"steps": [{"name": "native-colors", "quarantine": {"cases": cases}},
                                                  {"name": "native-journal", "quarantine": {"cases": [{"case": "a", "passed": True}]}}]}))
            summaries.append(str(path))
        code, out, _ = self.run_tool("passes", *summaries)
        self.assertEqual((code, out), (0, "2 of 3  native-colors | a\n"))


class Workflow(unittest.TestCase):
    def test_every_shard_runs_the_release_check_with_the_quarantine_at_the_event_base(self):
        section = WORKFLOW.read_text().split("      - name: Release check, ${{ matrix.steps }}\n", 1)[1].split("\n      - name: ", 1)[0]
        command = section.split("run: |\n", 1)[1].replace("\\\n", " ")
        argv = [words for words in (shlex.split(line, comments=True) for line in command.splitlines()) if words and words[0] != "set"][0]
        self.assertEqual(argv[:3], ["/usr/bin/python3", "-I", "tools/release_check.py"])
        self.assertIn("--quarantine-at", argv)
        self.assertEqual(argv[argv.index("--quarantine-at") + 1], "event")


def workflow_script(name):
    section = WORKFLOW.read_text().split("      - name: " + name + "\n", 1)[1]
    return textwrap.dedent(section.split("<<'PY'", 1)[1].split("\n", 1)[1].split("          PY\n", 1)[0])


class Combine(unittest.TestCase):
    """The Checks workflow's combine job: its exit is green on raw failures only when each is a held quarantined case."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        for argv in (["init", "-q"], ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "head"]):
            subprocess.run(["git", "-C", str(self.repo)] + argv, check=True, capture_output=True)
        self.sha = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        self.env = dict(os.environ, GITHUB_EVENT_NAME="push", GITHUB_RUN_ID="7", GITHUB_RUN_ATTEMPT="1", GITHUB_WORKFLOW="Checks",
                        GITHUB_JOB="check", GITHUB_REPOSITORY="org/repo", GITHUB_SHA=self.sha, GITHUB_WORKFLOW_SHA=self.sha,
                        GITHUB_WORKFLOW_REF="workflow", BASE_REF="", BASE_SHA="", HEAD_REF="", HEAD_SHA="",
                        PLAN_SHARDS=json.dumps([{"steps": "native-colors"}, {"steps": "python-units"}]))

    def combine(self, colors, at=("b" * 40, "b" * 40), units="ran", unchanged=(True, True), edit=lambda summary: summary):
        """units: "ran" (python-units passed in the second shard), "refused" (that shard's release check refused before
        running, writing the summary release_check.main writes then) or "absent" (it left no summary, as a job cancelled
        at its limit does). unchanged: each shard's tree_unchanged. edit: changes the second shard's summary."""
        shards = self.root / "shards"
        steps = (colors, {"name": "python-units", "passed": True, "exit": 0, "counts": {"tests": 1}})
        for number, step in enumerate(steps[:1] if units == "absent" else steps):
            folder = shards / ("check-%d" % number)
            folder.mkdir(parents=True)
            summary = {"tool": release_check.TOOL, "commit": self.sha, "checkout": str(self.repo), "tools": {},
                       "required": ["native-colors", "python-units"], "steps": [step], "started_at": "2026-11-15T00:00:00Z",
                       "finished_at": "2026-11-15T00:01:00Z", "tree_unchanged": unchanged[number],
                       "tree_after": {"head": self.sha, "changes": "" if unchanged[number] else "?? written-by-the-step.txt\n"},
                       "passed": step["passed"], "only": [step["name"]]}
            if at[number] is not None:
                summary["quarantine"] = {"at": at[number], "entries": 1, "held": [], "green": True}
            if number == 1 and units == "refused":
                summary = {"tool": release_check.TOOL, "refused": "no Chrome for Testing", "passed": False, "at": "2026-11-15T00:00:00Z"}
            if number == 1:
                summary = edit(summary)
            (folder / "summary.json").write_text(json.dumps(summary))
            subprocess.run([sys.executable, "-I", "-S", "-c", workflow_script("Write this shard's receipt"), str(folder / "run.json")],
                           cwd=self.repo, env=dict(self.env, SHARD_NAME=step["name"], SHARD_STEPS=step["name"]),
                           capture_output=True, text=True, check=True)
        out = self.root / "release-check"
        out.mkdir()
        result = subprocess.run([sys.executable, "-I", "-S", "-c", workflow_script("Fold the shards' summaries into one"),
                                 str(shards), str(out / "summary.json")], cwd=self.repo, env=self.env, capture_output=True, text=True)
        self.assertTrue((out / "summary.json").exists(), "the combine wrote no summary: %s" % result.stderr)
        return result, json.loads((out / "summary.json").read_text())

    def colors(self, failed, held, unheld=(), record=()):
        """The native-colors step that failed on failed, its record holding held; record replaces fields of it."""
        step = {"name": "native-colors", "passed": False, "exit": 1, "counts": {"tests": 2, "fail": len(failed), "failed": list(failed)},
                "quarantine": {"cases": [], "held": list(held), "unheld": [{"case": c, "why": "not quarantined"} for c in unheld],
                               "green": not unheld}}
        step["quarantine"].update(dict(record))
        return step

    def test_a_missing_required_step_is_never_green(self):
        # The second shard's python-units is missing: its job refused before running, or left no summary at all.
        for units in ("refused", "absent"):
            with self.subTest(units=units):
                self.reset()
                result, combined = self.combine(self.colors(["a"], ["a"]), units=units)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(combined["failed"], ["native-colors", "python-units"])
                self.assertEqual(combined["quarantine"]["held"], [{"step": "native-colors", "case": "a"}])
                self.assertFalse(combined["quarantine"]["green"])
                self.assertIn('"missing": ["python-units"]', result.stdout)

    def test_only_a_refusal_that_ran_nothing_may_name_no_commit(self):
        # A shard that ran on another commit, or names none, is refused; so is a refusal that still carries steps.
        for said, edit in (("another commit", lambda summary: dict(summary, commit="c" * 40)),
                           ("no commit", lambda summary: {key: value for key, value in summary.items() if key != "commit"}),
                           ("a refusal with steps", lambda summary: dict(summary, commit="c" * 40, refused="late"))):
            with self.subTest(said=said):
                self.reset()
                shards = self.root / "shards"
                result = None
                try:
                    result, _ = self.combine(self.colors(["a"], ["a"]), edit=edit)
                except AssertionError as error:
                    self.assertIn("checked different commits", str(error))
                self.assertIsNone(result)
                self.assertTrue(shards.exists())

    def test_a_shard_whose_checkout_changed_is_never_green(self):
        # Either shard: the one with the held case, or the one whose step passed.
        for unchanged in ((False, True), (True, False)):
            with self.subTest(unchanged=unchanged):
                self.reset()
                result, combined = self.combine(self.colors(["a"], ["a"]), unchanged=unchanged)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse(combined["tree_unchanged"])
                self.assertFalse(combined["quarantine"]["green"])

    def test_a_record_that_disagrees_with_its_step_holds_nothing(self):
        # Each record breaks one condition and keeps the rest; the step's raw failure then stands.
        for said, step in (("not green", self.colors(["a"], ["a"], record={"green": False})),
                           ("names a case it does not hold",
                            self.colors(["a"], ["a"], record={"unheld": [{"case": "b", "why": "not quarantined"}]})),
                           ("refused", self.colors(["a"], ["a"], record={"refused": "the harness did not reach its end"})),
                           ("no failed case", self.colors([], []))):
            with self.subTest(said=said):
                # Only the condition named is broken: the record otherwise says green and holds exactly the failed cases.
                record = step["quarantine"]
                self.assertEqual((record["green"], record["held"]), (said != "not green", step["counts"]["failed"]))
                self.reset()
                result, combined = self.combine(step)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse(combined["quarantine"]["green"])

    def test_a_run_whose_only_failures_are_held_exits_green_with_its_raw_verdict_kept(self):
        result, combined = self.combine(self.colors(["a"], ["a"]))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(combined["passed"])
        self.assertEqual(combined["failed"], ["native-colors"])
        self.assertEqual(combined["quarantine"]["held"], [{"step": "native-colors", "case": "a"}])
        self.assertTrue(combined["quarantine"]["green"])
        self.assertIn('"quarantined": [{"step": "native-colors", "case": "a"}]', result.stdout)

    def test_a_failure_the_quarantine_does_not_hold_is_red(self):
        result, combined = self.combine(self.colors(["a", "b"], ["a"], ["b"]))
        self.assertEqual(result.returncode, 1)
        self.assertFalse(combined["quarantine"]["green"])
        # A record that says green but holds fewer cases than failed is not taken.
        self.reset()
        result, combined = self.combine(self.colors(["a", "b"], ["a"]))
        self.assertEqual(result.returncode, 1)
        self.assertFalse(combined["quarantine"]["green"])

    def test_shards_that_read_different_event_bases_are_red(self):
        result, combined = self.combine(self.colors(["a"], ["a"]), at=("b" * 40, "c" * 40))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(combined["quarantine"]["at"], ["b" * 40, "c" * 40])
        self.reset()
        result, _ = self.combine(self.colors(["a"], ["a"]), at=("b" * 40, None))
        self.assertEqual(result.returncode, 1)

    def reset(self):
        for name in ("shards", "release-check"):
            if (self.root / name).exists():
                shutil.rmtree(str(self.root / name))


if __name__ == "__main__":
    unittest.main()

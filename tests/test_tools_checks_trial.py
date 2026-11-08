from __future__ import annotations

"""Trials (D34, 7.6): `tools/checks.py trial` against a real store through the real agent CLI, in a small repository
whose own release check is a stand-in that is slow while slow.txt exists."""

import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from tools import checks, release_check
import test_agent_cli

ROOT = Path(__file__).resolve().parents[1]
CLI = str(ROOT / "bin" / "aim-next")
WAKE_CHECK = {"check_id": "wake-time", "group_name": "Measures", "position": 1, "name": "Wake time", "kind": "measure",
              "source": "release-check:wake-replay", "unit": "s", "better": "lower", "target_value": 10, "tolerance": 0.2, "repeats": 2}
UNITS_CHECK = {"check_id": "units", "group_name": "Checks", "position": 2, "name": "Unit checks", "kind": "pass", "source": "release-check:units"}

# The repository's own release check, as a trial runs it in its clone: it writes a summary of only the steps it is
# given, beside a base at the repository's first commit, slow (20 and 21 s) while slow.txt exists.
STAND_IN = r'''#!/usr/bin/python3 -I
import argparse, datetime, json, os, subprocess
parser = argparse.ArgumentParser()
for flag in ("--out", "--only", "--cli", "--profile", "--chrome"):
    parser.add_argument(flag)
parser.add_argument("--base", action="store_true")
args = parser.parse_args()
git = lambda *a: subprocess.run(["git"] + list(a), capture_output=True, text=True).stdout.strip()
now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
wake = lambda runs: {"name": "wake-replay", "tool": "tools/wake_replay.py", "passed": True, "started_at": now, "finished_at": now,
                     "series": {"aim-ux": {"runs": runs, "median": sorted(runs)[len(runs) // 2], "wakes": 4, "lost": []}}}
tools = {"release_check": "stand-in", "python": "3.9.6"}
summary = {"tool": "theseus-release-check", "commit": git("rev-parse", "HEAD"), "checkout": os.getcwd(), "tools": tools,
           "started_at": now, "finished_at": now, "only": args.only.split(","), "passed": True,
           "steps": [wake([20.0, 21.0] if os.path.exists("slow.txt") else [13.1, 13.2])] if "wake-replay" in args.only and not os.environ.get("STAND_IN_SKIPS") else [],
           "base": {"commit": git("rev-list", "--max-parents=0", "HEAD"), "tools": tools, "steps": [wake([13.0, 13.4])]} if args.base else None}
os.makedirs(args.out)
with open(os.path.join(args.out, "summary.json"), "w") as handle:
    json.dump(summary, handle)
'''


def git(root, *args):
    answer = subprocess.run(["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t.invalid"] + list(args),
                            capture_output=True, text=True)
    assert answer.returncode == 0, answer.stderr
    return answer.stdout.strip()


def commit(root, message, **files):
    for name, text in files.items():
        if text is None:
            (root / name).unlink()
        else:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(text)
    git(root, "add", "-A")
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD")


def stamp(minutes):
    return (datetime.datetime.now().astimezone() + datetime.timedelta(minutes=minutes)).isoformat(timespec="seconds")


class Trials(test_agent_cli.AgentCLIBase):
    """The live release L; item 1 (A), item 2 (B: slow wakes, and an edit on A's line), item 3 (C) and item 4 (D, which
    edits C's file) on top, so S = D is stopped for Wake time; agent-b reports."""

    def setUp(self):
        super().setUp()
        self.repo = Path(self.temp.name).resolve() / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "--quiet")
        self.live = commit(self.repo, "release 22", **{"tools/release_check.py": STAND_IN, "a.txt": "one\n"})
        self.a = commit(self.repo, "item 1", **{"a.txt": "two\n"})
        self.b = commit(self.repo, "item 2", **{"a.txt": "three\n", "slow.txt": "slow\n"})
        self.c = commit(self.repo, "item 3", **{"c.txt": "c\n"})
        self.d = commit(self.repo, "item 4", **{"c.txt": "cc\n"})
        for check in (WAKE_CHECK, UNITS_CHECK):
            revision = self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["relevant_versions"]["checks"]
            self.committed(self.command("check.define", {"check": check}, {"workspace_id": "w1"}, {"checks_revision": revision}, actor="agent-a"))
        self.assertTrue(self.store.record_release({"release": 22, "commit": self.live, "deployed_at": stamp(-60), "items": [], "source": "backfill"})["recorded"])
        units = {"check_id": "units", "result": "passed", "value": 900, "words": "900"}
        self.store.record_checks({"outcome": "w1", "commit": self.live, "started_at": stamp(-59), "finished_at": stamp(-58), "tools": {"python": "3.9.6"},
                                  "steps": [], "note": "", "readings": [units]}, "agent-a")
        candidate = {"tool": release_check.TOOL, "commit": self.d, "started_at": stamp(-10), "finished_at": stamp(-5), "tools": {"python": "3.9.6"},
                     "steps": [{"name": "wake-replay", "passed": True, "series": {"aim-ux": {"runs": [20.0, 21.0], "median": 20.5}}}],
                     "base": {"commit": self.live, "tools": {"python": "3.9.6"},
                              "steps": [{"name": "wake-replay", "passed": True, "series": {"aim-ux": {"runs": [13.0, 13.4], "median": 13.2}}}]}}
        run = checks.run_from_summary(candidate, [WAKE_CHECK], "w1")
        self.store.record_checks(dict(run, readings=run["readings"] + [units]), "agent-a")
        self.assertEqual(self.candidate()["state"], "stopped")
        self.places = []

    def candidate(self):
        return self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["loop"]["candidate"]

    def trial(self, without, reverts, of=None):
        made = tempfile.mkdtemp

        def mkdtemp(**kw):
            self.places.append(made(**kw))
            return self.places[-1]
        out = Path(self.temp.name) / ("trial-%d" % len(list(Path(self.temp.name).glob("trial-*"))))
        with mock.patch.object(checks.tempfile, "mkdtemp", mkdtemp):
            return checks.trial(CLI, str(self.profiles["agent-b"]), "w1", of or self.d, without, reverts, out, repo=self.repo), out

    def trials(self):
        return self.sql("SELECT trial_of,without FROM check_runs WHERE trial_of IS NOT NULL ORDER BY started_ms")

    def test_leaving_the_slow_item_out_clears_the_stop_and_is_named_the_likely_cause(self):
        found, out = self.trial([2], [self.b[:12]])
        self.assertEqual((found["stopped"], found["steps"], found["worse"], found["reverted"]), (["wake-time"], ["wake-replay"], [], [self.b]))
        summary = json.loads((out / "check" / "summary.json").read_text())
        self.assertEqual(summary["only"], ["wake-replay"], "only the stopped check's step")
        self.assertFalse(Path(summary["checkout"]).exists(), "the clone is removed")
        self.assertEqual(self.trials(), [(self.d, json.dumps({"items": [2], "reverted": [self.b]}, separators=(",", ":")))])
        candidate = self.candidate()
        self.assertEqual([(trial["without"], trial["worse_checks"]) for trial in candidate["trials"]], [([2], [])])
        self.assertEqual(candidate["likely_cause"]["items"], [2])
        self.assertEqual(candidate["state"], "stopped", "a trial reports; it does not ship or clear the candidate")

    def test_a_trial_that_is_still_worse_is_not_a_likely_cause(self):
        found, _ = self.trial([4], [self.d])
        self.assertEqual([item["check_id"] for item in found["worse"]], ["wake-time"])
        self.assertEqual(self.candidate()["likely_cause"], {"none": True, "tried": [[4]]})

    def test_a_trial_that_did_not_read_the_stopped_check_is_not_a_likely_cause(self):
        # Checks the trial did not rerun are not its results; the stopped check it failed to read is still worse.
        with mock.patch.dict(os.environ, {"STAND_IN_SKIPS": "1"}):
            found, _ = self.trial([2], [self.b])
        self.assertEqual([item["check_id"] for item in found["worse"]], ["wake-time"])
        self.assertEqual([trial["worse_checks"] for trial in self.candidate()["trials"]], [["wake-time"]])
        self.assertEqual(self.candidate()["likely_cause"], {"none": True, "tried": [[2]]})

    def test_reverts_go_newest_first_whatever_order_they_are_named_in(self):
        # Reverting C before D would delete the file D edits: a conflict. Newest first, both revert cleanly.
        try:
            found, _ = self.trial([3, 4], [self.c, self.d])
        except checks.Refused as refused:
            self.fail("refused: %s" % refused)
        self.assertEqual(found["reverted"], [self.d, self.c])

    def test_refusals_report_nothing_and_leave_no_clone(self):
        cases = [(([2], [self.live]), "is not between the live release"),
                 (([2], ["f" * 40]), "is not between the live release"),
                 (([1], [self.a]), "conflicts"),
                 (([2], [self.b], self.b), "is not a stopped candidate"),
                 (([], [self.b]), "a trial names the items"),
                 (([2], [self.b], "short"), "full 40-character commit")]
        for args, words in cases:
            with self.subTest(words=words, args=args):
                with self.assertRaises(checks.Refused) as refused:
                    self.trial(*args)
                self.assertIn(words, str(refused.exception))
                self.assertEqual(self.trials(), [])
                self.assertFalse([place for place in self.places if Path(place).exists()], "no clone is left")
        self.assertEqual(len(self.places), 1, "only the conflict got as far as a clone")

    def test_the_command_line_prints_what_it_found(self):
        out = Path(self.temp.name) / "cli-trial"
        answer = subprocess.run(["/usr/bin/python3", "-I", "-B", str(ROOT / "tools" / "checks.py"), "trial", "--cli", CLI, "--profile",
                                 str(self.profiles["agent-b"]), "--outcome", "w1", "--of", self.d, "--without", "2", "--revert", self.b, "--out", str(out), "--repo", str(self.repo)],
                                capture_output=True, text=True, cwd=str(self.repo))
        self.assertEqual(answer.returncode, 0, answer.stderr)
        self.assertTrue(answer.stdout.startswith("Without item 2: wake-time cleared."), answer.stdout)
        refused = subprocess.run(["/usr/bin/python3", "-I", "-B", str(ROOT / "tools" / "checks.py"), "trial", "--cli", CLI, "--profile",
                                  str(self.profiles["agent-b"]), "--outcome", "w1", "--of", self.d, "--without", "two", "--revert", self.b,
                                  "--out", str(out) + "-2", "--repo", str(self.repo)], capture_output=True, text=True, cwd=str(self.repo))
        self.assertEqual((refused.returncode, refused.stderr.strip()), (2, "refused: --without is item numbers"))


if __name__ == "__main__":
    unittest.main()

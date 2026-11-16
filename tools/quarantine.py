#!/usr/bin/python3 -I
from __future__ import annotations

"""Item 549: browser cases quarantined because live fails them too, read from the policy at the event base.

Usage: tools/quarantine.py count [--at COMMIT]
       tools/quarantine.py passes SUMMARY... [--at COMMIT]

The quarantine is the `quarantine` list of .github/check-baseline.json, the policy file whose admissions GitHub's
classifier reads (docs/ci-known-reds.md). The release check reads it at the run's event base, never at the commit it
checks (release_check.py --quarantine-at COMMIT|event), so a change can never quarantine its own reds. A quarantined
case still runs and still fails in the summary, its step's raw verdict unchanged; when every failure of a step is a
quarantined case failing at the stage it was quarantined at, in a run that ended as a run with failed cases ends, the
step's quarantine record says so (green) and the release check's exit does not fail for it. docs/ci-known-reds.md
("The quarantine") is the contract.

An entry: {"step": "native-…", "case": {name, phase, engine, expectedFailure}, "owner": "…", "leave": "…",
           "red_in": [{"run": GITHUB_RUN_ID, "commit": FULL_SHA, "release": N, "stage": [{path, text, count, index}, …]}, …]}
with at least two live push runs, each naming the stage the case failed at there, the same stage in each.

count prints how many cases are quarantined, one plain number (the board reads it). passes reads release-check
summaries and prints, for each quarantined case, in how many of them its whole step ran and the case passed: the
ten-of-ten rule to leave the quarantine is read from those runs.
"""

import json
from pathlib import Path
import re
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import ci_known_reds, known_reds

REPO = Path(__file__).resolve().parents[1]
POLICY = known_reds.POLICY
FIELD = "quarantine"
ENTRY = ("step", "case", "owner", "leave", "red_in")
RUN = ("run", "commit", "release", "stage")
FRAME = ("path", "text", "count", "index")
CASE = ("name", "phase", "engine", "expectedFailure")
SHA = re.compile(r"[0-9a-f]{40}")
NO_COMMIT = "0" * 40
EVENT_BASES = {"pull_request": "the pull request's base", "push": "the commit the push moved the branch from"}


class Refused(Exception):
    """The quarantine cannot be read or is malformed; nothing is quarantined, and the message says why."""


def _line(value):
    return isinstance(value, str) and bool(value.strip()) and "\n" not in value and "\r" not in value


def _stage(stage, said):
    if not isinstance(stage, list) or not stage:
        raise Refused("%s names no stage" % said)
    for frame in stage:
        if not isinstance(frame, dict) or set(frame) != set(FRAME):
            raise Refused("%s: each frame of its stage is exactly %s" % (said, ", ".join(FRAME)))
        if not isinstance(frame["path"], str) or not frame["path"].startswith("tests/") or not _line(frame["text"]):
            raise Refused("%s: a frame of its stage names no test source line" % said)
        if type(frame["count"]) is not int or type(frame["index"]) is not int or not 0 <= frame["index"] < frame["count"]:
            raise Refused("%s: a frame's index is not one of its line's occurrences" % said)


def load(policy):
    """The policy's quarantine entries, or Refused naming the first one that is malformed. A policy without the field
    quarantines nothing."""
    if not isinstance(policy, dict):
        raise Refused("%s is not a JSON object" % POLICY)
    entries = policy.get(FIELD, [])
    if not isinstance(entries, list):
        raise Refused("%s's %s is a list" % (POLICY, FIELD))
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != set(ENTRY):
            raise Refused("each quarantined case is exactly %s: %r" % (", ".join(ENTRY), entry))
        if entry["step"] not in known_reds.NATIVE:
            raise Refused("a quarantined case names %r; only a browser step's cases are quarantined" % (entry["step"],))
        case = entry["case"]
        if not isinstance(case, dict) or set(case) != set(CASE) or not _line(case["name"]):
            raise Refused("a quarantined case of %s is exactly %s" % (entry["step"], ", ".join(CASE)))
        said = "%s %r" % (entry["step"], case["name"])
        if case["expectedFailure"] is not False:
            raise Refused("%s is a mutant's result; a mutant that escapes is never quarantined" % said)
        for field in ("owner", "leave"):
            if not _line(entry[field]):
                raise Refused("%s has no %s" % (said, field))
        runs = entry["red_in"]
        if not isinstance(runs, list) or not all(isinstance(run, dict) and set(run) == set(RUN) for run in runs):
            raise Refused("%s: each run it was red in is exactly %s" % (said, ", ".join(RUN)))
        if len({run["run"] for run in runs}) < 2 or len(runs) != len({run["run"] for run in runs}):
            raise Refused("%s needs two live runs it was red in, each named once" % said)
        for run in runs:
            if type(run["run"]) is not int or run["run"] <= 0 or type(run["release"]) is not int:
                raise Refused("%s: a run it was red in is named by its run id and release number" % said)
            if not isinstance(run["commit"], str) or not SHA.fullmatch(run["commit"]):
                raise Refused("%s: run %s names no full commit" % (said, run["run"]))
            _stage(run["stage"], "%s in run %s" % (said, run["run"]))
        if any(run["stage"] != runs[0]["stage"] for run in runs):
            raise Refused("%s failed at different stages in the runs it names, so it was not red at one stage in two" % said)
        pair = (entry["step"], ci_known_reds.key(case))
        if pair in seen:
            raise Refused("%s is quarantined twice" % said)
        seen.add(pair)
    return entries


def _git(root, *args):
    return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True, text=True)


def at_commit(root, commit):
    """The quarantine of the policy at commit, which must be an earlier commit of root's HEAD (the event base, never the
    commit checked itself); [] when commit keeps no policy; Refused when it cannot be read."""
    if not isinstance(commit, str) or not SHA.fullmatch(commit) or commit == NO_COMMIT:
        raise Refused("the event base is a full commit, not %r" % (commit,))
    head = _git(root, "rev-parse", "--verify", "HEAD^{commit}")
    if head.returncode != 0:
        raise Refused("the checked commit cannot be read: %s" % head.stderr.strip()[:300])
    if head.stdout.strip() == commit:
        raise Refused("the event base %s is the commit checked, whose own policy never counts for it" % commit[:12])
    ancestor = _git(root, "merge-base", "--is-ancestor", commit, "HEAD")
    if ancestor.returncode == 1:
        raise Refused("the event base %s is not an earlier commit of %s" % (commit[:12], head.stdout.strip()[:12]))
    if ancestor.returncode != 0:
        raise Refused("whether %s is an earlier commit cannot be read: %s" % (commit[:12], ancestor.stderr.strip()[:300]))
    return _policy_at(root, commit)


def _policy_at(root, commit):
    listed = _git(root, "ls-tree", "--name-only", commit, "--", POLICY)
    if listed.returncode != 0:
        raise Refused("whether %s keeps %s cannot be read: %s" % (commit[:12], POLICY, listed.stderr.strip()[:300]))
    if not listed.stdout.strip():
        return []
    shown = _git(root, "show", "%s:%s" % (commit, POLICY))
    try:
        policy = json.loads(shown.stdout) if shown.returncode == 0 else None
    except ValueError as error:
        raise Refused("%s at %s is not JSON: %s" % (POLICY, commit[:12], error))
    if shown.returncode != 0:
        raise Refused("%s at %s cannot be read: %s" % (POLICY, commit[:12], shown.stderr.strip()[:300]))
    return load(policy)


def event_base(environ):
    """The commit a GitHub run's quarantine is read at: a pull request's base, or the commit a push moved its branch
    from; Refused for any other event or an event that names none."""
    name = environ.get("GITHUB_EVENT_NAME")
    if name not in EVENT_BASES:
        raise Refused("a %s run has no event base, so nothing is quarantined" % name)
    try:
        event = json.loads(Path(environ.get("GITHUB_EVENT_PATH") or "").read_text())
    except (OSError, ValueError) as error:
        raise Refused("the %s event cannot be read: %s" % (name, error))
    base = ((event.get("pull_request") or {}).get("base") or {}).get("sha") if name == "pull_request" else event.get("before")
    if not isinstance(base, str) or not SHA.fullmatch(base) or base == NO_COMMIT:
        raise Refused("the %s event does not name %s, so nothing is quarantined" % (name, EVENT_BASES[name]))
    return base


def judge_step(result, out, entries, root, commit, checkout):
    """The quarantine's record for one native step's result, or None when the step passed and nothing of it is
    quarantined. The record lists each quarantined case of the step and whether it passed (None: not in the run), the
    failed cases it holds, and those it does not hold with why; green is the step's verdict: it passed, or it failed
    only on held cases in a run that ended as one with failed cases does (known_reds.ended_cases). The result itself,
    its passed and its counts, is never changed."""
    name = result.get("name")
    mine = {ci_known_reds.key(entry["case"]): entry for entry in entries if entry["step"] == name}
    if not mine and result.get("passed") is True:
        return None
    step = known_reds.NATIVE[name]
    try:
        rows = json.loads((out / "native" / step.name / step.results).read_text()).get("results") or []
        rows = {ci_known_reds.key(row): row for row in rows if isinstance(row, dict) and isinstance(row.get("name"), str)}
    except (OSError, ValueError, AttributeError):
        rows = {}
    record = {"cases": [{"case": entry["case"]["name"], "passed": rows[key].get("passed") is True if key in rows else None}
                        for key, entry in mine.items()],
              "held": [], "unheld": [], "green": result.get("passed") is True}
    if record["green"]:
        return record
    try:
        failed = known_reds.ended_cases(out, result, "this run")
    except known_reds.Refused as refusal:
        record["refused"] = str(refusal)
        return record
    for case, row in failed.items():
        entry = mine.get(ci_known_reds.key(row))
        if entry is None:
            record["unheld"].append({"case": case, "why": "not quarantined"})
            continue
        try:
            stage = ci_known_reds.fingerprint(row.get("error"), checkout, root, commit)["chain"]
        except ci_known_reds.Refused as refusal:
            record["unheld"].append({"case": case, "why": "its stage cannot be read: %s" % refusal})
            continue
        if stage != entry["red_in"][0]["stage"]:
            record["unheld"].append({"case": case, "why": "it failed at another stage than the one it was quarantined at"})
            continue
        record["held"].append(case)
    record["green"] = not record["unheld"]
    return record


def passes(summaries, entries):
    """[(step, case, passed, ran)]: for each quarantined case, in how many of the summaries its whole step ran with the
    case in it, and in how many of those the case passed, as each run's quarantine record keeps it."""
    tally = {(entry["step"], entry["case"]["name"]): [0, 0] for entry in entries}
    for path in summaries:
        try:
            summary = json.loads(Path(path).read_text())
        except (OSError, ValueError) as error:
            raise Refused("no readable release-check summary at %s: %s" % (path, error))
        for step in summary.get("steps") or []:
            for case in ((step.get("quarantine") or {}).get("cases") or []) if isinstance(step, dict) else []:
                counts = tally.get((step.get("name"), case.get("case")))
                if counts is not None and case.get("passed") is not None:
                    counts[1] += 1
                    counts[0] += case["passed"] is True
    return [(step, case, counts[0], counts[1]) for (step, case), counts in tally.items()]


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="The quarantined browser cases of %s." % POLICY)
    parser.add_argument("command", choices=("count", "passes"))
    parser.add_argument("summaries", nargs="*")
    parser.add_argument("--at", metavar="COMMIT", help="read the policy at this commit instead of this checkout's file")
    args = parser.parse_args(argv)
    try:
        if args.at is not None:
            entries = _policy_at(REPO, args.at)
        else:
            try:
                entries = load(json.loads((REPO / POLICY).read_text()))
            except (OSError, ValueError) as error:
                raise Refused("%s cannot be read: %s" % (POLICY, error))
        if args.command == "count":
            if args.summaries:
                raise Refused("count takes no summaries")
            print(len(entries))
        else:
            if not args.summaries:
                raise Refused("passes reads at least one release-check summary")
            for step, case, passed, ran in passes(args.summaries, entries):
                print("%d of %d  %s | %s" % (passed, ran, step, case))
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

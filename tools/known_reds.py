from __future__ import annotations

"""Item 178: browser cases a release check failed that the live version already fails.

tools/deploy.py --known-reds FILE takes a release-check summary that did not pass only when every failure in it is a
browser case FILE lists, and a release-check summary of the live commit shows that same case failing in a run of the
same step that ended as it should. Nothing is run again: both runs are read from the evidence each summary keeps
beside it. The cases stay failures: the deploy records them as known reds, never as passes. docs/tools.md
("Known reds") is the contract.

FILE: {"live_commit": FULL_SHA,
       "reds": [{"step": "native-…", "case": "…", "live_summary": "/abs/summary.json", "why": "one line"}]}
"""

import json
from pathlib import Path
import re

from tools import release_check

KEYS = ("live_commit", "reds")
FIELDS = ("step", "case", "live_summary", "why")
NATIVE = {"native-" + step.name: step for step in release_check.NATIVE_STEPS}
# A native harness that ran to its end with a case failed exits 1; a crash, a signal or a refusal does not say that.
FAILED_EXIT = 1
# Node prints this for the last assertion of the harnesses that write native.json with fixtureExitCode. They reach it
# only after their browser and fixture are closed and the fixture's own assertions held, and it fails only when a case
# did (tests/reader_persistence_native.mjs, tests/reader_openings_native.mjs, tests/webkit_native.mjs).
END_LINE = "AssertionError [ERR_ASSERTION]: see native.json for exact failing assertions"
# tests/reader_compose_native.mjs attests its end in its native.json instead: each of these planned phases (a function
# of the harness, in an engine) returned and its browser closed, in this order, and then the harness marked itself
# completed; and its fixture's exit, held from launch, was code 0 with no signal.
COMPOSE_PHASES = ["run:chromium", "run:webkit", "runAnswering:chromium", "runAnswering:webkit",
                  "runSending:chromium", "runSending:webkit"]
WHY_LENGTH = 300


class Refused(Exception):
    """The known reds do not let the summary through; the message names the first condition that fails."""


def load(path):
    """The known reds file as {live_commit, reds}, or Refused naming what is wrong with it."""
    if not Path(path).is_absolute():
        raise Refused("--known-reds is an absolute path, not %s" % path)
    try:
        known = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Refused("no readable known reds file at %s: %s" % (path, error))
    if not isinstance(known, dict) or set(known) != set(KEYS):
        raise Refused("the known reds file is a JSON object with exactly %s" % ", ".join(KEYS))
    if not isinstance(known["live_commit"], str) or not re.fullmatch(r"[0-9a-f]{40}", known["live_commit"]):
        raise Refused("live_commit is the live release's full 40-character commit, not %r" % (known["live_commit"],))
    reds = known["reds"]
    if not isinstance(reds, list) or not reds:
        raise Refused("reds lists at least one known red")
    seen = set()
    for red in reds:
        if not isinstance(red, dict) or set(red) != set(FIELDS):
            raise Refused("each known red is a JSON object with exactly %s: %r" % (", ".join(FIELDS), red))
        if not isinstance(red["step"], str) or red["step"] not in NATIVE:
            raise Refused("a known red names %r; only a browser step (native-…) can have known reds" % (red["step"],))
        if not isinstance(red["case"], str) or not red["case"]:
            raise Refused("a known red of %s names no case" % red["step"])
        if not isinstance(red["live_summary"], str) or not Path(red["live_summary"]).is_absolute():
            raise Refused("the live_summary of %s %r is an absolute path" % (red["step"], red["case"]))
        why = red["why"]
        if not isinstance(why, str) or not why.strip() or "\n" in why or "\r" in why or len(why) > WHY_LENGTH:
            raise Refused("the why of %s %r is one line of at most %d characters" % (red["step"], red["case"], WHY_LENGTH))
        if (red["step"], red["case"]) in seen:
            raise Refused("%s %r is listed twice" % (red["step"], red["case"]))
        seen.add((red["step"], red["case"]))
    return known


def _final_json(text):
    """The JSON object a log ends with, printed with two-space indents from a line holding only "{"; None otherwise."""
    lines = text.rstrip("\n").split("\n")
    starts = [index for index, line in enumerate(lines) if line == "{"]
    if not starts:
        return None
    try:
        return json.loads("\n".join(lines[starts[-1]:]))
    except ValueError:
        return None


def ended_cases(out, result, whose):
    """The failed cases of one native step's run, read from the evidence release_check left in out (the summary's
    folder), or Refused when that run cannot show its harness ran to the end with only those cases failed.

    result is the summary's entry for the step. Its harness must have exited as a run that ended on failed cases does,
    left a readable results file the summary's counts were read from, closed its browser, had its fixture exit as that
    harness expects, and reached its last line (the composer's harness: recorded that every planned phase completed);
    every failed case must be named, and named once among the run's cases, so a name stands for exactly one case."""
    name = result.get("name")
    step = NATIVE[name]
    said = "%s %s" % (whose, name)
    if result.get("exit") != FAILED_EXIT:
        raise Refused("%s exited %r, not %d as a harness that ended on failed cases does" % (said, result.get("exit"), FAILED_EXIT))
    evidence, log = out / "native" / step.name, out / (name + ".log")
    try:
        report = json.loads((evidence / step.results).read_text())
        text = log.read_text(errors="replace")
    except (OSError, ValueError) as error:
        raise Refused("%s has no readable evidence: %s" % (said, error))
    results = report.get("results") if isinstance(report, dict) else None
    if not isinstance(results, list) or not results or not all(isinstance(case, dict) for case in results):
        raise Refused("%s lists no cases in %s" % (said, evidence / step.results))
    counts, _ = release_check.native_counts(step, evidence)
    if result.get("counts") != counts:
        raise Refused("%s: the summary's counts are not those of its evidence in %s" % (said, evidence))
    if not counts["browser_closed"]:
        raise Refused("%s: the browser did not close" % said)
    if step.harness == release_check.COMPOSE:
        _compose_ended(report, said)
        ended = True
    elif step.results == "results.json":
        # tests/reader_native.mjs serves its page itself, so it has no fixture process; its last act prints its results.
        final = _final_json(text)
        ended = isinstance(final, dict) and final.get("closed") is True and final.get("results") == results
    else:
        if report.get("fixtureExitCode") != 0:
            raise Refused("%s: its fixture exited %r, not 0" % (said, report.get("fixtureExitCode")))
        ended = END_LINE in text.splitlines()
    if not ended:
        raise Refused("%s: the harness did not reach its end (%s)" % (said, log))
    failed = counts["failed"]
    if not failed:
        raise Refused("%s failed, but its results name no failed case" % said)
    names = [case.get("name") for case in results]
    for case in failed:
        if not isinstance(case, str) or not case or names.count(case) != 1:
            raise Refused("%s: the failed case %r is not named once among its cases" % (said, case))
    return failed


def _compose_ended(report, said):
    """Refused unless the composer's native.json says every planned phase ran and its fixture exited 0, no signal."""
    code, signal = report.get("fixtureExitCode"), report.get("fixtureExitSignal", "none recorded")
    if type(code) is not int or code != 0 or signal is not None:
        raise Refused("%s: its fixture exited %r (signal %r), not 0 with no signal" % (said, code, signal))
    for field in ("plannedPhases", "completedPhases"):
        if report.get(field) != COMPOSE_PHASES:
            raise Refused("%s: its %s are %r, not %s" % (said, field, report.get(field), ", ".join(COMPOSE_PHASES)))
    if report.get("harnessCompleted") is not True:
        raise Refused("%s: the harness did not complete (harnessCompleted %r)" % (said, report.get("harnessCompleted")))


def candidate_failures(summary, out):
    """{step: its failed cases} of a summary that did not pass, or Refused: every step it should have run is there,
    every step that failed is a browser step, and each of those ended as ended_cases requires."""
    steps = [step for step in summary.get("steps") or [] if isinstance(step, dict)]
    ran = [step.get("name") for step in steps]
    # judge_summary has already refused a skip the deploy did not confirm.
    skipped = summary.get("skipped") if isinstance(summary.get("skipped"), dict) else {}
    required = sorted(set(release_check.REQUIRED) | set(summary.get("required") or []), key=str)
    missing = [name for name in required if name not in ran and name not in (skipped.get("steps") or [])]
    if missing:
        raise Refused("the release check did not run %s; a known red stands only for a case of a step that ran"
                      % ", ".join(str(name) for name in missing))
    twice = sorted({name for name in ran if ran.count(name) > 1}, key=str)
    if twice:
        raise Refused("the release check lists %s more than once" % ", ".join(str(name) for name in twice))
    failed = [step for step in steps if step.get("passed") is not True]
    if not failed:
        raise Refused("the release check did not pass, and no step of it failed, so no known red can stand for that")
    for step in failed:
        if step.get("name") not in NATIVE:
            raise Refused("%s failed; only a browser step's failed cases can be known reds" % step.get("name"))
    return {step["name"]: ended_cases(out, step, "the candidate's") for step in failed}


def live_cases(red, live_commit):
    """The failed cases of red's step in its live summary, or Refused unless that summary is a release check of exactly
    the live commit, its checkout unchanged, in which the step ran and ended as ended_cases requires."""
    path = Path(red["live_summary"])
    said = "the live summary %s" % path
    try:
        summary = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise Refused("%s cannot be read: %s" % (said, error))
    if not isinstance(summary, dict) or summary.get("tool") != release_check.TOOL:
        raise Refused("%s is not a release-check summary" % said)
    if summary.get("commit") != live_commit:
        raise Refused("%s ran on %s, not the live commit %s" % (said, summary.get("commit"), live_commit))
    if summary.get("tree_unchanged") is not True:
        raise Refused("%s: the checkout changed while it ran" % said)
    steps = summary.get("steps")
    if not isinstance(steps, list):
        raise Refused("%s lists no steps" % said)
    found = [step for step in steps if isinstance(step, dict) and step.get("name") == red["step"]]
    if len(found) != 1:
        raise Refused("%s did not run %s once" % (said, red["step"]))
    return ended_cases(path.parent, found[0], "the live")


def judge(path, summary_path, unpassed, live_head):
    """What the known reds accept of a summary that judge_summary found describes the commit, or Refused naming the
    first condition that fails.

    unpassed: judge_summary's reasons the run did not pass; [] takes every listed red as not needed. live_head(): the
    live checkout's HEAD, as the deploy reads it. Returns {file, live_commit, accepted: [{step, case, live_summary,
    live_commit, why}], not_needed: [{step, case}]}; accepted is empty only for a summary that passed."""
    known = load(path)
    listed = {(red["step"], red["case"]): red for red in known["reds"]}
    taken = {"file": str(path), "live_commit": known["live_commit"], "accepted": [], "not_needed": []}
    if not unpassed:
        taken["not_needed"] = [{"step": step, "case": case} for step, case in listed]
        return taken
    head = live_head()
    if known["live_commit"] != head:
        raise Refused("the known reds were read beside %s, but %s is live" % (known["live_commit"], head))
    summary = json.loads(Path(summary_path).read_text())
    failures = candidate_failures(summary, Path(summary_path).parent)
    for step in sorted(failures):
        for case in failures[step]:
            if (step, case) not in listed:
                raise Refused("%s failed %r, which the known reds do not list" % (step, case))
    for step in sorted(failures):
        for case in failures[step]:
            red = listed[(step, case)]
            if case not in live_cases(red, known["live_commit"]):
                raise Refused("%s %r is not among the cases that failed in %s on the live commit" % (step, case, red["live_summary"]))
            taken["accepted"].append({"step": step, "case": case, "live_summary": red["live_summary"],
                                      "live_commit": known["live_commit"], "why": red["why"]})
    taken["not_needed"] = [{"step": step, "case": case} for step, case in listed if case not in failures.get(step, ())]
    return taken

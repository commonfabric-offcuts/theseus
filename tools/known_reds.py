from __future__ import annotations

"""Item 178: browser cases a release check failed that are already known to fail.

tools/deploy.py --known-reds FILE takes a release-check summary that did not pass only when every failure in it is a
browser case FILE lists, and each is known (item 481): the policy at the event base admits it (.github/check-baseline.json
at the live commit, never the candidate's copy, loaded and matched as tools/ci_known_reds.py loads and matches it with
the pull request's event base: the case's identity and its failure's fingerprint, Admissions), or a release-check
summary of the live commit
shows that same case failing in a run of the same step that ended as it should. Nothing is run again: both runs are
read from the evidence each summary keeps beside it. The cases stay failures: the deploy records them as known reds,
never as passes. docs/tools.md ("Known reds") is the contract.

FILE: {"live_commit": FULL_SHA,
       "reds": [{"step": "native-…", "case": "…", "live_summary": "/abs/summary.json" | null, "why": "one line"}]}

Item 482: a red's live_summary may instead name an owner's acceptance, which takes the cases it names exactly:
{"owner_acceptance": true, "cases": [{"step": "native-…", "case": "…"}], "by": "who", "message": "m-…", "why": "…"}
"""

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

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
# The composer's end-of-run record. A live run from before the harness wrote it has none of these fields; one with any of
# them is read as a run that writes it.
COMPOSE_END = ("fixtureExitCode", "fixtureExitSignal", "plannedPhases", "completedPhases", "harnessCompleted")
# The policy of expected browser failures, which GitHub's classifier reads at the event base (docs/ci-known-reds.md).
POLICY = ".github/check-baseline.json"
# Item 482: an owner's acceptance of named cases, which a red's live_summary may name in place of a live summary.
OWNER_KEYS = ("owner_acceptance", "cases", "by", "message", "why")
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
        if red["live_summary"] is not None and (not isinstance(red["live_summary"], str)
                                                or not Path(red["live_summary"]).is_absolute()):
            raise Refused("the live_summary of %s %r is an absolute path, or null for a red the policy admits"
                          % (red["step"], red["case"]))
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


def ended_cases(out, result, whose, before_end_record=False):
    """{name: its row in the results file} for each failed case of one native step's run, read from the evidence
    release_check left in out (the summary's folder), or Refused when that run cannot show its harness ran to the end
    with only those cases failed. before_end_record: a composer run from before its harness wrote the end-of-run record
    (none of COMPOSE_END) counts once its browser closed and it names the case failed (item 481, live runs only).

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
        if not (before_end_record and not any(field in report for field in COMPOSE_END)):
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
    return {case: results[names.index(case)] for case in failed}


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


def owner_accepted(acceptance, red, said):
    """Item 482: the owner's acceptance when it names red's step and case exactly, with who accepted it and in which
    message; Refused otherwise."""
    if set(acceptance) != set(OWNER_KEYS):
        raise Refused("%s is an owner's acceptance, a JSON object with exactly %s" % (said, ", ".join(OWNER_KEYS)))
    cases = acceptance["cases"]
    if not isinstance(cases, list) or not all(isinstance(case, dict) and set(case) == {"step", "case"} for case in cases):
        raise Refused("%s is an owner's acceptance whose cases are not each {step, case}" % said)
    for key in ("by", "message"):
        if not isinstance(acceptance[key], str) or not acceptance[key].strip():
            raise Refused("%s is an owner's acceptance with no %s" % (said, key))
    if {"step": red["step"], "case": red["case"]} not in cases:
        raise Refused("%s is an owner's acceptance, but not of %s %r" % (said, red["step"], red["case"]))
    return acceptance


def live_cases(red, live_commit):
    """(the failed cases of red's step in its live summary, None), or Refused unless that summary is a release check of
    exactly the live commit, its checkout unchanged, in which the step ran and ended as ended_cases requires; or, for an
    owner's acceptance that names red's step and case exactly (item 482), ([red's case], the acceptance)."""
    path = Path(red["live_summary"])
    said = "the live summary %s" % path
    try:
        summary = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise Refused("%s cannot be read: %s" % (said, error))
    if isinstance(summary, dict) and summary.get("owner_acceptance") is True:
        return [red["case"]], owner_accepted(summary, red, said)
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
    return ended_cases(path.parent, found[0], "the live", before_end_record=True), None


# Item 553: what a commit's own tools/release_check.py names, printed by a Python of its own run on a copy of that
# commit's tools/ (argv[1] is the folder holding it).
STEPS_AT = ("import json, sys; sys.path.insert(0, sys.argv[1]); from tools import release_check as checked; "
            "print(json.dumps({'required': list(checked.REQUIRED), "
            "'native': {'native-' + step.name: step.harness for step in checked.NATIVE_STEPS}}))")


def steps_at(root, commit):
    """Item 553: (the required steps, {native step: its harness}) as commit's own tools/release_check.py names them, read
    from root's git and run in a Python of its own, never this checkout's; Refused when they cannot be read."""
    said = "the release check's steps at %s could not be read" % commit[:12]
    archive = subprocess.run(["git", "-C", str(root), "archive", "--format=tar", commit, "tools"], capture_output=True)
    if archive.returncode != 0:
        raise Refused("%s (git archive exit %d): %s" % (said, archive.returncode, archive.stderr.decode(errors="replace").strip()[:300]))
    with tempfile.TemporaryDirectory() as folder:
        unpacked = subprocess.run(["tar", "-x", "-C", folder], input=archive.stdout, capture_output=True)
        if unpacked.returncode != 0:
            raise Refused("%s (tar exit %d): %s" % (said, unpacked.returncode, unpacked.stderr.decode(errors="replace").strip()[:300]))
        read = subprocess.run([sys.executable, "-I", "-B", "-c", STEPS_AT, folder], capture_output=True, text=True)
    try:
        steps = json.loads(read.stdout) if read.returncode == 0 else None
    except ValueError:
        steps = None
    required, native = (steps.get("required"), steps.get("native")) if isinstance(steps, dict) else (None, None)
    if not (isinstance(required, list) and required and all(isinstance(name, str) for name in required)
            and isinstance(native, dict) and all(isinstance(path, str) for path in native.values())
            and set(native) <= set(required)):
        raise Refused("%s (exit %d): %s" % (said, read.returncode, (read.stderr or read.stdout).strip()[-300:]))
    return required, native


def steps_beyond(policy, base):
    """Item 553: the required steps this checkout's release check runs that policy (POLICY at base) does not review, in
    the check's order, for the next policy to cover; Refused when it names no list of required steps."""
    required = policy.get("required") if isinstance(policy, dict) else None
    if not (isinstance(required, list) and all(isinstance(name, str) for name in required)):
        raise Refused("%s at %s names no list of required steps" % (POLICY, base[:12]))
    return [name for name in release_check.REQUIRED if name not in required]


class Admissions:
    """The reds a policy file admits, read and matched exactly as GitHub's classifier reads and matches them
    (tools/ci_known_reds.py): the policy is base's (the event base: the classifier reads the policy at the pull
    request's base, never the candidate's copy, so a candidate's own admission never counts for it), one its
    load_policy() takes, read against root's git; a failed case is admitted only when commit's test definitions are a
    plan the policy reviewed, with base as the approved base (select_plan(), as the classifier asks before it matches
    anything; at a commit where none is, the policy admits nothing and unreviewed says why, but it refuses nothing, so
    each red falls to its live summary), its identity (key(): name, phase, engine, expectedFailure) is an admission of
    that plan, and the fingerprint of its failure (its assertion, values and test-source chain, read at commit) is that
    admission's. The one thing not compared is the runner profile: a local release check does not run on GitHub's
    runners. Item 553: load_policy() checks the policy against its own source commit's steps (steps_at()), whatever
    commit keeps it now; a policy that reviewed other steps than the candidate's (beyond: the steps the candidate adds)
    admits nothing, as at an unreviewed plan."""

    def __init__(self, policy, root, commit, base):
        from tools import ci_known_reds
        self.ci, self.root, self.commit = ci_known_reds, root, commit
        # Item 553: the policy is checked against the steps of the commit it was reviewed at, its source_commit, read
        # there: base may have added a step since and left the policy as it was. This checkout's steps are the
        # candidate's, compared below.
        try:
            ci_known_reds.load_policy(policy, root, lambda source_commit: steps_at(root, source_commit))
        except (ci_known_reds.Refused, KeyError, TypeError, AttributeError, ValueError) as error:
            # A malformed field the classifier would crash on is no more a policy it takes than one it refuses.
            raise Refused("%s at %s is not a policy GitHub's classifier takes (%s)" % (POLICY, base[:12], error))
        self.reds, self.unreviewed = {}, None
        # The steps the candidate runs beyond those the policy reviewed, by name, for the next policy to cover; and those
        # it no longer runs. Either way the policy did not review the candidate's check, so it admits nothing.
        self.beyond = steps_beyond(policy, base)
        dropped = [name for name in policy["required"] if name not in release_check.REQUIRED]
        if self.beyond or dropped:
            self.unreviewed = "the steps at %s are not the ones it reviewed: %s" % (commit[:12], "; ".join(
                ([("it does not review %s" % ", ".join(self.beyond))] if self.beyond else [])
                + ([("it reviews %s, which %s does not run" % (", ".join(dropped), commit[:12]))] if dropped else [])))
            return
        try:
            plan, _ = ci_known_reds.select_plan(policy, root, commit, base)
        except ci_known_reds.Refused as error:
            self.unreviewed = "the tests at %s are not ones it reviewed: %s" % (commit[:12], error)
            return
        self.reds = {(red["step"], ci_known_reds.key(red["case"])): red for red in plan["reds"]}

    def match(self, step, row, checkout):
        """(the admission's review, None) when the policy admits this failure of step; (None, why not) otherwise."""
        red = self.reds.get((step, self.ci.key(row)))
        if red is None:
            return None, None
        try:
            same = self.ci.fingerprint(row.get("error"), checkout, self.root, self.commit) == red["fingerprint"]
        except self.ci.Refused:
            same = False
        return (red["review"], None) if same else (None, "different assertion, values or source chain")


def judge(path, summary_path, unpassed, live_head, policy=lambda base: None):
    """What the known reds accept of a summary that judge_summary found describes the commit, or Refused naming the
    first condition that fails.

    unpassed: judge_summary's reasons the run did not pass; [] takes every listed red as not needed. live_head(): the
    live checkout's HEAD, as the deploy reads it. policy(base): the Admissions of POLICY at base, the live HEAD the
    known reds were read beside (the event base, never the candidate), None when that commit keeps none, or Refused when
    it cannot be read or is not a policy GitHub's classifier takes. Returns {file, live_commit, accepted: [{step, case, live_summary, live_commit, why, taken_by,
    review}], not_needed: [{step, case}]}; accepted is empty only for a summary that passed."""
    known = load(path)
    listed = {(red["step"], red["case"]): red for red in known["reds"]}
    taken = {"file": str(path), "live_commit": known["live_commit"], "accepted": [], "not_needed": [], "acceptances": {}}
    if not unpassed:
        taken["not_needed"] = [{"step": step, "case": case} for step, case in listed]
        return taken
    head = live_head()
    if known["live_commit"] != head:
        raise Refused("the known reds were read beside %s, but %s is live" % (known["live_commit"], head))
    admits = policy(head)
    summary = json.loads(Path(summary_path).read_text())
    failures = candidate_failures(summary, Path(summary_path).parent)
    for step in sorted(failures):
        for case in failures[step]:
            if (step, case) not in listed:
                raise Refused("%s failed %r, which the known reds do not list" % (step, case))
    checkout = summary.get("checkout")
    unreviewed = "" if admits is None or admits.unreviewed is None else " (%s)" % admits.unreviewed
    for step in sorted(failures):
        for case, row in failures[step].items():
            red = listed[(step, case)]
            review, differs = admits.match(step, row, checkout) if admits is not None else (None, None)
            if review is not None:
                taken_by = "policy"
            elif differs is not None and red["live_summary"] is None:
                raise Refused("%s %r: %s at the live commit admits it, but not this failure (%s)"
                              % (step, case, POLICY, differs))
            elif red["live_summary"] is None:
                raise Refused("%s %r is not admitted by %s at the live commit, and no live summary names it%s"
                              % (step, case, POLICY, unreviewed))
            else:
                failed, acceptance = live_cases(red, known["live_commit"])
                taken_by, review = ("live", None) if acceptance is None else ("owner_acceptance", acceptance["message"])
                if acceptance is not None:
                    taken["acceptances"][red["live_summary"]] = {"by": acceptance["by"], "message": acceptance["message"]}
                if case not in failed:
                    raise Refused("%s %r is not admitted by %s at the live commit, nor among the cases that failed in %s "
                                  "on the live commit%s" % (step, case, POLICY, red["live_summary"], unreviewed))
            taken["accepted"].append({"step": step, "case": case, "live_summary": red["live_summary"],
                                      "live_commit": known["live_commit"], "why": red["why"], "taken_by": taken_by,
                                      "review": review})
    taken["not_needed"] = [{"step": step, "case": case} for step, case in listed if case not in failures.get(step, ())]
    return taken

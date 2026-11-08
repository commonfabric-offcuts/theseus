#!/usr/bin/python3 -I
from __future__ import annotations

"""Run every check a release needs, for one commit, and write a summary the deploy reads.

Usage: tools/release_check.py --out ABSOLUTE_DIR [--chrome PATH] [--python PATH] [--node PATH]

The checkout this file lives in is the one checked. It must be clean, so the
summary speaks for exactly its HEAD commit. Python units, node units and every
native browser mode run one at a time; any failure makes the run fail (exit 1)
and a refusal before running anything exits 2. docs/tools.md has the details.
"""

import collections
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO = Path(__file__).resolve().parents[1]
PYTHON = "/usr/bin/python3"
CHROME_SUFFIX = "/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
# Where the test harnesses' Chrome for Testing is kept; used when neither
# --chrome nor AIM_CHROME_FOR_TESTING names one and exactly one version is there.
CHROME_CACHE = Path("Library/Caches/aim-chrome-for-testing/chrome")
CHROME_IN_VERSION = "chrome-mac-arm64" + CHROME_SUFFIX

NativeStep = collections.namedtuple("NativeStep", "name harness flags results")
PERSISTENCE = "tests/reader_persistence_native.mjs"
READER = "tests/reader_native.mjs"
# Every mode of every native entry point. tests/test_tools_release_check.py
# reads the harnesses and fails when a mode or an entry point is missing here.
NATIVE_STEPS = tuple(
    [NativeStep(mode, PERSISTENCE, ("--" + mode,), "native.json")
     for mode in ("journal", "connected", "correction", "cleanup", "images", "freshness",
                  "inline", "navigation", "live", "colors", "asks", "whispers", "work", "light", "list", "notebook", "duties", "sources", "wakes", "header", "rail", "conversation", "forms", "pipeline", "health")]
    + [NativeStep("openings", "tests/reader_openings_native.mjs", (), "native.json"),
       NativeStep("reader", READER, (), "results.json")]
    + [NativeStep("reader-" + mode, READER, ("--" + mode,), "results.json")
       for mode in ("keyboard", "review-gaps", "anchor-control", "mutations", "finished")])
UNIT_STEPS = ("python-units", "node-units")
REQUIRED = UNIT_STEPS + tuple("native-" + step.name for step in NATIVE_STEPS)
TOOL = "theseus-release-check"


class Refused(Exception):
    """The check cannot speak for the commit, so it does not run."""


def now():
    return datetime.datetime.now().astimezone().isoformat()


def git(root, *args):
    return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True, text=True)


def tree(root):
    """(HEAD commit, porcelain listing of tracked and untracked changes)."""
    head = git(root, "rev-parse", "--verify", "HEAD^{commit}")
    status = git(root, "status", "--porcelain", "--untracked-files=all")
    if head.returncode or status.returncode:
        raise Refused("cannot read the checkout's git state: %s%s" % (head.stderr, status.stderr))
    return head.stdout.strip(), status.stdout


def world_writable_ancestor(path, stat_path=os.stat):
    """The first directory at or above path that anyone can write, or None.

    tests/test_codex_broker.py refuses such parents, so its units fail in a
    checkout under /private/tmp; the check refuses before spending a run."""
    for directory in [Path(path)] + list(Path(path).parents):
        if stat_path(str(directory)).st_mode & stat.S_IWOTH:
            return directory
    return None


def chrome_path(explicit=None, environ=None, home=None):
    environ = os.environ if environ is None else environ
    chosen = explicit or environ.get("AIM_CHROME_FOR_TESTING")
    if not chosen:
        cache = Path.home() / CHROME_CACHE if home is None else Path(home) / CHROME_CACHE
        found = sorted(str(version / CHROME_IN_VERSION) for version in cache.glob("*")
                       if (version / CHROME_IN_VERSION).is_file())
        if len(found) != 1:
            raise Refused("name Chrome for Testing with --chrome or AIM_CHROME_FOR_TESTING; %s holds %d: %s"
                          % (cache, len(found), found))
        chosen = found[0]
    if not chosen.endswith(CHROME_SUFFIX) or not os.path.isabs(chosen):
        raise Refused("not an absolute Chrome for Testing executable: %s" % chosen)
    if not os.access(chosen, os.X_OK):
        raise Refused("Chrome for Testing is not executable: %s" % chosen)
    return chosen


def out_problem(root, out):
    """Why the run cannot write its evidence to out without changing the checkout, or None."""
    if not out.is_absolute():
        return "--out must be absolute: %s" % out
    if out.exists() and not out.is_dir():
        return "--out is not a directory: %s" % out
    if out.exists() and any(out.iterdir()):
        return "--out already holds files; each run gets a fresh directory: %s" % out
    try:
        inside = out.resolve().relative_to(Path(root).resolve())
    except ValueError:
        return None
    if git(root, "check-ignore", "-q", str(inside)).returncode != 0:
        return "--out is inside the checkout and not ignored, so the run would change it: %s" % out
    return None


def preflight(root, out, chrome, python, node):
    """The commit this run speaks for, or Refused before anything runs."""
    commit, changes = tree(root)
    if changes:
        raise Refused("the checkout has changes, so a result would not speak for %s:\n%s" % (commit, changes))
    writable = world_writable_ancestor(root)
    if writable is not None:
        raise Refused("%s is writable by anyone; test_codex_broker refuses such parents. "
                      "Check out the commit somewhere else." % writable)
    problem = out_problem(root, out)
    if problem:
        raise Refused(problem)
    for tool in (python, node):
        if not tool or not os.access(tool, os.X_OK):
            raise Refused("not an executable: %r" % tool)
    missing = sorted({step.harness for step in NATIVE_STEPS if not (root / step.harness).is_file()})
    if missing:
        raise Refused("native harnesses missing: %s" % missing)
    if not node_units(root):
        raise Refused("no tests/*.test.mjs in %s" % root)
    return commit


def node_units(root):
    return sorted(str(path.relative_to(root)) for path in (root / "tests").glob("*.test.mjs"))


def python_counts(text):
    ran = re.findall(r"^Ran (\d+) tests? in ", text, re.M)
    status = re.findall(r"^(OK|FAILED)(?: \((.*)\))?$", text, re.M)
    counts = {"tests": int(ran[-1]) if ran else 0, "status": status[-1][0] if status else None}
    for part in (status[-1][1].split(", ") if status and status[-1][1] else []):
        key, _, value = part.partition("=")
        counts[key] = int(value)
    passed = counts["tests"] > 0 and counts["status"] == "OK"
    return counts, passed


def node_counts(text):
    counts = {key: int(value) for key, value in
              re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", text, re.M)}
    passed = counts.get("tests", 0) > 0 and counts.get("fail") == 0 and counts.get("cancelled") == 0
    return counts, passed


def native_counts(step, evidence):
    """Counts from the harness's own results file; a missing or unreadable file is a failure."""
    path = evidence / step.results
    try:
        report = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        return {"error": "no readable %s: %s" % (step.results, error)}, False
    results = report.get("results") or []
    if step.results == "results.json":
        good = [r for r in results if (r.get("mutationCaught") if r.get("expectedFailure") else r.get("passed"))]
        closed = report.get("closed") is True
    else:
        good = [r for r in results if r.get("passed") is True]
        closed = report.get("browserClosed") is True
    failed = [r.get("name") for r in results if r not in good]
    counts = {"tests": len(results), "pass": len(good), "fail": len(failed), "failed": failed,
              "browser_closed": closed}
    return counts, bool(results) and not failed and closed


def run_step(name, argv, root, out, judge):
    log = out / (name + ".log")
    env = dict(os.environ, PYTHONPYCACHEPREFIX=str(out / "pyc" / name))
    started = now()
    with open(log, "wb") as handle:
        code = subprocess.run(argv, cwd=str(root), stdin=subprocess.DEVNULL, stdout=handle,
                              stderr=subprocess.STDOUT, env=env).returncode
    counts, judged = judge(log.read_text(errors="replace"))
    result = {"name": name, "argv": argv, "exit": code, "passed": code == 0 and judged,
              "counts": counts, "log": str(log), "started_at": started, "finished_at": now()}
    print(json.dumps({key: result[key] for key in ("name", "exit", "passed", "counts")}), flush=True)
    return result


def write_summary(out, summary):
    out.mkdir(parents=True, exist_ok=True)
    partial = out / "summary.json.partial"
    partial.write_text(json.dumps(summary, indent=1) + "\n")
    os.replace(str(partial), str(out / "summary.json"))
    return out / "summary.json"


def check(root, out, chrome, python, node):
    """Run every step serially and write summary.json; returns the summary."""
    started = now()
    commit = preflight(root, out, chrome, python, node)
    out.mkdir(parents=True, exist_ok=True)
    steps = [
        run_step("python-units", [python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"],
                 root, out, python_counts),
        run_step("node-units", [node, "--test", "--test-reporter=tap"] + node_units(root), root, out, node_counts),
    ]
    for step in NATIVE_STEPS:
        evidence = out / "native" / step.name
        evidence.mkdir(parents=True)
        steps.append(run_step("native-" + step.name, [node, step.harness, chrome, str(evidence)] + list(step.flags),
                              root, out, lambda text, step=step, evidence=evidence: native_counts(step, evidence)))
    after, changes = tree(root)
    unchanged = after == commit and not changes
    summary = {"tool": TOOL, "commit": commit, "checkout": str(root), "chrome": chrome,
               "started_at": started, "finished_at": now(), "required": list(REQUIRED), "steps": steps,
               "tree_unchanged": unchanged, "tree_after": {"head": after, "changes": changes},
               "passed": unchanged and [s["name"] for s in steps] == list(REQUIRED) and all(s["passed"] for s in steps)}
    write_summary(out, summary)
    return summary


def verify_summary(path, commit):
    """Reasons a summary does not show a passed release check for exactly this commit; [] when it does."""
    try:
        summary = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        return ["no readable release-check summary at %s: %s" % (path, error)]
    if not isinstance(summary, dict) or summary.get("tool") != TOOL:
        return ["%s is not a release-check summary" % path]
    reasons = []
    if summary.get("commit") != commit:
        reasons.append("the release check ran on %s, not %s" % (summary.get("commit"), commit))
    if summary.get("tree_unchanged") is not True:
        reasons.append("the checkout changed while the release check ran")
    steps = {step.get("name"): step for step in summary.get("steps") or [] if isinstance(step, dict)}
    for name in sorted(set(REQUIRED) | set(summary.get("required") or [])):
        if name not in steps:
            reasons.append("the release check did not run %s" % name)
        elif steps[name].get("passed") is not True:
            reasons.append("%s failed (exit %s)" % (name, steps[name].get("exit")))
    if summary.get("passed") is not True and not reasons:
        reasons.append("the release check did not pass")
    return reasons


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Run every release check for this checkout's commit.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--chrome")
    parser.add_argument("--python", default=PYTHON)
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args(argv)
    try:
        chrome = chrome_path(args.chrome)
        summary = check(REPO, args.out, chrome, args.python, args.node)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        # Recorded only where the run itself could have written, so a refusal never changes the checkout.
        if out_problem(REPO, args.out) is None:
            write_summary(args.out, {"tool": TOOL, "refused": str(refusal), "passed": False, "at": now()})
        return 2
    failed = [step["name"] for step in summary["steps"] if not step["passed"]]
    print(json.dumps({"commit": summary["commit"], "passed": summary["passed"], "failed": failed,
                      "summary": str(args.out / "summary.json")}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

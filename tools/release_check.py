#!/usr/bin/python3 -I
from __future__ import annotations

"""Run every check a release needs, for one commit, and write a summary the deploy reads.

Usage: tools/release_check.py --out ABSOLUTE_DIR [--chrome PATH] [--playwright DIR] [--python PATH] [--node PATH] [--repeats N]
         [--only STEP,... | --live COMMIT] [--cli LIVE/bin/aim-next --profile PROFILE [--base] [--report OUTCOME]]
         [--quarantine-at COMMIT|event]

The checkout this file lives in is the one checked. It must be clean, so the
summary speaks for exactly its HEAD commit. Python units, node units, the
deploy's refusals, every native browser mode and the wake replay run one at a
time; any failure makes the run fail (exit 1) and a refusal before running
anything exits 2. With --live, a change that none of the browser modes or the
wake replay could see skips them, and the summary says so. With --quarantine-at,
a browser step whose only failures are cases the policy at that earlier commit
quarantines (tools/quarantine.py) does not fail the run's exit; its raw verdict
and its failed cases stay in the summary. docs/tools.md has the details.
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
import tempfile
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO = Path(__file__).resolve().parents[1]
PYTHON = "/usr/bin/python3"
CHROME_SUFFIX = "/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
# Where the test harnesses' Chrome for Testing is kept; used when neither
# --chrome nor AIM_CHROME_FOR_TESTING names one and exactly one version is there.
CHROME_CACHE = Path("Library/Caches/aim-chrome-for-testing/chrome")
CHROME_IN_VERSION = "chrome-mac-arm64" + CHROME_SUFFIX
# Where playwright-core is cached, for the harnesses that load it (PLAYWRIGHT_HARNESSES); used
# when neither --playwright nor AIM_PLAYWRIGHT_CORE names one and exactly one
# version is there. Playwright finds its own WebKit build.
PLAYWRIGHT_CACHE = Path("Library/Caches/deno/npm/registry.npmjs.org/playwright-core")

NativeStep = collections.namedtuple("NativeStep", "name harness flags results")
PERSISTENCE = "tests/reader_persistence_native.mjs"
READER = "tests/reader_native.mjs"
WEBKIT = "tests/webkit_native.mjs"
WEBKIT_MODES = ("colors", "whispers", "notebook", "rail", "pipeline", "device", "new-line", "reading")
# The Reader's composer, in Chrome for Testing and Safari's engine (docs/reader.md).
COMPOSE = "tests/reader_compose_native.mjs"
# The harnesses that load playwright-core, and so are handed its directory.
FENCE_COPY = "tests/fence_copy_native.mjs"
PLAYWRIGHT_HARNESSES = (WEBKIT, COMPOSE, FENCE_COPY)
# Every mode of every native entry point. tests/test_tools_release_check.py
# reads the harnesses and fails when a mode or an entry point is missing here.
NATIVE_STEPS = tuple(
    [NativeStep(mode, PERSISTENCE, ("--" + mode,), "native.json")
     for mode in ("journal", "connected", "correction", "cleanup", "images", "freshness",
                  "inline", "navigation", "live", "colors", "asks", "whispers", "work", "light", "list", "notebook", "duties", "sources", "wakes", "header", "rail", "conversation", "forms", "pipeline", "targets", "health", "reading")]
    + [NativeStep("openings", "tests/reader_openings_native.mjs", (), "native.json"),
       NativeStep("reader", READER, (), "results.json")]
    + [NativeStep("reader-" + mode, READER, ("--" + mode,), "results.json")
       for mode in ("keyboard", "review-gaps", "anchor-control", "mutations", "finished")]
    # The same checks in Safari's engine, and the phone check page (docs/device-evidence.md).
    + [NativeStep("webkit-" + mode, WEBKIT, ("--" + mode,), "native.json") for mode in WEBKIT_MODES]
    + [NativeStep("compose", COMPOSE, (), "native.json"),
       NativeStep("fence-copy", FENCE_COPY, (), "native.json")])
UNIT_STEPS = ("python-units", "node-units")
DEPLOY_REFUSALS = "deploy-refusals"
WAKE_REPLAY = "wake-replay"
REQUIRED = UNIT_STEPS + (DEPLOY_REFUSALS,) + tuple("native-" + step.name for step in NATIVE_STEPS) + (WAKE_REPLAY,)
# The steps each machine-read check source reads (aim_next/check_reading.readings), so a trial runs only the steps of the
# checks that stopped a candidate (D34); a run's duration is the whole check.
SOURCE_STEPS = {"release-check:units": UNIT_STEPS, "release-check:native": tuple("native-" + step.name for step in NATIVE_STEPS),
                "release-check:deploy-refusals": (DEPLOY_REFUSALS,), "release-check:wake-replay": (WAKE_REPLAY,), "release-check:duration": REQUIRED}
# Steps that feed a replayed measure: --base runs them on the live release's code as well (D32).
REPLAYED = (WAKE_REPLAY,)
REPLAY_TOOL, REPLAY_STANDIN, REPLAY_FILE = "tools/wake_replay.py", "tools/wake_standin.py", "tests/fixtures/replay/wake-2026-11-05.json"
TOOL = "theseus-release-check"
# Item 166: the steps a change may skip, all together, when no path changed since the live commit is one they could see
# (seen()): they run a server from the checkout's code and drive it with harnesses, so they read nothing in docs/ and only
# some of tools/ and tests/. A Python or node unit module in tests/ is seen only where those files name it.
SKIPPABLE = tuple("native-" + step.name for step in NATIVE_STEPS) + (WAKE_REPLAY,)
UNIT_MODULE = re.compile(r"tests/(test_[^/]+\.py|[^/]+\.test\.mjs)")


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


def playwright_path(explicit=None, environ=None, home=None):
    """The playwright-core package directory PLAYWRIGHT_HARNESSES load, or Refused."""
    environ = os.environ if environ is None else environ
    chosen = explicit or environ.get("AIM_PLAYWRIGHT_CORE")
    if not chosen:
        cache = Path.home() / PLAYWRIGHT_CACHE if home is None else Path(home) / PLAYWRIGHT_CACHE
        found = sorted(str(version) for version in cache.glob("*") if (version / "package.json").is_file())
        if len(found) != 1:
            raise Refused("name playwright-core with --playwright or AIM_PLAYWRIGHT_CORE; %s holds %d: %s"
                          % (cache, len(found), found))
        chosen = found[0]
    if not os.path.isabs(chosen):
        raise Refused("not an absolute playwright-core directory: %s" % chosen)
    try:
        name = json.loads((Path(chosen) / "package.json").read_text()).get("name")
    except (OSError, ValueError, AttributeError):
        name = None
    if name != "playwright-core":
        raise Refused("not a playwright-core package: %s" % chosen)
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
    missing = [path for path in harnesses() if not (root / path).is_file()]
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


def case_lines(log, results):
    """Reasons a step's log does not hold the persistence harness's two lines for each case in results, in their order
    and nothing besides: {"case", "started"} when the case started, then its result as the results file has it, with
    the same "started" and a "finished" no earlier (tests/native-calls.mjs stamps). Empty when it does."""
    lines = []
    for text in log.splitlines():
        try:
            line = json.loads(text) if text.startswith("{") else None
        except ValueError:
            continue
        if isinstance(line, dict) and (set(line) == {"case", "started"} or {"name", "passed"} <= set(line)):
            lines.append(line)
    for number, result in enumerate(results):
        name = result.get("name")
        start, end = (lines[2 * number:2 * number + 2] + [None, None])[:2]
        if start is None or set(start) != {"case", "started"} or start["case"] != name:
            return ["case %r: no start line in the step's log where it began (found %s)" % (name, json.dumps(start))]
        if (end is None or "case" in end or {key: value for key, value in end.items() if key not in ("started", "finished")} != result
                or end.get("started") != start["started"] or not isinstance(end.get("finished"), str)
                or end["finished"] < start["started"]):
            return ["case %r: its result line in the step's log is not its result with when it started and finished "
                    "(found %s)" % (name, json.dumps(end)[:300])]
    if len(lines) > 2 * len(results):
        return ["the step's log has a case line the results file does not: %s" % json.dumps(lines[2 * len(results)])[:300]]
    return []


def native_counts(step, evidence, log=None):
    """Counts from the harness's own results file; a missing or unreadable file is a failure. With the step's log, a
    persistence step also fails when the log does not hold each case's two lines (case_lines)."""
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
    lines = case_lines(log, results) if log is not None and step.harness == PERSISTENCE else []
    if lines:
        counts["case_lines"] = lines
    return counts, bool(results) and not failed and closed and not lines


def run_step(name, argv, root, out, judge, tool, log_name=None, playwright=None):
    log = out / ((log_name or name) + ".log")
    env = dict(os.environ, PYTHONPYCACHEPREFIX=str(out / "pyc" / (log_name or name)))
    if playwright is not None:
        env["AIM_PLAYWRIGHT_CORE"] = playwright
    started = now()
    with open(log, "wb") as handle:
        code = subprocess.run(argv, cwd=str(root), stdin=subprocess.DEVNULL, stdout=handle,
                              stderr=subprocess.STDOUT, env=env).returncode
    counts, judged = judge(log.read_text(errors="replace"))
    result = {"name": name, "tool": tool, "argv": argv, "exit": code, "passed": code == 0 and judged,
              "counts": counts, "log": str(log), "started_at": started, "finished_at": now()}
    print(json.dumps({key: result[key] for key in ("name", "exit", "passed", "counts")}), flush=True)
    return result


def replay_counts(evidence):
    """One replay's result: {agent: {median, wakes, lost, delays}}; an unreadable result is a failure."""
    try:
        agents = json.loads((evidence / "replay.json").read_text())["agents"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {"error": "no readable replay.json: %s" % error}, False
    return agents, isinstance(agents, dict) and bool(agents)


def median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0


def replay_step(runs, started):
    """The wake-replay step from its runs: per agent the median of each run (D29's runs), the median over every wake,
    the wakes counted and the offsets lost in any run (3.5's series)."""
    series = {}
    for run in runs:
        for agent, values in ({} if "error" in run["counts"] else run["counts"]).items():
            entry = series.setdefault(agent, {"runs": [], "delays": [], "wakes": 0, "lost": []})
            entry["runs"].append(values.get("median"))
            entry["delays"] += values.get("delays") or []
            entry["wakes"] += values.get("wakes") or 0
            entry["lost"] = sorted(set(entry["lost"]) | set(values.get("lost") or []))
    for entry in series.values():
        entry["median"] = median(entry.pop("delays"))
    return {"name": WAKE_REPLAY, "tool": REPLAY_TOOL, "exit": max([run["exit"] for run in runs] or [1]),
            "passed": bool(runs) and all(run["passed"] for run in runs), "counts": {"tests": len(runs), "pass": sum(run["passed"] for run in runs)},
            "series": series, "runs": [{key: run[key] for key in ("exit", "passed", "log", "started_at", "finished_at")} for run in runs],
            "started_at": started, "finished_at": now()}


def changed_paths(root, live, commit, git=git):
    """Every path that differs between the live commit and commit, deleted and renamed ones included; Refused when git
    cannot say, never taken as none."""
    found = git(root, "diff", "--name-only", "--no-renames", "-z", live, commit, "--")
    if found.returncode != 0:
        raise Refused("what changed since the live commit %s cannot be read: %s" % (live, (found.stderr or "").strip()))
    return [path for path in found.stdout.split("\0") if path]


def seen(root, commit, paths, git=git):
    """Of paths changed since the live commit, those the skippable steps could see at commit, in order: anything outside
    docs/, tools/ and tests/ (web/, aim_next/, bin/ and every other); a file they run (a harness, the replay, its stand-in
    and traffic, this file) and a tools module those import; and in tests/ any file but a unit module that no file they
    could run names. [] means a change may skip them. Refused when git cannot say."""
    runners = set(harnesses()) | {"tools/release_check.py"}
    imports = git(root, "grep", "-h", "-E", r"^[[:space:]]*(from|import)[[:space:]]+tools", commit, "--",
                  *sorted(path for path in runners if path.endswith(".py")))
    if imports.returncode not in (0, 1):
        raise Refused("the tools modules the checks import cannot be read at %s: %s" % (commit, (imports.stderr or "").strip()))
    imported = set()
    for line in imports.stdout.splitlines():
        line = line.split("#")[0].strip()
        dotted = re.match(r"(?:from|import)\s+tools\.(\w+)", line)
        if dotted:
            imported.add(dotted.group(1))
        elif re.match(r"from\s+tools\s+import\s", line):
            imported |= {name.split()[0] for name in line.split("import", 1)[1].replace("(", " ").replace(")", " ").split(",") if name.split()}
    if imported:
        imported.add("__init__")
    units = {path: UNIT_MODULE.fullmatch(path).group(1).rsplit(".", 1)[0] for path in paths if UNIT_MODULE.fullmatch(path)}
    named = set()
    if units:
        words = [part for stem in sorted(set(units.values())) for part in ("-e", stem)]
        # The harnesses outside tests/; this file is left out, since what it names besides them it runs as unit steps.
        found = git(root, "grep", "-I", "-o", "-w", "-F", *words, commit, "--", "tests", REPLAY_TOOL, REPLAY_STANDIN)
        if found.returncode not in (0, 1):
            raise Refused("the files the checks run cannot be searched at %s: %s" % (commit, (found.stderr or "").strip()))
        for line in found.stdout.splitlines():
            where, word = line.rsplit(":", 1)
            if not UNIT_MODULE.fullmatch(where.split(":", 1)[-1]):
                named.add(word)

    def could_see(path):
        if path.startswith("docs/"):
            return False
        if path in runners:
            return True
        if path.startswith("tools/"):
            module = path.split("/")[1]
            return (module[:-3] if module.endswith(".py") else module) in imported
        if path in units:
            return units[path] in named
        return True
    return [path for path in paths if could_see(path)]


def skipped_words(live):
    return ("Every path changed since the live commit %s is in docs/, tools/ or tests/, and none is code the browser modes or the "
            "wake replay run, so they were not run: %d steps skipped, not passed." % (live, len(SKIPPABLE)))


def blob(root, path):
    found = git(root, "rev-parse", "HEAD:" + path)
    return found.stdout.strip() if found.returncode == 0 else None


def version(argv):
    """The last word of a tool's version line, or None when it cannot say."""
    try:
        answer = subprocess.run(argv, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    except OSError:
        return None
    words = (answer.stdout or answer.stderr).split()
    return words[-1] if answer.returncode == 0 and words else None


def harnesses():
    """Every file the steps run besides the units: the native harnesses, the wake replay, its queue and its traffic."""
    return sorted({step.harness for step in NATIVE_STEPS} | {REPLAY_TOOL, REPLAY_STANDIN, REPLAY_FILE})


def tools_of(root, chrome, python, node):
    """3.5's tools for this commit: the blobs of the release check and every harness it runs, and the three versions."""
    return {"release_check": blob(root, "tools/release_check.py"), "harnesses": {path: blob(root, path) for path in harnesses()},
            "chrome": version([chrome, "--version"]), "python": version([python, "-c", "import platform; print(platform.python_version())"]),
            "node": version([node, "--version"])}


class Reporter:
    """--report (D13, D36): the outcome's release (the one outcome_live names) enters checks (the next round when it is already there), and
    after every step a stage note carries the steps so far and the running one. A write that fails is printed and
    changes nothing: the report is never a gate."""

    def __init__(self, cli, profile, outcome, commit):
        self.cli, self.profile, self.outcome, self.commit = cli, profile, outcome, commit
        self.piece, self.live, self.total = None, None, None

    def call(self, *argv):
        try:
            answer = subprocess.run([PYTHON, "-I", "-B", self.cli, "--profile", self.profile, "--json"] + list(argv),
                                    capture_output=True, text=True, stdin=subprocess.DEVNULL)
        except OSError as error:
            print("report: %s could not run: %s" % (argv[0], error), file=sys.stderr)
            return None
        lines = [line for line in answer.stdout.splitlines() if line.startswith("{")]
        try:
            value = json.loads(lines[-1]) if lines else None
        except ValueError:
            value = None
        if answer.returncode != 0 or not isinstance(value, dict):
            print("report: %s was not written (exit %s): %s" % (argv[0], answer.returncode, (answer.stdout + answer.stderr).strip()[:300]),
                  file=sys.stderr)
            return None
        return value.get("result", value)

    def start(self, steps_total):
        self.steps_total = steps_total
        releases = self.call("releases", "--limit", "1")
        latest = (releases or {}).get("items") or []
        if latest:
            self.live = latest[0].get("release")
            self.total = ((latest[0].get("measurements") or {}).get("native") or {}).get("total")
        # The view the deploy reads (7.2 step 3) names the release, its stage and round.
        piece = (self.call("checks", self.outcome, "--live", self.commit) or {}).get("release_piece") or None
        if not piece:
            print("report: %s has no release being put together" % self.outcome, file=sys.stderr)
            return
        if piece.get("stage") == "checks":
            entered = self.call("enter-stage", piece["id"], "checks", "--round", str((piece.get("round") or 1) + 1), "--left", "held")
        else:
            entered = self.call("enter-stage", piece["id"], "checks", "--left", "passed")
        self.piece = piece["id"] if entered is not None else None

    def words(self, steps):
        native = [step for step in steps if step["name"].startswith("native-")]
        run = sum((step.get("counts") or {}).get("tests") or 0 for step in native)
        failed = [name for step in native for name in ((step.get("counts") or {}).get("failed") or [])]
        if failed:
            return "%d browser checks run so far; %d failed: %s." % (run, len(failed), "; ".join(failed[:3]))
        said = "%d browser checks run so far, none failed." % run
        return said + (" Release %s ran %s." % (self.live, self.total) if self.live is not None and self.total is not None else "")

    def note(self, steps, running, out):
        if self.piece is None:
            return
        progress = {"steps_total": self.steps_total, "commit": self.commit, "running": running,
                    "steps": [dict({"name": step["name"], "tool": step.get("tool"), "ms": _ms_between(step), "passed": step["passed"],
                                    "pass": (step.get("counts") or {}).get("pass"), "total": (step.get("counts") or {}).get("tests")},
                                   **({"values": step["series"]} if step.get("series") else {})) for step in steps]}
        path = out / "progress.json"
        path.write_text(json.dumps(progress))
        self.call("stage-note", self.piece, self.words(steps), "--progress", str(path))


def _ms_between(step):
    try:
        return int((datetime.datetime.fromisoformat(step["finished_at"]) - datetime.datetime.fromisoformat(step["started_at"])).total_seconds() * 1000)
    except (KeyError, TypeError, ValueError):
        return None


def write_summary(out, summary):
    out.mkdir(parents=True, exist_ok=True)
    partial = out / "summary.json.partial"
    partial.write_text(json.dumps(summary, indent=1) + "\n")
    os.replace(str(partial), str(out / "summary.json"))
    return out / "summary.json"


def live_commit(cli, profile):
    """The live release's commit, read with the live agent CLI (--base), run by the system interpreter as the live code is."""
    try:
        answer = subprocess.run([PYTHON, "-I", "-B", cli, "--profile", profile, "--json", "releases", "--limit", "1"],
                                capture_output=True, text=True, stdin=subprocess.DEVNULL)
        items = json.loads([line for line in answer.stdout.splitlines() if line.startswith("{")][-1]).get("items") or []
    except (OSError, ValueError, IndexError, AttributeError) as error:
        raise Refused("--base: the live release could not be read with %s: %s" % (cli, error))
    if answer.returncode != 0 or not items or not re.fullmatch(r"[0-9a-f]{40}", str(items[0].get("commit"))):
        raise Refused("--base: the live release could not be read with %s (exit %s)" % (cli, answer.returncode))
    return items[0]["commit"]


def base_code(root, commit, into):
    """The live release's code, from this repository, at `into` (no worktree: nothing is written to the repository)."""
    archive = subprocess.Popen(["git", "-C", str(root), "archive", "--format=tar", commit], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    untar = subprocess.run(["tar", "-x", "-C", str(into)], stdin=archive.stdout, capture_output=True)
    archive.stdout.close()
    error = archive.stderr.read().decode("utf-8", "replace")
    archive.stderr.close()
    if archive.wait() != 0 or untar.returncode != 0:
        raise Refused("--base: the live commit %s could not be read from this repository: %s%s" % (commit, error, untar.stderr.decode("utf-8", "replace")))


def quarantined(steps):
    """The (step, case) of every failed case a step's quarantine record holds, in the steps' order."""
    return [{"step": step["name"], "case": case} for step in steps for case in (step.get("quarantine") or {}).get("held") or []]


def check(root, out, chrome, python, node, playwright=None, repeats=1, only=None, base=None, report=None, live=None,
          quarantine_at=None):
    """Run every step serially (or only those named) and write summary.json; returns the summary.

    live: the live commit; when nothing changed since it is a path the skippable steps could see, they are skipped and
    the summary's `skipped` says so (item 166). base: (cli, profile) to read the live release with and rerun the
    replayed steps on its code; report:
    (cli, profile, outcome) to report the run on the outcome's open release piece; playwright is the playwright-core
    directory PLAYWRIGHT_HARNESSES load, without which they find none and fail. quarantine_at: the earlier commit whose
    policy's quarantine the browser steps are judged with, or "event" for the GitHub run's event base (item 549); a
    quarantine that cannot be read quarantines nothing, and the summary's `quarantine` says why."""
    started = now()
    commit = preflight(root, out, chrome, python, node)
    names = list(REQUIRED) if only is None else list(only)
    unknown = sorted(set(names) - set(REQUIRED))
    if unknown or not names:
        raise Refused("--only names steps the release check does not have: %s" % (unknown or "none"))
    if repeats < 1:
        raise Refused("--repeats is at least 1")
    skipped, ran_all = None, None
    if live is not None:
        if only is not None:
            raise Refused("--only names the steps to run and --live decides which to skip: give one")
        if not re.fullmatch(r"[0-9a-f]{40}", live):
            raise Refused("--live is the live release's full 40-character commit, not %r" % live)
        changed = changed_paths(root, live, commit)
        could = seen(root, commit, changed)
        if could:
            ran_all = {"live": live, "seen": could[:20], "why": "%d paths changed since %s are ones the browser modes or the wake replay "
                       "could see, so every step ran" % (len(could), live[:12])}
        else:
            skipped = {"steps": list(SKIPPABLE), "live": live, "changed": changed, "why": skipped_words(live)}
            names = [name for name in names if name not in SKIPPABLE]
    base_commit = live_commit(base[0], base[1]) if base else None
    held_by, entries = None, None
    if quarantine_at is not None:
        from tools import quarantine
        held_by = {"at": None if quarantine_at == "event" else quarantine_at}
        try:
            held_by["at"] = quarantine.event_base(os.environ) if quarantine_at == "event" else quarantine_at
            entries = quarantine.at_commit(root, held_by["at"])
        except quarantine.Refused as refusal:
            held_by["refused"] = str(refusal)
        else:
            held_by["entries"] = len(entries)
    out.mkdir(parents=True, exist_ok=True)
    tools = tools_of(root, chrome, python, node)
    base_dir = Path(tempfile.mkdtemp(prefix="theseus-release-base-")).resolve() if base else None
    reporter = Reporter(report[0], report[1], report[2], commit) if report else None
    try:
        if base_dir is not None:
            base_code(root, base_commit, base_dir)
        native = {"native-" + step.name: step for step in NATIVE_STEPS}

        def replay(code, evidence, number):
            evidence.mkdir(parents=True)
            return run_step(WAKE_REPLAY, [python, "-I", "-B", str(root / REPLAY_TOOL), "run", "--file", str(root / REPLAY_FILE), "--out", str(evidence),
                                          "--code", str(code)], root, out, lambda text: replay_counts(evidence), REPLAY_TOOL,
                            log_name="%s-%s" % (WAKE_REPLAY, number))

        def one(name):
            if name == "python-units":
                return run_step(name, [python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"], root, out, python_counts, "unittest")
            if name == "node-units":
                return run_step(name, [node, "--test", "--test-reporter=tap"] + node_units(root), root, out, node_counts, "node --test")
            if name == DEPLOY_REFUSALS:
                # The deploy's refusals (its DeployRefuses classes) and every test of the train it may take instead.
                return run_step(name, [python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_tools_*.py",
                                       "-k", "test_tools_deploy.DeployRefuses", "-k", "test_tools_train.", "-v"],
                                root, out, python_counts, "unittest")
            if name == WAKE_REPLAY:
                began, runs, rerun = now(), [], []
                for number in range(1, repeats + 1):
                    # Base, candidate, base, candidate (D29): both sides share the machine and the hour.
                    if base_dir is not None:
                        rerun.append(replay(base_dir, out / "replay" / ("base-%d" % number), "base-%d" % number))
                    runs.append(replay(root, out / "replay" / ("candidate-%d" % number), "candidate-%d" % number))
                if base_dir is not None:
                    base_steps.append(replay_step(rerun, began))
                return replay_step(runs, began)
            step = native[name]
            evidence = out / "native" / step.name
            evidence.mkdir(parents=True)
            result = run_step(name, [node, step.harness, chrome, str(evidence)] + list(step.flags),
                              root, out, lambda text: native_counts(step, evidence, text), step.harness,
                              playwright=playwright if step.harness in PLAYWRIGHT_HARNESSES else None)
            # A harness's stack names the checkout as node resolved it.
            record = (quarantine.judge_step(result, out, entries, root, commit, str(Path(root).resolve()))
                      if entries is not None else None)
            if record is not None:
                result["quarantine"] = record
                if record["held"] or record["unheld"] or record.get("refused"):
                    print(json.dumps({"name": name, "quarantined": record["held"], "green": record["green"],
                                      "not_quarantined": record["unheld"], **({"refused": record["refused"]} if "refused" in record else {})}),
                          flush=True)
            return result
        base_steps, steps = [], []
        if reporter is not None:
            reporter.start(len(names))
        for name in names:
            if reporter is not None:
                reporter.note(steps, {"name": name, "since_ms": int(time.time() * 1000)}, out)
            steps.append(one(name))
        if reporter is not None:
            reporter.note(steps, None, out)
    finally:
        if base_dir is not None:
            shutil.rmtree(str(base_dir))
    after, changes = tree(root)
    unchanged = after == commit and not changes
    summary = {"tool": TOOL, "commit": commit, "checkout": str(root), "chrome": chrome, "playwright": playwright, "tools": tools,
               "started_at": started, "finished_at": now(), "required": list(REQUIRED), "steps": steps,
               "tree_unchanged": unchanged, "tree_after": {"head": after, "changes": changes},
               "passed": unchanged and [s["name"] for s in steps] == names and all(s["passed"] for s in steps)}
    if only is not None:
        summary["only"] = names
    if skipped is not None:
        summary["skipped"] = skipped
    if ran_all is not None:
        summary["ran_all"] = ran_all
    if base_dir is not None:
        # The live release's code measured with this commit's release check, harnesses and replay file (D32).
        summary["base"] = {"commit": base_commit, "tools": tools, "steps": base_steps}
    if held_by is not None:
        # The raw verdict above stays as the steps ran; green is the run's verdict with the quarantine at the event base:
        # it was read, the checkout did not change, and each step passed or is green. Every name has its step by now:
        # the loop above appends one result named for each, or raises.
        held_by["held"] = quarantined(steps)
        held_by["green"] = (entries is not None and unchanged and all(s["passed"] or (s.get("quarantine") or {}).get("green") is True
                                                                      for s in steps))
        summary["quarantine"] = held_by
    write_summary(out, summary)
    return summary


def judge_summary(path, commit, basis=None):
    """(foreign, unpassed): reasons a summary does not describe a run at exactly this commit (unreadable, not a
    summary, another commit, a tree that changed while it ran, steps it skipped that basis does not confirm it could
    skip), and reasons that run did not pass (a required step failed or is missing). A summary that describes the
    commit can be measured even when it did not pass.

    basis: only for a summary that skipped steps, (the live commit, seen() of the paths changed since it at commit), read
    by the caller itself, or Refused; without it a skip is never taken."""
    try:
        summary = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        return ["no readable release-check summary at %s: %s" % (path, error)], []
    if not isinstance(summary, dict) or summary.get("tool") != TOOL:
        return ["%s is not a release-check summary" % path], []
    foreign, reasons = [], []
    if summary.get("only"):
        foreign.append("the release check ran only %s, so it does not describe %s" % (", ".join(summary["only"]), commit))
    if summary.get("commit") != commit:
        foreign.append("the release check ran on %s, not %s" % (summary.get("commit"), commit))
    if summary.get("tree_unchanged") is not True:
        foreign.append("the checkout changed while the release check ran")
    skipped, covered = summary.get("skipped"), set()
    if skipped is not None:
        named = skipped.get("steps") if isinstance(skipped, dict) else None
        if not isinstance(named, list) or set(named) != set(SKIPPABLE):
            foreign.append("the release check skipped steps it never skips together: %s" % (named,))
        else:
            covered = set(named)
            said = "the release check skipped the browser modes and the wake replay beside the live commit %s" % skipped.get("live")
            try:
                live, could = basis() if basis is not None else (None, None)
            except Refused as refusal:
                foreign.append("%s, and that cannot be taken: %s" % (said, refusal))
            else:
                if basis is None:
                    foreign.append("%s; only the deploy, reading what changed since the live commit itself, takes that" % said)
                elif live != skipped.get("live"):
                    foreign.append("%s, but %s is live; run the release check again" % (said, live))
                elif could:
                    foreign.append("%s, but %s changed since then, which they could see" % (said, ", ".join(could[:5])))
    steps = {step.get("name"): step for step in summary.get("steps") or [] if isinstance(step, dict)}
    for name in sorted(set(REQUIRED) | set(summary.get("required") or [])):
        if name in covered and name not in steps:
            continue
        if name not in steps:
            reasons.append("the release check did not run %s" % name)
        elif steps[name].get("passed") is not True:
            reasons.append("%s failed (exit %s)" % (name, steps[name].get("exit")))
    if summary.get("passed") is not True and not reasons and not foreign:
        reasons.append("the release check did not pass")
    return foreign, reasons


def skipped_of(path):
    """What a summary says it skipped and why, or None."""
    try:
        skipped = json.loads(Path(path).read_text()).get("skipped")
    except (OSError, ValueError, AttributeError):
        return None
    return skipped.get("why") if isinstance(skipped, dict) else None


def replay_runs(summary):
    """The fewest runs the wake replay made of any agent, on the candidate or its base rerun; None when it did not run."""
    steps = list(summary.get("steps") or []) + list(((summary.get("base") or {}) if isinstance(summary.get("base"), dict) else {}).get("steps") or [])
    counts = [len(values.get("runs") or []) for step in steps if isinstance(step, dict) and step.get("name") == WAKE_REPLAY
              for values in (step.get("series") or {}).values() if isinstance(values, dict)]
    return min(counts) if counts else None


def verify_summary(path, commit):
    """Reasons a summary does not show a passed release check for exactly this commit; [] when it does."""
    foreign, unpassed = judge_summary(path, commit)
    return foreign + unpassed


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Run every release check for this checkout's commit.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--chrome")
    parser.add_argument("--playwright")
    parser.add_argument("--python", default=PYTHON)
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--only")
    parser.add_argument("--live", metavar="COMMIT")
    parser.add_argument("--cli")
    parser.add_argument("--profile")
    parser.add_argument("--base", action="store_true")
    parser.add_argument("--report", metavar="OUTCOME")
    parser.add_argument("--quarantine-at", metavar="COMMIT|event")
    args = parser.parse_args(argv)
    try:
        if (args.base or args.report) and not (args.cli and args.profile):
            raise Refused("--base and --report read and write with the live agent CLI: give --cli and --profile")
        chrome = chrome_path(args.chrome)
        summary = check(REPO, args.out, chrome, args.python, args.node, playwright_path(args.playwright), repeats=args.repeats,
                        only=[name for name in args.only.split(",") if name] if args.only is not None else None,
                        base=(args.cli, args.profile) if args.base else None,
                        report=(args.cli, args.profile, args.report) if args.report else None, live=args.live,
                        quarantine_at=args.quarantine_at)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        # Recorded only where the run itself could have written, so a refusal never changes the checkout.
        if out_problem(REPO, args.out) is None:
            write_summary(args.out, {"tool": TOOL, "refused": str(refusal), "passed": False, "at": now()})
        return 2
    failed = [step["name"] for step in summary["steps"] if not step["passed"]]
    held_by = summary.get("quarantine") or {}
    print(json.dumps(dict({"commit": summary["commit"], "passed": summary["passed"], "failed": failed,
                           "skipped": (summary.get("skipped") or {}).get("why"), "summary": str(args.out / "summary.json")},
                          **({"quarantined": held_by.get("held"), "green": held_by.get("green") is True,
                              **({"quarantine_refused": held_by["refused"]} if "refused" in held_by else {})} if held_by else {}))))
    return 0 if summary["passed"] or held_by.get("green") is True else 1


if __name__ == "__main__":
    sys.exit(main())

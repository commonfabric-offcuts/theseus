#!/usr/bin/python3 -I
from __future__ import annotations

"""A release check's summary as a run of an outcome's checks, and what it made worse (items 12 and 104; docs/targets.md).

Usage: tools/checks.py run --summary SUMMARY.json --live LIVE.json [--base BASE_SUMMARY.json] [--note TEXT] > RUN.json
       tools/checks.py worse --run RUN.json --live LIVE.json
       tools/checks.py trial --cli /abs/bin/aim-next --profile P --outcome W --of SHA --without 34[,35] --revert SHA1[,SHA2] --out DIR
                         [--repo REPO] [--chrome PATH]

LIVE.json is the outcome's `outcome_live` view (the deploy reads it from the
live instance): its checks, the live baseline and the owner's allowances for
the commit. `run` prints the run the deploy records with
`bin/aim-next-admin record-checks`; `worse` prints what got worse against the
live baseline and exits 1 when anything not allowed or accepted did. One rule,
outcome_rules.regressions(), decides it, as it does on the outcome page.

`trial` (D34) checks whether leaving suspects out clears a stopped candidate:
it reverts the named commits in a clone of SHA, runs that clone's release
check on only the steps the stopped checks read, beside the live release,
reports the run to the outcome as a trial of SHA, and prints what it found by
the same rule. It never posts; the coordinator says what it found in the fix
topic.
"""

import argparse
import datetime
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next import check_reading, outcome_rules
from tools import release_check

PYTHON = "/usr/bin/python3"
REPO = Path(__file__).resolve().parents[1]
TRIAL_NAME = ("-c", "user.name=Theseus trial", "-c", "user.email=trial@theseus.invalid")


class Refused(Exception):
    """A trial that cannot be run as asked; nothing was reported and nothing is left behind."""


def _ms(text):
    return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)


def tools_of(summary):
    """The tools that produced a summary's readings (3.5: the release check's and harnesses' blobs and the three versions);
    a summary written before it named them gives what it can, the tool and the Chrome it ran."""
    if isinstance(summary.get("tools"), dict):
        return summary["tools"]
    tools = {"release-check": summary.get("tool") or "theseus-release-check"}
    if summary.get("chrome"):
        tools["chrome"] = Path(summary["chrome"]).parent.parent.parent.name or summary["chrome"]
    return tools


def run_from_summary(summary, checks, outcome, note=""):
    """The run a summary describes; with the summary's `base` (7.1 --base: the live release's commit, its tools and the
    steps rerun beside the candidate), that rerun under `base`, read from its steps alone (D32)."""
    steps = check_reading.steps_of(summary)
    started, finished = _ms(summary["started_at"]), _ms(summary["finished_at"])
    run = {"outcome": outcome, "commit": summary["commit"], "started_at": summary["started_at"], "finished_at": summary["finished_at"],
           "tools": tools_of(summary), "steps": steps, "note": note,
           "readings": check_reading.readings(checks, steps, started, finished)}
    base = summary.get("base")
    if isinstance(base, dict):
        rerun = check_reading.steps_of(base)
        run["base"] = {"commit": base["commit"], "started_at": summary["started_at"], "finished_at": summary["finished_at"],
                       "tools": base.get("tools") or run["tools"], "steps": rerun, "note": "rerun of the live release",
                       "readings": check_reading.readings(checks, rerun)}
    return run


RENAME = "Rename this topic to say what is wrong in your own words, if that is clearer."


def fix_title(item, release):
    """D15: the fix topic's title for one worse result, named for what failed at the release N candidate.

    A pass check with failed cases takes the first case's name; a check that did not run says so; anything else
    got worse."""
    at = "at the release %d candidate" % release
    cases = item.get("cases") or []
    if item["kind"] == "failed" and cases:
        more = len(cases) - 1
        return "\u201c%s\u201d %s %s" % (cases[0], "and %d more fail" % more if more else "fails", at)
    return "%s %s %s" % (item.get("name") or item["check_id"], "did not run" if item.get("missing") else "got worse", at)


def fix_body(item, release, evidence, opening):
    """What the deploy says in a fix topic: what got worse, the failed cases, where the evidence is, and, in the
    topic's first message, that its title may be put in the coordinator's own words."""
    lines = ["%s got worse at the release %d candidate: %s." % (item.get("name") or item["check_id"], release, item["why"])]
    if item.get("cases"):
        lines.append("Failed: " + "; ".join(item["cases"][:20]) + ("; and %d more" % (len(item["cases"]) - 20) if len(item["cases"]) > 20 else "") + ".")
    if isinstance(item.get("now"), (int, float)):
        lines.append("Now %s%s, was %s." % (item["now"], " " + item["unit"] if item.get("unit") else "", item.get("base")))
    lines.append("Evidence: %s" % evidence)
    if opening:
        lines.append(RENAME)
    return "\n\n".join(lines)


def worse(run, live):
    """What the run made worse against the live baseline, with the owner's allowances."""
    checks = live["checks"]
    now = {reading["check_id"]: dict(reading, tools=run.get("tools") or {}) for reading in run.get("readings", [])}
    base = {check_id: dict(reading, tools=(live.get("live") or {}).get("tools") or {}) for check_id, reading in (live.get("readings") or {}).items()}
    rerun = {}
    if run.get("base"):
        rerun = {reading["check_id"]: dict(reading, tools=run["base"].get("tools") or {}) for reading in run["base"].get("readings", [])}
    names = {check["check_id"]: check["name"] for check in checks}
    found = outcome_rules.regressions(checks, base, now, live.get("allowances") or [], rerun, run.get("commit"))
    return [dict(item, name=names.get(item["check_id"], item["check_id"])) for item in found["worse"]]


def agent(cli, profile, *argv):
    """One read or write with the live agent CLI, run by the system interpreter as the live code is; its JSON answer."""
    answer = subprocess.run([PYTHON, "-I", "-B", cli, "--profile", profile, "--json"] + list(argv), capture_output=True, text=True,
                            stdin=subprocess.DEVNULL)
    lines = [line for line in answer.stdout.splitlines() if line.startswith("{")]
    if answer.returncode != 0 or not lines:
        raise Refused("%s with %s answered %s: %s" % (argv[0], cli, answer.returncode, (answer.stderr or answer.stdout).strip()[-400:]))
    return json.loads(lines[-1])


def _git(root, *args):
    return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True, text=True, stdin=subprocess.DEVNULL)


def trial(cli, profile, outcome, of, without, reverts, out, repo=REPO, chrome=None):
    """D34 steps 1 to 4: refuse unless SHA is a stopped candidate and every revert lies between the live head and SHA;
    revert them, newest first, in a clone of SHA; run its release check on the stopped checks' steps beside the live
    release; report the trial; return what is still worse on the stopped checks."""
    if not re.fullmatch(r"[0-9a-f]{40}", of):
        raise Refused("--of is a full 40-character commit")
    if not without or not reverts:
        raise Refused("a trial names the items it leaves out (--without) and the commits that carry them (--revert)")
    candidate = (agent(cli, profile, "checks", outcome).get("loop") or {}).get("candidate") or {}
    stopped = sorted({item["check_id"] for item in candidate.get("worse") or [] if not item.get("accepted")})
    if candidate.get("commit") != of or not stopped:
        raise Refused("%s is not a stopped candidate of %s (the candidate is %s, %s); a trial leaves suspects out of one"
                      % (of, outcome, candidate.get("commit"), candidate.get("state")))
    items = (agent(cli, profile, "releases", "--limit", "1").get("items") or [{}])
    live = items[0].get("commit")
    between = _git(repo, "rev-list", "%s..%s" % (live, of)).stdout.split() if live else []
    order, full = {sha: n for n, sha in enumerate(between)}, []
    for named in reverts:
        sha = _git(repo, "rev-parse", "--verify", "--quiet", named + "^{commit}").stdout.strip()
        if sha not in order:
            raise Refused("%s is not between the live release %s and %s" % (named, live, of))
        full.append(sha)
    full.sort(key=order.get)
    out = Path(out)
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise Refused("--out %s already holds files" % out)
    live_view = agent(cli, profile, "checks", outcome, "--live", of)
    checks = [check for check in live_view["checks"] if check["check_id"] in stopped]
    steps = [name for name in release_check.REQUIRED if any(name in release_check.SOURCE_STEPS.get(check["source"], ()) for check in checks)]
    if not steps:
        raise Refused("the stopped checks (%s) read no release-check step, so a trial cannot rerun them" % ", ".join(stopped))
    place = Path(tempfile.mkdtemp(prefix="theseus-trial-")).resolve()
    try:
        code = place / "code"
        made = _git(place, "clone", "--quiet", "--shared", "--no-checkout", str(Path(repo).resolve()), str(code))
        if made.returncode != 0 or _git(code, "checkout", "--quiet", "--detach", of).returncode != 0:
            raise Refused("%s could not be checked out from %s: %s" % (of, repo, made.stderr.strip()))
        for sha in full:
            reverted = subprocess.run(["git"] + list(TRIAL_NAME) + ["-C", str(code), "revert", "--no-edit", sha], capture_output=True, text=True,
                                      stdin=subprocess.DEVNULL)
            if reverted.returncode != 0:
                raise Refused("reverting %s conflicts in %s; try the suspects one at a time" % (sha, of))
        out.mkdir(parents=True, exist_ok=True)
        argv = [PYTHON, "-I", "-B", str(code / "tools/release_check.py"), "--out", str(out / "check"), "--only", ",".join(steps),
                "--base", "--cli", cli, "--profile", profile] + (["--chrome", chrome] if chrome else [])
        with open(out / "release-check.log", "wb") as log:
            ran = subprocess.run(argv, cwd=str(code), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        try:
            summary = json.loads((out / "check" / "summary.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise Refused("the trial's release check left no summary (exit %s): %s" % (ran.returncode, error))
        if summary.get("refused") or not isinstance(summary.get("base"), dict):
            raise Refused("the trial's release check refused: %s" % (summary.get("refused") or "it ran no base"))
    finally:
        shutil.rmtree(str(place))
    run = run_from_summary(summary, checks, outcome, "trial of %s without item %s" % (of, ", ".join(str(n) for n in without)))
    base = run.pop("base")
    report = {"run": {"commit_sha": run["commit"], "started_at": run["started_at"], "finished_at": run["finished_at"], "tools": run["tools"],
                      "steps": run["steps"], "note": run["note"], "trial_of": of, "without": {"items": list(without), "reverted": full},
                      "base": dict({key: base[key] for key in ("started_at", "finished_at", "tools", "steps", "note", "readings")}, commit_sha=base["commit"])},
              "readings": run["readings"]}
    (out / "trial.json").write_text(json.dumps(report, indent=1) + "\n")
    agent(cli, profile, "check-report", outcome, str(out / "trial.json"))
    found = worse(dict(run, base=base), dict(live_view, checks=checks))
    read = {reading["check_id"] for reading in run["readings"]}
    found += [{"check_id": check["check_id"], "name": check["name"], "kind": "fewer", "missing": True, "why": "the trial did not read it"}
              for check in checks if check["check_id"] not in read and check["check_id"] not in {item["check_id"] for item in found}]
    return {"of": of, "without": list(without), "reverted": full, "steps": steps, "stopped": stopped, "worse": found}


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tools/checks.py")
    verbs = parser.add_subparsers(dest="verb", required=True)
    make = verbs.add_parser("run")
    make.add_argument("--summary", required=True)
    make.add_argument("--live", required=True)
    make.add_argument("--base")
    make.add_argument("--note", default="")
    judge = verbs.add_parser("worse")
    judge.add_argument("--run", required=True)
    judge.add_argument("--live", required=True)
    trying = verbs.add_parser("trial")
    trying.add_argument("--cli", required=True)
    trying.add_argument("--profile", required=True)
    trying.add_argument("--outcome", required=True)
    trying.add_argument("--of", required=True)
    trying.add_argument("--without", required=True)
    trying.add_argument("--revert", required=True)
    trying.add_argument("--out", required=True)
    trying.add_argument("--chrome")
    trying.add_argument("--repo", default=str(REPO), help="the repository holding SHA (this checkout's)")
    options = parser.parse_args(argv)
    if options.verb == "trial":
        try:
            without = [int(word) for word in options.without.split(",") if word]
            found = trial(options.cli, options.profile, options.outcome, options.of, without,
                          [word for word in options.revert.split(",") if word], options.out, repo=options.repo, chrome=options.chrome)
        except ValueError:
            print("refused: --without is item numbers", file=sys.stderr)
            return 2
        except Refused as refusal:
            print("refused: %s" % refusal, file=sys.stderr)
            return 2
        cleared = [check for check in found["stopped"] if check not in {item["check_id"] for item in found["worse"]}]
        print("Without item %s: %s." % (", ".join(str(n) for n in found["without"]),
                                        "; ".join(["%s cleared" % check for check in cleared] + ["%s still worse (%s)" % (item["name"], item["why"]) for item in found["worse"]])))
        sys.stdout.write(json.dumps(found, indent=1) + "\n")
        return 0
    live = json.loads(Path(options.live).read_text(encoding="utf-8"))
    if options.verb == "run":
        run = run_from_summary(json.loads(Path(options.summary).read_text(encoding="utf-8")), live["checks"], live["workspace_id"], options.note)
        if options.base:
            base = run_from_summary(json.loads(Path(options.base).read_text(encoding="utf-8")), live["checks"], live["workspace_id"], "rerun of the live release")
            run["base"] = {key: base[key] for key in ("commit", "started_at", "finished_at", "tools", "steps", "note", "readings")}
        sys.stdout.write(json.dumps(run, indent=1) + "\n")
        return 0
    found = worse(json.loads(Path(options.run).read_text(encoding="utf-8")), live)
    sys.stdout.write(json.dumps({"worse": found, "titles": [fix_title(item, live["candidate_release"]) for item in found]}, indent=1) + "\n")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

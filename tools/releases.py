#!/usr/bin/python3 -I
from __future__ import annotations

"""What a deploy ships, for its release record: the pipeline items its commits name, and the release check's counts
or the merged train it was checked as.

docs/releases.md is the contract. A change names the items it delivers in a
`Pipeline: 87, 2` trailer of its commit message, read by git's own trailer
rules (the last paragraph, the key in any case); tools/deploy.py reads every
commit between the live HEAD and the commit it deploys, merges included.

A commit that takes an item back out carries `Train-Item: Revert 412` the same
way. Within the range an item's revert cancels its earlier Pipeline claim, so the
release does not say it shipped and a later release can ship it; a Pipeline
claim after the revert ships it again. Other Train-Item values are display only.

Usage: tools/releases.py attach-judgment RELEASE --config CONFIG.json --runs ID[,ID] --checks ID[,ID] --audit MESSAGE

attaches the hosted judgment of an ordinary merged train's release, of one
deployed on the run of another commit with its tree (item 588), or the full run
of a release deployed on a scoped run (item 608), once it has landed, to that
release's record in the live instance (docs/tools.md, "A merged train", "A
merged head its pull request's run judged" and "A small fix"): each run and
check, read from GitHub, completed and naming that release's commit as its head.
Nothing else in the record changes.
"""

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next.releases import judgment_pending
from tools import train as train_check

NUMBER = re.compile(r"[1-9][0-9]*")
# Release records the repository keeps for releases recorded afterwards (docs/releases.md).
KEPT = "tools/pipeline/releases"
# Fields of one commit in `git log --format`, each Pipeline (then Train-Item) trailer's value, and the end of each commit.
FIELD, VALUE, END = "\x1f", "\x1d", "\x1e"
LOG_FORMAT = ("--format=%H%x1f%s%x1f%(trailers:key=Pipeline,valueonly,separator=%x1d)"
              "%x1f%(trailers:key=Train-Item,valueonly,separator=%x1d)%x1e")
REVERT = re.compile(r"revert(?:\s+(.*)|$)", re.I | re.S)


class Malformed(ValueError):
    """A Pipeline trailer that does not name item numbers."""


def trailer_items(values):
    """The item numbers one commit's Pipeline trailer values name, in order; [] when it has none."""
    items = []
    for value in values.split(VALUE) if values else ():
        parts = [part.strip() for part in value.split(",")]
        if not all(NUMBER.fullmatch(part) for part in parts):
            raise Malformed("Pipeline: %s" % value.strip())
        items.extend(int(part) for part in parts)
    return items


def trailer_reverts(values):
    """The item numbers one commit's `Train-Item: Revert N, M` trailers name; [] when none does."""
    reverts = []
    for value in values.split(VALUE) if values else ():
        said = REVERT.fullmatch(value.strip())
        if said:
            if not (said.group(1) or "").strip():
                raise Malformed("Train-Item: %s" % value.strip())
            reverts.extend(trailer_items(said.group(1)))
    return reverts


def log_argv(checkout, head, sha):
    """Every commit the deploy ships, oldest first, merges and the commits they bring in included."""
    return ["git", "-C", str(checkout), "log", "--reverse", LOG_FORMAT, "%s..%s" % (head, sha)]


def shipped(log_text):
    """(each item once in the order its commits came, less those a later commit reverts, [{commit, subject, items,
    reverts}]) from log_argv's output.

    Raises Malformed naming the commit whose Pipeline or Train-Item: Revert trailer does not name item numbers."""
    commits, items = [], []
    for entry in log_text.split(END):
        entry = entry.strip("\n")
        if not entry:
            continue
        commit, subject, values, *rest = entry.split(FIELD, 3)
        try:
            named, reverts = trailer_items(values), trailer_reverts(rest[0] if rest else "")
        except Malformed as error:
            raise Malformed("commit %s (%s) has a trailer %r that does not name pipeline item numbers"
                            % (commit[:12], subject, str(error)))
        commits.append({"commit": commit, "subject": subject, "items": named, "reverts": reverts})
        items.extend(item for item in named if item not in items)
        items = [item for item in items if item not in reverts]
    return items, commits


def reverted(commits, flagged=()):
    """[{item, commit, by}]: each revert in the range, by its trailer, then each one the deploy names with --revert
    for a revert made before the trailer rule (commit None)."""
    return ([{"item": item, "commit": commit["commit"], "by": "trailer"} for commit in commits for item in commit["reverts"]]
            + [{"item": item, "commit": None, "by": "flag"} for item in flagged])


def measurements(summary, known_reds=(), judged=None):
    """The release check's counts for one release record (docs/releases.md), and the known reds the deploy accepted
    (item 178: failed cases the live commit fails too, still counted as failed). judged (item 588): for a summary of
    another commit with the deployed commit's tree, {judged_commit, commit, tree}, kept as `judged_tree` with the hosted
    judgment of the deployed commit itself pending until attach-judgment attaches it."""
    steps = {step.get("name"): step.get("counts") or {} for step in summary.get("steps") or [] if isinstance(step, dict)}
    native = {name[len("native-"):]: {"pass": counts.get("pass", 0), "total": counts.get("tests", 0)}
              for name, counts in steps.items() if name.startswith("native-")}
    return {"release_check": {key: summary.get(key) for key in ("commit", "started_at", "finished_at")},
            "python_units": {"tests": steps.get("python-units", {}).get("tests", 0)},
            "node_units": {"tests": steps.get("node-units", {}).get("tests", 0),
                           "pass": steps.get("node-units", {}).get("pass", 0)},
            "native": {"pass": sum(step["pass"] for step in native.values()),
                       "total": sum(step["total"] for step in native.values()), "steps": native},
            # Item 166: a release whose check skipped the browser modes and the replay says so beside their empty counts.
            **({"skipped": {key: summary["skipped"].get(key) for key in ("live", "why")}} if isinstance(summary.get("skipped"), dict) else {}),
            # Item 608: a small fix deployed on a scoped run keeps the browser steps it ran and those it did not, and says
            # its full run, which follows on the deployed head, is pending; that run is attached beside the record.
            **({"scoped": scoped(summary)} if isinstance(summary.get("scoped"), dict) else {}),
            **({"known_reds": [{key: red[key] for key in ("step", "case", "live_summary", "live_commit", "why", "taken_by")}
                                for red in known_reds]}
               if known_reds else {}),
            **({"judged_tree": dict(judged, judgment="pending")} if judged else {})}


def scoped(summary):
    """A scoped summary's record (item 608): the live commit it was scoped beside, the paths changed, the browser steps
    that ran and those that did not, from the steps it lists and the steps it was required to run, and the full run
    pending."""
    ran = [step.get("name") for step in summary.get("steps") or [] if isinstance(step, dict) and str(step.get("name")).startswith("native-")]
    native = [name for name in summary.get("required") or [] if str(name).startswith("native-")]
    return {"live": summary["scoped"].get("live"), "changed": list(summary["scoped"].get("changed") or [])[:20], "steps": ran,
            "not_run": [name for name in native if name not in ran], "full_judgment": "pending"}


def train_measurements(train):
    """A merged train's measurements (items 481, 482): the train as tools/train.py read it, an ordinary train's hosted
    judgment "pending" and naming its PR. No release check ran here, so no count claims one did."""
    return {"train": {key: train[key] for key in ("file", "pr", "kind", "merge_commit", "merged_tree", "release_branch",
                                                  "items", "hosted_run", "judgment")}}


def _answers(argv, what):
    """Each JSON object a live CLI or admin call printed, one per line, or a refusal naming what was asked."""
    done = subprocess.run(argv, capture_output=True, text=True)
    try:
        answers = [json.loads(line) for line in done.stdout.splitlines() if line.strip()]
    except ValueError:
        answers = []
    if done.returncode != 0 or not answers or not all(isinstance(answer, dict) for answer in answers):
        raise train_check.Refused("%s (exit %s): %s" % (what, done.returncode, (done.stdout + done.stderr).strip()[:300]))
    return answers


def attach_judgment(config, number, runs, checks, audit, github):
    """Attach the hosted judgment of release number, read from github, to its record in config's instance through the
    live admin verb; the stored record, or tools.train.Refused naming the first fact that does not hold."""
    if not config.repository:
        raise train_check.Refused("the deploy config names no repository, which the judgment is read from")
    pages = _answers([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.server_profile),
                      "--json", "releases"], "the live release records could not be read")
    found = [item for page in pages for item in page.get("items") or [] if isinstance(item, dict) and item.get("release") == number]
    if not found:
        raise train_check.Refused("the live instance records no release %d" % number)
    record = found[0]
    if not judgment_pending(record.get("measurements")):
        raise train_check.Refused("release %d's record does not say its hosted judgment or its full run is pending" % number)
    judgment = train_check.on_commit(github, config.repository, {"producer_runs": runs, "verdict_checks": checks, "audit": audit},
                                     record["commit"], "release %d's commit" % number)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / ("judgment-%d.json" % number)
        path.write_text(json.dumps(judgment, indent=1) + "\n")
        [answer] = _answers([config.python, "-I", "-B", str(config.live / "bin/aim-next-admin"), "attach-judgment",
                             "--profile", str(config.server_profile), "--release", str(number), "--judgment", str(path)],
                            "the judgment was not attached")
    return answer


def main(argv=None, github=None):
    import argparse
    from tools import deploy
    parser = argparse.ArgumentParser(prog="tools/releases.py", description="Release records: attach a hosted judgment.")
    verbs = parser.add_subparsers(dest="verb", required=True)
    attach = verbs.add_parser("attach-judgment", help="attach an ordinary train's hosted judgment, or a scoped release's full "
                              "run, once it has landed")
    attach.add_argument("release", type=int)
    attach.add_argument("--config", required=True)
    words = lambda text: [int(part) for part in text.split(",") if part.strip()]
    attach.add_argument("--runs", type=words, required=True, help="the producer runs' ids, comma-separated")
    attach.add_argument("--checks", type=words, required=True, help="the verdict check runs' ids, comma-separated")
    attach.add_argument("--audit", required=True, help="the message that audited the judgment")
    args = parser.parse_args(argv)
    try:
        answer = attach_judgment(deploy.load_config(args.config), args.release, args.runs, args.checks, args.audit,
                                 github or train_check.GhCli())
    except (deploy.Refused, train_check.Refused) as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 1
    print(json.dumps(answer))
    return 0


if __name__ == "__main__":
    sys.exit(main())

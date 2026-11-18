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

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next.contract import _json
from aim_next.releases import judgment_pending, release_row, MAX_EVIDENCE_BYTES
from tools import train as train_check

NUMBER = re.compile(r"[1-9][0-9]*")
# Release records the repository keeps for releases recorded afterwards (docs/releases.md).
KEPT = "tools/pipeline/releases"
# Fields of one commit in `git log --format`, each Pipeline (then Train-Item) trailer's value, and the end of each commit.
FIELD, VALUE, END = "\x1f", "\x1d", "\x1e"
LOG_FORMAT = ("--format=%H%x1f%s%x1f%(trailers:key=Pipeline,valueonly,separator=%x1d)"
              "%x1f%(trailers:key=Train-Item,valueonly,separator=%x1d)%x1e")
REVERT = re.compile(r"revert(?:\s+(.*)|$)", re.I | re.S)
MAX_FULL_BYTES = 16 * 1024 * 1024


def canonical(value):
    """The complete evidence's canonical bytes, exactly Core's JSON serialization."""
    return _json(value).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _require(condition, reason):
    if not condition:
        raise train_check.Refused("release evidence: " + reason)


def _directory(evidence):
    path = Path(evidence)
    _require(path.is_absolute() and path == path.resolve(), "directory must be absolute and resolved")
    info = path.stat()
    _require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
             "directory must be owned and not writable by others")
    return path


def _read(path, limit):
    """Bounded full read of an owned regular file; never follow a final symlink."""
    with os.fdopen(os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_size <= limit,
                 "file must be owned, regular and within its byte bound")
        raw = stream.read(limit + 1)
    _require(len(raw) <= limit, "file exceeds its byte bound")
    return raw


def publish_once(path, raw, limit=MAX_FULL_BYTES):
    """Durably publish complete bytes atomically without replacing an existing name, then really read all bytes."""
    path = Path(path)
    _directory(path.parent)
    _require(len(str(path).encode("utf-8")) <= MAX_EVIDENCE_BYTES, "path exceeds its byte bound")
    _require(len(raw) <= limit, "payload exceeds its byte bound")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".release-", dir=str(path.parent), delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(str(temporary), str(path))
        except FileExistsError:
            pass  # An equal retry is safe; unequal/partial/symlink existing files refuse below.
        finally:
            temporary.unlink()
            temporary = None
        fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        actual = _read(path, limit)
        _require(actual == raw and hashlib.sha256(actual).digest() == hashlib.sha256(raw).digest(),
                 "published bytes differ on full read-back")
    finally:
        if temporary is not None:
            temporary.unlink()


def compact_measurements(full, path):
    """Storage projection only, never a judge: complete qualifications and raw conclusions stay inline."""
    _require(isinstance(full, dict) and "full_measurements" not in full, "expected complete measurements, not a pointer")
    raw = canonical(full)
    _require(len(raw) <= MAX_FULL_BYTES, "payload exceeds its byte bound")
    result = copy.deepcopy(full)
    train = result.get("train")
    if isinstance(train, dict):
        judgment = train.get("judgment")
        if isinstance(judgment, dict):
            _require("judge_receipts_sha256" not in train, "judge receipt digest field is reserved")
            train["judge_receipts_sha256"] = {key: digest(judgment[key]) for key in ("producer_runs", "verdict_checks")}
        moved = train.get("base_move")
        receipts = moved.get("receipts") if isinstance(moved, dict) else None
        if isinstance(receipts, dict) and "obligations" in receipts:
            obligations = receipts["obligations"]
            _require(isinstance(obligations, list), "expected full receipt obligations, not a digest")
            receipts["sha256"] = digest(receipts)
            receipts["obligations"] = {"count": len(obligations), "sha256": digest(obligations)}
    result["full_measurements"] = {"version": 1, "path": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
                                   "bytes": len(raw)}
    return result


def _measurement_path(record, evidence):
    _require(type(record.get("release")) is int and record["release"] > 0, "record must name its release")
    path = _directory(evidence) / ("release-%d-measurements.json" % record["release"])
    _require(len(str(path).encode("utf-8")) <= MAX_EVIDENCE_BYTES, "path exceeds its byte bound")
    return path


def _identity(record, full):
    train = full.get("train")
    if isinstance(train, dict):
        _require(train.get("merge_commit") == record["commit"], "train head differs from release head")
        _require(sorted(item["item"] for item in train["items"]) == sorted(record["items"]),
                 "train items differ from shipped items")
    else:
        judged = full.get("judged_tree") or full.get("release_check") or {}
        _require(judged.get("commit") == record["commit"], "measurement head differs from release head")


def prepare_record(record, evidence):
    """After the full guard: validate the bounded row, publish full measurements and verify before any stop."""
    full = record["measurements"]
    _require(isinstance(full, dict), "expected complete measurements")
    _identity(record, full)
    path = _measurement_path(record, evidence)
    result = dict(record, measurements=compact_measurements(full, path))
    # A placeholder tests only the shape before deployment; it is never returned or recorded.
    release_row(dict(result, deployed_at="2000-01-01T00:00:00+00:00", evidence=str(path.parent)))
    publish_once(path, canonical(full))
    verify_record(dict(result, evidence=str(path.parent)), evidence)
    return result


def verify_record(record, evidence):
    """Read complete evidence again and compare its exact projection, identity, qualifications and receipts."""
    path = _measurement_path(record, evidence)
    _require(record.get("evidence") == str(path.parent), "record evidence directory differs")
    measured = record["measurements"]
    ref = measured.get("full_measurements") if isinstance(measured, dict) else None
    _require(isinstance(ref, dict) and set(ref) == {"version", "path", "sha256", "bytes"}
             and ref["version"] == 1 and ref["path"] == str(path), "wrong complete measurement reference")
    raw = _read(path, MAX_FULL_BYTES)
    _require(len(raw) == ref["bytes"] and hashlib.sha256(raw).hexdigest() == ref["sha256"],
             "complete measurement hash or byte count differs")
    full = json.loads(raw)
    _require(canonical(full) == raw, "complete measurements are not canonical")
    _identity(record, full)
    _require(compact_measurements(full, path) == measured, "measurement projection differs (qualification or receipt)")
    return full


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
    result = {"train": {key: train[key] for key in ("file", "pr", "kind", "merge_commit", "merged_tree", "release_branch",
                                                  "items", "hosted_run", "judgment")}}
    if "base_move" in train:
        result["train"]["base_move"] = train["base_move"]
    return result


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

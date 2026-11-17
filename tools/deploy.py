#!/usr/bin/python3 -I
from __future__ import annotations

"""Deploy a reviewed Theseus commit to a live instance: stop, back up, fast-forward, migrate, restart.

Usage: tools/deploy.py --config CONFIG.json (--release-check SUMMARY.json | --train TRAIN.json) SHA EVIDENCE_DIR
                       [--release N] [--live-since TIME] [--no-items] [--known-reds FILE] [--dry-run]

SHA is the full commit, and SUMMARY.json is tools/release_check.py's summary
for exactly that commit, or for a commit whose tree, read from the live
checkout's git, is SHA's (item 588: a pull request's run judges GitHub's merge
of it, not the merged head); unless it passed, nothing is stopped or changed.
--train TRAIN.json takes, in place of a summary, the record of a train merged
into the config's release branch (tools/train.py): SHA is its merge commit, and
each of its facts is read again from git and GitHub before anything stops.
--known-reds FILE takes a summary whose only failures are browser cases the
live commit's own release check failed too (tools/known_reds.py); the release
record keeps them as known reds, never as passes.
With an outcome in the config, the summary is first measured as a run of the
outcome's checks (docs/targets.md, "What got worse"): anything worse than the
live release opens or posts in a fix topic and the run is recorded, so the
outcome page shows the stopped candidate, before the deploy refuses.
Every step writes its result to EVIDENCE_DIR; the first failure stops the run
(exit 1). --dry-run reads the live processes, checkout, checks and release
records, stops before changing or writing anything, and still exits 1 when the
release check has not passed or a check got worse. Once the new release is
verified, the deploy writes its release record into the instance (docs/releases.md), after any record the instance
lacks that the system can know; a deploy of the live commit is a restart and
writes no record of its own. docs/tools.md describes the config.
"""

import collections
import datetime
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import urllib.error
import urllib.request

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next.contract import Refusal
from aim_next.releases import release_row
from tools import checks as outcome_checks, known_reds as known_reds_check, release_check, releases, train as train_check

PYTHON = "/usr/bin/python3"
Config = collections.namedtuple(
    "Config", "live instance python server_profile port tailnet_origin runner_profile runner_id routes outcome reporter_profile "
    "release_branch repository")
REQUIRED_KEYS = ("live", "instance", "server_profile", "port", "runner_profile", "runner_id", "routes")
# outcome: the outcome whose checks this deploy measures (docs/targets.md); reporter_profile: the profile of a member, not
# its coordinator, that reads them, opens fix topics, writes the candidate's run and moves the release piece (D27).
# release_branch, repository: the branch a merged train lands on and the GitHub repository that branch and its runs are
# read from (owner/name), which --train needs (tools/train.py). After recording a verified new release,
# release_branch is also fast-forwarded on the live checkout's origin and read back from that remote.
OPTIONAL_KEYS = ("python", "tailnet_origin", "outcome", "reporter_profile", "release_branch", "repository")


class Refused(Exception):
    """A step's result does not allow the next step."""


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def load_config(path):
    """The instance this deploy acts on, from a JSON object; refuses a missing, unknown or malformed key."""
    try:
        raw = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Refused("no readable deploy config at %s: %s" % (path, error))
    require(isinstance(raw, dict), "the deploy config is not a JSON object")
    unknown = sorted(set(raw) - set(REQUIRED_KEYS) - set(OPTIONAL_KEYS))
    missing = [key for key in REQUIRED_KEYS if key not in raw]
    require(not unknown and not missing, "deploy config: unknown keys %s, missing keys %s" % (unknown, missing))
    strings = [key for key in REQUIRED_KEYS + OPTIONAL_KEYS if key in raw and key != "port"]
    require(all(isinstance(raw[key], str) and raw[key] for key in strings), "deploy config values must be non-empty strings")
    require(type(raw["port"]) is int and 0 < raw["port"] < 65536, "deploy config: port must be a TCP port number")
    for key in ("live", "instance") + (("python",) if "python" in raw else ()):
        require(os.path.isabs(raw[key]), "deploy config: %s must be an absolute path" % key)
    instance = Path(raw["instance"])
    require(("outcome" in raw) == ("reporter_profile" in raw), "deploy config: outcome and reporter_profile go together")
    require("release_branch" not in raw or (re.fullmatch(r"[A-Za-z0-9._/-]+", raw["release_branch"])
                                            and not raw["release_branch"].startswith(("-", "/")) and ".." not in raw["release_branch"]),
            "deploy config: release_branch is a branch name, such as release/live73")
    require("repository" not in raw or re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", raw["repository"]),
            "deploy config: repository is GitHub's owner/name")
    return Config(live=Path(raw["live"]), instance=instance, python=raw.get("python", PYTHON),
                  outcome=raw.get("outcome"), reporter_profile=instance / raw["reporter_profile"] if "reporter_profile" in raw else None,
                  server_profile=instance / raw["server_profile"], port=raw["port"],
                  tailnet_origin=raw.get("tailnet_origin"), runner_profile=instance / raw["runner_profile"],
                  runner_id=raw["runner_id"], routes=instance / raw["routes"],
                  release_branch=raw.get("release_branch"), repository=raw.get("repository"))


def server_argv(config):
    argv = [config.python, "-I", str(config.live / "bin/aim-next-server"), "--profile", str(config.server_profile),
            "--port", str(config.port)]
    return argv + (["--tailnet-origin", config.tailnet_origin] if config.tailnet_origin else [])


def runner_argv(config):
    return [config.python, "-I", str(config.live / "bin/aim-next-runner"), "--profile", str(config.runner_profile),
            "--runner-id", config.runner_id, "--routes", str(config.routes)]


def supervisor_argv(config):
    """The runner's supervisor, which runs the runner with the same arguments and starts it again when that is safe."""
    argv = runner_argv(config)
    return argv[:3] + ["supervise"] + argv[3:]


def now():
    return datetime.datetime.now().astimezone().isoformat()


def record(evidence, name, data):
    (evidence / (name + ".json")).write_text(json.dumps(data, indent=1, default=str) + "\n")
    print(name, json.dumps(data, default=str)[:400])


def run(argv, **kw):
    return subprocess.run(argv, capture_output=True, text=True, **kw)


def identity(pid):
    r = run(["ps", "-o", "lstart=,command=", "-p", str(pid)])
    return r.stdout.strip() if r.returncode == 0 else None


def processes():
    """(pid, parent pid, command line) of every process, from one listing."""
    rows = []
    for line in run(["ps", "-axo", "pid=,ppid=,command="]).stdout.splitlines():
        pid, parent, command = line.split(None, 2)
        rows.append((int(pid), int(parent), command))
    return rows


def find(rows, argv_tail):
    """PIDs whose command line ends with exactly this argv (after the interpreter)."""
    return [pid for pid, _, command in rows if command.endswith(" ".join(argv_tail)) and "deploy.py" not in command]


def wait_exit(pid):
    """Wait on the kernel's exit event for a process we did not start."""
    kq = select.kqueue()
    try:
        kq.control([select.kevent(pid, select.KQ_FILTER_PROC, select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                  select.KQ_NOTE_EXIT)], 0)
    except ProcessLookupError:
        return "already-gone"
    kq.control(None, 1, None)
    kq.close()
    return "exited"


def wait_line(path, proc):
    """Wait for the first complete line in a file the child writes, by vnode events."""
    fd = os.open(str(path), os.O_RDONLY)
    kq = select.kqueue()
    events = [select.kevent(fd, select.KQ_FILTER_VNODE, select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                            select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND),
              select.kevent(proc.pid, select.KQ_FILTER_PROC, select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                            select.KQ_NOTE_EXIT)]
    kq.control(events, 0)
    try:
        while True:
            text = path.read_text()
            if "\n" in text:
                return text.splitlines()[0]
            if proc.poll() is not None:
                return None
            kq.control(None, 1, None)
    finally:
        kq.close()
        os.close(fd)


def start(config, sha, argv, run_dir, previous):
    run_dir.mkdir(mode=0o700)
    launch = {"at": now(), "revision": sha, "argv": argv, "cwd": str(config.live), "previous": previous}
    (run_dir / "launch.json").write_text(json.dumps(launch, indent=1) + "\n")
    out = open(run_dir / "stdout.log", "wb")
    err = open(run_dir / "stderr.log", "wb")
    proc = subprocess.Popen(argv, cwd=str(config.live), stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                            start_new_session=True, close_fds=True)
    out.close()
    err.close()
    (run_dir / "pid.json").write_text(json.dumps({"pid": proc.pid, "at": now(), "identity": identity(proc.pid)}, indent=1) + "\n")
    return proc


def run_dirs(config, kind):
    """The instance's run-<kind>-NN records, oldest first by number."""
    found = sorted(config.instance.glob("run-%s-*" % kind), key=lambda d: int(d.name.rsplit("-", 1)[1]))
    require(found, "no run-%s-* record in %s" % (kind, config.instance))
    return found


def recorded(config, kind):
    """The PID the latest run record of this kind captured at start."""
    latest = run_dirs(config, kind)[-1]
    for name in ("pid.json", "observed.json"):
        if (latest / name).exists():
            return json.loads((latest / name).read_text())["pid"]


def live_records(config):
    """Every release record the live instance keeps, newest first; [] when its code keeps none.

    Code without release records (aim_next/releases.py) keeps none, so its
    instance gets an empty table from the migration. A read that fails stops
    the deploy: it is not the same as no records."""
    # ls-tree lists a path HEAD has and nothing for one it lacks; only a failed read exits non-zero.
    keeps = run(["git", "-C", str(config.live), "ls-tree", "--name-only", "HEAD", "aim_next/releases.py"])
    require(keeps.returncode == 0, "whether the live code keeps release records could not be read (exit %s): %s"
            % (keeps.returncode, keeps.stderr.strip()[:300]))
    if not keeps.stdout.strip():
        return []
    read = run([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.server_profile),
                "--json", "releases"])
    unreadable = "the live release records could not be read (exit %s): %s%s" % (
        read.returncode, read.stdout[:300], read.stderr[:300])
    require(read.returncode == 0, unreadable)
    records = []
    try:
        # One page per line; a refused read prints an error, not a page of items.
        for line in read.stdout.splitlines() or [""]:
            records.extend(json.loads(line)["items"])
    except (ValueError, KeyError, TypeError):
        raise Refused(unreadable)
    require(all(isinstance(record, dict) and type(record.get("release")) is int and isinstance(record.get("commit"), str)
                and isinstance(record.get("items"), list) for record in records), unreadable)
    return sorted(records, key=lambda record: -record["release"])


def repo_records(config, sha):
    """The release records the repository keeps at SHA (tools/pipeline/releases), oldest first."""
    listed = run(["git", "-C", str(config.live), "ls-tree", "--name-only", sha, releases.KEPT + "/"])
    require(listed.returncode == 0, "the release records kept at %s could not be listed: %s" % (sha[:12], listed.stderr))
    kept = []
    for path in listed.stdout.split():
        shown = run(["git", "-C", str(config.live), "show", "%s:%s" % (sha, path)])
        try:
            record = json.loads(shown.stdout)
            release_row(record)
        except (ValueError, Refusal) as error:
            raise Refused("the kept release record %s is not one: %s" % (path, getattr(error, "message", error)))
        require(record.get("release"), "the kept release record %s names no release number" % path)
        kept.append(record)
    return sorted(kept, key=lambda record: record["release"])


def follows(config, commit, head):
    """Whether commit is head or one of its ancestors in the live checkout; a commit git cannot read stops the deploy."""
    asked = run(["git", "-C", str(config.live), "merge-base", "--is-ancestor", commit, head])
    require(asked.returncode in (0, 1), "whether %s comes before %s could not be read (exit %s): %s"
            % (commit[:12], head[:12], asked.returncode, asked.stderr.strip()[:300]))
    return asked.returncode == 0


def kept_lacked(config, sha, known, head):
    """The records the repository keeps for this instance that it lacks, oldest first.

    They are this instance's when it records one of them, or, while it records
    none, when the newest is the live HEAD or one of its ancestors; otherwise
    they are another instance's. Together with its own they must be one line:
    consecutive numbers, each commit after the one before, one commit per number."""
    kept = repo_records(config, sha)
    recorded = {record["release"]: record for record in known}
    if known:
        if not any(recorded.get(record["release"], {}).get("commit") == record["commit"] for record in kept):
            return []
    elif not kept or not follows(config, kept[-1]["commit"], head):
        return []
    line, lacked = dict(recorded), []
    for record in kept:
        held = line.setdefault(record["release"], record)
        require(held["commit"] == record["commit"], "the repository keeps release %d at %s, but the instance records it "
                "at %s" % (record["release"], record["commit"][:12], held["commit"][:12]))
        if record["release"] not in recorded:
            lacked.append(record)
    numbers = sorted(line)
    require(numbers == list(range(numbers[0], numbers[-1] + 1)), "the releases the instance and the repository record are "
            "numbered %s, not one after another" % ", ".join(str(number) for number in numbers))
    for record in lacked:
        for older, newer in ((line.get(record["release"] - 1), record), (record, line.get(record["release"] + 1))):
            if older is not None and newer is not None:
                require(follows(config, older["commit"], newer["commit"]),
                        "release %d at %s does not come after release %d at %s" % (
                            newer["release"], newer["commit"][:12], older["release"], older["commit"][:12]))
    return lacked


def server_starts(config):
    """[(commit, time)]: each commit a server run record started, at the first time one did, in the order they started.

    The deploy writes launch.json when it starts a server; a run record without one predates that."""
    first = collections.OrderedDict()
    for run_dir in run_dirs(config, "server"):
        launch = run_dir / "launch.json"
        if not launch.exists():
            continue
        try:
            started = json.loads(launch.read_text())
        except (OSError, ValueError) as error:
            raise Refused("the run record %s could not be read: %s" % (launch, error))
        require(isinstance(started, dict) and isinstance(started.get("revision"), str) and isinstance(started.get("at"), str),
                "the run record %s does not say which commit it started and when" % launch)
        first.setdefault(started["revision"], started["at"])
    return list(first.items())


def went_live(config, latest, head, live_since):
    """[(commit, time)]: the releases that went live after the latest record without one, oldest first.

    Each commit a server run record started after the latest record's commit is
    one (a restart at the same commit is not another), at the first time one
    started it; the live HEAD is the last, at live_since when no run record
    started it."""
    if latest["commit"] == head:
        require(live_since is None, "--live-since names when an unrecorded live commit went live; %s is release %d"
                % (head[:12], latest["release"]))
        return []
    require(follows(config, latest["commit"], head), "the live commit %s does not follow %s, the commit of release %d, "
            "the latest recorded" % (head[:12], latest["commit"][:12], latest["release"]))
    found = []
    for commit, at in server_starts(config):
        if follows(config, commit, latest["commit"]):
            continue
        require(follows(config, latest["commit"], commit) and follows(config, commit, head),
                "a server run record started %s, which is neither before release %d at %s nor on the way to the live "
                "commit %s; record the releases since %d by hand (docs/releases.md)"
                % (commit[:12], latest["release"], latest["commit"][:12], head[:12], latest["release"]))
        require(not found or follows(config, found[-1][0], commit), "the server run records start %s after %s, which it "
                "comes before; record the releases since %d by hand (docs/releases.md)"
                % (commit[:12], found[-1][0][:12] if found else "", latest["release"]))
        found.append((commit, at))
    if found and found[-1][0] == head:
        require(live_since is None, "--live-since is not needed: the live server's run record says %s went live at %s"
                % (head[:12], found[-1][1]))
        return found
    require(live_since, "the live commit %s has no release record (release %d at %s is the latest) and no server run "
            "record says when it went live; name that time with --live-since, and the deploy records it as release %d "
            "before this one" % (head[:12], latest["release"], latest["commit"][:12], latest["release"] + len(found) + 1))
    return found + [(head, live_since)]


def shipped_between(config, older, newer):
    """(items, commits) the Pipeline trailers name from older to newer."""
    log = run(releases.log_argv(config.live, older, newer))
    require(log.returncode == 0, "the commits from %s to %s could not be read: %s" % (older, newer, log.stderr))
    try:
        return releases.shipped(log.stdout)
    except releases.Malformed as error:
        raise Refused(str(error))


def skip_basis(config, sha):
    """For a summary that skipped the browser modes and the wake replay (item 166): the live commit, and the paths
    changed since it that they could see at SHA, read here from the live checkout and never taken from the summary."""
    if config.outcome:
        raise release_check.Refused("measuring %s reads every step, so run the release check without --live" % config.outcome)
    head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"])
    if head.returncode != 0:
        raise release_check.Refused("the live commit cannot be read: %s" % head.stderr.strip())
    live, git = head.stdout.strip(), (lambda root, *args: run(["git", "-C", str(root)] + list(args)))
    return live, release_check.seen(config.live, sha, release_check.changed_paths(config.live, live, sha, git), git)


def scope_basis(config, sha):
    """For a scoped summary (item 608): the live commit, the paths changed since it, and the native steps those changes
    touch at SHA, chosen again here by tools/steps_for.py from the live checkout's git, never taken from the summary."""
    if config.outcome:
        raise release_check.Refused("measuring %s reads every step, so run the whole release check" % config.outcome)
    head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"])
    if head.returncode != 0:
        raise release_check.Refused("the live commit cannot be read: %s" % head.stderr.strip())
    live, git = head.stdout.strip(), (lambda root, *args: run(["git", "-C", str(root)] + list(args)))
    changed, chosen, _ = release_check.scope(config.live, live, sha, git)
    return live, changed, chosen


def live_policy(config, base):
    """.github/check-baseline.json at BASE, the live commit, read from the live checkout's git (never the candidate's
    copy); None when BASE keeps none. A read that fails is refused, not taken as no policy."""
    listed = run(["git", "-C", str(config.live), "ls-tree", "--name-only", base, "--", known_reds_check.POLICY])
    if listed.returncode != 0:
        raise known_reds_check.Refused("whether %s keeps %s could not be read (exit %s): %s" % (
            base[:12], known_reds_check.POLICY, listed.returncode, listed.stderr.strip()[:300]))
    if not listed.stdout.strip():
        return None
    shown = run(["git", "-C", str(config.live), "show", "%s:%s" % (base, known_reds_check.POLICY)])
    try:
        policy = json.loads(shown.stdout) if shown.returncode == 0 else None
    except ValueError:
        policy = None
    if policy is None:
        raise known_reds_check.Refused("%s at %s could not be read (exit %s): %s" % (
            known_reds_check.POLICY, base[:12], shown.returncode, (shown.stderr or shown.stdout).strip()[:300]))
    return policy


def policy_reds(config, base, sha):
    """Item 481: the reds the policy at the event base (live_policy at BASE) admits for SHA, matched as GitHub's
    classifier matches them (known_reds.Admissions); None when BASE keeps no policy. The candidate's own copy is never
    read, so its own admissions never count for it. A read that fails, or a policy that classifier would not load, is
    refused, not taken as no policy."""
    policy = live_policy(config, base)
    return None if policy is None else known_reds_check.Admissions(policy, config.live, sha, base)


def steps_beyond_policy(config, live):
    """Item 553: the record's word on the required steps this release check runs that the policy at LIVE, the live
    commit, does not review, for the next policy to cover, whatever the deploy takes (a merged train, a summary that
    passed, or known reds): {"steps_beyond_policy": [names]}, {} when there are none or LIVE keeps no policy, or
    {"steps_beyond_policy_unread": why} when the policy cannot be read, which is not "none". Each is said on one line.
    Never a refusal: a deploy that needs no policy is not stopped by one broken at the live commit."""
    try:
        policy = live_policy(config, live)
        beyond = [] if policy is None else known_reds_check.steps_beyond(policy, live)
    except known_reds_check.Refused as refusal:
        print("the steps beyond %s could not be read: %s" % (known_reds_check.POLICY, refusal))
        return {"steps_beyond_policy_unread": str(refusal)}
    if not beyond:
        return {}
    print("the release check runs %s, which %s at %s did not review; the next policy covers %s"
          % (", ".join(beyond), known_reds_check.POLICY, live[:12], "it" if len(beyond) == 1 else "them"))
    return {"steps_beyond_policy": beyond}


def live_head(config):
    """The live checkout's HEAD, which the known reds must have been read beside."""
    head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"])
    if head.returncode != 0:
        raise known_reds_check.Refused("the live commit cannot be read: %s" % head.stderr.strip())
    return head.stdout.strip()


def release_plan(config, head, sha, measured, number, no_items, live_since=None, flagged=()):
    """The records this deploy writes once the release is verified: (this release's, those before it, its commits, latest).

    Everything is read now, before anything stops, and each record is checked
    with this commit's own rules, so the record step cannot refuse it. Those
    before it are what the system knows and the instance lacks: the records the
    repository keeps for it (kept_lacked), then one for each commit a server run
    record started after the latest record (went_live). A deploy of the live
    commit is a restart: it ships nothing, and has no record of its own (None).
    measured: this release's measurements, from its release check's summary with the known reds the deploy took
    (item 178), or from its merged train (items 481, 482); each revert in the range is added to them.
    flagged: items --revert names, each reverted in the range by a commit made before a revert carried its
    `Train-Item: Revert N` trailer; like a trailer's revert, the release does not ship them and the record says so."""
    restart = sha == head
    items, commits = shipped_between(config, head, sha) if not restart else ([], [])
    require(not set(flagged) - set(items), "--revert names %s, which no commit from %s to %s ships (a Pipeline trailer it "
            "has not reverted by trailer)" % (sorted(set(flagged) - set(items)), head[:12], sha[:12]))
    items = [item for item in items if item not in flagged]
    require(items or no_items or restart, "no commit from %s to %s names a pipeline item in a 'Pipeline: N, M' "
            "trailer; name the items the changes deliver, or pass --no-items for a release that ships none"
            % (head[:12], sha[:12]))
    known = live_records(config)
    before = kept_lacked(config, sha, known, head)
    line = sorted(known + before, key=lambda each: each["release"])
    latest = line[-1] if line else None
    if latest is None:
        require(live_since is None, "--live-since names when an unrecorded live commit went live; no record places %s"
                % head[:12])
    else:
        for commit, at in went_live(config, latest, head, live_since):
            missed, _ = shipped_between(config, latest["commit"], commit)
            latest = {"release": latest["release"] + 1, "commit": commit, "previous": latest["commit"], "items": missed,
                      "deployed_at": at, "measurements": None, "source": "backfill", "evidence": None}
            before.append(latest)
            line.append(latest)
    if restart:
        require(number is None, "a deploy of the live commit restarts %s and writes no record of its own; --release "
                "is not for a restart" % ("release %d" % latest["release"] if latest else "it"))
        record = None
    else:
        if number is None:
            require(latest is not None, "neither the live instance nor the repository records a release %s follows; "
                    "name this one's number with --release" % head[:12])
            number = latest["release"] + 1
        require(latest is None or number == latest["release"] + 1,
                "release %d would not follow the latest, %s" % (number, latest and latest["release"]))
        # A revert in the range, by trailer or by --revert, with the commit that made it when the trailer says.
        reverts = releases.reverted(commits, flagged)
        record = {"release": number, "commit": sha, "previous": head, "items": items,
                  "measurements": dict(measured, **({"reverts": reverts} if reverts else {})), "source": "deploy"}
    planned = line + ([record] if record else [])
    # A commit is one release, and an item ships in one (the store refuses either again); say so now, before anything stops.
    release_of = {}
    for named in planned:
        require(release_of.setdefault(named["commit"], named["release"]) == named["release"],
                "%s is release %d and release %d; a commit is one release"
                % (named["commit"][:12], release_of[named["commit"]], named["release"]))
    shipped_in = {}
    for named in planned:
        for item in named["items"]:
            require(shipped_in.setdefault(item, named["release"]) == named["release"],
                    "pipeline item %d shipped in release %d; release %d names it again"
                    % (item, shipped_in[item], named["release"]))
    for checked in before + ([dict(record, deployed_at=now(), evidence="/checked")] if record else []):
        try:
            release_row(checked)
        except Refusal as refusal:
            raise Refused("the release record would be refused: %s" % refusal.message)
    return record, before, commits, latest


def record_commands(config, evidence, records):
    """Each record written to EVIDENCE as release-N.json, and the admin command that records it."""
    commands = []
    for written in records:
        path = (evidence / ("release-%d.json" % written["release"])).resolve()
        path.write_text(json.dumps(written, indent=1) + "\n")
        commands.append([config.python, "-I", "-B", str(config.live / "bin/aim-next-admin"), "record-release",
                         "--profile", str(config.server_profile), "--record", str(path)])
    return commands


def live_checks(config, sha):
    """The outcome's checks, live baseline, allowances and fix topics for SHA, read through the live CLI as the
    reporter; None when the live code keeps none.

    Code without outcome checks (aim_next/checks.py) keeps none, so there is
    nothing to compare against yet. A read that fails stops the deploy: it is
    not the same as no checks."""
    # ls-tree lists a path HEAD has and nothing for one it lacks; only a failed read exits non-zero.
    keeps = run(["git", "-C", str(config.live), "ls-tree", "--name-only", "HEAD", "aim_next/checks.py"])
    require(keeps.returncode == 0, "whether the live code keeps outcome checks could not be read (exit %s): %s"
            % (keeps.returncode, keeps.stderr.strip()[:300]))
    if not keeps.stdout.strip():
        return None
    answer = run([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.reporter_profile), "--json",
                  "checks", config.outcome, "--live", sha])
    lines = [line for line in answer.stdout.splitlines() if line.startswith("{")]
    try:
        view = json.loads(lines[0]) if lines else {}
    except ValueError:
        view = {}
    require(answer.returncode == 0 and isinstance(view.get("checks"), list),
            "the live outcome's checks could not be read (exit %s, %s): %s" % (
                answer.returncode, (view.get("error") or {}).get("code"), (answer.stderr or answer.stdout).strip()[:300]))
    return view


def as_reporter(config, *argv):
    """One write by the reporter through the live CLI; its last receipt's result, or a refusal naming what was asked."""
    answer = run([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.reporter_profile), "--json"]
                 + list(argv))
    receipts = []
    for line in answer.stdout.splitlines():
        try:
            receipts.append(json.loads(line))
        except ValueError:
            pass
    result = receipts[-1].get("result") if receipts and isinstance(receipts[-1], dict) else None
    require(answer.returncode == 0 and isinstance(result, dict), "%s was not written (exit %s): %s" % (
        argv[0], answer.returncode, (answer.stdout + answer.stderr).strip()[:300]))
    return result


def names(items):
    """The checks' names as words: A; A and B; A, B and C."""
    named = [item["name"] for item in items]
    return named[0] if len(named) == 1 else "%s and %s" % (", ".join(named[:-1]), named[-1])


def tell_worse(config, sha, view, found, summary):
    """02-worse (D15): each worse check told to the coordinator in its open fix topic, or in one the reporter starts,
    each write named from (check, SHA) so a deploy run again for SHA finds the same topic and post. Returns
    {check_id: topic_id}."""
    told, release = {}, view["candidate_release"]
    for item in found:
        operation = "fix-%s-%s" % (item["check_id"], sha[:12])
        known = view["fix_topics"].get(item["check_id"])
        if known and known["commit"] == sha:
            # Its reading at SHA already names the topic: this deploy was run again after its run was written.
            told[item["check_id"]] = known["topic_id"]
        elif known:
            as_reporter(config, "post", known["topic_id"], "--tells", view["coordinator"], "--subject", "check:" + item["check_id"],
                        "--operation", "fix-post-%s-%s" % (item["check_id"], sha[:12]), outcome_checks.fix_body(item, release, summary, False))
            told[item["check_id"]] = known["topic_id"]
        else:
            result = as_reporter(config, "start", config.outcome, "--title", outcome_checks.fix_title(item, release), "--with",
                                 view["coordinator"], "--operation", operation, outcome_checks.fix_body(item, release, summary, True))
            told[item["check_id"]] = result["topic"]["id"]
    return told


def record_run(config, evidence, view, measured, found, told):
    """02-run: the candidate's run, written by the server as the reporter, each worse reading naming its fix topic, and
    so read by Core as the open release piece's; that piece, held, says why."""
    measured = dict(measured, readings=[dict(reading, fix_topic_id=told[reading["check_id"]]) if reading["check_id"] in told else reading
                                        for reading in measured["readings"]])
    path = (evidence / "checks-run.json").resolve()
    path.write_text(json.dumps(measured, indent=1) + "\n")
    argv = [config.python, "-I", "-B", str(config.live / "bin/aim-next-admin"), "record-checks", "--profile",
            str(config.server_profile), "--run", str(path), "--as", view["reader"]]
    wrote = run(argv)
    result = {"run": str(path), "exit": wrote.returncode, "stdout": wrote.stdout, "stderr": wrote.stderr, "held": None}
    piece = view["release_piece"]
    if wrote.returncode == 0 and found and piece:
        words = "Held: %s got worse." % names(found)
        as_reporter(config, "stage-note", piece["id"], words)
        result["held"] = {"piece": piece["id"], "note": words}
    record(evidence, "02-run", result)
    require(wrote.returncode == 0, "the candidate's run of the outcome's checks was not written (%s); nothing was stopped"
            % (wrote.stdout or wrote.stderr).strip()[:300])


def enter_deploy(config, evidence, view, planned):
    """03-stage: the outcome's release, as 02-checks read it (Core's one rule, docs/pipeline.md), leaves checks for deploy;
    its gate holds on the readings 02-run wrote for it."""
    piece = view["release_piece"]
    if not planned or not piece or piece["stage"] != "checks":
        record(evidence, "03-stage", {"entered": None, "piece": piece, "why": "a restart ships nothing" if not planned else
                                      "no release is being put together" if not piece else "the release is in %s, not checks" % piece["stage"]})
        return
    result = as_reporter(config, "enter-stage", piece["id"], "deploy", "--left", "passed")
    record(evidence, "03-stage", {"entered": "deploy", "piece": piece, "result": result})


def judged_tree(config, sha, judged):
    """Item 588: for a summary of judged, another full commit: {judged_commit, commit, tree}, the tree it shares with
    SHA read from the live checkout's git; or release_check.Refused when the trees differ or git cannot read either. A
    deploy that measures an outcome records its run at the summary's own commit, so it takes no other commit's."""
    if config.outcome:
        raise release_check.Refused("measuring %s records its run at the summary's own commit, so it takes only a summary "
                                    "of exactly %s" % (config.outcome, sha))
    tree = release_check.same_tree(lambda *args: run(["git", "-C", str(config.live)] + list(args)), judged, sha)
    return {"judged_commit": judged, "commit": sha, "tree": tree}


def take_train(config, sha, evidence, train, known_reds, github):
    """00-train (items 481, 482): the merged train, each of its facts read again from the live checkout's git and from
    GitHub, or Refused before anything else is read. A record never claims a local check that did not run."""
    try:
        if config.outcome:
            raise train_check.Refused("measuring %s reads a release check's summary, which a merged train does not have"
                                      % config.outcome)
        if known_reds is not None:
            raise train_check.Refused("--known-reds stands for cases of a local release check's summary, not a merged train")
        if not config.release_branch or not config.repository:
            raise train_check.Refused("the deploy config names no release_branch and repository, which a merged train is "
                                      "read against")
        head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"])
        if head.returncode != 0:
            raise train_check.Refused("the live commit cannot be read: %s" % head.stderr.strip())
        trained = train_check.judge(train, sha, head.stdout.strip(), config.release_branch, config.repository,
                                    lambda *args: run(["git", "-C", str(config.live)] + list(args)), github)
    except train_check.Refused as refusal:
        record(evidence, "00-train", {"train": str(train), "commit": sha, "refused": str(refusal)})
        raise Refused("train: %s; nothing was stopped" % refusal)
    record(evidence, "00-train", trained)
    print(train_check.said(trained))
    return trained


def deploy(config, sha, evidence, summary, dry, number=None, no_items=False, live_since=None, known_reds=None,
           train=None, github=None, revert=()):
    require(re.fullmatch(r"[0-9a-f]{40}", sha or ""), "give the full 40-character commit, not %r" % sha)
    require((summary is None) != (train is None), "the deploy takes a release check's summary or a merged train, one of them")
    evidence.mkdir(parents=True, exist_ok=True)
    # 0. A merged train (items 481, 482), or a summary of exactly this commit; otherwise nothing is touched.
    trained = take_train(config, sha, evidence, train, known_reds, github) if train is not None else None
    # A summary whose steps failed is still measured (7.2 step 1). One that skipped steps is taken only when what
    # changed since the live commit, read here, lets them be skipped; one scoped to a small fix only when the steps
    # that change touches, chosen again here, all ran (item 608).
    # Item 588: a summary of another commit is taken when its tree, read here, is SHA's; the deploy records both.
    judged = []
    foreign, unpassed = (release_check.judge_summary(summary, sha, lambda: skip_basis(config, sha), lambda: scope_basis(config, sha),
                                                     lambda commit: judged.append(judged_tree(config, sha, commit)))
                         if trained is None else ([], []))
    judged = judged[0] if judged and not foreign else None
    reasons = foreign + unpassed
    # Item 178: failed browser cases the live commit fails too, each listed, are known reds; they stay failures.
    known = None
    if known_reds is not None and not foreign:
        try:
            known = known_reds_check.judge(known_reds, summary, unpassed, lambda: live_head(config),
                                           lambda base: policy_reds(config, base, sha))
        except known_reds_check.Refused as refusal:
            known = {"file": str(known_reds), "refused": str(refusal)}
    if trained is None:
        record(evidence, "00-release-check", dict({"summary": str(summary), "commit": sha, "passed": not reasons,
                                                   "reasons": reasons, "skipped": release_check.skipped_of(summary),
                                                   "scoped": release_check.skipped_of(summary, "scoped")},
                                                  **({"judged": judged} if judged else {}),
                                                  **({"known_reds": known} if known_reds is not None else {})))
    unchecked = "the release check has not passed for %s: %s" % (sha, "; ".join(reasons))
    require(not foreign, unchecked)
    if known is not None and "refused" in known:
        raise Refused("known reds: %s; nothing was stopped" % known["refused"])
    accepted = known["accepted"] if known is not None else []
    # Each red is recorded with the line the operator reads (known_reds.SAID), and that line is what is printed.
    for line in known_reds_check.said(known or {}):
        print(line)
    server_args, runner_args, supervisor_args = server_argv(config), runner_argv(config), supervisor_argv(config)
    record(evidence, "00-plan", {"commit": sha, "dry_run": dry, "live": config.live, "instance": config.instance,
                                 "server": server_args, "runner": supervisor_args})

    # 1. The live processes, by exact command line, and nothing else matching. The runner runs
    # under its supervisor, or bare as one started before supervision did.
    rows = processes()
    server_pids, supervisors = find(rows, server_args[1:]), find(rows, supervisor_args[1:])
    # A supervised runner is its supervisor's child, found by parent rather than by command line: the
    # supervisor starts it by its own interpreter and resolved checkout path, not the deploy's spelling.
    children = [pid for pid, parent, _ in rows if parent in supervisors]
    # Any other runner of this profile is found by its own arguments, however its interpreter and path are
    # spelled: one a killed supervisor left behind keeps the spelling that supervisor gave it.
    bare = [pid for pid in find(rows, ["/bin/aim-next-runner"] + runner_args[3:]) if pid not in children]
    runner_pids = children if supervisors else bare
    live = {"server": [(p, identity(p)) for p in server_pids], "supervisor": [(p, identity(p)) for p in supervisors],
            "runner": [(p, identity(p)) for p in runner_pids]}
    record(evidence, "01-live", live)
    require(len(server_pids) == 1 and len(supervisors) <= 1 and len(runner_pids) <= 1,
            "expected one server and at most one runner: %s" % live)
    # A supervisor starts one process, the runner; a runner beside it is not its own.
    require(not (supervisors and bare), "a runner is not its supervisor's own child: %s %s %s" % (supervisors, children, bare))
    stop = supervisors or bare
    # Each must be the PID its own run record captured at start.
    require(server_pids == [recorded(config, "server")] and stop in ([], [recorded(config, "runner")]),
            "live processes are not the ones their run records started: %s %s" % (server_pids, stop))
    head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"]).stdout.strip()
    dirty = run(["git", "-C", str(config.live), "status", "--porcelain", "--untracked-files=no"]).stdout
    ff = run(["git", "-C", str(config.live), "merge-base", "--is-ancestor", head, sha]).returncode == 0
    record(evidence, "02-checkout", {"head": head, "target": sha, "tracked_changes": dirty, "fast_forward": ff})
    require(not dirty and ff, "the live checkout has tracked changes or %s is not a fast-forward of %s" % (sha, head))
    require(not accepted or head == known["live_commit"], "the live checkout is at %s now, not %s, which the known reds "
            "were read beside; nothing was stopped" % (head, known and known["live_commit"]))
    require(trained is None or head == trained["live"], "the live checkout is at %s now, not %s, which the train's changes "
            "were read from; nothing was stopped" % (head, trained and trained["live"]))

    # 02-checks (12, 104): the candidate's readings beside the live release's, read as the reporter.
    view, found = None, []
    if config.outcome:
        view = live_checks(config, sha)
        if view is None:
            # Known from the live code, not a failed read: the import writes this release's run from its record (8.2).
            record(evidence, "02-checks", {"outcome": config.outcome, "checks": "the live release keeps no outcome checks yet",
                                           "run": outcome_checks.run_from_summary(json.loads(Path(summary).read_text()), [], config.outcome)})
        else:
            # D27: Core never delivers a message to its author, so a coordinator telling itself of a fix wakes nobody.
            require(view["reader"] in view["members"] and view["reader"] != view["coordinator"],
                    "the reporter, %s, must be a member of %s and not its coordinator (%s); nothing was stopped"
                    % (view["reader"], config.outcome, view["coordinator"]))
            written = json.loads(Path(summary).read_text())
            measured = outcome_checks.run_from_summary(written, view["checks"], config.outcome)
            # A replayed measure compares with its rerun beside the candidate, so that rerun must be of the code now live.
            replayed = [check["check_id"] for check in view["checks"] if not check.get("retired_why")
                        and set(release_check.SOURCE_STEPS.get(check["source"], ())) & set(release_check.REPLAYED)]
            beside = (written.get("base") or {}).get("commit") if isinstance(written.get("base"), dict) else None
            if replayed and beside != head:
                raise Refused("the replay was measured beside %s, but release %d (%s) is live; run the release check again; nothing was stopped" % (
                    beside[:12] if beside else "nothing (the summary has no base)", view["candidate_release"] - 1, head[:12]))
            # A replayed measure that asks for more runs than the replay made would be told as worse; say so before anything is told.
            asked = max([check.get("repeats") or 1 for check in view["checks"] if check["check_id"] in replayed] or [1])
            made = release_check.replay_runs(written)
            if made is not None and made < asked:
                raise Refused("the wake replay ran %d time%s and %s asks for %d; run the release check with --repeats %d; nothing was stopped" % (
                    made, "" if made == 1 else "s", ", ".join(replayed), asked, asked))
            found = outcome_checks.worse(measured, view)
            record(evidence, "02-checks", {"outcome": config.outcome, "live": view["live"], "candidate_release": view["candidate_release"],
                                           "checks": len(view["checks"]), "allowances": view["allowances"], "fix_topics": view["fix_topics"],
                                           "release_piece": view["release_piece"], "run": measured, "worse": found,
                                           "titles": [outcome_checks.fix_title(item, view["candidate_release"]) for item in found]})
            if not dry:
                # 02-worse, then 02-run: told before the run is written, since a reading never changes and a worse one names its fix topic.
                told = tell_worse(config, sha, view, found, Path(summary).resolve())
                record(evidence, "02-worse", {"told": told})
                record_run(config, evidence, view, measured, found, told)
    # The verdict: anything worse first, then a summary that did not pass. Nothing has stopped.
    if found:
        raise Refused("%s got worse: %s" % (names(found), "; ".join(item["why"] for item in found)))
    require(not unpassed or accepted, unchecked)
    measured = (releases.train_measurements(trained) if trained is not None
                else releases.measurements(json.loads(Path(summary).read_text()), accepted, judged))
    measured = dict(measured, **steps_beyond_policy(config, head))
    planned, before, commits, latest = release_plan(config, head, sha, measured, number, no_items, live_since, revert)
    # A restart (planned is None) is of the latest release, when one places the live commit.
    restart_of = latest["release"] if planned is None and latest else None
    record(evidence, "02-release", {"record": planned, "before": before, "commits": commits,
                                    "latest_recorded": latest and latest["release"], "restart_of": restart_of})
    this = "release %d" % planned["release"] if planned else "the restart of %s" % (
        "release %d" % restart_of if restart_of else sha[:12])
    if dry:
        return
    if view is not None:
        enter_deploy(config, evidence, view, planned)

    # 2. Stop the runner, then the server, by captured PID; wait on each exit event. A supervisor
    # passes the stop to its runner and exits only after the runner has.
    stopped = {}
    for name, pids in (("runner", stop), ("server", server_pids)):
        for pid in pids:
            os.kill(pid, 15)
            stopped[name] = (pid, wait_exit(pid))
    old_runner_dir = run_dirs(config, "runner")[-1]
    final = (old_runner_dir / "stdout.log").read_text().splitlines()[-1:] if runner_pids else []
    stopped["runner_final"] = final
    record(evidence, "03-stopped", stopped)
    # A paused runner needs a deliberate --resume-version; stop here rather than guess.
    require(not runner_pids or (final and json.loads(final[0]).get("status") == "stopped"),
            "the runner did not stop cleanly; its last line: %s" % final)

    # 3. A fresh backup with the code that wrote the database.
    backup_dir = config.instance / "backups" / ("pre-deploy-" + datetime.datetime.now().strftime("%Y%m%dT%H%M%S"))
    probe = run([config.python, "-I", "-B", "-c", (
        "import sys,json; sys.path.insert(0, %r)\n"
        "from aim_next.profile import load_profile\nfrom aim_next import recovery\n"
        "p = load_profile(%r)\n"
        "r = recovery.backup(str(p.db_path), p.instance_id, expected_binding=p.binding, bundle_path=%r)\n"
        "print(json.dumps(r, default=str))") % (str(config.live), str(config.server_profile), str(backup_dir))])
    record(evidence, "04-backup", {"path": str(backup_dir), "exit": probe.returncode, "stdout": probe.stdout, "stderr": probe.stderr})
    require(probe.returncode == 0, "the backup failed")

    # 4. Fast-forward the live checkout.
    merge = run(["git", "-C", str(config.live), "merge", "--ff-only", sha])
    record(evidence, "05-fast-forward", {"exit": merge.returncode, "stdout": merge.stdout, "stderr": merge.stderr,
                                         "head": run(["git", "-C", str(config.live), "rev-parse", "HEAD"]).stdout.strip()})
    require(merge.returncode == 0, "the fast-forward failed")

    # 5. Migrate with the new code; the runner guard is free because the runner is stopped.
    db = str(config.instance / "data.sqlite3")
    binding = json.loads(config.server_profile.read_text())["instance_id"]
    mig = run([config.python, "-I", "-B", str(config.live / "bin/aim-next-admin"), "migrate", "--db", db,
               "--instance", binding, "--binding", str(config.server_profile)])
    record(evidence, "06-migrate", {"exit": mig.returncode, "stdout": mig.stdout, "stderr": mig.stderr})
    require(mig.returncode == 0, "the migration failed")

    # 6. Restart the server, wait for its ready line, then the runner.
    numbers = [int(p.name.rsplit("-", 1)[1]) for p in run_dirs(config, "server")]
    server_dir = config.instance / ("run-server-%02d" % (numbers[-1] + 1))
    runs = [int(p.name.rsplit("-", 1)[1]) for p in run_dirs(config, "runner")]
    runner_dir = config.instance / ("run-runner-%02d" % (runs[-1] + 1))
    server = start(config, sha, server_args, server_dir, {"pid": server_pids[0], "identity": live["server"][0][1]})
    ready = wait_line(server_dir / "stdout.log", server)
    record(evidence, "07-server", {"pid": server.pid, "run": str(server_dir), "ready": ready})
    require(ready and json.loads(ready).get("status") == "ready", "the server did not report ready: %s" % ready)
    # The team is already in place; its setup matches topics by title, which a rename can change, so it does not run again.
    runner = start(config, sha, supervisor_args, runner_dir, {"pid": stop[0] if stop else None})
    first = wait_line(runner_dir / "stdout.log", runner)
    record(evidence, "09-runner", {"pid": runner.pid, "run": str(runner_dir), "identity": identity(runner.pid), "first": first})
    require(first and json.loads(first).get("event") == "acquired", "the runner did not acquire its guard: %s" % first)

    # 7. Verify over HTTP and the CLI.
    base = "http://127.0.0.1:%d" % config.port
    try:
        boot = urllib.request.urlopen(base + "/api/bootstrap").read().decode()
    except urllib.error.HTTPError as error:
        boot = "%s %s" % (error.code, error.read().decode()[:300])
    try:
        root = urllib.request.urlopen(base + "/").status
    except urllib.error.HTTPError as error:
        root = error.code
    cli = run([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.server_profile), "binding"])
    verified = {"root_status": root, "bootstrap_head": boot[:600], "cli_exit": cli.returncode,
                "cli": cli.stdout[:600], "cli_err": cli.stderr[:600],
                "server_alive": server.poll() is None, "runner_alive": runner.poll() is None}
    record(evidence, "10-verify", verified)
    # The records, in the order they are written: those before this release, then its own, stamped now.
    records = before + ([dict(planned, deployed_at=now(), evidence=str(evidence.resolve()))] if planned else [])
    commands = record_commands(config, evidence, records)
    later = "; once it works, record it with: %s" % " && ".join(" ".join(argv) for argv in commands) if commands else ""
    require(root == 200 and cli.returncode == 0 and verified["server_alive"] and verified["runner_alive"],
            "%s did not verify, so no release record was written: %s. %s is live%s" % (this, verified, sha[:12], later))

    # 8. Record the release in the instance, now that it is verified live; the evidence keeps the same records.
    writes = []
    for index, argv in enumerate(commands):
        wrote = run(argv)
        writes.append({"release": records[index]["release"], "exit": wrote.returncode, "stdout": wrote.stdout,
                       "stderr": wrote.stderr})
        if wrote.returncode != 0:
            break
    record(evidence, "11-release", {"records": records, "writes": writes})
    if writes and writes[-1]["exit"] != 0:
        failed = writes[-1]
        raise Refused("%s is live but the record of release %d was not written (%s); write it, and those after it, "
                      "with: %s" % (this, failed["release"], (failed["stdout"] or failed["stderr"]).strip()[:300],
                                    " && ".join(" ".join(argv) for argv in commands[len(writes) - 1:])))

    # 9. Publish only a verified, recorded NEW release; a restart never moves the remote branch.
    if planned is not None:
        publish_release_branch(config, sha, evidence)


def publish_release_branch(config, sha, evidence):
    """12-release-branch (667): fast-forward origin's configured branch, then attest its remote head.

    The release is already live and recorded. Any refusal leaves that record alone. Fetching the exact branch
    reads its old head and brings its history here for the ancestry check; no cached remote-tracking ref is trusted.
    The ancestry check permits only a fast-forward, and an explicit lease makes the remote compare the fetched
    head atomically. A normal push alone could recreate a branch deleted since fetch, or overwrite a rewind.
    """
    result = {"branch": config.release_branch, "remote": "origin", "old_head": None, "new_head": sha,
              "read_back": None, "moved": False, "success": False}
    if not config.release_branch:
        result["why"] = "no release_branch configured; the branch was not moved"
        record(evidence, "12-release-branch", result)
        return
    ref = "refs/heads/" + config.release_branch

    def git(step, *args):
        answer = run(["git", "-C", str(config.live)] + list(args))
        result[step] = {"exit": answer.returncode, "stdout": answer.stdout, "stderr": answer.stderr}
        require(answer.returncode == 0, "release branch %s %s failed (exit %s): %s" % (
            config.release_branch, step, answer.returncode, (answer.stderr or answer.stdout).strip()[:300]))
        return answer.stdout.strip()

    try:
        git("fetch", "fetch", "--no-tags", "origin", ref)
        old = git("fetched_head", "rev-parse", "--verify", "FETCH_HEAD")
        result["old_head"] = old
        require(re.fullmatch(r"[0-9a-f]{40}", old), "the fetched release branch names no full commit")
        require(follows(config, old, sha), "release branch %s at %s is not an ancestor of shipped head %s; "
                "the branch was not moved (never forced)" % (config.release_branch, old, sha))
        if old != sha:
            git("push", "push", "--porcelain", "--force-with-lease=" + ref + ":" + old, "origin", sha + ":" + ref)
            result["moved"] = True
        read = git("read-back", "ls-remote", "--exit-code", "--refs", "origin", ref)
        rows = [line.split() for line in read.splitlines()]
        require(len(rows) == 1 and len(rows[0]) == 2 and rows[0][1] == ref,
                "release branch %s read-back did not name the exact remote branch" % config.release_branch)
        result["read_back"] = rows[0][0]
        require(result["read_back"] == sha, "release branch %s read-back is %s, not shipped head %s" % (
            config.release_branch, result["read_back"], sha))
        result["success"] = True
    except (Refused, OSError) as error:
        result["refused"] = str(error)
        raise Refused("%s; %s is live and its release record is kept" % (error, sha[:12]))
    finally:
        record(evidence, "12-release-branch", result)


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Deploy a reviewed Theseus commit to a live instance.")
    parser.add_argument("--config", required=True)
    checked = parser.add_mutually_exclusive_group(required=True)
    checked.add_argument("--release-check", type=Path, help="the release check's summary.json")
    checked.add_argument("--train", type=Path, help="an absolute JSON file: the train merged into the config's release "
                         "branch, whose merge commit is SHA (docs/tools.md, A merged train)")
    parser.add_argument("sha")
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--release", type=int, help="this release's number; needed only when neither the instance nor "
                        "the repository records a release the live commit follows")
    parser.add_argument("--live-since", help="when the unrecorded live commit went live (ISO 8601 with its offset); "
                        "needed only when its server's run record does not say")
    parser.add_argument("--no-items", action="store_true", help="the release ships no pipeline item, and says so")
    parser.add_argument("--known-reds", type=Path, help="an absolute JSON file of the browser cases this release fails "
                        "that the live commit's release check failed too (docs/tools.md, Known reds)")
    parser.add_argument("--revert", type=int, action="append", default=[], metavar="N",
                        help="an item a commit in the range reverts without a 'Train-Item: Revert N' trailer (one made "
                        "before the trailer rule); the release does not ship it, and its record says by flag")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        deploy(load_config(args.config), args.sha, args.evidence, args.release_check, args.dry_run, args.release,
               args.no_items, args.live_since, args.known_reds, revert=args.revert, train=args.train,
               github=train_check.GhCli() if args.train else None)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

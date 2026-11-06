#!/usr/bin/python3 -I
from __future__ import annotations

"""Deploy a reviewed Theseus commit to a live instance: stop, back up, fast-forward, migrate, restart.

Usage: tools/deploy.py --config CONFIG.json --release-check SUMMARY.json SHA EVIDENCE_DIR
                       [--release N] [--live-since TIME] [--no-items] [--dry-run]

SHA is the full commit, and SUMMARY.json is tools/release_check.py's summary
for exactly that commit; unless it passed, nothing is stopped or changed.
Every step writes its result to EVIDENCE_DIR; the first failure stops the run
(exit 1). --dry-run reads the live processes, checkout and release records,
stops before changing anything, and still exits 1 when the release check has
not passed. Once the new release is verified, the deploy writes its release
record into the instance (docs/releases.md), after any record the instance
lacks that the system can know. docs/tools.md describes the config.
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
from tools import release_check, releases

PYTHON = "/usr/bin/python3"
Config = collections.namedtuple(
    "Config", "live instance python server_profile port tailnet_origin runner_profile runner_id routes")
REQUIRED_KEYS = ("live", "instance", "server_profile", "port", "runner_profile", "runner_id", "routes")
OPTIONAL_KEYS = ("python", "tailnet_origin")


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
    return Config(live=Path(raw["live"]), instance=instance, python=raw.get("python", PYTHON),
                  server_profile=instance / raw["server_profile"], port=raw["port"],
                  tailnet_origin=raw.get("tailnet_origin"), runner_profile=instance / raw["runner_profile"],
                  runner_id=raw["runner_id"], routes=instance / raw["routes"])


def server_argv(config):
    argv = [config.python, "-I", str(config.live / "bin/aim-next-server"), "--profile", str(config.server_profile),
            "--port", str(config.port)]
    return argv + (["--tailnet-origin", config.tailnet_origin] if config.tailnet_origin else [])


def runner_argv(config):
    return [config.python, "-I", str(config.live / "bin/aim-next-runner"), "--profile", str(config.runner_profile),
            "--runner-id", config.runner_id, "--routes", str(config.routes)]


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


def find(argv_tail):
    """PIDs whose command line ends with exactly this argv (after the interpreter)."""
    r = run(["ps", "-axo", "pid=,command="])
    hits = []
    for line in r.stdout.splitlines():
        pid, _, command = line.strip().partition(" ")
        if command.endswith(" ".join(argv_tail)) and "deploy.py" not in command:
            hits.append(int(pid))
    return hits


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
    keeps = run(["git", "-C", str(config.live), "cat-file", "-e", "HEAD:aim_next/releases.py"]).returncode == 0
    if not keeps:
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
                require(older["commit"] != newer["commit"] and follows(config, older["commit"], newer["commit"]),
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


def release_plan(config, head, sha, summary, number, no_items, live_since=None):
    """The records this deploy writes once the release is verified: (this release's, those before it, its commits, latest).

    Everything is read now, before anything stops, and each record is checked
    with this commit's own rules, so the record step cannot refuse it. Those
    before it are what the system knows and the instance lacks: the records the
    repository keeps for it (kept_lacked), then one for each commit a server run
    record started after the latest record (went_live)."""
    items, commits = shipped_between(config, head, sha)
    require(items or no_items, "no commit from %s to %s names a pipeline item in a 'Pipeline: N, M' trailer; "
            "name the items the changes deliver, or pass --no-items for a release that ships none" % (head[:12], sha[:12]))
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
    if number is None:
        require(latest is not None, "neither the live instance nor the repository records a release %s follows; name "
                "this one's number with --release" % head[:12])
        number = latest["release"] + 1
    require(latest is None or number == latest["release"] + 1,
            "release %d would not follow the latest, %s" % (number, latest and latest["release"]))
    record = {"release": number, "commit": sha, "previous": head, "items": items,
              "measurements": releases.measurements(json.loads(Path(summary).read_text())), "source": "deploy"}
    # An item ships in one release (the store refuses it again); say so now, before anything stops.
    shipped_in = {}
    for named in line + [record]:
        for item in named["items"]:
            require(shipped_in.setdefault(item, named["release"]) == named["release"],
                    "pipeline item %d shipped in release %d; release %d names it again"
                    % (item, shipped_in[item], named["release"]))
    for checked in before + [dict(record, deployed_at=now(), evidence="/checked")]:
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


def deploy(config, sha, evidence, summary, dry, number=None, no_items=False, live_since=None):
    require(re.fullmatch(r"[0-9a-f]{40}", sha or ""), "give the full 40-character commit, not %r" % sha)
    evidence.mkdir(parents=True, exist_ok=True)
    # 0. The release check passed for exactly this commit, or nothing is touched.
    reasons = release_check.verify_summary(summary, sha)
    record(evidence, "00-release-check", {"summary": str(summary), "commit": sha, "passed": not reasons,
                                          "reasons": reasons})
    unchecked = "the release check has not passed for %s: %s" % (sha, "; ".join(reasons))
    require(dry or not reasons, unchecked)
    server_args, runner_args = server_argv(config), runner_argv(config)
    record(evidence, "00-plan", {"commit": sha, "dry_run": dry, "live": config.live, "instance": config.instance,
                                 "server": server_args, "runner": runner_args})

    # 1. The live processes, by exact command line, and nothing else matching.
    server_pids, runner_pids = find(server_args[1:]), find(runner_args[1:])
    live = {"server": [(p, identity(p)) for p in server_pids], "runner": [(p, identity(p)) for p in runner_pids]}
    record(evidence, "01-live", live)
    require(len(server_pids) == 1 and len(runner_pids) <= 1, "expected one server and at most one runner: %s" % live)
    # Each must be the PID its own run record captured at start.
    require(server_pids == [recorded(config, "server")] and runner_pids in ([], [recorded(config, "runner")]),
            "live processes are not the ones their run records started: %s %s" % (server_pids, runner_pids))
    head = run(["git", "-C", str(config.live), "rev-parse", "HEAD"]).stdout.strip()
    dirty = run(["git", "-C", str(config.live), "status", "--porcelain", "--untracked-files=no"]).stdout
    ff = run(["git", "-C", str(config.live), "merge-base", "--is-ancestor", head, sha]).returncode == 0
    record(evidence, "02-checkout", {"head": head, "target": sha, "tracked_changes": dirty, "fast_forward": ff})
    require(not dirty and ff, "the live checkout has tracked changes or %s is not a fast-forward of %s" % (sha, head))
    # A release check that did not pass has no counts to record; a dry run stops here and says why.
    require(not reasons, unchecked)
    planned, before, commits, latest = release_plan(config, head, sha, summary, number, no_items, live_since)
    record(evidence, "02-release", {"record": planned, "before": before, "commits": commits,
                                    "latest_recorded": latest and latest["release"]})
    if dry:
        return

    # 2. Stop the runner, then the server, by captured PID; wait on each exit event.
    stopped = {}
    for name, pids in (("runner", runner_pids), ("server", server_pids)):
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
    runner = start(config, sha, runner_args, runner_dir, {"pid": runner_pids[0] if runner_pids else None})
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
    records = before + [dict(planned, deployed_at=now(), evidence=str(evidence.resolve()))]
    commands = record_commands(config, evidence, records)
    require(root == 200 and cli.returncode == 0 and verified["server_alive"] and verified["runner_alive"],
            "the new release did not verify, so no release record was written: %s. %s is live; once it works, record "
            "it with: %s" % (verified, sha[:12], " && ".join(" ".join(argv) for argv in commands)))

    # 8. Record the release in the instance, now that it is verified live; the evidence keeps the same records.
    writes = []
    for index, argv in enumerate(commands):
        wrote = run(argv)
        writes.append({"release": records[index]["release"], "exit": wrote.returncode, "stdout": wrote.stdout,
                       "stderr": wrote.stderr})
        if wrote.returncode != 0:
            break
    record(evidence, "11-release", {"records": records, "writes": writes})
    failed = writes[-1]
    require(failed["exit"] == 0, "release %d is live but the record of release %d was not written (%s); write it, and "
            "those after it, with: %s" % (planned["release"], failed["release"], (failed["stdout"] or failed["stderr"]).strip()[:300],
                                          " && ".join(" ".join(argv) for argv in commands[len(writes) - 1:])))


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Deploy a reviewed Theseus commit to a live instance.")
    parser.add_argument("--config", required=True)
    parser.add_argument("--release-check", required=True, type=Path, help="the release check's summary.json")
    parser.add_argument("sha")
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--release", type=int, help="this release's number; needed only when neither the instance nor "
                        "the repository records a release the live commit follows")
    parser.add_argument("--live-since", help="when the unrecorded live commit went live (ISO 8601 with its offset); "
                        "needed only when its server's run record does not say")
    parser.add_argument("--no-items", action="store_true", help="the release ships no pipeline item, and says so")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        deploy(load_config(args.config), args.sha, args.evidence, args.release_check, args.dry_run, args.release,
               args.no_items, args.live_since)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

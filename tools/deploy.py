#!/usr/bin/python3 -I
from __future__ import annotations

"""Deploy a reviewed Theseus commit to a live instance: stop, back up, fast-forward, migrate, restart.

Usage: tools/deploy.py --config CONFIG.json --release-check SUMMARY.json SHA EVIDENCE_DIR
                       [--release N] [--no-items] [--dry-run]

SHA is the full commit, and SUMMARY.json is tools/release_check.py's summary
for exactly that commit; unless it passed, nothing is stopped or changed.
Every step writes its result to EVIDENCE_DIR; the first failure stops the run
(exit 1). --dry-run reads the live processes, checkout and release records,
stops before changing anything, and still exits 1 when the release check has
not passed. Once the new release is verified, the deploy writes its release
record into the instance (docs/releases.md). docs/tools.md describes the config.
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


def latest_release(config):
    """The newest release number the live instance records, or None when it records none.

    Code without release records (aim_next/releases.py) keeps none, so its
    instance gets an empty table from the migration. A read that fails stops
    the deploy: it is not the same as no records."""
    keeps = run(["git", "-C", str(config.live), "cat-file", "-e", "HEAD:aim_next/releases.py"]).returncode == 0
    if not keeps:
        return None
    read = run([config.python, "-I", "-B", str(config.live / "bin/aim-next"), "--profile", str(config.server_profile),
                "--json", "releases", "--limit", "1"])
    try:
        # A refused read prints an error, not a page of items.
        items = json.loads(read.stdout.splitlines()[0])["items"]
    except (ValueError, IndexError, KeyError, TypeError):
        raise Refused("the live release records could not be read (exit %s): %s%s"
                      % (read.returncode, read.stdout[:300], read.stderr[:300]))
    return items[0]["release"] if items else None


def release_plan(config, head, sha, summary, number, no_items):
    """The release record this deploy will write once the release is verified, less its time and evidence.

    Everything it needs is read now, before anything stops, and the record is
    checked with this commit's own rules, so the record step cannot refuse it."""
    log = run(releases.log_argv(config.live, head, sha))
    require(log.returncode == 0, "the commits from %s to %s could not be read: %s" % (head, sha, log.stderr))
    try:
        items, commits = releases.shipped(log.stdout)
    except releases.Malformed as error:
        raise Refused(str(error))
    require(items or no_items, "no commit from %s to %s names a pipeline item in a 'Pipeline: N, M' line; "
            "name the items the changes deliver, or pass --no-items for a release that ships none" % (head[:12], sha[:12]))
    latest = latest_release(config)
    if number is None:
        require(latest is not None, "the live instance records no release yet; name this one's number with --release")
        number = latest + 1
    require(latest is None or number == latest + 1, "release %d would not follow the latest recorded, %s" % (number, latest))
    record = {"release": number, "commit": sha, "previous": head, "items": items,
              "measurements": releases.measurements(json.loads(Path(summary).read_text())), "source": "deploy"}
    try:
        release_row(dict(record, deployed_at=now(), evidence="/checked"))
    except Refusal as refusal:
        raise Refused("the release record would be refused: %s" % refusal.message)
    return record, commits, latest


def deploy(config, sha, evidence, summary, dry, number=None, no_items=False):
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
    planned, commits, latest = release_plan(config, head, sha, summary, number, no_items)
    record(evidence, "02-release", {"record": planned, "latest_recorded": latest, "commits": commits})
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
    require(root == 200 and cli.returncode == 0 and verified["server_alive"] and verified["runner_alive"],
            "the new release did not verify, so no release record was written: %s" % verified)

    # 8. Record the release in the instance, now that it is verified live; the evidence keeps the same record.
    final = dict(planned, deployed_at=now(), evidence=str(evidence.resolve()))
    path = evidence / "release-record.json"
    path.write_text(json.dumps(final, indent=1) + "\n")
    argv = [config.python, "-I", "-B", str(config.live / "bin/aim-next-admin"), "record-release",
            "--profile", str(config.server_profile), "--record", str(path.resolve())]
    wrote = run(argv)
    record(evidence, "11-release", {"record": final, "exit": wrote.returncode, "stdout": wrote.stdout, "stderr": wrote.stderr})
    require(wrote.returncode == 0, "release %d is live but its record was not written (%s); write it with: %s"
            % (final["release"], (wrote.stdout or wrote.stderr).strip()[:300], " ".join(argv)))


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Deploy a reviewed Theseus commit to a live instance.")
    parser.add_argument("--config", required=True)
    parser.add_argument("--release-check", required=True, type=Path, help="the release check's summary.json")
    parser.add_argument("sha")
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--release", type=int, help="this release's number; needed only while the instance records none")
    parser.add_argument("--no-items", action="store_true", help="the release ships no pipeline item, and says so")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        deploy(load_config(args.config), args.sha, args.evidence, args.release_check, args.dry_run, args.release, args.no_items)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

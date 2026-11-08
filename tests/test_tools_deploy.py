from __future__ import annotations

import datetime
import io
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing, redirect_stderr, redirect_stdout
import itertools
from unittest import mock

from aim_next import admin, cli, outcome_rules, supervisor as runner_supervisor
from tools import deploy, release_check
import test_agent_cli
from test_pipeline_steering import PipelineCase

SHA = "c" * 40
# os.kill before any test replaces it with a recorder.
REAL_KILL = os.kill
HEAD = "b" * 40


def log(*commits):
    """`git log` output as the deploy asks for it: one entry per (subject, its Pipeline trailer values), oldest first.

    Which lines are trailers is git's to read (tests/test_tools_releases.py runs it)."""
    return "".join("%s\x1f%s\x1f%s\x1e\n" % (("%040x" % (n + 1)), subject, "\x1d".join(values))
                   for n, (subject, values) in enumerate(commits))


SHIPPED = log(("One change", ["88"]))


def release(number, commit, items=(), **more):
    return dict({"release": number, "commit": commit, "previous": None, "deployed_at": "2026-11-06T05:28:35-08:00",
                 "items": list(items), "measurements": None, "source": "backfill", "evidence": None}, **more)


def page(*records):
    """The CLI's --json page; a bare number is a record with no items, the first of them at the live HEAD."""
    records = [record if isinstance(record, dict) else release(record, HEAD if index == 0 else "%040x" % record)
               for index, record in enumerate(records)]
    return json.dumps({"instance_id": "i-1", "items": records, "next_cursor": None}) + "\n"


def summary(commit=SHA, failed=()):
    steps = [{"name": name, "exit": int(name in failed), "passed": name not in failed} for name in release_check.REQUIRED]
    return {"tool": release_check.TOOL, "commit": commit, "tree_unchanged": True, "passed": not failed,
            "required": list(release_check.REQUIRED), "steps": steps}


class FakeHost:
    """Answers the deploy's ps and git calls from a table and records every call; nothing real runs."""

    def __init__(self, config, servers=(111,), runners=(222,), supervisors=(), children=(), dirty="", ff=True, backup=0,
                 merge=0, migrate=0, spelled_as_deployed=False,
                 log=SHIPPED, keeps=True, releases=(page(19), 0), cli=0, recorded=0, on_cli=None, logs=None,
                 kept=(), listed=0, at=SHA, line=(HEAD,), others=()):
        """runners are bare runners (as started before supervision); children are (pid, parent) runner processes,
        spelled the way the real supervisor starts them (its own interpreter and its checkout's resolved path), or
        exactly as the deploy spells a runner when those are the same."""
        self.spelled_as_deployed = spelled_as_deployed
        self.config, self.calls = config, []
        self.servers, self.runners = list(servers), list(runners)
        self.supervisors, self.children = list(supervisors), list(children)
        self.dirty, self.ff, self.backup, self.merge, self.migrate = dirty, ff, backup, merge, migrate
        self.log, self.keeps, self.releases, self.cli, self.recorded = log, keeps, releases, cli, recorded
        self.written, self.on_cli = [], on_cli
        # keeps: whether the live code keeps release records, None when git cannot say. git log answers per range
        # (default: self.log), an (output, exit) pair for a range git cannot read. kept: the records
        # tools/pipeline/releases holds at `at`, the commit deployed, listed with exit `listed`. line: the live
        # checkout's history, oldest first; others: commits git knows on another line. Any other commit is one git
        # cannot read (exit 128).
        self.logs, self.kept, self.listed, self.at = logs or {}, list(kept), listed, at
        self.line, self.others = list(line), set(others)

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        out, code = "", 0
        if argv[:2] == ["ps", "-axo"]:
            server = " ".join(deploy.server_argv(self.config))
            runner = " ".join(deploy.runner_argv(self.config))
            supervisor = " ".join(deploy.supervisor_argv(self.config))
            out = "".join("%d 1 %s\n" % (pid, server) for pid in self.servers)
            out += "".join("%d 1 %s\n" % (pid, runner) for pid in self.runners)
            out += "".join("%d 1 %s\n" % (pid, supervisor) for pid in self.supervisors)
            child = runner if self.spelled_as_deployed else " ".join(runner_supervisor.child_argv(deploy.runner_argv(self.config)[3:]))
            out += "".join("%d %d %s\n" % (pid, parent, child) for pid, parent in self.children)
            out += "333 1 /usr/bin/python3 -I unrelated\n"
        elif argv[:2] == ["ps", "-o"]:
            out = "Thu Nov  5 15:02:31 2026     process %s" % argv[-1]
        elif argv[0] == "git" and "rev-parse" in argv:
            out = HEAD + "\n"
        elif argv[0] == "git" and "status" in argv:
            out = self.dirty
        elif argv[0] == "git" and "merge-base" in argv and argv[-1] == SHA:
            code = 0 if self.ff else 1
        elif argv[0] == "git" and "merge-base" in argv:
            older, newer = argv[-2:]
            if not {older, newer} <= set(self.line) | self.others:
                code = 128
            else:
                code = 0 if older == newer or (older in self.line and newer in self.line
                                               and self.line.index(older) < self.line.index(newer)) else 1
        elif argv[0] == "git" and "merge" in argv:
            code = self.merge
        elif argv[0] == "git" and "log" in argv:
            out = self.logs.get(argv[-1], self.log)
            if isinstance(out, tuple):
                out, code = out
        elif argv[0] == "git" and "ls-tree" in argv and argv[-1] == "aim_next/releases.py":
            out, code = ("aim_next/releases.py\n" if self.keeps else "", 0) if self.keeps is not None else ("", 128)
        elif argv[0] == "git" and "ls-tree" in argv:
            out = "".join("tools/pipeline/releases/release-%s.json\n" % record["release"] for record in self.kept)
            code = self.listed
        elif argv[0] == "git" and "show" in argv:
            out = json.dumps([record for record in self.kept
                              if argv[-1] == "%s:tools/pipeline/releases/release-%s.json" % (self.at, record["release"])][0])
        elif "releases" in argv:
            out, code = self.releases
        elif "record-release" in argv:
            # What the admin verb was handed, read while the file is there.
            self.written.append(json.loads(Path(argv[argv.index("--record") + 1]).read_text()))
            out, code = ('{"ok":true}\n', 0) if self.recorded == 0 else ('{"ok":false,"error":{"code":"RELEASE_EXISTS"}}\n', 2)
        elif "-c" in argv:
            code = self.backup
        elif "migrate" in argv:
            code = self.migrate
        elif argv[-1] == "binding":
            if self.on_cli:
                self.on_cli()
            out, code = "i-1\n", self.cli
        else:
            raise AssertionError("unexpected command %r" % argv)
        return subprocess.CompletedProcess(argv, code, out, "")

    def ran(self, word):
        return [argv for argv in self.calls if word in argv]


class DeployCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.instance = base / "instance"
        for name, pid, last in (("run-server-03", 111, None), ("run-runner-01", 9, None), ("run-runner-02", 222, '{"status": "stopped"}')):
            (self.instance / name).mkdir(parents=True)
            (self.instance / name / "pid.json").write_text(json.dumps({"pid": pid}))
            if last:
                (self.instance / name / "stdout.log").write_text('{"event": "acquired"}\n' + last + "\n")
        (self.instance / "tony.profile.json").write_text(json.dumps({"instance_id": "i-1"}))
        self.raw = {"live": str(base / "live"), "instance": str(self.instance), "server_profile": "tony.profile.json",
                    "port": 5192, "tailnet_origin": "https://host.example:5192", "runner_profile": "agent.profile.json",
                    "runner_id": "runner-01", "routes": "routes.json"}
        self.config_path = base / "deploy.json"
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.evidence = base / "evidence"
        self.kills = []
        self.summary = base / "summary.json"
        self.summary.write_text(json.dumps(summary()))

    def tearDown(self):
        self.tmp.cleanup()

    def deploy(self, host, dry=False, sha=SHA, **release):
        with mock.patch.object(deploy, "run", host), \
                mock.patch.object(deploy.os, "kill", lambda pid, sig: self.kills.append((pid, sig))), \
                mock.patch.object(deploy, "wait_exit", return_value="exited"), \
                mock.patch.object(deploy, "start", side_effect=AssertionError("must not start a process")), \
                redirect_stdout(io.StringIO()):
            deploy.deploy(self.config, sha, self.evidence, self.summary, dry, **release)

    def planned(self, host, **release):
        """A dry run that must not refuse; a refusal fails the test rather than erroring it."""
        try:
            self.deploy(host, dry=True, **release)
        except deploy.Refused as refusal:
            self.fail("the deploy refused: %s" % refusal)

    def refused(self, host, dry=False, sha=SHA, **release):
        """The deploy's refusal; a crash is not one."""
        try:
            self.deploy(host, dry, sha, **release)
        except deploy.Refused as refusal:
            return str(refusal)
        except Exception as error:  # the failure under test: anything but a refusal
            self.fail("the deploy did not refuse, it raised %r" % error)
        self.fail("the deploy was not refused")

    def records(self):
        return sorted(path.stem for path in self.evidence.glob("*.json"))


class Config(DeployCase):
    def test_the_config_names_every_machine_path_and_the_argv_is_built_from_it(self):
        base = Path(self.raw["live"])
        self.assertEqual(deploy.server_argv(self.config), [
            "/usr/bin/python3", "-I", str(base / "bin/aim-next-server"), "--profile", str(self.instance / "tony.profile.json"),
            "--port", "5192", "--tailnet-origin", "https://host.example:5192"])
        self.assertEqual(deploy.runner_argv(self.config), [
            "/usr/bin/python3", "-I", str(base / "bin/aim-next-runner"), "--profile", str(self.instance / "agent.profile.json"),
            "--runner-id", "runner-01", "--routes", str(self.instance / "routes.json")])
        # The deploy starts the runner under its supervisor, which runs it with exactly these arguments.
        self.assertEqual(deploy.supervisor_argv(self.config),
                         deploy.runner_argv(self.config)[:3] + ["supervise"] + deploy.runner_argv(self.config)[3:])
        del self.raw["tailnet_origin"]
        self.raw.update(python="/opt/python3", routes="/elsewhere/routes.json")
        self.config_path.write_text(json.dumps(self.raw))
        config = deploy.load_config(self.config_path)
        self.assertEqual(deploy.server_argv(config)[-2:], ["--port", "5192"])
        self.assertEqual(deploy.runner_argv(config)[0], "/opt/python3")
        self.assertEqual(deploy.runner_argv(config)[-1], "/elsewhere/routes.json")

    def test_a_malformed_config_is_refused(self):
        for change in ({"port": "5192"}, {"port": 0}, {"live": "relative/live"}, {"python": "python3"},
                       {"runner_id": ""}, {"extra": 1}):
            with self.subTest(change):
                raw = dict(self.raw, **change)
                self.config_path.write_text(json.dumps(raw))
                with self.assertRaises(deploy.Refused):
                    deploy.load_config(self.config_path)
        for key in deploy.REQUIRED_KEYS:
            with self.subTest(missing=key):
                self.config_path.write_text(json.dumps({k: v for k, v in self.raw.items() if k != key}))
                with self.assertRaises(deploy.Refused):
                    deploy.load_config(self.config_path)
        self.config_path.write_text("[]")
        with self.assertRaises(deploy.Refused):
            deploy.load_config(self.config_path)
        with self.assertRaises(deploy.Refused):
            deploy.load_config(self.config_path.with_name("absent.json"))


class Refusals(DeployCase):
    def test_a_dry_run_reads_and_records_the_plan_and_changes_nothing(self):
        host = FakeHost(self.config)
        self.deploy(host, dry=True)
        self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout", "02-release"])
        self.assertEqual(self.kills, [])
        self.assertEqual(host.ran("merge") + host.ran("migrate") + host.ran("-c"), [])
        live = json.loads((self.evidence / "01-live.json").read_text())
        self.assertEqual([pid for pid, _ in live["server"]], [111])
        self.assertEqual([pid for pid, _ in live["runner"]], [222])

    def test_unexpected_live_processes_are_refused_before_anything_stops(self):
        for host, reason in ((FakeHost(self.config, servers=()), "expected one server"),
                             (FakeHost(self.config, servers=(111, 112)), "expected one server"),
                             (FakeHost(self.config, runners=(222, 223)), "expected one server"),
                             (FakeHost(self.config, servers=(110,)), "not the ones their run records started"),
                             (FakeHost(self.config, runners=(221,)), "not the ones their run records started")):
            with self.subTest(reason=reason, servers=host.servers, runners=host.runners):
                self.assertIn(reason, self.refused(host))
                self.assertEqual(self.kills, [])

    def test_a_supervised_runner_is_stopped_through_its_supervisor(self):
        for spelled in (False, True):
            with self.subTest(spelled_as_deployed=spelled):
                self.kills = []
                kw = dict(runners=(), supervisors=(222,), children=((224, 222),), spelled_as_deployed=spelled)
                self.assertIn("migration failed", self.refused(FakeHost(self.config, migrate=1, **kw)))
                self.assertEqual(self.kills, [(222, 15), (111, 15)])
                self.kills = []
                self.deploy(FakeHost(self.config, **kw), dry=True)
                live = json.loads((self.evidence / "01-live.json").read_text())
                self.assertEqual(([pid for pid, _ in live["supervisor"]], [pid for pid, _ in live["runner"]]), ([222], [224]))

    def test_a_supervised_runner_that_did_not_stop_cleanly_is_caught_however_its_path_is_spelled(self):
        # The supervisor starts its child by its own interpreter and resolved checkout path, not the deploy's spelling.
        (self.instance / "run-runner-02" / "stdout.log").write_text('{"status": "paused", "reason": "storage_failure"}\n')
        host = FakeHost(self.config, runners=(), supervisors=(222,), children=((224, 222),))
        self.assertIn("did not stop cleanly", self.refused(host))
        self.assertEqual(self.kills, [(222, 15), (111, 15)])

    def test_a_supervisor_between_runs_is_stopped_without_a_runner_line(self):
        (self.instance / "run-runner-02" / "stdout.log").write_text('{"status": "idle_lease_lost"}\n')
        host = FakeHost(self.config, runners=(), supervisors=(222,), migrate=1)
        self.assertIn("migration failed", self.refused(host))
        self.assertEqual(self.kills, [(222, 15), (111, 15)])

    def test_runners_that_are_not_the_supervisors_own_are_refused_before_anything_stops(self):
        for kw, reason in ((dict(runners=(224,), supervisors=(222,), children=((225, 222),)), "not its supervisor's"),
                           (dict(runners=(224,), supervisors=(222,)), "not its supervisor's"),
                           (dict(runners=(), supervisors=(222,), children=((224, 222), (225, 222))), "at most one runner"),
                           (dict(runners=(), supervisors=(222, 223)), "at most one runner"),
                           (dict(runners=(), supervisors=(221,), children=((224, 221),)), "not the ones their run records started")):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                self.assertIn(reason, self.refused(FakeHost(self.config, **kw)))
                self.assertEqual(self.kills, [])

    def test_a_runner_left_behind_by_a_supervisor_that_died_is_refused_however_its_path_is_spelled(self):
        # A killed supervisor leaves its runner to pid 1, spelled the way the supervisor started it, not the deploy's way.
        for kw, reason in ((dict(runners=(), supervisors=(), children=((224, 1),)), "not the ones their run records started"),
                           (dict(runners=(), supervisors=(222,), children=((224, 1), (225, 222))), "not its supervisor's")):
            for spelled in (False, True):
                with self.subTest(spelled_as_deployed=spelled, **{k: str(v) for k, v in kw.items()}):
                    self.kills = []
                    self.assertIn(reason, self.refused(FakeHost(self.config, spelled_as_deployed=spelled, **kw)))
                    self.assertEqual(self.kills, [])

    def test_a_dirty_or_diverged_live_checkout_is_refused_before_anything_stops(self):
        for host in (FakeHost(self.config, dirty=" M aim_next/store.py\n"), FakeHost(self.config, ff=False)):
            self.assertIn("fast-forward", self.refused(host))
            self.assertEqual(self.kills, [])
            self.assertEqual(json.loads((self.evidence / "02-checkout.json").read_text())["target"], SHA)

    def test_a_runner_that_did_not_stop_cleanly_stops_the_deploy_before_the_backup(self):
        (self.instance / "run-runner-02" / "stdout.log").write_text('{"status": "paused"}\n')
        host = FakeHost(self.config)
        self.assertIn("did not stop cleanly", self.refused(host))
        self.assertEqual(self.kills, [(222, 15), (111, 15)])
        self.assertEqual(host.ran("-c"), [])

    def test_a_failed_backup_stops_before_the_fast_forward(self):
        host = FakeHost(self.config, backup=1)
        self.assertIn("backup failed", self.refused(host))
        self.assertEqual([argv for argv in host.ran("merge") if "--ff-only" in argv], [])

    def test_a_failed_fast_forward_or_migration_stops_before_any_restart(self):
        host = FakeHost(self.config, merge=1)
        self.assertIn("fast-forward failed", self.refused(host))
        self.assertEqual(host.ran("migrate"), [])
        host = FakeHost(self.config, migrate=1)
        self.assertIn("migration failed", self.refused(host))
        migrate = host.ran("migrate")[0]
        self.assertEqual(migrate[migrate.index("--db") + 1], str(self.instance / "data.sqlite3"))
        self.assertEqual(migrate[migrate.index("--instance") + 1], "i-1")

    def test_main_exits_one_on_a_refusal(self):
        host = FakeHost(self.config, ff=False)
        with mock.patch.object(deploy, "run", host), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
            code = deploy.main(["--config", str(self.config_path), "--release-check", str(self.summary), SHA,
                                str(self.evidence), "--dry-run"])
        self.assertEqual(code, 1)
        self.assertIn("refused:", err.getvalue())


class ReleasePlan(DeployCase):
    """Before anything stops, the deploy works out the release record it will write and checks it can be written."""

    def plan(self):
        return json.loads((self.evidence / "02-release.json").read_text())

    def test_the_items_come_from_every_commit_shipped_in_order_and_the_number_follows_the_latest(self):
        shipped = log(("Close keeps the writing", ["87, 2"]), ("A check for the saving sign", []),
                      ("Merge branch 'next-90'", ["2", "90"]))
        host = FakeHost(self.config, log=shipped, releases=(page(19, 18), 0))
        self.deploy(host, dry=True)
        plan = self.plan()
        self.assertEqual({key: plan["record"][key] for key in ("release", "commit", "previous", "items", "source")},
                         {"release": 20, "commit": SHA, "previous": HEAD, "items": [87, 2, 90], "source": "deploy"})
        self.assertEqual([commit["items"] for commit in plan["commits"]], [[87, 2], [], [2, 90]])
        self.assertEqual(plan["latest_recorded"], 19)
        self.assertIsNone(plan["restart_of"], "a deploy that ships a release restarts none")
        log_call = host.ran("log")[0]
        self.assertEqual(log_call[-1], "%s..%s" % (HEAD, SHA))
        self.assertIn("--reverse", log_call)
        self.assertEqual(self.kills, [])

    def test_the_record_carries_the_release_checks_counts(self):
        written = summary()
        for step in written["steps"]:
            step["counts"] = ({"tests": 1106, "status": "OK"} if step["name"] == "python-units" else
                              {"tests": 740, "pass": 740} if step["name"] == "node-units" else {"tests": 3, "pass": 2})
        self.summary.write_text(json.dumps(written))
        self.deploy(FakeHost(self.config), dry=True)
        measured = self.plan()["record"]["measurements"]
        natives = len(release_check.NATIVE_STEPS)
        self.assertEqual((measured["python_units"], measured["node_units"]), ({"tests": 1106}, {"tests": 740, "pass": 740}))
        self.assertEqual((measured["native"]["pass"], measured["native"]["total"]), (2 * natives, 3 * natives))
        self.assertEqual(measured["native"]["steps"]["journal"], {"pass": 2, "total": 3})
        self.assertEqual(set(measured["native"]["steps"]), {step.name for step in release_check.NATIVE_STEPS})

    def test_a_pipeline_trailer_that_names_no_item_numbers_stops_the_deploy_before_anything_stops(self):
        for value in ("next", "87 and 2", "", "087", "2,"):
            with self.subTest(value):
                host = FakeHost(self.config, log=log(("Something", ["3", value])))
                self.assertIn("does not name pipeline item numbers", self.refused(host))
                self.assertEqual((self.kills, host.ran("-c")), ([], []))

    def test_a_record_the_store_would_refuse_stops_the_deploy_before_anything_stops(self):
        # 501 items: more than a record holds, so the record could never be written once the release is live.
        host = FakeHost(self.config, log=log(("Everything", [", ".join(str(n) for n in range(1, 502))])))
        self.assertIn("the release record would be refused: items is a list of at most 500", self.refused(host))
        self.assertEqual((self.kills, host.ran("-c"), self.records()[-1]), ([], [], "02-checkout"))

    def test_a_release_that_names_no_item_says_so_or_stops_before_anything_stops(self):
        quiet = log(("A check", []), ("Another check", []))
        host = FakeHost(self.config, log=quiet)
        self.assertIn("--no-items", self.refused(host))
        self.assertEqual((self.kills, host.ran("-c")), ([], []))
        self.deploy(FakeHost(self.config, log=quiet), dry=True, no_items=True)
        self.assertEqual(self.plan()["record"]["items"], [])

    def test_the_first_record_needs_its_number_and_a_named_number_must_follow_the_latest(self):
        # Live code from before release records: the migration starts an empty table.
        host = FakeHost(self.config, keeps=False)
        self.assertIn("--release", self.refused(host))
        self.assertEqual((self.kills, host.ran("releases")), ([], []))
        self.deploy(FakeHost(self.config, keeps=False), dry=True, number=20)
        self.assertEqual(self.plan()["record"]["release"], 20)
        # Live code that keeps records, none written yet.
        self.assertIn("--release", self.refused(FakeHost(self.config, releases=(page(), 0))))
        self.assertIn("would not follow the latest, 19", self.refused(FakeHost(self.config), number=21))
        self.deploy(FakeHost(self.config), dry=True, number=20)
        self.assertEqual(self.plan()["record"]["release"], 20)
        self.assertEqual(self.kills, [])

    def launched(self, revision, at="2026-11-07T05:00:00-08:00"):
        """The live server's run record, as the deploy that started it wrote it."""
        (self.instance / "run-server-03" / "launch.json").write_text(json.dumps({"at": at, "revision": revision}))

    def test_a_live_commit_no_record_names_is_recorded_first_from_its_servers_run_record(self):
        # Release 20 went live at HEAD, but its deploy stopped before writing the record.
        X = "a" * 40
        logs = {"%s..%s" % (X, HEAD): log(("Search", ["89"]), ("Ring", ["74"])), "%s..%s" % (HEAD, SHA): SHIPPED}
        answer = (page(release(19, X, [87])), 0)
        self.launched(HEAD)
        self.deploy(FakeHost(self.config, releases=answer, logs=logs, line=[X, HEAD]), dry=True)
        plan = self.plan()
        self.assertEqual(plan["before"], [{"release": 20, "commit": HEAD, "previous": X, "items": [89, 74],
                                           "deployed_at": "2026-11-07T05:00:00-08:00", "measurements": None,
                                           "source": "backfill", "evidence": None}])
        self.assertEqual({key: plan["record"][key] for key in ("release", "previous", "items")},
                         {"release": 21, "previous": HEAD, "items": [88]})
        self.assertEqual(plan["latest_recorded"], 20)
        self.assertEqual(self.kills, [])

    def test_when_no_run_record_says_when_the_live_commit_went_live_the_deploy_needs_that_time(self):
        X = "a" * 40
        answer = (page(release(19, X, [87])), 0)
        host = FakeHost(self.config, releases=answer, logs={"%s..%s" % (X, HEAD): log()}, line=["d" * 40, X, HEAD])
        self.assertIn("name that time with --live-since", self.refused(host))
        self.launched("d" * 40)  # the server's run record names a commit before the latest record
        self.assertIn("name that time with --live-since", self.refused(host))
        self.deploy(host, dry=True, live_since="2026-11-07T04:00:00-08:00")
        self.assertEqual([(record["release"], record["deployed_at"]) for record in self.plan()["before"]],
                         [(20, "2026-11-07T04:00:00-08:00")])
        self.launched(HEAD)
        self.assertIn("--live-since is not needed", self.refused(host, live_since="2026-11-07T04:00:00-08:00"))
        self.assertIn("--live-since names when an unrecorded live commit went live",
                      self.refused(FakeHost(self.config), live_since="2026-11-07T04:00:00-08:00"))
        # The time it is given is checked like any record's.
        (self.instance / "run-server-03" / "launch.json").unlink()
        self.assertIn("the release record would be refused: deployed_at", self.refused(host, live_since="yesterday"))
        self.assertEqual(self.kills, [])

    def test_a_live_commit_that_does_not_follow_the_latest_record_stops_the_deploy(self):
        answer = (page(release(19, "a" * 40, [87])), 0)
        self.launched(HEAD)
        self.assertIn("does not follow", self.refused(FakeHost(self.config, releases=answer, others=["a" * 40])))
        self.assertEqual(self.kills, [])

    def test_an_instance_with_no_records_starts_from_the_records_the_repository_keeps(self):
        kept = [release(18, "1" * 40, [1, 4]), release(19, HEAD, [87, 2])]
        # Live code from before release records keeps none; the records kept at SHA name the live HEAD.
        host = FakeHost(self.config, keeps=False, kept=kept, line=["1" * 40, HEAD])
        self.deploy(host, dry=True)
        plan = self.plan()
        self.assertEqual((plan["before"], plan["record"]["release"], plan["latest_recorded"]), (kept, 20, 19))
        self.assertIn("would not follow the latest, 19", self.refused(FakeHost(self.config, keeps=False, kept=kept, line=["1" * 40, HEAD]), number=2))
        # An instance whose live commit the kept records do not reach starts from the number it is given.
        elsewhere = [release(18, "1" * 40, [1, 4]), release(19, "2" * 40, [87, 2])]
        self.assertIn("name this one's number with --release", self.refused(FakeHost(self.config, keeps=False, kept=elsewhere, others=["1" * 40, "2" * 40])))
        self.deploy(FakeHost(self.config, keeps=False, kept=elsewhere, others=["1" * 40, "2" * 40]), dry=True, number=1)
        self.assertEqual((self.plan()["before"], self.plan()["record"]["release"]), ([], 1))
        # A kept record that is not one, or names no number, stops the deploy.
        for broken, reason in ((dict(kept[1], items="87"), "is not one: items"), (dict(kept[1], release=None), "names no release number")):
            with self.subTest(reason):
                self.assertIn(reason, self.refused(FakeHost(self.config, keeps=False, kept=[kept[0], broken], line=["1" * 40, HEAD])))
        # Records already on the instance are not written again.
        host = FakeHost(self.config, kept=kept, line=["1" * 40, HEAD], releases=(page(*reversed(kept)), 0))
        self.deploy(host, dry=True)
        self.assertEqual((self.plan()["before"], self.plan()["record"]["release"]), ([], 20))
        self.assertEqual(self.kills, [])

    def test_an_item_an_earlier_release_shipped_stops_the_deploy_before_anything_stops(self):
        host = FakeHost(self.config, releases=(page(release(19, HEAD, [88])), 0))
        self.assertIn("pipeline item 88 shipped in release 19; release 20 names it again", self.refused(host))
        kept = [release(18, "1" * 40, [88]), release(19, HEAD, [87])]
        self.assertIn("pipeline item 88 shipped in release 18; release 20 names it again",
                      self.refused(FakeHost(self.config, keeps=False, kept=kept, line=["1" * 40, HEAD])))
        X = "a" * 40
        self.launched(HEAD)
        recovered = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD],
                             logs={"%s..%s" % (X, HEAD): log(("Again", ["87"]))})
        self.assertIn("pipeline item 87 shipped in release 19; release 20 names it again", self.refused(recovered))
        self.assertEqual(self.kills, [])

    def started(self, *runs):
        """Server run records after run-server-03, one per (commit, time), as the deploys that started them wrote them."""
        for number, (revision, at) in enumerate(runs, 4):
            run = self.instance / ("run-server-%02d" % number)
            run.mkdir()
            (run / "launch.json").write_text(json.dumps({"at": at, "revision": revision}))
            (run / "pid.json").write_text(json.dumps({"pid": 111}))

    def summarised(self):
        return [(record["release"], record["commit"], record["previous"], record["items"], record["deployed_at"])
                for record in self.plan()["before"]]

    def test_the_records_the_repository_keeps_fill_in_what_the_instance_lacks_and_continue_from_them(self):
        X, Y = "a" * 40, "e" * 40
        # Release 18 was recorded by hand; release 19's command was refused, or never run.
        kept = [release(18, X, [1, 4]), release(19, HEAD, [87, 2])]
        self.planned(FakeHost(self.config, kept=kept, releases=(page(kept[0]), 0), line=[X, HEAD]))
        self.assertEqual((self.plan()["before"], self.plan()["record"]["release"]), ([kept[1]], 20))
        # Only 19 was recorded by hand: 18 is written, below it.
        self.planned(FakeHost(self.config, kept=kept, releases=(page(kept[1]), 0), line=[X, HEAD]))
        self.assertEqual((self.plan()["before"], self.plan()["record"]["release"]), ([kept[0]], 20))
        # Then release 20 went live and its record was refused: it follows 19, from its own commits and first start.
        kept = [release(18, X, [1, 4]), release(19, Y, [87, 2])]
        self.started((Y, "2026-11-06T05:28:11-08:00"), (HEAD, "2026-11-07T05:00:00-08:00"))
        logs = {"%s..%s" % (Y, HEAD): log(("Release 20's change", ["88"])),
                "%s..%s" % (X, HEAD): log(("Release 19's change", ["87"]), ("Release 20's change", ["88"])),
                "%s..%s" % (HEAD, SHA): log(("Release 21's change", ["89"]))}
        self.planned(FakeHost(self.config, kept=kept, releases=(page(kept[0]), 0), line=[X, Y, HEAD], logs=logs))
        self.assertEqual(self.plan()["before"][0], kept[1])
        self.assertEqual(self.summarised()[1:], [(20, HEAD, Y, [88], "2026-11-07T05:00:00-08:00")])
        self.assertEqual({key: self.plan()["record"][key] for key in ("release", "items")}, {"release": 21, "items": [89]})
        self.assertEqual(self.kills, [])

    def test_each_commit_a_server_started_after_the_latest_record_is_a_release_of_its_own(self):
        # Releases 20 and 21 went live and neither verified; each server was restarted at its own commit.
        W, X, R = "9" * 40, "a" * 40, "d" * 40
        self.started((W, "2026-11-04T10:00:00-08:00"), (X, "2026-11-05T10:00:00-08:00"), (R, "2026-11-06T10:00:00-08:00"),
                     (R, "2026-11-06T11:00:00-08:00"), (HEAD, "2026-11-07T10:00:00-08:00"), (HEAD, "2026-11-07T12:00:00-08:00"))
        logs = {"%s..%s" % (X, R): log(("Twenty", ["89"])), "%s..%s" % (R, HEAD): log(("Twenty-one", ["74"])),
                "%s..%s" % (X, HEAD): log(("Twenty", ["89"]), ("Twenty-one", ["74"])), "%s..%s" % (HEAD, SHA): SHIPPED}
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[W, X, R, HEAD], logs=logs)
        self.planned(host)
        self.assertEqual(self.summarised(), [(20, R, X, [89], "2026-11-06T10:00:00-08:00"),
                                             (21, HEAD, R, [74], "2026-11-07T10:00:00-08:00")])
        self.assertEqual((self.plan()["record"]["release"], self.plan()["latest_recorded"]), (22, 21))
        # A commit no run record started, between them, is not a release: the next start at a later commit includes it.
        self.assertEqual(self.kills, [])

    def test_a_live_commit_no_run_record_started_takes_the_time_it_is_given_and_only_it_does(self):
        X, R = "a" * 40, "d" * 40
        self.started((R, "2026-11-06T10:00:00-08:00"))
        logs = {"%s..%s" % (X, R): log(("Twenty", ["89"])), "%s..%s" % (R, HEAD): log(("Twenty-one", ["74"])),
                "%s..%s" % (HEAD, SHA): SHIPPED}
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, R, HEAD], logs=logs)
        self.assertIn("name that time with --live-since, and the deploy records it as release 21", self.refused(host))
        self.planned(host, live_since="2026-11-07T04:00:00-08:00")
        self.assertEqual(self.summarised(), [(20, R, X, [89], "2026-11-06T10:00:00-08:00"),
                                             (21, HEAD, R, [74], "2026-11-07T04:00:00-08:00")])
        self.assertEqual(self.kills, [])

    def test_records_and_run_records_off_the_instances_line_stop_the_deploy_before_anything_stops(self):
        X, Y, Z = "a" * 40, "e" * 40, "f" * 40
        live = (page(release(19, HEAD, [87]), release(18, X, [1])), 0)
        cases = (
            # The repository keeps another commit under a number the instance records.
            ("keeps release 18 at %s" % Y[:12], dict(kept=[release(18, Y, [1]), release(19, HEAD, [87])], releases=live,
                                                    line=[X, Y, HEAD])),
            # A kept record that leaves a number out.
            ("numbered 18, 20", dict(kept=[release(18, X, [1]), release(20, HEAD, [87])], releases=(page(release(18, X, [1])), 0),
                                     line=[X, HEAD])),
            # A kept record whose commit comes before the release under it.
            ("release 19 at %s does not come after release 18" % Y[:12],
             dict(kept=[release(18, X, [1]), release(19, Y, [87])], releases=(page(release(18, X, [1])), 0), line=[Y, X, HEAD])),
            # A kept record the live commit does not include.
            ("does not follow %s" % Z[:12], dict(kept=[release(18, X, [1]), release(19, Z, [87])],
                                                releases=(page(release(18, X, [1])), 0), line=[X, HEAD, Z])))
        for reason, setup in cases:
            with self.subTest(reason):
                self.assertIn(reason, self.refused(FakeHost(self.config, **setup)))
        # A server run record at a commit off the line from the latest record to the live HEAD.
        self.started((Z, "2026-11-06T10:00:00-08:00"), (HEAD, "2026-11-07T10:00:00-08:00"))
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD], others=[Z],
                        logs={"%s..%s" % (X, HEAD): log(("Twenty", ["89"]))})
        self.assertIn("a server run record started %s" % Z[:12], self.refused(host))
        # Run records that start a commit after one it comes before.
        for run in (self.instance / "run-server-04", self.instance / "run-server-05"):
            for name in ("launch.json", "pid.json"):
                (run / name).unlink()
            run.rmdir()
        self.started((HEAD, "2026-11-06T10:00:00-08:00"), (Y, "2026-11-07T10:00:00-08:00"))
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, Y, HEAD],
                        logs={"%s..%s" % (X, Y): log(("Twenty", ["89"]))})
        self.assertIn("after %s, which it comes before" % HEAD[:12], self.refused(host))
        self.assertEqual(self.kills, [])

    def test_records_the_repository_keeps_for_another_instance_are_not_this_ones(self):
        # This instance numbers its own releases from 1; the kept records share none of them.
        kept = [release(18, "1" * 40, [1, 4]), release(19, "2" * 40, [87, 2])]
        host = FakeHost(self.config, kept=kept, releases=(page(release(1, HEAD, [5])), 0), others=["1" * 40, "2" * 40])
        self.planned(host)
        self.assertEqual((self.plan()["before"], self.plan()["record"]["release"]), ([], 2))

    def test_a_commit_git_cannot_read_or_a_run_record_that_cannot_be_read_stops_the_deploy(self):
        # Kept records whose commits the live checkout lacks are not therefore another instance's.
        kept = [release(18, "1" * 40, [1, 4]), release(19, "2" * 40, [87, 2])]
        self.assertIn("whether 222222222222 comes before %s could not be read" % HEAD[:12],
                      self.refused(FakeHost(self.config, keeps=False, kept=kept)))
        X = "a" * 40
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD])
        launch = self.instance / "run-server-03" / "launch.json"
        for text, reason in (("not json", "could not be read"), ('{"at": "2026-11-07T05:00:00-08:00"}', "does not say which commit"),
                             ('["%s"]' % HEAD, "does not say which commit")):
            with self.subTest(text):
                launch.write_text(text)
                self.assertIn("the run record %s %s" % (launch, reason), self.refused(host))
        self.assertEqual(self.kills, [])

    def test_live_records_that_cannot_be_read_stop_the_deploy_rather_than_count_as_none(self):
        for answer in (("", 1), ('{"instance_id":"i-1","error":{"code":"DATABASE_BUSY"}}\n', 75), ("not json\n", 0),
                       (page(19) + '{"instance_id":"i-1","error":{"code":"DATABASE_BUSY"}}\n', 75),
                       ('{"instance_id":"i-1","items":[{"release":19}],"next_cursor":null}\n', 0), (page(19), 1)):
            with self.subTest(answer):
                host = FakeHost(self.config, releases=answer)
                self.assertIn("could not be read", self.refused(host, number=20))
                self.assertEqual(self.kills, [])

    def test_whether_the_live_code_keeps_records_that_git_cannot_say_stops_the_deploy(self):
        self.assertIn("whether the live code keeps release records could not be read",
                      self.refused(FakeHost(self.config, keeps=None), number=20))
        # Code that does not keep them is read as keeping none, and never asked for them.
        host = FakeHost(self.config, keeps=False)
        self.planned(host, number=20)
        self.assertEqual(host.ran("releases"), [])
        self.assertEqual(self.kills, [])

    def test_kept_records_or_commits_that_git_cannot_list_stop_the_deploy(self):
        self.assertIn("the release records kept at %s could not be listed" % SHA[:12],
                      self.refused(FakeHost(self.config, listed=128)))
        unread = {"%s..%s" % (HEAD, SHA): ("", 128)}
        for no_items in (False, True):
            with self.subTest(no_items=no_items):
                self.assertIn("the commits from %s to %s could not be read" % (HEAD, SHA),
                              self.refused(FakeHost(self.config, logs=unread), no_items=no_items))
        # A release recovered from its run record names its items from git, too.
        X = "a" * 40
        self.launched(HEAD)
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD],
                        logs={"%s..%s" % (X, HEAD): ("", 128)})
        self.assertIn("the commits from %s to %s could not be read" % (X, HEAD), self.refused(host))
        self.assertEqual(self.kills, [])

    def test_live_since_without_a_record_that_places_the_live_commit_is_refused(self):
        self.assertIn("no record places %s" % HEAD[:12],
                      self.refused(FakeHost(self.config, keeps=False), number=20, live_since="2026-11-07T04:00:00-08:00"))
        self.assertEqual(self.kills, [])

    def restarting(self):
        """The release check's summary for the live HEAD, the commit a restart deploys."""
        self.summary.write_text(json.dumps(summary(commit=HEAD)))
        return {"%s..%s" % (HEAD, HEAD): log()}

    def test_a_deploy_of_the_live_commit_is_a_restart_that_writes_no_record_of_its_own(self):
        logs = self.restarting()
        for given in ({}, {"no_items": True}):
            with self.subTest(given):
                self.planned(FakeHost(self.config, logs=logs), sha=HEAD, **given)
                plan = self.plan()
                self.assertEqual((plan["record"], plan["before"], plan["restart_of"], plan["latest_recorded"]),
                                 (None, [], 19, 19))
        # The records the instance lacks are still written; the restart adds none.
        kept = [release(18, "1" * 40, [1, 4]), release(19, HEAD, [87, 2])]
        self.planned(FakeHost(self.config, keeps=False, kept=kept, at=HEAD, line=["1" * 40, HEAD], logs=logs), sha=HEAD)
        self.assertEqual((self.plan()["record"], self.plan()["before"], self.plan()["restart_of"]), (None, kept, 19))
        # Nothing records the live commit: still a restart, and it needs no number.
        self.planned(FakeHost(self.config, keeps=False, logs=logs), sha=HEAD)
        self.assertEqual((self.plan()["record"], self.plan()["restart_of"]), (None, None))
        self.assertIn("a deploy of the live commit restarts release 19 and writes no record of its own",
                      self.refused(FakeHost(self.config, logs=logs), sha=HEAD, number=20))
        self.assertEqual(self.kills, [])

    def test_a_deploy_run_again_after_its_release_went_live_unverified_records_that_release_once(self):
        # Release 20 went live at HEAD and did not verify; the deploy is run again at the same commit.
        X = "a" * 40
        logs = dict(self.restarting(), **{"%s..%s" % (X, HEAD): log(("Twenty", ["89"]))})
        self.launched(HEAD)
        self.planned(FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD], logs=logs), sha=HEAD)
        plan = self.plan()
        self.assertEqual(self.summarised(), [(20, HEAD, X, [89], "2026-11-07T05:00:00-08:00")])
        self.assertEqual((plan["record"], plan["restart_of"], plan["latest_recorded"]), (None, 20, 20))
        self.assertEqual(self.kills, [])

    def test_a_commit_already_recorded_as_another_release_stops_the_deploy_before_anything_stops(self):
        X, Y = "a" * 40, "e" * 40
        # The instance records the commit being deployed under an earlier number.
        host = FakeHost(self.config, releases=(page(release(20, HEAD, [87]), release(19, SHA, [1])), 0))
        self.assertIn("%s is release 19 and release 21; a commit is one release" % SHA[:12], self.refused(host))
        # The repository keeps two numbers at one commit.
        self.launched(HEAD)
        kept = [release(18, X, [1]), release(19, X, [4])]
        host = FakeHost(self.config, kept=kept, releases=(page(kept[0]), 0), line=[X, HEAD],
                        logs={"%s..%s" % (X, HEAD): log(("Twenty", ["89"]))})
        self.assertIn("%s is release 18 and release 19" % X[:12], self.refused(host))
        # It keeps a number at a commit the instance records under another.
        kept = [release(18, X, [1]), release(19, Y, [4])]
        host = FakeHost(self.config, kept=kept, releases=(page(release(20, Y, [87]), kept[0]), 0), line=[X, Y, HEAD],
                        logs={"%s..%s" % (Y, HEAD): log(("Twenty-one", ["89"]))})
        self.assertIn("%s is release 19 and release 20" % Y[:12], self.refused(host))
        self.assertEqual(self.kills, [])


# Stand-ins for bin/aim-next-server and bin/aim-next-runner: each prints its first line as the real one does
# (the server only after binding --port) and then stays up until it is signalled.
STUB_SERVER = """import http.server, json, sys
port = int(sys.argv[sys.argv.index("--port") + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(%(root)d if self.path == "/" else 200)
        self.end_headers()
        self.wfile.write(json.dumps({"stub": %(nonce)r, "path": self.path}).encode())
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(("127.0.0.1", port), Handler)
print(json.dumps({"status": %(status)r, "argv": sys.argv[1:]}), flush=True)
server.serve_forever()
"""
STUB_RUNNER = """import json, signal, sys
print(json.dumps({"event": %(event)r, "argv": sys.argv[1:]}), flush=True)
signal.pause()
"""


class Restarting(DeployCase):
    """The deploy past migrate: real stand-in server and runner processes on a free loopback port.

    ps, git, the backup, the migration and the CLI are still answered by FakeHost, and every
    process the deploy starts is stopped by the PID start() returned."""

    def setUp(self):
        super().setUp()
        self.started = []
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.assertNotEqual(self.port, 5192)  # unlike the constant the old script had
        self.raw["port"] = self.port
        self.config_path.write_text(json.dumps(self.raw))
        self.config = deploy.load_config(self.config_path)
        self.nonce = os.urandom(8).hex()
        self.stubs()

    def stubs(self, status="ready", event="acquired", root=200):
        (self.config.live / "bin").mkdir(parents=True, exist_ok=True)
        (self.config.live / "bin/aim-next-server").write_text(STUB_SERVER % {"nonce": self.nonce, "status": status,
                                                                             "root": root})
        (self.config.live / "bin/aim-next-runner").write_text(STUB_RUNNER % {"event": event})

    def tearDown(self):
        for proc in self.started:
            proc.kill()
            proc.wait()
        super().tearDown()

    def run_deploy(self, host, sha=SHA):
        real_start, real_urlopen, opened = deploy.start, deploy.urllib.request.urlopen, []

        def start(*args):
            proc = real_start(*args)
            self.started.append(proc)
            return proc

        def urlopen(url):
            # Only the stand-in server: a wrong port must fail here, never reach a live server.
            opened.append(url)
            self.assertTrue(url.startswith("http://127.0.0.1:%d/" % self.port), url)
            return real_urlopen(url)

        with mock.patch.object(deploy, "run", host), \
                mock.patch.object(deploy.os, "kill", lambda pid, sig: self.kills.append((pid, sig))), \
                mock.patch.object(deploy, "wait_exit", return_value="exited"), \
                mock.patch.object(deploy, "start", start), \
                mock.patch.object(deploy.urllib.request, "urlopen", urlopen), \
                redirect_stdout(io.StringIO()):
            deploy.deploy(self.config, sha, self.evidence, self.summary, False)
        return opened

    def completed(self, host, sha=SHA):
        """A deploy that must complete; a refusal fails the test rather than erroring it."""
        try:
            return self.run_deploy(host, sha=sha)
        except deploy.Refused as refusal:
            self.fail("the deploy refused: %s" % refusal)

    def first_line(self, run):
        return json.loads((self.instance / run / "stdout.log").read_text().splitlines()[0])


class FullDeploy(Restarting):
    def test_a_deploy_restarts_both_from_the_config_and_verifies_the_new_server(self):
        host = FakeHost(self.config)
        try:
            opened = self.run_deploy(host)
        except Exception as error:  # a refusal here is the failure under test, not an error
            self.fail("the deploy did not complete: %r" % error)
        self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout", "02-release", "03-stopped",
                                          "04-backup", "05-fast-forward", "06-migrate", "07-server", "09-runner",
                                          "10-verify", "11-release", "release-20"])
        self.assertEqual(self.kills, [(222, 15), (111, 15)])
        # The backup reads the server's profile, the one bound to the database.
        backup = host.ran("-c")[0][-1]
        self.assertIn(repr(str(self.config.server_profile)), backup)
        self.assertNotIn(str(self.config.runner_profile), backup)
        server, runner = self.started
        self.assertEqual(self.first_line("run-server-04")["argv"], deploy.server_argv(self.config)[3:])
        self.assertEqual(self.first_line("run-runner-03")["argv"], deploy.supervisor_argv(self.config)[3:])
        for run, proc in (("run-server-04", server), ("run-runner-03", runner)):
            self.assertEqual(json.loads((self.instance / run / "pid.json").read_text())["pid"], proc.pid)
            self.assertEqual(json.loads((self.instance / run / "launch.json").read_text())["revision"], SHA)
            # Each runs in its own session, so it outlives the deploy and the terminal it ran in.
            self.assertEqual(os.getsid(proc.pid), proc.pid)
        verify = json.loads((self.evidence / "10-verify.json").read_text())
        self.assertEqual((verify["root_status"], verify["server_alive"], verify["runner_alive"], verify["cli_exit"]),
                         (200, True, True, 0))
        self.assertIn(self.nonce, verify["bootstrap_head"])
        self.assertEqual(opened, ["http://127.0.0.1:%d/api/bootstrap" % self.port, "http://127.0.0.1:%d/" % self.port])

    def test_a_server_that_does_not_report_ready_stops_the_deploy_before_the_runner_starts(self):
        self.stubs(status="starting")
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(FakeHost(self.config))
        self.assertIn("did not report ready", str(caught.exception))
        self.assertEqual(len(self.started), 1)
        self.assertFalse((self.instance / "run-runner-03").exists())
        self.assertEqual(self.records()[-1], "07-server")

    def test_a_runner_that_does_not_acquire_its_guard_stops_the_deploy_before_the_verify(self):
        self.stubs(event="waiting")
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(FakeHost(self.config))
        self.assertIn("did not acquire its guard", str(caught.exception))
        self.assertEqual(len(self.started), 2)
        self.assertEqual(self.records()[-1], "09-runner")

    def test_a_verified_release_is_recorded_in_the_instance_and_the_evidence(self):
        host = FakeHost(self.config)
        before = datetime.datetime.now().astimezone()
        self.run_deploy(host)
        [written] = host.written
        self.assertEqual({key: written[key] for key in ("release", "commit", "previous", "items", "source", "evidence")},
                         {"release": 20, "commit": SHA, "previous": HEAD, "items": [88], "source": "deploy",
                          "evidence": str(self.evidence.resolve())})
        self.assertEqual(json.loads((self.evidence / "11-release.json").read_text())["records"], [written])
        # Written by the new code's admin verb, with the server's profile, after the verify read the new server.
        argv = host.ran("record-release")[0]
        self.assertEqual(argv[3:5], [str(self.config.live / "bin/aim-next-admin"), "record-release"])
        self.assertEqual(argv[argv.index("--profile") + 1], str(self.config.server_profile))
        order = [index for index, call in enumerate(host.calls) if call[-1] == "binding" or "record-release" in call]
        self.assertEqual([("record-release" in host.calls[index]) for index in order], [False, True])
        self.assertGreaterEqual(datetime.datetime.fromisoformat(written["deployed_at"]), before)

    def unverified(self, host):
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(host)
        message = str(caught.exception)
        self.assertIn("did not verify, so no release record was written", message)
        self.assertEqual(host.ran("record-release"), [])
        # It leaves the record and the command that writes it, for when the release is made to work by hand.
        kept = self.evidence / "release-20.json"
        self.assertEqual(json.loads(kept.read_text())["commit"], SHA)
        self.assertIn("%s is live; once it works, record it with: %s" % (SHA[:12], " ".join([
            self.config.python, "-I", "-B", str(self.config.live / "bin/aim-next-admin"), "record-release",
            "--profile", str(self.config.server_profile), "--record", str(kept.resolve())])), message)
        return json.loads((self.evidence / "10-verify.json").read_text())

    def test_a_release_whose_cli_fails_is_not_recorded(self):
        self.assertEqual(self.unverified(FakeHost(self.config, cli=2))["cli_exit"], 2)

    def test_a_release_whose_reader_does_not_answer_200_is_not_recorded(self):
        self.stubs(root=500)
        self.assertEqual(self.unverified(FakeHost(self.config))["root_status"], 500)

    def stop(self, index):
        """Stop a started stand-in by its captured PID and reap it, so the deploy's check sees it gone.

        The deploy's os.kill is a recorder during the run, so this signals with the real one."""
        REAL_KILL(self.started[index].pid, signal.SIGKILL)
        self.started[index].wait()

    def test_a_release_whose_server_stops_before_the_check_ends_is_not_recorded(self):
        verify = self.unverified(FakeHost(self.config, on_cli=lambda: self.stop(0)))
        self.assertEqual((verify["server_alive"], verify["runner_alive"], verify["cli_exit"]), (False, True, 0))

    def test_a_release_whose_runner_stops_before_the_check_ends_is_not_recorded(self):
        verify = self.unverified(FakeHost(self.config, on_cli=lambda: self.stop(1)))
        self.assertEqual((verify["server_alive"], verify["runner_alive"], verify["root_status"]), (True, False, 200))

    def test_the_records_the_instance_lacks_are_written_first_in_order(self):
        kept = [release(18, "1" * 40, [1, 4]), release(19, HEAD, [87, 2])]
        host = FakeHost(self.config, keeps=False, kept=kept, line=["1" * 40, HEAD])
        self.run_deploy(host)
        self.assertEqual([written["release"] for written in host.written], [18, 19, 20])
        self.assertEqual(host.written[:2], kept)
        self.assertEqual([write["exit"] for write in json.loads((self.evidence / "11-release.json").read_text())["writes"]],
                         [0, 0, 0])

    def test_when_a_record_is_refused_nothing_after_it_is_tried_and_every_command_left_is_given(self):
        kept = [release(18, "1" * 40, [1, 4]), release(19, HEAD, [87, 2])]
        host = FakeHost(self.config, keeps=False, kept=kept, recorded=2, line=["1" * 40, HEAD])
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(host)
        commands = [" ".join(argv) for argv in host.ran("record-release")]
        self.assertEqual(len(commands), 1)
        self.assertIn("release 20 is live but the record of release 18 was not written", str(caught.exception))
        self.assertIn(commands[0] + " && ", str(caught.exception))
        self.assertIn(str((self.evidence / "release-20.json").resolve()), str(caught.exception))

    def test_a_restart_of_the_live_release_writes_no_record(self):
        self.summary.write_text(json.dumps(summary(commit=HEAD)))
        logs = {"%s..%s" % (HEAD, HEAD): log()}
        host = FakeHost(self.config, logs=logs)
        self.completed(host, sha=HEAD)
        self.assertEqual((host.written, host.ran("record-release")), ([], []))
        self.assertEqual(json.loads((self.evidence / "11-release.json").read_text()), {"records": [], "writes": []})
        self.assertNotIn("release-20", self.records())

    def test_a_deploy_run_again_after_its_release_went_live_unverified_writes_that_record_once(self):
        # Release 20 went live at HEAD without its record; the deploy run again records it, and only it.
        self.summary.write_text(json.dumps(summary(commit=HEAD)))
        logs = {"%s..%s" % (HEAD, HEAD): log()}
        X = "a" * 40
        (self.instance / "run-server-03" / "launch.json").write_text(json.dumps({"at": "2026-11-07T05:00:00-08:00",
                                                                                "revision": HEAD}))
        host = FakeHost(self.config, releases=(page(release(19, X, [87])), 0), line=[X, HEAD],
                        logs=dict(logs, **{"%s..%s" % (X, HEAD): log(("Twenty", ["89"]))}))
        self.completed(host, sha=HEAD)
        self.assertEqual([(written["release"], written["commit"], written["items"], written["source"])
                          for written in host.written], [(20, HEAD, [89], "backfill")])

    def test_a_restart_that_does_not_verify_says_so_and_gives_no_record_command(self):
        self.summary.write_text(json.dumps(summary(commit=HEAD)))
        host = FakeHost(self.config, cli=2, logs={"%s..%s" % (HEAD, HEAD): log()})
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(host, sha=HEAD)
        self.assertIn("the restart of release 19 did not verify, so no release record was written: ", str(caught.exception))
        self.assertNotIn("record-release", str(caught.exception))
        self.assertNotIn("record it with", str(caught.exception), "no offer of commands when there are none")
        self.assertTrue(str(caught.exception).endswith("%s is live" % HEAD[:12]), str(caught.exception)[-120:])
        self.assertEqual(host.ran("record-release"), [])

    def test_a_record_the_instance_refuses_says_the_release_is_live_and_how_to_record_it(self):
        host = FakeHost(self.config, recorded=2)
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(host)
        message = str(caught.exception)
        self.assertIn("release 20 is live but the record of release 20 was not written", message)
        self.assertIn(" ".join(host.ran("record-release")[0]), message)
        self.assertEqual(json.loads((self.evidence / "11-release.json").read_text())["writes"][-1]["exit"], 2)


class DeployRefuses(DeployCase):
    def test_a_summary_that_is_not_of_this_commit_is_refused_before_anything_is_read(self):
        # 7.2 step 1: its counts do not describe this commit, so there is nothing to measure.
        cases = ((None, "no readable release-check summary"),
                 (summary(commit="d" * 40), "ran on " + "d" * 40),
                 (dict(summary(), tree_unchanged=False), "the checkout changed while the release check ran"))
        for written, reason in cases:
            with self.subTest(reason):
                if written is None:
                    self.summary.unlink()
                else:
                    self.summary.write_text(json.dumps(written))
                host = FakeHost(self.config)
                self.assertIn(reason, self.refused(host))
                self.assertEqual(host.calls, [])
                self.assertEqual(self.kills, [])
                self.assertEqual(self.records(), ["00-release-check"])
                self.assertFalse(json.loads((self.evidence / "00-release-check.json").read_text())["passed"])

    def test_a_summary_of_this_commit_that_did_not_pass_is_read_and_refused_before_anything_stops(self):
        # 7.2 steps 1 and 6: it goes on to be measured, and its refusal comes after the checks, before the plan.
        for written, reason in ((summary(failed=("native-colors",)), "native-colors failed"), (dict(summary(), passed=False), "did not pass")):
            with self.subTest(reason):
                self.summary.write_text(json.dumps(written))
                host = FakeHost(self.config)
                refusal = self.refused(host)
                self.assertIn("the release check has not passed for %s: " % SHA, refusal)
                self.assertIn(reason, refusal)
                self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout"])
                self.assertEqual((self.kills, host.ran("merge"), host.ran("-c")), ([], [], []))

    def test_a_passed_release_check_for_the_commit_lets_the_deploy_go_on(self):
        host = FakeHost(self.config, ff=False)
        self.assertIn("fast-forward", self.refused(host))
        self.assertTrue(json.loads((self.evidence / "00-release-check.json").read_text())["passed"])
        self.assertTrue(host.ran("ps"))

    def test_a_dry_run_shows_the_plan_but_still_fails_without_a_passed_release_check(self):
        self.summary.write_text(json.dumps(summary(failed=("node-units",))))
        host = FakeHost(self.config)
        self.assertIn("node-units failed", self.refused(host, dry=True))
        self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout"])
        self.assertEqual(self.kills, [])

    def test_only_a_full_commit_is_accepted(self):
        host = FakeHost(self.config)
        for sha in ("c" * 7, "C" * 40, "HEAD", ""):
            with self.subTest(sha):
                self.assertIn("full 40-character commit", self.refused(host, sha=sha))
        self.assertEqual(host.calls, [])

    def test_main_requires_the_release_check(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            deploy.main(["--config", str(self.config_path), SHA, str(self.evidence)])
        self.assertEqual(caught.exception.code, 2)


class FixTopicTitles(unittest.TestCase):
    """D15: a fix topic is named for what failed, from what the deploy knows, at the release N candidate."""

    def test_each_kind_of_worse_names_what_failed(self):
        checks = [dict(UNITS_CHECK, name="Browser checks"), {"check_id": "units-2", "name": "Unit checks", "kind": "pass", "source": "release-check:units"},
                  {"check_id": "wake", "name": "Wake time", "kind": "measure", "source": "release-check:wake-replay", "better": "lower"}]
        base = {"units": {"result": "passed", "value": 10}, "units-2": {"result": "passed", "value": 900}, "wake": {"result": "measured", "value": 13}}
        found = outcome_rules.regressions(checks, base, {"units": {"result": "failed", "value": 8, "detail": {"failed": {"native-live": ["one case", "two"],
                                                                                                                      "native-rail": ["three"]}}}})["worse"]
        named = {item["check_id"]: dict(item, name=next(c["name"] for c in checks if c["check_id"] == item["check_id"])) for item in found}
        title = lambda check_id: deploy.outcome_checks.fix_title(named[check_id], 23)
        self.assertEqual(title("units"), "\u201cone case\u201d and 2 more fail at the release 23 candidate")
        self.assertEqual(title("units-2"), "Unit checks did not run at the release 23 candidate")
        self.assertEqual(title("wake"), "Wake time did not run at the release 23 candidate")
        one = dict(named["units"], cases=["one case"])
        self.assertEqual(deploy.outcome_checks.fix_title(one, 23), "\u201cone case\u201d fails at the release 23 candidate")
        slower = {"check_id": "wake", "name": "Wake time", "kind": "failed", "why": "aim-ux got worse in every run"}
        self.assertEqual(deploy.outcome_checks.fix_title(slower, 23), "Wake time got worse at the release 23 candidate")
        fewer = {"check_id": "units-2", "name": "Unit checks", "kind": "fewer", "why": "800 passing, 900 at the live release"}
        self.assertEqual(deploy.outcome_checks.fix_title(fewer, 23), "Unit checks got worse at the release 23 candidate")


UNITS_CHECK = {"check_id": "units", "group_name": "Checks", "position": 1, "name": "Unit checks", "kind": "pass", "source": "release-check:units"}


def counted(python=600, node=300, commit=SHA):
    """A passed summary whose unit steps carry their counts, and its times, as the release check writes them."""
    written = summary(commit)
    for step in written["steps"]:
        tests = {"python-units": python, "node-units": node}.get(step["name"])
        if tests is not None:
            step["counts"] = {"tests": tests, "pass": tests}
    return dict(written, started_at="2026-11-07T05:00:00-08:00", finished_at="2026-11-07T05:20:00-08:00")


PIECE = {"id": "p-release-20", "release": 20, "stage": "checks"}


def live_view(units=900, coordinator="agent-a", allowances=(), reader="agent-b", fix_topic=None, piece=PIECE):
    return {"instance_id": "i-1", "workspace_id": "building-theseus", "reader": reader, "coordinator": coordinator,
            "members": ["agent-a", "agent-b"], "checks": [UNITS_CHECK],
            "live": {"run_id": "run-19", "commit": HEAD, "tools": {"release-check": "theseus-release-check"}},
            "readings": {"units": {"result": "passed", "value": units, "detail": {}}} if units is not None else {},
            "allowances": list(allowances), "fix_topics": {"units": fix_topic}, "candidate_release": 20, "release_piece": piece}


class ChecksHost(FakeHost):
    """FakeHost that also answers whether the live code keeps outcome checks, the live CLI's checks read, and record-checks."""

    def __init__(self, config, keeps_checks=True, checks=None, record_checks=0, refuse=(), **more):
        super().__init__(config, **more)
        # keeps_checks: whether the live checkout has aim_next/checks.py, None when git cannot say. checks: the
        # CLI's (stdout, exit) for `checks OUTCOME --live SHA`, as a list answered in turn; record_checks: its exit.
        # refuse: the reporter's writes (start, post, stage-note, enter-stage) Core refuses.
        self.keeps_checks, self.checks, self.record_checks, self.recorded_runs = keeps_checks, list(checks or []), record_checks, []
        self.refuse = set(refuse)

    def __call__(self, argv, **kw):
        if argv[0] == "git" and "ls-tree" in argv and argv[-1] == "aim_next/checks.py":
            self.calls.append(argv)
            out, code = ("aim_next/checks.py\n" if self.keeps_checks else "", 0) if self.keeps_checks is not None else ("", 128)
            return subprocess.CompletedProcess(argv, code, out, "fatal: not a git repository" if code else "")
        if "checks" in argv and "--live" in argv:
            self.calls.append(argv)
            out, code = self.checks.pop(0)
            return subprocess.CompletedProcess(argv, code, out, "" if code == 0 else "Traceback: something broke")
        if "record-checks" in argv:
            self.calls.append(argv)
            self.recorded_runs.append(json.loads(Path(argv[argv.index("--run") + 1]).read_text()))
            return subprocess.CompletedProcess(argv, self.record_checks, "{}\n" if self.record_checks == 0 else "",
                                               "" if self.record_checks == 0 else "NOT_FOUND")
        verb = argv[7] if len(argv) > 7 and argv[3] == str(self.config.live / "bin/aim-next") else None
        if verb in ("start", "post", "stage-note", "enter-stage"):
            self.calls.append(argv)
            if verb in self.refuse:
                return subprocess.CompletedProcess(argv, 2, '{"error":{"code":"STAGE_GATED","message":"no"}}\n', "")
            result = {"start": {"message_id": "m-1", "topic": {"id": "t-fix"}}, "post": {"message_id": "m-2", "topic": {"id": argv[8]}},
                      "stage-note": {"piece_id": argv[8]}, "enter-stage": {"piece_id": argv[8], "stage_id": argv[9], "round": 1}}[verb]
            return subprocess.CompletedProcess(argv, 0, json.dumps({"status": "committed", "result": result}) + "\n", "")
        return super().__call__(argv, **kw)

    def wrote(self, verb):
        """The reporter's writes of one verb, each from its verb on: [verb, args...]."""
        return [argv[7:] for argv in self.calls if len(argv) > 7 and argv[3] == str(self.config.live / "bin/aim-next") and argv[7] == verb]


class OutcomeChecksConfig(DeployCase):
    def test_the_outcome_and_the_profile_that_reads_it_go_together(self):
        for given in ({"outcome": "building-theseus"}, {"reporter_profile": "agent-b.profile.json"}):
            with self.subTest(given=given):
                self.config_path.write_text(json.dumps(dict(self.raw, **given)))
                with self.assertRaises(deploy.Refused):
                    deploy.load_config(self.config_path)
        self.config_path.write_text(json.dumps(dict(self.raw, outcome="building-theseus", reporter_profile="agent-b.profile.json")))
        config = deploy.load_config(self.config_path)
        self.assertEqual((config.outcome, config.reporter_profile), ("building-theseus", self.instance / "agent-b.profile.json"))
        self.assertIsNone(self.config.outcome, "without the keys the deploy measures no outcome")


class OutcomeChecksBeforeAnythingStops(DeployCase):
    """02-checks and 02-worse (items 12, 104): the candidate's readings beside the live release's, read through the live CLI."""

    def setUp(self):
        super().setUp()
        self.config_path.write_text(json.dumps(dict(self.raw, outcome="building-theseus", reporter_profile="agent-b.profile.json")))
        self.config = deploy.load_config(self.config_path)
        self.summary.write_text(json.dumps(counted()))

    def checks_read(self, host):
        return [argv for argv in host.calls if "checks" in argv and "--live" in argv]

    def planned(self, host, **release):
        """A dry run that must go on; a refusal or a crash fails the test rather than erroring it."""
        try:
            self.deploy(host, dry=True, **release)
        except Exception as error:  # the failure under test: anything but going on
            self.fail("the deploy did not go on: %r" % error)

    def test_a_live_release_that_keeps_no_checks_is_said_and_the_deploy_goes_on(self):
        host = ChecksHost(self.config, keeps_checks=False)
        self.planned(host)
        written = json.loads((self.evidence / "02-checks.json").read_text())
        self.assertEqual(written["checks"], "the live release keeps no outcome checks yet")
        self.assertEqual((written["run"]["commit"], written["run"]["readings"]), (SHA, []), "the run is kept in the evidence only")
        self.assertEqual(self.checks_read(host), [], "nothing to read, known from the live code, not from a failed read")
        self.assertEqual(host.ran("record-checks"), [])

    def test_a_checks_read_that_fails_stops_the_deploy_rather_than_counting_as_no_checks(self):
        for host, reason in ((ChecksHost(self.config, keeps_checks=None), "whether the live code keeps outcome checks could not be read"),
                             (ChecksHost(self.config, checks=[("", 1)]), "the live outcome's checks could not be read"),
                             (ChecksHost(self.config, checks=[('{"error":{"code":"FORBIDDEN"}}\n', 2)]), "FORBIDDEN")):
            with self.subTest(reason=reason):
                self.kills = []
                self.assertIn(reason, self.refused(host))
                self.assertEqual(self.kills, [])
                self.assertEqual(host.ran("merge") + host.ran("-c"), [])

    def test_the_read_is_the_live_cli_as_the_reporter_for_this_commit_and_a_dry_run_writes_nothing(self):
        host = ChecksHost(self.config, checks=[(json.dumps(live_view()) + "\n", 0)])
        self.planned(host)
        self.assertEqual(self.checks_read(host), [[self.config.python, "-I", "-B", str(self.config.live / "bin/aim-next"), "--profile",
                                                   str(self.instance / "agent-b.profile.json"), "--json", "checks", "building-theseus", "--live", SHA]])
        self.assertEqual(json.loads((self.evidence / "02-checks.json").read_text())["worse"], [])
        self.assertEqual(host.ran("record-checks") + host.wrote("start") + host.wrote("stage-note"), [])
        self.assertNotIn("02-run", self.records())

    def test_a_reporter_that_is_the_coordinator_or_not_a_member_is_refused_before_anything_is_written(self):
        # D27: Core never delivers a message to its own author, so the coordinator telling itself wakes nobody.
        for view, reason in ((live_view(units=1000, reader="agent-a"), "the reporter, agent-a, must be a member of building-theseus and not its coordinator"),
                             (live_view(units=1000, reader="outsider"), "the reporter, outsider, must be a member")):
            with self.subTest(reason=reason):
                host = ChecksHost(self.config, checks=[(json.dumps(view) + "\n", 0)])
                self.assertIn(reason, self.refused(host))
                self.assertEqual(host.ran("record-checks") + host.wrote("start") + host.wrote("post"), [])
                self.assertEqual((self.kills, host.ran("merge")), ([], []))
        self.planned(ChecksHost(self.config, checks=[(json.dumps(live_view()) + "\n", 0)]))

    def test_a_check_made_worse_opens_its_fix_topic_records_the_run_and_holds_the_release_before_the_refusal(self):
        host = ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000)) + "\n", 0)])
        reason = self.refused(host)
        self.assertTrue(reason.startswith("Unit checks got worse: "), reason)
        [start] = host.wrote("start")
        self.assertEqual(start[:-1], ["start", "building-theseus", "--title", "Unit checks got worse at the release 20 candidate",
                                      "--with", "agent-a", "--operation", "fix-units-" + SHA[:12]])
        self.assertIn("Evidence: %s" % self.summary.resolve(), start[-1])
        self.assertIn("Rename this topic to say what is wrong in your own words", start[-1])
        [argv] = host.ran("record-checks")
        self.assertEqual((argv[3], argv[argv.index("--profile") + 1], argv[argv.index("--as") + 1]),
                         (str(self.config.live / "bin/aim-next-admin"), str(self.config.server_profile), "agent-b"))
        [run] = host.recorded_runs
        self.assertEqual((run["outcome"], run["commit"], [(r["check_id"], r["value"], r.get("fix_topic_id")) for r in run["readings"]]),
                         ("building-theseus", SHA, [("units", 900, "t-fix")]))
        self.assertEqual(host.wrote("stage-note"), [["stage-note", "p-release-20", "Held: Unit checks got worse."]])
        other = ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000, piece=None)) + "\n", 0)])
        self.refused(other)
        self.assertEqual(other.wrote("stage-note"), [], "with no release piece open, nothing is held")
        writes = [index for index, argv in enumerate(host.calls) if "record-checks" in argv or argv[7:8] in (["start"], ["stage-note"])]
        self.assertEqual([("record-checks" in host.calls[index]) or host.calls[index][7] for index in writes], ["start", True, "stage-note"],
                         "the topic is opened before the run is written, and the piece is held after")
        self.assertEqual((self.kills, host.ran("merge"), host.ran("-c"), host.wrote("enter-stage")), ([], [], [], []))
        self.assertNotIn("02-release", self.records(), "nothing after the verdict")
        # A dry run says the same, and writes nothing.
        dry = ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000)) + "\n", 0)])
        self.assertEqual(self.refused(dry, dry=True), reason)
        self.assertEqual(dry.ran("record-checks") + dry.wrote("start") + dry.wrote("stage-note"), [])
        # What the owner allowed is not worse.
        allowed = {"check_id": "units", "kind": "fewer", "allowed_count": 900, "allowed_by": "owner", "commit_sha": None}
        self.planned(ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000, allowances=[allowed])) + "\n", 0)]))

    def test_a_check_with_an_open_fix_topic_is_told_there_and_once_for_its_commit(self):
        older = live_view(units=1000, fix_topic={"topic_id": "t-open", "commit": "d" * 40})
        host = ChecksHost(self.config, checks=[(json.dumps(older) + "\n", 0)])
        self.refused(host)
        self.assertEqual(host.wrote("start"), [])
        [post] = host.wrote("post")
        self.assertEqual(post[:-1], ["post", "t-open", "--tells", "agent-a", "--subject", "check:units", "--operation", "fix-post-units-" + SHA[:12]])
        self.assertNotIn("Rename this topic", post[-1])
        self.assertEqual([r.get("fix_topic_id") for r in host.recorded_runs[0]["readings"]], ["t-open"])
        # Its reading at this commit already names the topic: the deploy was run again, and tells nobody twice.
        again = ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000, fix_topic={"topic_id": "t-open", "commit": SHA})) + "\n", 0)])
        self.refused(again)
        self.assertEqual(again.wrote("start") + again.wrote("post"), [])
        self.assertEqual([r.get("fix_topic_id") for r in again.recorded_runs[0]["readings"]], ["t-open"])

    def test_a_summary_that_did_not_pass_is_recorded_as_measured_before_its_refusal(self):
        written = counted()
        for step in written["steps"]:
            if step["name"] == "native-colors":
                step.update(passed=False, exit=1)
        self.summary.write_text(json.dumps(dict(written, passed=False)))
        host = ChecksHost(self.config, checks=[(json.dumps(live_view()) + "\n", 0)])
        self.assertIn("the release check has not passed for %s: native-colors failed" % SHA, self.refused(host))
        self.assertEqual([r["check_id"] for r in host.recorded_runs[0]["readings"]], ["units"])
        self.assertEqual(host.wrote("stage-note"), [], "nothing got worse")
        # With something worse as well, the refusal names it first.
        worse = ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000)) + "\n", 0)])
        self.assertTrue(self.refused(worse).startswith("Unit checks got worse"))

    def restarted(self, host):
        """A deploy that must go on to its restart (here, a start that stops the test)."""
        with self.assertRaisesRegex(AssertionError, "must not start a process"):
            self.deploy(host)

    def test_the_release_moves_on_only_from_checks_whatever_number_it_was_read_as(self):
        for piece in (dict(PIECE, stage="deploy"), dict(PIECE, stage="combine"), None):
            with self.subTest(piece=piece):
                host = ChecksHost(self.config, checks=[(json.dumps(live_view(piece=piece)) + "\n", 0)])
                self.restarted(host)
                self.assertEqual(host.wrote("enter-stage"), [])
                self.assertIsNone(json.loads((self.evidence / "03-stage.json").read_text())["entered"])
        # Core named it the release; the number it was read as (here before the deploy writes a record the instance
        # lacked) is words, not a second test of which piece it is.
        for piece in (PIECE, dict(PIECE, release=21)):
            with self.subTest(piece=piece):
                host = ChecksHost(self.config, checks=[(json.dumps(live_view(piece=piece)) + "\n", 0)])
                self.restarted(host)
                self.assertEqual(host.wrote("enter-stage"), [["enter-stage", "p-release-20", "deploy", "--left", "passed"]])

    def test_a_run_or_a_write_that_is_refused_stops_the_deploy_before_anything_stops(self):
        for host, reason in ((ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000)) + "\n", 0)], record_checks=2),
                              "the candidate's run of the outcome's checks was not written"),
                             (ChecksHost(self.config, checks=[(json.dumps(live_view(units=1000)) + "\n", 0)], refuse={"start"}), "start was not written"),
                             (ChecksHost(self.config, checks=[(json.dumps(live_view()) + "\n", 0)], refuse={"enter-stage"}), "enter-stage was not written")):
            with self.subTest(reason=reason):
                self.assertIn(reason, self.refused(host))
                self.assertEqual((self.kills, host.ran("merge"), host.ran("-c")), ([], [], []))
        self.assertEqual(host.wrote("enter-stage"), [["enter-stage", "p-release-20", "deploy", "--left", "passed"]])


class OutcomeChecksWithTheRelease(Restarting):
    """02-run and 03-stage: the candidate's run is written, and the release piece enters deploy, before anything stops."""

    def setUp(self):
        super().setUp()
        self.config_path.write_text(json.dumps(dict(self.raw, outcome="building-theseus", reporter_profile="agent-b.profile.json")))
        self.config = deploy.load_config(self.config_path)
        self.summary.write_text(json.dumps(counted()))

    def test_the_run_is_written_and_the_release_piece_enters_deploy_before_anything_stops(self):
        host = ChecksHost(self.config, checks=[(json.dumps(live_view()) + "\n", 0)])
        self.completed(host)
        order = {name: [index for index, argv in enumerate(host.calls) if name in argv] for name in ("record-checks", "enter-stage", "-c", "record-release")}
        self.assertEqual([len(found) for found in order.values()], [1, 1, 1, 1])
        self.assertLess(order["record-checks"][0], order["enter-stage"][0])
        self.assertLess(order["enter-stage"][0], order["-c"][0], "the piece moves before anything stops (the backup follows the stop)")
        self.assertEqual(host.wrote("enter-stage"), [["enter-stage", "p-release-20", "deploy", "--left", "passed"]])
        self.assertEqual(json.loads((self.evidence / "03-stage.json").read_text())["entered"], "deploy")
        self.assertEqual(len([argv for argv in host.calls if "--live" in argv]), 1, "nothing is read or written once the release is live")
        self.assertNotIn("12-checks", self.records())


NATIVE_CHECK = {"check_id": "browser-checks", "group_name": "Checks", "position": 2, "name": "Browser checks", "kind": "pass",
                "source": "release-check:native"}
WAKE_CHECK = {"check_id": "wake-time", "group_name": "Measures", "position": 3, "name": "Wake time", "kind": "measure",
              "source": "release-check:wake-replay", "unit": "s", "better": "lower", "target_value": 10, "tolerance": 0.2, "repeats": 2}
CASE = "a new arrival keeps your place while you write"


class Started(Exception):
    """The deploy reached its restart: everything before the stop went on."""


class TheDeployAgainstAStore(test_agent_cli.AgentCLIBase):
    """7.2 steps 1 to 9 through the real agent CLI and admin verb into a real store (D15, D27, D31, D35): outcome w1 with
    owner "owner", coordinator agent-a and reporter agent-b; release 22 live at HEAD; release 23's piece combined with no
    commit, as Building Theseus's stages combine before the release commit exists, and moved on into checks."""

    on, add, stages = PipelineCase.on, PipelineCase.add, PipelineCase.stages

    def setUp(self):
        super().setUp()
        base = Path(self.temp.name).resolve()
        for name, pid, last in (("run-server-03", 111, None), ("run-runner-02", 222, '{"status": "stopped"}')):
            (base / name).mkdir()
            (base / name / "pid.json").write_text(json.dumps({"pid": pid}))
            if last:
                (base / name / "stdout.log").write_text('{"event": "acquired"}\n' + last + "\n")
        config = {"live": str(base / "live"), "instance": str(base), "server_profile": "agent-a.json", "port": 5192,
                  "runner_profile": "runner.json", "runner_id": "runner-01", "routes": "routes.json", "outcome": "w1", "reporter_profile": "agent-b.json"}
        (base / "deploy.json").write_text(json.dumps(config))
        self.config, self.evidence, self.summary = deploy.load_config(base / "deploy.json"), base / "evidence", base / "summary.json"
        for check in (UNITS_CHECK, NATIVE_CHECK):
            self.define(check)
        self.assertTrue(self.store.record_release({"release": 22, "commit": HEAD, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [],
                                                   "source": "backfill"})["recorded"])
        self.store.record_checks({"outcome": "w1", "commit": HEAD, "started_at": "2026-11-06T04:00:00-08:00", "finished_at": "2026-11-06T04:15:00-08:00",
                                  "tools": {"release-check": release_check.TOOL}, "steps": [], "note": "", "readings": [
                                      {"check_id": "units", "result": "passed", "value": 900, "words": "900"},
                                      {"check_id": "browser-checks", "result": "passed", "value": 10 * len(release_check.NATIVE_STEPS), "words": "all"}]},
                                 "agent-a")
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"}, {"stage_id": "wait", "name": "Wait"},
                    {"stage_id": "combine", "name": "Combine", "scope": "release"},
                    {"stage_id": "checks", "name": "Browser checks", "scope": "release", "rounds": "together", "gate": {"checks": ["units", "browser-checks"]}},
                    {"stage_id": "deploy", "name": "Deploy", "scope": "release"})
        numbers = [self.add("Item %d" % n, section="now", size="small") for n in (1, 2)]
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": numbers, "topic_id": "t1", "stage_id": "build"}, {"workspace_id": "w1"}))
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "wait", "left_outcome": "approved"}, {"piece_id": piece["piece_id"]}))
        self.release = self.committed(self.command("pipeline.combine", {"release_number": 23, "piece_ids": [piece["piece_id"]], "topic_id": "t1"},
                                                   {"workspace_id": "w1"}))["piece_id"]
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "checks", "left_outcome": "passed"}, {"piece_id": self.release}))
        self.kills = []

    def revision(self):
        return self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["relevant_versions"]["checks"]

    def define(self, check):
        self.committed(self.command("check.define", {"check": check}, {"workspace_id": "w1"}, {"checks_revision": self.revision()}, actor="agent-a"))

    def write_summary(self, failed=(), wake=None):
        """counted(), with ten browser cases a step (one failing in each step named), and a wake replay (runs now, runs at the base) when given."""
        written = counted()
        for step in written["steps"]:
            if step["name"].startswith("native-"):
                broken = step["name"] in failed
                step.update(passed=not broken, exit=int(broken), counts={"tests": 10, "pass": 9 if broken else 10, **({"failed": [CASE]} if broken else {})})
        if wake:
            replay = lambda runs: {"name": "wake-replay", "passed": True, "series": {"aim-ux": {"runs": runs, "median": sorted(runs)[len(runs) // 2]}}}
            written["steps"].append(replay(wake[0]))
            written["base"] = {"commit": HEAD, "tools": {"release-check": release_check.TOOL}, "steps": [replay(wake[1])]}
        self.summary.write_text(json.dumps(dict(written, passed=not failed)))

    def deploy(self):
        """The deploy's answer, through the real CLI (as the reporter) and admin verb; ps, git and the release records from FakeHost."""
        fallback = ChecksHost(self.config, releases=(page(22), 0), log=log(("Items one and two", ["1", "2"])))
        live_cli, admin_cli = str(self.config.live / "bin/aim-next"), str(self.config.live / "bin/aim-next-admin")

        def run(argv, **kw):
            if len(argv) > 4 and (argv[3] == live_cli and "releases" not in argv or argv[3:5] == [admin_cli, "record-checks"]):
                out, err = io.StringIO(), io.StringIO()
                if argv[3] == live_cli:
                    code = cli.main(argv[4:], stdin=io.BytesIO(b""), stdout=out, stderr=err)
                else:
                    code = admin.main(argv[4:], stdout=out, stderr=err)
                return subprocess.CompletedProcess(argv, code, out.getvalue(), err.getvalue())
            return fallback(argv, **kw)
        with mock.patch.object(deploy, "run", run), \
                mock.patch.object(deploy.os, "kill", lambda pid, sig: self.kills.append((pid, sig))), \
                mock.patch.object(deploy, "wait_exit", return_value="exited"), \
                mock.patch.object(deploy, "start", side_effect=Started), \
                redirect_stdout(io.StringIO()):
            try:
                deploy.deploy(self.config, SHA, self.evidence, self.summary, False)
            except deploy.Refused as refusal:
                return str(refusal)
            except Started:
                return "restarting"
        self.fail("the deploy neither refused nor reached its restart")

    def candidate(self):
        return self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["loop"]["candidate"]

    def stage(self):
        return self.sql("SELECT stage_id,entered_by FROM pipeline_stage_entries WHERE piece_id=? AND left_ms IS NULL", (self.release,))[0]

    def test_a_failing_browser_case_holds_the_release_with_its_fix_topic_and_its_items_can_go_back_to_building(self):
        # Mockup 14's "A check fails": a summary that did not pass is measured, told and recorded before the refusal.
        self.write_summary(failed=("native-live",))
        topics = self.sql("SELECT count(*) FROM topics")[0][0]
        self.assertEqual(self.deploy(), "Browser checks got worse: a passing check now fails")
        [(topic, title, creator)] = self.sql("SELECT id,title,creator_id FROM topics WHERE kind='topic' AND id NOT IN ('t1')")
        self.assertEqual((title, creator), ("“%s” fails at the release 23 candidate" % CASE, "agent-b"))
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? ORDER BY actor_id", (topic,)), [("agent-a",), ("agent-b",)])
        candidate = self.candidate()
        self.assertEqual((candidate["label"], candidate["state"], [(item["check_id"], item["fix_topic"]["id"]) for item in candidate["worse"]]),
                         ("Release 23 candidate", "stopped", [("browser-checks", topic)]))
        self.assertEqual(self.sql("SELECT note FROM pipeline_stage_entries WHERE piece_id=? AND left_ms IS NULL", (self.release,)),
                         [("Held: Browser checks got worse.",)])
        self.assertEqual(self.kills, [])
        # Run again for the same commit, it finds the same run and topic and tells nobody twice.
        messages = self.sql("SELECT count(*) FROM messages WHERE topic_id=?", (topic,))
        self.assertEqual(self.deploy(), "Browser checks got worse: a passing check now fails")
        self.assertEqual((self.sql("SELECT count(*) FROM topics")[0][0], self.sql("SELECT count(*) FROM messages WHERE topic_id=?", (topic,))),
                         (topics + 1, messages))
        self.assertEqual(self.stage(), ("checks", "owner"), "held in checks")
        # D35: the owner takes the cause's item back to building, in the fix topic.
        back = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": topic, "stage_id": "build", "from_release": True},
                                           {"workspace_id": "w1"}))
        self.assertEqual(back["numbers"], [1])
        self.assertEqual(self.sql("SELECT number,left_reason FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (self.release,)),
                         [(1, "returned"), (2, None)])
        # The candidate lists the items still in the release; the one taken back is named under "after".
        candidate = self.candidate()
        self.assertEqual((candidate["items"], [item["number"] for item in candidate["after"]["returned"]]), ([2], [1]))

    def test_the_release_checks_report_enters_the_next_round_of_checks_and_shows_its_running_steps(self):
        # 7.1 --report through the real agent CLI (D35, D36): already in checks, the piece enters round 2, held.
        reporter = release_check.Reporter(str(Path(cli.__file__).resolve().parents[1] / "bin" / "aim-next"), str(self.profiles["agent-b"]), "w1", "d" * 40)
        self.evidence.mkdir()
        with redirect_stderr(io.StringIO()) as err:
            reporter.start(2)
            reporter.note([], {"name": "python-units", "since_ms": 1}, self.evidence)
        self.assertEqual(err.getvalue(), "")
        self.assertEqual(self.sql("SELECT stage_id,round,left_outcome FROM pipeline_stage_entries WHERE piece_id=? ORDER BY entered_ms,round",
                                  (self.release,))[-2:], [("checks", 1, "held"), ("checks", 2, None)])
        candidate = self.candidate()
        self.assertEqual((candidate["state"], candidate["commit"], [(step["name"], step["state"]) for step in candidate["steps"]][:1]),
                         ("running", "d" * 40, [("python-units", "running")]))
        landed = {"name": "python-units", "tool": "unittest", "passed": True, "counts": {"tests": 600, "pass": 600},
                  "started_at": "2026-11-07T08:00:00-08:00", "finished_at": "2026-11-07T08:01:00-08:00"}
        with redirect_stderr(io.StringIO()):
            reporter.note([landed], {"name": "node-units", "since_ms": 2}, self.evidence)
        steps = [(step["name"], step["state"]) for step in self.candidate()["steps"]]
        self.assertEqual(steps[:2], [("python-units", "landed"), ("node-units", "running")])

    def test_a_replay_measured_beside_code_that_is_not_live_is_refused_before_anything_is_told_or_stopped(self):
        self.define(WAKE_CHECK)
        topics = self.sql("SELECT count(*) FROM topics")
        for base in ("e" * 40, None):
            with self.subTest(base=base):
                self.write_summary(wake=([20.0, 21.0], [13.0, 13.4]))
                written = json.loads(self.summary.read_text())
                if base is None:
                    del written["base"]
                else:
                    written["base"]["commit"] = base
                self.summary.write_text(json.dumps(written))
                self.assertEqual(self.deploy(), "the replay was measured beside %s, but release 22 (%s) is live; run the release check again; "
                                 "nothing was stopped" % (base[:12] if base else "nothing (the summary has no base)", HEAD[:12]))
                self.assertEqual((self.kills, self.sql("SELECT count(*) FROM topics"), self.sql("SELECT count(*) FROM check_runs WHERE commit_sha=?", (SHA,))),
                                 ([], topics, [(0,)]))
        # Beside the live head, the same replay is measured (and here it got worse).
        self.write_summary(wake=([20.0, 21.0], [13.0, 13.4]))
        self.assertEqual(self.deploy(), "Wake time got worse: aim-ux got worse in every run")

    def test_a_worse_measure_the_owner_accepts_lets_the_same_commit_go_on_into_deploy(self):
        self.define(WAKE_CHECK)
        self.write_summary(wake=([20.0, 21.0], [13.0, 13.4]))
        self.assertEqual(self.deploy(), "Wake time got worse: aim-ux got worse in every run")
        candidate = self.candidate()
        self.assertEqual((candidate["state"], candidate["you_accept"], candidate["tools_same_as_base"]), ("stopped", True, True))
        [(title,)] = self.sql("SELECT title FROM topics WHERE kind='topic' AND id NOT IN ('t1')")
        self.assertEqual(title, "Wake time got worse at the release 23 candidate")
        # D31: only on the owner's own word.
        self.committed(self.command("check.accept_worse", {"run_id": candidate["run_id"], "why": "Worth it for the faster wakes"},
                                    {"workspace_id": "w1", "check_id": "wake-time"}, {"checks_revision": self.revision()}, actor="owner"))
        self.assertEqual(self.deploy(), "restarting")
        self.assertEqual(self.candidate()["state"], "accepted")
        self.assertEqual(self.sql("SELECT count(*) FROM check_runs WHERE commit_sha=? AND base_for_commit IS NULL", (SHA,)), [(1,)], "the same run")
        self.assertEqual(self.stage(), ("deploy", "agent-b"))
        self.assertEqual(self.sql("SELECT left_outcome,left_by FROM pipeline_stage_entries WHERE piece_id=? AND stage_id='checks'", (self.release,)),
                         [("passed", "agent-b")])
        self.assertEqual([pid for pid, _ in self.kills], [222, 111], "then everything stops, as before")

    def test_without_a_run_at_its_commit_the_release_piece_cannot_leave_checks(self):
        # The gate reads the release piece's own readings (D18); the deploy's 02-run is what writes them.
        self.rejected(self.command("pipeline.stage_enter", {"stage_id": "deploy", "left_outcome": "passed"}, {"piece_id": self.release}, actor="agent-b"),
                      "STAGE_GATED")
        self.write_summary()
        self.assertEqual(self.deploy(), "restarting")
        self.assertEqual(self.stage(), ("deploy", "agent-b"))
        self.assertEqual(json.loads((self.evidence / "03-stage.json").read_text())["entered"], "deploy")

    def recorded(self, commit, units="passed", base=None, at="2026-11-07T04:00:00-08:00"):
        """A release-check run of the outcome recorded as the deploy's 02-run records one, with its base rerun when given."""
        run = {"outcome": "w1", "commit": commit, "started_at": at, "finished_at": at, "tools": {"release-check": release_check.TOOL},
               "steps": [], "note": "", "readings": [{"check_id": "units", "result": units, "value": 900, "words": "900"},
                                                      {"check_id": "browser-checks", "result": "passed", "value": 10, "words": "all"}]}
        if base:
            run["base"] = dict(run, commit=HEAD, readings=[dict(reading, result=base) for reading in run["readings"]])
        return self.store.record_checks(run, "agent-b")

    def move_on(self, actor="agent-a"):
        return self.command("pipeline.stage_enter", {"stage_id": "deploy", "left_outcome": "passed"}, {"piece_id": self.release}, actor=actor)

    def test_the_release_piece_reads_its_own_candidates_and_nothing_else(self):
        # A base rerun that passed and a run of the live release's commit are not this release's readings.
        self.recorded(SHA, units="failed", base="passed")
        self.recorded(HEAD, at="2026-11-07T04:30:00-08:00")
        self.rejected(self.move_on(), "STAGE_GATED")
        # Whatever commit the candidate is, its passing run is what the gate reads: no commit was named at combine.
        self.recorded("d" * 40, at="2026-11-07T05:00:00-08:00")
        self.committed(self.move_on())
        self.assertEqual(self.stage(), ("deploy", "agent-a"))

    def test_a_new_commit_after_a_stop_is_checked_and_shipped_as_the_release(self):
        # D35: the first candidate stopped; its cause goes back to building; the next commit is checked and goes on.
        older = "d" * 40
        self.recorded(older, units="failed")
        self.assertEqual((self.candidate()["commit"], self.candidate()["state"]), (older, "stopped"))
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-fix", "title": "Fix", "participants": ["agent-a"],
                                                     "body": "Unit checks failed", "attachments": []}, {"opening_id": "o-fix"}, {"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, {"opening_id": "o-fix"}, {"opening_revision": 1}))
        self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t-fix", "stage_id": "build", "from_release": True},
                                    {"workspace_id": "w1"}, actor="agent-a"))
        self.assertEqual(self.sql("SELECT number,left_reason FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (self.release,)),
                         [(1, "returned"), (2, None)])
        self.write_summary()
        self.assertEqual(self.deploy(), "restarting")
        self.assertEqual((self.candidate()["commit"], self.candidate()["state"]), (SHA, "passed"))
        self.assertEqual(self.stage(), ("deploy", "agent-b"))
        # What shipped is the item still in it; the one taken back has not shipped, and is not what keeps the release open.
        self.assertTrue(self.store.record_release({"release": 23, "commit": SHA, "deployed_at": "2026-11-07T09:00:00-08:00", "items": [2],
                                                   "source": "deploy"})["recorded"])
        view = self.store.view("agent-b", "outcome_live", {"workspace_id": "w1", "commit": SHA})
        self.assertEqual((view["release_piece"], view["candidate_release"]), (None, 24))

    def topic_of_w1(self, topic, workspace="w1"):
        self.committed(self.command("opening.save", {"workspace_id": workspace, "topic_id": topic, "title": "Work " + topic, "participants": ["agent-a"],
                                                     "body": "work", "attachments": []}, {"opening_id": "o-" + topic}, {"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, {"opening_id": "o-" + topic}, {"opening_revision": 1}))
        return topic

    def approved(self, numbers, topic, workspace="w1", **args):
        """A piece of these items started in topic and approved, waiting to be combined."""
        piece = self.committed(self.command("pipeline.piece_start", dict({"numbers": list(numbers), "topic_id": topic, "stage_id": "build"}, **args),
                                            {"workspace_id": workspace}, actor="agent-a"))["piece_id"]
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "wait", "left_outcome": "approved"}, {"piece_id": piece}))
        return piece

    def combine(self, pieces, workspace="w1", **args):
        return self.command("pipeline.combine", dict({"piece_ids": list(pieces), "topic_id": "t1" if workspace == "w1" else "t-w2"}, **args),
                            {"workspace_id": workspace})

    def live_view(self, workspace="w1"):
        return self.store.view("agent-b", "outcome_live", {"workspace_id": workspace, "commit": SHA})

    def open_entry(self, piece):
        return self.sql("SELECT stage_id FROM pipeline_stage_entries WHERE piece_id=? AND left_ms IS NULL", (piece,))

    def test_a_stopped_release_whose_items_all_go_back_is_put_together_again_as_the_same_release(self):
        # The emptied piece used to stay the release: the rebuilt work was refused as 23, combined as 24, and the deploy
        # moved the empty piece into deploy. Every item going back ends the release, and a number is spent only by a record.
        self.recorded("d" * 40, units="failed")
        rebuilt = self.approved((1, 2), self.topic_of_w1("t-fix"), from_release=True)
        self.assertEqual(self.sql("SELECT stage_id,left_outcome,left_note FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq", (self.release,))[-1],
                         ("checks", "held", "Every item went back to building"))
        self.assertEqual((self.live_view()["candidate_release"], self.live_view()["release_piece"]), (23, None))
        self.assertIsNone(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"])
        again = self.committed(self.combine([rebuilt], release_number=23))
        self.assertEqual((again["release_number"], self.live_view()["release_piece"]["id"]), (23, again["piece_id"]))
        # The ended release's stopped run is not the new release's candidate, so nothing holds the new release.
        self.assertIsNone(self.candidate())
        self.rejected(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t-fix", "stage_id": "build", "from_release": True},
                                   {"workspace_id": "w1"}, actor="agent-a"), "RELEASE_NOT_HELD")
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"]["piece_id"], again["piece_id"])
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "checks", "left_outcome": "passed"}, {"piece_id": again["piece_id"]}))
        self.write_summary()
        self.assertEqual(self.deploy(), "restarting")
        self.assertEqual(json.loads((self.evidence / "03-stage.json").read_text())["piece"]["id"], again["piece_id"])
        self.assertEqual((self.open_entry(again["piece_id"]), self.open_entry(self.release)), ([("deploy",)], []))
        self.assertEqual((self.candidate()["label"], self.candidate()["items"], self.candidate()["state"]), ("Release 23 candidate", [1, 2], "passed"))

    def test_a_release_whose_items_are_all_dropped_ends_and_never_held_its_number(self):
        for number in (1, 2):
            version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=?", (number,))[0][0]
            self.committed(self.command("pipeline.item_move", {"section": "dropped", "underway_confirmed": True}, {"workspace_id": "w1", "number": number},
                                        {"item_revision": version}, actor="owner"))
        self.assertEqual((self.open_entry(self.release), self.live_view()["release_piece"]), ([], None))
        new = self.approved([self.add("Item 3", section="now", size="small")], self.topic_of_w1("t-new"))
        again = self.committed(self.combine([new], release_number=23))
        view = self.live_view()
        self.assertEqual((view["candidate_release"], view["release_piece"]["id"], view["release_piece"]["release"]), (23, again["piece_id"], 23))

    def test_the_next_release_is_combined_once_this_one_has_shipped(self):
        # One release at a time (3.4): work approved while release 23 is in checks waits, so the deploy, the Reporter
        # and the readings can only ever mean release 23's piece.
        waiting = self.approved([self.add("Item 3", section="now", size="small")], self.topic_of_w1("t-two"))
        refused = self.combine([waiting], release_number=24)
        self.rejected(refused, "RELEASE_OPEN")
        self.assertIn("Release 23 is still being put together (Browser checks)", refused["error"]["message"])
        self.assertEqual(self.open_entry(waiting), [("wait",)], "nothing was combined")
        self.rejected(self.combine([waiting]), "RELEASE_OPEN")
        self.write_summary()
        self.assertEqual(self.deploy(), "restarting")
        self.assertEqual((self.stage(), self.sql("SELECT DISTINCT piece_id FROM check_readings WHERE piece_id IS NOT NULL")),
                         (("deploy", "agent-b"), [(self.release,)]))
        self.assertTrue(self.store.record_release({"release": 23, "commit": SHA, "deployed_at": "2026-11-07T09:00:00-08:00", "items": [1, 2],
                                                   "source": "deploy"})["recorded"])
        self.assertEqual((self.live_view()["release_piece"], self.live_view()["candidate_release"]), (None, 24), "release 23 shipped")
        self.rejected(self.combine([waiting], release_number=23), "RELEASE_NUMBER")
        later = self.committed(self.combine([waiting]))
        self.assertEqual((later["release_number"], self.live_view()["release_piece"]["id"]), (24, later["piece_id"]))
        # Release 24 has no run of its own, so it cannot leave checks on release 23's readings.
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "checks", "left_outcome": "passed"}, {"piece_id": later["piece_id"]}))
        self.rejected(self.command("pipeline.stage_enter", {"stage_id": "deploy", "left_outcome": "passed"}, {"piece_id": later["piece_id"]},
                                   actor="agent-a"), "STAGE_GATED")

    def ship_naming(self, items):
        """Release 23 (items 1 and 2) passes its checks, the deploy moves it into deploy, and its record names these items."""
        self.write_summary()
        self.assertEqual(self.deploy(), "restarting")
        self.assertTrue(self.store.record_release({"release": 23, "commit": SHA, "deployed_at": "2026-11-07T09:00:00-08:00", "items": list(items),
                                                   "source": "deploy"})["recorded"])

    def assert_release_23_shipped(self):
        """Nothing reads release 23's piece as release 24, and the shipped piece moves no more."""
        view = self.live_view()
        self.assertEqual((view["release_piece"], view["candidate_release"]), (None, 24))
        self.assertIsNone(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"])
        self.assertIsNone(self.candidate())
        self.rejected(self.command("pipeline.stage_enter", {"stage_id": "checks", "left_outcome": "passed"}, {"piece_id": self.release}), "PIECE_CLOSED")
        self.rejected(self.command("pipeline.stage_note", {"note": "Release 24 starts"}, {"piece_id": self.release}), "PIECE_CLOSED")
        self.assertEqual(self.open_entry(self.release), [], "its record closed it")
        self.assertEqual(self.entries(self.release)[-1], ("deploy", "shipped", "Shipped in release 23"))

    def combined_as_24_and_gated(self, numbers):
        """The items the record left out went back to building when it was written, so they are built again, and release 24
        is checked on its own run."""
        later = self.committed(self.combine([self.approved(numbers, self.topic_of_w1("t-again"))]))
        self.assertEqual(self.sql("SELECT number,left_reason FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (self.release,)),
                         [(number, "returned" if number in numbers else None) for number in (1, 2)])
        self.assertEqual((later["release_number"], later["numbers"], self.live_view()["release_piece"]["id"]), (24, list(numbers), later["piece_id"]))
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "checks", "left_outcome": "passed"}, {"piece_id": later["piece_id"]}))
        self.rejected(self.command("pipeline.stage_enter", {"stage_id": "deploy", "left_outcome": "passed"}, {"piece_id": later["piece_id"]},
                                   actor="agent-a"), "STAGE_GATED")

    def test_a_release_whose_record_names_only_some_of_its_items_has_shipped(self):
        # A trailer that missed item 2: the deploy shipped release 23's commit, so release 23 has shipped. Its piece used to
        # stay "the release", read as release 24 with items 1 and 2, release 23's commit and readings, and could be moved
        # back into checks and on into deploy with no run of release 24.
        self.ship_naming([1])
        self.assert_release_23_shipped()
        self.combined_as_24_and_gated([2])

    def test_a_release_recorded_with_no_items_has_shipped(self):
        # deploy --no-items records release 23's commit and names no item.
        self.ship_naming([])
        self.assert_release_23_shipped()
        self.combined_as_24_and_gated([1, 2])

    def entries(self, piece):
        return self.sql("SELECT stage_id,left_outcome,left_note FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq", (piece,))

    def members(self, piece):
        return self.sql("SELECT number,left_reason FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (piece,))

    def record(self, number, commit, items, source="deploy", at="2026-11-07T09:00:00-08:00"):
        return self.store.record_release({"release": number, "commit": commit, "deployed_at": at, "items": list(items), "source": source})

    def start_of(self, numbers, topic):
        return self.command("pipeline.piece_start", {"numbers": list(numbers), "topic_id": self.topic_of_w1(topic), "stage_id": "build"},
                            {"workspace_id": "w1"}, actor="agent-a")

    def test_the_record_of_the_next_release_ships_the_release_whatever_commit_or_items_it_names(self):
        # 3.4: the release is the next release, so the record of that number ships it, from the stage it is in, even a
        # deploy of another commit naming none of its items; an item no record names has not shipped and goes back to building.
        self.recorded("d" * 40)
        self.assertTrue(self.record(23, "e" * 40, [])["recorded"])
        self.assertEqual((self.live_view()["release_piece"], self.live_view()["candidate_release"]), (None, 24))
        self.assertEqual((self.entries(self.release)[-1], self.members(self.release)),
                         (("checks", "shipped", "Shipped in release 23"), [(1, "returned"), (2, "returned")]))
        # Release 23 shares topic t1 with the piece of items 1 and 2, which went back to building, so t1 stays open.
        self.assertEqual(self.topics("t1"), [("t1", "active", "")])
        # The items it names stay in it; the rest go back.
        later = self.committed(self.combine([self.approved([1, 2], self.topic_of_w1("t-again"))], commit_sha="a" * 40))
        self.assertTrue(self.record(24, "f" * 40, [1], source="backfill")["recorded"])
        self.assertEqual((self.live_view()["release_piece"], self.entries(later["piece_id"])[-1], self.members(later["piece_id"])),
                         (None, ("combine", "shipped", "Shipped in release 24"), [(1, None), (2, "returned")]))
        # The same record written again is the record already there, and ends nothing.
        again = self.committed(self.combine([self.approved([2], self.topic_of_w1("t-four"))], commit_sha="a" * 40))
        self.assertFalse(self.record(24, "f" * 40, [1], source="backfill")["recorded"])
        self.assertEqual(self.live_view()["release_piece"], {"id": again["piece_id"], "release": 25, "stage": "combine", "round": 1})

    def test_a_record_of_an_older_release_ends_no_release_and_only_the_items_it_names_leave_it(self):
        # Release 5 recorded late (a backfill, or a deploy's kept or went-live record) names item 1: item 1 shipped in
        # release 5, so it leaves release 23, which stays open in its stage with item 2 and is still release 23.
        self.recorded("d" * 40)
        self.assertTrue(self.record(5, "e" * 40, [1], source="backfill", at="2026-10-01T09:00:00-07:00")["recorded"])
        self.assertEqual(self.live_view()["release_piece"], {"id": self.release, "release": 23, "stage": "checks", "round": 1})
        self.assertEqual((self.open_entry(self.release), self.members(self.release)), ([("checks",)], [(1, "returned"), (2, None)]))
        # Item 1's piece of work has finished, but its topic holds release 23, still under way, so it stays open.
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id='t1'"), [("active",)])
        # Item 1 shipped, so the candidate does not say it went back to building.
        self.assertIsNone(self.candidate()["after"])
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"]["items"], [2])
        # The record of release 23 then ships it with item 2.
        self.assertTrue(self.record(23, "d" * 40, [2])["recorded"])
        self.assertEqual((self.live_view()["release_piece"], self.entries(self.release)[-1], self.members(self.release)),
                         (None, ("checks", "shipped", "Shipped in release 23"), [(1, "returned"), (2, None)]))

    def test_an_item_a_record_names_is_never_built_again_whichever_record_named_it(self):
        # Within one deploy: release 23 went live without its record, so its record (items 1) is written first and ships
        # release 23, which sends item 2 back to building; the deploy's own record, release 24, then names item 2.
        self.assertTrue(self.record(23, "d" * 40, [1], source="backfill")["recorded"])
        self.assertTrue(self.record(24, SHA, [2])["recorded"])
        for number in (1, 2):
            refused = self.start_of([number], "t-again-%d" % number)
            self.rejected(refused, "ITEM_SHIPPED")
            self.assertIn("%d shipped in release %d" % (number, 22 + number), refused["error"]["message"])
        # One the records do not name is built as before.
        self.committed(self.start_of([self.add("Item 3", section="now", size="small")], "t-three"))

    def test_a_piece_whose_items_have_all_shipped_is_finished_and_its_topic_done(self):
        # 7.2 step 11 (D1): the record of release 23 names items 1 to 4. Release 23's own topic and the piece of item 3
        # are finished, "Shipped in release 23"; the piece of items 4 and 5 still builds item 5, so it and its topic stay
        # as they are, and so does the release piece of another outcome that does not ship in releases.
        three = self.committed(self.start_of([self.add("Item 3", section="now", size="small")], "t-three"))["piece_id"]
        four, five = (self.add("Item %d" % n, section="now", size="small") for n in (4, 5))
        both = self.committed(self.start_of([four, five], "t-45"))["piece_id"]
        # A topic someone already said is done keeps their word.
        six = self.committed(self.start_of([self.add("Item 6", section="now", size="small")], "t-six"))["piece_id"]
        version = self.store.view("agent-a", "topic", {"topic_id": "t-six"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done", "note": "Wrapped up early"}, {"topic_id": "t-six"}, {"topic_revision": version},
                                    actor="agent-a"))
        # The outcome's conversation never ends (docs/conversation.md), even when work done there ships.
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        seven = self.committed(self.command("pipeline.piece_start", {"numbers": [self.add("Item 7", section="now", size="small")],
                                                                     "topic_id": conversation, "stage_id": "build"}, {"workspace_id": "w1"}))["piece_id"]
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Another", "purpose": "", "team": ["agent-a"]}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w2"}, {"pipeline_revision": 0}))
        version = self.store.view("owner", "pipeline", {"workspace_id": "w2", "limit": 1})["pipeline"]["version"]
        self.committed(self.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}]}, {"workspace_id": "w2"},
                                    {"pipeline_revision": version}))
        theirs = [self.committed(self.command("pipeline.item_add", {"title": "Theirs %d" % n, "section": "now", "size": "small",
                                                                     "sources": [{"note": "a test"}]},
                                              {"workspace_id": "w2"}))["number"] for n in (1, 2, 3)]
        other = self.committed(self.command("pipeline.piece_start", {"numbers": theirs[2:], "topic_id": self.topic_of_w1("t-w2", workspace="w2"),
                                                                     "stage_id": "build"}, {"workspace_id": "w2"}, actor="agent-a"))["piece_id"]
        self.assertTrue(self.record(23, SHA, [1, 2, 3, 4, 6, 7])["recorded"])
        self.assertEqual((self.entries(seven)[-1], self.sql("SELECT state FROM topics WHERE id=?", (conversation,))),
                         (("build", "shipped", "Shipped in release 23"), [("active",)]))
        self.assertEqual((self.entries(three)[-1], self.entries(six)[-1], self.open_entry(both), self.open_entry(other)),
                         (("build", "shipped", "Shipped in release 23"), ("build", "shipped", "Shipped in release 23"), [("build",)], [("build",)]))
        self.assertEqual(self.sql("SELECT id,state,state_note,state_by FROM topics WHERE id IN ('t1','t-three','t-45','t-six','t-w2') ORDER BY id"),
                         [("t-45", "active", "", None), ("t-six", "done", "Wrapped up early", "agent-a"),
                          ("t-three", "done", "Shipped in release 23", None), ("t-w2", "active", "", None), ("t1", "done", "Shipped in release 23", None)])
        # Nothing reads an open piece as the release once it has shipped, and the other outcome builds its own item 1.
        self.assertEqual(self.live_view()["release_piece"], None)
        self.committed(self.command("pipeline.piece_start", {"numbers": theirs[:1], "topic_id": self.topic_of_w1("t-w2b", workspace="w2"),
                                                             "stage_id": "build"}, {"workspace_id": "w2"}, actor="agent-a"))

    def topics(self, *ids):
        return self.sql("SELECT id,state,state_note FROM topics WHERE id IN (%s) ORDER BY id" % ",".join("?" * len(ids)), ids)

    def release_24_from_its_own_topic(self, topic="t-24"):
        """Release 23 ships; then piece Q (items 3 and 4, in topic t-q) is approved and combined as release 24, in topic t-24
        (or in Q's own topic, as release 23 shares t1 with its piece)."""
        self.assertTrue(self.record(23, SHA, [1, 2])["recorded"])
        numbers = [self.add("Item %d" % n, section="now", size="small") for n in (3, 4)]
        self.assertEqual(numbers, [3, 4])
        piece = self.approved(numbers, self.topic_of_w1("t-q"))
        release = self.committed(self.combine([piece], release_number=24,
                                              topic_id=topic if topic == "t-q" else self.topic_of_w1(topic)))["piece_id"]
        return release

    def test_a_release_sharing_its_topic_with_a_piece_whose_item_went_back_leaves_that_topic_open(self):
        # 7.2 step 11 (D1): release 24 is put together in Q's own topic, t-q, and its record names only item 3. Release 24
        # has shipped, but item 4, combined from Q, went back to building, so Q's topic is not Done while item 4 is built there.
        release = self.release_24_from_its_own_topic("t-q")
        self.assertTrue(self.record(24, "a" * 40, [3])["recorded"])
        self.assertEqual((self.entries(release)[-1], self.members(release)), (("combine", "shipped", "Shipped in release 24"), [(3, None), (4, "returned")]))
        self.assertEqual(self.topics("t-q"), [("t-q", "active", "")])
        again = self.committed(self.command("pipeline.piece_start", {"numbers": [4], "topic_id": "t-q", "stage_id": "build"}, {"workspace_id": "w1"},
                                            actor="agent-a"))["piece_id"]
        self.assertEqual(self.topics("t-q"), [("t-q", "active", "")])
        self.assertTrue(self.record(25, "e" * 40, [4])["recorded"])
        self.assertEqual((self.entries(again)[-1], self.topics("t-q")), (("build", "shipped", "Shipped in release 25"), [("t-q", "done", "Shipped in release 25")]))

    def test_an_item_a_record_ships_from_a_piece_still_being_built_leaves_it_and_is_never_combined_again(self):
        # Item 3 is built in piece P with item 4 when the record of release 23 names it (a trailer on release 23's commit):
        # item 3 shipped in release 23, so it leaves P, which builds item 4 on, and combining P puts only item 4 in release 24.
        piece = self.committed(self.start_of([self.add("Item %d" % n, section="now", size="small") for n in (3, 4)], "t-p"))["piece_id"]
        self.ship_naming([1, 2, 3])
        self.assertEqual((self.members(piece), self.open_entry(piece), self.topics("t-p")), ([(3, "returned"), (4, None)], [("build",)], [("t-p", "active", "")]))
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "wait", "left_outcome": "approved"}, {"piece_id": piece}))
        later = self.committed(self.combine([piece]))
        self.assertEqual((later["release_number"], later["numbers"]), (24, [4]))
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"]["items"], [4])
        # Item 4 ships in release 24, and P with it.
        self.assertTrue(self.record(24, "a" * 40, [4])["recorded"])
        self.assertEqual(self.topics("t-p"), [("t-p", "done", "Shipped in release 24")])

    def test_a_piece_whose_combined_item_its_release_left_out_has_not_finished(self):
        # 7.2 step 11 (D1): items 3 and 4 left piece Q when it was combined, and release 24's record names only item 3, so
        # item 4 went back to building: Q has not shipped, and its topic stays open while item 4 is built there again.
        release = self.release_24_from_its_own_topic()
        self.assertTrue(self.record(24, "a" * 40, [3])["recorded"])
        self.assertEqual((self.entries(release)[-1], self.members(release)), (("combine", "shipped", "Shipped in release 24"), [(3, None), (4, "returned")]))
        self.assertEqual(self.topics("t-24", "t-q"), [("t-24", "done", "Shipped in release 24"), ("t-q", "active", "")])
        again = self.committed(self.command("pipeline.piece_start", {"numbers": [4], "topic_id": "t-q", "stage_id": "build"}, {"workspace_id": "w1"},
                                            actor="agent-a"))["piece_id"]
        self.assertEqual(self.topics("t-q"), [("t-q", "active", "")])
        # Once item 4 ships too, Q and the piece building item 4 are finished, and so is their topic.
        self.assertTrue(self.record(25, "e" * 40, [4])["recorded"])
        self.assertEqual((self.entries(again)[-1], self.topics("t-q")), (("build", "shipped", "Shipped in release 25"), [("t-q", "done", "Shipped in release 25")]))

    def test_a_piece_whose_combined_item_was_dropped_from_its_release_finishes_with_the_rest(self):
        # Item 4 was combined from Q into release 24 and dropped there, so it never ships: Q finishes when item 3 does.
        release = self.release_24_from_its_own_topic()
        version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=4")[0][0]
        self.committed(self.command("pipeline.item_move", {"section": "dropped", "underway_confirmed": True}, {"workspace_id": "w1", "number": 4},
                                    {"item_revision": version}, actor="owner"))
        self.assertEqual(self.members(release), [(3, None), (4, "dropped")])
        self.assertTrue(self.record(24, "a" * 40, [3])["recorded"])
        self.assertEqual(self.topics("t-24", "t-q"), [("t-24", "done", "Shipped in release 24"), ("t-q", "done", "Shipped in release 24")])

    def test_older_records_that_take_every_item_out_of_the_release_end_it_unshipped(self):
        # An older record ends no release (3.4): one naming item 3 leaves release 24 open with item 4, and Q, whose item 4 is
        # still in release 24, has not shipped. One naming item 4 then empties release 24, which ends as an emptied release
        # ends: not shipped, its topic open, and the work combined next is still release 24.
        release = self.release_24_from_its_own_topic()
        self.assertTrue(self.record(5, "a" * 40, [3], source="backfill", at="2026-10-01T09:00:00-07:00")["recorded"])
        self.assertEqual((self.open_entry(release), self.members(release)), ([("combine",)], [(3, "returned"), (4, None)]))
        self.assertEqual(self.live_view()["release_piece"], {"id": release, "release": 24, "stage": "combine", "round": 1})
        self.assertEqual(self.topics("t-24", "t-q"), [("t-24", "active", ""), ("t-q", "active", "")])
        self.assertTrue(self.record(6, "e" * 40, [4], source="backfill", at="2026-10-02T09:00:00-07:00")["recorded"])
        self.assertEqual((self.entries(release)[-1], self.members(release)), (("combine", "held", "Its last items shipped in release 6"),
                                                                              [(3, "returned"), (4, "returned")]))
        self.assertEqual((self.live_view()["release_piece"], self.live_view()["candidate_release"]), (None, 24))
        self.assertEqual(self.topics("t-24", "t-q"), [("t-24", "active", ""), ("t-q", "done", "Shipped in release 6")])
        new = self.approved([self.add("Item 5", section="now", size="small")], self.topic_of_w1("t-five"))
        self.assertEqual(self.committed(self.combine([new], topic_id="t-24"))["release_number"], 24)

    def test_an_older_record_naming_every_item_of_the_release_ends_it_unshipped(self):
        release = self.release_24_from_its_own_topic()
        self.assertTrue(self.record(5, "a" * 40, [3, 4], source="backfill", at="2026-10-01T09:00:00-07:00")["recorded"])
        self.assertEqual(self.entries(release)[-1], ("combine", "held", "Its last items shipped in release 5"))
        self.assertEqual((self.live_view()["release_piece"], self.live_view()["candidate_release"]), (None, 24))
        self.assertEqual(self.topics("t-24", "t-q"), [("t-24", "active", ""), ("t-q", "done", "Shipped in release 5")])

    # ---- the end of a piece is one rule over the facts, whatever order they come in (3.4, D1, D25) -------------------

    def in_every_order(self, facts, final):
        """{final(): [orders]}: the named facts applied to this same store in every order, each order from a copy of the
        store as it is now. A fact refused in some order fails the check, so every order applies the same facts."""
        before = Path(self.temp.name) / "before-the-facts.sqlite3"
        with closing(sqlite3.connect(str(self.path))) as db, closing(sqlite3.connect(str(before))) as copy:
            db.backup(copy)
        states = {}
        for order in itertools.permutations(sorted(facts)):
            with closing(sqlite3.connect(str(before))) as copy, closing(sqlite3.connect(str(self.path))) as db:
                copy.backup(db)
            for name in order:
                facts[name]()
            states.setdefault(final(), []).append(" > ".join(order))
        return states

    def assert_one_end(self, facts, final, expected):
        states = self.in_every_order(facts, final)
        self.assertEqual(list(states), [expected], "\n".join("%d orders end %r, e.g. %s" % (len(orders), state, orders[0])
                                                             for state, orders in states.items()))

    def drop(self, number):
        version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=?", (number,))[0][0]
        self.committed(self.command("pipeline.item_move", {"section": "dropped", "underway_confirmed": True}, {"workspace_id": "w1", "number": number},
                                    {"item_revision": version}, actor="owner"))

    def backfill(self, number, items):
        self.assertTrue(self.record(number, ("%x" % number) * 40, items, source="backfill", at="2026-10-0%dT09:00:00-07:00" % number)["recorded"])

    def end_of(self, piece, *topics):
        """A piece's end as the page reads it: its last stage entry, the items still in it, and its topics' states."""
        return (self.entries(piece)[-1], tuple(row[0] for row in self.sql("SELECT number FROM pipeline_piece_members WHERE piece_id=? "
                                                                          "AND left_ms IS NULL ORDER BY number", (piece,))), tuple(self.topics(*topics)))

    def test_a_piece_whose_last_item_is_dropped_after_its_other_item_shipped_has_shipped_whichever_came_first(self):
        # Reviewer's case A: piece P builds items 3 and 4 in t-p. Release 5, recorded late, names item 3, and item 4 is
        # dropped. Every item P held has shipped or left it and one shipped, so P has shipped and t-p is Done (D1), in
        # either order; the drop used to end P `dropped` by its own test and leave t-p open when it came last.
        piece = self.committed(self.start_of([self.add("Item %d" % n, section="now", size="small") for n in (3, 4)], "t-p"))["piece_id"]
        self.assert_one_end({"release 5 names 3": lambda: self.backfill(5, [3]), "drop 4": lambda: self.drop(4)},
                            lambda: self.end_of(piece, "t-p"),
                            (("build", "shipped", "Shipped in release 5"), (), (("t-p", "done", "Shipped in release 5"),)))

    def test_a_piece_whose_combined_item_is_dropped_after_its_release_shipped_finishes_whichever_came_first(self):
        # Reviewer's case B: release 24 holds items 3 and 4, combined from Q in t-q. Its record names item 3, and item 4 is
        # dropped: from the release, or after it went back to building. Either way Q's work has all shipped or left it.
        release = self.release_24_from_its_own_topic()
        self.assert_one_end({"release 24 names 3": lambda: self.assertTrue(self.record(24, "a" * 40, [3])["recorded"]),
                             "drop 4": lambda: self.drop(4)},
                            lambda: self.end_of(release, "t-24", "t-q"),
                            (("combine", "shipped", "Shipped in release 24"), (3,),
                             (("t-24", "done", "Shipped in release 24"), ("t-q", "done", "Shipped in release 24"))))

    def test_a_release_taken_apart_by_a_return_and_a_drop_ends_held_whichever_came_first(self):
        # D35 and D25 on one release: item 1 goes back to building and item 2 is dropped. The release ends held, saying
        # both, in either order (the last one used to decide it: `dropped`, or "Every item went back to building"), and
        # t1 stays open while item 1, combined from its piece there, is built again.
        self.recorded("d" * 40, units="failed")
        self.topic_of_w1("t-fix")
        back = lambda: self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t-fix", "stage_id": "build", "from_release": True},
                                                   {"workspace_id": "w1"}))
        self.assert_one_end({"return 1": back, "drop 2": lambda: self.drop(2)}, lambda: self.end_of(self.release, "t1"),
                            (("checks", "held", "Its items went back to building or were dropped"), (), (("t1", "active", ""),)))

    def test_the_end_of_a_piece_and_its_topic_is_one_state_whatever_order_records_drops_a_return_and_a_move_come_in(self):
        # Piece P builds items 3, 4 and 6 in t-p while release 23 (items 1 and 2) is held in checks. Releases 5 and 6,
        # recorded late, name items 3 and 6; item 4 is dropped; item 1 goes back to building from the release (D35); item 1
        # is moved below item 5 in Now. In all 120 orders P has shipped, "Shipped in release 6" (the newest record naming
        # one of its items), t-p is Done with it, the release stays open with item 2 and t1 stays open.
        self.recorded("d" * 40, units="failed")
        numbers = [self.add("Item %d" % n, section="now", size="small") for n in (3, 4, 5, 6)]
        self.assertEqual(numbers, [3, 4, 5, 6])
        piece = self.committed(self.start_of([3, 4, 6], "t-p"))["piece_id"]
        self.topic_of_w1("t-fix")

        def move():
            version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=1")[0][0]
            self.committed(self.command("pipeline.item_move", {"below": 5}, {"workspace_id": "w1", "number": 1}, {"item_revision": version}, actor="owner"))
        facts = {"release 5 names 3": lambda: self.backfill(5, [3]), "release 6 names 6": lambda: self.backfill(6, [6]), "drop 4": lambda: self.drop(4),
                 "return 1": lambda: self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t-fix", "stage_id": "build",
                                                                                          "from_release": True}, {"workspace_id": "w1"})),
                 "move 1": move}
        self.assert_one_end(facts, lambda: (self.end_of(piece, "t-p"), self.end_of(self.release, "t1")),
                            ((("build", "shipped", "Shipped in release 6"), (), (("t-p", "done", "Shipped in release 6"),)),
                             (("checks", None, ""), (2,), (("t1", "active", ""),))))

    def test_turning_releases_on_decides_what_shipped_as_a_record_would_whichever_came_first(self):
        # Out of releases, a record names nothing of the outcome's (docs/pipeline.md, "Not yet"): piece P builds items 3 and
        # 4 while release 24's record names item 3. Turning releases back on makes that record the outcome's: item 3 leaves
        # P as a record's items leave a piece under way, and once item 4 is dropped P has shipped, whether the drop comes
        # before the switch or after it.
        self.ship_naming([1, 2])
        self.committed(self.on(ships_in_releases=False))
        numbers = [self.add("Item %d" % n, section="now", size="small") for n in (3, 4)]
        self.assertTrue(self.record(24, "a" * 40, [3], source="backfill")["recorded"])
        piece = self.committed(self.start_of(numbers, "t-p"))["piece_id"]
        self.assert_one_end({"releases on": lambda: self.committed(self.on(ships_in_releases=True)), "drop 4": lambda: self.drop(4)},
                            lambda: self.end_of(piece, "t-p"),
                            (("build", "shipped", "Shipped in release 24"), (), (("t-p", "done", "Shipped in release 24"),)))

    def test_an_item_dropped_and_put_back_before_its_piece_was_combined_is_still_that_pieces_work(self):
        # Item 3 was dropped and put back before Q built it with item 4; Q is combined as release 24 in t-24. Release 5,
        # recorded late, ships item 4, but item 3 is still in release 24, so Q's topic stays open: only a drop since Q
        # handed an item on ends Q's part in it.
        self.ship_naming([1, 2])
        three, four = (self.add("Item %d" % n, section="now", size="small") for n in (3, 4))
        self.drop(three)
        version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=?", (three,))[0][0]
        self.committed(self.command("pipeline.item_move", {"section": "now"}, {"workspace_id": "w1", "number": three}, {"item_revision": version},
                                    actor="owner"))
        release = self.committed(self.combine([self.approved([three, four], self.topic_of_w1("t-q"))], topic_id=self.topic_of_w1("t-24")))["piece_id"]
        self.backfill(5, [four])
        self.assertEqual(self.end_of(release, "t-24", "t-q"), (("combine", None, ""), (three,), (("t-24", "active", ""), ("t-q", "active", ""))))

    def test_a_release_recorded_with_none_of_its_items_in_a_topic_of_its_own_closes_that_topic(self):
        # Release 24, put together in t-24 from Q's items 3 and 4, is recorded with no items: it has shipped, so t-24, where
        # nothing else is built, is Done; items 3 and 4 went back to building, so Q's topic is not.
        release = self.release_24_from_its_own_topic()
        self.assertTrue(self.record(24, "a" * 40, [])["recorded"])
        self.assertEqual(self.end_of(release, "t-24", "t-q"), (("combine", "shipped", "Shipped in release 24"), (),
                                                               (("t-24", "done", "Shipped in release 24"), ("t-q", "active", ""))))

    def test_a_topic_whose_only_piece_was_dropped_stays_open_whatever_ships_after(self):
        # A piece none of whose items shipped has not shipped: its topic is no one's to close (review follow-up M16).
        piece = self.committed(self.start_of([self.add("Item 3", section="now", size="small")], "t-d"))["piece_id"]
        self.drop(3)
        self.ship_naming([1, 2])
        self.assertEqual(self.end_of(piece, "t-d"), (("build", "dropped", ""), (), (("t-d", "active", ""),)))

    def test_a_topic_holding_the_open_release_stays_open_when_its_piece_of_work_ships(self):
        # P builds item 3 in t-p and release 24 is put together there too; release 5, recorded late, ships item 3, so P has
        # shipped, but t-p holds a release still under way (review follow-up M17).
        self.ship_naming([1, 2])
        piece = self.committed(self.start_of([self.add("Item 3", section="now", size="small")], "t-p"))["piece_id"]
        release = self.committed(self.combine([self.approved([self.add("Item 4", section="now", size="small")], self.topic_of_w1("t-q"))],
                                              topic_id="t-p"))["piece_id"]
        self.backfill(5, [3])
        self.assertEqual((self.end_of(piece, "t-p"), self.open_entry(release)),
                         ((("build", "shipped", "Shipped in release 5"), (), (("t-p", "active", ""),)), [("combine",)]))

    def test_release_pieces_release_23_numbered_ship_by_the_next_release_one_at_a_time(self):
        # Release 23's combine stored a number, and could combine release 24 while 23 was open. Upgraded, the earlier is the
        # release; the record of 23 ships it and release 24's piece becomes the release, which the record of 24 ships.
        waiting = self.approved([self.add("Item 3", section="now", size="small")], self.topic_of_w1("t-24"))
        ms = self.sql("SELECT max(entered_ms) FROM pipeline_stage_entries")[0][0] + 1
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE pipeline_pieces SET release_number=23 WHERE id=?", (self.release,))
            db.execute("UPDATE pipeline_stage_entries SET left_ms=?,left_outcome='combined',left_by='owner' WHERE piece_id=? AND left_ms IS NULL",
                       (ms, waiting))
            db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='combined' WHERE piece_id=?", (ms, waiting))
            db.execute("INSERT INTO pipeline_pieces VALUES ('p-release-24','w1','release','t-24',24,NULL,1)")
            db.execute("INSERT INTO pipeline_piece_members VALUES ('p-release-24','w1',3,NULL,NULL)")
            db.execute("INSERT INTO pipeline_stage_entries(piece_id,workspace_id,stage_id,round,entered_ms,entered_by) "
                       "VALUES ('p-release-24','w1','combine',1,?,'owner')", (ms,))
        self.assertEqual(self.live_view()["release_piece"], {"id": self.release, "release": 23, "stage": "checks", "round": 1})
        self.assertTrue(self.record(23, "d" * 40, [1, 2])["recorded"])
        self.assertEqual((self.entries(self.release)[-1], self.open_entry("p-release-24")),
                         (("checks", "shipped", "Shipped in release 23"), [("combine",)]))
        self.assertEqual(self.live_view()["release_piece"], {"id": "p-release-24", "release": 24, "stage": "combine", "round": 1})
        self.assertTrue(self.record(24, "e" * 40, [])["recorded"])
        self.assertEqual((self.entries("p-release-24")[-1], self.members("p-release-24"), self.live_view()["release_piece"]),
                         (("combine", "shipped", "Shipped in release 24"), [(3, "returned")], None))

    def test_a_release_combined_at_a_commit_already_recorded_is_still_being_put_together(self):
        # A record made before the release existed never ends it: release 23's own commit, given again at combine.
        self.ship_naming([1, 2])
        later = self.committed(self.combine([self.approved([self.add("Item 3", section="now", size="small")], self.topic_of_w1("t-c"))],
                                            commit_sha=SHA))
        self.assertEqual(self.live_view()["release_piece"], {"id": later["piece_id"], "release": 24, "stage": "combine", "round": 1})
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["facts"]["next_release"]["items"], [3])

    def test_an_item_that_shipped_stays_in_its_release_and_is_never_built_again(self):
        # Release 23 ships items 1 and 2. Item 1 is still in Now (shipped is never stored on the item).
        self.ship_naming([1, 2])
        three = self.add("Item 3", section="now", size="small")
        self.rejected(self.command("pipeline.piece_start", {"numbers": [1, three], "topic_id": self.topic_of_w1("t-b"), "stage_id": "build"},
                                   {"workspace_id": "w1"}, actor="agent-a"), "ITEM_SHIPPED")
        self.assertEqual(self.members(self.release), [(1, None), (2, None)], "what shipped in release 23 stays in it")
        shipped = self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "shipped"})["groups"]
        self.assertEqual([(group["label"], [item["number"] for item in group["items"]]) for group in shipped][:1], [("Release 23", [1, 2])])
        # Item 3 alone is release 24, and while it is open nothing else is combined.
        later = self.committed(self.combine([self.approved([three], "t-b")]))
        self.assertEqual((later["release_number"], self.live_view()["release_piece"]["id"]), (24, later["piece_id"]))
        self.rejected(self.combine([self.approved([self.add("Item 4", section="now", size="small")], self.topic_of_w1("t-b2"))]), "RELEASE_OPEN")

    def test_a_release_being_put_together_keeps_its_pipeline_on_and_shipping_in_releases(self):
        # Whether an item is in the release is a fact of the release, so the settings it depends on cannot change under it.
        refused = self.on(ships_in_releases=False)
        self.rejected(refused, "RELEASE_OPEN")
        self.assertIn("Release 23 is still being put together", refused["error"]["message"])
        self.rejected(self.on(actor="agent-a", enabled=False), "RELEASE_OPEN")
        # Dropping an item leaves it (D25), and a member cannot start a piece for an item still in it.
        version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=2")[0][0]
        self.committed(self.command("pipeline.item_move", {"section": "dropped", "underway_confirmed": True}, {"workspace_id": "w1", "number": 2},
                                    {"item_revision": version}, actor="owner"))
        self.assertEqual(self.members(self.release), [(1, None), (2, "dropped")])
        self.rejected(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": self.topic_of_w1("t-t"), "stage_id": "build"},
                                   {"workspace_id": "w1"}, actor="agent-b"), "ITEM_IN_PIECE")
        # Once it has shipped, the owner stops shipping in releases, and what it shipped stays as it was.
        self.recorded("d" * 40)
        self.assertTrue(self.store.record_release({"release": 23, "commit": "d" * 40, "deployed_at": "2026-11-07T09:00:00-08:00", "items": [1],
                                                   "source": "deploy"})["recorded"])
        self.committed(self.on(ships_in_releases=False))
        # Out of releases, item 1 no longer reads as shipped and can be dropped, but it stays in the release it shipped in.
        version = self.sql("SELECT version FROM pipeline_items WHERE workspace_id='w1' AND number=1")[0][0]
        self.committed(self.command("pipeline.item_move", {"section": "dropped"}, {"workspace_id": "w1", "number": 1}, {"item_revision": version},
                                    actor="owner"))
        self.committed(self.on(ships_in_releases=True))
        self.assertEqual((self.members(self.release), self.live_view()["release_piece"]), ([(1, None), (2, "dropped")], None))

    def test_the_gate_reads_the_release_at_its_own_commit(self):
        # D18: a check the newest candidate did not read is not passed by an older candidate's reading at another commit.
        self.recorded("d" * 40)
        self.store.record_checks({"outcome": "w1", "commit": "e" * 40, "started_at": "2026-11-07T05:00:00-08:00",
                                  "finished_at": "2026-11-07T05:00:00-08:00", "tools": {"release-check": release_check.TOOL}, "steps": [], "note": "",
                                  "readings": [{"check_id": "units", "result": "passed", "value": 900, "words": "900"}]}, "agent-b")
        self.rejected(self.move_on(), "STAGE_GATED")
        self.recorded("f" * 40, at="2026-11-07T06:00:00-08:00")
        self.committed(self.move_on())

    def test_a_worse_check_holds_the_release_and_only_its_items_go_back(self):
        waiting = self.approved([self.add("Item 3", section="now", size="small")], self.topic_of_w1("t-two"))
        self.write_summary(failed=("native-live",))
        self.assertEqual(self.deploy(), "Browser checks got worse: a passing check now fails")
        self.assertEqual(self.sql("SELECT note FROM pipeline_stage_entries WHERE left_ms IS NULL AND piece_id=?", (self.release,)),
                         [("Held: Browser checks got worse.",)])
        self.assertEqual(self.candidate()["label"], "Release 23 candidate")
        # D35: an item that is not in the release does not go back from it.
        self.rejected(self.command("pipeline.piece_start", {"numbers": [3], "topic_id": "t-two", "stage_id": "build", "from_release": True},
                                   {"workspace_id": "w1"}), "RELEASE_NOT_HELD")
        self.assertEqual(self.open_entry(waiting), [("wait",)])
        [(topic,)] = self.sql("SELECT id FROM topics WHERE kind='topic' AND id NOT IN ('t1','t-two')")
        self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": topic, "stage_id": "build", "from_release": True},
                                    {"workspace_id": "w1"}))

    def test_another_outcome_that_ships_in_releases_puts_its_own_release_together(self):
        # Releases are an outcome's: once w1's release 23 has shipped and w1 stops shipping in releases, w2 combines its own
        # release 24, and neither outcome reads the other's. (Release records name bare item numbers, so w2's items 1 and 2
        # read as the ones release 23 shipped: docs/pipeline.md, "Not yet"; w2 builds its item 3.)
        self.ship_naming([1, 2])
        self.committed(self.on(ships_in_releases=False))
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Another", "purpose": "", "team": ["agent-a", "agent-b"]}))
        self.committed(self.command("pipeline.configure", {"enabled": True, "ships_in_releases": True}, {"workspace_id": "w2"}, {"pipeline_revision": 0}))
        version = self.store.view("owner", "pipeline", {"workspace_id": "w2", "limit": 1})["pipeline"]["version"]
        self.committed(self.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}, {"stage_id": "wait", "name": "Wait"},
                                                                       {"stage_id": "combine", "name": "Combine", "scope": "release"}]},
                                    {"workspace_id": "w2"}, {"pipeline_revision": version}))
        numbers = [self.committed(self.command("pipeline.item_add", {"title": "Theirs %d" % n, "section": "now", "size": "small",
                                                                     "sources": [{"note": "a test"}]}, {"workspace_id": "w2"}))["number"] for n in range(3)]
        self.assertEqual(numbers, [1, 2, 3])
        self.topic_of_w1("t-w2", workspace="w2")
        theirs = self.committed(self.combine([self.approved(numbers[2:], "t-w2", workspace="w2")], workspace="w2", release_number=24))
        head = self.store.view("owner", "pipeline", {"workspace_id": "w2"})["facts"]["next_release"]
        self.assertEqual((head["piece_id"], head["release"], head["items"]), (theirs["piece_id"], 24, [3]))
        self.assertEqual(self.live_view("w2")["release_piece"], {"id": theirs["piece_id"], "release": 24, "stage": "combine", "round": 1})
        self.assertEqual((self.live_view()["release_piece"], self.members(self.release)), (None, [(1, None), (2, None)]), "w1 reads none")
        self.recorded("d" * 40)
        self.assertEqual(self.sql("SELECT count(*) FROM check_readings g JOIN check_runs u ON u.id=g.run_id WHERE u.commit_sha=? "
                                  "AND g.piece_id IS NOT NULL", ("d" * 40,)), [(0,)], "w1's run names no release")

    def test_a_trial_or_a_base_rerun_never_reads_for_a_release_piece(self):
        # D34: code with a suspect reverted is not the code being shipped, so its readings never gate the release.
        older = "d" * 40
        self.recorded(older, units="failed")
        readings = [{"check_id": "units", "result": "passed", "value": 900, "words": "900", "piece_id": self.release},
                    {"check_id": "browser-checks", "result": "passed", "value": 10, "words": "all", "piece_id": self.release}]
        trial = {"commit_sha": "e" * 40, "started_at": "2026-11-07T06:00:00-08:00", "finished_at": "2026-11-07T06:00:00-08:00", "tools": {},
                 "steps": [], "trial_of": older, "without": {"items": [1], "reverted": ["f" * 40]}}
        refused = self.command("check.report", {"run": trial, "readings": readings}, {"workspace_id": "w1"}, actor="agent-b")
        self.rejected(refused, "INVALID_ARGUMENT")
        self.assertIn("belong to no piece", refused["error"]["message"])
        base = dict(trial, commit_sha=HEAD, readings=readings)
        del base["trial_of"], base["without"]
        unpieced = [{key: value for key, value in reading.items() if key != "piece_id"} for reading in readings]
        refused = self.command("check.report", {"run": dict(trial, base=base), "readings": unpieced}, {"workspace_id": "w1"}, actor="agent-b")
        self.rejected(refused, "INVALID_ARGUMENT")
        self.assertIn("belong to no piece", refused["error"]["message"])
        with self.assertRaisesRegex(Exception, "belong to no piece"):
            self.store.record_checks({"outcome": "w1", "commit": "c" * 40, "started_at": "2026-11-07T06:30:00-08:00", "finished_at": "2026-11-07T06:30:00-08:00",
                                      "tools": {}, "steps": [], "note": "", "readings": [], "base": dict(base, commit=HEAD)}, "agent-b")
        self.rejected(self.move_on(), "STAGE_GATED")
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["release_piece"]["commit"], older)
        # The same trial without piece ids is recorded, as a trial.
        self.committed(self.command("check.report", {"run": dict(trial, base=dict(base, readings=unpieced)), "readings": unpieced},
                                    {"workspace_id": "w1"}, actor="agent-b"))
        self.rejected(self.move_on(), "STAGE_GATED")
        # Nor does a member's report of a reported check, nor a release check run that names a piece itself: here, one of
        # the live release's commit, which record_checks would never give the release's id.
        self.define({"check_id": "said", "group_name": "Checks", "position": 3, "name": "Said", "kind": "pass", "source": "reported"})
        report = {"commit_sha": "c" * 40, "started_at": "2026-11-07T07:00:00-08:00", "finished_at": "2026-11-07T07:00:00-08:00", "tools": {}, "steps": []}
        refused = self.command("check.report", {"run": report, "readings": [{"check_id": "said", "result": "passed", "words": "said", "piece_id": self.release}]},
                               {"workspace_id": "w1"}, actor="agent-b")
        self.rejected(refused, "INVALID_ARGUMENT")
        self.assertIn("belong to no release", refused["error"]["message"])
        with self.assertRaisesRegex(Exception, "leave piece_id out"):
            self.store.record_checks({"outcome": "w1", "commit": HEAD, "started_at": "2026-11-07T07:30:00-08:00", "finished_at": "2026-11-07T07:30:00-08:00",
                                      "tools": {}, "steps": [], "note": "", "readings": [dict(reading, piece_id=self.release) for reading in unpieced]}, "agent-b")
        self.rejected(self.move_on(), "STAGE_GATED")
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["release_piece"]["commit"], older)


if __name__ == "__main__":
    unittest.main()

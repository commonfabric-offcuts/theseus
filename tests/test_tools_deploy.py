from __future__ import annotations

import datetime
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import deploy, release_check

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

    def __init__(self, config, servers=(111,), runners=(222,), dirty="", ff=True, backup=0, merge=0, migrate=0,
                 log=SHIPPED, keeps=True, releases=(page(19), 0), cli=0, recorded=0, on_cli=None, logs=None,
                 kept=(), listed=0, at=SHA, line=(HEAD,), others=()):
        self.config, self.calls = config, []
        self.servers, self.runners = list(servers), list(runners)
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
            out = "".join("%d %s\n" % (pid, server) for pid in self.servers)
            out += "".join("%d %s\n" % (pid, runner) for pid in self.runners)
            out += "333 /usr/bin/python3 -I unrelated\n"
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


class FullDeploy(DeployCase):
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
        self.assertEqual(self.first_line("run-runner-03")["argv"], deploy.runner_argv(self.config)[3:])
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
        self.assertEqual(host.ran("record-release"), [])

    def test_a_record_the_instance_refuses_says_the_release_is_live_and_how_to_record_it(self):
        host = FakeHost(self.config, recorded=2)
        with self.assertRaises(deploy.Refused) as caught:
            self.run_deploy(host)
        message = str(caught.exception)
        self.assertIn("release 20 is live but the record of release 20 was not written", message)
        self.assertIn(" ".join(host.ran("record-release")[0]), message)
        self.assertEqual(json.loads((self.evidence / "11-release.json").read_text())["writes"][-1]["exit"], 2)


class ReleaseCheckGate(DeployCase):
    def test_without_a_passed_release_check_for_the_commit_nothing_is_read_or_stopped(self):
        cases = ((None, "no readable release-check summary"),
                 (summary(failed=("native-colors",)), "native-colors failed"),
                 (summary(commit="d" * 40), "ran on " + "d" * 40),
                 (dict(summary(), passed=False), "did not pass"))
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


if __name__ == "__main__":
    unittest.main()

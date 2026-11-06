from __future__ import annotations

import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import deploy, release_check

SHA = "c" * 40
HEAD = "b" * 40


def summary(commit=SHA, failed=()):
    steps = [{"name": name, "exit": int(name in failed), "passed": name not in failed} for name in release_check.REQUIRED]
    return {"tool": release_check.TOOL, "commit": commit, "tree_unchanged": True, "passed": not failed,
            "required": list(release_check.REQUIRED), "steps": steps}


class FakeHost:
    """Answers the deploy's ps and git calls from a table and records every call; nothing real runs."""

    def __init__(self, config, servers=(111,), runners=(222,), supervisors=(), children=(), dirty="", ff=True, backup=0,
                 merge=0, migrate=0):
        """runners are bare runners (as started before supervision); children are (pid, parent) runner processes."""
        self.config, self.calls = config, []
        self.servers, self.runners = list(servers), list(runners)
        self.supervisors, self.children = list(supervisors), list(children)
        self.dirty, self.ff, self.backup, self.merge, self.migrate = dirty, ff, backup, merge, migrate

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
            out += "".join("%d %d %s\n" % (pid, parent, runner) for pid, parent in self.children)
            out += "333 1 /usr/bin/python3 -I unrelated\n"
        elif argv[:2] == ["ps", "-o"]:
            out = "Thu Nov  5 15:02:31 2026     process %s" % argv[-1]
        elif argv[0] == "git" and "rev-parse" in argv:
            out = HEAD + "\n"
        elif argv[0] == "git" and "status" in argv:
            out = self.dirty
        elif argv[0] == "git" and "merge-base" in argv:
            code = 0 if self.ff else 1
        elif argv[0] == "git" and "merge" in argv:
            code = self.merge
        elif "-c" in argv:
            code = self.backup
        elif "migrate" in argv:
            code = self.migrate
        elif argv[-1] == "binding":
            out = "i-1\n"
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

    def deploy(self, host, dry=False, sha=SHA):
        with mock.patch.object(deploy, "run", host), \
                mock.patch.object(deploy.os, "kill", lambda pid, sig: self.kills.append((pid, sig))), \
                mock.patch.object(deploy, "wait_exit", return_value="exited"), \
                mock.patch.object(deploy, "start", side_effect=AssertionError("must not start a process")), \
                redirect_stdout(io.StringIO()):
            deploy.deploy(self.config, sha, self.evidence, self.summary, dry)

    def refused(self, host, dry=False, sha=SHA):
        with self.assertRaises(deploy.Refused) as caught:
            self.deploy(host, dry, sha)
        return str(caught.exception)

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
        self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout"])
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
        host = FakeHost(self.config, runners=(), supervisors=(222,), children=((224, 222),))
        self.refused(FakeHost(self.config, runners=(), supervisors=(222,), children=((224, 222),), migrate=1))
        self.assertEqual(self.kills, [(222, 15), (111, 15)])
        self.kills = []
        self.deploy(host, dry=True)
        live = json.loads((self.evidence / "01-live.json").read_text())
        self.assertEqual(([pid for pid, _ in live["supervisor"]], [pid for pid, _ in live["runner"]]), ([222], [224]))

    def test_a_supervisor_between_runs_is_stopped_without_a_runner_line(self):
        (self.instance / "run-runner-02" / "stdout.log").write_text('{"status": "idle_lease_lost"}\n')
        host = FakeHost(self.config, runners=(), supervisors=(222,), migrate=1)
        self.assertIn("migration failed", self.refused(host))
        self.assertEqual(self.kills, [(222, 15), (111, 15)])

    def test_runners_that_are_not_the_supervisors_own_are_refused_before_anything_stops(self):
        for kw, reason in ((dict(runners=(), supervisors=(222,), children=((224, 9),)), "not its supervisor's"),
                           (dict(runners=(224,), supervisors=(222,)), "not its supervisor's"),
                           (dict(runners=(), supervisors=(222,), children=((224, 222), (225, 222))), "not its supervisor's"),
                           (dict(runners=(), supervisors=(222, 223)), "at most one runner"),
                           (dict(runners=(), supervisors=(221,), children=((224, 221),)), "not the ones their run records started")):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                self.assertIn(reason, self.refused(FakeHost(self.config, **kw)))
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


# Stand-ins for bin/aim-next-server and bin/aim-next-runner: each prints its first line as the real one does
# (the server only after binding --port) and then stays up until it is signalled.
STUB_SERVER = """import http.server, json, sys
port = int(sys.argv[sys.argv.index("--port") + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
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

    def stubs(self, status="ready", event="acquired"):
        (self.config.live / "bin").mkdir(parents=True, exist_ok=True)
        (self.config.live / "bin/aim-next-server").write_text(STUB_SERVER % {"nonce": self.nonce, "status": status})
        (self.config.live / "bin/aim-next-runner").write_text(STUB_RUNNER % {"event": event})

    def tearDown(self):
        for proc in self.started:
            proc.kill()
            proc.wait()
        super().tearDown()

    def run_deploy(self, host):
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
            deploy.deploy(self.config, SHA, self.evidence, self.summary, False)
        return opened

    def first_line(self, run):
        return json.loads((self.instance / run / "stdout.log").read_text().splitlines()[0])

    def test_a_deploy_restarts_both_from_the_config_and_verifies_the_new_server(self):
        host = FakeHost(self.config)
        try:
            opened = self.run_deploy(host)
        except Exception as error:  # a refusal here is the failure under test, not an error
            self.fail("the deploy did not complete: %r" % error)
        self.assertEqual(self.records(), ["00-plan", "00-release-check", "01-live", "02-checkout", "03-stopped",
                                          "04-backup", "05-fast-forward", "06-migrate", "07-server", "09-runner",
                                          "10-verify"])
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

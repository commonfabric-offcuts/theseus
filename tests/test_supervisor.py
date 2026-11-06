from __future__ import annotations

"""Bringing the agent runner back without a manual restart (pipeline item 35).

The supervisor starts one runner process, waits on its exit event, tells Core
how it ended, and starts it again only when that is safe: the runner held the
runner role when it ended (Core recorded the exit), it did not stop itself
cleanly or refuse to run, nobody asked the supervisor to stop, and it has not
ended within moments of starting three times running. Before a restart it
waits for the runner guard to be free, since a broker child of the runner
that ended can still hold it.

The child processes here are small scripts, except where a case says it uses
a real Store.
"""

import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

from aim_next import authority, supervisor
from aim_next.profile import load_profile, write_profile
import test_store as core_fixture
from test_wake_contract import own_cases

ROOT = Path(__file__).resolve().parents[1]


class Script:
    """A child runner stand-in: each run appends its own line to a log, then does what the plan says for that run."""

    def __init__(self, directory, plan):
        self.dir = Path(directory)
        self.log = self.dir / "runs.jsonl"
        self.plan = self.dir / "plan.json"
        self.plan.write_text(json.dumps(plan))
        self.path = self.dir / "child.py"
        self.path.write_text(
            "import json, os, signal, sys\n"
            "log, plan = sys.argv[1], json.load(open(sys.argv[2]))\n"
            "runs = sum(1 for _ in open(log)) if os.path.exists(log) else 0\n"
            "step = plan[min(runs, len(plan) - 1)]\n"
            "blocked = sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK, []))\n"
            "with open(log, 'a') as out:\n"
            "    out.write(json.dumps({'pid': os.getpid(), 'pgid': os.getpgrp(), 'blocked': blocked, 'argv': sys.argv[3:]}) + '\\n')\n"
            "if step == 'stop_me':\n"
            "    signal.signal(signal.SIGTERM, lambda *a: sys.exit(int(plan[-1]) if plan[-1] != 'stop_me' else 0))\n"
            "    os.kill(os.getppid(), signal.SIGTERM)\n"
            "    signal.pause()\n"
            "if step == 'kill':\n"
            "    os.kill(os.getpid(), signal.SIGKILL)\n"
            "sys.exit(int(step))\n")

    def argv(self, *extra):
        return [sys.executable, "-I", str(self.path), str(self.log), str(self.plan), *extra]

    def runs(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []


class Clock:
    """Each read advances by its own step, so a run lasts exactly what the case says."""

    def __init__(self, run_lengths):
        self.times, now = [], 0.0
        for length in run_lengths:
            self.times += [now, now + length]
            now += length
        self.times.reverse()

    def __call__(self):
        if not self.times:
            raise AssertionError("the supervisor started more runs than the case allows")
        return self.times.pop()


class SupervisorCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.records, self.waits, self.events = [], [], []

    def supervise(self, plan, records=None, run_lengths=None, wait=None):
        script = Script(self.dir, plan)
        answers = list(records or [])

        def record(pid, code):
            self.records.append((pid, code))
            return answers.pop(0) if answers else {"status": "recorded"}

        def wait_for_guard():
            self.waits.append(len(script.runs()))
            if wait is not None:
                wait()

        clock = Clock(run_lengths) if run_lengths else Clock([0.5] * 10)
        code = supervisor.Supervisor(script.argv("--profile", "p"), record, wait_for_guard, self.events.append, clock=clock).run()
        return code, script.runs()

    def why(self):
        return [event.get("why") for event in self.events if event["event"] == "not_restarting"]

    def test_a_runner_that_lost_its_lease_is_started_again_and_a_clean_stop_is_not(self):
        code, runs = self.supervise(["75", "0"])
        self.assertEqual(code, 0)
        self.assertEqual(self.records, [(runs[0]["pid"], 75), (runs[1]["pid"], 0)])
        # It waited for the guard once, after the first run and before the second.
        self.assertEqual(self.waits, [1])
        self.assertEqual(self.why(), ["stopped"])
        self.assertEqual(runs[1]["argv"], ["--profile", "p"])

    def test_a_killed_or_failed_runner_that_held_the_role_is_started_again(self):
        code, runs = self.supervise(["kill", "1", "0"], run_lengths=[40, 40, 40])
        self.assertEqual([c for _, c in self.records], [-9, 1, 0])
        self.assertEqual(len(runs), 3)

    def test_a_runner_that_refused_or_paused_is_not_started_again(self):
        code, runs = self.supervise(["2", "0"])
        self.assertEqual((code, len(runs), self.why()), (2, 1, ["refused_or_paused"]))
        self.assertEqual(self.records, [(runs[0]["pid"], 2)])
        self.assertEqual(self.waits, [])

    def test_a_runner_that_no_longer_held_the_role_is_not_started_again(self):
        # Another runner took over, or it was paused: Core did not record this exit.
        code, runs = self.supervise(["75", "0"], records=[{"status": "not_holder"}])
        self.assertEqual((code, len(runs), self.why()), (75, 1, ["not_holder"]))

    def test_an_exit_core_could_not_record_is_not_a_reason_to_restart(self):
        code, runs = self.supervise(["kill", "0"], records=[{"status": "unrecorded", "code": "DATABASE_BUSY"}])
        self.assertEqual((code, len(runs), self.why()), (128 + 9, 1, ["unrecorded"]))

    def test_three_runs_that_end_at_once_stop_the_restarts_and_a_long_run_resets_the_count(self):
        code, runs = self.supervise(["1"], run_lengths=[1, 1, 1, 1])
        self.assertEqual((code, len(runs), self.why()), (1, 3, ["ending_at_start"]))
        self.records, self.events = [], []
        (self.dir / "runs.jsonl").unlink()
        code, runs = self.supervise(["1", "1", "1", "1", "1", "0"], run_lengths=[1, 1, 30, 1, 1, 1])
        self.assertEqual((code, len(runs), self.why()), (0, 6, ["stopped"]))

    def test_a_stop_is_passed_to_the_runner_and_it_is_not_started_again(self):
        # The runner asks for its supervisor to be stopped, then exits 75 when the stop reaches it.
        code, runs = self.supervise(["stop_me", "75"])
        self.assertEqual((code, len(runs), self.why()), (75, 1, ["stopping"]))
        self.assertEqual(self.records, [(runs[0]["pid"], 75)])

    def test_a_stop_while_waiting_for_the_guard_starts_nothing_more(self):
        code, runs = self.supervise(["75", "0"], wait=lambda: os.kill(os.getpid(), signal.SIGTERM))
        self.assertEqual((code, len(runs)), (0, 1))
        self.assertEqual(self.events[-1], {"event": "stopped", "while": "waiting_for_guard"})

    def test_the_runner_runs_in_its_own_group_with_no_signal_blocked(self):
        code, runs = self.supervise(["0"])
        self.assertEqual(runs[0]["pgid"], runs[0]["pid"])
        self.assertEqual(runs[0]["blocked"], [])


@own_cases
class RealStoreCase(core_fixture.StoreCase):
    """The supervisor's own wiring to Core: a real Store, guard and runner record."""

    def setUp(self):
        super().setUp()
        self.root = self.path.parent.resolve()
        self.profile_path = self.root / "runner.json"
        write_profile(self.profile_path, self.path, "test-instance", "owner", binding=self.binding)
        self.lock = str(load_profile(self.profile_path).store()._authority.path) + ".runner.lock"

    def runner_state(self):
        return self.store.runner_schedule([])

    def test_a_killed_runner_is_recorded_and_its_successor_takes_over(self):
        child = self.root / "child.py"
        log = self.root / "runs.jsonl"
        child.write_text(
            "import json, os, signal, sys\n"
            "sys.path.insert(0, %r)\n"
            "from aim_next.profile import load_profile\n"
            "store = load_profile(%r).store()\n"
            "guard = store.runner_guard('child').__enter__()\n"
            "acquired = store.acquire_runner(guard)\n"
            "first = not os.path.exists(%r)\n"
            "with open(%r, 'a') as out:\n"
            "    out.write(json.dumps({'pid': os.getpid(), 'acquired': acquired['status']}) + '\\n')\n"
            "if first:\n"
            "    os.kill(os.getpid(), signal.SIGKILL)\n"
            "store.stop_runner(guard, acquired['runner_token'])\n" % (str(ROOT), str(self.profile_path), str(log), str(log)))
        events = []
        code = supervisor.Supervisor([sys.executable, "-I", str(child)], *supervisor.core_hooks(str(self.profile_path)),
                                     events.append).run()
        runs = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(code, 0)
        self.assertEqual([run["acquired"] for run in runs], ["acquired", "acquired"])
        exited = [event for event in events if event["event"] == "runner_exited"]
        self.assertEqual([(e["pid"], e["exit"], e["record"]["status"]) for e in exited],
                         [(runs[0]["pid"], -9, "recorded"), (runs[1]["pid"], 0, "not_holder")])
        self.assertEqual(exited[0]["record"]["reason"], "killed")
        self.assertEqual(self.runner_state()["state"], "stopped")

    def test_waiting_for_the_guard_returns_only_once_a_process_left_holding_it_has_gone(self):
        # A broker child of a runner that ended holds the runner guard it inherited.
        holder = subprocess.Popen([sys.executable, "-I", "-c",
                                   "import fcntl, os, sys\n"
                                   "fd = os.open(%r, os.O_RDWR)\n"
                                   "fcntl.flock(fd, fcntl.LOCK_EX)\n"
                                   "print('held', flush=True)\n"
                                   "sys.stdin.read()\n" % self.lock],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.addCleanup(holder.stdout.close)
        self.addCleanup(lambda: holder.poll() is None and (holder.kill(), holder.wait()))
        self.assertEqual(holder.stdout.readline(), "held\n")
        release = threading.Thread(target=holder.stdin.close)
        release.start()
        _, wait_for_guard = supervisor.core_hooks(str(self.profile_path))
        wait_for_guard()
        release.join()
        # The guard was free only because the holder had exited.
        self.assertEqual(os.waitpid(holder.pid, os.WNOHANG)[0], holder.pid)
        holder.returncode = 0

    def test_an_exit_that_cannot_be_recorded_says_so_rather_than_that_the_runner_had_no_role(self):
        self.profile_path.unlink()
        record_exit, _ = supervisor.core_hooks(str(self.profile_path))
        try:
            result = record_exit(os.getpid(), -9)
        except Exception as error:  # an escaped error would end the supervisor: the failure under test
            self.fail("the failure to record escaped: %r" % error)
        self.assertEqual(result["status"], "unrecorded")

    def test_waiting_for_the_guard_asks_the_kernel_to_block_until_the_guard_is_free(self):
        calls, real = [], fcntl.flock

        def flock(fd, operation):
            calls.append((os.fstat(fd).st_ino, operation))
            return real(fd, operation)
        _, wait_for_guard = supervisor.core_hooks(str(self.profile_path))
        with mock.patch.object(authority.fcntl, "flock", flock):
            wait_for_guard()
        guard = os.stat(self.lock).st_ino
        self.assertEqual([operation for inode, operation in calls if inode == guard], [fcntl.LOCK_EX])


class CommandLineCase(unittest.TestCase):
    def test_supervise_runs_this_checkouts_runner_with_the_same_arguments(self):
        argv = ["--profile", "/p.json", "--runner-id", "r", "--routes", "/z.json", "--host-dir", "/h"]
        self.assertEqual(supervisor.child_argv(argv),
                         [sys.executable, "-I", str(ROOT / "bin" / "aim-next-runner"), *argv])

    def test_supervise_needs_a_profile(self):
        with self.assertRaises(SystemExit) as caught, open(os.devnull, "w") as quiet:
            stderr, sys.stderr = sys.stderr, quiet
            try:
                supervisor.main(["--runner-id", "r"])
            finally:
                sys.stderr = stderr
        self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()

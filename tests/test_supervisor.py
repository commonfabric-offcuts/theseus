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

from aim_next import authority, supervisor, wake_adapter
from aim_next.profile import load_profile, write_profile
import test_store as core_fixture
import test_delivery
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
            "    # A hang guard for this stand-in only: a stop the supervisor never passes on ends the run\n"
            "    # by SIGALRM after 20 s, so the case fails instead of waiting for ever.\n"
            "    signal.alarm(20)\n"
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
        self.records, self.waits, self.events, self.order = [], [], [], []

    def supervise(self, plan, records=None, run_lengths=None, wait=None, pauses=None, gone=None):
        script = Script(self.dir, plan)
        answers = list(records or [])
        hooks = {}
        if pauses is not None:
            # pauses: what Core says each refused run saved, in order (None: no cleanup pause).
            saved = list(pauses)

            def cleanup_pause(pid):
                self.order.append(("pause_read", pid))
                return saved.pop(0) if saved else None

            def wait_group_gone(pgid):
                self.order.append(("group_gone", pgid, len(script.runs())))
                # gone(): what the wait returns (None: the group has gone).
                return gone() if gone is not None else None
            hooks = dict(cleanup_pause=cleanup_pause, wait_group_gone=wait_group_gone)

        def record(pid, code):
            self.records.append((pid, code))
            return answers.pop(0) if answers else {"status": "recorded"}

        def wait_for_guard():
            self.waits.append(len(script.runs()))
            self.order.append(("guard", len(script.runs())))
            if wait is not None:
                wait()

        clock = Clock(run_lengths) if run_lengths else Clock([0.5] * 10)
        code = supervisor.Supervisor(script.argv("--profile", "p"), record, wait_for_guard, self.events.append, clock=clock,
                                     **hooks).run()
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

    def test_a_cleanup_pause_is_resumed_with_its_version_once_the_childs_group_is_gone(self):
        pause = {"version": 7, "child_pid": 22768, "child_started_at": "2026-11-07T01:40:35+00:00"}
        code, runs = self.supervise(["2", "0"], pauses=[pause], run_lengths=[40, 40])
        self.assertEqual((code, len(runs)), (0, 2))
        self.assertEqual(runs[0]["argv"], ["--profile", "p"])
        self.assertEqual(runs[1]["argv"], ["--profile", "p", "--resume-version", "7", "--resume-reason", "cleanup_confirmed"])
        # Core's account of the run that paused, then the group, then the guard, then the resumed run.
        self.assertEqual(self.order, [("pause_read", runs[0]["pid"]), ("group_gone", 22768, 1), ("guard", 1)])
        said = [e for e in self.events if e["event"] in ("awaiting_child_group", "resuming")]
        self.assertEqual(said, [
            {"event": "awaiting_child_group", "version": 7, "child_pid": 22768, "child_started_at": "2026-11-07T01:40:35+00:00"},
            {"event": "resuming", "reason": "cleanup_confirmed", "version": 7, "child_pid": 22768,
             "child_started_at": "2026-11-07T01:40:35+00:00"}])
        self.assertEqual(self.why(), ["stopped"])

    def test_a_refusal_that_is_not_a_cleanup_pause_still_needs_a_person(self):
        code, runs = self.supervise(["2", "0"], pauses=[None])
        self.assertEqual((code, len(runs), self.why()), (2, 1, ["refused_or_paused"]))
        self.assertEqual(self.order, [("pause_read", runs[0]["pid"])])

    def test_a_stop_while_waiting_for_the_childs_group_starts_nothing_more(self):
        pause = {"version": 7, "child_pid": 22768, "child_started_at": "t"}
        code, runs = self.supervise(["2", "0"], pauses=[pause], gone=lambda: os.kill(os.getpid(), signal.SIGTERM))
        self.assertEqual((code, len(runs)), (0, 1))
        self.assertEqual(self.events[-1], {"event": "stopped", "while": "waiting_for_child_group"})
        self.assertNotIn("resuming", [e["event"] for e in self.events])
        self.assertEqual(self.waits, [], "it went on to wait for the guard")

    def test_a_failed_look_at_the_childs_group_stops_with_an_event_and_resumes_nothing(self):
        # One ps that fails on a loaded Mac: the supervisor cannot confirm the
        # group gone, so a person decides, and its last event says so.
        pause = {"version": 7, "child_pid": 22768, "child_started_at": "t"}
        code, runs = self.supervise(["2", "0"], pauses=[pause], gone=lambda: "process_observation_failed")
        self.assertEqual((code, len(runs)), (2, 1))
        self.assertEqual(self.events[-1], {"event": "not_restarting", "why": "child_group_unobserved",
                                           "detail": "process_observation_failed", "version": 7,
                                           "child_pid": 22768, "child_started_at": "t"})
        self.assertNotIn("resuming", [e["event"] for e in self.events])
        self.assertEqual(self.waits, [])

    def test_the_group_wait_reports_a_failed_observation_as_a_value(self):
        wait_group_gone = supervisor.resume_hooks("unused-profile")["wait_group_gone"]
        with mock.patch.object(wake_adapter, "_process_group",
                               side_effect=wake_adapter.AdapterFault("process_observation_failed")):
            self.assertEqual(wait_group_gone(4242), "process_observation_failed")
        with mock.patch.object(wake_adapter, "_process_group", return_value={}) as listing:
            self.assertIsNone(wait_group_gone(4242))
        self.assertEqual(listing.call_count, 2)
        # No exit-event queue can be made (out of descriptors): gone is not known either.
        with mock.patch.object(wake_adapter.select, "kqueue", side_effect=OSError(24, "fixture: too many open files")):
            self.assertEqual(wait_group_gone(4242), "exit_observation_failed")
        with mock.patch.object(wake_adapter, "_process_group", side_effect=ValueError("not an observation fault")):
            with self.assertRaises(ValueError):
                wait_group_gone(4242)

    def test_cleanup_pauses_that_end_at_once_stop_being_resumed(self):
        pause = {"version": 7, "child_pid": 22768, "child_started_at": "t"}
        code, runs = self.supervise(["2"], pauses=[pause] * 5, run_lengths=[1, 1, 1, 1])
        self.assertEqual((code, len(runs), self.why()), (2, 3, ["refused_or_paused"]))

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

    def test_cleanup_pause_reads_only_a_cleanup_pause_saved_by_that_runner(self):
        cleanup_pause = supervisor.resume_hooks(str(self.profile_path))["cleanup_pause"]
        guard = self.store.runner_guard("paused")
        guard.__enter__()
        self.addCleanup(guard.close)
        token = self.store.acquire_runner(guard)["runner_token"]
        self.assertIsNone(cleanup_pause(os.getpid()), "a running runner is no pause")
        paused = self.store.pause_runner(guard, token, "cleanup_failed", child=(22768, "2026-11-07T01:40:35+00:00"))
        self.assertEqual(cleanup_pause(os.getpid()), {"version": paused["version"], "child_pid": 22768,
                                                      "child_started_at": "2026-11-07T01:40:35+00:00"})
        self.assertIsNone(cleanup_pause(os.getpid() + 1), "another process's pause is not this runner's")
        guard.close()
        other = self.store.runner_guard("other")
        other.__enter__()
        self.addCleanup(other.close)
        token = self.store.resume_runner(other, paused["version"])["runner_token"]
        # A storage pause can leave a registered child on the row (its
        # registration was refused, say); it is still not a cleanup pause.
        self.create_topic()
        test_delivery.DeliveryCase.send_next(self)
        claim = self.store.claim_wakes(other, token, ["owner", "agent-a", "agent-b"])["claims"][0]
        self.store.record_runner_child(other, token, claim["claim_token"], 4100, "registered")
        self.store.pause_runner(other, token, "storage_failure")
        self.assertEqual(self.sql("SELECT reason_code,child_pid FROM runner_state"), [("storage_failure", 4100)])
        self.assertIsNone(cleanup_pause(os.getpid()), "only a cleanup pause is waited out")

    def test_a_real_cleanup_pause_is_resumed_only_after_the_named_group_has_gone(self):
        # The runner stand-in leaves a broker stand-in alive in its own group,
        # pauses naming it, and exits 2. The group's member ends only when the
        # test closes its pipe; the resumed run checks it was gone first.
        child = self.root / "child.py"
        log = self.root / "runs.jsonl"
        release_r, release_w = os.pipe()
        # Only the member holds the read end open past the runner; the write end stays here.
        os.set_inheritable(release_r, True)
        released = []

        def release():
            if not released:
                released.append(True)
                os.close(release_w)
        # Whatever happens, the member is let go at the end.
        self.addCleanup(release)
        child.write_text(
            "import json, os, subprocess, sys\n"
            "sys.path.insert(0, %r)\n"
            "from aim_next.profile import load_profile\n"
            "store = load_profile(%r).store()\n"
            "guard = store.runner_guard('child').__enter__()\n"
            "args = sys.argv[1:]\n"
            "row = {'pid': os.getpid(), 'argv': args}\n"
            "if not args:\n"
            "    acquired = store.acquire_runner(guard)\n"
            "    member = subprocess.Popen([sys.executable, '-I', '-c', 'import os,sys; os.read(int(sys.argv[1]),1)', %r],\n"
            "                              start_new_session=True, pass_fds=(%d,))\n"
            "    listing = subprocess.run(['/bin/ps', '-A', '-o', 'pid=,pgid=,stat='], capture_output=True, text=True).stdout\n"
            "    row['member_live_at_pause'] = [l for l in listing.splitlines() if l.split()[1] == str(member.pid) and not l.split()[2].startswith('Z')]\n"
            "    store.pause_runner(guard, acquired['runner_token'], 'cleanup_failed', child=(member.pid, 'fixture-start'))\n"
            "    row['member'] = member.pid\n"
            "    code = 2\n"
            "else:\n"
            "    listing = subprocess.run(['/bin/ps', '-A', '-o', 'pid=,pgid=,stat='], capture_output=True, text=True).stdout\n"
            "    first = json.loads(open(%r).readline())\n"
            "    row['member_live_at_resume'] = [l for l in listing.splitlines() if l.split()[1] == str(first['member']) and not l.split()[2].startswith('Z')]\n"
            "    resumed = store.resume_runner(guard, int(args[1]), reason=args[3])\n"
            "    row['resumed'] = resumed['status']\n"
            "    row['state'] = store.runner_status()\n"
            "    store.stop_runner(guard, resumed['runner_token'])\n"
            "    code = 0\n"
            "with open(%r, 'a') as out:\n"
            "    out.write(json.dumps(row) + '\\n')\n"
            "sys.exit(code)\n" % (str(ROOT), str(self.profile_path), str(release_r), release_r, str(log), str(log)))
        events = []

        def emit(event):
            events.append(event)
            if event["event"] == "awaiting_child_group":
                # Let the member end a little after the supervisor starts waiting on it.
                threading.Timer(0.3, release).start()
        try:
            code = supervisor.Supervisor([sys.executable, "-I", str(child)], *supervisor.core_hooks(str(self.profile_path)),
                                         emit, **supervisor.resume_hooks(str(self.profile_path))).run()
        finally:
            os.close(release_r)
        runs = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(code, 0)
        self.assertEqual(len(runs), 2)
        member = runs[0]["member"]
        self.assertTrue(runs[0]["member_live_at_pause"], "the named group had no live member: the wait is vacuous")
        self.assertEqual(runs[1]["argv"][2:], ["--resume-reason", "cleanup_confirmed"])
        self.assertEqual(runs[1]["member_live_at_resume"], [], "resumed while the named group still had a live member")
        self.assertEqual(runs[1]["resumed"], "acquired")
        self.assertEqual((runs[1]["state"]["state"], runs[1]["state"]["reason_code"]), ("running", "cleanup_confirmed"))
        self.assertEqual([e["event"] for e in events if e["event"] in ("awaiting_child_group", "resuming")],
                         ["awaiting_child_group", "resuming"])
        self.assertEqual(next(e for e in events if e["event"] == "resuming")["child_pid"], member)

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

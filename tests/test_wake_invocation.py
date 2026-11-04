from __future__ import annotations

import json
import copy
import errno
import fcntl
import os
from pathlib import Path
import signal
import select
import subprocess
import tempfile
import time
import unittest
from unittest import mock

from aim_next import Store, initialize
from aim_next.profile import write_profile
from aim_next import wake_adapter


BROKER = r'''
import json, os, select, signal, subprocess, sys, threading, time
mode, report = sys.argv[1:3]
if mode == "ignore-term":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
stop = os.path.join(os.path.dirname(report), "fixture-stop")
watching = threading.Event()
def fixture_watchdog():
    fd = os.open(stop, os.O_RDONLY | os.O_NONBLOCK)
    watching.set()
    # Only this fixture holds the write end. EOF ends the fixture even when a
    # broken adapter has already reaped the leader, making PGID signals unsafe.
    select.select([fd], [], [], 30)
    os._exit(97)
if mode != "cleanup-owned":
    threading.Thread(target=fixture_watchdog, daemon=True).start()
    assert watching.wait(2), "fixture shutdown reader did not start"
record = {"pid": os.getpid(), "pgid": os.getpgrp(), "argv": sys.argv[1:]}
if mode in ("descendant", "cleanup-family"):
    code = "import os,select,sys; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NONBLOCK); os.write(1,b'R'); select.select([fd],[],[],30); os._exit(97)"
    child = subprocess.Popen([sys.executable, "-c", code, stop], stdout=subprocess.PIPE)
    assert select.select([child.stdout], [], [], 2)[0], "fixture descendant reader did not start"
    assert child.stdout.read(1) == b"R"
    child.stdout.close()
    record["descendant"] = child.pid
if mode == "guard":
    record["fds"] = [[int(fd), os.fstat(int(fd)).st_dev, os.fstat(int(fd)).st_ino]
                     for fd in sys.argv[3:]]
with open(report, "w") as target:
    json.dump(record, target)
os.write(1, b"R")  # fixture-only readiness; the actual adapter discards stdout
if mode == "exit-before-registration":
    gate = os.open(os.path.join(os.path.dirname(report), "fixture-exit"), os.O_RDONLY | os.O_NONBLOCK)
    select.select([gate], [], [], 10)
    os.read(gate, 1)
    sys.exit(0)
elif mode in ("never-read", "ignore-term", "cleanup-owned", "cleanup-family"):
    time.sleep(30)
elif mode == "descendant":
    sys.exit(0)
else:
    record["stdin"] = json.loads(sys.stdin.read())
    record["environment"] = {key: os.environ[key] for key in
                             ["PATH", "HOME", "LANG", "TMPDIR", "CODEX_HOME", "WAKE_TEST_PRIVATE"]
                             if key in os.environ}
    with open(report, "w") as target:
        json.dump(record, target)
    if mode == "output":
        os.write(1, b"x" * 1048576)
        os.write(2, b"x" * 1048576)
    sys.exit({"busy": 75, "error": 3}.get(mode, 0))
'''


class WakeInvocationTests(unittest.TestCase):
    """Real temporary Store/guard and owned child; no real agent or wake route.

    The callback records the invocation seam only. Durable Core ownership and
    external broker queue acceptance remain separate integration claims.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "instance.sqlite3"
        self.binding = initialize(self.db, "invocation-fixture", [
            {"id": "fixture-recipient", "kind": "agent"}],
            authority_path=self.root / "authority.json")["binding"]
        self.store = Store(self.db, "invocation-fixture", expected_binding=self.binding)
        self.guard = self.store.runner_guard("fixture-runner").__enter__()
        self.addCleanup(self.guard.close)
        self.profile = self.root / "recipient.json"
        write_profile(self.profile, self.db, "invocation-fixture", "fixture-recipient", binding=self.binding)
        self.route = self.root / "route.json"
        self.script = self.root / "broker.py"
        self.script.write_text(BROKER)
        self.report = self.root / "report.json"
        self.registered = []
        self.spawned = []
        self.actual_popen = subprocess.Popen
        self.actual_killpg = os.killpg
        self.group_signals = []
        self.controls = {}
        for name in ("fixture-stop", "fixture-exit"):
            control = self.root / name
            os.mkfifo(control, 0o600)
            self.controls[name] = os.open(control, os.O_RDWR | os.O_NONBLOCK)
            self.addCleanup(self.close_control, name)
        self.addCleanup(self.cleanup_brokers)
        now = int(time.time() * 1000)
        self.owner_until = now + 30000
        self.claim = {"attempt_id": "attempt-fixture", "claim_token": "private-token",
                      "recipient_id": "fixture-recipient", "wake_generation": 7,
                      "captured_seq": 19, "lease_until_ms": now + 20000,
                      "route_binding": {"instance_id": "invocation-fixture", "actor_id": "fixture-recipient",
                                        "db_path": str(self.db), "authority_id": self.binding["authority_id"],
                                        "authority_epoch": self.binding["authority_epoch"]}}

    def close_control(self, name):
        fd = self.controls.pop(name, None)
        if fd is not None:
            os.close(fd)

    def cleanup_brokers(self):
        """Independent fixture cleanup, never signalling a reaped leader's PGID."""
        self.close_control("fixture-stop")
        errors = []
        groups = {row["child"].pid for row in self.spawned}
        for row in self.spawned:
            child = row["child"]
            try:
                # poll may reap a finished leader. In that case we NEVER send a
                # group signal: only the fixture EOF path ends its descendants.
                # A live direct child cannot have its PID reused before wait.
                if child.poll() is None:
                    if os.getpgid(child.pid) == child.pid:
                        self.actual_killpg(child.pid, signal.SIGKILL)
                    else:
                        child.kill()  # only the actual child, never another group
                        errors.append("Fixture broker was not in its own group")
                child.wait(timeout=2)
            except Exception as error:
                errors.append(type(error).__name__)
            finally:
                for stream in (child.stdin, child.stdout, child.stderr):
                    if stream is not None:
                        stream.close()
        if groups:
            try:
                remaining = self.live_group_members(groups)
                if remaining:
                    queue = select.kqueue()
                    try:
                        pending = set()
                        for pid, group, state in remaining:
                            try:
                                queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                                    fflags=select.KQ_NOTE_EXIT)], 0, 0)
                                pending.add(pid)
                            except OSError as error:
                                if error.errno != errno.ESRCH:
                                    raise
                        deadline = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) + 2000000000
                        while pending:
                            left = (deadline - time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)) / 1e9
                            if left <= 0:
                                break
                            events = queue.control(None, len(pending), left)
                            if not events:
                                break
                            for event in events:
                                if event.fflags & select.KQ_NOTE_EXIT:
                                    pending.discard(event.ident)
                    finally:
                        queue.close()
                self.assertEqual(self.live_group_members(groups), [], "Fixture cleanup left a live broker descendant")
            except Exception as error:
                errors.append(type(error).__name__ + ":" + str(error))
        self.assertEqual(errors, [], "Independent fixture cleanup failed")

    def configure(self, mode, extra=()):
        argv = ["/usr/bin/python3", str(self.script), mode, str(self.report)] + list(extra)
        self.route.write_text(json.dumps({"v": 1, "profile": str(self.profile), "argv": argv}))
        self.route.chmod(0o600)
        return argv

    def registration(self, pid, started_at):
        self.registered.append((pid, started_at))
        return {"status": "recorded", "instance_id": "invocation-fixture"}

    def observe_spawn(self, args, *positional, **keywords):
        child = self.actual_popen(args, *positional, **keywords)
        # Keep the actual constructor/child evidence. Process-list helpers are
        # not brokers, and a callback alone cannot prove that nothing launched.
        is_broker = str(self.script) in args
        if is_broker:
            self.spawned.append({"child": child, "args": args, "keywords": dict(keywords)})
        return child

    def invoke(self, callback=None, route=...):
        self.assertTrue(callable(getattr(wake_adapter, "run_route", None)),
                        "The reviewed bounded invocation API is not implemented")
        def observe_signal(group, sig):
            at = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
            result = self.actual_killpg(group, sig)
            if any(row["child"].pid == group for row in self.spawned):
                self.group_signals.append({"group": group, "signal": sig, "at_ns": at})
            return result
        with mock.patch.object(subprocess, "Popen", side_effect=self.observe_spawn), \
                mock.patch.object(os, "killpg", side_effect=observe_signal):
            return wake_adapter.run_route(self.route if route is ... else route,
                                         self.claim, self.guard,
                                         owner_lease_until_ms=self.owner_until,
                                         record_child=callback or self.registration)

    def assert_not_started(self):
        self.assertEqual(self.spawned, [], "A broker constructor ran despite refusal")
        self.assertEqual(self.registered, [])
        self.assertFalse(self.report.exists())

    def assert_reaped(self, pid):
        # A missing owned child is independent of the adapter's result string.
        with self.assertRaises(ChildProcessError):
            os.waitpid(pid, os.WNOHANG)

    def live_group_members(self, groups):
        result = subprocess.run(["/bin/ps", "-A", "-o", "pid=,pgid=,stat="],
                                capture_output=True, text=True, timeout=2, check=True)
        members = [line.split() for line in result.stdout.splitlines()]
        return [(int(pid), int(group), state) for pid, group, state in members
                if int(group) in groups and not state.startswith("Z")]

    def assert_no_live_group(self, pgid):
        self.assertEqual(self.live_group_members({pgid}), [])

    def assert_timeout_signal(self, start, pid):
        signals = [item for item in self.group_signals if item["group"] == pid]
        self.assertTrue(signals, "No real signal to the owned timed-out group was observed")
        seconds = (signals[0]["at_ns"] - start) / 1e9
        self.assertGreaterEqual(seconds, 4.8)
        self.assertLess(seconds, 5.75, "Registration reset the five-second execution deadline")

    def process_state(self, pid):
        """Observe an owned leader without waitpid/poll, which would reap it."""
        result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "pid=,pgid=,stat="],
                                capture_output=True, text=True, timeout=1)
        self.assertIn(result.returncode, (0, 1), result.stderr)
        if not result.stdout.strip():
            return None
        rows = [line.split() for line in result.stdout.splitlines()]
        self.assertEqual(len(rows), 1)
        actual, group, state = rows[0]
        self.assertEqual(int(actual), pid)
        return int(group), state

    def start_fixture_broker(self, mode):
        """Establish cleanup instrumentation without invoking application code."""
        argv = self.configure(mode)
        child = self.observe_spawn(argv, executable=str(Path(argv[0]).resolve()),
                                   shell=False, start_new_session=True,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL)
        ready, _, _ = select.select([child.stdout], [], [], 2)
        self.assertTrue(ready, "The cleanup fixture did not reach its explicit ready point")
        self.assertEqual(os.read(child.stdout.fileno(), 1), b"R")
        return child, json.loads(self.report.read_text())

    def test_fixture_cleanup_kills_a_still_owned_group_without_the_adapter(self):
        child, report = self.start_fixture_broker("cleanup-owned")
        self.assertEqual(report["pgid"], child.pid)
        # This controlled fixture deliberately has no EOF watchdog, proving
        # that the still-owned group path does not depend on adapter cleanup.
        actual = self.actual_killpg
        with mock.patch.object(self, "actual_killpg", wraps=actual) as signals:
            self.cleanup_brokers()
        signals.assert_called_once_with(child.pid, signal.SIGKILL)
        self.assert_reaped(child.pid)
        self.assert_no_live_group(child.pid)

    def test_fixture_cleanup_after_leader_reap_uses_eof_without_group_signals(self):
        child, report = self.start_fixture_broker("descendant")
        self.assertEqual(child.wait(timeout=2), 0)  # deliberately reap first
        self.assert_reaped(child.pid)
        members = self.live_group_members({child.pid})
        self.assertTrue(any(pid == report["descendant"] for pid, group, state in members),
                        "No surviving fixture descendant: the cleanup control is vacuous")
        actual = self.actual_killpg
        with mock.patch.object(self, "actual_killpg", wraps=actual) as signals:
            self.cleanup_brokers()
        signals.assert_not_called()
        self.assert_no_live_group(child.pid)

    def test_fixture_eof_stops_both_live_leader_and_descendant_without_adapter(self):
        child, report = self.start_fixture_broker("cleanup-family")
        expected = {child.pid, report["descendant"]}
        queue = select.kqueue()
        try:
            for pid in expected:
                observed = self.process_state(pid)
                self.assertIsNotNone(observed)
                self.assertFalse(observed[1].startswith("Z"), "EOF cleanup precondition is vacuous")
                queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT)], 0, 0)
            self.close_control("fixture-stop")
            # No adapter and no signal path runs here. Both fixture processes
            # must respond to EOF while their main work would otherwise wait.
            pending = set(expected)
            deadline = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) + 2000000000
            while pending:
                left = (deadline - time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)) / 1e9
                self.assertGreater(left, 0, "Fixture EOF did not end the live family promptly")
                events = queue.control(None, len(pending), left)
                self.assertTrue(events, "No fixture exit event before the cleanup deadline")
                for event in events:
                    if event.fflags & select.KQ_NOTE_EXIT:
                        pending.discard(event.ident)
            self.assertEqual(child.wait(timeout=1), 97)
            self.assert_no_live_group(child.pid)
        finally:
            queue.close()

    def test_literal_input_allowlisted_environment_and_real_guard_descriptors(self):
        argv = self.configure("guard", [str(fd) for fd in self.guard.pass_fds])
        expected_fds = [[fd, os.fstat(fd).st_dev, os.fstat(fd).st_ino] for fd in self.guard.pass_fds]
        before = self.db.read_bytes()
        with mock.patch.dict(os.environ, {"WAKE_TEST_PRIVATE": "must-not-reach-child",
                                         "CODEX_HOME": str(self.root / "ambient-codex")}):
            result = self.invoke()
        self.assertEqual((result.outcome, result.exit_code), ("accepted", 0))
        report = json.loads(self.report.read_text())
        self.assertEqual(report["argv"], argv[2:])
        self.assertEqual(report["stdin"], {"v": 1, "binding": self.claim["route_binding"],
                                         "wake_generation": 7, "attempt_id": "attempt-fixture"})
        self.assertEqual(report["fds"], expected_fds)
        self.assertNotIn("WAKE_TEST_PRIVATE", report["environment"])
        self.assertNotIn("CODEX_HOME", report["environment"])
        self.assertEqual(report["environment"]["PATH"], "/usr/bin:/bin")
        self.assertEqual(report["pgid"], report["pid"])
        self.assertEqual(self.registered[0][0], report["pid"])
        self.assertEqual(len(self.spawned), 1, "The constructor instrument must observe the actual broker")
        spawned = self.spawned[0]
        self.assertEqual(spawned["child"].pid, report["pid"])
        self.assertEqual(list(spawned["args"]), argv)
        self.assertIs(spawned["keywords"].get("shell", False), False)
        self.assertEqual(spawned["keywords"]["executable"], str(Path(argv[0]).resolve()))
        self.assertEqual(self.db.read_bytes(), before)
        self.assert_reaped(report["pid"])

    def test_busy_other_exit_and_large_discarded_output(self):
        for mode, outcome, code in [("busy", "busy", 75), ("error", "error", 3), ("output", "accepted", 0)]:
            with self.subTest(mode=mode):
                self.configure(mode, ["literal;$(touch never)", "one argument"])
                result = self.invoke()
                self.assertEqual((result.outcome, result.exit_code), (outcome, code))
                report = json.loads(self.report.read_text())
                self.assertEqual(report["argv"][-2:], ["literal;$(touch never)", "one argument"])
                self.assert_reaped(report["pid"])

    def test_distinct_attempts_preserve_the_same_captured_work_identity(self):
        self.configure("normal")
        captured = []
        for attempt in ("attempt-first", "attempt-retry"):
            self.claim["attempt_id"] = attempt
            result = self.invoke()
            self.assertEqual((result.outcome, result.exit_code), ("accepted", 0))
            report = json.loads(self.report.read_text())
            captured.append(report["stdin"])
            self.assert_reaped(report["pid"])
        self.assertEqual(len(self.spawned), 2)
        self.assertEqual(captured[0].pop("attempt_id"), "attempt-first")
        self.assertEqual(captured[1].pop("attempt_id"), "attempt-retry")
        self.assertEqual(captured[0], captured[1])
        self.assertEqual(captured[0]["binding"], self.claim["route_binding"])
        self.assertEqual(captured[0]["wake_generation"], 7)

    def test_no_child_for_route_mismatch_or_insufficient_remaining_budget(self):
        self.configure("normal")
        self.claim["route_binding"]["actor_id"] = "wrong-recipient"
        result = self.invoke()
        self.assertEqual(result.outcome, "unavailable")
        self.assert_not_started()
        self.claim["route_binding"]["actor_id"] = "fixture-recipient"
        self.claim["lease_until_ms"] = int(time.time() * 1000) + 6999
        result = self.invoke()
        self.assertEqual(result.outcome, "unavailable")
        self.assert_not_started()

    def test_missing_route_and_each_internally_valid_binding_mismatch_start_nothing(self):
        self.configure("normal")
        result = self.invoke(route=None)
        self.assertEqual(result.outcome, "unavailable")
        self.assert_not_started()
        original = copy.deepcopy(self.claim)
        differences = {"actor_id": "other-fixture-recipient", "instance_id": "other-fixture-instance",
                       "db_path": str(self.root / "other.sqlite3"),
                       "authority_id": "other-fixture-authority", "authority_epoch": "earlier-epoch"}
        for key, value in differences.items():
            with self.subTest(binding_field=key):
                self.claim = copy.deepcopy(original)
                self.claim["route_binding"][key] = value
                if key == "actor_id":
                    # This claim is internally consistent; the profile mismatch
                    # must refuse it, not merely the claim-shape validator.
                    self.claim["recipient_id"] = value
                try:
                    result = self.invoke()
                except wake_adapter.AdapterFault as error:
                    self.fail("Mismatched binding reached child invocation: " + str(error))
                self.assertEqual(result.outcome, "unavailable")
                self.assert_not_started()
        self.claim = original

    def test_owner_lease_must_cover_whole_claim_and_both_have_launch_budget(self):
        self.configure("normal")
        now = int(time.time() * 1000)
        cases = [(now + 6000, now + 20000),
                 (now + 9000, now + 20000),
                 (now + 30000, now + 6000),
                 (True, now + 20000)]
        for owner, claim in cases:
            with self.subTest(owner=owner, claim=claim):
                self.owner_until = owner
                self.claim["lease_until_ms"] = claim
                self.assertEqual(self.invoke().outcome, "unavailable")
                self.assert_not_started()

    def test_claim_just_above_seven_seconds_starts_exactly_one_broker(self):
        self.configure("normal")
        now = int(time.time() * 1000)
        self.owner_until = now + 30000
        self.claim["lease_until_ms"] = now + 7600
        result = self.invoke()
        self.assertEqual((result.outcome, result.exit_code), ("accepted", 0))
        self.assertEqual(len(self.spawned), 1)
        report = json.loads(self.report.read_text())
        self.assertEqual(self.spawned[0]["child"].pid, report["pid"])
        self.assert_reaped(report["pid"])

    def test_closed_actual_guard_starts_no_child(self):
        self.configure("normal")
        self.guard.close()
        self.assertEqual(self.invoke().outcome, "unavailable")
        self.assert_not_started()

    def test_ignored_sigchld_refuses_before_start(self):
        self.configure("normal")
        original = signal.signal(signal.SIGCHLD, signal.SIG_IGN)
        try:
            result = self.invoke()
            self.assertEqual(result.outcome, "unavailable")
            self.assert_not_started()
        finally:
            signal.signal(signal.SIGCHLD, original)

    def test_custom_sigchld_handler_is_also_refused_before_start(self):
        self.configure("normal")
        observed = []
        original = signal.signal(signal.SIGCHLD, lambda number, frame: observed.append(number))
        try:
            self.assertEqual(self.invoke().outcome, "unavailable")
            self.assert_not_started()
            self.assertEqual(observed, [])
        finally:
            signal.signal(signal.SIGCHLD, original)

    def test_exit_before_watcher_registration_is_observed_without_early_reap(self):
        self.configure("exit-before-registration")
        observed_zombie = []
        def register(pid, started_at):
            self.registered.append((pid, started_at))
            queue = select.kqueue()
            try:
                queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT)], 0, 0)
                os.write(self.controls["fixture-exit"], b"x")
                events = queue.control(None, 1, 1.5)
                self.assertTrue(any(event.ident == pid and event.fflags & select.KQ_NOTE_EXIT
                                    for event in events), "The actual owned exit event was not observed")
            finally:
                queue.close()
            observed = self.process_state(pid)  # one confirmation, no polling/reap
            self.assertIsNotNone(observed, "Owned leader was reaped during registration")
            group, state = observed
            self.assertEqual(group, pid)
            self.assertTrue(state.startswith("Z"), "Fast-exit zombie precondition was not established")
            observed_zombie.append(pid)
            return {"status": "recorded", "instance_id": "invocation-fixture"}
        result = self.invoke(register)
        self.assertEqual((result.outcome, result.exit_code), ("accepted", 0))
        self.assertEqual(observed_zombie, [self.registered[0][0]])
        self.assert_reaped(observed_zombie[0])
        self.assert_no_live_group(observed_zombie[0])

    def test_never_reading_child_times_out_and_owned_group_is_cleaned(self):
        self.configure("never-read")
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        result = self.invoke()
        seconds = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
        self.assertEqual(result.outcome, "error")
        self.assertGreaterEqual(seconds, 4.8)
        self.assertLess(seconds, 6.5)
        report = json.loads(self.report.read_text())
        self.assert_timeout_signal(start, report["pid"])
        self.assert_reaped(report["pid"])
        self.assert_no_live_group(report["pgid"])

    def test_stdin_write_is_nonblocking_and_actual_full_pipe_returns_eagain(self):
        self.configure("never-read")
        actual_write = os.write
        filled, blocked = [], []
        def observe_write(fd, data):
            own_stdin = [row["child"].stdin for row in self.spawned
                         if row["child"].stdin is not None and not row["child"].stdin.closed]
            if not any(stream.fileno() == fd for stream in own_stdin):
                return actual_write(fd, data)
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            self.assertTrue(flags & os.O_NONBLOCK, "A broker stdin write could block the deadline")
            if not filled:
                count = 0
                # This is a real pipe precondition in this one fixture. Its
                # non-reading broker never interprets the fill bytes as hints.
                while count < 1048576:
                    try:
                        count += actual_write(fd, b"x" * 4096)
                    except BlockingIOError:
                        filled.append(count)
                        break
                self.assertTrue(filled, "Could not establish a full nonblocking pipe")
            start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
            try:
                return actual_write(fd, data)
            except BlockingIOError:
                blocked.append((time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9)
                raise
        with mock.patch.object(os, "write", side_effect=observe_write):
            try:
                result = self.invoke()
            except wake_adapter.AdapterFault as error:
                self.fail("Nonblocking input control raised a fault: " + str(error))
        self.assertEqual(result.outcome, "error")
        self.assertEqual(len(self.spawned), 1)
        self.assertTrue(filled)
        self.assertTrue(blocked, "No actual EAGAIN from the broker stdin write was observed")
        self.assertLess(max(blocked), .25, "The instrument itself waited instead of a nonblocking write")
        pid = self.spawned[0]["child"].pid
        self.assert_reaped(pid)
        self.assert_no_live_group(pid)

    def test_successful_leader_with_live_descendant_is_error_and_group_is_drained(self):
        self.configure("descendant")
        result = self.invoke()
        self.assertEqual(result.outcome, "error")
        report = json.loads(self.report.read_text())
        self.assertIn("descendant", report)
        self.assert_reaped(report["pid"])
        self.assert_no_live_group(report["pgid"])

    def test_stale_or_wrong_instance_registration_faults_and_reaps_owned_child(self):
        for answer in [{"status": "stale", "instance_id": "invocation-fixture"},
                       {"status": "recorded", "instance_id": "another-instance"}]:
            with self.subTest(answer=answer):
                self.configure("never-read")
                def register(pid, started_at):
                    self.registered.append((pid, started_at))
                    return answer
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke(register)
                self.assertNotIn(str(self.root), str(caught.exception))
                pid = self.registered[-1][0]
                self.assert_reaped(pid)
                self.assert_no_live_group(pid)

    def test_registration_exception_is_a_fixed_fault_after_owned_cleanup(self):
        self.configure("never-read")
        private_detail = "private-registration-detail:" + str(self.root)
        def register(pid, started_at):
            self.registered.append((pid, started_at))
            raise RuntimeError(private_detail)
        with self.assertRaises(wake_adapter.AdapterFault) as caught:
            self.invoke(register)
        self.assertNotIn(private_detail, str(caught.exception))
        self.assertNotIn(self.claim["claim_token"], str(caught.exception))
        pid = self.registered[-1][0]
        self.assert_reaped(pid)
        self.assert_no_live_group(pid)

    def test_delayed_registration_consumes_original_execution_budget(self):
        self.configure("never-read")
        observed = {}
        def register(pid, started_at):
            self.registered.append((pid, started_at))
            observed["begin"] = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
            time.sleep(1.5)
            observed["end"] = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
            return {"status": "recorded", "instance_id": "invocation-fixture"}
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        result = self.invoke(register)
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
        callback_elapsed = (observed["end"] - observed["begin"]) / 1e9
        self.assertGreaterEqual(callback_elapsed, 1.45)
        self.assertEqual(result.outcome, "error")
        self.assertGreaterEqual(elapsed, 4.8)
        self.assertLess(elapsed, 7)
        pid = self.registered[-1][0]
        self.assert_timeout_signal(start, pid)
        self.assert_reaped(pid)
        self.assert_no_live_group(pid)

    def test_cleanup_checks_live_members_before_reaping_and_never_signals_after(self):
        self.configure("descendant")
        order = []
        actual_signal = self.actual_killpg
        def registered(pid, started_at):
            self.registration(pid, started_at)
            child = self.spawned[-1]["child"]
            actual_wait, actual_poll = child.wait, child.poll
            def wait(*args, **kwargs):
                order.append(("wait", tuple(self.live_group_members({pid}))))
                return actual_wait(*args, **kwargs)
            def poll(*args, **kwargs):
                order.append(("poll", ()))
                return actual_poll(*args, **kwargs)
            child.wait, child.poll = wait, poll
            return {"status": "recorded", "instance_id": "invocation-fixture"}
        def signal_group(pid, sig):
            order.append(("signal", sig))
            return actual_signal(pid, sig)
        with mock.patch.object(self, "actual_killpg", side_effect=signal_group):
            try:
                result = self.invoke(registered)
            except wake_adapter.AdapterFault as error:
                self.fail("Owned process ordering control faulted: " + str(error))
        self.assertEqual(result.outcome, "error")
        self.assertTrue(any(kind == "signal" for kind, value in order))
        self.assertFalse(any(kind == "poll" for kind, value in order))
        waits = [i for i, (kind, value) in enumerate(order) if kind == "wait"]
        self.assertEqual(len(waits), 1)
        self.assertEqual(order[waits[0]][1], (), "The broker was reaped with a live descendant")
        self.assertTrue(all(kind != "signal" for kind, value in order[waits[0]+1:]))
        self.assert_reaped(self.spawned[-1]["child"].pid)

    def test_process_observation_failure_is_a_fault_after_confirmed_cleanup(self):
        self.configure("never-read")
        actual = wake_adapter._process_group
        calls = []
        def once(pid, deadline):
            calls.append(pid)
            if len(calls) == 1:
                raise wake_adapter.AdapterFault("process_observation_failed")
            return actual(pid, deadline)
        with mock.patch.object(wake_adapter, "_process_group", side_effect=once):
            with self.assertRaises(wake_adapter.AdapterFault) as caught:
                self.invoke()
        self.assertEqual(str(caught.exception), "process_observation_failed")
        self.assertGreaterEqual(len(calls), 2)
        self.assert_reaped(calls[0])
        self.assert_no_live_group(calls[0])

    def test_unconfirmed_cleanup_retains_child_and_refuses_another_invocation(self):
        self.configure("never-read")
        before = list(wake_adapter._UNCONFIRMED_CHILDREN)
        try:
            with mock.patch.object(wake_adapter, "_process_group",
                    side_effect=wake_adapter.AdapterFault("process_observation_failed")):
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke()
            self.assertEqual(str(caught.exception), "cleanup_unconfirmed")
            self.assertEqual(len(self.spawned), 1)
            child = self.spawned[0]["child"]
            self.assertIs(wake_adapter._UNCONFIRMED_CHILDREN[-1], child)
            self.assertIsNone(child.returncode, "Unconfirmed leader must not be reaped")
            with self.assertRaises(wake_adapter.AdapterFault):
                self.invoke()
            self.assertEqual(len(self.spawned), 1, "Fault must inhibit another broker")
            self.assertEqual(self.group_signals, [], "Ambiguous identity is not permission to signal")
        finally:
            # Only the independently proven fixture cleanup may end these
            # fixture children. This is not adapter cleanup success evidence.
            self.cleanup_brokers()
            wake_adapter._UNCONFIRMED_CHILDREN[:] = before

    def test_process_helper_rejects_malformed_oversized_missing_and_late_output(self):
        child, report = self.start_fixture_broker("cleanup-owned")
        original = subprocess.Popen
        programs = ["print('not a process row')",
                    "import os; os.write(1,b'x'*1048577)",
                    "import os; os.write(1,b''.join(('%d 0 S\\n'%(1000000+i)).encode() for i in range(100000)) + "
                    + repr(('%d %d S\n' % (child.pid, child.pid)).encode()) + ")",
                    "print('1 1 S')",
                    "import time; time.sleep(2)"]
        for code in programs:
            with self.subTest(program=code):
                helpers = []
                def replace_ps(args, *a, **kw):
                    self.assertEqual(args, ["/bin/ps", "-A", "-o", "pid=,pgid=,stat="])
                    helper = original(["/usr/bin/python3", "-c", code], *a, **kw)
                    helpers.append(helper)
                    return helper
                with mock.patch.object(subprocess, "Popen", side_effect=replace_ps):
                    with self.assertRaises(wake_adapter.AdapterFault):
                        wake_adapter._process_group(child.pid,
                            time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) + 1000000000)
                self.assertEqual(len(helpers), 1)
                self.assertIsNotNone(helpers[0].returncode)
                self.assertTrue(helpers[0].stdout.closed)
                self.assert_reaped(helpers[0].pid)
        self.assertIsNone(child.returncode)

    def test_term_ignoring_broker_is_killed_within_cleanup_budget(self):
        self.configure("ignore-term")
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        result = self.invoke()
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
        self.assertEqual((result.outcome, result.reason), ("error", "deadline"))
        self.assertLess(elapsed, 6.5)
        self.assertEqual([row["signal"] for row in self.group_signals], [signal.SIGTERM, signal.SIGKILL])
        self.assert_reaped(self.spawned[-1]["child"].pid)
        self.assert_no_live_group(self.spawned[-1]["child"].pid)


if __name__ == "__main__":
    unittest.main()

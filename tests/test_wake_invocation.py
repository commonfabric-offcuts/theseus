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
import threading
import time
import unittest
from unittest import mock

from aim_next import Store, initialize
from aim_next.profile import write_profile
from aim_next.authority import AuthorityError
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
record = {"pid": os.getpid(), "pgid": os.getpgrp(), "argv": sys.argv[1:],
          "blocked_signals": sorted(int(n) for n in signal.pthread_sigmask(signal.SIG_BLOCK, []))}
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
if mode in ("exit-before-registration", "closed-stdin"):
    if mode == "closed-stdin":
        os.close(0)
        ready = os.open(os.path.join(os.path.dirname(report), "fixture-ready"), os.O_WRONLY)
        os.write(ready, b"R")
        os.close(ready)
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
    sys.exit({"busy": 75, "error": 3, "queued": 10}.get(mode, 0))
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
        for name in ("fixture-stop", "fixture-exit", "fixture-ready"):
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

    def cleanup_deadline(self, seconds=1):
        """The bound a direct cleanup call gets: the floor run_route always grants."""
        return wake_adapter._ticks() + int(seconds * 1000000000)

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
        # 10: the notice was already waiting unread in the agent's chat; nothing new reached it.
        for mode, outcome, code in [("busy", "busy", 75), ("error", "error", 3), ("output", "accepted", 0),
                                    ("queued", "queued", 10)]:
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
                with self.assertRaises(wake_adapter.RouteUnavailable) as caught:
                    self.invoke()
                self.assertEqual(caught.exception.code,"binding_mismatch")
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
        with self.assertRaises(AuthorityError) as caught:
            self.invoke()
        self.assertEqual(caught.exception.code,"INVALID_BINDING")
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
        def once(pid, deadline, **kw):
            calls.append(pid)
            if len(calls) == 1:
                raise wake_adapter.AdapterFault("process_observation_failed")
            return actual(pid, deadline, **kw)
        with mock.patch.object(wake_adapter, "_process_group", side_effect=once):
            with self.assertRaises(wake_adapter.AdapterFault) as caught:
                self.invoke()
        self.assertEqual(str(caught.exception), "process_observation_failed")
        self.assertGreaterEqual(len(calls), 2)
        self.assert_reaped(calls[0])
        self.assert_no_live_group(calls[0])

    def test_unconfirmed_cleanup_retains_child_and_refuses_another_invocation_while_it_stays_unconfirmed(self):
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
                with self.assertRaises(wake_adapter.AdapterFault) as again:
                    self.invoke()
            self.assertEqual(str(again.exception), "cleanup_unconfirmed")
            self.assertIs(wake_adapter._UNCONFIRMED_CHILDREN[-1], child)
            self.assertIsNone(child.returncode)
            self.assertEqual(len(self.spawned), 1, "Fault must inhibit another broker")
            self.assertEqual(self.group_signals, [], "Ambiguous identity is not permission to signal")
        finally:
            # Only the independently proven fixture cleanup may end these
            # fixture children. This is not adapter cleanup success evidence.
            self.cleanup_brokers()
            wake_adapter._UNCONFIRMED_CHILDREN[:] = before

    def test_a_slow_process_list_is_waited_for_within_the_callers_deadline(self):
        # The real ps, but the clock says 300 ms passed while it started, as under
        # heavy load: well inside the caller's second, so the observation stands.
        child, report = self.start_fixture_broker("cleanup-owned")
        actual_ticks, original = wake_adapter._ticks, subprocess.Popen
        started = []
        def slow_ps(args, *a, **kw):
            helper = original(args, *a, **kw)
            started.append(300000000)
            return helper
        deadline = actual_ticks() + 1000000000
        with mock.patch.object(subprocess, "Popen", side_effect=slow_ps), \
                mock.patch.object(wake_adapter, "_ticks", side_effect=lambda: actual_ticks() + sum(started)):
            try:
                members = wake_adapter._process_group(child.pid, deadline)
            except wake_adapter.AdapterFault as fault:
                self.fail("a slow ps inside the caller's deadline failed the observation: %s" % fault)
        self.assertEqual(len(started), 1)
        self.assertIn(child.pid, members)
        self.assertFalse(members[child.pid].startswith("Z"))

    def test_a_child_one_failed_observation_left_unconfirmed_is_confirmed_by_the_next_invocation(self):
        self.configure("normal")
        before = list(wake_adapter._UNCONFIRMED_CHILDREN)
        try:
            with mock.patch.object(wake_adapter, "_process_group",
                    side_effect=wake_adapter.AdapterFault("process_observation_failed")):
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke()
            self.assertEqual(str(caught.exception), "cleanup_unconfirmed")
            left = self.spawned[0]["child"]
            self.assertIs(wake_adapter._UNCONFIRMED_CHILDREN[-1], left)
            # The next invocation observes again: the first broker's group has
            # gone, so its leader is reaped and this wake goes ahead.
            try:
                result = self.invoke()
            except wake_adapter.AdapterFault as fault:
                self.fail("one failed observation refused the next invocation: %s" % fault)
            self.assertEqual((result.outcome, result.reason), ("accepted", "accepted"))
            self.assertEqual(len(self.spawned), 2)
            self.assertNotIn(left, wake_adapter._UNCONFIRMED_CHILDREN)
            self.assert_reaped(left.pid)
        finally:
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

    def slow_ps(self, delay):
        """A stand-in for /bin/ps on a loaded Mac: the real listing, delivered after delay seconds."""
        stand_in = self.root / "slow-ps"
        stand_in.write_text("#!/bin/sh\n/bin/sleep %s\nexec /bin/ps \"$@\"\n" % delay)
        stand_in.chmod(0o700)
        listings = []
        actual = self.actual_popen

        def popen(args, *a, **kw):
            if list(args[:1]) == ["/bin/ps"]:
                listings.append(time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW))
                return actual([str(stand_in)] + list(args[1:]), *a, **kw)
            return actual(args, *a, **kw)
        return popen, listings

    def test_a_slow_process_list_does_not_turn_a_broker_that_exited_into_unconfirmed_cleanup(self):
        # The live pause on a loaded Mac: the broker has exited, but each
        # listing that would confirm it takes 0.6 s, more than the old fixed
        # second allowed for two of them.
        for delay in (0, 0.6):
            with self.subTest(ps_seconds=delay):
                self.configure("normal")
                popen, listings = self.slow_ps(delay)
                self.actual_popen = popen
                before = list(wake_adapter._UNCONFIRMED_CHILDREN)
                start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
                try:
                    result = self.invoke()
                except wake_adapter.AdapterFault as fault:
                    self.fail("a broker that exited became %s with ps taking %ss" % (fault, delay))
                finally:
                    self.actual_popen = subprocess.Popen
                    wake_adapter._UNCONFIRMED_CHILDREN[:] = before
                elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
                self.assertEqual((result.outcome, result.reason), ("accepted", "accepted"))
                # Not vacuous: at least two listings ran through the stand-in, slowly when asked.
                self.assertGreaterEqual(len(listings), 2)
                if delay:
                    self.assertGreaterEqual(elapsed, 2 * delay)
                pid = self.spawned[-1]["child"].pid
                self.assert_reaped(pid)
                self.assert_no_live_group(pid)

    def test_cleanup_waits_for_a_members_exit_event_rather_than_a_fixed_second(self):
        # The leader exits at once and leaves a descendant that no signal
        # reaches (EPERM, as for a member we may not signal); it ends on its
        # own 1.5 s later. Cleanup waits for that exit, listing again only when
        # an exit event or the KILL escalation wakes it.
        self.configure("descendant")
        refused = []

        def refuse(group, sig):
            refused.append(sig)
            raise OSError(errno.EPERM, "fixture: this signal reaches no member")
        release = threading.Timer(1.5, self.close_control, ["fixture-stop"])
        listings = []
        actual_group = wake_adapter._process_group

        def count(pid, deadline, **kw):
            listings.append(pid)
            return actual_group(pid, deadline, **kw)
        before = list(wake_adapter._UNCONFIRMED_CHILDREN)
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        release.start()
        try:
            with mock.patch.object(self, "actual_killpg", side_effect=refuse), \
                    mock.patch.object(wake_adapter, "_process_group", side_effect=count):
                try:
                    result = self.invoke()
                except wake_adapter.AdapterFault as fault:
                    self.fail("a member that exits after a second became %s" % fault)
        finally:
            release.cancel()
            wake_adapter._UNCONFIRMED_CHILDREN[:] = before
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
        self.assertEqual((result.outcome, result.reason), ("error", "surviving_descendant"))
        self.assertEqual(refused, [signal.SIGTERM, signal.SIGKILL])
        self.assertGreaterEqual(elapsed, 1.45)
        # Event-driven: one listing for the exit check, a few around TERM, KILL
        # and the descendant's exit, two to confirm. A 10 ms re-listing loop
        # would make well over a hundred in 1.5 s.
        self.assertLessEqual(len(listings), 10, listings)
        report = json.loads(self.report.read_text())
        self.assert_reaped(report["pid"])
        self.assert_no_live_group(report["pgid"])

    def test_a_group_that_never_goes_is_unconfirmed_only_when_the_runners_lease_ends(self):
        # A member that survives TERM and KILL keeps the runner from going on,
        # but only the runner's lease (here 8 s from now, so about 3 s after the
        # five-second run) bounds the wait, not a fixed second.
        self.configure("never-read")
        now = int(time.time() * 1000)
        self.owner_until = now + 8000
        self.claim["lease_until_ms"] = now + 7600
        before = list(wake_adapter._UNCONFIRMED_CHILDREN)

        def refuse(group, sig):
            raise OSError(errno.EPERM, "fixture: this signal reaches no member")
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        try:
            with mock.patch.object(self, "actual_killpg", side_effect=refuse):
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke()
            elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
            self.assertEqual(str(caught.exception), "cleanup_unconfirmed")
            self.assertGreaterEqual(elapsed, 7.7, "cleanup gave up before the runner's lease ended")
            self.assertLess(elapsed, 9.5)
            child = self.spawned[0]["child"]
            # The fault names the child the pause must wait on.
            self.assertEqual(caught.exception.child, (child.pid, self.registered[0][1]))
            self.assertIs(wake_adapter._UNCONFIRMED_CHILDREN[-1], child)
            self.assertIsNone(child.returncode, "A leader with a live group was reaped")
            self.assertEqual(self.live_group_members({child.pid})[0][0], child.pid)
        finally:
            self.cleanup_brokers()
            wake_adapter._UNCONFIRMED_CHILDREN[:] = before

    def test_waiting_for_a_group_to_go_needs_no_leader_and_never_signals(self):
        # What the supervisor uses: the leader is long reaped, a member lives on
        # until the test lets it end; the wait returns only after that exit.
        child, report = self.start_fixture_broker("descendant")
        self.assertEqual(child.wait(timeout=2), 0)
        self.assertTrue(self.live_group_members({child.pid}), "No live member: the wait is vacuous")
        listings = []
        actual_group = wake_adapter._process_group

        def count(pid, deadline, **kw):
            listings.append(kw.get("leader"))
            return actual_group(pid, deadline, **kw)
        release = threading.Timer(0.5, self.close_control, ["fixture-stop"])
        start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        release.start()
        try:
            with mock.patch.object(os, "killpg", side_effect=AssertionError("an observer signalled")), \
                    mock.patch.object(wake_adapter, "_process_group", side_effect=count):
                wake_adapter.wait_group_gone(child.pid)
        finally:
            release.cancel()
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
        self.assertEqual(self.live_group_members({child.pid}), [])
        self.assertGreaterEqual(elapsed, 0.45)
        self.assertLessEqual(len(listings), 6, "it listed on a timer, not on the member's exit")
        self.assertEqual(set(listings), {False})

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

    def save_observations(self, value):
        (self.root / "observations.json").write_text(json.dumps(value, indent=2) + "\n")

    def release_owned_exit(self, child):
        """Actual NOTE_EXIT and zombie evidence, without reaping our leader."""
        queue = select.kqueue()
        try:
            queue.control([select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                fflags=select.KQ_NOTE_EXIT)], 0, 0)
            os.write(self.controls["fixture-exit"], b"x")
            events = queue.control(None, 1, 1.5)
            self.assertTrue(any(e.ident == child.pid and e.fflags & select.KQ_NOTE_EXIT
                                for e in events), "Owned exit precondition was not observed")
        finally:
            queue.close()
        state = self.process_state(child.pid)
        self.assertIsNotNone(state)
        self.assertEqual(state[0], child.pid)
        self.assertTrue(state[1].startswith("Z"))
        self.assertIsNone(child.returncode)
        return state

    def test_real_exit_between_snapshot_and_signal_is_reobserved(self):
        child, report = self.start_fixture_broker("exit-before-registration")
        observed = []
        actual = self.actual_killpg
        def signal_after_exit(group, sig):
            self.assertEqual(group, child.pid)
            state = self.release_owned_exit(child)
            row = {"signal": int(sig), "state_before_signal": state, "errno": None}
            observed.append(row)
            try:
                return actual(group, sig)
            except OSError as error:
                row["errno"] = error.errno
                raise
        failure = None
        try:
            with mock.patch.object(os, "killpg", side_effect=signal_after_exit):
                try:
                    result = wake_adapter._cleanup_child(child, self.cleanup_deadline())
                except (OSError, wake_adapter.AdapterFault) as error:
                    failure = str(error)
        finally:
            self.save_observations(observed)
        self.assertIsNone(failure, "A real zombie-only killpg race was not reobserved: " + str(failure))
        self.assertEqual(result, (0, False))
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0]["signal"], signal.SIGTERM)
        self.assertIn(observed[0]["errno"], (errno.EPERM, errno.ESRCH))
        self.assert_reaped(child.pid)
        self.assert_no_live_group(child.pid)

    def test_signal_errno_reobservation_advances_term_phase_and_keeps_deadline(self):
        rows = []
        # Synthetic errno controls supplement the actual OS race above. Actual
        # child stays live; an inaccessible group must still fail by its deadline.
        for code in (errno.EPERM, errno.ESRCH):
            with self.subTest(errno=code):
                child, report = self.start_fixture_broker("cleanup-owned")
                signals = []
                start = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
                def refused(group, sig):
                    self.assertEqual(group, child.pid)
                    signals.append({"signal": int(sig), "elapsed":
                        (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9})
                    raise OSError(code, "fixture signal refusal")
                caught = None
                with mock.patch.object(os, "killpg", side_effect=refused):
                    try:
                        wake_adapter._cleanup_child(child, self.cleanup_deadline())
                    except (OSError, wake_adapter.AdapterFault) as error:
                        caught = error
                elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - start) / 1e9
                rows.append({"errno": code, "signals": signals, "elapsed": elapsed,
                             "fault": str(caught)})
                self.assertIsInstance(caught, wake_adapter.AdapterFault,
                                      "Signal errno escaped instead of bounded reobservation")
                # A last observation can consume the remaining cleanup budget.
                # run_route wraps either internal fault as cleanup_unconfirmed.
                self.assertIn(str(caught), ("cleanup_unconfirmed", "process_observation_failed"))
                self.assertEqual([s["signal"] for s in signals], [signal.SIGTERM, signal.SIGKILL])
                self.assertGreaterEqual(signals[1]["elapsed"], .39)
                self.assertLess(signals[1]["elapsed"], .85)
                self.assertGreaterEqual(elapsed, .95)
                self.assertLess(elapsed, 1.5)
                self.assertIsNone(child.returncode)
                self.actual_killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
        self.save_observations(rows)

    def test_one_omitted_live_descendant_cannot_authorize_reap(self):
        child, report = self.start_fixture_broker("descendant")
        # wait for Z without using wait/poll, preserving our owned PGID.
        queue = select.kqueue()
        try:
            try:
                queue.control([select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT)], 0, 0)
                queue.control(None, 1, 1)
            except OSError as error:
                self.assertEqual(error.errno, errno.ESRCH)
        finally:
            queue.close()
        self.assertTrue(self.process_state(child.pid)[1].startswith("Z"))
        original = wake_adapter._process_group
        snapshots = []
        def partial_then_real(pid, deadline, **kw):
            actual = original(pid, deadline, **kw)
            returned = dict(actual)
            if not snapshots:
                self.assertIn(report["descendant"], actual)
                self.assertFalse(actual[report["descendant"]].startswith("Z"))
                returned = {pid: actual[pid]}
            snapshots.append({"actual": actual, "returned": returned})
            return returned
        with mock.patch.object(wake_adapter, "_process_group", side_effect=partial_then_real):
            result = wake_adapter._cleanup_child(child, self.cleanup_deadline())
        self.save_observations(snapshots)
        self.assertEqual(result, (0, True), "One partial snapshot falsely accepted a live descendant")
        self.assertGreaterEqual(len(snapshots), 4)
        self.assertTrue(any(any(not state.startswith("Z") for state in row["returned"].values())
                            for row in snapshots[1:-2]))
        self.assertTrue(all(all(state.startswith("Z") for state in row["returned"].values())
                            for row in snapshots[-2:]), "Live observation must reset empty confirmation")
        self.assert_reaped(child.pid)
        self.assert_no_live_group(child.pid)

    def test_unexpected_signal_errno_is_not_treated_as_an_exit_race(self):
        child, report = self.start_fixture_broker("cleanup-owned")
        caught = None
        started = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        with mock.patch.object(os, "killpg", side_effect=OSError(errno.EBADF, "fixture bad descriptor")):
            try:
                wake_adapter._cleanup_child(child, self.cleanup_deadline())
            except (OSError, wake_adapter.AdapterFault) as error:
                caught = error
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - started) / 1e9
        self.save_observations({"error_type": type(caught).__name__, "elapsed": elapsed})
        self.assertIsInstance(caught, OSError, "An unrelated signal failure was swallowed as an exit race")
        self.assertEqual(caught.errno, errno.EBADF)
        self.assertLess(elapsed, .5)
        self.assertIsNone(child.returncode)

    def test_sigint_inside_popen_return_is_deferred_until_owned_cleanup(self):
        self.configure("never-read")
        original_spawn = self.observe_spawn
        previous = signal.signal(signal.SIGINT, signal.default_int_handler)
        returned = []
        handlers = []
        def interrupt_after_construct(args, *a, **kw):
            child = original_spawn(args, *a, **kw)
            if str(self.script) in args:
                handlers.append(signal.getsignal(signal.SIGINT) is signal.default_int_handler)
                os.kill(os.getpid(), signal.SIGINT)
                returned.append(child.pid)
            return child
        caught = None
        try:
            with mock.patch.object(self, "observe_spawn", side_effect=interrupt_after_construct):
                try:
                    self.invoke()
                except (KeyboardInterrupt, wake_adapter.AdapterFault) as error:
                    caught = error
            self.assertIs(signal.getsignal(signal.SIGINT), signal.default_int_handler)
        finally:
            signal.signal(signal.SIGINT, previous)
        self.save_observations({"returned": returned, "original_handler_at_launch": handlers,
                                "caught": type(caught).__name__})
        self.assertIsInstance(caught, wake_adapter.AdapterFault,
                              "SIGINT escaped before Popen ownership was established")
        self.assertEqual(str(caught), "invocation_fault")
        self.assertEqual(handlers, [False])
        self.assertEqual(returned, [self.spawned[0]["child"].pid])
        self.assert_reaped(returned[0])
        self.assert_no_live_group(returned[0])

    def test_sigterm_deferral_restores_handlers_before_delivery_without_child_mask(self):
        self.configure("normal")
        returned, delivered = [], []
        def original_handler(number, frame):
            delivered.append({"signal": number, "owned": bool(returned),
                              "restored": signal.getsignal(signal.SIGTERM) is original_handler})
        previous = signal.signal(signal.SIGTERM, original_handler)
        original_spawn = self.observe_spawn
        def stop_after_construct(args, *a, **kw):
            child = original_spawn(args, *a, **kw)
            if str(self.script) in args:
                os.kill(os.getpid(), signal.SIGTERM)
                os.kill(os.getpid(), signal.SIGTERM)  # bounded one pending delivery
                returned.append(child.pid)
            return child
        try:
            with mock.patch.object(self, "observe_spawn", side_effect=stop_after_construct):
                result = self.invoke()
            self.assertIs(signal.getsignal(signal.SIGTERM), original_handler)
        finally:
            signal.signal(signal.SIGTERM, previous)
        self.save_observations(delivered)
        self.assertEqual(delivered, [{"signal": signal.SIGTERM, "owned": True, "restored": True}])
        self.assertEqual(result.outcome, "accepted")
        report = json.loads(self.report.read_text())
        self.assertNotIn(signal.SIGTERM, report["blocked_signals"])
        self.assertNotIn(signal.SIGINT, report["blocked_signals"])
        self.assert_reaped(returned[0])

    def test_non_main_thread_refuses_before_popen(self):
        self.configure("normal")
        results, errors = [], []
        original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        def run():
            try:
                results.append(self.invoke())
            except BaseException as error:
                errors.append(type(error).__name__)
        thread = threading.Thread(target=run)
        thread.start()
        thread.join(8)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].outcome, "unavailable")
        self.assert_not_started()
        self.assertEqual({n: signal.getsignal(n) for n in original}, original)

    def test_default_term_during_launch_becomes_fixed_fault_after_cleanup(self):
        self.configure("never-read")
        previous = signal.signal(signal.SIGTERM, signal.SIG_DFL)
        original_spawn = self.observe_spawn
        def stop_after_construct(args, *a, **kw):
            child = original_spawn(args, *a, **kw)
            if str(self.script) in args:
                self.assertTrue(callable(signal.getsignal(signal.SIGTERM)),
                                "Refuse to send actual TERM without verified deferral")
                os.kill(os.getpid(), signal.SIGTERM)
            return child
        try:
            with mock.patch.object(self, "observe_spawn", side_effect=stop_after_construct):
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke()
            self.assertEqual(str(caught.exception), "invocation_interrupted")
            self.assertEqual(signal.getsignal(signal.SIGTERM), signal.SIG_DFL)
        finally:
            signal.signal(signal.SIGTERM, previous)
        self.assert_reaped(self.spawned[0]["child"].pid)
        self.assert_no_live_group(self.spawned[0]["child"].pid)

    def test_ignored_signal_remains_ignored_during_launch(self):
        self.configure("normal")
        previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
        original_spawn = self.observe_spawn
        observed = []
        def ignored_after_construct(args, *a, **kw):
            child = original_spawn(args, *a, **kw)
            if str(self.script) in args:
                observed.append(signal.getsignal(signal.SIGINT))
                os.kill(os.getpid(), signal.SIGINT)
            return child
        try:
            with mock.patch.object(self, "observe_spawn", side_effect=ignored_after_construct):
                result = self.invoke()
            self.assertEqual(signal.getsignal(signal.SIGINT), signal.SIG_IGN)
        finally:
            signal.signal(signal.SIGINT, previous)
        self.assertEqual(observed, [signal.SIG_IGN])
        self.assertEqual(result.outcome, "accepted")
        self.assert_reaped(self.spawned[0]["child"].pid)

    def test_constructor_failure_restores_both_original_handlers(self):
        self.configure("normal")
        original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        def failed_spawn(args, *a, **kw):
            self.assertIn(str(self.script), args)
            self.assertTrue(callable(signal.getsignal(signal.SIGTERM)))
            raise OSError(errno.ENOENT, "fixture launch failure")
        try:
            with mock.patch.object(self, "observe_spawn", side_effect=failed_spawn):
                result = self.invoke()
            self.assertEqual({n: signal.getsignal(n) for n in original}, original)
        finally:
            for number, handler in original.items():
                signal.signal(number, handler)
        self.assertEqual(result.outcome, "unavailable")
        self.assert_not_started()

    def test_constructor_failure_still_delivers_deferred_stop_and_preserves_context(self):
        self.configure("normal")
        for mode in ("flag", "raising", "default"):
            with self.subTest(mode=mode):
                delivered = []
                def handler(number, frame):
                    delivered.append({"signal": number,
                        "restored": signal.getsignal(signal.SIGTERM) is handler})
                    if mode == "raising":
                        raise RuntimeError("fixture stop")
                original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
                expected = signal.SIG_DFL if mode == "default" else handler
                signal.signal(signal.SIGTERM, expected)
                constructor_error = OSError(errno.ENOENT, "fixture constructor failure")
                def failing(args, *a, **kw):
                    self.assertIn(str(self.script), args)
                    current = signal.getsignal(signal.SIGTERM)
                    self.assertTrue(callable(current) and current is not handler,
                                    "Never send actual TERM without verified deferral")
                    os.kill(os.getpid(), signal.SIGTERM)
                    raise constructor_error
                caught = None
                try:
                    with mock.patch.object(self, "observe_spawn", side_effect=failing):
                        try:
                            result = self.invoke()
                        except wake_adapter.AdapterFault as error:
                            caught = error
                    self.assertEqual(signal.getsignal(signal.SIGINT), original[signal.SIGINT])
                    self.assertEqual(signal.getsignal(signal.SIGTERM), expected)
                finally:
                    for number, value in original.items():
                        signal.signal(number, value)
                if mode == "flag":
                    self.assertIsNone(caught)
                    self.assertEqual((result.outcome, result.reason), ("unavailable", "invocation_unavailable"))
                else:
                    self.assertIsInstance(caught, wake_adapter.AdapterFault,
                                          "Deferred interruption was swallowed into unavailable")
                    self.assertEqual(str(caught), "invocation_interrupted" if mode == "default" else "invocation_fault")
                    self.assertIs(caught.__cause__, constructor_error)
                self.assertEqual(delivered, [] if mode == "default" else
                                 [{"signal": signal.SIGTERM, "restored": True}])
                self.assert_not_started()

    def test_both_deferred_signals_are_delivered_once_in_fixed_order_after_restore(self):
        self.configure("never-read")
        original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        delivered = []
        def handler(number, frame):
            delivered.append({"signal": number, "restored":
                all(signal.getsignal(n) is handler for n in original)})
            if number == signal.SIGINT:
                raise RuntimeError("fixture stop")
        original_spawn = self.observe_spawn
        def stopped(args, *a, **kw):
            child = original_spawn(args, *a, **kw)
            if str(self.script) in args:
                os.kill(os.getpid(), signal.SIGTERM)
                os.kill(os.getpid(), signal.SIGINT)
            return child
        try:
            for number in original:
                signal.signal(number, handler)
            with mock.patch.object(self, "observe_spawn", side_effect=stopped):
                with self.assertRaises(wake_adapter.AdapterFault):
                    self.invoke()
            self.assertTrue(all(signal.getsignal(n) is handler for n in original))
        finally:
            for number, value in original.items():
                signal.signal(number, value)
        self.save_observations(delivered)
        self.assertEqual(delivered, [{"signal": signal.SIGINT, "restored": True},
                                     {"signal": signal.SIGTERM, "restored": True}])
        self.assert_reaped(self.spawned[0]["child"].pid)

    def test_constructor_failure_drains_both_signals_when_first_handler_raises(self):
        self.configure("normal")
        original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        delivered = []
        constructor_error = OSError(errno.ENOENT, "fixture constructor failure")
        def handler(number, frame):
            delivered.append({"signal": number, "restored":
                all(signal.getsignal(n) is handler for n in original)})
            if number == signal.SIGINT:
                raise RuntimeError("fixture stop")
        def stopped(args, *a, **kw):
            self.assertIn(str(self.script), args)
            self.assertTrue(all(callable(signal.getsignal(n)) and signal.getsignal(n) is not handler
                                for n in original))
            os.kill(os.getpid(), signal.SIGTERM)
            os.kill(os.getpid(), signal.SIGINT)
            raise constructor_error
        try:
            for number in original:
                signal.signal(number, handler)
            with mock.patch.object(self, "observe_spawn", side_effect=stopped):
                with self.assertRaises(wake_adapter.AdapterFault) as caught:
                    self.invoke()
            self.assertIs(caught.exception.__cause__, constructor_error)
            self.assertTrue(all(signal.getsignal(n) is handler for n in original))
        finally:
            for number, value in original.items():
                signal.signal(number, value)
        self.save_observations(delivered)
        self.assertEqual(delivered, [{"signal": signal.SIGINT, "restored": True},
                                     {"signal": signal.SIGTERM, "restored": True}])
        self.assert_not_started()

    def test_partial_signal_install_failure_restores_handlers_without_spawn(self):
        self.configure("normal")
        original = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        actual = signal.signal
        installed = []
        def fail_second(number, handler):
            if number == signal.SIGTERM and handler is not original[number]:
                raise ValueError("fixture install refusal")
            installed.append(number)
            return actual(number, handler)
        try:
            with mock.patch.object(signal, "signal", side_effect=fail_second):
                result = self.invoke()
            self.assertEqual({n: signal.getsignal(n) for n in original}, original)
        finally:
            for number, handler in original.items():
                actual(number, handler)
        self.assertEqual(result.outcome, "unavailable")
        self.assert_not_started()
        self.assertEqual(installed, [signal.SIGINT, signal.SIGINT])

    def test_wall_clock_expiry_after_spawn_cuts_off_before_elapsed_deadline(self):
        self.configure("never-read")
        actual_time = time.time
        def now():
            return (self.claim["lease_until_ms"] + 1) / 1000 if self.registered else actual_time()
        started = time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)
        with mock.patch.object(time, "time", side_effect=now):
            result = self.invoke()
        elapsed = (time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) - started) / 1e9
        self.save_observations({"elapsed": elapsed, "reason": result.reason})
        self.assertEqual((result.outcome, result.reason), ("error", "deadline"))
        self.assertLess(elapsed, 1.5, "Wall lease expiry waited for the five-second elapsed deadline")
        self.assert_reaped(self.spawned[0]["child"].pid)
        self.assert_no_live_group(self.spawned[0]["child"].pid)

    def test_real_epipe_then_gated_zero_exit_remains_accepted(self):
        self.configure("closed-stdin")
        writes = []
        actual = os.write
        def registration(pid, started_at):
            ready = self.controls["fixture-ready"]
            self.assertTrue(select.select([ready], [], [], 1.5)[0])
            self.assertEqual(os.read(ready, 1), b"R")
            return self.registration(pid, started_at)
        def observe_write(fd, data):
            child = self.spawned[0]["child"] if self.spawned else None
            if child is None or child.stdin.closed or fd != child.stdin.fileno():
                return actual(fd, data)
            try:
                return actual(fd, data)
            except BrokenPipeError as error:
                writes.append(error.errno)
                actual(self.controls["fixture-exit"], b"x")
                raise
        caught = None
        with mock.patch.object(os, "write", side_effect=observe_write):
            try:
                result = self.invoke(registration)
            except wake_adapter.AdapterFault as error:
                caught = str(error)
        self.save_observations({"errno": writes, "fault": caught})
        self.assertIsNone(caught, "EPIPE must still await the owned child's actual exit")
        self.assertEqual(writes, [errno.EPIPE])
        self.assertEqual((result.outcome, result.exit_code), ("accepted", 0))
        self.assert_reaped(self.spawned[0]["child"].pid)

    def test_process_helper_rejects_duplicate_garbled_nonzero_and_valid_cap_plus_one(self):
        child, report = self.start_fixture_broker("cleanup-owned")
        row = "%d %d S\n" % (child.pid, child.pid)
        # Exactly cap+one bytes, still valid and unique process rows. Without
        # the guard, the next zero-length os.read looks like EOF and accepts it.
        payload = row.encode()
        padded = b"1 0 S" + b" " * (wake_adapter._PS_LIMIT + 1 - len(payload) - 6) + b"\n"
        payload += padded
        self.assertEqual(len(payload), wake_adapter._PS_LIMIT + 1)
        self.assertEqual(len(payload.splitlines()), 2)
        data_path = self.root / "ps-output"
        data_path.write_bytes(payload)
        programs = ["print(" + repr(row + row) + ", end='')",
                    "print(" + repr(row.replace(" S", " !")) + ", end='')",
                    "import sys; print(" + repr(row) + ", end=''); sys.exit(3)",
                    "import sys; sys.stdout.buffer.write(open(" + repr(str(data_path)) + ",'rb').read())"]
        observations = []
        for code in programs:
            with self.subTest(program=code):
                helpers = []
                def substitute(args, *a, **kw):
                    self.assertEqual(args, ["/bin/ps", "-A", "-o", "pid=,pgid=,stat="])
                    helper = self.actual_popen(["/usr/bin/python3", "-c", code], *a, **kw)
                    helpers.append(helper)
                    return helper
                with mock.patch.object(subprocess, "Popen", side_effect=substitute):
                    with self.assertRaises(wake_adapter.AdapterFault):
                        wake_adapter._process_group(child.pid,
                            time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW) + 1000000000)
                self.assertEqual(len(helpers), 1)
                self.assertIsNotNone(helpers[0].returncode)
                self.assertTrue(helpers[0].stdout.closed)
                self.assert_reaped(helpers[0].pid)
                observations.append({"program": code, "returncode": helpers[0].returncode})
        self.save_observations(observations)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import http.client
import json
import socket
import struct
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from aim_next import server as http_server


def eventually(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.002)
    raise AssertionError("Expected bounded observation did not arrive")


class StoreProbe:
    def __init__(self):
        self.lock = threading.Lock()
        self.events = []
        self.holds = {}
        self.created = 0
        self.closed = 0
        self.fail_factory = False

    def hold(self, name, phase="callback"):
        entered, release = threading.Event(), threading.Event()
        self.holds[(name, phase)] = (entered, release)
        return entered, release

    def step(self, name, phase):
        with self.lock:
            self.events.append((name, phase))
        pair = self.holds.get((name, phase))
        if pair:
            pair[0].set()
            if not pair[1].wait(5):
                raise AssertionError("Fixture hold was not released")

    def factory(self):
        with self.lock:
            self.created += 1
        if self.fail_factory:
            raise RuntimeError("Factory failure")
        probe = self

        class Store:
            name = "unentered"

            def view(self, actor, name, args):
                self.name = name
                probe.step(name, "callback")
                if name == "explode":
                    raise RuntimeError("Callback failure")
                if name == "capabilities":
                    return {"instance_id": "admission-test", "limits": {}, "authority": {
                        "authority_id": "test-anchor", "authority_epoch": "test-epoch",
                        "continuity": "initial"}}
                return {"instance_id": "admission-test", "name": name}

            def command(self, actor, envelope):
                self.name = "command"
                probe.step(self.name, "callback")
                return {"recorded": True, "status": "committed"}

            def close(self):
                try:
                    probe.step(self.name, "close")
                    if self.name == "close-explode":
                        raise RuntimeError("Close failure")
                finally:
                    with probe.lock:
                        probe.closed += 1
        return Store()


class HTTPReadAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.probe = StoreProbe()
        self.server = http_server.create_server(self.probe.factory, "admission-test", "fixture-actor",
                                                Path(self.tmp.name), token="fixture-session")
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.pool = ThreadPoolExecutor(max_workers=12)
        self.handler_errors = []
        self.server.handle_error = lambda *args: self.handler_errors.append(True)
        self.transitions = []
        self.admission().observer = self.transitions.append

    def tearDown(self):
        for _, release in self.probe.holds.values():
            release.set()
        self.pool.shutdown(wait=True)
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(2)
        self.assertFalse(self.worker.is_alive())
        # Joining the handlers includes response writes, which occur after a
        # released read permit. Checking at release alone can miss their errors.
        self.assertEqual(self.handler_errors, [])
        self.tmp.cleanup()

    def request(self, name="topic", read_class=None, path="/api/view", duplicate=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=7)
        try:
            payload = {"name": name, "args": {}}
            if path == "/api/command":
                payload = {"v": 1, "instance_id": "admission-test", "operation_id": "fixture-send",
                           "kind": "message.send", "target": {}, "expected": {}, "args": {}}
            body = json.dumps(payload).encode()
            connection.putrequest("GET" if path == "/api/bootstrap" else "POST", path)
            connection.putheader("Authorization", "Bearer fixture-session")
            connection.putheader("Origin", self.server.origin)
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(len(body)))
            if read_class is not None:
                connection.putheader("X-AIM-Read-Class", read_class)
            if duplicate is not None:
                connection.putheader("X-AIM-Read-Class", duplicate)
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def admission(self):
        return self.server.read_admission

    def queued(self, read_class, count):
        eventually(lambda: self.admission().snapshot()[read_class]["waiting"] == count)

    def test_bootstrap_advertises_actual_fixed_partition(self):
        status, body = self.request(path="/api/bootstrap")
        self.assertEqual(status, 200)
        expected = {"version": 1, "header": "X-AIM-Read-Class",
                    "foreground": {"slots": 1, "max_waiters": 8, "queue_timeout_ms": 5000},
                    "background": {"slots": 1, "max_waiters": 2, "queue_timeout_ms": 500}}
        self.assertEqual(body.get("transport", {}).get("read_admission"), expected)
        self.assertEqual(self.admission().capability(), expected)

    def test_nondefault_read_limits_keep_legacy_admission_without_capability(self):
        for limit in (1, 3):
            server = http_server.create_server(self.probe.factory, "admission-test", "fixture-actor",
                                               Path(self.tmp.name), max_reads=limit)
            try:
                self.assertIsNone(server.read_admission)
                self.assertEqual(sum(server.read_slots.acquire(False) for _ in range(limit + 1)), limit)
            finally:
                server.server_close()

    def test_invalid_and_duplicate_classes_refuse_before_store(self):
        for path in ("/api/view", "/api/bootstrap"):
            for value, duplicate in (("else", None), ("BACKGROUND", None), ("", None),
                                     ("foreground", "background"), ("background", "background")):
                with self.subTest(path=path, value=value, duplicate=duplicate):
                    before = self.probe.created
                    status, body = self.request(read_class=value, duplicate=duplicate, path=path)
                    self.assertEqual(status, 400)
                    self.assertEqual(body["error"]["code"], "INVALID_READ_CLASS")
                    self.assertFalse(body["recorded"])
                    self.assertEqual(self.probe.created, before)

    def test_background_holds_one_slot_and_foreground_and_commands_progress(self):
        entered, release = self.probe.hold("bg-first")
        first = self.pool.submit(self.request, "bg-first", "background")
        self.assertTrue(entered.wait(1))
        second = self.pool.submit(self.request, "bg-second", "background")
        self.queued("background", 1)
        self.assertNotIn(("bg-second", "callback"), self.probe.events)
        self.assertEqual(self.request("foreground")[0], 200)
        self.assertEqual(self.request(path="/api/command", read_class="invalid")[0], 200)
        self.assertFalse(first.done())
        release.set()
        self.assertEqual(first.result()[0], 200)
        self.assertEqual(second.result()[0], 200)

    def test_close_owns_permit_until_it_finishes(self):
        entered, release = self.probe.hold("closing", "close")
        first = self.pool.submit(self.request, "closing", "background")
        self.assertTrue(entered.wait(1))
        second = self.pool.submit(self.request, "after-close", "background")
        self.queued("background", 1)
        self.assertNotIn(("after-close", "callback"), self.probe.events)
        self.assertEqual(self.request("fg-during-close")[0], 200)
        release.set()
        self.assertEqual(first.result()[0], 200)
        self.assertEqual(second.result()[0], 200)

    def test_background_queue_full_expiry_and_no_late_store(self):
        entered, release = self.probe.hold("held")
        first = self.pool.submit(self.request, "held", "background")
        self.assertTrue(entered.wait(1))
        waiters = [self.pool.submit(self.request, "expired-%d" % n, "background") for n in range(2)]
        self.queued("background", 2)
        before = self.probe.created
        overflow_id = self.admission().number + 1
        full = self.pool.submit(self.request, "over-capacity", "background")
        eventually(lambda: any(e["request_id"] == overflow_id for e in self.transitions))
        self.assertEqual([e["event"] for e in self.transitions if e["request_id"] == overflow_id], ["full"])
        status, body = full.result(timeout=1)
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "SERVER_BUSY")
        self.assertTrue(body["error"]["retryable"])
        self.assertFalse(body["recorded"])
        for waiter in waiters:
            self.assertEqual(waiter.result(timeout=1)[0], 503)
        self.assertEqual(self.probe.created, before)
        self.assertEqual(self.admission().snapshot()["background"], {"active": 1, "waiting": 0})
        release.set()
        self.assertEqual(first.result()[0], 200)
        self.assertEqual(self.request("next", "background")[0], 200)
        self.assertFalse(any(name.startswith("expired") for name, _ in self.probe.events))

    def test_default_and_explicit_foreground_share_fifo_without_borrowing(self):
        entered, release = self.probe.hold("first")
        first = self.pool.submit(self.request, "first")
        self.assertTrue(entered.wait(1))
        second = self.pool.submit(self.request, "second", "foreground")
        self.queued("foreground", 1)
        third = self.pool.submit(self.request, "third")
        self.queued("foreground", 2)
        self.assertEqual(self.request("separate", "background")[0], 200)
        self.assertNotIn(("second", "callback"), self.probe.events)
        release.set()
        self.assertEqual([f.result()[0] for f in (first, second, third)], [200, 200, 200])
        self.assertEqual([n for n, p in self.probe.events if p == "callback" and n != "separate"],
                         ["first", "second", "third"])

    def test_factory_callback_and_close_errors_all_release(self):
        self.probe.fail_factory = True
        self.assertEqual(self.request()[0], 500)
        self.assertEqual(self.admission().snapshot()["foreground"], {"active": 0, "waiting": 0})
        self.probe.fail_factory = False
        for name in ("explode", "close-explode", "okay"):
            self.assertEqual(self.request(name)[0], 200 if name == "okay" else 500)
        self.assertEqual(self.admission().snapshot()["foreground"], {"active": 0, "waiting": 0})
        self.assertEqual(self.probe.closed, 3)

    def test_waiting_deadline_is_capped_by_original_handler_deadline(self):
        entered, release = self.probe.hold("held")
        first = self.pool.submit(self.request, "held")
        self.assertTrue(entered.wait(1))
        self.server.request_timeout = 0.12
        start = time.monotonic()
        self.assertEqual(self.request("expired")[0], 503)
        self.assertLess(time.monotonic() - start, 0.8)
        self.assertNotIn(("expired", "callback"), self.probe.events)
        release.set()
        self.assertEqual(first.result()[0], 200)

    def raw_view(self, name, read_class):
        sock = socket.create_connection(self.server.server_address, timeout=2)
        body = json.dumps({"name": name, "args": {}}).encode()
        headers = ("POST /api/view HTTP/1.1\r\nHost: %s\r\nOrigin: %s\r\n"
                   "Authorization: Bearer fixture-session\r\nContent-Type: application/json\r\n"
                   "X-AIM-Read-Class: %s\r\nContent-Length: %d\r\n\r\n" %
                   (self.server.authority, self.server.origin, read_class, len(body))).encode()
        sock.sendall(headers + body)
        return sock

    def reset_socket(self, sock):
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        sock.close()

    def test_observed_reset_withdraws_queued_but_not_active_callback(self):
        entered, release = self.probe.hold("active")
        active = self.raw_view("active", "background")
        self.assertTrue(entered.wait(1))
        waiting = self.raw_view("withdrawn", "background")
        self.queued("background", 1)
        queued = next(e for e in self.transitions if e["event"] == "queued")
        self.reset_socket(waiting)
        self.queued("background", 0)
        ended = [e for e in self.transitions if e["request_id"] == queued["request_id"] and e["event"] != "queued"]
        self.assertEqual([e["event"] for e in ended], ["withdrawn"])
        self.assertLess(ended[0]["at"], queued["at"] + 0.5)
        self.reset_socket(active)
        self.assertEqual(self.admission().snapshot()["background"]["active"], 1)
        self.assertEqual(self.request("fg-after-reset")[0], 200)
        release.set()
        eventually(lambda: self.admission().snapshot()["background"]["active"] == 0)
        self.assertNotIn(("withdrawn", "callback"), self.probe.events)

    def test_read_half_close_still_receives_its_response(self):
        entered, release = self.probe.hold("first")
        first = self.pool.submit(self.request, "first", "background")
        self.assertTrue(entered.wait(1))
        sock = self.raw_view("half-close", "background")
        try:
            sock.shutdown(socket.SHUT_WR)
            self.queued("background", 1)
            release.set()
            response = http.client.HTTPResponse(sock)
            response.begin()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["name"], "half-close")
            self.assertEqual(first.result()[0], 200)
        finally:
            sock.close()


class DeterministicReadAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.now = 10.0
        self.admission = http_server.ReadAdmission(clock=lambda: self.now)
        self.transitions = []
        self.admission.observer = self.transitions.append
        self.pool = ThreadPoolExecutor(max_workers=3)
        self.tickets = []

    def tearDown(self):
        self.now += 100
        for ticket in self.tickets:
            if ticket.state == "granted":
                self.admission.release(ticket)
        self.pool.shutdown(wait=True)

    def acquire(self, read_class="background", deadline=100, disconnected=lambda: False):
        ticket = self.admission.acquire(read_class, deadline, disconnected)
        self.tickets.append(ticket)
        return ticket

    def queued(self, count):
        eventually(lambda: self.admission.snapshot()["background"]["waiting"] == count)

    def test_release_at_head_expiry_grants_next_and_leaks_no_permit(self):
        first = self.acquire()
        expired = self.pool.submit(self.acquire, deadline=10.2)
        self.queued(1)
        next_one = self.pool.submit(self.acquire, deadline=10.4)
        self.queued(2)
        self.now = 10.2
        self.admission.release(first)
        with self.assertRaises(http_server.RequestError):
            expired.result(timeout=0.2)
        granted = next_one.result(timeout=0.2)
        self.admission.release(granted)
        self.assertEqual(self.admission.snapshot()["background"], {"active": 0, "waiting": 0})
        later = self.acquire()
        self.admission.release(later)

    def test_granted_ticket_remains_owned_after_deadline_before_waiter_resumes(self):
        first = self.acquire()
        # Pause the waiter's own Event.wait AFTER it wakes, before acquire rechecks.
        paused, resume = threading.Event(), threading.Event()
        original_event = self.admission.event_factory

        class PausedEvent:
            def __init__(self):
                self.event = original_event()

            def set(self):
                self.event.set()

            def wait(self, timeout):
                signaled = self.event.wait(timeout)
                if signaled:
                    paused.set()
                    if not resume.wait(2):
                        raise AssertionError("Fixture waiter not resumed")
                return signaled

        self.admission.event_factory = PausedEvent
        waiting = self.pool.submit(self.acquire)
        self.queued(1)
        self.admission.release(first)
        self.assertTrue(paused.wait(1))
        self.now = 11.0
        resume.set()
        granted = waiting.result(timeout=0.2)
        self.assertEqual(granted.state, "granted")
        self.admission.release(granted)
        self.assertEqual(self.admission.snapshot()["background"]["active"], 0)

    def test_two_waiters_wake_head_promptly_and_preserve_fifo(self):
        first = self.acquire()
        events = []

        def event_factory():
            event = threading.Event()
            events.append(event)
            return event

        self.admission.event_factory = event_factory
        second = self.pool.submit(self.acquire)
        self.queued(1)
        third = self.pool.submit(self.acquire)
        self.queued(2)
        self.admission.release(first)
        # Observe the actual head signal synchronously, independent of the
        # waiter's periodic disconnect observation and OS thread scheduling.
        self.assertTrue(events[0].is_set())
        self.assertFalse(events[1].is_set())
        second_ticket = second.result(timeout=0.2)
        self.assertFalse(third.done())
        self.admission.release(second_ticket)
        third_ticket = third.result(timeout=0.2)
        self.admission.release(third_ticket)

    def test_observed_withdrawal_never_receives_a_grant(self):
        first = self.acquire()
        disconnected = threading.Event()
        waiting = self.pool.submit(self.acquire, disconnected=disconnected.is_set)
        self.queued(1)
        disconnected.set()
        self.admission.release(first)
        with self.assertRaises(ConnectionResetError):
            waiting.result(timeout=0.2)
        self.assertEqual(self.admission.snapshot()["background"], {"active": 0, "waiting": 0})

    def assert_queue_bound(self, read_class, count):
        # Test the same admission path with real waiter threads; no fake counts.
        self.pool.shutdown()
        self.pool = ThreadPoolExecutor(max_workers=count + 1)
        first = self.acquire(read_class)
        waiting = [self.pool.submit(self.acquire, read_class) for _ in range(count)]
        eventually(lambda: self.admission.snapshot()[read_class]["waiting"] == count)
        overflow_id = self.admission.number + 1
        overflow = self.pool.submit(self.acquire, read_class)
        eventually(lambda: any(e["request_id"] == overflow_id for e in self.transitions))
        self.assertEqual([e["event"] for e in self.transitions if e["request_id"] == overflow_id], ["full"])
        with self.assertRaises(http_server.RequestError):
            overflow.result(timeout=0.2)
        self.now += 6
        self.admission.release(first)
        for future in waiting:
            with self.assertRaises(http_server.RequestError):
                future.result(timeout=0.2)
        self.assertEqual(self.admission.snapshot()[read_class], {"active": 0, "waiting": 0})

    def test_foreground_queue_limit_is_eight_waiters(self):
        self.assert_queue_bound("foreground", 8)

    def test_background_queue_limit_is_two_waiters(self):
        self.assert_queue_bound("background", 2)


if __name__ == "__main__":
    unittest.main()

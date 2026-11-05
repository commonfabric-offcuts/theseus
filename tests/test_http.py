from __future__ import annotations

import http.client
import json
import socket
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

from aim_next.server import create_server


class FakeStore:
    def __init__(self):
        self.calls = []
        self.read_started = threading.Event()
        self.release_read = threading.Event()
        self.command_started = threading.Event()
        self.release_command = threading.Event()
        self.authority = {"authority_id": "authority-test", "authority_epoch": "epoch-test",
                          "continuity": "initial"}

    def command(self, actor, envelope):
        self.calls.append(("command", actor, envelope))
        if envelope["kind"] == "explode":
            raise RuntimeError("private database path and token must not escape")
        if envelope["kind"] == "blocked-command" or envelope["args"].get("hold"):
            self.command_started.set()
            self.release_command.wait(5)
        return {"instance_id": "new-test", "operation_id": envelope["operation_id"],
                "kind": envelope["kind"], "status": "committed", "recorded": True,
                "result": {"message_id": "m-one"}, "affected": []}

    def view(self, actor, name, args):
        self.calls.append(("view", actor, name, args))
        if name == "capabilities":
            return {"instance_id": "new-test", "limits": {"body_utf8_bytes": 1048576, "recipients": 32},
                    "authority": self.authority}
        if name == "blocked":
            self.read_started.set()
            self.release_read.wait(5)
        return {"instance_id": "new-test", "items": [], "relevant_versions": {"topic": 7}}


class HTTPContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.web = self.root / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text('<meta name="aim-next-session" content="__AIM_SESSION_TOKEN__">')
        (self.web / "app.js").write_text("export const ready = true;")
        (self.web / "editor.mjs").write_text("export const ready = true;")
        (self.root / "private.txt").write_text("private record")
        (self.web / "leak.js").symlink_to(self.root / "private.txt")
        self.store = FakeStore()
        self.command_pin = {key: self.store.authority[key] for key in ("authority_id", "authority_epoch")}
        self.server = create_server(lambda: self.store, "new-test", "test-owner", self.web,
                                    port=0, token="test-session", max_json_bytes=2048, max_reads=1)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = "http://127.0.0.1:%s" % self.port

    def tearDown(self):
        self.store.release_read.set()
        self.store.release_command.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.tmp.cleanup()

    def request(self, path, payload=None, method="POST", extra=None, authenticated=True):
        headers = {"Origin": self.origin, "Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer test-session"
        headers.update(extra or {})
        body = json.dumps(payload).encode() if payload is not None else None
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read()
            return response.status, dict(response.getheaders()), data
        finally:
            connection.close()

    def command(self, **changes):
        command = {"v": 1, "instance_id": "new-test", "operation_id": "send-A",
                   "kind": "message.send", "target": {"topic_id": "t1"},
                   "expected": {"authority": dict(self.command_pin)}, "args": {"submission_id": "s1"}}
        command.update(changes)
        return command

    def test_actor_and_receipt_are_bound_to_store_contract(self):
        envelope = self.command()
        status, _, raw = self.request("/api/command", envelope)
        self.assertEqual(status, 200)
        self.assertEqual(self.store.calls, [("command", "test-owner", envelope)])
        receipt = json.loads(raw)
        self.assertEqual((receipt["kind"], receipt["operation_id"], receipt["recorded"]),
                         ("message.send", "send-A", True))
        status, _, raw = self.request("/api/command", self.command(actor="someone-else"))
        self.assertEqual(status, 400)
        self.assertFalse(json.loads(raw)["recorded"])
        self.assertEqual(len(self.store.calls), 1)

    def test_cross_origin_host_and_missing_session_cannot_reach_store(self):
        for options in ({"authenticated": False}, {"extra": {"Origin": "https://other.example"}},
                        {"extra": {"Host": "other.example:%s" % self.port}}):
            with self.subTest(options=options):
                status, _, raw = self.request("/api/command", self.command(), **options)
                self.assertIn(status, (401, 403))
                self.assertFalse(json.loads(raw)["recorded"])
        self.assertEqual(self.store.calls, [])

    def test_transport_refusal_never_claims_an_operation_outcome(self):
        for path, payload, method, expected in [
            ("/api/command", self.command(args={"body": "x" * 2048}), "POST", 413),
            ("/api/command", None, "GET", 405),
            ("/api/unknown", self.command(), "POST", 404),
            ("/api/command", [], "POST", 400),
        ]:
            with self.subTest(path=path, method=method, expected=expected):
                status, _, raw = self.request(path, payload, method)
                self.assertEqual(status, expected)
                self.assertFalse(json.loads(raw)["recorded"])
        self.assertEqual(self.store.calls, [])

    def test_private_errors_and_static_path_escape_are_not_exposed(self):
        status, _, raw = self.request("/api/command", self.command(kind="explode"))
        self.assertEqual(status, 500)
        self.assertFalse(json.loads(raw)["recorded"])
        self.assertFalse(json.loads(raw)["error"]["retryable"])
        self.assertNotIn(b"private database", raw)
        for path in ("/../private.txt", "/%2e%2e/private.txt", "/leak.js", "/private.sqlite3"):
            with self.subTest(path=path):
                status, _, raw = self.request(path, method="GET")
                self.assertEqual(status, 404)
                self.assertNotIn(b"private record", raw)

    def test_shell_and_bootstrap_share_session_and_backend_limits(self):
        status, headers, raw = self.request("/", method="GET", authenticated=False)
        self.assertEqual(status, 200)
        self.assertIn(b'content="test-session"', raw)
        self.assertNotIn(b"__AIM_SESSION_TOKEN__", raw)
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, headers, raw = self.request("/editor.mjs", method="GET", authenticated=False)
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertEqual(raw, b"export const ready = true;")
        status, _, raw = self.request("/api/bootstrap", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"instance_id": "new-test", "actor": "test-owner",
                                         "limits": {"body_utf8_bytes": 1048576, "recipients": 32},
                                         "authority": self.store.authority})

    def test_bootstrap_forwards_authority_facts_without_inventing_continuity(self):
        for continuity in ("initial", "complete", "incomplete", "unknown"):
            with self.subTest(continuity=continuity):
                self.store.authority = {"authority_id": "test-current-authority",
                                        "authority_epoch": "test-current-epoch",
                                        "continuity": continuity}
                status, _, raw = self.request("/api/bootstrap", method="GET")
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(raw).get("authority"), self.store.authority)

    def test_bootstrap_refuses_missing_or_malformed_authority_facts(self):
        valid = dict(self.store.authority)
        for value in (None, {}, dict(valid, authority_epoch=""),
                      dict(valid, continuity=True), dict(valid, continuity="assumed"),
                      dict(valid, authority_path="/private/control/authority.json")):
            with self.subTest(value=value):
                self.store.authority = value
                status, _, raw = self.request("/api/bootstrap", method="GET")
                self.assertEqual(status, 503)
                result = json.loads(raw)
                self.assertFalse(result["recorded"])
                self.assertNotIn("authority", result)
                self.assertNotIn(b"/private/control", raw)

    def test_blocked_background_read_does_not_hold_foreground_command_lane(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            blocked = executor.submit(self.request, "/api/view", {"name": "blocked", "args": {}})
            try:
                self.assertTrue(self.store.read_started.wait(1))
                status, _, raw = self.request("/api/view", {"name": "topic", "args": {}})
                self.assertEqual(status, 503)
                self.assertFalse(json.loads(raw)["recorded"])
                status, _, raw = self.request("/api/command", self.command())
                self.assertEqual(status, 200)
                self.assertTrue(json.loads(raw)["recorded"])
                self.assertFalse(blocked.done())
            finally:
                self.store.release_read.set()
            self.assertEqual(blocked.result()[0], 200)

    def test_read_through_reports_never_take_a_command_slot(self):
        held = self.command(kind="topic.read_through", operation_id="through-held", args={"seq": 4, "hold": True})
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.request, "/api/command", held)
            try:
                self.assertTrue(self.store.command_started.wait(1))
                # A second report is refused at once in its own lane...
                status, _, raw = executor.submit(self.request, "/api/command", dict(held, operation_id="through-more")).result(timeout=2)
                self.assertEqual(status, 503)
                self.assertFalse(json.loads(raw)["recorded"])
                # ...and a send still finds both command slots free.
                for operation in ("send-A", "send-B"):
                    status, _, raw = self.request("/api/command", self.command(operation_id=operation))
                    self.assertEqual(status, 200)
                    self.assertTrue(json.loads(raw)["recorded"])
                self.assertFalse(first.done())
            finally:
                self.store.release_command.set()
            self.assertEqual(first.result()[0], 200)
        self.assertEqual([call[2]["operation_id"] for call in self.store.calls if call[0] == "command"], ["through-held", "send-A", "send-B"])

    def test_a_mark_takes_a_command_slot_not_the_read_through_lane(self):
        held = self.command(kind="topic.read_through", operation_id="through-held", args={"seq": 4, "hold": True})
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(self.request, "/api/command", held)
            try:
                self.assertTrue(self.store.command_started.wait(1))
                status, _, raw = self.request("/api/command", self.command(
                    kind="message.mark", operation_id="mark-A", target={"message_id": "m1"}, args={"marked": True}))
                self.assertEqual(status, 200)
                self.assertTrue(json.loads(raw)["recorded"])
                self.assertFalse(first.done())
            finally:
                self.store.release_command.set()
            self.assertEqual(first.result()[0], 200)

    def test_graceful_close_waits_for_an_admitted_command(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = executor.submit(self.request, "/api/command", self.command(kind="blocked-command"))
            try:
                self.assertTrue(self.store.command_started.wait(1))
                self.server.shutdown()
                closing = executor.submit(self.server.server_close)
                with self.assertRaises(TimeoutError):
                    closing.result(timeout=0.1)
            finally:
                self.store.release_command.set()
            status, _, raw = pending.result()
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(raw)["recorded"])
            closing.result(timeout=2)

    def raw_request(self, request):
        with socket.create_connection(self.server.server_address, timeout=2) as sock:
            sock.sendall(request)
            response = http.client.HTTPResponse(sock)
            response.begin()
            return response.status, response.getheader("Content-Type"), response.read()

    def test_parser_errors_are_unconfirmed_json_and_ambiguous_headers_refused(self):
        host = self.server.authority.encode()
        for raw, expected in [
            (b"BOGUS / HTTP/1.0\r\nHost: " + host + b"\r\n\r\n", 501),
            (b"GET / too many words\r\n\r\n", 400),
            (b"GET / HTTP/1.0\r\nX-Large: " + b"x" * 70000 + b"\r\n\r\n", 431),
            (b"GET / HTTP/1.0\r\nHost: " + host + b"\r\nHost: " + host + b"\r\n\r\n", 403),
        ]:
            with self.subTest(expected=expected, prefix=raw[:30]):
                status, content_type, data = self.raw_request(raw)
                self.assertEqual(status, expected)
                self.assertIn("application/json", content_type)
                self.assertFalse(json.loads(data)["recorded"])
                if expected in (400, 431, 501):
                    self.assertEqual(json.loads(data)["error"]["code"], "HTTP_%s" % expected)
        for header in (b"Authorization: Bearer test-session", b"Origin: " + self.origin.encode()):
            raw = (b"POST /api/view HTTP/1.0\r\nHost: " + host + b"\r\nAuthorization: Bearer test-session\r\n"
                   b"Origin: " + self.origin.encode() + b"\r\n" + header +
                   b"\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
            self.assertIn(self.raw_request(raw)[0], (401, 403))
        for length in (b"+2", b"0_2"):
            raw = (b"POST /api/view HTTP/1.0\r\nHost: " + host + b"\r\nAuthorization: Bearer test-session\r\n"
                   b"Origin: " + self.origin.encode() + b"\r\nContent-Type: application/json\r\nContent-Length: "
                   + length + b"\r\n\r\n{}")
            self.assertEqual(self.raw_request(raw)[0], 400)
        self.assertEqual(self.store.calls, [])

    def test_oversized_or_stale_session_upload_can_read_unconfirmed_refusal(self):
        large = {"body": "x" * (3 * 1024 * 1024)}
        for authenticated, expected in ((True, 413), (False, 401)):
            with self.subTest(authenticated=authenticated):
                status, _, raw = self.request("/api/command", large, authenticated=authenticated)
                self.assertEqual(status, expected)
                self.assertFalse(json.loads(raw)["recorded"])
        self.assertEqual(self.store.calls, [])

    def test_dripping_headers_have_one_absolute_deadline(self):
        self.server.request_timeout = 0.2
        stopped = threading.Event()
        with socket.create_connection(self.server.server_address, timeout=0.8) as sock:
            started = time.monotonic()
            sock.sendall(b"POST /api/view HTTP/1.0\r\nHost: ")

            def drip():
                while not stopped.wait(0.03):
                    try:
                        sock.sendall(b"x")
                    except OSError:
                        return

            writer = threading.Thread(target=drip)
            writer.start()
            try:
                # Every byte is within the old per-recv timeout. Only a total
                # deadline releases this unauthenticated connection.
                try:
                    received = sock.recv(1024)
                except ConnectionResetError:
                    # Closing with unread drip bytes can produce RST rather
                    # than EOF. Other socket errors and timeouts still fail.
                    received = b""
                elapsed = time.monotonic() - started
                self.assertEqual(received, b"")
                self.assertGreaterEqual(elapsed, self.server.request_timeout - 0.05)
                self.assertLess(elapsed, 0.8)
                self.assertEqual(self.store.calls, [])
            finally:
                stopped.set()
                writer.join(1)
        self.assertEqual(self.store.calls, [])


if __name__ == "__main__":
    unittest.main()

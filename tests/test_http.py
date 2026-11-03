from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from aim_next.server import create_server


class FakeStore:
    def __init__(self):
        self.calls = []
        self.read_started = threading.Event()
        self.release_read = threading.Event()

    def command(self, actor, envelope):
        self.calls.append(("command", actor, envelope))
        if envelope["kind"] == "explode":
            raise RuntimeError("private database path and token must not escape")
        return {"instance_id": "new-test", "operation_id": envelope["operation_id"],
                "kind": envelope["kind"], "status": "committed", "recorded": True,
                "result": {"message_id": "m-one"}, "affected": []}

    def view(self, actor, name, args):
        self.calls.append(("view", actor, name, args))
        if name == "capabilities":
            return {"body_utf8_bytes": 1048576, "recipients": 32}
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
        (self.root / "private.txt").write_text("private record")
        (self.web / "leak.js").symlink_to(self.root / "private.txt")
        self.store = FakeStore()
        self.server = create_server(lambda: self.store, "new-test", "test-owner", self.web,
                                    port=0, token="test-session", max_json_bytes=2048, max_reads=1)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = "http://127.0.0.1:%s" % self.port

    def tearDown(self):
        self.store.release_read.set()
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
                   "expected": {}, "args": {"submission_id": "s1"}}
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
        status, _, raw = self.request("/api/bootstrap", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"instance_id": "new-test", "actor": "test-owner",
                                         "limits": {"body_utf8_bytes": 1048576, "recipients": 32}})

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


if __name__ == "__main__":
    unittest.main()

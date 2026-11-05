from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from aim_next import initialize, Store
from aim_next.server import create_server


class LiveStreamTests(unittest.TestCase):
    """GET /api/live: one line per new commit number, over real files and a real native watch."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "records.sqlite3"
        self.authority = self.root / "authority.json"
        self.binding = initialize(self.db, "isolated-test", [{"id": "test-human", "kind": "human"}],
                                  authority_path=self.authority)["binding"]
        self.pin = {key: self.binding[key] for key in ("authority_id", "authority_epoch")}
        self.store = Store(self.db, "isolated-test", expected_binding=self.binding)
        self.revision = 0
        self.connections = []
        self.start()

    def start(self, live=True, streams=8):
        self.server = create_server(lambda: Store(self.db, "isolated-test", expected_binding=self.binding),
                                    "isolated-test", "test-human", self.root, token="live-session",
                                    live=(self.db, (self.authority,), streams) if live else None)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.assertFalse(self.thread.is_alive())

    def tearDown(self):
        for connection in self.connections:
            connection.close()
        if self.thread.is_alive():
            self.stop()
        self.tmp.cleanup()

    def open(self, token="live-session"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.connections.append(connection)
        connection.request("GET", "/api/live", headers={"Authorization": "Bearer " + token})
        return connection.getresponse()

    def line(self, response):
        return json.loads(response.readline())

    def commit(self, title="Live"):
        self.revision += 1
        result = self.store.command("test-human", {
            "v": 1, "instance_id": "isolated-test", "operation_id": "live-%d" % self.revision,
            "kind": "workspace.create", "target": {},
            "expected": {"authority": dict(self.pin), "workspace_revision": 0},
            "args": {"id": "w-live-%d" % self.revision, "title": title, "team": []}})
        self.assertTrue(result.get("recorded"), result)

    def seq(self):
        with sqlite3.connect(str(self.db)) as db:
            return int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])

    def bootstrap(self):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("GET", "/api/bootstrap", headers={"Authorization": "Bearer live-session"})
            return json.loads(connection.getresponse().read())
        finally:
            connection.close()

    def test_a_stream_starts_at_the_current_commit_and_announces_each_new_one(self):
        response = self.open()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "application/x-ndjson; charset=utf-8")
        self.assertIsNone(response.getheader("Content-Length"))
        self.assertEqual(self.line(response), {"seq": self.seq()})
        other = self.open()
        self.assertEqual(self.line(other), {"seq": self.seq()})
        for _ in range(3):
            self.commit()
            expected = {"seq": self.seq()}
            self.assertEqual(self.line(response), expected)
            self.assertEqual(self.line(other), expected)

    def test_a_read_announces_nothing(self):
        response = self.open()
        start = self.line(response)["seq"]
        self.assertEqual(self.store.view("test-human", "workspaces", {}).get("error"), None)
        self.commit()
        # The next line is the commit's number, so the read sent none of its own.
        self.assertEqual(self.line(response), {"seq": start + 1})

    def test_bootstrap_offers_live_only_when_the_instance_has_it(self):
        self.assertEqual(self.bootstrap()["transport"]["live"], {"version": 1, "path": "/api/live"})
        self.stop()
        self.start(live=False)
        self.assertNotIn("live", self.bootstrap().get("transport", {}))
        response = self.open()
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(response.read())["error"]["code"], "LIVE_UNAVAILABLE")

    def test_a_stream_needs_the_instance_session(self):
        response = self.open(token="wrong")
        self.assertEqual(response.status, 401)
        self.assertEqual(json.loads(response.read())["error"]["code"], "SESSION_REQUIRED")

    def test_streams_are_bounded_and_a_closed_stream_frees_its_slot(self):
        self.stop()
        self.start(streams=1)
        first = self.open()
        self.assertEqual(self.line(first), {"seq": self.seq()})
        refused = self.open()
        self.assertEqual(refused.status, 503)
        self.assertEqual(json.loads(refused.read())["error"]["code"], "SERVER_BUSY")
        feed, released = self.server.live_feed, threading.Event()
        unsubscribe = feed.unsubscribe
        feed.unsubscribe = lambda stream: (unsubscribe(stream), released.set())
        # The response holds the socket open after its connection closes.
        first.close()
        self.connections[0].close()
        self.assertTrue(released.wait(5))
        second = self.open()
        self.assertEqual(self.line(second), {"seq": self.seq()})

    def test_stopping_the_server_ends_every_stream_with_a_reason(self):
        responses = [self.open(), self.open()]
        for response in responses:
            self.line(response)
        self.stop()
        for response in responses:
            self.assertEqual(self.line(response), {"end": "stopped"})
            self.assertEqual(response.readline(), b"")

    def test_a_replaced_authority_anchor_ends_the_stream(self):
        response = self.open()
        self.line(response)
        replacement = self.root / "authority.json.next"
        replacement.write_bytes(self.authority.read_bytes())
        os.replace(replacement, self.authority)
        self.assertEqual(self.line(response), {"end": "binding_changed"})
        self.assertEqual(response.readline(), b"")

    def test_a_moved_database_ends_the_stream(self):
        response = self.open()
        self.line(response)
        os.replace(self.db, self.root / "moved.sqlite3")
        self.assertEqual(self.line(response), {"end": "database_moved"})


if __name__ == "__main__":
    unittest.main()

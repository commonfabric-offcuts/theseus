from __future__ import annotations

import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from aim_next import initialize, Store
from aim_next.server import create_server


class SharedStoreHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "records.sqlite3"
        initialize(self.db, "isolated-test", [{"id": "test-human", "kind": "human"},
                                             {"id": "test-agent", "kind": "agent"}])
        self.store = Store(self.db, "isolated-test")
        self.server = create_server(lambda: Store(self.db, "isolated-test"),
                                    "isolated-test", "test-human", self.root,
                                    token="integration-session")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.tmp.cleanup()

    def request(self, path, value=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request("GET" if value is None else "POST", path,
                               body=None if value is None else json.dumps(value),
                               headers={"Authorization": "Bearer integration-session",
                                        "Origin": self.server.origin,
                                        "Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())
        finally:
            connection.close()

    def workspace_command(self):
        return {"v": 1, "instance_id": "isolated-test", "operation_id": "workspace-once",
                "kind": "workspace.create", "target": {}, "expected": {},
                "args": {"id": "w-test", "title": "Isolated test", "team": []}}

    def test_bootstrap_exposes_backend_limits_once(self):
        capabilities = self.store.view("test-human", "capabilities", {})
        bootstrap = self.request("/api/bootstrap")
        self.assertEqual(bootstrap["instance_id"], capabilities["instance_id"])
        self.assertEqual(bootstrap["actor"], "test-human")
        self.assertEqual(bootstrap["limits"], capabilities["limits"])

    def test_direct_commit_reconciles_over_http_and_retry_preserves_receipt(self):
        command = self.workspace_command()
        committed = self.store.command("test-human", command)
        self.assertEqual(committed["status"], "committed")
        self.assertTrue(committed["recorded"])
        operation = {"name": "operation", "args": {"operation_id": command["operation_id"]}}
        self.assertEqual(self.request("/api/view", operation), committed)
        self.assertEqual(self.request("/api/command", command), committed)
        self.assertEqual(self.store.view("test-agent", "operation", operation["args"])["status"], "unknown")
        for spoof in ({"actor": "test-agent"}, {"owner": "test-agent"}, {"actor_id": "test-agent"}):
            result = self.request("/api/view", {"name": "operation", "args": dict(operation["args"], **spoof)})
            self.assertEqual(result, committed)
        changed = dict(command, args={"id": "wrong-workspace", "title": "Changed"})
        mismatch = self.request("/api/command", changed)
        self.assertFalse(mismatch["recorded"])
        self.assertEqual(mismatch["error"]["code"], "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.request("/api/view", operation), committed)
        self.assertEqual(self.store.view("test-human", "workspace", {"workspace_id": "wrong-workspace"})["error"]["code"], "FORBIDDEN")

    def test_http_commit_reads_through_shared_core_after_server_stops(self):
        command = self.workspace_command()
        result = self.request("/api/command", command)
        self.assertEqual(result["status"], "committed")
        self.server.shutdown()
        found = Store(self.db, "isolated-test").view("test-human", "workspace", {"workspace_id": "w-test"})
        self.assertEqual(found["workspace"]["owner_id"], "test-human")
        self.assertEqual(found["workspace"]["title"], "Isolated test")


if __name__ == "__main__":
    unittest.main()

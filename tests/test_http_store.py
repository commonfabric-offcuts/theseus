from __future__ import annotations

import http.client
import fcntl
import json
import os
import sqlite3
from pathlib import Path
import tempfile
import threading
import unittest

from aim_next import initialize, Store
from aim_next.server import create_server


class SharedStoreHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "records.sqlite3"
        self.binding = initialize(self.db, "isolated-test", [{"id": "test-human", "kind": "human"},
                                             {"id": "test-agent", "kind": "agent"}],
                                  authority_path=self.root / "authority.json")["binding"]
        self.store = Store(self.db, "isolated-test", expected_binding=self.binding)
        self.server = create_server(lambda: Store(self.db, "isolated-test", expected_binding=self.binding),
                                    "isolated-test", "test-human", self.root,
                                    token="integration-session")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.tmp.cleanup()

    def request(self, path, value=None, expected_status=200):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request("GET" if value is None else "POST", path,
                               body=None if value is None else json.dumps(value),
                               headers={"Authorization": "Bearer integration-session",
                                        "Origin": self.server.origin,
                                        "Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, expected_status)
            return json.loads(response.read())
        finally:
            connection.close()

    def workspace_command(self):
        return {"v": 1, "instance_id": "isolated-test", "operation_id": "workspace-once",
                "kind": "workspace.create", "target": {}, "expected": {"workspace_revision": 0},
                "args": {"id": "w-test", "title": "Isolated test", "team": []}}

    def test_bootstrap_exposes_backend_limits_once(self):
        capabilities = self.store.view("test-human", "capabilities", {})
        bootstrap = self.request("/api/bootstrap")
        self.assertEqual(bootstrap["instance_id"], capabilities["instance_id"])
        self.assertEqual(bootstrap["actor"], "test-human")
        self.assertEqual(bootstrap["limits"], capabilities["limits"])
        self.assertEqual(bootstrap["authority"], capabilities["authority"])

    def test_database_binding_mismatch_preserves_authority_refusal(self):
        # Deliberate isolated corruption: external anchor and inode still match,
        # but the database's own binding does not. Opening cannot rebind it.
        with sqlite3.connect(str(self.db)) as connection:
            connection.execute("UPDATE metadata SET value='other-epoch' WHERE key='authority_epoch'")
        before = self.db.read_bytes()
        for path, value in (("/api/command", self.workspace_command()), ("/api/bootstrap", None)):
            with self.subTest(path=path):
                result = self.request(path, value, expected_status=409)
                self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
                self.assertFalse(result["error"]["retryable"])
                self.assertFalse(result["recorded"])
        self.assertEqual(self.db.read_bytes(), before)

    def test_authority_contention_remains_an_unrecorded_retryable_http_attempt(self):
        command = self.workspace_command()
        fd = os.open(self.binding["authority_path"] + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.request("/api/command", command, expected_status=503)
            self.assertFalse(result["recorded"])
            self.assertEqual(result["error"]["code"], "AUTHORITY_BUSY")
            self.assertTrue(result["error"]["retryable"])
        finally:
            os.close(fd)
        operation = self.store.view("test-human", "operation", {"operation_id": command["operation_id"]})
        self.assertEqual(operation["status"], "unknown")
        committed = self.committed(command)
        self.assertEqual(self.request("/api/command", command), committed)

    def test_stale_http_factory_binding_refuses_usefully_without_retry_or_rebinding(self):
        self.server.store_factory = lambda: Store(self.db, "isolated-test", expected_binding=dict(
            self.binding, authority_epoch="stale-epoch"))
        before = self.db.read_bytes()
        for path, value in (("/api/command", self.workspace_command()), ("/api/bootstrap", None)):
            with self.subTest(path=path):
                result = self.request(path, value, expected_status=409)
                self.assertFalse(result["recorded"])
                self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
                self.assertFalse(result["error"]["retryable"])
                self.assertIn("activate a recovery copy at a new path", result["error"]["message"])
        self.assertEqual(self.db.read_bytes(), before)

    def test_bootstrap_preserves_authority_error_after_successful_store_construction(self):
        # Reuse an already constructed real Store to exercise the later fence
        # inside view(), rather than the constructor's earlier fence.
        self.server.store_factory = lambda: self.store
        fd = os.open(self.binding["authority_path"] + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.request("/api/bootstrap", expected_status=503)
            self.assertFalse(result["recorded"])
            self.assertEqual(result["error"]["code"], "AUTHORITY_BUSY")
            self.assertTrue(result["error"]["retryable"])
        finally:
            os.close(fd)

    def test_bootstrap_preserves_nonretryable_epoch_change_after_construction(self):
        self.server.store_factory = lambda: self.store
        anchor = Path(self.binding["authority_path"])
        record = json.loads(anchor.read_text())
        record["epoch"] = "isolated-changed-epoch"
        # Only this isolated fixture's anchor changes. This exercises the
        # adapter's declared-error boundary, not the future recovery mechanism.
        anchor.write_text(json.dumps(record))
        before = self.db.read_bytes()
        result = self.request("/api/bootstrap", expected_status=409)
        self.assertFalse(result["recorded"])
        self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.assertFalse(result["error"]["retryable"])
        self.assertIn("activate a recovery copy at a new path", result["error"]["message"])
        self.assertEqual(self.db.read_bytes(), before)

    def test_direct_commit_reconciles_over_http_and_retry_preserves_receipt(self):
        command = self.workspace_command()
        committed = self.store.command("test-human", command)
        self.assertEqual(committed["status"], "committed")
        self.assertTrue(committed["recorded"])
        operation = {"name": "operation", "args": {"operation_id": command["operation_id"]}}
        self.assertEqual(self.request("/api/view", operation), committed)
        self.assertEqual(self.request("/api/command", command), committed)
        self.assertEqual(self.store.view("test-agent", "operation", operation["args"])["status"], "unknown")
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
        found = Store(self.db, "isolated-test", expected_binding=self.binding).view("test-human", "workspace", {"workspace_id": "w-test"})
        self.assertEqual(found["workspace"]["owner_id"], "test-human")
        self.assertEqual(found["workspace"]["title"], "Isolated test")

    def command(self, kind, op, args, target=None, expected=None):
        return {"v": 1, "instance_id": "isolated-test", "operation_id": op,
                "kind": kind, "target": target or {}, "expected": expected or {}, "args": args}

    def committed(self, command):
        receipt = self.request("/api/command", command)
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt

    def test_lost_http_send_ack_does_not_erase_successor_saved_through_core(self):
        self.committed(self.workspace_command())
        source = {"kind": "new_topic", "id": "opening", "workspace_id": "w-test"}
        self.committed(self.command("draft.save", "save-opening", {
            "source_ref": source, "topic_id": "t-test", "generation": "opening-generation",
            "body": "Opening", "attachments": [], "quotes": [], "addressees": [],
            "opening": {"workspace_id": "w-test", "title": "Integration", "participants": ["test-agent"]}
        }, {"draft_id": "opening-draft"}, {"draft_revision": 0}))
        self.committed(self.command("submission.prepare", "prepare-opening", {
            "draft_id": "opening-draft", "submission_id": "opening-submission", "send_operation_id": "send-opening"
        }, {"topic_id": "t-test"}, {"draft_revision": 1}))
        opening = self.committed(self.command("topic.create_and_send", "send-opening", {
            "submission_id": "opening-submission"}, {"topic_id": "t-test"}))
        source = {"kind": "message", "id": opening["result"]["message_id"]}
        self.committed(self.command("draft.save", "save-A", {
            "source_ref": source, "topic_id": "t-test", "generation": "generation-A", "body": "Exact A",
            "attachments": [], "quotes": [], "addressees": []
        }, {"draft_id": "reply-draft"}, {"draft_revision": 0}))
        prepared = self.committed(self.command("submission.prepare", "prepare-A", {
            "draft_id": "reply-draft", "submission_id": "submission-A", "send_operation_id": "send-A"
        }, {"topic_id": "t-test"}, {"draft_revision": 1}))
        successor = prepared["result"]["next_draft"]
        committed = threading.Event()
        release_ack = threading.Event()
        actual_store = self.store

        class DelayAfterCommit:
            def command(self, actor, envelope):
                result = actual_store.command(actor, envelope)
                committed.set()
                release_ack.wait(3)
                return result

        self.server.store_factory = DelayAfterCommit
        send = self.command("message.send", "send-A", {"submission_id": "submission-A"}, {"topic_id": "t-test"})
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request("POST", "/api/command", body=json.dumps(send), headers={
                "Authorization": "Bearer integration-session", "Origin": self.server.origin,
                "Content-Type": "application/json"})
            self.assertTrue(committed.wait(2))
            # The web client loses its response after the durable commit. A
            # distinct local client can save B while HTTP still awaits its ack.
            connection.close()
            saved_b = self.store.command("test-human", self.command("draft.save", "save-B", {
                "source_ref": source, "topic_id": "t-test", "generation": successor["generation"],
                "body": "New independent B", "attachments": [], "quotes": [], "addressees": []
            }, {"draft_id": successor["id"]}, {"draft_revision": successor["revision"]}))
            self.assertEqual(saved_b["status"], "committed", saved_b)
        finally:
            connection.close()
            release_ack.set()
            self.server.store_factory = lambda: Store(self.db, "isolated-test", expected_binding=self.binding)
        original = self.request("/api/view", {"name": "operation", "args": {"operation_id": "send-A"}})
        self.assertEqual(original["status"], "committed")
        self.assertEqual(self.committed(send), original)
        editor = self.request("/api/view", {"name": "editor_state", "args": {"source_ref": source, "topic_id": "t-test"}})
        self.assertEqual(editor["draft"]["body"], "New independent B")
        messages = self.request("/api/view", {"name": "topic_messages", "args": {"topic_id": "t-test"}})["items"]
        self.assertEqual([item["body"] for item in messages], ["Opening", "Exact A"])
        deliveries = self.store.view("test-agent", "deliveries", {})["items"]
        self.assertEqual([item["message"]["body"] for item in deliveries], ["Opening", "Exact A"])

    def test_private_lookup_refuses_owner_overrides_with_real_foreign_records(self):
        foreign = self.command("workspace.create", "agent-private-operation", {
            "id": "agent-private-workspace", "title": "Another actor's operation result"
        }, expected={"workspace_revision": 0})
        receipt = self.store.command("test-agent", foreign)
        self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(self.store.view("test-agent", "operation", {"operation_id": foreign["operation_id"]}), receipt)
        for field in ("actor", "actor_id", "owner", "owner_id"):
            with self.subTest(field=field):
                result = self.request("/api/view", {"name": "operation", "args": {
                    "operation_id": foreign["operation_id"], field: "test-agent"}})
                self.assertEqual(result.get("error", {}).get("code"), "INVALID_ARGUMENT", result)
                self.assertNotIn("agent-private-workspace", json.dumps(result))
        own_lookup = self.request("/api/view", {"name": "operation", "args": {"operation_id": foreign["operation_id"]}})
        self.assertEqual(own_lookup["status"], "unknown")
        self.assertFalse(own_lookup["recorded"])


if __name__ == "__main__":
    unittest.main()

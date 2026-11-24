"""Real SQLite lock contention and HTTP busy-answer accounting, scratch only."""
import concurrent.futures
import http.client
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from aim_next import Store, initialize
from aim_next.server import create_server, RequestError


class BusyWriteTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="busy1194-")
        self.addCleanup(scratch.cleanup)
        self.path = Path(scratch.name) / "scratch.sqlite3"
        self.binding = initialize(self.path, "busy1194", [{"id": "person", "kind": "human"}],
                                  authority_path=Path(scratch.name).resolve() / "control" / "authority.json")["binding"]
        self.store = Store(self.path, "busy1194", expected_binding=self.binding)

    def test_writer_commits_after_a_real_reader_holds_commit_for_one_second(self):
        blocker = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN")
        blocker.execute("SELECT * FROM metadata").fetchall()
        committing = threading.Event()
        connect = sqlite3.connect
        def traced(*args, **kwargs):
            db = connect(*args, **kwargs)
            db.set_trace_callback(lambda sql: committing.set() if sql == "COMMIT" else None)
            return db
        envelope = {"v": 1, "instance_id": "busy1194", "operation_id": "one-workspace",
                    "kind": "workspace.create", "target": {},
                    "expected": {"authority": {k: self.binding[k] for k in ("authority_id", "authority_epoch")}},
                    "args": {"id": "workspace", "title": "Held reader", "team": []}}
        began = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool, patch("aim_next.store.sqlite3.connect", traced):
            pending = pool.submit(self.store.command, "person", envelope)
            try:
                self.assertTrue(committing.wait(3), "real writer must reach COMMIT behind the SHARED reader")
                time.sleep(1)
            finally:
                blocker.rollback()
            receipt = pending.result(timeout=7)
        elapsed = time.monotonic() - began
        print("1194 writer held-reader seconds=%.3f status=%s" % (elapsed, receipt.get("status")), flush=True)
        self.assertEqual(receipt.get("status"), "committed", receipt)
        self.assertEqual(self.store.command("person", envelope), receipt, "same operation is recorded only once")
        with connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM workspaces").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 1)

    def test_read_retains_short_wait_and_checked_durability(self):
        runtime = self.store.view("person", "capabilities", {})["runtime"]
        self.assertEqual(runtime["busy_timeout"], 250)
        self.assertEqual({k: runtime[k] for k in ("journal_mode", "synchronous", "fullfsync", "foreign_keys")},
                         {"journal_mode": "delete", "synchronous": 3, "fullfsync": 1, "foreign_keys": 1})
        blocker = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN EXCLUSIVE")
        began = time.monotonic()
        try:
            answer = self.store.view("person", "capabilities", {})
        finally:
            blocker.rollback()
        elapsed = time.monotonic() - began
        print("1194 blocked read seconds=%.3f" % elapsed, flush=True)
        self.assertEqual(answer["error"]["code"], "DATABASE_BUSY")
        self.assertLess(elapsed, 1.5, "read must not adopt the five-second writer wait")


class BusyAnswerTests(unittest.TestCase):
    def test_http_counts_only_database_busy_and_health_reads_do_not_increment(self):
        class ScratchStore:
            def command(self, actor, value):
                if value["args"].get("http"):
                    raise RequestError(503, value["args"]["code"], "scratch refusal")
                return {"recorded": False, "status": "retryable", "error": {"code": value["args"]["code"]}}
            def view(self, actor, name, args):
                return {"instance_id": "busy1194", "red": []}
        server = create_server(ScratchStore, "busy1194", "person", Path(__file__).resolve().parents[1] / "web", token="scratch")
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        def stop():
            server.shutdown(); server.server_close(); thread.join(5)
            self.assertFalse(thread.is_alive())
        self.addCleanup(stop)
        def request(path, value, status=200):
            connection = http.client.HTTPConnection(*server.server_address, timeout=5)
            try:
                connection.request("POST", path, json.dumps(value), {"Authorization": "Bearer scratch", "Content-Type": "application/json",
                                   "Origin": "http://%s:%s" % server.server_address})
                response = connection.getresponse()
                self.assertEqual(response.status, status)
                return json.loads(response.read())
            finally:
                connection.close()
        for code in ("DATABASE_BUSY", "SERVER_BUSY", "DATABASE_BUSY", "AUTHORITY_BUSY"):
            request("/api/command", {"v": 1, "instance_id": "busy1194", "operation_id": code,
                    "kind": "scratch", "target": {}, "expected": {}, "args": {"code": code}})
        for _ in range(2):
            health = request("/api/view", {"name": "health", "args": {}})
            self.assertEqual(health["server"].get("database_busy_last_minute"), 2, health)
        request("/api/command", {"v": 1, "instance_id": "busy1194", "operation_id": "http-busy",
                "kind": "scratch", "target": {}, "expected": {}, "args": {"code": "DATABASE_BUSY", "http": True}}, 503)
        self.assertEqual(request("/api/view", {"name": "health", "args": {}})["server"]["database_busy_last_minute"], 3)
        clock = [100.0]
        server.busy_answers.clock = lambda: clock[0]
        server.busy_answers.seconds.clear()
        server.busy_answers.count(add=True)
        clock[0] = 159.0
        self.assertEqual(server.busy_answers.count(), 1)
        clock[0] = 160.0
        self.assertEqual(server.busy_answers.count(), 0)
        self.assertEqual(server.busy_answers.seconds, {})


if __name__ == "__main__":
    unittest.main()

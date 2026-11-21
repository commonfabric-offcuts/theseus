from __future__ import annotations

"""The real cover CLI prints typed and retained legacy refresh records (885)."""

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

from aim_next.profile import write_profile
from reader_fixture import ReaderCase


class CoverCLI885Case(ReaderCase):
    def setUp(self):
        super().setUp()
        self.root = self.opening["id"]
        self.participation("agent-b", True)
        self.cover("Original cover", 0)
        self.profile = Path(self.temp.name) / "reader.json"
        write_profile(self.profile, str(self.path.resolve()), "test-instance", "agent-a",
                      binding=self.binding)

    def cover(self, words, revision):
        return self.committed(self.command("stack.cover", {"stands": words},
            target={"message_id": self.root}, expected={"cover_revision": revision}, actor="agent-b"))

    def refresh(self):
        return self.store.view("agent-a", "dossier_cover", {"message_id": self.root})["refresh"]

    def cli(self, *options):
        argv = [sys.executable, "-I", "-X",
                "pycache_prefix=" + str(Path(self.temp.name) / ("cache-" + uuid.uuid4().hex)),
                str(Path(__file__).resolve().parents[1] / "bin/aim-next"),
                "--profile", str(self.profile), "cover", self.root, *options]
        result = subprocess.run(argv, text=True, capture_output=True, timeout=15)
        print(json.dumps({"case": self._testMethodName, "argv": argv, "exit": result.returncode,
                          "stdout": result.stdout, "stderr": result.stderr}), flush=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def test_reads_typed_pending_and_completed_refresh(self):
        record = self.committed(self.command("stack.cover_refresh", target={"message_id": self.root},
            expected={"cover_revision": 1}, actor="agent-a"))["refresh"]
        self.assertNotIn("request_message_id", record)
        request = record["request_id"]
        self.assertIn("cover refresh pending: agent-b (request %s, observed revision 1)" % request, self.cli())
        self.cover("Updated cover", 1)
        completed = self.refresh()
        self.assertEqual((completed["state"], completed["request_id"]), ("completed", request))
        output = self.cli()
        self.assertIn("cover refresh completed: agent-b (request %s, observed revision 1)" % request, output)
        self.assertIn("stands: Updated cover", output)

    def test_reads_legacy_refresh_and_prints_coalesced_refresh(self):
        # Retained pre829 shape from actual153 cover_refresh.py. Seed the
        # historical act in this disposable store; no migration is claimed here.
        request = self.committed(self.command("message.post", {"body": "Legacy refresh request"},
            target={"topic_id": "t1"}))["message_id"]
        legacy = {"state": "pending", "operation_id": "legacy-refresh", "by": "owner",
                  "observed_revision": 1, "recipient": "agent-b", "request_message_id": request,
                  "at_ms": 1, "completed_revision": None}
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) "
                       "SELECT 'cover_refresh',id,topic_id,seq,'','owner',?,1,1 FROM messages WHERE id=?",
                       (json.dumps(legacy), self.root))
        self.assertEqual(self.refresh(), legacy)
        self.assertIn("cover refresh pending: agent-b (request %s, observed revision 1)" % request, self.cli())
        self.assertIn("awaiting a new cover from agent-b (request %s, observed revision 1)" % request,
                      self.cli("--refresh", "--operation", "coalesce-legacy"))
        self.assertEqual(self.refresh(), legacy)
        self.assertEqual(self.sql("SELECT count(*) FROM refresh_requests"), [(0,)])

    def test_refresh_prints_committed_request_and_retry_keeps_it(self):
        output = self.cli("--refresh", "--operation", "refresh-cli-885")
        record = self.refresh()
        request = record["request_id"]
        self.assertNotIn("request_message_id", record)
        self.assertEqual(output, "awaiting a new cover from agent-b (request %s, observed revision 1)\n" % request)
        receipt = self.store.view("agent-a", "operation", {"operation_id": "refresh-cli-885"})
        self.assertEqual(receipt["result"]["refresh"], record)
        self.assertEqual(self.cli("--refresh", "--operation", "refresh-cli-885"), output)
        self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": "refresh-cli-885"}), receipt)
        self.assertEqual(self.sql("SELECT id FROM refresh_requests"), [(request,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE request_id=?", (request,)), [(1,)])

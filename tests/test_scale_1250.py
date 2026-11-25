from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock
import urllib.request

from fixtures.scale_1250 import Seed, verify, open_seed
from tools.scale_1250 import diagnostic, served


class SeedCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scale1250-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_public_and_batched_construction_keep_the_same_authoritative_shape(self):
        public = Seed(self.root / "public", 40, 4, batched=False)
        batched = Seed(self.root / "batched", 40, 4)
        for seed in (public, batched):
            self.assertTrue(verify(seed.root)["verified"])
        def shape(seed):
            with sqlite3.connect(str(seed.path)) as db:
                return [db.execute(sql).fetchall() for sql in [
                    "SELECT topic_id,message_count FROM topic_summaries ORDER BY topic_id",
                    "SELECT recipient_id,kind,pending_count FROM delivery_groups ORDER BY recipient_id,kind,topic_id",
                    "SELECT recipient_id,pending_count FROM recipient_schedule ORDER BY recipient_id",
                    "SELECT topic_id,body,addressees,intent FROM messages ORDER BY seq"]]
        self.assertEqual(shape(public), shape(batched))

    def test_real_100_30000_pair_has_300_dossiers_and_matched_frontier(self):
        for count in (100, 30000):
            seed = Seed(self.root / str(count), count)
            result = verify(seed.root)
            self.assertEqual((result["target"], result["dossiers"]), (count, 300))
            store, ledger = open_seed(seed.root)
            legacy = store.view("reader", "topic_messages", {"topic_id": "target", "direction": "before", "limit": 30})
            compact = store.view("reader", "topic_messages", {"topic_id": "target", "direction": "before", "limit": 30, "position_format": "root-table-v1"})
            self.assertNotIn("error", compact)
            self.assertEqual(len(compact["positions"]), 1)
            self.assertEqual([x["body"] for x in legacy["items"]], ["Visible release %02d" % n for n in range(30)])
            measured = diagnostic(seed.root)
            self.assertGreater(measured["vm_steps"], 0)
            self.assertTrue(measured["statements"])
            print("SCALE1250_DIAGNOSTIC " + json.dumps(measured))

    def test_ledger_fault_is_detected_without_weakening_immutable_records(self):
        seed = Seed(self.root / "fault", 40, 4)
        ledger = seed.root / "ledger.json"
        original = ledger.read_bytes()
        value = json.loads(original);value["messages"].pop()
        ledger.write_text(json.dumps(value))
        with self.assertRaises(AssertionError):
            verify(seed.root)
        ledger.write_bytes(original)
        self.assertTrue(verify(seed.root)["verified"])

    def test_missing_maintained_schedule_is_rejected_and_exactly_restored(self):
        seed = Seed(self.root / "missing", 40, 4)
        with sqlite3.connect(str(seed.path)) as db:
            original = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id='reader'").fetchone()
            self.assertIsNotNone(original)
            db.execute("DELETE FROM recipient_schedule WHERE recipient_id='reader'")
            self.assertEqual(db.execute("SELECT count(*) FROM recipient_schedule WHERE recipient_id='reader'").fetchone(), (0,))
        with self.assertRaisesRegex(AssertionError, "schedule identities"):
            verify(seed.root)
        with sqlite3.connect(str(seed.path)) as db:
            db.execute("INSERT INTO recipient_schedule VALUES (" + ",".join("?" for _ in original) + ")", original)
            self.assertEqual(db.execute("SELECT * FROM recipient_schedule WHERE recipient_id='reader'").fetchone(), original)
        self.assertTrue(verify(seed.root)["verified"])

    def test_actual_http_factory_does_not_reread_fixture_ledger_per_request(self):
        seed = Seed(self.root / "http", 40, 4)
        with mock.patch("tools.scale_1250.open_seed", wraps=open_seed) as opening:
            with served(seed.root) as server:
                for _ in range(2):
                    data = json.dumps({"name": "topic_messages", "args": {"topic_id": "target", "direction": "before", "limit": 30}}).encode()
                    request = urllib.request.Request(server["origin"] + "/api/view", data, headers={
                        "Authorization": "Bearer " + server["token"], "Origin": server["origin"], "Content-Type": "application/json"})
                    with urllib.request.urlopen(request) as response:
                        self.assertEqual(len(json.load(response)["items"]), 30)
            self.assertEqual(opening.call_count, 1)


if __name__ == "__main__":
    unittest.main()

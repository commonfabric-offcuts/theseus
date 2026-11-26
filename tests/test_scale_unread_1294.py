from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fixtures import scale_1250 as fixture
from tools.scale_1250 import diagnostic


class UnreadScaleCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="unread1294-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_100_30000_real_unread_views_match_independent_frontiers(self):
        for count in (100, 30000):
            seed = fixture.Seed(self.root / str(count), count)
            measured = diagnostic(seed.root, view="topic_unread")
            expected = fixture.verify_unread(seed.root)
            target = [m for m in seed.ledger if m["topic_id"] == "target"]
            self.assertEqual(expected["oldest_unread"]["id"], target[-30]["id"])
            self.assertEqual(expected["oldest_unread"]["seq"], target[-30]["seq"])
            self.assertEqual(measured["view"], "topic_unread")
            self.assertEqual(measured["args"], {"topic_id": "target"})
            self.assertGreater(measured["vm_steps"], 0)
            self.assertTrue(measured["statements"])
            print("UNREAD1294_DIAGNOSTIC " + json.dumps(measured))

    def test_public_read_mutation_breaks_fixed_frontier_then_exact_restore_passes(self):
        seed = fixture.Seed(self.root / "mutation", 100)
        original = fixture.verify_unread(seed.root)
        with sqlite3.connect(str(seed.path)) as db, sqlite3.connect(":memory:") as backup:
            before = list(db.iterdump())
            db.backup(backup)
            try:
                seed.command("topic.read_through", {"seq": original["oldest_unread"]["seq"]},
                             {"topic_id": "target"}, actor="reader")
                changed = seed.view("topic_unread", {"topic_id": "target"})
                self.assertNotEqual(changed["oldest_unread"]["id"], original["oldest_unread"]["id"])
                self.assertNotEqual(list(db.iterdump()), before)
                with self.assertRaisesRegex(AssertionError, "frontier|pending"):
                    fixture.verify_unread(seed.root)
            finally:
                backup.backup(db)
            self.assertEqual(list(db.iterdump()), before)
        self.assertEqual(fixture.verify_unread(seed.root), original)


if __name__ == "__main__":
    unittest.main()

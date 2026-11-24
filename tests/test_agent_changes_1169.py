from __future__ import annotations

from pathlib import Path
import sqlite3
import tempfile
import unittest

from aim_next import message_edit
from agent_changes_fixture_1169 import construct


class PublicChangesCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="changes-1169-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = construct(Path(self.temp.name) / "fixture")

    def test_public_shape_eligibility_and_next_read_revision(self):
        snapshots = self.fixture["snapshots"]
        expected = {"revision": 1, "cuts": [{"at": 8, "words": "0.4%"}], "added": [{"start": 8, "end": 12}]}
        self.assertEqual(snapshots["source"]["struck"], expected)
        self.assertEqual(snapshots["page"]["items"][0]["struck"], expected)
        self.assertIsNone(snapshots["unread"]["struck"])
        self.assertIsNone(snapshots["agent"]["struck"])
        self.assertEqual(snapshots["read_again"]["struck"], expected)
        self.assertEqual(snapshots["addition"]["struck"],
                         {"revision": 2, "cuts": [], "added": [{"start": 26, "end": 38}]})

    def test_excerpt_clips_additions_and_omits_changes_beyond_it(self):
        fixture = self.fixture
        # The same real revisions/exposure as the public view; shown ends
        # inside the addition and then before it. No synthetic exposure rows.
        with sqlite3.connect(str(fixture["path"])) as db:
            db.row_factory = sqlite3.Row
            message_edit.register(db)
            value = message_edit.struck(db, "owner", fixture["message"], 3,
                                       fixture["snapshots"]["addition"]["body"], shown="🚀 Rate 0.3%, ship today. Ad")
            self.assertEqual(value, {"revision": 2, "cuts": [], "added": [{"start": 26, "end": 28}]})
            self.assertIsNone(message_edit.struck(db, "owner", fixture["message"], 3,
                                                fixture["snapshots"]["addition"]["body"], shown="🚀 Rate"))

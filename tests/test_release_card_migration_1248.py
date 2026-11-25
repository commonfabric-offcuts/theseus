from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

from aim_next import Store, migrations
from aim_next.contract import StoreError
from test_release_cards_1248 import payload
import reader_fixture


class ReleaseCardMigrationCase(reader_fixture.ReaderCase):
    def migrate(self, version):
        return migrations.migrate(self.path, "test-instance", self.binding, version)

    def test_empty_step_back_and_forward_preserve_existing_records_and_integrity(self):
        self.store.record_release({"release": 8, "commit": "b" * 40, "items": [], "source": "deploy", "deployed_at": "2026-11-25T12:00:00-08:00"})
        before = {name: self.sql("SELECT * FROM " + name) for name in ("messages", "releases", "deliveries", "message_revisions")}
        self.assertTrue(self.migrate("69")["migrated"])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='release_cards'"), [])
        self.assertTrue(self.migrate("70")["migrated"])
        self.assertEqual({name: self.sql("SELECT * FROM " + name) for name in before}, before)
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
        self.assertEqual(self.sql("PRAGMA integrity_check"), [("ok",)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.source({"kind": "message", "id": self.opening["id"]})["body"], "Opening message")

    def test_occupied_step_back_refuses_and_retains_typed_and_message_rows(self):
        receipt = self.committed(self.command("release_card.create", {"payload": payload(), "divergence_reason": "Synthetic release"}, target={"topic_id": "t1"}))
        before = self.sql("SELECT * FROM release_cards"), self.sql("SELECT * FROM release_card_revisions"), self.sql("SELECT * FROM messages")
        with self.assertRaises(migrations.MigrationError) as error:
            self.migrate("69")
        self.assertEqual(error.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual((self.sql("SELECT * FROM release_cards"), self.sql("SELECT * FROM release_card_revisions"), self.sql("SELECT * FROM messages")), before)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("70",)])
        self.assertEqual(self.store.view("owner", "release_card", {"message_id": receipt["message_id"]})["release_card"]["revision"], 1)

    def test_applied_partial_upgrade_fault_rolls_back_and_restored_step_succeeds(self):
        self.migrate("69")
        before = self.sql("SELECT * FROM messages"), self.sql("SELECT key,value FROM metadata ORDER BY key")
        steps = list(migrations.STEPS)
        old = steps[-1]
        steps[-1] = (old[0], old[1], [old[2][0], "INSERT INTO missing_upgrade_table VALUES (1)"], old[3], old[4])
        with mock.patch.object(migrations, "STEPS", tuple(steps)), self.assertRaises((migrations.MigrationError, StoreError)):
            self.migrate("70")
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='release_cards'"), [])
        self.assertEqual((self.sql("SELECT * FROM messages"), self.sql("SELECT key,value FROM metadata ORDER BY key")), before)
        self.assertTrue(self.migrate("70")["migrated"])
        self.assertEqual(self.sql("PRAGMA integrity_check"), [("ok",)])


if __name__ == "__main__":
    unittest.main()

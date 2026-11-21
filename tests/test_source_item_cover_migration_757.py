from __future__ import annotations

"""The source-cover step follows the actual frozen987 schema61 layout."""

import sqlite3
from unittest import mock

from aim_next import migrations
from test_source_item_covers import Fixture, WAIT
from fixtures.source_covers_757_schema61 import PREDECESSOR_SQL


PREDECESSOR = sorted(PREDECESSOR_SQL)


class SourceCoverMigrationCase(Fixture):
    def layout(self):
        return sorted(row[0] for row in self.sql("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            return {name: db.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall()
                    for name in tables if name != "source_cover_releases"}

    def test_actual_predecessor_upgrade_backfill_and_downgrade_preserve_records(self):
        source = self.post("A human report with a manual cover")
        self.cover(source, stands="Cabin is booked", waiting=WAIT,
                   payload={"text": "Cabin decision", "message_id": source})
        number = self.file("The actual linked item", source)
        self.store.record_release({"release": 757, "commit": "7" * 40,
                                   "deployed_at": "2026-11-06T05:28:35-08:00",
                                   "items": [number], "source": "backfill"})
        facts = {name: self.sql('SELECT * FROM "' + name + '"') for name in
                 ("message_acts", "pipeline_item_sources", "pipeline_facts", "releases", "pipeline_piece_freezes")}
        fresh = self.layout()
        migrations.migrate(self.path, "test-instance", target="61", binding=self.binding)
        self.assertEqual(self.layout(), PREDECESSOR,
                         "downgrade equals the literal layout exported from actual frozen987, not the migration implementation")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("61",)])
        refused = self.store.view("owner", "dossier_cover", {"message_id": source})
        self.assertEqual(refused["error"]["code"], "SCHEMA_MISMATCH", "reads do not migrate")
        migrations.migrate(self.path, "test-instance", binding=self.binding)
        self.assertEqual(self.layout(), fresh, "upgrade matches a fresh current-schema store")
        self.assertEqual(self.sql("SELECT item,release FROM source_cover_releases"), [(number, 757)])
        for name, rows in facts.items():
            self.assertEqual(self.sql('SELECT * FROM "' + name + '"'), rows, name)
        self.assertEqual(self.shown(source)["cover"]["waiting"], WAIT)
        self.assertFalse(migrations.migrate(self.path, "test-instance", binding=self.binding)["migrated"])

    def test_failed_step_rolls_back_schema_backfill_metadata_and_records(self):
        migrations.migrate(self.path, "test-instance", target="61", binding=self.binding)
        layout, records = self.layout(), self.records()
        steps = tuple((before, after, list(up) + ["SELECT missing_757_column FROM metadata"], down, occupied)
                      if (before, after) == ("61", "62") else (before, after, up, down, occupied)
                      for before, after, up, down, occupied in migrations.STEPS)
        with mock.patch.object(migrations, "STEPS", steps):
            with self.assertRaises(migrations.MigrationError) as raised:
                migrations.migrate(self.path, "test-instance", target="62", binding=self.binding)
        self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
        self.assertEqual(self.layout(), layout)
        self.assertEqual(self.records(), records, "no partial relation, metadata or authority-record change escapes")

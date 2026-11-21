from __future__ import annotations

import hashlib
import sqlite3
import unittest

from aim_next import migrations
from aim_next.hosted_seats import SEAT_DOWN
from aim_next.store import SCHEMA_VERSION
import test_store as fixture


class SeatMigration(unittest.TestCase):
    setUp_store = fixture.StoreCase.setUp
    workspace = fixture.StoreCase.workspace
    command = fixture.StoreCase.command
    sql = fixture.StoreCase.sql

    def setUp(self):
        self.setUp_store()
        self.workspace()
        # Remove only this slice's empty tables in a scratch store. Every
        # predecessor table/data/authority remains, including987/757 and1004
        # when its approved head is composed. This models the real before-layout.
        self.before = next((step[0] for step in migrations.STEPS
                            if any(isinstance(statement, str) and statement.startswith('CREATE TABLE hosted_seats ')
                                   for statement in step[2])), SCHEMA_VERSION)

    def predecessor(self):
        with sqlite3.connect(str(self.path)) as db:
            for statement in SEAT_DOWN:
                db.execute(statement)
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (self.before,))

    def test_upgrade_preserves_predecessor_data_and_enables_one_recorded_seat(self):
        self.predecessor()
        original = self.sql('SELECT * FROM workspace_members')
        migrations.migrate(self.path, 'test-instance', self.binding)
        tables = self.sql("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hosted_seats','hosted_seat_events')")
        self.assertEqual(set(row[0] for row in tables), {'hosted_seats', 'hosted_seat_events'})
        self.assertEqual(self.sql('SELECT * FROM workspace_members'), original)
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        result = self.command('workspace.hosted_seat_add', {'name': 'Scribe', 'role': 'Keep exact bytes.'},
                              {'workspace_id': 'w1'}, {'workspace_revision': version})
        self.assertEqual(result['status'], 'committed', result)
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with self.assertRaises(migrations.MigrationError):
            migrations.migrate(self.path, 'test-instance', self.binding, self.before)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_empty_step_roundtrips_and_does_not_drop_its_predecessors(self):
        self.predecessor()
        migrations.migrate(self.path, 'test-instance', self.binding)
        self.assertEqual(self.sql("SELECT count(*) FROM sqlite_master WHERE name='hosted_seats'"), [(1,)])
        migrations.migrate(self.path, 'test-instance', self.binding, self.before)
        self.assertEqual(self.sql("SELECT count(*) FROM sqlite_master WHERE name='hosted_seats'"), [(0,)])
        self.assertEqual(self.sql("SELECT title FROM workspaces WHERE id='w1'"), [('Isolated test',)])
        migrations.migrate(self.path, 'test-instance', self.binding)
        self.assertEqual(self.sql("SELECT count(*) FROM sqlite_master WHERE name='hosted_seats'"), [(1,)])


if __name__ == '__main__':
    unittest.main()

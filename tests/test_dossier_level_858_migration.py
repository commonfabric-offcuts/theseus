from __future__ import annotations

import hashlib
import sqlite3
from unittest import mock

from aim_next import migrations
from aim_next.stacks import ACT_MESSAGE_REFRESH
from aim_next.store import Store, SCHEMA_VERSION
from test_dossier_level_858 import DossierLevel858Case


class DossierLevelMigration858(DossierLevel858Case):
    def old_layout(self):
        root = self.post()
        self.committed(self.star(root))
        self.committed(self.fold(root))
        migrations.migrate(self.path, 'test-instance', self.binding, '65')
        with sqlite3.connect(str(self.path)) as db:
            # Historical table is unchanged, independently compared with the
            # actual65 layout. Leave a real sequence gap beyond its last row.
            self.assertEqual(db.execute("SELECT sql FROM sqlite_master WHERE name='message_acts'").fetchone()[0], ACT_MESSAGE_REFRESH[0])
            db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) SELECT 'deal',id,topic_id,seq,'owner','owner','{\"dealt\":true}',5,1 FROM messages WHERE id=?", (root,))
            db.execute("DELETE FROM message_acts WHERE kind='deal'")
        return root

    def snapshot(self):
        with sqlite3.connect(str(self.path)) as db:
            return (db.execute('SELECT * FROM message_acts ORDER BY id').fetchall(),
                    db.execute("SELECT seq FROM sqlite_sequence WHERE name='message_acts'").fetchone(),
                    db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND (tbl_name='message_acts' OR name='stack_replies') ORDER BY name").fetchall())

    def test_858_migration_keeps_rows_revisions_indexes_and_sequence_gap_both_ways(self):
        root = self.old_layout()
        before = self.snapshot()
        migrations.migrate(self.path, 'test-instance', self.binding)
        self.assertEqual(self.snapshot(), before)
        migrations.migrate(self.path, 'test-instance', self.binding, '65')
        self.assertEqual(self.snapshot(), before)
        migrations.migrate(self.path, 'test-instance', self.binding)
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        saved = self.committed(self.level(root, 'folded'))
        self.assertEqual(saved['acts_version'], before[1][0] + 1)
        self.assertEqual(self.position(root)['level'], 'folded')

    def test_858_migration_rollback_refuses_even_after_choice_cleared(self):
        root = self.old_layout()
        migrations.migrate(self.path, 'test-instance', self.binding)
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.committed(self.level(root, 'folded'))
        self.committed(self.level(root, None, revision=1))
        before = self.path.read_bytes()
        with self.assertRaises(migrations.MigrationError) as raised:
            migrations.migrate(self.path, 'test-instance', self.binding, '65')
        self.assertEqual(raised.exception.code, 'RECORDS_WOULD_BE_LOST')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.position(root)['level_revision'], 2)

    def test_858_failed_upgrade_is_atomic_and_restored_step_succeeds(self):
        self.old_layout()
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        broken = tuple((old, new, list(up) + ['SELECT absent_858_column FROM metadata'], down, occupied)
                       if new == SCHEMA_VERSION else (old, new, up, down, occupied)
                       for old, new, up, down, occupied in migrations.STEPS)
        with mock.patch.object(migrations, 'STEPS', broken):
            with self.assertRaises(migrations.MigrationError):
                migrations.migrate(self.path, 'test-instance', self.binding)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        self.assertTrue(migrations.migrate(self.path, 'test-instance', self.binding)['migrated'])

# Only these migration cases are collected here; the inherited behavior cohort
# runs once in its own file.
for _name in DossierLevel858Case.__dict__:
    if _name.startswith('test_'):
        setattr(DossierLevelMigration858, _name, None)
del DossierLevel858Case

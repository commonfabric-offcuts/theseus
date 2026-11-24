from __future__ import annotations

"""858's schema step on a store whose acts are referenced from another table, as live's are.

refresh_requests (829) points at message_acts(id); 858's step rebuilds message_acts, so the
move must keep every act and every reference, in both directions."""

import hashlib
from unittest import mock

from aim_next import migrations
from aim_next.store import SCHEMA_VERSION
from test_refresh_requests_829 import RequestCase


class DossierLevelReferences858(RequestCase):
    def kept(self):
        rows = {name: self.sql('SELECT * FROM "%s" ORDER BY rowid' % name)
                for name in ("message_acts", "refresh_requests", "deliveries")}
        # 1200 adds a typed delivery reference after this historical step.
        # Prove its default explicitly, then retain every older column exactly.
        columns = [row[1] for row in self.sql("PRAGMA table_info(deliveries)")]
        if "browser_job_id" in columns:
            index = columns.index("browser_job_id")
            self.assertTrue(all(row[index] is None for row in rows["deliveries"]),
                            "the historical fixture has no browser-job deliveries")
            rows["deliveries"] = [row[:index] + row[index + 1:] for row in rows["deliveries"]]
        # A change to the acts is announced at its row id, so where the next id goes on from is kept too.
        rows["sequence"] = self.sql("SELECT seq FROM sqlite_sequence WHERE name='message_acts'")
        return rows

    def test_858_step_keeps_acts_that_refresh_requests_reference_both_ways(self):
        self.committed(self.request("message", op="refresh-before-858-step"))
        before = self.kept()
        self.assertTrue(before["refresh_requests"], "the fixture needs a real refresh request")
        migrations.migrate(self.path, "test-instance", self.binding, "66")
        self.assertEqual(self.kept(), before)
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
        migrations.migrate(self.path, "test-instance", self.binding)
        self.assertEqual(self.kept(), before)
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])


    def test_858_step_that_breaks_a_reference_refuses_and_changes_nothing(self):
        self.committed(self.request("message", op="refresh-before-broken-step"))
        migrations.migrate(self.path, "test-instance", self.binding, "66")
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        loses_act = "DELETE FROM message_acts WHERE id=(SELECT act_id FROM refresh_requests LIMIT 1)"
        broken = tuple((old, new, list(up) + [loses_act], down, occupied) if new == SCHEMA_VERSION
                       else (old, new, up, down, occupied) for old, new, up, down, occupied in migrations.STEPS)
        with mock.patch.object(migrations, "STEPS", broken):
            with self.assertRaises(migrations.MigrationError) as raised:
                migrations.migrate(self.path, "test-instance", self.binding)
        # Refused before the commit: not an unconfirmed outcome, and neither the version nor the sequence moved.
        self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
        self.assertFalse(raised.exception.retryable)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("66",)])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        self.assertTrue(migrations.migrate(self.path, "test-instance", self.binding)["migrated"])

# Only this case is collected here; the inherited request and cover cases run in their own files.
for _name in dir(DossierLevelReferences858):
    if _name.startswith("test_") and not _name.startswith("test_858_"):
        setattr(DossierLevelReferences858, _name, None)
del RequestCase

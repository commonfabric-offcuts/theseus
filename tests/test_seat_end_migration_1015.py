from __future__ import annotations

import hashlib
import sqlite3
import unittest
from unittest import mock

from aim_next import migrations
import test_hosted_seat_1002 as base


class EndMigration(base.HostedSeatCore):
    def test_failed_65_step_preserves_every_original_byte(self):
        migrations.migrate(self.path,'test-instance',self.binding,'64')
        digest=hashlib.sha256(self.path.read_bytes()).hexdigest()
        steps=tuple((old,new,list(up)+['SELECT missing_1015_column FROM metadata'],down,occupied)
                    if (old,new)==('64','65') else (old,new,up,down,occupied)
                    for old,new,up,down,occupied in migrations.STEPS)
        self.assertEqual(sum(new=='65' and up[-1]=='SELECT missing_1015_column FROM metadata'
                             for old,new,up,down,occupied in steps),1)
        with mock.patch.object(migrations,'STEPS',steps):
            with self.assertRaises(migrations.MigrationError):
                migrations.migrate(self.path,'test-instance',self.binding)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),digest)

    def test_64_to_65_keeps_occupied_seat_and_events_and_refuses_lossy_down(self):
        seat=self.added()['seat']

        # Remove later empty layouts before independently modelling64 below.
        # A successor column left in a database labelled64 is not that layout.
        migrations.migrate(self.path,'test-instance',self.binding,'65')
        with sqlite3.connect(str(self.path)) as db:
            # Downgrade only this new, still unused End layout using its actual
            # independent SQL; existing1002 seat/events are retained.
            for index in ('hosted_seats_ending','hosted_seats_active','hosted_seats_setup','hosted_seats_adopt'):
                db.execute('DROP INDEX '+index)
            for column in ('end_version','end_ms','end_by','end_state'):
                db.execute('ALTER TABLE hosted_seats DROP COLUMN '+column)
            db.execute("UPDATE metadata SET value='64' WHERE key='schema_version'")
        before=self.sql('SELECT id,agent_id,role,state,version FROM hosted_seats')
        events=self.sql('SELECT * FROM hosted_seat_events')
        migrations.migrate(self.path,'test-instance',self.binding)
        self.assertEqual(self.sql('SELECT id,agent_id,role,state,version FROM hosted_seats'),before)
        self.assertEqual(self.sql('SELECT * FROM hosted_seat_events'),events)
        end=self.command('workspace.hosted_seat_end',{}, {'workspace_id':'w1','seat_request_id':seat['id']},{'seat_revision':seat['version']})
        self.assertEqual(end['status'],'committed',end)
        digest=hashlib.sha256(self.path.read_bytes()).hexdigest()
        with self.assertRaises(migrations.MigrationError):
            migrations.migrate(self.path,'test-instance',self.binding,'64')
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),digest)

for _name in base.HostedSeatCore.__dict__:
    if _name.startswith('test_'):
        setattr(EndMigration,_name,None)

if __name__ == '__main__':
    unittest.main()

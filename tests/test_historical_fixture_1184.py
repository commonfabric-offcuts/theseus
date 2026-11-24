from __future__ import annotations

"""Occupied records, allocation and rollback in the test-only old-layout builder."""
from collections import Counter
from contextlib import closing
from pathlib import Path
import sqlite3

from reader_fixture import ReaderCase
from tests.historical_fixture import _layout, post_fields, restore_frozen_layout


def snapshot(path):
    with closing(sqlite3.connect(str(path))) as db:
        schema = sorted(db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL'))
        tables = {}
        for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name<>'sqlite_sequence' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            columns = tuple(row[1] for row in db.execute('PRAGMA table_info(' + quoted + ')'))
            tables[name] = (columns, list(db.execute('SELECT * FROM ' + quoted + ' ORDER BY rowid')))
        return {'schema': schema, 'tables': tables,
                'sequences': dict(db.execute('SELECT name,seq FROM sqlite_sequence'))}


class HistoricalFixture1184Case(ReaderCase):
    def setUp(self):
        super().setUp()
        self.first = self.committed(self.command('message.post', {
            'body': 'Occupied exact first words', 'addressees': ['agent-b'], 'intent': 'tell'},
            target={'topic_id': 't1'}, actor='agent-a'))['message_id']
        self.reply = self.committed(self.command('message.post', post_fields(self, 'agent-b', {
            'body': 'Occupied exact reply', 'reply_to': self.first,
            'addressees': ['agent-a'], 'intent': 'tell'}),
            target={'topic_id': 't1'}, actor='agent-b'))['message_id']
        self.committed(self.command('memory.create', {
            'title': 'Occupied notebook', 'body': 'Original notebook words', 'attachments': [], 'references': []},
            target={'item_id': 'occupied-note', 'owner_scope': {'kind': 'topic', 'id': 't1'}},
            expected={'item_revision': 0}, actor='agent-a'))
        self.committed(self.command('memory.revise', {
            'title': 'Occupied notebook revised', 'body': 'Revised notebook words', 'attachments': [], 'references': []},
            target={'item_id': 'occupied-note'}, expected={'item_revision': 1}, actor='agent-a'))
        self.committed(self.command('message.fold', {'folded': True}, target={'message_id': self.first},
                                    expected={'fold_revision': 0}, actor='owner'))
        with closing(sqlite3.connect(str(self.path))) as db:
            with db:
                db.execute("UPDATE sqlite_sequence SET seq=seq+1000 WHERE name='deliveries'")
        # A setup receipt can record these construction facts without executing
        # any old-layout helper or the assertions below.
        self.fixture_facts = {
            'messages': self.sql('SELECT count(*) FROM messages')[0][0],
            'notebook_revisions': self.sql("SELECT count(*) FROM memory_revisions WHERE item_id='occupied-note'")[0][0],
            'folds': self.sql("SELECT count(*) FROM message_acts WHERE kind='fold'")[0][0],
            'delivery_high_water': self.sql("SELECT seq FROM sqlite_sequence WHERE name='deliveries'")[0][0],
            'maximum_delivery': self.sql('SELECT max(seq) FROM deliveries')[0][0],
        }

    def test_occupied_shared_rows_and_exact_frozen_layout_survive(self):
        before = snapshot(self.path)
        self.assertGreater(self.fixture_facts['notebook_revisions'], 1)
        restore_frozen_layout(self.path, '46')
        after = snapshot(self.path)
        expected_sql = sorted(line.rstrip(';') for line in
                              (Path(__file__).parent / 'fixtures/schema_46.sql').read_text().splitlines())
        self.assertEqual(sorted(row[3] for row in after['schema']), expected_sql)
        for name, (kind, _) in _layout('46').items():
            if kind != 'table' or name == 'sqlite_sequence':
                continue
            old_columns, old_rows = before['tables'][name]
            new_columns, new_rows = after['tables'][name]
            shared = [column for column in new_columns if column in old_columns]
            expected = [tuple(row[old_columns.index(column)] for column in shared) for row in old_rows]
            if name == 'metadata':
                key, value = shared.index('key'), shared.index('value')
                expected = [tuple('46' if index == value and row[key] == 'schema_version' else cell
                                  for index, cell in enumerate(row)) for row in expected]
            actual = [tuple(row[new_columns.index(column)] for column in shared) for row in new_rows]
            self.assertEqual(Counter(actual), Counter(expected), ('occupied shared rows', name))

    def test_rebuilt_delivery_sequence_keeps_its_high_water_and_next_allocation(self):
        high_water = self.fixture_facts['delivery_high_water']
        self.assertGreater(high_water, self.fixture_facts['maximum_delivery'])
        restore_frozen_layout(self.path, '46')
        self.assertEqual(self.sql("SELECT seq FROM sqlite_sequence WHERE name='deliveries'"), [(high_water,)],
                         'rebuilding an occupied delivery table keeps its allocation high-water mark')
        with closing(sqlite3.connect(str(self.path))) as db:
            with db:
                message, recipient, group, topic = db.execute(
                    'SELECT message_id,recipient_id,group_id,topic_id FROM deliveries ORDER BY seq LIMIT 1').fetchone()
                db.execute('INSERT INTO deliveries(id,message_id,recipient_id,group_id,state,topic_id,revision) '
                           "VALUES ('after-high-water',?,?,?,'pending',?,999)", (message, recipient, group, topic))
                allocated = db.execute("SELECT seq FROM deliveries WHERE id='after-high-water'").fetchone()[0]
        self.assertEqual(allocated, high_water + 1, 'the next actual insert cannot reuse an allocated sequence')

    def test_incompatible_occupied_acts_restore_everything_and_close_the_connection(self):
        self.assertGreater(self.fixture_facts['folds'], 0)
        before = snapshot(self.path)
        handles = []
        class WatchedConnection(sqlite3.Connection):
            closed = False
            def close(self):
                super().close()
                self.closed = True
        def connect(*args, **kwargs):
            db = sqlite3.connect(*args, factory=WatchedConnection, **kwargs)
            handles.append(db)
            return db
        # Version36 retains message_acts but rejects fold; version34 predates
        # the table and would merely remove it as a non-target object.
        with self.assertRaisesRegex(ValueError, r'Frozen layout 36 cannot preserve table message_acts: CHECK constraint failed'):
            restore_frozen_layout(self.path, '36', connect=connect)
        self.assertEqual(snapshot(self.path), before, 'incompatible occupied actions roll the complete reconstruction back')
        self.assertEqual(len(handles), 1)
        self.assertTrue(handles[0].closed)
        with self.assertRaises(sqlite3.ProgrammingError):
            handles[0].execute('SELECT 1')
        with closing(sqlite3.connect(str(self.path))) as db:
            db.execute('BEGIN IMMEDIATE')
            db.rollback()

    def test_positive_adapter_preserves_explicit_choices_and_person_replies(self):
        base = {'body': 'Exact reply words', 'reply_to': self.first, 'addressees': ['agent-a'], 'intent': 'tell'}
        adapted = post_fields(self, 'agent-b', base)
        self.assertEqual({key: value for key, value in adapted.items() if key != 'reply_without_quote'}, base)
        self.assertTrue(adapted['reply_without_quote'])
        self.assertEqual(post_fields(self, 'owner', base), base)
        for explicit in [{'reply_without_quote': None}, {'reply_without_quote': 'Exact authored reason'},
                         {'reply_passage': None}, {'reply_passage': {'source': 'deliberately invalid explicit input'}}]:
            supplied = dict(base, **explicit)
            self.assertEqual(post_fields(self, 'agent-b', supplied), supplied)

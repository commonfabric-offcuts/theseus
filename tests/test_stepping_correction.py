from __future__ import annotations

import json
import sqlite3
import time
import unittest
from unittest import mock

from reader_fixture import ReaderCase


class SteppingCorrectionCase(ReaderCase):
    def page(self, **args):
        result = self.store.view('owner', 'topic_messages', dict(topic_id='t1', audience='reader', **args))
        self.assertNotIn('error', result, result)
        return result

    def test_addressed_backwards_selects_nearest_before_limiting_each_page(self):
        rows = [self.send('Addressed %s' % index, ['owner']) for index in range(6)]
        for limit in (1, 2):
            with self.subTest(limit=limit):
                cursor, seen = rows[-1]['seq'] + 1, []
                while len(seen) < len(rows):
                    page = self.page(direction='before', cursor=cursor, limit=limit)
                    wanted = rows[max(0, len(rows) - len(seen) - limit):len(rows) - len(seen)]
                    self.assertEqual([item['id'] for item in page['items']], [item['id'] for item in wanted])
                    seen.extend(item['id'] for item in reversed(page['items']))
                    if len(seen) < len(rows):
                        self.assertEqual(page['next_cursor'], wanted[0]['seq'])
                        cursor = page['next_cursor']
                self.assertEqual(seen, [item['id'] for item in reversed(rows)])

    def check_single_stream(self, addressees):
        rows = [self.send('Single stream %s' % index, addressees) for index in range(5)]
        for limit in (1, 2):
            cursor, seen = rows[0]['seq'] - 1, []
            while len(seen) < len(rows):
                page = self.page(cursor=cursor, limit=limit)
                wanted = rows[len(seen):len(seen) + limit]
                self.assertEqual([item['id'] for item in page['items']], [item['id'] for item in wanted])
                seen.extend(item['id'] for item in page['items'])
                self.assertEqual(page['next_cursor'], wanted[-1]['seq'] if len(seen) < len(rows) else None)
                cursor = page['next_cursor']

    def test_addressed_only_lookahead_is_not_supplied_by_other_stream(self):
        self.check_single_stream(['owner'])

    def test_unaddressed_only_lookahead_is_not_supplied_by_other_stream(self):
        self.check_single_stream([])

    def measured(self, cursor):
        original = sqlite3.connect
        counters, active, total = {}, [None], [0]
        fixture = self
        class MeasuredCursor:
            def __init__(self, cursor, stream):
                self.cursor, self.stream = cursor, stream
            def fetchall(self):
                active[0] = self.stream
                try:
                    return self.cursor.fetchall()
                finally:
                    active[0] = None
        class Connection(sqlite3.Connection):
            def execute(db, statement, parameters=()):
                stream = None
                if statement.startswith('SELECT m.seq,m.id'):
                    stream = 'addressed' if 'message_addressees' in statement else 'unaddressed'
                    fixture.assertNotIn(stream, counters, 'Measured stream executed twice')
                    counters[stream] = 0
                active[0] = stream
                try:
                    result = super().execute(statement, parameters)
                finally:
                    active[0] = None
                return MeasuredCursor(result, stream) if stream else result
        def connect(*args, **kwargs):
            db = original(*args, factory=Connection, **kwargs)
            def progress():
                total[0] += 1
                if active[0] is not None:
                    counters[active[0]] += 1
                return 0
            db.set_progress_handler(progress, 1)
            return db
        with mock.patch.object(sqlite3, 'connect', connect):
            page = self.page(cursor=cursor, limit=1)
        self.assertEqual(set(counters), {'addressed', 'unaddressed'})
        self.assertTrue(all(value > 0 for value in counters.values()), counters)
        self.assertGreater(total[0], sum(counters.values()))
        return page, dict(counters, whole=total[0])

    def eligible_growth(self, mode):
        first = self.send('First eligible', ['owner'] if mode == 'addressed' else [])
        self.send('Lookahead eligible', ['owner'] if mode == 'addressed' else [])
        baseline, work = self.measured(first['seq'] - 1)
        started = time.perf_counter()
        with sqlite3.connect(str(self.path)) as db:
            for index in range(3000):
                addressed = mode == 'addressed' or (mode == 'mixed' and index % 2 == 0)
                addressees = '["owner"]' if addressed else '[]'
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) VALUES (?,'t1','owner','Eligible','[]','[]',?,?)",
                    ('eligible-%s' % index, addressees, 'fixture-%s' % index)).lastrowid
                if addressed:
                    db.execute("INSERT INTO message_addressees VALUES ('t1','owner',?)", (seq,))
            # Each of these is the reader's post to the whole topic, so, as a
            # sent post does, it leaves the reader's horizon past itself.
            db.execute("INSERT INTO reply_horizons VALUES ('t1','owner',?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET seq=excluded.seq",
                       (seq + 1,))
        setup_seconds = time.perf_counter() - started
        page, grown = self.measured(first['seq'] - 1)
        self.assertEqual(page, baseline)
        self.assertEqual([item['id'] for item in page['items']], [first['id']])
        print(json.dumps(dict(phase='eligible_stream_work', mode=mode, setup_seconds=setup_seconds,
                              baseline_vm=work, grown_vm=grown)))
        for stream in ('addressed', 'unaddressed', 'whole'):
            self.assertLess(grown[stream], work[stream] + 300, (stream, work, grown))

    def test_addressed_eligible_growth_keeps_its_actual_query_bounded(self):
        self.eligible_growth('addressed')

    def test_unaddressed_eligible_growth_keeps_its_actual_query_bounded(self):
        self.eligible_growth('unaddressed')

    def test_mixed_eligible_growth_keeps_both_actual_queries_bounded(self):
        self.eligible_growth('mixed')


del ReaderCase

if __name__ == '__main__':
    unittest.main()

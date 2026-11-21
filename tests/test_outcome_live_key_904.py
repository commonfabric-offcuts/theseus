from __future__ import annotations

import sqlite3
import unittest

import reader_fixture as fixtures
import test_http_live as live_fixture


class OutcomeKeyCase(fixtures.ReaderCase):
    def key(self, actor='owner'):
        rows = self.sql('SELECT value FROM metadata WHERE key=?', ('outcome_list:' + actor,))
        return rows[0][0] if rows else None

    def test_outcome_changes_advance_member_keys_but_messages_and_refusals_do_not(self):
        before = self.key()
        self.assertIsNotNone(before, 'creation records its readers\' list keys')
        agent = self.key('agent-a')
        self.assertIsNone(self.key('other-reader'), 'a nonmember learns no outcome change')
        version = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.update', {'title': 'Renamed'}, target={'workspace_id': 'w1'}, expected={'workspace_revision': version}))
        self.assertNotEqual(self.key(), before)
        self.assertNotEqual(self.key('agent-a'), agent)
        before = self.key()
        self.committed(self.command('message.post', {'body': 'Ordinary writing', 'addressees': ['agent-a'], 'intent': 'tell'}, target={'topic_id': 't1'}))
        self.assertEqual(self.key(), before, 'a message must not reread the global list')
        self.rejected(self.command('workspace.update', {'title': 'Stale'}, target={'workspace_id': 'w1'}, expected={'workspace_revision': 1}), 'REVISION_CONFLICT')
        self.assertEqual(self.key(), before)
        version = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.end_set', {'state': 'archived'}, target={'workspace_id': 'w1'}, expected={'workspace_revision': version}))
        self.assertNotEqual(self.key(), before)

    def test_personal_outcome_order_only_changes_that_readers_key(self):
        self.assertIsNotNone(self.key())
        before, other = self.key(), self.key('agent-a')
        self.committed(self.command('outline.order_set', {'ids': ['w1']}, expected={'order_revision': 0}))
        self.assertNotEqual(self.key(), before)
        self.assertEqual(self.key('agent-a'), other)
        before = self.key()
        self.committed(self.command('outline.order_set', {'ids': ['t1']}, target={'workspace_id': 'w1'}, expected={'order_revision': 0}))
        self.assertEqual(self.key(), before, 'topic order belongs to its existing scoped owner')


class LiveKeyCase(unittest.TestCase):
    setUp = live_fixture.LiveStreamTests.setUp
    start = live_fixture.LiveStreamTests.start
    stop = live_fixture.LiveStreamTests.stop
    tearDown = live_fixture.LiveStreamTests.tearDown
    open = live_fixture.LiveStreamTests.open
    line = live_fixture.LiveStreamTests.line
    commit = live_fixture.LiveStreamTests.commit

    def test_real_live_stream_carries_the_readers_transactional_list_key(self):
        client = self.open()
        first = self.line(client)
        self.assertEqual(first.get('outcomes'), '0', 'older stores need no migration')
        self.commit()
        changed = self.line(client)
        with sqlite3.connect(str(self.db)) as db:
            key = db.execute("SELECT value FROM metadata WHERE key='outcome_list:test-human'").fetchone()[0]
            seq = int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])
        self.assertEqual(changed['outcomes'], key)
        self.assertEqual(changed['seq'], seq)
        self.assertNotIn('w-live', str(changed), 'the hint carries no outcome identity')

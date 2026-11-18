from __future__ import annotations

"""Item 756: isolated synthetic records, through the shared Core views."""

import unittest
import test_store as fixtures


class CoverWaiting756Case(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    sql = fixtures.StoreCase.sql
    workspace = fixtures.StoreCase.workspace
    save_draft = fixtures.StoreCase.save_draft
    prepare = fixtures.StoreCase.prepare
    create_topic = fixtures.StoreCase.create_topic

    def committed(self, receipt):
        self.assertEqual(receipt['status'], 'committed', receipt)
        return receipt['result']

    def cover(self, root, waiting, revision=0):
        return self.committed(self.command('stack.cover', {'waiting': waiting},
            target={'message_id': root}, expected={'cover_revision': revision}, actor='agent-a'))

    def item(self, actor='owner'):
        return next(i for i in self.store.view(actor, 'workspaces', {})['items'] if i['id'] == 'w1')

    def test_item_756_two_covers_count_once_each_and_clear_immediately(self):
        first = self.create_topic()['id']
        second = self.committed(self.command('message.post', {'body': 'Another fictional folder'},
            target={'topic_id': 't1'}, actor='agent-a'))['message_id']
        wait = {'text': 'Choose the cabin', 'default': 'Keep the current cabin'}
        self.cover(first, [wait, wait])
        self.cover(second, [wait])
        self.assertEqual(self.item().get('cover_waiting', 0), 2, 'two readable covers, not three wait entries')
        self.assertEqual(self.item('agent-a').get('cover_waiting', 0), 0, 'only the outcome owner is named')
        before = self.sql('SELECT max(seq) FROM changes')[0][0]
        self.cover(first, [], 1)
        self.assertEqual(self.item()['cover_waiting'], 1)
        self.assertEqual(self.store.view('owner', 'workspace_topics', {'workspace_id': 'w1'})['items'][0]['cover_waiting'], 1)
        told = self.sql("SELECT scope_id FROM changes WHERE seq>? AND resource_kind='acts'", (before,))
        self.assertIn(('owner',), told, 'the existing owner act event invalidates the rail')
        self.cover(second, [], 1)
        self.assertEqual(self.item()['cover_waiting'], 0)

    def topic(self, topic, workspace='w1'):
        opening = 'opening-' + topic
        self.committed(self.command('opening.save', {'workspace_id': workspace, 'topic_id': topic,
            'title': 'Fictional topic ' + topic, 'participants': ['agent-a'], 'body': 'Cabin folder', 'attachments': []},
            target={'opening_id': opening}, expected={'opening_revision': 0}))
        return self.committed(self.command('opening.publish', target={'opening_id': opening},
            expected={'opening_revision': 1}))['message_id']

    def update(self, topic, args):
        version = self.store.view('owner', 'topic', {'topic_id': topic})['topic']['version']
        return self.committed(self.command('topic.update', args, target={'topic_id': topic},
            expected={'topic_revision': version}))

    def test_item_756_all_topics_not_just_the_loaded_page_and_existing_asks_remain(self):
        first = self.create_topic()['id']
        second = self.topic('second')
        wait = [{'text': 'Choose', 'default': 'Keep'}]
        self.cover(first, wait)
        self.cover(second, wait)
        self.committed(self.command('message.post', {'body': 'A separate open ask', 'addressees': ['owner'], 'intent': 'ask'},
            target={'topic_id': 't1'}, actor='agent-a'))
        item = self.item()
        self.assertEqual(item['cover_waiting'], 2)
        self.assertEqual(item['light']['short'], {'kind': 'asks', 'count': 1}, 'cover projection leaves said/ask union intact')
        page = self.store.view('owner', 'workspace_topics', {'workspace_id': 'w1', 'limit': 1})
        self.assertEqual(len(page['items']), 1)
        self.assertEqual(page['items'][0]['cover_waiting'], 1)
        self.assertIsNotNone(page['next_cursor'])
        self.assertEqual(self.item()['cover_waiting'], 2, 'the other topic is outside the loaded page')
        # An unrelated outcome does not make this outcome scan or count its covers.
        self.committed(self.command('workspace.create', {'id': 'w2', 'title': 'Other fictional trip', 'team': ['agent-a']}))
        third = self.topic('third', 'w2')
        self.cover(third, wait)
        items = self.store.view('owner', 'workspaces', {})['items']
        self.assertEqual({i['id']: i['cover_waiting'] for i in items}, {'w1': 2, 'w2': 1})

    def test_item_756_visibility_current_owner_membership_and_archive(self):
        public = self.create_topic()['id']
        private = self.committed(self.command('message.post', {'body': 'Private cabin plan', 'addressees': ['agent-a'], 'whisper': True},
            target={'topic_id': 't1'}))['message_id']
        wait = [{'text': 'Choose', 'default': 'Keep'}]
        self.cover(public, wait)
        self.cover(private, wait)
        self.assertEqual(self.item()['cover_waiting'], 2)
        self.assertEqual(self.item('agent-b')['cover_waiting'], 0)
        version = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.owner_set', {'owner_id': 'agent-b'}, target={'workspace_id': 'w1'},
            expected={'workspace_revision': version}))
        self.assertEqual(self.item()['cover_waiting'], 0, 'old owner no longer named')
        self.assertEqual(self.item('agent-b')['cover_waiting'], 1, 'new owner cannot see the private cover')
        version = self.store.view('agent-b', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.member_set', {'actor_id': 'owner', 'present': False}, target={'workspace_id': 'w1'},
            expected={'workspace_revision': version}, actor='agent-b'))
        self.assertEqual(self.store.view('owner', 'workspaces', {})['items'], [], 'removed member has no outline count leak')
        self.update('t1', {'archived': True})  # creator still organises this topic
        self.assertEqual(self.item('agent-b')['cover_waiting'], 0)
        archived = self.store.view('agent-b', 'workspace_topics', {'workspace_id': 'w1', 'archived': True})
        self.assertEqual(archived['items'][0]['cover_waiting'], 0)
        self.update('t1', {'archived': False})
        self.assertEqual(self.item('agent-b')['cover_waiting'], 1)
        denied = self.store.view('agent-a', 'workspace_topics', {'workspace_id': 'missing'})
        self.assertIn('error', denied)

    def test_item_756_joined_away_cover_and_latest_only_projection(self):
        first = self.create_topic()['id']
        second = self.committed(self.command('message.post', {'body': 'Other folder'}, target={'topic_id': 't1'}))['message_id']
        wait = [{'text': 'Choose', 'default': 'Keep'}]
        self.cover(first, wait)
        self.cover(first, wait + wait, 1)
        self.assertEqual(self.sql('SELECT count(*) FROM cover_waiting'), [(1,)])
        self.committed(self.command('stack.join', {'into': second}, target={'message_id': first}, expected={'join_revision': 0}))
        self.assertEqual(self.item()['cover_waiting'], 0, 'a joined-away first message is no longer a visible dossier cover')
        self.committed(self.command('stack.join', {'into': None}, target={'message_id': first}, expected={'join_revision': 1}))
        self.assertEqual(self.item()['cover_waiting'], 1)
        self.cover(first, [], 2)
        self.assertEqual(self.sql('SELECT count(*) FROM cover_waiting'), [(0,)], 'cleared history is absent from the read index')

    def test_item_756_migration_backfills_latest_waits_and_downgrade_retains_acts(self):
        from aim_next.migrations import migrate
        root = self.create_topic()['id']
        other = self.topic('second')
        wait = [{'text': 'Choose', 'default': 'Keep'}]
        self.cover(root, wait)
        self.cover(root, wait + wait, 1)
        self.cover(other, wait)
        self.cover(other, [], 1)
        before = self.sql('SELECT * FROM message_acts ORDER BY id')
        migrate(self.path, 'test-instance', binding=self.binding, target='47')
        self.assertEqual(self.sql("SELECT count(*) FROM sqlite_master WHERE name='cover_waiting'"), [(0,)])
        self.assertEqual(self.sql('SELECT * FROM message_acts ORDER BY id'), before)
        migrate(self.path, 'test-instance', binding=self.binding)
        self.assertEqual(self.item()['cover_waiting'], 1)
        self.assertEqual(self.sql('SELECT message_id FROM cover_waiting'), [(root,)])
        self.assertEqual(self.sql('SELECT * FROM message_acts ORDER BY id'), before)
        self.cover(root, [], 2)
        self.assertEqual(self.item()['cover_waiting'], 0)

    def test_item_756_count_reads_seek_only_current_scoped_candidates(self):
        from aim_next.store import _connect
        root = self.create_topic()['id']
        self.cover(root, [{'text': 'Choose', 'default': 'Keep'}])
        db, _ = _connect(self.path)
        try:
            trace = []
            db.set_trace_callback(trace.append)
            self.assertEqual(self.store._cover_wait_counts(db, 'owner', workspace_id='w1'), {'t1': 1})
            self.assertEqual(self.store._cover_wait_counts(db, 'owner', topics=['t1']), {'t1': 1})
            projections = [q for q in trace if q.startswith('SELECT c.message_id,c.topic_id FROM cover_waiting')]
            self.assertEqual(len(projections), 2)
            for query, index in zip(projections, ('outcome_cover_waiting', 'topic_cover_waiting')):
                plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + query)]
                self.assertTrue(any('SEARCH c USING COVERING INDEX ' + index in row for row in plan), plan)
                self.assertFalse(any('SCAN c' in row for row in plan), plan)
            self.assertFalse(any('SELECT a.* FROM message_acts' in q for q in trace), 'count never reconstructs act history')
        finally:
            db.close()

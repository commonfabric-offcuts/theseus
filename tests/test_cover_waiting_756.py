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

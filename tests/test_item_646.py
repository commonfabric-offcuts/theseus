from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parent / 'fixtures'))
from item_646_runtime import Item646Runtime
from aim_next import Store, web_build
from test_stacks import StackCase


class Item646Case(StackCase):
    def position(self, message, actor='owner'):
        result = self.store.view(actor, 'stack_positions', {'topic_id': 't1', 'message_ids': [message]})
        self.assertNotIn('error', result)
        return result['items'][0]['stack_position']

    def test_partial_page_carries_actual_root_and_only_own_accessible_stars(self):
        root = self.post('Actual first message 646')
        self.participation('other-reader', True)
        private = self.post('PRIVATE 646', actor='other-reader', whisper=True, addressees=['agent-a'], reply_to=root)
        early = self.post('Starred reply', reply_to=root)
        late = self.post('Latest reply', reply_to=early)
        self.committed(self.star(private, actor='other-reader'))
        self.committed(self.star(root, actor='agent-a'))
        self.committed(self.star(early))
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction': 'before', 'limit': 1})
        self.assertEqual([x['id'] for x in page['items']], [late])
        position = page['items'][0]['stack_position']
        self.assertEqual(position['root_id'], root, 'partial page must name the true root')
        self.assertEqual(position['starred'], [early], 'other readers and private stars cannot light root')
        self.assertNotIn(root, position['starred'], 'starred reply alone is not a root star')
        self.rejected(self.star(private), 'FORBIDDEN')
        self.assertIn('error', self.store.view('owner', 'source', {'source_ref': {'kind': 'message', 'id': private}}))
        self.committed(self.star(root))
        self.assertEqual(self.position(late)['starred'], [root, early])
        self.assertEqual(self.position(late, 'agent-a')['starred'], [root], 'independent reader state')
        self.committed(self.star(root, on=False, revision=1))
        self.assertEqual(self.position(late)['starred'], [early])
        self.assertEqual(self.position(late, 'agent-a')['starred'], [root])

    def test_exact_response_operation_and_persistence_survive_retry_and_stale_unstar(self):
        root = self.post('Exact first message 646')
        reply = self.post('Loaded reply must not substitute', reply_to=root)
        request = self.envelope('message.star', {'message_id': root}, {'starred': True}, {'star_revision': 0}, '646-once')
        receipt = self.store.command('owner', request)
        result = self.committed(receipt)
        self.assertEqual((result['message_id'], result['starred'], result['star_revision'], result['changed']), (root, True, 1, True))
        reopened = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(reopened.command('owner', request), receipt, 'same operation answers actual recorded receipt')
        self.assertEqual(reopened.view('owner', 'operation', {'operation_id': '646-once'}), receipt)
        self.assertEqual(self.sql("SELECT message_id,revision FROM message_acts WHERE kind='star'"), [(root, 1)], 'one immutable act')
        self.assertFalse(self.acts(reply)['starred'], 'no reply substitution')
        self.rejected(self.star(root, on=False, revision=0), 'REVISION_CONFLICT')
        self.assertTrue(self.acts(root)['starred'], 'stale unstar reverses nothing')
        self.committed(self.star(root, on=False, revision=1, op='646-off'))
        self.assertEqual(self.sql("SELECT message_id,revision FROM message_acts WHERE kind='star' ORDER BY id"), [(root, 1), (root, 2)])
        self.assertEqual(reopened.command('owner', request), receipt, 'late response remains original receipt after unstar')
        self.assertFalse(self.acts(root)['starred'], 'retry cannot reverse later unstar')

    def test_busy_is_unrecorded_then_same_operation_commits_once(self):
        root = self.post('Contended first message')
        request = self.envelope('message.star', {'message_id': root}, {'starred': True}, {'star_revision': 0}, '646-busy')
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            blocker.execute('BEGIN IMMEDIATE')
            busy = self.store.command('owner', request)
            self.assertEqual((busy['status'], busy['recorded'], busy['error']['code']), ('retryable', False, 'DATABASE_BUSY'))
        finally:
            blocker.rollback()
            blocker.close()
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id='646-busy'"), [(0,)])
        receipt = self.store.command('owner', request)
        self.committed(receipt)
        self.assertEqual(self.store.command('owner', request), receipt)
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE kind='star'"), [(1,)])

    def test_access_removed_after_read_refuses_without_leaking_or_mutating(self):
        root = self.post('Access race 646')
        self.assertEqual(self.position(root, 'agent-b')['root_id'], root)
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.member_set', {'actor_id': 'agent-b', 'present': False}, {'workspace_id': 'w1'}, {'workspace_revision': revision}))
        self.rejected(self.star(root, actor='agent-b'), 'FORBIDDEN')
        self.assertEqual(self.rows('star'), [])
        self.assertEqual(self.store.view('agent-b', 'stars', {})['items'], [])

    def test_readonly_reached_outcome_keeps_personal_star_available_and_truthful(self):
        root = self.post('Kept to read')
        version = lambda: self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.kind_set', {'kind': 'reach'}, {'workspace_id': 'w1'}, {'workspace_revision': version()}))
        self.committed(self.command('outcome.reach', {'words': 'Done', 'unmet_confirmed': True}, {'workspace_id': 'w1'}, {'workspace_revision': version()}))
        before = self.sql("SELECT version FROM workspaces WHERE id='w1'")
        self.committed(self.star(root))
        self.assertTrue(self.acts(root)['starred'], 'personal star stays available on content kept to read')
        self.committed(self.star(root, on=False, revision=1))
        self.assertFalse(self.acts(root)['starred'])
        self.assertEqual(self.sql("SELECT version FROM workspaces WHERE id='w1'"), before)

    def test_real_source_controls_apply_and_restore_every_public_byte(self):
        root = self.path.parent / 'runtime-646'
        root.mkdir()
        build = web_build.load(Path(__file__).resolve().parents[1] / 'web')
        script_src = ' '.join(["'self'"] + ["'%s'" % digest for digest in build.script_hashes])
        server = SimpleNamespace(build=build, csp="default-src 'self';script-src " + script_src + ';style-src self;')
        runtime = Item646Runtime(server, root, 'isolated-646', 'fixture-reader')
        phases = ('approved', 'original', 'wrong-root', 'loaded-reply', 'reply-state', 'navigation', 'focus', 'optimistic', 'doubt', 'pending', 'touch-gate', 'touch-cancel', 'padding', 'background', 'target')
        for phase in phases:
            with self.subTest(phase=phase):
                try:
                    receipt = runtime.select(phase)
                    self.assertEqual(receipt['core_identity'], {'instance_id': 'isolated-646', 'actor': 'fixture-reader'})
                    if receipt['mutation']:
                        m = receipt['mutation']
                        self.assertNotEqual(m['before_sha256'], m['after_sha256'])
                        self.assertEqual(receipt['hashes'][m['file']], m['after_sha256'])
                    if phase == 'approved':
                        manifest = json.loads((Path(__file__).parent / 'fixtures' / 'item_646_approved_web.json').read_text())
                        self.assertEqual(receipt['hashes'], manifest['files'])
                finally:
                    restored = runtime.select('restored')
                    self.assertTrue(restored['restored'])
                    self.assertEqual(restored['hashes'], {n: hashlib.sha256(b).hexdigest() for n, b in build.files.items()})
                    self.assertIs(server.build, build)


if __name__ == '__main__':
    unittest.main()

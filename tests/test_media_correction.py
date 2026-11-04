from __future__ import annotations

import hashlib
import io
from pathlib import Path
import sqlite3
import unittest
from unittest import mock

from aim_next.contract import Refusal
from aim_next import media as media_module
from test_media import MediaCase
from test_media_durability import MediaDurabilityCase


class MediaCorrectionCase(MediaCase):
    publication_probe = MediaDurabilityCase.publication_probe

    def orphan(self, data, media_id='orphan', content_type='text/plain'):
        envelope = self.begin(media_id, data, content_type=content_type)
        _, events = self.publication_probe(envelope, data, interrupt='directory-sync')
        self.assertIn('interrupted:directory-sync', events)
        self.assertEqual(self.status(media_id)['state'], 'pending')
        self.assertEqual(self.store.view('owner', 'operation', {
            'operation_id': envelope['operation_id']})['status'], 'unknown')
        return envelope, self.blob_with_bytes(data)

    def test_corrupt_existing_final_refuses_retry_with_correct_new_upload(self):
        data = b'Existing publication must be checked, not merely found'
        envelope, path = self.orphan(data)
        corrupt = bytes([data[0] ^ 1]) + data[1:]
        path.write_bytes(corrupt)
        result = self.publish(envelope, io.BytesIO(data))
        self.rejected(result, 'MEDIA_UNAVAILABLE')
        self.assertFalse(result['recorded'])
        self.assertEqual(self.status('orphan')['state'], 'pending')
        self.assertEqual(path.read_bytes(), corrupt)
        self.assertEqual(list(path.parent.iterdir()), [path])

    def test_intact_orphan_retry_keeps_exact_final_inode_and_original_receipt(self):
        data = b'Intact orphan is already the published inode'
        envelope, path = self.orphan(data)
        before = path.stat()
        result = self.publish(envelope, io.BytesIO(data))
        self.committed(result)
        after = path.stat()
        self.assertEqual((before.st_dev, before.st_ino), (after.st_dev, after.st_ino))
        self.assertEqual(path.read_bytes(), data)
        self.assertEqual(list(path.parent.iterdir()), [path])
        self.assertEqual(self.publish(envelope, io.BytesIO(b'not consumed')), result)
        self.assertEqual(self.store.view('owner', 'operation', {
            'operation_id': envelope['operation_id']}), result)

    def notebook_state(self):
        return {name: self.sql('SELECT * FROM ' + name + ' ORDER BY rowid')
                for name in ('memory_items', 'memory_revisions', 'changes')}

    def test_notebook_create_and_revise_refuse_pending_and_freeze_ready_descriptor(self):
        data = b'Owned Notebook attachment'
        envelope = self.begin('notebook-media', data, actor='agent-a')
        before, public = self.notebook_state(), self.public_state()
        refused = self.memory(attachments=[{'id': 'notebook-media'}])
        self.rejected(refused, 'ATTACHMENT_NOT_READY')
        self.assertTrue(refused['recorded'])  # Correct business refusal journal.
        self.assertEqual(self.notebook_state(), before)
        self.assertEqual(self.public_state(), public)
        self.committed(self.memory())
        before, public = self.notebook_state(), self.public_state()
        refused = self.memory(revision=1, attachments=[{'id': 'notebook-media'}])
        self.rejected(refused, 'ATTACHMENT_NOT_READY')
        self.assertTrue(refused['recorded'])
        self.assertEqual(self.notebook_state(), before)
        self.assertEqual(self.public_state(), public)
        self.committed(self.publish(envelope, io.BytesIO(data), actor='agent-a'))
        expected = [{'id': 'notebook-media', 'name': 'fixture.txt',
            'content_type': 'text/plain', 'size_bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'inline': False}]
        self.committed(self.memory(revision=1, attachments=[{'id': 'notebook-media'}]))
        self.assertEqual(self.source(self.memory_ref(revision=2))['attachments'], expected)
        self.committed(self.memory(item='created-ready', attachments=[{'id': 'notebook-media'}]))
        self.assertEqual(self.source(self.memory_ref('created-ready'))['attachments'], expected)

    def test_draft_foreign_pending_and_ready_match_unknown_while_own_pending_saves(self):
        for state in ('pending', 'ready'):
            with self.subTest(state=state):
                foreign, own = 'foreign-' + state, 'own-' + state
                envelope = self.begin(foreign)
                if state == 'ready':
                    self.committed(self.publish(envelope, io.BytesIO(b'original bytes')))
                self.begin(own, actor='agent-a')
                source = {'kind': 'message', 'id': self.send('Source for ' + state)['id']}
                draft = 'draft-' + state
                args = {'source_ref': source, 'topic_id': 't1', 'generation': 'gA',
                        'body': 'Keep original writing', 'attachments': [{'id': own}]}
                self.committed(self.command('draft.save', args, target={'draft_id': draft},
                    expected={'draft_revision': 0}, actor='agent-a'))
                query = {'source_ref': source, 'topic_id': 't1'}
                before = self.store.view('agent-a', 'editor_state', query)
                errors = []
                for media_id in (foreign, 'unknown-' + state):
                    result = self.command('draft.save', dict(args, body='Must refuse',
                        attachments=[{'id': media_id}]), target={'draft_id': draft},
                        expected={'draft_revision': 1}, actor='agent-a')
                    self.rejected(result, 'FORBIDDEN')
                    errors.append(result['error'])
                    self.assertEqual(self.store.view('agent-a', 'editor_state', query), before)
                self.assertEqual(errors[0], errors[1])

    def test_publication_policy_runs_outside_real_fence_including_existing_final_retry(self):
        data = (Path(__file__).parent / 'fixtures' / 'media' / 'screen.png').read_bytes()
        retry, path = self.orphan(data, content_type='image/png')
        normal = self.begin('normal-image', data, content_type='image/png')
        original_shared = self.store._authority.shared
        original_policy = media_module._verified_inline
        original_capture = self.store._capture_media
        held, calls, captures = [0], [], []
        class ObservedFence:
            def __init__(self):
                self.fence, self.entered = original_shared(), False
            def __getattr__(self, name):
                return getattr(self.fence, name)
            def __enter__(self):
                self.fence.__enter__()
                self.entered = True
                held[0] += 1
                return self
            def close(self):
                try:
                    self.fence.close()
                finally:
                    if self.entered:
                        self.entered = False
                        held[0] -= 1
            def __exit__(self, *args):
                self.close()
        def policy(*args, **kwargs):
            calls.append(held[0])
            self.assertEqual(held[0], 0, 'Structure parser ran under authority fence')
            with sqlite3.connect(str(self.path), timeout=0, isolation_level=None) as db:
                db.execute('BEGIN IMMEDIATE')
                db.rollback()
            return original_policy(*args, **kwargs)
        def capture(root_fd, row, sync=False):
            captures.append((held[0], sync))
            return original_capture(root_fd, row, sync=sync)
        with mock.patch.object(self.store._authority, 'shared', ObservedFence), \
                mock.patch.object(media_module, '_verified_inline', policy), \
                mock.patch.object(self.store, '_capture_media', capture):
            self.committed(self.publish(normal, io.BytesIO(data)))
            self.committed(self.publish(retry, io.BytesIO(data)))
        self.assertEqual(calls, [0, 0])
        self.assertEqual(captures, [(1, True)])
        self.assertEqual(path.read_bytes(), data)

    def test_ready_image_keeps_recorded_policy_when_publication_policy_tightens(self):
        data = (Path(__file__).parent / 'fixtures' / 'media' / 'screen.png').read_bytes()
        self.ready(data=data, content_type='image/png')
        with mock.patch.object(media_module, '_verified_inline', side_effect=Refusal(
                'MEDIA_INVALID', 'Deliberately stricter publication policy', recorded=False)) as parser:
            try:
                with self.open({'media_id': 'media-one'}) as resource:
                    self.assertEqual(self.read_all(resource), data)
                    self.assertEqual(resource.descriptor['content_type'], 'image/png')
                    self.assertTrue(resource.descriptor['inline'])
            except Refusal as error:
                self.fail('Ready image re-parsed by changed policy: ' + error.code)
            parser.assert_not_called()


for _name in list(MediaCase.__dict__):
    if _name.startswith('test_') and _name not in MediaCorrectionCase.__dict__:
        setattr(MediaCorrectionCase, _name, None)
del MediaCase, MediaDurabilityCase

if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import json
import sys
import unittest
from reader_fixture import ReaderCase


class NoteUnfold800Case(ReaderCase):
    def setUp(self):
        # Registered first, checked after the inherited temporary-fixture cleanup.
        self.addCleanup(self.assert_fixture_removed)
        super().setUp()

    def assert_fixture_removed(self):
        self.assertFalse(self.path.parent.exists(), 'owned isolated Core fixture removed')
        print(json.dumps({'cleanup': 'owned Core fixture removed', 'removed': True}))

    def test_admitted_metadata_and_fold_survive_note_clear_for_each_reader(self):
        self.participation('other-reader', True)
        mid = self.send('Item 800 exact body.\nTwo  spaces.')['id']
        ref = {'kind': 'message', 'id': mid}
        def saved(body, revision):
            return self.committed(self.command('note.save', {'source_ref': ref, 'body': body},
                target={'note_id': 'item800-own-note'}, expected={'note_revision': revision}))
        def message(actor):
            result = self.store.view(actor, 'topic_messages', {'topic_id': 't1'})
            self.assertNotIn('error', result)
            return next(m for m in result['items'] if m['id'] == mid)
        saved('Only this reader.\nKeep  exact.', 0)
        readbacks = []
        for actor in ('owner', 'other-reader'):
            self.committed(self.command('message.fold', {'folded': True}, target={'message_id': mid},
                expected={'fold_revision': 0}, actor=actor))
            m = message(actor)
            self.assertEqual(m['yours']['note'], actor == 'owner')
            self.assertTrue(m['acts']['folded'])
            self.assertNotIn('Only this reader.', json.dumps(m))
            editor = self.store.view(actor, 'editor_state', {'source_ref': ref, 'topic_id': 't1'})
            self.assertEqual(editor['note']['body'] if editor['note'] else None,
                'Only this reader.\nKeep  exact.' if actor == 'owner' else None)
            readbacks.append({'actor': actor, 'message': m, 'note_body': editor['note']['body'] if editor['note'] else None})
        saved('', 1)
        self.assertFalse(message('owner')['yours']['note'])
        self.assertTrue(message('owner')['acts']['folded'])
        readbacks.append({'actor': 'owner-after-clear', 'message': message('owner')})
        runtime = self.store.view('owner', 'capabilities', {})['runtime']
        self.assertEqual(runtime['journal_mode'], 'delete')
        self.assertEqual(runtime['foreign_keys'], 1)
        print(json.dumps({'runtime': runtime, 'effective_cache': sys.pycache_prefix, 'readbacks': readbacks}, indent=2))


if __name__ == '__main__':
    unittest.main()

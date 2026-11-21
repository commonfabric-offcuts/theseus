from __future__ import annotations

"""Pre-native controls for the exact shared synthetic fixture, without HTTP."""
import json
import unittest

from reader_fixture import ReaderCase
from fixtures.source_item_757 import SourceItem757


class Reading757FixtureCase(ReaderCase):
    def setUp(self):
        super().setUp()
        def command(kind, operation, args, target, expected, sender):
            return self.command(kind, args, target, expected, actor=sender, op=operation)
        self.fixture = SourceItem757(lambda: self.store, command, 'owner', 'agent-a', 'other-reader')
        self.f = self.fixture.seed('reading757-control')

    def shown(self):
        return self.fixture.read(self.f)

    def states(self):
        return [r['state'] for r in self.shown()['covers']['root']['cover']['items']]

    def test_actual_seed_keeps_manual_fields_and_distinct_item_routes(self):
        at = self.shown()
        root = at['covers']['root']
        rows = root['cover']['items']
        self.assertEqual([r['title'] for r in rows], ['Make the reader clearer', 'Speed up the feed'])
        self.assertEqual([r['state'] for r in rows], ['Build', 'Review'])
        self.assertEqual([(r['workspace_id'], r['number']) for r in rows],
                         [(self.f['workspace'], self.f['first']), (self.f['workspace'], self.f['second'])])
        self.assertEqual(root['cover']['stands'], 'Cabin is booked')
        self.assertEqual(root['cover']['payload']['message_id'], self.f['answer'])
        self.assertEqual(root['cover']['payload']['text'], 'Cabin decision')
        self.assertEqual(root['cover']['waiting'], [{'text': 'Choose the cabin', 'default': 'Keep the current booking'}])
        self.assertEqual(root['cover']['by'], 'agent-a')
        self.assertEqual(root['cover_revision'], 1)
        self.assertEqual([r['sources'] for r in rows], [[self.f['root']], [self.f['root']]])
        self.assertEqual([r['sources'] for r in at['covers']['lone']['cover']['items']], [[self.f['lone']], [self.f['lone']]])
        self.assertIsNone(at['covers']['unrelated']['cover'])
        self.assertNotEqual(at['items'][0]['piece']['topic']['id'], self.f['root'], 'work topic never becomes a dossier ID')

    def test_actual_lifecycle_and_release_distinguish_stage_named_live(self):
        before = self.shown()['covers']['root']
        for action, expected in [('review-round', ['Review, round 2', 'Review']),
                                 ('wait', ['Wait', 'Review']),
                                 ('done', ['Wait', 'Done']),
                                 ('combine', ['Check candidate', 'Done']),
                                 ('stage-named-live', ['Live', 'Done']),
                                 ('record-live', ['Live · release 757', 'Done'])]:
            self.fixture.transition(self.f, action)
            self.assertEqual(self.states(), expected, action)
            after = self.shown()['covers']['root']
            self.assertEqual(after['cover_revision'], before['cover_revision'])
            for key in ('stands', 'payload', 'waiting', 'by', 'at_ms'):
                self.assertEqual(after['cover'][key], before['cover'][key], key)
            if action == 'stage-named-live':
                self.assertEqual(self.shown()['release_records'], [], 'a stage named Live is no deployment record')
            if action == 'combine':
                self.assertEqual(after['cover']['items'][0]['piece_id'], self.f['release_piece'])

    def test_actual_join_split_multisource_and_destination_private_redaction(self):
        self.fixture.transition(self.f, 'join-private')
        at = self.shown()
        root = at['covers']['root']
        self.assertEqual(at['covers']['joined']['root_id'], self.f['root'])
        self.assertEqual(at['covers']['joined']['cover'], root['cover'])
        self.assertNotIn('Secret destination title 757', json.dumps(at))
        self.assertNotIn(self.f['private_workspace'], json.dumps(at), 'source reader receives no private destination identity')
        self.assertEqual([r['number'] for r in root['cover']['items']], [self.f['first'], self.f['second'], self.f['third']])
        self.assertEqual(root['cover']['items'][0]['sources'], [self.f['root'], self.f['joined']])
        owner = self.fixture.view('dossier_cover', {'message_id': self.f['root']}, 'other-reader')
        self.assertIn('Secret destination title 757', json.dumps(owner), 'actual private owner sees the item')
        self.assertIsNone(at['covers']['unrelated']['cover'])
        before = root
        for action in ('grant-private', 'revoke-private'):
            self.fixture.transition(self.f, action)
            changed = self.shown()['covers']['root']
            self.assertEqual('Secret destination title 757' in json.dumps(changed), action == 'grant-private')
            self.assertEqual(changed['cover_revision'], before['cover_revision'])
            for key in ('stands', 'payload', 'waiting', 'by', 'at_ms'):
                self.assertEqual(changed['cover'][key], before['cover'][key])
        self.fixture.transition(self.f, 'split')
        at = self.shown()
        self.assertEqual(at['covers']['joined']['root_id'], self.f['joined'])
        self.assertEqual([r['number'] for r in at['covers']['root']['cover']['items']], [self.f['first'], self.f['second']])
        self.assertEqual([r['number'] for r in at['covers']['joined']['cover']['items']], [self.f['first'], self.f['third']])
        self.assertIsNone(at['covers']['joined']['cover']['by'], 'generated-only cover invents no writer')

    def test_shared_fixture_transition_emits_source_refresh_without_cover_act(self):
        scope = {'kind': 'actor', 'id': 'owner'}
        checkpoint = self.store.view('owner', 'changes', {'scope': scope})['checkpoint']
        acts = self.sql('SELECT * FROM message_acts')
        self.fixture.transition(self.f, 'review-round')
        changes = self.store.view('owner', 'changes', {'scope': scope, 'cursor': checkpoint})
        self.assertIn(self.f['topic'], [i['resource_id'] for i in changes['items'] if i['resource_kind'] == 'source_cover'],
                      'actual stage change invalidates its loaded source cover')
        self.assertEqual(self.sql('SELECT * FROM message_acts'), acts, 'derived refresh invents no cover act')


if __name__ == '__main__':
    unittest.main()

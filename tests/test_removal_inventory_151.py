from __future__ import annotations

import json
from unittest import mock

from aim_next.validation import VIEWS
import reader_fixture as fixtures
import test_message_exposure as exposure_fixture
import test_message_removal_151 as removal_fixture


# Explicit producer inventory, not a guessed call graph. All ordinary views
# cross _hand_over; these owners can return message words or attached media.
CONTENT_VIEWS = {'attention', 'check_readings', 'conversation', 'deliveries', 'delivery', 'media',
    'outcome_checks', 'pipeline', 'pipeline_item', 'source', 'stars',
    'topic_images', 'topic_messages'}
REFERENCE_OR_PRIVATE_VIEWS = {'assessment', 'assessments', 'dossier_cover', 'dossier_move_targets', 'dossier_moves',
    'editor_state', 'memory_current', 'memory_items', 'memory_stars', 'memory_status', 'message_acts',
    'opening', 'openings', 'workspace_links', 'source_topics', 'stack_namer', 'stack_positions', 'submission', 'submissions', 'topic_membership'}
METADATA_VIEWS = {'actors', 'changes', 'colors', 'health', 'health_light', 'marks', 'onboarding_prompt',
    'opening', 'openings', 'source_topics', 'stack_namer', 'stack_positions', 'submission', 'submissions', 'topic_membership'}
METADATA_VIEWS = {'actors', 'changes', 'colors', 'current_rule', 'work_context', 'health', 'health_light', 'hosted_seat_templates', 'marks', 'onboarding_prompt',
    'outcome_live', 'pipeline_row', 'reactions', 'releases', 'tool', 'tools', 'topic_tools', 'topic_unread',
    'wakes', 'workspace_counts', 'workspace', 'workspace_members', 'workspace_topics', 'workspaces', 'topic', 'outcome_light'}


class BoundaryCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    source_view = removal_fixture.RemovalCase.source_view

    def test_identity_only_views_do_not_fabricate_first_exposure(self):
        message = self.post()
        routes = [('current_rule', {'workspace_id': 'w1'}), ('work_context', {'workspace_id': 'w1'}),
            ('topic', {'topic_id': 't1'}), ('topic_unread', {'topic_id': 't1'}),
            ('marks', {'topic_id': 't1'}), ('workspace_topics', {'workspace_id': 'w1'}),
            ('workspace', {'workspace_id': 'w1'}), ('workspace_counts', {'workspace_ids': ['w1']}), ('workspace_members', {'workspace_id': 'w1'}),
            ('actors', {}), ('reactions', {'message_id': message}),
            ('source_topics', {'message_id': message}),
            ('stack_positions', {'topic_id': 't1', 'message_ids': [message]}), ('message_acts', {'topic_id': 't1'}),
            ('dossier_cover', {'message_id': message}), ('stack_namer', {'message_id': message})]
        for name, args in routes:
            with self.subTest(view=name):
                answer = self.store.view('agent-a', name, args)
                self.assertNotIn('error', answer, answer)
                self.assertNotIn('Removal fixture exact words', json.dumps(answer))
                self.assertEqual(self.sql('SELECT * FROM message_first_exposures WHERE message_id=?', (message,)), [])

    def test_complete_registry_has_one_projection_dispatch_and_two_reviewed_special_cases(self):
        groups = [CONTENT_VIEWS, REFERENCE_OR_PRIVATE_VIEWS, METADATA_VIEWS, {'capabilities', 'operation'}]
        self.assertEqual(set(VIEWS), set.union(*groups))
        self.assertEqual(sum(map(len, groups)), len(VIEWS))
        owners = []
        def crossed(db, fence, actor, kind, args, handler, between, marks):
            owners.append(handler.__name__)
            return {'crossed': handler.__name__}
        with mock.patch.object(self.store, '_hand_over', side_effect=crossed):
            for name in sorted(set(VIEWS) - {'capabilities', 'operation'}):
                self.assertEqual(self.store.view('owner', name, {}), {'crossed': '_view_' + name}, name)
        self.assertEqual(len(owners), len(VIEWS) - 2)
        self.assertNotIn('body', self.store.view('owner', 'capabilities', {}))
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': 'no-such-operation'})['status'], 'unknown')

    def test_projection_boundary_refuses_unsent_content_even_if_a_producer_omits_access_check(self):
        message = self.post()
        self.committed(self.remove(message))
        leaked = {'id': message, 'author_id': 'owner', 'body': 'Removal fixture exact words'}
        with mock.patch.object(self.store, '_view_workspace', return_value=leaked):
            answer = self.store.view('agent-a', 'workspace', {'workspace_id': 'w1'})
        self.assertEqual(answer.get('error', {}).get('code'), 'FORBIDDEN')
        self.assertNotIn('Removal fixture exact words', json.dumps(answer))

    def test_unsent_join_root_does_not_leak_through_another_messages_titlebar(self):
        root = self.post(body='The removed root words')
        child = self.post(body='The surviving joined message')
        self.committed(self.command('stack.join', {'into': root}, target={'message_id': child}, expected={'join_revision': 0}))
        self.committed(self.remove(root))
        shown = self.source_view(child)
        self.assertNotIn('error', shown, shown)
        self.assertEqual(shown['dossier']['root_id'], child)
        self.assertIsNone(shown['acts']['joined'])
        self.assertNotIn('The removed root words', json.dumps(shown))

    def test_a_late_unread_mark_on_unsent_identity_is_refused(self):
        message = self.post()
        self.committed(self.remove(message))
        self.rejected(self.command('message.mark', {'marked': True}, target={'message_id': message},
            expected={'mark_revision': 0}, actor='agent-a'), 'FORBIDDEN')


class OutcomeInventoryCase(exposure_fixture.HeldOutcomeCase):
    # Run only the seven inherited named positive producer tests, plus the two
    # named cases below, never this fixture's broad inherited test collection.
    def hands(self, name):
        reader, read, which = self.producers()[name]
        self.world()
        message = getattr(self, which)
        self.assertEqual(self.sql('SELECT * FROM message_first_exposures WHERE message_id=?', (message,)), [])
        self.assertNotEqual(read()[0], '')
        self.assertEqual(self.sql('SELECT by FROM message_first_exposures WHERE message_id=?', (message,)), [(reader,)])
        author = 'other-reader' if which == 'mk' else 'owner'
        refused = self.command('message.unsend', target={'message_id': message}, actor=author)
        self.rejected(refused, 'MESSAGE_SEEN'); self.assertFalse(refused['recorded'])

    def test_pipeline_item_words_cross_the_same_first_exposure_boundary(self):
        self.world()
        answer = self.view('agent-b', 'pipeline_item', {'workspace_id': 'w1', 'number': 2})
        self.assertIn('Hold the piece until the schema lands', json.dumps(answer))
        self.assertEqual(self.sql('SELECT by FROM message_first_exposures WHERE message_id=?', (self.mc,)), [('agent-b',)])
        self.assertEqual(self.sql('SELECT by FROM message_first_exposures WHERE message_id=?', (self.mi,)), [])

    def test_light_counts_keep_message_identity_without_handing_its_words(self):
        self.world()
        for name, args in [('outcome_light', {'workspace_id': 'w1'}), ('workspaces', {}), ('pipeline_row', {'workspace_id': 'w1'})]:
            with self.subTest(view=name):
                answer = self.view('agent-a', name, args)
                self.assertNotIn('Hold the piece until the schema lands', json.dumps(answer))
                self.assertEqual(self.sql('SELECT * FROM message_first_exposures'), [])

    def test_unsent_item_source_and_gathering_leave_no_placeholder_or_count(self):
        self.world()
        message = removal_fixture.RemovalCase.post(self)
        self.sql("INSERT INTO pipeline_item_sources VALUES ('w1',2,2,?,NULL,NULL,'owner',1)", (message,))
        self.sql('UPDATE pipeline_items SET gathering=? WHERE workspace_id=\'w1\' AND number=2', (json.dumps({'message_id': message}),))
        self.committed(self.command('message.unsend', target={'message_id': message}))
        item = self.view('owner', 'pipeline_item', {'workspace_id': 'w1', 'number': 2})['item']
        self.assertIsNone(item['gathering'])
        self.assertEqual(item['sources']['count'], 1)
        self.assertEqual(item['sources']['messages'], 0)
        self.assertEqual(item['sources']['shown'], [{'kind': 'note', 'text': 'a test'}])

    def test_retracted_block_cannot_hold_work_when_another_question_keeps_the_topic_waiting(self):
        self.world()
        message = self.asked('A topic block', to=('agent-a',), actor='owner', topic='t1', blocks={'kind': 'piece', 'ref': self.piece})
        self.asked('Another question', to=('agent-a',), actor='owner', topic='t1')
        self.committed(self.command('message.retract', target={'message_id': message}))
        answer = self.view('agent-a', 'pipeline', {'workspace_id': 'w1'})
        self.assertNotIn('A topic block', json.dumps(answer))


class AccountInventoryCase(exposure_fixture.HeldAccountCase):
    def test_account_is_first_exposure_and_unsent_account_is_absent(self):
        message = self.world()
        self.committed(self.command('message.unsend', target={'message_id': message}))
        self.assertIsNone(self.account('agent-b'))

    def test_account_fetch_records_its_exact_identity(self):
        message = self.world()
        self.assertEqual(self.account('agent-b')['message_id'], message)
        self.assertEqual(self.sql('SELECT by FROM message_first_exposures WHERE message_id=?', (message,)), [('agent-b',)])

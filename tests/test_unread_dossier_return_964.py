from __future__ import annotations

"""Item964: counted unread and the visible dossier come from the same commit."""

from unittest import mock

from aim_next import dossier_order
from aim_next.contract import StoreError
from aim_next.store import Store
import test_agent_edit as edit_fixture
import test_stack_aside as aside_fixture
from test_wake_contract import own_cases


@own_cases
class UnreadDossierReturn964Case(edit_fixture.AgentEditCase):
    position = aside_fixture.AsideCase.position
    aside = aside_fixture.AsideCase.aside
    latest = aside_fixture.AsideCase.latest

    def sleeping(self, read=True):
        message = self.posted('Old dossier words')
        newer = self.posted('Another visible dossier')
        if read:
            self.read_through('owner', newer)
        self.committed(self.aside(message, self.latest()))
        self.assertTrue(self.position(message)['below'])
        return message, newer

    def records(self):
        return [self.sql('SELECT * FROM ' + table) for table in
                ('message_revisions', 'message_acts', 'dossier_order', 'deliveries', 'delivery_groups',
                 'message_exposures', 'recipient_schedule', 'changes', 'operations')]

    def test_an_edit_reopens_the_badge_and_returns_its_dossier_last_above_more_durably(self):
        message, newer = self.sleeping()
        before = self.sql('SELECT count(*) FROM messages')
        self.assertEqual(self.unread('owner'), 0)
        result = self.committed(self.edit(message, 'Corrected dossier words', actor='agent-a'))
        self.assertEqual(result['unread_again'], 1)
        self.assertEqual(self.unread('owner'), 1)
        position = self.position(message)
        self.assertFalse(position['below'], 'the positive badge must have a dossier above More')
        self.assertLess(position['order_key'], self.position(newer)['order_key'])
        self.assertEqual((position['through'], position['aside_revision']), (None, 2))
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), before)
        self.read_through('owner', message)
        self.assertEqual(self.unread('owner'), 0)
        self.assertEqual(self.position(message), position, 'reading clears the badge, never reverses admission')
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.position(message), position, 'the next device reads the same Core admission')

    def test_existing_unread_and_human_edits_leave_the_saved_choice_below_more(self):
        message, _ = self.sleeping(read=False)
        before = self.position(message)
        self.assertEqual(self.committed(self.edit(message, 'Already pending new words', actor='agent-a'))['unread_again'], 0)
        self.assertEqual(self.position(message), before)
        own = self.post('My own words', actor='owner')
        self.committed(self.aside(own, self.latest()))
        before = self.position(own)
        self.assertEqual(self.committed(self.edit(own, 'My own correction', actor='owner'))['unread_again'], 0)
        self.assertEqual(self.position(own), before)

    def test_only_the_person_with_a_new_counted_unread_returns(self):
        message, _ = self.sleeping()
        self.committed(self.aside(message, self.latest(), actor='other-reader'))
        self.committed(self.aside(message, self.latest(), actor='agent-b'))
        before = {actor: self.position(message, actor) for actor in ('other-reader', 'agent-b')}
        result = self.committed(self.edit(message, 'Owner alone has read the old words', actor='agent-a'))
        self.assertEqual(result['unread_again'], 1)
        self.assertFalse(self.position(message)['below'])
        for actor in before:
            self.assertEqual(self.position(message, actor), before[actor], actor)

    def test_between_others_and_inactive_deliveries_do_not_return_the_dossier(self):
        for mode in ('between', 'inactive'):
            with self.subTest(mode=mode):
                args = {'addressees': ['agent-b'], 'intent': 'tell'} if mode == 'between' else {}
                message = self.posted('Not counted for owner ' + mode, **args)
                self.read_through('owner', message)
                self.committed(self.aside(message, self.latest()))
                before = self.position(message)
                if mode == 'inactive':
                    self.participation('owner', False)
                self.committed(self.edit(message, 'Still not counted for owner ' + mode, actor='agent-a'))
                self.assertEqual(self.position(message), before)
                self.assertFalse(self.item(message)['unread'])

    def test_retry_repeated_edits_and_a_fresh_set_aside_use_the_existing_revision_fence(self):
        message, _ = self.sleeping()
        receipt = self.edit(message, 'First corrected arrival', actor='agent-a', op='964-edit-once')
        self.committed(receipt)
        position = self.position(message)
        self.assertFalse(position['below'])
        records = self.records()
        self.assertEqual(self.edit(message, 'First corrected arrival', actor='agent-a', op='964-edit-once'), receipt)
        self.assertEqual(self.records(), records)
        self.committed(self.edit(message, 'More words while still unread', revision=2, actor='agent-a'))
        self.assertEqual(self.position(message), position, 'no second admission for an already pending delivery')
        stale = self.aside(message, None, revision=1)
        self.rejected(stale, 'REVISION_CONFLICT')
        self.assertEqual(self.position(message), position)
        self.read_through('owner', message)
        self.committed(self.aside(message, self.latest(), revision=2))
        self.assertTrue(self.position(message)['below'])
        self.committed(self.edit(message, 'Next read then unread transition', revision=3, actor='agent-a'))
        self.assertEqual((self.position(message)['below'], self.position(message)['aside_revision']), (False, 4))

    def test_manual_rank_and_an_already_visible_dossier_do_not_churn(self):
        message = self.posted('Visible before editing')
        other = self.posted('Another existing dossier')
        self.read_through('owner', other)
        self.committed(self.command('stack.place', {'key': 9000}, target={'message_id': message}, expected={'place_revision': 0}))
        position = self.position(message)
        self.committed(self.edit(message, 'Unread while already visible', actor='agent-a'))
        self.assertEqual(self.position(message), position)
        self.read_through('owner', message)
        self.committed(self.aside(message, self.latest()))
        self.committed(self.edit(message, 'Unread after a later set-aside', revision=2, actor='agent-a'))
        self.assertFalse(self.position(message)['below'])
        self.assertEqual((self.position(message)['placed'], self.position(message)['place_revision']), (9000, 1))
        self.assertLess(self.position(message)['order_key'], self.position(other)['order_key'], 'return enters last despite the old high manual rank')

    def test_a_private_edit_changes_no_outside_readers_position(self):
        message, newer = self.sleeping()
        question = self.post('Private question', actor='owner', addressees=['agent-a'], whisper=True, reply_to=message)
        self.saw('agent-a', question)
        private = self.posted('Private words', addressees=['owner'], whisper=True, reply_to=question,
                              reply_without_quote='Scratch private edited-unread proof')
        corrected = self.item(private)['body'].replace('Private words', 'Private corrected words')
        self.read_through('owner', private)
        self.committed(self.aside(message, self.latest(), revision=1))
        visible_through = self.sql('SELECT seq FROM messages WHERE id=?', (newer,))[0][0]
        self.committed(self.aside(message, visible_through, actor='other-reader'))
        outside = self.position(message, 'other-reader')
        self.committed(self.edit(private, corrected, actor='agent-a'))
        self.assertFalse(self.position(private)['below'])
        self.assertEqual(self.position(message, 'other-reader'), outside)

    def test_an_edited_member_returns_the_current_joined_dossier_only(self):
        message, newer = self.sleeping()
        self.committed(self.command('stack.join', {'into': newer}, target={'message_id': message}, expected={'join_revision': 0}))
        self.committed(self.aside(newer, self.latest()))
        self.assertTrue(self.position(message)['below'])
        old_source_choice = self.sql("SELECT value,revision FROM message_acts WHERE message_id=? AND owner='owner' AND kind='aside' ORDER BY revision", (message,))
        self.committed(self.edit(message, 'A joined member becomes unread', actor='agent-a'))
        position = self.position(message)
        self.assertEqual(position['root_id'], newer)
        self.assertFalse(position['below'])
        self.assertEqual(position['aside_revision'], 2)
        self.assertEqual(self.sql("SELECT value,revision FROM message_acts WHERE message_id=? AND owner='owner' AND kind='aside' ORDER BY revision", (message,)), old_source_choice)

    def test_return_failure_rolls_back_the_edit_counts_acts_and_order_then_exact_retry_succeeds(self):
        message, _ = self.sleeping()
        before = self.records()
        with mock.patch.object(dossier_order, 'returning', side_effect=StoreError('Synthetic admission failure')):
            with self.assertRaisesRegex(StoreError, 'Synthetic admission failure'):
                self.edit(message, 'Atomic corrected arrival', actor='agent-a', op='964-atomic-once')
        self.assertEqual(self.records(), before)
        self.assertEqual(self.unread('owner'), 0)
        self.assertTrue(self.position(message)['below'])
        self.committed(self.edit(message, 'Atomic corrected arrival', actor='agent-a', op='964-atomic-once'))
        self.assertEqual(self.unread('owner'), 1)
        self.assertFalse(self.position(message)['below'])

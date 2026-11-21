from __future__ import annotations

import unittest
from unittest.mock import patch

from test_stacks import StackCase


class AgentAnswerFold955Case(StackCase):
    """Real Core transactions in ReaderCase's owned temporary instance."""

    def setUp(self):
        super().setUp()
        self.participation('other-reader', True)

    def reply(self, parent, actor='agent-a', op=None):
        return self.command('message.post', {
            'body': 'The answer is ready.', 'reply_to': parent,
            **({'reply_without_quote': 'The isolated955 check answers the whole request.'} if actor.startswith('agent-') else {}),
        }, target={'topic_id': 't1'}, actor=actor, op=op)

    def folded(self, message, actor='owner'):
        acts = self.acts(message, actor=actor)
        return acts['folded'], acts['fold_revision']

    def test_agent_answer_folds_only_its_human_author_and_routes_the_personal_change(self):
        parent = self.post('My question.', actor='owner')
        before = self.sql('SELECT COALESCE(MAX(seq),0) FROM changes')[0][0]
        answer = self.committed(self.reply(parent))['message_id']
        self.assertEqual(self.folded(parent), (True, 1))
        for reader in ('agent-a', 'other-reader'):
            self.assertEqual(self.folded(parent, reader), (False, 0))
        self.assertEqual(self.folded(answer), (False, 0), 'the answer stays open')
        self.assertEqual(self.told(after=before), [('actor', 'owner')])
        self.assertEqual(self.sql("SELECT owner,actor_id,revision FROM message_acts WHERE kind='fold' AND message_id=?", (parent,)),
                         [('owner', 'agent-a', 1)], 'the real agent remains the actor of this reply effect')

    def test_no_reply_other_person_and_agent_thumb_do_not_fold_the_author(self):
        parent = self.post('Still reading.', actor='owner')
        self.assertEqual(self.folded(parent), (False, 0))
        self.committed(self.reply(parent, actor='other-reader'))
        self.assertEqual(self.folded(parent), (False, 0))
        self.assertEqual(self.folded(parent, 'other-reader'), (True, 1), 'existing377 replier behavior stays')
        self.committed(self.command('message.thumb', {'thumbed': True}, target={'message_id': parent},
                                    expected={'thumb_revision': 0}, actor='agent-a'))
        self.assertEqual(self.folded(parent), (False, 0))

    def test_star_and_private_note_protect_the_author_without_exposing_note_words(self):
        starred = self.post('Keep my star.', actor='owner')
        noted = self.post('Keep my note.', actor='owner')
        self.committed(self.star(starred))
        self.committed(self.command('note.save', {'source_ref': {'kind': 'message', 'id': noted}, 'body': 'Private955 words.'},
                                    target={'note_id': '955-note'}, expected={'note_revision': 0}))
        for parent in (starred, noted):
            receipt = self.reply(parent)
            self.committed(receipt)
            self.assertEqual(self.folded(parent), (False, 0))
            self.assertNotIn('Private955 words.', str(receipt))
        self.assertTrue(self.acts(starred)['starred'])

    def test_manual_unfold_stays_open_when_another_agent_answer_arrives(self):
        parent = self.post('Read this again.', actor='owner')
        self.committed(self.reply(parent))
        self.assertEqual(self.folded(parent), (True, 1))
        self.committed(self.fold(parent, on=False, revision=1))
        self.committed(self.reply(parent))
        self.assertEqual(self.folded(parent), (False, 2))

    def test_retry_keeps_the_same_answer_and_exactly_one_fold(self):
        parent = self.post('One answer.', actor='owner')
        first = self.reply(parent, op='955-once')
        self.committed(first)
        self.assertEqual(self.folded(parent), (True, 1))
        self.assertEqual(self.reply(parent, op='955-once'), first)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM message_acts WHERE kind='fold' AND message_id=?", (parent,)), [(1,)])

    def test_an_agents_message_and_an_unreadable_author_get_no_personal_fold(self):
        agent_parent = self.post('An agent message.', actor='agent-a', divergence_reason='Separate955 actor-kind control.')
        self.committed(self.reply(agent_parent))
        self.assertEqual(self.folded(agent_parent, 'agent-a'), (False, 0))
        parent = self.post('A person who later leaves.', actor='other-reader')
        self.participation('other-reader', False)
        self.committed(self.reply(parent))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM message_acts WHERE kind='fold' AND message_id=?", (parent,)), [(0,)])

    def test_private_reply_and_conversation_do_not_broaden_the_dossier_rule(self):
        private = self.post('Between us.', actor='owner', whisper=True, addressees=['agent-a'])
        self.committed(self.command('message.post', {'body': 'A private answer.', 'reply_to': private, 'whisper': True,
                                                   'addressees': ['owner'], 'reply_without_quote': 'Private955 control.'},
                                    target={'topic_id': 't1'}, actor='agent-a'))
        self.assertEqual(self.folded(private), (False, 0))
        workspace = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']
        self.committed(self.command('workspace.coordinator_set', {'actor_id': 'agent-a'}, target={'workspace_id': 'w1'},
                                    expected={'workspace_revision': workspace['version']}))
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        parent = self.post('An item for the coordinator.', actor='owner', topic=topic)
        self.committed(self.command('message.post', {'body': 'Answered.', 'reply_to': parent, 'reply_without_quote': 'Conversation955 control.'},
                                    target={'topic_id': topic}, actor='agent-a'))
        self.assertEqual(self.acts(parent, topic=topic)['folded'], False)

    def test_failed_fold_rolls_back_the_reply_and_retry_can_publish_both(self):
        parent = self.post('All or neither.', actor='owner')
        record = self.store._record_act
        def interrupted(*args, **kwargs):
            result = record(*args, **kwargs)
            if args[1] == 'fold':
                raise RuntimeError('955 interrupted after recording fold')
            return result
        with patch.object(self.store, '_record_act', interrupted):
            with self.assertRaisesRegex(RuntimeError, '955 interrupted'):
                self.reply(parent, op='955-rollback')
        self.assertEqual(self.folded(parent), (False, 0))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM messages WHERE operation_id='955-rollback'"), [(0,)])
        self.committed(self.reply(parent, op='955-rollback'))
        self.assertEqual(self.folded(parent), (True, 1))


if __name__ == '__main__':
    unittest.main()

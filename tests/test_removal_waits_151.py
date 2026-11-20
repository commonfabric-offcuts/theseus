from __future__ import annotations

import reader_fixture as fixtures
from test_message_removal_151 import RemovalCase
from test_question_withdrawal import WithdrawalCase
from test_message_edit import EditCase


class WaitCase(fixtures.ReaderCase):
    post = RemovalCase.post
    remove = RemovalCase.remove
    ask = WithdrawalCase.ask
    waits = WithdrawalCase.waits
    member = EditCase.member

    def test_removed_human_conversation_reply_restores_wait_without_fabricating_a_take(self):
        self.member('other-reader', True)
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        ask = self.ask(actor='owner', asked=['other-reader'], topic=topic)
        answer = self.committed(self.command('message.post', {'body': 'An answer', 'reply_to': ask, 'addressees': ['owner'], 'intent': 'tell'}, target={'topic_id': topic}, actor='other-reader'))['message_id']
        history = self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (ask,))
        self.assertEqual(history, [], 'only an agent answerer records a conversation take')
        self.committed(self.remove(answer, actor='other-reader'))
        self.assertEqual(self.sql('SELECT settled FROM conversation_items WHERE message_id=?', (ask,)), [(0,)])
        self.assertEqual(self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (ask,)), history)
        self.assertEqual(self.sql('SELECT actor_id FROM conversation_waits WHERE ask_id=?', (ask,)), [('other-reader',)])
        item = next(item for item in self.store.view('owner', 'topic_messages', {'topic_id': topic})['items'] if item['id'] == ask)
        self.assertEqual(item['item']['takes'], [])
        self.assertEqual(item['item']['state'], 'new')

    def test_reply_after_retraction_creates_no_answer_take_or_question_wait(self):
        self.member('other-reader', True)
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        ask = self.ask(actor='owner', asked=['agent-a'], topic=topic)
        self.committed(self.remove(ask, 'retract'))
        self.committed(self.command('message.post', {'body': 'A later comment', 'reply_to': ask, 'reply_without_quote': 'The question has been retracted', 'addressees': ['owner'], 'intent': 'tell'}, target={'topic_id': topic}, actor='agent-a'))
        self.assertEqual(self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (ask,)), [])
        self.assertEqual(self.sql('SELECT * FROM conversation_waits WHERE ask_id=?', (ask,)), [])

    def links(self):
        return self.sql('SELECT ask_id,active FROM ask_cover_links ORDER BY ask_seq')

    def test_unsent_private_answer_restores_only_its_addressed_question(self):
        first = self.ask(asked=['owner'])
        second = self.ask(asked=['owner'])
        answer = self.post(body='A private answer', reply_to=first, whisper=True, intent=None, addressees=['agent-a'])
        self.assertEqual(self.links(), [(first, 0), (second, 1)])
        self.committed(self.remove(answer))
        self.assertEqual(self.links(), [(first, 1), (second, 1)])
        self.assertEqual(self.waits(), [('t1', 0, first)])

    def test_preexisting_thumb_is_no_longer_an_answer_after_question_retraction(self):
        self.participation('other-reader', True)
        question = self.ask(actor='owner', asked=['other-reader'])
        self.committed(self.command('message.thumb', {'thumbed': True}, target={'message_id': question}, expected={'thumb_revision': 0}, actor='other-reader'))
        self.committed(self.remove(question, 'retract'))
        thumbs = self.store.view('other-reader', 'reactions', {'message_id': question})['reactions']['thumbs']
        self.assertEqual(len(thumbs), 1)
        self.assertFalse(thumbs[0].get('answered', False))

    def test_unsent_answer_restores_exact_link_and_preserves_second_and_explicit_wait(self):
        root = self.opening['id']
        explicit = {'text': 'Unrelated decision', 'default': 'Keep waiting'}
        revision = self.store.view('owner', 'dossier_cover', {'message_id': root})['cover_revision']
        self.committed(self.command('stack.cover', {'waiting': [explicit]}, target={'message_id': root}, expected={'cover_revision': revision}, actor='agent-a'))
        first = self.ask(asked=['owner'], reply_to=root)
        second = self.ask(asked=['owner'], reply_to=root)
        answer = self.post(reply_to=first)
        self.assertEqual(self.links(), [(first, 0), (second, 1)])
        self.committed(self.remove(answer))
        self.assertEqual(self.links(), [(first, 1), (second, 1)])
        cover = self.store.view('owner', 'dossier_cover', {'message_id': root})['cover']['waiting']
        self.assertEqual(cover[0], explicit)
        self.assertEqual({entry.get('ask_id') for entry in cover[1:]}, {first, second})
        self.assertEqual(self.waits(), [('t1', 0, first)])

    def test_retracted_answer_restores_wait_but_later_answer_or_withdrawal_prevents_revival(self):
        for mode in ('none', 'later-answer', 'withdrawn'):
            with self.subTest(mode=mode):
                ask = self.ask(asked=['owner'])
                answer = self.post(reply_to=ask)
                if mode == 'later-answer':
                    self.post(reply_to=ask, body='A later valid answer')
                elif mode == 'withdrawn':
                    self.committed(self.command('message.withdraw', target={'message_id': ask}, actor='agent-a'))
                self.committed(self.remove(answer, 'retract'))
                self.assertEqual(self.sql('SELECT active FROM ask_cover_links WHERE ask_id=?', (ask,)), [(int(mode == 'none'),)])

    def test_retracted_human_ask_cannot_return_through_thumb_off_or_decision(self):
        self.participation('other-reader', True)
        first = self.post(body='May I proceed?', intent='ask', addressees=['other-reader'], go_ahead=True)
        second = self.ask(actor='owner', asked=['other-reader'])
        self.committed(self.remove(first, 'retract'))
        self.assertEqual(self.waits('other-reader'), [('t1', 0, second)])
        before = self.sql('SELECT count(*) FROM messages')
        refused = self.command('message.answer', {'answer': 'yes'}, target={'message_id': first}, expected={'answer_revision': 0}, actor='other-reader')
        self.rejected(refused, 'QUESTION_WITHDRAWN')
        self.assertFalse(refused['recorded'])
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), before)
        for revision, on in enumerate((True, False)):
            self.committed(self.command('message.thumb', {'thumbed': on}, target={'message_id': first}, expected={'thumb_revision': revision}, actor='other-reader'))
        self.assertEqual(self.waits('other-reader'), [('t1', 0, second)])

    def test_unsent_human_ask_removes_only_its_wait(self):
        first = self.ask(actor='owner', asked=['agent-a'])
        second = self.ask(actor='owner', asked=['agent-a'])
        before = self.sql('SELECT * FROM messages')
        self.committed(self.remove(first))
        self.assertEqual(self.waits('agent-a'), [('t1', 0, second)])
        self.assertEqual(self.sql('SELECT * FROM messages'), before)

    def test_removing_decision_reply_clears_only_its_current_answer_and_restores_wait(self):
        self.participation('other-reader', True)
        ask = self.post(intent='ask', addressees=['other-reader'], go_ahead=True)
        first = self.committed(self.command('message.answer', {'answer': 'yes'}, target={'message_id': ask},
            expected={'answer_revision': 0}, actor='other-reader'))
        self.committed(self.remove(first['reply_id'], 'retract', actor='other-reader'))
        reactions = self.store.view('other-reader', 'reactions', {'message_id': ask})['reactions']
        self.assertEqual(reactions['answers'], [])
        self.assertEqual(reactions['answer_revision'], 2, 'removal advances the answer fence, never reuses it')
        self.assertEqual(self.waits('other-reader'), [('t1', 0, ask)])
        second = self.committed(self.command('message.answer', {'answer': 'no'}, target={'message_id': ask},
            expected={'answer_revision': 2}, actor='other-reader'))
        third = self.committed(self.command('message.answer', {'answer': 'yes'}, target={'message_id': ask},
            expected={'answer_revision': 3}, actor='other-reader'))
        self.committed(self.remove(second['reply_id'], 'retract', actor='other-reader'))
        reactions = self.store.view('other-reader', 'reactions', {'message_id': ask})['reactions']
        self.assertEqual([(r['actor_id'], r['answer']) for r in reactions['answers']], [('other-reader', 'yes')])
        self.assertEqual(reactions['answer_revision'], third['answer_revision'])
        self.assertEqual(self.waits('other-reader'), [])

    def test_conversation_answer_removal_restores_only_its_ask_and_terminal_question_stays_gone(self):
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        ask = self.ask(topic=topic, asked=['owner'])
        second = self.ask(topic=topic, asked=['owner'])
        answer = self.committed(self.command('message.post', {'body': 'The answer', 'reply_to': ask,
            'addressees': ['agent-a'], 'intent': 'tell'}, target={'topic_id': topic}))['message_id']
        self.assertEqual(self.sql('SELECT ask_id FROM conversation_waits WHERE actor_id=? ORDER BY ask_id', ('owner',)), [(second,)])
        self.committed(self.remove(answer))
        self.assertEqual(set(self.sql('SELECT ask_id FROM conversation_waits WHERE actor_id=?', ('owner',))), {(ask,), (second,)})
        own = self.ask(actor='owner', asked=['agent-a'], topic=topic)
        self.committed(self.remove(own))
        self.assertNotIn((own,), self.sql('SELECT ask_id FROM conversation_waits'))
        page = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']
        self.assertNotIn(own, [entry['ask_message_id'] for entry in page['waits']])

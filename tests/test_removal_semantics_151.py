from __future__ import annotations

"""151 Build2 semantic corrections; every record lives in ReaderCase's temp store."""

from unittest import mock

from aim_next.reactions import ANSWERS
import reader_fixture as fixtures
import test_message_edit as edit_fixture
import test_message_removal_151 as removal_fixture
import test_pipeline_steering as pipeline_fixture
import test_question_withdrawal as withdrawal_fixture
import test_removal_corrections_151 as correction_fixture


class RemovalSemanticsCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    member = edit_fixture.EditCase.member
    ask = withdrawal_fixture.WithdrawalCase.ask
    waits = withdrawal_fixture.WithdrawalCase.waits
    quiet_topic = correction_fixture.RemovalActivityCase.quiet_topic

    def test_late_unsend_after_retract_refuses_without_new_receipt_or_effect(self):
        message = self.post()
        receipt = self.remove(message, 'retract', op='retract-original')
        result = self.committed(receipt)
        before = self.records()
        refused = self.remove(message, 'unsend', op='late-unsend')
        self.rejected(refused, 'MESSAGE_SEEN')
        self.assertFalse(refused['recorded'])
        self.assertEqual(self.records(), before)
        self.assertEqual(self.remove(message, 'retract', op='retract-original'), receipt)
        repeated = self.committed(self.remove(message, 'retract', op='same-kind-new-operation'))
        self.assertFalse(repeated['changed'])
        self.assertEqual(repeated['removal'], result['removal'])

    def test_second_person_cannot_unsend_or_retract_an_authors_message(self):
        self.participation('other-reader', True)
        message = self.post()
        tables = ('messages', 'message_removals', 'deliveries', 'topic_summaries', 'message_reactions')
        before = {name: self.sql('SELECT * FROM ' + name + ' ORDER BY rowid') for name in tables}
        for mode in ('unsend', 'retract'):
            with self.subTest(mode=mode):
                self.rejected(self.remove(message, mode, actor='other-reader'), 'FORBIDDEN')
                self.assertEqual({name: self.sql('SELECT * FROM ' + name + ' ORDER BY rowid') for name in tables}, before)

    def move_dossier(self, root, destination):
        return self.committed(self.command('stack.move', {'topic_id': destination}, target={'message_id': root},
            expected={'source_topic_id': 't1', 'move_revision': 0}))

    def test_move_keeps_unsent_membership_history_out_of_both_visible_summaries(self):
        root = self.post(body='Surviving dossier root')
        reply = self.post(body='Gone reply must not be latest', reply_to=root)
        self.committed(self.remove(reply))
        self.quiet_topic('destination', participants=['agent-a'])
        before = self.sql("SELECT message_count FROM topic_summaries WHERE topic_id='t1'")[0][0]
        original = self.sql('SELECT body,author_id,reply_to FROM messages WHERE id=?', (reply,))
        self.move_dossier(root, 'destination')
        self.assertEqual(self.sql("SELECT message_count,latest_message_id,other_message_id FROM topic_summaries WHERE topic_id='destination'"),
                         [(1, root, None)], 'an unsent member still moves, but never counts or becomes the visible latest message')
        self.assertEqual(self.sql("SELECT message_count FROM topic_summaries WHERE topic_id='t1'"), [(before - 1,)])
        self.assertEqual(self.sql('SELECT topic_id FROM messages WHERE id=?', (reply,)), [('destination',)])
        self.assertEqual(self.sql('SELECT body,author_id,reply_to FROM messages WHERE id=?', (reply,)), original)
        self.assertEqual({row[0] for row in self.sql('SELECT message_id FROM dossier_move_members')}, {root, reply})
        page = self.store.view('owner', 'topic_messages', {'topic_id': 'destination'})
        self.assertNotIn('error', page, page)
        self.assertEqual([item['id'] for item in page['items']], [root])

    def moving_removed_ask(self, mode):
        older = self.ask(actor='owner', asked=['agent-a'])
        root = self.post(body='Dossier for ' + mode)
        ask = self.ask(actor='owner', asked=['agent-a'], reply_to=root)
        self.committed(self.remove(ask, mode))
        destination = 'destination-' + mode
        self.quiet_topic(destination, participants=['agent-a'])
        self.assertEqual(self.waits('agent-a'), [('t1', 0, older)])
        self.move_dossier(root, destination)
        self.assertEqual(self.waits('agent-a'), [('t1', 0, older)],
                         'moving a removed ask must not create a second topic wait')
        self.assertEqual(self.sql('SELECT kind FROM message_removals WHERE message_id=?', (ask,)),
                         [('unsent' if mode == 'unsend' else 'retracted',)])

    def test_move_summary_other_message_skips_unsent_words_between_surviving_authors(self):
        root = self.post(body='Surviving owner root')
        hidden = self.post(body='Unsent owner reply', reply_to=root)
        latest = self.post(body='Surviving agent reply', actor='agent-a', addressees=['owner'], reply_to=root,
            reply_without_quote='This synthetic reply concerns the complete root')
        self.committed(self.remove(hidden))
        self.quiet_topic('destination-other', participants=['agent-a'])
        self.move_dossier(root, 'destination-other')
        self.assertEqual(self.sql("SELECT message_count,latest_message_id,other_message_id FROM topic_summaries WHERE topic_id='destination-other'"),
                         [(2, latest, root)], 'the other-author summary must skip the unsent owner reply too')
        self.assertEqual(self.sql('SELECT topic_id FROM messages WHERE id=?', (hidden,)), [('destination-other',)])

    def test_moving_unsent_ask_does_not_revive_wait_and_keeps_an_older_wait(self):
        self.moving_removed_ask('unsend')

    def test_moving_retracted_ask_does_not_revive_wait_and_keeps_an_older_wait(self):
        self.moving_removed_ask('retract')

    def conversation_fixture(self):
        self.member('other-reader', True)
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.coordinator_set', {'actor_id': 'owner'}, target={'workspace_id': 'w1'},
            expected={'workspace_revision': revision}))
        return self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']

    def conversation_post(self, topic, body, actor='owner', **extra):
        return self.committed(self.command('message.post', dict(body=body, **extra), target={'topic_id': topic}, actor=actor))['message_id']

    def conversation_item(self, topic, message):
        page = self.store.view('owner', 'topic_messages', {'topic_id': topic, 'message_ids': [message]})
        self.assertNotIn('error', page, page)
        return next(item['item'] for item in page['items'] if item['id'] == message)

    def test_removed_human_coordinator_answer_unsettles_item_but_keeps_take_history(self):
        topic = self.conversation_fixture()
        for mode in ('unsend', 'retract'):
            with self.subTest(mode=mode):
                item = self.conversation_post(topic, 'An item for ' + mode, actor='other-reader')
                answer = self.conversation_post(topic, 'A complete answer', reply_to=item)
                history = self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (item,))
                self.assertEqual(self.sql('SELECT kind,ref,part FROM conversation_takes WHERE item_id=?', (item,)), [('answer', answer, 0)])
                self.assertEqual(self.sql('SELECT settled FROM conversation_items WHERE message_id=?', (item,)), [(1,)])
                self.committed(self.remove(answer, mode))
                self.assertEqual(self.sql('SELECT settled FROM conversation_items WHERE message_id=?', (item,)), [(0,)])
                self.assertEqual(self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (item,)), history)
                self.assertEqual(self.conversation_item(topic, item), {'state': 'new', 'takes': []})

    def test_removing_an_older_answer_preserves_an_independent_surviving_take(self):
        topic = self.conversation_fixture()
        item = self.conversation_post(topic, 'An item with two answers', actor='other-reader')
        older = self.conversation_post(topic, 'Earlier answer', reply_to=item)
        later = self.conversation_post(topic, 'Independent later answer', reply_to=item)
        history = self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (item,))
        self.assertEqual(self.sql('SELECT ref FROM conversation_takes WHERE item_id=? ORDER BY id', (item,)), [(older,), (later,)])
        self.committed(self.remove(older))
        shown = self.conversation_item(topic, item)
        self.assertEqual(shown['state'], 'settled')
        self.assertEqual([take['ref'] for take in shown['takes']], [later])
        self.assertEqual(self.sql('SELECT * FROM conversation_takes WHERE item_id=?', (item,)), history)

    def test_new_decision_after_unsent_answer_is_not_a_changed_answer(self):
        ask = self.post(body='May I proceed?', actor='agent-a', intent='ask', addressees=['owner'], go_ahead=True,
            ask_wait={'root_id': None, 'cover_revision': 0, 'questions': [
                {'actor_id': 'owner', 'text': 'May I proceed?', 'options': ['Go ahead', "Don't"], 'default': "Don't", 'reason': None}]})
        first = self.committed(self.command('message.answer', {'answer': 'yes'}, target={'message_id': ask},
            expected={'answer_revision': 0}))
        original = self.sql('SELECT * FROM messages WHERE id=?', (first['reply_id'],))
        self.committed(self.remove(first['reply_id']))
        revision = self.sql("SELECT revision FROM message_reactions WHERE message_id=? AND actor_id='owner' AND kind='answer' AND value IS NULL", (ask,))[0][0]
        second = self.committed(self.command('message.answer', {'answer': 'no'}, target={'message_id': ask},
            expected={'answer_revision': revision}))
        self.assertEqual(self.sql('SELECT body FROM messages WHERE id=?', (second['reply_id'],)), [(ANSWERS['no'],)])
        self.assertEqual(self.sql('SELECT * FROM messages WHERE id=?', (first['reply_id'],)), original)


class RemovedPipelineAuthorityCase(fixtures.ReaderCase):
    on = pipeline_fixture.PipelineCase.on
    add = pipeline_fixture.PipelineCase.add
    item = pipeline_fixture.PipelineCase.item
    move = pipeline_fixture.PipelineCase.move
    stages = pipeline_fixture.PipelineCase.stages
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove

    def setUp(self):
        self.now = 1_800_000_000_000
        for name in ('pipeline', 'conversation'):
            patch = mock.patch('aim_next.' + name + '._now_ms', side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        super().setUp()
        self.committed(self.on())
        self.stages({'stage_id': 'build', 'name': 'Build', 'rounds': 'together'})
        self.number = self.add('Owned placement', section='now', size='small')
        self.now += 1000

    def revoked_word(self):
        word = self.post(body='Move %d to Later' % self.number)
        self.committed(self.remove(word, 'retract'))
        shown = self.store.view('owner', 'source', {'source_ref': {'kind': 'message', 'id': word}})
        self.assertEqual(shown['removal']['kind'], 'retracted')
        self.assertEqual(shown['body'], 'Move %d to Later' % self.number)
        return word

    def pipeline_records(self):
        return {name: self.sql('SELECT * FROM ' + name + ' ORDER BY rowid') for name in
                ('pipeline_items', 'pipeline_events', 'pipeline_pieces', 'pipeline_piece_members', 'pipeline_stage_entries')}

    def test_retracted_owner_word_cannot_authorize_coordinator_move(self):
        word = self.revoked_word()
        before = self.pipeline_records()
        self.rejected(self.move(self.number, section='later', actor='agent-a', because_message_id=word), 'OWNER_PLACED')
        self.assertEqual(self.pipeline_records(), before)

    def test_retracted_owner_word_cannot_authorize_setting_a_piece_aside(self):
        piece = self.committed(self.command('pipeline.piece_start', {'numbers': [self.number], 'topic_id': 't1', 'stage_id': 'build'},
            target={'workspace_id': 'w1'}))['piece_id']
        self.now += 1000
        word = self.revoked_word()
        before = self.pipeline_records()
        self.rejected(self.move(self.number, section='later', actor='agent-a', because_message_id=word,
            note='This is a fixture reason to set the piece aside'), 'OWNER_PLACED')
        self.assertEqual(self.pipeline_records(), before)
        self.assertEqual(self.sql('SELECT left_ms FROM pipeline_stage_entries WHERE piece_id=?', (piece,)), [(None,)])

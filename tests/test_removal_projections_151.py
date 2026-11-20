from __future__ import annotations

import json
import sqlite3
from unittest import mock

import reader_fixture as fixtures
from test_message_removal_151 import RemovalCase
from test_topic_images import TopicImagesCase


class ProjectionCase(fixtures.ReaderCase):
    post = RemovalCase.post
    remove = RemovalCase.remove
    source_view = RemovalCase.source_view
    ready = TopicImagesCase.ready

    def test_published_quote_relation_is_atomic_immutable_and_never_scans_history(self):
        message = self.post(body='Keep the original quote source')
        args = {'body': 'A separate quote', 'quotes': [{'source': {'kind': 'message', 'id': message}, 'excerpt': 'Keep the original quote source'}]}
        before = self.sql('SELECT id FROM messages ORDER BY seq')
        with mock.patch.object(self.store, '_change', side_effect=RuntimeError('quote publication interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'quote publication interrupted'):
                self.command('message.post', args, target={'topic_id': 't1'}, op='quote-atomic')
        self.assertEqual(self.sql('SELECT id FROM messages ORDER BY seq'), before)
        self.assertEqual(self.sql('SELECT * FROM message_quote_sources WHERE source_id=?', (message,)), [])
        receipt = self.command('message.post', args, target={'topic_id': 't1'}, op='quote-atomic')
        quoting = self.committed(receipt)['message_id']
        self.assertEqual(self.command('message.post', args, target={'topic_id': 't1'}, op='quote-atomic'), receipt)
        self.assertEqual(self.sql('SELECT * FROM message_quote_sources WHERE source_id=?', (message,)), [(message, quoting)])
        for statement in ('DELETE FROM message_quote_sources', 'UPDATE message_quote_sources SET source_id=message_id'):
            with self.assertRaises(sqlite3.IntegrityError): self.sql(statement)

    def test_retracted_words_carry_terminal_identity_in_quotes_stars_and_dossier_previews(self):
        message = self.post(body='Original retracted words')
        quoting = self.post(body='My distinct words', quotes=[{'source': {'kind': 'message', 'id': message}, 'excerpt': 'Original retracted words'}])
        self.committed(self.command('message.star', {'starred': True}, target={'message_id': message}, expected={'star_revision': 0}))
        act = self.committed(self.remove(message, 'retract'))['removal']
        for name, projected in [
                ('quote', self.source_view(quoting)['quotes'][0]),
                ('star', self.store.view('owner', 'stars', {'topic_id': 't1'})['items'][0]),
                ('star dossier', self.store.view('owner', 'stars', {'topic_id': 't1'})['items'][0]['dossier']),
                ('Reader dossier', self.source_view(message)['dossier']['first'])]:
            with self.subTest(projection=name): self.assertEqual(projected.get('removal'), act)

    def test_unsent_topic_references_disappear_and_future_join_is_refused(self):
        message = self.post()
        survivor = self.post(body='Surviving independent message')
        self.sql('UPDATE topics SET state_message_id=?,source_message_id=? WHERE id=\'t1\'', (message, message))
        self.committed(self.remove(message))
        topic = self.store.view('owner', 'topic', {'topic_id': 't1'})['topic']
        self.assertIsNone(topic['state_message_id']); self.assertIsNone(topic['source_message_id'])
        self.rejected(self.command('stack.join', {'into': message}, target={'message_id': survivor}, expected={'join_revision': 0}), 'INVALID_ARGUMENT')

    def test_published_self_quote_means_retract_only_and_both_original_records_stay(self):
        message = self.post(body='A precise quoted sentence.')
        ref = {'kind': 'message', 'id': message}
        words = '> A precise quoted sentence.\n\nMy separate comment.'
        quoting = self.post(body=words, quotes=[{'source': ref, 'excerpt': 'A precise quoted sentence.'}])
        before = self.sql('SELECT id,body,quotes FROM messages WHERE id IN (?,?) ORDER BY id', (message, quoting))
        self.assertEqual(self.source_view(message)['removal_action'], 'retract')
        refused = self.remove(message)
        self.rejected(refused, 'MESSAGE_SEEN'); self.assertFalse(refused['recorded'])
        self.committed(self.remove(message, 'retract'))
        self.assertEqual(self.source_view(quoting)['body'], words)
        self.assertEqual(self.sql('SELECT id,body,quotes FROM messages WHERE id IN (?,?) ORDER BY id', (message, quoting)), before)
        self.assertEqual(self.sql('SELECT source_id,message_id FROM message_quote_sources WHERE source_id=?', (message,)), [(message, quoting)])
        plan = self.sql('EXPLAIN QUERY PLAN SELECT 1 FROM message_quote_sources WHERE source_id=? LIMIT 1', (message,))
        self.assertTrue(any('SEARCH' in row[3] and 'source_id=?' in row[3] for row in plan), plan)

    def test_unsent_notebook_reference_leaves_no_source_or_excerpt(self):
        message = self.post(body='Notebook reference original')
        ref = {'kind': 'message', 'id': message}
        self.committed(self.memory(actor='owner', references=[ref]))
        self.committed(self.remove(message))
        notebook = self.store.view('owner', 'memory_current', {'item_id': 'memory-one'})
        self.assertEqual(notebook['references'], [])
        for actor in ('owner', 'agent-a'):
            for name, args in [('source', {'source_ref': self.memory_ref()}), ('memory_current', {'item_id': 'memory-one'})]:
                with self.subTest(actor=actor, view=name):
                    result = self.store.view(actor, name, args)
                    self.assertNotIn('error', result, result)
                    self.assertNotIn(message, json.dumps(result))

    def test_unsent_addressed_page_does_not_stop_at_hidden_rows(self):
        hidden = [self.post(body='hidden %d' % i) for i in range(4)]
        survivor = self.post(body='Visible after hidden rows')
        for identity in hidden:
            self.committed(self.remove(identity))
        cursor = self.sql('SELECT seq FROM messages WHERE id=?', (hidden[0],))[0][0] - 1
        page = self.store.view('agent-a', 'topic_messages', {'topic_id': 't1', 'audience': 'reader', 'cursor': cursor, 'limit': 1})
        self.assertEqual([item['id'] for item in page['items']], [survivor])

    def test_unsent_reply_is_absent_from_dossier_count_and_parent_reply_marker(self):
        parent = self.opening['id']
        reply = self.post(reply_to=parent)
        self.committed(self.remove(reply))
        source = self.source_view(parent)
        self.assertTrue(source['dossier']['alone'])
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1'})
        item = next(item for item in page['items'] if item['id'] == parent)
        self.assertIsNone(item['replied'])
        summary = self.store.view('owner', 'topic', {'topic_id': 't1'})['summary']
        self.assertEqual(summary['latest_message_id'], parent)
        self.assertEqual(summary['message_count'], 1)

    def test_unsent_message_cannot_be_acted_on_or_replied_to_and_no_image_card_survives(self):
        self.ready('removed-image', 'one.png')
        message = self.post(body='', attachments=[{'id': 'removed-image'}])
        self.committed(self.remove(message))
        for name, args in [('dossier_cover', {'message_id': message}), ('stack_namer', {'message_id': message}),
                           ('source_topics', {'message_id': message})]:
            with self.subTest(view=name):
                self.assertEqual(self.store.view('owner', name, args).get('error', {}).get('code'), 'FORBIDDEN')
        self.rejected(self.command('message.star', {'starred': True}, target={'message_id': message}, expected={'star_revision': 0}), 'FORBIDDEN')
        self.rejected(self.command('message.post', {'body': 'Must not post', 'reply_to': message}, target={'topic_id': 't1'}), 'INVALID_REPLY')
        self.assertNotIn(message, json.dumps(self.store.view('owner', 'topic_images', {'topic_id': 't1'})))

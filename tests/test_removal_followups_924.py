from __future__ import annotations

import reader_fixture as fixtures
import test_message_removal_151 as removal_fixture


class RemovalFollowupsCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    source_view = removal_fixture.RemovalCase.source_view

    def test_second_unsend_has_original_act_without_repeating_effects(self):
        message = self.post()
        first = self.committed(self.remove(message, op='first-device'))
        kept = {table: self.sql('SELECT * FROM ' + table + ' ORDER BY rowid')
                for table in ('messages', 'message_removals', 'deliveries', 'delivery_groups', 'topics', 'topic_summaries')}
        receipt = self.remove(message, op='second-device')
        second = self.committed(receipt)
        self.assertFalse(second['changed'])
        self.assertEqual(second['removal'], first['removal'])
        self.assertEqual(second['message_id'], message)
        self.assertEqual(self.remove(message, op='second-device'), receipt)
        for table, rows in kept.items():
            self.assertEqual(self.sql('SELECT * FROM ' + table + ' ORDER BY rowid'), rows, table)
        self.assertEqual(self.source_view(message)['error']['code'], 'FORBIDDEN')
        self.rejected(self.command('message.edit_open', {'holder': 'other-tab'}, target={'message_id': message}), 'FORBIDDEN')

    def test_removed_source_stays_unknown_to_other_people_and_agents(self):
        self.participation('other-reader', True)
        message = self.post(whisper=True, intent=None)
        self.committed(self.remove(message))
        for actor in ('other-reader', 'agent-a', 'agent-b'):
            with self.subTest(actor=actor):
                refused = self.remove(message, actor=actor)
                missing = self.remove('unknown-removal', actor=actor)
                self.assertEqual(refused['error'], missing['error'])
                self.rejected(refused, 'FORBIDDEN')
        self.assertEqual(len(self.sql('SELECT * FROM message_removals WHERE message_id=?', (message,))), 1)

    def test_retracted_parent_metadata_reaches_each_readable_reply_projection(self):
        self.participation('other-reader', True)
        parent = self.post('Original parent words')
        reply = self.post('Reply words', reply_to=parent)
        removed = self.committed(self.remove(parent, 'retract'))['removal']
        for actor in ('owner', 'other-reader', 'agent-a', 'agent-b'):
            for args in ({}, {'message_ids': [reply]}, {'direction': 'before'}):
                with self.subTest(actor=actor, args=args):
                    page = self.store.view(actor, 'topic_messages', dict(topic_id='t1', **args))
                    item = next(row for row in page['items'] if row['id'] == reply)
                    self.assertEqual(item['reply_to_excerpt'], 'Original parent words')
                    self.assertEqual(item.get('reply_to_removal'), removed)

    def test_private_and_withheld_parent_metadata_stays_private(self):
        parent = self.post('Secret parent', whisper=True, intent=None)
        reply = self.post('Private reply', reply_to=parent, whisper=True, intent=None)
        removed = self.committed(self.remove(parent, 'retract'))['removal']
        for actor in ('owner', 'agent-a', 'agent-b'):
            with self.subTest(actor=actor):
                page = self.store.view(actor, 'topic_messages', {'topic_id': 't1'})
                if actor == 'agent-b':
                    self.assertNotIn(reply, [row['id'] for row in page['items']])
                else:
                    item = next(row for row in page['items'] if row['id'] == reply)
                    self.assertEqual(item.get('reply_to_removal'), removed)

        held = self.post('Held parent')
        held_reply = self.post('Held reply', reply_to=held)
        self.committed(self.command('message.edit_open', {'holder': 'another-device'}, target={'message_id': held}))
        page = self.store.view('agent-a', 'topic_messages', {'topic_id': 't1', 'message_ids': [held_reply]})
        self.assertTrue(page['items'][0]['reply_to_withheld'])
        self.assertIsNone(page['items'][0]['reply_to_excerpt'])
        self.assertIsNone(page['items'][0].get('reply_to_removal'))
        for field in ('reply_to_sent_ms', 'reply_to_author_kind', 'reply_to_withdrawn'):
            self.assertNotIn(field, page['items'][0])

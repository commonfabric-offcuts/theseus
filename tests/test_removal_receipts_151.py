from __future__ import annotations

import json

import reader_fixture as fixtures
import test_message_removal_151 as removal_fixture


class ReceiptCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    source_view = removal_fixture.RemovalCase.source_view

    def test_open_or_closed_edit_session_means_retract_only_and_preserves_exact_receipts(self):
        for state in ('open', 'closed'):
            with self.subTest(state=state):
                message = self.post(body='Original words ' + state)
                op = 'open-' + state
                opened = self.command('message.edit_open', {'holder': 'another-device'}, target={'message_id': message}, op=op)
                self.committed(opened)
                self.assertIn('Original words ' + state, json.dumps(opened))
                if state == 'closed':
                    self.committed(self.command('message.edit_close', {'holder': 'another-device'}, target={'message_id': message}))
                self.assertEqual(self.source_view(message)['removal_action'], 'retract')
                refused = self.remove(message)
                self.rejected(refused, 'MESSAGE_SEEN')
                self.assertFalse(refused['recorded'])
                self.committed(self.remove(message, 'retract'))
                self.assertEqual(self.store.view('owner', 'operation', {'operation_id': op}), opened)
                self.assertEqual(self.command('message.edit_open', {'holder': 'another-device'}, target={'message_id': message}, op=op), opened)
                self.rejected(self.command('message.edit_open', {'holder': 'new-device'}, target={'message_id': message}), 'MESSAGE_REMOVED')
                self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND state IN ('pending','held')", (message,)), [])

    def test_human_send_receipt_has_no_words_and_published_snapshot_is_not_readable_after_unsend(self):
        ref = {'kind': 'topic', 'id': 't1'}
        words = 'Private snapshot becomes one public message'
        self.committed(self.save_draft('draft-removal', ref, 't1', words))
        prepared = self.committed(self.prepare('draft-removal', 't1', submission='submitted-removal', send_op='send-removal'))
        sent = self.command('message.send', {'submission_id': 'submitted-removal'}, target={'topic_id': 't1'}, op=prepared['send_operation_id'])
        message = self.committed(sent)['message_id']
        self.assertNotIn(words, json.dumps(sent))
        self.committed(self.remove(message))
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': prepared['send_operation_id']}), sent)
        self.assertEqual(self.store.view('owner', 'submission', {'submission_id': 'submitted-removal'}).get('error', {}).get('code'), 'FORBIDDEN')
        self.assertNotIn('submitted-removal', json.dumps(self.store.view('owner', 'submissions', {})))

    def test_late_ack_of_cancelled_delivery_cannot_decrement_counters_or_revive_it(self):
        message = self.post()
        delivery = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-a'", (message,))[0][0]
        self.committed(self.remove(message))
        counters = self.sql('SELECT * FROM recipient_schedule ORDER BY recipient_id')
        groups = self.sql('SELECT * FROM delivery_groups ORDER BY id')
        reply = self.committed(self.command('delivery.ack', target={'delivery_id': delivery}, actor='agent-a'))
        self.assertFalse(reply['acknowledged'])
        self.assertEqual(reply['reason'], 'not_pending')
        self.assertEqual(self.sql('SELECT * FROM recipient_schedule ORDER BY recipient_id'), counters)
        self.assertEqual(self.sql('SELECT * FROM delivery_groups ORDER BY id'), groups)
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE id=?', (delivery,)), [('cancelled',)])

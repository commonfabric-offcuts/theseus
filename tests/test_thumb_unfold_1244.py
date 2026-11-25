from __future__ import annotations

"""Thumbs preserve the person's fold choice, with real isolated Core commands."""
import unittest
from test_stacks import StackCase


class ThumbFoldChoiceCase(StackCase):
    def thumb(self, message, on=True, revision=0, op=None):
        return self.command('message.thumb', {'thumbed': on}, target={'message_id': message},
                            expected={'thumb_revision': revision}, op=op)

    def test_give_retry_take_back_and_give_again_leave_an_open_message_open(self):
        message = self.post('Keep reading', addressees=['owner'], intent='tell')
        receipt = self.thumb(message, op='one-thumb')
        self.committed(receipt)
        self.assertEqual(self.thumb(message, op='one-thumb'), receipt)
        self.assertEqual((self.acts(message)['folded'], self.acts(message)['fold_revision']), (False, 0))
        self.assertTrue(receipt['result']['settled'])
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE message_id=? AND recipient_id=?', (message, 'owner')), [('acknowledged',)])
        self.committed(self.thumb(message, False, 1))
        self.committed(self.thumb(message, True, 2))
        self.assertEqual(self.rows('fold'), [])

    def test_explicit_unfold_is_preserved_and_manual_fold_still_works(self):
        message = self.post('Read whole')
        self.committed(self.fold(message))
        self.committed(self.fold(message, False, 1))
        self.committed(self.thumb(message))
        self.assertEqual((self.acts(message)['folded'], self.acts(message)['fold_revision']), (False, 2))
        self.committed(self.fold(message, True, 2))
        self.committed(self.thumb(message, False, 1))
        self.assertEqual((self.acts(message)['folded'], self.acts(message)['fold_revision']), (True, 3))

    def test_thumb_still_answers_a_plain_ask_and_taking_it_back_restores_the_wait(self):
        message = self.post('Can you check?', addressees=['owner'], intent='ask')
        self.assertTrue(self.committed(self.thumb(message))['answered'])
        self.assertFalse(self.acts(message)['folded'])
        self.assertFalse(self.committed(self.thumb(message, False, 1))['answered'])
        attention = self.store.view('owner', 'attention', {})
        self.assertEqual(attention['waiting_on_me'], 1)
        self.assertIn('t1', [item['id'] for item in attention['latest_waiting']])

    def test_reply_keeps_its_existing_personal_fold(self):
        message = self.post('Reply here')
        self.committed(self.command('message.post', {'body': 'Replied', 'reply_to': message}, target={'topic_id': 't1'}))
        self.assertTrue(self.acts(message)['folded'])


if __name__ == '__main__':
    unittest.main()

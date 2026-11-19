from __future__ import annotations

import json
import sys
import unittest

import reader_fixture as fixtures


class Item799Preflight(fixtures.ReaderCase):
    def test_real_distant_head_named_admission_revision_and_private_control(self):
        self.assertEqual(sys.version_info[:2], (3, 9))
        self.assertTrue(sys.pycache_prefix)
        print('effective_pycache_prefix=' + sys.pycache_prefix)
        receipts = []

        def post(body, **args):
            receipt = self.command('message.post', dict(body=body, **args),
                                   target={'topic_id': 't1'}, actor='agent-a')
            result = self.committed(receipt)
            receipts.append({'operation_id': receipt['operation_id'], 'status': receipt['status'],
                             'recorded': receipt['recorded'], 'message_id': result['message_id']})
            return result['message_id']

        root = post('Real first message\nA second line stays in the source.')
        for n in range(40):
            post('Intervening message %d' % n)
        reply = post('Loaded reply in the real dossier', reply_to=root)
        latest = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction': 'before', 'limit': 30})
        self.assertNotIn(root, [item['id'] for item in latest['items']])
        loaded = next(item for item in latest['items'] if item['id'] == reply)
        self.assertEqual(loaded['stack_position']['root_id'], root)
        named = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'message_ids': [root]})
        self.assertEqual([(item['id'], item['body']) for item in named['items']], [(root, 'Real first message\nA second line stays in the source.')])
        changed = self.command('message.edit', {'body': 'Revised actual first line'}, {'message_id': root},
                               {'message_revision': 1}, actor='agent-a')
        self.committed(changed)
        revised = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'message_ids': [root]})
        self.assertEqual(revised['items'][0]['revision'], 2)
        self.assertEqual(revised['items'][0]['body'], 'Revised actual first line')
        secret = self.committed(self.command('message.post', {'body': 'Private control must not leak', 'whisper': True, 'addressees': ['agent-a']}, target={'topic_id': 't1'}))['message_id']
        private = self.store.view('agent-b', 'topic_messages', {'topic_id': 't1', 'message_ids': [secret]})
        missing = self.store.view('agent-b', 'topic_messages', {'topic_id': 't1', 'message_ids': ['m-' + '0' * 32]})
        self.assertEqual(private['error']['code'], 'FORBIDDEN')
        self.assertEqual(private['error'], missing['error'])
        runtime = self.store.view('owner', 'capabilities', {})['runtime']
        self.assertEqual([runtime[k] for k in ['journal_mode', 'synchronous', 'fullfsync', 'foreign_keys']], ['delete', 3, 1, 1])
        print(json.dumps({'receipts': receipts, 'root': root, 'reply': reply,
                          'loaded_count': len(latest['items']), 'cursor': latest['next_cursor'],
                          'source_revision': revised['items'][0]['revision'], 'privacy': private['error']['code'],
                          'runtime': runtime}, sort_keys=True))


if __name__ == '__main__':
    unittest.main()

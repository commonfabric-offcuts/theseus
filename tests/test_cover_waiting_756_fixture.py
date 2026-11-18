from __future__ import annotations

import json
import subprocess
import sys
import unittest


class CoverWaiting756FixtureCase(unittest.TestCase):
    def test_item_756_real_native_fixture_records_and_cleans_up(self):
        self.assertTrue(sys.pycache_prefix, 'effective unique cache required')
        fixture = subprocess.Popen([sys.executable, '-I', '-X', 'pycache_prefix=' + sys.pycache_prefix,
            'tests/fixtures/ui_http.py', '--freshness'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        serial = 0

        def call(method, **args):
            nonlocal serial
            serial += 1
            fixture.stdin.write(json.dumps(dict(args, id=serial, method=method)) + '\n')
            fixture.stdin.flush()
            reply = json.loads(fixture.stdout.readline())
            self.assertNotIn('failure', reply, reply.get('failure'))
            return reply['answer']

        def items(actor='fixture-person'):
            return call('agent_view', actor=actor, name='workspaces', args={})['items']

        try:
            seed = call('item756_seed', operation_id='synthetic-756')
            item = next(i for i in items() if i['id'] == seed['workspace'])
            self.assertEqual(item['cover_waiting'], 0, 'private cover does not leak to the owner outside its whisper')
            for n, root in enumerate(seed['roots']):
                receipt = call('item756_act', message_id=root, operation_id='synthetic-756-set%d' % n,
                    waiting=[{'text': 'Choose a cabin', 'default': 'Keep the current cabin'}] * (n + 1))
                self.assertEqual(receipt['status'], 'committed')
            item = next(i for i in items() if i['id'] == seed['workspace'])
            self.assertEqual(item['cover_waiting'], 2)
            other = next(i for i in items(seed['other']) if i['id'] == seed['workspace'])
            self.assertEqual(other['cover_waiting'], 0, 'the private reader is not the named owner')
            for sender, owner in [('fixture-person', seed['other']), (seed['other'], 'fixture-person')]:
                self.assertEqual(call('outcome_change', operation_id='synthetic-756-owner-' + owner, sender=sender,
                    owner=owner, workspace_id=seed['workspace'])['status'], 'committed')
                item = next(i for i in items() if i['id'] == seed['workspace'])
                self.assertEqual(item['cover_waiting'], 2 if owner == 'fixture-person' else 0)
            for n, root in enumerate(seed['roots']):
                self.assertEqual(call('item756_act', message_id=root, operation_id='synthetic-756-clear%d' % n,
                    waiting=[])['status'], 'committed')
            self.assertEqual(next(i for i in items() if i['id'] == seed['workspace'])['cover_waiting'], 0)
        finally:
            fixture.stdin.close()
            code = fixture.wait(timeout=15)
            errors = fixture.stderr.read()
            fixture.stdout.close()
            fixture.stderr.close()
            self.assertEqual(code, 0, errors)
            self.assertEqual(errors, '')
            print('owned item756 HTTP fixture EOF cleanup: exit=0, stderr empty', flush=True)

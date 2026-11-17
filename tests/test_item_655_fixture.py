from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import unittest


class Item655FixtureCase(unittest.TestCase):
    """Actual private fixture control API and Store, without a browser or credentials."""
    def test_partial_sender_requires_explicit_participation_and_keeps_membership(self):
        self.assertTrue(sys.pycache_prefix, 'use an effective unique -X pycache_prefix')
        print('effective_pycache_prefix=' + sys.pycache_prefix, flush=True)
        fixture = subprocess.Popen([sys.executable, '-I', '-X', 'pycache_prefix=' + sys.pycache_prefix,
                                    'tests/fixtures/ui_http.py', '--freshness', '--agent-colors'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        serial = 0
        def call(method, **args):
            nonlocal serial
            serial += 1
            fixture.stdin.write(json.dumps(dict(args, id=serial, method=method)) + '\n')
            fixture.stdin.flush()
            reply = json.loads(fixture.stdout.readline())
            self.assertEqual(reply['id'], serial)
            return reply
        def topic(name):
            self.assertNotIn('failure', call('navigation_topics', topics=[dict(id=name, title=name)]))
        def post(topic_id, operation, **args):
            return call('agent_message', operation_id=operation, topic_id=topic_id, source='topic',
                        sender='aim-core', addressees=['fixture-person'], **args)
        try:
            topic('655-omitted')
            denied = post('655-omitted', '655-omitted-old', body='Older joined branch.')
            self.assertIn('FORBIDDEN', denied.get('failure', ''))
            self.assertIn('No permission for this topic', denied['failure'])
            print('actual omitted-flag refusal: FORBIDDEN / No permission for this topic', flush=True)
            # Read the native fixture's actual flag, rather than a separate model of its setup.
            line = next(line for line in Path('tests/stack_native.mjs').read_text().splitlines()
                        if "body: 'Older joined branch.'" in line)
            topic('655-corrected')
            old = post('655-corrected', '655-corrected-old', body='Older joined branch.',
                       **({'join': True} if re.search(r'\bjoin:\s*true\b', line) else {}))
            self.assertNotIn('failure', old, 'native seed must explicitly admit this fixture sender')
            old_id = old['answer']['result']['message_id']
            reply = post('655-corrected', '655-corrected-reply', body='Reply outside the root page.', reply_to=old_id)
            root = post('655-corrected', '655-corrected-root', body='Loaded root with older members.')
            reply_id, root_id = reply['answer']['result']['message_id'], root['answer']['result']['message_id']
            joined = call('stack_act', sender='aim-core', kind='stack.join', message_id=old_id,
                          operation_id='655-corrected-join', args={'into': root_id})
            self.assertNotIn('failure', joined)
            positions = call('agent_view', actor='fixture-person', name='stack_positions',
                             args={'topic_id': '655-corrected', 'message_ids': [old_id, reply_id, root_id]})['answer']['items']
            self.assertEqual({i['stack_position']['root_id'] for i in positions}, {root_id})
            self.assertTrue(all(i['stack_position']['has_other_messages'] for i in positions))
            # Participation remains scoped: corrected setup must not grant another topic.
            topic('655-still-denied')
            self.assertIn('FORBIDDEN', post('655-still-denied', '655-still-denied-old', body='Still denied.').get('failure', ''))
            print('corrected real API: exact joined root/members; separate topic remains denied', flush=True)
        finally:
            fixture.stdin.close()
            code = fixture.wait(timeout=15)
            errors = fixture.stderr.read()
            fixture.stdout.close()
            fixture.stderr.close()
            self.assertEqual(code, 0, errors)
            self.assertEqual(errors, '')
            print('owned fixture EOF cleanup exit=' + str(code), flush=True)


if __name__ == '__main__':
    unittest.main()

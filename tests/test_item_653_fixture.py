from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


class Item653FixtureCase(unittest.TestCase):
    def test_item_653_lost_topic_keeps_only_the_named_message_and_exact_image_descriptor(self):
        self.assertTrue(sys.pycache_prefix, 'unique effective cache required')
        print('effective_pycache_prefix=' + sys.pycache_prefix, flush=True)
        source = os.environ.get('ITEM653_FIXTURE_SOURCE', 'tests/fixtures/ui_http.py')
        fixture = subprocess.Popen([sys.executable, '-I', '-X', 'pycache_prefix=' + sys.pycache_prefix,
                                    source, '--freshness', '--agent-colors'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        serial = 0
        def call(method, **args):
            nonlocal serial
            serial += 1
            fixture.stdin.write(json.dumps(dict(args, id=serial, method=method)) + '\n')
            fixture.stdin.flush()
            line = fixture.stdout.readline()
            self.assertTrue(line, 'fixture answers the exact control request')
            reply = json.loads(line)
            self.assertEqual(reply['id'], serial)
            self.assertNotIn('failure', reply, reply.get('failure'))
            return reply['answer']
        try:
            # No bootstrap, identity, authority or sign-in file is read.
            for image in (False, True):
                prefix = 'item653-lost-' + str(image).lower()
                sent = call('lost_named_message', operation_id=prefix, body='Item 653 exact permitted words.', image=image)
                self.assertEqual(sent['status'], 'committed')
                ref = dict(kind='message', id=sent['result']['message_id'])
                source_view = call('agent_view', actor='fixture-person', name='source', args=ref)
                self.assertEqual(source_view['source_ref'], ref)
                self.assertEqual(source_view['body'], 'Item 653 exact permitted words.')
                attached = source_view['attachments']
                self.assertEqual([a['id'] for a in attached], [prefix + '-media'] + ([prefix + '-image-media-0'] if image else []),
                                 'item 653 optional image is actually attached through Core')
                self.assertEqual(attached[0]['content_type'], 'text/plain')
                if image:
                    self.assertTrue(attached[1]['inline'])
                    self.assertEqual(attached[1]['content_type'], 'image/png')
                    self.assertEqual(len(attached[1]['sha256']), 64)
                    self.assertGreater(attached[1]['size_bytes'], 0)
                denied = call('agent_view', actor='fixture-person', name='topic', args=dict(topic_id=prefix + '-t'))
                self.assertEqual(denied['error']['code'], 'FORBIDDEN', 'named source permission grants no topic access')
        finally:
            fixture.stdin.close()
            code = fixture.wait(timeout=15)
            errors = fixture.stderr.read()
            fixture.stdout.close()
            fixture.stderr.close()
            self.assertEqual(code, 0, errors)
            self.assertEqual(errors, '')
            print('item 653 owned fixture EOF cleanup exit=' + str(code), flush=True)


if __name__ == '__main__':
    unittest.main()

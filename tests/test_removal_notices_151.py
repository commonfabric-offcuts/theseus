from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import uuid

from aim_next import Store, hosted_notice
from aim_next.profile import write_profile
import reader_fixture as fixtures
from test_message_removal_151 import RemovalCase


class NoticeCase(fixtures.ReaderCase):
    post = RemovalCase.post
    remove = RemovalCase.remove
    source_view = RemovalCase.source_view

    def test_old_ordinary_delivery_reads_original_words_with_terminal_metadata(self):
        message = self.post(body='Read these original words as retracted')
        identity = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-a'", (message,))[0][0]
        act = self.committed(self.remove(message, 'retract'))['removal']
        shown = self.store.view('agent-a', 'delivery', {'delivery_id': identity})
        self.assertNotIn('error', shown, shown)
        self.assertEqual(shown['item']['state'], 'cancelled')
        self.assertEqual(shown['item']['message']['body'], 'Read these original words as retracted')
        self.assertEqual(shown['item']['message'].get('removal'), act)

    def test_actual_cli_read_labels_retracted_words_with_act_time(self):
        message = self.post(body='Retracted CLI original')
        self.committed(self.remove(message, 'retract'))
        profile = Path(self.temp.name) / 'retraction-read-agent.json'
        write_profile(profile, str(self.path.resolve()), 'test-instance', 'agent-a', binding=self.binding)
        cache = str(Path(self.temp.name) / ('cache-cli-' + uuid.uuid4().hex))
        argv = [sys.executable, '-I', '-X', 'pycache_prefix=' + cache,
                str(Path(__file__).resolve().parents[1] / 'bin/aim-next'), '--profile', str(profile), 'read', 't1']
        result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        print('CLI151_READ ' + json.dumps(dict(argv=argv, exit=result.returncode, stdout=result.stdout, stderr=result.stderr)), flush=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Retracted CLI original', result.stdout)
        self.assertRegex(result.stdout, r'Retracted at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d by owner')

    def notice(self):
        message = self.post(body='One exposed message')
        self.source_view(message, 'agent-a')
        self.committed(self.remove(message, 'retract'))
        notices = [item for item in self.store.view('agent-a', 'deliveries', {'limit': 100})['items'] if item.get('retraction')]
        self.assertEqual(len(notices), 1)
        return message, notices[0]

    def test_notice_is_distinct_recipient_only_and_hosted_context_never_invents_a_message(self):
        message, item = self.notice()
        self.assertIsNone(item['message_id'])
        self.assertNotIn('message', item)
        self.assertEqual(item['retraction']['message_id'], message)
        for actor in ('owner', 'agent-b', 'other-reader', 'outsider'):
            self.assertEqual(self.store.view(actor, 'delivery', {'delivery_id': item['id']}).get('error', {}).get('code'), 'FORBIDDEN')
            self.assertNotIn(item['id'], json.dumps(self.store.view(actor, 'deliveries', {})))
        notice = hosted_notice.notice([item], None, 'agent-a', 'retraction-fixture')
        self.assertIn('retracted', json.dumps(notice))
        self.assertIn(message, json.dumps(notice))
        self.assertNotIn('One exposed message', json.dumps(notice))
        before = self.sql('SELECT count(*) FROM deliveries WHERE retraction_id=?', (message,))
        self.committed(self.remove(message, 'retract'))
        self.assertEqual(self.sql('SELECT count(*) FROM deliveries WHERE retraction_id=?', (message,)), before)
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        restored = self.store.view('agent-a', 'delivery', {'delivery_id': item['id']})
        self.assertEqual(restored['item'], item)

    def test_actual_cli_inbox_watch_and_ack_retraction_keep_ordinary_delivery(self):
        for delivery, recipient in self.sql("SELECT id,recipient_id FROM deliveries WHERE state='pending'"):
            self.committed(self.command('delivery.ack', target={'delivery_id': delivery}, actor=recipient))
        message, item = self.notice()
        profile = Path(self.temp.name) / 'retraction-agent.json'
        write_profile(profile, str(self.path.resolve()), 'test-instance', 'agent-a', binding=self.binding)
        observations = []
        def run(*args):
            cache = str(Path(self.temp.name) / ('cache-cli-' + uuid.uuid4().hex))
            argv = [sys.executable, '-I', '-X', 'pycache_prefix=' + cache,
                    str(Path(__file__).resolve().parents[1] / 'bin/aim-next'), '--profile', str(profile), *args]
            result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            observations.append(dict(argv=argv, exit=result.returncode, stdout=result.stdout, stderr=result.stderr))
            self.assertEqual(result.returncode, 0, observations[-1]); self.assertEqual(result.stderr, '', observations[-1])
            return result.stdout
        try:
            for text in (run('inbox'), run('watch', '--once')):
                self.assertTrue(text.startswith('retraction '), text)
                self.assertIn(message, text); self.assertIn(item['id'], text)
                self.assertNotIn('One exposed message', text)
                self.assertEqual(len(text.splitlines()), 1)
            self.assertIn('acknowledged', run('ack', item['id']))
            self.assertEqual(run('inbox'), 'inbox empty\n')
            self.post(body='Ordinary delivery still works')
            self.assertIn('Ordinary delivery still works', run('watch', '--once'))
        finally:
            print('CLI151_PROOF ' + json.dumps(observations), flush=True)

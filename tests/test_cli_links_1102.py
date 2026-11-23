from __future__ import annotations

"""1102: the actual agent CLI edits Links using isolated profiles and records."""

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest import mock

from aim_next import Store
from aim_next.contract import StoreError
from test_agent_verbs import AgentVerbCase


ROOT = Path(__file__).resolve().parents[1]


class LinksCLICase(AgentVerbCase):
    def links(self):
        return self.store.view('agent-b', 'workspace_links', {'workspace_id': 'w1', 'limit': 100})['items']

    def requests(self):
        return [json.loads((self.outbox('agent-b') / name).read_text())
                for name in self.saved('agent-b') if name.endswith('.request.json')]

    def add(self, url='https://example.test/work', *args):
        return self.run_cli('link-add', 'w1', url, *args, actor='agent-b')

    def kept(self, url='https://example.test/work', title='Working page', revision=0, removed=False):
        return self.committed(self.command('workspace.link_set', {'url': url, 'title': title, 'removed': removed},
                                          {'workspace_id': 'w1'}, {'link_revision': revision}))['link']

    def test_real_subprocess_agent_add_is_shared_and_journals_captured_authority(self):
        prefix = os.environ.get('PYTHONPYCACHEPREFIX')
        interpreter = [sys.executable, '-I'] + (['-X', 'pycache_prefix=' + prefix] if prefix else [])
        ran = subprocess.run(interpreter + [str(ROOT / 'bin/aim-next'), '--profile',
            str(self.profiles['agent-b']), '--json', 'link-add', 'w1', 'HTTPS://Example.TEST:443/work',
            '--title', 'Shared café'], capture_output=True, timeout=30)
        self.assertEqual(ran.returncode, 0, ran.stderr.decode())
        rows = [json.loads(line) for line in ran.stdout.splitlines()]
        receipt = next(row for row in rows if row.get('kind') == 'workspace.link_set')
        self.assertEqual((receipt['status'], receipt['recorded']), ('committed', True))
        for actor in ['owner', 'agent-a', 'agent-b']:
            link = self.store.view(actor, 'workspace_links', {'workspace_id': 'w1'})['items'][0]
            self.assertEqual((link['url'], link['title'], link['revision'], link['removed'], link['by']),
                             ('https://example.test/work', 'Shared café', 1, False, 'agent-b'))
        self.assertEqual(rows[-1]['items'][0], link, 'the CLI read is actual shared Core state')
        [request] = self.requests()
        self.assertEqual(request['binding'], self.captured_for('agent-b'))
        self.assertEqual(request['command']['expected'], {'link_revision': 0, 'authority': self.pin})
        self.assertEqual(request['command']['operation_id'], receipt['operation_id'])
        saved = json.loads((self.outbox('agent-b') / (receipt['operation_id'] + '.receipt.json')).read_text())
        self.assertEqual(saved, receipt)

    def test_defaults_rename_remove_and_restore_keep_one_identity(self):
        self.assertEqual(self.add()[0], 0)
        first = self.links()[0]
        self.assertEqual(first['title'], 'example.test')
        code, out, err = self.run_cli('link-rename', 'w1', first['url'], 'Renamed 🪴', actor='agent-b')
        self.assertEqual((code, err), (0, ''), out)
        self.assertIn('Renamed 🪴', out)
        self.assertEqual(self.run_cli('link-remove', 'w1', first['url'], actor='agent-b')[0], 0)
        removed = self.links()[0]
        self.assertEqual((removed['title'], removed['removed'], removed['revision']), ('Renamed 🪴', True, 3))
        self.assertEqual(self.run_cli('link-remove', 'w1', first['url'], actor='agent-b')[0], 0)
        self.assertEqual(self.links()[0], removed, 'repeated removal is a Core no-op')
        self.assertEqual(self.add(first['url'], '--title', 'Restored')[0], 0)
        restored = self.links()[0]
        self.assertEqual((restored['seq'], restored['revision'], restored['removed'], restored['title']),
                         (first['seq'], 4, False, 'Restored'))
        self.assertEqual(len(self.links()), 1)
        self.assertEqual(self.add('http://[2001:db8::1]:8080/work')[0], 0)
        self.assertEqual(self.links()[0]['title'], '[2001:db8::1]')

    def test_lookup_and_readback_page_to_the_exact_old_row(self):
        target = self.kept()
        for n in range(103):
            self.kept('https://other.test/%d' % n, 'Other %d' % n)
        before = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']
        code, out, err = self.run_cli('--json', 'link-rename', 'w1', target['url'], 'Paged target', actor='agent-b')
        self.assertEqual((code, err), (0, ''))
        rows = list(map(json.loads, out.splitlines()))
        receipt = next(row for row in rows if row.get('kind') == 'workspace.link_set')
        self.assertEqual(receipt['result']['link']['seq'], target['seq'])
        self.assertEqual(self.requests()[0]['command']['expected']['link_revision'], 1)
        self.assertGreaterEqual(sum('items' in row for row in rows), 4)
        all_rows = self.sql('SELECT url,title,revision FROM workspace_links ORDER BY seq')
        self.assertEqual(all_rows[0], (target['url'], 'Paged target', 2))
        self.assertTrue(all(title == 'Other %d' % n and rev == 1 for n, (_, title, rev) in enumerate(all_rows[1:])))
        self.assertEqual(self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace'], before)

    def test_missing_and_removed_rename_do_not_add_or_resurrect(self):
        for verb, tail in [('link-remove', []), ('link-rename', ['New'])]:
            code, out, err = self.run_cli(verb, 'w1', 'https://absent.test/', *tail, actor='agent-b')
            self.assertEqual(code, 2)
            self.assertIn('LINK_NOT_FOUND', err)
        self.assertEqual(self.requests(), [])
        removed = self.kept(removed=True)
        code, out, err = self.run_cli('link-rename', 'w1', removed['url'], 'Do not restore', actor='agent-b')
        self.assertEqual(code, 2)
        self.assertIn('LINK_NOT_FOUND', err)
        self.assertEqual(self.links(), [removed])

    def test_invalid_values_keep_the_collection_and_never_fetch_a_title(self):
        for url in ['javascript:alert(1)', 'https://user:secret@example.test/', 'https://bad.test/a\nb']:
            code, out, err = self.add(url)
            self.assertEqual(code, 2)
            self.assertIn('INVALID_ARGUMENT', err)
        self.assertEqual(self.requests(), [])
        for title in ['  ', 'Before\u200eafter', '界' * 500]:
            code, out, err = self.add('https://example.test/work', '--title', title)
            self.assertEqual(code, 2)
            self.assertIn('INVALID_ARGUMENT', err)
        self.assertEqual(self.links(), [])
        with mock.patch('socket.create_connection', side_effect=AssertionError('no remote title request')):
            self.assertEqual(self.add('https://unreachable.invalid/project')[0], 0)
        self.assertEqual(self.links()[0]['title'], 'unreachable.invalid')

    def test_permissions_and_closed_outcomes_are_still_core_authority(self):
        code, out, err = self.run_cli('link-add', 'w1', 'https://example.test/', actor='outsider')
        self.assertEqual(code, 2)
        self.assertIn('FORBIDDEN', err)
        self.assertEqual(self.saved('outsider'), [])
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-b'")
        code, out, err = self.add()
        self.assertEqual(code, 2)
        self.assertIn('FORBIDDEN', err, 'topic-only participation cannot read or write outcome Links')
        self.sql("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1','agent-b')")
        version = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.end_set', {'state': 'archived'}, {'workspace_id': 'w1'},
                                    {'workspace_revision': version}))
        code, out, err = self.add()
        self.assertEqual(code, 2)
        self.assertIn('OUTCOME_ARCHIVED', err)
        self.assertEqual(self.links(), [])

    def test_membership_lost_after_lookup_still_refuses_the_write(self):
        original = Store.command
        def revoked(store, actor, envelope):
            if actor == 'agent-b' and envelope['kind'] == 'workspace.link_set':
                self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-b'")
            return original(store, actor, envelope)
        with mock.patch.object(Store, 'command', revoked):
            code, out, err = self.add()
        self.assertEqual(code, 2)
        self.assertIn('FORBIDDEN', err)
        self.assertEqual(self.sql('SELECT url FROM workspace_links'), [])
        self.assertEqual(len(self.requests()), 1)

    def test_conflicting_real_write_is_refused_without_overwrite_or_retry(self):
        original = Store.command
        sent = []
        def raced(store, actor, envelope):
            if actor == 'agent-b' and envelope['kind'] == 'workspace.link_set':
                sent.append(copy.deepcopy(envelope))
                self.kept(title='Concurrent owner')
            return original(store, actor, envelope)
        with mock.patch.object(Store, 'command', raced):
            code, out, err = self.add('https://example.test/work', '--title', 'Stale agent')
        self.assertEqual(code, 2)
        self.assertIn('REVISION_CONFLICT', err)
        self.assertEqual(len(sent), 1)
        self.assertEqual((self.links()[0]['title'], self.links()[0]['revision']), ('Concurrent owner', 1))

    def test_lost_receipt_retries_original_operation_exactly_once(self):
        original = Store.command
        def uncertain(store, actor, envelope):
            result = original(store, actor, envelope)
            if actor == 'agent-b' and envelope['kind'] == 'workspace.link_set':
                self.assertEqual(result['status'], 'committed')
                raise StoreError('isolated lost receipt')
            return result
        with mock.patch.object(Store, 'command', uncertain):
            code, out, err = self.add()
        self.assertEqual(code, 1)
        [request] = self.requests()
        operation = request['command']['operation_id']
        self.assertIn('retry ' + operation, err)
        first = self.links()[0]
        code, out, err = self.run_cli('retry', operation, actor='agent-b')
        self.assertEqual((code, err), (0, ''), out)
        self.assertEqual(self.links(), [first])

    def test_failed_post_write_read_is_named_recorded_and_keeps_the_request(self):
        original = Store.view
        for n, failure in enumerate([StoreError('lost read'), {'error': {'code': 'DATABASE_BUSY', 'message': 'Busy', 'retryable': True}}]):
            with self.subTest(failure=n):
                calls = []
                def read(store, actor, name, args):
                    if actor == 'agent-b' and name == 'workspace_links':
                        calls.append(name)
                        if len(calls) == 2:
                            if isinstance(failure, Exception):
                                raise failure
                            return failure
                    return original(store, actor, name, args)
                with mock.patch.object(Store, 'view', read):
                    code, out, err = self.add('https://example.test/%d' % n)
                self.assertEqual(code, 1)
                self.assertIn('READ_BACK_UNCONFIRMED', err)
                self.assertIn('workspace.link_set', err)
                self.assertIn('do not send', err)
                self.assertEqual(len(self.links()), n + 1)
                self.assertEqual(len(self.requests()), n + 1)

    def test_readback_reports_a_later_real_value_instead_of_echoing_input(self):
        original = Store.command
        def later(store, actor, envelope):
            receipt = original(store, actor, envelope)
            if actor == 'agent-b' and envelope['kind'] == 'workspace.link_set':
                self.kept(title='Later durable title', revision=1)
            return receipt
        with mock.patch.object(Store, 'command', later):
            code, out, err = self.add('https://example.test/work', '--title', 'Submitted title')
        self.assertEqual((code, err), (0, ''), out)
        self.assertIn('Later durable title', out)
        self.assertNotIn('Submitted title', out)
        self.assertEqual(self.links()[0]['revision'], 2)

    def test_missing_post_write_row_is_unconfirmed_not_a_second_add(self):
        original = Store.view
        calls = []
        def absent(store, actor, name, args):
            answer = original(store, actor, name, args)
            if actor == 'agent-b' and name == 'workspace_links':
                calls.append(name)
                if len(calls) == 2:
                    return dict(answer, items=[], next_cursor=None)
            return answer
        with mock.patch.object(Store, 'view', absent):
            code, out, err = self.add()
        self.assertEqual(code, 1)
        self.assertIn('READ_BACK_UNCONFIRMED', err)
        self.assertIn('workspace.link_set', err)
        self.assertIn('do not send', err)
        self.assertEqual(len(self.links()), 1)
        self.assertEqual(len(self.requests()), 1)

    def test_missing_foreign_and_stale_capture_refuse_through_real_raw_cli(self):
        self.assertEqual(self.add()[0], 0)
        [request] = self.requests()
        before = self.links()
        for n, authority, expected in [(0, None, 'INVALID_ARGUMENT'),
                                      (1, dict(self.pin, authority_id='foreign-authority'), 'AUTHORITY_CHANGED'),
                                      (2, dict(self.pin, authority_epoch='retired-epoch'), 'AUTHORITY_CHANGED')]:
            envelope = copy.deepcopy(request['command'])
            envelope['operation_id'] = 'missing-or-foreign-capture-%d' % n
            envelope['expected']['link_revision'] = 1
            if authority is None:
                envelope['expected'].pop('authority')
            else:
                envelope['expected']['authority'] = authority
            envelope['args']['title'] = 'Must not replace'
            code, answer, err = self.invoke('command', envelope, actor='agent-b', binding=self.captured_for('agent-b'))
            self.assertEqual(code, 2, err)
            self.assertEqual(answer['error']['code'], expected)
            self.assertEqual(self.links(), before)

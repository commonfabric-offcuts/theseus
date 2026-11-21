from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest import mock

from aim_next.store import Store

import test_agent_verbs as verb_fixture
import test_hosted_read_boundary_662 as broker_fixture
import test_media as media_fixture
from test_wake_contract import own_cases


DATA = b'An exact scratch patch\n  spaces stay\n\x00\xff\n'


class PageSourceFixture:
    begin = media_fixture.MediaCase.begin
    publish = media_fixture.MediaCase.publish
    ready = media_fixture.MediaCase.ready
    read_all = media_fixture.MediaCase.read_all

    def prepare_page(self):
        self.media_id, self.page_id = 'media-page-970', 'n-page-970'
        self.ready(self.media_id, DATA, actor='agent-a')
        self.committed(self.memory(self.page_id, actor='agent-a', attachments=[{'id': self.media_id}]))
        self.output = Path(self.temp.name).resolve() / 'page-saved.bin'
        self.descriptor = dict(id=self.media_id, name='fixture.txt', content_type='text/plain',
                               size_bytes=len(DATA), sha256=hashlib.sha256(DATA).hexdigest(), inline=False)


@own_cases
class PageAttachment970Case(PageSourceFixture, verb_fixture.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.prepare_page()

    def save_page(self, *extra, page=None, actor='agent-a'):
        return self.run_cli(*extra, 'attachment', self.media_id, '--page', page or self.page_id,
                            '--out', str(self.output), actor=actor)

    def test_readable_page_saves_exact_verified_bytes(self):
        # The existing Core path is healthy before the missing CLI flag is tried.
        with self.store.open_media('agent-a', {'media_id': self.media_id,
                                             'source_ref': self.memory_ref(self.page_id, 1)}) as resource:
            self.assertEqual(self.read_all(resource), DATA)
        code, output, problem = self.save_page()
        self.assertEqual((code, problem), (0, ''))
        self.assertEqual(self.output.read_bytes(), DATA)
        self.assertIn('saved fixture.txt', output)

    def test_page_json_names_the_page_without_changing_the_descriptor(self):
        code, output, problem = self.save_page('--json')
        self.assertEqual((code, problem), (0, ''))
        self.assertEqual(json.loads(output), {'attachment': self.descriptor, 'page_id': self.page_id,
                                             'path': str(self.output)})
        self.assertEqual(self.output.read_bytes(), DATA)

    def test_an_unreadable_page_refuses_and_creates_no_output(self):
        code, output, problem = self.save_page('--json', actor='outsider')
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertFalse(self.output.exists())

    def test_only_the_current_pages_actual_attachments_authorize_the_read(self):
        other = 'n-other-970'
        self.committed(self.memory(other, actor='agent-a'))
        code, output, problem = self.save_page('--json', page=other)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertFalse(self.output.exists())
        self.committed(self.memory(self.page_id, actor='agent-a', revision=1, attachments=[]))
        code, output, problem = self.save_page('--json')
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertFalse(self.output.exists())
        with self.store.open_media('agent-a', {'media_id': self.media_id,
                                             'source_ref': self.memory_ref(self.page_id, 1)}) as resource:
            self.assertEqual(self.read_all(resource), DATA, 'Core history remains readable through its exact source')

    def test_a_page_never_overwrites_an_existing_file(self):
        self.output.write_bytes(b'Keep this earlier file')
        code, output, problem = self.save_page('--json')
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'OUT_EXISTS')
        self.assertEqual(self.output.read_bytes(), b'Keep this earlier file')

    def test_a_concurrent_revision_keeps_the_captured_exact_source_then_the_next_read_uses_the_new_one(self):
        open_media = Store.open_media
        captured = []

        def revised(store, actor, args):
            captured.append(dict(args['source_ref']))
            self.committed(self.memory(self.page_id, actor='agent-a', revision=1, attachments=[]))
            return open_media(store, actor, args)

        with mock.patch.object(Store, 'open_media', revised):
            code, output, problem = self.save_page('--json')
        self.assertEqual((code, problem), (0, ''))
        self.assertEqual(captured, [self.memory_ref(self.page_id, 1)])
        self.assertEqual(self.output.read_bytes(), DATA)
        second = self.output.with_name('new-current.bin')
        code, output, problem = self.run_cli('--json', 'attachment', self.media_id, '--page', self.page_id,
                                             '--out', str(second))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertFalse(second.exists())

    def test_exactly_one_source_selector_is_required_before_creating_a_file(self):
        for selectors in ([], ['--page', self.page_id, '--message', 'm-unused']):
            with self.subTest(selectors=selectors):
                code, output, problem = self.run_cli('attachment', self.media_id, *selectors,
                                                     '--out', str(self.output))
                self.assertEqual(code, 2)
                self.assertFalse(self.output.exists())

    def test_message_attachment_json_and_bytes_are_unchanged(self):
        message = self.committed(self.command('message.post', {
            'body': 'Message compatibility control', 'attachments': [{'id': self.media_id}],
            'divergence_reason': 'Separate scratch attachment control'},
            target={'topic_id': 't1'}, actor='agent-a'))['message_id']
        code, output, problem = self.run_cli('--json', 'attachment', self.media_id, '--message', message,
                                             '--out', str(self.output))
        self.assertEqual((code, problem), (0, ''))
        self.assertEqual(json.loads(output), {'attachment': self.descriptor, 'message_id': message,
                                             'path': str(self.output)})
        self.assertEqual(self.output.read_bytes(), DATA)

    def test_a_page_id_does_not_change_the_message_selectors_source_kind(self):
        code, output, problem = self.run_cli('--json', 'attachment', self.media_id, '--message', self.page_id,
                                             '--out', str(self.output))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertIn('No readable source', json.loads(output)['error']['message'])
        self.assertFalse(self.output.exists())


@own_cases
class BrokerPageAttachment970Case(PageSourceFixture, broker_fixture.HostedReadBoundary662Case):
    def test_the_actual_broker_reads_the_page_source_and_keeps_core_refusals(self):
        self.prepare_page()
        with mock.patch.object(self.bridge, '_execute', wraps=self.bridge._execute) as executed:
            code, output, problem = self.run_remote('--json', 'attachment', self.media_id, '--page', self.page_id,
                                                    '--out', str(self.output))
        self.assertEqual((code, problem), (0, ''))
        self.assertEqual(self.output.read_bytes(), DATA)
        self.assertEqual(json.loads(output)['page_id'], self.page_id)
        opened = [call.args[0]['args']['source_ref'] for call in executed.call_args_list
                  if call.args[0].get('method') == 'open_media']
        self.assertEqual(opened, [self.memory_ref(self.page_id, 1)])
        missing = self.output.with_name('must-not-exist.bin')
        code, output, problem = self.run_remote('--json', 'attachment', self.media_id, '--page', 'n-missing',
                                                '--out', str(missing))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'FORBIDDEN')
        self.assertFalse(missing.exists())

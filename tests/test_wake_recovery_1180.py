from __future__ import annotations

import io
import json
import sqlite3
import types
import unittest
from unittest import mock

from aim_next import effects_runner, hosted_notice, Store
from aim_next.delivery import _cursor
from aim_next.authority import AuthorityError
from aim_next.profile import ProfileError
import reader_fixture
import test_agent_verbs as cli_fixture


class WakeReadCase(reader_fixture.ReaderCase):
    def setUp(self):
        self.now = 1000
        clock = mock.patch('aim_next.delivery._now_ms', side_effect=lambda: self.now)
        clock.start(); self.addCleanup(clock.stop)
        super().setUp()
        self.guard = self.store.runner_guard('diagnostic-fixture')
        self.guard.__enter__(); self.addCleanup(self.guard.close)
        self.token = self.store.acquire_runner(self.guard)['runner_token']
        self.claim = self.store.claim_wakes(self.guard, self.token, ['agent-a'])['claims'][0]
        self.events = []
        self.loop = object.__new__(effects_runner.EffectsLoop)
        self.loop.store, self.loop.guard, self.loop.token = self.store, self.guard, self.token
        self.loop.profile = types.SimpleNamespace(instance_id='test-instance')
        self.loop.cleanup_uncertain = False
        self.loop.outstanding = self.claim
        self.loop.emit = self.events.append
        self.loop.storage_clock = lambda: 0
        self.loop.storage_sleep = lambda seconds: None
        self.loop.host = mock.Mock()
        self.loop.routes = {'agent-a': 'fixture-route'}

    def config(self, pages):
        pages = iter(pages)

        # The inbox pages (or the errors they raise) are the fixture's; the wake's other reads, such as its work
        # context, use the real store.
        def view(actor, name, args):
            if name != 'deliveries':
                return self.store.view(actor, name, args)
            page = next(pages)
            if isinstance(page, BaseException):
                raise page
            return page
        read = mock.Mock(side_effect=view)
        profile = types.SimpleNamespace(actor_id='agent-a', instance_id='test-instance',
                                        store=lambda: types.SimpleNamespace(view=read))
        return types.SimpleNamespace(profile=profile), read

    def agent(self):
        health = self.store.view('owner', 'health', {})
        self.assertNotIn('error', health, health)
        return next(row for row in health['agents'] if row['actor_id'] == 'agent-a')

    def dispatch(self, pages):
        config, read = self.config(pages)
        with mock.patch('aim_next.broker_routes.preflight_hosted', return_value=config):
            self.loop._dispatch_hosted(self.claim, 'fixture-route')
        return read

    def test_busy_refusal_is_on_real_attempt_and_no_delivery_was_accepted(self):
        self.dispatch([{'instance_id': 'test-instance', 'error': {'code': 'DATABASE_BUSY',
                      'message': 'secret body / token=credential', 'retryable': True}}])
        value = self.agent().get('wake_read', {})
        self.assertEqual(value.get('category'), 'core_refusal')
        self.assertEqual((value['code'], value['retryable'], value['page_index'], value['cursor']),
                         ('DATABASE_BUSY', True, 0, None))
        self.assertEqual((value['attempt_id'], value['actor_id'], value['state'], value['outcome']),
                         (self.claim['attempt_id'], 'agent-a', 'terminal', 'unavailable'))
        self.assertIn('Core was busy', value['why'])
        self.assertNotIn('secret', json.dumps(value)); self.assertNotIn('credential', json.dumps(value))
        self.assertIsNone(self.agent()['reached_ms'])
        self.loop.host.dispatch.assert_not_called()
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-a' AND state='pending'"), [(1,)])

    def test_second_page_failure_keeps_requested_canonical_cursor(self):
        pending = self.store.view('agent-a', 'deliveries', {})['items']
        cursor = _cursor(1, 10)
        self.dispatch([{'instance_id': 'test-instance', 'items': pending, 'next_cursor': cursor},
                       {'instance_id': 'test-instance', 'error': {'code': 'FORBIDDEN', 'message': 'private', 'retryable': False}}])
        value = self.agent().get('wake_read', {})
        self.assertEqual((value.get('category'), value.get('page_index'), value.get('cursor'), value.get('item_count')),
                         ('core_refusal', 1, cursor, 1))

    def test_multi_page_success_records_read_but_never_claims_wake_handoff(self):
        items = self.store.view('agent-a', 'deliveries', {})['items']
        cursor = _cursor(1, 10)
        self.dispatch([{'instance_id': 'test-instance', 'items': items, 'next_cursor': cursor},
                       {'instance_id': 'test-instance', 'items': [], 'next_cursor': None}])
        value = self.agent().get('wake_read', {})
        self.assertEqual((value.get('category'), value.get('page_index'), value.get('state'), value.get('outcome')),
                         ('complete', 1, 'pending_intent', None))
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'), [(0,)])
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_turns'), [(0,)])
        self.assertIsNone(self.agent()['reached_ms'])
        self.loop.host.dispatch.assert_called_once()

    def test_malformed_page_and_invalid_returned_cursor_never_log_payload(self):
        # One malformed cursor, despite a superficially valid page, is not an empty inbox.
        self.dispatch([{'instance_id': 'test-instance', 'items': [], 'next_cursor': 'token=credential'}])
        value = self.agent().get('wake_read', {})
        self.assertEqual(value.get('category'), 'malformed')
        self.assertIsNone(value['cursor'])
        self.assertNotIn('credential', json.dumps(value))
        self.assertEqual(value['outcome'], 'unavailable')

    def test_unknown_core_code_and_nonboolean_retryability_are_withheld(self):
        self.dispatch([{'instance_id': 'test-instance', 'error': {'code': 'CREDENTIAL_STRING', 'message': 'private', 'retryable': 'yes'}}])
        value = self.agent().get('wake_read', {})
        self.assertEqual(value.get('category'), 'core_refusal')
        self.assertIsNone(value['code']); self.assertIsNone(value['retryable'])
        self.assertNotIn('CREDENTIAL_STRING', json.dumps(value))

    def test_unrenderable_delivery_item_is_malformed_instead_of_read_success(self):
        self.dispatch([{'instance_id': 'test-instance', 'items': [{'secret': 'credential'}], 'next_cursor': None}])
        self.assertEqual(self.agent().get('wake_read', {}).get('category'), 'malformed')
        self.loop.host.dispatch.assert_not_called()

    def test_page_budget_is_partial_and_never_an_empty_inbox(self):
        items = self.store.view('agent-a', 'deliveries', {})['items']
        pages = [{'instance_id': 'test-instance', 'items': items, 'next_cursor': _cursor(1, index + 1)} for index in range(5)]
        self.dispatch(pages)
        value = self.agent().get('wake_read', {})
        self.assertEqual((value.get('category'), value.get('page_index'), value.get('item_count')), ('partial', 4, 5))
        self.assertIn('Possibly more: run inbox', self.loop.host.dispatch.call_args.args[2]['input'][0]['text'])

    def test_sparse_advancing_pages_keep_partial_work_distinct_from_empty_inbox(self):
        self.dispatch([{'instance_id': 'test-instance', 'items': [], 'next_cursor': _cursor(1, index + 1)} for index in range(5)])
        value = self.agent().get('wake_read', {})
        self.assertEqual((value.get('category'), value.get('page_index'), value.get('item_count')), ('partial', 4, 0))
        self.assertEqual(self.sql("SELECT failed_reason FROM wake_facts WHERE recipient_id='agent-a'"), [('deliveries_unavailable',)])
        self.loop.host.dispatch.assert_not_called()

    def test_binding_refusal_stops_without_host_or_settlement(self):
        with mock.patch.object(self.store, 'record_wake_read', wraps=self.store.record_wake_read) as recorded:
            with self.assertRaises(effects_runner.LoopFault) as caught:
                self.dispatch([{'instance_id': 'test-instance', 'error': {'code': 'INVALID_BINDING', 'message': 'binding refused', 'retryable': False}}])
        self.assertEqual([call.args[-1]['category'] for call in recorded.call_args_list], ['reading'],
                         'a binding refusal stops before any post-read diagnostic write')
        self.assertEqual(caught.exception.reason, 'route_binding_changed')
        self.assertEqual(caught.exception.refusal['error']['message'], 'binding refused')
        self.assertEqual(self.agent()['wake_read']['category'], 'reading')
        event = next(value for value in self.events if value['event'] == 'pending_read_failed')
        self.assertEqual(event['observation']['code'], 'INVALID_BINDING')
        self.loop.host.dispatch.assert_not_called()
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'), [(0,)])

    def test_raised_binding_refusal_keeps_exact_cause_and_performs_no_followup_write(self):
        refusal = AuthorityError('AUTHORITY_CHANGED', 'Original authority refusal')
        with mock.patch.object(self.store, 'record_wake_read', wraps=self.store.record_wake_read) as recorded:
            with self.assertRaises(effects_runner.LoopFault) as caught:
                self.dispatch([refusal])
        self.assertIs(caught.exception.__cause__, refusal)
        self.assertEqual([call.args[-1]['category'] for call in recorded.call_args_list], ['reading'])
        self.assertEqual(self.agent()['wake_read']['category'], 'reading')
        event = next(value for value in self.events if value['event'] == 'pending_read_failed')
        self.assertEqual(event['observation']['code'], 'AUTHORITY_CHANGED')

    def test_clean_transport_failure_is_persisted_without_claiming_wake_delivery(self):
        with self.assertRaises(effects_runner.LoopFault):
            self.dispatch([ProfileError('Unavailable fixture transport')])
        self.assertFalse(self.loop.cleanup_uncertain)
        value = self.agent()['wake_read']
        self.assertEqual((value['category'], value['state'], value['outcome']), ('transport_failure', 'pending_intent', None))
        self.assertIsNone(self.agent()['reached_ms'])

    def test_transport_failure_with_uncertain_cleanup_does_not_open_another_handle(self):
        with self.assertRaises(effects_runner.LoopFault):
            self.dispatch([OSError('secret token')])
        self.assertTrue(self.loop.cleanup_uncertain)
        events = [event for event in self.events if event['event'] == 'pending_read_failed']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['observation']['category'], 'transport_failure')
        self.assertEqual(events[0]['attempt_id'], self.claim['attempt_id'])
        self.assertNotIn('secret', json.dumps(events))
        self.assertEqual(self.agent()['wake_read']['category'], 'reading')
        self.now = self.claim['lease_until_ms'] + 1
        self.assertEqual(self.agent()['wake_read']['state'], 'unknown')

    def test_stale_claim_cannot_replace_latest_observation(self):
        self.assertTrue(hasattr(self.store, 'record_wake_read'), 'Core must own wake observations')
        self.dispatch([{'instance_id': 'test-instance', 'items': [], 'next_cursor': None}])
        prior = self.agent()['wake_read']
        result = self.store.record_wake_read(self.guard, self.token, self.claim['claim_token'],
                   dict(v=1, category='malformed', page_index=0, cursor=None, item_count=0, code=None, retryable=None))
        self.assertEqual(result['status'], 'stale')
        self.assertEqual(self.agent()['wake_read'], prior)


class AnswerCase(reader_fixture.ReaderCase):
    def setUp(self):
        super().setUp()
        self.participation('agent-b', True)
        self.opening = self.send('Work shared with two isolated agents')

    def answer(self, actor='agent-a', body='Completed fixture work', op=None):
        result = self.command('message.post', {'reply_to': self.opening['id'], 'body': body,
                    'reply_without_quote': 'Fixture answer to the complete source'}, target={'topic_id': 't1'}, actor=actor, op=op)
        return self.committed(result)['message_id']

    def pending(self, actor='agent-a'):
        return next(item for item in self.store.view(actor, 'deliveries', {})['items']
                    if item.get('message_id') == self.opening['id'])

    def test_answer_redelivery_names_existing_answer_and_does_not_acknowledge_it(self):
        answer = self.answer()
        item = self.pending()
        recovered = item.get('answer_recovery', {})
        self.assertEqual(recovered.get('state'), 'answered')
        self.assertEqual((recovered['message_id'], recovered['source_revision']), (answer, 1))
        notice = hosted_notice.notice([item], None, 'agent-a', 'a-fixture')
        words = notice['input'][0]['text']
        self.assertIn('already has your answer ' + answer, words)
        self.assertIn('does not request another answer', words)
        self.assertIn('Read: aim-next read t1 --after %d' % (recovered['seq'] - 1), words)
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE id=?', (item['id'],)), [('pending',)])
        later = self.answer(body='Deliberate follow-up')
        self.assertEqual(self.pending()['answer_recovery']['message_id'], later)
        self.assertNotEqual(answer, later)

    def test_edit_does_not_rebind_an_old_answer_to_new_source_revision(self):
        self.answer()
        self.committed(self.command('message.edit', {'body': 'Changed source'}, target={'message_id': self.opening['id']},
                                    expected={'message_revision': 1}))
        item = self.pending()
        self.assertEqual(item['message']['revision'], 2)
        self.assertEqual(item.get('answer_recovery', {}).get('state'), 'unknown')
        words = hosted_notice.notice([item], None, 'agent-a', 'a-fixture')['input'][0]['text']
        self.assertNotIn('already has your answer', words)

    def test_two_answerers_have_separate_keys_and_unknown_is_not_unanswered(self):
        self.answer()
        self.assertEqual(self.pending('agent-b').get('answer_recovery', {}).get('state'), 'unknown')
        second = self.answer(actor='agent-b')
        self.assertEqual(self.pending('agent-b')['answer_recovery']['message_id'], second)
        self.assertNotEqual(self.pending()['answer_recovery']['message_id'], second)

    def test_legacy_missing_key_is_unknown_but_original_operation_still_proves_answer(self):
        answer = self.answer(op='old-answer')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM metadata WHERE key LIKE 'source_answer.v1:%'")
        value = self.pending().get('answer_recovery', {})
        self.assertEqual((value.get('state'), value.get('coverage')), ('unknown', 'exact_key_only'))
        outcome = self.store.view('agent-a', 'operation', {'operation_id': 'old-answer'})
        self.assertEqual(outcome['result']['message_id'], answer)
        self.assertEqual(outcome['result']['reply_basis']['source']['revision'], 1)

    def test_held_source_is_not_returned_as_readable_recovery_work(self):
        self.answer()
        self.committed(self.command('message.edit_open', {'holder': 'fixture-holder'},
                                    target={'message_id': self.opening['id']}))
        source = self.store.view('agent-a', 'source', {'source_ref': {'kind': 'message', 'id': self.opening['id']}})
        self.assertTrue(source['withheld'])
        items = self.store.view('agent-a', 'deliveries', {})['items']
        for item in items:
            if item.get('message_id') == self.opening['id']:
                self.assertEqual(item.get('answer_recovery', {}).get('state'), 'unknown')
                self.assertNotIn('message_id', item['answer_recovery'])

    def test_partial_conversation_reply_does_not_become_a_completed_answer_hint(self):
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        source = self.committed(self.command('message.post', {'body': 'Two pieces of fixture work'}, target={'topic_id': topic}))['message_id']
        args = {'body': 'First part only', 'part': True, 'reply_to': source, 'reply_without_quote': 'Fixture progress'}
        self.committed(self.command('message.post', args, target={'topic_id': topic}, actor='agent-a'))
        item = next(value for value in self.store.view('agent-a', 'deliveries', {})['items'] if value.get('message_id') == source)
        self.assertEqual(item['answer_recovery']['state'], 'unknown')
        page = self.store.view('agent-a', 'topic_messages', {'topic_id': topic, 'message_ids': [source]})
        self.assertEqual(page['items'][0]['item']['state'], 'new')
        args.update(body='Remaining work completed', part=False)
        answer = self.committed(self.command('message.post', args, target={'topic_id': topic}, actor='agent-a'))['message_id']
        item = next(value for value in self.store.view('agent-a', 'deliveries', {})['items'] if value.get('message_id') == source)
        self.assertEqual(item['answer_recovery']['message_id'], answer)

    def test_private_existing_answer_keeps_its_privacy_instruction_and_access(self):
        source = self.committed(self.command('message.post', {'body': 'Private fixture source', 'addressees': ['agent-a'], 'whisper': True}, target={'topic_id': 't1'}))['message_id']
        answer = self.committed(self.command('message.post', {'body': 'Private fixture answer', 'addressees': ['owner'], 'whisper': True,
                     'reply_to': source, 'reply_without_quote': 'Private fixture reply'}, target={'topic_id': 't1'}, actor='agent-a'))['message_id']
        item = next(value for value in self.store.view('agent-a', 'deliveries', {})['items'] if value.get('message_id') == source)
        self.assertEqual(item['answer_recovery']['message_id'], answer)
        words = hosted_notice.notice([item], None, 'agent-a', 'a-fixture')['input'][0]['text']
        self.assertIn('whisper', words)
        self.assertIn('private', words)
        hidden = self.store.view('agent-b', 'source', {'source_ref': {'kind': 'message', 'id': answer}})
        self.assertEqual(hidden['error']['code'], 'FORBIDDEN')


class RecoveryCLICase(cli_fixture.AgentVerbCase):
    def saved_post(self):
        code, output, error = self.run_cli('reply', self.opening['id'], '--tells', 'owner',
                                            '--without-quote', 'Fixture request', 'Original exact work')
        self.assertEqual((code, error), (0, ''))
        path = next(self.outbox().glob('*.request.json'))
        return path.name[:-len('.request.json')], json.loads(path.read_text())

    def test_existing_retry_checks_recorded_result_without_reentering_command(self):
        operation, request = self.saved_post()
        (self.outbox() / (operation + '.receipt.json')).unlink()
        entered, original = [], Store.command
        def send(store, actor, envelope):
            entered.append(envelope)
            return original(store, actor, envelope)
        with mock.patch.object(Store, 'command', send):
            self.assertEqual(self.run_cli('retry', operation)[0], 0)
        self.assertEqual(entered, [], 'a committed operation must be read before retrying any work')

    def test_lost_committed_reply_reconciles_before_retry_without_another_send(self):
        operation, request = self.saved_post()
        (self.outbox() / (operation + '.receipt.json')).unlink()
        before = self.sql('SELECT count(*) FROM messages')
        with mock.patch.object(Store, 'command', side_effect=AssertionError('must not send a committed request')):
            code, output, error = self.run_cli('--json', 'reconcile', operation)
            self.assertEqual((code, error), (0, ''))
            self.assertEqual(json.loads(output)['recovery_state'], 'committed_unseen')
            self.assertEqual(self.run_cli('retry', operation)[0], 0)
            code, output, error = self.run_cli('--json', 'reconcile', operation)
            self.assertEqual(json.loads(output)['recovery_state'], 'terminal')
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), before)
        self.assertEqual(json.loads((self.outbox() / (operation + '.request.json')).read_text()), request)

    def test_refused_reconciliation_never_replays_original_saved_request(self):
        operation, request = self.saved_post()
        original = Store.view
        def view(store, actor, name, args):
            if name == 'operation':
                return {'instance_id': 'test-instance', 'error': {'code': 'INVALID_BINDING', 'message': 'Original refusal', 'retryable': False}}
            return original(store, actor, name, args)
        with mock.patch.object(Store, 'view', view), mock.patch.object(Store, 'command', side_effect=AssertionError('must not replay')):
            code, output, error = self.run_cli('--json', 'retry', operation)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['message'], 'Original refusal')
        self.assertEqual(json.loads((self.outbox() / (operation + '.request.json')).read_text()), request)

    def test_changed_saved_payload_cannot_reuse_a_committed_operation_result(self):
        operation, request = self.saved_post()
        request['command']['args']['body'] = 'Different work under the same ID'
        (self.outbox() / (operation + '.request.json')).write_text(json.dumps(request))
        with mock.patch.object(Store, 'command', side_effect=AssertionError('must not send')):
            code, output, error = self.run_cli('--json', 'retry', operation)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)['error']['code'], 'OPERATION_PAYLOAD_MISMATCH')

    def test_recorded_refusal_is_a_terminal_result_not_missing_work(self):
        code, output, error = self.run_cli('post', 't1', '--tells', 'outsider',
            '--divergence-reason', 'Isolated refusal fixture', 'Nobody can reply')
        self.assertEqual(code, 2)
        path = next(self.outbox().glob('*.request.json'))
        operation = json.loads(path.read_text())['command']['operation_id']
        code, output, error = self.run_cli('--json', 'reconcile', operation)
        self.assertEqual((code, error), (0, ''))
        value = json.loads(output)
        self.assertEqual(value['recovery_state'], 'terminal')
        self.assertEqual(value['result']['status'], 'rejected')

    def test_pending_intent_sends_only_exact_saved_request_after_bound_lookup(self):
        with mock.patch.object(Store, 'command', side_effect=OSError('transport ended before answer')):
            self.run_cli('reply', self.opening['id'], '--tells', 'owner', '--without-quote', 'Fixture request', 'Exact pending work')
        path = next(self.outbox().glob('*.request.json'))
        request = json.loads(path.read_text()); operation = request['command']['operation_id']
        code, output, error = self.run_cli('--json', 'reconcile', operation)
        self.assertEqual((code, error), (0, ''))
        self.assertEqual(json.loads(output)['recovery_state'], 'pending_intent')
        sent, original = [], Store.command
        def send(store, actor, envelope):
            sent.append(envelope)
            return original(store, actor, envelope)
        with mock.patch.object(Store, 'command', send):
            self.assertEqual(self.run_cli('retry', operation)[0], 0)
        self.assertEqual(sent, [request['command']])

    def test_malformed_reconciliation_cannot_overwrite_receipt_or_send_request(self):
        operation, request = self.saved_post()
        receipt = self.outbox() / (operation + '.receipt.json'); before = receipt.read_bytes()
        real_view = Store.view
        variants = [dict(instance_id='test-instance', operation_id=operation, recorded=True),
                    dict(instance_id='test-instance', operation_id=operation, recorded=True, kind='wrong', status='committed', result={}, affected=[]),
                    dict(instance_id='test-instance', operation_id=operation, recorded=False, status='unknown', error=[])]
        for value in variants:
            with self.subTest(shape=value):
                def view(store, actor, name, args):
                    return value if name == 'operation' else real_view(store, actor, name, args)
                with mock.patch.object(Store, 'view', view), mock.patch.object(Store, 'command', side_effect=AssertionError('must not send')):
                    code, output, error = self.run_cli('--json', 'retry', operation)
                self.assertEqual(code, 2)
                self.assertEqual(json.loads(output)['error']['code'], 'RECOVERY_UNKNOWN')
                self.assertEqual(receipt.read_bytes(), before)
                self.assertEqual(json.loads((self.outbox() / (operation + '.request.json')).read_text()), request)


if __name__ == '__main__':
    unittest.main()

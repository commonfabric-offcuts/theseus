from __future__ import annotations

import json
from unittest import mock

from aim_next import Store
import reader_fixture as fixtures
import test_message_removal_151 as removal_fixture
import test_message_edit as edit_fixture


class RecoveryCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    source_view = removal_fixture.RemovalCase.source_view
    member = edit_fixture.EditCase.member

    def clear(self):
        for identity, actor in self.sql("SELECT id,recipient_id FROM deliveries WHERE state='pending'"):
            self.committed(self.command('delivery.ack', target={'delivery_id': identity}, actor=actor))

    def retraction(self, actor='agent-b'):
        message = self.post(addressees=['agent-a'])
        self.source_view(message, actor)
        self.committed(self.remove(message, 'retract'))
        identity, seq = self.sql('SELECT id,seq FROM deliveries WHERE retraction_id=? AND recipient_id=?', (message, actor))[0]
        return message, identity, seq

    def test_lost_access_settles_retraction_without_count_wake_or_preview(self):
        self.clear()
        message, identity, seq = self.retraction()
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-b'"), [(1,)])
        self.member('agent-b', False)
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE id=?', (identity,)), [('acknowledged',)])
        self.assertEqual(self.sql("SELECT pending_count,next_due_ms FROM recipient_schedule WHERE recipient_id='agent-b'"), [(0, None)])
        self.assertEqual(self.store.view('agent-b', 'delivery', {'delivery_id': identity})['error']['code'], 'FORBIDDEN')
        self.assertNotIn(identity, json.dumps(self.store.view('agent-b', 'deliveries', {})))

    def test_claim_settles_retraction_when_access_was_lost_without_settlement(self):
        self.clear()
        message, identity, seq = self.retraction()
        self.sql("DELETE FROM workspace_members WHERE actor_id='agent-b'")
        with self.store.runner_guard('removal151-access') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.assertEqual(self.store.claim_wakes(guard, token, ['agent-b'])['claims'], [])
            self.assertEqual(self.sql('SELECT state FROM deliveries WHERE id=?', (identity,)), [('acknowledged',)])
            self.assertEqual(self.store.runner_schedule(['agent-b'])['next_due_ms'], None)

    def test_failed_route_restart_and_stale_claim_preserve_one_notice_and_normal_ack(self):
        self.clear()
        now = [2000000000000]
        with mock.patch('aim_next.delivery._now_ms', side_effect=lambda: now[0]):
            message, identity, seq = self.retraction()
            item = self.store.view('agent-b', 'delivery', {'delivery_id': identity})['item']
            with self.store.runner_guard('removal151-route') as guard:
                token = self.store.acquire_runner(guard)['runner_token']
                [claim] = self.store.claim_wakes(guard, token, ['agent-b'])['claims']
                self.assertEqual(claim['captured_seq'], seq)
                self.assertNotIn('Removal fixture exact words', json.dumps(claim))
                result = self.store.finish_wake(guard, token, claim['claim_token'], 'unavailable', reason='route_unavailable')
                self.assertEqual(result['status'], 'settled')
                self.assertGreater(result['next_due_ms'], now[0]); now[0] = result['next_due_ms']
            self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
            with self.store.runner_guard('removal151-restart') as guard:
                token = self.store.acquire_runner(guard)['runner_token']
                [retry] = self.store.claim_wakes(guard, token, ['agent-b'])['claims']
                self.assertEqual(retry['captured_seq'], seq)
                self.assertNotEqual(retry['attempt_id'], claim['attempt_id'])
                self.assertEqual(self.store.finish_wake(guard, token, claim['claim_token'], 'accepted')['status'], 'stale')
                self.assertEqual(self.store.view('agent-b', 'delivery', {'delivery_id': identity})['item'], item)
                self.committed(self.command('delivery.ack', target={'delivery_id': identity}, actor='agent-b'))
                self.assertEqual(self.store.finish_wake(guard, token, retry['claim_token'], 'accepted')['status'], 'settled')
                self.assertIsNone(self.store.runner_schedule(['agent-b'])['next_due_ms'])

    def test_retracted_held_message_never_releases_after_close_lapse_or_retry(self):
        message = self.post()
        self.committed(self.command('message.edit_open', {'holder': 'second-device'}, target={'message_id': message}))
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE message_id=?', (message,)), [('held',)])
        self.rejected(self.remove(message), 'MESSAGE_SEEN')
        receipt = self.remove(message, 'retract', op='terminal-held')
        self.committed(receipt)
        self.rejected(self.command('message.edit_close', {'holder': 'second-device'}, target={'message_id': message}), 'MESSAGE_REMOVED')
        with mock.patch('aim_next.delivery._now_ms', return_value=2000000000000):
            with self.store.runner_guard('removal151-lapse') as guard:
                token = self.store.acquire_runner(guard)['runner_token']
                self.store.claim_wakes(guard, token, ['agent-a'])
        self.assertEqual(self.remove(message, 'retract', op='terminal-held'), receipt)
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE message_id=?', (message,)), [('cancelled',)])

    def test_unsend_cancels_only_its_typed_request_without_erasing_history(self):
        roots, requests = [], []
        for words in ('First root', 'Second root'):
            root = self.post(body=words)
            roots.append(root)
            self.committed(self.command('stack.cover', {'stands': 'Fixture facts'}, target={'message_id': root}, expected={'cover_revision': 0}, actor='agent-b'))
            result = self.committed(self.command('stack.cover_refresh', target={'message_id': root}, expected={'cover_revision': 1}))
            requests.append(result['refresh']['request_id'])
        self.committed(self.remove(roots[0]))
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE request_id=?', (requests[0],)), [('cancelled',)])
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE request_id=?', (requests[1],)), [('pending',)])
        self.assertEqual(self.sql('SELECT count(*) FROM refresh_requests WHERE id IN (?,?)', tuple(requests)), [(2,)])
        listing = self.store.view('agent-b', 'deliveries', {'limit': 100})
        self.assertNotIn(requests[0], json.dumps(listing))
        self.assertIn(requests[1], json.dumps(listing))

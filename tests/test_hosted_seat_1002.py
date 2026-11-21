from __future__ import annotations

import concurrent.futures
import json
import sqlite3
import unittest

import test_store as fixture


class HostedSeatCore(unittest.TestCase):
    setUp_store = fixture.StoreCase.setUp
    command = fixture.StoreCase.command
    workspace = fixture.StoreCase.workspace
    sql = fixture.StoreCase.sql

    def setUp(self):
        self.setUp_store()
        self.workspace()

    def add(self, name='Release scribe', role='Keep exact release evidence.\nAsk before changing scope.',
            actor='owner', op=None, revision=None):
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        return self.command('workspace.hosted_seat_add', {'name': name, 'role': role}, {'workspace_id': 'w1'},
                            {'workspace_revision': version if revision is None else revision}, actor, op)

    def added(self, **kwargs):
        answer = self.add(**kwargs)
        self.assertEqual(answer.get('status'), 'committed', answer)
        return answer['result']

    def test_one_recorded_act_invites_with_exact_role_and_waits_for_host(self):
        role = 'Read Δ evidence.\n\nRetain trailing spaces.  '
        result = self.added(role=role)
        self.assertEqual(result['agent'], {'id': 'release-scribe', 'name': 'Release scribe', 'kind': 'agent'})
        state = self.store.view('owner', 'hosted_seat', {'workspace_id': 'w1', 'seat_request_id': result['seat_request_id']})['seat']
        self.assertEqual((state['state'], state['stage'], state['role']), ('pending', 'profile', role))
        self.assertEqual(self.sql('SELECT owner_id FROM hosted_seats'), [('owner',)])
        self.assertIn(('w1', 'release-scribe'), self.sql('SELECT * FROM workspace_members'))
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)], 'no invented hello or early first task')
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"), [(0,)])

    def test_retry_same_operation_and_reload_same_name_keep_one_request(self):
        before = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        first = self.add(op='same-add', revision=before)
        retry = self.add(op='same-add', revision=before)
        self.assertEqual(first, retry)
        self.assertEqual(first.get('status'), 'committed', first)
        new_request = self.add(op='after-reload')
        self.assertEqual(new_request.get('status'), 'committed', new_request)
        self.assertEqual(new_request['result']['seat_request_id'], first['result']['seat_request_id'])
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM actors WHERE id='release-scribe'"), [(1,)])

    def test_concurrent_same_name_has_one_seat(self):
        revision = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        self.serial += 1
        envelope = {'v': 1, 'instance_id': 'test-instance', 'operation_id': 'concurrent-add',
                    'kind': 'workspace.hosted_seat_add', 'target': {'workspace_id': 'w1'},
                    'expected': {'authority': self.pin, 'workspace_revision': revision},
                    'args': {'name': 'Scribe', 'role': 'Keep evidence.'}}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.store.command('owner', envelope), range(2)))
        self.assertEqual(receipts[0], receipts[1])
        self.assertEqual(receipts[0].get('status'), 'committed', receipts)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])

    def test_member_cannot_add_and_coordinator_keeps_human_control_owner(self):
        denied = self.add(actor='agent-b')
        self.assertEqual(denied.get('error', {}).get('code'), 'FORBIDDEN', denied)
        self.assertEqual(self.sql('SELECT count(*) FROM actors'), [(3,)])
        self.added(actor='agent-a')
        self.assertEqual(self.sql('SELECT inviter_id,owner_id FROM hosted_seats'), [('agent-a', 'owner')])

    def test_role_change_cannot_adopt_a_pending_or_existing_seat(self):
        original = self.added()
        mismatch = self.add(role='A different role')
        self.assertEqual(mismatch.get('error', {}).get('code'), 'SEAT_ROLE_MISMATCH', mismatch)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])
        state = self.store.view('owner', 'hosted_seat', {'workspace_id': 'w1', 'seat_request_id': original['seat_request_id']})['seat']
        self.assertEqual(state['role'], 'Keep exact release evidence.\nAsk before changing scope.')

    def test_manual_invitation_is_not_silently_adopted_as_a_hosted_thread(self):
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        manual = self.command('workspace.agent_invite', {'name': 'Release scribe', 'harness': 'codex'},
                              {'workspace_id': 'w1'}, {'workspace_revision': version})
        self.assertEqual(manual.get('status'), 'committed', manual)
        collision = self.add()
        self.assertEqual(collision.get('error', {}).get('code'), 'NAME_TAKEN', collision)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(0,)])

    def test_name_validation_and_role_byte_limit_are_recorded_without_partial_actor(self):
        for name, role, code in [('', 'Work', 'NAME_REQUIRED'), ('Seat', '', 'ROLE_REQUIRED'),
                                 ('Seat', 'Δ' * 8193, 'ROLE_TOO_LONG')]:
            with self.subTest(code=code):
                denied = self.add(name=name, role=role)
                self.assertEqual(denied.get('error', {}).get('code'), code, denied)
                self.assertTrue(denied.get('recorded'), denied)
        self.assertEqual(self.sql('SELECT count(*) FROM actors'), [(3,)])
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(0,)])

    def test_workspace_scoped_read_cannot_reveal_another_outcomes_role(self):
        result = self.added(role='Private outcome role')
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Outside')")
        answer = self.store.view('outsider', 'hosted_seat', {'workspace_id': 'w1', 'seat_request_id': result['seat_request_id']})
        self.assertEqual(answer.get('error', {}).get('code'), 'FORBIDDEN', answer)
        self.assertNotIn('Private outcome role', json.dumps(answer))

    def test_changed_retry_keeps_the_original_receipt(self):
        before = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        original = self.add(op='exact-add', revision=before)
        changed = self.add(role='Changed', op='exact-add', revision=before)
        self.assertEqual(changed.get('error', {}).get('code'), 'OPERATION_PAYLOAD_MISMATCH', changed)
        self.assertEqual(self.store.view('owner', 'operation', {'operation_id': 'exact-add'}), original)

    def claim(self, guard, token):
        result = self.store.hosted_seat_claim(guard, token)
        self.assertEqual(result.get('status'), 'ok', result)
        return result['seat']

    def step(self, guard, token, seat, stage, details=None):
        result = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], stage, details)
        self.assertEqual(result.get('status'), 'ok', result)
        return result['seat']

    def plan(self):
        return {'codex_home': str(self.path.parent.resolve() / 'native-home')}

    def to_stage(self, guard, token, stage):
        seat = self.claim(guard, token)
        if seat['plan'] is None:
            seat = self.step(guard, token, seat, 'profile', {'plan': self.plan()})
        stages = ['thread', 'starting', 'persist', 'persisting', 'pin', 'route', 'delivery', 'ready']
        for next_stage in stages:
            if seat['stage'] == stage:
                return seat
            details = {'thread_id': '12345678-1234-4234-8234-000000000001'} if next_stage == 'persist' else None
            seat = self.step(guard, token, seat, next_stage, details)
        return seat

    def test_ready_atomically_pins_human_control_and_delivers_one_inviter_task(self):
        result = self.added(actor='agent-a')
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            ready = self.to_stage(guard, token, 'ready')
            self.assertEqual(ready['state'], 'ready', ready)
            self.assertIsNone(self.claim(guard, token))
        pin = json.loads(self.sql("SELECT value FROM metadata WHERE key LIKE 'route_pin.v1:%'")[0][0])
        self.assertEqual(set(pin['binding']), {'instance_id', 'actor_id', 'db_path', 'authority_id', 'authority_epoch'})
        self.assertEqual(pin['binding']['actor_id'], 'release-scribe')
        self.assertEqual(pin['destination']['thread_id'], ready['thread_id'])
        control = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_control.v1:release-scribe'")[0][0])
        self.assertEqual(control['owner_id'], 'owner', 'the inviting agent never owns Stop/Continue')
        self.assertEqual(self.sql('SELECT author_id FROM messages'), [('agent-a',)], 'a task, never an invented seat hello')
        self.assertEqual(self.sql('SELECT first_message_id FROM hosted_seats'), [(ready['first_message_id'],)])
        source = self.store.view('release-scribe', 'source', {'kind': 'message', 'id': ready['first_message_id']})
        self.assertIn('Keep exact release evidence.', source['body'])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='release-scribe'"), [(1,)])
        original = self.add(actor='agent-a')
        self.assertEqual(original['result']['seat_request_id'], result['seat_request_id'])
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(1,)])

    def test_starting_and_persisting_are_refused_after_restart_without_repeating_the_rpc(self):
        for stage, reason in [('starting', 'thread_start_uncertain'), ('persisting', 'thread_persistence_uncertain')]:
            with self.subTest(stage=stage):
                # Separate name for each retained request; no fixture record deletion.
                self.added(name=stage)
                with self.store.runner_guard('host') as guard:
                    token = self.store.acquire_runner(guard)['runner_token']
                    before = self.to_stage(guard, token, stage)
                    self.store.stop_runner(guard, token)
                with self.store.runner_guard('host') as guard:
                    successor = self.store.acquire_runner(guard)['runner_token']
                    refused = self.claim(guard, successor)
                    self.assertEqual((refused['state'], refused['stage'], refused['reason']), ('refused', stage, reason))
                    self.assertEqual(refused['thread_id'], before['thread_id'], 'retain a known orphan identity')
                    self.assertIsNone(self.claim(guard, successor))
                    self.store.stop_runner(guard, successor)
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)])

    def test_completed_native_identity_resumes_at_pin_without_starting_another_thread(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            before = self.to_stage(guard, token, 'pin')
            self.store.stop_runner(guard, token)
        with self.store.runner_guard('host') as guard:
            successor = self.store.acquire_runner(guard)['runner_token']
            after = self.claim(guard, successor)
            self.assertEqual((after['stage'], after['thread_id']), ('pin', before['thread_id']))
            self.assertEqual(after['state'], 'preparing')
            self.assertNotEqual(after['runner_token'], token)
            lost = self.store.hosted_seat_step(guard, token, after['id'], after['version'], 'route')
            self.assertEqual(lost['status'], 'lost')
            self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"), [(0,)])
            after = self.step(guard, successor, after, 'route')
            self.assertEqual(after['thread_id'], before['thread_id'])

    def test_conflicting_pin_is_retained_and_does_not_poison_other_host_work(self):
        self.added()
        home = self.path.parent.resolve() / 'native-home'
        home.mkdir(mode=0o700)
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.to_stage(guard, token, 'pin')
            destination = {'kind': 'codex-hosted-stdio', 'protocol_version': 1, 'codex_home': str(home),
                           'thread_id': '12345678-1234-4234-8234-000000000099'}
            self.store.provision_route_pin(guard, 'release-scribe', destination, owner_id='owner')
            before = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'route_pin.v1:%'")
            failed = self.step(guard, token, seat, 'route')
            self.assertEqual((failed['state'], failed['stage'], failed['reason']), ('refused', 'pin', 'pin_conflict'))
            self.assertEqual(self.sql("SELECT key,value FROM metadata WHERE key LIKE 'route_pin.v1:%'"), before)
            self.assertEqual(self.store.renew_runner(guard, token)['status'], 'renewed')
        self.assertEqual(self.sql('SELECT reason FROM hosted_seat_events ORDER BY version DESC LIMIT 1'), [('pin_conflict',)])

    def test_revoked_inviter_cannot_start_and_late_membership_loss_cannot_send(self):
        self.added(actor='agent-a')
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.to_stage(guard, token, 'delivery')
            self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='release-scribe'")
            denied = self.step(guard, token, seat, 'ready')
            self.assertEqual((denied['state'], denied['reason']), ('refused', 'access_changed'))
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)])

    def test_identity_role_and_native_thread_are_write_once_in_storage(self):
        self.added()
        with self.store.runner_guard('host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.to_stage(guard, token, 'pin')
        for column, value in [('role', 'Changed'), ('thread_id', '12345678-1234-4234-8234-000000000099'), ('owner_id', 'agent-a')]:
            with self.subTest(column=column), self.assertRaises(sqlite3.IntegrityError):
                self.sql('UPDATE hosted_seats SET ' + column + '=?', (value,))

    def test_scoped_paging_returns_a_seat_once_and_never_host_paths(self):
        ids = {self.added(name='Seat ' + str(index))['seat_request_id'] for index in range(3)}
        got, cursor = set(), None
        while True:
            page = self.store.view('owner', 'hosted_seats', {'workspace_id': 'w1', 'limit': 1, **({'cursor': cursor} if cursor else {})})
            self.assertNotIn('error', page, page)
            self.assertEqual(len(page['items']), 1)
            self.assertNotIn('plan', page['items'][0])
            self.assertNotIn('runner_token', page['items'][0])
            got.add(page['items'][0]['id'])
            cursor = page['next_cursor']
            if cursor is None:
                break
        self.assertEqual(got, ids)


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from pathlib import Path
import subprocess
import unittest
import uuid

from aim_next import Store
from aim_next.hosted_recovery import REASON
from aim_next.profile import write_profile
from aim_next.route_pins import RoutePinError
import test_runner as fixtures
import test_codex_host as host_fixture


def retain_case(case, root):
    target = os.environ.get('THESEUS_RECOVERY_EVIDENCE')
    if not target:
        return
    destination = Path(target) / case.id()
    def copy():
        destination.mkdir(parents=True, exist_ok=False)
        for source in root.rglob('*'):
            if source.is_file() and not source.is_symlink() and not any(
                    part in ('__pycache__', 'runner-pycache', 'cli-pycache', 'provision-pycache', 'direct-cli-pycache')
                    for part in source.relative_to(root).parts):
                out = destination / source.relative_to(root)
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(str(source), str(out))
    case.addCleanup(copy)


class RecoveryCase(unittest.TestCase):
    # Reuse scratch creation and ordinary delivery commands, not their tests.
    from test_store import StoreCase
    from test_delivery import DeliveryCase
    for _name in ('command', 'create_topic', 'sql', 'prepare', 'workspace', 'save_draft'):
        locals()[_name] = getattr(StoreCase, _name)
    for _name in ('pending', 'send_next', 'ack'):
        locals()[_name] = getattr(DeliveryCase, _name)
    guard = fixtures.RunnerCase.guard
    token = fixtures.RunnerCase.token
    everyone = fixtures.RunnerCase.everyone
    claim = fixtures.RunnerCase.claim

    def setUp(self):
        # RunnerCase.setUp uses super(), so call the fixture's own base first.
        from unittest import mock
        self.StoreCase.setUp(self)
        retain_case(self, self.path.parent)
        self.now = 1000
        patch = mock.patch('aim_next.delivery._now_ms', side_effect=lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        self.create_topic()
        self.home = self.path.parent / 'hosted-home'
        self.home.mkdir()
        self.dest = dict(kind='codex-hosted-stdio', protocol_version=1,
                         codex_home=str(self.home), thread_id=str(uuid.uuid4()))
        self.g = self.guard()
        self.dest = self.store.provision_route_pin(self.g, 'agent-a', self.dest, owner_id='owner')['pin']['destination']
        self.t = self.token(self.g)

    def recovery(self, action='read', **values):
        method = getattr(self.store, 'hosted_recovery', None)
        self.assertTrue(callable(method), 'guard-held same-actor recovery must exist')
        return method(self.g, self.t, 'agent-a', self.dest, action, values, 'f' * 64)

    def turn(self, name, status='completed', cli=False, capable=True):
        if self.store.renew_runner(self.g, self.t)['status'] != 'renewed':
            self.t = self.token(self.g)
        c = self.claim(self.g, self.t)
        observed = self.store.begin_hosted_observation(self.g, self.t, 'agent-a', self.dest,
                                                       c['claim_token'], capable, 'f' * 64)
        if cli:
            self.store.observe_cli('agent-a')  # May precede turn/start's answer.
        self.store.finish_wake(self.g, self.t, c['claim_token'], 'handed', dict(
            thread_id=self.dest['thread_id'], turn_id=name, mode='start',
            client_id='theseus:' + c['attempt_id'], announced_seq=c['captured_seq']))
        self.store.end_hosted_turn(self.g, self.t, self.dest['thread_id'], name, status)
        self.sql("UPDATE recipient_schedule SET next_due_ms=? WHERE recipient_id='agent-a'", (self.now,))
        return observed

    def test_three_completed_turns_commit_once_keep_history_and_pending(self):
        self.recovery()
        pending = self.pending()['items']
        for n in (1, 2):
            self.turn('turn-%s' % n)
            self.assertIsNone(self.recovery().get('intent'))
        self.turn('turn-3')
        intent = self.recovery()['intent']
        self.assertIsNotNone(intent, 'The third qualifying completed turn must create the recovery intent')
        self.assertEqual(intent['turns'], ['turn-1', 'turn-2', 'turn-3'])
        self.assertEqual(intent['phase'], 'ready')
        self.recovery('creating', intent_id=intent['id'])
        new = str(uuid.uuid4())
        self.recovery('created', intent_id=intent['id'], thread_id=new)
        self.recovery('persisted', intent_id=intent['id'])
        done = self.recovery('activate', intent_id=intent['id'])
        self.assertEqual(done['intent']['phase'], 'committed')
        self.assertEqual(self.recovery('activate', intent_id=intent['id']), done)
        self.assertEqual(self.pending()['items'], pending)
        self.assertEqual(len(self.sql('SELECT turn_id FROM hosted_turns')), 3)
        with self.assertRaises(RoutePinError):
            self.store.read_route_pin('agent-a', self.dest)
        resolved = self.store.resolve_hosted_route('agent-a', self.dest)
        self.assertEqual(resolved['destination']['thread_id'], new)
        self.assertEqual(resolved['binding']['actor_id'], 'agent-a')

    def test_early_real_cli_and_unknown_or_failed_turn_reset(self):
        self.recovery()
        for name, args in [('one', {}), ('early-cli', {'cli':True}), ('two', {}),
                           ('unknown', {'capable':False}), ('three', {}),
                           ('failed', {'status':'failed'}), ('four', {})]:
            self.send_next(name)
            self.turn(name, **args)
        self.assertIsNone(self.recovery().get('intent'))

    def test_creation_uncertainty_and_reopen_never_authorize_second_create(self):
        self.recovery()
        for n in range(3): self.turn('t%s' % n)
        intent = self.recovery()['intent']
        first = self.recovery('creating', intent_id=intent['id'])
        self.assertTrue(first['create'])
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        again = self.recovery('creating', intent_id=intent['id'])
        self.assertFalse(again['create'])
        self.assertEqual(again['intent']['id'], intent['id'])
        new = str(uuid.uuid4())
        self.recovery('created', intent_id=intent['id'], thread_id=new)
        with self.assertRaises(Exception):
            self.recovery('created', intent_id=intent['id'], thread_id=str(uuid.uuid4()))

    def test_actual_cli_entry_counts_but_echoing_its_path_does_not(self):
        self.recovery()
        profile = self.path.parent / 'activity-profile.json'
        write_profile(profile, self.path, 'test-instance', 'agent-a', binding=self.binding)
        cli = Path(__file__).resolve().parents[1] / 'bin' / 'aim-next'
        before = self.store.cli_activity('agent-a')['seq']
        subprocess.run(['/bin/echo', str(cli)], check=True, capture_output=True)
        self.assertEqual(self.store.cli_activity('agent-a')['seq'], before)
        p = subprocess.run(['/usr/bin/python3', '-I', '-X', 'pycache_prefix=' + str(self.path.parent / 'direct-cli-pycache'), str(cli), '--profile', str(profile), 'binding'], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertGreater(self.store.cli_activity('agent-a')['seq'], before)

    def activity_turn(self, name):
        if self.store.renew_runner(self.g, self.t)['status'] != 'renewed':
            self.t = self.token(self.g)
        claim = self.claim(self.g, self.t)
        self.store.begin_hosted_observation(self.g, self.t, 'agent-a', self.dest,
                                           claim['claim_token'], True, 'f' * 64)
        turn = dict(thread_id=self.dest['thread_id'], turn_id=name, mode='start',
                    client_id='theseus:' + claim['attempt_id'], announced_seq=claim['captured_seq'])
        return claim, turn

    def finish_activity_turn(self, claim, turn):
        self.store.finish_wake(self.g, self.t, claim['claim_token'], 'handed', turn)
        self.store.end_hosted_turn(self.g, self.t, turn['thread_id'], turn['turn_id'], 'completed')
        self.sql("UPDATE recipient_schedule SET next_due_ms=? WHERE recipient_id='agent-a'", (self.now,))

    def activity_cli(self, *arguments):
        profile = self.path.parent / 'contention-profile.json'
        if not profile.exists():
            write_profile(profile, self.path, 'test-instance', 'agent-a', binding=self.binding)
        cli = Path(__file__).resolve().parents[1] / 'bin' / 'aim-next'
        return subprocess.run(['/usr/bin/python3', '-I', '-X',
                               'pycache_prefix=' + str(self.path.parent / 'direct-cli-pycache'),
                               str(cli), '--profile', str(profile), '--json', *arguments],
                              capture_output=True, text=True, timeout=6)

    def test_hosted_cli_read_dispatches_while_activity_writer_is_locked(self):
        self.activity_turn('locked-read')
        pending = {item['id'] for item in self.pending()['items']}
        self.assertTrue(pending)
        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            result = self.activity_cli('inbox')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual({item['id'] for item in json.loads(result.stdout)['items']}, pending)
            self.assertTrue(db.in_transaction, 'the other writer must remain held until the read answers')
        finally:
            db.rollback()
            db.close()

    def test_hosted_transport_read_dispatches_while_activity_writer_is_locked(self):
        from types import SimpleNamespace
        from aim_next.profile import load_profile
        from aim_next.hosted_cli import HostedCLI, exchange
        self.activity_turn('locked-transport')
        profile = self.path.parent / 'transport-contention-profile.json'
        write_profile(profile, self.path, 'test-instance', 'agent-a', binding=self.binding)
        bridge = HostedCLI(SimpleNamespace(profile=load_profile(profile), destination=self.dest,
                                          profile_path=str(profile)))
        self.addCleanup(bridge.close)
        pending = {item['id'] for item in self.pending()['items']}
        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            result, body = exchange(bridge.path, dict(method='view', binding=bridge.binding,
                                                      name='deliveries', args={}))
            self.assertEqual({item['id'] for item in result['items']}, pending)
            self.assertEqual(body, b'')
            self.assertTrue(db.in_transaction)
        finally:
            db.rollback()
            db.close()

    def test_activity_advances_once_per_observed_turn_across_store_reopen(self):
        claim, turn = self.activity_turn('first-activity')
        before = self.store.cli_activity('agent-a')['seq']
        self.assertEqual(self.store.observe_cli('agent-a')['seq'], before + 1)
        reopened = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(reopened.observe_cli('agent-a')['seq'], before + 1)
        self.assertEqual(self.store.observe_cli('agent-a')['seq'], before + 1)
        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            self.assertEqual(reopened.observe_cli('agent-a')['seq'], before + 1,
                             'an already observed turn must not ask for another write lock')
        finally:
            db.rollback()
            db.close()
        self.finish_activity_turn(claim, turn)
        self.send_next('Next observed activity interval')
        claim, turn = self.activity_turn('second-activity')
        self.assertEqual(self.store.observe_cli('agent-a')['seq'], before + 2)
        self.assertEqual(reopened.observe_cli('agent-a')['seq'], before + 2)
        self.finish_activity_turn(claim, turn)

    def test_lost_activity_records_allow_replacement_with_honest_receipt(self):
        self.assertIn('without recorded CLI activity', REASON)
        before = self.store.cli_activity('agent-a')['seq']
        for number in range(3):
            claim, turn = self.activity_turn('lost-activity-%s' % number)
            self.pending()
            db = sqlite3.connect(str(self.path), isolation_level=None)
            try:
                db.execute('BEGIN IMMEDIATE')
                result = self.activity_cli('inbox')
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue(json.loads(result.stdout)['items'])
            finally:
                db.rollback()
                db.close()
            self.assertEqual(self.store.cli_activity('agent-a')['seq'], before)
            self.finish_activity_turn(claim, turn)
        intent = self.recovery()['intent']
        self.assertEqual(intent['turns'], ['lost-activity-0', 'lost-activity-1', 'lost-activity-2'])
        self.recovery('creating', intent_id=intent['id'])
        self.recovery('created', intent_id=intent['id'], thread_id=str(uuid.uuid4()))
        self.recovery('persisted', intent_id=intent['id'])
        done = self.recovery('activate', intent_id=intent['id'])['intent']
        self.assertEqual(done['phase'], 'committed')
        self.assertEqual(done['reason'], REASON)
        agent = next(a for a in self.store.view('owner', 'health', {})['agents'] if a['actor_id'] == 'agent-a')
        self.assertEqual(agent['execution']['replacement']['reason'], REASON)

    def test_one_handoff_writes_recovery_probe_once(self):
        claim, turn = self.activity_turn('one-handoff')
        self.sql('CREATE TABLE recovery_handoff_audit(value INTEGER)')
        self.sql("CREATE TRIGGER recovery_handoff_count AFTER UPDATE ON metadata "
                 "WHEN NEW.key='hosted_recovery.v1:agent-a' BEGIN "
                 "INSERT INTO recovery_handoff_audit VALUES (1); END")
        self.store.finish_wake(self.g, self.t, claim['claim_token'], 'handed', turn)
        self.assertEqual(self.sql('SELECT count(*) FROM recovery_handoff_audit'), [(1,)])
        record = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_recovery.v1:agent-a'")[0][0])
        self.assertEqual(record['probe']['turn_id'], 'one-handoff')

    def test_optional_activity_keeps_actor_binding_authority_and_command_refusals(self):
        from types import SimpleNamespace
        from aim_next.authority import AuthorityError
        from aim_next.contract import Refusal
        from aim_next.profile import load_profile
        from aim_next.hosted_cli import HostedCLI, exchange
        self.activity_turn('real-refusals')
        profile = self.path.parent / 'refusal-profile.json'
        write_profile(profile, self.path, 'test-instance', 'agent-a', binding=self.binding)
        bridge = HostedCLI(SimpleNamespace(profile=load_profile(profile), destination=self.dest,
                                          profile_path=str(profile)))
        self.addCleanup(bridge.close)
        delivery = self.pending()['items'][0]['id']
        envelope = dict(v=1, instance_id='test-instance', operation_id='command-stays-busy',
                        kind='delivery.ack', target=dict(delivery_id=delivery),
                        expected=dict(authority=self.pin), args={})
        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            with self.assertRaises(Refusal) as error:
                exchange(bridge.path, dict(method='view', binding=dict(bridge.binding, actor_id='agent-b'),
                                           name='deliveries', args={}))
            self.assertEqual(error.exception.code, 'BINDING_MISMATCH')
            receipt, body = exchange(bridge.path, dict(method='command', binding=bridge.binding,
                                                      envelope=envelope))
            self.assertEqual(receipt['operation_id'], envelope['operation_id'])
            self.assertEqual(receipt['error']['code'], 'DATABASE_BUSY')
            self.assertTrue(receipt['error']['retryable'])
            self.assertFalse(receipt['recorded'])
            self.assertEqual(body, b'')
        finally:
            db.rollback()
            db.close()
        self.assertEqual(self.store.view('agent-a', 'operation', {'operation_id':envelope['operation_id']})['status'], 'unknown')
        self.assertIn(delivery, {item['id'] for item in self.pending()['items']})
        with self.assertRaises(Refusal) as error:
            self.store.observe_cli('missing-actor')
        self.assertEqual(error.exception.code, 'INVALID_ACTOR')
        with self.assertRaises(AuthorityError):
            Store(self.path, 'test-instance', expected_binding=dict(self.binding, authority_epoch='wrong-epoch'))

    def committed(self):
        for n in range(3): self.turn('t%s' % n)
        intent = self.recovery()['intent']
        self.recovery('creating', intent_id=intent['id'])
        self.recovery('created', intent_id=intent['id'], thread_id=str(uuid.uuid4()))
        self.recovery('persisted', intent_id=intent['id'])
        return intent

    def test_cli_stop_and_pending_removal_win_activation_races(self):
        intent = self.committed()
        self.store.observe_cli('agent-a')
        result = self.recovery('activate', intent_id=intent['id'])
        self.assertEqual(result['intent']['phase'], 'cancelled')
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest)['destination'], self.dest)

    def test_health_keeps_receipt_after_exact_day_indicator_expires(self):
        intent = self.committed()
        done = self.recovery('activate', intent_id=intent['id'])['intent']
        def health():
            h = self.store.view('owner', 'health', {})
            return next(a['execution'] for a in h['agents'] if a['actor_id'] == 'agent-a')
        self.assertEqual(health()['replacement']['id'], intent['id'])
        self.now = done['committed_ms'] + 24 * 60 * 60 * 1000 - 1
        self.assertEqual(health()['replacement']['id'], intent['id'])
        self.now += 1
        self.assertIsNone(health()['replacement'])
        receipts = self.sql("SELECT value FROM metadata WHERE key=?", ('hosted_recovery_receipt.v1:' + intent['id'],))
        self.assertEqual(json.loads(receipts[0][0])['phase'], 'committed')

    def test_owner_stop_continue_revision_and_no_pending_cancel_activation(self):
        intent = self.committed()
        stop = self.command('agent.execution', {'desired':'stopped'}, {'actor_id':'agent-a'},
                            {'execution_revision':1})
        self.assertEqual(stop['status'], 'committed', stop)
        go = self.command('agent.execution', {'desired':'running'}, {'actor_id':'agent-a'},
                          {'execution_revision':2})
        self.assertEqual(go['status'], 'committed', go)
        self.assertEqual(self.recovery('activate', intent_id=intent['id'])['intent']['phase'], 'cancelled')
        # A later independent streak can recover, but pending work remains an
        # activation condition even after native setup was persisted.
        for n in range(3): self.turn('later-%s' % n)
        intent = self.recovery()['intent']
        self.recovery('creating', intent_id=intent['id'])
        self.recovery('created', intent_id=intent['id'], thread_id=str(uuid.uuid4()))
        self.recovery('persisted', intent_id=intent['id'])
        for item in self.pending()['items']: self.ack(item['id'])
        self.assertEqual(self.recovery('activate', intent_id=intent['id'])['intent']['phase'], 'cancelled')
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest)['destination'], self.dest)

    def test_real_transaction_refusal_retains_prepared_id_for_exact_retry(self):
        intent = self.committed()
        self.sql("CREATE TRIGGER recovery_failure BEFORE UPDATE ON metadata WHEN OLD.key LIKE 'route_pin.v1:%' BEGIN SELECT RAISE(ABORT,'isolated recovery refusal'); END")
        from aim_next.runner import RunnerError
        with self.assertRaises(RunnerError):
            self.recovery('activate', intent_id=intent['id'])
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest)['destination'], self.dest)
        self.assertEqual(self.recovery()['intent']['phase'], 'prepared')
        self.sql('DROP TRIGGER recovery_failure')
        self.assertEqual(self.recovery('activate', intent_id=intent['id'])['intent']['phase'], 'committed')
        self.assertEqual(len(self.sql("SELECT key FROM metadata WHERE key LIKE 'hosted_recovery_receipt.v1:%'")), 1)

    def test_configuration_change_and_foreign_origin_do_not_rebind(self):
        intent = self.committed()
        changed = self.store.hosted_recovery(self.g, self.t, 'agent-a', self.dest, 'activate',
                                             {'intent_id':intent['id']}, 'e' * 64)
        self.assertEqual(changed['intent']['phase'], 'cancelled')
        with self.assertRaises(RoutePinError):
            self.store.resolve_hosted_route('agent-a', dict(self.dest, thread_id=str(uuid.uuid4())))

    def test_old_unix_endpoint_refuses_after_committed_route_change(self):
        from types import SimpleNamespace
        from aim_next.profile import load_profile
        from aim_next.hosted_cli import HostedCLI, exchange
        profile = self.path.parent / 'old-endpoint-profile.json'
        write_profile(profile, self.path, 'test-instance', 'agent-a', binding=self.binding)
        bridge = HostedCLI(SimpleNamespace(profile=load_profile(profile), destination=self.dest, profile_path=str(profile)))
        self.addCleanup(bridge.close)
        exchange(bridge.path, {'method':'binding'})
        intent = self.committed()
        self.recovery('activate', intent_id=intent['id'])
        from aim_next.contract import StoreError
        with self.assertRaises(StoreError) as error:
            exchange(bridge.path, {'method':'binding'})
        self.assertEqual(error.exception.code, 'ROUTE_PIN_MISMATCH')

    def test_running_and_duplicate_completion_and_steers_do_not_count_twice(self):
        c = self.claim(self.g, self.t)
        self.store.begin_hosted_observation(self.g, self.t, 'agent-a', self.dest, c['claim_token'], True, 'f' * 64)
        turn = dict(thread_id=self.dest['thread_id'], turn_id='running', mode='start',
                    client_id='theseus:' + c['attempt_id'], announced_seq=c['captured_seq'])
        self.store.finish_wake(self.g, self.t, c['claim_token'], 'handed', turn)
        self.assertIsNone(self.recovery()['intent'])
        self.send_next('Steer into the same running turn')
        c = self.claim(self.g, self.t)
        self.store.finish_wake(self.g, self.t, c['claim_token'], 'handed', dict(turn, mode='steer', client_id='theseus:' + c['attempt_id'], announced_seq=c['captured_seq']))
        self.store.hosted_turn_seen(self.g, self.t, 'theseus:' + c['attempt_id'])
        for unused in range(2):
            self.store.end_hosted_turn(self.g, self.t, self.dest['thread_id'], 'running', 'completed')
        record = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_recovery.v1:agent-a'")[0][0])
        self.assertEqual([x['turn_id'] for x in record['streak']], ['running'])
        self.assertIsNone(record['intent'])

    def test_completion_recovered_from_history_is_unknown_not_zero(self):
        self.turn('one')
        self.turn('two')
        c = self.claim(self.g, self.t)
        self.store.begin_hosted_observation(self.g, self.t, 'agent-a', self.dest, c['claim_token'], True, 'f' * 64)
        self.store.finish_wake(self.g, self.t, c['claim_token'], 'handed', dict(
            thread_id=self.dest['thread_id'], turn_id='history', mode='start', client_id='theseus:' + c['attempt_id'], announced_seq=c['captured_seq']))
        self.store.end_hosted_turn(self.g, self.t, self.dest['thread_id'], 'history', 'completed', observed=False)
        self.assertIsNone(self.recovery()['intent'])

    def test_late_created_id_survives_cancel_and_a_new_intent_without_activating(self):
        for n in range(3): self.turn('original-%s' % n)
        first = self.recovery()['intent']
        self.recovery('creating', intent_id=first['id'])
        self.store.observe_cli('agent-a')
        self.assertEqual(self.recovery()['intent']['phase'], 'cancelled')
        new_id = str(uuid.uuid4())
        from aim_next.contract import Refusal
        try:
            late = self.recovery('created', intent_id=first['id'], thread_id=new_id)
        except Refusal as error:
            self.fail('A cancelled creation must retain its late id: ' + error.code)
        self.assertEqual(late['intent']['phase'], 'cancelled')
        self.assertEqual(late['intent']['new']['thread_id'], new_id)
        for n in range(3): self.turn('later-%s' % n)
        current = self.recovery()['intent']
        self.assertNotEqual(current['id'], first['id'])
        late = self.recovery('created', intent_id=first['id'], thread_id=new_id)
        self.assertEqual(self.recovery()['intent']['id'], current['id'])
        record = json.loads(self.sql('SELECT value FROM metadata WHERE key=?', ('hosted_recovery_intent.v1:' + first['id'],))[0][0])
        self.assertEqual(record['new']['thread_id'], new_id)
        self.assertEqual(record['phase'], 'cancelled')
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest)['destination'], self.dest)

    def test_late_committed_callback_preserves_history_and_refuses_a_second_id(self):
        first = self.committed()
        done = self.recovery('activate', intent_id=first['id'])['intent']
        from aim_next.contract import Refusal
        with self.assertRaises(Refusal):
            self.recovery('created', intent_id=first['id'], thread_id=str(uuid.uuid4()))
        old = self.dest
        self.dest = done['new']
        for n in range(3): self.turn('successor-%s' % n)
        current = self.recovery()['intent']
        late = self.store.hosted_recovery(self.g, self.t, 'agent-a', old, 'created',
            {'intent_id':first['id'], 'thread_id':done['new']['thread_id']}, 'f' * 64)
        self.assertEqual(late['intent']['phase'], 'committed')
        journal = json.loads(self.sql('SELECT value FROM metadata WHERE key=?', ('hosted_recovery_intent.v1:' + first['id'],))[0][0])
        self.assertEqual(journal['phase'], 'committed')
        self.assertEqual(self.recovery()['intent']['id'], current['id'])


class IdleHomeCase(unittest.TestCase):
    def test_workspace_recovery_does_not_interrupt_another_running_seat(self):
        from types import SimpleNamespace
        from unittest import mock
        from aim_next.codex_host import Host
        host = Host.__new__(Host)
        thread = SimpleNamespace(actor='one', config=SimpleNamespace(permission_mode='workspace', destination={}), home='same')
        other = SimpleNamespace(home='same', active_turn='other-turn', attaching=False)
        work = SimpleNamespace(thread=thread, abandoned=False)
        host.threads, host.current = {'one':thread, 'other':other}, work
        host.core, host._settle, host.log = mock.Mock(), mock.Mock(), SimpleNamespace(write=mock.Mock())
        self.assertTrue(callable(getattr(Host, '_recover_thread', None)), 'The host must own the recovery effect')
        Host._recover_thread(host, work, {'id':'scratch-intent', 'phase':'prepared'})
        host.core.assert_not_called()
        self.assertEqual(host._settle.call_args.args[-1], 'recovery_home_busy')


class RecoveryHostCase(host_fixture.HostCase):
    def setUp(self):
        super().setUp()
        retain_case(self, self.root)

    turns = [{'no_cli':True, 'cli_path_mention':True}] * 3 + [{'reply':'Recovered work', 'reply_to_delivery':True}]

    def due_now(self):
        import sqlite3
        with sqlite3.connect(str(self.db)) as db:
            db.execute("UPDATE recipient_schedule SET next_due_ms=0 WHERE recipient_id=?", (host_fixture.AGENT,))

    def test_real_runner_replaces_only_after_three_and_resumes_committed_route(self):
        config_before = self.config.read_bytes()
        profile_before = self.agent_profile.read_bytes()
        runner = self.runner()
        runner.event('host_resume', thread=self.thread)
        self.open_topic('First retained request')
        ended = []
        for index in range(len(self.turns) - 1):
            ended.append(runner.until(lambda e: e.get('event') == 'host_turn_end' and e.get('status') == 'completed'
                                      and e.get('rearmed') is not None, 'Core-recorded completed turn'))
            self.assertEqual(len(self.fake_state()['threads']), 1)
            self.assertTrue(self.pending())
            if index < len(self.turns) - 2:
                self.post('Still pending %s' % index)
                self.due_now()
        # Advance the isolated fixture's due record between turns. This is
        # scheduler control, not timing/performance evidence.
        self.post('Deliver pending work after recovery')
        self.due_now()
        records = self.sql("SELECT value FROM metadata WHERE key=?", ('hosted_recovery.v1:' + host_fixture.AGENT,))
        self.assertTrue(records, 'Completed-turn recovery observations must be retained')
        state = json.loads(records[0][0])
        self.assertIsNotNone(state['intent'], state)
        replaced = runner.event('host_thread_replaced')
        self.assertEqual(len({e['turn'] for e in ended}), len(ended))
        self.assertEqual(replaced['old_thread'], self.thread)
        self.assertEqual(replaced['turns'], [e['turn'] for e in ended[-3:]])
        new = replaced['new_thread']
        self.assertNotEqual(new, self.thread)
        runner.event('host_turn_end', status='completed', thread=new)
        self.assertEqual(self.pending(), [])
        self.assertEqual(len(self.replies()), 1)
        self.assertEqual(self.replies()[0].splitlines()[-1], 'Recovered work')
        self.assertEqual(self.config.read_bytes(), config_before)
        self.assertEqual(self.agent_profile.read_bytes(), profile_before)
        state = self.fake_state()
        self.assertEqual(len(state['threads']), 2)
        self.assertEqual(len(state['threads'][self.thread]['turns']), len(self.turns) - 1)
        # A lost activity record can hide a real CLI call, so the new thread is told what was recorded, not that none ran.
        self.assertIn(REASON, state['threads'][new]['instructions'])
        self.assertNotIn('without a CLI call', state['threads'][new]['instructions'])
        starts = [e['in']['params'] for e in self.wire() if e.get('in', {}).get('method') == 'thread/start']
        self.assertEqual(len(starts), 2)  # Provisioning plus one replacement.
        for key in ('cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'model'):
            self.assertEqual(starts[0].get(key), starts[1].get(key))
        self.stopped_cleanly(runner)
        runner = self.runner()
        runner.event('host_resume', thread=new)
        self.assertEqual(len(self.fake_state()['threads']), 2)
        self.stopped_cleanly(runner)



class EarlyCliHostCase(RecoveryHostCase):
    turns = ([{'no_cli':True}] * 2 +
             [{'no_cli':True, 'cli_activity_only':True, 'end_first':True}] +
             [{'no_cli':True}] * 3 + [{'reply':'Recovered work', 'reply_to_delivery':True}])


class RecoveryFailureHostCase(host_fixture.HostCase):
    def setUp(self):
        super().setUp()
        retain_case(self, self.root)

    turns = RecoveryHostCase.turns
    due_now = RecoveryHostCase.due_now

    def three(self, runner):
        runner.event('host_resume', thread=self.thread)
        self.open_topic('Pending work')
        for i in range(3):
            runner.event('host_turn_end', status='completed')
            self.post('Another delivery %s' % i)
            self.due_now()
        self.assertTrue(self.sql("SELECT value FROM metadata WHERE key=?", ('hosted_recovery.v1:' + host_fixture.AGENT,)),
                        'Completed-turn recovery state must exist before a native recovery effect')

    def intent(self):
        return json.loads(self.sql("SELECT value FROM metadata WHERE key=?",
                                   ('hosted_recovery.v1:' + host_fixture.AGENT,))[0][0])['intent']

    def test_lost_creation_answer_and_restart_do_not_create_again(self):
        script = json.loads((self.home / 'fake-script.json').read_text())
        script['recovery_start_answer_error'] = True
        (self.home / 'fake-script.json').write_text(json.dumps(script))
        runner = self.runner()
        self.three(runner)
        runner.event('host_recovery_waits', reason='recovery_creation_unconfirmed')
        first = self.intent()
        self.assertEqual(first['phase'], 'uncertain')
        pending = self.pending()
        self.stopped_cleanly(runner)
        runner = self.runner()
        runner.event('host_resume', thread=self.thread)
        self.due_now()
        self.post('Retry after lost creation answer')
        runner.event('host_recovery_waits', reason='recovery_creation_unconfirmed')
        self.assertEqual(self.intent()['id'], first['id'])
        self.assertEqual(len(self.fake_state()['threads']), 2)
        self.assertTrue(set(x[0] for x in pending).issubset(set(x[0] for x in self.pending())))
        self.stopped_cleanly(runner)

    def test_persistence_answer_loss_reuses_created_id_after_restart(self):
        script = json.loads((self.home / 'fake-script.json').read_text())
        script['recovery_inject_answer_error_once'] = True
        (self.home / 'fake-script.json').write_text(json.dumps(script))
        runner = self.runner()
        self.three(runner)
        runner.event('host_recovery_waits', reason='recovery_persistence_unconfirmed')
        first = self.intent()
        self.assertEqual(first['phase'], 'created')
        new = first['new']['thread_id']
        self.stopped_cleanly(runner)
        runner = self.runner()
        runner.event('host_resume', thread=self.thread)
        self.due_now()
        self.post('Retry persisted setup')
        replaced = runner.event('host_thread_replaced')
        self.assertEqual(replaced['intent'], first['id'])
        self.assertEqual(replaced['new_thread'], new)
        runner.event('host_turn_end', status='completed', thread=new)
        self.assertEqual(self.pending(), [])
        self.assertEqual(len(self.fake_state()['threads']), 2)
        self.stopped_cleanly(runner)

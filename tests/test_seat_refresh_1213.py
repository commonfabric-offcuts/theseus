from __future__ import annotations

import json
import concurrent.futures
from pathlib import Path
import subprocess
import uuid
import unittest

from test_hosted_recovery_1104 import RecoveryCase, retain_case
from test_codex_host import HostCase, AGENT
import test_seat_host_1002 as managed_fixtures


class RefreshCore(unittest.TestCase):
    StoreCase = RecoveryCase.StoreCase
    for _name in ('command', 'create_topic', 'sql', 'prepare', 'workspace', 'save_draft',
                  'pending', 'send_next', 'ack', 'guard', 'token', 'everyone', 'claim',
                  'setUp', 'recovery', 'activity_turn', 'finish_activity_turn', 'turn'):
        locals()[_name] = getattr(RecoveryCase, _name)

    def snapshot(self, actors=None):
        return self.store.view('owner', 'hosted_seat_refresh',
                               {'workspace_id': 'w1', 'actor_ids': actors or ['agent-a']})

    def refresh(self, actors=None, actor='owner', op=None):
        snapshot = self.snapshot(actors)
        self.assertNotIn('error', snapshot, snapshot)
        seats = [{k: s[k] for k in ('actor_id', 'execution_revision', 'thread_id')}
                 for s in snapshot['seats']]
        return self.command('workspace.hosted_seat_refresh', {'seats': seats},
                            {'workspace_id': 'w1'},
                            {'workspace_revision': snapshot['workspace_revision']}, actor, op)

    def test_manual_request_is_exactly_once_without_qualifying_turns(self):
        pin = self.store.read_route_pin('agent-a', self.dest)
        pending = self.pending()['items']
        first = self.refresh(op='manual-exact')
        self.assertEqual(first['status'], 'committed', first)
        self.assertEqual(self.refresh(op='manual-exact'), first)
        intent = self.recovery()['intent']
        self.assertEqual(intent['trigger']['kind'], 'seat_refresh')
        self.assertEqual(intent['trigger']['operation_id'], 'manual-exact')
        self.assertEqual(intent['turns'], [])
        self.assertEqual(self.refresh()['result']['intents'][0]['id'], intent['id'])
        self.assertEqual(self.pending()['items'], pending)
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest), pin)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_turns'), [(0,)])

    def test_stopped_and_coordinator_have_no_refresh_authority(self):
        self.sql("UPDATE workspaces SET coordinator_id='agent-a' WHERE id='w1'")
        self.assertEqual(self.refresh(actor='agent-a')['error']['code'], 'FORBIDDEN')
        self.command('agent.execution', {'desired': 'stopped'}, {'actor_id': 'agent-a'},
                     {'execution_revision': 1})
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        result = self.store.command('owner', dict(v=1, instance_id='test-instance',
            operation_id='stopped-refresh', kind='workspace.hosted_seat_refresh',
            target={'workspace_id': 'w1'}, expected=dict(authority=self.pin, workspace_revision=revision),
            args={'seats': [{'actor_id': 'agent-a', 'thread_id': self.dest['thread_id'], 'execution_revision': 2}]}))
        self.assertEqual(result['error']['code'], 'HOSTED_SEAT_STOPPED')
        self.assertIsNone(self.recovery()['intent'])

    def test_batch_rejects_everything_when_one_pin_is_missing(self):
        self.assertEqual(self.refresh(op='one-good')['status'], 'committed')
        # Retain the preexisting intent to distinguish refusal from replacing it.
        before = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'")
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        result = self.command('workspace.hosted_seat_refresh', {'seats': [
            {'actor_id': 'agent-a', 'thread_id': self.dest['thread_id'], 'execution_revision': 1},
            {'actor_id': 'agent-b', 'thread_id': str(uuid.uuid4()), 'execution_revision': 1}]},
            {'workspace_id': 'w1'}, {'workspace_revision': revision})
        self.assertEqual(result['status'], 'rejected', result)
        self.assertEqual(self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'"), before)

    def test_open_turn_waits_then_activates_without_replacing_controls(self):
        claim, turn = self.activity_turn('open-before-refresh')
        self.store.finish_wake(self.g, self.t, claim['claim_token'], 'handed', turn)
        self.assertEqual(self.refresh()['status'], 'committed')
        first = self.recovery()['intent']
        self.assertEqual(first['phase'], 'ready')
        waiting = self.recovery('creating', intent_id=first['id'])
        self.assertFalse(waiting['create'])
        self.assertEqual(waiting['status'], 'waiting')
        self.assertEqual(waiting['intent']['phase'], 'ready')
        self.store.observe_cli('agent-a')
        self.store.end_hosted_turn(self.g, self.t, self.dest['thread_id'], turn['turn_id'], 'completed')
        control = self.sql("SELECT value FROM metadata WHERE key='hosted_control.v1:agent-a'")
        self.assertTrue(self.recovery('creating', intent_id=first['id'])['create'])
        new = str(uuid.uuid4())
        self.recovery('created', intent_id=first['id'], thread_id=new)
        self.recovery('persisted', intent_id=first['id'])
        self.assertEqual(self.recovery('activate', intent_id=first['id'])['intent']['phase'], 'committed')
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='hosted_control.v1:agent-a'"), control)
        self.assertEqual(self.store.resolve_hosted_route('agent-a', self.dest)['destination']['thread_id'], new)
        self.assertEqual(self.sql('SELECT thread_id,turn_id FROM hosted_turns'), [(self.dest['thread_id'], turn['turn_id'])])

    def provision_other(self):
        other = dict(self.dest, thread_id=str(uuid.uuid4()))
        return self.store.provision_route_pin(self.g, 'agent-b', other, owner_id='owner')['pin']['destination']

    def test_batch_admits_both_once_and_duplicate_actor_refuses(self):
        self.provision_other()
        self.assertEqual(self.refresh(['agent-a', 'agent-b'])['status'], 'committed')
        before = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'")
        snapshot = self.snapshot()
        seat = {k: snapshot['seats'][0][k] for k in ('actor_id', 'execution_revision', 'thread_id')}
        result = self.command('workspace.hosted_seat_refresh', {'seats': [seat, seat]},
            {'workspace_id': 'w1'}, {'workspace_revision': snapshot['workspace_revision']})
        self.assertEqual(result['error']['code'], 'INVALID_ARGUMENT')
        self.assertEqual(self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'"), before)

    def test_one_stopped_member_refuses_batch_before_other_intent(self):
        self.provision_other()
        snapshot = self.snapshot(['agent-a', 'agent-b'])
        self.command('agent.execution', {'desired': 'stopped'}, {'actor_id': 'agent-b'}, {'execution_revision': 1})
        seats = [{k: s[k] for k in ('actor_id', 'execution_revision', 'thread_id')} for s in snapshot['seats']]
        result = self.command('workspace.hosted_seat_refresh', {'seats': seats}, {'workspace_id': 'w1'},
                              {'workspace_revision': snapshot['workspace_revision']})
        self.assertEqual(result['error']['code'], 'HOSTED_SEAT_STOPPED')
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'hosted_recovery_intent.v1:%'"), [(0,)])

    def test_stop_after_request_cancels_and_status_remains_readable(self):
        self.assertEqual(self.refresh()['status'], 'committed')
        intent = self.recovery()['intent']
        self.command('agent.execution', {'desired': 'stopped'}, {'actor_id': 'agent-a'}, {'execution_revision': 1})
        self.assertEqual(self.recovery()['intent']['phase'], 'cancelled')
        state = self.snapshot()['seats'][0]
        self.assertEqual(state['error']['code'], 'HOSTED_SEAT_STOPPED')
        self.assertEqual(state['intent']['id'], intent['id'])
        self.assertEqual(state['intent']['phase'], 'cancelled')

    def test_unknown_creation_retains_one_id_and_failed_activation_rolls_back(self):
        self.assertEqual(self.refresh()['status'], 'committed')
        intent = self.recovery()['intent']
        self.assertTrue(self.recovery('creating', intent_id=intent['id'])['create'])
        self.recovery('failed', intent_id=intent['id'])
        self.assertFalse(self.recovery('creating', intent_id=intent['id'])['create'])
        new = str(uuid.uuid4())
        self.recovery('created', intent_id=intent['id'], thread_id=new)
        self.recovery('persisted', intent_id=intent['id'])
        self.sql("CREATE TRIGGER manual_activation_fault BEFORE UPDATE ON metadata WHEN OLD.key LIKE 'route_pin.v1:%' BEGIN SELECT RAISE(ABORT,'applied manual activation fault'); END")
        with self.assertRaises(Exception):
            self.recovery('activate', intent_id=intent['id'])
        self.assertEqual(self.recovery()['intent']['phase'], 'prepared')
        self.sql('DROP TRIGGER manual_activation_fault')
        self.assertEqual(self.recovery('activate', intent_id=intent['id'])['intent']['phase'], 'committed')
        self.assertEqual(self.store.resolve_hosted_route('agent-a', self.dest)['destination']['thread_id'], new)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'hosted_recovery_receipt.v1:%'"), [(1,)])

    def test_overlapping_concurrent_batches_join_one_manual_intent(self):
        self.provision_other()
        self.sql("INSERT INTO actors VALUES ('agent-c','agent','Third fixture agent',1)")
        self.sql("INSERT INTO workspace_members VALUES ('w1','agent-c')")
        self.store.provision_route_pin(self.g, 'agent-c', dict(self.dest, thread_id=str(uuid.uuid4())), owner_id='owner')
        state = self.snapshot(['agent-a', 'agent-b', 'agent-c'])
        seats = {s['actor_id']: {k: s[k] for k in ('actor_id', 'execution_revision', 'thread_id')} for s in state['seats']}
        def submit(named):
            return self.store.command('owner', dict(v=1, instance_id='test-instance', operation_id='batch-'+'-'.join(named),
                kind='workspace.hosted_seat_refresh', target={'workspace_id': 'w1'},
                expected=dict(authority=self.pin, workspace_revision=state['workspace_revision']),
                args={'seats': [seats[n] for n in named]}))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [('agent-a', 'agent-b'), ('agent-b', 'agent-c')]))
        self.assertEqual([r['status'] for r in results], ['committed', 'committed'], results)
        shared = [next(i['id'] for i in r['result']['intents'] if i['actor_id']=='agent-b') for r in results]
        self.assertEqual(shared[0], shared[1])
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'hosted_recovery_intent.v1:%'"), [(3,)])

    def test_automatic_uncertain_creation_refuses_whole_manual_batch(self):
        self.provision_other()
        self.recovery()
        for n in range(3):
            self.turn('automatic-%s' % n)
        intent = self.recovery()['intent']
        self.recovery('creating', intent_id=intent['id'])
        self.recovery('failed', intent_id=intent['id'])
        before = self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'")
        result = self.refresh(['agent-b', 'agent-a'])
        self.assertEqual(result['error']['code'], 'HOSTED_RECOVERY_IN_PROGRESS')
        self.assertEqual(self.sql("SELECT key,value FROM metadata WHERE key LIKE 'hosted_recovery%'"), before)

    def test_late_creation_after_stop_continue_only_updates_original_journal(self):
        self.refresh()
        first = self.recovery()['intent']
        self.recovery('creating', intent_id=first['id'])
        self.command('agent.execution', {'desired':'stopped'}, {'actor_id':'agent-a'}, {'execution_revision':1})
        self.assertEqual(self.recovery()['intent']['phase'], 'cancelled')
        self.command('agent.execution', {'desired':'running'}, {'actor_id':'agent-a'}, {'execution_revision':2})
        self.refresh()
        current = self.recovery()['intent']
        late = str(uuid.uuid4())
        self.recovery('created', intent_id=first['id'], thread_id=late)
        self.assertEqual(self.recovery()['intent']['id'], current['id'])
        journal = json.loads(self.sql('SELECT value FROM metadata WHERE key=?',
                            ('hosted_recovery_intent.v1:'+first['id'],))[0][0])
        self.assertEqual((journal['phase'], journal['new']['thread_id']), ('cancelled', late))
        self.assertEqual(self.store.read_route_pin('agent-a', self.dest)['destination'], self.dest)


class RefreshHost(HostCase):
    turns = [{'reply': 'Fresh-seat effect', 'reply_to_delivery': True}]

    def setUp(self):
        super().setUp()
        retain_case(self, self.root)

    def request_refresh(self):
        snapshot = self.store.view('lead', 'hosted_seat_refresh', {'workspace_id': 'w1', 'actor_ids': [AGENT]})
        self.assertNotIn('error', snapshot, snapshot)
        seats = [{k: s[k] for k in ('actor_id', 'execution_revision', 'thread_id')} for s in snapshot['seats']]
        return self.act('workspace.hosted_seat_refresh', {'seats': seats}, {'workspace_id': 'w1'},
                        {'workspace_revision': snapshot['workspace_revision']})

    def test_real_host_refreshes_once_and_ordinary_restart_resumes_new_pin(self):
        self.open_topic('Pending for the fresh agent')
        config, profile = self.config.read_bytes(), self.agent_profile.read_bytes()
        request = self.request_refresh()
        runner = self.runner()
        replaced = runner.event('host_thread_replaced')
        self.assertEqual(replaced['old_thread'], self.thread)
        self.assertEqual(replaced['intent'], request['intents'][0]['id'])
        runner.event('host_turn_end', status='completed', thread=replaced['new_thread'])
        self.assertFalse(self.pending())
        self.assertEqual(self.config.read_bytes(), config)
        self.assertEqual(self.agent_profile.read_bytes(), profile)
        self.stopped_cleanly(runner)
        restarted = self.runner()
        restarted.event('host_resume', thread=replaced['new_thread'])
        self.stopped_cleanly(restarted)
        starts = [r['in']['params'] for r in self.wire() if r.get('in', {}).get('method') == 'thread/start']
        self.assertEqual(len(starts), 2)
        self.assertEqual(len(self.fake_state()['threads']), 2)
        for settings in starts:
            self.assertIn(str(self.root / 'docs' / 'seats' / (AGENT + '.md')), settings['developerInstructions'])
            self.assertIn('current work from the board', settings['developerInstructions'])
        for key in ('cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'model'):
            self.assertEqual(starts[0].get(key), starts[1].get(key))

    def test_provisioning_bootstrap_is_in_actual_start_input(self):
        starts = [r['in']['params'] for r in self.wire() if r.get('in', {}).get('method') == 'thread/start']
        self.assertEqual(len(starts), 1)
        self.assertIn(str(self.root / 'docs' / 'seats' / (AGENT + '.md')), starts[0]['developerInstructions'])

    def test_zero_pending_intent_waits_for_real_delivery_then_intercepts_it(self):
        self.act('workspace.create', {'id': 'w1', 'title': 'Idle refresh', 'team': [AGENT]}, {})
        self.request_refresh()
        runner = self.runner()
        runner.event('host_resume', thread=self.thread)
        self.assertEqual(len(self.fake_state()['threads']), 1)
        self.assertFalse(self.pending())
        self.open_topic('First real delivery after idle refresh')
        replaced = runner.event('host_thread_replaced')
        runner.event('host_turn_end', status='completed', thread=replaced['new_thread'])
        self.assertFalse(self.pending())
        self.assertEqual(len(self.fake_state()['threads']), 2)
        old = self.fake_state()['threads'][self.thread]
        self.assertEqual(old['turns'], [])
        self.stopped_cleanly(runner)

    def test_real_cli_saved_refresh_replays_after_activation_and_status_is_a_read(self):
        self.open_topic('A real CLI request')
        args = [str(self.cli), '--profile', str(self.lead_profile), 'seat-refresh', 'w1', AGENT,
                '--operation', 'owner-refresh-saved']
        first = subprocess.run(args, capture_output=True, text=True, timeout=10)
        self.assertEqual(first.returncode, 0, first.stdout+first.stderr)
        saved = self.lead_profile.parent/'lead.outbox'/'owner-refresh-saved.request.json'
        exact = saved.read_bytes()
        runner = self.runner()
        replaced = runner.event('host_thread_replaced')
        runner.event('host_turn_end', status='completed', thread=replaced['new_thread'])
        # Treat the first response as lost: retry the saved operation after its
        # actual pin changed, rather than recapturing a second refresh.
        again = subprocess.run(args, capture_output=True, text=True, timeout=10)
        self.assertEqual(again.returncode, 0, again.stdout+again.stderr)
        self.assertEqual(saved.read_bytes(), exact)
        state = subprocess.run([str(self.cli), '--profile', str(self.lead_profile), 'seat-refresh', 'w1', AGENT, '--status'],
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(state.returncode, 0, state.stdout+state.stderr)
        self.assertIn(replaced['new_thread'], state.stdout)
        self.assertEqual(len(self.fake_state()['threads']), 2)
        self.stopped_cleanly(runner)


class ManagedRefreshHost(managed_fixtures.RunningSeatHost):
    def setUp(self):
        super().setUp()
        retain_case(self, self.root)

    def refresh_actor(self, named):
        state = self.store.view('lead', 'hosted_seat_refresh', {'workspace_id':'w1', 'actor_ids':[named]})
        self.assertNotIn('error', state, state)
        seats = [{k:s[k] for k in ('actor_id','execution_revision','thread_id')} for s in state['seats']]
        return self.act('workspace.hosted_seat_refresh', {'seats':seats}, {'workspace_id':'w1'},
                        {'workspace_revision':state['workspace_revision']})

    def test_managed_seat_replaces_and_receives_real_next_delivery(self):
        (self.home/'fake-script.json').write_text(json.dumps({'turns':[
            {'reply':'Managed initial reply', 'reply_to_delivery':True},
            {'reply':'Managed fresh reply', 'reply_to_delivery':True}]}))
        runner = self.runner('--seat-template', AGENT)
        identity = self.add_seat()['seat_request_id']
        runner.event('seat_step', seat_id=identity, state='ready')
        seat = self.seat(identity)
        runner.event('host_turn_end', thread=seat['thread_id'], status='completed')
        self.refresh_actor(seat['agent_id'])
        conversation = self.store.view('lead','conversation',{'workspace_id':'w1'})['conversation']['topic_id']
        self.act('message.post', {'body':'Managed refresh delivery','addressees':[seat['agent_id']],'intent':'tell'},
                 {'topic_id':conversation})
        changed = runner.event('host_thread_replaced', actor=seat['agent_id'])
        self.assertNotEqual(changed['new_thread'], seat['thread_id'])
        runner.event('host_turn_end', thread=changed['new_thread'], status='completed')
        self.assertEqual(self.seat(identity)['thread_id'], seat['thread_id'], 'original managed identity stays immutable')
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',(seat['agent_id'],)), [(2,)])
        self.stop_clean(runner)

    def test_actual_open_turn_waits_without_interrupt_until_peer_drives_completion(self):
        (self.home/'fake-script.json').write_text(json.dumps({'turns':[
            {'no_cli':True, 'hold':'release'},
            {'reply':'Peer work', 'reply_to_delivery':True},
            {'reply':'Fresh pending work', 'reply_to_delivery':True}]}))
        runner = self.runner('--seat-template', AGENT)
        self.open_topic('An open operator turn')
        runner.event('settled', outcome='handed')
        self.refresh_actor(AGENT)
        self.post('Further work while the old turn is open')
        runner.event('host_recovery_waits', actor=AGENT, reason='refresh_turn_open')
        self.assertEqual(len(self.fake_state()['threads']), 1)
        self.assertFalse([r for r in self.wire() if r.get('in',{}).get('method')=='turn/interrupt'])
        (self.home/('release-'+self.thread)).write_text('complete the captured synthetic turn')
        identity = self.add_seat()['seat_request_id']
        runner.event('host_turn_end', thread=self.thread, status='completed')
        changed = runner.event('host_thread_replaced', actor=AGENT)
        runner.event('host_turn_end', thread=changed['new_thread'], status='completed')
        peer = self.seat(identity)
        if peer['state'] != 'ready':
            runner.event('seat_step', seat_id=identity, state='ready')
            peer = self.seat(identity)
        if not any(e.get('event')=='host_turn_end' and e.get('thread')==peer['thread_id']
                   and e.get('status')=='completed' for e in runner.events):
            runner.event('host_turn_end', thread=peer['thread_id'], status='completed')
        self.assertFalse([r for r in self.wire() if r.get('in',{}).get('method')=='turn/interrupt'])
        self.stop_clean(runner)


for _base in (managed_fixtures.RunningSeatHost, HostCase):
    for _name in _base.__dict__:
        if _name.startswith('test_'):
            setattr(ManagedRefreshHost, _name, None)


for _name in HostCase.__dict__:
    if _name.startswith('test_'):
        setattr(RefreshHost, _name, None)

del RecoveryCase, HostCase


if __name__ == '__main__':
    unittest.main()

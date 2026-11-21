from __future__ import annotations

"""Real runner/CLI processes, synthetic app-server; no installed/runtime accounts."""

import json
from pathlib import Path
import unittest

import test_seat_host_1002 as base
import test_codex_host as fixture


class EndingHost(base.RunningSeatHost):
    def end_seat(self, seat):
        return self.act('workspace.hosted_seat_end', {}, {'workspace_id':'w1', 'seat_request_id':seat['id']},
                        {'seat_revision':seat['version']})

    def test_idle_seat_ends_and_restart_cannot_adopt_its_old_route(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Original synthetic greeting.', 'reply_to_delivery':True}]}))
        runner = self.runner('--seat-template', fixture.AGENT)
        added = self.add_seat(); identity = added['seat_request_id']
        runner.event('seat_step', seat_id=identity, state='ready')
        seat = self.seat(identity)
        runner.event('host_turn_end', thread=seat['thread_id'], status='completed')
        self.end_seat(self.seat(identity))
        runner.event('seat_ended', seat_id=identity)
        self.assertEqual(self.seat(identity)['state'], 'ended')
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_seat_events WHERE state='ended'"), [(1,)])
        self.stop_clean(runner)
        second = self.runner('--seat-template', fixture.AGENT)
        self.open_topic('Other seat still works after restart.')
        second.event('host_turn_end', thread=self.thread, status='completed')
        self.stop_clean(second)
        wire = [r['in'] for r in self.wire() if 'in' in r]
        self.assertEqual(len([r for r in wire if r['method']=='thread/start']), 2)
        self.assertFalse([r for r in wire if r['method']=='turn/interrupt' and r['params']['threadId']==seat['thread_id']])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(1,)])

    def test_offline_end_reconciles_original_context_on_restart(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Retain this original fixture reply.', 'reply_to_delivery':True}]}))
        first = self.runner('--seat-template', fixture.AGENT)
        identity = self.add_seat()['seat_request_id']
        first.event('seat_step', seat_id=identity, state='ready')
        seat = self.seat(identity)
        first.event('host_turn_end', thread=seat['thread_id'], status='completed')
        self.stop_clean(first)
        self.end_seat(self.seat(identity))
        second = self.runner('--seat-template', fixture.AGENT)
        second.event('host_resume', thread=seat['thread_id'], status='idle')
        second.event('seat_ended', seat_id=identity)
        self.assertEqual(self.seat(identity)['state'], 'ended')
        self.stop_clean(second)
        wire = [r['in'] for r in self.wire() if 'in' in r]
        self.assertEqual(len([r for r in wire if r['method']=='thread/start']), 2)
        self.assertFalse([r for r in wire if r['method']=='turn/interrupt'])

    def test_operator_map_keeps_ended_route_but_does_not_stop_other_seats_on_restart(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Retain the original seat reply.', 'reply_to_delivery':True},
            {'reply':'Peer survives an ending route in the operator map.', 'reply_to_delivery':True},
            {'reply':'Peer survives an ended route in the operator map.', 'reply_to_delivery':True}]}))
        first=self.runner('--seat-template',fixture.AGENT)
        identity=self.add_seat()['seat_request_id'];first.event('seat_step',seat_id=identity,state='ready')
        seat=self.seat(identity);first.event('host_turn_end',thread=seat['thread_id'],status='completed')
        self.stop_clean(first)
        # A supported explicit operator configuration, made only in this fixture.
        plan=json.loads(self.sql('SELECT plan FROM hosted_seats WHERE id=?',(identity,))[0][0])
        table=json.loads(self.map.read_text());table['routes'][seat['agent_id']]=plan['config']
        self.map.write_text(json.dumps(table));self.route_bytes=self.map.read_bytes()
        self.end_seat(self.seat(identity))
        second=self.runner('--seat-template',fixture.AGENT)
        second.event('seat_ended',seat_id=identity)
        self.open_topic('Peer work while a mapped seat ends.')
        second.event('host_turn_end',thread=self.thread,status='completed');self.stop_clean(second)
        self.sql('UPDATE actors SET enabled=0 WHERE id=?',(seat['agent_id'],))
        third=self.runner('--seat-template',fixture.AGENT)
        self.post('Peer work after the mapped seat ended.')
        third.event('host_turn_end',thread=self.thread,status='completed');self.stop_clean(third)
        self.assertEqual(self.seat(identity)['state'],'ended')
        self.assertEqual(self.map.read_bytes(),self.route_bytes)

    def test_missing_ending_rollout_stays_local_and_peer_work_continues(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Original reply retained.', 'reply_to_delivery':True},
            {'reply':'Peer still serves deliveries.', 'reply_to_delivery':True}]}))
        first=self.runner('--seat-template',fixture.AGENT)
        identity=self.add_seat()['seat_request_id'];first.event('seat_step',seat_id=identity,state='ready')
        seat=self.seat(identity);first.event('host_turn_end',thread=seat['thread_id'],status='completed')
        self.stop_clean(first)
        state=json.loads((self.home/'fake-state.json').read_text())
        state['threads'][seat['thread_id']]['persisted']=False
        (self.home/'fake-state.json').write_text(json.dumps(state))
        self.end_seat(self.seat(identity))
        second=self.runner('--seat-template',fixture.AGENT)
        second.event('host_end_resume_unconfirmed',thread=seat['thread_id'])
        self.open_topic('Other seat still works while ending resume is refused.')
        second.event('host_turn_end',thread=self.thread,status='completed')
        self.assertEqual(self.seat(identity)['state'],'ending')
        self.assertEqual(self.store.runner_schedule([fixture.AGENT])['state'],'running')
        self.stop_clean(second)
        starts=[r for r in self.wire() if r.get('in',{}).get('method')=='thread/start']
        self.assertEqual(len(starts),2)

    def test_explicit_owner_stop_can_interrupt_an_ending_runaway(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Runaway fixture turn.', 'reply_to_delivery':True,'hold':'interrupt'}]}))
        runner=self.runner('--seat-template',fixture.AGENT)
        identity=self.add_seat()['seat_request_id'];runner.event('seat_step',seat_id=identity,state='ready')
        seat=self.seat(identity);runner.event('settled',outcome='handed')
        self.end_seat(self.seat(identity))
        self.assertFalse([r for r in self.wire() if r.get('in',{}).get('method')=='turn/interrupt'])
        self.act('agent.execution',{'desired':'stopped'},{'actor_id':seat['agent_id']},{'execution_revision':1})
        runner.event('host_turn_end',thread=seat['thread_id'],status='interrupted')
        runner.event('seat_ended',seat_id=identity)
        interrupts=[r['in'] for r in self.wire() if r.get('in',{}).get('method')=='turn/interrupt']
        self.assertEqual([r['params']['threadId'] for r in interrupts],[seat['thread_id']])
        self.stop_clean(runner)

    def test_active_end_waits_for_normal_completion_and_other_seat_keeps_working(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply':'Current synthetic turn finished normally.', 'reply_to_delivery':True, 'hold':'release'},
            {'reply':'Other seat continues.', 'reply_to_delivery':True}]}))
        runner = self.runner('--seat-template', fixture.AGENT)
        identity = self.add_seat()['seat_request_id']
        runner.event('seat_step', seat_id=identity, state='ready')
        seat = self.seat(identity)
        runner.event('settled', outcome='handed')
        current = next(r for r in self.turns_rows() if r['thread_id']==seat['thread_id'])
        self.assertIsNone(current['final_status'])
        self.end_seat(self.seat(identity))
        # The Core fence is already present; a second delivery stays pending.
        conversation = self.store.view('lead', 'conversation', {'workspace_id':'w1'})['conversation']['topic_id']
        self.act('message.post', {'body':'Future work must remain pending.', 'addressees':['evidence-scribe'], 'intent':'tell'}, {'topic_id':conversation})
        self.assertEqual(self.seat(identity)['state'], 'ending')
        (self.home / ('release-' + seat['thread_id'])).write_text('release this owned fixture turn')
        self.open_topic('Drive the independent operator seat on the shared child.')
        runner.event('host_turn_end', thread=seat['thread_id'], status='completed')
        runner.event('seat_ended', seat_id=identity)
        # Its independent seat still produces its real CLI-authored fixture reply.
        runner.event('host_turn_end', thread=self.thread, status='completed')
        wire = [r['in'] for r in self.wire() if 'in' in r]
        self.assertFalse([r for r in wire if r['method']=='turn/interrupt'])
        self.assertEqual(self.sql("SELECT final_status FROM hosted_turns WHERE recipient_id='evidence-scribe'"), [('completed',)])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='evidence-scribe' AND state='pending'"), [(1,)])
        self.stop_clean(runner)

for _class in (base.RunningSeatHost, fixture.HostCase):
    for _name in _class.__dict__:
        if _name.startswith('test_'):
            setattr(EndingHost, _name, None)

if __name__ == '__main__':
    unittest.main()

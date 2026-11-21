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

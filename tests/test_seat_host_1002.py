from __future__ import annotations

"""Real isolated runner/child/CLI processes; the app-server is synthetic, never authenticated Codex."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

import test_codex_host as fixture


class RunningSeatHost(fixture.HostCase):
    def provision(self, config=None, profile=None):
        command = ['/usr/bin/python3', '-I', str(fixture.ROOT / 'bin/aim-next-runner'), 'host-provision',
            '--profile', str(self.lead_profile), '--runner-id', 'host-fixture', '--actor-profile', str(profile or self.agent_profile),
            '--codex-executable', str(self.codex), '--codex-home', str(self.home), '--cli', str(self.cli), '--cwd', str(self.work),
            '--config', str(config or self.config), '--permission-mode', 'full', '--model', 'gpt-6.1-sol',
            '--reasoning-effort', 'xhigh', '--owner', 'lead']
        answer = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(answer.returncode, 0, (answer.stdout, answer.stderr))
        return dict(json.loads(answer.stdout), exit_code=answer.returncode)

    def setUp(self):
        super().setUp()
        self.act('workspace.create', {'id': 'w1', 'title': 'New seat proof', 'team': [fixture.AGENT], 'coordinator': None}, {})
        self.route_bytes = self.map.read_bytes()

    def add_seat(self, name='Evidence scribe', **settings):
        current = self.store.view('lead', 'workspace', {'workspace_id': 'w1'})['workspace']
        return self.act('workspace.hosted_seat_add', {'name': name, 'role': 'Keep exact evidence.\nRead and answer your own delivery.', **settings},
                        {'workspace_id': 'w1'}, {'workspace_revision': current['version']})

    def seat(self, identity):
        return self.store.view('lead', 'hosted_seat', {'workspace_id': 'w1', 'seat_request_id': identity})['seat']

    def stop_clean(self, runner):
        code, result = runner.stop()
        self.assertEqual((code, result['status'], result['cleanup_confirmed']), (0, 'stopped', True), result)
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_children WHERE cleanup IS NOT 'confirmed'"), [(0,)])
        for row in self.wire():
            if 'spawn' in row:
                with self.assertRaises(ProcessLookupError):
                    os.kill(row['spawn'], 0)
        self.assertEqual(self.map.read_bytes(), self.route_bytes)

    def tearDown(self):
        # Retain exact fixture wire and owned cleanup evidence before the fixture's own cleanup.
        for runner in self.runners:
            if runner.process.poll() is None:
                self.stop_clean(runner)
        destination = os.environ.get('AIM_SEAT_EVIDENCE')
        if destination:
            folder = Path(destination) / self._testMethodName
            folder.mkdir(mode=0o700, parents=True, exist_ok=False)
            for path in (self.home / 'fake-wire.jsonl', self.home / 'fake-state.json',
                         self.host_dir / 'events.jsonl', self.root / 'runner-stderr.log'):
                if path.exists():
                    shutil.copyfile(path, folder / path.name)
            state = {'operator_route_sha256_before': hashlib.sha256(self.route_bytes).hexdigest(),
                     'operator_route_sha256_after': hashlib.sha256(self.map.read_bytes()).hexdigest(),
                     'runner_pids': [runner.pid for runner in self.runners],
                     'runner_exits': [runner.process.returncode for runner in self.runners],
                     'children': self.sql('SELECT pid,exit_status,cleanup FROM hosted_children'),
                     'seats': self.sql('SELECT id,agent_id,state,stage,thread_id,reason,first_message_id FROM hosted_seats'),
                     'events': self.sql('SELECT * FROM hosted_seat_events ORDER BY seat_id,version')}
            (folder / 'cleanup-and-state.json').write_text(json.dumps(state, indent=2))

    def test_running_host_adds_a_seat_beside_an_active_turn_on_the_same_child(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply': 'Original seat keeps its turn.', 'reply_to_delivery': True, 'hold': 'interrupt'},
            {'reply': 'Hello from the isolated fixture seat.', 'reply_to_delivery': True}]}))
        self.open_topic('Keep your current work active.')
        runner = self.runner('--seat-template', fixture.AGENT)
        runner.event('settled', outcome='handed')
        original = self.turns_rows()[0]
        self.assertIsNone(original['final_status'])
        added = self.add_seat(model='gpt-6.1-terra', reasoning_effort='medium')
        runner.event('seat_step', seat_id=added['seat_request_id'], state='ready')
        seat = self.seat(added['seat_request_id'])
        runner.event('host_turn_end', thread=seat['thread_id'], status='completed')
        # The original turn is still in its same native context and has not been interrupted for provisioning.
        original_after = next(row for row in self.turns_rows() if row['thread_id'] == original['thread_id'])
        self.assertEqual(original_after['turn_id'], original['turn_id'])
        self.assertIsNone(original_after['final_status'])
        replies = self.sql("SELECT reply_to,body FROM messages WHERE author_id='evidence-scribe'")
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0][0], seat['first_message_id'])
        self.assertTrue(replies[0][1].endswith('Hello from the isolated fixture seat.'), replies)
        starts = [row['in'] for row in self.wire() if row.get('in', {}).get('method') == 'thread/start']
        self.assertEqual(len(starts), 2, 'one operator fixture thread and exactly one newly requested thread')
        self.assertEqual(starts[-1]['params']['model'], 'gpt-6.1-terra')
        self.assertEqual(starts[-1]['params']['config']['model_reasoning_effort'], 'medium')
        self.assertEqual(len([row for row in self.wire() if 'spawn' in row]), 2, 'the provision fixture and one shared runner child')
        self.stop_clean(runner)

    def test_restart_recovers_the_managed_route_without_rewriting_the_operator_map_or_reprovisioning(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply': 'Hello from new fixture seat.', 'reply_to_delivery': True},
            {'reply': 'The same fixture seat returned.', 'reply_to_delivery': True}]}))
        first = self.runner('--seat-template', fixture.AGENT)
        added = self.add_seat()
        first.event('seat_step', seat_id=added['seat_request_id'], state='ready')
        seat = self.seat(added['seat_request_id'])
        first.event('host_turn_end', thread=seat['thread_id'], status='completed')
        self.stop_clean(first)
        second = self.runner('--seat-template', fixture.AGENT)
        conversation = self.store.view('lead', 'conversation', {'workspace_id': 'w1'})['conversation']
        self.act('message.post', {'body': 'Continue in the same native context.', 'addressees': ['evidence-scribe'], 'intent': 'tell'},
                 {'topic_id': conversation['topic_id']})
        second.event('host_turn_end', thread=seat['thread_id'], status='completed')
        self.stop_clean(second)
        self.assertEqual(len([row for row in self.wire() if row.get('in', {}).get('method') == 'thread/start']), 2)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(2,)])
        self.assertEqual(self.sql('SELECT count(DISTINCT thread_id) FROM hosted_turns WHERE recipient_id=?', ('evidence-scribe',)), [(1,)])

    def test_missing_auth_names_the_step_and_never_starts_or_routes_the_new_thread(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'signed_in': False, 'turns': []}))
        runner = self.runner('--seat-template', fixture.AGENT)
        added = self.add_seat()
        runner.event('seat_step', seat_id=added['seat_request_id'], state='refused', reason='auth_missing')
        seat = self.seat(added['seat_request_id'])
        self.assertEqual((seat['state'], seat['stage'], seat['thread_id'], seat['first_message_id']),
                         ('refused', 'thread', None, None))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(0,)])
        self.assertEqual(len([row for row in self.wire() if row.get('in', {}).get('method') == 'thread/start']), 1)
        self.stop_clean(runner)

    def test_definite_auth_refusal_can_resume_the_same_seat_after_the_host_recovers(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'signed_in': False, 'turns': []}))
        first = self.runner('--seat-template', fixture.AGENT)
        added = self.add_seat()
        first.event('seat_step', seat_id=added['seat_request_id'], state='refused', reason='auth_missing')
        seat = self.seat(added['seat_request_id'])
        self.stop_clean(first)
        (self.home / 'fake-script.json').write_text(json.dumps({'signed_in': True, 'turns': [
            {'reply': 'Hello from the recovered same seat.', 'reply_to_delivery': True}]}))
        retried = self.act('workspace.hosted_seat_retry', {}, {'workspace_id': 'w1', 'seat_request_id': seat['id']},
                           {'seat_revision': seat['version']})
        self.assertEqual(retried['seat_request_id'], seat['id'])
        second = self.runner('--seat-template', fixture.AGENT)
        second.event('seat_step', seat_id=seat['id'], state='ready')
        ready = self.seat(seat['id'])
        second.event('host_turn_end', thread=ready['thread_id'], status='completed')
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(1,)])
        self.assertEqual(len([row for row in self.wire() if row.get('in', {}).get('method') == 'thread/start']), 2)
        self.stop_clean(second)

    def test_stop_during_unanswered_native_creation_is_not_replayed_by_a_new_owner(self):
        (self.home / 'fake-script.json').write_text(json.dumps({'silence_thread_start_once': True, 'turns': []}))
        first = self.runner('--seat-template', fixture.AGENT)
        added = self.add_seat()
        first.event('seat_step', seat_id=added['seat_request_id'], state='preparing', stage='starting')
        self.stop_clean(first)
        second = self.runner('--seat-template', fixture.AGENT)
        second.event('host_resume', thread=self.thread, status='idle')
        seat = self.seat(added['seat_request_id'])
        self.assertEqual((seat['state'], seat['stage'], seat['reason'], seat['first_message_id']),
                         ('refused', 'starting', 'thread_start_uncertain', None))
        self.assertFalse(seat['retryable'])
        self.assertEqual(len([row for row in self.wire() if row.get('in', {}).get('method') == 'thread/start']), 2)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='evidence-scribe'"), [(0,)])
        self.stop_clean(second)


if __name__ == '__main__':
    unittest.main()

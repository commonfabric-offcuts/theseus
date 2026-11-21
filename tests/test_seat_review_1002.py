from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from aim_next import broker_routes, codex_host
from aim_next.authority import AuthorityError
from aim_next.effects_runner import EffectsLoop
from aim_next.route_pins import RoutePinError
from aim_next.seat_host import SeatHost, SeatRefusal
import test_hosted_seat_1002 as core_cases


class CoreReview(unittest.TestCase):
    setUp = core_cases.HostedSeatCore.setUp
    setUp_store = core_cases.HostedSeatCore.setUp_store
    workspace = core_cases.HostedSeatCore.workspace
    command = core_cases.HostedSeatCore.command
    sql = core_cases.HostedSeatCore.sql
    add = core_cases.HostedSeatCore.add
    added = core_cases.HostedSeatCore.added
    claim = core_cases.HostedSeatCore.claim
    step = core_cases.HostedSeatCore.step
    plan = core_cases.HostedSeatCore.plan
    to_stage = core_cases.HostedSeatCore.to_stage
    retry_seat = core_cases.HostedSeatCore.retry_seat

    def test_coordinator_cannot_add_or_retry_even_with_current_fences(self):
        self.assertEqual(self.add(actor='agent-a')['error']['code'], 'FORBIDDEN')
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            refused = self.step(guard, token, self.claim(guard, token), 'refused', {'reason': 'auth_missing'})
        self.assertEqual(self.retry_seat(refused, actor='agent-a')['error']['code'], 'FORBIDDEN')

    def test_all_seat_steps_leave_topic_changes_valid_and_workspace_progress_present(self):
        topic = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        scope = {'kind': 'topic', 'id': topic}
        before = self.store.view('owner', 'changes', {'scope': scope})['checkpoint']
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.to_stage(guard, token, 'ready')
        changes = self.store.view('owner', 'changes', {'scope': scope, 'cursor': before})
        self.assertTrue(changes['items'])
        self.assertTrue(all(row['resource_kind'] in ('topic', 'memory', 'workspace') for row in changes['items']), changes)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE scope_kind='outcome' AND resource_kind='hosted_seat'"), [(0,)])
        self.assertGreater(self.sql("SELECT count(*) FROM changes WHERE scope_kind='workspace' AND resource_kind='hosted_seat'")[0][0], 5)

    def test_disabled_or_removed_ready_seat_is_never_readopted(self):
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.to_stage(guard, token, 'ready')
            self.sql("UPDATE actors SET enabled=0 WHERE id='release-scribe'")
            self.assertIsNone(self.store.hosted_seat_route(guard, token, 0)['seat'])
            self.sql("UPDATE actors SET enabled=1 WHERE id='release-scribe'")
            self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='release-scribe'")
            self.assertIsNone(self.store.hosted_seat_route(guard, token, 0)['seat'])

    def test_current_human_owner_can_resume_after_inviter_leaves(self):
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            refused = self.step(guard, token, self.claim(guard, token), 'refused', {'reason': 'auth_missing'})
            self.store.stop_runner(guard, token)
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('successor','human','Successor')")
        self.sql("INSERT INTO workspace_members VALUES ('w1','successor')")
        self.sql("UPDATE workspaces SET owner_id='successor',version=version+1 WHERE id='w1'")
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='owner'")
        self.sql("UPDATE actors SET enabled=0 WHERE id='owner'")
        result = self.retry_seat(refused, actor='successor')
        self.assertEqual(result['status'], 'committed', result)
        with self.store.runner_guard('review-next') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            ready = self.to_stage(guard, token, 'ready')
        self.assertEqual(ready['state'], 'ready', ready)
        self.assertEqual(self.sql('SELECT inviter_id,owner_id FROM hosted_seats'), [('owner', 'owner')])
        self.assertEqual(self.sql('SELECT author_id FROM messages'), [('successor',)])
        control = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_control.v1:release-scribe'")[0][0])
        self.assertEqual(control['owner_id'], 'successor')

    def test_instance_cap_is_eight_across_outcomes_and_does_not_break_exact_recovery(self):
        first = self.added(name='Seat zero')
        for index in range(7):
            self.added(name='Seat ' + str(index + 1))
        self.command('workspace.create', {'id': 'w2', 'title': 'Another', 'team': []})
        version = self.sql("SELECT version FROM workspaces WHERE id='w2'")[0][0]
        count = self.sql('SELECT count(*) FROM actors')
        denied = self.command('workspace.hosted_seat_add', {'name': 'Ninth', 'role': 'No extra worker'},
                              {'workspace_id': 'w2'}, {'workspace_revision': version})
        self.assertEqual(denied.get('error', {}).get('code'), 'SEAT_LIMIT', denied)
        self.assertEqual(self.sql('SELECT count(*) FROM actors'), count)
        self.assertEqual(self.added(name='Seat zero')['seat_request_id'], first['seat_request_id'])

    def test_stopped_confirmed_thread_can_resume_persist_but_unknown_persistence_cannot(self):
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.to_stage(guard, token, 'persist')
            refused = self.step(guard, token, seat, 'refused', {'reason': 'stopping'})
        result = self.retry_seat(refused)
        self.assertEqual(result['status'], 'committed', result)
        self.assertEqual(result['result']['seat']['thread_id'], seat['thread_id'])
        self.assertEqual(result['result']['seat']['stage'], 'persist')

    def test_retry_does_not_bypass_the_instance_cap(self):
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            refused = self.step(guard, token, self.claim(guard, token), 'refused', {'reason': 'auth_missing'})
        for index in range(8):
            self.added(name='Other ' + str(index))
        denied = self.retry_seat(refused)
        self.assertEqual(denied.get('error', {}).get('code'), 'SEAT_LIMIT', denied)
        self.assertEqual(self.sql('SELECT state FROM hosted_seats WHERE id=?', (refused['id'],)), [('refused',)])

    def test_missing_conversation_has_its_own_reason_and_cannot_blindly_repeat(self):
        self.added()
        with self.store.runner_guard('review') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.to_stage(guard, token, 'delivery')
            with patch.object(self.store, '_conversation_of', return_value=None):
                refused = self.step(guard, token, seat, 'ready')
                self.assertEqual(refused['reason'], 'conversation_missing')
                denied = self.retry_seat(refused)
                self.assertEqual(denied.get('error', {}).get('code'), 'SEAT_CONVERSATION_REQUIRED', denied)
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), [(0,)])


class HostReview(unittest.TestCase):
    def test_ready_route_without_host_refuses_before_publishing_or_installing(self):
        seats = SeatHost(SimpleNamespace(host=None), directory='/scratch/review')
        seats._published_config = Mock(side_effect=AssertionError('No host must not publish files'))
        with self.assertRaises(SeatRefusal) as refused:
            seats._adopt({'agent_id': 'seat'})
        self.assertEqual(refused.exception.reason, 'host_not_configured')

    def test_preflight_pin_and_authority_failures_keep_known_cleanup_and_refuse_per_seat(self):
        for error in (RoutePinError('ROUTE_PIN_MISSING', 'missing'), AuthorityError('AUTHORITY_CHANGED', 'moved')):
            with self.subTest(code=error.code), tempfile.TemporaryDirectory() as folder:
                loop = SimpleNamespace(cleanup_uncertain=False, _cleanup_known=EffectsLoop._cleanup_known)
                loop._storage = lambda action: EffectsLoop._storage(loop, action)
                loop.profile = SimpleNamespace()
                seats = SeatHost(loop, directory=folder)
                config = SimpleNamespace(profile_path='profile', cli='cli', codex_executable='exe',
                    destination={'codex_home': 'home', 'thread_id': 'thread'}, cwd='cwd', model='model',
                    writable_roots=(), permission_mode='full', reasoning_effort='xhigh', instructions='role',
                    config_path=str(Path(folder) / 'route.json'))
                seats._config = Mock(return_value=config)
                with patch.object(broker_routes, 'preflight_hosted', side_effect=error), self.assertRaises(SeatRefusal):
                    seats._published_config({'agent_id': 'seat', 'thread_id': 'thread'})
                self.assertFalse(loop.cleanup_uncertain)

    def test_loop_maps_ownership_pause_and_schedule_faults_to_supported_exits(self):
        for reason, status in [('runner_lease_lost', 'ownership_lost'), ('seat_runner_paused', 'paused'),
                               ('seat_schedule_invalid', 'paused')]:
            with self.subTest(reason=reason):
                loop = EffectsLoop.__new__(EffectsLoop)
                loop.profile = SimpleNamespace(instance_id='fixture')
                loop.cleanup_uncertain = False
                loop._wait = Mock(side_effect=codex_host.HostFault(reason))
                def pause(code):
                    self.assertEqual(code, 'storage_failure')
                    return loop._result('paused', pause_saved=True)
                loop._fault = Mock(side_effect=pause)
                result = loop.run()
                self.assertEqual(result['status'], status)
                if reason != 'seat_schedule_invalid':
                    loop._fault.assert_not_called()


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import tempfile
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_store as fixture
from aim_next.seat_host import SeatHost


class TemplateCatalogue(unittest.TestCase):
    setUp = fixture.StoreCase.setUp
    command = fixture.StoreCase.command
    workspace = fixture.StoreCase.workspace
    sql = fixture.StoreCase.sql

    def test_owner_can_read_unavailable_templates_without_exposing_host_paths(self):
        self.workspace()
        answer = self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})
        self.assertEqual(answer.get('available'), False, answer)
        self.assertEqual(answer.get('items'), [], answer)
        denied = self.store.view('agent-a', 'hosted_seat_templates', {'workspace_id': 'w1'})
        self.assertEqual(denied.get('error', {}).get('code'), 'FORBIDDEN', denied)

    def test_current_catalogue_requires_a_choice_and_records_the_second_template(self):
        self.workspace()
        options = [{'id': 'template-' + '1' * 64, 'actor_id': 'agent-a', 'model': 'fixture-one', 'reasoning_effort': 'high'},
                   {'id': 'template-' + '2' * 64, 'actor_id': 'agent-b', 'model': 'fixture-two', 'reasoning_effort': 'xhigh'}]
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            published = self.store.hosted_seat_publish_templates(guard, token, options)
            self.assertEqual(published['status'], 'ok')
            read = self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})
            self.assertTrue(read['available'])
            self.assertEqual([item['id'] for item in read['items']], [item['id'] for item in options])
            version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
            args = {'name': 'Chosen seat', 'role': 'Use the named fixture settings.'}
            refused = self.command('workspace.hosted_seat_add', args, {'workspace_id': 'w1'}, {'workspace_revision': version})
            self.assertEqual(refused.get('error', {}).get('code'), 'SEAT_TEMPLATE_REQUIRED', refused)
            self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(0,)])
            args['template_id'] = options[1]['id']
            added = self.command('workspace.hosted_seat_add', args, {'workspace_id': 'w1'}, {'workspace_revision': version})
            self.assertEqual(added.get('status'), 'committed', added)
            seat = added['result']['seat']
            self.assertEqual(seat['template_id'], options[1]['id'])
            self.assertEqual(self.sql('SELECT template_id FROM hosted_seats'), [(options[1]['id'],)])

    def test_single_template_defaults_and_a_new_runner_cannot_reuse_the_old_catalogue(self):
        self.workspace()
        option = {'id': 'template-' + '1' * 64, 'actor_id': 'agent-a', 'model': 'fixture-one', 'reasoning_effort': 'high'}
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.store.hosted_seat_publish_templates(guard, token, [option])
            version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
            made = self.command('workspace.hosted_seat_add', {'name': 'Default seat', 'role': 'Single template.'},
                                {'workspace_id': 'w1'}, {'workspace_revision': version})
            self.assertEqual(made['result']['seat']['template_id'], option['id'])
            self.assertEqual(made['result']['seat']['model'], option['model'])
            self.assertEqual(made['result']['seat']['reasoning_effort'], option['reasoning_effort'])
            self.sql("UPDATE runner_state SET lease_until_ms=0")
            stale = self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})
            self.assertFalse(stale['available']); self.assertEqual(stale['items'], [])
            self.store.acquire_runner(guard)
            self.assertFalse(self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})['available'])

    def test_model_and_effort_survive_retry_and_bind_the_host_plan(self):
        from aim_next.runner import RunnerError
        self.workspace()
        template = {'id': 'template-' + '1' * 64, 'actor_id': 'agent-a',
                    'model': 'gpt-6.2-sol', 'reasoning_effort': 'high'}
        target = {'workspace_id': 'w1'}
        args = {'name': 'Researcher', 'role': 'Review sources.', 'template_id': template['id'],
                'model': 'gpt-6.1-terra', 'reasoning_effort': 'xhigh'}
        with self.store.runner_guard('settings-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.store.hosted_seat_publish_templates(guard, token, [template])
            def add(values):
                version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
                return self.command('workspace.hosted_seat_add', values, target, {'workspace_revision': version})
            for key, value in [('model', 'unoffered-model'), ('reasoning_effort', 'ultra')]:
                self.assertEqual(add(dict(args, **{key: value}))['error']['code'], 'INVALID_ARGUMENT')
            seat = add(args)['result']['seat']
            self.assertEqual(add(dict(args, reasoning_effort='low'))['error']['code'], 'SEAT_SETTINGS_MISMATCH')
            self.assertEqual(add(args)['result']['seat']['id'], seat['id'])
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            seat = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'refused',
                                              {'reason': 'host_not_configured'})['seat']
            reply = self.command('workspace.hosted_seat_retry', {}, dict(target, seat_request_id=seat['id']),
                                 {'seat_revision': seat['version']})
            self.assertEqual(reply['status'], 'committed')
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            settings = {key: args[key] for key in ('model', 'reasoning_effort')}
            self.assertEqual({key: seat[key] for key in settings}, settings)
            with self.assertRaises(RunnerError):
                self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'profile',
                                            {'plan': dict(settings, reasoning_effort='low')})
            recorded = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'profile', {'plan': settings})
            self.assertEqual(recorded['seat']['plan'], settings)

    def test_migration_preserves_legacy_seats_and_guards_recorded_settings(self):
        from aim_next.migrations import MigrationError, migrate
        self.workspace()
        self.command('workspace.hosted_seat_add', {'name': 'Legacy', 'role': 'Keep this role.'},
                     {'workspace_id': 'w1'}, {'workspace_revision': self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]})
        kept = self.sql('SELECT agent_id,role,template_id FROM hosted_seats')
        self.assertEqual(migrate(self.path, 'test-instance', self.binding, target='69')['schema_version'], '69')
        self.assertEqual(migrate(self.path, 'test-instance', self.binding)['schema_version'], '70')
        self.assertEqual(self.sql('SELECT agent_id,role,template_id FROM hosted_seats'), kept)
        self.assertEqual(self.sql('SELECT model,reasoning_effort FROM hosted_seats'), [(None, None)])
        self.sql("UPDATE hosted_seats SET model='gpt-6.1-terra',reasoning_effort='high'")
        with self.assertRaises(MigrationError) as caught:
            migrate(self.path, 'test-instance', self.binding, target='69')
        self.assertEqual(caught.exception.code, 'RECORDS_WOULD_BE_LOST')

    def test_unplanned_refusal_can_choose_for_same_seat_but_a_kept_plan_locks_the_template(self):
        self.workspace()
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        made = self.command('workspace.hosted_seat_add', {'name': 'Legacy seat', 'role': 'Kept role.'},
                            {'workspace_id': 'w1'}, {'workspace_revision': version})['result']['seat']
        option = {'id': 'template-' + '2' * 64, 'actor_id': 'agent-b', 'model': 'fixture-two', 'reasoning_effort': 'high'}
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.store.hosted_seat_publish_templates(guard, token, [option])
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            seat = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'refused', {'reason': 'host_template_ambiguous'})['seat']
            retry = self.command('workspace.hosted_seat_retry', {'template_id': option['id']},
                                 {'workspace_id': 'w1', 'seat_request_id': seat['id']}, {'seat_revision': seat['version']})
            self.assertEqual(retry['status'], 'committed', retry)
            self.assertEqual((retry['result']['seat']['id'], retry['result']['seat']['agent_id'], retry['result']['seat']['role']),
                             (made['id'], made['agent_id'], 'Kept role.'))
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            seat = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'profile', {'plan': {'fixture': 'kept'}})['seat']
            seat = self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'refused', {'reason': 'profile_write_failed'})['seat']
            denied = self.command('workspace.hosted_seat_retry', {'template_id': option['id']},
                                  {'workspace_id': 'w1', 'seat_request_id': seat['id']}, {'seat_revision': seat['version']})
            self.assertEqual(denied['error']['code'], 'SEAT_TEMPLATE_LOCKED', denied)
            self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])

    def test_invalid_or_unavailable_choices_never_invite_an_actor(self):
        self.workspace()
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        for identity, code in [(None, 'INVALID_ARGUMENT'), ('/private/home', 'INVALID_ARGUMENT'),
                               ('template-' + '3' * 64, 'SEAT_TEMPLATE_UNAVAILABLE')]:
            answer = self.command('workspace.hosted_seat_add', {'name': 'Unmade', 'role': 'Kept.', 'template_id': identity},
                                  {'workspace_id': 'w1'}, {'workspace_revision': version})
            self.assertEqual(answer.get('error', {}).get('code'), code, answer)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM actors WHERE id='unmade'"), [(0,)])

    def test_migration_is_one_field_and_refuses_to_discard_a_retained_choice(self):
        from aim_next.migrations import STEPS, migrate, MigrationError
        from aim_next.hosted_seats import TEMPLATE_SCHEMA
        step = next(step for step in STEPS if step[2] is TEMPLATE_SCHEMA)
        self.assertEqual(TEMPLATE_SCHEMA, ['ALTER TABLE hosted_seats ADD COLUMN template_id TEXT'])
        self.assertEqual(str(int(step[0]) + 1), step[1])
        self.workspace()
        self.sql("INSERT INTO hosted_seats(id,workspace_id,agent_id,inviter_id,owner_id,role,state,stage,version,created_ms,template_id) VALUES ('seat-kept','w1','agent-a','owner','owner','Kept','pending','profile',1,1,?)", ('template-' + '1' * 64,))
        with self.assertRaises(MigrationError) as caught:
            migrate(self.path, 'test-instance', self.binding, target=step[0])
        self.assertEqual(caught.exception.code, 'RECORDS_WOULD_BE_LOST')

    def test_empty_choice_step_can_go_down_and_up_without_changing_a_legacy_seat(self):
        from aim_next.migrations import STEPS, migrate
        from aim_next.hosted_seats import TEMPLATE_SCHEMA
        before, after = next(step[:2] for step in STEPS if step[2] is TEMPLATE_SCHEMA)
        self.workspace()
        self.command('workspace.hosted_seat_add', {'name': 'Legacy', 'role': 'Kept exact role.'},
                     {'workspace_id': 'w1'}, {'workspace_revision': self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]})
        kept = self.sql('SELECT id,agent_id,role,state,version FROM hosted_seats')
        self.assertEqual(migrate(self.path, 'test-instance', self.binding, target=before)['schema_version'], before)
        self.assertNotIn('template_id', [row[1] for row in self.sql('PRAGMA table_info(hosted_seats)')])
        self.assertEqual(migrate(self.path, 'test-instance', self.binding, target=after)['schema_version'], after)
        self.assertEqual(self.sql('SELECT id,agent_id,role,state,version FROM hosted_seats'), kept)
        self.assertEqual(self.sql('SELECT template_id FROM hosted_seats'), [(None,)])

    def test_catalogue_rejects_duplicate_paths_and_corruption_without_publishing_them(self):
        from aim_next.runner import RunnerError
        from aim_next.hosted_seats import TEMPLATE_KEY, TEMPLATE_BYTES
        self.workspace()
        option = {'id': 'template-' + '1' * 64, 'actor_id': 'agent-a', 'model': 'fixture', 'reasoning_effort': 'high'}
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            for options in ([option, option], [dict(option, codex_home='/private/fixture')], [dict(option, model='x'*201)]):
                with self.assertRaises(RunnerError):
                    self.store.hosted_seat_publish_templates(guard, token, options)
            self.assertEqual(self.sql('SELECT value FROM metadata WHERE key=?', (TEMPLATE_KEY,)), [])
            for value in ('x' * (TEMPLATE_BYTES + 1), json.dumps({'runner_token': token, 'items': [dict(option, codex_home='/private/fixture')]})):
                self.sql('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)', (TEMPLATE_KEY, value))
                read = self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})
                self.assertEqual(read['error']['code'], 'SEAT_TEMPLATES_UNAVAILABLE', read)
                self.assertNotIn('/private/fixture', json.dumps(read))
            self.store.hosted_seat_publish_templates(guard, token, [option])
            self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
            self.assertEqual(self.store.view('owner', 'hosted_seat_templates', {'workspace_id': 'w1'})['error']['code'], 'SEAT_TEMPLATES_UNAVAILABLE')

    def test_same_name_recovery_does_not_change_the_recorded_choice(self):
        self.workspace()
        options = [{'id': 'template-' + digit * 64, 'actor_id': actor, 'model': actor, 'reasoning_effort': 'high'}
                   for digit, actor in [('1', 'agent-a'), ('2', 'agent-b')]]
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.store.hosted_seat_publish_templates(guard, token, options)
            args = {'name': 'Same name', 'role': 'Kept role.', 'template_id': options[0]['id']}
            made = self.command('workspace.hosted_seat_add', args, {'workspace_id': 'w1'},
                                {'workspace_revision': self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]})
            answer = self.command('workspace.hosted_seat_add', dict(args, template_id=options[1]['id']), {'workspace_id': 'w1'},
                                  {'workspace_revision': self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]})
            self.assertEqual(answer['error']['code'], 'SEAT_TEMPLATE_MISMATCH', answer)
            self.assertEqual(self.sql('SELECT id,template_id FROM hosted_seats'), [(made['result']['seat_request_id'], options[0]['id'])])


class HostTemplateChoice(unittest.TestCase):
    def config(self, actor, model):
        return SimpleNamespace(profile=SimpleNamespace(actor_id=actor), permission_mode='full',
            destination={'codex_home': '/isolated/fixture-home'}, codex_executable='/isolated/codex',
            cli='/isolated/theseus', model=model, reasoning_effort='high')

    def test_two_distinct_settings_use_the_recorded_second_choice(self):
        first, second = self.config('first', 'fixture-one'), self.config('second', 'fixture-two')
        loop = SimpleNamespace(host=SimpleNamespace(threads={
            'one': SimpleNamespace(config=first), 'two': SimpleNamespace(config=second)}))
        with tempfile.TemporaryDirectory() as directory:
            host = SeatHost(loop, directory=directory, template_actor='first')
            choices = host.template_options()
            chosen = next(row for row in choices if row['actor_id'] == 'second')
            plan = host._plan({'id': 'seat-choice', 'agent_id': 'new-seat', 'template_id': chosen['id']})
            self.assertEqual((plan['model'], plan['reasoning_effort']), ('fixture-two', 'high'))
            self.assertEqual(plan['codex_home'], '/isolated/fixture-home')
            self.assertEqual(plan['cwd'], str(Path(directory).resolve() / 'seats/seat-choice/work'))

    def test_identical_settings_deduplicate_and_an_unavailable_choice_never_falls_back(self):
        from aim_next.seat_host import SeatRefusal
        first, second = self.config('first', 'fixture-one'), self.config('second', 'fixture-one')
        loop = SimpleNamespace(host=SimpleNamespace(threads={'one': SimpleNamespace(config=first), 'two': SimpleNamespace(config=second)}))
        with tempfile.TemporaryDirectory() as directory:
            host = SeatHost(loop, directory=directory, template_actor='first')
            self.assertEqual(len(host.template_options()), 1)
            with self.assertRaises(SeatRefusal) as caught:
                host._plan({'id': 'seat-choice', 'agent_id': 'new-seat', 'template_id': 'template-'+'0'*64})
            self.assertEqual(caught.exception.reason, 'host_template_unavailable')
            self.assertEqual(list(Path(directory).iterdir()), [])


class TemplateCLI(unittest.TestCase):
    from test_seat_cli_1002 import SeatCLI as _helpers
    setUp_store, setUp, command, workspace, sql, invoke = (_helpers.setUp_store, _helpers.setUp, _helpers.command,
                                                        _helpers.workspace, _helpers.sql, _helpers.invoke)

    def test_named_choice_is_in_the_exact_saved_cli_operation_and_not_rebound(self):
        option = {'id': 'template-' + '1' * 64, 'actor_id': 'agent-a', 'model': 'fixture', 'reasoning_effort': 'high'}
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            self.store.hosted_seat_publish_templates(guard, token, [option])
            listing = self.invoke('seat-templates', 'w1', as_json=False)
            self.assertEqual(listing[0], 0, listing); self.assertIn(option['id'], listing[1])
            args = ('seat-add', 'w1', 'Chosen', '--role', '-', '--template', option['id'], '--operation', 'chosen-once')
            self.assertEqual(self.invoke(*args)[0], 0)
            path = self.profiles['owner'].parent / 'owner.outbox/chosen-once.request.json'
            kept = path.read_bytes()
            self.assertEqual(json.loads(kept)['command']['args']['template_id'], option['id'])
            self.store.hosted_seat_publish_templates(guard, token, [])
            self.assertEqual(self.invoke('retry', 'chosen-once')[0], 0)
            self.assertEqual(path.read_bytes(), kept)
            self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])

    def test_cli_retry_selects_for_an_existing_unplanned_seat(self):
        self.assertEqual(self.invoke('seat-add', 'w1', 'Legacy', '--role', '-')[0], 0)
        option = {'id': 'template-' + '2' * 64, 'actor_id': 'agent-b', 'model': 'fixture-two', 'reasoning_effort': 'high'}
        with self.store.runner_guard('template-fixture') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'refused', {'reason': 'host_template_ambiguous'})
            self.store.hosted_seat_publish_templates(guard, token, [option])
            args = ('seat-retry', 'w1', seat['id'], '--template', option['id'], '--operation', 'choose-legacy')
            result = self.invoke(*args); self.assertEqual(result[0], 0, result)
            path = self.profiles['owner'].parent / 'owner.outbox/choose-legacy.request.json'
            kept = path.read_bytes()
            self.assertEqual(json.loads(kept)['command']['args'], {'template_id': option['id']})
            self.assertEqual(self.invoke(*args)[0], 0); self.assertEqual(path.read_bytes(), kept)
            self.assertEqual(self.sql('SELECT id,agent_id,template_id FROM hosted_seats'), [(seat['id'], 'legacy', option['id'])])


class TemplateAcquisition(unittest.TestCase):
    from test_effects_runner import EffectsRunnerCase as _helpers
    setUp, api, loop, sql, save = (_helpers.setUp, _helpers.api, _helpers.loop, _helpers.sql, _helpers.save)

    def options(self):
        return [{'id': 'template-'+'1'*64, 'actor_id': 'agent-a', 'model': 'fixture', 'reasoning_effort': 'high'}]

    def traced(self, action):
        from unittest import mock
        from aim_next import store as storage
        statements = []
        original = storage._connect
        def connect(path, *args, **kwargs):
            db, facts = original(path, *args, **kwargs)
            db.set_trace_callback(lambda sql: statements.append((self.clock.elapsed, sql)))
            return db, facts
        with mock.patch.object(storage, '_connect', connect):
            result = action()
        return result, statements

    def test_empty_host_keeps_the_original_five_idle_writes_and_no_catalogue_row(self):
        self.wait.stop_at = 28
        result, statements = self.traced(lambda: self.loop(seat_directory=self.root/'seats'))
        self.assertEqual(result['status'], 'stopped')
        self.assertEqual([t for t, sql in statements if sql == 'BEGIN IMMEDIATE'], [0, 9, 18, 27, 28])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'"), [])

    def test_host_options_publish_once_in_acquire_without_an_extra_idle_write(self):
        from unittest import mock
        self.wait.stop_at = 28
        observed = []
        def observe():
            observed.extend(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'"))
            return False
        self.wait.events = [(0.5, observe)]
        with mock.patch('aim_next.seat_host.SeatHost.template_options', return_value=self.options()):
            result, statements = self.traced(lambda: self.loop(seat_directory=self.root/'seats'))
        self.assertEqual(result['status'], 'stopped')
        self.assertEqual([t for t, sql in statements if sql == 'BEGIN IMMEDIATE'], [0, 9, 18, 27, 28])
        writes = [sql for _, sql in statements if sql.startswith('INSERT OR REPLACE INTO metadata') and 'hosted_seat_templates.v1' in sql]
        self.assertEqual(len(writes), 1)
        self.assertEqual(json.loads(observed[0][0])['items'], self.options())

    def test_acquire_binds_options_to_its_new_token_in_one_transaction(self):
        with self.store.runner_guard('catalogue') as guard:
            result, statements = self.traced(lambda: self.store.acquire_runner(guard, seat_templates=self.options()))
            self.assertEqual(sum(sql == 'BEGIN IMMEDIATE' for _, sql in statements), 1)
            value = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'")[0][0])
            self.assertEqual(value, {'runner_token': result['runner_token'], 'items': self.options()})
            before = self.sql('SELECT state,version,runner_token FROM runner_state')
            busy = self.store.acquire_runner(guard, seat_templates=[])
            self.assertEqual(busy['status'], 'busy')
            self.assertEqual(self.sql('SELECT state,version,runner_token FROM runner_state'), before)
            self.assertEqual(json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'")[0][0]), value)

    def test_empty_successor_clears_the_old_catalogue_in_its_acquisition(self):
        with self.store.runner_guard('catalogue') as guard:
            self.store.acquire_runner(guard, seat_templates=self.options())
            self.clock.advance(31)
            result, statements = self.traced(lambda: self.store.acquire_runner(guard, seat_templates=[]))
            self.assertEqual(result['status'], 'acquired')
            self.assertEqual(sum(sql == 'BEGIN IMMEDIATE' for _, sql in statements), 1)
            self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'"), [])

    def test_resume_publishes_with_the_new_lease_and_invalid_options_roll_back_acquire(self):
        from aim_next.runner import RunnerError
        with self.store.runner_guard('previous') as guard:
            before = self.sql('SELECT state,version,runner_token FROM runner_state')
            with self.assertRaises(RunnerError):
                self.store.acquire_runner(guard, seat_templates=[dict(self.options()[0], model='x'*201)])
            self.assertEqual(self.sql('SELECT state,version,runner_token FROM runner_state'), before)
            self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'"), [])
            owned = self.store.acquire_runner(guard, seat_templates=self.options())
            paused = self.store.pause_runner(guard, owned['runner_token'], 'operator_pause')
        with self.store.runner_guard('resumed') as guard:
            resumed, statements = self.traced(lambda: self.store.resume_runner(guard, paused['version'], seat_templates=self.options()))
            self.assertEqual(sum(sql == 'BEGIN IMMEDIATE' for _, sql in statements), 1)
            value = json.loads(self.sql("SELECT value FROM metadata WHERE key='hosted_seat_templates.v1'")[0][0])
            self.assertEqual(value['runner_token'], resumed['runner_token'])
            self.assertNotEqual(value['runner_token'], owned['runner_token'])


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import ast
import builtins
import importlib
import inspect
import io
import json
import re
import sqlite3
import textwrap
import threading
import time
import unittest
from unittest import mock

from aim_next import cli, effects_runner, runner_faults
from aim_next.runner import RunnerError
from aim_next.contract import Refusal, StoreError
from aim_next.authority import RunnerGuard
import test_effects_runner as effects
import test_source_cover_cost_757 as covers


class StartupRulesCase(unittest.TestCase):
    def test_1038_actual_startup_raise_sites_preserve_314_fixed_codes(self):
        from aim_next import broker_routes, contract, store
        # Read the actual raises, not another hand-maintained list of codes.
        # BrokerBindingError is constructed at each of these startup/preflight
        # sites; StoreOpenError and ProfileError preserve the Core Refusal code.
        owners = [broker_routes._load_config, broker_routes.load_hosted_config,
                  broker_routes.preflight_route, broker_routes.preflight_hosted,
                  broker_routes.load_route_table, store.Store._check_instance,
                  contract._identifier]
        sites = []
        for owner in owners:
            found = []
            for node in ast.walk(ast.parse(textwrap.dedent(inspect.getsource(owner)))):
                if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call):
                    continue
                call = node.exc
                if isinstance(call.func, ast.Name) and call.func.id == 'BrokerBindingError':
                    error = broker_routes.BrokerBindingError()
                    found.append((node.lineno, error.code, [error]))
                if isinstance(call.func, ast.Name) and call.func.id == 'Refusal':
                    self.assertIsInstance(call.args[0], ast.Constant)
                    code = call.args[0].value
                    errors = [Refusal(code, 'text withheld')]
                    if owner is store.Store._check_instance:
                        errors += [effects_runner.StoreOpenError(code, 'text withheld'),
                                   effects_runner.ProfileError('text withheld', code=code)]
                    found.append((node.lineno, code, errors))
            self.assertTrue(found, owner.__qualname__)
            for line, code, errors in found:
                for error in errors:
                    with self.subTest(owner=owner.__qualname__, line=line, kind=type(error).__name__, code=code):
                        self.assertIsNotNone(re.fullmatch('[A-Za-z_]{1,64}', code), '314 startup grammar')
                        self.assertEqual(effects_runner._startup_reason(error), code)
                sites.append((owner.__qualname__, line, code))
        print(json.dumps({'actual_startup_raise_sites': sites}))

    def test_1038_startup_exact_type_and_fixed_code_boundaries(self):
        from aim_next.broker_routes import BrokerConfigError
        for code in ('future_owned_code', 'FUTURE_OWNED_CODE', 'a', '_' * 64):
            with self.subTest(code=code):
                self.assertEqual(effects_runner._startup_reason(BrokerConfigError(code)), code)
        for code in ('', '_' * 65, 'CODE_314', 'code space', 'code\n', 'é', None, 12):
            with self.subTest(code=code):
                self.assertIsNone(effects_runner._startup_reason(BrokerConfigError(code)))
        class Untrusted(BrokerConfigError):
            pass
        self.assertIsNone(effects_runner._startup_reason(Untrusted('DATABASE_BUSY')))

    def test_1038_kept_class_contract_does_not_expand_with_runtime_classes(self):
        before = runner_faults._CLASSES
        private = type('PRIVATE_DYNAMIC_SECRET', (Exception,), {})
        try:
            with mock.patch.object(builtins, 'PRIVATE_DYNAMIC_SECRET', private, create=True):
                importlib.reload(runner_faults)
                self.assertEqual(runner_faults._CLASSES, before)
                self.assertEqual(runner_faults.describe(private('PRIVATE'))['exception_class'], 'Exception')
        finally:
            importlib.reload(runner_faults)

    def test_1038_kept_class_contract_does_not_shrink_on_another_reader_runtime(self):
        kept = {'exception_class': 'DataError', 'message': 'Exception text withheld.'}
        try:
            with mock.patch.object(sqlite3, 'DataError', None):
                importlib.reload(runner_faults)
                try:
                    read = runner_faults.validate(kept)
                except ValueError:
                    self.fail('another runtime must still read the kept DataError record')
                self.assertEqual(read, kept)
        finally:
            importlib.reload(runner_faults)


class FaultCase(effects.EffectsRunnerCase):
    def storage(self, operation, **settings):
        with self.store.runner_guard('fault1038') as guard:
            runner = effects_runner.EffectsLoop(self.profile, self.store, guard, self.wait,
                {}, selected_executable=str(self.broker), clock=self.clock)
            self.runner = runner
            for key, value in settings.items():
                setattr(runner, key, value)
            token = self.store.acquire_runner(guard)['runner_token']
            return operation(runner, guard, token)

    def test_1038_startup_real_missing_route_root_keeps_binding_reason(self):
        # The captured pin is valid, then its scratch home disappears before
        # load_route_table's physical-identity check (the actual raise site).
        original = effects_runner.broker_routes.preflight_route
        def preflight(*args, **kwargs):
            config = original(*args, **kwargs)
            from pathlib import Path
            Path(config.destination['codex_home']).rmdir()
            return config
        with mock.patch.object(effects_runner.broker_routes, 'preflight_route', side_effect=preflight):
            result = self.foreground()
        self.assertEqual(result['status'], 'startup_failed')
        self.assertEqual(result['reason'], 'route_binding_changed')
        self.assertFalse(result['pause_saved'])
        self.assertEqual(self.sql('SELECT state FROM runner_state'), [('idle',)])

    def test_1038_startup_real_schema_refusal_survives_store_and_profile_wrappers(self):
        self.startup_metadata_refusal('schema_version', '-1', 'SCHEMA_MISMATCH')

    def test_1038_startup_real_instance_refusal_survives_store_and_profile_wrappers(self):
        self.startup_metadata_refusal('instance_id', 'other-scratch-instance', 'INSTANCE_MISMATCH')

    def startup_metadata_refusal(self, key, value, code):
        original = self.sql('SELECT value FROM metadata WHERE key=?', (key,))[0][0]
        try:
            with sqlite3.connect(str(self.path)) as db:
                db.execute('UPDATE metadata SET value=? WHERE key=?', (value, key))
            result = self.foreground()
            self.assertEqual(result['status'], 'startup_failed')
            self.assertEqual(result['reason'], code)
            self.assertFalse(result['pause_saved'])
            self.assertEqual(self.sql('SELECT state FROM runner_state'), [('idle',)])
        finally:
            with sqlite3.connect(str(self.path)) as db:
                db.execute('UPDATE metadata SET value=? WHERE key=?', (original, key))

    def test_1038_startup_real_runner_identifier_refusal_keeps_reason(self):
        result = effects_runner.run_foreground(self.profile_path, '', self.map_path,
                                               selected_executable=str(self.broker))
        self.assertEqual(result['status'], 'startup_failed')
        self.assertEqual(result['reason'], 'INVALID_ARGUMENT')
        self.assertFalse(result['pause_saved'])
        self.assertTrue(result['cleanup_confirmed'])
        self.assertEqual(self.sql('SELECT state FROM runner_state'), [('idle',)])

    def test_1038_storage_wait_uses_injected_clock_without_real_sleep(self):
        def check(runner, guard, token):
            calls = []
            def busy():
                calls.append(self.clock.monotonic())
                raise RunnerError('DATABASE_BUSY', 'Known clean retry', retryable=True)
            with self.assertRaises(RunnerError):
                runner._storage(busy)
            expected, now = [], 0.0
            for delay in (0.0, .1, .2, .4, .8, 1.0):
                now += delay; expected.append(now)
            self.assertEqual(calls, expected)
            self.assertEqual(self.clock.monotonic(), 2.5)
        with mock.patch.object(time, 'sleep', side_effect=AssertionError('real sleep bypasses injected clock')):
            self.storage(check)

    def test_1038_nonbusy_cause_is_kept_in_pause_and_health(self):
        secret = 'Bearer SECRET_TOKEN /Users/private/report.txt Message body PRIVATE'
        with mock.patch.object(self.store, 'runner_schedule', side_effect=ValueError(secret)):
            result = self.loop()
        self.assertEqual(result['status'], 'paused')
        event = next(e for e in self.trace if e['event'] == 'paused')
        self.assertIn('fault', event, 'catch-all pause must retain its originating safe diagnostic')
        self.assertEqual(event['fault']['exception_class'], 'ValueError')
        self.assertNotIn('SECRET', json.dumps(event))
        self.assertNotIn('/Users/', json.dumps(event))
        kept = self.store.runner_status()
        self.assertEqual(kept['fault'], event['fault'])
        health = self.store.view('owner', 'health', {})
        self.assertEqual(health['runner']['fault'], event['fault'])

    def test_1038_pause_write_failure_keeps_both_safe_causes_in_output(self):
        with mock.patch.object(self.store, 'runner_schedule', side_effect=ValueError('PRIVATE body')), \
                mock.patch.object(self.store, 'pause_runner', side_effect=OSError('PRIVATE /secret/token')):
            result = self.loop()
        self.assertEqual(result['status'], 'fatal_unsaved')
        event = next(e for e in self.trace if e['event'] == 'pause_unsaved')
        self.assertIn('fault', event)
        self.assertIn('pause_fault', event)
        self.assertEqual(event['fault']['exception_class'], 'ValueError')
        self.assertEqual(event['pause_fault']['exception_class'], 'OSError')
        self.assertEqual(result['fault'], event['fault'])
        self.assertEqual(result['pause_fault'], event['pause_fault'])
        self.assertNotIn('PRIVATE', json.dumps([event, result]))
        self.assertEqual(self.sql('SELECT state FROM runner_state'), [('running',)])

    def test_1038_real_writer_releases_after_confirmed_busy_and_same_act_recovers(self):
        def check(runner, guard, token):
            ready, release, done = threading.Event(), threading.Event(), threading.Event()
            errors = []
            def writer():
                try:
                    db = sqlite3.connect(str(self.path), isolation_level=None)
                    try:
                        db.execute('BEGIN IMMEDIATE'); ready.set(); release.wait(10)
                    finally:
                        db.close()
                except BaseException as e:
                    errors.append(e)
                finally:
                    done.set()
            thread = threading.Thread(target=writer); thread.start(); self.assertTrue(ready.wait(5))
            waits = []
            def pause(delay):
                waits.append(delay); release.set(); self.assertTrue(done.wait(5))
            runner.storage_sleep = pause
            answer = failure = None
            try:
                answer = runner._storage(lambda: self.store.renew_runner(guard, token))
            except RunnerError as e:
                failure = e.code
            finally:
                release.set(); thread.join(5)
            self.assertFalse(thread.is_alive()); self.assertEqual(errors, [])
            self.assertIsNone(failure, 'a confirmed rolled-back busy must retry after the writer releases')
            self.assertEqual(answer['status'], 'renewed')
            self.assertEqual(len(waits), 1)
            self.assertEqual(self.sql('SELECT runner_token FROM runner_state'), [(token,)])
            self.assertFalse(runner.cleanup_uncertain)
        self.storage(check)

    def test_1038_exhaustion_is_six_attempts_with_bounded_backoff(self):
        def check(runner, guard, token):
            elapsed, delays, calls = [0.0], [], []
            runner.storage_clock = lambda: elapsed[0]
            def sleep(delay):
                delays.append(delay); elapsed[0] += delay
            runner.storage_sleep = sleep
            def busy():
                calls.append(1)
                raise RunnerError('DATABASE_BUSY', 'Runner state is busy; no change was confirmed', retryable=True)
            with self.assertRaises(RunnerError):
                runner._storage(busy)
            self.assertEqual(len(calls), 6)
            self.assertEqual(delays, [.1, .2, .4, .8, 1.0])
            self.assertLessEqual(elapsed[0], 4)
            self.assertFalse(runner.cleanup_uncertain)
        self.storage(check)

    def test_1038_unknown_busy_named_error_is_never_retried(self):
        class PretendBusy(Exception):
            code, retryable = 'DATABASE_BUSY', True
        def check(runner, guard, token):
            operation = mock.Mock(side_effect=PretendBusy('PRIVATE'))
            with self.assertRaises(PretendBusy): runner._storage(operation)
            self.assertEqual(operation.call_count, 1)
            self.assertTrue(runner.cleanup_uncertain)
        self.storage(check)

    def test_1038_real_nonbusy_sqlite_error_with_busy_in_its_table_name_is_not_retried(self):
        def check(runner, guard, token):
            hits = []
            def missing(db):
                hits.append(1)
                return db.execute('SELECT * FROM busy_private_missing_table').fetchone()
            with mock.patch.object(self.store, '_runner_state', side_effect=missing):
                with self.assertRaises(RunnerError) as caught:
                    runner._storage(lambda: self.store.renew_runner(guard, token))
            self.assertEqual(caught.exception.code, 'RUNNER_STORAGE_ERROR')
            self.assertEqual(hits, [1], 'a real missing-table fault is not lock contention')
            self.assertNotIn('busy_private', json.dumps(effects_runner.safe_fault(caught.exception)))
        self.storage(check)

    def test_1038_committed_then_busy_is_uncertain_and_never_replayed(self):
        connect = sqlite3.connect
        calls = []
        class AfterCommit(sqlite3.Connection):
            def commit(self):
                super().commit(); calls.append('committed')
                raise sqlite3.OperationalError('database is locked')
        def check(runner, guard, token):
            before = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
            with mock.patch.object(sqlite3, 'connect', side_effect=lambda *a, **kw: connect(*a, factory=AfterCommit, **kw)):
                with self.assertRaises(RunnerError) as caught:
                    runner._storage(lambda: self.store.renew_runner(guard, token))
            self.assertEqual(caught.exception.code, 'RUNNER_STORAGE_ERROR')
            self.assertEqual(calls, ['committed'])
            self.assertEqual(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), before + 1)
            self.assertTrue(runner.cleanup_uncertain)
        self.storage(check)

    def test_1038_resume_keeps_prior_fault_without_changing_version_fence(self):
        with mock.patch.object(self.store, 'runner_schedule', side_effect=KeyError('PRIVATE')):
            self.loop()
        paused = self.store.runner_status()
        self.assertIn('fault', paused)
        with self.store.runner_guard('new1038') as guard:
            answer = self.store.resume_runner(guard, paused['version'])
        self.assertEqual(answer['status'], 'acquired')
        health = self.store.view('owner', 'health', {})
        self.assertEqual(health['runner']['prior']['fault'], paused['fault'])
        self.assertNotIn('fault', health['runner'])

    def test_1038_safe_diagnostics_never_copy_adversarial_exception_text_or_names(self):
        class BadString(Exception):
            def __str__(self): raise AssertionError('must not call arbitrary exception formatting')
        class BadDescriptor(Exception):
            def __getattribute__(self, name):
                if name == '__cause__': raise ValueError('PRIVATE unsafe diagnostic descriptor')
                return super().__getattribute__(name)
        private = 'Bearer SECRET /Users/private/body.txt https://host/?token=SECRET PRIVATE_MESSAGE'
        cases = [ValueError(private), OSError(private), KeyError(private), BadString(private), BadDescriptor(private),
                 sqlite3.OperationalError('database is locked: ' + private),
                 type('PRIVATE_MESSAGE_SECRET', (Exception,), {})(private)]
        for error in cases:
            with self.subTest(kind=type(error).__name__):
                fault = effects_runner.safe_fault(error)
                text = json.dumps(fault)
                for word in ('SECRET', '/Users/', 'https://', 'PRIVATE_MESSAGE', 'Bearer'):
                    self.assertNotIn(word, text)
                self.assertLessEqual(len(text), 200)
        self.assertEqual(effects_runner.safe_fault(sqlite3.OperationalError('database is locked')),
                         {'exception_class': 'OperationalError', 'message': 'database is locked'})
        self.assertEqual(effects_runner._fault_code(effects_runner.wake_adapter.AdapterFault('private_token')), 'AdapterFault')

    def test_1038_core_refuses_unsanitized_diagnostic_without_mutating_pause(self):
        def check(runner, guard, token):
            before = self.sql('SELECT state,version FROM runner_state')
            for value in ({'exception_class': 'ValueError', 'message': 'PRIVATE body'},
                          {'exception_class': 'PRIVATE_TOKEN', 'message': 'Exception text withheld.'},
                          {'exception_class': 'ValueError', 'message': 'Exception text withheld.', 'extra': '/private'}):
                with self.assertRaises(RunnerError) as caught:
                    self.store.pause_runner(guard, token, 'storage_failure', fault=value)
                self.assertEqual(caught.exception.code, 'INVALID_ARGUMENT')
                self.assertEqual(self.sql('SELECT state,version FROM runner_state'), before)
        self.storage(check)

    def hosted_configs(self):
        # Startup map/preflight seams supply validated inputs; HostLog and Host
        # themselves execute the real refusal paths inside run_foreground.
        from aim_next.broker_routes import HostedConfig
        return {actor: HostedConfig('/scratch/config', str(self.profile_path), self.profile,
            '/scratch/cli', '/scratch/codex-' + actor,
            {'codex_home': str(self.root), 'thread_id': actor}, str(self.root), None, ())
            for actor in self.routes}

    def test_1038_foreground_retains_real_invalid_host_directory_reason(self):
        with mock.patch.object(effects_runner.broker_routes, 'load_route_table',
                return_value=(self.routes, frozenset(self.routes))), \
                mock.patch.object(effects_runner, 'NativeWatch', side_effect=AssertionError('too late')):
            result = self.foreground(host_dir='relative-private-host')
        self.assertEqual(result['status'], 'startup_failed')
        self.assertEqual(result['reason'], 'invalid_host_dir')
        self.assertFalse(result['pause_saved'])
        self.assertEqual(self.sql('SELECT state FROM runner_state'), [('idle',)])

    def test_1038_foreground_retains_real_conflicting_host_executable_reason(self):
        directory = self.root / 'private-host'; directory.mkdir(mode=0o700)
        configs = self.hosted_configs()
        with mock.patch.object(effects_runner.broker_routes, 'load_route_table',
                return_value=(self.routes, frozenset(self.routes))), \
                mock.patch.object(effects_runner.broker_routes, 'preflight_hosted',
                side_effect=lambda route, actor, profile: configs[actor]) as preflight:
            result = self.foreground(host_dir=str(directory))
        self.assertEqual(preflight.call_count, 2)
        self.assertEqual(result['status'], 'startup_failed')
        self.assertEqual(result['reason'], 'conflicting_codex_executable')
        self.assertFalse(result['pause_saved'])
        self.assertTrue(result['cleanup_confirmed'])
        self.assertEqual(self.sql('SELECT state FROM runner_state'), [('idle',)])

    def fault_cli(self):
        out, err = io.StringIO(), io.StringIO()
        status = cli.main(['--profile', str(self.profile_path), 'health'], stdout=out, stderr=err)
        self.assertEqual(status, 0, err.getvalue())
        self.assertNotIn('PRIVATE', out.getvalue())
        return out.getvalue()

    def test_1038_cli_health_says_current_safe_pause_fault(self):
        with mock.patch.object(self.store, 'runner_schedule', side_effect=ValueError('PRIVATE body')):
            self.loop()
        self.assertIn('ValueError: Invalid value; exception text withheld.', self.fault_cli())

    def test_1038_cli_health_says_prior_safe_pause_fault_after_actual_resume(self):
        with mock.patch.object(self.store, 'runner_schedule', side_effect=KeyError('PRIVATE body')):
            self.loop()
        paused = self.store.runner_status()
        with self.store.runner_guard('cli-resumed1038') as guard:
            self.assertEqual(self.store.resume_runner(guard, paused['version'])['status'], 'acquired')
        health = self.store.view('owner', 'health', {})
        self.assertNotIn('fault', health['runner'])
        self.assertEqual(health['runner']['prior']['fault']['exception_class'], 'KeyError')
        self.assertIn('KeyError: Required value missing; exception text withheld.', self.fault_cli())

    def test_1038_startup_fault_retains_safe_class_without_exposing_profile_input(self):
        with mock.patch.object(effects_runner, 'load_profile', side_effect=ValueError('/PRIVATE/token body')):
            result = effects_runner.run_foreground('/unused', 'unused', '/unused')
        self.assertEqual(result['status'], 'startup_failed')
        self.assertEqual(result['fault']['exception_class'], 'ValueError')
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_1038_old_code_reacquisition_cannot_reuse_a_stale_diagnostic(self):
        with mock.patch.object(self.store, 'runner_schedule', side_effect=ValueError('PRIVATE')):
            self.loop()
        self.assertIn('fault', self.store.view('owner', 'health', {})['runner'])
        # Simulate the real old writer's record transition in this scratch DB:
        # old code knows the guard generation but not the new metadata keys.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE runner_state SET state='running',version=version+1,guard_generation='different-old-code-generation'")
        health = self.store.view('owner', 'health', {})
        self.assertNotIn('fault', health['runner'])

    def test_1038_startup_cannot_echo_unknown_codes_or_trust_unknown_busy_classes(self):
        for code in ('PRIVATE_TOKEN', 'DATABASE_BUSY'):
            with self.subTest(code=code):
                error = type('PRIVATE_MESSAGE_SECRET', (Exception,), {'code': code, 'retryable': True})('PRIVATE body')
                with mock.patch.object(effects_runner, 'load_profile', side_effect=error):
                    result = effects_runner.run_foreground('/unused', 'unused', '/unused')
                self.assertIsNone(result['reason'])
                self.assertFalse(result['retryable'])
                self.assertNotIn('PRIVATE', json.dumps(result))

    def test_1038_later_cleanup_fault_preserves_the_actual_saved_pause_and_first_cause(self):
        watches = []
        original_watch = effects_runner.NativeWatch
        original_close = RunnerGuard.close
        class Watch(original_watch):
            def __init__(self, path):
                super().__init__(path); watches.append(self)
        def close(guard):
            original_close(guard)
            raise OSError('PRIVATE /Users/secret cleanup token')
        try:
            with mock.patch.object(effects_runner, 'NativeWatch', Watch), \
                    mock.patch.object(effects.Store, 'runner_schedule', side_effect=ValueError('PRIVATE original')), \
                    mock.patch.object(RunnerGuard, 'close', close):
                result = self.foreground()
            self.assertEqual(result['status'], 'fatal_unsaved')
            self.assertEqual(result['reason'], 'guard_close_unconfirmed')
            self.assertTrue(result['pause_saved'], 'later cleanup cannot erase a real committed pause')
            self.assertEqual(result['fault']['exception_class'], 'ValueError')
            self.assertEqual(result['cleanup_fault']['exception_class'], 'OSError')
            self.assertEqual(self.store.runner_status()['fault'], result['fault'])
            self.assertNotIn('PRIVATE', json.dumps(result))
        finally:
            # The controlled failure happened before any schedule connection
            # opened; teardown closes only these known fixture-owned watches.
            for watch in watches:
                if watch in effects_runner._UNCONFIRMED_WATCHES:
                    effects_runner._UNCONFIRMED_WATCHES.remove(watch)
                watch.close()

    def test_1038_actual_continuing_writer_exhausts_without_partial_mutation(self):
        def check(runner, guard, token):
            # This observation measures actual SQLite waits and elapsed time;
            # it deliberately selects the production clock rather than virtual time.
            runner.storage_clock = time.monotonic
            writer = sqlite3.connect(str(self.path), isolation_level=None)
            before = self.sql('SELECT version,runner_token,lease_until_ms FROM runner_state')
            calls, delays = [], []
            original = self.store.renew_runner
            def renew():
                calls.append(time.monotonic()); return original(guard, token)
            def sleep(delay):
                delays.append(delay); time.sleep(delay)
            runner.storage_sleep = sleep
            writer.execute('BEGIN IMMEDIATE'); started = time.monotonic()
            try:
                with self.assertRaises(RunnerError) as caught: runner._storage(renew)
            finally:
                writer.close()
            elapsed = time.monotonic() - started
            self.assertEqual(caught.exception.code, 'DATABASE_BUSY')
            self.assertGreaterEqual(len(calls), 2); self.assertLessEqual(len(calls), 6)
            self.assertLessEqual(sum(delays), 2.5)
            self.assertEqual(self.sql('SELECT version,runner_token,lease_until_ms FROM runner_state'), before)
            print(json.dumps({'actual_sqlite_exhaustion_attempts': len(calls), 'backoffs': delays,
                              'observed_seconds': round(elapsed, 4), 'partial_mutation': False}))
        self.storage(check)

    def test_1038_real_writer_prevents_pause_without_inventing_a_kept_record(self):
        def check(runner, guard, token):
            runner.token = token
            runner.lease = self.store.runner_status()['lease_until_ms']
            runner.emit = self.trace.append
            before = self.sql('SELECT state,version,runner_token FROM runner_state')
            writer = sqlite3.connect(str(self.path), isolation_level=None)
            writer.execute('BEGIN IMMEDIATE')
            calls = []
            original = self.store.pause_runner
            def pause(*args, **kwargs):
                calls.append(True)
                return original(*args, **kwargs)
            try:
                with mock.patch.object(self.store, 'runner_schedule', side_effect=ValueError('PRIVATE original')), \
                        mock.patch.object(self.store, 'pause_runner', side_effect=pause):
                    result = runner.run()
            finally:
                writer.close()
            self.assertEqual(result['status'], 'fatal_unsaved')
            self.assertFalse(result['pause_saved'])
            self.assertGreaterEqual(len(calls), 2)
            self.assertLessEqual(len(calls), 6)
            self.assertEqual(result['fault']['exception_class'], 'ValueError')
            self.assertEqual(result['pause_fault'], {'exception_class': 'OperationalError', 'message': 'database is locked'})
            self.assertEqual(next(e for e in self.trace if e['event'] == 'pause_unsaved')['pause_fault'], result['pause_fault'])
            self.assertEqual(self.sql('SELECT state,version,runner_token FROM runner_state'), before)
            self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='runner_fault.v1:current'"), [])
            self.assertNotIn('PRIVATE', json.dumps(result))
        self.storage(check)


class FanoutCase(covers.SourceCoverCostCase):
    def test_1038_added_source_query_work_does_not_grow_with_duplicate_history(self):
        from aim_next.store import _connect
        root = self.post('History source'); number = self.file('Work', root)
        self.thread(root, count=100, readers=10, sources=True)
        def measured(label):
            mid = self.post(label); steps = [0]
            def connect(*args, **kwargs):
                db, settings = _connect(*args, **kwargs)
                def tick(): steps[0] += 1; return 0
                db.set_progress_handler(tick, 1)
                return db, settings
            with mock.patch('aim_next.store._connect', side_effect=connect):
                self.committed(self.command('pipeline.source_add', {'sources': [{'message_id': mid}]},
                                            {'workspace_id': 'w1', 'number': number}))
            return steps[0]
        first = measured('First added source')
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO pipeline_item_sources VALUES ('w1',?,?,?,NULL,NULL,'owner',1)",
                           [(number, 1000+n, root) for n in range(4000)])
        second = measured('Second added source')
        print(json.dumps({'source_add_vm_steps_before': first, 'after_4000_old_duplicates': second}))
        self.assertLessEqual(second - first, 100,
            'one added source must not walk4000 old duplicates: before=%d after=%d' % (first, second))

    def test_1038_source_add_does_not_reinvalidate_item_source_history(self):
        old = self.post('Old source'); number = self.file('Work', old)
        self.thread(old, count=100, readers=10, sources=True)
        new = self.post('New source')
        before = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        receipt = self.committed(self.command('pipeline.source_add', {'sources': [{'message_id': new}]},
                    {'workspace_id': 'w1', 'number': number}))
        rows = self.sql("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,))
        self.assertLessEqual(len(rows), 20, 'adding one source must not fan out all101 historical sources')
        self.assertEqual({r[2] for r in rows if r[0] == 'source_cover_read'}, {new})
        self.assertEqual(len(self.shown(new)['cover']['items']), 1)
        self.assertEqual(self.sql('SELECT count(*) FROM pipeline_item_sources WHERE number=?', (number,)), [(102,)])
        self.assertEqual(receipt['number'], number)

    def source_key_boundary(self, count):
        from aim_next import source_item_covers
        root = self.post('Boundary source'); number = self.file('Work', root)
        ids = self.thread(root, count=count, readers=3)
        before = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        self.committed(self.command('pipeline.source_add', {'sources': [{'message_id': mid} for mid in ids]},
                                   {'workspace_id': 'w1', 'number': number}))
        rows = self.sql("SELECT resource_kind,scope_id,resource_id,seq FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,))
        owned = [row for row in rows if row[1] == 'owner']
        topic = self.sql('SELECT topic_id FROM messages WHERE id=?', (root,))[0][0]
        topic_rows = [row for row in owned if row[0] == 'source_cover']
        self.assertEqual([(row[1], row[2]) for row in topic_rows], [('owner', topic)])
        bulk = self.sql('SELECT value FROM metadata WHERE key=?', (source_item_covers._bulk_key('owner', topic),))
        if count == 32:
            self.assertEqual(len(owned), 33)
            self.assertEqual({row[2] for row in owned if row[0] == 'source_cover_read'}, set(ids))
            self.assertEqual(bulk, [])
        else:
            self.assertEqual(count, 33)
            self.assertEqual(len(owned), 1)
            self.assertEqual(bulk, [(str(topic_rows[0][3]),)])
        self.assertEqual(self.sql('SELECT count(*) FROM pipeline_item_sources WHERE number=?', (number,)), [(count + 1,)])
        self.assertEqual(len(self.shown(ids[-1])['cover']['items']), 1)

    def test_1038_32_added_sources_keep_individual_keys(self):
        self.source_key_boundary(32)

    def test_1038_33_added_sources_use_topic_and_bulk_clock(self):
        self.source_key_boundary(33)

    def test_1038_large_added_source_group_uses_existing_bulk_clock(self):
        root = self.post('Original source'); number = self.file('Work', root)
        ids = self.thread(root, count=64, readers=10)
        before = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        self.committed(self.command('pipeline.source_add', {'sources': [{'message_id': mid} for mid in ids]},
                                   {'workspace_id': 'w1', 'number': number}))
        rows = self.sql("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,))
        self.assertLessEqual(len(rows), 10, 'existing bulk clock replaces source amplification per reader/topic')
        self.assertEqual({r[0] for r in rows}, {'source_cover'})
        self.assertEqual(len({(r[1], r[2]) for r in rows}), 10)
        self.assertEqual(self.sql('SELECT count(*) FROM pipeline_item_sources WHERE number=?', (number,)), [(65,)])
        self.assertEqual(len(self.shown(ids[-1])['cover']['items']), 1)

    def test_1038_source_notification_failure_rolls_back_relation_and_item_revision(self):
        root = self.post('Existing source'); number = self.file('Work', root)
        new = self.post('Added source')
        before = self.sql('SELECT version FROM pipeline_items WHERE number=?', (number,))
        from aim_next import source_item_covers
        with mock.patch.object(source_item_covers, 'notify', side_effect=sqlite3.OperationalError('disk I/O error')):
            with self.assertRaises(StoreError):
                self.command('pipeline.source_add', {'sources': [{'message_id': new}]},
                             {'workspace_id': 'w1', 'number': number})
        self.assertEqual(self.sql('SELECT version FROM pipeline_items WHERE number=?', (number,)), before)
        self.assertEqual(self.sql('SELECT count(*) FROM pipeline_item_sources WHERE number=?', (number,)), [(1,)])

    def test_1038_added_batch_preserves_addressed_only_reader_and_destination_privacy(self):
        root = self.post('Source topic')
        ids = self.thread(root, count=64, readers=3)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('address-only','human','Address only')")
            db.execute("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1','address-only')")
        addressed = self.post('A source for this reader', addressees=['address-only'])
        self.committed(self.command('workspace.create', {'id': 'delta-private', 'title': 'Private work', 'team': ['address-only']}))
        self.committed(self.command('pipeline.configure', {'enabled': True}, {'workspace_id': 'delta-private'}, {'pipeline_revision': 0}))
        number = self.committed(self.command('pipeline.item_add', {'title': 'Actual work', 'sources': [{'message_id': root}]}, {'workspace_id': 'delta-private'}))['number']
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.member_set', {'actor_id': 'address-only', 'present': False}, {'workspace_id': 'w1'}, {'workspace_revision': revision}))
        before = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        self.committed(self.command('pipeline.source_add', {'sources': [{'message_id': mid} for mid in ids + [addressed]]}, {'workspace_id': 'delta-private', 'number': number}))
        rows = self.sql("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,))
        self.assertEqual(set(rows), {('source_cover', 'owner', 't1'), ('source_cover', 'address-only', 't1'), ('source_cover_read', 'address-only', addressed)})
        self.assertEqual(len(rows), 3)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_item_sources WHERE workspace_id='delta-private' AND number=?", (number,)), [(66,)])
        self.assertEqual(len(self.shown(addressed)['cover']['items']), 1)
        # An opaque addressed-only invalidation does not override topic access.
        denied = self.store.view('address-only', 'dossier_cover', {'message_id': addressed})
        self.assertEqual(denied['error']['code'], 'FORBIDDEN')


def load_tests(loader, tests, pattern):
    # Reuse real scratch fixture setup without rerunning inherited test methods.
    return unittest.TestSuite(cls(name) for cls in (FaultCase, FanoutCase)
        for name in cls.__dict__ if name.startswith('test_1038_'))

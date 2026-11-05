from __future__ import annotations

import importlib
import importlib.util
import fcntl
import json
import os
from pathlib import Path
import signal
import select
import sqlite3
import subprocess
import threading
import time
import unittest
from unittest import mock

from aim_next import Store
from aim_next import broker_routes, wake_adapter
from aim_next.effects_watch import NativeWatch
from aim_next.profile import load_profile, write_profile
from aim_next.route_pins import RoutePinError
from aim_next.runner import RunnerError
import test_store as core_fixture
import test_delivery as delivery_fixture


class Clock:
    def __init__(self):
        self.wall = int(time.time()*1000)
        self.elapsed = 0.0

    def wall_ms(self):
        return self.wall

    def monotonic(self):
        return self.elapsed

    def advance(self, seconds):
        self.elapsed += seconds
        self.wall += round(seconds*1000)


class Wait:
    """Explicit controlled clock, with deadlines independently observed by tests."""
    def __init__(self, clock, stop_at=2):
        self.clock, self.stop_at = clock, stop_at
        self.stopped = False
        self.waits = []
        self.events = []
        self.calls = 0

    def wait(self, timeout):
        self.calls += 1
        if self.calls > 2000:
            raise AssertionError('scheduler hot loop')
        self.waits.append((self.clock.elapsed, timeout))
        target = min(self.stop_at, self.clock.elapsed+timeout)
        dirty = False
        if self.events and self.events[0][0] <= target:
            when, action = self.events.pop(0)
            target = max(self.clock.elapsed, when)
            self.clock.advance(target-self.clock.elapsed)
            dirty = bool(action())
        else:
            self.clock.advance(target-self.clock.elapsed)
        self.stopped = self.stopped or self.clock.elapsed >= self.stop_at
        return dict(dirty=dirty, stop=self.stopped)


class EffectsRunnerCase(unittest.TestCase):
    command = core_fixture.StoreCase.command
    workspace = core_fixture.StoreCase.workspace
    save_draft = core_fixture.StoreCase.save_draft
    prepare = core_fixture.StoreCase.prepare
    create_topic = core_fixture.StoreCase.create_topic
    send_next = delivery_fixture.DeliveryCase.send_next

    def sql(self, statement, params=()):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute(statement, params).fetchall()
        finally:
            db.close()

    def setUp(self):
        core_fixture.StoreCase.setUp(self)
        self.root = self.path.parent.resolve()
        self.clock = Clock()
        clock_patch = mock.patch('aim_next.delivery._now_ms',side_effect=self.clock.wall_ms)
        clock_patch.start(); self.addCleanup(clock_patch.stop)
        self.clock_patch = clock_patch
        self.wait = Wait(self.clock)
        self.trace = []
        self.profile_path = self.root/'runner.json'
        write_profile(self.profile_path,self.path,'test-instance','owner',binding=self.binding)
        self.profile = load_profile(self.profile_path)
        self.broker = self.root/'fixture-broker'
        # No descendants, network or real queue. Input and identity are saved
        # before exit, and the actual invocation adapter owns its whole lifetime.
        self.broker.write_text('#!/usr/bin/python3\nimport json,os,sys\nfrom pathlib import Path\n'
            'p=Path(sys.argv[2]); v=json.loads(p.read_text()); h=json.load(sys.stdin)\n'
            'out=p.with_suffix(".observation.json")\n'
            'out.write_text(json.dumps(dict(hint=h,pid=os.getpid(),pgid=os.getpgrp())))\n')
        self.broker.chmod(0o700)
        self.routes = {}
        for index, actor in enumerate(('agent-a','agent-b')):
            profile = self.root/(actor+'.profile')
            write_profile(profile,self.path,'test-instance',actor,binding=self.binding)
            home = self.root/(actor+'-home'); home.mkdir(mode=0o700)
            destination = dict(kind='codex-queue-stdio',protocol_version=1,
                codex_home=str(home),thread_id='12345678-1234-4234-8234-%012d' % index)
            with self.store.runner_guard('provision') as guard:
                self.store.provision_route_pin(guard,actor,destination)
            config = self.root/(actor+'.config')
            self.save(config,dict(v=1,profile=str(profile),codex_executable='/usr/bin/python3',
                                  destination=destination))
            route = self.root/(actor+'.route')
            self.save(route,dict(v=1,profile=str(profile),argv=[str(self.broker),'--config',str(config)]))
            self.routes[actor] = str(route)
        self.map_path = self.root/'routes.json'
        self.save(self.map_path,dict(v=1,routes=self.routes))

    def save(self, path, value):
        path.write_text(json.dumps(value));path.chmod(0o600)

    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('aim_next.effects_runner'),
                             'foreground effects runner must exist')
        return importlib.import_module('aim_next.effects_runner')

    def loop(self, **kwargs):
        api = self.api()
        selected = broker_routes.load_route_map(self.map_path,self.profile,
                                               selected_executable=str(self.broker))
        with self.store.runner_guard('loop-fixture') as guard, \
                mock.patch('aim_next.delivery._now_ms',side_effect=self.clock.wall_ms):
            runner = api.EffectsLoop(self.profile,self.store,guard,self.wait,selected,
                selected_executable=str(self.broker),clock=self.clock,
                emit=self.trace.append,**kwargs)
            self.runner = runner
            return runner.run()

    def assert_pause(self, reason, settled=0):
        self.assertEqual(self.sql('SELECT state,reason_code FROM runner_state'),[('paused',reason)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'),[(settled,)])

    def test_actual_broker_registers_settles_once_and_never_acknowledges(self):
        self.api(); self.create_topic()
        self.send_next(); self.send_next()
        before = self.sql('SELECT id,state FROM deliveries ORDER BY id')
        result = self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(self.sql('SELECT id,state FROM deliveries ORDER BY id'),before)
        row = self.sql('SELECT id,recipient_id,wake_generation FROM wake_attempts')[0]
        observation=self.root/'agent-a.observation.json'
        self.assertTrue(observation.is_file(),'the claimed recipient must receive the broker invocation')
        observed = json.loads(observation.read_text())
        self.assertEqual(observed['hint']['attempt_id'],row[0])
        self.assertEqual(observed['hint']['binding']['actor_id'],row[1])
        self.assertEqual(observed['hint']['wake_generation'],row[2])
        self.assertEqual(observed['pid'],observed['pgid'])
        with self.assertRaises(ProcessLookupError): os.kill(observed['pid'],0)
        self.assertEqual(self.sql('SELECT child_pid FROM runner_state'),[(None,)])

    def test_people_and_unrouted_agents_are_never_woken_across_cycles(self):
        self.api(); self.create_topic()
        self.store.register_actor('agent-c','agent','Unrouted fixture agent')
        self.command('participation.set',{'actor_id':'agent-c','present':True},target={'topic_id':'t1'})
        posted=self.command('message.post',{'body':'For everyone else'},target={'topic_id':'t1'},actor='agent-a')
        self.assertEqual(posted['status'],'committed',posted)
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE state='pending' ORDER BY recipient_id"),
                         [('agent-a',),('agent-c',),('owner',)])
        # Four sixty-second cooldowns: agent-a is woken each cycle, nobody else ever.
        self.wait.stop_at=200
        self.assertEqual(self.loop()['status'],'stopped')
        attempts=self.sql('SELECT recipient_id FROM wake_attempts')
        self.assertGreaterEqual(len(attempts),3,attempts)
        self.assertEqual(set(attempts),{('agent-a',)})
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE state='pending' ORDER BY recipient_id"),
                         [('agent-a',),('agent-c',),('owner',)])
        # The same 200 s with only agent-a pending takes 86 waits (renewals,
        # reads and claims); a due person must not add a read every second.
        self.assertLessEqual(self.wait.calls,90,'a due person must not make the idle loop spin')

    def test_second_due_recipient_is_not_delayed_by_first_cooldown(self):
        self.api(); self.create_topic(); self.send_next(addressees=['agent-b'])
        self.loop()
        self.assertEqual(self.sql('SELECT recipient_id FROM wake_attempts ORDER BY recipient_id'),
                         [('agent-a',),('agent-b',)])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',),('accepted',)])
        self.assertLess(self.clock.elapsed,3)

    def test_idle_has_only_acquire_and_nine_second_renewal_transactions(self):
        self.api(); self.wait.stop_at=28
        statements=[]
        from aim_next import store as storage
        original=storage._connect
        def connect(path):
            db,facts=original(path)
            db.set_trace_callback(lambda sql: statements.append((self.clock.elapsed,sql)))
            return db,facts
        with mock.patch.object(storage,'_connect',connect): self.loop()
        writers=[(t,s) for t,s in statements if s=='BEGIN IMMEDIATE']
        self.assertEqual([t for t,s in writers],[0,9,18,27])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])
        self.assertTrue(any('sqlite_autoindex_recipient_schedule_1' in s for _,s in statements))
        self.assertFalse(any('count(*)' in s.lower() for _,s in statements))

    def test_returned_acquire_busy_waits_lease_and_signal_can_stop_it(self):
        self.api()
        with mock.patch('aim_next.delivery._now_ms',side_effect=self.clock.wall_ms):
            with self.store.runner_guard('previous') as guard:
                self.store.acquire_runner(guard,lease_ms=30000)
        self.wait.stop_at=10
        calls=[];original=self.store.acquire_runner
        def acquire(*args,**kwargs):
            calls.append(self.clock.elapsed);return original(*args,**kwargs)
        self.wait.events=[(0.1,lambda: True),(0.2,lambda: True),(5,lambda: True)]
        with mock.patch.object(self.store,'acquire_runner',acquire): result=self.loop()
        self.assertEqual(calls,[0])
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])

    def test_preclaim_busy_pacing_survives_hints_and_successful_reads(self):
        self.api(); self.create_topic(); self.wait.stop_at=8
        calls=[];original=self.store.claim_wakes
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            if len(calls)<4: raise RunnerError('DATABASE_BUSY','fixture',retryable=True)
            return original(*args,**kwargs)
        self.wait.events=[(t,lambda: True) for t in (0.2,0.5,1.1,2,3.1,4,6)]
        with mock.patch.object(self.store,'claim_wakes',claim): self.loop()
        self.assertEqual(calls,[0,1,3,7])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def test_parent_pin_busy_after_claim_pauses_without_settlement_or_spawn(self):
        api=self.api();self.create_topic()
        original=broker_routes.preflight_route
        def preflight(*args,**kwargs):
            if kwargs.get('claim') is not None:
                raise RoutePinError('DATABASE_BUSY','fixture',retryable=True)
            return original(*args,**kwargs)
        with mock.patch.object(broker_routes,'preflight_route',preflight): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('storage_failure')
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])
        self.assertFalse((self.root/'agent-a.observation.json').exists())

    def test_parent_binding_fault_leaves_claim_unsettled(self):
        self.api();self.create_topic()
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            value=original(*args,**kwargs)
            config=self.root/'agent-a.config';body=json.loads(config.read_text())
            body['destination']['thread_id']='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            self.save(config,body)
            return value
        with mock.patch.object(self.store,'claim_wakes',claim): self.loop()
        self.assert_pause('route_binding_changed')
        self.assertFalse((self.root/'agent-a.observation.json').exists())

    def test_route_disappearance_is_unavailable_and_does_not_pause_others(self):
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            value=original(*args,**kwargs)
            Path(self.routes['agent-a']).unlink(missing_ok=True)
            return value
        with mock.patch.object(self.store,'claim_wakes',claim): self.loop()
        self.assertEqual(self.sql('SELECT outcome FROM wake_results ORDER BY outcome'),
                         [('accepted',),('unavailable',)])
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def test_cleanup_uncertain_even_after_expiry_attempts_pause_not_settlement(self):
        api=self.api();self.create_topic()
        def invoke(*args,**kwargs):
            self.clock.advance(31)
            raise wake_adapter.AdapterFault('cleanup_unconfirmed')
        with mock.patch.object(wake_adapter,'run_route',invoke): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('cleanup_failed')

    def test_failed_pause_is_reported_once_as_unsaved(self):
        self.api();self.create_topic()
        with mock.patch.object(wake_adapter,'run_route',side_effect=wake_adapter.AdapterFault('cleanup_unconfirmed')), \
                mock.patch.object(self.store,'pause_runner',side_effect=RunnerError('RUNNER_STORAGE_ERROR','fixture')) as pause:
            result=self.loop()
        self.assertEqual(pause.call_count,1)
        self.assertEqual(result['status'],'fatal_unsaved')
        self.assertFalse(result['pause_saved'])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'),[(0,)])

    def test_stop_during_native_invocation_settles_after_cleanup_once(self):
        self.api(); self.create_topic();self.send_next(addressees=['agent-b'])
        original=wake_adapter.run_route
        def invoke(*args,**kwargs):
            self.wait.stopped=True
            return original(*args,**kwargs)
        with mock.patch.object(wake_adapter,'run_route',invoke): result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])

    def test_callback_and_stale_settlement_faults_never_claim_again(self):
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        with mock.patch.object(self.store,'record_runner_child',return_value={
                'instance_id':'wrong','status':'recorded'}): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('storage_failure')
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])

    def test_paused_restart_never_implicitly_resumes(self):
        self.api()
        with self.store.runner_guard('previous') as guard:
            owned=self.store.acquire_runner(guard)
            self.store.pause_runner(guard,owned['runner_token'],'operator_pause')
        before=self.sql('SELECT state,version FROM runner_state')
        result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assertEqual(self.sql('SELECT state,version FROM runner_state'),before)
        version=before[0][1]
        result=self.loop(resume_version=version)
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def test_missed_hint_reconciles_at_sixty_seconds_with_independent_renewal(self):
        self.api();self.wait.stop_at=61
        self.wait.events=[(0.5,lambda: (self.create_topic(),False)[1])]
        claims=[];original=self.store.claim_wakes
        def claim(*args,**kwargs):
            claims.append(self.clock.elapsed);return original(*args,**kwargs)
        # Controlled wall clock is advanced; avoid pretending the real adapter's
        # separate physical clock is the scheduler clock for this one long wait.
        with mock.patch.object(self.store,'claim_wakes',claim),mock.patch.object(wake_adapter,'run_route',
                return_value=wake_adapter.RouteResult('unavailable',None,'fixture')):
            self.loop()
        self.assertEqual(claims,[60])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('unavailable',)])

    def test_repeated_short_lease_refusal_is_one_immediate_retry_then_paced(self):
        self.api();self.create_topic();self.wait.stop_at=3.5
        calls=[]
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            raise RunnerError('LEASE_TOO_SHORT','fixture',retryable=True)
        with mock.patch.object(self.store,'claim_wakes',claim): self.loop()
        self.assertEqual(calls,[0,0,1,2,3])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def foreground(self, **kwargs):
        api=self.api()
        self.assertTrue(hasattr(api,'run_foreground'),'explicit foreground entry must exist')
        return api.run_foreground(self.profile_path,'entry-fixture',self.map_path,
            selected_executable=str(self.broker),emit=self.trace.append,**kwargs)

    def test_startup_invalid_map_refuses_before_watch_guard_or_claim(self):
        api=self.api();self.assertTrue(hasattr(api,'run_foreground'))
        self.save(self.map_path,dict(v=1,routes={'agent-a':str(self.root/'absent')}))
        with mock.patch.object(Store,'runner_guard',side_effect=AssertionError('early guard')), \
                mock.patch.object(api,'NativeWatch',side_effect=AssertionError('early watch')):
            result=self.foreground()
        self.assertEqual(result['status'],'startup_failed')
        self.assertEqual((result['code'],result['reason']),('STARTUP_REFUSED','invalid_broker_config'))
        self.assertFalse(result['pause_saved'])
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('idle',)])

    def test_startup_pin_busy_stays_distinct_and_does_not_claim_or_retry(self):
        self.api();self.assertTrue(hasattr(self.api(),'run_foreground'))
        with mock.patch.object(Store,'read_route_pin',side_effect=RoutePinError(
                'DATABASE_BUSY','fixture',retryable=True)) as read:
            result=self.foreground()
        self.assertEqual(result['status'],'startup_failed')
        self.assertEqual(result['code'],'DATABASE_BUSY')
        self.assertTrue(result['retryable'])
        self.assertEqual(read.call_count,1)
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('idle',)])

    def test_foreground_retains_watch_on_unknown_connection_cleanup(self):
        api=self.api();self.assertTrue(hasattr(api,'run_foreground'))
        watches=[]
        class Watch:
            stopped=False
            def __init__(inner,path): watches.append(inner);inner.closed=False
            def wait(inner,timeout): return dict(dirty=False,stop=False)
            def close(inner): inner.closed=True
        original=Store.runner_schedule
        def uncertain(store,routed): raise RunnerError('RUNNER_STORAGE_ERROR','unconfirmed close fixture')
        with mock.patch.object(api,'NativeWatch',Watch),mock.patch.object(Store,'runner_schedule',uncertain):
            result=self.foreground()
        self.assertEqual(result['status'],'paused')
        self.assertFalse(result['cleanup_confirmed'])
        self.assertFalse(watches[0].closed,'unknown cleanup cannot close the retained descriptor')
        self.assertIn(watches[0],api._UNCONFIRMED_WATCHES)
        # No real handle was leaked by this instrument fault. Clear exactly its
        # fixture object; production leaves such handles for process exit.
        api._UNCONFIRMED_WATCHES.remove(watches[0])

    def test_native_stop_closes_all_sqlite_handles_before_watch_once(self):
        api=self.api();self.assertTrue(hasattr(api,'run_foreground'))
        self.clock_patch.stop()
        active=set();events=[];original=sqlite3.connect
        class Connection(sqlite3.Connection):
            def __init__(db,*args,**kwargs):
                super().__init__(*args,**kwargs);active.add(id(db));events.append('sql-open')
            def close(db):
                super().close();active.remove(id(db));events.append('sql-close')
        def connect(*args,**kwargs): return original(*args,**dict(kwargs,factory=Connection))
        case=self
        class Watch(NativeWatch):
            def __init__(watch,path): super().__init__(path);events.append('watch-open')
            def close(watch):
                timer.cancel()
                if timer.ident is not None:timer.join()
                case.assertFalse(active,'watch must close after every actual SQLite handle')
                events.append('watch-close');super().close()
        with mock.patch.object(sqlite3,'connect',connect),mock.patch.object(api,'NativeWatch',Watch):
            timer=threading.Timer(0.2,lambda:os.kill(os.getpid(),signal.SIGTERM))
            # Start after successful watch construction, never before handlers.
            original_init=Watch.__init__
            def initialize(watch,path): original_init(watch,path);timer.start()
            with mock.patch.object(Watch,'__init__',initialize): result=self.foreground()
            timer.join()
        self.assertEqual(result['status'],'stopped')
        self.assertTrue(result['cleanup_confirmed'])
        self.assertEqual(events.count('watch-open'),1)
        self.assertEqual(events.count('watch-close'),1)
        self.assertEqual(events[-1],'watch-close')
        self.assertFalse(active)
        print(json.dumps(dict(native_close_order=events,active_connections_at_exit=len(active))))

    def test_malformed_claim_cannot_route_to_another_actor(self):
        self.api();self.create_topic()
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            result=original(*args,**kwargs)
            result['claims'][0]['route_binding']['authority_epoch']='wrong'
            return result
        with mock.patch.object(self.store,'claim_wakes',claim): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('route_binding_changed')
        self.assertFalse(list(self.root.glob('*.observation.json')))

    def test_wrong_instance_settlement_is_a_fault_after_exactly_one_child(self):
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        original=self.store.finish_wake
        def finish(*args,**kwargs):
            result=original(*args,**kwargs);result['instance_id']='wrong';return result
        with mock.patch.object(self.store,'finish_wake',finish): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('storage_failure',settled=1)
        self.assertEqual(len(list(self.root.glob('*.observation.json'))),1)

    def test_expiry_during_dispatch_cannot_be_settled_or_start_next_child(self):
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        original=wake_adapter.run_route
        def invoke(*args,**kwargs):
            result=original(*args,**kwargs);self.clock.advance(31);return result
        with mock.patch.object(wake_adapter,'run_route',invoke): result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('storage_failure')
        self.assertEqual(len(list(self.root.glob('*.observation.json'))),1)

    def test_persistent_renew_busy_exits_idle_and_fresh_guard_finds_pending_work(self):
        self.api();self.create_topic();self.wait.stop_at=40
        claim_times=[]
        def claim(*args,**kwargs):
            claim_times.append(self.clock.elapsed)
            raise RunnerError('DATABASE_BUSY','fixture',retryable=True)
        with mock.patch.object(self.store,'claim_wakes',claim),mock.patch.object(self.store,'renew_runner',
                side_effect=RunnerError('DATABASE_BUSY','fixture',retryable=True)):
            result=self.loop()
        old_token=self.runner.token
        self.assertEqual(result['status'],'idle_lease_lost')
        self.assertEqual(self.clock.elapsed,30)
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])
        self.wait=Wait(self.clock,stop_at=31)
        with mock.patch.object(wake_adapter,'run_route',return_value=
                wake_adapter.RouteResult('unavailable',None,'controlled-clock')):
            result=self.loop()
        self.assertNotEqual(old_token,self.runner.token)
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('unavailable',)])

    def test_during_claim_empty_due_is_read_again_only_after_one_second(self):
        self.api();self.create_topic();self.wait.stop_at=2.1
        calls=[]
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            return dict(instance_id='test-instance',status='ok',claims=[],scanned=0,
                        next_due_ms=self.clock.wall_ms())
        with mock.patch.object(self.store,'claim_wakes',claim): self.loop()
        self.assertEqual(calls,[0,1,2])

    def test_stop_after_claim_before_preflight_keeps_attempt_unsettled(self):
        self.api();self.create_topic()
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            result=original(*args,**kwargs);self.wait.stopped=True;return result
        with mock.patch.object(self.store,'claim_wakes',claim): result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'),[(0,)])
        self.assertFalse(list(self.root.glob('*.observation.json')))

    def test_native_twenty_eight_second_idle_counts_actual_sql_writes(self):
        api=self.api();self.clock_patch.stop()
        started=time.monotonic();statements=[];watches=[]
        from aim_next import store as storage
        original=storage._connect
        def connect(path):
            db,facts=original(path)
            db.set_trace_callback(lambda sql:statements.append((time.monotonic()-started,sql)))
            return db,facts
        timer=threading.Timer(28.15,lambda:os.kill(os.getpid(),signal.SIGTERM))
        class Watch(NativeWatch):
            def __init__(watch,path):
                super().__init__(path);watches.append(watch);timer.start()
            def close(watch):
                timer.cancel()
                if timer.ident is not None:timer.join()
                super().close()
        try:
            with mock.patch.object(api,'NativeWatch',Watch),mock.patch.object(storage,'_connect',connect):
                result=self.foreground()
        finally:
            timer.cancel()
            if timer.ident is not None:timer.join()
        self.assertEqual(result['status'],'stopped')
        writes=[t for t,s in statements if s=='BEGIN IMMEDIATE']
        self.assertEqual(len(writes),4,'idle must acquire and renew, never claim or poll by writing')
        for actual,expected in zip(writes,(0,9,18,27)):
            self.assertLess(abs(actual-writes[0]-expected),0.75)
        due_reads=[t for t,s in statements if 'SELECT next_due_ms' in s]
        self.assertGreaterEqual(len(due_reads),1)
        self.assertLessEqual(len(due_reads),6,'native self-write hints must coalesce')
        self.assertFalse(any('count(*)' in s.lower() for _,s in statements))
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])
        print(json.dumps(dict(native_idle_seconds=time.monotonic()-started,
            writer_transaction_times=writes,schedule_lookup_times=due_reads,
            total_statements=len(statements),watch_closed=watches[0].fd is None,
            actual_sql_statements=statements)))

    def test_native_commit_hint_drives_one_actual_claim_before_reconciliation(self):
        api=self.api();self.clock_patch.stop()
        started=time.monotonic();failures=[];threads=[];watches=[]
        def write():
            try:self.create_topic()
            except BaseException as error:failures.append(repr(error))
        timer=threading.Timer(4,lambda:os.kill(os.getpid(),signal.SIGTERM))
        class Watch(NativeWatch):
            def __init__(watch,path):
                super().__init__(path);watches.append(watch);timer.start()
                thread=threading.Timer(0.2,write);threads.append(thread);thread.start()
            def close(watch):
                timer.cancel()
                if timer.ident is not None:timer.join()
                for thread in threads:thread.join()
                super().close()
        def emit(event):
            self.trace.append(event)
            if event['event']=='settled':os.kill(os.getpid(),signal.SIGTERM)
        try:
            with mock.patch.object(api,'NativeWatch',Watch):
                result=api.run_foreground(self.profile_path,'native-hint',self.map_path,
                    selected_executable=str(self.broker),emit=emit)
        finally:
            timer.cancel()
            if timer.ident is not None:timer.join()
            for thread in threads:thread.join()
        self.assertFalse(failures)
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertLess(time.monotonic()-started,3.5)
        self.assertIsNone(watches[0].fd)
        print(json.dumps(dict(native_commit_to_settlement_seconds=time.monotonic()-started,
                              events=self.trace)))

    def blocker(self, mode='writer'):
        code='''import sqlite3,sys
db=sqlite3.connect(sys.argv[1],isolation_level=None,timeout=.25)
db.execute('BEGIN IMMEDIATE' if sys.argv[2]=='writer' else 'BEGIN')
db.execute('SELECT * FROM runner_state').fetchall()
print('held',flush=True)
sys.stdin.readline()
db.rollback();db.close()
'''
        child=subprocess.Popen(['/usr/bin/python3','-I','-B','-c',code,str(self.path),mode],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        def release():
            if child.returncode is None:
                out,err=child.communicate(b'close\n',timeout=5)
                self.assertEqual(child.returncode,0,err)
        self.addCleanup(release)
        self.assertTrue(select.select([child.stdout],[],[],3)[0],'lock fixture must announce its actual lock')
        self.assertEqual(child.stdout.readline(),b'held\n')
        return release

    def test_real_busy_acquire_recovers_after_release_without_pause(self):
        self.api();release=self.blocker()
        self.wait.events=[(0.5,lambda:(release(),False)[1])]
        calls=[];original=self.store.acquire_runner
        def acquire(*args,**kwargs):
            calls.append(self.clock.elapsed);return original(*args,**kwargs)
        with mock.patch.object(self.store,'acquire_runner',acquire):result=self.loop()
        self.assertEqual(calls,[0,1])
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def test_real_busy_claim_commit_rolls_back_before_retry(self):
        self.api();self.create_topic()
        calls=[];original=self.store.claim_wakes;releases=[]
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            if len(calls)==1: releases.append(self.blocker('reader'))
            return original(*args,**kwargs)
        checked=[]
        def release():
            releases[0]()
            checked.append(self.sql('SELECT count(*) FROM wake_attempts'))
            return False
        self.wait.events=[(0.5,release)]
        with mock.patch.object(self.store,'claim_wakes',claim): result=self.loop()
        self.assertEqual(checked,[[(0,)]],'failed COMMIT must leave no durable attempt')
        self.assertEqual(calls,[0,1])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(result['status'],'stopped')

    def test_real_busy_renewal_keeps_same_token_and_recovers(self):
        self.api();self.wait.stop_at=11;releases=[]
        self.wait.events=[(8.5,lambda:(releases.append(self.blocker()),False)[1]),
                          (9.5,lambda:(releases[0](),False)[1])]
        calls=[];original=self.store.renew_runner
        def renew(guard,token,**kwargs):
            calls.append((self.clock.elapsed,token));return original(guard,token,**kwargs)
        with mock.patch.object(self.store,'renew_runner',renew):result=self.loop()
        self.assertEqual([t for t,_ in calls],[9,10])
        self.assertEqual(len({token for _,token in calls}),1)
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT state FROM runner_state'),[('running',)])

    def test_native_lock_contender_refuses_held_lock_and_accepts_after_release(self):
        self.api()
        db=sqlite3.connect(str(self.path),isolation_level=None)
        self.addCleanup(db.close)
        code='''import sqlite3,sys
db=sqlite3.connect(sys.argv[1],isolation_level=None,timeout=.05)
try:
 db.execute('BEGIN IMMEDIATE'); print('acquired');db.rollback()
except sqlite3.OperationalError:
 print('busy')
finally:db.close()
'''
        def contender():
            result=subprocess.run(['/usr/bin/python3','-I','-B','-c',code,str(self.path)],
                capture_output=True,text=True,timeout=3)
            self.assertEqual(result.returncode,0,result.stderr)
            return result.stdout.strip()
        with NativeWatch(self.path) as watch:
            db.execute('BEGIN IMMEDIATE')
            held=contender();self.assertEqual(held,'busy')
            # Mechanism observation only. No assertion that O_EVTONLY close
            # necessarily drops this macOS build's SQLite POSIX locks.
            watch.close()
            closed=contender()
            db.rollback();db.close()
            released=contender();self.assertEqual(released,'acquired')
        print(json.dumps(dict(native_lock_held=held,after_event_descriptor_close=closed,
                              after_transaction_release=released)))

    def test_uncertain_sql_cleanup_retains_actual_watch_fd_and_reports_fatal_pause_interrupt(self):
        api=self.api();watches=[];originals={n:signal.getsignal(n) for n in (signal.SIGINT,signal.SIGTERM)}
        class Watch(NativeWatch):
            def __init__(watch,path):super().__init__(path);watches.append(watch)
        try:
            with mock.patch.object(api,'NativeWatch',Watch),mock.patch.object(Store,'runner_schedule',
                    side_effect=KeyboardInterrupt('first controlled cancellation')), \
                    mock.patch.object(Store,'pause_runner',side_effect=KeyboardInterrupt('second cancellation')) as pause:
                result=self.foreground()
            self.assertEqual(result['status'],'fatal_unsaved')
            self.assertFalse(result['cleanup_confirmed'])
            self.assertFalse(result['pause_saved'])
            self.assertEqual(pause.call_count,1)
            self.assertIsInstance(watches[0].fd,int,'uncertain storage must retain its real watch descriptor')
            self.assertGreaterEqual(fcntl.fcntl(watches[0].fd,fcntl.F_GETFD),0)
            self.assertEqual([v['event'] for v in self.trace],['acquired','pause_unsaved'])
        finally:
            # The controlled exception leaked no actual connection. Teardown
            # owns only this fixture watch; production never drains the holder.
            for watch in watches:
                if watch in api._UNCONFIRMED_WATCHES:api._UNCONFIRMED_WATCHES.remove(watch)
                watch.close()
        self.assertEqual({n:signal.getsignal(n) for n in originals},originals)

    def _native_spill(self, commit):
        api=self.api();self.clock_patch.stop()
        self.workspace()
        source=dict(kind='new_topic',id='spill-opening',workspace_id='w1')
        self.assertEqual(self.save_draft('spill-draft',source,'spill-topic','x'*400000,
            opening=dict(workspace_id='w1',title='Spill',participants=['agent-a']))['status'],'committed')
        self.assertEqual(self.prepare('spill-draft','spill-topic',submission='spill',send_op='spill-send')['status'],'committed')
        writing=threading.Event();at_commit=threading.Event();done=threading.Event()
        release=threading.Event();hints=[];reads=[];errors=[];receipts=[];threads=[];timers=[];spill_settings=[]
        started=time.monotonic();original_connect=sqlite3.connect;original_read=Store.runner_schedule
        class Spill(sqlite3.Connection):
            def commit(db):
                # After Core releases its SAVEPOINT, force actual dirty-page
                # eviction in this same uncommitted DELETE-journal transaction.
                # A large application value alone did not reliably spill.
                db.execute('PRAGMA cache_spill=ON')
                spill_settings.append({key:db.execute('PRAGMA '+key).fetchone()[0]
                    for key in ('journal_mode','cache_size','cache_spill')})
                db.execute('CREATE TABLE fixture_spill_pages (value BLOB)')
                for _ in range(64):db.execute('INSERT INTO fixture_spill_pages VALUES (zeroblob(4096))')
                at_commit.set()
                timer=threading.Timer(0.65,release.set);timers.append(timer);timer.start()
                if not release.wait(3):raise AssertionError('spill fixture release deadline')
                if commit:super().commit()
                else:
                    db.rollback();raise RuntimeError('controlled spill rollback')
        def connect(*args,**kwargs):
            is_writer=threading.current_thread().name=='theseus-spill-writer'
            db=original_connect(*args,**dict(kwargs,**({'factory':Spill} if is_writer else {})))
            if is_writer:db.execute('PRAGMA cache_size=1')
            return db
        def write():
            writing.set()
            try:receipts.append(self.command('topic.create_and_send',{'submission_id':'spill'},
                target={'topic_id':'spill-topic'},op='spill-send'))
            except BaseException as error:
                if commit or str(error)!='controlled spill rollback':errors.append(repr(error))
            finally:done.set()
        def read(store,routed):
            try:
                value=original_read(store,routed);reads.append(dict(at=time.monotonic()-started,status='ok',due=value['next_due_ms']))
                return value
            except RunnerError as error:
                reads.append(dict(at=time.monotonic()-started,status=error.code));raise
        watchdog=threading.Timer(3.2,lambda:os.kill(os.getpid(),signal.SIGTERM))
        class Watch(NativeWatch):
            def __init__(watch,path):
                super().__init__(path);watchdog.start()
                def launch():
                    thread=threading.Thread(target=write,name='theseus-spill-writer')
                    threads.append(thread);thread.start()
                timer=threading.Timer(0.2,launch);timers.append(timer);timer.start()
            def close(watch):
                release.set();watchdog.cancel()
                if watchdog.ident is not None:watchdog.join()
                for timer in timers:
                    timer.cancel()
                    if timer.ident is not None:timer.join()
                for thread in threads:thread.join(4)
                super().close()
            def wait(watch,timeout):
                value=super().wait(timeout)
                if value['dirty'] and writing.is_set():
                    hints.append(dict(at=time.monotonic()-started,at_commit=at_commit.is_set(),
                                      writer_done=done.is_set()))
                return value
        def emit(event):
            self.trace.append(event)
            if event['event']=='settled':os.kill(os.getpid(),signal.SIGTERM)
        try:
            with mock.patch.object(sqlite3,'connect',connect),mock.patch.object(Store,'runner_schedule',read), \
                    mock.patch.object(api,'NativeWatch',Watch):
                result=api.run_foreground(self.profile_path,'spill-loop',self.map_path,
                    selected_executable=str(self.broker),emit=emit)
        finally:
            release.set();watchdog.cancel()
            if watchdog.ident is not None:watchdog.join()
            for timer in timers:
                timer.cancel()
                if timer.ident is not None:timer.join()
            for thread in threads:thread.join(4)
        print(json.dumps(dict(native_spill_commit=commit,hints=hints,reads=reads,
            spill_settings=spill_settings,loop_result=result,writer_errors=errors)))
        self.assertFalse(errors)
        self.assertTrue(done.is_set());self.assertTrue(at_commit.is_set())
        self.assertTrue(any(not row['writer_done'] for row in hints),
                        'a genuine vnode write hint must precede transaction completion')
        self.assertTrue(any(row['status']=='DATABASE_BUSY' for row in reads),
                        'real cache spill must block the early authoritative read')
        self.assertEqual(result['status'],'stopped')
        expected=[('accepted',)] if commit else []
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),expected)
        self.assertEqual(self.sql('SELECT count(*) FROM deliveries'),[(1 if commit else 0,)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1 if commit else 0,)])
        if commit:self.assertEqual(receipts[0]['status'],'committed')

    def test_native_precommit_spill_busy_then_commit_discovers_real_work(self):
        self._native_spill(True)

    def test_native_precommit_spill_rollback_invents_no_work(self):
        self._native_spill(False)

    def test_native_idle_loop_does_not_add_busy_failures_to_fixed_foreground_burst(self):
        api=self.api();self.clock_patch.stop()
        def burst(prefix):
            return [self.command('workspace.create',dict(id=prefix+str(i),title='Fixed burst',team=[]))
                    for i in range(20)]
        baseline=burst('baseline-');observed=[];errors=[];threads=[]
        timer=threading.Timer(3,lambda:os.kill(os.getpid(),signal.SIGTERM))
        def write():
            try:observed.extend(burst('runner-'))
            except BaseException as error:errors.append(repr(error))
            finally:os.kill(os.getpid(),signal.SIGTERM)
        class Watch(NativeWatch):
            def __init__(watch,path):
                super().__init__(path);timer.start()
                thread=threading.Timer(0.1,write);threads.append(thread);thread.start()
            def close(watch):
                timer.cancel()
                if timer.ident is not None:timer.join()
                for thread in threads:thread.join()
                super().close()
        try:
            with mock.patch.object(api,'NativeWatch',Watch):result=self.foreground()
        finally:
            timer.cancel()
            if timer.ident is not None:timer.join()
            for thread in threads:thread.join()
        self.assertFalse(errors)
        self.assertEqual(len(baseline),20);self.assertEqual(len(observed),20)
        busy=lambda rows:sum(v.get('error',{}).get('code')=='DATABASE_BUSY' for v in rows)
        self.assertLessEqual(busy(observed),busy(baseline))
        self.assertTrue(all(v['status']=='committed' for v in baseline+observed))
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])
        print(json.dumps(dict(baseline_outcomes=[v['status'] for v in baseline],
            with_idle_loop_outcomes=[v['status'] for v in observed])))

    def test_hint_flood_coalesces_reads_without_postponing_due_claim(self):
        self.api();self.wait.stop_at=1.5
        self.wait.events=[(i/100,lambda:True) for i in range(1,100)]
        self.wait.events.insert(19,(0.195,lambda:(self.create_topic(),True)[1]))
        reads=[];claims=[];original_read=self.store.runner_schedule;original_claim=self.store.claim_wakes
        def read(routed):reads.append(self.clock.elapsed);return original_read(routed)
        def claim(*args,**kwargs):claims.append(self.clock.elapsed);return original_claim(*args,**kwargs)
        with mock.patch.object(self.store,'runner_schedule',read),mock.patch.object(self.store,'claim_wakes',claim):
            result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(len(claims),1)
        self.assertLess(claims[0],0.4,'later hints must not postpone the first dirty deadline')
        self.assertLessEqual(len(reads),13,'startup and post-settlement reads plus bounded hint reads')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])

    def test_backward_wall_step_does_not_postpone_monotonic_renewal(self):
        self.api();self.wait.stop_at=10
        self.wait.events=[(1,lambda:(setattr(self.clock,'wall',self.clock.wall-3600000),False)[1])]
        calls=[];original=self.store.renew_runner
        def renew(*args,**kwargs):calls.append(self.clock.elapsed);return original(*args,**kwargs)
        with mock.patch.object(self.store,'renew_runner',renew):result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(calls,[9])

    def test_real_short_lease_between_check_and_claim_renews_once_and_retries(self):
        self.api();self.create_topic()
        calls=[];renewals=[];original=self.store.claim_wakes;renew=self.store.renew_runner
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            if len(calls)==1:self.clock.wall+=11000
            return original(*args,**kwargs)
        def record(*args,**kwargs):renewals.append(self.clock.elapsed);return renew(*args,**kwargs)
        with mock.patch.object(self.store,'claim_wakes',claim),mock.patch.object(self.store,'renew_runner',record), \
                mock.patch.object(wake_adapter,'run_route',return_value=wake_adapter.RouteResult('unavailable',None,'clock-fixture')):
            result=self.loop()
        self.assertEqual(calls,[0,0]);self.assertEqual(renewals,[0])
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('unavailable',)])

    def test_unacknowledged_arrival_during_invocation_keeps_accepted_cooldown(self):
        self.api();self.create_topic();original=wake_adapter.run_route
        def invoke(*args,**kwargs):
            result=original(*args,**kwargs);self.send_next('Arrived during invocation');return result
        with mock.patch.object(wake_adapter,'run_route',invoke):self.loop()
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])
        self.assertEqual(self.sql('SELECT state FROM deliveries'),[('pending',),('pending',)])

    def test_explicit_recipient_ack_then_later_arrival_is_discovered_after_settlement(self):
        self.api();self.create_topic();original=wake_adapter.run_route;calls=[]
        def invoke(*args,**kwargs):
            result=original(*args,**kwargs);calls.append(args[1]['attempt_id'])
            if len(calls)==1:
                incoming=self.sql('SELECT id FROM deliveries')[0][0]
                ack=self.command('delivery.ack',target={'delivery_id':incoming},actor='agent-a')
                self.assertEqual(ack['status'],'committed')
                self.send_next('After recipient acknowledged')
            return result
        with mock.patch.object(wake_adapter,'run_route',invoke):self.loop()
        self.assertEqual(len(calls),2);self.assertNotEqual(calls[0],calls[1])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',),('accepted',)])
        self.assertEqual(self.sql('SELECT state FROM deliveries ORDER BY seq'),[('acknowledged',),('pending',)])

    def test_removal_while_broker_runs_changes_eligibility_without_recalling_hint(self):
        self.api();self.create_topic();original=wake_adapter.run_route
        def invoke(*args,**kwargs):
            result=original(*args,**kwargs)
            removed=self.command('participation.set',{'actor_id':'agent-a','present':False},target={'topic_id':'t1'})
            self.assertEqual(removed['status'],'committed');return result
        with mock.patch.object(wake_adapter,'run_route',invoke):self.loop()
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(self.sql('SELECT pending_count,next_due_ms FROM recipient_schedule WHERE recipient_id=?',
                                 ('agent-a',)),[(0,None)])
        self.assertEqual(self.sql('SELECT state FROM deliveries'),[('pending',)])

    def test_native_signals_during_child_registration_settle_only_after_owned_exit(self):
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        original=self.store.record_runner_child;order=[]
        def register(*args,**kwargs):
            result=original(*args,**kwargs);order.append(('registered',args[3]))
            os.kill(os.getpid(),signal.SIGINT);os.kill(os.getpid(),signal.SIGTERM)
            return result
        finish=self.store.finish_wake
        def settle(*args,**kwargs):
            self.assertTrue(order,'settlement must follow actual child registration and cleanup')
            with self.assertRaises(ProcessLookupError):os.kill(order[0][1],0)
            order.append(('settle',None));return finish(*args,**kwargs)
        with NativeWatch(self.path) as watch:
            self.wait=watch
            with mock.patch.object(self.store,'record_runner_child',register),mock.patch.object(self.store,'finish_wake',settle):
                result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual([v[0] for v in order],['registered','settle'])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])

    def test_real_writer_busy_claim_begin_retries_only_after_clean_rollback(self):
        self.api();self.create_topic();calls=[];releases=[];checks=[]
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            calls.append(self.clock.elapsed)
            if len(calls)==1:releases.append(self.blocker())
            return original(*args,**kwargs)
        def release():
            releases[0]();checks.append(self.sql('SELECT count(*) FROM wake_attempts'));return False
        self.wait.events=[(0.5,release)]
        with mock.patch.object(self.store,'claim_wakes',claim):result=self.loop()
        self.assertEqual(result['status'],'stopped');self.assertEqual(calls,[0,1])
        self.assertEqual(checks,[[(0,)]]);self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('accepted',)])

    def test_lost_acceptance_result_can_retry_same_work_without_ack(self):
        self.api();self.create_topic();self.wait.stop_at=1.5
        self.broker.write_text(self.broker.read_text()+'\nsys.exit(1)\n')
        hints=[];original=wake_adapter.run_route
        def invoke(*args,**kwargs):
            result=original(*args,**kwargs)
            hints.append(json.loads((self.root/'agent-a.observation.json').read_text())['hint'])
            return result
        with mock.patch.object(wake_adapter,'run_route',invoke):self.loop()
        self.assertEqual(len(hints),2)
        self.assertEqual(hints[0]['binding'],hints[1]['binding'])
        self.assertEqual(hints[0]['wake_generation'],hints[1]['wake_generation'])
        self.assertNotEqual(hints[0]['attempt_id'],hints[1]['attempt_id'])
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('error',),('error',)])
        self.assertEqual(self.sql('SELECT state FROM deliveries'),[('pending',)])

    def test_watch_close_order_is_checked_inside_real_claim_transaction(self):
        api=self.api();self.create_topic();self.clock_patch.stop()
        active=set();watches=[];close_counts=[];effects=[];original_connect=sqlite3.connect
        force_early_close = False  # Applied instrument control changes this exact line.
        class Connection(sqlite3.Connection):
            def __init__(db,*args,**kwargs):super().__init__(*args,**kwargs);active.add(id(db))
            def close(db):super().close();active.discard(id(db))
        def connect(*args,**kwargs):return original_connect(*args,**dict(kwargs,factory=Connection))
        class Watch(NativeWatch):
            def __init__(watch,path):super().__init__(path);watches.append(watch)
            def close(watch):close_counts.append(len(active));super().close()
        original_effect=Store._effect
        def effect(store,guard,action):
            def observed(db,now):
                value,changed=action(db,now)
                if value.get('claims'):
                    effects.append(dict(transaction_open=db.in_transaction,active_handles=len(active)))
                    if force_early_close:watches[0].close()
                return value,changed
            return original_effect(store,guard,observed)
        def emit(event):
            self.trace.append(event)
            if event['event']=='settled':watches[0].stopped=True
        with mock.patch.object(sqlite3,'connect',connect),mock.patch.object(api,'NativeWatch',Watch), \
                mock.patch.object(Store,'_effect',effect):
            result=api.run_foreground(self.profile_path,'close-order',self.map_path,
                selected_executable=str(self.broker),emit=emit)
        print(json.dumps(dict(held_claim_transactions=effects,watch_close_active_handles=close_counts,result=result)))
        self.assertTrue(effects and effects[0]['transaction_open'])
        self.assertGreaterEqual(effects[0]['active_handles'],1)
        self.assertTrue(close_counts and all(n==0 for n in close_counts),
                        'a non-SQLite descriptor was closed during a real claim transaction')
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(close_counts,[0]);self.assertFalse(active)


    def _postclaim_read_fault(self, stage, mode):
        """Exercise real profile wrapping/adapter preparation around one injected SQL fault."""
        import aim_next.store as storage
        from aim_next.contract import StoreError
        api=self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        before=self.sql('SELECT id,state FROM deliveries ORDER BY id')
        phase=[None];injected=[];handles=[];watches=[];observed=[]
        original_connect=storage._connect
        original_preflight=broker_routes.preflight_route
        original_profile=wake_adapter.load_profile
        original_view=Store.view
        clock_start=time.monotonic()
        class Watch(NativeWatch):
            def __init__(watch,path):super().__init__(path);watches.append(watch)
            def wait(watch,timeout):
                if time.monotonic()-clock_start>0.4:watch.stopped=True
                return super().wait(min(timeout,0.02))
        class Connection:
            def __init__(inner,db):inner.db=db
            def __getattr__(inner,name):return getattr(inner.db,name)
            def close(inner):
                if mode=='close':
                    # Retain the actual handle, but release the fixture's read
                    # transaction so the independent pause can be persisted.
                    inner.db.rollback()
                    raise sqlite3.OperationalError('fixture unconfirmed close')
                return inner.db.close()
            def rollback(inner):
                inner.db.rollback()
                if mode=='view-rollback':
                    raise sqlite3.OperationalError('fixture rollback cleanup failure')
                if mode=='view-os':
                    raise OSError('fixture rollback cleanup failure')
        def connect(path):
            if phase[0]==stage and not injected:
                injected.append(dict(stage=stage,mode=mode))
                if mode=='busy':raise sqlite3.OperationalError('database is locked')
                if mode=='view-chained-busy':
                    real_connect=sqlite3.connect
                    class SetupConnection:
                        def __init__(inner,db):object.__setattr__(inner,'db',db)
                        def __getattr__(inner,name):return getattr(inner.db,name)
                        def __setattr__(inner,name,value):setattr(inner.db,name,value)
                        def execute(inner,*args):raise ValueError('fixture setup failure')
                        def close(inner):raise sqlite3.OperationalError('database busy during failed close')
                    def setup_connect(*args,**kwargs):
                        db=real_connect(*args,**kwargs);handles.append(db);return SetupConnection(db)
                    with mock.patch.object(sqlite3,'connect',setup_connect):return original_connect(path)
                db,settings=original_connect(path);handles.append(db)
                return Connection(db),settings
            return original_connect(path)
        def preflight(*args,**kwargs):
            previous=phase[0];phase[0]='preflight' if kwargs.get('claim') else None
            try:return original_preflight(*args,**kwargs)
            finally:phase[0]=previous
        def profile(*args,**kwargs):
            previous=phase[0];phase[0]='adapter'
            try:return original_profile(*args,**kwargs)
            except BaseException as error:
                observed.append(dict(type=type(error).__name__,code=getattr(error,'code',None),
                    cause=type(error.__cause__).__name__ if error.__cause__ else None))
                raise
            finally:phase[0]=previous
        def view(store,*args,**kwargs):
            previous=phase[0]
            if previous=='adapter':phase[0]='adapter-view'
            try:return original_view(store,*args,**kwargs)
            finally:phase[0]=previous
        try:
            with mock.patch.object(api,'NativeWatch',Watch),mock.patch.object(storage,'_connect',connect), \
                    mock.patch.object(broker_routes,'preflight_route',preflight), \
                    mock.patch.object(wake_adapter,'load_profile',profile), \
                    mock.patch.object(Store,'view',view),mock.patch.object(wake_adapter.subprocess,'Popen',side_effect=OSError('fixture refuses spawn')) as spawn:
                result=self.foreground()
            print(json.dumps(dict(postclaim_fault=injected,profile_errors=observed,result=result,
                                   actual_retained_handles=len(handles),spawn_count=spawn.call_count)))
            self.assertEqual(len(injected),1,'fault reached the selected real profile read')
            self.assert_pause('storage_failure')
            self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)],'no second claim')
            self.assertEqual(self.sql('SELECT id,state FROM deliveries ORDER BY id'),before)
            self.assertEqual(spawn.call_count,0,'post-claim storage failure must never spawn')
            self.assertEqual(result['status'],'paused')
            if mode=='busy':
                self.assertEqual(observed,[dict(type='ProfileError',code='DATABASE_BUSY',cause='StoreOpenError')])
            if mode=='view-chained-busy':
                self.assertEqual(observed,[dict(type='ProfileError',code='DATABASE_BUSY',cause=None)],
                                 'actual Core view loses chained-close provenance; runner stays conservative')
            if mode=='view-os':
                self.assertEqual(observed,[dict(type='ProfileError',code='STORE_OPEN_UNCONFIRMED',cause='OSError')])
            self.assertFalse(result['cleanup_confirmed'],'uncertain SQL cleanup cannot be reported clean')
            self.assertIsInstance(watches[0].fd,int,'uncertain SQL cleanup must retain actual watch fd')
            self.assertGreaterEqual(fcntl.fcntl(watches[0].fd,fcntl.F_GETFD),0)
            self.assertIn(watches[0],api._UNCONFIRMED_WATCHES)
            self.assertEqual(len(handles),0 if mode=='busy' else 1)
            for handle in handles:
                self.assertEqual(handle.execute('SELECT 1').fetchone()[0],1,
                                 'the controlled fault retained an actual SQLite connection')
        finally:
            # Only this fixture knows these handles and can finish their cleanup.
            # Product retains its watch for process exit, never discovers handles.
            for db in handles:db.close()
            for watch in watches:
                if watch in api._UNCONFIRMED_WATCHES:api._UNCONFIRMED_WATCHES.remove(watch)
                watch.close()

    def test_preflight_store_open_unconfirmed_retains_watch_and_leaves_claim(self):
        self._postclaim_read_fault('preflight','close')

    def test_adapter_second_profile_busy_pauses_without_settlement(self):
        self._postclaim_read_fault('adapter','busy')

    def test_adapter_second_profile_open_unconfirmed_retains_watch(self):
        self._postclaim_read_fault('adapter','close')

    def test_adapter_view_raw_rollback_error_retains_watch(self):
        self._postclaim_read_fault('adapter-view','view-rollback')

    def test_unknown_exception_with_busy_code_is_not_a_clean_retry(self):
        api=self.api()
        class UnknownFailure(Exception):
            code='DATABASE_BUSY';retryable=True
        with mock.patch.object(self.store,'runner_schedule',side_effect=UnknownFailure()) as calls:
            result=self.loop()
        self.assertFalse(result['cleanup_confirmed'],'an unrecognized class is not a clean Core busy')
        self.assertEqual(result['status'],'paused')
        self.assertEqual(calls.call_count,1,'uncertain storage may not be retried')
        self.assert_pause('storage_failure')

    def test_raw_outer_loop_exception_marks_cleanup_uncertain(self):
        api=self.api()
        with mock.patch.object(api.EffectsLoop,'_read',side_effect=sqlite3.Error('fixture unexpected storage path')):
            result=self.loop()
        self.assertFalse(result['cleanup_confirmed'],'uncaught raw exceptions cannot assert cleanup')
        self.assert_pause('storage_failure')

    def test_known_pin_storage_error_is_not_clean(self):
        self.api();self.create_topic()
        original=broker_routes.preflight_route
        def preflight(*args,**kwargs):
            if kwargs.get('claim'):raise RoutePinError('ROUTE_PIN_STORAGE_ERROR','fixture')
            return original(*args,**kwargs)
        with mock.patch.object(broker_routes,'preflight_route',preflight):result=self.loop()
        self.assertFalse(result['cleanup_confirmed'])
        self.assert_pause('storage_failure')

    def test_stop_after_successful_preflight_never_invokes(self):
        self.api();self.create_topic()
        original=broker_routes.preflight_route
        def preflight(*args,**kwargs):
            result=original(*args,**kwargs)
            if kwargs.get('claim'):self.wait.stopped=True
            return result
        with mock.patch.object(broker_routes,'preflight_route',preflight), \
                mock.patch.object(wake_adapter,'run_route') as invoke:
            result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(invoke.call_count,0)
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])
        self.assertEqual(self.sql('SELECT count(*) FROM wake_results'),[(0,)])

    def test_ordinary_uncoded_profile_refusal_still_settles_unavailable_cleanly(self):
        self.api();self.create_topic()
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            result=original(*args,**kwargs)
            (self.root/'agent-a.profile').chmod(0o644)
            return result
        with mock.patch.object(self.store,'claim_wakes',claim):result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertTrue(result['cleanup_confirmed'],'ordinary pre-SQL profile refusal is clean')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('unavailable',)])


    def _postclaim_authority_fault(self, verify_at):
        from aim_next.authority import AuthorityError
        self.api();self.create_topic();self.send_next(addressees=['agent-b'])
        original=wake_adapter.run_route;hits=[]
        def invoke(route,claim,guard,**kwargs):
            real_verify=guard.verify;count=[0]
            def verify():
                count[0]+=1
                if count[0]==verify_at:
                    hits.append(verify_at)
                    raise AuthorityError('AUTHORITY_CHANGED','fixture changed at pre-spawn verification')
                return real_verify()
            with mock.patch.object(guard,'verify',verify):return original(route,claim,guard,**kwargs)
        with mock.patch.object(wake_adapter,'run_route',invoke), \
                mock.patch.object(wake_adapter.subprocess,'Popen',side_effect=OSError('fixture refuses spawn')) as spawn:
            result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('route_binding_changed')
        self.assertEqual(hits,[verify_at],'fault reached the exact selected adapter verification')
        self.assertEqual(spawn.call_count,0)
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])

    def test_prepare_route_authority_fault_cannot_settle_unavailable(self):
        self._postclaim_authority_fault(1)

    def test_final_pre_spawn_authority_fault_cannot_settle_unavailable(self):
        self._postclaim_authority_fault(3)


    def test_adapter_view_os_cleanup_failure_keeps_storage_typing(self):
        self._postclaim_read_fault('adapter-view','view-os')

    def test_adapter_view_chained_busy_close_never_proves_cleanup(self):
        self._postclaim_read_fault('adapter-view','view-chained-busy')

    def test_ordinary_missing_profile_after_startup_remains_unavailable(self):
        self.api();self.create_topic()
        original=self.store.claim_wakes
        def claim(*args,**kwargs):
            result=original(*args,**kwargs)
            (self.root/'agent-a.profile').unlink(missing_ok=True)
            return result
        with mock.patch.object(self.store,'claim_wakes',claim):result=self.loop()
        self.assertEqual(result['status'],'stopped')
        self.assertTrue(result['cleanup_confirmed'],'ordinary file absence before SQL is clean')
        self.assertEqual(self.sql('SELECT outcome FROM wake_results'),[('unavailable',)])


    def test_valid_profile_swap_after_preflight_pauses_without_settlement(self):
        self.api();self.create_topic()
        original=broker_routes.preflight_route
        def preflight(*args,**kwargs):
            result=original(*args,**kwargs)
            if kwargs.get('claim'):
                (self.root/'agent-a.profile').write_bytes((self.root/'agent-b.profile').read_bytes())
            return result
        with mock.patch.object(broker_routes,'preflight_route',preflight), \
                mock.patch.object(wake_adapter.subprocess,'Popen',side_effect=OSError('fixture refuses spawn')) as spawn:
            result=self.loop()
        self.assertEqual(result['status'],'paused')
        self.assert_pause('route_binding_changed')
        self.assertEqual(spawn.call_count,0)
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(1,)])

    def test_storage_profile_failure_at_startup_still_refuses_before_watch(self):
        api=self.api()
        with mock.patch.object(Store,'view',side_effect=OSError('fixture storage-stage failure')), \
                mock.patch.object(api,'NativeWatch') as watch:
            result=self.foreground()
        self.assertEqual(result['status'],'startup_failed')
        self.assertEqual(result['code'],'STARTUP_REFUSED')
        # The reason is the wrapper's fixed code; the exception text never reaches the output.
        self.assertEqual(result['reason'],'STORE_OPEN_UNCONFIRMED')
        self.assertNotIn('fixture storage-stage failure',str(result))
        self.assertEqual(watch.call_count,0)
        self.assertEqual(self.sql('SELECT count(*) FROM wake_attempts'),[(0,)])

    def test_storage_profile_failure_in_broker_child_exits_nonzero_without_rpc(self):
        import sys
        root=str(Path(__file__).resolve().parents[1])
        report=self.root/'child-profile-failure.json'
        rpc=self.root/'unexpected-rpc'
        source="""
import json,sys
from pathlib import Path
from unittest import mock
sys.path.insert(0,sys.argv[1])
from aim_next import Store,broker_routes,codex_broker
original=broker_routes.load_profile
def observe(*args,**kwargs):
    try:return original(*args,**kwargs)
    except BaseException as error:
        Path(sys.argv[3]).write_text(json.dumps(dict(type=type(error).__name__,code=getattr(error,'code',None))))
        raise
def unexpected(*args,**kwargs):
    Path(sys.argv[4]).write_text('RPC process unexpectedly attempted')
    raise AssertionError('unexpected RPC')
with mock.patch.object(Store,'view',side_effect=OSError('fixture storage-stage failure')), \
        mock.patch.object(broker_routes,'load_profile',observe), \
        mock.patch.object(codex_broker,'_stdin',return_value={'binding':json.loads(sys.argv[5])}), \
        mock.patch.object(codex_broker.subprocess,'Popen',unexpected):
    result=codex_broker.main(['--config',sys.argv[2]])
sys.exit(result)
"""
        expected=dict(broker_routes.profile_binding(self.profile),actor_id='agent-a')
        completed=subprocess.run(['/usr/bin/python3','-I','-X','pycache_prefix='+sys.pycache_prefix+'/broker-child',
            '-c',source,root,str(self.root/'agent-a.config'),str(report),str(rpc),json.dumps(expected)],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
        self.assertEqual(completed.returncode,1,completed.stderr.decode())
        self.assertFalse(rpc.exists(),'failed profile must emit no RPC')
        self.assertEqual(json.loads(report.read_text()),dict(type='ProfileError',code='STORE_OPEN_UNCONFIRMED'))


    def test_unknown_exception_with_short_lease_code_is_not_a_clean_retry(self):
        self.api();self.create_topic()
        class UnknownFailure(Exception):
            code='LEASE_TOO_SHORT';retryable=True
        with mock.patch.object(self.store,'claim_wakes',side_effect=UnknownFailure()) as calls:
            result=self.loop()
        self.assertFalse(result['cleanup_confirmed'])
        self.assertEqual(result['status'],'paused','unknown cleanup cannot enter short-lease retry')
        self.assertEqual(calls.call_count,1)
        self.assert_pause('storage_failure')

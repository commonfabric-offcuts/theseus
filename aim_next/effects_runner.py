from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

from . import broker_routes, wake_adapter
from .contract import StoreError
from .authority import AuthorityError
from .route_pins import RoutePinError
from .runner import RunnerError
from .store import StoreOpenError
from .effects_watch import NativeWatch
from .profile import ProfileError, load_profile


_UNCONFIRMED_WATCHES = []


class Clock:
    def wall_ms(self):
        return int(time.time()*1000)

    def monotonic(self):
        return time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW)/1000000000


class LoopFault(Exception):
    def __init__(self, reason='storage_failure'):
        self.reason = reason


class ShortLease(Exception):
    pass


def _integer(value, nullable=False):
    return (nullable and value is None) or (type(value) is int and 0 <= value <= 9223372036854775807)


class EffectsLoop:
    """Serial foreground scheduler using one caller-owned guard and watch.

    The mapping is a validated startup snapshot. Selected route/config/pin
    checks are repeated for each captured claim. No operation here acknowledges
    a delivery, provisions a pin, creates a service or reloads that mapping.
    """
    def __init__(self, profile, store, guard, watch, routes, *, selected_executable,
                 resume_version=None, clock=None, emit=None):
        self.profile, self.store, self.guard, self.watch = profile, store, guard, watch
        self.routes = dict(routes)
        # Only these actors are ever claimed; people and unrouted agents stay pending.
        self.routed = sorted(self.routes)
        self.executable = selected_executable
        self.resume_version = resume_version
        self.clock = clock or Clock()
        self.emit = emit or (lambda event: None)
        self.token = None
        self.lease = None
        self.renew_at = float('inf')
        self.acquire_wall = None
        self.due = None
        self.reconcile_at = 0.0
        self.read_needed = True
        self.read_floor = 0.0
        self.dirty_at = None
        self.last_hint_read = -float('inf')
        self.gates = {key:0.0 for key in ('acquire','renew','claim','schedule')}
        self.busy_counts = {key:0 for key in self.gates}
        self.force_renew = False
        self.short_seen = False
        self.short_at = 0.0
        self.outstanding = None
        # Core does not expose an unreturned handle when close fails. On an
        # uncertain storage exception the process must retain the watch until
        # exit instead of pretending it can establish connection-close order.
        self.cleanup_uncertain = False

    def _event(self, kind, **fields):
        self.emit(dict(event=kind, **fields))

    def _result(self, status, **fields):
        return dict(status=status, instance_id=self.profile.instance_id,
                    cleanup_confirmed=not self.cleanup_uncertain, **fields)

    def _response(self, result, status=None):
        if (type(result) is not dict or result.get('instance_id') != self.profile.instance_id
                or (status is not None and result.get('status') != status)):
            raise LoopFault()
        return result

    @staticmethod
    def _cleanup_known(error):
        # These exact Core paths complete cleanup or override the refusal with
        # an uncertainty error. A matching string on another class is no proof.
        clean = {
            StoreOpenError: {'DATABASE_BUSY'},
            RunnerError: {'DATABASE_BUSY','INVALID_ARGUMENT','INVALID_GUARD',
                'LEASE_TOO_SHORT','RUNNER_STATE_INVALID','REVISION_CONFLICT','GUARD_NOT_DRAINED'},
            RoutePinError: {'DATABASE_BUSY','INVALID_ARGUMENT','INVALID_ROUTE_DESTINATION',
                'INVALID_ACTOR','ROUTE_PIN_INVALID','ROUTE_PIN_MISMATCH','ROUTE_PIN_MISSING'},
            AuthorityError: {'AUTHORITY_CHANGED','INVALID_BINDING','AUTHORITY_BUSY'},
        }
        if type(error) in clean:
            return error.code in clean[type(error)]
        if isinstance(error,wake_adapter.RouteUnavailable):
            return True
        if type(error) is ProfileError:
            # Coded wrappers may come from a Store.view result that flattened
            # failed setup cleanup into busy. Keep all of them conservative.
            # Storage-stage OSError/ValueError now has its own uncertainty code;
            # ordinary file/parse failures remain uncoded.
            return error.code is None and not isinstance(error.__cause__,StoreError)
        return False

    def _storage(self, operation):
        try:
            return operation()
        except BaseException as error:
            if not self._cleanup_known(error):
                self.cleanup_uncertain = True
            raise

    def _success(self, action):
        if self.busy_counts[action]:
            self._event('contention_recovered',action=action)
        self.busy_counts[action] = 0
        self.gates[action] = 0.0

    def _preclaim(self, action, operation):
        try:
            result = self._storage(operation)
        except Exception as error:
            if (self.outstanding is None and getattr(error,'code',None)=='DATABASE_BUSY'
                    and getattr(error,'retryable',False) is True and self._cleanup_known(error)):
                count = self.busy_counts[action]
                self.gates[action] = self.clock.monotonic()+min(2**min(count,6),60)
                self.busy_counts[action] = min(count+1,7)
                if not count: self._event('contention',action=action)
                return None
            if (action in ('claim','renew') and getattr(error,'code',None)=='LEASE_TOO_SHORT'
                    and self._cleanup_known(error)):
                raise ShortLease() from error
            raise LoopFault() from error
        self._success(action)
        return self._response(result)

    def _paused_or_lost(self, response):
        if response.get('status') == 'paused':
            return self._result('paused',pause_saved=True)
        if response.get('status') == 'lost':
            return self._result('ownership_lost',pause_saved=False)
        return None

    def _acquire(self):
        def operation():
            if self.resume_version is not None:
                return self.store.resume_runner(self.guard,self.resume_version,lease_ms=30000)
            return self.store.acquire_runner(self.guard,lease_ms=30000)
        value = self._preclaim('acquire',operation)
        if value is None: return None
        if value.get('status')=='paused':
            return self._result('paused',pause_saved=True)
        if self.resume_version is None and value.get('status')=='busy':
            if not _integer(value.get('lease_until_ms')) or value['lease_until_ms'] <= self.clock.wall_ms():
                raise LoopFault()
            self.acquire_wall = value['lease_until_ms']
            return None
        self._response(value,'acquired')
        if (not isinstance(value.get('runner_token'),str) or not value['runner_token']
                or not _integer(value.get('lease_until_ms'))):
            raise LoopFault()
        self.token, self.lease = value['runner_token'], value['lease_until_ms']
        self.renew_at = self.clock.monotonic()+9
        self.acquire_wall = None
        self._event('acquired')
        return None

    def _renew(self):
        try:
            value = self._preclaim('renew',lambda:self.store.renew_runner(self.guard,self.token,lease_ms=30000))
        except ShortLease:
            self.force_renew = True
            self.gates['renew'] = self.clock.monotonic()+1
            return None
        if value is None: return None
        stopped = self._paused_or_lost(value)
        if stopped: return stopped
        self._response(value,'renewed')
        if not _integer(value.get('lease_until_ms')): raise LoopFault()
        self.lease = value['lease_until_ms']
        self.renew_at = self.clock.monotonic()+9
        self.force_renew = False
        return None

    def _read(self, hint):
        value = self._preclaim('schedule',lambda:self.store.runner_schedule(self.routed))
        if value is None: return
        if (value.get('state') not in ('idle','running','paused')
                or not _integer(value.get('version'))
                or 'next_due_ms' not in value or not _integer(value['next_due_ms'],True)
                or 'lease_until_ms' not in value or not _integer(value['lease_until_ms'],True)):
            raise LoopFault()
        # A diagnostic read never supplies or changes the held token/lease.
        self.due = value['next_due_ms']
        self.read_needed = False
        self.reconcile_at = self.clock.monotonic()+60
        if hint: self.last_hint_read = self.clock.monotonic()
        self.dirty_at = None

    def _register(self, claim, pid, started_at):
        return self._response(self._storage(lambda:self.store.record_runner_child(
            self.guard,self.token,claim['claim_token'],pid,started_at)),'recorded')

    def _dispatch(self, claim):
        try:
            binding = wake_adapter._claim(claim)
            expected = dict(broker_routes.profile_binding(self.profile),actor_id=claim['recipient_id'])
            if binding != expected: raise LoopFault('route_binding_changed')
        except wake_adapter.RouteUnavailable as error:
            raise LoopFault('route_binding_changed') from error
        if self.watch.stopped: return
        route = self.routes.get(claim['recipient_id'])
        result = wake_adapter.RouteResult('unavailable',None,'missing_route')
        if route is not None:
            try:
                self._storage(lambda:broker_routes.preflight_route(route,claim['recipient_id'],
                    self.profile,selected_executable=self.executable,claim=claim))
            except broker_routes.BrokerBindingError as error:
                raise LoopFault('route_binding_changed') from error
            except wake_adapter.RouteUnavailable:
                # Ordinary missing/invalid route/config, not a Core pin verdict.
                result = wake_adapter.RouteResult('unavailable',None,'route_unavailable')
            except ProfileError as error:
                if error.code is not None or isinstance(error.__cause__,StoreError):
                    raise LoopFault(self._pin_reason(error)) from error
                result = wake_adapter.RouteResult('unavailable',None,'profile_unavailable')
            except Exception as error:
                raise LoopFault(self._pin_reason(error)) from error
            else:
                if self.watch.stopped: return
                try:
                    result = wake_adapter.run_route(route,claim,self.guard,
                        owner_lease_until_ms=self.lease,
                        record_child=lambda pid,started_at:self._register(claim,pid,started_at))
                except wake_adapter.AdapterFault as error:
                    reason = 'cleanup_failed' if str(error)=='cleanup_unconfirmed' else 'storage_failure'
                    raise LoopFault(reason) from error
                except wake_adapter.RouteUnavailable as error:
                    # The adapter propagates these post-validation binding
                    # verdicts instead of presenting them as ordinary absence.
                    raise LoopFault('route_binding_changed') from error
                except (StoreError,ProfileError) as error:
                    if not self._cleanup_known(error):
                        self.cleanup_uncertain = True
                    raise LoopFault(self._pin_reason(error)) from error
                except (Exception,KeyboardInterrupt) as error:
                    self.cleanup_uncertain = True
                    raise LoopFault('storage_failure') from error
        # A normal adapter return means no child started or owned cleanup was
        # confirmed. Stop cannot skip the result of this already finished act.
        if (not isinstance(result,wake_adapter.RouteResult)
                or result.outcome not in ('accepted','busy','unavailable','error')
                or (result.outcome=='accepted' and result.exit_code != 0)):
            raise LoopFault()
        self._response(self._storage(lambda:self.store.finish_wake(
            self.guard,self.token,claim['claim_token'],result.outcome)),'settled')
        self.outstanding = None
        self.due = None
        self.read_needed = True
        self._event('settled',outcome=result.outcome)

    @staticmethod
    def _pin_reason(error):
        if getattr(error,'code',None) in ('ROUTE_PIN_MISSING','ROUTE_PIN_MISMATCH','ROUTE_PIN_INVALID',
                                          'INVALID_ROUTE_DESTINATION','INVALID_ARGUMENT','INVALID_ACTOR',
                                          'AUTHORITY_CHANGED','INVALID_BINDING'):
            return 'route_binding_changed'
        return 'storage_failure'

    def _claim(self):
        try:
            value = self._preclaim('claim',lambda:self.store.claim_wakes(
                self.guard,self.token,self.routed,limit=1,lease_ms=20000))
        except ShortLease:
            self.short_at = self.clock.monotonic()+(1 if self.short_seen else 0)
            self.short_seen = True
            self.force_renew = True
            return None
        if value is None: return None
        stopped = self._paused_or_lost(value)
        if stopped: return stopped
        self._response(value,'ok')
        claims = value.get('claims')
        if (type(claims) is not list or len(claims)>1 or 'next_due_ms' not in value
                or not _integer(value['next_due_ms'],True)):
            raise LoopFault()
        self.short_seen = False
        self.due = value['next_due_ms']
        if claims:
            self.outstanding = claims[0]
            self._dispatch(claims[0])
        elif self.due is not None and self.due <= self.clock.wall_ms():
            self.due = None
            self.read_needed = True
            self.read_floor = self.clock.monotonic()+1
        return None

    def _fault(self, reason):
        if self.token is None:
            return self._result('startup_failed',reason=reason,pause_saved=False)
        try:
            self._response(self._storage(lambda:self.store.pause_runner(
                self.guard,self.token,reason)),'paused')
        except BaseException:
            self._event('pause_unsaved',reason=reason)
            return self._result('fatal_unsaved',reason=reason,pause_saved=False)
        self._event('paused',reason=reason)
        return self._result('paused',reason=reason,pause_saved=True)

    def _read_at(self):
        wanted = min(self.reconcile_at,self.dirty_at if self.dirty_at is not None else float('inf'),
                     0 if self.read_needed else float('inf'))
        return max(wanted,self.gates['schedule'],self.read_floor)

    def _renew_needed(self, now, wall):
        due = self.due is not None and self.due <= wall
        return now >= self.renew_at or (due and self.lease-wall<21000) or self.force_renew

    def _accept_event(self, event):
        if event['dirty'] and self.dirty_at is None:
            self.dirty_at = max(self.clock.monotonic()+0.1,self.last_hint_read+0.1)

    def run(self):
        try:
            while True:
                self._accept_event(self.watch.wait(0))
                if self.watch.stopped: return self._result('stopped')
                now,wall = self.clock.monotonic(),self.clock.wall_ms()
                if self.token is not None and wall >= self.lease:
                    self._event('idle_lease_lost')
                    return self._result('idle_lease_lost',pause_saved=False)
                renew = self.token is not None and self._renew_needed(now,wall)
                if renew and now >= max(self.gates['renew'],self.short_at):
                    result = self._renew()
                    if result: return result
                    continue
                if (self.token is None and now >= self.gates['acquire']
                        and (self.acquire_wall is None or wall >= self.acquire_wall)):
                    result = self._acquire()
                    if result: return result
                    continue
                if now >= self._read_at():
                    self._read(self.dirty_at is not None and now >= self.dirty_at)
                    continue
                if (self.token is not None and not renew and self.due is not None and self.due <= wall
                        and now >= max(self.gates['claim'],self.short_at)):
                    result = self._claim()
                    if result: return result
                    continue
                deadlines = [self._read_at()]
                if self.token is None:
                    acquire = now if self.acquire_wall is None else now+max(0,(self.acquire_wall-wall)/1000)
                    deadlines.append(max(acquire,self.gates['acquire']))
                else:
                    deadlines.append(now+max(0,(self.lease-wall)/1000))
                    deadlines.append(max(now if renew else self.renew_at,self.gates['renew'],self.short_at))
                    if self.due is not None and not renew:
                        deadlines.append(max(now+max(0,(self.due-wall)/1000),self.gates['claim'],self.short_at))
                timeout = max(0,min(60,min(deadlines)-now))
                self._accept_event(self.watch.wait(timeout))
        except LoopFault as error:
            return self._fault(error.reason)
        except (Exception,KeyboardInterrupt):
            self.cleanup_uncertain = True
            return self._fault('storage_failure')


def run_foreground(profile_path, runner_id, routes_path, *, resume_version=None,
                   selected_executable=None, emit=None):
    """Dedicated process entry. No successful return implies activation.

    No non-SQLite descriptor on db_path may be closed while a SQLite connection
    is open. NativeWatch closes last only when storage cleanup is known. If an API's
    cleanup was uncertain, retain that descriptor until process exit; there is
    no handle-discovery or garbage-collection claim about the failed SQL call.
    """
    emit = emit or (lambda event:None)
    profile = store = watch = guard = loop = None
    result = None
    try:
        profile = load_profile(profile_path)
        store = profile.store()
        executable = selected_executable or str(Path(__file__).resolve().parents[1]/'bin'/'aim-next-codex-broker')
        routes = broker_routes.load_route_map(routes_path,profile,selected_executable=executable)
        watch = NativeWatch(profile.db_path)
        guard = store.runner_guard(runner_id)
        guard.__enter__()
        loop = EffectsLoop(profile,store,guard,watch,routes,
            selected_executable=executable,resume_version=resume_version,emit=emit)
        result = loop.run()
    except (Exception,KeyboardInterrupt) as error:
        # Startup messages are fixed and contain no route/profile or exception
        # text. Preserve typed busy without adding an implicit pin-read retry.
        busy = getattr(error,'code',None)=='DATABASE_BUSY'
        result = dict(status='startup_failed',code='DATABASE_BUSY' if busy else 'STARTUP_REFUSED',
                      retryable=busy and getattr(error,'retryable',False) is True,pause_saved=False,
                      cleanup_confirmed=not (loop is not None and loop.cleanup_uncertain))
    finally:
        if guard is not None:
            try:
                guard.close()
            except BaseException:
                result = dict(status='fatal_unsaved',reason='guard_close_unconfirmed',pause_saved=False,
                              cleanup_confirmed=False)
        if watch is not None:
            if loop is not None and loop.cleanup_uncertain:
                _UNCONFIRMED_WATCHES.append(watch)
            else:
                try:
                    watch.close()
                except BaseException:
                    result = dict(status='fatal_unsaved',reason='watch_close_unconfirmed',pause_saved=False,
                                  cleanup_confirmed=False)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run one explicit Theseus effects process in the foreground')
    parser.add_argument('--profile',required=True)
    parser.add_argument('--runner-id',required=True)
    parser.add_argument('--routes',required=True)
    parser.add_argument('--resume-version',type=int)
    args = parser.parse_args(argv)
    def report(event):
        print(json.dumps(event,separators=(',',':')),flush=True)
    result = run_foreground(args.profile,args.runner_id,args.routes,
                            resume_version=args.resume_version,emit=report)
    report(result)
    return 0 if result['status']=='stopped' else (75 if result['status']=='idle_lease_lost' else 2)

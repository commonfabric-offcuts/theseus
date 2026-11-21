from __future__ import annotations

"""Provision one recorded seat through the already owned, asynchronous host."""

from dataclasses import replace
import json
import os
from pathlib import Path
import stat

from . import broker_routes, codex_host, hosted_seats, invite
from .profile import ProfileError, load_profile, write_profile


RPC_SECONDS = 45
END_RETRY_MAX = 30


class SeatRefusal(Exception):
    def __init__(self, reason):
        self.reason = reason


def _directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077
            or path.resolve(strict=True) != path):
        raise SeatRefusal('path_conflict')


def _write_same(path, payload):
    """Create once, or verify exact private bytes; never replace another file."""
    try:
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077
                    or stream.read(len(payload) + 1) != payload):
                raise SeatRefusal('path_conflict')
        return
    with os.fdopen(fd, 'wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class SeatHost:
    def __init__(self, loop, *, directory, operator_routes=None, template_actor=None):
        self.loop = loop
        self.directory = Path(directory).resolve()
        self.operator_routes, self.template_actor = operator_routes, template_actor
        self.current = None
        self.deadline = None
        self.route_cursor = 0
        self.end_cursor = ""
        self.ending_hint = False
        self.end_due = None
        self.end_delay = 1
        self.end_activity = 0

    def _core(self, method, *args):
        answer = self.loop._core(method, *args)
        if answer.get('status') != 'ok':
            # Ownership loss is handled by the ordinary loop; no external step follows it.
            self.current, self.deadline = None, None
            raise codex_host.HostFault('seat_runner_paused' if answer.get('status') == 'paused' else 'runner_lease_lost')
        return answer

    def _step(self, stage, details=None):
        seat = self.current
        answer = self._core('hosted_seat_step', seat['id'], seat['version'], stage, details)
        self.current = answer['seat']
        self.loop._event('seat_step', seat_id=seat['id'], stage=self.current['stage'], state=self.current['state'],
                         reason=self.current['reason'])
        if self.current['state'] in ('refused', 'ready', 'ending', 'ended'):
            self.current, self.deadline = None, None
            return False
        return True

    def _refuse(self, reason):
        if reason not in hosted_seats.REASONS:
            reason = 'incompatible'
        self._step('refused', {'reason': reason})

    def _template(self):
        host = self.loop.host
        if host is None:
            raise SeatRefusal('host_not_configured')
        configs = [thread.config for thread in host.threads.values()]
        if self.template_actor:
            configs = [config for config in configs if config.profile.actor_id == self.template_actor]
            if not configs:
                raise SeatRefusal('host_not_configured')
        full = [config for config in configs if config.permission_mode == 'full']
        if not full:
            raise SeatRefusal('host_template_requires_full')
        choices = {(config.destination['codex_home'], config.codex_executable, config.cli,
                    config.model, config.reasoning_effort) for config in full}
        if len(choices) != 1:
            raise SeatRefusal('host_template_ambiguous')
        selected = full[0]
        if selected.model is None or selected.reasoning_effort is None:
            raise SeatRefusal('host_not_configured')
        return selected

    def _plan(self, seat):
        selected = self._template()
        folder = self.directory / 'seats' / seat['id']
        if os.path.lexists(str(folder)):
            raise SeatRefusal('path_conflict')
        return {'profile': str(folder / (seat['agent_id'] + '.profile.json')),
                'config': str(folder / 'route.json'), 'cwd': str(folder / 'work'),
                'cli': selected.cli, 'codex_home': selected.destination['codex_home'],
                'codex_executable': selected.codex_executable, 'model': selected.model,
                'reasoning_effort': selected.reasoning_effort, 'permission_mode': 'full'}

    def _profile(self, seat):
        plan = seat['plan']
        folder = Path(plan['profile']).parent
        _directory(folder.parent)
        _directory(folder)
        _write_same(folder / 'request.json', (json.dumps({'seat_id': seat['id'], 'plan': plan},
                    sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8'))
        _directory(Path(plan['cwd']))
        target = Path(plan['profile'])
        store = self.loop.store
        held = invite._held(target, store, seat['agent_id'])
        if held not in (None, invite.MINE):
            raise SeatRefusal('profile_conflict')
        if held is None:
            try:
                write_profile(target, store.path, store.instance_id, seat['agent_id'], binding=store.binding)
            except FileExistsError:
                if invite._held(target, store, seat['agent_id']) != invite.MINE:
                    raise SeatRefusal('profile_conflict')
        profile = load_profile(target)
        _directory(target.parent / (seat['agent_id'] + '.outbox'))
        return profile

    def _config(self, seat):
        plan = seat['plan']
        profile = load_profile(plan['profile'])
        if (profile.actor_id != seat['agent_id'] or profile.binding != self.loop.profile.binding
                or profile.db_path != self.loop.profile.db_path or profile.instance_id != self.loop.profile.instance_id):
            raise SeatRefusal('profile_conflict')
        roots = broker_routes.writable_roots(plan['profile'], profile)
        return broker_routes.HostedConfig(plan['config'], plan['profile'], profile, plan['cli'],
            plan['codex_executable'], {'kind': 'codex-hosted-stdio', 'protocol_version': 1,
                'codex_home': plan['codex_home'], 'thread_id': seat['thread_id']},
            plan['cwd'], plan['model'], roots, plan['permission_mode'], plan['reasoning_effort'], seat['role'])

    def _published_config(self, seat):
        config = self._config(seat)
        value = {'v': 2, 'kind': 'codex-hosted-stdio', 'actor_id': seat['agent_id'],
                 'profile': config.profile_path, 'cli': config.cli, 'codex_executable': config.codex_executable,
                 'codex_home': config.destination['codex_home'], 'thread_id': seat['thread_id'],
                 'cwd': config.cwd, 'model': config.model, 'writable_roots': list(config.writable_roots),
                 'permission_mode': config.permission_mode, 'reasoning_effort': config.reasoning_effort,
                 'instructions': config.instructions}
        _write_same(Path(config.config_path), (json.dumps(value, sort_keys=True, indent=1) + '\n').encode('utf-8'))
        from .authority import AuthorityError
        from .route_pins import RoutePinError
        try:
            return self.loop._storage(lambda: broker_routes.preflight_hosted(config.config_path, seat['agent_id'], self.loop.profile))
        except (RoutePinError, AuthorityError) as error:
            raise SeatRefusal('route_conflict') from error

    def _adopt(self, seat, *, install=True):
        if self.loop.host is None:
            raise SeatRefusal('host_not_configured')
        config = self._published_config(seat)
        actor = seat['agent_id']
        if self.operator_routes is not None:
            _, value = broker_routes._private(self.operator_routes)
            if set(value) != {'v', 'routes'} or value['v'] != 1 or type(value['routes']) is not dict:
                raise SeatRefusal('route_conflict')
            if actor in value['routes'] and value['routes'][actor] != config.config_path:
                raise SeatRefusal('route_conflict')
        if actor in self.loop.routes and self.loop.routes[actor] != config.config_path:
            raise SeatRefusal('route_conflict')
        try:
            self.loop.host.add_seat(config, install=install)
        except codex_host.HostFault as error:
            raise SeatRefusal('route_conflict') from error
        if install:
            self.loop.routes[actor] = config.config_path
            self.loop.hosted = self.loop.hosted | {actor}
            self.loop.routed = sorted(self.loop.routes)

    def read(self, schedule):
        """One bounded new route and one pending request, triggered by the normal Core write hint."""
        if self.loop.watch.stopped:
            return
        if (type(schedule) is not dict or set(schedule) != {'ready_seq', 'pending', 'ending'} or type(schedule['ending']) is not bool or type(schedule['pending']) is not bool
                or type(schedule['ready_seq']) is not int or schedule['ready_seq'] < 0):
            raise codex_host.HostFault('seat_schedule_invalid')
        was_ending = self.ending_hint
        self.ending_hint = schedule['ending']
        if self.ending_hint and not was_ending:
            self.end_due, self.end_delay = self.loop.clock.monotonic(), 1
        elif not self.ending_hint:
            self.end_due, self.end_delay = None, 1
        self._tick_endings()
        if self.current is not None:
            return
        route = self._core('hosted_seat_route', self.route_cursor)['seat'] if schedule['ready_seq'] > self.route_cursor else None
        if route is not None:
            try:
                self._adopt(route)
            except (SeatRefusal, OSError, ProfileError, broker_routes.BrokerConfigError) as error:
                reason = error.reason if isinstance(error, SeatRefusal) else 'route_conflict'
                refused = self._core('hosted_seat_route_refuse', route['id'], route['version'], reason)['seat']
                self.loop._event('seat_step', seat_id=route['id'], stage=refused['stage'], state='refused', reason=refused['reason'])
            self.route_cursor = route['ready_seq']
            self.loop.read_needed = True
        seat = self._core('hosted_seat_claim')['seat'] if schedule['pending'] else None
        if seat is None:
            return
        if seat['state'] == 'refused':
            self.loop._event('seat_step', seat_id=seat['id'], stage=seat['stage'], state='refused', reason=seat['reason'])
            self.loop.read_needed = True
            return
        self.current = seat
        self._advance()

    def _endings(self):
        rows = self._core('hosted_seat_endings', self.end_cursor)['seats']
        self.end_cursor = rows[-1]['id'] if len(rows) == 8 else ''
        for seat in rows:
            if self.current is not None and self.current['id'] == seat['id']:
                self.current, self.deadline = None, None
            try:
                config = None
                # A never-ready setup received no model turn. Unknown creation
                # can be abandoned; only its original late receipt may be kept.
                if seat['first_message_id'] is not None:
                    config = self._config(seat)
                    if self.loop.host is None or not self.loop.host.drain_seat(config):
                        continue
                answer = self._core('hosted_seat_retire', seat['id'], seat['version'])
                if answer['retired']:
                    actor = seat['agent_id']
                    if config is not None:
                        self.loop.host.forget_seat(config)
                    self.loop.routes.pop(actor, None)
                    self.loop.hosted = self.loop.hosted - {actor}
                    self.loop.routed = sorted(self.loop.routes)
                    self.loop.read_needed = True
                    self.loop._event('seat_ended', seat_id=seat['id'], actor=actor)
                    self.end_delay = 1
                    self.end_due = self.loop.clock.monotonic() + 1
                else:
                    self.loop._event('seat_end_wait', seat_id=seat['id'], reason=answer['reason'])
            except codex_host.HostFault as error:
                if error.reason != 'route_binding_changed':
                    raise
                self.loop._event('seat_end_wait', seat_id=seat['id'], reason='native_unconfirmed')
            except (SeatRefusal, OSError, ProfileError, broker_routes.BrokerConfigError):
                self.loop._event('seat_end_wait', seat_id=seat['id'], reason='native_unconfirmed')

    def next_deadline(self):
        return self.end_due if self.ending_hint else None

    def _tick_endings(self):
        if not self.ending_hint or self.loop.watch.stopped:
            return
        now = self.loop.clock.monotonic()
        activity = getattr(self.loop.host, 'lifecycle_version', 0)
        changed = activity != self.end_activity
        if not changed and self.end_due is not None and now < self.end_due:
            return
        self.end_activity = activity
        if changed:
            self.end_delay = 1
        self.end_due = now + self.end_delay
        self.end_delay = min(END_RETRY_MAX, self.end_delay * 2)
        self._endings()

    def _advance(self):
        try:
            while self.current is not None:
                seat = self.current
                stage = seat['stage']
                if seat['plan'] is None:
                    if not self._step('profile', {'plan': self._plan(seat)}):
                        return
                elif stage == 'profile':
                    self._profile(seat)
                    if not self._step('thread'):
                        return
                elif stage == 'thread':
                    # Authentication/compatibility happens in the existing child, beside its current turns.
                    self.deadline = self.loop.clock.monotonic() + RPC_SECONDS
                    self._runtime(seat)
                    self.loop.host.ensure_child(seat['plan']['codex_home'], lambda child: self._start(seat, child),
                                               lambda reason: self._child_failed(seat, reason))
                    return
                elif stage == 'persist':
                    self.deadline = self.loop.clock.monotonic() + RPC_SECONDS
                    self._runtime(seat)
                    self.loop.host.ensure_child(seat['plan']['codex_home'], lambda child: self._persist(seat, child),
                                               lambda reason: self._child_failed(seat, reason))
                    return
                elif stage == 'pin':
                    if not self._step('route'):
                        return
                elif stage == 'route':
                    self._adopt(seat, install=False)
                    if not self._step('delivery'):
                        return
                elif stage == 'delivery':
                    self._adopt(seat, install=False)
                    self._step('ready')
                    self.loop.read_needed = True
                    return
                else:
                    # A native creation marker is never replayed by another process or callback.
                    raise SeatRefusal('thread_start_uncertain' if stage == 'starting' else 'thread_persistence_uncertain')
        except SeatRefusal as error:
            self._refuse(error.reason)
        except (OSError, ProfileError, broker_routes.BrokerConfigError):
            self._refuse('profile_write_failed' if self.current['stage'] == 'profile' else 'config_write_failed')

    def _matches(self, sent):
        return self.current is not None and self.current['id'] == sent['id'] and self.current['version'] == sent['version']

    def _runtime(self, seat):
        host, plan = self.loop.host, seat['plan']
        if host is None:
            raise SeatRefusal('host_not_configured')
        if (plan['permission_mode'] != 'full' or host.executables.get(plan['codex_home']) != plan['codex_executable']):
            raise SeatRefusal('route_conflict')

    def _child_failed(self, sent, reason):
        if self._matches(sent):
            self._refuse(reason)

    def _start(self, sent, child):
        if not self._matches(sent) or not self._step('starting'):
            return
        seat = self.current
        config = self._config(seat)
        params = dict(codex_host.thread_settings(config), ephemeral=False, serviceName='theseus')
        child.request('thread/start', params, lambda result, error: self._started(seat, result, error))

    def _started(self, sent, result, error):
        thread = result.get('thread') if type(result) is dict else None
        identity = thread.get('id') if type(thread) is dict else None
        try:
            from .runner import _thread
            identity = _thread(identity)
        except Exception:
            identity = None
        if not self._matches(sent):
            if identity is not None and error is None:
                self._core('hosted_seat_late_thread', sent['id'], sent['version'], identity)
                self.loop._event('seat_late_thread', seat_id=sent['id'], thread_id=identity)
            return
        if error is not None:
            return self._refuse('thread_start_uncertain' if error is codex_host.GONE else 'thread_start_failed')
        if identity is None:
            return self._refuse('thread_start_uncertain')
        if not self._step('persist', {'thread_id': identity}):
            return
        if identity in self.loop.host.threads:
            return self._refuse('route_conflict')
        config = self._config(self.current)
        if not codex_host.settings_applied(result, config.cwd, config.writable_roots, 'full', config.model, config.reasoning_effort):
            return self._refuse('thread_settings_not_applied')
        self._advance()

    def _persist(self, sent, child):
        if not self._matches(sent) or not self._step('persisting'):
            return
        seat = self.current
        child.request('thread/inject_items', {'threadId': seat['thread_id'], 'items': [{
            'type': 'message', 'role': 'developer', 'content': [{'type': 'input_text',
                'text': 'Theseus provisioned this standing seat. This setup record is not work or a human answer. Await Theseus deliveries.'}]}]},
            lambda result, error: self._persisted(seat, result, error))

    def _persisted(self, sent, result, error):
        if not self._matches(sent):
            return
        if error is not None or result != {}:
            return self._refuse('thread_persistence_uncertain' if error is codex_host.GONE else 'thread_persistence_failed')
        if self._step('pin'):
            self.deadline = None
            self._advance()

    def tick(self):
        self._tick_endings()
        if self.current is not None and self.deadline is not None and self.loop.clock.monotonic() >= self.deadline:
            stage = self.current['stage']
            self._refuse('thread_start_uncertain' if stage == 'starting' else
                         'thread_persistence_uncertain' if stage == 'persisting' else 'request_timed_out')

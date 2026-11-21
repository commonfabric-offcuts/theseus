from __future__ import annotations

"""An authorized invitation and its durable, fenced host work (1002)."""

import json
import uuid

from .contract import Refusal, _body, _identifier, _revision
from .delivery import _now_ms
from . import invite
from .runner import RunnerError


KIND = 'workspace.hosted_seat_add'
RETRY_KIND = 'workspace.hosted_seat_retry'
ROLE_BYTES = 16 * 1024
SEAT_SCHEMA = [
    "CREATE TABLE hosted_seats (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), "
    "agent_id TEXT NOT NULL UNIQUE REFERENCES actors(id), inviter_id TEXT NOT NULL REFERENCES actors(id), "
    "owner_id TEXT NOT NULL REFERENCES actors(id), role TEXT NOT NULL, "
    "state TEXT NOT NULL CHECK(state IN ('pending','preparing','refused','ready')), stage TEXT NOT NULL, "
    "version INTEGER NOT NULL, runner_token TEXT, plan TEXT, thread_id TEXT, reason TEXT, "
    "first_message_id TEXT REFERENCES messages(id), ready_seq INTEGER UNIQUE, created_ms INTEGER NOT NULL)",
    "CREATE INDEX hosted_seats_work ON hosted_seats(state,id)",
    "CREATE INDEX hosted_seats_workspace ON hosted_seats(workspace_id,id)",
    "CREATE TABLE hosted_seat_events (seat_id TEXT NOT NULL REFERENCES hosted_seats(id), version INTEGER NOT NULL, "
    "state TEXT NOT NULL, stage TEXT NOT NULL, reason TEXT, thread_id TEXT, at_ms INTEGER NOT NULL, "
    "PRIMARY KEY(seat_id,version))",
    "CREATE TRIGGER hosted_seat_identity BEFORE UPDATE ON hosted_seats WHEN "
    "NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.agent_id IS NOT OLD.agent_id "
    "OR NEW.inviter_id IS NOT OLD.inviter_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.role IS NOT OLD.role "
    "OR NEW.created_ms IS NOT OLD.created_ms OR (OLD.thread_id IS NOT NULL AND NEW.thread_id IS NOT OLD.thread_id) "
    "OR (OLD.plan IS NOT NULL AND NEW.plan IS NOT OLD.plan) "
    "OR (OLD.first_message_id IS NOT NULL AND NEW.first_message_id IS NOT OLD.first_message_id) "
    "OR (OLD.ready_seq IS NOT NULL AND NEW.ready_seq IS NOT OLD.ready_seq) "
    "BEGIN SELECT RAISE(ABORT,'immutable hosted seat identity'); END",
    "CREATE TRIGGER hosted_seat_no_delete BEFORE DELETE ON hosted_seats BEGIN SELECT RAISE(ABORT,'immutable hosted seat'); END",
    "CREATE TRIGGER hosted_seat_event_no_update BEFORE UPDATE ON hosted_seat_events BEGIN SELECT RAISE(ABORT,'immutable hosted seat event'); END",
    "CREATE TRIGGER hosted_seat_event_no_delete BEFORE DELETE ON hosted_seat_events BEGIN SELECT RAISE(ABORT,'immutable hosted seat event'); END",
]
SEAT_DOWN = ['DROP TABLE hosted_seat_events', 'DROP TABLE hosted_seats']
SEAT_OCCUPIED = 'SELECT EXISTS (SELECT 1 FROM hosted_seats)'
STAGES = ('profile', 'thread', 'starting', 'persist', 'persisting', 'pin', 'route', 'delivery', 'ready')
REASONS = frozenset(('host_not_configured', 'host_template_ambiguous', 'host_template_requires_full',
    'profile_conflict', 'profile_write_failed', 'path_conflict', 'auth_missing', 'incompatible', 'spawn_failed',
    'stopping', 'thread_start_failed', 'thread_start_uncertain', 'thread_settings_not_applied',
    'thread_persistence_failed', 'thread_persistence_uncertain', 'request_timed_out', 'child_exited',
    'output_closed', 'pin_conflict', 'route_conflict', 'config_write_failed', 'access_changed'))


SUMMARY_FIELDS = ('id', 'workspace_id', 'agent_id', 'inviter_id', 'owner_id', 'state', 'stage', 'version',
                  'thread_id', 'reason', 'first_message_id')


def _retryable(row):
    return row['state'] == 'refused' and row['stage'] in ('profile', 'thread', 'pin', 'route', 'delivery')


def _record(row, *, private=False, role=True):
    result = {key: row[key] for key in SUMMARY_FIELDS}
    result['retryable'] = _retryable(row)
    if role:
        result['role'] = row['role']
    if private:
        result.update(runner_token=row['runner_token'], plan=json.loads(row['plan']) if row['plan'] else None, ready_seq=row['ready_seq'])
    return result


class HostedSeats:
    def _command_workspace_hosted_seat_retry(self, db, actor, envelope):
        target, args = envelope['target'], envelope['args']
        if set(target) != {'workspace_id', 'seat_request_id'} or args:
            raise Refusal('INVALID_ARGUMENT', 'Name one outcome and the original seat request')
        workspace = self._workspace(db, actor, target['workspace_id'], organise=True)
        identity = _identifier(target['seat_request_id'], 'seat_request_id')
        row = db.execute('SELECT * FROM hosted_seats WHERE workspace_id=? AND id=?', (workspace['id'], identity)).fetchone()
        if row is None:
            raise Refusal('NOT_FOUND', 'No such seat in this outcome')
        _revision(envelope['expected'], 'seat_revision', row['version'])
        if not _retryable(row):
            raise Refusal('SEAT_REQUIRES_RECONCILIATION', 'This seat is active or its native creation/settings need reconciliation. Retry cannot create a replacement context.')
        if not self._seat_access(db, row):
            raise Refusal('SEAT_ACCESS_CHANGED', 'The original owner, invitation authority or membership must be restored before this setup can resume.')
        db.execute("UPDATE hosted_seats SET state='pending',reason=NULL,runner_token=NULL,version=version+1 WHERE id=?", (identity,))
        row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
        self._seat_event(db, row)
        return self._seat_invitation(workspace, row, self._actor(db, row['agent_id'])['name']), [
            {'kind': 'hosted_seat', 'id': identity, 'version': row['version']}]

    def _command_workspace_hosted_seat_add(self, db, actor, envelope):
        target, args = envelope['target'], envelope['args']
        if set(target) != {'workspace_id'} or set(args) != {'name', 'role'}:
            raise Refusal('INVALID_ARGUMENT', 'Name one outcome, a seat name and its role')
        workspace = self._workspace(db, actor, _identifier(target['workspace_id'], 'workspace_id'), organise=True)
        _revision(envelope['expected'], 'workspace_revision', workspace['version'])
        owner = self._actor(db, workspace['owner_id'])
        if owner['kind'] != 'human':
            raise Refusal('HUMAN_OWNER_REQUIRED', 'A headless seat needs a human outcome owner for Stop and Continue')
        role = _body(args['role'])
        if '\0' in role:
            raise Refusal('ROLE_INVALID', 'A seat role cannot contain null characters.')
        if not role.strip():
            raise Refusal('ROLE_REQUIRED', 'Describe what this seat does.')
        if len(role.encode('utf-8')) > ROLE_BYTES:
            raise Refusal('ROLE_TOO_LONG', 'A seat role is at most 16 KiB of UTF-8 text.')
        name = invite._name(args['name'])
        existing = db.execute('SELECT s.*,a.name,a.enabled FROM hosted_seats s JOIN actors a ON a.id=s.agent_id '
            'WHERE s.workspace_id=? AND a.name=? COLLATE NOCASE', (workspace['id'], name)).fetchone()
        if existing is not None:
            member = db.execute('SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?',
                                (workspace['id'], existing['agent_id'])).fetchone()
            if existing['inviter_id'] != actor or not existing['enabled'] or not member:
                raise Refusal('NAME_TAKEN', 'That name already belongs to another invitation. Choose another name.')
            if existing['role'] != role:
                raise Refusal('SEAT_ROLE_MISMATCH', 'This seat already has a recorded role. Keep that role or choose another name.')
            return self._seat_invitation(workspace, existing, existing['name']), []
        # Manual invitations and other outcomes' seats are never adopted.
        if name and invite._holders(db, name, invite.agent_id(name)):
            raise Refusal('NAME_TAKEN', 'That name already belongs to someone here. Choose another name.')
        added, affected = self._command_workspace_agent_invite(db, actor,
            dict(envelope, args={'name': args['name'], 'harness': 'codex'}))
        identity = 'seat-' + uuid.uuid4().hex
        db.execute('INSERT INTO hosted_seats(id,workspace_id,agent_id,inviter_id,owner_id,role,state,stage,version,created_ms) '
                   "VALUES (?,?,?,?,?,?,'pending','profile',1,?)",
                   (identity, workspace['id'], added['agent']['id'], actor, owner['id'], role, _now_ms()))
        seat = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
        self._seat_event(db, seat)
        result = dict(added, seat_request_id=identity, seat=_record(seat))
        return result, affected

    @staticmethod
    def _seat_invitation(workspace, seat, name):
        return {'workspace_id': workspace['id'], 'title': workspace['title'], 'version': workspace['version'],
                'harness': 'codex', 'agent': {'id': seat['agent_id'], 'name': name, 'kind': 'agent'},
                'seat_request_id': seat['id'], 'seat': _record(seat)}

    def _seat_event(self, db, row):
        db.execute('INSERT INTO hosted_seat_events VALUES (?,?,?,?,?,?,?)',
            (row['id'], row['version'], row['state'], row['stage'], row['reason'], row['thread_id'], _now_ms()))
        for kind, scope in (('workspace', row['workspace_id']), ('outcome', row['workspace_id']), ('actor', row['inviter_id'])):
            self._change(db, kind, scope, 'hosted_seat', row['id'], row['version'])

    def _view_hosted_seat(self, db, actor, args):
        workspace = self._workspace(db, actor, _identifier(args.get('workspace_id'), 'workspace_id'))
        identity = _identifier(args.get('seat_request_id'), 'seat_request_id')
        row = db.execute('SELECT * FROM hosted_seats WHERE workspace_id=? AND id=?', (workspace['id'], identity)).fetchone()
        if row is None:
            raise Refusal('NOT_FOUND', 'No such seat in this outcome')
        return {'seat': _record(row)}

    def _view_hosted_seats(self, db, actor, args):
        from .contract import _bounded_page, _page_size
        workspace = self._workspace(db, actor, _identifier(args.get('workspace_id'), 'workspace_id'))
        limit = _page_size(args)
        cursor = args.get('cursor') or ''
        if not isinstance(cursor, str):
            raise Refusal('INVALID_ARGUMENT', 'Use the previous seat page cursor')
        # The team bounds this work even after years of departed-seat history;
        # status summaries never pull every seat's potentially16KiB role text.
        fields = ','.join('s.' + key for key in SUMMARY_FIELDS)
        rows = db.execute('SELECT ' + fields + ' FROM workspace_members m CROSS JOIN hosted_seats s ON s.agent_id=m.actor_id '
                          'WHERE m.workspace_id=? AND s.workspace_id=? AND s.id>? ORDER BY s.id LIMIT ?',
                          (workspace['id'], workspace['id'], cursor, limit + 1)).fetchall()
        return _bounded_page({'instance_id': self.instance_id}, rows, limit, lambda row: _record(row, role=False), 'id')

    def _seat_owned(self, db, guard, token, now):
        return self._ownership(self._runner_state(db), guard, token, now)

    def _seat_access(self, db, row):
        try:
            workspace = self._workspace(db, row['inviter_id'], row['workspace_id'], organise=True)
            self._actor(db, row['inviter_id'])
            self._actor(db, row['owner_id'])
            self._actor(db, row['agent_id'])
            self._workspace(db, row['agent_id'], row['workspace_id'])
            return workspace['owner_id'] == row['owner_id']
        except Refusal:
            return False

    def hosted_seat_claim(self, guard, token):
        """Take one durable request. Uncertain native RPCs never repeat after an owner change."""
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute("SELECT * FROM hosted_seats WHERE state IN ('pending','preparing') ORDER BY id LIMIT 1").fetchone()
            if row is None:
                return {'status': 'ok', 'seat': None}, False
            if row['state'] == 'preparing' and row['runner_token'] == token:
                return {'status': 'ok', 'seat': _record(row, private=True)}, False
            state, reason = 'preparing', None
            if row['stage'] in ('starting', 'persisting'):
                state = 'refused'
                reason = 'thread_start_uncertain' if row['stage'] == 'starting' else 'thread_persistence_uncertain'
            elif not self._seat_access(db, row):
                state, reason = 'refused', 'access_changed'
            db.execute('UPDATE hosted_seats SET state=?,reason=?,runner_token=?,version=version+1 WHERE id=?',
                       (state, reason, token, row['id']))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (row['id'],)).fetchone()
            self._seat_event(db, row)
            return {'status': 'ok', 'seat': _record(row, private=True)}, True
        return self._effect(guard, action)

    def hosted_seat_step(self, guard, token, identity, version, stage, details=None):
        """Advance one checked step; only the running owner may acknowledge its external effect."""
        if stage not in STAGES + ('refused',) or type(version) is not int:
            raise RunnerError('INVALID_ARGUMENT', 'Use a seat stage and exact version')
        details = {} if details is None else details
        if type(details) is not dict or set(details) - {'plan', 'thread_id', 'reason'}:
            raise RunnerError('INVALID_ARGUMENT', 'Use the recorded seat step details')
        if stage == 'refused' and details.get('reason') not in REASONS:
            raise RunnerError('INVALID_ARGUMENT', 'Name the fixed seat refusal reason')
        def action(db, now):
            next_stage, step_details = stage, dict(details)
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            if row is None or row['runner_token'] != token or row['version'] != version or row['state'] != 'preparing':
                raise RunnerError('REVISION_CONFLICT', 'The seat step or its owner changed')
            previous = row['stage']
            if next_stage != 'refused' and not (next_stage == 'profile' == previous and row['plan'] is None or
                    previous in STAGES[:-1] and next_stage == STAGES[STAGES.index(previous) + 1]):
                raise RunnerError('INVALID_ARGUMENT', 'A seat advances only its recorded next step')
            plan = row['plan']
            if 'plan' in step_details:
                if plan is not None or next_stage != 'profile' or type(step_details['plan']) is not dict:
                    raise RunnerError('INVALID_ARGUMENT', 'A seat plan is recorded once before profile effects')
                plan = json.dumps(step_details['plan'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
            thread = row['thread_id']
            if 'thread_id' in step_details:
                from .runner import _thread
                thread = _thread(step_details['thread_id'])
                if previous != 'starting' or next_stage != 'persist' or row['thread_id'] is not None:
                    raise RunnerError('INVALID_ARGUMENT', 'Capture the new native thread once')
            if next_stage in ('persist', 'persisting', 'pin', 'route', 'delivery', 'ready') and thread is None:
                raise RunnerError('INVALID_ARGUMENT', 'A seat has no confirmed thread')
            if next_stage != 'refused' and next_stage != 'profile' and plan is None:
                raise RunnerError('INVALID_ARGUMENT', 'A seat has no recorded host plan')
            message = row['first_message_id']
            ready_seq = row['ready_seq']
            if next_stage != 'refused' and not self._seat_access(db, row):
                next_stage, step_details = 'refused', {'reason': 'access_changed'}
            if next_stage in ('route', 'ready'):
                from .route_pins import RoutePinError
                db.execute('SAVEPOINT seat_step')
                try:
                    if next_stage == 'route':
                        self._seat_pin(db, row, json.loads(plan), thread, now)
                    else:
                        message = self._seat_first_delivery(db, row)
                        ready_seq = db.execute('SELECT coalesce(max(ready_seq),0)+1 FROM hosted_seats').fetchone()[0]
                except (Refusal, RoutePinError):
                    db.execute('ROLLBACK TO seat_step')
                    next_stage, step_details = 'refused', {'reason': 'pin_conflict' if next_stage == 'route' else 'access_changed'}
                finally:
                    db.execute('RELEASE seat_step')
            state = 'refused' if next_stage == 'refused' else 'ready' if next_stage == 'ready' else 'preparing'
            db.execute('UPDATE hosted_seats SET state=?,stage=?,plan=?,thread_id=?,reason=?,first_message_id=?,ready_seq=?,version=version+1 WHERE id=?',
                       (state, previous if next_stage == 'refused' else next_stage, plan, thread, step_details.get('reason'), message, ready_seq, identity))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            self._seat_event(db, row)
            return {'status': 'ok', 'seat': _record(row, private=True)}, True
        return self._effect(guard, action)

    def _seat_pin(self, db, row, plan, thread, now):
        from .route_pins import HOSTED_KIND, _destination, _key, _stored
        from .contract import _json
        binding = dict(instance_id=self.instance_id, db_path=str(self.path), actor_id=row['agent_id'],
                       authority_id=self.binding['authority_id'], authority_epoch=self.binding['authority_epoch'])
        pin = {'v': 1, 'binding': binding, 'destination': {'kind': HOSTED_KIND, 'protocol_version': 1,
                'codex_home': plan['codex_home'], 'thread_id': thread}}
        _destination(pin['destination'], resolve_root=False)
        existing = _stored(db, _key(binding), pin)
        if existing is None:
            db.execute('INSERT INTO metadata VALUES (?,?)', (_key(binding), _json(pin)))
        self._provision_hosted_owner(db, row['agent_id'], row['owner_id'], now)

    def _seat_first_delivery(self, db, row):
        # This delayed Tell is part of the original invitation, not an agent hello.
        workspace = self._workspace(db, row['inviter_id'], row['workspace_id'], organise=True)
        if workspace['owner_id'] != row['owner_id']:
            raise Refusal('FORBIDDEN', 'The seat owner changed before its first delivery')
        self._workspace(db, row['agent_id'], row['workspace_id'])
        conversation = self._conversation_of(db, row['workspace_id'])
        if conversation is None:
            raise Refusal('NOT_FOUND', 'The outcome has no Conversation for this seat')
        body = ('@%s A headless Codex seat was added to this outcome with this role:\n\n%s\n\n'
                'Introduce yourself here in your own words, then await the outcome\'s deliveries. '
                'Use your bound Theseus CLI, read back your reply and acknowledge this delivery separately.' %
                (row['agent_id'], row['role']))
        result, _ = self._command_message_post(db, row['inviter_id'], {'operation_id': 'seat-hello-' + row['id'],
            'target': {'topic_id': conversation['id']}, 'args': {'body': body, 'addressees': [row['agent_id']], 'intent': 'tell',
                'divergence_reason': 'The newly invited headless seat receives its first Conversation task.'}})
        return result['message_id']

    def hosted_seat_route(self, guard, token, after):
        """One new managed route, an additive overlay; the operator route file is never rewritten."""
        from .runner import MAX_SEQ, _bounded
        _bounded(after, 0, MAX_SEQ, 'after')
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute('SELECT * FROM hosted_seats WHERE ready_seq>? ORDER BY ready_seq LIMIT 1', (after,)).fetchone()
            return {'status': 'ok', 'seat': _record(row, private=True) if row else None}, False
        return self._effect(guard, action)

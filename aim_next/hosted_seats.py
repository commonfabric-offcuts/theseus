from __future__ import annotations

"""An authorized invitation and its durable, fenced host work (1002)."""

import json
import re
import uuid

from .contract import Refusal, _body, _identifier, _revision
from .delivery import _now_ms
from . import invite
from .runner import RunnerError


KIND = 'workspace.hosted_seat_add'
RETRY_KIND = 'workspace.hosted_seat_retry'
END_KIND = 'workspace.hosted_seat_end'
ROLE_BYTES = 16 * 1024
ACTIVE_LIMIT = 8
SEAT_SCHEMA = [
    "CREATE TABLE hosted_seats (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), "
    "agent_id TEXT NOT NULL UNIQUE REFERENCES actors(id), inviter_id TEXT NOT NULL REFERENCES actors(id), "
    "owner_id TEXT NOT NULL REFERENCES actors(id), role TEXT NOT NULL, "
    "state TEXT NOT NULL CHECK(state IN ('pending','preparing','refused','ready')), stage TEXT NOT NULL, "
    "version INTEGER NOT NULL, runner_token TEXT, plan TEXT, thread_id TEXT, reason TEXT, "
    "first_message_id TEXT REFERENCES messages(id), ready_seq INTEGER UNIQUE, created_ms INTEGER NOT NULL)",
    "CREATE INDEX hosted_seats_work ON hosted_seats(state,id)",
    "CREATE INDEX hosted_seats_workspace ON hosted_seats(workspace_id,id)",
    "CREATE INDEX hosted_seats_ready ON hosted_seats(state,ready_seq)",
    "CREATE TABLE hosted_seat_events (seat_id TEXT NOT NULL REFERENCES hosted_seats(id), version INTEGER NOT NULL, "
    "state TEXT NOT NULL, stage TEXT NOT NULL, reason TEXT, thread_id TEXT, at_ms INTEGER NOT NULL, "
    "PRIMARY KEY(seat_id,version))",
    "CREATE TRIGGER hosted_seat_identity BEFORE UPDATE ON hosted_seats WHEN "
    "NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.agent_id IS NOT OLD.agent_id "
    "OR NEW.inviter_id IS NOT OLD.inviter_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.role IS NOT OLD.role "
    "OR NEW.created_ms IS NOT OLD.created_ms OR (OLD.thread_id IS NOT NULL AND NEW.thread_id IS NOT OLD.thread_id) "
    "OR (OLD.plan IS NOT NULL AND NEW.plan IS NOT OLD.plan) "
    "OR (OLD.first_message_id IS NOT NULL AND NEW.first_message_id IS NOT OLD.first_message_id) "
    "BEGIN SELECT RAISE(ABORT,'immutable hosted seat identity'); END",
    "CREATE TRIGGER hosted_seat_no_delete BEFORE DELETE ON hosted_seats BEGIN SELECT RAISE(ABORT,'immutable hosted seat'); END",
    "CREATE TRIGGER hosted_seat_event_no_update BEFORE UPDATE ON hosted_seat_events BEGIN SELECT RAISE(ABORT,'immutable hosted seat event'); END",
    "CREATE TRIGGER hosted_seat_event_no_delete BEFORE DELETE ON hosted_seat_events BEGIN SELECT RAISE(ABORT,'immutable hosted seat event'); END",
]
SEAT_DOWN = ['DROP TABLE hosted_seat_events', 'DROP TABLE hosted_seats']
SEAT_OCCUPIED = 'SELECT EXISTS (SELECT 1 FROM hosted_seats)'
END_SCHEMA = [
    "ALTER TABLE hosted_seats ADD COLUMN end_state TEXT CHECK(end_state IN ('ending','ended'))",
    "ALTER TABLE hosted_seats ADD COLUMN end_by TEXT REFERENCES actors(id)",
    "ALTER TABLE hosted_seats ADD COLUMN end_ms INTEGER",
    "ALTER TABLE hosted_seats ADD COLUMN end_version INTEGER",
    "CREATE INDEX hosted_seats_ending ON hosted_seats(end_state,id)",
    "CREATE INDEX hosted_seats_active ON hosted_seats(state,id) WHERE end_state IS NOT 'ended'",
    "CREATE INDEX hosted_seats_setup ON hosted_seats(state,id) WHERE end_state IS NULL",
    "CREATE INDEX hosted_seats_adopt ON hosted_seats(state,ready_seq) WHERE end_state IS NULL",
]
END_DOWN = ['DROP INDEX ' + name for name in ('hosted_seats_ending', 'hosted_seats_active', 'hosted_seats_setup', 'hosted_seats_adopt')] + [
    'ALTER TABLE hosted_seats DROP COLUMN ' + key for key in ('end_version', 'end_ms', 'end_by', 'end_state')]
END_OCCUPIED = 'SELECT EXISTS (SELECT 1 FROM hosted_seats WHERE end_state IS NOT NULL)'
TEMPLATE_SCHEMA = ["ALTER TABLE hosted_seats ADD COLUMN template_id TEXT"]
TEMPLATE_DOWN = ["ALTER TABLE hosted_seats DROP COLUMN template_id"]
TEMPLATE_OCCUPIED = 'SELECT EXISTS (SELECT 1 FROM hosted_seats WHERE template_id IS NOT NULL)'
TEMPLATE_KEY = 'hosted_seat_templates.v1'
TEMPLATE_BYTES = 65536
STAGES = ('profile', 'thread', 'starting', 'persist', 'persisting', 'pin', 'route', 'delivery', 'ready')
REASONS = frozenset(('host_not_configured', 'host_template_ambiguous', 'host_template_unavailable', 'host_template_requires_full',
    'profile_conflict', 'profile_write_failed', 'path_conflict', 'auth_missing', 'incompatible', 'spawn_failed',
    'stopping', 'thread_start_failed', 'thread_start_uncertain', 'thread_settings_not_applied',
    'thread_persistence_failed', 'thread_persistence_uncertain', 'request_timed_out', 'child_exited',
    'output_closed', 'pin_conflict', 'route_conflict', 'config_write_failed', 'access_changed', 'conversation_missing', 'first_delivery_failed'))


SUMMARY_FIELDS = ('id', 'workspace_id', 'agent_id', 'inviter_id', 'owner_id', 'state', 'stage', 'version',
                  'thread_id', 'reason', 'first_message_id', 'end_state', 'end_by', 'end_ms', 'end_version', 'template_id')


def _template_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'template-[0-9a-f]{64}', value):
        raise Refusal('INVALID_ARGUMENT', 'Choose a named existing host template')
    return value


def _template_options(options):
    if type(options) is not list or len(options) > 128:
        raise Refusal('INVALID_ARGUMENT', 'Publish at most128 host templates')
    clean = []
    for item in options:
        if type(item) is not dict or set(item) != {'id', 'actor_id', 'model', 'reasoning_effort'}:
            raise Refusal('INVALID_ARGUMENT', 'Publish only the named template settings')
        _template_id(item['id'])
        _identifier(item['actor_id'], 'actor_id')
        if any(not isinstance(item[key], str) or not 0 < len(item[key]) <= 200 or
               not item[key].isprintable() for key in ('model', 'reasoning_effort')):
            raise Refusal('INVALID_ARGUMENT', 'Publish bounded named template settings')
        clean.append(dict(item))
    if len({item['id'] for item in clean}) != len(clean):
        raise Refusal('INVALID_ARGUMENT', 'Each distinct template appears once')
    return clean


def _retryable(row):
    return row['end_state'] is None and row['state'] == 'refused' and (row['stage'] in ('profile', 'thread', 'pin', 'route', 'delivery')
        or row['stage'] == 'persist' and row['reason'] == 'stopping' and row['thread_id'] is not None)


def _record(row, *, private=False, role=True):
    result = {key: row[key] for key in SUMMARY_FIELDS}
    result['state'] = row['end_state'] or row['state']
    result['retryable'] = _retryable(row)
    if role:
        result['role'] = row['role']
    if private:
        result.update(runner_token=row['runner_token'], plan=json.loads(row['plan']) if row['plan'] else None, ready_seq=row['ready_seq'])
    return result


class HostedSeats:
    def _seat_publish_templates(self, db, token, options):
        """Publish safe settings inside the caller's owned transaction."""
        try:
            clean = _template_options(options)
            for item in clean:
                self._actor(db, item['actor_id'])
        except Refusal as error:
            raise RunnerError(error.code, error.message) from error
        old = db.execute('SELECT value FROM metadata WHERE key=?', (TEMPLATE_KEY,)).fetchone()
        if not clean:
            if old is not None:
                db.execute('DELETE FROM metadata WHERE key=?', (TEMPLATE_KEY,))
            return old is not None
        payload = json.dumps({'runner_token': token, 'items': clean}, sort_keys=True, separators=(',', ':'))
        if len(payload.encode('utf-8')) > TEMPLATE_BYTES:
            raise RunnerError('INVALID_ARGUMENT', 'Host template catalogue exceeds its byte limit')
        if old is not None and old[0] == payload:
            return False
        db.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)', (TEMPLATE_KEY, payload))
        return True

    def hosted_seat_publish_templates(self, guard, token, options):
        """Explicit lease-owner update; acquisition uses the transaction helper."""
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            return {'status': 'ok'}, self._seat_publish_templates(db, token, options)
        return self._effect(guard, action)

    def _seat_templates(self, db):
        state = self._runner_state(db)
        if state['state'] != 'running' or (state['lease_until_ms'] or 0) <= _now_ms():
            return []
        row = db.execute('SELECT substr(CAST(value AS BLOB),1,?) FROM metadata WHERE key=?',
                         (TEMPLATE_BYTES + 1, TEMPLATE_KEY)).fetchone()
        if row is None:
            return []
        try:
            if len(row[0]) > TEMPLATE_BYTES:
                raise ValueError()
            value = json.loads(row[0].decode('utf-8'))
            if type(value) is not dict or set(value) != {'runner_token', 'items'}:
                raise ValueError()
            if value['runner_token'] != state['runner_token']:
                return []
            return [dict(item, name=self._actor(db, item['actor_id'])['name'] or item['actor_id'])
                    for item in _template_options(value['items'])]
        except (ValueError, TypeError, KeyError, Refusal):
            raise Refusal('SEAT_TEMPLATES_UNAVAILABLE', 'Host templates could not be read. Your writing is kept.')

    def _view_hosted_seat_templates(self, db, actor, args):
        workspace = self._workspace(db, actor, _identifier(args.get('workspace_id'), 'workspace_id'))
        self._seat_owner(db, actor, workspace)
        items = self._seat_templates(db)
        return {'instance_id': self.instance_id, 'available': bool(items), 'items': items}

    def _seat_choose_template(self, db, requested):
        items = self._seat_templates(db)
        if requested is not None:
            identity = _template_id(requested)
            if not any(item['id'] == identity for item in items):
                raise Refusal('SEAT_TEMPLATE_UNAVAILABLE', 'The selected template is no longer available. Choose a current named template.')
            return identity
        if len(items) > 1:
            raise Refusal('SEAT_TEMPLATE_REQUIRED', 'Choose an existing host template: ' + ', '.join(item['name'] for item in items))
        return items[0]['id'] if items else None

    def _seat_schedule(self, db):
        return {'pending': bool(db.execute("SELECT EXISTS (SELECT 1 FROM hosted_seats INDEXED BY hosted_seats_setup WHERE end_state IS NULL AND state IN ('pending','preparing'))").fetchone()[0]),
                'ending': bool(db.execute("SELECT EXISTS (SELECT 1 FROM hosted_seats WHERE end_state='ending')").fetchone()[0]),
                'ready_seq': db.execute("SELECT coalesce(max(s.ready_seq),0) FROM hosted_seats s INDEXED BY hosted_seats_adopt JOIN actors a ON a.id=s.agent_id AND a.enabled=1 JOIN workspace_members m ON m.workspace_id=s.workspace_id AND m.actor_id=s.agent_id WHERE s.state='ready' AND s.end_state IS NULL").fetchone()[0]}

    def _command_workspace_hosted_seat_end(self, db, actor, envelope):
        target = envelope['target']
        if set(target) != {'workspace_id', 'seat_request_id'} or envelope['args']:
            raise Refusal('INVALID_ARGUMENT', 'Name one outcome and its seat request')
        workspace = self._workspace(db, actor, target['workspace_id'], organise=True)
        self._seat_owner(db, actor, workspace)
        row = db.execute('SELECT * FROM hosted_seats WHERE workspace_id=? AND id=?',
                         (workspace['id'], _identifier(target['seat_request_id'], 'seat_request_id'))).fetchone()
        if row is None:
            raise Refusal('NOT_FOUND', 'No such seat in this outcome')
        affected = []
        if row['end_state'] is None:
            _revision(envelope['expected'], 'seat_revision', row['version'])
            db.execute("UPDATE hosted_seats SET end_state='ending',end_by=?,end_ms=?,end_version=version,version=version+1 WHERE id=?",
                       (actor, _now_ms(), row['id']))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (row['id'],)).fetchone()
            self._seat_event(db, row)
            affected = [{'kind':'hosted_seat', 'id':row['id'], 'version':row['version']}]
        name = db.execute('SELECT name FROM actors WHERE id=?', (row['agent_id'],)).fetchone()[0]
        return self._seat_invitation(workspace, row, name), affected

    def _command_workspace_hosted_seat_retry(self, db, actor, envelope):
        target, args = envelope['target'], envelope['args']
        if set(target) != {'workspace_id', 'seat_request_id'} or set(args) - {'template_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name one outcome and the original seat request')
        if 'template_id' in args:
            _template_id(args['template_id'])
        workspace = self._workspace(db, actor, target['workspace_id'], organise=True)
        self._seat_owner(db, actor, workspace)
        identity = _identifier(target['seat_request_id'], 'seat_request_id')
        row = db.execute('SELECT * FROM hosted_seats WHERE workspace_id=? AND id=?', (workspace['id'], identity)).fetchone()
        if row is None:
            raise Refusal('NOT_FOUND', 'No such seat in this outcome')
        if row['end_state'] is not None:
            raise Refusal('SEAT_ENDED', 'This seat is ending or ended. A new seat needs a different name.')
        _revision(envelope['expected'], 'seat_revision', row['version'])
        if not _retryable(row):
            raise Refusal('SEAT_REQUIRES_RECONCILIATION', 'This seat is active or its native creation/settings need reconciliation. Retry cannot create a replacement context.')
        template = row['template_id']
        if 'template_id' in args:
            if row['stage'] != 'profile' or row['plan'] is not None or row['thread_id'] is not None:
                raise Refusal('SEAT_TEMPLATE_LOCKED', 'This seat already has its host plan. Its template cannot change.')
            template = self._seat_choose_template(db, args['template_id'])
        if not self._seat_access(db, row):
            raise Refusal('SEAT_ACCESS_CHANGED', 'The current human owner and enabled seat membership are required before setup can resume.')
        if row['reason'] == 'conversation_missing' and self._conversation_of(db, workspace['id']) is None:
            raise Refusal('SEAT_CONVERSATION_REQUIRED', 'Create this outcome’s Conversation before retrying setup.')
        self._seat_capacity(db)
        db.execute("UPDATE hosted_seats SET state='pending',reason=NULL,runner_token=NULL,template_id=?,version=version+1 WHERE id=?", (template, identity))
        row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
        self._seat_event(db, row)
        return self._seat_invitation(workspace, row, self._actor(db, row['agent_id'])['name']), [
            {'kind': 'hosted_seat', 'id': identity, 'version': row['version']}]

    def _command_workspace_hosted_seat_add(self, db, actor, envelope):
        target, args = envelope['target'], envelope['args']
        if set(target) != {'workspace_id'} or not {'name', 'role'} <= set(args) or set(args) - {'name', 'role', 'template_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name one outcome, a seat name and its role')
        if 'template_id' in args:
            _template_id(args['template_id'])
        workspace = self._workspace(db, actor, _identifier(target['workspace_id'], 'workspace_id'), organise=True)
        self._seat_owner(db, actor, workspace)
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
            if existing['end_state'] is not None:
                raise Refusal('SEAT_ENDED', 'This seat is ending or ended. A new seat needs a different name.')
            member = db.execute('SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?',
                                (workspace['id'], existing['agent_id'])).fetchone()
            if existing['inviter_id'] != actor or not existing['enabled'] or not member:
                raise Refusal('NAME_TAKEN', 'That name already belongs to another invitation. Choose another name.')
            if existing['role'] != role:
                raise Refusal('SEAT_ROLE_MISMATCH', 'This seat already has a recorded role. Keep that role or choose another name.')
            if 'template_id' in args and args['template_id'] != existing['template_id']:
                raise Refusal('SEAT_TEMPLATE_MISMATCH', 'This seat already has a recorded template. Keep that choice or choose another name.')
            return self._seat_invitation(workspace, existing, existing['name']), []
        # Manual invitations and other outcomes' seats are never adopted.
        if name and invite._holders(db, name, invite.agent_id(name)):
            raise Refusal('NAME_TAKEN', 'That name already belongs to someone here. Choose another name.')
        self._seat_capacity(db)
        template = self._seat_choose_template(db, args.get('template_id'))
        added, affected = self._command_workspace_agent_invite(db, actor,
            dict(envelope, args={'name': args['name'], 'harness': 'codex'}))
        identity = 'seat-' + uuid.uuid4().hex
        db.execute('INSERT INTO hosted_seats(id,workspace_id,agent_id,inviter_id,owner_id,role,state,stage,version,created_ms,template_id) '
                   "VALUES (?,?,?,?,?,?,'pending','profile',1,?,?)",
                   (identity, workspace['id'], added['agent']['id'], actor, owner['id'], role, _now_ms(), template))
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
            (row['id'], row['version'], row['end_state'] or row['state'], row['stage'], row['reason'], row['thread_id'], _now_ms()))
        self._change(db, 'workspace', row['workspace_id'], 'hosted_seat', row['id'], row['version'])
        owner = db.execute('SELECT owner_id FROM workspaces WHERE id=?', (row['workspace_id'],)).fetchone()[0]
        for actor in {row['inviter_id'], owner}:
            self._change(db, 'actor', actor, 'hosted_seat', row['id'], row['version'])

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

    def _seat_owner(self, db, actor, workspace):
        if actor != workspace['owner_id'] or self._actor(db, actor)['kind'] != 'human':
            raise Refusal('FORBIDDEN', 'Only the outcome’s human owner may add, retry or end a headless seat')

    @staticmethod
    def _seat_capacity(db):
        count = db.execute("SELECT count(*) FROM (SELECT 1 FROM hosted_seats INDEXED BY hosted_seats_active WHERE end_state IS NOT 'ended' AND state IN ('pending','preparing','ready') LIMIT ?)", (ACTIVE_LIMIT,)).fetchone()[0]
        if count >= ACTIVE_LIMIT:
            raise Refusal('SEAT_LIMIT', 'At most8 headless seats may be pending, preparing or ready in this instance.')

    def _seat_access(self, db, row):
        try:
            workspace = db.execute('SELECT * FROM workspaces WHERE id=?', (row['workspace_id'],)).fetchone()
            self._seat_owner(db, workspace['owner_id'], workspace)
            self._actor(db, row['agent_id'])
            self._workspace(db, row['agent_id'], row['workspace_id'])
            return True
        except Refusal:
            return False

    def hosted_seat_claim(self, guard, token):
        """Take one durable request. Uncertain native RPCs never repeat after an owner change."""
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute("SELECT * FROM hosted_seats INDEXED BY hosted_seats_setup WHERE end_state IS NULL AND state IN ('pending','preparing') ORDER BY id LIMIT 1").fetchone()
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
            if row is not None and row['end_state'] is not None:
                # Capture only the original in-flight creation answer. End never
                # advances setup or revives delivery, even when that answer is late.
                if (row['runner_token'] == token and row['end_version'] == version and row['stage'] == 'starting'
                        and stage == 'persist' and row['thread_id'] is None and 'thread_id' in details):
                    from .runner import _thread
                    db.execute('UPDATE hosted_seats SET thread_id=?,version=version+1 WHERE id=?',
                               (_thread(details['thread_id']), identity))
                    row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
                    self._seat_event(db, row)
                    return {'status':'ok', 'seat':_record(row, private=True)}, True
                return {'status':'ok', 'seat':_record(row, private=True)}, False
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
                except (Refusal, RoutePinError) as error:
                    db.execute('ROLLBACK TO seat_step')
                    reason = ('pin_conflict' if next_stage == 'route' else
                              'conversation_missing' if error.code == 'SEAT_CONVERSATION_REQUIRED' else
                              'access_changed' if error.code in ('FORBIDDEN', 'INVALID_ACTOR') else 'first_delivery_failed')
                    next_stage, step_details = 'refused', {'reason': reason}
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
        current = self._hosted_control(db, row['agent_id'])
        owner = current['owner_id'] if current else db.execute('SELECT owner_id FROM workspaces WHERE id=?', (row['workspace_id'],)).fetchone()[0]
        self._provision_hosted_owner(db, row['agent_id'], owner, now)

    def hosted_seat_late_thread(self, guard, token, identity, version, thread):
        """Keep a late creation receipt, without resuming uncertain native work."""
        from .runner import _thread
        thread = _thread(thread)
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            if (row is not None and row['end_state'] is not None and row['runner_token'] == token
                    and row['stage'] == 'starting' and row['thread_id'] is None and
                    (row['end_version'] == version or row['end_version'] == version + 1 and
                     row['state'] == 'refused' and row['reason'] == 'thread_start_uncertain')):
                db.execute('UPDATE hosted_seats SET thread_id=?,version=version+1 WHERE id=?', (thread, identity))
                row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
                self._seat_event(db, row)
                return {'status':'ok', 'seat':_record(row, private=True)}, True
            if (row is None or row['runner_token'] != token or row['stage'] != 'starting' or
                    row['state'] != 'refused' or row['reason'] != 'thread_start_uncertain' or
                    row['version'] != version + 1 or row['thread_id'] is not None):
                return {'status': 'ok', 'seat': _record(row, private=True) if row else None}, False
            db.execute('UPDATE hosted_seats SET thread_id=?,version=version+1 WHERE id=?', (thread, identity))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            self._seat_event(db, row)
            return {'status': 'ok', 'seat': _record(row, private=True)}, True
        return self._effect(guard, action)

    def hosted_seat_route_refuse(self, guard, token, identity, version, reason='route_conflict'):
        """Isolate an unadoptable confirmed route from the host's other seats."""
        if reason not in REASONS:
            raise RunnerError('INVALID_ARGUMENT', 'Name the route refusal reason')
        def action(db, now):
            ownership = self._seat_owned(db, guard, token, now)
            if ownership != 'running':
                return {'status': ownership}, False
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            if row is not None and row['end_state'] is not None:
                return {'status':'ok', 'seat':_record(row, private=True)}, False
            if row is None or row['version'] != version or row['state'] != 'ready':
                raise RunnerError('REVISION_CONFLICT', 'The ready seat changed before route refusal')
            db.execute("UPDATE hosted_seats SET state='refused',stage='route',reason=?,version=version+1 WHERE id=?", (reason, identity))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            self._seat_event(db, row)
            return {'status': 'ok', 'seat': _record(row, private=True)}, True
        return self._effect(guard, action)

    def _seat_first_delivery(self, db, row):
        # This delayed owner Tell is part of the invitation, not an agent hello.
        if row['first_message_id'] is not None:
            return row['first_message_id']
        workspace = db.execute('SELECT * FROM workspaces WHERE id=?', (row['workspace_id'],)).fetchone()
        self._seat_owner(db, workspace['owner_id'], workspace)
        self._workspace(db, row['agent_id'], row['workspace_id'])
        conversation = self._conversation_of(db, row['workspace_id'])
        if conversation is None:
            raise Refusal('SEAT_CONVERSATION_REQUIRED', 'The outcome has no Conversation for this seat')
        body = ('@%s A headless Codex seat was added to this outcome with this role:\n\n%s\n\n'
                'Introduce yourself here in your own words, then await the outcome\'s deliveries. '
                'Use your bound Theseus CLI, read back your reply and acknowledge this delivery separately.' %
                (row['agent_id'], row['role']))
        result, _ = self._command_message_post(db, workspace['owner_id'], {'operation_id': 'seat-hello-' + row['id'],
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
            row = db.execute("SELECT s.* FROM hosted_seats s INDEXED BY hosted_seats_adopt JOIN actors a ON a.id=s.agent_id AND a.enabled=1 "
                             "JOIN workspace_members m ON m.actor_id=s.agent_id AND m.workspace_id=s.workspace_id "
                             "WHERE s.state='ready' AND s.end_state IS NULL AND s.ready_seq>? ORDER BY s.ready_seq LIMIT 1", (after,)).fetchone()
            return {'status': 'ok', 'seat': _record(row, private=True) if row else None}, False
        return self._effect(guard, action)

    def hosted_seat_endings(self, guard, token, after=''):
        """One indexed page, including disabled/departed seats; no membership adoption."""
        if not isinstance(after, str) or len(after) > 200 or any(ord(c) < 32 for c in after):
            raise RunnerError('INVALID_ARGUMENT', 'Use the previous ending-seat cursor')
        def action(db, now):
            owned = self._seat_owned(db, guard, token, now)
            if owned != 'running':
                return {'status':owned}, False
            rows = db.execute("SELECT * FROM hosted_seats WHERE end_state='ending' AND id>? ORDER BY id LIMIT 8", (after,)).fetchall()
            return {'status':'ok', 'seats':[_record(row, private=True) for row in rows]}, False
        return self._effect(guard, action)

    def hosted_seat_retire(self, guard, token, identity, version):
        """The host confirmed this context idle; retire its exact authority only."""
        from .route_pins import _key, _stored, RoutePinError, HOSTED_KIND
        if (not isinstance(identity, str) or not identity or len(identity) > 200 or
                any(ord(c) < 32 for c in identity) or type(version) is not int or version < 1):
            raise RunnerError('INVALID_ARGUMENT', 'Use a seat identity and exact positive version')
        def action(db, now):
            owned = self._seat_owned(db, guard, token, now)
            if owned != 'running':
                return {'status':owned}, False
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            if row is None:
                raise RunnerError('NOT_FOUND', 'No such seat')
            def answer(retired, reason=None):
                return {'status':'ok', 'seat':_record(row, private=True), 'retired':retired, 'reason':reason}
            if row['end_state'] == 'ended':
                return answer(True), False
            if row['end_state'] != 'ending' or row['version'] != version:
                return answer(False, 'seat_changed'), False
            claim = db.execute('SELECT claim_token FROM recipient_schedule WHERE recipient_id=? AND claim_token IS NOT NULL AND claim_until_ms>?',
                               (row['agent_id'], now)).fetchone()
            turns = db.execute('SELECT 1 FROM hosted_turns INDEXED BY hosted_turns_open WHERE thread_id=? AND final_status IS NULL LIMIT 1',
                               (row['thread_id'],)).fetchone()
            if claim or turns:
                return answer(False, 'turn_active'), False
            binding = dict(instance_id=self.instance_id, db_path=str(self.path), actor_id=row['agent_id'],
                           authority_id=self.binding['authority_id'], authority_epoch=self.binding['authority_epoch'])
            key = _key(binding)
            try:
                pin = _stored(db, key)
                plan = json.loads(row['plan']) if row['plan'] else None
                if pin is not None and (plan is None or pin != {'v':1, 'binding':binding, 'destination':{
                        'kind':HOSTED_KIND, 'protocol_version':1, 'codex_home':plan['codex_home'], 'thread_id':row['thread_id']}}):
                    return answer(False, 'pin_conflict'), False
                # The strict control reader proves this exact bound actor and
                # authority. Its human owner may legitimately differ from the
                # immutable original owner after a transfer before pinning.
                self._hosted_control(db, row['agent_id'])
            except (RoutePinError, Refusal, ValueError, KeyError):
                return answer(False, 'pin_conflict'), False
            db.execute('DELETE FROM metadata WHERE key IN (?,?)', (key, 'hosted_control.v1:' + row['agent_id']))
            db.execute("UPDATE hosted_seats SET end_state='ended',version=version+1 WHERE id=?", (identity,))
            row = db.execute('SELECT * FROM hosted_seats WHERE id=?', (identity,)).fetchone()
            self._seat_event(db, row)
            return answer(True), True
        return self._effect(guard, action)

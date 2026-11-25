from __future__ import annotations

"""Guarded, operation-preserving queue retirement and hosted activation (1221)."""

import hashlib
import json
from pathlib import Path

from . import route_pins
from .contract import Refusal, _identifier, _json
from .hosted_recovery import read, put


ACTIVE = 'queue_hosted_active.v1:'
OPERATIONS = 'queue_hosted_operation.v1:'


def active_key(binding):
    return ACTIVE + route_pins._key(binding)[len(route_pins.KEY_PREFIX):]


def queue_retired(db, binding):
    value = read(db, active_key(binding))
    if value is None:
        return False
    if value.get('binding') != binding or not isinstance(value.get('operation_id'), str):
        raise route_pins.RoutePinError('TRANSITION_BINDING_MISMATCH', 'Preserve the original queue retirement binding')
    return True


class Transition:
    def __init__(self, store, actor, old, operation_id, request):
        _identifier(operation_id, 'operation_id')
        self.store, self.actor, self.operation_id = store, actor, operation_id
        self.key, self.old_pin, unused = route_pins._request(store, actor, old)
        if self.old_pin['destination']['kind'] != route_pins.QUEUE_KIND:
            raise Refusal('QUEUE_PIN_REQUIRED', 'Conversion requires the exact original queue pin')
        raw = _json(request)
        if len(raw.encode('utf-8')) > 16384:
            raise Refusal('INVALID_ARGUMENT', 'Keep conversion settings bounded')
        self.request = json.loads(raw)
        self.fingerprint = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        self.binding = self.old_pin['binding']
        self.operation_key = OPERATIONS + hashlib.sha256(operation_id.encode('utf-8')).hexdigest()
        self.active_key = active_key(self.binding)

    def _stopped(self, db):
        state = self.store._runner_state(db)
        if state['state'] not in ('idle', 'stopped') or state['child_pid'] is not None:
            raise Refusal('RUNNER_NOT_STOPPED', 'Stop and clean up the runner before converting a queue seat')
        if (db.execute('SELECT 1 FROM hosted_children WHERE exited_ms IS NULL OR cleanup IS NOT \'confirmed\' LIMIT 1').fetchone()
                or db.execute('SELECT 1 FROM hosted_turns WHERE recipient_id=? AND final_status IS NULL LIMIT 1', (self.actor,)).fetchone()
                or db.execute('SELECT 1 FROM recipient_schedule WHERE recipient_id=? AND claim_token IS NOT NULL LIMIT 1', (self.actor,)).fetchone()):
            raise Refusal('TRANSITION_CHILD_UNKNOWN', 'Reconcile original owned children, turns and claims before conversion')

    def phase(self, guard, action, *, destination=None, reason=None, config_sha256=None):
        if action not in ('read', 'begin', 'creating', 'created', 'prepared', 'commit', 'failed'):
            raise Refusal('INVALID_ARGUMENT', 'Use a conversion phase')
        def effect(db, now):
            self._stopped(db)
            self.store._pin_actor(db, self.actor)
            value = read(db, self.operation_key)
            if value is not None:
                if value.get('binding') != self.binding or value.get('operation_id') != self.operation_id:
                    raise Refusal('TRANSITION_BINDING_MISMATCH', 'Retain the original conversion identity and binding')
                if value.get('request_sha256') != self.fingerprint or value.get('old_pin') != self.old_pin:
                    raise Refusal('TRANSITION_REQUEST_MISMATCH', 'Retry the exact original conversion settings and old pin')
            if action == 'read':
                return {'record':value}, False
            active = read(db, self.active_key)
            if active and (active.get('binding') != self.binding or active.get('operation_id') != self.operation_id):
                raise Refusal('TRANSITION_IN_PROGRESS', 'Reconcile the original conversion before another operation')
            if value is None:
                if action != 'begin':
                    raise Refusal('TRANSITION_MISSING', 'Retain the original conversion request before native effects')
                route_pins._stored(db, self.key, self.old_pin)
                if route_pins._stored(db, self.key) is None:
                    raise Refusal('ROUTE_PIN_MISSING', 'Conversion requires an existing queue pin')
                member = self.store._actor(db, self.actor)
                if member['kind'] != 'agent':
                    raise Refusal('QUEUE_PIN_REQUIRED', 'Only an agent queue seat can be converted')
                owner = db.execute('SELECT kind,enabled FROM actors WHERE id=?',
                                   (_identifier(self.request.get('owner_id'), 'owner_id'),)).fetchone()
                if owner is None or owner['kind'] != 'human' or not owner['enabled']:
                    raise Refusal('INVALID_OWNER', 'A hosted seat owner must be an enabled human')
                control = self.store._hosted_control(db, self.actor)
                if control and control['owner_id'] != self.request['owner_id']:
                    raise Refusal('HOSTED_OWNER_MISMATCH', 'Preserve the existing hosted control owner')
                value = dict(v=1, binding=self.binding, operation_id=self.operation_id,
                    request_sha256=self.fingerprint, request=self.request, old_pin=self.old_pin,
                    phase='retired', destination=None, owner_control=control, retired_ms=now,
                    created_ms=None, committed_ms=None, failure=None, config_sha256=None)
                put(db, self.active_key, dict(v=1, binding=self.binding, operation_id=self.operation_id))
            elif value['phase'] == 'committed':
                expected = dict(self.old_pin, destination=value['destination'])
                route_pins._stored(db, self.key, expected)
                if action == 'commit' and config_sha256 != value['config_sha256']:
                    raise Refusal('TRANSITION_REQUEST_MISMATCH', 'The published config differs from the committed conversion')
                return {'record':value}, False
            elif action == 'begin':
                route_pins._stored(db, self.key, self.old_pin)
                return {'record':value}, False
            elif action == 'creating':
                if value['phase'] != 'retired':
                    raise Refusal('TRANSITION_CREATION_UNCERTAIN', 'Never repeat native creation without reconciling its original result')
                value.update(phase='creating', creation_started_ms=now)
            elif action == 'created':
                new = route_pins._request(self.store, self.actor, destination)[1]['destination']
                if (new['kind'] != route_pins.HOSTED_KIND or new['thread_id'] == self.old_pin['destination']['thread_id']
                        or value['destination'] is not None and value['destination'] != new):
                    raise Refusal('TRANSITION_THREAD_MISMATCH', 'Retain this conversion\'s one distinct hosted thread')
                if value['phase'] not in ('creating', 'uncertain', 'created', 'prepared'):
                    raise Refusal('TRANSITION_PHASE', 'Native creation was not recorded for this operation')
                value.update(destination=new, phase='prepared' if value['phase']=='prepared' else 'created', created_ms=value['created_ms'] or now)
            elif action == 'prepared':
                if value['phase'] not in ('created', 'prepared'):
                    raise Refusal('TRANSITION_PHASE', 'Retain the created thread before preparing it')
                value.update(phase='prepared')
            elif action == 'commit':
                if value['phase'] != 'prepared' or type(config_sha256) is not str or len(config_sha256) != 64:
                    raise Refusal('TRANSITION_PHASE', 'Prepare the exact thread and published config before activation')
                route_pins._stored(db, self.key, self.old_pin)
                current = self.store._hosted_control(db, self.actor)
                if current != value['owner_control']:
                    raise Refusal('TRANSITION_CONTROL_CHANGED', 'Preserve changed Stop/Continue intent; reconcile before activation')
                self.store._provision_hosted_owner(db, self.actor, self.request['owner_id'], now)
                put(db, self.key, dict(self.old_pin, destination=value['destination']))
                value.update(phase='committed', committed_ms=now, config_sha256=config_sha256, failure=None)
            elif action == 'failed':
                value.update(phase='uncertain' if value['phase']=='creating' else value['phase'],
                             failure=reason if isinstance(reason, str) and len(reason)<=128 else 'unconfirmed')
            put(db, self.operation_key, value)
            return {'record':value}, True
        return self.store._effect(guard, effect)['record']


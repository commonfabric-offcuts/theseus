from __future__ import annotations

"""Bounded same-actor activity observations and fenced hosted recovery (1104)."""

import json
import sqlite3
import uuid

from . import delivery, route_pins
from .contract import Refusal, _json


DEFAULT_TURNS = 3
VISIBLE_MS = 24 * 60 * 60 * 1000
REASON = 'Three consecutive completed turns left deliveries pending without a CLI call.'
PREFIX = 'hosted_recovery.v1:'
ACTIVITY = 'hosted_cli_activity.v1:'
MAX_RECORD = 32768


def read(db, key):
    row = db.execute('SELECT substr(CAST(value AS BLOB),1,?) FROM metadata WHERE key=?',
                     (MAX_RECORD + 1, key)).fetchone()
    if row is None:
        return None
    try:
        if len(row[0]) > MAX_RECORD:
            raise ValueError()
        value = json.loads(row[0].decode('utf-8'), object_pairs_hook=route_pins._unique,
                           parse_constant=route_pins._invalid_constant)
        if type(value) is not dict or value.get('v') != 1:
            raise ValueError()
        return value
    except (ValueError, TypeError, RecursionError) as error:
        raise Refusal('HOSTED_RECOVERY_INVALID', 'Preserve the malformed hosted recovery record') from error


def put(db, key, value):
    raw = _json(value)
    if len(raw.encode('utf-8')) > MAX_RECORD:
        raise Refusal('HOSTED_RECOVERY_INVALID', 'Hosted recovery record exceeds its bound')
    db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (key, raw))


class HostedRecovery:
    def _recovery_binding(self, actor):
        return dict(instance_id=self.instance_id, actor_id=actor, db_path=str(self.path),
                    authority_id=self.binding['authority_id'], authority_epoch=self.binding['authority_epoch'])

    def _recovery_record(self, db, actor):
        value = read(db, PREFIX + actor)
        if value and value.get('binding') != self._recovery_binding(actor):
            raise Refusal('HOSTED_RECOVERY_BINDING_MISMATCH', 'Retain the original recovery binding')
        return value or dict(v=1, binding=self._recovery_binding(actor), streak=[], probe=None, intent=None, receipt=None)

    def _save_recovery(self, db, actor, value):
        put(db, PREFIX + actor, value)
        intent = value.get('intent')
        if intent:
            put(db, 'hosted_recovery_intent.v1:' + intent['id'], dict(v=1, binding=value['binding'], **intent))

    def _cli_seq(self, db, actor):
        value = read(db, ACTIVITY + actor)
        if value is None:
            return 0
        if value.get('binding') != self._recovery_binding(actor) or type(value.get('seq')) is not int or value['seq'] < 0:
            raise Refusal('HOSTED_ACTIVITY_INVALID', 'Retain the original activity binding')
        return value['seq']

    def _cli_activity(self, actor, write):
        from .store import _connect
        # This is entered by the actual selected CLI/transport, not a command
        # string event. It has no runner privilege and never acknowledges work.
        with self._authority.shared() as fence:
            db, _ = _connect(self.path)
            try:
                db.execute('BEGIN')
                fence.verify()
                self._check_instance(db)
                self._actor(db, actor)
                if write and self._hosted_thread(db, actor) is None:
                    return dict(v=1, seq=0)
                seq = self._cli_seq(db, actor)
                if write:
                    db.rollback()
                    db.execute('BEGIN IMMEDIATE')
                    fence.verify()
                    self._check_instance(db)
                    self._actor(db, actor)
                    seq = self._cli_seq(db, actor)
                    seq += 1
                    put(db, ACTIVITY + actor, dict(v=1, binding=self._recovery_binding(actor), seq=seq))
                    fence.verify()
                    db.commit()
                return dict(v=1, seq=seq)
            except sqlite3.Error as error:
                from .store import StoreOpenError
                from .runner_faults import busy
                raise StoreOpenError('DATABASE_BUSY' if busy(error) else 'HOSTED_ACTIVITY_UNCONFIRMED',
                                     'CLI activity could not be confirmed', retryable=busy(error)) from error
            finally:
                try:
                    if db.in_transaction: db.rollback()
                finally:
                    db.close()

    def observe_cli(self, actor):
        return self._cli_activity(actor, True)

    def cli_activity(self, actor):
        return self._cli_activity(actor, False)

    def _recovery_context(self, db, actor, destination):
        binding = self._recovery_binding(actor)
        key, expected = route_pins._key(binding), dict(v=1, binding=binding, destination=destination)
        self._actor(db, actor)
        if db.execute('SELECT 1 FROM hosted_seats WHERE agent_id=? AND end_state IS NOT NULL', (actor,)).fetchone():
            return None
        if route_pins._stored(db, key, expected) is None:
            raise route_pins.RoutePinError('ROUTE_PIN_MISSING', 'Explicit provisioning is required')
        control = self._hosted_control_read(db, actor)
        if (not control or control.get('desired') != 'running' or control.get('ending') or control.get('fault')
                or destination['kind'] != route_pins.HOSTED_KIND):
            return None
        schedule = db.execute('SELECT * FROM recipient_schedule WHERE recipient_id=?', (actor,)).fetchone()
        if not schedule or not schedule['pending_count'] or self._pending_head(db, actor) is None:
            return None
        return dict(cli_seq=self._cli_seq(db, actor), revision=control['revision'])

    def begin_hosted_observation(self, guard, token, actor, destination, claim_token, capable, fingerprint=None):
        destination = route_pins._request(self, actor, destination)[1]['destination']
        if type(capable) is not bool:
            raise Refusal('INVALID_ARGUMENT', 'Name whether the selected CLI supports activity observations')
        def action(db, now):
            if self._ownership(self._runner_state(db), guard, token, now) != 'running':
                return {'status':'stale'}, False
            claim = db.execute('SELECT recipient_id,claim_until_ms FROM recipient_schedule WHERE claim_token=?', (claim_token,)).fetchone()
            if not claim or claim['recipient_id'] != actor or claim['claim_until_ms'] <= now:
                return {'status':'stale'}, False
            context = self._recovery_context(db, actor, destination)
            if context is not None:
                context['config_sha256'] = fingerprint
            value = self._recovery_record(db, actor)
            if value['intent'] and value['intent']['phase'] in ('committed', 'cancelled'):
                value.update(intent=None, streak=[])
            probe = value['probe']
            # A steer does not restart the interval of an already observed turn.
            if probe and probe.get('thread_id') == destination['thread_id'] and probe.get('turn_id'):
                return {'status':'observed'}, False
            value['probe'] = dict(context or {}, thread_id=destination['thread_id'], turn_id=None,
                                  claim_token=claim_token, capable=capable and context is not None and isinstance(fingerprint, str) and len(fingerprint) == 64, runner_token=token)
            self._save_recovery(db, actor, value)
            return {'status':'observed'}, True
        return self._effect(guard, action)

    def _recovery_handed(self, db, attempt, turn):
        value = self._recovery_record(db, attempt['recipient_id'])
        probe = value['probe']
        if (probe and probe['claim_token'] == attempt['claim_token'] and probe['runner_token'] == attempt['runner_token']
                and probe['thread_id'] == turn['thread_id']):
            probe['turn_id'] = turn['turn_id']
            self._save_recovery(db, attempt['recipient_id'], value)

    def _recovery_pending(self, db, actor):
        group = db.execute('SELECT id,pending_count FROM delivery_groups INDEXED BY eligible_heads '
                           'WHERE recipient_id=? AND active=1 AND pending_count>0 ORDER BY first_pending_seq LIMIT 1', (actor,)).fetchone()
        if group is None:
            return None
        head = db.execute("SELECT id,seq FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' ORDER BY seq LIMIT 1", (group['id'],)).fetchone()
        return dict(delivery_id=head['id'], seq=head['seq'], group_pending=group['pending_count']) if head else None

    def _recovery_completed(self, db, actor, thread, turn, status, unseen, now):
        if read(db, PREFIX + actor) is None:
            return
        value = self._recovery_record(db, actor)
        probe, value['probe'] = value['probe'], None
        context = None
        if (probe and probe['thread_id'] == thread and probe['turn_id'] == turn and probe['capable']
                and probe['runner_token'] == self._runner_state(db)['runner_token']):
            key = route_pins._key(self._recovery_binding(actor))
            pin = route_pins._stored(db, key)
            if pin and pin['destination']['thread_id'] == thread:
                context = self._recovery_context(db, actor, pin['destination'])
                if context is not None: context['config_sha256'] = probe.get('config_sha256')
        eligible = (status == 'completed' and not unseen and context is not None
                    and context['cli_seq'] == probe.get('cli_seq') and context['revision'] == probe.get('revision'))
        old = value['streak']
        if eligible and self._recovery_pending(db, actor) is None:
            eligible = False
        if not eligible:
            value['streak'] = []
        else:
            # Calls between turns/control changes also break consecutiveness.
            same = old and old[-1]['context'] == context and old[-1]['thread_id'] == thread
            value['streak'] = ((old if same else []) + [dict(turn_id=turn, thread_id=thread, context=context, pending=self._recovery_pending(db, actor))])[-DEFAULT_TURNS:]
            if len(value['streak']) == DEFAULT_TURNS and not value['intent']:
                value['intent'] = dict(id='hr-' + uuid.uuid4().hex, phase='ready', old=pin['destination'], new=None,
                    origin=(value.get('receipt') or {}).get('origin', pin['destination']), context=context,
                    turns=[x['turn_id'] for x in value['streak']], triggering_turns=list(value['streak']), created_ms=now, reason=REASON)
                # The third unanswered wake ordinarily parks. This explicit
                # recovery intent must get its next dispatch without a person
                # manufacturing a fourth message. Work itself remains pending.
                db.execute('UPDATE recipient_schedule SET unanswered_wakes=0,named_seq=NULL WHERE recipient_id=?', (actor,))
        self._save_recovery(db, actor, value)

    def hosted_recovery(self, guard, token, actor, destination, action='read', args=None, fingerprint=None):
        destination = route_pins._request(self, actor, destination)[1]['destination']
        args = args or {}
        if action not in ('read', 'creating', 'created', 'persisted', 'activate', 'failed') or type(args) is not dict:
            raise Refusal('INVALID_ARGUMENT', 'Use a hosted recovery phase')
        allowed = {'read':set(), 'creating':{'intent_id'}, 'created':{'intent_id','thread_id'},
                   'persisted':{'intent_id'}, 'activate':{'intent_id'}, 'failed':{'intent_id'}}
        if set(args) != allowed[action]:
            raise Refusal('INVALID_ARGUMENT', 'Use the exact hosted recovery phase fields')
        def effect(db, now):
            if self._ownership(self._runner_state(db), guard, token, now) != 'running':
                return {'status':'stale'}, False
            value = self._recovery_record(db, actor)
            intent = value['intent']
            if action == 'created' and (intent is None or args['intent_id'] != intent['id']):
                prior = read(db, 'hosted_recovery_intent.v1:' + args['intent_id'])
                if (not prior or prior.get('binding') != value['binding'] or prior.get('old') != destination
                        or 'creation_started_ms' not in prior):
                    raise Refusal('HOSTED_RECOVERY_STALE', 'Retain the original authorized creation')
                new = route_pins._destination(dict(destination, thread_id=args['thread_id']), resolve_root=False)
                if new == destination or prior['new'] is not None and prior['new'] != new:
                    raise Refusal('HOSTED_RECOVERY_ID_MISMATCH', 'This intent already has its one new thread')
                if prior['phase'] == 'committed':
                    return {'status':'late', 'intent':prior}, False
                prior.update(new=new, phase='cancelled')
                put(db, 'hosted_recovery_intent.v1:' + prior['id'], prior)
                return {'status':'late', 'intent':prior}, True
            if intent is None:
                self._recovery_context(db, actor, destination)
                return {'status':'ok', 'intent':None}, False
            if action != 'read' and args['intent_id'] != intent['id']:
                raise Refusal('HOSTED_RECOVERY_STALE', 'Retain the original recovery identity')
            if action == 'created' and intent['new'] is not None and intent['new']['thread_id'] != args['thread_id']:
                raise Refusal('HOSTED_RECOVERY_ID_MISMATCH', 'This intent already has its one new thread')
            if intent['phase'] == 'committed' and intent['new'] == destination:
                return {'status':'ok', 'intent':None}, False
            if intent['old'] != destination:
                raise Refusal('ROUTE_PIN_MISMATCH', 'Recovery names another original destination')
            if intent['phase'] == 'committed':
                return {'status':'ok', 'intent':intent}, False
            # A late creation answer must retain its one id even if control or
            # pending work changed meanwhile. Activation still rechecks below.
            if action == 'created':
                new = route_pins._destination(dict(destination, thread_id=args['thread_id']), resolve_root=False)
                if new == intent['old']:
                    raise Refusal('HOSTED_RECOVERY_ID_MISMATCH', 'Recovery requires a new thread identity')
                if intent['new'] is not None and intent['new'] != new:
                    raise Refusal('HOSTED_RECOVERY_ID_MISMATCH', 'This intent already has its one new thread')
                if intent['phase'] not in ('creating','created','uncertain','prepared','cancelled') or 'creation_started_ms' not in intent:
                    raise Refusal('HOSTED_RECOVERY_STALE', 'Creation was not authorized for this intent')
                intent.update(new=new, phase=intent['phase'] if intent['phase'] in ('cancelled','prepared') else 'created')
            else:
                context = self._recovery_context(db, actor, destination)
                if context is not None: context['config_sha256'] = fingerprint
                active = db.execute('SELECT 1 FROM hosted_turns INDEXED BY hosted_turns_open WHERE thread_id=? AND final_status IS NULL LIMIT 1',
                                    (destination['thread_id'],)).fetchone()
                if context != intent['context'] or active:
                    intent['phase'] = 'cancelled'
                elif action == 'creating' and intent['phase'] == 'ready':
                    intent.update(phase='creating', creation_started_ms=now)
                    self._save_recovery(db, actor, value)
                    return {'status':'ok', 'intent':intent, 'create':True}, True
                elif action == 'failed' and intent['phase'] == 'creating':
                    intent['phase'] = 'uncertain'
                elif action == 'persisted' and intent['phase'] == 'created':
                    intent['phase'] = 'prepared'
                elif action == 'activate' and intent['phase'] == 'prepared':
                    binding = self._recovery_binding(actor)
                    key, old = route_pins._key(binding), dict(v=1, binding=binding, destination=destination)
                    route_pins._stored(db, key, old)
                    put(db, key, dict(old, destination=intent['new']))
                    intent.update(phase='committed', committed_ms=now)
                    value['receipt'] = dict(intent)
                    put(db, 'hosted_recovery_receipt.v1:' + intent['id'], dict(v=1, binding=value['binding'], **intent))
                    db.execute('UPDATE recipient_schedule SET handed_seq=NULL,retry_count=0,next_due_ms=CASE WHEN claim_token IS NULL THEN ? ELSE claim_until_ms END WHERE recipient_id=?', (now,actor))
            self._save_recovery(db, actor, value)
            return {'status':'ok', 'intent':intent, **({'create':False} if action == 'creating' else {})}, True
        return self._effect(guard, effect)

    def _resolve_recovered_pin(self, db, actor, expected, actual):
        value = self._recovery_record(db, actor)
        receipt = value.get('receipt')
        if (actual and actual['binding'] == expected['binding'] and receipt and receipt['phase'] == 'committed'
                and receipt['origin'] == expected['destination'] and receipt['new'] == actual['destination']):
            return actual
        raise route_pins.RoutePinError('ROUTE_PIN_MISMATCH', 'No committed same-binding recovery connects this configured origin')

    def _recovery_health(self, db, actor, now):
        try:
            value = self._recovery_record(db, actor)
            receipt = value.get('receipt')
            visible = receipt if receipt and 0 <= now - receipt['committed_ms'] < VISIBLE_MS else None
            intent = value.get('intent')
            return dict(replacement=visible, recovery_state=intent['phase'] if intent else None) if receipt or intent else {}
        except (Refusal, KeyError, TypeError):
            return dict(replacement=None, recovery_state='invalid')

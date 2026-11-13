from __future__ import annotations

"""Explicit, evidenced artifact checkpoints. Time alone is never a verdict."""

import hashlib
import json
import uuid

from .assessments import text
from .contract import Refusal, _identifier, _json, _page_size, _bounded_page, organises
from .delivery import _now_ms

PREFIX = 'checkpoint.v1:'
POLICY_FIELDS = {'assessor_id', 'team', 'assignment', 'source_message_ids', 'operator_id'}


def hashed(value):
    return hashlib.sha256(_json(value).encode('utf-8')).hexdigest()


def index(kind, identity):
    return 'checkpoint_index.v1:' + kind + ':' + hashed(identity) + ':'


def millis(value):
    if type(value) is not int or not 0 < value <= 253402300799999:
        raise Refusal('INVALID_ARGUMENT', 'A checkpoint time must be UTC epoch milliseconds')
    return value


class Checkpoints:
    def _checkpoint(self, db, actor, identity):
        identity = _identifier(identity, 'checkpoint_id')
        row = db.execute('SELECT value FROM metadata WHERE key=?', (PREFIX+identity,)).fetchone()
        if row is None:
            raise Refusal('FORBIDDEN', 'No readable checkpoint')
        record = json.loads(row[0])
        self._topic(db, actor, record['topic_id'])
        return record

    def _checkpoint_target(self, db, actor, envelope):
        if set(envelope['target']) != {'checkpoint_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name exactly one checkpoint')
        return self._checkpoint(db, actor, envelope['target']['checkpoint_id'])

    def _checkpoint_operator(self, db, actor, record, allow_organizer=False):
        topic = self._topic(db, actor, record['topic_id'])
        if not organises(topic, actor) or (actor != record['operator_id'] and not allow_organizer):
            raise Refusal('FORBIDDEN', 'Only the named authorized operator observes this checkpoint')

    def _checkpoint_revision(self, envelope, record):
        if envelope['expected']['checkpoint_revision'] != record['version']:
            raise Refusal('CHECKPOINT_CHANGED', 'Read the current checkpoint before observing or closing it')
        if record['state'] != 'open':
            raise Refusal('CHECKPOINT_CLOSED', 'This checkpoint has reached its result boundary')

    def _checkpoint_due_key(self, record):
        return index('due', record['operator_id']) + '%015d:' % record['due_ms'] + record['id']

    def _save_checkpoint(self, db, record, old_due=None):
        if old_due:
            db.execute('DELETE FROM metadata WHERE key=?', (old_due,))
        record['version'] += 1
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (PREFIX+record['id'], _json(record)))
        if record['state'] == 'open':
            db.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)',
                       (self._checkpoint_due_key(record), record['id']))
        self._change(db, 'topic', record['topic_id'], 'checkpoint', record['id'], record['version'])
        self._change(db, 'actor', record['operator_id'], 'checkpoint', record['id'], record['version'])

    def _command_checkpoint_create(self, db, actor, envelope):
        args = envelope['args']
        if set(args) != POLICY_FIELDS | {'artifact', 'due_ms', 'miss_limit'}:
            raise Refusal('INVALID_ARGUMENT', 'Name an assessment policy, artifact, due time and miss limit')
        policy = self._assessment_policy(db, actor, {k:args[k] for k in POLICY_FIELDS}, envelope['target'])
        artifact, due = text(args['artifact'], 'artifact'), millis(args['due_ms'])
        threshold = args['miss_limit']
        if type(threshold) is not int or not 2 <= threshold <= 10:
            raise Refusal('INVALID_ARGUMENT', 'miss_limit must be between 2 and 10')
        active_key = 'checkpoint_active.v1:' + hashed([policy['topic_id'], sorted(policy['team']), policy['assignment']])
        fingerprint = hashed(args)
        active = db.execute('SELECT value FROM metadata WHERE key=?', (active_key,)).fetchone()
        if active:
            previous = self._checkpoint(db, actor, active[0])
            if previous['state'] == 'open':
                if previous['policy_fingerprint'] != fingerprint or previous['requested_by'] != actor:
                    raise Refusal('CHECKPOINT_ALREADY_ACTIVE', 'Close the active policy before changing it')
                return {'checkpoint_id':previous['id']}, []
            if previous['state'] == 'assessment-requested':
                assessment = self._assessment(db,actor,previous['assessment_id'])
                if not assessment['renewal']:
                    raise Refusal('CHECKPOINT_RENEWAL_REQUIRED', 'Record the operator renewal before adopting the next checkpoint policy')
        identity = 'checkpoint-' + uuid.uuid4().hex
        record = dict(policy, id=identity, policy_fingerprint=fingerprint, artifact=artifact, due_ms=due,
                      miss_limit=threshold, state='open', consecutive_misses=0, observation_count=0,
                      assessment_id=None, created_ms=_now_ms(), version=0)
        self._save_checkpoint(db, record)
        db.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)', (active_key, identity))
        for kind, scope in (('topic',record['topic_id']), ('operator',record['operator_id'])):
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?)', (index(kind,scope)+identity, identity))
        return {'checkpoint_id':identity}, []

    def _command_checkpoint_observe(self, db, actor, envelope):
        record = self._checkpoint_target(db, actor, envelope)
        self._checkpoint_operator(db, actor, record)
        args = envelope['args']
        if set(args) != {'observation_id','status','note','evidence_message_ids','wait_kind','fault_key','next_artifact','next_due_ms'}:
            raise Refusal('INVALID_ARGUMENT', 'Supply the observation, evidence, known wait and next artifact/time')
        identity = _identifier(args['observation_id'], 'observation_id')
        retry_key = index('observation-id', record['id']) + hashed(identity)
        fingerprint = hashed(args)
        previous = db.execute('SELECT value FROM metadata WHERE key=?', (retry_key,)).fetchone()
        if previous:
            receipt = json.loads(previous[0])
            if receipt['fingerprint'] != fingerprint:
                raise Refusal('CHECKPOINT_OBSERVATION_MISMATCH', 'An observation id cannot name different evidence')
            return receipt['result'], []
        self._checkpoint_revision(envelope, record)
        status, wait, fault = args['status'], args['wait_kind'], args['fault_key']
        if not isinstance(status,str) or status not in ('met','missed','waiting','unknown'):
            raise Refusal('INVALID_ARGUMENT', 'Unknown checkpoint observation status')
        if (not isinstance(wait,str) or wait not in ('none','human','tool')
                or (status == 'waiting') != (wait != 'none')):
            raise Refusal('INVALID_ARGUMENT', 'Known human/tool waits must be recorded as waiting, never missed')
        if fault is not None:
            _identifier(fault,'fault_key')
            if status != 'missed':
                raise Refusal('INVALID_ARGUMENT', 'Only an evidenced missed result can name a recurring fault')
        now = _now_ms()
        if status == 'missed' and now < record['due_ms']:
            raise Refusal('CHECKPOINT_NOT_DUE', 'A future commitment is not a missed checkpoint')
        due = millis(args['next_due_ms'])
        if due <= now:
            raise Refusal('INVALID_ARGUMENT', 'The next checkpoint must be in the future')
        note, artifact = text(args['note'],'note'), text(args['next_artifact'],'next_artifact')
        evidence = self._assessment_sources(db, (actor,record['assessor_id'],record['requested_by']),
                                            record['topic_id'], args['evidence_message_ids'])
        count = record['consecutive_misses']
        count = count + 1 if status == 'missed' else 0 if status == 'met' else count
        recurrence = 0
        if fault is not None:
            fault_key = index('fault',record['id']) + hashed(fault)
            previous = db.execute('SELECT value FROM metadata WHERE key=?', (fault_key,)).fetchone()
            recurrence = (int(previous[0]) if previous else 0) + 1
            db.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)', (fault_key,str(recurrence)))
        seq = record['observation_count'] + 1
        observation = dict(args, seq=seq, by=actor, recorded_ms=now, expected_artifact=record['artifact'],
                           expected_due_ms=record['due_ms'], consecutive_misses=count, fault_recurrences=recurrence)
        assessment = None
        affected = []
        if count >= record['miss_limit'] or recurrence >= record['miss_limit']:
            # The create act adopted this policy. No inference from elapsed time/prose.
            sources = list(dict.fromkeys(record['source_message_ids'][:1] + evidence + record['source_message_ids']))[:20]
            policy = {k:record[k] for k in POLICY_FIELDS}
            policy['source_message_ids'] = sources
            # A manual assessment of this exact team/assignment also suppresses duplication.
            from .assessments import ACTIVE
            active_key = ACTIVE + hashed([record['topic_id'], sorted(record['team']), record['assignment']])
            active = db.execute('SELECT value FROM metadata WHERE key=?',(active_key,)).fetchone()
            prior = self._assessment(db,actor,active[0]) if active else None
            if prior and prior['state'] != 'reported':
                if prior['operator_id'] != record['operator_id'] or prior['assessor_id'] != record['assessor_id']:
                    raise Refusal('ASSESSMENT_ALREADY_ACTIVE','Resolve the conflicting active assessor/operator')
                assessment = prior['id']
            else:
                result, affected = self._command_assessment_request(db, actor, dict(envelope,
                    target={'topic_id':record['topic_id']},args=policy))
                assessment = result['assessment_id']
                requested = self._assessment(db,actor,assessment)
                requested['checkpoint'] = dict(id=record['id'],observation=observation,
                    miss_limit=record['miss_limit'],policy_requested_by=record['requested_by'])
                self._save_assessment(db,requested)
            record.update(state='assessment-requested', assessment_id=assessment)
        old_due = self._checkpoint_due_key(record)
        record.update(artifact=artifact,due_ms=due,consecutive_misses=count,observation_count=seq,
                      last_observation=observation)
        self._save_checkpoint(db,record,old_due)
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?)',
                   (index('history',record['id'])+'%020d' % seq, _json(observation)))
        result = dict(checkpoint_id=record['id'],observation_seq=seq,assessment_id=assessment)
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?)', (retry_key,_json(dict(fingerprint=fingerprint,result=result))))
        return result, affected

    def _command_checkpoint_prompt(self, db, actor, envelope):
        record = self._checkpoint_target(db,actor,envelope)
        self._checkpoint_operator(db,actor,record,allow_organizer=True)
        if envelope['args']:
            raise Refusal('INVALID_ARGUMENT','A checkpoint prompt takes no extra arguments')
        if record['state'] != 'open' or record['due_ms'] > _now_ms():
            raise Refusal('CHECKPOINT_NOT_DUE','No open checkpoint is due')
        key = index('prompt',record['id'])+str(record['version'])
        prior = db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()
        if prior:
            return {'checkpoint_id':record['id'],'message_id':prior[0]}, []
        body = ('Checkpoint due: %s\nExpected artifact: %s\nPlease record the observed evidence and any human or tool wait. '
                'Elapsed time alone is not a missed commitment or an assessment verdict.' % (record['assignment'],record['artifact']))
        result, affected = self._command_message_post(db,actor,dict(envelope,kind='message.post',
            target={'topic_id':record['topic_id']},args=dict(body=body,intent='tell',
            addressees=[record['operator_id']],reply_to=record['source_message_ids'][0])))
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?)',(key,result['message_id']))
        return {'checkpoint_id':record['id'],'message_id':result['message_id']}, affected

    def _command_checkpoint_close(self, db, actor, envelope):
        record = self._checkpoint_target(db,actor,envelope)
        self._checkpoint_operator(db,actor,record,allow_organizer=True)
        self._checkpoint_revision(envelope,record)
        if set(envelope['args']) != {'reason'}:
            raise Refusal('INVALID_ARGUMENT','Record why this checkpoint ends')
        reason = text(envelope['args']['reason'],'reason')
        record.update(state='closed',closed_by=actor,closed_ms=_now_ms(),close_reason=reason)
        self._save_checkpoint(db,record,self._checkpoint_due_key(record))
        return {'checkpoint_id':record['id']}, []

    def _view_checkpoint(self, db, actor, args):
        return {'instance_id':self.instance_id,'checkpoint':self._checkpoint(db,actor,args.get('checkpoint_id'))}

    def _view_checkpoints(self, db, actor, args):
        topic = args.get('topic_id')
        if topic is not None:
            self._topic(db,actor,topic)
        prefix = index('topic' if topic is not None else 'operator',topic if topic is not None else actor)
        return self._checkpoint_page(db,actor,args,prefix,prefix+'\uffff')

    def _checkpoint_page(self, db, actor, args, prefix, end):
        limit = _page_size(args)
        cursor = args.get('cursor','')
        if cursor:
            _identifier(cursor,'cursor')
        rows = db.execute('SELECT value AS id, substr(key,?) AS cursor FROM metadata WHERE key>? AND key<? ORDER BY key LIMIT ?',
                          (len(prefix)+1,prefix+cursor,end,limit+1)).fetchall()
        return _bounded_page({'instance_id':self.instance_id},rows,limit,
                             lambda row:dict(self._checkpoint(db,actor,row['id']),cursor=row['cursor']),'cursor')

    def _view_checkpoints_due(self, db, actor, args):
        now = _now_ms()
        before = millis(args.get('before_ms',now))
        if before > now:
            raise Refusal('INVALID_ARGUMENT','A future checkpoint is not due')
        prefix = index('due',actor)
        return self._checkpoint_page(db,actor,args,prefix,prefix+'%015d;' % before)

    def _view_checkpoint_observations(self, db, actor, args):
        record = self._checkpoint(db,actor,args.get('checkpoint_id'))
        limit = _page_size(args)
        cursor = args.get('cursor',0)
        prefix = index('history',record['id'])
        rows = db.execute('SELECT value FROM metadata WHERE key>? AND key<? ORDER BY key LIMIT ?',
                          (prefix+'%020d' % cursor,prefix+'\uffff',limit+1)).fetchall()
        return _bounded_page({'instance_id':self.instance_id},[json.loads(r[0]) for r in rows],limit,lambda row:row,'seq')

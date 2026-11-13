from __future__ import annotations

"""Explicit assessment requests and reports, stored in the instance's authority.

The dispatcher owns no facts: native-thread attachment and the final report are
recorded here. Nothing in this module reads message prose to infer an instruction.
"""

import hashlib
import json
import uuid

from .contract import Refusal, _body, _identifier, _json, _page_size, _bounded_page, organises
from .delivery import _now_ms
from .outcome_kind import _clock

PREFIX = 'assessment.v1:'
THREAD = 'assessment_thread.v1:'
ACTIVE = 'assessment_active.v1:'
RECOMMENDATIONS = frozenset(('continue', 'remove-blocker', 'clarify-scope', 'add-help',
                             'refresh-context', 'replace-member', 'replace-team'))
DECISIONS = frozenset(('retain', 'remove-blocker', 'clarify-scope', 'add-help', 'refresh', 'replace', 'end'))


def text(value, field, limit=8192):
    value = _body(value)
    if not value.strip() or len(value.encode('utf-8')) > limit:
        raise Refusal('INVALID_ARGUMENT', '%s must be nonempty bounded text' % field)
    return value


def identifiers(value, field, limit):
    if not isinstance(value, list) or not 1 <= len(value) <= limit:
        raise Refusal('INVALID_ARGUMENT', '%s needs 1 to %s identifiers' % (field, limit))
    for entry in value:
        _identifier(entry, field)
    if len(set(value)) != len(value):
        raise Refusal('INVALID_ARGUMENT', '%s must not repeat an identifier' % field)
    return list(value)


def index_prefix(kind, identity):
    # Arbitrary valid actor/topic identifiers cannot collide with separators.
    digest = hashlib.sha256(identity.encode('utf-8')).hexdigest()
    return 'assessment_index.v1:' + kind + ':' + digest + ':'


def native_thread(value):
    try:
        if isinstance(value, str) and str(uuid.UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise Refusal('INVALID_ARGUMENT', 'thread_id must be a canonical UUID')


class Assessments:
    def _assessment(self, db, actor, identity):
        identity = _identifier(identity, 'assessment_id')
        row = db.execute('SELECT value FROM metadata WHERE key=?', (PREFIX + identity,)).fetchone()
        if row is None:
            raise Refusal('FORBIDDEN', 'No readable assessment')
        record = json.loads(row[0])
        self._topic(db, actor, record['topic_id'])
        return record

    def _save_assessment(self, db, record):
        record['version'] += 1
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (PREFIX + record['id'], _json(record)))
        self._change(db, 'actor', record['assessor_id'], 'assessment', record['id'], record['version'])

    def _assessment_reached(self, db, workspace_id):
        return db.execute('SELECT w.title,r.reached_ms FROM outcome_reached r JOIN workspaces w ON w.id=r.workspace_id '
                          'WHERE r.workspace_id=?', (workspace_id,)).fetchone()

    def _assessment_open(self, db, workspace_id):
        # Assessment records change only the assessor's feed, which Store._refuse_reached
        # does not see, so every assessment write states finality itself (D42, 4.5).
        reached = self._assessment_reached(db, workspace_id)
        if reached is not None:
            raise Refusal('OUTCOME_REACHED', '%s was reached on %s; its topics are kept to read.' % (reached[0], _clock(reached[1])))

    def _assessment_target(self, db, actor, envelope):
        if set(envelope['target']) != {'assessment_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name exactly one assessment')
        record = self._assessment(db, actor, envelope['target']['assessment_id'])
        self._assessment_open(db, record['workspace_id'])
        return record

    def _assessment_sources(self, db, readers, topic_id, ids):
        ids = identifiers(ids, 'source_message_ids', 20)
        for identity in ids:
            for reader in readers:
                source = self._message_access(db, reader, identity)
                if source['topic_id'] != topic_id:
                    raise Refusal('ASSESSMENT_SOURCE_SCOPE', 'Evidence must belong to the named topic')
                if source['private_to']:
                    raise Refusal('ASSESSMENT_PRIVATE_SOURCE', 'Private evidence needs a private assessment path; its audience cannot be widened')
        return ids

    def _assessment_policy(self, db, actor, args, target):
        fields = {'assessor_id', 'team', 'assignment', 'source_message_ids', 'operator_id'}
        if set(target) != {'topic_id'} or set(args) != fields:
            raise Refusal('INVALID_ARGUMENT', 'Name the topic, assessor, team, assignment, sources and operator')
        topic = self._topic(db, actor, target['topic_id'])
        self._assessment_open(db, topic['workspace_id'])
        if topic['kind'] == 'conversation':
            raise Refusal('ASSESSMENT_TOPIC_REQUIRED', 'Use a named topic for an assessment; its report must not settle another conversation item')
        if not organises(topic, actor):
            raise Refusal('FORBIDDEN', 'Only the outcome owner or coordinator requests an assessment')
        assessor = _identifier(args['assessor_id'], 'assessor_id')
        team = identifiers(args['team'], 'team', 8)
        if assessor in team:
            raise Refusal('INVALID_ARGUMENT', 'The assessor cannot be a member of the team being assessed')
        for member in team + [assessor]:
            self._workspace(db, member, topic['workspace_id'])
            if self._actor(db, member)['kind'] != 'agent':
                raise Refusal('INVALID_ARGUMENT', 'Assessment names existing agents')
        operator = _identifier(args['operator_id'], 'operator_id')
        self._actor(db, operator)
        self._workspace(db, operator, topic['workspace_id'])
        if not organises(topic, operator):
            raise Refusal('FORBIDDEN', 'The intervention operator must own or coordinate this outcome')
        sources = self._assessment_sources(db, (actor, assessor), topic['id'], args['source_message_ids'])
        assignment = text(args['assignment'], 'assignment')
        return dict(topic_id=topic['id'], workspace_id=topic['workspace_id'], requested_by=actor,
                    assessor_id=assessor, operator_id=operator, team=team,
                    assignment=assignment, source_message_ids=sources)

    def _command_assessment_request(self, db, actor, envelope):
        policy = self._assessment_policy(db, actor, envelope['args'], envelope['target'])
        topic = self._topic(db, actor, policy['topic_id'])
        assessor, operator, team = policy['assessor_id'], policy['operator_id'], policy['team']
        assignment, sources = policy['assignment'], policy['source_message_ids']
        active_key = ACTIVE + hashlib.sha256(_json([topic['id'], sorted(team), assignment]).encode('utf-8')).hexdigest()
        active = db.execute('SELECT value FROM metadata WHERE key=?', (active_key,)).fetchone()
        if active is not None:
            previous = self._assessment(db, actor, active[0])
            if previous['state'] not in ('reported', 'abandoned'):
                same = (previous['requested_by'] == actor and previous['assessor_id'] == assessor
                        and previous['operator_id'] == operator and previous['source_message_ids'] == sources)
                if not same:
                    raise Refusal('ASSESSMENT_ALREADY_ACTIVE', 'This team and assignment already have an active assessment')
                return {'assessment_id':previous['id']}, []
        identity = 'assessment-' + uuid.uuid4().hex
        record = dict(id=identity, topic_id=topic['id'], workspace_id=topic['workspace_id'],
                      requested_by=actor, assessor_id=assessor, operator_id=operator, team=team,
                      assignment=assignment, source_message_ids=sources,
                      state='requested', thread_id=None, runtime_digest=None, report_message_id=None, report_fingerprint=None,
                      renewal=None, requested_ms=_now_ms(), attached_ms=None, reported_ms=None, version=0)
        self._save_assessment(db, record)
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (active_key, identity))
        for kind, owner in (('topic',topic['id']), ('assessor',assessor)):
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?)', (index_prefix(kind, owner)+identity, identity))
        return {'assessment_id':identity}, [{'kind':'assessment', 'id':identity, 'version':record['version']}]

    def _command_assessment_attach(self, db, actor, envelope):
        record = self._assessment_target(db, actor, envelope)
        if actor != record['assessor_id']:
            raise Refusal('FORBIDDEN', 'Only the assigned assessor attaches its fresh context')
        if set(envelope['args']) != {'thread_id', 'runtime_digest'}:
            raise Refusal('INVALID_ARGUMENT', 'Attach exactly one native thread and runtime fingerprint')
        thread = native_thread(envelope['args']['thread_id'])
        digest = envelope['args']['runtime_digest']
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise Refusal('INVALID_ARGUMENT', 'runtime_digest must be a SHA256 hex digest')
        if record['state'] == 'abandoned':
            raise Refusal('ASSESSMENT_ABANDONED', 'This request was abandoned; request a fresh assessment')
        if record['thread_id']:
            if record['thread_id'] != thread or record['runtime_digest'] != digest:
                raise Refusal('ASSESSMENT_THREAD_MISMATCH', 'Resume the recorded assessment thread; never rebind it')
            return {'assessment_id':record['id'], 'thread_id':thread}, []
        used = db.execute('SELECT value FROM metadata WHERE key=?', (THREAD+thread,)).fetchone()
        if used is not None:
            raise Refusal('ASSESSMENT_THREAD_REUSED', 'Another assessment already owns this thread')
        # Also refuse all standing seats, including the assessor's own route.
        pinned = db.execute("SELECT 1 FROM metadata WHERE key>='route_pin.v1:' AND key<'route_pin.v1;' AND "
                            "json_valid(value) AND json_extract(value,'$.destination.thread_id')=? LIMIT 1", (thread,)).fetchone()
        if pinned:
            raise Refusal('ASSESSMENT_THREAD_REUSED', 'A standing agent context cannot become an assessor')
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?)', (THREAD+thread, record['id']))
        record.update(thread_id=thread, runtime_digest=digest, state='attached', attached_ms=_now_ms())
        self._save_assessment(db, record)
        return {'assessment_id':record['id'], 'thread_id':thread}, []

    def _command_assessment_finish(self, db, actor, envelope):
        record = self._assessment_target(db, actor, envelope)
        args = envelope['args']
        if actor != record['assessor_id']:
            raise Refusal('FORBIDDEN', 'Only the assigned assessor records its report')
        if set(args) != {'thread_id','body','recommendation','evidence_message_ids','next_checkpoint'}:
            raise Refusal('INVALID_ARGUMENT', 'Name the assessment thread, report, recommendation, evidence and next checkpoint')
        if record['state'] == 'abandoned':
            raise Refusal('ASSESSMENT_ABANDONED', 'This request was abandoned; its late report cannot be published')
        if record['thread_id'] is None:
            raise Refusal('ASSESSMENT_NOT_ATTACHED', 'Attach a fresh context before reporting')
        if args['thread_id'] != record['thread_id']:
            raise Refusal('ASSESSMENT_THREAD_MISMATCH', 'The report belongs to another native thread')
        if not isinstance(args['recommendation'], str) or args['recommendation'] not in RECOMMENDATIONS:
            raise Refusal('INVALID_ARGUMENT', 'Unknown assessment recommendation')
        body = text(args['body'], 'report', 65536)
        checkpoint = text(args['next_checkpoint'], 'next_checkpoint')
        # A report of unavailable source access must not fabricate a citation.
        evidence = [] if args['evidence_message_ids'] == [] else self._assessment_sources(
            db, (actor,record['requested_by'],record['operator_id']), record['topic_id'], args['evidence_message_ids'])
        fingerprint = hashlib.sha256(_json(args).encode('utf-8')).hexdigest()
        if record['report_message_id']:
            if fingerprint != record['report_fingerprint']:
                raise Refusal('ASSESSMENT_REPORT_MISMATCH', 'This assessment already has a different report')
            return {'assessment_id':record['id'], 'message_id':record['report_message_id']}, []
        post = dict(envelope, kind='message.post', target={'topic_id':record['topic_id']}, args={
            'body':body, 'intent':'tell', 'addressees':list(dict.fromkeys((record['requested_by'],record['operator_id']))),
            'reply_to':record['source_message_ids'][0]})
        snapshot = self._writing(post['args'])
        result, affected = self._publish(db, actor, envelope['operation_id'], record['topic_id'], snapshot, record_only=True)
        record.update(state='reported', reported_ms=_now_ms(), report_message_id=result['message_id'],
                      report_fingerprint=fingerprint, recommendation=args['recommendation'],
                      evidence_message_ids=evidence, next_checkpoint=checkpoint)
        self._save_assessment(db, record)
        return {'assessment_id':record['id'], 'message_id':result['message_id']}, affected

    def _command_assessment_abandon(self, db, actor, envelope):
        record = self._assessment_target(db, actor, envelope)
        topic = self._topic(db, actor, record['topic_id'])
        if actor != record['assessor_id'] and not (actor in (record['operator_id'], record['requested_by']) and organises(topic, actor)):
            raise Refusal('FORBIDDEN', 'Only the assessor or authorized request operator may abandon it')
        if set(envelope['args']) != {'reason'}:
            raise Refusal('INVALID_ARGUMENT', 'Record the reason for abandonment')
        reason = text(envelope['args']['reason'], 'reason')
        if record['state'] == 'reported':
            raise Refusal('ASSESSMENT_ALREADY_REPORTED', 'A published assessment cannot be abandoned')
        if record['state'] == 'abandoned':
            if record['abandonment']['reason'] != reason:
                raise Refusal('ASSESSMENT_ABANDONMENT_MISMATCH', 'The abandonment reason is already recorded')
            return {'assessment_id':record['id'], 'abandonment':record['abandonment']}, []
        record.update(state='abandoned', abandonment=dict(reason=reason, by=actor, recorded_ms=_now_ms()))
        self._save_assessment(db, record)
        return {'assessment_id':record['id'], 'abandonment':record['abandonment']}, []

    def _command_assessment_renew(self, db, actor, envelope):
        record = self._assessment_target(db, actor, envelope)
        args = envelope['args']
        topic = self._topic(db, actor, record['topic_id'])
        if actor != record['operator_id'] or not organises(topic, actor):
            raise Refusal('FORBIDDEN', 'Only the named authorized operator records the renewal decision')
        if record['state'] != 'reported':
            raise Refusal('ASSESSMENT_NOT_REPORTED', 'Read the report before recording a renewal decision')
        if (set(args) != {'decision','reason','next_checkpoint'} or not isinstance(args['decision'], str)
                or args['decision'] not in DECISIONS):
            raise Refusal('INVALID_ARGUMENT', 'Name a renewal decision, reason and next artifact checkpoint')
        decision = dict(decision=args['decision'], reason=text(args['reason'],'reason'),
                        next_checkpoint=text(args['next_checkpoint'],'next_checkpoint'))
        if record['renewal']:
            if any(record['renewal'][k] != v for k,v in decision.items()):
                raise Refusal('ASSESSMENT_RENEWAL_MISMATCH', 'This assessment already has a different recorded renewal decision')
            return {'assessment_id':record['id'], 'renewal':record['renewal']}, []
        record['renewal'] = dict(decision, by=actor, recorded_ms=_now_ms())
        self._save_assessment(db, record)
        return {'assessment_id':record['id'], 'renewal':record['renewal']}, []

    def _view_assessment(self, db, actor, args):
        record = self._assessment(db, actor, args.get('assessment_id'))
        # A reader learns finality before spending anything on a request that can no longer finish.
        return {'instance_id':self.instance_id, 'assessment':record,
                'outcome_reached':self._assessment_reached(db, record['workspace_id']) is not None}

    def _view_assessments(self, db, actor, args):
        limit = _page_size(args)
        topic = args.get('topic_id')
        if topic is not None:
            self._topic(db, actor, topic)
        prefix = index_prefix('topic' if topic is not None else 'assessor', topic if topic is not None else actor)
        cursor = args.get('cursor')
        if cursor not in (None, ''):
            _identifier(cursor,'cursor')
        start = prefix + (cursor or '')
        rows = db.execute('SELECT value AS id FROM metadata WHERE key>? AND key<? ORDER BY key LIMIT ?',
                          (start, prefix+'\uffff', limit+1)).fetchall()
        # Each row costs one indexed request read, not a walk through topic history.
        return _bounded_page({'instance_id':self.instance_id}, rows, limit,
                             lambda row:self._assessment(db,actor,row['id']), 'id')

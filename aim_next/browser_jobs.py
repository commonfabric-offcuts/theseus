from __future__ import annotations

"""Release-bound browser work, using the existing command and delivery owners.

The database migration and queue integration are defined in browser_job_schema.
Nothing here launches a process or manufactures a browser result.
"""

import hashlib
import json
import uuid

from .contract import Refusal, _bounded_page, _identifier, _json, _page_size, _revision
from .delivery import _now_ms


CATALOG = 'browser_catalog.v1:'
TERMINAL = frozenset(('passed', 'failed', 'unrun'))
MAX_CHECKS = 100


def _text(value, field, limit=1024):
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-8')) > limit:
        raise Refusal('INVALID_ARGUMENT', '%s must be nonempty bounded text' % field)
    return value


def _identity(release, workspace, check):
    exact = _json([release['release'], release['commit'], workspace, check])
    return 'bj-' + hashlib.sha256(exact.encode('utf-8')).hexdigest()


def _catalog(db, workspace):
    row = db.execute('SELECT substr(CAST(value AS BLOB),1,65537) FROM metadata WHERE key=?', (CATALOG + workspace,)).fetchone()
    if row is None:
        return dict(v=1, revision=0, checks=[], source_message_id=None)
    try:
        raw = row[0].decode('utf-8')
        value = json.loads(raw)
        if (type(value) is not dict or value.get('v') != 1 or
                type(value.get('revision')) is not int or type(value.get('checks')) is not list or
                len(value['checks']) > MAX_CHECKS or len(row[0]) > 65536 or value['revision'] < 0 or
                any(type(entry) is not dict or set(entry) !=
                    {'check_id', 'name', 'owner_id', 'topic_id', 'repository', 'ref', 'items'} for entry in value['checks'])):
            raise ValueError()
        return value
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise Refusal('BROWSER_CATALOG_INVALID', 'Preserve the malformed browser catalog') from error


def _row(row):
    value = dict(row)
    for name in ('definition', 'original_definition', 'child', 'result'):
        value[name] = json.loads(value[name]) if value[name] else None
    value['unrun'] = value['state'] in ('pending', 'unrun')
    value['browser_verified'] = value['state'] == 'passed'
    if value['state'] == 'pending':
        value['next_action'] = 'assign_mapping' if value['mapping_problem'] else 'claim'
    elif value['state'] in ('running', 'unknown'):
        value['next_action'] = 'reconcile_original_child' if value['child'] else 'reconcile_original_launch_intent'
    else:
        value['next_action'] = 'acknowledge_delivery'
    return value


class BrowserJobs:
    def _browser_catalog_checks(self, db, actor, workspace, checks):
        if type(checks) is not list or len(checks) > MAX_CHECKS:
            raise Refusal('INVALID_ARGUMENT', 'A browser catalog contains at most100 checks')
        out, seen = [], set()
        for entry in checks:
            fields = {'check_id', 'name', 'owner_id', 'topic_id', 'repository', 'ref', 'items'}
            if type(entry) is not dict or set(entry) != fields:
                raise Refusal('INVALID_ARGUMENT', 'Each browser mapping names exactly check, name, owner, topic, repository, ref and items')
            identity = _identifier(entry['check_id'], 'check_id')
            if identity in seen:
                raise Refusal('INVALID_ARGUMENT', 'A browser check appears once in a catalog')
            seen.add(identity)
            topic = self._topic(db, actor, entry['topic_id'])
            if topic['workspace_id'] != workspace:
                raise Refusal('BROWSER_SOURCE_SCOPE', 'A browser check belongs to its own outcome')
            owner = entry['owner_id']
            if owner is not None:
                if self._actor(db, owner)['kind'] != 'agent':
                    raise Refusal('INVALID_ARGUMENT', 'A browser owner is an agent or explicitly unassigned')
                self._topic(db, owner, topic['id'])
            items = entry['items']
            if (type(items) is not list or len(items) > 500 or
                    any(type(n) is not int or not 1 <= n <= 99999 for n in items) or len(set(items)) != len(items)):
                raise Refusal('INVALID_ARGUMENT', 'Browser mapping items are distinct positive pipeline numbers')
            repository, ref = entry['repository'], entry['ref']
            if repository is not None:
                from urllib.parse import urlsplit
                try:
                    parsed = urlsplit(_text(repository, 'repository', 2048))
                except ValueError as error:
                    raise Refusal('INVALID_ARGUMENT', 'Source recovery names a valid HTTPS Git repository') from error
                if (parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or
                        parsed.query or parsed.fragment):
                    raise Refusal('INVALID_ARGUMENT', 'Source recovery names a credential-free HTTPS Git repository')
            if ref is not None:
                _text(ref, 'source ref', 200)
            out.append(dict(entry, name=_text(entry['name'], 'check name', 200), items=list(items)))
        return out

    def _command_browser_catalog_set(self, db, actor, envelope):
        target, args = envelope['target'], envelope['args']
        if set(target) != {'workspace_id'} or set(args) != {'checks', 'source_message_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name the outcome, checks and their source message')
        workspace = self._workspace(db, actor, target['workspace_id'], organise=True)
        source = self._message_access(db, actor, args['source_message_id'])
        topic = self._topic(db, actor, source['topic_id'])
        if topic['workspace_id'] != workspace['id'] or source['private_to']:
            raise Refusal('BROWSER_SOURCE_SCOPE', 'The catalog cites a readable public source in its outcome')
        old = _catalog(db, workspace['id'])
        _revision(envelope['expected'], 'catalog_revision', old['revision'])
        checks = self._browser_catalog_checks(db, actor, workspace['id'], args['checks'])
        value = dict(v=1, revision=old['revision'] + 1, checks=checks,
                     source_message_id=source['id'], by=actor, operation_id=envelope['operation_id'], at_ms=_now_ms())
        if len(_json(value).encode('utf-8')) > 65536:
            raise Refusal('INVALID_ARGUMENT', 'Browser catalog exceeds its byte bound')
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (CATALOG + workspace['id'], _json(value)))
        self._change(db, 'workspace', workspace['id'], 'browser_catalog', workspace['id'], value['revision'])
        return dict(catalog=value), [{'kind': 'browser_catalog', 'id': workspace['id'], 'version': value['revision']}]

    def _browser_required(self, db, workspace, release):
        catalog = _catalog(db, workspace)
        mappings = {entry['check_id']: entry for entry in catalog['checks']
                    if not entry['items'] or set(entry['items']).intersection(release['items'])}
        fields = ('check_id', 'name', 'source', 'revision', 'defined_by', 'defined_ms', 'left_by_topic_id')
        definitions = {check['check_id']: {key: check[key] for key in fields} for check in self._current_checks(db, workspace)
                       if check['source'] == 'release-check:native'}
        for identity, mapping in mappings.items():
            definitions.setdefault(identity, dict(check_id=identity, name=mapping['name'], source='browser-catalog', revision=None))
        if len(definitions) > MAX_CHECKS:
            raise Refusal('BROWSER_CATALOG_INVALID', 'Required browser checks exceed their bound')
        for identity, definition in sorted(definitions.items()):
            mapping = mappings.get(identity)
            yield identity, dict(check=definition, mapping=mapping, catalog_revision=catalog['revision'],
                                 source_message_id=catalog['source_message_id'])

    def _browser_recipient(self, db, workspace, owner, topic):
        for recipient in dict.fromkeys([owner, workspace['coordinator_id']]):
            if recipient is None or topic is None:
                continue
            actor = db.execute('SELECT kind FROM actors WHERE id=?', (recipient,)).fetchone()
            if actor is None or actor['kind'] != 'agent':
                continue
            try:
                self._workspace(db, recipient, workspace['id'])
                self._topic(db, recipient, topic)
            except Refusal:
                continue
            return recipient
        return None

    def _browser_enqueue_release(self, db, release, workspace_id=None):
        """In the release's own transaction. There are no external effects here."""
        parameters = () if workspace_id is None else (workspace_id,)
        scope = '' if workspace_id is None else ' AND w.id=?'
        workspaces = db.execute('SELECT w.* FROM workspaces w JOIN pipelines p ON p.workspace_id=w.id '
                                'WHERE p.enabled=1 AND p.ships_in_releases=1' + scope + ' ORDER BY w.id', parameters).fetchall()
        created = []
        for workspace in workspaces:
            for identity, definition in self._browser_required(db, workspace['id'], release):
                job_id = _identity(release, workspace['id'], identity)
                if db.execute('SELECT 1 FROM browser_jobs WHERE id=?', (job_id,)).fetchone():
                    continue
                mapping = definition['mapping']
                owner = mapping['owner_id'] if mapping else None
                topic = mapping['topic_id'] if mapping else definition['check'].get('left_by_topic_id')
                problem = ('unassigned_owner' if mapping and owner is None else
                           'source_recovery_unknown' if mapping and not mapping['repository'] else
                           None if mapping else 'check_owner_mapping_unknown')
                recipient = self._browser_recipient(db, workspace, owner, topic)
                if owner is not None and recipient != owner:
                    problem = 'owner_access_unavailable'
                now = _now_ms()
                db.execute('INSERT INTO browser_jobs(id,release_number,source_sha,workspace_id,check_id,definition,original_definition,owner_id,'
                           'recipient_id,topic_id,mapping_problem,state,version,created_ms,updated_ms) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?,\'pending\',1,?,?)',
                           (job_id, release['release'], release['commit'], workspace['id'], identity, _json(definition),
                            _json(definition), owner, recipient, topic, problem, now, now))
                if recipient is not None:
                    delivery_id = self._queue_delivery(db, None, recipient, topic, {'browser_job': None}, browser_job_id=job_id)
                    self._change(db, 'actor', recipient, 'delivery', delivery_id, 1)
                self._change(db, 'workspace', workspace['id'], 'browser_job', job_id, 1)
                created.append(job_id)
        return created

    def _browser_job(self, db, actor, identity):
        _identifier(identity, 'browser_job_id')
        row = db.execute('SELECT * FROM browser_jobs WHERE id=?', (identity,)).fetchone()
        if row is None:
            raise Refusal('FORBIDDEN', 'No readable browser job')
        self._workspace(db, actor, row['workspace_id'])
        return _row(row)

    def _view_browser_job(self, db, actor, args):
        return dict(instance_id=self.instance_id, job=self._browser_job(db, actor, args['id']))

    def _view_browser_catalog(self, db, actor, args):
        self._workspace(db, actor, args['workspace_id'])
        return dict(instance_id=self.instance_id, catalog=_catalog(db, args['workspace_id']))

    def _view_browser_jobs(self, db, actor, args):
        self._workspace(db, actor, args['workspace_id'])
        limit = _page_size(args)
        cursor = args.get('cursor', '')
        _identifier(cursor or 'start', 'cursor')
        parameters = [args['workspace_id'], cursor]
        where = 'workspace_id=? AND id>?'
        if 'release' in args:
            if type(args['release']) is not int or args['release'] < 1:
                raise Refusal('INVALID_ARGUMENT', 'A release is a positive integer')
            where += ' AND release_number=?'
            parameters.append(args['release'])
        rows = db.execute('SELECT * FROM browser_jobs WHERE ' + where + ' ORDER BY id LIMIT ?', parameters + [limit + 1]).fetchall()
        return _bounded_page(dict(instance_id=self.instance_id), rows, limit, _row, 'id')

    def _command_browser_jobs_reconcile(self, db, actor, envelope):
        if set(envelope['target']) != {'workspace_id'} or set(envelope['args']) != {'release'}:
            raise Refusal('INVALID_ARGUMENT', 'Name an outcome and one recorded release')
        self._workspace(db, actor, envelope['target']['workspace_id'], organise=True)
        number = envelope['args']['release']
        if type(number) is not int or number < 1:
            raise Refusal('INVALID_ARGUMENT', 'Name a positive release number')
        from .releases import RECORDS, release_item
        row = db.execute(RECORDS + ' WHERE releases.number=?', (number,)).fetchone()
        if row is None:
            raise Refusal('RELEASE_UNKNOWN', 'No such release is recorded')
        created = self._browser_enqueue_release(db, release_item(row), envelope['target']['workspace_id'])
        return dict(created=created), [{'kind': 'browser_job', 'id': identity, 'version': 1} for identity in created]

    def _browser_owned(self, db, actor, envelope):
        if set(envelope['target']) != {'browser_job_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Name exactly one browser job')
        job = self._browser_job(db, actor, envelope['target']['browser_job_id'])
        if job['owner_id'] != actor:
            raise Refusal('FORBIDDEN', 'Only the assigned browser owner may execute this job')
        control = self._hosted_control_read(db, actor)
        if control and (control.get('fault') or control.get('ending') or control.get('desired') == 'stopped'):
            raise Refusal('BROWSER_OWNER_STOPPED', 'The browser owner remains stopped')
        _revision(envelope['expected'], 'job_revision', job['version'])
        return job

    def _command_browser_job_assign(self, db, actor, envelope):
        if set(envelope['target']) != {'browser_job_id'} or envelope['args']:
            raise Refusal('INVALID_ARGUMENT', 'Assign a pending job from its current sourced catalog')
        job = self._browser_job(db, actor, envelope['target']['browser_job_id'])
        workspace = self._workspace(db, actor, job['workspace_id'], organise=True)
        _revision(envelope['expected'], 'job_revision', job['version'])
        if job['state'] != 'pending' or job['attempt_id']:
            raise Refusal('BROWSER_ATTEMPT_EXISTS', 'Preserve an existing attempt and its owner')
        catalog = _catalog(db, job['workspace_id'])
        mapping = next((entry for entry in catalog['checks'] if entry['check_id'] == job['check_id']), None)
        if mapping is None or mapping['owner_id'] is None or not mapping['repository']:
            raise Refusal('BROWSER_MAPPING_REQUIRED', 'The current catalog still lacks an owner/source mapping')
        if job['owner_id'] is not None and job['owner_id'] != mapping['owner_id']:
            raise Refusal('BROWSER_OWNER_BOUND', 'Keep the original assigned owner; an ownership transfer needs its own scoped act')
        definition = dict(job['definition'], mapping=mapping, catalog_revision=catalog['revision'],
                          source_message_id=catalog['source_message_id'])
        recipient = self._browser_recipient(db, workspace, mapping['owner_id'], mapping['topic_id'])
        if recipient != mapping['owner_id']:
            raise Refusal('BROWSER_MAPPING_REQUIRED', 'The configured owner cannot currently read the job destination')
        if recipient != job['recipient_id']:
            for delivery in db.execute('SELECT d.* FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id '
                                       'WHERE d.browser_job_id=? AND d.state=\'pending\' AND g.active=1', (job['id'],)).fetchall():
                self._acknowledge(db, delivery['recipient_id'], delivery)
        db.execute('UPDATE browser_jobs SET definition=?,owner_id=?,recipient_id=?,topic_id=?,mapping_problem=NULL,'
                   'version=version+1,updated_ms=? WHERE id=?',
                   (_json(definition), mapping['owner_id'], recipient, mapping['topic_id'], _now_ms(), job['id']))
        if recipient != job['recipient_id']:
            delivery_id = self._queue_delivery(db, None, recipient, mapping['topic_id'], {'browser_job': None}, browser_job_id=job['id'])
            self._change(db, 'actor', recipient, 'delivery', delivery_id, 1)
        elif mapping['topic_id'] != job['topic_id']:
            db.execute('UPDATE deliveries SET topic_id=? WHERE browser_job_id=? AND recipient_id=?',
                       (mapping['topic_id'], job['id'], recipient))
        return self._browser_changed(db, job)

    def _browser_changed(self, db, job):
        self._change(db, 'workspace', job['workspace_id'], 'browser_job', job['id'], job['version'] + 1)
        current = _row(db.execute('SELECT * FROM browser_jobs WHERE id=?', (job['id'],)).fetchone())
        return dict(job=current), [{'kind': 'browser_job', 'id': job['id'], 'version': current['version']}]

    def _command_browser_job_claim(self, db, actor, envelope):
        job = self._browser_owned(db, actor, envelope)
        if envelope['args']:
            raise Refusal('INVALID_ARGUMENT', 'A claim takes no replacement identity')
        if job['mapping_problem']:
            raise Refusal('BROWSER_MAPPING_REQUIRED', 'Resolve the explicitly missing owner/source mapping first')
        if job['state'] != 'pending':
            raise Refusal('BROWSER_ATTEMPT_EXISTS', 'Reconcile the existing attempt; do not launch another')
        attempt = 'ba-' + uuid.uuid4().hex
        db.execute('UPDATE browser_jobs SET state=\'running\',attempt_id=?,claim_operation=?,version=version+1,updated_ms=? WHERE id=?',
                   (attempt, envelope['operation_id'], _now_ms(), job['id']))
        return self._browser_changed(db, job)

    def _command_browser_job_child(self, db, actor, envelope):
        job, args = self._browser_owned(db, actor, envelope), envelope['args']
        if set(args) != {'attempt_id', 'pid', 'started_at'}:
            raise Refusal('INVALID_ARGUMENT', 'A child names its attempt, PID and process start identity')
        if job['state'] != 'running' or args['attempt_id'] != job['attempt_id'] or job['child'] is not None:
            raise Refusal('BROWSER_ATTEMPT_EXISTS', 'Preserve the original child/attempt identity')
        if type(args['pid']) is not int or args['pid'] < 1:
            raise Refusal('INVALID_ARGUMENT', 'A child PID is a positive integer')
        child = dict(pid=args['pid'], started_at=_text(args['started_at'], 'process start', 200),
                     operation_id=envelope['operation_id'])
        db.execute('UPDATE browser_jobs SET child=?,version=version+1,updated_ms=? WHERE id=?',
                   (_json(child), _now_ms(), job['id']))
        return self._browser_changed(db, job)

    def _command_browser_job_finish(self, db, actor, envelope):
        job, args = self._browser_owned(db, actor, envelope), envelope['args']
        fields = {'attempt_id', 'source_sha', 'outcome', 'evidence', 'child_terminal', 'fix_piece_id'}
        if set(args) != fields or type(args['outcome']) is not str or args['outcome'] not in TERMINAL | {'unknown'}:
            raise Refusal('INVALID_ARGUMENT', 'A result names its original attempt/source, outcome, evidence, child terminal and fix piece')
        if (job['state'] not in ('running', 'unknown') or args['attempt_id'] != job['attempt_id'] or
                args['source_sha'] != job['source_sha']):
            raise Refusal('BROWSER_RESULT_IDENTITY', 'The result must match the original running attempt and exact source')
        evidence = _text(args['evidence'], 'evidence', 4096)
        terminal = args['child_terminal']
        if args['outcome'] != 'unknown':
            if job['child'] is None:
                if args['outcome'] != 'unrun' or terminal != {'not_started': True}:
                    raise Refusal('BROWSER_CHILD_UNCONFIRMED', 'Without a registered child only explicit unrun is known')
            elif (type(terminal) is not dict or set(terminal) != {'pid', 'started_at', 'status', 'cleanup'} or
                  terminal['pid'] != job['child']['pid'] or terminal['started_at'] != job['child']['started_at'] or
                  type(terminal['status']) is not int or terminal['cleanup'] != 'confirmed' or
                  (args['outcome'] == 'passed' and terminal['status'] != 0)):
                raise Refusal('BROWSER_CHILD_UNCONFIRMED', 'Retain the original child identity and confirmed terminal/cleanup evidence')
        fix = args['fix_piece_id']
        if fix is not None:
            piece = db.execute('SELECT workspace_id FROM pipeline_pieces WHERE id=?', (_identifier(fix, 'fix_piece_id'),)).fetchone()
            if piece is None or piece[0] != job['workspace_id'] or args['outcome'] != 'failed':
                raise Refusal('BROWSER_FIX_SCOPE', 'A failed check links to a concrete fix piece in its own outcome')
        result = dict(outcome=args['outcome'], evidence=evidence, child_terminal=terminal,
                      operation_id=envelope['operation_id'], by=actor, at_ms=_now_ms())
        if len(_json(result).encode('utf-8')) > 8192:
            raise Refusal('INVALID_ARGUMENT', 'Browser result exceeds its bound')
        db.execute('UPDATE browser_jobs SET state=?,result=?,fix_piece_id=?,version=version+1,updated_ms=? WHERE id=?',
                   (args['outcome'], _json(result), fix, _now_ms(), job['id']))
        return self._browser_changed(db, job)

    def _browser_delivery_readable(self, db, actor, row):
        try:
            job = self._browser_job(db, actor, row['browser_job_id'])
            return row['recipient_id'] == actor and job['recipient_id'] == actor
        except Refusal:
            return False

    def _command_browser_job_fix(self, db, actor, envelope):
        if set(envelope['target']) != {'browser_job_id'} or set(envelope['args']) != {'fix_piece_id'}:
            raise Refusal('INVALID_ARGUMENT', 'Link a failed browser job to one fix-forward piece')
        job = self._browser_job(db, actor, envelope['target']['browser_job_id'])
        if actor != job['owner_id']:
            self._workspace(db, actor, job['workspace_id'], organise=True)
        _revision(envelope['expected'], 'job_revision', job['version'])
        fix = _identifier(envelope['args']['fix_piece_id'], 'fix_piece_id')
        piece = db.execute('SELECT workspace_id FROM pipeline_pieces WHERE id=?', (fix,)).fetchone()
        if job['state'] != 'failed' or piece is None or piece[0] != job['workspace_id']:
            raise Refusal('BROWSER_FIX_SCOPE', 'A failed check links to a concrete fix piece in its own outcome')
        if job['fix_piece_id'] is not None and job['fix_piece_id'] != fix:
            raise Refusal('BROWSER_FIX_EXISTS', 'Keep the original fix-forward attribution')
        db.execute('UPDATE browser_jobs SET fix_piece_id=?,version=version+1,updated_ms=? WHERE id=?', (fix, _now_ms(), job['id']))
        return self._browser_changed(db, job)

    def _browser_delivery_item(self, db, row):
        if not self._browser_delivery_readable(db, row['recipient_id'], row):
            raise Refusal('FORBIDDEN', 'No readable browser job delivery')
        job = self._browser_job(db, row['recipient_id'], row['browser_job_id'])
        topic = self._topic(db, row['recipient_id'], row['topic_id'])
        return dict(seq=row['seq'], id=row['id'], message_id=None, recipient_id=row['recipient_id'], state=row['state'],
                    reasons=['browser_job'], browser_job=job, source_ref={'kind': 'browser_job', 'id': job['id']},
                    topic={'id': topic['id'], 'title': topic['title'], 'title_truncated': False})

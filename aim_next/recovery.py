from __future__ import annotations

from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from . import recovery_io as io
from .backup import backup, inspect
from .authority import ANCHOR_FIELDS
from .recovery_io import RecoveryError, require


REQUEST_FIELDS = {'authority_path', 'authority_id', 'instance_id', 'expected_epoch', 'activation_id',
                  'mode', 'bundle_path', 'bundle_digest', 'candidate_path'}


def _request(value):
    require(isinstance(value, dict) and set(value) == REQUEST_FIELDS, 'INVALID_REQUEST')
    request = dict(value)
    for key in ('authority_id', 'instance_id', 'expected_epoch'):
        require(io.identifier(request[key]), 'INVALID_REQUEST')
    ident = request['activation_id']
    require(isinstance(ident, str) and str(uuid.UUID(ident)) == ident, 'INVALID_REQUEST')
    require(request['mode'] in ('normal', 'original_unavailable'), 'INVALID_REQUEST')
    require(isinstance(request['bundle_digest'], str) and re.fullmatch('[0-9a-f]{64}', request['bundle_digest']) is not None,
            'INVALID_REQUEST')
    anchor, bundle, candidate = (io.canonical(request[k]) for k in ('authority_path', 'bundle_path', 'candidate_path'))
    # Control is external to every copy root. Candidates get an exclusively
    # created directory; an existing directory is never adopted by another ID.
    roots = (bundle, candidate.parent)
    control = Path(str(anchor)+'.activations')
    require(bundle != candidate.parent and not bundle.is_relative_to(candidate.parent)
            and not candidate.parent.is_relative_to(bundle), 'INVALID_REQUEST')
    for root in roots:
        require(not control.is_relative_to(root) and not root.is_relative_to(control)
                and not anchor.is_relative_to(root), 'INVALID_REQUEST')
    return request


def _epoch(request):
    return 'e-r-' + uuid.UUID(request['activation_id']).hex


def _anchor(path, authority_id, instance_id):
    record, _ = io.read_record(path)
    require(ANCHOR_FIELDS <= set(record) and not (set(record)-ANCHOR_FIELDS-{'activation_id','recovery'}))
    require(type(record['v']) is int and record['v'] == 1 and record['state'] == 'active'
            and record['authority_id'] == authority_id and record['instance_id'] == instance_id
            and io.identifier(record['epoch']))
    io.canonical(record['db_path'])
    require(all(type(record[k]) is int and record[k] >= 0 for k in (
        'db_device','db_inode','lock_device','lock_inode','runner_lock_device','runner_lock_inode')))
    if 'activation_id' in record:
        require(isinstance(record['activation_id'], str) and str(uuid.UUID(record['activation_id'])) == record['activation_id'])
        recovery = record.get('recovery')
        require(isinstance(recovery, dict) and set(recovery) == {
            'kind','history_complete','commit_seq','commit_id','request_digest','root_device','root_inode','original_observation'})
        require(recovery['kind'] in ('normal','original_unavailable') and type(recovery['history_complete']) is bool
                and type(recovery['root_device']) is int and type(recovery['root_inode']) is int
                and isinstance(recovery['request_digest'], str)
                and re.fullmatch('[0-9a-f]{64}', recovery['request_digest']) is not None)
    return record


class RecoveryFence:
    """Current external authority only; never validates/opens an old caller DB."""
    def __init__(self, authority_path, authority_id, instance_id, mode, timings=None):
        require(mode in ('readback','exclusive'), 'INVALID_REQUEST')
        self.path = io.canonical(authority_path)
        self.authority_id, self.instance_id, self.mode = authority_id, instance_id, mode
        self.timings = timings or io.Timings()
        self._fds = []
        self.record = None
        self._held_since = None

    def _verify_lock(self, fd, suffix, prefix, record):
        held = io.check_info(os.fstat(fd))
        named = io.checked(Path(str(self.path)+suffix))
        require(io.identity(held) == io.identity(named)
                and io.identity(held) == [record[prefix+'_device'], record[prefix+'_inode']])

    def verify(self):
        require(len(self._fds) == 2)
        record = _anchor(self.path, self.authority_id, self.instance_id)
        for fd, suffix, prefix in zip(self._fds, ('.lock','.runner.lock'), ('lock','runner_lock')):
            self._verify_lock(fd, suffix, prefix, record)
        self.record = record
        return record

    def __enter__(self):
        require(not self._fds)
        start = time.perf_counter()
        try:
            for index, suffix in enumerate(('.lock','.runner.lock')):
                fd = os.open(str(self.path)+suffix, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
                self._fds.append(fd)
                io.check_info(os.fstat(fd))
                if index == 0 or self.mode == 'exclusive':
                    operation = fcntl.LOCK_SH if self.mode == 'readback' else fcntl.LOCK_EX
                    try:
                        fcntl.flock(fd, operation | fcntl.LOCK_NB)
                    except BlockingIOError as error:
                        raise RecoveryError('AUTHORITY_BUSY', retryable=True) from error
            self.verify()
            self._held_since = time.perf_counter()
            return self
        except BaseException as error:
            self.close()
            if isinstance(error, OSError):
                raise RecoveryError('CONTROL_INVALID') from error
            raise
        finally:
            self.timings.seconds['fence_wait'] += time.perf_counter()-start

    def close(self):
        failure = None
        while self._fds:
            fd = self._fds.pop()
            try:
                # Closing our reference must not unlock an inherited child fd.
                os.close(fd)
            except BaseException as error:
                failure = error
        if self._held_since is not None:
            self.timings.seconds['fence_hold'] += time.perf_counter()-self._held_since
            self._held_since = None
        if failure is not None:
            raise RecoveryError('RECOVERY_UNCONFIRMED') from failure

    def __exit__(self, *unused):
        self.close()


def _fence(request, mode, timings):
    return RecoveryFence(request['authority_path'], request['authority_id'], request['instance_id'], mode, timings)


def _root(request):
    return Path(request['authority_path']+'.activations')


def _write_record(path, record):
    io.write_record(path, record)


def _control(request, record, *, missing=False):
    root = _root(request)
    if not root.exists():
        require(missing and 'activation_id' not in record)
        return None
    root_info = io.checked(root, True)
    header, _ = io.read_record(root/'header.json')
    require(set(header) == {'v','path','authority_id','instance_id','initial_epoch','root_identity',
                            'lock_identity','runner_lock_identity'} and type(header['v']) is int and header['v'] == 1)
    require(io.identity(io.checked(io.canonical(header['path']), True)) == io.identity(root_info)
            and header['authority_id'] == request['authority_id']
            and header['instance_id'] == request['instance_id'] and header['root_identity'] == io.identity(root_info)
            and header['lock_identity'] == [record['lock_device'],record['lock_inode']]
            and header['runner_lock_identity'] == [record['runner_lock_device'],record['runner_lock_inode']])
    if 'activation_id' in record:
        require(io.identity(root_info) == [record['recovery']['root_device'],record['recovery']['root_inode']])
    else:
        require(header['initial_epoch'] == record['epoch'])
    return header


def _bootstrap_control(request, timings):
    root = _root(request)
    stage = None
    with _fence(request, 'readback', timings) as fence:
        header = _control(request, fence.record, missing=True)
        initial = fence.record
    if header is None:
        stage = Path(str(root)+'.preparing-'+uuid.uuid4().hex)
        stage.mkdir(mode=0o700)
        timings.orphan_paths.append(str(stage))
        header = dict(v=1, path=str(root), authority_id=request['authority_id'], instance_id=request['instance_id'],
                      initial_epoch=initial['epoch'], root_identity=io.identity(io.checked(stage, True)),
                      lock_identity=[initial['lock_device'], initial['lock_inode']],
                      runner_lock_identity=[initial['runner_lock_device'], initial['runner_lock_inode']])
        try:
            _write_record(stage/'header.json', header)
            io.flush_path(stage, True)
            io.flush_path(stage.parent, True)
        except BaseException as error:
            raise RecoveryError('RECOVERY_UNCONFIRMED', evidence={'orphan_path': str(stage)}) from error
    with _fence(request, 'exclusive', timings) as fence:
        if root.exists():
            _control(request, fence.record)
        else:
            require(stage is not None and 'activation_id' not in fence.record and fence.record == initial)
            require(io.identity(io.checked(stage, True)) == header['root_identity'])
            actual, _ = io.read_record(stage/'header.json')
            require(actual == header and not root.exists())
            os.rename(str(stage), str(root))
        io.flush_path(root.parent, True)
        _control(request, fence.verify())


class Claim:
    def __init__(self, request):
        self.request = request
        self.path = _root(request)/request['activation_id']
        self.fd = None
        self.fresh = False
        self.record = None

    def open(self, create=False):
        if create:
            try:
                self.path.mkdir(mode=0o700)
                self.fresh = True
            except FileExistsError:
                pass
        if not self.path.exists():
            return self
        info = io.checked(self.path, True)
        marker = self.path/'request.complete.json'
        if not self.fresh and not marker.exists():
            raise RecoveryError('PREPARATION_INCOMPLETE')
        if self.fresh:
            io.flush_path(self.path.parent, True)
            flags = os.O_CREAT | os.O_EXCL
        else:
            flags = 0
        try:
            self.fd = os.open(str(self.path/'lock'), os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | flags, 0o600)
        except OSError as error:
            raise RecoveryError('CONTROL_INVALID') from error
        io.check_info(os.fstat(self.fd))
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RecoveryError('CLAIM_BUSY', retryable=True) from error
        if self.fresh:
            io.full_flush(self.fd)
            io.flush_path(self.path, True)
            self.record = dict(v=1, request=self.request, directory_identity=io.identity(info),
                               lock_identity=io.identity(os.fstat(self.fd)))
            temporary = self.path/('request.'+uuid.uuid4().hex+'.tmp')
            _write_record(temporary, self.record)
            os.replace(str(temporary), str(marker))
            io.flush_path(self.path, True)
        else:
            self.record, _ = io.read_record(marker)
        self.verify()
        return self

    def verify(self):
        require(self.fd is not None and isinstance(self.record, dict))
        require(set(self.record) == {'v','request','directory_identity','lock_identity'} and type(self.record['v']) is int
                and self.record['v'] == 1)
        require(self.record['request'] == self.request, 'REQUEST_MISMATCH')
        require(self.record['directory_identity'] == io.identity(io.checked(self.path, True)))
        require(self.record['lock_identity'] == io.identity(io.check_info(os.fstat(self.fd)))
                and self.record['lock_identity'] == io.identity(io.checked(self.path/'lock')))
        current, _ = io.read_record(self.path/'request.complete.json')
        require(current == self.record)

    def flush(self):
        self.verify()
        for path in (self.path/'request.complete.json', self.path/'lock'):
            io.flush_path(path)
        io.flush_path(self.path, True)
        io.flush_path(self.path.parent/'header.json')
        io.flush_path(self.path.parent, True)
        io.flush_path(self.path.parent.parent, True)

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)


@contextmanager
def _claim(request, create=False):
    claim = Claim(request)
    try:
        yield claim.open(create)
    finally:
        claim.close()


def _metadata_matches(metadata, request, epoch):
    return all(metadata[k] == value for k, value in (
        ('instance_id',request['instance_id']), ('authority_id',request['authority_id']),
        ('authority_path',request['authority_path']), ('authority_epoch',epoch)))


def _candidate_fixed(request, record=None, staged=None):
    path = io.canonical(request['candidate_path'])
    directory, media = path.parent, Path(str(path)+'.media')
    directory_info = io.checked(directory, True, 'CANDIDATE_INVALID')
    media_info = io.checked(media, True, 'CANDIDATE_INVALID')
    before = io.checked(path, code='CANDIDATE_INVALID')
    if record is not None:
        require(io.identity(before) == [record['db_device'],record['db_inode']], 'CANDIDATE_INVALID')
    if staged is not None:
        require(io.facts(before) == staged['database_stat'] and io.identity(directory_info) == staged['directory_identity']
                and io.identity(media_info) == staged['media_identity'], 'CANDIDATE_INVALID')
    metadata = io.read_metadata(path, policy='live' if record is not None else 'immutable')
    require(_metadata_matches(metadata, request, _epoch(request)), 'CANDIDATE_INVALID')
    after = io.checked(path, code='CANDIDATE_INVALID')
    require(io.identity(after) == io.identity(before), 'CANDIDATE_INVALID')
    if record is None:
        require(io.facts(after) == io.facts(before), 'CANDIDATE_INVALID')
    require(io.identity(io.checked(directory, True, 'CANDIDATE_INVALID')) == io.identity(directory_info)
            and io.identity(io.checked(media, True, 'CANDIDATE_INVALID')) == io.identity(media_info), 'CANDIDATE_INVALID')
    if staged is not None:
        require(metadata == staged['metadata'], 'CANDIDATE_INVALID')
    return metadata


def _published(request, record):
    return (record.get('activation_id') == request['activation_id'] and record['epoch'] == _epoch(request)
            and record['db_path'] == request['candidate_path']
            and record.get('recovery', {}).get('request_digest') == io.digest_record(request))


def _result(request, record, confirmed, timings):
    binding = dict(instance_id=request['instance_id'], authority_path=request['authority_path'],
                   authority_id=request['authority_id'], authority_epoch=record['epoch'], db_path=record['db_path'])
    return dict(status='published' if confirmed else 'published_observed', durability_confirmed=confirmed,
                history_complete=record['recovery']['history_complete'], timings_seconds=dict(timings.seconds),
                evidence={'orphan_paths': [p for p in timings.orphan_paths if Path(p).exists()]},
                **({'binding': binding} if confirmed else {'observed_binding': binding}))


def _state(request, claim, fence, timings, confirm=False):
    record = fence.record
    _control(request, record, missing=True)
    if claim.record is not None:
        claim.verify()
    if _published(request, record):
        require(claim.record is not None)
        _candidate_fixed(request, record=record)
        if confirm:
            # Published retry comes before EX bootstrap and stale-epoch tests.
            with timings.phase('full_flush'):
                with io.opened(Path(request['authority_path'])) as fd:
                    held = io.identity(os.fstat(fd))
                    io.full_flush(fd)
                    io.flush_path(Path(request['authority_path']).parent, True)
                    require(fence.verify() == record and io.identity(io.checked(request['authority_path'])) == held)
                _candidate_fixed(request, record=record)
        return _result(request, record, confirm, timings)
    if record['epoch'] != request['expected_epoch']:
        return dict(status='stale', durability_confirmed=False)
    if claim.record is None:
        return dict(status='not_started', durability_confirmed=False)
    if not (claim.path/'staged.json').exists():
        return dict(status='preparation_incomplete', durability_confirmed=False)
    staged = _read_stage(request, claim)
    _candidate_fixed(request, staged=staged)
    return dict(status='prepared', durability_confirmed=False)


def _read_stage(request, claim):
    staged, _ = io.read_record(claim.path/'staged.json')
    require(set(staged) == {'v','request_digest','database_stat','database','metadata','directory_identity','media_identity'}
            and type(staged['v']) is int and staged['v'] == 1
            and staged['request_digest'] == io.digest_record(request), 'CANDIDATE_INVALID')
    return staged


def _stage_epoch(path, request, manifest):
    with io.connection(path, write=True) as db:
        db.execute('BEGIN IMMEDIATE')
        before = io.metadata(db)
        require(before == manifest['metadata'] and _metadata_matches(before, request, request['expected_epoch']), 'BUNDLE_INVALID')
        # The complete whitelist: no records, commit identity or authority path change.
        changed = db.execute("UPDATE metadata SET value=? WHERE key='authority_epoch'", (_epoch(request),)).rowcount
        require(changed == 1, 'CANDIDATE_INVALID')
        db.commit()


def _inspect_request(request, timings):
    with timings.phase('verification'):
        manifest = inspect(request['bundle_path'], expected_digest=request['bundle_digest'])
        require(_metadata_matches(manifest['metadata'], request, request['expected_epoch']), 'BUNDLE_INVALID')
        return manifest


def _prepare(request, claim, timings, manifest):
    bundle = Path(request['bundle_path'])
    candidate = Path(request['candidate_path'])
    io.checked(candidate.parent.parent, True, 'INVALID_REQUEST')
    try:
        candidate.parent.mkdir(mode=0o700)
    except FileExistsError as error:
        raise RecoveryError('CANDIDATE_OCCUPIED') from error
    io.checked(candidate.parent, True, 'CANDIDATE_INVALID')
    media = Path(str(candidate)+'.media')
    media.mkdir(mode=0o700)
    with timings.phase('copy'):
        io.copy_file(bundle/'data.sqlite3', candidate, manifest['database'])
        for row in manifest['media']:
            io.copy_file(bundle/'media'/row['name'], media/row['name'], {k: row[k] for k in ('size','sha256')})
    with timings.phase('verification'):
        io.hash_file(candidate, expected=manifest['database'])
    with timings.phase('full_flush'):
        # Diagnostic receipt for the exact unstaged copy. It never authorizes a
        # partial retry; only staged.json can do that after epoch verification.
        copied = dict(v=1, request_digest=io.digest_record(request), database=manifest['database'],
                      database_stat=io.facts(io.checked(candidate)),
                      directory_identity=io.identity(io.checked(candidate.parent, True)),
                      media_identity=io.identity(io.checked(media, True)))
        _write_record(claim.path/'copied.json', copied)
        io.flush_path(claim.path, True)
    with timings.phase('staging'):
        _stage_epoch(candidate, request, manifest)
    with timings.phase('verification'):
        database = io.hash_file(candidate)
        metadata = io.read_metadata(candidate)
        for row in manifest['media']:
            io.hash_file(media/row['name'], expected={k: row[k] for k in ('size','sha256')})
    with timings.phase('full_flush'):
        io.flush_path(candidate)
        for row in manifest['media']:
            io.flush_path(media/row['name'])
        for directory in (media, candidate.parent, candidate.parent.parent):
            io.flush_path(directory, True)
        claim.flush()
        receipt = dict(v=1, request_digest=io.digest_record(request), database=database, metadata=metadata,
                       database_stat=io.facts(io.checked(candidate)), directory_identity=io.identity(io.checked(candidate.parent,True)),
                       media_identity=io.identity(io.checked(media,True)))
        temporary = claim.path/('staged.'+uuid.uuid4().hex+'.tmp')
        _write_record(temporary, receipt)
        os.replace(str(temporary), str(claim.path/'staged.json'))
        io.flush_path(claim.path, True)
    return receipt


def _verify_staged(request, claim, timings):
    staged = _read_stage(request, claim)
    with timings.phase('verification'):
        manifest = inspect(request['bundle_path'], expected_digest=request['bundle_digest'])
        require(_metadata_matches(manifest['metadata'], request, request['expected_epoch']), 'BUNDLE_INVALID')
        metadata = _candidate_fixed(request, staged=staged)
        expected_metadata = dict(manifest['metadata'], authority_epoch=_epoch(request))
        require(metadata == expected_metadata, 'CANDIDATE_INVALID')
        io.hash_file(Path(request['candidate_path']), expected=staged['database'])
        media = Path(request['candidate_path']+'.media')
        for row in manifest['media']:
            io.hash_file(media/row['name'], expected={k: row[k] for k in ('size','sha256')})
    with timings.phase('full_flush'):
        io.flush_path(request['candidate_path'])
        for row in manifest['media']:
            io.flush_path(media/row['name'])
        for path in (media, Path(request['candidate_path']).parent, Path(request['candidate_path']).parent.parent):
            io.flush_path(path, True)
        claim.flush()
        io.flush_path(claim.path/'staged.json')
        io.flush_path(claim.path, True)
    return staged


def _original(request, record, staged):
    """One fixed read-only observation; busy/interruption never means missing."""
    try:
        path = Path(record['db_path'])
        before = io.original_checked(path)
        require(io.identity(before) == [record['db_device'], record['db_inode']], 'ORIGINAL_UNAVAILABLE')
        metadata = io.read_metadata(path, 'ORIGINAL_UNAVAILABLE', require_delete=False, policy='original')
        require(_metadata_matches(metadata, request, record['epoch']), 'ORIGINAL_UNAVAILABLE')
        require(io.identity(io.original_checked(path)) == io.identity(before), 'ORIGINAL_UNAVAILABLE')
    except (RecoveryError, OSError, sqlite3.Error) as error:
        if io.busy(error):
            raise RecoveryError('DATABASE_BUSY', retryable=True) from error
        known_unavailable = (isinstance(error, RecoveryError) and error.code == 'ORIGINAL_UNAVAILABLE'
                             or type(error) is sqlite3.DatabaseError and error.__cause__ is None
                             and str(error) in ('file is not a database', 'database disk image is malformed'))
        if not known_unavailable:
            raise RecoveryError('RECOVERY_UNCONFIRMED') from error
        # Only positively observed absence/identity/corruption/lineage warrants a gap.
        if request['mode'] == 'normal':
            raise RecoveryError('ORIGINAL_UNAVAILABLE') from error
        return False, 'missing_changed_or_unreadable'
    if request['mode'] == 'original_unavailable':
        raise RecoveryError('ORIGINAL_AVAILABLE')
    require(metadata['commit_seq'] == staged['metadata']['commit_seq']
            and metadata['commit_id'] == staged['metadata']['commit_id'], 'HISTORY_MISMATCH')
    recovery = record.get('recovery')
    complete = isinstance(recovery, dict) and recovery.get('history_complete') is True
    return complete, 'matching_commit_identity'


def _publish_anchor(request, fence, record):
    path = Path(request['authority_path'])
    temporary = path.parent/('.'+path.name+'.activation-'+uuid.uuid4().hex)
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    attempted = False
    try:
        with os.fdopen(fd, 'wb') as stream:
            io.check_info(os.fstat(stream.fileno()))
            raw = io.encode(record)
            require(len(raw) <= 65536)
            stream.write(raw)
            stream.flush()
            io.full_flush(stream.fileno())
            attempted = True
            os.replace(str(temporary), str(path))
            io.flush_path(path.parent, True)
            require(io.identity(io.checked(path)) == io.identity(os.fstat(stream.fileno())))
            require(fence.verify() == record)
    except BaseException as error:
        if attempted:
            raise RecoveryError('RECOVERY_UNCONFIRMED') from error
        raise


def _activate(request, timings):
    # Matching published retries must complete using SH even with a live runner.
    with _claim(request) as claim:
        with _fence(request, 'readback', timings) as fence:
            state = _state(request, claim, fence, timings, confirm=True)
        if state['status'] == 'published':
            return state
        require(state['status'] != 'stale', 'STALE')
        if claim.record is not None:
            require(state['status'] == 'prepared', 'PREPARATION_INCOMPLETE')
            return _cutover(request, claim, timings)
    # A verified bundle pins the authority spelling before permanent control
    # creation. Published retries above never need the original or bundle.
    manifest = _inspect_request(request, timings)
    _bootstrap_control(request, timings)
    with _claim(request, create=True) as claim:
        with _fence(request, 'readback', timings) as fence:
            state = _state(request, claim, fence, timings, confirm=True)
        if state['status'] == 'published':
            return state
        require(state['status'] != 'stale', 'STALE')
        if claim.fresh:
            _prepare(request, claim, timings, manifest)
        else:
            require(state['status'] == 'prepared', 'PREPARATION_INCOMPLETE')
        return _cutover(request, claim, timings)


def _cutover(request, claim, timings):
    # Re-verification is outside global fences, under the same per-ID ownership.
    staged = _verify_staged(request, claim, timings)
    with _fence(request, 'exclusive', timings) as fence:
        state = _state(request, claim, fence, timings)
        require(state['status'] != 'stale', 'STALE')
        require(state['status'] == 'prepared', 'RECOVERY_UNCONFIRMED')
        complete, observation = _original(request, fence.record, staged)
        _candidate_fixed(request, staged=staged)
        claim.verify()
        previous = dict(fence.record)
        require(fence.verify() == previous)
        root = io.checked(_root(request), True)
        record = dict(previous, epoch=_epoch(request), db_path=request['candidate_path'],
                      db_device=staged['database_stat']['device'], db_inode=staged['database_stat']['inode'],
                      activation_id=request['activation_id'], recovery=dict(kind=request['mode'], history_complete=complete,
                      commit_seq=staged['metadata']['commit_seq'], commit_id=staged['metadata']['commit_id'],
                      request_digest=io.digest_record(request), root_device=root.st_dev, root_inode=root.st_ino,
                      original_observation=observation))
        with timings.phase('publication'):
            _publish_anchor(request, fence, record)
        return _result(request, record, True, timings)


def activate(request):
    """Publish a verified copy; never saves a profile, provisions routes or starts effects."""
    timings = io.Timings()
    try:
        request = _request(request)
    except (ValueError, TypeError, UnicodeError, RuntimeError, OSError) as error:
        raise RecoveryError('INVALID_REQUEST') from error
    try:
        with timings.scope():
            result = _activate(request, timings)
        result['timings_seconds'] = dict(timings.seconds)
        return result
    except RecoveryError as error:
        error.evidence.update(timings_seconds=timings.seconds, candidate_path=request['candidate_path'], control_path=str(_root(request)),
                              orphan_paths=[p for p in timings.orphan_paths if Path(p).exists()])
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        code = 'DATABASE_BUSY' if io.busy(error) else 'RECOVERY_UNCONFIRMED'
        raise RecoveryError(code, retryable=code == 'DATABASE_BUSY', evidence=dict(
            timings_seconds=timings.seconds, candidate_path=request['candidate_path'], control_path=str(_root(request)),
            orphan_paths=[p for p in timings.orphan_paths if Path(p).exists()])) from error


def activation_readback(request):
    """Read-only direct claim lookup. Observation never authorizes profile activation."""
    timings = io.Timings()
    try:
        request = _request(request)
        with _claim(request) as claim:
            with _fence(request, 'readback', timings) as fence:
                return _state(request, claim, fence, timings)
    except RecoveryError as error:
        status = {'REQUEST_MISMATCH':'request_mismatch', 'PREPARATION_INCOMPLETE':'preparation_incomplete',
                  'CLAIM_BUSY':'busy', 'AUTHORITY_BUSY':'busy'}.get(error.code, 'unconfirmed')
        return dict(status=status, durability_confirmed=False, error=error.code, timings_seconds=timings.seconds)
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        return dict(status='unconfirmed', durability_confirmed=False, error='RECOVERY_UNCONFIRMED', timings_seconds=timings.seconds)

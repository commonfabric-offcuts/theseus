from __future__ import annotations

"""Inactive same-owner staging only. No authority anchor is ever written (1325)."""

from contextlib import contextmanager, ExitStack
import fcntl
from itertools import islice
import os
from pathlib import Path
import re
import sqlite3
import uuid

from . import backup, recovery_io as io, relocation, relocation_publication as publication
from .recovery_io import RecoveryError, require

RECORD_LIMIT = backup.MANIFEST_LIMIT + 65536
WHITELIST = ['authority_epoch', 'authority_path']


def _paths(request):
    prep = request['intent_request']['preparation']
    db, anchor = (Path(prep['destination'][k]) for k in ('db_path', 'authority_path'))
    return db, anchor, Path(str(db)+'.media')


def _request(value):
    try:
        require(type(value) is dict and set(value) == {'v', 'intent_request', 'intent_digest', 'journal_root'}
                and type(value['v']) is int and value['v'] == 1, 'INVALID_REQUEST')
        intent_request, intent_root = publication._request(value['intent_request'])
        prep = intent_request['preparation']
        require(prep['owners']['destination_uid'] == os.getuid(), 'OWNERSHIP_HANDOFF_REQUIRED')
        require(type(value['intent_digest']) is str
                and relocation.HEX64.fullmatch(value['intent_digest']) is not None, 'INVALID_REQUEST')
        parent = io.canonical(value['journal_root'])
        request = dict(v=1, intent_request=intent_request, intent_digest=value['intent_digest'], journal_root=str(parent))
        db, anchor, media = _paths(request)
        targets = [db, anchor, media, Path(str(anchor)+'.lock'), Path(str(anchor)+'.runner.lock')]
        require(all(not a.is_relative_to(b) for a in targets for b in targets if a != b)
                and len(set(targets)) == 5, 'INVALID_REQUEST')
        protected = [Path(prep['bundle_path']), Path(prep['staging_root']), intent_root.parent,
                     Path(prep['source']['db_path']).parent, Path(prep['source']['authority_path']).parent]
        for destination in {db.parent, anchor.parent}:
            for other in protected + [parent]:
                require(not destination.is_relative_to(other) and not other.is_relative_to(destination), 'INVALID_REQUEST')
        for other in protected:
            require(not parent.is_relative_to(other) and not other.is_relative_to(parent), 'INVALID_REQUEST')
        require(len(io.encode(request)) <= 49152, 'INVALID_REQUEST')
        return request, parent/prep['move_id']
    except (TypeError, ValueError, UnicodeError, RuntimeError, OSError, RecursionError) as error:
        raise RecoveryError('INVALID_REQUEST') from error


def _absent(anchor):
    require(not os.path.lexists(str(anchor)), 'STAGE_DESTINATION_CHANGED')


def _inputs(request):
    result = publication.inspect_publication_intent(request['intent_request'])
    require(result['status'] == 'intent_observed' and io.digest_record(result['intent']) == request['intent_digest'],
            'STAGE_INTENT_MISMATCH')
    prep = request['intent_request']['preparation']
    candidate = publication._candidate(prep)
    require(candidate == result['intent']['candidate'], 'STAGE_INTENT_MISMATCH')
    _, stage = relocation._request(prep)
    with relocation._locked(stage) as (_, fd):
        manifest = relocation._completion(prep, stage, fd)
        require(manifest is not None, 'STAGE_INCOMPLETE')
    return result['intent'], manifest


def _target_pairs(db, fds):
    return dict(database=io.identity(io.checked(db)), authority_lock=io.identity(os.fstat(fds[0])),
                runner_lock=io.identity(os.fstat(fds[1])))


@contextmanager
def _target(request, fresh=False, confirm=False):
    db, anchor, media = _paths(request)
    locks = [Path(str(anchor)+suffix) for suffix in ('.lock', '.runner.lock')]
    parents = sorted({db.parent, anchor.parent}, key=str)
    fds = []
    with ExitStack() as stack:
        _absent(anchor)
        if fresh:
            require(not any(os.path.lexists(str(p)) for p in [db, media]+locks), 'STAGE_TARGET_OCCUPIED')
        for parent in parents:
            if fresh and not os.path.lexists(str(parent)):
                io.checked(parent.parent, True, 'INVALID_REQUEST')
                parent.mkdir(mode=0o700)
            stack.enter_context(io.opened(parent, True))
        try:
            for index, path in enumerate(locks):
                flags = (os.O_RDWR if confirm else os.O_RDONLY) | os.O_NOFOLLOW | os.O_NONBLOCK
                if fresh:
                    flags |= os.O_CREAT | os.O_EXCL
                fd = os.open(str(path), flags, 0o600); fds.append(fd)
                io.check_info(os.fstat(fd))
                if confirm or index == 0:
                    try:
                        fcntl.flock(fd, (fcntl.LOCK_EX if confirm else fcntl.LOCK_SH) | fcntl.LOCK_NB)
                    except BlockingIOError as error:
                        raise RecoveryError('STAGE_BUSY', retryable=True) from error
            def verify():
                for path, fd in zip(locks, fds):
                    require(io.identity(io.check_info(os.fstat(fd))) == io.identity(io.checked(path)), 'STAGE_INVALID')
                _absent(anchor)
            verify()
            if fresh:
                for fd in fds:
                    io.full_flush(fd)
                for parent in parents:
                    io.flush_path(parent, True); io.flush_path(parent.parent, True)
            yield fds
            verify()
        finally:
            failure = None
            for fd in reversed(fds):
                try:
                    os.close(fd)
                except BaseException as error:
                    failure = error
            if failure is not None:
                raise RecoveryError('STAGE_UNCONFIRMED') from failure


def _claim(request, root, fd):
    if not os.path.lexists(str(root/'claim.json')):
        require(not os.path.lexists(str(root/'staged.json')), 'STAGE_INVALID')
        return None
    claim, digest = io.read_record(root/'claim.json')
    require(set(claim) == {'v', 'request', 'epoch', 'intent', 'root_identity', 'lock_identity'}
            and type(claim['v']) is int and claim['v'] == 1, 'STAGE_INVALID')
    require(claim['request'] == request, 'STAGE_REQUEST_MISMATCH')
    require(digest == io.digest_record(claim)
            and claim['root_identity'] == io.identity(io.checked(root, True))
            and claim['lock_identity'] == io.identity(os.fstat(fd))
            and type(claim['epoch']) is str and re.fullmatch('e-s-[0-9a-f]{32}', claim['epoch']) is not None
            and claim['epoch'] != request['intent_request']['preparation']['source']['authority_epoch']
            and io.digest_record(claim['intent']) == request['intent_digest'], 'STAGE_INVALID')
    return claim


def _metadata(claim):
    prep = claim['request']['intent_request']['preparation']
    return dict(claim['intent']['candidate']['metadata'], authority_path=prep['destination']['authority_path'],
                authority_epoch=claim['epoch'])


def _payload(claim, fds):
    request = claim['request']; db, anchor, media = _paths(request)
    _absent(anchor)
    with io.connection(db) as connection:
        connection.execute('BEGIN')
        metadata = io.metadata(connection)
        rows = backup.media_rows(connection)
    require(metadata == _metadata(claim), 'STAGE_INVALID')
    io.checked(media, True)
    require({p.name for p in islice(media.iterdir(), len(rows)+1)} == {r['name'] for r in rows}, 'STAGE_INVALID')
    for row in rows:
        io.hash_file(media/row['name'], expected={k: row[k] for k in ('size', 'sha256')})
    return dict(v=1, request_digest=io.digest_record(request), claim_digest=io.digest_record(claim),
                epoch=claim['epoch'], whitelist=WHITELIST, metadata=metadata,
                source_metadata=claim['intent']['candidate']['metadata'], database=io.hash_file(db), media=rows,
                identities=_target_pairs(db, fds), media_identity=io.identity(io.checked(media, True)),
                parents={str(p): io.identity(io.checked(p, True)) for p in {db.parent, anchor.parent}})


def _completion(claim, root, fds):
    saved, digest = io.read_record(root/'staged.json', RECORD_LIMIT)
    require(saved == _payload(claim, fds) and digest == io.digest_record(saved), 'STAGE_INVALID')
    require({p.name for p in islice(root.iterdir(), 4)} == {'intent.lock', 'claim.json', 'staged.json'}, 'STAGE_INVALID')
    return saved


def _copy(claim, manifest):
    prep = claim['request']['intent_request']['preparation']
    stage = Path(prep['staging_root'])/prep['move_id']
    db, _, media = _paths(claim['request'])
    # Keep source payload ownership/identity and its full verification stable.
    with relocation._locked(stage) as (_, fd):
        require(relocation._completion(prep, stage, fd) == manifest, 'STAGE_INTENT_MISMATCH')
        io.copy_file(stage/'data.sqlite3', db, manifest['database'])
        media.mkdir(mode=0o700)
        for row in manifest['media']:
            io.copy_file(stage/'media'/row['name'], media/row['name'], {k: row[k] for k in ('size', 'sha256')})
        require(relocation._completion(prep, stage, fd) == manifest, 'STAGE_INTENT_MISMATCH')
    with io.connection(db, write=True) as connection:
        connection.execute('BEGIN IMMEDIATE')
        require(io.metadata(connection) == manifest['metadata'], 'STAGE_INVALID')
        for key in WHITELIST:
            require(connection.execute('UPDATE metadata SET value=? WHERE key=?', (_metadata(claim)[key], key)).rowcount == 1,
                    'STAGE_INVALID')
        connection.commit()


def _flush_payload(claim, record):
    db, anchor, media = _paths(claim['request']); _absent(anchor)
    for path in [db, Path(str(anchor)+'.lock'), Path(str(anchor)+'.runner.lock')]:
        io.flush_path(path)
    for row in record['media']:
        io.flush_path(media/row['name'])
    for parent in {media, db.parent, anchor.parent, db.parent.parent, anchor.parent.parent}:
        io.flush_path(parent, True)


def _flush(claim, root, record):
    db, anchor, media = _paths(claim['request']); _absent(anchor)
    for path in [root/'intent.lock', root/'claim.json', root/'staged.json', db,
                 Path(str(anchor)+'.lock'), Path(str(anchor)+'.runner.lock')]:
        io.flush_path(path)
    for row in record['media']:
        io.flush_path(media/row['name'])
    for parent in {media, db.parent, anchor.parent, root, root.parent}:
        io.flush_path(parent, True)
    for parent in {db.parent.parent, anchor.parent.parent}:
        io.flush_path(parent, True)
    _absent(anchor)


def _result(request, root, status, record=None, confirmed=False):
    return dict(status=status, inactive=True, durability_confirmed=confirmed,
                move_id=request['intent_request']['preparation']['move_id'], journal_path=str(root),
                request_digest=io.digest_record(request), stage=record)


def _run(value, create):
    request, root = _request(value)
    try:
        io.checked(root.parent, True, 'INVALID_REQUEST')
        _absent(_paths(request)[1])
        inputs = None
        if not os.path.lexists(str(root)):
            if not create:
                return _result(request, root, 'not_started')
            inputs = _inputs(request)
        with publication._locked(root, create) as (fresh, fd):
            if fresh:
                require(inputs is not None, 'STAGE_INCOMPLETE')
                epoch = 'e-s-'+uuid.uuid4().hex
                require(epoch != request['intent_request']['preparation']['source']['authority_epoch'], 'STAGE_INVALID')
                intent, manifest = inputs
                claim = dict(v=1, request=request, epoch=epoch, intent=intent,
                             root_identity=io.identity(io.checked(root, True)), lock_identity=io.identity(os.fstat(fd)))
                io.write_record(root/'claim.json', claim); io.flush_path(root, True)
            claim = _claim(request, root, fd)
            complete = os.path.lexists(str(root/'staged.json'))
            if not fresh and not complete:
                _absent(_paths(request)[1])
                require(not create, 'STAGE_INCOMPLETE')
                anchor = _paths(request)[1]
                if all(os.path.lexists(str(anchor)+suffix) for suffix in ('.lock', '.runner.lock')):
                    with _target(request):
                        _absent(anchor)
                return _result(request, root, 'stage_incomplete')
            require(claim is not None, 'STAGE_INVALID')
            with _target(request, fresh, create) as fds:
                if fresh:
                    _copy(claim, manifest)
                    record = _payload(claim, fds)
                    require(record['media'] == manifest['media'], 'STAGE_INVALID')
                    _flush_payload(claim, record)
                    io.write_record(root/'staged.json', record, RECORD_LIMIT)
                record = _completion(claim, root, fds)
                if create:
                    _flush(claim, root, record)
                    require(_completion(claim, root, fds) == record, 'STAGE_INVALID')
        return _result(request, root, 'staged' if create else 'staged_observed', record, create)
    except RecoveryError as error:
        error.evidence.update(journal_path=str(root), move_id=request['intent_request']['preparation']['move_id'])
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, KeyError, TypeError, UnicodeError) as error:
        code = 'STAGE_BUSY' if io.busy(error) else 'STAGE_UNCONFIRMED'
        raise RecoveryError(code, retryable=code == 'STAGE_BUSY', evidence=dict(
            journal_path=str(root), move_id=request['intent_request']['preparation']['move_id'], cause=type(error).__name__)) from error


def stage_relocation(request):
    """Create/confirm an inactive destination; never publish an authority anchor."""
    return _run(request, True)


def inspect_relocation_stage(request):
    """Read only; an appeared destination anchor always refuses inactive readback."""
    return _run(request, False)

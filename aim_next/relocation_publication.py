from __future__ import annotations

"""Historical publication intent only; no authority or metadata writes (1324)."""

from contextlib import contextmanager
import fcntl
from itertools import islice
import os
from pathlib import Path
import sqlite3
import time

from . import recovery_io as io, relocation
from .recovery import RecoveryFence
from .recovery_io import RecoveryError, require


def _request(value):
    try:
        require(type(value) is dict and set(value) == {'v', 'preparation', 'journal_root'}
                and type(value['v']) is int and value['v'] == 1, 'INVALID_REQUEST')
        preparation, stage = relocation._request(value['preparation'])
        parent = io.canonical(value['journal_root'])
        source, dest = preparation['source'], preparation['destination']
        for other in (Path(preparation['bundle_path']), stage.parent,
                      Path(source['db_path']).parent, Path(source['authority_path']).parent,
                      Path(dest['db_path']).parent, Path(dest['authority_path']).parent):
            require(not parent.is_relative_to(other) and not other.is_relative_to(parent), 'INVALID_REQUEST')
        request = dict(v=1, preparation=preparation, journal_root=str(parent))
        # Fail before claiming a directory if its exact request cannot be stored.
        require(len(io.encode(request)) <= 65536, 'INVALID_REQUEST')
        return request, parent/preparation['move_id']
    except (TypeError, ValueError, UnicodeError, RuntimeError, OSError, RecursionError) as error:
        raise RecoveryError('INVALID_REQUEST') from error


def _candidate(preparation):
    _, stage = relocation._request(preparation)
    with relocation._locked(stage) as (_, fd):
        manifest = relocation._completion(preparation, stage, fd)
        require(manifest is not None, 'PUBLICATION_PREPARATION_INCOMPLETE')
        saved, digest = io.read_record(stage/'request.json')
        require(saved == preparation and digest == io.digest_record(preparation), 'PUBLICATION_INVALID')
        _, marker_digest = io.read_record(stage/'prepared.json')
        return dict(path=str(stage), root_identity=io.identity(io.checked(stage, True)),
                    lock_identity=io.identity(os.fstat(fd)),
                    database_identity=io.identity(io.checked(stage/'data.sqlite3')),
                    request_digest=digest, prepared_digest=marker_digest,
                    bundle_digest=preparation['bundle_digest'], database=manifest['database'],
                    metadata=manifest['metadata'])


def _observe(preparation, candidate):
    source = preparation['source']
    path = Path(source['db_path'])
    io.checked(path.parent, True, 'PUBLICATION_SOURCE_MISMATCH')
    io.checked(Path(source['authority_path']).parent, True, 'PUBLICATION_SOURCE_MISMATCH')
    with RecoveryFence(source['authority_path'], source['authority_id'], source['instance_id'], 'readback') as fence:
        anchor = fence.record
        require(anchor['db_path'] == source['db_path'] and anchor['epoch'] == source['authority_epoch'],
                'PUBLICATION_SOURCE_MISMATCH')
        before = io.checked(path, code='PUBLICATION_SOURCE_MISMATCH')
        require(io.identity(before) == [anchor['db_device'], anchor['db_inode']], 'PUBLICATION_SOURCE_MISMATCH')
        record, digest = io.read_record(Path(source['authority_path']))
        require(record == anchor, 'PUBLICATION_SOURCE_MISMATCH')
        # The fixed seven-key read is the only work inside this transaction.
        with io.connection(path, policy='live', code='PUBLICATION_SOURCE_MISMATCH') as db:
            db.execute('BEGIN')
            metadata = io.metadata(db, 'PUBLICATION_SOURCE_MISMATCH')
            require(metadata == candidate['metadata'], 'PUBLICATION_SOURCE_MISMATCH')
        # SQLite closes before the fence; no raw DB descriptor is opened/closed.
        require(io.identity(io.checked(path)) == io.identity(before)
                and fence.verify() == anchor, 'PUBLICATION_SOURCE_MISMATCH')
        final, final_digest = io.read_record(Path(source['authority_path']))
        require(final == anchor and final_digest == digest, 'PUBLICATION_SOURCE_MISMATCH')
        return dict(anchor=anchor, anchor_digest=digest, metadata=metadata,
                    identities=dict(database=io.identity(before),
                                    authority_lock=[anchor['lock_device'], anchor['lock_inode']],
                                    runner_lock=[anchor['runner_lock_device'], anchor['runner_lock_inode']]))


def _same_lock(root, fd):
    held = io.check_info(os.fstat(fd))
    require(io.identity(held) == io.identity(io.checked(root/'intent.lock')), 'PUBLICATION_INVALID')


@contextmanager
def _locked(root, create=False):
    with io.opened(root.parent, True):
        fresh = False
        if create:
            try:
                root.mkdir(mode=0o700)
                fresh = True
            except FileExistsError:
                pass
        with io.opened(root, True):
            flags = (os.O_RDWR if create else os.O_RDONLY) | os.O_NOFOLLOW | os.O_NONBLOCK
            if fresh:
                flags |= os.O_CREAT | os.O_EXCL
            try:
                fd = os.open(str(root/'intent.lock'), flags, 0o600)
            except FileNotFoundError as error:
                raise RecoveryError('PUBLICATION_INCOMPLETE') from error
            try:
                _same_lock(root, fd)
                try:
                    fcntl.flock(fd, (fcntl.LOCK_EX if create else fcntl.LOCK_SH) | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise RecoveryError('PUBLICATION_BUSY', retryable=True) from error
                if fresh:
                    io.full_flush(fd)
                    io.flush_path(root, True)
                    io.flush_path(root.parent, True)
                yield fresh, fd
                _same_lock(root, fd)
            finally:
                os.close(fd)


def _completion(request, root, fd):
    if not os.path.lexists(str(root/'request.json')):
        require(not os.path.lexists(str(root/'complete.json')), 'PUBLICATION_INVALID')
        return None
    saved, request_digest = io.read_record(root/'request.json')
    require(saved == request and request_digest == io.digest_record(request), 'PUBLICATION_REQUEST_MISMATCH')
    if not os.path.lexists(str(root/'complete.json')):
        return None
    intent, intent_digest = io.read_record(root/'intent.json')
    marker, _ = io.read_record(root/'complete.json')
    require(marker == dict(v=1, request_digest=request_digest, intent_digest=intent_digest,
                          root_identity=io.identity(io.checked(root, True)), lock_identity=io.identity(os.fstat(fd))),
            'PUBLICATION_INVALID')
    prep = request['preparation']
    require(set(intent) == {'v', 'request_digest', 'preparation_digest', 'candidate', 'predecessor',
                            'proposed', 'owners', 'observed_ms'}
            and type(intent['v']) is int and intent['v'] == 1
            and intent['request_digest'] == request_digest
            and intent['preparation_digest'] == io.digest_record(prep)
            and intent['proposed'] == prep['destination'] and intent['owners'] == prep['owners']
            and type(intent['observed_ms']) is int and intent['observed_ms'] > 0, 'PUBLICATION_INVALID')
    require({p.name for p in islice(root.iterdir(), 5)}
            == {'intent.lock', 'request.json', 'intent.json', 'complete.json'}, 'PUBLICATION_INVALID')
    _same_lock(root, fd)
    return intent


def _flush(root):
    for name in ('intent.lock', 'request.json', 'intent.json', 'complete.json'):
        io.flush_path(root/name)
    io.flush_path(root, True)
    io.flush_path(root.parent, True)


def _result(request, root, status, intent=None, confirmed=False):
    return dict(status=status, inactive=True, durability_confirmed=confirmed,
                move_id=request['preparation']['move_id'], journal_path=str(root),
                request_digest=io.digest_record(request), intent=intent)


def _run(value, create):
    request, root = _request(value)
    try:
        io.checked(root.parent, True, 'INVALID_REQUEST')
        candidate = None
        if not os.path.lexists(str(root)):
            if not create:
                return _result(request, root, 'not_started')
            candidate = _candidate(request['preparation'])
        with _locked(root, create) as (fresh, fd):
            if fresh:
                require(candidate is not None, 'PUBLICATION_INCOMPLETE')
                io.write_record(root/'request.json', request)
                io.flush_path(root, True)
                # Candidate verification is complete before the short SH observation.
                predecessor = _observe(request['preparation'], candidate)
                prep = request['preparation']
                intent = dict(v=1, request_digest=io.digest_record(request),
                              preparation_digest=io.digest_record(prep), candidate=candidate,
                              predecessor=predecessor, proposed=prep['destination'], owners=prep['owners'],
                              observed_ms=int(time.time()*1000))
                io.write_record(root/'intent.json', intent)
                io.flush_path(root, True)
                io.write_record(root/'complete.json', dict(v=1, request_digest=io.digest_record(request),
                                intent_digest=io.digest_record(intent),
                                root_identity=io.identity(io.checked(root, True)),
                                lock_identity=io.identity(os.fstat(fd))))
            intent = _completion(request, root, fd)
            if create:
                require(intent is not None, 'PUBLICATION_INCOMPLETE')
                _flush(root)
                require(_completion(request, root, fd) == intent, 'PUBLICATION_INVALID')
        status = ('intent_recorded' if create else 'intent_observed') if intent else 'intent_incomplete'
        return _result(request, root, status, intent, create)
    except RecoveryError as error:
        error.evidence.update(journal_path=str(root), move_id=request['preparation']['move_id'])
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, KeyError, TypeError, UnicodeError) as error:
        code = 'DATABASE_BUSY' if io.busy(error) else 'PUBLICATION_UNCONFIRMED'
        raise RecoveryError(code, retryable=code == 'DATABASE_BUSY', evidence=dict(
            journal_path=str(root), move_id=request['preparation']['move_id'], cause=type(error).__name__)) from error


def prepare_publication_intent(request):
    """Retain an exact historical intent; never retire or publish authority."""
    return _run(request, True)


def inspect_publication_intent(request):
    """Read the immutable journal; never flush, repair, or refresh the observation."""
    return _run(request, False)

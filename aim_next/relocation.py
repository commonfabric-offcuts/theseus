from __future__ import annotations

"""Inactive snapshot preparation only; never an authority transition (1322)."""

from contextlib import contextmanager
import fcntl
from itertools import islice
import os
from pathlib import Path
import re
import sqlite3
import uuid

from . import backup, recovery_io as io
from .recovery_io import RecoveryError, require


FIELDS = {'v', 'move_id', 'staging_root', 'bundle_path', 'bundle_digest',
          'source', 'destination', 'owners', 'commit'}
SOURCE_FIELDS = {'instance_id', 'db_path', 'authority_path', 'authority_id', 'authority_epoch'}
HEX64 = re.compile('[0-9a-f]{64}')


def _request(value):
    try:
        require(type(value) is dict and set(value) == FIELDS, 'INVALID_REQUEST')
        require(type(value['v']) is int and value['v'] == 1, 'INVALID_REQUEST')
        require(type(value['move_id']) is str and str(uuid.UUID(value['move_id'])) == value['move_id'],
                'INVALID_REQUEST')
        require(type(value['bundle_digest']) is str and HEX64.fullmatch(value['bundle_digest']) is not None,
                'INVALID_REQUEST')
        source, dest, owners, commit = (value[k] for k in ('source', 'destination', 'owners', 'commit'))
        require(type(source) is dict and set(source) == SOURCE_FIELDS
                and all(io.identifier(source[k]) for k in SOURCE_FIELDS - {'db_path', 'authority_path'}),
                'INVALID_REQUEST')
        require(type(dest) is dict and set(dest) == {'db_path', 'authority_path'}, 'INVALID_REQUEST')
        require(type(owners) is dict and set(owners) == {'source_uid', 'destination_uid'}
                and all(type(n) is int and 0 <= n < 2**32 for n in owners.values())
                and owners['source_uid'] == os.getuid(), 'INVALID_REQUEST')
        require(type(commit) is dict and set(commit) == {'seq', 'id'}
                and type(commit['seq']) is str and commit['seq'].isascii() and commit['seq'].isdigit()
                and len(commit['seq']) <= 19 and str(int(commit['seq'])) == commit['seq']
                and int(commit['seq']) < 9223372036854775807
                and type(commit['id']) is str and re.fullmatch('[0-9a-f]{32}', commit['id']) is not None,
                'INVALID_REQUEST')
        staging, bundle = (io.canonical(value[k]) for k in ('staging_root', 'bundle_path'))
        old_db, old_anchor = (io.canonical(source[k]) for k in ('db_path', 'authority_path'))
        new_db, new_anchor = (io.canonical(dest[k]) for k in ('db_path', 'authority_path'))
        require(old_db != old_anchor and new_db != new_anchor
                and not {old_db, old_anchor} & {new_db, new_anchor}, 'INVALID_REQUEST')
        # No staging writes within either actual/proposed instance or bundle.
        for other in (bundle, old_db.parent, old_anchor.parent, new_db.parent, new_anchor.parent):
            require(not staging.is_relative_to(other) and not other.is_relative_to(staging), 'INVALID_REQUEST')
        # Capture independent values: a caller cannot mutate its dict mid-copy.
        request = dict(value, source=dict(source), destination=dict(dest), owners=dict(owners), commit=dict(commit))
        return request, staging / request['move_id']
    except (TypeError, ValueError, UnicodeError, RuntimeError, OSError) as error:
        raise RecoveryError('INVALID_REQUEST') from error


def _snapshot(request, manifest):
    metadata = manifest['metadata']
    require(all(metadata[k] == request['source'][k] for k in SOURCE_FIELDS - {'db_path'})
            and metadata['commit_seq'] == request['commit']['seq']
            and metadata['commit_id'] == request['commit']['id'], 'RELOCATION_SOURCE_MISMATCH')


def _same_lock(root, fd):
    held = io.check_info(os.fstat(fd))
    require(io.identity(held) == io.identity(io.checked(root/'prepare.lock')), 'RELOCATION_INVALID')


@contextmanager
def _locked(root, *, create=False):
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
                fd = os.open(str(root/'prepare.lock'), flags, 0o600)
            except FileNotFoundError as error:
                raise RecoveryError('RELOCATION_INCOMPLETE') from error
            try:
                _same_lock(root, fd)
                try:
                    fcntl.flock(fd, (fcntl.LOCK_EX if create else fcntl.LOCK_SH) | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise RecoveryError('RELOCATION_BUSY', retryable=True) from error
                if fresh:
                    io.full_flush(fd)
                    io.flush_path(root, True)
                    io.flush_path(root.parent, True)
                yield fresh, fd
                _same_lock(root, fd)
            finally:
                os.close(fd)


def _completion(request, root, fd):
    saved, _ = io.read_record(root/'request.json')
    require(saved == request, 'RELOCATION_REQUEST_MISMATCH')
    if not os.path.lexists(str(root/'prepared.json')):
        return None
    record, _ = io.read_record(root/'prepared.json')
    expected = dict(v=1, request_digest=io.digest_record(request), bundle_digest=request['bundle_digest'],
                    root_identity=io.identity(io.checked(root, True)), lock_identity=io.identity(os.fstat(fd)))
    require(record == expected, 'RELOCATION_INVALID')
    manifest = backup.inspect(str(root), expected_digest=request['bundle_digest'])
    _snapshot(request, manifest)
    names = {'prepare.lock', 'request.json', 'data.sqlite3', 'media', 'manifest.json', 'prepared.json'}
    require({p.name for p in islice(root.iterdir(), len(names)+1)} == names, 'RELOCATION_INVALID')
    media_names = {row['name'] for row in manifest['media']}
    require({p.name for p in islice((root/'media').iterdir(), len(media_names)+1)} == media_names,
            'RELOCATION_INVALID')
    _same_lock(root, fd)
    return manifest


def _result(request, root, status, confirmed=False):
    return dict(status=status, inactive=True, durability_confirmed=confirmed,
                move_id=request['move_id'], staging_path=str(root), request_digest=io.digest_record(request),
                original=dict(request['source']), proposed=dict(request['destination']), owners=dict(request['owners']),
                commit=dict(request['commit']), bundle_digest=request['bundle_digest'])


def _flush(root, manifest):
    for name in ('prepare.lock', 'request.json', 'data.sqlite3', 'manifest.json', 'prepared.json'):
        io.flush_path(root/name)
    for row in manifest['media']:
        io.flush_path(root/'media'/row['name'])
    io.flush_path(root/'media', True)
    io.flush_path(root, True)
    io.flush_path(root.parent, True)


def prepare(value):
    """Copy a verified bundle; only a completed matching retry is repeatable."""
    request, root = _request(value)
    try:
        io.checked(root.parent, True, 'INVALID_REQUEST')
        if not os.path.lexists(str(root)):
            manifest = backup.inspect(request['bundle_path'], expected_digest=request['bundle_digest'])
            _snapshot(request, manifest)
        with _locked(root, create=True) as (fresh, fd):
            if fresh:
                io.write_record(root/'request.json', request)
                io.flush_path(root, True)
                bundle = Path(request['bundle_path'])
                manifest = backup.inspect(str(bundle), expected_digest=request['bundle_digest'])
                _snapshot(request, manifest)
                (root/'media').mkdir(mode=0o700)
                io.copy_file(bundle/'data.sqlite3', root/'data.sqlite3', manifest['database'])
                for row in manifest['media']:
                    io.copy_file(bundle/'media'/row['name'], root/'media'/row['name'],
                                 {k: row[k] for k in ('size', 'sha256')})
                source_manifest = io.hash_file(bundle/'manifest.json')
                require(source_manifest['sha256'] == request['bundle_digest'], 'BUNDLE_INVALID')
                io.copy_file(bundle/'manifest.json', root/'manifest.json', source_manifest)
                staged = backup.inspect(str(root), expected_digest=request['bundle_digest'])
                _snapshot(request, staged)
                backup.inspect(str(bundle), expected_digest=request['bundle_digest'])
                io.flush_path(root/'media', True)
                io.flush_path(root, True)
                io.write_record(root/'prepared.json', dict(v=1, request_digest=io.digest_record(request),
                    bundle_digest=request['bundle_digest'], root_identity=io.identity(io.checked(root, True)),
                    lock_identity=io.identity(os.fstat(fd))))
            manifest = _completion(request, root, fd)
            require(manifest is not None, 'RELOCATION_INCOMPLETE')
            _flush(root, manifest)
            _completion(request, root, fd)
        return _result(request, root, 'prepared', True)
    except RecoveryError as error:
        error.evidence.update(staging_path=str(root), move_id=request['move_id'])
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, KeyError, TypeError, UnicodeError) as error:
        raise RecoveryError('RELOCATION_UNCONFIRMED', evidence={
            'staging_path': str(root), 'move_id': request['move_id'], 'cause': type(error).__name__}) from error


def inspect_prepared(value):
    """Read-only observation, never a flush, repair, binding or activation."""
    request, root = _request(value)
    try:
        io.checked(root.parent, True, 'INVALID_REQUEST')
        if not os.path.lexists(str(root)):
            return _result(request, root, 'not_started')
        with _locked(root) as (_, fd):
            manifest = _completion(request, root, fd)
        return _result(request, root, 'prepared_observed' if manifest is not None else 'preparation_incomplete')
    except RecoveryError as error:
        error.evidence.update(staging_path=str(root), move_id=request['move_id'])
        raise
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, UnicodeError) as error:
        raise RecoveryError('RELOCATION_UNCONFIRMED', evidence={
            'staging_path': str(root), 'move_id': request['move_id'], 'cause': type(error).__name__}) from error

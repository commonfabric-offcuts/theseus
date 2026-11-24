from __future__ import annotations

import os
from pathlib import Path
import re
import sqlite3
import time

from .authority import Authority
from . import recovery_io as io
from .recovery_io import RecoveryError, require


MANIFEST_LIMIT = 16 * 1024 * 1024


def media_rows(db):
    rows = []
    for name, size, digest in db.execute("SELECT blob_key,size_bytes,sha256 FROM media_intents WHERE state='ready' ORDER BY blob_key"):
        require(isinstance(name, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,200}', name) is not None
                and type(size) is int and 0 <= size <= 67108864
                and isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest) is not None,
                'BUNDLE_INVALID')
        rows.append(dict(name=name, size=size, sha256=digest))
    return rows


def inspect(bundle_path, *, expected_digest=None):
    """Read/verify a completed bundle. Never opens a writable Store or changes it."""
    try:
        root = io.canonical(bundle_path)
        io.checked(root, True, 'BUNDLE_INVALID')
        manifest, digest = io.read_record(root/'manifest.json', MANIFEST_LIMIT)
        require(expected_digest is None or digest == expected_digest, 'BUNDLE_INVALID')
        require(set(manifest) == {'v', 'metadata', 'database', 'media'} and type(manifest['v']) is int
                and manifest['v'] == 1, 'BUNDLE_INVALID')
        io.hash_file(root/'data.sqlite3', expected=manifest['database'], code='BUNDLE_INVALID')
        with io.connection(root/'data.sqlite3', code='BUNDLE_INVALID') as db:
            db.execute('BEGIN')
            require(io.metadata(db, 'BUNDLE_INVALID') == manifest['metadata'], 'BUNDLE_INVALID')
            require(media_rows(db) == manifest['media'], 'BUNDLE_INVALID')
        io.checked(root/'media', True, 'BUNDLE_INVALID')
        for row in manifest['media']:
            io.hash_file(root/'media'/row['name'], expected={k: row[k] for k in ('size', 'sha256')}, code='BUNDLE_INVALID')
        return manifest
    except RecoveryError as error:
        if error.code == 'INVALID_REQUEST':
            raise
        raise RecoveryError('BUNDLE_INVALID') from error
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        raise RecoveryError('BUNDLE_INVALID') from error


def backup(db_path, instance_id, *, expected_binding, bundle_path):
    """Online SQLite snapshot plus all ready immutable media; complete marker last."""
    timings = io.Timings()
    with timings.scope():
        return _backup(db_path, instance_id, expected_binding, bundle_path, timings)


def _backup(db_path, instance_id, expected_binding, bundle_path, timings):
    root = io.canonical(bundle_path)
    path = io.canonical(str(db_path))
    authority = Authority(path, instance_id, expected_binding)
    require(not root.exists(), 'BUNDLE_OCCUPIED')
    io.checked(root.parent, True, 'INVALID_REQUEST')
    require(not authority.path.is_relative_to(root) and not path.is_relative_to(root), 'INVALID_REQUEST')
    try:
        root.mkdir(mode=0o700)
        io.checked(root, True, 'BUNDLE_INVALID')
        (root/'media').mkdir(mode=0o700)
        target = root/'data.sqlite3'
        fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        with authority.shared() as fence:
            with io.connection(path, code='ORIGINAL_UNAVAILABLE', policy='live') as source:
                snapshot = sqlite3.connect(str(target), isolation_level=None)
                try:
                    # A persistently locked source is a failed bounded attempt,
                    # not sqlite.backup's otherwise unlimited retry loop.
                    started = time.perf_counter()
                    def progress(status, remaining, total):
                        # CPython 3.9 exposes callback result numbers, not the
                        # SQLITE_BUSY/LOCKED constants introduced later.
                        if status in (5, 6) and time.perf_counter()-started >= .25:
                            raise RecoveryError('DATABASE_BUSY', retryable=True)
                    with timings.phase('copy'):
                        source.backup(snapshot, pages=64, progress=progress, sleep=.01)
                finally:
                    snapshot.close()
                fence.verify()
            with io.connection(target, code='BUNDLE_INVALID') as snapshot:
                snapshot.execute('BEGIN')
                metadata = io.metadata(snapshot, 'BUNDLE_INVALID')
                require(metadata['instance_id'] == instance_id and all(metadata[k] == v for k,v in expected_binding.items()),
                        'BUNDLE_INVALID')
                media = media_rows(snapshot)
            with timings.phase('copy'):
                if media:
                    media_root = Path(str(path)+'.media')
                    with io.opened(media_root, True, code='BUNDLE_INVALID'):
                        for row in media:
                            io.copy_file(media_root/row['name'], root/'media'/row['name'],
                                         {k: row[k] for k in ('size','sha256')}, clone=True)
            fence.verify()
        with timings.phase('verification'):
            manifest = dict(v=1, metadata=metadata, database=io.hash_file(target), media=media)
        with timings.phase('full_flush'):
            io.flush_path(target)
            io.flush_path(root/'media', True)
            io.flush_path(root, True)
            io.flush_path(root.parent, True)
            # Absence of this direct marker always means incomplete backup.
            io.write_record(root/'manifest.json', manifest, MANIFEST_LIMIT)
            io.flush_path(root, True)
        return dict(bundle_path=str(root), bundle_digest=io.digest_record(manifest), timings_seconds=timings.seconds)
    except RecoveryError:
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, UnicodeError) as error:
        code = 'DATABASE_BUSY' if io.busy(error) else 'BACKUP_UNCONFIRMED'
        raise RecoveryError(code, retryable=code == 'DATABASE_BUSY', evidence={'bundle_path': str(root)}) from error

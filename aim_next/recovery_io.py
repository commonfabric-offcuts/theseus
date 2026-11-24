from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

from .contract import StoreError, _json

_timings = ContextVar('recovery_timings', default=None)


class RecoveryError(StoreError):
    def __init__(self, code, message=None, *, retryable=False, evidence=None):
        self.code = code
        self.retryable = retryable
        self.evidence = evidence or {}
        super().__init__(message or code.replace('_', ' ').capitalize())


def require(condition, code='CONTROL_INVALID'):
    if not condition:
        raise RecoveryError(code)


def canonical(value):
    require(isinstance(value, str) and 0 < len(value.encode('utf-8')) <= 4096 and '\x00' not in value,
            'INVALID_REQUEST')
    path = Path(value)
    require(path.is_absolute() and str(path.resolve()) == value, 'INVALID_REQUEST')
    return path


def identifier(value):
    return (isinstance(value, str) and 0 < len(value) <= 200
            and not any(ord(c) < 32 for c in value) and len(value.encode('utf-8')) <= 800)


def identity(info):
    return [info.st_dev, info.st_ino]


def facts(info):
    return dict(device=info.st_dev, inode=info.st_ino, size=info.st_size, mode=stat.S_IMODE(info.st_mode),
                uid=info.st_uid, nlink=info.st_nlink, mtime_ns=info.st_mtime_ns, ctime_ns=info.st_ctime_ns)


def check_info(info, directory=False, code='CONTROL_INVALID'):
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600)
            and (directory or info.st_nlink == 1), code)
    return info


def checked(path, directory=False, code='CONTROL_INVALID'):
    try:
        return check_info(Path(path).lstat(), directory, code)
    except OSError as error:
        if isinstance(error, InterruptedError):
            raise
        raise RecoveryError(code) from error


def original_checked(path):
    """Availability is not private-candidate acceptance or failed observation."""
    try:
        info = Path(path).lstat()
    except FileNotFoundError as error:
        raise RecoveryError('ORIGINAL_UNAVAILABLE') from error
    except OSError as error:
        raise RecoveryError('RECOVERY_UNCONFIRMED') from error
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), 'RECOVERY_UNCONFIRMED')
    return info


@contextmanager
def opened(path, directory=False, write=False, code='CONTROL_INVALID'):
    flags = (os.O_RDWR if write else os.O_RDONLY) | os.O_NOFOLLOW | os.O_NONBLOCK
    if directory:
        flags |= os.O_DIRECTORY
    fd = os.open(str(path), flags)
    try:
        check_info(os.fstat(fd), directory, code)
        require(identity(os.fstat(fd)) == identity(checked(path, directory, code)), code)
        yield fd
        check_info(os.fstat(fd), directory, code)
        require(identity(os.fstat(fd)) == identity(checked(path, directory, code)), code)
    finally:
        try:
            os.close(fd)
        except BaseException as error:
            raise RecoveryError('RECOVERY_UNCONFIRMED') from error


def full_flush(fd):
    """Checked Darwin drive-cache request. No weaker fallback, including for dirs."""
    start = time.perf_counter()
    try:
        require(sys.platform == 'darwin' and hasattr(fcntl, 'F_FULLFSYNC'), 'FULL_FLUSH_UNSUPPORTED')
        require(fcntl.fcntl(fd, fcntl.F_FULLFSYNC) == 0, 'RECOVERY_UNCONFIRMED')
    finally:
        active = _timings.get()
        if active is not None:
            active.seconds['full_flush'] += time.perf_counter()-start


def flush_path(path, directory=False):
    with opened(path, directory) as fd:
        full_flush(fd)


def encode(record):
    return (_json(record) + '\n').encode('utf-8')


def write_record(path, record, limit=65536):
    raw = encode(record)
    require(len(raw) <= limit, 'RECORD_TOO_LARGE')
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        check_info(os.fstat(stream.fileno()))
        stream.write(raw)
        stream.flush()
        full_flush(stream.fileno())


def _pairs(items):
    output = {}
    for key, value in items:
        require(key not in output)
        output[key] = value
    return output


def _constant(value):
    raise RecoveryError('CONTROL_INVALID')


def read_record(path, limit=65536):
    with opened(path) as fd:
        before = facts(os.fstat(fd))
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(limit + 1)
        require(len(raw) <= limit and facts(os.fstat(fd)) == before)
        result = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs, parse_constant=_constant)
        require(isinstance(result, dict))
        return result, hashlib.sha256(raw).hexdigest()


def hash_file(path, *, expected=None, code='CANDIDATE_INVALID'):
    with opened(path, code=code) as fd:
        before = facts(os.fstat(fd))
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
            require(size <= before['size'], code)
        require(facts(os.fstat(fd)) == before and size == before['size'], code)
    result = {'size': size, 'sha256': digest.hexdigest()}
    require(expected is None or result == expected, code)
    return result


def _clone_file(source_fd, dest):
    """Try Darwin's atomic, exclusive CoW creation from an already checked fd."""
    if sys.platform != 'darwin':
        return False
    import ctypes
    try:
        clonefile = ctypes.CDLL(None, use_errno=True).fclonefileat
    except (AttributeError, OSError):
        return False
    clonefile.argtypes = (ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32)
    clonefile.restype = ctypes.c_int
    dest = Path(dest)
    with opened(dest.parent, True, code='BUNDLE_INVALID') as parent_fd:
        # CLONE_NOFOLLOW=1 also selects NOFOLLOW for XNU's destination CREATE;
        # an occupied final component is EEXIST, including a dangling symlink.
        # This must hold at native entry, including a name arriving after the
        # parent was opened; the fallback cannot undo native path side effects.
        # CLONE_NOOWNERCOPY=2 keeps the existing private ownership behavior.
        return clonefile(source_fd, parent_fd, os.fsencode(dest.name), 1 | 2) == 0


def copy_file(source, dest, expected, *, clone=False):
    with opened(source, code='BUNDLE_INVALID') as source_fd:
        before = facts(os.fstat(source_fd))
        if clone and _clone_file(source_fd, dest):
            with opened(dest, write=True, code='CANDIDATE_INVALID') as target_fd:
                require(identity(os.fstat(target_fd)) != identity(os.fstat(source_fd)), 'BUNDLE_INVALID')
                target_before = facts(os.fstat(target_fd))
                total, digest = 0, hashlib.sha256()
                while True:
                    chunk = os.read(target_fd, 65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    require(total <= expected['size'], 'BUNDLE_INVALID')
                    digest.update(chunk)
                require({'size': total, 'sha256': digest.hexdigest()} == expected, 'BUNDLE_INVALID')
                require(facts(os.fstat(target_fd)) == target_before
                        and facts(os.fstat(source_fd)) == before, 'BUNDLE_INVALID')
                full_flush(target_fd)
            return
        fd = os.open(str(dest), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as target:
            check_info(os.fstat(target.fileno()), code='CANDIDATE_INVALID')
            total, digest = 0, hashlib.sha256()
            while True:
                chunk = os.read(source_fd, 65536)
                if not chunk:
                    break
                total += len(chunk)
                require(total <= expected['size'], 'BUNDLE_INVALID')
                digest.update(chunk)
                target.write(chunk)
            require({'size': total, 'sha256': digest.hexdigest()} == expected, 'BUNDLE_INVALID')
            require(facts(os.fstat(source_fd)) == before, 'BUNDLE_INVALID')
            target.flush()
            full_flush(target.fileno())


RUNTIME = {'journal_mode': 'delete', 'synchronous': 3, 'fullfsync': 1,
           'foreign_keys': 1, 'busy_timeout': 250}
META = ('instance_id', 'schema_version', 'authority_id', 'authority_path', 'authority_epoch',
        'commit_seq', 'commit_id')


@contextmanager
def connection(path, *, write=False, code='CANDIDATE_INVALID', require_delete=True, policy='immutable'):
    require(policy in ('immutable', 'live', 'original') and (not write or policy == 'immutable'))
    def observe():
        return original_checked(path) if policy == 'original' else checked(path, code=code)
    before = observe()
    busy_ms = 5000 if write else 250
    db = sqlite3.connect(Path(path).as_uri() + ('?mode=rw' if write else '?mode=ro'),
                         uri=True, isolation_level=None, timeout=busy_ms / 1000.0)
    try:
        db.execute('PRAGMA synchronous=EXTRA')
        db.execute('PRAGMA fullfsync=ON')
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=%d' % busy_ms)
        actual = {key: db.execute('PRAGMA ' + key).fetchone()[0] for key in RUNTIME}
        # Availability is a read-only history observation, not candidate
        # acceptance. A readable WAL original still forbids choosing a gap.
        compared = actual if require_delete else dict(actual, journal_mode='delete')
        require(compared == dict(RUNTIME, busy_timeout=busy_ms), 'RECOVERY_UNCONFIRMED' if policy == 'original' else code)
        after = observe()
        require(identity(after) == identity(before), code)
        if policy == 'immutable':
            require(facts(after) == facts(before), code)
        yield db
        after = observe()
        require(identity(after) == identity(before), code)
    finally:
        try:
            db.close()
        except BaseException as error:
            raise RecoveryError('RECOVERY_UNCONFIRMED') from error


def metadata(db, code='CANDIDATE_INVALID'):
    from .store import SCHEMA_VERSION
    # An unknown layout cannot make its missing/differently typed keys evidence
    # of lost history. Establish the version first, in the caller's transaction.
    schema = db.execute('SELECT typeof(value),substr(CAST(value AS BLOB),1,4097) FROM metadata '
                        'WHERE key=? LIMIT 2', ('schema_version',)).fetchall()
    require(len(schema) == 1 and schema[0] == ('text', SCHEMA_VERSION.encode('utf-8')),
            'RECOVERY_UNCONFIRMED' if code == 'ORIGINAL_UNAVAILABLE' else code)
    rows = db.execute('SELECT key,typeof(value),substr(CAST(value AS BLOB),1,4097) FROM metadata '
                      'WHERE key IN (' + ','.join('?' for _ in META) + ')', META).fetchall()
    require(len(rows) == len(META), code)
    result = {}
    for key, kind, raw in rows:
        require(kind == 'text' and isinstance(raw, bytes) and len(raw) <= 4096, code)
        result[key] = raw.decode('utf-8')
    seq = result['commit_seq']
    require(seq.isascii() and seq.isdigit()
            and len(seq) <= 19 and int(seq) < 9223372036854775807
            and re.fullmatch('[0-9a-f]{32}', result['commit_id']) is not None, code)
    require(all(identifier(result[key]) for key in ('instance_id', 'authority_id', 'authority_epoch')), code)
    require(str(canonical(result['authority_path'])) == result['authority_path'], code)
    return result


def read_metadata(path, code='CANDIDATE_INVALID', *, require_delete=True, policy='immutable'):
    with connection(path, code=code, require_delete=require_delete, policy=policy) as db:
        db.execute('BEGIN')
        return metadata(db, code)


def digest_record(value):
    return hashlib.sha256(encode(value)).hexdigest()


def busy(error):
    return (isinstance(error, sqlite3.OperationalError) and error.__cause__ is None
            and ('busy' in str(error).lower() or 'locked' in str(error).lower()))


class Timings:
    def __init__(self):
        self.orphan_paths = []
        self.seconds = dict(copy=0.0, verification=0.0, staging=0.0, full_flush=0.0,
                            fence_wait=0.0, fence_hold=0.0, publication=0.0, reporting=0.0)

    @contextmanager
    def scope(self):
        token = _timings.set(self)
        try:
            yield
        finally:
            _timings.reset(token)

    @contextmanager
    def phase(self, name):
        start = time.perf_counter()
        try:
            yield
        finally:
            # full_flush records actual syscall time, including calls nested in
            # copy/staging/publication. Other phase totals are inclusive.
            if name != 'full_flush':
                self.seconds[name] += time.perf_counter() - start

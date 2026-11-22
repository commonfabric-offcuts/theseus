from __future__ import annotations

"""Safe runner diagnostics: code-owned phrases, never a slice of exception text."""

import json
import re
import sqlite3
import hashlib

CURRENT = 'runner_fault.v1:current'
PRIOR = 'runner_fault.v1:prior'
_CLASS = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,63}')
# runner_fault.v1 is a persisted contract shared by writers and readers. These
# names stay readable even when a different Python runtime lacks their classes;
# ambient/new runtime classes cannot silently widen what diagnostics may keep.
_CLASS_NAMES = (
    'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException',
    'BlockingIOError', 'BrokenPipeError', 'BufferError', 'BytesWarning',
    'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError',
    'ConnectionRefusedError', 'ConnectionResetError', 'DataError', 'DatabaseError',
    'DeprecationWarning', 'EOFError', 'EnvironmentError', 'Error', 'Exception',
    'FileExistsError', 'FileNotFoundError', 'FloatingPointError', 'FutureWarning',
    'GeneratorExit', 'IOError', 'ImportError', 'ImportWarning', 'IndentationError',
    'IndexError', 'IntegrityError', 'InterfaceError', 'InternalError',
    'InterruptedError', 'IsADirectoryError', 'KeyError', 'KeyboardInterrupt',
    'LookupError', 'MemoryError', 'ModuleNotFoundError', 'NameError',
    'NotADirectoryError', 'NotImplementedError', 'NotSupportedError', 'OSError',
    'OperationalError', 'OverflowError', 'PendingDeprecationWarning',
    'PermissionError', 'ProcessLookupError', 'ProgrammingError', 'RecursionError',
    'ReferenceError', 'ResourceWarning', 'RuntimeError', 'RuntimeWarning',
    'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SyntaxWarning',
    'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'TypeError',
    'UnboundLocalError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError',
    'UnicodeTranslateError', 'UnicodeWarning', 'UserWarning', 'ValueError',
    'Warning', 'ZeroDivisionError',
    'StoreError', 'StoreOpenError', 'RunnerError', 'RoutePinError', 'AuthorityError',
    'ProfileError', 'LoopFault', 'HostFault', 'AdapterFault', 'BrokerConfigError', 'BrokerBindingError',
    'RouteUnavailable', 'Refusal', 'GuardBusy')
_CLASSES = frozenset(_CLASS_NAMES)
_SQLITE = {
    'database is locked': 'database is locked',
    'database table is locked': 'database table is locked',
    'database schema is locked': 'database schema is locked',
    'disk i/o error': 'disk I/O error',
    'database or disk is full': 'database or disk is full',
    'database disk image is malformed': 'database disk image is malformed',
    'attempt to write a readonly database': 'attempt to write a readonly database',
}
_TYPE = {
    'ValueError': 'Invalid value; exception text withheld.',
    'KeyError': 'Required value missing; exception text withheld.',
    'OSError': 'OS operation failed; exception text withheld.',
    'PermissionError': 'Permission denied; exception text withheld.',
    'KeyboardInterrupt': 'Operation interrupted.',
}
_UNKNOWN = 'Exception text withheld.'
_DATABASE = 'SQLite operation failed; exception text withheld.'
_MESSAGES = frozenset([*_SQLITE.values(), *_TYPE.values(), _UNKNOWN, _DATABASE])


def busy(error):
    """SQLite's busy/locked family, never an unrelated message containing 'busy'."""
    if not isinstance(error, sqlite3.OperationalError) or error.__cause__ is not None:
        return False
    code = getattr(error, 'sqlite_errorcode', None)
    if type(code) is int:
        return code & 255 in (5, 6)  # SQLITE_BUSY / SQLITE_LOCKED, including extended codes.
    # CPython3.9 does not expose sqlite_errorcode. Its canonical messages do.
    text = error.args[0].lower() if error.args and isinstance(error.args[0], str) else ''
    return (text in ('database is locked', 'database is busy', 'database table is locked', 'database schema is locked')
            or text.startswith(('database table is locked:', 'database schema is locked:')))


def describe(error):
    try:
        return _describe(error)
    except BaseException:
        # Fault handling must itself survive hostile exception descriptors.
        return {'exception_class': 'Exception', 'message': _UNKNOWN}


def _describe(error):
    # LoopFault/Core wrappers retain the original exception with `raise from`.
    # Stop on a cycle; do not execute an exception's arbitrary __str__ method.
    seen = set()
    while isinstance(error.__cause__, BaseException) and id(error.__cause__) not in seen and len(seen) < 8:
        seen.add(id(error)); error = error.__cause__
    name = type(error).__name__
    # Code-owned classes are safe; a dynamically supplied class name may itself
    # contain a token or writing. Unknown classes are explicitly generalized.
    if not _CLASS.fullmatch(name) or name not in _CLASSES: name = 'Exception'
    message = _TYPE.get(name, _UNKNOWN)
    if isinstance(error, sqlite3.Error):
        message = _DATABASE
        text = error.args[0] if error.args and isinstance(error.args[0], str) else ''
        # Equality only: arbitrary suffixes (paths, SQL, tokens, bodies) never pass.
        message = _SQLITE.get(text.lower(), message)
    return {'exception_class': name, 'message': message}


def validate(value):
    if (type(value) is not dict or set(value) != {'exception_class', 'message'}
            or not isinstance(value['exception_class'], str) or value['exception_class'] not in _CLASSES
            or not isinstance(value['message'], str) or value['message'] not in _MESSAGES):
        raise ValueError('Use a safe runner diagnostic')
    return dict(value)


def _owner(generation):
    # Existing Core ownership, hashed so the diagnostic stores no guard/token.
    return hashlib.sha256(generation.encode()).hexdigest() if isinstance(generation, str) else None


def read(db, generation, key=CURRENT):
    owner = _owner(generation)
    if owner is None: return None
    row = db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
    if row is None: return None
    try:
        saved = json.loads(row[0])
        if type(saved) is not dict or saved.get('owner') != owner: return None
        return validate(saved['fault'])
    except (KeyError, TypeError, ValueError):
        return None


def write(db, value, generation=None, key=CURRENT):
    if value is None:
        db.execute('DELETE FROM metadata WHERE key=?', (key,))
    else:
        owner = _owner(generation)
        if owner is None: raise ValueError('A kept fault names its existing runner ownership')
        db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (key, json.dumps({'owner': owner, 'fault': validate(value)}, separators=(',', ':'))))

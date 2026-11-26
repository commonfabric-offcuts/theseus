from __future__ import annotations

"""Read-only, bounded observations of a stopped ownership handoff (1330)."""

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import unicodedata

from . import destination_profiles as profiles, profile, recovery_io as io
from .authority import AuthorityError
from .contract import Refusal
from .recovery_io import RecoveryError, require

MAX_ENTRIES = 16384
MAX_DEPTH = 32
MAX_PATH_BYTES = 4096
MAX_BYTES = 8 * 1024 * 1024
REQUEST = {'v', 'root', 'source_uid', 'target_uid', 'publication_receipt',
           'profiles_request', 'profiles_result', 'manifest_bytes', 'manifest_digest'}
SNAPSHOT = {'v', 'actor', 'request', 'root_identity', 'binding', 'lineage', 'original_pairs',
            'current_pairs', 'commit', 'actors', 'inventory'}
PAIRS = {'database', 'authority_lock', 'runner_lock'}
STABLE = ('path', 'type', 'device', 'inode', 'mode', 'size', 'mtime_ns')


def _copy(value):
    require(type(value) is dict, 'HANDOFF_INVALID_REQUEST')
    encoded = io.encode(value)
    require(len(encoded) <= MAX_BYTES, 'HANDOFF_LIMIT')
    return json.loads(encoded)


def _uid(value): return type(value) is int and 0 <= value < 2**32


def _digest(value):
    return type(value) is str and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def _request(value):
    value = _copy(value)
    require(set(value) == REQUEST and type(value['v']) is int and value['v'] == 1
            and _uid(value['source_uid']) and _uid(value['target_uid']), 'HANDOFF_INVALID_REQUEST')
    root = io.canonical(value['root'])
    staged, _, output, old = profiles._request(value['profiles_request'])
    require(output.is_relative_to(root) and output != root, 'HANDOFF_ROOT_MISMATCH')
    value['profiles_request'] = staged
    require(type(value['manifest_bytes']) is str and _digest(value['manifest_digest'])
            and len(value['manifest_bytes'].encode('utf-8')) <= profiles.MANIFEST_LIMIT
            and hashlib.sha256(value['manifest_bytes'].encode('utf-8')).hexdigest() == value['manifest_digest'],
            'HANDOFF_MANIFEST_CHANGED')
    return value, root, output, old


def _relative(value):
    require(type(value) is str and len(value.encode('utf-8')) <= MAX_PATH_BYTES
            and '\x00' not in value and not value.startswith('/')
            and (not value or all(p not in ('', '.', '..') for p in value.split('/'))), 'HANDOFF_LIMIT')
    require(not value or len(value.split('/')) <= MAX_DEPTH, 'HANDOFF_LIMIT')


def _info(info, relative, device):
    _relative(relative)
    directory = stat.S_ISDIR(info.st_mode)
    require(directory or stat.S_ISREG(info.st_mode), 'HANDOFF_UNSAFE_ENTRY')
    mode = stat.S_IMODE(info.st_mode)
    require(info.st_uid == os.getuid() and mode in ((0o700,) if directory else (0o600, 0o700))
            and (directory or info.st_nlink == 1) and info.st_dev == device, 'HANDOFF_UNSAFE_ENTRY')
    return dict(path=relative, type='directory' if directory else 'file', device=info.st_dev,
                inode=info.st_ino, mode=mode, uid=info.st_uid, size=info.st_size,
                mtime_ns=info.st_mtime_ns, ctime_ns=info.st_ctime_ns)


def _names(fd, remaining):
    names = []
    with os.scandir(fd) as entries:
        for entry in entries:
            names.append(entry.name)
            require(len(names) <= remaining, 'HANDOFF_LIMIT')
    folded = [unicodedata.normalize('NFD', n).casefold() for n in names]
    require(len(set(folded)) == len(names), 'HANDOFF_ALIAS')
    return sorted(names)


def _walk(root, root_fd, budget):
    result = []; used = 0; device = os.fstat(root_fd).st_dev
    def add(record):
        nonlocal used
        result.append(record); used += len(io.encode(record)) + 1
        require(len(result) <= MAX_ENTRIES and used <= budget, 'HANDOFF_LIMIT')
    def directory(fd, relative):
        before = _info(os.fstat(fd), relative, device); add(before)
        names = _names(fd, MAX_ENTRIES-len(result))
        for name in names:
            path = relative+'/'+name if relative else name
            node = _info(os.stat(name, dir_fd=fd, follow_symlinks=False), path, device)
            if node['type'] == 'directory':
                child = os.open(name, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=fd)
                try:
                    require(_info(os.fstat(child), path, device) == node, 'HANDOFF_CHANGED')
                    directory(child, path)
                    require(_info(os.stat(name, dir_fd=fd, follow_symlinks=False), path, device)
                            == _info(os.fstat(child), path, device), 'HANDOFF_CHANGED')
                finally: os.close(child)
            else: add(node)
        require(_names(fd, MAX_ENTRIES) == names and _info(os.fstat(fd), relative, device) == before,
                'HANDOFF_CHANGED')
    directory(root_fd, '')
    require(_info(os.lstat(root), '', device) == _info(os.fstat(root_fd), '', device), 'HANDOFF_CHANGED')
    return sorted(result, key=lambda entry: entry['path'])


def _original_pairs(original, actual):
    require(type(original) is dict and set(original) == PAIRS
            and all(type(pair) is list and len(pair) == 2 and all(type(n) is int and n >= 0 for n in pair)
                    for pair in original.values()), 'HANDOFF_MANIFEST_CHANGED')
    require(original == actual, 'HANDOFF_ORIGINAL_IDENTITY_CHANGED')


def _target_ownership(target, entries):
    # This WHOLE family is one deliberate safety-fault control, never a single-gate claim.
    require(os.getuid() == target and os.geteuid() == target, 'HANDOFF_TARGET_UID')
    require(entries[0]['path'] == '' and entries[0]['uid'] == target, 'HANDOFF_TARGET_UID')
    require(all(entry['uid'] == target for entry in entries[1:]), 'HANDOFF_TARGET_UID')


def _raw_manifest(path):
    with io.opened(path) as fd:
        require(os.fstat(fd).st_size <= profiles.MANIFEST_LIMIT, 'HANDOFF_LIMIT')
        chunks = []; size = 0
        while True:
            data = os.read(fd, min(65536, profiles.MANIFEST_LIMIT+1-size))
            if not data: break
            chunks.append(data); size += len(data)
            require(size <= profiles.MANIFEST_LIMIT, 'HANDOFF_LIMIT')
    return b''.join(chunks)


def _context(store, actor, request, root, output, old, fence, runner_fd):
    fence.verify()
    for path in (store.path, store._authority.path, Path(str(store._authority.path)+'.lock'),
                 Path(str(store._authority.path)+'.runner.lock')):
        require(path.is_relative_to(root) and path != root, 'HANDOFF_ROOT_MISMATCH')
    lineage = profiles._receipt(request['publication_receipt'], request['profiles_request'],
                                store, fence.record, old)
    actor_result = store.view(actor, 'capabilities', {})
    require(type(actor_result) is dict and not actor_result.get('error')
            and actor_result.get('instance_id') == store.instance_id, 'HANDOFF_ACTOR_UNAVAILABLE')
    observed = profiles.inspect_destination_profiles(request['profiles_request'])
    result = request['profiles_result']
    require(type(result) is dict and set(result) ==
            {'status', 'durability_confirmed', 'output_dir', 'manifest_path', 'profiles'}
            and result['status'] == 'profiles_staged' and result['durability_confirmed'] is True
            and result['output_dir'] == str(output) and result['manifest_path'] == str(output/'manifest.json')
            and observed.get('status') == 'profiles_observed' and result['profiles'] == observed['profiles'],
            'HANDOFF_PROFILES_UNCONFIRMED')
    raw = _raw_manifest(output/'manifest.json')
    require(raw == request['manifest_bytes'].encode('utf-8')
            and hashlib.sha256(raw).hexdigest() == request['manifest_digest'], 'HANDOFF_MANIFEST_CHANGED')
    manifest, _ = io.read_record(output/'manifest.json', profiles.MANIFEST_LIMIT)
    require(manifest['publication_receipt'] == request['publication_receipt'], 'HANDOFF_MANIFEST_CHANGED')
    actual = profiles._identities(store, fence, runner_fd)
    _original_pairs(manifest['identities'], actual)
    actors = []
    for entry in manifest['entries']:
        loaded = profile.load_profile(output/entry['profile'])
        require(loaded.actor_id == entry['actor_id'] and loaded.instance_id == store.instance_id
                and loaded.db_path == store.path and loaded.binding == store.binding, 'HANDOFF_PROFILE_CHANGED')
        actors.append(loaded.actor_id)
    metadata = io.read_metadata(store.path, policy='live')
    fence.verify()
    return dict(binding=profiles._binding(store), lineage=_copy(lineage),
                original_pairs=_copy(manifest['identities']), current_pairs=actual,
                commit=dict(seq=metadata['commit_seq'], id=metadata['commit_id']), actors=actors)


def _stable(entries):
    require(type(entries) is list and 1 <= len(entries) <= MAX_ENTRIES, 'HANDOFF_INVALID_SNAPSHOT')
    result = []
    for entry in entries:
        require(type(entry) is dict and set(entry) == set(STABLE)|{'uid', 'ctime_ns'}, 'HANDOFF_INVALID_SNAPSHOT')
        _relative(entry['path'])
        require(entry['type'] in ('file', 'directory') and all(type(entry[k]) is int and entry[k] >= 0
                for k in ('device', 'inode', 'mode', 'uid', 'size'))
                and all(type(entry[k]) is int for k in ('mtime_ns', 'ctime_ns')), 'HANDOFF_INVALID_SNAPSHOT')
        result.append({k: entry[k] for k in STABLE})
    require(result[0]['path'] == '' and result[0]['type'] == 'directory'
            and [entry['path'] for entry in result] == sorted({entry['path'] for entry in result}),
            'HANDOFF_INVALID_SNAPSHOT')
    return result


def _observe(store, actor, request):
    request, root, output, old = _request(request)
    require(io.identifier(actor), 'HANDOFF_INVALID_REQUEST')
    with ExitStack() as stack:
        root_fd = stack.enter_context(io.opened(root, True))
        fence = stack.enter_context(store._authority.shared())
        runner_fd = stack.enter_context(io.opened(Path(str(store._authority.path)+'.runner.lock')))
        before = _context(store, actor, request, root, output, old, fence, runner_fd)
        base = dict(v=1, actor=actor, request=request, root_identity=io.identity(os.fstat(root_fd)), **before)
        budget = MAX_BYTES-len(io.encode(dict(base, inventory=[])))
        first = _walk(root, root_fd, budget)
        between = _context(store, actor, request, root, output, old, fence, runner_fd)
        second = _walk(root, root_fd, budget)
        after = _context(store, actor, request, root, output, old, fence, runner_fd)
        require(before == between == after and first == second, 'HANDOFF_CHANGED')
        require(_info(os.fstat(root_fd), '', second[0]['device']) == second[0], 'HANDOFF_CHANGED')
        result = dict(base, inventory=second)
        require(len(io.encode(result)) <= MAX_BYTES, 'HANDOFF_LIMIT')
    return result


def _run(store, actor, value, expected=None, capture=False):
    try:
        if capture:
            request, _, _, _ = _request(value)
            require(os.getuid() == request['source_uid'] and os.geteuid() == request['source_uid'],
                    'HANDOFF_SOURCE_UID')
            snapshot = _observe(store, actor, request)
            return dict(snapshot=snapshot, snapshot_digest=io.digest_record(snapshot))
        snapshot = _copy(value)
        require(set(snapshot) == SNAPSHOT and type(snapshot['v']) is int and snapshot['v'] == 1
                and snapshot['actor'] == actor and _digest(expected)
                and io.digest_record(snapshot) == expected, 'HANDOFF_SNAPSHOT_MISMATCH')
        _stable(snapshot['inventory'])
        request, _, _, _ = _request(snapshot['request'])
        require(all(entry['uid'] == request['source_uid'] for entry in snapshot['inventory'])
                and snapshot['root_identity'] == [snapshot['inventory'][0]['device'], snapshot['inventory'][0]['inode']],
                'HANDOFF_INVALID_SNAPSHOT')
        observed = _observe(store, actor, snapshot['request'])
        _target_ownership(snapshot['request']['target_uid'], observed['inventory'])
        require({k:v for k,v in snapshot.items() if k != 'inventory'}
                == {k:v for k,v in observed.items() if k != 'inventory'}
                and _stable(snapshot['inventory']) == _stable(observed['inventory']), 'HANDOFF_SNAPSHOT_CHANGED')
        return dict(status='ownership_observed', root=snapshot['request']['root'],
                    snapshot_digest=expected, actual_uid=os.getuid(), actual_euid=os.geteuid(),
                    target_uid=snapshot['request']['target_uid'],
                    entry_uids=sorted({entry['uid'] for entry in observed['inventory']}),
                    same_uid_control=snapshot['request']['source_uid'] == snapshot['request']['target_uid'],
                    entries_checked=len(observed['inventory']), original_pairs=observed['original_pairs'],
                    current_pairs=observed['current_pairs'], actors=observed['actors'])
    except RecoveryError:
        raise
    except AuthorityError as error:
        raise RecoveryError(error.code, retryable=error.retryable) from error
    except Refusal as error:
        raise RecoveryError(error.code) from error
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError, RecursionError,
            RuntimeError, profile.ProfileError) as error:
        raise RecoveryError('HANDOFF_UNCONFIRMED') from error


def capture_handoff_inventory(store, actor, request):
    """Observe source inventory; caller separately retains/pins the returned bytes."""
    return _run(store, actor, request, capture=True)


def verify_handoff_inventory(store, actor, snapshot, expected_snapshot_digest):
    """Observe requested current ownership without adoption, repair or durable writes."""
    return _run(store, actor, snapshot, expected_snapshot_digest)

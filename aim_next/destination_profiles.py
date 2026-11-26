from __future__ import annotations

"""Explicit cold profile artifacts; no runtime caller or consumer adoption (1327)."""

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import unicodedata

from . import profile, recovery_io as io
from .authority import AuthorityError

LIMIT = 262144
MANIFEST_LIMIT = LIMIT + 131072
PROFILE_FIELDS = {'v', 'instance_id', 'actor_id', 'db_path'} | profile.BINDING_FIELDS


def _historical(value):
    # Historical inaccessible paths are data, never resolve() or filesystem IO.
    io.require(type(value) is str and 0 < len(value.encode('utf-8')) <= 4096
               and '\x00' not in value and value.startswith('/') and os.path.normpath(value) == value,
               'PROFILES_INVALID_REQUEST')
    return Path(value)


def _snapshot(entry):
    io.require(type(entry) is dict and set(entry) == {'source_path', 'source_bytes', 'outbox_parent'},
               'PROFILES_INVALID_REQUEST')
    _historical(entry['source_path']); _historical(entry['outbox_parent'])
    raw = entry['source_bytes']
    io.require(type(raw) is str and len(raw.encode('utf-8')) <= profile.MAX_PROFILE_BYTES,
               'PROFILES_INVALID_REQUEST')
    value = json.loads(raw, object_pairs_hook=profile._unique)
    io.require(type(value) is dict and set(value) == PROFILE_FIELDS and type(value['v']) is int
               and value['v'] == 2 and all(profile._identity(value[k]) for k in
                                          ('instance_id', 'actor_id', 'authority_id', 'authority_epoch')),
               'PROFILES_INVALID_REQUEST')
    for key in ('db_path', 'authority_path'): _historical(value[key])
    actor = value['actor_id']
    io.require(actor not in ('.', '..') and '/' not in actor and '\\' not in actor
               and len(actor.encode('utf-8')) <= 180, 'PROFILES_INVALID_REQUEST')
    return value


def _disjoint(a, b):
    return not a.is_relative_to(b) and not b.is_relative_to(a)


def _request(value):
    try:
        io.require(type(value) is dict and set(value) ==
                   {'v', 'destination_root', 'output_dir', 'publication_digest', 'profiles'}
                   and type(value['v']) is int and value['v'] == 1
                   and len(io.encode(value)) <= LIMIT, 'PROFILES_INVALID_REQUEST')
        root, output = io.canonical(value['destination_root']), io.canonical(value['output_dir'])
        io.require(output.parent == root and output != root, 'PROFILES_INVALID_REQUEST')
        digest = value['publication_digest']
        io.require(type(digest) is str and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest),
                   'PROFILES_INVALID_REQUEST')
        entries = value['profiles']
        io.require(type(entries) is list and 1 <= len(entries) <= 16, 'PROFILES_INVALID_REQUEST')
        snapshots = [_snapshot(e) for e in entries]
        names, sources = set(), set()
        for entry, old in zip(entries, snapshots):
            actor = old['actor_id']; name = unicodedata.normalize('NFD', actor).casefold()
            io.require(name not in names and entry['source_path'] not in sources, 'PROFILES_INVALID_REQUEST')
            names.add(name); sources.add(entry['source_path'])
            for context in (Path(entry['source_path']).parent, Path(entry['outbox_parent']),
                            Path(old['db_path']), Path(old['authority_path'])):
                io.require(_disjoint(output, context), 'PROFILES_PATH_OVERLAP')
        # A private immutable copy prevents a caller mutating the request during IO.
        return json.loads(io.encode(value)), root, output, snapshots
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError, RuntimeError, profile.ProfileError) as error:
        raise io.RecoveryError('PROFILES_INVALID_REQUEST') from error


def _binding(store):
    return dict(store.binding, instance_id=store.instance_id, db_path=str(store.path))


def _profile_binding(binding):
    # profile_bytes preserves insertion order. Keep cold bytes stable across
    # independently started Python processes with different hash seeds.
    return {k: binding[k] for k in ('authority_path', 'authority_id', 'authority_epoch')}


def _receipt(receipt, request, store, record, snapshots):
    io.require(type(receipt) is dict and receipt.get('status') == 'published', 'PROFILES_NOT_CONFIRMED')
    io.require(receipt.get('durability_confirmed') is True, 'PROFILES_NOT_CONFIRMED')
    io.require(io.digest_record(receipt) == request['publication_digest'], 'PROFILES_RECEIPT_MISMATCH')
    lineage = record.get('recovery', {}).get('relocation')
    io.require(type(lineage) is dict and receipt.get('binding') == _binding(store), 'PROFILES_LINEAGE_MISMATCH')
    commit = receipt.get('cutover_commit')
    io.require(type(commit) is dict and type(commit.get('commit_seq')) is str
               and commit['commit_seq'].isascii() and commit['commit_seq'].isdigit()
               and type(commit.get('commit_id')) is str, 'PROFILES_LINEAGE_MISMATCH')
    io.require(all(receipt.get(k) == lineage.get(k) and k in lineage for k in
                   ('move_id', 'request_digest', 'journal_path'))
               and lineage.get('commit') == {'seq': commit['commit_seq'], 'id': commit['commit_id']},
               'PROFILES_LINEAGE_MISMATCH')
    predecessor = lineage.get('predecessor')
    io.require(type(predecessor) is dict, 'PROFILES_LINEAGE_MISMATCH')
    for old in snapshots:
        io.require(all(old[k] == predecessor.get(k) for k in
                       ('instance_id', 'db_path', 'authority_path', 'authority_id', 'authority_epoch')),
                   'PROFILES_PREDECESSOR_MISMATCH')
    return lineage


def _actors(store, snapshots):
    for old in snapshots:
        result = store.view(old['actor_id'], 'capabilities', {})
        io.require(not result.get('error') and result.get('instance_id') == store.instance_id
                   and isinstance(result.get('limits'), dict), 'PROFILES_ACTOR_UNAVAILABLE')


def _identities(store, fence, runner_fd):
    fence.verify()
    store._authority._verify_lock(runner_fd, '.runner.lock', 'runner_lock', fence.record)
    return {key: [fence.record[prefix+'_device'], fence.record[prefix+'_inode']]
            for key, prefix in (('database', 'db'), ('authority_lock', 'lock'), ('runner_lock', 'runner_lock'))}


def _layout(output, snapshots):
    return [(old, output/(old['actor_id']+'.profile.json'), output/(old['actor_id']+'.outbox'))
            for old in snapshots]


def _entry(old, path, outbox):
    io.require(not any(outbox.iterdir()), 'PROFILES_OUTPUT_CHANGED')
    with io.opened(path) as fd:
        io.require(os.fstat(fd).st_size <= profile.MAX_PROFILE_BYTES, 'PROFILES_OUTPUT_CHANGED')
        raw = os.read(fd, profile.MAX_PROFILE_BYTES+1)
    return dict(actor_id=old['actor_id'], profile=path.name, outbox=outbox.name,
                sha256=hashlib.sha256(raw).hexdigest(), mode=0o600,
                identity=io.identity(io.checked(path)), outbox_identity=io.identity(io.checked(outbox, True)))


def _observed(request, output, snapshots):
    manifest, _ = io.read_record(output/'manifest.json', MANIFEST_LIMIT)
    io.require(set(manifest) == {'v', 'request', 'publication_receipt', 'identities', 'entries'}
               and type(manifest['v']) is int and manifest['v'] == 1 and manifest['request'] == request
               and io.digest_record(manifest['publication_receipt']) == request['publication_digest'],
               'PROFILES_MANIFEST_CHANGED')
    binding = manifest['publication_receipt'].get('binding')
    io.require(type(binding) is dict and set(binding) ==
               {'instance_id', 'db_path', 'authority_path', 'authority_id', 'authority_epoch'},
               'PROFILES_MANIFEST_CHANGED')
    entries = []
    expected = {'manifest.json'}
    for old, path, outbox in _layout(output, snapshots):
        expected.update((path.name, outbox.name))
        with io.opened(path) as fd:
            raw = os.read(fd, profile.MAX_PROFILE_BYTES+1)
        wanted = profile.profile_bytes(binding['db_path'], binding['instance_id'], old['actor_id'],
                                       _profile_binding(binding))
        io.require(raw == wanted, 'PROFILES_OUTPUT_CHANGED')
        with io.opened(outbox, True): entries.append(_entry(old, path, outbox))
    io.require({p.name for _, p in zip(range(34), output.iterdir())} == expected
               and entries == manifest['entries'], 'PROFILES_OUTPUT_CHANGED')
    return manifest


def stage_destination_profiles(store, publication_receipt, request):
    """Stage once; an existing/partial folder is never retried or overwritten."""
    request, root, output, snapshots = _request(request)
    try:
        receipt = json.loads(io.encode(publication_receipt))
        with ExitStack() as stack:
            root_fd = stack.enter_context(io.opened(root, True))
            fence = stack.enter_context(store._authority.shared())
            runner = Path(str(store._authority.path)+'.runner.lock')
            runner_fd = stack.enter_context(io.opened(runner))
            identities = _identities(store, fence, runner_fd)
            _receipt(receipt, request, store, fence.record, snapshots)
            _actors(store, snapshots)
            for protected in (store.path, Path(str(store.path)+'.media'), store._authority.path,
                              Path(str(store._authority.path)+'.lock'), runner, Path(receipt['journal_path']).parent):
                io.require(_disjoint(output, protected), 'PROFILES_PATH_OVERLAP')
            io.require(not os.path.lexists(str(output)), 'PROFILES_OUTPUT_OCCUPIED')
            os.mkdir(output.name, 0o700, dir_fd=root_fd)
            output_fd = stack.enter_context(io.opened(output, True))
            entries = []
            for old, path, outbox in _layout(output, snapshots):
                io.require(io.identity(os.fstat(output_fd)) == io.identity(io.checked(output, True)),
                           'PROFILES_OUTPUT_CHANGED')
                profile.write_profile(path, store.path, store.instance_id, old['actor_id'], binding=_profile_binding(store.binding))
                profile.load_profile(path)
                io.flush_path(path)
                outbox.mkdir(mode=0o700)
                io.flush_path(outbox, True)
                entries.append(_entry(old, path, outbox))
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_identities(store, fence, runner_fd) == identities, 'PROFILES_AUTHORITY_CHANGED')
            _receipt(receipt, request, store, fence.record, snapshots); _actors(store, snapshots)
            manifest = dict(v=1, request=request, publication_receipt=receipt, identities=identities, entries=entries)
            io.write_record(output/'manifest.json', manifest, MANIFEST_LIMIT)
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_observed(request, output, snapshots) == manifest, 'PROFILES_OUTPUT_CHANGED')
            io.require(_identities(store, fence, runner_fd) == identities, 'PROFILES_AUTHORITY_CHANGED')
        return dict(status='profiles_staged', durability_confirmed=True, output_dir=str(output),
                    manifest_path=str(output/'manifest.json'), profiles=entries)
    except (io.RecoveryError, AuthorityError):
        raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, profile.ProfileError) as error:
        raise io.RecoveryError('PROFILES_UNCONFIRMED') from error


def inspect_destination_profiles(request):
    """Observe retained artifacts only; no authority access, creation or flush."""
    request, root, output, snapshots = _request(request)
    try:
        with io.opened(root, True):
            result = dict(status='not_started', durability_confirmed=False, output_dir=str(output))
            if not os.path.lexists(str(output)): return result
            with io.opened(output, True):
                result['status'] = 'profiles_incomplete'
                if not os.path.lexists(str(output/'manifest.json')): return result
                manifest = _observed(request, output, snapshots)
                result.update(status='profiles_observed', profiles=manifest['entries'])
            return result
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        raise io.RecoveryError('PROFILES_UNCONFIRMED') from error

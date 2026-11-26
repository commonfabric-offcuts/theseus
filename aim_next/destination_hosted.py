from __future__ import annotations

"""Dormant cold hosted artifacts, never route/control/plan adoption (1329)."""

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import sqlite3

from . import broker_routes as routes, destination_profiles as profiles, profile, recovery_io as io, route_pins
from .contract import StoreError
from .store import _connect

REQUEST_LIMIT = 2 * 1024 * 1024
MANIFEST_LIMIT = 4 * 1024 * 1024


def _shape(raw):
    io.require(type(raw) is str and len(raw.encode('utf-8')) <= 65536, 'HOSTED_INVALID_REQUEST')
    value = json.loads(raw, object_pairs_hook=io._pairs, parse_constant=io._constant)
    io.require(type(value) is dict and type(value.get('v')) is int and
               ((value['v'] == 1 and set(value) == routes.HOSTED_FIELDS) or
                (value['v'] == 2 and set(value) == routes.HOSTED_V2_FIELDS))
               and value['kind'] == route_pins.HOSTED_KIND
               and profile._identity(value['actor_id']), 'HOSTED_INVALID_REQUEST')
    for key in ('profile', 'cli', 'codex_executable', 'codex_home', 'cwd'): profiles._historical(value[key])
    route_pins._destination(_destination(value), resolve_root=False)
    io.require(value['model'] is None or (profile._identity(value['model']) and value['model'].isprintable()),
               'HOSTED_INVALID_REQUEST')
    routes.hosted_options(value.get('permission_mode', 'workspace'), value.get('reasoning_effort'),
                          value.get('instructions', ''))
    io.require(type(value['writable_roots']) is list and len(value['writable_roots']) == 2
               and all(type(p) is str for p in value['writable_roots']), 'HOSTED_INVALID_REQUEST')
    return value


def _destination(config):
    return dict(kind=config['kind'], protocol_version=1, codex_home=config['codex_home'], thread_id=config['thread_id'])


def _same_actor(config, actor):
    io.require(config['actor_id'] == actor, 'HOSTED_ACTOR_MISMATCH')


def _same_destination(config, pin):
    io.require(_destination(config) == pin['destination'], 'HOSTED_DESTINATION_MISMATCH')


def _request(value):
    try:
        io.require(type(value) is dict and set(value) == {'v', 'output_root', 'output_dir', 'profiles_request',
                   'profiles_result', 'profiles_manifest_bytes', 'profiles_manifest_digest', 'actors'}
                   and type(value['v']) is int and value['v'] == 1 and len(io.encode(value)) <= REQUEST_LIMIT,
                   'HOSTED_INVALID_REQUEST')
        request = json.loads(io.encode(value))
        root, output = io.canonical(request['output_root']), io.canonical(request['output_dir'])
        io.require(output.parent == root and root != output, 'HOSTED_INVALID_REQUEST')
        pr, _, pout, snapshots = profiles._request(request['profiles_request'])
        result = request['profiles_result']
        io.require(type(result) is dict and set(result) ==
                   {'status', 'durability_confirmed', 'output_dir', 'manifest_path', 'profiles'}
                   and result['status'] == 'profiles_staged' and result['durability_confirmed'] is True
                   and result['output_dir'] == str(pout) and result['manifest_path'] == str(pout/'manifest.json'),
                   'HOSTED_PROFILES_UNCONFIRMED')
        raw = request['profiles_manifest_bytes']; digest = request['profiles_manifest_digest']
        io.require(type(raw) is str and len(raw.encode('utf-8')) <= profiles.MANIFEST_LIMIT
                   and type(digest) is str and hashlib.sha256(raw.encode('utf-8')).hexdigest() == digest,
                   'HOSTED_MANIFEST_MISMATCH')
        rows = request['actors']; by_actor = {s['actor_id']: s for s in snapshots}; seen = set(); sources = set()
        io.require(type(rows) is list and 1 <= len(rows) <= 16, 'HOSTED_INVALID_REQUEST')
        configs = []
        for row in rows:
            io.require(type(row) is dict and set(row) == {'actor_id', 'source_path', 'source_bytes', 'cli'}
                       and type(row['actor_id']) is str and row['actor_id'] in by_actor
                       and row['actor_id'] not in seen, 'HOSTED_INVALID_REQUEST')
            seen.add(row['actor_id']); profiles._historical(row['source_path'])
            io.require(row['source_path'] not in sources, 'HOSTED_INVALID_REQUEST'); sources.add(row['source_path'])
            io.require(str(io.canonical(row['cli'])) == routes._executable(row['cli']), 'HOSTED_INVALID_REQUEST')
            configs.append(_shape(row['source_bytes']))
        return request, root, output, pr, pout, by_actor, configs
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('HOSTED_INVALID_REQUEST') from error


def _profile_evidence(request, pr, pout):
    observed = profiles.inspect_destination_profiles(pr)
    io.require(observed['status'] == 'profiles_observed', 'HOSTED_PROFILES_UNCONFIRMED')
    manifest, digest = io.read_record(pout/'manifest.json', profiles.MANIFEST_LIMIT)
    io.require(digest == request['profiles_manifest_digest']
               and manifest == json.loads(request['profiles_manifest_bytes'], object_pairs_hook=io._pairs)
               and observed['profiles'] == manifest['entries'] == request['profiles_result']['profiles'],
               'HOSTED_MANIFEST_MISMATCH')
    return manifest


def _current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd):
    identities = profiles._identities(store, fence, runner_fd)
    io.require(identities == manifest['identities'] and manifest['publication_receipt'] == receipt,
               'HOSTED_AUTHORITY_CHANGED')
    profiles._receipt(receipt, pr, store, fence.record, list(snapshots.values()))
    selected = [snapshots[row['actor_id']] for row in request['actors']]
    profiles._actors(store, selected)
    return identities


def _pins(store, fence, request):
    # Only CURRENT DB; predecessor paths are key data, never filesystem input.
    lineage = fence.record['recovery']['relocation']; predecessor = lineage['predecessor']
    db = None
    try:
        db, _ = _connect(store.path); db.execute('BEGIN'); fence.verify(); store._check_instance(db)
        result = {}
        for row in request['actors']:
            actor = row['actor_id']; store._pin_actor(db, actor)
            binding = {k: predecessor[k] for k in route_pins.BINDING_FIELDS if k != 'actor_id'}
            binding['actor_id'] = actor
            pin = route_pins._stored(db, route_pins._key(binding))
            io.require(pin is not None and pin['binding'] == binding, 'HOSTED_PREDECESSOR_PIN_MISSING')
            result[actor] = pin
        fence.verify(); return result
    finally:
        if db is not None:
            try: db.close()
            except BaseException as error: raise io.RecoveryError('HOSTED_UNCONFIRMED') from error


def _documents(request, pout, snapshots, configs, manifest, pins):
    entries = {e['actor_id']: e for e in manifest['entries']}; documents = {}; mapping = {}
    binding = manifest['publication_receipt']['binding']
    for row, original in zip(request['actors'], configs):
        actor = row['actor_id']; old = snapshots[actor]
        context = next(e for e in request['profiles_request']['profiles'] if json.loads(e['source_bytes'])['actor_id'] == actor)
        _same_actor(original, actor); _same_destination(original, pins[actor])
        io.require(original['profile'] == context['source_path'], 'HOSTED_PROFILE_MISMATCH')
        old_roots = [str(Path(old['db_path']).parent), str(Path(context['source_path']).parent/(actor+'.outbox'))]
        io.require(set(original['writable_roots']) == set(old_roots), 'HOSTED_ROOTS_MISMATCH')
        selected = pout/entries[actor]['profile']
        current = profile.Profile(binding['instance_id'], actor, Path(binding['db_path']), Path(binding['authority_path']),
                                  binding['authority_id'], binding['authority_epoch'])
        config = dict(original, profile=str(selected), cli=row['cli'], writable_roots=list(routes.writable_roots(str(selected), current)))
        name = actor+'.hosted.json'; documents[name] = config; mapping[actor] = str(Path(request['output_dir'])/name)
    documents['routes.json'] = dict(v=1, routes=mapping)
    return documents


def _files(output, documents):
    result = {}
    for name, value in documents.items():
        path = output/name
        with io.opened(path) as fd:
            io.require(os.fstat(fd).st_size <= 65536, 'HOSTED_OUTPUT_CHANGED')
            raw = os.read(fd, 65537)
            io.require(raw == io.encode(value), 'HOSTED_OUTPUT_CHANGED')
            result[name] = dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                                mode=0o600, identity=io.identity(os.fstat(fd)))
    return result


def _observed(request, output, pr, pout, snapshots, configs):
    saved, _ = io.read_record(output/'manifest.json', MANIFEST_LIMIT)
    io.require(set(saved) == {'v', 'request', 'publication_receipt', 'profiles_manifest', 'identities', 'pins', 'files'}
               and type(saved['v']) is int and saved['v'] == 1 and saved['request'] == request,
               'HOSTED_OUTPUT_CHANGED')
    manifest = _profile_evidence(request, pr, pout)
    io.require(saved['profiles_manifest'] == manifest and saved['publication_receipt'] == manifest['publication_receipt']
               and saved['identities'] == manifest['identities'], 'HOSTED_MANIFEST_MISMATCH')
    documents = _documents(request, pout, snapshots, configs, manifest, saved['pins'])
    io.require(_files(output, documents) == saved['files']
               and {p.name for _, p in zip(range(19), output.iterdir())} == set(documents)|{'manifest.json'},
               'HOSTED_OUTPUT_CHANGED')
    return saved


def stage_destination_hosted(store, publication_receipt, request):
    request, root, output, pr, pout, snapshots, configs = _request(request)
    try:
        receipt = json.loads(io.encode(publication_receipt))
        with ExitStack() as stack:
            root_fd = stack.enter_context(io.opened(root, True)); fence = stack.enter_context(store._authority.shared())
            runner = Path(str(store._authority.path)+'.runner.lock'); runner_fd = stack.enter_context(io.opened(runner))
            manifest = _profile_evidence(request, pr, pout)
            identities = _current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd)
            pins = _pins(store, fence, request)
            documents = _documents(request, pout, snapshots, configs, manifest, pins)
            protected = [pout, store.path, Path(str(store.path)+'.media'), store._authority.path,
                         Path(str(store._authority.path)+'.lock'), runner, Path(receipt['journal_path']).parent]
            for context in pr['profiles']:
                protected.extend((Path(context['source_path']).parent, Path(context['outbox_parent'])))
            for row, config in zip(request['actors'], configs):
                protected.extend((Path(row['source_path']).parent, Path(config['codex_home']), Path(config['cwd'])))
            io.require(all(profiles._disjoint(output, path) for path in protected), 'HOSTED_PATH_OVERLAP')
            io.require(not os.path.lexists(str(output)), 'HOSTED_OUTPUT_OCCUPIED')
            os.mkdir(output.name, 0o700, dir_fd=root_fd); output_fd = stack.enter_context(io.opened(output, True))
            for name, value in documents.items():
                io.require(io.identity(os.fstat(output_fd)) == io.identity(io.checked(output, True)), 'HOSTED_OUTPUT_CHANGED')
                io.write_record(output/name, value)
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd) == identities
                       and _profile_evidence(request, pr, pout) == manifest and _pins(store, fence, request) == pins,
                       'HOSTED_INPUT_CHANGED')
            saved = dict(v=1, request=request, publication_receipt=receipt, profiles_manifest=manifest,
                         identities=identities, pins=pins, files=_files(output, documents))
            io.write_record(output/'manifest.json', saved, MANIFEST_LIMIT)
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_observed(request, output, pr, pout, snapshots, configs) == saved, 'HOSTED_OUTPUT_CHANGED')
            io.require(_current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd) == identities
                       and _profile_evidence(request, pr, pout) == manifest and _pins(store, fence, request) == pins,
                       'HOSTED_INPUT_CHANGED')
        return dict(status='cold_hosted_staged', durability_confirmed=True, requires_adoption=True,
                    output_dir=str(output), manifest_path=str(output/'manifest.json'), files=saved['files'])
    except StoreError: raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('HOSTED_UNCONFIRMED') from error


def inspect_destination_hosted(request):
    request, root, output, pr, pout, snapshots, configs = _request(request)
    try:
        with io.opened(root, True):
            result = dict(status='not_started', durability_confirmed=False, requires_adoption=True, output_dir=str(output))
            if not os.path.lexists(str(output)): return result
            with io.opened(output, True):
                result['status'] = 'hosted_incomplete'
                if not os.path.lexists(str(output/'manifest.json')): return result
                observed = _observed(request, output, pr, pout, snapshots, configs)
                result.update(status='cold_hosted_observed', files=observed['files'])
            return result
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('HOSTED_UNCONFIRMED') from error

from __future__ import annotations

"""Dormant cold broker artifacts, never route/control/plan adoption (1331)."""

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


def _json_snapshot(raw):
    io.require(type(raw) is str and len(raw.encode('utf-8')) <= 65536, 'BROKER_INVALID_REQUEST')
    value = json.loads(raw, object_pairs_hook=io._pairs, parse_constant=io._constant)
    io.require(type(value) is dict and type(value.get('v')) is int and value['v'] == 1,
               'BROKER_INVALID_REQUEST')
    return value


def _shape(route_raw, config_raw, config_path):
    route, config = _json_snapshot(route_raw), _json_snapshot(config_raw)
    io.require(set(route) == {'v', 'profile', 'argv'} and
               set(config) == {'v', 'profile', 'codex_executable', 'destination'}, 'BROKER_INVALID_REQUEST')
    for value in (route['profile'], config['profile'], config['codex_executable']): profiles._historical(value)
    argv = route['argv']
    io.require(type(argv) is list and len(argv) == 3 and argv[1] == '--config'
               and argv[2] == config_path, 'BROKER_INVALID_ARGV')
    profiles._historical(argv[0]); profiles._historical(argv[2])
    destination = route_pins._destination(config['destination'], resolve_root=False)
    io.require(destination['kind'] == route_pins.QUEUE_KIND, 'BROKER_INVALID_REQUEST')
    return route, config


def _same_actor(route, config, source_profile):
    io.require(route['profile'] == config['profile'] == source_profile, 'BROKER_ACTOR_MISMATCH')


def _same_destination(config, pin):
    io.require(config['destination'] == pin['destination'], 'BROKER_DESTINATION_MISMATCH')


def _pin_context(pins, snapshots, actors):
    io.require(type(pins) is dict and set(pins) == set(actors), 'BROKER_PIN_MISMATCH')
    for actor in actors:
        pin = pins[actor]
        io.require(type(pin) is dict and set(pin) == {'v', 'binding', 'destination'} and
                   type(pin['v']) is int and pin['v'] == 1 and
                   pin['binding'] == {k: snapshots[actor][k] for k in route_pins.BINDING_FIELDS},
                   'BROKER_PIN_MISMATCH')
        io.require(route_pins._destination(pin['destination'], resolve_root=False)['kind'] == route_pins.QUEUE_KIND,
                   'BROKER_PIN_MISMATCH')

def _request(value):
    try:
        io.require(type(value) is dict and set(value) == {'v', 'output_root', 'output_dir', 'profiles_request',
                   'profiles_result', 'profiles_manifest_bytes', 'profiles_manifest_digest', 'actors'}
                   and type(value['v']) is int and value['v'] == 1 and len(io.encode(value)) <= REQUEST_LIMIT,
                   'BROKER_INVALID_REQUEST')
        request = json.loads(io.encode(value))
        root, output = io.canonical(request['output_root']), io.canonical(request['output_dir'])
        io.require(output.parent == root and root != output, 'BROKER_INVALID_REQUEST')
        pr, _, pout, snapshots = profiles._request(request['profiles_request'])
        result = request['profiles_result']
        io.require(type(result) is dict and set(result) ==
                   {'status', 'durability_confirmed', 'output_dir', 'manifest_path', 'profiles'}
                   and result['status'] == 'profiles_staged' and result['durability_confirmed'] is True
                   and result['output_dir'] == str(pout) and result['manifest_path'] == str(pout/'manifest.json'),
                   'BROKER_PROFILES_UNCONFIRMED')
        raw, digest = request['profiles_manifest_bytes'], request['profiles_manifest_digest']
        io.require(type(raw) is str and len(raw.encode('utf-8')) <= profiles.MANIFEST_LIMIT
                   and type(digest) is str and hashlib.sha256(raw.encode('utf-8')).hexdigest() == digest,
                   'BROKER_MANIFEST_MISMATCH')
        rows = request['actors']; by_actor = {s['actor_id']: s for s in snapshots}; seen = set(); sources = set()
        io.require(type(rows) is list and 1 <= len(rows) <= 16, 'BROKER_INVALID_REQUEST')
        configs = []
        for row in rows:
            io.require(type(row) is dict and set(row) == {'actor_id', 'source_route_path', 'source_route_bytes',
                       'source_config_path', 'source_config_bytes', 'broker_executable'} and
                       type(row['actor_id']) is str and row['actor_id'] in by_actor and row['actor_id'] not in seen,
                       'BROKER_INVALID_REQUEST')
            seen.add(row['actor_id'])
            for key in ('source_route_path', 'source_config_path'):
                profiles._historical(row[key]); io.require(row[key] not in sources, 'BROKER_INVALID_REQUEST')
                sources.add(row[key])
            io.require(str(io.canonical(row['broker_executable'])) == routes._executable(row['broker_executable']),
                       'BROKER_INVALID_REQUEST')
            configs.append(_shape(row['source_route_bytes'], row['source_config_bytes'], row['source_config_path']))
        return request, root, output, pr, pout, by_actor, configs
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('BROKER_INVALID_REQUEST') from error

def _profile_evidence(request, pr, pout):
    observed = profiles.inspect_destination_profiles(pr)
    io.require(observed['status'] == 'profiles_observed', 'BROKER_PROFILES_UNCONFIRMED')
    manifest, digest = io.read_record(pout/'manifest.json', profiles.MANIFEST_LIMIT)
    io.require(digest == request['profiles_manifest_digest']
               and manifest == json.loads(request['profiles_manifest_bytes'], object_pairs_hook=io._pairs)
               and observed['profiles'] == manifest['entries'] == request['profiles_result']['profiles'],
               'BROKER_MANIFEST_MISMATCH')
    return manifest


def _current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd):
    identities = profiles._identities(store, fence, runner_fd)
    io.require(identities == manifest['identities'] and manifest['publication_receipt'] == receipt,
               'BROKER_AUTHORITY_CHANGED')
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
            io.require(pin is not None and pin['binding'] == binding, 'BROKER_PREDECESSOR_PIN_MISSING')
            result[actor] = pin
        fence.verify(); return result
    finally:
        if db is not None:
            try: db.close()
            except BaseException as error: raise io.RecoveryError('BROKER_UNCONFIRMED') from error


def _documents(request, pout, snapshots, configs, manifest, pins):
    entries = {e['actor_id']: e for e in manifest['entries']}; documents = {}; mapping = {}; destinations = set()
    _pin_context(pins, snapshots, [row['actor_id'] for row in request['actors']])
    for row, (route, config) in zip(request['actors'], configs):
        actor = row['actor_id']
        context = next(e for e in request['profiles_request']['profiles'] if json.loads(e['source_bytes'])['actor_id'] == actor)
        _same_actor(route, config, context['source_path']); _same_destination(config, pins[actor])
        destination = (config['destination']['codex_home'], config['destination']['thread_id'])
        io.require(destination not in destinations, 'BROKER_DUPLICATE_DESTINATION'); destinations.add(destination)
        selected = str(pout/entries[actor]['profile']); name = actor+'.broker.json'; wrapper = actor+'.route.json'
        documents[name] = dict(config, profile=selected)
        documents[wrapper] = dict(v=1, profile=selected, argv=[row['broker_executable'], '--config',
                                                            str(Path(request['output_dir'])/name)])
        mapping[actor] = str(Path(request['output_dir'])/wrapper)
    documents['routes.json'] = dict(v=1, routes=mapping)
    io.require(all(len(io.encode(value)) <= 65536 for value in documents.values()), 'BROKER_OUTPUT_TOO_LARGE')
    return documents

def _files(output, documents):
    result = {}
    for name, value in documents.items():
        path = output/name
        with io.opened(path) as fd:
            io.require(os.fstat(fd).st_size <= 65536, 'BROKER_OUTPUT_CHANGED')
            raw = os.read(fd, 65537)
            io.require(raw == io.encode(value), 'BROKER_OUTPUT_CHANGED')
            result[name] = dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                                mode=0o600, identity=io.identity(os.fstat(fd)))
    return result


def _observed(request, output, pr, pout, snapshots, configs):
    saved, _ = io.read_record(output/'manifest.json', MANIFEST_LIMIT)
    io.require(set(saved) == {'v', 'request', 'publication_receipt', 'profiles_manifest', 'identities', 'pins', 'files'}
               and type(saved['v']) is int and saved['v'] == 1 and saved['request'] == request,
               'BROKER_OUTPUT_CHANGED')
    manifest = _profile_evidence(request, pr, pout)
    io.require(saved['profiles_manifest'] == manifest and saved['publication_receipt'] == manifest['publication_receipt']
               and saved['identities'] == manifest['identities'], 'BROKER_MANIFEST_MISMATCH')
    documents = _documents(request, pout, snapshots, configs, manifest, saved['pins'])
    io.require(_files(output, documents) == saved['files']
               and {p.name for _, p in zip(range(35), output.iterdir())} == set(documents)|{'manifest.json'},
               'BROKER_OUTPUT_CHANGED')
    return saved


def stage_destination_broker(store, publication_receipt, request):
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
            for row, (_, config) in zip(request['actors'], configs):
                protected.extend((Path(row['source_route_path']).parent, Path(row['source_config_path']).parent,
                                  Path(config['destination']['codex_home'])))
            io.require(all(profiles._disjoint(output, path) for path in protected), 'BROKER_PATH_OVERLAP')
            io.require(not os.path.lexists(str(output)), 'BROKER_OUTPUT_OCCUPIED')
            os.mkdir(output.name, 0o700, dir_fd=root_fd); output_fd = stack.enter_context(io.opened(output, True))
            for name, value in documents.items():
                io.require(io.identity(os.fstat(output_fd)) == io.identity(io.checked(output, True)), 'BROKER_OUTPUT_CHANGED')
                io.write_record(output/name, value)
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd) == identities
                       and _profile_evidence(request, pr, pout) == manifest and _pins(store, fence, request) == pins,
                       'BROKER_INPUT_CHANGED')
            saved = dict(v=1, request=request, publication_receipt=receipt, profiles_manifest=manifest,
                         identities=identities, pins=pins, files=_files(output, documents))
            io.write_record(output/'manifest.json', saved, MANIFEST_LIMIT)
            io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_observed(request, output, pr, pout, snapshots, configs) == saved, 'BROKER_OUTPUT_CHANGED')
            io.require(_current(store, receipt, request, pr, snapshots, manifest, fence, runner_fd) == identities
                       and _profile_evidence(request, pr, pout) == manifest and _pins(store, fence, request) == pins,
                       'BROKER_INPUT_CHANGED')
        return dict(status='cold_broker_staged', durability_confirmed=True, requires_adoption=True,
                    output_dir=str(output), manifest_path=str(output/'manifest.json'), files=saved['files'])
    except StoreError: raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('BROKER_UNCONFIRMED') from error


def inspect_destination_broker(request):
    request, root, output, pr, pout, snapshots, configs = _request(request)
    try:
        with io.opened(root, True):
            result = dict(status='not_started', durability_confirmed=False, requires_adoption=True, output_dir=str(output))
            if not os.path.lexists(str(output)): return result
            with io.opened(output, True):
                result['status'] = 'broker_incomplete'
                if not os.path.lexists(str(output/'manifest.json')): return result
                observed = _observed(request, output, pr, pout, snapshots, configs)
                result.update(status='cold_broker_observed', files=observed['files'])
            return result
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error,
            profile.ProfileError, routes.BrokerConfigError) as error:
        raise io.RecoveryError('BROKER_UNCONFIRMED') from error

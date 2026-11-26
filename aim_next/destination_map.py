from __future__ import annotations

"""Dormant declared mixed-map data, never selection/adoption/start (1333)."""

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

from . import destination_broker as broker, destination_hosted as hosted
from . import destination_profiles as profiles, profile, recovery_io as io
from .contract import StoreError

REQUEST_LIMIT = 8 * 1024 * 1024
MANIFEST_LIMIT = 16 * 1024 * 1024
MAP_LIMIT = 131072
DESCRIPTOR_RESERVE = 65536
PARENTS = {'hosted': hosted, 'broker': broker}
MANIFEST_FIELDS = {'v', 'request', 'publication_receipt', 'profiles_manifest', 'hosted_manifest',
                   'broker_manifest', 'identities', 'pins', 'coverage', 'destinations', 'directories', 'files'}


def _decode(raw, limit):
    io.require(type(raw) is str and 0 < len(raw.encode('utf-8')) <= limit, 'MAP_INVALID_REQUEST')
    return json.loads(raw, object_pairs_hook=io._pairs, parse_constant=io._constant)


def _request(value):
    try:
        io.require(type(value) is dict and set(value) == {'v', 'output_root', 'output_dir', 'source_map_path',
                   'source_map_bytes', 'source_map_digest', 'hosted', 'broker'} and type(value['v']) is int
                   and value['v'] == 1 and len(io.encode(value)) <= REQUEST_LIMIT, 'MAP_INVALID_REQUEST')
        request = json.loads(io.encode(value)); root = io.canonical(request['output_root']); output = io.canonical(request['output_dir'])
        io.require(output.parent == root and output != root, 'MAP_INVALID_REQUEST')
        profiles._historical(request['source_map_path'])
        source = _decode(request['source_map_bytes'], MAP_LIMIT)
        io.require(type(request['source_map_digest']) is str and hashlib.sha256(request['source_map_bytes'].encode()).hexdigest()
                   == request['source_map_digest'], 'MAP_PROVENANCE_MISMATCH')
        io.require(type(source) is dict and set(source) == {'v', 'routes'} and type(source['v']) is int and source['v'] == 1
                   and type(source['routes']) is dict and 2 <= len(source['routes']) <= 16, 'MAP_INVALID_REQUEST')
        for actor, path in source['routes'].items():
            io.require(type(actor) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,199}', actor), 'MAP_INVALID_REQUEST')
            profiles._historical(path)
        io.require(len(set(source['routes'].values())) == len(source['routes']), 'MAP_INVALID_REQUEST')
        contexts = {}
        for kind, module in PARENTS.items():
            evidence = request[kind]
            io.require(type(evidence) is dict and set(evidence) == {'request', 'result', 'manifest_bytes', 'manifest_digest'}, 'MAP_INVALID_REQUEST')
            parsed = module._request(evidence['request']); result = evidence['result']; out = parsed[2]
            io.require(type(result) is dict and set(result) == {'status', 'durability_confirmed', 'requires_adoption', 'output_dir', 'manifest_path', 'files'}
                       and result['status'] == 'cold_'+kind+'_staged' and result['durability_confirmed'] is True and result['requires_adoption'] is True
                       and result['output_dir'] == str(out) and result['manifest_path'] == str(out/'manifest.json'), 'MAP_DEPENDENCY_UNCONFIRMED')
            _decode(evidence['manifest_bytes'], module.MANIFEST_LIMIT)
            io.require(type(evidence['manifest_digest']) is str and hashlib.sha256(evidence['manifest_bytes'].encode()).hexdigest()
                       == evidence['manifest_digest'], 'MAP_PROVENANCE_MISMATCH')
            contexts[kind] = parsed
        h, b = contexts['hosted'][0], contexts['broker'][0]
        io.require(all(h[key] == b[key] for key in ('profiles_request', 'profiles_result', 'profiles_manifest_bytes', 'profiles_manifest_digest')),
                   'MAP_PROVENANCE_MISMATCH')
        return request, root, output, source, contexts
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError) as error:
        raise io.RecoveryError('MAP_INVALID_REQUEST') from error


def _artifacts(request, contexts):
    result = {}
    for kind, module in PARENTS.items():
        r, _, output, pr, pout, snapshots, configs = contexts[kind]
        observed = getattr(module, 'inspect_destination_'+kind)(r)
        io.require(observed['status'] == 'cold_'+kind+'_observed', 'MAP_DEPENDENCY_UNCONFIRMED')
        saved = module._observed(r, output, pr, pout, snapshots, configs)
        raw, digest = io.read_record(output/'manifest.json', module.MANIFEST_LIMIT)
        io.require(raw == saved == _decode(request[kind]['manifest_bytes'], module.MANIFEST_LIMIT)
                   and digest == request[kind]['manifest_digest']
                   and observed['files'] == saved['files'] == request[kind]['result']['files'], 'MAP_PROVENANCE_MISMATCH')
        result[kind] = saved
    h, b = result['hosted'], result['broker']
    io.require(all(h[key] == b[key] for key in ('profiles_manifest', 'publication_receipt', 'identities')), 'MAP_PROVENANCE_MISMATCH')
    return result


def _require_coverage(source, contexts):
    h, b = contexts['hosted'], contexts['broker']
    hs, bs = {r['actor_id'] for r in h[0]['actors']}, {r['actor_id'] for r in b[0]['actors']}
    io.require(hs and bs and not hs & bs and hs | bs == set(source['routes']) == set(h[5]), 'MAP_COVERAGE_MISMATCH')
    for kind, context in contexts.items():
        for row in context[0]['actors']:
            key = 'source_path' if kind == 'hosted' else 'source_route_path'
            io.require(source['routes'].get(row['actor_id']) == row[key], 'MAP_COVERAGE_MISMATCH')


def _require_unique_destinations(entries):
    tuples = [(e['destination']['codex_home'], e['destination']['thread_id']) for e in entries.values()]
    io.require(len(set(tuples)) == len(tuples)
               and len({e['route'] for e in entries.values()}) == len(entries)
               and len({e['config'] for e in entries.values()}) == len(entries), 'MAP_DESTINATION_CONFLICT')


def _documents(source, contexts, artifacts):
    _require_coverage(source, contexts)
    routes, entries = {}, {}
    for kind, module in PARENTS.items():
        r, _, _, _, pout, snapshots, configs = contexts[kind]; saved = artifacts[kind]
        documents = module._documents(r, pout, snapshots, configs, saved['profiles_manifest'], saved['pins'])
        for row in r['actors']:
            actor = row['actor_id']; route = documents['routes.json']['routes'][actor]
            config_path = route if kind == 'hosted' else documents[actor+'.route.json']['argv'][2]
            config = documents[Path(config_path).name]
            destination = hosted._destination(config) if kind == 'hosted' else config['destination']
            profiles._historical(route); profiles._historical(config_path)
            routes[actor] = route; entries[actor] = dict(kind=kind, route=route, config=config_path, destination=destination)
    _require_unique_destinations(entries)
    document = dict(v=1, routes=routes)
    io.require(len(io.encode(document)) <= MAP_LIMIT, 'MAP_OUTPUT_TOO_LARGE')
    coverage = dict(source=source, partitions={k: [r['actor_id'] for r in c[0]['actors']] for k, c in contexts.items()}, routes=routes)
    return document, coverage, entries


def _current(store, receipt, contexts, artifacts, fence, runner_fd):
    identities, pins = None, {}
    for kind, module in PARENTS.items():
        r, _, _, pr, _, snapshots, _ = contexts[kind]; saved = artifacts[kind]
        current = module._current(store, receipt, r, pr, snapshots, saved['profiles_manifest'], fence, runner_fd)
        io.require(current == saved['identities'] and (identities is None or current == identities), 'MAP_INPUT_CHANGED')
        pins[kind] = module._pins(store, fence, r)
        io.require(pins[kind] == saved['pins'], 'MAP_INPUT_CHANGED'); identities = current
    return identities, pins


def _base(request, source, contexts, artifacts):
    document, coverage, destinations = _documents(source, contexts, artifacts); h = artifacts['hosted']
    return document, dict(v=1, request=request, publication_receipt=h['publication_receipt'], profiles_manifest=h['profiles_manifest'],
                         hosted_manifest=h, broker_manifest=artifacts['broker'], identities=h['identities'],
                         pins={k: v['pins'] for k, v in artifacts.items()}, coverage=coverage, destinations=destinations)


def _descriptors(root, output, document):
    path = output/'routes.json'
    with io.opened(path) as fd:
        facts = os.fstat(fd); io.require(facts.st_size <= MAP_LIMIT, 'MAP_OUTPUT_CHANGED')
        raw = os.read(fd, MAP_LIMIT+1)
        io.require(raw == io.encode(document), 'MAP_OUTPUT_CHANGED')
        files = {'routes.json': dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), mode=0o600, identity=io.identity(facts))}
    return dict(directories={'root': io.identity(io.checked(root, True)), 'output': io.identity(io.checked(output, True))}, files=files)


def _protected(store, receipt, request, contexts):
    result = [store.path, Path(str(store.path)+'.media'), store._authority.path, Path(str(store._authority.path)+'.lock'),
              Path(str(store._authority.path)+'.runner.lock'), Path(receipt['journal_path']).parent, Path(request['source_map_path']).parent]
    for kind, context in contexts.items():
        r, _, out, pr, pout, _, configs = context; result.extend((out, pout))
        for row in pr['profiles']:result.extend((Path(row['source_path']).parent, Path(row['outbox_parent'])))
        for row, config in zip(r['actors'], configs):
            if kind == 'hosted':result.extend((Path(row['source_path']).parent, Path(config['codex_home']), Path(config['cwd'])))
            else:result.extend((Path(row['source_route_path']).parent, Path(row['source_config_path']).parent, Path(config[1]['destination']['codex_home'])))
    return result


def _observed(request, root, output, source, contexts):
    saved, _ = io.read_record(output/'manifest.json', MANIFEST_LIMIT)
    io.require(set(saved) == MANIFEST_FIELDS and type(saved['v']) is int and saved['v'] == 1 and saved['request'] == request, 'MAP_OUTPUT_CHANGED')
    artifacts = _artifacts(request, contexts); document, immutable = _base(request, source, contexts, artifacts)
    descriptors = _descriptors(root, output, document)
    io.require(saved == dict(immutable, **descriptors)
               and {v.name for _, v in zip(range(4), output.iterdir())} == {'routes.json', 'manifest.json'}, 'MAP_OUTPUT_CHANGED')
    return saved, document


def stage_destination_map(store, publication_receipt, request):
    request, root, output, source, contexts = _request(request)
    try:
        receipt = json.loads(io.encode(publication_receipt))
        with ExitStack() as stack:
            root_fd = stack.enter_context(io.opened(root, True)); fence = stack.enter_context(store._authority.shared())
            runner_fd = stack.enter_context(io.opened(Path(str(store._authority.path)+'.runner.lock')))
            artifacts = _artifacts(request, contexts)
            identities, pins = _current(store, receipt, contexts, artifacts, fence, runner_fd)
            document, immutable = _base(request, source, contexts, artifacts)
            # Reserve only bytes, not fictional future file facts. Actual facts are added after write.
            io.require(len(io.encode(immutable))+DESCRIPTOR_RESERVE <= MANIFEST_LIMIT, 'MAP_OUTPUT_TOO_LARGE')
            io.require(all(profiles._disjoint(output, path) for path in _protected(store, receipt, request, contexts)), 'MAP_PATH_OVERLAP')
            io.require(not os.path.lexists(str(output)), 'MAP_OUTPUT_OCCUPIED')
            os.mkdir(output.name, 0o700, dir_fd=root_fd); output_fd = stack.enter_context(io.opened(output, True))
            io.write_record(output/'routes.json', document, MAP_LIMIT); io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_artifacts(request, contexts) == artifacts and _current(store, receipt, contexts, artifacts, fence, runner_fd) == (identities, pins), 'MAP_INPUT_CHANGED')
            descriptors = _descriptors(root, output, document); saved = dict(immutable, **descriptors)
            io.require(len(io.encode(descriptors)) <= DESCRIPTOR_RESERVE and len(io.encode(saved)) <= MANIFEST_LIMIT, 'MAP_OUTPUT_TOO_LARGE')
            io.write_record(output/'manifest.json', saved, MANIFEST_LIMIT); io.full_flush(output_fd); io.full_flush(root_fd)
            io.require(_observed(request, root, output, source, contexts)[0] == saved, 'MAP_OUTPUT_CHANGED')
            io.require(_artifacts(request, contexts) == artifacts and _current(store, receipt, contexts, artifacts, fence, runner_fd) == (identities, pins), 'MAP_INPUT_CHANGED')
        return dict(status='cold_map_staged', durability_confirmed=True, requires_adoption=True, output_dir=str(output),
                    manifest_path=str(output/'manifest.json'), files=saved['files'], routes=document['routes'])
    except StoreError: raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error, profile.ProfileError) as error:
        raise io.RecoveryError('MAP_UNCONFIRMED') from error


def inspect_destination_map(request):
    request, root, output, source, contexts = _request(request)
    try:
        with io.opened(root, True):
            result = dict(status='not_started', durability_confirmed=False, requires_adoption=True, output_dir=str(output))
            if not os.path.lexists(str(output)):return result
            with io.opened(output, True):
                result['status'] = 'map_incomplete'
                if not os.path.lexists(str(output/'manifest.json')):return result
                observed, document = _observed(request, root, output, source, contexts)
                result.update(status='cold_map_observed', files=observed['files'], routes=document['routes'])
            return result
    except StoreError: raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, sqlite3.Error, profile.ProfileError) as error:
        raise io.RecoveryError('MAP_UNCONFIRMED') from error

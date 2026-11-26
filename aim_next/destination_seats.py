from __future__ import annotations

"""Dormant ready-seat request data; never managed plan/control adoption (1332)."""

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

from . import destination_hosted as hosted, destination_profiles as profiles, profile, recovery_io as io, route_pins
from .contract import StoreError
from .store import _connect

REQUEST_LIMIT = 8 * 1024 * 1024
MANIFEST_LIMIT = 12 * 1024 * 1024
PLAN_FIELDS = frozenset(('profile', 'config', 'cwd', 'cli', 'codex_home', 'codex_executable',
                         'model', 'reasoning_effort', 'permission_mode'))
INT_FIELDS = frozenset(('version', 'ready_seq', 'created_ms', 'end_ms', 'end_version'))
TEXT_FIELDS = ('id', 'workspace_id', 'agent_id', 'inviter_id', 'owner_id', 'role', 'state', 'stage',
               'runner_token', 'thread_id', 'reason', 'first_message_id', 'end_state', 'end_by', 'template_id')
ROW_FIELDS = frozenset(TEXT_FIELDS) | INT_FIELDS


def _json(raw, limit):
    io.require(type(raw) is str and len(raw.encode('utf-8')) <= limit, 'SEATS_INVALID_REQUEST')
    value = json.loads(raw, object_pairs_hook=io._pairs, parse_constant=io._constant)
    io.require(type(value) is dict, 'SEATS_INVALID_REQUEST')
    return value


def _snapshot(row):
    io.require(type(row) is dict and set(row) == ROW_FIELDS and len(io.encode(row)) <= 65536,
               'SEATS_INVALID_REQUEST')
    for key in TEXT_FIELDS:
        value = row[key]; limit = 16384 if key == 'role' else 200
        io.require(value is None or type(value) is str and len(value.encode('utf-8')) <= limit and '\0' not in value,
                   'SEATS_INVALID_REQUEST')
    for key in INT_FIELDS:
        io.require(row[key] is None or type(row[key]) is int and row[key] >= 0, 'SEATS_INVALID_REQUEST')
    io.require(all(profile._identity(row[k]) for k in ('id', 'workspace_id', 'agent_id', 'inviter_id', 'owner_id'))
               and type(row['version']) is int and row['version'] > 0 and type(row['role']) is str
               and bool(row['role'].strip()), 'SEATS_INVALID_REQUEST')


def _plan(raw):
    value = _json(raw, 65536)
    io.require(set(value) == PLAN_FIELDS and value['permission_mode'] == 'full' and
               value['reasoning_effort'] in ('low', 'medium', 'high', 'xhigh') and
               profile._identity(value['model']) and value['model'].isprintable(), 'SEATS_NOT_READY')
    for key in ('profile', 'config', 'cwd', 'cli', 'codex_home', 'codex_executable'): profiles._historical(value[key])
    return value


def _control(raw, binding):
    value = _json(raw, 8192)
    io.require(set(value) == {'v', 'binding', 'owner_id', 'desired', 'revision', 'changed_ms'} and
               type(value['v']) is int and value['v'] == 1 and value['binding'] == binding and
               value['desired'] in ('running', 'stopped') and type(value['revision']) is int and
               value['revision'] >= 1 and type(value['changed_ms']) is int and profile._identity(value['owner_id']),
               'SEATS_CONTROL_CONFLICT')
    return value


def _require_ready(row):
    io.require(row['state'] == 'ready' and row['stage'] == 'ready' and row['end_state'] is None and
               type(row['ready_seq']) is int and row['ready_seq'] > 0 and row['first_message_id'] is not None
               and row['thread_id'] is not None, 'SEATS_NOT_READY')


def _require_settings(row, plan, source, generated):
    io.require(source['instructions'] == generated['instructions'] == row['role'], 'SEATS_PROVENANCE_CONFLICT')
    for key in ('cli', 'cwd', 'codex_home', 'codex_executable', 'model', 'reasoning_effort', 'permission_mode'):
        io.require(source[key] == plan[key], 'SEATS_PROVENANCE_CONFLICT')
        if key != 'cli': io.require(generated[key] == plan[key], 'SEATS_PROVENANCE_CONFLICT')


def _request(value):
    try:
        io.require(type(value) is dict and set(value) == {'v', 'output_root', 'output_dir', 'hosted_request',
                   'hosted_result', 'hosted_manifest_bytes', 'hosted_manifest_digest', 'seats'} and
                   type(value['v']) is int and value['v'] == 1 and len(io.encode(value)) <= REQUEST_LIMIT,
                   'SEATS_INVALID_REQUEST')
        request = json.loads(io.encode(value)); root = io.canonical(request['output_root']); output = io.canonical(request['output_dir'])
        io.require(output.parent == root and output != root, 'SEATS_INVALID_REQUEST')
        hr, _, hout, pr, pout, snapshots, configs = hosted._request(request['hosted_request'])
        result = request['hosted_result']
        io.require(type(result) is dict and set(result) == {'status', 'durability_confirmed', 'requires_adoption',
                   'output_dir', 'manifest_path', 'files'} and result['status'] == 'cold_hosted_staged'
                   and result['durability_confirmed'] is True and result['requires_adoption'] is True and
                   result['output_dir'] == str(hout) and result['manifest_path'] == str(hout/'manifest.json'),
                   'SEATS_HOSTED_UNCONFIRMED')
        raw = request['hosted_manifest_bytes']
        io.require(type(raw) is str and len(raw.encode('utf-8')) <= hosted.MANIFEST_LIMIT and
                   hashlib.sha256(raw.encode('utf-8')).hexdigest() == request['hosted_manifest_digest'],
                   'SEATS_HOSTED_UNCONFIRMED')
        rows = request['seats']; seen = set(); actors = set(); hosted_actors = {r['actor_id'] for r in hr['actors']}
        io.require(type(rows) is list and 1 <= len(rows) <= 8, 'SEATS_INVALID_REQUEST')
        for entry in rows:
            io.require(type(entry) is dict and set(entry) == {'seat_id', 'expected_version', 'seat_snapshot', 'seat_digest',
                       'plan_bytes', 'plan_digest', 'control_bytes', 'control_digest', 'source_request_path',
                       'source_request_bytes', 'source_request_digest'} and type(entry['seat_id']) is str and
                       re.fullmatch(r'seat-[0-9a-f]{32}', entry['seat_id']) and entry['seat_id'] not in seen,
                       'SEATS_INVALID_REQUEST')
            seen.add(entry['seat_id']); row = entry['seat_snapshot']; _snapshot(row)
            io.require(row['id'] == entry['seat_id'] and type(entry['expected_version']) is int and
                       entry['expected_version'] == row['version'] and io.digest_record(row) == entry['seat_digest'] and
                       row['agent_id'] in hosted_actors and row['agent_id'] not in actors, 'SEATS_INVALID_REQUEST')
            actors.add(row['agent_id']); _plan(entry['plan_bytes']); _json(entry['control_bytes'], 8192)
            _json(entry['source_request_bytes'], 131072); profiles._historical(entry['source_request_path'])
            for key in ('plan', 'control', 'source_request'):
                io.require(hashlib.sha256(entry[key+'_bytes'].encode('utf-8')).hexdigest() == entry[key+'_digest'],
                           'SEATS_INVALID_REQUEST')
        return request, root, output, hr, hout, pr, pout, snapshots
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError, profile.ProfileError) as error:
        raise io.RecoveryError('SEATS_INVALID_REQUEST') from error


def _manifests(request, hr, hout):
    observed = hosted.inspect_destination_hosted(hr)
    manifest, digest = io.read_record(hout/'manifest.json', hosted.MANIFEST_LIMIT)
    io.require(observed['status'] == 'cold_hosted_observed' and digest == request['hosted_manifest_digest'] and
               manifest == _json(request['hosted_manifest_bytes'], hosted.MANIFEST_LIMIT) and
               manifest['request'] == hr and observed['files'] == request['hosted_result']['files'] == manifest['files'],
               'SEATS_HOSTED_UNCONFIRMED')
    return manifest


def _bounded_text(db, table, column, key_column, key, limit):
    # All SQL identifiers here are module constants, not request fields.
    found = db.execute('SELECT typeof('+column+'),substr(CAST('+column+' AS BLOB),1,?) FROM '+table+
                       ' WHERE '+key_column+'=?', (limit+1, key)).fetchone()
    io.require(found is not None, 'SEATS_ROW_MISSING')
    if found[0] == 'null': return None
    io.require(found[0] == 'text' and len(found[1]) <= limit, 'SEATS_SNAPSHOT_STALE')
    return found[1].decode('utf-8')


def _row(db, identity):
    expressions = []
    for key in TEXT_FIELDS:
        limit = 16384 if key == 'role' else 200
        expressions.extend(('typeof('+key+')', 'substr(CAST('+key+' AS BLOB),1,'+str(limit+1)+')'))
    for key in sorted(INT_FIELDS): expressions.extend(('typeof('+key+')', "CASE WHEN typeof("+key+")='integer' THEN "+key+' END'))
    found = db.execute('SELECT '+','.join(expressions)+' FROM hosted_seats WHERE id=?', (identity,)).fetchone()
    io.require(found is not None, 'SEATS_ROW_MISSING'); result = {}; offset = 0
    for key in list(TEXT_FIELDS)+sorted(INT_FIELDS):
        kind, value = found[offset:offset+2]; offset += 2
        if kind == 'null': result[key] = None
        elif key in INT_FIELDS:
            io.require(kind == 'integer', 'SEATS_SNAPSHOT_STALE'); result[key] = value
        else:
            io.require(kind == 'text' and len(value) <= (16384 if key == 'role' else 200), 'SEATS_SNAPSHOT_STALE')
            result[key] = value.decode('utf-8')
    _snapshot(result); return result


def _active(db, actor, kind):
    io.require(db.execute('SELECT 1 FROM actors WHERE id=? AND kind=? AND enabled=1', (actor, kind)).fetchone(),
               'SEATS_PROVENANCE_CONFLICT')


def _context(store, fence, request, snapshots):
    db = None
    try:
        db, _ = _connect(store.path); db.execute('BEGIN'); fence.verify(); store._check_instance(db); result = {}
        for entry in request['seats']:
            row = _row(db, entry['seat_id'])
            io.require(row == entry['seat_snapshot'] and row['version'] == entry['expected_version'], 'SEATS_SNAPSHOT_STALE')
            plan = _bounded_text(db, 'hosted_seats', 'plan', 'id', row['id'], 65536)
            io.require(plan is not None, 'SEATS_NOT_READY'); io.require(plan == entry['plan_bytes'], 'SEATS_SNAPSHOT_STALE')
            actor = row['agent_id']; _active(db, actor, 'agent')
            owner = _bounded_text(db, 'workspaces', 'owner_id', 'id', row['workspace_id'], 200); _active(db, owner, 'human')
            io.require(owner == actor or db.execute('SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?',
                       (row['workspace_id'], actor)).fetchone(), 'SEATS_PROVENANCE_CONFLICT')
            raw = _bounded_text(db, 'metadata', 'value', 'key', 'hosted_control.v1:'+actor, 8192)
            io.require(raw is not None and raw == entry['control_bytes'], 'SEATS_CONTROL_CONFLICT')
            binding = {k: snapshots[actor][k] for k in route_pins.BINDING_FIELDS}
            control = _control(raw, dict(binding, authority_path=snapshots[actor]['authority_path']))
            _active(db, control['owner_id'], 'human'); pin = route_pins._stored(db, route_pins._key(binding))
            io.require(pin is not None and pin['binding'] == binding, 'SEATS_PROVENANCE_CONFLICT')
            result[row['id']] = dict(row=row, plan_bytes=plan, control_bytes=raw, pin=pin, workspace_owner=owner)
        fence.verify(); return result
    finally:
        if db is not None:
            try: db.close()
            except BaseException as error: raise io.RecoveryError('SEATS_UNCONFIRMED') from error


def _current(store, receipt, request, hr, pr, snapshots, manifest, fence, runner_fd):
    identities = profiles._identities(store, fence, runner_fd)
    io.require(manifest['publication_receipt'] == receipt and manifest['identities'] ==
               manifest['profiles_manifest']['identities'] == identities, 'SEATS_PROVENANCE_CONFLICT')
    profiles._receipt(receipt, pr, store, fence.record, list(snapshots.values()))
    return identities, _context(store, fence, request, snapshots)


def _documents(request, hr, hout, pout, manifest, observations):
    documents = {}; projections = {}
    for entry in request['seats']:
        observed = observations[entry['seat_id']]; row = observed['row']; _snapshot(row); _require_ready(row)
        plan = _plan(observed['plan_bytes']); actor = row['agent_id']
        source_entry = next(r for r in hr['actors'] if r['actor_id'] == actor)
        context = next(r for r in hr['profiles_request']['profiles'] if json.loads(r['source_bytes'])['actor_id'] == actor)
        profile_entry = next(e for e in manifest['profiles_manifest']['entries'] if e['actor_id'] == actor)
        old_profile = json.loads(context['source_bytes'])
        _control(observed['control_bytes'], {k: old_profile[k] for k in route_pins.BINDING_FIELDS | {'authority_path'}})
        source = hosted._shape(source_entry['source_bytes']); generated, _ = io.read_record(hout/(actor+'.hosted.json'))
        original = _json(entry['source_request_bytes'], 131072)
        io.require(set(original) == {'seat_id', 'plan'} and original['seat_id'] == row['id'] and original['plan'] == plan and
                   entry['source_request_path'] == str(Path(plan['profile']).parent/'request.json') and
                   plan['profile'] == context['source_path'] == source['profile'] and plan['config'] == source_entry['source_path'] and
                   source['actor_id'] == generated['actor_id'] == actor and source['v'] == generated['v'] == 2 and
                   source['thread_id'] == generated['thread_id'] == row['thread_id'] and
                   observed['pin'] == manifest['pins'][actor] and observed['pin']['destination'] == hosted._destination(source),
                   'SEATS_PROVENANCE_CONFLICT')
        _require_settings(row, plan, source, generated)
        projected = dict(plan, profile=str(pout/profile_entry['profile']), config=str(hout/(actor+'.hosted.json')), cli=source_entry['cli'])
        io.require(generated['profile'] == projected['profile'] and generated['cli'] == projected['cli'], 'SEATS_PROVENANCE_CONFLICT')
        relative = 'seats/'+row['id']+'/request.json'; value = dict(seat_id=row['id'], plan=projected)
        io.require(len(io.encode(value)) <= 131072, 'SEATS_INVALID_REQUEST'); documents[relative] = value
        projections[row['id']] = dict(actor_id=actor, plan=projected, role=generated['instructions'], config=generated,
                                      template_id=row['template_id'], thread_id=row['thread_id'])
    return documents, projections


def _names(path, limit):
    return {p.name for _, p in zip(range(limit+1), path.iterdir())}


def _files(output, documents, complete):
    expected = {Path(name).parent.name for name in documents}; directories = {}; files = {}
    io.require(_names(output, 2) == ({'seats', 'manifest.json'} if complete else {'seats'}), 'SEATS_OUTPUT_CHANGED')
    io.require(_names(output/'seats', 8) == expected, 'SEATS_OUTPUT_CHANGED')
    for directory in [output, output/'seats']+[output/'seats'/name for name in sorted(expected)]:
        with io.opened(directory, True) as fd: directories[str(directory.relative_to(output))] = dict(mode=0o700, identity=io.identity(os.fstat(fd)))
    for name, value in documents.items():
        path = output/name; io.require(_names(path.parent, 1) == {'request.json'}, 'SEATS_OUTPUT_CHANGED')
        with io.opened(path) as fd:
            io.require(os.fstat(fd).st_size <= 131072, 'SEATS_OUTPUT_CHANGED'); raw = os.read(fd, 131073)
            io.require(raw == io.encode(value), 'SEATS_OUTPUT_CHANGED')
            files[name] = dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), mode=0o600, identity=io.identity(os.fstat(fd)))
    return files, directories


def _observed(request, output, hr, hout, pout):
    saved, _ = io.read_record(output/'manifest.json', MANIFEST_LIMIT)
    io.require(set(saved) == {'v', 'request', 'publication_receipt', 'hosted_manifest', 'identities', 'observations',
               'projections', 'files', 'directories'} and type(saved['v']) is int and saved['v'] == 1 and saved['request'] == request,
               'SEATS_OUTPUT_CHANGED')
    manifest = _manifests(request, hr, hout)
    io.require(saved['hosted_manifest'] == manifest and saved['publication_receipt'] == manifest['publication_receipt'] and
               saved['identities'] == manifest['identities'], 'SEATS_PROVENANCE_CONFLICT')
    for entry in request['seats']:
        obs = saved['observations'][entry['seat_id']]
        io.require(obs['row'] == entry['seat_snapshot'] and obs['plan_bytes'] == entry['plan_bytes'] and
                   obs['control_bytes'] == entry['control_bytes'], 'SEATS_OUTPUT_CHANGED')
    documents, projected = _documents(request, hr, hout, pout, manifest, saved['observations'])
    files, directories = _files(output, documents, True)
    io.require(projected == saved['projections'] and files == saved['files'] and directories == saved['directories'], 'SEATS_OUTPUT_CHANGED')
    return saved


def stage_destination_seats(store, publication_receipt, request):
    request, root, output, hr, hout, pr, pout, snapshots = _request(request)
    try:
        receipt = json.loads(io.encode(publication_receipt))
        with ExitStack() as stack:
            root_fd = stack.enter_context(io.opened(root, True)); fence = stack.enter_context(store._authority.shared())
            runner = Path(str(store._authority.path)+'.runner.lock'); runner_fd = stack.enter_context(io.opened(runner))
            manifest = _manifests(request, hr, hout)
            identities, observations = _current(store, receipt, request, hr, pr, snapshots, manifest, fence, runner_fd)
            documents, projected = _documents(request, hr, hout, pout, manifest, observations)
            protected = [hout, pout, store.path, Path(str(store.path)+'.media'), store._authority.path,
                         Path(str(store._authority.path)+'.lock'), runner, Path(receipt['journal_path']).parent]
            for context in pr['profiles']: protected.extend((Path(context['source_path']).parent, Path(context['outbox_parent'])))
            for entry in request['seats']:
                plan = _plan(entry['plan_bytes']); protected.extend(Path(plan[k]) for k in ('cwd', 'codex_home'))
                protected.extend((Path(plan['profile']).parent, Path(plan['config']).parent, Path(entry['source_request_path']).parent))
            io.require(all(profiles._disjoint(output, path) for path in protected), 'SEATS_PATH_OVERLAP')
            io.require(not os.path.lexists(str(output)), 'SEATS_OUTPUT_OCCUPIED')
            os.mkdir(output.name, 0o700, dir_fd=root_fd); out_fd = stack.enter_context(io.opened(output, True))
            os.mkdir('seats', 0o700, dir_fd=out_fd); seats_fd = stack.enter_context(io.opened(output/'seats', True))
            for relative, value in documents.items():
                name = Path(relative).parent.name; os.mkdir(name, 0o700, dir_fd=seats_fd)
                child_fd = stack.enter_context(io.opened(output/'seats'/name, True)); io.write_record(output/relative, value, 131072); io.full_flush(child_fd)
            io.full_flush(seats_fd); io.full_flush(out_fd); io.full_flush(root_fd)
            io.require(_current(store, receipt, request, hr, pr, snapshots, manifest, fence, runner_fd) == (identities, observations)
                       and _manifests(request, hr, hout) == manifest, 'SEATS_INPUT_CHANGED')
            files, directories = _files(output, documents, False)
            saved = dict(v=1, request=request, publication_receipt=receipt, hosted_manifest=manifest, identities=identities,
                         observations=observations, projections=projected, files=files, directories=directories)
            io.write_record(output/'manifest.json', saved, MANIFEST_LIMIT); io.full_flush(out_fd); io.full_flush(root_fd)
            io.require(_observed(request, output, hr, hout, pout) == saved and
                       _current(store, receipt, request, hr, pr, snapshots, manifest, fence, runner_fd) == (identities, observations),
                       'SEATS_INPUT_CHANGED')
        return dict(status='cold_seats_staged', durability_confirmed=True, requires_adoption=True,
                    output_dir=str(output), manifest_path=str(output/'manifest.json'), files=saved['files'], seats=saved['projections'])
    except StoreError: raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError, sqlite3.Error, profile.ProfileError) as error:
        raise io.RecoveryError('SEATS_UNCONFIRMED') from error


def inspect_destination_seats(request):
    request, root, output, hr, hout, pr, pout, snapshots = _request(request)
    try:
        with io.opened(root, True):
            result = dict(status='not_started', durability_confirmed=False, requires_adoption=True, output_dir=str(output))
            if not os.path.lexists(str(output)): return result
            with io.opened(output, True):
                result['status'] = 'seats_incomplete'
                if not os.path.lexists(str(output/'manifest.json')): return result
                observed = _observed(request, output, hr, hout, pout)
                result.update(status='cold_seats_observed', files=observed['files'], seats=observed['projections'])
            return result
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError, RuntimeError, sqlite3.Error, profile.ProfileError) as error:
        raise io.RecoveryError('SEATS_UNCONFIRMED') from error

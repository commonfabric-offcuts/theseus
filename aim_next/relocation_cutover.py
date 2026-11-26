from __future__ import annotations

"""Explicit same-owner cutover. Dormant unless an operator calls it (1326)."""

from contextlib import contextmanager, ExitStack
import fcntl
from itertools import islice
import os
from pathlib import Path
import sqlite3
import stat

from . import recovery_io as io, relocation_stage as stage, relocation_publication as publication
from .authority import ANCHOR_FIELDS
from .recovery_io import RecoveryError, require

CLAIM_LIMIT = stage.RECORD_LIMIT + 131072


def _request(value):
    try:
        require(type(value) is dict and set(value) == {'v', 'stage_request', 'stage_digest', 'journal_root'}
                and type(value['v']) is int and value['v'] == 1, 'INVALID_REQUEST')
        staged, stage_root = stage._request(value['stage_request'])
        require(type(value['stage_digest']) is str and stage.relocation.HEX64.fullmatch(value['stage_digest']) is not None,
                'INVALID_REQUEST')
        parent = io.canonical(value['journal_root'])
        prep = staged['intent_request']['preparation']
        protected = [stage_root.parent, Path(staged['intent_request']['journal_root']), Path(prep['staging_root']),
                     Path(prep['bundle_path'])] + [Path(side[k]).parent for side in (prep['source'], prep['destination'])
                                                    for k in ('db_path', 'authority_path')]
        require(all(not parent.is_relative_to(p) and not p.is_relative_to(parent) for p in protected), 'INVALID_REQUEST')
        request = dict(v=1, stage_request=staged, stage_digest=value['stage_digest'], journal_root=str(parent))
        require(len(io.encode(request)) <= 60000, 'INVALID_REQUEST')
        return request, parent/prep['move_id']
    except (TypeError, ValueError, UnicodeError, RuntimeError, OSError, RecursionError) as error:
        raise RecoveryError('INVALID_REQUEST') from error


def _parts(claim):
    request = claim['request']; staged = request['stage_request']; prep = staged['intent_request']['preparation']
    return prep, Path(prep['source']['authority_path']), Path(prep['destination']['authority_path'])


def _lineage(claim):
    prep, _, _ = _parts(claim)
    return dict(move_id=prep['move_id'], request_digest=io.digest_record(claim['request']),
                stage_digest=claim['request']['stage_digest'], journal_identity=claim['root_identity'],
                journal_path=str(Path(claim['request']['journal_root'])/prep['move_id']),
                predecessor_digest=claim['stage_claim']['intent']['predecessor']['anchor_digest'],
                predecessor=dict(prep['source']), commit=dict(prep['commit']))


def _retired(claim):
    old = claim['stage_claim']['intent']['predecessor']['anchor']
    return dict(old, state='retired', recovery=dict(kind='retired', predecessor_recovery=old.get('recovery'),
                                                  relocation_retirement=_lineage(claim)))


def _active(claim):
    prep, _, _ = _parts(claim); old = claim['stage_claim']['intent']['predecessor']['anchor']
    record = {key: old[key] for key in ANCHOR_FIELDS}
    record.update(state='active', epoch=claim['stage']['epoch'], db_path=prep['destination']['db_path'])
    for name, prefix in (('database', 'db'), ('authority_lock', 'lock'), ('runner_lock', 'runner_lock')):
        record[prefix+'_device'], record[prefix+'_inode'] = claim['stage']['identities'][name]
    record['recovery'] = dict(kind='relocation', relocation=_lineage(claim))
    history = old.get('recovery')
    if isinstance(history, dict) and type(history.get('history_complete')) is bool:
        record['recovery']['history_complete'] = history['history_complete']
    return record


def _load(request, root, fd):
    if not os.path.lexists(str(root/'claim.json')):
        return None
    claim, digest = io.read_record(root/'claim.json', CLAIM_LIMIT)
    require(set(claim) == {'v', 'request', 'stage_claim', 'stage', 'root_identity', 'lock_identity'}
            and type(claim['v']) is int and claim['v'] == 1, 'CUTOVER_INVALID')
    require(claim['request'] == request, 'CUTOVER_REQUEST_MISMATCH')
    require(digest == io.digest_record(claim) and claim['root_identity'] == io.identity(io.checked(root, True))
            and claim['lock_identity'] == io.identity(os.fstat(fd))
            and claim['stage_claim']['request'] == request['stage_request']
            and claim['stage']['claim_digest'] == io.digest_record(claim['stage_claim'])
            and io.digest_record(claim['stage']) == request['stage_digest'], 'CUTOVER_INVALID')
    require({p.name for p in islice(root.iterdir(), 5)} <= {'intent.lock', 'claim.json', 'retired.json', 'published.json'},
            'CUTOVER_INVALID')
    return claim


@contextmanager
def _fences(claim, exclusive=False):
    prep, source, target = _parts(claim); fds = {'source': [], 'target': []}
    with ExitStack() as stack:
        for parent in sorted({source.parent, target.parent, Path(prep['destination']['db_path']).parent}, key=str):
            stack.enter_context(io.opened(parent, True))
        try:
            for side, path in (('source', source), ('target', target)):
                expected = (claim['stage_claim']['intent']['predecessor']['identities'] if side == 'source'
                            else claim['stage']['identities'])
                for index, (suffix, key) in enumerate((('.lock', 'authority_lock'), ('.runner.lock', 'runner_lock'))):
                    fd = os.open(str(path)+suffix, (os.O_RDWR if exclusive else os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK)
                    fds[side].append(fd)
                    require(io.identity(io.check_info(os.fstat(fd))) == expected[key]
                            == io.identity(io.checked(Path(str(path)+suffix))), 'CUTOVER_IDENTITY_CHANGED')
                    if exclusive or index == 0:
                        try:
                            fcntl.flock(fd, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)|fcntl.LOCK_NB)
                        except BlockingIOError as error:
                            raise RecoveryError('CUTOVER_BUSY', retryable=True) from error
            yield fds
            for side, path in (('source', source), ('target', target)):
                for fd, suffix in zip(fds[side], ('.lock', '.runner.lock')):
                    require(io.identity(io.check_info(os.fstat(fd))) == io.identity(io.checked(Path(str(path)+suffix))),
                            'CUTOVER_IDENTITY_CHANGED')
        finally:
            failure = None
            for fd in reversed(fds['source']+fds['target']):
                try: os.close(fd)
                except BaseException as error: failure = error
            if failure is not None: raise RecoveryError('CUTOVER_UNCONFIRMED') from failure


def _source_state(claim):
    _, path, _ = _parts(claim); record, digest = io.read_record(path)
    predecessor = claim['stage_claim']['intent']['predecessor']
    if record == predecessor['anchor'] and digest == predecessor['anchor_digest']:
        return 'active'
    require(record == _retired(claim) and digest == io.digest_record(record), 'CUTOVER_SOURCE_CHANGED')
    return 'retired'


def _fresh_source(claim):
    prep, _, _ = _parts(claim); path = Path(prep['source']['db_path'])
    expected = claim['stage']['source_metadata']
    require(io.identity(io.checked(path)) == claim['stage_claim']['intent']['predecessor']['identities']['database'],
            'CUTOVER_IDENTITY_CHANGED')
    metadata = io.read_metadata(path, policy='live')
    require(all(metadata[k] == expected[k] for k in expected if k not in ('commit_seq', 'commit_id')),
            'CUTOVER_SOURCE_CHANGED')
    require(metadata['commit_seq'] == expected['commit_seq'] and metadata['commit_id'] == expected['commit_id'],
            'CUTOVER_COMMIT_CHANGED')
    require(io.identity(io.checked(path)) == claim['stage_claim']['intent']['predecessor']['identities']['database'],
            'CUTOVER_IDENTITY_CHANGED')


def _temp(claim, side):
    prep, source, target = _parts(claim); path = source if side == 'retire' else target
    return path.parent/('.'+path.name+'.'+side+'-'+prep['move_id'])


def _published(claim):
    _, _, path = _parts(claim)
    if not os.path.lexists(str(path)): return False
    expected = _active(claim); temporary = _temp(claim, 'publish')
    if not os.path.lexists(str(temporary)):
        record, digest = io.read_record(path)
        require(record == expected and digest == io.digest_record(expected), 'CUTOVER_DESTINATION_CHANGED')
        return True
    # Our no-clobber link can survive before its own alias is removed. Accept
    # ONLY these two exact private names, the same inode and exact record bytes.
    named, alias = path.lstat(), temporary.lstat()
    require(io.identity(named) == io.identity(alias) and named.st_nlink == alias.st_nlink == 2,
            'CUTOVER_DESTINATION_CHANGED')
    fd = os.open(str(path), os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 2 and io.identity(info) == io.identity(named), 'CUTOVER_DESTINATION_CHANGED')
        raw = os.read(fd, 65537)
        require(raw == io.encode(expected) and io.facts(os.fstat(fd)) == io.facts(info)
                and io.identity(path.lstat()) == io.identity(info) == io.identity(temporary.lstat()),
                'CUTOVER_DESTINATION_CHANGED')
    finally: os.close(fd)
    return True


def _current_destination(claim):
    request = claim['request']['stage_request']; db, _, media = stage._paths(request)
    require(io.identity(io.checked(db)) == claim['stage']['identities']['database']
            and io.identity(io.checked(media, True)) == claim['stage']['media_identity'], 'CUTOVER_IDENTITY_CHANGED')
    for path, pair in claim['stage']['parents'].items():
        require(io.identity(io.checked(Path(path), True)) == pair, 'CUTOVER_IDENTITY_CHANGED')
    metadata = io.read_metadata(db, policy='live')
    require(all(metadata[k] == v for k, v in claim['stage']['metadata'].items() if k not in ('commit_seq', 'commit_id')),
            'CUTOVER_DESTINATION_CHANGED')
    return metadata


def _exact_file(path, value):
    if os.path.lexists(str(path)):
        saved, digest = io.read_record(path)
        require(saved == value and digest == io.digest_record(value), 'CUTOVER_INCOMPLETE')
    else: io.write_record(path, value)
    io.flush_path(path)


def _finish_retirement(claim, root):
    require(_source_state(claim) == 'retired', 'CUTOVER_SOURCE_CHANGED')
    _, source, _ = _parts(claim)
    io.flush_path(source); io.flush_path(source.parent, True)
    require(_source_state(claim) == 'retired', 'CUTOVER_SOURCE_CHANGED')
    _exact_file(root/'retired.json', dict(v=1, lineage=_lineage(claim), anchor_digest=io.digest_record(_retired(claim))))
    io.flush_path(root, True)


def _retire(claim, root):
    if _source_state(claim) == 'active':
        temporary = _temp(claim, 'retire'); _, source, _ = _parts(claim)
        _exact_file(temporary, _retired(claim))
        require(_source_state(claim) == 'active', 'CUTOVER_SOURCE_CHANGED')
        os.replace(str(temporary), str(source))
    _finish_retirement(claim, root)


def _remove_alias(claim):
    require(_published(claim), 'CUTOVER_DESTINATION_CHANGED')
    temporary = _temp(claim, 'publish')
    if os.path.lexists(str(temporary)): os.unlink(str(temporary))


def _install(claim):
    _, _, target = _parts(claim)
    require(not os.path.lexists(str(target)), 'CUTOVER_DESTINATION_CHANGED')
    temporary = _temp(claim, 'publish'); _exact_file(temporary, _active(claim))
    # Atomic no-clobber: a conflicting/partial target is never replaced.
    os.link(str(temporary), str(target))
    _remove_alias(claim)
    io.flush_path(target); io.flush_path(target.parent, True)
    require(_published(claim), 'CUTOVER_DESTINATION_CHANGED')


def _finish_publication(claim, root):
    _finish_retirement(claim, root)
    _remove_alias(claim); _, _, target = _parts(claim)
    io.flush_path(target); io.flush_path(target.parent, True)
    require(_published(claim), 'CUTOVER_DESTINATION_CHANGED')
    _exact_file(root/'published.json', dict(v=1, lineage=_lineage(claim), anchor_digest=io.digest_record(_active(claim))))
    for path in (root/'claim.json', root/'intent.lock'): io.flush_path(path)
    io.flush_path(root, True); io.flush_path(root.parent, True)
    require(_source_state(claim) == 'retired' and _published(claim), 'CUTOVER_UNCONFIRMED')
    return _current_destination(claim)


def _result(request, root, status, metadata=None, confirmed=False, claim=None):
    result = dict(status=status, durability_confirmed=confirmed, journal_path=str(root),
                  move_id=request['stage_request']['intent_request']['preparation']['move_id'],
                  request_digest=io.digest_record(request))
    if claim is not None:
        result['cutover_commit'] = dict(claim['stage_claim']['intent']['predecessor']['metadata'])
    if metadata is not None: result['observed_commit'] = dict(seq=metadata['commit_seq'], id=metadata['commit_id'])
    if confirmed:
        prep, _, target = _parts(claim)
        result['binding'] = dict(instance_id=prep['source']['instance_id'], authority_id=prep['source']['authority_id'],
                                authority_epoch=claim['stage']['epoch'], authority_path=str(target),
                                db_path=prep['destination']['db_path'])
    return result


def _phase(claim, root, confirm=False):
    with _fences(claim):
        source = _source_state(claim)
        if _published(claim):
            require(source == 'retired', 'CUTOVER_SPLIT_BRAIN')
            metadata = _current_destination(claim)
            if confirm: metadata = _finish_publication(claim, root)
            return _result(claim['request'], root, 'published' if confirm else 'published_observed',
                           metadata, confirm, claim)
        if source == 'active': _fresh_source(claim)
        return _result(claim['request'], root, 'prepared_observed' if source == 'active' else 'source_retired', claim=claim)


def _fixed(claim):
    db, _, media = stage._paths(claim['request']['stage_request'])
    return dict(database=io.facts(io.checked(db)), media=io.facts(io.checked(media, True)),
                files={r['name']: io.facts(io.checked(media/r['name'])) for r in claim['stage']['media']},
                parents={p: io.identity(io.checked(Path(p), True)) for p in claim['stage']['parents']})


def _verify_stage(claim, stage_fd, confirm):
    request = claim['request']['stage_request']; _, stage_root = stage._request(request)
    require(stage._claim(request, stage_root, stage_fd) == claim['stage_claim'], 'CUTOVER_STAGE_CHANGED')
    with stage._target(request, confirm=confirm) as fds:
        require(stage._completion(claim['stage_claim'], stage_root, fds) == claim['stage'], 'CUTOVER_STAGE_CHANGED')
        if confirm: stage._flush(claim['stage_claim'], stage_root, claim['stage'])
        return _fixed(claim)


@contextmanager
def _stage_lock(root, exclusive):
    # Unlike create=True on a journal helper, this never reconstructs a lost
    # stage namespace. The already completed 1325 ownership is required.
    with io.opened(root, True):
        fd = os.open(str(root/'intent.lock'), (os.O_RDWR if exclusive else os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            publication._same_lock(root, fd)
            try:
                fcntl.flock(fd, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)|fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RecoveryError('CUTOVER_BUSY', retryable=True) from error
            yield fd
            publication._same_lock(root, fd)
        finally: os.close(fd)


def _run(value, create):
    request, root = _request(value)
    try:
        io.checked(root.parent, True, 'INVALID_REQUEST')
        initial = None
        if not os.path.lexists(str(root)):
            if not create: return _result(request, root, 'not_started')
            initial = stage.inspect_relocation_stage(request['stage_request'])
            require(initial['status'] == 'staged_observed' and io.digest_record(initial['stage']) == request['stage_digest'],
                    'CUTOVER_STAGE_CHANGED')
        with publication._locked(root, create) as (fresh, fd):
            claim = _load(request, root, fd)
            if not fresh and claim is None:
                require(not create, 'CUTOVER_INCOMPLETE')
                return _result(request, root, 'cutover_incomplete')
            if claim is not None:
                observed = _phase(claim, root, confirm=create)
                if observed['status'].startswith('published'): return observed
            _, stage_root = stage._request(request['stage_request'])
            with _stage_lock(stage_root, create) as stage_fd:
                if fresh:
                    require(initial is not None, 'CUTOVER_INCOMPLETE')
                    stage_claim = stage._claim(request['stage_request'], stage_root, stage_fd)
                    require(stage_claim is not None, 'CUTOVER_INCOMPLETE')
                    claim = dict(v=1, request=request, stage_claim=stage_claim, stage=initial['stage'],
                                 root_identity=io.identity(io.checked(root, True)), lock_identity=io.identity(os.fstat(fd)))
                    io.write_record(root/'claim.json', claim, CLAIM_LIMIT); io.flush_path(root, True)
                    require(_load(request, root, fd) == claim, 'CUTOVER_INVALID')
                fixed = _verify_stage(claim, stage_fd, create)
                if not create: return observed
                with _fences(claim, True):
                    state = _source_state(claim)
                    require(not _published(claim), 'CUTOVER_DESTINATION_CHANGED')
                    if state == 'active': _fresh_source(claim)
                    require(_fixed(claim) == fixed, 'CUTOVER_STAGE_CHANGED')
                    _current_destination(claim)
                    _retire(claim, root)
                    require(_source_state(claim) == 'retired', 'CUTOVER_SOURCE_CHANGED')
                    _install(claim)
                    metadata = _finish_publication(claim, root)
                    result = _result(request, root, 'published', metadata, True, claim)
        return result
    except RecoveryError as error:
        error.evidence.update(journal_path=str(root), move_id=request['stage_request']['intent_request']['preparation']['move_id'])
        raise
    except (OSError, sqlite3.Error, KeyboardInterrupt, ValueError, KeyError, TypeError, UnicodeError, RecursionError) as error:
        code = 'CUTOVER_BUSY' if io.busy(error) else 'CUTOVER_UNCONFIRMED'
        raise RecoveryError(code, retryable=code == 'CUTOVER_BUSY', evidence=dict(
            journal_path=str(root), move_id=request['stage_request']['intent_request']['preparation']['move_id'],
            cause=type(error).__name__)) from error


def publish_relocation(request):
    """Retire before publication; confirm the same identity after uncertain returns."""
    return _run(request, True)


def relocation_readback(request):
    """Observe only; never flush, create, repair, activate or restore authority."""
    return _run(request, False)

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import plistlib
import sqlite3
import subprocess
import uuid

from . import recovery_io as io
from .authority import _read_anchor
from .backup import backup, inspect
from .recovery_io import RecoveryError, require


SOURCE_FIELDS = {'instance_id', 'db_path', 'authority_path', 'authority_id', 'authority_epoch'}
DESTINATION_FIELDS = {'machine_id', 'reservation_id', 'activation_id', 'authority_path', 'candidate_path'}
REQUEST_FIELDS = {'v', 'handoff_id', 'source', 'destination', 'transport', 'bundle_path'}


def _uuid(value):
    try:
        valid = isinstance(value, str) and str(uuid.UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        valid = False
    require(valid, 'INVALID_REQUEST')


def _request(value):
    require(isinstance(value, dict) and set(value) == REQUEST_FIELDS, 'INVALID_REQUEST')
    require(type(value['v']) is int and value['v'] == 1, 'INVALID_REQUEST')
    _uuid(value['handoff_id'])
    source, destination, transport = value['source'], value['destination'], value['transport']
    require(isinstance(source, dict) and set(source) == SOURCE_FIELDS, 'INVALID_REQUEST')
    require(isinstance(destination, dict) and set(destination) == DESTINATION_FIELDS, 'INVALID_REQUEST')
    require(isinstance(transport, dict) and set(transport) == {'mount_path', 'volume_uuid'}, 'INVALID_REQUEST')
    for key in ('instance_id', 'authority_id', 'authority_epoch'):
        require(io.identifier(source[key]), 'INVALID_REQUEST')
    require(io.identifier(destination['machine_id']) and io.identifier(transport['volume_uuid']), 'INVALID_REQUEST')
    for key in ('reservation_id', 'activation_id'):
        _uuid(destination[key])
    paths = [io.canonical(source[k]) for k in ('db_path', 'authority_path')]
    paths += [io.canonical(destination[k]) for k in ('authority_path', 'candidate_path')]
    bundle, mount = io.canonical(value['bundle_path']), io.canonical(transport['mount_path'])
    require(bundle != mount and bundle.is_relative_to(mount), 'INVALID_REQUEST')
    require(all(not p.is_relative_to(mount) for p in paths), 'INVALID_REQUEST')
    control = Path(source['authority_path']+'.transfers')
    require(not control.is_relative_to(bundle) and not bundle.is_relative_to(control)
            and all(not p.is_relative_to(bundle) for p in paths[:2]), 'INVALID_REQUEST')
    # Copy through canonical JSON: callers cannot mutate nested inputs mid-operation.
    import json
    return json.loads(io.encode(value))


def probe_transport(request):
    """Read actual mount facts; never mounts, unlocks, changes owners or prints secrets."""
    transport = request['transport']
    mount = io.canonical(transport['mount_path'])
    result = subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', str(mount)],
                            capture_output=True, timeout=10, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 1024*1024, 'TRANSPORT_INVALID')
    facts = plistlib.loads(result.stdout)
    require(isinstance(facts, dict) and facts.get('MountPoint') == str(mount)
            and facts.get('VolumeUUID') == transport['volume_uuid']
            and facts.get('FilesystemType') == 'apfs' and facts.get('Internal') is False
            and facts.get('Encryption') is True and facts.get('EncryptionThisVolumeProper') is True
            and facts.get('Locked') is False and facts.get('GlobalPermissionsEnabled') is True
            and facts.get('WritableVolume') is True, 'TRANSPORT_INVALID')
    info = mount.lstat()
    parent = Path(request['bundle_path']).parent
    io.checked(parent, True, 'TRANSPORT_INVALID')
    require(parent.stat().st_dev == info.st_dev and os.path.ismount(mount), 'TRANSPORT_INVALID')
    return dict(mount_path=str(mount), volume_uuid=facts['VolumeUUID'], device=info.st_dev, uid=os.getuid())


def _claim_path(request):
    return Path(request['source']['authority_path']+'.transfers')/request['handoff_id']


@contextmanager
def _claim(request, create=False):
    path = _claim_path(request)
    fresh = False
    if create:
        try:
            path.parent.mkdir(mode=0o700)
            io.flush_path(path.parent.parent, True)
        except FileExistsError:
            pass
        io.checked(path.parent, True)
        try:
            path.mkdir(mode=0o700)
            fresh = True
        except FileExistsError:
            pass
    if not path.exists():
        yield None
        return
    io.checked(path.parent, True)
    io.checked(path, True)
    if not fresh and (not (path/'lock').exists() or not (path/'request.json').exists()):
        raise RecoveryError('PREPARATION_INCOMPLETE')
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
    if fresh:
        flags |= os.O_CREAT | os.O_EXCL
    fd = os.open(str(path/'lock'), flags, 0o600)
    try:
        io.check_info(os.fstat(fd))
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RecoveryError('CLAIM_BUSY', retryable=True) from error
        identities = dict(root=io.identity(io.checked(path.parent, True)),
                          claim=io.identity(io.checked(path, True)), lock=io.identity(os.fstat(fd)))
        expected = dict(v=1, request=request, identities=identities)
        if fresh:
            io.full_flush(fd)
            io.flush_path(path, True)
            io.write_record(path/'request.json', expected)
            io.flush_path(path, True)
            io.flush_path(path.parent, True)
        else:
            recorded, _ = io.read_record(path/'request.json')
            require(recorded.get('request') == request, 'REQUEST_MISMATCH')
            require(recorded == expected, 'CONTROL_INVALID')
        yield path
        require(io.identity(io.checked(path/'lock')) == identities['lock']
                and io.identity(io.checked(path, True)) == identities['claim']
                and io.identity(io.checked(path.parent, True)) == identities['root'], 'CONTROL_INVALID')
    finally:
        # Close this reference, never unlock a possibly inherited description.
        os.close(fd)


class _Fence:
    def __init__(self, request, exclusive):
        self.request, self.exclusive = request, exclusive
        self.fds = []

    def verify(self):
        source = self.request['source']
        record = _read_anchor(Path(source['authority_path']))
        require(record['instance_id'] == source['instance_id']
                and record['authority_id'] == source['authority_id']
                and record['epoch'] == source['authority_epoch']
                and record['db_path'] == source['db_path'], 'SOURCE_MISMATCH')
        require(record['state'] in ('active', 'transferred'), 'STALE')
        for fd, suffix, prefix in zip(self.fds, ('.lock', '.runner.lock'), ('lock', 'runner_lock')):
            held = io.check_info(os.fstat(fd))
            named = io.checked(Path(source['authority_path']+suffix))
            require(io.identity(held) == io.identity(named)
                    == [record[prefix+'_device'], record[prefix+'_inode']], 'SOURCE_MISMATCH')
        require(io.identity(io.checked(source['db_path']))
                == [record['db_device'], record['db_inode']], 'SOURCE_MISMATCH')
        return record

    def __enter__(self):
        try:
            for index, suffix in enumerate(('.lock', '.runner.lock')):
                fd = os.open(self.request['source']['authority_path']+suffix,
                             os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
                self.fds.append(fd)
                io.check_info(os.fstat(fd))
                if index == 0 or self.exclusive:
                    operation = fcntl.LOCK_EX if self.exclusive else fcntl.LOCK_SH
                    try:
                        fcntl.flock(fd, operation | fcntl.LOCK_NB)
                    except BlockingIOError as error:
                        raise RecoveryError('AUTHORITY_BUSY', retryable=True) from error
            self.record = self.verify()
            return self
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self, *unused):
        while self.fds:
            os.close(self.fds.pop())


def _publish_retirement(fence, record):
    path = Path(fence.request['source']['authority_path'])
    temporary = path.parent/('.'+path.name+'.transfer-'+uuid.uuid4().hex)
    io.write_record(temporary, record)
    os.replace(str(temporary), str(path))
    io.flush_path(path.parent, True)
    require(fence.verify() == record, 'TRANSFER_UNCONFIRMED')


def _write_handoff(path, receipt):
    if path.exists():
        require(io.read_record(path)[0] == receipt, 'REQUEST_MISMATCH')
    else:
        io.write_record(path, receipt)
    io.flush_path(path)
    io.flush_path(path.parent, True)


def _confirmed(fence, prepared, path):
    request = fence.request
    require(fence.verify() == prepared['retired'], 'STALE')
    # A matching retry confirms publication afresh before returning authority to transfer.
    io.flush_path(request['source']['authority_path'])
    io.flush_path(Path(request['source']['authority_path']).parent, True)
    require(fence.verify() == prepared['retired'], 'STALE')
    receipt = prepared['receipt']
    _write_handoff(path/'handoff.json', receipt)
    _write_handoff(Path(request['bundle_path'])/'handoff.json', receipt)
    io.flush_path(path, True)
    io.flush_path(path.parent, True)
    require(fence.verify() == prepared['retired'], 'STALE')
    return receipt


def _export(request):
    medium = probe_transport(request)
    with _Fence(request, False) as fence:
        initial = fence.record
    if initial['state'] != 'active':
        # A retired source may only enter its existing exact claim.
        require(_claim_path(request).exists(), 'STALE')
    with _claim(request, create=initial['state'] == 'active') as path:
        require(path is not None, 'PREPARATION_INCOMPLETE')
        prepared = io.read_record(path/'retirement.json')[0] if (path/'retirement.json').exists() else None
        if prepared is not None and initial['state'] == 'transferred':
            require(prepared['request_digest'] == io.digest_record(request), 'REQUEST_MISMATCH')
            # Recheck immutable transport data before completing SSD publication.
            inspect(request['bundle_path'], expected_digest=prepared['receipt']['bundle_digest'])
            require(probe_transport(request) == medium, 'TRANSPORT_INVALID')
            with _Fence(request, True) as fence:
                return _confirmed(fence, prepared, path)
        require(initial['state'] == 'active', 'STALE')
        source = request['source']
        if not Path(request['bundle_path']).exists():
            backup(source['db_path'], source['instance_id'], expected_binding={
                k: source[k] for k in ('authority_path', 'authority_id', 'authority_epoch')},
                bundle_path=request['bundle_path'])
        manifest = inspect(request['bundle_path'])
        bundle_digest = io.read_record(Path(request['bundle_path'])/'manifest.json', 16*1024*1024)[1]
        require(all(manifest['metadata'][k] == source[k] for k in
                    ('instance_id', 'authority_id', 'authority_path', 'authority_epoch')), 'BUNDLE_INVALID')
        require(probe_transport(request) == medium, 'TRANSPORT_INVALID')
        with _Fence(request, True) as fence:
            previous = fence.verify()
            require(previous['state'] == 'active', 'STALE')
            metadata = io.read_metadata(source['db_path'], policy='live')
            require(metadata == manifest['metadata'], 'HISTORY_MISMATCH')
            if prepared is None:
                retired = dict(previous, state='transferred')
                retired['recovery'] = dict(previous.get('recovery') or {}, transfer={
                    'handoff_id': request['handoff_id'], 'request_digest': io.digest_record(request),
                    'bundle_digest': bundle_digest, 'destination': request['destination']})
                history = previous.get('recovery', {}).get('history_complete')
                receipt = dict(v=1, status='retired', durability_confirmed=True,
                    handoff_id=request['handoff_id'], request_digest=io.digest_record(request),
                    source=source, destination=request['destination'], transport=request['transport'],
                    source_commit={k: metadata[k] for k in ('commit_seq', 'commit_id')},
                    history_complete=history if type(history) is bool else None,
                    bundle_digest=bundle_digest, retired_anchor_digest=io.digest_record(retired))
                prepared = dict(v=1, request_digest=io.digest_record(request), previous=previous,
                                retired=retired, receipt=receipt, transport_observation=medium)
                io.write_record(path/'retirement.json', prepared)
                io.flush_path(path, True)
            require(prepared['previous'] == previous and prepared['receipt']['bundle_digest'] == bundle_digest,
                    'STALE')
            require(fence.verify() == previous, 'SOURCE_MISMATCH')
            try:
                _publish_retirement(fence, prepared['retired'])
                return _confirmed(fence, prepared, path)
            except BaseException as error:
                raise RecoveryError('TRANSFER_UNCONFIRMED', evidence={
                    'phase': 'retirement_publication_or_confirmation',
                    'cause': getattr(error, 'code', type(error).__name__)}) from error


def export_source(value):
    """Retire an explicitly bound source and publish one durable, resumable handoff."""
    try:
        request = _request(value)
        return _export(request)
    except RecoveryError:
        raise
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError,
            KeyboardInterrupt, subprocess.SubprocessError) as error:
        raise RecoveryError('TRANSFER_UNCONFIRMED', evidence={
            'cause': type(error).__name__, 'detail': str(error)}) from error


def source_readback(value):
    """Observation only; no writes/flushes, confirmed receipt or destination binding."""
    try:
        request = _request(value)
        with _claim(request) as path:
            if path is None:
                status = 'not_started'
            elif not (path/'retirement.json').exists():
                status = 'incomplete'
            else:
                prepared = io.read_record(path/'retirement.json')[0]
                with _Fence(request, False) as fence:
                    current = fence.verify()
                status = ('retired_observed' if current == prepared['retired'] else
                          'prepared' if current == prepared['previous'] else 'stale')
            return dict(v=1, status=status, durability_confirmed=False)
    except RecoveryError as error:
        status = {'REQUEST_MISMATCH': 'request_mismatch', 'PREPARATION_INCOMPLETE': 'incomplete',
                  'CLAIM_BUSY': 'busy', 'AUTHORITY_BUSY': 'busy', 'STALE': 'stale'}.get(error.code, 'unconfirmed')
        return dict(v=1, status=status, durability_confirmed=False, error=error.code)
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError, subprocess.SubprocessError):
        return dict(v=1, status='unconfirmed', durability_confirmed=False, error='TRANSFER_UNCONFIRMED')

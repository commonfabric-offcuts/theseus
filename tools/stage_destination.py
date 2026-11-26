from __future__ import annotations

"""Explicit, offline file staging. No Core, authority or service operations."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import pwd
import shutil
import stat
import subprocess
import sys
import time
import uuid


class Refused(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def canonical(path):
    p = Path(path)
    require(p.is_absolute() and str(p) == str(path), 'noncanonical path')
    require('..' not in p.parts and p.resolve() == p, 'aliased path')
    for parent in [p] + list(p.parents):
        if parent.exists() or parent.is_symlink():
            require(not parent.is_symlink(), 'symlink path')
    return p


def facts(path, private=False, owned=True):
    s = path.lstat()
    require(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode), 'unsupported file type')
    require(not owned or s.st_uid == os.getuid(), 'wrong owner')
    require(not (stat.S_IMODE(s.st_mode) & (0o077 if private else 0o022)), 'unsafe mode')
    require(not (s.st_mode & 0o7000), 'special mode')
    require(not stat.S_ISREG(s.st_mode) or s.st_nlink == 1, 'hardlinked file')
    return s


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid,
            s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def file_hash(path, private=False, owned=True):
    canonical(path)
    before = facts(path, private, owned)
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        require(identity(before) == identity(os.fstat(f.fileno())), 'file replaced')
        h = hashlib.sha256()
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
        require(identity(before) == identity(os.fstat(f.fileno())), 'file changed')
    require(identity(before) == identity(path.lstat()), 'path changed')
    return h.hexdigest(), before


def private_parent(path):
    p = canonical(path)
    require(stat.S_ISDIR(facts(p, True).st_mode), 'parent is not directory')
    return p


def read_json(path, digest=None):
    p = canonical(path)
    h, s = file_hash(p, True, owned=False)
    require(stat.S_IMODE(s.st_mode) == 0o600, 'JSON mode must be 0600')
    require(digest is None or h == digest, 'manifest digest mismatch')
    # Check the parsed bytes against the pinned hash too.
    raw = p.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == h, 'JSON changed')
    def unique(pairs):
        result = {}
        for k, v in pairs:
            require(k not in result, 'duplicate JSON key')
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=unique), h


def write_new(path, value):
    p = Path(path)
    private_parent(p.parent)
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    return hashlib.sha256(raw).hexdigest()


def walk(root):
    canonical(root)
    s = root.lstat()
    require(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode), 'unsupported walk entry')
    yield root
    if stat.S_ISDIR(s.st_mode):
        for name in sorted(os.listdir(root)):
            yield from walk(root / name)


def snapshot(selection):
    require(selection.get('v') == 1 and isinstance(selection.get('roots'), list), 'selection shape')
    sid = selection['selection_id']
    require(str(uuid.UUID(sid)) == sid, 'selection ID')
    entries, labels = [], set()
    for root in selection['roots']:
        label = root['label']
        require(isinstance(label, str) and label and label.replace('-', '').replace('_', '').isalnum(), 'label')
        require(label not in labels and type(root['private']) is bool, 'duplicate root/private flag')
        labels.add(label)
        p = canonical(root['path'])
        initial = facts(p, root['private'])
        for f in walk(p):
            canonical(f)
            s = facts(f, root['private'])
            require(s.st_dev == initial.st_dev, 'cross-mount child')
            key = str(PurePosixPath(label) / f.relative_to(p))
            row = {'path': key, 'kind': 'directory' if stat.S_ISDIR(s.st_mode) else 'file',
                   'source_mode': stat.S_IMODE(s.st_mode), 'source_uid': s.st_uid,
                   'source_gid': s.st_gid}
            if row['kind'] == 'file':
                row['sha256'], stable = file_hash(f, root['private'])
                require(identity(s) == identity(stable), 'scan changed')
                row.update(size=s.st_size, executable=bool(s.st_mode & 0o111))
            entries.append(row)
        require(identity(initial) == identity(p.lstat()), 'root changed')
    require(bool(entries), 'empty selection')
    return {'v': 1, 'selection_id': sid, 'roots': selection['roots'], 'entries': entries,
            'files': sum(e['kind'] == 'file' for e in entries),
            'bytes': sum(e.get('size', 0) for e in entries)}


def validate_manifest(m):
    require(m.get('v') == 1 and isinstance(m.get('entries'), list), 'manifest shape')
    require(str(uuid.UUID(m['selection_id'])) == m['selection_id'], 'manifest ID')
    seen = set()
    for e in m['entries']:
        p = PurePosixPath(e['path'])
        require(not p.is_absolute() and '..' not in p.parts and str(p) == e['path'], 'unsafe relative path')
        require(e['path'] not in seen and e['path'] and e['kind'] in ('file', 'directory'), 'duplicate/type')
        require(len(p.parts) == 1 or str(p.parent) in seen, 'unordered/missing parent')
        seen.add(e['path'])
        if e['kind'] == 'file':
            require(type(e['size']) is int and e['size'] >= 0 and type(e['executable']) is bool, 'file metadata')
            require(len(e['sha256']) == 64 and all(c in '0123456789abcdef' for c in e['sha256']), 'hash')
    require(m['bytes'] == sum(e.get('size', 0) for e in m['entries']), 'byte total')
    require(m['files'] == sum(e['kind'] == 'file' for e in m['entries']), 'file total')


def capacity(parent, selected, extra, reserve):
    require(all(type(x) is int and x >= 0 for x in (selected, extra, reserve)), 'capacity budget')
    free = shutil.disk_usage(parent).free
    require(free >= selected + extra + reserve, 'insufficient capacity')
    return {'free_bytes': free, 'selected_bytes': selected, 'extra_bytes': extra, 'reserve_bytes': reserve}


def account(name):
    user = pwd.getpwnam(name)
    require(os.getuid() == user.pw_uid and os.geteuid() == user.pw_uid, 'wrong executing account')
    return {'account': name, 'uid': os.getuid(), 'gid': os.getgid()}


def verify(m, directory, transport=False, complete=True):
    validate_manifest(m)
    root = canonical(directory)
    facts(root, True, owned=not transport)
    expected = {'data'} | ({'complete.json'} if complete else set()) | {'data/' + e['path'] for e in m['entries']}
    actual = {str(p.relative_to(root)) for p in walk(root) if p != root}
    require(actual == expected, 'missing/extra staging entry')
    require(stat.S_IMODE(facts(root / 'data', True, owned=not transport).st_mode) == 0o700, 'data directory mode')
    for e in m['entries']:
        p = canonical(root / 'data' / e['path'])
        s = facts(p, True, owned=not transport)
        want = 0o700 if e['kind'] == 'directory' or e.get('executable') else 0o600
        require(stat.S_IMODE(s.st_mode) == want, 'staged mode mismatch')
        require(stat.S_ISDIR(s.st_mode) == (e['kind'] == 'directory'), 'staged type mismatch')
        if e['kind'] == 'file':
            h, s = file_hash(p, True, owned=not transport)
            require(s.st_size == e['size'] and h == e['sha256'], 'staged bytes mismatch')
    if not complete:
        return None
    facts(root / 'complete.json', True, owned=not transport)
    receipt, _ = read_json(root / 'complete.json')
    require(receipt['selection_id'] == m['selection_id'] and receipt['files'] == m['files'] and receipt['bytes'] == m['bytes'], 'completion mismatch')
    return receipt


def copy(m, digest, destination, user, extra, reserve, from_directory=None):
    who = account(user)
    validate_manifest(m)
    target = canonical(destination)
    parent = private_parent(target.parent)
    budget = capacity(parent, m['bytes'], extra, reserve)
    if from_directory is not None:
        old = verify(m, from_directory, transport=True)
        require(old['manifest_digest'] == digest, 'transport manifest mismatch')
    roots = {r['label']: r for r in m['roots']}
    target.mkdir(mode=0o700)  # Exclusive; partial attempts are never overwritten.
    (target / 'data').mkdir(mode=0o700)
    for e in m['entries']:
        out = target / 'data' / e['path']
        if e['kind'] == 'directory':
            out.mkdir(mode=0o700)
            continue
        if from_directory is None:
            parts = PurePosixPath(e['path']).parts
            root = roots[parts[0]]
            source = canonical(Path(root['path']).joinpath(*parts[1:]))
            private, owned = root['private'], True
        else:
            source = canonical(Path(from_directory) / 'data' / e['path'])
            private, owned = True, False
        expected_hash, before = file_hash(source, private, owned)
        require(expected_hash == e['sha256'] and before.st_size == e['size'], 'source bytes mismatch')
        read_fd = os.open(str(source), os.O_RDONLY | os.O_NOFOLLOW)
        try:
            require(identity(before) == identity(os.fstat(read_fd)), 'source replaced before copy')
            mode = 0o700 if e['executable'] else 0o600
            write_fd = os.open(str(out), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
            with os.fdopen(write_fd, 'wb') as writer:
                with os.fdopen(os.dup(read_fd), 'rb') as reader:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                writer.flush()
                os.fsync(writer.fileno())
            require(identity(before) == identity(os.fstat(read_fd)), 'source changed during copy')
        finally:
            os.close(read_fd)
    if from_directory is None:
        require(snapshot({'v': 1, 'selection_id': m['selection_id'], 'roots': m['roots']}) == m, 'selection changed during copy')
    verify(m, target, complete=False)
    receipt = dict(who, v=1, selection_id=m['selection_id'], manifest_digest=digest,
                   files=m['files'], bytes=m['bytes'], capacity=budget,
                   status='staged_only', completed_ms=int(time.time() * 1000))
    write_new(target / 'complete.json', receipt)
    verify(m, target)
    return receipt


def mount_facts(info, volume, volume_uuid):
    require(info.get('FilesystemType') == 'apfs', 'transport is not APFS')
    require(info.get('Encryption') is True and info.get('Locked') is False, 'transport is not unlocked encrypted APFS')
    require(info.get('Internal') is False, 'transport is not external')
    require(info.get('WritableVolume') is True, 'transport is not writable')
    require(info.get('GlobalPermissionsEnabled') is True, 'transport ownership is disabled')
    require(info.get('MountPoint') == str(volume) and info.get('VolumeUUID') == volume_uuid, 'transport identity mismatch')
    return {k: info[k] for k in ('VolumeUUID', 'MountPoint', 'FilesystemType',
                                'Encryption', 'Locked', 'Internal', 'WritableVolume',
                                'GlobalPermissionsEnabled')}


def preflight(user, volume, volume_uuid, parent, selected, extra, reserve):
    who = account(user)
    require(sys.version_info[:2] == (3, 9), 'CPython 3.9 required')
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'unsupported runtime architecture')
    volume, parent = canonical(volume), private_parent(parent)
    proc = subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', str(volume)],
                          capture_output=True, check=True, timeout=15)
    mount = mount_facts(plistlib.loads(proc.stdout), volume, volume_uuid)
    require(volume.is_mount(), 'not a mount root')
    return dict(who, v=1, status='readiness_only', mount=mount,
                parent_device=parent.stat().st_dev, volume_device=volume.stat().st_dev,
                local_capacity=capacity(parent, selected, extra, reserve),
                transport_capacity=capacity(volume, selected, 0, reserve),
                python=sys.version, machine=platform.machine(), observed_ms=int(time.time() * 1000))


def copy_preflight(a, m):
    """Check the selected mounted volume immediately before either real copy leg."""
    destination = canonical(a.destination)
    volume = canonical(a.volume)
    result = preflight(a.account, volume, a.volume_uuid, destination.parent,
                       m['bytes'], a.extra_bytes, a.reserve_bytes)
    if a.from_directory is None:
        require(volume in destination.parents, 'source leg must target selected transport')
        require(destination.parent.stat().st_dev == volume.stat().st_dev, 'transport device mismatch')
    else:
        source = canonical(a.from_directory)
        require(volume in source.parents, 'input outside selected transport')
        require(source.stat().st_dev == volume.stat().st_dev, 'input transport device mismatch')
        require(destination.parent.stat().st_dev != volume.stat().st_dev, 'destination must be local, not transport')
        info = subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', str(destination.parent)],
                              capture_output=True, check=True, timeout=15)
        require(plistlib.loads(info.stdout).get('Internal') is True, 'destination is not internal storage')
    return result


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    snap = sub.add_parser('snapshot')
    snap.add_argument('--selection', required=True)
    snap.add_argument('--manifest', required=True)
    for name in ('copy', 'verify'):
        cmd = sub.add_parser(name)
        cmd.add_argument('--manifest', required=True)
        cmd.add_argument('--digest', required=True)
        if name == 'verify':
            cmd.add_argument('--directory', required=True)
            cmd.add_argument('--transport', action='store_true')
        else:
            cmd.add_argument('--destination', required=True)
            cmd.add_argument('--from-directory')
            cmd.add_argument('--account', required=True)
            cmd.add_argument('--volume', required=True)
            cmd.add_argument('--volume-uuid', required=True)
            cmd.add_argument('--extra-bytes', type=int, required=True)
            cmd.add_argument('--reserve-bytes', type=int, required=True)
    pre = sub.add_parser('preflight')
    for key in ('account', 'volume', 'volume-uuid', 'parent', 'receipt'):
        pre.add_argument('--' + key, required=True)
    for key in ('selected-bytes', 'extra-bytes', 'reserve-bytes'):
        pre.add_argument('--' + key, required=True, type=int)
    a = p.parse_args(argv)
    try:
        if a.command == 'snapshot':
            selection, _ = read_json(a.selection)
            m = snapshot(selection)
            digest = write_new(a.manifest, m)
            result = {'status': 'manifest_only', 'digest': digest, 'files': m['files'], 'bytes': m['bytes']}
        elif a.command == 'preflight':
            result = preflight(a.account, a.volume, a.volume_uuid, a.parent,
                               a.selected_bytes, a.extra_bytes, a.reserve_bytes)
            write_new(a.receipt, result)
        else:
            m, digest = read_json(a.manifest, a.digest)
            if a.command == 'copy':
                copy_preflight(a, m)
                result = copy(m, digest, a.destination, a.account, a.extra_bytes,
                              a.reserve_bytes, a.from_directory)
            else:
                result = verify(m, a.directory, a.transport)
                require(result['manifest_digest'] == digest, 'completion digest mismatch')
        # Private receipts/paths/owners stay on disk; stdout contains only small status/totals.
        print(json.dumps({k: result[k] for k in ('status', 'digest', 'files', 'bytes') if k in result}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as e:
        print('REFUSED: ' + (str(e) if isinstance(e, Refused) else type(e).__name__), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

from __future__ import annotations

"""Portable retained-byte parser fixtures; never a new execution or approval.

Original source objects, raw artifacts and API snapshots are hash checked before
use. Only local artifact-reference paths are relocated into a temporary folder;
their original documents remain in the fixture. Synthetic controls stay marked
as such by their callers. Nothing reads the coordinator's machine or network.
"""
import atexit
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).parent / 'fixtures/own_receipts'
MANIFEST = json.loads((ROOT / 'manifest.json').read_bytes())
_temp = None
_repo = None
_relocated = {}


def raw(ref):
    path = (ROOT / ref['file']).resolve()
    if ROOT.resolve() not in path.parents:
        raise ValueError('fixture path escapes its root')
    data = path.read_bytes()
    if ref.get('encoding') == 'gzip':
        if hashlib.sha256(data).hexdigest() != ref['stored_sha256']:
            raise ValueError('compressed fixture digest differs')
        data = gzip.decompress(data)
    if len(data) != ref['bytes'] or hashlib.sha256(data).hexdigest() != ref['sha256']:
        raise ValueError('retained fixture digest differs')
    return data


def directory():
    global _temp
    if _temp is None:
        _temp = tempfile.TemporaryDirectory(prefix='theseus-retained-fixture-')
        atexit.register(_temp.cleanup)
    return Path(_temp.name)


def git_command():
    global _repo
    if _repo is None:
        repo = directory() / 'git'
        subprocess.run(['git', 'init', '--bare', str(repo)], check=True, capture_output=True)
        subprocess.run(['git', '--git-dir=' + str(repo), 'index-pack', '--stdin'],
                       input=raw(MANIFEST['git']['pack']), check=True, capture_output=True)
        for head, tree in MANIFEST['git']['heads'].items():
            actual = subprocess.check_output(['git', '--git-dir=' + str(repo), 'rev-parse', head + '^{tree}'])
            if actual.decode().strip() != tree:
                raise ValueError('retained source tree differs')
        _repo = repo
    return ['git', '--git-dir=' + str(_repo), '-c', 'core.hooksPath=/dev/null']


def _reference(original):
    if original in _relocated:
        return _relocated[original]
    data = raw(MANIFEST['files'][original])
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        value = None
    changed = False
    def walk(node):
        nonlocal changed
        if isinstance(node, dict):
            if set(node) == {'path', 'sha256'} and node['path'] in MANIFEST['files']:
                if MANIFEST['files'][node['path']]['sha256'] != node['sha256']:
                    raise ValueError('original artifact reference digest differs')
                changed = True
                return _reference(node['path'])
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node
    relocated = walk(value)
    if changed:
        data = json.dumps(relocated, sort_keys=True).encode()
    sha = hashlib.sha256(data).hexdigest()
    path = directory() / sha
    path.write_bytes(data)
    result = {'path': str(path), 'sha256': sha}
    _relocated[original] = result
    return result


def package(name):
    folder = directory() / ('package-' + name)
    folder.mkdir(exist_ok=True)
    for filename, original in MANIFEST['packages'][name].items():
        ref = _reference(original)
        (folder / filename).write_bytes(Path(ref['path']).read_bytes())
    return folder


def evidence():
    folder = directory() / 'evidence'
    for name, ref in MANIFEST['evidence'].items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw(ref))
    return folder


def replay_members(item, engine):
    """Exact selected raw members, explicitly not a repackaged genuine ZIP."""
    return {name: raw(ref) for name, ref in MANIFEST['replays'][item + '-' + engine]['members'].items()}

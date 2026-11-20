from __future__ import annotations

"""Verified source snapshots for hosted runners, independent of the web root."""

import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import uuid


ROOTS = ('aim_next/', 'bin/')
POLICY = 'tools/runner_runtime.py'
REQUIRED = {'aim_next/store.py', 'bin/aim-next-runner', POLICY}


class Refused(Exception):
    pass


def require(value, reason):
    if not value:
        raise Refused(reason)


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    require(result.returncode == 0, 'runner source cannot be read from Git')
    return result.stdout


def protected(repo, revision):
    require(isinstance(revision, str) and re.fullmatch('[0-9a-f]{40}', revision), 'invalid runner source revision')
    records = {}
    for row in git(repo, 'ls-tree', '-rz', revision, '--', 'aim_next', 'bin', POLICY).split(b'\0'):
        if not row:
            continue
        head, name = row.split(b'\t', 1)
        mode, kind, oid = head.decode('ascii').split()
        name = name.decode('utf-8')
        require(kind == 'blob' and mode in ('100644', '100755') and
                (name.startswith(ROOTS) or name == POLICY) and
                all(part not in ('', '.', '..') for part in name.split('/')), 'unsupported runner source entry')
        records[name] = {'oid': oid, 'executable': mode == '100755'}
    require(REQUIRED <= set(records), 'runner source is incomplete')
    return records


def schema(repo, revision):
    try:
        tree = ast.parse(git(repo, 'show', revision + ':aim_next/store.py').decode('utf-8'))
        values = [node.value.value for node in tree.body if isinstance(node, ast.Assign) and
                  any(isinstance(target, ast.Name) and target.id == 'SCHEMA_VERSION' for target in node.targets) and
                  isinstance(node.value, ast.Constant)]
    except (ValueError, SyntaxError, UnicodeError) as error:
        raise Refused('runner schema cannot be read') from error
    require(len(values) == 1 and isinstance(values[0], str) and values[0].isdigit(), 'runner schema is not literal')
    return values[0]


def _regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
            'runner source is not an owned regular file')
    for parent in path.parents:
        if parent == Path(path.anchor):
            break
        require(not parent.is_symlink(), 'runner source contains a symlink')
    return path.read_bytes()


def verify(repo, instance, record):
    require(isinstance(record, dict) and set(record) == {'v', 'revision', 'root', 'schema', 'files'} and
            type(record['v']) is int and record['v'] == 1, 'invalid runner source record')
    require(isinstance(record['revision'], str) and re.fullmatch('[0-9a-f]{40}', record['revision']), 'invalid runner source revision')
    expected_root = Path(instance) / 'runner-sources' / record['revision']
    require(str(expected_root) == record['root'] and expected_root.resolve() == expected_root,
            'runner source is outside its pinned location')
    entries = protected(repo, record['revision'])
    require(record['schema'] == schema(repo, record['revision']) and isinstance(record['files'], dict) and
            set(entries) == set(record['files']), 'runner source manifest does not match Git')
    require(json.loads(_regular(expected_root / 'source.json')) == record, 'runner source markers disagree')
    found = set()
    for path in expected_root.rglob('*'):
        require(not path.is_symlink(), 'runner source contains a symlink')
        if path.is_file():
            found.add(str(path.relative_to(expected_root)))
    require(found == set(entries) | {'source.json'}, 'runner source has missing or extra files')
    for name, entry in entries.items():
        facts = record['files'][name]
        require(isinstance(facts, dict) and set(facts) == {'oid', 'sha256', 'executable'} and
                all(facts[key] == entry[key] for key in entry), 'runner source file identity changed')
        data = _regular(expected_root / name)
        oid = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
        require(oid == entry['oid'] and hashlib.sha256(data).hexdigest() == facts['sha256'] and
                bool((expected_root / name).stat().st_mode & 0o111) == entry['executable'],
                'pinned runner source was changed')
    return record


def latest_run(config):
    runs = sorted((path for path in config.instance.glob('run-runner-*') if path.name.rsplit('-', 1)[1].isdigit()),
                  key=lambda path: int(path.name.rsplit('-', 1)[1]))
    return runs[-1] if runs else None


def latest(config):
    run = latest_run(config)
    path = run / 'source.json' if run else None
    if path is None:
        return None
    if not path.exists():
        require(not path.is_symlink() and not (run / 'host-inputs.json').exists(), 'runner source marker is missing')
        return None
    try:
        return verify(config.live, config.instance, json.loads(_regular(path)))
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise Refused('runner source record cannot be verified') from error


def policy(config, candidate):
    current = latest(config)
    if current is None:
        return {'kind': 'restart', 'reason': 'legacy_host', 'source': None, 'files': []}
    try:
        startup = inputs(config)
        same_inputs = json.loads(_regular(latest_run(config) / 'host-inputs.json')) == startup
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise Refused('hosted startup inputs cannot be verified') from error
    before, after = protected(config.live, current['revision']), protected(config.live, candidate)
    paths = sorted(set(before) | set(after))
    changed = [name for name in paths if before.get(name) != after.get(name)]
    same_schema = current['schema'] == schema(config.live, candidate)
    return {'kind': 'keep' if same_schema and not changed and same_inputs else 'restart',
            'reason': 'compatible' if same_schema and not changed and same_inputs else 'runtime_schema_or_inputs_changed',
            'source': current, 'inputs': startup, 'files': paths, 'changed': changed}


def inputs(config):
    """Startup map/config hashes only; never copy profile or authentication contents."""
    mapping = json.loads(_regular(config.routes))
    require(isinstance(mapping, dict) and isinstance(mapping.get('routes'), dict), 'invalid runner route map')
    paths = [str(config.routes)] + list(mapping['routes'].values())
    require(all(isinstance(path, str) and Path(path).is_absolute() for path in paths), 'invalid runner route path')
    return {path: hashlib.sha256(_regular(Path(path))).hexdigest() for path in sorted(set(paths))}


def hosted_routes(config):
    # A missing legacy map never establishes a pin. Any supplied map and its
    # direct configs must be closed regular files before reading their bytes.
    if not config.routes.exists() and not config.routes.is_symlink():
        return False
    inputs(config)
    mapping = json.loads(_regular(config.routes))
    records = [json.loads(_regular(Path(path))) for path in mapping['routes'].values()]
    require(all(isinstance(record, dict) for record in records), 'invalid runner route config')
    return any(record.get('kind') == 'codex-hosted-stdio' for record in records)


def prepare(config, revision):
    if not hosted_routes(config):
        return None
    entries = protected(config.live, revision)
    parent = config.instance / 'runner-sources'
    require(config.instance.resolve() == config.instance and config.instance.is_dir(), 'invalid runner instance directory')
    parent.mkdir(mode=0o700, exist_ok=True)
    require(parent.resolve() == parent and stat.S_ISDIR(parent.lstat().st_mode), 'invalid runner source directory')
    root = parent / revision
    if root.exists():
        try:
            return verify(config.live, config.instance, json.loads(_regular(root / 'source.json')))
        except (OSError, ValueError) as error:
            raise Refused('existing runner source is incomplete') from error
    staged = parent / (revision + '.preparing-' + uuid.uuid4().hex)
    staged.mkdir(mode=0o700)
    try:
        files = {}
        for name, entry in entries.items():
            data = git(config.live, 'show', revision + ':' + name)
            target = staged / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o700 if entry['executable'] else 0o600)
            files[name] = dict(entry, sha256=hashlib.sha256(data).hexdigest())
        record = {'v': 1, 'revision': revision, 'root': str(root), 'schema': schema(config.live, revision), 'files': files}
        (staged / 'source.json').write_text(json.dumps(record, sort_keys=True) + '\n')
        (staged / 'source.json').chmod(0o600)
        os.rename(str(staged), str(root))
        return verify(config.live, config.instance, record)
    finally:
        if staged.exists():
            shutil.rmtree(staged)

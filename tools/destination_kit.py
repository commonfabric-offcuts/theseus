from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import stat
import subprocess
import uuid
from urllib.parse import urlsplit

LANDING_PATHS = {'profile', 'live', 'instance', 'work', 'clone', 'worktrees', 'scratch', 'coordinator', 'ship', 'posts'}
IDENTITY = {'seat', 'workspace', 'remote', 'repo', 'release_branch', 'guard', 'cards_note', 'releases_topic', 'dossier_tells'}
DEPLOY_REQUIRED = {'live', 'instance', 'server_profile', 'port', 'runner_profile', 'runner_id', 'routes'}
DEPLOY_OPTIONAL = {'python', 'tailnet_origin', 'outcome', 'reporter_profile', 'release_branch', 'repository', 'pipeline_outcome', 'pipeline_instance', 'pipeline_broker', 'pipeline_profile', 'seat_template'}
PENDING = ['1306 confirmed durable activation', '1307 supported profile/route rebinding',
           'destination account/staged kit and Python3.9/native architecture/Node v26.12.1/gh/Codex0.167.0-alpha.3.2 receipts',
           'Warp1315 reviewed adoption and selected encrypted APFS medium identity/behavior']
REQUIRED_VERSIONS = {'python': 'CPython3.9.x', 'node': 'v26.12.1', 'codex': '0.167.0-alpha.3.2', 'architecture': 'arm64'}


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    require(isinstance(value, str) and value.startswith('/'), 'absolute path required')
    p = Path(value)
    require(str(p) == value and '..' not in p.parts and p.resolve() == p, 'canonical path required')
    return p


def no_symlinks(path):
    for p in [path, *path.parents]:
        require(not p.is_symlink(), 'symlink path refused')


def private(path, directory=False):
    no_symlinks(path)
    s = path.lstat()
    require(s.st_uid == os.getuid(), 'wrong local owner')
    require(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode), 'wrong file type')
    require(stat.S_IMODE(s.st_mode) == (0o700 if directory else 0o600), 'private modes required')
    if not directory:
        require(s.st_nlink == 1, 'hard link refused')


def read(path):
    with Path(path).open('rb') as f:
        data = f.read(4 * 1024 * 1024 + 1)
    require(len(data) <= 4 * 1024 * 1024, 'input exceeds bound')
    def unique(pairs):
        result = {}
        for k, v in pairs:
            require(k not in result, 'duplicate JSON key')
            result[k] = v
        return result
    return json.loads(data, object_pairs_hook=unique)


def checked_file(path, expected):
    p = canonical(str(path)); no_symlinks(p)
    require(p.is_file(), 'missing source file')
    require(re.fullmatch('[0-9a-f]{64}', expected) is not None, 'invalid hash')
    require(sha(p.read_bytes()) == expected, 'source hash differs: ' + str(p))


def verify_inventory(value):
    require(value.get('v') == 1 and type(value.get('files')) is list and 0 < len(value['files']) <= 2048, 'bounded inventory required')
    require(len({x['path'] for x in value['files']}) == len(value['files']), 'duplicate source path')
    for item in value['files']:
        require(set(item) == {'path', 'sha256'}, 'source file fields differ')
        checked_file(item['path'], item['sha256'])


def inventory(landing_config, repo):
    config_path = canonical(str(landing_config)); config = read(config_path)
    require(set(config) >= LANDING_PATHS | IDENTITY, 'incomplete landing config')
    co = canonical(config['coordinator']); guard_path = co / config['guard']; guard = read(guard_path)
    checked_file(guard['tool'], guard['tool_sha256'])
    checked_file(guard['source_manifest'], guard['source_manifest_sha256'])
    paths = {config_path, guard_path, Path(guard['tool']), Path(guard['source_manifest']), co / 'deploy-trains.json', Path(config['ship'])}
    for name, digest in guard['verified_file_sha256'].items():
        require(not Path(name).is_absolute() and '..' not in Path(name).parts, 'unsafe guard relative path')
        p = Path(guard['checkout']) / name; checked_file(p, digest); paths.add(p)
    repo = canonical(str(repo))
    paths.update(p for p in (repo / 'tools/landing').iterdir() if p.is_file() and p.suffix in {'.py', '.sh', '.mjs', '.json'})
    paths.update(p for p in Path(config['ship']).parent.glob('*.py') if p.is_file())
    if config.get('on_live'):
        argv = shlex.split(config['on_live'])
        require(len(argv) == 2 and argv[0] in ['bash', '/bin/bash'], 'unsupported on_live inventory command')
        paths.add(canonical(argv[1]))
    result = {'v': 1, 'source_host': platform.node(), 'source_head': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
              'guard_head': guard['head'], 'identity': {k: config[k] for k in IDENTITY},
              'files': [{'path': str(p), 'sha256': sha(p.read_bytes())} for p in sorted(paths)]}
    verify_inventory(result)
    return result


def validate(request):
    require(set(request) == {'v', 'packet_id', 'inventory', 'destination'} and type(request['v']) is int and request['v'] == 1, 'unsupported request fields/version')
    require(str(uuid.UUID(request['packet_id'])) == request['packet_id'], 'canonical packet UUID required')
    inv, dest = request['inventory'], request['destination']
    require(set(dest) == {'home', 'host', 'landing', 'deploy'}, 'destination fields differ; no binding authority accepted')
    home = canonical(dest['home'])
    require(isinstance(dest['host'], str) and dest['host'] and dest['host'] != inv['source_host'], 'distinct destination host required')
    landing, deploy = dest['landing'], dest['deploy']
    require(set(landing) in [LANDING_PATHS | IDENTITY, LANDING_PATHS | IDENTITY | {'on_live'}], 'landing config fields differ')
    require(set(deploy) >= DEPLOY_REQUIRED and set(deploy) <= DEPLOY_REQUIRED | DEPLOY_OPTIONAL, 'deploy config fields differ')
    for config in [landing, deploy]:
        require(all(isinstance(v, str) and v and '\x00' not in v for k, v in config.items() if k != 'port'), 'config values must be nonempty strings')
    for k in IDENTITY:
        require(landing[k] == inv['identity'][k], 'source identity differs: ' + k)
    for key in LANDING_PATHS:
        require(home in canonical(landing[key]).parents, 'destination path outside home: ' + key)
    for key in ['live', 'instance']:
        require(deploy[key] == landing[key], 'landing/deploy path mismatch')
    for key in ['python', 'pipeline_profile', 'pipeline_broker']:
        if key in deploy:
            p = canonical(deploy[key]);require(key == 'python' or home in p.parents, 'destination path outside home')
    for key in ['server_profile', 'runner_profile', 'routes', 'reporter_profile']:
        if key in deploy:
            p = Path(deploy[key]);require(not p.is_absolute() and len(p.parts) == 1 and p.name not in {'.', '..'}, 'local relative file name required')
    require(type(deploy['port']) is int and 0 < deploy['port'] < 65536, 'invalid port')
    require(deploy.get('release_branch') == landing['release_branch'] and deploy.get('repository') == landing['repo'], 'release identity differs')
    require(('outcome' in deploy) == ('reporter_profile' in deploy), 'reporter/outcome pair required')
    admission = {k for k in deploy if k.startswith('pipeline_')}
    if admission:
        require({'pipeline_outcome', 'pipeline_instance'} <= admission and
                (('pipeline_broker' in admission) != ('pipeline_profile' in admission)),
                'admission needs outcome, instance and exactly one broker or profile')
    require('seat_template' not in deploy or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', deploy['seat_template']), 'invalid seat_template')
    require(re.fullmatch(r'[A-Za-z0-9._/-]+', deploy['release_branch']) and not deploy['release_branch'].startswith(('-', '/')) and '..' not in deploy['release_branch'], 'invalid release branch')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', deploy['repository']), 'invalid repository')
    if 'tailnet_origin' in deploy:
        origin = urlsplit(deploy['tailnet_origin'])
        require(origin.scheme == 'https' and origin.hostname == dest['host'] and origin.port == deploy['port'] and not origin.username and not origin.password and origin.path in ['', '/'] and not origin.query and not origin.fragment, 'explicit destination HTTPS origin required')
    if 'on_live' in landing:
        argv = shlex.split(landing['on_live'])
        require(len(argv) == 2 and argv[0] in ['bash', '/bin/bash'] and home in canonical(argv[1]).parents, 'explicit destination on_live script required')
    verify_inventory(inv)


def sync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def save_exact(path, data):
    if path.exists() or path.is_symlink():
        private(path)
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            require(f.read() == data, 'occupied bytes differ: ' + path.name)
            os.fsync(f.fileno())
        sync_dir(path.parent)
        return
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data);f.flush();os.fsync(f.fileno())
    sync_dir(path.parent)


def payloads(request):
    return {'request.json': encoded(request), 'landing.json': encoded(request['destination']['landing']),
            'deploy.json': encoded(request['destination']['deploy']), 'inventory.json': encoded(request['inventory'])}


def prepare(request, output, disabled=False, checkpoint=None):
    if disabled:return {'status': 'disabled', 'authorized_for_effects': False}
    validate(request)
    output = Path(output);no_symlinks(output);output = canonical(str(output));private(output.parent, directory=True)
    created = False
    try:output.mkdir(mode=0o700);created = True
    except FileExistsError:pass
    private(output, directory=True)
    lock = output / '.lock';fd = os.open(str(lock), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        private(lock);fcntl.flock(fd, fcntl.LOCK_EX)
        require(created or (output / 'request.json').exists(), 'incomplete pack has no request; retain for inspection')
        data = payloads(request)
        require(set(p.name for p in output.iterdir()) <= set(data) | {'.lock', 'manifest.json'}, 'unexpected pack files')
        for name, raw in data.items():
            save_exact(output / name, raw)
            if checkpoint:checkpoint(name)
        receipt = {'v': 1, 'status': 'prepared', 'packet_id': request['packet_id'], 'request_digest': sha(data['request.json']),
                   'mode': 'report-only', 'authorized_for_effects': False, 'pending': PENDING, 'required_versions': REQUIRED_VERSIONS,
                   'files': {name: sha(raw) for name, raw in data.items()}}
        save_exact(output / 'manifest.json', encoded(receipt));sync_dir(output.parent)
        return receipt
    finally:os.close(fd)


def preflight(pack):
    pack = Path(pack);no_symlinks(pack);private(pack, directory=True)
    require((pack / 'manifest.json').exists(), 'incomplete pack');private(pack / 'manifest.json')
    receipt = read(pack / 'manifest.json')
    require(set(p.name for p in pack.iterdir()) == {'request.json', 'landing.json', 'deploy.json', 'inventory.json', 'manifest.json', '.lock'}, 'pack files differ')
    for name, digest in receipt['files'].items():
        require(name in {'request.json', 'landing.json', 'deploy.json', 'inventory.json'}, 'unexpected manifest path')
        private(pack / name);require(sha((pack / name).read_bytes()) == digest, 'pack hash differs')
    request = read(pack / 'request.json');validate(request)
    expected = {'v': 1, 'status': 'prepared', 'packet_id': request['packet_id'], 'request_digest': sha(encoded(request)),
                'mode': 'report-only', 'authorized_for_effects': False, 'pending': PENDING, 'required_versions': REQUIRED_VERSIONS,
                'files': {name: sha(raw) for name, raw in payloads(request).items()}}
    require(receipt == expected, 'manifest/request differs')
    return dict(receipt, status='preflight-report')


def main():
    parser = argparse.ArgumentParser(description='Prepare proposed destination kit config; no operational effects.')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('inventory');p.add_argument('--landing-config', type=Path, required=True);p.add_argument('--repo', type=Path, required=True)
    p = sub.add_parser('prepare');p.add_argument('--request', type=Path, required=True);p.add_argument('--output', type=Path, required=True);p.add_argument('--disabled', action='store_true')
    p = sub.add_parser('preflight');p.add_argument('--pack', type=Path, required=True);p.add_argument('--disabled', action='store_true')
    args = parser.parse_args()
    try:
        if getattr(args, 'disabled', False):result = {'status': 'disabled', 'authorized_for_effects': False}
        elif args.action == 'inventory':result = inventory(args.landing_config, args.repo)
        elif args.action == 'prepare':result = prepare(read(args.request), args.output)
        else:result = preflight(args.pack)
        print(json.dumps(result, sort_keys=True));return 0
    except (Refused, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'refused', 'reason': str(error), 'authorized_for_effects': False}));return 2


if __name__ == '__main__':
    raise SystemExit(main())

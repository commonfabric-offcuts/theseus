from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(os.environ['FLEX_1298_EVIDENCE'])
HERE = Path(__file__).resolve().parent
REPO = Path(os.environ['FLEX_PRODUCT_REPO'])
LOCK = Path('/Users/commonfabric/aim-next/tools/lane_lock.py')


def saved(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def snapshot(label, name):
    paths = list(HERE.glob('1298_*'))
    for directory in [REPO / 'web', REPO / 'aim_next']:
        paths += [p for p in directory.rglob('*') if p.is_file() and p.suffix in ('.py', '.mjs', '.html', '.css', '.js')]
    paths += [LOCK]
    paths += [p for p in [ROOT / 'seed-ledger.json', ROOT / 'seed/frozen.sqlite3'] if p.exists()]
    blobs = ROOT / 'input-blobs'; blobs.mkdir(exist_ok=True)
    result = {}
    for path in paths:
        raw = path.read_bytes(); sha = hashlib.sha256(raw).hexdigest()
        dest = blobs / sha
        if not dest.exists():
            dest.write_bytes(raw)
        result[str(path)] = {'bytes': len(raw), 'sha256': sha}
    saved(ROOT / (name + '-' + label + '-inputs.json'), result)
    return result


def main():
    name, mode = sys.argv[1:3]
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if len(sys.argv) > 3 and sys.argv[3] == 'entered':
        start = time.time_ns() // 1000000
        while os.getloadavg()[0] >= 12:
            time.sleep(1)
        before = snapshot('entry', name)
        saved(ROOT / (name + '-entry.json'), {'admitted_ms': start, 'entered_ms': time.time_ns() // 1000000,
              'pid': os.getpid(), 'pgid': os.getpgid(0), 'load': os.getloadavg(), 'priority': os.getpriority(os.PRIO_PROCESS, 0)})
        if mode == 'prepare':
            argv = ['/usr/bin/python3', '-X', 'pycache_prefix=' + str(ROOT / (name + '-pycache')), '-I', str(HERE / '1298_fixture.py'), 'prepare']
        elif mode == 'syntax':
            argv = ['node', '--check', str(HERE / '1298_capture.mjs')]
        elif mode == 'native':
            argv = ['node', str(HERE / '1298_capture.mjs')]
        else:
            raise ValueError(mode)
        saved(ROOT / (name + '-child-argv.json'), argv)
        child = subprocess.Popen(argv, cwd=REPO)
        saved(ROOT / (name + '-child.json'), {'pid': child.pid, 'pgid': os.getpgid(child.pid), 'parent': os.getpid()})
        code = child.wait()
        after = snapshot('after', name)
        common = set(before) & set(after)
        saved(ROOT / (name + '-entered-terminal.json'), {'exit': code, 'child_reaped': True,
              'ended_ms': time.time_ns() // 1000000, 'common_unchanged': all(before[p] == after[p] for p in common),
              'new_paths': sorted(set(after) - set(before)), 'removed_paths': sorted(set(before) - set(after))})
        return code
    folder = ROOT / (name + '-wrapper'); folder.mkdir(exist_ok=False)
    queued = snapshot('queued', name)
    argv = ['/usr/bin/python3', '-I', str(LOCK), 'run', '--label', '1298 ' + name, '--',
            '/usr/bin/nice', '-n', '15', '/usr/bin/python3', '-I', str(Path(__file__).resolve()), name, mode, 'entered']
    saved(folder / 'argv.json', argv)
    with (folder / 'stdout').open('wb') as out, (folder / 'stderr').open('wb') as err:
        started = time.time_ns() // 1000000
        child = subprocess.Popen(argv, stdout=out, stderr=err, start_new_session=True)
        saved(folder / 'ownership.json', {'supervisor': os.getpid(), 'wrapper': child.pid, 'pgid': child.pid, 'started_ms': started})
        print('wrapper ' + str(child.pid), flush=True)
        code = child.wait()
    try:
        os.killpg(child.pid, 0); empty = False
    except ProcessLookupError:
        empty = True
    saved(folder / 'terminal.json', {'exit': code, 'wrapper_reaped': True, 'group_empty': empty,
          'started_ms': started, 'ended_ms': time.time_ns() // 1000000})
    print(json.dumps({'exit': code, 'group_empty': empty}), flush=True)
    return code


if __name__ == '__main__':
    raise SystemExit(main())

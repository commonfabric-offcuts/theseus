from __future__ import annotations

"""Fixed-input, installed-lock and original lifecycle receipts for 1285."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
EVIDENCE = Path(os.environ['FLEX_DIAGNOSTIC_EVIDENCE'])
REPO = Path(os.environ['FLEX_PRODUCT_REPO'])
NAME = sys.argv[1]
LOCK = Path('/Users/commonfabric/aim-next/tools/lane_lock.py')
CHROME = Path('/Users/commonfabric/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
NODE = Path(shutil.which('node')).resolve()
PYTHON = Path(sys.executable).resolve()
MODE = os.environ.get('FLEX_1285_MODE', 'native')


def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2) + '\n')


def snapshot(label):
    blobs = EVIDENCE / 'input-blobs'
    blobs.mkdir(exist_ok=True)
    paths = list(HERE.glob('dossier1285*')) + [HERE / 'dossier1279_observe.mjs']
    for folder in [REPO / 'web', REPO / 'aim_next']:
        paths += [p for p in folder.rglob('*') if p.is_file() and p.suffix in ['.py', '.mjs', '.html', '.css', '.js']]
    paths += [LOCK, REPO / 'bin/aim-next-server', NODE, PYTHON, CHROME,
              Path('/Users/commonfabric/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/1.59.1/index.mjs')]
    for directory in [EVIDENCE / 'baseline-v4', Path(os.environ['FLEX_ORIGINAL_BASELINE'])]:
        paths += list(directory.iterdir()) if directory.exists() else []
    result = {}
    for path in paths:
        if not path.is_file():
            continue
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if not (blobs / digest).exists():
            (blobs / digest).write_bytes(raw)
        result[str(path)] = {'sha256': digest, 'bytes': len(raw)}
    save(NAME + '-' + label + '-inputs.json', result)
    return result


if len(sys.argv) > 2 and sys.argv[2] == 'entered':
    admitted = int(time.time() * 1000)
    while os.getloadavg()[0] >= 12:
        time.sleep(1)
    before = snapshot('entry')
    queued = json.loads((EVIDENCE / (NAME + '-queued-inputs.json')).read_text())
    if before != queued:
        save(NAME + '-entry-refusal.json', {'reason': 'Named inputs changed while queued', 'entered_ms': int(time.time()*1000)})
        raise SystemExit(2)
    save(NAME + '-entry.json', {'admitted_ms': admitted, 'entered_ms': int(time.time()*1000),
         'pid': os.getpid(), 'pgid': os.getpgid(0), 'load': os.getloadavg(),
         'priority': os.getpriority(os.PRIO_PROCESS, 0), 'mode': MODE, 'cwd': os.getcwd(),
         'python': {'executable': str(PYTHON), 'version': sys.version, 'pycache_prefix': sys.pycache_prefix},
         'node': {'executable': str(NODE), 'version': subprocess.check_output([str(NODE), '--version'], text=True).strip()}})
    if MODE == 'derive':
        argv = [str(PYTHON), '-X', 'pycache_prefix=' + str(EVIDENCE / (NAME + '-pycache')), '-I',
                str(HERE / 'dossier1285_fixture.py'), str(EVIDENCE / (NAME + '-fixture')), 'derive']
    elif MODE == 'syntax':
        argv = [str(NODE), '--check', str(HERE / 'dossier1285.mjs')]
    else:
        argv = [str(NODE), str(HERE / 'dossier1285.mjs'), NAME]
    child = subprocess.Popen(argv, cwd=str(REPO))
    save(NAME + '-child.json', {'argv': argv, 'pid': child.pid, 'parent': os.getpid(), 'pgid': os.getpgid(child.pid)})
    code = child.wait()
    after = snapshot('after')
    save(NAME + '-entered-terminal.json', {'exit': code, 'child_reaped': True, 'ended_ms': int(time.time()*1000),
         'inputs_identical': before == after, 'common_unchanged': all(before[k] == after[k] for k in set(before) & set(after)),
         'new_paths': sorted(set(after) - set(before)), 'removed_paths': sorted(set(before) - set(after))})
    if MODE == 'native' and before != after:
        code = 2
    raise SystemExit(code)

out = EVIDENCE / (NAME + '-wrapper')
out.mkdir()
snapshot('queued')
argv = ['/usr/bin/python3', '-I', str(LOCK), 'run', '--label', '1285 ' + MODE + ' ' + NAME, '--',
        '/usr/bin/nice', '-n', '15', str(PYTHON), '-X', 'pycache_prefix=' + str(EVIDENCE / (NAME + '-wrapper-pycache')),
        '-I', str(Path(__file__).resolve()), NAME, 'entered']
(out / 'argv.json').write_text(json.dumps(argv, indent=2) + '\n')
with (out / 'stdout').open('wb') as stdout, (out / 'stderr').open('wb') as stderr:
    started = int(time.time()*1000)
    child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, start_new_session=True, cwd=str(REPO))
    (out / 'ownership.json').write_text(json.dumps({'supervisor': os.getpid(), 'wrapper': child.pid, 'pgid': child.pid, 'started_ms': started}))
    print('wrapper ' + str(child.pid), flush=True)
    code = child.wait()
try:
    os.killpg(child.pid, 0)
    empty = False
except ProcessLookupError:
    empty = True
(out / 'terminal.json').write_text(json.dumps({'exit': code, 'wrapper_reaped': True, 'group_empty': empty,
    'started_ms': started, 'ended_ms': int(time.time()*1000)}))
print(json.dumps({'exit': code, 'group_empty': empty}), flush=True)
raise SystemExit(code)

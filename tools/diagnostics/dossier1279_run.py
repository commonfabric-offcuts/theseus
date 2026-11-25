from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
EVIDENCE = Path(os.environ['FLEX_DIAGNOSTIC_EVIDENCE'])
REPO = Path(os.environ['FLEX_PRODUCT_REPO'])
NAME = sys.argv[1]
LOCK = Path('/Users/commonfabric/aim-next/tools/lane_lock.py')

def snapshot(label):
    blobs = EVIDENCE / 'input-blobs';blobs.mkdir(exist_ok=True)
    paths = list(HERE.glob('dossier1279*'))
    for folder in [REPO/'web', REPO/'aim_next']:
        paths += [p for p in folder.rglob('*') if p.is_file() and p.suffix in ['.py','.mjs','.html','.css','.js']]
    paths += [LOCK, REPO/'bin/aim-next-server']
    if (EVIDENCE/'baseline-v2').exists(): paths += list((EVIDENCE/'baseline-v2').iterdir())
    result = {}
    for path in paths:
        if not path.is_file(): continue
        raw = path.read_bytes();sha = hashlib.sha256(raw).hexdigest()
        if not (blobs/sha).exists(): (blobs/sha).write_bytes(raw)
        result[str(path)]={'sha256':sha,'bytes':len(raw)}
    (EVIDENCE/(NAME+'-'+label+'-inputs.json')).write_text(json.dumps(result,indent=2))
    return result

if len(sys.argv)>2 and sys.argv[2]=='entered':
    admitted = int(time.time()*1000)
    while os.getloadavg()[0]>=12: time.sleep(1)
    before = snapshot('entry')
    (EVIDENCE/(NAME+'-entry.json')).write_text(json.dumps({'admitted_ms':admitted,'entered_ms':int(time.time()*1000),
        'pid':os.getpid(),'pgid':os.getpgid(0),'load':os.getloadavg(),'priority':os.getpriority(os.PRIO_PROCESS,0)}))
    child=subprocess.Popen(['node',str(HERE/'dossier1279.mjs'),NAME])
    (EVIDENCE/(NAME+'-child.json')).write_text(json.dumps({'pid':child.pid,'parent':os.getpid(),'pgid':os.getpgid(child.pid)}))
    code=child.wait();after=snapshot('after')
    common=set(before)&set(after)
    (EVIDENCE/(NAME+'-entered-terminal.json')).write_text(json.dumps({'exit':code,'child_reaped':True,
        'ended_ms':int(time.time()*1000),'common_unchanged':all(before[k]==after[k] for k in common),
        'new_paths':sorted(set(after)-set(before))}))
    raise SystemExit(code)

out=EVIDENCE/(NAME+'-wrapper');out.mkdir()
snapshot('queued')
argv=['/usr/bin/python3','-I',str(LOCK),'run','--label','1279 pinned native '+NAME,'--',
      '/usr/bin/nice','-n','15','/usr/bin/python3','-I',str(Path(__file__).resolve()),NAME,'entered']
(out/'argv.json').write_text(json.dumps(argv))
with (out/'stdout').open('wb') as stdout,(out/'stderr').open('wb') as stderr:
    started=int(time.time()*1000)
    child=subprocess.Popen(argv,stdout=stdout,stderr=stderr,start_new_session=True)
    (out/'ownership.json').write_text(json.dumps({'supervisor':os.getpid(),'wrapper':child.pid,'pgid':child.pid,'started_ms':started}))
    print('wrapper '+str(child.pid),flush=True)
    code=child.wait()
try: os.killpg(child.pid,0);empty=False
except ProcessLookupError: empty=True
(out/'terminal.json').write_text(json.dumps({'exit':code,'wrapper_reaped':True,'group_empty':empty,
    'started_ms':started,'ended_ms':int(time.time()*1000)}))
print(json.dumps({'exit':code,'group_empty':empty}),flush=True)
raise SystemExit(code)

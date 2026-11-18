from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[2]
out = root / 'evidence' / '646'
mutations = [
    ('privacy', 'aim_next/stacks.py', b"WHERE a.owner=:actor AND a.kind='star' AND a.topic_id=:topic", b"WHERE a.kind='star' AND a.topic_id=:topic", 'test_partial_page_carries_actual_root'),
    ('reach', 'aim_next/stacks.py', b'if message is None or not visible(message, actor):', b'if message is None:', 'test_partial_page_carries_actual_root'),
    ('identity', 'aim_next/stacks.py', b'        return at\n\n\n# The messages of the dossier', b'        return mid\n\n\n# The messages of the dossier', 'test_partial_page_carries_actual_root'),
    ('response', 'aim_next/stacks.py', b'result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"]}', b'result = {"message_id": "wrong-root-646", "topic_id": message["topic_id"], "seq": message["seq"]}', 'test_exact_response_operation_and_persistence'),
    ('persistence', 'aim_next/stacks.py', b'version = self._record_act(db, kind, message, owner, actor, value, revision, tell=back is None)', b'version = 0  # applied 646 source mutant: no durable star row', 'test_exact_response_operation_and_persistence'),
    ('operation', 'aim_next/store.py', b'return json.loads(previous["outcome"])', b'return dict(json.loads(previous["outcome"]), recorded=False)', 'test_exact_response_operation_and_persistence'),
]
records=[]
for name, filename, old, new, intended in mutations:
    path=root/filename
    before=path.read_bytes()
    assert before.count(old)==1,(name,before.count(old))
    after=before.replace(old,new)
    record={'name':name,'file':filename,'before_sha256':hashlib.sha256(before).hexdigest(),'after_sha256':hashlib.sha256(after).hexdigest(),'intended':intended}
    try:
        path.write_bytes(after)
        assert path.read_bytes()==after and before!=after
        for phase in ['red']:
            cache='/private/tmp/646-'+name+'-'+phase+'-'+uuid.uuid4().hex
            log=out/(name+'-'+phase+'.log')
            with log.open('w') as stream:
                run=subprocess.run(['/usr/bin/python3','-m','unittest','discover','-s','tests','-p','test_item_646.py','-v'],cwd=str(root),env={'PATH':'/usr/bin:/bin','PYTHONPYCACHEPREFIX':cache},stdout=stream,stderr=subprocess.STDOUT)
            record[phase]={'exit':run.returncode,'log':str(log.relative_to(root)),'cache':cache}
            text=log.read_text()
            assert run.returncode!=0 and 'FAIL: '+intended in text,(name,text)
    finally:
        path.write_bytes(before)
        assert path.read_bytes()==before
        cache='/private/tmp/646-'+name+'-restored-'+uuid.uuid4().hex
        log=out/(name+'-restored.log')
        with log.open('w') as stream:
            run=subprocess.run(['/usr/bin/python3','-m','unittest','discover','-s','tests','-p','test_item_646.py','-v'],cwd=str(root),env={'PATH':'/usr/bin:/bin','PYTHONPYCACHEPREFIX':cache},stdout=stream,stderr=subprocess.STDOUT)
        record['restored']={'exit':run.returncode,'log':str(log.relative_to(root)),'cache':cache,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        records.append(record)
        (out/'core-mutations.json').write_text(json.dumps(records,indent=2)+'\n')
        assert run.returncode==0,(name,log.read_text())
print(json.dumps(records,indent=2))

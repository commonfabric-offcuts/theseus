from __future__ import annotations

"""Real scratch Core freezes, then content-only native component origins."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading

source=Path(sys.argv[1]).resolve()
sys.path[:0]=[str(source),str(source/'tests')]
from aim_next.server import create_server
from test_gauntlet_987 import Freeze987

case=Freeze987('test_987_actual_freeze_is_shared_by_views_and_keeps_source_and_provenance')
servers=[];threads=[]
case.setUp()
try:
    piece=case.piece([1])
    before=case.store.view('agent-b','pipeline',{'workspace_id':'w1'})
    case.committed(case.freeze(piece,['web/a']))
    ordinary=case.store.view('agent-b','pipeline',{'workspace_id':'w1'})
    case.committed(case.freeze(piece))
    judged=case.store.view('agent-b','pipeline',{'workspace_id':'w1'})
    with tempfile.TemporaryDirectory(prefix='theseus-gauntlet987-') as temp:
        root=Path(temp)
        try:
            for name in ('candidate','baseline'):
                web=root/name;shutil.copytree(source/'web',web)
                if name=='baseline':
                    (web/'pipeline.mjs').write_bytes(subprocess.check_output(['git','show',
                        '90f48a872fa02b98ac8f7b317d007de6107cb1a2:web/pipeline.mjs'],cwd=source))
                index=(web/'index.html').read_text()
                styles='\n'.join(re.findall(r'<link rel="stylesheet"[^>]*>',index))
                (web/'index.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
                    styles+'<title>987 isolated real Core card</title><main id="cards" style="max-width:640px;margin:auto"></main><script type="module" src="/probe987.mjs"></script>')
                (web/'records987data.mjs').write_text('export default '+json.dumps(dict(before=before,ordinary=ordinary,judged=judged))+';')
                shutil.copyfile(source/'tests/fixtures/gauntlet_987.mjs',web/'probe987.mjs')
                def no_store():raise AssertionError('native card proof has no API writes')
                server=create_server(no_store,'scratch987','agent-b',web,token='scratch987')
                servers.append(server);thread=threading.Thread(target=server.serve_forever,daemon=True)
                threads.append(thread);thread.start()
            print(json.dumps({'candidate':servers[0].origin,'baseline':servers[1].origin,'scratch':str(root)}),flush=True)
            for line in sys.stdin:raise AssertionError('No fixture controls: '+line)
        finally:
            for server in servers:server.shutdown();server.server_close()
            for thread in threads:thread.join(5);assert not thread.is_alive()
finally:
    case.doCleanups()

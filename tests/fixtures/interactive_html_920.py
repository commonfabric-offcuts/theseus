from __future__ import annotations

"""Content-free scratch origin for native isolation; no Store is ever opened."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
from aim_next.server import create_server

with tempfile.TemporaryDirectory(prefix='theseus-html-920-') as temporary:
    root = Path(temporary).resolve()
    web = root / 'web'
    shutil.copytree(source / 'web', web)
    (web / 'index.html').write_text('''<!doctype html><meta charset="utf-8">
<meta name="aim-next-session" content="scratch-secret"><link rel="stylesheet" href="/aim.css">
<title>Isolated 920 fixture</title><div id="private">Parent only</div>
<div id="cover"></div><div id="notebook"></div><div id="reader"></div>
<script type="module" src="/probe920.mjs"></script>''')
    shutil.copyfile(source / 'tests' / 'fixtures' / 'interactive_html_920.mjs', web / 'probe920.mjs')
    requests = []
    with_header = True
    def forbidden_store():
        raise AssertionError('920 fixture must never open Core')
    server = create_server(forbidden_store, 'html-920', 'scratch-reader', web, token='scratch-secret')
    original = server.RequestHandlerClass
    class Observed(original):
        def send_header(self, keyword, value):
            if keyword == 'Connection-Allowlist' and not with_header:
                return
            super().send_header(keyword, value)
        def log_request(self, code='-', size='-'):
            requests.append({'method': self.command, 'path': self.path, 'status': code})
    server.RequestHandlerClass = Observed
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        print(json.dumps({'origin': server.origin, 'scratch': str(root), 'source': str(source),
                          'python': sys.executable, 'cache': sys.pycache_prefix}), flush=True)
        for line in sys.stdin:
            command = json.loads(line)
            if command['method'] == 'withhold-header':
                with_header = False
            elif command['method'] != 'requests':
                raise ValueError('Unknown scratch control')
            print(json.dumps({'id': command['id'], 'requests': list(requests)}), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)
        assert not thread.is_alive(), 'scratch HTTP thread ended after stdin EOF'

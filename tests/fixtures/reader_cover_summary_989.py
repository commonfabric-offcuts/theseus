from __future__ import annotations

"""Two content-free scratch origins: candidate and exact271 Reader owner (989)."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
from aim_next.server import create_server

base = '90f48a872fa02b98ac8f7b317d007de6107cb1a2'
servers = []
threads = []
def no_store():
    raise AssertionError('989 rendering fixture never opens Core')

with tempfile.TemporaryDirectory(prefix='theseus-cover989-') as temporary:
    root = Path(temporary)
    try:
        for name in ['candidate', 'baseline']:
            web = root / name
            shutil.copytree(source / 'web', web)
            if name == 'baseline':
                for owner in ['reader.mjs']:
                    (web / owner).write_bytes(subprocess.check_output(
                        ['git', 'show', base + ':web/' + owner], cwd=source))
            original_index = (web / 'index.html').read_text()
            styles = '\n'.join(re.findall(r'<link rel="stylesheet"[^>]*>', original_index))
            archive = re.search(r'<button[^>]*id="reader-aside"[\s\S]*?</button>', original_index).group(0)
            (web / 'index.html').write_text('''<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">''' + styles + '''
<title>989 isolated Reader summary</title>
<style>body{margin:0;padding:16px}#feed,#reader-box{max-width:640px;margin:auto}
dialog#reader{position:static;inset:auto;transform:none;max-width:640px;width:100%;height:auto;max-height:none;padding:0;margin:20px auto}
.reading-pane{padding:0}#reference{padding:0}</style>
<div hidden>''' + archive + '''</div>
<div id="feed"><div id="messages"></div></div>
<dialog id="reader" open><div id="reader-box"><details id="reader-cover"><summary id="reader-cover-line"></summary></details>
<div class="reading-pane"><article id="reference"></article></div></div>
</dialog>
<script type="module" src="/probe963.mjs"></script>''')
            shutil.copyfile(source / 'tests/fixtures/cover_words_963.mjs', web / 'probe963.mjs')
            server = create_server(no_store, 'cover989', 'scratch-reader', web, token='scratch989')
            servers.append(server)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            threads.append(thread)
            thread.start()
        print(json.dumps({'candidate': servers[0].origin, 'baseline': servers[1].origin,
                          'scratch': str(root), 'pid': __import__('os').getpid(), 'base': base}), flush=True)
        for line in sys.stdin:
            raise AssertionError('No fixture writes or controls are needed: ' + line)
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(5)
            assert not thread.is_alive(), '989 scratch server ended after EOF'

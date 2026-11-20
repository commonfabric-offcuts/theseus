from __future__ import annotations

"""Scratch HTTP origin for the 904 cold/warm measurement; stdin EOF closes it."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
from aim_next import Store, initialize
from aim_next.server import create_server

with tempfile.TemporaryDirectory(prefix='theseus-cache-904-') as temporary:
    root = Path(temporary)
    web = root / 'web'
    shutil.copytree(source / 'web', web)
    db, authority = root / 'records.sqlite3', root / 'authority.json'
    binding = initialize(db, 'cache-904', [{'id': 'cache-reader', 'kind': 'human'}], authority_path=authority)['binding']
    requests = []

    def start(port=0):
        server = create_server(lambda: Store(db, 'cache-904', expected_binding=binding), 'cache-904',
                               'cache-reader', web, port=port, token='scratch-904-session')
        original = server.RequestHandlerClass

        class Observed(original):
            def log_request(self, code='-', size='-'):
                requests.append({'method': self.command, 'path': self.path, 'status': code,
                                 'client': self.client_address, 'protocol': self.request_version})

        server.RequestHandlerClass = Observed
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    def stop():
        server.shutdown()
        server.server_close()
        thread.join(5)
        assert not thread.is_alive(), 'owned scratch HTTP thread stopped'

    server, thread = start()
    try:
        print(json.dumps({'origin': server.origin, 'stamp': server.build.stamp, 'scratch': str(root),
                          'python': sys.executable, 'cache': sys.pycache_prefix, 'source': str(source)}), flush=True)
        for line in sys.stdin:
            command = json.loads(line)
            if command['method'] == 'reset':
                requests.clear()
                answer = {}
            elif command['method'] == 'requests':
                answer = {'requests': list(requests), 'stamp': server.build.stamp}
            elif command['method'] == 'revision':
                port = server.server_address[1]
                stop()
                (web / 'aim.css').write_bytes(server.build.files['aim.css'] + b'\n:root { --cache-904-revision: second; }\n')
                server, thread = start(port)
                answer = {'origin': server.origin, 'stamp': server.build.stamp}
            else:
                raise ValueError('Unknown scratch control')
            print(json.dumps({'id': command['id'], 'answer': answer}), flush=True)
    finally:
        stop()

from __future__ import annotations

"""Only fictional scratch identities, a synthetic app-server, and the real web/Core/runner."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aim_next import Store
from aim_next.serve import server_for_profile
from test_seat_host_1002 import RunningSeatHost
from test_codex_host import AGENT, ROOT


def main():
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    case = RunningSeatHost('runTest')
    server = runner = reader = None
    events = []
    proof = {}
    try:
        case.setUp()
        (case.home / 'fake-script.json').write_text(json.dumps({'turns': [
            {'reply': 'Hello from this isolated fixture seat.', 'reply_to_delivery': True}
            for _ in range(120)]}))
        server = server_for_profile(case.lead_profile, 0, ROOT / 'web')
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        stderr = open(destination / 'runner-stderr.log', 'w')
        runner = subprocess.Popen(['/usr/bin/python3', '-I', str(ROOT / 'bin/aim-next-runner'),
            '--profile', str(case.lead_profile), '--runner-id', 'host-fixture', '--routes', str(case.map),
            '--host-dir', str(case.host_dir), '--seat-template', AGENT],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr, text=True)
        def read_events():
            for line in runner.stdout:
                event = json.loads(line); events.append(event)
        reader = threading.Thread(target=read_events, daemon=True); reader.start()
        for line in sys.stdin:
            request = json.loads(line); method = request['method']
            try:
                if method == 'info':
                    answer = {'origin': server.origin, 'root': str(case.root), 'actor': 'lead',
                              'instance': case.store.instance_id, 'runner_pid': runner.pid}
                elif method == 'workspace':
                    identity = request['workspace']
                    answer = case.act('workspace.create', {'id': identity, 'title': 'Seat ' + identity,
                        'team': [AGENT], 'coordinator': None}, {})
                elif method == 'changes':
                    topic = case.store.view('lead', 'conversation', {'workspace_id': request['workspace']})['conversation']['topic_id']
                    args = {'scope': {'kind': 'topic', 'id': topic}, 'limit': 50}
                    if request.get('cursor') is not None:
                        args['cursor'] = request['cursor']
                    answer = {'page': case.store.view('lead', 'changes', args),
                              'bootstrap': {'instance_id': case.store.instance_id, 'actor': 'lead', 'authority': case.store.binding}}
                elif method == 'inspect':
                    workspace = request['workspace']
                    seats = case.sql('SELECT id,agent_id,state,stage,reason,role,thread_id,first_message_id,version FROM hosted_seats WHERE workspace_id=?', (workspace,))
                    messages = case.sql('SELECT author_id,body,reply_to FROM messages WHERE topic_id IN (SELECT id FROM topics WHERE workspace_id=?) ORDER BY seq', (workspace,))
                    answer = {'seats': seats, 'messages': messages,
                        'routes_unchanged': case.map.read_bytes() == case.route_bytes, 'events': events[-10:]}
                else:
                    raise ValueError('Unknown fixture control')
                print(json.dumps({'id': request['id'], 'answer': answer}), flush=True)
            except Exception as error:
                print(json.dumps({'id': request['id'], 'failure': repr(error)}), flush=True)
    finally:
        if runner is not None:
            if runner.poll() is None:
                os.kill(runner.pid, signal.SIGTERM)
            proof['runner_exit'] = runner.wait(timeout=30)
            reader.join(timeout=5); runner.stdout.close(); stderr.close()
            proof['runner_final'] = events[-1] if events else None
            proof['runner_pid'] = runner.pid
            proof['children'] = case.sql('SELECT pid,exit_status,cleanup FROM hosted_children')
            proof['absent_pids'] = []
            for pid in [runner.pid] + [row[0] for row in proof['children']]:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    proof['absent_pids'].append(pid)
                else:
                    raise AssertionError('Owned process remains: %s' % pid)
            assert proof['runner_exit'] == 0 and proof['runner_final']['cleanup_confirmed'], proof
            assert all(row[2] == 'confirmed' for row in proof['children']), proof
        if server is not None:
            port = server.server_address[1]; server.shutdown(); server.server_close(); serving.join(timeout=5)
            with socket.socket() as connection:
                proof['port_closed'] = connection.connect_ex(('127.0.0.1', port)) != 0
            assert proof['port_closed'], proof
        proof['route_sha_before'] = hashlib.sha256(case.route_bytes).hexdigest()
        proof['route_sha_after'] = hashlib.sha256(case.map.read_bytes()).hexdigest()
        assert proof['route_sha_before'] == proof['route_sha_after'], proof
        (destination / 'events.json').write_text(json.dumps(events, indent=1))
        shutil.copytree(case.root, destination / 'fixture')
        case.doCleanups()
        proof['fixture_removed'] = not case.root.exists()
        (destination / 'cleanup.json').write_text(json.dumps(proof, indent=1))


if __name__ == '__main__':
    main()

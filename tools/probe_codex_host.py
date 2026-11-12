from __future__ import annotations

"""Opt-in real Codex probe in an explicitly selected isolated home/work directory.

No live Theseus records, credentials or desktop threads are read or changed.
The evidence contains selected protocol facts, never account/token responses.
"""
import argparse
import json
import os
from pathlib import Path
import select
import subprocess
import time


class Client:
    def __init__(self, executable, home):
        self.p = subprocess.Popen([executable, 'app-server', '--listen', 'stdio://'],
                                  env=dict(os.environ, CODEX_HOME=home), stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        self.buffer = b''
        self.serial = 0
        self.events = []
        self.call('initialize', {'clientInfo': {'name': 'theseus_host', 'version': '1'},
                                 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized', 'params': {}})

    def send(self, message):
        self.p.stdin.write((json.dumps(message) + '\n').encode())

    def next(self, deadline):
        while b'\n' not in self.buffer:
            left = deadline - time.monotonic()
            if left <= 0 or not select.select([self.p.stdout], [], [], left)[0]:
                raise TimeoutError('Codex probe deadline')
            chunk = os.read(self.p.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError('Codex exited')
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b'\n', 1)
        message = json.loads(line)
        if 'method' in message:
            self.events.append(message)
            if 'id' in message:
                self.send({'id': message['id'], 'error': {'code': -32601, 'message': 'No interactive UI in this probe'}})
        return message

    def call(self, method, params):
        self.serial += 1
        number = self.serial
        self.send({'id': number, 'method': method, 'params': params})
        deadline = time.monotonic() + 45
        while True:
            message = self.next(deadline)
            if message.get('id') == number and 'method' not in message:
                if 'error' in message:
                    raise RuntimeError('%s: %s' % (method, message['error']))
                return message['result']

    def turn(self, thread, text):
        before = len(self.events)
        result = self.call('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text': text}],
                                        'approvalPolicy': 'never', 'sandboxPolicy': {'type': 'dangerFullAccess'}, 'effort': 'medium'})
        turn = result['turn']['id']
        deadline = time.monotonic() + 240
        while True:
            ended = next((e for e in self.events[before:] if e.get('method') == 'turn/completed'
                          and e.get('params', {}).get('turn', {}).get('id') == turn), None)
            if ended:
                status = ended['params']['turn']['status']
                if status != 'completed':
                    raise RuntimeError('turn ended %s: %s' % (status, ended['params']['turn'].get('error')))
                return {'turn_id': turn, 'status': status, 'items': [e['params']['item']['type'] for e in self.events[before:]
                        if e.get('method') == 'item/completed']}
            self.next(deadline)

    def close(self):
        self.p.stdin.close()
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.terminate()
            try:
                self.p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.p.kill(); self.p.wait(timeout=5)
        self.p.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable', required=True)
    parser.add_argument('--home', required=True)
    parser.add_argument('--work', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    output = Path(args.out)
    if output.exists():
        raise SystemExit('Choose a fresh evidence file')
    facts = {'runtime': args.executable, 'home': args.home}
    settings = {'cwd': str(work), 'model': 'gpt-6.1-sol', 'approvalPolicy': 'never', 'sandbox': 'danger-full-access',
                'config': {'model_reasoning_effort': 'medium', 'agents': {'enabled': True}},
                'developerInstructions': 'You are an isolated Theseus runtime probe. Work only in this assigned work directory. '
                'Use shell tools when requested. Do not delegate. Do not read any other agent or desktop files.'}
    client = Client(args.executable, args.home)
    try:
        account = client.call('account/read', {'refreshToken': False})
        assert account.get('account'), 'The isolated home needs sign-in'
        facts['signed_in'] = True
        started = client.call('thread/start', dict(settings, ephemeral=False, serviceName='theseus'))
        thread = started['thread']['id']
        facts['thread_id'] = thread
        facts['settings'] = {k: started.get(k) for k in ('model', 'reasoningEffort', 'sandbox', 'approvalPolicy', 'cwd')}
        assert started['sandbox']['type'] == 'dangerFullAccess', started['sandbox']
        facts['first'] = client.turn(thread, 'Keep this constraint in our conversation: the workshop label is ORCHID and its size is 37. '
                                    'Do not save those facts to a file. Use your shell to report the current directory, then acknowledge briefly.')
    finally:
        client.close()
    print(json.dumps({'phase': 'first_turn_and_restart', **facts}), flush=True)
    client = Client(args.executable, args.home)
    try:
        resumed = client.call('thread/resume', dict(settings, threadId=thread, excludeTurns=True))
        assert resumed['thread']['id'] == thread
        facts['resumed'] = True
        facts['second'] = client.turn(thread, 'Using the workshop constraint from our earlier conversation, write result.txt in this work directory '
                                     'as LABEL:SIZE followed by a newline. Read the file back with your shell and report it.')
        assert (work / 'result.txt').read_text() == 'ORCHID:37\n'
        facts['context_and_shell_verified'] = True
        before = len(client.events)
        client.call('thread/compact/start', {'threadId': thread})
        deadline = time.monotonic() + 180
        while not any(e.get('method') == 'item/completed' and e.get('params', {}).get('item', {}).get('type') == 'contextCompaction'
                      for e in client.events[before:]):
            client.next(deadline)
        (work / 'result.txt').unlink()
        facts['after_compaction'] = client.turn(thread, 'Now recreate result.txt from the workshop constraint in our conversation. '
                                               'Use the same LABEL:SIZE format and read it back. Do not read other files.')
        assert (work / 'result.txt').read_text() == 'ORCHID:37\n'
        facts['compaction_verified'] = True
    finally:
        client.close()
        output.write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts), flush=True)


if __name__ == '__main__':
    main()

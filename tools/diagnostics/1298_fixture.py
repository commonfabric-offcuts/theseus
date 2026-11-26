from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import time

sys.dont_write_bytecode = True
REPO = Path(os.environ['FLEX_PRODUCT_REPO'])
sys.path.insert(0, str(REPO))
from aim_next import Store, initialize
from aim_next.server import create_server

ROOT = Path(os.environ['FLEX_1298_EVIDENCE'])
SEED = ROOT / 'seed'
DB = SEED / 'run.sqlite3'
INSTANCE = 'isolated-1298-body-v1'
READER, SENDER = 'fixture-reader1298', 'fixture-sender1298'
binding = None
serial = 0
server = thread = None


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def store():
    return Store(DB, INSTANCE, expected_binding=dict(binding), tools=ROOT / 'empty-tools')


def command(kind, args, target=None, expected=None, actor=READER, op=None):
    global serial
    serial += 1
    envelope = {'v': 1, 'instance_id': INSTANCE, 'operation_id': op or 'seed1298-%04d' % serial,
                'kind': kind, 'target': target or {}, 'args': args,
                'expected': dict(expected or {}, authority={k: binding[k] for k in ('authority_id', 'authority_epoch')})}
    started = time.time_ns() // 1000000
    with (ROOT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps({'stage': 'intent', 'started_ms': started, 'actor': actor, 'envelope': envelope}) + '\n')
    receipt = store().command(actor, envelope)
    row = {'stage': 'receipt', 'started_ms': started, 'ended_ms': time.time_ns() // 1000000,
           'actor': actor, 'envelope': envelope, 'receipt': receipt}
    with (ROOT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')
    if receipt.get('status') != 'committed':
        raise RuntimeError(json.dumps(row))
    return receipt['result']


def post(topic, text, reply=None, op=None):
    args = {'body': text}
    if reply:
        args.update(reply_to=reply, reply_without_quote='Synthetic1298 ordinary arrival or seed reply.')
    else:
        args['divergence_reason'] = 'Separate synthetic1298 dossier.'
    return command('message.post', args, {'topic_id': topic}, actor=SENDER, op=op)


def topic(name):
    draft = 'opening1298-' + name
    command('draft.save', {'source_ref': {'kind': 'new_topic', 'id': draft, 'workspace_id': 'w1298'},
            'topic_id': name, 'generation': 'seed1298', 'body': 'Synthetic1298 opening ' + name,
            'attachments': [], 'opening': {'workspace_id': 'w1298', 'title': name, 'participants': [SENDER]}},
            {'draft_id': draft}, {'draft_revision': 0})
    command('submission.prepare', {'draft_id': draft, 'submission_id': draft, 'send_operation_id': draft + '-send'},
            {'topic_id': name}, {'draft_revision': 1})
    return command('topic.create_and_send', {'submission_id': draft}, {'topic_id': name}, op=draft + '-send')


def prepare():
    global binding
    SEED.mkdir(mode=0o700, parents=True, exist_ok=False)
    binding = initialize(DB, INSTANCE, [{'id': READER, 'kind': 'human'}, {'id': SENDER, 'kind': 'human'}],
                         authority_path=SEED / 'authority.json')['binding']
    command('workspace.create', {'id': 'w1298', 'title': 'Synthetic1298 body attribution', 'team': [SENDER]})
    opening = topic('t1298-main')
    dossiers = []
    for d in range(10):
        root = opening if d == 0 else post('t1298-main', 'Synthetic1298 D%02d root. Fixed reading context.' % d)
        replies = [post('t1298-main', 'Synthetic1298 D%02d reply%02d. Fixed reading context.' % (d, n), root['message_id'])
                   for n in range(2)]
        command('stack.cover', {'stands': 'Synthetic1298 D%02d cover. Stable unchanged text.' % d},
                {'message_id': root['message_id']}, {'cover_revision': 0}, actor=SENDER)
        command('stack.level', {'level': 'open'}, {'message_id': root['message_id']}, {'level_revision': 0})
        command('stack.place', {'key': 1000 - d}, {'message_id': root['message_id']}, {'place_revision': 0})
        dossiers.append({'label': 'D%d' % d, 'root': root, 'replies': replies})
    other = topic('t1298-other')
    command('topic.read_through', {'seq': dossiers[-1]['replies'][-1]['seq']}, {'topic_id': 't1298-main'})
    command('topic.read_through', {'seq': other['seq']}, {'topic_id': 't1298-other'})
    page = store().view(READER, 'topic_messages', {'topic_id': 't1298-main', 'direction': 'before', 'limit': 30, 'audience': 'all'})
    assert len(page['items']) == 30, page
    expected = {r['message_id'] for d in dossiers for r in [d['root'], *d['replies']]}
    assert {m['id'] for m in page['items']} == expected
    for d in dossiers:
        assert next(m for m in page['items'] if m['id'] == d['root']['message_id'])['stack_position']['level'] == 'open'
    shutil.copy2(DB, SEED / 'frozen.sqlite3')
    value = {'instance': INSTANCE, 'product_head': os.environ['FLEX_PRODUCT_HEAD'], 'binding': binding,
             'placement_note': 'Public stack.place keys1000..991 keep D0..D9 fixed; natural newest-first reordering is outside this body-only input.',
             'dossiers': dossiers, 'initial_ids': [m['id'] for m in page['items']], 'initial_page': page,
             'frozen_db_sha256': digest(SEED / 'frozen.sqlite3'), 'run_db_sha256': digest(DB),
             'prepared_ms': time.time_ns() // 1000000}
    save('seed-ledger.json', value)
    print(json.dumps({'prepared': True, 'count': len(page['items']), 'frozen_db_sha256': value['frozen_db_sha256']}), flush=True)


def serve():
    global binding, server, thread
    ledger = json.loads((ROOT / 'seed-ledger.json').read_text())
    binding = ledger['binding']
    assert digest(SEED / 'frozen.sqlite3') == ledger['frozen_db_sha256']
    assert digest(DB) == ledger['run_db_sha256'], 'Never resume a mutated seed as a fresh baseline'
    for line in sys.stdin:
        request = json.loads(line)
        try:
            method = request['method']
            if method == 'ready':
                assert server is None
                server = create_server(store, INSTANCE, READER, REPO / 'web', port=0)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                answer = {'origin': server.origin, 'fixture_pid': os.getpid(), 'fixture_pgid': os.getpgid(0),
                          'ledger': ledger, 'python': {'executable': sys.executable, 'version': sys.version,
                          'pycache_prefix': sys.pycache_prefix, 'isolated': sys.flags.isolated}}
                save('fixture-ready.json', answer)
            elif method == 'arrival':
                ordinal = request['ordinal']
                assert type(ordinal) is int and 0 <= ordinal < 12
                answer = post('t1298-main', 'Synthetic1298 ordinary D9 arrival %02d. Fixed reading context.' % ordinal,
                              ledger['dossiers'][9]['root']['message_id'], op='arrival1298-%02d' % ordinal)
            elif method == 'cover':
                root = ledger['dossiers'][4]['root']['message_id']
                answer = command('stack.cover', {'stands': 'Synthetic1298 D04 cover. Explicit changed control.'},
                                 {'message_id': root}, {'cover_revision': 1}, actor=SENDER, op='cover1298-control')
            elif method == 'projection':
                answer = store().view(READER, 'dossier_cover', {'message_id': ledger['dossiers'][4]['root']['message_id']})
            elif method == 'stop':
                if server:
                    server.shutdown(); server.server_close(); thread.join(timeout=10)
                answer = {'closed': True, 'thread_alive': thread.is_alive() if thread else False,
                          'ended_ms': time.time_ns() // 1000000}
                save('fixture-terminal.json', answer)
            else:
                raise ValueError(method)
            print(json.dumps({'id': request['id'], 'answer': answer}), flush=True)
            if method == 'stop':
                break
        except BaseException as error:
            print(json.dumps({'id': request['id'], 'failure': repr(error)}), flush=True)
    if server and thread and thread.is_alive():
        server.shutdown(); server.server_close(); thread.join(timeout=10)


if __name__ == '__main__':
    if sys.argv[1] == 'prepare':
        prepare()
    elif sys.argv[1] == 'serve':
        serve()
    else:
        raise ValueError(sys.argv[1])

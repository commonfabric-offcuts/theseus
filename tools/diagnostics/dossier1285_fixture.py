from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import threading
import time

sys.dont_write_bytecode = True
REPO = Path(os.environ['FLEX_PRODUCT_REPO'])
sys.path.insert(0, str(REPO))
from aim_next import Store, initialize
from aim_next.server import create_server
from aim_next.authority import prepare_authority, publish_initial

OUT = Path(sys.argv[1]); BASE = Path(os.environ['FLEX_DIAGNOSTIC_EVIDENCE']) / 'baseline-v4'
DB = OUT / 'data.sqlite3'; INSTANCE = 'isolated-dossier1279'
READER = 'fixture-reader'; SENDER = 'fixture-sender'
server = None; thread = None; serial = 0; binding = None; dataset = None

def saved(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2))

def store():
    return Store(DB, INSTANCE, expected_binding=dict(binding))

def command(kind, args, target=None, expected=None, actor=READER, op=None):
    global serial
    serial += 1
    request = {'v': 1, 'instance_id': INSTANCE, 'kind': kind,
               'operation_id': op or 'scratch-%s-%d' % (OUT.name, serial),
               'target': target or {}, 'args': args,
               'expected': dict(expected or {}, authority={k: binding[k] for k in ['authority_id', 'authority_epoch']})}
    result = store().command(actor, request)
    with (OUT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps({'at_ms': int(time.time()*1000), 'actor': actor, 'request': request, 'result': result})+'\n')
    assert result['status'] == 'committed', result
    return result['result']

def post(topic, body, reply=None, actor=SENDER):
    args = {'body': body}
    if reply:
        args.update(reply_to=reply, reply_without_quote='Controlled scratch dossier diagnostic.')
    elif actor == SENDER:
        args['divergence_reason'] = 'Distinct scratch diagnostic dossier.'
    return command('message.post', args, {'topic_id': topic}, actor=actor)

def cover(topic, root, label, long=True):
    before = store().view(READER, 'dossier_cover', {'message_id': root})
    words = ('Scratch cover %s. Selected cover words remain ordinary text.\n\n' % label)
    words += '[Cover reference](?topic=%s&message=%s&land=only)\n\n' % (topic, root)
    words += '\n\n'.join('Cover paragraph %02d: visible reading words for bounded retention, unchanged by ordinary arrivals.' % n for n in range(48 if long else 1))
    return command('stack.cover', {'stands': words}, {'message_id': root}, {'cover_revision': before['cover_revision']}, actor=SENDER)

def seed():
    global binding
    binding = initialize(DB, INSTANCE, [{'id':READER,'kind':'human'}, {'id':SENDER,'kind':'agent'}], authority_path=OUT/'authority.json')['binding']
    command('workspace.create', {'id':'w1279','title':'Isolated dossier retention','team':[SENDER]})
    result = {'cases': [], 'seed_version': 1, 'description':'Entirely synthetic; no Tony records, private data or live profiles.'}
    for number, label in enumerate(['cover-visible', 'cover-focus', 'cover-selection', 'message-visible']):
        topic = 'dossier1285-topic-%d' % number
        draft = 'opening-%d' % number
        command('draft.save', {'source_ref':{'kind':'new_topic','id':draft,'workspace_id':'w1279'},
                'topic_id':topic,'generation':'seed','body':'Scratch topic opening '+label,
                'attachments':[],'opening':{'workspace_id':'w1279','title':label,'participants':[SENDER]}},
                {'draft_id':draft},{'draft_revision':0})
        command('submission.prepare', {'draft_id':draft,'submission_id':draft,'send_operation_id':draft+'-send'},
                {'topic_id':topic},{'draft_revision':1})
        command('topic.create_and_send', {'submission_id':draft},{'topic_id':topic},op=draft+'-send')
        root = post(topic, 'Scratch target dossier '+label)['message_id']
        replies = [post(topic, 'Scratch target reply %d. Reading context remains here.' % n, root)['message_id'] for n in range(2)]
        cover(topic, root, label, long=label!='message-visible')
        for n in range(20): post(topic, 'Scratch initial neighbor %02d.' % n)
        result['cases'].append({'label':label,'topic':topic,'root':root,'replies':replies})
    return result

def derive():
    global binding, dataset
    original = Path(os.environ['FLEX_ORIGINAL_BASELINE'])
    expected = (original/'sha256').read_text().strip()
    assert expected == 'a1a0b1b467bd3800847866bcf908e36c1a7dc3611b79dfa48699a0eb05bf2bb0'
    assert hashlib.sha256((original/'data.sqlite3').read_bytes()).hexdigest() == expected
    assert not BASE.exists(), 'Never replace a fixed derived baseline'
    OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copy2(original/'data.sqlite3', DB)
    dataset = json.loads((original/'dataset.json').read_text())
    binding, record = prepare_authority(OUT/'authority.json', DB, INSTANCE)
    with sqlite3.connect(DB) as conn:
        for key, value in dict(binding,instance_id=INSTANCE).items():
            assert conn.execute('UPDATE metadata SET value=? WHERE key=?',(value,key)).rowcount == 1
    publish_initial(binding, record)
    command('pipeline.configure', {'enabled':True}, {'workspace_id':'w1279'}, {'pipeline_revision':0})
    original_cases = list(dataset['cases'])
    for label, human in [('human-items',True),('selection-move',False)]:
        topic = 'dossier1285-topic-'+label;draft = 'opening1285-'+label
        command('draft.save', {'source_ref':{'kind':'new_topic','id':draft,'workspace_id':'w1279'},
                'topic_id':topic,'generation':'derive1285','body':'Synthetic topic '+label,
                'attachments':[],'opening':{'workspace_id':'w1279','title':label,'participants':[SENDER]}},
                {'draft_id':draft},{'draft_revision':0})
        command('submission.prepare', {'draft_id':draft,'submission_id':draft,'send_operation_id':draft+'-send'},
                {'topic_id':topic},{'draft_revision':1})
        command('topic.create_and_send', {'submission_id':draft},{'topic_id':topic},op=draft+'-send')
        if human:
            for n in range(20):post(topic,'Synthetic preceding neighbor %02d.'%n)
        root = post(topic,'Synthetic human linked-item dossier' if human else 'Synthetic selection move dossier',
                    actor=READER if human else SENDER)['message_id']
        replies = [post(topic,'Synthetic target reply %d.'%n,root)['message_id'] for n in range(2)]
        case = {'label':label,'topic':topic,'root':root,'replies':replies,'author_kind':'human' if human else 'agent'}
        if human:
            case['item_numbers'] = [command('pipeline.item_add',{'title':title,'size':'small',
                'sources':[{'message_id':root}]},{'workspace_id':'w1279'})['number'] for title in
                ['Synthetic compact transport follow-up','Synthetic answer routing follow-up','Synthetic loaded-cover retention follow-up']]
        else: cover(topic,root,label)
        for n in range(20):post(topic,'Synthetic initial neighbor %02d.'%n)
        dataset['cases'].append(case)
    assert dataset['cases'][:4] == original_cases
    dataset.update(seed_version=3,parent_baseline_sha256=expected,
        description='1285 synthetic derivative: four unchanged targets and two additive topics; no live data.')
    BASE.mkdir(mode=0o700)
    shutil.copy2(DB,BASE/'data.sqlite3')
    (BASE/'dataset.json').write_text(json.dumps(dataset,indent=2))
    (BASE/'sha256').write_text(hashlib.sha256((BASE/'data.sqlite3').read_bytes()).hexdigest())
    saved('derivation.json',{'parent_sha256':expected,'derived_sha256':(BASE/'sha256').read_text(),
        'cases':dataset['cases'],'ended_ms':int(time.time()*1000)})
    assert hashlib.sha256((original/'data.sqlite3').read_bytes()).hexdigest() == expected

def ready():
    global binding, server, thread, dataset
    assert BASE.exists(), 'Prepare and hash the derived baseline before queueing'
    if BASE.exists():
        expected = (BASE/'sha256').read_text()
        assert hashlib.sha256((BASE/'data.sqlite3').read_bytes()).hexdigest() == expected
        shutil.copy2(BASE/'data.sqlite3', DB)
        dataset = json.loads((BASE/'dataset.json').read_text())
        binding, record = prepare_authority(OUT/'authority.json', DB, INSTANCE)
        with sqlite3.connect(DB) as conn:
            for key, value in dict(binding,instance_id=INSTANCE).items():
                assert conn.execute('UPDATE metadata SET value=? WHERE key=?',(value,key)).rowcount == 1
        publish_initial(binding, record)
    server = create_server(store, INSTANCE, READER, REPO/'web', port=int(os.environ['FLEX_DIAGNOSTIC_PORT']))
    thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
    value = {'dataset':dataset,'baseline_sha256':(BASE/'sha256').read_text(),
             'port':server.server_address[1], 'fixture_pid':os.getpid(), 'fixture_pgid':os.getpgid(0),
             'repo':str(REPO),'input_db_sha256':hashlib.sha256(DB.read_bytes()).hexdigest(),
             'runtime':{'executable':sys.executable,'version':sys.version,'cwd':os.getcwd(),
                        'pycache_prefix':sys.pycache_prefix,'isolated':sys.flags.isolated}}
    saved('fixture-input.json',value)
    return value

if len(sys.argv)>2 and sys.argv[2]=='derive':
    derive()
    print(json.dumps({'derived':str(BASE),'sha256':(BASE/'sha256').read_text()}))
    raise SystemExit(0)

try:
    for line in sys.stdin:
        req = json.loads(line)
        try:
            method = req['method']
            if method == 'ready': answer = ready()
            elif method == 'arrivals':
                case = next(c for c in dataset['cases'] if c['label']==req['label'])
                ids=[]
                for n in range(req['start'], req['start']+req['count']):
                    text='Scratch ordinary arrival %03d for %s.' % (n,case['label'])
                    if n in (329,659): text += ' [Return dossier](?topic=%s&message=%s&land=only)' % (case['topic'],case['root'])
                    ids.append(post(case['topic'],text)['message_id'])
                if req.get('churn'):
                    if case['label']=='human-items':
                        command('pipeline.item_edit',{'title':'Synthetic compact transport follow-up revised'},
                            {'workspace_id':'w1279','number':case['item_numbers'][0]},{'item_revision':1})
                    else: cover(case['topic'],case['root'],case['label'])
                answer={'ids':ids,'last':ids[-1],'ended_ms':int(time.time()*1000)}
            elif method in ('source','projection'):
                case = next(c for c in dataset['cases'] if c['label']==req['label'])
                answer=store().view(READER,'source',{'source_ref':{'kind':'message','id':case['root']}}) if method=='source' else store().view(READER,'dossier_cover',{'message_id':case['root']})
            elif method == 'stop':
                if server:
                    server.shutdown();server.server_close();thread.join(timeout=20)
                answer={'thread_alive':thread.is_alive() if thread else False,'closed':True,'ended_ms':int(time.time()*1000)}
                saved('fixture-terminal.json',answer)
            else: raise ValueError(method)
            print(json.dumps({'id':req['id'],'answer':answer}),flush=True)
            if method == 'stop': break
        except BaseException as e:
            print(json.dumps({'id':req['id'],'failure':repr(e)}),flush=True)
finally:
    if server and thread and thread.is_alive():
        server.shutdown();server.server_close();thread.join(timeout=20)

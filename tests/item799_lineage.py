from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from urllib.parse import urlparse, unquote

ROOT = Path(sys.argv[3]).resolve()
OWNED = ROOT / 'anonymous'
OWNED.mkdir(mode=0o700, exist_ok=True)
assert sys.version_info[:2] == (3, 9)
assert sys.pycache_prefix == str(ROOT / ('pycache-anonymous-' + sys.argv[1]))
CODE = Path(sys.argv[2]).resolve()
REPO = Path(__file__).resolve().parents[1]
assert CODE == REPO or ROOT in CODE.parents
sys.path.insert(0, str(CODE))
def owned(path):
    path = Path(path).resolve()
    assert OWNED in path.parents, 'every fixture Store/SQLite path is owned'
    return path
real_connect = sqlite3.connect
def connect(database, *args, **kwargs):
    value = str(database)
    owned(unquote(urlparse(value).path) if value.startswith('file:') else value)
    return real_connect(database, *args, **kwargs)
sqlite3.connect = connect
from aim_next import Store, initialize

phases, receipts = {}, []
with tempfile.TemporaryDirectory(prefix='run-', dir=str(OWNED)) as temporary:
    work = Path(temporary).resolve()
    path = owned(work / 'data.sqlite3')
    binding = initialize(path, 'anonymous-799', [{'id':'reader', 'kind':'human'}, {'id':'author', 'kind':'agent'}, {'id':'other', 'kind':'human'}],
                         authority_path=owned(work / 'control' / 'authority.json'))['binding']
    store = Store(owned(path), 'anonymous-799', expected_binding=binding, tools=REPO)
    serial = [0]
    def command(kind, args, target=None, expected=None, actor='reader', commit=True):
        owned(store.path)
        serial[0] += 1
        answer = store.command(actor, {'v':1, 'instance_id':'anonymous-799', 'operation_id':'op-%d' % serial[0], 'kind':kind,
            'target':target or {}, 'args':args, 'expected':dict(expected or {}, authority={key:binding[key] for key in ('authority_id','authority_epoch')})})
        receipts.append(answer)
        if commit:
            assert answer['status'] == 'committed' and answer['recorded'], answer
            return answer['result']
        return answer
    def view(name, args, actor='reader'):
        owned(store.path)
        answer = store.view(actor, name, args)
        assert 'error' not in answer, answer
        return answer
    def page(limit=30):
        answer = view('topic_messages', {'topic_id':'t', 'audience':'all', 'direction':'before', 'limit':limit})
        answer['heads_read'] = view('topic_messages', {'topic_id':'t', 'message_ids':list(dict.fromkeys(item['stack_position']['root_id'] for item in answer['items']))})
        answer['acts_read'] = view('message_acts', {'topic_id':'t', 'limit':100})
        answer['positions_read'] = view('stack_positions', {'topic_id':'t', 'message_ids':[item['id'] for item in answer['items']]})
        return answer
    def position(mid, actor='reader'):
        return view('stack_positions', {'topic_id':'t', 'message_ids':[mid]}, actor)['items'][0]['stack_position']
    def aside(mid, through, rev=0, actor='reader', commit=True):
        return command('stack.aside', {'through':through}, {'message_id':mid}, {'aside_revision':rev}, actor, commit)
    def star(mid, on=True, rev=0):
        return command('message.star', {'starred':on}, {'message_id':mid}, {'star_revision':rev})
    def post(body, reply_to=None, actor='author', **extra):
        args = dict(body=body, **extra)
        if reply_to:
            args['reply_to'] = reply_to
            if actor == 'author':
                args['reply_without_quote'] = 'This anonymous lineage probe tests parent identity; the parent words are not part of the scenario.'
        elif actor == 'author':
            args['divergence_reason'] = 'Separate anonymous lineage fixture: ' + body
        return command('message.post', args, {'topic_id':'t'}, actor=actor)['message_id']
    command('workspace.create', {'id':'w', 'title':'Anonymous structural control', 'team':['author','other'], 'coordinator':'author'})
    command('draft.save', {'source_ref':{'kind':'new_topic','id':'opening','workspace_id':'w'}, 'topic_id':'t', 'body':'Dossier original', 'generation':'g',
        'attachments':[], 'quotes':[], 'addressees':[], 'opening':{'workspace_id':'w','title':'Anonymous topic','participants':['author']}}, {'draft_id':'d'}, {'draft_revision':0})
    command('submission.prepare', {'draft_id':'d','submission_id':'s','send_operation_id':'op-4'}, {'topic_id':'t'}, {'draft_revision':1})
    a = command('topic.create_and_send', {'submission_id':'s'}, {'topic_id':'t'})['message_id']
    b = post('Ordinary other dossier')
    backlog = post('Anonymous older starred original')
    for number in range(35):
        post('Anonymous intervening note %d' % number)
    r1 = post('First loaded branch', a)
    r2 = post('Second loaded branch', a)
    post('Older starred originals first loaded branch', backlog)
    post('Older starred originals second loaded branch', backlog)
    star(backlog)
    through = max(item['seq'] for item in page()['items'])
    aside(a, through)
    aside(a, through, actor='other')
    phases['before_remote_star'] = page()
    assert position(r2)['below'] is True
    assert a not in {item['id'] for item in phases['before_remote_star']['items']}
    before = position(r2)
    starred = star(r2)
    assert 'brought_back' not in starred
    assert position(r2)['below'] is True and position(r2)['aside_revision'] == before['aside_revision']
    assert position(r2, 'other')['below'] is True
    phases['after_remote_star'] = page()
    star(r2, False, 1)
    assert position(r2)['below'] is True, 'explicit unstar preserves archive membership'
    star(r2, True, 2)
    aside(b, through)
    assert position(b)['below'] is True
    command('stack.join', {'into':b}, {'message_id':a}, {'join_revision':0})
    joined = position(r2)
    assert joined['root_id'] == b and joined['through'] == through and joined['starred'] == [r2]
    assert joined['below'] is True, 'joining a starred dossier into an archive keeps it archived'
    phases['after_join'] = page()
    star(r2, False, 3)
    assert position(r2)['below'] is True, 'ordinary unstarred joined dossier keeps existing below-More move'
    phases['after_join_unstar'] = page()
    own = post('Readers own reply does not revive it', r2, actor='reader')
    assert position(own)['below'] is True
    reply = post('Another device reply revives it', r2)
    assert position(reply)['below'] is False
    phases['after_remote_reply'] = page()
    command('stack.join', {'into':None}, {'message_id':a}, {'join_revision':1})
    assert position(r2)['root_id'] == a and position(r2)['below'] is False
    assert position(b)['below'] is True, 'split takes the reviving reply away'
    private = post('Anonymous private child', a, actor='reader', whisper=True, addressees=['author'])
    denied = store.view('other', 'topic_messages', {'topic_id':'t','message_ids':[private]})
    assert denied['error']['code'] == 'FORBIDDEN'
    phases['after_split'] = page()
    phases['final'] = page(100)
    initial = page()
    pages, cursor = [initial], initial['next_cursor']
    while cursor is not None:
        answer = view('topic_messages', {'topic_id':'t','audience':'all','direction':'before','limit':30,'cursor':cursor})
        assert answer['next_cursor'] is None or answer['next_cursor'] < cursor
        pages.append(answer)
        cursor = answer['next_cursor']
    roots = list(dict.fromkeys(item['stack_position']['root_id'] for packet in pages for item in packet['items']))
    heads = view('topic_messages', {'topic_id':'t','message_ids':roots})['items']
    result = {'label':'anonymous public-command distant-head topology plus actual30 remote-star/join/split/independent-reader controls; private lineage local only',
              'phases':phases, 'receipts':receipts, 'pages':pages, 'heads':heads, 'root':a, 'backlog_root':backlog, 'destination':b, 'starred_reply':r2, 'pycache_prefix':sys.pycache_prefix,
              'source':str(CODE), 'cleanup':'TemporaryDirectory removes only this owned anonymous fixture after connection close'}
    (ROOT / ('anonymous-' + sys.argv[1] + '.json')).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status':'anonymous real-Core controls passed', 'pycache_prefix':sys.pycache_prefix, 'phases':len(phases), 'commands':len(receipts), 'cleanup':'owned fixture removed'}))

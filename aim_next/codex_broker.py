from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import time

from .broker_routes import load_config
from . import wake_adapter


# The one Codex app-server version reviewed for every method and shape the broker
# and the Codex host send and parse (docs/codex-broker.md, "Reviewed version").
VERSION = '0.167.0-alpha.3.2'
CLIENT = 'theseus_wake_broker'
# A version as Codex spells it after its client name, short enough to record.
_VERSION_TEXT = re.compile(r'[0-9A-Za-z][0-9A-Za-z.+-]{0,39}')
INSTRUCTION = ('Read current durable work through the bound Theseus CLI profile. '
               'Use paged delivery reads; do not filter by this historical wake generation. '
               'Reply and acknowledge separately. On a binding mismatch, retain the request and refusal; never rebind. '
               'Correct only a demonstrable raw-read wrapper mistake with the original actor and binding values unchanged; '
               'this does not authorize replaying a write. Otherwise stop the affected operation and ask your coordinator '
               'through a working bound channel. Do not silently ignore later deliveries or bypass refused access.')
TOTAL_SECONDS = 4.0
CLEANUP_SECONDS = 0.5
ADD_SECONDS = 1.0
MAX_INBOUND = 1048576
PAGE_LIMIT = 100
MAX_PAGES = 2


class BrokerError(Exception):
    """A bounded transport refusal; never a delivery acknowledgment.

    reason is the fixed code the broker reports for it (`_refuse`), or None
    for the stage it happened in: its configuration and input before Codex
    started, an answer the broker does not accept after."""

    def __init__(self, reason=None):
        super().__init__(reason or 'broker_refused')
        self.reason = reason


# Why the broker refused, as it reports it on its standard output (`_refuse`);
# docs/codex-broker.md lists them.
NO_ANSWER = 'codex_no_answer'
PROTOCOL = 'codex_protocol'


def _require(condition, reason=None):
    if not condition:
        raise BrokerError(reason)


def handshake_refusal(result, client, root):
    """Why an initialize result is refused, or None when it is the reviewed version on root.

    The first ASCII-space-delimited token of userAgent must be exactly
    client/VERSION, followed by a nonempty tail, and codexHome must resolve to
    root. Another version of this client is 'codex_version:<found>:<VERSION>';
    a codexHome that resolves elsewhere, or not at all, is 'codex_home'; any
    other shape (no tail, another client, a version that is not a plain
    version, a missing or relative home) is 'codex_protocol'. The Codex host
    applies the same guard (codex_host.py)."""
    if type(result) is not dict or not isinstance(result.get('userAgent'),str):
        return PROTOCOL
    token,separator,tail = result['userAgent'].partition(' ')
    name,slash,found = token.partition('/')
    if name!=client or not slash or separator!=' ' or not tail:
        return PROTOCOL
    if found!=VERSION:
        return 'codex_version:%s:%s' % (found,VERSION) if _VERSION_TEXT.fullmatch(found) else PROTOCOL
    effective = result.get('codexHome')
    if not isinstance(effective,str) or not Path(effective).is_absolute():
        return PROTOCOL
    try:
        return None if str(Path(effective).resolve(strict=True))==root else 'codex_home'
    except (OSError,RuntimeError,ValueError):
        return 'codex_home'


def _remaining(deadline):
    return max(0.0,deadline-time.monotonic())


def _unique(pairs):
    value = {}
    for key,item in pairs:
        _require(key not in value)
        value[key] = item
    return value


def _constant(unused):
    raise BrokerError()


def _json(raw):
    try:
        return json.loads(raw,object_pairs_hook=_unique,parse_constant=_constant)
    except (ValueError,UnicodeError,RecursionError) as error:
        raise BrokerError() from error


def _canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)


def _payload(value):
    _require(type(value) is dict and set(value)=={'v','binding','wake_generation','attempt_id'})
    _require(type(value['v']) is int and value['v']==1)
    binding = value['binding']
    _require(type(binding) is dict and set(binding)==wake_adapter.BINDING_FIELDS)
    _require(all(wake_adapter._identity(binding[key])
                 for key in wake_adapter.BINDING_FIELDS-{'db_path'})
             and wake_adapter._absolute(binding['db_path']))
    _require(type(value['wake_generation']) is int and 0<=value['wake_generation']<=9223372036854775807
             and wake_adapter._identity(value['attempt_id']))
    return value


def _stdin(deadline):
    fd = sys.stdin.fileno()
    os.set_blocking(fd,False)
    raw = bytearray()
    while True:
        left = _remaining(deadline)
        _require(left>0 and bool(select.select([fd],[],[],left)[0]))
        try:
            block = os.read(fd,wake_adapter.MAX_STDIN_BYTES+1-len(raw))
        except (BlockingIOError,InterruptedError):
            continue
        if not block:
            return _payload(_json(raw.decode('utf-8')))
        raw.extend(block)
        _require(len(raw)<=wake_adapter.MAX_STDIN_BYTES)


class _RPC:
    """One sequential stream, one cumulative byte/deadline budget."""

    def __init__(self,child,deadline):
        self.child,self.deadline = child,deadline
        self.buffer = bytearray()
        self.received = 0
        self.next_id = 0
        os.set_blocking(child.stdin.fileno(),False)
        os.set_blocking(child.stdout.fileno(),False)

    def send(self,value):
        pending = memoryview((_canonical(value)+'\n').encode('utf-8'))
        fd = self.child.stdin.fileno()
        while pending:
            left = _remaining(self.deadline)
            _require(left>0 and bool(select.select([],[fd],[],left)[1]),NO_ANSWER)
            try:
                count = os.write(fd,pending)
            except (BlockingIOError,InterruptedError):
                continue
            except BrokenPipeError as error:
                # It stopped reading: it exited, or closed its input, without answering.
                raise BrokerError(NO_ANSWER) from error
            _require(count>0)
            pending = pending[count:]

    def receive(self):
        while True:
            _require(_remaining(self.deadline)>0,NO_ANSWER)
            newline = self.buffer.find(b'\n')
            if newline>=0:
                raw = bytes(self.buffer[:newline])
                del self.buffer[:newline+1]
                value = _json(raw.decode('utf-8'))
                _require(type(value) is dict)
                return value
            fd = self.child.stdout.fileno()
            _require(bool(select.select([fd],[],[],_remaining(self.deadline))[0]),NO_ANSWER)
            try:
                block = os.read(fd,min(16384,MAX_INBOUND+1-self.received))
            except (BlockingIOError,InterruptedError):
                continue
            # Its output ended before the answer: it exited, or will, without answering.
            _require(bool(block),NO_ANSWER)
            self.received += len(block)
            _require(self.received<=MAX_INBOUND,PROTOCOL)
            self.buffer.extend(block)

    def call(self,method,params):
        self.next_id += 1
        request_id = self.next_id
        self.send(dict(id=request_id,method=method,params=params))
        while True:
            value = self.receive()
            if 'method' in value:
                # Notifications are bounded by the same bytes and time. An
                # unsolicited request cannot obtain an approval or agent reply.
                _require('id' not in value and isinstance(value['method'],str)
                         and bool(value['method']))
                continue
            _require(type(value.get('id')) is int and value['id']==request_id
                     and 'error' not in value and 'result' in value)
            return value['result']


def _initialize(rpc,root):
    result = rpc.call('initialize',dict(clientInfo=dict(name=CLIENT,version='1'),
                                     capabilities=dict(experimentalApi=True)))
    refusal = handshake_refusal(result,CLIENT,root)
    _require(refusal is None,refusal)
    rpc.send(dict(method='initialized'))


def _item(value):
    _require(type(value) is dict and isinstance(value.get('id'),str) and bool(value['id'])
             and isinstance(value.get('clientUserMessageId'),str) and bool(value['clientUserMessageId'])
             and type(value.get('input')) is list)
    _require(all(type(item) is dict and isinstance(item.get('type'),str)
                 and bool(item['type']) for item in value['input']))
    return value


def _page(value,seen):
    _require(type(value) is dict and type(value.get('data')) is list
             and len(value['data'])<=PAGE_LIMIT)
    # Validate the complete returned page before allowing an early match.
    items = [_item(item) for item in value['data']]
    cursor = value.get('nextCursor')
    _require(cursor is None or (isinstance(cursor,str) and 0<len(cursor.encode('utf-8'))<=4096
                               and cursor not in seen))
    if cursor is not None:
        seen.add(cursor)
    return items,cursor


def _hint(payload,config):
    return dict(protocol='theseus-wake',v=1,binding=dict(payload['binding']),
                destination=dict(config.destination),profile=config.profile_path,
                wake_generation=payload['wake_generation'],attempt_id=payload['attempt_id'],
                instruction=INSTRUCTION)


def _matches(item,hint):
    inputs = item['input']
    if not item['clientUserMessageId'].startswith('theseus-wake-') or len(inputs)!=1:
        return False
    text = inputs[0]
    if (set(text)!={'type','text','text_elements'} or text['type']!='text'
            or not isinstance(text['text'],str) or text['text_elements']!=[]):
        return False
    try:
        value = _json(text['text'])
        if type(value) is not dict or set(value)!=set(hint):
            return False
        _payload({key:value[key] for key in ('v','binding','wake_generation','attempt_id')})
        # Only these historical coordinates differ. Everything identifying the
        # exact instance/recipient/destination/profile and instruction must match.
        expected = dict(hint,wake_generation=value['wake_generation'],attempt_id=value['attempt_id'])
        return text['text']==_canonical(expected)
    except (BrokerError,UnicodeError,ValueError):
        return False


def _queue(rpc,payload,config):
    hint = _hint(payload,config)
    thread = config.destination['thread_id']
    cursor,seen = None,set()
    for index in range(MAX_PAGES):
        # Do not spend the add reservation starting another page. A stalled
        # active RPC is an error, never permission to add concurrently.
        if index and _remaining(rpc.deadline)<ADD_SECONDS:
            break
        params = dict(threadId=thread,limit=PAGE_LIMIT)
        if cursor is not None:
            params['cursor'] = cursor
        items,cursor = _page(rpc.call('thread/queue/list',params),seen)
        if any(_matches(item,hint) for item in items):
            return False
        if cursor is None:
            break
    # Too little time left to add: Codex answered too slowly.
    _require(_remaining(rpc.deadline)>=ADD_SECONDS,NO_ANSWER)
    identity = _canonical(dict(binding=payload['binding'],attempt_id=payload['attempt_id']))
    client_id = 'theseus-wake-'+hashlib.sha256(identity.encode('utf-8')).hexdigest()
    inputs = [dict(type='text',text=_canonical(hint),text_elements=[])]
    result = rpc.call('thread/queue/add',dict(threadId=thread,clientUserMessageId=client_id,input=inputs))
    _require(type(result) is dict and 'queuedSubmission' in result)
    receipt = _item(result['queuedSubmission'])
    _require(receipt['clientUserMessageId']==client_id and receipt['input']==inputs)
    return True


def _refuse(reason):
    """Report why on standard output, as one JSON line the invocation owner reads
    (wake_adapter.refusal_reason), and exit 1. It names a fixed code and the
    versions Codex reported, never a request, profile, body or credential. A
    reader that does not know it, or an owner that discards output, sees exit 1
    as before."""
    line = (_canonical(dict(refused=reason))+'\n').encode('utf-8')
    try:
        os.write(1,line)
    except OSError:
        pass
    return 1


def main(argv=None, *, started=None):
    # The executable captures this before importing repository modules. The
    # outer adapter independently bounds interpreter startup and group cleanup.
    deadline = (time.monotonic() if started is None else started)+TOTAL_SECONDS
    rpc_deadline = deadline-CLEANUP_SECONDS
    child = None
    accepted = False
    added = False
    # Why it is refused, by stage, unless the refusal names its own reason.
    reason = 'broker_config'
    try:
        argv = sys.argv[1:] if argv is None else argv
        _require(len(argv)==2 and argv[0]=='--config')
        payload = _stdin(rpc_deadline)
        config = load_config(argv[1],expected_binding=payload['binding'])
        _require(_remaining(rpc_deadline)>0)
        environment = {key:os.environ[key] for key in ('HOME','LANG','TMPDIR') if key in os.environ}
        environment['PATH'] = '/usr/bin:/bin'
        environment['CODEX_HOME'] = config.destination['codex_home']
        reason = 'codex_spawn'
        child = subprocess.Popen([config.codex_executable,'app-server','--listen','stdio://'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            shell=False,env=environment,start_new_session=False,close_fds=True,bufsize=0)
        reason = PROTOCOL
        rpc = _RPC(child,rpc_deadline)
        _initialize(rpc,config.destination['codex_home'])
        added = _queue(rpc,payload,config)
        accepted = True
    except BrokerError as error:
        # No request, profile, body or credential is logged. A nonzero process
        # result is not a statement about the durable fate of an attempted add.
        accepted = False
        reason = error.reason or reason
    except Exception:
        accepted = False
    finally:
        if child is not None:
            try:
                child.stdin.close()
                child.stdout.close()
                _require(child.wait(timeout=_remaining(deadline))==0 and _remaining(deadline)>0)
            except Exception:
                if accepted:
                    # The add went through, but the API child did not exit cleanly in time.
                    reason = 'codex_exit'
                accepted = False
                # Do not signal or detach. The invocation owner retains the
                # broker leader until its existing group cleanup is confirmed.
    if not accepted:
        return _refuse(reason)
    return 0 if added else wake_adapter.QUEUED_EXIT

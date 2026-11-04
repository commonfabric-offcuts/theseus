from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
import time
import unittest
from unittest import mock

from aim_next import wake_adapter
import test_broker_routes as routes_setup


INSTRUCTION = ('Read current durable work through the bound Theseus CLI profile. '
               'Use paged delivery reads; do not filter by this historical wake generation. '
               'Reply and acknowledge separately. Stop on a binding mismatch; never rebind.')
VERSION = '0.163.0-alpha.10.2'
CLIENT = 'theseus_wake_broker'

# Executed only in isolated fixtures. It records requests actually received over
# stdin, including an EOF record before exit. It never opens a real Codex root.
SERVER = r'''
from __future__ import annotations
import json, os, sys, time
from pathlib import Path

SCENARIO = __SCENARIO__
TRACE = Path(__TRACE__)
def record(kind, **fields):
    with TRACE.open('a') as out:
        out.write(json.dumps(dict(kind=kind, at_ns=time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW), **fields))+'\n')
def send(value):
    raw=json.dumps(value)+'\n'
    if SCENARIO.get('split_response'):
        half=len(raw)//2
        sys.stdout.write(raw[:half]);sys.stdout.flush()
        time.sleep(0.005)
        sys.stdout.write(raw[half:]);sys.stdout.flush()
    else:
        sys.stdout.write(raw);sys.stdout.flush()
record('start', argv=sys.argv[1:], pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp(),
       home=os.environ.get('CODEX_HOME'), env_keys=sorted(os.environ))
page = 0
for line in sys.stdin:
    request = json.loads(line)
    record('request', value=request)
    method = request.get('method')
    if method == 'initialized':
        continue
    for i in range(SCENARIO.get('notifications',0)):
        send(dict(method='remoteControl/status/changed',params={'fixture':True,'n':i}))
    delay=SCENARIO.get('delays',{}).get(method,0)
    if delay:
        time.sleep(delay)
    if method == 'initialize':
        if SCENARIO.get('server_request'):
            send(dict(id=999,method='item/commandExecution/requestApproval',params={}))
            continue
        if SCENARIO.get('flood'):
            try:
                for i in range(SCENARIO.get('flood_count',180)):
                    send(dict(method='fixture/notice',params={'data':'x'*8192}))
            except BrokenPipeError:
                record('output-closed')
                try:sys.stdout.close()
                except BrokenPipeError:pass
                sys.stdout=None
                sys.stdin.read()
                record('eof',ppid=os.getppid())
                record('exit',code=0,ppid=os.getppid())
                sys.exit(0)
        result = dict(userAgent=SCENARIO.get('user_agent',
            request['params']['clientInfo']['name']+'/'+SCENARIO.get('version','0.163.0-alpha.10.2')+' fixture'),
            codexHome=SCENARIO.get('root',os.environ.get('CODEX_HOME')))
    elif method == 'thread/queue/list':
        if SCENARIO.get('partial'):
            sys.stdout.write('{"id":');sys.stdout.flush()
            # No newline or response: wait for broker EOF, not a private retry.
            continue
        if SCENARIO.get('list_error'):
            send(dict(id=request['id'],error={'code':-32001,'message':'fixture'}))
            continue
        pages = SCENARIO.get('pages',[{'data':[],'nextCursor':None}])
        result = pages[min(page,len(pages)-1)];page += 1
    elif method == 'thread/queue/add':
        params = request['params']
        if SCENARIO.get('lost_add'):
            record('lost_add');sys.exit(0)
        result = {'queuedSubmission':dict(id='fixture-item',
            clientUserMessageId=params['clientUserMessageId'],input=params['input'])}
        if 'receipt_patch' in SCENARIO:
            result['queuedSubmission'].update(SCENARIO['receipt_patch'])
        case=SCENARIO.get('receipt_case')
        if case=='alter-text':
            result['queuedSubmission']['input'][0]['text']+='x'
        elif case=='text-elements':
            result['queuedSubmission']['input'][0]['text_elements']=[{'byteRange':{'start':0,'end':1}}]
        elif case=='extra-input':
            result['queuedSubmission']['input'].append({'type':'text','text':'extra','text_elements':[]})
        elif case=='missing-wrapper':
            result={}
    else:
        record('forbidden_method', method=method);sys.exit(81)
    if SCENARIO.get('duplicate_id') and method=='initialize':
        sys.stdout.write('{"id":999,"id":'+str(request['id'])+',"result":'+json.dumps(result)+'}\n')
        sys.stdout.flush()
    else:
        response_id=request['id']
        if SCENARIO.get('boolean_id') and method=='initialize':
            response_id=True
        if SCENARIO.get('wrong_id_method')==method:
            if SCENARIO.get('wrong_id_type'):
                response_id=str(response_id) if type(response_id) is int else 999
            else:
                response_id=response_id+1 if type(response_id) is int else response_id+'-wrong'
        send(dict(id=response_id,result=result))
record('eof',ppid=os.getppid())
if SCENARIO.get('late_exit'):
    time.sleep(8)
record('exit', code=SCENARIO.get('exit_code',0),ppid=os.getppid())
sys.exit(SCENARIO.get('exit_code',0))
'''

# A test-only bootstrap runs the actual broker script in this same owned
# process. It can rewrite the fixture config immediately after the real pin
# read and observe the exact env passed to Popen before an interpreter adds
# platform variables. It never changes the compared pin or transport result.
BOOTSTRAP = r'''
from __future__ import annotations
import json, os, runpy, subprocess, sys, time
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,__SOURCE_ROOT__)
from aim_next import Store
trace=Path(__TRACE__)
def record(kind,**fields):
    with trace.open('a') as out:
        out.write(json.dumps(dict(kind=kind,at_ns=time.clock_gettime_ns(time.CLOCK_MONOTONIC_RAW),**fields))+'\n')
record('broker-env',home=os.environ.get('CODEX_HOME'),marker=os.environ.get('THESEUS_TEST_MUST_NOT_INHERIT'))
after_pin=__AFTER_PIN__
original_pin=Store.read_route_pin
if after_pin is not None:
    def read_pin(self,actor,destination):
        result=original_pin(self,actor,destination)
        record('pin-compared',destination=result['destination'])
        path=Path(__CONFIG__)
        value=json.loads(path.read_text())
        value['destination']=after_pin
        path.write_text(json.dumps(value))
        record('config-rewritten',destination=json.loads(path.read_text())['destination'])
        return result
    Store.read_route_pin=read_pin
original_popen=subprocess.Popen
def launch(*args,**kwargs):
    argv=args[0] if args else kwargs.get('args')
    if argv and list(argv[1:])==['app-server','--listen','stdio://']:
        env=kwargs.get('env')
        record('requested-api-env',explicit=env is not None,keys=sorted(env or {}),
               home=(env or {}).get('CODEX_HOME'),marker=(env or {}).get('THESEUS_TEST_MUST_NOT_INHERIT'))
    return original_popen(*args,**kwargs)
subprocess.Popen=launch
runpy.run_path(__BROKER__,run_name='__main__')
'''


class CodexBrokerCase(unittest.TestCase):
    # Reuse isolated Core setup, not the inherited config test methods.
    setUp = routes_setup.BrokerRouteCase.setUp
    save = routes_setup.BrokerRouteCase.save
    provision = routes_setup.BrokerRouteCase.provision

    def tearDown(self):
        self.assertEqual(wake_adapter._UNCONFIRMED_CHILDREN,[],
                         'unconfirmed owned child is an infrastructure failure, never a test verdict')

    def fixture(self, scenario=None, *, config_changes=None, after_pin=None, ambient=False):
        count = getattr(self, 'fixture_count', 0) + 1
        self.fixture_count = count
        trace = self.root / ('rpc-%s.jsonl' % count)
        executable = self.root / ('codex-fixture-%s' % count)
        code = SERVER.replace('__SCENARIO__',repr(scenario or {})).replace('__TRACE__',repr(str(trace)))
        executable.write_text('#!/usr/bin/python3\n'+code)
        executable.chmod(0o700)
        value=dict(self.config_value,codex_executable=str(executable))
        value.update(config_changes or {})
        self.save(self.config,value)
        broker = Path(__file__).resolve().parents[1]/'bin'/'aim-next-codex-broker'
        self.assertTrue(broker.is_file(), 'selected stdio broker must exist before dispatch')
        if after_pin is not None or ambient:
            wrapper=self.root/('broker-bootstrap-%s' % count)
            code=BOOTSTRAP.replace('__SOURCE_ROOT__',repr(str(broker.parent.parent)))
            for key,content in [('__TRACE__',str(trace)),('__CONFIG__',str(self.config)),
                                ('__BROKER__',str(broker)),('__AFTER_PIN__',after_pin)]:
                code=code.replace(key,repr(content))
            wrapper.write_text('#!/usr/bin/python3\n'+code);wrapper.chmod(0o700)
            broker=wrapper
        self.save(self.route,dict(self.route_value,profile=value['profile'],
            argv=[str(broker),'--config',str(self.config)]))
        return trace

    def dispatch(self, scenario=None, *, stdin=None, claim=None, config_changes=None,
                 after_pin=None, ambient=False):
        trace = self.fixture(scenario,config_changes=config_changes,after_pin=after_pin,ambient=ambient)
        claim = dict(claim or self.claim)
        claim['lease_until_ms'] = int(time.time()*1000)+20000
        before = self.db.read_bytes()
        registered = []
        def register(pid, started):
            registered.append(pid)
            return dict(status='recorded',instance_id='broker-fixture')
        with self.store.runner_guard('broker-fixture-runner') as guard:
            prepared = wake_adapter.prepare_route(self.route,claim,guard)
            if stdin is not None:
                prepared = replace(prepared,stdin=stdin)
            original_popen=wake_adapter.subprocess.Popen
            injected=[]
            def launch(*args,**kwargs):
                # Inject after the real adapter's allowlist, into exactly its
                # owned broker child. Preserve group, inherited guards and pipes.
                if ambient and kwargs.get('executable')==prepared.executable:
                    kwargs=dict(kwargs,env=dict(kwargs['env'],CODEX_HOME='/wrong-ambient-root',
                        THESEUS_TEST_MUST_NOT_INHERIT='fixture-marker'))
                    injected.append(True)
                return original_popen(*args,**kwargs)
            with mock.patch.object(wake_adapter,'prepare_route',return_value=prepared), \
                    mock.patch.object(wake_adapter.subprocess,'Popen',side_effect=launch):
                result = wake_adapter.run_route(self.route,claim,guard,
                    owner_lease_until_ms=claim['lease_until_ms']+1000,record_child=register)
            self.assertEqual(len(injected),int(ambient))
        self.assertEqual(self.db.read_bytes(),before,'wake transport cannot acknowledge or alter durable work')
        rows = [json.loads(s) for s in trace.read_text().splitlines()] if trace.exists() else []
        print('BROKER_OBSERVATION '+json.dumps(dict(outcome=result.outcome,reason=result.reason,
            exit_code=result.exit_code,registered_broker_pids=registered,events=rows),sort_keys=True),flush=True)
        self.assertEqual(len(registered),1)
        for row in rows:
            if row['kind']=='start':
                self.assertEqual(row['pgid'],registered[0],'API child must remain in owned broker group')
                self.assertEqual(row['ppid'],registered[0])
            if row['kind']=='exit':self.assertEqual(row['ppid'],registered[0])
        self.assertEqual(wake_adapter._UNCONFIRMED_CHILDREN,[])
        return result,rows

    def requests(self,rows,method=None):
        values=[r['value'] for r in rows if r['kind']=='request']
        return [r for r in values if method is None or r['method']==method]

    def hint(self, *, binding=None, destination=None, generation=900, attempt='old-attempt', **changes):
        value=dict(protocol='theseus-wake',v=1,binding=dict(binding or self.expected),
            destination=dict(destination or self.destination),profile=str(self.profiles['agent-a']),
            wake_generation=generation,attempt_id=attempt,instruction=INSTRUCTION)
        value.update(changes)
        return dict(id='already-queued',clientUserMessageId='theseus-wake-fixture',input=[
            dict(type='text',text=json.dumps(value,sort_keys=True,separators=(',',':'),
                                           ensure_ascii=False,allow_nan=False),text_elements=[])])

    def assertAccepted(self,result,rows,added=True):
        self.assertEqual(result.outcome,'accepted')
        self.assertEqual(result.exit_code,0)
        self.assertEqual([r['kind'] for r in rows][-2:],['eof','exit'])
        self.assertEqual(len(self.requests(rows,'thread/queue/add')),int(added))
        self.assertTrue(set(r['method'] for r in self.requests(rows)) <= {
            'initialize','initialized','thread/queue/list','thread/queue/add'})
        for index,request in enumerate(self.requests(rows,'thread/queue/list')):
            params=request['params']
            self.assertEqual(set(params),{'threadId','limit'} | ({'cursor'} if index else set()))
            self.assertEqual(params['threadId'],self.destination['thread_id'])
            self.assertEqual(params['limit'],100)

    def test_exact_handshake_bound_root_receipt_and_clean_exit(self):
        result,rows=self.dispatch()
        self.assertAccepted(result,rows)
        start=next(r for r in rows if r['kind']=='start')
        self.assertEqual(start['argv'],['app-server','--listen','stdio://'])
        self.assertEqual(start['home'],self.destination['codex_home'])
        self.assertNotIn('THESEUS_TEST_MUST_NOT_INHERIT',start['env_keys'])
        requests=self.requests(rows)
        self.assertEqual([r['method'] for r in requests],
            ['initialize','initialized','thread/queue/list','thread/queue/add'])
        self.assertEqual(requests[0]['params']['clientInfo']['name'],CLIENT)
        self.assertIs(requests[0]['params']['capabilities']['experimentalApi'],True)
        params=requests[-1]['params']
        self.assertEqual(params['threadId'],self.destination['thread_id'])
        self.assertTrue(params['clientUserMessageId'].startswith('theseus-wake-'))
        self.assertEqual(set(params),{'threadId','clientUserMessageId','input'})
        expected=self.hint(generation=1,attempt='attempt-a')['input']
        self.assertEqual(params['input'],expected)
        self.assertEqual(requests[2]['params']['limit'],100)

    def test_actual_broker_ambient_environment_cannot_select_api_destination(self):
        result,rows=self.dispatch(ambient=True)
        self.assertAccepted(result,rows)
        initial=next(r for r in rows if r['kind']=='broker-env')
        self.assertEqual(initial['home'],'/wrong-ambient-root')
        self.assertEqual(initial['marker'],'fixture-marker')
        requested=next(r for r in rows if r['kind']=='requested-api-env')
        self.assertIs(requested['explicit'],True)
        self.assertTrue(set(requested['keys']) <= {'HOME','LANG','TMPDIR','PATH','CODEX_HOME'})
        self.assertEqual(requested['home'],self.destination['codex_home'])
        self.assertIsNone(requested['marker'])
        start=next(r for r in rows if r['kind']=='start')
        self.assertEqual(start['home'],self.destination['codex_home'])
        self.assertNotIn('THESEUS_TEST_MUST_NOT_INHERIT',start['env_keys'])

    def test_child_unpinned_root_thread_or_missing_pin_starts_no_api_process(self):
        other=self.root/'other-codex-home';other.mkdir(mode=0o700)
        for destination in (dict(self.destination,codex_home=str(other)),
                            dict(self.destination,thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')):
            with self.subTest(destination=destination):
                result,rows=self.dispatch(config_changes=dict(destination=destination))
                self.assertEqual(result.outcome,'error')
                self.assertEqual(rows,[])
        claim=dict(self.claim,recipient_id='agent-b',route_binding=dict(self.expected,actor_id='agent-b'))
        result,rows=self.dispatch(claim=claim,config_changes=dict(profile=str(self.profiles['agent-b'])))
        self.assertEqual(result.outcome,'error')
        self.assertEqual(rows,[])

    def test_child_uses_captured_destination_after_actual_post_pin_config_rewrite(self):
        other=self.root/'rewritten-home';other.mkdir(mode=0o700)
        replacement=dict(self.destination,codex_home=str(other),thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        result,rows=self.dispatch(after_pin=replacement)
        self.assertAccepted(result,rows)
        self.assertEqual(json.loads(self.config.read_text())['destination'],replacement)
        self.assertEqual(next(r for r in rows if r['kind']=='pin-compared')['destination'],self.destination)
        self.assertEqual(next(r for r in rows if r['kind']=='config-rewritten')['destination'],replacement)
        self.assertLess(next(i for i,r in enumerate(rows) if r['kind']=='config-rewritten'),
                        next(i for i,r in enumerate(rows) if r['kind']=='start'))
        self.assertLess(next(r['at_ns'] for r in rows if r['kind']=='config-rewritten'),
                        next(r['at_ns'] for r in rows if r['kind']=='start'))
        self.assertEqual(next(r for r in rows if r['kind']=='start')['home'],self.destination['codex_home'])
        self.assertEqual(self.requests(rows,'thread/queue/add')[0]['params']['threadId'],self.destination['thread_id'])
        for value in (replacement['codex_home'],replacement['thread_id']):
            self.assertNotIn(value,json.dumps(self.requests(rows)))

    def test_undelivered_message_body_never_crosses_the_queue_boundary(self):
        body='PRIVATE-FIXTURE-BODY-7f073180c9d1424b'
        pin={key:self.binding[key] for key in ('authority_id','authority_epoch')}
        def command(operation,kind,args,target=None,expected=None):
            result=self.store.command('agent-b',dict(v=1,instance_id='broker-fixture',operation_id=operation,
                kind=kind,args=args,target=target or {},expected=dict(expected or {},authority=pin)))
            self.assertEqual(result.get('status'),'committed',result)
            return result
        command('seed-workspace','workspace.create',dict(id='broker-workspace',title='Isolated delivery',team=['agent-a']))
        source=dict(kind='new_topic',id='broker-opening',workspace_id='broker-workspace')
        command('seed-draft','draft.save',dict(source_ref=source,topic_id='broker-topic',body=body,
            generation='gA',attachments=[],quotes=[],addressees=[],
            opening=dict(workspace_id='broker-workspace',title='Fixture topic',participants=['agent-a'])),
            target=dict(draft_id='broker-draft'),expected=dict(draft_revision=0))
        command('seed-prepare','submission.prepare',dict(draft_id='broker-draft',submission_id='broker-submission',
            send_operation_id='seed-send'),target=dict(topic_id='broker-topic'),expected=dict(draft_revision=1))
        sent=command('seed-send','topic.create_and_send',dict(submission_id='broker-submission'),
            target=dict(topic_id='broker-topic'))
        pending=self.store.view('agent-a','deliveries',dict(limit=1))
        self.assertEqual([item['message_id'] for item in pending['items']],[sent['result']['message_id']])
        result,rows=self.dispatch()
        self.assertAccepted(result,rows)
        self.assertNotIn(body,json.dumps(self.requests(rows)))
        self.assertEqual(self.store.view('agent-a','deliveries',dict(limit=1)),pending)

    def test_queued_match_coalesces_across_generation_and_attempt(self):
        result,rows=self.dispatch({'pages':[dict(data=[self.hint()],nextCursor=None)]})
        self.assertAccepted(result,rows,added=False)

    def test_foreign_binding_destination_profile_and_unknown_hint_do_not_coalesce(self):
        alternatives=[]
        for key in self.expected:
            alternatives.append(self.hint(binding=dict(self.expected,**{key:'foreign'})))
        for key,value in [('codex_home',str(self.root)),('thread_id','aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
                          ('protocol_version',2),('kind','different')]:
            alternatives.append(self.hint(destination=dict(self.destination,**{key:value})))
        alternatives.extend([self.hint(profile=str(self.profiles['agent-b'])),
            self.hint(protocol='other'),self.hint(v=2),self.hint(instruction='different'),
            self.hint(wake_generation=True),self.hint(extra='unknown')])
        for item in alternatives:
            with self.subTest(text=item['input'][0]['text']):
                result,rows=self.dispatch({'pages':[dict(data=[item],nextCursor=None)]})
                self.assertAccepted(result,rows)

    def test_destination_protocol_types_do_not_coalesce_by_numeric_equality(self):
        for version in (True,1.0):
            with self.subTest(protocol_version=version):
                item=self.hint(destination=dict(self.destination,protocol_version=version))
                result,rows=self.dispatch({'pages':[dict(data=[item],nextCursor=None)]})
                self.assertAccepted(result,rows)

    def test_plaintext_duplicate_hint_fields_and_extra_input_never_coalesce(self):
        plain=self.hint();plain['input'][0]['text']='theseus-wake please read your inbox'
        duplicate=self.hint()
        raw=duplicate['input'][0]['text']
        duplicate['input'][0]['text']=raw[:-1]+',"v":1}'
        extra=self.hint();extra['input'].append(dict(type='text',text='another instruction',text_elements=[]))
        marked=self.hint();marked['input'][0]['text_elements']=[{'byteRange':{'start':0,'end':1}}]
        for item in (plain,duplicate,extra,marked):
            with self.subTest(input=item['input']):
                result,rows=self.dispatch({'pages':[dict(data=[item],nextCursor=None)]})
                self.assertAccepted(result,rows)

    def test_valid_incomplete_scan_stops_after_two_pages_then_adds_once(self):
        result,rows=self.dispatch({'pages':[
            dict(data=[],nextCursor='page-two'),dict(data=[],nextCursor='page-three'),
            dict(data=[self.hint()],nextCursor=None)]})
        self.assertAccepted(result,rows)
        calls=self.requests(rows,'thread/queue/list')
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[1]['params']['cursor'],'page-two')
        self.assertTrue(all(r['params']['limit']==100 for r in calls))

    def test_fresh_attempt_after_queue_consumption_gets_new_client_id(self):
        first,a=self.dispatch()
        second,b=self.dispatch(claim=dict(self.claim,attempt_id='attempt-b'))
        self.assertAccepted(first,a);self.assertAccepted(second,b)
        ids=[self.requests(rows,'thread/queue/add')[0]['params']['clientUserMessageId'] for rows in (a,b)]
        self.assertNotEqual(*ids)

    def test_same_attempt_with_another_valid_actor_binding_gets_new_client_id(self):
        first,a=self.dispatch()
        self.assertAccepted(first,a)
        self.destination=dict(self.destination,thread_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        self.provision('agent-b',self.destination)
        claim=dict(self.claim,recipient_id='agent-b',route_binding=dict(self.expected,actor_id='agent-b'))
        second,b=self.dispatch(claim=claim,config_changes=dict(profile=str(self.profiles['agent-b']),
                                                             destination=self.destination))
        self.assertAccepted(second,b)
        self.assertNotEqual(self.requests(a,'thread/queue/add')[0]['params']['clientUserMessageId'],
                            self.requests(b,'thread/queue/add')[0]['params']['clientUserMessageId'])

    def test_version_token_and_effective_root_must_match_before_queue_rpc(self):
        cases=[dict(version=VERSION+'x'),dict(version=VERSION+'0'),dict(version='0.1.0'),
               dict(user_agent=CLIENT+'/'+VERSION),dict(user_agent='other/'+VERSION+' fixture'),
               dict(user_agent=CLIENT+'/'+VERSION+'\tfixture'),dict(user_agent=CLIENT+'/'+VERSION+' '),
               dict(root=str(self.root)),dict(root=None)]
        for scenario in cases:
            with self.subTest(scenario=scenario):
                result,rows=self.dispatch(scenario)
                self.assertEqual(result.outcome,'error')
                self.assertFalse([r for r in self.requests(rows) if r['method'].startswith('thread/')])

    def test_malformed_pages_and_repeated_cursor_never_authorize_add(self):
        for pages in ([dict(data='bad')],[dict(data=[],nextCursor=7)],
                      [dict(data=[None])],[dict(data=[self.hint(),None])],
                      [dict(data=[self.hint()]*101)],
                      [dict(data=[],nextCursor='repeat'),dict(data=[],nextCursor='repeat')]):
            with self.subTest(pages=pages):
                result,rows=self.dispatch(dict(pages=pages))
                self.assertEqual(result.outcome,'error')
                self.assertFalse(self.requests(rows,'thread/queue/add'))

    def test_exact_add_receipt_is_required(self):
        for patch in (dict(id=''),dict(id=7),dict(clientUserMessageId='other'),dict(input=[])):
            with self.subTest(patch=patch):
                result,rows=self.dispatch(dict(receipt_patch=patch))
                self.assertEqual(result.outcome,'error')
                self.assertEqual(len(self.requests(rows,'thread/queue/add')),1)
        for case in ('alter-text','text-elements','extra-input','missing-wrapper'):
            with self.subTest(case=case):
                result,rows=self.dispatch(dict(receipt_case=case))
                self.assertEqual(result.outcome,'error')
                self.assertEqual(len(self.requests(rows,'thread/queue/add')),1)

    def test_lost_add_response_is_error_not_acceptance_or_retry(self):
        result,rows=self.dispatch(dict(lost_add=True))
        self.assertEqual(result.outcome,'error')
        self.assertEqual(len(self.requests(rows,'thread/queue/add')),1)

    def test_server_request_duplicate_json_and_rpc_error_never_add(self):
        for key in ('server_request','duplicate_id','list_error'):
            with self.subTest(key=key):
                result,rows=self.dispatch({key:True})
                self.assertEqual(result.outcome,'error')
                self.assertFalse(self.requests(rows,'thread/queue/add'))

    def test_each_rpc_requires_its_exact_typed_response_id(self):
        for method in ('initialize','thread/queue/list','thread/queue/add'):
            for wrong_type in (False,True):
                with self.subTest(method=method,wrong_type=wrong_type):
                    result,rows=self.dispatch(dict(wrong_id_method=method,wrong_id_type=wrong_type))
                    self.assertEqual(result.outcome,'error')
                    self.assertEqual(len(self.requests(rows,'thread/queue/add')),int(method=='thread/queue/add'))

    def test_bounded_notifications_and_split_frames_are_valid(self):
        result,rows=self.dispatch(dict(notifications=3,split_response=True))
        self.assertAccepted(result,rows)
        result,rows=self.dispatch(dict(flood=True,flood_count=120))
        self.assertAccepted(result,rows)

    def test_boolean_response_id_cannot_match_integer_one(self):
        result,rows=self.dispatch(dict(boolean_id=True))
        self.assertEqual(result.outcome,'error')
        self.assertFalse(self.requests(rows,'thread/queue/list'))
        self.assertFalse(self.requests(rows,'thread/queue/add'))

    def test_partial_frame_and_notification_flood_are_bounded(self):
        for key in ('partial','flood'):
            with self.subTest(key=key):
                result,rows=self.dispatch({key:True})
                self.assertEqual(result.outcome,'error')
                self.assertEqual(result.reason,'broker_exit','outer adapter deadline must not supply this refusal')
                self.assertFalse(self.requests(rows,'thread/queue/add'))
                start=next(r['at_ns'] for r in rows if r['kind']=='start')
                exited=next(r['at_ns'] for r in rows if r['kind']=='exit')
                self.assertLess(exited-start,4500000000,'API child must close within the internal budget')

    def test_late_valid_list_does_not_erase_the_reserved_add_budget(self):
        result,rows=self.dispatch(dict(delays={'initialize':1.4,'thread/queue/list':1.4}))
        self.assertEqual(result.outcome,'error')
        self.assertEqual(result.reason,'broker_exit')
        self.assertEqual(len(self.requests(rows,'thread/queue/list')),1)
        self.assertFalse(self.requests(rows,'thread/queue/add'))
        start=next(r['at_ns'] for r in rows if r['kind']=='start')
        exited=next(r['at_ns'] for r in rows if r['kind']=='exit')
        self.assertLess(exited-start,4500000000)

    def test_valid_receipt_does_not_hide_nonzero_or_unconfirmed_api_exit(self):
        for scenario in (dict(exit_code=9),dict(late_exit=True)):
            with self.subTest(scenario=scenario):
                result,rows=self.dispatch(scenario)
                self.assertEqual(result.outcome,'error')
                self.assertNotEqual(result.exit_code,0,
                    'outer descendant guard must not mask a broker claiming acceptance before API exit')
                self.assertEqual(len(self.requests(rows,'thread/queue/add')),1)

    def test_child_independently_rejects_foreign_or_malformed_hint_before_spawn(self):
        value=dict(v=1,binding=self.expected,wake_generation=1,attempt_id='attempt-a')
        payloads=[b'x',b' '*8193,b'{"v":1,"v":1}',json.dumps(dict(value,extra=True)).encode()]
        for key in self.expected:
            foreign=str(self.root/'other.sqlite3') if key=='db_path' else 'foreign'
            payloads.append(json.dumps(dict(value,binding=dict(self.expected,**{key:foreign}))).encode())
        for raw in payloads:
            with self.subTest(raw=raw[:100]):
                result,rows=self.dispatch(stdin=raw)
                self.assertEqual(result.outcome,'error')
                self.assertEqual(rows,[],'no API process may start for an unbound input')

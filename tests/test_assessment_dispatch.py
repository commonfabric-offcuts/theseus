from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
import uuid

from aim_next.assessment_dispatch import Core, DispatchError, Session, drive, request_lock, read_tool
from aim_next.codex_host import ProvisionError
from aim_next.profile import Profile
import test_assessments


class Native:
    """Persistent native history shared by successive drivers; no model or live account."""
    def __init__(self, source, passage):
        self.threads, self.calls, self.fail, self.active, self.source = {}, [], None, False, source
        self.passage = passage

    def call(self, method, params):
        self.calls.append((method,params))
        if method == 'thread/start':
            thread = str(uuid.uuid4()); self.threads[thread] = None
            result = dict(params,thread={'id':thread},sandbox={'type':'readOnly'})
        elif method == 'thread/inject_items':
            result = {}
        elif method == 'thread/resume':
            result = dict(params,thread={'id':params['threadId'],'status':{'type':'active' if self.active else 'idle'}},sandbox={'type':'readOnly'})
        elif method == 'thread/turns/list':
            last = self.threads[params['threadId']]
            result = {'data':[] if last is None else [last]}
        elif method == 'turn/start':
            turn = {'id':str(uuid.uuid4()),'status':'inProgress'}
            self.threads[params['threadId']] = turn
            result = {'turn':turn}
        elif method == 'thread/items/list':
            result = {'data':[{'turnId':params['turnId'],'item':{'type':'agentMessage','phase':'final_answer',
                'text':json.dumps({'body':'Continue: the named artifact is present; the queue is external.',
                    'recommendation':'continue','evidence_message_ids':[self.source],
                    'next_checkpoint':'Verify the deployed artifact',
                    'reply_passage':self.passage})}}], 'nextCursor':None}
        else:
            raise AssertionError(method)
        if self.fail == method:
            self.fail = None
            raise DispatchError('simulated_lost_response')
        return result

    def wait_turn(self, thread, turn):
        self.calls.append(('wait',(thread,turn)))
        self.threads[thread]['status'] = 'completed'


class DispatchCase(unittest.TestCase):
    setUpBase = test_assessments.AssessmentCase.setUp
    ok, command, workspace, sql = (test_assessments.AssessmentCase.ok, test_assessments.AssessmentCase.command,
                                   test_assessments.AssessmentCase.workspace,test_assessments.AssessmentCase.sql)
    request = test_assessments.AssessmentCase.request

    def setUp(self):
        self.setUpBase()
        self.profile = Profile('test-instance','agent-b',self.path,Path(self.binding['authority_path']),
                               self.binding['authority_id'],self.binding['authority_epoch'])
        self.core = Core(self.profile)
        self.config = SimpleNamespace(profile=self.profile,profile_path='/explicit/assessor.json',cli='/explicit/aim-next',
            cwd=str(self.path.parent),model=None,reasoning_effort=None,codex_executable='/explicit/codex',
            destination={'codex_home':'/explicit/home'})
        self.identity = self.ok(self.request())['assessment_id']
        source = self.core.view('source', {'kind':'message', 'id':self.source})
        # This synthetic assessor answers the assignment's requested artifact.
        # Select that fragment explicitly; neither the dispatcher nor fake wire
        # invents a reason or chooses the whole parent for a missing caller.
        self.assertEqual(source['body'][10:28], 'requested artifact')
        self.passage = {'source':dict(source['source_ref'], revision=source['revision']),
                        'start':10, 'end':28}
        self.native = Native(self.source, self.passage)

    def run_assessment(self):
        return drive(self.core,self.config,self.identity,self.native)

    def count(self,method):
        return sum(m == method for m,_ in self.native.calls)

    def test_full_dispatch_is_fresh_and_repeated_drive_reads_back_one_report(self):
        result = self.run_assessment()
        self.assertEqual(result['status'],'reported')
        self.assertIn('queue is external',result['body'])
        source = self.core.view('source', {'kind':'message', 'id':result['message_id']})
        self.assertEqual(source['quotes'], [dict(self.passage, excerpt='requested artifact')])
        self.assertEqual(source['reply_basis'], dict(self.passage, excerpt='requested artifact', author_id='owner'))
        self.assertTrue(result['body'].startswith('> requested artifact\n\n'))
        calls = list(self.native.calls)
        self.assertEqual(self.run_assessment(),result)
        self.assertEqual(self.native.calls,calls)
        self.assertEqual(self.count('thread/start'),1)
        self.assertEqual(self.count('turn/start'),1)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"),[(0,)])
        for method,params in calls:
            if method in ('thread/start','thread/resume'):
                self.assertEqual(params['sandbox'],'read-only')
                self.assertEqual(params['approvalPolicy'],'never')
                self.assertEqual(params['cwd'],self.config.cwd)

    def test_crash_before_attach_leaves_only_unused_empty_thread(self):
        self.native.fail = 'thread/inject_items'
        with self.assertRaises(DispatchError): self.run_assessment()
        self.assertIsNone(self.core.record(self.identity)['thread_id'])
        self.run_assessment()
        self.assertEqual(self.count('thread/start'),2)
        self.assertEqual(self.count('turn/start'),1)

    def test_crash_after_attach_resumes_same_thread(self):
        self.native.fail = 'thread/resume'
        with self.assertRaises(DispatchError): self.run_assessment()
        thread = self.core.record(self.identity)['thread_id']
        self.run_assessment()
        self.assertEqual(self.count('thread/start'),1)
        self.assertEqual(self.core.record(self.identity)['thread_id'],thread)

    def test_lost_turn_start_response_reconciles_completed_history(self):
        self.native.fail = 'turn/start'
        with self.assertRaises(DispatchError): self.run_assessment()
        thread = self.core.record(self.identity)['thread_id']
        self.native.threads[thread]['status'] = 'completed'
        self.run_assessment()
        self.assertEqual(self.count('turn/start'),1)
        self.assertEqual(self.count('thread/start'),1)

    def test_existing_active_turn_is_waited_for_and_orphan_resumes_same_context(self):
        self.native.fail = 'turn/start'
        with self.assertRaises(DispatchError): self.run_assessment()
        self.native.active = True
        self.run_assessment()
        self.assertEqual(self.count('turn/start'),1)
        # A second assignment models an interrupted process after the child has gone.
        self.identity = self.ok(self.request(op='other',assignment='Next artifact'))['assessment_id']
        self.native.active = False; self.native.fail = 'turn/start'
        with self.assertRaises(DispatchError): self.run_assessment()
        thread = self.core.record(self.identity)['thread_id']
        self.run_assessment()
        self.assertEqual(self.core.record(self.identity)['thread_id'],thread)
        self.assertEqual(self.count('thread/start'),2)
        self.assertEqual(self.count('turn/start'),3)

    def test_changed_runtime_refuses_before_native_call(self):
        self.native.fail = 'thread/resume'
        with self.assertRaises(DispatchError): self.run_assessment()
        calls = list(self.native.calls)
        self.config.destination = {'codex_home':'/other/home'}
        with self.assertRaisesRegex(DispatchError,'runtime_mismatch'): self.run_assessment()
        self.assertEqual(self.native.calls,calls)

    def test_lost_core_finish_response_is_read_back_without_another_turn(self):
        original = self.core.command
        def commit_then_disconnect(identity,action,args):
            result = original(identity,action,args)
            if action == 'finish': raise DispatchError('lost_receipt')
            return result
        self.core.command = commit_then_disconnect
        with self.assertRaisesRegex(DispatchError,'lost_receipt'): self.run_assessment()
        self.core.command = original
        result = self.run_assessment()
        self.assertEqual(result['status'],'reported')
        self.assertEqual(self.count('turn/start'),1)
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',('agent-b',)),[(1,)])

    def test_lock_excludes_second_driver_and_survives_parent_close_while_child_runs(self):
        with request_lock(self.profile,self.identity) as fd:
            with self.assertRaisesRegex(DispatchError,'already_running'):
                with request_lock(self.profile,self.identity): pass
            child = subprocess.Popen([sys.executable,'-c','import sys; print("ready",flush=True); sys.stdin.read()'],
                                     pass_fds=(fd,),stdin=subprocess.PIPE,stdout=subprocess.PIPE)
            self.assertEqual(child.stdout.readline(),b'ready\n')
        try:
            with self.assertRaisesRegex(DispatchError,'already_running'):
                with request_lock(self.profile,self.identity): pass
        finally:
            child.communicate(timeout=5)
        with request_lock(self.profile,self.identity): pass

    def test_native_wire_completion_and_real_child_restart_keep_one_report(self):
        root = Path(__file__).resolve().parents[1]
        home = (self.path.parent / 'codex-home').resolve(); home.mkdir(mode=0o700)
        self.config.destination = {'codex_home':str(home)}
        self.config.codex_executable = str(root / 'tests/fixtures/fake_assessment_server.py')
        report = dict(body='Continue after checking the actual artifact. Résumé 👍',recommendation='continue',
                      evidence_message_ids=[self.source],next_checkpoint='Deploy and verify',
                      reply_passage=self.passage)
        (home/'fake-script.json').write_text(json.dumps({'signed_in':True,'report':report,
                                                        'assessment_die_after_finish':True}))
        with request_lock(self.profile,self.identity) as fd:
            rpc = Session(self.config,fd)
            try:
                with self.assertRaises((DispatchError,ProvisionError)):
                    drive(self.core,self.config,self.identity,rpc)
            finally:
                rpc.close()
        thread = self.core.record(self.identity)['thread_id']
        with request_lock(self.profile,self.identity) as fd:
            rpc = Session(self.config,fd)
            try:
                result = drive(self.core,self.config,self.identity,rpc)
            finally:
                self.assertEqual(rpc.close(),0)

        self.assertEqual(result['body'],'> requested artifact\n\n'+report['body'])
        self.assertEqual(result['thread_id'],thread)
        state = json.loads((home/'fake-state.json').read_text())
        self.assertEqual(len(state['threads']),1)
        self.assertEqual(len(state['threads'][thread]['turns']),1)
        # A second request covers the real wire's early completion notification.
        self.identity = self.ok(self.request(op='second',assignment='Second artifact'))['assessment_id']
        with request_lock(self.profile,self.identity) as fd:
            rpc = Session(self.config,fd)
            try:
                self.assertEqual(drive(self.core,self.config,self.identity,rpc)['status'],'reported')
            finally:
                self.assertEqual(rpc.close(),0)

    def test_dispatcher_child_itself_inherits_request_exclusion(self):
        root = Path(__file__).resolve().parents[1]
        home = (self.path.parent/'lock-home').resolve(); home.mkdir(mode=0o700)
        self.config.destination = {'codex_home':str(home)}
        self.config.codex_executable = str(root/'tests/fixtures/fake_assessment_server.py')
        with request_lock(self.profile,self.identity) as fd:
            rpc = Session(self.config,fd)
        try:
            with self.assertRaisesRegex(DispatchError,'already_running'):
                with request_lock(self.profile,self.identity): pass
        finally:
            self.assertEqual(rpc.close(),0)
        with request_lock(self.profile,self.identity): pass

    def test_read_tool_is_bound_paged_full_and_excludes_private_or_other_topic(self):
        thread = str(uuid.uuid4())
        self.core.command(self.identity,'attach',{'thread_id':thread,'runtime_digest':'a'*64})
        def read(args, **changes):
            params = dict(threadId=thread,tool='theseus_read',arguments=args); params.update(changes)
            return read_tool(self.core,self.identity,{'params':params})
        self.assertEqual(read({'action':'binding'})['actor_id'],'agent-b')
        private = self.ok(self.command('message.post',{'body':'Private evidence','whisper':True,
             'addressees':['agent-b']},{'topic_id':'t1'}))['message_id']
        body = 'Full original source. '*200
        public = [self.ok(self.command('message.post',{'body':body+str(i)},{'topic_id':'t1'}))['message_id'] for i in range(8)]
        first = read({'action':'messages'})
        self.assertNotIn(private,[m['id'] for m in first['items']])
        second = read({'action':'messages','cursor':first['next_cursor']})
        self.assertTrue(set(public) <= {m['id'] for m in first['items']+second['items']})
        self.assertEqual(read({'action':'source','message_id':public[0]})['body'],body+'0')
        with self.assertRaisesRegex(DispatchError,'read_scope'): read({'action':'source','message_id':private})
        other_topic = self.sql("SELECT id FROM topics WHERE kind='conversation'")[0][0]
        other = self.ok(self.command('message.post',{'body':'Another topic'},{'topic_id':other_topic}))['message_id']
        with self.assertRaisesRegex(DispatchError,'read_scope'): read({'action':'source','message_id':other})
        with self.assertRaisesRegex(DispatchError,'read_scope'): read({'action':'binding'},threadId=str(uuid.uuid4()))
        with self.assertRaisesRegex(DispatchError,'unsupported'): read({'action':'message.post','body':'Unwanted write'})

    def test_read_tool_passes_on_a_held_message_as_withheld(self):
        thread = str(uuid.uuid4())
        self.core.command(self.identity,'attach',{'thread_id':thread,'runtime_digest':'a'*64})
        def read(args):
            return read_tool(self.core,self.identity,{'params':{'threadId':thread,'tool':'theseus_read','arguments':args}})
        held = self.ok(self.command('message.post',{'body':'Words its author is changing'},{'topic_id':'t1'}))['message_id']
        self.ok(self.command('message.edit_open',{'holder':'h-laptop'},{'message_id':held}))
        [item] = [m for m in read({'action':'messages'})['items'] if m['id'] == held]
        self.assertEqual((item['withheld'],item['body']),(True,''))
        source = read({'action':'source','message_id':held})
        self.assertEqual((source['withheld'],source['body']),(True,''))
        self.ok(self.command('message.edit_close',{'holder':'h-laptop'},{'message_id':held}))
        [item] = [m for m in read({'action':'messages'})['items'] if m['id'] == held]
        self.assertEqual((item['withheld'],item['body']),(False,'Words its author is changing'))
        self.assertEqual(read({'action':'source','message_id':held})['withheld'],False)

    def test_native_tool_read_is_answered_before_turn_start_reply(self):
        root = Path(__file__).resolve().parents[1]
        home = (self.path.parent/'read-home').resolve(); home.mkdir(mode=0o700)
        self.config.destination = {'codex_home':str(home)}
        self.config.codex_executable = str(root/'tests/fixtures/fake_assessment_server.py')
        report = dict(body='Continue: original source inspected.',recommendation='continue',
                      evidence_message_ids=[self.source],next_checkpoint='Verify deployment',
                      reply_passage=self.passage)
        (home/'fake-script.json').write_text(json.dumps({'signed_in':True,'report':report,
            'assessment_read_source':self.source,'assessment_source_body':'Build the requested artifact'}))
        with request_lock(self.profile,self.identity) as fd:
            rpc = Session(self.config,fd)
            try: result = drive(self.core,self.config,self.identity,rpc)
            finally: self.assertEqual(rpc.close(),0)
        self.assertEqual(result['body'],'> requested artifact\n\n'+report['body'])

    def test_completed_invalid_reports_end_once_instead_of_pinning_the_assignment(self):
        for evidence in [None,[self.source,'deadbeef'],[self.source,self.source],['docs/team-assessments.md']]:
            with self.subTest(evidence=evidence):
                self.identity=self.ok(self.request(op='bad-'+str(self.serial),assignment='Bad report '+str(self.serial)))['assessment_id']
                self.native=Native(self.source, self.passage)
                original=self.native.call
                def bad_report(method,params):
                    result=original(method,params)
                    if method=='thread/items/list':
                        report=json.loads(result['data'][0]['item']['text']); report['evidence_message_ids']=evidence
                        result['data'][0]['item']['text']=json.dumps(report) if evidence is not None else 'unparseable report'
                    return result
                self.native.call=bad_report
                try:
                    first=self.run_assessment()
                except DispatchError as error:
                    self.fail('Completed unusable report must reach a durable terminal state: '+str(error))
                self.assertEqual(first['status'],'abandoned',first)
                self.assertEqual(self.run_assessment(),first)
                self.assertEqual(self.count('turn/start'),1)
                record=self.core.record(self.identity)
                new=self.ok(self.request(op='retry-'+str(self.serial),assignment=record['assignment']))['assessment_id']
                self.assertNotEqual(new,self.identity)
                self.assertIsNone(self.core.record(new)['thread_id'])

    def test_native_settings_are_verified_before_attaching(self):
        for key,value in [('approvalPolicy','on-request'),('sandbox',{'type':'workspaceWrite'}),('cwd','/wrong')]:
            with self.subTest(key=key):
                self.identity=self.ok(self.request(op='settings-'+key,assignment='Settings '+key))['assessment_id']
                self.native=Native(self.source, self.passage); original=self.native.call
                def changed(method,params):
                    result=original(method,params)
                    if method=='thread/start': result[key]=value
                    return result
                self.native.call=changed
                with self.assertRaisesRegex(DispatchError,'settings_not_applied'): self.run_assessment()
                self.assertIsNone(self.core.record(self.identity)['thread_id'])
                self.assertEqual(self.count('turn/start'),0)

    def test_a_reached_outcome_is_never_dispatched_and_spends_nothing(self):
        # The request was made before the outcome was reached, then never started.
        test_assessments.AssessmentCase.reach_outcome(self)
        with self.assertRaisesRegex(DispatchError,'OUTCOME_REACHED'): self.run_assessment()
        self.assertEqual(self.native.calls,[])
        self.assertEqual(self.core.record(self.identity)['state'],'requested')
        # A request made after Reached is refused at Core, so there is nothing to dispatch.
        refused = self.request(op='after-reach',assignment='After reach')
        self.assertEqual((refused['status'],refused['error']['code']),('rejected','OUTCOME_REACHED'),refused)

    def test_an_attached_request_in_a_reached_outcome_starts_no_model_turn(self):
        self.native.fail = 'thread/resume'
        with self.assertRaises(DispatchError): self.run_assessment()
        thread = self.core.record(self.identity)['thread_id']
        test_assessments.AssessmentCase.reach_outcome(self)
        calls = list(self.native.calls)
        with self.assertRaisesRegex(DispatchError,'OUTCOME_REACHED'): self.run_assessment()
        self.assertEqual(self.native.calls,calls)
        self.assertEqual(self.count('turn/start'),0)
        record = self.core.record(self.identity)
        self.assertEqual((record['state'],record['thread_id']),('attached',thread))

    def test_an_outcome_reached_while_resuming_still_starts_no_model_turn(self):
        original = self.native.call
        def reach_during_resume(method, params):
            result = original(method, params)
            if method == 'thread/resume':
                test_assessments.AssessmentCase.reach_outcome(self)
            return result
        self.native.call = reach_during_resume
        with self.assertRaisesRegex(DispatchError,'OUTCOME_REACHED'): self.run_assessment()
        self.assertEqual(self.count('thread/resume'),1)
        self.assertEqual(self.count('turn/start'),0)
        self.assertEqual(self.core.record(self.identity)['state'],'attached')

    def test_an_archived_or_completed_outcome_is_never_dispatched_and_spends_nothing(self):
        # Item 404: kept to read as a reached outcome is; the request was made before the outcome was archived or completed.
        for state in ('archived','completed'):
            with self.subTest(state=state):
                test_assessments.AssessmentCase.end_outcome(self,state)
                with self.assertRaisesRegex(DispatchError,'OUTCOME_CLOSED'): self.run_assessment()
                self.assertEqual(self.native.calls,[])
                self.assertEqual(self.core.record(self.identity)['state'],'requested')
                test_assessments.AssessmentCase.end_outcome(self,'open')
        # Brought back, it runs.
        self.assertEqual(self.run_assessment()['status'],'reported')
        self.assertEqual(self.count('turn/start'),1)

    def test_an_attached_request_in_an_archived_outcome_starts_no_model_turn(self):
        self.native.fail = 'thread/resume'
        with self.assertRaises(DispatchError): self.run_assessment()
        thread = self.core.record(self.identity)['thread_id']
        test_assessments.AssessmentCase.end_outcome(self,'archived')
        calls = list(self.native.calls)
        with self.assertRaisesRegex(DispatchError,'OUTCOME_CLOSED'): self.run_assessment()
        self.assertEqual(self.native.calls,calls)
        self.assertEqual(self.count('turn/start'),0)
        record = self.core.record(self.identity)
        self.assertEqual((record['state'],record['thread_id']),('attached',thread))

    def test_an_outcome_completed_while_resuming_still_starts_no_model_turn(self):
        original = self.native.call
        def complete_during_resume(method, params):
            result = original(method, params)
            if method == 'thread/resume':
                test_assessments.AssessmentCase.end_outcome(self,'completed')
            return result
        self.native.call = complete_during_resume
        with self.assertRaisesRegex(DispatchError,'OUTCOME_CLOSED'): self.run_assessment()
        self.assertEqual(self.count('thread/resume'),1)
        self.assertEqual(self.count('turn/start'),0)
        self.assertEqual(self.core.record(self.identity)['state'],'attached')

from __future__ import annotations

import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

from aim_next.contract import Refusal
import test_assessments



class CheckpointCase(unittest.TestCase):
    command, workspace, sql = test_assessments.AssessmentCase.command, test_assessments.AssessmentCase.workspace, test_assessments.AssessmentCase.sql
    ok, request = test_assessments.AssessmentCase.ok, test_assessments.AssessmentCase.request

    def setUp(self):
        test_assessments.AssessmentCase.setUp(self)
        self.now = 2000000
        # Keep the pre-feature control able to reach Core's command refusal.
        if importlib.util.find_spec('aim_next.checkpoints') is not None:
            clock = mock.patch('aim_next.checkpoints._now_ms',side_effect=lambda:self.now)
            clock.start(); self.addCleanup(clock.stop)

    def create(self, actor='owner', **changes):
        args = dict(assessor_id='agent-b',team=['agent-a'],assignment='Deliver the named artifact',
            source_message_ids=[self.source],operator_id='owner',artifact='Working result',due_ms=self.now,miss_limit=2)
        args.update(changes)
        return self.command('checkpoint.create',args,{'topic_id':'t1'},actor=actor)

    def read(self, identity):
        return self.store.view('owner','checkpoint',{'checkpoint_id':identity})['checkpoint']

    def observe_args(self, identity, status='missed', **changes):
        record = self.read(identity)
        args = dict(observation_id='observation-'+str(record['version']),status=status,
            note='The linked source records the observed result.',evidence_message_ids=[self.source],
            wait_kind='tool' if status == 'waiting' else 'none',fault_key=None,
            next_artifact='Next demonstrated artifact',next_due_ms=self.now+100)
        args.update(changes)
        return args, {'checkpoint_revision':record['version']}

    def observe(self, identity, status='missed', actor='owner', **changes):
        args, expected = self.observe_args(identity,status,**changes)
        return self.command('checkpoint.observe',args,{'checkpoint_id':identity},expected,actor=actor)

    def assert_refused(self, receipt, code):
        self.assertEqual(receipt['status'],'rejected',receipt)
        self.assertEqual(receipt['error']['code'],code,receipt)

    def test_policy_is_explicit_authorized_and_coalesces_concurrent_creates(self):
        self.ok(self.command('message.post',{'body':'Assess after two misses: this is just discussion.'},{'topic_id':'t1'}))
        listed=self.store.view('owner','checkpoints',{})
        self.assertIn('items',listed)
        self.assertEqual(listed['items'],[])
        self.assert_refused(self.create(actor='agent-b'),'FORBIDDEN')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _:self.create(),range(2)))
        identity = self.ok(receipts[0])['checkpoint_id']
        self.assertEqual(self.ok(receipts[1])['checkpoint_id'],identity)
        self.assert_refused(self.create(miss_limit=3),'CHECKPOINT_ALREADY_ACTIVE')
        self.assertEqual(self.store.view('agent-a','checkpoints',{})['items'],[])
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'],[])

    def test_known_waits_and_unknowns_are_not_misses_and_success_resets_count(self):
        identity = self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity))
        for status in ('waiting','unknown'):
            self.now += 100
            self.ok(self.observe(identity,status))
            self.assertEqual(self.read(identity)['consecutive_misses'],1)
            self.assertIsNone(self.read(identity)['assessment_id'])
        self.assert_refused(self.observe(identity,wait_kind='human'),'INVALID_ARGUMENT')
        self.now += 100
        self.ok(self.observe(identity,'met'))
        self.assertEqual(self.read(identity)['consecutive_misses'],0)
        self.now += 100
        self.ok(self.observe(identity))
        self.assertEqual(self.read(identity)['consecutive_misses'],1)
        self.assertIsNone(self.read(identity)['assessment_id'])

    def test_one_atomic_assessment_at_threshold_and_identical_observation_retry(self):
        identity = self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity))
        self.now += 100
        args, expected = self.observe_args(identity)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _:self.command('checkpoint.observe',args,{'checkpoint_id':identity},expected),range(2)))
        first, second = map(self.ok,receipts)
        self.assertEqual(first,second)
        self.assertTrue(first['assessment_id'])
        record = self.read(identity)
        self.assertEqual(record['state'],'assessment-requested')
        self.assertEqual(record['observation_count'],2)
        self.assertEqual(len(self.store.view('owner','assessments',{'topic_id':'t1'})['items']),1)
        assessment=self.store.view('owner','assessment',{'assessment_id':first['assessment_id']})['assessment']
        self.assertEqual(assessment['checkpoint']['observation']['expected_artifact'],'Next demonstrated artifact')
        self.assertEqual(assessment['checkpoint']['observation']['consecutive_misses'],2)
        self.assert_refused(self.create(),'CHECKPOINT_RENEWAL_REQUIRED')
        self.assertEqual(self.store.view('owner','checkpoints_due',{})['items'],[])
        changed=dict(args,note='Changed claim')
        self.assert_refused(self.command('checkpoint.observe',changed,{'checkpoint_id':identity},expected),'CHECKPOINT_OBSERVATION_MISMATCH')
        self.assert_refused(self.observe(identity,'met'),'CHECKPOINT_CLOSED')
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"),[(0,)])

    def test_fault_recurrence_survives_a_met_checkpoint(self):
        identity = self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity,fault_key='lost-writing'))
        self.now += 100; self.ok(self.observe(identity,'met'))
        self.now += 100
        result=self.ok(self.observe(identity,fault_key='lost-writing'))
        self.assertTrue(result['assessment_id'])
        self.assertEqual(self.read(identity)['consecutive_misses'],1)
        self.assertEqual(self.read(identity)['last_observation']['fault_recurrences'],2)

    def test_existing_manual_assessment_is_reused_without_a_second_request(self):
        identity = self.ok(self.create())['checkpoint_id']
        assessment=self.ok(self.request(assignment='Deliver the named artifact'))['assessment_id']
        self.ok(self.observe(identity)); self.now += 100
        result=self.ok(self.observe(identity))
        self.assertEqual(result['assessment_id'],assessment)
        self.assertEqual(len(self.store.view('owner','assessments',{'topic_id':'t1'})['items']),1)

    def test_failed_checkpoint_save_rolls_back_assessment_and_counter(self):
        identity = self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity,fault_key='fault')); self.now += 100
        with mock.patch.object(self.store,'_save_checkpoint',side_effect=Refusal('TEST_ROLLBACK','after assessment request')):
            self.assert_refused(self.observe(identity,fault_key='fault'),'TEST_ROLLBACK')
        self.assertEqual(self.read(identity)['consecutive_misses'],1)
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'],[])
        self.assertTrue(self.ok(self.observe(identity,fault_key='fault'))['assessment_id'])
        self.assertEqual(self.read(identity)['last_observation']['fault_recurrences'],2)

    def test_future_due_and_stale_observations_cannot_invent_misses(self):
        identity=self.ok(self.create(due_ms=self.now+100))['checkpoint_id']
        self.assert_refused(self.observe(identity),'CHECKPOINT_NOT_DUE')
        args, expected=self.observe_args(identity,'met')
        self.ok(self.observe(identity,'waiting'))
        args['observation_id']='late-observer'
        self.assert_refused(self.command('checkpoint.observe',args,{'checkpoint_id':identity},expected),'CHECKPOINT_CHANGED')
        self.assert_refused(self.observe(identity,'met',actor='agent-b'),'FORBIDDEN')

    def test_private_and_wrong_topic_evidence_is_never_copied_to_records(self):
        private=self.ok(self.command('message.post',{'body':'Private evidence','whisper':True,'addressees':['agent-b']},{'topic_id':'t1'}))['message_id']
        self.assert_refused(self.create(source_message_ids=[private]),'ASSESSMENT_PRIVATE_SOURCE')
        identity=self.ok(self.create())['checkpoint_id']
        self.assert_refused(self.observe(identity,evidence_message_ids=[private]),'ASSESSMENT_PRIVATE_SOURCE')
        conversation=self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        foreign=self.ok(self.command('message.post',{'body':'Different scope'},{'topic_id':conversation}))['message_id']
        self.assert_refused(self.observe(identity,evidence_message_ids=[foreign]),'ASSESSMENT_SOURCE_SCOPE')
        self.assertEqual(self.read(identity)['observation_count'],0)

    def test_due_pages_prompt_once_and_close_preserves_history_without_assessment(self):
        ids=[self.ok(self.create(assignment='Artifact '+str(i),due_ms=self.now+i))['checkpoint_id'] for i in range(4)]
        self.now += 2
        first=self.store.view('owner','checkpoints_due',{'limit':2})
        second=self.store.view('owner','checkpoints_due',{'limit':2,'cursor':first['next_cursor']})
        self.assertEqual([r['id'] for r in first['items']+second['items']],ids[:3])
        self.assertIsNone(second['next_cursor'])
        future=self.store.view('owner','checkpoints_due',{'before_ms':self.now+1})
        self.assertIn('error',future)
        self.assertEqual(future['error']['code'],'INVALID_ARGUMENT')
        identity=ids[0]
        def prompt():return self.command('checkpoint.prompt',{},{'checkpoint_id':identity})
        report=self.ok(prompt())['message_id']
        self.assertEqual(self.ok(prompt())['message_id'],report)
        self.assertEqual(self.read(identity)['version'],1)
        self.assertEqual(self.read(identity)['consecutive_misses'],0)
        self.assertIn('not a missed commitment',self.sql('SELECT body FROM messages WHERE id=?',(report,))[0][0])
        self.ok(self.observe(identity,'waiting'))
        self.assertEqual(self.store.view('owner','checkpoint_observations',{'checkpoint_id':identity})['items'][0]['wait_kind'],'tool')
        self.ok(self.command('checkpoint.close',{'reason':'Assignment completed by another authorized route'},
                            {'checkpoint_id':identity},{'checkpoint_revision':2}))
        self.assertEqual(self.read(identity)['state'],'closed')
        self.assertNotIn(identity,[r['id'] for r in self.store.view('owner','checkpoints_due',{})['items']])
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'],[])
        self.assertEqual(len(self.store.view('owner','checkpoint_observations',{'checkpoint_id':identity})['items']),1)

    def test_history_is_paged_and_restart_uses_durable_observation_identity(self):
        identity=self.ok(self.create())['checkpoint_id']
        saved=None
        for _ in range(3):
            args, expected=self.observe_args(identity,'waiting')
            saved=(args,expected,self.ok(self.command('checkpoint.observe',args,{'checkpoint_id':identity},expected)))
            self.now += 100
        first=self.store.view('owner','checkpoint_observations',{'checkpoint_id':identity,'limit':2})
        second=self.store.view('owner','checkpoint_observations',{'checkpoint_id':identity,'limit':2,'cursor':first['next_cursor']})
        self.assertEqual([r['seq'] for r in first['items']+second['items']],[1,2,3])
        from aim_next.store import Store
        self.store=Store(self.path,'test-instance',expected_binding=self.binding)
        args,expected,result=saved
        self.assertEqual(self.ok(self.command('checkpoint.observe',args,{'checkpoint_id':identity},expected)),result)
        self.assertEqual(self.read(identity)['observation_count'],3)

    def test_prompt_transaction_rolls_back_and_next_revision_can_prompt_again(self):
        identity=self.ok(self.create())['checkpoint_id']
        post=self.store._publish
        def failed_post(*args,**kwargs):
            post(*args,**kwargs)
            raise Refusal('TEST_ROLLBACK','After reminder post')
        count=self.sql('SELECT count(*) FROM messages')[0][0]
        with mock.patch.object(self.store,'_publish',side_effect=failed_post):
            self.assert_refused(self.command('checkpoint.prompt',{},{'checkpoint_id':identity}),'TEST_ROLLBACK')
        self.assertEqual(self.sql('SELECT count(*) FROM messages')[0][0],count)
        first=self.ok(self.command('checkpoint.prompt',{},{'checkpoint_id':identity}))['message_id']
        self.ok(self.observe(identity,'waiting')); self.now+=100
        second=self.ok(self.command('checkpoint.prompt',{},{'checkpoint_id':identity}))['message_id']
        self.assertNotEqual(first,second)
        self.assertEqual(self.read(identity)['consecutive_misses'],0)

    def test_result_boundary_needs_report_and_operator_renewal_before_new_policy(self):
        import uuid
        identity=self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity)); self.now+=100
        assessment=self.ok(self.observe(identity))['assessment_id']
        thread=str(uuid.uuid4())
        self.ok(self.command('assessment.attach',dict(thread_id=thread,runtime_digest='a'*64),{'assessment_id':assessment},actor='agent-b'))
        self.ok(self.command('assessment.finish',dict(thread_id=thread,body='Remove the tool blocker.',
            recommendation='remove-blocker',evidence_message_ids=[self.source],next_checkpoint='First deployed artifact'),
            {'assessment_id':assessment},actor='agent-b'))
        self.assert_refused(self.create(),'CHECKPOINT_RENEWAL_REQUIRED')
        self.ok(self.command('assessment.renew',dict(decision='retain',reason='Evidence supports this owner.',
            next_checkpoint='First deployed artifact'),{'assessment_id':assessment}))
        new=self.ok(self.create())['checkpoint_id']
        self.assertNotEqual(new,identity)
        self.assertEqual(self.read(new)['consecutive_misses'],0)

    def test_abandoned_assessment_does_not_pin_a_finished_series(self):
        identity=self.ok(self.create())['checkpoint_id']
        self.ok(self.observe(identity)); self.now+=100
        assessment=self.ok(self.observe(identity))['assessment_id']
        self.ok(self.command('assessment.abandon',{'reason':'No usable completed report'},
                            {'assessment_id':assessment},actor='agent-b'))
        new=self.ok(self.create())['checkpoint_id']
        self.assertNotEqual(new,identity)
        self.assertEqual(self.read(new)['state'],'open')

    def test_checkpoint_changes_preserve_feed_work_and_reader_state(self):
        source=self.ok(self.command('message.post',{'body':'Named artifact evidence'},
                                   {'topic_id':'t1'},actor='agent-a'))['message_id']
        scope={'kind':'topic','id':'t1'}
        baseline=self.store.view('owner','changes',{'scope':scope})['checkpoint']
        identity=self.ok(self.create(source_message_ids=[source]))['checkpoint_id']
        self.ok(self.observe(identity,'waiting')); self.now+=100
        topic=self.store.view('owner','topic',{'topic_id':'t1'})['topic']
        self.ok(self.command('topic.update',{'state':'done','note':'Finished artifact'},
                            {'topic_id':'t1'},{'topic_revision':topic['version']}))
        before=self.store.view('owner','topic_messages',{'topic_id':'t1'})['items']
        delivery_before=self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id='owner'",(source,))
        self.assertEqual(delivery_before,[('pending',)])
        report=self.ok(self.command('checkpoint.prompt',{},{'checkpoint_id':identity}))['message_id']
        after=self.store.view('owner','topic_messages',{'topic_id':'t1'})['items']
        self.assertEqual(next(m['acts'] for m in before if m['id']==source),next(m['acts'] for m in after if m['id']==source))
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id='owner'",(source,)),delivery_before)
        self.assertEqual(self.store.view('owner','topic',{'topic_id':'t1'})['topic']['state'],'done')
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? AND state='pending'",(report,)),[])
        self.ok(self.command('checkpoint.close',{'reason':'Finished'},{'checkpoint_id':identity},{'checkpoint_revision':2}))
        page=self.store.view('owner','changes',{'scope':scope,'cursor':baseline})
        bootstrap=dict(instance_id='test-instance',actor='owner',authority=self.pin)
        result=subprocess.run(['node','tests/assessment_freshness_probe.mjs'],input=json.dumps(dict(bootstrap=bootstrap,baseline=baseline,page=page)),
                              capture_output=True,text=True,cwd=str(Path(__file__).resolve().parents[1]))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        observed=json.loads(result.stdout)
        self.assertFalse(observed['stopped'],observed)
        self.assertIn('topic:t1',observed['painted'],observed)

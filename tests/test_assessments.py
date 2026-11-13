from __future__ import annotations

import unittest
import uuid
import concurrent.futures
from unittest import mock

from aim_next.contract import Refusal

import test_store


class AssessmentCase(unittest.TestCase):
    command, workspace, sql = test_store.StoreCase.command, test_store.StoreCase.workspace, test_store.StoreCase.sql

    def setUp(self):
        test_store.StoreCase.setUp(self)
        self.workspace()
        self.ok(self.command('opening.save', {'workspace_id':'w1', 'topic_id':'t1',
            'title':'A named assignment', 'participants':['agent-a','agent-b'],
            'body':'Build the requested artifact', 'attachments':[]},
            {'opening_id':'opening'}, {'opening_revision':0}))
        result = self.ok(self.command('opening.publish', {}, {'opening_id':'opening'}, {'opening_revision':1}))
        self.source = result['message_id']

    def ok(self, receipt):
        self.assertEqual(receipt['status'], 'committed', receipt)
        return receipt['result']

    def request(self, op='request', actor='owner', **changes):
        args = dict(assessor_id='agent-b', team=['agent-a'], assignment='Verify the actual artifact',
                    source_message_ids=[self.source], operator_id='owner')
        args.update(changes)
        return self.command('assessment.request', args, {'topic_id':'t1'}, actor=actor, op=op)

    def read(self, identity, actor='owner'):
        return self.store.view(actor, 'assessment', {'assessment_id':identity})

    def attach(self, identity, thread=None, actor='agent-b'):
        return self.command('assessment.attach', {'thread_id':thread or str(uuid.uuid4()), 'runtime_digest':'a'*64},
                            {'assessment_id':identity}, actor=actor)

    def test_request_is_explicit_deduplicated_and_requires_organizer(self):
        self.ok(self.command('message.post', {'body':'Please assess agent-a. This is only quoted discussion.'}, {'topic_id':'t1'}))
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'], [])
        denied = self.request(actor='agent-b')
        self.assertEqual(denied['status'],'rejected',denied)
        self.assertEqual(denied['error']['code'], 'FORBIDDEN')
        first = self.request()
        self.assertEqual(self.request(), first)
        identity = self.ok(first)['assessment_id']
        self.assertEqual(self.ok(self.request(op='independent-retry'))['assessment_id'], identity)
        self.assertEqual(self.read(identity)['assessment']['state'], 'requested')
        changed = self.request(assignment='Different assignment')
        self.assertEqual(changed['error']['code'], 'OPERATION_PAYLOAD_MISMATCH')
        self.assertEqual(len(self.store.view('agent-b','assessments',{})['items']),1)
        self.assertEqual(self.store.view('agent-a','assessments',{})['items'], [])

    def test_fresh_assessor_cannot_be_target_or_use_private_source(self):
        self.assertEqual(self.request(team=['agent-b'])['error']['code'], 'INVALID_ARGUMENT')
        private = self.ok(self.command('message.post', {'body':'Private evidence', 'whisper':True,
            'addressees':['agent-b']}, {'topic_id':'t1'}))['message_id']
        refused = self.request(op='private',source_message_ids=[private])
        self.assertEqual(refused['status'],'rejected',refused)
        self.assertEqual(refused['error']['code'], 'ASSESSMENT_PRIVATE_SOURCE')
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'], [])

    def test_concurrent_requests_for_one_assignment_create_one_context_request(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda op:self.request(op=op),['concurrent-a','concurrent-b']))
        self.assertEqual(self.ok(results[0])['assessment_id'],self.ok(results[1])['assessment_id'])
        self.assertEqual(len(self.store.view('owner','assessments',{'topic_id':'t1'})['items']),1)

    def test_binding_a_fresh_thread_is_write_once_and_cannot_reuse_another_request(self):
        identity = self.ok(self.request())['assessment_id']
        thread = str(uuid.uuid4())
        self.assertEqual(self.attach(identity,thread,actor='agent-a')['error']['code'], 'FORBIDDEN')
        self.ok(self.attach(identity,thread))
        self.ok(self.attach(identity,thread))
        self.assertEqual(self.attach(identity)['error']['code'], 'ASSESSMENT_THREAD_MISMATCH')
        other = self.ok(self.request(op='other', assignment='Another artifact'))['assessment_id']
        self.assertEqual(self.attach(other,thread)['error']['code'], 'ASSESSMENT_THREAD_REUSED')
        self.assertEqual(self.read(identity)['assessment']['thread_id'],thread)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"),[(0,)])

    def test_report_and_completion_commit_once_in_original_topic(self):
        identity = self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4())
        args=dict(thread_id=thread, body='Continue: the artifact meets its target.', recommendation='continue',
                  evidence_message_ids=[self.source], next_checkpoint='Verify the deployed artifact')
        finish=lambda: self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish')
        self.assertEqual(finish()['error']['code'],'ASSESSMENT_NOT_ATTACHED')
        self.ok(self.attach(identity,thread))
        wrong = dict(args,thread_id=str(uuid.uuid4()))
        self.assertEqual(self.command('assessment.finish',wrong,{'assessment_id':identity},actor='agent-b')['error']['code'],'ASSESSMENT_THREAD_MISMATCH')
        self.assertEqual(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-a')['error']['code'],'FORBIDDEN')
        # A refused operation has its own durable identity; the corrected act is new.
        first=self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish-attached')
        report=self.ok(first)['message_id']
        self.assertEqual(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish-attached'),first)
        self.assertEqual(self.ok(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b'))['message_id'],report)
        row=self.sql('SELECT topic_id,author_id,body FROM messages WHERE id=?',(report,))[0]
        self.assertEqual(row,('t1','agent-b',args['body']))
        self.assertEqual(self.read(identity)['assessment']['report_message_id'],report)
        changed=dict(args,body='A different report')
        self.assertEqual(self.command('assessment.finish',changed,{'assessment_id':identity},actor='agent-b')['error']['code'],'ASSESSMENT_REPORT_MISMATCH')
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',('agent-b',)),[(1,)])

    def test_failed_completion_rolls_back_its_post_and_standing_context_is_refused(self):
        identity = self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4())
        self.sql('INSERT INTO metadata(key,value) VALUES (?,?)',('route_pin.v1:test',
                 '{"destination":{"thread_id":"'+thread+'"}}'))
        self.assertEqual(self.attach(identity,thread)['error']['code'],'ASSESSMENT_THREAD_REUSED')
        thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        args=dict(thread_id=thread,body='Continue.',recommendation='continue',
                  evidence_message_ids=[self.source],next_checkpoint='Verify deployment')
        with mock.patch.object(self.store,'_save_assessment',side_effect=Refusal('TEST_FAILURE','After post')):
            result=self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b')
        self.assertEqual(result['error']['code'],'TEST_FAILURE')
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',('agent-b',)),[(0,)])
        self.assertEqual(self.read(identity)['assessment']['state'],'attached')

    def test_conversation_is_refused_without_settling_someone_elses_item(self):
        conversation=self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        source=self.ok(self.command('message.post',{'body':'Please build the artifact.'},{'topic_id':conversation}))['message_id']
        result=self.command('assessment.request',dict(assessor_id='agent-b',team=['agent-a'],assignment='Inspect',
            source_message_ids=[source],operator_id='owner'),{'topic_id':conversation})
        self.assertEqual(result['error']['code'],'ASSESSMENT_TOPIC_REQUIRED')

    def test_scoped_pagination_and_operator_renewal_do_not_change_team(self):
        ids=[self.ok(self.request(op='request-'+str(i),assignment='Artifact '+str(i)))['assessment_id'] for i in range(3)]
        first=self.store.view('agent-b','assessments',{'limit':2})
        second=self.store.view('agent-b','assessments',{'limit':2,'cursor':first['next_cursor']})
        self.assertEqual(sorted(x['id'] for x in first['items']+second['items']),sorted(ids))
        self.assertIsNone(second['next_cursor'])
        identity=ids[0]; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        self.ok(self.command('assessment.finish',dict(thread_id=thread,body='Remove the queue blocker.',
            recommendation='remove-blocker',evidence_message_ids=[self.source],next_checkpoint='After queue access'),
            {'assessment_id':identity},actor='agent-b'))
        team=self.sql('SELECT * FROM workspace_members ORDER BY actor_id')
        decision=dict(decision='retain',reason='The external queue explains the wait.',next_checkpoint='First deployed artifact')
        self.assertEqual(self.command('assessment.renew',decision,{'assessment_id':identity},actor='agent-b')['error']['code'],'FORBIDDEN')
        self.ok(self.command('assessment.renew',decision,{'assessment_id':identity}))
        self.assertEqual(self.read(identity)['assessment']['renewal']['decision'],'retain')
        self.assertEqual(self.sql('SELECT * FROM workspace_members ORDER BY actor_id'),team)

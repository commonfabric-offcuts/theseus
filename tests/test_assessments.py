from __future__ import annotations

import unittest
import json
import subprocess
from pathlib import Path
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

    def refused(self, receipt, code):
        self.assertEqual(receipt.get('status'), 'rejected', receipt)
        self.assertEqual(receipt['error']['code'], code, receipt)

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
        self.refused(denied, 'FORBIDDEN')
        first = self.request()
        self.assertEqual(self.request(), first)
        identity = self.ok(first)['assessment_id']
        self.assertEqual(self.ok(self.request(op='independent-retry'))['assessment_id'], identity)
        self.assertEqual(self.read(identity)['assessment']['state'], 'requested')
        changed = self.request(assignment='Different assignment')
        self.refused(changed, 'OPERATION_PAYLOAD_MISMATCH')
        self.assertEqual(len(self.store.view('agent-b','assessments',{})['items']),1)
        self.assertEqual(self.store.view('agent-a','assessments',{})['items'], [])

    def test_fresh_assessor_cannot_be_target_or_use_private_source(self):
        self.refused(self.request(team=['agent-b']), 'INVALID_ARGUMENT')
        private = self.ok(self.command('message.post', {'body':'Private evidence', 'whisper':True,
            'addressees':['agent-b']}, {'topic_id':'t1'}))['message_id']
        refused = self.request(op='private',source_message_ids=[private])
        self.assertEqual(refused['status'],'rejected',refused)
        self.refused(refused, 'ASSESSMENT_PRIVATE_SOURCE')
        self.assertEqual(self.store.view('owner','assessments',{'topic_id':'t1'})['items'], [])

    def test_concurrent_requests_for_one_assignment_create_one_context_request(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda op:self.request(op=op),['concurrent-a','concurrent-b']))
        self.assertEqual(self.ok(results[0])['assessment_id'],self.ok(results[1])['assessment_id'])
        self.assertEqual(len(self.store.view('owner','assessments',{'topic_id':'t1'})['items']),1)

    def test_binding_a_fresh_thread_is_write_once_and_cannot_reuse_another_request(self):
        identity = self.ok(self.request())['assessment_id']
        thread = str(uuid.uuid4())
        self.refused(self.attach(identity,thread,actor='agent-a'), 'FORBIDDEN')
        self.ok(self.attach(identity,thread))
        self.ok(self.attach(identity,thread))
        self.refused(self.attach(identity), 'ASSESSMENT_THREAD_MISMATCH')
        other = self.ok(self.request(op='other', assignment='Another artifact'))['assessment_id']
        self.refused(self.attach(other,thread), 'ASSESSMENT_THREAD_REUSED')
        self.assertEqual(self.read(identity)['assessment']['thread_id'],thread)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key LIKE 'route_pin.v1:%'"),[(0,)])

    def test_report_and_completion_commit_once_in_original_topic(self):
        identity = self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4())
        args=dict(thread_id=thread, body='Continue: the artifact meets its target.', recommendation='continue',
                  evidence_message_ids=[self.source], next_checkpoint='Verify the deployed artifact')
        finish=lambda: self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish')
        self.refused(finish(), 'ASSESSMENT_NOT_ATTACHED')
        self.ok(self.attach(identity,thread))
        wrong = dict(args,thread_id=str(uuid.uuid4()))
        self.refused(self.command('assessment.finish',wrong,{'assessment_id':identity},actor='agent-b'), 'ASSESSMENT_THREAD_MISMATCH')
        self.refused(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-a'), 'FORBIDDEN')
        # A refused operation has its own durable identity; the corrected act is new.
        first=self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish-attached')
        report=self.ok(first)['message_id']
        self.assertEqual(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b',op='finish-attached'),first)
        self.assertEqual(self.ok(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b'))['message_id'],report)
        row=self.sql('SELECT topic_id,author_id,body FROM messages WHERE id=?',(report,))[0]
        self.assertEqual(row,('t1','agent-b',args['body']))
        self.assertEqual(self.read(identity)['assessment']['report_message_id'],report)
        changed=dict(args,body='A different report')
        self.refused(self.command('assessment.finish',changed,{'assessment_id':identity},actor='agent-b'), 'ASSESSMENT_REPORT_MISMATCH')
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',('agent-b',)),[(1,)])

    def test_failed_completion_rolls_back_its_post_and_standing_context_is_refused(self):
        identity = self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4())
        self.sql('INSERT INTO metadata(key,value) VALUES (?,?)',('route_pin.v1:test',
                 '{"destination":{"thread_id":"'+thread+'"}}'))
        self.refused(self.attach(identity,thread), 'ASSESSMENT_THREAD_REUSED')
        thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        args=dict(thread_id=thread,body='Continue.',recommendation='continue',
                  evidence_message_ids=[self.source],next_checkpoint='Verify deployment')
        with mock.patch.object(self.store,'_save_assessment',side_effect=Refusal('TEST_FAILURE','After post')):
            result=self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b')
        self.refused(result, 'TEST_FAILURE')
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE author_id=?',('agent-b',)),[(0,)])
        self.assertEqual(self.read(identity)['assessment']['state'],'attached')

    def test_conversation_is_refused_without_settling_someone_elses_item(self):
        conversation=self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        source=self.ok(self.command('message.post',{'body':'Please build the artifact.'},{'topic_id':conversation}))['message_id']
        result=self.command('assessment.request',dict(assessor_id='agent-b',team=['agent-a'],assignment='Inspect',
            source_message_ids=[source],operator_id='owner'),{'topic_id':conversation})
        self.refused(result, 'ASSESSMENT_TOPIC_REQUIRED')

    def test_missing_access_report_can_record_no_message_citations(self):
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4())
        self.ok(self.attach(identity,thread))
        args=dict(thread_id=thread,body='Artifact exists; source access was unavailable. No source messages read.',
                  recommendation='remove-blocker',evidence_message_ids=[],next_checkpoint='Restore source access')
        result=self.ok(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b'))
        self.assertEqual(self.read(identity)['assessment']['evidence_message_ids'],[])
        self.assertEqual(self.sql('SELECT body FROM messages WHERE id=?',(result['message_id'],)),[(args['body'],)])

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
        self.refused(self.command('assessment.renew',decision,{'assessment_id':identity},actor='agent-b'), 'FORBIDDEN')
        self.ok(self.command('assessment.renew',decision,{'assessment_id':identity}))
        self.assertEqual(self.read(identity)['assessment']['renewal']['decision'],'retain')
        self.assertEqual(self.sql('SELECT * FROM workspace_members ORDER BY actor_id'),team)

    def test_request_scope_and_policy_changes_are_refused(self):
        self.refused(self.request(op='bad-operator',operator_id='agent-b'), 'FORBIDDEN')
        conversation=self.sql("SELECT id FROM topics WHERE kind='conversation'")[0][0]
        other=self.ok(self.command('message.post',{'body':'Other topic'},{'topic_id':conversation}))['message_id']
        self.refused(self.request(op='other-source',source_message_ids=[other]),'ASSESSMENT_SOURCE_SCOPE')
        self.ok(self.request())
        changed_source=self.ok(self.command('message.post',{'body':'New evidence'},{'topic_id':'t1'}))['message_id']
        for change in [dict(operator_id='agent-a'),dict(source_message_ids=[changed_source])]:
            self.refused(self.request(op='changed-'+str(self.serial),**change),'ASSESSMENT_ALREADY_ACTIVE')
        # Changing a valid assessor while retaining the same team.
        self.sql("INSERT INTO actors(id,name,kind,enabled) VALUES ('agent-c','Agent C','agent',1)")
        self.sql("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1','agent-c')")
        self.refused(self.request(op='changed-assessor',assessor_id='agent-c'),'ASSESSMENT_ALREADY_ACTIVE')
        self.sql("DELETE FROM workspace_members WHERE actor_id='agent-c'")
        self.refused(self.request(op='nonmember',assignment='Another',assessor_id='agent-c'),'FORBIDDEN')

    def test_finish_validates_evidence_and_renew_requires_report(self):
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        decision=dict(decision='retain',reason='Keep going',next_checkpoint='Artifact')
        self.refused(self.command('assessment.renew',decision,{'assessment_id':identity}),'ASSESSMENT_NOT_REPORTED')
        other_topic=self.sql("SELECT id FROM topics WHERE kind='conversation'")[0][0]
        other=self.ok(self.command('message.post',{'body':'Other topic'},{'topic_id':other_topic}))['message_id']
        private=self.ok(self.command('message.post',{'body':'Private','whisper':True,'addressees':['agent-b']},{'topic_id':'t1'}))['message_id']
        for evidence,code in [([other],'ASSESSMENT_SOURCE_SCOPE'),([private],'ASSESSMENT_PRIVATE_SOURCE'),
                              ([self.source,self.source],'INVALID_ARGUMENT'),(['not-a-message'],'FORBIDDEN')]:
            args=dict(thread_id=thread,body='Report',recommendation='continue',evidence_message_ids=evidence,next_checkpoint='Artifact')
            self.refused(self.command('assessment.finish',args,{'assessment_id':identity},actor='agent-b'),code)
        self.assertEqual(self.read(identity)['assessment']['state'],'attached')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id='agent-b'"),[(0,)])

    def test_assessment_changes_keep_real_topic_feed_running(self):
        scope={'kind':'topic','id':'t1'}
        baseline=self.store.view('owner','changes',{'scope':scope})['checkpoint']
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        self.ok(self.command('assessment.finish',dict(thread_id=thread,body='Report',recommendation='continue',
            evidence_message_ids=[self.source],next_checkpoint='Artifact'),{'assessment_id':identity},actor='agent-b'))
        self.ok(self.command('assessment.renew',dict(decision='retain',reason='Good',next_checkpoint='Artifact'),{'assessment_id':identity}))
        page=self.store.view('owner','changes',{'scope':scope,'cursor':baseline})
        bootstrap=dict(instance_id='test-instance',actor='owner',authority=self.pin)
        result=subprocess.run(['node','tests/assessment_freshness_probe.mjs'],input=json.dumps(dict(bootstrap=bootstrap,baseline=baseline,page=page)),
                              capture_output=True,text=True,cwd=str(Path(__file__).resolve().parents[1]))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        observed=json.loads(result.stdout)
        self.assertFalse(observed['stopped'],observed)
        self.assertIn('topic:t1',observed['painted'],observed)

    def test_report_preserves_done_state_and_only_notifies_requester_operator(self):
        # agent-b assesses agent-a; only the owner is responsible for the report.
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        topic=self.store.view('owner','topic',{'topic_id':'t1'})['topic']
        self.ok(self.command('topic.update',{'state':'done','note':'Finished'},{'topic_id':'t1'},
                            {'topic_revision':topic['version']}))
        before=self.sql('SELECT state,state_note,state_by,state_ms,state_message_id,activity_ms FROM topics WHERE id=?',('t1',))
        report=self.ok(self.command('assessment.finish',dict(thread_id=thread,body='Report',recommendation='continue',
            evidence_message_ids=[self.source],next_checkpoint='Artifact'),{'assessment_id':identity},actor='agent-b'))['message_id']
        self.assertEqual(self.sql('SELECT state,state_note,state_by,state_ms,state_message_id,activity_ms FROM topics WHERE id=?',('t1',)),before)
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? AND state='pending' ORDER BY recipient_id",(report,)),[('owner',)])
        self.assertEqual(self.store.view('agent-a','source',{'source_ref':{'kind':'message','id':report}})['body'],'Report')
        self.refused(self.command('assessment.abandon',{'reason':'Too late'},{'assessment_id':identity}), 'ASSESSMENT_ALREADY_REPORTED')

    def test_report_does_not_answer_a_wait_on_the_assessor(self):
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        topic=self.store.view('owner','topic',{'topic_id':'t1'})['topic']
        self.ok(self.command('topic.update',{'state':'waiting','note':'Need the separate artifact','waiting_on':['agent-b']},
            {'topic_id':'t1'},{'topic_revision':topic['version']}))
        before=self.sql('SELECT * FROM topic_waiting WHERE topic_id=?',('t1',))
        self.ok(self.command('assessment.finish',dict(thread_id=thread,body='Report',recommendation='continue',
            evidence_message_ids=[self.source],next_checkpoint='Artifact'),{'assessment_id':identity},actor='agent-b'))
        self.assertEqual(self.sql('SELECT * FROM topic_waiting WHERE topic_id=?',('t1',)),before)
        self.assertEqual(self.store.view('owner','topic',{'topic_id':'t1'})['topic']['state'],'waiting')

    def test_abandon_is_terminal_authorized_and_allows_a_fresh_request(self):
        identity=self.ok(self.request())['assessment_id']; thread=str(uuid.uuid4()); self.ok(self.attach(identity,thread))
        self.refused(self.command('assessment.abandon',{'reason':'No usable report'},{'assessment_id':identity},actor='agent-a'),'FORBIDDEN')
        self.ok(self.command('assessment.abandon',{'reason':'No usable report'},{'assessment_id':identity},actor='agent-b'))
        self.ok(self.command('assessment.abandon',{'reason':'No usable report'},{'assessment_id':identity},actor='agent-b'))
        self.refused(self.command('assessment.abandon',{'reason':'Different reason'},{'assessment_id':identity}), 'ASSESSMENT_ABANDONMENT_MISMATCH')
        self.assertEqual(self.read(identity)['assessment']['state'],'abandoned')
        self.refused(self.attach(identity,thread),'ASSESSMENT_ABANDONED')
        self.refused(self.command('assessment.finish',dict(thread_id=thread,body='Late report',recommendation='continue',
            evidence_message_ids=[],next_checkpoint='Artifact'),{'assessment_id':identity},actor='agent-b'),'ASSESSMENT_ABANDONED')
        new=self.ok(self.request(op='fresh'))['assessment_id']; self.assertNotEqual(new,identity)
        self.refused(self.attach(new,thread),'ASSESSMENT_THREAD_REUSED')
        self.ok(self.command('assessment.abandon',{'reason':'Operator ended it'},{'assessment_id':new}))
        self.assertEqual(self.read(new)['assessment']['state'],'abandoned')

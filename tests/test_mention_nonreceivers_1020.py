from __future__ import annotations

import sqlite3
import test_at_names


class MentionReach1020(test_at_names.AtNamesCase):
    def reach(self, message, actor='owner', **args):
        operation = self.sql('SELECT operation_id FROM messages WHERE id=?', (message,))[0][0]
        submission = self.sql('SELECT id FROM submissions WHERE actor_id=? AND send_operation_id=?', ('owner', operation))[0][0]
        return self.store.view(actor, 'submission_mention_reach', dict(submission_id=submission, **args))

    def test_sent_words_and_routing_stay_exact_and_only_nonmember_is_named(self):
        body = 'Hello @outsider, @agent-a and @agent-b. owner@example.com @owner @missing'
        message = self.topic_message(body)
        answer = self.reach(message)
        self.assertNotIn('error', answer, answer)
        self.assertEqual([(p['actor_id'], p['name']) for p in answer['items']], [('outsider', 'Outside fixture agent')])
        self.assertEqual(answer['scope']['kind'], 'topic')
        self.assertTrue(answer['scope']['may_add'])
        self.assertEqual(self.recorded(message), (body, [], None))
        self.assertEqual(self.addressed_deliveries(message), [])
        self.assertFalse(self.sql('SELECT 1 FROM topic_participants WHERE topic_id=? AND actor_id=?', ('t1', 'outsider')))

    def test_pages_aliases_ambiguity_id_precedence_and_repeated_names(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET name='Outside' WHERE id='outsider'")
            db.execute("INSERT INTO actors VALUES ('duplicate-one','agent','Shared',1)")
            db.execute("INSERT INTO actors VALUES ('duplicate-two','agent','Shared',1)")
            db.execute("INSERT INTO actors VALUES ('outsider-name','agent','outsider',1)")
        message = self.topic_message('@OUTSIDE @outsider. @Shared @agent-a @outside')
        cursor, people = 0, []
        while cursor is not None:
            answer = self.reach(message, cursor=cursor, limit=1)
            self.assertNotIn('error', answer, answer)
            people.extend(p['actor_id'] for p in answer['items'])
            next_cursor = answer['next_cursor']
            self.assertTrue(next_cursor is None or next_cursor > cursor)
            cursor = next_cursor
        self.assertEqual(set(people), {'outsider'})

    def test_other_actor_unpublished_and_removed_source_are_not_exposed(self):
        message = self.topic_message('@outsider hello')
        self.assertEqual(self.reach(message, actor='agent-a')['error']['code'], 'FORBIDDEN')
        self.assertEqual(self.store.view('owner', 'submission_mention_reach', {'submission_id':'missing'})['error']['code'], 'FORBIDDEN')

    def test_added_topic_member_and_outcome_member_need_no_warning(self):
        message = self.topic_message('@outsider hello')
        topic = self.store.view('owner', 'topic', {'topic_id':'t1'})['topic']
        self.committed(self.command('participation.set', {'actor_id':'outsider','present':True},
                                    target={'topic_id':'t1'}, expected={'topic_revision':topic['version']}))
        self.assertEqual(self.reach(message)['items'], [])
        # The outcome's Conversation uses its team, not the ordinary topic participant.
        outcome_message = self.topic_message('Hello @outsider', topic=self.conversation)
        answer = self.reach(outcome_message)
        self.assertEqual([p['actor_id'] for p in answer['items']], ['outsider'])
        self.assertEqual(answer['scope']['kind'], 'outcome')
        self.assertEqual(answer['scope']['add_kind'], 'workspace.member_set')
        self.assertTrue(answer['scope']['may_add'])

    def send_as(self, body, actor='owner', topic='t1', whisper=False, publish=True):
        key = 'reach-%s' % (self.serial + 1)
        writing = dict(source_ref={'kind':'topic','id':topic},topic_id=topic,generation='g',body=body,
                       attachments=[],quotes=[],addressees=['agent-a'] if whisper else [],
                       **({'whisper':True} if whisper else {'tell_first':True}))
        prior=self.sql("SELECT id,revision,generation FROM drafts WHERE actor_id=? AND topic_id=? AND json_extract(payload,'$.source_ref.kind')='topic'",(actor,topic))
        draft,revision,generation=prior[0] if prior else (key,0,'g')
        writing['generation']=generation
        self.committed(self.command('draft.save',writing,target={'draft_id':draft},expected={'draft_revision':revision},actor=actor))
        self.committed(self.command('submission.prepare',{'draft_id':draft,'submission_id':key,'send_operation_id':key+'-send'},
                                    target={'topic_id':topic},expected={'draft_revision':revision+1},actor=actor))
        if publish:
            self.committed(self.command('message.send',{'submission_id':key},target={'topic_id':topic},op=key+'-send',actor=actor))
        return key

    def test_private_unpublished_disabled_embedded_and_unknown_mentions(self):
        key=self.send_as('Hi @outsider @agent-a',whisper=True)
        self.assertEqual(self.store.view('owner','submission_mention_reach',{'submission_id':key})['items'],[])
        key=self.send_as('@outsider',publish=False)
        self.assertEqual(self.store.view('owner','submission_mention_reach',{'submission_id':key})['error']['code'],'FORBIDDEN')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='outsider'")
        key=self.send_as("x@outsider mail@outsider.com @outsider's @outsider @unknown")
        message=self.sql('SELECT id FROM messages WHERE operation_id=?',(key+'-send',))[0][0]
        self.assertEqual(self.reach(message)['items'],[])

    def test_normal_reader_may_add_but_outcome_member_cannot_add_to_team(self):
        self.committed(self.command('workspace.member_set',{'actor_id':'other-reader','present':True},target={'workspace_id':'w1'},
                                    expected={'workspace_revision':self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]}))
        key=self.send_as('Hi @outsider',actor='other-reader')
        answer=self.store.view('other-reader','submission_mention_reach',{'submission_id':key})
        self.assertTrue(answer['scope']['may_add'])
        self.committed(self.command('participation.set',{'actor_id':'outsider','present':True},target={'topic_id':'t1'},
                                    expected={'topic_revision':answer['scope']['revision']},actor='other-reader'))
        key=self.send_as('Hi @outsider',actor='other-reader',topic=self.conversation)
        answer=self.store.view('other-reader','submission_mention_reach',{'submission_id':key})
        self.assertEqual([p['actor_id'] for p in answer['items']],['outsider'])
        self.assertFalse(answer['scope']['may_add'])
        self.rejected(self.command('workspace.member_set',{'actor_id':'outsider','present':True},target={'workspace_id':'w1'},
                                  expected={'workspace_revision':answer['scope']['revision']},actor='other-reader'),'FORBIDDEN')

    def test_acknowledged_delivery_is_evidence_but_cancelled_queue_is_not(self):
        for acknowledged in (False,True):
            topic=self.store.view('owner','topic',{'topic_id':'t1'})['topic']
            self.committed(self.command('participation.set',{'actor_id':'outsider','present':True},target={'topic_id':'t1'},expected={'topic_revision':topic['version']}))
            key=self.send_as('Hi @outsider')
            message=self.sql('SELECT id FROM messages WHERE author_id=? AND operation_id=?',('owner',key+'-send'))[0][0]
            delivery=self.sql('SELECT id FROM deliveries WHERE message_id=? AND recipient_id=?',(message,'outsider'))[0][0]
            if acknowledged:self.committed(self.command('delivery.ack',target={'delivery_id':delivery},actor='outsider'))
            topic=self.store.view('owner','topic',{'topic_id':'t1'})['topic']
            self.committed(self.command('participation.set',{'actor_id':'outsider','present':False},target={'topic_id':'t1'},expected={'topic_revision':topic['version']}))
            self.assertEqual([p['actor_id'] for p in self.reach(message)['items']],[] if acknowledged else ['outsider'])

    def test_view_does_not_write_and_unsent_or_lost_topic_access_is_refused(self):
        key=self.send_as('Hi @outsider')
        message=self.sql('SELECT id FROM messages WHERE operation_id=?',(key+'-send',))[0][0]
        before=self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        self.assertEqual(len(self.reach(message)['items']),1)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"),before)
        self.committed(self.command('message.unsend',target={'message_id':message}))
        self.assertEqual(self.reach(message)['error']['code'],'FORBIDDEN')
        # A second human loses topic access; their frozen body is not a way back in.
        self.committed(self.command('participation.set',{'actor_id':'other-reader','present':True},target={'topic_id':'t1'},
                                    expected={'topic_revision':self.store.view('owner','topic',{'topic_id':'t1'})['topic']['version']}))
        key=self.send_as('Hi @outsider',actor='other-reader')
        self.committed(self.command('participation.set',{'actor_id':'other-reader','present':False},target={'topic_id':'t1'},
                                    expected={'topic_revision':self.store.view('owner','topic',{'topic_id':'t1'})['topic']['version']}))
        self.assertEqual(self.store.view('other-reader','submission_mention_reach',{'submission_id':key})['error']['code'],'FORBIDDEN')

from __future__ import annotations

from unittest import mock

from aim_next.contract import LIMITS
from reader_fixture import ReaderCase


class ChangeWindowsCase(ReaderCase):
    scopes = [{'kind':'actor','id':'owner'}, {'kind':'topic','id':'t1'}, {'kind':'workspace','id':'w1'}]

    def batch(self, windows=None, **extra):
        result = self.store.view('owner', 'changes', dict(windows=windows or [{'scope':s} for s in self.scopes], project=True, **extra))
        self.assertNotIn('error', result, result)
        return result

    def test_one_read_batches_canonical_scopes_and_projects_only_changed_rows(self):
        before = self.records()
        baseline = self.batch()
        self.assertEqual(self.records(), before)
        self.assertEqual(len(baseline['windows']), 3)
        self.assertEqual(baseline['topics'], [])
        windows = [{'scope':p['scope'], 'cursor':p['checkpoint']} for p in baseline['windows']]
        self.send('An arrival')
        before = self.records()
        answer = self.batch(windows)
        self.assertEqual(self.records(), before)
        self.assertEqual({x['id'] for x in answer['topics']}, {'t1'})
        self.assertEqual({x['id'] for x in answer['counts']}, {'w1'})
        canonical = self.store.view('owner','workspace_topics',{'workspace_id':'w1'})
        self.assertEqual(answer['topics'][0], next(x for x in canonical['items'] if x['id']=='t1'))
        ends = {p['checkpoint']['after_seq'] for p in answer['windows']}
        self.assertEqual(len(ends), 1)
        for window, page in zip(windows, answer['windows']):
            self.assertEqual(page, self.store.view('owner','changes',window))

    def test_one_forbidden_scope_refuses_without_returning_other_private_keys(self):
        windows = [{'scope':s} for s in self.scopes] + [{'scope':{'kind':'actor','id':'agent-a'}}]
        before = self.records()
        answer = self.store.view('owner','changes',{'windows':windows,'project':True})
        self.rejected(answer, 'FORBIDDEN')
        self.assertEqual(self.records(), before)

    def test_batch_is_bounded_and_duplicate_scopes_are_refused(self):
        for windows in [[], [{'scope':self.scopes[0]}]*2, [{'scope':{'kind':'actor','id':str(x)}} for x in range(101)]]:
            with self.subTest(size=len(windows)):
                self.rejected(self.store.view('owner','changes',{'windows':windows}), 'INVALID_ARGUMENT')

    def test_continuations_keep_each_scope_frontier_and_reauthorize(self):
        baseline = self.batch()
        windows = [{'scope':p['scope'], 'cursor':p['checkpoint']} for p in baseline['windows']]
        self.committed(self.memory(item='one'))
        self.committed(self.memory(item='two'))
        first = self.batch(windows, limit=1)
        own = first['windows'][1]
        self.assertTrue(own['has_more'])
        next_windows = [{'scope':p['scope'], 'cursor':p['continuation'] or p['checkpoint']} for p in first['windows']]
        self.committed(self.memory(item='later'))
        second = self.batch(next_windows, limit=1)
        self.assertEqual(second['windows'][1]['checkpoint']['after_seq'], own['continuation']['through_seq'])
        self.assertEqual(second['windows'][1]['items'][0]['resource_id'], 'two')

    def test_unaddressed_delivery_does_not_invalidate_attention_but_named_delivery_does(self):
        baseline=self.batch()
        windows=[{'scope':p['scope'],'cursor':p['checkpoint']} for p in baseline['windows']]
        self.committed(self.command('message.post',{'body':'Elsewhere ordinary fixture'},target={'topic_id':'t1'},actor='agent-a'))
        ordinary=self.batch(windows)
        self.assertFalse(ordinary['attention_changed'])
        canonical=self.store.view('owner','attention',{})
        self.assertEqual(ordinary['attention_counts'], {key:canonical[key] for key in ('unread','addressed','commit_seq')})
        self.assertIn('t1',ordinary['affected_topics'])
        windows=[{'scope':p['scope'],'cursor':p['checkpoint']} for p in ordinary['windows']]
        self.committed(self.command('message.post',{'body':'Named fixture','addressees':['owner'],'intent':'tell'},target={'topic_id':'t1'},actor='agent-a'))
        self.assertTrue(self.batch(windows)['attention_changed'])

    def test_read_ack_projects_changed_counts_without_a_topic_version_change(self):
        sent=self.committed(self.command('message.post',{'body':'Read me'},target={'topic_id':'t1'},actor='agent-a'))
        baseline=self.batch()
        windows=[{'scope':p['scope'],'cursor':p['checkpoint']} for p in baseline['windows']]
        sequence=self.sql('SELECT seq FROM messages WHERE id=?',(sent['message_id'],))[0][0]
        self.committed(self.command('topic.read_through',{'seq':sequence},target={'topic_id':'t1'}))
        result=self.batch(windows)
        self.assertEqual(result['windows'][1]['items'],[])
        self.assertIn('t1',result['affected_topics'])
        self.assertEqual(next(x for x in result['topics'] if x['id']=='t1')['unread'],0)


    def test_mixed_top_level_arguments_and_malformed_windows_refuse(self):
        for extra in ({'scope':self.scopes[0]}, {'cursor':{}}, {'project':1}, {'unknown':1}):
            self.rejected(self.store.view('owner','changes',dict(windows=[{'scope':self.scopes[0]}],**extra)), 'INVALID_ARGUMENT')
        for window in ({}, {'scope':self.scopes[0],'limit':1}, {'scope':self.scopes[0],'cursor':{}}, None):
            self.rejected(self.store.view('owner','changes',{'windows':[window]}), 'INVALID_ARGUMENT')

    def test_revoked_continuation_refuses_entire_batch_and_retains_records(self):
        self.participation('outsider',True)
        scope={'kind':'topic','id':'t1'}
        baseline=self.store.view('outsider','changes',{'windows':[{'scope':scope}]})
        for key in ('one','two'):
            self.committed(self.memory(item=key))
        first=self.store.view('outsider','changes',{'windows':[{'scope':scope,'cursor':baseline['windows'][0]['checkpoint']}],'limit':1})
        cursor=first['windows'][0]['continuation']
        self.assertIsNotNone(cursor)
        self.participation('outsider',False)
        before=self.records()
        result=self.store.view('outsider','changes',{'windows':[{'scope':{'kind':'actor','id':'outsider'}},{'scope':scope,'cursor':cursor}],'project':True})
        self.rejected(result,'FORBIDDEN')
        self.assertEqual(self.records(),before)
        self.assertNotIn('windows',result)

    def test_combined_byte_bound_refuses_without_advancing_inputs(self):
        windows=[{'scope':s} for s in self.scopes]
        before=self.records()
        with mock.patch.dict(LIMITS,summary_utf8_bytes=256):
            self.rejected(self.store.view('owner','changes',{'windows':windows,'project':True}), 'VIEW_TOO_LARGE')
        restored=self.batch(windows)
        self.assertTrue(all(p['baseline'] for p in restored['windows']))
        self.assertEqual(self.records(),before)

    def test_aggregate_key_limit_and_legacy_pages_match(self):
        baseline=self.batch()
        windows=[{'scope':p['scope'],'cursor':p['checkpoint']} for p in baseline['windows']]
        for n in range(36):
            self.committed(self.memory(item='bounded-%s'%n))
        result=self.batch(windows,limit=100)
        self.assertLessEqual(sum(len(p['items']) for p in result['windows']),100)
        self.assertTrue(any(p['has_more'] for p in result['windows']))
        for window,page in zip(windows,result['windows']):
            self.assertEqual(page,self.store.view('owner','changes',dict(window,limit=33)))

    def test_cursor_actor_and_authority_fences_are_unchanged(self):
        baseline=self.batch()
        for field,value in (('actor_id','agent-a'),('authority_epoch','other-epoch'),('instance_id','other-instance')):
            cursor=dict(baseline['windows'][0]['checkpoint'],**{field:value})
            self.rejected(self.store.view('owner','changes',{'windows':[{'scope':self.scopes[0],'cursor':cursor}]}),'RESYNC_REQUIRED')

    def test_private_writes_do_not_project_other_readers_keys_or_counts(self):
        scopes=[{'kind':'actor','id':'agent-b'},{'kind':'workspace','id':'w1'}]
        base=self.store.view('agent-b','changes',{'windows':[{'scope':s} for s in scopes],'project':True})
        self.committed(self.command('note.save',{'source_ref':self.opening,'body':'Private synthetic note'},target={'note_id':'private-1296'},expected={'note_revision':0}))
        windows=[{'scope':p['scope'],'cursor':p['checkpoint']} for p in base['windows']]
        before=self.records()
        result=self.store.view('agent-b','changes',{'windows':windows,'project':True})
        self.assertTrue(all(p['items']==[] for p in result['windows']))
        self.assertEqual(result['topics'],[])
        self.assertNotIn('attention_counts',result)
        self.assertEqual(self.records(),before)

    def test_actor_only_mark_refreshes_global_counts_without_workspace_rows(self):
        message=self.committed(self.command('message.post',{'body':'Synthetic mark target'},target={'topic_id':'t1'},actor='agent-a'))['message_id']
        seq=self.sql('SELECT seq FROM messages WHERE id=?',(message,))[0][0]
        self.committed(self.command('topic.read_through',{'seq':seq},target={'topic_id':'t1'}))
        scope={'kind':'actor','id':'owner'}
        base=self.batch([{'scope':scope}])
        before=self.store.view('owner','attention',{})
        self.committed(self.command('message.mark',{'marked':True},target={'message_id':message},expected={'mark_revision':0}))
        result=self.batch([{'scope':scope,'cursor':base['windows'][0]['checkpoint']}])
        current=self.store.view('owner','attention',{})
        self.assertEqual(current['unread'],before['unread']+1)
        self.assertEqual(result['attention_counts'],{key:current[key] for key in ('unread','addressed','commit_seq')})
        self.assertEqual(result['topics'],[])
        self.assertEqual(result['counts'],[])
        self.assertFalse(result['attention_changed'])

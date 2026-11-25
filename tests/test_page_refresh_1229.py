from __future__ import annotations

from reader_fixture import ReaderCase


class PageChangesCase(ReaderCase):
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


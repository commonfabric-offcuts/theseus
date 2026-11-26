from __future__ import annotations

"""1251: compare candidate ancestry to the authoritative recursive relation."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from aim_next import stacks, source_item_covers as covers
from aim_next.store import _connect
from test_source_item_covers import Fixture


class ProjectionCase(Fixture):
    def equivalent(self, root, actor='owner', db=None):
        owned = db is None
        if owned:
            db, _ = _connect(self.path)
        try:
            members = [r[0] for r in db.execute(stacks.MEMBERS + ' SELECT id FROM members', {'root': root, 'actor': actor})]
            marks = ','.join('?' for _ in members)
            rows = db.execute('SELECT id,seq,author_id FROM messages WHERE id IN (' + marks + ')', members).fetchall()
            expected = (max(r['seq'] for r in rows), max((r['seq'] for r in rows if r['author_id'] != actor), default=None))
            self.assertEqual(stacks._dossier(db, actor, root), expected)
            clock = db.execute("SELECT coalesce(max(seq),0) FROM changes WHERE scope_kind='actor' AND scope_id=? "
                               "AND resource_kind='source_cover_read' AND resource_id IN (" + marks + ')', [actor] + members).fetchone()[0]
            self.assertEqual(covers.read_sequence(db, actor, root), clock)
            raw = db.execute('SELECT s.workspace_id,s.number,s.message_id FROM pipeline_item_sources s '
                             'JOIN workspaces w ON w.id=s.workspace_id WHERE s.message_id IN (' + marks + ') '
                             'AND (w.owner_id=? OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.actor_id=?)) '
                             'ORDER BY s.workspace_id,s.number,s.position', members + [actor, actor]).fetchall()
            expected_rows = {}
            for r in raw:
                expected_rows.setdefault((r['workspace_id'], r['number']), []).append(r['message_id'])
            manual = {'stands': 'Exact manual words', 'waiting': [], 'payload': None, 'by': 'agent-a', 'owner': 'owner', 'at_ms': 1}
            actual = covers.project(db, actor, root, manual)
            self.assertEqual({k: v for k, v in actual.items() if k != 'items'}, manual)
            self.assertEqual({(r['workspace_id'], r['number']):r['sources'] for r in actual.get('items', [])}, expected_rows)
            all_source_members = db.execute('SELECT 1 FROM pipeline_item_sources WHERE message_id IN (' + marks + ') LIMIT 1', members).fetchone()
            self.assertEqual(covers.has_sources(db, actor, root), all_source_members is not None)
        finally:
            if owned:
                db.close()

    def test_join_split_and_private_source_preserve_exact_projection_clocks(self):
        root = self.post('Public report')
        reply = self.post('Related source', reply_to=root)
        hidden = self.post('Private source', whisper=True, addressees=['agent-a'], reply_to=root)
        other = self.post('Independent report')
        self.file('Related work', reply)
        self.file('Private work', hidden)
        self.file('Independent work', other)
        for actor in ('owner', 'agent-a', 'agent-b'):
            self.equivalent(root, actor)
        self.committed(self.command('stack.join', {'into':root}, {'message_id':other}, {'join_revision':0}))
        for actor in ('owner', 'agent-a', 'agent-b'):
            self.equivalent(root, actor)
        self.committed(self.command('stack.join', {'into':None}, {'message_id':other}, {'join_revision':1}))
        self.equivalent(root);self.equivalent(other)

    def test_full_own_window_and_other_dossier_keep_exact_aggregate_fallback(self):
        root = self.post('Report')
        self.post('Other author', actor='agent-a', reply_to=root)
        for n in range(40):
            self.post('Own reply %d' % n, reply_to=root)
        self.equivalent(root)
        other = self.post('Newest different dossier')
        self.post('A private newest reply', whisper=True, addressees=['agent-a'], reply_to=other)
        self.equivalent(root);self.equivalent(other, 'agent-b')

    def test_applied_unsent_retracted_and_restored_member_match_reference(self):
        root = self.post('Report')
        reply = self.post('Source to remove', reply_to=root)
        self.file('Actual work', reply)
        original = self.sql('SELECT * FROM message_removals')
        self.equivalent(root)
        for kind in ('unsent','retracted'):
            db, _ = _connect(self.path, write=True)
            try:
                db.execute('BEGIN IMMEDIATE')
                db.execute('INSERT INTO message_removals VALUES (?,?,?,?,?)', (reply,kind,'owner',1,'1251-applied-'+kind))
                self.assertEqual(db.execute('SELECT kind FROM message_removals WHERE message_id=?',(reply,)).fetchone()[0],kind)
                self.equivalent(root,db=db)
                db.rollback()  # Immutable committed removal facts cannot be deleted.
            finally:
                db.close()
            self.assertEqual(self.sql('SELECT * FROM message_removals'), original)
            self.equivalent(root)

    def test_withdrawn_question_and_destination_access_preserve_membership(self):
        root = self.post('Report')
        question = self.post('Question?', reply_to=root, intent='ask', go_ahead=False, addressees=['agent-a'])
        self.file('Actual work', question)
        self.committed(self.command('message.withdraw',{}, {'message_id':question}, actor='owner'))
        self.equivalent(root)
        for present in (False,True):
            revision=self.store.view('owner','workspace',{'workspace_id':'w1'})['workspace']['version']
            self.committed(self.command('workspace.member_set',{'actor_id':'agent-b','present':present}, {'workspace_id':'w1'}, {'workspace_revision':revision}))
            self.equivalent(root,'agent-b')


class CostCase(unittest.TestCase):
    def test_unlinked_message_growth_does_not_expand_complete_view_vm_work(self):
        from fixtures.scale_1250 import Seed
        from tools.scale_1250 import diagnostic
        with tempfile.TemporaryDirectory(prefix='source-cover1251-') as folder:
            root=Path(folder)
            small=Seed(root/'small',100);large=Seed(root/'large',1000)
            a,b=diagnostic(small.root),diagnostic(large.root)
            print('1251 VM control100/1000:',a['vm_steps'],b['vm_steps'],flush=True)
            self.assertLessEqual(b['vm_steps'],a['vm_steps']*1.5)


if __name__ == '__main__':
    unittest.main()

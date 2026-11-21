from __future__ import annotations

"""Real scratch reads/publications and bounded source-invalidation work."""
import sqlite3
from unittest import mock

from aim_next import stacks, source_item_covers as covers, root_posts
from aim_next.store import _connect
from test_source_item_covers import Fixture


class SourceCoverCostCase(Fixture):
    def thread(self, root, count=300, readers=10, sources=False):
        with sqlite3.connect(str(self.path)) as db:
            for n in range(readers - 3):
                actor = 'cost-reader-%d' % n
                db.execute("INSERT INTO actors(id,kind,name) VALUES (?,'human',?)", (actor, actor))
                db.execute("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1',?)", (actor,))
            columns = [row[1] for row in db.execute('PRAGMA table_info(messages)') if row[1] != 'seq']
            original = dict(zip(columns, db.execute('SELECT ' + ','.join(columns) + ' FROM messages WHERE id=?', (root,)).fetchone()))
            ids = []
            for n in range(count):
                row = dict(original, id='cost-source-%d' % n, operation_id='cost-seed-%d' % n, reply_to=root)
                db.execute('INSERT INTO messages(' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', [row[c] for c in columns])
                ids.append(row['id'])
            if sources:
                for n, mid in enumerate(ids):
                    db.execute("INSERT INTO pipeline_item_sources VALUES ('w1',1,?,?,NULL,NULL,'owner',1)", (n + 2, mid))
        return ids

    def test_unsourced_roots_skip_item_projection_and_three_dossier_walks(self):
        roots = [self.post('Unlinked report %d' % n) for n in range(4)]
        db, _ = _connect(self.path)
        try:
            with mock.patch.object(covers, 'project', wraps=covers.project) as project, \
                    mock.patch.object(covers, 'read_sequence', wraps=covers.read_sequence) as clock, \
                    mock.patch.object(stacks, '_dossier', wraps=stacks._dossier) as dossier, \
                    mock.patch.object(stacks, '_seen_acts', wraps=stacks._seen_acts) as topic:
                stacks.current_acts(db, 'owner', roots)
                self.assertEqual((project.call_count, clock.call_count, dossier.call_count), (0, 0, 0))
                self.assertLessEqual(topic.call_count, 1)
        finally:
            db.close()

    def test_one_foreground_page_shares_root_projections_and_topic_clock(self):
        roots = [self.post('Linked report %d' % n) for n in range(3)]
        for root in roots:
            self.file('Actual work', root)
        db, _ = _connect(self.path)
        try:
            items = [dict(row) for row in db.execute('SELECT id,topic_id FROM messages WHERE id IN (?,?,?)', roots)]
            with mock.patch.object(covers, 'project', wraps=covers.project) as project, \
                    mock.patch.object(stacks, '_dossier', wraps=stacks._dossier) as dossier, \
                    mock.patch.object(stacks, '_seen_acts', wraps=stacks._seen_acts) as topic:
                stacks.act_fields(db, 'owner', items)
                self.assertEqual(project.call_count, 3, 'one projection per linked root, shared by acts and positions')
                self.assertEqual(dossier.call_count, 3)
                self.assertEqual(topic.call_count, 1, 'one topic clock for the whole page')
        finally:
            db.close()

    def test_real_reply_to_300_messages_and_ten_readers_has_no_item_projection(self):
        root = self.post('A linked report')
        self.file('Actual linked work', root)
        self.thread(root)
        steps = [0]
        def counted_connect(*args, **kwargs):
            result = _connect(*args, **kwargs)
            def tick():
                steps[0] += 1
                return 0
            result[0].set_progress_handler(tick, 1)
            return result
        with mock.patch.object(covers, 'project', wraps=covers.project) as project, \
                mock.patch('aim_next.store._connect', side_effect=counted_connect):
            reply = self.post('Actual public reply', reply_to=root)
            print('757 real publication:301 prior messages,10 readers,source projections=%d,SQL VM instructions=%d' % (project.call_count, steps[0]))
            self.assertEqual(project.call_count, 0, 'publication ordering needs stored acts, not source covers')
        db, _ = _connect(self.path)
        try:
            message = db.execute('SELECT * FROM messages WHERE id=?', (reply,)).fetchone()
            self.assertEqual(len(self.store._message_readers(db, message, 'owner')), 10)
            with mock.patch.object(covers, 'project', wraps=covers.project) as project:
                self.assertTrue(root_posts.candidates(db, 'owner', 't1'))
                self.assertEqual(project.call_count, 0, 'divergence admission needs names/revisions only')
        finally:
            db.close()

    def test_bulk_configuration_writes_one_key_per_reader_topic_not_source(self):
        root = self.post('Configuration source')
        self.file('Actual work', root)
        self.thread(root, sources=True)
        db, _ = _connect(self.path)
        try:
            for record in ('configured', 'stages', 'access'):
                before = db.execute('SELECT coalesce(max(seq),0) FROM changes').fetchone()[0]
                with mock.patch.object(self.store, '_message_readers', wraps=self.store._message_readers) as readers:
                    covers.notify(self.store, db, 'w1', record)
                    self.assertLessEqual(readers.call_count, 2, 'coalesce equivalent source visibility before reader lookup')
                rows = db.execute("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,)).fetchall()
                self.assertEqual(len(rows), 10, record)
                self.assertEqual({r[0] for r in rows}, {'source_cover'})
                self.assertEqual(len({(r[1], r[2]) for r in rows}), 10)
        finally:
            db.rollback()
            db.close()

    def test_release_only_invalidates_the_shipping_pipeline(self):
        root = self.post('Release source')
        number = self.file('Ships', root)
        self.committed(self.on(ships_in_releases=True))
        self.committed(self.command('workspace.create', {'id': 'other-cost', 'title': 'Other', 'team': []}))
        self.committed(self.command('pipeline.configure', {'enabled': True}, {'workspace_id': 'other-cost'}, {'pipeline_revision': 0}))
        self.committed(self.command('pipeline.item_add', {'title': 'Does not ship', 'sources': [{'message_id': root}]}, {'workspace_id': 'other-cost'}))
        with mock.patch.object(covers, 'notify', wraps=covers.notify) as notify:
            self.store.record_release({'release': 801, 'commit': '8' * 40, 'deployed_at': '2026-11-21T01:00:00-08:00', 'items': [number], 'source': 'backfill'})
            item_calls = [(call.args[2], call.args[3]) for call in notify.call_args_list if isinstance(call.args[3], int)]
            self.assertEqual(item_calls, [('w1', number)])

    def test_membership_change_invalidates_only_affected_reader_once(self):
        root = self.post('Membership source')
        ids = self.thread(root)
        self.committed(self.command('workspace.create', {'id': 'member-cost', 'title': 'Destination', 'team': ['agent-a', 'agent-b']}))
        self.committed(self.command('pipeline.configure', {'enabled': True}, {'workspace_id': 'member-cost'}, {'pipeline_revision': 0}))
        number = self.committed(self.command('pipeline.item_add', {'title': 'Actual work', 'sources': [{'message_id': root}]}, {'workspace_id': 'member-cost'}))['number']
        with sqlite3.connect(str(self.path)) as db:
            for position, mid in enumerate(ids, 2):
                db.execute("INSERT INTO pipeline_item_sources VALUES ('member-cost',?,?,?,?,NULL,'owner',1)", (number, position, mid, None))
        for present in (False, True):
            before = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
            revision = self.store.view('owner', 'workspace', {'workspace_id': 'member-cost'})['workspace']['version']
            self.committed(self.command('workspace.member_set', {'actor_id': 'agent-b', 'present': present},
                                        {'workspace_id': 'member-cost'}, {'workspace_revision': revision}))
            rows = self.sql("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,))
            self.assertEqual([tuple(r) for r in rows], [('source_cover', 'agent-b', 't1')])

    def test_generated_cover_requests_first_authored_cover(self):
        root = self.post('No written cover yet')
        self.file('Actual work', root)
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.coordinator_set', {'actor_id': 'agent-a'}, {'workspace_id': 'w1'}, {'workspace_revision': revision}))
        self.committed(self.command('stack.cover_refresh', {}, {'message_id': root}, {'cover_revision': 0}))
        body = self.sql('SELECT body FROM refresh_requests WHERE message_id=?', (root,))[0][0]
        self.assertTrue(body.startswith("Please write this dossier's first cover"), body)

    def test_bulk_retains_addressed_only_reader_of_nonrepresentative_source(self):
        root = self.post('Unaddressed source')
        self.thread(root, count=1, readers=3)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('address-only','human','Address only')")
            db.execute("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1','address-only')")
        addressed = self.post('Specific source', addressees=['address-only'])
        self.committed(self.command('workspace.create', {'id': 'private-cost', 'title': 'Private destination', 'team': ['address-only']}))
        self.committed(self.command('pipeline.configure', {'enabled': True}, {'workspace_id': 'private-cost'}, {'pipeline_revision': 0}))
        self.committed(self.command('pipeline.item_add', {'title': 'Addressed work', 'sources': [{'message_id': 'cost-source-0'}, {'message_id': addressed}]}, {'workspace_id': 'private-cost'}))
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('workspace.member_set', {'actor_id': 'address-only', 'present': False}, {'workspace_id': 'w1'}, {'workspace_revision': revision}))
        db, _ = _connect(self.path)
        try:
            before = db.execute('SELECT coalesce(max(seq),0) FROM changes').fetchone()[0]
            covers.notify(self.store, db, 'private-cost', 'configured')
            rows = db.execute("SELECT resource_kind,scope_id,resource_id FROM changes WHERE seq>? AND resource_kind LIKE 'source_cover%'", (before,)).fetchall()
            self.assertEqual({tuple(r) for r in rows}, {('source_cover', 'owner', 't1'), ('source_cover', 'address-only', 't1')})
            self.assertEqual(len(rows), 2)
            self.assertGreater(covers.bulk_sequence(db, 'address-only', 't1'), before)
        finally:
            db.rollback()
            db.close()

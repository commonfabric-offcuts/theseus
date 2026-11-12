from __future__ import annotations

from test_stacks import StackCase
from aim_next.store import Store


class AsideCase(StackCase):
    def position(self, mid, actor='owner'):
        answer = self.store.view(actor, 'stack_positions', {'topic_id': 't1', 'message_ids': [mid]})
        self.assertNotIn('error', answer, answer)
        return answer['items'][0]['stack_position']

    def aside(self, mid, through=None, revision=0, actor='owner', op=None):
        return self.command('stack.aside', {'through': through}, target={'message_id': mid},
                            expected={'aside_revision': revision}, actor=actor, op=op)

    def latest(self):
        return self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]

    def test_saved_choice_is_personal_and_own_reply_or_old_unread_does_not_revive_it(self):
        root = self.post('Root')
        reply = self.post('Already unread', reply_to=root)
        before = self.sql('SELECT * FROM deliveries')
        self.committed(self.aside(root, self.latest()))
        self.assertTrue(self.position(reply)['below'])
        self.assertFalse(self.position(reply, 'agent-a')['below'])
        self.assertEqual(self.sql('SELECT * FROM deliveries'), before)
        own = self.post('My reply', actor='owner', reply_to=reply)
        self.assertTrue(self.position(own)['below'])
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertTrue(self.position(root)['below'])
        new = self.post('New answer', reply_to=own)
        self.assertFalse(self.position(new)['below'])
        self.assertFalse(self.position(reply)['below'])
        self.assertEqual(self.told(), [('actor', 'owner')])

    def test_racing_reply_after_observed_sequence_brings_back_without_losing_choice(self):
        root = self.post()
        observed = self.latest()
        self.post('Arrived while gesture was in flight', reply_to=root)
        self.committed(self.aside(root, observed))
        self.assertFalse(self.position(root)['below'])
        self.assertEqual(self.position(root)['through'], observed)

    def test_partial_page_has_canonical_root_and_same_choice(self):
        root = self.post('Unloaded root')
        parent = root
        for n in range(12):
            parent = self.post('Reply %d' % n, reply_to=parent)
        self.committed(self.aside(root, self.latest()))
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction': 'before', 'limit': 2})
        self.assertEqual(len(page['items']), 2)
        for item in page['items']:
            self.assertEqual(item['stack_position']['root_id'], root)
            self.assertTrue(item['stack_position']['below'])

    def test_join_and_split_follow_current_destination_and_old_source_choice(self):
        first, second = self.post('First'), self.post('Second')
        child = self.post('Second child', reply_to=second)
        self.committed(self.aside(second, self.latest()))
        self.committed(self.join(second, first))
        self.assertEqual(self.position(child)['root_id'], first)
        self.assertFalse(self.position(child)['below'])
        self.rejected(self.aside(second, self.latest(), 1), 'STACK_CHANGED')
        self.committed(self.aside(first, self.latest()))
        self.assertTrue(self.position(child)['below'])
        new = self.post('Someone answers the joined child', reply_to=child)
        self.assertFalse(self.position(first)['below'])
        self.committed(self.join(second, None, revision=1))
        self.assertEqual(self.position(new)['root_id'], second)
        self.assertFalse(self.position(new)['below'])
        self.assertTrue(self.position(first)['below'], 'reply left with the split source')

    def test_undo_is_revision_fenced_and_retry_keeps_one_record(self):
        root = self.post()
        first = self.aside(root, self.latest(), op='put-aside-once')
        self.committed(first)
        self.assertEqual(first, self.aside(root, self.latest(), op='put-aside-once'))
        self.rejected(self.aside(root, None, revision=0), 'REVISION_CONFLICT')
        self.committed(self.aside(root, None, revision=1))
        self.assertFalse(self.position(root)['below'])
        self.assertEqual(len(self.rows('aside')), 2)

    def test_only_visible_replies_bring_back_and_inaccessible_ancestry_is_not_disclosed(self):
        root = self.post()
        self.committed(self.aside(root, self.latest(), actor='agent-b'))
        before = self.position(root, 'agent-b')
        hidden = self.post('Private answer', actor='owner', reply_to=root, addressees=['agent-a'], whisper=True)
        self.assertEqual(self.position(root, 'agent-b'), before, 'a hidden whisper changes no visible position or watermark')
        self.committed(self.command('stack.name', {'name': 'A private name'}, target={'message_id': hidden},
                                    expected={'name_revision': 0}, actor='owner'))
        self.assertEqual(self.position(root, 'agent-b'), before, 'a hidden whisper act changes no visible watermark')
        self.rejected(self.aside(root, self.latest(), revision=1, actor='agent-b'), 'INVALID_ARGUMENT')
        answer = self.store.view('agent-b', 'stack_positions', {'topic_id': 't1', 'message_ids': [hidden]})
        self.assertEqual(answer['error']['code'], 'FORBIDDEN')

    def test_unrelated_topic_activity_does_not_revive_and_future_cutoff_is_refused(self):
        root = self.post()
        self.committed(self.aside(root, self.latest()))
        self.post('Unrelated discussion')
        self.assertTrue(self.position(root)['below'])
        self.rejected(self.aside(root, self.latest() + 1000, revision=1), 'INVALID_ARGUMENT')
        self.rejected(self.aside(root, True, revision=1), 'INVALID_ARGUMENT')
        answer = self.store.view('owner', 'stack_positions', {'topic_id': 't1', 'message_ids': [root] * 101})
        self.assertEqual(answer['error']['code'], 'INVALID_ARGUMENT')


class AsideMigrationCase(StackCase):
    def test_upgrade_and_back_preserve_schema_records_and_sequence_then_refuse_to_drop_any_aside(self):
        from aim_next.migrations import migrate, MigrationError
        import sqlite3
        root = self.post('Migration root')
        self.committed(self.star(root))
        self.committed(self.fold(root))
        schema = self.sql("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        rows = self.sql('SELECT * FROM message_acts ORDER BY id')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE sqlite_sequence SET seq=17 WHERE name='message_acts'")
        migrate(self.path, 'test-instance', self.binding, '37')
        self.assertEqual(self.sql('SELECT * FROM message_acts ORDER BY id'), rows)
        migrate(self.path, 'test-instance', self.binding)
        self.assertEqual(self.sql("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"), schema)
        self.assertEqual(self.sql("SELECT seq FROM sqlite_sequence WHERE name='message_acts'"), [(17,)])
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        receipt = self.command('stack.aside', {'through': self.sql('SELECT max(seq) FROM messages')[0][0]},
                               target={'message_id': root}, expected={'aside_revision': 0})
        self.assertEqual(self.committed(receipt)['acts_version'], 18)
        self.committed(self.command('stack.aside', {'through': None}, target={'message_id': root}, expected={'aside_revision': 1}))
        before = self.sql('SELECT * FROM message_acts ORDER BY id')
        with self.assertRaises(MigrationError) as caught:
            migrate(self.path, 'test-instance', self.binding, '37')
        self.assertEqual(caught.exception.code, 'RECORDS_WOULD_BE_LOST')
        self.assertEqual(self.sql('SELECT * FROM message_acts ORDER BY id'), before)

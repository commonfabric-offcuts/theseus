from __future__ import annotations

"""Item 731: real publication, personal placement, More, stars and reload."""
import unittest

from aim_next.store import Store
import test_stack_aside as fixtures


class DossierOrderCase(fixtures.AsideCase):
    def order(self, ids, actor='owner'):
        page = self.store.view(actor, 'topic_messages', {'topic_id': 't1', 'limit': 100})
        positions = {item['stack_position']['root_id']: item['stack_position'] for item in page['items']}
        # Legacy ordering is included so this checks the existing failure before implementation.
        def key(mid):
            pos = positions[mid]
            run = [item for item in page['items'] if item['stack_position']['root_id'] == mid]
            old = max(item['seq'] for item in run if item['id'] == mid or item['author_id'] != actor)
            return pos.get('order_key', pos['placed'] if pos['placed'] is not None else old)
        return sorted(ids, key=key, reverse=True)

    def test_item_731_reply_keeps_order_reload_own_move_new_and_return(self):
        b, a = self.post('B'), self.post('A')
        ids = [a, b]
        self.assertEqual(self.order(ids), [a, b])
        reply = self.post('Exact incoming reply to B', reply_to=b)
        self.assertEqual(self.order(ids), [a, b], 'item 731: incoming B reply does not lift B')
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.order(ids), [a, b])
        positions = {mid: self.position(mid) for mid in ids}
        own = self.command('stack.place', {'key': positions[a]['order_key'] + 1000}, target={'message_id': b}, expected={'place_revision': 0}, op='731-own-move')
        self.committed(own)
        self.assertEqual(self.order(ids), [b, a])
        self.assertEqual(self.order(ids, 'agent-b'), [a, b], 'personal rank never leaks')
        c = self.post('C new dossier')
        self.assertEqual(self.order([c] + ids), [c, b, a], 'new dossier enters above saved places')
        self.committed(self.aside(b, self.latest()))
        self.assertTrue(self.position(b)['below'])
        self.post('Own reply keeps it below', actor='owner', reply_to=reply)
        self.assertTrue(self.position(b)['below'])
        self.post('Wake B', reply_to=reply)
        self.assertFalse(self.position(b)['below'])
        self.assertEqual(self.order([c] + ids), [c, a, b], 'return is immediately above More, despite old placement')
        self.post('B stays returned', reply_to=b)
        self.assertEqual(self.order([c] + ids), [c, a, b])
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.order([c] + ids), [c, a, b])

    def test_item_731_star_hold_and_return_undo_key_and_retry(self):
        b, a, c = self.post('B'), self.post('A'), self.post('C')
        before = self.position(a)
        self.committed(self.aside(a, self.latest()))
        self.committed(self.command('stack.aside', {'through': None, 'key': before['order_key']}, target={'message_id': a}, expected={'aside_revision': 1}))
        self.assertEqual(self.order([a,b,c]), [c,a,b], 'Undo restores the exact previous position')
        self.committed(self.aside(a, self.latest(), revision=2))
        pre_star_key = self.position(a)['order_key']
        starred = self.command('message.star', {'starred': True}, target={'message_id': a}, expected={'star_revision': 0}, op='731-star-once')
        self.committed(starred)
        self.assertEqual(starred, self.command('message.star', {'starred': True}, target={'message_id': a}, expected={'star_revision': 0}, op='731-star-once'))
        self.assertEqual(self.order([a,b,c]), [c,a,b])
        self.assertEqual(self.position(a)['order_key'], pre_star_key)
        self.rejected(self.aside(a, self.latest(), revision=4), 'STARRED_IN_DOSSIER')
        self.assertFalse(self.position(a)['below'])
        self.post('A starred reply does not move it', reply_to=a)
        self.assertEqual(self.order([a,b,c]), [c,a,b])
        self.assertEqual(self.position(a)['order_key'], pre_star_key)

    def test_item_731_migration_preserves_each_readers_actual_existing_order(self):
        from aim_next.migrations import migrate, MigrationError
        b, a = self.post('B'), self.post('A')
        self.post('B was the newest active dossier at upgrade', reply_to=b)
        self.committed(self.command('stack.place', {'key': 9000}, target={'message_id': a}, expected={'place_revision': 0}))
        messages, acts = self.sql('SELECT * FROM messages'), self.sql('SELECT * FROM message_acts')
        self.sql('DROP TABLE dossier_order')
        self.sql("UPDATE metadata SET value='48' WHERE key='schema_version'")
        result = migrate(self.path, 'test-instance', self.binding)
        self.assertTrue(result['migrated'])
        self.store = Store(self.path, 'test-instance', expected_binding=self.binding)
        self.assertEqual(self.order([a,b]), [a,b], 'saved personal order survives migration')
        self.assertEqual(self.order([a,b], 'agent-b'), [b,a], 'the other reader keeps their actual activity order at upgrade')
        self.post('A reply after upgrade', reply_to=a)
        self.assertEqual(self.order([a,b], 'agent-b'), [b,a])
        self.assertEqual(self.sql('SELECT * FROM messages')[:len(messages)], messages)
        self.assertEqual(self.sql('SELECT * FROM message_acts'), acts)
        with self.assertRaises(MigrationError) as refusal:
            migrate(self.path, 'test-instance', self.binding, '48')
        self.assertEqual(refusal.exception.code, 'RECORDS_WOULD_BE_LOST')

    def test_item_731_reads_are_pure_and_reply_only_page_has_the_root_order(self):
        b, a = self.post('B'), self.post('A')
        reply = self.post('B branch', reply_to=b)
        before = self.records()
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction':'before', 'limit': 1})
        self.assertEqual(page['items'][0]['id'], reply)
        self.assertEqual(page['items'][0]['stack_position']['order_key'], self.position(b)['order_key'])
        self.assertEqual(page['items'][0]['stack_position']['root_id'], b)
        self.assertEqual(before, self.records(), 'reading positions never creates an order')

    def test_item_731_private_reply_does_not_return_an_outside_readers_dossier(self):
        b, a = self.post('B'), self.post('A')
        self.committed(self.aside(b, self.latest(), actor='agent-b'))
        before = self.position(b, 'agent-b')
        self.post('A whisper inside B', actor='owner', reply_to=b, whisper=True, addressees=['agent-a'])
        self.assertEqual(self.position(b, 'agent-b'), before, 'the outside reader learns no private activity or key')
        self.assertTrue(self.position(b, 'agent-b')['below'])
        self.assertEqual(self.order([a,b], 'agent-b'), [a,b])

    def test_item_731_a_person_can_move_back_to_the_same_place_act_after_return(self):
        b, a = self.post('B'), self.post('A')
        key = self.position(a)['order_key'] + 1
        self.committed(self.command('stack.place', {'key':key}, target={'message_id': b}, expected={'place_revision':0}))
        self.committed(self.aside(b, self.latest()))
        self.post('Wake', reply_to=b)
        self.assertEqual(self.order([a,b]), [a,b])
        self.committed(self.command('stack.place', {'key':key}, target={'message_id': b}, expected={'place_revision':1}))
        self.assertEqual(self.order([a,b]), [b,a], 'a new own move is not swallowed by an old place act with the same value')


if __name__ == '__main__':
    unittest.main()

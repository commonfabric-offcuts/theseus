from __future__ import annotations

from test_stacks import StackCase
from test_agent_cli import AgentCLIBase
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
        # A name goes on a dossier's first message (item 470): a whisper heading its own.
        alone = self.post('Private dossier', actor='owner', addressees=['agent-a'], whisper=True)
        self.committed(self.command('stack.name', {'name': 'A private name'}, target={'message_id': alone},
                                    expected={'name_revision': 0}, actor='owner'))
        self.assertEqual(self.position(root, 'agent-b'), before, 'a hidden whisper act changes no visible watermark')
        self.rejected(self.aside(root, self.latest(), revision=1, actor='agent-b'), 'INVALID_ARGUMENT')
        answer = self.store.view('agent-b', 'stack_positions', {'topic_id': 't1', 'message_ids': [hidden]})
        self.assertEqual(answer['error']['code'], 'FORBIDDEN')

    def test_a_whisper_someone_is_outside_leaves_their_page_and_positions_unchanged(self):
        root = self.post('Root on the record', actor='owner')
        reply = self.post('A reply on the record', reply_to=root)
        self.committed(self.aside(root, self.latest(), actor='agent-b'))

        def seen():
            page = self.store.view('agent-b', 'topic_messages', {'topic_id': 't1', 'audience': 'reader'})
            acts = self.store.view('agent-b', 'message_acts', {'topic_id': 't1'})
            self.assertNotIn('error', page, page)
            self.assertNotIn('error', acts, acts)
            # The commit number counts every commit on the instance, in any topic; it is not the topic's.
            page.pop('commit_seq')
            # A person's whisper counts as their Tell and moves the topic's version (whispers.py); it names nothing anyone reads.
            page.pop('relevant_versions')
            return page, acts, self.position(root, 'agent-b'), self.position(reply, 'agent-b')
        before = seen()
        # A whisper in the dossier, one on its own, and the topic's shared act on a whisper:
        # agent-b is in none of them, so nothing agent-b reads may move.
        asked = self.post('Private question', actor='owner', reply_to=reply, addressees=['agent-a'], whisper=True)
        alone = self.post('Private aside', actor='owner', addressees=['agent-a'], whisper=True)
        # A name goes on a dossier's first message (item 470): the whisper heading its own.
        self.committed(self.name(alone, 'Our secret', actor='agent-a'))
        self.assertEqual(seen(), before)
        # The rule acts where it should: a reply on the record by someone else moves agent-b's page and revives the dossier.
        self.post('An answer on the record', reply_to=reply)
        self.assertNotEqual(seen()[0], before[0])
        self.assertFalse(self.position(root, 'agent-b')['below'])

    def test_unrelated_topic_activity_does_not_revive_or_move_the_position_and_future_cutoff_is_refused(self):
        root = self.post()
        self.committed(self.aside(root, self.latest()))
        before = self.position(root)
        self.post('Unrelated discussion')
        self.assertEqual(self.position(root), before)
        self.assertTrue(self.position(root)['below'])
        self.rejected(self.aside(root, self.latest() + 1000, revision=1), 'INVALID_ARGUMENT')
        self.rejected(self.aside(root, True, revision=1), 'INVALID_ARGUMENT')
        answer = self.store.view('owner', 'stack_positions', {'topic_id': 't1', 'message_ids': [root] * 101})
        self.assertEqual(answer['error']['code'], 'INVALID_ARGUMENT')


class StarHoldCase(StackCase):
    """A dossier holding a message the reader starred stays above More for that reader (item 635,
    docs/dossier-below-more.md, "A star holds it above More"): Move below More is refused with its reason, and a star
    made in a dossier below More brings it back. A star and the move are each the reader's own, so the hold is too."""

    position, aside, latest = AsideCase.position, AsideCase.aside, AsideCase.latest

    def dossier(self):
        root = self.post('A plan for the shed roof')
        first = self.post('Tin or felt?', reply_to=root)
        later = self.post('Felt, two layers', reply_to=first)
        return root, first, later

    def test_a_star_on_a_later_message_holds_the_dossier_above_more_with_its_reason(self):
        root, _, later = self.dossier()
        self.committed(self.star(later))
        refused = self.aside(root, self.latest())
        self.rejected(refused, 'STARRED_IN_DOSSIER')
        self.assertIn('has a message you starred', refused['error']['message'])
        self.assertEqual(self.rows('aside'), [], 'nothing moved')
        self.assertFalse(self.position(root)['below'])
        self.assertEqual(self.position(root).get('starred'), [later], 'the position names the star the title bar shows')
        # Its first message's star holds it the same way.
        alone = self.post('A dossier of one')
        self.committed(self.star(alone))
        self.rejected(self.aside(alone, self.latest()), 'STARRED_IN_DOSSIER')

    def test_another_readers_star_never_holds_and_unstarring_frees_it(self):
        root, first, later = self.dossier()
        self.committed(self.star(first, actor='agent-b'))
        self.committed(self.aside(root, self.latest()))
        self.assertTrue(self.position(root)['below'], "another reader's star does not hold yours")
        self.rejected(self.aside(root, self.latest(), actor='agent-b'), 'STARRED_IN_DOSSIER')
        self.assertEqual(self.position(root).get('starred'), [], "another reader's star is never on yours")
        self.assertEqual(self.position(root, 'agent-b').get('starred'), [first])
        self.committed(self.star(later, actor='agent-b'))
        self.committed(self.star(first, on=False, revision=1, actor='agent-b'))
        self.rejected(self.aside(root, self.latest(), actor='agent-b'), 'STARRED_IN_DOSSIER')
        self.committed(self.star(later, on=False, revision=1, actor='agent-b'))
        self.assertEqual(self.position(root, 'agent-b').get('starred'), [])
        self.committed(self.aside(root, self.latest(), actor='agent-b'))
        self.assertTrue(self.position(root, 'agent-b')['below'], 'unstarring the last star frees it')

    def test_a_star_outside_the_dossier_does_not_hold_it(self):
        root, _, _ = self.dossier()
        elsewhere = self.post('Another dossier altogether')
        self.post('Its reply', reply_to=elsewhere)
        self.committed(self.star(elsewhere))
        self.committed(self.aside(root, self.latest()))
        self.assertTrue(self.position(root)['below'])
        self.assertEqual(self.position(root).get('starred'), [])
        self.rejected(self.aside(elsewhere, self.latest()), 'STARRED_IN_DOSSIER')

    def test_starring_a_message_in_a_dossier_below_more_brings_it_back_for_that_reader_alone(self):
        root, _, later = self.dossier()
        self.committed(self.aside(root, self.latest()))
        self.committed(self.aside(root, self.latest(), actor='agent-b'))
        self.sql("DELETE FROM changes")
        starred = self.committed(self.star(later))
        self.assertEqual({key: self.position(root)[key] for key in ('below', 'through', 'aside_revision')},
                         {'below': False, 'through': None, 'aside_revision': 2}, 'back above More, in the same act')
        self.assertEqual(starred.get('brought_back'), {'root_id': root, 'aside_revision': 2})
        self.assertTrue(self.position(root, 'agent-b')['below'], "another reader's move stands")
        self.assertEqual(self.told(), [('actor', 'owner')])
        self.assertEqual(starred['acts_version'], max(row[0] for row in self.sql("SELECT id FROM message_acts")))
        # Unstarring later leaves it above More: the star brought it back, it does not hold it there alone.
        self.committed(self.star(later, on=False, revision=1))
        self.assertFalse(self.position(root)['below'])
        # A star on a dossier above More writes no move.
        other, _, other_later = self.dossier()
        self.assertNotIn('brought_back', self.committed(self.star(other_later)))
        self.assertEqual(len(self.rows('aside')), 3)

    def test_a_starred_message_joined_into_a_dossier_below_more_keeps_it_above_more(self):
        root, _, _ = self.dossier()
        # Posted before the moves, so no newer message by someone else brings the dossier back once it joins.
        kept = self.post('A note to keep')
        self.committed(self.star(kept))
        self.committed(self.aside(root, self.latest()))
        self.committed(self.aside(root, self.latest(), actor='agent-b'))
        self.committed(self.join(kept, root, actor='agent-a'))
        self.assertFalse(self.position(root)['below'], 'your star keeps the dossier it joined above More')
        self.assertTrue(self.position(root, 'agent-b')['below'], 'for you, not for others')
        self.assertEqual(self.position(root).get('starred'), [kept])


class StarHoldCLICase(AgentCLIBase):
    """The CLI has no verb of its own for Move below More, but its `command` verb sends any command, stack.aside among
    them, through the same Core: an agent's star holds its dossier above More there too (item 635)."""

    post, act, star, rows, latest = StackCase.post, StackCase.act, StackCase.star, StackCase.rows, AsideCase.latest

    def aside_cli(self, root, actor='agent-a'):
        command = self.envelope('stack.aside', {'message_id': root}, {'through': self.latest()}, {'aside_revision': 0})
        return self.invoke('command', command, actor=actor, binding=self.captured_for(actor))

    def test_the_cli_command_verb_is_refused_for_the_agents_own_star_and_not_for_anothers(self):
        root = self.post('Gravel or pavers for the path?', actor='owner')
        later = self.post('Pavers, laid on sand', actor='owner', reply_to=root)
        # Another reader's star does not hold this agent's move.
        self.committed(self.star(later))
        self.committed(self.star(later, actor='agent-a'))
        before = self.rows('aside')
        code, result, _ = self.aside_cli(root)
        self.assertEqual((code, result['status'], result['error']['code']), (2, 'rejected', 'STARRED_IN_DOSSIER'), result)
        self.assertIn('has a message you starred', result['error']['message'])
        self.assertEqual(self.rows('aside'), before, 'nothing moved')
        # Unstarred, the same command moves it.
        self.committed(self.star(later, on=False, revision=1, actor='agent-a'))
        code, result, _ = self.aside_cli(root)
        self.assertEqual(code, 0, result)
        self.assertEqual(self.committed(result)['through'], self.latest())


class AsideMigrationCase(StackCase):
    def test_upgrade_and_back_preserve_schema_records_and_sequence_then_refuse_to_drop_any_aside(self):
        from aim_next.migrations import migrate, MigrationError
        import sqlite3
        root = self.post('Migration root')
        self.committed(self.star(root))
        self.committed(self.fold(root))
        # A star holds its dossier above More (item 635): the move is made on a dossier with none.
        moved = self.post('Migration dossier moved below More')
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
                               target={'message_id': moved}, expected={'aside_revision': 0})
        self.assertEqual(self.committed(receipt)['acts_version'], 18)
        self.committed(self.command('stack.aside', {'through': None}, target={'message_id': moved}, expected={'aside_revision': 1}))
        before = self.sql('SELECT * FROM message_acts ORDER BY id')
        with self.assertRaises(MigrationError) as caught:
            migrate(self.path, 'test-instance', self.binding, '37')
        self.assertEqual(caught.exception.code, 'RECORDS_WOULD_BE_LOST')
        self.assertEqual(self.sql('SELECT * FROM message_acts ORDER BY id'), before)

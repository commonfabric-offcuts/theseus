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
        after_fixture = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
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
        self.assertEqual(self.told(after=after_fixture), [('actor', 'owner')])

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

    def test_a_position_carries_its_first_messages_join_revision_so_a_page_of_replies_joins_the_dossier(self):
        # Item 550: a page holding only a dossier's replies joins the whole dossier by its first message, fenced on
        # the join revision Core holds for it, which the position carries; a dossier never joined says 0.
        lantern, ferry = self.post('Lantern dossier'), self.post('Ferry dossier')
        answer = self.post('An answer under the lantern dossier', reply_to=lantern)
        self.assertEqual(self.position(answer).get('join_revision'), 0)
        self.committed(self.join(lantern, ferry))
        self.committed(self.join(lantern, None, revision=1))
        self.assertEqual((self.position(answer)['root_id'], self.position(answer).get('join_revision')), (lantern, 2), 'joined and split back: 2')
        self.rejected(self.join(lantern, ferry, revision=0), 'REVISION_CONFLICT')
        self.committed(self.join(lantern, ferry, revision=2))
        self.assertEqual(self.position(answer)['root_id'], ferry, 'the whole dossier joined')
        self.assertEqual(self.position(answer).get('join_revision'), 0, 'its position is now the ferry dossier\'s')

    def test_a_position_carries_the_readers_own_place_on_its_first_message_so_a_page_of_replies_keeps_it(self):
        # Item 550: a reader's place for a dossier is on its first message, as its name is; a page holding only replies
        # sorts the dossier by it and places it fenced on the revision the position carries. Theirs alone.
        sailcloth, ferry = self.post('Sailcloth dossier'), self.post('Ferry dossier')
        answer = self.post('An answer under the sailcloth dossier', reply_to=sailcloth)
        later = self.post('A later answer to that answer', reply_to=answer)
        place = lambda key, revision, mid=sailcloth, actor='owner': self.command('stack.place', {'key': key}, target={'message_id': mid},
                                                                               expected={'place_revision': revision}, actor=actor)
        self.assertEqual([self.position(answer).get(key) for key in ('placed', 'place_revision')], [None, 0])
        self.committed(place(2.5, 0))
        self.assertEqual([(self.position(mid).get('placed'), self.position(mid).get('place_revision')) for mid in (answer, later)], [(2.5, 1)] * 2)
        self.rejected(place(4.5, 0), 'REVISION_CONFLICT')
        # The negatives: another reader's position holds no place of the owner's; a place on a reply is not the
        # dossier's; another dossier's position holds its own.
        self.assertEqual([self.position(answer, 'agent-a').get(key) for key in ('placed', 'place_revision')], [None, 0])
        self.committed(place(9.5, 0, mid=answer))
        self.assertEqual((self.position(later).get('placed'), self.position(later).get('place_revision')), (2.5, 1))
        self.assertEqual((self.position(ferry).get('placed'), self.position(ferry).get('place_revision')), (None, 0))
        self.committed(place(None, 1))
        self.assertEqual((self.position(answer).get('placed'), self.position(answer).get('place_revision')), (None, 2), 'let new replies move it')

    def test_a_position_carries_the_readers_own_places_on_the_dossiers_other_messages_the_most_recently_set_first(self):
        # Item 550: before a dossier was placed on its first message, a stack was placed on the message heading it, a
        # reply or a stack later joined into the dossier. The position lists each such place of the reader's own on a
        # message of the dossier, the most recently set first, whichever message is newer, so a page sorts the dossier
        # by it while the first message carries none, and Let new replies move it can take each away.
        sailcloth, ferry = self.post('Sailcloth dossier'), self.post('Ferry dossier')
        older = self.post('An answer under the sailcloth dossier', reply_to=sailcloth)
        newer = self.post('A later answer to that answer', reply_to=older)
        side = self.post('A stack of its own, joined into the dossier later')
        other = self.post('An answer under the ferry dossier', reply_to=ferry)
        place = lambda mid, key, revision=0, actor='owner': self.command('stack.place', {'key': key}, target={'message_id': mid},
                                                                         expected={'place_revision': revision}, actor=actor)
        places = lambda mid=newer, actor='owner': [(each['message_id'], each['placed'], each['place_revision']) for each in self.position(mid, actor)['places']]
        self.assertEqual(places(), [], 'none placed: none listed')
        self.committed(place(newer, 7))
        self.committed(place(older, 3))
        self.assertEqual(places(), [(older, 3, 1), (newer, 7, 1)], 'the most recently set first, though the other message is newer')
        self.assertEqual(places(sailcloth), places(), 'every message of the dossier carries the same list')
        self.assertTrue(all(isinstance(each['at_ms'], int) for each in self.position(newer)['places']), 'each says when it was set')
        # A stack placed and then joined into the dossier brings its place into the list.
        self.committed(place(side, 5))
        self.committed(self.join(side, older))
        self.assertEqual(places()[0], (side, 5, 1), 'the joined stack\'s place, the most recently set')
        # The negatives: the first message's own place is the position's placed, not listed; a place taken away is not
        # listed; another reader's places are theirs; another dossier lists only its own.
        self.committed(place(sailcloth, 2.5))
        self.assertEqual((self.position(newer)['placed'], [mid for mid, _, _ in places()]), (2.5, [side, older, newer]))
        self.committed(place(newer, None, revision=1))
        self.assertEqual(places(), [(side, 5, 1), (older, 3, 1)], 'a place taken away is not listed')
        self.committed(place(older, 11, actor='agent-a'))
        self.assertEqual((places(actor='agent-a'), places()), ([(older, 11, 1)], [(side, 5, 1), (older, 3, 1)]), 'each reader\'s own')
        self.committed(place(other, 9))
        self.assertEqual((places(ferry), places()), ([(other, 9, 1)], [(side, 5, 1), (older, 3, 1)]), 'another dossier lists its own alone')

    def test_a_readers_listed_place_is_fenced_by_their_own_revisions_alone(self):
        # Item 550: a reader's place on a message of the dossier is the latest of their own place acts there. Another
        # reader placing that message again, so that it carries a later revision of theirs, neither hides this
        # reader's place nor lists theirs; this reader placing it again lists the new place alone.
        dossier = self.post('Lantern dossier')
        answer = self.post('An answer about the harbour lanterns', reply_to=dossier)
        place = lambda key, revision=0, actor='owner': self.command('stack.place', {'key': key}, target={'message_id': answer},
                                                                    expected={'place_revision': revision}, actor=actor)
        places = lambda actor='owner': [(each['message_id'], each['placed'], each['place_revision']) for each in self.position(dossier, actor)['places']]
        self.committed(place(3))
        self.committed(place(4, actor='agent-a'))
        self.committed(place(5, revision=1, actor='agent-a'))
        self.assertEqual((places(), places('agent-a'), places('agent-b')), ([(answer, 3, 1)], [(answer, 5, 2)], []),
                         'mine stands though agent-a has reached a later revision on the same message; theirs is theirs')
        self.committed(place(6, revision=1))
        self.assertEqual((places(), places('agent-a')), ([(answer, 6, 2)], [(answer, 5, 2)]), 'my own later place replaces my earlier one')

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
    """The reader can archive a starred dossier. The star and boundary are independent personal acts."""

    position, aside, latest = AsideCase.position, AsideCase.aside, AsideCase.latest

    def dossier(self):
        root = self.post('A plan for the shed roof')
        first = self.post('Tin or felt?', reply_to=root)
        later = self.post('Felt, two layers', reply_to=first)
        return root, first, later

    def test_an_archived_dossier_retains_its_star_and_can_be_brought_back_and_archived_again(self):
        root, _, later = self.dossier()
        self.committed(self.star(later))
        observed = self.latest()
        self.committed(self.aside(root, observed))
        self.assertTrue(self.position(root)['below'])
        self.assertEqual(self.position(root)['starred'], [later])
        self.assertEqual(self.position(root, 'agent-b')['starred'], [])
        self.assertFalse(self.position(root, 'agent-b')['below'])

        back = self.committed(self.aside(root, None, revision=1))
        self.assertEqual((back['through'], back['aside_revision']), (None, 2))
        self.assertFalse(self.position(root)['below'])
        self.committed(self.aside(root, observed, revision=2))
        self.assertTrue(self.position(root)['below'])
        self.assertEqual(self.position(root)['starred'], [later])

    def test_starring_and_unstarring_do_not_change_the_archive_position_or_revision(self):
        root, _, later = self.dossier()
        observed = self.latest()
        moved = self.committed(self.aside(root, observed))
        self.committed(self.aside(root, observed, actor='agent-b'))
        self.sql("DELETE FROM changes")
        starred = self.committed(self.star(later))
        self.assertEqual(starred['acts_before'], moved['acts_version'])
        self.assertEqual(starred['acts_version'], moved['acts_version'] + 2,
                         'one intervening archive by another reader and one personal star')
        self.assertNotIn('brought_back', starred)
        self.assertEqual(self.told(), [('actor', 'owner')])
        self.assertEqual(len(self.rows('aside')), 2, 'the star writes no archive act')
        self.assertEqual(self.position(root)['aside_revision'], 1)
        self.assertTrue(self.position(root)['below'])
        self.assertTrue(self.position(root, 'agent-b')['below'])
        self.assertEqual(self.position(root)['starred'], [later])
        self.assertEqual(self.position(root, 'agent-b')['starred'], [])

        self.committed(self.star(later, on=False, revision=1))
        self.assertTrue(self.position(root)['below'])
        self.assertEqual(self.position(root)['starred'], [])
        self.assertEqual(self.position(root)['aside_revision'], 1)

    def test_joining_a_starred_message_does_not_unarchive_a_dossier(self):
        root, _, _ = self.dossier()
        kept = self.post('A note to keep')
        self.committed(self.star(kept))
        self.committed(self.aside(root, self.latest()))
        self.committed(self.aside(root, self.latest(), actor='agent-b'))
        self.committed(self.join(kept, root, actor='agent-a'))
        self.assertTrue(self.position(root)['below'])
        self.assertTrue(self.position(root, 'agent-b')['below'])
        self.assertEqual(self.position(root)['starred'], [kept])
        self.assertEqual(self.position(root, 'agent-b')['starred'], [])

    def test_a_new_visible_reply_still_returns_an_archived_starred_dossier(self):
        root, _, later = self.dossier()
        self.committed(self.star(later))
        self.committed(self.aside(root, self.latest()))
        self.assertTrue(self.position(root)['below'])
        self.post('New visible reply', actor='agent-a', reply_to=root)
        self.assertFalse(self.position(root)['below'])
        self.assertEqual(self.position(root)['starred'], [later])


class StarCoverMergeCase(StackCase):
    """Train 35's cover and item 635's personal position share one partial-page contract."""

    position, aside, latest = AsideCase.position, AsideCase.aside, AsideCase.latest

    def test_queue42_partial_position_keeps_cover_stars_and_both_place_shapes(self):
        root = self.post("Assembly roof plan")
        later = self.post("Assembly roof materials", reply_to=root)
        initial_cover_revision = self.position(root)["cover_revision"]
        for mid, key in [(root, 1.5), (later, 2.5)]:
            self.committed(self.command("stack.place", {"key": key}, target={"message_id": mid},
                                        expected={"place_revision": 0}))
        self.committed(self.command("stack.cover", {"stands": "Roof ready"}, target={"message_id": root},
                                    expected={"cover_revision": initial_cover_revision}, actor="agent-a"))
        self.committed(self.star(later))
        pos = self.position(later)
        self.assertEqual((pos["root_id"], pos["placed"], pos["place_revision"]), (root, 1.5, 1))
        self.assertEqual([(x["message_id"], x["placed"]) for x in pos["places"]], [(later, 2.5)])
        self.assertIn("starred", pos, "a partial position retains the reader star field")
        self.assertEqual(pos["starred"], [later])
        self.assertEqual(pos["cover"]["stands"], "Roof ready")
        self.assertEqual(pos["cover_revision"], initial_cover_revision + 1)
        self.assertEqual(self.position(later, "agent-a")["starred"], [])
        self.assertEqual(self.position(later, "agent-a")["places"], [])
        self.committed(self.aside(root, self.latest()))
        self.assertTrue(self.position(later)["below"])

    def test_star_hold_and_return_preserve_cover_on_partial_pages(self):
        root = self.post('A plan for the shed roof')
        later = self.post('Felt, two layers', reply_to=root)
        initial_cover_revision = self.position(root)['cover_revision']
        initial_covers = self.rows('cover')
        self.committed(self.command('stack.cover', {'stands': 'Materials chosen'},
                                    target={'message_id': root}, expected={'cover_revision': initial_cover_revision}, actor='agent-a'))
        cover = self.position(later)['cover']
        self.assertIsNotNone(cover, 'a partial position retains the dossier cover')
        self.assertEqual(cover['stands'], 'Materials chosen')
        self.committed(self.aside(root, self.latest()))
        self.committed(self.aside(root, self.latest(), actor='agent-a'))
        returned = self.committed(self.star(later))
        self.assertNotIn('brought_back', returned)

        def partial():
            page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction': 'before', 'limit': 1})
            self.assertNotIn('error', page, page)
            self.assertEqual([item['id'] for item in page['items']], [later], 'the root is outside the loaded page')
            return page['items'][0]['stack_position']

        place = partial()
        self.assertEqual((place['root_id'], place['starred'], place['below'], place['cover_revision']),
                         (root, [later], True, initial_cover_revision + 1))
        self.assertEqual(place['cover'], cover, 'the same position carries the cover and the reader\'s stars')
        self.assertTrue(self.position(later, 'agent-a')['below'], 'another reader\'s move stays personal')
        self.committed(self.aside(root, None, revision=1))
        self.assertFalse(partial()['below'])
        self.committed(self.star(later, on=False, revision=1))
        self.committed(self.aside(root, self.latest(), revision=2))
        self.assertTrue(partial()['below'])
        self.committed(self.command('stack.cover', {'stands': 'Roof repaired'},
                                    target={'message_id': root}, expected={'cover_revision': initial_cover_revision + 1}, actor='agent-a'))
        self.committed(self.star(root))
        place = partial()
        self.assertEqual((place['starred'], place['below'], place['cover_revision'], place['cover']['stands']),
                         ([root], True, initial_cover_revision + 2, 'Roof repaired'))
        self.assertEqual(len(self.rows('cover')), len(initial_covers) + 2, 'only the two explicit cover writes append records')
        self.assertEqual(self.rows('cover')[:len(initial_covers)], initial_covers, 'the root cover history remains intact')


class StarHoldCLICase(AgentCLIBase):
    """The CLI has no verb of its own for Move below More, but its `command` verb sends any command, stack.aside among
    them, through the same Core and the same personal archive and star rules."""

    post, act, star, rows, latest = StackCase.post, StackCase.act, StackCase.star, StackCase.rows, AsideCase.latest

    def aside_cli(self, root, actor='agent-a'):
        command = self.envelope('stack.aside', {'message_id': root}, {'through': self.latest()}, {'aside_revision': 0})
        return self.invoke('command', command, actor=actor, binding=self.captured_for(actor))

    def test_the_cli_can_archive_a_dossier_with_the_agents_own_star(self):
        root = self.post('Gravel or pavers for the path?', actor='owner')
        later = self.post('Pavers, laid on sand', actor='owner', reply_to=root)
        self.committed(self.star(later))
        self.committed(self.star(later, actor='agent-a'))
        code, result, _ = self.aside_cli(root)
        self.assertEqual(code, 0, result)
        self.assertEqual(self.committed(result)['through'], self.latest())
        self.assertEqual(len(self.rows('aside')), 1)


class AsideMigrationCase(StackCase):
    def test_upgrade_and_back_preserve_schema_records_and_sequence_then_refuse_to_drop_any_aside(self):
        from aim_next.migrations import migrate, MigrationError
        import sqlite3
        root = self.post('Migration root')
        self.committed(self.star(root))
        self.committed(self.fold(root))
        moved = self.post('Migration dossier moved below More')
        schema = self.sql("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        rows = self.sql('SELECT * FROM message_acts ORDER BY id')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE sqlite_sequence SET seq=17 WHERE name='message_acts'")
            # This test isolates the historical 37/38 aside step. Remove the
            # later 731 positions explicitly; test_dossier_order checks the
            # real schema-48 preservation and downgrade refusal separately.
            db.execute("DELETE FROM dossier_order")
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

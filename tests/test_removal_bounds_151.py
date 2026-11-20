from __future__ import annotations

"""Final-envelope bounds and exposure; ReaderCase owns every test store."""
import json
import sqlite3

from aim_next.contract import LIMITS
import reader_fixture as fixtures


class FinalEnvelopeCase(fixtures.ReaderCase):
    def post(self, body, **extra):
        args = dict(body=body, addressees=['agent-a'], intent='tell')
        args.update(extra)
        return self.committed(self.command('message.post', args, target={'topic_id': 't1'}))['message_id']

    def long_reaction_history(self, messages, count=100):
        # Valid historical rows, not fabricated projection dictionaries: old
        # reactors need not remain active/on today's <=128-person team. IDs,
        # authors and reaction foreign keys are real in this disposable store.
        actors = ['former-%03d-' % n + 'é' * 180 for n in range(count)]
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name,enabled) VALUES (?,'agent',?,0)", [(a, a) for a in actors])
            db.executemany("INSERT INTO message_reactions(actor_id,message_id,kind,topic_id,value,at_ms,revision) "
                           "VALUES (?,?,'thumb','t1','up',1,1)", [(a, m) for m in messages for a in actors])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        # Actual reactions owner establishes that decoration alone exceeds
        # the unchanged limit. Its metadata-only read exposes no message words.
        shown = []
        for message in messages:
            view = self.store.view('owner', 'reactions', {'message_id': message})
            self.assertNotIn('error', view, view)
            self.assertEqual(len(view['reactions']['thumbs']), count)
            shown.append({'reactions': view['reactions']})
        self.assertGreater(self.json_size({'items': shown}), LIMITS['summary_utf8_bytes'])

    def bare_messages(self):
        messages = [self.post('Bounded original words %d' % n) for n in range(4)]
        bare = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'message_ids': messages})
        self.assertNotIn('error', bare, bare)
        self.assertEqual([v['id'] for v in bare['items']], messages)
        self.assertLess(self.json_size(bare), LIMITS['summary_utf8_bytes'])
        return messages

    def facts(self, messages):
        wanted = set(messages)
        first = {m: (a, at) for m, a, at in self.sql('SELECT * FROM message_first_exposures') if m in wanted}
        revisions = {(a, m): rev for a, m, rev in self.sql('SELECT actor_id,message_id,revision FROM message_exposures') if m in wanted}
        return first, revisions

    def assert_refused_without_exposure(self, actor, messages):
        before = self.records()
        answer = self.store.view(actor, 'topic_messages', {'topic_id': 't1', 'message_ids': messages})
        self.assertEqual(answer.get('error', {}).get('code'), 'VIEW_TOO_LARGE', answer)
        self.assertEqual(set(answer), {'instance_id', 'error'}, 'no partial named success or unusable cursor')
        self.assertEqual(self.records(), before, 'refusal records no first/revision exposure or other write')
        self.assertEqual(self.facts(messages), ({}, {}))

    def test_named_decorated_envelope_refuses_all_ids_and_records_no_exposure(self):
        self.participation('other-reader', True)
        messages = self.bare_messages()
        self.long_reaction_history(messages)
        self.assertEqual(LIMITS['summary_utf8_bytes'], 131072)
        self.assertEqual(self.facts(messages), ({}, {}))
        for actor in ('other-reader', 'agent-a'):
            with self.subTest(actor=actor):
                self.assert_refused_without_exposure(actor, messages)
        # A smaller exact request succeeds, carries all its IDs, and exposes
        # only that returned subset. This is not a cursor continuation.
        answer = self.store.view('agent-a', 'topic_messages', {'topic_id': 't1', 'message_ids': messages[:1]})
        self.assertNotIn('error', answer, answer)
        self.assertEqual([v['id'] for v in answer['items']], messages[:1])
        self.assertIsNone(answer['next_cursor'])
        self.assertLessEqual(self.json_size(answer), 131072)
        first, revisions = self.facts(messages)
        self.assertEqual(set(first), set(messages[:1]))
        self.assertEqual(revisions, {('agent-a', messages[0]): 1})

    def test_named_preliminary_overflow_also_refuses_instead_of_losing_requested_ids(self):
        self.participation('other-reader', True)
        addresses = ['address-%02d-' % n + 'é' * 180 for n in range(32)]
        messages = []
        # Same bulk historical-message fixture style as ReaderBoundsCase;
        # preserve the maintained address index and all foreign keys.
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", [(a, a) for a in addresses])
            for n in range(16):
                identity = 'named-byte-%02d' % n
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                                 "VALUES (?,'t1','owner',?,'[]','[]',?,?)", (identity, 'é' * 1024, json.dumps(addresses), identity)).lastrowid
                db.executemany("INSERT INTO message_addressees VALUES ('t1',?,?)", [(a, seq) for a in addresses])
                messages.append(identity)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertGreater(self.json_size([{'addressees': addresses} for _ in messages]), 131072)
        for actor in ('other-reader', 'agent-a'):
            with self.subTest(actor=actor):
                self.assert_refused_without_exposure(actor, messages)

    def test_one_decorated_item_that_cannot_fit_refuses_without_exposure(self):
        self.participation('other-reader', True)
        message = self.post('One original message')
        self.long_reaction_history([message], count=400)
        for actor in ('other-reader', 'agent-a'):
            with self.subTest(actor=actor):
                self.assert_refused_without_exposure(actor, [message])
                before = self.records()
                seq = self.sql('SELECT seq FROM messages WHERE id=?', (message,))[0][0]
                answer = self.store.view(actor, 'topic_messages', {'topic_id': 't1', 'cursor': seq - 1, 'limit': 1})
                self.assertEqual(answer.get('error', {}).get('code'), 'VIEW_TOO_LARGE', answer)
                self.assertEqual(self.records(), before)
                self.assertEqual(self.facts([message]), ({}, {}))

    def traversal(self, actor, direction):
        self.participation('other-reader', True)
        messages = self.bare_messages()
        self.long_reaction_history(messages)
        terminal = self.committed(self.command('message.retract', target={'message_id': messages[0]}))['removal']
        self.committed(self.command('note.save', {'source_ref': {'kind': 'message', 'id': messages[-1]}, 'body': 'Private note'},
                                    target={'note_id': 'bounded-private-note'}, expected={'note_revision': 0}, actor=actor))
        self.assertEqual(self.facts(messages), ({}, {}))
        seqs = dict(self.sql('SELECT id,seq FROM messages WHERE id IN (?,?,?,?)', messages))
        cursor = min(seqs.values()) - 1 if direction == 'after' else max(seqs.values()) + 1
        seen, pages = [], []
        while True:
            page = self.store.view(actor, 'topic_messages', {'topic_id': 't1', 'direction': direction, 'cursor': cursor, 'limit': 100})
            self.assertNotIn('error', page, page)
            self.assertLessEqual(self.json_size(page), 131072)
            self.assertTrue(page['items'], 'a successful page advances')
            rows = page['items']
            self.assertEqual([v['seq'] for v in rows], sorted(v['seq'] for v in rows))
            ordered = rows if direction == 'after' else list(reversed(rows))
            returned = [v['id'] for v in ordered if v['id'] in seqs]
            if not pages:
                self.assertGreater(len(returned), 0)
                self.assertLess(len(returned), len(messages), 'final decoration forces actual trimming')
            for row in rows:
                if row['id'] not in seqs:
                    continue
                self.assertEqual(len(row['reactions']['thumbs']), 100, 'kept rows retain complete decoration')
                self.assertEqual(row['removal'], terminal if row['id'] == messages[0] else None)
                self.assertIs(row['yours']['note'], row['id'] == messages[-1])
            seen.extend(returned)
            self.assertEqual(len(seen), len(set(seen)), 'each original message appears once')
            first, revisions = self.facts(messages)
            self.assertEqual(set(first), set(seen), 'unreturned rows are not exposed by discarded markers')
            self.assertTrue(all(value[0] == actor for value in first.values()))
            self.assertEqual(revisions, {(actor, m): 1 for m in seen} if actor == 'agent-a' else {})
            pages.append({'ids': [v['id'] for v in rows], 'bytes': self.json_size(page), 'cursor': page['next_cursor']})
            self.assertLess(len(pages), 10)
            if page['next_cursor'] is None:
                break
            self.assertEqual(page['next_cursor'], min(v['seq'] for v in rows) if direction == 'before' else max(v['seq'] for v in rows))
            self.assertNotEqual(page['next_cursor'], cursor)
            cursor = page['next_cursor']
        self.assertEqual(seen, messages if direction == 'after' else messages[::-1])
        print('FINAL_ENVELOPE151 ' + json.dumps({'actor': actor, 'direction': direction, 'pages': pages}), flush=True)

    def test_human_after_pages_expose_only_returned_original_words(self):
        self.traversal('other-reader', 'after')

    def test_human_before_pages_expose_only_returned_original_words(self):
        self.traversal('other-reader', 'before')

    def test_agent_after_pages_expose_only_returned_original_words(self):
        self.traversal('agent-a', 'after')

    def test_agent_before_pages_expose_only_returned_original_words(self):
        self.traversal('agent-a', 'before')

from __future__ import annotations

"""1170 metadata and authority cases. Every record is in ReaderCase's temporary store."""

from unittest import mock

from reader_fixture import ReaderCase


class MovedPointersCase(ReaderCase):
    def quiet_topic(self, topic):
        opening = '1170-opening-' + topic
        self.committed(self.command('opening.save', {
            'workspace_id': 'w1', 'topic_id': topic, 'title': 'Destination ' + topic,
            'participants': [], 'body': '', 'attachments': [],
        }, target={'opening_id': opening}, expected={'opening_revision': 0}))
        self.committed(self.command('opening.publish', target={'opening_id': opening},
                                    expected={'opening_revision': 1}))

    def post(self, body='Words outside the pointer', actor='owner', **extra):
        return self.committed(self.command('message.post', dict(body=body, **extra),
                                           target={'topic_id': 't1'}, actor=actor))['message_id']

    def name(self, root, name, revision=0):
        self.committed(self.command('stack.name', {'name': name}, target={'message_id': root},
                                    expected={'name_revision': revision}))

    def move(self, root, source='t1', destination='destination', revision=0, at=123456):
        with mock.patch('aim_next.dossier_move._now_ms', return_value=at):
            return self.committed(self.command('stack.move', {'topic_id': destination},
                target={'message_id': root}, expected={'source_topic_id': source, 'move_revision': revision}))

    def pointers(self, topic='t1', actor='owner', **paging):
        answer = self.store.view(actor, 'dossier_moves', dict(topic_id=topic, **paging))
        self.assertNotIn('error', answer, answer)
        return answer

    def test_pointer_keeps_the_recorded_mover_time_and_current_shared_name(self):
        self.quiet_topic('destination')
        root = self.post(actor='agent-a')
        self.name(root, 'A named fixture dossier')
        self.move(root)
        pointer = self.pointers()['items'][0]
        self.assertEqual((pointer.get('actor_id'), pointer.get('at_ms'), pointer.get('name')),
                         ('owner', 123456, 'A named fixture dossier'))
        self.assertEqual((pointer['actor_id'], pointer['at_ms'], pointer['name']),
                         ('owner', 123456, 'A named fixture dossier'))
        self.assertEqual((pointer['root_id'], pointer['topic_id'], pointer['title']),
                         (root, 'destination', 'Destination destination'))
        self.name(root, 'Renamed after moving', revision=1)
        self.assertEqual(self.pointers()['items'][0]['name'], 'Renamed after moving')
        self.name(root, '', revision=2)
        self.assertIsNone(self.pointers()['items'][0]['name'])
        self.assertEqual(self.sql('SELECT actor_id,at_ms FROM dossier_moves WHERE root_id=?', (root,)),
                         [('owner', 123456)], 'renaming does not manufacture a new move')

    def test_metadata_read_does_not_disclose_root_words_or_record_a_body_exposure(self):
        self.quiet_topic('destination')
        root = self.post(body='These synthetic root words must never be a pointer fallback')
        self.move(root)
        before = self.sql('SELECT * FROM message_first_exposures ORDER BY message_id')
        pointer = self.pointers(actor='agent-a')['items'][0]
        self.assertIsNone(pointer.get('name'))
        self.assertEqual(set(pointer), {'id', 'root_id', 'topic_id', 'title', 'name', 'actor_id', 'at_ms'})
        self.assertNotIn('synthetic root words', str(pointer))
        self.assertEqual(self.sql('SELECT * FROM message_first_exposures ORDER BY message_id'), before)

    def test_whispered_pointer_metadata_stays_with_the_exact_pair(self):
        self.quiet_topic('destination')
        root = self.post(whisper=True, addressees=['agent-a'])
        self.name(root, 'Private fixture dossier')
        self.move(root)
        self.assertEqual(self.pointers(actor='agent-a')['items'][0].get('name'), 'Private fixture dossier')
        hidden = self.pointers(actor='agent-b')
        self.assertEqual((hidden['items'], hidden['arrivals'], hidden['next_cursor']), ([], [], None))

    def test_losing_destination_access_removes_every_pointer_field(self):
        self.quiet_topic('destination')
        self.participation('other-reader', True)
        root = self.post()
        self.name(root, 'Revocable fixture dossier')
        self.move(root)
        self.assertEqual(self.pointers(actor='other-reader')['items'], [])
        self.committed(self.command('participation.set', {'actor_id': 'other-reader', 'present': True},
                                    target={'topic_id': 'destination'}))
        self.assertEqual(self.pointers(actor='other-reader')['items'][0].get('actor_id'), 'owner')
        self.committed(self.command('participation.set', {'actor_id': 'other-reader', 'present': False},
                                    target={'topic_id': 'destination'}))
        hidden = self.pointers(actor='other-reader')
        self.assertEqual((hidden['items'], hidden['next_cursor']), ([], None))

    def test_paging_current_destination_and_return_keep_existing_membership_semantics(self):
        for topic in ('destination', 'later'):
            self.quiet_topic(topic)
        roots = [self.post(body='Fixture dossier %d' % number) for number in range(3)]
        for number, root in enumerate(roots):
            self.move(root, at=1000 + number)
        found, cursor = [], 0
        for _ in range(3):
            page = self.pointers(limit=1, cursor=cursor)
            self.assertEqual(len(page['items']), 1)
            found.extend(page['items'])
            cursor = page['next_cursor']
            if cursor is None:
                break
        self.assertEqual([row['root_id'] for row in found], roots)
        self.assertIsNone(cursor)
        self.move(roots[0], source='destination', destination='later', revision=1, at=2000)
        pointer = next(row for row in self.pointers()['items'] if row['root_id'] == roots[0])
        self.assertEqual(pointer['topic_id'], 'later')
        self.move(roots[0], source='later', destination='t1', revision=2, at=3000)
        page = self.pointers()
        self.assertNotIn(roots[0], [row['root_id'] for row in page['items']])
        self.assertEqual(page['arrivals'], [{'root_id': roots[0], 'seq': self.sql(
            'SELECT seq FROM messages WHERE id=?', (roots[0],))[0][0]}])

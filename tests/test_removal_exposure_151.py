from __future__ import annotations

import json
from unittest import mock

from aim_next import store as store_module
from aim_next.contract import Refusal
import reader_fixture as fixtures
import test_message_removal_151 as removal_fixture
import test_topic_images as image_fixture


class ExposureCase(fixtures.ReaderCase):
    post = removal_fixture.RemovalCase.post
    remove = removal_fixture.RemovalCase.remove
    source_view = removal_fixture.RemovalCase.source_view
    ready = image_fixture.TopicImagesCase.ready

    def first(self, message):
        return self.sql('SELECT by FROM message_first_exposures WHERE message_id=?', (message,))

    def test_image_only_source_feed_gallery_and_media_descriptor_record_first_fetch(self):
        self.participation('other-reader', True)
        for number, route in enumerate(('source', 'topic_messages', 'topic_images', 'media')):
            with self.subTest(route=route):
                media = 'image-route-%s' % number
                self.ready(media, 'one.png')
                message = self.post(body='', attachments=[{'id': media}])
                ref = {'kind': 'message', 'id': message}
                args = {'source_ref': ref} if route == 'source' else {'topic_id': 't1'}
                if route == 'media':
                    args = {'media_id': media, 'source_ref': ref}
                result = self.store.view('other-reader', route, args)
                self.assertNotIn('error', result, result)
                self.assertEqual(self.first(message), [('other-reader',)], route)
                self.rejected(self.remove(message), 'MESSAGE_SEEN')

    def test_raw_media_handover_records_before_return_and_unsend_first_refuses(self):
        self.participation('other-reader', True)
        self.ready('raw-image', 'one.png')
        message = self.post(body='', attachments=[{'id': 'raw-image'}])
        args = {'media_id': 'raw-image', 'source_ref': {'kind': 'message', 'id': message}}
        with self.store.open_media('other-reader', args) as resource:
            self.assertEqual(resource.descriptor['name'], 'one.png')
            self.assertEqual(self.first(message), [('other-reader',)])
        self.rejected(self.remove(message), 'MESSAGE_SEEN')
        self.ready('raw-unsent', 'one.png')
        unseen = self.post(body='', attachments=[{'id': 'raw-unsent'}])
        self.committed(self.remove(unseen))
        with self.assertRaises(Refusal) as refusal:
            self.store.open_media('other-reader', {'media_id': 'raw-unsent', 'source_ref': {'kind': 'message', 'id': unseen}})
        self.assertEqual(refusal.exception.code, 'FORBIDDEN')
        self.assertEqual(self.first(unseen), [])

    def test_second_agent_records_legacy_revision_in_one_write_then_rereads_without_write(self):
        message = self.post()
        self.source_view(message, 'agent-a')
        self.assertEqual(self.first(message), [('agent-a',)])
        statements = []
        connect_before = store_module._connect
        def connect(*args, **kwargs):
            db, runtime = connect_before(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, runtime
        with mock.patch.object(store_module, '_connect', connect):
            self.assertNotIn('error', self.source_view(message, 'agent-b'))
        self.assertEqual(statements.count('BEGIN IMMEDIATE'), 1)
        self.assertEqual(statements.count('COMMIT'), 1)
        self.assertEqual(self.first(message), [('agent-a',)])
        self.assertEqual(self.sql('SELECT actor_id,revision FROM message_exposures WHERE message_id=? ORDER BY actor_id', (message,)), [('agent-a', 1), ('agent-b', 1)])
        statements.clear()
        with mock.patch.object(store_module, '_connect', connect):
            self.source_view(message, 'agent-b')
        self.assertNotIn('BEGIN IMMEDIATE', statements)
        self.assertNotIn('COMMIT', statements)
        self.committed(self.command('message.edit', {'body': 'Corrected words'}, target={'message_id': message}, expected={'message_revision': 1}))
        self.assertEqual(self.sql("SELECT d.recipient_id FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.message_id=? AND g.kind='correction' ORDER BY d.recipient_id", (message,)), [('agent-a',), ('agent-b',)])

    def test_human_unsend_between_read_phases_loses_no_exposed_words(self):
        self.participation('other-reader', True)
        message = self.post()
        seam = []
        def unsend():
            seam.append(self.committed(self.remove(message)))
        result = self.store._view('other-reader', 'source', {'source_ref': {'kind': 'message', 'id': message}}, between=unsend)
        self.assertEqual(len(seam), 1)
        self.assertEqual(result['error']['code'], 'FORBIDDEN')
        self.assertNotIn('Removal fixture exact words', json.dumps(result))
        self.assertEqual(self.first(message), [])

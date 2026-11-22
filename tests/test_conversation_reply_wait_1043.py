from __future__ import annotations

"""The shared reply-wait projection, against actual isolated Conversation facts."""

import sqlite3
import unittest
from unittest import mock

from test_conversation import ConversationCase as _ConversationCase


class ConversationReplyWait1043Case(unittest.TestCase):
    def setUp(self):
        self.case = _ConversationCase()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)

    def ask(self, **args):
        return self.case.posted('Please check this.', intent='ask', addressees=['agent-a'], **args)

    def read(self, message, actor='owner'):
        return self.case.page(actor)[message]

    def test_actual_agent_delivery_starts_the_same_wait_in_both_kinds(self):
        conversation = self.ask()
        topic = self.ask(topic='t1')
        for message in [conversation, topic]:
            with self.subTest(message=message):
                self.assertTrue(self.case.sql("SELECT 1 FROM deliveries WHERE message_id=? AND recipient_id='agent-a' AND revision=1", (message,)))
                self.assertTrue(self.read(message)['awaiting_reply'] if message == conversation else
                                next(x for x in self.case.store.view('owner', 'topic_messages', {'topic_id': 't1'})['items'] if x['id'] == message)['awaiting_reply'])
        self.assertFalse(self.read(conversation)['no_agent_notified'])
        self.assertFalse(self.read(conversation, 'agent-a')['awaiting_reply'], 'another reader never waits on this own-message mark')

    def test_own_followup_and_unrelated_agent_post_do_not_end_the_wait(self):
        asked = self.ask()
        again = self.case.posted('And this too.', reply_to=asked)
        self.case.posted('Unrelated progress.', actor='agent-b')
        self.assertTrue(self.read(asked)['awaiting_reply'])
        self.assertTrue(self.read(again)['awaiting_reply'])
        self.case.posted('Checked.', actor='agent-a', reply_to=asked)
        self.assertFalse(self.read(asked)['awaiting_reply'])
        self.assertFalse(self.read(again)['awaiting_reply'])

    def test_a_visible_human_reply_also_ends_the_wait(self):
        c = self.case
        c.committed(c.command('workspace.member_set', {'actor_id': 'other-reader', 'present': True},
                              target={'workspace_id': 'w1'}, expected={'workspace_revision': c.versions()[0]}))
        asked = self.ask()
        self.assertTrue(self.read(asked)['awaiting_reply'])
        c.posted('I checked it.', actor='other-reader', reply_to=asked)
        self.assertFalse(self.read(asked)['awaiting_reply'])

    def test_public_tell_naming_the_reader_ends_the_wait(self):
        asked = self.ask()
        self.assertTrue(self.read(asked)['awaiting_reply'])
        self.case.posted('The answer is ready.', actor='agent-b', intent='tell', addressees=['owner'])
        self.assertFalse(self.read(asked)['awaiting_reply'])

    def test_agent_thumb_taken_back_still_counts_as_the_first_answer(self):
        c = self.case
        asked = self.ask()
        self.assertTrue(self.read(asked)['awaiting_reply'])
        for revision, on in [(0, True), (1, False)]:
            c.committed(c.command('message.thumb', {'thumbed': on}, target={'message_id': asked},
                                  expected={'thumb_revision': revision}, actor='agent-a'))
            self.assertFalse(self.read(asked)['awaiting_reply'])

    def test_whispers_neither_wait_publicly_nor_answer_the_public_ask(self):
        c = self.case
        asked = self.ask()
        secret = c.posted('Private question.', whisper=True, addressees=['agent-a'])
        c.posted('Private answer.', actor='agent-a', whisper=True, addressees=['owner'], reply_to=secret)
        self.assertFalse(self.read(secret)['awaiting_reply'])
        self.assertFalse(self.read(secret)['no_agent_notified'])
        self.assertTrue(self.read(asked)['awaiting_reply'])
        self.assertNotIn(secret, c.page('agent-b'), 'public eligibility must not expose a whisper')

    def test_unwatched_follows_actual_recipients_not_outcome_agent_membership(self):
        c = self.case
        c.committed(c.command('workspace.coordinator_set', {'actor_id': None}, target={'workspace_id': 'w1'},
                              expected={'workspace_revision': c.versions()[0]}))
        alone = c.posted('A note without an agent recipient.')
        self.assertEqual(c.sql("SELECT d.recipient_id FROM deliveries d JOIN actors a ON a.id=d.recipient_id WHERE d.message_id=? AND a.kind='agent'", (alone,)), [])
        self.assertEqual((self.read(alone)['awaiting_reply'], self.read(alone)['no_agent_notified']), (False, True))
        named = self.ask()
        self.assertTrue(c.sql("SELECT 1 FROM deliveries WHERE message_id=? AND recipient_id='agent-a' AND revision=1", (named,)))
        self.assertEqual((self.read(named)['awaiting_reply'], self.read(named)['no_agent_notified']), (True, False))

    def test_existing_start_boundary_applies_without_writing_new_facts(self):
        c = self.case
        old = self.ask()
        seq = c.sql('SELECT seq FROM messages WHERE id=?', (old,))[0][0]
        c.sql("UPDATE metadata SET value=? WHERE key='reply_wait_from_seq.597'", (str(seq + 1),))
        self.assertEqual((self.read(old)['awaiting_reply'], self.read(old)['no_agent_notified']), (False, False))
        new = self.ask()
        before = c.records_beside_exposures()
        self.assertTrue(self.read(new)['awaiting_reply'])
        self.assertEqual(c.records_beside_exposures(), before, 'only the established exposure side effect is excluded')

    def test_reply_link_still_answers_after_joining_the_reply_elsewhere(self):
        c = self.case
        other = c.posted('Separate subject.', actor='agent-b')
        asked = self.ask()
        self.assertTrue(self.read(asked)['awaiting_reply'])
        reply = c.posted('Checked.', actor='agent-a', reply_to=asked)
        c.committed(c.command('stack.join', {'into': other}, target={'message_id': reply}, expected={'join_revision': 0}))
        page = c.page()
        self.assertNotEqual(page[asked]['stack_position']['root_id'], page[reply]['stack_position']['root_id'])
        self.assertFalse(page[asked]['awaiting_reply'])

    def test_bounded_named_read_does_not_scan_later_conversation_history(self):
        c = self.case
        c.posted('Earlier agent activity.', actor='agent-a')
        asked = self.ask()
        seq = c.sql('SELECT seq FROM messages WHERE id=?', (asked,))[0][0]

        def measured():
            original, steps = sqlite3.connect, [0]
            def connect(*args, **kwargs):
                db = original(*args, **kwargs)
                db.set_progress_handler(lambda: steps.__setitem__(0, steps[0] + 1) or 0, 1)
                return db
            with mock.patch.object(sqlite3, 'connect', connect):
                answer = c.store.view('owner', 'topic_messages', {'topic_id': c.conversation, 'direction': 'before', 'cursor': seq + 1, 'limit': 1})
            self.assertEqual([(x['id'], x['awaiting_reply']) for x in answer['items']], [(asked, True)])
            return steps[0]

        before = measured()
        with sqlite3.connect(str(c.path)) as db:
            for i in range(3000):
                row = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) VALUES (?,?,'owner','Later','[]','[]','[\"owner\"]',?)",
                                 ('activity-later-%s' % i, c.conversation, 'activity-op-%s' % i)).lastrowid
                db.execute('INSERT INTO message_addressees VALUES (?,?,?)', (c.conversation, 'owner', row))
        grown = measured()
        self.assertLess(grown, before + 300, (before, grown))


if __name__ == '__main__':
    unittest.main()

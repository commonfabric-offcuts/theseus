from __future__ import annotations

import reader_fixture as fixtures
import test_answer_delivery_625 as answers
import test_message_removal_151 as removal


class Composition151(fixtures.ReaderCase):
    post = answers.AnswerDelivery625.post
    ask = answers.AnswerDelivery625.ask
    thumb = answers.AnswerDelivery625.thumb
    inbox = answers.AnswerDelivery625.inbox
    ack = answers.AnswerDelivery625.ack
    remove = removal.RemovalCase.remove

    def test_removing_answer_does_not_revive_resolved_question_in_topic_or_conversation(self):
        conversation = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        for topic in ['t1', conversation]:
            with self.subTest(topic=topic):
                question = self.ask(topic=topic)
                answer = self.committed(self.post(actor='owner', parent=question, ask=False, topic=topic))['message_id']
                self.committed(self.command('message.resolve', target={'message_id': question}, actor='agent-a'))
                closure = self.sql('SELECT * FROM question_closures WHERE message_id=?', (question,))
                self.committed(self.remove(answer, 'retract'))
                self.assertEqual(self.sql('SELECT * FROM question_closures WHERE message_id=?', (question,)), closure)
                self.assertEqual(self.sql('SELECT * FROM conversation_waits WHERE ask_id=?', (question,)), [])
                self.assertFalse(self.sql('SELECT 1 FROM topic_waiting WHERE ask_message_id=?', (question,)))
                self.assertFalse(self.sql('SELECT 1 FROM ask_cover_links WHERE ask_id=? AND active=1', (question,)))

    def test_answer_and_retraction_deliveries_keep_separate_identity_and_acknowledgment(self):
        question = self.ask()
        self.committed(self.thumb(question))
        receipt = next(x for x in self.inbox() if x.get('answer'))
        message = self.committed(self.post(actor='owner', ask=False))['message_id']
        self.source({'kind': 'message', 'id': message}, actor='agent-a')
        self.committed(self.remove(message, 'retract'))
        notice = next(x for x in self.inbox() if x.get('retraction'))
        self.assertNotEqual(receipt['id'], notice['id'])
        self.ack(notice)
        self.rejected(self.post(parent=question), 'ANSWER_UNREAD')
        self.assertTrue(any(x['id'] == receipt['id'] for x in self.inbox()))
        self.ack(receipt)
        self.committed(self.post(parent=question))

    def test_retracted_question_has_no_resolution_control_or_new_closure_act(self):
        question = self.committed(self.post(actor='owner', addressees=['agent-a']))['message_id']
        self.committed(self.remove(question, 'retract'))
        self.assertIsNone(self.source({'kind': 'message', 'id': question})['question'])
        result = self.command('message.resolve', target={'message_id': question})
        self.rejected(result, 'QUESTION_CLOSED')
        self.assertFalse(self.sql('SELECT 1 FROM question_closures WHERE message_id=?', (question,)))

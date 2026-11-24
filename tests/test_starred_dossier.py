from __future__ import annotations

import reader_fixture as fixtures
from tests.historical_fixture import post_fields


class StarredDossierCase(fixtures.ReaderCase):
    def post(self, words, actor='agent-a', **args):
        return self.committed(self.command('message.post', post_fields(self, actor, dict(body=words, **args)), target={'topic_id': 't1'}, actor=actor))['message_id']

    def position(self, mid, actor='owner'):
        answer = self.store.view(actor, 'stack_positions', {'topic_id': 't1', 'message_ids': [mid]})
        self.assertNotIn('error', answer, answer)
        return answer['items'][0]['stack_position']

    def join(self, mid, into, revision=0):
        self.committed(self.command('stack.join', {'into': into}, target={'message_id': mid}, expected={'join_revision': revision}, actor='owner'))

    def test_item_655_root_membership_distinguishes_singletons_replies_and_joined_stacks(self):
        root = self.post('First line')
        self.assertIs(self.position(root).get('has_other_messages'), False, 'an unloaded singleton keeps the topic title')
        reply = self.post('Reply', reply_to=root)
        self.assertIs(self.position(root).get('has_other_messages'), True, 'an unloaded root with replies uses its first line')
        self.assertIs(self.position(reply).get('has_other_messages'), True)
        other = self.post('Other')
        self.join(reply, other)
        self.assertIs(self.position(root).get('has_other_messages'), False, 'a reply joined elsewhere no longer names this singleton')
        self.assertIs(self.position(other).get('has_other_messages'), True, 'joined stacks count as a dossier too')
        self.join(reply, None, 1)
        self.assertIs(self.position(root).get('has_other_messages'), True)
        self.assertIs(self.position(other).get('has_other_messages'), False)

    def test_item_655_a_whisper_the_reader_cannot_see_does_not_make_a_dossier(self):
        root = self.post('Public first line')
        self.post('Private reply', actor='owner', reply_to=root, whisper=True, addressees=['agent-a'])
        self.assertIs(self.position(root, actor='agent-b').get('has_other_messages'), False)

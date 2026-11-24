from __future__ import annotations

from reader_fixture import ReaderCase


class CoverRecipient1206(ReaderCase):
    def setUp(self):
        super().setUp()
        self.participation('agent-b', True)
        self.root = self.post('First cover needed')

    def post(self, body, actor='owner', **args):
        if args.get('reply_to') and actor.startswith('agent-'):
            args.setdefault('reply_without_quote', 'Synthetic recipient selection case; no source passage needed')
        return self.committed(self.command('message.post', dict(body=body, **args),
                                          target={'topic_id': 't1'}, actor=actor))['message_id']

    def reply(self, actor, parent=None, **args):
        return self.post('Reply from ' + actor, actor=actor, reply_to=parent or self.root, **args)

    def ask(self, actor='owner', op=None, revision=None):
        if revision is None:
            revision = self.store.view(actor, 'dossier_cover', {'message_id': self.root})['cover_revision']
        return self.command('stack.cover_refresh', target={'message_id': self.root},
                            expected={'cover_revision': revision}, actor=actor, op=op)

    def recipient(self, **args):
        return self.committed(self.ask(**args))['refresh']['recipient']

    def test_latest_agent_reply_wins_over_coordinator_later_human_and_other_dossier(self):
        self.reply('agent-b')
        self.reply('owner')
        other = self.post('Another dossier')
        self.reply('agent-a', other)
        self.assertEqual(self.recipient(), 'agent-b')

    def test_latest_nested_agent_reply_is_selected(self):
        first = self.reply('agent-a')
        self.reply('agent-b', first)
        self.assertEqual(self.recipient(), 'agent-b')

    def test_agent_opening_without_an_agent_reply_keeps_coordinator_fallback(self):
        self.root = self.post('Agent opening', actor='agent-b')
        self.assertEqual(self.recipient(), 'agent-a')

    def test_no_agent_reply_keeps_existing_coordinator_fallback(self):
        self.reply('owner')
        self.assertEqual(self.recipient(), 'agent-a')

    def test_disabled_last_replier_keeps_existing_eligible_fallback(self):
        self.reply('agent-b')
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.assertEqual(self.recipient(), 'agent-a')

    def test_invisible_private_reply_does_not_change_the_default(self):
        self.reply('agent-b')
        self.participation('other-reader', True)
        private = self.post('Private question', actor='other-reader', reply_to=self.root,
                            addressees=['agent-a'], whisper=True)
        self.reply('agent-a', private, addressees=['other-reader'], whisper=True)
        self.assertEqual(self.recipient(), 'agent-b')

    def test_joined_dossier_agent_reply_counts_as_current_membership(self):
        other = self.post('Dossier to join')
        self.reply('agent-b', other)
        self.committed(self.command('stack.join', {'into': self.root}, target={'message_id': other},
                                    expected={'join_revision': 0}))
        self.assertEqual(self.recipient(), 'agent-b')

    def test_last_replier_cannot_create_a_self_delivery(self):
        self.reply('agent-b')
        before = self.sql('SELECT count(*) FROM refresh_requests')[0][0]
        self.rejected(self.ask(actor='agent-b'), 'COVER_WRITER_IS_YOU')
        self.assertEqual(self.sql('SELECT count(*) FROM refresh_requests')[0][0], before)

    def test_existing_written_cover_keeps_its_recorded_writer(self):
        self.committed(self.command('stack.cover', {'stands': 'Written cover'},
                                    target={'message_id': self.root}, expected={'cover_revision': 0}, actor='agent-a'))
        self.reply('agent-b')
        self.assertEqual(self.recipient(revision=1), 'agent-a')

    def test_exact_retry_and_pending_coalescing_keep_the_original_recipient(self):
        self.reply('agent-b')
        first = self.ask(op='cover1206-exact')
        self.assertEqual(self.committed(first)['refresh']['recipient'], 'agent-b')
        self.reply('agent-a')
        self.assertEqual(self.ask(op='cover1206-exact'), first)
        coalesced = self.committed(self.ask(op='cover1206-coalesced'))
        self.assertTrue(coalesced['coalesced'])
        self.assertEqual(coalesced['refresh'], first['result']['refresh'])

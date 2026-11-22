from __future__ import annotations

from unittest.mock import patch
from aim_next import reply_passages
from test_agent_reply_passages import ReplyPassageCase


class NoQuoteGlyph1025(ReplyPassageCase):
    def test_new_reason_keeps_exact_basis_and_quote_without_the_generated_heading(self):
        parent = self.parent()
        reason = "Whole assignment. 🪴"
        sent = self.committed(self.command('message.post',{'body':'Reply without a quote: these are my own words.\n','reply_to':parent,'reply_without_quote':reason},{'topic_id':'t1'},actor='agent-a'))
        source = self.store.view('owner','source',{'source_ref':{'kind':'message','id':sent['message_id']}})
        self.assertEqual(source['body'], '> Whole assignment. 🪴\n\nReply without a quote: these are my own words.\n')
        self.assertEqual(source['reply_basis']['reason'], reason)
        self.assertEqual(source['reply_basis'], sent['reply_basis'])
        self.assertEqual(source['quotes'], [])

    def test_legacy_reason_edit_keeps_the_recorded_prefix_and_durable_basis(self):
        parent = self.parent()
        legacy = 'Reply without a quote:\n\n> The whole assignment.\n\nMy answer\n'
        # Publish the historical wire format in this isolated fixture; leave the immutable row intact.
        select = reply_passages.select
        def legacy_select(source, snapshot):
            return {key:value for key,value in select(source,snapshot).items() if key != 'reason_format'}
        with patch('aim_next.reply_passages.select',side_effect=legacy_select):
            sent = self.committed(self.post(parent, reply_without_quote='The whole assignment.'))
        self.committed(self.command('message.edit',{'body':legacy+'Correction'}, {'message_id':sent['message_id']},{'message_revision':1},actor='agent-a'))
        source = self.store.view('owner','source',{'source_ref':{'kind':'message','id':sent['message_id']}})
        self.assertEqual(source['body'], legacy+'Correction')
        self.assertEqual(source['reply_basis'], sent['reply_basis'])
        refused = self.command('message.edit',{'body':'> The whole assignment.\n\nDifferent format'}, {'message_id':sent['message_id']},{'message_revision':2},actor='agent-a')
        self.assertEqual(refused['error']['code'],'REPLY_BASIS_REQUIRED')

    def test_headerless_reason_edit_keeps_reason_and_exact_own_prose(self):
        parent = self.parent()
        sent = self.committed(self.post(parent, reply_without_quote='Reason.'))
        body = '> Reason.\n\nMy answer\n'
        self.committed(self.command('message.edit',{'body':body+'Correction'}, {'message_id':sent['message_id']},{'message_revision':1},actor='agent-a'))
        self.assertEqual(self.sql('SELECT body FROM messages WHERE id=?',(sent['message_id'],)),[(body,)], 'the original row stays immutable')
        source = self.store.view('owner','source',{'source_ref':{'kind':'message','id':sent['message_id']}})
        self.assertEqual(source['body'],body+'Correction')
        refused = self.command('message.edit',{'body':'Correction only'}, {'message_id':sent['message_id']},{'message_revision':2},actor='agent-a')
        self.assertEqual(refused['error']['code'],'REPLY_BASIS_REQUIRED')

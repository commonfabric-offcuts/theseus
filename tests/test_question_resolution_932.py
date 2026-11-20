from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

import reader_fixture as fixtures


class QuestionResolution932(fixtures.ReaderCase):
    def ask(self, actor="agent-a", asked=None, topic="t1", **extra):
        asked = asked or ["owner"]
        args = dict(body="Question to keep unchanged?", addressees=asked, intent="ask", go_ahead=False)
        args.update(extra)
        people = [who for who in asked if who != actor and self.sql("SELECT kind FROM actors WHERE id=?", (who,))[0][0] == "human"]
        if people and self.sql("SELECT kind FROM actors WHERE id=?", (actor,))[0][0] == "agent":
            parent = args.get("reply_to")
            cover = self.store.view(actor, "dossier_cover", {"message_id": parent}) if parent else None
            args["ask_wait"] = {"root_id": cover["root_id"] if cover else None,
                "cover_revision": cover["cover_revision"] if cover else 0,
                "questions": [{"actor_id": who, "text": "Question?", "options": ["Yes", "No"], "default": "No", "reason": None} for who in people]}
        if args.get("reply_to") and actor.startswith("agent-"):
            args["reply_without_quote"] = "This question concerns the whole synthetic dossier"
        return self.committed(self.command("message.post", args, target={"topic_id": topic}, actor=actor))["message_id"]

    def waits(self):
        return self.sql("SELECT ask_message_id FROM topic_waiting WHERE actor_id='owner'")

    def question(self, message, actor="owner"):
        return self.source({"kind": "message", "id": message}, actor)["question"]

    def resolve(self, message, actor="agent-a", op=None):
        return self.command("message.resolve", target={"message_id": message}, actor=actor, op=op)

    def test_same_dossier_same_asker_same_set_supersedes_go_ahead_unanswered(self):
        first = self.ask(asked=["owner"], go_ahead=True)
        other = self.ask(asked=["owner"], go_ahead=True)
        second = self.ask(asked=["owner"], go_ahead=True, reply_to=first)
        closed = self.question(first)
        self.assertEqual((closed["state"], closed["superseded_by"], closed["waiting_on"]), ("superseded", second, []))
        self.assertEqual(self.question(other)["state"], "waiting")
        self.assertEqual(self.question(second)["waiting_on"], ["owner"])
        cover = self.store.view("owner", "dossier_cover", {"message_id": first})["cover"]
        self.assertEqual([w["ask_id"] for w in cover["waiting"]], [second])
        self.assertEqual(self.sql("SELECT * FROM message_reactions"), [])
        self.assertEqual(self.sql("SELECT * FROM message_withdrawals"), [])
        self.rejected(self.command("message.answer", {"answer": "yes"}, target={"message_id": first}, expected={"answer_revision": 0}), "QUESTION_CLOSED")

    def test_distinct_recipient_sets_and_askers_stay_separate(self):
        first = self.ask(asked=["owner", "agent-b"])
        second = self.ask(asked=["owner"], reply_to=first)
        third = self.ask(actor="agent-b", asked=["owner"], reply_to=first)
        for mid in [first, second, third]:
            self.assertEqual(self.question(mid)["state"], "waiting")

    def test_resolve_authority_retry_and_atomic_wait_removal_without_words(self):
        ask = self.ask(actor="agent-b", asked=["owner"], go_ahead=True)
        before = self.sql("SELECT * FROM messages"), self.sql("SELECT * FROM deliveries")
        self.rejected(self.resolve(ask, "owner"), "FORBIDDEN")
        self.rejected(self.resolve(ask, "outsider"), "FORBIDDEN")
        with mock.patch.object(self.store, "_change", side_effect=RuntimeError("rollback closure")):
            with self.assertRaisesRegex(RuntimeError, "rollback closure"):
                self.resolve(ask, op="resolve-once")
        self.assertEqual(self.question(ask)["state"], "waiting")
        receipt = self.resolve(ask, op="resolve-once")
        result = self.committed(receipt)
        self.assertEqual(result["question"]["state"], "resolved")
        self.assertEqual(result["question"]["by"], "agent-a")
        self.assertIsInstance(result["question"]["at_ms"], int)
        self.assertEqual(self.resolve(ask, op="resolve-once"), receipt)
        self.assertFalse(self.committed(self.resolve(ask))["changed"])
        self.assertEqual(self.sql("SELECT * FROM messages"), before[0])
        self.assertEqual(self.sql("SELECT * FROM deliveries"), before[1])
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.store.view("owner", "dossier_cover", {"message_id": ask})["cover"]["waiting"], [])
        self.assertEqual(self.sql("SELECT * FROM message_reactions"), [])
        with sqlite3.connect(str(self.path)) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("DELETE FROM question_closures")

    def test_plain_thumb_default_and_no_terminal_resurrection(self):
        ask = self.ask(asked=["owner"])
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask}, expected={"thumb_revision": 0}))
        self.assertEqual(self.question(ask)["state"], "answered")
        self.committed(self.command("message.thumb", {"thumbed": False}, target={"message_id": ask}, expected={"thumb_revision": 1}))
        self.assertEqual(self.question(ask)["state"], "waiting")
        self.committed(self.resolve(ask))
        for revision, thumb in [(2, True), (3, False)]:
            self.committed(self.command("message.thumb", {"thumbed": thumb}, target={"message_id": ask}, expected={"thumb_revision": revision}))
            self.assertEqual(self.question(ask)["state"], "resolved")
            self.assertEqual(self.waits(), [])

    def test_conversation_legacy_question_and_asker_resolution_preserve_other_wait(self):
        conversation = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        first = self.ask(actor='owner', asked=['agent-a'], topic=conversation)
        other = self.ask(actor='owner', asked=['agent-b'], topic=conversation, reply_to=first)
        newer = self.ask(actor='owner', asked=['agent-a'], topic=conversation, reply_to=first)
        self.assertEqual(self.question(first)['state'], 'superseded')
        before = self.sql('SELECT * FROM conversation_takes')
        self.committed(self.resolve(newer, 'owner'))
        self.assertEqual(self.question(newer)['state'], 'resolved')
        self.assertEqual(self.question(other)['waiting_on'], ['agent-b'])
        self.assertEqual(self.sql('SELECT ask_id FROM conversation_waits'), [(other,)])
        self.assertEqual(self.sql('SELECT * FROM conversation_takes'), before)

    def test_record_owned_target_cannot_resolve_or_be_superseded(self):
        revision = self.store.view('owner', 'outcome_checks', {'workspace_id': 'w1'})['relevant_versions']['checks']
        self.committed(self.command('target.propose', {'text': 'Initial target'}, target={'workspace_id': 'w1'}, expected={'target_revision': revision}, actor='agent-a'))
        revision = self.store.view('owner', 'outcome_checks', {'workspace_id': 'w1'})['relevant_versions']['checks']
        first = self.ask(asked=['owner'], go_ahead=True)
        self.committed(self.command('target.propose', {'text': 'Proposed target', 'ask_message_id': first}, target={'workspace_id': 'w1'}, expected={'target_revision': revision}, actor='agent-a'))
        records = self.sql('SELECT * FROM outcome_target_revisions')
        self.rejected(self.resolve(first), 'RECORD_OWNS_QUESTION')
        self.assertFalse(self.question(first, 'agent-a')['may_resolve'])
        self.ask(asked=['owner'], go_ahead=True, reply_to=first)
        self.assertEqual(self.question(first)['state'], 'waiting')
        self.assertEqual(self.sql('SELECT * FROM outcome_target_revisions'), records)

    def test_new_publication_and_supersession_rollback_together(self):
        first = self.ask(asked=['owner'])
        before = self.sql('SELECT * FROM messages'), self.sql('SELECT * FROM deliveries'), self.sql('SELECT * FROM message_acts')
        with mock.patch.object(self.store, '_link_ask_cover', side_effect=RuntimeError('after supersession')):
            with self.assertRaisesRegex(RuntimeError, 'after supersession'):
                self.ask(asked=['owner'], reply_to=first)
        self.assertEqual(self.question(first)['state'], 'waiting')
        self.assertEqual(self.sql('SELECT * FROM question_closures'), [])
        self.assertEqual(self.sql('SELECT * FROM messages'), before[0])
        self.assertEqual(self.sql('SELECT * FROM deliveries'), before[1])
        self.assertEqual(self.sql('SELECT * FROM message_acts'), before[2])

    def test_source_feed_delivery_and_attention_agree(self):
        ask = self.ask(asked=['owner'])
        self.committed(self.resolve(ask))
        source = self.question(ask)
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1'})
        delivery = self.store.view('owner', 'deliveries', {'limit': 25})
        self.assertEqual(next(i for i in page['items'] if i['id'] == ask)['question'], source)
        self.assertEqual(next(i for i in delivery['items'] if i['message_id'] == ask)['message']['question'], source)
        self.assertEqual(self.store.view('owner', 'attention', {})['waiting_on_me'], 0)

    def test_legacy_source_linked_manual_cover_is_cleared_with_its_question(self):
        ask = self.ask(actor='owner', asked=['agent-a'])
        cover = self.store.view('owner', 'dossier_cover', {'message_id': ask})
        self.committed(self.command('stack.cover', {'waiting': [{'text': 'Legacy question?', 'default': 'Wait', 'message_id': ask}]},
            target={'message_id': ask}, expected={'cover_revision': cover['cover_revision']}))
        self.committed(self.resolve(ask, 'owner'))
        cover = self.store.view('owner', 'dossier_cover', {'message_id': ask})['cover']
        self.assertFalse((cover or {}).get('waiting'))
        self.assertEqual(self.sql('SELECT * FROM cover_waiting WHERE message_id=?', (ask,)), [])

    def test_migration_keeps_old_waits_and_refuses_losing_closure(self):
        from aim_next.migrations import migrate
        from aim_next.store import SCHEMA_VERSION
        ask = self.ask(asked=['owner'])
        migrate(self.path, 'test-instance', self.binding, '56')
        self.assertEqual(migrate(self.path, 'test-instance', self.binding)['schema_version'], SCHEMA_VERSION)
        self.assertEqual(self.question(ask)['state'], 'waiting')
        self.committed(self.resolve(ask))
        with self.assertRaises(Exception) as refused:
            migrate(self.path, 'test-instance', self.binding, '56')
        self.assertIn('record', str(refused.exception).lower())

    def test_withdrawn_answered_and_closed_outcome_are_not_resolved(self):
        ask = self.ask(asked=['owner'])
        self.committed(self.command('message.withdraw', target={'message_id': ask}, actor='agent-a'))
        self.rejected(self.resolve(ask), 'QUESTION_CLOSED')
        another = self.ask(asked=['owner'])
        self.committed(self.command('message.post', {'body': 'Answer', 'reply_to': another}, target={'topic_id': 't1'}))
        self.rejected(self.resolve(another), 'QUESTION_CLOSED')
        last = self.ask(asked=['owner'])
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.end_set', {'state': 'archived'}, target={'workspace_id': 'w1'}, expected={'workspace_revision': revision}))
        self.rejected(self.resolve(last), 'OUTCOME_ARCHIVED')


if __name__ == "__main__":
    unittest.main()

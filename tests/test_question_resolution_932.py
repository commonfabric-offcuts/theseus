from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

import reader_fixture as fixtures


class QuestionResolution932(fixtures.ReaderCase):
    def ask(self, actor="agent-a", asked=None, topic="t1", return_receipt=False, **extra):
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
        result = self.committed(self.command("message.post", args, target={"topic_id": topic}, actor=actor))
        return result if return_receipt else result["message_id"]

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

    def archive(self, archived):
        version = self.sql("SELECT version FROM topics WHERE id='t1'")[0][0]
        self.committed(self.command('topic.update', {'archived': archived}, target={'topic_id': 't1'},
                                    expected={'topic_revision': version}))

    def test_reply_announces_the_exact_question_at_the_committed_topic_version(self):
        ask = self.ask(actor='owner', asked=['agent-a'])
        mark = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        result = self.committed(self.command('message.post', {'body': 'Answer', 'reply_to': ask,
            'reply_without_quote': 'Answering the complete synthetic question'}, target={'topic_id': 't1'}, actor='agent-a'))
        self.assertEqual(self.question(ask)['state'], 'answered')
        self.assertEqual(self.sql("SELECT version FROM changes WHERE seq>? AND scope_kind='actor' AND scope_id='owner' "
                                  "AND resource_kind='question' AND resource_id=?", (mark, ask)), [(result['topic']['version'],)])

    def test_superseding_post_touches_once_and_receipt_version_can_be_used_next(self):
        first = self.ask()
        before = self.sql("SELECT version FROM topics WHERE id='t1'")[0][0]
        mark = self.sql('SELECT coalesce(max(seq),0) FROM changes')[0][0]
        with mock.patch.object(self.store, '_touch_topic', wraps=self.store._touch_topic) as touched:
            receipt = self.ask(reply_to=first, return_receipt=True)
        self.assertEqual(touched.call_count, 1)
        # The topic change itself is the version a client receives and uses next.
        changes = self.sql("SELECT version FROM changes WHERE seq>? AND scope_kind='topic' AND scope_id='t1' "
                           "AND resource_kind='topic'", (mark,))
        self.assertEqual(changes, [(before + 1,)])
        self.assertEqual(receipt['topic']['version'], before + 1)
        self.assertEqual(self.sql("SELECT version FROM topics WHERE id='t1'"), changes)
        self.assertEqual(self.sql("SELECT DISTINCT version FROM changes WHERE seq>? AND resource_kind='waiting'", (mark,)), changes)
        self.committed(self.command('topic.update', {'state': 'active'}, target={'topic_id': 't1'}, expected={'topic_revision': receipt['topic']['version']}))

    def test_archived_question_can_resolve_without_restoring_a_wait(self):
        ask = self.ask()
        self.archive(True)
        before = self.sql('SELECT * FROM messages')
        result = self.committed(self.resolve(ask))
        self.assertEqual(result['question']['state'], 'resolved')
        self.assertTrue(result['question']['archived'])
        self.assertEqual(self.sql('SELECT * FROM messages'), before)
        self.archive(False)
        self.assertEqual(self.question(ask)['state'], 'resolved')
        self.assertEqual(self.waits(), [])

    def test_conversation_supersession_repairs_only_the_final_wait_set(self):
        conversation = self.store.view('owner', 'conversation', {'workspace_id': 'w1'})['conversation']['topic_id']
        first = self.ask(actor='owner', asked=['agent-a'], topic=conversation)
        seen = []
        repair = self.store._repair_conversation_waiting
        def observe(db, topic):
            seen.append([row[0] for row in db.execute('SELECT ask_id FROM conversation_waits')])
            return repair(db, topic)
        with mock.patch.object(self.store, '_repair_conversation_waiting', side_effect=observe):
            second = self.ask(actor='owner', asked=['agent-a'], topic=conversation, reply_to=first)
        self.assertEqual(seen, [[second]])
        self.assertEqual(self.store.view('owner', 'topic', {'topic_id': conversation})['topic']['state'], 'waiting')

    def test_touch_announces_the_stored_version_even_with_a_stale_caller_row(self):
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            topic = db.execute("SELECT * FROM topics WHERE id='t1'").fetchone()
            db.execute("UPDATE topics SET version=version+3 WHERE id='t1'")
            version = self.store._touch_topic(db, topic)
            self.assertEqual(version, topic['version'] + 4)
            self.assertEqual(db.execute("SELECT version FROM topics WHERE id='t1'").fetchone()[0], version)
            self.assertEqual(db.execute("SELECT version FROM changes WHERE scope_kind='topic' AND scope_id='t1' "
                                        "AND resource_kind='topic' ORDER BY seq DESC LIMIT 1").fetchone()[0], version)

    def test_archived_supersession_uses_closure_facts_and_hides_cover_waits(self):
        first = self.ask()
        self.archive(True)
        second = self.ask(reply_to=first)
        self.assertEqual(self.question(first)['state'], 'superseded')
        self.assertTrue(self.question(second)['archived'])
        self.assertEqual(self.store.view('owner', 'dossier_cover', {'message_id': first})['cover']['waiting'], [])
        self.archive(False)
        self.assertEqual(self.question(first)['state'], 'superseded')
        self.assertEqual(self.question(second)['state'], 'waiting')
        self.assertEqual([w['ask_id'] for w in self.store.view('owner', 'dossier_cover', {'message_id': first})['cover']['waiting']], [second])

    def check_closed_dossier_move(self, kind):
        self.committed(self.save_draft('move-draft', {'kind': 'new_topic', 'id': 'move-opening', 'workspace_id': 'w1'},
            't2', 'Destination', opening={'workspace_id': 'w1', 'title': 'Destination', 'participants': ['agent-a']}))
        self.committed(self.prepare('move-draft', 't2', submission='move-opening', send_op='open-destination'))
        self.committed(self.command('topic.create_and_send', {'submission_id': 'move-opening'}, target={'topic_id': 't2'}, op='open-destination'))
        unrelated = self.ask()
        root = self.ask()
        if kind == 'superseded':
            successor = self.ask(reply_to=root)
            self.committed(self.resolve(successor))
        elif kind == 'withdrawn':
            self.committed(self.command('message.withdraw', target={'message_id': root}, actor='agent-a'))
        else:
            self.committed(self.resolve(root))
        before = self.store.view('owner', 'attention', {})['waiting_on_me']
        self.assertEqual(before, 1)
        self.committed(self.command('stack.move', {'topic_id': 't2'}, target={'message_id': root},
            expected={'source_topic_id': 't1', 'move_revision': 0}, actor='agent-a'))
        self.assertEqual(self.question(root)['state'], kind)
        self.assertEqual(self.sql("SELECT topic_id,ask_message_id FROM topic_waiting WHERE actor_id='owner'"), [('t1', unrelated)])
        self.assertEqual(self.store.view('owner', 'attention', {})['waiting_on_me'], before)

    def test_move_resolved_dossier_does_not_recreate_wait(self):
        self.check_closed_dossier_move('resolved')

    def test_move_superseded_dossier_does_not_recreate_wait(self):
        self.check_closed_dossier_move('superseded')

    def test_move_withdrawn_dossier_does_not_recreate_wait(self):
        self.check_closed_dossier_move('withdrawn')

    def test_closure_eligibility_uses_facts_not_answered_presentation(self):
        ask = self.ask(asked=['owner'])
        self.committed(self.command('message.withdraw', target={'message_id': ask}, actor='agent-a'))
        self.rejected(self.resolve(ask), 'QUESTION_CLOSED')
        another = self.ask(asked=['owner'])
        self.committed(self.command('message.post', {'body': 'Answer', 'reply_to': another}, target={'topic_id': 't1'}))
        # 13527: answered is a waiting projection, not a closure record.
        self.assertEqual(self.question(another)['state'], 'answered')
        self.committed(self.resolve(another))
        self.assertEqual(self.question(another)['state'], 'resolved')
        last = self.ask(asked=['owner'])
        revision = self.store.view('owner', 'workspace', {'workspace_id': 'w1'})['workspace']['version']
        self.committed(self.command('outcome.end_set', {'state': 'archived'}, target={'workspace_id': 'w1'}, expected={'workspace_revision': revision}))
        self.rejected(self.resolve(last), 'OUTCOME_ARCHIVED')


if __name__ == "__main__":
    unittest.main()

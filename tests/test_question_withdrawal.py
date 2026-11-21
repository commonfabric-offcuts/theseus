from __future__ import annotations

import json
import sqlite3
import unittest
from unittest import mock

from aim_next import store as store_module

import reader_fixture as fixtures


class WithdrawalCase(fixtures.ReaderCase):
    def ask(self, actor="agent-a", asked=None, topic="t1", **extra):
        asked = asked or ["owner", "agent-b"]
        args = dict(body="Exact question?\nKeep these words.", addressees=asked, intent="ask", go_ahead=False, **extra)
        people = [who for who in asked if who != actor and self.sql("SELECT kind FROM actors WHERE id=?", (who,))[0][0] == "human"]
        if people and self.sql("SELECT kind FROM actors WHERE id=?", (actor,))[0][0] == "agent":
            parent = args.get("reply_to")
            cover = self.store.view(actor, "dossier_cover", {"message_id": parent}) if parent else None
            args["ask_wait"] = {"root_id": cover["root_id"] if cover else None,
                "cover_revision": cover["cover_revision"] if cover else 0,
                "questions": [{"actor_id": who, "text": "Exact question?", "options": ["Keep", "Change"],
                               "default": "Keep", "reason": None} for who in people]}
        if args.get("reply_to") and actor.startswith("agent-"):
            args["reply_without_quote"] = "This question concerns the complete synthetic discussion"
        return self.committed(self.command("message.post", args, target={"topic_id": topic}, actor=actor))["message_id"]

    def withdraw(self, message, actor="agent-a", op=None):
        return self.command("message.withdraw", target={"message_id": message}, actor=actor, op=op)

    def waits(self, actor="owner"):
        return self.sql("SELECT topic_id,said,ask_message_id FROM topic_waiting WHERE actor_id=? ORDER BY topic_id", (actor,))

    def test_withdrawal_reads_no_words_and_records_exact_receipt_atomically(self):
        ask = self.ask()
        original_connect = store_module._connect
        reads, statements = [], []

        def connect(*args, **kwargs):
            db, runtime = original_connect(*args, **kwargs)
            def authorize(action, table, column, database, trigger):
                if action == sqlite3.SQLITE_READ:
                    reads.append((table, column))
                    if table in ("messages", "message_revisions") and column == "body":
                        return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK
            db.set_authorizer(authorize)
            db.set_trace_callback(statements.append)
            return db, runtime

        before = self.sql("SELECT * FROM deliveries ORDER BY seq")
        waits_before = self.waits()
        operations_before = self.sql("SELECT count(*) FROM operations")
        changes_before = self.sql("SELECT count(*) FROM changes")
        with mock.patch.object(self.store, "_change", side_effect=RuntimeError("injected before receipt commit")):
            with self.assertRaisesRegex(RuntimeError, "injected before receipt commit"):
                self.withdraw(ask, op="no-words-once")
        self.assertEqual(self.sql("SELECT * FROM message_withdrawals"), [])
        self.assertEqual(self.waits(), waits_before)
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), operations_before)
        self.assertEqual(self.sql("SELECT count(*) FROM changes"), changes_before)
        with mock.patch.object(store_module, "_connect", connect):
            receipt = self.withdraw(ask, op="no-words-once")
            result = self.committed(receipt)
            self.assertEqual(self.withdraw(ask, op="no-words-once"), receipt)
        self.assertEqual(set(result), {"message_id", "topic_id", "withdrawal", "changed"})
        self.assertEqual(result["message_id"], ask)
        self.assertEqual(result["topic_id"], "t1")
        self.assertIs(result["changed"], True)
        self.assertEqual(result["withdrawal"]["by"], "agent-a")
        self.assertIsInstance(result["withdrawal"]["at_ms"], int)
        self.assertEqual(self.sql("SELECT outcome FROM operations WHERE actor_id='agent-a' AND id='no-words-once'"),
                         [(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")),)])
        self.assertEqual(self.sql("SELECT message_id,by,at_ms FROM message_withdrawals"),
                         [(ask, "agent-a", result["withdrawal"]["at_ms"])])
        self.assertEqual(self.sql("SELECT * FROM deliveries ORDER BY seq"), before)
        self.assertEqual(self.waits(), [])
        self.assertNotIn(("messages", "body"), reads)
        self.assertNotIn(("message_revisions", "body"), reads)
        start = statements.index("BEGIN IMMEDIATE")
        end = statements.index("COMMIT", start)
        transaction = statements[start:end]
        for fragment in ("INSERT INTO message_withdrawals", "DELETE FROM topic_waiting", "INSERT INTO operations", "INSERT INTO changes"):
            self.assertTrue(any(fragment in sql for sql in transaction), fragment)

    def test_exact_ask_only_words_and_deliveries_stay_and_views_agree(self):
        first, second = self.ask(), self.ask()
        messages, deliveries = self.sql("SELECT * FROM messages"), self.sql("SELECT * FROM deliveries")
        receipt = self.withdraw(first, op="withdraw-once")
        result = self.committed(receipt)
        self.assertEqual(self.waits(), [("t1", 0, second)])
        self.assertEqual(self.waits("agent-b"), [("t1", 0, second)])
        self.assertEqual(self.sql("SELECT * FROM messages"), messages)
        self.assertEqual(self.sql("SELECT * FROM deliveries"), deliveries)
        self.assertEqual(self.source({"kind": "message", "id": first})["withdrawal"], result["withdrawal"])
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1"})
        self.assertEqual(next(x for x in page["items"] if x["id"] == first)["withdrawal"], result["withdrawal"])
        count = self.sql("SELECT count(*) FROM changes")
        self.assertEqual(self.withdraw(first, op="withdraw-once"), receipt)
        self.assertFalse(self.committed(self.withdraw(first))["changed"])
        self.assertEqual(self.sql("SELECT count(*) FROM changes"), count)
        self.committed(self.withdraw(second))
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 0)

    def test_only_asker_even_owner_coordinator_and_private_unknown_are_identical(self):
        ask = self.ask(actor="agent-b")
        for actor in ("owner", "agent-a"):
            self.rejected(self.withdraw(ask, actor), "FORBIDDEN")
        private = self.committed(self.command("message.post", {"body": "Private", "addressees": ["agent-a"],
            "whisper": True}, target={"topic_id": "t1"}))["message_id"]
        hidden = self.withdraw(private, "agent-b")
        unknown = self.withdraw("not-a-message", "agent-b")
        self.assertEqual(hidden["error"], unknown["error"])
        self.rejected(self.withdraw(ask, "outsider"), "FORBIDDEN")
        self.committed(self.withdraw(ask, "agent-b"))
        human = self.ask(actor="owner", asked=["agent-a"])
        self.committed(self.withdraw(human, "owner"))

    def test_non_head_withdrawal_never_resurrects_and_said_wait_stays(self):
        first, second, third = self.ask(), self.ask(), self.ask()
        self.committed(self.withdraw(second))
        self.committed(self.withdraw(first))
        self.assertEqual(self.waits(), [("t1", 0, third)])
        revision = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]},
            target={"topic_id": "t1"}, expected={"topic_revision": revision}))
        self.committed(self.withdraw(third))
        self.assertEqual(self.waits(), [("t1", 1, None)])
        for on in (True, False):
            self.committed(self.command("message.thumb", {"thumbed": on}, target={"message_id": first},
                expected={"thumb_revision": 0 if on else 1}))
        self.assertEqual(self.waits(), [("t1", 1, None)])

    def test_answer_race_and_tell_refusal_keep_recorded_results(self):
        ask = self.ask()
        self.committed(self.command("message.post", {"body": "Answer", "reply_to": ask}, target={"topic_id": "t1"}))
        self.committed(self.withdraw(ask))
        self.assertEqual(self.waits(), [])
        tell = self.committed(self.command("message.post", {"body": "Tell"}, target={"topic_id": "t1"}, actor="agent-a"))["message_id"]
        self.rejected(self.withdraw(tell), "NOT_A_QUESTION")
        self.rejected(self.command("message.withdraw", {"body": "replace"}, target={"message_id": ask}, actor="agent-a"), "INVALID_ARGUMENT")
        self.rejected(self.command("message.withdraw", target={"message_id": tell}, actor="agent-a", op="conflict"), "NOT_A_QUESTION")
        self.rejected(self.withdraw(ask, op="conflict"), "OPERATION_PAYLOAD_MISMATCH")

    def test_cover_and_unrelated_dossier_question_remain_and_notifications_are_scoped(self):
        root = self.ask()
        self.committed(self.command("message.post", {"body": "A reply", "reply_to": root}, target={"topic_id": "t1"}))
        self.committed(self.command("stack.cover", {"waiting": [{"text": "Cover decision?", "default": "Keep waiting"}]},
            target={"message_id": root}, expected={"cover_revision": self.store.view("owner", "dossier_cover", {"message_id": root})["cover_revision"]}, actor="agent-a"))
        other = self.ask(actor="agent-b", asked=["owner"])
        cover = self.store.view("owner", "dossier_cover", {"message_id": root})
        changes = self.sql("SELECT coalesce(max(seq),0) FROM changes")[0][0]
        self.committed(self.withdraw(root))
        self.assertEqual(self.store.view("owner", "dossier_cover", {"message_id": root}), cover)
        self.assertEqual(self.waits(), [("t1", 0, other)])
        self.assertEqual(self.source({"kind": "message", "id": other})["withdrawal"], None)
        changed = self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id FROM changes WHERE seq>?", (changes,))
        self.assertEqual({x[1] for x in changed if x[2] == "withdrawal"}, {"owner", "agent-a", "agent-b"})
        self.assertNotIn("outsider", {x[1] for x in changed})
        self.assertEqual({x[1] for x in changed if x[2] == "waiting"}, {"owner", "agent-b"})

    def test_held_target_ask_withdrawal_does_not_settle_record_or_lose_other_question(self):
        revision = self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["relevant_versions"]["checks"]
        self.committed(self.command("target.propose", {"text": "Initial target"}, target={"workspace_id": "w1"},
            expected={"target_revision": revision}, actor="agent-a"))
        revision = self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["relevant_versions"]["checks"]
        existing = self.ask(asked=["owner"])
        proposed = self.committed(self.command("target.propose", {"text": "Proposed target", "ask_message_id": existing},
            target={"workspace_id": "w1"}, expected={"target_revision": revision}, actor="agent-a"))
        ask = proposed["ask_message_id"]
        later = self.ask(actor="agent-b", asked=["owner"])
        records = self.sql("SELECT * FROM outcome_target_revisions")
        self.committed(self.withdraw(ask))
        self.assertEqual(self.sql("SELECT * FROM outcome_target_revisions"), records)
        self.assertEqual(self.waits(), [("t1", 0, later)])
        # The exact reply answers the later linked question; the withdrawn held ask cannot pin it again.
        self.committed(self.command("message.post", {"body": "Public answer", "reply_to": later}, target={"topic_id": "t1"}))
        self.assertEqual(self.waits(), [])

    def test_withdrawal_then_reply_and_unthumb_in_conversation_cannot_reopen_it(self):
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        ask = self.ask(topic=conversation)
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask}, expected={"thumb_revision": 0}))
        self.committed(self.withdraw(ask))
        self.committed(self.command("message.thumb", {"thumbed": False}, target={"message_id": ask}, expected={"thumb_revision": 1}))
        self.assertEqual(self.sql("SELECT * FROM conversation_waits WHERE ask_id=?", (ask,)), [])
        self.committed(self.command("message.post", {"body": "Answer remains allowed", "reply_to": ask}, target={"topic_id": conversation}))
        self.assertEqual(self.sql("SELECT * FROM conversation_waits WHERE ask_id=?", (ask,)), [])
        self.assertIsNotNone(self.source({"kind": "message", "id": ask})["withdrawal"])

    def test_blocking_question_clears_from_light_and_attention_while_other_ask_waits(self):
        self.committed(self.command("pipeline.configure", {"enabled": True}, target={"workspace_id": "w1"}, expected={"pipeline_revision": 0}))
        number = self.committed(self.command("pipeline.item_add", {"title": "Synthetic work", "section": "now", "size": "small", "sources": [{"note": "fixture"}]},
            target={"workspace_id": "w1"}))["number"]
        revision = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pipeline"]["version"]
        self.committed(self.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}]},
            target={"workspace_id": "w1"}, expected={"pipeline_revision": revision}))
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": [number], "topic_id": "t1", "stage_id": "build"}, target={"workspace_id": "w1"}))["piece_id"]
        ask = self.ask(blocks={"kind": "piece", "ref": piece})
        other = self.ask()
        self.assertEqual([x["message_id"] for x in self.store.view("owner", "attention", {})["blocking"]], [ask])
        self.committed(self.withdraw(ask))
        self.assertEqual(self.store.view("owner", "attention", {})["blocking"], [])
        light = self.store.view("owner", "outcome_light", {"workspace_id": "w1"})
        self.assertNotIn(ask, json.dumps(light))
        self.assertEqual(self.waits(), [("t1", 0, other)])

    def test_cli_verb_uses_same_real_core_and_explicit_operation_without_reading_profile(self):
        from types import SimpleNamespace
        from aim_next.cli import Agent, _parser
        ask = self.ask()
        options = _parser().parse_args(["--profile", "synthetic-unused-path", "withdraw", ask, "--operation", "synthetic-withdraw"])
        lines = []
        def command(kind, target, args, operation=None):
            return self.committed(self.command(kind, args, target=target, actor="agent-a", op=operation))
        adapter = SimpleNamespace(options=options, command=command, operation_of=lambda: options.operation, out=SimpleNamespace(plain=lines.append))
        Agent.do_withdraw(adapter)
        self.assertEqual(lines, ["Question withdrawn: " + ask])
        self.assertEqual(self.waits(), [])
        self.assertEqual(self.sql("SELECT id FROM operations WHERE kind='message.withdraw'"), [("synthetic-withdraw",)])

    def test_explicit_migration_and_immutable_history_and_closed_outcome(self):
        from aim_next.migrations import migrate
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "54")["schema_version"], "54")
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], store_module.SCHEMA_VERSION)
        ask = self.ask()
        self.committed(self.withdraw(ask))
        with sqlite3.connect(str(self.path)) as db:
            for statement in ("UPDATE message_withdrawals SET at_ms=0", "DELETE FROM message_withdrawals"):
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(statement)
        with self.assertRaises(Exception) as refused:
            migrate(self.path, "test-instance", self.binding, "54")
        self.assertIn("record", str(refused.exception).lower())
        later = self.ask()
        revision = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, target={"workspace_id": "w1"}, expected={"workspace_revision": revision}))
        self.rejected(self.withdraw(later), "OUTCOME_ARCHIVED")

    def test_conversation_keeps_other_questions_and_items_without_fabricated_take(self):
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        first, second = self.ask(topic=conversation), self.ask(topic=conversation)
        items, takes = self.sql("SELECT * FROM conversation_items"), self.sql("SELECT * FROM conversation_takes")
        self.committed(self.withdraw(second))
        waits = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["waits"]
        self.assertEqual({x["ask_message_id"] for x in waits}, {first})
        self.committed(self.withdraw(first))
        self.assertEqual(self.sql("SELECT * FROM conversation_waits"), [])
        self.assertEqual(self.sql("SELECT * FROM conversation_items"), items)
        self.assertEqual(self.sql("SELECT * FROM conversation_takes"), takes)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Item 738: real publication, authorization, durable intent and cover boundaries.

Only invented actors and a temporary Store; no profiles, server or agent process.
"""
import json
import os
from pathlib import Path
import sqlite3

from aim_next import Store
from aim_next.store import SCHEMA_VERSION
from aim_next.contract import StoreError
from aim_next.migrations import migrate, MigrationError
from reader_fixture import ReaderCase


class CoverRefreshCase(ReaderCase):
    def setUp(self):
        self.raw_receipts = []
        super().setUp()
        self.participation("agent-b", True)
        self.root = self.post("Which cabin weekend?")
        self.answer = self.post("The lake opens in May", actor="agent-b", reply_to=self.root)
        self.written = self.write({"stands": "Road checked", "waiting": [{"text": "Book?", "default": "Friday"}],
                                   "payload": {"text": "May", "message_id": self.answer,
                                               "kind": "answer", "link": "https://example.test/cabin"}})

    def command(self, *args, **kwargs):
        receipt = ReaderCase.command(self, *args, **kwargs)
        self.raw_receipts.append(receipt)
        return receipt

    def tearDown(self):
        destination = os.environ.get("AIM_738_EVIDENCE")
        if destination:
            records = {table: self.sql("SELECT * FROM " + table + " ORDER BY rowid") for table in
                       ("messages", "message_acts", "deliveries", "delivery_reasons", "cover_writers", "recipient_schedule")}
            (Path(destination) / (self._testMethodName + ".json")).write_text(
                json.dumps({"receipts": self.raw_receipts, "records": records}, indent=2) + "\n")
        super().tearDown()

    def post(self, body, actor="owner", **args):
        return self.committed(self.command("message.post", dict(body=body, **args),
                                          target={"topic_id": "t1"}, actor=actor))["message_id"]

    def read(self, root=None, actor="owner"):
        return self.store.view(actor, "dossier_cover", {"message_id": root or self.root})

    def write(self, args, actor="agent-b", root=None):
        root = root or self.root
        return self.committed(self.command("stack.cover", args, target={"message_id": root},
                                          expected={"cover_revision": self.read(root, actor)["cover_revision"]}, actor=actor))

    def refresh(self, actor="owner", revision=None, root=None, op=None):
        return self.command("stack.cover_refresh", target={"message_id": root or self.root}, actor=actor,
                            expected={"cover_revision": self.read(root, actor)["cover_revision"] if revision is None else revision}, op=op)

    def pending(self):
        self.assertEqual(self.read()["refresh"]["state"], "pending")

    def counts(self):
        return {table: self.sql("SELECT count(*) FROM " + table)[0][0] for table in
                ("messages", "deliveries", "message_acts", "topic_participants")}

    def test_writer_publication_exact_retry_coalescing_and_reopen(self):
        before = self.read()["cover"]
        counts = self.counts()
        receipt = self.refresh(op="refresh-once")
        result = self.committed(receipt)
        pending = result["refresh"]
        self.assertEqual((pending["recipient"], pending["by"], pending["observed_revision"]), ("agent-b", "owner", 1))
        request = self.sql("SELECT author_id,addressees,reply_to,intent,private_to,body FROM messages WHERE id=?", (pending["request_message_id"],))[0]
        self.assertEqual(request[:5], ("owner", '["agent-b"]', self.root, "ask", None))
        self.assertIn("latest facts", request[5])
        self.assertEqual(self.sql("SELECT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id WHERE d.message_id=? AND r.reason='addressed'", (pending["request_message_id"],)), [("agent-b",)])
        self.assertEqual(self.refresh(op="refresh-once", revision=1), receipt)
        second = self.committed(self.refresh(actor="agent-a", revision=0))
        self.assertTrue(second["coalesced"])
        self.assertEqual(second["refresh"], pending)
        self.assertEqual({k: v for k, v in self.read()["cover"].items() if k not in ("refresh", "refresh_revision")},
                         {k: v for k, v in before.items() if k not in ("refresh", "refresh_revision")})
        after = self.counts()
        self.assertEqual(after["messages"], counts["messages"] + 1)
        self.assertEqual(after["topic_participants"], counts["topic_participants"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.read()["refresh"], pending)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "refresh-once"}), receipt)
        self.assertTrue(self.sql("SELECT 1 FROM recipient_schedule WHERE recipient_id='agent-b'"))

    def test_pending_survives_human_noop_owner_done_reply_and_ack(self):
        self.committed(self.refresh())
        self.write({"stands": "Human checked road"}, actor="owner")
        self.pending()
        unchanged = self.write({"stands": "Human checked road"})
        self.assertFalse(unchanged["changed"])
        self.pending()
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.answer}, expected={"thumb_revision": 0}))
        self.pending()
        self.assertEqual(self.read()["cover"]["payload"]["done"]["how"], "thumb")
        self.post("Read the request; still checking", actor="agent-b", reply_to=self.root)
        self.pending()
        deliveries = self.store.view("agent-b", "deliveries", {})["items"]
        for item in deliveries:
            self.committed(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-b"))
        self.pending()
        snapshot = self.records()
        for _ in range(3):
            self.read()
        self.assertEqual(self.records(), snapshot, "reading never completes, migrates or publishes")

    def test_real_changed_agent_cover_completes_atomically_and_preserves_payload(self):
        pending = self.committed(self.refresh())["refresh"]
        prior = self.read()["cover"]
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.answer}, expected={"thumb_revision": 0}))
        # Different eligible writer is allowed; completion and cover commit together.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER reject_completion BEFORE INSERT ON message_acts WHEN NEW.kind='cover_refresh' AND json_extract(NEW.value,'$.state')='completed' BEGIN SELECT RAISE(ABORT,'fixture completion rollback'); END")
        blocked = self.command("stack.cover", {"stands": "Road reopened"}, target={"message_id": self.root},
                               expected={"cover_revision": self.read()["cover_revision"]}, actor="agent-a")
        self.rejected(blocked, "INTERNAL_ERROR")
        self.assertFalse(blocked["recorded"])
        self.assertEqual(self.read()["cover"]["stands"], prior["stands"])
        self.pending()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER reject_completion")
        result = self.write({"stands": "Road reopened"}, actor="agent-a")
        done = self.read()
        self.assertEqual((done["refresh"]["state"], done["refresh"]["completed_by"], done["refresh"]["completed_revision"]), ("completed", "agent-a", result["cover_revision"]))
        self.assertEqual(done["refresh"]["request_message_id"], pending["request_message_id"])
        self.assertEqual(done["cover"]["waiting"], prior["waiting"])
        self.assertEqual({k: v for k, v in done["cover"]["payload"].items() if k != "done"}, {k: v for k, v in prior["payload"].items() if k != "done"})
        self.assertEqual(done["cover"]["payload"]["done"]["how"], "thumb")
        self.assertEqual([row[0] for row in self.sql("SELECT revision FROM message_acts WHERE message_id=? AND kind='cover_refresh' ORDER BY id", (self.root,))], [1, 2])
        self.rejected(self.refresh(revision=1), "REVISION_CONFLICT")
        self.rejected(self.command("stack.cover", {"payload": {"done": True}}, target={"message_id": self.root}, expected={"cover_revision": result["cover_revision"]}, actor="agent-a"), "DONE_BY_OWNER")

    def test_clear_is_not_completion_or_restoration(self):
        self.committed(self.refresh())
        self.write({"stands": None, "waiting": [], "payload": None})
        self.pending()
        self.assertIsNone(self.read()["cover"].get("stands"))
        self.assertIsNone(self.read()["cover"].get("payload"))
        self.write({"stands": "A genuinely new cover"})
        self.assertEqual(self.read()["refresh"]["state"], "completed")

    def test_configured_coordinator_only_no_human_or_arbitrary_fallback(self):
        self.write({"stands": "Human wrote the latest"}, actor="owner")
        self.assertEqual(self.committed(self.refresh())["refresh"]["recipient"], "agent-a")

    def test_disabled_writer_falls_back_without_route_or_membership_grant(self):
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        before = self.counts()
        self.assertEqual(self.committed(self.refresh())["refresh"]["recipient"], "agent-a")
        self.assertEqual(self.counts()["topic_participants"], before["topic_participants"])

    def test_missing_candidates_and_self_delivery_are_honest_refusals(self):
        before = self.counts()
        self.rejected(self.refresh(actor="agent-b"), "COVER_WRITER_IS_YOU")
        self.sql("UPDATE actors SET enabled=0 WHERE id IN ('agent-a','agent-b')")
        self.rejected(self.refresh(), "COVER_WRITER_UNAVAILABLE")
        self.assertEqual(self.counts(), before)
        self.assertIsNone(self.read()["refresh"])

    def test_stale_missing_nonroot_and_changed_retry_cannot_prompt(self):
        before = self.counts()
        self.rejected(self.refresh(revision=0), "REVISION_CONFLICT")
        self.rejected(self.refresh(root=self.answer, revision=1), "STACK_CHANGED")
        bare = self.post("No cover")
        count = self.counts()["messages"]
        self.rejected(self.refresh(root=bare, revision=0), "COVER_MISSING")
        self.assertEqual(self.counts()["messages"], count)
        receipt = self.refresh(op="bound-retry")
        self.committed(receipt)
        self.rejected(self.refresh(op="bound-retry", revision=0), "OPERATION_PAYLOAD_MISMATCH")
        envelope = self.envelope("stack.cover_refresh", {"message_id": bare}, {}, {"cover_revision": 0}, op="wrong-authority")
        envelope["expected"]["authority"]["authority_epoch"] = "different-epoch"
        self.rejected(self.store.command("owner", envelope), "AUTHORITY_CHANGED")
        self.assertEqual(self.counts()["messages"], before["messages"] + 2)

    def test_whisper_refresh_and_cover_never_escape_the_two_readers(self):
        root = self.post("Private cabin facts", addressees=["agent-b"], whisper=True)
        self.write({"stands": "Private cover"}, root=root)
        pending = self.committed(self.refresh(root=root))["refresh"]
        self.assertEqual(self.sql("SELECT private_to,intent,addressees FROM messages WHERE id=?", (pending["request_message_id"],)), [("agent-b", None, '["agent-b"]')])
        for who in ("agent-a", "outsider", "other-reader"):
            self.assertIn("error", self.read(root, who))
            page = self.store.view(who, "topic_messages", {"topic_id": "t1", "limit": 100})
            self.assertNotIn(pending["request_message_id"], [item["id"] for item in page.get("items", [])])
        self.assertEqual(self.sql("SELECT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id WHERE d.message_id=? AND r.reason='addressed'", (pending["request_message_id"],)), [("agent-b",)])

    def test_join_elsewhere_does_not_complete_old_root(self):
        self.committed(self.refresh())
        other = self.post("A different dossier")
        self.write({"stands": "Other cover"}, root=other)
        self.committed(self.command("stack.join", {"into": other}, target={"message_id": self.root}, expected={"join_revision": 0}))
        self.write({"stands": "Other updated"}, root=other)
        [value] = self.sql("SELECT value FROM message_acts WHERE message_id=? AND kind='cover_refresh' ORDER BY revision DESC LIMIT 1", (self.root,))
        self.assertEqual(json.loads(value[0])["state"], "pending")

    def test_publication_and_pending_intent_rollback_together(self):
        before = self.counts()
        schedules = self.sql("SELECT * FROM recipient_schedule ORDER BY recipient_id")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER refuse_refresh_intent BEFORE INSERT ON message_acts WHEN NEW.kind='cover_refresh' BEGIN SELECT RAISE(ABORT,'fixture pending rollback'); END")
        blocked = self.refresh(op="publish-rollback")
        self.rejected(blocked, "INTERNAL_ERROR")
        self.assertFalse(blocked["recorded"])
        self.assertEqual(self.counts(), before, "message, delivery and pending intent share a transaction")
        self.assertEqual(self.sql("SELECT * FROM recipient_schedule ORDER BY recipient_id"), schedules)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER refuse_refresh_intent")
        self.committed(self.refresh(op="publish-rollback"))
        self.pending()
        self.assertEqual(self.counts()["messages"], before["messages"] + 1)

    def test_unauthorized_and_closed_outcome_cannot_publish(self):
        before = self.counts()
        for actor in ("outsider", "other-reader"):
            r = self.command("stack.cover_refresh", target={"message_id": self.root}, expected={"cover_revision": 1}, actor=actor)
            self.rejected(r, "FORBIDDEN")
        self.assertEqual(self.counts(), before)
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.rejected(self.refresh(revision=1), "OUTCOME_ARCHIVED")
        self.assertEqual(self.counts(), before)

    def test_explicit_47_to_48_migration_preserves_history_and_actual_writer(self):
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.answer}, expected={"thumb_revision": 0}))
        acts = self.sql("SELECT * FROM message_acts ORDER BY id")
        messages = self.sql("SELECT * FROM messages ORDER BY seq")
        self.sql("DELETE FROM dossier_order")  # isolate refresh rollback; order refusal is tested separately
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "47")["schema_version"], "47")
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("47",)])
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "48")["schema_version"], "48")
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], SCHEMA_VERSION)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT * FROM message_acts ORDER BY id"), acts)
        self.assertEqual(self.sql("SELECT * FROM messages ORDER BY seq"), messages)
        self.assertEqual(self.sql("SELECT actor_id,revision FROM cover_writers WHERE message_id=?", (self.root,)), [("agent-b", 1)])
        self.assertEqual(self.committed(self.refresh())["refresh"]["recipient"], "agent-b")
        with self.assertRaises(MigrationError):
            migrate(self.path, "test-instance", self.binding, "47")
        self.pending()

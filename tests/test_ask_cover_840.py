from __future__ import annotations

import sqlite3

from aim_next import Store
from reader_fixture import ReaderCase


class AskCoverCase(ReaderCase):
    def setUp(self):
        super().setUp()
        self.participation("agent-b", True)
        self.root = self.post("A first cover is needed")

    def post(self, body, **args):
        return self.committed(self.command("message.post", dict(body=body, **args),
                                          target={"topic_id": "t1"}))["message_id"]

    def read(self, root=None, actor="owner"):
        return self.store.view(actor, "dossier_cover", {"message_id": root or self.root})

    def ask(self, root=None, actor="owner", revision=0, op=None):
        return self.command("stack.cover_refresh", target={"message_id": root or self.root},
                            expected={"cover_revision": revision}, actor=actor, op=op)

    def write(self, args, actor="agent-a"):
        return self.command("stack.cover", args, target={"message_id": self.root},
                            expected={"cover_revision": self.read()["cover_revision"]}, actor=actor)

    def counts(self):
        return {name: self.sql("SELECT count(*) FROM " + name)[0][0] for name in
                ("messages", "deliveries", "message_acts", "topic_participants")}

    def test_first_request_uses_configured_agent_and_never_invents_a_cover(self):
        before = self.counts()
        receipt = self.ask(op="first-cover")
        pending = self.committed(receipt)["refresh"]
        self.assertEqual((pending["recipient"], pending["observed_revision"]), ("agent-a", 0))
        row = self.sql("SELECT requester_id,message_id,kind,recipient_id,body FROM refresh_requests WHERE id=?",
                       (pending["request_id"],))[0]
        self.assertEqual(row[:4], ("owner", self.root, "cover_refresh", "agent-a"))
        self.assertIn("Please write this dossier's first cover", row[4])
        self.assertNotIn("rewrite", row[4])
        self.assertEqual(self.read()["cover_revision"], 0)
        self.assertIsNone(self.read()["cover"])
        self.assertEqual(self.read()["refresh"], pending)
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "limit": 100})
        root = next(item for item in page["items"] if item["id"] == self.root)
        self.assertIsNone(root["acts"]["cover"])
        self.assertIsNone(root["stack_position"]["cover"])
        self.assertEqual(root["acts"]["cover_refresh"], pending)
        self.assertEqual(self.ask(op="first-cover"), receipt)
        other = self.committed(self.ask(actor="agent-b", revision=99))
        self.assertTrue(other["coalesced"])
        self.assertEqual(other["refresh"], pending)
        self.assertEqual(self.counts()["messages"], before["messages"])
        self.assertEqual(self.counts()["topic_participants"], before["topic_participants"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.read()["refresh"], pending)
        self.assertIsNone(self.read()["cover"])
        self.assertTrue(self.sql("SELECT 1 FROM recipient_schedule WHERE recipient_id='agent-a'"))

    def test_only_changed_nonempty_agent_cover_completes_and_stale_repeat_refuses(self):
        pending = self.committed(self.ask())["refresh"]
        self.committed(self.write({"stands": None, "waiting": [], "payload": None}))
        self.assertEqual(self.read()["refresh"]["state"], "pending")
        self.committed(self.write({"stands": "Human first words"}, actor="owner"))
        self.assertEqual(self.read()["refresh"]["state"], "pending")
        noop = self.committed(self.write({"stands": "Human first words"}))
        self.assertFalse(noop["changed"])
        self.assertEqual(self.read()["refresh"]["state"], "pending")
        self.committed(self.write({"stands": "Agent checked the facts"}))
        now = self.read()
        self.assertEqual(now["refresh"]["state"], "completed")
        self.assertEqual(now["refresh"]["completed_by"], "agent-a")
        self.assertEqual(now["refresh"]["request_id"], pending["request_id"])
        self.assertEqual(now["cover"]["stands"], "Agent checked the facts")
        self.rejected(self.ask(), "REVISION_CONFLICT")

    def test_first_cover_and_completion_roll_back_together(self):
        self.committed(self.ask())
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER refuse_first_completion BEFORE INSERT ON message_acts WHEN NEW.kind='cover_refresh' AND json_extract(NEW.value,'$.state')='completed' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END")
        failed = self.write({"stands": "Agent cover"})
        self.rejected(failed, "INTERNAL_ERROR")
        self.assertFalse(failed["recorded"])
        self.assertIsNone(self.read()["cover"])
        self.assertEqual(self.read()["cover_revision"], 0)
        self.assertEqual(self.read()["refresh"]["state"], "pending")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER refuse_first_completion")
        self.committed(self.write({"stands": "Agent cover"}))
        self.assertEqual(self.read()["refresh"]["state"], "completed")

    def test_private_request_uses_only_an_eligible_coordinator_and_never_grants_reach(self):
        private = self.post("Private first cover", addressees=["agent-a"], whisper=True)
        pending = self.committed(self.ask(root=private))["refresh"]
        self.assertEqual(self.sql("SELECT requester_id,recipient_id,message_id FROM refresh_requests WHERE id=?",
                                 (pending["request_id"],)), [("owner", "agent-a", private)])
        for actor in ("agent-b", "outsider", "other-reader"):
            self.assertIn("error", self.read(private, actor))
            page = self.store.view(actor, "topic_messages", {"topic_id": "t1", "limit": 100})
            self.assertNotIn(pending["request_id"], [item["id"] for item in page.get("items", [])])
        unreachable = self.post("Private to a different agent", addressees=["agent-b"], whisper=True)
        before = self.counts()
        self.rejected(self.ask(root=unreachable), "COVER_WRITER_UNAVAILABLE")
        self.assertEqual(self.counts(), before)

    def test_revision_root_access_authority_and_self_fences_still_hold(self):
        before = self.counts()
        self.rejected(self.ask(revision=1), "REVISION_CONFLICT")
        self.rejected(self.ask(actor="agent-a"), "COVER_WRITER_IS_YOU")
        self.rejected(self.ask(actor="outsider"), "FORBIDDEN")
        wrong = self.envelope("stack.cover_refresh", {"message_id": self.root}, {}, {"cover_revision": 0})
        wrong["expected"]["authority"]["authority_epoch"] = "different"
        self.rejected(self.store.command("owner", wrong), "AUTHORITY_CHANGED")
        self.assertEqual(self.counts(), before)
        child = self.post("A reply", reply_to=self.root)
        before = self.counts()
        self.rejected(self.ask(root=child), "STACK_CHANGED")
        self.assertEqual(self.counts(), before)
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.rejected(self.ask(), "OUTCOME_ARCHIVED")
        self.assertEqual(self.counts(), before)

    def test_unavailable_default_and_request_rollback_publish_nothing(self):
        before = self.counts()
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        self.rejected(self.ask(), "COVER_WRITER_UNAVAILABLE")
        self.assertEqual(self.counts(), before)
        self.sql("UPDATE actors SET enabled=1 WHERE id='agent-a'")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER refuse_first_request BEFORE INSERT ON message_acts WHEN NEW.kind='cover_refresh' BEGIN SELECT RAISE(ABORT,'fixture request rollback'); END")
        failed = self.ask(op="first-rollback")
        self.rejected(failed, "INTERNAL_ERROR")
        self.assertFalse(failed["recorded"])
        self.assertEqual(self.counts(), before)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER refuse_first_request")
        self.committed(self.ask(op="first-rollback"))
        self.assertEqual(self.counts()["messages"], before["messages"])

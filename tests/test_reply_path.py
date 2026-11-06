from __future__ import annotations

from aim_next.contract import Refusal
from reader_fixture import ReaderCase
import test_media as media_fixtures


class ReplyPathCase(ReaderCase):
    begin = media_fixtures.MediaCase.begin
    publish = media_fixtures.MediaCase.publish
    ready = media_fixtures.MediaCase.ready
    open = media_fixtures.MediaCase.open
    read_all = media_fixtures.MediaCase.read_all

    def prepare_reply(self, addressees, actor="owner", source=None, topic="t1", opening=None):
        args = dict(source_ref=source or self.opening, topic_id=topic,
                    generation="gA", body="Exact A", attachments=[], quotes=[],
                    addressees=addressees, **({"intent": "tell"} if addressees else {}))
        if opening is not None:
            args["opening"] = opening
        self.committed(self.command("draft.save", args, target={"draft_id": "reply"},
                                    expected={"draft_revision": 0}, actor=actor))
        prepared = self.committed(self.command("submission.prepare", {
            "draft_id": "reply", "submission_id": "frozen", "send_operation_id": "send-A"},
            target={"topic_id": topic}, expected={"draft_revision": 1}, actor=actor))
        envelope = self.envelope("topic.create_and_send" if opening is not None else "message.send",
                                 {"topic_id": topic}, {"submission_id": "frozen"}, op="send-A")
        return envelope, prepared

    def state_without_receipts(self):
        names = self.sql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return {name: self.sql("SELECT * FROM " + name + " ORDER BY rowid")
                for (name,) in names if name not in ("metadata", "operations", "sqlite_sequence")}

    def refuse_unchanged(self, envelope):
        before = self.state_without_receipts()
        operations = self.sql("SELECT count(*) FROM operations")[0][0]
        receipt = self.store.command("owner", envelope)
        self.rejected(receipt, "REPLY_PATH_UNAVAILABLE")
        self.assertTrue(receipt["recorded"])
        self.assertEqual(self.state_without_receipts(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM operations")[0][0], operations + 1)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": envelope["operation_id"]}), receipt)
        self.assertEqual(self.store.command("owner", envelope), receipt)
        return receipt

    def test_single_outsider_refuses_without_public_or_private_effects(self):
        envelope, _ = self.prepare_reply(["outsider"])
        self.refuse_unchanged(envelope)

    def test_eligible_then_ineligible_refuses_every_recipient(self):
        envelope, _ = self.prepare_reply(["agent-a", "outsider"])
        self.refuse_unchanged(envelope)

    def test_refused_opening_rolls_back_topic_participants_and_changes(self):
        envelope, _ = self.prepare_reply(["agent-a", "outsider"], topic="private-topic",
            source={"kind": "new_topic", "id": "private-opening", "workspace_id": "w1"},
            opening={"workspace_id": "w1", "title": "Not public", "participants": ["agent-a"]})
        self.refuse_unchanged(envelope)
        self.assertEqual(self.sql("SELECT id FROM topics WHERE id='private-topic'"), [])

    def test_selected_opening_participant_has_reply_access_before_check(self):
        envelope, _ = self.prepare_reply(["outsider"], topic="new-topic",
            source={"kind": "new_topic", "id": "private-opening", "workspace_id": "w1"},
            opening={"workspace_id": "w1", "title": "Explicit membership", "participants": ["outsider"]})
        self.committed(self.store.command("owner", envelope))
        self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='new-topic' AND actor_id='outsider'"), [(1,)])
        self.assertEqual(self.sql("SELECT 1 FROM workspace_members WHERE actor_id='outsider'"), [])

    def test_refusal_retains_A_media_and_new_B_and_cannot_be_retried_into_success(self):
        self.ready()
        self.committed(self.command("draft.save", dict(source_ref=self.opening, topic_id="t1",
            generation="gA", body="Exact A", attachments=[{"id": "media-one"}],
            quotes=[{"source": self.opening, "excerpt": "Opening message"}], addressees=["outsider"], intent="tell"),
            target={"draft_id": "reply"}, expected={"draft_revision": 0}))
        prepared = self.committed(self.prepare("reply", "t1", submission="frozen", send_op="send-A"))
        next_draft = prepared["next_draft"]
        self.committed(self.save_draft("reply", self.opening, "t1", "Independent B", revision=2,
                                       generation=next_draft["generation"]))
        original = self.store.view("owner", "submission", {"submission_id": "frozen"})
        envelope = self.envelope("message.send", {"topic_id": "t1"}, {"submission_id": "frozen"}, op="send-A")
        receipt = self.refuse_unchanged(envelope)
        retained = self.store.view("owner", "submission", {"submission_id": "frozen"})
        self.assertEqual(retained, dict(original, send_receipt=receipt))
        self.assertEqual(self.store.view("owner", "editor_state", {
            "source_ref": self.opening, "topic_id": "t1"})["draft"]["body"], "Independent B")
        with self.open({"media_id": "media-one"}) as resource:
            self.assertEqual(self.read_all(resource), b"original bytes")
        for actor in ("agent-a", "outsider"):
            for args in ({"media_id": "media-one"}, {"media_id": "media-one", "source_ref": self.opening}):
                with self.subTest(actor=actor, args=args), self.assertRaises(Refusal) as error:
                    self.open(args, actor=actor)
                self.assertEqual(error.exception.code, "FORBIDDEN")
        self.committed(self.command("participation.set", {"actor_id": "outsider", "present": True}, target={"topic_id": "t1"}))
        before = self.records()
        self.assertEqual(self.store.command("owner", envelope), receipt)
        self.assertEqual(self.records(), before)

    def test_access_removed_after_prepare_refuses_but_workspace_access_still_works(self):
        self.committed(self.command("participation.set", {"actor_id": "outsider", "present": True}, target={"topic_id": "t1"}))
        envelope, _ = self.prepare_reply(["outsider"])
        self.committed(self.command("participation.set", {"actor_id": "outsider", "present": False}, target={"topic_id": "t1"}))
        self.refuse_unchanged(envelope)
        # A different source/draft act targets a removed participant who still
        # has independent workspace access. This must not become a blanket ban.
        self.committed(self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"}))
        self.committed(self.save_draft("second", {"kind": "new_topic", "id": "second", "workspace_id": "w1"}, "t2", "New topic",
            opening={"workspace_id": "w1", "title": "Second", "participants": []}))
        self.committed(self.prepare("second", "t2", submission="second", send_op="second-send"))
        opened = self.committed(self.command("topic.create_and_send", {"submission_id": "second"}, target={"topic_id": "t2"}, op="second-send"))
        self.committed(self.command("draft.save", dict(source_ref={"kind": "message", "id": opened["message_id"]}, topic_id="t2",
            generation="g", body="Request", addressees=["agent-a"], intent="tell"), target={"draft_id": "third"}, expected={"draft_revision": 0}))
        self.committed(self.prepare("third", "t2", submission="third", send_op="third-send"))
        self.committed(self.command("message.send", {"submission_id": "third"}, target={"topic_id": "t2"}, op="third-send"))

    def test_workspace_nonparticipant_can_reply_explicitly_without_enrollment(self):
        sent = self.send("Request", ["agent-b"])
        before = self.sql("SELECT * FROM topic_participants ORDER BY rowid")
        envelope, _ = self.prepare_reply(["owner"], actor="agent-b", source={"kind": "message", "id": sent["id"]})
        result = self.committed(self.store.command("agent-b", envelope))
        self.assertEqual(self.sql("SELECT * FROM topic_participants ORDER BY rowid"), before)
        self.assertEqual(self.sql("SELECT reason FROM delivery_reasons r JOIN deliveries d ON d.id=r.delivery_id WHERE d.message_id=? AND d.recipient_id='owner' ORDER BY reason", (result["message_id"],)), [("addressed",), ("subscription",)])


class ReplyRecordCase(ReaderCase):
    """A reply written about a message records which message it answers."""

    def reply(self, source, topic="t1", key="answer", body="Answer", **fields):
        args = dict(source_ref=source, topic_id=topic, generation="gA", body=body,
                    attachments=[], quotes=[], addressees=[])
        args.update(fields)
        self.committed(self.command("draft.save", args, target={"draft_id": key}, expected={"draft_revision": 0}))
        self.committed(self.prepare(key, topic, submission=key, send_op=key + "-send"))
        sent = self.committed(self.command("message.send", {"submission_id": key}, target={"topic_id": topic}, op=key + "-send"))
        return self.source({"kind": "message", "id": sent["message_id"]})

    def test_a_reply_written_about_a_message_records_it_quoted_or_not(self):
        plain = self.reply(self.opening)
        self.assertEqual(plain["reply_to"], self.opening["id"])
        quoted = self.reply(plain["source_ref"], key="quoted", quotes=[{"source": plain["source_ref"], "excerpt": "Answer"}])
        self.assertEqual(quoted["reply_to"], plain["source_ref"]["id"])
        # The frozen act keeps exactly what was written; its source names the message.
        self.assertNotIn("reply_to", self.store.view("owner", "submission", {"submission_id": "quoted"}))

    def test_writing_about_anything_else_answers_no_message(self):
        # A topic's own composer, and a message read from another topic, answer nothing here.
        self.assertIsNone(self.reply({"kind": "topic", "id": "t1"}, key="composer")["reply_to"])
        self.committed(self.save_draft("second", {"kind": "new_topic", "id": "second", "workspace_id": "w1"}, "t2", "Elsewhere",
                                       opening={"workspace_id": "w1", "title": "Second", "participants": []}))
        self.committed(self.prepare("second", "t2", submission="second", send_op="second-send"))
        elsewhere = self.committed(self.command("topic.create_and_send", {"submission_id": "second"}, target={"topic_id": "t2"}, op="second-send"))
        crossed = self.reply({"kind": "message", "id": elsewhere["message_id"]}, key="crossed")
        self.assertEqual(crossed["topic_id"], "t1")
        self.assertIsNone(crossed["reply_to"])

    def test_the_topic_log_says_whose_message_a_reply_answers(self):
        answer = self.reply(self.opening, body="Answer")
        page = self.store.view("agent-a", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 10})
        item = next(row for row in page["items"] if row["id"] == answer["source_ref"]["id"])
        opening = next(row for row in page["items"] if row["id"] == self.opening["id"])
        self.assertEqual((item["reply_to"], item["reply_to_author"]), (self.opening["id"], "owner"))
        self.assertEqual(item["reply_to_excerpt"], self.source(self.opening)["body"][:120])
        self.assertEqual((opening["reply_to"], opening["reply_to_author"], opening["reply_to_excerpt"]), (None, None, None))
        reader = self.store.view("owner", "topic_messages", {"topic_id": "t1", "audience": "reader", "limit": 10})
        self.assertEqual(next(row for row in reader["items"] if row["id"] == item["id"])["reply_to_author"], "owner")

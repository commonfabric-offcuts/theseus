from __future__ import annotations

import hashlib
import io

from aim_next.contract import Refusal
from reader_fixture import ReaderCase


class TopicCompositionCase(ReaderCase):
    ref = {"kind": "topic", "id": "t1"}

    def save(self, draft="compose", ref=None, topic="t1", actor="owner", revision=0,
             generation="compose-g", **fields):
        args = dict(source_ref=self.ref if ref is None else ref, topic_id=topic,
                    generation=generation, body="Independent message", attachments=[],
                    quotes=[], addressees=[], caret={"start": 4, "end": 4})
        args.update(fields)
        return self.command("draft.save", args, target={"draft_id": draft},
                            expected={"draft_revision": revision}, actor=actor)

    def state(self, ref=None, topic="t1", actor="owner"):
        result = self.store.view(actor, "editor_state", {
            "source_ref": self.ref if ref is None else ref, "topic_id": topic})
        self.assertNotIn("error", result, result)
        return result

    def stored_work(self):
        return {table: self.sql("SELECT * FROM " + table + " ORDER BY rowid")
                for table in ("drafts", "notes", "submissions", "changes")}

    def refuse_save_unchanged(self, **args):
        before, public = self.stored_work(), self.public_state()
        self.rejected(self.save(**args), "INVALID_ARGUMENT")
        self.assertEqual(self.stored_work(), before)
        self.assertEqual(self.public_state(), public)

    def ready_attachment(self):
        data = b"exact isolated composition attachment\n"
        digest = hashlib.sha256(data).hexdigest()
        self.committed(self.command("media.begin", {
            "name": "composition.txt", "content_type": "text/plain", "size_bytes": len(data),
            "sha256": digest, "publish_operation_id": "composition-media-publish",
        }, target={"media_id": "composition-media"}, expected={"media_revision": 0}))
        self.committed(self.store.publish_media("owner", self.envelope("media.publish",
            {"media_id": "composition-media"}, {}, {"media_revision": 1},
            op="composition-media-publish"), io.BytesIO(data)))
        return data, digest

    def create_another_topic(self, topic_id):
        ref = {"kind": "new_topic", "id": topic_id, "workspace_id": "w1"}
        self.committed(self.save(draft="another-opening", ref=ref, topic=topic_id,
            opening={"workspace_id": "w1", "title": "Another topic", "participants": []}))
        self.committed(self.prepare("another-opening", topic_id, submission="another-opening",
                                    send_op="another-opening-send"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "another-opening"},
                                    target={"topic_id": topic_id}, op="another-opening-send"))
        return ref

    def test_empty_composer_query_is_read_only_and_not_a_note_or_source(self):
        before = self.records()
        state = self.state()
        self.assertEqual(state["source_ref"], self.ref)
        self.assertEqual(state["destination"], {"topic_id": "t1"})
        self.assertIs(state["source_available"], True)
        self.assertIs(state["destination_available"], True)
        self.assertIsNone(state["draft"])
        self.assertIsNone(state["note"])
        self.assertEqual(state["submissions"], {"instance_id": "test-instance", "items": [], "next_cursor": None})
        self.assertEqual(self.records(), before)

    def test_round_trip_preserves_reply_and_sends_exact_attachment_only_once(self):
        data, digest = self.ready_attachment()
        self.committed(self.save(draft="reply", ref=self.opening, body="Unrelated reply",
                                 reply_to=self.opening["id"]))
        unrelated = self.state(ref=self.opening)["draft"]
        topics = self.sql("SELECT id FROM topics ORDER BY id")
        participants = self.sql("SELECT * FROM topic_participants ORDER BY rowid")
        public = self.public_state()
        self.committed(self.save(body="", attachments=[{"id": "composition-media"}], addressees=["agent-b"], intent="tell"))
        state = self.state()
        self.assertEqual(state["draft"]["source_ref"], self.ref)
        self.assertEqual(state["draft"]["caret"], {"start": 4, "end": 4})
        self.assertEqual(state["draft"]["attachments"], [{"id": "composition-media"}])
        self.assertEqual(self.store.view("owner", "media", {"media_id": "composition-media"})["sha256"], digest)
        self.assertEqual(self.public_state(), public)
        prepared = self.committed(self.prepare("compose", "t1"))
        self.assertEqual(self.public_state(), public)
        self.committed(self.save(body="New B", revision=2, generation=prepared["next_draft"]["generation"]))
        send = self.envelope("message.send", {"topic_id": "t1"}, {"submission_id": "s1"}, op="send-1")
        receipt = self.store.command("owner", send)
        sent = self.committed(receipt)
        self.assertEqual(self.store.command("owner", send), receipt)
        message = self.source({"kind": "message", "id": sent["message_id"]})
        self.assertEqual((message["topic_id"], message["author"], message["body"]), ("t1", "owner", ""))
        self.assertIsNone(message["reply_to"])
        self.assertIsNone(message["exchange_id"])
        self.assertEqual(message["quotes"], [])
        self.assertEqual(message["addressees"], ["agent-b"])
        self.assertEqual(message["attachments"][0]["sha256"], digest)
        with self.store.open_media("agent-b", {"media_id": "composition-media",
                "source_ref": message["source_ref"]}) as resource:
            self.assertEqual(resource.read(65536), data)
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? ORDER BY recipient_id",
                                  (sent["message_id"],)), [("agent-a",), ("agent-b",)])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id='send-1'"), [(1,)])
        self.assertEqual(self.sql("SELECT id FROM topics ORDER BY id"), topics)
        self.assertEqual(self.sql("SELECT * FROM topic_participants ORDER BY rowid"), participants)
        self.assertEqual(self.state(ref=self.opening)["draft"], unrelated)
        self.assertEqual(self.state()["draft"]["body"], "New B")
        self.assertEqual(self.state()["submissions"]["items"][0]["send_status"], "committed")

    def test_source_kinds_and_actors_keep_colliding_ids_in_separate_slots(self):
        raw_id = self.opening["id"]
        opening_ref = self.create_another_topic(raw_id)
        self.committed(self.memory(item=raw_id))
        memory_ref = self.memory_ref(item=raw_id)
        topic_ref = {"kind": "topic", "id": raw_id}
        refs = [self.opening, memory_ref, topic_ref]
        for index, ref in enumerate(refs):
            self.committed(self.save(draft="slot-%s" % index, ref=ref, topic=raw_id, body="Writing %s" % index))
        self.committed(self.save(draft="slot-2", ref=topic_ref, topic=raw_id, actor="agent-a", body="Other actor"))
        for index, ref in enumerate(refs):
            self.assertEqual(self.state(ref=ref, topic=raw_id)["draft"]["body"], "Writing %s" % index)
        self.assertEqual(self.state(ref=opening_ref, topic=raw_id)["draft"]["body"], "")
        self.assertEqual(self.state(ref=topic_ref, topic=raw_id, actor="agent-a")["draft"]["body"], "Other actor")
        for index in (0, 2):
            self.committed(self.prepare("slot-%s" % index, raw_id, submission="slot-%s" % index,
                                        send_op="slot-send-%s" % index))
        for index in (0, 2):
            page = self.store.view("owner", "submissions", {"source_ref": refs[index], "topic_id": raw_id, "limit": 1})
            self.assertEqual([item["id"] for item in page["items"]], ["slot-%s" % index])
            self.assertIsNone(page["next_cursor"])
        self.assertEqual(self.state(ref=topic_ref, topic=raw_id, actor="agent-a")["submissions"]["items"], [])

    def test_topic_identity_must_equal_destination_on_save_and_queries(self):
        self.create_another_topic("t2")
        # Both topics are accessible: permission cannot mask the identity guard.
        self.refuse_save_unchanged(topic="t2")
        for view in ("editor_state", "submissions"):
            before = self.records()
            answer = self.store.view("owner", view, {"source_ref": self.ref, "topic_id": "t2"})
            self.rejected(answer, "INVALID_ARGUMENT")
            self.assertEqual(self.records(), before)

    def test_canonical_reference_and_destination_are_required(self):
        for ref in (dict(self.ref, revision=1), dict(self.ref, workspace_id="w1"),
                    {"kind": "topic"}, {"kind": "topic", "id": ""}):
            with self.subTest(ref=ref):
                self.refuse_save_unchanged(ref=ref)
                for view in ("editor_state", "submissions"):
                    self.rejected(self.store.view("owner", view, {"source_ref": ref, "topic_id": "t1"}), "INVALID_ARGUMENT")
        for view in ("editor_state", "submissions"):
            for destination in ({}, {"topic_id": None}, {"topic_id": ""}):
                with self.subTest(view=view, destination=destination):
                    self.rejected(self.store.view("owner", view, dict(source_ref=self.ref, **destination)), "INVALID_ARGUMENT")
        self.refuse_save_unchanged(topic=None)

    def test_first_save_refuses_reply_opening_exchange_and_quotes(self):
        fields = [{"reply_to": self.opening["id"]}, {"reply_to": None},
                  {"opening": {}}, {"opening": None}, {"exchange_id": "x1"}, {"exchange_id": None},
                  {"quotes": [{"source": self.opening, "excerpt": "Opening message"}]}]
        for patch in fields:
            with self.subTest(patch=patch):
                self.refuse_save_unchanged(**patch)

    def test_later_save_refuses_reply_field_without_changing_private_writing(self):
        self.committed(self.save())
        self.refuse_save_unchanged(revision=1, body="Must not replace", reply_to=self.opening["id"])
        self.assertEqual(self.state()["draft"]["body"], "Independent message")

    def test_later_save_refuses_other_source_fields_and_keeps_canonical_slot(self):
        self.committed(self.save())
        for patch in ({"reply_to": None}, {"opening": {}}, {"opening": None},
                      {"exchange_id": "x1"}, {"exchange_id": None},
                      {"quotes": [{"source": self.opening, "excerpt": "Opening message"}]}):
            with self.subTest(patch=patch):
                self.refuse_save_unchanged(revision=1, **patch)
        self.refuse_save_unchanged(revision=1, ref=dict(self.ref, revision=1))
        self.committed(self.save(revision=1, body="Valid edit"))
        self.assertEqual(self.state()["draft"]["revision"], 2)

    def test_composition_reference_never_becomes_content_or_a_private_note(self):
        self.ready_attachment()
        before = self.stored_work()
        self.rejected(self.command("note.save", {"source_ref": self.ref, "body": "No synthetic note"},
            target={"note_id": "topic-note"}, expected={"note_revision": 0}), "INVALID_SOURCE")
        self.assertEqual(self.stored_work(), before)
        self.rejected(self.store.view("owner", "source", {"source_ref": self.ref}), "INVALID_SOURCE")
        self.rejected(self.store.view("owner", "media", {"media_id": "composition-media", "source_ref": self.ref}), "INVALID_SOURCE")
        with self.assertRaises(Refusal) as caught:
            self.store.open_media("owner", {"media_id": "composition-media", "source_ref": self.ref})
        self.assertEqual(caught.exception.code, "INVALID_SOURCE")
        self.committed(self.save(ref=self.opening, quotes=[{"source": self.ref, "excerpt": "Topic"}]))
        self.committed(self.prepare("compose", "t1"))
        public = self.public_state()
        self.rejected(self.command("message.send", {"submission_id": "s1"},
            target={"topic_id": "t1"}, op="send-1"), "INVALID_SOURCE")
        self.assertEqual(self.public_state(), public)

    def test_revocation_refuses_public_send_and_keeps_frozen_and_current_writing(self):
        self.participation("outsider", True)
        self.committed(self.save(actor="outsider", body="Frozen A"))
        prepared = self.committed(self.command("submission.prepare", {
            "draft_id": "compose", "submission_id": "s1", "send_operation_id": "send-1"},
            target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="outsider"))
        generation = prepared["next_draft"]["generation"]
        self.committed(self.save(actor="outsider", body="Private B", revision=2, generation=generation))
        self.participation("outsider", False)
        self.assertEqual(self.sql("SELECT 1 FROM workspace_members WHERE actor_id='outsider'"), [])
        self.rejected(self.store.view("outsider", "topic", {"topic_id": "t1"}), "FORBIDDEN")
        state = self.state(actor="outsider")
        self.assertFalse(state["source_available"])
        self.assertFalse(state["destination_available"])
        self.assertEqual(state["draft"]["body"], "Private B")
        self.assertIsNone(state["note"])
        self.committed(self.save(actor="outsider", body="Retained private edit", revision=3, generation=generation))
        before, public = self.stored_work(), self.public_state()
        receipt = self.command("message.send", {"submission_id": "s1"},
            target={"topic_id": "t1"}, op="send-1", actor="outsider")
        self.rejected(receipt, "FORBIDDEN")
        self.assertEqual(self.stored_work(), before)
        self.assertEqual(self.public_state(), public)
        frozen = self.store.view("outsider", "submission", {"submission_id": "s1"})
        self.assertEqual(frozen["body"], "Frozen A")
        self.assertEqual(frozen["send_receipt"], receipt)
        self.assertEqual(self.state(actor="outsider")["draft"]["body"], "Retained private edit")
        self.rejected(self.save(actor="other-reader"), "FORBIDDEN")
        self.rejected(self.store.view("other-reader", "editor_state", {"source_ref": self.ref, "topic_id": "t1"}), "FORBIDDEN")
        # Unsubscribing is not revocation when an independent workspace grant remains.
        self.participation("agent-a", False)
        self.committed(self.save(actor="agent-a", body="Independent workspace access"))
        self.assertTrue(self.state(actor="agent-a")["destination_available"])

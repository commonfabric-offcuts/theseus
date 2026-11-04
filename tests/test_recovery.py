from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

from aim_next import store as store_module

from test_store import StoreCase


class RecoveryCase(StoreCase):
    def test_send_arriving_before_prepare_does_not_consume_the_original_send_id(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "A")
        early = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertFalse(early["recorded"], early)
        self.assertFalse(early["error"]["retryable"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "send-1"})["status"], "unknown")
        prepared = self.prepare("d1", "t1")
        self.assertEqual(prepared["status"], "committed", prepared)
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertEqual(self.sql("SELECT body FROM messages ORDER BY seq"), [("Opening message",), ("A",)])

    def test_used_future_send_id_does_not_record_a_prepare_outcome_or_rotate(self):
        source = self.create_topic()
        self.save_draft("d1", source, "t1", "A")
        prepared = self.prepare("d1", "t1", send_op="open-topic")
        self.assertFalse(prepared["recorded"], prepared)
        self.assertEqual(self.sql("SELECT revision FROM drafts WHERE id='d1'"), [(1,)])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": prepared["operation_id"]})["status"], "unknown")

    def test_disabled_subscriber_does_not_block_others_and_can_be_removed(self):
        source = self.create_topic()
        self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"})
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        self.save_draft("d1", source, "t1", "For active subscribers")
        self.prepare("d1", "t1")
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertEqual(sent["result"]["delivery"]["unavailable_subscribers"], ["agent-a"])
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=?", (sent["result"]["message_id"],)), [("agent-b",)])
        removed = self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.assertEqual(removed["status"], "committed", removed)

    def test_explicit_disabled_addressee_still_refuses_the_entire_send(self):
        source = self.create_topic()
        saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": "Explicit A",
                             "generation": "gA", "addressees": ["agent-a"], "quotes": [], "attachments": []},
                             target={"draft_id": "d1"}, expected={"draft_revision": 0})
        self.assertEqual(saved["status"], "committed")
        self.prepare("d1", "t1")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="send-1")
        self.assertEqual(sent["status"], "rejected")
        self.assertEqual(sent["error"]["code"], "INVALID_RECIPIENT")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(1,)])

    def test_private_ids_are_local_to_actor_and_rotation_changes_only_its_owner(self):
        source = self.create_topic()
        for actor in ("owner", "agent-a"):
            saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": actor + " draft",
                                 "generation": "gA", "addressees": [], "quotes": [], "attachments": []},
                                 target={"draft_id": "shared-id"}, expected={"draft_revision": 0}, actor=actor)
            self.assertEqual(saved["status"], "committed", saved)
            note = self.command("note.save", {"source_ref": source, "body": actor + " note"},
                                target={"note_id": "shared-note"}, expected={"note_revision": 0}, actor=actor)
            self.assertEqual(note["status"], "committed", note)
        prepared = self.prepare("shared-id", "t1")
        self.assertEqual(prepared["status"], "committed", prepared)
        self.command("note.save", {"source_ref": source, "body": "Updated owner note"},
                     target={"note_id": "shared-note"}, expected={"note_revision": 1})
        other = self.store.view("agent-a", "editor_state", {"source_ref": source, "topic_id": "t1"})
        self.assertEqual(other["draft"]["body"], "agent-a draft")
        self.assertEqual(other["draft"]["revision"], 1)
        self.assertEqual(other["note"]["body"], "agent-a note")
        self.assertEqual(self.sql("SELECT count(*) FROM drafts WHERE id='shared-id'"), [(2,)])

    def test_removal_records_a_change_in_removed_recipients_scope(self):
        self.create_topic()
        before = self.sql("SELECT max(seq) FROM changes")[0][0]
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.assertTrue(self.sql("SELECT seq FROM changes WHERE scope_kind='actor' AND scope_id='agent-a' AND seq>?", (before,)))

    def test_removed_actor_can_recover_and_edit_own_writing_without_source_or_send_access(self):
        self.command("workspace.create", {"id": "w1", "title": "Owner only", "team": []})
        opening = {"kind": "new_topic", "id": "opening", "workspace_id": "w1"}
        self.save_draft("opening", opening, "t1", "Shared while participating",
                        opening={"workspace_id": "w1", "title": "Topic", "participants": ["agent-a"]})
        self.prepare("opening", "t1", submission="opening", send_op="open")
        created = self.command("topic.create_and_send", {"submission_id": "opening"}, target={"topic_id": "t1"}, op="open")
        source = {"kind": "message", "id": created["result"]["message_id"]}
        saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": "My private reply", "generation": "gA"},
                             target={"draft_id": "d1"}, expected={"draft_revision": 0}, actor="agent-a")
        self.assertEqual(saved["status"], "committed", saved)
        self.command("note.save", {"source_ref": source, "body": "My private note"}, target={"note_id": "n1"}, expected={"note_revision": 0}, actor="agent-a")
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        traced = []
        original_connect = store_module._connect

        def traced_connect(path):
            db, runtime = original_connect(path)
            db.set_trace_callback(traced.append)
            return db, runtime

        with mock.patch.object(store_module, "_connect", traced_connect):
            recovered = self.store.view("agent-a", "editor_state", {"source_ref": source, "topic_id": "t1"})
        self.assertFalse(any("SELECT * FROM messages" in sql for sql in traced), traced)
        self.assertEqual(recovered["draft"]["body"], "My private reply")
        self.assertEqual(recovered["note"]["body"], "My private note")
        self.assertFalse(recovered["destination_available"])
        self.assertFalse(recovered["source_available"])
        self.assertEqual(self.store.view("agent-a", "source", source)["error"]["code"], "FORBIDDEN")
        updated = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": "Recovered and edited", "generation": "gA"},
                               target={"draft_id": "d1"}, expected={"draft_revision": 1}, actor="agent-a")
        self.assertEqual(updated["status"], "committed", updated)
        note = self.command("note.save", {"source_ref": source, "body": "Edited note"}, target={"note_id": "n1"}, expected={"note_revision": 1}, actor="agent-a")
        self.assertEqual(note["status"], "committed", note)
        prepared = self.command("submission.prepare", {"draft_id": "d1", "submission_id": "s1", "send_operation_id": "cannot-send"},
                                target={"topic_id": "t1"}, expected={"draft_revision": 2}, actor="agent-a")
        self.assertEqual(prepared["status"], "committed", prepared)
        sent = self.command("message.send", {"submission_id": "s1"}, target={"topic_id": "t1"}, op="cannot-send", actor="agent-a")
        self.assertEqual(sent["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.store.view("agent-a", "submission", {"submission_id": "s1"})["body"], "Recovered and edited")
        outsider = self.store.view("agent-b", "editor_state", {"source_ref": source, "topic_id": "t1"})
        self.assertEqual(outsider["error"]["code"], "FORBIDDEN")

    def test_non_string_recipient_is_unrecorded_invalid_argument(self):
        result = self.command("workspace.create", {"title": "No", "team": [{"x": 1}]})
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        self.assertFalse(result["recorded"])


for _name in list(StoreCase.__dict__):
    if _name.startswith("test_") and _name not in RecoveryCase.__dict__:
        setattr(RecoveryCase, _name, None)
del StoreCase


if __name__ == "__main__":
    unittest.main()

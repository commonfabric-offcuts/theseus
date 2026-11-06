from __future__ import annotations

import concurrent.futures
import sqlite3
import unittest

from reader_fixture import ReaderCase


class MemoryCase(ReaderCase):
    def test_revisions_keep_exact_words_attribution_and_owner_without_conversation_effect(self):
        before = self.public_state()
        first = self.memory()
        self.committed(first)
        original = self.source(self.memory_ref())
        self.assertEqual(original["author"], "agent-a")
        self.assertEqual(original["creator"], "agent-a")
        self.assertEqual(original["owner_scope"], {"kind": "topic", "id": "t1"})
        self.assertEqual(original["body"], "Original Notebook words")
        self.assertEqual(self.public_state(), before)
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True},
                                    target={"topic_id": "t1"}))
        before = self.public_state()
        self.committed(self.memory(actor="agent-b", revision=1, body="Second attributed revision"))
        old, new = self.source(self.memory_ref()), self.source(self.memory_ref(revision=2))
        self.assertEqual(old["body"], original["body"])
        self.assertEqual(old["author"], "agent-a")
        self.assertEqual(old["current_revision"], 2)
        self.assertEqual(new["body"], "Second attributed revision")
        self.assertEqual(new["author"], "agent-b")
        self.assertEqual(new["creator"], "agent-a")
        self.assertEqual(new["version"], 2)
        self.assertEqual(self.public_state(), before)

    def test_duplicate_and_concurrent_revision_have_one_receipt_and_item_cas(self):
        self.committed(self.memory())
        envelope = self.envelope("memory.revise", {"item_id": "memory-one"},
                                 {"title": "Revised", "body": "Once", "attachments": [], "references": []},
                                 {"item_revision": 1})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.store.command("agent-a", envelope), range(2)))
        self.committed(receipts[0])
        self.assertEqual(receipts[0], receipts[1])
        before = self.records()
        self.assertEqual(self.store.command("agent-a", envelope), receipts[0])
        self.assertEqual(self.records(), before)
        changed = dict(envelope, args=dict(envelope["args"], body="Different act"))
        self.rejected(self.store.command("agent-a", changed), "OPERATION_PAYLOAD_MISMATCH")
        self.rejected(self.memory(revision=1, body="Stale editor"), "REVISION_CONFLICT")
        self.assertEqual(self.source(self.memory_ref(revision=2))["body"], "Once")
        self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": envelope["operation_id"]}), receipts[0])

    def test_write_gate_requires_active_agent_participation_not_readability_or_delivery(self):
        self.participation("outsider", True)
        self.send("Exactly this source only", ["outsider"])
        self.participation("outsider", False)
        before = self.public_state()
        for actor in ("owner", "agent-b", "outsider"):
            with self.subTest(actor=actor):
                self.rejected(self.memory(item="forbidden-" + actor, actor=actor), "FORBIDDEN")
        self.committed(self.memory())
        self.committed(self.command("participation.set", {"actor_id": "agent-a", "present": False},
                                    target={"topic_id": "t1"}))
        # Team membership still permits a read; removal nevertheless forbids edit.
        self.assertEqual(self.source(self.memory_ref(), actor="agent-a")["body"], "Original Notebook words")
        self.rejected(self.memory(revision=1), "FORBIDDEN")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.rejected(self.memory(item="disabled", actor="agent-b"), "INVALID_ACTOR")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(len(before["messages"]),)])

    def test_workspace_revision_uses_team_gate_and_note_has_no_invented_destination(self):
        self.committed(self.memory(actor="agent-b", scope={"kind": "workspace", "id": "w1"}))
        ref = self.memory_ref()
        self.assertIsNone(self.source(ref)["topic_id"])
        self.rejected(self.memory(item="foreign", actor="outsider",
                                  scope={"kind": "workspace", "id": "w1"}), "FORBIDDEN")
        self.committed(self.command("note.save", {"source_ref": ref, "body": "Private annotation"},
                                    target={"note_id": "my-note"}, expected={"note_revision": 0}))
        before = self.records()
        for extra in ({}, {"topic_id": None}):
            result = self.store.view("owner", "editor_state", dict(source_ref=ref, **extra))
            self.assertNotIn("error", result, result)
            self.assertEqual(result["note"]["body"], "Private annotation")
            self.assertEqual(result["destination"], {"topic_id": None})
            self.assertIsNone(result["draft"])
            self.assertFalse(result["destination_available"])
            self.assertEqual(result["submissions"]["items"], [])
        self.assertEqual(self.records(), before)
        result = self.store.view("agent-b", "editor_state", {"source_ref": ref})
        self.assertIsNone(result["note"])

    def test_new_revision_reopens_same_private_slots_without_retargeting_old_provenance(self):
        self.committed(self.memory())
        first, second = self.memory_ref(), self.memory_ref(revision=2)
        self.committed(self.save_draft("memory-draft", first, "t1", "Reply about version one"))
        self.committed(self.command("note.save", {"source_ref": first, "body": "My original note"},
                                    target={"note_id": "private"}, expected={"note_revision": 0}))
        self.committed(self.memory(revision=1, body="New words"))
        before = self.records()
        view = self.store.view("owner", "editor_state", {"source_ref": second, "topic_id": "t1"})
        self.assertNotIn("error", view, view)
        self.assertIsInstance(view["draft"], dict, "The stable private draft must survive a later source revision")
        self.assertIsInstance(view["note"], dict, "The stable private note must survive a later source revision")
        self.assertEqual(view["draft"]["id"], "memory-draft")
        self.assertEqual(view["draft"]["source_ref"], first)
        self.assertEqual(view["note"]["source_ref"], first)
        self.assertEqual(view["note"]["body"], "My original note")
        self.assertEqual(self.records(), before)

    def test_an_empty_private_slot_moves_to_the_revision_written_against_and_writing_keeps_its_own(self):
        self.committed(self.memory())
        first, second = self.memory_ref(), self.memory_ref(revision=2)
        # Empty, as a sent reply leaves its place, and an emptied note.
        self.committed(self.save_draft("empty-draft", first, "t1", ""))
        self.committed(self.command("note.save", {"source_ref": first, "body": ""},
                                    target={"note_id": "empty-note"}, expected={"note_revision": 0}))
        self.committed(self.memory(revision=1, body="New words"))
        # Writing begun while the page reads revision two is about revision two.
        self.committed(self.save_draft("empty-draft", second, "t1", "About the new words", revision=1))
        # Not to a revision that does not exist, even from an empty slot.
        self.rejected(self.command("note.save", {"source_ref": self.memory_ref(revision=3), "body": "Ahead"},
                                   target={"note_id": "empty-note"}, expected={"note_revision": 1}), "FORBIDDEN")
        note = self.store.view("owner", "editor_state", {"source_ref": first})["note"]
        self.assertEqual((note["source_ref"], note["body"], note["revision"]), (first, "", 1))
        self.committed(self.command("note.save", {"source_ref": second, "body": "Noted on the new words"},
                                    target={"note_id": "empty-note"}, expected={"note_revision": 1}))
        view = self.store.view("owner", "editor_state", {"source_ref": second, "topic_id": "t1"})
        self.assertEqual((view["draft"]["source_ref"], view["draft"]["body"]), (second, "About the new words"))
        self.assertEqual((view["note"]["source_ref"], view["note"]["body"]), (second, "Noted on the new words"))
        # Writing keeps the revision it was written against: neither a draft
        # nor a note that holds words moves to another revision.
        self.rejected(self.save_draft("empty-draft", first, "t1", "Moved back", revision=2), "REVISION_CONFLICT")
        self.rejected(self.save_draft("empty-draft", first, "t1", "", revision=2), "REVISION_CONFLICT")
        self.rejected(self.command("note.save", {"source_ref": first, "body": "Moved back"},
                                   target={"note_id": "empty-note"}, expected={"note_revision": 2}), "REVISION_CONFLICT")
        self.assertEqual(self.store.view("owner", "editor_state", {"source_ref": second, "topic_id": "t1"}), view)

    def test_quote_is_checked_against_exact_old_revision_and_does_not_address_names(self):
        self.committed(self.memory(body="agent-b said the original words"))
        self.committed(self.memory(revision=1, body="Replacement words"))
        sent = self.send("Quoted deliberately", quotes=[{
            "source": self.memory_ref(), "excerpt": "agent-b said the original words"}])
        source = self.source({"kind": "message", "id": sent["id"]})
        self.assertEqual(source["addressees"], [])
        self.assertEqual(source["quotes"][0]["source"], self.memory_ref())
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE message_id=? AND recipient_id='agent-b'",
                                  (sent["id"],)), [(0,)])
        # A missing revision must not silently read latest.
        for ref in ({"kind": "memory", "id": "memory-one"}, self.memory_ref(revision=0),
                    self.memory_ref(revision=True)):
            result = self.store.view("owner", "source", {"source_ref": ref})
            self.assertIn("error", result, result)

    def test_list_cursor_preserves_creation_order_and_is_scoped_bounded_and_read_only(self):
        for index in range(4):
            self.committed(self.memory(item="item-%s" % index, body=("é" * 800) + str(index)))
        scope = {"kind": "topic", "id": "t1"}
        first = self.store.view("owner", "memory_items", {"owner_scope": scope, "limit": 2})
        self.assertNotIn("error", first, first)
        self.assertEqual([item["id"] for item in first["items"]], ["item-0", "item-1"])
        self.assertIsNotNone(first["next_cursor"])
        version = first["relevant_versions"]["notebook"]
        self.committed(self.memory(item="item-0", revision=1, body="Edited first"))
        before = self.records()
        second = self.store.view("owner", "memory_items", {
            "owner_scope": scope, "limit": 2, "cursor": first["next_cursor"]})
        self.assertEqual([item["id"] for item in second["items"]], ["item-2", "item-3"])
        self.assertIsNone(second["next_cursor"])
        self.assertGreater(second["relevant_versions"]["notebook"], version)
        self.assertLessEqual(self.json_size(second), 131072)
        self.assertTrue(second["items"][0]["preview"])
        self.assertEqual(self.records(), before)
        self.assertIn("error", self.store.view("owner", "memory_items", {}))
        self.assertIn("error", self.store.view("outsider", "memory_items", {"owner_scope": scope}))


del ReaderCase

if __name__ == "__main__":
    unittest.main()

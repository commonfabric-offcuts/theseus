from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

from aim_next import store as store_module
from test_store import StoreCase


class NoteDestinationCase(StoreCase):
    def setUp(self):
        super().setUp()
        self.source = self.create_topic()

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            return tuple(db.iterdump())

    def note(self, actor="owner", body="Private note"):
        result = self.command("note.save", {"source_ref": self.source, "body": body},
                              target={"note_id": "same-note-id"}, expected={"note_revision": 0}, actor=actor)
        self.assertEqual(result["status"], "committed", result)

    def populated_reply(self):
        self.assertEqual(self.save_draft("reply", self.source, "t1", "Frozen A")["status"], "committed")
        prepared = self.prepare("reply", "t1")
        self.assertEqual(prepared["status"], "committed", prepared)
        successor = prepared["result"]["next_draft"]
        self.assertEqual(self.save_draft("reply", self.source, "t1", "Current B", revision=successor["revision"],
                                       generation=successor["generation"])["status"], "committed")

    def note_only(self, args, actor="owner", body="Private note", source_available=True):
        result = self.store.view(actor, "editor_state", dict(source_ref=self.source, **args))
        self.assertNotIn("error", result, result)
        self.assertEqual(result["destination"], {"topic_id": None})
        self.assertIs(result["destination_available"], False)
        self.assertIs(result["source_available"], source_available)
        self.assertIsNone(result["draft"])
        self.assertEqual(result["submissions"], {"instance_id": "test-instance", "items": [], "next_cursor": None})
        if body is None:
            self.assertIsNone(result["note"])
        else:
            self.assertEqual(result["note"]["body"], body)
            self.assertEqual(result["note"]["source_ref"], self.source)
        return result

    def test_omitted_and_null_destination_return_note_without_inferring_reply_work(self):
        self.note()
        self.populated_reply()
        before = self.records()
        for args in ({}, {"topic_id": None}):
            with self.subTest(args=args):
                self.note_only(args)
                self.assertEqual(self.records(), before)
        supplied = self.store.view("owner", "editor_state", {"source_ref": self.source, "topic_id": "t1"})
        self.assertTrue(supplied["destination_available"])
        self.assertEqual(supplied["draft"]["body"], "Current B")
        self.assertEqual([item["id"] for item in supplied["submissions"]["items"]], ["s1"])
        self.assertEqual(self.records(), before)

    def test_missing_note_is_null_without_destination_and_reads_write_nothing(self):
        self.populated_reply()
        before = self.records()
        for args in ({}, {"topic_id": None}):
            with self.subTest(args=args):
                self.note_only(args, body=None)
                self.assertEqual(self.records(), before)

    def test_supplied_destination_permission_and_malformed_ids_stay_distinct(self):
        self.note()
        before = self.records()
        inaccessible = self.store.view("owner", "editor_state", {"source_ref": self.source, "topic_id": "inaccessible"})
        self.assertNotIn("error", inaccessible)
        self.assertFalse(inaccessible["destination_available"])
        self.assertEqual(inaccessible["destination"], {"topic_id": "inaccessible"})
        self.assertEqual(inaccessible["note"]["body"], "Private note")
        for topic in ("", [], {}, False, 3):
            with self.subTest(topic=topic):
                result = self.store.view("owner", "editor_state", {"source_ref": self.source, "topic_id": topic})
                self.assertEqual(result.get("error", {}).get("code"), "INVALID_ARGUMENT", result)
        self.assertEqual(self.records(), before)

    def test_new_topic_and_other_view_null_semantics_are_unchanged(self):
        source = {"kind": "new_topic", "id": "opening-one", "workspace_id": "w1"}
        before = self.records()
        result = self.store.view("owner", "editor_state", {"source_ref": source})
        self.assertNotIn("error", result)
        self.assertEqual(result["destination"], {"topic_id": None})
        self.assertIs(result["destination_available"], True)
        for name, args in (("editor_state", {"source_ref": source, "topic_id": None}),
                           ("topic", {"topic_id": None}),
                           ("submissions", {"source_ref": self.source, "topic_id": None})):
            with self.subTest(name=name):
                result = self.store.view("owner", name, args)
                self.assertEqual(result.get("error", {}).get("code"), "INVALID_ARGUMENT", result)
        self.assertEqual(self.records(), before)

    def test_note_only_reads_keep_actor_isolation_and_reject_private_overrides(self):
        self.note(body="Owner secret")
        self.note(actor="agent-a", body="Agent secret")
        before = self.records()
        for args in ({}, {"topic_id": None}):
            with self.subTest(args=args):
                self.note_only(args, actor="agent-a", body="Agent secret")
                self.note_only(args, actor="agent-b", body=None)
                for field in ("actor", "actor_id", "owner", "owner_id"):
                    result = self.store.view("agent-b", "editor_state", dict(source_ref=self.source, **args, **{field: "owner"}))
                    self.assertEqual(result.get("error", {}).get("code"), "INVALID_ARGUMENT", result)
                self.assertEqual(self.records(), before)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        before = self.records()
        result = self.store.view("agent-a", "editor_state", {"source_ref": self.source})
        self.assertEqual(result.get("error", {}).get("code"), "INVALID_ACTOR", result)
        self.assertEqual(self.records(), before)

    def test_removed_source_keeps_only_own_retained_note_without_content_disclosure(self):
        self.note(actor="agent-a", body="Retained secret")
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM workspace_members WHERE actor_id IN ('agent-a','agent-b')")
        before = self.records()
        traced = []
        original = store_module._connect
        def connect(path):
            db, runtime = original(path)
            db.set_trace_callback(traced.append)
            return db, runtime
        for args in ({}, {"topic_id": None}):
            with self.subTest(args=args):
                with mock.patch.object(store_module, "_connect", connect):
                    self.note_only(args, actor="agent-a", body="Retained secret", source_available=False)
                result = self.store.view("agent-b", "editor_state", dict(source_ref=self.source, **args))
                self.assertEqual(result.get("error", {}).get("code"), "FORBIDDEN", result)
                self.assertEqual(self.records(), before)
        self.assertFalse(any("SELECT * FROM messages" in query for query in traced), traced)
        result = self.store.view("agent-a", "source", {"source_ref": self.source})
        self.assertEqual(result.get("error", {}).get("code"), "FORBIDDEN", result)
        self.assertEqual(self.records(), before)


for _name in list(StoreCase.__dict__):
    if _name.startswith("test_") and _name not in NoteDestinationCase.__dict__:
        setattr(NoteDestinationCase, _name, None)
del StoreCase


if __name__ == "__main__":
    unittest.main()

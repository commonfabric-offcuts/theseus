from __future__ import annotations

from aim_next.stacks import TRASH_SCHEMA
from aim_next.migrations import MigrationError, STEPS, migrate
from aim_next.store import Store, StoreOpenError
from reader_fixture import ReaderCase


BEFORE, AFTER, *_ = next(step for step in STEPS if step[2] is TRASH_SCHEMA)


class TrashMigrationCase(ReaderCase):
    def migrate_to(self, schema):
        return migrate(self.path, "test-instance", self.binding, schema)

    def test_empty_step_roundtrip_preserves_existing_message_and_act_rows(self):
        root = self.opening["id"]
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": root},
                                    expected={"star_revision": 0}))
        reply = self.committed(self.command("message.post", {
            "body": "Synthetic answer to refresh", "reply_to": root, "reply_without_quote": "Fixture reply",
        }, target={"topic_id": "t1"}, actor="agent-a"))["message_id"]
        self.committed(self.command("message.refresh", target={"message_id": reply},
                                    expected={"message_revision": 1}))
        messages = self.sql("SELECT * FROM messages ORDER BY seq")
        acts = self.sql("SELECT * FROM message_acts ORDER BY id")
        requests = self.sql("SELECT * FROM refresh_requests")
        sequence = self.sql("SELECT seq FROM sqlite_sequence WHERE name='message_acts'")
        down = self.migrate_to(BEFORE)
        self.assertEqual((down["from_version"], down["schema_version"]), (AFTER, BEFORE))
        with self.assertRaises(StoreOpenError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='reader_trash_recent'"), [])
        up = self.migrate_to(AFTER)
        self.assertEqual((up["from_version"], up["schema_version"]), (BEFORE, AFTER))
        self.assertEqual(self.sql("SELECT * FROM messages ORDER BY seq"), messages)
        self.assertEqual(self.sql("SELECT * FROM message_acts ORDER BY id"), acts)
        self.assertEqual(self.sql("SELECT * FROM refresh_requests"), requests)
        self.assertEqual(self.sql("SELECT seq FROM sqlite_sequence WHERE name='message_acts'"), sequence)
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
        self.assertEqual(self.store.view("owner", "dossier_trash", {"topic_id": "t1"})["items"], [])

    def test_occupied_step_refuses_even_after_the_dossier_is_restored(self):
        root = self.opening["id"]
        for revision, trashed in enumerate((True, False)):
            self.committed(self.command("stack.trash", {"trashed": trashed}, target={"message_id": root},
                                        expected={"trash_revision": revision}))
        snapshot = self.sql("SELECT * FROM message_acts WHERE kind='trash' ORDER BY id")
        with self.assertRaises(MigrationError) as error:
            self.migrate_to(BEFORE)
        self.assertEqual(error.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.sql("SELECT * FROM message_acts WHERE kind='trash' ORDER BY id"), snapshot)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [(AFTER,)])

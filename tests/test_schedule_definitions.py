from __future__ import annotations

import sqlite3

from aim_next.migrations import MigrationError, STEPS, migrate
from aim_next.schedule_definitions import SCHEDULE_UP
from reader_fixture import ReaderCase


class ScheduleDefinitionCase(ReaderCase):
    def setUp(self):
        super().setUp()
        self.committed(self.memory(item="prompt"))
        self.committed(self.memory(item="config"))
        source = dict(self.opening, revision=1)
        self.definition = {
            "active": False, "timing": {"kind": "once", "at": "2026-11-28T09:30:00.500-08:00"},
            "agent_id": "agent-a", "source_ref": source,
            "prompt_ref": self.memory_ref("prompt"), "config_ref": self.memory_ref("config"),
            "reply_target": {"topic_id": "t1", "message_ref": source},
        }

    def save(self, revision, actor="owner", **overrides):
        return self.command("schedule.save", dict(self.definition, **overrides),
                            {"schedule_id": "room-check"}, {"schedule_revision": revision}, actor=actor)

    def read(self, actor="owner", **args):
        return self.store.view(actor, "schedule_definition", dict(schedule_id="room-check", **args))

    def test_an_inactive_definition_is_pinned_and_creates_no_work(self):
        before = self.public_state()
        envelope = self.envelope("schedule.save", {"schedule_id": "room-check"}, self.definition,
                                 {"schedule_revision": 0})
        receipt = self.store.command("owner", envelope)
        result = self.committed(receipt)
        self.assertEqual(result, {"schedule_id": "room-check", "schedule_revision": 1, "due_ms": 1795887000500})
        self.assertEqual(self.store.command("owner", envelope), receipt)
        original = self.read()
        for key, value in self.definition.items():
            self.assertEqual(original[key], value)
        self.assertEqual(self.public_state(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM schedule_runs"), [(0,)])

        self.committed(self.memory(item="prompt", revision=1, body="Revised task"))
        self.assertEqual(self.read(), original)
        self.rejected(self.save(0), "REVISION_CONFLICT")
        self.committed(self.save(1, prompt_ref=self.memory_ref("prompt", 2)))
        self.assertEqual(self.read()["prompt_ref"]["revision"], 2)
        self.assertEqual(self.read(schedule_revision=1), original)

    def test_refuses_invalid_timestamp_activation_and_schedule_shapes(self):
        for moment in ("2026-11-28T09:30:00", "2026-11-28T09:30:00-00:00",
                       "2026-11-28T09:30:00+01:60", "2026-02-29T09:30:00Z",
                       "2026-11-28T09:30:00.0009Z", "0001-01-01T00:00:00+01:00"):
            with self.subTest(moment=moment):
                self.rejected(self.save(0, timing={"kind": "once", "at": moment}), "INVALID_ARGUMENT")
        self.rejected(self.save(0, active=True), "INVALID_ARGUMENT")
        self.rejected(self.save(0, active=0), "INVALID_ARGUMENT")
        self.rejected(self.save(0, timing=dict(self.definition["timing"], kind="weekly")), "INVALID_ARGUMENT")
        self.rejected(self.save(0, config_ref={"kind": "memory", "id": "config"}), "INVALID_ARGUMENT")
        self.rejected(self.save(0, config_ref={"kind": [], "id": "config", "revision": 1}), "INVALID_ARGUMENT")
        self.rejected(self.save(0, source_ref=dict(self.opening, revision=2)), "FORBIDDEN")
        self.rejected(self.save(0, agent_id="other-reader"), "INVALID_ARGUMENT")
        self.committed(self.save(0, timing={"kind": "once", "at": "2026-11-28T17:30:00Z"}))

    def test_only_the_owner_can_read_and_reach_is_checked_for_both_actors(self):
        self.rejected(self.save(0, actor="other-reader"), "FORBIDDEN")
        self.rejected(self.save(0, agent_id="outsider"), "FORBIDDEN")
        self.committed(self.memory(item="draft-task", actor="owner", draft=True))
        self.rejected(self.save(0, prompt_ref=self.memory_ref("draft-task")), "FORBIDDEN")
        self.committed(self.save(0))
        self.rejected(self.read("agent-a"), "FORBIDDEN")
        self.rejected(self.save(1, actor="agent-a"), "FORBIDDEN")
        self.committed(self.command("memory.delete", {"deleted": True}, {"item_id": "config"},
                                    {"item_revision": 1}, actor="agent-a"))
        self.rejected(self.read(), "PAGE_DELETED")

    def test_missing_expected_revision_or_incorrect_authority_cannot_register(self):
        envelope = self.envelope("schedule.save", {"schedule_id": "room-check"}, self.definition)
        self.rejected(self.store.command("owner", envelope), "INVALID_ARGUMENT")
        envelope["expected"]["schedule_revision"] = 0
        envelope["expected"]["authority"]["authority_epoch"] = "different-fixture-epoch"
        refused = self.store.command("owner", envelope)
        self.rejected(refused, "AUTHORITY_CHANGED")
        self.assertFalse(refused["recorded"])
        self.assertEqual(self.sql("SELECT count(*) FROM schedule_definitions"), [(0,)])

    def test_held_messages_and_private_sources_are_checked_at_registration_and_read(self):
        private = self.committed(self.command("message.post", {"body": "A private fixture", "whisper": True,
                                                               "addressees": ["agent-b"]}, {"topic_id": "t1"}))
        private_ref = {"kind": "message", "id": private["message_id"], "revision": 1}
        self.rejected(self.save(0, source_ref=private_ref), "FORBIDDEN")

        self.committed(self.save(0))
        edit_target = {"message_id": self.opening["id"]}
        self.committed(self.command("message.edit_open", {"holder": "fixture"}, edit_target))
        self.rejected(self.save(1), "MESSAGE_HELD")
        self.rejected(self.read(), "MESSAGE_HELD")
        self.committed(self.command("message.edit_close", {"holder": "fixture"}, edit_target))
        self.assertEqual(self.read()["source_ref"], self.definition["source_ref"])

    def test_reply_parent_must_be_in_the_destination(self):
        elsewhere = self.committed(self.command("message.post", {"body": "Another topic"},
                                                {"topic_id": self.conversation_id()}))["message_id"]
        self.rejected(self.save(0, reply_target={"topic_id": "t1",
                            "message_ref": {"kind": "message", "id": elsewhere, "revision": 1}}), "INVALID_REPLY")
        self.committed(self.save(0, reply_target={"topic_id": "t1", "message_ref": None}))

    def conversation_id(self):
        return self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND id<>'t1'")[0][0]

    def test_upgrade_downgrade_and_guard_preserve_existing_records(self):
        before, after, *_ = next(step for step in STEPS if step[2] is SCHEDULE_UP)
        state = self.public_state()
        for target in (before, after, before, after):
            result = migrate(self.path, "test-instance", self.binding, target)
            self.assertEqual(result["schema_version"], target)
            self.assertEqual(self.public_state(), state)
            self.assertEqual(len(self.sql("SELECT name FROM sqlite_schema WHERE name IN "
                                          "('schedule_definitions','schedule_revisions','schedule_runs')")),
                             3 if target == after else 0)

        self.committed(self.save(0))
        with self.assertRaisesRegex(MigrationError, "records that exist") as caught:
            migrate(self.path, "test-instance", self.binding, before)
        self.assertEqual(caught.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.read()["schedule_revision"], 1)
        self.assertEqual(self.public_state(), state)

    def test_run_key_is_unique_across_revisions_and_pins_an_existing_revision(self):
        self.committed(self.save(0))
        self.committed(self.save(1))
        with sqlite3.connect(str(self.path)) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("INSERT INTO schedule_runs VALUES ('run-1','room-check',1,'once')")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "UNIQUE constraint failed"):
                db.execute("INSERT INTO schedule_runs VALUES ('run-2','room-check',2,'once')")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "FOREIGN KEY constraint failed"):
                db.execute("INSERT INTO schedule_runs VALUES ('run-3','room-check',3,'another-slot')")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable schedule revision"):
                db.execute("UPDATE schedule_revisions SET due_ms=0")

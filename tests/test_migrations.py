from __future__ import annotations

import fcntl
import io
import json
import os
from pathlib import Path
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import admin, migrations, recovery_io
from aim_next import store as store_module
from aim_next.authority import Authority, AuthorityError
from aim_next.contract import StoreError
from aim_next.migrations import MigrationError, migrate
from aim_next.profile import load_profile
from aim_next.store import SCHEMA_VERSION, Store, StoreOpenError
import test_store as fixtures


SCHEMA_8 = (Path(__file__).parent / "fixtures" / "schema_8.sql").read_text().splitlines()
SCHEMA_9 = (Path(__file__).parent / "fixtures" / "schema_9.sql").read_text().splitlines()
SCHEMA_10 = (Path(__file__).parent / "fixtures" / "schema_10.sql").read_text().splitlines()
SCHEMA_11 = (Path(__file__).parent / "fixtures" / "schema_11.sql").read_text().splitlines()
# Version 12 as its step first stood: messages timed, what waits on each reader not yet ordered.
SCHEMA_12_EARLY = (Path(__file__).parent / "fixtures" / "schema_12_early.sql").read_text().splitlines()
SCHEMA_12 = (Path(__file__).parent / "fixtures" / "schema_12.sql").read_text().splitlines()
SCHEMA_13 = (Path(__file__).parent / "fixtures" / "schema_13.sql").read_text().splitlines()
SCHEMA_14 = (Path(__file__).parent / "fixtures" / "schema_14.sql").read_text().splitlines()
SCHEMA_15 = (Path(__file__).parent / "fixtures" / "schema_15.sql").read_text().splitlines()
SCHEMA_16 = (Path(__file__).parent / "fixtures" / "schema_16.sql").read_text().splitlines()
SCHEMA_17 = (Path(__file__).parent / "fixtures" / "schema_17.sql").read_text().splitlines()
SCHEMA_18 = (Path(__file__).parent / "fixtures" / "schema_18.sql").read_text().splitlines()
TABLES = ("actors", "workspaces", "workspace_members", "topics", "topic_participants", "topic_summaries",
          "messages", "deliveries", "delivery_reasons", "delivery_groups", "operations", "changes",
          "drafts", "submissions", "metadata")


def schema(path):
    with sqlite3.connect(str(path)) as db:
        return sorted(row[0] for row in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))


def frozen(statements):
    return sorted(statement.rstrip(";") for statement in statements)


def step_back_by_hand(path, version):
    """Recover an older stored layout from a fresh instance with plain SQL, independent of migrations.py.

    "12-early" is the layout the first form of the 11->12 step left, stamped 12."""
    with sqlite3.connect(str(path)) as db:
        # Version 19 indexes the pending deliveries by group and topic instead of
        # by reader and topic, and refuses a delivery with no topic.
        db.execute("DROP TRIGGER delivery_topic_required")
        db.execute("DROP INDEX pending_group_topic_deliveries")
        db.execute("CREATE INDEX pending_topic_deliveries ON deliveries(recipient_id,topic_id,seq) WHERE state='pending'")
        if version == "18":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 18 keeps each delivery's topic and indexes the pending ones by
        # reader and topic, and drops what version 16 added: each reader's reply
        # horizon and the index of each message's replies.
        db.execute("DROP INDEX pending_topic_deliveries")
        db.execute("ALTER TABLE deliveries DROP COLUMN topic_id")
        if version in ("17", "16"):
            db.execute("CREATE TABLE reply_horizons (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), "
                       "seq INTEGER NOT NULL, PRIMARY KEY(topic_id,actor_id))")
            db.execute("CREATE INDEX message_replies ON messages(reply_to,author_id) WHERE reply_to IS NOT NULL")
        if version == "17":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 17 keeps the color each person chose for an agent.
        db.execute("DROP TABLE color_choices")
        if version == "16":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        if version == "15":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 15 keeps the latest hosted turn in each topic.
        db.execute("DROP TABLE hosted_turn_topics")
        db.execute("DROP TABLE topic_turns")
        if version == "14":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 14 records whether a message to someone asks or tells, and what waits on whoever it asks.
        db.execute("ALTER TABLE topic_waiting DROP COLUMN ask_message_id")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN said")
        db.execute("ALTER TABLE messages DROP COLUMN intent")
        if version == "13":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 13 adds the messages each person marked unread.
        db.execute("DROP TABLE message_marks")
        if version == "12":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 12 orders what waits on each reader; the earlier form of its step,
        # which also stamped 12, did not.
        db.execute("DROP INDEX reader_waiting")
        db.execute("CREATE INDEX actor_waiting ON topic_waiting(actor_id,topic_id)")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN archived")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN state_ms")
        if version != "12-early":
            # Version 12 adds when each message was sent.
            db.execute("ALTER TABLE messages DROP COLUMN sent_ms")
        if version in ("8", "9", "10"):
            # Version 11 adds where each topic stands: its state, archive flag, note, and who it waits on.
            db.execute("DROP TABLE topic_waiting")
            db.execute("DROP INDEX workspace_listed_topics")
            for column in ("state_ms", "state_by", "state_note", "archived", "state"):
                db.execute("ALTER TABLE topics DROP COLUMN " + column)
        if version in ("8", "9"):
            # Version 10 adds the hosted turn records and handed_seq (on the schedule and on each attempt).
            db.execute("DROP TABLE hosted_children")
            db.execute("DROP TABLE hosted_turns")
            db.execute("ALTER TABLE wake_attempts DROP COLUMN handed_seq")
            db.execute("ALTER TABLE recipient_schedule DROP COLUMN handed_seq")
        if version == "8":
            # Version 9 only adds the openings table.
            db.execute("DROP INDEX open_openings")
            db.execute("DROP TABLE openings")
        db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version.split("-")[0],))


class MigrationCase(fixtures.StoreCase):
    """A schema-8 instance holding records written by the unchanged legacy commands."""

    VERSION, FIXTURE = "8", SCHEMA_8
    LAYOUT = None  # the hand-built layout, when it is not simply VERSION

    def setUp(self):
        super().setUp()
        self.create_topic()
        self.assertEqual(self.command("participation.set", {"actor_id": "agent-b", "present": True},
                                      {"topic_id": "t1"})["status"], "committed")
        # The exact stored layout of the older version, proven against its frozen DDL.
        step_back_by_hand(self.path, self.LAYOUT or self.VERSION)
        self.assertEqual(schema(self.path), frozen(self.FIXTURE))
        self.profile = Path(self.temp.name) / "owner.json"
        fd = os.open(str(self.profile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(dict(self.binding, v=2, instance_id="test-instance", actor_id="owner",
                           db_path=str(self.path.resolve())), stream)

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            # Topics, messages and deliveries are compared on the columns every version has: version 11 adds
            # where each topic stands, version 12 when each message was sent, and version 18 each delivery's topic.
            # Version 18 copies each delivery's topic from its message.
            columns = {"topics": "id,workspace_id,title,creator_id,version",
                       "deliveries": "seq,id,message_id,recipient_id,group_id,state",
                       "messages": "seq,id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id"}
            return {table: db.execute("SELECT " + columns.get(table, "*") + " FROM " + table + " ORDER BY rowid").fetchall()
                    for table in TABLES}

    def metadata(self):
        return dict(self.sql("SELECT key,value FROM metadata"))

    def unchanged(self):
        return self.path.read_bytes(), self.records()

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding)

    def migrate_command(self):
        return self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))

    def admin(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = admin.main(list(argv), stdout=out, stderr=err)
        return code, json.loads(out.getvalue()) if out.getvalue() else None, err.getvalue()

    def test_reads_and_opening_never_migrate(self):
        before = self.unchanged()
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("owner", "workspace", {"workspace_id": "w1"})["error"]["code"], "SCHEMA_MISMATCH")
        self.assertEqual(self.command("workspace.create", {"id": "w2", "title": "After"})["error"]["code"], "SCHEMA_MISMATCH")
        self.assertEqual(self.unchanged(), before)

    def test_a_version_mismatch_names_both_versions_and_the_command(self):
        from aim_next import cli, serve
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        for text in ("version 8", "version " + SCHEMA_VERSION, "aim-next-admin migrate"):
            self.assertIn(text, str(raised.exception))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "binding"], stdout=out, stderr=err), 2)
        error = json.loads(out.getvalue())["error"]
        self.assertEqual(error["code"], "SCHEMA_MISMATCH")
        self.assertIn("aim-next-admin migrate", error["message"])
        with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(serve.main(["--profile", str(self.profile), "--port", "0"]), 2)
        self.assertIn("SCHEMA_MISMATCH: This database is at schema version 8", stderr.getvalue())
        # A sound version with damaged commit identity keeps the plain refusal.
        self.upgrade()
        self.sql("UPDATE metadata SET value='x' WHERE key='commit_seq'")
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))

    def test_a_database_newer_than_this_code_names_the_code_and_never_moves(self):
        from aim_next import cli
        self.upgrade()
        self.sql("UPDATE metadata SET value='99' WHERE key='schema_version'")
        before = self.unchanged()
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        for text in ("version 99", "version " + SCHEMA_VERSION, "run code that reads version 99"):
            self.assertIn(text, str(raised.exception))
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "binding"], stdout=out, stderr=err), 2)
        self.assertIn("run code that reads version 99", json.loads(out.getvalue())["error"]["message"])
        # An agent's own commands carry the same advice, as text and as JSON.
        for verb in ("outcomes", "inbox"):
            out, err = io.StringIO(), io.StringIO()
            self.assertEqual(cli.main(["--profile", str(self.profile), verb], stdout=out, stderr=err), 2)
            self.assertIn("run code that reads version 99", out.getvalue() + err.getvalue())
            out, err = io.StringIO(), io.StringIO()
            self.assertEqual(cli.main(["--profile", str(self.profile), "--json", verb], stdout=out, stderr=err), 2)
            error = [json.loads(line) for line in out.getvalue().splitlines() if line.strip()][-1]["error"]
            self.assertEqual(error["code"], "SCHEMA_MISMATCH")
            self.assertIn("run code that reads version 99", error["message"])
        # Following migrate anyway, from this code, moves nothing.
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)

    def test_a_missing_or_malformed_version_is_unsupported_not_newer(self):
        self.upgrade()
        # Not ASCII digits, padded, fractional, ten digits, binary.
        for value in (None, "-1", "", " 99", "099", "9.5", "1" * 10, b"99", "\u0669\u0669", "\uff19\uff19", "\u00b2"):
            with self.subTest(value=value):
                if value is None:
                    self.sql("DELETE FROM metadata WHERE key='schema_version'")
                else:
                    db = sqlite3.connect(str(self.path))
                    with db:
                        db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)", (value,))
                    db.close()
                with self.assertRaises(store_module.StoreOpenError) as raised:
                    Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
                self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
                self.assertNotIn("run code that reads", str(raised.exception))
                self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        # An older version this code cannot upgrade is damage too, not newer
        # code; "7" sorts above "10" as text, so the comparison is numeric.
        for value in ("1", "7"):
            with self.subTest(value=value):
                self.sql("UPDATE metadata SET value='%s' WHERE key='schema_version'" % value)
                with self.assertRaises(store_module.StoreOpenError) as raised:
                    Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
        # Nine digits is the longest version read as newer code.
        self.sql("UPDATE metadata SET value='999999999' WHERE key='schema_version'")
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertIn("run code that reads version 999999999", str(raised.exception))

    def test_damaged_commit_identity_is_unsupported_at_any_version_and_migrate_never_moves_it(self):
        # At an upgradable version: no migrate advice, and migrate refuses
        # rather than restart the sequence.
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_seq'")
        before = self.unchanged()
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        # At this code's own version too: migrate refuses rather than report nothing to do.
        self.sql("UPDATE metadata SET value='5' WHERE key='commit_seq'")
        self.upgrade()
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_seq'")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        # A damaged commit_id alone is damage as well, and migrate never replaces it.
        self.sql("UPDATE metadata SET value='5' WHERE key='commit_seq'")
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_id'")
        self.sql("UPDATE metadata SET value='8' WHERE key='schema_version'")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)

    def test_one_database_gets_one_remedy_from_the_store_and_from_migrate(self):
        newer = str(int(SCHEMA_VERSION) + 1)
        def remedies():
            with self.assertRaises(store_module.StoreOpenError) as opened:
                Store(self.path, "test-instance", expected_binding=self.binding)
            with self.assertRaises(MigrationError) as moved:
                migrate(self.path, "test-instance", self.binding)
            return str(opened.exception), moved.exception.code, str(moved.exception)
        # A database this code is too old for is told so first, even when its
        # identity is laid out in a way this code does not know.
        self.sql("UPDATE metadata SET value=? WHERE key='schema_version'", (newer,))
        self.sql("DELETE FROM metadata WHERE key='commit_id'")
        self.sql("UPDATE metadata SET value='e2' WHERE key='authority_epoch'")
        opened, code, moved = remedies()
        self.assertIn("run code that reads version %s" % newer, opened)
        self.assertEqual(code, "SCHEMA_UNSUPPORTED")
        self.assertIn("run code that reads version %s" % newer, moved)
        # Damage comes before a changed binding in both: recovery cannot carry it either.
        self.sql("UPDATE metadata SET value='8' WHERE key='schema_version'")
        opened, code, moved = remedies()
        self.assertIn("unsupported; no automatic migration was attempted", opened)
        self.assertEqual(code, "SCHEMA_UNSUPPORTED")
        self.assertIn("commit identity is damaged", moved)

    def test_upgrade_keeps_every_record_and_fences_old_versions(self):
        before, metadata = self.records(), self.metadata()
        self.assertGreater(len(before["messages"]), 0)
        self.assertGreater(len(before["operations"]), 0)
        result = self.upgrade()
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": "8", "schema_version": SCHEMA_VERSION, "migrated": True})
        after = self.records()
        moved = self.metadata()
        self.assertEqual(moved["schema_version"], SCHEMA_VERSION)
        self.assertEqual(int(moved["commit_seq"]), int(metadata["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], metadata["commit_id"])
        for key in ("instance_id", "authority_id", "authority_path", "authority_epoch"):
            self.assertEqual(moved[key], metadata[key])
        self.assertEqual({k: v for k, v in after.items() if k != "metadata"}, {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        # The ordinary store opens the upgraded instance, reads old records and starts openings.
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["id"], "t1")
        self.store = store
        saved = self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-after", "title": "After upgrade",
                                              "participants": ["agent-a"], "body": "New", "attachments": []},
                             {"opening_id": "o1"}, {"opening_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        published = self.command("opening.publish", {}, {"opening_id": "o1"}, {"opening_revision": 1})
        self.assertEqual(published["status"], "committed", published)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(len(before["messages"]) + 1,)])

    def test_backup_and_recovery_validation_accept_only_the_current_version(self):
        with self.assertRaises(recovery_io.RecoveryError) as raised:
            recovery_io.read_metadata(self.path)
        self.assertEqual(raised.exception.code, "CANDIDATE_INVALID")
        self.upgrade()
        self.assertEqual(recovery_io.read_metadata(self.path)["schema_version"], SCHEMA_VERSION)

    def test_rerun_at_the_current_version_changes_nothing(self):
        self.upgrade()
        before = self.unchanged()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": SCHEMA_VERSION, "migrated": False})
        self.assertEqual(self.unchanged(), before)

    def test_unknown_and_newer_versions_refuse(self):
        for version in ("7", str(int(SCHEMA_VERSION) + 1), "", "8 "):
            with self.subTest(version=version):
                self.sql("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.upgrade()
                self.assertEqual(raised.exception.code, "SCHEMA_UNSUPPORTED")
                self.assertEqual(self.unchanged(), before)

    def test_refuses_while_the_runner_guard_is_held(self):
        before = self.unchanged()
        with Authority(self.path.resolve(), "test-instance", self.binding).runner_guard("runner"):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
            self.assertEqual(raised.exception.code, "RUNNER_GUARD_HELD")
            code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                         "--binding", str(self.profile))
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (2, "RUNNER_GUARD_HELD", False))
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])

    def test_wrong_instance_or_binding_refuses(self):
        before = self.unchanged()
        self.sql("UPDATE metadata SET value='other' WHERE key='instance_id'")
        changed = self.unchanged()
        with self.assertRaises(AuthorityError):
            migrate(self.path, "other", self.binding)
        with self.assertRaises(MigrationError) as raised:
            self.upgrade()
        self.assertEqual(raised.exception.code, "INSTANCE_MISMATCH")
        self.assertEqual(self.unchanged(), changed)
        self.sql("UPDATE metadata SET value='test-instance' WHERE key='instance_id'")
        self.assertEqual(self.unchanged()[1], before[1])
        with self.assertRaises(AuthorityError):
            migrate(self.path, "test-instance", dict(self.binding, authority_epoch="e-other"))
        self.assertEqual(self.metadata()["schema_version"], "8")

    def test_a_failure_mid_upgrade_commits_nothing(self):
        before = self.unchanged()
        failing = (("8", "9", migrations.OPENING_SCHEMA + ["CREATE TABLE openings (id TEXT)"]) + migrations.STEPS[0][3:],) + migrations.STEPS[1:]
        with mock.patch.object(migrations, "STEPS", failing):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
        self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
        self.assertEqual(self.unchanged(), before)
        # A Core check that fails before the commit is a failure that changed nothing, not an unconfirmed one.
        with mock.patch.object(Store, "_advance_commit_seq", side_effect=StoreError("commit identity unavailable")):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
            self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (2, "MIGRATION_FAILED", False))
        self.assertEqual(self.unchanged(), before)
        self.assertNotIn("openings", "".join(schema(self.path)))
        self.assertTrue(self.upgrade()["migrated"])

    def test_a_commit_error_after_the_commit_point_is_unconfirmed(self):
        connect = store_module._connect

        class LandsThenFails:
            # SQLite can fail the directory sync after deleting the journal, its commit point.
            def __init__(self, db):
                self.db = db

            def __getattr__(self, name):
                return getattr(self.db, name)

            def commit(self):
                self.db.commit()
                raise sqlite3.OperationalError("disk I/O error")

        def landing(path):
            db, actual = connect(path)
            return LandsThenFails(db), actual
        with mock.patch.object(store_module, "_connect", landing):
            code, result, _ = self.migrate_command()
        self.assertEqual((code, result["ok"], result["error"]["code"], result["error"]["retryable"]), (1, False, "UNCONFIRMED", False))
        self.assertNotIn("nothing was changed", result["error"]["message"])
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
        code, result, _ = self.migrate_command()
        self.assertEqual((code, result["migrated"]), (0, False), "running migrate again reports the landed upgrade")

    def test_busy_refusals_are_retryable_and_change_nothing(self):
        before = self.unchanged()
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (75, "DATABASE_BUSY", True))
        finally:
            writer.close()
        self.assertEqual(self.unchanged(), before)
        # A recovery activation or cutover holds the authority lock exclusively.
        fd = os.open(str(Authority(self.path.resolve(), "test-instance", self.binding).path) + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (75, "AUTHORITY_BUSY", True))
        finally:
            os.close(fd)
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.migrate_command()[0], 0)

    def test_step_back_restores_version_8_while_no_opening_exists(self):
        self.upgrade()
        upgraded, records = self.metadata(), self.records()
        result = migrate(self.path, "test-instance", self.binding, "8")
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": "8", "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_8))
        moved = self.metadata()
        self.assertEqual(moved["schema_version"], "8")
        # The commit lineage moves forward: a stale v8 copy can never pass as this instance.
        self.assertEqual(int(moved["commit_seq"]), int(upgraded["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], upgraded["commit_id"])
        for key in ("instance_id", "authority_id", "authority_path", "authority_epoch"):
            self.assertEqual(moved[key], upgraded[key])
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        # Current code is fenced again, and the step is repeatable.
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        before = self.unchanged()
        self.assertFalse(migrate(self.path, "test-instance", self.binding, "8")["migrated"])
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(int(self.metadata()["commit_seq"]), int(moved["commit_seq"]) + 1)

    def test_step_back_refuses_while_any_opening_exists(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        saved = self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-kept", "title": "Kept",
                                              "participants": ["agent-a"], "body": "Words", "attachments": []},
                             {"opening_id": "o1"}, {"opening_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        for state in ("open", "published", "discarded"):
            with self.subTest(state=state):
                self.sql("UPDATE openings SET state=?", (state,))
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    migrate(self.path, "test-instance", self.binding, "8")
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                             "--binding", str(self.profile), "--to", "8")
                self.assertEqual((code, result["error"]["code"]), (2, "RECORDS_WOULD_BE_LOST"))
                self.assertEqual(self.unchanged(), before)

    def test_step_back_is_fenced_like_an_upgrade(self):
        self.upgrade()
        before = self.unchanged()
        with Authority(self.path.resolve(), "test-instance", self.binding).runner_guard("runner"):
            with self.assertRaises(MigrationError) as raised:
                migrate(self.path, "test-instance", self.binding, "8")
            self.assertEqual(raised.exception.code, "RUNNER_GUARD_HELD")
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            with self.assertRaises(MigrationError) as raised:
                migrate(self.path, "test-instance", self.binding, "8")
            self.assertEqual(raised.exception.code, "DATABASE_BUSY")
        finally:
            writer.close()
        for target in ("7", str(int(SCHEMA_VERSION) + 1), "", "8 "):
            with self.subTest(target=target):
                with self.assertRaises(MigrationError) as raised:
                    migrate(self.path, "test-instance", self.binding, target)
                self.assertEqual(raised.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                     "--binding", str(self.profile), "--to", "8")
        self.assertEqual((code, result["ok"], result["schema_version"], result["migrated"]), (0, True, "8", True))

    def test_admin_migrates_then_registers_an_actor(self):
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "other", "--binding", str(self.profile))
        self.assertEqual((code, result["error"]["code"]), (2, "BINDING_MISMATCH"))
        code, result, _ = self.admin("add-actor", "--profile", str(self.profile), "--id", "new", "--kind", "agent", "--name", "N")
        self.assertEqual(code, 2)
        self.assertEqual(self.metadata()["schema_version"], "8")
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))
        self.assertEqual((code, result["ok"], result["migrated"], result["schema_version"]), (0, True, True, SCHEMA_VERSION))
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))
        self.assertEqual((code, result["migrated"]), (0, False))
        sequence = int(self.metadata()["commit_seq"])
        code, result, _ = self.admin("add-actor", "--profile", str(self.profile), "--id", "new-agent", "--kind", "agent",
                                     "--name", "New agent")
        self.assertEqual((code, result["actor"]), (0, {"id": "new-agent", "kind": "agent", "name": "New agent", "enabled": True}))
        self.assertEqual(self.sql("SELECT kind,name,enabled FROM actors WHERE id='new-agent'"), [("agent", "New agent", 1)])
        self.assertEqual(int(self.metadata()["commit_seq"]), sequence + 1)
        before = self.unchanged()
        for argv, expected in ((("--id", "new-agent", "--kind", "human", "--name", "Again"), "ACTOR_EXISTS"),
                               (("--id", "owner", "--kind", "agent", "--name", "Owner"), "ACTOR_EXISTS"),
                               (("--id", "robot", "--kind", "robot", "--name", "Robot"), "INVALID_ARGUMENT"),
                               (("--id", "blank", "--kind", "agent", "--name", " "), "INVALID_ARGUMENT")):
            with self.subTest(argv=argv):
                code, result, _ = self.admin("add-actor", "--profile", str(self.profile), *argv)
                self.assertEqual((code, result["error"]["code"]), (2, expected))
        self.assertEqual(self.unchanged(), before)
        # A registered actor can be bound with the ordinary profile writer.
        self.store = load_profile(str(self.profile)).store()
        added = self.command("workspace.create", {"id": "w-new", "title": "Theirs"}, actor="new-agent")
        self.assertEqual(added["status"], "committed", added)
        code, _, err = self.admin("migrate", "--db", "relative.sqlite3", "--instance", "x", "--binding", str(self.profile))
        self.assertEqual(code, 2)
        self.assertIn("usage", err)
        code, _, err = self.admin("vacuum")
        self.assertEqual(code, 2)


HOSTED_THREAD = "12345678-1234-4234-8234-123456789abc"


class CommitIdentityCase(fixtures.StoreCase):
    """The commit identity a store accepts is exactly the one it writes."""

    def refused(self, statement, params=()):
        self.sql(statement, params)
        with self.assertRaises(StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))

    def test_each_damaged_form_is_refused(self):
        cases = {
            "padded past nineteen digits": ("UPDATE metadata SET value=? WHERE key='commit_seq'", ("0" * 20 + "5",)),
            "at SQLite's largest integer": ("UPDATE metadata SET value='9223372036854775807' WHERE key='commit_seq'", ()),
            "a commit_id one character too long": ("UPDATE metadata SET value=value||'a' WHERE key='commit_id'", ()),
            "a commit_seq stored as bytes": ("UPDATE metadata SET value=x'35' WHERE key='commit_seq'", ()),
            "a missing commit_seq": ("DELETE FROM metadata WHERE key='commit_seq'", ()),
        }
        for name, (statement, params) in cases.items():
            with self.subTest(name):
                saved = self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')")
                self.refused(statement, params)
                self.sql("DELETE FROM metadata WHERE key IN ('commit_seq','commit_id')")
                for key, value in saved:
                    self.sql("INSERT INTO metadata VALUES (?,?)", (key, value))
                Store(self.path, "test-instance", expected_binding=self.binding)

    def test_the_sequence_stops_where_the_store_would_stop_accepting_it(self):
        self.sql("UPDATE metadata SET value='9223372036854775805' WHERE key='commit_seq'")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.workspace()["status"], "committed")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("9223372036854775806",)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        with self.assertRaises(StoreError):
            self.command("workspace.create", {"id": "w2", "title": "One more", "purpose": "", "team": []})
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("9223372036854775806",)])
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces WHERE id='w2'"), [(0,)])
        Store(self.path, "test-instance", expected_binding=self.binding)


class Schema9Case(MigrationCase):
    """A schema-9 instance: version 10 adds handed_seq, hosted_turns and hosted_children."""

    VERSION, FIXTURE = "9", SCHEMA_9

    def hosted_pin(self, store, guard):
        home = Path(self.temp.name) / "codex-home"
        home.mkdir(exist_ok=True)
        return store.provision_route_pin(guard, "agent-a", {"kind": "codex-hosted-stdio", "protocol_version": 1,
                                                            "codex_home": str(home.resolve()), "thread_id": HOSTED_THREAD})

    def hand_a_turn(self):
        """Settle agent-a's due wake as handed to a hosted turn, through the ordinary Core acts."""
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        with store.runner_guard("hosting") as guard:
            self.assertEqual(self.hosted_pin(store, guard)["status"], "provisioned")
            token = store.acquire_runner(guard)["runner_token"]
            claim = store.claim_wakes(guard, token, ["agent-a"])["claims"][0]
            result = store.finish_wake(guard, token, claim["claim_token"], "handed", turn={
                "thread_id": HOSTED_THREAD, "turn_id": "turn-1", "mode": "start",
                "client_id": "theseus:" + claim["attempt_id"], "announced_seq": claim["captured_seq"]})
        self.assertEqual((result["status"], result["wake_status"]), ("settled", "handed"), result)
        return store, result

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "9")

    def refused(self):
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)

    def test_upgrade_from_9_keeps_records_matches_a_fresh_instance_and_hosts(self):
        before, metadata = self.records(), self.metadata()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "9", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(int(self.metadata()["commit_seq"]), int(metadata["commit_seq"]) + 1)
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"}, {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE handed_seq IS NOT NULL"), [(0,)])
        self.assertGreater(self.sql("SELECT count(*) FROM recipient_schedule")[0][0], 0)
        _, result = self.hand_a_turn()
        self.assertEqual(self.sql("SELECT handed_seq FROM recipient_schedule WHERE recipient_id='agent-a'"), [(result["handed_seq"],)])
        self.assertEqual(self.sql("SELECT mode,turn_id FROM hosted_turns"), [("start", "turn-1")])

    def test_step_back_to_9_restores_its_frozen_layout_while_nothing_is_hosted(self):
        self.upgrade()
        upgraded, records = self.metadata(), self.records()
        self.assertEqual(self.step_back(), {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": "9", "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_9))
        moved = self.metadata()
        self.assertEqual(int(moved["commit_seq"]), int(upgraded["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], upgraded["commit_id"])
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        before = self.unchanged()
        self.assertFalse(self.step_back()["migrated"])
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(0,)])

    def test_step_back_refuses_while_a_handed_seq_is_set(self):
        self.upgrade()
        self.sql("UPDATE recipient_schedule SET handed_seq=1 WHERE recipient_id='agent-a'")
        self.refused()

    def test_step_back_refuses_while_a_hosted_turn_exists(self):
        self.upgrade()
        store, _ = self.hand_a_turn()
        # The agent acknowledges its work, so handed_seq clears and only the turn row remains.
        self.store = store
        for item in store.view("agent-a", "deliveries", {})["items"]:
            self.assertEqual(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a")["status"], "committed")
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE handed_seq IS NOT NULL"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(1,)])
        # Remove the hosted pin by hand, so the turn row is the only hosted record left.
        self.sql("DELETE FROM metadata WHERE key LIKE 'route_pin.v1:%'")
        self.refused()

    def test_step_back_refuses_while_a_hosted_child_is_recorded(self):
        self.upgrade()
        self.sql("INSERT INTO hosted_children(id,runner_token,codex_home,pid,started_at,spawned_ms) VALUES ('h1','r-x','/h',1,'s',1)")
        self.refused()

    def test_step_back_refuses_while_a_hosted_route_pin_exists(self):
        self.upgrade()
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        with store.runner_guard("provision") as guard:
            self.hosted_pin(store, guard)
        self.refused()

    def test_step_back_refuses_while_an_attempt_carries_a_handed_seq(self):
        self.upgrade()
        self.sql("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms,handed_seq) "
                 "VALUES ('a-1','c-1','r-x','agent-a',1,1,1,2,1)")
        self.refused()

    def test_a_queue_route_pin_does_not_hold_the_step_back(self):
        self.upgrade()
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        home = Path(self.temp.name) / "queue-home"
        home.mkdir()
        with store.runner_guard("provision") as guard:
            store.provision_route_pin(guard, "agent-a", {"kind": "codex-queue-stdio", "protocol_version": 1,
                                                          "codex_home": str(home.resolve()), "thread_id": HOSTED_THREAD})
        self.assertTrue(self.step_back()["migrated"])

    def test_a_step_back_never_runs_an_upgrade_step(self):
        # 9 -> 8 is one step back; it must not pass through 10 on the way.
        broken = migrations.STEPS[:1] + (("9", "10", ["CREATE TABLE openings (id TEXT)"]) + migrations.STEPS[1][3:],) + migrations.STEPS[2:]
        with mock.patch.object(migrations, "STEPS", broken):
            self.assertTrue(migrate(self.path, "test-instance", self.binding, "8")["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_8))


class Schema10Case(MigrationCase):
    """A schema-10 instance: version 11 adds where each topic stands."""

    VERSION, FIXTURE = "10", SCHEMA_10

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "10")

    def update(self, args, actor="owner"):
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        version = store.view(actor, "topic", {"topic_id": "t1"})["topic"]["version"]
        self.store = store
        return self.command("topic.update", args, {"topic_id": "t1"}, {"topic_revision": version}, actor=actor)

    def refused(self):
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)

    def test_upgrade_from_10_keeps_records_matches_a_fresh_instance_and_states_topics(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "10", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Every existing topic keeps its columns and starts active, listed, with no note.
        self.assertEqual(self.sql("SELECT id,workspace_id,title,creator_id,version,state,archived,state_note,state_by,state_ms FROM topics"),
                         [tuple(row) + ("active", 0, "", None, None) for row in before["topics"]])
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.update({"state": "waiting", "waiting_on": ["agent-b"], "note": "Needs a decision"})["status"], "committed")

    def test_step_back_to_10_restores_its_frozen_layout_while_no_topic_says_where_it_stands(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_10))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        self.assertEqual(self.sql("SELECT * FROM topics"), [tuple(row) for row in records["topics"]])

    def test_step_back_refuses_while_any_topic_says_where_it_stands(self):
        for args, actor in (({"state": "done"}, "owner"), ({"note": "Halfway"}, "owner"), ({"archived": True}, "owner"),
                            ({"state": "active"}, "owner")):
            with self.subTest(args=args):
                self.setUp()
                self.upgrade()
                self.assertEqual(self.update(args, actor)["status"], "committed")
                self.refused()


class Schema11Case(MigrationCase):
    """A schema-11 instance: version 12 records when each message is sent."""

    VERSION, FIXTURE = "11", SCHEMA_11

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "11")

    def send(self):
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        source = {"kind": "topic", "id": "t1"}
        self.assertEqual(self.save_draft("after", source, "t1", "After the upgrade")["status"], "committed")
        self.assertEqual(self.prepare("after", "t1", submission="after", send_op="send-after")["status"], "committed")
        return self.command("message.send", {"submission_id": "after"}, target={"topic_id": "t1"}, op="send-after")

    def test_upgrade_from_11_keeps_records_matches_a_fresh_instance_and_times_new_messages(self):
        before = self.records()
        self.assertTrue(before["messages"], "the fixture holds messages sent before times were kept")
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "11", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Earlier messages have no time to show.
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE sent_ms IS NOT NULL"), [(0,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        start = int(time.time() * 1000)
        self.assertEqual(self.send()["status"], "committed")
        [(sent,)] = self.sql("SELECT sent_ms FROM messages WHERE body='After the upgrade'")
        self.assertGreaterEqual(sent, start)
        self.assertLessEqual(sent, int(time.time() * 1000))

    def wait_at_11(self):
        """t1, archived, waits on agent-b and on someone who lost it before version 12 pruned such rows."""
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('gone','agent','Lost the topic')")
            db.execute("UPDATE topics SET state='waiting',state_by='owner',state_ms=1234,archived=1 WHERE id='t1'")
            db.executemany("INSERT INTO topic_waiting VALUES ('t1',?)", [("agent-b",), ("gone",)])

    def test_upgrade_from_11_orders_what_waits_and_drops_who_cannot_read_it(self):
        self.wait_at_11()
        self.upgrade()
        self.assertEqual(self.sql("SELECT topic_id,actor_id,state_ms,archived FROM topic_waiting"), [("t1", "agent-b", 1234, 1)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # An archived topic waits without counting; unarchived, it counts again.
        self.assertEqual(self.store.view("agent-b", "attention", {})["waiting_on_me"], 0)
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.assertEqual(self.command("topic.update", {"archived": False}, {"topic_id": "t1"}, {"topic_revision": version})["status"], "committed")
        attention = self.store.view("agent-b", "attention", {})
        self.assertEqual((attention["waiting_on_me"], [item["id"] for item in attention["latest_waiting"]]), (1, ["t1"]))

    def test_step_back_to_11_keeps_who_a_topic_waits_on(self):
        self.wait_at_11()
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b")])

    def test_step_back_to_11_restores_its_frozen_layout_while_no_message_has_a_time(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_message_has_a_time(self):
        self.upgrade()
        self.assertEqual(self.send()["status"], "committed")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class EarlySchema12Case(Schema11Case):
    """A database stamped 12 by the earlier form of that step, which timed messages
    but did not order what waits on each reader. Its stamp says current; its shape does not."""

    VERSION, FIXTURE, LAYOUT = "12", SCHEMA_12_EARLY, "12-early"

    def test_opening_refuses_it_and_names_migrate(self):
        before = self.unchanged()
        with self.assertRaises(StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertIn("aim-next-admin migrate", str(raised.exception))
        self.assertEqual(self.unchanged(), before)

    def test_migrate_finishes_the_step_and_orders_what_waits(self):
        self.wait_at_11()
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "12", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT topic_id,actor_id,state_ms,archived FROM topic_waiting"), [("t1", "agent-b", 1234, 1)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("agent-b", "attention", {})["waiting_on_me"], 0)
        self.assertEqual(self.upgrade()["migrated"], False)

    def test_step_back_to_11_finishes_the_step_first(self):
        self.wait_at_11()
        # Only a database whose messages carry no time can step back; messages are immutable.
        self.sql("ALTER TABLE messages DROP COLUMN sent_ms")
        self.sql("ALTER TABLE messages ADD COLUMN sent_ms INTEGER")
        self.assertEqual(schema(self.path), frozen(SCHEMA_12_EARLY))
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b")])


class Schema12Case(MigrationCase):
    """A schema-12 instance: version 13 keeps the messages each person marked unread."""

    VERSION, FIXTURE = "12", SCHEMA_12

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "12")

    def mark(self, marked, revision):
        message = self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]
        return self.command("message.mark", {"marked": marked}, target={"message_id": message},
                            expected={"mark_revision": revision})

    def test_upgrade_from_12_keeps_records_matches_a_fresh_instance_and_marks(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "12", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.mark(True, 0)["result"]["mark_revision"], 1)
        self.assertEqual(self.store.view("owner", "attention", {})["unread"], 1)

    def test_step_back_to_12_restores_its_frozen_layout_while_no_mark_exists(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_12))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_while_any_mark_exists_cleared_or_not(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for marked, revision in ((True, 0), (False, 1)):
            with self.subTest(marked=marked):
                self.assertEqual(self.mark(marked, revision)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema13Case(MigrationCase):
    """A schema-13 instance: version 14 records whether a message to someone asks or tells."""

    VERSION, FIXTURE = "13", SCHEMA_13

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "13")

    def post(self, **args):
        return self.command("message.post", dict({"body": "For agent-b", "addressees": ["agent-b"]}, **args),
                            target={"topic_id": "t1"})

    def test_upgrade_from_13_keeps_records_matches_a_fresh_instance_and_records_intent(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "13", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Messages sent before the upgrade said neither.
        self.assertEqual(self.sql("SELECT DISTINCT intent FROM messages"), [(None,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.post(intent="ask")["status"], "committed")
        self.assertEqual(self.sql("SELECT intent FROM messages ORDER BY seq DESC LIMIT 1"), [("ask",)])

    def test_step_back_to_13_restores_its_frozen_layout_while_no_message_says_ask_or_tell(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_13))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_a_wait_said_before_the_upgrade_stays_said_and_survives_a_step_back(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topics SET state='waiting',state_by='owner',state_ms=1234 WHERE id='t1'")
            db.execute("INSERT INTO topic_waiting(topic_id,actor_id,state_ms,archived) VALUES ('t1','agent-b',1234,0)")
        self.upgrade()
        self.assertEqual(self.sql("SELECT topic_id,actor_id,said,ask_message_id FROM topic_waiting"), [("t1", "agent-b", 1, None)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual((topic["waiting_on"], topic["asks"]), (["agent-b"], []))
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b", 1234, 0)])

    def test_step_back_refuses_once_a_message_asks_or_tells(self):
        for intent in ("tell", "ask"):
            with self.subTest(intent=intent):
                self.upgrade()
                self.store = Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertEqual(self.post(intent=intent)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
                self.setUp()


class Schema14Case(MigrationCase):
    """A schema-14 instance: version 15 keeps the latest hosted turn in each topic."""

    VERSION, FIXTURE = "14", SCHEMA_14

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "14")

    def test_upgrade_from_14_keeps_records_matches_a_fresh_instance_and_reads_work(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "14", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # A topic from before the upgrade has its posts as its activity, and no turn.
        work = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["work"]
        self.assertEqual((work["by"], work["how"]), ("owner", "posted"))

    def test_step_back_to_14_restores_its_frozen_layout_while_no_turn_is_recorded(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_14))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_turn_in_a_topic_is_recorded(self):
        self.upgrade()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO topic_turns VALUES ('t1',1234,'agent-a')")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema15Case(MigrationCase):
    """A schema-15 instance: version 16 indexes what each reader has not replied to."""

    VERSION, FIXTURE = "15", SCHEMA_15

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "15")

    def reply(self, actor, parent, key):
        self.committed_post(actor, {"body": "Answer " + key, "reply_to": parent}, key)

    def committed_post(self, actor, args, key):
        receipt = self.command("message.post", args, target={"topic_id": "t1"}, actor=actor, op="post-" + key)
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]["message_id"]

    def horizons(self):
        return dict(((topic, actor), seq) for topic, actor, seq in self.sql("SELECT topic_id,actor_id,seq FROM reply_horizons"))

    def test_upgrade_from_15_keeps_records_and_matches_a_fresh_instance(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "15", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))

    def test_upgrade_to_16_works_out_where_each_readers_unanswered_messages_begin(self):
        # Written at version 15, before any horizon was kept: agent-a asks, the
        # owner posts to the whole topic, agent-a asks twice more, and the owner
        # answers the first of those. Version 17 code reads these horizons.
        with sqlite3.connect(str(self.path)) as db:
            def post(key, author, reply_to=None):
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,operation_id) "
                           "VALUES (?,'t1',?,'Body','[]','[]','[]',?,?)", (key, author, reply_to, "op-" + key))
                return db.execute("SELECT seq FROM messages WHERE id=?", (key,)).fetchone()[0]
            post("m-before", "agent-a")
            post("m-everyone", "owner")
            answered = post("m-answered", "agent-a")
            waiting = post("m-waiting", "agent-a")
            answer = post("m-answer", "owner", "m-answered")
        self.assertTrue(migrate(self.path, "test-instance", self.binding, "16")["migrated"])
        horizons = self.horizons()
        self.assertEqual(horizons[("t1", "owner")], waiting, "the post to everyone answered what came before; the reply answered one")
        self.assertEqual(horizons[("t1", "agent-a")], answer, "the owner's answer came after agent-a's last post to the topic")
        self.assertLess(answered, waiting)

    def test_step_back_to_15_restores_its_frozen_layout_even_with_replies(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        opening = self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]
        self.reply("agent-a", opening, "a")
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_15))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})


class Schema16Case(MigrationCase):
    """A schema-16 instance: version 17 keeps the color each person chose for an agent."""

    VERSION, FIXTURE = "16", SCHEMA_16

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "16")

    def choose(self, color, revision):
        return self.command("color.set", {"color": color}, target={"actor_id": "agent-a"},
                            expected={"color_revision": revision})

    def test_upgrade_from_16_keeps_records_matches_a_fresh_instance_and_keeps_choices(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "16", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.choose("rose", 0)["result"]["color_revision"], 1)
        self.assertEqual(self.store.view("owner", "colors", {})["items"], [{"actor_id": "agent-a", "color": "rose", "color_revision": 1}])

    def test_step_back_to_16_restores_its_frozen_layout_while_no_choice_exists(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_16))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_while_any_choice_exists_reset_or_not(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for color, revision in (("rose", 0), (None, 1)):
            with self.subTest(color=color):
                self.assertEqual(self.choose(color, revision)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema17Case(MigrationCase):
    """A schema-17 instance: version 18 places the New line by what each reader has read."""

    VERSION, FIXTURE = "17", SCHEMA_17

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "17")

    def horizons(self):
        return sorted(self.sql("SELECT topic_id,actor_id,seq FROM reply_horizons"))

    def test_upgrade_from_17_keeps_records_matches_a_fresh_instance_and_finds_the_oldest_unread(self):
        # agent-a has the opening pending (a delivery from before the upgrade, with no topic of its own yet).
        opening = self.sql("SELECT id,seq FROM messages ORDER BY seq LIMIT 1")[0]
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "17", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL OR topic_id<>"
                                  "(SELECT topic_id FROM messages WHERE id=deliveries.message_id)"), [(0,)],
                         "every delivery's topic is copied from its message")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        answer = self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})
        self.assertEqual(answer["oldest_unread"], {"seq": opening[1], "id": opening[0]})

    def test_step_back_to_17_restores_its_frozen_layout_and_works_out_the_horizons_again(self):
        # Horizons as version 17 kept them, after replies and posts to the whole topic.
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        def post(actor, key, **args):
            receipt = self.command("message.post", dict(args, body=key), target={"topic_id": "t1"}, actor=actor, op="post-" + key)
            self.assertEqual(receipt["status"], "committed", receipt)
            return receipt["result"]["message_id"]
        asked = post("agent-a", "asked")
        post("agent-a", "waiting")
        post("owner", "answer", reply_to=asked)
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_17))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        stepped = self.horizons()
        # The same horizons the 15->16 step works out from the same messages.
        self.sql("DELETE FROM reply_horizons")
        from aim_next.conversation import UNANSWERED_BACKFILL
        for statement in UNANSWERED_BACKFILL:
            self.sql(statement)
        self.assertEqual(stepped, self.horizons())
        waiting = self.sql("SELECT seq FROM messages WHERE body='waiting'")[0][0]
        self.assertIn(("t1", "owner", waiting), stepped, "the owner answered the ask, not the message after it")
        # And it moves up again.
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name IN ('reply_horizons','message_replies')"), [])


class Schema18Case(MigrationCase):
    """A schema-18 instance: version 19 finds the New line in the reader's live groups alone."""

    VERSION, FIXTURE = "18", SCHEMA_18

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "18")

    def headless(self):
        """Queues a delivery to agent-b with no topic, as the table alone allows."""
        with sqlite3.connect(str(self.path)) as db:
            message, group = db.execute("SELECT m.id,d.group_id FROM messages m JOIN deliveries d ON d.message_id=m.id LIMIT 1").fetchone()
            db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES ('d-headless',?,'owner',?)", (message, group))

    def test_upgrade_from_18_keeps_records_matches_a_fresh_instance_and_needs_a_topic(self):
        opening = self.sql("SELECT id,seq FROM messages ORDER BY seq LIMIT 1")[0]
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "18", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})["oldest_unread"], {"seq": opening[1], "id": opening[0]})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "a delivery names its topic"):
            self.headless()
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL"), [(0,)])

    def test_upgrade_settles_what_version_18_left_pending_for_a_person_between_others(self):
        # As version 18 queued them: every delivery pending, counted in its group and schedule.
        with sqlite3.connect(str(self.path)) as db:
            group = lambda actor, kind: db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? "
                                                   "AND active=1", (actor, kind, "" if kind == "direct" else "t1")).fetchone()[0]
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES ('owner','direct','',0),('agent-b','direct','',0) ON CONFLICT DO NOTHING")
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) SELECT actor_id,'subscription',topic_id,epoch "
                       "FROM topic_participants WHERE topic_id='t1' AND actor_id IN ('owner','agent-b') AND active=1 ON CONFLICT DO NOTHING")
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('owner',1),('agent-b',1) ON CONFLICT DO NOTHING")
            def message(key, addressees, reply_to=None):
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,operation_id) "
                                 "VALUES (?,'t1','agent-a',?,'[]','[]',?,?,?)", (key, key, json.dumps(addressees), reply_to, "op-" + key)).lastrowid
                db.executemany("INSERT INTO message_addressees VALUES ('t1',?,?)", [(actor, seq) for actor in addressees])
                for actor, reason in (("owner", "addressed" if "owner" in addressees else "subscription"),
                                      ("agent-b", "addressed" if "agent-b" in addressees else "subscription")):
                    kind = "direct" if reason == "addressed" else "subscription"
                    delivery = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id) VALUES (?,?,?,?,'t1')",
                                          ("d-%s-%s" % (key, actor), key, actor, group(actor, kind))).lastrowid
                    db.execute("INSERT INTO delivery_reasons VALUES (?,?,'t1',?)", ("d-%s-%s" % (key, actor), reason, None if kind == "direct" else 1))
                    db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=coalesce(first_pending_seq,?) WHERE id=?",
                               (delivery, group(actor, kind)))
                    db.execute("UPDATE recipient_schedule SET pending_count=pending_count+1,next_due_ms=1 WHERE recipient_id=?", (actor,))
            opening = db.execute("SELECT id FROM messages WHERE author_id='owner' ORDER BY seq LIMIT 1").fetchone()[0]
            message("between", ["agent-b"])
            message("named", ["owner"])
            message("answer", ["agent-b"], reply_to=opening)
            message("everyone", [])
        state = lambda key, actor="owner": self.sql("SELECT state FROM deliveries WHERE id=?", ("d-%s-%s" % (key, actor),))[0][0]
        self.upgrade()
        self.assertEqual([state(key) for key in ("between", "named", "answer", "everyone")], ["acknowledged", "pending", "pending", "pending"])
        self.assertEqual([state(key, "agent-b") for key in ("between", "named", "answer", "everyone")], ["pending"] * 4, "an agent's work is left as it was")
        # Every live group and schedule of a person counts exactly its pending rows.
        self.assertEqual(self.sql("SELECT g.id FROM delivery_groups g WHERE g.active=1 AND (g.pending_count<>(SELECT count(*) FROM deliveries d "
                                  "WHERE d.group_id=g.id AND d.state='pending') OR coalesce(g.first_pending_seq,0)<>coalesce((SELECT min(seq) "
                                  "FROM deliveries d WHERE d.group_id=g.id AND d.state='pending'),0))"), [])
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='owner'"), [(3,)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("owner", "attention", {})["unread"], 3, "named, the answer to the owner, and the message to everyone")

    def test_step_back_to_18_restores_its_frozen_layout(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_18))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        self.headless()
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in MigrationCase.__dict__:
        setattr(MigrationCase, _name, None)
# The schema-8 cases already run once, from MigrationCase.
for _name in list(MigrationCase.__dict__):
    if _name.startswith("test_") and _name not in Schema9Case.__dict__:
        setattr(Schema9Case, _name, None)
    if _name.startswith("test_") and _name not in Schema10Case.__dict__:
        setattr(Schema10Case, _name, None)
    if _name.startswith("test_") and _name not in Schema11Case.__dict__:
        setattr(Schema11Case, _name, None)
    if _name.startswith("test_") and _name not in Schema12Case.__dict__:
        setattr(Schema12Case, _name, None)
    if _name.startswith("test_") and _name not in Schema13Case.__dict__:
        setattr(Schema13Case, _name, None)
    if _name.startswith("test_") and _name not in Schema14Case.__dict__:
        setattr(Schema14Case, _name, None)
    if _name.startswith("test_") and _name not in Schema15Case.__dict__:
        setattr(Schema15Case, _name, None)
    if _name.startswith("test_") and _name not in Schema16Case.__dict__:
        setattr(Schema16Case, _name, None)
    if _name.startswith("test_") and _name not in Schema17Case.__dict__:
        setattr(Schema17Case, _name, None)
    if _name.startswith("test_") and _name not in Schema18Case.__dict__:
        setattr(Schema18Case, _name, None)
for _name in list(Schema11Case.__dict__):
    if _name.startswith("test_") and _name not in EarlySchema12Case.__dict__:
        setattr(EarlySchema12Case, _name, None)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import fcntl
import io
import json
import os
from pathlib import Path
import sqlite3
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
TABLES = ("actors", "workspaces", "workspace_members", "topics", "topic_participants", "topic_summaries",
          "messages", "deliveries", "delivery_reasons", "delivery_groups", "operations", "changes",
          "drafts", "submissions", "metadata")


def schema(path):
    with sqlite3.connect(str(path)) as db:
        return sorted(row[0] for row in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))


class MigrationCase(fixtures.StoreCase):
    """A schema-8 instance holding records written by the unchanged legacy commands."""

    def setUp(self):
        super().setUp()
        self.create_topic()
        self.assertEqual(self.command("participation.set", {"actor_id": "agent-b", "present": True},
                                      {"topic_id": "t1"})["status"], "committed")
        # Version 9 only adds the openings table; remove it to recover the
        # exact stored layout of version 8, proven against HEAD's frozen DDL.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP INDEX open_openings")
            db.execute("DROP TABLE openings")
            db.execute("UPDATE metadata SET value='8' WHERE key='schema_version'")
        self.assertEqual(schema(self.path), sorted(statement.rstrip(";") for statement in SCHEMA_8))
        self.profile = Path(self.temp.name) / "owner.json"
        fd = os.open(str(self.profile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(dict(self.binding, v=2, instance_id="test-instance", actor_id="owner",
                           db_path=str(self.path.resolve())), stream)

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            return {table: db.execute("SELECT * FROM " + table + " ORDER BY rowid").fetchall() for table in TABLES}

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
        for text in ("version 8", "version 9", "aim-next-admin migrate"):
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

    def test_upgrade_keeps_every_record_and_fences_old_versions(self):
        before, metadata = self.records(), self.metadata()
        self.assertGreater(len(before["messages"]), 0)
        self.assertGreater(len(before["operations"]), 0)
        result = self.upgrade()
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": "8", "schema_version": "9", "migrated": True})
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
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "9", "schema_version": "9", "migrated": False})
        self.assertEqual(self.unchanged(), before)

    def test_unknown_and_newer_versions_refuse(self):
        for version in ("7", "10", "", "8 "):
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
        failing = (("8", "9", migrations.OPENING_SCHEMA + ["CREATE TABLE openings (id TEXT)"]) + migrations.STEPS[0][3:],)
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
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": "9", "schema_version": "8", "migrated": True})
        self.assertEqual(schema(self.path), sorted(statement.rstrip(";") for statement in SCHEMA_8))
        moved = self.metadata()
        self.assertEqual(moved["schema_version"], "8")
        # The commit lineage moves forward: a stale v8 copy can never pass as this instance.
        self.assertEqual(int(moved["commit_seq"]), int(upgraded["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], upgraded["commit_id"])
        for key in ("instance_id", "authority_id", "authority_path", "authority_epoch"):
            self.assertEqual(moved[key], upgraded[key])
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        # Version 9 code is fenced again, and the step is repeatable.
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
        for target in ("7", "10", "", "8 "):
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
        self.assertEqual((code, result["ok"], result["migrated"], result["schema_version"]), (0, True, True, "9"))
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


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in MigrationCase.__dict__:
        setattr(MigrationCase, _name, None)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import json
import os
import shutil
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import store as store_module
from aim_next.authority import AuthorityError
from aim_next.contract import Refusal, StoreError
from aim_next.runner import RunnerError
import test_runner as runner_tests


@contextmanager
def observed_connections(*, before=None, after=None, close_error=None):
    """Real SQLite handles, retained until assertions and explicit cleanup."""
    original = sqlite3.connect
    observed = {"handles": [], "sql": [], "vm_steps": 0}

    class Connection(sqlite3.Connection):
        close_calls = 0

        def execute(self, sql, *args, **kwargs):
            if before is not None:
                before(self, sql)
            cursor = super().execute(sql, *args, **kwargs)
            if after is not None:
                after(self, sql)
            return cursor

        def close(self):
            self.close_calls += 1
            if close_error is not None:
                raise close_error
            return super().close()

    def connect(*args, **kwargs):
        db = original(*args, factory=Connection, **kwargs)
        observed["handles"].append(db)
        db.set_trace_callback(observed["sql"].append)
        def step():
            observed["vm_steps"] += 1
            return 0
        db.set_progress_handler(step, 1)
        return db

    try:
        with mock.patch.object(sqlite3, "connect", connect):
            yield observed
    finally:
        # The strong reference makes a missing product close observable. The
        # instrument cleans up even when that assertion deliberately fails.
        for db in observed["handles"]:
            sqlite3.Connection.close(db)


class ScheduleCase(runner_tests.RunnerCase):
    def sql(self, statement, params=()):
        db = sqlite3.connect(str(self.path))
        try:
            with db:
                return db.execute(statement, params).fetchall()
        finally:
            db.close()

    def schedule(self):
        method = getattr(self.store, "runner_schedule", None)
        self.assertTrue(callable(method), "runner_schedule must be implemented")
        return method()

    def closed(self, observed):
        self.assertEqual(len(observed["handles"]), 1)
        db = observed["handles"][0]
        self.assertEqual(db.close_calls, 1, "the created SQLite handle must close exactly once")
        with self.assertRaises(sqlite3.ProgrammingError, msg="retained handle must be unusable before error escapes"):
            sqlite3.Connection.execute(db, "SELECT 1")

    def fence_released(self):
        fd = os.open(self.binding["authority_path"] + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(fd)

    def snapshot(self):
        db = sqlite3.connect(str(self.path))
        try:
            return list(db.iterdump())
        finally:
            db.close()

    def expected_schedule(self):
        state, version, lease, reason = self.sql(
            "SELECT state,version,lease_until_ms,reason_code FROM runner_state WHERE id=1")[0]
        due = self.sql("SELECT min(next_due_ms) FROM recipient_schedule WHERE enabled=1 AND pending_count>0")[0][0]
        result = dict(instance_id="test-instance", state=state, version=version,
                      lease_until_ms=lease, next_due_ms=due)
        if reason is not None:
            result["reason_code"] = reason
        return result

    def unchanged_schedule(self):
        expected, before = self.expected_schedule(), self.snapshot()
        with observed_connections() as observed:
            result = self.schedule()
            self.closed(observed)
        self.assertEqual(result, expected)
        self.assertEqual(self.snapshot(), before, "a scheduling read must change no stored record")
        return result

    def test_fixture_health(self):
        self.assertEqual(self.sql("PRAGMA journal_mode"), [("delete",)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='pending'"), [(1,)])
        self.assertEqual(self.sql("SELECT state,version FROM runner_state"), [("idle", 1)])
        self.assertEqual(self.pending()["items"][0]["recipient_id"], "agent-a")

    def test_connect_success_leaves_handle_owned_by_caller(self):
        with observed_connections() as observed:
            db, runtime = store_module._connect(self.path)
            self.assertEqual(runtime, dict(journal_mode="delete", synchronous=3, fullfsync=1,
                                           foreign_keys=1, busy_timeout=250))
            self.assertEqual(db.close_calls, 0)
            self.assertEqual(tuple(db.execute("SELECT 1").fetchone()), (1,))
            db.close()
            self.closed(observed)

    def test_setup_errors_and_interruption_close_before_escape(self):
        cases = [("PRAGMA synchronous=EXTRA", sqlite3.OperationalError("setup injected")),
                 ("PRAGMA journal_mode", sqlite3.DatabaseError("readback injected")),
                 ("PRAGMA busy_timeout", KeyboardInterrupt())]
        for target, error in cases:
            with self.subTest(target=target, error=type(error).__name__):
                def fail(db, sql):
                    if sql == target:
                        raise error
                with observed_connections(before=fail) as observed:
                    with self.assertRaises(type(error)) as caught:
                        store_module._connect(self.path)
                    self.assertIs(caught.exception, error)
                    self.closed(observed)

    def test_settings_mismatch_closes_once(self):
        def mismatch(db, sql):
            if sql == "PRAGMA foreign_keys=ON":
                sqlite3.Connection.execute(db, "PRAGMA foreign_keys=OFF")
        with observed_connections(after=mismatch) as observed:
            with self.assertRaises(StoreError):
                store_module._connect(self.path)
            self.closed(observed)

    def test_setup_close_failure_preserves_both_errors(self):
        setup, close = sqlite3.DatabaseError("setup injected"), OSError("close injected")
        def fail(db, sql):
            raise setup
        with observed_connections(before=fail, close_error=close) as observed:
            with self.assertRaises(BaseException) as caught:
                store_module._connect(self.path)
            self.assertIs(caught.exception, close)
            self.assertIs(caught.exception.__cause__, setup, "failed cleanup must explicitly retain the setup error")
            self.assertEqual(observed["handles"][0].close_calls, 1)
            # This injected close failed before closing. Never claim it closed.
            self.assertEqual(sqlite3.Connection.execute(observed["handles"][0], "SELECT 1").fetchone()[0], 1)

    def test_exact_stored_shape_across_claim_settlement_pause_and_resume(self):
        idle = self.unchanged_schedule()
        self.assertIsNone(idle["lease_until_ms"])
        self.assertEqual(idle["next_due_ms"], self.now)
        guard = self.guard()
        token = self.token(guard)
        self.assertEqual(self.unchanged_schedule()["lease_until_ms"], 31000)
        claim = self.claim(guard, token)
        self.store.record_runner_child(guard, token, claim["claim_token"], os.getpid(), "fixture-child")
        self.assertEqual(self.unchanged_schedule()["next_due_ms"], claim["lease_until_ms"])
        settled = self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        self.assertEqual(self.unchanged_schedule()["next_due_ms"], settled["next_due_ms"])
        paused = self.store.pause_runner(guard, token, "operator_pause")
        self.assertEqual(self.unchanged_schedule()["reason_code"], "operator_pause")
        guard.close()
        resumed = self.store.resume_runner(self.guard("new-runner"), paused["version"])
        self.assertEqual(resumed["status"], "acquired")
        self.assertNotIn("reason_code", self.unchanged_schedule())
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.assertIsNone(self.unchanged_schedule()["next_due_ms"])

    def test_reserved_writer_allows_committed_read_and_exclusive_is_retryable(self):
        expected = self.expected_schedule()
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            for begin, busy in (("BEGIN IMMEDIATE", False), ("BEGIN EXCLUSIVE", True)):
                writer.execute(begin)
                try:
                    with observed_connections() as observed:
                        started = time.monotonic()
                        if busy:
                            with self.assertRaises(RunnerError) as caught:
                                self.schedule()
                            self.assertEqual(caught.exception.code, "DATABASE_BUSY")
                            self.assertIs(caught.exception.retryable, True)
                        else:
                            try:
                                result = self.schedule()
                            except RunnerError as error:
                                self.fail("a reserved writer must not block a scheduling read: " + error.code)
                            self.assertEqual(result, expected)
                        self.closed(observed)
                        print(json.dumps({"phase": "schedule_contention", "begin": begin,
                                          "seconds": time.monotonic() - started}))
                    self.fence_released()
                finally:
                    writer.rollback()
                self.assertEqual(self.unchanged_schedule(), expected)
        finally:
            writer.close()

    def test_setup_and_read_errors_close_and_remain_unconfirmed(self):
        for target in ("PRAGMA synchronous=EXTRA", "SELECT * FROM runner_state WHERE id=1"):
            for error in (sqlite3.DatabaseError("injected storage failure"),
                          sqlite3.OperationalError("disk I/O error")):
                with self.subTest(target=target, error=type(error).__name__):
                    def fail(db, sql):
                        if sql == target:
                            raise error
                    with observed_connections(before=fail) as observed:
                        with self.assertRaises(RunnerError) as caught:
                            self.schedule()
                        self.assertEqual(caught.exception.code, "RUNNER_STORAGE_ERROR")
                        self.assertFalse(caught.exception.retryable)
                        self.closed(observed)
                    self.fence_released()

    def test_cleanup_failure_cannot_be_classified_as_retryable_busy(self):
        for setup_fails in (False, True):
            with self.subTest(setup_fails=setup_fails):
                def fail(db, sql):
                    if setup_fails:
                        raise sqlite3.OperationalError("database is locked")
                close = sqlite3.OperationalError("database is busy during close")
                with observed_connections(before=fail, close_error=close) as observed:
                    with self.assertRaises(RunnerError) as caught:
                        self.schedule()
                    self.assertEqual(caught.exception.code, "RUNNER_STORAGE_ERROR")
                    self.assertFalse(caught.exception.retryable)
                    self.assertEqual(observed["handles"][0].close_calls, 1)
                self.fence_released()

    def test_schedule_interruption_closes_handle_and_fence(self):
        for target in ("PRAGMA synchronous=EXTRA", "SELECT * FROM runner_state WHERE id=1"):
            with self.subTest(target=target):
                def fail(db, sql):
                    if sql == target:
                        raise KeyboardInterrupt()
                with observed_connections(before=fail) as observed:
                    with self.assertRaises(KeyboardInterrupt):
                        self.schedule()
                    self.closed(observed)
                self.fence_released()

    def test_established_store_rechecks_instance_schema_and_binding(self):
        for key, value, code, error_type in (
                ("instance_id", "foreign-instance", "INSTANCE_MISMATCH", Refusal),
                ("schema_version", "-1", "SCHEMA_MISMATCH", Refusal),
                ("authority_epoch", "foreign-epoch", "AUTHORITY_CHANGED", AuthorityError)):
            with self.subTest(key=key):
                previous = self.sql("SELECT value FROM metadata WHERE key=?", (key,))[0][0]
                self.sql("UPDATE metadata SET value=? WHERE key=?", (value, key))
                try:
                    with observed_connections() as observed:
                        with self.assertRaises(error_type) as caught:
                            self.schedule()
                        self.assertEqual(caught.exception.code, code)
                        self.closed(observed)
                    self.fence_released()
                finally:
                    self.sql("UPDATE metadata SET value=? WHERE key=?", (previous, key))

    def test_authority_recheck_after_open_detects_replaced_database(self):
        original = self.path.with_name("original.sqlite3")
        replacement = self.path.with_name("replacement.sqlite3")
        shutil.copy2(self.path, replacement)
        swapped = []
        def swap(db, sql):
            if sql == "BEGIN":
                self.path.rename(original)
                replacement.rename(self.path)
                swapped.append(True)
        try:
            with observed_connections(after=swap) as observed:
                with self.assertRaises(AuthorityError) as caught:
                    self.schedule()
                self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")
                self.closed(observed)
            self.assertEqual(swapped, [True])
            self.fence_released()
        finally:
            if swapped:
                self.path.rename(replacement)
                original.rename(self.path)

    def test_single_snapshot_blocks_interleaved_commit_between_schedule_queries(self):
        expected = self.expected_schedule()
        writer = sqlite3.connect(str(self.path), isolation_level=None, timeout=0)
        attempted = []
        def interleave(db, sql):
            if sql == "SELECT * FROM runner_state WHERE id=1":
                self.assertTrue(db.in_transaction, "scheduling data must share a transaction")
                writer.execute("BEGIN IMMEDIATE")
                writer.execute("UPDATE runner_state SET version=version+1")
                writer.execute("UPDATE recipient_schedule SET next_due_ms=next_due_ms+100")
                with self.assertRaises(sqlite3.OperationalError) as caught:
                    writer.commit()
                self.assertIn("locked", str(caught.exception))
                attempted.append(True)
        try:
            with observed_connections(after=interleave):
                self.assertEqual(self.schedule(), expected)
            self.assertEqual(attempted, [True])
            writer.commit()
            changed = self.unchanged_schedule()
            self.assertEqual(changed["version"], expected["version"] + 1)
            self.assertEqual(changed["next_due_ms"], expected["next_due_ms"] + 100)
        finally:
            writer.close()

    def test_indexed_schedule_work_does_not_grow_with_eligible_recipients(self):
        with observed_connections() as before:
            expected = self.schedule()
        started = time.monotonic()
        db = sqlite3.connect(str(self.path))
        try:
            message = db.execute("SELECT id FROM messages LIMIT 1").fetchone()[0]
            for index in range(2048):
                actor = "bulk-agent-%04d" % index
                db.execute("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", (actor, actor))
                group = db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,'direct','',0)", (actor,)).lastrowid
                did = "bulk-wake-%s" % index
                seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES (?,?,?,?)", (did, message, actor, group)).lastrowid
                db.execute("INSERT INTO delivery_reasons VALUES (?,'addressed','t1',NULL)", (did,))
                db.execute("UPDATE delivery_groups SET pending_count=1,first_pending_seq=? WHERE id=?", (seq, group))
                db.execute("INSERT INTO recipient_schedule(recipient_id,enabled,pending_count,wake_generation,last_seq,next_due_ms) VALUES (?,1,1,1,?,?)", (actor, seq, self.now + index + 1))
            db.commit()
        finally:
            db.close()
        seed_seconds = time.monotonic() - started
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE enabled=1 AND pending_count>0"), [(2049,)])
        with observed_connections() as after:
            self.assertEqual(self.schedule(), expected)
        self.assertGreater(before["vm_steps"], 0)
        print(json.dumps({"phase": "schedule_growth", "seed_seconds": seed_seconds,
                          "before_vm": before["vm_steps"], "after_vm": after["vm_steps"],
                          "before_sql": before["sql"], "after_sql": after["sql"]}))
        self.assertLessEqual(after["vm_steps"], before["vm_steps"] + 100,
                             "scheduling VM work must not enumerate eligible recipients")


# Reuse the public fixture helpers without collecting the whole runner suite.
for _base in runner_tests.RunnerCase.__mro__:
    for _name in _base.__dict__:
        if _name.startswith("test_") and _name not in ScheduleCase.__dict__:
            setattr(ScheduleCase, _name, None)


if __name__ == "__main__":
    unittest.main()

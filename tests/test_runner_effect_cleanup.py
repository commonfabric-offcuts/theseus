from __future__ import annotations

from contextlib import contextmanager
import sqlite3
import unittest
from unittest import mock

from aim_next.authority import GuardBusy
from aim_next.runner import RunnerError
import test_runner as runner_tests


@contextmanager
def effect_connections(*, before=None, rollback_error=None, close_error=None):
    """Retain real handles; injected failures happen before the real operation."""
    connect = sqlite3.connect
    observed = {"handles": [], "events": [], "sql": []}

    class Connection(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            if before is not None:
                before(self, sql)
            return super().execute(sql, *args, **kwargs)

        def rollback(self):
            observed["events"].append("rollback")
            if rollback_error is not None:
                raise rollback_error
            return super().rollback()

        def commit(self):
            observed["events"].append("commit")
            return super().commit()

        def close(self):
            observed["events"].append("close")
            if close_error is not None:
                raise close_error
            return super().close()

    def retained(*args, **kwargs):
        db = connect(*args, factory=Connection, **kwargs)
        observed["handles"].append(db)
        db.set_trace_callback(observed["sql"].append)
        return db

    try:
        with mock.patch.object(sqlite3, "connect", retained):
            yield observed
    finally:
        # Bypass the deliberate failing override. Never count this test-owned
        # cleanup as a successful product close; assertions precede it.
        for db in observed["handles"]:
            sqlite3.Connection.close(db)


def fail_at(statement, error):
    def before(db, sql):
        if sql == statement:
            raise error
    return before


class EffectCleanupCase(runner_tests.RunnerCase):
    def sql(self, statement, params=()):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute(statement, params).fetchall()
        finally:
            db.close()

    def snapshot(self):
        db = sqlite3.connect(str(self.path))
        try:
            return list(db.iterdump())
        finally:
            db.close()

    def identity(self):
        return dict(self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')"))

    def failure(self, call):
        try:
            call()
        except BaseException as error:
            return error
        self.fail("the public effect unexpectedly returned success")

    def storage_error(self, error):
        self.assertIsInstance(error, RunnerError, "cleanup uncertainty must be a typed runner error")
        self.assertEqual(error.code, "RUNNER_STORAGE_ERROR", "cleanup cannot be retryable busy")
        self.assertIs(error.retryable, False)
        self.assertEqual(str(error), "Runner state could not be confirmed")

    def busy_error(self, error):
        self.assertIsInstance(error, RunnerError)
        self.assertEqual(error.code, "DATABASE_BUSY")
        self.assertIs(error.retryable, True)

    def chain_contains(self, error, *expected):
        pending, seen = [error], set()
        while pending:
            item = pending.pop()
            if item is None or id(item) in seen:
                continue
            seen.add(id(item))
            pending.extend((item.__cause__, item.__context__))
        for item in expected:
            self.assertIn(id(item), seen, "originating exception identity must survive cleanup")

    def closed(self, observed):
        self.assertEqual(len(observed["handles"]), 1)
        self.assertEqual(observed["events"].count("close"), 1, "product must attempt exactly one close")
        with self.assertRaises(sqlite3.ProgrammingError, msg="retained real handle must be closed before escape"):
            sqlite3.Connection.execute(observed["handles"][0], "SELECT 1")

    def still_open(self, observed):
        self.assertEqual(len(observed["handles"]), 1)
        self.assertEqual(observed["events"].count("close"), 1)
        self.assertEqual(sqlite3.Connection.execute(observed["handles"][0], "SELECT 1").fetchone()[0], 1,
                         "a failed close must not be described as a closed handle")

    def held(self, guard):
        guard.verify()
        with self.assertRaises(GuardBusy):
            with self.store.runner_guard("other-test-runner"):
                self.fail("effect cleanup released the caller's guard")

    def test_chained_setup_close_failure_is_never_retryable(self):
        guard = self.guard()
        baseline = self.snapshot()
        for close in (sqlite3.OperationalError("database is busy during close"),
                      OSError("busy close I/O error"), KeyboardInterrupt("close interrupted")):
            with self.subTest(close=type(close).__name__):
                setup = sqlite3.DatabaseError("setup failed")
                with effect_connections(before=fail_at("PRAGMA synchronous=EXTRA", setup), close_error=close) as seen:
                    error = self.failure(lambda: self.store.acquire_runner(guard))
                    self.still_open(seen)
                    self.assertEqual(seen["events"], ["close"])
                    self.storage_error(error)
                    self.assertIs(error.__cause__, close)
                    self.assertIs(close.__cause__, setup)
                    self.chain_contains(error, close, setup)
                self.assertEqual(self.snapshot(), baseline)
                self.held(guard)

    def test_failed_rollback_still_closes_before_storage_error(self):
        guard = self.guard()
        baseline = self.snapshot()
        for rollback in (sqlite3.OperationalError("busy rollback"), OSError("rollback I/O"),
                         KeyboardInterrupt("rollback interrupted")):
            with self.subTest(rollback=type(rollback).__name__):
                read = sqlite3.DatabaseError("state read failed")
                with effect_connections(before=fail_at("SELECT * FROM runner_state WHERE id=1", read),
                                        rollback_error=rollback) as seen:
                    error = self.failure(lambda: self.store.acquire_runner(guard))
                    self.assertEqual(seen["events"], ["rollback", "close"], "rollback failure must not skip close")
                    self.closed(seen)
                    self.storage_error(error)
                    self.assertIs(error.__cause__, rollback)
                    self.chain_contains(error, read, rollback)
                self.assertEqual(self.snapshot(), baseline)
                self.held(guard)

    def test_rollback_and_close_failures_preserve_both_origins(self):
        guard = self.guard()
        baseline = self.snapshot()
        read = sqlite3.DatabaseError("state read failed")
        rollback = OSError("rollback failed")
        close = sqlite3.OperationalError("database busy closing")
        with effect_connections(before=fail_at("SELECT * FROM runner_state WHERE id=1", read),
                                rollback_error=rollback, close_error=close) as seen:
            error = self.failure(lambda: self.store.acquire_runner(guard))
            self.assertEqual(seen["events"], ["rollback", "close"])
            self.still_open(seen)
            self.assertTrue(seen["handles"][0].in_transaction)
            self.storage_error(error)
            self.assertIs(error.__cause__, close)
            self.chain_contains(error, read, rollback, close)
        self.assertEqual(self.snapshot(), baseline)
        self.held(guard)

    def test_committed_acquisition_close_failure_reports_uncertainty(self):
        guard = self.guard()
        for close in (sqlite3.OperationalError("busy closing committed state"), OSError("close I/O"),
                      KeyboardInterrupt("close interrupted")):
            with self.subTest(close=type(close).__name__):
                self.now += 31000
                before = self.identity()
                with effect_connections(close_error=close) as seen:
                    error = self.failure(lambda: self.store.acquire_runner(guard))
                    self.assertEqual(seen["events"], ["commit", "close"])
                    self.assertIn("COMMIT", seen["sql"])
                    self.still_open(seen)
                    self.assertFalse(seen["handles"][0].in_transaction)
                    self.storage_error(error)
                    self.assertIs(error.__cause__, close)
                after = self.identity()
                self.assertEqual(int(after["commit_seq"]), int(before["commit_seq"]) + 1)
                self.assertNotEqual(after["commit_id"], before["commit_id"])
                row = self.sql("SELECT state,runner_id,guard_generation,lease_until_ms FROM runner_state")[0]
                self.assertEqual(row, ("running", guard.runner_id, guard.generation, self.now + 30000))
                self.held(guard)

    def test_ordinary_acquisition_and_unchanged_busy_close_once(self):
        guard = self.guard()
        before = self.identity()
        with effect_connections() as seen:
            result = self.store.acquire_runner(guard)
            self.closed(seen)
            self.assertEqual(seen["events"], ["commit", "close"])
        self.assertEqual(result["status"], "acquired")
        after = self.identity()
        self.assertEqual(int(after["commit_seq"]), int(before["commit_seq"]) + 1)
        self.assertNotEqual(after["commit_id"], before["commit_id"])
        baseline = self.snapshot()
        with effect_connections() as seen:
            result = self.store.acquire_runner(guard)
            self.closed(seen)
            self.assertEqual(seen["events"], ["rollback", "close"])
        self.assertEqual(result["status"], "busy")
        self.assertEqual(self.snapshot(), baseline)
        self.held(guard)

    def test_real_begin_contention_retries_only_after_close(self):
        guard = self.guard()
        baseline = self.snapshot()
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            with effect_connections() as seen:
                error = self.failure(lambda: self.store.acquire_runner(guard))
                self.closed(seen)
                self.assertEqual(seen["events"], ["close"])
                self.assertIn("BEGIN IMMEDIATE", seen["sql"])
                self.assertNotIn("COMMIT", seen["sql"])
                self.busy_error(error)
        finally:
            writer.close()
        self.assertEqual(self.snapshot(), baseline)
        self.assertEqual(self.store.acquire_runner(guard)["status"], "acquired")
        self.held(guard)

    def test_real_commit_contention_rolls_back_claim_and_identity(self):
        guard = self.guard()
        token = self.token(guard)
        baseline = self.snapshot()
        reader = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            reader.execute("BEGIN")
            reader.execute("SELECT * FROM runner_state").fetchall()
            with effect_connections() as seen:
                error = self.failure(lambda: self.store.claim_wakes(guard, token, self.everyone()))
                self.assertIn("COMMIT", seen["sql"], "the conflict must reach COMMIT, not only BEGIN")
                self.assertTrue(any(sql.startswith("INSERT INTO wake_attempts") for sql in seen["sql"]))
                self.assertEqual(seen["events"], ["commit", "rollback", "close"])
                self.closed(seen)
                self.busy_error(error)
        finally:
            reader.close()
        self.assertEqual(self.snapshot(), baseline, "rolled-back claim must not persist attempt or commit identity")
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(0,)])
        self.claim(guard, token)
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(1,)])
        self.held(guard)

    def test_nonbusy_sqlite_failure_is_typed_and_unchanged(self):
        guard = self.guard()
        baseline = self.snapshot()
        cause = sqlite3.OperationalError("disk I/O error")
        with effect_connections(before=fail_at("SELECT * FROM runner_state WHERE id=1", cause)) as seen:
            error = self.failure(lambda: self.store.acquire_runner(guard))
            self.closed(seen)
            self.assertEqual(seen["events"], ["rollback", "close"])
            self.storage_error(error)
            self.assertIs(error.__cause__, cause)
        self.assertEqual(self.snapshot(), baseline)
        self.held(guard)

    def test_action_exception_identity_survives_successful_cleanup(self):
        guard = self.guard()
        baseline = self.snapshot()
        for original in (ValueError("action"), OSError("action"), KeyboardInterrupt("action")):
            with self.subTest(error=type(original).__name__):
                with mock.patch.object(self.store, "_runner_state", side_effect=original):
                    with effect_connections() as seen:
                        error = self.failure(lambda: self.store.acquire_runner(guard))
                        self.closed(seen)
                        self.assertEqual(seen["events"], ["rollback", "close"])
                        self.assertIs(error, original)
                self.assertEqual(self.snapshot(), baseline)
                self.held(guard)

    def test_setup_exception_identity_survives_successful_cleanup(self):
        guard = self.guard()
        baseline = self.snapshot()
        for original in (OSError("setup I/O"), KeyboardInterrupt("setup interrupted")):
            with self.subTest(error=type(original).__name__):
                with effect_connections(before=fail_at("PRAGMA synchronous=EXTRA", original)) as seen:
                    error = self.failure(lambda: self.store.acquire_runner(guard))
                    self.assertEqual(seen["events"], ["close"])
                    self.closed(seen)
                    self.assertIs(error, original, "clean setup close must preserve the original exception")
                self.assertEqual(self.snapshot(), baseline)
                self.held(guard)

    def test_action_interruption_is_preserved_when_cleanup_also_fails(self):
        guard = self.guard()
        original = KeyboardInterrupt("action interrupted")
        close = OSError("close failed")
        baseline = self.snapshot()
        with mock.patch.object(self.store, "_runner_state", side_effect=original):
            with effect_connections(close_error=close) as seen:
                error = self.failure(lambda: self.store.acquire_runner(guard))
                self.assertEqual(seen["events"], ["rollback", "close"])
                self.still_open(seen)
                self.storage_error(error)
                self.chain_contains(error, original, close)
        self.assertEqual(self.snapshot(), baseline)
        self.held(guard)


# Reuse public fixture helpers without collecting the broad runner suite.
for _base in runner_tests.RunnerCase.__mro__:
    for _name in _base.__dict__:
        if _name.startswith("test_") and _name not in EffectCleanupCase.__dict__:
            setattr(EffectCleanupCase, _name, None)


if __name__ == "__main__":
    unittest.main()

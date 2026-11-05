from __future__ import annotations

import json
import os
import sqlite3
import uuid

from . import delivery
from .authority import RunnerGuard
from .contract import StoreError


RUNNER_SCHEMA = [
    "CREATE TABLE runner_state (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, version INTEGER NOT NULL, runner_token TEXT, runner_id TEXT, guard_generation TEXT, lease_until_ms INTEGER, reason_code TEXT, runner_pid INTEGER, runner_started_ms INTEGER, child_pid INTEGER, child_started_at TEXT, child_claim_token TEXT)",
    "INSERT INTO runner_state(id,state,version) VALUES (1,'idle',1)",
    "CREATE TABLE wake_attempts (id TEXT PRIMARY KEY, claim_token TEXT NOT NULL UNIQUE, runner_token TEXT NOT NULL, recipient_id TEXT NOT NULL REFERENCES actors(id), wake_generation INTEGER NOT NULL, captured_seq INTEGER NOT NULL, started_ms INTEGER NOT NULL, lease_until_ms INTEGER NOT NULL)",
    "CREATE INDEX runner_attempts ON wake_attempts(runner_token,started_ms)",
    "CREATE TABLE wake_results (attempt_id TEXT PRIMARY KEY REFERENCES wake_attempts(id), outcome TEXT NOT NULL, finished_ms INTEGER NOT NULL)",
    "CREATE INDEX active_claim_end ON recipient_schedule(claim_until_ms) WHERE claim_token IS NOT NULL",
    "CREATE TRIGGER immutable_wake_attempt_update BEFORE UPDATE ON wake_attempts BEGIN SELECT RAISE(ABORT,'immutable wake attempt'); END",
    "CREATE TRIGGER immutable_wake_attempt_delete BEFORE DELETE ON wake_attempts BEGIN SELECT RAISE(ABORT,'immutable wake attempt'); END",
    "CREATE TRIGGER immutable_wake_result_update BEFORE UPDATE ON wake_results BEGIN SELECT RAISE(ABORT,'immutable wake result'); END",
    "CREATE TRIGGER immutable_wake_result_delete BEFORE DELETE ON wake_results BEGIN SELECT RAISE(ABORT,'immutable wake result'); END",
]


class RunnerError(StoreError):
    def __init__(self, code, message, retryable=False):
        self.code, self.retryable = code, retryable
        super().__init__(message)


def _routed(recipients):
    """The route map's actor IDs as one bound JSON parameter, so any map size is one query."""
    if isinstance(recipients, (str, bytes)) or not isinstance(recipients, (list, tuple, set, frozenset)):
        raise RunnerError("INVALID_ARGUMENT", "Name the routed recipients as a collection of actor IDs")
    routed = list(recipients)
    if any(not isinstance(actor, str) or not actor or len(actor) > 200 or any(ord(c) < 32 for c in actor) for actor in routed):
        raise RunnerError("INVALID_ARGUMENT", "Each routed recipient is an actor ID")
    return json.dumps(sorted(set(routed)))


def _bounded(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        raise RunnerError("INVALID_ARGUMENT", "%s must be an integer from %s to %s" % (name, low, high))
    return value


class Runner:
    def _effect(self, guard, action):
        from .store import _connect
        if (not isinstance(guard, RunnerGuard) or guard.binding != dict(self.binding, instance_id=self.instance_id, db_path=str(self.path))):
            raise RunnerError("INVALID_GUARD", "Use the actual held guard for this authority")
        guard.verify()
        db = None
        try:
            try:
                db, _ = _connect(self.path)
            except (OSError, KeyboardInterrupt) as error:
                # _connect explicitly chains a failed setup close. It still
                # owns that unreturned handle; an ordinary interruption keeps
                # its identity when setup cleanup succeeded.
                if error.__cause__ is not None:
                    raise RunnerError("RUNNER_STORAGE_ERROR", "Runner state could not be confirmed") from error
                raise
            db.execute("BEGIN IMMEDIATE")
            guard.verify()
            self._check_instance(db)
            result, changed = action(db, delivery._now_ms())
            if changed:
                self._advance_commit_seq(db)
                guard.verify()
                db.commit()
            return dict(result, instance_id=self.instance_id)
        except sqlite3.Error as error:
            if (isinstance(error, sqlite3.OperationalError) and error.__cause__ is None
                    and ("locked" in str(error).lower() or "busy" in str(error).lower())):
                raise RunnerError("DATABASE_BUSY", "Runner state is busy; no change was confirmed", retryable=True) from error
            raise RunnerError("RUNNER_STORAGE_ERROR", "Runner state could not be confirmed") from error
        finally:
            if db is not None:
                try:
                    try:
                        if db.in_transaction:
                            db.rollback()
                    finally:
                        db.close()
                except (sqlite3.Error, OSError, KeyboardInterrupt) as error:
                    # A failed rollback must not skip close. A failed close
                    # after COMMIT cannot establish that the act was undone.
                    raise RunnerError("RUNNER_STORAGE_ERROR", "Runner state could not be confirmed") from error

    def _runner_state(self, db):
        return db.execute("SELECT * FROM runner_state WHERE id=1").fetchone()

    def _runner_facts(self, db):
        state = self._runner_state(db)
        result = {"state": state["state"], "version": state["version"]}
        if state["reason_code"] is not None:
            result["reason_code"] = state["reason_code"]
        if state["lease_until_ms"] is not None:
            result["lease_until_ms"] = state["lease_until_ms"]
            result["lease_expired"] = state["lease_until_ms"] <= delivery._now_ms()
        if state["runner_pid"] is not None:
            registered = {"runner_pid": state["runner_pid"], "runner_started_ms": state["runner_started_ms"]}
            if state["child_pid"] is not None:
                registered.update(child_pid=state["child_pid"], child_started_at=state["child_started_at"])
            if result.get("lease_expired"):
                result.update(holder=None, last_registered=registered)
            else:
                result["holder"] = registered
        return result

    def _ownership(self, state, guard, token, now, allow_expired=False):
        # A token belongs to the actual acquisition that created it. Check
        # identity before paused shortcuts, which must not adopt an old token.
        if (not isinstance(token, str) or token != state["runner_token"]
                or state["guard_generation"] != guard.generation):
            return "lost"
        if state["state"] == "paused":
            return "paused"
        if state["state"] != "running" or (not allow_expired and state["lease_until_ms"] <= now):
            return "lost"
        return "running"

    def _acquire(self, db, guard, now, lease_ms):
        token = "r-" + uuid.uuid4().hex
        until = now + lease_ms
        db.execute("UPDATE runner_state SET state='running',version=version+1,runner_token=?,runner_id=?,guard_generation=?,lease_until_ms=?,reason_code=NULL,runner_pid=?,runner_started_ms=?,child_pid=NULL,child_started_at=NULL,child_claim_token=NULL WHERE id=1",
                   (token, guard.runner_id, guard.generation, until, os.getpid(), now))
        return {"status": "acquired", "runner_token": token, "lease_until_ms": until}, True

    def acquire_runner(self, guard, lease_ms=30000):
        _bounded(lease_ms, 1000, 120000, "lease_ms")
        def action(db, now):
            state = self._runner_state(db)
            if state["state"] == "paused":
                return {"status": "paused", "version": state["version"], "reason_code": state["reason_code"]}, False
            if state["lease_until_ms"] is not None and state["lease_until_ms"] > now:
                return {"status": "busy", "lease_until_ms": state["lease_until_ms"]}, False
            return self._acquire(db, guard, now, lease_ms)
        return self._effect(guard, action)

    def renew_runner(self, guard, runner_token, lease_ms=30000):
        _bounded(lease_ms, 1000, 120000, "lease_ms")
        def action(db, now):
            state = self._runner_state(db)
            ownership = self._ownership(state, guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership}, False
            until = now + lease_ms
            claim = db.execute("SELECT claim_until_ms FROM recipient_schedule INDEXED BY active_claim_end WHERE claim_token IS NOT NULL ORDER BY claim_until_ms DESC LIMIT 1").fetchone()
            if claim and claim[0] > until:
                raise RunnerError("LEASE_TOO_SHORT", "The singleton must outlast every outstanding claim", retryable=True)
            db.execute("UPDATE runner_state SET lease_until_ms=? WHERE id=1", (until,))
            return {"status": "renewed", "lease_until_ms": until}, True
        return self._effect(guard, action)

    def _next_due(self, db, routed=None):
        if routed is None:
            row = db.execute("SELECT next_due_ms FROM recipient_schedule INDEXED BY due_recipients WHERE enabled=1 AND pending_count>0 AND next_due_ms IS NOT NULL ORDER BY next_due_ms,recipient_id LIMIT 1").fetchone()
        else:
            row = db.execute("SELECT next_due_ms FROM recipient_schedule INDEXED BY sqlite_autoindex_recipient_schedule_1 WHERE recipient_id IN (SELECT value FROM json_each(?)) AND enabled=1 AND pending_count>0 AND next_due_ms IS NOT NULL ORDER BY next_due_ms,recipient_id LIMIT 1", (routed,)).fetchone()
        return row[0] if row else None

    def claim_wakes(self, guard, runner_token, recipients, limit=1, lease_ms=20000):
        """Claim due wakes for the routed recipients only; nobody else is claimed or attempted."""
        routed = _routed(recipients)
        _bounded(limit, 1, 32, "limit")
        _bounded(lease_ms, 1000, 30000, "lease_ms")
        def action(db, now):
            state = self._runner_state(db)
            ownership = self._ownership(state, guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership, "claims": [], "scanned": 0, "next_due_ms": None}, False
            until = now + lease_ms
            if state["lease_until_ms"] < until:
                raise RunnerError("LEASE_TOO_SHORT", "Renew the singleton before claiming this full lease", retryable=True)
            # Each routed recipient is one primary-key probe; people and agents
            # without a route are never read, claimed or attempted here.
            rows = db.execute("SELECT * FROM recipient_schedule INDEXED BY sqlite_autoindex_recipient_schedule_1 WHERE recipient_id IN (SELECT value FROM json_each(?)) AND enabled=1 AND pending_count>0 AND next_due_ms<=? ORDER BY next_due_ms,recipient_id LIMIT ?", (routed, now, limit)).fetchall()
            claims = []
            for row in rows:
                if row["claim_token"] is not None and row["claim_until_ms"] > now:
                    # This is an invariant failure, not a reason to run a second
                    # child or scan indefinitely for another due recipient.
                    raise RunnerError("RUNNER_STATE_INVALID", "A live claim appeared in the due index")
                if row["claim_token"] is not None:
                    db.execute("INSERT INTO wake_results SELECT id,'expired',? FROM wake_attempts WHERE claim_token=?", (now, row["claim_token"]))
                attempt, claim = "a-" + uuid.uuid4().hex, "c-" + uuid.uuid4().hex
                db.execute("INSERT INTO wake_attempts VALUES (?,?,?,?,?,?,?,?)", (attempt, claim, runner_token, row["recipient_id"], row["wake_generation"], row["last_seq"], now, until))
                db.execute("UPDATE recipient_schedule SET claim_token=?,claim_until_ms=?,captured_generation=wake_generation,captured_seq=last_seq,next_due_ms=? WHERE recipient_id=?", (claim, until, until, row["recipient_id"]))
                claims.append({"attempt_id": attempt, "claim_token": claim, "recipient_id": row["recipient_id"],
                               "wake_generation": row["wake_generation"], "captured_seq": row["last_seq"], "lease_until_ms": until,
                               "route_binding": {"instance_id": self.instance_id, "actor_id": row["recipient_id"], "db_path": str(self.path),
                                                 "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]}})
            return {"status": "ok", "claims": claims, "scanned": len(rows), "next_due_ms": self._next_due(db, routed)}, bool(claims)
        return self._effect(guard, action)

    def finish_wake(self, guard, runner_token, claim_token, outcome):
        if not isinstance(outcome, str) or outcome not in {"accepted", "busy", "unavailable", "error"}:
            raise RunnerError("INVALID_ARGUMENT", "Unsupported wake outcome")
        if not isinstance(claim_token, str):
            raise RunnerError("INVALID_ARGUMENT", "Use a claim token")
        def action(db, now):
            state = self._runner_state(db)
            attempt = db.execute("SELECT * FROM wake_attempts WHERE claim_token=?", (claim_token,)).fetchone()
            if (self._ownership(state, guard, runner_token, now) != "running" or not attempt or attempt["runner_token"] != runner_token
                    or attempt["lease_until_ms"] <= now):
                return {"status": "stale"}, False
            row = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id=?", (attempt["recipient_id"],)).fetchone()
            if row["claim_token"] != claim_token:
                return {"status": "stale"}, False
            retry = min(row["retry_count"] + 1, 7) if outcome in {"busy", "error"} else 0
            delay = min(2 ** (retry - 1), 60) * 1000 if retry else 60000
            head = self._pending_head(db, row["recipient_id"])
            if row["pending_count"] == 0:
                due, retry = None, 0
            elif head is not None and head > attempt["captured_seq"]:
                due, retry = now, 0
            else:
                due = now + delay
            db.execute("INSERT INTO wake_results VALUES (?,?,?)", (attempt["id"], outcome, now))
            db.execute("UPDATE recipient_schedule SET claim_token=NULL,claim_until_ms=NULL,next_due_ms=?,retry_count=? WHERE recipient_id=?", (due, retry, row["recipient_id"]))
            db.execute("UPDATE runner_state SET child_pid=NULL,child_started_at=NULL,child_claim_token=NULL WHERE id=1 AND child_claim_token=?", (claim_token,))
            return {"status": "settled", "wake_status": outcome, "next_due_ms": due, "pending_count": row["pending_count"]}, True
        return self._effect(guard, action)

    def pause_runner(self, guard, runner_token, reason_code):
        if reason_code not in ("cleanup_failed", "route_binding_changed", "storage_failure", "operator_pause"):
            raise RunnerError("INVALID_ARGUMENT", "Use a bounded runner pause reason")
        def action(db, now):
            state = self._runner_state(db)
            ownership = self._ownership(state, guard, runner_token, now, allow_expired=True)
            if ownership == "paused":
                return {"status": "paused", "version": state["version"]}, False
            if ownership != "running":
                return {"status": "lost"}, False
            db.execute("UPDATE runner_state SET state='paused',version=version+1,reason_code=? WHERE id=1", (reason_code,))
            return {"status": "paused", "version": state["version"] + 1}, True
        return self._effect(guard, action)

    def resume_runner(self, guard, expected_pause_version, lease_ms=30000):
        _bounded(lease_ms, 1000, 120000, "lease_ms")
        _bounded(expected_pause_version, 1, 9223372036854775807, "expected_pause_version")
        def action(db, now):
            state = self._runner_state(db)
            if state["state"] != "paused" or state["version"] != expected_pause_version:
                raise RunnerError("REVISION_CONFLICT", "The runner pause changed; inspect it before resuming")
            if state["guard_generation"] == guard.generation:
                raise RunnerError("GUARD_NOT_DRAINED", "Close the old guard and acquire a new one after owned cleanup")
            return self._acquire(db, guard, now, lease_ms)
        return self._effect(guard, action)

    def record_runner_child(self, guard, runner_token, claim_token, pid, started_at):
        _bounded(pid, 1, 2147483647, "pid")
        if not isinstance(started_at, str) or not started_at or len(started_at) > 128 or any(ord(c) < 32 for c in started_at):
            raise RunnerError("INVALID_ARGUMENT", "Use a bounded child start identity")
        if not isinstance(claim_token, str):
            raise RunnerError("INVALID_ARGUMENT", "Use a claim token")
        def action(db, now):
            state = self._runner_state(db)
            row = db.execute("SELECT a.runner_token,s.claim_token FROM wake_attempts a JOIN recipient_schedule s ON s.recipient_id=a.recipient_id WHERE a.claim_token=?", (claim_token,)).fetchone()
            if self._ownership(state, guard, runner_token, now, allow_expired=True) != "running" or not row or row["runner_token"] != runner_token or row["claim_token"] != claim_token:
                return {"status": "stale"}, False
            db.execute("UPDATE runner_state SET child_pid=?,child_started_at=?,child_claim_token=? WHERE id=1", (pid, started_at, claim_token))
            return {"status": "recorded"}, True
        return self._effect(guard, action)

    def runner_schedule(self, recipients):
        """Bounded scheduling facts for the routed recipients, not evidence of runner ownership."""
        from .store import _connect
        routed = _routed(recipients)
        try:
            with self._authority.shared() as fence:
                db, _ = _connect(self.path)
                try:
                    db.execute("BEGIN")
                    fence.verify()
                    self._check_instance(db)
                    state = self._runner_state(db)
                    result = {"instance_id": self.instance_id, "state": state["state"],
                              "version": state["version"], "lease_until_ms": state["lease_until_ms"],
                              "next_due_ms": self._next_due(db, routed)}
                    if state["reason_code"] is not None:
                        result["reason_code"] = state["reason_code"]
                    return result
                finally:
                    try:
                        db.close()
                    except (sqlite3.Error, OSError) as error:
                        raise RunnerError("RUNNER_STORAGE_ERROR", "Scheduling connection cleanup could not be confirmed") from error
        except (sqlite3.Error, OSError) as error:
            # _connect chains a failed close from the setup error. Such a
            # failure is uncertain even if the close itself says 'busy'.
            if (isinstance(error, sqlite3.OperationalError) and error.__cause__ is None
                    and ("locked" in str(error).lower() or "busy" in str(error).lower())):
                raise RunnerError("DATABASE_BUSY", "Runner schedule is busy; retry the read", retryable=True) from error
            raise RunnerError("RUNNER_STORAGE_ERROR", "Runner schedule could not be confirmed") from error

    def runner_status(self):
        from .store import _connect
        with self._authority.shared() as fence:
            db, _ = _connect(self.path)
            try:
                db.execute("BEGIN")
                fence.verify()
                self._check_instance(db)
                result = self._runner_facts(db)
                result.update(instance_id=self.instance_id, next_due_ms=self._next_due(db))
                result["due_count"] = db.execute("SELECT count(*) FROM recipient_schedule WHERE enabled=1 AND pending_count>0 AND next_due_ms<=?", (delivery._now_ms(),)).fetchone()[0]
                row = db.execute("SELECT a.id AS attempt_id,a.recipient_id,a.lease_until_ms FROM recipient_schedule s INDEXED BY active_claim_end JOIN wake_attempts a ON a.claim_token=s.claim_token WHERE s.claim_token IS NOT NULL AND s.claim_until_ms>? ORDER BY s.claim_until_ms LIMIT 1", (delivery._now_ms(),)).fetchone()
                result["claim"] = dict(row) if row else None
                return result
            finally:
                db.close()

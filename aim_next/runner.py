from __future__ import annotations

import json
import os
import sqlite3
import uuid

from . import delivery
from .authority import RunnerGuard
from .contract import StoreError
from . import work
from .wake_health import ANSWERING


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


# How a runner process that did not stop itself ended, from its exit status.
EXIT_REASONS = {75: "lease_lost", 0: "stopped_unrecorded"}


def _write_once(table, columns):
    """A column of this table moves only from NULL to a value, once; rows are never deleted."""
    changed = " OR ".join("(OLD.%s IS NOT NULL AND NEW.%s IS NOT OLD.%s)" % (column, column, column) for column in columns)
    return ["CREATE TRIGGER write_once_%s BEFORE UPDATE ON %s WHEN %s BEGIN SELECT RAISE(ABORT,'write-once %s'); END" % (table, table, changed, table),
            "CREATE TRIGGER immutable_%s_delete BEFORE DELETE ON %s BEGIN SELECT RAISE(ABORT,'immutable %s'); END" % (table, table, table)]


HOSTED_TURN_COLUMNS = ("attempt_id", "recipient_id", "thread_id", "turn_id", "mode", "client_id", "announced_seq", "handed_ms",
                       "seen_ms", "final_status", "error_code", "finished_ms", "input_tokens", "cached_input_tokens",
                       "output_tokens", "reasoning_output_tokens", "cli_calls")
HOSTED_CHILD_COLUMNS = ("id", "runner_token", "codex_home", "pid", "started_at", "user_agent", "spawned_ms",
                        "exited_ms", "exit_status", "cleanup")
# Schema 10: hosted Codex turns. Fresh instances and the 9 -> 10 upgrade run
# the same statements, so both reach the same stored layout.
HOSTED_SCHEMA = [
    "ALTER TABLE recipient_schedule ADD COLUMN handed_seq INTEGER",
    # The recipient's handed_seq when the attempt was claimed: its notice names
    # only what is newer, so Core can tell when that start went stale.
    "ALTER TABLE wake_attempts ADD COLUMN handed_seq INTEGER",
    "CREATE TABLE hosted_turns (attempt_id TEXT PRIMARY KEY REFERENCES wake_attempts(id), recipient_id TEXT NOT NULL REFERENCES actors(id), thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('start','steer')), client_id TEXT NOT NULL, announced_seq INTEGER NOT NULL, handed_ms INTEGER NOT NULL, seen_ms INTEGER, final_status TEXT CHECK(final_status IN ('completed','interrupted','failed','lost')), error_code TEXT, finished_ms INTEGER, input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_output_tokens INTEGER, cli_calls INTEGER)",
    "CREATE INDEX hosted_turns_open ON hosted_turns(thread_id,turn_id) WHERE final_status IS NULL",
    "CREATE INDEX hosted_turns_turn ON hosted_turns(thread_id,turn_id,final_status)",
    "CREATE TABLE hosted_children (id TEXT PRIMARY KEY, runner_token TEXT NOT NULL, codex_home TEXT NOT NULL, pid INTEGER NOT NULL, started_at TEXT NOT NULL, user_agent TEXT, spawned_ms INTEGER NOT NULL, exited_ms INTEGER, exit_status INTEGER, cleanup TEXT CHECK(cleanup IN ('confirmed','unconfirmed')))",
] + _write_once("hosted_turns", HOSTED_TURN_COLUMNS) + _write_once("hosted_children", HOSTED_CHILD_COLUMNS)
# The step back, and the query that is true while it would drop hosted records
# or leave a hosted route pin that version 9 reads as malformed.
HOSTED_DOWN = ("DROP TABLE hosted_children", "DROP TABLE hosted_turns", "ALTER TABLE wake_attempts DROP COLUMN handed_seq",
               "ALTER TABLE recipient_schedule DROP COLUMN handed_seq")
HOSTED_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM hosted_turns) OR EXISTS (SELECT 1 FROM hosted_children) "
                   "OR EXISTS (SELECT 1 FROM recipient_schedule WHERE handed_seq IS NOT NULL) "
                   "OR EXISTS (SELECT 1 FROM wake_attempts WHERE handed_seq IS NOT NULL) "
                   "OR EXISTS (SELECT 1 FROM metadata WHERE key LIKE 'route_pin.v1:%' AND "
                   "CASE WHEN json_valid(value) THEN json_extract(value,'$.destination.kind') END='codex-hosted-stdio')")

# queued: the notice was already waiting unread in the agent's chat. It is
# scheduled like accepted, and is not a wake the agent left unanswered.
OUTCOMES = frozenset(("accepted", "queued", "handed", "busy", "unavailable", "error"))
TURN_FIELDS = frozenset(("thread_id", "turn_id", "mode", "client_id", "announced_seq"))
TURN_STATUSES = frozenset(("completed", "interrupted", "failed", "lost"))
USAGE_FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "cli_calls")
CLIENT_PREFIX = "theseus:"
# Which handed rows must be seen as a userMessage item for a turn to count as
# clean. A start row's input opens the turn, so only a steer can be dropped.
# Conservative until probe P5 shows whether Codex echoes clientUserMessageId
# on steered input: an unseen steer re-arms, which costs at most one extra turn.
UNSEEN_REARM_MODES = frozenset(("steer",))
MAX_SEQ = 9223372036854775807


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


def _backoff(retry_count):
    """The next retry count and its delay: 1 s, doubling, capped at 60 s."""
    retry = min(retry_count + 1, 7)
    return retry, min(2 ** (retry - 1), 60) * 1000


def _text(value, name, limit=200):
    if not isinstance(value, str) or not 0 < len(value) <= limit or any(ord(c) < 32 or c == "\x7f" for c in value):
        raise RunnerError("INVALID_ARGUMENT", "%s must be bounded text" % name)
    return value


def _thread(value):
    try:
        if isinstance(value, str) and str(uuid.UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise RunnerError("INVALID_ARGUMENT", "thread_id must be a canonical lowercase UUID")


def _turn(value):
    """The handed turn, exactly as the host saw it; refused rather than trimmed."""
    if type(value) is not dict or set(value) != TURN_FIELDS:
        raise RunnerError("INVALID_ARGUMENT", "A handed wake names exactly its thread, turn, mode, client id and announced seq")
    if value["mode"] not in ("start", "steer"):
        raise RunnerError("INVALID_ARGUMENT", "A handed turn was started or steered")
    return dict(thread_id=_thread(value["thread_id"]), turn_id=_text(value["turn_id"], "turn_id"), mode=value["mode"],
                client_id=_text(value["client_id"], "client_id"),
                announced_seq=_bounded(value["announced_seq"], 0, MAX_SEQ, "announced_seq"))


def _usage(value):
    if value is None:
        return {}
    if type(value) is not dict or not set(value) <= set(USAGE_FIELDS):
        raise RunnerError("INVALID_ARGUMENT", "Usage names only token counts and CLI calls")
    return {key: _bounded(count, 0, MAX_SEQ, key) for key, count in value.items()}


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
        db.execute("UPDATE runner_state SET state='running',version=version+1,runner_token=?,runner_id=?,guard_generation=?,lease_until_ms=?,reason_code=NULL,runner_pid=?,runner_started_ms=?,child_pid=NULL,child_started_at=NULL,child_claim_token=NULL,ended_ms=NULL WHERE id=1",
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
            row = db.execute("SELECT next_due_ms FROM recipient_schedule INDEXED BY due_recipients WHERE enabled=1 AND pending_count>0 AND next_due_ms IS NOT NULL AND " + ANSWERING + " ORDER BY next_due_ms,recipient_id LIMIT 1").fetchone()
        else:
            row = db.execute("SELECT next_due_ms FROM recipient_schedule INDEXED BY sqlite_autoindex_recipient_schedule_1 WHERE recipient_id IN (SELECT value FROM json_each(?)) AND enabled=1 AND pending_count>0 AND next_due_ms IS NOT NULL AND " + ANSWERING + " ORDER BY next_due_ms,recipient_id LIMIT 1", (routed,)).fetchone()
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
            rows = db.execute("SELECT * FROM recipient_schedule INDEXED BY sqlite_autoindex_recipient_schedule_1 WHERE recipient_id IN (SELECT value FROM json_each(?)) AND enabled=1 AND pending_count>0 AND next_due_ms<=? AND " + ANSWERING + " ORDER BY next_due_ms,recipient_id LIMIT ?", (routed, now, limit)).fetchall()
            claims = []
            for row in rows:
                if row["claim_token"] is not None and row["claim_until_ms"] > now:
                    # This is an invariant failure, not a reason to run a second
                    # child or scan indefinitely for another due recipient.
                    raise RunnerError("RUNNER_STATE_INVALID", "A live claim appeared in the due index")
                if row["claim_token"] is not None:
                    db.execute("INSERT INTO wake_results SELECT id,'expired',? FROM wake_attempts WHERE claim_token=?", (now, row["claim_token"]))
                attempt, claim = "a-" + uuid.uuid4().hex, "c-" + uuid.uuid4().hex
                db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms,handed_seq) "
                           "VALUES (?,?,?,?,?,?,?,?,?)", (attempt, claim, runner_token, row["recipient_id"], row["wake_generation"], row["last_seq"], now, until, row["handed_seq"]))
                db.execute("UPDATE recipient_schedule SET claim_token=?,claim_until_ms=?,captured_generation=wake_generation,captured_seq=last_seq,next_due_ms=? WHERE recipient_id=?", (claim, until, until, row["recipient_id"]))
                claims.append({"attempt_id": attempt, "claim_token": claim, "recipient_id": row["recipient_id"],
                               "wake_generation": row["wake_generation"], "captured_seq": row["last_seq"], "lease_until_ms": until,
                               # A hosted notice names only what is newer than the work a turn already holds.
                               "handed_seq": row["handed_seq"],
                               "route_binding": {"instance_id": self.instance_id, "actor_id": row["recipient_id"], "db_path": str(self.path),
                                                 "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]}})
            return {"status": "ok", "claims": claims, "scanned": len(rows), "next_due_ms": self._next_due(db, routed)}, bool(claims)
        return self._effect(guard, action)

    def finish_wake(self, guard, runner_token, claim_token, outcome, turn=None):
        if not isinstance(outcome, str) or outcome not in OUTCOMES:
            raise RunnerError("INVALID_ARGUMENT", "Unsupported wake outcome")
        if not isinstance(claim_token, str):
            raise RunnerError("INVALID_ARGUMENT", "Use a claim token")
        if (outcome == "handed") != (turn is not None):
            raise RunnerError("INVALID_ARGUMENT", "A handed wake names its turn, and no other outcome does")
        turn = _turn(turn) if turn is not None else None
        def action(db, now):
            state = self._runner_state(db)
            attempt = db.execute("SELECT * FROM wake_attempts WHERE claim_token=?", (claim_token,)).fetchone()
            if (self._ownership(state, guard, runner_token, now) != "running" or not attempt or attempt["runner_token"] != runner_token
                    or attempt["lease_until_ms"] <= now):
                return {"status": "stale"}, False
            row = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id=?", (attempt["recipient_id"],)).fetchone()
            if row["claim_token"] != claim_token:
                return {"status": "stale"}, False
            if outcome == "handed":
                return self._hand(db, now, attempt, row, turn), True
            retry, delay = _backoff(row["retry_count"]) if outcome in {"busy", "error"} else (0, delivery.REWAKE_MS)
            head = self._pending_head(db, row["recipient_id"])
            if row["pending_count"] == 0:
                due, retry = None, 0
            elif head is not None and head > attempt["captured_seq"]:
                due, retry = now, 0
            else:
                due = now + delay
            db.execute("INSERT INTO wake_results VALUES (?,?,?)", (attempt["id"], outcome, now))
            db.execute("UPDATE recipient_schedule SET claim_token=NULL,claim_until_ms=NULL,next_due_ms=?,retry_count=? WHERE recipient_id=?", (due, retry, row["recipient_id"]))
            if outcome == "accepted" and row["pending_count"]:
                # The notice reached the agent's chat; it stays unanswered until the agent acts.
                self._wake_unanswered(db, row["recipient_id"], now)
            db.execute("UPDATE runner_state SET child_pid=NULL,child_started_at=NULL,child_claim_token=NULL WHERE id=1 AND child_claim_token=?", (claim_token,))
            return {"status": "settled", "wake_status": outcome, "next_due_ms": due, "pending_count": row["pending_count"]}, True
        return self._effect(guard, action)

    def _hand(self, db, now, attempt, row, turn):
        """Settle a claim whose work a running Codex turn now holds; handed work does not re-wake by itself.

        Two cases hand nothing, though the turn row is still recorded: a turn
        that had already ended when its input was answered (a late steer), and
        a notice whose starting point Core handed back after the claim (a turn
        that failed under the live claim). Either way every pending delivery is
        named again by the next claim.
        """
        if turn["client_id"] != CLIENT_PREFIX + attempt["id"]:
            raise RunnerError("INVALID_ARGUMENT", "A handed turn carries this attempt's client id")
        if turn["announced_seq"] > row["last_seq"]:
            raise RunnerError("INVALID_ARGUMENT", "A notice cannot announce a delivery that does not exist")
        if self._hosted_thread(db, attempt["recipient_id"]) != turn["thread_id"]:
            raise RunnerError("ROUTE_PIN_MISMATCH", "The handed thread is not this recipient's pinned hosted thread")
        pending = row["pending_count"]
        ended = db.execute("SELECT final_status,error_code FROM hosted_turns INDEXED BY hosted_turns_turn "
                           "WHERE thread_id=? AND turn_id=? AND final_status IS NOT NULL LIMIT 1",
                           (turn["thread_id"], turn["turn_id"])).fetchone()
        # Input answered after its turn ended re-arms by the turn-end rule: an
        # unseen steer (probe P5) or a turn that did not complete.
        late = ended is not None and (ended["final_status"] != "completed" or turn["mode"] in UNSEEN_REARM_MODES)
        # The notice named only deliveries above the claim's handed_seq. If that
        # work was handed back since the claim, this turn was never told of it.
        stale_start = attempt["handed_seq"] is not None and row["handed_seq"] is None
        retry, handed, due = row["retry_count"], None, None
        if pending and (late or stale_start):
            if late:
                retry, delay = _backoff(row["retry_count"])
                due = now + delay
            else:
                # The re-arm already counted its retry and waited for this claim to end.
                due = now
        elif pending:
            handed = attempt["captured_seq"]
            # The turn now holds what its notice named: it is in each of those topics.
            work.turn_handed(db, attempt["id"], attempt["recipient_id"], attempt["handed_seq"], turn["announced_seq"], now)
        # Only a delivery that arrived after the claim, and is still pending,
        # makes the recipient due again: one the turn already handled is not.
        if pending and row["last_seq"] > attempt["captured_seq"] and self._pending_above(db, attempt["recipient_id"], attempt["captured_seq"]):
            due = now
        db.execute("INSERT INTO wake_results VALUES (?,?,?)", (attempt["id"], "handed", now))
        db.execute("INSERT INTO hosted_turns(attempt_id,recipient_id,thread_id,turn_id,mode,client_id,announced_seq,handed_ms,final_status,error_code,finished_ms) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   (attempt["id"], attempt["recipient_id"], turn["thread_id"], turn["turn_id"], turn["mode"], turn["client_id"],
                    turn["announced_seq"], now, ended["final_status"] if ended else None, ended["error_code"] if ended else None,
                    now if ended else None))
        # retry_count is otherwise kept: a turn that fails again backs off further, and only a clean turn end resets it.
        db.execute("UPDATE recipient_schedule SET claim_token=NULL,claim_until_ms=NULL,next_due_ms=?,handed_seq=?,retry_count=? WHERE recipient_id=?",
                   (due, handed, retry, attempt["recipient_id"]))
        if handed is not None and turn["mode"] == "start":
            # A turn started with this work; a steer joins a turn already counted.
            self._wake_unanswered(db, attempt["recipient_id"], now)
        db.execute("UPDATE runner_state SET child_pid=NULL,child_started_at=NULL,child_claim_token=NULL WHERE id=1 AND child_claim_token=?", (attempt["claim_token"],))
        return {"status": "settled", "wake_status": "handed", "next_due_ms": due, "pending_count": pending, "handed_seq": handed}

    def hosted_turn_seen(self, guard, runner_token, client_id):
        """Record when a handed input appeared in its thread as a userMessage item."""
        _text(client_id, "client_id")
        def action(db, now):
            ownership = self._ownership(self._runner_state(db), guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership}, False
            row = None
            if client_id.startswith(CLIENT_PREFIX):
                row = db.execute("SELECT client_id,seen_ms FROM hosted_turns WHERE attempt_id=?", (client_id[len(CLIENT_PREFIX):],)).fetchone()
            if row is None or row["client_id"] != client_id:
                return {"status": "unknown"}, False
            if row["seen_ms"] is not None:
                return {"status": "already", "seen_ms": row["seen_ms"]}, False
            db.execute("UPDATE hosted_turns SET seen_ms=? WHERE attempt_id=?", (now, client_id[len(CLIENT_PREFIX):]))
            return {"status": "recorded", "seen_ms": now}, True
        return self._effect(guard, action)

    def end_hosted_turn(self, guard, runner_token, thread_id, turn_id, status, error_code=None, usage=None):
        """Finish every open row of one turn; a turn that failed or dropped a steer hands its work back."""
        _thread(thread_id)
        _text(turn_id, "turn_id")
        if not isinstance(status, str) or status not in TURN_STATUSES:
            raise RunnerError("INVALID_ARGUMENT", "A turn ends completed, interrupted, failed or lost")
        if error_code is not None and (status == "completed" or not isinstance(error_code, str)
                                       or not 0 < len(error_code) <= 64 or not error_code.isascii()
                                       or not error_code.replace("_", "").isalnum()):
            raise RunnerError("INVALID_ARGUMENT", "An error code is a bounded codexErrorInfo key on a turn that did not complete")
        counts = _usage(usage)
        def action(db, now):
            ownership = self._ownership(self._runner_state(db), guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership}, False
            rows = db.execute("SELECT * FROM hosted_turns INDEXED BY hosted_turns_open WHERE thread_id=? AND turn_id=? AND final_status IS NULL "
                              "ORDER BY handed_ms,attempt_id", (thread_id, turn_id)).fetchall()
            if not rows:
                return {"status": "unknown"}, False
            unseen = any(row["mode"] in UNSEEN_REARM_MODES and row["seen_ms"] is None for row in rows)
            db.execute("UPDATE hosted_turns SET final_status=?,error_code=?,finished_ms=? WHERE thread_id=? AND turn_id=? AND final_status IS NULL",
                       (status, error_code, now, thread_id, turn_id))
            if counts:
                # Usage is the turn's, so it lands once: on the first handed row.
                db.execute("UPDATE hosted_turns SET " + ",".join(key + "=?" for key in sorted(counts)) + " WHERE attempt_id=?",
                           [counts[key] for key in sorted(counts)] + [rows[0]["attempt_id"]])
            if status == "completed":
                for row in rows:
                    work.turn_completed(db, row["attempt_id"], row["recipient_id"], now)
            else:
                # A turn that did not complete never gave the agent its wake to answer.
                for row in rows:
                    if row["mode"] == "start":
                        self._wake_withdrawn(db, row["recipient_id"])
            rearmed = False
            for recipient in sorted({row["recipient_id"] for row in rows}):
                schedule = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id=?", (recipient,)).fetchone()
                clean = status == "completed" and not unseen
                if clean:
                    db.execute("UPDATE recipient_schedule SET retry_count=0 WHERE recipient_id=?", (recipient,))
                head = self._pending_head(db, recipient)
                if schedule["handed_seq"] is None or head is None or head > schedule["handed_seq"]:
                    continue
                live = schedule["claim_token"] is not None and schedule["claim_until_ms"] > now
                if clean:
                    # The turn ended with work it was handed still pending (it
                    # read one page, or left one unanswered): it is named again
                    # after the same minute an accepted wake waits, unless newer
                    # work already made it due.
                    retry = 0
                    due = schedule["next_due_ms"] if self._pending_above(db, recipient, schedule["handed_seq"]) else now + delivery.REWAKE_MS
                else:
                    retry, delay = _backoff(schedule["retry_count"])
                    due = now + delay
                db.execute("UPDATE recipient_schedule SET handed_seq=NULL,retry_count=?,next_due_ms=? WHERE recipient_id=?",
                           (retry, schedule["claim_until_ms"] if live else due, recipient))
                rearmed = True
            return {"status": "ended", "final_status": status, "rows": len(rows), "unseen": unseen, "rearmed": rearmed}, True
        return self._effect(guard, action)

    def open_hosted_turns(self, guard, runner_token, thread_ids):
        """The turns of these threads with a handed row not yet finished, from any run; nothing changes."""
        if not isinstance(thread_ids, (list, tuple)) or len(thread_ids) > 1000:
            raise RunnerError("INVALID_ARGUMENT", "Name the hosted threads as a list")
        threads = json.dumps(sorted({_thread(thread) for thread in thread_ids}))
        def action(db, now):
            ownership = self._ownership(self._runner_state(db), guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership}, False
            rows = db.execute("SELECT DISTINCT thread_id,turn_id FROM hosted_turns INDEXED BY hosted_turns_open WHERE thread_id IN (SELECT value FROM json_each(?)) "
                              "AND final_status IS NULL ORDER BY thread_id,turn_id", (threads,)).fetchall()
            return {"status": "ok", "turns": [dict(row) for row in rows]}, False
        return self._effect(guard, action)

    def record_hosted_child(self, guard, runner_token, codex_home, pid, started_at):
        """Record one long-lived app-server child at spawn, before any request is sent to it."""
        _text(codex_home, "codex_home", 4096)
        _bounded(pid, 1, 2147483647, "pid")
        _text(started_at, "started_at", 128)
        def action(db, now):
            ownership = self._ownership(self._runner_state(db), guard, runner_token, now)
            if ownership != "running":
                return {"status": ownership}, False
            child = "hc-" + uuid.uuid4().hex
            db.execute("INSERT INTO hosted_children(id,runner_token,codex_home,pid,started_at,spawned_ms) VALUES (?,?,?,?,?,?)",
                       (child, runner_token, codex_home, pid, started_at, now))
            return {"status": "recorded", "child_id": child}, True
        return self._effect(guard, action)

    def _own_child(self, db, guard, runner_token, now, child_id):
        # A paused runner still records what happened to the children it owns.
        ownership = self._ownership(self._runner_state(db), guard, runner_token, now, allow_expired=True)
        row = db.execute("SELECT * FROM hosted_children WHERE id=?", (child_id,)).fetchone()
        if ownership not in ("running", "paused") or row is None or row["runner_token"] != runner_token:
            return None
        return row

    def hosted_child_ready(self, guard, runner_token, child_id, user_agent):
        """Record the user agent a child reported once its handshake passed."""
        _text(child_id, "child_id")
        _text(user_agent, "user_agent", 1024)
        def action(db, now):
            row = self._own_child(db, guard, runner_token, now, child_id)
            if row is None:
                return {"status": "stale"}, False
            if row["user_agent"] is not None:
                return {"status": "already"}, False
            db.execute("UPDATE hosted_children SET user_agent=? WHERE id=?", (user_agent, child_id))
            return {"status": "recorded"}, True
        return self._effect(guard, action)

    def end_hosted_child(self, guard, runner_token, child_id, exit_status, cleanup):
        """Record a reaped child's exit once; 'confirmed' means its pipes are closed and it was reaped."""
        _text(child_id, "child_id")
        if type(exit_status) is not int or not -255 <= exit_status <= 255:
            raise RunnerError("INVALID_ARGUMENT", "exit_status is the reaped child's return code")
        if cleanup not in ("confirmed", "unconfirmed"):
            raise RunnerError("INVALID_ARGUMENT", "cleanup is confirmed or unconfirmed")
        def action(db, now):
            row = self._own_child(db, guard, runner_token, now, child_id)
            if row is None:
                return {"status": "stale"}, False
            if row["exited_ms"] is not None:
                return {"status": "already"}, False
            db.execute("UPDATE hosted_children SET exited_ms=?,exit_status=?,cleanup=? WHERE id=?", (now, exit_status, cleanup, child_id))
            return {"status": "recorded"}, True
        return self._effect(guard, action)

    def stop_runner(self, guard, runner_token):
        """A graceful stop says so, and frees the lease at once for the next runner."""
        def action(db, now):
            state = self._runner_state(db)
            ownership = self._ownership(state, guard, runner_token, now, allow_expired=True)
            if ownership != "running":
                return {"status": ownership}, False
            db.execute("UPDATE runner_state SET state='stopped',version=version+1,reason_code=NULL,lease_until_ms=?,ended_ms=? WHERE id=1", (now, now))
            return {"status": "stopped", "ended_ms": now}, True
        return self._effect(guard, action)

    def record_runner_exit(self, pid, exit_status):
        """What a supervisor saw: the runner process pid exited with exit_status (negative: the signal that ended it).

        Written only while that process is the one Core records as running,
        so a later runner's record is never touched. It needs no guard: the
        process is gone, and a child it left may still hold the guard. Its
        lease ends now, so a restarted runner does not wait one out."""
        _bounded(pid, 1, 2147483647, "pid")
        if type(exit_status) is not int or not -255 <= exit_status <= 255:
            raise RunnerError("INVALID_ARGUMENT", "exit_status is the reaped process's return code")
        reason = EXIT_REASONS.get(exit_status, "killed" if exit_status < 0 else "failed")
        from .store import _connect
        try:
            with self._authority.shared() as fence:
                db, _ = _connect(self.path)
                try:
                    db.execute("BEGIN IMMEDIATE")
                    fence.verify()
                    self._check_instance(db)
                    state, now = self._runner_state(db), delivery._now_ms()
                    if state["state"] != "running" or state["runner_pid"] != pid:
                        return {"status": "not_holder", "instance_id": self.instance_id}
                    db.execute("UPDATE runner_state SET state='exited',version=version+1,reason_code=?,lease_until_ms=MIN(lease_until_ms,?),ended_ms=? WHERE id=1",
                               (reason, now, now))
                    self._advance_commit_seq(db)
                    db.commit()
                    return {"status": "recorded", "reason": reason, "ended_ms": now, "instance_id": self.instance_id}
                finally:
                    try:
                        if db.in_transaction:
                            db.rollback()
                    finally:
                        db.close()
        except (sqlite3.Error, OSError) as error:
            if (isinstance(error, sqlite3.OperationalError) and error.__cause__ is None
                    and ("locked" in str(error).lower() or "busy" in str(error).lower())):
                raise RunnerError("DATABASE_BUSY", "Runner state is busy; the exit was not recorded", retryable=True) from error
            raise RunnerError("RUNNER_STORAGE_ERROR", "The runner's exit could not be confirmed") from error

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
                result["due_count"] = db.execute("SELECT count(*) FROM recipient_schedule WHERE enabled=1 AND pending_count>0 AND next_due_ms<=? AND " + ANSWERING, (delivery._now_ms(),)).fetchone()[0]
                row = db.execute("SELECT a.id AS attempt_id,a.recipient_id,a.lease_until_ms FROM recipient_schedule s INDEXED BY active_claim_end JOIN wake_attempts a ON a.claim_token=s.claim_token WHERE s.claim_token IS NOT NULL AND s.claim_until_ms>? ORDER BY s.claim_until_ms LIMIT 1", (delivery._now_ms(),)).fetchone()
                result["claim"] = dict(row) if row else None
                return result
            finally:
                db.close()

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import uuid
from typing import Any


from .contract import LIMITS, Refusal, StoreError, organises, _json, _identifier, _body, _bounded_page, _page_size, _prefix, _revision
from .drafts import Drafts, DRAFT_SCHEMA
from .openings import Openings, OPENING_SCHEMA
from .conversation import Conversation, CONVERSATION_SCHEMA, MESSAGE_INTENT_SCHEMA, MESSAGE_TIME_SCHEMA, WRITTEN_SCHEMA
from .validation import COMMANDS, _command_envelope, _view_arguments
from .authority import Authority, AuthorityError, prepare_authority, publish_initial
from .delivery import Delivery, DELIVERY_SCHEMA, DELIVERY_TOPIC_FRESH, _now_ms
from . import initialization
from .runner import Runner, RUNNER_SCHEMA, HOSTED_SCHEMA
from .memory import Memory, MEMORY_DRAFT_SCHEMA, MEMORY_READ_SCHEMA, MEMORY_SCHEMA
from .media import Media, MEDIA_SCHEMA
from .route_pins import RoutePins
from .hosted_control import HostedControl
from .assessments import Assessments
from .changes import Changes
from .topic_state import ACTIVITY_SCHEMA, ASK_WAIT_SCHEMA, TopicState, TOPIC_STATE_SCHEMA, WAITING_ORDER_SCHEMA, order_cursor, order_position
from .work import OTHERS_SCHEMA, TURN_ACTIVITY_BACKFILL, WORK_SCHEMA, work_by_topic
from .marks import Marks, MARK_SCHEMA
from .colors import Colors, COLOR_SCHEMA
from .responsibility import Responsibility, RESPONSIBILITY_SCHEMA
from .sources import Sources, SOURCE_SCHEMA
from .wake_health import WakeHealth, WAKE_HEALTH_SCHEMA
from .health import Health, HEALTH_SCHEMA, LIGHT_KEY
from . import delivery as _delivery
from .releases import Releases, RELEASE_SCHEMA, write_release
from .outcome_light import OutcomeLight
from .whispers import WHISPER_SCHEMA, redact_topic
from .standing_conversation import StandingConversation, STANDING_SCHEMA
from .pipeline import Pipeline, PIPELINE_DECIDED_AGAIN_UP, PIPELINE_FACTS_SCHEMA, PIPELINE_SCHEMA, import_seed
from .checks import Checks, CHECKS_SCHEMA, PROBLEMS_SCHEMA, import_checks, record_checks
from .outcome_kind import OutcomeKind, KINDS_SCHEMA
from .outcome_rules import KIND_BEFORE_R21
from .reactions import Reactions, REACTION_SCHEMA
from .outline_order import OutlineOrder, ORDER_SCHEMA
from .stacks import Stacks, ACT_FRESH
from .blocking import Blocking, BLOCKS_SCHEMA
from .message_edit import MessageEdit, EDIT_SESSION_UP, MESSAGE_EDIT_UP
from . import message_edit


SCHEMA_VERSION = "41"


def commit_identity_intact(metadata):
    """Whether commit_seq and commit_id in this metadata are ones a store wrote."""
    sequence, commit_id = metadata.get("commit_seq"), metadata.get("commit_id")
    return (isinstance(sequence, str) and sequence.isascii() and sequence.isdigit()
            and len(sequence) <= 19 and int(sequence) < 9223372036854775807
            and isinstance(commit_id, str) and len(commit_id) == 32
            and all(c in "0123456789abcdef" for c in commit_id))


SCHEMA = [
    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE actors (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE workspaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES actors(id), title TEXT NOT NULL, purpose TEXT NOT NULL, coordinator_id TEXT REFERENCES actors(id), version INTEGER NOT NULL)",
    "CREATE TABLE workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL REFERENCES actors(id), PRIMARY KEY(workspace_id,actor_id))",
    "CREATE INDEX actor_workspaces ON workspace_members(actor_id,workspace_id)",
    "CREATE TABLE topics (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL, creator_id TEXT NOT NULL REFERENCES actors(id), version INTEGER NOT NULL)",
    "CREATE INDEX workspace_topics ON topics(workspace_id,id)",
    "CREATE TABLE operations (actor_id TEXT NOT NULL REFERENCES actors(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(actor_id,id))",
    "CREATE TABLE changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, version INTEGER NOT NULL)",
    "CREATE INDEX scoped_changes ON changes(scope_kind,scope_id,seq)",
    "CREATE TRIGGER immutable_operations_update BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT, 'immutable operation'); END",
    "CREATE TRIGGER immutable_operations_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT, 'immutable operation'); END",
]


def _connect(path, busy_ms=250):
    # Explicit rw prevents a typo from silently creating a second authority.
    # busy_ms is how long a statement waits on another connection's lock; only
    # the live feed, which reads off any request's path, asks for longer.
    db = sqlite3.connect(Path(path).absolute().as_uri() + "?mode=rw", uri=True,
                         isolation_level=None, timeout=busy_ms / 1000.0)
    try:
        db.row_factory = sqlite3.Row
        # The words helper's SQL function, on every connection (message_edit.py).
        message_edit.register(db)
        db.execute("PRAGMA synchronous=EXTRA")
        db.execute("PRAGMA fullfsync=ON")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=%d" % busy_ms)
        actual = {key: db.execute("PRAGMA " + key).fetchone()[0] for key in (
            "journal_mode", "synchronous", "fullfsync", "foreign_keys", "busy_timeout")}
        if actual != {"journal_mode": "delete", "synchronous": 3, "fullfsync": 1,
                      "foreign_keys": 1, "busy_timeout": busy_ms}:
            raise StoreError("The selected durability settings are not active")
        return db, actual
    except BaseException as error:
        # The caller never received this handle. Close it even on interruption;
        # a failed close explicitly preserves both failures, not a closed claim.
        try:
            db.close()
        except BaseException as cleanup_error:
            raise cleanup_error from error
        raise


def initialize(db_path, instance_id, initial_actors, *, authority_path):
    """Create a new isolated authority. Existing paths are never overwritten."""
    path, authority_path, actors = initialization.preflight(db_path, instance_id, initial_actors, authority_path)
    try:
        attempt = initialization.begin(authority_path, path, instance_id)
    except FileExistsError as error:
        raise AuthorityError("INITIALIZATION_PATH_OCCUPIED", "Another initialization claimed these paths; this attempt will not adopt or replace them") from error
    except Exception as error:
        raise initialization.incomplete() from error
    publication_attempted = False
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        binding, anchor = prepare_authority(authority_path, path, instance_id)
        db, _ = _connect(path)
        try:
            db.execute("BEGIN IMMEDIATE")
            for statement in SCHEMA + DRAFT_SCHEMA + DELIVERY_SCHEMA + CONVERSATION_SCHEMA + RUNNER_SCHEMA + MEMORY_SCHEMA + MEDIA_SCHEMA + OPENING_SCHEMA + HOSTED_SCHEMA + TOPIC_STATE_SCHEMA + MESSAGE_TIME_SCHEMA + WAITING_ORDER_SCHEMA + MARK_SCHEMA + MESSAGE_INTENT_SCHEMA + ASK_WAIT_SCHEMA + WORK_SCHEMA + WRITTEN_SCHEMA + COLOR_SCHEMA + DELIVERY_TOPIC_FRESH + ACTIVITY_SCHEMA + MEMORY_READ_SCHEMA + RESPONSIBILITY_SCHEMA + SOURCE_SCHEMA + WAKE_HEALTH_SCHEMA + RELEASE_SCHEMA + OTHERS_SCHEMA + TURN_ACTIVITY_BACKFILL + WHISPER_SCHEMA + STANDING_SCHEMA + PIPELINE_SCHEMA + CHECKS_SCHEMA + PROBLEMS_SCHEMA + KINDS_SCHEMA + list(PIPELINE_DECIDED_AGAIN_UP) + PIPELINE_FACTS_SCHEMA + HEALTH_SCHEMA + REACTION_SCHEMA + ORDER_SCHEMA + ACT_FRESH + BLOCKS_SCHEMA + MEMORY_DRAFT_SCHEMA + MESSAGE_EDIT_UP + EDIT_SESSION_UP:
                db.execute(statement)
            db.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance_id,))
            db.execute("INSERT INTO metadata VALUES ('schema_version',?)", (SCHEMA_VERSION,))
            db.execute("INSERT INTO metadata VALUES ('commit_seq','0')")
            db.execute("INSERT INTO metadata VALUES ('commit_id',?)", (uuid.uuid4().hex,))
            # A new instance has nothing red: no runner has run, no work waits, no wake was tried (health.py).
            db.execute("INSERT INTO metadata VALUES (?,?)", (LIGHT_KEY, json.dumps({"red": [], "seq": 0}, separators=(",", ":"))))
            db.executemany("INSERT INTO metadata VALUES (?,?)", list(binding.items()))
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", actors)
            db.commit()
        finally:
            # close rolls an uncommitted transaction back. Cleanup failures
            # also go through the typed initialization outcome below.
            db.close()
        publication_attempted = True
        publish_initial(binding, anchor)
        initialization.complete(authority_path, attempt)
    except Exception as error:
        # Publication may have succeeded before a subsequent fsync failed.
        # Never call that definitely uninitialized or remove its artifacts.
        if publication_attempted:
            raise AuthorityError("INITIALIZATION_UNCONFIRMED", "Authority publication was attempted but completion was not confirmed. Preserve the selected paths and inspect their state") from error
        raise initialization.incomplete() from error
    return {"instance_id": instance_id, "db_path": str(path), "binding": binding}


class StoreOpenError(StoreError):
    """A pre-dispatch opening failed, without dispatching any command."""

    def __init__(self, code, message, retryable=False):
        self.code, self.retryable = code, retryable
        super().__init__(message)


# A topic list's row: the topic with its message count and the sequence of its newest message, read through its one-row
# summary (a topic names no message here, so no whisper is read; tests/test_whispers.py).
_TOPIC_SUMMARY = "LEFT JOIN topic_summaries s ON s.topic_id=t.id LEFT JOIN messages m ON m.id=s.latest_message_id "


class Store(Assessments, HostedControl, Drafts, Openings, Delivery, Conversation, Runner, Memory, Media, RoutePins, Changes, TopicState, Marks, Colors, Responsibility, Sources, WakeHealth, Health, Releases, Checks, OutcomeKind,
            OutcomeLight, StandingConversation, Pipeline, Reactions, OutlineOrder, Stacks, Blocking, MessageEdit):
    def __init__(self, db_path, expected_instance_id, *, expected_binding, machine=None):
        self.path = Path(db_path).resolve()
        # What reads the Mac's load for the Health view (health.machine_load when None).
        self._machine = machine
        self.instance_id = _identifier(expected_instance_id, "instance_id")
        self._authority = Authority(self.path, self.instance_id, expected_binding)
        opening_error = None
        try:
            with self._authority.shared() as fence:
                try:
                    db, _ = _connect(self.path)
                    try:
                        db.execute("BEGIN")
                        fence.verify()
                        self._check_instance(db)
                    finally:
                        try:
                            db.close()
                        except (sqlite3.Error, OSError) as error:
                            raise StoreOpenError("STORE_OPEN_UNCONFIRMED", "Opening connection cleanup could not be confirmed") from error
                except (sqlite3.Error, OSError) as error:
                    # Decide retryability only after the fence also closes.
                    opening_error = error
        except (sqlite3.Error, OSError) as error:
            raise StoreOpenError("STORE_OPEN_UNCONFIRMED", "Opening authority cleanup could not be confirmed") from error
        except Refusal as exc:
            raise StoreOpenError(exc.code, exc.message) from exc
        if opening_error is not None:
            # _connect chains failed setup cleanup from the original error.
            if (isinstance(opening_error, sqlite3.OperationalError) and opening_error.__cause__ is None
                    and ("locked" in str(opening_error).lower() or "busy" in str(opening_error).lower())):
                raise StoreOpenError("DATABASE_BUSY", "The selected instance is busy", retryable=True) from opening_error
            raise StoreOpenError("STORE_OPEN_UNCONFIRMED", "The selected instance could not be opened") from opening_error

    @property
    def binding(self):
        return dict(self._authority.binding)

    def runner_guard(self, runner_id):
        return self._authority.runner_guard(runner_id)

    def wait_for_runner_guard(self):
        self._authority.wait_for_runner_guard()

    def register_actor(self, actor_id, kind, name):
        """Operator registration of one enabled actor; never a command or an HTTP route."""
        _identifier(actor_id, "actor_id")
        if kind not in ("human", "agent"):
            raise Refusal("INVALID_ARGUMENT", "An actor is a human or an agent")
        if not _body(name).strip():
            raise Refusal("INVALID_ARGUMENT", "An actor needs a name")

        def write(db):
            if db.execute("SELECT 1 FROM actors WHERE id=?", (actor_id,)).fetchone():
                raise Refusal("ACTOR_EXISTS", "This actor ID is already registered")
            db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", (actor_id, kind, name))
            return True
        self._operator_write(write, "registered", "registration")
        return {"instance_id": self.instance_id, "actor": {"id": actor_id, "kind": kind, "name": name, "enabled": True}}

    def record_release(self, record):
        """Operator record of one release (docs/releases.md); never a command or an HTTP route."""
        found = {}

        def write(db):
            found["release"], written = write_release(db, record, _now_ms())
            if written:
                self._ship_release(db, found["release"])
            return written
        written = self._operator_write(write, "recorded", "release record")
        return {"instance_id": self.instance_id, "release": found["release"], "recorded": written}

    def import_pipeline(self, seed, actor):
        """Operator import of the hand-written pipeline (docs/pipeline.md); never a command or an HTTP route."""
        found = {}

        def write(db):
            found["report"] = import_seed(self, db, seed, actor, _now_ms())
            return found["report"]["imported"]
        self._operator_write(write, "imported", "pipeline import")
        return dict(found["report"], instance_id=self.instance_id)

    def record_checks(self, run, actor):
        """Operator record of one release-check run and its base rerun (docs/targets.md); never a command or an HTTP route."""
        found = {}

        def write(db):
            found["report"] = record_checks(self, db, run, actor)
            return found["report"]["recorded"]
        self._operator_write(write, "recorded", "check run")
        return dict(found["report"], instance_id=self.instance_id)

    def import_checks(self, seed, actor):
        """Operator import of an outcome's target, checks and problems found (docs/targets.md); never a command or an HTTP route."""
        found = {}

        def write(db):
            found["report"] = import_checks(self, db, seed, actor, _now_ms())
            return found["report"]["checks_imported"]
        self._operator_write(write, "imported", "checks import")
        return dict(found["report"], instance_id=self.instance_id)

    def _operator_write(self, write, done, noun):
        """Run write(db) in one short write transaction; it returns whether it changed anything."""
        with self._authority.shared() as fence:
            db, _ = _connect(self.path)
            try:
                db.execute("BEGIN IMMEDIATE")
                fence.verify()
                self._check_instance(db)
                changed = write(db)
                if changed:
                    # Every commit keeps what is red with it (health.py).
                    self._health_commit(db, _delivery._now_ms())
                db.commit()
                return changed
            except sqlite3.Error as error:
                if isinstance(error, sqlite3.OperationalError) and ("locked" in str(error).lower() or "busy" in str(error).lower()):
                    raise StoreOpenError("DATABASE_BUSY", "The selected instance is busy; nothing was " + done, retryable=True) from error
                raise StoreError("The %s could not be confirmed" % noun) from error
            finally:
                if db.in_transaction:
                    db.rollback()
                db.close()

    def _check_instance(self, db):
        row = db.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()
        if row is None or row[0] != self.instance_id:
            raise Refusal("INSTANCE_MISMATCH", "The selected instance does not match")
        metadata = dict(db.execute("SELECT key,value FROM metadata WHERE key IN ('schema_version','commit_seq','commit_id','authority_id','authority_path','authority_epoch')"))
        stored = metadata.get("schema_version")
        from .migrations import newer, unfinished, upgradable
        # The version comes first, as in recovery and migrate: a later layout
        # may keep its commit identity differently, so a database this code is
        # too old for is told so, whatever that identity looks like.
        if newer(stored):
            raise Refusal("SCHEMA_MISMATCH", "This database is at schema version %s, which this code (version %s) cannot "
                          "read or migrate; run code that reads version %s. Nothing was changed" % (stored, SCHEMA_VERSION, stored))
        # Damaged commit identity is damage at any other version: no migrate
        # advice, since migrate would carry the damage forward.
        if not commit_identity_intact(metadata):
            raise Refusal("SCHEMA_MISMATCH", "This database schema is unsupported; no automatic migration was attempted")
        if stored != SCHEMA_VERSION:
            # Migrate is the remedy only when this code can move the database
            # up to its own version; anything else is damage.
            if upgradable(stored):
                raise Refusal("SCHEMA_MISMATCH", "This database is at schema version %s and this code reads version %s; "
                              "move it with bin/aim-next-admin migrate. Nothing was changed" % (stored, SCHEMA_VERSION))
            raise Refusal("SCHEMA_MISMATCH", "This database schema is unsupported; no automatic migration was attempted")
        if unfinished(db, stored):
            raise Refusal("SCHEMA_MISMATCH", "This database was stamped schema version %s by an earlier form of that upgrade; "
                          "finish it with bin/aim-next-admin migrate. Nothing was changed" % stored)
        if any(metadata.get(key) != value for key, value in self.binding.items()):
            raise AuthorityError("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")

    @staticmethod
    def _advance_commit_seq(db):
        # The sequence stops one short of SQLite's largest integer, past which
        # CAST+1 would store a float: every value it writes is one the store
        # accepts again (commit_identity_intact).
        changed = db.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+1 "
                             "WHERE key='commit_seq' AND CAST(value AS INTEGER) < 9223372036854775806").rowcount
        identified = db.execute("UPDATE metadata SET value=? WHERE key='commit_id'", (uuid.uuid4().hex,)).rowcount
        if changed != 1 or identified != 1:
            raise StoreError("The durable commit identity is unavailable")

    def _actor(self, db, actor):
        _identifier(actor, "actor")
        row = db.execute("SELECT * FROM actors WHERE id=? AND enabled=1", (actor,)).fetchone()
        if row is None:
            raise Refusal("INVALID_ACTOR", "No active actor binding for this instance")
        return row

    def _receipt(self, envelope, status, recorded, result=None, affected=None, error=None):
        answer = {"instance_id": self.instance_id, "operation_id": envelope.get("operation_id"),
                  "kind": envelope.get("kind"), "status": status, "recorded": recorded,
                  "result": result, "affected": affected or []}
        if error is not None:
            answer["error"] = error
        return answer

    def _refusal(self, envelope, exc, recorded=False):
        error = {"code": exc.code, "message": exc.message, "retryable": False}
        if exc.current_versions is not None:
            error["current_versions"] = exc.current_versions
        return self._receipt(envelope, "rejected", recorded, error=error)

    def command(self, actor, envelope):
        return self._execute_command(actor, envelope)

    def _execute_command(self, actor, envelope, preflight=None, effect=None):
        # Media streaming uses a short preflight and this same receipt path
        # for its final metadata write. Neither adapter owns another journal.
        if not isinstance(envelope, dict):
            envelope = {}
        db = None
        fence = None
        try:
            if envelope.get("instance_id") != self.instance_id:
                raise Refusal("INSTANCE_MISMATCH", "Command belongs to another instance")
            envelope = _command_envelope(envelope)
            op_id, kind = envelope["operation_id"], envelope["kind"]
            fingerprint = hashlib.sha256(_json(envelope).encode("utf-8")).hexdigest()
            fence = self._authority.shared()
            fence.__enter__()
            db, _ = _connect(self.path)
            # All command checks, including the deduplication lookup, share the
            # write transaction. Python's implicit DML BEGIN is insufficient.
            db.execute("BEGIN" if preflight is not None else "BEGIN IMMEDIATE")
            # Revalidate after SQLite has opened and locked its database. The
            # pathname may have been replaced after the fence's first check.
            fence.verify()
            self._check_instance(db)
            self._actor(db, actor)
            if envelope["expected"]["authority"] != {"authority_id": fence.record["authority_id"], "authority_epoch": fence.record["epoch"]}:
                raise AuthorityError("AUTHORITY_CHANGED", "This act belongs to another authority epoch; reconcile it without changing its captured binding")
            previous = db.execute("SELECT fingerprint,outcome FROM operations WHERE actor_id=? AND id=?",
                                  (actor, op_id)).fetchone()
            if previous is not None:
                if previous["fingerprint"] != fingerprint:
                    raise Refusal("OPERATION_PAYLOAD_MISMATCH", "This operation already names different content")
                db.rollback()
                return json.loads(previous["outcome"])
            self._check_send_reservation(db, actor, envelope)
            self._check_media_reservation(db, actor, envelope)
            if preflight is not None:
                value = preflight(db, actor, envelope)
                db.rollback()
                return value
            db.execute("SAVEPOINT effect")
            try:
                handler = getattr(self, COMMANDS[kind]) if kind in COMMANDS else None
                if handler is None:
                    raise Refusal("UNKNOWN_COMMAND", "Unsupported command kind")
                since = db.execute("SELECT coalesce(max(seq),0) FROM changes").fetchone()[0]
                result, affected = (effect if effect is not None else handler)(db, actor, envelope)
                # A reached outcome is final: nothing a command writes may land in it (D42, 4.5).
                self._refuse_reached(db, kind, since)
                receipt = self._receipt(envelope, "committed", True, result, affected)
            except Refusal as exc:
                db.execute("ROLLBACK TO effect")
                if not exc.recorded:
                    raise
                receipt = self._refusal(envelope, exc, recorded=True)
            db.execute("RELEASE effect")
            # Any recorded act is a sign of life: the actor's wakes are answered.
            now = _delivery._now_ms()
            self._sign_of_life(db, actor, now)
            self._health_acted(db, actor, now)
            db.execute("INSERT INTO operations VALUES (?,?,?,?,?)", (actor, op_id, fingerprint, kind, _json(receipt)))
            # What is red may have changed with this act (health.py); the last step before the commit.
            self._health_commit(db, now)
            db.commit()
            return receipt
        except Refusal as exc:
            return self._refusal(envelope, exc)
        except AuthorityError as exc:
            return self._receipt(envelope, "retryable" if exc.retryable else "rejected", False,
                                 error={"code": exc.code, "message": exc.message, "retryable": exc.retryable})
        except sqlite3.IntegrityError:
            return self._receipt(envelope, "rejected", False, error={
                "code": "INTERNAL_ERROR", "message": "No outcome was recorded; reconcile before continuing", "retryable": False})
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                return self._receipt(envelope, "retryable", False, error={
                    "code": "DATABASE_BUSY", "message": "This attempt is busy; reconcile the original operation before retrying", "retryable": True})
            raise StoreError("Storage operation could not be completed") from exc
        finally:
            if db is not None:
                if db.in_transaction:
                    db.rollback()
                db.close()
            if fence is not None:
                fence.close()

    def view(self, actor, view_name, args):
        return self._view(actor, view_name, args)

    def _view(self, actor, view_name, args, between=None, marks=True):
        """One view, read in one transaction. between and marks are test seams (docs/message-edit.md): between() runs
        after phase 1's rollback and before phase 2, and marks=False runs the handler with nothing marked or recorded."""
        db = None
        fence = None
        try:
            args = _view_arguments(view_name, args)
            fence = self._authority.shared()
            fence.__enter__()
            db, runtime = _connect(self.path)
            db.execute("BEGIN")
            fence.verify()
            self._check_instance(db)
            kind = self._actor(db, actor)["kind"]
            if view_name == "capabilities":
                return {"instance_id": self.instance_id, "limits": dict(LIMITS), "runtime": runtime,
                        "authority": self._authority.facts(fence.record), "runner": self._runner_facts(db),
                        "attention": {"after": self._addressed_after(db, actor)}, "actor_kind": kind}
            if view_name == "operation":
                op_id = _identifier(args.get("operation_id"), "operation_id")
                row = db.execute("SELECT outcome FROM operations WHERE actor_id=? AND id=?", (actor, op_id)).fetchone()
                return json.loads(row[0]) if row else {"instance_id": self.instance_id, "operation_id": op_id,
                                                     "status": "unknown", "recorded": False}
            handler = getattr(self, "_view_" + view_name, None)
            if handler is None:
                raise Refusal("UNKNOWN_VIEW", "Unsupported view")
            return self._hand_over(db, fence, actor, kind, args, handler, between, marks)
        except Refusal as exc:
            return {"instance_id": self.instance_id, "error": {"code": exc.code, "message": exc.message, "retryable": False}}
        except AuthorityError as exc:
            return {"instance_id": self.instance_id, "error": {"code": exc.code, "message": exc.message, "retryable": exc.retryable}}
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                return {"instance_id": self.instance_id, "error": {"code": "DATABASE_BUSY", "message": "Read is temporarily unavailable", "retryable": True}}
            raise StoreError("Storage view could not be read") from exc
        finally:
            if db is not None:
                if db.in_transaction:
                    db.rollback()
                db.close()
            if fence is not None:
                fence.close()

    def _read_once(self, db, actor, kind, args, handler, marks):
        """Run the handler once with the read context set, and walk its answer at the boundary: the answer with this
        run's markers taken out, the (message_id, revision) pairs it handed, and the clock it read at."""
        now = _delivery._now_ms()
        agent = kind == "agent"
        current = message_edit.Reading(agent, now, message_edit.held_ids(db, now) if agent else set(), secrets.token_hex(4), marking=marks)
        token = message_edit.reading.set(current)
        try:
            answer = handler(db, actor, args)
        finally:
            message_edit.reading.reset(token)
        answer, pairs = message_edit.handed(db, current, answer)
        return answer, pairs, now

    def _hand_over(self, db, fence, actor, kind, args, handler, between, marks):
        """The boundary (docs/message-edit.md, "Exposure"): what leaves the store is the handler's answer with every
        marker taken out, and each person's message whose words reached an agent at a revision it was not yet known to
        have been handed is recorded, so a later edit corrects exactly the agents that were handed the old words.

        A read that grows nothing returns as today, with no write. One that grows rolls back, opens BEGIN IMMEDIATE on
        the same connection under the same fence, and runs the handler once more at a fresh clock, so nothing can
        commit between the words it returns and the exposure it records; if the second run grows nothing (another
        read recorded it, or the message became held) it rolls back with no write."""
        answer, pairs, now = self._read_once(db, actor, kind, args, handler, marks)
        if not marks or not message_edit.growing(db, actor, pairs):
            return answer
        db.rollback()
        if between is not None:
            between()
        db.execute("BEGIN IMMEDIATE")
        fence.verify()
        self._check_instance(db)
        kind = self._actor(db, actor)["kind"]
        answer, pairs, now = self._read_once(db, actor, kind, args, handler, marks)
        grows = message_edit.growing(db, actor, pairs)
        if not grows:
            db.rollback()
            return answer
        db.executemany("INSERT INTO message_exposures(actor_id,message_id,revision) VALUES (?,?,?) "
                       "ON CONFLICT(actor_id,message_id) DO UPDATE SET revision=max(revision,excluded.revision)",
                       [(actor, message_id, number) for message_id, number in grows])
        # Every commit keeps what is red with it (health.py), at the clock this run read.
        self._health_commit(db, now)
        db.commit()
        return answer

    def _workspace(self, db, actor, workspace_id, organise=False):
        """The workspace actor may read (its owner and members), or with organise=True
        may organise (contract.organises). Being coordinator grants no reading."""
        _identifier(workspace_id, "workspace_id")
        row = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if organise:
            allowed = row and organises(row, actor)
        else:
            allowed = row and (row["owner_id"] == actor or db.execute(
                "SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace_id, actor)).fetchone())
        if not allowed:
            raise Refusal("FORBIDDEN", "No permission for this workspace")
        return row

    def _change(self, db, scope_kind, scope_id, kind, record_id, version):
        db.execute("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES (?,?,?,?,?)",
                   (scope_kind, scope_id, kind, record_id, version))

    def _outcome_change(self, db, workspace_id, version):
        """The outcome's own record changed: its team, owner or coordinator. Open outcome
        pages read the key in the workspace scope, and open topic pages in the outcome
        scope, which holds only these keys, so a page learns who may organise it now."""
        self._change(db, "workspace", workspace_id, "workspace", workspace_id, version)
        self._change(db, "outcome", workspace_id, "workspace", workspace_id, version)

    def _command_workspace_create(self, db, actor, envelope):
        args = envelope.get("args", {})
        workspace_id = _identifier(args.get("id") or "w-" + uuid.uuid4().hex)
        existing = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        expected = envelope.get("expected", {}).get("workspace_revision", 0)
        if existing is not None:
            versions = None
            try:
                self._workspace(db, actor, workspace_id)
                versions = {"workspace_revision": existing["version"]}
            except Refusal:
                pass
            raise Refusal("REVISION_CONFLICT", "The workspace already exists", versions)
        if expected != 0:
            raise Refusal("REVISION_CONFLICT", "Create requires revision zero", {"workspace_revision": 0})
        title = _body(args.get("title", ""))
        if not title.strip():
            raise Refusal("INVALID_ARGUMENT", "A workspace needs a title")
        team = args.get("team", [])
        if not isinstance(team, list):
            raise Refusal("INVALID_ARGUMENT", "Choose a bounded workspace team")
        team = self._recipients(db, [actor] + team)
        if len(team) > LIMITS["workspace_members"]:
            raise Refusal("TOO_MANY_WORKSPACE_MEMBERS", "Workspace team limit includes its owner")
        coordinator = args.get("coordinator")
        if coordinator is not None and coordinator not in team:
            raise Refusal("INVALID_RECIPIENT", "The coordinator must belong to the chosen team")
        db.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,1)",
                   (workspace_id, actor, title, _body(args.get("purpose", "")), coordinator))
        db.executemany("INSERT INTO workspace_members VALUES (?,?)", [(workspace_id, member) for member in team])
        # Every outcome has its conversation from the moment it is made (standing_conversation.py).
        conversation_id = self._start_conversation(db, workspace_id, [], actor)
        # The outcome's start record: its kind, who started it and when (D41, D22). The
        # kind is chosen on the outcome's page; until then it is to keep.
        self._write_start_kind(db, workspace_id, actor, args.get("kind", KIND_BEFORE_R21), _now_ms())
        self._outcome_change(db, workspace_id, 1)
        return {"workspace": {"id": workspace_id, "owner_id": actor, "title": title, "version": 1},
                "conversation_id": conversation_id}, [
            {"kind": "workspace", "id": workspace_id, "version": 1}]

    def _view_workspace(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        # Whether the outcome has its conversation (null for one made before version 28 and not
        # yet started), so a page keeps the conversation's row in its place before reading it.
        conversation = self._conversation_of(db, workspace["id"])
        return {"instance_id": self.instance_id, "workspace": dict(workspace, conversation_id=conversation["id"] if conversation else None),
                "relevant_versions": {"workspace": workspace["version"]}}

    def _view_workspaces(self, db, actor, args):
        limit = _page_size(args)
        reached = args.get("reached", False)
        if not isinstance(reached, bool):
            raise Refusal("INVALID_ARGUMENT", "reached is true or false")
        # Creation always includes the owner in this indexed membership set.
        # BLOB substr bounds bytes, including titles containing embedded NUL.
        # Reached outcomes are left out, or listed alone with reached: true (D42).
        rows = db.execute("SELECT w.id,w.owner_id,substr(CAST(w.title AS BLOB),1,1025) AS title_prefix,w.version,w.coordinator_id "
                          "FROM workspace_members AS m JOIN workspaces AS w ON w.id=m.workspace_id "
                          "WHERE m.actor_id=? AND m.workspace_id>? AND " + ("" if reached else "NOT ") +
                          "EXISTS (SELECT 1 FROM outcome_reached r WHERE r.workspace_id=w.id) ORDER BY m.workspace_id LIMIT ?",
                          (actor, args.get("cursor", ""), limit + 1)).fetchall()
        reached_count = db.execute("SELECT count(*) FROM workspace_members m JOIN outcome_reached r ON r.workspace_id=m.workspace_id "
                                   "WHERE m.actor_id=?", (actor,)).fetchone()[0]

        totals = {}
        counts = self._unread(db, actor, workspaces=[row["id"] for row in rows[:limit]])
        for unread, addressed, workspace_id in counts.values():
            total = totals.setdefault(workspace_id, [0, 0])
            total[0] += unread
            total[1] += addressed

        def item(row):
            title, truncated = _prefix(row["title_prefix"])
            unread, addressed = totals.get(row["id"], (0, 0))
            # The part of them in its open Build topics (item 297), which the outline shows on the outcome's row, since
            # the right rail, not the outline, lists those topics.
            build = self._build_counts(counts, self._open_build_topics(db, row["id"]))
            # Where the outcome stands for this reader (item 86, docs/outcome-light.md).
            facts = self._kind_facts(db, row)
            # Its conversation, so a press on it can open that (null for one made before version 28 and not yet started).
            conversation = self._conversation_of(db, row["id"])
            return {"id": row["id"], "owner_id": row["owner_id"], "title": title, "conversation_id": conversation["id"] if conversation else None,
                    "title_truncated": truncated, "version": row["version"],
                    "unread": unread, "addressed": addressed, "build": build, "kind": facts["kind"],
                    "reached_ms": facts["reached"]["ms"] if facts["reached"] else None,
                    "light": self._outcome_stands(db, actor, row)["light"]}
        # The person's own order of their outcomes, on every page (outline_order.py).
        return _bounded_page({"instance_id": self.instance_id, "reached_count": reached_count,
                              "order": self._outline_order(db, actor)}, rows, limit, item, "id")

    def _view_actors(self, db, actor, args):
        """The instance's enabled people and agents, in id order: who can be added to a team or topic.

        Everyone in the instance may read it; what someone can then do with a
        name is decided by the command that adds them."""
        limit = _page_size(args)
        kind = args.get("kind")
        if kind is not None and kind not in ("human", "agent"):
            raise Refusal("INVALID_ARGUMENT", "An actor is a human or an agent")
        rows = db.execute("SELECT id,kind,substr(CAST(name AS BLOB),1,1025) AS name_prefix FROM actors "
                          "WHERE enabled=1 AND id>?" + (" AND kind=?" if kind else "") + " ORDER BY id LIMIT ?",
                          (args.get("cursor", ""),) + ((kind,) if kind else ()) + (limit + 1,)).fetchall()

        def item(row):
            name, truncated = _prefix(row["name_prefix"])
            return {"id": row["id"], "kind": row["kind"], "name": name, "name_truncated": truncated}
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, item, "id")

    def _view_workspace_members(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        limit = _page_size(args)
        rows = db.execute("SELECT m.actor_id,a.kind,a.enabled,substr(CAST(a.name AS BLOB),1,1025) AS name_prefix "
                          "FROM workspace_members AS m JOIN actors AS a ON a.id=m.actor_id "
                          "WHERE m.workspace_id=? AND m.actor_id>? ORDER BY m.actor_id LIMIT ?",
                          (workspace["id"], args.get("cursor", ""), limit + 1)).fetchall()

        def item(row):
            name, truncated = _prefix(row["name_prefix"])
            return {"actor_id": row["actor_id"], "kind": row["kind"], "name": name, "name_truncated": truncated,
                    "enabled": bool(row["enabled"])}
        return _bounded_page({"instance_id": self.instance_id, "relevant_versions": {"workspace": workspace["version"]}},
                             rows, limit, item, "actor_id")

    def _command_workspace_member_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"actor_id", "present"} or not isinstance(args["present"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one workspace, one actor and whether they are present")
        workspace = self._workspace(db, actor, target["workspace_id"], organise=True)
        _revision(envelope["expected"], "workspace_revision", workspace["version"])
        present = args["present"]
        member = self._recipients(db, [args["actor_id"]], require_enabled=present)[0]
        if member == workspace["owner_id"] and not present:
            raise Refusal("OWNER_REQUIRED", "The workspace owner cannot be removed")
        version = workspace["version"]
        result = {"workspace_id": workspace["id"], "actor_id": member, "present": present, "version": version}
        if bool(db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?",
                           (workspace["id"], member)).fetchone()) == present:
            return result, []
        if present:
            count = db.execute("SELECT count(*) FROM workspace_members WHERE workspace_id=?", (workspace["id"],)).fetchone()[0]
            if count >= LIMITS["workspace_members"]:
                raise Refusal("TOO_MANY_WORKSPACE_MEMBERS", "Workspace team limit includes its owner")
            db.execute("INSERT INTO workspace_members VALUES (?,?)", (workspace["id"], member))
        else:
            # Topic participation held separately is unchanged.
            db.execute("DELETE FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace["id"], member))
        # A removed coordinator no longer coordinates; the workspace names nobody.
        coordinator = None if not present and member == workspace["coordinator_id"] else workspace["coordinator_id"]
        db.execute("UPDATE workspaces SET version=version+1,coordinator_id=? WHERE id=?", (coordinator, workspace["id"]))
        # The conversation's people follow the team, and its coordinator (standing_conversation.py).
        self._sync_participants(db, workspace["id"])
        if not present:
            # Corrections of messages they can no longer read go with them (message_edit.py).
            self._settle_unreadable_corrections(db, member)
            # A topic they can no longer read, the conversation among them, stops waiting on them;
            # touching it advances the outcome too.
            for topic in self._unwait(db, member, "workspace_id", workspace["id"]):
                self._change(db, "actor", member, "waiting", topic["id"], self._touch_topic(db, topic))
        version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace["id"],)).fetchone()[0]
        self._outcome_change(db, workspace["id"], version)
        self._change(db, "actor", member, "workspace", workspace["id"], version)
        return dict(result, version=version), [{"kind": "workspace", "id": workspace["id"], "version": version}]

    def _command_workspace_owner_set(self, db, actor, envelope):
        """The owner hands the outcome to another member, and stays on its team."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"owner_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one workspace and its new owner")
        workspace = self._workspace(db, actor, target["workspace_id"], organise=True)
        if actor != workspace["owner_id"]:
            raise Refusal("FORBIDDEN", "Only the outcome's owner can hand it on")
        _revision(envelope["expected"], "workspace_revision", workspace["version"])
        owner = self._recipients(db, [args["owner_id"]])[0]
        result = {"workspace_id": workspace["id"], "owner_id": owner, "previous_owner_id": workspace["owner_id"],
                  "version": workspace["version"]}
        if owner == workspace["owner_id"]:
            return result, []
        if not db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace["id"], owner)).fetchone():
            raise Refusal("NOT_A_MEMBER", "Add %s to the outcome's team before handing it to them" % owner)
        # Creation and member_set keep the owner on the team, so this adds no one a command could reach.
        db.execute("INSERT OR IGNORE INTO workspace_members VALUES (?,?)", (workspace["id"], workspace["owner_id"]))
        db.execute("UPDATE workspaces SET version=version+1,owner_id=? WHERE id=?", (owner, workspace["id"]))
        version = workspace["version"] + 1
        self._outcome_change(db, workspace["id"], version)
        for member in (owner, workspace["owner_id"]):
            self._change(db, "actor", member, "workspace", workspace["id"], version)
        return dict(result, version=version), [{"kind": "workspace", "id": workspace["id"], "version": version}]

    def _command_workspace_update(self, db, actor, envelope):
        """Whoever organises an outcome renames it or says what it is for, in place after creating it."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or not args or set(args) - {"title", "purpose"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome and its new title, purpose or both")
        workspace = self._workspace(db, actor, target["workspace_id"], organise=True)
        _revision(envelope["expected"], "workspace_revision", workspace["version"])
        title = _body(args.get("title", workspace["title"]))
        if not title.strip():
            raise Refusal("EMPTY_TITLE", "An outcome needs a title")
        purpose = _body(args.get("purpose", workspace["purpose"]))
        if (title, purpose) == (workspace["title"], workspace["purpose"]):
            return {"workspace_id": workspace["id"], "title": title, "purpose": purpose, "version": workspace["version"]}, []
        version = workspace["version"] + 1
        db.execute("UPDATE workspaces SET title=?,purpose=?,version=? WHERE id=?", (title, purpose, version, workspace["id"]))
        self._change(db, "workspace", workspace["id"], "workspace", workspace["id"], version)
        return {"workspace_id": workspace["id"], "title": title, "purpose": purpose, "version": version}, [
            {"kind": "workspace", "id": workspace["id"], "version": version}]

    def _view_workspace_topics(self, db, actor, args):
        """One page of an outcome's topics, latest activity first (docs/topic-list.md).

        Three lists, each from one index: the topics that are neither done nor
        archived (the default), the done ones (done: true), and the archived ones
        (archived: true), done or not, the done ones after the rest."""
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        limit = args.get("limit", LIMITS["page_default"])
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMITS["page_max"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid page size")
        archived, done, build = args.get("archived", False), args.get("done", False), args.get("build")
        if not isinstance(archived, bool) or not isinstance(done, bool) or not isinstance(build, (bool, type(None))):
            raise Refusal("INVALID_ARGUMENT", "Archived, done and build are true or false")
        if archived and done:
            raise Refusal("INVALID_ARGUMENT", "Archived topics are listed together, done or not; ask for archived alone")
        if build is not None and (archived or done):
            raise Refusal("INVALID_ARGUMENT", "Build topics are listed apart only among the open topics; a done or archived one is in its own list")
        # The outcome's Build topics (item 297): build true lists only them among the open topics, build false the rest.
        builds = self._build_topics(db, workspace["id"])
        apart = "" if build is None else " AND t.id %sIN (SELECT value FROM json_each(?))" % ("" if build else "NOT ")
        # An empty cursor, as for the other lists, is the start.
        after = order_position(args["cursor"]) if args.get("cursor", "") != "" else None
        rows = []
        for flag in ((0, 1) if archived else (int(done),)):
            if after is not None and flag < after[0]:
                continue
            keyset = after is not None and flag == after[0]
            # latest_seq is the sequence of the topic's newest message, read through its one-row summary.
            rows += db.execute("SELECT t.*,s.message_count,m.seq AS latest_seq FROM topics t INDEXED BY workspace_topic_order " + _TOPIC_SUMMARY +
                               "WHERE t.workspace_id=? AND t.archived=? AND (t.state='done')=?" + (
                                   # The open list leaves out the conversation, which has its own row; it is
                                   # never Done or archived unless its outcome is reached, and then it is listed there.
                                   " AND t.kind='topic'" if not archived and not flag else "") + apart + (" AND (t.activity_ms,t.id)<(?,?)" if keyset else "") +
                               " ORDER BY t.activity_ms DESC,t.id DESC LIMIT ?",
                               (workspace["id"], int(archived), flag) + ((json.dumps(sorted(builds)),) if apart else ()) + (after[1:] if keyset else ())
                               + (limit + 1 - len(rows),)).fetchall()
            if len(rows) > limit:
                break
        items = self._topic_items(db, actor, rows[:limit], builds)
        last = items[-1] if items else None
        # How many topics the folded lists hold, each counted in its own stretch of the index.
        groups = {"done": db.execute("SELECT count(*) FROM topics INDEXED BY workspace_topic_order WHERE workspace_id=? AND archived=0 AND (state='done')=1",
                                     (workspace["id"],)).fetchone()[0],
                  "archived": db.execute("SELECT count(*) FROM topics INDEXED BY workspace_topic_order WHERE workspace_id=? AND archived=1",
                                         (workspace["id"],)).fetchone()[0]}
        answer = {"instance_id": self.instance_id, "items": items, "groups": groups,
                  "next_cursor": order_cursor(last["state"] == "done", last["activity_ms"], last["id"]) if len(rows) > limit else None,
                  # The person's own order of this outcome's topics, on every page (outline_order.py).
                  "order": self._outline_order(db, actor, workspace["id"]),
                  "relevant_versions": {"workspace": workspace["version"]}}
        if build:
            # What all the open Build topics hold for the reader, not only this page's, for the count the right rail's Pipeline shows.
            open_builds = self._open_build_topics(db, workspace["id"])
            answer["builds"] = self._build_counts(self._unread(db, actor, topics=sorted(open_builds)), open_builds)
            # The ones holding a piece under way, whatever page they fall on, so each row of the right rail's Now carries its marks.
            building = sorted(self._building_topics(db, workspace["id"]))
            answer["building"] = self._topic_items(db, actor, db.execute(
                "SELECT t.*,s.message_count,m.seq AS latest_seq FROM topics t " + _TOPIC_SUMMARY +
                "WHERE t.id IN (SELECT value FROM json_each(?)) ORDER BY t.activity_ms DESC,t.id DESC",
                (json.dumps(building),)).fetchall(), builds) if building else []
        return answer

    def _topic_items(self, db, actor, rows, builds):
        """A topic list's items as every list gives them: each with the reader's unread count, where it stands, its work
        and whether it is a Build topic (builds, item 297)."""
        # A topic names the message that reopened or started it only to a reader who may see it (whispers.py).
        items = [redact_topic(db, actor, row) for row in rows]
        counts = self._unread(db, actor, topics=[item["id"] for item in items])
        waits = self._waits_by_topic(db, [item["id"] for item in items])
        work = work_by_topic(db, waits, actor)
        for item in items:
            item["unread"], item["addressed"] = counts.get(item["id"], (0, 0, None))[:2]
            item["archived"] = bool(item["archived"])
            item["waiting_on"], item["asks"] = waits[item["id"]]
            item["work"] = work[item["id"]]
            item["build"] = item["id"] in builds
        return items

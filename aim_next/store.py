from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid
from typing import Any


from .contract import LIMITS, Refusal, StoreError, _json, _identifier, _body, _bounded_page, _page_size, _prefix, _revision
from .drafts import Drafts, DRAFT_SCHEMA
from .openings import Openings, OPENING_SCHEMA
from .conversation import Conversation, CONVERSATION_SCHEMA, MESSAGE_TIME_SCHEMA
from .validation import COMMANDS, _command_envelope, _view_arguments
from .authority import Authority, AuthorityError, prepare_authority, publish_initial
from .delivery import Delivery, DELIVERY_SCHEMA
from . import initialization
from .runner import Runner, RUNNER_SCHEMA, HOSTED_SCHEMA
from .memory import Memory, MEMORY_SCHEMA
from .media import Media, MEDIA_SCHEMA
from .route_pins import RoutePins
from .changes import Changes
from .topic_state import TopicState, TOPIC_STATE_SCHEMA, WAITING_ORDER_SCHEMA


SCHEMA_VERSION = "12"


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


def _connect(path):
    # Explicit rw prevents a typo from silently creating a second authority.
    db = sqlite3.connect(Path(path).absolute().as_uri() + "?mode=rw", uri=True,
                         isolation_level=None, timeout=0.25)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=EXTRA")
        db.execute("PRAGMA fullfsync=ON")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=250")
        actual = {key: db.execute("PRAGMA " + key).fetchone()[0] for key in (
            "journal_mode", "synchronous", "fullfsync", "foreign_keys", "busy_timeout")}
        if actual != {"journal_mode": "delete", "synchronous": 3, "fullfsync": 1,
                      "foreign_keys": 1, "busy_timeout": 250}:
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
            for statement in SCHEMA + DRAFT_SCHEMA + DELIVERY_SCHEMA + CONVERSATION_SCHEMA + RUNNER_SCHEMA + MEMORY_SCHEMA + MEDIA_SCHEMA + OPENING_SCHEMA + HOSTED_SCHEMA + TOPIC_STATE_SCHEMA + MESSAGE_TIME_SCHEMA + WAITING_ORDER_SCHEMA:
                db.execute(statement)
            db.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance_id,))
            db.execute("INSERT INTO metadata VALUES ('schema_version',?)", (SCHEMA_VERSION,))
            db.execute("INSERT INTO metadata VALUES ('commit_seq','0')")
            db.execute("INSERT INTO metadata VALUES ('commit_id',?)", (uuid.uuid4().hex,))
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


class Store(Drafts, Openings, Delivery, Conversation, Runner, Memory, Media, RoutePins, Changes, TopicState):
    def __init__(self, db_path, expected_instance_id, *, expected_binding):
        self.path = Path(db_path).resolve()
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

    def register_actor(self, actor_id, kind, name):
        """Operator registration of one enabled actor; never a command or an HTTP route."""
        _identifier(actor_id, "actor_id")
        if kind not in ("human", "agent"):
            raise Refusal("INVALID_ARGUMENT", "An actor is a human or an agent")
        if not _body(name).strip():
            raise Refusal("INVALID_ARGUMENT", "An actor needs a name")
        with self._authority.shared() as fence:
            db, _ = _connect(self.path)
            try:
                db.execute("BEGIN IMMEDIATE")
                fence.verify()
                self._check_instance(db)
                if db.execute("SELECT 1 FROM actors WHERE id=?", (actor_id,)).fetchone():
                    raise Refusal("ACTOR_EXISTS", "This actor ID is already registered")
                db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", (actor_id, kind, name))
                self._advance_commit_seq(db)
                db.commit()
            except sqlite3.Error as error:
                if isinstance(error, sqlite3.OperationalError) and ("locked" in str(error).lower() or "busy" in str(error).lower()):
                    raise StoreOpenError("DATABASE_BUSY", "The selected instance is busy; nothing was registered", retryable=True) from error
                raise StoreError("The registration could not be confirmed") from error
            finally:
                if db.in_transaction:
                    db.rollback()
                db.close()
        return {"instance_id": self.instance_id, "actor": {"id": actor_id, "kind": kind, "name": name, "enabled": True}}

    def _check_instance(self, db):
        row = db.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()
        if row is None or row[0] != self.instance_id:
            raise Refusal("INSTANCE_MISMATCH", "The selected instance does not match")
        metadata = dict(db.execute("SELECT key,value FROM metadata WHERE key IN ('schema_version','commit_seq','commit_id','authority_id','authority_path','authority_epoch')"))
        sequence = metadata.get("commit_seq", "")
        commit_id = metadata.get("commit_id", "")
        stored = metadata.get("schema_version")
        if stored != SCHEMA_VERSION:
            from .migrations import upgradable
            # Migrate is the remedy only when this code can move the database
            # up to its own version; a well-formed later version means this
            # code is the one out of date, and anything else is damage.
            if upgradable(stored):
                raise Refusal("SCHEMA_MISMATCH", "This database is at schema version %s and this code reads version %s; "
                              "move it with bin/aim-next-admin migrate. Nothing was changed" % (stored, SCHEMA_VERSION))
            if (isinstance(stored, str) and stored.isascii() and stored.isdigit() and stored[0] != "0"
                    and len(stored) <= 9 and int(stored) > int(SCHEMA_VERSION)):
                raise Refusal("SCHEMA_MISMATCH", "This database is at schema version %s, which this code (version %s) cannot "
                              "read or migrate; run code that reads version %s. Nothing was changed" % (stored, SCHEMA_VERSION, stored))
            raise Refusal("SCHEMA_MISMATCH", "This database schema is unsupported; no automatic migration was attempted")
        if (not sequence.isascii() or not sequence.isdigit()
                or len(sequence) > 19 or int(sequence) >= 9223372036854775807
                or len(commit_id) != 32 or any(c not in "0123456789abcdef" for c in commit_id)):
            raise Refusal("SCHEMA_MISMATCH", "This database schema is unsupported; no automatic migration was attempted")
        if any(metadata.get(key) != value for key, value in self.binding.items()):
            raise AuthorityError("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")

    @staticmethod
    def _advance_commit_seq(db):
        changed = db.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='commit_seq'").rowcount
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
                result, affected = (effect if effect is not None else handler)(db, actor, envelope)
                receipt = self._receipt(envelope, "committed", True, result, affected)
            except Refusal as exc:
                db.execute("ROLLBACK TO effect")
                if not exc.recorded:
                    raise
                receipt = self._refusal(envelope, exc, recorded=True)
            db.execute("RELEASE effect")
            db.execute("INSERT INTO operations VALUES (?,?,?,?,?)", (actor, op_id, fingerprint, kind, _json(receipt)))
            self._advance_commit_seq(db)
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
            self._actor(db, actor)
            if view_name == "capabilities":
                return {"instance_id": self.instance_id, "limits": dict(LIMITS), "runtime": runtime,
                        "authority": self._authority.facts(fence.record), "runner": self._runner_facts(db)}
            if view_name == "operation":
                op_id = _identifier(args.get("operation_id"), "operation_id")
                row = db.execute("SELECT outcome FROM operations WHERE actor_id=? AND id=?", (actor, op_id)).fetchone()
                return json.loads(row[0]) if row else {"instance_id": self.instance_id, "operation_id": op_id,
                                                     "status": "unknown", "recorded": False}
            handler = getattr(self, "_view_" + view_name, None)
            if handler is None:
                raise Refusal("UNKNOWN_VIEW", "Unsupported view")
            return handler(db, actor, args)
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

    def _workspace(self, db, actor, workspace_id, owner=False):
        _identifier(workspace_id, "workspace_id")
        row = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        allowed = row and (row["owner_id"] == actor or (not owner and db.execute(
            "SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace_id, actor)).fetchone()))
        if not allowed:
            raise Refusal("FORBIDDEN", "No permission for this workspace")
        return row

    def _change(self, db, scope_kind, scope_id, kind, record_id, version):
        db.execute("INSERT INTO changes(scope_kind,scope_id,resource_kind,resource_id,version) VALUES (?,?,?,?,?)",
                   (scope_kind, scope_id, kind, record_id, version))

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
        self._change(db, "workspace", workspace_id, "workspace", workspace_id, 1)
        return {"workspace": {"id": workspace_id, "owner_id": actor, "title": title, "version": 1}}, [
            {"kind": "workspace", "id": workspace_id, "version": 1}]

    def _view_workspace(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        return {"instance_id": self.instance_id, "workspace": dict(workspace), "relevant_versions": {"workspace": workspace["version"]}}

    def _view_workspaces(self, db, actor, args):
        limit = _page_size(args)
        # Creation always includes the owner in this indexed membership set.
        # BLOB substr bounds bytes, including titles containing embedded NUL.
        rows = db.execute("SELECT w.id,w.owner_id,substr(CAST(w.title AS BLOB),1,1025) AS title_prefix,w.version "
                          "FROM workspace_members AS m JOIN workspaces AS w ON w.id=m.workspace_id "
                          "WHERE m.actor_id=? AND m.workspace_id>? ORDER BY m.workspace_id LIMIT ?",
                          (actor, args.get("cursor", ""), limit + 1)).fetchall()

        totals = {}
        for unread, addressed, workspace_id in self._unread(db, actor, workspaces=[row["id"] for row in rows[:limit]]).values():
            total = totals.setdefault(workspace_id, [0, 0])
            total[0] += unread
            total[1] += addressed

        def item(row):
            title, truncated = _prefix(row["title_prefix"])
            unread, addressed = totals.get(row["id"], (0, 0))
            return {"id": row["id"], "owner_id": row["owner_id"], "title": title,
                    "title_truncated": truncated, "version": row["version"],
                    "unread": unread, "addressed": addressed}
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, item, "id")

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
        rows = db.execute("SELECT m.actor_id,a.kind,substr(CAST(a.name AS BLOB),1,1025) AS name_prefix "
                          "FROM workspace_members AS m JOIN actors AS a ON a.id=m.actor_id "
                          "WHERE m.workspace_id=? AND m.actor_id>? ORDER BY m.actor_id LIMIT ?",
                          (workspace["id"], args.get("cursor", ""), limit + 1)).fetchall()

        def item(row):
            name, truncated = _prefix(row["name_prefix"])
            return {"actor_id": row["actor_id"], "kind": row["kind"], "name": name, "name_truncated": truncated}
        return _bounded_page({"instance_id": self.instance_id, "relevant_versions": {"workspace": workspace["version"]}},
                             rows, limit, item, "actor_id")

    def _command_workspace_member_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"actor_id", "present"} or not isinstance(args["present"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one workspace, one actor and whether they are present")
        workspace = self._workspace(db, actor, target["workspace_id"], owner=True)
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
            # A topic they can no longer read stops waiting on them; touching it advances the outcome too.
            for topic in self._unwait(db, member, "workspace_id", workspace["id"]):
                self._change(db, "actor", member, "waiting", topic["id"], self._touch_topic(db, topic))
        # A removed coordinator no longer coordinates; the workspace names nobody.
        coordinator = None if not present and member == workspace["coordinator_id"] else workspace["coordinator_id"]
        db.execute("UPDATE workspaces SET version=version+1,coordinator_id=? WHERE id=?", (coordinator, workspace["id"]))
        version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace["id"],)).fetchone()[0]
        self._change(db, "workspace", workspace["id"], "workspace", workspace["id"], version)
        self._change(db, "actor", member, "workspace", workspace["id"], version)
        return dict(result, version=version), [{"kind": "workspace", "id": workspace["id"], "version": version}]

    def _view_workspace_topics(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        limit = args.get("limit", LIMITS["page_default"])
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMITS["page_max"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid page size")
        # latest_seq orders topics by activity; it is the sequence of the
        # topic's newest message, read through its one-row summary.
        archived = args.get("archived", False)
        if not isinstance(archived, bool):
            raise Refusal("INVALID_ARGUMENT", "Archived is true or false")
        # A page lists either the outcome's topics or its archived ones, each in id order.
        rows = db.execute("SELECT t.*,s.message_count,m.seq AS latest_seq FROM topics t INDEXED BY workspace_listed_topics "
                          "LEFT JOIN topic_summaries s ON s.topic_id=t.id LEFT JOIN messages m ON m.id=s.latest_message_id "
                          "WHERE t.workspace_id=? AND t.archived=? AND t.id>? ORDER BY t.id LIMIT ?",
                          (workspace["id"], int(archived), args.get("cursor", ""), limit + 1)).fetchall()
        items = [dict(row) for row in rows[:limit]]
        counts = self._unread(db, actor, topics=[item["id"] for item in items])
        waiting = self._waiting_by_topic(db, [item["id"] for item in items])
        for item in items:
            item["unread"], item["addressed"] = counts.get(item["id"], (0, 0, None))[:2]
            item["archived"] = bool(item["archived"])
            item["waiting_on"] = waiting[item["id"]]
        return {"instance_id": self.instance_id, "items": items,
                "next_cursor": items[-1]["id"] if len(rows) > limit else None,
                "relevant_versions": {"workspace": workspace["version"]}}

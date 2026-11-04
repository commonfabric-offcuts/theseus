from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid
from typing import Any


from .contract import LIMITS, Refusal, StoreError, _json, _identifier, _body
from .drafts import Drafts, DRAFT_SCHEMA
from .conversation import Conversation, CONVERSATION_SCHEMA
from .validation import COMMANDS, _command_envelope, _view_arguments
from .authority import Authority, AuthorityError, prepare_authority, publish_initial
from .delivery import Delivery, DELIVERY_SCHEMA


SCHEMA_VERSION = "3"


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
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA synchronous=EXTRA")
    db.execute("PRAGMA fullfsync=ON")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=250")
    actual = {key: db.execute("PRAGMA " + key).fetchone()[0] for key in (
        "journal_mode", "synchronous", "fullfsync", "foreign_keys", "busy_timeout")}
    if actual != {"journal_mode": "delete", "synchronous": 3, "fullfsync": 1,
                  "foreign_keys": 1, "busy_timeout": 250}:
        db.close()
        raise StoreError("The selected durability settings are not active")
    return db, actual


def initialize(db_path, instance_id, initial_actors, *, authority_path):
    """Create a new isolated authority. Existing paths are never overwritten."""
    _identifier(instance_id, "instance_id")
    path = Path(db_path).absolute()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    binding, anchor = prepare_authority(authority_path, path, instance_id)
    db = None
    try:
        db, _ = _connect(path)
        db.execute("BEGIN IMMEDIATE")
        for statement in SCHEMA + DRAFT_SCHEMA + DELIVERY_SCHEMA + CONVERSATION_SCHEMA:
            db.execute(statement)
        db.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance_id,))
        db.execute("INSERT INTO metadata VALUES ('schema_version',?)", (SCHEMA_VERSION,))
        db.execute("INSERT INTO metadata VALUES ('commit_seq','0')")
        db.executemany("INSERT INTO metadata VALUES (?,?)", list(binding.items()))
        for actor in initial_actors:
            actor_id = _identifier(actor["id"], "actor_id")
            kind = actor.get("kind", "agent")
            if kind not in ("human", "agent"):
                raise StoreError("Actor kind must be human or agent")
            db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)",
                       (actor_id, kind, actor.get("name", actor_id)))
        db.commit()
    except BaseException:
        if db is not None:
            db.rollback()
        # Keep a failed initialization distinct from a usable instance; callers
        # inspect/remove their own failed path rather than silently reusing it.
        raise
    finally:
        if db is not None:
            db.close()
    publish_initial(binding, anchor)
    return {"instance_id": instance_id, "db_path": str(path.resolve()), "binding": binding}


class Store(Drafts, Delivery, Conversation):
    def __init__(self, db_path, expected_instance_id, *, expected_binding):
        self.path = Path(db_path).resolve()
        self.instance_id = _identifier(expected_instance_id, "instance_id")
        self._authority = Authority(self.path, self.instance_id, expected_binding)
        try:
            with self._authority.shared():
                db, _ = _connect(self.path)
                try:
                    self._check_instance(db)
                finally:
                    db.close()
        except (sqlite3.Error, Refusal) as exc:
            raise StoreError("Cannot open the selected AIM Next instance") from exc

    @property
    def binding(self):
        return dict(self._authority.binding)

    def runner_guard(self, runner_id):
        return self._authority.runner_guard(runner_id)

    def _check_instance(self, db):
        row = db.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()
        if row is None or row[0] != self.instance_id:
            raise Refusal("INSTANCE_MISMATCH", "The selected instance does not match")
        metadata = dict(db.execute("SELECT key,value FROM metadata WHERE key IN ('schema_version','commit_seq','authority_id','authority_path','authority_epoch')"))
        sequence = metadata.get("commit_seq", "")
        if (metadata.get("schema_version") != SCHEMA_VERSION or not sequence.isascii() or not sequence.isdigit()
                or len(sequence) > 19 or int(sequence) >= 9223372036854775807):
            raise Refusal("SCHEMA_MISMATCH", "This database schema is unsupported; no automatic migration was attempted")
        if any(metadata.get(key) != value for key, value in self.binding.items()):
            raise Refusal("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")

    def _advance_commit_seq(self, db):
        changed = db.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='commit_seq'").rowcount
        if changed != 1:
            raise StoreError("The durable commit sequence is unavailable")

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
            db.execute("BEGIN IMMEDIATE")
            self._check_instance(db)
            self._actor(db, actor)
            previous = db.execute("SELECT fingerprint,outcome FROM operations WHERE actor_id=? AND id=?",
                                  (actor, op_id)).fetchone()
            if previous is not None:
                if previous["fingerprint"] != fingerprint:
                    raise Refusal("OPERATION_PAYLOAD_MISMATCH", "This operation already names different content")
                db.rollback()
                return json.loads(previous["outcome"])
            self._check_send_reservation(db, actor, envelope)
            db.execute("SAVEPOINT effect")
            try:
                handler = getattr(self, COMMANDS[kind]) if kind in COMMANDS else None
                if handler is None:
                    raise Refusal("UNKNOWN_COMMAND", "Unsupported command kind")
                result, affected = handler(db, actor, envelope)
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
            self._check_instance(db)
            self._actor(db, actor)
            if view_name == "capabilities":
                return {"instance_id": self.instance_id, "limits": dict(LIMITS), "runtime": runtime,
                        "authority": self._authority.facts(fence.record)}
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

    def _view_workspace_topics(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        limit = args.get("limit", LIMITS["page_default"])
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMITS["page_max"]:
            raise Refusal("INVALID_ARGUMENT", "Invalid page size")
        rows = db.execute("SELECT * FROM topics WHERE workspace_id=? AND id>? ORDER BY id LIMIT ?",
                          (workspace["id"], args.get("cursor", ""), limit + 1)).fetchall()
        items = [dict(row) for row in rows[:limit]]
        return {"instance_id": self.instance_id, "items": items,
                "next_cursor": items[-1]["id"] if len(rows) > limit else None,
                "relevant_versions": {"workspace": workspace["version"]}}

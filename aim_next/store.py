from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid
from typing import Any


LIMITS = {
    "body_utf8_bytes": 1048576,
    "recipients": 32,
    "topic_participants": 32,
    "page_default": 50,
    "page_max": 100,
    "summary_utf8_bytes": 131072,
    "http_envelope_bytes": 2097152,
    "image_bytes": 16777216,
    "attachment_count": 8,
    "attachment_bytes": 67108864,
}


class StoreError(Exception):
    """An unusable store or a non-business storage failure."""


class Refusal(Exception):
    def __init__(self, code, message, current_versions=None):
        self.code = code
        self.message = message
        self.current_versions = current_versions
        super().__init__(message)


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


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _identifier(value, name="identifier"):
    if not isinstance(value, str) or not value or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise Refusal("INVALID_ARGUMENT", "Invalid %s" % name)
    return value


def _body(value):
    if not isinstance(value, str):
        raise Refusal("INVALID_ARGUMENT", "Text must be a string")
    if len(value.encode("utf-8")) > LIMITS["body_utf8_bytes"]:
        raise Refusal("BODY_TOO_LARGE", "Writing exceeds the body limit; it has not been truncated")
    return value


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


def initialize(db_path, instance_id, initial_actors):
    """Create a new isolated authority. Existing paths are never overwritten."""
    _identifier(instance_id, "instance_id")
    path = Path(db_path).absolute()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = None
    try:
        db, _ = _connect(path)
        db.execute("BEGIN IMMEDIATE")
        for statement in SCHEMA:
            db.execute(statement)
        db.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance_id,))
        db.execute("INSERT INTO metadata VALUES ('schema_version','1')")
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
    return {"instance_id": instance_id, "db_path": str(path)}


class Store:
    def __init__(self, db_path, expected_instance_id):
        self.path = Path(db_path).absolute()
        self.instance_id = _identifier(expected_instance_id, "instance_id")
        try:
            db, _ = _connect(self.path)
            try:
                self._check_instance(db)
            finally:
                db.close()
        except (sqlite3.Error, Refusal) as exc:
            raise StoreError("Cannot open the selected AIM Next instance") from exc

    def _check_instance(self, db):
        row = db.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()
        if row is None or row[0] != self.instance_id:
            raise Refusal("INSTANCE_MISMATCH", "The selected instance does not match")

    def _actor(self, db, actor):
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
        try:
            if envelope.get("instance_id") != self.instance_id:
                raise Refusal("INSTANCE_MISMATCH", "Command belongs to another instance")
            if envelope.get("v") != 1:
                raise Refusal("INVALID_ARGUMENT", "Unsupported command version")
            op_id = _identifier(envelope.get("operation_id"), "operation_id")
            kind = _identifier(envelope.get("kind"), "kind")
            for key in ("target", "expected", "args"):
                if not isinstance(envelope.get(key, {}), dict):
                    raise Refusal("INVALID_ARGUMENT", "%s must be an object" % key)
            fingerprint = hashlib.sha256(_json(envelope).encode("utf-8")).hexdigest()
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
            db.execute("SAVEPOINT effect")
            try:
                handler = getattr(self, "_command_" + kind.replace(".", "_"), None)
                if handler is None:
                    raise Refusal("UNKNOWN_COMMAND", "Unsupported command kind")
                result, affected = handler(db, actor, envelope)
                receipt = self._receipt(envelope, "committed", True, result, affected)
            except (Refusal, sqlite3.IntegrityError) as exc:
                db.execute("ROLLBACK TO effect")
                if not isinstance(exc, Refusal):
                    exc = Refusal("RECORD_CONFLICT", "The requested record conflicts with existing state")
                receipt = self._refusal(envelope, exc, recorded=True)
            db.execute("RELEASE effect")
            db.execute("INSERT INTO operations VALUES (?,?,?,?,?)", (actor, op_id, fingerprint, kind, _json(receipt)))
            db.commit()
            return receipt
        except Refusal as exc:
            return self._refusal(envelope, exc)
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                return self._receipt(envelope, "retryable", False, error={
                    "code": "DATABASE_BUSY", "message": "The same operation remains pending; retry it unchanged", "retryable": True})
            raise StoreError("Storage operation could not be completed") from exc
        finally:
            if db is not None:
                if db.in_transaction:
                    db.rollback()
                db.close()

    def view(self, actor, view_name, args):
        db = None
        try:
            db, runtime = _connect(self.path)
            db.execute("BEGIN")
            self._check_instance(db)
            self._actor(db, actor)
            if view_name == "capabilities":
                return {"instance_id": self.instance_id, "limits": dict(LIMITS), "runtime": runtime}
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
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                return {"instance_id": self.instance_id, "error": {"code": "DATABASE_BUSY", "message": "Read is temporarily unavailable", "retryable": True}}
            raise StoreError("Storage view could not be read") from exc
        finally:
            if db is not None:
                if db.in_transaction:
                    db.rollback()
                db.close()

    def _workspace(self, db, actor, workspace_id, owner=False):
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
        title = _body(args.get("title", ""))
        if not title.strip():
            raise Refusal("INVALID_ARGUMENT", "A workspace needs a title")
        team = args.get("team", [])
        if not isinstance(team, list) or len(team) > LIMITS["topic_participants"]:
            raise Refusal("INVALID_ARGUMENT", "Choose a bounded workspace team")
        team = list(dict.fromkeys([actor] + team))
        for member in team:
            try:
                self._actor(db, _identifier(member))
            except Refusal:
                raise Refusal("INVALID_RECIPIENT", "Every team member needs an instance binding")
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

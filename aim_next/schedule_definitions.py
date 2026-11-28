from __future__ import annotations

from datetime import datetime, timezone
import json
import re

from . import message_edit, removal
from .contract import Refusal, _identifier, _json, _revision
from .delivery import _now_ms


SCHEDULE_UP = [
    "CREATE TABLE schedule_definitions (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES actors(id))",
    "CREATE TABLE schedule_revisions (schedule_id TEXT NOT NULL REFERENCES schedule_definitions(id), "
    "revision INTEGER NOT NULL CHECK(revision>0), registered_ms INTEGER NOT NULL, due_ms INTEGER NOT NULL, "
    "definition TEXT NOT NULL, PRIMARY KEY(schedule_id,revision))",
    "CREATE TABLE schedule_runs (id TEXT PRIMARY KEY NOT NULL, schedule_id TEXT NOT NULL, "
    "schedule_revision INTEGER NOT NULL, logical_slot TEXT NOT NULL, UNIQUE(schedule_id,logical_slot), "
    "FOREIGN KEY(schedule_id,schedule_revision) REFERENCES schedule_revisions(schedule_id,revision))",
    "CREATE TRIGGER keep_schedule_revision_update BEFORE UPDATE ON schedule_revisions "
    "BEGIN SELECT RAISE(ABORT,'immutable schedule revision'); END",
    "CREATE TRIGGER keep_schedule_revision_delete BEFORE DELETE ON schedule_revisions "
    "BEGIN SELECT RAISE(ABORT,'immutable schedule revision'); END",
]
SCHEDULE_DOWN = ["DROP TABLE schedule_runs", "DROP TABLE schedule_revisions", "DROP TABLE schedule_definitions"]
SCHEDULE_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM schedule_definitions) OR "
                     "EXISTS (SELECT 1 FROM schedule_revisions) OR EXISTS (SELECT 1 FROM schedule_runs)")

_FIELDS = {"active", "timing", "agent_id", "source_ref", "prompt_ref", "config_ref", "reply_target"}
_TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
                        r"(?:\.[0-9]{1,3})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _one_time_due(timing):
    if isinstance(timing, dict) and set(timing) == {"kind", "at"} and timing["kind"] == "once":
        timestamp = timing["at"]
        if isinstance(timestamp, str) and _TIMESTAMP.fullmatch(timestamp) and not timestamp.endswith("-00:00"):
            try:
                moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
                delta = moment - _EPOCH
                return (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000
            except (ValueError, OverflowError):
                pass
    raise Refusal("INVALID_ARGUMENT", "Use a one-time timestamp with seconds and a known UTC offset")


def _exact_revision(value):
    return type(value) is int and 1 <= value <= 9223372036854775807


class ScheduleDefinitions:
    def _schedule_owner(self, db, actor, schedule_id, creating=False):
        row = db.execute("SELECT owner_id FROM schedule_definitions WHERE id=?", (schedule_id,)).fetchone()
        if (not row and not creating) or (row and row["owner_id"] != actor):
            raise Refusal("FORBIDDEN", "No readable schedule definition")
        return row

    def _schedule_source(self, db, readers, ref, now):
        if (not isinstance(ref, dict) or set(ref) != {"kind", "id", "revision"}
                or ref["kind"] not in ("message", "memory") or not _exact_revision(ref["revision"])):
            raise Refusal("INVALID_ARGUMENT", "Use an exact message or Notebook revision")
        if ref["kind"] == "memory":
            for reader in readers:
                item = self._memory_ref(db, reader, ref)
            if db.execute("SELECT draft FROM memory_revisions WHERE item_id=? AND revision=?",
                          (item["id"], item["current_revision"])).fetchone()[0]:
                raise Refusal("FORBIDDEN", "No readable Notebook revision")
            return None

        for reader in readers:
            message = self._message_access(db, reader, ref["id"])
        if removal.value(db, message["id"]):
            raise Refusal("FORBIDDEN", "No readable source")
        if message_edit.is_held(db, message["id"], now):
            raise message_edit.held_refusal(message["id"])
        if ref["revision"] != 1 and not db.execute(
                "SELECT 1 FROM message_revisions WHERE message_id=? AND revision=?",
                (message["id"], ref["revision"])).fetchone():
            raise Refusal("FORBIDDEN", "No readable message revision")
        return message

    def _schedule_reach(self, db, actor, definition, now):
        agent = self._actor(db, definition["agent_id"])
        if agent["kind"] != "agent":
            raise Refusal("INVALID_ARGUMENT", "Choose an enabled agent for this definition")
        readers = tuple(dict.fromkeys((actor, agent["id"])))
        for field in ("source_ref", "prompt_ref", "config_ref"):
            self._schedule_source(db, readers, definition[field], now)

        target = definition["reply_target"]
        if not isinstance(target, dict) or set(target) != {"topic_id", "message_ref"}:
            raise Refusal("INVALID_ARGUMENT", "Name the reply topic and its exact message or null")
        for reader in readers:
            self._topic(db, reader, target["topic_id"])
        if target["message_ref"] is not None:
            parent = self._schedule_source(db, readers, target["message_ref"], now)
            if parent is None or parent["topic_id"] != target["topic_id"]:
                raise Refusal("INVALID_REPLY", "The reply message must belong to the destination topic")

    def _command_schedule_save(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"schedule_id"} or set(args) != _FIELDS or args["active"] is not False:
            raise Refusal("INVALID_ARGUMENT", "Name one schedule and supply its inactive definition")
        schedule_id = _identifier(target["schedule_id"], "schedule_id")
        existing = self._schedule_owner(db, actor, schedule_id, creating=True)
        current = db.execute("SELECT coalesce(max(revision),0) FROM schedule_revisions WHERE schedule_id=?",
                             (schedule_id,)).fetchone()[0]
        _revision(envelope["expected"], "schedule_revision", current)
        due = _one_time_due(args["timing"])
        now = _now_ms()
        self._schedule_reach(db, actor, args, now)
        if not existing:
            db.execute("INSERT INTO schedule_definitions (id,owner_id) VALUES (?,?)", (schedule_id, actor))
        revision = current + 1
        db.execute("INSERT INTO schedule_revisions (schedule_id,revision,registered_ms,due_ms,definition) VALUES (?,?,?,?,?)",
                   (schedule_id, revision, now, due, _json(args)))
        return {"schedule_id": schedule_id, "schedule_revision": revision, "due_ms": due}, [
            {"kind": "schedule", "id": schedule_id, "version": revision}]

    def _view_schedule_definition(self, db, actor, args):
        schedule_id = _identifier(args.get("schedule_id"), "schedule_id")
        self._schedule_owner(db, actor, schedule_id)
        revision = args.get("schedule_revision")
        if "schedule_revision" in args and not _exact_revision(revision):
            raise Refusal("INVALID_ARGUMENT", "Choose an exact positive schedule revision")
        if revision is None:
            row = db.execute("SELECT * FROM schedule_revisions WHERE schedule_id=? ORDER BY revision DESC LIMIT 1",
                             (schedule_id,)).fetchone()
        else:
            row = db.execute("SELECT * FROM schedule_revisions WHERE schedule_id=? AND revision=?",
                             (schedule_id, revision)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No readable schedule definition")
        definition = json.loads(row["definition"])
        self._schedule_reach(db, actor, definition, _now_ms())
        return dict(definition, schedule_id=schedule_id, schedule_revision=row["revision"],
                    registered_ms=row["registered_ms"], due_ms=row["due_ms"])

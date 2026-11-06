from __future__ import annotations

import json

from .contract import LIMITS, Refusal, _body, _bounded_page, _identifier, _page_size, _prefix, _json, _revision
from .sources import NAMED, seen_topics
from . import whispers


OPENING_SCHEMA = [
    "CREATE TABLE openings (id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), topic_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open','published','discarded')), payload TEXT NOT NULL, publish_operation_id TEXT, message_id TEXT REFERENCES messages(id), PRIMARY KEY(actor_id,id))",
    "CREATE INDEX open_openings ON openings(actor_id,workspace_id,id) WHERE state='open'",
]
SAVED_FIELDS = {"workspace_id", "topic_id", "title", "participants", "body", "attachments"}
# The message a new topic answers: named on the first save, kept by every later one.
SOURCE_FIELD = "source_message_id"


def _opening_id(envelope):
    if set(envelope["target"]) != {"opening_id"}:
        raise Refusal("INVALID_ARGUMENT", "Name exactly one opening")
    return _identifier(envelope["target"]["opening_id"], "opening_id")


class Openings:
    """Private topic openings: saved whole, published once, never merged."""

    def _topic_unused(self, db, topic_id):
        if (db.execute("SELECT 1 FROM topics WHERE id=?", (topic_id,)).fetchone()
                or db.execute("SELECT 1 FROM openings WHERE topic_id=?", (topic_id,)).fetchone()):
            raise Refusal("REVISION_CONFLICT", "This topic identity is already in use")

    def _open_opening(self, db, actor, envelope, args=None):
        # Publish and discard act on the saved revision; they carry no writing.
        # A publish may name the topics its author has seen (args, checked by the caller).
        opening_id = _opening_id(envelope)
        if envelope["args"] != (args or {}):
            raise Refusal("INVALID_ARGUMENT", "The saved revision is the content; supply no writing")
        row = db.execute("SELECT * FROM openings WHERE actor_id=? AND id=?", (actor, opening_id)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No private opening for this actor")
        if row["state"] != "open":
            raise Refusal("OPENING_CLOSED", "This opening was already %s" % row["state"])
        _revision(envelope["expected"], "opening_revision", row["revision"])
        return row

    def _close_opening(self, db, actor, row, state, operation_id=None, message_id=None):
        revision = row["revision"] + 1
        db.execute("UPDATE openings SET revision=?,state=?,publish_operation_id=?,message_id=? WHERE actor_id=? AND id=?",
                   (revision, state, operation_id, message_id, actor, row["id"]))
        self._change(db, "actor", actor, "opening", row["id"], revision)
        return revision

    def _command_opening_save(self, db, actor, envelope):
        opening_id, args = _opening_id(envelope), envelope["args"]
        # A topic's first message is never a whisper: nobody else would see the topic begin.
        if "whisper" in args:
            whispers.refuse_opening(args)
        if set(args) - {SOURCE_FIELD} != SAVED_FIELDS:
            raise Refusal("INVALID_ARGUMENT", "A save carries the whole writing, and optionally the message it answers, and nothing else")
        workspace_id = _identifier(args["workspace_id"], "workspace_id")
        topic_id = _identifier(args["topic_id"], "topic_id")
        row = db.execute("SELECT * FROM openings WHERE actor_id=? AND id=?", (actor, opening_id)).fetchone()
        if row is not None and row["state"] != "open":
            raise Refusal("OPENING_CLOSED", "This opening was already %s" % row["state"])
        if row is not None and (row["workspace_id"], row["topic_id"]) != (workspace_id, topic_id):
            raise Refusal("INVALID_ARGUMENT", "An opening keeps its workspace and topic")
        kept = json.loads(row["payload"]).get(SOURCE_FIELD) if row else None
        if row is not None and SOURCE_FIELD in args and args[SOURCE_FIELD] != kept:
            raise Refusal("INVALID_ARGUMENT", "An opening keeps the message it answers")
        revision = row["revision"] if row else 0
        _revision(envelope["expected"], "opening_revision", revision)
        if row is None:
            self._workspace(db, actor, workspace_id)
            self._topic_unused(db, topic_id)
            # Only a message the author can read can be answered.
            if args.get(SOURCE_FIELD) is not None:
                kept = self._source_message(db, actor, args[SOURCE_FIELD])
        participants = args["participants"]
        if not isinstance(participants, list):
            raise Refusal("INVALID_ARGUMENT", "Participants must be a list")
        if len(participants) > LIMITS["topic_participants"] - 1:
            raise Refusal("TOO_MANY_PARTICIPANTS", "Topic participant limit includes its creator")
        if len(self._recipients(db, participants, require_enabled=False)) != len(participants):
            raise Refusal("INVALID_ARGUMENT", "Name each participant once")
        payload = {"title": _body(args["title"]), "participants": participants, "body": _body(args["body"]),
                   "attachments": self._attachment_refs(db, actor, args["attachments"])}
        if kept is not None:
            payload[SOURCE_FIELD] = kept
        if row:
            db.execute("UPDATE openings SET revision=?,payload=? WHERE actor_id=? AND id=?",
                       (revision + 1, _json(payload), actor, opening_id))
        else:
            db.execute("INSERT INTO openings(id,actor_id,workspace_id,topic_id,revision,state,payload) VALUES (?,?,?,?,1,'open',?)",
                       (opening_id, actor, workspace_id, topic_id, _json(payload)))
        self._change(db, "actor", actor, "opening", opening_id, revision + 1)
        return {"opening_id": opening_id, "opening_revision": revision + 1, "state": "open"}, [
            {"kind": "opening", "id": opening_id, "version": revision + 1}]

    def _command_opening_publish(self, db, actor, envelope):
        seen = seen_topics(envelope["args"])
        row = self._open_opening(db, actor, envelope, envelope["args"])
        saved = json.loads(row["payload"])
        source = saved.get(SOURCE_FIELD)
        if seen and source is None:
            raise Refusal("INVALID_ARGUMENT", "Only an opening that answers a message names the topics seen from it")
        self._workspace(db, actor, row["workspace_id"])
        # The opening itself holds topic_id; only an existing topic collides.
        if db.execute("SELECT 1 FROM topics WHERE id=?", (row["topic_id"],)).fetchone():
            raise Refusal("REVISION_CONFLICT", "This topic identity is already in use")
        if source is not None:
            # One question, one topic: a topic already started from the same
            # message is one the author must have seen before starting another.
            self._source_message(db, actor, source)
            count, named = self._unseen_from_source(db, actor, source, seen)
            if count:
                raise Refusal("ALREADY_STARTED", "%s already started from this message: %s%s. Continue there, or publish again naming %s as seen" % (
                    "A topic was" if count == 1 else "%d topics were" % count, ", ".join(named),
                    " and %d more" % (count - len(named)) if count > NAMED else "", "it" if count == 1 else "them"))
        self._open_topic(db, actor, row["topic_id"], row["workspace_id"], saved["title"], saved["participants"],
                         Refusal("EMPTY_TITLE", "A topic needs a title"))
        if source is not None:
            db.execute("UPDATE topics SET source_message_id=? WHERE id=?", (source, row["topic_id"]))
        result, affected = self._publish(db, actor, envelope["operation_id"], row["topic_id"], {
            "body": saved["body"], "attachments": saved["attachments"], "quotes": [], "addressees": []})
        revision = self._close_opening(db, actor, row, "published", envelope["operation_id"], result["message_id"])
        return dict(result, opening_id=row["id"], opening_revision=revision), affected + [
            {"kind": "opening", "id": row["id"], "version": revision}]

    def _command_opening_discard(self, db, actor, envelope):
        row = self._open_opening(db, actor, envelope)
        revision = self._close_opening(db, actor, row, "discarded")
        return {"opening_id": row["id"], "opening_revision": revision, "state": "discarded"}, [
            {"kind": "opening", "id": row["id"], "version": revision}]

    def _view_opening(self, db, actor, args):
        opening_id = _identifier(args.get("opening_id"), "opening_id")
        row = db.execute("SELECT * FROM openings WHERE actor_id=? AND id=?", (actor, opening_id)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No private opening for this actor")
        receipt = row["publish_operation_id"] and db.execute(
            "SELECT outcome FROM operations WHERE actor_id=? AND id=?", (actor, row["publish_operation_id"])).fetchone()
        opening = dict({SOURCE_FIELD: None}, **json.loads(row["payload"]), **{key: row[key] for key in (
            "id", "workspace_id", "topic_id", "revision", "state", "publish_operation_id", "message_id")})
        return {"instance_id": self.instance_id, "opening": opening,
                "publish_receipt": json.loads(receipt[0]) if receipt else None}

    def _view_openings(self, db, actor, args):
        limit = _page_size(args)
        where, values = "actor_id=? AND state='open'", [actor]
        if "workspace_id" in args:
            self._workspace(db, actor, args["workspace_id"])
            where, values = where + " AND workspace_id=?", values + [args["workspace_id"]]
        # The title prefix is cut inside SQLite; whole bodies never reach Python.
        rows = db.execute("SELECT id,workspace_id,topic_id,revision,substr(CAST(json_extract(payload,'$.title') AS BLOB),1,1025) AS title_prefix "
                          "FROM openings INDEXED BY open_openings WHERE " + where + " AND id>? ORDER BY id LIMIT ?",
                          values + [args.get("cursor", ""), limit + 1]).fetchall()

        def item(row):
            title, truncated = _prefix(row["title_prefix"])
            return {"id": row["id"], "workspace_id": row["workspace_id"], "topic_id": row["topic_id"],
                    "revision": row["revision"], "title": title, "title_truncated": truncated}
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, item, "id")

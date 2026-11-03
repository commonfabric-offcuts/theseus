from __future__ import annotations

import json
import uuid

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _revision


DRAFT_SCHEMA = [
    "CREATE TABLE drafts (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, topic_id TEXT NOT NULL, revision INTEGER NOT NULL, generation TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(actor_id,source_key,topic_id))",
    "CREATE TABLE notes (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(actor_id,source_key))",
    "CREATE TABLE submissions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, topic_id TEXT NOT NULL, prepare_operation_id TEXT NOT NULL, send_operation_id TEXT NOT NULL, send_kind TEXT NOT NULL, metadata TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(actor_id,id), UNIQUE(actor_id,send_operation_id))",
    "CREATE INDEX actor_submissions ON submissions(actor_id,seq)",
    "CREATE INDEX editor_submissions ON submissions(actor_id,source_key,topic_id,seq)",
    "CREATE TRIGGER immutable_submissions_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'immutable submission'); END",
    "CREATE TRIGGER immutable_submissions_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT, 'immutable submission'); END",
]


def _source_key(ref):
    if not isinstance(ref, dict):
        raise Refusal("INVALID_ARGUMENT", "A source reference is required")
    return _json([_identifier(ref.get("kind")), _identifier(ref.get("id"))])


class Drafts:
    def _check_send_reservation(self, db, actor, envelope):
        row = db.execute("SELECT id,topic_id,send_kind FROM submissions WHERE actor_id=? AND send_operation_id=?",
                         (actor, envelope["operation_id"])).fetchone()
        if row and (envelope["kind"] != row["send_kind"] or
                    envelope.get("target", {}) != {"topic_id": row["topic_id"]} or
                    envelope.get("args", {}) != {"submission_id": row["id"]} or
                    envelope.get("expected", {}) != {}):
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "This operation is reserved for its exact prepared send")

    def _validate_source_ref(self, db, actor, ref):
        key = _source_key(ref)
        if ref["kind"] == "new_topic":
            self._workspace(db, actor, ref.get("workspace_id"))
        else:
            self._source(db, actor, ref)
        return key

    def _writing(self, args):
        result = {"body": _body(args.get("body", ""))}
        for name in ("attachments", "quotes", "addressees"):
            value = args.get(name, [])
            if not isinstance(value, list):
                raise Refusal("INVALID_ARGUMENT", "%s must be a list" % name)
            result[name] = value
        if len(result["attachments"]) > LIMITS["attachment_count"]:
            raise Refusal("TOO_MANY_ATTACHMENTS", "Attachment count exceeds the limit")
        if len(result["addressees"]) > LIMITS["recipients"]:
            raise Refusal("TOO_MANY_RECIPIENTS", "Explicit recipients exceed the limit")
        for recipient in result["addressees"]:
            _identifier(recipient, "addressee")
        result["addressees"] = list(dict.fromkeys(result["addressees"]))
        for name in ("reply_to", "exchange_id", "caret", "opening"):
            if name in args:
                result[name] = args[name]
        return result

    def _command_draft_save(self, db, actor, envelope):
        args, target = envelope.get("args", {}), envelope.get("target", {})
        draft_id = _identifier(target.get("draft_id"), "draft_id")
        ref = args.get("source_ref")
        source_key = self._validate_source_ref(db, actor, ref)
        topic_id = _identifier(args.get("topic_id"), "topic_id")
        if ref["kind"] != "new_topic":
            self._topic(db, actor, topic_id)
        generation = _identifier(args.get("generation"), "generation")
        row = db.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
        if row and row["actor_id"] != actor:
            raise Refusal("FORBIDDEN", "This draft belongs to another actor")
        revision = row["revision"] if row else 0
        _revision(envelope.get("expected", {}), "draft_revision", revision)
        if row and (row["source_key"] != source_key or row["topic_id"] != topic_id or
                    json.loads(row["payload"])["source_ref"] != ref or row["generation"] != generation):
            raise Refusal("REVISION_CONFLICT", "The draft source or generation has changed")
        payload = self._writing(args)
        payload["source_ref"] = ref
        if row:
            db.execute("UPDATE drafts SET revision=?,payload=? WHERE id=?", (revision + 1, _json(payload), draft_id))
        else:
            db.execute("INSERT INTO drafts VALUES (?,?,?,?,?,?,?)",
                       (draft_id, actor, source_key, topic_id, 1, generation, _json(payload)))
        self._change(db, "actor", actor, "draft", draft_id, revision + 1)
        return {"draft_id": draft_id, "draft_revision": revision + 1, "generation": generation}, [
            {"kind": "draft", "id": draft_id, "version": revision + 1}]

    def _command_note_save(self, db, actor, envelope):
        args = envelope.get("args", {})
        note_id = _identifier(envelope.get("target", {}).get("note_id"), "note_id")
        ref = args.get("source_ref")
        key = self._validate_source_ref(db, actor, ref)
        row = db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
        if row and row["actor_id"] != actor:
            raise Refusal("FORBIDDEN", "This note belongs to another actor")
        revision = row["revision"] if row else 0
        _revision(envelope.get("expected", {}), "note_revision", revision)
        if row and (row["source_key"] != key or json.loads(row["payload"])["source_ref"] != ref):
            raise Refusal("REVISION_CONFLICT", "An existing note retains its source revision")
        payload = {"source_ref": ref, "body": _body(args.get("body", "")), "caret": args.get("caret")}
        if row:
            db.execute("UPDATE notes SET revision=?,payload=? WHERE id=?", (revision + 1, _json(payload), note_id))
        else:
            db.execute("INSERT INTO notes VALUES (?,?,?,?,?)", (note_id, actor, key, 1, _json(payload)))
        self._change(db, "actor", actor, "note", note_id, revision + 1)
        return {"note_id": note_id, "note_revision": revision + 1}, [{"kind": "note", "id": note_id, "version": revision + 1}]

    def _command_submission_prepare(self, db, actor, envelope):
        args = envelope.get("args", {})
        row = db.execute("SELECT * FROM drafts WHERE id=? AND actor_id=?", (args.get("draft_id"), actor)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No private draft for this actor")
        _revision(envelope.get("expected", {}), "draft_revision", row["revision"])
        if envelope.get("target", {}).get("topic_id") != row["topic_id"]:
            raise Refusal("INVALID_ARGUMENT", "The prepared destination must match the saved draft")
        snapshot = json.loads(row["payload"])
        # The durable saved revision, never a late HTTP payload, is the source
        # of the frozen act. Callers may echo fields, but cannot override them.
        for name in ("body", "attachments", "quotes", "addressees", "reply_to", "exchange_id", "opening"):
            if name in args and args[name] != snapshot.get(name):
                raise Refusal("REVISION_CONFLICT", "Save this exact writing before preparing it")
        self._validate_source_ref(db, actor, snapshot["source_ref"])
        submission_id = _identifier(args.get("submission_id"), "submission_id")
        send_op = _identifier(args.get("send_operation_id"), "send_operation_id")
        if send_op == envelope["operation_id"] or db.execute(
                "SELECT 1 FROM operations WHERE actor_id=? AND id=?", (actor, send_op)).fetchone():
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "The future send needs an unused operation identity")
        snapshot.update(id=submission_id, topic_id=row["topic_id"], draft_id=row["id"],
                        draft_revision=row["revision"], draft_generation=row["generation"],
                        prepare_operation_id=envelope["operation_id"], send_operation_id=send_op)
        metadata = {k: snapshot[k] for k in ("id", "source_ref", "topic_id", "draft_id", "draft_revision", "draft_generation", "prepare_operation_id", "send_operation_id")}
        send_kind = "topic.create_and_send" if "opening" in snapshot else "message.send"
        db.execute("INSERT INTO submissions(id,actor_id,source_key,topic_id,prepare_operation_id,send_operation_id,send_kind,metadata,snapshot) VALUES (?,?,?,?,?,?,?,?,?)",
                   (submission_id, actor, row["source_key"], row["topic_id"], envelope["operation_id"], send_op, send_kind, _json(metadata), _json(snapshot)))
        generation = "g-" + uuid.uuid4().hex
        successor = {"source_ref": snapshot["source_ref"], "body": "", "attachments": [], "quotes": [], "addressees": []}
        db.execute("UPDATE drafts SET revision=?,generation=?,payload=? WHERE id=?",
                   (row["revision"] + 1, generation, _json(successor), row["id"]))
        self._change(db, "actor", actor, "draft", row["id"], row["revision"] + 1)
        self._change(db, "actor", actor, "submission", submission_id, 1)
        return {"submission_id": submission_id, "send_operation_id": send_op, "phase": "prepared",
                "draft_id": row["id"], "draft_revision": row["revision"],
                "next_draft": {"id": row["id"], "revision": row["revision"] + 1, "generation": generation}}, [
                    {"kind": "draft", "id": row["id"], "version": row["revision"] + 1},
                    {"kind": "submission", "id": submission_id, "version": 1}]

    def _submission(self, db, actor, submission_id):
        row = db.execute("SELECT * FROM submissions WHERE actor_id=? AND id=?", (actor, submission_id)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No private submission for this actor")
        return row, json.loads(row["snapshot"])

    def _view_submission(self, db, actor, args):
        row, snapshot = self._submission(db, actor, args.get("submission_id"))
        receipt = db.execute("SELECT outcome FROM operations WHERE actor_id=? AND id=?", (actor, row["send_operation_id"])).fetchone()
        return dict(snapshot, instance_id=self.instance_id, send_receipt=json.loads(receipt[0]) if receipt else None)

    def _view_submissions(self, db, actor, args):
        limit = _page_size(args)
        where, values = "s.actor_id=? AND s.seq>?", [actor, args.get("cursor", 0)]
        if "source_ref" in args:
            where += " AND s.source_key=? AND s.topic_id=?"
            values += [_source_key(args["source_ref"]), args.get("topic_id")]
        rows = db.execute("SELECT s.seq,s.metadata,o.outcome FROM submissions s LEFT JOIN operations o ON o.actor_id=s.actor_id AND o.id=s.send_operation_id WHERE " + where + " ORDER BY s.seq LIMIT ?", values + [limit + 1]).fetchall()
        items = []
        for row in rows[:limit]:
            item = json.loads(row["metadata"])
            item.update(send_status=json.loads(row["outcome"])["status"] if row["outcome"] else "unknown", snapshot_available=True)
            items.append(item)
        return {"instance_id": self.instance_id, "items": items, "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None}

    def _view_editor_state(self, db, actor, args):
        key = self._validate_source_ref(db, actor, args.get("source_ref"))
        row = db.execute("SELECT * FROM drafts WHERE actor_id=? AND source_key=? AND topic_id=?", (actor, key, args.get("topic_id"))).fetchone()
        draft = dict(json.loads(row["payload"]), id=row["id"], revision=row["revision"], generation=row["generation"]) if row else None
        row = db.execute("SELECT * FROM notes WHERE actor_id=? AND source_key=?", (actor, key)).fetchone()
        note = dict(json.loads(row["payload"]), id=row["id"], revision=row["revision"]) if row else None
        return {"instance_id": self.instance_id, "source_ref": args["source_ref"], "destination": {"topic_id": args.get("topic_id")},
                "draft": draft, "note": note, "reading_place": None, "submissions": self._view_submissions(db, actor, args), "limits": dict(LIMITS)}

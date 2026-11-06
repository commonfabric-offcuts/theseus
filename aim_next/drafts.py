from __future__ import annotations

import json
import uuid
from .authority import AuthorityError

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _revision
from .conversation import INTENT_REQUIRED


DRAFT_SCHEMA = [
    "CREATE TABLE drafts (id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, topic_id TEXT NOT NULL, revision INTEGER NOT NULL, generation TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(actor_id,id), UNIQUE(actor_id,source_key,topic_id))",
    "CREATE TABLE notes (id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(actor_id,id), UNIQUE(actor_id,source_key))",
    "CREATE TABLE submissions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), source_key TEXT NOT NULL, topic_id TEXT NOT NULL, prepare_operation_id TEXT NOT NULL, send_operation_id TEXT NOT NULL, send_kind TEXT NOT NULL, authority_id TEXT NOT NULL, authority_epoch TEXT NOT NULL, metadata TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(actor_id,id), UNIQUE(actor_id,send_operation_id))",
    "CREATE INDEX actor_submissions ON submissions(actor_id,seq)",
    "CREATE INDEX editor_submissions ON submissions(actor_id,source_key,topic_id,seq)",
    "CREATE TRIGGER immutable_submissions_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'immutable submission'); END",
    "CREATE TRIGGER immutable_submissions_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT, 'immutable submission'); END",
]


def _source_key(ref):
    if not isinstance(ref, dict):
        raise Refusal("INVALID_ARGUMENT", "A source reference is required")
    if ref.get("kind") == "topic" and set(ref) != {"kind", "id"}:
        raise Refusal("INVALID_ARGUMENT", "A topic composer reference contains only kind and id")
    return _json([_identifier(ref.get("kind")), _identifier(ref.get("id"))])


def _holds_writing(payload):
    return bool(payload.get("body") or payload.get("attachments") or payload.get("quotes") or payload.get("addressees") or
                any(payload.get(name) is not None for name in ("reply_to", "exchange_id", "opening")))


def _topic_composition(ref, topic_id):
    # This is a private editor identity, not a quotable content source.
    if ref["kind"] != "topic":
        return False
    if ref["id"] != _identifier(topic_id, "topic_id"):
        raise Refusal("INVALID_ARGUMENT", "The topic composer must keep its own destination")
    return True


class Drafts:
    def _check_send_reservation(self, db, actor, envelope):
        row = db.execute("SELECT id,topic_id,send_kind,send_operation_id,authority_id,authority_epoch FROM submissions WHERE actor_id=? AND send_operation_id=?",
                         (actor, envelope["operation_id"])).fetchone()
        if not row and envelope["kind"] in ("message.send", "topic.create_and_send"):
            submission_id = envelope.get("args", {}).get("submission_id")
            if isinstance(submission_id, str):
                row = db.execute("SELECT id,topic_id,send_kind,send_operation_id,authority_id,authority_epoch FROM submissions WHERE actor_id=? AND id=?", (actor, submission_id)).fetchone()
        if row and envelope["expected"]["authority"] != {"authority_id": row["authority_id"], "authority_epoch": row["authority_epoch"]}:
            raise AuthorityError("AUTHORITY_CHANGED", "This prepared act belongs to an earlier authority epoch; reconcile its original operation")
        if row and (envelope["operation_id"] != row["send_operation_id"] or envelope["kind"] != row["send_kind"] or
                    envelope.get("target", {}) != {"topic_id": row["topic_id"]} or
                    envelope.get("args", {}) != {"submission_id": row["id"]} or
                    set(envelope["expected"]) != {"authority"}):
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "This operation is reserved for its exact prepared send")

    def _validate_source_ref(self, db, actor, ref):
        key = _source_key(ref)
        if ref["kind"] == "new_topic":
            self._workspace(db, actor, ref.get("workspace_id"))
        elif ref["kind"] == "topic":
            self._topic(db, actor, ref["id"])
        elif ref["kind"] == "message":
            self._message_access(db, actor, ref.get("id"))
        else:
            self._source(db, actor, ref)
        return key

    def _keeps_source(self, db, actor, stored, ref):
        # Writing keeps the exact Notebook revision it was written against. A
        # slot with nothing in it, as a sent reply leaves its place, holds no
        # such claim: its next writing is about the revision the person reads.
        if stored["source_ref"] == ref:
            return True
        if stored["source_ref"].get("kind") != "memory" or ref.get("kind") != "memory" or _holds_writing(stored):
            return False
        self._validate_source_ref(db, actor, ref)
        return True

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
        for name in ("reply_to", "exchange_id", "caret", "opening", "intent"):
            if name in args:
                result[name] = args[name]
        # Whether a message to someone asks or tells; none means the sender has not said.
        if result.get("intent") not in (None, "ask", "tell"):
            raise Refusal("INVALID_ARGUMENT", "A message asks or tells")
        return result

    def _command_draft_save(self, db, actor, envelope):
        args, target = envelope.get("args", {}), envelope.get("target", {})
        draft_id = _identifier(target.get("draft_id"), "draft_id")
        ref = args.get("source_ref")
        source_key = _source_key(ref)
        topic_id = _identifier(args.get("topic_id"), "topic_id")
        topic_composition = _topic_composition(ref, topic_id)
        generation = _identifier(args.get("generation"), "generation")
        row = db.execute("SELECT * FROM drafts WHERE actor_id=? AND id=?", (actor, draft_id)).fetchone()
        if row is None:
            self._validate_source_ref(db, actor, ref)
            if ref["kind"] not in ("new_topic", "topic"):
                self._topic(db, actor, topic_id)
        revision = row["revision"] if row else 0
        _revision(envelope.get("expected", {}), "draft_revision", revision)
        if row is None:
            occupied = db.execute("SELECT revision FROM drafts WHERE actor_id=? AND source_key=? AND topic_id=?", (actor, source_key, topic_id)).fetchone()
            if occupied:
                raise Refusal("REVISION_CONFLICT", "This editor already has a draft; reopen its existing identity", {"draft_revision": occupied["revision"]})
        if row and (row["source_key"] != source_key or row["topic_id"] != topic_id or row["generation"] != generation or
                    not self._keeps_source(db, actor, json.loads(row["payload"]), ref)):
            raise Refusal("REVISION_CONFLICT", "The draft source or generation has changed")
        payload = self._writing(args)
        if topic_composition and (any(name in payload for name in ("opening", "reply_to", "exchange_id")) or payload["quotes"]):
            raise Refusal("INVALID_ARGUMENT", "A topic composer starts a source-free message")
        payload["attachments"] = self._attachment_refs(db, actor, payload["attachments"])
        payload["source_ref"] = ref
        if row:
            db.execute("UPDATE drafts SET revision=?,payload=? WHERE actor_id=? AND id=?", (revision + 1, _json(payload), actor, draft_id))
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
        key = _source_key(ref)
        if ref["kind"] == "topic":
            raise Refusal("INVALID_SOURCE", "A topic composer has no source for a private note")
        row = db.execute("SELECT * FROM notes WHERE actor_id=? AND id=?", (actor, note_id)).fetchone()
        if row is None:
            self._validate_source_ref(db, actor, ref)
        revision = row["revision"] if row else 0
        _revision(envelope.get("expected", {}), "note_revision", revision)
        if row is None:
            occupied = db.execute("SELECT revision FROM notes WHERE actor_id=? AND source_key=?", (actor, key)).fetchone()
            if occupied:
                raise Refusal("REVISION_CONFLICT", "This source already has a private note", {"note_revision": occupied["revision"]})
        if row and (row["source_key"] != key or not self._keeps_source(db, actor, json.loads(row["payload"]), ref)):
            raise Refusal("REVISION_CONFLICT", "An existing note retains its source revision")
        payload = {"source_ref": ref, "body": _body(args.get("body", "")), "caret": args.get("caret")}
        if row:
            db.execute("UPDATE notes SET revision=?,payload=? WHERE actor_id=? AND id=?", (revision + 1, _json(payload), actor, note_id))
        else:
            db.execute("INSERT INTO notes VALUES (?,?,?,?,?)", (note_id, actor, key, 1, _json(payload)))
        self._change(db, "actor", actor, "note", note_id, revision + 1)
        return {"note_id": note_id, "note_revision": revision + 1}, [{"kind": "note", "id": note_id, "version": revision + 1}]

    def _command_submission_prepare(self, db, actor, envelope):
        args = envelope.get("args", {})
        _identifier(args.get("draft_id"), "draft_id")
        row = db.execute("SELECT * FROM drafts WHERE id=? AND actor_id=?", (args.get("draft_id"), actor)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No private draft for this actor")
        _revision(envelope.get("expected", {}), "draft_revision", row["revision"])
        if envelope.get("target", {}).get("topic_id") != row["topic_id"]:
            raise Refusal("INVALID_ARGUMENT", "The prepared destination must match the saved draft")
        snapshot = json.loads(row["payload"])
        # The durable saved revision, never a late HTTP payload, is the source
        # of the frozen act. Callers may echo fields, but cannot override them.
        for name in ("body", "attachments", "quotes", "addressees", "reply_to", "exchange_id", "opening", "intent"):
            if name in args and args[name] != snapshot.get(name):
                raise Refusal("REVISION_CONFLICT", "Save this exact writing before preparing it")
        # A message to someone says whether it asks or tells. Refused here, the
        # writing stays in its draft to be corrected; frozen without it, it
        # could only be refused at its send.
        if snapshot.get("addressees") and snapshot.get("intent") is None:
            raise Refusal("INTENT_REQUIRED", INTENT_REQUIRED)
        snapshot["attachments"] = self._attachment_refs(db, actor, snapshot["attachments"], ready=True)
        submission_id = _identifier(args.get("submission_id"), "submission_id")
        send_op = _identifier(args.get("send_operation_id"), "send_operation_id")
        if db.execute("SELECT 1 FROM submissions WHERE actor_id=? AND id=?", (actor, submission_id)).fetchone():
            raise Refusal("REVISION_CONFLICT", "This submission identity already holds another frozen act")
        if send_op == envelope["operation_id"] or db.execute(
                "SELECT 1 FROM operations WHERE actor_id=? AND id=?", (actor, send_op)).fetchone() or db.execute(
                "SELECT 1 FROM submissions WHERE actor_id=? AND send_operation_id=?", (actor, send_op)).fetchone() or db.execute(
                "SELECT 1 FROM media_intents WHERE actor_id=? AND publish_operation_id=?", (actor, send_op)).fetchone():
            raise Refusal("SEND_ID_UNAVAILABLE", "The future send needs an unused operation identity", recorded=False)
        snapshot.update(id=submission_id, topic_id=row["topic_id"], draft_id=row["id"],
                        draft_revision=row["revision"], draft_generation=row["generation"],
                        prepare_operation_id=envelope["operation_id"], send_operation_id=send_op,
                        authority=dict(envelope["expected"]["authority"]))
        metadata = {k: snapshot[k] for k in ("id", "source_ref", "topic_id", "draft_id", "draft_revision", "draft_generation", "prepare_operation_id", "send_operation_id", "authority")}
        send_kind = "topic.create_and_send" if "opening" in snapshot else "message.send"
        db.execute("INSERT INTO submissions(id,actor_id,source_key,topic_id,prepare_operation_id,send_operation_id,send_kind,authority_id,authority_epoch,metadata,snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   (submission_id, actor, row["source_key"], row["topic_id"], envelope["operation_id"], send_op, send_kind,
                    snapshot["authority"]["authority_id"], snapshot["authority"]["authority_epoch"], _json(metadata), _json(snapshot)))
        generation = "g-" + uuid.uuid4().hex
        successor = {"source_ref": snapshot["source_ref"], "body": "", "attachments": [], "quotes": [], "addressees": []}
        db.execute("UPDATE drafts SET revision=?,generation=?,payload=? WHERE actor_id=? AND id=?",
                   (row["revision"] + 1, generation, _json(successor), actor, row["id"]))
        self._change(db, "actor", actor, "draft", row["id"], row["revision"] + 1)
        self._change(db, "actor", actor, "submission", submission_id, 1)
        return {"submission_id": submission_id, "send_operation_id": send_op, "phase": "prepared",
                "draft_id": row["id"], "draft_revision": row["revision"],
                "next_draft": {"id": row["id"], "revision": row["revision"] + 1, "generation": generation}}, [
                    {"kind": "draft", "id": row["id"], "version": row["revision"] + 1},
                    {"kind": "submission", "id": submission_id, "version": 1}]

    def _submission(self, db, actor, submission_id, unconfirmed=False):
        _identifier(submission_id, "submission_id")
        row = db.execute("SELECT * FROM submissions WHERE actor_id=? AND id=?", (actor, submission_id)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No private submission for this actor", recorded=not unconfirmed)
        return row, json.loads(row["snapshot"])

    def _view_submission(self, db, actor, args):
        row, snapshot = self._submission(db, actor, args.get("submission_id"))
        receipt = db.execute("SELECT outcome FROM operations WHERE actor_id=? AND id=?", (actor, row["send_operation_id"])).fetchone()
        return dict(snapshot, instance_id=self.instance_id, send_receipt=json.loads(receipt[0]) if receipt else None)

    def _view_submissions(self, db, actor, args):
        limit = _page_size(args)
        where, values = "s.actor_id=? AND s.seq>?", [actor, args.get("cursor", 0)]
        if "source_ref" in args:
            key = _source_key(args["source_ref"])
            _topic_composition(args["source_ref"], args.get("topic_id"))
            where += " AND s.source_key=? AND s.topic_id=?"
            values += [key, args.get("topic_id")]
        rows = db.execute("SELECT s.seq,s.metadata,o.outcome FROM submissions s LEFT JOIN operations o ON o.actor_id=s.actor_id AND o.id=s.send_operation_id WHERE " + where + " ORDER BY s.seq LIMIT ?", values + [limit + 1]).fetchall()
        items = []
        for row in rows[:limit]:
            item = json.loads(row["metadata"])
            item.update(send_status=json.loads(row["outcome"])["status"] if row["outcome"] else "unknown", snapshot_available=True)
            items.append(item)
        return {"instance_id": self.instance_id, "items": items, "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None}

    def _view_editor_state(self, db, actor, args):
        key = _source_key(args.get("source_ref"))
        topic_composition = _topic_composition(args["source_ref"], args.get("topic_id"))
        note_only = args["source_ref"]["kind"] != "new_topic" and args.get("topic_id") is None
        row = None if note_only else db.execute("SELECT * FROM drafts WHERE actor_id=? AND source_key=? AND topic_id=?", (actor, key, args.get("topic_id"))).fetchone()
        draft = dict(json.loads(row["payload"]), id=row["id"], revision=row["revision"], generation=row["generation"]) if row else None
        row = None if topic_composition else db.execute("SELECT * FROM notes WHERE actor_id=? AND source_key=?", (actor, key)).fetchone()
        note = dict(json.loads(row["payload"]), id=row["id"], revision=row["revision"]) if row else None
        source_available = True
        try:
            self._validate_source_ref(db, actor, args["source_ref"])
        except Refusal as exc:
            if exc.code != "FORBIDDEN" or (draft is None and note is None):
                raise
            source_available = False
        destination_available = source_available and not note_only
        if not note_only and args["source_ref"]["kind"] not in ("new_topic", "topic"):
            try:
                self._topic(db, actor, args.get("topic_id"))
            except Refusal as exc:
                if exc.code != "FORBIDDEN":
                    raise
                destination_available = False
        submissions = {"instance_id": self.instance_id, "items": [], "next_cursor": None} if note_only else self._view_submissions(db, actor, args)
        # A message the person can mark carries its mark; any other source has none.
        mark = self._mark_state(db, actor, args["source_ref"]["id"]) if source_available and args["source_ref"]["kind"] == "message" else None
        return {"instance_id": self.instance_id, "source_ref": args["source_ref"], "destination": {"topic_id": args.get("topic_id")},
                "source_available": source_available, "destination_available": destination_available,
                "draft": draft, "note": note, "reading_place": None, "submissions": submissions, "limits": dict(LIMITS),
                "mark": mark}

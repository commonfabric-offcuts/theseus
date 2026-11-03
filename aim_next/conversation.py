from __future__ import annotations

import json
import uuid

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size


CONVERSATION_SCHEMA = [
    "CREATE TABLE topic_participants (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), active INTEGER NOT NULL, epoch INTEGER NOT NULL, responsibility TEXT NOT NULL DEFAULT '', PRIMARY KEY(topic_id,actor_id))",
    "CREATE INDEX participant_topics ON topic_participants(actor_id,active,topic_id)",
    "CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, topic_id TEXT NOT NULL REFERENCES topics(id), author_id TEXT NOT NULL REFERENCES actors(id), body TEXT NOT NULL, attachments TEXT NOT NULL, quotes TEXT NOT NULL, addressees TEXT NOT NULL, reply_to TEXT, exchange_id TEXT, operation_id TEXT NOT NULL, UNIQUE(author_id,operation_id))",
    "CREATE INDEX topic_messages ON messages(topic_id,seq)",
    "CREATE TABLE topic_summaries (topic_id TEXT PRIMARY KEY REFERENCES topics(id), message_count INTEGER NOT NULL, latest_message_id TEXT REFERENCES messages(id))",
    "CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), recipient_id TEXT NOT NULL REFERENCES actors(id), state TEXT NOT NULL DEFAULT 'pending', UNIQUE(message_id,recipient_id))",
    "CREATE INDEX recipient_deliveries ON deliveries(recipient_id,state,seq)",
    "CREATE TABLE delivery_reasons (delivery_id TEXT NOT NULL REFERENCES deliveries(id), reason TEXT NOT NULL, topic_id TEXT NOT NULL REFERENCES topics(id), participant_epoch INTEGER, PRIMARY KEY(delivery_id,reason))",
    "CREATE TRIGGER immutable_messages_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'immutable message'); END",
    "CREATE TRIGGER immutable_messages_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'immutable message'); END",
]


def _preview(value, size=1024):
    return value.encode("utf-8")[:size].decode("utf-8", errors="ignore")


class Conversation:
    def _topic(self, db, actor, topic_id, manage=False):
        row = db.execute("SELECT t.*,w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?", (topic_id,)).fetchone()
        allowed = row and (row["owner_id"] == actor or row["creator_id"] == actor)
        if row and not allowed and not manage:
            allowed = db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (row["workspace_id"], actor)).fetchone() or db.execute(
                "SELECT 1 FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1", (topic_id, actor)).fetchone()
        if not allowed:
            raise Refusal("FORBIDDEN", "No permission for this topic")
        return row

    def _recipients(self, db, recipients):
        if not isinstance(recipients, list):
            raise Refusal("INVALID_ARGUMENT", "Recipients must be a list")
        for member in recipients:
            try:
                self._actor(db, _identifier(member))
            except Refusal:
                raise Refusal("INVALID_RECIPIENT", "Every recipient needs an active instance binding")
        return list(dict.fromkeys(recipients))

    def _touch_topic(self, db, topic):
        db.execute("UPDATE topics SET version=version+1 WHERE id=?", (topic["id"],))
        db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (topic["workspace_id"],))
        self._change(db, "topic", topic["id"], "topic", topic["id"], topic["version"] + 1)
        self._change(db, "workspace", topic["workspace_id"], "topic", topic["id"], topic["version"] + 1)
        return topic["version"] + 1

    def _command_participation_set(self, db, actor, envelope):
        topic = self._topic(db, actor, envelope.get("target", {}).get("topic_id"), manage=True)
        args = envelope.get("args", {})
        member = self._recipients(db, [args.get("actor_id")])[0]
        present = args.get("present")
        if not isinstance(present, bool):
            raise Refusal("INVALID_ARGUMENT", "Participation must be explicitly true or false")
        old = db.execute("SELECT * FROM topic_participants WHERE topic_id=? AND actor_id=?", (topic["id"], member)).fetchone()
        if present and (not old or not old["active"]):
            count = db.execute("SELECT count(*) FROM topic_participants WHERE topic_id=? AND active=1", (topic["id"],)).fetchone()[0]
            if count >= LIMITS["topic_participants"]:
                raise Refusal("TOO_MANY_PARTICIPANTS", "Topic participant limit includes its creator")
        # Every actual transition advances this member's fence. Re-adding them
        # cannot make an earlier subscription reason eligible again.
        epoch = old["epoch"] if old else 0
        if old is None or bool(old["active"]) != present:
            epoch += 1
        responsibility = _body(args.get("responsibility", old["responsibility"] if old else ""))
        db.execute("INSERT INTO topic_participants VALUES (?,?,?,?,?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET active=excluded.active,epoch=excluded.epoch,responsibility=excluded.responsibility",
                   (topic["id"], member, int(present), epoch, responsibility))
        version = self._touch_topic(db, topic)
        return {"topic_id": topic["id"], "actor_id": member, "present": present, "epoch": epoch,
                "responsibility": responsibility, "version": version}, [{"kind": "topic", "id": topic["id"], "version": version}]

    def _command_topic_create_and_send(self, db, actor, envelope):
        return self._send(db, actor, envelope, opening=True)

    def _command_message_send(self, db, actor, envelope):
        return self._send(db, actor, envelope, opening=False)

    def _send(self, db, actor, envelope, opening):
        args = envelope.get("args", {})
        if set(args) != {"submission_id"}:
            raise Refusal("INVALID_ARGUMENT", "A send accepts only its frozen submission identity")
        _, snapshot = self._submission(db, actor, args.get("submission_id"))
        topic_id = snapshot["topic_id"]
        if snapshot["send_operation_id"] != envelope["operation_id"] or envelope.get("target", {}).get("topic_id") != topic_id:
            raise Refusal("OPERATION_PAYLOAD_MISMATCH", "Use the prepared operation and destination unchanged")
        if opening:
            creation = snapshot.get("opening")
            if not isinstance(creation, dict) or snapshot["source_ref"]["kind"] != "new_topic":
                raise Refusal("INVALID_ARGUMENT", "This submission is not a topic opening")
            workspace_id = creation.get("workspace_id")
            self._workspace(db, actor, workspace_id)
            if workspace_id != snapshot["source_ref"].get("workspace_id"):
                raise Refusal("INVALID_ARGUMENT", "The opening belongs to a different workspace")
            participants = self._recipients(db, creation.get("participants", []))
            participants = list(dict.fromkeys([actor] + participants))
            if len(participants) > LIMITS["topic_participants"]:
                raise Refusal("TOO_MANY_PARTICIPANTS", "Topic participant limit includes its creator")
            title = _body(creation.get("title", ""))
            if not title.strip():
                raise Refusal("INVALID_ARGUMENT", "A topic needs a title")
            db.execute("INSERT INTO topics VALUES (?,?,?,?,0)", (topic_id, workspace_id, title, actor))
            db.executemany("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES (?,?,1,1)", [(topic_id, member) for member in participants])
            db.execute("INSERT INTO topic_summaries VALUES (?,0,NULL)", (topic_id,))
        topic = self._topic(db, actor, topic_id)
        # Attachments remain preserved in the private snapshot until the ready
        # media publication seam is implemented; no reference is dropped.
        if snapshot["attachments"]:
            raise Refusal("ATTACHMENT_NOT_READY", "Attachments must be durably published before this send")
        if not snapshot["body"].strip():
            raise Refusal("EMPTY_MESSAGE", "A message needs writing or a ready attachment")
        if snapshot.get("exchange_id"):
            raise Refusal("INVALID_EXCHANGE", "No matching exchange is available")
        if snapshot.get("reply_to"):
            parent = db.execute("SELECT topic_id FROM messages WHERE id=?", (snapshot["reply_to"],)).fetchone()
            if not parent or parent["topic_id"] != topic_id:
                raise Refusal("INVALID_ARGUMENT", "Reply context must belong to the destination topic")
        for quote in snapshot["quotes"]:
            if not isinstance(quote, dict):
                raise Refusal("INVALID_ARGUMENT", "Invalid quote reference")
            source = self._source(db, actor, quote.get("source"))
            excerpt = _body(quote.get("excerpt", ""))
            if not excerpt or excerpt not in source["body"]:
                raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")
        audience = {}
        for row in db.execute("SELECT actor_id,epoch FROM topic_participants WHERE topic_id=? AND active=1", (topic_id,)):
            audience[row["actor_id"]] = {"subscription": row["epoch"]}
        for recipient in self._recipients(db, snapshot["addressees"]):
            audience.setdefault(recipient, {})["addressed"] = None
        audience.pop(actor, None)
        if len(audience) > LIMITS["recipients"]:
            raise Refusal("TOO_MANY_RECIPIENTS", "Resolved recipients exceed the limit; nobody was sent a partial message")
        self._recipients(db, list(audience))
        message_id = "m-" + uuid.uuid4().hex
        db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (message_id, topic_id, actor, snapshot["body"], _json(snapshot["attachments"]), _json(snapshot["quotes"]),
                    _json(snapshot["addressees"]), snapshot.get("reply_to"), snapshot.get("exchange_id"), envelope["operation_id"]))
        for recipient, reasons in audience.items():
            delivery_id = "d-" + uuid.uuid4().hex
            db.execute("INSERT INTO deliveries(id,message_id,recipient_id) VALUES (?,?,?)", (delivery_id, message_id, recipient))
            db.executemany("INSERT INTO delivery_reasons VALUES (?,?,?,?)", [(delivery_id, reason, topic_id, epoch) for reason, epoch in reasons.items()])
            self._change(db, "actor", recipient, "delivery", delivery_id, 1)
        db.execute("UPDATE topic_summaries SET message_count=message_count+1,latest_message_id=? WHERE topic_id=?", (message_id, topic_id))
        version = self._touch_topic(db, topic)
        self._change(db, "actor", actor, "submission", snapshot["id"], 2)
        return {"message_id": message_id, "submission_id": snapshot["id"], "topic": {"id": topic_id, "version": version},
                "delivery": {"queued": len(audience)}}, [{"kind": "topic", "id": topic_id, "version": version}, {"kind": "message", "id": message_id, "version": 1}]

    def _source(self, db, actor, ref):
        if not isinstance(ref, dict) or ref.get("kind") != "message":
            raise Refusal("INVALID_SOURCE", "Unsupported source reference")
        row = db.execute("SELECT * FROM messages WHERE id=?", (_identifier(ref.get("id")),)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No readable source")
        try:
            topic = self._topic(db, actor, row["topic_id"])
        except Refusal:
            # An addressed recipient can read precisely the delivered source;
            # this does not enroll them or grant all of the topic's history.
            if not db.execute("SELECT 1 FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id WHERE d.message_id=? AND d.recipient_id=? AND r.reason='addressed'", (row["id"], actor)).fetchone():
                raise
            topic = {"workspace_id": None}
        return {"instance_id": self.instance_id, "source_ref": {"kind": "message", "id": row["id"]},
                "owner_scope": {"kind": "topic", "id": row["topic_id"]}, "topic_id": row["topic_id"],
                "author": row["author_id"], "title": "", "body": row["body"], "attachments": json.loads(row["attachments"]),
                "quotes": json.loads(row["quotes"]), "addressees": json.loads(row["addressees"]),
                "reply_to": row["reply_to"], "exchange_id": row["exchange_id"], "version": 1, "current_revision": 1,
                "allowed_actions": ["quote", "note.save"]}

    def _view_source(self, db, actor, args):
        return self._source(db, actor, args.get("source_ref", args))

    def _view_topic(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        participants = [dict(row) for row in db.execute("SELECT actor_id,active,epoch,substr(responsibility,1,256) AS responsibility FROM topic_participants WHERE topic_id=? AND active=1 ORDER BY actor_id LIMIT ?", (topic["id"], LIMITS["topic_participants"]))]
        summary = dict(db.execute("SELECT * FROM topic_summaries WHERE topic_id=?", (topic["id"],)).fetchone())
        return {"instance_id": self.instance_id, "topic": dict(topic), "participants": participants, "summary": summary,
                "relevant_versions": {"topic": topic["version"]}, "allowed_actions": ["draft.save", "message.send"]}

    def _view_topic_messages(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = _page_size(args)
        rows = db.execute("SELECT seq,id,topic_id,author_id,substr(body,1,1024) AS body,length(CAST(body AS BLOB)) AS body_bytes,reply_to,exchange_id FROM messages WHERE topic_id=? AND seq>? ORDER BY seq LIMIT ?", (topic["id"], args.get("cursor", 0), limit + 1)).fetchall()
        items, size, last = [], 1024, None
        for row in rows[:limit]:
            item = dict(row)
            item["body"] = _preview(item["body"])
            item["preview"] = len(item["body"].encode("utf-8")) < item.pop("body_bytes")
            encoded = len(_json(item).encode("utf-8"))
            if size + encoded > LIMITS["summary_utf8_bytes"]:
                break
            items.append(item)
            size += encoded
            last = row["seq"]
        return {"instance_id": self.instance_id, "items": items, "next_cursor": last if len(rows) > len(items) else None,
                "relevant_versions": {"topic": topic["version"]}}

    def _effective_reasons(self, db, delivery):
        rows = db.execute("SELECT r.reason,r.participant_epoch,p.active,p.epoch FROM delivery_reasons r LEFT JOIN topic_participants p ON p.topic_id=r.topic_id AND p.actor_id=? WHERE r.delivery_id=? ORDER BY r.reason", (delivery["recipient_id"], delivery["id"])).fetchall()
        return [r["reason"] for r in rows if r["reason"] != "subscription" or delivery["state"] != "pending" or (r["active"] and r["epoch"] == r["participant_epoch"])]

    def _view_deliveries(self, db, actor, args):
        limit = _page_size(args)
        rows = db.execute("SELECT * FROM deliveries WHERE recipient_id=? AND state='pending' AND seq>? ORDER BY seq LIMIT ?", (actor, args.get("cursor", 0), limit + 1)).fetchall()
        items = []
        for row in rows[:limit]:
            reasons = self._effective_reasons(db, row)
            if not reasons:
                continue
            message = dict(db.execute("SELECT id,topic_id,author_id,substr(body,1,256) AS body,length(body)>256 AS preview FROM messages WHERE id=?", (row["message_id"],)).fetchone())
            message["preview"] = bool(message["preview"])
            item = dict(row)
            item.update(reasons=reasons, message=message, source_ref={"kind": "message", "id": row["message_id"]})
            items.append(item)
        # Cursor advances over examined canceled entries too. A caller must
        # continue while next_cursor exists, even if this bounded page is empty.
        return {"instance_id": self.instance_id, "items": items,
                "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None}

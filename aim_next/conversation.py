from __future__ import annotations

import json
import uuid

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _revision
from .delivery import _now_ms
from .work import work_by_topic


CONVERSATION_SCHEMA = [
    "CREATE TABLE topic_participants (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), active INTEGER NOT NULL, epoch INTEGER NOT NULL, responsibility TEXT NOT NULL DEFAULT '', PRIMARY KEY(topic_id,actor_id))",
    "CREATE INDEX participant_topics ON topic_participants(actor_id,active,topic_id)",
    "CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, topic_id TEXT NOT NULL REFERENCES topics(id), author_id TEXT NOT NULL REFERENCES actors(id), body TEXT NOT NULL, attachments TEXT NOT NULL, quotes TEXT NOT NULL, addressees TEXT NOT NULL, reply_to TEXT, exchange_id TEXT, operation_id TEXT NOT NULL, UNIQUE(author_id,operation_id))",
    "CREATE INDEX topic_messages ON messages(topic_id,seq)",
    "CREATE INDEX unaddressed_messages ON messages(topic_id,seq) WHERE addressees='[]'",
    "CREATE TABLE message_addressees (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), seq INTEGER NOT NULL REFERENCES messages(seq), PRIMARY KEY(topic_id,actor_id,seq))",
    "CREATE TABLE topic_summaries (topic_id TEXT PRIMARY KEY REFERENCES topics(id), message_count INTEGER NOT NULL, latest_message_id TEXT REFERENCES messages(id))",
    "CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), state TEXT NOT NULL DEFAULT 'pending', UNIQUE(message_id,recipient_id))",
    "CREATE INDEX recipient_deliveries ON deliveries(recipient_id,state,seq)",
    "CREATE INDEX pending_group_deliveries ON deliveries(group_id,seq) WHERE state='pending'",
    "CREATE TABLE delivery_reasons (delivery_id TEXT NOT NULL REFERENCES deliveries(id), reason TEXT NOT NULL, topic_id TEXT NOT NULL REFERENCES topics(id), participant_epoch INTEGER, PRIMARY KEY(delivery_id,reason))",
    "CREATE TRIGGER immutable_messages_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'immutable message'); END",
    "CREATE TRIGGER immutable_messages_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'immutable message'); END",
]

# When a message was sent, in milliseconds since the epoch. Messages sent
# before this column existed have none.
MESSAGE_TIME_SCHEMA = ["ALTER TABLE messages ADD COLUMN sent_ms INTEGER"]
MESSAGE_TIME_DOWN = ("ALTER TABLE messages DROP COLUMN sent_ms",)
MESSAGE_TIME_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM messages WHERE sent_ms IS NOT NULL)"


# Version 14: a message sent to someone by name says whether it asks them
# something or tells them something. Messages sent before have none.
MESSAGE_INTENT_SCHEMA = ["ALTER TABLE messages ADD COLUMN intent TEXT CHECK(intent IN ('ask','tell'))"]
MESSAGE_INTENT_DOWN = ("ALTER TABLE messages DROP COLUMN intent",)
MESSAGE_INTENT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM messages WHERE intent IS NOT NULL)"
INTENTS = ("ask", "tell")
INTENT_REQUIRED = ("A message to someone says whether it asks or tells: post with --asks NAMES or --tells NAMES "
                   "(args.intent \"ask\" or \"tell\" on message.post or draft.save); nothing was sent")


# Version 16 found what a reader had not replied to, and version 18 drops it,
# since the New line follows what the reader has read (Delivery._oldest_unread).
# Each reader's horizon in a topic was a sequence below which every message was
# theirs, answered by a reply of theirs, or older than a post of theirs to the
# whole topic. An index found each message's replies by author. The 15->16
# step adds them and the 18->17 step works them out again from the messages.
UNANSWERED_SCHEMA = [
    "CREATE TABLE reply_horizons (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), "
    "seq INTEGER NOT NULL, PRIMARY KEY(topic_id,actor_id))",
    "CREATE INDEX message_replies ON messages(reply_to,author_id) WHERE reply_to IS NOT NULL",
]
# The upgrade works out every author's horizon from the messages already there:
# just below the oldest message after their last post to the whole topic that
# is someone else's and that no reply of theirs names, else past the newest.
UNANSWERED_BACKFILL = [
    "INSERT INTO reply_horizons(topic_id,actor_id,seq) SELECT a.topic_id,a.author_id,coalesce("
    "(SELECT min(m.seq) FROM messages m WHERE m.topic_id=a.topic_id AND m.author_id<>a.author_id "
    "AND m.seq>coalesce((SELECT max(p.seq) FROM messages p WHERE p.topic_id=a.topic_id AND p.author_id=a.author_id AND p.reply_to IS NULL),0) "
    "AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.reply_to=m.id AND r.author_id=a.author_id)),"
    "(SELECT max(t.seq)+1 FROM messages t WHERE t.topic_id=a.topic_id)) "
    "FROM (SELECT DISTINCT topic_id,author_id FROM messages) a",
]
UNANSWERED_DOWN = ("DROP INDEX message_replies", "DROP TABLE reply_horizons")
# Horizons are worked out from the messages, which stay: the step back loses
# no record, and the next upgrade works them out again.
UNANSWERED_OCCUPIED = "SELECT 0"


POST_FIELDS = {"body", "attachments", "addressees", "reply_to", "quotes", "intent"}


def _preview(value, size=1024):
    return value.encode("utf-8")[:size].decode("utf-8", errors="ignore")


class Conversation:
    def _topic(self, db, actor, topic_id, manage=False):
        _identifier(topic_id, "topic_id")
        row = db.execute("SELECT t.*,w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?", (topic_id,)).fetchone()
        allowed = row and (row["owner_id"] == actor or row["creator_id"] == actor)
        if row and not allowed and not manage:
            allowed = db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (row["workspace_id"], actor)).fetchone() or db.execute(
                "SELECT 1 FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1", (topic_id, actor)).fetchone()
        if not allowed:
            raise Refusal("FORBIDDEN", "No permission for this topic")
        return row

    def _recipients(self, db, recipients, require_enabled=True):
        if not isinstance(recipients, list):
            raise Refusal("INVALID_ARGUMENT", "Recipients must be a list")
        for member in recipients:
            _identifier(member, "recipient")
            row = db.execute("SELECT enabled FROM actors WHERE id=?", (member,)).fetchone()
            if not row or (require_enabled and not row["enabled"]):
                raise Refusal("INVALID_RECIPIENT", "Recipient %s is unavailable in this instance" % member)
        return list(dict.fromkeys(recipients))

    def _touch_topic(self, db, topic):
        db.execute("UPDATE topics SET version=version+1 WHERE id=?", (topic["id"],))
        db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (topic["workspace_id"],))
        self._change(db, "topic", topic["id"], "topic", topic["id"], topic["version"] + 1)
        self._change(db, "workspace", topic["workspace_id"], "topic", topic["id"], topic["version"] + 1)
        return topic["version"] + 1

    def _command_participation_set(self, db, actor, envelope):
        topic = self._topic(db, actor, envelope.get("target", {}).get("topic_id"), manage=True)
        _revision(envelope.get("expected", {}), "topic_revision", topic["version"])
        args = envelope.get("args", {})
        present = args.get("present")
        if not isinstance(present, bool):
            raise Refusal("INVALID_ARGUMENT", "Participation must be explicitly true or false")
        member = self._recipients(db, [args.get("actor_id")], require_enabled=present)[0]
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
            if old is not None and old["active"]:
                self._cancel_subscription(db, member, topic["id"], old["epoch"])
        responsibility = _body(args.get("responsibility", old["responsibility"] if old else ""))
        db.execute("INSERT INTO topic_participants VALUES (?,?,?,?,?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET active=excluded.active,epoch=excluded.epoch,responsibility=excluded.responsibility",
                   (topic["id"], member, int(present), epoch, responsibility))
        unwaited = not present and self._unwait(db, member, "id", topic["id"])
        version = self._touch_topic(db, topic)
        self._change(db, "actor", member, "participation", topic["id"], version)
        if unwaited:
            self._change(db, "actor", member, "waiting", topic["id"], version)
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
        _, snapshot = self._submission(db, actor, args.get("submission_id"), unconfirmed=True)
        topic_id = snapshot["topic_id"]
        if opening:
            existing = db.execute("SELECT version FROM topics WHERE id=?", (topic_id,)).fetchone()
            if existing is not None:
                versions = None
                try:
                    self._topic(db, actor, topic_id)
                    versions = {"topic_revision": existing["version"]}
                except Refusal:
                    pass
                raise Refusal("REVISION_CONFLICT", "This preallocated topic identity is already in use", versions)
            creation = snapshot.get("opening")
            if not isinstance(creation, dict) or snapshot["source_ref"]["kind"] != "new_topic":
                raise Refusal("INVALID_ARGUMENT", "This submission is not a topic opening")
            workspace_id = creation.get("workspace_id")
            self._workspace(db, actor, workspace_id)
            if workspace_id != snapshot["source_ref"].get("workspace_id"):
                raise Refusal("INVALID_ARGUMENT", "The opening belongs to a different workspace")
            self._open_topic(db, actor, topic_id, workspace_id, creation.get("title", ""), creation.get("participants", []),
                             Refusal("INVALID_ARGUMENT", "A topic needs a title"))
        # A prepared message to someone says whether it asks or tells, as a post
        # does: _publish refuses it, unrecorded, when the writing said neither.
        # Writing about a message in the topic it goes to answers that message,
        # quoted or not. The frozen source names it, so every send of it does.
        source = snapshot["source_ref"]
        if source.get("kind") == "message" and snapshot.get("reply_to") is None:
            parent = db.execute("SELECT topic_id FROM messages WHERE id=?", (source.get("id"),)).fetchone()
            if parent is not None and parent["topic_id"] == topic_id:
                snapshot["reply_to"] = source["id"]
        result, affected = self._publish(db, actor, envelope["operation_id"], topic_id, snapshot)
        self._change(db, "actor", actor, "submission", snapshot["id"], 2)
        return dict(result, submission_id=snapshot["id"]), affected

    def _command_message_post(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"topic_id"} or "body" not in args or set(args) - POST_FIELDS:
            raise Refusal("INVALID_ARGUMENT", "A post names one topic and carries its body, and optionally attachments, addressees, intent, reply_to and quotes")
        snapshot = self._writing(args)
        if snapshot.get("reply_to") is not None:
            _identifier(snapshot["reply_to"], "reply_to")
        return self._publish(db, actor, envelope["operation_id"], _identifier(target["topic_id"], "topic_id"), snapshot)

    def _command_topic_read_through(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"topic_id"} or "seq" not in args or set(args) - {"seq", "from_seq"}:
            raise Refusal("INVALID_ARGUMENT", "Name one topic and the sequence read through")
        through, start = args["seq"], args.get("from_seq", 0)
        if any(type(value) is not int or not 0 <= value <= 9223372036854775807 for value in (through, start)) or start > through:
            raise Refusal("INVALID_ARGUMENT", "The sequences read are nonnegative integers, from_seq at most seq")
        topic = self._topic(db, actor, target["topic_id"])
        # Subscription groups are kept per topic and participation epoch. Every
        # join or leave advances the epoch and only the epoch left is cancelled,
        # so the current epoch's group is the live one and only its pending rows
        # are visited; addressed deliveries share one direct group.
        rows = db.execute("SELECT d.* FROM topic_participants p CROSS JOIN delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 "
                          "ON g.recipient_id=p.actor_id AND g.kind='subscription' AND g.topic_id=p.topic_id AND g.participant_epoch=p.epoch "
                          "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                          "CROSS JOIN messages m ON m.id=d.message_id WHERE p.topic_id=? AND p.actor_id=? "
                          "AND g.pending_count>0 AND m.seq>=? AND m.seq<=?",
                          (topic["id"], actor, start, through)).fetchall()
        rows = sorted(rows + self._pending_addressed(db, actor, topic["id"], start, through), key=lambda row: row["seq"])
        for row in rows:
            self._acknowledge(db, actor, row)
        result = {"topic_id": topic["id"], "seq": through, "acknowledged": len(rows)}
        if "from_seq" in args:
            result["from_seq"] = start
        return result, []

    def _pending_addressed(self, db, actor, topic_id, start, through):
        """The actor's pending addressed deliveries for one topic's messages in [start, through].

        Two walks each give the whole answer: the direct group's pending rows,
        kept when their message is in this topic and range, and the messages
        addressed to the actor in this topic and range, kept when their
        delivery is still pending. They step one row in turn and the first to
        finish answers, so the work is at most twice the smaller of the actor's
        pending addressed deliveries and this range's addressed messages."""
        group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind='direct' AND topic_id='' AND participant_epoch=0 "
                           "AND active=1 AND pending_count>0", (actor,)).fetchone()
        if group is None:
            return []
        pending = db.execute("SELECT d.*,m.topic_id AS message_topic_id,m.seq AS message_seq FROM deliveries d INDEXED BY pending_group_deliveries "
                             "CROSS JOIN messages m ON m.id=d.message_id WHERE d.group_id=? AND d.state='pending' ORDER BY d.seq", (group["id"],))
        addressed = db.execute("SELECT d.* FROM message_addressees a CROSS JOIN messages m ON m.seq=a.seq "
                               "LEFT JOIN deliveries d ON d.message_id=m.id AND d.recipient_id=a.actor_id "
                               "WHERE a.topic_id=? AND a.actor_id=? AND a.seq>=? AND a.seq<=? ORDER BY a.seq", (topic_id, actor, start, through))
        walks = ((pending, lambda row: row["message_topic_id"] == topic_id and start <= row["message_seq"] <= through, []),
                 (addressed, lambda row: row["state"] == "pending", []))
        try:
            while True:
                for cursor, keep, kept in walks:
                    row = cursor.fetchone()
                    if row is None:
                        return kept
                    if keep(row):
                        kept.append(row)
        finally:
            pending.close()
            addressed.close()

    def _open_topic(self, db, actor, topic_id, workspace_id, title, participants, untitled):
        """Create a topic with its author and chosen participants, ready for its first message."""
        participants = self._recipients(db, participants)
        participants = list(dict.fromkeys([actor] + participants))
        if len(participants) > LIMITS["topic_participants"]:
            raise Refusal("TOO_MANY_PARTICIPANTS", "Topic participant limit includes its creator")
        title = _body(title)
        if not title.strip():
            raise untitled
        db.execute("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES (?,?,?,?,0)", (topic_id, workspace_id, title, actor))
        db.executemany("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES (?,?,1,1)", [(topic_id, member) for member in participants])
        db.execute("INSERT INTO topic_summaries VALUES (?,0,NULL)", (topic_id,))

    def _intent(self, db, actor, snapshot):
        """Whether writing to someone asks or tells. The rule exists to make
        agents choose, so an agent saying neither gets None, to be refused; a
        person naming someone and saying neither tells them. A person's page
        left open from an earlier release, or a preparation it froze, says
        neither, and its writing still goes."""
        intent = snapshot.get("intent")
        if intent is None and snapshot.get("addressees") and self._actor(db, actor)["kind"] == "human":
            return "tell"
        return intent

    def _publish(self, db, actor, operation_id, topic_id, snapshot):
        """Publish frozen writing as one message with its deliveries; every send shares this path."""
        topic = self._topic(db, actor, topic_id)
        intent = self._intent(db, actor, snapshot)
        if snapshot["addressees"] and intent is None:
            raise Refusal("INTENT_REQUIRED", INTENT_REQUIRED, recorded=False)
        if intent is not None and not snapshot["addressees"]:
            raise Refusal("INVALID_ARGUMENT", "Only a message to someone asks or tells; name who it is to")
        snapshot["attachments"] = self._attachment_refs(db, actor, snapshot["attachments"], ready=True)
        if not snapshot["body"].strip() and not snapshot["attachments"]:
            raise Refusal("EMPTY_MESSAGE", "A message needs writing or a ready attachment")
        if snapshot.get("exchange_id"):
            raise Refusal("INVALID_EXCHANGE", "No matching exchange is available")
        if snapshot.get("reply_to"):
            parent = db.execute("SELECT topic_id FROM messages WHERE id=?", (snapshot["reply_to"],)).fetchone()
            if not parent or parent["topic_id"] != topic_id:
                # A state check, not a shape error: it is recorded like the others.
                raise Refusal("INVALID_REPLY", "Reply context must belong to the destination topic")
        for quote in snapshot["quotes"]:
            if not isinstance(quote, dict):
                raise Refusal("INVALID_ARGUMENT", "Invalid quote reference")
            source = self._source(db, actor, quote.get("source"))
            excerpt = _body(quote.get("excerpt", ""))
            if not excerpt or excerpt not in source["body"]:
                raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")
        audience = {}
        unavailable = []
        for row in db.execute("SELECT p.actor_id,p.epoch,a.enabled FROM topic_participants p JOIN actors a ON a.id=p.actor_id WHERE p.topic_id=? AND p.active=1", (topic_id,)):
            if row["enabled"]:
                audience[row["actor_id"]] = {"subscription": row["epoch"]}
            else:
                unavailable.append(row["actor_id"])
        for recipient in self._recipients(db, snapshot["addressees"]):
            # Opening participants already exist in this effect savepoint.
            # A source-only delivery grant cannot support an ordinary reply.
            try:
                self._topic(db, recipient, topic_id)
            except Refusal as error:
                if error.code != "FORBIDDEN":
                    raise
                raise Refusal("REPLY_PATH_UNAVAILABLE",
                              "Recipient %s cannot reply in this topic; nobody was sent this message" % recipient)
            audience.setdefault(recipient, {})["addressed"] = None
        audience.pop(actor, None)
        if len(audience) > LIMITS["recipients"]:
            raise Refusal("TOO_MANY_RECIPIENTS", "Resolved recipients exceed the limit; nobody was sent a partial message")
        self._recipients(db, list(audience))
        message_id, sent_ms = "m-" + uuid.uuid4().hex, _now_ms()
        sequence = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id,sent_ms,intent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (message_id, topic_id, actor, snapshot["body"], _json(snapshot["attachments"]), _json(snapshot["quotes"]),
                    _json(snapshot["addressees"]), snapshot.get("reply_to"), snapshot.get("exchange_id"), operation_id, sent_ms, intent)).lastrowid
        db.executemany("INSERT INTO message_addressees VALUES (?,?,?)", [(topic_id, recipient, sequence) for recipient in snapshot["addressees"]])
        # A person replying to a message has read it: their delivery of it, if
        # still pending where it counts, is settled as reading it on screen
        # would. An agent's deliveries are its work, which it acknowledges
        # itself (delivery.ack), so its replies settle nothing.
        if snapshot.get("reply_to") and self._actor(db, actor)["kind"] == "human":
            answered = db.execute("SELECT d.* FROM deliveries d CROSS JOIN delivery_groups g ON g.id=d.group_id "
                                  "WHERE d.message_id=? AND d.recipient_id=? AND d.state='pending' AND g.active=1",
                                  (snapshot["reply_to"], actor)).fetchone()
            if answered is not None:
                self._acknowledge(db, actor, answered)
        for recipient, reasons in audience.items():
            delivery_id = self._queue_delivery(db, message_id, recipient, topic_id, reasons)
            self._change(db, "actor", recipient, "delivery", delivery_id, 1)
        db.execute("UPDATE topic_summaries SET message_count=message_count+1,latest_message_id=? WHERE topic_id=?", (message_id, topic_id))
        # Writing in the topic answers what was asked of the author there; an ask waits on whoever it asks.
        answered = [actor] if self._answered(db, topic_id, actor) else []
        asked = self._ask(db, topic, actor, message_id, sent_ms, snapshot["addressees"]) if intent == "ask" else []
        version = self._touch_topic(db, topic)
        for member in answered + asked:
            self._change(db, "actor", member, "waiting", topic_id, version)
        return {"message_id": message_id, "topic": {"id": topic_id, "version": version},
                "delivery": {"queued": len(audience), "unavailable_subscribers": sorted(unavailable)}}, [{"kind": "topic", "id": topic_id, "version": version}, {"kind": "message", "id": message_id, "version": 1}]

    def _message_access(self, db, actor, message_id):
        row = db.execute("SELECT id,topic_id,author_id FROM messages WHERE id=?", (_identifier(message_id),)).fetchone()
        if not row:
            raise Refusal("FORBIDDEN", "No readable source")
        try:
            self._topic(db, actor, row["topic_id"])
        except Refusal:
            # An addressed recipient can read precisely the delivered source;
            # this does not enroll them or grant all of the topic's history.
            if not db.execute("SELECT 1 FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id WHERE d.message_id=? AND d.recipient_id=? AND r.reason='addressed'", (row["id"], actor)).fetchone():
                raise Refusal("FORBIDDEN", "No readable source")
        return row

    def _source(self, db, actor, ref):
        if isinstance(ref, dict) and ref.get("kind") == "memory":
            return self._memory_source(db, actor, ref)
        if not isinstance(ref, dict) or ref.get("kind") != "message":
            raise Refusal("INVALID_SOURCE", "Unsupported source reference")
        identity = self._message_access(db, actor, ref.get("id"))
        row = db.execute("SELECT m.*,a.kind AS author_kind FROM messages m JOIN actors a ON a.id=m.author_id WHERE m.id=?", (identity["id"],)).fetchone()
        return {"instance_id": self.instance_id, "source_ref": {"kind": "message", "id": row["id"]},
                "owner_scope": {"kind": "topic", "id": row["topic_id"]}, "topic_id": row["topic_id"],
                "author": row["author_id"], "author_kind": row["author_kind"], "seq": row["seq"], "title": "", "body": row["body"], "attachments": json.loads(row["attachments"]),
                "quotes": json.loads(row["quotes"]), "addressees": json.loads(row["addressees"]),
                "reply_to": row["reply_to"], "exchange_id": row["exchange_id"], "sent_ms": row["sent_ms"], "intent": row["intent"], "version": 1, "current_revision": 1,
                "allowed_actions": ["quote", "note.save"]}

    def _view_source(self, db, actor, args):
        return self._source(db, actor, args.get("source_ref", args))

    def _view_topic(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        participants = [dict(row, enabled=bool(row["enabled"]), receiving=bool(row["enabled"])) for row in db.execute("SELECT p.actor_id,p.active,p.epoch,substr(p.responsibility,1,256) AS responsibility,a.enabled,a.kind FROM topic_participants p JOIN actors a ON a.id=p.actor_id WHERE p.topic_id=? AND p.active=1 ORDER BY p.actor_id LIMIT ?", (topic["id"], LIMITS["topic_participants"]))]
        summary = dict(db.execute("SELECT * FROM topic_summaries WHERE topic_id=?", (topic["id"],)).fetchone())
        waits = self._waits_by_topic(db, [topic["id"]])
        waiting_on, asks = waits[topic["id"]]
        topic = dict(topic, archived=bool(topic["archived"]), waiting_on=waiting_on, asks=asks, work=work_by_topic(db, waits)[topic["id"]])
        return {"instance_id": self.instance_id, "topic": topic, "participants": participants, "summary": summary,
                "relevant_versions": {"topic": topic["version"]}, "allowed_actions": ["draft.save", "message.send"]}

    def _view_topic_messages(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = _page_size(args)
        backwards = args.get("direction", "after") == "before"
        relation, order = ("<", "DESC") if backwards else (">", "ASC")
        cursor = args.get("cursor", 9223372036854775807 if backwards else 0)
        # A reply says whose message it answers, and how that message begins;
        # every message says whether a person or an agent wrote it.
        columns = ("m.seq,m.id,m.topic_id,m.author_id,w.kind AS author_kind,substr(m.body,1,1024) AS body,length(CAST(m.body AS BLOB)) AS body_bytes,m.reply_to,m.exchange_id,m.addressees,m.sent_ms,m.intent,"
                   "p.author_id AS reply_to_author,substr(p.body,1,120) AS reply_to_excerpt")
        parent = " JOIN actors w ON w.id=m.author_id LEFT JOIN messages p ON p.id=m.reply_to"
        if args.get("audience", "all") == "reader":
            unaddressed = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=? AND m.addressees='[]' AND m.seq" + relation + "? ORDER BY m.seq " + order + " LIMIT ?", (topic["id"], cursor, limit + 1)).fetchall()
            addressed = db.execute("SELECT " + columns + " FROM (SELECT seq FROM message_addressees WHERE topic_id=? AND actor_id=? AND seq" + relation + "? ORDER BY seq " + order + " LIMIT ?) a JOIN messages m ON m.seq=a.seq" + parent, (topic["id"], actor, cursor, limit + 1)).fetchall()
            rows = sorted(unaddressed + addressed, key=lambda row: row["seq"], reverse=backwards)[:limit + 1]
        else:
            rows = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=? AND m.seq" + relation + "? ORDER BY m.seq " + order + " LIMIT ?", (topic["id"], cursor, limit + 1)).fetchall()
        items, size, last = [], 1024, None
        for row in rows[:limit]:
            item = dict(row)
            item["addressees"] = json.loads(item["addressees"])
            item["body"] = _preview(item["body"])
            item["preview"] = len(item["body"].encode("utf-8")) < item.pop("body_bytes")
            encoded = len(_json(item).encode("utf-8")) + 1
            if size + encoded > LIMITS["summary_utf8_bytes"]:
                break
            items.append(item)
            size += encoded
            last = row["seq"]
        if backwards:
            items.reverse()
        return {"instance_id": self.instance_id, "items": items, "next_cursor": last if len(rows) > len(items) else None,
                "relevant_versions": {"topic": topic["version"]}, **self._new_line(db, actor, topic["id"])}

    def _effective_reasons(self, db, delivery):
        rows = db.execute("SELECT r.reason,r.participant_epoch,p.active,p.epoch FROM delivery_reasons r LEFT JOIN topic_participants p ON p.topic_id=r.topic_id AND p.actor_id=? WHERE r.delivery_id=? ORDER BY r.reason", (delivery["recipient_id"], delivery["id"])).fetchall()
        return [r["reason"] for r in rows if r["reason"] != "subscription" or delivery["state"] != "pending" or (r["active"] and r["epoch"] == r["participant_epoch"])]

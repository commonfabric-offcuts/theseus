from __future__ import annotations

import json
import uuid

from .contract import LIMITS, Refusal, organises, _body, _identifier, _json, _page_size, _prefix, _revision
from .delivery import _now_ms
from .responsibility import responsibility_note
from .work import OTHER_MESSAGE, work_by_topic
from . import whispers
from .standing_conversation import open_items_clause
from .reactions import GO_AHEAD_NEEDS_ASK, go_ahead_flag
from .topic_reading import reading_fields, unread_groups
from .stacks import act_fields, awaiting_fields, record_wait_start
from .message_edit import current_words, edited, is_held, mark, plain, quoted_revision, reading, revision, words, withheld


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


# Version 16 found what a reader had not replied to: each reader's horizon in a
# topic was a sequence below which every message was theirs, answered by a
# reply of theirs, or older than a post of theirs to the whole topic, and an
# index found each message's replies by author. Version 18's New line follows
# what the reader has read instead (Delivery._oldest_unread), so it drops the
# index. It keeps the table as the record of who has written in each topic,
# which TopicState._may_say reads: a row for every (topic, author), its seq one
# past the author's newest message there. The 15->16 step adds both and the
# 18->17 step works the horizons out again from the messages.
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
# A fresh instance at version 18 has the table without the index.
WRITTEN_SCHEMA = UNANSWERED_SCHEMA[:1]
# The upgrade to 18 drops the index and makes every row say one past its
# author's newest message in the topic, as each publish then writes it.
WRITTEN_UPGRADE = ("DROP INDEX message_replies",
                   "UPDATE reply_horizons SET seq=coalesce((SELECT max(m.seq)+1 FROM messages m WHERE m.topic_id=reply_horizons.topic_id "
                   "AND m.author_id=reply_horizons.actor_id),seq)")
# The step back to 17 puts the index back and works out each horizon again.
WRITTEN_DOWN = (UNANSWERED_SCHEMA[1], "DELETE FROM reply_horizons") + tuple(UNANSWERED_BACKFILL)


# The images a writer may pick with #img (docs/conversation.md, "Images to
# pick"): those carried by the newest IMAGE_WINDOW messages the reader may see
# in the topic and in its outcome's conversation, newest first.
IMAGE_WINDOW = 200
IMAGE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")


POST_FIELDS = {"body", "attachments", "addressees", "reply_to", "quotes", "intent", "whisper", "part", "subjects", "go_ahead", "blocks"}


def _preview(value, size=1024):
    return value.encode("utf-8")[:size].decode("utf-8", errors="ignore")


class Conversation:
    def _topic(self, db, actor, topic_id, manage=False):
        _identifier(topic_id, "topic_id")
        # With manage=True, only those who manage the topic: whoever organises its outcome,
        # and its creator. Reading is as READABLE says; being coordinator grants none.
        row = db.execute("SELECT t.*,w.owner_id,w.coordinator_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?",
                         (topic_id,)).fetchone()
        allowed = row and (row["owner_id"] == actor or row["creator_id"] == actor or (manage and organises(row, actor)))
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
        self._conversation_participation_refused(topic)
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
        responsibility = responsibility_note(args.get("responsibility", old["responsibility"] if old else ""))
        # A changed note takes a new revision, so a request built on the old one is refused.
        revision = (old["responsibility_revision"] if old else 0) + (responsibility != (old["responsibility"] if old else ""))
        db.execute("INSERT INTO topic_participants(topic_id,actor_id,active,epoch,responsibility,responsibility_revision) VALUES (?,?,?,?,?,?) "
                   "ON CONFLICT(topic_id,actor_id) DO UPDATE SET active=excluded.active,epoch=excluded.epoch,"
                   "responsibility=excluded.responsibility,responsibility_revision=excluded.responsibility_revision",
                   (topic["id"], member, int(present), epoch, responsibility, revision))
        unwaited = not present and self._unwait(db, member, "id", topic["id"])
        if not present:
            # Leaving the topic may take messages from them: corrections of those go too (message_edit.py).
            self._settle_unreadable_corrections(db, member)
        version = self._touch_topic(db, topic)
        self._change(db, "actor", member, "participation", topic["id"], version)
        if unwaited:
            self._change(db, "actor", member, "waiting", topic["id"], version)
        return {"topic_id": topic["id"], "actor_id": member, "present": present, "epoch": epoch,
                "responsibility": responsibility, "responsibility_revision": revision, "version": version}, [{"kind": "topic", "id": topic["id"], "version": version}]

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
        # A Tell written about a whisper is a new message on the record that
        # quotes only what its person chose: it answers nothing, so the
        # whisper itself stays between the two. A whisper about a whisper answers it.
        source = snapshot["source_ref"]
        snapshot.pop("about_id", None)
        if source.get("kind") == "message" and snapshot.get("reply_to") is None:
            parent = db.execute("SELECT topic_id,private_to FROM messages WHERE id=?", (source.get("id"),)).fetchone()
            if (parent is not None and parent["topic_id"] == topic_id
                    and (parent["private_to"] is None or whispers.whispering(snapshot))):
                snapshot["reply_to"] = source["id"]
            elif parent is not None and parent["private_to"] is None and not whispers.whispering(snapshot):
                # Writing about a message in another topic, sent to the outcome's conversation,
                # links back to that message (standing_conversation.py).
                destination = db.execute("SELECT kind FROM topics WHERE id=?", (topic_id,)).fetchone()
                if destination is not None and destination["kind"] == "conversation":
                    snapshot["about_id"] = source["id"]
        result, affected = self._publish(db, actor, envelope["operation_id"], topic_id, snapshot)
        self._change(db, "actor", actor, "submission", snapshot["id"], 2)
        return dict(result, submission_id=snapshot["id"]), affected

    def _command_message_post(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"topic_id"} or "body" not in args or set(args) - POST_FIELDS:
            raise Refusal("INVALID_ARGUMENT", "A post names one topic and carries its body, and optionally attachments, addressees, intent, reply_to, quotes and whisper")
        subjects, blocks = args.get("subjects"), args.get("blocks")
        snapshot = self._writing({key: value for key, value in args.items() if key not in ("subjects", "go_ahead", "blocks")})
        # An Ask that asks for a go-ahead offers its people ✅ and 🚫 (reactions.py); only a post says so.
        snapshot["go_ahead"] = go_ahead_flag(args)
        if snapshot.get("reply_to") is not None:
            _identifier(snapshot["reply_to"], "reply_to")
        result, affected = self._publish(db, actor, envelope["operation_id"], _identifier(target["topic_id"], "topic_id"), snapshot)
        if subjects is not None:
            # A post's subjects are written with it, so an ask and its subject never come apart (pipeline.py).
            workspace_id = db.execute("SELECT workspace_id FROM topics WHERE id=?", (target["topic_id"],)).fetchone()[0]
            self._record_subjects(db, workspace_id, result["message_id"], subjects)
        if blocks is not None:
            # What an ask holds is written with it, so the ask and the piece or release it holds never come apart (blocking.py).
            result = dict(result, blocks=self._record_blocks(db, result["message_id"], blocks))
        return result, affected

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
                               "LEFT JOIN deliveries d ON d.message_id=m.id AND d.recipient_id=a.actor_id AND d.revision=1 "
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
        db.execute("INSERT INTO topic_summaries(topic_id,message_count,latest_message_id) VALUES (?,0,NULL)", (topic_id,))

    def _intent(self, db, actor, snapshot):
        """Whether writing to someone asks or tells. The rule exists to make
        agents choose, so an agent saying neither gets None, to be refused; a
        person naming someone and saying neither tells them. A person's page
        left open from an earlier release, or a preparation it froze, says
        neither, and its writing still goes."""
        intent = snapshot.get("intent")
        # A whisper neither asks nor tells.
        if whispers.whispering(snapshot):
            return intent
        if intent is None and snapshot.get("addressees") and self._actor(db, actor)["kind"] == "human":
            return "tell"
        return intent

    def _publish(self, db, actor, operation_id, topic_id, snapshot, topic=None, settled_for=(), record_only=False):
        """Publish frozen writing as one message with its deliveries; every send shares this path.

        topic, the topic's row, and settled_for are given only by Theseus's own
        notices (health.py), written into an outcome's conversation by no member
        of it: whoever a notice is about gets it settled, so it is never work
        that wakes them. record_only is an internal assessment-report capability:
        it retains the message/freshness, but not work-state or subscription wakes.
        No public message command accepts this flag."""
        topic = self._topic(db, actor, topic_id) if topic is None else topic
        parent = None
        if snapshot.get("reply_to"):
            # A message the writer cannot see is refused as one that does not exist.
            parent = db.execute("SELECT topic_id,author_id,private_to FROM messages WHERE id=?", (snapshot["reply_to"],)).fetchone()
            if not parent or parent["topic_id"] != topic_id or not whispers.visible(parent, actor):
                # A state check, not a shape error: it is recorded like the others.
                raise Refusal("INVALID_REPLY", "Reply context must belong to the destination topic")
        private = whispers.check_publish(db, actor, snapshot, parent)
        # In an outcome's conversation an agent answers only the items it answers (standing_conversation.py).
        self._conversation_check_publish(db, actor, topic, snapshot, snapshot.get("reply_to"), private)
        intent = self._intent(db, actor, snapshot)
        if snapshot["addressees"] and intent is None and private is None:
            raise Refusal("INTENT_REQUIRED", INTENT_REQUIRED, recorded=False)
        if intent is not None and not snapshot["addressees"]:
            raise Refusal("INVALID_ARGUMENT", "Only a message to someone asks or tells; name who it is to")
        if snapshot.get("go_ahead") and (intent != "ask" or private is not None):
            raise Refusal("INVALID_ARGUMENT", GO_AHEAD_NEEDS_ASK)
        snapshot["attachments"] = self._attachment_refs(db, actor, snapshot["attachments"], ready=True)
        if not snapshot["body"].strip() and not snapshot["attachments"]:
            raise Refusal("EMPTY_MESSAGE", "A message needs writing or a ready attachment")
        if snapshot.get("exchange_id"):
            raise Refusal("INVALID_EXCHANGE", "No matching exchange is available")
        for quote in snapshot["quotes"]:
            if not isinstance(quote, dict):
                raise Refusal("INVALID_ARGUMENT", "Invalid quote reference")
            source = self._source(db, actor, quote.get("source"))
            excerpt = _body(quote.get("excerpt", ""))
            if not excerpt:
                raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")
            if source["source_ref"]["kind"] == "message":
                # A message's quote is checked against the revision it names, or any revision when it names none
                # (docs/message-edit.md, "Quotes"); the quote is kept as written, naming what it named.
                quoted_revision(db, source["source_ref"]["id"], quote["source"], excerpt)
            elif excerpt not in source["body"]:
                raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")
            whispers.quote_allowed(db, actor, source, private)
        audience = {}
        unavailable = []
        # A whisper reaches its one other person, and nobody else in the topic.
        for row in () if private else db.execute("SELECT p.actor_id,p.epoch,a.enabled FROM topic_participants p JOIN actors a ON a.id=p.actor_id WHERE p.topic_id=? AND p.active=1", (topic_id,)):
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
        # A person's whisper counts as their Tell; an agent's only answers one (whispers.py).
        counts = private is None or self._actor(db, actor)["kind"] == "human"
        message_id, sent_ms = "m-" + uuid.uuid4().hex, _now_ms()
        sequence = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id,sent_ms,intent,private_to,about_id,go_ahead) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (message_id, topic_id, actor, snapshot["body"], _json(snapshot["attachments"]), _json(snapshot["quotes"]),
                    _json(snapshot["addressees"]), snapshot.get("reply_to"), snapshot.get("exchange_id"), operation_id, sent_ms, intent, private, snapshot.get("about_id"),
                    1 if snapshot.get("go_ahead") else 0)).lastrowid
        db.executemany("INSERT INTO message_addressees VALUES (?,?,?)", [(topic_id, recipient, sequence) for recipient in snapshot["addressees"]])
        # The first post of a release that holds item 475 says where its waiting dots begin (stacks.py).
        record_wait_start(db, sequence)
        # The author has written in this topic (TopicState._may_say); an agent's whisper is not writing in it.
        if counts and not record_only:
            db.execute("INSERT INTO reply_horizons VALUES (?,?,?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET seq=excluded.seq",
                       (topic_id, actor, sequence + 1))
        # A person replying to a message has read it: their delivery of it, if
        # still pending where it counts, is settled as reading it on screen
        # would. An agent's deliveries are its work, which it acknowledges
        # itself (delivery.ack), so its replies settle nothing.
        if snapshot.get("reply_to") and self._actor(db, actor)["kind"] == "human":
            answered = db.execute("SELECT d.* FROM deliveries d CROSS JOIN delivery_groups g ON g.id=d.group_id "
                                  "WHERE d.message_id=? AND d.recipient_id=? AND d.revision=1 AND d.state='pending' AND g.active=1",
                                  (snapshot["reply_to"], actor)).fetchone()
            if answered is not None:
                self._acknowledge(db, actor, answered)
        # A message sent by name to others is not for a person who is neither
        # named nor the author of the message it answers: their delivery is
        # recorded settled, so it counts nowhere and holds no New line. An
        # agent's deliveries are its work, queued as ever.
        answers = parent["author_id"] if parent else None
        for recipient, reasons in audience.items():
            between = bool(snapshot["addressees"]) and "addressed" not in reasons and recipient != answers
            settled = recipient in settled_for or record_only and "addressed" not in reasons or between and self._actor(db, recipient)["kind"] == "human"
            delivery_id = self._queue_delivery(db, message_id, recipient, topic_id, reasons, settled=settled)
            self._change(db, "actor", recipient, "delivery", delivery_id, 1)
        if private is not None:
            # Each of the two learns of it in their own scope, readable by them alone (whispers.py).
            for member in (actor, private):
                self._change(db, "actor", member, "whisper", topic_id, sequence)
            if not counts:
                # An agent's whisper answers a person's whisper and changes nothing shared about the topic.
                return {"message_id": message_id, "topic": {"id": topic_id, "version": topic["version"]},
                        "delivery": {"queued": len(audience), "unavailable_subscribers": []}, "whisper": True}, [
                            {"kind": "message", "id": message_id, "version": 1}]
        else:
            # Who wrote the latest message before this one decides whether it is now the latest by someone else (work.py).
            # A whisper never moves these: they point at the message, which nobody else can open.
            db.execute("UPDATE topic_summaries SET message_count=message_count+1," + OTHER_MESSAGE + ",latest_message_id=?2 WHERE topic_id=?3",
                       (actor, message_id, topic_id))
        if not record_only:
            self._message_activity(db, topic, actor, message_id, sent_ms)
        if record_only:
            waited = []
        elif topic["kind"] == "conversation":
            # A conversation keeps its items, what became of each, and its waits ask by ask.
            waited = self._conversation_record(db, actor, topic, message_id, snapshot, intent, private)
        else:
            # Writing in the topic answers what was asked of the author there (a person's whisper, the ask of the agent
            # it goes to that it replies to); an ask waits on whoever it asks.
            waited = ([actor] if self._answered(db, topic, actor, private, snapshot.get("reply_to")) else []) + (
                self._ask(db, topic, actor, message_id, sent_ms, snapshot["addressees"]) if intent == "ask" else [])
        version = self._touch_topic(db, topic)
        for member in dict.fromkeys(waited):
            self._change(db, "actor", member, "waiting", topic_id, version)
        result = {"message_id": message_id, "topic": {"id": topic_id, "version": version},
                  "delivery": {"queued": len(audience), "unavailable_subscribers": sorted(unavailable)}}
        if private is not None:
            result["whisper"] = True
        # A person's reply folds the message it answers for them (Stacks._fold_answered).
        folded = self._fold_answered(db, actor, snapshot["reply_to"]) if snapshot.get("reply_to") else []
        return result, [{"kind": "topic", "id": topic_id, "version": version}, {"kind": "message", "id": message_id, "version": 1}] + folded

    def _message_access(self, db, actor, message_id):
        row = db.execute("SELECT id,topic_id,author_id,private_to FROM messages WHERE id=?", (_identifier(message_id),)).fetchone()
        # A whisper is readable by its two people only, and refused to anyone else exactly as an unknown id.
        if not row or not whispers.visible(row, actor):
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
        # Reach comes first, so a reader who may not read it is refused FORBIDDEN, held or not.
        identity = self._message_access(db, actor, ref.get("id"))
        row = db.execute("SELECT m.id,m.seq,m.topic_id,m.author_id,m.attachments,m.quotes,m.addressees,m.reply_to,m.exchange_id,m.sent_ms,m.intent,"
                         "m.private_to,m.go_ahead,a.kind AS author_kind FROM messages m JOIN actors a ON a.id=m.author_id WHERE m.id=?", (identity["id"],)).fetchone()
        # A message its author has open in Edit is held from agents: its words, attachments and quotes are left out
        # (docs/message-edit.md). The hold is decided here, before any words are read, so commands and open_media,
        # which run outside a view, are held too.
        if reading.get() is not None:
            held = withheld(row["id"])
        else:
            from .delivery import _now_ms
            held = self._actor(db, actor)["kind"] == "agent" and is_held(db, row["id"], _now_ms())
        # The latest words, their revision (1 when never edited) and when they were edited (message_edit.py).
        body, current, edited_ms = current_words(db, row["id"])
        quotes = [] if held else self._source_quotes(db, actor, json.loads(row["quotes"]))
        return {"instance_id": self.instance_id, "source_ref": {"kind": "message", "id": row["id"]},
                "owner_scope": {"kind": "topic", "id": row["topic_id"]}, "topic_id": row["topic_id"],
                "author": row["author_id"], "author_kind": row["author_kind"], "seq": row["seq"], "title": "", "body": "" if held else body,
                "attachments": [] if held else json.loads(row["attachments"]), "withheld": held,
                "quotes": quotes, "addressees": json.loads(row["addressees"]),
                "reply_to": row["reply_to"], "exchange_id": row["exchange_id"], "sent_ms": row["sent_ms"], "intent": row["intent"],
                "version": current, "current_revision": current, "revision": current, "edited_ms": edited_ms,
                "allowed_actions": ["quote", "note.save"], **whispers.whisper_fields(row), **self._source_reactions(db, actor, row)}

    def _source_quotes(self, db, actor, stored):
        """A message's stored quotes as the actor reads them (whispers.redact_quotes). A quote of a
        message is marked as that message's words at the revision it names (1 when it names none), from its source as
        stored, before redaction, so handing it records the quoted message; a quote of a held message comes with no
        excerpt and withheld: true, and every other quote is as stored, with no withheld key."""
        quotes = []
        for kept, quote in zip(stored, whispers.redact_quotes(db, actor, stored)):
            source = kept.get("source") if isinstance(kept, dict) else None
            if not isinstance(quote, dict) or not isinstance(source, dict) or source.get("kind") != "message":
                quotes.append(quote)
            elif withheld(source.get("id")):
                quotes.append(dict(quote, excerpt="", withheld=True))
            else:
                number = source.get("revision")
                number = number if isinstance(number, int) and not isinstance(number, bool) and number > 0 else 1
                quotes.append(dict(quote, excerpt=mark(source.get("id"), number, quote.get("excerpt"))))
        return quotes

    def _view_source(self, db, actor, args):
        return self._source(db, actor, args.get("source_ref", args))

    def _view_topic(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        # Each participant's note on what they are responsible for, whole up to its bound.
        participants = []
        for row in db.execute("SELECT p.actor_id,p.active,p.epoch,substr(CAST(p.responsibility AS BLOB),1,1025) AS note_prefix,p.responsibility_revision,a.enabled,a.kind,substr(CAST(a.name AS BLOB),1,1025) AS name_prefix "
                              "FROM topic_participants p JOIN actors a ON a.id=p.actor_id WHERE p.topic_id=? AND p.active=1 ORDER BY p.actor_id LIMIT ?",
                              (topic["id"], LIMITS["workspace_members" if topic["kind"] == "conversation" else "topic_participants"])):
            item = dict(row, enabled=bool(row["enabled"]), receiving=bool(row["enabled"]))
            item["responsibility"], item["responsibility_truncated"] = _prefix(item.pop("note_prefix") or b"")
            # The name the page matches a leading @name against, as workspace_members gives it (addressing.py).
            item["name"], item["name_truncated"] = _prefix(item.pop("name_prefix") or b"")
            participants.append(item)
        summary = dict(db.execute("SELECT topic_id,message_count,latest_message_id FROM topic_summaries WHERE topic_id=?", (topic["id"],)).fetchone())
        waits = self._waits_by_topic(db, [topic["id"]])
        waiting_on, asks = waits[topic["id"]]
        # reader_may_say: whether the reader may say where it stands, so a page offers its form.
        # The message that reopened or started it is named only to a reader who may see it (whispers.py).
        topic = dict(whispers.redact_topic(db, actor, topic), archived=bool(topic["archived"]), waiting_on=waiting_on, asks=asks, work=work_by_topic(db, waits, actor)[topic["id"]],
                     reader_may_say=self._may_say(db, topic, actor), build=topic["id"] in self._build_topics(db, topic["workspace_id"]))
        # D10: the outcome's target, closed, above the conversation; None for an outcome to keep with no target and no checks.
        target = self._outcome_target_line(db, actor, topic["workspace_id"])
        return {"instance_id": self.instance_id, "topic": topic, "participants": participants, "summary": summary,
                "outcome_target": target, "relevant_versions": {"topic": topic["version"]}, "allowed_actions": ["draft.save", "message.send"]}

    def _view_topic_messages(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        # Named messages are read alone: a page's position, size or form would be a second question.
        if args.get("message_ids") is not None and set(args) & {"cursor", "direction", "limit", "items", "audience"}:
            raise Refusal("INVALID_ARGUMENT", "message_ids goes with topic_id alone")
        limit = _page_size(args)
        backwards = args.get("direction", "after") == "before"
        relation, order = ("<", "DESC") if backwards else (">", "ASC")
        cursor = args.get("cursor", 9223372036854775807 if backwards else 0)
        # A reply says whose message it answers, and how that message begins;
        # every message says whether a person or an agent wrote it, and what it carries.
        # Every message reads as its latest words, with their revision and when they were edited, and so does the
        # beginning of the message a reply answers (message_edit.py).
        # The body is read plain, cut and measured here, and only the cut is marked as handed (message_edit.py); the
        # beginning of the message a reply answers is cut and marked by the helper.
        columns = ("m.seq,m.id,m.topic_id,m.author_id,w.kind AS author_kind," + words("m", plain=True) + " AS body,"
                   + revision("m") + " AS revision," + edited("m") + " AS edited_ms,m.reply_to,m.exchange_id,m.addressees,m.attachments,m.sent_ms,m.intent,m.private_to,"
                   "p.author_id AS reply_to_author," + words("p", chars=120) + " AS reply_to_excerpt,p.private_to AS reply_to_private")
        parent = " JOIN actors w ON w.id=m.author_id LEFT JOIN messages p ON p.id=m.reply_to"
        # Every form reads only what the reader may see (whispers.VISIBLE), so a
        # page never stalls on, counts or folds a whisper between others.
        values = {"topic": topic["id"], "actor": actor, "cursor": cursor, "limit": limit + 1}
        if args.get("message_ids") is not None:
            # Named messages of this topic, in page shape (a page refreshing one it holds, docs/message-edit.md).
            ids = self._named_messages(db, actor, topic, args["message_ids"])
            values.update(("id%d" % n, mid) for n, mid in enumerate(ids))
            rows = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=:topic AND m.id IN (" + ",".join(
                ":id%d" % n for n in range(len(ids))) + ") AND " + whispers.VISIBLE + " ORDER BY m.seq", values).fetchall()
            backwards, limit = False, len(rows)
        elif args.get("items") is not None:
            if args["items"] != "open" or topic["kind"] != "conversation":
                raise Refusal("INVALID_ARGUMENT", "items is \"open\", and only in an outcome's conversation")
            rows = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=:topic AND m.seq" + relation + ":cursor AND "
                              + whispers.VISIBLE + open_items_clause() + " ORDER BY m.seq " + order + " LIMIT :limit", values).fetchall()
        elif args.get("audience", "all") == "reader":
            unaddressed = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=:topic AND m.addressees='[]' AND m.seq" + relation + ":cursor AND " + whispers.VISIBLE + " ORDER BY m.seq " + order + " LIMIT :limit", values).fetchall()
            addressed = db.execute("SELECT " + columns + " FROM (SELECT seq FROM message_addressees WHERE topic_id=:topic AND actor_id=:actor AND seq" + relation + ":cursor ORDER BY seq " + order + " LIMIT :limit) a JOIN messages m ON m.seq=a.seq" + parent + " WHERE " + whispers.VISIBLE, values).fetchall()
            rows = sorted(unaddressed + addressed, key=lambda row: row["seq"], reverse=backwards)[:limit + 1]
        else:
            rows = db.execute("SELECT " + columns + " FROM messages m" + parent + " WHERE m.topic_id=:topic AND m.seq" + relation + ":cursor AND " + whispers.VISIBLE + " ORDER BY m.seq " + order + " LIMIT :limit", values).fetchall()
        items, size, last = [], 1024, None
        for row in rows[:limit]:
            item = dict(row)
            # A reply says how its parent begins only to a reader who may see the parent.
            hidden = item.pop("reply_to_private") not in (None, actor) and item["reply_to_author"] != actor
            if hidden:
                item["reply_to_author"] = item["reply_to_excerpt"] = None
            # A message its author has open in Edit is held from agents: its item stays, without its words or images,
            # and a reply to it says so in place of its line (docs/message-edit.md).
            item["withheld"] = withheld(item["id"])
            item["reply_to_withheld"] = not hidden and item["reply_to"] is not None and withheld(item["reply_to"])
            if item["reply_to_withheld"]:
                item["reply_to_excerpt"] = None
            item.update(whispers.whisper_fields(row))
            if not item["whisper"]:
                item.pop("private_to")
            elif item["author_id"] == actor:
                item["no_answer"] = whispers.no_answer(db, item)
            item["addressees"] = json.loads(item["addressees"])
            item["attachments"] = [] if item["withheld"] else json.loads(item["attachments"])
            whole = item["body"]
            cut = _preview(whole)
            item["preview"] = len(cut.encode("utf-8")) < len(whole.encode("utf-8"))
            item["body"] = mark(item["id"], item["revision"], cut)
            encoded = len(_json(plain(item)).encode("utf-8")) + 1
            if size + encoded > LIMITS["summary_utf8_bytes"]:
                break
            items.append(item)
            size += encoded
            last = row["seq"]
        if backwards:
            items.reverse()
        self._item_fields(db, actor, topic, items)
        self._reaction_fields(db, actor, items)
        self._block_fields(db, items)
        reading_fields(db, actor, unread_groups(db, actor, topic["id"], self._addressed_group(db, actor)), items)
        # What the reader and the topic recorded about each message in its stack (stacks.py).
        act_fields(db, actor, items)
        # Whether each of the reader's own messages still waits for a reply (item 475), until the first reply from anyone else.
        awaiting_fields(db, actor, topic, items)
        return {"instance_id": self.instance_id, "items": items, "next_cursor": last if len(rows) > len(items) else None,
                "relevant_versions": {"topic": topic["version"]}, **self._new_line(db, actor, topic["id"])}

    def _named_messages(self, db, actor, topic, ids):
        """The ids topic_messages was asked for, each once: one to 100 messages of this topic the actor can see, or a
        refusal, as stack_positions refuses them. A whisper the actor is not in is refused as an unknown id."""
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(mid, str) for mid in ids):
            raise Refusal("INVALID_ARGUMENT", "Name one to 100 message ids")
        ids = list(dict.fromkeys(_identifier(mid, "message_id") for mid in ids))
        for mid in ids:
            # Reach first, as stack_positions does: a message the actor cannot read, wherever it is, is refused
            # exactly as an unknown id, so its existence and its topic never show.
            row = self._message_access(db, actor, mid)
            if row["topic_id"] != topic["id"]:
                raise Refusal("INVALID_ARGUMENT", "Messages must be in the named topic")
        return ids

    def _view_topic_images(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = args.get("limit", 24)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise Refusal("INVALID_ARGUMENT", "Invalid image count")
        topics = [topic]
        if topic["kind"] != "conversation":
            conversation = db.execute("SELECT id FROM topics WHERE workspace_id=? AND kind='conversation'", (topic["workspace_id"],)).fetchone()
            if conversation:
                try:
                    topics.append(self._topic(db, actor, conversation["id"]))
                except Refusal:
                    pass
        found = []
        for place in topics:
            # Each topic's newest messages only, through the (topic_id, seq)
            # index: the window bounds the read however long the topic is.
            rows = db.execute("SELECT m.seq,m.id,m.topic_id,m.author_id,m.sent_ms,m.attachments FROM "
                              "(SELECT m.seq,m.id,m.topic_id,m.author_id,m.sent_ms,m.attachments FROM messages m WHERE m.topic_id=:topic AND " + whispers.VISIBLE + " ORDER BY m.seq DESC LIMIT :window) m "
                              "WHERE m.attachments<>'[]' ORDER BY m.seq DESC",
                              {"topic": place["id"], "actor": actor, "window": IMAGE_WINDOW}).fetchall()
            for row in rows:
                # A held message's images are left out for agents, as its words are (docs/message-edit.md).
                if withheld(row["id"]):
                    continue
                for attachment in json.loads(row["attachments"]):
                    if attachment.get("inline") is True and attachment.get("content_type") in IMAGE_TYPES:
                        found.append((row["seq"], {"source_ref": {"kind": "message", "id": row["id"]}, "topic_id": row["topic_id"],
                                                   "author_id": row["author_id"], "sent_ms": row["sent_ms"], "attachment": attachment}))
        # One entry per image: the newest message that carries it.
        items, seen = [], set()
        for _, item in sorted(found, key=lambda pair: -pair[0]):
            if item["attachment"]["id"] in seen:
                continue
            seen.add(item["attachment"]["id"])
            items.append(item)
            if len(items) == limit:
                break
        return {"instance_id": self.instance_id, "topic_id": topic["id"], "items": items,
                "topics": [place["id"] for place in topics], "window": IMAGE_WINDOW}

    def _effective_reasons(self, db, delivery):
        rows = db.execute("SELECT r.reason,r.participant_epoch,p.active,p.epoch FROM delivery_reasons r LEFT JOIN topic_participants p ON p.topic_id=r.topic_id AND p.actor_id=? WHERE r.delivery_id=? ORDER BY r.reason", (delivery["recipient_id"], delivery["id"])).fetchall()
        return [r["reason"] for r in rows if r["reason"] != "subscription" or delivery["state"] != "pending" or (r["active"] and r["epoch"] == r["participant_epoch"])]

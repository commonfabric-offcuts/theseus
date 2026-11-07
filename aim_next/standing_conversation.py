from __future__ import annotations

"""An outcome's conversation: one topic of its own that never ends (docs/conversation.md).

Each outcome has one topic of kind `conversation`, for asking where things
stand and raising friction and requests. Its participants are exactly the
outcome's people plus its coordinator (`workspaces.coordinator_id`), so the
coordinator is woken by everything there, every person reads it, and any
other agent is woken only when a message names it.

Each thing someone posts there is an item (`conversation_items`).
What became of an item is written by Theseus itself, in the same act that
did it, as a take (`conversation_takes`): answered by its answerer's reply,
taken into a topic started from it, or put on the pipeline. A take settles
the item unless it took only part of it. An ask there waits on each person
it asks until that person replies to that ask (`conversation_waits`); the
topic's `topic_waiting` rows are kept in step with those, so attention, the
sidebar and the outcome light read waits as for any topic.
"""

import json
import re
import uuid

from .contract import READABLE, Refusal, _identifier, _revision
from .delivery import _now_ms


# Version 28: a topic's kind, the conversation a replaced topic gave way to,
# the message a post to the conversation is about, and the conversation's
# items, what became of each, and its open asks.
STANDING_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN kind TEXT NOT NULL DEFAULT 'topic' CHECK(kind IN ('topic','conversation'))",
    "CREATE UNIQUE INDEX outcome_conversation ON topics(workspace_id) WHERE kind = 'conversation'",
    # On a topic the conversation replaced when it started: that conversation's id.
    "ALTER TABLE topics ADD COLUMN replaced_by TEXT",
    # A message posted to the conversation from another topic names the message it is about.
    "ALTER TABLE messages ADD COLUMN about_id TEXT",
    # Each message in a conversation that is an item; settled is 1 once a take without part settles it.
    "CREATE TABLE conversation_items (message_id TEXT PRIMARY KEY REFERENCES messages(id), "
    "settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)))",
    "CREATE INDEX open_conversation_items ON conversation_items(message_id) WHERE settled = 0",
    # What became of an item: answered, taken into a topic, or put on the pipeline. Never changed or removed.
    "CREATE TABLE conversation_takes (id INTEGER PRIMARY KEY AUTOINCREMENT, "
    "item_id TEXT NOT NULL REFERENCES conversation_items(message_id), "
    "kind TEXT NOT NULL CHECK(kind IN ('answer','topic','pipeline')), ref TEXT NOT NULL, "
    "added INTEGER NOT NULL DEFAULT 0, part INTEGER NOT NULL DEFAULT 0, "
    "actor_id TEXT NOT NULL REFERENCES actors(id), at_ms INTEGER NOT NULL)",
    "CREATE INDEX item_takes ON conversation_takes(item_id,id)",
    "CREATE TRIGGER immutable_takes_update BEFORE UPDATE ON conversation_takes BEGIN SELECT RAISE(ABORT, 'immutable take'); END",
    "CREATE TRIGGER immutable_takes_delete BEFORE DELETE ON conversation_takes BEGIN SELECT RAISE(ABORT, 'immutable take'); END",
    # Each open ask in a conversation, per person asked; it goes when that person replies to that ask, or leaves.
    "CREATE TABLE conversation_waits (ask_id TEXT NOT NULL REFERENCES messages(id), "
    "actor_id TEXT NOT NULL REFERENCES actors(id), PRIMARY KEY(ask_id,actor_id))",
]
STANDING_DOWN = (
    "DROP TABLE conversation_waits",
    "DROP TRIGGER immutable_takes_delete", "DROP TRIGGER immutable_takes_update",
    "DROP INDEX item_takes", "DROP TABLE conversation_takes",
    "DROP INDEX open_conversation_items", "DROP TABLE conversation_items",
    "ALTER TABLE messages DROP COLUMN about_id",
    "ALTER TABLE topics DROP COLUMN replaced_by",
    "DROP INDEX outcome_conversation", "ALTER TABLE topics DROP COLUMN kind",
)
# Items, takes, waits, about links and replaced topics exist only with a conversation.
STANDING_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topics WHERE kind <> 'topic')"

TITLE = "Conversation"
REPLACED_NOTE = "Replaced by the conversation"
RULE = "CONVERSATION_RULE"
NEVER_ENDS = "A conversation never ends; topics do"
ITEMS_SAY = "In a conversation each item says where it stands. To wait on someone, ask them in a message"
FOLLOWS_TEAM = ("Who is in the conversation follows the team: its people and the coordinator. "
                "Name an agent in a message to have it answer that one")
NOT_THE_ANSWERER = "NOT_THE_ANSWERER"
EXCERPT_CHARS = 160
TAKE_KINDS = ("answer", "topic", "pipeline")

_LEADING_NAMES = re.compile(r"^(?:\s*@[\w.-]+[,:]?)+\s*")
_SENTENCE = re.compile(r"^(.+?[.?!])(?:\s|$)", re.S)


def excerpt(body):
    """The words a waiting line shows for an ask (I8): its first sentence without its leading
    @names, cut at 160 characters, on one line."""
    text = _LEADING_NAMES.sub("", body or "").strip()
    match = _SENTENCE.match(text)
    text = " ".join((match.group(1) if match else text).split())
    return text if len(text) <= EXCERPT_CHARS else text[:EXCERPT_CHARS - 1].rstrip() + "…"


def is_conversation(topic):
    return topic["kind"] == "conversation"


def partial(writing):
    """Whether writing (a post's args, a draft, a frozen snapshot or an opening) took only part of an item."""
    value = writing.get("part")
    if value is None:
        return False
    if not isinstance(value, bool):
        raise Refusal("INVALID_ARGUMENT", "part is true, false or null")
    return value


class StandingConversation:
    """The conversation's Core: who is in it, its items, takes and waits, its rules and views."""

    # Who is in it ------------------------------------------------------------

    def _conversation_of(self, db, workspace_id):
        return db.execute("SELECT t.*,w.owner_id,w.coordinator_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id "
                          "WHERE t.workspace_id=? AND t.kind='conversation'", (workspace_id,)).fetchone()

    def _sync_participants(self, db, workspace_id):
        """Make the conversation's participants exactly the team's people plus the coordinator.

        Whoever it drops has their subscription cancelled and their open asks
        there taken off; whoever it adds is a participant from now on. Returns
        the conversation row, or None when the outcome has none yet."""
        conversation = self._conversation_of(db, workspace_id)
        if conversation is None:
            return None
        wanted = {row[0] for row in db.execute(
            "SELECT m.actor_id FROM workspace_members m JOIN actors a ON a.id=m.actor_id WHERE m.workspace_id=? AND a.kind='human'",
            (workspace_id,))}
        if conversation["coordinator_id"] is not None:
            wanted.add(conversation["coordinator_id"])
        rows = {row["actor_id"]: row for row in db.execute(
            "SELECT actor_id,active,epoch FROM topic_participants WHERE topic_id=?", (conversation["id"],))}
        current = {actor for actor, row in rows.items() if row["active"]}
        changed = []
        for member in sorted(current - wanted):
            self._cancel_subscription(db, member, conversation["id"], rows[member]["epoch"])
            db.execute("UPDATE topic_participants SET active=0,epoch=epoch+1 WHERE topic_id=? AND actor_id=?", (conversation["id"], member))
            db.execute("DELETE FROM conversation_waits WHERE actor_id=? AND ask_id IN (SELECT id FROM messages WHERE topic_id=?)",
                       (member, conversation["id"]))
            changed.append(member)
        for member in sorted(wanted - current):
            if member in rows:
                db.execute("UPDATE topic_participants SET active=1,epoch=epoch+1 WHERE topic_id=? AND actor_id=?", (conversation["id"], member))
            else:
                db.execute("INSERT INTO topic_participants(topic_id,actor_id,active,epoch) VALUES (?,?,1,1)", (conversation["id"], member))
            changed.append(member)
        if changed:
            self._sync_waits(db, conversation, changed)
            # The act that changed the team or the coordinator advances the outcome's own version.
            version = conversation["version"] + 1
            db.execute("UPDATE topics SET version=? WHERE id=?", (version, conversation["id"]))
            self._change(db, "topic", conversation["id"], "topic", conversation["id"], version)
            self._change(db, "workspace", workspace_id, "topic", conversation["id"], version)
            for member in changed:
                self._change(db, "actor", member, "participation", conversation["id"], version)
            conversation = self._conversation_of(db, workspace_id)
        return conversation

    def _start_conversation(self, db, workspace_id, replaces, by):
        """Start the outcome's conversation, closing each replaced topic (Done, archived, readable).

        by is who closes them, or None for the operator. The caller advances the
        workspace's version. Returns the conversation's topic id."""
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if workspace is None:
            raise Refusal("FORBIDDEN", "No permission for this workspace")
        if self._conversation_of(db, workspace_id) is not None:
            raise Refusal("CONVERSATION_EXISTS", "This outcome already has its conversation")
        topic_id = "t-" + uuid.uuid4().hex
        now = _now_ms()
        db.execute("INSERT INTO topics(id,workspace_id,title,creator_id,version,kind,activity_ms) VALUES (?,?,?,?,0,'conversation',?)",
                   (topic_id, workspace_id, TITLE, workspace["owner_id"], now))
        db.execute("INSERT INTO topic_summaries(topic_id,message_count,latest_message_id) VALUES (?,0,NULL)", (topic_id,))
        self._sync_participants(db, workspace_id)
        for replaced in replaces:
            topic = db.execute("SELECT t.*,w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?",
                               (_identifier(replaced, "replaced topic"),)).fetchone()
            if topic is None or topic["workspace_id"] != workspace_id or topic["kind"] != "topic":
                raise Refusal("INVALID_ARGUMENT", "A replaced topic is an ordinary topic of the same outcome: %s" % replaced)
            db.execute("UPDATE topics SET state='done',state_note=?,state_by=?,state_ms=?,state_message_id=NULL,archived=1,replaced_by=?,"
                       "activity_ms=max(activity_ms,?) WHERE id=?", (REPLACED_NOTE, by, now, topic_id, now, topic["id"]))
            waiting = [row[0] for row in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=?", (topic["id"],))]
            db.execute("DELETE FROM topic_waiting WHERE topic_id=?", (topic["id"],))
            version = self._touch_topic(db, topic)
            for member in waiting:
                self._change(db, "actor", member, "waiting", topic["id"], version)
        return topic_id

    def start_conversation(self, workspace_id, coordinator=None, replaces=()):
        """Operator act (aim-next-admin conversation-start): start an older outcome's conversation."""
        _identifier(workspace_id, "outcome")
        found = {}

        def write(db):
            if db.execute("SELECT 1 FROM workspaces WHERE id=?", (workspace_id,)).fetchone() is None:
                raise Refusal("INVALID_ARGUMENT", "No outcome %s in this instance" % workspace_id)
            if coordinator is not None:
                if not db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace_id, coordinator)).fetchone():
                    raise Refusal("INVALID_RECIPIENT", "The coordinator must belong to the outcome's team")
                db.execute("UPDATE workspaces SET coordinator_id=? WHERE id=?", (coordinator, workspace_id))
            found["topic_id"] = self._start_conversation(db, workspace_id, list(replaces), None)
            db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (workspace_id,))
            version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0]
            # Open outcome and topic pages learn who coordinates now.
            self._outcome_change(db, workspace_id, version)
            return True
        self._operator_write(write, "started", "conversation start")
        return {"instance_id": self.instance_id, "workspace_id": workspace_id, "conversation_id": found["topic_id"]}

    def _command_workspace_coordinator_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"actor_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome and its coordinator, or null for nobody")
        workspace = self._workspace(db, actor, target["workspace_id"])
        # Only the owner chooses who answers in the conversation; organising it is not enough.
        if workspace["owner_id"] != actor:
            raise Refusal("FORBIDDEN", "Only the outcome's owner chooses its coordinator")
        _revision(envelope.get("expected", {}), "workspace_revision", workspace["version"])
        chosen = args["actor_id"]
        if chosen is not None:
            _identifier(chosen, "actor_id")
            if not db.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND actor_id=?", (workspace["id"], chosen)).fetchone():
                raise Refusal("INVALID_RECIPIENT", "The coordinator must belong to the outcome's team")
        result = {"workspace_id": workspace["id"], "coordinator_id": chosen, "version": workspace["version"]}
        if chosen == workspace["coordinator_id"]:
            return result, []
        db.execute("UPDATE workspaces SET coordinator_id=?,version=version+1 WHERE id=?", (chosen, workspace["id"]))
        self._sync_participants(db, workspace["id"])
        version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace["id"],)).fetchone()[0]
        # Open outcome and topic pages learn who coordinates now (Store._outcome_change).
        self._outcome_change(db, workspace["id"], version)
        return dict(result, version=version), [{"kind": "workspace", "id": workspace["id"], "version": version}]

    # Rules -------------------------------------------------------------------

    def _conversation_update_refused(self, topic, args):
        if not is_conversation(topic):
            return
        if args.keys() & {"title", "archived"} or args.get("state") == "done":
            raise Refusal(RULE, NEVER_ENDS)
        raise Refusal(RULE, ITEMS_SAY)

    def _conversation_participation_refused(self, topic):
        if is_conversation(topic):
            raise Refusal(RULE, FOLLOWS_TEAM)

    def _answerers(self, db, item_id):
        """Who answers an item: the agents it names, else the coordinator (D6, I10)."""
        row = db.execute("SELECT m.addressees,w.coordinator_id FROM messages m JOIN topics t ON t.id=m.topic_id "
                         "JOIN workspaces w ON w.id=t.workspace_id WHERE m.id=?", (item_id,)).fetchone()
        named = [name for name in json.loads(row["addressees"])
                 if (db.execute("SELECT kind FROM actors WHERE id=?", (name,)).fetchone() or {"kind": None})["kind"] == "agent"]
        if named:
            return named
        return [row["coordinator_id"]] if row["coordinator_id"] is not None else []

    def _item(self, db, message_id):
        return db.execute("SELECT * FROM conversation_items WHERE message_id=?", (message_id,)).fetchone()

    def _conversation_check_publish(self, db, actor, topic, snapshot, parent_id, private):
        """Refuse, in a conversation, an agent's reply to an item it does not answer; refuse part outside a take."""
        part = partial(snapshot)
        if not is_conversation(topic) or private is not None:
            if part:
                raise Refusal("INVALID_ARGUMENT", "part is only for an answer to part of an item in a conversation")
            return
        item = self._item(db, parent_id) if parent_id else None
        if item is not None and self._actor(db, actor)["kind"] == "agent":
            answerers = self._answerers(db, parent_id)
            if actor not in answerers:
                raise Refusal(NOT_THE_ANSWERER, "%s answers this one; you answer here only when you are named" % (
                    " or ".join(answerers) if answerers else "Nobody yet"))
        if part and (item is None or actor not in self._answerers(db, parent_id)):
            raise Refusal("INVALID_ARGUMENT", "part is only for an answer to part of an item in a conversation")

    # Items, takes and waits ---------------------------------------------------

    def _record_take(self, db, item_id, kind, ref, actor, part=False, added=False):
        """Write what became of an item, in the act that did it; nothing when the message is not an item.

        A take settles the item unless it took only part of it. The
        conversation is touched so its readers see the new line."""
        if kind not in TAKE_KINDS:
            raise Refusal("INVALID_ARGUMENT", "A take answers, takes into a topic or puts on the pipeline")
        if self._item(db, item_id) is None:
            return False
        db.execute("INSERT INTO conversation_takes(item_id,kind,ref,added,part,actor_id,at_ms) VALUES (?,?,?,?,?,?,?)",
                   (item_id, kind, ref if isinstance(ref, str) else json.dumps(ref), int(bool(added)), int(bool(part)), actor, _now_ms()))
        if not part:
            db.execute("UPDATE conversation_items SET settled=1 WHERE message_id=?", (item_id,))
        return True

    def _take_from_topic(self, db, actor, source_message_id, topic_id, part):
        """A topic started from a message (48): when that message is a conversation item, say so under it."""
        if self._record_take(db, source_message_id, "topic", topic_id, actor, part=part):
            conversation = db.execute("SELECT t.*,w.owner_id FROM messages m JOIN topics t ON t.id=m.topic_id "
                                      "JOIN workspaces w ON w.id=t.workspace_id WHERE m.id=?", (source_message_id,)).fetchone()
            self._touch_topic(db, conversation)

    def _conversation_record(self, db, actor, topic, message_id, snapshot, intent):
        """After a message on the record lands in a conversation: its item, its answer take, and its waits."""
        parent_id = snapshot.get("reply_to")
        addressees = snapshot["addressees"]
        coordinator = db.execute("SELECT coordinator_id FROM workspaces WHERE id=?", (topic["workspace_id"],)).fetchone()[0]
        parent_item = self._item(db, parent_id) if parent_id else None
        answering = parent_item is not None and actor in self._answerers(db, parent_id)
        answers_ask = parent_id is not None and db.execute(
            "SELECT 1 FROM conversation_waits WHERE ask_id=? AND actor_id=?", (parent_id, actor)).fetchone() is not None
        if actor != coordinator and not answering and not answers_ask:
            db.execute("INSERT INTO conversation_items(message_id) VALUES (?)", (message_id,))
        if answering:
            parent_author = db.execute("SELECT author_id FROM messages WHERE id=?", (parent_id,)).fetchone()[0]
            # An ask back to the item's author waits on them; it does not answer the item.
            if not (intent == "ask" and parent_author in addressees):
                self._record_take(db, parent_id, "answer", message_id, actor, part=partial(snapshot))
        touched = []
        if answers_ask:
            db.execute("DELETE FROM conversation_waits WHERE ask_id=? AND actor_id=?", (parent_id, actor))
            touched.append(actor)
        if intent == "ask":
            for member in addressees:
                if member != actor:
                    db.execute("INSERT OR IGNORE INTO conversation_waits(ask_id,actor_id) VALUES (?,?)", (message_id, member))
                    touched.append(member)
        self._sync_waits(db, topic, touched)
        return touched

    def _sync_waits(self, db, conversation, actors):
        """Keep the conversation's topic_waiting rows in step with its open asks, for these actors."""
        for member in dict.fromkeys(actors):
            oldest = db.execute("SELECT m.id,m.sent_ms FROM conversation_waits q JOIN messages m ON m.id=q.ask_id "
                                "WHERE q.actor_id=? AND m.topic_id=? ORDER BY m.seq LIMIT 1", (member, conversation["id"])).fetchone()
            if oldest is None:
                db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (conversation["id"], member))
            else:
                db.execute("INSERT INTO topic_waiting(topic_id,actor_id,state_ms,archived,said,ask_message_id) VALUES (?,?,?,?,0,?) "
                           "ON CONFLICT(topic_id,actor_id) DO UPDATE SET said=0,state_ms=excluded.state_ms,ask_message_id=excluded.ask_message_id",
                           (conversation["id"], member, oldest["sent_ms"], conversation["archived"], oldest["id"]))

    # Views -------------------------------------------------------------------

    def _conversation_waits(self, db, topic_id):
        rows = db.execute("SELECT q.ask_id,q.actor_id,m.author_id,m.sent_ms,m.body,m.reply_to FROM conversation_waits q "
                          "JOIN messages m ON m.id=q.ask_id WHERE m.topic_id=? ORDER BY m.seq,q.actor_id", (topic_id,)).fetchall()
        waits = []
        for row in rows:
            item = row["reply_to"] if row["reply_to"] is not None and self._item(db, row["reply_to"]) is not None else None
            waits.append({"ask_message_id": row["ask_id"], "on": row["actor_id"], "by": row["author_id"],
                          "since_ms": row["sent_ms"], "item_id": item, "excerpt": excerpt(row["body"])})
        return waits

    def _view_conversation(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        conversation = self._conversation_of(db, workspace["id"])
        answer = {"instance_id": self.instance_id, "conversation": None,
                  "relevant_versions": {"workspace": workspace["version"]}}
        if conversation is None:
            return answer
        coordinator = None
        if conversation["coordinator_id"] is not None:
            kind = db.execute("SELECT kind FROM actors WHERE id=?", (conversation["coordinator_id"],)).fetchone()
            coordinator = {"actor_id": conversation["coordinator_id"], "kind": kind["kind"] if kind else None}
        new_items = db.execute("SELECT count(*) FROM conversation_items c INDEXED BY open_conversation_items "
                               "JOIN messages m ON m.id=c.message_id WHERE c.settled=0 AND m.topic_id=?", (conversation["id"],)).fetchone()[0]
        unread, addressed = self._unread(db, actor, topics=[conversation["id"]]).get(conversation["id"], (0, 0, None))[:2]
        from .work import work_by_topic
        waits = self._waits_by_topic(db, [conversation["id"]])
        replaced = [{"topic_id": row["id"], "title": row["title"]} for row in db.execute(
            "SELECT id,title FROM topics WHERE workspace_id=? AND replaced_by=? ORDER BY id", (workspace["id"], conversation["id"]))]
        answer["conversation"] = {
            "topic_id": conversation["id"], "version": conversation["version"], "coordinator": coordinator,
            "new_items": new_items, "unread": unread, "addressed": addressed,
            "waits": self._conversation_waits(db, conversation["id"]),
            "work": work_by_topic(db, waits, actor)[conversation["id"]],
            "replaced": replaced, "live": None}
        return answer

    def _item_fields(self, db, actor, topic, items):
        """Add `about` to every message item, and `item` on a conversation's, for one page."""
        ids = [item["id"] for item in items]
        about = {}
        if ids:
            marks = ",".join("?" * len(ids))
            about = {row[0]: row[1] for row in db.execute("SELECT id,about_id FROM messages WHERE id IN (%s) AND about_id IS NOT NULL" % marks, ids)}
        for item in items:
            item["about"] = self._about(db, actor, about[item["id"]]) if item["id"] in about else None
        if not is_conversation(topic):
            return
        states, takes = {}, {}
        if ids:
            marks = ",".join("?" * len(ids))
            states = {row[0]: row[1] for row in db.execute("SELECT message_id,settled FROM conversation_items WHERE message_id IN (%s)" % marks, ids)}
            for row in db.execute("SELECT * FROM conversation_takes INDEXED BY item_takes WHERE item_id IN (%s) ORDER BY item_id,id" % marks, ids):
                takes.setdefault(row["item_id"], []).append(self._take(db, actor, row))
        for item in items:
            item["item"] = None if item["id"] not in states else {
                "state": "settled" if states[item["id"]] else "new", "takes": _joined(takes.get(item["id"], []))}

    def _take(self, db, actor, row):
        take = {"kind": row["kind"], "actor_id": row["actor_id"], "at_ms": row["at_ms"], "part": bool(row["part"])}
        if row["kind"] == "pipeline":
            return dict(take, numbers=json.loads(row["ref"]), added=bool(row["added"]))
        if row["kind"] == "topic":
            topic = db.execute("SELECT t.id,t.title FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=:topic AND " + READABLE,
                               {"topic": row["ref"], "actor": actor}).fetchone()
            return dict(take, ref=row["ref"], title=topic["title"] if topic else None, readable=topic is not None)
        return dict(take, ref=row["ref"])

    def _about(self, db, actor, message_id):
        try:
            row = self._message_access(db, actor, message_id)
        except Refusal:
            return {"hidden": True}
        topic = db.execute("SELECT title FROM topics WHERE id=?", (row["topic_id"],)).fetchone()
        return {"message_id": row["id"], "topic_id": row["topic_id"], "topic_title": topic["title"], "author_id": row["author_id"]}


def _joined(takes):
    """One line for consecutive pipeline takes by one actor with the same `added`, with the first take's time."""
    lines = []
    for take in takes:
        last = lines[-1] if lines else None
        if (take["kind"] == "pipeline" and last is not None and last["kind"] == "pipeline"
                and last["actor_id"] == take["actor_id"] and last["added"] == take["added"] and last["part"] == take["part"]):
            last["numbers"] = last["numbers"] + [n for n in take["numbers"] if n not in last["numbers"]]
            continue
        lines.append(dict(take))
    return lines


def open_items_clause():
    """The topic_messages restriction to items not yet settled (items: "open")."""
    return " AND EXISTS (SELECT 1 FROM conversation_items c WHERE c.message_id=m.id AND c.settled=0)"


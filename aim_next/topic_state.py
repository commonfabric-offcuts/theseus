from __future__ import annotations

"""Where a topic stands: its state, a short note, and who it waits on.

People and agents who work in a topic say where it stands, so the person
running an outcome can see at a glance what is moving, what waits on them,
what is ready for their review and what is finished. Renaming a topic and
archiving it, which takes it out of the outcome's list without changing
where it stands, stay with the outcome's owner and the topic's creator.

A topic waits on someone for either of two reasons, kept on one row per
topic and person in topic_waiting: someone said so (`said`, the topic's
state is waiting and names them), or a message asked them and they have not
written in the topic since (`ask_message_id`, the oldest such ask). The row
lives while either reason holds; its order time is the state's time while
it is said, else the ask's.
"""

from .contract import LIMITS, READABLE, Refusal, _body, _identifier, _prefix, _revision
from .delivery import _now_ms


STATES = ("active", "waiting", "review", "done")
NOTE_UTF8_BYTES = 1024

TOPIC_STATE_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','waiting','review','done'))",
    "ALTER TABLE topics ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))",
    "ALTER TABLE topics ADD COLUMN state_note TEXT NOT NULL DEFAULT ''",
    # Who last said where the topic stands, and when (milliseconds since the epoch).
    "ALTER TABLE topics ADD COLUMN state_by TEXT REFERENCES actors(id)",
    "ALTER TABLE topics ADD COLUMN state_ms INTEGER",
    "CREATE INDEX workspace_listed_topics ON topics(workspace_id,archived,id)",
    # Present only while the topic is waiting.
    "CREATE TABLE topic_waiting (topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), PRIMARY KEY(topic_id,actor_id))",
    "CREATE INDEX actor_waiting ON topic_waiting(actor_id,topic_id)",
]
TOPIC_STATE_DOWN = ("DROP TABLE topic_waiting", "DROP INDEX workspace_listed_topics",
                    "ALTER TABLE topics DROP COLUMN state_ms", "ALTER TABLE topics DROP COLUMN state_by",
                    "ALTER TABLE topics DROP COLUMN state_note", "ALTER TABLE topics DROP COLUMN archived",
                    "ALTER TABLE topics DROP COLUMN state")
TOPIC_STATE_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM topics WHERE state!='active' OR archived!=0 OR state_note!='' OR state_by IS NOT NULL) "
                        "OR EXISTS (SELECT 1 FROM topic_waiting)")

# Version 12: each waiting row copies its topic's state time and archive flag, so what
# waits on a reader is counted and listed, newest first, from one index. Rows exist only
# while the topic waits and only for someone who can read it (topic.update and _unwait
# keep that true), so the read needs no per-row check. The upgrade drops rows left by
# earlier code for someone who had already lost the topic.
WAITING_ORDER_SCHEMA = [
    "ALTER TABLE topic_waiting ADD COLUMN state_ms INTEGER",
    "ALTER TABLE topic_waiting ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))",
    "UPDATE topic_waiting SET state_ms=(SELECT t.state_ms FROM topics t WHERE t.id=topic_waiting.topic_id),"
    "archived=(SELECT t.archived FROM topics t WHERE t.id=topic_waiting.topic_id)",
    "DELETE FROM topic_waiting WHERE NOT EXISTS (SELECT 1 FROM topics t JOIN workspaces w ON w.id=t.workspace_id "
    "WHERE t.id=topic_waiting.topic_id AND " + READABLE.replace(":actor", "topic_waiting.actor_id") + ")",
    "DROP INDEX actor_waiting",
    "CREATE INDEX reader_waiting ON topic_waiting(actor_id,archived,state_ms DESC,topic_id)",
]
WAITING_ORDER_DOWN = ("DROP INDEX reader_waiting", "CREATE INDEX actor_waiting ON topic_waiting(actor_id,topic_id)",
                      "ALTER TABLE topic_waiting DROP COLUMN archived", "ALTER TABLE topic_waiting DROP COLUMN state_ms")

# Version 14: an asking message makes its topic wait on each person it asks,
# on the same row as a wait someone said, until that person writes in the topic.
# Rows from before were all said.
ASK_WAIT_SCHEMA = [
    "ALTER TABLE topic_waiting ADD COLUMN said INTEGER NOT NULL DEFAULT 1 CHECK(said IN (0,1))",
    "ALTER TABLE topic_waiting ADD COLUMN ask_message_id TEXT REFERENCES messages(id)",
]
ASK_WAIT_DOWN = ("ALTER TABLE topic_waiting DROP COLUMN ask_message_id", "ALTER TABLE topic_waiting DROP COLUMN said")
ASK_WAIT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topic_waiting WHERE said=0 OR ask_message_id IS NOT NULL)"

# Version 18 orders each outcome's topics by activity. A topic's activity time is
# the later of its newest message and the last time someone said where it stands
# (any topic.update of its state, note or waiting list); a rename or an archive is
# not activity. It is kept on the topic in the same act that sends the message or
# changes the state, so an outcome's topics are listed newest first from one index,
# whatever their history. The upgrade works it out from the newest message's send
# time and the state's time; a topic with neither has 0. Done topics are listed
# apart, so the index keys on whether a topic is done. state_message_id names the
# message that reopened a done topic, null for a state someone said.
ACTIVITY_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN activity_ms INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE topics ADD COLUMN state_message_id TEXT REFERENCES messages(id)",
    "UPDATE topics SET activity_ms=max(coalesce(state_ms,0),coalesce((SELECT m.sent_ms FROM topic_summaries s "
    "JOIN messages m ON m.id=s.latest_message_id WHERE s.topic_id=topics.id),0))",
    "DROP INDEX workspace_listed_topics",
    "CREATE INDEX workspace_topic_order ON topics(workspace_id,archived,state='done',activity_ms DESC,id DESC)",
]
ACTIVITY_DOWN = ("DROP INDEX workspace_topic_order", "CREATE INDEX workspace_listed_topics ON topics(workspace_id,archived,id)",
                 "ALTER TABLE topics DROP COLUMN state_message_id", "ALTER TABLE topics DROP COLUMN activity_ms")
# Activity times are worked out again on the next upgrade; who reopened a topic is not.
ACTIVITY_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topics WHERE state_message_id IS NOT NULL)"
# A message in a done topic makes it active again; the state's note says so.
REOPENED_NOTE = "Reopened by a new message"


def order_cursor(done, activity_ms, topic_id):
    """The position of a topic in its outcome's list: "DONE:ACTIVITY_MS:ID"."""
    return "%d:%d:%s" % (int(bool(done)), activity_ms, topic_id)


def order_position(cursor):
    """(done, activity_ms, topic_id) from a cursor order_cursor wrote; anything else is refused."""
    parts = cursor.split(":", 2) if isinstance(cursor, str) else ()
    if (len(parts) != 3 or parts[0] not in ("0", "1") or not parts[1].isascii() or not parts[1].isdigit()
            or len(parts[1]) > 18 or (len(parts[1]) > 1 and parts[1][0] == "0")):
        raise Refusal("INVALID_ARGUMENT", "Invalid topic list cursor")
    return int(parts[0]), int(parts[1]), _identifier(parts[2], "cursor")


class TopicState:
    def _command_topic_update(self, db, actor, envelope):
        target = envelope.get("target", {})
        if set(target) != {"topic_id"}:
            raise Refusal("INVALID_ARGUMENT", "A topic update names only its topic")
        topic = self._topic(db, actor, target["topic_id"])
        _revision(envelope.get("expected", {}), "topic_revision", topic["version"])
        args = envelope.get("args", {})
        if not args or not set(args) <= {"title", "archived", "state", "note", "waiting_on"}:
            raise Refusal("INVALID_ARGUMENT", "A topic update changes its title, whether it is archived, its state, note or who it waits on")
        manager = actor in (topic["owner_id"], topic["creator_id"])
        if "title" in args:
            if not manager:
                raise Refusal("FORBIDDEN", "Only the outcome's owner or the topic's creator can rename it")
            title = _body(args["title"])
            if not title.strip():
                raise Refusal("EMPTY_TITLE", "A topic needs a title")
            db.execute("UPDATE topics SET title=? WHERE id=?", (title, topic["id"]))
        if "archived" in args:
            if not manager:
                raise Refusal("FORBIDDEN", "Only the outcome's owner or the topic's creator can archive it")
            if not isinstance(args["archived"], bool):
                raise Refusal("INVALID_ARGUMENT", "Archived is true or false")
            db.execute("UPDATE topics SET archived=? WHERE id=?", (int(args["archived"]), topic["id"]))
            db.execute("UPDATE topic_waiting SET archived=? WHERE topic_id=?", (int(args["archived"]), topic["id"]))
        old_waiting = [row[0] for row in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=? AND said=1 ORDER BY actor_id", (topic["id"],))]
        if args.keys() & {"state", "note", "waiting_on"}:
            if not manager and not db.execute("SELECT 1 FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1",
                                              (topic["id"], actor)).fetchone():
                raise Refusal("FORBIDDEN", "Only the topic's participants, its creator or the outcome's owner can say where it stands")
            state = args.get("state", topic["state"])
            if state not in STATES:
                raise Refusal("INVALID_ARGUMENT", "A topic's state is one of: " + ", ".join(STATES))
            # A new state starts with its own note unless one is given; so does
            # any word after a reopen, whose note was the message's, not said.
            said = state == topic["state"] and topic["state_message_id"] is None
            note = args.get("note", topic["state_note"] if said else "")
            note = _body(note)
            if len(note.encode("utf-8")) > NOTE_UTF8_BYTES:
                raise Refusal("BODY_TOO_LARGE", "A state note is at most %d bytes" % NOTE_UTF8_BYTES)
            waiting = args.get("waiting_on", old_waiting if state == "waiting" else [])
            if state != "waiting" and waiting:
                raise Refusal("INVALID_ARGUMENT", "Only a waiting topic waits on someone")
            waiting = self._waiting_on(db, topic, waiting)
            now = _now_ms()
            db.execute("UPDATE topics SET state=?,state_note=?,state_by=?,state_ms=?,state_message_id=NULL,activity_ms=max(activity_ms,?) WHERE id=?",
                       (state, note, actor, now, now, topic["id"]))
            # Only what was said changes here: a row an open ask still holds stays, ordered by its ask.
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND ask_message_id IS NULL", (topic["id"],))
            db.execute("UPDATE topic_waiting SET said=0,state_ms=(SELECT m.sent_ms FROM messages m WHERE m.id=ask_message_id) WHERE topic_id=?",
                       (topic["id"],))
            db.executemany("INSERT INTO topic_waiting(topic_id,actor_id,state_ms,archived,said) SELECT id,?,state_ms,archived,1 FROM topics WHERE id=? "
                           "ON CONFLICT(topic_id,actor_id) DO UPDATE SET said=1,state_ms=excluded.state_ms",
                           [(member, topic["id"]) for member in waiting])
        else:
            waiting = old_waiting
        version = self._touch_topic(db, topic)
        # Whoever the topic stopped or started waiting on learns of it in their own scope.
        for member in sorted(set(old_waiting) | set(waiting)):
            self._change(db, "actor", member, "waiting", topic["id"], version)
        row = db.execute("SELECT title,archived,state,state_note,state_by,state_ms FROM topics WHERE id=?", (topic["id"],)).fetchone()
        return {"topic_id": topic["id"], "version": version, "title": row["title"], "archived": bool(row["archived"]), "state": row["state"],
                "note": row["state_note"], "waiting_on": waiting, "state_by": row["state_by"], "state_ms": row["state_ms"]}, [
                    {"kind": "topic", "id": topic["id"], "version": version}]

    def _message_activity(self, db, topic, author, message_id, sent_ms):
        """A message was sent in the topic: it is the topic's latest activity, and a done
        topic is active again, said by the message's author when it was sent, with the
        message as why. The caller's transaction is the send's own."""
        if topic["state"] == "done":
            db.execute("UPDATE topics SET state='active',state_note=?,state_by=?,state_ms=?,state_message_id=? WHERE id=?",
                       (REOPENED_NOTE, author, sent_ms, message_id, topic["id"]))
        db.execute("UPDATE topics SET activity_ms=max(activity_ms,?) WHERE id=?", (sent_ms, topic["id"]))

    def _waiting_on(self, db, topic, members):
        # The limit bounds the list as sent, before any name is looked up, as for addressees.
        if isinstance(members, list) and len(members) > LIMITS["recipients"]:
            raise Refusal("TOO_MANY_RECIPIENTS", "A topic waits on at most %d people or agents" % LIMITS["recipients"])
        members = self._recipients(db, members, require_enabled=False)
        for member in members:
            if not db.execute("SELECT 1 FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=:topic AND " + READABLE,
                              {"topic": topic["id"], "actor": member}).fetchone():
                raise Refusal("INVALID_RECIPIENT", "%s cannot read this topic, so it cannot wait on them" % member)
        return sorted(members)

    def _unwait(self, db, member, scope, scope_id):
        """Take member off the waiting list of each topic they can no longer read, among
        the topics whose `scope` ("id" or "workspace_id") is scope_id; return those topics.

        Every command that takes away read access calls this, so a topic waits only on
        someone who can read it. The caller touches each returned topic."""
        topics = db.execute("SELECT t.*,w.owner_id FROM topic_waiting q JOIN topics t ON t.id=q.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                            "WHERE q.actor_id=:actor AND t." + scope + "=:scope AND NOT " + READABLE,
                            {"actor": member, "scope": scope_id}).fetchall()
        db.executemany("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", [(topic["id"], member) for topic in topics])
        return topics

    def _ask(self, db, topic, author, message_id, sent_ms, asked):
        """Make the topic wait on each person a message asks; return those it newly waits on.

        A person already asked keeps their oldest open ask, so the wait shows how
        long they have been waited on. The message reached each of them, so each
        can read the topic."""
        newly = []
        for member in asked:
            if member == author:
                continue
            if db.execute("INSERT INTO topic_waiting(topic_id,actor_id,state_ms,archived,said,ask_message_id) VALUES (?,?,?,?,0,?) "
                          "ON CONFLICT(topic_id,actor_id) DO UPDATE SET ask_message_id=excluded.ask_message_id WHERE ask_message_id IS NULL",
                          (topic["id"], member, sent_ms, topic["archived"], message_id)).rowcount:
                newly.append(member)
        return newly

    def _answered(self, db, topic_id, author):
        """Writing in a topic answers every ask there that waits on its author; whether one did.

        A wait someone said stays until it is said otherwise."""
        row = db.execute("SELECT said FROM topic_waiting WHERE topic_id=? AND actor_id=? AND ask_message_id IS NOT NULL",
                         (topic_id, author)).fetchone()
        if row is None:
            return False
        if row["said"]:
            db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (topic_id, author))
        else:
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic_id, author))
        return True

    def _waits_by_topic(self, db, topic_ids):
        """{topic_id: (waiting_on, asks)} for the given topics: who the topic was said to wait
        on, and each open ask, {actor_id, message_id, by, since_ms}, both in actor order."""
        waits = {topic_id: ([], []) for topic_id in topic_ids}
        if topic_ids:
            marks = ",".join("?" * len(topic_ids))
            for row in db.execute("SELECT q.topic_id,q.actor_id,q.said,q.ask_message_id,m.author_id,m.sent_ms FROM topic_waiting q "
                                  "LEFT JOIN messages m ON m.id=q.ask_message_id WHERE q.topic_id IN (%s) ORDER BY q.topic_id,q.actor_id" % marks,
                                  list(topic_ids)):
                said, asks = waits[row["topic_id"]]
                if row["said"]:
                    said.append(row["actor_id"])
                if row["ask_message_id"] is not None:
                    asks.append({"actor_id": row["actor_id"], "message_id": row["ask_message_id"],
                                 "by": row["author_id"], "since_ms": row["sent_ms"]})
        return waits

    def _waiting_on_reader(self, db, actor, limit=5):
        """(count, newest first) of the topics that wait on this reader, archived ones left out.

        The count walks the reader's rows in a covering index; the list reads the
        newest few in that index's order."""
        count = db.execute("SELECT count(*) FROM topic_waiting INDEXED BY reader_waiting WHERE actor_id=? AND archived=0",
                           (actor,)).fetchone()[0]
        rows = db.execute("SELECT t.id,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,t.state_note,t.state_by,t.state_ms,"
                          "q.said,q.ask_message_id,m.author_id AS asked_by,m.sent_ms AS asked_ms "
                          "FROM topic_waiting q INDEXED BY reader_waiting CROSS JOIN topics t ON t.id=q.topic_id "
                          "LEFT JOIN messages m ON m.id=q.ask_message_id "
                          "WHERE q.actor_id=? AND q.archived=0 ORDER BY q.state_ms DESC,q.topic_id LIMIT ?", (actor, limit)).fetchall()
        items = []
        for row in rows:
            title, truncated = _prefix(row["title_prefix"])
            ask = None if row["ask_message_id"] is None else {"message_id": row["ask_message_id"], "by": row["asked_by"], "since_ms": row["asked_ms"]}
            items.append({"id": row["id"], "title": title, "title_truncated": truncated,
                          "note": row["state_note"], "state_by": row["state_by"], "state_ms": row["state_ms"],
                          "said": bool(row["said"]), "ask": ask})
        return count, items

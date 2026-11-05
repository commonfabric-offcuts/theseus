from __future__ import annotations

"""Where a topic stands: its state, a short note, and who it waits on.

People and agents who work in a topic say where it stands, so the person
running an outcome can see at a glance what is moving, what waits on them,
what is ready for their review and what is finished. Renaming a topic and
archiving it, which takes it out of the outcome's list without changing
where it stands, stay with the outcome's owner and the topic's creator.
"""

from .contract import LIMITS, Refusal, _body, _prefix, _revision
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

# A reader can see a topic as its outcome's owner or member, its creator, or an active participant.
READABLE = ("(w.owner_id=:actor OR t.creator_id=:actor "
            "OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id=t.workspace_id AND m.actor_id=:actor) "
            "OR EXISTS (SELECT 1 FROM topic_participants p WHERE p.topic_id=t.id AND p.actor_id=:actor AND p.active=1))")


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
        old_waiting = [row[0] for row in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=? ORDER BY actor_id", (topic["id"],))]
        if args.keys() & {"state", "note", "waiting_on"}:
            if not manager and not db.execute("SELECT 1 FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1",
                                              (topic["id"], actor)).fetchone():
                raise Refusal("FORBIDDEN", "Only the topic's participants, its creator or the outcome's owner can say where it stands")
            state = args.get("state", topic["state"])
            if state not in STATES:
                raise Refusal("INVALID_ARGUMENT", "A topic's state is one of: " + ", ".join(STATES))
            # A new state starts with its own note unless one is given.
            note = args.get("note", topic["state_note"] if state == topic["state"] else "")
            note = _body(note)
            if len(note.encode("utf-8")) > NOTE_UTF8_BYTES:
                raise Refusal("BODY_TOO_LARGE", "A state note is at most %d bytes" % NOTE_UTF8_BYTES)
            waiting = args.get("waiting_on", old_waiting if state == "waiting" else [])
            if state != "waiting" and waiting:
                raise Refusal("INVALID_ARGUMENT", "Only a waiting topic waits on someone")
            waiting = self._waiting_on(db, topic, waiting)
            db.execute("UPDATE topics SET state=?,state_note=?,state_by=?,state_ms=? WHERE id=?",
                       (state, note, actor, _now_ms(), topic["id"]))
            db.execute("DELETE FROM topic_waiting WHERE topic_id=?", (topic["id"],))
            db.executemany("INSERT INTO topic_waiting VALUES (?,?)", [(topic["id"], member) for member in waiting])
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

    def _waiting_on(self, db, topic, members):
        members = self._recipients(db, members, require_enabled=False)
        if len(members) > LIMITS["recipients"]:
            raise Refusal("TOO_MANY_RECIPIENTS", "A topic waits on at most %d people or agents" % LIMITS["recipients"])
        for member in members:
            if not db.execute("SELECT 1 FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=:topic AND " + READABLE,
                              {"topic": topic["id"], "actor": member}).fetchone():
                raise Refusal("INVALID_RECIPIENT", "%s cannot read this topic, so it cannot wait on them" % member)
        return sorted(members)

    def _waiting_by_topic(self, db, topic_ids):
        """{topic_id: [actor_id, ...]} for the given topics."""
        waiting = {topic_id: [] for topic_id in topic_ids}
        if topic_ids:
            marks = ",".join("?" * len(topic_ids))
            for row in db.execute("SELECT topic_id,actor_id FROM topic_waiting WHERE topic_id IN (%s) ORDER BY topic_id,actor_id" % marks, list(topic_ids)):
                waiting[row["topic_id"]].append(row["actor_id"])
        return waiting

    def _waiting_on_reader(self, db, actor, limit=5):
        """(count, newest first) of readable topics that wait on this reader."""
        readable = ("FROM topic_waiting q JOIN topics t ON t.id=q.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                    "WHERE q.actor_id=:actor AND t.state='waiting' AND " + READABLE)
        count = db.execute("SELECT count(*) " + readable, {"actor": actor}).fetchone()[0]
        rows = db.execute("SELECT t.id,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,t.state_note,t.state_by,t.state_ms "
                          + readable + " ORDER BY t.state_ms DESC,t.id LIMIT :limit", {"actor": actor, "limit": limit}).fetchall()
        items = []
        for row in rows:
            title, truncated = _prefix(row["title_prefix"])
            items.append({"id": row["id"], "title": title, "title_truncated": truncated,
                          "note": row["state_note"], "state_by": row["state_by"], "state_ms": row["state_ms"]})
        return count, items

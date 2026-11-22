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
written in the topic since, nor answered that ask alone by their 👍 or by a
whisper replying to it to whoever asked (`ask_message_id`, the oldest such
ask). The row
lives while either reason holds; its order time is the state's time while
it is said, else the ask's.
"""

from .contract import LIMITS, READABLE, Refusal, organises, _body, _identifier, _prefix, _revision
from .delivery import _now_ms
from .outcome_asks import held_ask, record_ask
from .whispers import VISIBLE, redact_topic
from .message_edit import mark, revision, words, withheld
from .standing_conversation import excerpt


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

# Version 19 orders each outcome's topics by activity. A topic's activity time is
# the later of its newest message and the last time someone said where it stands
# (any topic.update of its state, note or waiting list); a rename or an archive is
# not activity. It is kept on the topic in the same act that sends the message or
# changes the state, so an outcome's topics are listed newest first from one index,
# whatever their history. The upgrade works it out from the newest message's send
# time and the state's time; a topic with neither has 0. Done topics are listed
# apart, so the index keys on whether a topic is done. state_message_id names the
# message that reopened a done topic, null for a state someone said.
# Version 19's rule, from messages and state changes; version 26 steps back through it.
ACTIVITY_RECOMPUTE = ("UPDATE topics SET activity_ms=max(coalesce(state_ms,0),coalesce((SELECT m.sent_ms FROM topic_summaries s "
                      "JOIN messages m ON m.id=s.latest_message_id WHERE s.topic_id=topics.id),0))")
ACTIVITY_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN activity_ms INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE topics ADD COLUMN state_message_id TEXT REFERENCES messages(id)",
    ACTIVITY_RECOMPUTE,
    "DROP INDEX workspace_listed_topics",
    "CREATE INDEX workspace_topic_order ON topics(workspace_id,archived,state='done',activity_ms DESC,id DESC)",
]
ACTIVITY_DOWN = ("DROP INDEX workspace_topic_order", "CREATE INDEX workspace_listed_topics ON topics(workspace_id,archived,id)",
                 "ALTER TABLE topics DROP COLUMN state_message_id", "ALTER TABLE topics DROP COLUMN activity_ms")
# Activity times are worked out again on the next upgrade; who reopened a topic is not.
ACTIVITY_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topics WHERE state_message_id IS NOT NULL)"
# A message in a done topic makes it active again; the state's note says so.
REOPENED_NOTE = "Reopened by a new message"


def derived_conversation(topic, asks):
    """A live Conversation has no manual workflow state. Reads do not repair it."""
    if topic["kind"] == "conversation" and not topic["archived"]:
        return dict(topic, state="waiting" if asks else "active", state_note="",
                    state_by=None, state_ms=None, state_message_id=None)
    return dict(topic)


def _fenced(expected, version, held):
    """Refuse a topic update made from what has changed since its sender read it.

    It is fenced on the topic's version (`topic_revision`), or on the value the
    sender read of each field it names (`topic_fields`, keyed as the update's
    args), so a change to another field never refuses it. `held` is each
    field as the topic holds it now."""
    fields = expected.get("topic_fields")
    if fields is None:
        return _revision(expected, "topic_revision", version)
    if "topic_revision" in expected or not isinstance(fields, dict) or not fields or not set(fields) <= set(held):
        raise Refusal("INVALID_ARGUMENT", "A topic update is fenced on its revision or on fields it names: " + ", ".join(held))
    for name, seen in fields.items():
        if name == "waiting_on" and isinstance(seen, list) and all(isinstance(member, str) for member in seen):
            seen = sorted(seen)
        if type(seen) is not type(held[name]) or seen != held[name]:
            raise Refusal("REVISION_CONFLICT", "The topic's %s changed since it was read; nothing was changed" % name, {"topic_revision": version})


def order_cursor(done, list_position, topic_id):
    """The position of a topic in its outcome's list: "DONE:LIST_POSITION:ID"."""
    return "%d:%d:%s" % (int(bool(done)), list_position, topic_id)


def order_position(cursor):
    """(done, list_position, topic_id) from a cursor order_cursor wrote; anything else is refused."""
    parts = cursor.split(":", 2) if isinstance(cursor, str) else ()
    if (len(parts) != 3 or parts[0] not in ("0", "1") or not parts[1].isascii() or not parts[1].isdigit()
            or len(parts[1]) > 18 or (len(parts[1]) > 1 and parts[1][0] == "0")):
        raise Refusal("INVALID_ARGUMENT", "Invalid topic list cursor")
    return int(parts[0]), int(parts[1]), _identifier(parts[2], "cursor")


class TopicState:
    def _repair_conversation_waiting(self, db, topic):
        """Repair only this touched Conversation's projection, inside its commit.

        Open asks already maintain topic_waiting through _sync_waits. Validate
        those indexed rows against conversation_waits, never reconstructing
        message history or creating a second resolution/cancellation fact.
        """
        if topic["kind"] != "conversation":
            return []
        current = db.execute("SELECT archived FROM topics WHERE id=?", (topic["id"],)).fetchone()
        if current["archived"]:
            return []
        changed = [row[0] for row in db.execute(
            "SELECT q.actor_id FROM topic_waiting q WHERE q.topic_id=? AND (q.said=1 OR NOT EXISTS "
            "(SELECT 1 FROM conversation_waits c WHERE c.ask_id=q.ask_message_id AND c.actor_id=q.actor_id))", (topic["id"],))]
        db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND NOT EXISTS "
                   "(SELECT 1 FROM conversation_waits c WHERE c.ask_id=topic_waiting.ask_message_id AND c.actor_id=topic_waiting.actor_id)", (topic["id"],))
        db.execute("UPDATE topic_waiting SET said=0,state_ms=(SELECT sent_ms FROM messages WHERE id=ask_message_id) WHERE topic_id=? AND said=1", (topic["id"],))
        waiting = db.execute("SELECT 1 FROM topic_waiting WHERE topic_id=? AND ask_message_id IS NOT NULL LIMIT 1", (topic["id"],)).fetchone() is not None
        db.execute("UPDATE topics SET state=?,state_note='',state_by=NULL,state_ms=NULL,state_message_id=NULL WHERE id=?",
                   ("waiting" if waiting else "active", topic["id"]))
        return changed

    def _command_topic_update(self, db, actor, envelope):
        target = envelope.get("target", {})
        if set(target) != {"topic_id"}:
            raise Refusal("INVALID_ARGUMENT", "A topic update names only its topic")
        topic = self._topic(db, actor, target["topic_id"])
        old_waiting = [row[0] for row in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=? AND said=1 ORDER BY actor_id", (topic["id"],))]
        _fenced(envelope.get("expected", {}), topic["version"], {"title": topic["title"], "archived": bool(topic["archived"]),
                "state": topic["state"], "note": topic["state_note"], "waiting_on": old_waiting})
        args = envelope.get("args", {})
        self._conversation_update_refused(topic, args)
        if not args or not set(args) <= {"title", "archived", "state", "note", "waiting_on", "keep_note"}:
            raise Refusal("INVALID_ARGUMENT", "A topic update changes its title, whether it is archived, its state, note or who it waits on")
        keep = "keep_note" in args
        if keep and (args["keep_note"] is not True or "note" in args or "state" not in args):
            raise Refusal("INVALID_ARGUMENT", "keep_note is true, with a state and without a note")
        manager = organises(topic, actor) or actor == topic["creator_id"]
        if "title" in args and not manager:
            raise Refusal("FORBIDDEN", "Only the outcome's owner or coordinator, or the topic's creator, can rename it")
        if "archived" in args and not manager:
            raise Refusal("FORBIDDEN", "Only the outcome's owner or coordinator, or the topic's creator, can archive it")
        if args.keys() & {"state", "note", "waiting_on"} and not self._may_say(db, topic, actor):
            raise Refusal("FORBIDDEN", "Only the topic's participants, those who have written in it, its creator or the outcome's owner or coordinator "
                          "can say where it stands; you can say where a topic stands once you have written in it")
        return self._set_topic_state(db, topic, actor, args)

    def _set_topic_state(self, db, topic, actor, args):
        """The body of topic.update after its permission check: the one server path that changes a
        topic's title, archive, state, note and waits, used by topic.update and by outcome.reach (D42)."""
        old_waiting = [row[0] for row in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=? AND said=1 ORDER BY actor_id", (topic["id"],))]
        keep = "keep_note" in args
        if "title" in args:
            title = _body(args["title"])
            if not title.strip():
                raise Refusal("EMPTY_TITLE", "A topic needs a title")
            db.execute("UPDATE topics SET title=? WHERE id=?", (title, topic["id"]))
        if "archived" in args:
            if not isinstance(args["archived"], bool):
                raise Refusal("INVALID_ARGUMENT", "Archived is true or false")
            db.execute("UPDATE topics SET archived=? WHERE id=?", (int(args["archived"]), topic["id"]))
            db.execute("UPDATE topic_waiting SET archived=? WHERE topic_id=?", (int(args["archived"]), topic["id"]))
        if args.keys() & {"state", "note", "waiting_on"}:
            state = args.get("state", topic["state"])
            if state not in STATES:
                raise Refusal("INVALID_ARGUMENT", "A topic's state is one of: " + ", ".join(STATES))
            # A new state starts with its own note unless one is given or kept;
            # so does any word after a reopen, whose note was the message's, not said.
            said = (state == topic["state"] or keep) and topic["state_message_id"] is None
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
        # The answer says the topic as it now stands, a message's reopen too, so a page paints it as Core holds it.
        row = db.execute("SELECT title,archived,state,state_note,state_by,state_ms,state_message_id FROM topics WHERE id=?", (topic["id"],)).fetchone()
        return {"topic_id": topic["id"], "version": version, "title": row["title"], "archived": bool(row["archived"]), "state": row["state"],
                "note": row["state_note"], "waiting_on": waiting, "state_by": row["state_by"], "state_ms": row["state_ms"],
                # Named only to a reader who may see the message that reopened it (whispers.py).
                "state_message_id": redact_topic(db, actor, row)["state_message_id"]}, [
                    {"kind": "topic", "id": topic["id"], "version": version}]

    def _may_say(self, db, topic, actor):
        """Whether actor, who can read topic, may say where it stands: its creator,
        whoever organises the outcome, its participants and whoever has written in it.
        Having written grants no participation, so it wakes no one."""
        # Every message's author has a reply horizon in its topic: each publish
        # writes one, version 16 made one for every earlier author, version 18
        # keeps them, and nothing else writes them.
        return organises(topic, actor) or actor == topic["creator_id"] or bool(db.execute(
            "SELECT 1 FROM topic_participants WHERE topic_id=?1 AND actor_id=?2 AND active=1 "
            "UNION ALL SELECT 1 FROM reply_horizons WHERE topic_id=?1 AND actor_id=?2", (topic["id"], actor)).fetchone())

    def _message_activity(self, db, topic, author, message_id, sent_ms):
        """A message advances activity and reopens a manual Done, naming its author and source.
        A pipeline-owned shipped Build Done stays closed through the announcement (1081).
        The caller's transaction is the send's own."""
        if topic["state"] == "done" and not self._pipeline_holds_done_topic(db, topic):
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
        someone who can read it. In a conversation each open ask to them goes too
        (conversation_waits, standing_conversation.py): they can no longer reply to
        it, and nothing else would clear it. The caller touches each returned topic."""
        # A conversation's topic_waiting row stands while any ask there waits on them (_sync_waits), so this finds it too.
        topics = db.execute("SELECT t.*,w.owner_id FROM topic_waiting q JOIN topics t ON t.id=q.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                            "WHERE q.actor_id=:actor AND t." + scope + "=:scope AND NOT " + READABLE,
                            {"actor": member, "scope": scope_id}).fetchall()
        for topic in topics:
            for link in db.execute("SELECT ask_id FROM ask_cover_links WHERE topic_id=? AND actor_id=? AND active=1", (topic["id"], member)).fetchall():
                self._set_linked_wait(db, member, link["ask_id"], False)
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic["id"], member))
            if topic["kind"] == "conversation":
                db.execute("DELETE FROM conversation_waits WHERE actor_id=? AND ask_id IN (SELECT id FROM messages WHERE topic_id=?)",
                           (member, topic["id"]))
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

    def _answered(self, db, topic, author, to=None, reply_to=None):
        """Writing clears the legacy projection; _publish restores any open linked questions.

        New linked asks are settled only by AskCover._linked_reply, never by this broad rule.

        A person's whisper (to: the agent it goes to) answers only the ask it replies to (reply_to), when that is an
        ask to its writer from that agent, the one who can read the answer, as their 👍 on it would (item 307): when
        the topic's wait on them is from that ask it moves to the oldest ask nobody has answered, or ends
        (Reactions._topic_ask_answered); a wait from an older ask stays on it. A whisper that replies to no such ask
        answers nothing. A wait someone said stays until it is said otherwise, and an ask an open record still needs
        (a proposed target, an owner-gated stage: outcome_asks.held_ask) stays waiting."""
        topic_id = topic["id"]
        if to is not None:
            ask = self._whispered_ask(db, topic, to, reply_to)
            return ask is not None and self._topic_ask_answered(db, topic, author, ask)
        held = held_ask(db, topic_id, author)
        if held is not None:
            db.execute("UPDATE topic_waiting SET ask_message_id=?,state_ms=(SELECT sent_ms FROM messages WHERE id=?) "
                       "WHERE topic_id=? AND actor_id=?", (held, held, topic_id, author))
            return False
        row = db.execute("SELECT said FROM topic_waiting WHERE topic_id=? AND actor_id=? AND ask_message_id IS NOT NULL",
                         (topic_id, author)).fetchone()
        if row is None:
            return False
        if row["said"]:
            db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (topic_id, author))
        else:
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic_id, author))
        return True

    def _whispered_ask(self, db, topic, to, reply_to):
        """The message a person's whisper to `to` replies to, {id, seq, sent_ms}, when `to` wrote it and no record answers
        it (outcome_asks.record_ask), or None. It is an open ask to the writer only when the topic's wait on them is from
        it, which Reactions._topic_ask_answered reads; any other message answers nothing."""
        ask = db.execute("SELECT id,seq,sent_ms FROM messages WHERE id=? AND author_id=?", (reply_to, to)).fetchone() if reply_to else None
        if ask is None or record_ask(db, ask["id"], topic["workspace_id"], topic["id"]):
            return None
        return ask

    def _waiting_asks(self, db, topic, actor, include_archived=False):
        """Every eligible ask identity to this reader in one waiting place, without message bodies.

        The addressee key bounds candidates to this topic and reader; _ask_waits
        owns all answer/held-record rules, including conversation_waits. Explicit
        archived topic reads retain metadata; outcome lights use the default.
        """
        rows = db.execute(
            "SELECT m.id,m.seq,m.topic_id,m.author_id,m.sent_ms,m.intent,m.addressees,m.private_to "
            "FROM message_addressees a CROSS JOIN messages m ON m.seq=a.seq "
            "CROSS JOIN topics t ON t.id=m.topic_id JOIN workspaces w ON w.id=t.workspace_id "
            "WHERE a.topic_id=:topic AND a.actor_id=:actor AND m.intent='ask' AND " + READABLE + " AND " + VISIBLE
            + " ORDER BY a.seq", {"topic": topic["id"], "actor": actor})
        return [{"actor_id": actor, "message_id": row["id"], "by": row["author_id"], "since_ms": row["sent_ms"]}
                for row in rows if self._ask_waits(db, topic, row, actor, include_archived=include_archived)]

    def _waits_by_topic(self, db, topic_ids, reader=None):
        """{topic_id: (waiting_on, asks)} for the given topics: who the topic was said to wait
        on, and each open ask, {actor_id, message_id, by, since_ms}, both in actor order."""
        waits = {topic_id: ([], []) for topic_id in topic_ids}
        if topic_ids:
            marks = ",".join("?" * len(topic_ids))
            for row in db.execute("SELECT q.topic_id,q.actor_id,q.said,q.ask_message_id,t.kind,m.author_id,m.sent_ms,"
                                  "CASE WHEN m.private_to IS NULL THEN " + words("m", chars=1024, plain=True) + " ELSE '' END AS body," + revision("m") + " AS revision "
                                  "FROM topic_waiting q JOIN topics t ON t.id=q.topic_id LEFT JOIN messages m ON m.id=q.ask_message_id "
                                  "WHERE q.topic_id IN (%s) AND (t.kind!='conversation' OR EXISTS "
                                  "(SELECT 1 FROM conversation_waits c WHERE c.ask_id=q.ask_message_id AND c.actor_id=q.actor_id)) ORDER BY q.topic_id,q.actor_id" % marks,
                                  list(topic_ids)):
                said, asks = waits[row["topic_id"]]
                if row["said"] and row["kind"] != "conversation":
                    said.append(row["actor_id"])
                if row["ask_message_id"] is not None and row["actor_id"] == reader:
                    topic = db.execute("SELECT id,kind,workspace_id FROM topics WHERE id=?", (row["topic_id"],)).fetchone()
                    questions = self._waiting_asks(db, topic, reader, include_archived=True)
                    for ask in questions:
                        preview = db.execute("SELECT CASE WHEN m.private_to IS NULL THEN " + words("m", chars=1024, plain=True)
                                             + " ELSE '' END AS body," + revision("m") + " AS revision FROM messages m WHERE m.id=?",
                                             (ask["message_id"],)).fetchone()
                        ask["excerpt"] = mark(ask["message_id"], preview["revision"], excerpt(preview["body"]))
                        ask["withheld"] = withheld(ask["message_id"])
                    asks.extend(questions)
                elif row["ask_message_id"] is not None:
                    asks.append({"actor_id": row["actor_id"], "message_id": row["ask_message_id"],
                                 "by": row["author_id"], "since_ms": row["sent_ms"],
                                 "excerpt": mark(row["ask_message_id"], row["revision"], excerpt(row["body"])),
                                 "withheld": withheld(row["ask_message_id"])})
        return waits

    def _waiting_outcomes(self, db, actor, workspace_id=None):
        """How many distinct outcomes hold an unarchived topic waiting on this reader,
        and whether workspace_id is one of them. It walks the same rows the waiting
        count walks, so an outcome counts however old its wait is."""
        # Distinct here, not in SQL, which would sort every row in a temporary B-tree.
        rows = db.execute("SELECT t.workspace_id FROM topic_waiting q INDEXED BY reader_waiting "
                          "CROSS JOIN topics t ON t.id=q.topic_id WHERE q.actor_id=? AND q.archived=0", (actor,)).fetchall()
        outcomes = {row[0] for row in rows}
        return {"count": len(outcomes), "here": workspace_id is not None and workspace_id in outcomes}

    def _waiting_on_reader(self, db, actor, limit=5):
        """(count, newest first) of the topics that wait on this reader, archived ones left out.

        The count walks the reader's rows in a covering index; the list reads the
        newest few in that index's order."""
        count = db.execute("SELECT count(*) FROM topic_waiting INDEXED BY reader_waiting WHERE actor_id=? AND archived=0",
                           (actor,)).fetchone()[0]
        rows = db.execute("SELECT t.id,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,t.state_note,t.state_by,t.state_ms,"
                          "q.said,q.ask_message_id,m.author_id AS asked_by,m.sent_ms AS asked_ms,"
                          "w.id AS workspace_id,substr(CAST(w.title AS BLOB),1,1025) AS workspace_title_prefix "
                          "FROM topic_waiting q INDEXED BY reader_waiting CROSS JOIN topics t ON t.id=q.topic_id "
                          "JOIN workspaces w ON w.id=t.workspace_id "
                          "LEFT JOIN messages m ON m.id=q.ask_message_id "
                          "WHERE q.actor_id=? AND q.archived=0 ORDER BY q.state_ms DESC,q.topic_id LIMIT ?", (actor, limit)).fetchall()
        items = []
        for row in rows:
            title, truncated = _prefix(row["title_prefix"])
            ask = None if row["ask_message_id"] is None else {"message_id": row["ask_message_id"], "by": row["asked_by"], "since_ms": row["asked_ms"]}
            # Which outcome it is in, so the Waiting on you list names it (item 86).
            outcome_title, outcome_truncated = _prefix(row["workspace_title_prefix"])
            items.append({"id": row["id"], "title": title, "title_truncated": truncated,
                          "note": row["state_note"], "state_by": row["state_by"], "state_ms": row["state_ms"],
                          "said": bool(row["said"]), "ask": ask,
                          "workspace": {"id": row["workspace_id"], "title": outcome_title, "title_truncated": outcome_truncated}})
        return count, items

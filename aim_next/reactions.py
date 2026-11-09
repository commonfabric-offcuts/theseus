from __future__ import annotations

"""Thumbs-up and go-ahead answers on a message (docs/thumbs.md).

A reaction belongs to one actor, one message and one kind:

- `thumb`: "I read it and I understand", never "do it". Its revision is its
  whole state, as a mark's is: odd means thumbed, even means taken back.
- `answer`: a person's ✅ (`yes`, go ahead) or 🚫 (`no`, don't) to a message
  that asks them for a go-ahead (`messages.go_ahead`, an Ask an agent marks
  with --go-ahead). Its value is the answer; its revision counts the changes.

Every change adds to the row's revision and rows are never deleted, so a
revision is never reused, and the sum of a message's revisions (its reaction
version) only grows. Both settle the reactor's own pending delivery of the
message, as reading it does, and change no topic state, wait or order.

An answer is also said where the asker reads it: the same act posts a short
reply from the person to the agent (`✅ Go ahead` or `🚫 Don't`), so the agent
is told through its delivery, the topic stops waiting on the person for that
ask, and an agent needs nothing new to hear it.

Who sees a reaction is who sees the message: everyone who can read the topic
and everyone it was sent to by name, or, on a whisper, its two people
(whispers.visible). Each of them gets an
actor-scoped change `reaction` keyed by the message at its new reaction
version; nothing is written to the topic's scope, whose keys open pages check
strictly (web/freshness.mjs), so a page from an earlier release never sees an
unknown key.
"""

import json

from .whispers import visible
from .contract import Refusal, _identifier
from .delivery import _now_ms


# The version after 29 (provisional; the release train renumbers).
REACTION_SCHEMA = [
    "CREATE TABLE message_reactions (actor_id TEXT NOT NULL REFERENCES actors(id), message_id TEXT NOT NULL REFERENCES messages(id), "
    "kind TEXT NOT NULL CHECK(kind IN ('thumb','answer')), topic_id TEXT NOT NULL REFERENCES topics(id), "
    "value TEXT CHECK(value IS NULL OR value IN ('up','yes','no')), at_ms INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), "
    "PRIMARY KEY(actor_id,message_id,kind))",
    "CREATE INDEX message_reaction_rows ON message_reactions(message_id)",
    "ALTER TABLE messages ADD COLUMN go_ahead INTEGER NOT NULL DEFAULT 0 CHECK(go_ahead IN (0,1))",
]
REACTION_DOWN = ("ALTER TABLE messages DROP COLUMN go_ahead", "DROP INDEX message_reaction_rows", "DROP TABLE message_reactions")
# Any row, taken-back thumbs included (dropping one would restart its
# revisions), and any message that asks for a go-ahead.
REACTION_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_reactions) OR EXISTS (SELECT 1 FROM messages WHERE go_ahead=1)"

EMPTY = {"version": 0, "thumbs": [], "answers": [], "thumb_revision": 0, "answer_revision": 0}
ANSWERS = {"yes": "✅ Go ahead", "no": "🚫 Don't"}
GO_AHEAD_NEEDS_ASK = "--go-ahead goes on an Ask: name who you ask with --asks; nothing was sent"


def go_ahead_flag(args):
    """message.post's go_ahead: true, false or absent; anything else is refused."""
    value = args.get("go_ahead", False)
    if not isinstance(value, bool):
        raise Refusal("INVALID_ARGUMENT", "go_ahead is true or false")
    return value


class Reactions:
    def _reaction_row(self, db, actor, message_id, kind):
        return db.execute("SELECT value,revision FROM message_reactions WHERE actor_id=? AND message_id=? AND kind=?",
                          (actor, message_id, kind)).fetchone()

    def _reacted_message(self, db, actor, target):
        if set(target) != {"message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one message")
        message_id = _identifier(target["message_id"], "message_id")
        # The same reach as reading it: a topic the actor reads, or a message
        # sent to them by name; a whisper they are not in is refused as unknown.
        self._message_access(db, actor, message_id)
        return db.execute("SELECT id,topic_id,seq,author_id,private_to,addressees,go_ahead FROM messages WHERE id=?", (message_id,)).fetchone()

    def _react(self, db, actor, message, kind, value, revision, now):
        db.execute("INSERT INTO message_reactions(actor_id,message_id,kind,topic_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?) "
                   "ON CONFLICT(actor_id,message_id,kind) DO UPDATE SET value=excluded.value,at_ms=excluded.at_ms,revision=excluded.revision",
                   (actor, message["id"], kind, message["topic_id"], value, now, revision))
        # Reacting is reading: the reactor's own pending delivery is settled.
        pending = db.execute("SELECT d.* FROM deliveries d CROSS JOIN delivery_groups g ON g.id=d.group_id "
                             "WHERE d.message_id=? AND d.recipient_id=? AND d.state='pending' AND g.active=1",
                             (message["id"], actor)).fetchone()
        if pending is not None:
            self._acknowledge(db, actor, pending)
        version = db.execute("SELECT SUM(revision) FROM message_reactions WHERE message_id=?", (message["id"],)).fetchone()[0]
        for reader in self._message_readers(db, message, actor):
            self._change(db, "actor", reader, "reaction", message["id"], version)
        return version

    def _message_readers(self, db, message, actor):
        """Everyone who sees the message's reactions, by the reach of reading it (_message_access): its whisper's
        two people, or whoever reads its topic and whoever it was sent to by name, and the reactor."""
        if message["private_to"] is not None:
            return list(dict.fromkeys([message["author_id"], message["private_to"], actor]))
        rows = db.execute("SELECT w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?1 "
                          "UNION SELECT creator_id FROM topics WHERE id=?1 "
                          "UNION SELECT m.actor_id FROM topics t JOIN workspace_members m ON m.workspace_id=t.workspace_id WHERE t.id=?1 "
                          "UNION SELECT actor_id FROM topic_participants WHERE topic_id=?1 AND active=1 "
                          "UNION SELECT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id "
                          "WHERE d.message_id=?2 AND r.reason='addressed'", (message["topic_id"], message["id"])).fetchall()
        return list(dict.fromkeys([row[0] for row in rows] + [actor]))

    def _command_message_thumb(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(args) != {"thumbed"} or not isinstance(args["thumbed"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one message and whether it is thumbed up")
        message = self._reacted_message(db, actor, target)
        if message["author_id"] == actor:
            raise Refusal("INVALID_ARGUMENT", "A thumbs-up is for someone else's message")
        row = self._reaction_row(db, actor, message["id"], "thumb")
        current = row["revision"] if row else 0
        # Fenced on the revision its sender saw, so a late request never undoes a newer act.
        if envelope["expected"]["thumb_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This thumbs-up changed since it was read; nothing was changed", {"thumb_revision": current})
        thumbed = args["thumbed"]
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"]}
        if thumbed == (current % 2 == 1):
            return dict(result, thumbed=thumbed, thumb_revision=current, changed=False), []
        version = self._react(db, actor, message, "thumb", "up" if thumbed else None, current + 1, _now_ms())
        return dict(result, thumbed=thumbed, thumb_revision=current + 1, reaction_version=version, changed=True), [
            {"kind": "reaction", "id": message["id"], "version": version}]

    def _command_message_answer(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(args) != {"answer"} or args["answer"] not in ANSWERS:
            raise Refusal("INVALID_ARGUMENT", "Name one message and answer yes (go ahead) or no (don't)")
        message = self._reacted_message(db, actor, target)
        if not message["go_ahead"]:
            raise Refusal("NOT_A_GO_AHEAD", "This message does not ask for a go-ahead; reply to it instead")
        if actor not in json.loads(message["addressees"]) or self._actor(db, actor)["kind"] != "human":
            raise Refusal("NOT_ASKED", "Only a person this message asks can answer it")
        row = self._reaction_row(db, actor, message["id"], "answer")
        current = row["revision"] if row else 0
        if envelope["expected"]["answer_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This answer changed since it was read; nothing was changed", {"answer_revision": current})
        answer = args["answer"]
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"], "answer": answer}
        if row is not None and row["value"] == answer:
            return dict(result, answer_revision=current, changed=False), []
        version = self._react(db, actor, message, "answer", answer, current + 1, _now_ms())
        # The asker is told as a reply is: a short message from the person to
        # the agent, answering the ask, which also clears the topic's wait.
        body = ANSWERS[answer] + (" (I changed my answer)" if row is not None else "")
        said, affected = self._publish(db, actor, envelope["operation_id"], message["topic_id"], {
            "body": body, "attachments": [], "quotes": [], "addressees": [message["author_id"]],
            "reply_to": message["id"], "intent": "tell"})
        return dict(result, answer_revision=current + 1, reaction_version=version, reply_id=said["message_id"], changed=True), affected + [
            {"kind": "reaction", "id": message["id"], "version": version}]

    def _reactions_of(self, db, actor, ids):
        """{message_id: reactions} for the messages in ids that have any; the caller has checked each is visible."""
        found = {}
        if not ids:
            return found
        marks = ",".join("?" * len(ids))
        for row in db.execute("SELECT message_id,actor_id,kind,value,at_ms,revision FROM message_reactions INDEXED BY message_reaction_rows "
                              "WHERE message_id IN (%s) ORDER BY message_id,at_ms,actor_id" % marks, list(ids)):
            entry = found.setdefault(row["message_id"], {"version": 0, "thumbs": [], "answers": [], "thumb_revision": 0, "answer_revision": 0})
            entry["version"] += row["revision"]
            if row["actor_id"] == actor:
                entry[row["kind"] + "_revision"] = row["revision"]
            if row["kind"] == "thumb" and row["revision"] % 2 == 1:
                entry["thumbs"].append({"actor_id": row["actor_id"], "at_ms": row["at_ms"]})
            elif row["kind"] == "answer":
                entry["answers"].append({"actor_id": row["actor_id"], "answer": row["value"], "at_ms": row["at_ms"]})
        return found

    def _reaction_fields(self, db, actor, items):
        """Add `reactions` (when there are any) and `go_ahead` (when asked) to each message item of one page."""
        ids = [item["id"] for item in items]
        found = self._reactions_of(db, actor, ids)
        asks = set()
        if ids:
            asks = {row[0] for row in db.execute("SELECT id FROM messages WHERE id IN (%s) AND go_ahead=1" % ",".join("?" * len(ids)), ids)}
        for item in items:
            if item["id"] in found:
                item["reactions"] = found[item["id"]]
            if item["id"] in asks:
                item["go_ahead"] = True

    def _source_reactions(self, db, actor, row):
        """The reactions a message's source view carries (the Reader's thumbs-up reads its revision there)."""
        return {"go_ahead": bool(row["go_ahead"]), "reactions": self._reactions_of(db, actor, [row["id"]]).get(row["id"], dict(EMPTY))}

    def _view_reactions(self, db, actor, args):
        """One message's reactions, for a page that learned they changed (a `reaction` change)."""
        message_id = _identifier(args.get("message_id"), "message_id")
        self._message_access(db, actor, message_id)
        row = db.execute("SELECT id,topic_id,author_id,private_to,go_ahead FROM messages WHERE id=?", (message_id,)).fetchone()
        if row is None or not visible(row, actor):
            raise Refusal("FORBIDDEN", "No readable source")
        return {"instance_id": self.instance_id, "message_id": row["id"], "topic_id": row["topic_id"], "go_ahead": bool(row["go_ahead"]),
                "reactions": self._reactions_of(db, actor, [row["id"]]).get(row["id"], dict(EMPTY))}

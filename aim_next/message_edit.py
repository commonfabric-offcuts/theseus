from __future__ import annotations

"""Editing a message (item 228, docs/message-edit.md).

A message's row never changes. An edit by its author, a person, appends the
message's next revision to `message_revisions`; revision 1 is the row's own
words. Every read of a message's words, whole or as a preview or excerpt,
goes through the one words helper below (words, words_at, current_words), so
everything that shows a message shows its latest words, and
tests/test_message_words.py fails on any other read of messages.body.

Each agent that can read the message when it is edited, other than the
editor, is sent a correction: a delivery of the message at the new revision,
in a delivery group of its own kind ('correction'), so it is never unread,
addressed, read through or thumbed away. Only an ack of its own id, a newer
correction of the same message, or the agent losing the message settles it.
People never get one. Every reader, people and agents, gets an actor-scoped
`edit` change keyed by the message at its new revision.
"""

import json

from .contract import Refusal, _body, _identifier, _revision


# Version 40: each later revision of a message's words, and each delivery's
# revision, so one message can be delivered to one agent again at a later
# revision. Rows of message_revisions never change.
MESSAGE_REVISIONS_SCHEMA = [
    "CREATE TABLE message_revisions (message_id TEXT NOT NULL REFERENCES messages(id), revision INTEGER NOT NULL CHECK(revision>1), "
    "author_id TEXT NOT NULL REFERENCES actors(id), operation_id TEXT NOT NULL, body TEXT NOT NULL, edited_ms INTEGER NOT NULL, "
    "PRIMARY KEY(message_id,revision), UNIQUE(author_id,operation_id))",
    "CREATE TRIGGER immutable_message_revision_update BEFORE UPDATE ON message_revisions BEGIN SELECT RAISE(ABORT, 'immutable message revision'); END",
    "CREATE TRIGGER immutable_message_revision_delete BEFORE DELETE ON message_revisions BEGIN SELECT RAISE(ABORT, 'immutable message revision'); END",
]

DELIVERY_COLUMNS = "seq,id,message_id,recipient_id,group_id,state,topic_id"
# The deliveries table as version 39 keeps it (its topic column was added by version 18), and as version 40 builds it.
DELIVERIES_39 = ("CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), "
                 "recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), "
                 "state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, UNIQUE(message_id,recipient_id))")
DELIVERIES_40 = ("CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), "
                 "recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), "
                 "state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), "
                 "UNIQUE(message_id,recipient_id,revision))")
# What dropping the table drops with it, made again after its rows are back.
DELIVERY_INDEXES = [
    "CREATE INDEX recipient_deliveries ON deliveries(recipient_id,state,seq)",
    "CREATE INDEX pending_group_deliveries ON deliveries(group_id,seq) WHERE state='pending'",
    "CREATE INDEX pending_group_topic_deliveries ON deliveries(group_id,topic_id,seq) WHERE state='pending'",
    "CREATE TRIGGER delivery_topic_required BEFORE INSERT ON deliveries WHEN NEW.topic_id IS NULL "
    "BEGIN SELECT RAISE(ABORT, 'a delivery names its topic'); END",
]


def _rebuilt_deliveries(table):
    """Build deliveries again as table, keeping every row, its id and seq, where the next seq goes on from
    (sqlite_sequence), its indexes and trigger. delivery_reasons refers to deliveries, so its rows are kept
    aside first and put back after."""
    return ["CREATE TABLE deliveries_kept AS SELECT %s FROM deliveries" % DELIVERY_COLUMNS,
            "CREATE TABLE delivery_reasons_kept AS SELECT delivery_id,reason,topic_id,participant_epoch FROM delivery_reasons",
            "CREATE TABLE deliveries_sequence AS SELECT seq FROM sqlite_sequence WHERE name='deliveries'",
            "DELETE FROM delivery_reasons",
            "DROP TABLE deliveries", table,
            "INSERT INTO deliveries(%s) SELECT %s FROM deliveries_kept ORDER BY seq" % (DELIVERY_COLUMNS, DELIVERY_COLUMNS),
            "DELETE FROM sqlite_sequence WHERE name='deliveries'",
            "INSERT INTO sqlite_sequence(name,seq) SELECT 'deliveries',seq FROM deliveries_sequence",
            "INSERT INTO delivery_reasons(delivery_id,reason,topic_id,participant_epoch) SELECT delivery_id,reason,topic_id,participant_epoch "
            "FROM delivery_reasons_kept",
            "DROP TABLE deliveries_sequence", "DROP TABLE delivery_reasons_kept", "DROP TABLE deliveries_kept"] + DELIVERY_INDEXES


MESSAGE_EDIT_UP = MESSAGE_REVISIONS_SCHEMA + _rebuilt_deliveries(DELIVERIES_40)
MESSAGE_EDIT_DOWN = ["DROP TRIGGER immutable_message_revision_delete", "DROP TRIGGER immutable_message_revision_update",
                     "DROP TABLE message_revisions"] + _rebuilt_deliveries(DELIVERIES_39)
# Once any message is edited, version 39 would show its first words and lose the corrections' revisions.
MESSAGE_EDIT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_revisions)"


# The words helper. Each is SQL for the messages row named alias: its current words, their revision (1 when never
# edited) and when they were written by an edit (NULL when never edited).
def words(alias="m"):
    return ("coalesce((SELECT r.body FROM message_revisions r WHERE r.message_id=%s.id ORDER BY r.revision DESC LIMIT 1),%s.body)"
            % (alias, alias))


def revision(alias="m"):
    return "coalesce((SELECT max(r.revision) FROM message_revisions r WHERE r.message_id=%s.id),1)" % alias


def edited(alias="m"):
    return "(SELECT r.edited_ms FROM message_revisions r WHERE r.message_id=%s.id ORDER BY r.revision DESC LIMIT 1)" % alias


def current_words(db, message_id):
    """(words, revision, edited_ms) of one message as it reads now."""
    row = db.execute("SELECT " + words() + "," + revision() + "," + edited() + " FROM messages m WHERE m.id=?", (message_id,)).fetchone()
    return tuple(row) if row is not None else (None, None, None)


def words_at(db, message_id, number):
    """(words, edited_ms) of one revision of one message, or None when it has no such revision."""
    if number == 1:
        row = db.execute("SELECT m.body,NULL FROM messages m WHERE m.id=?", (message_id,)).fetchone()
    else:
        row = db.execute("SELECT r.body,r.edited_ms FROM message_revisions r WHERE r.message_id=? AND r.revision=?",
                         (message_id, number)).fetchone()
    return tuple(row) if row is not None else None


def every_revision(db, message_id):
    """{revision: words} of one message, every revision it has had."""
    found = {1: db.execute("SELECT m.body FROM messages m WHERE m.id=?", (message_id,)).fetchone()[0]}
    found.update(db.execute("SELECT revision,body FROM message_revisions WHERE message_id=?", (message_id,)).fetchall())
    return found


def quoted_revision(db, message_id, quote_source, excerpt):
    """Check a quote's excerpt against the message it quotes. The source names the revision it quoted when the
    writer's page knew it: the excerpt must be in that revision. A quote naming none (written before edits
    existed) may quote any revision, and records none. Refuses INVALID_QUOTE."""
    texts = every_revision(db, message_id)
    if "revision" in quote_source:
        number = quote_source["revision"]
        if isinstance(number, bool) or not isinstance(number, int) or number not in texts or excerpt not in texts[number]:
            raise Refusal("INVALID_QUOTE", "The excerpt must preserve the words of the revision it quotes")
        return
    if not any(excerpt in text for text in texts.values()):
        raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")


EDIT_ARGUMENTS = "Name one message and its new words"
ONLY_PEOPLE = "Only people edit messages"
ONLY_AUTHOR = "Only the person who wrote a message edits it"
UNCHANGED = "These are the message's words already; nothing was edited"
EMPTY = "A message needs writing or an attachment"


class MessageEdit:
    def _command_message_edit(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) != {"body"}:
            raise Refusal("INVALID_ARGUMENT", EDIT_ARGUMENTS)
        body = _body(args["body"])
        # 1. A whisper the actor is not in, or a message they cannot read, is refused as an unknown id.
        message = self._message_access(db, actor, _identifier(target["message_id"], "message_id"))
        # 2-3. People edit, and only their own messages.
        if self._actor(db, actor)["kind"] != "human":
            raise Refusal("FORBIDDEN", ONLY_PEOPLE)
        if message["author_id"] != actor:
            raise Refusal("FORBIDDEN", ONLY_AUTHOR)
        # 4. Its outcome is not reached. An edit writes only actor-scoped changes, which the reached guard passes.
        reached = db.execute("SELECT w.title,r.reached_ms FROM topics t JOIN outcome_reached r ON r.workspace_id=t.workspace_id "
                             "JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?", (message["topic_id"],)).fetchone()
        if reached is not None:
            from .outcome_kind import _clock
            raise Refusal("OUTCOME_REACHED", "%s was reached on %s; its topics are kept to read." % (reached[0], _clock(reached[1])))
        # 5. Fenced on the revision the editor started from.
        now_words, current, _ = current_words(db, message["id"])
        _revision(envelope["expected"], "message_revision", current)
        # 6-7. Words or an attachment, and words that differ.
        attachments = json.loads(db.execute("SELECT attachments FROM messages WHERE id=?", (message["id"],)).fetchone()[0])
        if not body.strip() and not attachments:
            raise Refusal("EMPTY_MESSAGE", EMPTY)
        if body == now_words:
            raise Refusal("INVALID_ARGUMENT", UNCHANGED)
        from .delivery import _now_ms
        number, edited_ms = current + 1, _now_ms()
        db.execute("INSERT INTO message_revisions(message_id,revision,author_id,operation_id,body,edited_ms) VALUES (?,?,?,?,?,?)",
                   (message["id"], number, actor, envelope["operation_id"], body, edited_ms))
        readers = self._message_readers(db, message, actor)
        agents = [reader for reader in readers if reader != actor and self._actor_kind(db, reader) == "agent"]
        for agent in agents:
            # A newer correction settles the agent's older one.
            for row in self._pending_corrections(db, agent, message["id"]):
                self._acknowledge(db, agent, row)
            delivery_id = self._queue_delivery(db, message["id"], agent, message["topic_id"], {"correction": None}, revision=number)
            self._change(db, "actor", agent, "delivery", delivery_id, 1)
        # An agent that can no longer read the message keeps no correction of it.
        for row in db.execute("SELECT d.* FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                              "WHERE d.message_id=? AND d.state='pending' AND g.kind='correction' AND g.active=1", (message["id"],)).fetchall():
            if row["recipient_id"] not in agents:
                self._acknowledge(db, row["recipient_id"], row)
        for reader in readers:
            self._change(db, "actor", reader, "edit", message["id"], number)
        return {"message_id": message["id"], "revision": number, "edited_ms": edited_ms, "corrections": len(agents)}, [
            {"kind": "message", "id": message["id"], "version": number}]

    def _actor_kind(self, db, actor):
        row = db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()
        return row["kind"] if row else None

    def _pending_corrections(self, db, agent, message_id=None):
        """The agent's pending corrections in its active correction group, of one message or of every one."""
        return db.execute("SELECT d.* FROM delivery_groups g CROSS JOIN deliveries d INDEXED BY pending_group_deliveries "
                          "ON d.group_id=g.id AND d.state='pending' WHERE g.recipient_id=? AND g.kind='correction' AND g.active=1"
                          + (" AND d.message_id=?" if message_id is not None else ""),
                          (agent,) + ((message_id,) if message_id is not None else ())).fetchall()

    def _correction_readable(self, db, actor, row):
        """Whether the actor may be shown this delivery: any delivery but a correction, and a correction of a message
        the actor can read now."""
        if row["revision"] == 1:
            return True
        try:
            self._message_access(db, actor, row["message_id"])
        except Refusal:
            return False
        return True

    def _settle_unreadable_corrections(self, db, actor):
        """In the write that takes a message from the actor, settle its corrections of messages it can no longer read,
        so no count, wake or notice keeps them; the wake's claim does the same before it hands work (runner.py).
        The walk is the actor's own pending corrections. Returns how many it settled."""
        settled = 0
        for row in self._pending_corrections(db, actor):
            if not self._correction_readable(db, actor, row):
                self._acknowledge(db, actor, row)
                settled += 1
        return settled

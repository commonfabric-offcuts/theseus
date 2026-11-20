from __future__ import annotations

"""Messages a person has marked unread, to come back to.

A mark belongs to one person and one message. Its revision is its whole
state: odd means marked, even means not, and no row means revision 0. Every
change adds to the revision and rows are never deleted, so a revision is never
reused and every refusal names the state in one number. The topic and
sequence are copied from the message, which never changes, so counting and
listing need no join to the messages.

A mark is the person's own reminder: it changes no delivery, schedule or wake.
It counts as unread (Delivery._unread) and is cleared by message.mark, and by
the person's own 👍 given or go-ahead answer on the message, which read it
without an open (reactions.py, docs/thumbs.md).
A message the person wrote is never unread for them, so a mark on one is kept
but counts nowhere: not in the counts, the marks view, the Reader's mark, or
the New line.
"""

from .whispers import visible
from .removal import unsent
from .contract import READABLE, Refusal, _bounded_page, _identifier, _page_size


MARK_SCHEMA = [
    "CREATE TABLE message_marks (actor_id TEXT NOT NULL REFERENCES actors(id), message_id TEXT NOT NULL REFERENCES messages(id), "
    "topic_id TEXT NOT NULL REFERENCES topics(id), seq INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), "
    "PRIMARY KEY(actor_id,message_id))",
    "CREATE INDEX reader_marks ON message_marks(actor_id,topic_id,seq) WHERE revision%2=1",
]
MARK_DOWN = ("DROP INDEX reader_marks", "DROP TABLE message_marks")
# Any row, cleared ones included: dropping a cleared row would restart its
# revisions at 0, and a stale clear could then remove a fresh mark.
MARK_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_marks)"

# The person's marked messages by others, each counted while no eligible delivery
# (pending in an active group) already counts the same message. Read with
# message_marks k, topics t and workspaces w; k.actor_id is the reader.
MARKED = ("k.revision%2=1 AND " + READABLE.replace(":actor", "k.actor_id") + " AND NOT EXISTS ("
          "SELECT 1 FROM messages o WHERE o.id=k.message_id AND o.author_id=k.actor_id) AND NOT EXISTS ("
          "SELECT 1 FROM deliveries d CROSS JOIN delivery_groups g ON g.id=d.group_id "
          "WHERE d.message_id=k.message_id AND d.recipient_id=k.actor_id AND d.revision=1 AND d.state='pending' AND g.active=1)")


class Marks:
    def _mark_revision(self, db, actor, message_id):
        row = db.execute("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?", (actor, message_id)).fetchone()
        return row[0] if row else 0

    def _mark_state(self, db, actor, message_id):
        """{marked, mark_revision} for someone else's message whose topic the actor can read, else None."""
        row = db.execute("SELECT topic_id,author_id,private_to FROM messages WHERE id=?", (message_id,)).fetchone()
        if row is None or row["author_id"] == actor or not visible(row, actor) or unsent(db, message_id):
            return None
        try:
            self._topic(db, actor, row["topic_id"])
        except Refusal as error:
            if error.code != "FORBIDDEN":
                raise
            return None
        revision = self._mark_revision(db, actor, message_id)
        return {"marked": revision % 2 == 1, "mark_revision": revision}

    def _command_message_mark(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) != {"marked"} or not isinstance(args["marked"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one message and whether it is marked unread")
        message_id = _identifier(target["message_id"], "message_id")
        message = db.execute("SELECT id,topic_id,seq,author_id,private_to FROM messages WHERE id=?", (message_id,)).fetchone()
        # A whisper someone is not in is refused as an unknown message.
        if message is None or not visible(message, actor) or unsent(db, message_id):
            raise Refusal("FORBIDDEN", "No permission for this message")
        # A mark lives in a topic the person can open; a message read only
        # because it was sent to them by name cannot be marked.
        self._topic(db, actor, message["topic_id"])
        current = self._mark_revision(db, actor, message_id)
        # Every new act is fenced on the revision its sender saw, so a late
        # request never undoes a newer mark or clear.
        if envelope["expected"]["mark_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This mark changed since it was read; nothing was changed",
                          {"mark_revision": current})
        marked = args["marked"]
        result = {"message_id": message_id, "topic_id": message["topic_id"], "seq": message["seq"]}
        if not marked and current % 2 == 0:
            return dict(result, marked=False, mark_revision=current, changed=False), []
        # Marking what is already marked renews it: a new odd revision, so an
        # open that saw the older one can no longer clear it.
        revision = current + (2 if marked and current % 2 == 1 else 1)
        db.execute("INSERT INTO message_marks(actor_id,message_id,topic_id,seq,revision) VALUES (?,?,?,?,?) "
                   "ON CONFLICT(actor_id,message_id) DO UPDATE SET revision=excluded.revision",
                   (actor, message_id, message["topic_id"], message["seq"], revision))
        self._change(db, "actor", actor, "mark", message_id, revision)
        return dict(result, marked=marked, mark_revision=revision, changed=True), [
            {"kind": "mark", "id": message_id, "version": revision}]

    def _view_marks(self, db, actor, args):
        """The actor's marked messages by others in one topic, oldest first, paged by sequence."""
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = _page_size(args)
        rows = db.execute("SELECT k.message_id,k.seq,k.revision FROM message_marks k INDEXED BY reader_marks "
                          "CROSS JOIN messages m ON m.id=k.message_id "
                          "WHERE k.actor_id=? AND k.topic_id=? AND k.revision%2=1 AND k.seq>? AND m.author_id<>? ORDER BY k.seq LIMIT ?",
                          (actor, topic["id"], args.get("cursor", 0), actor, limit + 1)).fetchall()
        return _bounded_page({"instance_id": self.instance_id, "topic_id": topic["id"]}, rows, limit,
                             lambda row: {"message_id": row["message_id"], "seq": row["seq"], "mark_revision": row["revision"]},
                             "seq")

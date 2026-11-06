from __future__ import annotations

"""What each participant in a topic is responsible for, in their own words.

Each active participant keeps one short note on the topic: what they are
doing there. They set it themselves; it shows on the topic beside where the
topic stands, so whoever opens it sees who does what. The topic's creator and
its outcome's owner may also set it through participation.set when they add
someone. The note is kept on the participant's row, which outlives a leave,
so someone who rejoins finds their note as they left it.

A note has its own revision, which only grows: the page and the CLI fence on
the revision they read, so a late request never undoes a newer note, and a
message posted meanwhile does not refuse it.
"""

from .contract import Refusal, _body, _identifier


NOTE_UTF8_BYTES = 1024

# Version 21 gives each participant's note a revision.
RESPONSIBILITY_SCHEMA = ["ALTER TABLE topic_participants ADD COLUMN responsibility_revision INTEGER NOT NULL DEFAULT 0"]
RESPONSIBILITY_DOWN = ("ALTER TABLE topic_participants DROP COLUMN responsibility_revision",)
# A step back would restart revisions at 0, so a stale request could later land.
RESPONSIBILITY_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topic_participants WHERE responsibility_revision>0)"


def responsibility_note(value):
    """A note as it is kept: bounded text, refused rather than cut."""
    note = _body(value)
    if len(note.encode("utf-8")) > NOTE_UTF8_BYTES:
        raise Refusal("BODY_TOO_LARGE", "A responsibility note is at most %d bytes" % NOTE_UTF8_BYTES)
    return note


class Responsibility:
    def _command_responsibility_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"topic_id"} or set(args) != {"note"}:
            raise Refusal("INVALID_ARGUMENT", "Name one topic and say what you are responsible for there")
        topic = self._topic(db, actor, _identifier(target["topic_id"], "topic_id"))
        note = responsibility_note(args["note"])
        row = db.execute("SELECT responsibility,responsibility_revision FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1",
                         (topic["id"], actor)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "Only someone taking part in the topic says what they are responsible for there")
        revision = row["responsibility_revision"]
        if envelope["expected"]["responsibility_revision"] != revision:
            raise Refusal("REVISION_CONFLICT", "Your note changed since it was read; nothing was changed",
                          {"responsibility_revision": revision})
        result = {"topic_id": topic["id"], "actor_id": actor, "note": note}
        if note == row["responsibility"]:
            return dict(result, responsibility_revision=revision, changed=False, version=topic["version"]), []
        revision += 1
        db.execute("UPDATE topic_participants SET responsibility=?,responsibility_revision=? WHERE topic_id=? AND actor_id=?",
                   (note, revision, topic["id"], actor))
        # Everyone reading the topic sees the note change with it.
        version = self._touch_topic(db, topic)
        return dict(result, responsibility_revision=revision, changed=True, version=version), [
            {"kind": "topic", "id": topic["id"], "version": version}]

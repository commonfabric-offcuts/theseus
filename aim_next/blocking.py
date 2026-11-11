from __future__ import annotations

"""An ask that holds a piece or a release (item 259; docs/attention.md, "An ask that blocks work").

An agent's ask may name the one pipeline piece, or the one release of the
topic's outcome, that cannot go on until it is answered (`message.post`'s
`blocks`). Core records it with the message, in the same act, in
`message_blocks`, and never changes it after.

Whether such an ask still waits on someone is not stored again: it is the
rule that clears every ask (TopicState._answered, Reactions._thumb_answer),
read here from the same records each time (_ask_waits). So "Waiting on you",
the outcome light and the pipeline's Held line clear in the act that clears
the ask, and never disagree with each other or with the topic's own wait.
"""

import json

from .contract import Refusal, _identifier, _prefix
from .outcome_asks import held_ask, record_ask
from .reactions import answered_yes
from .standing_conversation import is_conversation


# Version 36 keeps what an ask blocks. A message keeps it as written, so the
# step back is refused once any ask has named one.
BLOCKS_SCHEMA = [
    "CREATE TABLE message_blocks (message_id TEXT PRIMARY KEY REFERENCES messages(id), workspace_id TEXT NOT NULL, "
    "topic_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('piece','release')), ref TEXT NOT NULL)",
    # The pipeline reads a piece's or a release's blocking asks; the reader's waits read their topics' blocking asks.
    "CREATE INDEX blocks_held ON message_blocks(workspace_id, kind, ref, seq)",
    "CREATE INDEX topic_blocks ON message_blocks(topic_id, seq)",
    "CREATE TRIGGER blocks_stay_u BEFORE UPDATE ON message_blocks BEGIN SELECT RAISE(ABORT, 'a message keeps what it blocks'); END",
    "CREATE TRIGGER blocks_stay_d BEFORE DELETE ON message_blocks BEGIN SELECT RAISE(ABORT, 'a message keeps what it blocks'); END",
]
BLOCKS_DOWN = ("DROP TABLE message_blocks",)
BLOCKS_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_blocks)"

# A topic waits on someone from an ask, and counts (it is not archived for them): the first thing _ask_waits asks,
# and the only thing a reader of blocking asks may narrow by before asking _ask_waits, so the two never differ.
WAITS_FROM_AN_ASK = "topic_waiting.ask_message_id IS NOT NULL AND topic_waiting.archived=0"

KINDS = ("piece", "release")
# How long the Held line's words may be: the ask's first line, cut.
LINE_CHARS = 160


def first_line(body):
    """The ask's first line with words, on one line, cut at LINE_CHARS with an ellipsis."""
    line = next((part.strip() for part in (body or "").splitlines() if part.strip()), "")
    line = " ".join(line.split())
    return line if len(line) <= LINE_CHARS else line[:LINE_CHARS - 1].rstrip() + "…"


def order(kind, row):
    """The one order of blocking asks, wherever they are listed (Waiting on you, the light's card, a piece's Held
    lines, and so the CLI and the pages that keep the order they are given): a release's asks before a piece's,
    newest first within each. row is the ask's message row (sent_ms, id)."""
    return (kind != "release", -(row["sent_ms"] or 0), row["id"])


def _shape(blocks):
    """(kind, ref) from a post's `blocks`, refused when it is not one piece or one release."""
    if not isinstance(blocks, dict) or set(blocks) != {"kind", "ref"} or blocks["kind"] not in KINDS:
        raise Refusal("INVALID_ARGUMENT", "blocks is {kind: piece, ref: p-…} or {kind: release, ref: N}")
    ref = blocks["ref"]
    if blocks["kind"] == "release":
        if isinstance(ref, str) and ref.isascii() and ref.isdigit() and ref[0] != "0" and len(ref) <= 9:
            ref = int(ref)
        if type(ref) is not int or ref < 1:
            raise Refusal("INVALID_ARGUMENT", "A release is named by its number: {kind: release, ref: N}")
        return "release", ref
    return "piece", _identifier(ref, "blocks.ref")


class Blocking:
    """Store mixin: recording what an ask blocks, and reading which blocking asks still wait."""

    def _record_blocks(self, db, message_id, blocks):
        """Write what the just-posted message_id blocks, or refuse (and so send nothing): it must be an ask, and name a
        piece being built in its outcome's pipeline or the release being put together there."""
        kind, ref = _shape(blocks)
        message = db.execute("SELECT m.id,m.topic_id,m.seq,m.intent,t.workspace_id FROM messages m JOIN topics t ON t.id=m.topic_id "
                             "WHERE m.id=?", (message_id,)).fetchone()
        if message["intent"] != "ask":
            raise Refusal("BLOCKS_NEEDS_ASK", "Only an ask holds work until it is answered: name who you ask (--asks A), "
                          "or leave out what it blocks; nothing was sent")
        workspace_id = message["workspace_id"]
        if kind == "piece":
            piece = db.execute("SELECT id FROM pipeline_pieces WHERE id=? AND workspace_id=? AND kind='piece'", (ref, workspace_id)).fetchone()
            if piece is None or self._open_entry(db, ref) is None:
                raise Refusal("BLOCKS_UNKNOWN", "%s is not a piece being built in this outcome's pipeline: name one in Now "
                              "(piece:p-…) or the release being put together (release:N); nothing was sent" % ref)
        else:
            release = self._the_release(db, workspace_id)
            if release is None or release["release_number"] != ref:
                being = "release %s is" % release["release_number"] if release else "none is"
                raise Refusal("BLOCKS_UNKNOWN", "Release %s is not being put together in this outcome (%s): name the release "
                              "being put together, or a piece in Now; nothing was sent" % (ref, being))
        db.execute("INSERT INTO message_blocks VALUES (?,?,?,?,?,?)",
                   (message["id"], workspace_id, message["topic_id"], message["seq"], kind, str(ref)))
        return {"kind": kind, "ref": ref}

    def _ask_waits(self, db, topic, message, member):
        """Whether message, an ask in topic, still waits on member: the one rule that clears an ask, read where it is kept.

        The topic waits on member from an ask (its topic_waiting row) only while some ask there does, so none
        waits without that row: losing the topic, a Reached outcome and writing in the topic all end it. An
        archived topic counts nowhere (docs/attention.md), so while it is archived its asks wait on no one here
        either, and unarchiving it brings them back, its row kept. In a
        conversation each ask's own wait is kept (conversation_waits). In a topic an ask an open record still
        needs waits (outcome_asks.held_ask), one a settled record answered does not, and otherwise it waits
        until member writes there on the record or gives it a 👍 that answered it (their thumb row)."""
        if (message["intent"] != "ask" or member == message["author_id"] or member not in json.loads(message["addressees"])
                or db.execute("SELECT 1 FROM topic_waiting WHERE topic_id=? AND actor_id=? AND " + WAITS_FROM_AN_ASK,
                              (topic["id"], member)).fetchone() is None):
            return False
        if is_conversation(topic):
            return db.execute("SELECT 1 FROM conversation_waits WHERE ask_id=? AND actor_id=?", (message["id"], member)).fetchone() is not None
        if held_ask(db, topic["id"], member) == message["id"]:
            return True
        if record_ask(db, message["id"], topic["workspace_id"], topic["id"]):
            return False
        return not (answered_yes(self._reaction_row(db, member, message["id"], "thumb"))
                    or self._answered_since(db, topic, member, message))

    def _blocked_words(self, db, kind, ref):
        """What an ask blocks, for a reader: {kind: release, release: N} or {kind: piece, piece_id, items}."""
        if kind == "release":
            return {"kind": "release", "release": int(ref)}
        items = []
        for (number,) in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY rowid", (ref,)):
            if number not in items:
                items.append(number)
        return {"kind": "piece", "piece_id": ref, "items": items}

    def _blocking_on(self, db, actor, workspace_id=None):
        """The blocking asks that still wait on this reader, in unarchived topics, in the one order (order): each
        release's first, then each piece's, newest first within each. Every blocking ask in a topic whose wait on
        the reader is from an ask is read, by the same words _ask_waits asks first (WAITS_FROM_AN_ASK), and
        _ask_waits alone decides: which ask that wait points at says nothing about the others
        (outcome_asks.release_held moves it on to a newer held ask while older asks still wait), so no reader
        narrows by it."""
        rows = db.execute(
            "SELECT b.kind,b.ref,m.*,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,t.kind AS topic_kind,t.workspace_id,"
            "substr(CAST(w.title AS BLOB),1,1025) AS workspace_title_prefix "
            "FROM topic_waiting INDEXED BY reader_waiting CROSS JOIN message_blocks b INDEXED BY topic_blocks ON b.topic_id=topic_waiting.topic_id "
            "CROSS JOIN messages m ON m.id=b.message_id CROSS JOIN topics t ON t.id=b.topic_id JOIN workspaces w ON w.id=t.workspace_id "
            "WHERE topic_waiting.actor_id=? AND " + WAITS_FROM_AN_ASK + (" AND b.workspace_id=?" if workspace_id is not None else ""),
            (actor,) + ((workspace_id,) if workspace_id is not None else ())).fetchall()
        found = []
        for row in sorted(rows, key=lambda row: order(row["kind"], row)):
            topic = {"id": row["topic_id"], "kind": row["topic_kind"], "workspace_id": row["workspace_id"]}
            if not self._ask_waits(db, topic, row, actor):
                continue
            title, truncated = _prefix(row["title_prefix"])
            outcome, outcome_truncated = _prefix(row["workspace_title_prefix"])
            found.append({"message_id": row["id"], "topic_id": row["topic_id"], "title": title, "title_truncated": truncated,
                          "workspace": {"id": row["workspace_id"], "title": outcome, "title_truncated": outcome_truncated},
                          "by": row["author_id"], "since_ms": row["sent_ms"], "line": first_line(row["body"]),
                          "blocks": self._blocked_words(db, row["kind"], row["ref"])})
        return found

    def _held(self, db, workspace_id, kind, ref):
        """The asks that hold one piece or release and still wait on someone, in the one order (newest first): {message_id,
        topic_id, by, since_ms, waiting_on, line}, waiting_on in the order the ask named them."""
        held = []
        rows = db.execute("SELECT m.*,t.kind AS topic_kind,t.workspace_id FROM message_blocks b INDEXED BY blocks_held "
                          "CROSS JOIN messages m ON m.id=b.message_id CROSS JOIN topics t ON t.id=b.topic_id "
                          "WHERE b.workspace_id=? AND b.kind=? AND b.ref=?", (workspace_id, kind, str(ref))).fetchall()
        for row in sorted(rows, key=lambda row: order(kind, row)):
            topic = {"id": row["topic_id"], "kind": row["topic_kind"], "workspace_id": row["workspace_id"]}
            waiting = [member for member in json.loads(row["addressees"]) if self._ask_waits(db, topic, row, member)]
            if waiting:
                held.append({"message_id": row["id"], "topic_id": row["topic_id"], "by": row["author_id"], "since_ms": row["sent_ms"],
                             "waiting_on": waiting, "line": first_line(row["body"])})
        return held

    def _block_fields(self, db, items):
        """Add `blocks` ({kind, ref}) to each message item of one page that names what it blocks; others carry none."""
        ids = [item["id"] for item in items]
        if not ids:
            return
        found = {row["message_id"]: row for row in db.execute(
            "SELECT message_id,kind,ref FROM message_blocks WHERE message_id IN (%s)" % ",".join("?" * len(ids)), ids)}
        for item in items:
            row = found.get(item["id"])
            if row is not None:
                item["blocks"] = {"kind": row["kind"], "ref": int(row["ref"]) if row["kind"] == "release" else row["ref"]}

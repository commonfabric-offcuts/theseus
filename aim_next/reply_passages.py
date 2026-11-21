from __future__ import annotations

"""Core-owned agent reply provenance; docs/agent-reply-passages.md."""

import json

from .contract import Refusal, _body

FIELDS = ("reply_passage", "reply_without_quote")
LEGACY_HEADING = "Reply without a quote:\n\n"


def prefix(basis):
    text = basis["reason"] if "reason" in basis else basis["excerpt"]
    heading = LEGACY_HEADING if "reason" in basis and basis.get("reason_format") != 2 else ""
    return heading + "\n".join("> " + line for line in text.split("\n")) + "\n\n"


def validate(store, db, actor, snapshot):
    """Reach and whisper routing precede this check. Slice current, unheld raw words."""
    # Root publication has no reply basis. In particular, Core's internal
    # Health author is deliberately disabled and never signs a public command.
    # Its existing root-notice path must not require an active agent binding.
    if not snapshot.get("reply_to") and not any(name in snapshot for name in FIELDS):
        return None
    if store._actor(db, actor)["kind"] != "agent":
        return None
    parent_id = snapshot.get("reply_to")
    choices = [name for name in FIELDS if name in snapshot]
    if not parent_id:
        if choices:
            raise Refusal("INVALID_REPLY_PASSAGE", "A reply passage or reason needs a reply target")
        return None
    if not choices:
        raise Refusal("REPLY_PASSAGE_REQUIRED", "Name reply_passage with its source revision, start and end, or reply_without_quote with the reason")
    if len(choices) != 1:
        raise Refusal("INVALID_REPLY_PASSAGE", "Choose a passage or a reason for omitting it, not both")
    source = store._source(db, actor, {"kind": "message", "id": parent_id})
    return select(source, snapshot)


def select(source, snapshot):
    """Validate the explicit choice against a source answer; also used before CLI uploads."""
    parent_id = snapshot.get("reply_to")
    choices = [name for name in FIELDS if name in snapshot]
    if len(choices) != 1:
        code = "REPLY_PASSAGE_REQUIRED" if not choices else "INVALID_REPLY_PASSAGE"
        raise Refusal(code, "Name one passage you answer, or state why this reply has no quote")
    if source["withheld"]:
        raise Refusal("MESSAGE_HELD", "Its author is editing this message; read it again before replying")
    basis = {"source": dict(source["source_ref"], revision=source["revision"]), "author_id": source["author"]}
    if choices == ["reply_without_quote"]:
        reason = snapshot["reply_without_quote"]
        if not isinstance(reason, str) or not reason.strip():
            raise Refusal("INVALID_REPLY_PASSAGE", "State why this reply has no quoted passage")
        basis["reason"] = _body(reason)
        # Old immutable receipts have no format: their heading stays protected.
        # The new format omits that heading, including on edit and readback.
        basis["reason_format"] = 2
        return basis
    passage = snapshot["reply_passage"]
    if not isinstance(passage, dict) or set(passage) != {"source", "start", "end"}:
        raise Refusal("INVALID_REPLY_PASSAGE", "Name the source revision and the passage's start and end offsets")
    ref = passage["source"]
    if (not isinstance(ref, dict) or set(ref) != {"kind", "id", "revision"}
            or ref.get("kind") != "message" or ref.get("id") != parent_id
            or type(ref.get("revision")) is not int or ref["revision"] < 1):
        raise Refusal("INVALID_REPLY_PASSAGE", "The passage must name this reply's parent and revision")
    if ref["revision"] != source["revision"]:
        raise Refusal("REPLY_SOURCE_CHANGED", "The message changed; read it again and select the passage from its current revision")
    start, end, body = passage["start"], passage["end"], source["body"]
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(body):
        raise Refusal("INVALID_REPLY_PASSAGE", "The passage's offsets must select text inside the source revision")
    basis.update(start=start, end=end, excerpt=body[start:end])
    return basis


def insert(snapshot, basis):
    if basis is None:
        return
    snapshot["body"] = _body(prefix(basis) + snapshot["body"])
    if "excerpt" in basis:
        quote = {key: basis[key] for key in ("source", "start", "end", "excerpt")}
        snapshot["quotes"] = snapshot["quotes"] + [quote]


def read(db, message_id):
    """The receipt is immutable; lookup uses the message and operation primary keys."""
    row = db.execute("SELECT o.outcome FROM messages m JOIN operations o ON o.actor_id=m.author_id AND o.id=m.operation_id "
                     "WHERE m.id=?", (message_id,)).fetchone()
    if row is None:
        return None
    result = json.loads(row[0]).get("result", {})
    return result.get("reply_basis") if result.get("message_id") == message_id else None


def keep_on_edit(db, message_id, body):
    basis = read(db, message_id)
    if basis is not None and not body.startswith(prefix(basis)):
        raise Refusal("REPLY_BASIS_REQUIRED", "Keep the reply's quoted passage or stated reason at its start")


def for_reader(store, db, actor, message_id):
    from .message_edit import withheld
    basis = read(db, message_id)
    if basis is None:
        return None
    try:
        store._message_access(db, actor, basis["source"]["id"])
    except Refusal:
        return None
    return None if withheld(basis["source"]["id"]) else basis

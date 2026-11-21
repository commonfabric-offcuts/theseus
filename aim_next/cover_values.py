from __future__ import annotations

"""A dossier's cover as values (item 624, docs/dossier-covers.md): what a write may say, what is stored, how Done is
read from the owner's record, and what each reader is shown. No effects: covers.py records the acts.

A cover is the newest `cover` act on a dossier's first message (message_acts, owner ''), so it keeps every revision
and is fenced like any other act. It holds three fields, each set or cleared on its own:

- `stands`: lines of where things stand (item 769);
- `waiting`: what waits on the outcome's owner, each with the default that holds if they say nothing;
- `payload`: what the dossier produced, in words, optionally a link and a kind, and the message that delivered it.

Done is never written by anyone. It is read from the owner's record whenever a cover is written or the owner gives or
takes back a 👍 on the payload's message: their 👍 on it, or a reply of theirs to it that the cover's writer names as
the word that made it done (`done_by`). No reply counts unless it is named, and none is read for what its words mean:
a named reply counts because it is the owner's own reply to that message. Until then the cover's payload is proposed.
"""

import json

from .contract import Refusal, _identifier
from .whispers import VISIBLE

# What an empty cover stands at: the act's value before anyone wrote one, and after every field is cleared.
EMPTY_COVER = {"stands": None, "waiting": [], "payload": None}
FIELDS = ("stands", "waiting", "payload")
STANDS_CHARS = 32000
WAIT_CHARS = 300
DEFAULT_CHARS = 200
PAYLOAD_CHARS = 500
LINK_CHARS = 2000
WAITS = 4
# What a payload is, when its writer says: a closed set the page names in words.
PAYLOAD_KINDS = ("answer", "decision", "preview", "page", "release")
DONE_REFUSED = ("Done is the owner's to give: their 👍 on the payload's message, or their own reply to it, named as done_by. "
                "A cover's writer proposes the payload; nothing was changed")


def _line(value, name, limit, required=True, keep_lines=False):
    """Fold whitespace to spaces, retaining LF boundaries only for stands. Empty is None unless required."""
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise Refusal("INVALID_ARGUMENT", "%s is words" % name)
    # Stands keeps LF boundaries; all other fields retain their one-line contract.
    # CRLF becomes LF as CR is folded with whitespace within each line.
    folded = ("\n".join(" ".join(line.split()) for line in value.split("\n")).strip()
              if keep_lines else " ".join(value.split()))
    if not folded:
        if required:
            raise Refusal("INVALID_ARGUMENT", "%s says something" % name)
        return None
    if len(folded) > limit:
        raise Refusal("INVALID_ARGUMENT", "%s is at most %d characters" % (name, limit))
    return folded


def _link(value):
    if value is None:
        return None
    if (not isinstance(value, str) or not value.startswith(("https://", "http://")) or len(value) > LINK_CHARS
            or any(c.isspace() or ord(c) < 32 for c in value)):
        raise Refusal("INVALID_ARGUMENT", "A payload's link is one http or https address of at most %d characters" % LINK_CHARS)
    return value


def _waiting(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > WAITS:
        raise Refusal("INVALID_ARGUMENT", "waiting is a list of at most %d things that wait on the owner" % WAITS)
    waits = []
    for each in value:
        if not isinstance(each, dict) or not {"text", "default"} <= set(each) <= {"text", "default", "message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Each thing waiting names its text and its default: what holds if the owner says nothing")
        wait = {"text": _line(each["text"], "What waits", WAIT_CHARS), "default": _line(each["default"], "Its default", DEFAULT_CHARS)}
        if "message_id" in each:
            wait["message_id"] = None if each["message_id"] is None else _identifier(each["message_id"], "message_id")
        waits.append(wait)
    return waits


def _payload(value):
    """The payload as written: its words, its message, its link and kind or None, and done_by, the owner's reply its
    writer names as the word that made it done, or None. Core checks done_by and adds the message's sequence and Done."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise Refusal("INVALID_ARGUMENT", "A payload names its text and the message that delivered it")
    if "done" in value:
        raise Refusal("DONE_BY_OWNER", DONE_REFUSED)
    if not {"text", "message_id"} <= set(value) <= {"text", "message_id", "link", "kind", "done_by"}:
        raise Refusal("INVALID_ARGUMENT", "A payload names its text and the message that delivered it, and may name a link, a kind "
                      "and the owner's reply that made it done (done_by)")
    kind = value.get("kind")
    if kind is not None and kind not in PAYLOAD_KINDS:
        raise Refusal("INVALID_ARGUMENT", "A payload's kind is one of %s" % ", ".join(PAYLOAD_KINDS))
    done_by = value.get("done_by")
    return {"text": _line(value["text"], "The payload", PAYLOAD_CHARS), "message_id": _identifier(value["message_id"], "message_id"),
            "link": _link(value.get("link")), "kind": kind, "done_by": None if done_by is None else _identifier(done_by, "done_by")}


def written(args):
    """The fields a write sets, validated: {field: value}, each present field set (None or [] clears it). Done is
    refused wherever it is named, and a write names at least one field."""
    if not isinstance(args, dict) or not args:
        raise Refusal("INVALID_ARGUMENT", "A cover write sets or clears stands, waiting or payload")
    if "done" in args:
        raise Refusal("DONE_BY_OWNER", DONE_REFUSED)
    if set(args) - set(FIELDS):
        raise Refusal("INVALID_ARGUMENT", "A cover holds stands, waiting and payload only")
    fields = {}
    if "stands" in args:
        fields["stands"] = _line(args["stands"], "Where it stands", STANDS_CHARS, required=False, keep_lines=True)
    if "waiting" in args:
        fields["waiting"] = _waiting(args["waiting"])
    if "payload" in args:
        fields["payload"] = _payload(args["payload"])
    return fields


def stored_value(raw):
    """A stored cover act's value, every field present."""
    value = dict(EMPTY_COVER, waiting=[])
    if raw:
        value.update(json.loads(raw) if isinstance(raw, str) else raw)
    return value


def owners_word(db, owner, message_id, done_by):
    """The owner's reply done_by names, when it is their own message in reply to message_id (on the record or a
    whisper they wrote: a person's whisper counts as their Tell), or None. What it says is never read."""
    if done_by is None:
        return None
    return db.execute("SELECT id,seq,sent_ms FROM messages WHERE id=? AND reply_to=? AND author_id=?", (done_by, message_id, owner)).fetchone()


def done_of(db, owner, message_id, done_by=None):
    """Done as the owner's record gives it for the payload delivered by message_id, or None: the earlier of their 👍
    on it (a thumb given and not taken back) and their reply to it that the cover names as done_by. No other reply
    counts, whatever it says."""
    found = []
    thumb = db.execute("SELECT revision,at_ms FROM message_reactions WHERE actor_id=? AND message_id=? AND kind='thumb'",
                       (owner, message_id)).fetchone()
    if thumb is not None and thumb["revision"] % 2 == 1:
        found.append((thumb["at_ms"], 0, {"how": "thumb", "by": owner, "at_ms": thumb["at_ms"]}))
    word = owners_word(db, owner, message_id, done_by)
    if word is not None:
        found.append((word["sent_ms"] or 0, 1, {"how": "word", "by": owner, "at_ms": word["sent_ms"], "message_id": word["id"], "seq": word["seq"]}))
    return min(found, key=lambda each: each[:2])[2] if found else None


def shown(db, actor, value, by, at_ms, owner, archived=False):
    """The cover as actor reads it, or None when every field is clear: its fields, who wrote it last and when, and the
    outcome's owner (whose 👍 or word gives Done). A word given in a whisper actor is outside shows as given, with no
    message to open."""
    if value == EMPTY_COVER or (not value["stands"] and not value["waiting"] and value["payload"] is None):
        return None
    payload = value["payload"]
    # done_by is what the writer named; a reader is told Done, which carries the word when they can open it.
    if payload is not None:
        payload = {key: item for key, item in payload.items() if key != "done_by"}
    if payload is not None and payload.get("done") and payload["done"].get("message_id"):
        done = payload["done"]
        seen = db.execute("SELECT 1 FROM messages m WHERE m.id=:id AND " + VISIBLE, {"id": done["message_id"], "actor": actor}).fetchone()
        if seen is None:
            payload = dict(payload, done={key: item for key, item in done.items() if key not in ("message_id", "seq")})
    waiting = []
    for each in () if archived else value["waiting"]:
        if each.get("ask_id"):
            linked = db.execute("SELECT active FROM ask_cover_links WHERE ask_id=? AND actor_id=?", (each["ask_id"], each.get("actor_id"))).fetchone()
            if linked is not None and not linked["active"]:
                continue
        source = each.get("ask_id") or each.get("message_id")
        if source and db.execute("SELECT 1 FROM question_closures WHERE message_id=? UNION ALL SELECT 1 FROM message_withdrawals WHERE message_id=? LIMIT 1", (source, source)).fetchone():
            continue
        waiting.append(dict(each))
    # Only the asked person gets the answer fence. Check the recorded recipients
    # and visibility rather than trusting cover text.
    human = db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()[0] == "human"
    for wait in waiting:
        # Both recorded sources are reader-scoped. A hidden first source can
        # fall through to the visible Ask; neither identifier leaks in a link.
        for key in ("message_id", "ask_id"):
            if wait.get(key) and db.execute("SELECT 1 FROM messages m WHERE m.id=:id AND " + VISIBLE,
                                            {"id": wait[key], "actor": actor}).fetchone() is None:
                del wait[key]
        if not human or wait.get("actor_id") != actor or not wait.get("ask_id"):
            continue
        ask = db.execute("SELECT m.go_ahead,m.addressees FROM messages m WHERE m.id=:id AND " + VISIBLE,
                         {"id": wait["ask_id"], "actor": actor}).fetchone()
        if ask is not None and ask["go_ahead"] and actor in json.loads(ask["addressees"]):
            answer = db.execute("SELECT revision FROM message_reactions WHERE message_id=? AND actor_id=? AND kind='answer'",
                                (wait["ask_id"], actor)).fetchone()
            wait.update(go_ahead=True, answer_revision=answer[0] if answer else 0)
    return {"stands": value["stands"], "waiting": waiting,
            "payload": dict(payload) if payload is not None else None, "by": by, "at_ms": at_ms, "owner": owner}

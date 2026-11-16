from __future__ import annotations

"""A dossier's cover as values (item 624, docs/dossier-covers.md): what a write may say, what is stored, how Done is
read from the owner's record, and what each reader is shown. No effects: covers.py records the acts.

A cover is the newest `cover` act on a dossier's first message (message_acts, owner ''), so it keeps every revision
and is fenced like any other act. It holds three fields, each set or cleared on its own:

- `stands`: one line of where things stand;
- `waiting`: what waits on the outcome's owner, each with the default that holds if they say nothing;
- `payload`: what the dossier produced, in words, optionally a link and a kind, and the message that delivered it.

Done is never written by anyone. It is read from the owner's record whenever a cover is written or the owner acts on
the payload's message: their 👍 on it, or their word in reply to it (a reply that does not ask). Until then the
cover's payload is proposed.
"""

import json

from .contract import Refusal, _identifier
from .whispers import VISIBLE

# What an empty cover stands at: the act's value before anyone wrote one, and after every field is cleared.
EMPTY_COVER = {"stands": None, "waiting": [], "payload": None}
FIELDS = ("stands", "waiting", "payload")
STANDS_CHARS = 300
WAIT_CHARS = 300
DEFAULT_CHARS = 200
PAYLOAD_CHARS = 500
LINK_CHARS = 2000
WAITS = 4
# What a payload is, when its writer says: a closed set the page names in words.
PAYLOAD_KINDS = ("answer", "decision", "preview", "page", "release")
DONE_REFUSED = ("Done is the owner's to give: their 👍 on the payload's message, or their word in reply to it. "
                "A cover's writer proposes the payload; nothing was changed")


def _line(value, name, limit, required=True):
    """One line of words: its spaces and line breaks folded to single spaces. Empty is None unless required."""
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise Refusal("INVALID_ARGUMENT", "%s is words" % name)
    folded = " ".join(value.split())
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
        if not isinstance(each, dict) or set(each) != {"text", "default"}:
            raise Refusal("INVALID_ARGUMENT", "Each thing waiting names its text and its default: what holds if the owner says nothing")
        waits.append({"text": _line(each["text"], "What waits", WAIT_CHARS), "default": _line(each["default"], "Its default", DEFAULT_CHARS)})
    return waits


def _payload(value):
    """The payload as written: its words, its message, and its link and kind or None. Core adds the message's
    sequence and Done."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise Refusal("INVALID_ARGUMENT", "A payload names its text and the message that delivered it")
    if "done" in value:
        raise Refusal("DONE_BY_OWNER", DONE_REFUSED)
    if not {"text", "message_id"} <= set(value) <= {"text", "message_id", "link", "kind"}:
        raise Refusal("INVALID_ARGUMENT", "A payload names its text and the message that delivered it, and may name a link and a kind")
    kind = value.get("kind")
    if kind is not None and kind not in PAYLOAD_KINDS:
        raise Refusal("INVALID_ARGUMENT", "A payload's kind is one of %s" % ", ".join(PAYLOAD_KINDS))
    return {"text": _line(value["text"], "The payload", PAYLOAD_CHARS), "message_id": _identifier(value["message_id"], "message_id"),
            "link": _link(value.get("link")), "kind": kind}


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
        fields["stands"] = _line(args["stands"], "Where it stands", STANDS_CHARS, required=False)
    if "waiting" in args:
        fields["waiting"] = _waiting(args["waiting"])
    if "payload" in args:
        fields["payload"] = _payload(args["payload"])
    return fields


def stored_value(raw):
    """A stored cover act's value, every field present."""
    value = dict(EMPTY_COVER)
    if raw:
        value.update(json.loads(raw) if isinstance(raw, str) else raw)
    return value


def done_of(db, owner, message_id):
    """Done as the owner's record gives it for the payload delivered by message_id, or None: the earlier of their 👍
    on it (a thumb given and not taken back) and their first word in reply to it that does not ask. A word is the
    owner's own message, on the record or a whisper they wrote (a person's whisper counts as their Tell), read under
    the whisper rule as the owner reads."""
    found = []
    thumb = db.execute("SELECT revision,at_ms FROM message_reactions WHERE actor_id=? AND message_id=? AND kind='thumb'",
                       (owner, message_id)).fetchone()
    if thumb is not None and thumb["revision"] % 2 == 1:
        found.append((thumb["at_ms"], 0, {"how": "thumb", "by": owner, "at_ms": thumb["at_ms"]}))
    word = db.execute("SELECT m.id,m.seq,m.sent_ms FROM messages m INDEXED BY message_reply_links WHERE m.reply_to=:payload "
                      "AND m.author_id=:actor AND (m.intent IS NULL OR m.intent<>'ask') AND " + VISIBLE + " ORDER BY m.seq LIMIT 1",
                      {"payload": message_id, "actor": owner}).fetchone()
    if word is not None:
        found.append((word["sent_ms"] or 0, 1, {"how": "word", "by": owner, "at_ms": word["sent_ms"], "message_id": word["id"], "seq": word["seq"]}))
    return min(found, key=lambda each: each[:2])[2] if found else None


def shown(db, actor, value, by, at_ms, owner):
    """The cover as actor reads it, or None when every field is clear: its fields, who wrote it last and when, and the
    outcome's owner (whose 👍 or word gives Done). A word given in a whisper actor is outside shows as given, with no
    message to open."""
    if value == EMPTY_COVER or (not value["stands"] and not value["waiting"] and value["payload"] is None):
        return None
    payload = value["payload"]
    if payload is not None and payload.get("done") and payload["done"].get("message_id"):
        done = payload["done"]
        seen = db.execute("SELECT 1 FROM messages m WHERE m.id=:id AND " + VISIBLE, {"id": done["message_id"], "actor": actor}).fetchone()
        if seen is None:
            payload = dict(payload, done={key: item for key, item in done.items() if key not in ("message_id", "seq")})
    return {"stands": value["stands"], "waiting": [dict(each) for each in value["waiting"]],
            "payload": dict(payload) if payload is not None else None, "by": by, "at_ms": at_ms, "owner": owner}

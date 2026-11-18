from __future__ import annotations

"""Explicit promise records on the existing dossier cover (docs/dossier-covers.md).
No interpretation of prose, clock-driven state or acceptance of the payload.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .contract import Refusal, _identifier
from .delivery import _now_ms
from .message_edit import words_at

PROMISES = 8
PROMISE_CHARS = 500
INPUT_FIELDS = {"id", "text", "message_id", "source_revision", "due", "state"}


def due_time(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"at_ms", "time_zone"}:
        raise Refusal("INVALID_ARGUMENT", "A promise time names at_ms and time_zone, or is null")
    ms, zone = value["at_ms"], value["time_zone"]
    if type(ms) is not int or not isinstance(zone, str) or not zone or len(zone) > 100:
        raise Refusal("INVALID_ARGUMENT", "A promise time is an integer instant and a named timezone")
    try:
        local = datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(ZoneInfo(zone))
        offset = local.strftime("%z")
        label = "%s %s:%s · %s" % (local.strftime("%Y-%m-%d %H:%M"), offset[:3], offset[3:], zone)
    except (ValueError, OverflowError, OSError, ZoneInfoNotFoundError):
        raise Refusal("INVALID_ARGUMENT", "A promise time needs a valid instant and named timezone")
    return {"at_ms": ms, "time_zone": zone, "offset_seconds": int(local.utcoffset().total_seconds()), "label": label}


def written_promises(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > PROMISES:
        raise Refusal("INVALID_ARGUMENT", "promises is a list of at most %d explicit promises" % PROMISES)
    found, ids = [], set()
    for each in value:
        if not isinstance(each, dict) or set(each) != INPUT_FIELDS:
            raise Refusal("INVALID_ARGUMENT", "A promise names id, text, message_id, source_revision, due and state")
        key = _identifier(each["id"], "promise id")
        if key in ids:
            raise Refusal("INVALID_ARGUMENT", "Each promise has its own id")
        ids.add(key)
        text, revision, state = each["text"], each["source_revision"], each["state"]
        if not isinstance(text, str) or not text.strip() or len(text) > PROMISE_CHARS:
            raise Refusal("INVALID_ARGUMENT", "A promise is exact source words, at most %d characters" % PROMISE_CHARS)
        if type(revision) is not int or revision < 1 or state not in ("promised", "kept", "missed"):
            raise Refusal("INVALID_ARGUMENT", "A promise names a source revision and promised, kept or missed")
        found.append({"id": key, "text": text, "message_id": _identifier(each["message_id"], "message_id"),
                      "source_revision": revision, "due": due_time(each["due"]), "state": state})
    return found


def record_promises(db, actor, root, values, before, source_of):
    """Resolve sources and preserve attributed history; identical inputs retain their original clock facts."""
    previous = {each["id"]: each for each in before}
    records = []
    for value in values:
        source = source_of(db, actor, root, value["message_id"])
        words = words_at(db, source["id"], value["source_revision"], plain=True)
        if words is None or value["text"] not in words[0]:
            raise Refusal("INVALID_ARGUMENT", "A promise keeps exact words of its named source revision; nothing was changed")
        old = previous.get(value["id"])
        same = old is not None and all(old.get(key) == value[key] for key in INPUT_FIELDS - {"due"})
        # Compare supplied clock facts, not a label recomputed under potentially updated timezone rules.
        same = same and ((old["due"] is None and value["due"] is None) or
                         (old["due"] is not None and value["due"] is not None and
                          all(old["due"][key] == value["due"][key] for key in ("at_ms", "time_zone"))))
        if same:
            records.append(old)
            continue
        history = old["history"] + [dict(old, history=[])] if old is not None else []
        records.append(dict(value, seq=source["seq"], source_author=source["author_id"], by=actor, at_ms=_now_ms(), history=history))
    return records

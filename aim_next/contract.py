from __future__ import annotations

import json


LIMITS = {
    "body_utf8_bytes": 1048576, "recipients": 32, "topic_participants": 32, "workspace_members": 128,
    "page_default": 50, "page_max": 100, "summary_utf8_bytes": 131072,
    "http_envelope_bytes": 2097152, "image_bytes": 16777216,
    "attachment_count": 8, "attachment_bytes": 67108864,
    "memory_references": 32,
    "media_file_bytes": 67108864, "media_name_utf8_bytes": 1024,
}


class StoreError(Exception):
    """An unusable store or a non-business storage failure."""


class Refusal(Exception):
    def __init__(self, code, message, current_versions=None, recorded=None):
        self.code = code
        self.message = message
        self.current_versions = current_versions
        self.recorded = (code != "INVALID_ARGUMENT") if recorded is None else recorded
        super().__init__(message)


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _identifier(value, name="identifier"):
    if not isinstance(value, str) or not value or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise Refusal("INVALID_ARGUMENT", "Invalid %s" % name)
    return value


def _body(value):
    if not isinstance(value, str):
        raise Refusal("INVALID_ARGUMENT", "Text must be a string")
    if len(value.encode("utf-8")) > LIMITS["body_utf8_bytes"]:
        raise Refusal("BODY_TOO_LARGE", "Writing exceeds the body limit; it has not been truncated")
    return value


def _page_size(args):
    limit = args.get("limit", LIMITS["page_default"])
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMITS["page_max"]:
        raise Refusal("INVALID_ARGUMENT", "Invalid page size")
    return limit


def _prefix(raw, size=1024):
    """Decode a size+1 byte SQL prefix to at most size UTF-8 bytes, and say whether text was cut."""
    raw = bytes(raw)
    text = raw[:size].decode("utf-8", errors="ignore")
    return text, len(raw) > len(text.encode("utf-8"))


def _bounded_page(answer, rows, limit, item, key):
    """Fill a page from limit + 1 rows until the summary byte bound; next_cursor is the last kept key."""
    items = []

    def response():
        return dict(answer, items=list(items), next_cursor=items[-1][key] if items and len(rows) > len(items) else None)

    for row in rows[:limit]:
        items.append(item(row))
        if len(_json(response()).encode("utf-8")) > LIMITS["summary_utf8_bytes"]:
            items.pop()
            if not items:
                raise Refusal("VIEW_TOO_LARGE", "A preview cannot fit in the bounded response")
            break
    return response()


def _revision(expected, name, actual):
    value = expected.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise Refusal("INVALID_ARGUMENT", "An expected revision is required")
    if value != actual:
        raise Refusal("REVISION_CONFLICT", "Writing changed; preserve this attempt and reconcile", {name: actual})

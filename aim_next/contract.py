from __future__ import annotations

import json


LIMITS = {
    "body_utf8_bytes": 1048576, "recipients": 32, "topic_participants": 32,
    "page_default": 50, "page_max": 100, "summary_utf8_bytes": 131072,
    "http_envelope_bytes": 2097152, "image_bytes": 16777216,
    "attachment_count": 8, "attachment_bytes": 67108864,
}


class StoreError(Exception):
    """An unusable store or a non-business storage failure."""


class Refusal(Exception):
    def __init__(self, code, message, current_versions=None):
        self.code = code
        self.message = message
        self.current_versions = current_versions
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


def _revision(expected, name, actual):
    value = expected.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise Refusal("INVALID_ARGUMENT", "An expected revision is required")
    if value != actual:
        raise Refusal("REVISION_CONFLICT", "Writing changed; preserve this attempt and reconcile", {name: actual})

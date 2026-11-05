from __future__ import annotations

from .contract import LIMITS, Refusal, _identifier, _json


COMMANDS = {
    "workspace.create": "_command_workspace_create",
    "workspace.member_set": "_command_workspace_member_set",
    "draft.save": "_command_draft_save",
    "note.save": "_command_note_save",
    "submission.prepare": "_command_submission_prepare",
    "topic.create_and_send": "_command_topic_create_and_send",
    "message.send": "_command_message_send",
    "message.post": "_command_message_post",
    "topic.read_through": "_command_topic_read_through",
    "participation.set": "_command_participation_set",
    "topic.update": "_command_topic_update",
    "delivery.ack": "_command_delivery_ack",
    "memory.create": "_command_memory_create", "memory.revise": "_command_memory_revise",
    "media.begin": "_command_media_begin", "media.publish": "_command_media_publish",
    "opening.save": "_command_opening_save", "opening.publish": "_command_opening_publish",
    "opening.discard": "_command_opening_discard",
}
EXPECTED = {"workspace.create": {"workspace_revision"}, "draft.save": {"draft_revision"},
            "note.save": {"note_revision"}, "submission.prepare": {"draft_revision"},
            "participation.set": {"topic_revision"}, "topic.update": {"topic_revision"}, "message.send": set(), "topic.create_and_send": set(), "delivery.ack": set(),
            "message.post": set(), "topic.read_through": set(),
            "memory.create": {"item_revision"}, "memory.revise": {"item_revision"},
            "media.begin": {"media_revision"}, "media.publish": {"media_revision"},
            "workspace.member_set": {"workspace_revision"}, "opening.save": {"opening_revision"},
            "opening.publish": {"opening_revision"}, "opening.discard": {"opening_revision"}}
REQUIRED_EXPECTED = {"draft.save": "draft_revision", "note.save": "note_revision",
                     "submission.prepare": "draft_revision", "participation.set": "topic_revision", "topic.update": "topic_revision",
                     "memory.create": "item_revision", "memory.revise": "item_revision",
                     "media.begin": "media_revision", "media.publish": "media_revision",
                     "workspace.member_set": "workspace_revision", "opening.save": "opening_revision",
                     "opening.publish": "opening_revision", "opening.discard": "opening_revision"}
VIEWS = {
    "changes": {"scope", "cursor", "limit"},
    "capabilities": set(), "operation": {"operation_id"}, "workspace": {"workspace_id"},
    "workspaces": {"cursor", "limit"},
    "workspace_topics": {"workspace_id", "cursor", "limit", "archived"}, "topic": {"topic_id"},
    "topic_messages": {"topic_id", "cursor", "limit", "audience", "direction"}, "source": {"source_ref", "kind", "id", "revision"},
    "memory_items": {"owner_scope", "cursor", "limit"},
    "media": {"media_id", "source_ref"},
    "editor_state": {"source_ref", "topic_id", "cursor", "limit"},
    "submission": {"submission_id"}, "submissions": {"source_ref", "topic_id", "cursor", "limit"},
    "deliveries": {"cursor", "limit"}, "delivery": {"delivery_id"},
    "opening": {"opening_id"}, "openings": {"workspace_id", "cursor", "limit"},
    "workspace_members": {"workspace_id", "cursor", "limit"},
    "attention": set(),
}


def _valid_json(value):
    try:
        encoded = _json(value).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise Refusal("INVALID_ARGUMENT", "Input must be finite UTF-8 JSON")
    if len(encoded) > LIMITS["http_envelope_bytes"]:
        raise Refusal("INVALID_ARGUMENT", "Input exceeds the command envelope limit")
    return encoded


def _command_envelope(envelope):
    _valid_json(envelope)
    if type(envelope.get("v")) is not int or envelope["v"] != 1:
        raise Refusal("INVALID_ARGUMENT", "Unsupported command version")
    if set(envelope) - {"v", "instance_id", "operation_id", "kind", "target", "expected", "args"}:
        raise Refusal("INVALID_ARGUMENT", "Unsupported command envelope fields")
    normalized = dict(envelope)
    for key in ("target", "expected", "args"):
        normalized.setdefault(key, {})
        if not isinstance(normalized[key], dict):
            raise Refusal("INVALID_ARGUMENT", "%s must be an object" % key)
    for key in ("instance_id", "operation_id", "kind"):
        _identifier(normalized.get(key), key)
    kind, expected = normalized["kind"], normalized["expected"]
    authority = expected.get("authority")
    if not isinstance(authority, dict) or set(authority) != {"authority_id", "authority_epoch"}:
        raise Refusal("INVALID_ARGUMENT", "An exact captured authority pair is required")
    for key in ("authority_id", "authority_epoch"):
        _identifier(authority[key], key)
    if kind in EXPECTED and set(expected) - EXPECTED[kind] - {"authority"}:
        raise Refusal("INVALID_ARGUMENT", "Unsupported expected revision fields")
    required = REQUIRED_EXPECTED.get(kind)
    if required is not None and required not in expected:
        raise Refusal("INVALID_ARGUMENT", "An explicit %s is required" % required)
    for key, value in expected.items():
        if key == "authority":
            continue
        if type(value) is not int or value < 0 or value > 9223372036854775807:
            raise Refusal("INVALID_ARGUMENT", "Expected revisions must be nonnegative integers")
    return normalized


def _view_arguments(name, args):
    _identifier(name, "view")
    if not isinstance(args, dict):
        raise Refusal("INVALID_ARGUMENT", "View arguments must be an object")
    _valid_json(args)
    if name not in VIEWS:
        raise Refusal("UNKNOWN_VIEW", "Unsupported view")
    # No public or private view can substitute an actor from a JSON field.
    if set(args) - VIEWS[name]:
        raise Refusal("INVALID_ARGUMENT", "Unsupported view arguments, including actor or owner overrides")
    if name == "topic_messages" and (args.get("audience", "all") not in ("all", "reader")
                                      or args.get("direction", "after") not in ("before", "after")):
        raise Refusal("INVALID_ARGUMENT", "Invalid message audience or direction")
    if (name == "editor_state" and args.get("topic_id") is None
            and isinstance(args.get("source_ref"), dict) and args["source_ref"].get("kind") not in ("new_topic", "topic")):
        # A private note has no reply destination. Normalize only this view;
        # commands, opening editors and other ID arguments retain their rules.
        args = dict(args)
        args.pop("topic_id", None)
    for key in ("workspace_id", "topic_id", "operation_id", "submission_id", "opening_id", "delivery_id", "id"):
        if key in args:
            _identifier(args[key], key)
    if "cursor" in args:
        cursor = args["cursor"]
        if name == "changes":
            from .changes import _cursor
            _cursor(cursor)
        elif name == "deliveries":
            from .delivery import _position
            if cursor is None:
                raise Refusal("INVALID_ARGUMENT", "Invalid delivery page cursor")
            _position(cursor)
        elif name in ("workspaces", "workspace_topics", "openings", "workspace_members"):
            if cursor != "":
                _identifier(cursor, "cursor")
            elif not isinstance(cursor, str):
                raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
        elif type(cursor) is not int or not 0 <= cursor <= 9223372036854775807:
            raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
    return args

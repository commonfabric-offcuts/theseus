from __future__ import annotations

from .contract import LIMITS, Refusal, _identifier, _json


COMMANDS = {
    "workspace.create": "_command_workspace_create",
    "draft.save": "_command_draft_save",
    "note.save": "_command_note_save",
    "submission.prepare": "_command_submission_prepare",
    "topic.create_and_send": "_command_topic_create_and_send",
    "message.send": "_command_message_send",
    "participation.set": "_command_participation_set",
}
EXPECTED = {"workspace.create": {"workspace_revision"}, "draft.save": {"draft_revision"},
            "note.save": {"note_revision"}, "submission.prepare": {"draft_revision"},
            "participation.set": {"topic_revision"}, "message.send": set(), "topic.create_and_send": set()}
REQUIRED_EXPECTED = {"draft.save": "draft_revision", "note.save": "note_revision",
                     "submission.prepare": "draft_revision", "participation.set": "topic_revision"}
VIEWS = {
    "capabilities": set(), "operation": {"operation_id"}, "workspace": {"workspace_id"},
    "workspace_topics": {"workspace_id", "cursor", "limit"}, "topic": {"topic_id"},
    "topic_messages": {"topic_id", "cursor", "limit"}, "source": {"source_ref", "kind", "id", "revision"},
    "editor_state": {"source_ref", "topic_id", "cursor", "limit"},
    "submission": {"submission_id"}, "submissions": {"source_ref", "topic_id", "cursor", "limit"},
    "deliveries": {"cursor", "limit"},
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
    if kind in EXPECTED and set(expected) - EXPECTED[kind]:
        raise Refusal("INVALID_ARGUMENT", "Unsupported expected revision fields")
    required = REQUIRED_EXPECTED.get(kind)
    if required is not None and required not in expected:
        raise Refusal("INVALID_ARGUMENT", "An explicit %s is required" % required)
    for value in expected.values():
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
    for key in ("workspace_id", "topic_id", "operation_id", "submission_id", "id"):
        if key in args:
            _identifier(args[key], key)
    if "cursor" in args:
        cursor = args["cursor"]
        if name == "workspace_topics":
            if cursor != "":
                _identifier(cursor, "cursor")
            elif not isinstance(cursor, str):
                raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
        elif type(cursor) is not int or not 0 <= cursor <= 9223372036854775807:
            raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
    return args

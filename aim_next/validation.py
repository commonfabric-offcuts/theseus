from __future__ import annotations

from .contract import LIMITS, Refusal, _identifier, _json


COMMANDS = {
    "release_card.create": "_command_release_card_create", "release_card.update": "_command_release_card_update",
    "performance.record": "_command_performance_record",
    "current_rule.update": "_command_current_rule_update",
    "pipeline.clock_record": "_command_pipeline_clock_record",
    **{"assessment."+name: "_command_assessment_"+name for name in ("request","attach","finish","renew","abandon")},
    "agent.execution": "_command_agent_execution",
    "workspace.create": "_command_workspace_create",
    "workspace.member_set": "_command_workspace_member_set",
    "workspace.agent_invite": "_command_workspace_agent_invite",
    "workspace.hosted_seat_add": "_command_workspace_hosted_seat_add",
    "workspace.hosted_seat_retry": "_command_workspace_hosted_seat_retry",
    "workspace.hosted_seat_end": "_command_workspace_hosted_seat_end",
    "workspace.hosted_seat_refresh": "_command_workspace_hosted_seat_refresh",
    "workspace.owner_set": "_command_workspace_owner_set",
    "workspace.update": "_command_workspace_update",
    "workspace.link_set": "_command_workspace_link_set",
    "draft.save": "_command_draft_save",
    "note.save": "_command_note_save",
    "submission.prepare": "_command_submission_prepare",
    "submission.set_aside": "_command_submission_set_aside",
    "topic.create_and_send": "_command_topic_create_and_send",
    "message.send": "_command_message_send",
    "message.post": "_command_message_post",
    "message.withdraw": "_command_message_withdraw", "message.unsend": "_command_message_unsend", "message.retract": "_command_message_retract",
    "message.resolve": "_command_message_resolve",
    "message.edit": "_command_message_edit",
    "message.refresh": "_command_message_refresh",
    "message.edit_open": "_command_message_edit_open", "message.edit_draft": "_command_message_edit_draft",
    "message.edit_close": "_command_message_edit_close",
    "topic.read_through": "_command_topic_read_through",
    "participation.set": "_command_participation_set",
    "topic.update": "_command_topic_update",
    "delivery.ack": "_command_delivery_ack",
    "memory.create": "_command_memory_create", "memory.revise": "_command_memory_revise",
    "memory.read": "_command_memory_read",
    "memory.star": "_command_memory_star", "memory.delete": "_command_memory_delete",
    "memory.move": "_command_memory_move", "memory.copy": "_command_memory_copy", "memory.transfer.undo": "_command_memory_transfer_undo",
    "media.begin": "_command_media_begin", "media.publish": "_command_media_publish",
    "opening.save": "_command_opening_save", "opening.publish": "_command_opening_publish",
    "opening.discard": "_command_opening_discard",
    "message.mark": "_command_message_mark",
    "message.thumb": "_command_message_thumb", "message.answer": "_command_message_answer",
    "color.set": "_command_color_set", "outcome.color_set": "_command_outcome_color_set",
    "responsibility.set": "_command_responsibility_set",
    "workspace.coordinator_set": "_command_workspace_coordinator_set",
    "pipeline.configure": "_command_pipeline_configure",
    "pipeline.stages_set": "_command_pipeline_stages_set",
    "pipeline.item_add": "_command_pipeline_item_add",
    "pipeline.source_add": "_command_pipeline_source_add",
    "pipeline.item_edit": "_command_pipeline_item_edit",
    "pipeline.item_move": "_command_pipeline_item_move",
    "pipeline.piece_start": "_command_pipeline_piece_start",
    "pipeline.freeze": "_command_pipeline_freeze",
    "pipeline.piece_move": "_command_pipeline_piece_move",
    "pipeline.stage_enter": "_command_pipeline_stage_enter",
    "pipeline.stage_note": "_command_pipeline_stage_note",
    "pipeline.combine": "_command_pipeline_combine",
    "pipeline.piece_finish": "_command_pipeline_piece_finish",
    "target.propose": "_command_target_propose",
    "target.settle": "_command_target_settle",
    "check.define": "_command_check_define",
    "check.report": "_command_check_report",
    "check.accept_worse": "_command_check_accept_worse",
    "problem.file": "_command_problem_file",
    "problem.cover": "_command_problem_cover",
    "outcome.kind_set": "_command_outcome_kind_set",
    "outcome.reach": "_command_outcome_reach",
    "outcome.end_set": "_command_outcome_end_set",
    "outline.order_set": "_command_outline_order_set",
    "rail.dimming_set": "_command_rail_dimming_set",
    "message.star": "_command_message_star", "message.deal": "_command_message_deal", "message.fold": "_command_message_fold",
    "message.fold_through": "_command_message_fold_through",
    "stack.aside": "_command_stack_aside", "stack.place": "_command_stack_place", "stack.level": "_command_stack_level", "stack.name": "_command_stack_name", "stack.join": "_command_stack_join",
    "stack.cover": "_command_stack_cover", "stack.move": "_command_stack_move",
    "stack.cover_refresh": "_command_stack_cover_refresh",
    "tool.use": "_command_tool_use", "tool.link": "_command_tool_link", "tool.record": "_command_tool_record",
}
EXPECTED = {"release_card.create": set(), "release_card.update": {"message_revision"}, "current_rule.update": {"rule_revision", "item_revision"},"workspace.link_set": {"link_revision"},**{"assessment."+name:set() for name in ("request","attach","finish","renew","abandon")},"agent.execution": {"execution_revision"}, "workspace.create": {"workspace_revision"}, "draft.save": {"draft_revision"},
            "note.save": {"note_revision"}, "submission.prepare": {"draft_revision"}, "submission.set_aside": set(),
            "participation.set": {"topic_revision"}, "topic.update": {"topic_revision", "topic_fields"}, "message.send": set(), "topic.create_and_send": set(), "delivery.ack": set(),
            "message.post": set(), "message.withdraw": set(), "message.unsend": set(), "message.retract": set(), "message.resolve": set(), "topic.read_through": set(), "message.edit": {"message_revision"}, "message.refresh": {"message_revision"},
            "message.edit_open": set(), "message.edit_draft": {"session_revision"}, "message.edit_close": set(),
            "memory.create": {"item_revision"}, "memory.revise": {"item_revision"}, "memory.read": set(), "memory.star": {"star_revision"}, "memory.delete": {"item_revision"},
            "memory.move": {"item_revision"}, "memory.copy": {"item_revision", "copy_revision"}, "memory.transfer.undo": {"item_revision", "copy_revision"},
            "media.begin": {"media_revision"}, "media.publish": {"media_revision"},
            "workspace.member_set": {"workspace_revision"}, "workspace.owner_set": {"workspace_revision"},
            "workspace.agent_invite": {"workspace_revision"},
            "workspace.hosted_seat_add": {"workspace_revision"},
            "workspace.hosted_seat_retry": {"seat_revision"},
            "workspace.hosted_seat_end": {"seat_revision"},
            "workspace.hosted_seat_refresh": {"workspace_revision"},
            "workspace.update": {"workspace_revision"}, "opening.save": {"opening_revision"},
            "opening.publish": {"opening_revision"}, "opening.discard": {"opening_revision"},
            "message.mark": {"mark_revision"}, "color.set": {"color_revision"}, "outcome.color_set": {"color_revision"},
            "message.thumb": {"thumb_revision"}, "message.answer": {"answer_revision"},
            "responsibility.set": {"responsibility_revision"}, "workspace.coordinator_set": {"workspace_revision"},
            "pipeline.configure": {"pipeline_revision"},
            "pipeline.stages_set": {"pipeline_revision"},
            "pipeline.item_add": set(),
            "pipeline.source_add": {"item_revision"},
            "pipeline.item_edit": {"item_revision"},
            "pipeline.item_move": {"item_revision"},
            "pipeline.piece_start": set(),
            "pipeline.freeze": {"piece_revision"},
            "pipeline.piece_move": {"piece_revision"},
            "pipeline.stage_enter": {"piece_revision"},
            "pipeline.stage_note": {"piece_revision"},
            "pipeline.combine": set(),
            "pipeline.piece_finish": {"piece_revision"},
            "target.propose": {"target_revision"},
            "target.settle": {"target_revision"},
            "check.define": {"checks_revision"},
            "check.report": set(),
            "check.accept_worse": {"checks_revision"},
            "problem.file": set(),
            "problem.cover": {"problem_revision"},
            "outcome.kind_set": {"workspace_revision"},
            "outcome.reach": {"workspace_revision"},
            "outcome.end_set": {"workspace_revision"},
            "outline.order_set": {"order_revision"},
            "rail.dimming_set": {"dim_revision"},
            "message.star": {"star_revision"}, "message.deal": {"deal_revision"}, "message.fold": {"fold_revision"}, "message.fold_through": {"fold_revision"}, "stack.aside": {"aside_revision"},
            "stack.place": {"place_revision"}, "stack.level": {"level_revision"}, "stack.name": {"name_revision"}, "stack.join": {"join_revision"},
            "stack.cover": {"cover_revision"}, "stack.cover_refresh": {"cover_revision"},
            "stack.move": {"move_revision", "source_topic_id"},
            "tool.use": set(), "tool.link": set(), "tool.record": set()}
REQUIRED_EXPECTED = {"release_card.update": "message_revision", "current_rule.update": "rule_revision","workspace.link_set": "link_revision","agent.execution": "execution_revision", "draft.save": "draft_revision", "note.save": "note_revision",
                     "submission.prepare": "draft_revision", "participation.set": "topic_revision",
                     "memory.create": "item_revision", "memory.revise": "item_revision", "memory.star": "star_revision", "memory.delete": "item_revision",
                     "memory.move": "item_revision", "memory.copy": "item_revision", "memory.transfer.undo": "item_revision",
                     "media.begin": "media_revision", "media.publish": "media_revision",
                     "workspace.member_set": "workspace_revision", "workspace.owner_set": "workspace_revision",
                     "workspace.agent_invite": "workspace_revision",
                     "workspace.hosted_seat_add": "workspace_revision",
                     "workspace.hosted_seat_retry": "seat_revision",
                     "workspace.hosted_seat_end": "seat_revision",
                     "workspace.hosted_seat_refresh": "workspace_revision",
                     "workspace.update": "workspace_revision", "opening.save": "opening_revision",
                     "opening.publish": "opening_revision", "opening.discard": "opening_revision",
                     "message.mark": "mark_revision", "color.set": "color_revision", "outcome.color_set": "color_revision", "message.edit": "message_revision", "message.refresh": "message_revision",
                     "message.edit_draft": "session_revision",
                     "message.thumb": "thumb_revision", "message.answer": "answer_revision",
                     "responsibility.set": "responsibility_revision", "workspace.coordinator_set": "workspace_revision",
                     "outline.order_set": "order_revision",
                     "rail.dimming_set": "dim_revision",
                     "message.star": "star_revision", "message.deal": "deal_revision", "message.fold": "fold_revision", "message.fold_through": "fold_revision", "stack.aside": "aside_revision",
                     "stack.place": "place_revision", "stack.level": "level_revision", "stack.name": "name_revision", "stack.join": "join_revision",
                     "stack.move": "move_revision", "stack.cover": "cover_revision", "stack.cover_refresh": "cover_revision"}
EXPECTED["pipeline.clock_record"] = {"clock_revision"}
EXPECTED["performance.record"] = set()
REQUIRED_EXPECTED["pipeline.clock_record"] = "clock_revision"
VIEWS = {
    "release_card": {"message_id", "workspace_id", "release"},
    "current_rule": {"workspace_id", "history"},
    "work_context": {"workspace_id", "piece_id", "topic_id", "topic_ids"},
    "pipeline_clock": {"piece_id"},
    "pipeline_predictions": {"workspace_id", "piece_ids", "from_ms", "until_ms", "work_class"},
    "workspace_links": {"workspace_id", "cursor", "limit"},
    "submission_mention_reach": {"submission_id", "cursor", "limit"},
    "rail_dimming": {"candidate"},
    "hosted_seat": {"workspace_id", "seat_request_id"},
    "hosted_seat_refresh": {"workspace_id", "actor_ids"},
    "hosted_seats": {"workspace_id", "cursor", "limit"},
    "hosted_seat_templates": {"workspace_id"},
    "onboarding_prompt": {"workspace_id", "variant"},
    "assessment": {"assessment_id"}, "assessments": {"topic_id","cursor","limit"},
    "changes": {"scope", "cursor", "limit"},
    "capabilities": set(), "operation": {"operation_id", "expected_fingerprint"}, "workspace": {"workspace_id"},
    "workspaces": {"cursor", "limit", "reached", "ended"},
    "workspace_counts": {"workspace_ids"},
    "outcome_light": {"workspace_id"},
    "workspace_topics": {"workspace_id", "cursor", "limit", "archived", "done", "build"}, "topic": {"topic_id"},
    "topic_messages": {"topic_id", "cursor", "limit", "audience", "direction", "items", "message_ids", "position_format"}, "source": {"source_ref", "kind", "id", "revision"},
    "topic_images": {"topic_id", "limit"},
    "memory_stars": {"topic_id", "cursor", "limit"},
    "memory_items": {"owner_scope", "cursor", "limit"}, "memory_current": {"item_id"}, "memory_status": {"item_id"},
    "media": {"media_id", "source_ref"},
    "editor_state": {"source_ref", "topic_id", "cursor", "limit", "unsent"},
    "submission": {"submission_id"}, "submissions": {"source_ref", "topic_id", "cursor", "limit", "unsent"},
    "deliveries": {"cursor", "limit"}, "delivery": {"delivery_id"},
    "opening": {"opening_id"}, "openings": {"workspace_id", "cursor", "limit"},
    "workspace_members": {"workspace_id", "cursor", "limit"},
    "attention": {"workspace_id"}, "actors": {"cursor", "limit", "kind"},
    "marks": {"topic_id", "cursor", "limit"}, "topic_unread": {"topic_id"},
    "reactions": {"message_id"},
    "colors": {"cursor", "limit"},
    "source_topics": {"message_id", "cursor", "limit"},
    "wakes": set(),
    "health": set(),
    "health_light": set(),
    "releases": {"cursor", "limit"},
    "conversation": {"workspace_id"},
    "pipeline": {"workspace_id", "section", "cursor", "limit"},
    "pipeline_item": {"workspace_id", "number"},
    "pipeline_row": {"workspace_id"},
    "pipeline_freeze": {"piece_id"},
    "outcome_checks": {"workspace_id"},
    "check_readings": {"workspace_id", "check_id", "cursor", "limit"},
    "outcome_live": {"workspace_id", "commit"},
    "topic_membership": {"topic_id", "message_ids"}, "dossier_move_targets": {"message_id", "cursor", "limit", "build"}, "dossier_moves": {"topic_id", "cursor", "limit"},
    "stack_positions": {"topic_id", "message_ids", "position_format"}, "stack_namer": {"message_id"}, "dossier_cover": {"message_id"}, "message_acts": {"topic_id", "cursor", "limit"}, "stars": {"topic_id", "cursor", "limit"},
    "tools": {"workspace_id"}, "tool": {"tool_id", "cursor", "limit"}, "topic_tools": {"topic_id"},
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
        # topic.update may be fenced on field values instead (topic_state._fenced checks them).
        if (kind, key) == ("stack.move", "source_topic_id"):
            _identifier(value, key)
            continue
        if key == "authority" or (kind, key) == ("topic.update", "topic_fields"):
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
    if name in ("topic_messages", "stack_positions") and "position_format" in args:
        from .dossier_positions import FORMAT
        if args["position_format"] != FORMAT:
            raise Refusal("INVALID_ARGUMENT", "Unsupported dossier position format")
    if name == "topic_messages" and (args.get("audience", "all") not in ("all", "reader")
                                      or args.get("direction", "after") not in ("before", "after")):
        raise Refusal("INVALID_ARGUMENT", "Invalid message audience or direction")
    if name == "topic_messages" and args.get("items") not in (None, "open"):
        raise Refusal("INVALID_ARGUMENT", "items is \"open\" or absent")
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
        elif name in ("workspace_topics", "dossier_move_targets"):
            # An empty cursor is the start, as for the lists below.
            if cursor != "":
                from .topic_state import order_position
                order_position(cursor)
        elif name in ("workspaces", "openings", "workspace_members", "actors", "colors", "source_topics", "assessments", "hosted_seats"):
            if cursor != "":
                _identifier(cursor, "cursor")
            elif not isinstance(cursor, str):
                raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
        elif type(cursor) is not int or not 0 <= cursor <= 9223372036854775807:
            raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
    return args

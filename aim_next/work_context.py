from __future__ import annotations

"""The same bounded Core context for CLI and hosted notices; prose stays data."""

import re

MAX_TOPICS = 4
BINDING_ERRORS = frozenset(("AUTHORITY_CHANGED", "AUTHORITY_MISMATCH", "BINDING_MISMATCH",
                            "INSTANCE_MISMATCH", "SEAT_ENDED", "PROFILE_MISMATCH", "INVALID_BINDING", "INVALID_ACTOR"))
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\Z")
ACTIONS = frozenset(("read_current_rule", "read_pipeline", "complete", "repair_required_failure",
                     "repair_source_finding", "wait_for_required_items", "reconcile_rule",
                     "run_required_checks", "reconcile_live_source", "prepare_judged_evidence",
                     "finish_build_and_record_source", "read_source", "land", "read_carry_and_land",
                     "carry_and_combine"))


def topics(items):
    ids = list(dict.fromkeys(i.get("topic", {}).get("id") for i in items
                            if i.get("state") == "pending" and isinstance(i.get("topic", {}).get("id"), str)))
    return ids[:MAX_TOPICS], len(ids) > MAX_TOPICS


def fetch(store, actor, args, truncated=False):
    value = store.view(actor, "work_context", args)
    if not isinstance(value, dict):
        return {"availability": "unavailable", "code": "MALFORMED_CONTEXT"}
    if value.get("error"):
        code = value["error"].get("code")
        return {"availability": "unavailable", "code": code if isinstance(code, str) and TOKEN.fullmatch(code) else "CONTEXT_REFUSED"}
    if not isinstance(value.get("contexts"), list) or len(value["contexts"]) > MAX_TOPICS:
        return {"availability": "unavailable", "code": "MALFORMED_CONTEXT"}
    return dict(value, truncated=bool(value.get("truncated") or truncated))


def _token(value):
    return value if isinstance(value, str) and TOKEN.fullmatch(value) else "unavailable"


def lines(value):
    if not isinstance(value, dict) or value.get("availability") == "unavailable":
        return ["Work context unavailable; use the current bound commands."]
    result = []
    for context in value.get("contexts", [])[:MAX_TOPICS]:
        policy = context.get("policy")
        if not policy:
            result.append("Current rule unconfigured for %s; its coordinator supplies it." % _token(context.get("workspace_id")))
            continue
        revision = policy.get("revision")
        action = context.get("next_action", {}).get("kind")
        result.append("Current rule %s revision %s; piece %s; next %s; owner %s." % (
            _token(policy.get("policy_id")), revision if type(revision) is int else "unavailable",
            _token(context.get("piece_id")), action if action in ACTIONS else "unavailable",
            _token(context.get("next_action", {}).get("owner_actor_id"))))
        workspace = context.get("workspace_id")
        if isinstance(workspace, str) and TOKEN.fullmatch(workspace):
            result.append("Read: aim-next current-rule %s" % workspace)
    if value.get("truncated"):
        result.append("Work context is partial; read other delivered topics with work-context.")
    result.append("Resource admission is unknown here; the adopted execution tool governs entry.")
    return result

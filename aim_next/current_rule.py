from __future__ import annotations

"""Sourced rule records and derived work context (1198); no schema or scheduler."""

import json

from .contract import Refusal, _identifier, _json, _revision
from .delivery import _now_ms
from .judgment import guarded
from .message_edit import current_words

POLICY_KEY = "current_rule.v1:"
NOTEBOOK_KEY = "current_rule_notebook.v1:"
CAPABILITY = 1
MAX_RULES = 48
MAX_CONTEXTS = 4
REQUIREMENTS = frozenset(("red_green", "consumers", "source_read", "freeze",
                          "node_compare", "python_compare", "judged_rehearsal"))
PATHS = frozenset(("page", "core", "database"))


def _list(value, name, limit=48):
    if not isinstance(value, list) or len(value) > limit:
        raise Refusal("INVALID_ARGUMENT", "%s is a bounded list" % name)
    return value


def _number(value, name):
    if type(value) is not int or not 1 <= value <= 9223372036854775807:
        raise Refusal("INVALID_ARGUMENT", "%s is a positive integer" % name)
    return value


def _text(value, name, limit=1024):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > limit:
        raise Refusal("INVALID_ARGUMENT", "%s is bounded nonempty text" % name)
    return value


def _plain_rule(rule):
    return {k: v for k, v in rule.items() if k not in ("revision", "recorded_by")}


def rendering(record):
    """One human rendering of the very same record; source history stays in Core."""
    lines = ["# Current rule: %s" % record["policy_id"], "",
             "Revision %d; recorded by %s. This page renders the bound Core record." %
             (record["revision"], record["recorded_by"]), "",
             "Update it with current-rule-update; reading it creates no approval.", ""]
    for rule in record["rules"]:
        lines += ["## %s (revision %d)" % (rule["id"], rule["revision"]),
                  rule["summary"], "", "Scope: " + _json(rule["scope"]),
                  "Effect: " + _json(rule["effect"]), "Source: " + _json(rule["source"])]
        if rule["supersedes"]:
            lines.append("Supersedes: " + _json(rule["supersedes"]))
        lines.append("")
    lines += ["Prior records: " + _json(record["previous"]),
              "Clock/lane1199, wake recovery1180 and browser jobs1200 are separate capabilities."]
    return "\n".join(lines) + "\n"


class CurrentRule:
    def _rule_render_guard(self, db, actor, item_id):
        self._memory_identity(db, actor, item_id)
        if self._managed_rule_notebook(db, item_id):
            raise Refusal("RULE_RENDERING_MANAGED", "Update this rendering with current_rule.update and its rule revision")

    def _command_memory_revise(self, db, actor, envelope):
        self._rule_render_guard(db, actor, envelope["target"].get("item_id"))
        return super()._command_memory_revise(db, actor, envelope)

    def _command_memory_delete(self, db, actor, envelope):
        self._rule_render_guard(db, actor, envelope["target"].get("item_id"))
        return super()._command_memory_delete(db, actor, envelope)

    def _transfer_page(self, db, actor, item_id, expected):
        value = super()._transfer_page(db, actor, item_id, expected)
        self._rule_render_guard(db, actor, item_id)
        return value

    def _current_rule(self, db, workspace_id):
        row = db.execute("SELECT value FROM metadata WHERE key=?", (POLICY_KEY + workspace_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def _managed_rule_notebook(self, db, item_id):
        return db.execute("SELECT value FROM metadata WHERE key=?", (NOTEBOOK_KEY + item_id,)).fetchone() is not None

    def _rule_source(self, db, actor, workspace_id, source):
        if not isinstance(source, dict) or source.get("kind") not in ("message", "memory"):
            raise Refusal("INVALID_ARGUMENT", "A rule cites a public message passage or published Notebook revision")
        kind = source["kind"]
        fields = {"kind", "id", "revision"} | ({"start", "end"} if kind == "message" else set())
        if set(source) != fields:
            raise Refusal("INVALID_ARGUMENT", "A rule source has exact revision and passage fields")
        identity = _identifier(source["id"], "source id")
        revision = _number(source["revision"], "source revision")
        if kind == "message":
            self._message_access(db, actor, identity)
            row = db.execute("SELECT m.private_to,t.workspace_id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?",
                             (identity,)).fetchone()
            if row["private_to"] is not None or row["workspace_id"] != workspace_id:
                raise Refusal("POLICY_SOURCE_SCOPE", "Policy sources are public records of this outcome")
            value = self._source(db, actor, {"kind": "message", "id": identity})
            if value["withheld"] or value.get("withdrawal") or value.get("removal"):
                raise Refusal("POLICY_SOURCE_UNAVAILABLE", "Read the available current source before recording this rule")
            body, current, unused = current_words(db, identity, plain=True)
            if revision != current:
                raise Refusal("SOURCE_REVISION_CONFLICT", "The rule's source changed; retain and reread it")
            start, end = source["start"], source["end"]
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(body) or end - start > 4096:
                raise Refusal("INVALID_ARGUMENT", "A source passage names bounded Unicode code point offsets")
        else:
            item = self._memory_identity(db, actor, identity)
            owner = item["scope_id"] if item["scope_kind"] == "workspace" else db.execute(
                "SELECT workspace_id FROM topics WHERE id=?", (item["scope_id"],)).fetchone()[0]
            row = db.execute("SELECT draft,deleted FROM memory_revisions WHERE item_id=? AND revision=?",
                             (identity, revision)).fetchone()
            if owner != workspace_id or not row or row["draft"] or row["deleted"]:
                raise Refusal("POLICY_SOURCE_SCOPE", "Policy sources are published records of this outcome")
            if item["current_revision"] != revision:
                raise Refusal("SOURCE_REVISION_CONFLICT", "The rule's Notebook source changed; retain and reread it")
        return dict(source)

    def _validate_rule(self, db, actor, workspace_id, rule, old, revision):
        if not isinstance(rule, dict) or set(rule) != {"id", "summary", "scope", "effect", "source", "supersedes"}:
            raise Refusal("INVALID_ARGUMENT", "Each rule names id, summary, scope, effect, source and supersedes")
        identity = _identifier(rule["id"], "rule id")
        summary = _text(rule["summary"], "rule summary", 1024)
        previous = old.get(identity)
        if previous is not None and _plain_rule(previous) == rule:
            # An unchanged rule keeps its historical supersession references;
            # they deliberately name the rule it replaced, not itself today.
            return previous
        scope, effect = rule["scope"], rule["effect"]
        if not isinstance(scope, dict) or set(scope) - {"paths", "items", "pieces"}:
            raise Refusal("INVALID_ARGUMENT", "A rule scopes typed paths and explicit items or pieces")
        for path in _list(scope.get("paths", []), "paths", 3):
            if not isinstance(path, str) or path not in PATHS:
                raise Refusal("INVALID_ARGUMENT", "A path is page, core or database")
        for number in _list(scope.get("items", []), "items", 64):
            _number(number, "item number")
            self._item_row(db, workspace_id, number)
        for piece_id in _list(scope.get("pieces", []), "pieces", 16):
            piece, workspace = self._piece(db, actor, piece_id)
            if workspace["id"] != workspace_id:
                raise Refusal("POLICY_SOURCE_SCOPE", "A scoped piece belongs to this outcome")
        if not isinstance(effect, dict) or set(effect) - {"require", "checks", "freeze", "work_type", "wait_items_live"}:
            raise Refusal("INVALID_ARGUMENT", "Rule effects are typed requirements and scoped exceptions")
        for requirement in _list(effect.get("require", []), "requirements", len(REQUIREMENTS)):
            if not isinstance(requirement, str) or requirement not in REQUIREMENTS:
                raise Refusal("INVALID_ARGUMENT", "Unknown effective requirement")
        for check_id in _list(effect.get("checks", []), "checks", 32):
            _identifier(check_id, "check id")
            if not db.execute("SELECT 1 FROM outcome_checks WHERE workspace_id=? AND check_id=?",
                              (workspace_id, check_id)).fetchone():
                raise Refusal("CHECK_UNKNOWN", "A required check must be defined in this outcome")
        if "freeze" in effect and effect["freeze"] not in ("required", "carry_read"):
            raise Refusal("INVALID_ARGUMENT", "A freeze is required or uses an explicit carry-read exception")
        if "work_type" in effect and effect["work_type"] not in PATHS:
            raise Refusal("INVALID_ARGUMENT", "A work type is page, core or database")
        for number in _list(effect.get("wait_items_live", []), "live dependencies", 16):
            _number(number, "live item")
            self._item_row(db, workspace_id, number)
        prior = []
        for reference in _list(rule["supersedes"], "superseded rules", MAX_RULES):
            if not isinstance(reference, dict) or set(reference) != {"id", "revision"}:
                raise Refusal("INVALID_ARGUMENT", "Supersession names an exact rule revision")
            _identifier(reference["id"], "superseded rule")
            _number(reference["revision"], "superseded revision")
            previous = old.get(reference["id"])
            if previous is None or reference["revision"] != previous["revision"]:
                raise Refusal("RULE_REVISION_CONFLICT", "Supersession names a current prior rule")
            prior.append(dict(reference))
        value = dict(rule, id=identity, summary=summary, supersedes=prior)
        previous = old.get(identity)
        if previous is not None and _plain_rule(previous) == value:
            return previous
        # Reusing a stable id changes its meaning only by explicitly replacing
        # that prior revision; unchanged sources need not be re-published.
        if previous and {"id": identity, "revision": previous["revision"]} not in prior:
            raise Refusal("RULE_SUPERSESSION_REQUIRED", "A changed rule explicitly supersedes its previous revision")
        value["source"] = self._rule_source(db, actor, workspace_id, rule["source"])
        return dict(value, revision=revision, recorded_by=actor)

    def _command_current_rule_update(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"policy_id", "notebook_id", "rules", "owners"}:
            raise Refusal("INVALID_ARGUMENT", "A rule update names one outcome, policy, rendering, rules and step owners")
        workspace = self._steerer(db, actor, target["workspace_id"])
        policy_id = _identifier(args["policy_id"], "policy id")
        old = self._current_rule(db, workspace["id"])
        _revision(envelope["expected"], "rule_revision", old["revision"] if old else 0)
        notebook = self._memory_identity(db, actor, args["notebook_id"], write=True)
        notebook_workspace = notebook["scope_id"] if notebook["scope_kind"] == "workspace" else db.execute(
            "SELECT workspace_id FROM topics WHERE id=?", (notebook["scope_id"],)).fetchone()[0]
        if notebook_workspace != workspace["id"]:
            raise Refusal("POLICY_SOURCE_SCOPE", "The rendering belongs to this outcome")
        _revision(envelope["expected"], "item_revision", notebook["current_revision"])
        page = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?",
                          (notebook["id"], notebook["current_revision"])).fetchone()
        if page["draft"] or page["deleted"]:
            raise Refusal("POLICY_SOURCE_UNAVAILABLE", "The rule rendering must be a published available page")
        if old and (policy_id != old["policy_id"] or notebook["id"] != old["notebook_id"]):
            raise Refusal("POLICY_IDENTITY_CONFLICT", "The policy and its rendering keep their identities")
        owners = args["owners"]
        if not isinstance(owners, dict) or set(owners) != {"reader", "carrier", "freezer", "lander"}:
            raise Refusal("INVALID_ARGUMENT", "Name the existing reader, carrier, freezer and lander")
        for owner in owners.values():
            self._workspace(db, _identifier(owner, "step owner"), workspace["id"])
            self._actor(db, owner)
        revision = old["revision"] + 1 if old else 1
        previous_rules = {r["id"]: r for r in old["rules"]} if old else {}
        rules = [self._validate_rule(db, actor, workspace["id"], r, previous_rules, revision)
                 for r in _list(args["rules"], "rules", MAX_RULES)]
        if not rules or len({r["id"] for r in rules}) != len(rules):
            raise Refusal("INVALID_ARGUMENT", "A policy has distinct, sourced rules")
        replaced = {r["id"] for rule in rules for r in rule["supersedes"]}
        if set(previous_rules) - {r["id"] for r in rules} - replaced:
            raise Refusal("RULE_SUPERSESSION_REQUIRED", "Omitted rules need explicit supersession")
        record = {"capability_version": CAPABILITY, "workspace_id": workspace["id"], "policy_id": policy_id,
                  "revision": revision, "recorded_by": actor, "recorded_ms": _now_ms(),
                  "operation_id": envelope["operation_id"], "notebook_id": notebook["id"],
                  "notebook_revision": notebook["current_revision"] + 1, "owners": dict(owners), "rules": rules,
                  "previous": ({"actor_id": old["recorded_by"], "operation_id": old["operation_id"]}
                               if old else None)}
        if len(_json(record).encode("utf-8")) > 65536:
            raise Refusal("INVALID_ARGUMENT", "The current rule record exceeds its bounded size")
        # Call the existing Notebook owner inside this command's savepoint.
        # No second command, operation identity or intermediate visible state.
        memory_envelope = dict(envelope, target={"item_id": notebook["id"]},
                               expected={"item_revision": notebook["current_revision"]},
                               args={"title": "Current rule: " + policy_id, "body": rendering(record),
                                     "attachments": json.loads(page["attachments"]),
                                     "references": json.loads(page["refs"])})
        result, affected = self._write_memory(db, actor, memory_envelope, creating=False)
        db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (POLICY_KEY + workspace["id"], _json(record)))
        db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (NOTEBOOK_KEY + notebook["id"], workspace["id"]))
        self._change(db, "workspace", workspace["id"], "current_rule", policy_id, revision)
        return {"record": record, "rendering": result}, affected

    def _view_current_rule(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        record = self._current_rule(db, workspace["id"])
        result = {"instance_id": self.instance_id, "workspace_id": workspace["id"],
                  "capability_version": CAPABILITY, "record": record,
                  "availability": "available" if record else "unconfigured"}
        cursor = args.get("history")
        if cursor is not None:
            if not isinstance(cursor, dict) or set(cursor) != {"actor_id", "operation_id"}:
                raise Refusal("INVALID_ARGUMENT", "History follows one exact recorded operation")
            row = db.execute("SELECT outcome FROM operations WHERE actor_id=? AND id=? AND kind='current_rule.update'",
                             (_identifier(cursor["actor_id"]), _identifier(cursor["operation_id"]))).fetchone()
            outcome = json.loads(row[0]) if row else {}
            previous = outcome.get("result", {}).get("record")
            if not previous or previous["workspace_id"] != workspace["id"]:
                raise Refusal("FORBIDDEN", "No rule history in this outcome at that operation")
            result["record"] = previous
            result["availability"] = "available"
        return result

    def _rule_work_scope(self, db, actor, args):
        selectors = set(args) & {"workspace_id", "piece_id", "topic_id", "topic_ids"}
        if len(selectors) != 1:
            raise Refusal("INVALID_ARGUMENT", "Name one bounded workspace, piece or delivered-topic scope")
        if "piece_id" in args:
            piece, workspace = self._piece(db, actor, args["piece_id"])
            return [(workspace, piece)], False
        if "workspace_id" in args:
            workspace = self._workspace(db, actor, args["workspace_id"])
            return [(workspace, None)], False
        ids = args.get("topic_ids", [args.get("topic_id")])
        ids = list(dict.fromkeys(_identifier(i, "context topic") for i in _list(ids, "context topics", MAX_CONTEXTS)))
        scopes = []
        for topic_id in ids:
            topic = self._topic(db, actor, topic_id)
            workspace = self._workspace(db, actor, topic["workspace_id"])
            piece = db.execute(
                "SELECT p.* FROM pipeline_stage_entries e INDEXED BY open_entries "
                "JOIN pipeline_pieces p ON p.id=e.piece_id WHERE e.workspace_id=? AND e.left_ms IS NULL "
                "AND p.topic_id=? ORDER BY e.seq DESC LIMIT 1", (workspace["id"], topic["id"])).fetchone()
            if not any(w["id"] == workspace["id"] and (p["id"] if p else None) == (piece["id"] if piece else None)
                       for w, p in scopes):
                scopes.append((workspace, piece))
        return scopes, False

    def _view_work_context(self, db, actor, args):
        scopes, truncated = self._rule_work_scope(db, actor, args)
        return {"instance_id": self.instance_id, "capability_version": CAPABILITY,
                "contexts": [self._rule_work_context(db, actor, w, p) for w, p in scopes],
                "truncated": truncated,
                "unavailable_capabilities": ["lane_clock_1199", "wake_recovery_1180", "browser_jobs_1200"]}

    def _rule_work_context(self, db, actor, workspace, piece):
        record = self._current_rule(db, workspace["id"])
        live = db.execute("SELECT number,commit_sha FROM releases ORDER BY number DESC LIMIT 1").fetchone()
        context = {"workspace_id": workspace["id"], "piece_id": piece["id"] if piece else None,
                   "policy": None if not record else {
                       "policy_id": record["policy_id"], "revision": record["revision"],
                       "notebook_id": record["notebook_id"], "notebook_revision": record["notebook_revision"]},
                   "availability": "available" if record else "unconfigured",
                   "live": {"release": live["number"], "head": live["commit_sha"]} if live else None,
                   "lane": {"availability": "unavailable", "followup": 1199},
                   "resources": {"availability": "unknown", "admission": "existing_execution_tool",
                                 "load_below": 12, "max_lane_runs": 3},
                   "blockers": [], "limitations": [], "requirements": [], "checks": [],
                   "source": {"own_head": None, "carry_head": None, "base": None, "conflict": "unknown"},
                   "observed_commit_seq": int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])}
        if record is None:
            context["next_action"] = {"kind": "read_current_rule", "owner_role": "coordinator",
                                      "owner_actor_id": workspace["coordinator_id"] or workspace["owner_id"]}
            return context
        if piece is None:
            context["next_action"] = {"kind": "read_pipeline", "owner_role": "coordinator",
                                      "owner_actor_id": workspace["coordinator_id"] or workspace["owner_id"]}
            return context
        context["piece_revision"] = piece["version"]
        members = self._members(db, piece["id"])
        context["items"] = members
        entry = db.execute("SELECT * FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq DESC LIMIT 1",
                           (piece["id"],)).fetchone()
        context["stage"] = {"id": entry["stage_id"], "entry": entry["seq"], "left": entry["left_outcome"]} if entry else None
        frozen = (self._piece_freeze(db, piece["id"]) if piece["kind"] == "piece" else
                  self._release_freeze(db, workspace["id"], piece["id"]))
        files = frozen["files"] if frozen else []
        own_head = frozen["head_commit"] if frozen else None
        # An actual check run or release piece supplies a known head without a
        # freeze. No message/stage prose or arbitrary caller-supplied SHA does.
        latest = db.execute("SELECT u.commit_sha FROM check_readings r INDEXED BY readings_by_piece "
                            "JOIN check_runs u ON u.id=r.run_id WHERE r.piece_id=? AND u.trial_of IS NULL "
                            "AND u.base_for_commit IS NULL ORDER BY u.started_ms DESC LIMIT 1", (piece["id"],)).fetchone()
        if own_head is None and latest:
            own_head = latest["commit_sha"]
        carry = self._release_commit(db, piece) if piece["kind"] == "release" else None
        context["source"].update(own_head=own_head, carry_head=carry,
                                 base=frozen["base_commit"] if frozen else None)
        actual_type = ("database" if guarded(files) else
                       "core" if any(p.startswith(("aim_next/", "bin/", "tools/")) for p in files) else
                       "page" if files else None)

        def scope_matches(rule, path=None):
            scope = rule["scope"]
            return (not scope.get("items") or bool(set(members) & set(scope["items"]))) and (
                not scope.get("pieces") or piece["id"] in scope["pieces"]) and (
                path is None or not scope.get("paths") or path in scope["paths"])

        scoped = [rule for rule in record["rules"] if scope_matches(rule)]
        if actual_type is None:
            hints = {r["effect"]["work_type"] for r in scoped
                     if not r["scope"].get("paths") and "work_type" in r["effect"]}
            if len(hints) == 1:
                actual_type = next(iter(hints))
        context["work_type"] = actual_type or "unknown"
        rules = [rule for rule in scoped if scope_matches(rule, actual_type) and
                 (actual_type is not None or not rule["scope"].get("paths"))]
        # Explicit narrow scope, not timestamp or the last person's message,
        # chooses an exception over the generic path.
        rules.sort(key=lambda r: 2 if r["scope"].get("pieces") else 1 if r["scope"].get("items") else 0)
        context["effective_rules"] = [{"id": r["id"], "revision": r["revision"], "source": r["source"],
                                       "supersedes": r["supersedes"]} for r in rules]
        required, checks, dependencies = set(), set(), set()
        freeze_mode = "required"
        freeze_specificity = -1
        for rule in rules:
            effect = rule["effect"]
            required.update(effect.get("require", []))
            checks.update(effect.get("checks", []))
            dependencies.update(effect.get("wait_items_live", []))
            if "freeze" in effect:
                specificity = 2 if rule["scope"].get("pieces") else 1 if rule["scope"].get("items") else 0
                if specificity == freeze_specificity and freeze_mode != effect["freeze"]:
                    context["blockers"].append({"kind": "rule_conflict", "rule_id": rule["id"]})
                freeze_mode, freeze_specificity = effect["freeze"], specificity
        context["requirements"] = sorted(required)
        context["proof"] = {"typed_check_ids": sorted(checks),
                            "manual_requirements": sorted(required - {"source_read", "freeze"}),
                            "availability": "recorded_checks_and_source_only"}
        context["limitations"].append("Manual red/green, whole-file coverage and writing/repair timings are not inferred from prose")
        context["freeze_mode"] = freeze_mode
        context["mechanical_judged"] = frozen["judged"] if frozen else None
        # Actual stage check requirements are canonical facts too. Question
        # prose and item descriptions are deliberately absent from this read.
        stage = (db.execute("SELECT gate FROM pipeline_stages WHERE workspace_id=? AND stage_id=?",
                            (workspace["id"], entry["stage_id"])).fetchone() if entry else None)
        if stage:
            checks.update(json.loads(stage["gate"]).get("checks") or [])
        context["proof"]["typed_check_ids"] = sorted(checks)
        if len(checks) > 32 or len(dependencies) > 16:
            raise Refusal("CONTEXT_TOO_LARGE", "Narrow this policy's checks or dependency scope before reading its action")
        for check_id in sorted(checks):
            row = (db.execute(
                "SELECT r.result,r.words,r.detail,u.id,u.started_ms FROM check_readings r INDEXED BY readings_by_piece "
                "JOIN check_runs u ON u.id=r.run_id WHERE r.piece_id=? AND r.check_id=? AND u.commit_sha=? "
                "AND u.trial_of IS NULL AND u.base_for_commit IS NULL ORDER BY u.started_ms DESC LIMIT 1",
                (piece["id"], check_id, carry or own_head)).fetchone() if carry or own_head else None)
            reading = {"check_id": check_id, "result": row["result"] if row else "missing",
                       "run_id": row["id"] if row else None}
            if row:
                reading["words"] = row["words"][:512]
                detail = json.loads(row["detail"])
                if isinstance(detail, dict) and (detail.get("cancelled") or detail.get("timed_out") or detail.get("assertions_reached") is False):
                    reading["result"] = "incomplete"
            context["checks"].append(reading)
            if reading["result"] == "failed":
                context["blockers"].append(dict(reading, kind="required_check_failure"))
        for number in sorted(dependencies)[:16]:
            # A completed topic points at one release; that actual release
            # must name the dependency. No whole-release-history scan.
            candidates = db.execute(
                "SELECT d.release FROM pipeline_piece_members m JOIN pipeline_pieces p ON p.id=m.piece_id "
                "JOIN pipeline_done_topics d ON d.topic_id=p.topic_id "
                "WHERE m.workspace_id=? AND m.number=? ORDER BY p.rowid DESC LIMIT 1",
                (workspace["id"], number)).fetchone()
            shipped = candidates and db.execute(
                "SELECT 1 FROM releases r,json_each(r.items) j WHERE r.number=? AND j.value=?",
                (candidates[0], number)).fetchone()
            if not shipped:
                context["blockers"].append({"kind": "items_live_requirement", "item": number})
        approval = self._piece_approval(db, piece["id"], frozen) if frozen and piece["kind"] == "piece" else None
        finding = db.execute(
            "SELECT seq,left_note FROM pipeline_stage_entries WHERE piece_id=? "
            "AND left_outcome='sent back' AND left_ms>=? ORDER BY seq DESC LIMIT 1",
            (piece["id"], frozen["at_ms"] if frozen else 0)).fetchone()
        if finding and (approval is None or approval["seq"] < finding["seq"]):
            context["blockers"].append({"kind": "source_read_finding", "entry": finding["seq"],
                                       "words": finding["left_note"][:512]})
        owners = record["owners"]

        def action(kind, role="builder", owner=None):
            context["next_action"] = {"kind": kind, "owner_role": role, "owner_actor_id": owner}
            return context

        if not entry or entry["left_ms"] is not None:
            return action("complete", "coordinator", workspace["coordinator_id"] or workspace["owner_id"])
        if context["blockers"]:
            first = context["blockers"][0]["kind"]
            return action("repair_required_failure" if first == "required_check_failure" else
                          "repair_source_finding" if first == "source_read_finding" else
                          "wait_for_required_items" if first == "items_live_requirement" else "reconcile_rule",
                          "coordinator" if first == "rule_conflict" else "builder",
                          workspace["coordinator_id"] if first == "rule_conflict" else None)
        if any(r["result"] != "passed" for r in context["checks"]):
            return action("run_required_checks")
        if frozen and live and frozen["base_commit"] != live["commit_sha"] and own_head != live["commit_sha"]:
            context["limitations"].append("source overlap is not known; the existing binder resolves the same work")
            return action("reconcile_live_source", "carrier", owners["carrier"])
        if actual_type == "database":
            return action("prepare_judged_evidence", "lander", owners["lander"])
        if frozen is None and freeze_mode == "required":
            context["limitations"].append("push/carry head is unrecorded; no source identity is inferred")
            return action("finish_build_and_record_source")
        if "source_read" in required and approval is None:
            return action("read_source", "reader", owners["reader"])
        if piece["kind"] == "release":
            return action("land", "lander", owners["lander"])
        # The exception supplies a route, never fabricated approval or a SHA.
        if frozen is None:
            context["limitations"].append("carry-read exception active; exact carry/head/read is not recorded here")
            return action("read_carry_and_land", "lander", owners["lander"])
        return action("carry_and_combine", "carrier", owners["carrier"])

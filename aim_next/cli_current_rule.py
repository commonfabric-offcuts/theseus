from __future__ import annotations

import json

from . import work_context


def register(verb):
    current = verb("current-rule")
    current.add_argument("outcome")
    current.add_argument("--history", help="JSON actor_id/operation_id from the prior record")
    update = verb("current-rule-update")
    update.add_argument("outcome")
    update.add_argument("file", help="complete policy arguments as JSON, or -")
    update.add_argument("--expected", type=int, required=True)
    update.add_argument("--notebook-expected", type=int, required=True)
    update.add_argument("--operation")
    context = verb("work-context")
    scope = context.add_mutually_exclusive_group(required=True)
    scope.add_argument("--outcome")
    scope.add_argument("--piece")
    scope.add_argument("--topic")


class CurrentRuleVerbs:
    def do_current_rule(self):
        args = {"workspace_id": self.options.outcome}
        if self.options.history:
            try:
                args["history"] = json.loads(self.options.history)
            except ValueError:
                self.refuse("INVALID_ARGUMENT", "History names a JSON actor_id/operation_id reference")
        value = self.view("current_rule", args)
        self.out.plain(json.dumps(value, ensure_ascii=False, indent=2))

    def do_current_rule_update(self):
        from .cli import _input
        args = _input(self.options.file, self.stdin)
        result = self.command("current_rule.update", {"workspace_id": self.options.outcome}, args,
                              {"rule_revision": self.options.expected, "item_revision": self.options.notebook_expected},
                              operation=self.options.operation)
        value = self.read_back("current_rule", {"workspace_id": self.options.outcome},
                               {"what": "Rule recorded", "kind": "current_rule.update", "it": self.options.outcome},
                               "current-rule " + self.options.outcome)
        if value.get("record") != result["record"]:
            self.refuse("READ_BACK_MISMATCH", "The current rule advanced; read its history using the recorded operation")
        self.out.plain("current rule %s revision %d; rendering revision %d; read back matches" % (
            result["record"]["policy_id"], result["record"]["revision"], result["record"]["notebook_revision"]))

    def do_work_context(self):
        args = ({"workspace_id": self.options.outcome} if self.options.outcome else
                {"piece_id": self.options.piece} if self.options.piece else {"topic_id": self.options.topic})
        value = self.view("work_context", args)
        self.out.plain(json.dumps(value, ensure_ascii=False, indent=2))

    def show_work_context(self):
        # Raw binding/view/command/retry never take this path. Existing workspaces
        # have no implicit policy installation and keep their ordinary output.
        options = self.options
        if options.verb in ("current-rule", "current-rule-update", "work-context", "retry", "watch"):
            return
        args = ({"piece_id": options.piece} if isinstance(getattr(options, "piece", None), str) else
                {"topic_id": options.topic} if isinstance(getattr(options, "topic", None), str) else
                {"workspace_id": options.outcome} if isinstance(getattr(options, "outcome", None), str) else None)
        truncated = False
        if options.verb == "inbox":
            ids, truncated = work_context.topics(getattr(self, "context_deliveries", []))
            args = {"topic_ids": ids} if ids else None
        if args is None:
            return
        value = work_context.fetch(self.store, self.actor, args, truncated)
        if value.get("code") in work_context.BINDING_ERRORS:
            self.refuse(value["code"], "Current context binding refused; retain the original operation and binding")
        if value.get("contexts") and all(c.get("availability") == "unconfigured" for c in value["contexts"]):
            return
        self.out.raw({"work_context": value})
        for line in work_context.lines(value):
            self.out.plain(line)

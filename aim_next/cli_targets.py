from __future__ import annotations

"""An outcome's target, checks and kind, as agent verbs (items 14, 12, 104; docs/agent-cli.md, "Targets and checks").

A mixin of do_* methods for cli.Agent, and register(verb), which cli._parser
calls to add their arguments. Times are absolute local times.
"""

import json
from pathlib import Path
import time

WORDS = {"on_target": "On target", "not_on_target": "Not on target yet", "not_there": "Not there yet", "reached": "Reached",
         "no_target": "No target yet"}
STATUS = {"passing": "passing", "failing": "FAILING", "measured": "measured", "holding": "holding", "not_run": "not run yet",
          "waiting": "waiting on the owner"}

ASK_WORDS = "New words for the target, for you to use or keep the current ones (on the outcome page):\n\n%s"


def _at(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000.0)) if isinstance(ms, int) else "(time unknown)"


def register(verb):
    checks = verb("checks")
    checks.add_argument("outcome")
    checks.add_argument("--readings", action="store_true")
    checks.add_argument("--live", dest="live_commit", metavar="COMMIT")
    target = verb("target")
    target.add_argument("outcome")
    target.add_argument("--origin", default="")
    asking = target.add_mutually_exclusive_group()
    asking.add_argument("--ask")
    asking.add_argument("--ask-in", dest="ask_in", metavar="TOPIC")
    target.add_argument("text")
    settle = verb("target-settle")
    settle.add_argument("outcome")
    settle.add_argument("revision", type=int)
    settle.add_argument("outcome_word", choices=("accepted", "declined"))
    define = verb("check-define")
    define.add_argument("outcome")
    define.add_argument("file")
    report = verb("check-report")
    report.add_argument("outcome")
    report.add_argument("file")
    worse = verb("accept-worse")
    worse.add_argument("outcome")
    worse.add_argument("check")
    worse.add_argument("run")
    worse.add_argument("text")
    problem = verb("problem")
    problem.add_argument("outcome")
    problem.add_argument("--kind", required=True, choices=("defect", "design-miss"))
    problem.add_argument("--from", dest="message")
    problem.add_argument("--note")
    problem.add_argument("--found-by")
    problem.add_argument("text")
    cover = verb("problem-cover")
    cover.add_argument("outcome")
    cover.add_argument("problem")
    cover.add_argument("--item", type=int)
    cover.add_argument("--test")
    cover.add_argument("text")
    kind = verb("outcome-kind")
    kind.add_argument("outcome")
    kind.add_argument("kind", choices=("reach", "keep"))
    reached = verb("reached")
    reached.add_argument("outcome")
    reached.add_argument("--unmet", action="store_true")
    reached.add_argument("text")


class TargetVerbs:
    def _checks_view(self, outcome):
        return self.view("outcome_checks", {"workspace_id": outcome})

    def do_checks(self):
        if self.options.live_commit:
            # What the deploy reads before it measures (with --json, the whole view): the checks, the live baseline, the allowances.
            answer = self.view("outcome_live", {"workspace_id": self.options.outcome, "commit": self.options.live_commit})
            live = answer.get("live") or {}
            self.out.plain("%d checks; live baseline %s; %d allowances bearing on %s" % (
                len(answer["checks"]), (live.get("commit") or "none")[:12], len(answer["allowances"]), self.options.live_commit[:12]))
            return
        answer = self._checks_view(self.options.outcome)
        target = answer.get("target") or {}
        kind = answer["kind"]["kind"]
        self.out.plain("%s  (an outcome to %s)  %s" % (answer["workspace_title"], kind, WORDS.get(answer["word"], answer["word"])))
        if answer.get("failing_check"):
            self.out.plain("  failing: %s" % answer["failing_check"]["name"])
        if target.get("text"):
            self.out.plain("Target (revision %s, by %s, %s): %s" % (target["revision"], target["written_by"], _at(target["written_ms"]), target["text"]))
        if target.get("proposed"):
            proposed = target["proposed"]
            self.out.plain("Proposed (revision %s, by %s, waiting on %s): %s" % (proposed["revision"], proposed["by"], answer["owner"], proposed["text"]))
        for group in answer["groups"]:
            self.out.plain("%s:" % group["name"])
            for check in group["checks"]:
                latest = check.get("latest") or {}
                line = "  %s  %s  [%s]" % (check["check_id"], check["name"], STATUS.get(check["status"], check["status"]))
                if latest:
                    line += "  %s: %s" % (latest.get("label"), latest.get("words"))
                elif check.get("pending_words"):
                    line += "  %s" % check["pending_words"]
                self.out.plain(line)
                if self.options.readings:
                    for reading in check["readings"]:
                        self.out.plain("      %s  %s  %s  (run %s)" % (reading["label"], reading["result"], reading["words"], reading["run_id"]))
        loop = answer.get("loop") or {}
        candidate = loop.get("candidate")
        if candidate:
            self.out.plain("%s (%s): %s" % (candidate["label"], (candidate["commit"] or "")[:12], candidate["state"]))
            for item in candidate["worse"]:
                self.out.plain("  worse: %s, %s%s" % (item["name"], item["why"], "  (accepted)" if item.get("accepted") else ""))
            if candidate.get("likely_cause"):
                self.out.plain("  likely cause: item %s" % ", ".join(str(n) for n in candidate["likely_cause"].get("items", [])))
        if answer.get("reached"):
            self.out.plain("Reached %s by %s: %s" % (_at(answer["reached"]["ms"]), answer["reached"]["by"], answer["reached"]["words"]))

    def do_target(self):
        options = self.options
        current = self._checks_view(options.outcome)
        args = {"text": self.text(), "origin_note": options.origin}
        if options.ask:
            args["ask_message_id"] = options.ask
        elif options.ask_in:
            # The ask to the owner, sent with the words in one command (D8).
            args["ask"] = {"topic_id": options.ask_in, "body": ASK_WORDS % args["text"]}
        result = self.command("target.propose", {"workspace_id": options.outcome}, args,
                              {"target_revision": current["relevant_versions"]["checks"]})
        self.out.plain("target revision %d %s" % (result["revision"], "is current" if result["current"] else "waits on the owner"))

    def do_target_settle(self):
        options = self.options
        current = self._checks_view(options.outcome)
        self.command("target.settle", {"workspace_id": options.outcome}, {"revision": options.revision, "outcome": options.outcome_word},
                     {"target_revision": current["relevant_versions"]["checks"]})
        self.out.plain("target revision %d %s" % (options.revision, options.outcome_word))

    def do_check_define(self):
        options = self.options
        check = json.loads(Path(options.file).read_text(encoding="utf-8"))
        current = self._checks_view(options.outcome)
        result = self.command("check.define", {"workspace_id": options.outcome}, {"check": check},
                              {"checks_revision": current["relevant_versions"]["checks"]})
        self.out.plain("check %s revision %d" % (result["check_id"], result["revision"]))

    def do_check_report(self):
        options = self.options
        report = json.loads(Path(options.file).read_text(encoding="utf-8"))
        result = self.command("check.report", {"workspace_id": options.outcome}, {"run": report.get("run"), "readings": report.get("readings")})
        self.out.plain("run %s %s" % (result["run_id"], "recorded" if result["recorded"] else "was already recorded"))

    def do_accept_worse(self):
        options = self.options
        current = self._checks_view(options.outcome)
        self.command("check.accept_worse", {"workspace_id": options.outcome, "check_id": options.check}, {"run_id": options.run, "why": self.text()},
                     {"checks_revision": current["relevant_versions"]["checks"]})
        self.out.plain("accepted the worse %s at run %s" % (options.check, options.run))

    def do_problem(self):
        options = self.options
        args = {"what": self.text(), "kind": options.kind.replace("-", "_")}
        if options.message:
            args["message_id"] = options.message
        if options.note:
            args["note"] = options.note
        if options.found_by:
            args["found_by"] = options.found_by
        result = self.command("problem.file", {"workspace_id": options.outcome}, args)
        self.out.plain("problem %s filed" % result["problem_id"])

    def do_problem_cover(self):
        options = self.options
        current = self._checks_view(options.outcome)
        version = None
        for release in (current.get("problems") or {}).get("releases", []):
            for problem in release.get("problems", []):
                if problem["id"] == options.problem:
                    version = problem["version"]
        args = {"words": self.text()}
        if options.item is not None:
            args["item"] = options.item
        if options.test:
            args["test"] = options.test
        self.command("problem.cover", {"workspace_id": options.outcome, "problem_id": options.problem}, args,
                     {} if version is None else {"problem_revision": version})
        self.out.plain("problem %s covered" % options.problem)

    def do_outcome_kind(self):
        options = self.options
        workspace = self.view("workspace", {"workspace_id": options.outcome})["workspace"]
        result = self.command("outcome.kind_set", {"workspace_id": options.outcome}, {"kind": options.kind},
                              {"workspace_revision": workspace["version"]})
        self.out.plain("%s is an outcome to %s%s" % (options.outcome, options.kind, "" if result["changed"] else " (no change)"))

    def do_reached(self):
        options = self.options
        workspace = self.view("workspace", {"workspace_id": options.outcome})["workspace"]
        args = {"words": self.text()}
        if options.unmet:
            args["unmet_confirmed"] = True
        result = self.command("outcome.reach", {"workspace_id": options.outcome}, args, {"workspace_revision": workspace["version"]})
        self.out.plain("%s reached; %d topics closed" % (options.outcome, result["topics_closed"]))

from __future__ import annotations

"""Owner-only, bounded interactive handoff (docs/onboarding-prompt.md)."""
import json
import re

from .contract import Refusal
from . import invite as invitations

ROWS = 100
# Check only authorized text columns. Never inspect credential files or export records.
UNSAFE = re.compile(r"(?i)(?:\b(?:sk|ghp|gho|github_pat)[-_][a-z0-9_-]{8,}|\bbearer\s+\S+|"
                    r"-----BEGIN [^-]*PRIVATE KEY|\b(?:token|api[_ -]?key|secret|password)\s*[=:]\s*\S+|"
                    r"(?:/Users/|/home/|[A-Z]:\\|~/)[^\s]*|"
                    r"\S*(?:profile|session|identity|auth)\S*\.(?:json|pem|key)\b|"
                    r"\beyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\.[a-z0-9_-]+)")


def safe(value):
    value = str(value or "")
    if UNSAFE.search(value):
        raise Refusal("ONBOARDING_UNSAFE_CONTEXT", "The outcome contains private sign-in details. Remove them before copying an onboarding prompt.")
    return value


def text_column(name, maximum=1024):
    # Read at most maximum+1 characters; oversized facts fail closed rather than silently changing their meaning.
    return "substr(%s,1,%d) AS %s" % (name, maximum + 1, name.split(".")[-1])


def fact(value, maximum=1024):
    value = safe(value)
    if len(value) > maximum:
        raise Refusal("ONBOARDING_CONTEXT_TOO_LONG", "An outcome detail is too long for the onboarding prompt. Shorten it before copying.")
    return value


class Onboarding:
    def _onboarding_rules(self, db, actor, workspace_id):
        current = self._view_current_rule(db, actor, {"workspace_id": workspace_id})
        if current["availability"] == "unconfigured":
            return ["No current rule is configured; read current-rule in the CLI before acting."]
        record = current.get("record")
        if current["availability"] != "available" or record is None:
            return ["Current rules are unavailable; read current-rule in the CLI before acting."]
        # Screen the whole bounded selected record, including rules omitted below.
        encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        fact(encoded, 98304)
        lines = ["Policy %s revision %d; Notebook %s revision %d." % (
            fact(record["policy_id"]), record["revision"], fact(record["notebook_id"]), record["notebook_revision"])]
        size = len(lines[0])
        for rule in record["rules"]:
            line = "- %s revision %d: %s; source %s" % (
                fact(rule["id"]), rule["revision"], fact(rule["summary"], 4096),
                safe(json.dumps(rule["source"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))))
            if size + len(line) > 20000:
                lines.append("Rules context is truncated; read current-rule and its exact Notebook revision in the CLI.")
                break
            lines.append(line)
            size += len(line) + 1
        if not record["rules"]:
            lines.append("No rules are recorded in this current policy.")
        return lines

    def _view_onboarding_prompt(self, db, actor, args):
        variant = args.get("variant")
        if variant not in ("codex", "claude"):
            raise Refusal("INVALID_ARGUMENT", "Choose Codex or Claude.")
        # Authorize before reading textual context, including for coordinators and topic-only readers.
        workspace_id = args.get("workspace_id")
        owner = db.execute("SELECT owner_id FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if owner is None or owner[0] != actor:
            raise Refusal("FORBIDDEN", "Only the outcome's owner can copy its onboarding prompt.")
        workspace = self._workspace(db, actor, workspace_id)
        row = db.execute("SELECT " + text_column("title") + "," + text_column("purpose", 4096) +
                         " FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        owner_name = db.execute("SELECT " + text_column("name") + " FROM actors WHERE id=?", (actor,)).fetchone()[0]
        lines = ["Join this outcome as an interactive agent.",
                 "Use your shell tool to run commands. Read the applicable %s instructions before working." % (
                     "AGENTS.md" if variant == "codex" else "CLAUDE.md"), "",
                 "Outcome: " + fact(row["title"]), "Purpose: " + (fact(row["purpose"], 4096) or "No purpose recorded."),
                 "Owner: " + fact(owner_name) + " (" + safe(actor) + ")", "Outcome reference: " + safe(workspace_id), "", "Team:"]
        team = db.execute("SELECT m.actor_id," + text_column("a.name") + " FROM workspace_members m JOIN actors a ON a.id=m.actor_id "
                          "WHERE m.workspace_id=? ORDER BY m.actor_id LIMIT ?", (workspace_id, ROWS + 1)).fetchall()
        lines += ["- %s (%s)" % (fact(p["name"]), safe(p["actor_id"])) for p in team[:ROWS]]
        if len(team) > ROWS:
            lines.append("More team members are not included; read workspace_members with a cursor using the CLI view command.")
        lines += ["", "Open topics and waits:"]
        topics = db.execute("SELECT id,state," + text_column("title") + "," + text_column("state_note") +
                            " FROM topics INDEXED BY workspace_topic_order WHERE workspace_id=? AND archived=0 AND (state='done')=0 "
                            "AND kind='topic' ORDER BY list_position DESC,id DESC LIMIT ?", (workspace_id, ROWS + 1)).fetchall()
        for topic in topics[:ROWS]:
            # No message bodies, including the ask's private words, enter this read.
            waits = db.execute("SELECT q.actor_id," + text_column("a.name") + " FROM topic_waiting q JOIN actors a ON a.id=q.actor_id "
                               "WHERE q.topic_id=? ORDER BY q.actor_id LIMIT 33", (topic["id"],)).fetchall()
            waiting = ", ".join("%s (%s)" % (fact(p["name"]), safe(p["actor_id"])) for p in waits[:32])
            line = "- %s (%s): %s; %s%s" % (fact(topic["title"]), safe(topic["id"]), topic["state"],
                                            "waits on " + waiting if waits else "no recorded wait",
                                            "; more waits not included" if len(waits) > 32 else "")
            note = fact(topic["state_note"])
            if note:
                line += "; " + note
            if len("\n".join(lines).encode("utf-8")) + len(line.encode("utf-8")) > 90000:
                lines.append("More open topic context is not included; use topics and read in the CLI.")
                break
            lines.append(line)
        if not topics:
            lines.append("No open topics recorded.")
        if len(topics) > ROWS:
            lines.append("More open topics are not included; use topics in the CLI.")
        lines += ["", "Pipeline Now (short names):"]
        now = self._onboarding_now(db, workspace, ROWS)
        lines.append("Source: pipeline %s revision %d; workspace revision %d." % (
            safe(workspace_id), now["pipeline_revision"], now["workspace_revision"]))
        if now["availability"] == "unconfigured":
            lines.append("No pipeline is configured.")
        elif now["availability"] == "disabled":
            lines.append("Pipeline is disabled.")
        else:
            for item in now["items"]:
                title = fact(item["title"])
                reference = "item %d revision %d" % (item["number"], item["version"])
                if item.get("piece_id"):
                    reference += "; piece %s revision %d; stage entry %d" % (
                        safe(item["piece_id"]), item["piece_revision"], item["stage_entry"])
                lines.append("- %d: %s%s [%s]" % (item["number"], title[:100], "…" if len(title) > 100 else "", reference))
            if now["unverified"]:
                lines.append("Now context is unavailable for unverified legacy entries; read pipeline in the CLI. Verified current work above remains valid.")
            elif not now["items"]:
                lines.append("No Now items in the bounded current context.")
            if now["truncated"]:
                lines.append("Now context is truncated; read pipeline with its cursor in the CLI.")
        lines += ["", "Outcome rules:"] + self._onboarding_rules(db, actor, workspace_id)
        lines += ["",
                  "Owner setup (one step before CLI use): use Team → + Invite agent to grant this agent its own named identity, and securely configure its CLI sign-in separately. Keep sign-in details out of this prompt and conversation. Do not use another member's identity.", "",
                  "Read docs/agent-cli.md for the existing local CLI contract and docs/agent-guide.md for how to work here.",
                  "In the owner's checkout, bin/aim-next uses the local Store without starting a server. Every invocation needs --profile <OWNER_SUPPLIED_SIGN_IN>; this placeholder is not a file location.",
                  "After that setup, replace the placeholder privately, then use:",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> binding",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> topics <OUTCOME>",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> read <TOPIC> --after <SEQ> --limit 50",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> pipeline <OUTCOME> --section now",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> current-rule <OUTCOME>",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> cover <MESSAGE>",
                  "Read the source's raw Markdown/current revision and the dossier's root/cover revision. Replace every placeholder from those reads before running these examples; offsets count Unicode code points. For a factual human question, choose literal A/B with no promised default:",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> reply <MESSAGE> --asks <HUMAN> --no-go-ahead --quote-revision <SOURCE_REVISION> --quote-start <START> --quote-end <END> --ask-wait '{\"root_id\":\"<DOSSIER_ROOT>\",\"cover_revision\":<COVER_REVISION>,\"questions\":[{\"actor_id\":\"<HUMAN>\",\"text\":\"Which option?\",\"options\":[\"A\",\"B\"],\"default\":null,\"reason\":\"No default promised.\"}]}' --operation <RETAINED_OPERATION> -",
                  "For information, use reply with --tells <RECIPIENT>, the same current quote flags and a retained operation. If no passage fits, replace the quote flags with --without-quote and an explicit reason. Use --go-ahead when asking permission to act. Read docs/asking-person-cover.md for the actual choices/default contract; never invent a promised default.",
                  "Use the outcome reference above for <OUTCOME>, and actual topic/message references from reads. Read pages with their cursors through view when more context remains. Use --asks for a question and --tells for information; stdin (-) preserves your words. Read back after posting. Reads do not acknowledge deliveries.",
                  "If a send is uncertain, retain its exact operation and writing; use retry on that same operation rather than sending again with a new identity.",
                  "This is a bounded snapshot read when Copy was pressed. Read current state again before acting. Theseus starts no runner when it generates this prompt; begin the assignment only after the owner supplies your own identity and you read the guide.", "",
                  invitations.assignment_text("codex" if variant == "codex" else "claude-code")]
        if len(json.dumps("\n".join(lines), ensure_ascii=False).encode("utf-8")) > 120000:
            raise Refusal("ONBOARDING_CONTEXT_TOO_LONG", "The current context is too long for an onboarding prompt. Read it through the CLI instead.")
        return {"instance_id": self.instance_id, "workspace_id": workspace_id, "variant": variant, "prompt": "\n".join(lines)}

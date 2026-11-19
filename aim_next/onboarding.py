from __future__ import annotations

"""Owner-only, bounded interactive handoff (docs/onboarding-prompt.md)."""
import json
import re

from .contract import Refusal

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
    def _view_onboarding_prompt(self, db, actor, args):
        variant = args.get("variant")
        if variant not in ("codex", "claude"):
            raise Refusal("INVALID_ARGUMENT", "Choose Codex or Claude.")
        # Authorize before reading textual context, including for coordinators and topic-only readers.
        workspace_id = args.get("workspace_id")
        owner = db.execute("SELECT owner_id FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if owner is None or owner[0] != actor:
            raise Refusal("FORBIDDEN", "Only the outcome's owner can copy its onboarding prompt.")
        self._workspace(db, actor, workspace_id)
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
        pipeline = db.execute("SELECT enabled,ships_in_releases FROM pipelines WHERE workspace_id=?", (workspace_id,)).fetchone()
        now = []
        if pipeline is None or not pipeline["enabled"]:
            lines.append("No enabled pipeline context.")
        else:
            # Releases have no item index. Bound that lookup too; do not reconstruct all release history.
            releases = db.execute("SELECT items FROM releases ORDER BY number DESC LIMIT ?", (ROWS + 1,)).fetchall() if pipeline["ships_in_releases"] else []
            if len(releases) > ROWS:
                lines.append("Now context is unavailable within this read's release-history limit; use pipeline in the CLI.")
            else:
                shipped = {n for r in releases for n in json.loads(r[0])}
                candidates = db.execute("SELECT number," + text_column("title") + ",(finished_note<>'') AS finished FROM pipeline_items INDEXED BY pipeline_order "
                                        "WHERE workspace_id=? AND section='now' ORDER BY candidate_group,position,number LIMIT ?",
                                        (workspace_id, ROWS + 1)).fetchall()
                for item in candidates[:ROWS]:
                    if item["number"] in shipped or item["finished"]:
                        continue
                    done = db.execute("SELECT 1 FROM pipeline_piece_members m JOIN pipeline_stage_entries e ON e.piece_id=m.piece_id "
                                      "WHERE m.workspace_id=? AND m.number=? AND e.left_outcome='done' LIMIT 1", (workspace_id, item["number"])).fetchone()
                    if not done:
                        title = fact(item["title"])
                        now.append("- %d: %s%s" % (item["number"], title[:100], "…" if len(title) > 100 else ""))
                lines += now or ["No Now items in the bounded current context."]
                if len(candidates) > ROWS:
                    lines.append("More Now context is not included; use pipeline in the CLI.")
        lines += ["", "Outcome rules:",
                  "No rules context: this version has no outcome rules setting or pinned-note source. Do not infer rules from ordinary Notebook pages.", "",
                  "Owner setup (one step before CLI use): use Team → + Invite agent to grant this agent its own named identity, and securely configure its CLI sign-in separately. Keep sign-in details out of this prompt and conversation. Do not use another member's identity.", "",
                  "Read docs/agent-cli.md for the existing local CLI contract and docs/agent-guide.md for how to work here.",
                  "In the owner's checkout, bin/aim-next uses the local Store without starting a server. Every invocation needs --profile <OWNER_SUPPLIED_SIGN_IN>; this placeholder is not a file location.",
                  "After that setup, replace the placeholder privately, then use:",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> binding",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> topics <OUTCOME>",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> read <TOPIC> --after <SEQ> --limit 50",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> pipeline <OUTCOME> --section now",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> post <TOPIC> --tells <RECIPIENT> --operation <RETAINED_OPERATION> -",
                  "  bin/aim-next --profile <OWNER_SUPPLIED_SIGN_IN> reply <MESSAGE> --asks <RECIPIENT> -",
                  "Use the outcome reference above for <OUTCOME>, and actual topic/message references from reads. Read pages with their cursors through view when more context remains. Use --asks for a question and --tells for information; stdin (-) preserves your words. Read back after posting. Reads do not acknowledge deliveries.",
                  "If a send is uncertain, retain its exact operation and writing; use retry on that same operation rather than sending again with a new identity.",
                  "This is a bounded snapshot read when Copy was pressed. Read current state again before acting. Work interactively with the owner; this prompt starts no autonomous runner."]
        if len(json.dumps("\n".join(lines), ensure_ascii=False).encode("utf-8")) > 120000:
            raise Refusal("ONBOARDING_CONTEXT_TOO_LONG", "The current context is too long for an onboarding prompt. Read it through the CLI instead.")
        return {"instance_id": self.instance_id, "workspace_id": workspace_id, "variant": variant, "prompt": "\n".join(lines)}

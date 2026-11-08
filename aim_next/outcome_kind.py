from __future__ import annotations

"""An outcome's kind, and its end (D22, D41, D42; docs/targets.md).

Every outcome is one of two kinds, chosen when it is started and changeable by
its owner: to reach (it ends, on its owner's word: Reached) or to keep (it goes
on). An outcome made before release 21 has no kind record and reads to keep.
Reached is final: every topic closes, and every later change to the outcome is
refused OUTCOME_REACHED, while a reader's own state there still saves
(REACHED_EXEMPT).

Seam until skills (17) lands: an outcome has no tools of its own, so nothing
blocks Reached for TOOLS_IN_USE and nothing retires with it.
"""

import json

from .contract import Refusal, _body
from .delivery import _now_ms
from . import outcome_rules


KINDS_SCHEMA = [
    "CREATE TABLE outcome_kinds (workspace_id TEXT NOT NULL REFERENCES workspaces(id), seq INTEGER NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('reach','keep')), origin TEXT NOT NULL CHECK(origin IN ('create','change')), "
    "set_by TEXT NOT NULL REFERENCES actors(id), set_ms INTEGER NOT NULL, PRIMARY KEY(workspace_id, seq))",
    "CREATE UNIQUE INDEX kinds_one_start ON outcome_kinds(workspace_id) WHERE origin = 'create'",
    "CREATE TRIGGER kinds_start_first BEFORE INSERT ON outcome_kinds WHEN NEW.origin = 'create' AND NEW.seq <> 1 "
    "BEGIN SELECT RAISE(ABORT, 'a start record is the first row'); END",
    "CREATE TRIGGER kinds_stay_u BEFORE UPDATE ON outcome_kinds BEGIN SELECT RAISE(ABORT, 'a kind keeps its past'); END",
    "CREATE TRIGGER kinds_stay_d BEFORE DELETE ON outcome_kinds BEGIN SELECT RAISE(ABORT, 'a kind keeps its past'); END",
    "CREATE TABLE outcome_reached (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), "
    "words TEXT NOT NULL CHECK(length(trim(words)) BETWEEN 1 AND 500), unmet TEXT NOT NULL DEFAULT '[]', "
    "reached_by TEXT NOT NULL REFERENCES actors(id), reached_ms INTEGER NOT NULL)",
    "CREATE TRIGGER reached_stays_u BEFORE UPDATE ON outcome_reached BEGIN SELECT RAISE(ABORT, 'reached is final'); END",
    "CREATE TRIGGER reached_stays_d BEFORE DELETE ON outcome_reached BEGIN SELECT RAISE(ABORT, 'reached is final'); END",
]
KINDS_DOWN = ("DROP TABLE outcome_reached", "DROP TABLE outcome_kinds")

# Commands that touch only the sender's own record, and so still save in a
# reached outcome's topics (4.5). Every other command that writes in a reached
# outcome is refused OUTCOME_REACHED (Store._refuse_reached).
REACHED_EXEMPT = frozenset({
    "topic.read_through", "message.mark", "delivery.ack", "note.save", "draft.save", "submission.prepare",
    "media.begin", "media.publish", "color.set", "workspace.create", "memory.read",
})


def _clock(ms):
    import time
    return time.strftime("%b %-d", time.localtime(ms / 1000.0))


class OutcomeKind:
    """Store mixin: an outcome's kind (outcome.kind_set), Reached (outcome.reach) and the reached guard."""

    def _kind_facts(self, db, workspace):
        """{kind, start: {by, ms} | None, reached: {by, ms, words, unmet} | None} for one outcome."""
        row = db.execute("SELECT kind FROM outcome_kinds WHERE workspace_id=? ORDER BY seq DESC LIMIT 1", (workspace["id"],)).fetchone()
        start = db.execute("SELECT set_by,set_ms FROM outcome_kinds WHERE workspace_id=? AND origin='create'", (workspace["id"],)).fetchone()
        reached = db.execute("SELECT * FROM outcome_reached WHERE workspace_id=?", (workspace["id"],)).fetchone()
        return {"kind": row[0] if row else outcome_rules.KIND_BEFORE_R21,
                "start": {"by": start["set_by"], "ms": start["set_ms"]} if start else None,
                "reached": ({"by": reached["reached_by"], "ms": reached["reached_ms"], "words": reached["words"],
                             "unmet": json.loads(reached["unmet"])} if reached else None)}

    def _write_start_kind(self, db, workspace_id, actor, kind, ms):
        """D41, D22: workspace.create's kind, as the outcome's start record."""
        if kind not in outcome_rules.KINDS:
            raise Refusal("INVALID_ARGUMENT", "Say what kind of outcome it is: to reach (it ends) or to keep (it goes on)")
        db.execute("INSERT INTO outcome_kinds VALUES (?,1,?,'create',?,?)", (workspace_id, kind, actor, ms))

    def _bump_workspace(self, db, workspace_id):
        db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (workspace_id,))
        version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0]
        self._change(db, "workspace", workspace_id, "workspace", workspace_id, version)
        return version

    def _command_outcome_kind_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"kind"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome and its kind")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if workspace["owner_id"] != actor:
            raise Refusal("FORBIDDEN", "Only %s, this outcome's owner, changes its kind" % workspace["owner_id"])
        self._check_revision(envelope, "workspace_revision", workspace["version"])
        kind = args["kind"]
        if kind not in outcome_rules.KINDS:
            raise Refusal("INVALID_ARGUMENT", "An outcome is to reach or to keep")
        facts = self._kind_facts(db, workspace)
        if facts["kind"] == kind:
            return {"workspace_id": workspace["id"], "kind": kind, "changed": False, "workspace_revision": workspace["version"]}, []
        seq = db.execute("SELECT coalesce(max(seq),0)+1 FROM outcome_kinds WHERE workspace_id=?", (workspace["id"],)).fetchone()[0]
        db.execute("INSERT INTO outcome_kinds VALUES (?,?,?,'change',?,?)", (workspace["id"], seq, kind, actor, _now_ms()))
        version = self._bump_workspace(db, workspace["id"])
        return {"workspace_id": workspace["id"], "kind": kind, "changed": True, "workspace_revision": version}, [
            {"kind": "workspace", "id": workspace["id"], "version": version}]

    def _command_outcome_reach(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or "words" not in args or set(args) - {"words", "unmet_confirmed"}:
            raise Refusal("INVALID_ARGUMENT", "Reached carries the owner's words, and whether checks not met are confirmed")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if workspace["owner_id"] != actor:
            raise Refusal("FORBIDDEN", "Only %s, this outcome's owner, says it is reached" % workspace["owner_id"])
        self._check_revision(envelope, "workspace_revision", workspace["version"])
        facts = self._kind_facts(db, workspace)
        if facts["reached"]:
            raise Refusal("OUTCOME_REACHED", "%s was reached on %s; its topics are kept to read." % (workspace["title"], _clock(facts["reached"]["ms"])))
        if facts["kind"] != "reach":
            raise Refusal("NOT_TO_REACH", "%s is an outcome to keep; it goes on. Its owner can change its kind first." % workspace["title"])
        words = args["words"]
        if not isinstance(words, str) or not words.strip() or len(words) > 500:
            raise Refusal("WHY_REQUIRED", "Say in your own words why it is reached (at most 500 characters)")
        checks, statuses = self._check_statuses(db, actor, workspace)
        offered, unmet = outcome_rules.reach_offered(checks, statuses)
        if not offered and args.get("unmet_confirmed") is not True:
            if not checks:
                raise Refusal("NOT_MET", "Nothing checks this outcome. Confirm to mark it reached anyway.")
            raise Refusal("NOT_MET", "Not met yet: %s. Confirm to mark it reached anyway."
                          % ", ".join("“%s” (%s)" % (item["name"], item["why"].replace("_", " ")) for item in unmet))
        ms = _now_ms()
        db.execute("INSERT INTO outcome_reached VALUES (?,?,?,?,?)",
                   (workspace["id"], _body(words.strip()), json.dumps([item["check_id"] for item in unmet]), actor, ms))
        note = "Closed when %s was reached" % workspace["title"]
        closed = 0
        for row in db.execute("SELECT id FROM topics WHERE workspace_id=? AND NOT (state='done' AND archived=1)", (workspace["id"],)).fetchall():
            topic = self._topic(db, actor, row[0])
            self._set_topic_state(db, topic, actor, {"state": "done", "note": note, "waiting_on": [], "archived": True})
            # Every wait in it clears, asks included (D42).
            now_version = db.execute("SELECT version FROM topics WHERE id=?", (topic["id"],)).fetchone()[0]
            for (member,) in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=?", (topic["id"],)).fetchall():
                db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic["id"], member))
                self._change(db, "actor", member, "waiting", topic["id"], now_version)
            # The conversation keeps each of its open asks on its own (standing_conversation.py); they clear too.
            db.execute("DELETE FROM conversation_waits WHERE ask_id IN (SELECT id FROM messages WHERE topic_id=?)", (topic["id"],))
            # The count says the topics the owner sees listed; the conversation, which has its own row, closes beside them.
            closed += topic["kind"] == "topic"
        version = self._bump_workspace(db, workspace["id"])
        return {"workspace_id": workspace["id"], "reached_ms": ms, "topics_closed": closed, "workspace_revision": version}, [
            {"kind": "workspace", "id": workspace["id"], "version": version}]

    def _refuse_reached(self, db, kind, since_seq):
        """After a command wrote: refuse it when it wrote in a reached outcome, unless it only touches the sender's own record."""
        if kind in REACHED_EXEMPT or kind == "outcome.reach":
            return
        if not db.execute("SELECT 1 FROM outcome_reached LIMIT 1").fetchone():
            return
        row = db.execute(
            "SELECT w.title,r.reached_ms FROM changes c "
            "LEFT JOIN topics t ON c.scope_kind='topic' AND t.id=c.scope_id "
            "JOIN outcome_reached r ON r.workspace_id=CASE WHEN c.scope_kind='workspace' THEN c.scope_id ELSE t.workspace_id END "
            "JOIN workspaces w ON w.id=r.workspace_id WHERE c.seq>? LIMIT 1", (since_seq,)).fetchone()
        if row is not None:
            raise Refusal("OUTCOME_REACHED", "%s was reached on %s; its topics are kept to read." % (row[0], _clock(row[1])))

from __future__ import annotations

"""An outcome archived or completed, and brought back (item 404; docs/targets.md, "Archived and completed").

Its owner archives an outcome he is no longer pursuing, or completes one that
is done, of either kind, with one act and no words; Bring back (the state
open) undoes either. Each act is a new row of outcome_ends, so the history is
kept: an outcome's state is its newest row, and no row, or open, means it is
neither. Archiving or completing archives every topic of the outcome not
already archived, its Conversation too, through the topic path (topic_state),
and records which; Bring back unarchives exactly those. Every count that
leaves archived topics out then leaves the outcome out.

While an outcome is archived or completed, or reached (outcome_kind.py), it is
kept to read: Store._refuse_closed refuses every command that wrote in it,
except those that touch only the sender's own record (REACHED_EXEMPT) and this
act itself. Reached stays final and separate: a reached outcome is never
archived, completed or brought back, and an archived or completed one is
brought back before it can be said to be reached.
"""

import json

from .contract import Refusal
from .delivery import _now_ms
from .outcome_kind import REACHED_EXEMPT, _clock


ENDS_SCHEMA = [
    "CREATE TABLE outcome_ends (workspace_id TEXT NOT NULL REFERENCES workspaces(id), seq INTEGER NOT NULL, "
    "state TEXT NOT NULL CHECK(state IN ('archived','completed','open')), topics TEXT NOT NULL DEFAULT '[]', "
    "set_by TEXT NOT NULL REFERENCES actors(id), set_ms INTEGER NOT NULL, PRIMARY KEY(workspace_id, seq))",
    "CREATE TRIGGER ends_stay_u BEFORE UPDATE ON outcome_ends BEGIN SELECT RAISE(ABORT, 'an end keeps its past'); END",
    "CREATE TRIGGER ends_stay_d BEFORE DELETE ON outcome_ends BEGIN SELECT RAISE(ABORT, 'an end keeps its past'); END",
]
ENDS_DOWN = ("DROP TABLE outcome_ends",)
ENDS_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM outcome_ends)"

STATES = ("archived", "completed", "open")
# Whether the row's outcome is archived or completed now: its newest end row, one primary-key lookup.
ENDED = "coalesce((SELECT e.state FROM outcome_ends e WHERE e.workspace_id=w.id ORDER BY e.seq DESC LIMIT 1),'open')<>'open'"


def end_view(end):
    """What a reader is told of an end: {state, by, ms}, or None while the outcome is open."""
    return None if end is None else {"state": end["state"], "by": end["by"], "ms": end["ms"]}


class OutcomeEnd:
    """Store mixin: outcome.end_set, and the guard that keeps a closed outcome to read."""

    def _end(self, db, workspace_id):
        """The outcome's end while it is archived or completed: {state, by, ms, topics}; None while it is open."""
        row = db.execute("SELECT state,topics,set_by,set_ms FROM outcome_ends WHERE workspace_id=? ORDER BY seq DESC LIMIT 1",
                         (workspace_id,)).fetchone()
        if row is None or row["state"] == "open":
            return None
        return {"state": row["state"], "by": row["set_by"], "ms": row["set_ms"], "topics": json.loads(row["topics"])}

    def _closed(self, db, workspace_id):
        """Whether the outcome is kept to read, and why: {how: reached | archived | completed, by, ms}, or None."""
        reached = db.execute("SELECT reached_by,reached_ms FROM outcome_reached WHERE workspace_id=?", (workspace_id,)).fetchone()
        if reached is not None:
            return {"how": "reached", "by": reached["reached_by"], "ms": reached["reached_ms"]}
        end = self._end(db, workspace_id)
        return None if end is None else {"how": end["state"], "by": end["by"], "ms": end["ms"]}

    def _closed_refusal(self, db, actor, workspace_id, closed, then=None):
        """The refusal of a write in a closed outcome, in words that say who can bring it back (then: what the end says)."""
        title, owner = db.execute("SELECT title,owner_id FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if closed["how"] == "reached":
            return Refusal("OUTCOME_REACHED", "%s was reached on %s; its topics are kept to read." % (title, _clock(closed["ms"])))
        head = "%s is archived" % title if closed["how"] == "archived" else "%s was completed on %s" % (title, _clock(closed["ms"]))
        then = then or ("bring it back to change anything in it." if actor == owner else "%s, its owner, can bring it back." % owner)
        return Refusal("OUTCOME_ARCHIVED" if closed["how"] == "archived" else "OUTCOME_COMPLETED", "%s; %s" % (head, then))

    def _refuse_if_closed(self, db, actor, workspace_id):
        """For the acts the guard cannot see (they write only the sender's scope): refuse in a closed outcome."""
        closed = self._closed(db, workspace_id)
        if closed is not None:
            raise self._closed_refusal(db, actor, workspace_id, closed)

    def _refuse_closed(self, db, actor, kind, since_seq):
        """After a command wrote: refuse it when it wrote in a closed outcome, unless it only touches the sender's own
        record, or is this act; outcome.reach is refused by a reached outcome only before it writes (D42, item 404)."""
        if kind in REACHED_EXEMPT or kind == "outcome.end_set":
            return
        if not db.execute("SELECT EXISTS (SELECT 1 FROM outcome_reached) OR EXISTS (SELECT 1 FROM outcome_ends)").fetchone()[0]:
            return
        for (workspace_id,) in db.execute(
                "SELECT DISTINCT CASE WHEN c.scope_kind='workspace' THEN c.scope_id ELSE t.workspace_id END FROM changes c "
                "LEFT JOIN topics t ON c.scope_kind='topic' AND t.id=c.scope_id "
                "WHERE c.seq>? AND c.scope_kind IN ('workspace','topic')", (since_seq,)).fetchall():
            closed = self._closed(db, workspace_id)
            if closed is not None and not (kind == "outcome.reach" and closed["how"] == "reached"):
                raise self._closed_refusal(db, actor, workspace_id, closed)

    def _command_outcome_end_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"state"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome and whether it is archived, completed or open")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if workspace["owner_id"] != actor:
            raise Refusal("FORBIDDEN", "Only %s, this outcome's owner, archives, completes or brings it back" % workspace["owner_id"])
        self._check_revision(envelope, "workspace_revision", workspace["version"])
        state = args["state"]
        if state not in STATES:
            raise Refusal("INVALID_ARGUMENT", "An outcome is archived, completed or open")
        reached = self._kind_facts(db, workspace)["reached"]
        if reached:
            raise Refusal("OUTCOME_REACHED", "%s was reached on %s; Reached is final, and its topics are kept to read."
                          % (workspace["title"], _clock(reached["ms"])))
        end = self._end(db, workspace["id"])
        if (end["state"] if end else "open") == state:
            return {"workspace_id": workspace["id"], "state": state, "changed": False, "topics": 0, "workspace_revision": workspace["version"]}, []
        if state == "open":
            # Bring back: exactly the topics the act archived that are still archived, and only this outcome's, so no id
            # on the row can reach outside it.
            listed, moved = [], [row[0] for row in db.execute(
                "SELECT id FROM topics WHERE workspace_id=? AND archived=1 AND id IN (SELECT value FROM json_each(?)) ORDER BY id",
                (workspace["id"], json.dumps(end["topics"])))]
        elif end is None:
            listed = moved = [row[0] for row in db.execute("SELECT id FROM topics WHERE workspace_id=? AND archived=0 ORDER BY id", (workspace["id"],))]
        else:
            # Between archived and completed the list is carried, and no topic is touched.
            listed, moved = end["topics"], []
        seq = db.execute("SELECT coalesce(max(seq),0)+1 FROM outcome_ends WHERE workspace_id=?", (workspace["id"],)).fetchone()[0]
        db.execute("INSERT INTO outcome_ends VALUES (?,?,?,?,?,?)", (workspace["id"], seq, state, json.dumps(listed), actor, _now_ms()))
        for topic_id in moved:
            result, _ = self._set_topic_state(db, self._topic(db, actor, topic_id), actor, {"archived": state != "open"})
            # Each waiter learns of it in their own scope, asked as well as said, so their Waiting on you reads again
            # (_set_topic_state tells only those it was said to wait on).
            for (member,) in db.execute("SELECT actor_id FROM topic_waiting WHERE topic_id=? AND said=0", (topic_id,)).fetchall():
                self._change(db, "actor", member, "waiting", topic_id, result["version"])
        # Each topic touched has advanced the outcome too (_touch_topic); the act takes it one further.
        db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (workspace["id"],))
        version = db.execute("SELECT version FROM workspaces WHERE id=?", (workspace["id"],)).fetchone()[0]
        self._outcome_change(db, workspace["id"], version)
        # Every member's lists read again: it leaves them, or comes back to them.
        for (member,) in db.execute("SELECT actor_id FROM workspace_members WHERE workspace_id=? ORDER BY actor_id", (workspace["id"],)).fetchall():
            self._change(db, "actor", member, "workspace", workspace["id"], version)
        return {"workspace_id": workspace["id"], "state": state, "changed": True, "topics": len(moved), "workspace_revision": version}, [
            {"kind": "workspace", "id": workspace["id"], "version": version}]

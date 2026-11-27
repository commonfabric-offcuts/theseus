from __future__ import annotations

"""Whether agents pick up their wakes, from what Core already records.

A wake that reached an agent (an accepted notice, or a hosted turn started
with its work) and was followed by nothing from that agent is unanswered.
After PARKED_AFTER of them in a row the agent is parked: it is not woken again
for work a wake that reached it already named (named_seq), so a silent agent is
not woken over and over, and nothing it was sent is dropped. A delivery newer
than that still wakes it, naming everything pending, since a hosted agent can
act only in a turn a wake starts; and that wake goes again, as any wake does,
until one reaches the agent: a busy or failed notice, a turn that failed or
never saw its input, or a claim lost with its runner names nothing. Anything the agent then does through its profile (any
recorded command: a post, an acknowledgment, a read-through) is a sign of
life: the count clears and, if it was parked with work waiting, it is due at
once and its next notice names everything still pending. Its work reaching
nothing pending clears the count too.

The wakes view gives the names on a page what they need to say so: who is
parked, how much waits for them and since when, and whether wakes are going
out at all.
"""

import json

from .contract import ACTOR_SEAT_ENDED

from .whispers import READ_BY, on_record_wake_health
from .route_pins import KEY_PREFIX as _PIN_PREFIX, _key as _pin_key


PARKED_AFTER = 3
# What claims and due reads take into account: a parked recipient is due only
# for work newer than the last wake that reached it named, so the repeats stop
# and new work still reaches it.
ANSWERING = "(unanswered_wakes<%d OR named_seq IS NULL OR last_seq>named_seq)" % PARKED_AFTER
QUIET_LIMIT = 100

WAKE_HEALTH_SCHEMA = [
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_wakes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_since_ms INTEGER",
    # The last delivery a wake that reached the recipient named; NULL once that wake is taken back.
    "ALTER TABLE recipient_schedule ADD COLUMN named_seq INTEGER",
    # When the runner stopped or exited; its state says which ('stopped', 'exited').
    "ALTER TABLE runner_state ADD COLUMN ended_ms INTEGER",
]
WAKE_HEALTH_DOWN = (
    # Version 21 knows a runner that is not running only as idle, with no lease.
    "UPDATE runner_state SET state='idle',reason_code=NULL WHERE state IN ('stopped','exited')",
    "ALTER TABLE runner_state DROP COLUMN ended_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN named_seq",
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_since_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_wakes",
)
# The counts and the runner's end are derived from wakes and exits, nobody's
# records: a step back drops them rather than being refused for them.
WAKE_HEALTH_OCCUPIED = "SELECT 0"


class WakeHealth:
    def _wake_named(self, db, recipient, seq):
        """A notice naming every delivery through seq is in front of the recipient."""
        db.execute("UPDATE recipient_schedule SET named_seq=? WHERE recipient_id=?", (seq, recipient))

    def _wake_unanswered(self, db, recipient, now, seq):
        """A wake reached the recipient, naming work through seq; it stays unanswered until the recipient does something."""
        db.execute("UPDATE recipient_schedule SET unanswered_wakes=unanswered_wakes+1,unanswered_since_ms=COALESCE(unanswered_since_ms,?),named_seq=? "
                   "WHERE recipient_id=?", (now, seq, recipient))

    def _wake_withdrawn(self, db, recipient):
        """A counted wake turned out not to reach the recipient (its turn failed or was lost)."""
        db.execute("UPDATE recipient_schedule SET unanswered_wakes=unanswered_wakes-1,"
                   "unanswered_since_ms=CASE WHEN unanswered_wakes=1 THEN NULL ELSE unanswered_since_ms END "
                   "WHERE recipient_id=? AND unanswered_wakes>0", (recipient,))

    def _sign_of_life(self, db, actor, now):
        """The actor recorded a command: its wakes are answered, and a parked actor with work is woken once."""
        row = db.execute("SELECT unanswered_wakes,pending_count,claim_token,claim_until_ms,handed_seq FROM recipient_schedule WHERE recipient_id=?",
                         (actor,)).fetchone()
        if row is None or row["unanswered_wakes"] == 0:
            return
        # A hosted turn that holds the work (handed_seq) and is acting needs no wake.
        if row["unanswered_wakes"] >= PARKED_AFTER and row["pending_count"] and row["handed_seq"] is None:
            live = row["claim_token"] is not None and row["claim_until_ms"] > now
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=0,unanswered_since_ms=NULL,retry_count=0,next_due_ms=? "
                       "WHERE recipient_id=?", (row["claim_until_ms"] if live else now, actor))
        else:
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=0,unanswered_since_ms=NULL WHERE recipient_id=?", (actor,))

    def _runner_light(self, db, now):
        """Whether wakes are going out, and if not, what Core knows of why and since when."""
        state = self._runner_state(db)
        if state["state"] == "running" and state["lease_until_ms"] > now:
            return {"live": True}
        if state["state"] == "paused":
            return {"live": False, "state": "paused", "reason": state["reason_code"]}
        if state["state"] == "stopped":
            return {"live": False, "state": "stopped", "since_ms": state["ended_ms"]}
        if state["state"] == "exited":
            return {"live": False, "state": "exited", "reason": state["reason_code"], "since_ms": state["ended_ms"]}
        if state["state"] == "running":
            # It stopped renewing without saying so: it is known gone once its lease ends.
            return {"live": False, "state": "unrenewed", "since_ms": state["lease_until_ms"]}
        return {"live": False, "state": "never_run"}

    def _routed(self, db):
        """Whether an agent has a route pin in this instance (the agents the runner wakes), from one read of the pins."""
        pins = {row[0] for row in db.execute("SELECT key FROM metadata WHERE key>? AND key<?", (_PIN_PREFIX, _PIN_PREFIX[:-1] + ";"))}
        def routed(actor):
            return _pin_key({"instance_id": self.instance_id, "actor_id": actor, "db_path": str(self.path),
                             "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]}) in pins
        return routed

    def _view_wakes(self, db, actor, args):
        """Agents whose wakes are not getting through: parked ones, or every woken agent with work while wakes are not going out.

        While wakes are not going out and work waits for a routed agent in an
        outcome the reader owns, the reader gets a notice: someone has to start
        the runner again, or see why it stopped."""
        from .delivery import _now_ms
        now = _now_ms()
        runner = self._runner_light(db, now)
        live = runner["live"]
        quiet = []
        if live:
            rows = db.execute("SELECT s.recipient_id,s.pending_count,s.unanswered_since_ms FROM recipient_schedule s JOIN actors a ON a.id=s.recipient_id "
                              "WHERE s.unanswered_wakes>=? AND s.pending_count>0 AND a.kind='agent' AND a.enabled=1 AND NOT " +
                              ACTOR_SEAT_ENDED + " ORDER BY s.recipient_id LIMIT ?",
                              (PARKED_AFTER, QUIET_LIMIT)).fetchall()
            quiet = [{"actor_id": row["recipient_id"], "waiting": row["pending_count"], "since_ms": row["unanswered_since_ms"],
                      "why": "not_answering"} for row in rows]
        else:
            # Only routed agents are listed, so the limit counts them alone: unrouted ones never crowd them out.
            routed = self._routed(db)
            rows = db.execute("SELECT s.recipient_id,s.pending_count FROM recipient_schedule s JOIN actors a ON a.id=s.recipient_id "
                              "WHERE s.pending_count>0 AND a.kind='agent' AND a.enabled=1 AND NOT " +
                              ACTOR_SEAT_ENDED + " ORDER BY s.recipient_id")
            for row in rows:
                if routed(row["recipient_id"]):
                    quiet.append({"actor_id": row["recipient_id"], "waiting": row["pending_count"], "why": "wakes_paused"})
                    if len(quiet) == QUIET_LIMIT:
                        break
        # Others see only what waits on the record, and their own whispers: a whisper's wake is never shown outside it.
        quiet = on_record_wake_health(db, actor, quiet)
        result = {"instance_id": self.instance_id, "runner": runner, "quiet": quiet}
        if not live and quiet:
            # The reader is told of the agents whose work waits in an outcome the reader owns.
            owned = db.execute("SELECT count(DISTINCT g.recipient_id) FROM delivery_groups g "
                               "JOIN deliveries d ON d.group_id=g.id AND d.state='pending' JOIN messages m ON m.id=d.message_id AND " + READ_BY + " "
                               "JOIN topics t ON t.id=m.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                               "WHERE g.recipient_id IN (SELECT value FROM json_each(?)) AND g.active=1 AND g.pending_count>0 AND w.owner_id=?",
                               (actor, json.dumps([item["actor_id"] for item in quiet]), actor)).fetchone()[0]
            if owned:
                result["notice"] = {"waiting_agents": owned}
        return result

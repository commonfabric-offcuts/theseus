from __future__ import annotations

"""Whether agents pick up their wakes, from what Core already records.

A wake that reached an agent (an accepted notice, or a hosted turn started
with its work) and was followed by nothing from that agent is unanswered.
After PARKED_AFTER of them in a row the agent is parked: it is not woken again
for work it was already told of, so a silent agent is not woken over and over,
and nothing it was sent is dropped. A delivery newer than its last wake still
wakes it once, naming everything pending, since a hosted agent can act only in
a turn a wake starts. Anything the agent then does through its profile (any
recorded command: a post, an acknowledgment, a read-through) is a sign of
life: the count clears and, if it was parked with work waiting, it is due at
once and its next notice names everything still pending. Its work reaching
nothing pending clears the count too.

The wakes view gives the names on a page what they need to say so: who is
parked, how much waits for them and since when, and whether wakes are going
out at all.
"""

from .route_pins import _key as _pin_key


PARKED_AFTER = 3
# What claims and due reads take into account: a parked recipient is due only
# for work newer than its last wake named (captured_seq), so the repeats stop
# and new work still reaches it.
ANSWERING = "(unanswered_wakes<%d OR last_seq>captured_seq)" % PARKED_AFTER
QUIET_LIMIT = 100

WAKE_HEALTH_SCHEMA = [
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_wakes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_since_ms INTEGER",
    # When the runner stopped or exited; its state says which ('stopped', 'exited').
    "ALTER TABLE runner_state ADD COLUMN ended_ms INTEGER",
]
WAKE_HEALTH_DOWN = (
    # Version 17 knows a runner that is not running only as idle, with no lease.
    "UPDATE runner_state SET state='idle',reason_code=NULL WHERE state IN ('stopped','exited')",
    "ALTER TABLE runner_state DROP COLUMN ended_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_since_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_wakes",
)
# The counts and the runner's end are derived from wakes and exits, nobody's
# records: a step back drops them rather than being refused for them.
WAKE_HEALTH_OCCUPIED = "SELECT 0"


class WakeHealth:
    def _wake_unanswered(self, db, recipient, now):
        """A wake reached the recipient; it stays unanswered until the recipient does something."""
        db.execute("UPDATE recipient_schedule SET unanswered_wakes=unanswered_wakes+1,unanswered_since_ms=COALESCE(unanswered_since_ms,?) "
                   "WHERE recipient_id=?", (now, recipient))

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

    def _routed_here(self, db, actor):
        """Whether this agent has a route pin in this instance: the agents the runner wakes."""
        binding = {"instance_id": self.instance_id, "actor_id": actor, "db_path": str(self.path),
                   "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]}
        return db.execute("SELECT 1 FROM metadata WHERE key=?", (_pin_key(binding),)).fetchone() is not None

    def _view_wakes(self, db, actor, args):
        """Agents whose wakes are not getting through: parked ones, or every woken agent with work while wakes are not going out.

        While wakes are not going out and work waits for a routed agent, a
        reader who owns an outcome gets a notice: someone has to start the
        runner again, or see why it stopped."""
        from .delivery import _now_ms
        now = _now_ms()
        runner = self._runner_light(db, now)
        live = runner["live"]
        quiet = []
        if live:
            rows = db.execute("SELECT s.recipient_id,s.pending_count,s.unanswered_since_ms FROM recipient_schedule s JOIN actors a ON a.id=s.recipient_id "
                              "WHERE s.unanswered_wakes>=? AND s.pending_count>0 AND a.kind='agent' AND a.enabled=1 ORDER BY s.recipient_id LIMIT ?",
                              (PARKED_AFTER, QUIET_LIMIT)).fetchall()
            quiet = [{"actor_id": row["recipient_id"], "waiting": row["pending_count"], "since_ms": row["unanswered_since_ms"],
                      "why": "not_answering"} for row in rows]
        else:
            rows = db.execute("SELECT s.recipient_id,s.pending_count FROM recipient_schedule s JOIN actors a ON a.id=s.recipient_id "
                              "WHERE s.pending_count>0 AND a.kind='agent' AND a.enabled=1 ORDER BY s.recipient_id LIMIT ?",
                              (QUIET_LIMIT,)).fetchall()
            quiet = [{"actor_id": row["recipient_id"], "waiting": row["pending_count"], "why": "wakes_paused"}
                     for row in rows if self._routed_here(db, row["recipient_id"])]
        result = {"instance_id": self.instance_id, "runner": runner, "quiet": quiet}
        if not live and quiet and db.execute("SELECT 1 FROM workspaces WHERE owner_id=? LIMIT 1", (actor,)).fetchone():
            result["notice"] = {"waiting_agents": len(quiet)}
        return result

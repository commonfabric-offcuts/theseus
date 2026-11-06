from __future__ import annotations

"""Whether agents pick up their wakes, from what Core already records.

A wake that reached an agent (an accepted notice, or a hosted turn started
with its work) and was followed by nothing from that agent is unanswered.
After PARKED_AFTER of them in a row the agent is parked: no further wake is
claimed for it, so a silent agent is not woken over and over, and nothing it
was sent is dropped. Anything the agent then does through its profile (any
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
# What claims and due reads take into account: a parked recipient is never due.
ANSWERING = "unanswered_wakes<%d" % PARKED_AFTER
QUIET_LIMIT = 100

WAKE_HEALTH_SCHEMA = [
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_wakes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE recipient_schedule ADD COLUMN unanswered_since_ms INTEGER",
]
WAKE_HEALTH_DOWN = (
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_since_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN unanswered_wakes",
)
WAKE_HEALTH_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM recipient_schedule WHERE unanswered_wakes>0)"


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

    def _wakes_live(self, db, now):
        state = self._runner_state(db)
        return state["state"] == "running" and state["lease_until_ms"] is not None and state["lease_until_ms"] > now

    def _routed_here(self, db, actor):
        """Whether this agent has a route pin in this instance: the agents the runner wakes."""
        binding = {"instance_id": self.instance_id, "actor_id": actor, "db_path": str(self.path),
                   "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]}
        return db.execute("SELECT 1 FROM metadata WHERE key=?", (_pin_key(binding),)).fetchone() is not None

    def _view_wakes(self, db, actor, args):
        """Agents whose wakes are not getting through: parked ones, or every woken agent with work while wakes are not going out."""
        from .delivery import _now_ms
        now = _now_ms()
        live = self._wakes_live(db, now)
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
        return {"instance_id": self.instance_id, "wakes_live": live, "quiet": quiet}

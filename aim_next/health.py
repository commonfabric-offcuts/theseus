from __future__ import annotations

"""The Health page's facts (docs/health.md), from what Core records, in one view.

A wake gets through when its notice reached the agent's chat (accepted), an
earlier notice still waiting leads there (queued), or a hosted turn took its
work (handed). Every other settlement (error, unavailable, busy, or a claim
that expired with its runner) did not get through. Core keeps, per recipient,
when a wake last got through and how many have not since, so the page can say
"every wake since 8:27 PM failed (1,092 times)" with one primary-key read,
however long the failures run. The runner keeps how the run before it ended,
so the page can say what it came back from.

These are derived from settlements, nobody's records: stepping back drops them
and is never refused for them.
"""

import datetime
import json
import os

from .route_pins import KEY_PREFIX as _PIN_PREFIX, _key as _pin_key


REACHED = ("accepted", "queued", "handed")
# Wakes in a row that did not get through before the page says the agent cannot be woken.
FAILING_AFTER = 3
AGENT_LIMIT = 100

_REACHED_SQL = "('accepted','queued','handed')"
_THEIRS = "FROM wake_attempts a JOIN wake_results r ON r.attempt_id=a.id WHERE a.recipient_id=recipient_schedule.recipient_id"
_SINCE = " AND r.outcome NOT IN %s AND r.finished_ms>COALESCE(recipient_schedule.reached_ms,-1)" % _REACHED_SQL

HEALTH_SCHEMA = [
    # When a wake to the recipient last got through, and the wakes since that did not.
    "ALTER TABLE recipient_schedule ADD COLUMN reached_ms INTEGER",
    "ALTER TABLE recipient_schedule ADD COLUMN failed_wakes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE recipient_schedule ADD COLUMN failing_since_ms INTEGER",
    "ALTER TABLE recipient_schedule ADD COLUMN failed_outcome TEXT",
    # How the run before this one ended: its state ('stopped', 'exited',
    # 'paused', 'unrenewed'), its reason and when, kept when a runner takes the role.
    "ALTER TABLE runner_state ADD COLUMN prior_state TEXT",
    "ALTER TABLE runner_state ADD COLUMN prior_reason TEXT",
    "ALTER TABLE runner_state ADD COLUMN prior_ended_ms INTEGER",
]
# The counts are worked out once from the settlements already kept.
HEALTH_BACKFILL = [
    "UPDATE recipient_schedule SET reached_ms=(SELECT max(r.finished_ms) %s AND r.outcome IN %s)" % (_THEIRS, _REACHED_SQL),
    "UPDATE recipient_schedule SET failed_wakes=(SELECT count(*) %s%s),failing_since_ms=(SELECT min(r.finished_ms) %s%s),"
    "failed_outcome=(SELECT r.outcome %s%s ORDER BY r.finished_ms DESC,r.rowid DESC LIMIT 1)" % ((_THEIRS, _SINCE) * 3),
]
HEALTH_DOWN = (
    "ALTER TABLE runner_state DROP COLUMN prior_ended_ms",
    "ALTER TABLE runner_state DROP COLUMN prior_reason",
    "ALTER TABLE runner_state DROP COLUMN prior_state",
    "ALTER TABLE recipient_schedule DROP COLUMN failed_outcome",
    "ALTER TABLE recipient_schedule DROP COLUMN failing_since_ms",
    "ALTER TABLE recipient_schedule DROP COLUMN failed_wakes",
    "ALTER TABLE recipient_schedule DROP COLUMN reached_ms",
)
HEALTH_OCCUPIED = "SELECT 0"


def _iso_ms(text):
    try:
        return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def _release_check(measurements):
    """What the release check measured, as the page says it, or None when it kept no summary."""
    if not isinstance(measurements, dict):
        return None
    check = measurements.get("release_check") or {}
    native = measurements.get("native") or {}
    return {"finished_ms": _iso_ms(check.get("finished_at")), "commit": check.get("commit"),
            "python": (measurements.get("python_units") or {}).get("tests"),
            "node": (measurements.get("node_units") or {}).get("tests"),
            "native": {"pass": native.get("pass"), "total": native.get("total")} if native else None}


def machine_load():
    """The Mac's load averages over 1, 5 and 15 minutes and its processor count, read now."""
    try:
        one, five, fifteen = os.getloadavg()
    except OSError:
        return None
    return {"load": [round(one, 2), round(five, 2), round(fifteen, 2)], "cpus": os.cpu_count()}


class Health:
    def _wake_settled(self, db, recipient, outcome, now):
        """One wake to recipient settled: either it got through, or it adds to the run that has not."""
        if outcome in REACHED:
            db.execute("UPDATE recipient_schedule SET reached_ms=?,failed_wakes=0,failing_since_ms=NULL,failed_outcome=NULL "
                       "WHERE recipient_id=?", (now, recipient))
        else:
            db.execute("UPDATE recipient_schedule SET failed_wakes=failed_wakes+1,failing_since_ms=COALESCE(failing_since_ms,?),"
                       "failed_outcome=? WHERE recipient_id=?", (now, outcome, recipient))

    def _runner_prior(self, state, now):
        """How the run a new acquisition replaces ended: (state, reason, when), or Nones when none ran."""
        if state["state"] in ("stopped", "exited"):
            return state["state"], state["reason_code"], state["ended_ms"]
        if state["state"] == "paused":
            return "paused", state["reason_code"], state["ended_ms"]
        if state["state"] == "running" and state["lease_until_ms"] is not None:
            return "unrenewed", None, min(state["lease_until_ms"], now)
        return None, None, None

    def _view_health(self, db, actor, args):
        """The runner, each agent's waiting work and wakes, the Mac's load and the latest release, read together."""
        from .delivery import _now_ms
        now = _now_ms()
        state = self._runner_state(db)
        runner = dict(self._runner_light(db, now))
        if state["runner_pid"] is not None:
            runner["started_ms"] = state["runner_started_ms"]
        if runner["live"] and state["reason_code"]:
            runner["resumed_because"] = state["reason_code"]
        if state["state"] == "paused" and state["ended_ms"] is not None:
            runner["since_ms"] = state["ended_ms"]
        if state["prior_state"] is not None:
            runner["prior"] = {"state": state["prior_state"], "reason": state["prior_reason"], "ended_ms": state["prior_ended_ms"]}
        # How each agent is woken, from its route pin: this binding's pin first,
        # else one kept from another binding of the same agent (a recovery copy's).
        routes = {}
        for key, value in db.execute("SELECT key,value FROM metadata WHERE key>? AND key<?", (_PIN_PREFIX, _PIN_PREFIX[:-1] + ";")):
            try:
                pin = json.loads(value)
                agent, kind = pin["binding"]["actor_id"], pin["destination"]["kind"]
            except (ValueError, KeyError, TypeError):
                continue
            exact = key == _pin_key({"instance_id": self.instance_id, "actor_id": agent, "db_path": str(self.path),
                                     "authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"]})
            if exact or agent not in routes:
                routes[agent] = {"codex-queue-stdio": "codex_queue", "codex-hosted-stdio": "codex_hosted"}.get(kind, "other")
        agents = []
        rows = db.execute("SELECT a.id,a.name,s.recipient_id IS NOT NULL AS scheduled,s.next_due_ms,s.retry_count,s.reached_ms,s.failed_wakes,"
                          "s.failing_since_ms,s.failed_outcome,s.unanswered_wakes,s.unanswered_since_ms,s.claim_until_ms "
                          "FROM actors a LEFT JOIN recipient_schedule s ON s.recipient_id=a.id "
                          "WHERE a.kind='agent' AND a.enabled=1 ORDER BY a.id LIMIT ?", (AGENT_LIMIT,)).fetchall()
        from .wake_health import PARKED_AFTER
        for row in rows:
            route = routes.get(row["id"])
            # What waits, as the reader may see it: an agent's whispers count only for that agent itself.
            waiting, oldest = db.execute(
                "SELECT count(*),min(m.sent_ms) FROM delivery_groups g INDEXED BY eligible_groups "
                "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                "JOIN messages m ON m.id=d.message_id WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0"
                + ("" if row["id"] == actor else " AND m.private_to IS NULL"), (row["id"],)).fetchone()
            item = {"actor_id": row["id"], "name": row["name"], "route": route, "waiting": waiting, "waiting_since_ms": oldest}
            if row["scheduled"]:
                item.update(next_due_ms=row["next_due_ms"] if waiting else None, reached_ms=row["reached_ms"])
                if row["failed_wakes"] >= FAILING_AFTER:
                    item["failing"] = {"count": row["failed_wakes"], "since_ms": row["failing_since_ms"], "outcome": row["failed_outcome"]}
                if row["unanswered_wakes"] >= PARKED_AFTER and waiting:
                    item["not_answering"] = {"count": row["unanswered_wakes"], "since_ms": row["unanswered_since_ms"]}
                if row["claim_until_ms"] is not None and row["claim_until_ms"] > now:
                    item["waking"] = True
            agents.append(item)
        latest = db.execute("SELECT * FROM releases ORDER BY number DESC LIMIT 1").fetchone()
        release = None
        if latest is not None:
            release = {"release": latest["number"], "commit": latest["commit_sha"], "deployed_ms": latest["deployed_ms"],
                       "items": json.loads(latest["items"]), "source": latest["source"],
                       "check": _release_check(None if latest["measurements"] is None else json.loads(latest["measurements"]))}
        schema = db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]
        return {"instance_id": self.instance_id, "read_ms": now, "runner": runner, "agents": agents,
                "failing_after": FAILING_AFTER, "release": release, "machine": machine_load(), "schema_version": schema}

from __future__ import annotations

"""The Health page's facts (docs/health.md), from what Core records, in one view.

A wake gets through when its notice reached the agent's chat (accepted), an
earlier notice still waiting leads there (queued), or the hosted turn it
started or joined completed with its work seen (completed). Every other
settlement (error, unavailable, busy, a claim that expired with its runner, or
a turn Codex ended failed, lost or interrupted) did not get through. A hosted
wake is settled when its turn ends, from the end Core records, never when the
turn is handed its work: until then nobody knows whether it got through, and a
guess made then would have to be taken back. Core keeps, per recipient,
when a wake last got through, how many have not since, and the runner's own
fixed code for why the latest one did not, so the page can say "every wake
since 8:27 PM failed (1,092 times)" and why, with one primary-key read,
however long the failures run. The runner keeps how the run before it ended,
so the page can say what it came back from.

What is red is one rule (`_health_reds`), read by the page and by the link
that heads every page. Every act that commits ends its transaction with
`_health_commit`, which posts what the team is told, advances the commit, and
then keeps the rule's answer read after every other write, with the number of
that commit (metadata `health_light`, {red, seq}): what it keeps is what the
view says at that commit, by construction, so the server's live feed sends it
with that commit's number and a page never has to guess which read is newer.

What the team is told is a second pure function of the same facts
(`_health_told`): the conditions of the runner and of each agent, never the
traffic around them. The runner is told when it is paused or ended, or once it
has been stopped, or has stopped renewing, for HANDOVER_MS with no runner
taking the role; a runner that has never run here is red on the page while
work waits for it but is never told, since nothing about it changed. An agent
is told while its wakes fail, and while it leaves them unanswered. Each act
posts the difference between what was last told and what is told now, in
words drawn from the facts now. When what is red or told would next change
with no act at all (a lease's end, an absence lasting), Core keeps that moment
(metadata `health_due`), and the server's live feed asks Core to settle then
(`settle_health_due`), never on a timer of its own.

The counts and the runner's previous end are derived from settlements and
exits, nobody's records, kept in tables of their own: stepping back drops them
and is refused only once Theseus has posted a notice.
"""

import datetime
import json
import os
import re
import uuid

from .contract import Refusal
from .route_pins import KEY_PREFIX as _PIN_PREFIX, _key as _pin_key


# Settlements that got through: a notice in the agent's chat, an earlier one
# leading there, or the hosted turn the wake started or joined completing.
THROUGH = ("accepted", "queued", "completed")
# Wakes in a row that did not get through before the page says the agent cannot be woken.
FAILING_AFTER = 3
AGENT_LIMIT = 100
# The member who posts health notices: Theseus itself, never a person or agent
# who did not write them (`_health_author`).
HEALTH_ACTOR = "theseus"
ANNOUNCED_KEY = "health_announced"
# The next moment what is red changes with no act at all, kept by every settling.
DUE_KEY = "health_due"
# What is red, kept by every settling with the commit it is true at: {"red": [...], "seq": N}.
LIGHT_KEY = "health_light"
# How long a runner may be absent with no recorded fault before the team is
# told: as long as the longest lease a runner may hold (runner.py bounds
# lease_ms to 120 s). A deploy's stop is followed by the next runner within
# seconds, so it is never told; a stop that no runner follows (a deploy refused
# after the stop, a runner sent TERM) or a runner that stopped renewing is told
# once it has lasted this long since wakes last went out.
HANDOVER_MS = 120000
REASON = re.compile(r"[A-Za-z0-9_-]{1,64}")

_THROUGH_SQL = "('accepted','queued','completed')"
# Every settlement Core kept, as the rule settles them: a wake's result, except
# a handed one, which settles when its turn ends (`_turn_ended`), as that turn's
# end; a steer the turn never saw did not get through ('unseen').
_SETTLED = ("(SELECT a.recipient_id,r.outcome,r.finished_ms,NULL AS reason,0 AS late FROM wake_attempts a "
            "JOIN wake_results r ON r.attempt_id=a.id WHERE r.outcome<>'handed' UNION ALL "
            "SELECT recipient_id,CASE WHEN final_status='completed' AND mode='steer' AND seen_ms IS NULL THEN 'unseen' "
            "ELSE final_status END,finished_ms,error_code,1 FROM hosted_turns WHERE final_status IS NOT NULL)")
_THEIRS = "FROM %s s WHERE s.recipient_id=wake_facts.recipient_id" % _SETTLED
_SINCE = " AND s.outcome NOT IN %s AND s.finished_ms>COALESCE(wake_facts.reached_ms,-1)" % _THROUGH_SQL
# A start turn not yet ended, which the scheduler counted when it was handed.
_OPEN_STARTS = "(SELECT count(*) FROM hosted_turns t WHERE t.recipient_id=s.recipient_id AND t.final_status IS NULL AND t.mode='start')"

HEALTH_SCHEMA = [
    # Per recipient: when a wake last got through, the wakes since that did
    # not, and the runner's (or Codex's) fixed code for why the latest of them
    # did not; the wakes that got through to it since it last acted, and since
    # when (`_wake_reached`); and when it last recorded a command
    # (`_health_acted`), so a turn that completes knows whether it acted in it.
    "CREATE TABLE wake_facts (recipient_id TEXT PRIMARY KEY REFERENCES actors(id), reached_ms INTEGER, "
    "failed_wakes INTEGER NOT NULL DEFAULT 0, failing_since_ms INTEGER, failed_outcome TEXT, failed_reason TEXT, "
    "unanswered_wakes INTEGER NOT NULL DEFAULT 0, unanswered_since_ms INTEGER, acted_ms INTEGER)",
    # How the run before the current one ended: its state ('stopped', 'exited',
    # 'paused', 'unrenewed'), its reason and when, kept when a runner takes the role.
    "CREATE TABLE runner_prior (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, reason TEXT, ended_ms INTEGER)",
]
# The counts are worked out once from the settlements already kept, by the
# rule's own settling (_SETTLED); why the earlier wakes failed was never
# recorded, so it stays unknown, while a turn's end keeps Codex's code. The
# wakes left unanswered start from the scheduler's own count, the only record
# of them, less a start turn still running, which the rule counts when it
# completes; a count such a turn already lost to the agent's act says it acted
# since that turn began.
HEALTH_BACKFILL = [
    "INSERT INTO wake_facts(recipient_id) SELECT DISTINCT recipient_id FROM wake_attempts",
    "UPDATE wake_facts SET (unanswered_wakes,unanswered_since_ms,acted_ms)=(SELECT max(s.unanswered_wakes-%s,0),"
    "CASE WHEN s.unanswered_wakes>%s THEN s.unanswered_since_ms END,CASE WHEN s.unanswered_wakes<%s THEN "
    "(SELECT max(t.handed_ms) FROM hosted_turns t WHERE t.recipient_id=s.recipient_id AND t.final_status IS NULL AND t.mode='start') END "
    "FROM recipient_schedule s WHERE s.recipient_id=wake_facts.recipient_id) "
    "WHERE recipient_id IN (SELECT recipient_id FROM recipient_schedule)" % ((_OPEN_STARTS,) * 3),
    "UPDATE wake_facts SET reached_ms=(SELECT max(s.finished_ms) %s AND s.outcome IN %s)" % (_THEIRS, _THROUGH_SQL),
    "UPDATE wake_facts SET failed_wakes=(SELECT count(*) %s%s),failing_since_ms=(SELECT min(s.finished_ms) %s%s),"
    "(failed_outcome,failed_reason)=(SELECT s.outcome,s.reason %s%s ORDER BY s.finished_ms DESC,s.late DESC LIMIT 1)" % ((_THEIRS, _SINCE) * 3),
]
HEALTH_DOWN = (
    "DELETE FROM metadata WHERE key IN ('%s','%s','%s')" % (ANNOUNCED_KEY, DUE_KEY, LIGHT_KEY),
    "DELETE FROM actors WHERE id='%s' AND enabled=0" % HEALTH_ACTOR,
    "DROP TABLE runner_prior",
    "DROP TABLE wake_facts",
)
# A notice Theseus posted is on the record, so stepping back is refused once there is one.
HEALTH_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM messages WHERE author_id='%s')" % HEALTH_ACTOR

# Why a wake did not get through, from the runner's fixed codes, in words
# that follow "Why: ". The page and the notices both say these.
WHY = {
    "expired": "the agent runner holding the wake stopped before it finished",
    "broker_exit": "the helper that puts a wake in the Codex app's queue failed (it exited with an error)",
    "deadline": "the Codex app did not answer in time",
    "surviving_descendant": "a process the wake's helper started did not exit",
    "busy": "the agent was busy",
    "missing_route": "it has no route file",
    "route_unavailable": "its route file is missing or not valid",
    "invalid_route": "its route file is not valid",
    "invalid_executable": "the helper program its route names cannot be run",
    "profile_unavailable": "its profile could not be read",
    "invocation_unavailable": "the wake's helper could not be started",
    "exit_observer_unavailable": "the agent runner could not watch the wake's helper",
    "insufficient_lease": "the agent runner did not hold its role long enough to try",
    "binding_mismatch": "the wake did not match the agent's route",
    "guard_mismatch": "the wake did not match the agent runner's role",
    "invalid_claim": "the wake did not match the agent's route",
    "invalid_guard": "the wake did not match the agent runner's role",
    "deliveries_unavailable": "its waiting messages could not be read",
    "nothing_pending": "nothing was waiting by the time it was tried",
    "abandoned": "the wake was given up",
    "child_exited": "the Codex process that hosts its turns exited",
    "not_steerable": "its running Codex turn could not take more work",
    "steer_failed": "Codex refused to add the work to its running turn",
    "start_failed": "Codex refused to start a turn",
    "protocol_error": "Codex answered in a way Theseus does not understand",
}
UNRECORDED_WHY = "Theseus did not record why: these failures began before it did"
# Why a hosted wake did not get through, from how its turn ended; Codex's own
# code for it (codexErrorInfo, "serverOverloaded"), when it gave one, follows
# in words: "its Codex turn failed (server overloaded)".
TURN_WHY = {"failed": "its Codex turn failed", "lost": "its Codex turn was lost", "interrupted": "its Codex turn was interrupted",
            "unseen": "its work was added to a Codex turn that ended before it read it"}
# How the agent runner ended or why it paused, in words: an ended runner's
# phrase follows "The agent runner", a pause's follows "because".
ENDED = {"killed": "was killed", "lease_lost": "lost its lease", "failed": "failed",
         "stopped_unrecorded": "stopped without saying why", "ended": "ended"}
# A runner whose lease ran out with no renewal and no recorded end: hung, or its Mac asleep.
UNRENEWED = "stopped answering (its lease ran out and it did not renew it)"
# A runner absent with no recorded fault, once that has lasted, as told: follows "The agent runner".
ABSENT = {"stopped": "was stopped and no runner has taken its place", "never_run": "has never run here"}
PAUSED = {"operator_pause": "an operator paused it", "cleanup_failed": "it could not confirm a helper process it started was gone",
          "route_binding_changed": "a route changed", "storage_failure": "of a storage fault"}
ROUTE_KINDS = {"codex-queue-stdio": "codex_queue", "codex-hosted-stdio": "codex_hosted"}


def why_words(reason, outcome=None):
    """Why a wake did not get through, in words, from the runner's fixed code, or from how its turn ended and Codex's code."""
    if outcome in TURN_WHY:
        return TURN_WHY[outcome] + ("" if reason is None else " (%s)" % _spaced(reason))
    if reason is None:
        return "the agent was busy" if outcome == "busy" else UNRECORDED_WHY
    if reason in WHY:
        return WHY[reason]
    if reason.startswith("thread_"):
        return "its Codex thread is %s" % _spaced(reason[len("thread_"):])
    return "the agent runner said %s" % reason


def _spaced(code):
    """A fixed code in words: "serverOverloaded" or "server_overloaded" as "server overloaded"."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", code).lower().replace("_", " ")


def runner_why(light):
    """The runner's reason in words, for its state: an ended runner's verb, or a pause's cause."""
    if light.get("state") == "exited":
        return ENDED.get(light.get("reason"), "ended")
    if light.get("state") == "paused":
        return PAUSED.get(light.get("reason"), "of %s" % (light.get("reason") or "a reason it did not record"))
    if light.get("state") == "unrenewed":
        return UNRENEWED
    return None


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
    """The Mac's load averages over 1, 5 and 15 minutes and its processor count, read now.

    Either that could not be read is None in its place, never left out, so the
    page and the command line say it could not be read rather than nothing."""
    try:
        one, five, fifteen = os.getloadavg()
        load = [round(one, 2), round(five, 2), round(fifteen, 2)]
    except OSError:
        load = None
    return {"load": load, "cpus": os.cpu_count()}


def overloaded(machine):
    """Whether the Mac's 1-minute load is above its core count; never when either could not be read."""
    return bool(machine and machine.get("load") and machine.get("cpus") and machine["load"][0] > machine["cpus"])


def _names(names):
    names = list(names)
    return names[0] if len(names) == 1 else "%s and %s" % (", ".join(names[:-1]), names[-1])


def _count(number, one, many):
    return "%s %s" % ("{:,}".format(number), one if number == 1 else many)


def notice_lines(went_red, went_green, still_red):
    """What one notice says, as sentences with no clock time in them: what is told now that was
    not, then what was told and is not any more.

    went_red and still_red map a told key to its fact, as `_health_told` gives
    it; went_green maps a key told before to the facts now (`_health_cleared`),
    so a clear says what changed in fact."""
    lines = []
    runner = went_red.get("runner")
    if runner is not None:
        if runner["state"] == "paused":
            lines.append("The agent runner was paused because %s, so no wakes are going out." % runner_why(runner))
        else:
            lines.append("The agent runner %s, so no wakes are going out." % (runner_why(runner) or ABSENT[runner["state"]]))
    failing = [fact for key, fact in sorted(went_red.items()) if key.startswith("failing:")]
    # Agents that went red together for one reason are said together.
    groups = {}
    for fact in failing:
        groups.setdefault((fact["reason"], fact["outcome"]), []).append(fact)
    for (reason, outcome), facts in sorted(groups.items(), key=lambda pair: pair[1][0]["actor_id"]):
        names = [fact["actor_id"] for fact in facts]
        many = len(names) > 1
        before = sorted(fact["actor_id"] for key, fact in still_red.items()
                        if key.startswith("failing:") and key not in went_red and (fact["reason"], fact["outcome"]) == (reason, outcome))
        counts = sorted({fact["count"] for fact in facts})
        tried = "their last %s each" % _count(counts[0], "wake", "wakes") if many and len(counts) == 1 else (
            "their last wakes" if many else "its last %s" % _count(counts[0], "wake", "wakes"))
        line = "%s can't be woken: %s did not get through. Why: %s." % (_names(names), tried, why_words(reason, outcome))
        if before:
            line += " %s %s already red for the same reason, so the cause is something they share." % (_names(before), "is" if len(before) == 1 else "are")
        if all(fact["route"] == "codex_queue" for fact in facts):
            line += " %s through the Codex app's queue, so look there first: is the ChatGPT app open?" % (
                "Their wakes go" if many else "Its wakes go")
        lines.append(line)
    for key, fact in sorted(went_red.items()):
        if key.startswith("parked:"):
            waits = "; %s" % _count(fact["waiting"], "message waits for it", "messages wait for it") if fact["waiting"] else ""
            lines.append("%s has not answered its last %s%s." % (fact["actor_id"], _count(fact["count"], "wake", "wakes"), waits))
    runner = went_green.get("runner")
    if runner is not None:
        # Told only once it had run and stopped, so a runner back is running again.
        lines.append("The agent runner is running again, so wakes are going out." if runner["live"] else
                     "The agent runner is still not sending wakes; the Health page says why.")
    for key, fact in sorted(went_green.items()):
        if key == "runner":
            continue
        if not fact["enabled"]:
            lines.append("%s was disabled, so it is no longer woken." % fact["actor_id"])
        elif key.startswith("failing:"):
            lines.append("%s can be woken again: a wake got through." % fact["actor_id"])
        else:
            lines.append("%s is answering again." % fact["actor_id"])
    return lines


class Health:
    def _wake_settled(self, db, recipient, outcome, now, reason=None):
        """One wake to recipient settled: either it got through, or it adds to the run that has not, with why."""
        db.execute("INSERT OR IGNORE INTO wake_facts(recipient_id) VALUES (?)", (recipient,))
        if outcome in THROUGH:
            db.execute("UPDATE wake_facts SET reached_ms=?,failed_wakes=0,failing_since_ms=NULL,failed_outcome=NULL,failed_reason=NULL "
                       "WHERE recipient_id=?", (now, recipient))
        else:
            db.execute("UPDATE wake_facts SET failed_wakes=failed_wakes+1,failing_since_ms=COALESCE(failing_since_ms,?),"
                       "failed_outcome=?,failed_reason=? WHERE recipient_id=?", (now, outcome, reason, recipient))

    def _wake_reached(self, db, recipient, since):
        """A wake got through to recipient at since and it has not acted since: one more it has left
        unanswered, until it acts. Only this and the recipient's own acts move the count.

        Called with a fact that is final when it is recorded: a notice accepted
        into its chat, or a turn the wake started that completed without the
        agent acting in it (`_turn_ended`). The scheduler keeps a count of its
        own (`recipient_schedule.unanswered_wakes`) for when to stop waking the
        agent, which it moves for its own reasons; the page never says what the
        scheduler will do from this one."""
        db.execute("INSERT OR IGNORE INTO wake_facts(recipient_id) VALUES (?)", (recipient,))
        db.execute("UPDATE wake_facts SET unanswered_wakes=unanswered_wakes+1,unanswered_since_ms=COALESCE(unanswered_since_ms,?) "
                   "WHERE recipient_id=?", (since, recipient))

    def _turn_ended(self, db, recipient, outcome, now, error_code, started_ms):
        """A hosted turn ended, and with it one wake to recipient that it was handed: outcome is the
        turn's end ("completed", "failed", "lost", "interrupted"), or "unseen" for a steer it never
        read; error_code is Codex's; started_ms is when the turn was handed this wake's work, for a
        turn the wake started (None for a steer, which joins a turn already counted).

        A completed turn the wake started reached the agent, and is unanswered
        if the agent recorded nothing since it began; any other end did not
        get through, with Codex's code as why."""
        self._wake_settled(db, recipient, outcome, now, error_code)
        if outcome == "completed" and started_ms is not None:
            acted = db.execute("SELECT acted_ms FROM wake_facts WHERE recipient_id=?", (recipient,)).fetchone()[0]
            if acted is None or acted < started_ms:
                self._wake_reached(db, recipient, started_ms)

    def _health_acted(self, db, actor, now):
        """The actor recorded a command: every wake that reached it is answered, and a turn running now was acted in."""
        db.execute("INSERT INTO wake_facts(recipient_id,acted_ms) VALUES (?,?) ON CONFLICT(recipient_id) DO UPDATE "
                   "SET unanswered_wakes=0,unanswered_since_ms=NULL,acted_ms=excluded.acted_ms", (actor, now))

    def _runner_took_role(self, db, now):
        """A runner takes the role: keep how the run it replaces ended, before the state row says running."""
        prior = self._runner_prior(self._runner_state(db), now)
        if prior[0] is not None:
            db.execute("INSERT INTO runner_prior VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,"
                       "reason=excluded.reason,ended_ms=excluded.ended_ms", prior)

    def _runner_prior(self, state, now):
        """How the run a new acquisition replaces ended: (state, reason, when), or Nones when none ran."""
        if state["state"] in ("stopped", "exited"):
            return state["state"], state["reason_code"], state["ended_ms"]
        if state["state"] == "paused":
            return "paused", state["reason_code"], state["ended_ms"]
        if state["state"] == "running" and state["lease_until_ms"] is not None:
            return "unrenewed", None, min(state["lease_until_ms"], now)
        return None, None, None

    def _health_routes(self, db):
        """How each agent is woken, from its route pin: this binding's pin first, else
        one kept from another binding of the same agent (a recovery copy's)."""
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
                routes[agent] = ROUTE_KINDS.get(kind, "other")
        return routes

    @staticmethod
    def _on_record_waiting(db, agent):
        """Pending deliveries on the record for agent, in live groups, and the oldest one's send time."""
        return tuple(db.execute(
            "SELECT count(*),min(m.sent_ms) FROM delivery_groups g INDEXED BY eligible_groups "
            "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
            "JOIN messages m ON m.id=d.message_id WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 AND m.private_to IS NULL",
            (agent,)).fetchone())

    def _health_reds(self, db, now, routes=None):
        """What is red, from Core's facts alone, as {key: fact}: one rule for the page and its link.

        "runner" while no runner sends wakes: it paused or ended (a fault Core
        records), was stopped (a deploy's graceful stop, until a runner takes
        the role again), stopped renewing without saying so, or never ran here
        while a woken agent has work on the record. "failing:<agent>" once
        FAILING_AFTER wakes in a row did not get through. "parked:<agent>"
        while it has left PARKED_AFTER wakes unanswered and work on the record
        waits for it. The runner's fact says from when it is told (`tell_ms`,
        `posted`): a pause or an exit at once; a stop, or a lease that ran out
        unrenewed, once HANDOVER_MS has passed since wakes last went out with
        no runner taking the role, so a deploy's stop and start tell nothing;
        a runner that never ran, never (`_health_told`). The Mac's load is read
        by the page, not recorded, so it is never here."""
        from .wake_health import PARKED_AFTER
        routes = self._health_routes(db) if routes is None else routes
        reds = {}
        light = dict(self._runner_light(db, now))
        if not light["live"]:
            red, tell = True, now  # a recorded fault is told at once
            if light["state"] in ("stopped", "unrenewed"):
                since = light.get("since_ms")
                tell = now if since is None else since + HANDOVER_MS
            elif light["state"] == "never_run":
                # Red only while a woken agent has work on the record; never told.
                red = any(self._on_record_waiting(db, agent)[0] for agent in sorted(routes))
                tell = None
            if red:
                light.update(kind="runner", posted=tell is not None and tell <= now, tell_ms=tell, why=runner_why(light))
                reds["runner"] = light
        rows = db.execute("SELECT a.id AS recipient_id,COALESCE(f.failed_wakes,0) AS failed_wakes,f.failing_since_ms,f.failed_outcome,f.failed_reason,"
                          "f.unanswered_wakes,f.unanswered_since_ms FROM actors a JOIN wake_facts f ON f.recipient_id=a.id "
                          "WHERE a.kind='agent' AND a.enabled=1 AND (f.failed_wakes>=? OR f.unanswered_wakes>=?) ORDER BY a.id LIMIT ?",
                          (FAILING_AFTER, PARKED_AFTER, AGENT_LIMIT)).fetchall()
        for row in rows:
            agent = row["recipient_id"]
            if row["failed_wakes"] >= FAILING_AFTER:
                reds["failing:" + agent] = self._failing_fact(row, routes)
            if row["unanswered_wakes"] >= PARKED_AFTER:
                fact = self._parked_fact(db, row)
                if fact["waiting"]:
                    reds["parked:" + agent] = fact
        return reds

    @staticmethod
    def _failing_fact(row, routes):
        agent = row["recipient_id"]
        return {"kind": "failing", "posted": True, "actor_id": agent, "count": row["failed_wakes"],
                "since_ms": row["failing_since_ms"], "outcome": row["failed_outcome"], "reason": row["failed_reason"],
                "why": why_words(row["failed_reason"], row["failed_outcome"]), "route": routes.get(agent)}

    def _parked_fact(self, db, row):
        waiting, oldest = self._on_record_waiting(db, row["recipient_id"])
        since = row["unanswered_since_ms"]
        return {"kind": "parked", "posted": True, "actor_id": row["recipient_id"], "count": row["unanswered_wakes"],
                "since_ms": max(since, oldest) if since is not None and oldest is not None else since, "waiting": waiting}

    def _health_told(self, db, now, reds):
        """What the team is told now, as {key: fact}: a pure function of Core's facts and now, never of what was told before.

        The conditions of the runner and of each agent, not the traffic
        around them: the runner while its red is posted (a runner that never
        ran is not: nothing about it changed, and only the work that comes and
        goes would move it); an agent while its wakes fail; an agent while it
        leaves its wakes unanswered, whether or not work waits for it at the
        moment, so work answered for it or taken away and then given again
        tells nothing new. "Unanswered" is Health's own count (`_wake_reached`),
        never the scheduler's, which moves for reasons that are not the agent's."""
        from .wake_health import PARKED_AFTER
        told = {key: fact for key, fact in reds.items() if fact["posted"] and not key.startswith("parked:")}
        for row in db.execute("SELECT f.recipient_id,f.unanswered_wakes,f.unanswered_since_ms FROM wake_facts f "
                              "JOIN actors a ON a.id=f.recipient_id WHERE a.kind='agent' AND a.enabled=1 AND f.unanswered_wakes>=? "
                              "ORDER BY f.recipient_id LIMIT ?", (PARKED_AFTER, AGENT_LIMIT)).fetchall():
            told["parked:" + row["recipient_id"]] = reds.get("parked:" + row["recipient_id"]) or self._parked_fact(db, row)
        return told

    def _health_cleared(self, db, key, now):
        """The facts now about a key that was told and is not any more, for the words that say what changed."""
        if key == "runner":
            return dict(self._runner_light(db, now))
        agent = key.split(":", 1)[1]
        row = db.execute("SELECT enabled FROM actors WHERE id=? AND kind='agent'", (agent,)).fetchone()
        return {"actor_id": agent, "enabled": bool(row is not None and row[0])}

    def _health_commit(self, db, now, always=True):
        """The last step of every act's transaction: post what the team is told now and was not, then
        advance the commit and keep what is red at it, read after every other write.

        Called by every act that commits: each command, each runner act, each
        recorded runner exit, each operator write and the server's settling at
        Core's kept moment, in the act's own transaction, so a notice says what
        that act changed and is posted exactly when it is. The notices are the
        transaction's own last writes, and one can be work that lights a red (a
        notice is work for a coordinator it is not about), so what is red is
        read once they are posted, and kept with the number this advances the
        commit to: the light a commit carries is the rule's answer at that
        commit, the same the views give, by construction.

        With always False (the server's settling) it commits only when what is
        red, the moment kept for it, or what is told changed, and returns
        whether it advanced the commit."""
        routes = self._health_routes(db)
        every = self._health_reds(db, now, routes)
        posted = self._health_tell(db, now, routes, every)
        if posted:
            every = self._health_reds(db, now, routes)
        red, due = sorted(every), self._health_due(db, now, every)
        kept = dict(db.execute("SELECT key,value FROM metadata WHERE key IN (?,?)", (LIGHT_KEY, DUE_KEY)))
        try:
            light_changed = json.loads(kept[LIGHT_KEY])["red"] != red
        except (KeyError, ValueError, TypeError):
            light_changed = True
        due_changed = kept.get(DUE_KEY) != (None if due is None else str(due))
        if not (always or posted or light_changed or due_changed):
            return False
        self._advance_commit_seq(db)
        seq = int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])
        db.execute("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (LIGHT_KEY, json.dumps({"red": red, "seq": seq}, separators=(",", ":"))))
        if due is None:
            db.execute("DELETE FROM metadata WHERE key=?", (DUE_KEY,))
        else:
            db.execute("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (DUE_KEY, str(due)))
        return True

    def _health_tell(self, db, now, routes, every):
        """When what is told changed, keep it and post one notice per outcome concerned; returns
        whether it wrote. What was last told is kept in metadata only to post the difference: it is
        always what `_health_told` gave at the last settling."""
        told = self._health_told(db, now, every)
        row = db.execute("SELECT value FROM metadata WHERE key=?", (ANNOUNCED_KEY,)).fetchone()
        try:
            announced = json.loads(row[0]) if row is not None else {}
            announced = announced if isinstance(announced, dict) else {}
        except ValueError:
            announced = {}
        if set(told) == set(announced):
            return False
        went_red = {key: fact for key, fact in told.items() if key not in announced}
        went_green = {key: self._health_cleared(db, key, now) for key in announced if key not in told}
        db.execute("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (ANNOUNCED_KEY, json.dumps({key: {"actor_id": fact.get("actor_id")} for key, fact in told.items()},
                                              sort_keys=True, separators=(",", ":"))))
        # Who each change concerns: an agent's change, that agent; the runner's, every agent it wakes.
        concerned = {}
        for key in set(went_red) | set(went_green):
            agents = sorted(routes) if key == "runner" else [key.split(":", 1)[1]]
            for agent in agents:
                concerned.setdefault(agent, set()).add(key)
        if not concerned:
            return True
        marks = ",".join("?" * len(concerned))
        outcomes, about = {}, {}
        for workspace_id, agent in db.execute(
                "SELECT workspace_id,actor_id FROM workspace_members WHERE actor_id IN (%s) "
                "UNION SELECT id,coordinator_id FROM workspaces WHERE coordinator_id IN (%s) ORDER BY 1,2" % (marks, marks),
                list(concerned) * 2):
            outcomes.setdefault(workspace_id, set()).update(concerned[agent])
            about.setdefault(workspace_id, set()).add(agent)
        for workspace_id in sorted(outcomes):
            keys = outcomes[workspace_id]
            conversation = self._conversation_of(db, workspace_id)
            if conversation is None:
                continue
            lines = notice_lines({key: went_red[key] for key in keys if key in went_red},
                                 {key: went_green[key] for key in keys if key in went_green}, told)
            body = "Health: %s\n\nThe Health page, under the instance name, says more; agents can run aim-next health." % " ".join(lines)
            if not self._health_author(db):
                return True
            # The people in it see the link light; only an agent the notice is not about gets it as work.
            people = {row[0] for row in db.execute("SELECT p.actor_id FROM topic_participants p JOIN actors a ON a.id=p.actor_id "
                                                   "WHERE p.topic_id=? AND p.active=1 AND a.kind='human'", (conversation["id"],))}
            db.execute("SAVEPOINT health_notice")
            try:
                self._publish(db, HEALTH_ACTOR, "health-" + uuid.uuid4().hex, conversation["id"],
                              {"body": body, "attachments": [], "quotes": [], "addressees": []}, topic=conversation,
                              settled_for=about[workspace_id] | people)
            except Refusal:
                # A notice that cannot be posted there (its conversation is full,
                # say) leaves the act it reports alone; the page still says it.
                db.execute("ROLLBACK TO health_notice")
            db.execute("RELEASE health_notice")
        return True

    def _health_due(self, db, now, reds):
        """The next moment what is red, or what is told, changes with no act at all, or None.

        The running runner's lease's end (it is red once that passes
        unrenewed), and when a runner's absence will have lasted long enough
        to be told."""
        state = self._runner_state(db)
        moments = []
        if state["state"] == "running" and state["lease_until_ms"] is not None and state["lease_until_ms"] > now:
            moments.append(state["lease_until_ms"])
        runner = reds.get("runner")
        if runner is not None and not runner["posted"] and runner["tell_ms"] is not None:
            moments.append(runner["tell_ms"])
        return min(moments) if moments else None

    @staticmethod
    def _health_author(db):
        """Theseus's own member, registered with its first notice: disabled, so it is never on a
        team, in a list of people, or woken. A member someone registered under that name is
        not Theseus, and notices are never posted as them."""
        row = db.execute("SELECT kind,name,enabled FROM actors WHERE id=?", (HEALTH_ACTOR,)).fetchone()
        if row is None:
            db.execute("INSERT INTO actors(id,kind,name,enabled) VALUES (?,'agent','Theseus',0)", (HEALTH_ACTOR,))
            return True
        return tuple(row) == ("agent", "Theseus", 0)

    def _view_health_light(self, db, actor, args):
        """What is red, by key, for the link that heads every page: one read of the rule the page uses."""
        from .delivery import _now_ms
        return {"instance_id": self.instance_id, "red": sorted(self._health_reds(db, _now_ms())), "commit_seq": self._commit_seq(db)}

    @staticmethod
    def _commit_seq(db):
        """The commit this read's answer is true at: a view reads in one transaction."""
        return int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])

    def _view_health(self, db, actor, args):
        """The runner, each agent's waiting work and wakes, the Mac's load and the latest release, read together."""
        from .delivery import _now_ms
        now = _now_ms()
        state = self._runner_state(db)
        routes = self._health_routes(db)
        reds = self._health_reds(db, now, routes)
        runner = dict(self._runner_light(db, now))
        why = runner_why(runner)
        if why is not None:
            runner["why"] = why
        if state["runner_pid"] is not None:
            runner["started_ms"] = state["runner_started_ms"]
        if runner["live"] and state["reason_code"]:
            runner["resumed_because"] = state["reason_code"]
        if state["state"] == "paused" and state["ended_ms"] is not None:
            runner["since_ms"] = state["ended_ms"]
        prior = db.execute("SELECT state,reason,ended_ms FROM runner_prior WHERE id=1").fetchone()
        if prior is not None:
            runner["prior"] = {"state": prior["state"], "reason": prior["reason"], "ended_ms": prior["ended_ms"],
                               "why": runner_why({"state": prior["state"], "reason": prior["reason"]})}
        agents = []
        rows = db.execute("SELECT a.id,a.name,s.recipient_id IS NOT NULL AS scheduled,s.next_due_ms,f.reached_ms,s.claim_until_ms "
                          "FROM actors a LEFT JOIN recipient_schedule s ON s.recipient_id=a.id LEFT JOIN wake_facts f ON f.recipient_id=a.id "
                          "WHERE a.kind='agent' AND a.enabled=1 ORDER BY a.id LIMIT ?", (AGENT_LIMIT,)).fetchall()
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
                failing, parked = reds.get("failing:" + row["id"]), reds.get("parked:" + row["id"])
                if failing is not None:
                    item["failing"] = {key: failing[key] for key in ("count", "since_ms", "outcome", "reason", "why")}
                if parked is not None:
                    item["not_answering"] = {"count": parked["count"], "since_ms": parked["since_ms"]}
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
        return {"instance_id": self.instance_id, "read_ms": now, "commit_seq": self._commit_seq(db), "red": sorted(reds), "runner": runner, "agents": agents,
                "failing_after": FAILING_AFTER, "release": release, "machine": machine_load(), "schema_version": schema}


def report_lines(answer, at):
    """The health view as an agent reads it on the command line (`aim-next health`): what
    needs attention, then one line each, in the page's words, with at(ms) for each time."""
    when = lambda ms, word="since": " %s %s" % (word, at(ms)) if isinstance(ms, int) else ""
    red = set(answer.get("red") or ())
    runner = answer["runner"]
    if runner["live"]:
        runner_words = "running" + when(runner.get("started_ms"))
    elif runner["state"] == "paused":
        runner_words = "paused%s because %s" % (when(runner.get("since_ms")), runner.get("why") or "of a reason it did not record")
    elif runner["state"] == "stopped":
        runner_words = "stopped%s" % when(runner.get("since_ms"), "at")
    elif runner["state"] == "exited":
        runner_words = "%s%s" % (runner.get("why") or "ended", when(runner.get("since_ms"), "at"))
    elif runner["state"] == "unrenewed":
        runner_words = "stopped answering%s" % when(runner.get("since_ms"), "at")
    else:
        runner_words = "never run here"
    problems = []
    if "runner" in red:
        problems.append("The agent runner is %s, so no wakes are going out." % runner_words)
    for agent in answer.get("agents") or ():
        failing, parked = agent.get("failing"), agent.get("not_answering")
        if failing:
            since = when(failing.get("since_ms"))
            line = "%s can't be woken: %s. Why: %s." % (agent["actor_id"], (
                "every wake%s failed (%s)" % (since, _count(failing["count"], "time", "times")) if failing["outcome"] == "error"
                else "no wake%s has got through (%s)" % (since, _count(failing["count"], "wake", "wakes"))), failing["why"])
            if agent.get("waiting"):
                line += " %s." % _count(agent["waiting"], "message waits for it", "messages wait for it")
            if agent.get("route") == "codex_queue":
                line += " Its wakes go through the Codex app's queue, so look there first: is the ChatGPT app open?"
            problems.append(line)
        elif parked:
            problems.append("%s has not answered its last %s%s; %s." % (
                agent["actor_id"], _count(parked["count"], "wake", "wakes"), when(parked.get("since_ms")),
                _count(agent.get("waiting") or 0, "message waits for it", "messages wait for it")))
    machine = answer.get("machine")
    if overloaded(machine):
        problems.append("The Mac is overloaded: its load is %s on %d cores, so everything here may be slow." % (machine["load"][0], machine["cpus"]))
    lines = ["Needs attention:"] + ["  - " + line for line in problems] if problems else [
        "Everything is working: the agent runner is sending wakes and they are getting through."]
    lines.append("Agent runner: " + runner_words)
    server = answer.get("server")
    if server:
        lines.append("Server: answering%s, %s" % (when(server.get("started_ms")), "live updates on" if server.get("live_feed") else "no live updates"))
    lines.append("Agents:")
    width = max([len(agent["actor_id"]) for agent in answer.get("agents") or ()] or [0])
    for agent in answer.get("agents") or ():
        state = ("can't be woken" if agent.get("failing") else "not answering" if agent.get("not_answering") else
                 "being woken now" if agent.get("waking") else "not woken here" if not agent.get("route") else
                 "wakes going out" if agent.get("waiting") else "all caught up")
        waiting = "%d waiting%s" % (agent["waiting"], when(agent.get("waiting_since_ms"))) if agent.get("waiting") else "nothing waiting"
        reached = " · a wake last got through%s" % when(agent.get("reached_ms"), "at") if isinstance(agent.get("reached_ms"), int) else ""
        lines.append("  %s  %s · %s%s" % (agent["actor_id"].ljust(width), state, waiting, reached))
    if machine:
        cores = "%s cores" % machine["cpus"] if machine.get("cpus") else "a core count that could not be read"
        lines.append("This Mac: load %s on %s (1, 5 and 15 minutes: %s)" % (
            machine["load"][0], cores, ", ".join(str(value) for value in machine["load"])) if machine.get("load")
            else "This Mac: its load could not be read (%s)" % cores)
    release = answer.get("release")
    lines.append("Latest release: %d, live%s, shipped %s" % (
        release["release"], when(release.get("deployed_ms")), ", ".join(str(item) for item in release["items"]) or "no pipeline item")
        if release else "Latest release: none recorded")
    lines.append("Database version %s; read%s." % (answer.get("schema_version"), when(answer.get("read_ms"), "at")))
    return lines

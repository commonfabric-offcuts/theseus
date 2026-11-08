from __future__ import annotations

"""The Health page's facts (docs/health.md), from what Core records, in one view.

A wake gets through when its notice reached the agent's chat (accepted), an
earlier notice still waiting leads there (queued), or a hosted turn took its
work (handed). Every other settlement (error, unavailable, busy, or a claim
that expired with its runner) did not get through. Core keeps, per recipient,
when a wake last got through, how many have not since, and the runner's own
fixed code for why the latest one did not, so the page can say "every wake
since 8:27 PM failed (1,092 times)" and why, with one primary-key read,
however long the failures run. The runner keeps how the run before it ended,
so the page can say what it came back from.

What is red is one rule (`_health_reds`), read by the page, by the link that
heads every page, and by the notices: when what is red changes, Theseus itself
posts one notice to each outcome the change concerns, in the act that changed
it (`_health_settle`), never on a timer.

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


REACHED = ("accepted", "queued", "handed")
# Wakes in a row that did not get through before the page says the agent cannot be woken.
FAILING_AFTER = 3
AGENT_LIMIT = 100
# The member who posts health notices: Theseus itself, never a person or agent
# who did not write them (`_health_author`).
HEALTH_ACTOR = "theseus"
ANNOUNCED_KEY = "health_announced"
REASON = re.compile(r"[A-Za-z0-9_-]{1,64}")

_REACHED_SQL = "('accepted','queued','handed')"
_THEIRS = "FROM wake_attempts a JOIN wake_results r ON r.attempt_id=a.id WHERE a.recipient_id=wake_facts.recipient_id"
_SINCE = " AND r.outcome NOT IN %s AND r.finished_ms>COALESCE(wake_facts.reached_ms,-1)" % _REACHED_SQL

HEALTH_SCHEMA = [
    # Per recipient: when a wake last got through, the wakes since that did
    # not, and the runner's fixed code for why the latest of them did not.
    "CREATE TABLE wake_facts (recipient_id TEXT PRIMARY KEY REFERENCES actors(id), reached_ms INTEGER, "
    "failed_wakes INTEGER NOT NULL DEFAULT 0, failing_since_ms INTEGER, failed_outcome TEXT, failed_reason TEXT)",
    # How the run before the current one ended: its state ('stopped', 'exited',
    # 'paused', 'unrenewed'), its reason and when, kept when a runner takes the role.
    "CREATE TABLE runner_prior (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, reason TEXT, ended_ms INTEGER)",
]
# The counts are worked out once from the settlements already kept; why the
# earlier ones failed was never recorded, so it stays unknown.
HEALTH_BACKFILL = [
    "INSERT INTO wake_facts(recipient_id) SELECT DISTINCT recipient_id FROM wake_attempts",
    "UPDATE wake_facts SET reached_ms=(SELECT max(r.finished_ms) %s AND r.outcome IN %s)" % (_THEIRS, _REACHED_SQL),
    "UPDATE wake_facts SET failed_wakes=(SELECT count(*) %s%s),failing_since_ms=(SELECT min(r.finished_ms) %s%s),"
    "failed_outcome=(SELECT r.outcome %s%s ORDER BY r.finished_ms DESC,r.rowid DESC LIMIT 1)" % ((_THEIRS, _SINCE) * 3),
]
HEALTH_DOWN = (
    "DELETE FROM metadata WHERE key='%s'" % ANNOUNCED_KEY,
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
# How the agent runner ended or why it paused, in words: an ended runner's
# phrase follows "The agent runner", a pause's follows "because".
ENDED = {"killed": "was killed", "lease_lost": "lost its lease", "failed": "failed",
         "stopped_unrecorded": "stopped without saying why", "ended": "ended"}
PAUSED = {"operator_pause": "an operator paused it", "cleanup_failed": "it could not confirm a helper process it started was gone",
          "route_binding_changed": "a route changed", "storage_failure": "of a storage fault"}
ROUTE_KINDS = {"codex-queue-stdio": "codex_queue", "codex-hosted-stdio": "codex_hosted"}


def why_words(reason, outcome=None):
    """Why a wake did not get through, in words, from the runner's fixed code."""
    if reason is None:
        return "the agent was busy" if outcome == "busy" else UNRECORDED_WHY
    if reason in WHY:
        return WHY[reason]
    if reason.startswith("thread_"):
        status = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", reason[len("thread_"):]).lower().replace("_", " ")
        return "its Codex thread is %s" % status
    return "the agent runner said %s" % reason


def runner_why(light):
    """The runner's reason in words, for its state: an ended runner's verb, or a pause's cause."""
    if light.get("state") == "exited":
        return ENDED.get(light.get("reason"), "ended")
    if light.get("state") == "paused":
        return PAUSED.get(light.get("reason"), "of %s" % (light.get("reason") or "a reason it did not record"))
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
    """The Mac's load averages over 1, 5 and 15 minutes and its processor count, read now."""
    try:
        one, five, fifteen = os.getloadavg()
    except OSError:
        return None
    return {"load": [round(one, 2), round(five, 2), round(fifteen, 2)], "cpus": os.cpu_count()}


def _names(names):
    names = list(names)
    return names[0] if len(names) == 1 else "%s and %s" % (", ".join(names[:-1]), names[-1])


def _count(number, one, many):
    return "%s %s" % ("{:,}".format(number), one if number == 1 else many)


def notice_lines(went_red, went_green, still_red):
    """What one notice says, as sentences with no clock time in them: what went red, then what went green.

    Each argument maps a red key to its fact, as `_health_reds` gives it."""
    lines = []
    runner = went_red.get("runner")
    if runner is not None:
        if runner["state"] == "paused":
            lines.append("The agent runner was paused because %s, so no wakes are going out." % runner_why(runner))
        else:
            lines.append("The agent runner %s, so no wakes are going out." % runner_why(runner))
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
            lines.append("%s has not answered its last %s; %s." % (
                fact["actor_id"], _count(fact["count"], "wake", "wakes"), _count(fact["waiting"], "message waits for it", "messages wait for it")))
    if "runner" in went_green:
        lines.append("The agent runner is running again, so wakes are going out.")
    for key, fact in sorted(went_green.items()):
        if key.startswith("failing:"):
            lines.append("%s can be woken again: a wake got through." % fact["actor_id"])
        elif key.startswith("parked:"):
            lines.append(("%s is answering again." if fact.get("answering") else "Nothing waits for %s any more.") % fact["actor_id"])
    return lines


class Health:
    def _wake_settled(self, db, recipient, outcome, now, reason=None):
        """One wake to recipient settled: either it got through, or it adds to the run that has not, with why."""
        db.execute("INSERT OR IGNORE INTO wake_facts(recipient_id) VALUES (?)", (recipient,))
        if outcome in REACHED:
            db.execute("UPDATE wake_facts SET reached_ms=?,failed_wakes=0,failing_since_ms=NULL,failed_outcome=NULL,failed_reason=NULL "
                       "WHERE recipient_id=?", (now, recipient))
        else:
            db.execute("UPDATE wake_facts SET failed_wakes=failed_wakes+1,failing_since_ms=COALESCE(failing_since_ms,?),"
                       "failed_outcome=?,failed_reason=? WHERE recipient_id=?", (now, outcome, reason, recipient))

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
        """What is red, from Core's facts alone, as {key: fact}: one rule for the page, its link and the notices.

        "runner" while no runner sends wakes: it paused or ended (a fault Core
        records), was stopped (a deploy's graceful stop, until a runner takes
        the role again), stopped renewing without saying so, or never ran here
        while a woken agent has work on the record. "failing:<agent>" once
        FAILING_AFTER wakes in a row did not get through. "parked:<agent>"
        while it has left PARKED_AFTER wakes unanswered and work on the record
        waits for it. A fact is `posted` to the team when it is a fault an act
        records: a pause, an exit, failing wakes, a parked agent; a graceful
        stop is deliberate, and a runner that stopped renewing is known gone
        only by the clock. The Mac's load is read by the page, not recorded,
        so it is never here."""
        from .wake_health import PARKED_AFTER
        routes = self._health_routes(db) if routes is None else routes
        reds = {}
        light = dict(self._runner_light(db, now))
        if not light["live"]:
            # A pause or an exit is a fault Core records; a graceful stop (a
            # deploy's) is red on the page while it lasts, and is never posted.
            posted = light["state"] in ("paused", "exited")
            if posted or light["state"] in ("stopped", "unrenewed") or any(
                    self._on_record_waiting(db, agent)[0] for agent in sorted(routes)):
                light.update(kind="runner", posted=posted, why=runner_why(light))
                reds["runner"] = light
        rows = db.execute("SELECT a.id AS recipient_id,COALESCE(f.failed_wakes,0) AS failed_wakes,f.failing_since_ms,f.failed_outcome,f.failed_reason,"
                          "COALESCE(s.unanswered_wakes,0) AS unanswered_wakes,s.unanswered_since_ms FROM actors a "
                          "LEFT JOIN wake_facts f ON f.recipient_id=a.id LEFT JOIN recipient_schedule s ON s.recipient_id=a.id "
                          "WHERE a.kind='agent' AND a.enabled=1 AND (f.failed_wakes>=? OR s.unanswered_wakes>=?) ORDER BY a.id LIMIT ?",
                          (FAILING_AFTER, PARKED_AFTER, AGENT_LIMIT)).fetchall()
        for row in rows:
            agent = row["recipient_id"]
            if row["failed_wakes"] >= FAILING_AFTER:
                reds["failing:" + agent] = {"kind": "failing", "posted": True, "actor_id": agent, "count": row["failed_wakes"],
                                            "since_ms": row["failing_since_ms"], "outcome": row["failed_outcome"], "reason": row["failed_reason"],
                                            "why": why_words(row["failed_reason"], row["failed_outcome"]), "route": routes.get(agent)}
            if row["unanswered_wakes"] >= PARKED_AFTER:
                waiting, oldest = self._on_record_waiting(db, agent)
                if waiting:
                    since = row["unanswered_since_ms"]
                    reds["parked:" + agent] = {"kind": "parked", "posted": True, "actor_id": agent, "count": row["unanswered_wakes"],
                                               "since_ms": max(since, oldest) if since is not None and oldest is not None else since,
                                               "waiting": waiting}
        return reds

    def _health_settle(self, db, now):
        """After an act that may change what is red: when the recorded reds changed, post one notice per outcome concerned.

        Called by every act that changes what the reds are read from: each
        command, each runner act and each recorded runner exit, in the act's
        own transaction, so a notice says what that act changed and is posted
        exactly when it is. What was last announced is kept in metadata, so a
        thing that stays red is never posted again, and it is posted green
        once when it clears."""
        routes = self._health_routes(db)
        every = self._health_reds(db, now, routes)
        row = db.execute("SELECT value FROM metadata WHERE key=?", (ANNOUNCED_KEY,)).fetchone()
        announced = json.loads(row[0]) if row is not None else {}
        # A posted red that is still red, though no longer one that is posted (a
        # paused runner then stopped by a deploy), has not gone green.
        reds = {key: fact for key, fact in every.items() if fact["posted"] or key in announced}
        if set(reds) == set(announced):
            return
        went_red = {key: fact for key, fact in reds.items() if key not in announced}
        from .wake_health import PARKED_AFTER
        went_green = {}
        for key, fact in announced.items():
            if key not in reds:
                fact = {"actor_id": fact.get("actor_id")}
                if key.startswith("parked:"):
                    # A parked agent clears by answering, or by having nothing left on the record.
                    left = db.execute("SELECT unanswered_wakes FROM recipient_schedule WHERE recipient_id=?", (fact["actor_id"],)).fetchone()
                    fact["answering"] = left is None or left[0] < PARKED_AFTER
                went_green[key] = fact
        db.execute("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (ANNOUNCED_KEY, json.dumps({key: {"actor_id": fact.get("actor_id"), "since_ms": now} for key, fact in reds.items()},
                                              sort_keys=True, separators=(",", ":"))))
        # Who each change concerns: an agent's change, that agent; the runner's, every agent it wakes.
        concerned = {}
        for key in set(went_red) | set(went_green):
            agents = sorted(routes) if key == "runner" else [key.split(":", 1)[1]]
            for agent in agents:
                concerned.setdefault(agent, set()).add(key)
        if not concerned:
            return
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
                                 {key: went_green[key] for key in keys if key in went_green}, reds)
            body = "Health: %s\n\nThe Health page, under the instance name, says more; agents can run aim-next health." % " ".join(lines)
            if not self._health_author(db):
                return
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
        return {"instance_id": self.instance_id, "red": sorted(self._health_reds(db, _now_ms()))}

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
        return {"instance_id": self.instance_id, "read_ms": now, "red": sorted(reds), "runner": runner, "agents": agents,
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
    if machine and machine.get("cpus") and machine["load"][0] > machine["cpus"]:
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
        lines.append("This Mac: load %s on %s cores (1, 5 and 15 minutes: %s)" % (
            machine["load"][0], machine.get("cpus"), ", ".join(str(value) for value in machine["load"])))
    release = answer.get("release")
    lines.append("Latest release: %d, live%s, shipped %s" % (
        release["release"], when(release.get("deployed_ms")), ", ".join(str(item) for item in release["items"]) or "no pipeline item")
        if release else "Latest release: none recorded")
    lines.append("Database version %s; read%s." % (answer.get("schema_version"), when(answer.get("read_ms"), "at")))
    return lines

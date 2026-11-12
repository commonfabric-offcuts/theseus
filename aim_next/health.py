from __future__ import annotations

"""The Health page's facts (docs/health.md), from what Core records, in one view.

The unit is an attempt to reach an agent: one claim the runner settles
itself, or one hosted turn with every hand it took (the start and each steer
added to it) and every claim the Codex host says came from it (`_claim_settled`).
Each attempt comes to one fact, at the moment it happened (`claim_attempt`,
`act_attempt`, `turn_attempt`): it got through, or it did not, with why; and
one that got through with work the agent then did not act on was left
unanswered. A claim gets through when its notice reached the agent's chat
(accepted) or an earlier notice still waiting leads there (queued); a turn,
when the agent first acts while it runs, which only an agent a turn reached
can do, or when it completes. What Core keeps per recipient is a pure function
of its attempts by when each happened (`settled`): when a wake last got
through, how many have not since and why the latest did not, and how many got
through to it since it last acted. So the page can say "every wake since 8:27
PM failed (1,092 times)" and why, with one primary-key read, however long the
failures run; and how many messages were steered into a turn never changes
what it says. The runner keeps how the run before it ended, so the page can
say what it came back from.

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

import collections
import datetime
import json
import os
import re
import uuid

from .contract import Refusal
from .route_pins import KEY_PREFIX as _PIN_PREFIX, _key as _pin_key
from .whispers import READ_BY


# Attempts that got through: a notice in the agent's chat, an earlier one leading there, the agent
# acting while a hosted turn of its runs, or a hosted turn that completed.
THROUGH = ("accepted", "queued", "acted", "completed")
# Attempts in a row that did not get through before the page says the agent cannot be woken.
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
# A wake's reason: a fixed code, or one with the versions it names
# ("codex_version:0.167.0-alpha.3.2:0.163.0-alpha.10.2"), never local text.
REASON = re.compile(r"[A-Za-z0-9_.:+-]{1,128}")

HEALTH_SCHEMA = [
    # Per recipient: when a wake last got through, the attempts since that did
    # not, when the first and the latest of them happened, and the runner's (or
    # Codex's) fixed code for why the latest did not; the attempts that got
    # through to it since it last acted, and since when (`settled`); and when it
    # last recorded a command while a claim of its was out (`_health_acted`), so
    # the turn that claim hands knows the agent acted in it.
    "CREATE TABLE wake_facts (recipient_id TEXT PRIMARY KEY REFERENCES actors(id), reached_ms INTEGER, "
    "failed_wakes INTEGER NOT NULL DEFAULT 0, failing_since_ms INTEGER, failed_ms INTEGER, failed_outcome TEXT, failed_reason TEXT, "
    "unanswered_wakes INTEGER NOT NULL DEFAULT 0, unanswered_since_ms INTEGER, acted_ms INTEGER)",
    # Each hosted turn still running, as one attempt: when its first claim
    # began, when it was first handed work, whether any hand gave it work still
    # pending, and whether the agent has acted while it ran, which settled it as
    # got through then. Written by every hand, removed when the turn ends.
    "CREATE TABLE wake_turns (thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, recipient_id TEXT NOT NULL REFERENCES actors(id), "
    "began_ms INTEGER NOT NULL, handed_ms INTEGER NOT NULL, carried INTEGER NOT NULL, acted INTEGER NOT NULL, PRIMARY KEY(thread_id,turn_id))",
    # How the run before the current one ended: its state ('stopped', 'exited',
    # 'paused', 'unrenewed'), its reason and when, kept when a runner takes the role.
    "CREATE TABLE runner_prior (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, reason TEXT, ended_ms INTEGER)",
]


def _health_backfill(db):
    """Work the facts out once from the settlements already kept, by the same rule (`settled`).

    The attempts are every claim the runner settled itself, each its own: which
    turn a claim came from was never kept, so none joins one. A claim found
    expired happened when its lease ended. A hosted turn got through when the
    agent first acted while it ran, and the only acts whose time Core kept
    before this step are the messages the agent wrote, so the first it wrote
    after the turn's wake began is that moment; otherwise its end settles it,
    with Codex's code. Why a claim failed was never recorded, so it stays
    unknown, unless it expired. The wakes left unanswered start from the
    scheduler's own count, the only record of them, less each turn still
    running that it counted when it was handed work, which the rule counts when
    the turn ends; a count such a turn already lost to the agent's act says the
    agent acted while those turns ran."""
    db.execute("INSERT INTO wake_facts(recipient_id) SELECT DISTINCT recipient_id FROM wake_attempts")
    # Each turn still running, as Health keeps it from now on: whether it holds work is the scheduler's handed_seq.
    db.execute("INSERT INTO wake_turns SELECT h.thread_id,h.turn_id,h.recipient_id,min(a.started_ms),min(h.handed_ms),"
               "COALESCE((SELECT s.handed_seq IS NOT NULL FROM recipient_schedule s WHERE s.recipient_id=h.recipient_id),0),0 "
               "FROM hosted_turns h JOIN wake_attempts a ON a.id=h.attempt_id WHERE h.final_status IS NULL "
               "GROUP BY h.thread_id,h.turn_id,h.recipient_id")
    db.execute("UPDATE wake_turns SET acted=1 WHERE EXISTS (SELECT 1 FROM messages m WHERE m.author_id=wake_turns.recipient_id "
               "AND m.sent_ms>=wake_turns.began_ms) OR (SELECT s.unanswered_wakes FROM recipient_schedule s WHERE s.recipient_id=wake_turns.recipient_id)"
               "<(SELECT count(*) FROM wake_turns t WHERE t.recipient_id=wake_turns.recipient_id AND t.carried=1)")
    attempts = {}
    for recipient, began, lease_end, ended, outcome in db.execute(
            "SELECT a.recipient_id,a.started_ms,a.lease_until_ms,r.finished_ms,r.outcome FROM wake_attempts a "
            "JOIN wake_results r ON r.attempt_id=a.id WHERE r.outcome<>'handed'").fetchall():
        # A claim found expired is its own why; the runner's code for any other was never kept.
        attempts.setdefault(recipient, []).append(claim_attempt(outcome, "expired" if outcome == "expired" else None, began,
                                                                min(lease_end, ended) if outcome == "expired" else ended, False))
    for recipient, began, handed, ended, status, code in db.execute(
            "SELECT h.recipient_id,min(a.started_ms),min(h.handed_ms),min(h.finished_ms),h.final_status,h.error_code "
            "FROM hosted_turns h JOIN wake_attempts a ON a.id=h.attempt_id GROUP BY h.recipient_id,h.thread_id,h.turn_id").fetchall():
        acted = db.execute("SELECT min(sent_ms) FROM messages WHERE author_id=? AND sent_ms>=? AND (? IS NULL OR sent_ms<=?)",
                           (recipient, began, ended, ended)).fetchone()[0]
        theirs = attempts.setdefault(recipient, [])
        if acted is not None:
            theirs.append(act_attempt(acted))
        end = turn_attempt(status, code, began, handed, ended, acted is not None, False) if status is not None else None
        if end is not None:
            theirs.append(end)
    for recipient, theirs in sorted(attempts.items()):
        facts = NO_FACTS
        for attempt in sorted(theirs, key=lambda attempt: (attempt.ended_ms, attempt.began_ms)):
            facts = settled(facts, attempt)
        db.execute("UPDATE wake_facts SET %s WHERE recipient_id=?" % ",".join(key + "=?" for key in FAILURE_FACTS),
                   [facts[key] for key in FAILURE_FACTS] + [recipient])
    for recipient, count, since, counted in db.execute(
            "SELECT s.recipient_id,s.unanswered_wakes,s.unanswered_since_ms,"
            "(SELECT count(*) FROM wake_turns t WHERE t.recipient_id=s.recipient_id AND t.carried=1) "
            "FROM recipient_schedule s JOIN wake_facts f ON f.recipient_id=s.recipient_id").fetchall():
        db.execute("UPDATE wake_facts SET unanswered_wakes=?,unanswered_since_ms=? WHERE recipient_id=?",
                   (max(count - counted, 0), since if count > counted else None, recipient))


HEALTH_BACKFILL = [_health_backfill]
HEALTH_DOWN = (
    "DELETE FROM metadata WHERE key IN ('%s','%s','%s')" % (ANNOUNCED_KEY, DUE_KEY, LIGHT_KEY),
    "DELETE FROM actors WHERE id='%s' AND enabled=0" % HEALTH_ACTOR,
    "DROP TABLE runner_prior",
    "DROP TABLE wake_turns",
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
    "resume_failed": "Codex would not open its thread again",
    "settings_not_applied": "Codex opened its thread with settings other than the ones Theseus sent, so it was not used",
    "spawn_failed": "the Codex process that hosts its turns could not be started",
    "stopping": "the agent runner was stopping",
    "stalled": "the Codex process that hosts its turns stopped answering, so it was ended",
    "broken": "Codex answered in a way Theseus does not understand, so its process was ended",
    "auth_missing": "Codex is not signed in",
    "incompatible": "the Codex app-server is not one Theseus can use",
    "output_closed": "the Codex process that hosts its turns stopped sending output, so it was ended",
    "unowned": "the agent runner lost its role while it started Codex",
    # Why the wake helper (codex_broker.py) or the Codex host refused, as it reported it.
    "broker_config": "the helper that puts a wake in the Codex app's queue refused its own configuration or input",
    "codex_spawn": "the Codex app-server could not be started",
    "codex_no_answer": "the Codex app-server did not answer in time",
    "codex_protocol": "the Codex app-server answered in a way Theseus does not accept",
    "codex_home": "the Codex app-server answered for another Codex home than the one the agent is bound to",
    "codex_exit": "the Codex app-server did not exit cleanly after taking the wake",
    "codex_version": "the Codex app is a version Theseus has not been reviewed with: a new Codex version needs a review before wakes resume",
}
# A Codex version refusal names the version found and the one reviewed (codex_broker.handshake_refusal).
VERSION_WHY = ("the Codex app is now version %s, but Theseus has been reviewed only with version %s: "
               "a new Codex version needs a review before wakes resume")
# The reasons for which "is the ChatGPT app open?" is where to look first: the helper could
# not start Codex or got no answer from it, or nobody recorded why (None, or only the
# helper's exit, as every failure before the helper named its reasons). Any other reason
# names its own cause, and the question would point away from it.
APP_OPEN_REASONS = frozenset((None, "broker_exit", "deadline", "codex_spawn", "codex_no_answer"))
UNRECORDED_WHY = "Theseus did not record why: these failures began before it did"
# Why a hosted wake did not get through, from how its turn ended; Codex's own
# code for it (codexErrorInfo, "serverOverloaded"), when it gave one, follows
# in words: "its Codex turn failed (server overloaded)".
TURN_WHY = {"failed": "its Codex turn failed", "lost": "its Codex turn was lost", "interrupted": "its Codex turn was interrupted"}
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


# One attempt to reach an agent, as it came out: when its wake began (its
# first claim), when it reached the agent, when it happened (its moment, which
# orders it), its outcome (one of THROUGH, or how it failed) and the fixed code
# for why, and whether it is one the agent left unanswered.
Attempt = collections.namedtuple("Attempt", "began_ms reached_ms ended_ms outcome reason unanswered")
# What Core keeps for a recipient before any attempt.
NO_FACTS = {"reached_ms": None, "failed_wakes": 0, "failing_since_ms": None, "failed_ms": None, "failed_outcome": None,
            "failed_reason": None, "unanswered_wakes": 0, "unanswered_since_ms": None}
# The facts about wakes getting through, as distinct from the unanswered count.
FAILURE_FACTS = ("reached_ms", "failed_wakes", "failing_since_ms", "failed_ms", "failed_outcome", "failed_reason")


def claim_attempt(outcome, reason, began_ms, ended_ms, work):
    """A claim the runner settled itself, as one attempt: its own outcome, with the runner's code
    for why one did not get through. An accepted notice reached the agent's chat and, when work
    waited (work), is one it leaves unanswered until it acts; a queued one leads to a notice
    already waiting, so it is not counted again."""
    return Attempt(began_ms, ended_ms, ended_ms, outcome, None if outcome in THROUGH else reason, outcome == "accepted" and bool(work))


def act_attempt(at_ms):
    """The agent acted while a hosted turn of its ran (or while the claim that handed one was out):
    only an agent a turn reached can, so a wake got through, then."""
    return Attempt(at_ms, at_ms, at_ms, "acted", None, False)


def turn_attempt(status, error_code, began_ms, handed_ms, ended_ms, acted, carried):
    """A hosted turn's end, as the attempt it settles, or None when it adds nothing.

    A turn that completed got through when it ended; one the agent did not act
    in that was given work (carried) is one it left unanswered, from when it
    was handed that work. A turn that did not complete got through only if the
    agent acted while it ran (acted), which settled it then (`act_attempt`), so
    its end adds nothing; otherwise it did not, at its end, with how it ended
    and Codex's code as why. A steer it never read is work the scheduler hands
    again, not a failed attempt."""
    if status == "completed":
        return Attempt(began_ms, handed_ms, ended_ms, "completed", None, bool(carried) and not acted)
    if acted:
        return None
    return Attempt(began_ms, handed_ms, ended_ms, status, error_code, False)


def settled(facts, attempt):
    """A recipient's facts after one more attempt, from its facts before it: a pure function, so
    what Core keeps is the fold of its attempts by when each happened.

    One that got through ends the run that did not and is when a wake last got
    through. Every attempt that gets through is settled at the moment it
    happens (an accepted or queued claim, the agent's act, a turn's
    completion), so it is never older than one already settled; only a claim
    found expired is settled after it happened, when its lease ended. So one
    that did not get through adds to the run since the last that did, unless
    it happened before that one, and the latest by when it happened says why.
    One left unanswered adds to those, from when it reached the agent, until
    the agent acts (`_health_acted`)."""
    facts = dict(facts)
    at = attempt.ended_ms
    if attempt.outcome in THROUGH:
        facts.update(reached_ms=at, failed_wakes=0, failing_since_ms=None, failed_ms=None, failed_outcome=None, failed_reason=None)
    elif facts["reached_ms"] is None or at >= facts["reached_ms"]:
        facts.update(failed_wakes=facts["failed_wakes"] + 1,
                     failing_since_ms=at if facts["failing_since_ms"] is None else min(at, facts["failing_since_ms"]))
        if facts["failed_ms"] is None or at >= facts["failed_ms"]:
            facts.update(failed_ms=at, failed_outcome=attempt.outcome, failed_reason=attempt.reason)
    if attempt.unanswered:
        facts.update(unanswered_wakes=facts["unanswered_wakes"] + 1,
                     unanswered_since_ms=attempt.reached_ms if facts["unanswered_since_ms"] is None else facts["unanswered_since_ms"])
    return facts


def why_words(reason, outcome=None):
    """Why a wake did not get through, in words, from the runner's fixed code, or from how its turn ended and Codex's code."""
    if outcome in TURN_WHY:
        return TURN_WHY[outcome] + ("" if reason is None else " (%s)" % _spaced(reason))
    if reason is None:
        return "the agent was busy" if outcome == "busy" else UNRECORDED_WHY
    if reason in WHY:
        return WHY[reason]
    if reason.startswith("codex_version:"):
        found, _, reviewed = reason[len("codex_version:"):].partition(":")
        return VERSION_WHY % (found, reviewed) if found and reviewed and ":" not in reviewed else WHY["codex_version"]
    if reason.startswith("thread_"):
        return "its Codex thread is %s" % _spaced(reason[len("thread_"):])
    return "the agent runner said %s" % reason


def ask_app_open(reason, outcome=None):
    """Whether a wake through the Codex app's queue that failed for reason should ask whether the ChatGPT app is open."""
    return outcome not in TURN_WHY and reason in APP_OPEN_REASONS


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
        if all(fact["route"] == "codex_queue" and fact["ask_app_open"] for fact in facts):
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
    def _attempt_settled(self, db, recipient, attempt):
        """One attempt to reach recipient settled: its facts become `settled` of what they were."""
        db.execute("INSERT OR IGNORE INTO wake_facts(recipient_id) VALUES (?)", (recipient,))
        row = db.execute("SELECT %s FROM wake_facts WHERE recipient_id=?" % ",".join(NO_FACTS), (recipient,)).fetchone()
        facts = settled(dict(zip(NO_FACTS, row)), attempt)
        db.execute("UPDATE wake_facts SET %s WHERE recipient_id=?" % ",".join(key + "=?" for key in NO_FACTS),
                   [facts[key] for key in NO_FACTS] + [recipient])

    def _claim_settled(self, db, attempt_id, outcome, now, reason=None, work=False, from_turn=None):
        """A claim the runner settled itself, or one found expired: one attempt (`claim_attempt`),
        unless the Codex host said it came from a hosted turn (from_turn) that Core still lists as
        running for its agent. Then it was traffic to a turn already reaching the agent, so it adds
        nothing, and the turn decides it. The host names a turn only when Codex said that turn is
        running and cannot take more work, or the Codex process running it ended, which ends the
        turn too. A claim found expired happened when its lease ended."""
        recipient, began, lease_end = db.execute("SELECT recipient_id,started_ms,lease_until_ms FROM wake_attempts WHERE id=?",
                                                 (attempt_id,)).fetchone()
        if from_turn is not None and db.execute("SELECT EXISTS (SELECT 1 FROM wake_turns WHERE thread_id=? AND turn_id=? AND recipient_id=?)",
                                                (from_turn["thread_id"], from_turn["turn_id"], recipient)).fetchone()[0]:
            return
        at = min(lease_end, now) if outcome == "expired" else now
        self._attempt_settled(db, recipient, claim_attempt(outcome, reason, began, at, work))

    def _turn_handed(self, db, attempt, turn, now, carried):
        """A hand Core recorded while its turn runs: the turn's attempt began with its first claim,
        and was given work if any hand gave it work still pending. An act recorded while this claim
        was out, before the hand (Codex had started the turn), was in a turn this claim reached. A
        hand to a turn that had already ended joins an attempt already settled, so it is never
        recorded here."""
        db.execute("INSERT INTO wake_turns VALUES (?,?,?,?,?,?,0) ON CONFLICT(thread_id,turn_id) DO UPDATE SET "
                   "began_ms=MIN(began_ms,excluded.began_ms),handed_ms=MIN(handed_ms,excluded.handed_ms),carried=MAX(carried,excluded.carried)",
                   (turn["thread_id"], turn["turn_id"], attempt["recipient_id"], attempt["started_ms"], now, int(carried)))
        if db.execute("SELECT EXISTS (SELECT 1 FROM wake_facts WHERE recipient_id=? AND acted_ms>=?)",
                      (attempt["recipient_id"], attempt["started_ms"])).fetchone()[0]:
            self._turns_reached(db, attempt["recipient_id"], now)

    def _turns_reached(self, db, recipient, now):
        """The agent acted while hosted turns of its ran: each not yet acted in got through, now,
        which is one attempt that got through (`act_attempt`)."""
        if db.execute("UPDATE wake_turns SET acted=1 WHERE recipient_id=? AND acted=0", (recipient,)).rowcount:
            self._attempt_settled(db, recipient, act_attempt(now))

    def _turn_settled(self, db, thread_id, turn_id, status, error_code, now):
        """A hosted turn ended: its attempt settles once (`turn_attempt`), however many hands it took,
        unless an act while it ran already settled it as got through."""
        kept = db.execute("SELECT recipient_id,began_ms,handed_ms,carried,acted FROM wake_turns WHERE thread_id=? AND turn_id=?",
                          (thread_id, turn_id)).fetchone()
        if kept is None:
            # Every hand to a running turn keeps it, and the step kept every turn running before it.
            raise LookupError("Health kept no attempt for the running turn %s of %s" % (turn_id, thread_id))
        db.execute("DELETE FROM wake_turns WHERE thread_id=? AND turn_id=?", (thread_id, turn_id))
        recipient, began, handed, carried, acted = kept
        attempt = turn_attempt(status, error_code, began, handed, now, bool(acted), bool(carried))
        if attempt is not None:
            self._attempt_settled(db, recipient, attempt)

    def _health_acted(self, db, actor, now):
        """The actor recorded a command: every wake that reached it is answered, each hosted turn of
        its still running got through now (`_turns_reached`), and a claim of its still out is kept
        acted in, for the turn it may hand. Each is written only when there is one, so a command by
        anyone else (or a refusal) changes nothing here."""
        db.execute("UPDATE wake_facts SET unanswered_wakes=0,unanswered_since_ms=NULL WHERE recipient_id=? AND unanswered_wakes>0", (actor,))
        db.execute("INSERT INTO wake_facts(recipient_id,acted_ms) SELECT ?,? WHERE EXISTS "
                   "(SELECT 1 FROM recipient_schedule WHERE recipient_id=? AND claim_token IS NOT NULL) "
                   "ON CONFLICT(recipient_id) DO UPDATE SET acted_ms=excluded.acted_ms", (actor, now, actor))
        self._turns_reached(db, actor, now)

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
        FAILING_AFTER attempts in a row did not get through. "parked:<agent>"
        while it has left PARKED_AFTER attempts unanswered and work on the record
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
                "why": why_words(row["failed_reason"], row["failed_outcome"]), "route": routes.get(agent),
                "ask_app_open": ask_app_open(row["failed_reason"], row["failed_outcome"])}

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
        tells nothing new. "Unanswered" is Health's own count (`settled`),
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
        # While every commit ends here, light_changed never decides alone (a mutant dropping it
        # survives, equivalently): with no act, what is red changes only when a running runner's
        # lease ends, and that same moment moves what is kept as due (to when the absence will be
        # told) or, if the settling comes later than that, changes what is told. It is kept for a
        # kept light that is missing or unreadable, which only a commit outside this step leaves.
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
            # What waits, as the reader may see it: an agent's whispers count for that agent itself, and each for the
            # person who wrote it (whispers.READ_BY).
            waiting, oldest = db.execute(
                "SELECT count(*),min(m.sent_ms) FROM delivery_groups g INDEXED BY eligible_groups "
                "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                "JOIN messages m ON m.id=d.message_id WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0"
                + ("" if row["id"] == actor else " AND " + READ_BY), (row["id"],) if row["id"] == actor else (row["id"], actor)).fetchone()
            item = {"actor_id": row["id"], "name": row["name"], "route": route, "waiting": waiting, "waiting_since_ms": oldest}
            if row["scheduled"]:
                item.update(next_due_ms=row["next_due_ms"] if waiting else None, reached_ms=row["reached_ms"])
                failing, parked = reds.get("failing:" + row["id"]), reds.get("parked:" + row["id"])
                if failing is not None:
                    item["failing"] = {key: failing[key] for key in ("count", "since_ms", "outcome", "reason", "why", "ask_app_open")}
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
            # An answer from a Core that predates ask_app_open asks, as it did then.
            if agent.get("route") == "codex_queue" and failing.get("ask_app_open", True):
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

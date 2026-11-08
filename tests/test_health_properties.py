from __future__ import annotations

"""Randomized checks that what is red and what is told are derived state (docs/health.md).

Random runs of runner acts (take the role, renew, stop, pause, resume, exit),
wakes that get through or do not, hosted turns that complete, fail or are
lost, work sent and answered, the owner taking agent-a off its topic and
putting it back, and time passing, with the server's settling at Core's kept
moment as the live feed would do it. agent-b, on agent-a's team, is woken
through the Codex app's queue and its wakes get through or fail too, so the
notices about it are work for agent-a, the coordinator, and can light agent-a's
parked red in the act that posts them. After every step:

- what Core kept as red (metadata health_light) is what the rule gives now,
  for the commit it names, including what the step's own notices lit;
- what Core kept as told is what `_health_told` gives now;
- the notices that step posted are exactly the difference between what was
  told before it and after it, so replaying every notice from the first
  snapshot gives the last;
- a key told and then cleared (or cleared and told again) means its subject's
  own facts changed between the two: work coming and going never makes a pair;
- an agent told as not answering is cleared only by its own act or by being
  disabled: a turn that fails, or the owner taking its work away, is not the
  agent answering.
"""

import json
import os
import random
import re
import sqlite3

from aim_next.health import HANDOVER_MS
from aim_next.runner import RunnerError
from aim_next.store import _connect
from test_hosted_schedule import OTHER_THREAD, THREAD
from test_health import HealthCase
from test_wake_contract import own_cases


STEPS = 200
SEEDS = range(12)
LINES = [
    (re.compile(r"The agent runner [^.]*?, so no wakes are going out\."), lambda m: [("runner", "+")]),
    (re.compile(r"The agent runner (?:is running again|is still not sending wakes)"), lambda m: [("runner", "-")]),
    (re.compile(r"((?:[\w-]+)(?:(?:, | and )[\w-]+)*) can't be woken:"),
     lambda m: [("failing:" + name, "+") for name in re.split(r", | and ", m.group(1))]),
    (re.compile(r"([\w-]+) has not answered its last"), lambda m: [("parked:" + m.group(1), "+")]),
    (re.compile(r"([\w-]+) can be woken again"), lambda m: [("failing:" + m.group(1), "-")]),
    (re.compile(r"([\w-]+) is answering again"), lambda m: [("parked:" + m.group(1), "-")]),
]


@own_cases
class HealthPropertyCase(HealthCase):
    def recompute(self):
        """(what is red, what is told) by the rule, now, from one read."""
        db, _ = _connect(self.path)
        try:
            db.execute("BEGIN")
            reds = self.store._health_reds(db, self.now)
            return sorted(reds), sorted(self.store._health_told(db, self.now, reds))
        finally:
            db.rollback()
            db.close()

    def kept(self, key):
        row = self.sql("SELECT value FROM metadata WHERE key=?", (key,))
        return json.loads(row[0][0]) if row else None

    def subject(self, key):
        """The facts a told key is about: the runner's row, or the agent's own wake facts.

        An agent's own facts are whether it is enabled, the acts it recorded, and the
        wakes that reached it (accepted notices, turns it was started for that
        completed), never the scheduler's count, which moves for reasons that are not
        the agent's, nor turns Codex did not complete."""
        if key == "runner":
            # Whether its lease still runs is a fact of the runner's: it ends as time passes.
            state, token, ended, reason, lease = self.sql("SELECT state,runner_token,ended_ms,reason_code,lease_until_ms FROM runner_state")[0]
            return state, token, ended, reason, lease is not None and lease > self.now
        agent = key.split(":", 1)[1]
        enabled = self.sql("SELECT enabled FROM actors WHERE id=?", (agent,))[0][0]
        if key.startswith("failing:"):
            return enabled, tuple(self.sql("SELECT failed_wakes FROM wake_facts WHERE recipient_id=?", (agent,)) or [(0,)])[0]
        acts = self.sql("SELECT count(*) FROM operations WHERE actor_id=?", (agent,))[0][0]
        reached = self.sql("SELECT count(*) FROM wake_attempts a JOIN wake_results r ON r.attempt_id=a.id "
                           "WHERE a.recipient_id=? AND r.outcome='accepted'", (agent,))[0][0] + self.sql(
            "SELECT count(*) FROM hosted_turns WHERE recipient_id=? AND mode='start' AND final_status='completed'", (agent,))[0][0]
        return enabled, acts, reached

    def events(self, after_seq):
        found = []
        for (body,) in self.sql("SELECT body FROM messages WHERE author_id='theseus' AND seq>? ORDER BY seq", (after_seq,)):
            for pattern, keys in LINES:
                for match in pattern.finditer(body):
                    found.extend(keys(match))
        return found

    def last_message(self):
        return self.sql("SELECT coalesce(max(seq),0) FROM messages")[0][0]

    def settle_due(self):
        """The server's live feed: Core's kept moment has come with no act first."""
        for _ in range(4):
            due = self.kept("health_due")
            if due is None or due > self.now:
                return
            self.store.settle_health_due(due)
        self.fail("a kept moment that came was still kept after settling it")

    # The acts --------------------------------------------------------------

    def new_guard(self):
        self.serial_guard = getattr(self, "serial_guard", 0) + 1
        if self.g is not None:
            self.g.close()
        self.g = self.guard("prop-%d" % self.serial_guard)

    def minute_later(self):
        """In a coordinator run, past the minute an accepted wake waits, within the runner's longer
        lease, so the agent is woken again for what it left."""
        if self.coordinator:
            self.store.renew_runner(self.g, self.runner, lease_ms=120000)
            self.now += 61000

    def act(self, rng):
        state = self.sql("SELECT state,version,lease_until_ms FROM runner_state")[0]
        live = state[0] == "running" and state[2] > self.now
        # While a runner runs, mostly wakes and work, so agents fail and park; while none does,
        # mostly a runner taking the role again, so it comes and goes many times in a run.
        choice = rng.choice(["wake"] * 5 + ["turn"] * 3 + ["send"] * 2 + ["ack"] * self.acks + ["time"] * 4 + ["renew"] * 2
                            + ["leave", "join", "stop", "pause", "exit"] + ["b-send", "b-wake", "b-wake"] + ["b-ack"] * self.acks if live
                            else ["acquire", "acquire", "resume", "resume", "send", "send", "time", "time", "stop", "exit", "leave", "join"]
                            + ["ack"] * self.acks)
        if self.coordinator:
            # A runner that stays up while agent-a, the coordinator, seldom acts and is often off its
            # topic, and agent-b's wakes get through, fail and are answered: agent-a parks with nothing
            # waiting, and a notice about agent-b is the work that makes it red.
            choice = rng.choice(["wake"] * 4 + ["send"] * 2 + ["leave"] * 3 + ["join", "ack"] + ["b-send"] * 3 + ["b-wake"] * 5
                                + ["b-ack"] * 2 + ["time"] * 2) if live else "acquire"
        elif self.steady:
            # A runner that stays up: wakes and turns keep reaching agent-a while its work
            # comes and goes, so it parks and the scheduler moves its own count around it.
            choice = rng.choice(["wake"] * 4 + ["turn"] * 4 + ["send"] * 3 + ["time"] * 3 + ["renew", "leave", "join"]
                                + ["b-send", "b-wake", "b-wake"] + ["ack"] * self.acks) if live else "acquire"
        if self.unrun > 0:
            # An instance not yet given a runner: work comes and goes around it for a while.
            self.unrun -= 1
            choice = rng.choice(["send", "send", "time"] + ["ack"] * max(self.acks, 1))
        try:
            if choice == "send":
                self.send_next("Work %d" % rng.randrange(10 ** 6))
            elif choice == "ack":
                for item in self.pending()["items"]:
                    self.ack(item["id"])
            elif choice == "b-send":
                self.send_next("Work for agent-b %d" % rng.randrange(10 ** 6), addressees=["agent-b"])
            elif choice == "b-ack":
                for item in self.store.view("agent-b", "deliveries", {})["items"]:
                    self.ack(item["id"], actor="agent-b")
            elif choice == "b-wake" and self.runner:
                # agent-b's wakes go through the Codex app's queue; Health's notices about it are agent-a's work.
                self.minute_later()
                self.store.renew_runner(self.g, self.runner)
                for claim in self.store.claim_wakes(self.g, self.runner, ["agent-b"]).get("claims") or ():
                    outcome = rng.choice(["accepted", "error", "error", "unavailable"])
                    self.store.finish_wake(self.g, self.runner, claim["claim_token"], outcome,
                                           reason=None if outcome == "accepted" else rng.choice(["broker_exit", "deadline"]))
            elif choice in ("leave", "join"):
                # The owner takes agent-a off its topic (what waited for it is cancelled), or puts it back.
                present = self.sql("SELECT count(*) FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a' AND active=1")[0][0]
                if bool(present) != (choice == "join"):
                    self.part(choice == "join")
            elif choice == "time":
                self.now += rng.choice([1000, 9000, 30000, 60000, 60000, 60000, HANDOVER_MS - 1000, HANDOVER_MS + 1000, 3600 * 1000])
            elif choice == "acquire":
                result = self.store.acquire_runner(self.g, lease_ms=30000)
                if result["status"] == "acquired":
                    self.runner = result["runner_token"]
            elif choice == "renew" and self.runner:
                self.store.renew_runner(self.g, self.runner)
            elif choice == "stop" and self.runner:
                self.store.stop_runner(self.g, self.runner)
            elif choice == "pause" and self.runner:
                self.store.pause_runner(self.g, self.runner, rng.choice(["operator_pause", "storage_failure"]))
            elif choice == "resume" and state[0] == "paused":
                self.new_guard()
                result = self.store.resume_runner(self.g, state[1])
                if result["status"] == "acquired":
                    self.runner = result["runner_token"]
            elif choice == "exit" and state[0] == "running":
                self.store.record_runner_exit(os.getpid(), rng.choice([None, 0, 1, 75, -9, -15]))
            elif choice == "wake" and self.runner:
                self.minute_later()
                # A runner renews before it claims, as its loop does.
                self.store.renew_runner(self.g, self.runner)
                claims = self.store.claim_wakes(self.g, self.runner, ["agent-a"])
                for claim in claims.get("claims") or ():
                    outcome = rng.choice(["accepted", "accepted", "accepted", "error"] if self.coordinator else ["accepted", "unavailable", "error", "error"])
                    self.store.finish_wake(self.g, self.runner, claim["claim_token"], outcome,
                                           reason=None if outcome == "accepted" else rng.choice(["broker_exit", "deadline"]))
            elif choice == "turn" and self.runner and self.open_turn:
                # The hosted turn ends, each way a turn can; agent-a acted in it only if an "ack" came between.
                status = rng.choice(["completed", "failed", "failed", "lost"])
                self.store.end_hosted_turn(self.g, self.runner, THREAD, self.open_turn, status,
                                           **({} if status == "completed" else {"error_code": "serverOverloaded"}))
                self.open_turn = None
            elif choice == "turn" and self.runner:
                # A hosted turn starts with agent-a's work, one act; it ends in an act of its own.
                self.store.renew_runner(self.g, self.runner)
                claims = self.store.claim_wakes(self.g, self.runner, ["agent-a"])
                for claim in claims.get("claims") or ():
                    self.turns += 1
                    result = self.store.finish_wake(self.g, self.runner, claim["claim_token"], "handed", turn={
                        "thread_id": THREAD, "turn_id": "turn-%d" % self.turns, "mode": "start",
                        "client_id": "theseus:" + claim["attempt_id"], "announced_seq": claim["captured_seq"]})
                    if result.get("status") == "settled":
                        self.open_turn = "turn-%d" % self.turns
        except RunnerError:
            pass  # refused (lost, busy, too short): changes nothing, as for a real runner
        return choice

    def run_seed(self, seed):
        rng = random.Random(seed)
        self.g = self.hosting
        # How often agent-a answers its work: in some runs never, so it parks.
        self.acks = rng.choice([0, 1, 2])
        self.unrun = 0
        self.steady = rng.random() < 0.5
        self.coordinator = not self.steady and rng.random() < 0.5
        self.turns, self.open_turn = 0, None
        self.pin_route(self.hosting, "codex-queue-stdio", OTHER_THREAD, actor="agent-b")
        if rng.random() < 0.4:
            # An instance whose runner never ran.
            self.hosting.close()
            with sqlite3.connect(str(self.path)) as db:
                db.execute("UPDATE runner_state SET state='idle',reason_code=NULL,lease_until_ms=NULL")
            self.g, self.runner = None, None
            self.new_guard()
            self.send_next("A first act settles what is red")
            self.unrun = 80
        _, first = self.recompute()
        told, history, replay = first, {}, set(first)
        for step in range(STEPS):
            before_message = self.last_message()
            choice = self.act(rng)
            self.settle_due()
            red, now_told = self.recompute()
            where = "seed %d step %d (%s)" % (seed, step, choice)
            light = self.kept("health_light")
            seq = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
            self.assertEqual(light, {"red": red, "seq": seq}, "%s: what is kept as red is the rule's answer, for this commit" % where)
            self.assertEqual(sorted(self.kept("health_announced") or {}), now_told, "%s: what is kept as told is the rule's" % where)
            events = self.events(before_message)
            expected = sorted([(key, "+") for key in set(now_told) - set(told)] + [(key, "-") for key in set(told) - set(now_told)])
            self.assertEqual(sorted(events), expected, "%s: the notices say exactly what changed" % where)
            for key, sign in events:
                self.assertEqual(key in replay, sign == "-", "%s: %s %s replays onto what was told" % (where, sign, key))
                (replay.discard if sign == "-" else replay.add)(key)
                facts = self.subject(key)
                previous = history.get(key)
                if previous is not None:
                    self.assertNotEqual(previous, facts, "%s: %s flipped while its facts stayed %r" % (where, key, facts))
                    if key.startswith("parked:") and sign == "-":
                        self.assertNotEqual(previous[:2], facts[:2], "%s: %s cleared with no act of its own and not disabled" % (where, key))
                history[key] = facts
            told = now_told
        self.assertEqual(sorted(replay), told, "seed %d: the notices replayed from the first snapshot give the last" % seed)
        return history


def _seeded(seed):
    def test(self):
        self.run_seed(seed)
    test.__doc__ = "Random runner acts, wakes, work and time, seed %d." % seed
    return test


for _seed in SEEDS:
    setattr(HealthPropertyCase, "test_what_is_red_and_told_is_derived_state_seed_%d" % _seed, _seeded(_seed))


@own_cases
class AttemptPropertyCase(HealthCase):
    """Random hosted turns with 0 to 5 steers (read or not, some handed after their turn ended),
    claims the runner settles every way, claims left to expire, work withdrawn between a claim
    and its hand, and agent-a acting at every point, with Core's clock moving between every act.
    While a turn runs, claims also settle every way but handed, each by a path the Codex host
    takes: from the turn itself (Codex cannot take more work, refuses the steer, its process exits
    or answers in a way Theseus does not understand and is ended, which ends the turn lost too, or
    the claim is left to expire), or never reaching the thread (Codex will not resume or load it,
    resumes it with other settings, will not start a turn or cannot be started, or a notice goes
    to the agent's chat). And the host may detach from the thread while the turn runs (Codex
    closed it, or its status went notLoaded or systemError) without ending the turn, so Core lists
    it as running while every later claim of that run fails before it reaches the thread, until
    the turn ends lost. Core's clock passing a runner's lease puts a new runner in its place, so
    some of those claims are a run's that handed the turn work and some are not.

    The test keeps its own list of attempts to reach agent-a, each as it came out, and agent-a's
    acts, and after every step:
    - what Core keeps (failed_wakes, failed_outcome, unanswered_wakes) is the pure function of
      that list and the acts: the failures since the last attempt that got through, and the
      attempts left unanswered since agent-a last acted; a claim that came from a turn running
      that the same run of the runner handed work to is not on the list but joins the turn, and
      every claim that never reached the turn is on it, whatever Core lists as running;
    - what is told about agent-a is what that function says, so a told key about agent-a
      changes only in a step that settled an attempt (or, for not answering, one where agent-a
      acted): no notice pair repeats while attempt outcomes do not change."""

    # How the Codex host settles a claim that does not hand while a turn runs: (outcome, its code,
    # whether it came from the running turn, whether its process then ends and the turn ends lost).
    FROM_TURN_PATHS = [("busy", "not_steerable", False), ("error", "steer_failed", False),
                       ("unavailable", "child_exited", True), ("error", "protocol_error", True)]
    UNREACHED_PATHS = [("unavailable", "resume_failed"), ("unavailable", "settings_not_applied"),
                       ("unavailable", "thread_notLoaded"), ("unavailable", "thread_systemError"),
                       ("unavailable", "spawn_failed"), ("error", "start_failed"), ("accepted", None), ("queued", None)]

    STEPS = 160

    def tick(self, ms=1):
        self.now += ms

    def claim_one(self):
        """One claim for agent-a, with work sent first if none waits and Core's clock moved on to when it
        is due, as the runner waits; first noting a claim this one found expired."""
        if not self.pending()["items"]:
            self.send_next("Work %d" % self.serial)
            self.tick()
        due = self.store.runner_schedule(["agent-a"])["next_due_ms"]
        if due is not None and due > self.now:
            self.now = due
        self.fresh_lease()
        claims = self.store.claim_wakes(self.hosting, self.runner, ["agent-a"])["claims"]
        if self.outstanding is not None:
            expired = self.sql("SELECT outcome,finished_ms FROM wake_results WHERE attempt_id=?", (self.outstanding["attempt_id"],))
            if expired:
                self.assertEqual(expired[0][0], "expired")
                if self.joins(self.outstanding["runner"]):
                    self.from_turn += 1
                else:
                    self.attempt(through=False, outcome="expired", unanswered=False, ended=expired[0][1])
                self.outstanding = None
        self.tick()
        return claims[0] if claims else None

    def joins(self, runner):
        """Whether a claim of runner's that came from the running turn joins it: the same run handed it
        work (a runner's Codex processes end with it, so another run's claim came from none of them)."""
        return self.turn is not None and runner in self.turn["runners"]

    def attempt(self, through, outcome, unanswered, ended=None):
        self.attempts.append({"through": through, "outcome": outcome, "unanswered": unanswered, "ended": self.now if ended is None else ended})

    def acted(self):
        """Whether agent-a recorded a command since the step began, noting when."""
        count = self.sql("SELECT count(*) FROM operations WHERE actor_id='agent-a'")[0][0]
        if count > self.operations:
            self.operations = count
            self.acts.append(self.now)
        self.tick()

    def act_now(self, rng):
        items = self.pending()["items"]
        if items:
            for item in items:
                self.ack(item["id"])
        else:
            # Nothing waits: acknowledging something already handled is still a recorded act.
            self.ack(self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-a' ORDER BY seq LIMIT 1")[0][0])
        self.acted()

    def hand(self, claim, turn_id, mode):
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", turn={
            "thread_id": THREAD, "turn_id": turn_id, "mode": mode, "client_id": "theseus:" + claim["attempt_id"],
            "announced_seq": claim["captured_seq"]})
        self.assertEqual(result["status"], "settled", result)
        self.tick()
        return result

    def expected(self):
        """(failed_wakes, failed_outcome, unanswered_wakes) as a pure function of the attempts and acts."""
        failed = 0
        for attempt in reversed(self.attempts):
            if attempt["through"]:
                break
            failed += 1
        last_act = self.acts[-1] if self.acts else -1
        unanswered = sum(1 for attempt in self.attempts if attempt["unanswered"] and attempt["ended"] > last_act)
        return failed, self.attempts[-1]["outcome"] if failed else None, unanswered

    def end_turn(self, status):
        """The running turn ends: one attempt, decided by how it ended and whether agent-a acted."""
        self.fresh_lease()
        result = self.end(status, turn_id=self.turn["id"], **({} if status == "completed" else {"error_code": "serverOverloaded"}))
        self.assertEqual(result["status"], "ended", result)
        acted = any(self.turn["began"] <= at <= self.now for at in self.acts)
        self.attempt(through=status == "completed" or acted, outcome="completed" if status == "completed" or acted else status,
                     unanswered=status == "completed" and self.turn["carried"] and not acted)
        self.ended, self.turn = self.turn["id"], None
        self.tick()

    def step(self, rng):
        if self.turn is not None and self.turn["detached"]:
            # The host forgot the thread: no steer reaches it and nothing it says comes back, and the
            # turn ends only lost (the process exits, or the next runner ends what the last one left).
            choice = rng.choice(["fault"] * 6 + ["end", "send", "time"] + ["act"] * self.acts_weight)
        elif self.turn is not None:
            choice = rng.choice(["steer"] * 4 + ["see"] * 2 + ["end"] * 3 + ["fault"] * 3 + ["detach", "send", "time"]
                                + ["act"] * self.acts_weight)
        else:
            choice = rng.choice(["start"] * 4 + ["claim"] * 3 + ["withdrawn", "expire", "late", "send", "time"] + ["act"] * self.acts_weight)
        if choice == "send":
            self.send_next("Work %d" % rng.randrange(10 ** 6))
        elif choice == "act":
            self.act_now(rng)
        elif choice == "time":
            self.tick(rng.choice([1000, 25000, 61000]))
        elif choice == "claim" and self.turn is None:
            claim = self.claim_one()
            if claim is not None:
                outcome = rng.choice(["accepted", "queued", "busy", "error", "unavailable"])
                result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], outcome,
                                                reason=None if outcome in ("accepted", "queued") else rng.choice(["broker_exit", "deadline"]))
                self.assertEqual(result["status"], "settled", result)
                self.attempt(through=outcome in ("accepted", "queued"), outcome=outcome,
                             unanswered=outcome == "accepted" and bool(result["pending_count"]))
                self.tick()
        elif choice in ("start", "withdrawn") and self.turn is None:
            claim = self.claim_one()
            if claim is not None:
                if choice == "withdrawn":
                    # The owner takes agent-a off its topic between the claim and the hand, then puts it back.
                    self.part(False)
                    self.tick()
                if rng.random() < 0.3:
                    self.act_now(rng)  # agent-a acts once Codex started the turn, before the hand is recorded
                self.turns += 1
                result = self.hand(claim, "turn-%d" % self.turns, "start")
                self.turn = {"id": "turn-%d" % self.turns, "began": claim["lease_until_ms"] - 20000,
                             "carried": result["handed_seq"] is not None, "steers": [], "unseen": [], "runners": {self.runner},
                             "detached": False}
                if choice == "withdrawn":
                    self.part(True)
                    self.tick()
        elif choice == "steer" and self.turn is not None and len(self.turn["steers"]) < 5:
            self.send_next("More %d" % rng.randrange(10 ** 6))
            self.tick()
            claim = self.claim_one()
            if claim is not None:
                result = self.hand(claim, self.turn["id"], "steer")
                self.turn["carried"] = self.turn["carried"] or result["handed_seq"] is not None
                self.turn["runners"].add(self.runner)
                self.turn["steers"].append(claim["attempt_id"])
                self.turn["unseen"].append(claim["attempt_id"])
        elif choice == "detach":
            self.turn["detached"] = True
            self.detached += 1
        elif choice == "fault" and self.turn is not None:
            # A message arrives while the turn runs and its claim does not hand.
            self.send_next("Traffic %d" % rng.randrange(10 ** 6))
            self.tick()
            claim = self.claim_one()
            if claim is not None:
                if self.turn["detached"]:
                    path = rng.choice(self.UNREACHED_PATHS[:6])
                else:
                    path = rng.choice(self.FROM_TURN_PATHS + self.UNREACHED_PATHS + [("expire",)])
                if path == ("expire",):
                    # The runner never settles it (a steer Codex never answered): the next claim finds it expired.
                    self.outstanding = dict(claim, runner=self.runner)
                    self.tick(21000)
                else:
                    outcome, reason = path[:2]
                    from_turn = len(path) == 3
                    # Sometimes the owner takes agent-a off its topic before the claim settles, so nothing waits.
                    withdrawn = rng.random() < 0.25
                    if withdrawn:
                        self.part(False)
                        self.tick()
                    result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], outcome, reason=reason)
                    self.assertEqual(result["status"], "settled", result)
                    if withdrawn:
                        self.part(True)
                    if not (from_turn and self.joins(self.runner)):
                        self.attempt(through=outcome in ("accepted", "queued"), outcome=outcome,
                                     unanswered=outcome == "accepted" and bool(result["pending_count"]))
                        if self.turn["detached"] or self.joins(self.runner):
                            self.unreached += 1
                    else:
                        self.from_turn += 1
                    self.tick()
                    if from_turn and path[2] and rng.random() < 0.7:
                        # The host ends the process, and with it the turn.
                        self.end_turn("lost")
        elif choice == "see" and self.turn is not None and self.turn["unseen"]:
            attempt_id = self.turn["unseen"].pop(rng.randrange(len(self.turn["unseen"])))
            self.fresh_lease()
            self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + attempt_id)["status"], "recorded")
            self.tick()
        elif choice == "end" and self.turn is not None:
            self.end_turn("lost" if self.turn["detached"] else rng.choice(["completed", "completed", "failed", "lost", "interrupted"]))
        elif choice == "late" and self.turn is None and self.ended is not None:
            # A steer Codex answered after its turn ended: it joins an attempt already settled.
            self.send_next("Late %d" % rng.randrange(10 ** 6))
            self.tick()
            claim = self.claim_one()
            if claim is not None:
                self.hand(claim, self.ended, "steer")
        elif choice == "expire" and self.turn is None and self.outstanding is None:
            claim = self.claim_one()
            if claim is not None:
                # The runner never settles it: the next claim finds it expired.
                self.outstanding = dict(claim, runner=self.runner)
                self.tick(21000)
        if rng.random() < self.acts_weight / 10:
            self.act_now(rng)  # an act at any point
        return choice

    def run_seed(self, seed):
        rng = random.Random(seed)
        self.attempts, self.acts, self.turn, self.ended, self.outstanding, self.turns = [], [], None, None, None, 0
        # How many claims joined a running turn, how many of this run never reached its open turn, and detaches.
        self.from_turn = self.unreached = self.detached = 0
        # How often agent-a acts: in some runs seldom, so it is left wakes unanswered.
        self.acts_weight = rng.choice([0, 1, 3])
        self.operations = self.sql("SELECT count(*) FROM operations WHERE actor_id='agent-a'")[0][0]
        changed = {}
        told = set()
        for number in range(self.STEPS):
            settled_before, acts_before = len(self.attempts), len(self.acts)
            choice = self.step(rng)
            where = "seed %d step %d (%s)" % (seed, number, choice)
            row = self.sql("SELECT failed_wakes,failed_outcome,unanswered_wakes FROM wake_facts WHERE recipient_id='agent-a'")
            expected = self.expected()
            self.assertEqual(row[0] if row else (0, None, 0), expected, "%s: Core keeps the fold of the attempts" % where)
            now_told = {key for key in json.loads(self.kept("health_announced") or "{}") if key.endswith(":agent-a")}
            self.assertEqual(now_told, {key for key, on in (("failing:agent-a", expected[0] >= 3), ("parked:agent-a", expected[2] >= 3)) if on},
                             "%s: what is told about agent-a is what its attempts say" % where)
            for key in now_told ^ told:
                self.assertTrue(len(self.attempts) > settled_before or (key.startswith("parked:") and len(self.acts) > acts_before),
                                "%s: %s changed with no attempt settled" % (where, key))
                previous = changed.get(key)
                signature = (len(self.attempts), len(self.acts))
                self.assertNotEqual(previous, signature, "%s: %s flipped twice on the same attempts" % (where, key))
                changed[key] = signature
            told = now_told
        return self.attempts

    def kept(self, key):
        row = self.sql("SELECT value FROM metadata WHERE key=?", (key,))
        return row[0][0] if row else None


def _attempt_seeded(seed):
    def test(self):
        attempts = self.run_seed(seed)
        self.assertTrue(attempts, "seed %d settled no attempt" % seed)
    test.__doc__ = "Random hosted turns with steers, faults and acts, seed %d." % seed
    return test


for _seed in range(16):
    setattr(AttemptPropertyCase, "test_the_counts_are_a_function_of_the_attempts_seed_%d" % _seed, _attempt_seeded(_seed))

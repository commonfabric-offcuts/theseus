from __future__ import annotations

"""Randomized checks that what is red and what is told are derived state (docs/health.md).

Random runs of runner acts (take the role, renew, stop, pause, resume, exit),
wakes that get through or do not, work sent and answered, and time passing,
with the server's settling at Core's kept moment as the live feed would do it.
After every step:

- what Core kept as red (metadata health_light) is what the rule gives now,
  for the commit it names;
- what Core kept as told is what `_health_told` gives now;
- the notices that step posted are exactly the difference between what was
  told before it and after it, so replaying every notice from the first
  snapshot gives the last;
- a key told and then cleared (or cleared and told again) means its subject's
  own facts changed between the two: work coming and going never makes a pair.
"""

import json
import os
import random
import re
import sqlite3

from aim_next.health import HANDOVER_MS
from aim_next.runner import RunnerError
from aim_next.store import _connect
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
        """The facts a told key is about: the runner's row, or the agent's own wake facts."""
        if key == "runner":
            # Whether its lease still runs is a fact of the runner's: it ends as time passes.
            state, token, ended, reason, lease = self.sql("SELECT state,runner_token,ended_ms,reason_code,lease_until_ms FROM runner_state")[0]
            return state, token, ended, reason, lease is not None and lease > self.now
        agent = key.split(":", 1)[1]
        enabled = self.sql("SELECT enabled FROM actors WHERE id=?", (agent,))[0][0]
        if key.startswith("failing:"):
            return enabled, tuple(self.sql("SELECT failed_wakes FROM wake_facts WHERE recipient_id=?", (agent,)) or [(0,)])[0]
        return enabled, tuple(self.sql("SELECT unanswered_wakes FROM recipient_schedule WHERE recipient_id=?", (agent,)) or [(0,)])[0]

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

    def act(self, rng):
        state = self.sql("SELECT state,version,lease_until_ms FROM runner_state")[0]
        live = state[0] == "running" and state[2] > self.now
        # While a runner runs, mostly wakes and work, so agents fail and park; while none does,
        # mostly a runner taking the role again, so it comes and goes many times in a run.
        choice = rng.choice(["wake"] * 8 + ["send"] * 2 + ["ack"] * self.acks + ["time"] * 4 + ["renew"] * 2 + ["stop", "pause", "exit"] if live
                            else ["acquire", "acquire", "resume", "resume", "send", "send", "time", "time", "stop", "exit"] + ["ack"] * self.acks)
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
                # A runner renews before it claims, as its loop does.
                self.store.renew_runner(self.g, self.runner)
                claims = self.store.claim_wakes(self.g, self.runner, ["agent-a"])
                for claim in claims.get("claims") or ():
                    outcome = rng.choice(["accepted", "unavailable", "error", "error"])
                    self.store.finish_wake(self.g, self.runner, claim["claim_token"], outcome,
                                           reason=None if outcome == "accepted" else rng.choice(["broker_exit", "deadline"]))
        except RunnerError:
            pass  # refused (lost, busy, too short): changes nothing, as for a real runner
        return choice

    def run_seed(self, seed):
        rng = random.Random(seed)
        self.g = self.hosting
        # How often agent-a answers its work: in some runs never, so it parks.
        self.acks = rng.choice([0, 1, 2])
        self.unrun = 0
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

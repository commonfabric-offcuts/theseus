from __future__ import annotations

"""The wake replay (item 104, D33): its schedule and measure against a stub copy, and one short run of the real copy."""

import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout

from tools import wake_replay
from aim_next import check_reading

ROOT = Path(__file__).resolve().parents[1]


def traffic(messages, turns=None, routed=("aim-ux", "aim-spec")):
    return {"people": ["person-1"], "agents": sorted(routed), "routed": sorted(routed), "topics": [{"participants": ["person-1"] + sorted(routed)}],
            "messages": [dict({"from": "person-1", "topic": 0, "kind": "post", "woken": {}}, **message) for message in messages],
            "turns": turns or {}}


class StubCopy:
    """A copy on a virtual clock. Each post is delivered to the agents it names, and each delivery's wake comes `delay`
    ms after it; an agent in `never` is not woken and holds nothing due."""

    def __init__(self, delays, never=()):
        self.clock, self.delays, self.never = 1_000_000, delays, set(never)
        self.seq, self.waits, self.wakes = 0, [], []

    def now(self):
        return self.clock

    def deliver(self, agent):
        self.seq += 1
        return {"agent": agent, "seq": self.seq, "sent_ms": self.clock}

    def post(self, item):
        out = [self.deliver(agent) for agent in item["to"]]
        self.wakes += [(self.clock + self.delays[d["agent"]], d["agent"], d["seq"]) for d in out if d["agent"] not in self.never]
        return out

    def read(self, agent, upto):
        pass

    def due(self, agent):
        return any(wake[1] == agent for wake in self.wakes)

    def wait(self, due_ms):
        self.waits.append(due_ms)
        if self.wakes:
            at, agent, upto = min(self.wakes)
            if due_ms is None or at <= due_ms:
                self.wakes.remove((at, agent, upto))
                self.clock = max(self.clock, at)
                return {"agent": agent, "upto": upto, "ms": self.clock}
        if due_ms is None:
            raise AssertionError("waited for an event with nothing due")
        self.clock = max(self.clock, due_ms)
        return None


class Cooldown(StubCopy):
    """The broker's accepted cooldown: while an agent has not read its last wake, posts to it make no wake; once it
    reads, anything newer wakes it `delay` ms later."""

    def __init__(self, delays):
        super().__init__(delays)
        self.unread, self.pending = set(), {}

    def post(self, item):
        out = [self.deliver(agent) for agent in item["to"]]
        for d in out:
            self.pending.setdefault(d["agent"], []).append(d["seq"])
            if d["agent"] not in self.unread and not self.due(d["agent"]):
                self.wakes.append((self.clock + self.delays[d["agent"]], d["agent"], None))
        return out

    def wait(self, due_ms):
        event = super().wait(due_ms)
        if event is not None:
            event["upto"] = max(self.pending[event["agent"]])
            self.unread.add(event["agent"])
        return event

    def read(self, agent, upto):
        self.pending[agent] = [seq for seq in self.pending[agent] if seq > upto]
        self.unread.discard(agent)
        if self.pending[agent]:
            self.wakes.append((self.clock + self.delays[agent], agent, None))


class Schedule(unittest.TestCase):
    def test_idle_gaps_are_cut_and_turns_and_wakes_in_flight_are_not(self):
        plan = wake_replay.schedule(traffic([
            {"at_ms": 0, "to": ["aim-ux"], "woken": {"aim-ux": 1000}},
            {"at_ms": 60_000, "to": ["aim-ux"], "woken": {"aim-ux": 2000}},        # 59 s idle before it: cut to 5 s
            {"at_ms": 70_000, "to": ["aim-spec"]},                                  # inside aim-spec's turn: kept
            {"at_ms": 200_000, "to": ["aim-ux"]}],                                  # 10 s after the turn ends: cut to 5 s
            turns={"aim-spec": [{"start_ms": 61_000, "end_ms": 190_000}]}))
        self.assertEqual([post["at"] for post in plan["posts"]], [0, 6_000, 16_000, 141_000])
        self.assertEqual(plan["turns"], {"aim-spec": [129_000]})

    def test_a_gap_of_exactly_the_most_is_kept(self):
        plan = wake_replay.schedule(traffic([{"at_ms": 0, "to": ["aim-ux"]}, {"at_ms": wake_replay.REPLAY_IDLE_MAX_MS, "to": ["aim-ux"]}]))
        self.assertEqual([post["at"] for post in plan["posts"]], [0, wake_replay.REPLAY_IDLE_MAX_MS])


class Measure(unittest.TestCase):
    def test_the_median_of_each_agents_wakes_is_the_planted_one(self):
        messages = [{"at_ms": n * 1000, "to": ["aim-ux", "aim-spec"]} for n in range(5)]
        copy = StubCopy({"aim-ux": 800, "aim-spec": 13_900})
        result = wake_replay.replay(traffic(messages), copy)
        self.assertEqual((result["aim-ux"]["median"], result["aim-spec"]["median"]), (0.8, 13.9))
        self.assertEqual((result["aim-ux"]["wakes"], result["aim-ux"]["lost"]), (5, []))

    def test_the_median_is_not_the_mean(self):
        self.assertEqual(wake_replay.median([1.0, 2.0, 30.0]), 2.0)
        self.assertEqual(wake_replay.median([1.0, 2.0, 3.0, 30.0]), 2.5)

    def test_an_agent_in_a_long_turn_is_woken_late_by_the_turns_length(self):
        # aim-ux reads its first wake (at 0.5 s) only when its 20 s turn ends; posts meanwhile wake it after that read.
        messages = [{"at_ms": 0, "to": ["aim-ux"]}, {"at_ms": 1000, "to": ["aim-ux"]}, {"at_ms": 2000, "to": ["aim-ux"]}]
        quick = wake_replay.replay(traffic(messages), Cooldown({"aim-ux": 500, "aim-spec": 500}))
        slow = wake_replay.replay(traffic(messages, turns={"aim-ux": [{"start_ms": 0, "end_ms": 20_000}]}), Cooldown({"aim-ux": 500, "aim-spec": 500}))
        self.assertEqual(quick["aim-ux"]["delays"], [0.5, 0.5, 0.5])
        self.assertEqual(slow["aim-ux"]["delays"], [0.5, 20.0, 19.0])
        self.assertGreater(slow["aim-ux"]["median"], quick["aim-ux"]["median"] + 17)

    def test_a_wake_that_never_comes_is_lost_named_and_fails_the_reading(self):
        messages = [{"at_ms": 0, "to": ["aim-ux", "aim-spec"]}, {"at_ms": 4000, "to": ["aim-spec"]}]
        result = wake_replay.replay(traffic(messages), StubCopy({"aim-ux": 700, "aim-spec": 700}, never={"aim-spec"}))
        self.assertEqual((result["aim-spec"]["lost"], result["aim-spec"]["wakes"], result["aim-spec"]["median"]), ([0, 4000], 0, None))
        self.assertEqual(result["aim-ux"]["lost"], [])
        step = {"name": "wake-replay", "passed": True, "values": result}
        [reading] = check_reading.readings([{"check_id": "wake-time", "source": "release-check:wake-replay"}], [step])
        self.assertEqual((reading["result"], reading["words"]), ("failed", "a wake never came for aim-spec"))

    def test_the_only_waits_are_the_files_schedule_and_its_turns(self):
        messages = [{"at_ms": 0, "to": ["aim-ux"]}, {"at_ms": 3000, "to": ["aim-ux"]}]
        copy = Cooldown({"aim-ux": 400, "aim-spec": 400})
        start = copy.now()
        wake_replay.replay(traffic(messages, turns={"aim-ux": [{"start_ms": 0, "end_ms": 1500}]}), copy)
        offsets = sorted({due - start for due in copy.waits if due is not None})
        # The two posts, then each wake's read: the first after its 1.5 s turn, the second at once. Any other wait
        # has no deadline: it waits for the wake the copy still owes, after the schedule has run.
        self.assertEqual(offsets, [0, 1900, 3000, 3400])
        self.assertEqual(copy.waits, [start, start + 3000, start + 1900, start + 3000, None, start + 3400])


class RealCopy(unittest.TestCase):
    def test_two_messages_wake_their_agent_through_the_real_runner_and_broker(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "traffic.json"
            file.write_text(json.dumps(traffic([{"at_ms": 0, "to": ["aim-ux"]}, {"at_ms": 300, "to": ["aim-ux"]}], routed=("aim-ux",))))
            out = Path(temp) / "out"
            with redirect_stdout(io.StringIO()):
                code = wake_replay.run(file, out, ROOT)
            result = json.loads((out / "replay.json").read_text())["agents"]["aim-ux"]
            self.assertEqual((code, result["wakes"], result["lost"]), (0, 2, []), (out / "runner-stderr.log").read_text()[-2000:])
            self.assertLess(result["median"], 30)
            self.assertFalse([name for name in os.listdir(tempfile.gettempdir()) if name.startswith("theseus-wake-replay-")
                              and (Path(tempfile.gettempdir()) / name / "plan.json").exists()
                              and json.loads((Path(tempfile.gettempdir()) / name / "plan.json").read_text())["topics"][0]["participants"]
                              == ["aim-ux", "person-1"]], "the copy is removed")


class Fixture(unittest.TestCase):
    def test_the_captured_file_has_no_words_and_names_no_person(self):
        captured = json.loads((ROOT / wake_replay.FILE).read_text())
        self.assertEqual(len(captured["messages"]), 50)
        self.assertEqual(set(captured["routed"]), {"aim-core", "aim-spec", "aim-ux"})
        for message in captured["messages"]:
            self.assertEqual(set(message), {"at_ms", "from", "topic", "kind", "to", "woken"})
        self.assertTrue(all(person.startswith("person-") for person in captured["people"]))


if __name__ == "__main__":
    unittest.main()

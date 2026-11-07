from __future__ import annotations

"""An outcome's target and its checks (item 14; docs/targets.md): the status and
word rules, writing the target (D8), defining and reporting checks, the owner's
acceptance of a worse result (D31), problems found before a check (D39), and the
target line a topic opens with (D10)."""

import sqlite3
import unittest

from aim_next import outcome_rules
from aim_next.contract import Refusal
from aim_next.outcome_rules import check_status, reach_offered, streak, target_failing, target_word
import reader_fixture


def reading(result="passed", value=None, release=None):
    return {"result": result, "value": value, "release": release}


PASS = {"check_id": "units", "name": "Unit checks", "kind": "pass"}
MEASURE = {"check_id": "wake", "name": "Wake time", "kind": "measure", "target_value": 10.0, "better": "lower"}
UNTARGETED = {"check_id": "turns", "name": "Empty turns", "kind": "measure", "target_value": None}


class StatusRulesCase(unittest.TestCase):
    """6.5: a check's status from its readings, one per round, newest first."""

    def test_each_status_from_its_facts_and_its_neighbour(self):
        rows = [
            # An open ask about the check wins over any reading.
            (PASS, [reading()], reading(), True, "waiting"),
            (PASS, [], None, False, "not_run"),
            (PASS, [reading()], reading(), False, "passing"),
            (PASS, [reading()], reading("failed"), False, "failing"),
            (MEASURE, [], reading("failed", 3), False, "failing"),
            (UNTARGETED, [reading("measured", 40)], reading("measured", 40), False, "measured"),
            (MEASURE, [reading("measured", 12)], reading("measured", 12), False, "failing"),
            # D9: met once is measured, met two rounds in a row is holding, met-missed-met is measured.
            (MEASURE, [reading("measured", 8)], reading("measured", 8), False, "measured"),
            (MEASURE, [reading("measured", 8), reading("measured", 9)], reading("measured", 8), False, "holding"),
            (MEASURE, [reading("measured", 8), reading("measured", 14), reading("measured", 9)], reading("measured", 8), False, "measured"),
        ]
        for check, rounds, latest, ask, expected in rows:
            with self.subTest(check=check["check_id"], rounds=rounds, ask=ask):
                self.assertEqual(check_status(check, rounds, latest, ask), expected)

    def test_a_higher_is_better_measure_meets_its_target_from_above(self):
        better = dict(MEASURE, better="higher", target_value=100)
        self.assertEqual(check_status(better, [reading("measured", 120)] * 2, reading("measured", 120), False), "holding")
        self.assertEqual(check_status(better, [reading("measured", 80)], reading("measured", 80), False), "failing")

    def test_streaks_count_the_releases_held_and_say_whether_it_ever_failed(self):
        held = [reading("measured", 8, release) for release in (22, 21, 20, 19)]
        self.assertEqual(streak(MEASURE, held), {"releases": 4, "since_release": 19, "every_release_since_first_pass": False})
        passing = [reading("passed", release=release) for release in (21, 20, 19)]
        self.assertEqual(streak(PASS, passing), {"releases": 3, "since_release": 19, "every_release_since_first_pass": True})
        broken = [reading("passed", release=21), reading("failed", release=20), reading("passed", release=19)]
        self.assertEqual(streak(PASS, broken), {"releases": 1, "since_release": 21, "every_release_since_first_pass": False})
        self.assertIsNone(streak(MEASURE, [reading("measured", 8, 21), reading("measured", 30, 20)]))


class WordRulesCase(unittest.TestCase):
    """6.5, D41, D17: the target's word follows the kind and the statuses; nobody sets it."""

    def test_to_keep(self):
        self.assertIsNone(target_word("keep", None, False, ["passing"]), "no target")
        self.assertIsNone(target_word("keep", None, True, []), "no checks")
        self.assertEqual(target_word("keep", None, True, ["passing", "measured"]), "not_on_target")
        self.assertEqual(target_word("keep", None, True, ["passing", "holding"]), "on_target")
        self.assertEqual(target_word("keep", None, True, ["passing", "failing"]), "not_on_target")

    def test_to_reach_is_never_on_target_and_never_silent(self):
        for has_target, statuses in ((True, ["passing", "holding"]), (False, ["passing"]), (True, []), (False, [])):
            with self.subTest(has_target=has_target, statuses=statuses):
                self.assertEqual(target_word("reach", None, has_target, statuses), "not_there")
        for has_target, statuses in ((True, ["failing"]), (False, []), (True, [])):
            self.assertEqual(target_word("reach", {"ms": 1}, has_target, statuses), "reached")

    def test_the_failing_check_is_named_only_on_falling_back_from_on_target(self):
        checks = [PASS, MEASURE, dict(PASS, check_id="native")]
        statuses = ["passing", "failing", "failing"]
        self.assertEqual(target_failing(checks, statuses, "on_target"), MEASURE)
        self.assertIsNone(target_failing(checks, statuses, "not_on_target"))
        self.assertIsNone(target_failing(checks, statuses, None))


class ReachOfferCase(unittest.TestCase):
    """D42: Theseus offers Reached once every check is met at its latest reading; once is enough."""

    def test_the_offer_and_what_is_not_met(self):
        checks = [PASS, MEASURE]
        self.assertEqual(reach_offered(checks, ["passing", "measured"]), (True, []))
        self.assertEqual(reach_offered(checks, ["passing", "holding"]), (True, []))
        self.assertEqual(reach_offered([PASS, UNTARGETED], ["passing", "measured"]),
                         (False, [{"check_id": "turns", "name": "Empty turns", "why": "no_target"}]))
        self.assertEqual(reach_offered(checks, ["passing", "not_run"]), (False, [{"check_id": "wake", "name": "Wake time", "why": "not_run"}]))
        self.assertEqual(reach_offered(checks, ["not_run", "measured"]), (False, [{"check_id": "units", "name": "Unit checks", "why": "not_run"}]))
        self.assertEqual(reach_offered(checks, ["waiting", "measured"]), (False, [{"check_id": "units", "name": "Unit checks", "why": "waiting"}]))
        self.assertEqual(reach_offered(checks, ["failing", "measured"]), (False, [{"check_id": "units", "name": "Unit checks", "why": "failing"}]))
        self.assertEqual(reach_offered([], []), (False, []))


SHA_19, SHA_20, SHA_NEW = "1" * 40, "2" * 40, "3" * 40


class TargetCase(reader_fixture.ReaderCase):
    """Building outcome w1: owner "owner", coordinator agent-a, member agent-b, topic t1."""

    def checks_view(self, actor="owner", workspace="w1"):
        answer = self.store.view(actor, "outcome_checks", {"workspace_id": workspace})
        self.assertNotIn("error", answer, answer)
        return answer

    def revision(self, workspace="w1"):
        return self.checks_view(workspace=workspace)["relevant_versions"]["checks"]

    def propose(self, text, actor="agent-a", **args):
        return self.command("target.propose", dict({"text": text}, **args), {"workspace_id": "w1"},
                            {"target_revision": self.revision()}, actor=actor)

    def define(self, check, actor="agent-a"):
        return self.command("check.define", {"check": check}, {"workspace_id": "w1"}, {"checks_revision": self.revision()}, actor=actor)

    def waiting_on(self, topic="t1"):
        return self.sql("SELECT actor_id,ask_message_id FROM topic_waiting WHERE topic_id=? ORDER BY actor_id", (topic,))

    def post(self, body, actor="agent-a", topic="t1", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), {"topic_id": topic}, actor=actor))["message_id"]

    def open_topic(self, topic, workspace, participants=("agent-a",)):
        source = {"kind": "new_topic", "id": "opening-" + topic, "workspace_id": workspace}
        self.committed(self.save_draft("draft-" + topic, source, topic, "Opening " + topic,
                                       opening={"workspace_id": workspace, "title": "Topic " + topic, "participants": list(participants)}))
        self.committed(self.prepare("draft-" + topic, topic, submission="submission-" + topic, send_op="open-" + topic))
        self.committed(self.command("topic.create_and_send", {"submission_id": "submission-" + topic}, target={"topic_id": topic}, op="open-" + topic))

    def release(self, number, commit, at):
        self.assertTrue(self.store.record_release({"release": number, "commit": commit, "deployed_at": at, "items": [],
                                                   "source": "backfill"})["recorded"])

    def record_run(self, commit, at, readings, steps=(), tools=None):
        return self.store.record_checks({"outcome": "w1", "commit": commit, "started_at": at, "finished_at": at, "tools": tools or {},
                                         "steps": list(steps), "note": "", "readings": readings}, "agent-a")


class WritingTheTargetCase(TargetCase):
    """D8: the coordinator's first words count at once; later words by anyone but the owner ask the owner."""

    def test_the_first_words_count_at_once_and_later_ones_need_an_ask_to_the_owner(self):
        first = self.committed(self.propose("Every topic keeps its place."))
        self.assertTrue(first["current"])
        self.assertEqual(self.checks_view()["target"]["text"], "Every topic keeps its place.")
        self.rejected(self.propose("Every topic keeps its place, and loads fast."), "ASK_REQUIRED")
        tell = self.post("New words coming", addressees=["owner"], intent="tell")
        self.rejected(self.propose("Every topic keeps its place, and loads fast.", ask_message_id=tell), "ASK_REQUIRED")
        ask = self.post("May I change the target?", addressees=["owner"], intent="ask")
        second = self.committed(self.propose("Every topic keeps its place, and loads fast.", ask_message_id=ask))
        self.assertFalse(second["current"])
        view = self.checks_view()
        self.assertEqual(view["target"]["text"], "Every topic keeps its place.", "the current words stay until the owner decides")
        self.assertEqual(view["target"]["proposed"]["text"], "Every topic keeps its place, and loads fast.")
        self.assertEqual(self.waiting_on(), [("owner", ask)])
        # The owner writes without deciding: the proposal still waits on him.
        self.post("Looking at it", actor="owner")
        self.assertEqual(self.waiting_on(), [("owner", ask)])
        self.committed(self.command("target.settle", {"revision": second["revision"], "outcome": "accepted"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        view = self.checks_view()
        self.assertEqual(view["target"]["text"], "Every topic keeps its place, and loads fast.")
        self.assertEqual([row["text"] for row in view["target"]["earlier"]], ["Every topic keeps its place."])
        self.assertEqual(self.waiting_on(), [], "his decision clears the wait")

    def test_the_owner_declines_and_the_current_words_stay_and_his_own_count_at_once(self):
        self.committed(self.propose("First words."))
        proposed = self.committed(self.propose("Other words.", ask={"topic_id": "t1", "body": "New words?"}))
        self.committed(self.command("target.settle", {"revision": proposed["revision"], "outcome": "declined"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        self.assertEqual(self.checks_view()["target"]["text"], "First words.")
        self.assertEqual(self.waiting_on(), [])
        own = self.committed(self.propose("His own words.", actor="owner"))
        self.assertTrue(own["current"])
        self.assertEqual(self.checks_view()["target"]["text"], "His own words.")

    def test_the_ask_sent_with_the_words_is_one_message_in_a_topic_of_this_outcome(self):
        self.committed(self.propose("First words."))
        count = self.sql("SELECT count(*) FROM messages")[0][0]
        proposed = self.committed(self.propose("Second words.", ask={"topic_id": "t1", "body": "Use these words?"}))
        asks = self.sql("SELECT id,author_id,intent,addressees,body FROM messages WHERE topic_id='t1' ORDER BY seq DESC LIMIT 1")
        self.assertEqual(asks, [(proposed["ask_message_id"], "agent-a", "ask", '["owner"]', "Use these words?")])
        self.assertEqual(self.sql("SELECT count(*) FROM messages")[0][0], count + 1)
        self.assertEqual(self.waiting_on(), [("owner", proposed["ask_message_id"])])
        # A second wording by the same proposer declines the first and the owner now waits on its ask.
        again = self.committed(self.propose("Third words.", ask={"topic_id": "t1", "body": "Or these?"}))
        self.assertEqual(self.sql("SELECT revision,outcome FROM outcome_target_revisions WHERE workspace_id='w1' ORDER BY revision"),
                         [(1, "accepted"), (2, "declined"), (3, None)])
        self.assertEqual(self.waiting_on(), [("owner", again["ask_message_id"])])
        self.committed(self.command("target.settle", {"revision": again["revision"], "outcome": "accepted"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        self.assertEqual(self.waiting_on(), [])

    def test_an_ask_that_cannot_be_sent_writes_nothing(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "team": ["agent-a"]}))
        self.open_topic("t-elsewhere", "w2")
        self.committed(self.propose("First words."))
        before = self.sql("SELECT count(*) FROM messages"), self.sql("SELECT count(*) FROM outcome_target_revisions")
        self.rejected(self.propose("Words.", ask={"topic_id": "t-elsewhere", "body": "?"}), "ASK_REQUIRED")
        self.rejected(self.propose("Words.", ask={"topic_id": "t1", "body": "?"}, ask_message_id="m-x"), "INVALID_ARGUMENT")
        self.rejected(self.propose("Words.", actor="owner", ask={"topic_id": "t1", "body": "?"}), "INVALID_ARGUMENT")
        self.assertEqual((self.sql("SELECT count(*) FROM messages"), self.sql("SELECT count(*) FROM outcome_target_revisions")), before)

    def test_only_the_owner_and_the_coordinator_write_and_only_the_owner_settles(self):
        self.rejected(self.propose("A member's words.", actor="agent-b"), "FORBIDDEN")
        self.committed(self.propose("First words."))
        proposed = self.committed(self.propose("Second.", ask={"topic_id": "t1", "body": "?"}))
        self.rejected(self.command("target.settle", {"revision": proposed["revision"], "outcome": "accepted"}, {"workspace_id": "w1"},
                                   {"target_revision": self.revision()}, actor="agent-a"), "FORBIDDEN")


UNITS = {"check_id": "units", "group_name": "Checks", "position": 1, "name": "Unit checks", "kind": "pass", "source": "release-check:units"}
DURATION = {"check_id": "duration", "group_name": "Measures", "position": 2, "name": "Release check time", "kind": "measure",
            "source": "release-check:duration", "unit": "min", "better": "lower", "target_value": 20, "tolerance": 0.25}
WAKE = {"check_id": "wake", "group_name": "Measures", "position": 3, "name": "Wake time", "kind": "measure", "source": "reported",
        "unit": "s", "better": "lower", "target_value": 10}
REPLAY = {"check_id": "replay", "group_name": "Measures", "position": 4, "name": "Wake replay", "kind": "measure",
          "source": "release-check:wake-replay", "unit": "s", "better": "lower", "target_value": 5, "tolerance": 0.1}
TOOLS = {"release-check": "t-1", "chrome": "142"}


def passed(check_id="units", value=1000):
    return {"check_id": check_id, "result": "passed", "value": value, "words": "%d pass" % value}


def measured(check_id, value):
    return {"check_id": check_id, "result": "measured", "value": value, "words": "%s" % value}


class DefiningChecksCase(TargetCase):
    def test_a_check_says_which_words_it_proves_and_a_later_revision_keeps_them(self):
        self.committed(self.define(dict(UNITS, proves="Every topic keeps its place")))
        check = self.checks_view()["groups"][0]["checks"][0]
        self.assertEqual(check["proves"], "Every topic keeps its place")
        self.committed(self.define({"check_id": "units", "name": "Unit checks, both kinds"}))
        check = self.checks_view()["groups"][0]["checks"][0]
        self.assertEqual((check["name"], check["proves"]), ("Unit checks, both kinds", "Every topic keeps its place"))
        self.rejected(self.define({"check_id": "units", "proves": "x" * 1001}), "INVALID_ARGUMENT")

    def test_retiring_a_check_needs_a_why_and_keeps_its_earlier_revisions(self):
        self.committed(self.define(UNITS))
        self.committed(self.define(dict(WAKE)))
        for empty in ("", "   "):
            self.rejected(self.define({"check_id": "wake", "retired_why": empty}, actor="owner"), "WHY_REQUIRED")
        self.committed(self.define({"check_id": "wake", "retired_why": "Measured another way now"}, actor="owner"))
        self.assertEqual([check["check_id"] for group in self.checks_view()["groups"] for check in group["checks"]], ["units"])
        self.assertEqual(self.sql("SELECT revision,retired_why FROM outcome_checks WHERE check_id='wake' ORDER BY revision"),
                         [(1, None), (2, "Measured another way now")])

    def test_only_the_owner_loosens_a_check_and_the_rule_says_who_set_it(self):
        self.committed(self.define(DURATION))
        for loosened in ({"tolerance": 0.3}, {"target_value": 25}, {"better": "higher"}, {"retired_why": "Not needed"}):
            with self.subTest(loosened=loosened):
                self.rejected(self.define(dict({"check_id": "duration"}, **loosened)), "OWNER_LOOSENS")
        self.committed(self.define({"check_id": "duration", "tolerance": 0.15}))
        self.committed(self.define({"check_id": "duration", "tolerance": 0.3}, actor="owner"))
        self.committed(self.define({"check_id": "duration", "explain": "From start to finish of the release check"}))
        rule = self.checks_view()["groups"][0]["checks"][0]["rule"]
        self.assertEqual((rule["tolerance"], rule["set_by"]), (0.3, "owner"), "explaining it does not take the rule from the owner")

    def test_a_machine_read_measure_needs_its_tolerance(self):
        self.rejected(self.define({k: v for k, v in DURATION.items() if k != "tolerance"}), "TOLERANCE_REQUIRED")
        self.committed(self.define(WAKE))

    def test_a_member_who_neither_owns_nor_coordinates_defines_nothing(self):
        self.rejected(self.define(UNITS, actor="agent-b"), "FORBIDDEN")


class ReadingsCase(TargetCase):
    def setUp(self):
        super().setUp()
        for check in (UNITS, DURATION, WAKE):
            self.committed(self.define(check))
        self.release(19, SHA_19, "2026-11-01T05:00:00-08:00")

    def check(self, check_id, actor="owner"):
        return next(check for group in self.checks_view(actor)["groups"] for check in group["checks"] if check["check_id"] == check_id)

    def report(self, readings, at="2026-11-02T05:00:00-08:00", **run):
        return self.command("check.report", {"run": dict({"started_at": at, "finished_at": at, "tools": {}}, **run), "readings": readings},
                            {"workspace_id": "w1"}, actor="agent-b")

    def test_a_reading_belongs_to_the_release_whose_record_names_its_commit(self):
        stopped = "e" * 40
        self.record_run(stopped, "2026-11-02T06:00:00-08:00", [passed()])
        self.record_run(SHA_NEW, "2026-11-03T05:00:00-08:00", [passed()])
        latest = self.check("units")["latest"]
        self.assertEqual((latest["label"], latest["release"], latest["candidate"]), ("Release 20 candidate", 20, True))
        self.release(20, SHA_NEW, "2026-11-04T05:00:00-08:00")
        readings = {item["commit"]: item for item in self.check("units")["readings"]}
        self.assertEqual([(readings[commit]["label"], readings[commit]["release"], readings[commit]["candidate"]) for commit in (SHA_NEW, stopped)],
                         [("Release 20", 20, False), ("Release 20 candidate", 20, True)],
                         "a candidate that never shipped stays a candidate of the release after the one live when it ran")

    def test_a_reported_reading_is_kept_once_and_a_machine_read_check_is_never_reported(self):
        first = self.committed(self.report([measured("wake", 8)]))
        self.assertTrue(first["recorded"])
        self.assertFalse(self.committed(self.report([measured("wake", 8)]))["recorded"], "the same run again is the stored one")
        self.rejected(self.report([dict(measured("wake", 8), words="eight")]), "RUN_EXISTS")
        self.rejected(self.report([passed()], at="2026-11-02T06:00:00-08:00"), "SOURCE_NOT_REPORTED")
        self.assertEqual(self.check("wake")["latest"]["value"], 8)

    def test_the_word_follows_the_statuses_once_the_target_has_words(self):
        self.record_run(SHA_19, "2026-11-01T05:00:00-08:00", [passed(), measured("duration", 17)])
        self.committed(self.report([measured("wake", 8)]))
        # Checks with no words yet: the word already follows the checks (the page: "Until it has checks, Theseus says nothing").
        self.assertEqual(self.checks_view()["word"], "not_on_target")
        self.committed(self.propose("Releases are quick and nothing slips."))
        view = self.checks_view()
        self.assertEqual(([check["status"] for group in view["groups"] for check in group["checks"]], view["word"]),
                         (["passing", "measured", "measured"], "not_on_target"))
        self.assertEqual([group["open"] for group in view["groups"]], [False, False])

    def test_an_ask_to_the_owner_about_a_check_waits_on_him_and_opens_its_group(self):
        self.committed(self.report([measured("wake", 8)]))
        self.post("Is 8 s good enough for the wake time?", addressees=["owner"], intent="ask", subjects=[{"kind": "check", "ref": "wake"}])
        self.assertEqual(self.check("wake")["status"], "waiting")
        self.assertEqual([group["open"] for group in self.checks_view()["groups"]], [False, True])
        self.post("Yes", actor="owner")
        self.assertEqual(self.check("wake")["status"], "measured", "his answer clears it")

    def test_a_members_report_at_the_live_commit_is_never_the_live_baseline(self):
        self.record_run(SHA_19, "2026-11-01T05:00:00-08:00", [passed(value=188)], tools=TOOLS)
        self.command("check.define", {"check": {"check_id": "seen", "group_name": "Checks", "position": 4, "name": "Seen", "kind": "pass",
                                                "source": "reported"}}, {"workspace_id": "w1"}, {"checks_revision": self.revision()}, actor="agent-a")
        self.committed(self.report([passed("seen", 1)], at="2026-11-01T06:00:00-08:00", commit_sha=SHA_19))
        live = self.store.view("agent-a", "outcome_live", {"workspace_id": "w1", "commit": SHA_NEW})
        self.assertEqual((live["live"]["commit"], live["readings"].get("units", {}).get("value")), (SHA_19, 188))
        self.assertNotIn("seen", live["readings"])


class WorseAndAcceptedCase(TargetCase):
    """D29, D31: a measure past its tolerance is worse; only the owner accepts it, only at that commit."""

    def setUp(self):
        super().setUp()
        for check in (UNITS, DURATION, REPLAY):
            self.committed(self.define(check))
        self.release(19, SHA_19, "2026-11-01T05:00:00-08:00")
        self.record_run(SHA_19, "2026-11-01T05:00:00-08:00", [passed(), measured("duration", 17), measured("replay", 3)], tools=TOOLS)
        base = {"commit": SHA_19, "started_at": "2026-11-03T04:00:00-08:00", "finished_at": "2026-11-03T04:00:00-08:00", "tools": TOOLS,
                "steps": [], "note": "rerun", "readings": [passed(), measured("duration", 17), measured("replay", 3)]}
        self.run_id = self.store.record_checks({"outcome": "w1", "commit": SHA_NEW, "started_at": "2026-11-03T05:00:00-08:00",
                                                "finished_at": "2026-11-03T05:00:00-08:00", "tools": TOOLS, "steps": [], "note": "",
                                                "readings": [passed(), measured("duration", 25), measured("replay", 3)], "base": base},
                                               "agent-a")["run_id"]

    def accept(self, check="duration", why="Worth it for the faster wakes", actor="owner"):
        return self.command("check.accept_worse", {"run_id": self.run_id, "why": why}, {"workspace_id": "w1", "check_id": check},
                            {"checks_revision": self.revision()}, actor=actor)

    def test_the_account_of_a_worse_check_is_a_message_on_the_record_never_a_whisper(self):
        # The loop shows the newest message about the check in its fix topic to the whole outcome (docs/whispers.md).
        base = {"commit": SHA_19, "started_at": "2026-11-04T04:00:00-08:00", "finished_at": "2026-11-04T04:00:00-08:00", "tools": TOOLS,
                "steps": [], "note": "rerun", "readings": [passed(), measured("duration", 17), measured("replay", 3)]}
        self.store.record_checks({"outcome": "w1", "commit": "4" * 40, "started_at": "2026-11-04T05:00:00-08:00", "finished_at": "2026-11-04T05:00:00-08:00",
                                  "tools": TOOLS, "steps": [], "note": "", "base": base,
                                  "readings": [passed(), dict(measured("duration", 25), fix_topic_id="t1"), measured("replay", 3)]}, "agent-a")
        said = self.post("The wake path now waits on a second read.", subjects=[{"kind": "check", "ref": "duration"}])
        self.post("Between us: I think it is the new index.", actor="owner", addressees=["agent-a"], whisper=True,
                  subjects=[{"kind": "check", "ref": "duration"}])
        for reader in ("agent-b", "owner"):
            account = self.checks_view(reader)["loop"]["candidate"]["account"]
            self.assertEqual((account or {}).get("message_id"), said, reader)

    def test_the_candidate_stops_on_a_worse_measure_until_the_owner_accepts_it(self):
        candidate = self.checks_view()["loop"]["candidate"]
        self.assertEqual((candidate["state"], [item["check_id"] for item in candidate["worse"]]), ("stopped", ["duration"]))
        self.assertTrue(candidate["you_accept"])
        self.assertFalse(self.checks_view("agent-a")["loop"]["candidate"]["you_accept"])
        self.rejected(self.accept(actor="agent-a"), "FORBIDDEN")
        self.rejected(self.accept(check="units"), "NOT_WORSE")
        self.rejected(self.accept(check="replay"), "NOT_WORSE")
        self.rejected(self.accept(why="  "), "WHY_REQUIRED")
        self.committed(self.accept())
        candidate = self.checks_view()["loop"]["candidate"]
        self.assertEqual(candidate["state"], "accepted")
        self.assertEqual(candidate["worse"][0]["accepted"]["why"], "Worth it for the faster wakes")
        # The target stays: no definition was written.
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_checks WHERE check_id='duration'"), [(1,)])

    def test_within_its_tolerance_a_slower_measure_is_not_worse(self):
        self.assertTrue(outcome_rules.slower_in_every_run([17], [21.25 + 0.01], 0.25, "lower"))
        self.assertFalse(outcome_rules.slower_in_every_run([17], [21.25], 0.25, "lower"), "equal to the bound is not worse")
        self.assertFalse(outcome_rules.slower_in_every_run([17], [20], 0.25, "lower"))


class ProblemsCase(TargetCase):
    """D39: a problem found before a check keeps who found it and when; it closes only on the mutant runner's proof."""

    def file(self, **args):
        return self.command("problem.file", dict({"what": "The New line jumped", "kind": "defect"}, **args), {"workspace_id": "w1"}, actor="agent-a")

    def test_filing_from_a_message_names_its_author_and_its_time(self):
        message = self.post("The New line jumped when I scrolled", actor="agent-b")
        problem = self.committed(self.file(message_id=message))["problem_id"]
        sent, = self.sql("SELECT sent_ms FROM messages WHERE id=?", (message,))
        self.assertEqual(self.sql("SELECT found_by,found_ms,message_id FROM found_problems WHERE id=?", (problem,)), [("agent-b", sent[0], message)])
        self.rejected(self.file(), "SOURCE_REQUIRED")
        self.rejected(self.file(message_id=message, note="both"), "SOURCE_REQUIRED")

    def test_a_whisper_is_never_where_a_problem_was_found(self):
        # The whole outcome reads its problems, with who found each and when (docs/whispers.md), so a whisper is refused
        # by its id and by its number, even to the agent in it; nothing is filed.
        whisper = self.post("Between us: the New line jumped", actor="owner", addressees=["agent-a"], whisper=True)
        seq, = self.sql("SELECT seq FROM messages WHERE id=?", (whisper,))[0]
        for source in (whisper, seq):
            self.rejected(self.file(message_id=source), "WHISPER_STAYS_PRIVATE")
        self.assertEqual(self.sql("SELECT count(*) FROM found_problems"), [(0,)])
        # The operator's import of problems found refuses a whisper by its number too, and imports nothing.
        said, = self.sql("SELECT seq FROM messages WHERE id=?", (self.post("The New line jumped on the record"),))[0]
        seed = lambda number: {"workspace_id": "w1", "problems": [{"what": "The New line jumped", "kind": "defect", "seq": number}]}
        with self.assertRaises(Refusal) as refused:
            self.store.import_checks(seed(seq), "agent-a")
        self.assertEqual((refused.exception.code, self.sql("SELECT count(*) FROM found_problems")), ("WHISPER_STAYS_PRIVATE", [(0,)]))
        self.assertTrue(self.store.import_checks(seed(said), "agent-a")["checks_imported"])
        self.assertEqual(self.sql("SELECT count(*) FROM found_problems"), [(1,)])

    def test_a_cover_closes_only_with_a_proof_naming_its_test(self):
        problem = self.committed(self.file(note="seen on the phone"))["problem_id"]

        def cover(**args):
            version, = self.sql("SELECT version FROM found_problems WHERE id=?", (problem,))[0]
            return self.command("problem.cover", dict({"words": "The New line check"}, **args), {"workspace_id": "w1", "problem_id": problem},
                                {"problem_revision": version}, actor="agent-a")
        good = {"test": "test_new_line_stays", "killed": True, "failed": "FAIL: test_new_line_stays", "control": "passed"}
        self.rejected(cover(proof=good, commit="a" * 40), "PROOF_REQUIRED")
        self.rejected(cover(test="test_new_line_stays", proof=dict(good, test="test_other"), commit="a" * 40), "PROOF_REQUIRED")
        self.rejected(cover(test="test_new_line_stays", proof=dict(good, control="failed"), commit="a" * 40), "PROOF_REQUIRED")
        self.rejected(cover(test="test_new_line_stays", proof=dict(good, failed="FAILED (errors=1)".replace("FAIL", "ERR")), commit="a" * 40),
                      "PROOF_REQUIRED")
        self.assertFalse(self.committed(cover(test="test_new_line_stays"))["closed"])
        self.assertTrue(self.committed(cover(proof=good, commit="a" * 40))["closed"])
        self.rejected(cover(), "PROBLEM_CLOSED")


class TopicTargetLineCase(TargetCase):
    """D10: a topic opens with its outcome's target, closed; an outcome to keep with nothing to say has none."""

    def line(self):
        answer = self.store.view("agent-b", "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return answer["outcome_target"]

    def test_the_line_follows_the_target_and_the_kind(self):
        self.assertIsNone(self.line())
        self.committed(self.propose("Every topic keeps its place."))
        self.assertIsNone(self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["word"], "words with no checks claim nothing")
        line = self.line()
        self.assertEqual((line["text"], line["word"], line["kind"], line["workspace_title"]), ("Every topic keeps its place.", None, "keep", "Isolated test"))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        self.assertEqual(self.line()["word"], "not_there")

    def test_an_outcome_to_reach_with_nothing_written_still_opens_with_not_there_yet(self):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        line = self.line() or {}
        self.assertEqual((line.get("word"), line.get("kind"), line.get("text")), ("not_there", "reach", None))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""The improvement loop's rules (item 104; docs/targets.md): what got worse at a
candidate against the live release (D16, D29, D31, D32), what loosens a check
(D30), the trade the owner accepts, the likely cause from trial runs (D34), a
step beside the live release's (D36), the check the live release left behind
(D40), and a tolerance in words."""

import unittest

from aim_next import outcome_rules
from aim_next.outcome_rules import (comparable, fraction_words, left_behind, likely_cause, loosens, regressions, step_compare, tools_changed,
                                    trade)


TOOLS = {"release-check": "t-1", "chrome": "142", "deploy": "d-1"}
UNITS = {"check_id": "units", "name": "Unit checks", "kind": "pass", "source": "release-check:units"}
NATIVE = {"check_id": "native", "name": "Page checks", "kind": "pass", "source": "release-check:native"}
DURATION = {"check_id": "duration", "name": "Release check time", "kind": "measure", "source": "release-check:duration",
            "better": "lower", "tolerance": 0.25, "target_value": 20, "unit": "min"}
WAKE = {"check_id": "wake", "name": "Wake replay", "kind": "measure", "source": "release-check:wake-replay", "better": "lower",
        "tolerance": 0.2, "repeats": 3, "unit": "s"}
REPORTED = {"check_id": "deck", "name": "Deck read-through", "kind": "pass", "source": "reported"}


def passed(count=None, tools=TOOLS):
    return {"result": "passed", "value": count, "detail": {"pass": count} if count is not None else {}, "tools": tools}


def failed(cases=()):
    return {"result": "failed", "value": None, "detail": {"failed": {"tests/x": list(cases)}}, "tools": TOOLS}


def measure(value, tools=TOOLS):
    return {"result": "measured", "value": value, "detail": {}, "tools": tools}


def members(tools=TOOLS, **series):
    return {"result": "measured", "value": None, "detail": {"series": {name: {"runs": runs} for name, runs in series.items()}}, "tools": tools}


def kinds(found):
    return [(item["check_id"], item["kind"], item.get("member")) for item in found]


class ComparingToolsCase(unittest.TestCase):
    def test_readings_compare_only_with_the_same_tools_the_deploys_own_version_aside(self):
        self.assertTrue(comparable(measure(1), measure(2, dict(TOOLS, deploy="d-2"))))
        self.assertFalse(comparable(measure(1), measure(2, dict(TOOLS, chrome="143"))))
        self.assertFalse(comparable(measure(1), measure(2, {"deploy": "d-1"})), "only the deploy's version is nothing to compare")
        self.assertFalse(comparable(None, measure(2)))
        self.assertFalse(comparable(measure(1, {}), measure(2, {})), "no tools known on either side is unknown, not the same")
        self.assertEqual(tools_changed({"chrome": "142", "node": "22"}, {"chrome": "143", "python": "3.9"}), ["chrome"])
        self.assertEqual(tools_changed(None, {"chrome": "143"}), [])


class RegressionsCase(unittest.TestCase):
    def test_a_passing_check_that_fails_or_passes_fewer_or_did_not_run_is_worse(self):
        base = {"units": passed(1000), "native": passed(120)}
        self.assertEqual(kinds(regressions([UNITS, NATIVE], base, {"units": failed(["test_a"]), "native": passed(119)})["worse"]),
                         [("units", "failed", None), ("native", "fewer", None)])
        self.assertEqual(regressions([UNITS], base, {"units": failed(["test_a"])})["worse"][0]["cases"], ["test_a"])
        self.assertEqual(kinds(regressions([UNITS], base, {})["worse"]), [("units", "fewer", None)])
        self.assertEqual(regressions([UNITS, NATIVE], base, {"units": passed(1001), "native": passed(120)})["worse"], [])
        self.assertEqual(regressions([UNITS], {}, {"units": failed()})["worse"], [], "a check the live release never ran compares with nothing")

    def test_a_reported_or_retired_check_is_never_compared(self):
        base, now = {"deck": passed(), "units": passed(5)}, {"deck": failed(), "units": failed()}
        self.assertEqual(regressions([REPORTED, dict(UNITS, retired_why="Moved")], base, now)["all"], [])

    def test_a_measure_compares_against_the_rerun_beside_the_candidate_with_the_same_tools(self):
        now = {"duration": measure(26)}
        self.assertEqual(kinds(regressions([DURATION], {}, now, rerun={"duration": measure(20)})["worse"]), [("duration", "failed", None)])
        self.assertEqual(regressions([DURATION], {}, {"duration": measure(15)}, rerun={"duration": measure(12)})["worse"], [],
                         "a quarter slower is the bound, not past it")
        self.assertEqual(kinds(regressions([DURATION], {}, {"duration": measure(15.1)}, rerun={"duration": measure(12)})["worse"]),
                         [("duration", "failed", None)])
        other = regressions([DURATION], {}, now, rerun={"duration": measure(20, dict(TOOLS, chrome="143"))})["worse"]
        self.assertEqual((kinds(other), other[0]["why"]), ([("duration", "fewer", None)], "not compared: measured with other tools than the live release's"))
        crossed = regressions([DURATION], {}, {"duration": measure(21)}, rerun={"duration": measure(19)})["worse"]
        self.assertEqual([(item["check_id"], item["kind"], item["why"]) for item in crossed],
                         [("duration", "failed", "outside its target, where it was inside")], "inside its tolerance, but past its target")
        self.assertEqual(kinds(regressions([DURATION], {"duration": measure(20)}, {})["worse"]), [("duration", "fewer", None)])

    def test_a_member_is_worse_only_when_every_run_is_and_too_few_runs_say_so(self):
        rerun = {"wake": members(chat=[10, 11, 10], page=[5, 5, 5])}
        found = regressions([WAKE], {}, {"wake": members(chat=[13.5, 14, 15], page=[5, 7, 5])}, rerun=rerun)
        self.assertEqual(kinds(found["worse"]), [("wake", "failed", "chat")], "one slow run of page is not worse in every run")
        self.assertEqual(found["worse"][0]["now"], 14)
        found = regressions([WAKE], {}, {"wake": members(chat=[13, 14], page=[5, 5, 5])}, rerun=rerun)
        self.assertEqual([(item["check_id"], item["kind"], item.get("member"), item["why"]) for item in found["worse"]],
                         [("wake", "fewer", "chat", "chat ran 2 of 3 times")])

    def test_an_allowance_covers_what_it_names_and_an_acceptance_only_its_own_commit(self):
        base, now = {"units": passed(1000)}, {"units": passed(990)}
        fewer = {"check_id": "units", "kind": "fewer", "allowed_count": 990, "allowed_by": "owner", "commit_sha": None}
        self.assertEqual(regressions([UNITS], base, now, [fewer])["worse"], [])
        self.assertEqual(kinds(regressions([UNITS], base, {"units": passed(989)}, [fewer])["worse"]), [("units", "fewer", None)])
        worse = {"check_id": "duration", "kind": "worse", "allowed_by": "owner", "commit_sha": "a" * 40, "allowed_count": None}
        rerun, slow = {"duration": measure(20)}, {"duration": measure(26)}
        accepted = regressions([DURATION], {}, slow, [worse], rerun=rerun, commit="a" * 40)
        self.assertEqual((accepted["worse"], accepted["all"][0]["accepted_by"]), ([], "owner"))
        self.assertEqual(kinds(regressions([DURATION], {}, slow, [worse], rerun=rerun, commit="b" * 40)["worse"]), [("duration", "failed", None)])


class LoosensCase(unittest.TestCase):
    def test_each_loosening_is_named_and_a_tightening_is_not(self):
        self.assertEqual(loosens(None, DURATION), [])
        self.assertEqual(loosens(DURATION, dict(DURATION, tolerance=0.2, target_value=18)), [])
        self.assertEqual(loosens(DURATION, dict(DURATION, tolerance=0.3)), ["tolerance"])
        self.assertEqual(loosens(DURATION, dict(DURATION, target_value=22)), ["target_value"])
        self.assertEqual(loosens(DURATION, dict(DURATION, target_value=None)), ["target_value"])
        self.assertEqual(loosens(dict(DURATION, better="higher"), dict(DURATION, better="higher", target_value=18)), ["target_value"])
        self.assertEqual(loosens(WAKE, dict(WAKE, repeats=2)), ["repeats"])
        self.assertEqual(loosens(DURATION, dict(DURATION, better="higher")), ["better"])
        self.assertEqual(loosens(DURATION, dict(DURATION, source="reported")), ["source"])
        self.assertEqual(loosens(UNITS, dict(UNITS, retired_why="Moved")), ["retired"])


class TradeAndCauseCase(unittest.TestCase):
    def test_the_trade_names_what_got_worse_and_what_got_better_past_its_own_tolerance(self):
        base = {"duration": measure(20), "wake": members(chat=[10, 10, 10], page=[5, 5, 5])}
        now = {"duration": measure(26), "wake": members(chat=[7, 7.5, 7], page=[4.5, 4.5, 4.5])}
        found = trade([UNITS, DURATION, WAKE], base, now)
        self.assertEqual([(item["check_id"], item["member"]) for item in found["worse"]], [("duration", None)])
        self.assertEqual([(item["check_id"], item["member"], item["now"], item["base"]) for item in found["better"]], [("wake", "chat", 7, 10)],
                         "page moved by a tenth, inside its fifth")

    def test_the_likely_cause_is_the_smallest_trial_that_clears_every_stopped_check(self):
        trials = [{"without": [3, 4], "run_id": "r1", "worse_checks": []},
                  {"without": [4], "run_id": "r2", "worse_checks": ["duration"]},
                  {"without": [5], "run_id": "r3", "worse_checks": ["wake"]},
                  {"without": [6], "run_id": "r4", "worse_checks": []}]
        self.assertEqual(likely_cause(["duration"], trials), {"items": [5], "run_id": "r3"}, "fewest left out, earliest of a tie")
        self.assertEqual(likely_cause(["duration", "wake"], trials), {"items": [6], "run_id": "r4"})
        self.assertEqual(likely_cause(["duration"], trials[1:2]), {"none": True, "tried": [[4]]})
        self.assertIsNone(likely_cause(["duration"], []))


class StepsAndLeftBehindCase(unittest.TestCase):
    def test_a_step_beside_the_live_release(self):
        self.assertEqual(step_compare({"pass": 10}, {"pass": 12}), "more")
        self.assertEqual(step_compare({"pass": 10}, {"pass": 9}), "fewer")
        self.assertEqual(step_compare({"pass": 10}, {"pass": 10}), "same")
        self.assertEqual(step_compare({"pass": 10}, {"pass": 12, "passed": False}), "failed")
        self.assertEqual(step_compare(None, {"pass": 3}), "new")
        self.assertIsNone(step_compare({"pass": 3}, None))

    def test_the_first_pass_check_whose_cases_grew_is_the_one_left_behind(self):
        live = {"units": passed(1000), "native": passed(130), "duration": measure(30)}
        before = {"units": passed(1000), "native": passed(120), "duration": measure(20)}
        self.assertEqual(left_behind([DURATION, UNITS, NATIVE], live, before), {"check_id": "native", "name": "Page checks", "now": 130, "before": 120})
        self.assertIsNone(left_behind([UNITS, NATIVE], before, before))
        self.assertIsNone(left_behind([UNITS], live, {}))

    def test_a_tolerance_is_said_in_words(self):
        self.assertEqual([fraction_words(value) for value in (0.25, 0.2, 0.1, 0.3, 0.15)],
                         ["a quarter", "a fifth", "a tenth", "3 tenths", "15 hundredths"])
        self.assertEqual(outcome_rules.rounds_of(True), "releases")
        self.assertEqual(outcome_rules.rounds_of(False), "runs")


if __name__ == "__main__":
    unittest.main()

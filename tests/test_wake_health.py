from __future__ import annotations

"""An agent that stops picking up its wakes (pipeline item 34).

Wakes stop repeating after three go unanswered, nothing waiting is dropped,
anything the agent does wakes it again at once, and the wakes view says who is
not answering, how much waits for them and since when; or, while no runner is
sending wakes, that wakes are paused rather than that every agent is silent.
"""

import unittest

from aim_next.wake_health import PARKED_AFTER
import test_hosted_schedule as hosted_tests
import test_runner as runner_tests
from test_wake_contract import HostedFixture, own_cases


@own_cases
class Fixture(runner_tests.RunnerCase):
    def setUp(self):
        super().setUp()
        self.runner_guard = self.guard()
        self.runner = self.token(self.runner_guard)

    def fresh_lease(self):
        if self.store.renew_runner(self.runner_guard, self.runner)["status"] != "renewed":
            self.runner = self.token(self.runner_guard)

    def claims(self):
        self.fresh_lease()
        result = self.store.claim_wakes(self.runner_guard, self.runner, ["agent-a"])
        self.assertEqual(result["status"], "ok", result)
        return result["claims"]

    def settle(self, outcome="accepted"):
        claims = self.claims()
        self.assertEqual(len(claims), 1, claims)
        result = self.store.finish_wake(self.runner_guard, self.runner, claims[0]["claim_token"], outcome)
        self.assertEqual(result["status"], "settled", result)
        return result

    def unanswered(self):
        return self.sql("SELECT unanswered_wakes,unanswered_since_ms FROM recipient_schedule WHERE recipient_id='agent-a'")[0]

    def wakes(self, actor="owner"):
        self.fresh_lease()
        view = self.store.view(actor, "wakes", {})
        self.assertNotIn("error", view, view)
        return view

    def park(self):
        """Three notices a minute apart, none answered."""
        first = self.now
        for _ in range(PARKED_AFTER):
            self.settle()
            self.now += 60000
        return first

    def reply(self, body="On it"):
        result = self.command("message.post", {"body": body}, target={"topic_id": "t1"}, actor="agent-a")
        self.assertEqual(result["status"], "committed", result)


@own_cases
class ParkingCase(Fixture):
    def test_three_unanswered_wakes_stop_the_repeats_and_drop_nothing(self):
        first = self.park()
        self.assertEqual(self.unanswered(), (PARKED_AFTER, first))
        self.assertEqual(self.claims(), [])
        self.now += 3600000
        self.assertEqual(self.claims(), [])
        self.assertEqual(self.store.runner_schedule(["agent-a"])["next_due_ms"], None)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-a' AND state='pending'"), [(1,)])
        self.assertEqual(self.wakes()["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}])

    def test_new_work_for_a_parked_agent_waits_with_the_rest(self):
        self.park()
        self.send_next("More while it is silent")
        self.assertEqual(self.claims(), [])
        self.assertEqual(self.wakes()["quiet"][0]["waiting"], 2)

    def test_anything_the_agent_does_wakes_it_again_at_once(self):
        self.park()
        self.reply()
        self.assertEqual(self.unanswered(), (0, None))
        self.assertEqual(self.wakes()["quiet"], [])
        again = self.claims()
        self.assertEqual(len(again), 1)

    def test_an_answer_before_parking_starts_the_count_again(self):
        self.send_next()
        self.settle()
        self.now += 60000
        self.settle()
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.unanswered(), (0, None))
        self.now += 60000
        for _ in range(PARKED_AFTER - 1):
            self.settle()
            self.now += 60000
        self.assertEqual(len(self.claims()), 1)

    def test_an_answer_from_someone_else_does_not_count(self):
        self.park()
        self.command("message.post", {"body": "Anyone?"}, target={"topic_id": "t1"})
        self.assertEqual(self.unanswered()[0], PARKED_AFTER + 0)
        self.assertEqual(self.claims(), [])

    def test_wakes_that_did_not_reach_the_agent_are_not_counted(self):
        for outcome in ("busy", "error", "unavailable", "busy", "error"):
            self.settle(outcome)
            self.now = self.sql("SELECT next_due_ms FROM recipient_schedule WHERE recipient_id='agent-a'")[0][0]
        self.assertEqual(self.unanswered(), (0, None))
        self.assertEqual(len(self.claims()), 1)

    def test_nothing_left_waiting_clears_the_count(self):
        self.settle()
        self.now += 60000
        self.settle()
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.assertEqual(self.unanswered(), (0, None))

    def test_an_agent_answering_is_never_listed(self):
        self.settle()
        self.assertEqual(self.wakes(), {"instance_id": "test-instance", "runner": {"live": True}, "quiet": []})


@own_cases
class HostedParkingCase(HostedFixture):
    def test_a_turn_started_counts_once_and_steers_into_it_do_not(self):
        start = self.claim_now()
        self.hand(start)
        for body in ("B", "C", "D"):
            self.send_next(body)
            self.hand(self.claim_now(), mode="steer")
        self.assertEqual(self.sql("SELECT unanswered_wakes FROM recipient_schedule WHERE recipient_id='agent-a'"), [(1,)])

    def test_a_turn_that_failed_never_reached_the_agent_and_is_not_counted(self):
        for index in range(PARKED_AFTER + 1):
            claim = self.claim_now()
            self.hand(claim, turn_id="turn-%d" % index)
            self.end("failed", turn_id="turn-%d" % index, error_code="usageLimitExceeded")
            self.now = self.schedule()["next_due_ms"]
        self.assertEqual(self.sql("SELECT unanswered_wakes,unanswered_since_ms FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0, None)])
        self.assertIsNotNone(self.claim_now())

    def test_a_parked_hosted_agent_that_acts_is_told_everything_again(self):
        for index in range(PARKED_AFTER):
            claim = self.claim_now()
            self.hand(claim, turn_id="turn-%d" % index)
            self.end("completed", turn_id="turn-%d" % index)
            self.now = self.schedule()["next_due_ms"]
        self.nothing_due()
        self.command("message.post", {"body": "Back"}, target={"topic_id": "t1"}, actor="agent-a")
        self.assertEqual(self.schedule()["handed_seq"], None)
        self.assertEqual(self.schedule()["next_due_ms"], self.now)

    def test_an_agent_acting_in_the_turn_that_holds_its_work_gets_no_extra_wake(self):
        for index in range(PARKED_AFTER):
            claim = self.claim_now()
            self.hand(claim, turn_id="turn-%d" % index)
            if index < PARKED_AFTER - 1:
                self.end("completed", turn_id="turn-%d" % index)
                self.now = self.schedule()["next_due_ms"]
        # The third turn runs and holds the work; the agent posts from it.
        self.command("message.post", {"body": "Working"}, target={"topic_id": "t1"}, actor="agent-a")
        self.assertEqual(self.sql("SELECT unanswered_wakes FROM recipient_schedule WHERE recipient_id='agent-a'"), [(0,)])
        self.assertEqual((self.schedule()["handed_seq"], self.schedule()["next_due_ms"]), (claim["captured_seq"], None))


@own_cases
class PausedWakesCase(hosted_tests.HostedCase):
    """agent-a has a route pin here; agent-b has none."""

    def test_while_no_runner_sends_wakes_every_routed_agent_with_work_says_wakes_paused(self):
        self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"})
        self.send_next("For both")
        self.now += 31000
        view = self.store.view("owner", "wakes", {})
        self.assertFalse(view["runner"]["live"])
        self.assertEqual(view["quiet"], [{"actor_id": "agent-a", "waiting": 2, "why": "wakes_paused"}])
        # A live runner: nobody is blamed while they are being woken.
        self.runner = self.token(self.hosting)
        self.assertEqual(self.store.view("owner", "wakes", {})["quiet"], [])


if __name__ == "__main__":
    unittest.main()

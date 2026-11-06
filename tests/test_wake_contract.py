from __future__ import annotations

"""The contract any change to wakes must keep (pipeline item 37).

aim-ux and aim-core set it: a delivery handled during a turn makes no empty
follow-up, a delivery that arrives after the turn's last read still wakes the
agent, and pending work always comes back to a wake however the turn or the
runner ended. Each case traces pending delivery -> what quiets it -> what ends
the quiet -> the next wake, in Core, with Core's own clock.

The broker path (a queued hint, settled `accepted`) and the hosted path (a
turn Theseus runs, settled `handed`) are traced separately: only the hosted
path knows when a turn ends, so only it can tell "handled during the turn"
from "never read". On the broker path a hint queued while a turn runs is
consumed after it, even if the turn handled its delivery: Core cannot see the
turn, so that empty turn is counted rather than prevented (option C in the
evaluation record), and the cases here hold what Core can know.

The integration cases the wake plan lists keep their own guards:
- a lost acceptance reply retries the same work unacknowledged:
  test_effects_runner, test_lost_acceptance_result_can_retry_same_work_without_ack;
- 500 pending deliveries are one claim and stay pending:
  test_runner_bounds, test_five_hundred_deliveries_are_one_recipient_claim;
- a sleep's catch-up is bounded per claim:
  test_runner_bounds, test_sleep_catchup_is_bounded_by_recipient_limit;
- an already-queued hint is not queued twice:
  test_codex_broker, test_queued_match_coalesces_across_generation_and_attempt;
- the queue is read at most two pages before one add:
  test_codex_broker, test_valid_incomplete_scan_stops_after_two_pages_then_adds_once;
- a stale in-progress turn is not trusted unless its thread is active:
  test_codex_host, test_a_turn_left_open_by_a_dead_runner_is_settled_lost_on_restart;
- a failed, lost or dropped turn hands its work back:
  test_hosted_schedule, test_a_dropped_steer_re_arms_and_a_seen_steer_does_not.
"""

import unittest

import test_hosted_schedule as hosted_tests
import test_runner as runner_tests


def own_cases(cls):
    """Run only the cases this file defines, not the fixture classes' own again."""
    for name in dir(cls):
        if name.startswith("test") and not any(name in vars(klass) for klass in cls.__mro__ if klass.__module__ == __name__):
            setattr(cls, name, None)
    return cls


@own_cases
class HostedFixture(hosted_tests.HostedCase):
    def claim_now(self):
        self.fresh_lease()
        return self.claim(self.hosting, self.runner)

    def fresh_lease(self):
        """Renew the singleton, or take it again if Core's clock moved past its lease."""
        if self.store.renew_runner(self.hosting, self.runner)["status"] != "renewed":
            self.runner = self.token(self.hosting)

    def claims_now(self):
        self.fresh_lease()
        result = self.store.claim_wakes(self.hosting, self.runner, ["agent-a"])
        self.assertEqual(result["status"], "ok", result)
        return result["claims"]


@own_cases
class HostedMidTurnCase(HostedFixture):
    """A turn holds the work up to its notice; what arrives while it runs."""

    def test_a_delivery_handled_during_the_turn_makes_no_follow_up(self):
        claim = self.claim_now()
        self.hand(claim)
        self.now += 1000
        self.send_next("Also give the total")
        newer = self.pending()["items"][-1]
        self.assertEqual(self.schedule()["next_due_ms"], self.now)
        # The running turn reads its inbox, sees the new message and acknowledges it.
        self.ack(newer["id"])
        self.assertEqual(self.schedule()["next_due_ms"], None)
        self.nothing_due()

    def test_a_delivery_handled_while_its_notice_was_being_handed_makes_no_follow_up(self):
        first = self.claim_now()
        self.hand(first)
        self.send_next("B")
        second = self.claim_now()
        self.send_next("C while B is being handed")
        latest = self.pending()["items"][-1]
        self.ack(latest["id"])
        # The turn took B and had already handled C: nothing is newer than what it holds.
        self.assertIsNone(self.hand(second, mode="steer")["next_due_ms"])
        self.nothing_due()

    def test_a_delivery_after_the_turns_last_read_still_wakes_it(self):
        claim = self.claim_now()
        self.hand(claim)
        self.send_next("B")
        b = self.pending()["items"][-1]
        self.send_next("C, after the turn's last read")
        self.ack(b["id"])
        # C is still pending above what the turn holds, so it stays due now.
        self.assertEqual(self.schedule()["next_due_ms"], self.now)
        follow = self.claim_now()
        self.assertGreater(follow["captured_seq"], claim["captured_seq"])


@own_cases
class HostedTurnEndCase(HostedFixture):
    """What a turn's end does with work it was handed and left pending."""

    def test_a_turn_that_read_one_page_and_completed_is_woken_again_for_the_rest(self):
        for _ in range(3):
            self.send_next()
        claim = self.claim_now()
        self.hand(claim)
        # The turn reads one page, acknowledges what it read, and completes.
        first = self.pending(limit=2)["items"]
        for item in first:
            self.ack(item["id"])
        ended = self.end("completed")
        self.assertTrue(ended["rearmed"], ended)
        self.assertEqual(self.schedule(), {"next_due_ms": self.now + 60000, "retry_count": 0, "handed_seq": None, "pending_count": 2})
        self.now += 59999
        self.assertEqual(self.claims_now(), [])
        self.now += 1
        again = self.claim_now()
        # Nothing is held any more: the notice names every pending delivery again.
        self.assertIsNone(again["handed_seq"])

    def test_a_turn_that_completed_with_newer_work_pending_keeps_it_due_now(self):
        claim = self.claim_now()
        self.hand(claim)
        self.send_next("B, after the turn's last read")
        self.now += 5000
        self.end("completed")
        # B was due when it arrived; the turn's end does not push it back a minute.
        self.assertEqual(self.schedule()["next_due_ms"], self.now - 5000)

    def test_a_turn_that_completed_with_everything_acknowledged_leaves_nothing_due(self):
        claim = self.claim_now()
        self.hand(claim)
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.assertFalse(self.end("completed")["rearmed"])
        self.nothing_due()


@own_cases
class BrokerContractCase(runner_tests.RunnerCase):
    """The broker path: a hint is queued and settled accepted; only the agent's acknowledgment settles work.

    agent-a holds the topic's opening delivery from setUp.
    """

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

    def accepted(self):
        claims = self.claims()
        self.assertEqual(len(claims), 1, claims)
        result = self.store.finish_wake(self.runner_guard, self.runner, claims[0]["claim_token"], "accepted")
        self.assertEqual(result["status"], "settled", result)
        return claims[0]

    def due(self):
        return self.sql("SELECT next_due_ms FROM recipient_schedule WHERE recipient_id='agent-a'")[0][0]

    def ack_all(self):
        for item in self.pending()["items"]:
            self.ack(item["id"])

    def test_an_unanswered_notice_is_repeated_once_a_minute_and_never_sooner(self):
        # Duplicate hints: the same work is not claimed again while its notice may still be read.
        first = self.accepted()
        self.now += 59999
        self.assertEqual(self.claims(), [])
        self.now += 1
        again = self.accepted()
        self.assertEqual(again["captured_seq"], first["captured_seq"])

    def test_reading_the_inbox_without_acknowledging_is_not_an_answer(self):
        # Crash after read: the agent read its deliveries, then died before acknowledging them.
        self.accepted()
        before = self.due()
        self.assertEqual(len(self.pending()["items"]), 1)
        self.assertEqual(self.due(), before)
        self.now += 60000
        self.assertEqual(len(self.claims()), 1)

    def test_a_turn_that_read_one_page_is_woken_again_for_the_rest(self):
        for _ in range(4):
            self.send_next()
        self.accepted()
        for item in self.pending(limit=2)["items"]:
            self.ack(item["id"])
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='agent-a'"), [(3,)])
        self.now += 60000
        self.assertEqual(len(self.claims()), 1)

    def test_a_delivery_arriving_while_older_work_is_unread_makes_no_new_notice(self):
        # The agent is mid-turn on the first delivery; the second arrives and is handled in the same turn.
        self.accepted()
        self.now += 1000
        self.send_next("While the first is being read")
        self.assertEqual(self.claims(), [])
        self.ack_all()
        self.assertIsNone(self.due())
        self.now += 3600000
        self.assertEqual(self.claims(), [])

    def test_a_delivery_after_everything_was_acknowledged_wakes_at_once(self):
        # A new delivery after the turn's last read: the turn may be ending, so it is named now.
        self.accepted()
        self.ack_all()
        self.now += 1000
        self.send_next("After the last read")
        self.assertEqual(self.due(), self.now)
        self.assertEqual(len(self.claims()), 1)

    def test_newer_work_is_named_at_once_when_the_notified_work_is_acknowledged(self):
        self.accepted()
        self.send_next("Newer")
        self.assertEqual(self.claims(), [])
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.due(), self.now)
        later = self.claims()
        self.assertEqual(len(later), 1)

    def test_a_claim_whose_runner_died_is_claimed_again_after_its_lease(self):
        claims = self.claims()
        self.assertEqual(len(claims), 1)
        # The runner dies before it settles: its claim lease ends and the work is claimed again.
        self.now += 20000
        again = self.claims()
        self.assertEqual(len(again), 1)
        self.assertEqual(again[0]["captured_seq"], claims[0]["captured_seq"])
        self.assertEqual(self.sql("SELECT r.outcome FROM wake_results r JOIN wake_attempts a ON a.id=r.attempt_id WHERE a.claim_token=?",
                                  (claims[0]["claim_token"],)), [("expired",)])


if __name__ == "__main__":
    unittest.main()

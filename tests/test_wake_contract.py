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
from "never read".
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


if __name__ == "__main__":
    unittest.main()

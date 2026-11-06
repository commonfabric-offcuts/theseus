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
class HostedMidTurnCase(hosted_tests.HostedCase):
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


if __name__ == "__main__":
    unittest.main()

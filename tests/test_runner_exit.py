from __future__ import annotations

"""Noticing when the agent runner stops (pipeline item 35), in Core.

A runner that stops cleanly records it and frees its lease; a supervisor that
saw its runner exit records how, for exactly that process; and the wakes view
tells an outcome's owner, from those facts, that wakes are not going out while
work waits for a routed agent.
"""

import os
import unittest

from aim_next.runner import RunnerError
import test_hosted_schedule as hosted_tests
from test_wake_contract import own_cases


@own_cases
class RunnerExitCase(hosted_tests.HostedCase):
    """agent-a is routed here (a hosted pin) and has the topic's opening waiting; the owner owns its outcome."""

    def state(self):
        return dict(zip(("state", "reason_code", "lease_until_ms", "ended_ms"),
                        self.sql("SELECT state,reason_code,lease_until_ms,ended_ms FROM runner_state")[0]))

    def wakes(self, actor="owner"):
        view = self.store.view(actor, "wakes", {})
        self.assertNotIn("error", view, view)
        return view

    def test_a_clean_stop_is_recorded_and_frees_the_lease_at_once(self):
        self.now += 5000
        result = self.store.stop_runner(self.hosting, self.runner)
        self.assertEqual(result["status"], "stopped", result)
        self.assertEqual(self.state(), {"state": "stopped", "reason_code": None, "lease_until_ms": self.now, "ended_ms": self.now})
        # The next runner takes over at once rather than waiting out a lease no one holds.
        self.hosting.close()
        successor = self.guard("successor")
        self.assertEqual(self.store.acquire_runner(successor)["status"], "acquired")
        self.assertEqual(self.state()["ended_ms"], None)

    def test_a_stale_token_cannot_record_a_stop(self):
        before = self.state()
        self.assertEqual(self.store.stop_runner(self.hosting, "r-not-mine")["status"], "lost")
        self.assertEqual(self.state(), before)

    def test_an_exit_is_recorded_only_for_the_process_that_holds_the_runner(self):
        holder = os.getpid()
        before = self.state()
        self.assertEqual(self.store.record_runner_exit(holder + 1, 1)["status"], "not_holder")
        self.assertEqual(self.state(), before)
        self.now += 7000
        recorded = self.store.record_runner_exit(holder, -9)
        self.assertEqual(recorded["status"], "recorded", recorded)
        self.assertEqual(self.state(), {"state": "exited", "reason_code": "killed", "lease_until_ms": self.now, "ended_ms": self.now})
        self.assertEqual(self.store.record_runner_exit(holder, -9)["status"], "not_holder")
        with self.assertRaises(RunnerError):
            self.store.record_runner_exit(holder, "9")

    def test_each_exit_is_named_by_how_it_ended(self):
        for code, reason in ((75, "lease_lost"), (-9, "killed"), (1, "failed"), (0, "stopped_unrecorded")):
            with self.subTest(code=code):
                self.store.renew_runner(self.hosting, self.runner)
                self.assertEqual(self.store.record_runner_exit(os.getpid(), code)["status"], "recorded")
                self.assertEqual(self.state()["reason_code"], reason)
                self.runner = self.token(self.hosting)

    def test_a_paused_runner_that_exits_stays_paused(self):
        self.store.pause_runner(self.hosting, self.runner, "operator_pause")
        before = self.state()
        self.assertEqual(self.store.record_runner_exit(os.getpid(), 2)["status"], "not_holder")
        self.assertEqual(self.state(), before)

    def test_the_owner_is_told_wakes_are_not_going_out_while_work_waits(self):
        self.assertEqual(self.wakes()["runner"], {"live": True})
        self.assertNotIn("notice", self.wakes())
        self.now += 2000
        self.store.record_runner_exit(os.getpid(), -9)
        view = self.wakes()
        self.assertEqual(view["runner"], {"live": False, "state": "exited", "reason": "killed", "since_ms": self.now})
        self.assertEqual(view["notice"], {"waiting_agents": 1})
        # Someone who owns no outcome is not told.
        self.assertNotIn("notice", self.wakes("agent-b"))

    def test_a_runner_that_stopped_renewing_is_said_to_have_stopped_when_its_lease_ended(self):
        lease = self.state()["lease_until_ms"]
        self.now = lease
        view = self.wakes()
        self.assertEqual(view["runner"], {"live": False, "state": "unrenewed", "since_ms": lease})
        self.assertEqual(view["notice"], {"waiting_agents": 1})

    def test_no_notice_while_nothing_waits_for_a_routed_agent(self):
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.store.stop_runner(self.hosting, self.runner)
        view = self.wakes()
        self.assertEqual(view["runner"]["live"], False)
        self.assertNotIn("notice", view)

    def test_a_paused_runner_says_why(self):
        self.store.pause_runner(self.hosting, self.runner, "cleanup_failed")
        self.assertEqual(self.wakes()["runner"], {"live": False, "state": "paused", "reason": "cleanup_failed"})


if __name__ == "__main__":
    unittest.main()

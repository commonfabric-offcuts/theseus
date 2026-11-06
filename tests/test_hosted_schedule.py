from __future__ import annotations

from pathlib import Path
import sqlite3
import unittest

from aim_next import StoreError, hosted_notice
from aim_next.runner import RunnerError
import test_runner as runner_tests


THREAD = "12345678-1234-4234-8234-123456789abc"
OTHER_THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class HostedCase(runner_tests.RunnerCase):
    """agent-a is a hosted agent pinned to THREAD; the owner posts in its topic."""

    def setUp(self):
        super().setUp()
        self.home = Path(self.temp.name).resolve() / "codex-home"
        self.home.mkdir()
        self.hosting = self.guard()
        self.pin_route(self.hosting, "codex-hosted-stdio", THREAD)
        self.runner = self.token(self.hosting)

    def pin_route(self, guard, kind, thread, actor="agent-a"):
        result = self.store.provision_route_pin(guard, actor, {"kind": kind, "protocol_version": 1,
                                                               "codex_home": str(self.home), "thread_id": thread})
        self.assertEqual(result["status"], "provisioned", result)

    def schedule(self, actor="agent-a"):
        return dict(zip(("next_due_ms", "retry_count", "handed_seq", "pending_count"), self.sql(
            "SELECT next_due_ms,retry_count,handed_seq,pending_count FROM recipient_schedule WHERE recipient_id=?", (actor,))[0]))

    def claim_now(self):
        self.store.renew_runner(self.hosting, self.runner)
        return self.claim(self.hosting, self.runner)

    def turn(self, claim, turn_id="turn-1", mode="start", **changes):
        return dict({"thread_id": THREAD, "turn_id": turn_id, "mode": mode,
                     "client_id": "theseus:" + claim["attempt_id"], "announced_seq": claim["captured_seq"]}, **changes)

    def hand(self, claim, turn_id="turn-1", mode="start"):
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", turn=self.turn(claim, turn_id, mode))
        self.assertEqual((result["status"], result["wake_status"]), ("settled", "handed"), result)
        return result

    def end(self, status, turn_id="turn-1", **args):
        return self.store.end_hosted_turn(self.hosting, self.runner, THREAD, turn_id, status, **args)

    def nothing_due(self, later_ms=3600 * 1000):
        """No claim is due now, nor an hour from now."""
        self.now += later_ms
        if self.store.renew_runner(self.hosting, self.runner)["status"] != "renewed":
            self.runner = self.token(self.hosting)
        result = self.store.claim_wakes(self.hosting, self.runner, ["agent-a"])
        self.assertEqual((result["status"], result["claims"]), ("ok", []))
        self.assertIsNone(self.store.runner_schedule(["agent-a"])["next_due_ms"])

    def unchanged(self):
        db = sqlite3.connect(str(self.path))
        try:
            return list(db.iterdump())
        finally:
            db.close()

    # Design §11 step 2 ----------------------------------------------------

    def test_a_new_delivery_after_handing_is_due_now(self):
        claim = self.claim_now()
        result = self.hand(claim)
        self.assertEqual((result["next_due_ms"], result["handed_seq"]), (None, claim["captured_seq"]))
        self.assertEqual(self.schedule()["handed_seq"], claim["captured_seq"])
        self.nothing_due(0)
        self.now += 5000
        self.send_next("Also give the total")
        self.assertEqual(self.schedule()["next_due_ms"], self.now)
        follow = self.claim_now()
        self.assertGreater(follow["captured_seq"], claim["captured_seq"])
        steered = self.hand(follow, mode="steer")
        self.assertEqual(steered["handed_seq"], follow["captured_seq"])
        self.assertEqual(self.sql("SELECT mode FROM hosted_turns ORDER BY handed_ms,attempt_id"), [("start",), ("steer",)])

    def test_a_delivery_arriving_during_a_live_claim_is_due_at_the_claim_end(self):
        first = self.claim_now()
        self.hand(first)
        self.send_next("B")
        second = self.claim_now()
        self.send_next("C while B is being handed")
        self.assertEqual(self.schedule()["next_due_ms"], second["lease_until_ms"])
        # Settling B as handed sees that C arrived after its claim: due now, not quiet.
        self.assertEqual(self.hand(second, mode="steer")["next_due_ms"], self.now)

    def test_a_completed_turn_with_unacked_deliveries_is_named_again_after_a_minute(self):
        for _ in range(2):
            self.send_next()
        claim = self.claim_now()
        self.hand(claim)
        # The agent acknowledges one of three and leaves two unacked.
        self.ack(self.pending()["items"][0]["id"])
        ended = self.end("completed", usage={"input_tokens": 10, "output_tokens": 3})
        self.assertEqual((ended["status"], ended["rearmed"], ended["unseen"]), ("ended", True, False))
        self.assertEqual(self.schedule(), {"next_due_ms": self.now + 60000, "retry_count": 0, "handed_seq": None, "pending_count": 2})
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(1,)])

    def test_a_failed_turn_is_re_due_with_backoff_that_grows_until_a_clean_turn(self):
        for attempt, seconds in enumerate((1, 2, 4, 8)):
            claim = self.claim_now()
            self.hand(claim, turn_id="turn-%s" % attempt)
            ended = self.end("failed", turn_id="turn-%s" % attempt, error_code="usageLimitExceeded")
            self.assertTrue(ended["rearmed"], ended)
            self.assertEqual(self.schedule(), {"next_due_ms": self.now + seconds * 1000, "retry_count": attempt + 1,
                                               "handed_seq": None, "pending_count": 1})
            self.now += seconds * 1000 - 1
            early = self.store.claim_wakes(self.hosting, self.runner, ["agent-a"])
            self.assertEqual((early["status"], early["claims"]), ("ok", []))
            self.now += 1
        claim = self.claim_now()
        self.hand(claim, turn_id="turn-clean")
        for item in self.pending()["items"]:
            self.ack(item["id"])
        self.assertFalse(self.end("completed", turn_id="turn-clean")["rearmed"])
        self.assertEqual(self.schedule()["retry_count"], 0)
        self.assertEqual(self.sql("SELECT final_status,error_code FROM hosted_turns ORDER BY handed_ms"),
                         [("failed", "usageLimitExceeded")] * 4 + [("completed", None)])

    def test_interrupted_and_lost_turns_re_arm(self):
        for index, status in enumerate(("interrupted", "lost")):
            with self.subTest(status=status):
                claim = self.claim_now()
                self.hand(claim, turn_id="turn-%s" % index)
                self.assertTrue(self.end(status, turn_id="turn-%s" % index)["rearmed"])
                self.assertIsNone(self.schedule()["handed_seq"])
                self.now = self.schedule()["next_due_ms"]

    def test_a_dropped_steer_re_arms_and_a_seen_steer_does_not(self):
        for seen in (False, True):
            with self.subTest(seen=seen):
                turn_id = "turn-seen" if seen else "turn-dropped"
                start = self.claim_now()
                self.hand(start, turn_id=turn_id)
                self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + start["attempt_id"])["status"], "recorded")
                self.send_next("Steered in")
                steer = self.claim_now()
                self.hand(steer, turn_id=turn_id, mode="steer")
                if seen:
                    self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + steer["attempt_id"])["status"], "recorded")
                    # The turn read and handled everything it was told of.
                    for item in self.pending()["items"]:
                        self.ack(item["id"])
                ended = self.end("completed", turn_id=turn_id)
                self.assertEqual((ended["rows"], ended["unseen"], ended["rearmed"]), (2, not seen, not seen))
                self.assertEqual(self.schedule()["handed_seq"], None)
                if seen:
                    self.nothing_due()
                else:
                    self.assertEqual(self.schedule()["next_due_ms"], self.now + 1000)
                    self.now += 1000

    def test_an_unseen_start_row_alone_does_not_re_arm(self):
        self.hand(self.claim_now())
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.end("completed"), {"status": "ended", "final_status": "completed", "rows": 1,
                                                 "unseen": False, "rearmed": False, "instance_id": "test-instance"})
        self.nothing_due()

    def test_a_failed_turn_with_nothing_pending_at_or_below_handed_seq_does_not_re_arm(self):
        claim = self.claim_now()
        self.hand(claim)
        self.send_next("Newer")
        self.ack(self.pending()["items"][0]["id"])
        before = self.schedule()
        self.assertEqual(before["next_due_ms"], self.now)
        self.now += 10
        self.assertFalse(self.end("failed")["rearmed"])
        self.assertEqual(self.schedule(), before)

    def test_a_turn_failing_under_a_live_claim_hands_nothing_so_its_work_is_named_again(self):
        self.hand(self.claim_now())
        self.send_next("Follow-up")
        live = self.claim_now()
        # The live claim's notice starts from the handed seq: it names the follow-up only.
        told = hosted_notice.notice(self.pending()["items"], live["handed_seq"], "agent-a", live["attempt_id"])
        self.assertEqual([line.split(", delivery ")[1] for line in told["input"][0]["text"].splitlines() if ", delivery " in line],
                         [self.pending()["items"][1]["id"]])
        self.now += 3
        self.assertTrue(self.end("failed", error_code="httpConnectionFailed")["rearmed"])
        self.assertEqual(self.schedule(), {"next_due_ms": live["lease_until_ms"], "retry_count": 1, "handed_seq": None, "pending_count": 2})
        # The follow-up's claim still starts a fresh turn, but that turn was never told of the first
        # delivery: the hand records the turn, hands nothing, and the recipient is due now.
        result = self.hand(live, turn_id="turn-2")
        self.assertEqual((result["handed_seq"], result["next_due_ms"]), (None, self.now))
        self.assertEqual(self.schedule(), {"next_due_ms": self.now, "retry_count": 1, "handed_seq": None, "pending_count": 2})
        self.assertEqual(self.sql("SELECT turn_id,final_status FROM hosted_turns ORDER BY handed_ms"), [("turn-1", "failed"), ("turn-2", None)])
        again = self.claim_now()
        self.assertIsNone(again["handed_seq"])
        told = hosted_notice.notice(self.pending()["items"], again["handed_seq"], "agent-a", again["attempt_id"])
        self.assertEqual(sum(1 for line in told["input"][0]["text"].splitlines() if ", delivery " in line), 2)

    def test_a_claim_whose_start_was_not_handed_back_still_hands_its_work(self):
        self.hand(self.claim_now())
        self.send_next("Follow-up")
        live = self.claim_now()
        # The first turn handles its work and completes cleanly while the follow-up is being handed: nothing was handed back.
        self.ack(self.pending()["items"][0]["id"])
        self.assertFalse(self.end("completed")["rearmed"])
        self.assertEqual(self.hand(live, turn_id="turn-2")["handed_seq"], live["captured_seq"])
        self.nothing_due()

    def test_a_steer_answered_after_its_turn_ended_is_recorded_finished_and_named_again(self):
        first = self.claim_now()
        self.hand(first)
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + first["attempt_id"])["status"], "recorded")
        self.send_next("Also give the total")
        steer = self.claim_now()
        # The turn handles its work and ends before the steer's answer is read: only the start row exists, and it ends clean.
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.end("completed")["rearmed"], False)
        self.now += 5
        result = self.hand(steer, mode="steer")
        self.assertEqual((result["handed_seq"], result["next_due_ms"]), (None, self.now + 1000))
        self.assertEqual(self.schedule(), {"next_due_ms": self.now + 1000, "retry_count": 1, "handed_seq": None, "pending_count": 1})
        # The late row is born finished, so no open row waits on a turn that is over.
        self.assertEqual(self.sql("SELECT mode,final_status,finished_ms FROM hosted_turns ORDER BY handed_ms"),
                         [("start", "completed", self.now - 5), ("steer", "completed", self.now)])
        self.assertEqual(self.store.open_hosted_turns(self.hosting, self.runner, [THREAD])["turns"], [])
        self.now += 1000
        self.assertIsNone(self.claim_now()["handed_seq"])

    def test_a_start_answered_after_its_turn_ended_re_arms_only_if_the_turn_did_not_complete(self):
        for status in ("completed", "failed"):
            with self.subTest(status=status):
                turn_id = "turn-" + status
                if not self.pending()["items"]:
                    self.send_next("Again")
                # Another claim's start into the same turn id stands in for a turn the host saw end first.
                earlier = self.claim_now()
                self.hand(earlier, turn_id=turn_id)
                if status == "completed":
                    for item in self.pending()["items"]:
                        self.ack(item["id"])
                self.end(status, turn_id=turn_id)
                self.now = max(self.now, self.schedule()["next_due_ms"] or self.now)
                self.send_next("More")
                late = self.claim_now()
                result = self.hand(late, turn_id=turn_id)
                if status == "completed":
                    self.assertEqual(result["handed_seq"], late["captured_seq"])
                    self.assertIsNone(result["next_due_ms"])
                else:
                    self.assertIsNone(result["handed_seq"])
                    self.assertGreater(result["next_due_ms"], self.now)
                self.assertEqual(self.sql("SELECT final_status FROM hosted_turns WHERE attempt_id=?", (late["attempt_id"],)), [(status,)])
                for item in self.pending()["items"]:
                    self.ack(item["id"])

    def test_reaching_zero_pending_clears_handed_seq(self):
        claim = self.claim_now()
        self.hand(claim)
        self.ack(self.pending()["items"][0]["id"])
        self.assertEqual(self.schedule(), {"next_due_ms": None, "retry_count": 0, "handed_seq": None, "pending_count": 0})
        # Cancelled work also reaches zero.
        self.send_next()
        self.hand(self.claim_now(), turn_id="turn-2")
        self.assertIsNotNone(self.schedule()["handed_seq"])
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.assertEqual(self.schedule()["handed_seq"], None)
        self.assertEqual(self.schedule()["pending_count"], 0)

    def test_handing_after_everything_was_acknowledged_records_the_turn_without_a_handed_seq(self):
        claim = self.claim_now()
        self.ack(self.pending()["items"][0]["id"])
        result = self.hand(claim)
        self.assertEqual((result["pending_count"], result["handed_seq"], result["next_due_ms"]), (0, None, None))
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(1,)])

    def test_the_broker_accepted_path_is_unchanged(self):
        # agent-b is a queue (broker) route; its follow-up waits for the 60 s re-due as before.
        self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"})
        self.send_next("For both")
        self.ack(self.pending()["items"][0]["id"])
        self.ack(self.pending()["items"][0]["id"])
        self.pin_route(self.hosting, "codex-queue-stdio", OTHER_THREAD, actor="agent-b")
        self.store.renew_runner(self.hosting, self.runner)
        claim = self.store.claim_wakes(self.hosting, self.runner, ["agent-b"])["claims"][0]
        with self.assertRaises(StoreError):
            self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted", turn=self.turn(claim))
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "accepted")
        self.assertEqual(result, {"status": "settled", "wake_status": "accepted", "next_due_ms": self.now + 60000,
                                  "pending_count": 1, "instance_id": "test-instance"})
        self.send_next("Follow-up")
        self.assertEqual(self.schedule("agent-b"), {"next_due_ms": self.now + 60000, "retry_count": 0, "handed_seq": None, "pending_count": 2})
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(0,)])

    # Refusals and records -------------------------------------------------

    def test_handed_refusals_change_nothing_and_leave_the_claim_settleable(self):
        claim = self.claim_now()
        before = self.unchanged()
        cases = {
            "no turn": dict(turn=None),
            "extra field": dict(turn=dict(self.turn(claim), extra=1)),
            "missing field": dict(turn={k: v for k, v in self.turn(claim).items() if k != "mode"}),
            "mode": dict(turn=self.turn(claim, mode="resume")),
            "uppercase thread": dict(turn=self.turn(claim, thread_id=THREAD.upper())),
            "control in turn id": dict(turn=self.turn(claim, turn_id="t\n1")),
            "boolean seq": dict(turn=self.turn(claim, announced_seq=True)),
            "another attempt's client id": dict(turn=self.turn(claim, client_id="theseus:a-other")),
            "announced beyond the last delivery": dict(turn=self.turn(claim, announced_seq=claim["captured_seq"] + 1)),
            "another thread": dict(turn=self.turn(claim, thread_id=OTHER_THREAD)),
        }
        for name, args in cases.items():
            with self.subTest(name):
                with self.assertRaises(RunnerError) as raised:
                    self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", **args)
                expected = "ROUTE_PIN_MISMATCH" if name == "another thread" else "INVALID_ARGUMENT"
                self.assertEqual(raised.exception.code, expected)
                self.assertEqual(self.unchanged(), before)
        self.hand(claim)

    def test_only_the_recipients_pinned_hosted_thread_can_be_handed(self):
        # agent-b has a queue pin for the same thread, and agent-a's thread is pinned to agent-a only.
        self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"})
        self.send_next("For both")
        self.ack(self.pending()["items"][0]["id"])
        self.ack(self.pending()["items"][0]["id"])
        self.store.renew_runner(self.hosting, self.runner)
        claim = self.store.claim_wakes(self.hosting, self.runner, ["agent-b"])["claims"][0]
        for pinned in (False, True):
            with self.subTest(pinned=pinned):
                if pinned:
                    self.pin_route(self.hosting, "codex-queue-stdio", THREAD, actor="agent-b")
                with self.assertRaises(RunnerError) as raised:
                    self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", turn=self.turn(claim))
                self.assertEqual(raised.exception.code, "ROUTE_PIN_MISMATCH")
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(0,)])

    def test_a_stale_handed_settlement_writes_nothing(self):
        claim = self.claim_now()
        self.now += 21000
        before = self.unchanged()
        result = self.store.finish_wake(self.hosting, self.runner, claim["claim_token"], "handed", turn=self.turn(claim))
        self.assertEqual(result["status"], "stale")
        self.assertEqual(self.unchanged(), before)

    def test_hosted_records_are_write_once_and_never_deleted(self):
        claim = self.claim_now()
        self.hand(claim)
        self.sql("INSERT INTO hosted_children(id,runner_token,codex_home,pid,started_at,spawned_ms) VALUES ('h1',?,'/h',7,'s',1)", (self.runner,))
        allowed = (("hosted_turns", "seen_ms", "attempt_id"), ("hosted_children", "exited_ms", "id"))
        for table, column, key in allowed:
            with self.subTest(table=table):
                row = self.sql("SELECT %s FROM %s" % (key, table))[0][0]
                self.sql("UPDATE %s SET %s=5 WHERE %s=?" % (table, column, key), (row,))
                for statement in ("UPDATE %s SET %s=6" % (table, column), "UPDATE %s SET %s=NULL" % (table, column),
                                  "UPDATE %s SET %s='other'" % (table, key), "DELETE FROM %s" % table):
                    with self.assertRaises(sqlite3.IntegrityError):
                        self.sql(statement)
                self.assertEqual(self.sql("SELECT %s FROM %s" % (column, table)), [(5,)])
        with self.assertRaises(sqlite3.IntegrityError):
            self.sql("UPDATE hosted_turns SET mode='steer'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.sql("UPDATE hosted_children SET pid=8")

    def test_usage_lands_once_on_the_first_row_and_a_repeated_end_is_unknown(self):
        start = self.claim_now()
        self.hand(start)
        self.send_next()
        steer = self.claim_now()
        self.now += 7
        self.hand(steer, mode="steer")
        self.store.hosted_turn_seen(self.hosting, self.runner, "theseus:" + steer["attempt_id"])
        usage = {"input_tokens": 100, "cached_input_tokens": 60, "output_tokens": 20, "reasoning_output_tokens": 5, "cli_calls": 3}
        self.assertEqual(self.end("completed", usage=usage)["rows"], 2)
        self.assertEqual(self.sql("SELECT mode,final_status,finished_ms,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,cli_calls "
                                  "FROM hosted_turns ORDER BY handed_ms"),
                         [("start", "completed", self.now, 100, 60, 20, 5, 3), ("steer", "completed", self.now, None, None, None, None, None)])
        before = self.unchanged()
        self.assertEqual(self.end("failed")["status"], "unknown")
        self.assertEqual(self.end("completed", turn_id="never-handed")["status"], "unknown")
        self.assertEqual(self.store.end_hosted_turn(self.hosting, self.runner, OTHER_THREAD, "turn-1", "completed")["status"], "unknown")
        self.assertEqual(self.unchanged(), before)

    def test_seen_is_recorded_once_for_a_handed_client_id_only(self):
        claim = self.claim_now()
        client = "theseus:" + claim["attempt_id"]
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, client)["status"], "unknown")
        self.hand(claim)
        self.now += 40
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, client), {"status": "recorded", "seen_ms": self.now, "instance_id": "test-instance"})
        self.now += 40
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, client)["status"], "already")
        self.assertEqual(self.sql("SELECT seen_ms FROM hosted_turns"), [(self.now - 40,)])
        for other in ("theseus:a-absent", "desktop-message", claim["attempt_id"]):
            self.assertEqual(self.store.hosted_turn_seen(self.hosting, self.runner, other)["status"], "unknown")

    def test_end_and_seen_refuse_invalid_arguments_and_lost_ownership(self):
        self.hand(self.claim_now())
        for args in (dict(status="done"), dict(status="completed", error_code="usageLimitExceeded"),
                     dict(status="failed", error_code="bad code"), dict(status="failed", error_code="x" * 65),
                     dict(status="failed", usage={"tokens": 1}), dict(status="failed", usage={"input_tokens": -1}),
                     dict(status="failed", usage={"cli_calls": 1.5})):
            with self.subTest(args=args), self.assertRaises(RunnerError):
                self.end(**args)
        with self.assertRaises(RunnerError):
            self.store.end_hosted_turn(self.hosting, self.runner, "not-a-uuid", "turn-1", "failed")
        with self.assertRaises(RunnerError):
            self.store.hosted_turn_seen(self.hosting, self.runner, "")
        before = self.unchanged()
        self.assertEqual(self.store.end_hosted_turn(self.hosting, "r-old", THREAD, "turn-1", "failed")["status"], "lost")
        self.assertEqual(self.store.hosted_turn_seen(self.hosting, "r-old", "theseus:a-x")["status"], "lost")
        self.assertEqual(self.unchanged(), before)

    def test_a_new_runner_closes_turns_a_previous_run_left_open(self):
        claim = self.claim_now()
        self.hand(claim)
        self.now += 31000
        later = self.token(self.hosting)
        self.assertNotEqual(later, self.runner)
        result = self.store.end_hosted_turn(self.hosting, later, THREAD, "turn-1", "lost")
        self.assertEqual((result["status"], result["rearmed"]), ("ended", True))
        self.assertEqual(self.schedule()["next_due_ms"], self.now + 1000)

    # Host records ------------------------------------------------------------

    def test_claims_carry_the_handed_seq_their_notice_starts_from(self):
        claim = self.claim_now()
        self.assertIsNone(claim["handed_seq"])
        self.hand(claim)
        self.now += 5000
        self.send_next("Also give the total")
        follow = self.claim_now()
        self.assertEqual(follow["handed_seq"], claim["captured_seq"])

    def test_open_turns_name_every_unfinished_turn_of_the_named_threads_only(self):
        first = self.claim_now()
        self.hand(first)
        self.now += 5000
        self.send_next("Again")
        self.hand(self.claim_now(), mode="steer")
        before = self.unchanged()
        result = self.store.open_hosted_turns(self.hosting, self.runner, [THREAD])
        self.assertEqual(result["turns"], [{"thread_id": THREAD, "turn_id": "turn-1"}])
        self.assertEqual(self.store.open_hosted_turns(self.hosting, self.runner, [OTHER_THREAD])["turns"], [])
        self.assertEqual(self.unchanged(), before)
        self.end("completed")
        self.assertEqual(self.store.open_hosted_turns(self.hosting, self.runner, [THREAD])["turns"], [])
        self.assertEqual(self.store.open_hosted_turns(self.hosting, "r-old", [THREAD])["status"], "lost")
        for bad in ("not-a-list", ["not-a-uuid"], [THREAD.upper()]):
            with self.subTest(bad=bad), self.assertRaises(RunnerError):
                self.store.open_hosted_turns(self.hosting, self.runner, bad)

    def test_a_child_is_recorded_at_spawn_then_once_ready_and_once_exited(self):
        recorded = self.store.record_hosted_child(self.hosting, self.runner, str(self.home), 4242, "2026-11-04T00:00:00+00:00")
        self.assertEqual(recorded["status"], "recorded")
        child = recorded["child_id"]
        self.assertEqual(self.sql("SELECT runner_token,codex_home,pid,user_agent,exited_ms FROM hosted_children"),
                         [(self.runner, str(self.home), 4242, None, None)])
        self.assertEqual(self.store.hosted_child_ready(self.hosting, self.runner, child, "theseus_host/1 (x)")["status"], "recorded")
        self.assertEqual(self.store.hosted_child_ready(self.hosting, self.runner, child, "other")["status"], "already")
        self.assertEqual(self.store.end_hosted_child(self.hosting, self.runner, child, -9, "confirmed")["status"], "recorded")
        before = self.unchanged()
        self.assertEqual(self.store.end_hosted_child(self.hosting, self.runner, child, 0, "confirmed")["status"], "already")
        self.assertEqual(self.store.end_hosted_child(self.hosting, "r-old", child, 0, "confirmed")["status"], "stale")
        self.assertEqual(self.store.end_hosted_child(self.hosting, self.runner, "hc-missing", 0, "confirmed")["status"], "stale")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.sql("SELECT user_agent,exit_status,cleanup FROM hosted_children"), [("theseus_host/1 (x)", -9, "confirmed")])
        for args in ((child, 256, "confirmed"), (child, 0, "maybe"), (child, "0", "confirmed")):
            with self.subTest(args=args), self.assertRaises(RunnerError):
                self.store.end_hosted_child(self.hosting, self.runner, *args)
        for args in (("relative\n", 1, "x"), (str(self.home), 0, "x"), (str(self.home), 1, "")):
            with self.subTest(args=args), self.assertRaises(RunnerError):
                self.store.record_hosted_child(self.hosting, self.runner, *args)

    def test_a_paused_runner_still_records_its_childs_exit_but_spawns_nothing(self):
        child = self.store.record_hosted_child(self.hosting, self.runner, str(self.home), 4243, "start")["child_id"]
        self.assertEqual(self.store.pause_runner(self.hosting, self.runner, "storage_failure")["status"], "paused")
        self.assertEqual(self.store.record_hosted_child(self.hosting, self.runner, str(self.home), 4244, "start")["status"], "paused")
        self.assertEqual(self.store.end_hosted_child(self.hosting, self.runner, child, 0, "confirmed")["status"], "recorded")
        self.assertEqual(self.sql("SELECT pid,exit_status FROM hosted_children"), [(4243, 0)])


# Do not rerun the inherited runner tests during module discovery.
for _base in runner_tests.RunnerCase.__mro__:
    for _name in _base.__dict__:
        if _name.startswith("test_") and _name not in HostedCase.__dict__:
            setattr(HostedCase, _name, None)


if __name__ == "__main__":
    unittest.main()

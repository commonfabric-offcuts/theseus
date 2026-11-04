from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import unittest
from unittest import mock

from aim_next import Store, StoreError
from aim_next import store as store_module
from test_delivery import DeliveryCase
import test_delivery_bounds as bounds


class RunnerCase(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.now = 1000
        patch = mock.patch("aim_next.delivery._now_ms", side_effect=lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        self.create_topic()

    def guard(self, name="test-runner"):
        guard = self.store.runner_guard(name)
        guard.__enter__()
        self.addCleanup(guard.close)
        return guard

    def token(self, guard, **args):
        result = self.store.acquire_runner(guard, **args)
        self.assertEqual(result["status"], "acquired", result)
        return result["runner_token"]

    def claim(self, guard, token, **args):
        result = self.store.claim_wakes(guard, token, **args)
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(len(result["claims"]), 1, result)
        return result["claims"][0]

    def test_one_recipient_claim_coalesces_deliveries_without_acknowledging_them(self):
        for _ in range(4):
            self.send_next()
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        self.assertEqual(claim["recipient_id"], "agent-a")
        self.assertNotIn("body", json.dumps(claim))
        self.assertNotIn("delivery_ids", claim)
        self.assertEqual(claim["route_binding"], {"authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"],
            "instance_id": "test-instance", "actor_id": "agent-a", "db_path": str(self.path.resolve())})
        self.assertEqual(self.store.claim_wakes(guard, token)["claims"], [])
        result = self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        self.assertEqual(result["status"], "settled")
        self.assertEqual(result["next_due_ms"], self.now + 60000)
        self.assertEqual(len(self.pending()["items"]), 5)
        self.send_next("Arrival does not bypass cooldown")
        self.assertEqual(self.store.claim_wakes(guard, token)["claims"], [])
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(1,)])

    def test_ack_of_captured_work_releases_newer_work_after_active_claim_finishes(self):
        guard = self.guard()
        token = self.token(guard)
        first = self.pending()["items"][0]
        claim = self.claim(guard, token)
        self.send_next("B while A is waking")
        self.ack(first["id"])
        try:
            still_held = self.store.claim_wakes(guard, token)
        except StoreError as error:
            self.fail("Reconciled work invalidated an active claim: " + str(error))
        self.assertEqual(still_held["claims"], [])
        result = self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        self.assertEqual(result["next_due_ms"], self.now)
        later = self.claim(guard, token)
        self.assertGreater(later["captured_seq"], claim["captured_seq"])
        self.assertGreater(later["wake_generation"], claim["wake_generation"])

    def test_stale_tokens_and_expired_claim_cannot_settle_newer_attempt(self):
        guard = self.guard()
        old = self.token(guard)
        first = self.claim(guard, old)
        self.now += 31000
        self.assertEqual(self.store.renew_runner(guard, old)["status"], "lost")
        token = self.token(guard)
        later = self.claim(guard, token)
        before = self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        self.assertEqual(self.store.finish_wake(guard, old, first["claim_token"], "accepted")["status"], "stale")
        self.assertEqual(self.store.finish_wake(guard, token, first["claim_token"], "accepted")["status"], "stale")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), before)
        self.assertEqual(self.store.finish_wake(guard, token, later["claim_token"], "accepted")["status"], "settled")
        self.assertEqual(self.sql("SELECT outcome FROM wake_results ORDER BY finished_ms"), [("expired",), ("accepted",)])

    def test_singleton_must_outlive_claim_and_cannot_be_shortened_below_it(self):
        guard = self.guard()
        token = self.token(guard, lease_ms=1000)
        with self.assertRaises(StoreError) as caught:
            self.store.claim_wakes(guard, token)
        self.assertEqual(caught.exception.code, "LEASE_TOO_SHORT")
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(0,)])
        self.assertEqual(self.store.renew_runner(guard, token)["status"], "renewed")
        self.claim(guard, token)
        with self.assertRaises(StoreError):
            self.store.renew_runner(guard, token, lease_ms=1000)

    def test_pause_persists_and_only_versioned_explicit_resume_clears_it(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        self.assertEqual(self.store.record_runner_child(guard, token, claim["claim_token"], os.getpid(), "owned-fixture-start")["status"], "recorded")
        self.now += 31000
        # A timed-out child cleanup still needs a durable pause while the actual
        # guard is retained, even if the wall-clock singleton lease has expired.
        paused = self.store.pause_runner(guard, token, "cleanup_failed")
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(self.store.renew_runner(guard, token)["status"], "paused")
        self.assertEqual(self.store.claim_wakes(guard, token)["status"], "paused")
        self.assertEqual(self.store.finish_wake(guard, token, claim["claim_token"], "accepted")["status"], "stale")
        self.assertEqual(self.sql("SELECT lease_until_ms FROM runner_state"), [(31000,)])
        with self.assertRaises(StoreError):
            self.store.resume_runner(guard, paused["version"])
        guard.close()
        reopened = Store(self.path, "test-instance", expected_binding=self.binding)
        facts = reopened.view("owner", "capabilities", {})["runner"]
        self.assertEqual(facts["state"], "paused")
        self.assertEqual(facts["reason_code"], "cleanup_failed")
        self.assertNotIn(token, json.dumps(facts))
        self.assertNotIn("agent-a", json.dumps(facts))
        next_guard = self.guard("next-runner")
        self.assertEqual(reopened.acquire_runner(next_guard)["status"], "paused")
        with self.assertRaises(StoreError):
            reopened.resume_runner(next_guard, facts["version"] - 1)
        resumed = reopened.resume_runner(next_guard, facts["version"])
        self.assertEqual(resumed["status"], "acquired")
        self.assertNotEqual(resumed["runner_token"], token)
        self.assertEqual(reopened.view("owner", "capabilities", {})["runner"]["state"], "running")

    def test_pause_refuses_superseded_token_changed_epoch_and_closed_guard(self):
        guard = self.guard()
        old = self.token(guard)
        self.now += 31000
        token = self.token(guard)
        before = self.sql("SELECT * FROM runner_state")
        self.assertEqual(self.store.pause_runner(guard, old, "cleanup_failed")["status"], "lost")
        self.assertEqual(self.sql("SELECT * FROM runner_state"), before)
        anchor = self.root_anchor()
        record = json.loads(anchor.read_text())
        record["epoch"] = "controlled-stale-epoch"
        anchor.write_text(json.dumps(record))
        with self.assertRaises(StoreError):
            self.store.pause_runner(guard, token, "cleanup_failed")
        self.assertEqual(self.sql("SELECT * FROM runner_state"), before)
        guard.close()
        with self.assertRaises(StoreError):
            self.store.pause_runner(guard, token, "cleanup_failed")

    def root_anchor(self):
        from pathlib import Path
        return Path(self.binding["authority_path"])

    def test_status_does_not_walk_completed_attempt_history(self):
        guard = self.guard()
        token = self.token(guard)
        _, baseline = bounds.DeliveryBoundsCase.measured(self, self.store.runner_status)
        for _ in range(20):
            state = self.store.acquire_runner(guard)
            if state["status"] == "acquired":
                token = state["runner_token"]
            else:
                self.store.renew_runner(guard, token, lease_ms=120000)
            claim = self.claim(guard, token)
            result = self.store.finish_wake(guard, token, claim["claim_token"], "busy")
            self.now = result["next_due_ms"]
        status, measured = bounds.DeliveryBoundsCase.measured(self, self.store.runner_status)
        self.assertIsNone(status["claim"])
        self.assertGreater(baseline["vm_steps"], 0)
        self.assertLessEqual(measured["vm_steps"], baseline["vm_steps"] + 100)

    def test_backoff_has_no_cutoff_and_hint_generation_is_stable_until_work_changes(self):
        guard = self.guard()
        generations, attempts = [], []
        for index, seconds in enumerate((1, 2, 4, 8, 16, 32, 60, 60, 60)):
            state = self.store.acquire_runner(guard)
            if state["status"] == "acquired":
                token = state["runner_token"]
            else:
                self.assertEqual(state["status"], "busy")
                self.store.renew_runner(guard, token)
            claim = self.claim(guard, token)
            generations.append(claim["wake_generation"])
            attempts.append(claim["attempt_id"])
            result = self.store.finish_wake(guard, token, claim["claim_token"], "busy" if index % 2 else "error")
            self.assertEqual(result["next_due_ms"], self.now + seconds * 1000)
            self.now = result["next_due_ms"]
        self.assertEqual(len(set(generations)), 1)
        self.assertEqual(len(set(attempts)), 9)
        self.assertEqual(len(self.pending()["items"]), 1)

    def test_disabled_actor_never_claims_and_canceled_work_never_becomes_acknowledged(self):
        guard = self.guard()
        token = self.token(guard)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        self.assertEqual(self.store.claim_wakes(guard, token)["claims"], [])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=1 WHERE id='agent-a'")
        claim = self.claim(guard, token)
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        result = self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        self.assertEqual(result["pending_count"], 0)
        self.assertIsNone(result["next_due_ms"])
        self.assertEqual(self.sql("SELECT state FROM deliveries"), [("pending",)])
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(1,)])

    def test_actual_held_guard_is_required_and_runner_mutations_advance_commit_sequence(self):
        with self.assertRaises(StoreError):
            self.store.acquire_runner(None)
        guard = self.guard()
        before = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        old_id = self.sql("SELECT value FROM metadata WHERE key='commit_id'")[0][0]
        token = self.token(guard)
        acquired_id = self.sql("SELECT value FROM metadata WHERE key='commit_id'")[0][0]
        self.assertNotEqual(acquired_id, old_id)
        self.assertEqual(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), before + 1)
        self.assertEqual(self.store.acquire_runner(guard)["status"], "busy")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_id'"), [(acquired_id,)])
        self.assertEqual(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), before + 1)
        self.claim(guard, token)
        self.assertNotEqual(self.sql("SELECT value FROM metadata WHERE key='commit_id'")[0][0], acquired_id)
        self.assertEqual(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), before + 2)
        guard.close()
        with self.assertRaises(StoreError):
            self.store.claim_wakes(guard, token)
        rejected = self.command("runner.claim", {})
        self.assertEqual(rejected["error"]["code"], "UNKNOWN_COMMAND")

    def test_runner_reads_recheck_authority_after_sqlite_opens(self):
        guard = self.guard()
        connect = store_module._connect
        for surface in ("acquire", "status"):
            with self.subTest(surface=surface):
                replacement = self.path.with_name(surface + "-replacement.sqlite3")
                original = self.path.with_name(surface + "-original.sqlite3")
                shutil.copy2(self.path, replacement)
                with sqlite3.connect(str(replacement)) as db:
                    db.execute("UPDATE runner_state SET state='paused',reason_code='operator_pause'")
                swapped = []
                def swapping_connect(path):
                    if not swapped:
                        self.path.rename(original)
                        replacement.rename(self.path)
                        swapped.append(True)
                    return connect(path)
                try:
                    with mock.patch.object(store_module, "_connect", swapping_connect):
                        with self.assertRaises(StoreError) as caught:
                            if surface == "acquire":
                                self.store.acquire_runner(guard)
                            else:
                                self.store.runner_status()
                        self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")
                finally:
                    if swapped:
                        self.path.rename(replacement)
                        original.rename(self.path)
                self.assertTrue(swapped)
        self.assertEqual(self.sql("SELECT state FROM runner_state"), [("idle",)])

    def test_explicit_resume_waits_for_the_actual_inherited_child_guard(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        program = "import os,sys; [os.fstat(int(fd)) for fd in sys.argv[1:]]; print('ready',flush=True); sys.stdin.read(1)"
        child = subprocess.Popen([sys.executable, "-c", program] + [str(fd) for fd in guard.pass_fds],
            pass_fds=guard.pass_fds, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            import selectors
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(timeout=5), "Owned child never became ready")
            self.assertEqual(child.stdout.readline().strip(), "ready")
            self.store.record_runner_child(guard, token, claim["claim_token"], child.pid, "owned-child-fixture")
            self.now += 31000
            paused = self.store.pause_runner(guard, token, "cleanup_failed")
            before = self.sql("SELECT * FROM runner_state")
            guard.close()
            with self.assertRaises(StoreError) as blocked:
                self.guard("cannot-resume-yet")
            self.assertEqual(blocked.exception.code, "blocked_by_guard")
            self.assertEqual(self.sql("SELECT * FROM runner_state"), before)
        finally:
            child.communicate("x", timeout=5)
        self.assertEqual(child.returncode, 0)
        fresh_guard = self.guard("after-owned-child-exit")
        self.assertEqual(self.store.acquire_runner(fresh_guard)["status"], "paused")
        self.assertEqual(self.store.resume_runner(fresh_guard, paused["version"])["status"], "acquired")

    def test_wake_attempts_and_results_remain_immutable_history(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        for statement in ("UPDATE wake_attempts SET recipient_id='agent-b'", "DELETE FROM wake_attempts",
                          "UPDATE wake_results SET outcome='busy'", "DELETE FROM wake_results"):
            with self.subTest(statement=statement):
                with sqlite3.connect(str(self.path)) as db:
                    with self.assertRaises(sqlite3.IntegrityError):
                        db.execute(statement)
        self.assertEqual(self.sql("SELECT recipient_id FROM wake_attempts"), [("agent-a",)])
        self.assertEqual(self.sql("SELECT outcome FROM wake_results"), [("accepted",)])

    def test_duplicate_finish_is_stale_without_rewriting_a_result(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        self.assertEqual(self.store.finish_wake(guard, token, claim["claim_token"], "unavailable")["next_due_ms"], self.now + 60000)
        before = self.sql("SELECT * FROM wake_results")
        pair = self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')")
        try:
            repeated = self.store.finish_wake(guard, token, claim["claim_token"], "accepted")
        except StoreError as error:
            self.fail("Repeated finish raised instead of refusing stale completion: " + str(error))
        self.assertEqual(repeated["status"], "stale")
        self.assertEqual(self.sql("SELECT * FROM wake_results"), before)
        self.assertEqual(self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')"), pair)

    def runner_records(self):
        return {table: self.sql("SELECT * FROM " + table + " ORDER BY 1") for table in (
            "runner_state", "wake_attempts", "wake_results", "recipient_schedule", "metadata")}

    def test_first_claim_rejects_token_from_previous_guard_acquisition(self):
        first = self.guard("loop")
        token = self.token(first)
        generation = first.generation
        first.close()
        second = self.guard("loop")
        self.assertNotEqual(second.generation, generation)
        before = self.runner_records()
        self.assertEqual(self.store.acquire_runner(second)["status"], "busy")
        result = self.store.claim_wakes(second, token)
        self.assertEqual(result["status"], "lost")
        self.assertEqual(result["claims"], [])
        self.assertEqual(self.runner_records(), before)

    def transferred_guard(self, reenter=False, paused=False):
        first = self.guard("loop")
        token = self.token(first)
        claim = self.claim(first, token)
        generation = first.generation
        if paused:
            self.store.pause_runner(first, token, "cleanup_failed")
        first.close()
        second = first.__enter__() if reenter else self.guard("loop")
        self.assertNotEqual(second.generation, generation)
        before = self.runner_records()
        calls = (
            ("renew", "lost", lambda: self.store.renew_runner(second, token)),
            ("claim", "lost", lambda: self.store.claim_wakes(second, token)),
            ("finish", "stale", lambda: self.store.finish_wake(second, token, claim["claim_token"], "accepted")),
            ("child", "stale", lambda: self.store.record_runner_child(second, token, claim["claim_token"], os.getpid(), "fixture")),
            ("pause", "lost", lambda: self.store.pause_runner(second, token, "cleanup_failed")),
        )
        for name, expected, call in calls:
            with self.subTest(call=name):
                self.assertEqual(call()["status"], expected)
                self.assertEqual(self.runner_records(), before)

    def test_each_token_bound_call_rejects_a_different_guard_generation(self):
        self.transferred_guard()

    def test_reentering_same_guard_object_does_not_transfer_token_ownership(self):
        self.transferred_guard(reenter=True)

    def test_paused_shortcuts_reject_a_different_guard_generation(self):
        self.transferred_guard(paused=True)

    def test_expired_claim_is_stale_while_singleton_is_still_live(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token, lease_ms=1000)
        self.now = claim["lease_until_ms"]
        self.assertGreater(self.sql("SELECT lease_until_ms FROM runner_state")[0][0], self.now)
        before = self.runner_records()
        self.assertEqual(self.store.finish_wake(guard, token, claim["claim_token"], "accepted")["status"], "stale")
        self.assertEqual(self.runner_records(), before)

    def test_singleton_coverage_refuses_one_ms_gap_and_accepts_equality(self):
        guard = self.guard()
        token = self.token(guard)
        until = self.sql("SELECT lease_until_ms FROM runner_state")[0][0]
        self.now = until - 20000 + 1
        before = self.runner_records()
        with self.assertRaises(StoreError) as caught:
            self.store.claim_wakes(guard, token, lease_ms=20000)
        self.assertEqual(caught.exception.code, "LEASE_TOO_SHORT")
        self.assertEqual(self.runner_records(), before)
        # Renew to equality without changing time; a correctly covered claim
        # must be accepted rather than merely making every near-boundary call fail.
        self.store.renew_runner(guard, token, lease_ms=20000)
        claim = self.claim(guard, token, lease_ms=20000)
        self.assertEqual(claim["lease_until_ms"], self.now + 20000)

    def test_empty_claim_poll_does_not_change_records_or_commit_identity(self):
        guard = self.guard()
        token = self.token(guard)
        self.claim(guard, token)
        before = self.runner_records()
        result = self.store.claim_wakes(guard, token)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["claims"], [])
        self.assertEqual(self.runner_records(), before)

    def test_superseded_token_is_lost_on_every_paused_shortcut(self):
        guard = self.guard()
        old = self.token(guard)
        self.now += 31000
        token = self.token(guard)
        paused = self.store.pause_runner(guard, token, "operator_pause")
        self.assertEqual(paused["status"], "paused")
        before = self.runner_records()
        for name, call in (
            ("pause", lambda: self.store.pause_runner(guard, old, "cleanup_failed")),
            ("renew", lambda: self.store.renew_runner(guard, old)),
            ("claim", lambda: self.store.claim_wakes(guard, old)),
        ):
            with self.subTest(call=name):
                self.assertEqual(call()["status"], "lost")
                self.assertEqual(self.runner_records(), before)
        self.assertEqual(self.store.pause_runner(guard, token, "operator_pause"), paused)
        self.assertEqual(self.runner_records(), before)

    def test_lock_replacement_after_action_rolls_back_before_commit(self):
        guard = self.guard()
        lock = self.root_anchor().with_name(self.root_anchor().name + ".runner.lock")
        held = lock.with_name("held-original.lock")
        replacement = lock.with_name("replacement.lock")
        shutil.copy2(lock, replacement)
        original_inode = (lock.stat().st_dev, lock.stat().st_ino)
        self.assertNotEqual((replacement.stat().st_dev, replacement.stat().st_ino), original_inode)
        before = self.runner_records()
        advance = self.store._advance_commit_seq
        replaced = []
        def replace_after_action(db):
            advance(db)
            lock.rename(held)
            replacement.rename(lock)
            replaced.append((lock.stat().st_dev, lock.stat().st_ino))
        try:
            with mock.patch.object(self.store, "_advance_commit_seq", replace_after_action):
                with self.assertRaises(StoreError) as caught:
                    self.store.acquire_runner(guard)
                self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")
        finally:
            if replaced:
                lock.rename(replacement)
                held.rename(lock)
        self.assertEqual(len(replaced), 1)
        self.assertNotEqual(replaced[0], original_inode)
        self.assertEqual(self.runner_records(), before)
        self.assertEqual(self.store.acquire_runner(guard)["status"], "acquired")

    def test_expired_holder_is_unknown_with_last_registered_pause_diagnostics(self):
        guard = self.guard()
        token = self.token(guard)
        claim = self.claim(guard, token)
        self.store.record_runner_child(guard, token, claim["claim_token"], os.getpid(), "fixture-child-start")
        registered = {"runner_pid": os.getpid(), "runner_started_ms": self.now,
                      "child_pid": os.getpid(), "child_started_at": "fixture-child-start"}
        until = self.sql("SELECT lease_until_ms FROM runner_state")[0][0]
        reads = (("capabilities", lambda: self.store.view("owner", "capabilities", {})["runner"]),
                 ("status", self.store.runner_status))
        for name, read in reads:
            with self.subTest(surface=name, phase="live"):
                self.assertEqual(read()["holder"], registered)
        self.now = until
        before = self.runner_records()
        for name, read in reads:
            with self.subTest(surface=name, phase="expired"):
                facts = read()
                self.assertIsNone(facts["holder"])
                self.assertIs(facts["lease_expired"], True)
                self.assertEqual(facts["last_registered"], registered)
                self.assertEqual(facts["state"], "running")
                self.assertEqual(self.runner_records(), before)
        paused = self.store.pause_runner(guard, token, "cleanup_failed")
        before = self.runner_records()
        for name, read in reads:
            with self.subTest(surface=name, phase="paused_after_expiry"):
                facts = read()
                self.assertIsNone(facts["holder"])
                self.assertIs(facts["lease_expired"], True)
                self.assertEqual(facts["last_registered"], registered)
                self.assertEqual(facts["state"], "paused")
                self.assertEqual(facts["version"], paused["version"])
                self.assertEqual(facts["reason_code"], "cleanup_failed")
                self.assertEqual(self.runner_records(), before)


for _name in list(DeliveryCase.__dict__):
    if _name.startswith("test_") and _name not in RunnerCase.__dict__:
        setattr(RunnerCase, _name, None)
del DeliveryCase


if __name__ == "__main__":
    unittest.main()

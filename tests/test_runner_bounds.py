from __future__ import annotations

import json
import sqlite3
import time
import unittest

from aim_next import StoreError
from test_runner import RunnerCase
import test_delivery_bounds as bounds


class RunnerBoundsCase(RunnerCase):
    def test_five_hundred_deliveries_are_one_recipient_claim(self):
        start = time.monotonic()
        bounds.DeliveryBoundsCase.seed_pending(self, 499)
        setup_seconds = time.monotonic() - start
        guard = self.guard()
        token = self.token(guard)
        result, measure = bounds.DeliveryBoundsCase.measured(self, lambda: self.store.claim_wakes(guard, token, self.everyone(), limit=32))
        self.assertEqual(result["scanned"], 1)
        self.assertEqual(len(result["claims"]), 1)
        self.assertEqual(result["claims"][0]["recipient_id"], "agent-a")
        self.assertEqual(self.sql("SELECT count(*) FROM wake_attempts"), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='pending'"), [(500,)])
        self.assertEqual(self.store.claim_wakes(guard, token, self.everyone(), limit=32)["claims"], [])
        print(json.dumps({"phase": "coalesced_wake", "setup_seconds": setup_seconds, "claim": measure}, sort_keys=True))

    def test_ten_thousand_canceled_deliveries_do_not_grow_claim_work(self):
        guard = self.guard()
        token = self.token(guard)
        baseline, before = bounds.DeliveryBoundsCase.measured(self, lambda: self.store.claim_wakes(guard, token, self.everyone()))
        self.store.finish_wake(guard, token, baseline["claims"][0]["claim_token"], "accepted")
        start = time.monotonic()
        bounds.DeliveryBoundsCase.seed_pending(self, 10000)
        setup_seconds = time.monotonic() - start
        self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"})
        self.command("participation.set", {"actor_id": "agent-a", "present": True}, target={"topic_id": "t1"})
        fresh = self.send_next("Only fresh work is eligible")
        after, measured = bounds.DeliveryBoundsCase.measured(self, lambda: self.store.claim_wakes(guard, token, self.everyone()))
        self.assertEqual(after["scanned"], 1)
        self.assertEqual(len(after["claims"]), 1)
        self.assertEqual(after["claims"][0]["recipient_id"], "agent-a")
        page = self.pending(limit=1)
        self.assertEqual([item["message_id"] for item in page["items"]], [fresh])
        self.assertGreater(before["vm_steps"], 0)
        self.assertLessEqual(measured["vm_steps"], before["vm_steps"] + 100)
        plan = self.sql("EXPLAIN QUERY PLAN SELECT * FROM recipient_schedule INDEXED BY sqlite_autoindex_recipient_schedule_1 WHERE recipient_id IN (SELECT value FROM json_each(?)) AND enabled=1 AND pending_count>0 AND next_due_ms<=1000 ORDER BY next_due_ms,recipient_id LIMIT 1", (json.dumps(self.everyone()),))
        self.assertTrue(any("sqlite_autoindex_recipient_schedule_1 (recipient_id=?)" in str(row) for row in plan), plan)
        print(json.dumps({"phase": "claim_bounds", "setup_seconds": setup_seconds, "pages_to_fresh": 1,
            "baseline": before, "with_canceled_history": measured, "plan": plan}, sort_keys=True))

    def test_sleep_catchup_is_bounded_by_recipient_limit(self):
        # Isolated bulk fixture: public sends and eligibility transitions are
        # covered above; seed 40 distinct due recipients to measure burst bounds.
        with sqlite3.connect(str(self.path)) as db:
            message = db.execute("SELECT id FROM messages LIMIT 1").fetchone()[0]
            for index in range(40):
                actor = "bulk-agent-%02d" % index
                db.execute("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", (actor, actor))
                group = db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,'direct','',0)", (actor,)).lastrowid
                did = "bulk-wake-%s" % index
                seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES (?,?,?,?)", (did, message, actor, group)).lastrowid
                db.execute("INSERT INTO delivery_reasons VALUES (?,'addressed','t1',NULL)", (did,))
                db.execute("UPDATE delivery_groups SET pending_count=1,first_pending_seq=? WHERE id=?", (seq, group))
                db.execute("INSERT INTO recipient_schedule(recipient_id,enabled,pending_count,wake_generation,last_seq,next_due_ms) VALUES (?,1,1,1,?,0)", (actor, seq))
        routed = self.everyone() + ["bulk-agent-%02d" % index for index in range(40)]
        guard = self.guard()
        token = self.token(guard)
        self.now += 3600000
        self.assertEqual(self.store.renew_runner(guard, token)["status"], "lost")
        token = self.token(guard)
        with self.assertRaises(StoreError):
            self.store.claim_wakes(guard, token, routed, limit=33)
        first = self.store.claim_wakes(guard, token, routed, limit=32)
        self.assertEqual(first["scanned"], 32)
        self.assertEqual(len(first["claims"]), 32)
        rest = self.store.claim_wakes(guard, token, routed, limit=32)
        self.assertEqual(len(rest["claims"]), 9)
        self.assertEqual(len({row["recipient_id"] for row in first["claims"] + rest["claims"]}), 41)
        self.assertEqual(self.store.claim_wakes(guard, token, routed)["claims"], [])


for _name in list(RunnerCase.__dict__):
    if _name.startswith("test_") and _name not in RunnerBoundsCase.__dict__:
        setattr(RunnerBoundsCase, _name, None)
del RunnerCase


if __name__ == "__main__":
    unittest.main()

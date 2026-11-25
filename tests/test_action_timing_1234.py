from __future__ import annotations

import copy
import json
from unittest.mock import patch

import test_store as fixtures


def reading(identity="action", sequence=1, **changes):
    row = dict(v=1, id=identity, tab="tab-one", sequence=sequence, kind="send", build="build-447",
               started_ms=1000000, elapsed_ms=20, outcome="complete", operations=["send-operation"], submission="submission-one",
               burden=dict(loaded_messages=30, retained_messages=300, rendered_cards=30, window_limit=300),
               phases=[dict(name="send_canonical_dom", at_ms=18, duration_ms=None, request=None, operation=None, clock="browser")],
               support=dict(long_tasks=False, resource_timing=False, frames=True), overhead_ms=0.1, dropped_phases=0, lost_records=0, report_failures=0, counts=dict(backend_puts=0, journal_writes=0, journal_transactions=0, requests=0, retries=0),
               long_tasks=dict(count=0, duration_ms=0), idle=dict(samples=0, maximum_gap_ms=None), failure=None)
    row.update(changes)
    return row


class ActionTimingCase(fixtures.StoreCase):
    def record(self, records, **kwargs):
        receipt = self.command("performance.record", {"records": records}, **kwargs)
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt

    def performance(self, actor="owner"):
        return self.store.view(actor, "health", {})["tab_performance"]

    def test_actual_command_receipt_replay_and_private_health_record(self):
        receipt = self.record([reading()], op="metrics-once")
        value = self.performance()
        self.assertEqual(value["counts"], dict(complete=1, failed=0, incomplete=0, running=0))
        self.assertEqual(value["slowest"][0]["id"], "action")
        self.assertEqual(value["slowest"][0]["elapsed_ms"], 20)
        stored = self.sql("SELECT value FROM metadata WHERE key='tab_performance:owner'")
        self.assertEqual(self.record([reading()], op="metrics-once"), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "metrics-once"}), receipt)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='tab_performance:owner'"), stored)
        self.assertEqual(self.performance("agent-a")["counts"], dict(complete=0, failed=0, incomplete=0, running=0))
        self.assertEqual(self.performance("agent-a")["slowest"], [])

    def test_newer_snapshot_updates_one_action_and_older_snapshot_cannot_replace_it(self):
        self.record([reading(outcome="running", elapsed_ms=5)])
        self.record([reading(sequence=3, outcome="failed", failure="transport", elapsed_ms=100)])
        self.record([reading(sequence=2, elapsed_ms=90)])
        value = self.performance()
        self.assertEqual(value["retained"], 1)
        self.assertEqual(value["counts"]["failed"], 1)
        self.assertEqual(value["slowest"][0]["sequence"], 3)
        self.assertEqual(value["slowest"][0]["failure"], "transport")

    def test_batch_validation_is_atomic_and_never_stores_writing_or_unknown_fields(self):
        self.record([reading()])
        before = self.sql("SELECT value FROM metadata WHERE key='tab_performance:owner'")
        for changes in [dict(body="private writing"), dict(elapsed_ms=True), dict(elapsed_ms=float("nan")),
                        dict(operations=["https://private.invalid/writing"]), dict(failure="arbitrary exception")]:
            bad = reading("bad", **changes)
            answer = self.command("performance.record", {"records": [reading("other"), bad]})
            self.assertNotEqual(answer["status"], "committed", answer)
            self.assertEqual(answer["error"]["code"], "INVALID_ARGUMENT")
            self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='tab_performance:owner'"), before)

    def test_cap_and_expiry_keep_the_actual_recorded_window_and_drop_counts(self):
        with patch("aim_next.delivery._now_ms", return_value=1000000):
            for batch in range(17):
                self.record([reading("action-%d" % (batch * 16 + index)) for index in range(16)])
            value = self.performance()
            self.assertEqual(value["retained"], 256)
            self.assertEqual(value["cap_dropped"], 16)
            self.assertEqual(sum(value["counts"].values()), 256)
        with patch("aim_next.delivery._now_ms", return_value=4600001):
            value = self.performance()
            self.assertEqual(value["retained"], 0)
            self.assertEqual(value["slowest"], [])
            self.assertEqual(value["expired"], 256)

    def test_unfinished_and_failed_observations_are_not_successful_or_zero_duration(self):
        self.record([reading("running", outcome="running"), reading("failed", outcome="failed", failure="storage"),
                     reading("retired", outcome="incomplete", failure="retired"),
                     reading("idle", kind="idle", elapsed_ms=1000, idle=dict(samples=2, maximum_gap_ms=150))])
        value = self.performance()
        self.assertEqual(value["counts"], dict(complete=1, failed=1, incomplete=1, running=1))
        self.assertEqual({row["id"] for row in value["unfinished"]}, {"running", "retired"})
        self.assertEqual(value["slowest"][0]["elapsed_ms"], 1000)
        self.assertIsNone(value["slowest"][1]["idle"]["maximum_gap_ms"])

    def test_foreign_actor_and_wrong_authority_cannot_update_the_owners_record(self):
        self.record([reading()])
        self.record([reading("agent-action")], actor="agent-a")
        self.assertEqual(self.performance()["retained"], 1)
        self.assertEqual(self.performance("agent-a")["slowest"][0]["id"], "agent-action")
        wrong = copy.deepcopy(self.pin)
        wrong["authority_epoch"] = "wrong"
        answer = self.store.command("owner", dict(v=1, instance_id="test-instance", operation_id="wrong-authority",
            kind="performance.record", target={}, expected=dict(authority=wrong), args=dict(records=[reading("wrong")])))
        self.assertFalse(answer["recorded"])
        self.assertEqual(self.performance()["retained"], 1)


for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in ActionTimingCase.__dict__:
        setattr(ActionTimingCase, _name, None)

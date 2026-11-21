from __future__ import annotations

import unittest
import concurrent.futures
import threading
from unittest.mock import patch

from aim_next import Store
from aim_next.contract import LIMITS
from aim_next.migrations import STEPS, MigrationError, migrate
from aim_next.rail_dimming import DIM_SCHEMA
from aim_next.store import StoreOpenError, SCHEMA_VERSION
import test_store as fixtures
import test_outline_order as order_fixtures


def value(selected=0):
    return {"version": 1, "selected": selected,
            "sets": [{"focus": None, "outcomes": [], "topics": []},
                     {"focus": None, "outcomes": [], "topics": []}]}


class RailDimmingCase(unittest.TestCase):
    setUp = fixtures.StoreCase.setUp
    command = fixtures.StoreCase.command
    sql = fixtures.StoreCase.sql
    committed = order_fixtures.OutlineOrderCase.committed
    refused = order_fixtures.OutlineOrderCase.refused
    topic = order_fixtures.OutlineOrderCase.topic

    def world(self):
        self.committed(self.command("workspace.create", {"id": "w1", "title": "First", "team": ["agent-a"]}))
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second"}))
        self.topic("t1")
        self.topic("t2", "w2")

    def read(self, actor="owner", **args):
        answer = self.store.view(actor, "rail_dimming", args)
        self.assertNotIn("error", answer, answer)
        return answer

    def write(self, state, revision=0, actor="owner", op=None, **kwargs):
        return self.command("rail.dimming_set", {"value": state}, expected={"dim_revision": revision}, actor=actor, op=op, **kwargs)

    def test_default_is_private_dim_zero_and_two_empty_sets(self):
        expected = {"instance_id": "test-instance", "value": value(), "dim_revision": 0}
        self.assertEqual(self.read(), expected)
        self.assertEqual(self.read("agent-a"), expected)
        denied = self.store.view("agent-a", "rail_dimming", {"actor": "owner"})
        self.assertEqual(denied["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM rail_dimming"), [(0,)])

    def test_limit_is_advertised_and_validation_uses_the_same_backend_value(self):
        self.world()
        self.assertEqual(self.store.view("owner", "capabilities", {})["limits"]["rail_dim_choices"], 2048)
        state = value(1)
        state["sets"][0]["outcomes"] = [["w1", True], ["w2", True]]
        with patch.dict(LIMITS, rail_dim_choices=1):
            self.assertEqual(self.store.view("owner", "capabilities", {})["limits"]["rail_dim_choices"], 1)
            self.refused(self.write(state), "INVALID_ARGUMENT")
        self.assertEqual(self.read()["dim_revision"], 0)
        self.assertEqual(self.committed(self.write(value()))["dim_revision"], 1)

    def test_both_sets_and_inverse_focus_are_kept_for_only_the_actor(self):
        self.world()
        state = value(2)
        state["sets"][0] = {"focus": ["w1", "t1"], "outcomes": [["w2", False]], "topics": [["w1", "t1", False]]}
        state["sets"][1] = {"focus": ["w2", None], "outcomes": [["w1", True]], "topics": [["w2", "t2", False]]}
        result = self.committed(self.write(state))
        self.assertEqual(result, {"value": state, "dim_revision": 1, "changed": True})
        self.assertEqual(self.read(), {"instance_id": "test-instance", "value": state, "dim_revision": 1})
        self.assertEqual(self.read("agent-a"), {"instance_id": "test-instance", "value": value(), "dim_revision": 0})
        reopened = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(reopened.view("owner", "rail_dimming", {}), self.read())
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE resource_kind='rail_dimming'"),
                         [("actor", "owner", "rail_dimming", "owner", 1)])

    def test_noop_conflict_and_exact_retry_never_overwrite_newer_device(self):
        first = self.write(value(1), op="first-device")
        self.committed(first)
        self.assertEqual(self.committed(self.write(value(1), 1))["changed"], False)
        self.assertEqual(self.committed(self.write(value(2), 1))["dim_revision"], 2)
        self.assertEqual(self.write(value(1), op="first-device"), first, "lost receipt retries the original operation")
        self.refused(self.write(value(0), 1), "REVISION_CONFLICT")
        self.assertEqual(self.read(), {"instance_id": "test-instance", "value": value(2), "dim_revision": 2})
        self.assertEqual(self.sql("SELECT revision FROM rail_dimming WHERE actor_id='owner'"), [(2,)])

    def test_simultaneous_devices_have_one_winner_and_one_revision_conflict(self):
        barrier = threading.Barrier(2)
        def save(selected):
            barrier.wait()
            return self.write(value(selected), op="simultaneous-%d" % selected)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, (1, 2)))
        self.assertEqual(sorted(r["status"] for r in results), ["committed", "rejected"])
        winner = next(r for r in results if r["status"] == "committed")
        self.refused(next(r for r in results if r["status"] == "rejected"), "REVISION_CONFLICT")
        self.assertEqual(self.read()["value"], winner["result"]["value"])
        self.assertEqual(self.read()["dim_revision"], 1)

    def test_missing_revision_or_stale_authority_never_creates_a_preference(self):
        self.refused(self.command("rail.dimming_set", {"value": value(1)}), "INVALID_ARGUMENT")
        for invalid in (True, -1, 1.5, "0"):
            self.refused(self.write(value(1), revision=invalid), "INVALID_ARGUMENT")
        envelope = {"v": 1, "instance_id": "test-instance", "operation_id": "stale-authority",
                    "kind": "rail.dimming_set", "target": {}, "args": {"value": value(1)},
                    "expected": {"dim_revision": 0, "authority": dict(self.pin, authority_epoch="other-epoch")}}
        self.refused(self.store.command("owner", envelope), "AUTHORITY_CHANGED")
        self.assertEqual(self.read()["dim_revision"], 0)

    def dim_step(self):
        step = next((step for step in STEPS if step[2] is DIM_SCHEMA), None)
        self.assertIsNotNone(step, "The shipping schema chain includes the Dim layout")
        self.assertEqual(step[1], SCHEMA_VERSION)
        return step

    def test_empty_migration_roundtrip_preserves_ordinary_records_and_does_not_auto_upgrade(self):
        before, after = self.dim_step()[:2]
        self.world()
        ordinary = self.sql("SELECT id,title FROM workspaces ORDER BY id")
        sequence = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target=before)["migrated"])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='rail_dimming'"), [])
        with self.assertRaises(StoreOpenError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [(before,)])
        self.assertTrue(migrate(self.path, "test-instance", self.binding, target=after)["migrated"])
        self.assertFalse(migrate(self.path, "test-instance", self.binding, target=after)["migrated"])
        self.assertEqual(self.sql("SELECT id,title FROM workspaces ORDER BY id"), ordinary)
        self.assertGreater(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), sequence)
        self.assertEqual(self.read()["dim_revision"], 0)

    def test_even_an_explicit_empty_preference_blocks_lossy_downgrade_atomically(self):
        before = self.dim_step()[0]
        self.committed(self.write(value()))
        original = self.sql("SELECT * FROM metadata ORDER BY key"), self.sql("SELECT * FROM rail_dimming")
        with self.assertRaises(MigrationError) as failure:
            migrate(self.path, "test-instance", self.binding, target=before)
        self.assertEqual(failure.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual((self.sql("SELECT * FROM metadata ORDER BY key"), self.sql("SELECT * FROM rail_dimming")), original)
        self.assertEqual(self.read()["dim_revision"], 1)

    def test_current_target_authority_and_outcome_topic_binding_are_required(self):
        self.world()
        denied = value(1); denied["sets"][0]["outcomes"] = [["w2", True]]
        error = self.refused(self.write(denied, actor="agent-a"), "FORBIDDEN")
        denied["sets"][0]["outcomes"] = [["missing", True]]
        self.assertEqual(self.refused(self.write(denied, actor="agent-a"), "FORBIDDEN")["message"], error["message"])
        wrong = value(1); wrong["sets"][0]["topics"] = [["w1", "t2", True]]
        self.refused(self.write(wrong), "FORBIDDEN")
        self.refused(self.write(value(1), target={"actor_id": "agent-a"}), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM rail_dimming"), [(0,)])

    def test_malformed_bounds_and_duplicate_choices_are_atomic_refusals(self):
        self.world()
        states = [None, [], {"version": 1}, dict(value(), selected=True), dict(value(), selected=3), dict(value(), version=True), dict(value(), extra=True)]
        for field, bad in [("focus", ["w1"]), ("outcomes", [["w1", True], ["w1", False]]),
                           ("topics", [["w1", "t1", True], ["w1", "t1", False]]), ("outcomes", [["w1", 1]]),
                           ("outcomes", [["w%d" % n, True] for n in range(2049)])]:
            state = value(1); state["sets"][0][field] = bad; states.append(state)
        for state in states:
            with self.subTest(state=str(state)[:100]):
                self.refused(self.write(state), "INVALID_ARGUMENT")
        self.assertEqual(self.read(), {"instance_id": "test-instance", "value": value(), "dim_revision": 0})

    def test_access_revocation_filters_the_projection_without_resetting_revision(self):
        self.world()
        state = value(1); state["sets"][0] = {"focus": ["w1", "t1"], "outcomes": [["w1", True]], "topics": [["w1", "t1", False]]}
        self.committed(self.write(state, actor="agent-a"))
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-a'")
        self.assertEqual(self.read("agent-a"), {"instance_id": "test-instance", "value": value(1), "dim_revision": 1})
        self.assertEqual(self.sql("SELECT revision FROM rail_dimming WHERE actor_id='agent-a'"), [(1,)])

    def test_import_candidate_is_read_only_bounded_and_filters_only_explicit_readable_places(self):
        self.world()
        candidate = value(2)
        candidate["sets"][1] = {"focus": ["w2", "t2"], "outcomes": [["w1", True], ["w2", True]],
                                "topics": [["w1", "t1", True], ["w2", "t2", True], ["w1", "missing", True]]}
        answer = self.read("agent-a", candidate=candidate)
        expected = value(2)
        expected["sets"][1] = {"focus": None, "outcomes": [["w1", True]], "topics": [["w1", "t1", True]]}
        self.assertEqual(answer, {"instance_id": "test-instance", "value": value(), "dim_revision": 0, "candidate": expected})
        self.assertEqual(self.sql("SELECT count(*) FROM rail_dimming"), [(0,)])
        self.committed(self.write(value(1), actor="agent-a"))
        self.assertEqual(self.read("agent-a", candidate=candidate), self.read("agent-a"), "saved Core wins without a legacy candidate")
        malformed = self.store.view("agent-a", "rail_dimming", {"candidate": {"version": 2}})
        self.assertEqual(malformed["error"]["code"], "INVALID_ARGUMENT")


if __name__ == "__main__":
    unittest.main()

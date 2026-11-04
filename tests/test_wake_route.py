from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import tempfile
import unittest

from aim_next import initialize, Store
from aim_next.profile import write_profile
from aim_next.wake_adapter import RouteUnavailable, prepare_route


class WakeRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "instance.sqlite3"
        self.binding = initialize(self.db, "isolated-instance", [
            {"id": "fixture-recipient", "kind": "agent"},
            {"id": "fixture-other", "kind": "agent"}],
            authority_path=self.root / "authority.json")["binding"]
        self.store = Store(self.db, "isolated-instance", expected_binding=self.binding)
        self.guard = self.store.runner_guard("fixture-runner").__enter__()
        self.profile = self.root / "recipient.json"
        write_profile(self.profile, self.db, "isolated-instance", "fixture-recipient", binding=self.binding)
        self.route = self.root / "route.json"
        self.argv = ["/bin/cat", "literal;$(touch not-executed)", "one argument", "雪"]
        self.config = {"v": 1, "profile": str(self.profile), "argv": self.argv}
        self.put(self.config)
        self.claim = {"attempt_id": "attempt-1", "claim_token": "private-claim-token",
                      "recipient_id": "fixture-recipient", "wake_generation": 7,
                      "captured_seq": 19, "lease_until_ms": 123456,
                      "route_binding": {"instance_id": "isolated-instance", "actor_id": "fixture-recipient",
                                        "db_path": str(self.db), "authority_id": self.binding["authority_id"],
                                        "authority_epoch": self.binding["authority_epoch"]}}

    def tearDown(self):
        self.guard.close()
        self.tmp.cleanup()

    def put(self, value):
        self.route.write_text(json.dumps(value))
        self.route.chmod(0o600)

    def rejected(self, claim=None, route=None, guard=None):
        with self.assertRaises(RouteUnavailable) as caught:
            prepare_route(self.route if route is None else route,
                          self.claim if claim is None else claim,
                          self.guard if guard is None else guard)
        self.assertNotIn(str(self.root), str(caught.exception))
        self.assertNotIn("private-claim-token", str(caught.exception))

    def test_bound_route_preserves_literal_argv_and_captured_hint(self):
        before = self.db.read_bytes()
        prepared = prepare_route(self.route, self.claim, self.guard)
        self.assertEqual(prepared.argv, tuple([str(Path("/bin/cat").resolve())] + self.argv[1:]))
        self.assertEqual(json.loads(prepared.stdin), {
            "v": 1, "binding": self.claim["route_binding"],
            "wake_generation": 7, "attempt_id": "attempt-1"})
        self.assertLessEqual(len(prepared.stdin), 8192)
        self.assertNotIn(b"claim_token", prepared.stdin)
        self.assertNotIn(b"captured_seq", prepared.stdin)
        self.assertEqual(self.db.read_bytes(), before)
        self.claim["route_binding"]["actor_id"] = "mutated-after-prepare"
        self.config["argv"][1] = "changed-after-prepare"
        self.assertEqual(json.loads(prepared.stdin)["binding"]["actor_id"], "fixture-recipient")
        self.assertEqual(prepared.argv[1], "literal;$(touch not-executed)")

    def test_attempt_changes_do_not_change_captured_work_identity(self):
        first = json.loads(prepare_route(self.route, self.claim, self.guard).stdin)
        self.claim["attempt_id"] = "attempt-2"
        second = json.loads(prepare_route(self.route, self.claim, self.guard).stdin)
        self.assertEqual(first.pop("attempt_id"), "attempt-1")
        self.assertEqual(second.pop("attempt_id"), "attempt-2")
        self.assertEqual(first, second)

    def test_route_file_is_private_regular_bounded_and_not_a_symlink(self):
        self.rejected(route=self.root / "missing")
        self.route.chmod(0o644)
        self.rejected()
        self.route.chmod(0o600)
        alias = self.root / "alias"
        alias.symlink_to(self.route)
        self.rejected(route=alias)
        self.rejected(route=self.root)
        fifo = self.root / "fifo"
        os.mkfifo(fifo, 0o600)
        self.rejected(route=fifo)
        # Valid JSON plus padding distinguishes the size bound from parse errors.
        self.route.write_bytes(json.dumps(self.config).encode() + b" " * 65537)
        self.rejected()

    def test_config_rejects_duplicates_unknowns_and_invalid_argv(self):
        invalid = [dict(self.config, v=True), dict(self.config, v=2), dict(self.config, extra=1),
                   dict(self.config, profile="relative.json"), dict(self.config, argv=[]),
                   dict(self.config, argv=["relative"]), dict(self.config, argv=["/bin/cat", 1]),
                   dict(self.config, argv=["/bin/cat", "nul\x00"]),
                   dict(self.config, argv=["/bin/cat", "\ud800"]),
                   dict(self.config, argv=["/bin/cat"] + ["x"] * 32),
                   dict(self.config, argv=["/bin/cat", "雪" * 5500])]
        for value in invalid:
            with self.subTest(value=value):
                self.put(value)
                self.rejected()
        self.route.write_text(json.dumps(self.config).replace('"v": 1', '"v": 1, "v": 1'))
        self.rejected()

    def test_actual_profile_actor_and_each_claim_binding_field_must_match(self):
        other = self.root / "other.json"
        write_profile(other, self.db, "isolated-instance", "fixture-other", binding=self.binding)
        self.put(dict(self.config, profile=str(other)))
        self.rejected()
        self.put(self.config)
        for name, value in {"instance_id": "another-instance", "actor_id": "fixture-other",
                            "db_path": str(self.root / "different.sqlite3"),
                            "authority_id": "other-authority", "authority_epoch": "old-epoch"}.items():
            claim = copy.deepcopy(self.claim)
            claim["route_binding"][name] = value
            with self.subTest(field=name):
                self.rejected(claim=claim)

    def test_live_guard_must_match_profile_even_for_valid_other_database(self):
        root = self.root / "second"
        root.mkdir(mode=0o700)
        db = root / "instance.sqlite3"
        binding = initialize(db, "other-instance", [{"id": "fixture-recipient", "kind": "agent"}],
                             authority_path=root / "authority.json")["binding"]
        profile = root / "recipient.json"
        write_profile(profile, db, "other-instance", "fixture-recipient", binding=binding)
        self.put(dict(self.config, profile=str(profile)))
        claim = copy.deepcopy(self.claim)
        claim["route_binding"].update(instance_id="other-instance", db_path=str(db),
                                      authority_id=binding["authority_id"], authority_epoch=binding["authority_epoch"])
        self.rejected(claim=claim)
        self.put(self.config)
        self.guard.close()
        self.rejected()
        self.rejected(guard=object())

    def test_invalid_claim_shape_and_values_are_never_encoded(self):
        invalid = [dict(self.claim, wake_generation=True), dict(self.claim, wake_generation=-1),
                   dict(self.claim, captured_seq=-1), dict(self.claim, lease_until_ms=float('nan')),
                   dict(self.claim, attempt_id=""), dict(self.claim, claim_token="x\n"),
                   dict(self.claim, recipient_id="fixture-other"), dict(self.claim, body="private writing"),
                   dict(self.claim, route_binding=dict(self.claim["route_binding"], extra="x"))]
        missing = dict(self.claim)
        del missing["attempt_id"]
        invalid.append(missing)
        for claim in invalid:
            with self.subTest(keys=list(claim)):
                self.rejected(claim=claim)

    def test_entrypoint_and_its_resolved_parents_are_protected(self):
        directory = self.root / "bin"
        directory.mkdir(mode=0o700)
        executable = directory / "broker"
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o700)
        self.put(dict(self.config, argv=[str(executable)]))
        self.assertEqual(prepare_route(self.route, self.claim, self.guard).argv, (str(executable),))
        executable.chmod(0o720)
        self.rejected()
        executable.chmod(0o600)
        self.rejected()
        executable.chmod(0o700)
        directory.chmod(0o720)
        self.rejected()
        directory.chmod(0o700)
        self.put(dict(self.config, argv=[str(directory)]))
        self.rejected()


if __name__ == "__main__":
    unittest.main()

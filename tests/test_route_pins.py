from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import unittest
from unittest import mock

from aim_next import Store, StoreError, initialize
from aim_next import store as store_module
from aim_next.authority import AuthorityError, GuardBusy
from aim_next.contract import Refusal
from aim_next.route_pins import RoutePinError
import test_runner_effect_cleanup as effects
from test_runner_schedule import observed_connections


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


class RoutePinCase(effects.EffectCleanupCase):
    def setUp(self):
        super().setUp()
        self.root = self.path.parent.resolve()
        self.home = self.root / "codex-fixture"
        self.home.mkdir()
        self.other_home = self.root / "other-fixture"
        self.other_home.mkdir()
        self.destination = dict(kind="codex-queue-stdio", protocol_version=1,
                                codex_home=str(self.home), thread_id="12345678-1234-4234-8234-123456789abc")

    def expected_pin(self, actor="agent-a", destination=None):
        return dict(v=1, binding=dict(instance_id=self.store.instance_id, actor_id=actor,
                    db_path=str(self.store.path), authority_id=self.binding["authority_id"],
                    authority_epoch=self.binding["authority_epoch"]),
                    destination=dict(self.destination if destination is None else destination))

    def key(self, actor="agent-a"):
        return "route_pin.v1:" + hashlib.sha256(encoded(self.expected_pin(actor)["binding"]).encode()).hexdigest()

    def provision(self, guard, actor="agent-a", destination=None):
        method = getattr(self.store, "provision_route_pin", None)
        self.assertTrue(callable(method), "the explicit provision_route_pin API must exist")
        return method(guard, actor, self.destination if destination is None else destination)

    def read(self, actor="agent-a", destination=None):
        method = getattr(self.store, "read_route_pin", None)
        self.assertTrue(callable(method), "the compared read_route_pin API must exist")
        return method(actor, self.destination if destination is None else destination)

    def rejected(self, call, code, retryable=False):
        error = self.failure(call)
        self.assertIsInstance(error, StoreError)
        self.assertEqual(error.code, code)
        self.assertIs(error.retryable, retryable)
        return error

    def write(self, sql, params=()):
        db = sqlite3.connect(str(self.path))
        try:
            with db:
                db.execute(sql, params)
        finally:
            db.close()

    def stored(self):
        return self.sql("SELECT key,value FROM metadata WHERE key LIKE 'route_pin.v1:%' ORDER BY key")

    def ready(self):
        guard = self.guard()
        self.provision(guard)
        guard.close()

    def fence_released(self):
        fd = os.open(self.binding["authority_path"] + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(fd)

    def test_insert_retry_reopen_and_returned_copy_preserve_one_commit(self):
        guard = self.guard()
        before = self.identity()
        result = self.provision(guard)
        self.assertEqual(result, dict(instance_id="test-instance", status="provisioned", pin=self.expected_pin()))
        after = self.identity()
        self.assertEqual(int(after["commit_seq"]), int(before["commit_seq"]) + 1)
        self.assertNotEqual(after["commit_id"], before["commit_id"])
        self.assertEqual(self.stored(), [(self.key(), encoded(self.expected_pin()))])
        baseline = self.snapshot()
        result["pin"]["destination"]["thread_id"] = "caller mutation"
        guard.close()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        guard = self.guard("retry-after-lost-return")
        self.assertEqual(self.provision(guard)["status"], "existing")
        self.assertEqual(self.read(), self.expected_pin())
        self.assertEqual(self.snapshot(), baseline)
        self.held(guard)

    def test_semantically_identical_formatting_is_never_rewritten(self):
        guard = self.guard()
        self.provision(guard)
        raw = json.dumps(self.expected_pin(), indent=2)
        self.write("UPDATE metadata SET value=? WHERE key=?", (raw, self.key()))
        baseline = self.snapshot()
        self.assertEqual(self.provision(guard)["status"], "existing")
        self.assertEqual(self.read(), self.expected_pin())
        self.assertEqual(self.snapshot(), baseline)

    def test_changed_destination_refuses_without_overwrite(self):
        guard = self.guard()
        self.provision(guard)
        baseline = self.snapshot()
        for field, value in (("codex_home", str(self.other_home)),
                             ("thread_id", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")):
            with self.subTest(field=field):
                changed = dict(self.destination, **{field: value})
                self.rejected(lambda: self.provision(guard, destination=changed), "ROUTE_PIN_MISMATCH")
                self.rejected(lambda: self.read(destination=changed), "ROUTE_PIN_MISMATCH")
                self.assertEqual(self.snapshot(), baseline)

    def test_root_alias_is_captured_and_retargeting_refuses(self):
        alias = self.root / "alias"
        alias.symlink_to(self.home, target_is_directory=True)
        via_alias = dict(self.destination, codex_home=str(alias))
        guard = self.guard()
        self.assertEqual(self.provision(guard, destination=via_alias)["pin"], self.expected_pin())
        self.assertEqual(self.read(destination=via_alias), self.expected_pin())
        baseline = self.snapshot()
        alias.unlink()
        alias.symlink_to(self.other_home, target_is_directory=True)
        self.rejected(lambda: self.read(destination=via_alias), "ROUTE_PIN_MISMATCH")
        self.rejected(lambda: self.provision(guard, destination=via_alias), "ROUTE_PIN_MISMATCH")
        self.assertEqual(self.snapshot(), baseline)

    def test_missing_root_is_invalid_input_and_recreated_same_path_can_match(self):
        self.ready()
        baseline = self.snapshot()
        self.home.rmdir()
        self.rejected(self.read, "INVALID_ROUTE_DESTINATION")
        self.assertEqual(self.snapshot(), baseline)
        self.home.mkdir()
        self.assertEqual(self.read(), self.expected_pin(), "pin identifies a path string, not a directory inode")

    def test_invalid_destination_shapes_refuse_without_opening_or_writing(self):
        guard = self.guard()
        baseline = self.snapshot()
        invalid = [None, [], {}, dict(self.destination, extra=1)]
        for key, values in {
            "kind": ["owner-socket", None], "protocol_version": [True, 0, 2, 1.0],
            "codex_home": ["relative", "", str(self.path), str(self.root / "missing"), "\x00", "\ud800", None],
            "thread_id": [self.destination["thread_id"].upper(), "{12345678-1234-4234-8234-123456789abc}",
                          "12345678123442348234123456789abc", "bad", None, 1],
        }.items():
            invalid.extend(dict(self.destination, **{key: value}) for value in values)
        invalid.extend({key: value for key, value in self.destination.items() if key != omitted}
                       for omitted in self.destination)
        for destination in invalid:
            with self.subTest(destination=repr(destination)):
                with effects.effect_connections() as seen:
                    self.rejected(lambda: self.read(destination=destination) if destination is not None
                                  else self.store.read_route_pin("agent-a", None), "INVALID_ROUTE_DESTINATION")
                    self.rejected(lambda: self.store.provision_route_pin(guard, "agent-a", destination), "INVALID_ROUTE_DESTINATION")
                    self.assertEqual(seen["handles"], [])
        self.assertEqual(self.snapshot(), baseline)

    def test_missing_pin_read_does_not_register_and_actors_have_distinct_keys(self):
        baseline = self.snapshot()
        self.rejected(self.read, "ROUTE_PIN_MISSING")
        self.assertEqual(self.snapshot(), baseline)
        guard = self.guard()
        self.provision(guard)
        self.rejected(lambda: self.read("agent-b"), "ROUTE_PIN_MISSING")
        self.assertEqual(self.provision(guard, "agent-b")["status"], "provisioned")
        self.assertNotEqual(self.key(), self.key("agent-b"))
        self.assertEqual({key for key, _ in self.stored()}, {self.key(), self.key("agent-b")})
        self.assertEqual(self.read("agent-b"), self.expected_pin("agent-b"))

    def test_actor_must_remain_enabled_for_both_apis(self):
        guard = self.guard()
        self.provision(guard)
        self.write("UPDATE actors SET enabled=0 WHERE id='agent-a'")
        baseline = self.snapshot()
        for actor, code in (("agent-a", "INVALID_ACTOR"), ("absent", "INVALID_ACTOR"),
                            ("", "INVALID_ARGUMENT"), ("x" * 201, "INVALID_ARGUMENT")):
            with self.subTest(actor=actor):
                self.rejected(lambda: self.provision(guard, actor), code)
                self.rejected(lambda: self.read(actor), code)
        self.assertEqual(self.snapshot(), baseline)

    def test_foreign_full_binding_in_keyed_value_refuses(self):
        guard = self.guard()
        self.provision(guard)
        for field, value in (("actor_id", "agent-b"), ("instance_id", "other"),
                             ("authority_id", "other"), ("authority_epoch", "old"),
                             ("db_path", str(self.root / "other.sqlite3"))):
            with self.subTest(field=field):
                pin = self.expected_pin()
                pin["binding"][field] = value
                self.write("UPDATE metadata SET value=? WHERE key=?", (encoded(pin), self.key()))
                baseline = self.snapshot()
                self.rejected(self.read, "ROUTE_PIN_MISMATCH")
                self.rejected(lambda: self.provision(guard), "ROUTE_PIN_MISMATCH")
                self.assertEqual(self.snapshot(), baseline)

    def test_malformed_stored_values_refuse_and_are_preserved(self):
        guard = self.guard()
        self.provision(guard)
        good = self.expected_pin()
        invalid = ["not JSON", "[]", "null", encoded(good).replace('"v":1', '"v":1,"v":1'),
                   encoded(good).replace('"v":1', '"v":NaN'), encoded(dict(good, v=True)),
                   encoded(dict(good, extra=1)), encoded(dict(good, binding={})),
                   encoded(good).encode("utf-8"), "[" * 4096 + "]" * 4096,
                   encoded(dict(good, binding=dict(good["binding"], instance_id=""))),
                   encoded(dict(good, binding=dict(good["binding"], instance_id=5))),
                   encoded(dict(good, binding=dict(good["binding"], db_path=str(self.root) + "/./instance.sqlite3"))),
                   encoded(dict(good, destination=dict(self.destination, protocol_version=True))),
                   encoded(dict(good, destination=dict(self.destination, codex_home=str(self.home) + "/."))),
                   encoded(dict(good, destination=dict(self.destination, thread_id=1))),
                   encoded(dict(good, destination=dict(self.destination, thread_id="NOT-A-UUID")))]
        for raw in invalid:
            with self.subTest(raw=raw[:60]):
                self.write("UPDATE metadata SET value=? WHERE key=?", (raw, self.key()))
                baseline = self.snapshot()
                self.rejected(self.read, "ROUTE_PIN_INVALID")
                self.rejected(lambda: self.provision(guard), "ROUTE_PIN_INVALID")
                self.assertEqual(self.snapshot(), baseline)

    def test_oversized_valid_json_refuses_before_decode(self):
        self.ready()
        # Trailing whitespace is otherwise valid JSON: a parse error cannot
        # accidentally satisfy the byte-bound check.
        multibyte = self.expected_pin()
        multibyte["binding"]["actor_id"] = "雪" * 200
        text = encoded(multibyte)
        for raw in (encoded(self.expected_pin()) + " " * 8192, text + " " * (8192 - len(text))):
            with self.subTest(bytes=len(raw.encode("utf-8")), characters=len(raw)):
                self.assertGreater(len(raw.encode("utf-8")), 8192)
                self.write("UPDATE metadata SET value=? WHERE key=?", (raw, self.key()))
                baseline = self.snapshot()
                # Replace this module's reference, not json.loads shared by
                # the authority reader: the probe must target only pin decode.
                decoder = mock.Mock(wraps=json)
                decoder.loads.side_effect = AssertionError("oversized value reached decoder")
                with mock.patch("aim_next.route_pins.json", decoder):
                    self.rejected(self.read, "ROUTE_PIN_INVALID")
                self.assertEqual(self.snapshot(), baseline)

    def test_provision_needs_real_held_matching_guard(self):
        # Missing API itself is the red assertion, not AttributeError.
        self.assertTrue(callable(getattr(self.store, "provision_route_pin", None)))
        baseline = self.snapshot()
        self.rejected(lambda: self.provision(object()), "INVALID_GUARD")
        closed = self.guard()
        closed.close()
        self.rejected(lambda: self.provision(closed), "INVALID_BINDING")
        other = self.root / "other.sqlite3"
        info = initialize(other, "other-instance", [{"id": "agent-a", "kind": "agent"}],
                          authority_path=self.root / "other-control" / "authority.json")
        foreign = Store(other, "other-instance", expected_binding=info["binding"])
        with foreign.runner_guard("foreign") as guard:
            self.rejected(lambda: self.provision(guard), "INVALID_GUARD")
        self.assertEqual(self.snapshot(), baseline)

    def test_sql_value_fetch_is_byte_bounded(self):
        self.ready()
        self.write("UPDATE metadata SET value=? WHERE key=?", (encoded(self.expected_pin()) + " " * 24000, self.key()))
        connect = sqlite3.connect
        sizes, handles = [], []

        class Cursor:
            def __init__(self, cursor):
                self.cursor = cursor

            def fetchone(self):
                row = self.cursor.fetchone()
                sizes.append(len(row[1]))
                return row

        class Connection(sqlite3.Connection):
            def execute(self, sql, *args, **kwargs):
                cursor = super().execute(sql, *args, **kwargs)
                return Cursor(cursor) if sql.startswith("SELECT typeof(value)") else cursor

        def measured(*args, **kwargs):
            db = connect(*args, factory=Connection, **kwargs)
            handles.append(db)
            return db

        try:
            with mock.patch.object(sqlite3, "connect", measured):
                self.rejected(self.read, "ROUTE_PIN_INVALID")
            self.assertEqual(sizes, [8193], "SQL read must transfer at most the byte bound plus one overflow byte")
            self.assertEqual(len(handles), 1)
            with self.assertRaises(sqlite3.ProgrammingError):
                sqlite3.Connection.execute(handles[0], "SELECT 1")
        finally:
            for db in handles:
                sqlite3.Connection.close(db)

    def test_inherited_guard_prevents_new_provisioning_until_child_exits(self):
        guard = self.guard()
        program = "import sys; print('ready', flush=True); sys.stdin.buffer.read(1)"
        child = subprocess.Popen([sys.executable, "-I", "-c", program], pass_fds=guard.pass_fds,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(), b"ready\n")
            guard.close()
            with self.assertRaises(GuardBusy):
                with self.store.runner_guard("blocked") as later:
                    self.provision(later)
            self.assertEqual(self.stored(), [])
        finally:
            child.communicate(b"x", timeout=5)
        self.assertEqual(child.returncode, 0)
        self.assertEqual(self.provision(self.guard("after-child"))["status"], "provisioned")

    def test_new_epoch_requires_new_key_and_preserves_historical_pin(self):
        guard = self.guard()
        self.provision(guard)
        historical = self.stored()
        old_store = self.store
        guard.close()
        # Controlled fixture publication only; not an activation API/proof.
        anchor = Path(self.binding["authority_path"])
        record = json.loads(anchor.read_text())
        record["epoch"] = "controlled-new-epoch"
        self.write("UPDATE metadata SET value=? WHERE key='authority_epoch'", (record["epoch"],))
        anchor.write_text(json.dumps(record))
        self.binding = dict(self.binding, authority_epoch=record["epoch"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.rejected(lambda: old_store.read_route_pin("agent-a", self.destination), "AUTHORITY_CHANGED")
        self.rejected(self.read, "ROUTE_PIN_MISSING")
        self.assertEqual(self.stored(), historical)
        self.assertEqual(self.provision(self.guard("new-epoch"))["status"], "provisioned")
        self.assertEqual(len(self.stored()), 2)
        self.assertTrue(all(row in self.stored() for row in historical))
        self.assertEqual(self.read(), self.expected_pin())

    def test_read_and_retry_work_stays_bounded_with_unrelated_metadata(self):
        guard = self.guard()
        self.provision(guard)
        def measure():
            with observed_connections() as seen:
                self.assertEqual(self.read(), self.expected_pin())
                self.assertEqual(self.provision(guard)["status"], "existing")
            return seen
        before = measure()
        db = sqlite3.connect(str(self.path))
        try:
            with db:
                db.executemany("INSERT INTO metadata VALUES (?,?)", [("unrelated-%05d" % i, "x") for i in range(3000)])
                db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'agent','fixture')", [("unrelated-%05d" % i,) for i in range(3000)])
        finally:
            db.close()
        after = measure()
        self.assertGreater(before["vm_steps"], 0)
        self.assertLessEqual(after["vm_steps"], before["vm_steps"] + 150, "pin access must not scan unrelated metadata/actors")
        self.assertEqual(sum("route_pin.v1:" in sql for sql in after["sql"]), 2)

    def test_read_real_contention_and_cleanup_are_distinguished(self):
        self.ready()
        baseline = self.snapshot()
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            for begin, busy in (("BEGIN IMMEDIATE", False), ("BEGIN EXCLUSIVE", True)):
                writer.execute(begin)
                try:
                    with effects.effect_connections() as seen:
                        if busy:
                            self.rejected(self.read, "DATABASE_BUSY", True)
                        else:
                            self.assertEqual(self.read(), self.expected_pin())
                        self.closed(seen)
                        self.assertEqual(seen["events"], ["close"])
                        self.fence_released()
                finally:
                    writer.rollback()
        finally:
            writer.close()
        self.assertEqual(self.snapshot(), baseline)

    def test_1038_pin_read_does_not_label_busy_named_missing_table_as_contention(self):
        self.ready()
        # Execute actual invalid SQL after BEGIN, then observe the real typed
        # read result and cleanup; the table name is not a busy condition.
        def missing(db, statement):
            if statement == 'BEGIN':
                db.execute('SELECT * FROM busy_private_missing_table')
        with effects.effect_connections(before=missing) as seen:
            error = self.rejected(self.read, 'ROUTE_PIN_STORAGE_ERROR')
            self.assertIsInstance(error.__cause__, sqlite3.OperationalError)
            self.closed(seen)
            self.fence_released()

    def test_read_setup_body_and_close_faults_release_fence(self):
        self.ready()
        baseline = self.snapshot()
        for statement in ("PRAGMA synchronous=EXTRA", "BEGIN"):
            for original in (sqlite3.OperationalError("disk I/O error"), OSError("read I/O"), KeyboardInterrupt("read interrupted")):
                with self.subTest(statement=statement, error=type(original).__name__):
                    with effects.effect_connections(before=effects.fail_at(statement, original)) as seen:
                        error = self.failure(self.read)
                        self.closed(seen)
                        if isinstance(original, KeyboardInterrupt):
                            self.assertIs(error, original)
                        else:
                            self.assertIsInstance(error, StoreError)
                            self.assertEqual(error.code, "ROUTE_PIN_STORAGE_ERROR")
                            self.assertIs(error.__cause__, original)
                        self.fence_released()
        for close in (sqlite3.OperationalError("busy closing"), OSError("close I/O"), KeyboardInterrupt("close interrupted")):
            for setup in (None, sqlite3.DatabaseError("setup")):
                with self.subTest(close=type(close).__name__, setup=setup is not None):
                    with effects.effect_connections(before=effects.fail_at("PRAGMA synchronous=EXTRA", setup) if setup else None,
                                                    close_error=close) as seen:
                        error = self.rejected(self.read, "ROUTE_PIN_STORAGE_ERROR")
                        self.still_open(seen)
                        self.assertIs(error.__cause__, close)
                        if setup:
                            self.assertIs(close.__cause__, setup)
                        self.fence_released()
        self.assertEqual(self.snapshot(), baseline)

    def test_read_success_and_refusal_close_handle_and_fence(self):
        self.ready()
        for actor, code in (("agent-a", None), ("agent-b", "ROUTE_PIN_MISSING"), ("missing", "INVALID_ACTOR")):
            with effects.effect_connections() as seen:
                if code:
                    self.rejected(lambda: self.read(actor), code)
                else:
                    self.assertEqual(self.read(actor), self.expected_pin())
                self.closed(seen)
                self.fence_released()

    def test_postcommit_close_failure_is_uncertain_and_same_value_retry_is_exact(self):
        guard = self.guard()
        before = self.identity()
        with effects.effect_connections(close_error=OSError("failed close")) as seen:
            self.rejected(lambda: self.provision(guard), "RUNNER_STORAGE_ERROR")
            self.still_open(seen)
            self.assertIn("COMMIT", seen["sql"])
        self.assertEqual(int(self.identity()["commit_seq"]), int(before["commit_seq"]) + 1)
        self.assertNotEqual(self.identity()["commit_id"], before["commit_id"])
        baseline = self.snapshot()
        self.assertEqual(self.provision(guard)["status"], "existing")
        self.assertEqual(self.read(), self.expected_pin())
        self.assertEqual(self.snapshot(), baseline)

    def test_supplied_root_cannot_traverse_a_regular_file(self):
        guard = self.guard()
        self.provision(guard)
        regular = self.home / "regular-file"
        regular.write_text("fixture")
        supplied = str(regular) + "/.."
        self.assertFalse(os.path.isdir(supplied), "fixture must fail the kernel directory lookup")
        destination = dict(self.destination, codex_home=supplied)
        baseline = self.snapshot()
        for action in (lambda: self.read(destination=destination), lambda: self.provision(guard, destination=destination)):
            with self.subTest(action=action):
                with effects.effect_connections() as seen:
                    self.rejected(action, "INVALID_ROUTE_DESTINATION")
                    self.assertEqual(seen["handles"], [], "invalid supplied path must refuse before SQLite")
        self.assertEqual(self.snapshot(), baseline)

    def test_stored_double_leading_slashes_are_invalid(self):
        guard = self.guard()
        self.provision(guard)
        for section, field in (("destination", "codex_home"), ("binding", "db_path")):
            pin = self.expected_pin()
            pin[section][field] = "/" + pin[section][field]
            self.write("UPDATE metadata SET value=? WHERE key=?", (encoded(pin), self.key()))
            baseline = self.snapshot()
            for action in (self.read, lambda: self.provision(guard)):
                with self.subTest(field=field, action=action):
                    self.rejected(action, "ROUTE_PIN_INVALID")
            self.assertEqual(self.snapshot(), baseline)

    def test_read_durability_refusal_is_typed_after_cleanup(self):
        self.ready()
        baseline = self.snapshot()
        connect, originals = store_module._connect, []

        def capture(path):
            try:
                return connect(path)
            except StoreError as error:
                originals.append(error)
                raise

        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            self.assertEqual(db.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
        finally:
            db.close()
        try:
            with effects.effect_connections() as seen:
                with mock.patch.object(store_module, "_connect", capture):
                    error = self.failure(self.read)
                self.closed(seen)
                self.fence_released()
                self.assertEqual(len(originals), 1)
                self.assertIsInstance(error, RoutePinError, "setup durability refusal must have the pin error contract")
                self.assertEqual(error.code, "ROUTE_PIN_STORAGE_ERROR")
                self.assertIs(error.retryable, False)
                self.assertIs(error.__cause__, originals[0])
        finally:
            db = sqlite3.connect(str(self.path), isolation_level=None)
            try:
                self.assertEqual(db.execute("PRAGMA journal_mode=DELETE").fetchone()[0], "delete")
            finally:
                db.close()
        self.assertEqual(self.snapshot(), baseline)
        self.assertEqual(self.read(), self.expected_pin())

    def test_surrogate_actor_refuses_before_open(self):
        guard = self.guard()
        baseline = self.snapshot()
        for action in (lambda: self.read("\ud800"), lambda: self.provision(guard, "\ud800")):
            with self.subTest(action=action):
                with effects.effect_connections() as seen:
                    self.rejected(action, "INVALID_ARGUMENT")
                    self.assertEqual(seen["handles"], [])
        self.assertEqual(self.snapshot(), baseline)

    def test_read_rechecks_instance_schema_and_binding_in_place(self):
        self.ready()
        for key, value, code, error_type in (
                ("instance_id", "foreign-instance", "INSTANCE_MISMATCH", Refusal),
                ("schema_version", "-1", "SCHEMA_MISMATCH", Refusal),
                ("authority_epoch", "foreign-epoch", "AUTHORITY_CHANGED", AuthorityError)):
            with self.subTest(key=key):
                previous = self.sql("SELECT value FROM metadata WHERE key=?", (key,))[0][0]
                self.write("UPDATE metadata SET value=? WHERE key=?", (value, key))
                baseline = self.snapshot()
                try:
                    with effects.effect_connections() as seen:
                        error = self.failure(self.read)
                        self.closed(seen)
                        self.fence_released()
                        self.assertIsInstance(error, error_type)
                        self.assertEqual(error.code, code)
                    self.assertEqual(self.snapshot(), baseline)
                finally:
                    self.write("UPDATE metadata SET value=? WHERE key=?", (previous, key))

    def test_read_post_open_fence_detects_replaced_database(self):
        self.ready()
        baseline = self.snapshot()
        original = self.path.with_name("original.sqlite3")
        replacement = self.path.with_name("replacement.sqlite3")
        shutil.copy2(self.path, replacement)
        swapped = []

        def swap(db, sql):
            if sql == "BEGIN":
                self.path.rename(original)
                replacement.rename(self.path)
                swapped.append(True)

        try:
            with observed_connections(after=swap) as seen:
                error = self.failure(self.read)
                self.assertEqual(len(seen["handles"]), 1)
                self.assertEqual(seen["handles"][0].close_calls, 1)
                with self.assertRaises(sqlite3.ProgrammingError):
                    sqlite3.Connection.execute(seen["handles"][0], "SELECT 1")
                self.fence_released()
                self.assertIsInstance(error, AuthorityError)
                self.assertEqual(error.code, "AUTHORITY_CHANGED")
            self.assertEqual(swapped, [True])
        finally:
            if swapped:
                self.path.rename(replacement)
                original.rename(self.path)
        self.assertEqual(self.snapshot(), baseline)
        self.assertEqual(self.read(), self.expected_pin())

    def test_single_snapshot_blocks_actor_disable_between_checks(self):
        self.ready()
        expected = self.expected_pin()
        writer = sqlite3.connect(str(self.path), isolation_level=None, timeout=0)
        attempts, trace = [], []
        writer.set_trace_callback(trace.append)

        def interleave(db, sql):
            if sql.startswith("SELECT typeof(value)"):
                writer.execute("BEGIN IMMEDIATE")
                writer.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
                try:
                    writer.commit()
                except sqlite3.OperationalError as error:
                    attempts.append(dict(outcome="blocked", error=str(error)))
                else:
                    attempts.append(dict(outcome="committed"))

        try:
            with effects.effect_connections(before=interleave) as seen:
                result = self.read()
                self.closed(seen)
                self.fence_released()
            # A failed COMMIT retains PENDING, which blocks a new inspection
            # reader too. Release that attempt before observing committed state.
            if writer.in_transaction:
                writer.rollback()
            enabled = self.sql("SELECT enabled FROM actors WHERE id='agent-a'")[0][0]
            print(json.dumps(dict(probe="route_pin_snapshot", attempts=attempts,
                                  read_returned_expected_pin=result == expected,
                                  actor_enabled_after_read=enabled, writer_sql=trace)), flush=True)
            self.assertEqual(result, expected)
            self.assertEqual(len(attempts), 1)
            self.assertIn("COMMIT", trace)
            self.assertEqual(attempts[0]["outcome"], "blocked", "actor disable must not commit between snapshot queries")
            self.assertIn("locked", attempts[0]["error"])
            self.assertEqual(enabled, 1)
            writer.execute("BEGIN IMMEDIATE")
            writer.execute("UPDATE actors SET enabled=0 WHERE id='agent-a'")
            writer.commit()
            self.assertEqual(self.sql("SELECT enabled FROM actors WHERE id='agent-a'"), [(0,)])
            self.rejected(self.read, "INVALID_ACTOR")
        finally:
            try:
                if writer.in_transaction:
                    writer.rollback()
            finally:
                writer.close()


for _base in effects.EffectCleanupCase.__mro__:
    for _name in _base.__dict__:
        if _name.startswith("test_") and _name not in RoutePinCase.__dict__:
            setattr(RoutePinCase, _name, None)


if __name__ == "__main__":
    unittest.main()

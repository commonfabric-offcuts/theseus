from __future__ import annotations

import json
import fcntl
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

from aim_next import Store, StoreError, initialize
from aim_next import store as store_module


class AuthorityCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aim-next-authority-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / "data" / "instance.sqlite3"
        self.anchor = self.root / "external-control" / "authority.json"
        self.info = initialize(self.path, "authority-test", [{"id": "owner", "kind": "human"}], authority_path=self.anchor)
        self.binding = self.info["binding"]
        self.store = Store(self.path, "authority-test", expected_binding=self.binding)

    def create(self, op="once", **args):
        return self.store.command("owner", {"v": 1, "instance_id": "authority-test", "operation_id": op,
                                 "kind": "workspace.create", "target": {}, "expected": {},
                                 "args": dict(id="w1", title="One", **args)})

    def sql(self, statement, params=()):
        with sqlite3.connect(str(self.path)) as db:
            return db.execute(statement, params).fetchall()

    def test_binding_is_explicit_and_copying_database_or_profile_cannot_activate_it(self):
        self.assertEqual(set(self.binding), {"authority_path", "authority_id", "authority_epoch"})
        self.assertEqual(self.store.binding, self.binding)
        self.create()
        copy = self.root / "copy.sqlite3"
        shutil.copy2(self.path, copy)
        with self.assertRaises(StoreError):
            Store(copy, "authority-test", expected_binding=self.binding)
        with self.assertRaises(StoreError):
            Store(self.path, "authority-test", expected_binding={})
        wrong = dict(self.binding, authority_epoch="another-epoch")
        with self.assertRaises(StoreError):
            Store(self.path, "authority-test", expected_binding=wrong)
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(1,)])

    def test_every_recorded_commit_advances_comparison_sequence_but_attempts_and_retries_do_not(self):
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("0",)])
        first = self.create()
        self.assertEqual(first["status"], "committed")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("1",)])
        self.assertEqual(self.create(), first)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("1",)])
        rejected = self.create(op="invalid-recipient", team=["absent"])
        self.assertTrue(rejected["recorded"])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("2",)])
        private = self.store.command("owner", {"v": 1, "instance_id": "authority-test", "operation_id": "private",
            "kind": "draft.save", "target": {"draft_id": "d1"}, "expected": {"draft_revision": 0},
            "args": {"source_ref": {"kind": "new_topic", "id": "opening", "workspace_id": "w1"},
                     "topic_id": "t1", "body": "Private writing", "generation": "gA"}})
        self.assertEqual(private["status"], "committed", private)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("3",)])
        attempt = self.store.command("owner", {"instance_id": "other"})
        self.assertFalse(attempt["recorded"])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("3",)])

    def test_exclusive_fence_yields_unrecorded_busy_and_retry_can_commit(self):
        fd = os.open(str(self.anchor) + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.create()
            self.assertFalse(result["recorded"])
            self.assertEqual(result["error"]["code"], "AUTHORITY_BUSY")
            self.assertTrue(result["error"]["retryable"])
        finally:
            os.close(fd)
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])
        self.assertEqual(self.create()["status"], "committed")

    def test_command_fence_is_still_held_when_sqlite_commits(self):
        anchor = self.anchor
        checked = []

        class CheckingConnection(sqlite3.Connection):
            def commit(connection):
                fd = os.open(str(anchor) + ".lock", os.O_RDWR)
                try:
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        checked.append(True)
                    else:
                        raise AssertionError("Command released its authority fence before COMMIT")
                finally:
                    os.close(fd)
                return super().commit()

        original_connect = sqlite3.connect

        def checking_connect(*args, **kwargs):
            return original_connect(*args, factory=CheckingConnection, **kwargs)

        with mock.patch.object(store_module.sqlite3, "connect", checking_connect):
            self.assertEqual(self.create()["status"], "committed")
        self.assertEqual(checked, [True])

    def test_noncanonical_commit_sequence_is_refused(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE metadata SET value=? WHERE key='commit_seq'", ("١",))
        with self.assertRaises(StoreError):
            Store(self.path, "authority-test", expected_binding=self.binding)

    def test_authority_binding_refuses_noncanonical_paths_before_opening(self):
        alias = self.root / "control-alias"
        alias.symlink_to(self.anchor.parent, target_is_directory=True)
        for path in (str(alias / self.anchor.name), str(self.anchor.parent) + "/./" + self.anchor.name,
                     str(self.anchor.parent) + "/../" + self.anchor.parent.name + "/" + self.anchor.name):
            with self.subTest(path=path):
                with self.assertRaises(StoreError):
                    Store(self.path, "authority-test", expected_binding=dict(self.binding, authority_path=path))
        fresh = self.root / "fresh.sqlite3"
        with self.assertRaises(StoreError):
            initialize(fresh, "fresh", [{"id": "owner"}], authority_path=alias / "fresh.json")
        self.assertFalse((self.anchor.parent / "fresh.json").exists())

    def test_pinned_store_checks_current_anchor_without_rewriting_old_receipts(self):
        self.create()
        before = self.sql("SELECT * FROM operations")
        record = json.loads(self.anchor.read_text())
        record["epoch"] = "new-epoch"
        # Controlled cutover fixture, not a claim that activation is implemented.
        self.anchor.write_text(json.dumps(record))
        for result in (self.create(op="later"), self.store.view("owner", "capabilities", {})):
            self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
            self.assertFalse(result["error"]["retryable"])
        self.assertEqual(self.sql("SELECT * FROM operations"), before)

    def test_capabilities_pin_authority_and_require_explicit_continuity_facts(self):
        expected = {"authority_id": self.binding["authority_id"], "authority_epoch": self.binding["authority_epoch"], "continuity": "initial"}
        self.assertEqual(self.store.view("owner", "capabilities", {}).get("authority"), expected)
        record = json.loads(self.anchor.read_text())
        self.assertEqual(record["recovery"], {"kind": "initial", "history_complete": True})
        cases = [(None, "unknown"), ({}, "unknown"), ({"history_complete": "true"}, "unknown"),
                 ({"history_complete": 1}, "unknown"), ([], "unknown"),
                 ({"history_complete": False}, "incomplete"), ({"history_complete": True}, "complete")]
        for recovery, continuity in cases:
            with self.subTest(recovery=recovery):
                if recovery is None:
                    record.pop("recovery", None)
                else:
                    record["recovery"] = recovery
                self.anchor.write_text(json.dumps(record))
                facts = self.store.view("owner", "capabilities", {})["authority"]
                self.assertEqual(facts, dict(expected, continuity=continuity))
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("0",)])

    def test_schema_mismatch_is_refused_before_writing(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE metadata SET value='unsupported' WHERE key='schema_version'")
        with self.assertRaises(StoreError):
            Store(self.path, "authority-test", expected_binding=self.binding)
        result = self.create()
        self.assertFalse(result["recorded"])
        self.assertEqual(result["error"]["code"], "SCHEMA_MISMATCH")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])

    def test_database_binding_mismatch_preserves_typed_refusal_at_every_entry(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE metadata SET value='other-epoch' WHERE key='authority_epoch'")
        with self.assertRaises(StoreError) as caught:
            Store(self.path, "authority-test", expected_binding=self.binding)
        self.assertEqual(getattr(caught.exception, "code", None), "AUTHORITY_CHANGED")
        self.assertFalse(caught.exception.retryable)
        self.assertIn("activate a recovery copy at a new path", str(caught.exception))
        for result in (self.create(), self.store.view("owner", "capabilities", {})):
            self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
            self.assertFalse(result["error"]["retryable"])
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("0",)])

    def test_file_replacement_and_replaced_lock_fail_closed_with_recovery_direction(self):
        replacement = self.root / "replacement.sqlite3"
        shutil.copy2(self.path, replacement)
        os.replace(str(replacement), str(self.path))
        result = self.create()
        self.assertFalse(result["recorded"])
        self.assertIn("activate a recovery copy at a new path", result["error"]["message"])
        self.assertFalse(result["error"]["retryable"])

    def test_stable_lock_inode_cannot_be_recreated_to_split_the_fence(self):
        lock = Path(str(self.anchor) + ".lock")
        with self.store.runner_guard("holder"):
            lock.unlink()
            lock.touch(mode=0o600)
            result = self.create()
            self.assertFalse(result["recorded"])
            self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])

    def test_runner_guard_is_nonblocking_and_opening_store_has_no_effects(self):
        before = self.sql("SELECT value FROM metadata WHERE key='commit_seq'")
        other = Store(self.path, "authority-test", expected_binding=self.binding)
        with self.store.runner_guard("first") as held:
            self.assertEqual(len(held.pass_fds), 2)
            started = time.monotonic()
            with self.assertRaises(StoreError) as caught:
                with other.runner_guard("second"):
                    self.fail("Second runner entered")
            self.assertEqual(caught.exception.code, "blocked_by_guard")
            self.assertLess(time.monotonic() - started, 0.25)
        with other.runner_guard("second"):
            pass
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), before)

    def test_guard_survives_parent_close_and_parent_death_until_owned_child_exits(self):
        parent_program = r'''
import json, os, subprocess, sys, time
from pathlib import Path
from aim_next import Store
path, binding, ready, release, mode = sys.argv[1:]
store = Store(path, "authority-test", expected_binding=json.loads(binding))
child_program = "from pathlib import Path; import sys,time; ready,release=sys.argv[1:]; Path(ready).write_text('ready'); deadline=time.monotonic()+6\nwhile not Path(release).exists() and time.monotonic()<deadline: time.sleep(.01)"
with store.runner_guard("parent") as guard:
    child = subprocess.Popen([sys.executable, "-c", child_program, ready, release], pass_fds=guard.pass_fds,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic()+3
    while not Path(ready).exists() and time.monotonic()<deadline: time.sleep(.01)
    if not Path(ready).exists(): raise RuntimeError("child did not start")
    if mode == "death": os._exit(0)
'''
        for mode in ("close", "death"):
            with self.subTest(mode=mode):
                ready, release = self.root / (mode + ".ready"), self.root / (mode + ".release")
                env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
                process = subprocess.Popen([sys.executable, "-c", parent_program, str(self.path), json.dumps(self.binding),
                                            str(ready), str(release), mode], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    out, err = process.communicate(timeout=4)
                    self.assertEqual(process.returncode, 0, (out, err))
                    self.assertTrue(ready.exists())
                    anchor_fd = os.open(str(self.anchor) + ".lock", os.O_RDWR)
                    try:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(anchor_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    finally:
                        os.close(anchor_fd)
                    with self.assertRaises(StoreError):
                        with self.store.runner_guard("replacement"):
                            self.fail("Guard released while the owned child was alive")
                finally:
                    release.write_text("finish")
                deadline = time.monotonic() + 3
                while True:
                    try:
                        with self.store.runner_guard("replacement"):
                            break
                    except StoreError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.01)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

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
from aim_next import authority as authority_module
import test_authority as fixture


class AuthorityReviewCase(fixture.AuthorityCase):
    def another_workspace(self, operation):
        return self.store.command("owner", {"v": 1, "instance_id": "authority-test", "operation_id": operation,
            "kind": "workspace.create", "target": {}, "expected": {}, "args": {"id": "w2", "title": "Second"}})

    def test_replacement_between_validation_and_open_never_records_in_the_copy(self):
        self.create()
        original_connect = store_module._connect
        for surface in ("command", "view", "constructor"):
            with self.subTest(surface=surface):
                replacement, original = self.root / (surface + "-copy.sqlite3"), self.root / (surface + "-original.sqlite3")
                shutil.copy2(self.path, replacement)
                before = self.path.read_bytes()
                swapped = []
                def swapped_connect(path):
                    if not swapped:
                        os.replace(str(self.path), str(original))
                        os.replace(str(replacement), str(self.path))
                        swapped.append(True)
                    return original_connect(path)
                try:
                    with mock.patch.object(store_module, "_connect", swapped_connect):
                        if surface == "constructor":
                            with self.assertRaises(StoreError) as caught:
                                Store(self.path, "authority-test", expected_binding=self.binding)
                            self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")
                        else:
                            result = self.another_workspace("in-copy") if surface == "command" else self.store.view("owner", "operation", {"operation_id": "once"})
                            self.assertIn("error", result, result)
                            self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
                            if surface == "command":
                                self.assertFalse(result["recorded"])
                    self.assertTrue(swapped)
                    self.assertEqual(original.read_bytes(), before)
                    self.assertEqual(self.path.read_bytes(), before)
                finally:
                    if swapped:
                        os.replace(str(self.path), str(replacement))
                        os.replace(str(original), str(self.path))
        self.assertEqual(self.sql("SELECT id FROM operations"), [("once",)])

    def test_opened_copy_cannot_take_a_write_after_path_is_restored(self):
        self.create()
        replacement, original = self.root / "opened-copy.sqlite3", self.root / "opened-original.sqlite3"
        shutil.copy2(self.path, replacement)
        before = self.path.read_bytes()
        connect = store_module._connect
        def aba_connect(path):
            os.replace(str(self.path), str(original))
            os.replace(str(replacement), str(self.path))
            try:
                connection = connect(path)
            finally:
                os.replace(str(self.path), str(replacement))
                os.replace(str(original), str(self.path))
            return connection
        with mock.patch.object(store_module, "_connect", aba_connect):
            try:
                result = self.another_workspace("in-open-copy")
            except StoreError:
                result = {"recorded": False}
        self.assertFalse(result["recorded"], result)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(replacement.read_bytes(), before)

    def test_runner_inode_is_checked_on_enter_verify_and_pass_fds(self):
        runner_lock = Path(str(self.anchor) + ".runner.lock")
        with self.store.runner_guard("first") as guard:
            parked = runner_lock.with_name("parked-runner-lock")
            os.replace(str(runner_lock), str(parked))
            runner_lock.touch(mode=0o600)
            for operation in (lambda: self.store.runner_guard("second").__enter__(), guard.verify, lambda: guard.pass_fds):
                with self.subTest(operation=operation):
                    with self.assertRaises(StoreError) as caught:
                        operation()
                    self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")

    def test_guard_revalidates_anchor_before_verify_and_passing_descriptors(self):
        with self.store.runner_guard("held") as guard:
            record = json.loads(self.anchor.read_text())
            record["epoch"] = "changed-after-acquisition"
            self.anchor.write_text(json.dumps(record))
            for operation in (guard.verify, lambda: guard.pass_fds):
                with self.subTest(operation=operation):
                    with self.assertRaises(StoreError) as caught:
                        operation()
                    self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")

    def test_held_authority_descriptor_must_still_name_the_current_lock_path(self):
        with self.store.runner_guard("held") as guard:
            lock = Path(str(self.anchor) + ".lock")
            os.replace(str(lock), str(self.root / "old-authority-lock"))
            lock.touch(mode=0o600)
            with self.assertRaises(StoreError) as caught:
                guard.verify()
            self.assertEqual(caught.exception.code, "AUTHORITY_CHANGED")

    def test_database_mode_and_owner_are_checked_before_use(self):
        self.path.chmod(0o644)
        result = self.create()
        self.assertFalse(result["recorded"])
        self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.path.chmod(0o600)
        real_stat = authority_module.os.stat
        def another_owner(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if str(path) == str(self.path):
                parts = list(result)
                parts[4] = os.getuid() + 1
                return os.stat_result(parts)
            return result
        with mock.patch.object(authority_module.os, "stat", another_owner):
            result = self.create()
        self.assertFalse(result["recorded"])
        self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])

    def test_anchor_state_instance_and_parser_are_fail_closed(self):
        record = json.loads(self.anchor.read_text())
        for field, value in (("state", "staged"), ("instance_id", "other"), ("authority_id", "other-authority"),
                             ("db_path", str(self.root / "other.sqlite3")), ("unknown_extra", "ignored"), ("recovery", float("nan"))):
            with self.subTest(field=field):
                self.anchor.write_text(json.dumps(dict(record, **{field: value})))
                result = self.create(op="bad-anchor")
                self.assertFalse(result["recorded"])
                self.assertEqual(result["error"]["code"], "AUTHORITY_CHANGED")
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])

    def test_failed_initialization_never_publishes_active_anchor(self):
        path, anchor = self.root / "failed.sqlite3", self.root / "new-control" / "authority.json"
        with self.assertRaises(StoreError):
            initialize(path, "failed", [{"id": "bad", "kind": "unsupported"}], authority_path=anchor)
        self.assertTrue(path.exists())
        self.assertFalse(anchor.exists())

    def test_second_enter_is_invalid_without_losing_the_first_guard(self):
        with self.store.runner_guard("first") as guard:
            descriptors = guard.pass_fds
            with self.assertRaises(StoreError) as caught:
                guard.__enter__()
            self.assertEqual(caught.exception.code, "INVALID_BINDING")
            self.assertEqual(guard.pass_fds, descriptors)
            with self.assertRaises(StoreError):
                self.store.runner_guard("second").__enter__()

    def test_contended_runner_is_retryable_and_nonblocking_in_an_owned_process(self):
        program = r'''
import faulthandler,json,sys
from aim_next import Store,StoreError
faulthandler.dump_traceback_later(1,exit=True)
store=Store(sys.argv[1],"authority-test",expected_binding=json.loads(sys.argv[2]))
try:
    with store.runner_guard("contender"): raise AssertionError("entered")
except StoreError as error:
    assert error.code == "blocked_by_guard", error
    assert error.retryable, error
finally:
    faulthandler.cancel_dump_traceback_later()
'''
        with self.store.runner_guard("holder"):
            result = subprocess.run([sys.executable, "-c", program, str(self.path), json.dumps(self.binding)],
                env=dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1])), capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)


for _name in list(fixture.AuthorityCase.__dict__):
    if _name.startswith("test_") and _name not in AuthorityReviewCase.__dict__:
        setattr(AuthorityReviewCase, _name, None)


if __name__ == "__main__":
    unittest.main()

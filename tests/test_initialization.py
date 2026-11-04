from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from aim_next import Store, StoreError, initialize
from aim_next import store as store_module
from aim_next import authority as authority_module
import test_authority as fixture


class InitializationCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aim-next-init-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.path = self.root / "data" / "new.sqlite3"
        self.anchor = self.root / "control" / "authority.json"
        self.actors = [{"id": "owner", "kind": "human"}]

    def initialize(self, **args):
        return initialize(args.get("db_path", self.path), "new-instance", args.get("actors", self.actors), authority_path=args.get("authority_path", self.anchor))

    def marker(self):
        return Path(str(self.anchor) + ".initialization.json")

    def test_invalid_actor_list_is_typed_and_creates_no_paths(self):
        for actors in (None, [None], [{}], [{"id": "owner", "kind": "unsupported"}], [{"id": "a"}, {"id": "a"}], [{"id": "a", "name": []}]):
            with self.subTest(actors=actors):
                with self.assertRaises(StoreError):
                    self.initialize(actors=actors)
                self.assertEqual(list(self.root.iterdir()), [])

    def test_bad_paths_are_typed_and_create_no_database_or_control_files(self):
        for db_path, anchor in ((Path("relative.sqlite3"), self.anchor), (self.path, str(self.anchor.parent) + "/./authority.json")):
            with self.subTest(db_path=db_path, anchor=anchor):
                with self.assertRaises(StoreError):
                    self.initialize(db_path=db_path, authority_path=anchor)
                self.assertEqual(list(self.root.iterdir()), [])

    def test_control_database_collisions_are_invalid_before_creating_any_paths(self):
        for db_path in (self.anchor, Path(str(self.anchor) + ".lock"), self.anchor.parent):
            with self.subTest(db_path=db_path):
                with self.assertRaises(StoreError):
                    self.initialize(db_path=db_path)
                self.assertEqual(list(self.root.iterdir()), [])

    def test_missing_lock_after_creation_failure_still_names_incomplete_initialization(self):
        with mock.patch.object(store_module, "prepare_authority", side_effect=OSError("forced lock failure")):
            with self.assertRaises(StoreError) as caught:
                self.initialize()
        self.assertEqual(caught.exception.code, "INITIALIZATION_INCOMPLETE")
        with self.assertRaises(StoreError) as opening:
            Store(self.path, "new-instance", expected_binding={"authority_path": str(self.anchor), "authority_id": "unknown", "authority_epoch": "unknown"})
        self.assertEqual(opening.exception.code, "INITIALIZATION_INCOMPLETE")

    def test_post_creation_failure_is_named_retained_and_refuses_same_paths(self):
        with mock.patch.object(store_module, "_connect", side_effect=sqlite3.OperationalError("forced isolated failure")):
            with self.assertRaises(StoreError) as caught:
                self.initialize()
        self.assertEqual(caught.exception.code, "INITIALIZATION_INCOMPLETE")
        self.assertNotIn(str(self.root), str(caught.exception))
        self.assertTrue(self.path.exists())
        self.assertTrue(Path(str(self.anchor) + ".lock").exists())
        self.assertFalse(self.anchor.exists())
        self.assertTrue(self.marker().is_file())
        record = json.loads(self.marker().read_text())
        self.assertEqual(record["v"], "aim-next-initialization-1")
        self.assertEqual(record["status"], "incomplete")
        before = self.marker().read_bytes()
        with self.assertRaises(StoreError) as retry:
            self.initialize()
        self.assertEqual(retry.exception.code, "INITIALIZATION_INCOMPLETE")
        with self.assertRaises(StoreError) as opening:
            Store(self.path, "new-instance", expected_binding={"authority_path": str(self.anchor), "authority_id": "unknown", "authority_epoch": "unknown"})
        self.assertEqual(opening.exception.code, "INITIALIZATION_INCOMPLETE")
        self.assertNotIn(str(self.root), str(opening.exception))
        self.assertEqual(self.marker().read_bytes(), before)

    def test_completion_marker_failure_does_not_invalidate_published_authority(self):
        with mock.patch("aim_next.initialization.complete", side_effect=OSError("forced marker failure")):
            with self.assertRaises(StoreError) as caught:
                self.initialize()
        self.assertEqual(caught.exception.code, "INITIALIZATION_UNCONFIRMED")
        self.assertNotIn(str(self.root), str(caught.exception))
        self.assert_published_authority_wins()

    def assert_published_authority_wins(self):
        record = json.loads(self.anchor.read_text())
        binding = {"authority_path": str(self.anchor), "authority_id": record["authority_id"], "authority_epoch": record["epoch"]}
        try:
            store = Store(self.path, "new-instance", expected_binding=binding)
        except StoreError as error:
            self.fail("Published authority refused after marker failure: " + str(error))
        self.assertEqual(store.view("owner", "capabilities", {})["authority"]["continuity"], "initial")
        self.assertEqual(json.loads(self.marker().read_text())["status"], "incomplete")
        with self.assertRaises(StoreError) as retry:
            self.initialize()
        self.assertEqual(retry.exception.code, "ALREADY_INITIALIZED")

    def test_owned_process_crash_after_publication_leaves_usable_binding(self):
        program = r'''
import os,sys
from aim_next import initialize
from aim_next import initialization
initialization.complete=lambda *args: os._exit(79)
initialize(sys.argv[1],"new-instance",[{"id":"owner","kind":"human"}],authority_path=sys.argv[2])
'''
        result = subprocess.run([sys.executable, "-c", program, str(self.path), str(self.anchor)],
            env=dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1])), capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 79, result.stderr)
        self.assert_published_authority_wins()

    def test_initialization_record_is_never_an_anchor(self):
        info = self.initialize()
        marker = self.marker()
        self.assertEqual(json.loads(marker.read_text())["status"], "complete")
        with self.assertRaises(StoreError):
            authority_module._read_anchor(marker)
        with self.assertRaises(StoreError):
            Store(self.path, "new-instance", expected_binding=dict(info["binding"], authority_path=str(marker)))


class CommitIdentityCase(fixture.AuthorityCase):
    def pair(self):
        rows = dict(self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')"))
        self.assertIn("commit_id", rows)
        self.assertEqual(len(rows["commit_id"]), 32)
        return rows["commit_seq"], rows["commit_id"]

    def test_commit_identity_changes_with_recorded_acts_only(self):
        initial = self.pair()
        first = self.create()
        committed = self.pair()
        self.assertEqual(committed[0], "1")
        self.assertNotEqual(initial[1], committed[1])
        self.assertEqual(self.create(), first)
        self.assertEqual(self.pair(), committed)
        self.store.view("owner", "capabilities", {})
        self.assertEqual(self.pair(), committed)
        self.store.command("owner", {"instance_id": "other"})
        self.assertEqual(self.pair(), committed)
        refusal = self.create(op="recorded-refusal")
        self.assertTrue(refusal["recorded"])
        self.assertEqual(self.pair()[0], "2")
        self.assertNotEqual(self.pair()[1], committed[1])

    def test_equal_counters_on_different_fixture_histories_have_different_commit_ids(self):
        self.create()
        snapshot = self.path.read_bytes()
        self.create(op="branch-a")
        branch_a = self.pair()
        # Deliberately unsupported in-place rollback in an isolated fixture:
        # compare head identities; this is not an activation implementation.
        self.path.write_bytes(snapshot)
        self.create(op="branch-b")
        branch_b = self.pair()
        self.assertEqual(branch_a[0], branch_b[0])
        self.assertNotEqual(branch_a[1], branch_b[1])

    def test_missing_or_malformed_commit_identity_refuses_to_open(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM metadata WHERE key='commit_id'")
        with self.assertRaises(StoreError):
            Store(self.path, "authority-test", expected_binding=self.binding)
        for value in ("", "g" * 32, "A" * 32, "0" * 31):
            with self.subTest(value=value):
                with sqlite3.connect(str(self.path)) as db:
                    db.execute("INSERT OR REPLACE INTO metadata VALUES ('commit_id',?)", (value,))
                with self.assertRaises(StoreError):
                    Store(self.path, "authority-test", expected_binding=self.binding)

    def test_commit_identity_failure_rolls_back_receipt_sequence_and_effects_together(self):
        initial = self.pair()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER fail_commit_id BEFORE UPDATE ON metadata WHEN OLD.key='commit_id' BEGIN SELECT RAISE(ABORT, 'forced isolated commit-id failure'); END")
        outcome = self.create()
        self.assertFalse(outcome["recorded"])
        self.assertEqual(outcome["error"]["code"], "INTERNAL_ERROR")
        self.assertEqual(self.pair(), initial)
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), [(0,)])


for _name in list(fixture.AuthorityCase.__dict__):
    if _name.startswith("test_") and _name not in CommitIdentityCase.__dict__:
        setattr(CommitIdentityCase, _name, None)


if __name__ == "__main__":
    unittest.main()

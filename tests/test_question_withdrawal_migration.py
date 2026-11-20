from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
import uuid

from aim_next import Store
from aim_next.migrations import MigrationError, migrate
from aim_next.store import StoreOpenError


BASE = "13d415921c338709bfbeb6f2e93894b8fb37733d"
REPO = Path(__file__).resolve().parents[1]


class WithdrawalMigrationCase(unittest.TestCase):
    def test_actual54_existing_data_upgrade_rollback_replay_and_occupied_refusal(self):
        with tempfile.TemporaryDirectory(prefix="withdrawal366-migration-") as temporary:
            root = Path(temporary).resolve()
            base = root / "source54"
            base.mkdir()
            archive = subprocess.run(["git", "archive", BASE, "aim_next", "skills", "tests/reader_fixture.py", "tests/test_store.py"],
                                     cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                self.assertTrue(all(not p.name.startswith("/") and ".." not in Path(p.name).parts for p in tar))
                tar.extractall(base)
            fixture = root / "fixture-existing"
            fixture.mkdir()
            child_caches = []
            original_reads = []
            def original(mode):
                cache = root / ("cache-" + uuid.uuid4().hex)
                child_caches.append(str(cache))
                result = subprocess.run([sys.executable, "-I", "-X", "pycache_prefix=" + str(cache),
                    str(REPO / "tests/fixtures/withdrawal_366_schema54.py"), str(base), str(fixture), mode],
                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                answer = json.loads(result.stdout)
                self.assertEqual(answer["cache"], str(cache))
                self.assertEqual(answer["messages"], 4)
                original_reads.append(answer)
                return answer
            self.assertEqual(original("seed")["schema"], "54")
            seed = json.loads((fixture / "seed.json").read_text())
            path, binding = fixture / "instance.sqlite3", seed["binding"]
            def digest():
                return hashlib.sha256(path.read_bytes()).hexdigest()
            def records():
                with sqlite3.connect(str(path)) as db:
                    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                             if row[0] not in ("metadata", "message_withdrawals")]
                    return {name: db.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall() for name in names}
            before = records()
            unchanged = digest()
            with self.assertRaises(StoreOpenError) as refusal:
                Store(path, "test-instance", expected_binding=binding)
            self.assertEqual(refusal.exception.code, "SCHEMA_MISMATCH")
            self.assertIn("migrate", str(refusal.exception))
            self.assertEqual(digest(), unchanged)
            result = migrate(path, "test-instance", binding)
            self.assertEqual((result["from_version"], result["schema_version"]), ("54", "55"))
            self.assertEqual(records(), before)
            upgraded = digest()
            self.assertFalse(migrate(path, "test-instance", binding)["migrated"])
            self.assertEqual(digest(), upgraded)
            self.assertEqual(original("newer")["schema"], "55")
            self.assertEqual(digest(), upgraded)
            self.assertEqual(migrate(path, "test-instance", binding, "54")["schema_version"], "54")
            self.assertEqual(original("read")["schema"], "54")
            self.assertEqual(records(), before)
            self.assertEqual(migrate(path, "test-instance", binding)["schema_version"], "55")
            store = Store(path, "test-instance", expected_binding=binding)
            request = {"v": 1, "instance_id": "test-instance", "operation_id": "after-upgrade", "kind": "message.withdraw",
                "target": {"message_id": seed["asks"][0]}, "args": {},
                "expected": {"authority": {k: binding[k] for k in ("authority_id", "authority_epoch")}}}
            receipt = store.command("agent-a", request)
            self.assertEqual(receipt["status"], "committed", receipt)
            self.assertEqual(store.command("agent-a", request), receipt)
            cover = store.view("owner", "dossier_cover", {"message_id": seed["root"]})["cover"]
            self.assertEqual([row.get("ask_id") for row in cover["waiting"]], [None, seed["asks"][1]])
            occupied = digest()
            with self.assertRaises(MigrationError) as caught:
                migrate(path, "test-instance", binding, "54")
            self.assertEqual(caught.exception.code, "RECORDS_WOULD_BE_LOST")
            self.assertEqual(digest(), occupied)
            with sqlite3.connect(str(path)) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
                self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                for sql in ("UPDATE message_withdrawals SET at_ms=0", "DELETE FROM message_withdrawals"):
                    with self.assertRaises(sqlite3.IntegrityError):
                        db.execute(sql)
            self.assertEqual(len(child_caches), len(set(child_caches)))
            print("MIGRATION_PROOF " + json.dumps({"source54": BASE, "original_reads": original_reads,
                "upgrade": result, "original_table_counts": {name: len(rows) for name, rows in before.items()},
                "original_records_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
                "occupied_refusal": caught.exception.code, "occupied_before_sha256": occupied,
                "occupied_after_sha256": digest(), "withdrawal_receipt": receipt}), flush=True)

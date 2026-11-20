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
from aim_next.migrations import migrate, MigrationError
from aim_next.store import StoreOpenError


BASE = "4c50f9a9b4d1b82ba98c4cd3c4767204c9237a64"
REPO = Path(__file__).resolve().parents[1]


class RequestMigrationCase(unittest.TestCase):
    def test_actual153_upgrade_preserves_every_old_value_key_index_sequence_and_rollback(self):
        with tempfile.TemporaryDirectory(prefix="request829-migration-") as temporary:
            root = Path(temporary).resolve()
            source, fixture = root / "source55", root / "fixture-records"
            source.mkdir(); fixture.mkdir()
            archive = subprocess.check_output(["git", "archive", BASE, "aim_next", "skills", "tests/reader_fixture.py", "tests/test_store.py"], cwd=REPO)
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                self.assertTrue(all(not Path(p.name).is_absolute() and ".." not in Path(p.name).parts for p in tar))
                tar.extractall(source)
            children = []
            def original(mode):
                cache = str(root / ("cache-" + uuid.uuid4().hex))
                argv = [sys.executable, "-I", "-X", "pycache_prefix=" + cache,
                        str(REPO / "tests/fixtures/refresh_829_schema55.py"), str(source), str(fixture), mode]
                result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                children.append({"argv": argv, "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
                self.assertEqual(result.returncode, 0, children[-1])
                answer = json.loads(result.stdout)
                self.assertEqual(answer["cache"], cache)
                return answer
            self.assertEqual(original("seed")["schema"], "55")
            path = fixture / "instance.sqlite3"
            seed = json.loads((fixture / "seed.json").read_text())
            binding = seed["binding"]
            def digest(): return hashlib.sha256(path.read_bytes()).hexdigest()
            with sqlite3.connect(str(path)) as db:
                columns = {name: [row[1] for row in db.execute('PRAGMA table_info("' + name + '")')]
                           for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name<>'metadata'").fetchall()}
                indexes = {name: (sql, list(db.execute('PRAGMA index_info("' + name + '")')))
                           for name, sql in db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='deliveries'").fetchall()}
                triggers = list(db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='deliveries' ORDER BY name"))
                self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name='deliveries'").fetchone(), (500,))
            def old_records():
                with sqlite3.connect(str(path)) as db:
                    return {name: db.execute('SELECT ' + ','.join('"' + col + '"' for col in cols) + ' FROM "' + name + '" ORDER BY ' + ('name' if name == 'sqlite_sequence' else 'rowid')).fetchall()
                            for name, cols in columns.items()}
            before, unchanged = old_records(), digest()
            with self.assertRaises(StoreOpenError) as refused:
                Store(path, "test-instance", expected_binding=binding)
            self.assertEqual(refused.exception.code, "SCHEMA_MISMATCH")
            self.assertEqual(digest(), unchanged)
            upgraded = migrate(path, "test-instance", binding)
            self.assertEqual((upgraded["from_version"], upgraded["schema_version"]), ("55", "56"))
            self.assertEqual(old_records(), before)
            with sqlite3.connect(str(path)) as db:
                for name, expected in indexes.items():
                    self.assertEqual((db.execute("SELECT sql FROM sqlite_master WHERE name=?", (name,)).fetchone()[0],
                                      list(db.execute('PRAGMA index_info("' + name + '")'))), expected)
                for name, sql in triggers:
                    self.assertEqual(db.execute("SELECT sql FROM sqlite_master WHERE name=?", (name,)).fetchone()[0], sql)
                self.assertEqual(db.execute("SELECT count(*) FROM deliveries WHERE request_id IS NOT NULL").fetchone(), (0,))
                old = db.execute("SELECT id,message_id,recipient_id,group_id,state,topic_id,revision FROM deliveries LIMIT 1").fetchone()
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,state,topic_id,revision) VALUES (?,?,?,?,?,?,?)", ("duplicate-ordinary", *old[1:]))
            upgraded_hash = digest()
            self.assertFalse(migrate(path, "test-instance", binding)["migrated"])
            self.assertEqual(digest(), upgraded_hash)
            self.assertEqual(original("newer")["error"], "SCHEMA_MISMATCH")
            self.assertEqual(migrate(path, "test-instance", binding, "55")["schema_version"], "55")
            self.assertEqual(old_records(), before)
            self.assertEqual(original("read")["schema"], "55")
            migrate(path, "test-instance", binding)
            store = Store(path, "test-instance", expected_binding=binding)
            legacy = store.view("owner", "source", {"source_ref": {"kind": "message", "id": seed["legacy_request"]}})
            self.assertIn("Please rewrite", legacy["body"])
            request = {"v": 1, "instance_id": "test-instance", "operation_id": "typed-after-upgrade", "kind": "stack.cover_refresh",
                       "target": {"message_id": seed["root"]}, "args": {}, "expected": {"cover_revision": 2,
                       "authority": {key: binding[key] for key in ("authority_id", "authority_epoch")}}}
            receipt = store.command("owner", request)
            self.assertEqual(receipt["status"], "committed", receipt)
            self.assertEqual(store.command("owner", request), receipt)
            with sqlite3.connect(str(path)) as db:
                self.assertEqual(db.execute("SELECT seq FROM deliveries WHERE request_id IS NOT NULL").fetchone(), (501,))
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
                self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                for sql in ("UPDATE refresh_requests SET body='changed'", "DELETE FROM refresh_requests"):
                    with self.assertRaises(sqlite3.IntegrityError): db.execute(sql)
            occupied = digest()
            with self.assertRaises(MigrationError) as refusal: migrate(path, "test-instance", binding, "55")
            self.assertEqual(refusal.exception.code, "RECORDS_WOULD_BE_LOST")
            self.assertEqual(digest(), occupied)
            print("MIGRATION829_PROOF " + json.dumps({"source55": BASE, "children": children, "upgrade": upgraded,
                  "old_counts": {key: len(value) for key, value in before.items()}, "delivery_indexes": indexes,
                  "old_records_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
                  "old_delivery_highwater": 500, "new_request_seq": 501, "occupied_before": occupied,
                  "occupied_after": digest(), "receipt": receipt}), flush=True)

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


BASE = 'f41d682691c5a99c177538a87a30f04916ed6e1e'
REPO = Path(__file__).resolve().parents[1]


class MigrationCase(unittest.TestCase):
    def test_actual162_preserves_all_old_rows_indexes_request_keys_sequence_and_rollback(self):
        with tempfile.TemporaryDirectory(prefix='removal151-migration-') as temporary:
            root = Path(temporary).resolve()
            source, fixture = root / 'source56', root / 'fixture-records'
            source.mkdir(); fixture.mkdir()
            archive = subprocess.check_output(['git', 'archive', BASE, 'aim_next', 'skills', 'tests/reader_fixture.py', 'tests/test_store.py'], cwd=REPO)
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                self.assertTrue(all(not Path(p.name).is_absolute() and '..' not in Path(p.name).parts for p in tar))
                tar.extractall(source)
            children = []
            def original(mode):
                cache = str(root / ('cache-' + uuid.uuid4().hex))
                argv = [sys.executable, '-I', '-X', 'pycache_prefix=' + cache,
                        str(REPO / 'tests/fixtures/removal_151_schema56.py'), str(source), str(fixture), mode]
                result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                children.append(dict(argv=argv, exit=result.returncode, stdout=result.stdout, stderr=result.stderr))
                self.assertEqual(result.returncode, 0, children[-1])
                answer = json.loads(result.stdout)
                self.assertEqual(answer['cache'], cache)
                return answer
            try:
                self.assertEqual(original('seed')['schema'], '56')
                path = fixture / 'instance.sqlite3'
                seed = json.loads((fixture / 'seed.json').read_text()); binding = seed['binding']
                def digest(): return hashlib.sha256(path.read_bytes()).hexdigest()
                with sqlite3.connect(str(path)) as db:
                    columns = {name: [row[1] for row in db.execute('PRAGMA table_info("' + name + '")')]
                        for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name<>'metadata'").fetchall()}
                    indexes = {name: (sql, list(db.execute('PRAGMA index_info("' + name + '")')))
                        for name, sql in db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='deliveries'").fetchall()}
                    triggers = list(db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='deliveries' ORDER BY name"))
                    self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name='deliveries'").fetchone(), (500,))
                    self.assertEqual({row[0] for row in db.execute('SELECT DISTINCT state FROM deliveries')}, {'acknowledged', 'held', 'pending'})
                    self.assertTrue(db.execute('SELECT 1 FROM deliveries WHERE revision>1').fetchone())
                    self.assertTrue(db.execute('SELECT 1 FROM deliveries WHERE request_id IS NOT NULL').fetchone())
                    self.assertTrue(db.execute('SELECT 1 FROM message_withdrawals').fetchone())
                def old_records():
                    with sqlite3.connect(str(path)) as db:
                        return {name: db.execute('SELECT ' + ','.join('"' + col + '"' for col in cols) + ' FROM "' + name + '" ORDER BY ' + ('name' if name == 'sqlite_sequence' else 'rowid')).fetchall()
                            for name, cols in columns.items()}
                before, unchanged = old_records(), digest()
                with self.assertRaises(StoreOpenError) as refused: Store(path, 'test-instance', expected_binding=binding)
                self.assertEqual(refused.exception.code, 'SCHEMA_MISMATCH'); self.assertEqual(digest(), unchanged)
                upgrade = migrate(path, 'test-instance', binding)
                self.assertEqual((upgrade['from_version'], upgrade['schema_version']), ('56', '57'))
                self.assertEqual(old_records(), before)
                with sqlite3.connect(str(path)) as db:
                    for name, expected in indexes.items():
                        self.assertEqual((db.execute('SELECT sql FROM sqlite_master WHERE name=?', (name,)).fetchone()[0],
                                          list(db.execute('PRAGMA index_info("' + name + '")'))), expected)
                    for name, sql in triggers:
                        self.assertEqual(db.execute('SELECT sql FROM sqlite_master WHERE name=?', (name,)).fetchone()[0], sql)
                    self.assertEqual(db.execute('SELECT count(*) FROM deliveries WHERE retraction_id IS NOT NULL').fetchone(), (0,))
                    ordinary = db.execute('SELECT message_id,recipient_id,group_id,topic_id,revision FROM deliveries WHERE message_id IS NOT NULL LIMIT 1').fetchone()
                    with self.assertRaises(sqlite3.IntegrityError):
                        db.execute('INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id,revision) VALUES (?,?,?,?,?,?)', ('duplicate', *ordinary))
                    request = db.execute('SELECT request_id,recipient_id,group_id,topic_id FROM deliveries WHERE request_id IS NOT NULL').fetchone()
                    with self.assertRaises(sqlite3.IntegrityError):
                        db.execute('INSERT INTO deliveries(id,request_id,recipient_id,group_id,topic_id) VALUES (?,?,?,?,?)', ('duplicate-request', *request))
                upgraded_hash = digest()
                self.assertFalse(migrate(path, 'test-instance', binding)['migrated']); self.assertEqual(digest(), upgraded_hash)
                self.assertEqual(original('newer')['error'], 'SCHEMA_MISMATCH'); self.assertEqual(digest(), upgraded_hash)
                self.assertEqual(migrate(path, 'test-instance', binding, '56')['schema_version'], '56')
                self.assertEqual(old_records(), before); self.assertEqual(original('read')['schema'], '56')
                migrate(path, 'test-instance', binding)
                store = Store(path, 'test-instance', expected_binding=binding)
                source_view = store.view('owner', 'source', {'source_ref': {'kind': 'message', 'id': seed['root']}})
                self.assertEqual(source_view['removal_action'], 'retract', 'historical records are never silently proved unseen')
                request = dict(v=1, instance_id='test-instance', operation_id='retract-after-migration', kind='message.retract',
                    target={'message_id': seed['root']}, args={}, expected={'authority': {k: binding[k] for k in ('authority_id', 'authority_epoch')}})
                receipt = store.command('owner', request)
                self.assertEqual(receipt['status'], 'committed', receipt); self.assertEqual(store.command('owner', request), receipt)
                with sqlite3.connect(str(path)) as db:
                    notice_seq = db.execute('SELECT seq FROM deliveries WHERE retraction_id IS NOT NULL').fetchall()
                    self.assertTrue(notice_seq); self.assertEqual(notice_seq[0], (501,))
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',)); self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
                    for statement in ('UPDATE message_removals SET at_ms=0', 'DELETE FROM message_removals', 'UPDATE message_removal_horizon SET seq=0'):
                        with self.assertRaises(sqlite3.IntegrityError): db.execute(statement)
                occupied = digest()
                with self.assertRaises(MigrationError) as refusal: migrate(path, 'test-instance', binding, '56')
                self.assertEqual(refusal.exception.code, 'RECORDS_WOULD_BE_LOST'); self.assertEqual(digest(), occupied)
                print('MIGRATION151_PROOF ' + json.dumps(dict(source56=BASE, upgrade=upgrade,
                    old_counts={key: len(value) for key, value in before.items()}, indexes=indexes,
                    old_records_sha256=hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
                    notice_seq=notice_seq, occupied_before=occupied, occupied_after=digest(), receipt=receipt)), flush=True)
            finally:
                print('MIGRATION151_CHILDREN ' + json.dumps(children), flush=True)

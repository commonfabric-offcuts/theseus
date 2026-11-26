from __future__ import annotations

import copy
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest import mock
import uuid

from aim_next import Store, initialize
from aim_next.authority import AuthorityError
from aim_next import backup, recovery_io as io


AVAILABLE = importlib.util.find_spec('aim_next.relocation') is not None
if AVAILABLE:
    from aim_next import relocation


class Availability(unittest.TestCase):
    def test_inactive_preparation_api_exists(self):
        self.assertTrue(AVAILABLE, '1322 inactive preparation is absent on this source')


@unittest.skipUnless(AVAILABLE, '1322 API absent: behavior bodies cannot enter on baseline')
class RelocationCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='theseus-relocation-1322-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.db = self.root/'original'/'data.sqlite3'
        self.anchor = self.root/'control'/'authority.json'
        initialized = initialize(self.db, 'isolated-relocation', [{'id': 'fixture-owner', 'kind': 'human'}],
                                 authority_path=self.anchor)
        self.binding = initialized['binding']
        self.store = Store(self.db, 'isolated-relocation', expected_binding=self.binding)
        self.receipt = self.store.command('fixture-owner', dict(v=1, instance_id=self.store.instance_id,
            operation_id='original-lost-response', kind='workspace.create', target={},
            expected={'authority': {k: self.binding[k] for k in ('authority_id', 'authority_epoch')}},
            args={'id': 'private-work', 'title': 'Original exact private writing'}))
        self.assertEqual(self.receipt['status'], 'committed')
        media = Path(str(self.db)+'.media')
        media.mkdir(mode=0o700)
        data = b'private attachment\x00unchanged'
        blob = media/'b-private'
        blob.write_bytes(data); blob.chmod(0o600)
        with sqlite3.connect(str(self.db)) as db:
            db.execute('INSERT INTO media_intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                ('private', 'fixture-owner', 1, 'ready', 'media-op', self.binding['authority_id'],
                 self.binding['authority_epoch'], 'private.bin', 'application/octet-stream', len(data),
                 hashlib.sha256(data).hexdigest(), blob.name, 0))
        self.bundle = backup.backup(self.db, self.store.instance_id, expected_binding=self.binding,
                                    bundle_path=str(self.root/'bundle'))
        self.manifest = backup.inspect(self.bundle['bundle_path'], expected_digest=self.bundle['bundle_digest'])
        self.staging = self.root/'staging'
        self.staging.mkdir(mode=0o700)
        self.request = dict(v=1, move_id=str(uuid.uuid4()), staging_root=str(self.staging),
            bundle_path=self.bundle['bundle_path'], bundle_digest=self.bundle['bundle_digest'],
            source=dict(self.binding, instance_id=self.store.instance_id, db_path=str(self.db)),
            destination={'db_path': str(self.root/'future'/'data.sqlite3'),
                         'authority_path': str(self.root/'future'/'authority.json')},
            owners={'source_uid': os.getuid(), 'destination_uid': os.getuid()+1},
            commit={'seq': self.manifest['metadata']['commit_seq'], 'id': self.manifest['metadata']['commit_id']})

    def stage(self, request=None):
        request = request or self.request
        return Path(request['staging_root'])/request['move_id']

    def refused(self, call, code):
        with self.assertRaises(io.RecoveryError) as caught:
            call()
        self.assertEqual(caught.exception.code, code, repr(caught.exception))
        return caught.exception

    def bytes(self, root):
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def assert_no_binding(self, result):
        self.assertTrue(result['inactive'])
        self.assertNotIn('binding', result)
        self.assertNotIn('authority_epoch', result['proposed'])
        self.assertEqual(result['original'], self.request['source'])
        self.assertEqual(result['proposed'], self.request['destination'])

    def test_two_roots_preserve_exact_snapshot_and_only_record_destination_facts(self):
        before = self.bytes(self.root/'original'), self.bytes(self.root/'control'), self.bytes(self.root/'bundle')
        for name in ('plain-stage', "space unicode-λ apostrophe's stage"):
            with self.subTest(root=name):
                parent = self.root/name; parent.mkdir(mode=0o700)
                request = dict(self.request, staging_root=str(parent))
                result = relocation.prepare(request)
                self.assertEqual(result['status'], 'prepared')
                self.assertTrue(result['durability_confirmed'])
                self.assert_no_binding(result)
                stage = self.stage(request)
                for leaf in ('data.sqlite3', 'manifest.json', 'media/b-private'):
                    self.assertEqual((stage/leaf).read_bytes(), (self.root/'bundle'/leaf).read_bytes())
                self.assertEqual(io.read_metadata(stage/'data.sqlite3'), self.manifest['metadata'])
                self.assertEqual(backup.inspect(str(stage)), self.manifest)
                self.assertFalse((self.root/'future').exists())
        self.assertEqual(before, (self.bytes(self.root/'original'), self.bytes(self.root/'control'), self.bytes(self.root/'bundle')))

    def test_no_active_database_and_original_lost_response_outcome_remains_identical(self):
        result = relocation.prepare(self.request)
        self.assert_no_binding(result)
        with self.assertRaises(AuthorityError) as caught:
            Store(self.stage()/'data.sqlite3', self.store.instance_id, expected_binding=self.binding)
        self.assertEqual(caught.exception.code, 'AUTHORITY_CHANGED')
        self.assertEqual(self.store.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), self.receipt)
        with io.connection(self.stage()/'data.sqlite3') as db:
            original = db.execute('SELECT outcome FROM operations WHERE id=?', ('original-lost-response',)).fetchone()[0]
        with io.connection(self.db) as db:
            self.assertEqual(original, db.execute('SELECT outcome FROM operations WHERE id=?', ('original-lost-response',)).fetchone()[0])
        self.assertFalse(list(self.stage().glob('authority*')))

    def test_inspection_is_read_only_before_and_after_prepare(self):
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            self.assertEqual(relocation.inspect_prepared(self.request)['status'], 'not_started')
        self.assertEqual(list(self.staging.iterdir()), [])
        relocation.prepare(self.request)
        before = self.bytes(self.stage())
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            result = relocation.inspect_prepared(self.request)
        self.assertEqual(result['status'], 'prepared_observed')
        self.assertFalse(result['durability_confirmed'])
        self.assert_no_binding(result)
        self.assertEqual(before, self.bytes(self.stage()))

    def test_completed_same_id_retry_never_recopies_and_works_without_old_bundle(self):
        first = relocation.prepare(self.request)
        (self.root/'bundle').rename(self.root/'retained-bundle')
        with mock.patch.object(io, 'copy_file', side_effect=AssertionError('matching retry recopied')):
            self.assertEqual(relocation.prepare(self.request), first)
            self.assertEqual(relocation.inspect_prepared(self.request)['status'], 'prepared_observed')

    def test_changed_inputs_refuse_without_rewriting_original_request_or_payload(self):
        relocation.prepare(self.request)
        before = self.bytes(self.stage())
        variants = []
        for key, field, value in (
                ('destination', 'authority_path', str(self.root/'other'/'authority.json')),
                ('destination', 'db_path', str(self.root/'other'/'data.sqlite3')),
                ('owners', 'destination_uid', os.getuid()+2), ('commit', 'seq', '999'),
                ('source', 'authority_epoch', 'different-epoch')):
            changed = copy.deepcopy(self.request); changed[key][field] = value; variants.append(changed)
        for changed in variants:
            with self.subTest(changed=changed):
                self.refused(lambda: relocation.prepare(changed), 'RELOCATION_REQUEST_MISMATCH')
                self.refused(lambda: relocation.inspect_prepared(changed), 'RELOCATION_REQUEST_MISMATCH')
                self.assertEqual(before, self.bytes(self.stage()))

    def test_source_authority_path_and_commit_pair_must_match_verified_snapshot(self):
        for key, field, value in (
                ('source', 'authority_path', str(self.root/'other-authority'/'anchor.json')),
                ('source', 'instance_id', 'other-instance'), ('source', 'authority_epoch', 'other-epoch'),
                ('commit', 'seq', '999'), ('commit', 'id', 'f'*32)):
            changed = copy.deepcopy(self.request); changed[key][field] = value
            with self.subTest(field=field):
                self.refused(lambda: relocation.prepare(changed), 'RELOCATION_SOURCE_MISMATCH')
                self.assertEqual(list(self.staging.iterdir()), [])

    def test_original_database_path_is_explicit_assertion_not_a_live_database_open(self):
        changed = copy.deepcopy(self.request)
        changed['source']['db_path'] = str(self.root/'caller-asserted'/'absent.sqlite3')
        result = relocation.prepare(changed)
        self.assertEqual(result['original']['db_path'], changed['source']['db_path'])
        self.assertFalse(Path(changed['source']['db_path']).exists())
        self.assertEqual(io.read_metadata(self.stage()/'data.sqlite3'), self.manifest['metadata'])

    def test_malformed_or_aliased_roots_refuse_before_staging(self):
        variants = [dict(self.request, v=True), dict(self.request, move_id='NOT-UUID'),
                    dict(self.request, staging_root='relative'), dict(self.request, bundle_digest='F'*64)]
        alias = self.root/'alias'; alias.symlink_to(self.staging, target_is_directory=True)
        variants.append(dict(self.request, staging_root=str(alias)))
        for key, field, value in (('owners', 'source_uid', os.getuid()+1), ('owners', 'destination_uid', True),
                ('destination', 'db_path', str(self.db)),
                ('destination', 'authority_path', str(self.anchor.parent)+'/./authority.json')):
            changed = copy.deepcopy(self.request); changed[key][field] = value; variants.append(changed)
        for changed in variants:
            with self.subTest(request=changed):
                self.refused(lambda: relocation.prepare(changed), 'INVALID_REQUEST')
                self.assertEqual(list(self.staging.iterdir()), [])

    def test_staging_cannot_reach_bundle_source_or_proposed_instance(self):
        for root in (self.root, self.root/'bundle'/'nested', self.db.parent, self.anchor.parent,
                     self.root/'future', self.root/'future'/'nested'):
            with self.subTest(root=root):
                self.refused(lambda: relocation.prepare(dict(self.request, staging_root=str(root))), 'INVALID_REQUEST')

    def test_corrupt_bundle_has_no_preparation_side_effect(self):
        (self.root/'bundle'/'media'/'b-private').write_bytes(b'bad input')
        self.refused(lambda: relocation.prepare(self.request), 'BUNDLE_INVALID')
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_private_staging_parent_is_required_without_permission_repair(self):
        self.staging.chmod(0o755)
        try:
            self.refused(lambda: relocation.prepare(self.request), 'INVALID_REQUEST')
            self.assertEqual(self.staging.stat().st_mode & 0o777, 0o755)
            self.assertEqual(list(self.staging.iterdir()), [])
        finally:
            self.staging.chmod(0o700)

    def test_interrupted_copy_retains_incomplete_stage_and_releases_owned_lock(self):
        with mock.patch.object(io, 'copy_file', side_effect=OSError('actual injected copy failure')):
            error = self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_UNCONFIRMED')
        self.assertEqual(error.evidence['staging_path'], str(self.stage()))
        self.assertTrue((self.stage()/'request.json').exists())
        self.assertFalse((self.stage()/'prepared.json').exists())
        self.assertEqual(relocation.inspect_prepared(self.request)['status'], 'preparation_incomplete')
        before = self.bytes(self.stage())
        self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_INCOMPLETE')
        self.assertEqual(before, self.bytes(self.stage()))
        with (self.stage()/'prepare.lock').open('rb') as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_completion_marker_is_last_and_failed_marker_is_not_adopted(self):
        real_write = io.write_record
        def fail_marker(path, value, *args):
            if Path(path).name == 'prepared.json':
                self.assertEqual(backup.inspect(str(self.stage())), self.manifest)
                raise OSError('before completion publication')
            return real_write(path, value, *args)
        with mock.patch.object(io, 'write_record', side_effect=fail_marker):
            self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_UNCONFIRMED')
        self.assertFalse((self.stage()/'prepared.json').exists())
        self.assertEqual(relocation.inspect_prepared(self.request)['status'], 'preparation_incomplete')

    def test_lost_completion_flush_is_observed_then_same_id_freshly_confirms(self):
        with mock.patch.object(relocation, '_flush', side_effect=OSError('post-marker flush failure')):
            self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_UNCONFIRMED')
        observed = relocation.inspect_prepared(self.request)
        self.assertEqual(observed['status'], 'prepared_observed')
        self.assertFalse(observed['durability_confirmed'])
        with mock.patch.object(io, 'copy_file', side_effect=AssertionError('lost return caused recopy')):
            self.assertTrue(relocation.prepare(self.request)['durability_confirmed'])

    def test_no_weaker_flush_fallback_or_automatic_partial_cleanup(self):
        with mock.patch.object(io, 'full_flush', side_effect=OSError('full flush unsupported here')):
            self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_UNCONFIRMED')
        self.assertTrue(self.stage().exists())
        self.assertFalse((self.stage()/'prepared.json').exists())
        self.refused(lambda: relocation.prepare(self.request), 'RELOCATION_UNCONFIRMED')

    def test_busy_writer_blocks_readback_and_retry_without_a_second_copy(self):
        relocation.prepare(self.request)
        before = self.bytes(self.stage())
        with (self.stage()/'prepare.lock').open('rb') as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            for call in (relocation.prepare, relocation.inspect_prepared):
                error = self.refused(lambda: call(self.request), 'RELOCATION_BUSY')
                self.assertTrue(error.retryable)
        self.assertEqual(before, self.bytes(self.stage()))

    def test_replaced_directory_or_lock_and_tampered_payload_refuse(self):
        for damage in ('root', 'lock', 'database', 'media', 'extra'):
            with self.subTest(damage=damage):
                request = dict(self.request, move_id=str(uuid.uuid4()))
                relocation.prepare(request)
                stage = self.stage(request)
                if damage == 'root':
                    retained = self.staging/('retained-'+request['move_id'])
                    stage.rename(retained); shutil.copytree(retained, stage)
                elif damage == 'lock':
                    (stage/'prepare.lock').unlink()
                    (stage/'prepare.lock').write_bytes(b''); (stage/'prepare.lock').chmod(0o600)
                elif damage == 'database':
                    with (stage/'data.sqlite3').open('r+b') as db:
                        db.write(b'broken database!')
                elif damage == 'media':
                    (stage/'media'/'b-private').write_bytes(b'tampered private blob')
                else:
                    (stage/'extra').write_bytes(b'unverified entry')
                with self.assertRaises(io.RecoveryError):
                    relocation.inspect_prepared(request)


if __name__ == '__main__':
    unittest.main()

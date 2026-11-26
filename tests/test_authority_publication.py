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

from aim_next import Store, initialize, backup, relocation, recovery_io as io

AVAILABLE = importlib.util.find_spec('aim_next.relocation_publication') is not None
if AVAILABLE:
    from aim_next import relocation_publication as publication


class Availability(unittest.TestCase):
    def test_source_verification_publication_intent_api_exists(self):
        self.assertTrue(AVAILABLE, '1324 publication-intent API is absent on this source')


@unittest.skipUnless(AVAILABLE, '1324 absent: no behavior body/target entry on baseline')
class PublicationCase(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='theseus-publication-1324-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.db = self.root/'original'/'data.sqlite3'
        self.anchor = self.root/'control'/'authority.json'
        self.binding = initialize(self.db, 'publication-fixture', [{'id': 'fixture-owner', 'kind': 'human'}],
                                  authority_path=self.anchor)['binding']
        self.store = Store(self.db, 'publication-fixture', expected_binding=self.binding)
        self.operation = dict(v=1, instance_id=self.store.instance_id, operation_id='original-lost-response',
            kind='workspace.create', target={},
            expected={'authority': {k: self.binding[k] for k in ('authority_id', 'authority_epoch')}},
            args={'id': 'private-work', 'title': 'Exact original private writing'})
        self.receipt = self.store.command('fixture-owner', self.operation)
        self.assertEqual(self.receipt['status'], 'committed')
        # Stopped operator records are opaque retained bytes, never adopted.
        self.operator = self.root/'operator'; self.operator.mkdir(mode=0o700)
        for name, record in (('control.json', {'owner': 'fixture-owner', 'choice': 'Stop', 'revision': 7}),
                             ('plan.json', {'state': 'stopped', 'revision': 9, 'binding': self.binding}),
                             ('operation.json', self.operation)):
            io.write_record(self.operator/name, record)
        bundle = backup.backup(self.db, self.store.instance_id, expected_binding=self.binding,
                               bundle_path=str(self.root/'bundle'))
        self.manifest = backup.inspect(bundle['bundle_path'])
        self.staging = self.root/'staging'; self.staging.mkdir(mode=0o700)
        self.journals = self.root/'journals'; self.journals.mkdir(mode=0o700)
        self.preparation = dict(v=1, move_id=str(uuid.uuid4()), staging_root=str(self.staging),
            bundle_path=bundle['bundle_path'], bundle_digest=bundle['bundle_digest'],
            source=dict(self.binding, instance_id=self.store.instance_id, db_path=str(self.db)),
            destination=dict(db_path=str(self.root/'future'/'data.sqlite3'),
                             authority_path=str(self.root/'future'/'authority.json')),
            owners=dict(source_uid=os.getuid(), destination_uid=os.getuid()+1),
            commit=dict(seq=self.manifest['metadata']['commit_seq'], id=self.manifest['metadata']['commit_id']))
        relocation.prepare(self.preparation)
        self.request = dict(v=1, preparation=self.preparation, journal_root=str(self.journals))
        self.preserved = self.unchanged()

    def bytes(self, root):
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def unchanged(self):
        return {name: self.bytes(self.root/name) for name in ('original', 'control', 'operator', 'bundle', 'staging')}

    def journal(self, request=None):
        request = request or self.request
        return Path(request['journal_root'])/request['preparation']['move_id']

    def refused(self, call, code):
        with self.assertRaises(io.RecoveryError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def fresh_journal_request(self):
        root = self.root/('journal-'+uuid.uuid4().hex); root.mkdir(mode=0o700)
        return dict(self.request, journal_root=str(root))

    def test_reachable_intent_records_actual_three_pairs_and_preserves_every_source_byte(self):
        result = publication.prepare_publication_intent(self.request)
        self.assertEqual(result['status'], 'intent_recorded')
        self.assertTrue(result['inactive'] and result['durability_confirmed'])
        self.assertNotIn('binding', result)
        intent = result['intent']; observed = intent['predecessor']
        anchor, digest = io.read_record(self.anchor)
        self.assertEqual(observed['anchor'], anchor)
        self.assertEqual(observed['anchor_digest'], digest)
        self.assertEqual(observed['metadata'], self.manifest['metadata'])
        for key, path in (('database', self.db), ('authority_lock', Path(str(self.anchor)+'.lock')),
                          ('runner_lock', Path(str(self.anchor)+'.runner.lock'))):
            self.assertEqual(observed['identities'][key], io.identity(path.stat()))
        self.assertEqual(intent['candidate']['database'], self.manifest['database'])
        self.assertEqual(intent['preparation_digest'], io.digest_record(self.preparation))
        self.assertEqual(intent['proposed'], self.preparation['destination'])
        self.assertEqual(intent['owners'], self.preparation['owners'])
        self.assertGreater(intent['observed_ms'], 0)
        self.assertNotIn('authority_epoch', intent['proposed'])
        self.assertFalse((self.root/'future').exists())
        self.assertEqual(self.unchanged(), self.preserved)
        self.assertEqual(self.store.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), self.receipt)

    def test_inspection_never_creates_flushes_or_refreshes(self):
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('inspection flushed')):
            self.assertEqual(publication.inspect_publication_intent(self.request)['status'], 'not_started')
        self.assertEqual(list(self.journals.iterdir()), [])
        first = publication.prepare_publication_intent(self.request)
        before = self.bytes(self.journal())
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('inspection flushed')):
            observed = publication.inspect_publication_intent(self.request)
        self.assertEqual(observed['status'], 'intent_observed')
        self.assertFalse(observed['durability_confirmed'])
        self.assertEqual(observed['intent'], first['intent'])
        self.assertEqual(self.bytes(self.journal()), before)

    def test_completed_retry_is_historical_and_needs_neither_source_nor_candidate(self):
        first = publication.prepare_publication_intent(self.request)
        for name in ('original', 'control', 'bundle', 'staging'):
            (self.root/name).rename(self.root/('retained-'+name))
        with mock.patch.object(publication, '_observe', side_effect=AssertionError('retry observed source')), \
             mock.patch.object(publication, '_candidate', side_effect=AssertionError('retry verified candidate')):
            self.assertEqual(publication.prepare_publication_intent(self.request), first)
            self.assertEqual(publication.inspect_publication_intent(self.request)['intent'], first['intent'])

    def test_changed_input_under_same_identity_refuses_without_modification(self):
        publication.prepare_publication_intent(self.request)
        before = self.bytes(self.journal())
        for group, field, value in (('owners', 'destination_uid', os.getuid()+2),
                                   ('source', 'authority_epoch', 'other-epoch'),
                                   ('destination', 'authority_path', str(self.root/'other'/'anchor.json')),
                                   ('commit', 'id', 'e'*32)):
            changed = copy.deepcopy(self.request); changed['preparation'][group][field] = value
            with self.subTest(field=field):
                for method in (publication.prepare_publication_intent, publication.inspect_publication_intent):
                    self.refused(lambda: method(changed), 'PUBLICATION_REQUEST_MISMATCH')
                self.assertEqual(self.bytes(self.journal()), before)

    def test_caller_pinned_wrong_canonical_database_path_and_copy_are_refused(self):
        for copied in (False, True):
            changed = copy.deepcopy(self.preparation); changed['move_id'] = str(uuid.uuid4())
            wrong = self.root/'asserted'/'data.sqlite3'
            wrong.parent.mkdir(mode=0o700, exist_ok=True)
            if copied:
                shutil.copyfile(self.db, wrong); wrong.chmod(0o600)
            changed['source']['db_path'] = str(wrong)
            self.assertEqual(relocation.prepare(changed)['status'], 'prepared')
            request = dict(self.request, preparation=changed)
            self.refused(lambda: publication.prepare_publication_intent(request), 'PUBLICATION_SOURCE_MISMATCH')
            self.assertEqual(publication.inspect_publication_intent(request)['status'], 'intent_incomplete')
            self.assertFalse((self.journal(request)/'complete.json').exists())

    def test_replaced_actual_database_inode_refuses_even_with_identical_bytes(self):
        retained = self.db.with_name('retained.sqlite3'); self.db.rename(retained)
        shutil.copyfile(retained, self.db); self.db.chmod(0o600)
        self.assertNotEqual(io.identity(self.db.stat()), io.identity(retained.stat()))
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_SOURCE_MISMATCH')

    def test_both_commit_fields_and_all_lineage_metadata_are_compared(self):
        original = self.db.read_bytes()
        for field, value in (('commit_seq', '999'), ('commit_id', 'f'*32), ('authority_epoch', 'changed'),
                             ('instance_id', 'changed'), ('authority_id', 'changed'),
                             ('authority_path', str(self.root/'other'/'anchor.json'))):
            with self.subTest(field=field):
                with sqlite3.connect(str(self.db)) as db:
                    db.execute('UPDATE metadata SET value=? WHERE key=?', (value, field))
                self.refused(lambda: publication.prepare_publication_intent(self.fresh_journal_request()),
                             'PUBLICATION_SOURCE_MISMATCH')
                self.db.write_bytes(original)
        self.assertEqual(self.unchanged(), self.preserved)

    def test_stale_anchor_epoch_refuses(self):
        record, _ = io.read_record(self.anchor); record['epoch'] = 'changed'
        self.anchor.write_bytes(io.encode(record))
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_SOURCE_MISMATCH')

    def test_replaced_authority_and_runner_locks_refuse(self):
        for suffix in ('.lock', '.runner.lock'):
            path = Path(str(self.anchor)+suffix); retained = Path(str(path)+'.retained')
            path.rename(retained); path.write_bytes(b''); path.chmod(0o600)
            try:
                self.refused(lambda: publication.prepare_publication_intent(self.fresh_journal_request()), 'CONTROL_INVALID')
            finally:
                path.unlink(); retained.rename(path)
        self.assertEqual(self.unchanged(), self.preserved)

    def test_authority_exclusive_busy_is_distinct_and_partial_claim_is_retained(self):
        with Path(str(self.anchor)+'.lock').open('rb') as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            error = self.refused(lambda: publication.prepare_publication_intent(self.request), 'AUTHORITY_BUSY')
            self.assertTrue(error.retryable)
        self.assertEqual(publication.inspect_publication_intent(self.request)['status'], 'intent_incomplete')
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_INCOMPLETE')

    def test_readback_with_runner_guard_does_not_claim_quiescence(self):
        with Path(str(self.anchor)+'.runner.lock').open('rb') as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(publication.prepare_publication_intent(self.request)['status'], 'intent_recorded')

    def test_sqlite_busy_is_not_missing_or_a_completed_intent(self):
        with sqlite3.connect(str(self.db), isolation_level=None) as db:
            db.execute('BEGIN EXCLUSIVE')
            try:
                error = self.refused(lambda: publication.prepare_publication_intent(self.request), 'DATABASE_BUSY')
                self.assertTrue(error.retryable)
            finally:
                db.rollback()
        self.assertFalse((self.journal()/'complete.json').exists())

    def test_bad_or_incomplete_candidate_cannot_claim_journal(self):
        stage = self.staging/self.preparation['move_id']
        marker = stage/'prepared.json'; saved = marker.read_bytes(); marker.unlink()
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_PREPARATION_INCOMPLETE')
        self.assertEqual(list(self.journals.iterdir()), [])
        marker.write_bytes(saved); marker.chmod(0o600)
        (stage/'data.sqlite3').write_bytes(b'corrupt actual prepared database')
        with self.assertRaises(io.RecoveryError):
            publication.prepare_publication_intent(self.request)
        self.assertEqual(list(self.journals.iterdir()), [])

    def test_invalid_private_owner_canonical_and_overlapping_paths_refuse(self):
        alias = self.root/'alias'; alias.symlink_to(self.journals, target_is_directory=True)
        variants = [dict(self.request, v=True), dict(self.request, journal_root='relative'),
                    dict(self.request, journal_root=str(alias))]
        for path in (self.root, self.root/'original', self.root/'control', self.root/'staging', self.root/'future'):
            variants.append(dict(self.request, journal_root=str(path)))
        changed = copy.deepcopy(self.request); changed['preparation']['owners']['source_uid'] += 1; variants.append(changed)
        for request in variants:
            self.refused(lambda: publication.prepare_publication_intent(request), 'INVALID_REQUEST')
        self.journals.chmod(0o755)
        try:
            self.refused(lambda: publication.prepare_publication_intent(self.request), 'INVALID_REQUEST')
            self.assertEqual(self.journals.stat().st_mode & 0o777, 0o755)
        finally:
            self.journals.chmod(0o700)
        self.assertEqual(list(self.journals.iterdir()), [])

    def test_wrong_source_mode_is_not_repaired(self):
        self.db.chmod(0o644)
        try:
            self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_SOURCE_MISMATCH')
            self.assertEqual(self.db.stat().st_mode & 0o777, 0o644)
        finally:
            self.db.chmod(0o600)

    def test_marker_interruption_retains_original_request_and_never_reconstructs(self):
        real_write = io.write_record
        def interrupted(path, value, *args):
            if Path(path).name == 'complete.json':
                self.assertTrue((self.journal()/'intent.json').exists())
                raise OSError('injected before final marker')
            return real_write(path, value, *args)
        with mock.patch.object(io, 'write_record', side_effect=interrupted):
            self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_UNCONFIRMED')
        before = self.bytes(self.journal())
        self.assertEqual(publication.inspect_publication_intent(self.request)['status'], 'intent_incomplete')
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_INCOMPLETE')
        self.assertEqual(self.bytes(self.journal()), before)
        self.assertEqual(io.read_record(self.journal()/'request.json')[0], self.request)

    def test_lost_post_marker_flush_is_observed_then_same_id_freshly_confirms(self):
        with mock.patch.object(publication, '_flush', side_effect=OSError('injected marker flush loss')):
            error = self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_UNCONFIRMED')
        self.assertEqual(error.evidence['journal_path'], str(self.journal()))
        self.assertEqual(error.evidence['cause'], 'OSError')
        observed = publication.inspect_publication_intent(self.request)
        self.assertEqual(observed['status'], 'intent_observed')
        self.assertFalse(observed['durability_confirmed'])
        before = self.bytes(self.journal())
        self.assertTrue(publication.prepare_publication_intent(self.request)['durability_confirmed'])
        self.assertEqual(self.bytes(self.journal()), before)

    def test_close_error_after_marker_is_uncertain_and_lock_is_actually_released(self):
        real_close = os.close
        def close(fd):
            same = (self.journal()/'intent.lock').exists() and io.identity(os.fstat(fd)) == io.identity((self.journal()/'intent.lock').stat())
            real_close(fd)
            if same:
                raise OSError('injected closed descriptor error')
        with mock.patch.object(publication.os, 'close', side_effect=close):
            self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_UNCONFIRMED')
        self.assertEqual(publication.inspect_publication_intent(self.request)['status'], 'intent_observed')
        with (self.journal()/'intent.lock').open('rb') as fd:
            fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertTrue(publication.prepare_publication_intent(self.request)['durability_confirmed'])

    def test_no_weaker_flush_fallback_or_cleanup(self):
        with mock.patch.object(io, 'full_flush', side_effect=OSError('full flush unavailable')):
            self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_UNCONFIRMED')
        self.assertTrue(self.journal().exists())
        self.assertEqual(publication.inspect_publication_intent(self.request)['status'], 'intent_incomplete')
        self.refused(lambda: publication.prepare_publication_intent(self.request), 'PUBLICATION_INCOMPLETE')

    def test_journal_busy_blocks_retry_and_inspection(self):
        publication.prepare_publication_intent(self.request)
        before = self.bytes(self.journal())
        with (self.journal()/'intent.lock').open('rb') as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            for method in (publication.prepare_publication_intent, publication.inspect_publication_intent):
                error = self.refused(lambda: method(self.request), 'PUBLICATION_BUSY')
                self.assertTrue(error.retryable)
        self.assertEqual(self.bytes(self.journal()), before)

    def test_replaced_journal_directory_lock_and_tampered_intent_refuse(self):
        for damage in ('directory', 'lock', 'intent', 'extra'):
            request = self.fresh_journal_request()
            publication.prepare_publication_intent(request); root = self.journal(request)
            if damage == 'directory':
                retained = root.with_name('retained-'+root.name); root.rename(retained); shutil.copytree(retained, root)
            elif damage == 'lock':
                (root/'intent.lock').rename(root/'retained.lock')
                (root/'intent.lock').write_bytes(b''); (root/'intent.lock').chmod(0o600)
            elif damage == 'intent':
                record, _ = io.read_record(root/'intent.json'); record['predecessor']['anchor']['epoch'] = 'tampered'
                (root/'intent.json').write_bytes(io.encode(record))
            else:
                (root/'extra').write_bytes(b'unverified')
            self.refused(lambda: publication.inspect_publication_intent(request), 'PUBLICATION_INVALID')

    def test_source_writes_after_observation_do_not_refresh_the_record(self):
        first = publication.prepare_publication_intent(self.request)
        command = copy.deepcopy(self.operation); command['operation_id'] = 'later-operation'
        command['args'] = {'id': 'later-work', 'title': 'Later source write'}
        self.assertEqual(self.store.command('fixture-owner', command)['status'], 'committed')
        self.assertNotEqual(io.read_metadata(self.db)['commit_id'], self.preparation['commit']['id'])
        self.assertEqual(publication.prepare_publication_intent(self.request), first)
        self.refused(lambda: publication.prepare_publication_intent(self.fresh_journal_request()), 'PUBLICATION_SOURCE_MISMATCH')


if __name__ == '__main__':
    unittest.main()

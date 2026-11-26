from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import unittest
from unittest import mock
import uuid

from aim_next import Store, relocation, relocation_publication as publication, recovery_io as io
from aim_next.authority import AuthorityError
import test_authority_relocation as fixture

AVAILABLE = importlib.util.find_spec('aim_next.relocation_stage') is not None
EVIDENCE = {'flush_boundaries': []}
if AVAILABLE:
    from aim_next import relocation_stage as staging


class Availability(unittest.TestCase):
    def test_inactive_destination_staging_api_exists(self):
        self.assertTrue(AVAILABLE, '1325 inactive destination staging is absent')


@unittest.skipUnless(AVAILABLE, '1325 API absent; behavior bodies/targets do not enter')
class StageCase(unittest.TestCase):
    bytes = fixture.RelocationCase.bytes
    refused = fixture.RelocationCase.refused

    def setUp(self):
        fixture.RelocationCase.setUp(self)
        self.preparation = self.request
        self.preparation['owners']['destination_uid'] = os.getuid()
        self.intents = self.root/'intents'; self.intents.mkdir(mode=0o700)
        self.journals = self.root/"stage journal λ apostrophe's"; self.journals.mkdir(mode=0o700)
        self.operator = self.root/'operator'; self.operator.mkdir(mode=0o700)
        for name, value in [('control.json', dict(owner='fixture-owner', choice='Stop', revision=7)),
                            ('plan.json', dict(state='stopped', revision=9, binding=self.binding)),
                            ('operation.json', dict(operation_id='original-lost-response', exact='original private writing'))]:
            io.write_record(self.operator/name, value)
        self.request = self.prepare_request(self.preparation)
        self.preserved = self.source_bytes()

    def prepare_request(self, prep):
        relocation.prepare(prep)
        request = dict(v=1, preparation=prep, journal_root=str(self.intents))
        intent = publication.prepare_publication_intent(request)['intent']
        return dict(v=1, intent_request=request, intent_digest=io.digest_record(intent), journal_root=str(self.journals))

    def fresh_request(self):
        prep = copy.deepcopy(self.preparation); prep['move_id'] = str(uuid.uuid4())
        parent = self.root/('future-'+prep['move_id'])
        prep['destination'] = dict(db_path=str(parent/'data.sqlite3'), authority_path=str(parent/'authority.json'))
        return self.prepare_request(prep)

    def journal(self, request=None):
        request = request or self.request
        return Path(request['journal_root'])/request['intent_request']['preparation']['move_id']

    def targets(self, request=None):
        request = request or self.request
        dest = request['intent_request']['preparation']['destination']
        return Path(dest['db_path']), Path(dest['authority_path']), Path(dest['db_path']+'.media')

    def source_bytes(self):
        return {name: self.bytes(self.root/name) for name in ('original', 'control', 'bundle', 'staging', 'intents', 'operator')}

    def tables(self, path):
        with io.connection(path) as db:
            names = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            return {name: sorted((row for row in db.execute('SELECT * FROM "'+name.replace('"', '""')+'"')
                                 if not (name == 'metadata' and row[0] in ('authority_path', 'authority_epoch'))), key=repr)
                    for name, in names}

    def test_reachable_stage_preserves_records_media_and_three_actual_identities(self):
        original = self.tables(self.db)
        result = staging.stage_relocation(self.request)
        self.assertEqual(result['status'], 'staged')
        self.assertTrue(result['inactive'] and result['durability_confirmed'])
        self.assertNotIn('binding', result)
        record = result['stage']; db, anchor, media = self.targets()
        self.assertFalse(anchor.exists())
        self.assertEqual(record['whitelist'], ['authority_epoch', 'authority_path'])
        self.assertEqual(self.tables(db), original)
        self.assertEqual(self.bytes(media), self.bytes(Path(str(self.db)+'.media')))
        self.assertEqual(self.source_bytes(), self.preserved)
        self.assertNotEqual(io.identity(db.stat()), io.identity(self.db.stat()))
        for name, path in [('database', db), ('authority_lock', Path(str(anchor)+'.lock')),
                           ('runner_lock', Path(str(anchor)+'.runner.lock'))]:
            self.assertEqual(record['identities'][name], io.identity(path.stat()))
        claim, _ = io.read_record(self.journal()/'claim.json')
        self.assertEqual(claim['epoch'], record['epoch'])
        self.assertEqual(io.read_metadata(db)['authority_epoch'], claim['epoch'])
        self.assertEqual(io.read_metadata(db)['authority_path'], str(anchor))
        self.assertNotEqual(claim['epoch'], self.binding['authority_epoch'])
        self.assertEqual(self.store.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), self.receipt)

    def test_unchanged_store_validators_refuse_unpublished_target_and_source_can_still_write(self):
        result = staging.stage_relocation(self.request); db, anchor, _ = self.targets()
        prospective = dict(self.binding, authority_path=str(anchor), authority_epoch=result['stage']['epoch'])
        for binding in (self.binding, prospective):
            with self.assertRaises(AuthorityError):
                Store(db, self.store.instance_id, expected_binding=binding)
        before = self.bytes(db.parent)
        command = dict(v=1, instance_id=self.store.instance_id, operation_id='new-source-operation', kind='workspace.create',
            target={}, expected={'authority': {k: self.binding[k] for k in ('authority_id', 'authority_epoch')}},
            args={'id': 'new-source-work', 'title': 'Source remains writable'})
        self.assertEqual(self.store.command('fixture-owner', command)['status'], 'committed')
        self.assertEqual(self.bytes(db.parent), before)

    def test_readback_is_read_only_before_and_after_staging(self):
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            self.assertEqual(staging.inspect_relocation_stage(self.request)['status'], 'not_started')
        self.assertEqual(list(self.journals.iterdir()), [])
        first = staging.stage_relocation(self.request); before = self.bytes(self.journal()), self.bytes(self.targets()[0].parent)
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            result = staging.inspect_relocation_stage(self.request)
        self.assertEqual(result['status'], 'staged_observed'); self.assertFalse(result['durability_confirmed'])
        self.assertEqual(result['stage'], first['stage'])
        self.assertEqual(before, (self.bytes(self.journal()), self.bytes(self.targets()[0].parent)))

    def test_completed_retry_reuses_epoch_payload_without_historical_roots(self):
        first = staging.stage_relocation(self.request)
        for name in ('original', 'control', 'bundle', 'staging', 'intents'):
            (self.root/name).rename(self.root/('retained-'+name))
        with mock.patch.object(io, 'copy_file', side_effect=AssertionError('retry recopied')), \
             mock.patch.object(staging.uuid, 'uuid4', side_effect=AssertionError('retry allocated epoch')):
            self.assertEqual(staging.stage_relocation(self.request), first)
            self.assertEqual(staging.inspect_relocation_stage(self.request)['stage'], first['stage'])

    def test_same_identity_changed_request_refuses_without_mutating_claim(self):
        staging.stage_relocation(self.request); before = self.bytes(self.journal())
        changed = copy.deepcopy(self.request); changed['intent_digest'] = '0'*64
        for method in (staging.stage_relocation, staging.inspect_relocation_stage):
            self.refused(lambda: method(changed), 'STAGE_REQUEST_MISMATCH')
        self.assertEqual(self.bytes(self.journal()), before)

    def test_cross_uid_requires_separate_handoff_without_input_repair(self):
        changed = copy.deepcopy(self.request); changed['intent_request']['preparation']['owners']['destination_uid'] += 1
        before = copy.deepcopy(changed)
        self.refused(lambda: staging.stage_relocation(changed), 'OWNERSHIP_HANDOFF_REQUIRED')
        self.assertEqual(changed, before); self.assertEqual(list(self.journals.iterdir()), [])

    def test_bad_intent_digest_or_candidate_has_no_new_journal_or_target(self):
        self.refused(lambda: staging.stage_relocation(dict(self.request, intent_digest='f'*64)), 'STAGE_INTENT_MISMATCH')
        stage = Path(self.preparation['staging_root'])/self.preparation['move_id']
        (stage/'media'/'b-private').write_bytes(b'corrupted actual candidate')
        with self.assertRaises(io.RecoveryError): staging.stage_relocation(self.request)
        self.assertEqual(list(self.journals.iterdir()), []); self.assertFalse(self.targets()[0].parent.exists())

    def test_collision_does_not_replace_or_adopt_existing_target(self):
        db, _, _ = self.targets(); db.parent.mkdir(mode=0o700); db.write_bytes(b'preexisting'); db.chmod(0o600)
        self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_TARGET_OCCUPIED')
        self.assertEqual(db.read_bytes(), b'preexisting')
        self.assertEqual(staging.inspect_relocation_stage(self.request)['status'], 'stage_incomplete')

    def test_incomplete_copy_keeps_epoch_and_never_recopies_or_reallocates(self):
        with mock.patch.object(io, 'copy_file', side_effect=OSError('injected copy failure')):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_UNCONFIRMED')
        claim, _ = io.read_record(self.journal()/'claim.json'); before = self.bytes(self.journal())
        with mock.patch.object(io, 'copy_file', side_effect=AssertionError('partial recopy')), \
             mock.patch.object(staging.uuid, 'uuid4', side_effect=AssertionError('partial new epoch')):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_INCOMPLETE')
            self.assertEqual(staging.inspect_relocation_stage(self.request)['status'], 'stage_incomplete')
        self.assertEqual(self.bytes(self.journal()), before)
        self.assertEqual(io.read_record(self.journal()/'claim.json')[0]['epoch'], claim['epoch'])

    def test_metadata_interruption_rolls_back_the_real_first_whitelisted_update(self):
        real = staging._metadata; calls = []
        def fail(claim):
            calls.append(1)
            if len(calls) == 2: raise OSError('after first UPDATE before second')
            return real(claim)
        with mock.patch.object(staging, '_metadata', side_effect=fail):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_UNCONFIRMED')
        self.assertEqual(len(calls), 2)
        self.assertEqual(io.read_metadata(self.targets()[0]), self.manifest['metadata'])
        self.assertEqual(staging.inspect_relocation_stage(self.request)['status'], 'stage_incomplete')

    def test_failed_final_marker_retains_complete_copy_without_adopting_it(self):
        real = io.write_record
        def fail(path, value, *args):
            if Path(path).name == 'staged.json':
                self.assertEqual(io.read_metadata(self.targets()[0])['authority_path'], str(self.targets()[1]))
                raise OSError('before final marker')
            return real(path, value, *args)
        with mock.patch.object(io, 'write_record', side_effect=fail):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_UNCONFIRMED')
        self.assertFalse((self.journal()/'staged.json').exists())
        self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_INCOMPLETE')

    def test_lost_final_flush_is_observed_then_same_epoch_freshly_confirms(self):
        with mock.patch.object(staging, '_flush', side_effect=OSError('post-marker flush loss')):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_UNCONFIRMED')
        observed = staging.inspect_relocation_stage(self.request)
        self.assertEqual(observed['status'], 'staged_observed'); self.assertFalse(observed['durability_confirmed'])
        with mock.patch.object(staging.uuid, 'uuid4', side_effect=AssertionError('new epoch')):
            confirmed = staging.stage_relocation(self.request)
        self.assertTrue(confirmed['durability_confirmed']); self.assertEqual(confirmed['stage'], observed['stage'])

    def test_every_checked_full_flush_boundary_retains_a_safe_reconcilable_attempt(self):
        real = io.full_flush; trace = []
        def count(fd): trace.append(1); return real(fd)
        with mock.patch.object(io, 'full_flush', side_effect=count): staging.stage_relocation(self.request)
        self.assertGreater(len(trace), 10)
        for boundary in range(1, len(trace)+1):
            request = self.fresh_request(); calls = []
            def fail(fd):
                calls.append(1)
                if len(calls) == boundary: raise OSError('injected full flush boundary %s'%boundary)
                return real(fd)
            with self.subTest(boundary=boundary):
                with mock.patch.object(io, 'full_flush', side_effect=fail):
                    with self.assertRaises(io.RecoveryError): staging.stage_relocation(request)
                self.assertEqual(len(calls), boundary)
                self.assertFalse(self.targets(request)[1].exists())
                with mock.patch.object(io, 'full_flush', side_effect=AssertionError('inspection flushed')):
                    result = staging.inspect_relocation_stage(request)
                self.assertIn(result['status'], ('stage_incomplete', 'staged_observed'))
                EVIDENCE['flush_boundaries'].append(dict(boundary=boundary, total=len(trace), actual_calls=len(calls),
                    observed_status=result['status'], no_destination_anchor=not self.targets(request)[1].exists()))
        self.assertEqual(self.store.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), self.receipt)

    def test_real_close_then_injected_close_error_is_uncertain_and_releases_both_locks(self):
        real = os.close
        def close(fd):
            path = Path(str(self.targets()[1])+'.runner.lock')
            same = path.exists() and io.identity(os.fstat(fd)) == io.identity(path.stat())
            real(fd)
            if same and (self.journal()/'staged.json').exists():
                raise OSError('actual post-marker close completed but return lost')
        with mock.patch.object(staging.os, 'close', side_effect=close):
            self.refused(lambda: staging.stage_relocation(self.request), 'STAGE_UNCONFIRMED')
        self.assertEqual(staging.inspect_relocation_stage(self.request)['status'], 'staged_observed')
        for suffix in ('.lock', '.runner.lock'):
            with Path(str(self.targets()[1])+suffix).open('rb') as held: fcntl.flock(held.fileno(), fcntl.LOCK_EX|fcntl.LOCK_NB)

    def test_post_handoff_guard_refuses_before_opening_or_flushing_active_target(self):
        result = staging.stage_relocation(self.request); db, anchor, _ = self.targets()
        previous, _ = io.read_record(self.anchor)
        # Isolated handoff fixture: retire old before making the target active.
        self.anchor.write_bytes(io.encode(dict(previous, state='retired')))
        target = dict(previous, db_path=str(db), epoch=result['stage']['epoch'], state='active')
        for name, prefix in [('database', 'db'), ('authority_lock', 'lock'), ('runner_lock', 'runner_lock')]:
            target[prefix+'_device'], target[prefix+'_inode'] = result['stage']['identities'][name]
        io.write_record(anchor, target)
        before = self.bytes(db.parent)
        for method in (staging.stage_relocation, staging.inspect_relocation_stage):
            self.refused(lambda: method(self.request), 'STAGE_DESTINATION_CHANGED')
        for method in (staging.stage_relocation, staging.inspect_relocation_stage):
            with mock.patch.object(io, 'full_flush', side_effect=AssertionError('active data flushed')), \
                 mock.patch.object(io, 'connection', side_effect=AssertionError('active DB opened')):
                self.refused(lambda: method(self.request), 'STAGE_DESTINATION_CHANGED')
        self.assertEqual(self.bytes(db.parent), before)
        with self.assertRaises(AuthorityError): Store(self.db, self.store.instance_id, expected_binding=self.binding)
        prospective = dict(self.binding, authority_path=str(anchor), authority_epoch=result['stage']['epoch'])
        successor = Store(db, self.store.instance_id, expected_binding=prospective)
        self.assertEqual(successor.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), self.receipt)

    def test_destination_authority_fence_is_actually_held_during_target_read(self):
        staging.stage_relocation(self.request); real = staging._payload; entered = []
        def verify(*args):
            with Path(str(self.targets()[1])+'.lock').open('rb') as lock:
                with self.assertRaises(BlockingIOError): fcntl.flock(lock.fileno(), fcntl.LOCK_EX|fcntl.LOCK_NB)
            entered.append(1); return real(*args)
        with mock.patch.object(staging, '_payload', side_effect=verify): staging.inspect_relocation_stage(self.request)
        self.assertEqual(len(entered), 1)

    def test_journal_and_destination_busy_are_typed_and_do_not_mutate(self):
        staging.stage_relocation(self.request); before = self.bytes(self.journal()), self.bytes(self.targets()[0].parent)
        for path, code in [(self.journal()/'intent.lock', 'PUBLICATION_BUSY'),
                           (Path(str(self.targets()[1])+'.lock'), 'STAGE_BUSY')]:
            with path.open('rb') as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX|fcntl.LOCK_NB)
                for method in (staging.stage_relocation, staging.inspect_relocation_stage):
                    self.assertTrue(self.refused(lambda: method(self.request), code).retryable)
        self.assertEqual(before, (self.bytes(self.journal()), self.bytes(self.targets()[0].parent)))

    def test_replaced_target_db_locks_and_media_are_not_adopted(self):
        for damage in ('db', 'authority_lock', 'runner_lock', 'media', 'extra'):
            request = self.fresh_request(); staging.stage_relocation(request); db, anchor, media = self.targets(request)
            if damage in ('db', 'authority_lock', 'runner_lock'):
                path = db if damage == 'db' else Path(str(anchor)+('.lock' if damage == 'authority_lock' else '.runner.lock'))
                retained = path.with_name(path.name+'.retained'); path.rename(retained); shutil.copyfile(retained, path); path.chmod(0o600)
            elif damage == 'media': (media/'b-private').write_bytes(b'actual corrupt media')
            else: (media/'unclaimed').write_bytes(b'extra')
            with self.assertRaises(io.RecoveryError): staging.inspect_relocation_stage(request)

    def test_replaced_journal_and_claim_tampering_refuse(self):
        staging.stage_relocation(self.request); root = self.journal(); retained = root.with_name('retained-'+root.name)
        root.rename(retained); shutil.copytree(retained, root)
        self.refused(lambda: staging.inspect_relocation_stage(self.request), 'STAGE_INVALID')

    def test_bad_alias_private_mode_and_protected_target_roots_refuse(self):
        alias = self.root/'alias'; alias.symlink_to(self.journals, target_is_directory=True)
        for request in (dict(self.request, v=True), dict(self.request, journal_root='relative'),
                        dict(self.request, journal_root=str(alias)), dict(self.request, journal_root=str(self.root))):
            self.refused(lambda: staging.stage_relocation(request), 'INVALID_REQUEST')
        changed = copy.deepcopy(self.request); changed['intent_request']['preparation']['destination']['db_path'] = str(self.root/'bundle'/'new.sqlite3')
        self.refused(lambda: staging.stage_relocation(changed), 'INVALID_REQUEST')
        self.journals.chmod(0o755)
        try: self.refused(lambda: staging.stage_relocation(self.request), 'INVALID_REQUEST')
        finally: self.journals.chmod(0o700)
        self.assertEqual(list(self.journals.iterdir()), [])

    def test_new_source_commit_does_not_turn_historical_staging_into_a_lease(self):
        with sqlite3.connect(str(self.db)) as db: db.execute("UPDATE metadata SET value='999' WHERE key='commit_seq'")
        result = staging.stage_relocation(self.request)
        self.assertEqual(result['stage']['metadata']['commit_seq'], self.preparation['commit']['seq'])
        self.assertNotEqual(result['stage']['metadata']['commit_seq'], io.read_metadata(self.db)['commit_seq'])


if __name__ == '__main__':
    unittest.main()

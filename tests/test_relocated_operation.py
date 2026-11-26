from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import unittest
from unittest import mock

from aim_next import Store, backup, recovery_io as io, relocation_cutover as cutover
from aim_next.authority import AuthorityError, AuthorityFence
from aim_next.contract import _json
import test_authority_cutover as fixture

AVAILABLE = importlib.util.find_spec('aim_next.relocation_operations') is not None
if AVAILABLE: from aim_next import relocation_operations as reader
EVIDENCE = {'observed_reads': [], 'prohibited_acceptance_controls': []}


class Availability(unittest.TestCase):
    def test_lineage_operation_reader_exists(self):
        self.assertTrue(AVAILABLE, '1328 one-hop operation reader is absent')


@unittest.skipUnless(AVAILABLE, '1328 absent; behavior bodies and reader targets cannot enter')
class LookupCase(unittest.TestCase):
    def setUp(self):
        self.engine = fixture.CutoverCase('test_reachable_cutover_preserves_data_and_unchanged_validators_fence_the_source')
        self.addCleanup(self.engine.doCleanups)
        real_backup = backup.backup
        def seed_refusal(db_path, instance, **kwargs):
            original = Store(db_path, instance, expected_binding=kwargs['expected_binding'])
            self.denied_command = dict(v=1, instance_id=instance, operation_id='original-refused-response',
                kind='workspace.create', target={}, expected={'authority': {k: original.binding[k]
                    for k in ('authority_id', 'authority_epoch')}},
                args={'id': 'private-work', 'title': 'Original recorded refusal'})
            self.denied = original.command('fixture-owner', self.denied_command)
            self.assertEqual((self.denied['status'], self.denied['recorded']), ('rejected', True))
            with sqlite3.connect(str(db_path)) as db:
                db.execute('INSERT INTO actors VALUES (?,?,?,?)', ('fixture-other', 'agent', 'Other fixture actor', 1))
            return real_backup(db_path, instance, **kwargs)
        with mock.patch.object(backup, 'backup', side_effect=seed_refusal): self.engine.setUp()
        self.fx = self.engine.fx
        self.published = cutover.publish_relocation(self.engine.request)
        self.current = Store(self.fx.targets()[0], self.fx.store.instance_id,
            expected_binding={k: self.published['binding'][k]
                              for k in ('authority_path', 'authority_id', 'authority_epoch')})
        self.saved = dict(v=1, binding=dict(instance_id=self.fx.store.instance_id, actor_id='fixture-owner',
            db_path=str(self.fx.db), authority_id=self.fx.binding['authority_id'],
            authority_epoch=self.fx.binding['authority_epoch']), command=dict(v=1,
            instance_id=self.fx.store.instance_id, operation_id='original-lost-response',
            kind='workspace.create', target={}, expected={'authority': {k: self.fx.binding[k]
                for k in ('authority_id', 'authority_epoch')}},
            args={'id': 'private-work', 'title': 'Original exact private writing'}))
        self.outbox = self.fx.root/'old-outbox'; self.outbox.mkdir(mode=0o700)
        io.write_record(self.outbox/'original.request.json', self.saved)
        io.write_record(self.outbox/'original.receipt.json', self.fx.receipt)

    def lookup(self, saved=None, receipt=None, actor='fixture-owner'):
        return reader.lookup_relocated_operation(self.current, actor,
            self.saved if saved is None else saved, self.published if receipt is None else receipt)

    def refused(self, call, code=None):
        with self.assertRaises(io.RecoveryError) as caught: call()
        if code is not None: self.assertEqual(caught.exception.code, code)
        return caught.exception

    def snapshot(self):
        return self.fx.bytes(self.fx.root)

    def anchor(self, record):
        path = self.fx.targets()[1]
        path.write_text(_json(record)+'\n'); path.chmod(0o600)

    def new_write(self):
        operation = self.engine.command(self.fx, self.current.binding, 'New destination writing')
        result = self.current.command('fixture-owner', operation)
        self.assertEqual(result['status'], 'committed')
        return result

    def test_exact_committed_result_fingerprint_and_transition_are_read_without_mutation(self):
        before = self.snapshot(); saved = copy.deepcopy(self.saved); receipt = copy.deepcopy(self.published)
        with mock.patch.object(self.current, 'view', wraps=self.current.view) as view:
            result = self.lookup()
        fingerprint = hashlib.sha256(_json(self.saved['command']).encode('utf-8')).hexdigest()
        self.assertEqual(view.call_args, mock.call('fixture-owner', 'operation',
            {'operation_id': 'original-lost-response', 'expected_fingerprint': fingerprint}))
        self.assertEqual(result['receipt'], self.fx.receipt)
        self.assertEqual(result['fingerprint'], fingerprint)
        self.assertEqual(result['status'], 'recorded'); self.assertFalse(result['replay_allowed'])
        lineage = io.read_record(self.fx.targets()[1])[0]['recovery']['relocation']
        self.assertEqual(result['transition'], lineage)
        self.assertEqual((self.saved, self.published), (saved, receipt))
        self.assertEqual(self.snapshot(), before)
        EVIDENCE['observed_reads'].append(dict(kind='committed', fingerprint=fingerprint,
            original_receipt=self.fx.receipt, returned_receipt=result['receipt'], transition=result['transition']))

    def test_actual_recorded_refusal_is_returned_exactly(self):
        saved = copy.deepcopy(self.saved); saved['command'] = self.denied_command
        before = self.snapshot(); result = self.lookup(saved)
        self.assertEqual(result['status'], 'recorded'); self.assertEqual(result['receipt'], self.denied)
        self.assertEqual(self.snapshot(), before)
        EVIDENCE['observed_reads'].append(dict(kind='recorded_refusal', original_receipt=self.denied,
                                             returned_receipt=result['receipt']))

    def test_missing_original_operation_is_held_without_sending_or_inventing_result(self):
        saved = copy.deepcopy(self.saved); saved['command']['operation_id'] = 'absent-original'
        before = self.snapshot()
        with mock.patch.object(Store, 'command', side_effect=AssertionError('reader replayed')):
            result = self.lookup(saved)
        self.assertEqual(result['status'], 'unknown_held'); self.assertFalse(result['replay_allowed'])
        self.assertEqual(result['receipt']['status'], 'unknown'); self.assertFalse(result['receipt']['recorded'])
        self.assertEqual(self.snapshot(), before)

    def test_altered_original_same_id_writing_is_rejected_by_the_mandatory_fingerprint(self):
        changed = copy.deepcopy(self.saved); changed['command']['args']['title'] = 'Wrong writing under same ID'
        before = self.snapshot()
        self.refused(lambda: self.lookup(changed), 'OPERATION_PAYLOAD_MISMATCH')
        self.assertEqual(self.snapshot(), before)
        EVIDENCE['prohibited_acceptance_controls'].append('changed same-ID original writing refused')

    def test_new_destination_writes_do_not_roll_back_or_require_old_cutover_commit(self):
        self.new_write(); before = self.snapshot(); result = self.lookup()
        self.assertEqual(result['receipt'], self.fx.receipt); self.assertEqual(self.snapshot(), before)
        self.assertNotEqual(io.read_metadata(self.current.path)['commit_id'],
                            self.published['cutover_commit']['commit_id'])

    def test_current_owner_stop_continue_revisions_and_outbox_remain_explicit_and_unchanged(self):
        control = self.fx.operator/'control.json'; value = io.read_record(control)[0]
        value.update(choice='Continue', revision=8); control.write_text(_json(value)+'\n')
        self.new_write(); before = self.snapshot()
        self.lookup(); self.assertEqual(self.snapshot(), before)
        with sqlite3.connect(str(self.current.path)) as db:
            self.assertEqual(db.execute('SELECT owner_id FROM workspaces WHERE id=?', ('private-work',)).fetchone(),
                             ('fixture-owner',))
        self.assertEqual(io.read_record(control)[0], value)

    def test_original_actor_cannot_be_replaced_by_another_caller(self):
        self.refused(lambda: self.lookup(actor='fixture-other'), 'LOOKUP_ACTOR_MISMATCH')

    def test_other_enabled_actor_does_not_obtain_the_original_actors_receipt(self):
        saved = copy.deepcopy(self.saved); saved['binding']['actor_id'] = 'fixture-other'
        result = self.lookup(saved, actor='fixture-other')
        self.assertEqual(result['status'], 'unknown_held'); self.assertNotEqual(result['receipt'], self.fx.receipt)

    def test_disabled_current_actor_cannot_read_its_old_result(self):
        with sqlite3.connect(str(self.current.path)) as db:
            db.execute('UPDATE actors SET enabled=0 WHERE id=?', ('fixture-owner',))
        self.refused(self.lookup, 'INVALID_ACTOR')

    def test_wrong_original_instance_epoch_authority_and_db_refuse_before_operation_read(self):
        for field in ('instance_id', 'authority_epoch', 'authority_id', 'db_path'):
            with self.subTest(field=field):
                saved = copy.deepcopy(self.saved)
                saved['binding'][field] = '/missing/original.sqlite' if field == 'db_path' else 'foreign-'+field
                if field == 'instance_id': saved['command']['instance_id'] = saved['binding'][field]
                if field in ('authority_epoch', 'authority_id'):
                    saved['command']['expected']['authority'][field] = saved['binding'][field]
                with mock.patch.object(self.current, 'view', side_effect=AssertionError('foreign predecessor queried')):
                    self.refused(lambda: self.lookup(saved), 'LOOKUP_PREDECESSOR_MISMATCH')

    def test_command_captured_authority_must_agree_with_unchanged_wrapper(self):
        saved = copy.deepcopy(self.saved); saved['command']['expected']['authority']['authority_epoch'] = 'new-epoch'
        self.refused(lambda: self.lookup(saved), 'LOOKUP_PREDECESSOR_MISMATCH')

    def test_observed_partial_or_unconfirmed_publication_cannot_supply_the_transition(self):
        for change in ({'status': 'published_observed'}, {'durability_confirmed': False}, {'binding': {}}):
            with self.subTest(change=change):
                receipt = dict(self.published, **change)
                self.refused(lambda: self.lookup(receipt=receipt), 'LOOKUP_RECEIPT_MISMATCH')

    def test_current_destination_binding_must_match_every_receipt_field(self):
        for field in self.published['binding']:
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.published); receipt['binding'][field] += '-wrong'
                self.refused(lambda: self.lookup(receipt=receipt), 'LOOKUP_RECEIPT_MISMATCH')

    def test_wrong_published_receipt_move_digest_journal_or_historical_commit_is_not_accepted(self):
        for field in ('move_id', 'request_digest', 'journal_path', 'commit_seq', 'commit_id', 'schema_version',
                      'authority_epoch', 'authority_path', 'instance_id', 'authority_id'):
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.published)
                if field in ('move_id', 'request_digest', 'journal_path'):
                    receipt[field] = 'f'*64 if field == 'request_digest' else receipt[field]+'-foreign'
                else: receipt['cutover_commit'][field] += '-wrong'
                self.refused(lambda: self.lookup(receipt=receipt), 'LOOKUP_TRANSITION_MISMATCH')
        EVIDENCE['prohibited_acceptance_controls'].append('foreign published transition refused')

    def test_older_unlinked_predecessor_is_held_without_history_search(self):
        record = io.read_record(self.fx.targets()[1])[0]
        record['recovery']['relocation']['predecessor']['authority_epoch'] = 'unlinked-earlier-epoch'
        self.anchor(record)
        self.refused(self.lookup, 'LOOKUP_PREDECESSOR_MISMATCH')

    def test_missing_or_structurally_corrupt_current_lineage_is_held(self):
        original = io.read_record(self.fx.targets()[1])[0]
        for recovery in (None, {}, {'kind': 'initial'}, {'kind': 'relocation', 'relocation': {}}):
            with self.subTest(recovery=recovery):
                self.anchor(dict(original, recovery=recovery))
                self.refused(self.lookup, 'LOOKUP_LINEAGE_MISMATCH')

    def test_original_private_roots_and_cutover_validators_are_never_opened_or_called(self):
        protected = [self.fx.db.parent, self.fx.anchor.parent, self.engine.root(),
                     Path(self.fx.preparation['staging_root']), self.fx.intents]
        real_open = os.open
        def guard(path, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)):
                p = Path(os.fsdecode(path))
                self.assertFalse(any(p == root or root in p.parents for root in protected), str(p))
            return real_open(path, *args, **kwargs)
        with mock.patch.object(os, 'open', side_effect=guard), \
                mock.patch.object(cutover, 'relocation_readback', side_effect=AssertionError('old UID readback')), \
                mock.patch.object(cutover, 'publish_relocation', side_effect=AssertionError('publisher called')), \
                mock.patch.object(Store, 'command', side_effect=AssertionError('replay sent')), \
                mock.patch.object(io, 'full_flush', side_effect=AssertionError('reader flushed')):
            self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_missing_old_database_and_journals_do_not_prevent_current_lineage_lookup(self):
        self.fx.db.unlink()
        for path in [self.engine.root(), self.fx.intents, Path(self.fx.preparation['staging_root'])]:
            shutil.rmtree(path)
        self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_live_destination_runner_guard_does_not_block_a_shared_read(self):
        with self.current.runner_guard('fixture-running-destination'):
            self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_exclusive_authority_busy_is_retryable_not_missing(self):
        fd = os.open(str(self.fx.targets()[1])+'.lock', os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            error = self.refused(self.lookup, 'AUTHORITY_BUSY'); self.assertTrue(error.retryable)
        finally: os.close(fd)

    def test_retired_or_foreign_current_anchor_cannot_be_used(self):
        original = io.read_record(self.fx.targets()[1])[0]
        for changed in ({'state': 'retired'}, {'authority_id': 'foreign-authority'}, {'epoch': 'foreign-epoch'}):
            with self.subTest(changed=changed):
                self.anchor(dict(original, **changed)); self.refused(self.lookup, 'AUTHORITY_CHANGED')

    def test_replaced_db_authority_lock_and_runner_lock_identities_refuse(self):
        for path in [self.current.path, Path(str(self.fx.targets()[1])+'.lock'),
                     Path(str(self.fx.targets()[1])+'.runner.lock')]:
            with self.subTest(path=path.name):
                old = path.with_name(path.name+'.held'); path.rename(old)
                shutil.copyfile(old, path); path.chmod(0o600)
                try: self.refused(self.lookup)
                finally: path.unlink(); old.rename(path)

    def test_lineage_change_during_actual_operation_read_discards_the_result(self):
        view = self.current.view
        def changed(*args):
            value = view(*args)
            record = io.read_record(self.fx.targets()[1])[0]
            record['recovery']['relocation']['request_digest'] = 'a'*64
            self.anchor(record); return value
        with mock.patch.object(self.current, 'view', side_effect=changed):
            self.refused(self.lookup, 'LOOKUP_LINEAGE_CHANGED')

    def test_db_replacement_after_operation_read_is_detected_before_return(self):
        view = self.current.view
        def changed(*args):
            value = view(*args); path = self.current.path
            path.rename(path.with_name('retained.sqlite')); shutil.copyfile(path.with_name('retained.sqlite'), path)
            path.chmod(0o600); return value
        with mock.patch.object(self.current, 'view', side_effect=changed):
            self.refused(self.lookup, 'AUTHORITY_CHANGED')

    def test_runner_lock_replacement_after_read_is_detected_before_return(self):
        view = self.current.view
        def changed(*args):
            value = view(*args); path = Path(str(self.fx.targets()[1])+'.runner.lock')
            path.rename(path.with_name('retained.runner.lock')); path.touch(mode=0o600); return value
        with mock.patch.object(self.current, 'view', side_effect=changed):
            self.refused(self.lookup, 'LOOKUP_IDENTITY_CHANGED')

    def test_new_commit_between_the_read_and_final_identity_check_is_valid(self):
        view = self.current.view
        def advanced(*args):
            value = view(*args); self.new_write(); return value
        with mock.patch.object(self.current, 'view', side_effect=advanced):
            self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_operation_read_busy_and_malformed_responses_are_unconfirmed_not_missing(self):
        responses = [{'instance_id': self.current.instance_id, 'error':
            {'code': 'DATABASE_BUSY', 'message': 'busy', 'retryable': True}}, None,
            {'instance_id': self.current.instance_id, 'operation_id': 'wrong', 'recorded': False, 'status': 'unknown'}]
        for value in responses:
            with self.subTest(value=value), mock.patch.object(self.current, 'view', return_value=value):
                error = self.refused(self.lookup)
                if isinstance(value, dict) and 'error' in value:
                    self.assertEqual(error.code, 'DATABASE_BUSY'); self.assertTrue(error.retryable)
                else: self.assertEqual(error.code, 'LOOKUP_UNCONFIRMED')

    def test_runner_descriptor_close_failure_discards_result_and_keeps_retry_read_only(self):
        opened = io.opened
        @contextmanager
        def uncertain(*args, **kwargs):
            with opened(*args, **kwargs) as fd: yield fd
            raise OSError('lost close result after real close')
        before = self.snapshot()
        with mock.patch.object(io, 'opened', side_effect=uncertain):
            self.refused(self.lookup, 'LOOKUP_UNCONFIRMED')
        self.assertEqual(self.lookup()['receipt'], self.fx.receipt); self.assertEqual(self.snapshot(), before)

    def test_authority_close_failure_discards_result_after_real_cleanup(self):
        close = AuthorityFence.close
        def uncertain(fence): close(fence); raise OSError('lost fence close result')
        with mock.patch.object(AuthorityFence, 'close', uncertain): self.refused(self.lookup, 'LOOKUP_UNCONFIRMED')
        self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_unchanged_validators_still_refuse_old_source_and_original_old_epoch_command(self):
        with self.assertRaises(AuthorityError): Store(self.fx.db, self.fx.store.instance_id, expected_binding=self.fx.binding)
        before = self.snapshot(); result = self.current.command('fixture-owner', self.saved['command'])
        self.assertEqual(result['error']['code'], 'AUTHORITY_CHANGED'); self.assertFalse(result['recorded'])
        self.assertEqual(self.snapshot(), before); self.assertEqual(self.lookup()['receipt'], self.fx.receipt)

    def test_invalid_or_extra_saved_wrapper_fields_never_enter_the_operation_view(self):
        values = [None, dict(self.saved, replay=True), dict(self.saved, v=True),
                  dict(self.saved, command={'v': 1}), dict(self.saved, binding={})]
        for saved in values:
            with self.subTest(saved=saved), mock.patch.object(self.current, 'view', side_effect=AssertionError('bad read')):
                # None is passed directly; the convenience helper uses None as its default.
                self.refused(lambda: reader.lookup_relocated_operation(self.current, 'fixture-owner', saved, self.published))


if __name__ == '__main__': unittest.main()

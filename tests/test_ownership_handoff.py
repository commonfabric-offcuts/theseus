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
from types import SimpleNamespace

from aim_next import Store, destination_profiles as profiles, profile, recovery_io as io
from aim_next.authority import AuthorityError
import test_destination_profiles as fixture

AVAILABLE = importlib.util.find_spec('aim_next.ownership_handoff') is not None
if AVAILABLE: from aim_next import ownership_handoff as handoff
EVIDENCE = {'captures': [], 'observations': [], 'rejections': [], 'prohibited_acceptances': [], 'bounds': []}


class Availability(unittest.TestCase):
    def test_read_only_handoff_inventory_api_exists(self):
        self.assertTrue(AVAILABLE, '1330 capture/verify API is absent')


@unittest.skipUnless(AVAILABLE, '1330 absent; inventory behavior bodies/targets cannot enter')
class HandoffCase(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.ProfilesCase('test_real_publication_generates_exact_current_profiles_and_empty_fresh_outboxes')
        self.addCleanup(self.fixture.doCleanups); self.fixture.setUp()
        self.fx = self.fixture.case.fx; self.store = self.fixture.store
        self.staged = self.fixture.stage(); self.root = self.store.path.parent
        manifest = Path(self.staged['manifest_path']).read_text()
        self.request = dict(v=1, root=str(self.root), source_uid=os.getuid(), target_uid=os.getuid(),
            publication_receipt=self.fixture.receipt, profiles_request=self.fixture.request,
            profiles_result=self.staged, manifest_bytes=manifest,
            manifest_digest=hashlib.sha256(manifest.encode('utf-8')).hexdigest())

    def capture(self, request=None):
        result = handoff.capture_handoff_inventory(self.store, 'fixture-owner', self.request if request is None else request)
        EVIDENCE['captures'].append(dict(test=self.id(), digest=result['snapshot_digest'],
            source_uid=result['snapshot']['request']['source_uid'],
            target_uid=result['snapshot']['request']['target_uid'], entries=len(result['snapshot']['inventory'])))
        return result

    def verify(self, captured, actor='fixture-owner', digest=None):
        result = handoff.verify_handoff_inventory(self.store, actor, captured['snapshot'],
            captured['snapshot_digest'] if digest is None else digest)
        EVIDENCE['observations'].append(dict(test=self.id(), result=result))
        return result

    def refused(self, call, code=None):
        try: value = call()
        except io.RecoveryError as error:
            if code: self.assertEqual(error.code, code)
            EVIDENCE['rejections'].append(dict(test=self.id(), code=error.code)); return error
        EVIDENCE['prohibited_acceptances'].append(dict(test=self.id(), result=value))
        self.fail('prohibited ownership result actually returned')

    def bytes(self): return self.fx.bytes(self.fx.root)

    def anchor(self, record):
        path = self.store._authority.path; path.write_bytes(io.encode(record)); path.chmod(0o600)

    def new_file(self, name='private-extra', data=b'opaque bytes'):
        path = self.root/name; path.write_bytes(data); path.chmod(0o600); return path

    def new_write(self):
        command = self.fixture.case.command(self.fx, self.store.binding, 'new destination transaction')
        self.assertEqual(self.store.command('fixture-owner', command)['status'], 'committed')

    def test_same_uid_real_inventory_and_normal_profiles_are_read_without_mutation(self):
        before = self.bytes(); request = copy.deepcopy(self.request)
        captured = self.capture(); result = self.verify(captured)
        self.assertEqual(self.bytes(), before); self.assertEqual(self.request, request)
        self.assertEqual(result['status'], 'ownership_observed'); self.assertTrue(result['same_uid_control'])
        self.assertEqual((result['actual_uid'], result['actual_euid'], result['entry_uids']),
                         (os.getuid(), os.geteuid(), [os.getuid()]))
        self.assertEqual(result['original_pairs'], result['current_pairs'])
        self.assertEqual(result['actors'], ['fixture-owner'])
        expected = {''}|{str(path.relative_to(self.root)) for path in self.root.rglob('*')}
        self.assertEqual({entry['path'] for entry in captured['snapshot']['inventory']}, expected)
        self.assertEqual(result['entries_checked'], len(expected))

    def test_whole_target_uid_family_refuses_declared_other_uid_on_actual_current_uid(self):
        target = 501 if os.getuid() != 501 else 502
        request = dict(self.request, target_uid=target); captured = self.capture(request)
        before = self.bytes()
        self.refused(lambda: self.verify(captured), 'HANDOFF_TARGET_UID')
        self.assertEqual(self.bytes(), before)
        EVIDENCE['bounds'].append(dict(kind='actual wrong-target control', declared=target,
            actual_uid=os.getuid(), actual_euid=os.geteuid(), actual_entry_uids=[os.getuid()]))

    def test_capture_after_identical_db_replacement_and_current_repin_rejects_original_manifest_pairs(self):
        original_pairs = json.loads(self.request['manifest_bytes'])['identities']
        before_hash = hashlib.sha256(self.store.path.read_bytes()).hexdigest()
        retained = self.fx.root/'retained-destination.sqlite'; self.store.path.rename(retained)
        shutil.copyfile(retained, self.store.path); self.store.path.chmod(0o600)
        record = io.read_record(self.store._authority.path)[0]; info = self.store.path.stat()
        record.update(db_device=info.st_dev, db_inode=info.st_ino); self.anchor(record)
        self.assertEqual(hashlib.sha256(self.store.path.read_bytes()).hexdigest(), before_hash)
        self.assertNotEqual(original_pairs['database'], [info.st_dev, info.st_ino])
        self.assertFalse(self.store.view('fixture-owner', 'capabilities', {}).get('error'))
        loaded = profile.load_profile(Path(self.staged['manifest_path']).parent/'fixture-owner.profile.json')
        self.assertEqual(loaded.binding, self.store.binding)
        # Capture is intentionally AFTER replacement: its inventory would otherwise match verification.
        try: captured = self.capture()
        except io.RecoveryError as error:
            self.assertEqual(error.code, 'HANDOFF_ORIGINAL_IDENTITY_CHANGED'); return
        result = self.verify(captured)
        EVIDENCE['prohibited_acceptances'].append(dict(test=self.id(), result=result,
            captured_after_repin=True, original_pairs=original_pairs, actual_db_pair=[info.st_dev, info.st_ino],
            identical_db_sha256=before_hash, normal_store_accepted=True))
        self.fail('repinned new DB actually accepted against retained original manifest')

    def test_external_snapshot_digest_cannot_be_replaced_by_a_changed_snapshot(self):
        captured = self.capture(); captured['snapshot']['request']['target_uid'] += 1
        self.refused(lambda: self.verify(captured), 'HANDOFF_SNAPSHOT_MISMATCH')

    def test_wrong_actor_cannot_use_another_actors_capture(self):
        self.refused(lambda: self.verify(self.capture(), actor='other'), 'HANDOFF_SNAPSHOT_MISMATCH')

    def test_internally_inconsistent_historical_uid_or_root_pair_is_not_a_capture(self):
        captured = self.capture()
        for kind in ('uid', 'root_pair'):
            with self.subTest(kind=kind):
                changed = copy.deepcopy(captured)
                if kind == 'uid': changed['snapshot']['inventory'][0]['uid'] += 1
                else: changed['snapshot']['root_identity'][1] += 1
                changed['snapshot_digest'] = io.digest_record(changed['snapshot'])
                self.refused(lambda: self.verify(changed), 'HANDOFF_INVALID_SNAPSHOT')

    def test_capture_requires_actual_source_real_and_effective_uid(self):
        request = dict(self.request, source_uid=os.getuid()+1)
        self.refused(lambda: self.capture(request), 'HANDOFF_SOURCE_UID')

    def test_newer_commits_before_capture_are_valid_but_a_write_after_capture_invalidates_stopped_window(self):
        self.new_write(); captured = self.capture(); self.verify(captured)
        self.assertNotEqual(captured['snapshot']['commit']['id'], self.fixture.receipt['observed_commit']['id'])
        self.new_write(); self.refused(lambda: self.verify(captured), 'HANDOFF_SNAPSHOT_CHANGED')

    def test_human_owner_stop_continue_plan_outbox_home_thread_and_request_bytes_stay_unchanged(self):
        operator = self.fx.operator
        control = operator/'control.json'; value = io.read_record(control)[0]
        value.update(choice='Continue', revision=19); control.write_bytes(io.encode(value))
        io.write_record(operator/'home-thread.json', dict(home='/historical/private/home',thread='opaque-thread',
            plan_revision=23, control_revision=19, requires_adoption=True))
        before = self.bytes(); captured = self.capture(); self.verify(captured)
        self.assertEqual(self.bytes(), before)
        with sqlite3.connect(str(self.store.path)) as db:
            self.assertEqual(db.execute('SELECT owner_id FROM workspaces WHERE id=?', ('private-work',)).fetchone(),
                             ('fixture-owner',))
        self.assertEqual(io.read_record(control)[0], value)

    def test_no_old_private_paths_mutation_publisher_or_replay_are_used(self):
        protected = [self.fx.db.parent, self.fx.anchor.parent, self.fixture.output().parent.parent/'retained old profiles',
                     self.fixture.case.root(), Path(self.fx.preparation['staging_root']), self.fx.intents]
        real_open = os.open
        def guarded(path, flags, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)):
                p = Path(os.fsdecode(path))
                self.assertFalse(any(p == old or old in p.parents for old in protected), str(p))
            self.assertFalse(flags & (os.O_CREAT|os.O_TRUNC|os.O_APPEND))
            return real_open(path, flags, *args, **kwargs)
        before = self.bytes()
        with mock.patch.object(os, 'open', side_effect=guarded), \
                mock.patch.object(os, 'chown', side_effect=AssertionError('ownership mutated')), \
                mock.patch.object(os, 'chmod', side_effect=AssertionError('mode mutated')), \
                mock.patch.object(Store, 'command', side_effect=AssertionError('command sent')), \
                mock.patch.object(profiles, 'stage_destination_profiles', side_effect=AssertionError('profile staged')), \
                mock.patch.object(fixture.fixture.cutover, 'relocation_readback', side_effect=AssertionError('old UID readback')), \
                mock.patch.object(io, 'full_flush', side_effect=AssertionError('read flushed')):
            self.verify(self.capture())
        self.assertEqual(self.bytes(), before)

    def test_private_executable_is_preserved_and_nonprivate_or_readonly_modes_refuse(self):
        path = self.new_file(); path.chmod(0o700)
        captured = self.capture(); self.verify(captured)
        self.assertEqual(next(e['mode'] for e in captured['snapshot']['inventory'] if e['path']==path.name), 0o700)
        for mode in (0o644, 0o400, 0o755):
            with self.subTest(mode=mode):
                path.chmod(mode); self.refused(self.capture, 'HANDOFF_UNSAFE_ENTRY')

    def test_symlink_hardlink_and_special_file_are_not_followed_or_ignored(self):
        path = self.root/'unexpected'
        os.symlink(self.fx.db, path)
        self.refused(self.capture, 'HANDOFF_UNSAFE_ENTRY'); path.unlink()
        regular = self.new_file('regular')
        os.link(regular, path)
        self.refused(self.capture, 'HANDOFF_UNSAFE_ENTRY'); path.unlink()
        os.mkfifo(path, 0o600); self.refused(self.capture, 'HANDOFF_UNSAFE_ENTRY')

    def test_added_removed_replaced_or_modified_private_entries_invalidate_inventory(self):
        path = self.new_file(); captured = self.capture(); extra = self.new_file('new-entry')
        self.refused(lambda: self.verify(captured), 'HANDOFF_SNAPSHOT_CHANGED'); extra.unlink()
        path.unlink(); self.refused(lambda: self.verify(captured), 'HANDOFF_SNAPSHOT_CHANGED')
        path.write_bytes(b'opaque bytes'); path.chmod(0o600)
        self.refused(lambda: self.verify(captured), 'HANDOFF_SNAPSHOT_CHANGED')

    def test_filename_aliases_are_refused_even_when_the_filesystem_allows_both(self):
        path = self.new_file('case-name')
        other = self.root/'CASE-NAME'
        if other.exists():
            # On a case-insensitive volume, use the actual names plus the alternate spelling at enumeration.
            scandir = os.scandir
            @contextmanager
            def alias(fd):
                with scandir(fd) as entries: values = list(entries)
                if any(entry.name == path.name for entry in values): values.append(SimpleNamespace(name=other.name))
                yield iter(values)
            with mock.patch.object(os, 'scandir', side_effect=alias): self.refused(self.capture, 'HANDOFF_ALIAS')
            EVIDENCE['bounds'].append(dict(kind='injected alias enumeration on case-insensitive filesystem',
                                          not_two_native_alias_files=True))
        else:
            other.write_bytes(b'other'); other.chmod(0o600)
            self.refused(self.capture, 'HANDOFF_ALIAS')

    def test_actual_full_entry_limit_is_complete_and_one_more_entry_is_held(self):
        initial = self.capture(); count = len(initial['snapshot']['inventory'])
        self.assertEqual(handoff.MAX_ENTRIES, 16384)
        for index in range(handoff.MAX_ENTRIES-count): (self.root/('bounded-%05d'%index)).touch(mode=0o600)
        at_limit = self.capture(); self.assertEqual(len(at_limit['snapshot']['inventory']), 16384)
        self.new_file('one-too-many'); self.refused(self.capture, 'HANDOFF_LIMIT')
        EVIDENCE['bounds'].append(dict(kind='real filesystem entry limit', accepted=16384, refused=16385))

    def test_actual_depth_limit_is_complete_and_one_more_level_is_held(self):
        path = self.root
        for _ in range(32): path = path/'d'; path.mkdir(mode=0o700)
        self.verify(self.capture()); (path/'too-deep').mkdir(mode=0o700)
        self.refused(self.capture, 'HANDOFF_LIMIT')

    def test_utf8_relative_path_and_total_encoded_input_limits_are_explicit(self):
        self.assertEqual((handoff.MAX_PATH_BYTES,handoff.MAX_BYTES), (4096,8*1024*1024))
        handoff._relative('x'*4096)
        self.refused(lambda: handoff._relative('x'*4097), 'HANDOFF_LIMIT')
        self.refused(lambda: handoff._relative('λ'*2049), 'HANDOFF_LIMIT')
        for value in ('../escape','/absolute','a//b','a/./b'):
            self.refused(lambda: handoff._relative(value), 'HANDOFF_LIMIT')
        oversized = dict(self.request, manifest_bytes='x'*(8*1024*1024))
        self.refused(lambda: self.capture(oversized), 'HANDOFF_LIMIT')

    def test_device_escape_predicate_uses_actual_file_stat_and_declared_root_device(self):
        path = self.new_file(); info = path.stat()
        self.refused(lambda: handoff._info(info, path.name, info.st_dev+1), 'HANDOFF_UNSAFE_ENTRY')
        EVIDENCE['bounds'].append(dict(kind='device predicate only; not a mounted-volume experiment',
                                      actual_device=info.st_dev, mismatched_root_device=info.st_dev+1))

    def test_changed_enumeration_during_walk_is_not_a_partial_success(self):
        names = handoff._names; changed = []
        def race(fd, remaining):
            value = names(fd, remaining)
            if not changed: changed.append(True); self.new_file('raced-name')
            return value
        with mock.patch.object(handoff, '_names', side_effect=race): self.refused(self.capture, 'HANDOFF_CHANGED')

    def test_file_change_between_complete_walks_is_detected(self):
        path = self.new_file(); walk = handoff._walk; changed = []
        def race(*args):
            value = walk(*args)
            if not changed:
                changed.append(True); path.write_bytes(b'changed bytes'); path.chmod(0o600)
            return value
        with mock.patch.object(handoff, '_walk', side_effect=race): self.refused(self.capture, 'HANDOFF_CHANGED')

    def test_actual_transaction_between_walks_is_detected_as_stopped_window_change(self):
        walk = handoff._walk; changed = []
        def race(*args):
            value = walk(*args)
            if not changed: changed.append(True); self.new_write()
            return value
        with mock.patch.object(handoff, '_walk', side_effect=race): self.refused(self.capture, 'HANDOFF_CHANGED')

    def test_named_root_replacement_discards_held_old_directory_observation(self):
        walk = handoff._walk; changed = []
        def race(*args):
            value = walk(*args)
            if not changed:
                changed.append(True); self.root.rename(self.root.with_name('held-old-root')); self.root.mkdir(mode=0o700)
            return value
        with mock.patch.object(handoff, '_walk', side_effect=race): self.refused(self.capture)

    def test_profiles_manifest_result_or_receipt_uncertainty_is_not_confirmed_by_reading(self):
        variants=[]
        for field in ('profiles_result','publication_receipt'):
            request=copy.deepcopy(self.request); request[field]['durability_confirmed']=False; variants.append(request)
        request=copy.deepcopy(self.request);request['manifest_digest']='f'*64;variants.append(request)
        request=copy.deepcopy(self.request);request['profiles_result']['manifest_path']+='-other';variants.append(request)
        for request in variants:
            with self.subTest(request=request['manifest_digest']): self.refused(lambda:self.capture(request))

    def test_snapshot_control_fields_and_sorted_complete_entry_shape_are_not_inferred(self):
        captured=self.capture()
        for kind in ('extra','inventory','ordering'):
            with self.subTest(kind=kind):
                changed=copy.deepcopy(captured)
                if kind=='extra':changed['snapshot']['unknown']=True
                elif kind=='inventory':changed['snapshot']['inventory'][0]['extra']=1
                else:changed['snapshot']['inventory'].reverse()
                changed['snapshot_digest']=io.digest_record(changed['snapshot'])
                self.refused(lambda:self.verify(changed))

    def test_disabled_actor_does_not_pass_normal_acceptance(self):
        captured=self.capture()
        with sqlite3.connect(str(self.store.path)) as db:db.execute('UPDATE actors SET enabled=0 WHERE id=?',('fixture-owner',))
        self.refused(lambda:self.verify(captured))

    def test_changed_current_profile_bytes_and_binding_are_not_adopted(self):
        captured=self.capture();path=Path(self.staged['manifest_path']).parent/'fixture-owner.profile.json'
        value=json.loads(path.read_text());value['authority_epoch']='other-epoch';path.write_text(json.dumps(value))
        self.refused(lambda:self.verify(captured))

    def test_current_stable_lock_replacement_refuses_without_repinning_or_repair(self):
        for suffix in ('.lock','.runner.lock'):
            with self.subTest(suffix=suffix):
                path=Path(str(self.store._authority.path)+suffix);retained=path.with_name(path.name+'.old')
                path.rename(retained);path.touch(mode=0o600)
                try:self.refused(self.capture)
                finally:path.unlink();retained.rename(path)

    def test_exclusive_authority_busy_is_retryable_and_not_readiness(self):
        fd=os.open(str(self.store._authority.path)+'.lock',os.O_RDONLY)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            error=self.refused(self.capture,'AUTHORITY_BUSY');self.assertTrue(error.retryable)
        finally:os.close(fd)

    def test_retired_source_and_old_epoch_command_still_refuse_under_unchanged_validators(self):
        with self.assertRaises(AuthorityError):Store(self.fx.db,self.store.instance_id,expected_binding=self.fx.binding)
        old=dict(v=1,instance_id=self.store.instance_id,operation_id='old-epoch-never-send',kind='workspace.create',
            target={},expected={'authority':{k:self.fx.binding[k] for k in ('authority_id','authority_epoch')}},
            args={'id':'must-not-exist','title':'old captured authority'})
        before=self.bytes();result=self.store.command('fixture-owner',old)
        self.assertEqual(result['error']['code'],'AUTHORITY_CHANGED');self.assertFalse(result['recorded'])
        self.assertEqual(self.bytes(),before);self.verify(self.capture())

    def test_lost_descriptor_close_after_real_cleanup_is_unconfirmed_and_retry_is_read_only(self):
        opened=io.opened
        @contextmanager
        def uncertain(*args,**kwargs):
            with opened(*args,**kwargs) as fd:yield fd
            raise OSError('lost close result after actual close')
        before=self.bytes()
        with mock.patch.object(io,'opened',side_effect=uncertain):self.refused(self.capture)
        self.verify(self.capture());self.assertEqual(self.bytes(),before)


if __name__ == '__main__':unittest.main()

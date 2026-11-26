from __future__ import annotations

import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from aim_next import Store, profile, recovery_io as io, hosted_notice
from aim_next.authority import AuthorityError
import test_authority_cutover as fixture

AVAILABLE = importlib.util.find_spec('aim_next.destination_profiles') is not None
if AVAILABLE: from aim_next import destination_profiles as staging
EVIDENCE = {'published': [], 'staged': [], 'prohibited_stages': [], 'shell': [], 'flush_faults': []}


class Availability(unittest.TestCase):
    def test_destination_profile_api_exists(self):
        self.assertTrue(AVAILABLE, '1327 dormant profile staging API is absent')


@unittest.skipUnless(AVAILABLE, '1327 absent; behavior bodies and targets are unreached')
class ProfilesCase(unittest.TestCase):
    def new_case(self, label='A'):
        real = tempfile.TemporaryDirectory
        def temporary(*args, **kwargs):
            kwargs['prefix'] = "1327 root "+label+" λ's $(printf expanded) `echo no`; [x]-"
            return real(*args, **kwargs)
        case = fixture.CutoverCase('test_readback_is_read_only_and_never_confirms_observation')
        self.addCleanup(case.doCleanups)
        with mock.patch.object(tempfile, 'TemporaryDirectory', side_effect=temporary): case.setUp()
        fx = case.fx
        old = fx.root/'retained old profiles'; old.mkdir(mode=0o700)
        path = old/'original.profile.json'
        profile.write_profile(path, fx.db, fx.store.instance_id, 'fixture-owner', binding=fx.binding)
        outbox = old/'fixture-owner.outbox'; outbox.mkdir(mode=0o700)
        saved = '{"original":"exact opaque request, never replay","operation_id":"original-lost-response"}\n'
        (outbox/'saved.json').write_text(saved); (outbox/'saved.json').chmod(0o600)
        receipt = fixture.cutover.publish_relocation(case.request)
        binding = receipt['binding']; store = Store(binding['db_path'], binding['instance_id'],
            expected_binding={k: binding[k] for k in profile.BINDING_FIELDS})
        request = dict(v=1, destination_root=str(fx.targets()[0].parent),
            output_dir=str(fx.targets()[0].parent/"new profiles λ's $() `no`; [x]"),
            publication_digest=io.digest_record(receipt), profiles=[dict(source_path=str(path),
                source_bytes=path.read_text(), outbox_parent=str(old))])
        EVIDENCE['published'].append({'root':str(fx.root),'move_id':receipt['move_id'],'confirmed':receipt['durability_confirmed']})
        return case, store, receipt, request

    def setUp(self):
        self.case, self.store, self.receipt, self.request = self.new_case()
        self.root = self.case.fx.root

    def output(self, request=None): return Path((request or self.request)['output_dir'])

    def stage(self, receipt=None, request=None):
        result = staging.stage_destination_profiles(self.store, receipt or self.receipt, request or self.request)
        EVIDENCE['staged'].append({'test':self.id(),'result':result})
        return result

    def rejected(self, receipt=None, request=None, code=None):
        request = request or self.request
        try:
            result = self.stage(receipt, request)
        except (io.RecoveryError, AuthorityError, profile.ProfileError) as error:
            if code: self.assertEqual(error.code, code)
            return error
        EVIDENCE['prohibited_stages'].append({'test':self.id(),'result':result,'output_exists':self.output(request).exists()})
        self.fail('prohibited request actually staged output: '+result['status'])

    def altered_receipt(self, **values):
        receipt = dict(self.receipt, **values)
        return receipt, dict(self.request, publication_digest=io.digest_record(receipt))

    def preserved(self):
        names = ['original','control','operator','retained old profiles']
        return {name:self.case.fx.bytes(self.root/name) for name in names}, self.store.path.read_bytes()

    def test_real_publication_generates_exact_current_profiles_and_empty_fresh_outboxes(self):
        before = self.preserved(); request = copy.deepcopy(self.request); receipt = copy.deepcopy(self.receipt)
        result = self.stage()
        self.assertEqual(result['status'], 'profiles_staged'); self.assertTrue(result['durability_confirmed'])
        entry = result['profiles'][0]; path = self.output()/entry['profile']
        current = profile.load_profile(path)
        self.assertEqual(current.actor_id, 'fixture-owner'); self.assertEqual(current.binding, self.store.binding)
        self.assertEqual(current.db_path, self.store.path)
        self.assertEqual(path.read_bytes(), profile.profile_bytes(self.store.path, self.store.instance_id,
            'fixture-owner', {k:self.store.binding[k] for k in ('authority_path','authority_id','authority_epoch')}))
        self.assertEqual(list((self.output()/entry['outbox']).iterdir()), [])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.output()/entry['outbox']).stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.preserved(), before); self.assertEqual(self.request, request); self.assertEqual(self.receipt, receipt)
        with self.assertRaises(AuthorityError):
            Store(self.case.fx.db, self.store.instance_id, expected_binding=self.case.fx.binding)

    def test_unconfirmed_receipt_cannot_stage_even_with_valid_current_binding_and_lineage(self):
        receipt, request = self.altered_receipt(durability_confirmed=False)
        self.rejected(receipt, request, 'PROFILES_NOT_CONFIRMED'); self.assertFalse(self.output().exists())

    def test_foreign_move_receipt_cannot_stage_even_with_valid_current_binding_and_confirmation(self):
        receipt, request = self.altered_receipt(move_id='foreign-move')
        self.rejected(receipt, request, 'PROFILES_LINEAGE_MISMATCH'); self.assertFalse(self.output().exists())

    def test_each_receipt_reference_and_both_historical_commit_fields_are_bound(self):
        variants = [dict(status='published_observed'), dict(request_digest='0'*64), dict(journal_path='/not/the/journal'),
            dict(binding=dict(self.receipt['binding'], authority_epoch='foreign-epoch'))]
        for field, value in [('commit_seq',str(int(self.receipt['cutover_commit']['commit_seq'])+1)), ('commit_id','foreign-commit')]:
            variants.append(dict(cutover_commit=dict(self.receipt['cutover_commit'], **{field:value})))
        for change in variants:
            with self.subTest(change=change):
                receipt, request = self.altered_receipt(**change); self.rejected(receipt, request)
                self.assertFalse(self.output().exists())

    def test_receipt_digest_mismatch_is_not_confirmation(self):
        self.rejected(request=dict(self.request, publication_digest='0'*64), code='PROFILES_RECEIPT_MISMATCH')
        self.assertFalse(self.output().exists())

    def test_predecessor_profile_fields_and_enabled_actor_are_checked(self):
        original = json.loads(self.request['profiles'][0]['source_bytes'])
        for field in ('instance_id','db_path','authority_path','authority_id','authority_epoch','actor_id'):
            value = dict(original, **{field:'/foreign/path' if field.endswith('path') else 'absent-actor'})
            request = copy.deepcopy(self.request); request['profiles'][0]['source_bytes'] = json.dumps(value)
            with self.subTest(field=field):
                self.rejected(request=request); self.assertFalse(self.output().exists())

    def test_disabled_actor_is_refused_without_creating_profiles(self):
        with sqlite3.connect(str(self.store.path)) as db: db.execute("UPDATE actors SET enabled=0 WHERE id='fixture-owner'")
        self.rejected(code='PROFILES_ACTOR_UNAVAILABLE'); self.assertFalse(self.output().exists())

    def test_new_destination_writes_preserve_historical_lineage(self):
        result = self.store.command('fixture-owner', self.case.command(self.case.fx, self.store.binding, 'new destination write'))
        self.assertEqual(result['status'], 'committed')
        before = self.store.path.read_bytes(); self.stage(); self.assertEqual(self.store.path.read_bytes(), before)

    def test_old_private_paths_and_cutover_retry_are_never_opened(self):
        # Those private paths are gone; supplied snapshots and current lineage suffice.
        for name in ('original','control','operator','retained old profiles','cutovers','intents','stage journal λ apostrophe\'s'):
            path = self.root/name
            if path.exists(): path.rename(self.root/('retained-'+name))
        with mock.patch.object(fixture.cutover, 'publish_relocation', side_effect=AssertionError('old retry')), \
             mock.patch.object(fixture.cutover, 'relocation_readback', side_effect=AssertionError('old readback')):
            self.assertEqual(self.stage()['status'], 'profiles_staged')

    def test_two_unrelated_roots_execute_rendered_configured_cli_with_exact_argv_and_binding(self):
        cases = [(self.case,self.store,self.receipt,self.request), self.new_case('B')]
        repo = Path(__file__).resolve().parents[1]
        for case, store, receipt, request in cases:
            with self.subTest(root=str(case.fx.root)):
                result = staging.stage_destination_profiles(store, receipt, request)
                selected = Path(request['output_dir'])/result['profiles'][0]['profile']
                cli = case.fx.root/"configured cli λ's $(printf bad) `echo bad`; [x]"
                log = case.fx.root/'argv.json'
                cli.write_text('import json,sys\nfrom pathlib import Path\nPath('+repr(str(log))+').write_text(json.dumps(sys.argv[1:]))\n'
                    +'sys.path.insert(0,'+repr(str(repo))+')\nfrom aim_next.cli import main\nraise SystemExit(main())\n')
                command = hosted_notice.cli_command(cli, selected)+' binding'
                child = subprocess.run(['/bin/sh','-c',command], capture_output=True, timeout=15)
                self.assertEqual(child.returncode, 0, child.stderr.decode())
                self.assertEqual(json.loads(log.read_text()), ['--profile',str(selected),'binding'])
                expected = {k:v for k,v in receipt['binding'].items() if k != 'authority_path'}
                self.assertEqual(json.loads(child.stdout)['binding'], dict(expected, actor_id='fixture-owner'))
                self.assertEqual(json.loads(selected.read_text())['authority_path'], receipt['binding']['authority_path'])
                EVIDENCE['shell'].append({'root':str(case.fx.root),'argv':json.loads(log.read_text()),'exit':child.returncode})

    def test_existing_complete_or_partial_output_is_held_without_repair(self):
        self.output().mkdir(mode=0o700); (self.output()/'sentinel').write_bytes(b'existing exact bytes')
        before = self.case.fx.bytes(self.output())
        self.rejected(code='PROFILES_OUTPUT_OCCUPIED'); self.assertEqual(self.case.fx.bytes(self.output()), before)
        self.assertEqual(staging.inspect_destination_profiles(self.request)['status'], 'profiles_incomplete')

    def test_completed_output_is_not_a_retry_target(self):
        self.stage(); before = self.case.fx.bytes(self.output())
        self.rejected(code='PROFILES_OUTPUT_OCCUPIED'); self.assertEqual(self.case.fx.bytes(self.output()), before)

    def test_inspection_is_read_only_observation_and_never_confirms(self):
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('inspection flushed')):
            self.assertEqual(staging.inspect_destination_profiles(self.request)['status'], 'not_started')
        self.stage(); before = self.preserved(), self.case.fx.bytes(self.output())
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('inspection flushed')):
            result = staging.inspect_destination_profiles(self.request)
        self.assertEqual(result['status'], 'profiles_observed'); self.assertFalse(result['durability_confirmed'])
        self.assertEqual(before, (self.preserved(),self.case.fx.bytes(self.output())))

    def test_fresh_python_processes_inspect_identical_bytes_with_independent_hash_seeds(self):
        self.stage()
        script = 'import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom aim_next.destination_profiles import inspect_destination_profiles\nprint(json.dumps(inspect_destination_profiles(json.load(sys.stdin))))\n'
        repo = str(Path(__file__).resolve().parents[1])
        for index in range(2):
            child = subprocess.run([sys.executable,'-I','-B','-X','pycache_prefix='+str(self.root/('inspect-cache-'+str(index))),
                '-c',script,repo],input=json.dumps(self.request).encode(),capture_output=True,timeout=15)
            self.assertEqual(child.returncode,0,child.stderr.decode())
            observed=json.loads(child.stdout);self.assertEqual(observed['status'],'profiles_observed')
            self.assertFalse(observed['durability_confirmed'])

    def test_inspection_refuses_changed_profile_extra_file_and_nonempty_outbox(self):
        result = self.stage(); entry = result['profiles'][0]
        path = self.output()/entry['profile']; raw = path.read_bytes(); path.write_bytes(raw+b' ')
        with self.assertRaises(io.RecoveryError): staging.inspect_destination_profiles(self.request)
        path.write_bytes(raw)
        extra = self.output()/'extra'; extra.write_bytes(b'x')
        with self.assertRaises(io.RecoveryError): staging.inspect_destination_profiles(self.request)
        extra.unlink(); extra = self.output()/entry['outbox']/'pending'; extra.write_bytes(b'x')
        with self.assertRaises(io.RecoveryError): staging.inspect_destination_profiles(self.request)

    def test_invalid_shapes_duplicates_unsafe_components_and_overlaps_make_no_output(self):
        values = [dict(self.request,v=True),dict(self.request,unexpected=True),dict(self.request,profiles=[]),
            dict(self.request,profiles=self.request['profiles']*2),dict(self.request,output_dir=self.request['destination_root']),
            dict(self.request,output_dir=str(self.root/'retained old profiles'/'new'))]
        entry = self.request['profiles'][0]
        for raw in ('{"v":2,"v":2}', json.dumps(dict(json.loads(entry['source_bytes']),actor_id='../escape'))):
            values.append(dict(self.request,profiles=[dict(entry,source_bytes=raw)]))
        for request in values:
            with self.subTest(request=request):
                self.rejected(request=request); self.assertFalse(self.output().exists())

    def test_alias_and_nonprivate_destination_root_are_refused(self):
        root = Path(self.request['destination_root']); alias = self.root/'alias'; alias.symlink_to(root)
        self.rejected(request=dict(self.request,destination_root=str(alias),output_dir=str(alias/'new')))
        root.chmod(0o755)
        try: self.rejected()
        finally: root.chmod(0o700)
        self.assertFalse(self.output().exists())

    def test_replaced_database_and_both_lock_identities_are_refused(self):
        for path in (self.store.path,Path(str(self.store._authority.path)+'.lock'),Path(str(self.store._authority.path)+'.runner.lock')):
            with self.subTest(path=str(path)):
                saved = Path(str(path)+'.held'); path.rename(saved); path.write_bytes(saved.read_bytes()); path.chmod(0o600)
                try: self.rejected(); self.assertFalse(self.output().exists())
                finally: path.unlink(); saved.rename(path)

    def test_busy_authority_is_refused_before_output(self):
        fd = os.open(str(self.store._authority.path)+'.lock',os.O_RDWR)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.rejected(code='AUTHORITY_BUSY'); self.assertFalse(self.output().exists())
        finally: os.close(fd)

    def test_authority_change_during_generation_prevents_manifest_confirmation(self):
        real = profile.write_profile
        def change(*args,**kwargs):
            result = real(*args,**kwargs)
            path = self.store._authority.path; record,_ = io.read_record(path); record['epoch']='changed-during-staging'
            path.write_bytes(io.encode(record)); return result
        with mock.patch.object(profile,'write_profile',side_effect=change): self.rejected()
        self.assertTrue(self.output().exists()); self.assertFalse((self.output()/'manifest.json').exists())

    def test_write_failure_retains_partial_folder_without_manifest_or_repair(self):
        with mock.patch.object(profile,'write_profile',side_effect=OSError('injected write uncertainty')):
            self.rejected(code='PROFILES_UNCONFIRMED')
        self.assertTrue(self.output().exists()); self.assertFalse((self.output()/'manifest.json').exists())
        self.rejected(code='PROFILES_OUTPUT_OCCUPIED')

    def test_every_staging_full_flush_failure_is_retained_and_never_confirmed(self):
        real = io.full_flush; seen = []
        def observe(fd): seen.append(io.facts(os.fstat(fd))); return real(fd)
        with mock.patch.object(io,'full_flush',side_effect=observe): self.stage()
        for index in range(len(seen)):
            request = dict(self.request,output_dir=str(Path(self.request['destination_root'])/('flush-fault-'+str(index))))
            calls = []
            def fail(fd):
                calls.append(io.facts(os.fstat(fd)))
                if len(calls) == index+1: raise OSError('injected full-flush uncertainty')
                return real(fd)
            with self.subTest(index=index),mock.patch.object(io,'full_flush',side_effect=fail):
                self.rejected(request=request)
            self.assertEqual(len(calls),index+1)
            EVIDENCE['flush_faults'].append({'index':index,'reached':len(calls),'output_exists':self.output(request).exists()})

    def test_close_lost_result_is_unconfirmed_even_when_complete_artifacts_are_observable(self):
        real = os.close; hit = []
        root_identity = io.identity(Path(self.request['destination_root']).stat())
        def fail(fd):
            same = io.identity(os.fstat(fd)) == root_identity
            real(fd)
            if same and not hit:
                hit.append(True); raise OSError('injected lost close response')
        with mock.patch.object(os,'close',side_effect=fail): self.rejected()
        self.assertEqual(hit,[True]); observed = staging.inspect_destination_profiles(self.request)
        self.assertEqual(observed['status'],'profiles_observed'); self.assertFalse(observed['durability_confirmed'])


if __name__ == '__main__': unittest.main()

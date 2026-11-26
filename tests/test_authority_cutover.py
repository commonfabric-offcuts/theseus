from __future__ import annotations

import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import unittest
from unittest import mock
import uuid

from aim_next import Store, recovery_io as io, relocation_stage as stage
from aim_next.authority import AuthorityError
import test_authority_relocation_stage as fixture

AVAILABLE = importlib.util.find_spec('aim_next.relocation_cutover') is not None
if AVAILABLE: from aim_next import relocation_cutover as cutover
EVIDENCE = {'flush_boundaries': [], 'children': [], 'concurrency': []}

CHILD = r'''
import json,os,sys
sys.path.insert(0,sys.argv[1])
from aim_next import relocation_cutover as c, recovery_io as io
request=json.load(open(sys.argv[2]));mode=sys.argv[3]
print(json.dumps({'pid':os.getpid(),'origin':c.__file__,'mode':mode,'entered':True}),flush=True)
if mode=='compete': sys.stdin.readline()
if mode in ('retire','install'):
    name='_retire' if mode=='retire' else '_install';real=getattr(c,name)
    def crash(*args):
        real(*args);print(json.dumps({'crash_after':mode}),flush=True);os._exit(91 if mode=='retire' else 92)
    setattr(c,name,crash)
if mode=='alias':
    real=os.unlink;move=request['stage_request']['intent_request']['preparation']['move_id']
    def crash(path,*args,**kwargs):
        if str(path).endswith('.publish-'+move):
            print(json.dumps({'crash_before_alias_unlink':True}),flush=True);os._exit(93)
        return real(path,*args,**kwargs)
    os.unlink=crash
try:
    result=c.publish_relocation(request);print(json.dumps({'result':result}),flush=True)
except io.RecoveryError as error:
    print(json.dumps({'error':error.code,'retryable':error.retryable}),flush=True);sys.exit(4)
'''


class Availability(unittest.TestCase):
    def test_same_owner_cutover_api_exists(self):
        self.assertTrue(AVAILABLE, '1326 retirement/publication API is absent')


@unittest.skipUnless(AVAILABLE, '1326 absent; behavior bodies/targets cannot enter')
class CutoverCase(unittest.TestCase):
    def setUp(self):
        self.fx, self.request, self.staged = self.new_case()

    def new_case(self):
        fx = fixture.StageCase('test_reachable_stage_preserves_records_media_and_three_actual_identities')
        self.addCleanup(fx.doCleanups); fx.setUp()
        result = stage.stage_relocation(fx.request)
        journal = fx.root/'cutovers'; journal.mkdir(mode=0o700)
        return fx, dict(v=1, stage_request=fx.request, stage_digest=io.digest_record(result['stage']),
                        journal_root=str(journal)), result

    def root(self, request=None):
        request = request or self.request
        return Path(request['journal_root'])/request['stage_request']['intent_request']['preparation']['move_id']

    def refused(self, call, code=None):
        with self.assertRaises(io.RecoveryError) as caught: call()
        if code: self.assertEqual(caught.exception.code, code)
        return caught.exception

    def binding(self, fx, staged):
        return dict(fx.binding, authority_path=str(fx.targets()[1]), authority_epoch=staged['stage']['epoch'])

    def command(self, fx, binding, title):
        ident = uuid.uuid4().hex
        return dict(v=1, instance_id=fx.store.instance_id, operation_id='oracle-'+ident, kind='workspace.create', target={},
                    expected={'authority': {k: binding[k] for k in ('authority_id', 'authority_epoch')}},
                    args={'id': 'oracle-'+ident, 'title': title})

    def writers(self, fx, staged):
        flags = []
        for source in (True, False):
            binding = fx.binding if source else self.binding(fx, staged)
            try:
                store = fx.store if source else Store(fx.targets()[0], fx.store.instance_id, expected_binding=binding)
                outcome = store.command('fixture-owner', self.command(fx, binding, 'real writer oracle'))
                flags.append(outcome['status'] == 'committed')
            except AuthorityError: flags.append(False)
        self.assertLessEqual(sum(flags), 1, 'both old and new writers succeeded')
        return flags

    def start_child(self, fx, request, mode):
        tag = uuid.uuid4().hex; path = fx.root/('request-'+tag+'.json'); io.write_record(path, request)
        prefix = str(Path(sys.pycache_prefix or fx.root)/('child-'+tag))
        argv = ['/usr/bin/python3', '-I', '-X', 'pycache_prefix='+prefix, '-c', CHILD,
                str(Path(cutover.__file__).parent.parent), str(path), mode]
        child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, close_fds=False)
        def cleanup():
            if child.poll() is None:
                if child.stdin: child.stdin.close(); child.stdin = None
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.terminate(); child.wait(timeout=5)
        self.addCleanup(cleanup)
        first = child.stdout.readline(); manifest = json.loads(first)
        self.assertEqual(manifest['origin'], cutover.__file__)
        return child, first, argv

    def finish_child(self, child, first, argv):
        stdout, stderr = child.communicate(timeout=15)
        record = dict(pid=child.pid, argv=argv, exit=child.returncode, stdout=first+stdout, stderr=stderr, reaped=True)
        EVIDENCE['children'].append(record)
        return record

    def test_reachable_cutover_preserves_data_and_unchanged_validators_fence_the_source(self):
        fx = self.fx; before_db = fx.db.read_bytes(); before_target = fx.targets()[0].read_bytes()
        before = {name: fx.bytes(fx.root/name) for name in ('bundle', 'staging', 'intents', 'operator')}
        pairs = {suffix: io.identity(Path(str(fx.anchor)+suffix).stat()) for suffix in ('.lock', '.runner.lock')}
        request_before = copy.deepcopy(self.request)
        result = cutover.publish_relocation(self.request)
        self.assertEqual(result['status'], 'published'); self.assertTrue(result['durability_confirmed'])
        self.assertEqual(self.request, request_before)
        self.assertEqual(fx.db.read_bytes(), before_db); self.assertEqual(fx.targets()[0].read_bytes(), before_target)
        self.assertEqual(before, {name: fx.bytes(fx.root/name) for name in before})
        self.assertEqual(fx.tables(fx.db), fx.tables(fx.targets()[0]))
        self.assertEqual(io.read_record(fx.anchor)[0]['state'], 'retired')
        for suffix, pair in pairs.items(): self.assertEqual(io.identity(Path(str(fx.anchor)+suffix).stat()), pair)
        with self.assertRaises(AuthorityError): Store(fx.db, fx.store.instance_id, expected_binding=fx.binding)
        self.assertEqual(self.writers(fx, self.staged), [False, True])
        successor = Store(fx.targets()[0], fx.store.instance_id, expected_binding=self.binding(fx, self.staged))
        self.assertEqual(successor.view('fixture-owner', 'operation', {'operation_id': 'original-lost-response'}), fx.receipt)

    def test_readback_is_read_only_and_never_confirms_observation(self):
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            self.assertEqual(cutover.relocation_readback(self.request)['status'], 'not_started')
        cutover.publish_relocation(self.request); before = self.fx.bytes(self.fx.root)
        with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
            result = cutover.relocation_readback(self.request)
        self.assertEqual(result['status'], 'published_observed'); self.assertFalse(result['durability_confirmed'])
        self.assertNotIn('binding', result); self.assertEqual(self.fx.bytes(self.fx.root), before)

    def test_published_retry_permits_new_commits_and_needs_no_inactive_stage_or_original_db(self):
        first = cutover.publish_relocation(self.request)
        self.assertEqual(self.writers(self.fx, self.staged), [False, True])
        current = io.read_metadata(self.fx.targets()[0]); self.assertNotEqual(current['commit_id'], self.fx.preparation['commit']['id'])
        for name in ('original', 'bundle', 'staging', 'intents', self.fx.journals.name):
            (self.fx.root/name).rename(self.fx.root/('retained-'+name))
        with mock.patch.object(stage, '_completion', side_effect=AssertionError('active payload oracle')), \
             mock.patch.object(stage.uuid, 'uuid4', side_effect=AssertionError('new epoch')):
            result = cutover.publish_relocation(self.request)
        self.assertEqual(result['binding'], first['binding'])
        self.assertEqual(result['observed_commit'], dict(seq=current['commit_seq'], id=current['commit_id']))
        self.assertEqual(io.read_metadata(self.fx.targets()[0]), current)

    def test_published_retry_with_live_destination_runner_uses_shared_fences(self):
        cutover.publish_relocation(self.request)
        store = Store(self.fx.targets()[0], self.fx.store.instance_id, expected_binding=self.binding(self.fx, self.staged))
        with store.runner_guard('destination-fixture-runner'):
            self.assertTrue(cutover.publish_relocation(self.request)['durability_confirmed'])

    def test_unknown_and_known_incomplete_history_facts_remain_distinct(self):
        for history in (None, False):
            fx, base, _ = self.new_case()
            record, _ = io.read_record(fx.anchor)
            if history is None: record['recovery'].pop('history_complete')
            else: record['recovery']['history_complete'] = history
            fx.anchor.write_bytes(io.encode(record))
            request = fx.fresh_request(); staged = stage.stage_relocation(request)
            operation = dict(base, stage_request=request, stage_digest=io.digest_record(staged['stage']))
            with self.subTest(history=history):
                result = cutover.publish_relocation(operation)
                anchor = Path(result['binding']['authority_path']); active, _ = io.read_record(anchor)
                if history is None: self.assertNotIn('history_complete', active['recovery'])
                else: self.assertIs(active['recovery']['history_complete'], False)
                binding = {k: result['binding'][k] for k in ('authority_path', 'authority_id', 'authority_epoch')}
                current = Store(Path(result['binding']['db_path']), fx.store.instance_id, expected_binding=binding)
                with current._authority.shared() as fence:
                    self.assertEqual(current._authority.facts(fence.record)['continuity'],
                                     'unknown' if history is None else 'incomplete')

    def test_both_source_commit_fields_are_freshness_guards(self):
        for field, value in (('commit_seq', '999'), ('commit_id', 'f'*32)):
            fx, request, _ = self.new_case()
            with self.subTest(field=field):
                with sqlite3.connect(str(fx.db)) as db: db.execute('UPDATE metadata SET value=? WHERE key=?', (value, field))
                self.refused(lambda: cutover.publish_relocation(request), 'CUTOVER_COMMIT_CHANGED')
                self.assertEqual(io.read_record(fx.anchor)[0]['state'], 'active'); self.assertFalse(fx.targets()[1].exists())

    def test_source_write_after_stage_verification_is_rechecked_under_exclusive_fences(self):
        real = cutover._verify_stage
        def advance(*args):
            fixed = real(*args)
            self.assertEqual(self.fx.store.command('fixture-owner', self.command(self.fx, self.fx.binding, 'new history'))['status'], 'committed')
            return fixed
        with mock.patch.object(cutover, '_verify_stage', side_effect=advance):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_COMMIT_CHANGED')
        self.assertEqual(io.read_record(self.fx.anchor)[0]['state'], 'active'); self.assertFalse(self.fx.targets()[1].exists())

    def test_destination_mutation_between_hash_verification_and_global_fences_refuses(self):
        real = cutover._verify_stage
        def change(*args):
            fixed = real(*args)
            with sqlite3.connect(str(self.fx.targets()[0])) as db:
                db.execute("UPDATE workspaces SET title='tampered stage'")
            return fixed
        with mock.patch.object(cutover, '_verify_stage', side_effect=change):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_STAGE_CHANGED')
        self.assertEqual(io.read_record(self.fx.anchor)[0]['state'], 'active')

    def test_source_db_and_each_source_or_destination_lock_substitution_refuse(self):
        for name in ('source_db', 'source_lock', 'source_runner', 'target_db', 'target_lock', 'target_runner'):
            fx, request, _ = self.new_case(); target = fx.targets()
            paths = dict(source_db=fx.db, source_lock=Path(str(fx.anchor)+'.lock'), source_runner=Path(str(fx.anchor)+'.runner.lock'),
                         target_db=target[0], target_lock=Path(str(target[1])+'.lock'), target_runner=Path(str(target[1])+'.runner.lock'))
            path = paths[name]; retained = path.with_name(path.name+'.retained'); path.rename(retained)
            shutil.copyfile(retained, path); path.chmod(0o600)
            with self.subTest(name=name):
                self.refused(lambda: cutover.publish_relocation(request))
                self.assertEqual(io.read_record(fx.anchor)[0]['state'], 'active'); self.assertFalse(target[1].exists())

    def test_source_anchor_path_or_epoch_substitution_refuses_before_retirement(self):
        for field, value in (('epoch', 'changed'), ('db_path', str(self.fx.root/'other.sqlite3'))):
            fx, request, _ = self.new_case(); record, _ = io.read_record(fx.anchor); record[field] = value
            fx.anchor.write_bytes(io.encode(record))
            self.refused(lambda: cutover.publish_relocation(request), 'CUTOVER_SOURCE_CHANGED')
            self.assertFalse(fx.targets()[1].exists())

    def test_real_inherited_runner_guard_outlives_its_parent_reference(self):
        script = "import json,os,sys;print(json.dumps([list((os.fstat(int(x)).st_dev,os.fstat(int(x)).st_ino)) for x in sys.argv[1:]]),flush=True);sys.stdin.readline()"
        with self.fx.store.runner_guard('source-fixture-runner') as guard:
            fds = guard.pass_fds
            argv = ['/usr/bin/python3', '-I', '-X', 'pycache_prefix='+str(Path(sys.pycache_prefix)/'guard-child'), '-c', script]+list(map(str, fds))
            child = subprocess.Popen(argv, pass_fds=fds, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            ready = ''
            def cleanup_guard():
                if child.poll() is None:
                    stdout, stderr = child.communicate('release\n', timeout=10)
                    EVIDENCE['children'].append(dict(pid=child.pid, argv=argv, exit=child.returncode,
                        stdout=ready+stdout, stderr=stderr, reaped=True, inherited_guard=True, early_cleanup=True))
            self.addCleanup(cleanup_guard)
            ready = child.stdout.readline(); self.assertEqual(len(json.loads(ready)), 2)
        try:
            error = self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_BUSY')
            self.assertTrue(error.retryable); self.assertEqual(io.read_record(self.fx.anchor)[0]['state'], 'active')
            self.assertIsNone(child.poll()); self.assertFalse(self.fx.targets()[1].exists())
        finally:
            stdout, stderr = child.communicate('release\n', timeout=10)
            EVIDENCE['children'].append(dict(pid=child.pid, argv=argv, exit=child.returncode, stdout=ready+stdout, stderr=stderr, reaped=True, inherited_guard=True))
        self.assertEqual(child.returncode, 0)
        self.assertEqual(cutover.publish_relocation(self.request)['status'], 'published')

    def test_two_real_competing_processes_cannot_publish_two_destinations(self):
        fx = self.fx; other_stage_request = fx.fresh_request(); other_staged = stage.stage_relocation(other_stage_request)
        other = dict(self.request, stage_request=other_stage_request, stage_digest=io.digest_record(other_staged['stage']))
        children = [self.start_child(fx, request, 'compete') for request in (self.request, other)]
        for child, _, _ in children: child.stdin.write('go\n'); child.stdin.flush(); child.stdin.close(); child.stdin = None
        results = [self.finish_child(*child) for child in children]
        self.assertTrue(all(r['exit'] in (0, 4) for r in results))
        requests = [self.request, other]
        if not any(r['exit'] == 0 for r in results):
            for request in requests:
                try: cutover.publish_relocation(request); break
                except io.RecoveryError as error: self.assertEqual(error.code, 'CUTOVER_BUSY')
        active = [Path(r['stage_request']['intent_request']['preparation']['destination']['authority_path']).exists() for r in requests]
        self.assertEqual(sum(active), 1)
        loser = requests[active.index(False)]; self.refused(lambda: cutover.publish_relocation(loser), 'CUTOVER_SOURCE_CHANGED')
        EVIDENCE['concurrency'].append(dict(pids=[x[0].pid for x in children], exits=[r['exit'] for r in results], active_destinations=active))

    def test_actual_process_exit_after_retirement_publication_and_link_alias_resumes_same_identity(self):
        for mode, code in [('retire', 91), ('install', 92), ('alias', 93)]:
            fx, request, staged = self.new_case(); child = self.start_child(fx, request, mode)
            report = self.finish_child(*child); self.assertEqual(report['exit'], code)
            with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
                observed = cutover.relocation_readback(request)
            self.assertFalse(observed['durability_confirmed']); self.assertNotIn('binding', observed)
            self.assertEqual(observed['status'], 'source_retired' if mode == 'retire' else 'published_observed')
            flags = self.writers(fx, staged); self.assertEqual(flags, [False, mode != 'retire'])
            result = cutover.publish_relocation(request); self.assertTrue(result['durability_confirmed'])
            if mode == 'alias': self.assertEqual(fx.targets()[1].stat().st_nlink, 1)
            self.assertEqual(result['binding']['authority_epoch'], staged['stage']['epoch'])

    def test_each_full_flush_failure_is_read_back_without_enabling_two_writers(self):
        real = io.full_flush; calls = []
        def count(fd): calls.append(1); return real(fd)
        with mock.patch.object(io, 'full_flush', side_effect=count): cutover.publish_relocation(self.request)
        total = len(calls); self.assertGreater(total, 15)
        for boundary in range(1, total+1):
            fx, request, staged = self.new_case(); entered = []
            def fail(fd):
                entered.append(1)
                if len(entered) == boundary: raise OSError('injected cutover flush %s'%boundary)
                return real(fd)
            with self.subTest(boundary=boundary):
                with mock.patch.object(io, 'full_flush', side_effect=fail): self.refused(lambda: cutover.publish_relocation(request))
                self.assertEqual(len(entered), boundary)
                with mock.patch.object(io, 'full_flush', side_effect=AssertionError('readback flushed')):
                    observed = cutover.relocation_readback(request)
                flags = self.writers(fx, staged)
                if not flags[0] and observed['status'] != 'cutover_incomplete':
                    result = cutover.publish_relocation(request); self.assertTrue(result['durability_confirmed'])
                EVIDENCE['flush_boundaries'].append(dict(boundary=boundary, total=total, actual_calls=len(entered),
                    observed_status=observed['status'], source_writer=flags[0], target_writer=flags[1]))

    def test_lost_source_rename_result_never_publishes_until_retirement_is_confirmed(self):
        real = cutover.os.replace
        def replace(*args): real(*args); raise OSError('source rename completed but return lost')
        with mock.patch.object(cutover.os, 'replace', side_effect=replace):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_UNCONFIRMED')
        self.assertEqual(cutover.relocation_readback(self.request)['status'], 'source_retired')
        self.assertFalse(self.fx.targets()[1].exists()); self.assertEqual(self.writers(self.fx, self.staged), [False, False])
        self.assertTrue(cutover.publish_relocation(self.request)['durability_confirmed'])

    def test_lost_destination_link_result_keeps_alias_and_confirms_without_republication(self):
        real = cutover.os.link
        def link(*args): real(*args); raise OSError('link completed but return lost')
        with mock.patch.object(cutover.os, 'link', side_effect=link):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_UNCONFIRMED')
        self.assertEqual(self.fx.targets()[1].stat().st_nlink, 2)
        self.assertEqual(cutover.relocation_readback(self.request)['status'], 'published_observed')
        self.assertEqual(self.writers(self.fx, self.staged), [False, True])
        with mock.patch.object(cutover.os, 'link', side_effect=AssertionError('republished')):
            self.assertTrue(cutover.publish_relocation(self.request)['durability_confirmed'])
        self.assertEqual(self.fx.targets()[1].stat().st_nlink, 1)

    def test_third_link_is_unknown_and_is_never_cleaned_or_treated_as_confirmation(self):
        child = self.start_child(self.fx, self.request, 'alias'); self.assertEqual(self.finish_child(*child)['exit'], 93)
        third = self.fx.targets()[1].with_name('foreign-link'); os.link(self.fx.targets()[1], third)
        for method in (cutover.publish_relocation, cutover.relocation_readback):
            self.refused(lambda: method(self.request), 'CUTOVER_DESTINATION_CHANGED')
        self.assertTrue(third.exists()); self.assertEqual(third.stat().st_nlink, 3)
        self.assertEqual(io.read_record(self.fx.anchor)[0]['state'], 'retired')

    def test_existing_partial_target_is_never_overwritten_even_at_the_link_boundary(self):
        real = cutover.os.link; target = self.fx.targets()[1]
        def collide(*args): target.write_bytes(b'foreign partial target'); target.chmod(0o600); return real(*args)
        with mock.patch.object(cutover.os, 'link', side_effect=collide):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_UNCONFIRMED')
        self.assertEqual(target.read_bytes(), b'foreign partial target')
        self.assertEqual(io.read_record(self.fx.anchor)[0]['state'], 'retired')
        self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_DESTINATION_CHANGED')
        self.assertEqual(target.read_bytes(), b'foreign partial target')

    def test_post_publication_close_uncertainty_releases_all_owned_fences(self):
        real = os.close; target_runner = Path(str(self.fx.targets()[1])+'.runner.lock')
        def close(fd):
            same = target_runner.exists() and io.identity(os.fstat(fd)) == io.identity(target_runner.stat())
            real(fd)
            if same and (self.root()/'published.json').exists(): raise OSError('closed but return lost')
        with mock.patch.object(cutover.os, 'close', side_effect=close):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_UNCONFIRMED')
        self.assertEqual(cutover.relocation_readback(self.request)['status'], 'published_observed')
        for anchor in (self.fx.anchor, self.fx.targets()[1]):
            for suffix in ('.lock', '.runner.lock'):
                with Path(str(anchor)+suffix).open('rb') as held: fcntl.flock(held.fileno(), fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.assertTrue(cutover.publish_relocation(self.request)['durability_confirmed'])

    def test_incomplete_initial_claim_is_retained_without_reconstruction(self):
        real = io.write_record
        def fail(path, value, *args):
            if Path(path) == self.root()/'claim.json': raise OSError('before initial claim')
            return real(path, value, *args)
        with mock.patch.object(io, 'write_record', side_effect=fail):
            self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_UNCONFIRMED')
        before = self.fx.bytes(self.root())
        self.assertEqual(cutover.relocation_readback(self.request)['status'], 'cutover_incomplete')
        self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_INCOMPLETE')
        self.assertEqual(self.fx.bytes(self.root()), before); self.assertFalse(self.fx.targets()[1].exists())

    def test_changed_input_same_identity_and_replaced_journal_refuse(self):
        cutover.publish_relocation(self.request); before = self.fx.bytes(self.root())
        changed = dict(self.request, stage_digest='0'*64)
        for method in (cutover.publish_relocation, cutover.relocation_readback):
            self.refused(lambda: method(changed), 'CUTOVER_REQUEST_MISMATCH')
        self.assertEqual(self.fx.bytes(self.root()), before)
        retained = self.root().with_name('retained-'+self.root().name); self.root().rename(retained); shutil.copytree(retained, self.root())
        self.refused(lambda: cutover.publish_relocation(self.request), 'CUTOVER_INVALID')

    def test_invalid_owner_alias_or_overlapping_journal_refuses_without_writes(self):
        alias = self.fx.root/'alias'; alias.symlink_to(Path(self.request['journal_root']), target_is_directory=True)
        for request in (dict(self.request, v=True), dict(self.request, journal_root='relative'),
                        dict(self.request, journal_root=str(alias)), dict(self.request, journal_root=str(self.fx.root))):
            self.refused(lambda: cutover.publish_relocation(request), 'INVALID_REQUEST')
        changed = copy.deepcopy(self.request)
        changed['stage_request']['intent_request']['preparation']['owners']['destination_uid'] += 1
        self.refused(lambda: cutover.publish_relocation(changed), 'OWNERSHIP_HANDOFF_REQUIRED')
        self.assertEqual(list(Path(self.request['journal_root']).iterdir()), [])


if __name__ == '__main__': unittest.main()

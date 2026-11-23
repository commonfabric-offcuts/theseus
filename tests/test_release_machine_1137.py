from __future__ import annotations

"""1137 boundaries, including ordinary unmet assertions for undelivered behavior.

No expectedFailure/skip converts absent recovery or reporting into green.
Run only the explicitly routed selectors; source preparation imports none of it.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest import mock

from tools import deploy, releases, release_check
from aim_next.store import SCHEMA_VERSION
import release_machine_1137_fixture as fixture


class Premerge1137(unittest.TestCase):
    def setUp(self):
        self.world = fixture.PremergeWorld(self)

    def test_open_pr_reaches_real_record_preparation_with_exact_approvals_and_audit(self):
        w = self.world
        with mock.patch.object(releases, 'prepare_record', wraps=releases.prepare_record) as prepare:
            answer = w.prepare()
        self.assertEqual(prepare.call_count, 1)
        self.assertTrue(answer['dry_run'])
        self.assertEqual(answer['premerge']['state'], 'open')
        self.assertFalse(answer['premerge']['merged'])
        self.assertEqual(answer['record']['commit'], w.candidate)
        self.assertEqual(answer['admission']['sources'][0]['freeze']['head_commit'], w.fixture.source)
        self.assertEqual(answer['admission']['sources'][0]['approval'], w.fixture.piece['approval'])
        row = dict(answer['record'], evidence=str(w.root/'evidence'))
        full = releases.verify_record(row, w.root/'evidence')
        self.assertEqual(full['train']['judgment'], w.fixture.value)
        self.assertEqual(full['train']['premerge'], answer['premerge'])
        self.assertEqual(row['measurements']['train']['judge_receipts_sha256']['audit'],
                         releases.digest(w.fixture.value['audit']))
        self.assertFalse(any('merge' in call or 'migrate' in call or 'record-release' in call for call in w.calls))

    def cli(self, folder):
        w = self.world
        args = ['rehearse', w.candidate, str(w.root/folder), '--config', str(w.root/'unused-config.json'),
                '--train', str(w.train), '--judgment', str(w.judgment), '--release', '2']
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(deploy, 'load_config', return_value=w.config), \
                mock.patch.object(deploy.train_check, 'GhCli', return_value=w.github), \
                mock.patch.object(deploy, 'run', w.run), redirect_stdout(out), redirect_stderr(err):
            code = deploy.main(args)
        (w.root/(folder+'-terminal.json')).write_text(json.dumps({
            'argv': args, 'direct_return': code, 'stdout': out.getvalue(), 'stderr': err.getvalue()}))
        return code, out.getvalue(), err.getvalue()

    def test_cli_success_allows_only_the_documented_stub_merge_continuation(self):
        continued = []
        code, out, err = self.cli('cli-ok')
        if code == 0:
            continued.append('isolated caller merge continuation')
        self.assertEqual((code, continued), (0, ['isolated caller merge continuation']), err)
        self.assertTrue(json.loads(out.splitlines()[-1])['dry_run'])
        # This checks the command/return boundary, not deployment of Warp's caller.

    def test_actual_serializer_refusal_prevents_cli_merge_continuation(self):
        original = releases.train_measurements
        def reserved(trained):
            measured = original(trained)
            measured['train']['judge_receipts_sha256'] = {'injected': 'reserved raw input'}
            return measured
        continued = []
        with mock.patch.object(releases, 'train_measurements', side_effect=reserved), \
                mock.patch.object(releases, 'prepare_record', wraps=releases.prepare_record) as prepare:
            code, _, err = self.cli('cli-serializer-refused')
            if code == 0:
                continued.append('merge')
        self.assertEqual(prepare.call_count, 1, 'reach actual preparation, not an earlier fixture refusal')
        self.assertEqual(code, 1)
        self.assertIn('judge receipt digest field is reserved', err)
        self.assertEqual(continued, [])
        self.assertTrue((self.world.root/'cli-serializer-refused/refused.json').is_file())

    def test_wrong_open_pr_bindings_and_substituted_judgment_refuse(self):
        w = self.world
        original = copy.deepcopy(w.github.pull)
        variants = [('state', 'closed'), ('merged', True), ('base', dict(original['base'], sha='0'*40)),
                    ('head', dict(original['head'], sha='0'*40)),
                    ('head', dict(original['head'], repo={'full_name': 'another/repo'}))]
        for index, (key, value) in enumerate(variants):
            w.github.pull = copy.deepcopy(original); w.github.pull[key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(deploy.Refused, 'OPEN unmerged'):
                w.prepare('wrong-pr-%d' % index)
        w.github.pull = original
        value = copy.deepcopy(w.fixture.value); value['carry']['created_at_ms'] += 1
        w.judgment.write_text(json.dumps(value))
        with self.assertRaisesRegex(deploy.Refused, 'judgment differs'):
            w.prepare('wrong-judgment')

    def test_normal_deploy_still_refuses_open_or_mismatched_merged_pr(self):
        w = self.world
        merged = subprocess.run(['git', '-C', str(w.fixture.repo), 'commit-tree', w.tree,
                                '-p', w.base, '-p', w.candidate], input='scratch merge\n\nPipeline: 1131\n',
                                capture_output=True, text=True)
        self.assertEqual(merged.returncode, 0, merged.stderr)
        candidate = merged.stdout.strip()
        train = json.loads(w.train.read_text()); train['merge_commit'] = candidate
        w.train.write_text(json.dumps(train)); w.github.contained = candidate
        for index, (merged_flag, merge_sha) in enumerate(((False, None), (True, '0'*40))):
            w.github.pull.update(merged=merged_flag, merge_commit_sha=merge_sha)
            with self.subTest(merged=merged_flag), mock.patch.object(deploy, 'run', w.run), \
                    mock.patch.object(deploy, 'processes', side_effect=AssertionError('auth must precede lifecycle')), \
                    self.assertRaisesRegex(deploy.Refused, 'merge commit'):
                deploy.deploy(w.config, candidate, w.root/('normal-%d' % index), None, True,
                              train=w.train, github=w.github, number=2)

    def test_missing_and_cancelled_verdict_do_not_veto_valid_deterministic_admission(self):
        f = self.world.fixture
        for conclusion in (None, 'cancelled'):
            f.value['verdicts'] = [] if conclusion is None else [
                {'run': 9, 'attempt': 1, 'check': 10, 'conclusion': conclusion,
                 'raw': f.raw({'conclusion': conclusion, 'head': f.head})}]
            f.bind_audit()
            with self.subTest(conclusion=conclusion):
                self.assertTrue(f.admit()['judged'])

    def test_new_deterministic_failure_blocks_its_change_but_not_unrelated_eligible_work(self):
        f = self.world.fixture
        f.value['node_comparison'] = f.node_pair(new_fail=True); f.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'):
            f.admit()
        f.write('notes.txt', 'unrelated ordinary source\n')
        unrelated = f.commit('ordinary\n\nPipeline: 1138', 1700000040)
        f.git('checkout', '-q', '--detach', f.base)
        self.assertFalse(deploy.admit(f.config, unrelated)['judged'])

    def test_existing_premerge_evidence_directory_is_not_reused_or_overwritten(self):
        w = self.world; folder = w.root/'occupied'; folder.mkdir()
        marker = folder/'keep.json'; marker.write_text('{"retained":true}')
        with self.assertRaisesRegex(deploy.Refused, 'exclusive evidence'):
            w.prepare('occupied')
        self.assertEqual(marker.read_text(), '{"retained":true}')

    def test_malformed_judgment_and_unavailable_inputs_retain_bytes_and_read_errors(self):
        w = self.world
        original_train = w.train.read_bytes()
        continued = []
        for index, raw in enumerate((b'{', b'{"duplicate":1,"duplicate":2}', b'\xff')):
            w.judgment.write_bytes(raw)
            folder = w.root/('malformed-%d' % index)
            with self.subTest(raw=raw), self.assertRaises(deploy.Refused):
                w.prepare(folder.name)
                continued.append('merge')
            self.assertEqual((folder/'train-input.json').read_bytes(), original_train)
            self.assertEqual((folder/'judgment-input.json').read_bytes(), raw)
            inputs = json.loads((folder/'00-inputs.json').read_text())
            self.assertEqual(inputs['judgment']['path'], str(w.judgment))
            self.assertEqual(inputs['judgment']['bytes'], len(raw))
            self.assertEqual(inputs['judgment']['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertTrue((folder/'refused.json').is_file(), 'keep refusal separately from raw inputs')
        for missing in ('train', 'judgment'):
            w.write_inputs()
            absent, retained = getattr(w, missing), getattr(w, 'judgment' if missing == 'train' else 'train')
            kept = retained.read_bytes(); absent.unlink()
            folder = w.root/('unavailable-'+missing)
            with self.subTest(missing=missing), self.assertRaisesRegex(deploy.Refused, 'input could not be read'):
                w.prepare(folder.name)
                continued.append('merge')
            inputs = json.loads((folder/'00-inputs.json').read_text())
            self.assertEqual(inputs[missing]['path'], str(absent))
            self.assertIsNone(inputs[missing]['captured'])
            self.assertEqual(inputs[missing]['read_error']['type'], 'FileNotFoundError')
            self.assertEqual((folder/(retained.stem+'-input.json')).read_bytes(), kept)
            self.assertTrue((folder/'refused.json').is_file())
        self.assertEqual(continued, [])
        self.assertEqual(w.calls, [], 'input refusals precede Git/Core/effect ports')

    def test_ordinary_open_pr_keeps_pending_judgment_without_invented_receipts(self):
        w = self.world; f = w.fixture
        f.write('ordinary.txt', 'eligible ordinary change\n')
        w.candidate = f.commit('ordinary\n\nPipeline: 1138', 1700000040)
        w.tree = f.git('rev-parse', w.candidate+'^{tree}').stdout.strip()
        f.git('checkout', '-q', '--detach', f.base)
        w.github = fixture.OpenPR(w)
        w.train.write_text(json.dumps({'pr': 1, 'merge_commit': w.candidate,
            'merged_tree': w.tree, 'kind': 'ordinary', 'items': [{'item': 1138,
                'approved_head': w.candidate, 'review': 'scratch ordinary approval'}],
            'hosted_run': None, 'judgment': None}))
        w.judgment.write_text('null')
        result = w.prepare('ordinary')
        self.assertFalse(result['admission']['judged'])
        measured = result['record']['measurements']['train']
        self.assertEqual(measured['judgment'], 'pending')
        self.assertNotIn('judge_receipts_sha256', measured)


class Harness1137(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='harness1137-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.addCleanup(lambda: fixture.retain(self, self.root))

    def test_zero_missing_terminal_and_dead_fixture_are_incomplete_never_pass(self):
        import sys
        for mode in ('zero', 'missing-terminal', 'dead-fixture'):
            folder = self.root/mode; folder.mkdir()
            source = folder/'harness.py'
            source.write_text('''from __future__ import annotations
import json,os,sys,unittest
from pathlib import Path
root=Path(__file__).resolve().parent
(root/'launch.json').write_text(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'argv':sys.argv,'cwd':os.getcwd()}))
class Boundary(unittest.TestCase):
 def test_case(self): self.assertEqual(1,1)
mode=sys.argv[1]
case=Boundary('test_case')
executed=[]
if mode=='dead-fixture':
 (root/'cases.json').write_text(json.dumps({'intended':[case.id()],'executed':executed}))
 raise SystemExit(3)
if mode=='zero': unittest.TextTestRunner().run(unittest.TestSuite())
else:
 case.run(unittest.TestResult()); executed.append(case.id())
(root/'cases.json').write_text(json.dumps({'intended':[case.id()],'executed':executed}))
''')
            result = release_check.run_step('python-units', [sys.executable, '-I', '-B', str(source), mode],
                                            self.root, folder, release_check.python_counts, 'scratch1137')
            cases = json.loads((folder/'cases.json').read_text())
            with self.subTest(mode=mode):
                self.assertFalse(result['passed'], 'INCOMPLETE must never be PASS')
                self.assertEqual(len(cases['executed']), 1 if mode == 'missing-terminal' else 0)
            launch = json.loads((folder/'launch.json').read_text())
            absent = subprocess.run(['/bin/ps', '-p', str(launch['pid'])], capture_output=True).returncode != 0
            self.assertTrue(absent)
            (folder/'boundary.json').write_text(json.dumps({'classification': 'INCOMPLETE',
                'actual_step': result, 'case_identities': cases, 'owned_child_absent': absent}))

    def test_timed_out_capture_is_incomplete_and_does_not_supply_a_pass(self):
        argv = ['/isolated/harness', 'timeout-port']
        with mock.patch.object(release_check.subprocess, 'run', side_effect=subprocess.TimeoutExpired(argv, 1)), \
                self.assertRaises(subprocess.TimeoutExpired):
            release_check.run_step('python-units', argv, self.root, self.root,
                                   release_check.python_counts, 'scratch1137')
        (self.root/'timeout.json').write_text(json.dumps({'classification': 'INCOMPLETE',
            'port': 'injected subprocess timeout; no child launched or signalled', 'executed_case_ids': []}))


class Lifecycle1137(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='machine1137-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def world(self, **kw):
        return fixture.MachineWorld(self, self.root, **kw)

    def test_real_scratch_store_and_owned_process_ports_are_healthy(self):
        w = self.world()
        self.assertEqual(w.schema(), SCHEMA_VERSION)
        self.assertEqual(w.store.view('operator', 'capabilities', {})['instance_id'], 'machine1137')
        self.assertEqual(w.active, {111: 'server', 222: 'runner'})
        self.assertEqual(w.repair_items(), [])

    def test_incomplete_harness_creates_one_owned_repair_and_notification_without_replay(self):
        w = self.world(); data = json.loads(w.summary.read_text()); data['only'] = ['node-units']
        w.summary.write_text(json.dumps(data)); saved = w.summary.read_bytes()
        for index in range(2):
            with self.assertRaisesRegex(deploy.Refused, 'release check'):
                w.invoke(w.root/('incomplete-%d' % index))
        self.assertEqual(w.summary.read_bytes(), saved)
        self.assertEqual(w.producers, [])
        self.assertEqual(len(w.repair_items()), 1, 'unmet1139: one visible owned repair for this INCOMPLETE identity')
        self.assertEqual(len(w.notifications), 1, 'unmet notifier: retry must not duplicate the notification')

    def test_repeated_failure_deduplicates_and_new_failure_is_retained(self):
        w = self.world(); w.write_summary('Case.first')
        for index in range(2):
            with self.assertRaises(deploy.Refused):
                w.invoke(w.root/('same-%d' % index))
        first = w.repair_items()
        first_notifications = len(w.notifications)
        w.write_summary('Case.new')
        with self.assertRaises(deploy.Refused):
            w.invoke(w.root/'new-failure')
        self.assertEqual(len(first), 1, 'unmet1139: repeated failure must have one owned repair')
        self.assertEqual(first_notifications, 1)
        self.assertEqual(len(w.repair_items()), 2, 'a genuinely new failure must not disappear into the old item')
        self.assertEqual(len(w.notifications), 2)

    def test_missing_metadata_cannot_restart_unchanged_completed_evidence(self):
        w = self.world(); w.write_summary('Case.named', note='')
        saved = w.summary.read_bytes()
        for index in range(2):
            with self.assertRaises(deploy.Refused):
                w.invoke(w.root/('metadata-%d' % index))
        self.assertEqual(w.summary.read_bytes(), saved)
        self.assertEqual(w.producers, [])
        self.assertEqual(len(w.repair_items()), 1, 'missing metadata needs an owned diagnosis, not a whole-suite loop')
        item = w.repair_items()[0]
        self.assertIn('operator', item['description'], 'the repair must visibly name its responsible owner')

    def test_named_diagnosis_allows_at_most_one_corrective_attempt_with_retained_evidence(self):
        w = self.world(); w.write_summary('Case.diagnosed')
        w.command('pipeline.item_add', {'title': 'Repair Case.diagnosed', 'section': 'candidates',
            'description': 'owner: operator\ndiagnosis: missing harness fixture\nfailure: Case.diagnosed\n',
            'sources': [{'note': 'isolated named diagnosis for the retained failure'}]}, {'workspace_id': 'w1'})
        saved = w.summary.read_bytes()
        for index in range(2):
            with self.assertRaises(deploy.Refused):
                w.invoke(w.root/('diagnosed-%d' % index))
        self.assertLessEqual(len(w.producers), 1, 'a diagnosis is not an unchanged whole-suite loop')
        self.assertEqual(w.summary.read_bytes(), saved)
        self.assertEqual(len(w.repair_items()), 1, 'the named diagnosis keeps the same owned repair')
        self.assertEqual(len(w.notifications), 1, 'unmet notifier: the diagnosed failure still needs one notice')

    def test_post_stop_backup_refusal_restores_compatible_service_and_keeps_original_failure(self):
        w = self.world(); w.backup_exit = 1
        with self.assertRaisesRegex(deploy.Refused, 'backup failed'):
            w.invoke(w.root/'backup-refused')
        self.assertTrue((w.root/'backup-refused/03-stopped.json').is_file())
        self.assertEqual(json.loads((w.root/'backup-refused/04-backup.json').read_text())['exit'], 1)
        self.assertEqual(w.schema(), SCHEMA_VERSION)
        self.assertEqual(sorted(w.active.values()), ['runner', 'server'], 'unmet1136: compatible service must recover')
        recovery = w.root/'backup-refused/recovery.json'
        self.assertTrue(recovery.is_file(), 'separate recovery result must preserve the original refusal')
        self.assertTrue(all(s['revision'] == w.base for s in w.starts))

    def test_incompatible_migrated_database_never_runs_old_server_and_has_separate_recovery_result(self):
        w = self.world(target_schema=str(int(SCHEMA_VERSION)+1)); w.fail_candidate_ready = True
        with self.assertRaisesRegex(deploy.Refused, 'server did not report ready'):
            w.invoke(w.root/'new-schema-refused')
        self.assertEqual(w.schema(), str(int(SCHEMA_VERSION)+1))
        self.assertFalse(any(s['revision'] == w.base for s in w.starts))
        self.assertTrue((w.root/'new-schema-refused/recovery.json').is_file(),
                        'unmet1136: incompatible recovery must be separately refused, never silently rolled back')

    def test_changed_process_identity_is_not_signalled_after_the_plan_read(self):
        w = self.world(); w.backup_exit = 1
        actual = deploy.release_plan
        def identity_changes(*args, **kwargs):
            result = actual(*args, **kwargs)
            w.identities[111] = 'replacement-owner-at-same-pid'
            return result
        with mock.patch.object(deploy, 'release_plan', side_effect=identity_changes), \
                self.assertRaises(deploy.Refused):
            w.invoke(w.root/'identity-changed')
        self.assertEqual([s for s in w.signals if s['identity'] == 'replacement-owner-at-same-pid'], [],
                         'unmet1136: captured PID is not permission to signal its replacement owner')

    def test_post_fast_forward_migration_refusal_preserves_original_and_resumes_from_compatible_recovery(self):
        w = self.world(); w.migration_exit = 2
        with self.assertRaisesRegex(deploy.Refused, 'migration failed'):
            w.invoke(w.root/'migration-refused')
        original = (w.root/'migration-refused/06-migrate.json').read_bytes()
        self.assertEqual(json.loads(original)['exit'], 2)
        self.assertIn('MIGRATION_FAILED', json.loads(original)['stderr'])
        self.assertEqual(w.schema(), SCHEMA_VERSION)
        recovered = dict(w.active)
        recovered_tree = w.git('rev-parse', 'HEAD')
        w.migration_exit = 0
        retry_refusal = None
        try:
            w.invoke(w.root/'safe-resume-after-migration-refusal')
        except deploy.Refused as error:
            retry_refusal = str(error)
        (w.root/'migration-recovery-boundary.json').write_text(json.dumps({
            'original_migration_exit': 2, 'actual_scratch_schema': w.schema(),
            'recovered_stub_processes': recovered, 'recovered_tree': recovered_tree,
            'retry_refusal': retry_refusal,
            'scope': 'injected migration port; not the actual367 foreign-key reproducer'}))
        self.assertEqual((w.root/'migration-refused/06-migrate.json').read_bytes(), original)
        self.assertEqual(sorted(recovered.values()), ['runner', 'server'],
                         'unmet1136: failed migration must restore compatible service before safe resume')
        self.assertEqual(recovered_tree, w.base)
        self.assertIsNone(retry_refusal, 'an explicitly retried compatible recovery must resume safely')
        self.assertEqual(sorted(w.active.values()), ['runner', 'server'])

    def test_already_live_restart_does_not_duplicate_services(self):
        w = self.world()
        w.invoke(w.root/'first-deploy')
        first = dict(w.active)
        with self.assertRaises(deploy.Refused):
            # An already-live invocation with a release number must refuse the
            # record-only argument before disturbing its owned running services.
            w.invoke(w.root/'already-live-number', number=2, dry=True)
        self.assertEqual(w.active, first)
        w.invoke(w.root/'safe-resume')
        self.assertEqual(sorted(w.active.values()), ['runner', 'server'])
        self.assertEqual(len(w.active), 2)


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

"""Scratch Git, captured raw logs and an executable bound Core read fixture.

No live records, application deploy or real browser are used by these units.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from tools import deploy, deterministic_admission as proof, train, releases


class Deterministic1131(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='deterministic1131-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.serial = 0
        self.git('init', '-q')
        self.git('config', 'user.name', 'Scratch1131')
        self.git('config', 'user.email', 'scratch1131@example.invalid')
        for path, text in {'tools/deploy.py': '# old guarded owner\n',
                           'tests/a.test.mjs': '// existing node test\n',
                           'tests/b.test.mjs': '// second node file\n',
                           'tests/test_core.py': '# named source cohort\n',
                           'tests/test_migrations.py': '# migration chain\n',
                           'web/app.js': '// old page\n'}.items():
            self.write(path, text)
        self.write('bin/aim-next', '''from __future__ import annotations
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
if sys.argv[-1]=='binding':
 print(json.dumps({'v':1,'binding':{'instance_id':'scratch1131','actor_id':'reader1131'}}))
else:
 request=json.load(sys.stdin)
 assert request['binding']=={'instance_id':'scratch1131','actor_id':'reader1131'}
 name=request['view']['name']
 with (root/'reads').open('a') as f:f.write(name+'\\n')
 print((root/('audit.json' if name=='source' else 'pipeline.json')).read_text())
''')
        self.base = self.commit('base', 1700000000)
        self.write('tools/deploy.py', '# revised guarded owner\n')
        self.write('web/app.js', '// changed page\n')
        self.source = self.commit('source\n\nPipeline: 1131', 1700000010)
        self.head = self.commit('carry\n\nPipeline: 1131', 1700000020)
        self.tree = self.git('rev-parse', self.head + '^{tree}').stdout.strip()
        self.piece = {'id': 'p-source1131', 'items': [1131], 'version': 4,
            'stage': {'stage_id': 'wait'}, 'approval': {'at_ms': 1700000011000, 'seq': 20},
            'freeze': {'judged': True, 'base_commit': self.base, 'head_commit': self.source,
                       'files': ['tools/deploy.py', 'web/app.js'], 'piece_revision': 2,
                       'by': 'scratch-builder', 'at_ms': 1700000010000}}
        self.config = SimpleNamespace(live=self.repo, instance=self.root/'instance', python='/usr/bin/python3', pipeline_broker=self.root/'core.sock',
            pipeline_profile=None, pipeline_outcome='scratch-work', pipeline_instance='scratch1131')
        self.value = {'version': 1131, 'carry': {'base': self.base, 'head': self.head, 'tree': self.tree,
            'created_at_ms': 1700000020000}, 'node_comparison': self.node_pair(),
            'core_cohort': self.core_cohort(), 'browser_cells': [self.cell()],
            'audit': {'message': 'm-'+'a'*32, 'revision': 1}}
        self.pipeline(); self.bind_audit()
        self.git('checkout', '-q', '--detach', self.base)

    def write(self, path, text):
        p = self.repo / path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)

    def git(self, *args, stamp=None):
        env = dict(os.environ)
        if stamp:
            env.update(GIT_AUTHOR_DATE=str(stamp)+' +0000', GIT_COMMITTER_DATE=str(stamp)+' +0000')
        result = subprocess.run(['git', '-C', str(self.repo)] + list(args), capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def commit(self, body, stamp):
        self.git('add', '.')
        self.git('commit', '-qm', body, '--allow-empty', stamp=stamp)
        return self.git('rev-parse', 'HEAD').stdout.strip()

    def raw(self, data):
        if not isinstance(data, bytes):
            data = data.encode() if isinstance(data, str) else json.dumps(data).encode()
        self.serial += 1
        path = self.root / ('raw-%d' % self.serial); path.write_bytes(data)
        return {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest()}

    def snapshot(self, head):
        rows = self.git('ls-tree', '-r', '-z', '--full-tree', head).stdout.split('\0')
        inputs = {row.split('\t', 1)[1]: row.split('\t', 1)[0].split()[2] for row in rows if row}
        return self.raw({'head': head, 'tree': self.git('rev-parse', head+'^{tree}').stdout.strip(),
                         'changes': '', 'inputs': inputs})

    def unit(self, head, *, node, names=None, fail=False, attempt=1, run=None):
        names = names or (['tests/a.test.mjs', 'tests/b.test.mjs'] if node else ['tests/test_core.py', 'tests/test_migrations.py'])
        files = []
        for index, path in enumerate(names):
            if node:
                node_fail = fail and index == 0
                text = ('TAP version 13\n# Subtest: existing behavior\n%s 1 - existing behavior\n'
                        '1..1\n# tests 1\n# suites 0\n# pass %d\n# fail %d\n# cancelled 0\n# skipped 0\n# todo 0\n' %
                        ('not ok' if node_fail else 'ok', 0 if node_fail else 1, 1 if node_fail else 0))
                counts = {'tests': 1, 'pass': 0 if node_fail else 1, 'fail': 1 if node_fail else 0,
                          'cancelled': 0, 'skipped': 0, 'todo': 0}
                argv = ['node', '--test', '--test-reporter=tap', path]
                stdout, stderr = text, ''
            else:
                text = ('test_behavior (test_core.Scratch) ... %s\n\nRan 1 test in 0.01s\n\n%s\n' %
                        ('FAIL' if fail else 'ok', 'FAILED (failures=1)' if fail else 'OK'))
                counts = {'tests': 1, 'status': 'FAILED' if fail else 'OK'}
                if fail: counts['failures'] = 1
                argv = ['python3', '-m', 'unittest', '-v', path]
                stdout, stderr = '', text
            files.append({'file': path, 'argv': argv, 'exit': 1 if (node_fail if node else fail) else 0,
                          'stdout': self.raw(stdout), 'stderr': self.raw(stderr), 'counts': counts})
        return self.raw({'run': run or ('node-' if node else 'core-')+head, 'attempt': attempt,
                         'head': head, 'tree': self.git('rev-parse', head+'^{tree}').stdout.strip(),
                         'inputs_before': self.snapshot(head), 'inputs_after': self.snapshot(head), 'files': files})

    def node_pair(self, *, old_fail=False, new_fail=False):
        return self.raw({'base': self.unit(self.base, node=True, fail=old_fail),
                         'carry': self.unit(self.head, node=True, fail=new_fail)})

    def core_cohort(self, fail=False):
        return self.raw({'head': self.head, 'tree': self.tree,
            'pieces': [{'piece_id': 'p-source1131', 'head': self.source, 'tests': ['tests/test_core.py']}],
            'migration_tests': ['tests/test_migrations.py'], 'run': self.unit(self.head, node=False, fail=fail)})

    def grouped(self, head, node, failed_file=None):
        if node:
            paths = ['tests/a.test.mjs', 'tests/b.test.mjs']
            text = 'TAP version 13\n'
            for index, path in enumerate(paths):
                failed = path == failed_file
                text += '# Subtest: existing behavior\n%s %d - existing behavior\n' % ('not ok' if failed else 'ok', index+1)
                if failed:
                    text += "  ---\n  type: 'test'\n  location: '%s:1:1'\n  ...\n" % (self.repo/path)
            text += '1..2\n# tests 2\n# suites 0\n# pass %d\n# fail %d\n# cancelled 0\n# skipped 0\n# todo 0\n' % (1 if failed_file else 2, 1 if failed_file else 0)
            argv = ['node', '--test', '--test-concurrency=1', '--test-reporter=tap'] + [str(self.repo/p) for p in paths]
            stdout, stderr = text, ''
            counts = {'tests': 2, 'pass': 1 if failed_file else 2, 'fail': 1 if failed_file else 0,
                      'cancelled': 0, 'skipped': 0, 'todo': 0}
        else:
            paths = ['tests/test_core.py', 'tests/test_migrations.py']
            argv = ['/usr/bin/nice', '-n', '15', '/usr/bin/python3', '-I', '-B', '-m', 'unittest',
                    'discover', '-s', str(self.repo/'tests'), '-p', 'test_*.py', '-v']
            stdout = ''
            stderr = 'test_behavior (test_core.Scratch) ... ok\ntest_chain (test_migrations.Scratch) ... ok\n\nRan 2 tests in 0.01s\n\nOK\n'
            counts = {'tests': 2, 'status': 'OK'}
        return self.raw({'run': ('grouped-node-' if node else 'grouped-core-')+head, 'attempt': 1,
            'head': head, 'tree': self.git('rev-parse', head+'^{tree}').stdout.strip(),
            'inputs_before': self.snapshot(head), 'inputs_after': self.snapshot(head),
            'grouped': {'files': paths, 'cwd': str(self.repo), 'argv': argv, 'exit': 1 if failed_file else 0,
                        'stdout': self.raw(stdout), 'stderr': self.raw(stderr), 'counts': counts}})

    def cell(self):
        row = {'paths': ['web/app.js'], 'page': 'scratch page', 'cell': 'completed-cell1131',
               'head': self.head, 'tree': self.tree, 'completed': True}
        row['raw'] = self.raw(dict(row, driver='real-browser', status='pass'))
        return row

    def pipeline(self, extra=()):
        rows = [self.piece] + list(extra)
        page = {'instance_id': 'scratch1131', 'workspace_id': 'scratch-work',
            'relevant_versions': {'pipeline': 1}, 'pipeline': {'enabled': True, 'ships_in_releases': True},
            'pieces': rows, 'items': [], 'next_cursor': None, 'release_piece': None,
            'facts': {'approved_waiting': [n for row in rows for n in row['items']], 'next_release': None}}
        (self.root/'pipeline.json').write_text(json.dumps(page))

    def bind_audit(self, **overrides):
        data = {'instance_id': 'scratch1131', 'source_ref': {'kind': 'message', 'id': 'm-'+'a'*32},
            'revision': 1, 'author': 'auditor', 'sent_ms': 1700000030000,
            'body': '(codex) auditor —1131 '+json.dumps({'decision': 'accept',
                'evidence_sha256': proof.evidence_digest(self.value), 'approval_before_carry': True,
                'carry_started_at_ms': self.value['carry']['created_at_ms']}),
            'whisper': False, 'withheld': False, 'removal': None, 'withdrawal': None, 'struck': None}
        data.update(overrides); (self.root/'audit.json').write_text(json.dumps(data))

    def admit(self):
        return deploy.admit(self.config, self.head, judgment=self.value)

    def change_document(self, ref, change):
        data = json.loads(Path(ref['path']).read_text()); change(data)
        return self.raw(data)

    def test_1131_no_verdict_admits_exact_deterministic_evidence(self):
        result = self.admit()
        self.assertEqual(result['deterministic']['node_comparison']['added_failures'], [])
        self.assertEqual(result['deterministic']['core_cohort']['result'], 'PASS')
        self.assertEqual(result['deterministic']['browser_cells'], ['completed-cell1131'])
        self.assertEqual(result['sources'][0]['freeze']['head_commit'], self.source)

    def test_1131_failed_verdict_and_dead_browser_machine_are_recorded_without_a_veto(self):
        self.value['verdicts'] = [{'run': 8, 'attempt': 1, 'check': 88, 'conclusion': 'failure',
            'raw': self.raw('native-openings: body error differs from retained log')}]
        self.bind_audit()
        result = self.admit()
        self.assertEqual(result['deterministic']['verdicts'][0]['conclusion'], 'failure')

    def test_1131_new_node_red_refuses_before_effects(self):
        self.value['node_comparison'] = self.node_pair(new_fail=True); self.bind_audit()
        effects = []
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'):
            self.admit(); effects.append('merge')
        self.assertEqual(effects, [])

    def test_1131_existing_named_node_red_remains_red_and_is_not_a_new_failure(self):
        self.value['node_comparison'] = self.node_pair(old_fail=True, new_fail=True); self.bind_audit()
        result = self.admit()
        self.assertEqual(result['deterministic']['node_comparison']['carry']['counts']['fail'], 1)

    def test_1131_failing_core_or_migration_cohort_is_not_waived_by_browser_policy(self):
        self.value['core_cohort'] = self.core_cohort(fail=True); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'not PASS'): self.admit()

    def test_1131_missing_migration_chain_run_refuses(self):
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'], lambda d: d.update(migration_tests=[]))
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'migration chain'): self.admit()

    def test_1131_exact_canonical_frozen_source_is_required(self):
        def change(d): d['pieces'][0]['head'] = self.base
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'], change); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'canonical frozen'): self.admit()

    def test_1131_approval_after_carry_refuses_even_when_all_tests_pass(self):
        self.piece['approval']['at_ms'] = 1700000020001; self.pipeline()
        with self.assertRaisesRegex(deploy.Refused, 'approved after'): self.admit()

    def test_1131_changed_page_needs_completed_cell(self):
        self.value['browser_cells'] = []; self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'changed web page'): self.admit()

    def test_1131_same_tree_browser_record_from_another_head_refuses(self):
        self.value['browser_cells'][0]['head'] = self.source; self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'another carry'): self.admit()

    def test_1131_stale_withheld_removed_private_or_wrong_author_audit_refuses(self):
        for override in ({'revision': 2}, {'withheld': True}, {'removal': {'by': 'owner'}},
                         {'whisper': True}, {'author': 'scratch-builder'}, {'body': 'reviewed different evidence'}):
            with self.subTest(override=override):
                self.bind_audit(**override)
                with self.assertRaises(deploy.Refused): self.admit()

    def test_1131_changed_raw_bytes_refuse(self):
        Path(self.value['node_comparison']['path']).write_text('{}')
        with self.assertRaisesRegex(deploy.Refused, 'hash differs'): self.admit()

    def test_1131_rejected_decision_or_quoted_acceptance_does_not_approve_evidence(self):
        self.bind_audit()
        accepted = json.loads((self.root/'audit.json').read_text())['body']
        for body in (accepted.replace('"accept"', '"reject"'), '> '+accepted,
                     '(codex) auditor —Rejected this evidence; quoted marker: '+accepted,
                     accepted+'\nRejected because the capture is incomplete.'):
            with self.subTest(body=body):
                self.bind_audit(body=body)
                with self.assertRaises(deploy.Refused): self.admit()

    def test_1131_future_dated_witness_cannot_authorize_a_carry(self):
        self.value['carry']['created_at_ms'] = 2000000000000; self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'future-dated'): self.admit()

    def test_1131_future_git_timestamp_does_not_override_preapproval_carry_witness(self):
        self.git('checkout', '-q', '--detach', self.head)
        self.head = self.commit('future declared Git time\n\nPipeline: 1131', 2000000000)
        self.value['carry'].update(head=self.head, created_at_ms=1700000010500)
        self.value.update(node_comparison=self.node_pair(), core_cohort=self.core_cohort(), browser_cells=[self.cell()])
        self.bind_audit(); self.git('checkout', '-q', '--detach', self.base)
        with self.assertRaisesRegex(deploy.Refused, 'approved after'): self.admit()

    def test_1131_legitimate_approval_then_carry_within_one_second_keeps_milliseconds(self):
        self.value['carry']['created_at_ms'] = self.piece['approval']['at_ms'] + 1; self.bind_audit()
        self.assertEqual(self.admit()['deterministic']['created_at_ms'], 1700000011001)

    def test_1131_wrong_actual_live_or_carry_tree_refuses(self):
        for field in ('base', 'tree'):
            original = self.value['carry'][field]; self.value['carry'][field] = 'f'*40; self.bind_audit()
            with self.subTest(field=field), self.assertRaises(deploy.Refused): self.admit()
            self.value['carry'][field] = original

    def test_1131_partial_captured_inputs_cannot_claim_whole_source(self):
        pair = json.loads(Path(self.value['node_comparison']['path']).read_text())
        run = json.loads(Path(pair['carry']['path']).read_text())
        run['inputs_before'] = self.change_document(run['inputs_before'], lambda d: d['inputs'].pop('web/app.js'))
        pair['carry'] = self.raw(run); self.value['node_comparison'] = self.raw(pair); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'captured inputs'): self.admit()

    def test_1131_missing_file_and_missing_case_outcome_refuse(self):
        original = self.value['node_comparison']
        for change in (lambda d: d.update(files=[]),
                       lambda d: d['files'][0].update(stdout=self.raw('TAP version 13\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'))):
            pair = json.loads(Path(original['path']).read_text())
            pair['carry'] = self.change_document(pair['carry'], change)
            self.value['node_comparison'] = self.raw(pair); self.bind_audit()
            with self.subTest(change=change), self.assertRaises(deploy.Refused): self.admit()

    def test_1131_nonpositive_attempt_and_wrong_command_refuse(self):
        original = self.value['node_comparison']
        for change in (lambda d: d.update(attempt=0), lambda d: d['files'][0]['argv'].append('--test-name-pattern=one')):
            pair = json.loads(Path(original['path']).read_text())
            pair['carry'] = self.change_document(pair['carry'], change)
            self.value['node_comparison'] = self.raw(pair); self.bind_audit()
            with self.subTest(change=change), self.assertRaises(deploy.Refused): self.admit()

    def test_1131_reusing_one_run_and_attempt_for_base_and_carry_refuses(self):
        pair = json.loads(Path(self.value['node_comparison']['path']).read_text())
        base = json.loads(Path(pair['base']['path']).read_text())
        pair['carry'] = self.change_document(pair['carry'], lambda d: d.update(run=base['run'], attempt=base['attempt']))
        self.value['node_comparison'] = self.raw(pair); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'substitute one run'): self.admit()

    def test_1131_new_named_python_failure_blocks_with_no_verdict(self):
        self.value['python_comparisons'] = [self.raw({'files': ['tests/test_core.py'],
            'base': self.unit(self.base, node=False, names=['tests/test_core.py']),
            'carry': self.unit(self.head, node=False, names=['tests/test_core.py'], fail=True)})]
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'): self.admit()

    def test_1131_a_new_passing_named_node_case_is_allowed(self):
        pair = json.loads(Path(self.value['node_comparison']['path']).read_text())
        def change(d):
            row = d['files'][0]
            row['stdout'] = self.raw('TAP version 13\n# Subtest: existing behavior\nok 1 - existing behavior\n'
                '# Subtest: new behavior\nok 2 - new behavior\n1..2\n# tests 2\n# suites 0\n# pass 2\n'
                '# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
            row['counts'].update(tests=2, **{'pass': 2})
        pair['carry'] = self.change_document(pair['carry'], change)
        self.value['node_comparison'] = self.raw(pair); self.bind_audit()
        self.assertEqual(self.admit()['deterministic']['node_comparison']['carry']['counts']['tests'], 3)

    def test_1131_failing_cell_is_completed_evidence_not_a_successful_suite_gate(self):
        row = self.value['browser_cells'][0]
        row['raw'] = self.change_document(row['raw'], lambda d: d.update(status='fail'))
        self.bind_audit()
        self.assertEqual(self.admit()['deterministic']['browser_cells'], ['completed-cell1131'])

    def test_1131_actual_grouped_node_and_isolated_python_command_shapes_are_supported(self):
        self.value['node_comparison'] = self.raw({'base': self.grouped(self.base, True),
                                                  'carry': self.grouped(self.head, True)})
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'],
            lambda d: d.update(run=self.grouped(self.head, False)))
        self.bind_audit()
        result = self.admit()['deterministic']
        self.assertEqual(result['node_comparison']['files'], 2)
        self.assertEqual(result['core_cohort']['counts']['tests'], 2)

    def test_1131_grouped_named_failure_moving_to_a_different_file_is_new_red(self):
        self.value['node_comparison'] = self.raw({'base': self.grouped(self.base, True, 'tests/a.test.mjs'),
            'carry': self.grouped(self.head, True, 'tests/b.test.mjs')})
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'): self.admit()

    def test_1131_grouped_command_cannot_relabel_omitted_file_coverage(self):
        pair = {'base': self.grouped(self.base, True), 'carry': self.grouped(self.head, True)}
        pair['carry'] = self.change_document(pair['carry'], lambda d: d['grouped']['argv'].pop())
        self.value['node_comparison'] = self.raw(pair); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'file coverage'): self.admit()

    def test_1131_node_distribution_must_match_each_named_outcome(self):
        def mismatch(d):
            row = d['grouped']
            raw = Path(row['stdout']['path']).read_text().replace('# pass 1\n# fail 1', '# pass 0\n# fail 2')
            row['stdout'] = self.raw(raw); row['counts'].update({'pass': 0, 'fail': 2})
        pair = {'base': self.grouped(self.base, True),
                'carry': self.change_document(self.grouped(self.head, True, 'tests/a.test.mjs'), mismatch)}
        self.value['node_comparison'] = self.raw(pair); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'counts differ from individual'): self.admit()

    def test_1131_python_error_and_skip_counts_must_match_individual_outcomes(self):
        original = self.value['core_cohort']
        for tail, counts, status in (
            ('test_chain (test_migrations.Scratch) ... ERROR\n\nRan 2 tests in 0.01s\n\nFAILED (failures=1)\n',
             {'tests': 2, 'status': 'FAILED', 'failures': 1}, 1),
            ("test_chain (test_migrations.Scratch) ... skipped 'reason'\n\nRan 2 tests in 0.01s\n\nOK (skipped=2)\n",
             {'tests': 2, 'status': 'OK', 'skipped': 2}, 0)):
            def mismatch(d):
                d['grouped'].update(stderr=self.raw('test_behavior (test_core.Scratch) ... ok\n'+tail),
                                    counts=counts, exit=status)
            run = self.change_document(self.grouped(self.head, False), mismatch)
            self.value['core_cohort'] = self.change_document(original, lambda d: d.update(run=run)); self.bind_audit()
            with self.subTest(counts=counts), self.assertRaisesRegex(deploy.Refused, 'counts differ from individual'):
                self.admit()

    def test_1131_tap_suite_summary_does_not_inflate_pass_distribution(self):
        def suite(d):
            text = ("TAP version 13\n# Subtest: Suite\n    # Subtest: first\n    ok 1 - first\n"
                "      ---\n      type: 'test'\n      ...\n    # Subtest: second\n    ok 2 - second\n"
                "      ---\n      type: 'test'\n      ...\n    1..2\nok 1 - Suite\n  ---\n  type: 'suite'\n"
                "  ...\n1..1\n# tests 2\n# suites 1\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n")
            d['grouped']['stdout'] = self.raw(text)
        ref = self.change_document(self.grouped(self.head, True), suite)
        result = proof.unit_run(ref, self.git, self.head, node=True)
        self.assertEqual(result['counts']['pass'], 2)
        self.assertEqual(sum(result['cases'].values()), 3)

    def test_1131_audit_must_explicitly_accept_ordering_as_well_as_evidence(self):
        self.bind_audit()
        body = json.loads((self.root/'audit.json').read_text())['body'].replace('"approval_before_carry": true',
                                                                           '"approval_before_carry": false')
        self.bind_audit(body=body)
        with self.assertRaisesRegex(deploy.Refused, 'approval-before-carry ordering'): self.admit()

    def test_1131_second_boundary_reads_new_ordinary_approval(self):
        self.admit()
        ordinary = copy.deepcopy(self.piece); ordinary.update(id='p-ordinary', items=[42])
        ordinary['freeze']['judged'] = False; ordinary['freeze']['files'] = ['web/app.js']
        ordinary['approval']['at_ms'] = 1700000030000
        self.pipeline([ordinary])
        with self.assertRaisesRegex(deploy.Refused, 'p-ordinary'): self.admit()

    def test_1131_ordinary_delta_needs_neither_pipeline_nor_evidence(self):
        self.git('checkout', '-q', '--detach', self.head)
        self.write('web/app.js', '// ordinary page change\n')
        head = self.commit('ordinary\n\nPipeline: 42', 1700000030)
        self.git('checkout', '-q', '--detach', self.head)
        (self.root/'pipeline.json').write_text('unavailable')
        self.assertFalse(deploy.admit(self.config, head)['judged'])

    def test_1131_train_reader_and_release_record_accept_new_schema_without_github_verdict(self):
        self.git('checkout', '-q', '-b', 'land', self.base)
        self.git('merge', '-q', '--no-ff', self.head, '-m', 'landing')
        merged = self.git('rev-parse', 'HEAD').stdout.strip()
        value = {'pr': 1, 'merge_commit': merged, 'merged_tree': self.tree, 'kind': 'judged-first',
            'items': [{'item': 1131, 'approved_head': self.source, 'review': 'scratch review'}],
            'hosted_run': None, 'judgment': self.value}
        path = self.root/'train.json'; path.write_text(json.dumps(value))
        queried = []
        def get(url):
            queried.append(url)
            if '/compare/' in url:
                return {'status': 'identical', 'behind_by': 0, 'merge_base_commit': {'sha': merged}}
            if '/pulls/' in url:
                return {'number': 1, 'merged': True, 'merge_commit_sha': merged,
                        'base': {'ref': 'release/live73'}, 'head': {'sha': self.head}}
            raise AssertionError('unexpected Verdict/producer read: '+url)
        result = train.judge(path, merged, self.base, 'release/live73', 'scratch/repo', self.git, SimpleNamespace(get=get))
        self.assertIn('Core/migrations PASS', train.said(result))
        self.assertEqual(len(queried), 2)
        self.assertEqual(releases.train_measurements(result)['train']['deterministic']['core_cohort']['result'], 'PASS')

    def test_1131_two_frozen_sources_admit_without_a_producer_or_verdict(self):
        self.git('checkout', '-q', '--detach', self.source)
        self.write('tools/train.py', '# second reviewed guarded owner\n')
        second_head = self.commit('second source\n\nPipeline: 1132', 1700000012)
        self.head = self.commit('two-source carry\n\nPipeline: 1131, 1132', 1700000020)
        self.tree = self.git('rev-parse', self.head+'^{tree}').stdout.strip()
        second = copy.deepcopy(self.piece)
        second.update(id='p-source1132', items=[1132], approval={'at_ms':1700000014000,'seq':21})
        second['freeze'].update(base_commit=self.source, head_commit=second_head,
                                files=['tools/train.py'], at_ms=1700000012000)
        self.value['carry'].update(head=self.head, tree=self.tree)
        self.value.update(node_comparison=self.node_pair(), core_cohort=self.core_cohort(), browser_cells=[self.cell()])
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'], lambda d: d['pieces'].append(
            {'piece_id':second['id'],'head':second_head,'tests':['tests/test_core.py']}))
        self.pipeline([second]); self.bind_audit(); self.git('checkout','-q','--detach',self.base)
        result = self.admit()
        self.assertEqual(result['items'], [1131,1132])
        self.assertEqual([r['piece_id'] for r in result['sources']], ['p-source1131','p-source1132'])
        self.assertIsNone(result['producer'])

    def test_1131_four_items_need_a_new_ruling_before_any_record_or_effect(self):
        self.git('checkout', '-q', '--detach', self.head)
        fourth = self.commit('four-item carry\n\nPipeline: 1131, 1132, 1133, 1134', 1700000030)
        self.git('checkout', '-q', '--detach', self.base)
        with self.assertRaisesRegex(deploy.Refused, 'Warp18837'):
            deploy.admit(self.config, fourth, judgment=self.value)
        self.assertFalse((self.root/'reads').exists())

    def deploy_to_second_boundary(self, add_waiter=False):
        """Actual deploy control flow/admission; simulated host reads, no effects.

        The separate train-reader case above verifies its actual Git/PR parsing.
        This fixture stops only after the real second admission record.
        """
        class BoundaryReached(Exception):
            pass
        evidence = self.root/'deploy-boundary-proof'
        trained = {'kind':'judged-first','pr':1,'judgment':self.value,'live':self.base}
        original_record = deploy.record
        names = []
        def record(folder, name, data):
            original_record(folder,name,data); names.append(name)
            if name == '02-admission': raise BoundaryReached()
        def policy(*args, **kwargs):
            if add_waiter:
                ordinary=copy.deepcopy(self.piece); ordinary.update(id='p-late-ordinary',items=[42])
                ordinary['freeze'].update(judged=False,files=['web/app.js'])
                ordinary['approval']['at_ms']=1700000030000
                self.pipeline([ordinary])
            return {'kind':'keep','reason':'scratch host read'}
        rows=[(101,1,'python server-fixture'),(102,1,'python supervisor-fixture'),(103,102,'python runner-fixture')]
        with mock.patch.object(deploy,'take_train',return_value=trained), \
                mock.patch.object(deploy,'runner_policy',side_effect=policy), \
                mock.patch.object(deploy,'server_argv',return_value=['python','server-fixture']), \
                mock.patch.object(deploy,'runner_argv',return_value=['python','runner-fixture']), \
                mock.patch.object(deploy,'supervisor_argv',return_value=['python','supervisor-fixture']), \
                mock.patch.object(deploy,'processes',return_value=rows), \
                mock.patch.object(deploy,'identity',side_effect=lambda pid:'scratch-'+str(pid)), \
                mock.patch.object(deploy,'recorded',side_effect=lambda config,kind:101 if kind=='server' else 102), \
                mock.patch.object(deploy,'kept_runner',return_value={'scratch':True}), \
                mock.patch.object(deploy,'record',side_effect=record):
            if add_waiter:
                with self.assertRaisesRegex(deploy.Refused,'p-late-ordinary'):
                    deploy.deploy(self.config,self.head,evidence,None,False,train=self.root/'selected-train.json')
            else:
                with self.assertRaises(BoundaryReached):
                    deploy.deploy(self.config,self.head,evidence,None,False,train=self.root/'selected-train.json')
        return evidence,names

    def test_1131_actual_deploy_both_admission_boundaries_receive_deterministic_judgment(self):
        evidence,names=self.deploy_to_second_boundary()
        self.assertEqual([n for n in names if n.endswith('admission')], ['00-admission','02-admission'])
        for label in ('00-admission','02-admission'):
            data=json.loads((evidence/(label+'.json')).read_text())
            self.assertEqual(data['deterministic']['audit'],self.value['audit'])
            self.assertEqual(data['deterministic']['core_cohort']['result'],'PASS')

    def test_1131_actual_deploy_second_boundary_refuses_even_a_later_ordinary_waiter(self):
        evidence,names=self.deploy_to_second_boundary(add_waiter=True)
        self.assertIn('00-admission',names)
        self.assertIn('02-checkout',names)
        self.assertNotIn('02-admission',names)
        self.assertFalse((evidence/'02-checks.json').exists())


if __name__ == '__main__':
    unittest.main()

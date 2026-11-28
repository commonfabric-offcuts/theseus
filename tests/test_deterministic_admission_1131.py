from __future__ import annotations

"""Scratch Git, captured raw logs and an executable bound Core read fixture.

No live records, application deploy or real browser are used by these units.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from aim_next import reply_passages
from tools import deploy, deterministic_admission as proof, train, releases


def py(text):
    """A small verbose unittest log in the layout unittest writes: each FAIL/ERROR outcome has its detail block,
    and the '-' rule precedes Ran. Item 1389's whole-log reader requires both, as real unittest output has."""
    ran = re.search(r'^Ran \d+ tests? in ', text, re.M)
    listing, tail = text[:ran.start()].rstrip('\n'), text[ran.start():]
    details = ''.join('%s\n%s: %s\n%s\nTraceback (most recent call last):\nAssertionError: scratch\n\n'
                      % ('=' * 70, found[2], found[1], '-' * 70)
                      for found in re.finditer(r'^(\S+ \([^)]+\)) \.\.\. (FAIL|ERROR)$', listing, re.M))
    return (listing + '\n\n' if listing else '') + details + '-' * 70 + '\n' + tail


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
 name,args=request['view']['name'],request['view']['args']
 with (root/'reads').open('a') as f:f.write(name+'\\n')
 if name=='actors':
  actors=json.loads((root/'actors.json').read_text())
  rows=[row for row in actors if row['enabled'] and row['id']>args['cursor']]
  rows=sorted((dict(id=row['id']) for row in rows),key=lambda row:row['id'])
  print(json.dumps(dict(instance_id='scratch1131',items=rows,next_cursor=None)))
 else:
  file={'source':'audit.json','pipeline':'pipeline.json'}.get(name)
  if name=='pipeline_item': file='item-%s.json' % args['number']
  if name=='topic': file='%s.json' % args['topic_id']
  print((root/file).read_text())
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
        self.actors(auditor=True, **{'auditor-prod': True, 'scratch-builder': True})
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
                text = py('test_behavior (test_core.Scratch) ... %s\n\nRan 1 test in 0.01s\n\n%s\n' %
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
            stderr = py('test_behavior (test_core.Scratch) ... ok\ntest_chain (test_migrations.Scratch) ... ok\n\nRan 2 tests in 0.01s\n\nOK\n')
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
        for row in rows:
            topic_id = 'topic-' + row['id']
            source = dict(row, kind='piece', topic={'id': topic_id}, started={'by': 'scratch-starter'},
                          stages_so_far=[{'stage_id': 'build', 'entered_by': 'scratch-build-stage'}])
            topic = {'id': topic_id, 'workspace_id': 'scratch-work', 'creator_id': 'scratch-creator'}
            (self.root/(topic_id+'.json')).write_text(json.dumps(dict(instance_id='scratch1131', topic=topic)))
            for number in row['items']:
                item = {'number': number, 'pieces': [source]}
                (self.root/('item-%d.json' % number)).write_text(json.dumps(dict(page, item=item)))

    def actors(self, **enabled):
        rows = [dict(id=actor, enabled=active) for actor, active in enabled.items()]
        (self.root/'actors.json').write_text(json.dumps(rows))

    def bind_audit(self, **overrides):
        actor = getattr(self.config, 'admission_auditor', 'auditor')
        data = {'instance_id': 'scratch1131', 'source_ref': {'kind': 'message', 'id': 'm-'+'a'*32},
            'revision': 1, 'author': actor, 'sent_ms': 1700000030000,
            'body': '(codex) '+actor.replace('-', '_')+' —1131 '+json.dumps({'decision': 'accept',
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

    def test_deploy_config_defaults_and_validates_the_auditor_id(self):
        raw = dict(live=str(self.repo), instance=str(self.root/'instance'), port=5193,
                   server_profile='server.json', runner_profile='runner.json', runner_id='runner', routes='routes.json')
        path = self.root/'deploy.json'
        path.write_text(json.dumps(raw))
        self.assertEqual(deploy.load_config(path).admission_auditor, 'auditor')
        raw['admission_auditor'] = 'auditor-prod'
        path.write_text(json.dumps(raw))
        self.assertEqual(deploy.load_config(path).admission_auditor, 'auditor-prod')
        for invalid in ('../auditor', 'auditor prod', '-auditor', 'a'*201, '', None, 7):
            raw['admission_auditor'] = invalid
            path.write_text(json.dumps(raw))
            with self.subTest(invalid=invalid), self.assertRaises(deploy.Refused):
                deploy.load_config(path)

    def test_configured_auditor_accepts_only_its_own_current_affirmative_decision(self):
        self.config.admission_auditor = 'auditor-prod'
        self.bind_audit()
        accepted = json.loads((self.root/'audit.json').read_text())['body']
        self.assertTrue(self.admit()['judged'])
        for override in ({'author': 'auditor'}, {'author': 'outside'}, {'revision': 2},
                         {'body': accepted.replace('"accept"', '"reject"')},
                         {'body': accepted.replace('auditor_prod', 'auditor')},
                         {'body': accepted.replace(proof.evidence_digest(self.value), '0'*64)}):
            with self.subTest(override=override):
                self.bind_audit(**override)
                with self.assertRaises(deploy.Refused):
                    self.admit()

    def test_configured_auditor_must_be_enabled_and_independent_of_source_builders(self):
        self.config.admission_auditor = '../other'
        with self.assertRaisesRegex(deploy.Refused, 'valid actor ID'):
            self.admit()
        self.config.admission_auditor = 'auditor-prod'
        self.bind_audit()
        for roster in ({'auditor': True}, {'auditor': True, 'auditor-prod': False}):
            self.actors(**roster)
            with self.subTest(roster=roster), self.assertRaisesRegex(deploy.Refused, 'missing or disabled'):
                self.admit()
        for builder in ('scratch-builder', 'scratch-starter', 'scratch-build-stage', 'scratch-creator'):
            self.actors(**{builder: True})
            self.config.admission_auditor = builder
            self.bind_audit()
            with self.subTest(builder=builder), self.assertRaisesRegex(deploy.Refused, 'independent'):
                self.admit()

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
                d['grouped'].update(stderr=self.raw(py('test_behavior (test_core.Scratch) ... ok\n'+tail)),
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

    def test_1131_bound_reply_prefix_keeps_the_auditors_own_decision(self):
        self.config.admission_auditor = 'auditor-prod'
        self.bind_audit()
        body = json.loads((self.root/'audit.json').read_text())['body']
        for words in ({'excerpt': 'Check the packet\nRead its evidence'}, {'reason': 'Audit the packet', 'reason_format': 2}):
            with self.subTest(words=words):
                basis = dict(words, source={'kind': 'message', 'id': 'm-'+'b'*32, 'revision': 1}, author_id='builder')
                self.bind_audit(body=reply_passages.prefix(basis)+body, reply_basis=basis,
                                reply_to=basis['source']['id'])
                self.assertTrue(self.admit()['judged'])

    def test_1131_quote_alone_or_unattributed_quote_cannot_admit(self):
        self.config.admission_auditor = 'auditor-prod'
        self.bind_audit()
        body = json.loads((self.root/'audit.json').read_text())['body']
        basis = {'excerpt': body, 'source': {'kind': 'message', 'id': 'm-'+'b'*32, 'revision': 1},
                 'author_id': 'builder'}
        source = basis['source']['id']
        for quoted, recorded, parent in ((reply_passages.prefix(basis)+'I refuse.', basis, source),
                                          ('> Review the packet\n\n'+body, None, source),
                                          ('> A different passage\n\n'+body, basis, source),
                                          (reply_passages.prefix(basis)+body, basis, 'm-'+'c'*32)):
            with self.subTest(quoted=quoted, parent=parent):
                self.bind_audit(body=quoted, reply_basis=recorded, reply_to=parent)
                with self.assertRaisesRegex(deploy.Refused, 'audit needs its explicit1131 decision'):
                    self.admit()

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
        self.assertIn('named Core PASS, migrations checked', train.said(result))
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

    def r3_migration_evidence(self, old_fail=True, new_fail=True, piece_fail=False, grouped=False):
        paths = ['tests/test_migrations.py']
        compared = {'files': paths, 'base': self.unit(self.base, node=False, names=paths, fail=old_fail),
                    'carry': self.unit(self.head, node=False, names=paths, fail=new_fail)}
        for side in ('base', 'carry'):
            run = json.loads(Path(compared[side]['path']).read_text())
            row = run['files'][0]
            row['stderr'] = self.raw(Path(row['stderr']['path']).read_text().replace(
                'test_behavior (test_core.Scratch)', 'test_chain (test_migrations.Scratch)'))
            compared[side] = self.raw(run)
        self.value['python_comparisons'] = [self.raw(compared)]
        own = self.unit(self.head, node=False, names=['tests/test_core.py'], fail=piece_fail)
        if grouped:
            own = self.grouped(self.head, False)
            capture = json.loads(Path(own['path']).read_text())
            row = capture['grouped']
            text = ('test_behavior (test_core.Scratch) ... %s\n'
                    'test_chain (test_migrations.Scratch) ... %s\n\nRan 2 tests in 0.01s\n\n' %
                    ('FAIL' if piece_fail else 'ok', 'FAIL' if new_fail else 'ok'))
            failures = int(piece_fail) + int(new_fail)
            row['stderr'] = self.raw(py(text + ('FAILED (failures=%d)\n' % failures if failures else 'OK\n')))
            row['counts'] = {'tests':2, 'status':'FAILED' if failures else 'OK'}
            if failures: row['counts']['failures'] = failures
            row['exit'] = int(bool(failures)); own = self.raw(capture)
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'], lambda d: d.update(run=own))
        self.bind_audit()

    def test_1131_r3_matching_migration_red_allows_passing_named_piece_tests(self):
        self.r3_migration_evidence()
        found = self.admit()['deterministic']['core_cohort']
        self.assertEqual(found['result'], 'PASS')
        self.assertEqual(found['counts']['tests'], 1)
        self.assertEqual(found['migration_evidence']['compared_against_live'], ['tests/test_migrations.py'])
        self.assertEqual(found['migration_evidence']['passed_on_carry'], [])

    def test_1131_r3_actual_grouped_capture_keeps_its_red_counts_and_piece_passes(self):
        self.r3_migration_evidence(grouped=True)
        found = self.admit()['deterministic']['core_cohort']
        self.assertEqual(found['counts']['tests'], 1)
        self.assertEqual(found['captured_counts'], {'tests':2, 'failures':1})
        self.assertEqual(found['migration_evidence']['compared_against_live'], ['tests/test_migrations.py'])

    def test_1131_r3_new_migration_failure_still_blocks_before_effects(self):
        self.r3_migration_evidence(old_fail=False)
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'): self.admit()

    def test_1131_r3_red_migration_without_comparison_is_not_waived(self):
        self.r3_migration_evidence(grouped=True)
        self.value.pop('python_comparisons'); self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'matching live comparison'): self.admit()

    def test_1131_r3_piece_failure_is_never_waived_by_migration_comparison(self):
        self.r3_migration_evidence(piece_fail=True, grouped=True)
        # Even a separate matched comparison of that same piece file does not
        # replace the requirement that its named carry cohort passed.
        paths = ['tests/test_core.py']
        self.value['python_comparisons'].append(self.raw({'files':paths,
            'base':self.unit(self.base,node=False,names=paths,fail=True),
            'carry':self.unit(self.head,node=False,names=paths,fail=True)}))
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'Core piece cohort is not PASS'): self.admit()

    def test_1131_r3_file_named_for_piece_and_migrations_must_still_pass(self):
        self.r3_migration_evidence(grouped=True)
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'],
            lambda d: d['pieces'][0]['tests'].append('tests/test_migrations.py'))
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'Core piece cohort is not PASS'): self.admit()

    def test_1131_r3_comparison_cannot_hide_a_missing_baseline_migration_case(self):
        self.r3_migration_evidence()
        pair = json.loads(Path(self.value['python_comparisons'][0]['path']).read_text())
        run = json.loads(Path(pair['carry']['path']).read_text())
        row = run['files'][0]; text = Path(row['stderr']['path']).read_text()
        row['stderr'] = self.raw(text.replace('test_chain', 'test_other_chain'))
        pair['carry'] = self.raw(run); self.value['python_comparisons'] = [self.raw(pair)]; self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'omits live file/case'): self.admit()

    def test_1131_r3_piece_file_with_no_executed_case_is_not_a_pass(self):
        self.r3_migration_evidence(grouped=True)
        run = json.loads(Path(json.loads(Path(self.value['core_cohort']['path']).read_text())['run']['path']).read_text())
        row = run['grouped']
        row.update(stderr=self.raw(py('test_chain (test_migrations.Scratch) ... FAIL\n\nRan 1 test in 0.01s\n\nFAILED (failures=1)\n')),
                   counts={'tests':1,'status':'FAILED','failures':1})
        self.value['core_cohort'] = self.change_document(self.value['core_cohort'], lambda d: d.update(run=self.raw(run)))
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'Core piece cohort is not PASS'): self.admit()

    def test_1131_r3_comparison_of_another_file_does_not_cover_migrations(self):
        self.r3_migration_evidence()
        paths = ['tests/test_core.py']
        self.value['python_comparisons'] = [self.raw({'files':paths,
            'base':self.unit(self.base,node=False,names=paths),
            'carry':self.unit(self.head,node=False,names=paths)})]
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'matching live comparison'): self.admit()

    def test_1131_r3_zero_or_incomplete_migration_comparison_never_passes(self):
        for mode in ('zero', 'cancelled', 'missing-terminal', 'missing-file'):
            self.r3_migration_evidence()
            pair = json.loads(Path(self.value['python_comparisons'][0]['path']).read_text())
            run = json.loads(Path(pair['carry']['path']).read_text())
            row = run['files'][0]
            if mode == 'zero':
                row.update(stderr=self.raw(py('Ran 0 tests in 0.01s\n\nOK\n')),
                           counts={'tests':0,'status':'OK'},exit=0)
            elif mode == 'cancelled':
                row['exit'] = -15
            elif mode == 'missing-terminal':
                row['stderr'] = self.raw('test_behavior (test_core.Scratch) ... FAIL\n')
            else:
                run['files'] = []
            pair['carry'] = self.raw(run); self.value['python_comparisons'] = [self.raw(pair)]; self.bind_audit()
            with self.subTest(mode=mode), self.assertRaises(deploy.Refused): self.admit()

    def test_1131_r3_newly_failed_file_is_not_waived_by_matching_failure_total(self):
        self.r3_migration_evidence()
        names = ['tests/test_migrations.py','tests/test_core.py']
        old = json.loads(Path(self.unit(self.base,node=False,names=names)['path']).read_text())
        new = json.loads(Path(self.unit(self.head,node=False,names=names)['path']).read_text())
        old['files'][0] = json.loads(Path(self.unit(self.base,node=False,names=names[:1],fail=True)['path']).read_text())['files'][0]
        new['files'][1] = json.loads(Path(self.unit(self.head,node=False,names=names[1:],fail=True)['path']).read_text())['files'][0]
        self.value['python_comparisons'] = [self.raw({'files':names,'base':self.raw(old),'carry':self.raw(new)})]
        self.bind_audit()
        with self.assertRaisesRegex(deploy.Refused, 'newly failing'): self.admit()

    def test_1131_r3_grouped_comparison_must_observe_each_required_file_on_both_sides(self):
        for omitted in (('base', 'carry'), ('base',), ('carry',)):
            with self.subTest(omitted=omitted):
                self.r3_migration_evidence()
                pair = {'files':['tests/test_core.py', 'tests/test_migrations.py']}
                for side, head in (('base', self.base), ('carry', self.head)):
                    run = json.loads(Path(self.grouped(head, False)['path']).read_text())
                    if side in omitted:
                        run['grouped'].update(stderr=self.raw(py(
                            'test_behavior (test_core.Scratch) ... ok\n\nRan 1 test in 0.01s\n\nOK\n')),
                            counts={'tests':1, 'status':'OK'})
                    pair[side] = self.raw(run)
                self.value['python_comparisons'] = [self.raw(pair)]; self.bind_audit()
                with self.assertRaises(deploy.Refused): self.admit()

    def test_1131_r3_mixed_core_migration_outcomes_must_match_live_baseline(self):
        for mode in ('new-failure', 'new-class', 'new-skip', 'missing-case',
                     'extra-failure-multiplicity', 'unobserved-file'):
            with self.subTest(mode=mode):
                self.r3_migration_evidence(grouped=True)
                cohort = json.loads(Path(self.value['core_cohort']['path']).read_text())
                run = json.loads(Path(cohort['run']['path']).read_text())
                cases = ['test_behavior (test_core.Scratch) ... ok',
                         'test_chain (test_migrations.Scratch) ... FAIL']
                failures, skipped = 1, 0
                reason = 'newly failing'
                if mode in ('new-failure', 'new-class'):
                    cases[1] = cases[1].replace('FAIL', 'ok')
                    cases.append('test_other (test_migrations.Scratch) ... FAIL' if mode == 'new-failure'
                                 else 'test_chain (test_migrations.Other) ... FAIL')
                elif mode == 'new-skip':
                    cases.append("test_other (test_migrations.Scratch) ... skipped 'not executed'")
                    skipped = 1; reason = 'adds skipped'
                elif mode == 'missing-case':
                    cases[1] = cases[1].replace('test_chain', 'test_other')
                    reason = 'omits live file/case'
                elif mode == 'extra-failure-multiplicity':
                    cases.append(cases[1]); failures = 2
                else:
                    cases = cases[:1]; failures = 0; reason = 'no observed case'
                counts = {'tests':len(cases), 'status':'FAILED' if failures else 'OK'}
                if failures: counts['failures'] = failures
                if skipped: counts['skipped'] = skipped
                summary = ('FAILED (failures=%d%s)' % (failures, ', skipped=1' if skipped else '')
                           if failures else 'OK')
                run['grouped'].update(stderr=self.raw(py('\n'.join(cases) +
                    '\n\nRan %d tests in 0.01s\n\n%s\n' % (len(cases), summary))),
                    counts=counts, exit=int(bool(failures)))
                cohort['run'] = self.raw(run); self.value['core_cohort'] = self.raw(cohort); self.bind_audit()
                with self.assertRaisesRegex(deploy.Refused, reason): self.admit()

    def subtest_migration_evidence(self, base_steps, carry_steps):
        """Item 1389: test_chain's subTests fail on both sides; its method outcome comes only from their detail events."""
        self.r3_migration_evidence()
        pair = json.loads(Path(self.value['python_comparisons'][0]['path']).read_text())
        for side, steps in (('base', base_steps), ('carry', carry_steps)):
            run = json.loads(Path(pair[side]['path']).read_text())
            details = ''.join("%s\nFAIL: test_chain (test_migrations.Scratch) (step='%s')\n%s\n"
                              "Traceback (most recent call last):\nAssertionError: scratch\n\n" % ('=' * 70, step, '-' * 70)
                              for step in steps)
            run['files'][0].update(stderr=self.raw('test_chain (test_migrations.Scratch) ... \n\n' + details + '-' * 70 +
                                                   '\nRan 1 test in 0.01s\n\nFAILED (failures=%d)\n' % len(steps)),
                                   counts={'tests': 1, 'status': 'FAILED', 'failures': len(steps)}, exit=1)
            pair[side] = self.raw(run)
        self.value['python_comparisons'] = [self.raw(pair)]; self.bind_audit()

    def test_1389_same_subtest_failures_under_a_failing_parent_are_not_new(self):
        self.subtest_migration_evidence(['a', 'b'], ['b', 'a'])
        self.assertEqual(self.admit()['deterministic']['core_cohort']['result'], 'PASS')

    def test_1389_changed_subtest_failure_with_equal_totals_refuses(self):
        for carry in (['a', 'c'], ['a', 'a']):
            with self.subTest(carry=carry):
                self.subtest_migration_evidence(['a', 'b'], carry)
                with self.assertRaisesRegex(deploy.Refused, 'subtest failure is new or changed'): self.admit()

    def test_1389_unit_run_keeps_method_outcomes_apart_from_events(self):
        self.subtest_migration_evidence(['a', 'b'], ['a', 'b'])
        pair = json.loads(Path(self.value['python_comparisons'][0]['path']).read_text())
        run = proof.unit_run(pair['carry'], self.git, self.head, node=False, expected=['tests/test_migrations.py'])
        identity = ('tests/test_migrations.py', None, 'test_chain (test_migrations.Scratch)')
        self.assertEqual(run['failures'], {identity: 1})
        self.assertEqual(run['events'], {('tests/test_migrations.py', 'test_chain (test_migrations.Scratch)', "(step='%s')" % s, 'FAIL'): 1
                                         for s in 'ab'})
        self.assertEqual(run['counts'], {'tests': 1, 'failures': 2})

    def test_1131_r4_complete_train_prepares_and_verifies_release_record(self):
        self.r3_migration_evidence(grouped=True)
        deterministic = self.admit()['deterministic']
        captured = {'file':str(self.root/'train.json'), 'pr':1, 'kind':'judged-first',
                    'merge_commit':self.head, 'merged_tree':self.tree, 'release_branch':'release/scratch',
                    'items':[{'item':1131, 'approved_head':self.source, 'review':'scratch independent review'}],
                    'hosted_run':None, 'judgment':self.value, 'deterministic':deterministic}
        measured = releases.train_measurements(captured)
        original = copy.deepcopy(measured)
        folder = (self.root/'record-evidence').resolve(); folder.mkdir(mode=0o700)
        record = {'release':2, 'commit':self.head, 'previous':self.base, 'items':[1131],
                  'source':'deploy', 'measurements':measured}
        prepared = releases.prepare_record(record, folder)
        row = dict(prepared, evidence=str(folder), deployed_at='2026-11-23T00:00:00+00:00')
        self.assertEqual(releases.verify_record(row, folder), original)
        self.assertEqual(measured, original)
        projected = row['measurements']['train']
        self.assertEqual(projected['judge_receipts_sha256'], {
            'deterministic':proof.evidence_digest(self.value), 'audit':releases.digest(self.value['audit'])})
        self.assertEqual(projected['judgment'], self.value)
        self.assertNotIn('producer_runs', projected['judgment'])
        self.assertNotIn('verdict_checks', projected['judgment'])
        self.assertEqual(projected['deterministic']['core_cohort']['captured_counts'],
                         {'tests':2, 'failures':1})
        # Mutate the actual scratch record projection, then restore its exact
        # serialized bytes. The full canonical measurement artifact stays fixed.
        path = self.root/'release-record.json'
        saved = json.dumps(row, sort_keys=True).encode(); path.write_bytes(saved)
        for field in ('evidence-digest', 'audit-message', 'audit-revision'):
            changed = json.loads(saved)
            if field == 'evidence-digest':
                changed['measurements']['train']['judge_receipts_sha256']['deterministic'] = '0'*64
            elif field == 'audit-message':
                changed['measurements']['train']['judgment']['audit']['message'] = 'm-'+'b'*32
            else:
                changed['measurements']['train']['judgment']['audit']['revision'] += 1
            path.write_text(json.dumps(changed))
            try:
                with self.subTest(field=field):
                    with self.assertRaisesRegex(train.Refused, 'projection differs') as caught:
                        releases.verify_record(json.loads(path.read_bytes()), folder)
                    print('R4 record mutation refused:', field, str(caught.exception))
            finally:
                path.write_bytes(saved)
            self.assertEqual(path.read_bytes(), saved)
            self.assertEqual(releases.verify_record(json.loads(path.read_bytes()), folder), original)


if __name__ == '__main__':
    unittest.main()

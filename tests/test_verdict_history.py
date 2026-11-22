from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('history_controller', ROOT / 'tools/ci_known_reds.py')
CONTROLLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROLLER)


class VerdictHistoryCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'candidate'
        self.repo.mkdir()
        self.git('init', '-q')
        (self.repo / 'tools').mkdir()
        (self.repo / 'tools/release_check.py').write_text(
            "NATIVE_STEPS = (NativeStep('reader','tests/reader.mjs',(),'native.json'),)\n"
            "REQUIRED = ('python-units','node-units','native-reader')\n")
        (self.repo / 'tests').mkdir()
        (self.repo / 'tests/reader.mjs').write_text('fixture native harness\n')
        (self.repo / '.github/workflows').mkdir(parents=True)
        (self.repo / '.github/workflows/checks.yml').write_text('fixture producer\n')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'catalog')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.required = ['python-units', 'node-units', 'native-reader']

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo)] + list(args), check=True, capture_output=True, text=True).stdout

    def summary(self, missing=()):
        return {'tool': 'theseus-release-check', 'commit': self.sha, 'required': self.required,
                'tree_unchanged': True, 'tree_after': {'head': self.sha, 'changes': ''}, 'passed': False, 'combined_from': [],
                'steps': [{'name': name} for name in self.required if name not in missing]}

    def select(self, summaries, corrupt=False, expired=False, digest_override='valid', provenance_change=None):
        history = self.root / 'history'
        producer = self.root / 'producer.json'
        producer.write_text(json.dumps({'producer': {'created_at': '2026-11-15T06:00:00Z', 'run_id': '99'},
                                       'merge': {'sha': self.sha}}))
        refusals = self.root / 'refusals'
        refusals.write_text('')
        runs, archives = [], {}
        for index, summary in enumerate(summaries):
            run_id = index + 1
            runs.append({'id': run_id, 'run_attempt': 1, 'head_sha': self.sha, 'head_branch': 'release/live73',
                         'event': 'push', 'status': 'completed', 'conclusion': 'failure', 'workflow_id': 123,
                         'path': '.github/workflows/checks.yml', 'head_repository': {'full_name': 'org/repo'},
                         'created_at': '2026-11-15T05:%02d:00Z' % (50-index), 'html_url': 'run/%d' % run_id})
            data = io.BytesIO()
            provenance = {'run': {'id': run_id, 'attempt': 1, 'workflow': 'Checks', 'event': 'push',
                                  'repository': 'org/repo', 'workflow_sha': self.sha,
                                  'workflow_ref': 'org/repo/.github/workflows/checks.yml@refs/heads/release/live73'},
                          'base': {'ref': None, 'sha': None}, 'head': {'ref': 'refs/heads/release/live73', 'sha': self.sha},
                          'merge': {'sha': self.sha, 'tree': self.git('rev-parse', 'HEAD^{tree}').strip(),
                                    'first_parent': None, 'second_parent': None},
                          'checked': {'commit': self.sha, 'tree_unchanged': True}, 'required': self.required,
                          'plan': [{'steps': self.required}], 'shards': []}
            if provenance_change:
                provenance_change(provenance)
            with zipfile.ZipFile(data, 'w') as zipped:
                zipped.writestr('summary.json', json.dumps(summary))
                zipped.writestr('provenance.json', json.dumps(provenance))
            archives[run_id] = data.getvalue()
        calls = []
        original_run = subprocess.run

        def api_run(command, **kwargs):
            if command[:2] != ['gh', 'api']:
                return original_run(command, **kwargs)
            endpoint = command[2]
            calls.append(endpoint)
            if '/git/ref/' in endpoint:
                value = {'object': {'sha': self.sha}}
            elif '/workflows/' in endpoint:
                value = {'total_count': len(runs), 'workflow_runs': runs}
            elif endpoint.endswith('/zip'):
                run_id = int(endpoint.split('/')[-2])
                return subprocess.CompletedProcess(command, 0, archives[run_id], b'')
            else:
                run_id = int(endpoint.split('/runs/')[1].split('/')[0])
                value = {'total_count': 1, 'artifacts': [{'id': run_id, 'name': 'release-check',
                         'size_in_bytes': len(archives[run_id]), 'expired': expired and run_id == 1,
                         'digest': ('sha256:' + ('0'*64 if corrupt and run_id == 1 else hashlib.sha256(archives[run_id]).hexdigest()))
                                   if digest_override == 'valid' else digest_override}]}
            return subprocess.CompletedProcess(command, 0, json.dumps(value).encode(), b'')

        workflow = (ROOT / '.github/workflows/verdict.yml').read_text()
        section = workflow.split("      - name: The base's last three runs, by GitHub's record\n", 1)[1]
        script = textwrap.dedent(section.split("<<'PY' >> \"$GITHUB_OUTPUT\"\n", 1)[1].split('          PY\n', 1)[0])
        argv = ['selector', str(history), str(producer), str(refusals), str(self.repo), str(ROOT / 'tools/ci_known_reds.py')]
        env = dict(os.environ, GITHUB_REPOSITORY='org/repo', BASE_REF='release/live73',
                   PRODUCER_WORKFLOW_ID='123', PRODUCER_WORKFLOW_PATH='.github/workflows/checks.yml')
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, env), patch.object(subprocess, 'run', api_run), redirect_stdout(io.StringIO()):
            try:
                exec(compile(script, '<protected history selector>', 'exec'), {})
            except SystemExit as error:
                self.assertEqual(error.code, 0)
        manifest = history / 'known-runs.json'
        return json.loads(manifest.read_text()) if manifest.exists() else None, refusals.read_text(), calls

    def test_incomplete_history_is_named_and_older_run_fills_only_missing_step(self):
        manifest, refusal, calls = self.select([self.summary(['native-reader']), self.summary(), self.summary(), self.summary()])
        self.assertEqual([r['id'] for r in manifest['runs']], [1, 2, 3, 4])
        self.assertEqual(manifest['step_runs'], {'python-units': [1, 2, 3], 'node-units': [1, 2, 3],
                                               'native-reader': [2, 3, 4]})
        self.assertFalse(manifest['fewer_than_three'])
        self.assertEqual(manifest['dropped'][0]['id'], 1)
        self.assertEqual(manifest['dropped'][0]['missing_steps'], ['native-reader'])
        self.assertIn('native-reader', manifest['dropped'][0]['why'])
        self.assertIn('/runs/4/artifacts', '\n'.join(calls))
        self.assertEqual(refusal, '')

    def test_three_complete_runs_remain(self):
        manifest, refusal, _ = self.select([self.summary()] * 3)
        self.assertEqual(len(manifest['runs']), 3)
        self.assertFalse(manifest['fewer_than_three'])
        self.assertEqual(manifest['dropped'], [])
        self.assertEqual(refusal, '')

    def test_controller_readiness_is_required_before_loading_code(self):
        section = (ROOT / '.github/workflows/verdict.yml').read_text().split(
            "      - name: The base's last three runs, by GitHub's record\n", 1)[1].split('        shell:', 1)[0]
        self.assertIn("if: steps.merge.outputs.ready == 'true' && steps.controller.outputs.ready == 'true'", section)

    def test_missing_digest_refuses_before_download(self):
        manifest, refusal, calls = self.select([self.summary(['native-reader'])], digest_override=None)
        self.assertIsNone(manifest)
        self.assertIn('lacks a valid GitHub SHA-256 digest', refusal)
        self.assertFalse(any(call.endswith('/zip') for call in calls))

    def test_unsupported_digest_refuses_before_download(self):
        manifest, refusal, calls = self.select([self.summary(['native-reader'])], digest_override='sha512:'+'a'*128)
        self.assertIsNone(manifest)
        self.assertIn('lacks a valid GitHub SHA-256 digest', refusal)
        self.assertFalse(any(call.endswith('/zip') for call in calls))

    def test_short_sha256_digest_refuses_before_download(self):
        manifest, refusal, _ = self.select([self.summary(['native-reader'])], digest_override='sha256:abc')
        self.assertIsNone(manifest)
        self.assertIn('lacks a valid GitHub SHA-256 digest', refusal)

    def test_digest_failure_is_not_an_incomplete_history_drop(self):
        manifest, refusal, _ = self.select([self.summary(['native-reader'])], corrupt=True)
        self.assertIsNone(manifest)
        self.assertIn('does not match the digest', refusal)

    def test_malformed_receipt_is_not_an_incomplete_history_drop(self):
        summary = self.summary(['native-reader'])
        summary['commit'] = '0' * 40
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('wrong history combined source', refusal)

    def test_history_cannot_shrink_its_declared_plan(self):
        summary = self.summary(['native-reader'])
        summary['required'] = summary['required'][:-1]
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('history summary plan differs from source', refusal)

    def test_object_steps_are_malformed_not_history_loss(self):
        summary = self.summary()
        summary['steps'] = {}
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('invalid history steps', refusal)

    def test_dirty_history_is_not_dropped(self):
        summary = self.summary(['native-reader'])
        summary['tree_after']['changes'] = 'M tests/reader.mjs'
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('dirty history combined source', refusal)

    def test_focused_history_is_not_dropped(self):
        summary = self.summary(['native-reader'])
        summary['only'] = ['python-units', 'node-units']
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('focused or skipped history aggregate', refusal)

    def test_misbound_history_run_is_not_dropped(self):
        manifest, refusal, _ = self.select([self.summary(['native-reader'])],
                                         provenance_change=lambda p: p['run'].update(id=999))
        self.assertIsNone(manifest)
        self.assertIn('wrong producer run or attempt', refusal)

    def test_misbound_history_head_is_not_dropped(self):
        manifest, refusal, _ = self.select([self.summary(['native-reader'])],
                                         provenance_change=lambda p: p['head'].update(sha='0'*40))
        self.assertIsNone(manifest)
        self.assertIn('history provenance source differs from API', refusal)

    def test_dirty_history_provenance_is_not_dropped(self):
        manifest, refusal, _ = self.select([self.summary(['native-reader'])],
                                         provenance_change=lambda p: p['checked'].update(tree_unchanged=False))
        self.assertIsNone(manifest)
        self.assertIn('dirty history provenance', refusal)

    def test_duplicate_history_steps_are_not_a_missing_step_drop(self):
        summary = self.summary(['native-reader'])
        summary['steps'].append(summary['steps'][0])
        manifest, refusal, _ = self.select([summary])
        self.assertIsNone(manifest)
        self.assertIn('duplicate history combined steps', refusal)

    def test_expiry_still_drops_without_downloading(self):
        manifest, refusal, calls = self.select([self.summary(), self.summary()], expired=True)
        self.assertEqual([r['id'] for r in manifest['runs']], [2])
        self.assertEqual(manifest['dropped'][0]['why'], 'artifact expired')
        self.assertNotIn('repos/org/repo/actions/artifacts/1/zip', calls)
        self.assertEqual(refusal, '')

    def test_candidate_with_the_same_omission_still_refuses(self):
        summary = self.summary(['native-reader'])
        summary.update(tree_unchanged=True, tree_after={'head': self.sha, 'changes': ''})
        run = {'id': 99, 'attempt': 1, 'workflow': 'Checks', 'event': 'push', 'repository': 'org/repo'}
        base, merge = {'ref': None, 'sha': None}, {'sha': self.sha}
        provenance = {'run': run, 'base': base, 'merge': merge, 'checked': {'commit': self.sha, 'tree_unchanged': True},
                      'required': self.required}
        summary_path, provenance_path = self.root / 'summary.json', self.root / 'provenance.json'
        summary_path.write_text(json.dumps(summary))
        provenance_path.write_text(json.dumps(provenance))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'missing required step'):
            CONTROLLER.read_evidence(summary_path, provenance_path, self.root / 'shards', self.repo, self.sha, run, base, merge)

    def reader_bundle(self, history, combined='absent', shard='absent'):
        """Complete raw evidence exercises the same reader used for current runs and known_base_failures."""
        folder = self.root / ('bundle-%d' % len(list(self.root.glob('bundle-*'))))
        out = folder / 'shards/check-0'
        native = out / 'native/reader'
        native.mkdir(parents=True)
        report = {'results': [{'name': 'fixture case', 'passed': True}], 'browserClosed': True,
                  'fixtureExitCode': 0, 'fixtureExitSignal': None}
        (native / 'native.json').write_text(json.dumps(report))
        logs = {'python-units': 'test_one (fixture.Test) ... ok\nRan 1 test in 0.01s\nOK\n',
                'node-units': '# Subtest: node\nok 1 - node\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n',
                'native-reader': 'fixture case passed\n'}
        steps = []
        for name, log in logs.items():
            (out / (name+'.log')).write_text(log)
            counts, _ = (CONTROLLER.python_counts(log) if name == 'python-units' else
                         CONTROLLER.node_counts(log) if name == 'node-units' else
                         CONTROLLER.native_counts(CONTROLLER.NativeStep('reader', 'tests/reader.mjs', (), 'native.json'), native))
            steps.append({'name': name, 'passed': True, 'exit': 0, 'counts': counts})
        profile = {name: 'fixture' for name in CONTROLLER.PROFILE_FIELDS}
        tools = {'release_check': CONTROLLER.blob(CONTROLLER.source(self.repo, self.sha, 'tools/release_check.py')),
                 'harnesses': {'tests/reader.mjs': CONTROLLER.blob(CONTROLLER.source(self.repo, self.sha, 'tests/reader.mjs'))},
                 **{name: profile[name] for name in ('python', 'node', 'chrome')}}
        summary = self.summary()
        summary.update(steps=steps, passed=True, failed=[], combined_from=['check-0/summary.json'], tools=tools, checkout='/fixture')
        raw = dict(summary, only=self.required)
        (out / 'summary.json').write_text(json.dumps(raw))
        run = {'id': 7, 'attempt': 1, 'workflow': 'Checks', 'event': 'push', 'repository': 'org/repo'}
        base, head = {'ref': None, 'sha': None}, {'ref': 'refs/heads/release/live73', 'sha': self.sha}
        merge = {'sha': self.sha, 'tree': self.git('rev-parse', 'HEAD^{tree}').strip(), 'first_parent': None, 'second_parent': None}
        receipt = {'run': dict(run, workflow_sha=self.sha, workflow_ref='org/repo/.github/workflows/checks.yml@refs/heads/release/live73'),
                   'base': base, 'head': head, 'merge': merge, 'profile': profile, 'shard': {'steps': self.required},
                   'summary_sha256': hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()}
        if shard != 'absent':
            receipt['base_at_run'] = shard
        (out / 'run.json').write_text(json.dumps(receipt))
        provenance = {'run': receipt['run'], 'base': base, 'head': head, 'merge': merge,
                      'checked': {'commit': self.sha, 'tree_unchanged': True}, 'required': self.required,
                      'plan': [{'steps': self.required}], 'shards': [{'artifact': 'check-0', 'receipt': receipt,
                      'commit': self.sha, 'tree_unchanged': True, 'tools': tools, 'steps': self.required}]}
        if combined != 'absent':
            provenance['base_at_run'] = combined
        sp, pp = folder / 'summary.json', folder / 'provenance.json'
        sp.write_text(json.dumps(summary))
        pp.write_text(json.dumps(provenance))
        binding = None if history else {'producer': {'event': 'push', 'head_branch': 'release/live73', 'head_sha': self.sha},
                                       'controller': {'repository': 'org/repo'}}
        return CONTROLLER.read_evidence(sp, pp, folder / 'shards', self.repo, self.sha, run, base, merge, binding, history=history)

    def test_current_and_history_keep_genuine_legacy_push_eligible(self):
        for history in (False, True):
            with self.subTest(history=history):
                observed, _ = self.reader_bundle(history)
                self.assertEqual(len(observed), 1)

    def test_current_and_history_accept_explicit_null_push_format(self):
        for history in (False, True):
            with self.subTest(history=history):
                observed, _ = self.reader_bundle(history, None, None)
                self.assertEqual(len(observed), 1)

    def test_current_and_history_refuse_combined_null_with_legacy_shard(self):
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(CONTROLLER.Refused, 'receipt format'):
                self.reader_bundle(history, None, 'absent')

    def test_current_and_history_refuse_legacy_combined_with_null_shard(self):
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(CONTROLLER.Refused, 'receipt format'):
                self.reader_bundle(history, 'absent', None)

    def test_current_and_history_refuse_nonnull_push_observation(self):
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(CONTROLLER.Refused, 'combined git-read base'):
                self.reader_bundle(history, {'sha': self.sha}, {'sha': self.sha})

    def test_incomplete_history_format_is_checked_before_drop(self):
        summary = self.summary(['native-reader'])
        summary['combined_from'] = ['check-0/summary.json']
        def mismatched(provenance):
            provenance['base_at_run'] = None
            provenance['shards'] = [{'artifact': 'check-0', 'receipt': {k: provenance[k] for k in ('run', 'base', 'head', 'merge')}}]
        manifest, refusal, _ = self.select([summary], provenance_change=mismatched)
        self.assertIsNone(manifest)
        self.assertIn('inconsistent git-read base receipt format', refusal)

    def test_incomplete_new_push_history_retains_other_step_controls(self):
        summary = self.summary(['native-reader'])
        summary['combined_from'] = ['check-0/summary.json']
        def explicit_null(provenance):
            provenance['base_at_run'] = None
            receipt = {k: provenance[k] for k in ('run', 'base', 'head', 'merge')}
            receipt['base_at_run'] = None
            provenance['shards'] = [{'artifact': 'check-0', 'receipt': receipt}]
        manifest, refusal, _ = self.select([summary], provenance_change=explicit_null)
        self.assertEqual([r['id'] for r in manifest['runs']], [1])
        self.assertEqual(manifest['runs'][0]['steps'], ['node-units', 'python-units'])
        self.assertEqual(manifest['step_runs'], {'python-units': [1], 'node-units': [1], 'native-reader': []})
        self.assertEqual(manifest['dropped'][0]['missing_steps'], ['native-reader'])
        self.assertEqual(refusal, '')


if __name__ == '__main__':
    unittest.main()

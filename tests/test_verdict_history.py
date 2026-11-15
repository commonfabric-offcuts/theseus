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
        producer.write_text(json.dumps({'producer': {'created_at': '2026-11-15T06:00:00Z', 'run_id': '99'}}))
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

    def test_incomplete_selected_history_is_named_and_not_replaced(self):
        manifest, refusal, calls = self.select([self.summary(['native-reader']), self.summary(), self.summary(), self.summary()])
        self.assertEqual([r['id'] for r in manifest['runs']], [2, 3])
        self.assertTrue(manifest['fewer_than_three'])
        self.assertEqual(manifest['dropped'][0]['id'], 1)
        self.assertEqual(manifest['dropped'][0]['missing_steps'], ['native-reader'])
        self.assertIn('native-reader', manifest['dropped'][0]['why'])
        self.assertNotIn('/runs/4/artifacts', '\n'.join(calls))
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


if __name__ == '__main__':
    unittest.main()

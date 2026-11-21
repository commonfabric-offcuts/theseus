from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from tools import unit_shards as check_plan, ci_known_reds as ci, release_check, ci_input_reads
import test_tools_release_check as fixtures

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/checks.yml'


def names(result):
    return (['python-units'] if any(j.get('python_shard') for j in result['shards']) else []) + [
        name for job in result['shards'] if not job.get('python_shard') for name in job['steps'].split(',')]


class Plan(unittest.TestCase):
    """Synthetic committed inputs; no step, server or native case is executed."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name); self.root = self.folder / 'repo'
        self.root.mkdir()
        subprocess.run(['git', '-C', str(self.root), 'init', '-q'], check=True, capture_output=True)
        files = {path: (ROOT / path).read_text() for path in (
            'tools/release_check.py', 'tools/unit_shards.py', 'tools/steps_for.py',
            'tools/ci_input_reads.py', '.github/check-weights.json')}
        files['tools/ci-input-reads.json'] = '{}'
        files.update({path: '// synthetic harness\n' for path in release_check.harnesses()})
        files['tests/only.test.mjs'] = 'export const x = 1;\n'
        files['web/app.mjs'] = 'export const x = 1;\n'
        files['.gitignore'] = '__pycache__/\n'
        self.base = fixtures.commit_files(self.root, files)
        self.change({'tests/only.test.mjs': 'export const x = 2;\n'})

    def change(self, files):
        subprocess.run(['git', '-C', str(self.root), 'checkout', '-q', '--detach', self.base], check=True, capture_output=True)
        self.head = fixtures.commit_files(self.root, files)
        self.event = {'pull_request': {'base': {'sha': self.base}, 'head': {'sha': self.head}}}

    def plan(self, event_name='pull_request'):
        return check_plan.plan(self.root, event_name, self.event, self.head, 2)

    def test_only_computed_readers_run_and_all_omissions_have_proof(self):
        result = self.plan()
        self.assertCountEqual(names(result), ci_input_reads.MANDATORY)
        self.assertEqual(len(result['shards']), 7)
        scope = result['scoped']; self.assertEqual(scope['version'], 2)
        self.assertEqual(scope, ci_input_reads.pr_record(self.root, self.base, self.head))
        for step in scope['not_run']:
            self.assertEqual(scope['coverage'][step]['changed_inputs'], [])
        self.assertEqual(ci.scoped_required({'scoped': scope}, {'event': 'pull_request'}, {'sha': self.base},
                                           self.root, self.head, release_check.REQUIRED), set(ci_input_reads.MANDATORY))
        with self.assertRaises(ci.Refused):
            ci.scoped_required({'scoped': dict(scope, steps=[])}, {'event': 'push'}, {'sha': self.base}, self.root, self.head, release_check.REQUIRED)

    def test_product_and_declarations_are_conservative_and_have_real_inputs(self):
        for files in ({'web/app.mjs': 'export const x = 3;\n'}, {'tools/ci-input-reads.json': '{}\n'}):
            self.change(files); result = self.plan()
            self.assertCountEqual(names(result), release_check.REQUIRED)
            self.assertIsNotNone(result['scoped'])
            self.assertEqual(result['scoped']['not_run'], [])

    def test_unknown_or_undeclared_changes_fall_back_to_full(self):
        for files in ({'unknown.txt': 'unknown'}, {'tests/only.test.mjs': 'readFileSync(dynamic);'}):
            self.change(files); result = self.plan()
            self.assertIsNone(result['scoped']); self.assertCountEqual(names(result), release_check.REQUIRED)
            self.assertIn('scope unavailable', result['why'])

    def test_non_pr_missing_events_moved_base_and_unreadable_rules_fall_closed(self):
        for event_name in ('push', 'workflow_dispatch', 'schedule'):
            result = self.plan(event_name); self.assertIsNone(result['scoped'])
            self.assertCountEqual(names(result), release_check.REQUIRED)
        for event in ({}, {'pull_request': {'base': {'sha': 'f' * 40}}}):
            self.event = event; self.assertIsNone(self.plan()['scoped'])
        self.change({'tests/only.test.mjs': 'export const x = 3;\n'})
        self.head = self.base; self.assertIsNone(self.plan()['scoped'])
        with mock.patch.object(ci_input_reads, 'pr_record', side_effect=ci_input_reads.Refused('incomplete graph')):
            self.assertIsNone(self.plan()['scoped'])
        # The legacy local small-fix bound is still a separate supported format.
        self.assertTrue(release_check.small_fix_problems(['docs/%d.md' % n for n in range(6)]))

    def workflow(self, event_name='pull_request'):
        event = self.folder / 'event.json'; event.write_text(json.dumps(self.event))
        output = self.folder / 'output'; output.write_text('')
        section = WORKFLOW.read_text().split('      - id: plan\n', 1)[1].split('\n  check:', 1)[0]
        import textwrap
        command = textwrap.dedent(section.split('        run: |\n', 1)[1])
        env = {'PATH': str(Path(sys.executable).parent) + os.pathsep + os.defpath,
               'GITHUB_EVENT_NAME': event_name, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_SHA': self.head,
               'BROWSER_SHARDS': '2', 'GITHUB_OUTPUT': str(output)}
        result = subprocess.run(['bash', '-c', command], cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        lines = output.read_text().splitlines(); self.assertEqual(len(lines), 2)
        fields = dict(line.split('=', 1) for line in lines); self.assertEqual(set(fields), {'shards', 'scoped'})
        return {k: json.loads(v) for k, v in fields.items()}, result.stderr.strip()

    def test_actual_workflow_shell_reads_event_and_transports_complete_proof(self):
        result, why = self.workflow()
        self.assertEqual(result, {k: self.plan()[k] for k in ('shards', 'scoped')})
        self.assertEqual(why, result['scoped']['why'])
        full, _ = self.workflow('push'); self.assertIsNone(full['scoped'])
        self.assertCountEqual(names(full), release_check.REQUIRED)
        self.assertIn('PLAN_SCOPE: ${{ needs.plan.outputs.scoped }}', WORKFLOW.read_text())

    def test_command_flags_override_github_defaults(self):
        event = self.folder / 'event.json'; event.write_text(json.dumps(self.event))
        result = subprocess.run([sys.executable, '-I', '-B', 'tools/unit_shards.py', '--plan', '--event-name', 'pull_request',
                                 '--event', str(event), '--head', self.head, '--browser-shards', '2'],
                                cwd=self.root, env={'PATH': os.defpath, 'GITHUB_EVENT_NAME': 'push'}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), self.plan())

    def test_workflow_combiner_keeps_scope_and_refuses_missing_mandatory_job(self):
        import contextlib, hashlib, io, textwrap
        result = self.plan(); scoped = result['scoped']
        template = fixtures.scoped_summary(self.head, self.base, [], scoped['changed'])
        by_name = {step['name']: step for step in template['steps']}
        shards = self.folder / 'shards'
        merge = {'sha': self.head, 'tree': 'synthetic-tree', 'first_parent': self.base, 'second_parent': self.head}
        for index, job in enumerate(result['shards']):
            folder = shards / ('check-%d' % index); folder.mkdir(parents=True)
            steps = [copy.deepcopy(by_name[name]) for name in job['steps'].split(',')]
            raw = dict(template, steps=steps, only=[s['name'] for s in steps], started_at='2026-11-17T00:00:00Z',
                       finished_at='2026-11-17T00:01:00Z', tree_after={'head': self.head, 'changes': ''})
            raw.pop('scoped')
            if job.get('python_shard'):
                part, total = map(int, job['python_shard'].split('/'))
                raw['python_shard'] = {'index': part, 'total': total, 'files': job['files']}
                steps[0]['counts'] = {'tests': 1, 'status': 'OK'}
            data = json.dumps(raw).encode(); (folder / 'summary.json').write_bytes(data)
            receipt = {'run': {'id': '1', 'attempt': '1'}, 'merge': merge, 'shard': {'name': job['name']},
                       'summary_sha256': hashlib.sha256(data).hexdigest(), 'base_at_run': {'ref': 'release/live73', 'sha': self.base}}
            (folder / 'run.json').write_text(json.dumps(receipt))
        section = WORKFLOW.read_text().split("      - name: Fold the shards' summaries into one\n", 1)[1]
        script = textwrap.dedent(section.split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])
        out = self.folder / 'combined'; out.mkdir()
        env = {'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': self.head,
               'GITHUB_EVENT_NAME': 'pull_request', 'BASE_REF': 'release/live73', 'BASE_SHA': self.base,
               'PLAN_SCOPE': json.dumps(scoped), 'PLAN_SHARDS': json.dumps(result['shards'])}
        def fold(expected):
            with mock.patch.dict(os.environ, env), mock.patch.object(sys, 'argv', ['-', str(shards), str(out/'summary.json')]), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit:
                    exec(compile(script, str(WORKFLOW), 'exec'), {})
                self.assertEqual(exit.exception.code, expected)
        fold(0)
        combined = json.loads((out/'summary.json').read_text())
        self.assertEqual(combined['scoped'], scoped)
        self.assertTrue(combined['passed'])
        self.assertCountEqual([s['name'] for s in combined['steps']], ci_input_reads.MANDATORY)
        (shards/'check-0'/'summary.json').unlink(); (shards/'check-0'/'run.json').unlink(); (shards/'check-0').rmdir()
        fold(1)
        self.assertFalse(json.loads((out/'summary.json').read_text())['passed'])



if __name__ == '__main__':
    unittest.main()

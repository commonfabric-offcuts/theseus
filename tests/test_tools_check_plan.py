from __future__ import annotations

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock

from tools import release_check
import test_tools_release_check as fixtures

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/checks.yml'


def plan(root, event_name, event, head):
    # Run release 89's actual inline dealer before the helper exists: this red
    # shows all 52 being dealt, rather than failing on a missing module.
    try:
        from tools import check_plan
    except ImportError:
        source = WORKFLOW.read_text().split("<<'PY' >>", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0]
        with mock.patch.object(sys, 'argv', ['-', '3']), contextlib.redirect_stdout(io.StringIO()) as out:
            exec(compile(textwrap.dedent(source), str(WORKFLOW), 'exec'), {})
        return {'shards': json.loads(out.getvalue().split('shards=', 1)[1]), 'scoped': None}
    return check_plan.plan(root, event_name, event, head, 3, {'native-health': 2})


def names(result):
    python = ['python-units'] if any(shard.get('python_shard') for shard in result['shards']) else []
    return python + [name for shard in result['shards'] if not shard.get('python_shard')
                     for name in shard['steps'].split(',')]


class Plan(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = fixtures.scoped_repository(self.root)

    def change(self, files):
        subprocess.run(['git', '-C', str(self.root), 'checkout', '-q', '--detach', self.base], check=True, capture_output=True)
        self.head = fixtures.commit_files(self.root, files)
        self.event = {'pull_request': {'base': {'sha': self.base}, 'head': {'sha': self.head}}}

    def test_small_css_fix_and_its_case_deal_only_chosen_steps_beside_units_and_replay(self):
        self.change({'web/aim.css': fixtures.HEALTH_FIX['web/aim.css'],
                     'tests/health_native.mjs': "await check('health colour', async () => {});\n"})
        changed, chosen, _ = release_check.scope(self.root, self.base, self.head)
        self.assertEqual(chosen, ['native-health'])
        result = plan(self.root, 'pull_request', self.event, self.head)
        self.assertCountEqual(names(result), list(release_check.UNIT_STEPS) + ['deploy-refusals', 'wake-replay'] + chosen)
        self.assertEqual(len(result['shards']), 8)
        self.assertEqual(result['scoped']['live'], self.base)
        self.assertCountEqual(result['scoped']['changed'], changed)

    def test_no_chosen_browser_step_creates_no_browser_job(self):
        self.change({'docs/note.md': 'small documentation fix\n'})
        result = plan(self.root, 'pull_request', self.event, self.head)
        self.assertCountEqual(names(result), ['python-units', 'node-units', 'deploy-refusals', 'wake-replay'])
        self.assertEqual(len(result['shards']), 7)

    def test_push_manual_forbidden_paths_six_files_and_refused_scope_all_deal_every_step(self):
        self.change({'web/aim.css': fixtures.HEALTH_FIX['web/aim.css']})
        for event_name in ('push', 'workflow_dispatch'):
            with self.subTest(event=event_name):
                self.assertCountEqual(names(plan(self.root, event_name, self.event, self.head)), release_check.REQUIRED)
        for path in release_check.SMALL_FIX_NEVER:
            with self.subTest(path=path):
                self.change({path + 'example.py' if path.endswith('/') else path: '# forbidden\n'})
                self.assertCountEqual(names(plan(self.root, 'pull_request', self.event, self.head)), release_check.REQUIRED)
        self.assertTrue(release_check.small_fix_problems(['docs/%d.md' % n for n in range(6)]), 'six files is a full run')
        self.change({'docs/%d.md' % n: '# six\n' for n in range(6)})
        self.assertCountEqual(names(plan(self.root, 'pull_request', self.event, self.head)), release_check.REQUIRED)
        with mock.patch.object(release_check, 'scope', side_effect=release_check.Refused('rules refused')):
            self.assertCountEqual(names(plan(self.root, 'pull_request', self.event, self.head)), release_check.REQUIRED)
        for event in ({}, {'pull_request': {'base': {'sha': 'f' * 40}}}):
            self.assertCountEqual(names(plan(self.root, 'pull_request', event, self.head)), release_check.REQUIRED)

    def test_refused_scope_on_an_otherwise_small_fix_falls_closed(self):
        self.change({'web/aim.css': fixtures.HEALTH_FIX['web/aim.css']})
        with mock.patch.object(release_check, 'scope', side_effect=release_check.Refused('rules refused')) as choose:
            result = plan(self.root, 'pull_request', self.event, self.head)
        self.assertCountEqual(names(result), release_check.REQUIRED)
        self.assertIsNone(result['scoped'])
        choose.assert_called_once()


    def test_a_merge_from_another_base_gets_a_full_run(self):
        self.change({'web/aim.css': fixtures.HEALTH_FIX['web/aim.css']})
        result = plan(self.root, 'pull_request', self.event, self.base)
        self.assertCountEqual(names(result), release_check.REQUIRED)
        self.assertIsNone(result['scoped'])

    def test_workflow_calls_the_planner_and_transports_its_scope(self):
        workflow = WORKFLOW.read_text()
        section = workflow.split('  plan:', 1)[1].split('  check:', 1)[0]
        self.assertIn('python3 -I tools/check_plan.py --github-output', section)
        self.assertIn('fetch-depth: 0', section)
        self.assertIn('PLAN_SCOPE: ${{ needs.plan.outputs.scoped }}', workflow)

class Fold(unittest.TestCase):
    def test_workflow_combines_a_scoped_run_and_deploy_accepts_only_its_complete_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = fixtures.scoped_repository(root / 'repo')
            head = fixtures.commit_files(root / 'repo', fixtures.HEALTH_FIX)
            event = {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}
            result = plan(root / 'repo', 'pull_request', event, head)
            # The expectation is independently built, including on release 89.
            scoped = {'live': base, 'steps': ['native-health'], 'changed': list(fixtures.HEALTH_FIX),
                      'not_run': [n for n in release_check.REQUIRED if n.startswith('native-') and n != 'native-health']}
            summary = fixtures.scoped_summary(head, base, ['native-health'], list(fixtures.HEALTH_FIX))
            shards = root / 'shards'
            merge = {'sha': head, 'tree': 't', 'first_parent': base, 'second_parent': head}
            by_name = {step['name']: step for step in summary['steps']}
            for i, job in enumerate(result['shards']):
                steps = [copy.deepcopy(by_name[name]) for name in job['steps'].split(',')]
                folder = shards / ('check-%d' % i)
                folder.mkdir(parents=True)
                raw = dict(summary, steps=steps, started_at='2026-11-16T00:00:00Z', finished_at='2026-11-16T00:01:00Z',
                           tree_after={'head': head, 'changes': ''}, only=[s['name'] for s in steps])
                raw.pop('scoped')
                if job.get('python_shard'):
                    index, total = map(int, job['python_shard'].split('/'))
                    raw['python_shard'] = {'index': index, 'total': total, 'files': job['files']}
                    steps[0]['counts'] = {'tests': 1, 'status': 'OK'}
                data = json.dumps(raw).encode()
                (folder / 'summary.json').write_bytes(data)
                import hashlib
                receipt = {'run': {'id': '1', 'attempt': '1'}, 'merge': merge,
                           'shard': {'name': job['name']},
                           'summary_sha256': hashlib.sha256(data).hexdigest(),
                           'base_at_run': {'ref': 'release/live', 'sha': base}}
                (folder / 'run.json').write_text(json.dumps(receipt))
            out = root / 'combined'
            out.mkdir()
            script = WORKFLOW.read_text().split("      - name: Fold the shards' summaries into one\n", 1)[1]
            script = textwrap.dedent(script.split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])
            env = {'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': head,
                   'GITHUB_EVENT_NAME': 'pull_request', 'BASE_REF': 'release/live', 'BASE_SHA': base,
                   'PLAN_SCOPE': json.dumps(result['scoped'] or scoped), 'PLAN_SHARDS': json.dumps(result['shards'])}
            with mock.patch.dict(os.environ, env), mock.patch.object(sys, 'argv', ['-', str(shards), str(out / 'summary.json')]), \
                    contextlib.redirect_stdout(io.StringIO()):
                try:
                    exec(compile(script, str(WORKFLOW), 'exec'), {})
                except SystemExit as exit:
                    self.assertEqual(exit.code, 0, 'chosen steps and mandatory shards must combine green')
            combined = json.loads((out / 'summary.json').read_text())
            self.assertEqual(combined['scoped']['steps'], ['native-health'])
            scope = lambda: (base, list(fixtures.HEALTH_FIX), ['native-health'])
            self.assertEqual(release_check.judge_summary(out / 'summary.json', head, scope=scope), ([], []))
            self.assertTrue(release_check.judge_summary(out / 'summary.json', head)[0], 'never accepted as a full run')
            for missing in ('native-health', 'python-units', 'node-units', 'deploy-refusals', 'wake-replay'):
                broken = copy.deepcopy(combined)
                broken['steps'] = [s for s in broken['steps'] if s['name'] != missing]
                (out / 'broken.json').write_text(json.dumps(broken))
                self.assertTrue(any(release_check.judge_summary(out / 'broken.json', head, scope=scope)), missing)


class PlanCommand(unittest.TestCase):
    """Exercise the workflow's process boundary, not just the dealer function."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.root = self.folder / 'repo'
        fixtures.scoped_repository(self.root)
        # Run the actual command and its dependencies in an isolated checkout.
        # The committed harness is synthetic; planning never launches a browser.
        sources = {path: (ROOT / path).read_text() for path in (
            'tools/check_plan.py', 'tools/release_check.py', 'tools/unit_shards.py', 'tools/steps_for.py',
            '.github/check-weights.json')}
        sources[release_check.PERSISTENCE] = """const [chromePath, evidencePath, mode] = process.argv.slice(2);
const check = async (name, action) => {
  if (mode !== '--health') return;
  await action();
};
await check('health colour', async () => {
  await page.evaluate(`document.querySelector('.release-line').textContent`);
});
"""
        sources['.gitignore'] = '__pycache__/\n'
        self.base = fixtures.commit_files(self.root, sources)
        self.event_path = self.folder / 'event.json'
        self.output = self.folder / 'github-output'
        section = WORKFLOW.read_text().split('      - id: plan\n', 1)[1].split('\n  check:', 1)[0]
        self.workflow_command = textwrap.dedent(section.split('        run: |\n', 1)[1])

    def change(self, files):
        subprocess.run(['git', '-C', str(self.root), 'checkout', '-q', '--detach', self.base],
                       check=True, capture_output=True)
        self.head = fixtures.commit_files(self.root, files)
        self.event_path.write_text(json.dumps({
            'pull_request': {'base': {'sha': self.base}, 'head': {'sha': self.head}}}))
        # Supply only the environment this command needs; do not inherit a
        # developer's GitHub event or credentials into the fixture process.
        self.env = {'PATH': str(Path(sys.executable).parent) + os.pathsep + os.defpath,
                    'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_EVENT_PATH': str(self.event_path),
                    'GITHUB_SHA': self.head, 'BROWSER_SHARDS': '2', 'GITHUB_OUTPUT': str(self.output)}

    def workflow(self):
        self.output.write_text('')
        ran = subprocess.run(['bash', '-c', self.workflow_command], cwd=self.root, env=self.env,
                             capture_output=True, text=True)
        self.assertEqual(ran.returncode, 0, ran.stderr)
        self.assertEqual(ran.stdout, '', 'workflow output belongs in GITHUB_OUTPUT')
        lines = self.output.read_text().splitlines()
        self.assertEqual(len(lines), 2, 'both matrix and scope must reach GitHub')
        fields = dict(line.split('=', 1) for line in lines)
        self.assertEqual(set(fields), {'shards', 'scoped'})
        result = {key: json.loads(value) for key, value in fields.items()}
        return result, ran.stderr.strip()

    def assert_scoped(self, result, chosen, changed):
        self.assertCountEqual(names(result), list(release_check.UNIT_STEPS) +
                              ['deploy-refusals', 'wake-replay'] + chosen)
        self.assertEqual(len(names(result)), len(set(names(result))), 'no step runs twice')
        scope = result['scoped']
        self.assertIsInstance(scope, dict, 'the event must produce a scope, not a full run')
        self.assertEqual(scope['live'], self.base)
        self.assertEqual(scope['steps'], chosen)
        self.assertCountEqual(scope['changed'], changed)
        self.assertCountEqual(scope['not_run'], [name for name in release_check.REQUIRED
                                               if name.startswith('native-') and name not in chosen])

    def test_workflow_command_reads_github_event_and_emits_docs_only_matrix_and_scope(self):
        self.change({'docs/note.md': 'documentation only\n'})
        result, why = self.workflow()
        self.assert_scoped(result, [], ['docs/note.md'])
        self.assertEqual(len(result['shards']), 7, 'no empty browser job')
        self.assertEqual(why, result['scoped']['why'])

    def test_workflow_command_emits_only_chosen_css_steps_and_complete_scope(self):
        self.change(fixtures.HEALTH_FIX)
        result, why = self.workflow()
        self.assert_scoped(result, ['native-health'], list(fixtures.HEALTH_FIX))
        self.assertEqual(len(result['shards']), 8)
        self.assertEqual(why, result['scoped']['why'])

    def test_workflow_command_falls_closed_when_event_is_unavailable_or_not_a_pr(self):
        self.change({'docs/note.md': 'documentation only\n'})
        for event_name in ('push', 'workflow_dispatch'):
            with self.subTest(event_name=event_name):
                self.env['GITHUB_EVENT_NAME'] = event_name
                result, why = self.workflow()
                self.assertCountEqual(names(result), release_check.REQUIRED)
                self.assertIsNone(result['scoped'])
                self.assertIn('only pull requests', why)
        self.env['GITHUB_EVENT_NAME'] = 'pull_request'
        for event in (None, '{', '{}', '{"pull_request": {"base": {"sha": "bad"}}}'):
            with self.subTest(event=event):
                if event is None:
                    self.event_path.unlink()
                else:
                    self.event_path.write_text(event)
                result, why = self.workflow()
                self.assertCountEqual(names(result), release_check.REQUIRED)
                self.assertIsNone(result['scoped'])
                self.assertIn('scope unavailable', why)

    def test_workflow_command_falls_closed_for_forbidden_paths_six_files_and_refused_rules(self):
        for files in ({'.github/probe.yml': '# controller\n'},
                      {'docs/%d.md' % n: '# six\n' for n in range(6)},
                      {'tools/release_check.py': '# rules unavailable\n'}):
            with self.subTest(files=sorted(files)):
                self.change(files)
                # Keep the running command intact while the committed rules
                # cannot be read: scope must inspect Git, not the working file.
                if 'tools/release_check.py' in files:
                    (self.root / 'tools/release_check.py').write_text((ROOT / 'tools/release_check.py').read_text())
                result, why = self.workflow()
                self.assertCountEqual(names(result), release_check.REQUIRED)
                self.assertIsNone(result['scoped'])
                self.assertIn('scope unavailable', why)

    def test_command_flags_override_github_defaults_and_plain_json_matches_workflow(self):
        self.change(fixtures.HEALTH_FIX)
        expected, why = self.workflow()
        self.env.update(GITHUB_EVENT_NAME='push', GITHUB_EVENT_PATH=str(self.folder / 'absent'), GITHUB_SHA='bad')
        command = [sys.executable, '-I', '-B', 'tools/check_plan.py', '--event-name', 'pull_request',
                   '--event', str(self.event_path), '--head', self.head, '--browser-shards', '2']
        ran = subprocess.run(command, cwd=self.root, env=self.env, capture_output=True, text=True)
        self.assertEqual(ran.returncode, 0, ran.stderr)
        actual = json.loads(ran.stdout)
        self.assertEqual(actual, dict(expected, why=why))
        self.assertEqual(ran.stderr, '')


if __name__ == '__main__':
    unittest.main()

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
    return [name for shard in result['shards'] for name in shard['steps'].split(',')]


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
        self.assertEqual(len(result['shards']), 3)
        self.assertEqual(result['scoped']['live'], self.base)
        self.assertCountEqual(result['scoped']['changed'], changed)

    def test_no_chosen_browser_step_creates_no_browser_job(self):
        self.change({'docs/note.md': 'small documentation fix\n'})
        result = plan(self.root, 'pull_request', self.event, self.head)
        self.assertCountEqual(names(result), ['python-units', 'node-units', 'deploy-refusals', 'wake-replay'])
        self.assertEqual(len(result['shards']), 2)

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
            for i, steps in enumerate((summary['steps'][:3], summary['steps'][3:])):
                folder = shards / ('check-%d' % i)
                folder.mkdir(parents=True)
                raw = dict(summary, steps=steps, started_at='2026-11-16T00:00:00Z', finished_at='2026-11-16T00:01:00Z',
                           tree_after={'head': head, 'changes': ''}, only=[s['name'] for s in steps])
                raw.pop('scoped')
                data = json.dumps(raw).encode()
                (folder / 'summary.json').write_bytes(data)
                import hashlib
                receipt = {'run': {'id': '1', 'attempt': '1'}, 'merge': merge,
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


if __name__ == '__main__':
    unittest.main()

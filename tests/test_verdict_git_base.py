from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/verdict.yml'
SPEC = importlib.util.spec_from_file_location('git_base_controller', ROOT / 'tools/ci_known_reds.py')
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)


def section(name):
    return WORKFLOW.read_text().split('      - name: '+name+'\n', 1)[1].split('      - name:', 1)[0]


def python_step(name):
    return textwrap.dedent(section(name).split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])


class VerdictGitBaseCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache_prefix = os.environ.get('PYTHONPYCACHEPREFIX', str(self.root / 'pycache'))
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@invalid')
        (self.repo / '.github/workflows').mkdir(parents=True)
        (self.repo / '.github/workflows/checks.yml').write_text('unchanged producer')
        (self.repo / 'web').mkdir()
        (self.repo / 'web/base').write_text('old')
        self.git('add', '.')
        self.git('commit', '-qm', 'event base')
        self.old = self.git('rev-parse', 'HEAD').strip()
        (self.repo / 'web/base').write_text('new')
        self.git('commit', '-qam', 'base moved')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-qb', 'feature', self.old)
        (self.repo / 'web/feature').write_text('feature')
        self.git('add', '.')
        self.git('commit', '-qm', 'feature')
        self.head = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', self.base)
        self.git('merge', '-q', '--no-ff', '--no-edit', self.head)
        self.merge = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        self.git('branch', 'release/live73', self.base)
        self.server = self.root / 'server'
        (self.server / 'org').mkdir(parents=True)
        self.remote = self.server / 'org/repo'
        subprocess.run(['git', 'clone', '-q', '--bare', str(self.repo), str(self.remote)], check=True)
        self.remote_git('symbolic-ref', 'HEAD', 'refs/heads/release/live73')
        self.remote_git('update-ref', 'refs/pull/34/head', self.head)
        self.remote_git('update-ref', 'refs/pull/34/merge', self.merge)
        self.out = self.root / 'verdict'
        (self.out / 'release-check').mkdir(parents=True)
        (self.out / 'release-check/summary.json').write_text('{}')
        self.producer = {'producer': {'event': 'pull_request', 'run_id': '99', 'run_attempt': '1',
                         'conclusion': 'failure', 'head_sha': self.head, 'head_branch': 'feature',
                         'head_repository': 'org/repo', 'created_at': '2026-11-15T00:00:00Z',
                         'workflow_name': 'Checks', 'workflow_path': '.github/workflows/checks.yml',
                         'pull_request': {'number': 34, 'head_sha': self.head, 'base_ref': 'release/live73', 'base_sha': self.old}},
                         'controller': {'run_id': '100', 'run_attempt': '1', 'workflow_sha': self.old,
                         'workflow_ref': 'org/repo/.github/workflows/verdict.yml@refs/heads/codex/aim-next',
                         'sha': self.old, 'repository': 'org/repo'}}
        self.producer_path = self.out / 'producer.json'
        self.producer_path.write_text(json.dumps(self.producer))
        self.refusals = self.out / 'refusals'
        self.refusals.write_text('')
        self.current_path = self.root / 'current-pr.json'
        self.current = {'number': 34, 'state': 'open',
                        'head': {'sha': self.head, 'repo': {'full_name': 'org/repo'}},
                        'base': {'ref': 'release/live73', 'sha': self.base,
                                 'repo': {'full_name': 'org/repo'}}}
        self.stub = self.root / 'stub'
        self.stub.mkdir()
        gh = self.stub / 'gh'
        gh.write_text('#!/bin/sh\ncat "$CURRENT_PR_FIXTURE"\n')
        gh.chmod(0o755)
        python = self.stub / 'python3'
        python.write_text('#!/bin/sh\nexec "'+sys.executable+'" -X "pycache_prefix=$PYTHONPYCACHEPREFIX" "$@"\n')
        python.chmod(0o755)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo)] + list(args), capture_output=True, text=True, check=True).stdout

    def remote_git(self, *args):
        return subprocess.run(['git', '--git-dir='+str(self.remote)] + list(args), capture_output=True, text=True, check=True).stdout

    def nominate(self, declared=False, bad_declaration=False, bad_head=False, mixed=False, original_ref='release/live73'):
        for i in range(2):
            folder = self.out / 'shards' / ('check-%d' % i)
            folder.mkdir(parents=True)
            receipt = {'run': {'id': '99', 'attempt': '1'},
                       'base': {'ref': original_ref, 'sha': self.old if original_ref == 'release/live73' else self.base},
                       'merge': {'sha': self.merge, 'tree': self.tree, 'first_parent': self.base,
                                 'second_parent': self.old if bad_head else self.head}}
            if declared and not (mixed and i):
                receipt['base_at_run'] = {'ref': original_ref, 'sha': self.old if bad_declaration else self.base}
            (folder / 'run.json').write_text(json.dumps(receipt))
        answer = subprocess.run([sys.executable, '-I', '-S', '-X', 'pycache_prefix='+self.cache_prefix, '-c', python_step("The receipts, held to GitHub's record"),
                                 str(self.producer_path), str(self.out / 'shards'), str(self.out / 'release-check'),
                                 str(self.out / 'merge.json'), str(self.refusals)], capture_output=True, text=True, check=True)
        return dict(line.split('=', 1) for line in answer.stdout.splitlines())

    def rebuild(self, outputs):
        # Use the workflow's actual BASE_SHA output wiring, including the old-record-field mutant.
        step, key = re.search(r'BASE_SHA: \$\{\{ steps\.(\w+)\.outputs\.(\w+) \}\}',
                              section('The tested merge, fetched and rebuilt')).groups()
        bound = {'record': {'base_sha': self.old}, 'receipts': outputs}
        env = dict(os.environ, OUT=str(self.out), GITHUB_SERVER_URL='file://'+str(self.server),
                   GITHUB_REPOSITORY='org/repo', HEAD_SHA=self.head, BASE_SHA=bound[step][key],
                   BASE_REF='release/live73', NUMBER='34', MERGE_SHA=outputs['merge_sha'], TREE=outputs['tree'],
                   EVENT='pull_request', PARENTS='')
        shell = textwrap.dedent(section('The tested merge, fetched and rebuilt').split('        run: |\n', 1)[1])
        output = self.root / 'outputs'
        env['GITHUB_OUTPUT'] = str(output)
        self.current_path.write_text(json.dumps(self.current))
        env.update(PATH=str(self.stub)+os.pathsep+env['PATH'], CURRENT_PR_FIXTURE=str(self.current_path),
                   PYTHONPYCACHEPREFIX=self.cache_prefix)
        subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', shell], env=env, capture_output=True, text=True, check=True)
        return output.read_text() if output.exists() else ''

    def test_stale_event_base_uses_git_parent_and_keeps_event_metadata(self):
        nominated = self.nominate()
        self.assertEqual(nominated['refused'], 'false')
        self.assertEqual(nominated['base_sha'], self.base)
        self.assertIn('ready=true', self.rebuild(nominated))
        bound = json.loads(self.producer_path.read_text())
        self.assertEqual(bound['producer']['pull_request']['base_sha'], self.old)
        self.assertEqual(bound['tested_base'], {'ref': 'release/live73', 'sha': self.base, 'branch_head': self.base})
        self.assertEqual(bound['merge']['rebuilt'], self.tree)

    def test_new_git_base_declaration_is_accepted(self):
        nominated = self.nominate(declared=True)
        self.assertEqual(nominated['refused'], 'false')
        self.assertIn('ready=true', self.rebuild(nominated))

    def test_wrong_git_base_declaration_refuses(self):
        self.assertEqual(self.nominate(declared=True, bad_declaration=True)['refused'], 'true')
        self.assertIn('different from its merge', self.refusals.read_text())

    def test_mixed_receipt_formats_refuse(self):
        self.assertEqual(self.nominate(declared=True, mixed=True)['refused'], 'true')
        self.assertIn('mix legacy', self.refusals.read_text())

    def test_wrong_second_parent_refuses(self):
        self.assertEqual(self.nominate(bad_head=True)['refused'], 'true')

    def test_base_advanced_further_accepts_ancestor(self):
        later = self.git('commit-tree', self.git('rev-parse', self.base+'^{tree}').strip(), '-p', self.base,
                         '-m', 'later base').strip()
        subprocess.run(['git', '--git-dir='+str(self.remote), 'fetch', '-q', str(self.repo), later], check=True)
        self.remote_git('update-ref', 'refs/heads/release/live73', later)
        self.current['base']['sha'] = later
        self.assertIn('ready=true', self.rebuild(self.nominate()))
        self.assertEqual(json.loads(self.producer_path.read_text())['tested_base']['branch_head'], later)

    def test_first_parent_outside_base_branch_refuses(self):
        # The Git object exists and every receipt agrees; it was never reached by the authenticated base branch.
        self.remote_git('update-ref', 'refs/heads/release/live73', self.old)
        self.current['base']['sha'] = self.old
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('is not a commit on release/live73', self.refusals.read_text())

    def test_validator_keeps_event_base_binding_and_checks_tested_ancestry(self):
        self.rebuild(self.nominate())
        bound = json.loads(self.producer_path.read_text())
        event = {'action': 'completed', 'repository': {'default_branch': 'codex/aim-next'},
                 'workflow_run': {'id': 99, 'run_attempt': 1, 'event': 'pull_request', 'name': 'Checks',
                 'created_at': '2026-11-15T00:00:00Z', 'head_branch': 'feature', 'head_sha': self.head,
                 'conclusion': 'failure', 'pull_requests': [{'number': 34, 'head': {'sha': self.head},
                                                          'base': {'sha': self.old}}]}}
        event_path = self.root / 'event.json'
        event_path.write_text(json.dumps(event))
        controller = bound['controller']
        env = dict(os.environ, GITHUB_EVENT_NAME='workflow_run', GITHUB_EVENT_PATH=str(event_path),
                   GITHUB_RUN_ID='100', GITHUB_RUN_ATTEMPT='1', GITHUB_WORKFLOW_SHA=controller['workflow_sha'],
                   GITHUB_WORKFLOW_REF=controller['workflow_ref'], GITHUB_SHA=controller['sha'], GITHUB_REPOSITORY='org/repo')
        _, base, _, record = C.producer_binding(self.producer_path, env)
        self.assertEqual(base['sha'], self.base)
        C.tested_base_reached(self.repo, base, record)
        record['tested_base']['branch_head'] = self.old
        with self.assertRaisesRegex(C.Refused, 'not reached'):
            C.tested_base_reached(self.repo, base, record)
        event['workflow_run']['pull_requests'][0]['base']['sha'] = self.head
        event_path.write_text(json.dumps(event))
        with self.assertRaisesRegex(C.Refused, 'PR base/head'):
            C.producer_binding(self.producer_path, env)


if __name__ == '__main__':
    unittest.main()

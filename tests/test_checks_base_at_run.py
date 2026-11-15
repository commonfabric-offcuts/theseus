from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/checks.yml'


def script(name):
    section = WORKFLOW.read_text().split('      - name: '+name+'\n', 1)[1]
    return textwrap.dedent(section.split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])


class ChecksBaseAtRunCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@invalid')
        (self.repo / 'base').write_text('old')
        self.git('add', '.')
        self.git('commit', '-qm', 'event base')
        self.event_base = self.git('rev-parse', 'HEAD').strip()
        (self.repo / 'base').write_text('new')
        self.git('commit', '-qam', 'base advanced')
        self.actual_base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-qb', 'feature', self.event_base)
        (self.repo / 'feature').write_text('feature')
        self.git('add', '.')
        self.git('commit', '-qm', 'feature')
        self.head = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', self.actual_base)
        self.git('merge', '-q', '--no-ff', '--no-edit', self.head)
        self.merge = self.git('rev-parse', 'HEAD').strip()
        self.env = dict(os.environ, GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ID='99', GITHUB_RUN_ATTEMPT='1',
                        GITHUB_WORKFLOW='Checks', GITHUB_JOB='check', GITHUB_REPOSITORY='org/repo',
                        GITHUB_SHA=self.merge, GITHUB_WORKFLOW_SHA=self.merge, GITHUB_WORKFLOW_REF='workflow',
                        BASE_REF='release/live73', BASE_SHA=self.event_base, HEAD_REF='feature', HEAD_SHA=self.head)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo)] + list(args), capture_output=True, text=True, check=True).stdout

    def receipt(self, folder, step='python-units', event='pull_request'):
        folder.mkdir(parents=True)
        summary = {'tool': 'theseus-release-check', 'commit': self.merge, 'checkout': str(self.repo), 'tools': {},
                   'required': ['python-units', 'node-units'], 'steps': [{'name': step, 'passed': True}],
                   'started_at': '2026-11-15T00:00:00Z', 'finished_at': '2026-11-15T00:01:00Z',
                   'tree_unchanged': True, 'tree_after': {'head': self.merge, 'changes': ''}}
        (folder / 'summary.json').write_text(json.dumps(summary))
        subprocess.run([sys.executable, '-I', '-S', '-c', script("Write this shard's receipt"), str(folder / 'run.json')],
                       cwd=self.repo, env=dict(self.env, SHARD_NAME=step, SHARD_STEPS=step, GITHUB_EVENT_NAME=event),
                       capture_output=True, text=True, check=True)
        return json.loads((folder / 'run.json').read_text())

    def combine(self, change=None, event='pull_request', each_change=None):
        shards = self.root / 'shards'
        for i, name in enumerate(('python-units', 'node-units')):
            folder = shards / ('check-%d' % i)
            receipt = self.receipt(folder, name, event=event)
            if each_change:
                each_change(receipt)
            if change and i == 1:
                change(receipt)
            if each_change or (change and i == 1):
                (folder / 'run.json').write_text(json.dumps(receipt))
        out = self.root / 'release-check'
        out.mkdir()
        env = dict(self.env, GITHUB_EVENT_NAME=event, PLAN_SHARDS=json.dumps([{'steps': 'python-units'}, {'steps': 'node-units'}]))
        result = subprocess.run([sys.executable, '-I', '-S', '-c', script("Fold the shards' summaries into one"),
                                 str(shards), str(out / 'summary.json')], cwd=self.repo, env=env, capture_output=True, text=True)
        return result, out

    def test_receipt_preserves_event_base_and_reads_actual_git_parent(self):
        receipt = self.receipt(self.root / 'shard')
        self.assertEqual(receipt['base'], {'ref': 'release/live73', 'sha': self.event_base})
        self.assertEqual(receipt['base_at_run'], {'ref': 'release/live73', 'sha': self.actual_base})
        self.assertEqual(receipt['merge']['first_parent'], self.actual_base)
        self.assertNotEqual(self.event_base, self.actual_base)

    def test_push_has_no_pr_base_observation(self):
        receipt = self.receipt(self.root / 'push', event='push')
        self.assertIsNone(receipt['base_at_run'])

    def test_combined_provenance_keeps_the_git_base(self):
        result, out = self.combine()
        self.assertEqual(result.returncode, 0, result.stderr)
        provenance = json.loads((out / 'provenance.json').read_text())
        self.assertEqual(provenance['base_at_run'], {'ref': 'release/live73', 'sha': self.actual_base})
        self.assertEqual(provenance['base']['sha'], self.event_base)

    def test_disagreeing_shards_refuse(self):
        result, _ = self.combine(lambda r: r['base_at_run'].update(sha=self.event_base))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('different git-read bases', result.stderr)

    def test_new_push_preserves_explicit_null_in_every_receipt(self):
        result, out = self.combine(event='push')
        self.assertEqual(result.returncode, 0, result.stderr)
        provenance = json.loads((out / 'provenance.json').read_text())
        self.assertIn('base_at_run', provenance)
        self.assertIsNone(provenance['base_at_run'])
        self.assertTrue(all('base_at_run' in e['receipt'] and e['receipt']['base_at_run'] is None
                            for e in provenance['shards']))

    def test_all_legacy_push_preserves_absence(self):
        result, out = self.combine(event='push', each_change=lambda r: r.pop('base_at_run'))
        self.assertEqual(result.returncode, 0, result.stderr)
        provenance = json.loads((out / 'provenance.json').read_text())
        self.assertNotIn('base_at_run', provenance)
        self.assertTrue(all('base_at_run' not in e['receipt'] for e in provenance['shards']))

    def test_absent_and_null_push_receipts_do_not_mix(self):
        result, _ = self.combine(event='push', change=lambda r: r.pop('base_at_run'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('mix legacy', result.stderr)

    def test_pr_receipt_requires_git_first_parent(self):
        self.git('checkout', '-q', self.event_base)
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            self.receipt(self.root / 'root-commit')
        self.assertIn('no Git first-parent commit id', raised.exception.stderr)

    def test_combiner_refuses_two_missing_pr_parent_values(self):
        def remove_parent(receipt):
            receipt['merge']['first_parent'] = None
            receipt['base_at_run']['sha'] = None
        result, _ = self.combine(each_change=remove_parent)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no Git first-parent commit id', result.stderr)


if __name__ == '__main__':
    unittest.main()

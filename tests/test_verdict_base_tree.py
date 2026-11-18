from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from tests import test_verdict_git_base as G


class RetargetedBaseCase(G.VerdictGitBaseCase):
    def test_train38_retained_nomination(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/train38-retarget.json').read_text())
        self.producer_path.write_text(json.dumps(fixture['producer']))
        for row in fixture['receipts']:
            folder = self.out / 'shards' / ('check-%d' % row['shard'])
            folder.mkdir(parents=True)
            receipt = {k: row[k] for k in ('base', 'base_at_run', 'merge')}
            receipt['run'] = {'id': '44156670774', 'attempt': '1'}
            (folder / 'run.json').write_text(json.dumps(receipt))
        answer = subprocess.run([sys.executable, '-I', '-S', '-X', 'pycache_prefix='+self.cache_prefix, '-c', G.python_step("The receipts, held to GitHub's record"),
                                 str(self.producer_path), str(self.out / 'shards'), str(self.out / 'release-check'),
                                 str(self.out / 'merge.json'), str(self.refusals)], capture_output=True, text=True, check=True)
        self.assertTrue(fixture['refusals'])
        self.assertEqual(len(set(fixture['trees'].values())), 1)
        self.assertIn('refused=false', answer.stdout, self.refusals.read_text())
        bound = json.loads(self.producer_path.read_text())
        self.assertEqual(bound['producer'], fixture['producer']['producer'])
        self.assertEqual(bound['base_at_run'], fixture['receipts'][0]['base_at_run'])

    def retarget(self):
        later = self.git('commit-tree', self.git('rev-parse', self.base+'^{tree}').strip(),
                         '-p', self.base, '-m', 'producer landed with identical files').strip()
        subprocess.run(['git', '--git-dir='+str(self.remote), 'fetch', '-q', str(self.repo), later], check=True)
        self.remote_git('update-ref', 'refs/heads/release/live73', later)
        self.current['base']['sha'] = later
        return later

    def test_different_commits_same_tree_keeps_every_identity(self):
        later = self.retarget()
        original = copy.deepcopy(self.producer)
        self.assertIn('ready=true', self.rebuild(self.nominate(declared=True, original_ref='train/producer')))
        bound = json.loads(self.producer_path.read_text())
        self.assertEqual(bound['producer'], original['producer'])
        self.assertEqual(bound['controller'], original['controller'])
        self.assertEqual(bound['base_at_run'], {'ref': 'train/producer', 'sha': self.base})
        comparison = bound['base_comparison']
        self.assertEqual(comparison['at_run']['sha'], self.base)
        self.assertEqual(comparison['current']['sha'], later)
        self.assertEqual(comparison['at_run']['tree'], comparison['current']['tree'])
        self.assertNotEqual(self.base, later)
        self.assertEqual(bound['merge']['sha'], self.merge)

    def test_current_different_tree_refuses(self):
        self.current['base']['sha'] = self.merge
        self.remote_git('update-ref', 'refs/heads/release/live73', self.merge)
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('different trees', self.refusals.read_text())

    def test_stale_or_malformed_current_pr_refuses(self):
        self.current['head']['sha'] = self.old
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('current PR', self.refusals.read_text())

    def test_missing_current_base_commit_refuses(self):
        self.current['base']['sha'] = 'a'*40
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))

    def test_stale_git_pr_head_refuses(self):
        self.remote_git('update-ref', 'refs/pull/34/head', self.old)
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('pull request has moved on', self.refusals.read_text())

    def test_current_closed_or_partial_binding_refuses(self):
        del self.current['base']['repo']
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('current PR', self.refusals.read_text())

    def test_current_foreign_repository_refuses(self):
        self.current['head']['repo']['full_name'] = 'foreign/repo'
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))

    def test_current_wrong_pr_number_refuses(self):
        self.current['number'] = 35
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))

    def test_current_closed_refuses(self):
        self.current['state'] = 'closed'
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))

    def test_current_wrong_ref_refuses(self):
        self.current['base']['ref'] = 'unapproved'
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))

    def test_unreadable_git_tree_refuses(self):
        git = self.stub / 'git'
        git.write_text('#!/bin/sh\nif [ "$1" = rev-parse ] && [ "$2" = '+self.base+'^{tree} ]; then exit 1; fi\nexec /usr/bin/git "$@"\n')
        git.chmod(0o755)
        self.assertNotIn('ready=true', self.rebuild(self.nominate()))
        self.assertIn('a base tree could not be read', self.refusals.read_text())

    def test_published_receipt_names_both_commits_and_trees(self):
        later = self.retarget()
        self.assertIn('ready=true', self.rebuild(self.nominate(declared=True, original_ref='train/producer')))
        doc = json.loads(self.producer_path.read_text())
        doc['producer'].update(url='synthetic-run', workflow_id=1)
        doc['controller']['url'] = 'synthetic-controller'
        self.producer_path.write_text(json.dumps(doc))
        (self.out / 'validation.json').write_text(json.dumps({'passed': True}))
        subprocess.run([sys.executable, '-I', '-S', '-X', 'pycache_prefix='+self.cache_prefix, '-c',
                        G.python_step('Decide, and write the check run to publish')], cwd=self.out,
                       env=dict(os.environ, HEAD_SHA=self.head, APPROVED_BASES='release/live73'),
                       check=True, capture_output=True, text=True)
        receipt = json.loads((self.out / 'check-run.json').read_text())
        self.assertEqual(receipt['conclusion'], 'success')
        summary = receipt['output']['summary']
        self.assertIn('at run '+self.base+' tree '+doc['base_comparison']['at_run']['tree'], summary)
        self.assertIn('base '+later+' on release/live73 tree '+doc['base_comparison']['current']['tree'], summary)
        self.assertIn('train/producer', summary)

    def test_forged_tested_tree_refuses(self):
        outputs = self.nominate()
        outputs['tree'] = 'a'*40
        self.assertNotIn('ready=true', self.rebuild(outputs))
        self.assertIn('not the tree the receipts name', self.refusals.read_text())

    def test_binding_and_git_tree_tampering_refuse(self):
        self.retarget()
        self.assertIn('ready=true', self.rebuild(self.nominate(declared=True, original_ref='train/producer')))
        original = json.loads(self.producer_path.read_text())
        event = {'action': 'completed', 'repository': {'default_branch': 'codex/aim-next'},
                 'workflow_run': {'id': 99, 'run_attempt': 1, 'event': 'pull_request', 'name': 'Checks',
                 'created_at': original['producer']['created_at'], 'head_branch': 'feature', 'head_sha': self.head,
                 'conclusion': 'failure', 'pull_requests': [{'number': 34, 'head': {'sha': self.head},
                                                           'base': {'sha': self.old}}]}}
        event_path = self.root / 'event.json'
        event_path.write_text(json.dumps(event))
        controller = original['controller']
        env = dict(os.environ, GITHUB_EVENT_NAME='workflow_run', GITHUB_EVENT_PATH=str(event_path),
                   GITHUB_RUN_ID='100', GITHUB_RUN_ATTEMPT='1', GITHUB_WORKFLOW_SHA=controller['workflow_sha'],
                   GITHUB_WORKFLOW_REF=controller['workflow_ref'], GITHUB_SHA=controller['sha'], GITHUB_REPOSITORY='org/repo')
        _, base, _, bound = G.C.producer_binding(self.producer_path, env)
        G.C.tested_base_reached(self.repo, base, bound)
        for path in [('base_comparison',), ('base_comparison', 'at_run'),
                     ('base_comparison', 'at_run', 'tree'), ('base_comparison', 'current', 'sha'),
                     ('base_comparison', 'current', 'head_sha'), ('base_at_run',), ('receipt_base',),
                     ('controller',), ('producer', 'run_id'), ('producer', 'pull_request', 'base_sha')]:
            with self.subTest(missing=path):
                doc = copy.deepcopy(original)
                parent = doc
                for key in path[:-1]:
                    parent = parent[key]
                del parent[path[-1]]
                self.producer_path.write_text(json.dumps(doc))
                with self.assertRaises(G.C.Refused):
                    G.C.producer_binding(self.producer_path, env)
        for path, value in [(('base_comparison', 'current', 'head_sha'), self.old),
                            (('base_comparison', 'current', 'sha'), self.old),
                            (('base_comparison', 'at_run', 'sha'), self.old),
                            (('base_comparison', 'at_run', 'tree'), None),
                            (('base_comparison', 'current', 'tree'), 'bad'),
                            (('base_at_run', 'sha'), self.old),
                            (('controller', 'workflow_sha'), self.head),
                            (('producer', 'head_sha'), self.old)]:
            with self.subTest(forged=path):
                doc = copy.deepcopy(original)
                parent = doc
                for key in path[:-1]:
                    parent = parent[key]
                parent[path[-1]] = value
                self.producer_path.write_text(json.dumps(doc))
                with self.assertRaises(G.C.Refused):
                    G.C.producer_binding(self.producer_path, env)
        # Even internally consistent forged tree ids must lose to Git's own objects.
        doc = copy.deepcopy(original)
        doc['base_comparison']['at_run']['tree'] = doc['base_comparison']['current']['tree'] = 'a'*40
        self.producer_path.write_text(json.dumps(doc))
        _, base, _, bound = G.C.producer_binding(self.producer_path, env)
        with self.assertRaisesRegex(G.C.Refused, 'base tree differs from Git'):
            G.C.tested_base_reached(self.repo, base, bound)

    def test_original_ref_and_commit_are_not_substituted(self):
        self.assertEqual(self.nominate(declared=True)['refused'], 'false')
        path = self.out / 'shards/check-0/run.json'
        receipt = json.loads(path.read_text())
        receipt['base_at_run']['sha'] = self.old
        path.write_text(json.dumps(receipt))
        # Reread the actual controller step, without rewriting the malformed input.
        answer = subprocess.run([sys.executable, '-I', '-S', '-X', 'pycache_prefix='+self.cache_prefix,
                                 '-c', G.python_step("The receipts, held to GitHub's record"),
                                 str(self.producer_path), str(self.out / 'shards'), str(self.out / 'release-check'),
                                 str(self.out / 'merge.json'), str(self.refusals)], capture_output=True, text=True, check=True)
        self.assertIn('refused=true', answer.stdout)


if __name__ == '__main__':
    unittest.main()

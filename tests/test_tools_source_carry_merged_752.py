from __future__ import annotations

"""Narrow retained-API/Git controls, never an admission or independent review.

The positive uses actual post-merge PR86/run facts and real Git objects. Only
negative controls alter those facts. No product workload, receipt or judgment
is generated. The coordinator must still run the whole strict merged proof.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest import mock

from tools import base_move, train

EVIDENCE = Path(os.environ.get('SOURCE_CARRY_MERGED_752_EVIDENCE',
    '/Users/commonfabric/.local/share/theseus/fable-tools/checks/752-merged9138'))
SOURCE = os.environ.get('SOURCE_CARRY_MERGED_752_GIT',
    '/Users/commonfabric/aim-worktrees/codex-752-union9074')
REPOSITORY = 'commonfabric-offcuts/theseus'


@unittest.skipUnless((EVIDENCE / 'fresh-original-run.json').is_file(),
                     'requires retained actual post-merge PR86 API facts and Git objects')
class OriginalRunMerged752(unittest.TestCase):
    def setUp(self):
        self.run = self.read('fresh-original-run.json')
        self.pull = self.read('fresh-actual-pr.json')
        self.workflow = self.read('fresh-workflow.json')
        self.jobs = self.read('fresh-jobs.json')
        self.binding = {'run': 44284000276, 'attempt': 1,
                        'workflow_head': train.CARRY_752_OLD, 'source_head': train.CARRY_752_OLD}
        self.context = {'pull': copy.deepcopy(self.pull), 'number': 86, 'release_branch': 'release/live73',
                        'merge': self.pull['merge_commit_sha'], 'assembly': train.CARRY_752_HEAD,
                        'live': train.CARRY_752_BASE, 'original_base': train.CARRY_752_BASE,
                        'source_head': train.CARRY_752_OLD, 'mode': 'merged'}
        self.calls = []

    def read(self, name):
        return json.loads((EVIDENCE / name).read_bytes())

    def get(self, path):
        self.calls.append(path)
        facts = {
            'repos/' + REPOSITORY + '/actions/runs/44284000276': self.run,
            'repos/' + REPOSITORY + '/actions/workflows/' + str(self.run['workflow_id']): self.workflow,
            'repos/' + REPOSITORY + '/actions/runs/44284000276/attempts/1/jobs?per_page=100': self.jobs,
            'repos/' + REPOSITORY + '/pulls/86': self.pull,
        }
        self.assertIn(path, facts, 'unexpected API read')
        return copy.deepcopy(facts[path])

    def git(self, *args):
        self.assertIn(args[0], ('rev-list', 'rev-parse', 'merge-base', 'diff', 'archive'))
        return subprocess.run(['git', '-C', SOURCE] + list(args), capture_output=True, text=True)

    def check(self, context=None, git=None):
        return train.carry_run(self.binding, self, REPOSITORY, git or self.git,
                               self.context if context is None else context)

    def test_actual_empty_merged_run_keeps_original_failed_head_attempt_and_jobs(self):
        self.assertEqual(self.run['pull_requests'], [])
        self.assertIs(self.pull['merged'], True)
        run, jobs = self.check()
        self.assertEqual(run, self.run)
        self.assertEqual(run['head_sha'], train.CARRY_752_OLD)
        self.assertEqual(run['run_attempt'], 1)
        self.assertEqual(run['conclusion'], 'failure')
        self.assertEqual(set(jobs), {r['id'] for r in self.jobs['jobs']})
        self.assertIn('repos/' + REPOSITORY + '/pulls/86', self.calls)

    def test_empty_without_context_refuses(self):
        with self.assertRaisesRegex(train.Refused, 'actual merged context'):
            train.carry_run(self.binding, self, REPOSITORY, self.git)

    def test_real_reviewed_envelope_forwards_authenticated_context_to_original_run(self):
        # Run the real entry path only as far as the original-run association.
        # No judgment/review is invented and no accepting proof is returned.
        retained = Path('/Users/commonfabric/.local/share/theseus/fable-tools/checks/752-union9074')
        record = train.load(str(retained / 'ACTUAL-MERGED-PR86-TRAIN.json'))
        original = train.carry_run

        class ReachedOriginalRun(Exception):
            pass

        def stop_after_original(binding, github, repository, git, merged_context=None):
            self.assertEqual(binding, self.binding)
            self.assertEqual(merged_context, self.context)
            run, _ = original(binding, github, repository, git, merged_context)
            self.assertEqual(run, self.run)
            raise ReachedOriginalRun()

        with mock.patch.object(train, 'carry_run', side_effect=stop_after_original):
            with self.assertRaises(ReachedOriginalRun):
                train.validate_source_carry(record['source_carry'], None, self.git, self, REPOSITORY,
                    train.CARRY_752_BASE, record['merge_commit'], record['items'], self.pull, 86, 'release/live73')

    def test_open_or_unmerged_empty_refuses(self):
        for merged, state in ((False, 'open'), (False, 'closed'), (None, 'closed')):
            with self.subTest(merged=merged, state=state):
                ctx = copy.deepcopy(self.context)
                ctx['pull'].update(merged=merged, state=state)
                with self.assertRaisesRegex(train.Refused, 'merged PR binding'):
                    self.check(ctx)
        ctx = copy.deepcopy(self.context)
        ctx['mode'] = 'premerge-source-proof'
        ctx['pull'].update(merged=False, state='open')
        with self.assertRaisesRegex(train.Refused, 'merged PR binding'):
            self.check(ctx)

    def test_missing_or_wrong_context_field_refuses(self):
        for key in self.context:
            for missing in (True, False):
                with self.subTest(key=key, missing=missing):
                    ctx = copy.deepcopy(self.context)
                    if missing:
                        del ctx[key]
                    else:
                        ctx[key] = {} if key == 'pull' else 'wrong'
                    with self.assertRaisesRegex(train.Refused, 'merged PR binding'):
                        self.check(ctx)

    def test_missing_or_wrong_merged_pr_fact_refuses(self):
        paths = [('number',), ('merged',), ('merge_commit_sha',), ('head',), ('head', 'sha'),
                 ('base',), ('base', 'sha'), ('base', 'ref')]
        for path in paths:
            for missing in (True, False):
                with self.subTest(path=path, missing=missing):
                    ctx = copy.deepcopy(self.context)
                    obj = ctx['pull']
                    for key in path[:-1]:
                        obj = obj[key]
                    if missing:
                        del obj[path[-1]]
                    else:
                        obj[path[-1]] = {} if path[-1] in ('head', 'base') else 'wrong'
                    with self.assertRaisesRegex(train.Refused, 'merged PR binding'):
                        self.check(ctx)

    def test_stale_or_forged_merged_context_is_reread(self):
        # A locally plausible context cannot stand in for the current API.
        for change in ({'merged': False, 'state': 'open'}, {'number': 87}, {'title': 'changed since context read'}):
            with self.subTest(change=change):
                self.pull = dict(self.context['pull'], **change)
                with self.assertRaisesRegex(train.Refused, 'fresh PR differs'):
                    self.check()

    def test_matching_forged_merge_sha_cannot_substitute_for_git_commit(self):
        self.context['merge'] = self.context['pull']['merge_commit_sha'] = 'a' * 40
        self.pull = copy.deepcopy(self.context['pull'])
        with self.assertRaisesRegex(train.Refused, 'could not be read'):
            self.check()

    def test_bad_missing_or_reversed_git_parents_tree_and_source_ancestry_refuse(self):
        for variant in ('missing-merge', 'no-parents', 'one-parent', 'wrong-base', 'wrong-head',
                        'reversed', 'extra-parent', 'tree', 'missing-tree', 'ancestry', 'unreadable-ancestry'):
            with self.subTest(variant=variant):
                def git(*args):
                    if args[0] == 'rev-list':
                        if variant == 'missing-merge':
                            return subprocess.CompletedProcess(args, 128, '', 'missing commit')
                        parents = [train.CARRY_752_BASE, train.CARRY_752_HEAD]
                        if variant == 'no-parents': parents = []
                        elif variant == 'one-parent': parents.pop()
                        elif variant == 'wrong-base': parents[0] = 'a' * 40
                        elif variant == 'wrong-head': parents[1] = 'a' * 40
                        elif variant == 'reversed': parents.reverse()
                        elif variant == 'extra-parent': parents.append('a' * 40)
                        return subprocess.CompletedProcess(args, 0, ' '.join([self.context['merge']] + parents), '')
                    if args[0] == 'rev-parse' and variant in ('tree', 'missing-tree'):
                        return subprocess.CompletedProcess(args, 128 if variant == 'missing-tree' else 0, 'a' * 40, '')
                    if args[0] == 'merge-base' and variant in ('ancestry', 'unreadable-ancestry'):
                        self.assertEqual(args[1:], ('--is-ancestor', train.CARRY_752_OLD, train.CARRY_752_HEAD))
                        return subprocess.CompletedProcess(args, 128 if variant == 'unreadable-ancestry' else 1, '', '')
                    return self.git(*args)
                with self.assertRaises(train.Refused):
                    self.check(git=git)

    def test_missing_and_wrong_nonempty_association_never_use_merged_fallback(self):
        association = {'number': 86, 'head': {'sha': train.CARRY_752_HEAD},
                       'base': {'ref': 'release/live73', 'sha': train.CARRY_752_BASE}}
        variants = [None, {}, [association, association], [{}]]
        for path in [('number',), ('head', 'sha'), ('base', 'sha'), ('base', 'ref')]:
            row = copy.deepcopy(association)
            obj = row
            for key in path[:-1]: obj = obj[key]
            obj[path[-1]] = 'wrong'
            variants.append([row])
        for prs in variants:
            with self.subTest(prs=prs):
                self.run['pull_requests'] = prs
                with self.assertRaisesRegex(train.Refused, 'original API PR/head/base'):
                    self.check()
        del self.run['pull_requests']
        with self.assertRaisesRegex(train.Refused, 'original API PR/head/base'):
            self.check()

    def test_original_and_current_nonempty_associations_keep_existing_path(self):
        for head in (train.CARRY_752_OLD, train.CARRY_752_HEAD):
            self.run['pull_requests'] = [{'number': 86, 'head': {'sha': head},
                'base': {'ref': 'release/live73', 'sha': train.CARRY_752_BASE}}]
            with self.subTest(head=head):
                run, _ = train.carry_run(self.binding, self, REPOSITORY, None)
                self.assertEqual(run['head_sha'], train.CARRY_752_OLD)
        self.assertNotIn('repos/' + REPOSITORY + '/pulls/86', self.calls)

    def test_original_run_source_attempt_workflow_and_api_identity_still_refuse(self):
        original = copy.deepcopy(self.run)
        variants = [('head_sha', 'a' * 40), ('run_attempt', 2), ('id', 44284000277),
                    ('event', 'workflow_dispatch'), ('path', '.github/workflows/other.yml'),
                    ('name', 'Other'), ('status', 'in_progress')]
        for key, bad in variants:
            with self.subTest(key=key):
                self.run = dict(original, **{key: bad})
                with self.assertRaises(base_move.Refused):
                    self.check()
        self.run = original
        for key in ('workflow_head', 'source_head', 'attempt'):
            with self.subTest(binding=key):
                original_binding = dict(self.binding)
                self.binding[key] = 2 if key == 'attempt' else 'a' * 40
                with self.assertRaises(train.Refused):
                    self.check()
                self.binding = original_binding

from __future__ import annotations

"""Synthetic adversarial train.judge cases; genuine retained controls are separate."""
import copy
import json
import subprocess
import unittest
from unittest import mock

from tools import base_move, train
import test_tools_base_move as fixtures
from test_tools_train import BRANCH, REPOSITORY


class PostMergeAssociations(fixtures.BaseMoveFixture):
    def setUp(self):
        super().setUp()
        self.raw_check = self.github.answers['repos/' + REPOSITORY + '/check-runs/201']
        self.association = copy.deepcopy(self.raw_check['pull_requests'])
        self.raw_check['pull_requests'] = []
        self.pull['base']['sha'] = self.L

    def consume(self, path=None):
        git = lambda *args: subprocess.run(['git', '-C', str(self.live)] + list(args),
                                           capture_output=True, text=True)
        return train.judge(path or self.candidate(), self.merged, self.L, BRANCH, REPOSITORY, git, self.github)

    def refuses(self, why, path=None):
        with self.assertRaisesRegex(train.Refused, why):
            self.consume(path)

    def test_empty_association_keeps_full_source_and_refusal(self):
        result = self.consume()
        observed = result['base_move']['source_observed']
        self.assertEqual(observed['red_count'], 1)
        self.assertFalse(observed['passed'])
        self.assertEqual(observed['controller']['refusals'], 'the base is not judged here\n')
        self.assertEqual(observed['controller']['output'], self.controller_check['output'])
        self.assertEqual(self.raw_check['pull_requests'], [])
        self.assertNotIn(self.head, base_move.parents(
            lambda *a: subprocess.run(['git', '-C', str(self.live)] + list(a), capture_output=True, text=True), self.merged))

    def test_original_nonempty_path_still_passes(self):
        self.raw_check['pull_requests'] = self.association
        # The nonempty path retains its original contract, including no new
        # requirement on PR API base.sha beyond pull_merge's release ref.
        self.pull['base']['sha'] = 'f' * 40
        self.consume()

    def test_missing_or_nonlist_association_refuses(self):
        for value in (None, {}, '', False):
            with self.subTest(value=value):
                self.raw_check['pull_requests'] = value
                self.refuses('archived check current PR binding')
        del self.raw_check['pull_requests']
        self.refuses('archived check current PR binding')

    def test_nonempty_wrong_association_never_falls_back(self):
        rows = [(('number',), 32), (('head', 'sha'), self.assembly),
                (('base', 'ref'), 'release/wrong'), (('base', 'sha'), self.old)]
        for path, value in rows:
            with self.subTest(path=path):
                row = copy.deepcopy(self.association[0]); obj = row
                for key in path[:-1]: obj = obj[key]
                obj[path[-1]] = value
                self.raw_check['pull_requests'] = [row]
                self.refuses('archived check current PR binding')
        self.raw_check['pull_requests'] = self.association * 2
        self.refuses('archived check current PR binding')

    def test_wrong_actual_pr_fields_refuse(self):
        original = copy.deepcopy(self.pull)
        rows = [(('number',), 32), (('merged',), False), (('merge_commit_sha',), self.assembly),
                (('head', 'sha'), self.head), (('base', 'ref'), 'release/wrong'),
                (('base', 'sha'), self.old)]
        for path, value in rows:
            with self.subTest(path=path):
                self.pull.clear(); self.pull.update(copy.deepcopy(original)); obj = self.pull
                for key in path[:-1]: obj = obj[key]
                obj[path[-1]] = value
                self.refuses('PR|merged|merge commit')

    def test_missing_actual_pr_fields_refuse(self):
        original = copy.deepcopy(self.pull)
        for path in (('merged',), ('merge_commit_sha',), ('head', 'sha'), ('base', 'ref'), ('base', 'sha')):
            with self.subTest(path=path):
                self.pull.clear(); self.pull.update(copy.deepcopy(original)); obj = self.pull
                for key in path[:-1]: obj = obj[key]
                del obj[path[-1]]
                self.refuses('PR|merged|merge commit')

    def test_wrong_train_pr_refuses(self):
        path = self.candidate(); data = json.loads(path.read_text()); data['pr'] = 32
        self.github.answers['repos/' + REPOSITORY + '/pulls/32'] = dict(copy.deepcopy(self.pull), number=32)
        path.write_text(json.dumps(data)); self.refuses('merged PR binding', path)

    def test_missing_actual_pr_refuses(self):
        del self.github.answers['repos/' + REPOSITORY + '/pulls/31']
        self.refuses('could not be read')

    def test_release_ref_must_contain_actual_merge(self):
        self.git(self.origin, 'update-ref', 'refs/heads/' + BRANCH, self.L)
        self.refuses('not on')

    def test_ordered_assembly_and_release_parents(self):
        actual = base_move.parents
        for oid in (self.assembly, self.merged):
            with self.subTest(oid=oid):
                def parents(git, head):
                    rows = actual(git, head)
                    return rows[::-1] if head == oid else rows
                with mock.patch.object(base_move, 'parents', side_effect=parents):
                    self.refuses('parents differ')

    def test_actual_reversed_assembly_parents_refuse(self):
        bad = self.git(self.work, 'commit-tree', self.tree(self.assembly), '-p', self.L,
                       '-p', self.head, '-m', 'synthetic reversed assembly parents')
        self.git(self.live, 'fetch', '-q', str(self.work), bad)
        self.evidence_body['assembly_head'] = bad
        self.refuses('assembly parents differ')

    def test_actual_reversed_release_parents_refuse(self):
        bad = self.git(self.work, 'commit-tree', self.tree(self.assembly), '-p', self.assembly,
                       '-p', self.L, '-m', 'synthetic reversed release parents')
        self.git(self.origin, 'fetch', '-q', str(self.work), bad)
        self.git(self.origin, 'update-ref', 'refs/heads/' + BRANCH, bad)
        self.git(self.live, 'fetch', '-q', str(self.work), bad)
        self.merged = bad
        self.pull.update(merge_commit_sha=bad, head={'sha': self.L})
        self.refuses('release merge parents differ')

    def test_missing_git_chain_refuses(self):
        # Unknown immutable objects cannot turn into empty parent/tree facts.
        self.evidence_body['assembly_head'] = '0' * 40
        self.refuses('git facts unreadable')

    def test_wrong_tree_refuses(self):
        self.evidence_body['assembly_tree'] = self.tree(self.head)
        self.refuses('assembly tree differs')

    def test_wrong_source_live_original_refuse(self):
        for key, value, why in [('source_head', self.old, 'source judgment head'),
                                ('live_base', self.old, 'live base'),
                                ('original_base', self.L, 'stale or unchanged live base')]:
            with self.subTest(key=key):
                original = self.evidence_body[key]; self.evidence_body[key] = value
                self.refuses(why); self.evidence_body[key] = original

    def test_wrong_archived_pr_refuses(self):
        self.controller_producer['producer']['pull_request']['number'] = 32
        self.freeze_controller(); self.refuses('merged PR binding')

    def test_wrong_archived_base_refuses_even_when_resigned(self):
        # Self-consistent synthetic archive + body is still insufficient.
        wrong = 'f' * 40
        self.controller_producer['producer']['pull_request']['base_sha'] = wrong
        self.freeze_controller(); self.evidence_body['source']['controller']['current_base']['sha'] = wrong
        self.refuses('merged PR binding')

    def test_wrong_original_source_base_refuses(self):
        self.evidence_body['source']['base_at_run']['sha'] = self.L
        self.refuses('source merge binding')

    def test_wrong_app_refuses(self):
        self.raw_check['app']['id'] = 1; self.refuses('untrusted Verdict App')

    def test_forged_archive_digest_refuses(self):
        self.github.answers['repos/' + REPOSITORY + '/actions/artifacts/301']['digest'] = 'sha256:' + '0' * 64
        self.refuses('artifact provenance')

    def test_wrong_publication_refuses(self):
        self.published['check_run_id'] = 999
        self.freeze_controller(); self.refuses('published Verdict binding')

    def test_changed_output_refuses(self):
        self.raw_check['output'] = {'title': 'passed', 'summary': 'invented'}
        self.refuses('Verdict output differs')

    def test_wrong_review_body_refuses(self):
        path = self.candidate(); data = json.loads(path.read_text()); ref = data['base_move']
        manifest = base_move.document(ref); manifest['live_release'] += 1
        data['base_move'] = self.save('wrong-body.json', manifest)
        path.write_text(json.dumps(data)); self.refuses('review binding differs', path)

    def test_wrong_review_chain_refuses(self):
        self.review['judgment_audit'] = 'm-unrelated-audit'; self.refuses('independent resolution review')

    def test_wrong_review_diff_refuses(self):
        self.review['diff'] = self.save('forged.diff', b'not the resolution')
        self.refuses('reviewed resolution diff')

    def test_full_source_is_still_required(self):
        del self.files['check-0/run.json']; self.refuses('source artifact')

    def test_approved_ancestry_still_required(self):
        path = self.candidate(); data = json.loads(path.read_text()); data['items'][0]['approved_head'] = '0' * 40
        path.write_text(json.dumps(data)); self.refuses('could not be read', path)

    def test_receipts_still_required(self):
        self.evidence_body['receipts'].pop(); self.refuses('one passing receipt')

    def test_no_base_move_same_tree_parent_still_passes(self):
        path = self.candidate(); data = json.loads(path.read_text()); del data['base_move']
        for kind, id_ in (('actions/runs', 101), ('check-runs', 201)):
            self.github.answers['repos/' + REPOSITORY + '/' + kind + '/' + str(id_)]['head_sha'] = self.assembly
        path.write_text(json.dumps(data))
        self.assertEqual(self.consume(path)['judgment']['head'], self.assembly)

    def test_ordinary_guard_still_refuses_tool_changes(self):
        path = self.candidate(); data = json.loads(path.read_text()); del data['base_move']
        data.update(kind='ordinary', judgment=None)
        path.write_text(json.dumps(data)); self.refuses('ordinary train cannot change', path)

    def test_ordinary_pending_path_still_passes(self):
        safe = self.branch('ordinary-safe', self.L, [('README', 'safe ordinary change\n')])
        self.git(self.origin, 'update-ref', 'refs/heads/' + BRANCH, self.L)
        self.merged = self.merge(safe)
        self.github.answers['repos/' + REPOSITORY + '/pulls/31'] = self.pull
        path = self.candidate(); data = json.loads(path.read_text()); del data['base_move']
        data.update(kind='ordinary', judgment=None, items=[{'item': 481, 'approved_head': safe, 'review': 'fixture review'}])
        path.write_text(json.dumps(data))
        self.assertEqual(self.consume(path)['judgment'], 'pending')

    def test_no_base_move_keeps_direct_parent_guard(self):
        path = self.candidate(); data = json.loads(path.read_text()); del data['base_move']
        path.write_text(json.dumps(data)); self.refuses('not a parent', path)


class MissingMergedContext(unittest.TestCase):
    def test_empty_association_without_context_refuses(self):
        fixture = fixtures.ControllerProvenance()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.raw['pull_requests'] = []
        fixture.refuses('needs merged train context')

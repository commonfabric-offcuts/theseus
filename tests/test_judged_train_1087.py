from __future__ import annotations

"""Core1087 snapshots survive1131; legacy selectors no longer authorize entry.

Producer/Verdict success and late-waiter exceptions are deliberately retired.
Their replacement evidence/ordering/deploy-floor fences are in1131; the real
Core freeze/combine checks below retain their original assertions.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import unittest
from unittest import mock

from tools import deploy, deterministic_admission as proof, gauntlet_admission as admission
from test_gauntlet_admission_987 import Admission987
from test_gauntlet_987 import Freeze987
from test_gauntlet_source_987 import Binder987

REPOSITORY = 'scratch/project'
BRANCH = 'release/current'

class LegacySelectors1087(Admission987):
    def test_1087_complete_legacy_selectors_are_not_admission_authority(self):
        remote = mock.Mock()
        remote.get.side_effect = AssertionError('Verdict must not be fetched as an admission gate')
        with self.assertRaisesRegex(admission.Refused, 'version1131'):
            admission.admit(self.config, self.head, deploy.run,
                            producer={'run':101, 'check':201, 'pr':7}, github=remote)
        self.assertFalse(remote.get.called)

    def test_1087_bare_started_landing_is_not_admission_authority(self):
        for started in (False, True):
            with self.subTest(started=started), self.assertRaisesRegex(admission.Refused, 'version1131'):
                admission.admit(self.config, self.head, deploy.run, started_landing=started)

    def test_1087_invalid_selector_shape_refuses_before_any_record_read(self):
        trained = {'kind': 'judged-first', 'pr': 7, 'judgment': {
            'producer_runs': [101], 'verdict_checks': [201], 'audit': 'm-scratch1087'}}
        for producer in [{'run': 101}, {'run': 0, 'check': 201, 'pr': 7},
                         {'run': True, 'check': 201, 'pr': 7},
                         {'run': '101', 'check': 201, 'pr': 7},
                         {'run': 101, 'check': 201, 'pr': None},
                         {'run': 101, 'check': 201, 'pr': 7, 'extra': 1}, []]:
            for candidate in (self.head, self.ordinary):
                for entry in ('admission', 'deploy', 'trained'):
                    with self.subTest(producer=producer, candidate=candidate, entry=entry):
                        read = mock.Mock(side_effect=AssertionError('invalid selectors reached record reads'))
                        with self.assertRaisesRegex((admission.Refused, deploy.Refused), 'selectors'):
                            if entry == 'admission':
                                admission.admit(self.config, candidate, read, producer=producer)
                            else:
                                with mock.patch.object(deploy, 'run', read):
                                    deploy.admit(self.config, candidate, producer=producer,
                                                 trained=trained if entry == 'trained' else None)
                        self.assertFalse(read.called)

class CoreTrain1087(Freeze987):
    def test_1087_homogeneous_judged_combine_keeps_every_source_snapshot(self):
        first = self.piece([1]); second = self.piece([2], 'second-1087')
        for piece in (first, second):
            self.committed(self.freeze(piece)); self.wait(piece)
        result = self.committed(self.combine([first, second]))
        view = self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})
        release = view['release_piece']
        self.assertEqual(release['id'], result['piece_id'])
        self.assertEqual([s['id'] for s in release['train_sources']], [first, second])
        self.assertTrue(all(s['freeze']['judged'] for s in release['train_sources']))
        self.assertEqual(release['commit'], 'c' * 40)

    def test_1087_unapproved_missing_and_mixed_refuse_without_combine_facts(self):
        first = self.piece([1]); second = self.piece([2], 'second-1087')
        self.committed(self.freeze(first)); self.wait(first)
        before = self.sql('SELECT * FROM pipeline_facts')
        self.rejected(self.combine([first, second]), 'PIECE_NOT_APPROVED')
        self.wait(second)
        self.rejected(self.combine([first, second]), 'FREEZE_REQUIRED')
        self.committed(self.command('pipeline.stage_enter', {'stage_id': 'review', 'left_outcome': 'held'},
            {'piece_id': second}, {'piece_revision': self.version(second)}, actor='owner'))
        self.committed(self.freeze(second, ['web/a'])); self.wait(second)
        self.rejected(self.combine([first, second]), 'JUDGED_BUNDLE')
        self.assertEqual(self.sql('SELECT * FROM pipeline_facts'), before)

    def test_1087_canonical_approval_does_not_disappear_in_review_deferral(self):
        piece = self.piece([1])
        with mock.patch('aim_next.piece_freeze._now_ms', return_value=100):
            self.committed(self.freeze(piece, ['web/a']))
        with mock.patch('aim_next.pipeline._now_ms', return_value=150):
            self.committed(self.command('pipeline.stage_enter', {'stage_id': 'review', 'left_outcome': 'approved'},
                {'piece_id': piece}, {'piece_revision': self.version(piece)}, actor='owner'))
        with mock.patch('aim_next.pipeline._now_ms', return_value=200): self.wait(piece)
        with mock.patch('aim_next.pipeline._now_ms', return_value=300):
            self.committed(self.command('pipeline.stage_enter', {'stage_id': 'review', 'left_outcome': 'held'},
                {'piece_id': piece}, {'piece_revision': self.version(piece)}, actor='owner'))
        with mock.patch('aim_next.pipeline._now_ms', return_value=400): self.wait(piece)
        view = self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})
        found = next(p for p in view['pieces'] if p['id'] == piece)
        self.assertEqual(found['approval']['at_ms'], 200)

    def test_1087_reversed_approval_order_and_missing_candidate_refuse_atomically(self):
        a = self.piece([1]); b = self.piece([2], 'second-order1087')
        for piece in (a, b):
            self.committed(self.freeze(piece)); self.wait(piece)
        before = self.sql('SELECT * FROM pipeline_facts')
        self.rejected(self.combine([b, a]), 'JUDGED_ORDER')
        self.build_topic('release-order1087')
        self.rejected(self.command('pipeline.combine', {'piece_ids': [a, b], 'topic_id': 'release-order1087'},
                                  {'workspace_id': 'w1'}, actor='owner'), 'INVALID_ARGUMENT')
        self.assertEqual(self.sql('SELECT * FROM pipeline_facts'), before)


class CoreEntry1087(Binder987):
    def test_1087_actual_core_freeze_combine_and_source_read_one_snapshot(self):
        first = self.piece([1]); second = self.piece([2], 'second-entry1087')
        heads = []
        for piece, path, number in [(first, 'tools/deploy.py', 1), (second, 'tools/train.py', 2)]:
            (self.repo / path).write_text('# changed synthetic guarded source ' + str(number))
            self.git('add', path); self.git('commit', '-qm', 'Scratch source\n\nPipeline: ' + str(number))
            head = self.git('rev-parse', 'HEAD'); heads.append(head)
            result = self.cli(piece, self.base, head)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.wait(piece)
        head = heads[-1]
        page = self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})
        started = max(p['approval']['at_ms'] for p in page['pieces']) + 1
        self.build_topic('release-entry1087')
        result = self.committed(self.command('pipeline.combine', {'piece_ids': [first, second],
            'topic_id': 'release-entry1087', 'commit_sha': head}, {'workspace_id': 'w1'}, actor='owner'))
        self.git('checkout', '--detach', self.base)
        (self.repo / 'bin').mkdir()
        (self.repo / 'bin/aim-next').symlink_to(Path(deploy.__file__).resolve().parents[1] / 'bin/aim-next')
        config = type('Config', (), dict(live=self.repo, python='/usr/bin/python3',
            pipeline_broker=None, pipeline_profile=self.profile, pipeline_instance='test-instance',
            pipeline_outcome='w1', repository=REPOSITORY, release_branch=BRANCH))()
        pieces, waiting, revision = admission.approved(config, deploy.run)
        sources = admission._sources(config, pieces, waiting, {1, 2}, head, deploy.run,
                                     lambda *args: self.git(*args), head)
        answer = {'items': [1, 2], 'sources': sources, 'pipeline_revision': revision}
        # Producer/Verdict selectors no longer authorize this bundle. The full
        # deterministic admission is exercised in1131, while this real Core
        # fixture retains its authoritative source snapshot checks.
        with self.assertRaisesRegex(admission.Refused, 'version1131'):
            admission.admit(config, head, deploy.run, producer={'run': 101, 'check': 201, 'pr': 7})
        self.assertEqual(answer['items'], [1, 2])
        self.assertEqual([s['freeze']['head_commit'] for s in answer['sources']], heads)
        self.assertEqual(self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})['release_piece']['id'],
                         result['piece_id'])
        self.git('merge', '--no-ff', '-qm', 'Exact judged merge', head)
        merged = self.git('rev-parse', 'HEAD')
        self.git('checkout', '--detach', self.base)
        pieces, waiting, revision = admission.approved(config, deploy.run)
        after_sources = admission._sources(config, pieces, waiting, {1, 2}, merged, deploy.run,
                                           lambda *args: self.git(*args), head)
        after_merge = {'head_commit': merged, 'sources': after_sources}
        self.assertEqual([s['freeze']['head_commit'] for s in after_sources], heads)
        self.assertEqual(after_merge['head_commit'], merged)
        # The source pieces are closed after combine. Admission can still
        # distinguish the topic creator and freeze author from the auditor
        # through the same bound CLI, including an actor disabled meanwhile.
        self.store.register_actor('auditor-prod', 'agent', 'Scratch independent auditor')
        outcome, read = admission._admission_reader(config, deploy.run)
        admission._require_enabled_auditor(read, 'auditor-prod')
        admission._require_independent_auditor(read, outcome, 'auditor-prod', after_sources, revision)
        for actor in ('agent-a', 'owner'):
            with self.subTest(actor=actor), self.assertRaisesRegex(admission.Refused, 'independent'):
                admission._require_independent_auditor(read, outcome, actor, after_sources, revision)
        self.committed(self.command('participation.set', {'actor_id': 'auditor-prod', 'present': True},
                                    {'topic_id': 't1'}, actor='owner'))
        request = self.committed(self.command('message.post', {'body': 'Review the retained exact evidence.'},
                                              {'topic_id': 't1'}, actor='owner'))['message_id']
        evidence = {'carry': {'created_at_ms': started}}
        decision = {'decision': 'accept', 'evidence_sha256': proof.evidence_digest(evidence),
                    'approval_before_carry': True, 'carry_started_at_ms': started}
        result = self.committed(self.command('message.post', {
            'body': '(codex) auditor_prod —1131 ' + json.dumps(decision), 'reply_to': request,
            'reply_passage': {'source': {'kind': 'message', 'id': request, 'revision': 1}, 'start': 0, 'end': 6}
        }, {'topic_id': 't1'}, actor='auditor-prod'))
        evidence['audit'] = {'message': result['message_id'], 'revision': 1}
        source = admission._audit_source(config, deploy.run, evidence['audit'], 'auditor-prod', after_sources, revision)
        self.assertEqual(source['reply_basis']['excerpt'], 'Review')
        proof.audit(evidence, source, 'auditor-prod')
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE actors SET enabled=0 WHERE id='auditor-prod'")
        with self.assertRaisesRegex(admission.Refused, 'missing or disabled'):
            admission._require_enabled_auditor(read, 'auditor-prod')
        retain = os.environ.get('JUDGED_1087_EVIDENCE')
        if retain:
            folder = Path(retain) / self.id(); folder.mkdir(parents=True, exist_ok=True)
            (folder / 'core-and-entry.json').write_text(json.dumps(
                {'combine': result, 'admission': answer, 'after_merge': after_merge}, indent=2))



def load_tests(loader, tests, pattern):
    return unittest.TestSuite(case(name) for case in (LegacySelectors1087, CoreTrain1087, CoreEntry1087)
        for name in loader.getTestCaseNames(case) if name.startswith('test_1087_'))

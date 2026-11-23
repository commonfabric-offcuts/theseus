from __future__ import annotations

"""Scratch Git/Core and executable GET adapter; no live account or network."""
import copy
import datetime
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest import mock

from tools import deploy, gauntlet_admission as admission, train
from test_gauntlet_admission_987 import Admission987
from test_gauntlet_987 import Freeze987
from test_gauntlet_source_987 import Binder987
import test_tools_train as train_fixture

START = 1767225601000
REPOSITORY = 'scratch/project'
BRANCH = 'release/current'


class Remote:
    def __init__(self, head, base, started=START, repository=REPOSITORY, branch=BRANCH, pr_number=7):
        self.repository = repository
        pr = {'number': pr_number, 'head': {'sha': head, 'repo': {'full_name': repository}},
              'base': {'sha': base, 'ref': branch, 'repo': {'full_name': repository}}}
        timestamp = datetime.datetime.fromtimestamp(started / 1000, datetime.timezone.utc).isoformat()
        prefix = 'repos/' + repository
        self.rows = {
            prefix + '/pulls/%d' % pr_number: pr,
            prefix + '/actions/runs/101': {
                'id': 101, 'run_attempt': 1, 'head_sha': head, 'event': 'pull_request',
                'name': 'Checks', 'path': '.github/workflows/checks.yml', 'workflow_id': 301,
                'status': 'completed', 'conclusion': 'success', 'run_started_at': timestamp,
                'repository': {'full_name': repository}, 'head_repository': {'full_name': repository},
                'pull_requests': [copy.deepcopy(pr)]},
            prefix + '/actions/workflows/301': {'id': 301, 'path': '.github/workflows/checks.yml'},
            prefix + '/actions/runs/102': {
                'id': 102, 'run_attempt': 1, 'head_sha': 'c' * 40, 'event': 'workflow_run',
                'name': 'Verdict', 'path': '.github/workflows/verdict.yml', 'workflow_id': 302,
                'status': 'completed', 'conclusion': 'success',
                'repository': {'full_name': repository}},
            prefix + '/actions/workflows/302': {'id': 302, 'path': '.github/workflows/verdict.yml'},
            prefix + '/check-runs/201': {
                'id': 201, 'head_sha': head, 'name': 'Verdict', 'status': 'completed',
                'conclusion': 'success', 'app': dict(train.VERDICT_APP), 'external_id': '101-1',
                'details_url': 'https://github.com/' + repository + '/actions/runs/102',
                'pull_requests': [copy.deepcopy(pr)]}}
        self.asked = []

    def get(self, path):
        self.asked.append(path)
        if path not in self.rows:
            raise train.Unreadable('unexpected scratch GET ' + path)
        return copy.deepcopy(self.rows[path])

    def row(self, suffix):
        return self.rows['repos/' + self.repository + suffix]


class Admission1087(Admission987):
    def setUp(self):
        super().setUp()
        self.config.repository = REPOSITORY
        self.config.release_branch = BRANCH
        self.first = self.head
        self.git('checkout', '--detach', self.first)
        (self.repo / 'tools/train.py').write_text('# second guarded scratch source\n')
        self.git('add', 'tools/train.py')
        self.git('commit', '-qm', 'Second judged source\n\nPipeline: 999')
        self.head = self.git('rev-parse', 'HEAD')
        self.git('checkout', '--detach', self.base)
        self.remote = Remote(self.head, self.base)
        self.producer = {'run': 101, 'check': 201, 'pr': 7}
        self.sources = [self.source(987, self.first, 100, 1), self.source(999, self.head, 200, 2)]
        self.publish(self.sources)

    def source(self, number, head, approved, sequence, judged=True):
        value = self.piece(number, judged)
        value['freeze'].update(base_commit=self.base, head_commit=head, at_ms=1)
        if number == 999 and judged:
            value['freeze'].update(base_commit=self.first, files=['tools/train.py'])
        value['approval'] = {'at_ms': approved, 'seq': sequence}
        return value

    def publish(self, pieces, waiting=None):
        self.pages({0: self.page(pieces, [n for p in pieces for n in p['items']] if waiting is None else waiting)})

    def admit(self, **more):
        return admission.admit(self.config, self.head, deploy.run,
                               producer=self.producer, github=self.remote, **more)

    def test_1087_one_complete_run_admits_every_frozen_judged_source(self):
        answer = self.admit()
        self.assertEqual(answer['items'], [987, 999])
        self.assertEqual([p['piece_id'] for p in answer['sources']], ['p-987', 'p-999'])
        self.assertEqual(answer['producer']['run'], 101)
        self.assertEqual(answer['producer']['started_at_ms'], START)
        self.assertEqual(answer['passed_waiters'], [])
        self.assertIn('repos/' + REPOSITORY + '/actions/runs/101', self.remote.asked)

    def test_1087_later_waiter_is_named_with_canonical_and_run_times(self):
        waiter = self.source(42, self.ordinary, START + 1, 3, False)
        self.publish(self.sources + [waiter])
        answer = self.admit()
        self.assertEqual(answer['passed_waiters'], [
            {'piece_id': 'p-42', 'items': [42], 'approved_at_ms': START + 1}])
        self.assertEqual(answer['producer']['started_at_ms'], START)

    def test_1087_equal_earlier_or_missing_approval_refuses_before_effect(self):
        for approval in ({'at_ms': START, 'seq': 3}, {'at_ms': START - 1, 'seq': 3}, None):
            waiter = self.source(42, self.ordinary, START + 1, 3, False)
            waiter['approval'] = approval
            self.publish(self.sources + [waiter])
            effects = []
            with self.subTest(approval=approval), self.assertRaises(admission.Refused):
                self.admit()
                effects.append('land')
            self.assertEqual(effects, [])

    def test_1087_no_context_or_bare_started_landing_never_authorizes_bundle(self):
        for started in (False, True):
            with self.subTest(started=started), self.assertRaises(admission.Refused):
                admission.admit(self.config, self.head, deploy.run, started_landing=started)

    def test_1087_incomplete_cancelled_or_missing_run_start_refuses(self):
        for field, value in [('status', 'in_progress'), ('conclusion', 'cancelled'),
                             ('run_started_at', None), ('run_started_at', '2026-01-01T00:00:01')]:
            remote = Remote(self.head, self.base)
            remote.row('/actions/runs/101')[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(admission.Refused):
                admission.admit(self.config, self.head, deploy.run, producer=self.producer, github=remote)

    def test_1087_wrong_run_head_workflow_or_fork_refuses(self):
        for field, value in [('head_sha', self.first), ('path', '.github/workflows/other.yml'),
                             ('event', 'push'), ('head_repository', {'full_name': 'foreign/fork'})]:
            remote = Remote(self.head, self.base)
            remote.row('/actions/runs/101')[field] = value
            with self.subTest(field=field), self.assertRaises(admission.Refused):
                admission.admit(self.config, self.head, deploy.run, producer=self.producer, github=remote)

    def test_1087_forged_or_failed_verdict_attempt_and_controller_refuse(self):
        for suffix, field, value in [
                ('/check-runs/201', 'app', {'id': 1, 'slug': 'foreign'}),
                ('/check-runs/201', 'conclusion', 'failure'),
                ('/check-runs/201', 'external_id', '101-2'),
                ('/check-runs/201', 'head_sha', self.first),
                ('/actions/runs/102', 'event', 'push'),
                ('/actions/runs/102', 'status', 'in_progress')]:
            remote = Remote(self.head, self.base)
            remote.row(suffix)[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(admission.Refused):
                admission.admit(self.config, self.head, deploy.run, producer=self.producer, github=remote)

    def test_1087_stale_pr_base_and_source_tree_refuse(self):
        remote = Remote(self.head, self.base)
        remote.row('/pulls/7')['base']['sha'] = self.first
        with self.assertRaises(admission.Refused):
            admission.admit(self.config, self.head, deploy.run, producer=self.producer, github=remote)
        self.git('checkout', '--detach', self.head)
        (self.repo / 'changed').write_text('candidate differs from judged source')
        changed = self.commit('Changed after the run')
        self.git('checkout', '--detach', self.base)
        with self.assertRaises(admission.Refused):
            admission.admit(self.config, changed, deploy.run, producer=self.producer, github=self.remote)

    def test_1087_unapproved_missing_or_ordinary_constituent_refuses(self):
        for mode in ('missing', 'unapproved', 'ordinary', 'foreign-head'):
            values = copy.deepcopy(self.sources)
            waiting = [987, 999]
            if mode == 'missing': values[1]['freeze'] = None
            if mode == 'unapproved': waiting = [987]
            if mode == 'ordinary':
                values[1]['freeze'].update(judged=False, files=['web/a'])
            if mode == 'foreign-head': values[1]['freeze']['head_commit'] = 'f' * 40
            self.publish(values, waiting)
            with self.subTest(mode=mode), self.assertRaises(admission.Refused): self.admit()

    def test_1087_pipeline_revision_crossing_and_duplicate_sources_refuse(self):
        first = self.page(self.sources, [987, 999], cursor=20)
        later = self.page(self.sources, [987, 999]); later['relevant_versions']['pipeline'] = 2
        self.pages({0: first, 20: later})
        with self.assertRaises(admission.Refused): self.admit()
        duplicate = copy.deepcopy(self.sources[0]); duplicate['id'] = 'p-duplicate'
        self.publish(self.sources + [duplicate])
        with self.assertRaises(admission.Refused): self.admit()

    def test_1087_actual_cli_reads_executable_remote_and_retains_refusal_exit(self):
        executable = self.root / 'executables'; executable.mkdir()
        data = self.root / 'remote.json'; data.write_text(json.dumps(self.remote.rows))
        gh = executable / 'gh'
        gh.write_text('#!/usr/bin/python3\nimport json,sys\nfrom pathlib import Path\n'
                      'rows=json.loads(Path(' + repr(str(data)) + ').read_text())\n'
                      'print(json.dumps(rows[sys.argv[-1]]))\n')
        gh.chmod(0o700)
        config = self.root / 'deploy.json'
        config.write_text(json.dumps(dict(live=str(self.repo), instance=str(self.root),
            server_profile='server.json', runner_profile='runner.json', routes='routes.json',
            runner_id='scratch-runner', port=12345, repository=REPOSITORY, release_branch=BRANCH,
            pipeline_outcome='work987', pipeline_instance='scratch987',
            pipeline_broker=str(self.root / 'core.sock'))))
        environment = dict(os.environ, PATH=str(executable) + os.pathsep + os.environ['PATH'])
        argv = ['/usr/bin/python3', '-I', str(Path(deploy.__file__).resolve()), 'admit', self.head,
                '--config', str(config), '--producer-run', '101', '--verdict-check', '201', '--pr', '7']
        accepted = subprocess.run(argv, env=environment, capture_output=True, text=True)
        self.retain('accepted-cli', argv, accepted, self.remote.rows)
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout)['items'], [987, 999])
        self.remote.row('/actions/runs/101')['status'] = 'in_progress'
        data.write_text(json.dumps(self.remote.rows))
        refused = subprocess.run(argv, env=environment, capture_output=True, text=True)
        self.retain('refused-cli', argv, refused, self.remote.rows)
        self.assertEqual(refused.returncode, 1, refused.stdout + refused.stderr)
        self.assertIn('refused:', refused.stderr)

    def retain(self, name, argv, answer, remote):
        target = os.environ.get('JUDGED_1087_EVIDENCE')
        if target:
            folder = Path(target) / self.id(); folder.mkdir(parents=True, exist_ok=True)
            (folder / (name + '.json')).write_text(json.dumps({
                'command': argv, 'exit': answer.returncode, 'stdout': answer.stdout,
                'stderr': answer.stderr, 'remote_get_records': remote}, indent=2))

    def test_1087_actual_cli_single_no_blocker_validates_optional_selectors(self):
        self.publish(self.sources[:1])
        executable = self.root / 'selector-executable'; executable.mkdir()
        marker = self.root / 'unexpected-remote-read'
        gh = executable / 'gh'
        gh.write_text('#!/usr/bin/python3\nfrom pathlib import Path\n'
                      'Path(' + repr(str(marker)) + ').write_text("unexpected remote")\nraise SystemExit(9)\n')
        gh.chmod(0o700)
        config = self.root / 'selector-deploy.json'
        config.write_text(json.dumps(dict(live=str(self.repo), instance=str(self.root),
            server_profile='server.json', runner_profile='runner.json', routes='routes.json',
            runner_id='scratch-runner', port=12345, repository=REPOSITORY, release_branch=BRANCH,
            pipeline_outcome='work987', pipeline_instance='scratch987',
            pipeline_broker=str(self.root / 'core.sock'))))
        base = ['/usr/bin/python3', '-I', str(Path(deploy.__file__).resolve()), 'admit', self.first,
                '--config', str(config)]
        environment = dict(os.environ, PATH=str(executable) + os.pathsep + os.environ['PATH'])
        for name, flags, expected in [
                ('omitted', [], 0),
                ('complete', ['--producer-run', '101', '--verdict-check', '201', '--pr', '7'], 0),
                ('run-only', ['--producer-run', '101'], 1),
                ('check-only', ['--verdict-check', '201'], 1),
                ('pr-only', ['--pr', '7'], 1),
                ('missing-pr', ['--producer-run', '101', '--verdict-check', '201'], 1),
                ('zero', ['--producer-run', '0', '--verdict-check', '201', '--pr', '7'], 1),
                ('negative', ['--producer-run', '101', '--verdict-check', '-1', '--pr', '7'], 1)]:
            with self.subTest(name=name):
                answer = subprocess.run(base + flags, env=environment, capture_output=True, text=True)
                self.retain('selector-' + name, base + flags, answer, {})
                self.assertEqual(answer.returncode, expected, answer.stdout + answer.stderr)
                if expected:
                    self.assertIn('selectors', answer.stderr)
                else:
                    self.assertEqual(json.loads(answer.stdout)['items'], [987])
                self.assertFalse(marker.exists(), 'shape/legacy admission must not read remote metadata')

    def test_1087_invalid_selector_shape_refuses_before_any_record_read(self):
        trained = {'kind': 'judged-first', 'pr': 7, 'judgment': {
            'producer_runs': [101], 'verdict_checks': [201], 'audit': 'm-scratch1087'}}
        for producer in [{'run': 101}, {'run': 0, 'check': 201, 'pr': 7},
                         {'run': True, 'check': 201, 'pr': 7},
                         {'run': '101', 'check': 201, 'pr': 7},
                         {'run': 101, 'check': 201, 'pr': None},
                         {'run': 101, 'check': 201, 'pr': 7, 'extra': 1}, []]:
            for candidate in (self.first, self.ordinary):
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
    def test_1087_actual_core_freeze_combine_and_admission_read_one_snapshot(self):
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
        answer = admission.admit(config, head, deploy.run, producer={'run': 101, 'check': 201, 'pr': 7},
                                 github=Remote(head, self.base, started))
        self.assertEqual(answer['items'], [1, 2])
        self.assertEqual([s['freeze']['head_commit'] for s in answer['sources']], heads)
        self.assertEqual(self.store.view('owner', 'pipeline', {'workspace_id': 'w1'})['release_piece']['id'],
                         result['piece_id'])
        self.git('merge', '--no-ff', '-qm', 'Exact judged merge', head)
        merged = self.git('rev-parse', 'HEAD')
        self.git('checkout', '--detach', self.base)
        after_merge = admission.admit(config, merged, deploy.run,
            producer={'run': 101, 'check': 201, 'pr': 7}, github=Remote(head, self.base, started))
        self.assertEqual(after_merge['producer']['head_commit'], head)
        self.assertEqual(after_merge['head_commit'], merged)
        retain = os.environ.get('JUDGED_1087_EVIDENCE')
        if retain:
            folder = Path(retain) / self.id(); folder.mkdir(parents=True, exist_ok=True)
            (folder / 'core-and-entry.json').write_text(json.dumps(
                {'combine': result, 'admission': answer, 'after_merge': after_merge}, indent=2))


class DeployEntry1087(train_fixture.TrainCase):
    def setUp(self):
        super().setUp()
        self.head = self.branch('judged1087', self.L, [('tools/deploy.py', '# judged1087\n')])
        self.merged = self.merge(self.head)
        self.config = self.config._replace(pipeline_outcome='scratch1087', pipeline_instance='scratch1087',
                                           pipeline_broker=self.instance / 'core.sock', pipeline_profile=None)
        remote = Remote(self.head, self.L, repository=train_fixture.REPOSITORY,
                        branch=train_fixture.BRANCH, pr_number=train_fixture.PR)
        self.github = self.hub()
        self.github.answers.update(remote.rows)
        pull = self.github.answers['repos/' + train_fixture.REPOSITORY + '/pulls/' + str(train_fixture.PR)]
        pull.update(merged=True, merge_commit_sha=self.merged)
        self.manifest = self.train(self.merged, [self.head], kind='judged-first',
            judgment={'producer_runs': [101], 'verdict_checks': [201], 'audit': 'm-scratch1087'})
        self.approval = START + 1
        self.reads = 0
        fake = self.host()
        self.fake = fake
        def run(argv, **kwargs):
            if argv[-1:] == ['binding']:
                return subprocess.CompletedProcess(argv, 0, json.dumps({'binding': {'instance_id': 'scratch1087'}}), '')
            if argv[-2:] == ['view', '-']:
                self.reads += 1
                def piece(number, judged, approved):
                    return {'id': 'p-' + str(number), 'items': [number], 'version': 4, 'stage': {'stage_id': 'wait'},
                        'approval': {'at_ms': approved, 'seq': number}, 'freeze': {'base_commit': self.L,
                        'head_commit': self.head, 'files': ['tools/deploy.py'] if judged else ['web/a'],
                        'judged': judged, 'by': 'scratch-builder', 'at_ms': 1, 'piece_revision': 2}}
                page = {'instance_id': 'scratch1087', 'workspace_id': 'scratch1087',
                    'relevant_versions': {'pipeline': 1}, 'pipeline': {'enabled': True, 'ships_in_releases': True},
                    'items': [], 'pieces': [piece(481, True, START - 1), piece(42, False, self.approval)],
                    'facts': {'approved_waiting': [481, 42], 'next_release': None}, 'next_cursor': None}
                return subprocess.CompletedProcess(argv, 0, json.dumps(page), '')
            return fake(argv, **kwargs)
        self.host_run = run

    def tearDown(self):
        self.retain()
        super().tearDown()

    def retain(self):
        target = os.environ.get('JUDGED_1087_EVIDENCE')
        if target:
            folder = Path(target) / self.id(); folder.mkdir(parents=True, exist_ok=True)
            for path in self.evidence.glob('*.json'):
                (folder / path.name).write_bytes(path.read_bytes())
            (folder / 'host-observations.json').write_text(json.dumps({'reads': self.reads,
                'calls': self.fake.calls, 'written': self.fake.written, 'kills': self.kills}, indent=2))

    def test_1087_actual_deploy_both_floors_keep_authenticated_passed_waiters(self):
        self.trained(self.host_run, self.manifest, self.merged, self.github)
        self.assertEqual(self.reads, 2)
        for step in ('00-admission', '02-admission'):
            answer = self.evidence_of(step)
            self.assertEqual(answer['producer']['run'], 101)
            self.assertEqual(answer['passed_waiters'][0]['piece_id'], 'p-42')
        kept = self.evidence_of('02-release')['record']['measurements']['train']['admission']
        self.assertEqual(kept['passed_waiters'][0]['approved_at_ms'], START + 1)

    def repeated_verdict(self):
        prefix = 'repos/' + train_fixture.REPOSITORY + '/check-runs/'
        newer = copy.deepcopy(self.github.answers[prefix + '201'])
        newer['id'] = 202
        self.github.answers[prefix + '202'] = newer
        self.github.answers[prefix + '201']['conclusion'] = 'failure'
        record = json.loads(self.manifest.read_text())
        # The train keeps every conclusion; ordering is not a freshness claim.
        record['judgment']['verdict_checks'] = [202, 201]
        self.manifest.write_text(json.dumps(record))
        return record

    def test_1087_actual_deploy_repeated_verdict_keeps_ids_and_newest_check(self):
        record = self.repeated_verdict()
        self.trained(self.host_run, self.manifest, self.merged, self.github)
        self.assertEqual(json.loads(self.manifest.read_text()), record)
        self.assertEqual(self.reads, 2)
        for step in ('00-admission', '02-admission'):
            self.assertEqual(self.evidence_of(step)['producer']['check'], 202)
        judgment = self.evidence_of('02-release')['record']['measurements']['train']['judgment']
        self.assertEqual([(check['id'], check['conclusion']) for check in judgment['verdict_checks']],
                         [(202, 'success'), (201, 'failure')])

    def test_1087_raw_train_ids_select_newest_check_through_admission(self):
        record = self.repeated_verdict()
        with mock.patch.object(deploy, 'run', self.host_run):
            answer = deploy.admit(self.config, self.merged, trained=record, github=self.github)
        self.assertEqual((answer['producer']['run'], answer['producer']['check']), (101, 202))
        self.assertEqual(answer['passed_waiters'][0]['piece_id'], 'p-42')
        self.assertEqual(json.loads(self.manifest.read_text()), record)

    def test_1087_new_earlier_waiter_at_second_floor_stops_before_effects(self):
        original = deploy.runner_policy
        def policy(*args, **kwargs):
            self.approval = START - 1
            return original(*args, **kwargs)
        with mock.patch.object(deploy, 'runner_policy', side_effect=policy):
            with self.assertRaisesRegex(deploy.Refused, 'p-42'):
                self.deployed(self.host_run, self.manifest, self.merged, self.github)
        self.assertEqual(self.reads, 2)
        self.assertEqual(self.kills, [])
        self.assertEqual(self.fake.written, [])
        self.assertFalse((self.evidence / '02-checks.json').exists())

    def test_1087_invalid_producer_stops_actual_deploy_before_plan_or_host(self):
        self.github.answers['repos/' + train_fixture.REPOSITORY + '/actions/runs/101']['path'] = 'foreign.yml'
        with self.assertRaisesRegex(deploy.Refused, 'producer'):
            self.deployed(self.host_run, self.manifest, self.merged, self.github)
        self.assertFalse((self.evidence / '00-plan.json').exists())
        self.assertEqual(self.kills, [])
        self.assertEqual(self.fake.written, [])


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(case(name) for case in (Admission1087, CoreTrain1087, CoreEntry1087, DeployEntry1087)
        for name in loader.getTestCaseNames(case) if name.startswith('test_1087_'))

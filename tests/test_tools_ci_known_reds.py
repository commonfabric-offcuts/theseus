from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from tools import ci_known_reds as ci, release_check


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


class Evidence(unittest.TestCase):
    """A complete fabricated CI run, backed by real isolated Git source trees.

    No browser, server or live agent is launched. Mutations alter transported
    evidence independently, so counts alone cannot satisfy coverage/provenance.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ci-known-reds-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.repo, self.base = self.folder / 'candidate', self.folder / 'base'
        self.repo.mkdir()
        self.command('init', '-q')
        paths = set(release_check.harnesses()) | {'tests/reader_inline_native.mjs', 'tools/ci_known_reds.py',
                                                'tools/known_reds.py', 'tools/release_check.py',
                                                'tests/test_example.py', 'tests/fixtures/at_names.json', 'docs/tools.md',
                                                'tools/ci_input_reads.py', 'tools/ci-input-reads.json', ci.PRODUCER_WORKFLOW}
        for path in paths:
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ci.ROOT / path).read_bytes() if path.startswith('tools/') or path in (release_check.REPLAY_FILE, 'tests/fixtures/at_names.json')
                               else b'# stand-in source\nassert actual == expected\n' if path.endswith('.py')
                               else b'name: Checks\n' if path == ci.PRODUCER_WORKFLOW
                               else b'// stand-in source\nassert.equal(actual, expected);\nawait helper();\n')
        self.source_commit = self.commit('inventory sources')
        self.profile = {'runner_os': 'macOS', 'runner_arch': 'ARM64', 'image_os': 'macos-26', 'image_version': 'v1',
                        'scroll_bars': 'Always', 'reduce_motion': False, 'cpus': 3,
                        'chrome': '156', 'node': '26', 'python': '3.9', 'playwright': '1.63'}
        self.row = {'name': 'case', 'passed': False,
                    'error': 'AssertionError [ERR_ASSERTION]: value\n\n2 !== 3\n\n'
                             '    at helper (/verified/tests/reader_inline_native.mjs:2:1)\n'
                             '    at check (/verified/tests/reader_persistence_native.mjs:3:1)'}
        self.policy = {'version': 1, 'source_commit': self.source_commit,
                       'source_hashes': {p: ci.blob(ci.source(self.repo, self.source_commit, p))
                                         for p in paths},
                       'required': list(release_check.REQUIRED),
                       'inventory': {name: [ci.identity(self.row)] for name in ci.NATIVE}, 'reds': []}
        self.policy['inventory'].update({name: [ci.identity({'name': 'test_one (example.Example)'}),
                                               ci.identity({'name': 'test_two (example.Example)'})]
                                         for name in ('python-units', 'deploy-refusals')})
        self.policy['inventory']['node-units'] = [ci.identity({'name': name}) for name in ('one', 'two')]
        self.red = {'step': 'native-inline', 'case': ci.identity(self.row), 'owner': 'test-owner',
                    'why': 'reviewed same assertion', 'review': 'review-message',
                    'observed_profile': self.profile, 'target_profile': self.profile,
                    'source_commit': self.source_commit, 'evidence_sha256': 'a' * 64,
                    'fingerprint': ci.fingerprint(self.row['error'], '/verified', self.repo, self.source_commit),
                    'completion': {'browserClosed': True, 'fixtureExitCode': 0, 'ended': True}}
        self.policy['reds'] = [self.red]
        write(self.repo / '.github/check-baseline.json', self.policy)
        self.base_sha = self.commit('review policy')
        self.command('worktree', 'add', '-q', '--detach', str(self.base), self.base_sha)
        (self.repo / 'application.txt').write_text('candidate change\n')
        self.sha = self.commit('candidate')
        self.tree = ci.git(self.repo, 'rev-parse', 'HEAD^{tree}').decode().strip()
        self.base_receipt = {'ref': 'release/live72', 'sha': self.base_sha}
        self.merge = {'sha': self.sha, 'tree': self.tree}
        self.run = {'id': 123, 'attempt': 1, 'workflow': 'Checks', 'event': 'pull_request', 'repository': 'owner/repo'}
        write(self.folder / 'event.json', {'pull_request': {'base': self.base_receipt}})
        self.env = {'GITHUB_EVENT_PATH': str(self.folder / 'event.json'), 'GITHUB_EVENT_NAME': 'pull_request',
                    'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKFLOW': 'Checks',
                    'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': self.sha}
        self.shards = self.folder / 'shards'
        self.out = self.shards / 'check-0'
        self.out.mkdir(parents=True)
        tools = {'release_check': ci.blob(ci.source(self.repo, self.sha, 'tools/release_check.py')),
                 'harnesses': {p: ci.blob(ci.source(self.repo, self.sha, p)) for p in release_check.harnesses()},
                 **{k: self.profile[k] for k in ('python', 'node', 'chrome')}}
        self.steps = []
        for name in release_check.REQUIRED:
            native = ci.NATIVE.get(name)
            step = {'name': name, 'exit': 0, 'passed': True}
            if native:
                row = copy.deepcopy(self.row)
                row['passed'] = name != 'native-inline'
                report = {'results': [row], 'browserClosed': True, 'closed': True, 'fixtureExitCode': 0,
                          'fixtureExitSignal': None, 'harnessCompleted': True,
                          'plannedPhases': ci.PHASES, 'completedPhases': ci.PHASES}
                write(self.out / 'native' / native.name / native.results, report)
                text = json.dumps(report, indent=2) + '\n' if native.results == 'results.json' else ci.known_reds.END_LINE + '\n'
                (self.out / (name + '.log')).write_text(text)
                step['counts'], good = release_check.native_counts(native, self.out / 'native' / native.name)
                step.update(passed=good, exit=0 if good else 1)
            elif name == 'node-units':
                text = '# Subtest: one\nok 1 - one\n# Subtest: two\nok 2 - two\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                (self.out / (name + '.log')).write_text(text)
                step['counts'] = release_check.node_counts(text)[0]
            elif name != 'wake-replay':
                text = 'test_one (example.Example) ... ok\ntest_two (example.Example) ... ok\nRan 2 tests in 0.1s\n\nOK\n'
                (self.out / (name + '.log')).write_text(text)
                step['counts'] = release_check.python_counts(text)[0]
            else:
                agents = {name: {'median': 1, 'wakes': 2, 'lost': [], 'delays': [1, 1]}
                          for name in ('aim-core', 'aim-spec', 'aim-ux')}
                write(self.out / 'replay/candidate-1/replay.json', {'agents': agents})
                (self.out / 'wake-replay-candidate-1.log').write_text('replay completed\n')
                run = {'exit': 0, 'passed': True, 'counts': agents, 'log': '/verified/replay.log',
                       'started_at': 'start', 'finished_at': 'finish'}
                step = release_check.replay_step([run], 'start')
            self.steps.append(step)
        self.summary = {'tool': release_check.TOOL, 'commit': self.sha, 'checkout': '/verified',
                        'tree_unchanged': True, 'tree_after': {'head': self.sha, 'changes': ''},
                        'required': list(release_check.REQUIRED), 'steps': self.steps, 'passed': False, 'tools': tools}
        self.summary.update(failed=['native-inline'], combined_from=['check-0/summary.json'])
        self.raw = copy.deepcopy(self.summary)
        self.raw['only'] = list(release_check.REQUIRED)
        self.receipt = {'run': self.run, 'base': self.base_receipt, 'merge': self.merge,
                        'profile': self.profile, 'shard': {'name': 'all', 'steps': self.raw['only']}}
        self.provenance = {'run': self.run, 'base': self.base_receipt, 'merge': self.merge,
                           'checked': {'commit': self.sha, 'tree_unchanged': True},
                           'required': list(release_check.REQUIRED),
                           'plan': [{'name': 'all', 'steps': ','.join(release_check.REQUIRED)}],
                           'shards': [{'artifact': 'check-0', 'receipt': self.receipt, 'commit': self.sha,
                                       'tree_unchanged': True, 'tools': tools, 'steps': self.raw['only']}]}
        self.history = None
        self.producer = None
        self.flush()

    def command(self, *args):
        return ci.git(self.repo, '-c', 'user.name=ci-test', '-c', 'user.email=ci-test@theseus.invalid', *args)

    def commit(self, message):
        self.command('add', '.')
        self.command('commit', '-qm', message)
        return self.command('rev-parse', 'HEAD').decode().strip()

    def advance_candidate(self, message):
        self.sha = self.commit(message)
        self.tree = ci.git(self.repo, 'rev-parse', 'HEAD^{tree}').decode().strip()
        self.merge.update(sha=self.sha, tree=self.tree)
        self.env['GITHUB_SHA'] = self.sha
        self.provenance['checked']['commit'] = self.sha
        self.provenance['shards'][0]['commit'] = self.sha
        for summary in (self.summary, self.raw):
            summary['commit'] = self.sha
            summary['tree_after']['head'] = self.sha
            summary['tools']['harnesses'] = {p: ci.blob(ci.source(self.repo, self.sha, p)) for p in release_check.harnesses()}
        self.provenance['shards'][0]['tools'] = self.raw['tools']

    def replace_unit_log(self, name, text):
        (self.out / (name + '.log')).write_text(text)
        counts = (release_check.node_counts(text) if name == 'node-units' else release_check.python_counts(text))[0]
        for steps in (self.steps, self.raw['steps']):
            next(s for s in steps if s['name'] == name)['counts'] = counts

    def install_trusted_policy(self, policy):
        write(self.base / '.github/check-baseline.json', policy)
        ci.git(self.base, 'add', '.github/check-baseline.json')
        ci.git(self.base, '-c', 'user.name=ci-test', '-c', 'user.email=ci-test@theseus.invalid',
               'commit', '-qm', 'independently reviewed plan')
        self.base_sha = self.base_receipt['sha'] = ci.git(self.base, 'rev-parse', 'HEAD').decode().strip()
        write(self.folder / 'event.json', {'pull_request': {'base': self.base_receipt}})

    def candidate_plan(self):
        plan = copy.deepcopy(self.policy)
        plan.pop('transitions', None)
        plan['source_commit'] = self.sha
        paths = ci.definition_paths(self.repo, self.sha) | {release_check.REPLAY_FILE}
        plan['source_hashes'] = {path: ci.blob(ci.source(self.repo, self.sha, path)) for path in paths}
        return plan

    def flush(self):
        write(self.folder / 'summary.json', self.summary)
        write(self.out / 'summary.json', self.raw)
        self.receipt['summary_sha256'] = hashlib.sha256((self.out / 'summary.json').read_bytes()).hexdigest()
        write(self.out / 'run.json', self.receipt)
        write(self.folder / 'provenance.json', self.provenance)

    def seal_earlier_summary(self, attempt):
        out = attempt / 'shards/check-0'
        receipt = ci.read_json(out / 'run.json')
        receipt['summary_sha256'] = hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()
        write(out / 'run.json', receipt)
        provenance = ci.read_json(attempt / 'provenance.json')
        provenance['shards'][0]['receipt'] = receipt
        write(attempt / 'provenance.json', provenance)

    def validate(self):
        self.flush()
        return ci.validate(self.folder / 'summary.json', self.folder / 'provenance.json', self.shards,
                           self.base / '.github/check-baseline.json', self.base, self.repo, self.env,
                           history=self.history, producer=self.producer)

    def protected_controller(self):
        head = self.sha
        # The policy changes on the reviewed base; the feature's unchanged old
        # copy must adopt that policy in its synthetic merged tree.
        (self.repo / '.github/check-baseline.json').write_bytes((self.base / '.github/check-baseline.json').read_bytes())
        self.command('add', '.github/check-baseline.json')
        self.tree = self.command('write-tree').decode().strip()
        merge = self.command('commit-tree', self.tree, '-p', self.base_sha, '-p', head,
                             '-m', 'original tested synthetic merge').decode().strip()
        self.command('reset', '--hard', merge)
        self.sha = merge
        self.merge.update(sha=merge, tree=self.tree, first_parent=self.base_sha, second_parent=head)
        self.provenance['checked']['commit'] = merge
        self.provenance['shards'][0]['commit'] = merge
        for summary in (self.summary, self.raw):
            summary['commit'] = merge
            summary['tree_after']['head'] = merge
        self.receipt['head'] = self.provenance['head'] = {'ref': 'feature', 'sha': head}
        self.receipt['run'].update(workflow_sha=merge,
                                  workflow_ref='owner/repo/.github/workflows/checks.yml@refs/pull/6/merge')
        self.env = {'GITHUB_EVENT_PATH': str(self.folder / 'event.json'), 'GITHUB_EVENT_NAME': 'workflow_run',
                    'GITHUB_RUN_ID': '999', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKFLOW': 'Protected verdict',
                    'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': self.base_sha,
                    'GITHUB_WORKFLOW_SHA': self.base_sha,
                    'GITHUB_WORKFLOW_REF': 'owner/repo/.github/workflows/verdict.yml@refs/heads/main'}
        observed = {'id': 123, 'run_attempt': 1, 'event': 'pull_request', 'name': 'Checks',
                    'path': ci.PRODUCER_WORKFLOW, 'head_sha': head, 'head_branch': 'feature',
                    'created_at': '2026-11-14T00:00:00Z', 'conclusion': 'failure',
                    'pull_requests': [{'number': 6, 'head': {'sha': head}, 'base': dict(self.base_receipt)}]}
        write(self.folder / 'event.json', {'action': 'completed', 'repository': {'default_branch': 'main'},
                                          'workflow_run': observed})
        self.producer = self.folder / 'producer.json'
        write(self.producer, {'producer': {'run_id': 123, 'run_attempt': 1, 'event': 'pull_request',
                                          'workflow_path': ci.PRODUCER_WORKFLOW, 'workflow_name': 'Checks',
                                          'head_sha': head, 'head_branch': 'feature', 'created_at': observed['created_at'],
                                          'conclusion': 'failure', 'pull_request': {'number': 6, 'head_sha': head,
                                                                                  'base_sha': self.base_sha, 'base_ref': 'release/live72'}},
                              'controller': {'run_id': 999, 'run_attempt': 1, 'workflow_sha': self.base_sha,
                                             'workflow_ref': self.env['GITHUB_WORKFLOW_REF'], 'sha': self.base_sha,
                                             'repository': 'owner/repo'},
                              'merge': {'sha': merge, 'tree': self.tree, 'first_parent': self.base_sha,
                                        'second_parent': head, 'fetched': merge, 'rebuilt': self.tree}})
        return head

    def earlier_attempt(self):
        self.flush()
        folder = self.folder / 'history'
        attempt = folder / 'attempt-1'
        shutil.copytree(self.shards, attempt / 'shards')
        write(attempt / 'summary.json', self.summary)
        write(attempt / 'provenance.json', self.provenance)
        self.run['attempt'] = 2
        self.env['GITHUB_RUN_ATTEMPT'] = '2'
        self.history = folder / 'history.json'
        write(self.history, {'run': self.run, 'base': self.base_receipt, 'merge': self.merge,
                             'attempts': [{'attempt': 1, 'summary': 'attempt-1/summary.json',
                                           'provenance': 'attempt-1/provenance.json', 'shards': 'attempt-1/shards'}]})
        return attempt

    def refused(self, pattern):
        with self.assertRaisesRegex(ci.Refused, pattern):
            self.validate()

    def test_exact_reviewed_failure_green_but_raw_red(self):
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertFalse(result['raw_passed'])
        self.assertEqual(len(result['expected']), 1)
        self.assertFalse(result['expected'][0]['raw_passed'])
        self.assertEqual(ci.read_json(self.out / 'summary.json'), self.raw)

    def test_previous_attempt_at_same_commit_stays_red(self):
        self.earlier_attempt()
        self.receipt['run'] = dict(self.run, attempt=1)
        self.provenance['shards'][0]['receipt'] = self.receipt
        self.refused('wrong producer run or attempt')

    def test_changed_checkout_tree_stays_red(self):
        self.receipt['merge'] = dict(self.merge, tree='b' * 40)
        self.refused('stale shard source')

    def test_missing_shard(self):
        (self.out / 'run.json').unlink()
        # flush intentionally does not restore this receipt for the call.
        with self.assertRaisesRegex(ci.Refused, 'unreadable JSON'):
            ci.validate(self.folder / 'summary.json', self.folder / 'provenance.json', self.shards,
                        self.base / '.github/check-baseline.json', self.base, self.repo, self.env)

    def test_missing_step(self):
        self.steps.pop()
        self.refused('missing required step')

    def test_duplicate_step_preserving_total(self):
        self.steps[-1] = self.steps[0]
        self.refused('duplicate combined steps')

    def test_omitted_case_with_duplicate_preserving_total(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['results'] = [report['results'][0], report['results'][0]]
        write(path, report)
        self.refused('duplicate case identity')

    def test_renamed_case(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['results'][0]['name'] = 'other case'
        write(path, report)
        self.refused('case inventory differs')

    def test_renamed_passing_case_cannot_hide_omission(self):
        path = self.out / 'native/colors/native.json'
        report = ci.read_json(path)
        report['results'][0]['name'] = 'replacement passing case'
        write(path, report)
        self.refused('case inventory differs')

    def test_wrong_source_hash(self):
        self.raw['tools']['harnesses']['tests/reader_native.mjs'] = 'a' * 40
        self.provenance['shards'][0]['tools'] = self.raw['tools']
        self.refused('wrong harness hash')

    def test_dirty_checkout(self):
        (self.repo / 'untracked').write_text('dirty')
        self.refused('dirty source checkout')

    def test_pr_edited_policy(self):
        write(self.repo / '.github/check-baseline.json', dict(self.policy, reds=[]))
        self.refused('dirty source checkout')

    def test_base_policy_cannot_be_edited(self):
        write(self.base / '.github/check-baseline.json', dict(self.policy, reds=[]))
        self.refused('dirty source checkout')

    def test_retry_cannot_use_new_base(self):
        self.provenance['base'] = dict(self.base_receipt, sha='a' * 40)
        self.refused('wrong event base')

    def test_non_browser_failure(self):
        self.steps[0].update(passed=False, exit=1)
        self.raw['steps'][0].update(passed=False, exit=1)
        self.refused('non-browser failure')

    def test_focused_aggregate(self):
        self.summary['only'] = list(release_check.REQUIRED)
        self.refused('focused or skipped aggregate')

    def test_combined_verdict_cannot_be_synthetic_green(self):
        self.summary['passed'] = True
        self.refused('inconsistent raw aggregate verdict')

    def test_failure_union_cannot_drop_raw_failure(self):
        self.summary['failed'] = []
        self.refused('combined failure union differs')

    def test_compose_cleanup_is_not_completion(self):
        path = self.out / 'native/compose/native.json'
        report = ci.read_json(path)
        for field, value in [('harnessCompleted', False), ('completedPhases', ci.PHASES[:-1]),
                             ('fixtureExitCode', 1), ('fixtureExitSignal', 'SIGTERM')]:
            with self.subTest(field=field):
                bad = dict(report, **{field: value})
                write(path, bad)
                self.refused('phases or fixture cleanup unattested')

    def test_counts_cannot_disagree_with_evidence(self):
        self.steps[9]['counts']['tests'] += 1
        self.raw['steps'][9] = copy.deepcopy(self.steps[9])
        self.refused('summary counts disagree')

    def test_browser_closed_with_abnormal_exit(self):
        self.steps[9]['exit'] = -15
        self.raw['steps'][9]['exit'] = -15
        self.refused('abnormal harness exit')

    def test_failed_legacy_fixture_cleanup(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['fixtureExitCode'] = 1
        write(path, report)
        self.refused('fixture cleanup failed')

    def test_measured_runtime_differs_from_receipt(self):
        self.receipt['profile'] = dict(self.profile, python='3.14')
        self.refused('producer profile differs')

    def test_wake_replay_missing_evidence(self):
        (self.out / 'replay/candidate-1/replay.json').unlink()
        self.refused('incomplete replay')

    def test_wake_replay_lost_wakes(self):
        path = self.out / 'replay/candidate-1/replay.json'
        data = ci.read_json(path)
        data['agents']['aim-core']['lost'] = [1200]
        write(path, data)
        self.refused('lost or missing wakes')

    def test_green_whole_run_reports_expected_case_healed(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['results'][0]['passed'] = True
        write(path, report)
        counts, good = release_check.native_counts(ci.NATIVE['native-inline'], path.parent)
        for steps in (self.steps, self.raw['steps']):
            next(s for s in steps if s['name'] == 'native-inline').update(counts=counts, passed=good, exit=0)
        self.summary['passed'] = self.raw['passed'] = True
        self.summary['failed'] = []
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertTrue(result['raw_passed'])
        self.assertEqual(len(result['healed']), 1)

    def test_changed_source_cannot_claim_healed(self):
        (self.repo / 'tests/reader_inline_native.mjs').write_text('// assertion removed\n')
        changed = self.commit('weaken test')
        with self.assertRaisesRegex(ci.Refused, 'changed helper/assertion source'):
            ci.classify(self.policy, [('native-inline', [dict(self.row, passed=True)], self.profile, '/verified')], self.repo, changed)

    # The stand-in helper with a line added after its failing line, which stays line 2: written whole, not read back.
    CARRIED_HELPER = '// stand-in source\nassert.equal(actual, expected);\nawait helper();\nexport const changedSinceTheAdmission = true;\n'

    def carry_admission_to_a_later_policy(self):
        """Item 575: a policy generated after the admission's review, at a source whose helper changed since the
        admission's source_commit (its failing line unchanged), carries the admission. Returns the helper's path."""
        path = self.repo / 'tests/reader_inline_native.mjs'
        path.write_text(self.CARRIED_HELPER)
        self.advance_candidate('helper changed after the admission was reviewed')
        plan = self.candidate_plan()
        self.assertNotEqual(plan['source_commit'], self.red['source_commit'])
        self.install_trusted_policy(plan)
        return path

    def heal_inline(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['results'][0]['passed'] = True
        write(path, report)
        counts, good = release_check.native_counts(ci.NATIVE['native-inline'], path.parent)
        for steps in (self.steps, self.raw['steps']):
            next(s for s in steps if s['name'] == 'native-inline').update(counts=counts, passed=good, exit=0)
        self.summary['passed'] = self.raw['passed'] = True
        self.summary['failed'] = []

    def test_carried_admission_heals_against_the_policys_source(self):
        self.carry_admission_to_a_later_policy()
        (self.repo / 'web').mkdir()
        (self.repo / 'web/app.mjs').write_text('export const productFix = true;\n')
        self.advance_candidate('product-only fix')
        self.heal_inline()
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertEqual([row['case']['name'] for row in result['healed']], ['case'])

    def test_carried_admission_still_fails_as_expected_against_the_policys_source(self):
        self.carry_admission_to_a_later_policy()
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertEqual(result['healed'], [])

    def test_carried_admission_helper_changed_by_the_candidate_cannot_claim_healed(self):
        path = self.carry_admission_to_a_later_policy()
        plan = ci.read_json(self.base / '.github/check-baseline.json')
        path.write_text(self.CARRIED_HELPER + 'export const candidateEdit = true;\n')
        self.advance_candidate('candidate edits the helper after the policy source')
        with self.assertRaisesRegex(ci.Refused, 'changed helper/assertion source; review first'):
            ci.classify(plan, [('native-inline', [dict(self.row, passed=True)], self.profile, '/verified')], self.repo, self.sha)
        # The whole validator refuses it sooner: the candidate's definitions match no reviewed plan.
        self.heal_inline()
        self.refused('no complete matching plan')

    def test_carried_admission_frames_must_resolve_at_the_plans_source(self):
        """Item 575: a plan carries an admission only where each of its frames (text, count, index) is at the plan's
        own source_commit, for the base plan and for each transition plan, so a pass is never reported healed against
        a plan whose source no longer holds the admitted failing line."""
        path = self.repo / 'tests/reader_inline_native.mjs'
        self.assertEqual(ci.load_policy(self.candidate_plan(), self.repo)['reds'], [self.red])
        for helper, why in (('// stand-in source\nawait helper();\n', 'assertion removed'),
                            (self.CARRIED_HELPER + 'assert.equal(actual, expected);\n', 'assertion duplicated')):
            path.write_text(helper)
            self.advance_candidate(why + ' after the admission was reviewed')
            plan = self.candidate_plan()
            refusal = "admission native-inline 'case'.* at plan %s" % plan['source_commit']
            with self.assertRaisesRegex(ci.Refused, refusal):
                ci.load_policy(plan, self.repo)
            with self.assertRaisesRegex(ci.Refused, refusal):
                ci.load_policy(dict(self.policy, transitions=[{'review': 'separate-review', 'plan': plan}]), self.repo)
        self.install_trusted_policy(plan)
        self.heal_inline()
        self.refused(refusal)

    def test_carried_admission_candidate_policy_copy_never_counts(self):
        path = self.carry_admission_to_a_later_policy()
        path.write_text(self.CARRIED_HELPER + 'export const candidateEdit = true;\n')
        self.advance_candidate('candidate edits the helper after the policy source')
        write(self.repo / '.github/check-baseline.json', self.candidate_plan())
        self.advance_candidate('candidate reviews its own helper edit')
        self.heal_inline()
        self.refused('no complete matching plan')

    def test_escaped_mutant_never_counts_as_expected_failure(self):
        path = self.out / 'native/reader-mutations/results.json'
        report = ci.read_json(path)
        report['results'][0].update(expectedFailure=True, mutationCaught=False, passed=True)
        write(path, report)
        # First rejects the unreviewed identity even before the escape check.
        self.refused('case inventory differs')

    def test_frame_less_failure_cannot_match(self):
        result = ci.classify(self.policy, [('native-inline', [dict(self.row, error='same name, no stack')], self.profile, '/verified')], self.repo, self.sha)
        self.assertFalse(result['passed'])

    def test_benign_source_line_shift_keeps_fingerprint(self):
        path = self.repo / 'tests/reader_inline_native.mjs'
        path.write_text('// added comment\n' + path.read_text())
        changed = self.commit('line shift')
        moved = dict(self.row, error=self.row['error'].replace('inline_native.mjs:2:1', 'inline_native.mjs:3:1'))
        result = ci.classify(self.policy, [('native-inline', [moved], self.profile, '/verified')], self.repo, changed)
        self.assertTrue(result['passed'])

    def test_added_duplicate_source_statement_is_ambiguous(self):
        path = self.repo / 'tests/reader_inline_native.mjs'
        path.write_text(path.read_text() + 'assert.equal(actual, expected);\n')
        changed = self.commit('ambiguous assertion')
        result = ci.classify(self.policy, [('native-inline', [self.row], self.profile, '/verified')], self.repo, changed)
        self.assertFalse(result['passed'])

    def test_case_values_changed_same_name_remains_unexpected(self):
        rows = [dict(self.row, error=self.row['error'].replace('2 !== 3', '4 !== 3'))]
        result = ci.classify(self.policy, [('native-inline', rows, self.profile, '/verified')], self.repo, self.sha)
        self.assertFalse(result['passed'])
        self.assertIn('different assertion', result['unexpected'][0]['reason'])

    def test_same_throw_different_callsite(self):
        rows = [dict(self.row, error=self.row['error'].replace('native.mjs:3:1', 'native.mjs:2:1'))]
        result = ci.classify(self.policy, [('native-inline', rows, self.profile, '/verified')], self.repo, self.sha)
        self.assertFalse(result['passed'])

    def test_profile_mismatch_remains_unexpected(self):
        result = ci.classify(self.policy, [('native-inline', [self.row], dict(self.profile, image_os='other'), '/verified')], self.repo, self.sha)
        self.assertFalse(result['passed'])
        self.assertEqual(result['unexpected'][0]['reason'], 'unreviewed runner profile')

    def test_healed_case(self):
        result = ci.classify(self.policy, [('native-inline', [dict(self.row, passed=True)], self.profile, '/verified')], self.repo, self.sha)
        self.assertTrue(result['passed'])
        self.assertEqual(len(result['healed']), 1)

    def test_missing_expected_case_is_not_healed(self):
        with self.assertRaisesRegex(ci.Refused, 'expected case disappeared'):
            ci.classify(self.policy, [], self.repo, self.sha)

    def test_first_run_without_admissions_remains_red(self):
        result = ci.classify(dict(self.policy, reds=[]), [('native-inline', [self.row], self.profile, '/verified')], self.repo, self.sha)
        self.assertFalse(result['passed'])
        self.assertEqual(result['unexpected'][0]['reason'], 'unlisted failure')

    def test_first_github_run_real_setup_refusal_remains_red(self):
        # Exact check-6 summary from run 43560453742, artifact 14099924147.
        # Its zip SHA256 is recorded in docs/ci-known-reds.md. No checks ran;
        # treating this as an empty set of case failures would falsely go green.
        self.raw = ci.read_json(ci.ROOT / 'tests/fixtures/ci-run1-refusal.json')
        self.assertFalse(self.raw['passed'])
        self.assertIn('Chrome for Testing', self.raw['refused'])
        self.refused('dirty or wrong shard source')

    def test_committed_pr_policy_cannot_admit_its_own_new_failure(self):
        candidate_policy = copy.deepcopy(self.policy)
        new_red = copy.deepcopy(self.red)
        new_red['step'] = 'native-colors'
        candidate_policy['reds'].append(new_red)
        write(self.repo / '.github/check-baseline.json', candidate_policy)
        self.sha = self.commit('candidate widens its own policy')
        self.tree = ci.git(self.repo, 'rev-parse', 'HEAD^{tree}').decode().strip()
        self.merge.update(sha=self.sha, tree=self.tree)
        self.env['GITHUB_SHA'] = self.sha
        self.provenance['checked']['commit'] = self.sha
        self.provenance['shards'][0]['commit'] = self.sha
        for summary in (self.summary, self.raw):
            summary['commit'] = self.sha
            summary['tree_after']['head'] = self.sha
        path = self.out / 'native/colors/native.json'
        report = ci.read_json(path)
        report['results'][0]['passed'] = False
        write(path, report)
        counts, _ = release_check.native_counts(ci.NATIVE['native-colors'], path.parent)
        for steps in (self.steps, self.raw['steps']):
            next(s for s in steps if s['name'] == 'native-colors').update(counts=counts, passed=False, exit=1)
        self.summary['failed'].append('native-colors')
        result = self.validate()
        self.assertFalse(result['passed'])
        self.assertEqual(result['unexpected'][0]['step'], 'native-colors')
        self.assertEqual(result['unexpected'][0]['reason'], 'unlisted failure')

    def test_normalization_preserves_ids_relationships_and_numbers(self):
        a, b = 'm-' + 'a' * 32, 'm-' + 'b' * 32
        self.assertEqual(ci.normalize(a + ' ' + a + ' 123', '/verified'), 'm-ID1 m-ID1 123')
        self.assertEqual(ci.normalize(a + ' ' + b + ' 123', '/verified'), 'm-ID1 m-ID2 123')
        self.assertNotEqual(ci.normalize('2.0', '/verified'), ci.normalize('2.1', '/verified'))

    def test_cross_profile_requires_runner_evidence_review(self):
        policy = copy.deepcopy(self.policy)
        policy['reds'][0]['observed_profile']['image_os'] = 'personal-mac'
        # The two profile values deliberately share no object identity here.
        policy['reds'][0]['target_profile'] = dict(self.profile)
        with self.assertRaisesRegex(ci.Refused, 'cross-profile'):
            ci.load_policy(policy, self.repo)

    def test_legacy_compose_baseline_cannot_be_admitted(self):
        policy = copy.deepcopy(self.policy)
        policy['reds'][0]['step'] = 'native-compose'
        with self.assertRaisesRegex(ci.Refused, 'baseline Compose completion unattested'):
            ci.load_policy(policy, self.repo)

    def test_load_sample_and_paths_are_diagnostic_only(self):
        profile = dict(self.profile, load_after=[9.2, 8.9, 8.1], chrome_path='/different/chrome', playwright_core='/different/pw')
        result = ci.classify(self.policy, [('native-inline', [self.row], profile, '/verified')], self.repo, self.sha)
        self.assertTrue(result['passed'])

    def test_missing_stable_setting_cannot_match(self):
        profile = dict(self.profile)
        del profile['reduce_motion']
        with self.assertRaisesRegex(ci.Refused, 'incomplete stable execution profile'):
            ci.classify(self.policy, [('native-inline', [self.row], profile, '/verified')], self.repo, self.sha)

    def test_escaped_mutant_with_reviewed_inventory_remains_red(self):
        path = self.out / 'native/reader-mutations/results.json'
        report = ci.read_json(path)
        report['results'][0].update(expectedFailure=True, mutationCaught=False, passed=True)
        write(path, report)
        (self.out / 'native-reader-mutations.log').write_text(json.dumps(report, indent=2) + '\n')
        counts, _ = release_check.native_counts(ci.NATIVE['native-reader-mutations'], path.parent)
        step = {'name': 'native-reader-mutations', 'counts': counts, 'passed': False, 'exit': 1}
        with self.assertRaisesRegex(ci.Refused, 'escaped mutation'):
            ci.cases(step, self.out, [ci.identity(report['results'][0])])

    def test_replay_completed_actor_cannot_hide_omitted_routed_actor(self):
        path = self.out / 'replay/candidate-1/replay.json'
        data = ci.read_json(path)
        del data['agents']['aim-ux']
        write(path, data)
        step = next(s for s in self.steps if s['name'] == 'wake-replay')
        step['series'].pop('aim-ux')
        self.raw['steps'][-1] = copy.deepcopy(step)
        self.refused('routed actor inventory')

    def test_replay_requires_explicit_loss_record(self):
        path = self.out / 'replay/candidate-1/replay.json'
        data = ci.read_json(path)
        del data['agents']['aim-core']['lost']
        write(path, data)
        self.refused('explicit loss record')

    def test_zero_admissions_passing_assertion_cannot_materially_change(self):
        baseline = copy.deepcopy(self.policy)
        baseline['reds'] = []
        write(self.base / '.github/check-baseline.json', baseline)
        ci.git(self.base, 'add', '.github/check-baseline.json')
        ci.git(self.base, '-c', 'user.name=ci-test', '-c', 'user.email=ci-test@theseus.invalid',
               'commit', '-qm', 'zero admissions')
        self.base_receipt['sha'] = ci.git(self.base, 'rev-parse', 'HEAD').decode().strip()
        write(self.folder / 'event.json', {'pull_request': {'base': self.base_receipt}})
        path = self.repo / 'tests/reader_openings_native.mjs'
        path.write_text(path.read_text().replace('assert.equal(actual, expected);', 'assert.ok(true);'))
        self.advance_candidate('weaken passing test')
        self.refused('reviewed test definition changed')

    def test_ordinary_passing_source_can_shift_by_leading_comment(self):
        path = self.repo / 'tests/reader_openings_native.mjs'
        path.write_text('// harmless header\n' + path.read_text())
        self.advance_candidate('shift passing test source')
        self.assertTrue(self.validate()['passed'])

    def test_skipped_only_and_partial_python_checks_are_refused(self):
        for count in (1, 2):
            with self.subTest(skipped=count):
                statuses = ['skipped \'not run\''] * count + ['ok'] * (2 - count)
                text = '\n'.join('test_%s (example.Example) ... %s' % (name, status)
                                 for name, status in zip(('one', 'two'), statuses))
                self.replace_unit_log('python-units', text + '\nRan 2 tests in 0.1s\n\nOK (skipped=%d)\n' % count)
                self.refused('unapproved skipped')

    def test_skipped_only_partial_and_todo_node_checks_are_refused(self):
        for skipped, todo in ((2, 0), (1, 0), (0, 1)):
            with self.subTest(skipped=skipped, todo=todo):
                text = '# Subtest: one\nok 1 - one # SKIP\n# Subtest: two\nok 2 - two\n'
                text += '# tests 2\n# pass %d\n# fail 0\n# cancelled 0\n# skipped %d\n# todo %d\n' % (2 - skipped - todo, skipped, todo)
                self.replace_unit_log('node-units', text)
                self.refused('unapproved skipped|todo')

    def test_planned_python_check_cannot_be_replaced_at_same_total(self):
        self.replace_unit_log('python-units', 'test_one (example.Example) ... ok\ntest_replacement (example.Example) ... ok\nRan 2 tests in 0.1s\n\nOK\n')
        self.refused('reviewed check inventory omitted')

    def test_planned_node_check_cannot_be_replaced_at_same_total(self):
        self.replace_unit_log('node-units', '# Subtest: one\nok 1 - one\n# Subtest: replacement\nok 2 - replacement\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        self.refused('reviewed check inventory omitted')

    def test_unit_summary_without_per_check_evidence_is_refused(self):
        self.replace_unit_log('python-units', 'Ran 2 tests in 0.1s\n\nOK\n')
        self.refused('missing individual check outcomes')

    def test_new_unit_checks_can_run_alongside_all_reviewed_checks(self):
        self.replace_unit_log('python-units', 'test_one (example.Example) ... ok\ntest_two (example.Example) ... ok\ntest_added (example.New) ... ok\nRan 3 tests in 0.1s\n\nOK\n')
        self.assertTrue(self.validate()['passed'])

    def test_second_replay_repetition_must_cover_all_routed_actors(self):
        path = self.out / 'replay/candidate-1/replay.json'
        data = ci.read_json(path)
        del data['agents']['aim-spec']
        write(self.out / 'replay/candidate-2/replay.json', data)
        (self.out / 'wake-replay-candidate-2.log').write_text('finished\n')
        for steps in (self.steps, self.raw['steps']):
            step = next(s for s in steps if s['name'] == 'wake-replay')
            step['runs'].append(copy.deepcopy(step['runs'][0]))
        self.refused('routed actor inventory')

    def test_leading_comment_normalization_does_not_strip_template_payload(self):
        before = b'const message = `\n// assertion payload\n`;\nassert.equal(value, message);\n'
        changed = before.replace(b'assertion payload', b'different payload')
        self.assertNotEqual(ci.definition_bytes(before, 'tests/example.mjs'), ci.definition_bytes(changed, 'tests/example.mjs'))

    def test_nested_tap_case_identity_includes_parent(self):
        text = '# Subtest: outer\n    # Subtest: inner\n    ok 1 - inner\nok 1 - outer\n'
        rows = ci.unit_records(text, node=True)
        self.assertEqual(rows, [({'name': 'inner', 'phase': '["outer"]'}, 'ok'), ({'name': 'outer', 'phase': None}, 'ok')])

    def test_python_test_stdout_can_finish_without_newline(self):
        rows = ci.unit_records('test_one (example.Example) ... {"proof":true}ok\n')
        self.assertEqual(rows, [({'name': 'test_one (example.Example)'}, 'ok')])

    def test_retry_cannot_hide_earlier_unexpected_failure(self):
        old = self.earlier_attempt()
        report_path = old / 'shards/check-0/native/colors/native.json'
        report = ci.read_json(report_path)
        report['results'][0]['passed'] = False
        write(report_path, report)
        counts, _ = release_check.native_counts(ci.NATIVE['native-colors'], report_path.parent)
        for path in (old / 'summary.json', old / 'shards/check-0/summary.json'):
            summary = ci.read_json(path)
            next(s for s in summary['steps'] if s['name'] == 'native-colors').update(counts=counts, passed=False, exit=1)
            summary['failed'].append('native-colors')
            write(path, summary)
        self.seal_earlier_summary(old)
        result = self.validate()
        self.assertFalse(result['passed'])
        self.assertEqual(result['unexpected'][0]['step'], 'native-colors')
        self.assertEqual(result['unexpected'][0]['attempt'], 1)

    def pass_current_inline_case(self):
        path = self.out / 'native/inline/native.json'
        report = ci.read_json(path)
        report['results'][0]['passed'] = True
        write(path, report)
        counts, _ = release_check.native_counts(ci.NATIVE['native-inline'], path.parent)
        for steps in (self.steps, self.raw['steps']):
            next(s for s in steps if s['name'] == 'native-inline').update(counts=counts, passed=True, exit=0)
        self.summary['passed'] = self.raw['passed'] = True
        self.summary['failed'] = []

    def test_expected_failure_then_retry_pass_is_not_a_clean_heal(self):
        self.earlier_attempt()
        self.pass_current_inline_case()
        result = self.validate()
        self.assertTrue(result['passed'])  # Only a reviewed expected failure occurred.
        self.assertFalse(result['raw_passed'])
        self.assertEqual(result['healed'], [])
        self.assertEqual(result['passed_on_retry'][0]['failed_attempts'], [1])
        self.assertEqual(result['expected'][0]['attempt'], 1)

    def test_changed_failure_then_retry_pass_is_red_and_not_a_clean_heal(self):
        old = self.earlier_attempt()
        path = old / 'shards/check-0/native/inline/native.json'
        report = ci.read_json(path)
        report['results'][0]['error'] = report['results'][0]['error'].replace('2 !== 3', '7 !== 3')
        write(path, report)
        self.pass_current_inline_case()
        result = self.validate()
        self.assertFalse(result['passed'])
        self.assertFalse(result['raw_passed'])
        self.assertEqual(result['healed'], [])
        self.assertEqual(result['unexpected'][0]['attempt'], 1)

    def test_history_cannot_point_outside_its_directory(self):
        self.earlier_attempt()
        data = ci.read_json(self.history)
        data['attempts'][0]['summary'] = '../summary.json'
        write(self.history, data)
        self.refused('history path escapes')

    def test_history_cannot_duplicate_an_attempt(self):
        self.earlier_attempt()
        data = ci.read_json(self.history)
        data['attempts'].append(copy.deepcopy(data['attempts'][0]))
        write(self.history, data)
        self.refused('incomplete or duplicate attempt history')

    def test_history_cannot_change_the_original_policy_base(self):
        self.earlier_attempt()
        data = ci.read_json(self.history)
        data['base']['sha'] = 'a' * 40
        write(self.history, data)
        self.refused('another event base or tested merge')

    def test_missing_prior_original_evidence_keeps_retry_red(self):
        old = self.earlier_attempt()
        (old / 'summary.json').unlink()
        result = self.validate()
        self.assertFalse(result['passed'])
        self.assertIn('unreadable JSON', result['attempts'][0]['refused'])

    def test_genuine_receipt_cannot_vouch_for_replaced_summary_bytes(self):
        self.flush()
        path = self.out / 'summary.json'
        path.write_text(path.read_text() + ' ')
        with self.assertRaisesRegex(ci.Refused, 'summary digest differs'):
            ci.validate(self.folder / 'summary.json', self.folder / 'provenance.json', self.shards,
                        self.base / '.github/check-baseline.json', self.base, self.repo, self.env)

    def test_original_summary_receipt_digest_is_required(self):
        self.flush()
        receipt = ci.read_json(self.out / 'run.json')
        del receipt['summary_sha256']
        write(self.out / 'run.json', receipt)
        provenance = ci.read_json(self.folder / 'provenance.json')
        provenance['shards'][0]['receipt'] = receipt
        write(self.folder / 'provenance.json', provenance)
        with self.assertRaisesRegex(ci.Refused, 'summary digest differs'):
            ci.validate(self.folder / 'summary.json', self.folder / 'provenance.json', self.shards,
                        self.base / '.github/check-baseline.json', self.base, self.repo, self.env)

    def test_python_assertion_change_with_same_verbose_name_requires_review(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text(path.read_text().replace('assert actual == expected', 'assert True'))
        self.advance_candidate('weaken Python assertion with unchanged identity')
        self.refused('reviewed test definition changed')

    def test_ordinary_python_header_comment_can_shift(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text('# ordinary header\n' + path.read_text())
        self.advance_candidate('harmless Python header')
        self.assertTrue(self.validate()['passed'])

    def test_python_encoding_and_shebang_are_not_ignorable_comments(self):
        for first, second in ((b'# coding: utf-8\n', b'# coding: latin-1\n'),
                              (b'#!/usr/bin/python3 -I\n', b'#!/usr/bin/python3\n')):
            with self.subTest(first=first):
                body = b'assert actual == expected\n'
                self.assertNotEqual(ci.definition_bytes(first + body, 'tests/test_example.py'),
                                    ci.definition_bytes(second + body, 'tests/test_example.py'))

    def test_producer_tools_compare_exact_blobs_even_for_headers(self):
        self.assertNotEqual(ci.definition_bytes(b'# old\nprint(1)\n', 'tools/release_check.py'),
                            ci.definition_bytes(b'# header\n# old\nprint(1)\n', 'tools/release_check.py'))

    def test_changed_producer_driver_with_unchanged_workflow_is_refused(self):
        workflow = (self.repo / ci.PRODUCER_WORKFLOW).read_bytes()
        path = self.repo / 'tools/release_check.py'
        text = path.read_text()
        old = 'return counts, bool(results) and not failed and closed'
        self.assertEqual(text.count(old), 1)
        path.write_text(text.replace(old, 'return counts, True'))
        self.advance_candidate('unreviewed producer driver')
        for summary in (self.summary, self.raw):
            summary['tools']['release_check'] = ci.blob(ci.source(self.repo, self.sha, 'tools/release_check.py'))
        self.provenance['shards'][0]['tools'] = self.raw['tools']
        self.assertEqual((self.repo / ci.PRODUCER_WORKFLOW).read_bytes(), workflow)
        self.refused('reviewed test definition changed')

    def test_ordinary_product_only_change_can_validate(self):
        (self.repo / 'web').mkdir()
        (self.repo / 'web/app.mjs').write_text('export const productFix = true;\n')
        self.advance_candidate('ordinary product edit')
        self.assertTrue(self.validate()['passed'])

    def test_separately_reviewed_complete_plan_can_allow_new_definition(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text(path.read_text().replace('assert actual == expected', 'assert actual == approved'))
        self.advance_candidate('proposed reviewed Python assertion')
        plan = self.candidate_plan()
        self.install_trusted_policy(dict(self.policy, transitions=[{'review': 'separate-review', 'plan': plan}]))
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertEqual(result['transition_review'], 'separate-review')
        self.assertEqual(result['plan_source_commit'], plan['source_commit'])

    def test_old_definition_still_validates_during_reviewed_transition(self):
        path = self.repo / 'tests/test_example.py'
        original = path.read_text()
        path.write_text(original.replace('assert actual == expected', 'assert actual == approved'))
        self.advance_candidate('proposed new definition')
        plan = self.candidate_plan()
        self.install_trusted_policy(dict(self.policy, transitions=[{'review': 'separate-review', 'plan': plan}]))
        path.write_text(original)
        self.advance_candidate('old plan remains usable')
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertIsNone(result['transition_review'])

    def test_partial_mix_of_reviewed_old_and_new_plans_is_refused(self):
        python = self.repo / 'tests/test_example.py'
        native = self.repo / 'tests/reader_openings_native.mjs'
        original = native.read_text()
        python.write_text(python.read_text().replace('assert actual == expected', 'assert actual == approved'))
        native.write_text(original.replace('assert.equal(actual, expected)', 'assert.equal(actual, approved)'))
        self.advance_candidate('complete proposed plan')
        plan = self.candidate_plan()
        self.install_trusted_policy(dict(self.policy, transitions=[{'review': 'separate-review', 'plan': plan}]))
        native.write_text(original)
        self.advance_candidate('unreviewed partial plan')
        self.refused('no complete matching plan')

    def test_ambiguous_complete_plans_are_refused(self):
        self.install_trusted_policy(dict(self.policy, transitions=[{'review': 'overlapping-review', 'plan': self.policy}]))
        self.refused('ambiguous reviewed plans')

    def test_feature_cannot_approve_its_own_plan_transition(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text(path.read_text().replace('assert actual == expected', 'assert True'))
        self.advance_candidate('unreviewed test edit')
        write(self.repo / '.github/check-baseline.json',
              dict(self.policy, transitions=[{'review': 'self-approval', 'plan': self.candidate_plan()}]))
        self.advance_candidate('candidate claims transition approval')
        self.refused('no complete matching plan')

    def test_plan_transition_cannot_add_failure_admissions(self):
        plan = copy.deepcopy(self.policy)
        extra = copy.deepcopy(self.red)
        extra['step'] = 'native-colors'
        plan['reds'].append(extra)
        policy = dict(self.policy, transitions=[{'review': 'definition-only-review', 'plan': plan}])
        with self.assertRaisesRegex(ci.Refused, 'cannot add or change failure admissions'):
            ci.load_policy(policy, self.repo)

    def test_controller_uses_producer_identity_and_reports_intended_pr_head(self):
        head = self.protected_controller()
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertEqual(result['run']['id'], 123)
        self.assertEqual(result['controller']['run_id'], 999)
        self.assertEqual(result['status_head_sha'], head)
        self.assertEqual(result['merge']['sha'], self.sha)
        self.assertNotEqual(result['merge']['sha'], self.env['GITHUB_SHA'])

    def test_controller_record_must_match_actual_controller_environment(self):
        self.protected_controller()
        record = ci.read_json(self.producer)
        record['controller']['run_id'] = 998
        write(self.producer, record)
        self.refused('wrong protected controller identity')

    def test_controller_cannot_authenticate_a_foreign_run_from_matching_artifacts(self):
        self.protected_controller()
        record = ci.read_json(self.producer)
        record['producer']['run_id'] = 124
        self.run['id'] = 124
        write(self.producer, record)
        self.refused('producer is not the triggering run/attempt')

    def test_producer_head_must_match_triggering_api_event(self):
        self.protected_controller()
        record = ci.read_json(self.producer)
        record['producer']['pull_request']['head_sha'] = 'a' * 40
        write(self.producer, record)
        self.refused('producer PR head differs')

    def test_receipt_parent_cannot_select_a_new_policy_base(self):
        self.protected_controller()
        record = ci.read_json(self.producer)
        record['merge']['first_parent'] = self.source_commit
        write(self.producer, record)
        self.refused('original API base/head')

    def test_producer_tree_must_match_independently_rebuilt_tree(self):
        self.protected_controller()
        record = ci.read_json(self.producer)
        record['merge']['tree'] = record['merge']['rebuilt'] = 'a' * 40
        write(self.producer, record)
        self.refused('independently rebuilt producer tree')

    def test_rebuilt_commit_cannot_replace_original_tested_commit(self):
        head = self.protected_controller()
        rebuilt = self.command('commit-tree', self.tree, '-p', self.base_sha, '-p', head,
                               '-m', 'different rebuilt commit with identical tree').decode().strip()
        self.assertNotEqual(rebuilt, self.sha)
        self.command('reset', '--hard', rebuilt)
        self.refused('wrong checkout commit')

    def test_protected_controller_refuses_producer_retry_before_artifacts(self):
        self.protected_controller()
        record, event = ci.read_json(self.producer), ci.read_json(self.folder / 'event.json')
        record['producer']['run_attempt'] = event['workflow_run']['run_attempt'] = 2
        write(self.producer, record)
        write(self.folder / 'event.json', event)
        self.refused('protected controller refuses producer retries')

    def test_producer_workflow_commit_and_ref_must_bind_to_producer(self):
        self.protected_controller()
        expected = dict(self.receipt['run'])
        for field, value, reason in [('workflow_sha', self.base_sha, 'workflow commit'),
                                     ('workflow_ref', 'owner/repo/.github/workflows/checks.yml@refs/pull/99/merge', 'workflow reference')]:
            with self.subTest(field=field):
                self.receipt['run'].update(expected)
                self.receipt['run'][field] = value
                self.refused('unbound producer ' + reason)

    def test_cancelled_producer_cannot_validate_completed_artifact_claims(self):
        self.protected_controller()
        record, event = ci.read_json(self.producer), ci.read_json(self.folder / 'event.json')
        record['producer']['conclusion'] = event['workflow_run']['conclusion'] = 'cancelled'
        write(self.producer, record)
        write(self.folder / 'event.json', event)
        self.refused('producer is cancelled')

    def test_added_test_module_needs_a_complete_reviewed_plan(self):
        (self.repo / 'tests/test_added.py').write_text('def test_new():\n    assert True\n')
        self.advance_candidate('unreviewed added test module')
        self.refused('no complete matching plan')

    def reviewed_base_addition(self, path='tests/reviewed_helper.py', body='# independently reviewed helper\nanswer = 42\n'):
        (self.base / path).write_text(body)
        ci.git(self.base, 'add', path)
        self.install_trusted_policy(self.policy)
        (self.repo / path).write_text(body)
        self.advance_candidate('adopt independently reviewed base helper')
        return path

    def test_base_additions_need_a_complete_reviewed_inventory_transition(self):
        self.reviewed_base_addition()
        self.protected_controller()
        self.refused('no complete matching plan')

    def test_feature_cannot_modify_an_addition_from_the_authenticated_base(self):
        path = self.reviewed_base_addition()
        (self.repo / path).write_text('answer = 0\n')
        self.advance_candidate('unreviewed edit of base helper')
        self.refused('no complete matching plan')

    def test_candidate_cannot_delete_a_base_addition_to_match_old_snapshot(self):
        path = self.reviewed_base_addition()
        (self.repo / path).unlink()
        self.advance_candidate('omit new base helper and keep old source set')
        self.refused('no complete matching plan')

    def test_base_added_verifier_test_identity_cannot_be_omitted(self):
        path = 'tests/test_reviewed_verifier.py'
        name = 'test_required (test_reviewed_verifier.Added)'
        self.reviewed_base_addition(path, 'import unittest\nclass Added(unittest.TestCase):\n    def test_required(self):\n        self.assertTrue(True)\n')
        plan = self.candidate_plan()
        plan['inventory']['python-units'].append(ci.identity({'name': name}))
        self.install_trusted_policy(dict(self.policy, transitions=[{'review': 'full-verifier-inventory-review', 'plan': plan}]))
        self.protected_controller()
        self.refused('reviewed check inventory omitted')
        self.replace_unit_log('python-units', 'test_one (example.Example) ... ok\ntest_two (example.Example) ... ok\n' + name + ' ... ok\nRan 3 tests in 0.1s\n\nOK\n')
        self.assertTrue(self.validate()['passed'])

    def test_old_transition_cannot_implicitly_retire_a_later_base_addition(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text(path.read_text().replace('assert actual == expected', 'assert actual == approved'))
        self.advance_candidate('reviewed assertion before later base helper')
        plan = self.candidate_plan()
        added = self.reviewed_base_addition()
        (self.repo / added).unlink()
        self.advance_candidate('omit later base helper to match old transition')
        transition = {'review': 'earlier-plan-review', 'plan': plan, 'retired_sources': []}
        self.install_trusted_policy(dict(self.policy, transitions=[transition]))
        self.refused('no complete matching plan')
        transition['retired_sources'] = [added]
        self.install_trusted_policy(dict(self.policy, transitions=[transition]))
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertEqual(result['retired_base_sources'], [added])

    def test_expected_json_fixture_cannot_be_changed_to_hide_a_regression(self):
        path = self.repo / 'tests/fixtures/at_names.json'
        fixture = ci.read_json(path)
        fixture['cases'][0][1].append('auditor')
        write(path, fixture)
        self.advance_candidate('change data rather than the checked product')
        self.refused('no complete matching plan')

    def test_documentation_read_by_tests_cannot_be_changed(self):
        path = self.repo / 'docs/tools.md'
        path.write_text('Replaced expectations from documentation.\n')
        self.advance_candidate('change documentation used as test input')
        self.refused('no complete matching plan')

    def test_new_opaque_file_read_requires_a_declaration(self):
        files = {'tests/new.py': b'from pathlib import Path\nPath(computed_name).read_text()\n'}
        _, errors = ci.ci_input_reads.discover(files, {})
        self.assertTrue(errors)
        self.assertIn('undeclared file read', errors[0])
        self.assertIn('declare its repository inputs', errors[0])

    def test_declared_non_product_read_extends_the_frozen_inputs(self):
        files = {'tests/new.py': b'from pathlib import Path\nPath("docs/new.md").read_text()\n',
                 'docs/new.md': b'new expected behavior', 'web/app.mjs': b'product'}
        calls, _ = ci.ci_input_reads.read_calls('tests/new.py', files['tests/new.py'].decode())
        declarations = {'tests/new.py': {signature: {'scope': 'repository', 'inputs': ['docs/new.md']}
                                        for signature in calls}}
        frozen, errors = ci.ci_input_reads.discover(files, declarations)
        self.assertEqual(errors, [])
        self.assertIn('docs/new.md', frozen)
        self.assertNotIn('web/app.mjs', frozen)

    def test_aliased_python_and_node_file_reads_require_declarations(self):
        for path, text in [('tests/new.py', b'from builtins import open as reader\nreader(computed_name)\n'),
                           ('tests/new.mjs', b'import {readFileSync as reader} from "node:fs"; reader(computedName);')]:
            with self.subTest(path=path):
                _, errors = ci.ci_input_reads.discover({path: text}, {})
                self.assertTrue(errors)
                self.assertIn('undeclared file read', errors[0])

    def test_duplicate_opaque_read_is_a_new_read_obligation(self):
        first = 'from pathlib import Path\nPath(computed_name).read_text()\n'
        calls, _ = ci.ci_input_reads.read_calls('tests/new.py', first)
        declarations = {'tests/new.py': {signature: {'scope': 'generated/system/product', 'inputs': []}
                                        for signature in calls}}
        _, errors = ci.ci_input_reads.discover({'tests/new.py': (first + 'Path(computed_name).read_text()\n').encode()}, declarations)
        self.assertTrue(errors)

    def test_new_read_in_a_reviewed_plan_still_needs_a_declaration(self):
        path = self.repo / 'tests/test_example.py'
        path.write_text('from pathlib import Path\nPath(computed_name).read_text()\n')
        self.advance_candidate('new external read without input review')
        with self.assertRaisesRegex(ci.Refused, 'undeclared file read'):
            self.candidate_plan()

    def test_deeply_nested_json_is_refused_with_a_reason(self):
        path = self.folder / 'nested.json'
        path.write_text('[' * 2000 + '0' + ']' * 2000)
        with self.assertRaisesRegex(ci.Refused, 'unreadable JSON'):
            ci.read_json(path)

    def test_policy_cannot_omit_fixture_or_documentation_inputs(self):
        for path in ('tests/fixtures/at_names.json', 'docs/tools.md'):
            with self.subTest(path=path):
                policy = copy.deepcopy(self.policy)
                policy['source_hashes'].pop(path)
                with self.assertRaisesRegex(ci.Refused, 'omits test or producer definitions'):
                    ci.load_policy(policy, self.base)

    def test_nested_json_cli_preserves_a_refusal_result_file(self):
        self.protected_controller()
        self.flush()
        self.producer.write_text('[' * 2000 + '0' + ']' * 2000)
        out = self.folder / 'nested-verdict.json'
        pyc = str(self.folder / 'nested-cli-pyc')
        env = dict(os.environ, **self.env, PYTHONPYCACHEPREFIX=pyc)
        result = subprocess.run([sys.executable, '-I', '-X', 'pycache_prefix=' + pyc,
                                 str(ci.ROOT / 'tools/ci_known_reds.py'),
                                 '--summary', str(self.folder / 'summary.json'),
                                 '--provenance', str(self.folder / 'provenance.json'), '--shards', str(self.shards),
                                 '--baseline', str(self.base / '.github/check-baseline.json'),
                                 '--base-checkout', str(self.base), '--candidate-checkout', str(self.repo),
                                 '--producer', str(self.producer), '--out', str(out)],
                                cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        verdict = ci.read_json(out)
        self.assertFalse(verdict['passed'])
        self.assertIn('unreadable JSON', verdict['refused'])

    def test_controller_cli_uses_producer_record_from_a_separate_context(self):
        head = self.protected_controller()
        self.flush()
        out = self.folder / 'controller-verdict.json'
        pyc = str(self.folder / 'cli-pyc')
        env = dict(os.environ, **self.env, PYTHONPYCACHEPREFIX=pyc)
        result = subprocess.run([sys.executable, '-I', '-X', 'pycache_prefix=' + pyc,
                                 str(ci.ROOT / 'tools/ci_known_reds.py'),
                                 '--summary', str(self.folder / 'summary.json'),
                                 '--provenance', str(self.folder / 'provenance.json'), '--shards', str(self.shards),
                                 '--baseline', str(self.base / '.github/check-baseline.json'),
                                 '--base-checkout', str(self.base), '--candidate-checkout', str(self.repo),
                                 '--producer', str(self.producer), '--out', str(out)],
                                cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(ci.read_json(out)['passed'])
        self.assertEqual(ci.read_json(out)['status_head_sha'], head)

    def test_retry_with_missing_history_cannot_validate(self):
        self.earlier_attempt()
        self.history = None
        self.refused('retry requires complete attempt history')

    def test_retry_cannot_omit_an_earlier_attempt(self):
        self.earlier_attempt()
        data = ci.read_json(self.history)
        data['attempts'] = []
        write(self.history, data)
        self.refused('incomplete or duplicate attempt history')

    def test_retry_revalidates_original_producer_receipt(self):
        old = self.earlier_attempt()
        path = old / 'shards/check-0/run.json'
        receipt = ci.read_json(path)
        receipt['run']['id'] = 999
        write(path, receipt)
        result = self.validate()
        self.assertFalse(result['passed'])

    def test_complete_retry_history_with_only_expected_failures_can_validate(self):
        self.earlier_attempt()
        result = self.validate()
        self.assertTrue(result['passed'])
        self.assertFalse(result['raw_passed'])
        self.assertEqual([a['attempt'] for a in result['attempts']], [1, 2])


class TheRepositorysOwnChecks(unittest.TestCase):
    """Item 575: what GitHub's classifier asks of this checkout's own checks, or it refuses every plan that holds them:
    each file read a test makes is declared in tools/ci-input-reads.json ('test input read audit', from the policy's
    source commit or the candidate's), and python-units runs each check once ('reviewed check inventory omitted or
    duplicated', since a reviewed inventory names a check once)."""

    def tracked(self):
        listed = subprocess.run(['git', '-C', str(ci.ROOT), 'ls-files', '-z'], capture_output=True, check=True).stdout
        checkout = ci.ROOT
        return {path: (checkout / path).read_bytes() for path in listed.decode().split('\0')
                if path and (checkout / path).is_file()}

    def test_every_file_read_a_test_makes_is_declared(self):
        _, errors = ci.ci_input_reads.discover(self.tracked(), ci.read_json(ci.ROOT / 'tools/ci-input-reads.json'))
        self.assertEqual(errors, [], '%d undeclared' % len(errors))

    def test_the_audit_still_finds_a_read_no_declaration_names(self):
        # The negative: the same audit over the same files, with one of their declared reads taken out, finds it.
        files = self.tracked()
        declarations = ci.read_json(ci.ROOT / 'tools/ci-input-reads.json')
        path = 'tests/test_checks_base_at_run.py'
        calls, _ = ci.ci_input_reads.read_calls(path, files[path].decode('utf-8-sig'))
        signature = next(key for key, expression in calls.items() if expression == 'WORKFLOW.read_text()')
        del declarations[path][signature]
        _, errors = ci.ci_input_reads.discover(files, declarations)
        self.assertEqual([error.split(';')[0] for error in errors], [path + ': undeclared file read WORKFLOW.read_text()'])

    def identities(self, suite):
        for test in suite:
            if isinstance(test, unittest.TestSuite):
                yield from self.identities(test)
            else:
                yield str(test)

    def test_python_units_run_each_check_once(self):
        # As python-units discovers them (tools/release_check.py): every test_*.py under tests/, named as its log names them.
        found = list(self.identities(unittest.TestLoader().discover(str(ci.ROOT / 'tests'), pattern='test_*.py')))
        self.assertGreater(len(found), 1000)
        self.assertIn('test_python_units_run_each_check_once (test_tools_ci_known_reds.TheRepositorysOwnChecks)', found)
        twice = sorted({name for name in found if found.count(name) > 1})
        self.assertEqual(twice, [])


if __name__ == '__main__':
    unittest.main()

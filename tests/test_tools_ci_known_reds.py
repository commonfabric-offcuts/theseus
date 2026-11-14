from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
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
                                                'tools/known_reds.py', 'tools/release_check.py'}
        for path in paths:
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ci.ROOT / path).read_bytes() if path.startswith('tools/')
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
                                         for p in paths if p.startswith('tests/')},
                       'required': list(release_check.REQUIRED),
                       'inventory': {name: [ci.identity(self.row)] for name in ci.NATIVE}, 'reds': []}
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
        self.run = {'id': 123, 'attempt': 2, 'workflow': 'Checks', 'event': 'pull_request', 'repository': 'owner/repo'}
        write(self.folder / 'event.json', {'pull_request': {'base': self.base_receipt}})
        self.env = {'GITHUB_EVENT_PATH': str(self.folder / 'event.json'), 'GITHUB_EVENT_NAME': 'pull_request',
                    'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2', 'GITHUB_WORKFLOW': 'Checks',
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
                text = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n'
                (self.out / (name + '.log')).write_text(text)
                step['counts'] = release_check.node_counts(text)[0]
            elif name != 'wake-replay':
                text = 'Ran 2 tests in 0.1s\n\nOK\n'
                (self.out / (name + '.log')).write_text(text)
                step['counts'] = release_check.python_counts(text)[0]
            else:
                agents = {'test-agent': {'median': 1, 'wakes': 2, 'lost': [], 'delays': [1, 1]}}
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
        self.flush()

    def command(self, *args):
        return ci.git(self.repo, '-c', 'user.name=ci-test', '-c', 'user.email=ci-test@theseus.invalid', *args)

    def commit(self, message):
        self.command('add', '.')
        self.command('commit', '-qm', message)
        return self.command('rev-parse', 'HEAD').decode().strip()

    def flush(self):
        write(self.folder / 'summary.json', self.summary)
        write(self.folder / 'provenance.json', self.provenance)
        write(self.out / 'summary.json', self.raw)
        write(self.out / 'run.json', self.receipt)

    def validate(self):
        self.flush()
        return ci.validate(self.folder / 'summary.json', self.folder / 'provenance.json', self.shards,
                           self.base / '.github/check-baseline.json', self.base, self.repo, self.env)

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
        data['agents']['test-agent']['lost'] = [1200]
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


if __name__ == '__main__':
    unittest.main()

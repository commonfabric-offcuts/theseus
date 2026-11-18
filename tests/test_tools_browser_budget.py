from __future__ import annotations

import copy
import unittest
from unittest import mock

from tools import unit_shards as planner, release_check as check


class BrowserBudget(unittest.TestCase):
    def setUp(self):
        self.ids = {name: str(i) * 64 for i, name in enumerate(('native-a', 'native-b', 'native-c'), 1)}
        self.policy = {'policy': 'browser-90m-refuse-unmeasured-v1', 'capacity_minutes': 90,
                       'setup_upload_minutes': 5, 'duration_factor': 1.5}

    def observation(self, name, seconds):
        return {'step': name, 'source': 'a' * 40, 'inputs_sha256': self.ids[name],
                'seconds': seconds, 'case_count': 2, 'cases_sha256': 'e' * 64,
                'complete': True, 'cleanup': True, 'evidence': {'summary_sha256': 'b' * 64,
                'report_sha256': 'c' * 64, 'run': '123', 'artifact': 'check-0'}}

    def jobs(self, rows, names=None, initial=1):
        return planner.browser_jobs(list(self.ids) if names is None else names, rows, self.ids, self.policy, initial)

    def test_public_plan_refuses_old_scalar_only_weights_and_oversized_observation(self):
        from pathlib import Path
        fake_units = [{'name': 'python 1', 'steps': 'python-units', 'python_shard': '1/1', 'timeout': 1}]
        required = ('native-a', 'python-units', 'wake-replay')
        with mock.patch.object(check, 'NATIVE_STEPS', [check.NativeStep('a', '', (), '')]), \
                mock.patch.object(check, 'REQUIRED', required), \
                mock.patch.object(planner, 'jobs', side_effect=lambda *args: copy.deepcopy(fake_units)), \
                mock.patch.object(planner, 'committed_browser_identities', return_value=self.ids, create=True):
            for rows in ([], [self.observation('native-a', 3420)]):
                with self.subTest(rows=bool(rows)), self.assertRaises(check.Refused):
                    planner.plan(Path('.'), 'push', {}, 'a' * 40, 1, {'native-a': 57},
                                 {'browser_budget': self.policy, 'browser_observations': rows})

    def test_maximum_observation_not_median_and_whole_selection_once(self):
        rows = [self.observation('native-a', 2400), self.observation('native-a', 3000),
                self.observation('native-b', 1800), self.observation('native-c', 600)]
        jobs = self.jobs(rows)
        self.assertEqual(sorted(n for j in jobs for n in j['steps'].split(',')), sorted(self.ids))
        self.assertEqual(len(jobs), 2)
        # a alone uses 75+5; b+c uses 60+5. Neither can absorb the other.
        self.assertEqual(sorted(j['budget_minutes'] for j in jobs), [65, 80])
        self.assertTrue(all(j['timeout_minutes'] == 90 for j in jobs))
        self.assertEqual(jobs, self.jobs(list(reversed(rows)), list(reversed(self.ids))))

    def test_unmeasured_new_stale_runtime_or_source_never_gets_a_median(self):
        rows = [self.observation('native-a', 60)]
        for change in ('new', 'source/runtime', 'partial', 'cleanup', 'missing inventory'):
            with self.subTest(change=change):
                row = copy.deepcopy(rows[0])
                if change == 'source/runtime': row['inputs_sha256'] = 'f' * 64
                if change == 'partial': row['complete'] = False
                if change == 'cleanup': row['cleanup'] = False
                if change == 'missing inventory': row.pop('cases_sha256')
                with self.assertRaisesRegex(check.Refused, 'native-'):
                    self.jobs([row], ['native-a', 'native-b'] if change == 'new' else ['native-a'])

    def test_setup_reserve_and_single_oversize_refuse_without_a_partial_plan(self):
        # 57 minutes * 1.5 = 85.5, exceeding 90 only when the reserve is counted.
        for seconds in (3420, 3845.305875):
            with self.assertRaisesRegex(check.Refused, 'native-a.*oversize'):
                self.jobs([self.observation('native-a', seconds)], ['native-a'])
        row = self.observation('native-a', 3400)
        self.assertEqual(self.jobs([row], ['native-a'])[0]['budget_minutes'], 90)

    def test_nonfinite_and_nonpositive_durations_refuse(self):
        for value in (0, -1, float('nan'), float('inf'), True):
            with self.subTest(value=value), self.assertRaises(check.Refused):
                self.jobs([self.observation('native-a', value)], ['native-a'])

    def test_input_fingerprint_binds_case_helpers_product_command_and_workflow(self):
        files = {'tools/release_check.py': b'definitions', 'tests/harness.mjs': b'cases',
                 'tests/helper.mjs': b'helper', 'web/app.mjs': b'product',
                 '.github/workflows/checks.yml': b'runtime', '.github/check-weights.json': b'metadata'}
        reached = {path: {'native-a'} for path in files}
        with mock.patch.object(planner.ci_input_reads, 'readers', return_value=(['native-a'], reached)):
            original = planner.browser_identities(files)
            for path in files:
                changed = dict(files, **{path: files[path] + b' changed'})
                if path.endswith('check-weights.json'):
                    self.assertEqual(planner.browser_identities(changed), original)
                else:
                    self.assertNotEqual(planner.browser_identities(changed), original, path)

    def test_finished_failed_step_measures_wall_time_but_partial_and_bad_inventory_refuse(self):
        step = {'name': 'native-a', 'started_at': '2026-11-18T01:00:00+00:00',
                'finished_at': '2026-11-18T01:50:00+00:00', 'passed': False,
                'counts': {'tests': 2, 'browser_closed': True}}
        summary = {'commit': 'a' * 40, 'tree_unchanged': True, 'steps': [step], 'only': ['native-a']}
        report = {'browserClosed': True, 'results': [{'name': 'first', 'passed': False},
                                                   {'name': 'last', 'passed': True}]}
        row = planner.browser_observation(summary, report, 'native-a', self.ids['native-a'],
                                          {'summary_sha256': 'b' * 64, 'report_sha256': 'c' * 64,
                                           'run': '123', 'artifact': 'check-0'})
        self.assertEqual(row['seconds'], 3000)
        self.assertEqual(row['case_count'], 2)
        full = dict(summary, required=['native-a'])
        full.pop('only')
        self.assertEqual(planner.browser_observation(full, report, 'native-a', self.ids['native-a'],
                                                     row['evidence'])['seconds'], 3000)
        for broken in (dict(report, browserClosed=False), dict(report, results=report['results'][:1]),
                       dict(report, results=[report['results'][0]] * 2)):
            with self.assertRaises(check.Refused):
                planner.browser_observation(summary, broken, 'native-a', self.ids['native-a'], {})
        with self.assertRaises(check.Refused):
            planner.browser_observation(dict(summary, tree_unchanged=False), report, 'native-a', self.ids['native-a'], {})

    def test_existing_mutation_phases_keep_distinct_case_identity(self):
        report = {'results': [{'name': 'same case', 'phase': 'mutant'},
                              {'name': 'same case', 'phase': 'restored'}]}
        self.assertEqual(planner.browser_case_inventory(report),
                         [('mutant', 'same case'), ('restored', 'same case')])
        rows = [self.observation('native-a', 60), self.observation('native-a', 90)]
        rows[1]['cases_sha256'] = 'f' * 64
        with self.assertRaisesRegex(check.Refused, 'case inventory differs'):
            self.jobs(rows, ['native-a'])

    def test_no_duplicate_or_missing_coverage_is_permitted(self):
        rows = [self.observation(n, 60) for n in self.ids]
        with self.assertRaises(check.Refused): self.jobs(rows, ['native-a', 'native-a'])
        self.assertEqual(self.jobs(rows, ['native-c'])[0]['steps'], 'native-c')
        self.assertEqual(self.jobs([], [], initial=4), [])


if __name__ == '__main__':
    unittest.main()

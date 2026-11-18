from __future__ import annotations

import copy
import unittest
from unittest import mock

from tools import unit_shards as planner, release_check as check


class BrowserBudget(unittest.TestCase):
    def setUp(self):
        self.ids = {name: str(i) * 64 for i, name in enumerate(('native-a', 'native-b', 'native-c'), 1)}
        self.policy = {'policy': 'browser-120m-fit-first-v1', 'capacity_minutes': 120,
                       'setup_upload_minutes': 5, 'duration_factor': 1.25}

    def observation(self, name, seconds):
        return {'step': name, 'source': 'a' * 40, 'inputs_sha256': self.ids[name],
                'seconds': seconds, 'case_count': 2, 'cases_sha256': 'e' * 64,
                'complete': True, 'cleanup': True, 'evidence': {'summary_sha256': 'b' * 64,
                'report_sha256': 'c' * 64, 'run': '123', 'artifact': 'check-0'}}

    def jobs(self, rows, names=None, initial=1):
        return planner.browser_jobs(list(self.ids) if names is None else names, rows, self.ids, self.policy, initial)

    def test_unknown_runs_alone_at_full_capacity_and_stale_timing_still_plans(self):
        row = self.observation('native-a', 60)
        row['inputs_sha256'] = 'f' * 64
        jobs = self.jobs([row], ['native-a', 'native-b'])
        self.assertEqual(sorted(j['steps'] for j in jobs), ['native-a', 'native-b'])
        unknown = next(j for j in jobs if j['steps'] == 'native-b')
        self.assertEqual(unknown['timeout_minutes'], 120)
        self.assertIsNone(unknown['minutes'])
        self.assertIsNone(unknown['budget_minutes'])
        self.assertEqual(unknown['timing_basis'], 'unknown-first-run')
        self.assertEqual(next(j for j in jobs if j['steps'] == 'native-a')['minutes'], 1)

    def test_maximum_observation_not_median_and_long_steps_are_alone(self):
        rows = [self.observation('native-a', 2400), self.observation('native-a', 3000),
                self.observation('native-b', 1800), self.observation('native-c', 600)]
        jobs = self.jobs(rows)
        self.assertEqual(sorted(n for j in jobs for n in j['steps'].split(',')), sorted(self.ids))
        self.assertEqual(len(jobs), 2)
        self.assertEqual(next(j for j in jobs if 'native-a' in j['steps'])['steps'], 'native-a')
        self.assertEqual(sorted(j['budget_minutes'] for j in jobs), [55, 68])
        self.assertTrue(all(j['timeout_minutes'] == 120 for j in jobs))
        self.assertEqual(jobs, self.jobs(list(reversed(rows)), list(reversed(self.ids))))

    def test_partial_is_a_planning_lower_bound_never_a_completion_certificate(self):
        row = self.observation('native-a', 2700)
        row.update(complete=False, cleanup=False, kind='partial-lower-bound')
        row['evidence']['log_sha256'] = 'd' * 64
        before = copy.deepcopy(row)
        jobs = self.jobs([row, self.observation('native-b', 60)], ['native-a', 'native-b'])
        partial = next(j for j in jobs if j['steps'] == 'native-a')
        self.assertEqual(partial['timing_basis'], 'includes-partial-lower-bound')
        self.assertEqual(partial['measurements']['native-a'], [before])
        self.assertEqual(row, before)

    def test_reserve_factor_and_oversize_are_enforced_without_partial_output(self):
        # 92m * 1.25 + 5 = 120 exactly; one more second cannot fit.
        self.assertEqual(self.jobs([self.observation('native-a', 5520)], ['native-a'])[0]['budget_minutes'], 120)
        with self.assertRaisesRegex(check.Refused, 'native-a.*oversize'):
            self.jobs([self.observation('native-a', 5521)], ['native-a', 'native-b'])
        for key, value in [('capacity_minutes', 90), ('setup_upload_minutes', 0), ('duration_factor', 1)]:
            broken = dict(self.policy, **{key: value})
            with self.assertRaises(check.Refused):
                planner.browser_jobs(['native-a'], [], self.ids, broken, 1)
        rows = [self.observation(n, 2760) for n in self.ids]
        jobs = self.jobs(rows)
        self.assertEqual(len(jobs), 2)
        self.assertTrue(all(j['minutes'] * 1.25 + 5 <= 120 for j in jobs))
        self.assertEqual(sorted(n for j in jobs for n in j['steps'].split(',')), sorted(self.ids))

    def test_next_measurement_replaces_stale_timing_without_losing_other_steps(self):
        stale = [self.observation('native-a', 3000), self.observation('native-b', 60)]
        fresh = [self.observation('native-a', 600)]
        before = copy.deepcopy(stale)
        rows = planner.replace_browser_observations(stale, fresh)
        jobs = self.jobs(rows, ['native-a', 'native-b'])
        self.assertEqual(sum(j['minutes'] for j in jobs), 11)
        self.assertEqual(stale, before)
        self.assertEqual(len(rows), 2)

    def test_runnable_default_accounts_for_real_inventory_and_python_partitions(self):
        import json
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        result = planner.plan(root, 'push', {}, '', weights=json.loads((root / '.github/check-weights.json').read_text()))
        ordinary = [n for j in result['shards'] if not j.get('python_shard') for n in j['steps'].split(',')]
        self.assertCountEqual(ordinary + ['python-units'], check.REQUIRED)
        self.assertEqual(len(ordinary), len(set(ordinary)))
        python = [j for j in result['shards'] if j.get('python_shard')]
        self.assertEqual([j['python_shard'] for j in python], ['1/4','2/4','3/4','4/4'])
        self.assertTrue(all(j['steps']=='python-units' and j['timeout_minutes']==49 for j in python))
        files = [f for j in python for f in j['files']]
        self.assertEqual(sorted(files), planner.test_files(root))
        self.assertEqual(len(files), len(set(files)))
        for job in result['shards']:
            if not job['name'].startswith('browser '): continue
            self.assertEqual(job['timeout_minutes'], 120)
            if job['minutes'] is None:
                self.assertEqual(len(job['steps'].split(',')), 1)
            else:
                self.assertLessEqual(job['minutes'] * 1.25 + 5, 120)

    def test_nonfinite_and_nonpositive_durations_refuse(self):
        for value in (0, -1, float('nan'), float('inf'), True):
            with self.subTest(value=value), self.assertRaises(check.Refused):
                self.jobs([self.observation('native-a', value)], ['native-a'])

    def test_input_fingerprint_binds_case_helpers_product_command_and_workflow(self):
        files = {'tools/release_check.py': b'definitions', 'tests/harness.mjs': b'cases',
                 'tests/helper.mjs': b'helper', 'web/app.mjs': b'product',
                 '.github/workflows/checks.yml': b'runtime', '.github/check-weights.json': b'metadata'}
        reached = {path: {'native-a'} for path in files}
        from types import SimpleNamespace
        with mock.patch.object(check, 'NATIVE_STEPS', [SimpleNamespace(name='a')]):
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
        self.assertEqual(self.jobs(rows, ['native-a'])[0]['minutes'], 1.5)
        self.assertEqual(len(self.jobs(rows, ['native-a'])[0]['measurements']['native-a']), 2)

    def test_no_duplicate_or_missing_coverage_is_permitted(self):
        rows = [self.observation(n, 60) for n in self.ids]
        with self.assertRaises(check.Refused): self.jobs(rows, ['native-a', 'native-a'])
        self.assertEqual(self.jobs(rows, ['native-c'])[0]['steps'], 'native-c')
        self.assertEqual(self.jobs([], [], initial=4), [])


if __name__ == '__main__':
    unittest.main()

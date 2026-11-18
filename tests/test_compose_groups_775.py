from __future__ import annotations

import copy
import unittest
from unittest.mock import patch
from tools import compose_groups as c, unit_shards, release_check


class ComposeGroups775(unittest.TestCase):
    def fixture(self, count=60):
        rows = [{'phase': 'run', 'engine': e, 'name': e + ' case ' + str(i)}
                for e in ('chromium', 'webkit') for i in range(count)]
        source = {'head': 'a' * 40, 'tree': 'b' * 40, 'parents': ['c' * 40]}
        return c.partition({'rows': rows}, source)

    def receipts(self, plan):
        return [{'group': g['id'], 'source': g['source'], 'cases_sha256': g['cases_sha256'],
                 'complete': True, 'cleanup': True, 'passed': True, 'exit': 0,
                 'results': [dict(r, passed=True) for r in g['cases']]} for g in plan['groups']]

    def test_disjoint_union_and_unknown_limits(self):
        plan = self.fixture()
        rows = [c.identity(r) for g in plan['groups'] for r in g['cases']]
        self.assertEqual(len(rows), 120); self.assertEqual(len(set(rows)), 120)
        self.assertTrue(all(g['case_budget_seconds'] <= 4500 for g in plan['groups']))
        self.assertTrue(all(g['minutes'] is None for g in plan['groups']))
        self.assertTrue(all(r['limit_seconds'] == 300 for g in plan['groups'] for r in g['cases']))

    def test_retained_phase_not_replayed(self):
        p = self.fixture(2)
        rows = [r for g in p['groups'] for r in g['cases']]
        result = c.partition({'rows': rows}, p['source'], retained=['run:chromium'])
        self.assertEqual(len(result['retained_cases']), 2)
        self.assertEqual([g['engine'] for g in result['groups']], ['webkit'])
        with self.assertRaisesRegex(c.Refused,'original authenticated evidence'):
            c.collect(result,self.receipts(result))

    def test_maximum_and_reserve_not_median(self):
        p = self.fixture(2); rows = [r for g in p['groups'] for r in g['cases']]
        observed = [{'name': r['name'], 'ms': ms} for r, ms in zip(rows, [100, 39146])]
        result = c.partition({'rows': rows}, p['source'], timings=observed)
        self.assertEqual(result['limits']['successful_case_limit_seconds'], 109)
        self.assertEqual(result['limits']['retained_max_success_seconds'], 39.146)

    def test_raw_false_and_expected_mutants_remain_raw(self):
        p = self.fixture(2); r = self.receipts(p)
        r[0]['results'][0].update(passed=False, expectedFailure=True, mutationCaught=True, error='actual mutant red')
        r[1]['results'][0].update(passed=False, error='product assertion red')
        union = c.collect(p, r)
        self.assertTrue(union['complete']); self.assertFalse(union['passed'])
        self.assertEqual(len(union['raw_false']), 2); self.assertEqual(len(union['expected_mutants']), 1)

    def test_missing_duplicate_partial_wrong_source_and_numeric_false_refuse(self):
        p = self.fixture(2); r = self.receipts(p)
        self.assertFalse(c.collect(p, r[:-1])['complete'])
        partial = copy.deepcopy(r); partial[0]['cleanup'] = False
        self.assertFalse(c.collect(p, partial)['complete'])
        self.assertEqual(len(c.collect(p, partial)['results']), 4)
        for change in ('duplicate', 'source', 'numeric', 'drop'):
            altered = copy.deepcopy(r)
            if change == 'duplicate': altered.append(altered[0])
            if change == 'partial': altered[0]['cleanup'] = False
            if change == 'source': altered[0]['source']['head'] = 'd' * 40
            if change == 'numeric': altered[0]['results'][0]['passed'] = 0
            if change == 'drop': altered[0]['results'].pop()
            with self.subTest(change=change), self.assertRaises(c.Refused): c.collect(p, altered)

    def test_nonzero_producer_with_true_rows_stays_red(self):
        plan=self.fixture(2); receipts=self.receipts(plan)
        receipts[0].update(exit=1, passed=False)
        union=c.collect(plan,receipts)
        self.assertTrue(union['complete']); self.assertFalse(union['passed'])
        self.assertEqual(union['receipts'][0]['exit'],1)

    def test_group_observed_maximum_feeds_next_plan(self):
        p = self.fixture(2); g = p['groups'][0]
        rows = [dict(group=g['id'], cases_sha256=g['cases_sha256'], seconds=s,
                     complete=True, cleanup=True, evidence_sha256='e' * 64) for s in (30, 300)]
        jobs = c.group_jobs(p, rows)
        self.assertEqual(jobs[0]['minutes'], 5); self.assertEqual(jobs[0]['budget_minutes'], 12)
        self.assertIsNone(jobs[1]['minutes']); self.assertEqual(jobs[1]['timeout_minutes'], 120)

    def test_partial_group_is_only_a_retained_lower_bound(self):
        p=self.fixture(2); receipt=self.receipts(p)[0]
        receipt.update(complete=False,cleanup=False,seconds=600,passed=False)
        observed=c.observation(receipt,'e'*64)
        jobs=c.group_jobs(p,[observed])
        self.assertEqual(jobs[0]['minutes'],10)
        self.assertEqual(jobs[0]['timing_basis'],'includes-partial-lower-bound')
        self.assertFalse(jobs[0]['measurements'][0]['raw_passed'])
        self.assertFalse(c.collect(p,[receipt])['complete'])

    def test_default_planner_expands_compose_other_steps_once(self):
        import json
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        rows = [{'phase':'run', 'engine':e, 'name':e+' case'} for e in ('chromium','webkit')]
        weights = json.loads((root/'.github/check-weights.json').read_text())
        with patch.object(c, 'enumerate_source', return_value={'rows':rows}):
            result = unit_shards.plan(root, 'push', {}, 'a'*40, weights=weights)
        compose = [j for j in result['shards'] if j.get('compose_group')]
        self.assertEqual(len(compose), 2)
        ordinary = [s for j in result['shards'] if not j.get('compose_group') and not j.get('python_shard') for s in j['steps'].split(',')]
        self.assertEqual(sorted(ordinary + ['python-units','native-compose']), sorted(release_check.REQUIRED))
        self.assertFalse(any(j['steps']=='native-compose' and not j.get('compose_group') for j in result['shards']))

    def test_collector_integrates_original_obligation_once(self):
        p=self.fixture(2); r=self.receipts(p)
        jobs=c.group_jobs(p)
        docs=[{'required':['native-compose'], 'compose_group':job['compose_group'], 'steps':[{'name':'native-compose', 'compose_receipt':receipt}]} for job,receipt in zip(jobs,r)]
        receipts=[{'shard':{'name':j['name']}} for j in jobs]
        steps, required, _, missing_jobs, missing = release_check.combine_unit_results(docs,jobs,receipts)
        self.assertEqual([s['name'] for s in steps],['native-compose'])
        self.assertEqual(steps[0]['counts']['tests'],4); self.assertFalse(missing or missing_jobs)
        steps, _, _, _, missing = release_check.combine_unit_results(docs[:-1],jobs,receipts[:-1])
        self.assertEqual(steps,[]); self.assertIn('native-compose',missing)

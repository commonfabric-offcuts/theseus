from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import unittest

from tests import test_step_controls_1070 as fixtures
from tests import test_verdict_summary as publication

C = fixtures.CONTROLLER


class BrowserWindowCase(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.StepControlsCase()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.addCleanup(self.retain)

    def retain(self):
        target = os.environ.get('BROWSER_WINDOW_EVIDENCE')
        if target:
            shutil.copytree(self.f.root, Path(target) / self._testMethodName)

    def bundle(self, number, passed=False, name='known case', error='stable failure', cancelled=()):
        folder, run = self.f.bundle(number, cancelled)
        if 'native-reader' in cancelled:
            return folder, run
        out = folder / 'shards/check-2'
        report_path = out / 'native/reader/native.json'
        report = json.loads(report_path.read_text())
        report['results'] = [{'name': name, 'passed': passed,
                              **({} if passed else {'error': 'AssertionError: %s\n at /fixture/tests/reader.mjs:1:1' % error})}]
        report_path.write_text(json.dumps(report))
        (out / 'native-reader.log').write_text('' if passed else C.END_LINE + '\n')
        counts, good = C.native_counts(C.NativeStep('reader', 'tests/reader.mjs', (), 'native.json'), out / 'native/reader')
        step = {'name': 'native-reader', 'passed': good, 'exit': 0 if good else 1, 'counts': counts}
        raw_path = out / 'summary.json'
        raw = json.loads(raw_path.read_text())
        raw.update(passed=good, failed=[] if good else ['native-reader'], steps=[step])
        raw_path.write_text(json.dumps(raw))
        receipt_path = out / 'run.json'
        receipt = json.loads(receipt_path.read_text())
        receipt['summary_sha256'] = hashlib.sha256(raw_path.read_bytes()).hexdigest()
        receipt_path.write_text(json.dumps(receipt))
        provenance_path = folder / 'release-check/provenance.json'
        provenance = json.loads(provenance_path.read_text())
        provenance['shards'][-1]['receipt'] = receipt
        provenance_path.write_text(json.dumps(provenance))
        summary_path = folder / 'release-check/summary.json'
        summary = json.loads(summary_path.read_text())
        summary['steps'][-1] = step
        summary['failed'] = sorted([s['name'] for s in summary['steps'] if not s['passed']] + list(cancelled))
        summary['passed'] = not summary['failed']
        summary_path.write_text(json.dumps(summary))
        return folder, run

    def compare(self, states, candidate_name='known case', candidate_error='stable failure', **kwargs):
        path = self.f.collect([self.bundle(n, passed)[0] for n, passed in enumerate(states, 1)])
        known, records = self.f.known(path)
        folder, run = self.bundle(99, name=candidate_name, error=candidate_error)
        observed, raw = C.read_evidence(folder / 'release-check/summary.json', folder / 'release-check/provenance.json',
                                        folder / 'shards', self.f.repo, self.f.sha, run,
                                        {'ref': None, 'sha': None}, self.f.merge)
        failed, _ = C.failure_records(observed, self.f.repo, self.f.sha, 99, window=True)
        result = C.compare_failures(failed, known, records)
        print(json.dumps({'case': self._testMethodName, 'manifest': json.loads(path.read_text()),
                          'candidate_raw_passed': raw['passed'], 'verdict': result}, sort_keys=True))
        return result, path, known, records, failed

    def test_five_runs_name_flip_with_actual_passing_and_failing_runs(self):
        result, _, _, _, _ = self.compare([True, True, True, False, True])
        self.assertTrue(result['passed'])
        self.assertEqual(result['noise'][0]['passing_base_runs'], [1, 2, 3, 5])
        self.assertEqual(result['noise'][0]['failing_base_runs'], [4])
        self.assertEqual(result['noise'][0]['matched_base_runs'], [4])
        self.assertFalse(result['noise'][0]['raw_passed'])

    def test_all_green_window_makes_candidate_red_new(self):
        result, _, _, _, _ = self.compare([True] * 5)
        self.assertFalse(result['passed'])
        self.assertEqual(result['noise'], [])
        self.assertIn('all passed', result['unexpected'][0]['reason'])

    def test_all_red_window_remains_known(self):
        result, _, _, _, _ = self.compare([False] * 5)
        self.assertTrue(result['passed'])
        self.assertEqual(result['noise'], [])
        self.assertEqual(result['expected'][0]['matched_base_runs'], [1, 2, 3, 4, 5])

    def test_four_run_fallback_does_not_use_fourth_failure(self):
        result, _, _, _, _ = self.compare([True, True, True, False])
        self.assertFalse(result['passed'])
        self.assertEqual(result['noise'], [])

    def test_four_run_fallback_still_accepts_one_of_three(self):
        result, _, _, _, _ = self.compare([True, False, True, True])
        self.assertTrue(result['passed'])
        self.assertEqual(result['noise'], [])
        self.assertEqual(result['expected'][0]['matched_base_runs'], [2])

    def test_only_last_ten_complete_browser_runs_and_three_nonbrowser_controls(self):
        result, path, _, records, _ = self.compare([True] * 10 + [False, False])
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest['browser_window_runs'], {'native-reader': list(range(1, 11))})
        self.assertEqual(manifest['step_runs'], {name: [1, 2, 3] for name in self.f.required})
        self.assertEqual(len(records), 10)
        self.assertFalse(result['passed'])

    def test_changed_fingerprint_on_flipping_case_is_new(self):
        result, _, _, _, _ = self.compare([True, False, True, True, True], candidate_error='different assertion')
        self.assertFalse(result['passed'])
        self.assertEqual(result['noise'], [])
        self.assertIn('fingerprint', result['unexpected'][0]['reason'])

    def test_changed_case_is_never_a_passing_observation(self):
        result, _, _, _, _ = self.compare([True, False, True, True, True], candidate_name='new case')
        self.assertFalse(result['passed'])
        self.assertEqual(result['noise'], [])

    def test_missing_step_uses_older_complete_window_member(self):
        folders = [self.bundle(1, cancelled=('native-reader',))[0]]
        folders += [self.bundle(n, n != 5)[0] for n in range(2, 7)]
        path = self.f.collect(folders)
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest['browser_window_runs']['native-reader'], [2, 3, 4, 5, 6])
        self.assertEqual(manifest['fewer_than_five_browser_steps'], [])
        self.assertEqual(manifest['fewer_than_ten_browser_steps'], ['native-reader'])
        self.assertEqual([r['id'] for r in self.f.known(path)[1]], list(range(1, 7)))

    def test_manifest_cannot_relabel_window_ids(self):
        _, path, _, _, _ = self.compare([True, True, True, False, True])
        manifest = json.loads(path.read_text())
        manifest['browser_window_runs']['native-reader'] = [1, 2, 3, 4, 999]
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(C.Refused, 'window'):
            self.f.known(path)

    def test_nonbrowser_requires_original_three_not_extra_browser_history(self):
        _, _, _, records, _ = self.compare([True, True, True, False, True])
        failure = {'step': 'node-units', 'case': {'name': 'unit'}, 'raw_passed': False,
                   'run_id': 99, 'comparison': 'unit-identity', 'unit_status': 'FAIL'}
        known = [dict(failure, run_id=n) for n in (1, 2, 3)]
        self.assertTrue(C.compare_failures([failure], known, records)['passed'])
        self.assertFalse(C.compare_failures([failure], known[:-1], records)['passed'])

    def test_legacy_records_keep_existing_fallback(self):
        result, _, known, records, failed = self.compare([True, False, True])
        for record in records:
            record.pop('browser_window_steps', None)
            record.pop('browser_cases', None)
        self.assertTrue(C.compare_failures(failed, known, records)['passed'])
        self.assertTrue(result['passed'])

    def test_changed_profile_or_harness_does_not_supply_noise(self):
        _, _, known, records, failed = self.compare([True, False, True, True, True])
        for field in ('profile', 'harness'):
            changed = copy.deepcopy(records)
            changed[-1]['browser_cases'][0][field] = {'different': True}
            verdict = C.compare_failures(failed, known, changed)
            self.assertFalse(verdict['passed'], field)
            self.assertEqual(verdict['noise'], [])

    def test_missing_case_in_one_complete_step_is_not_a_pass(self):
        _, _, known, records, failed = self.compare([True, False, True, True, True])
        records[-1]['browser_cases'] = []
        self.assertFalse(C.compare_failures(failed, known, records)['passed'])

    def test_candidate_cancelled_step_refuses_before_comparison(self):
        folder, run = self.bundle(99, cancelled=('native-reader',))
        with self.assertRaisesRegex(C.Refused, 'cancelled shard'):
            C.read_evidence(folder / 'release-check/summary.json', folder / 'release-check/provenance.json',
                            folder / 'shards', self.f.repo, self.f.sha, run,
                            {'ref': None, 'sha': None}, self.f.merge)

    def test_fifth_run_digest_corruption_refuses_instead_of_fallback(self):
        folders = [self.bundle(n, n != 4)[0] for n in range(1, 6)]
        raw_path = folders[4] / 'shards/check-2/summary.json'
        raw_path.write_text(raw_path.read_text() + ' ')
        path = self.f.collect(folders)
        with self.assertRaisesRegex(C.Refused, 'original summary digest differs'):
            self.f.known(path)

    def test_fixture_exit_diagnostic_keeps_existing_three_control_rule(self):
        _, _, known, records, failed = self.compare([True, False, True, True, True])
        candidate = dict(failed[0], case={'name': 'fixture exit 1'})
        control = dict(candidate, run_id=2)
        verdict = C.compare_failures([candidate], [control], records)
        self.assertTrue(verdict['passed'])
        self.assertEqual(verdict['noise'], [])
        self.assertEqual(verdict['expected'][0]['matched_base_runs'], [2])

    def test_fifth_run_from_wrong_source_refuses_instead_of_shortfall(self):
        _, path, _, _, _ = self.compare([True, True, True, False, True])
        manifest = json.loads(path.read_text())
        manifest['runs'][-1]['head_sha'] = 'f' * 40
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(C.Refused, 'authenticated base history'):
            self.f.known(path)

    def test_published_verdict_names_noise_and_keeps_failed_raw_observation(self):
        verdict, _, _, _, _ = self.compare([True, True, True, False, True])
        verdict['raw_passed'] = False
        verdict['browser_windows'] = {'native-reader': {'run_ids': [1, 2, 3, 4, 5], 'complete_runs': 5, 'mode': 'window'}}
        result = publication.VerdictSummaryCase().render(verdict, None, refusals='')
        self.assertEqual(result['conclusion'], 'success')
        shown = json.loads(result['output']['summary'].split('Validation: ', 1)[1].split('\n', 1)[0])
        self.assertEqual(shown['noise'][0]['failing_base_runs'], [4])
        self.assertFalse(shown['noise'][0]['raw_passed'])
        self.assertEqual(shown['browser_windows']['native-reader']['complete_runs'], 5)


if __name__ == '__main__':
    unittest.main()

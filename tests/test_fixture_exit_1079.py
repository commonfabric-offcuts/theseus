from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


REAL_TAIL = (Path(__file__).resolve().parent / 'fixtures/fixture-exit-tail-1079.txt').read_text().replace(
    '/Users/runner/work/theseus/theseus', '/fixture')


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fixture_exit_controller', ROOT / 'tools/ci_known_reds.py')
CONTROLLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROLLER)

CHECKOUT = '/fixture'
FIXTURE = 'tests/fixtures/ui_http.py'
# Line 3 holds the fixture's end-of-run assertion, line 7 its call.
FIXTURE_SOURCE = ('def main():\n'
                  '    item645_unrestored = True\n'
                  '    assert not item645_unrestored, "Item 645 comparison runtime was not restored"\n'
                  '\n'
                  '\n'
                  'if __name__ == "__main__":\n'
                  '    main()\n')
MESSAGE = 'AssertionError: Item 645 comparison runtime was not restored'
# The harness echoes the fixture's traceback, then fails its own check of the fixture's exit.
FIXTURE_TRACEBACK = ('AssertionError [ERR_ASSERTION]: Traceback (most recent call last):\n'
                     '  File "/fixture/tests/fixtures/ui_http.py", line 7, in <module>\n'
                     '    main()\n'
                     '  File "/fixture/tests/fixtures/ui_http.py", line 3, in main\n'
                     '    assert not item645_unrestored, "Item 645 comparison runtime was not restored"\n'
                     + MESSAGE + '\n\n\n1 !== 0\n\n'
                     '    at file:///fixture/tests/reader_persistence_native.mjs:1823:10 {\n'
                     '  generatedMessage: false,\n'
                     '  code: \'ERR_ASSERTION\'\n'
                     '}\n')
RED = {'name': 'reading one', 'passed': False,
       'error': 'AssertionError: red\n    at file:///fixture/tests/reader_persistence_native.mjs:10:5'}
GREEN = {'name': 'reading two', 'passed': True}
THIRD = {'name': 'reading three', 'passed': True}
STEP = CONTROLLER.NATIVE['native-reading']
HARNESS = 'a1b2c3d4e5'
PROFILE = {name: 'fixture' for name in CONTROLLER.PROFILE_FIELDS}


def log_lines(rows):
    return ''.join('{"case":"%s","started":"t"}\n{"name":"%s","passed":%s,"started":"t","finished":"t"}\n'
                   % (r['name'], r['name'], 'true' if r['passed'] else 'false') for r in rows)


class FixtureExitCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.out = root / 'out'
        (self.out / 'native' / STEP.name).mkdir(parents=True)
        self.repo = root / 'source'
        (self.repo / 'tests/fixtures').mkdir(parents=True)
        (self.repo / FIXTURE).write_text(FIXTURE_SOURCE)
        (self.repo / 'tests/reader_persistence_native.mjs').write_text(''.join('harness line %d\n' % n for n in range(1, 2000)))
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def evidence(self, exit_code, tail, rows=(RED, GREEN), signal=None, log=None, completed=True):
        """The step as the producer records it: the harness exits non-zero on any failing case or fixture exit."""
        rows = list(rows)
        report = {'results': rows, 'browserClosed': True, 'fixtureExitCode': exit_code, 'fixtureExitSignal': signal}
        if completed is not None:
            report['bodyCompleted'] = completed
        (self.out / 'native' / STEP.name / STEP.results).write_text(json.dumps(report))
        (self.out / 'native-reading.log').write_text((log_lines(rows) if log is None else log) + tail)
        counts, good = CONTROLLER.native_counts(STEP, self.out / 'native' / STEP.name)
        good = good and exit_code == 0 and signal is None
        return {'name': 'native-reading', 'passed': good, 'exit': 0 if good else 1, 'counts': counts}

    def cases(self, step, harness=HARNESS, history=False):
        return CONTROLLER.cases(step, self.out, harness, history)

    def refused(self, step, harness=HARNESS, history=False):
        with self.assertRaises(CONTROLLER.Refused) as refused:
            self.cases(step, harness, history)
        return str(refused.exception)

    def records(self, rows, run_id):
        failures, _ = CONTROLLER.failure_records([('native-reading', rows, PROFILE, CHECKOUT)], self.repo, self.sha, run_id)
        return failures

    def test_fixture_exit_after_every_case_is_a_failure_the_step_carries(self):
        rows = self.cases(self.evidence(1, FIXTURE_TRACEBACK))
        self.assertEqual(rows[:2], [RED, GREEN])
        self.assertEqual(len(rows), 3)
        exit_row = rows[2]
        self.assertEqual((exit_row['name'], exit_row['passed']), ('fixture exit 1', False))
        message = MESSAGE + ' | after 2 cases of tests/reader_persistence_native.mjs ' + HARNESS
        self.assertTrue(exit_row['error'].startswith(message + '\n'), exit_row['error'])
        fingerprint = CONTROLLER.fingerprint(exit_row['error'], CHECKOUT, self.repo, self.sha)
        self.assertEqual([frame['path'] for frame in fingerprint['chain']], [FIXTURE, FIXTURE])
        self.assertEqual([frame['text'] for frame in fingerprint['chain']],
                         ['main()', 'assert not item645_unrestored, "Item 645 comparison runtime was not restored"'])
        self.assertEqual(fingerprint['values'], message)

    def test_all_green_cases_with_a_fixture_exit_are_judged_not_refused(self):
        step = self.evidence(1, FIXTURE_TRACEBACK, rows=(GREEN, THIRD))
        self.assertEqual((step['passed'], step['exit']), (False, 1))
        rows = self.cases(step)
        self.assertEqual([row['name'] for row in rows], ['reading two', 'reading three', 'fixture exit 1'])
        self.assertEqual([f['case']['name'] for f in self.records(rows, 3)], ['fixture exit 1'])

    def test_fixture_exit_the_controls_share_is_known_and_one_they_do_not_is_new(self):
        rows = self.cases(self.evidence(1, FIXTURE_TRACEBACK))
        candidate = self.records(rows, 2)
        self.assertEqual([f['case']['name'] for f in candidate], ['reading one', 'fixture exit 1'])
        self.assertTrue(all('fingerprint' in f for f in candidate), candidate)
        shared = CONTROLLER.compare_failures(candidate, self.records(rows, 1))
        self.assertTrue(shared['passed'], shared)
        self.assertEqual([(f['case']['name'], f['matched_base_runs']) for f in shared['expected']],
                         [('reading one', [1]), ('fixture exit 1', [1])])
        clean_control = self.records(self.cases(self.evidence(0, CONTROLLER.END_LINE + '\n')), 1)
        new = CONTROLLER.compare_failures(candidate, clean_control)
        self.assertFalse(new['passed'])
        self.assertEqual([(f['case']['name'], f['reason']) for f in new['unexpected']],
                         [('fixture exit 1', 'not shown by recent base runs')])

    def test_a_candidate_whose_body_did_not_finish_is_refused_whatever_the_controls_show(self):
        # Balanced case lines and the fixture's traceback are what a body that threw between cases also leaves;
        # the harness's own attestation is what tells the two apart, and a control that shares the prefix does not help.
        for completed in (False, None):
            self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, completed=completed)),
                             'native-reading: harness did not finish its cases')
        self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, completed='yes')),
                         'native-reading: harness did not finish its cases')

    def test_a_control_recorded_before_the_attestation_is_read_by_its_source_count_and_assertion(self):
        control_rows = self.cases(self.evidence(1, FIXTURE_TRACEBACK, completed=None), history=True)
        self.assertEqual(control_rows[-1]['name'], 'fixture exit 1')
        candidate = self.records(self.cases(self.evidence(1, FIXTURE_TRACEBACK)), 2)
        self.assertTrue(CONTROLLER.compare_failures(candidate, self.records(control_rows, 1))['passed'])

    def test_a_control_that_says_its_body_did_not_finish_is_refused_too(self):
        # Only a report with neither attestation field is read as a pre-attestation control; an explicit false,
        # or anything but true, on a control is an aborted body and never a comparable fixture exit.
        for completed in (False, 'yes', 0):
            self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, completed=completed), history=True),
                             'native-reading: harness did not finish its cases')

    def test_the_real_tail_of_links_run_is_the_fixture_exit(self):
        rows = self.cases(self.evidence(1, REAL_TAIL))
        self.assertEqual(rows[-1]['name'], 'fixture exit 1')
        self.assertTrue(rows[-1]['error'].startswith(MESSAGE + ' | after 2 cases of'), rows[-1]['error'])
        self.assertEqual([frame['text'] for frame in CONTROLLER.fingerprint(rows[-1]['error'], CHECKOUT, self.repo, self.sha)['chain']],
                         ['main()', 'assert not item645_unrestored, "Item 645 comparison runtime was not restored"'])

    def test_a_harness_that_stopped_between_cases_matches_no_control(self):
        control = self.records(self.cases(self.evidence(1, FIXTURE_TRACEBACK, rows=(RED, GREEN, THIRD))), 1)
        candidate = self.records(self.cases(self.evidence(1, FIXTURE_TRACEBACK)), 2)
        verdict = CONTROLLER.compare_failures(candidate, control)
        self.assertFalse(verdict['passed'])
        self.assertEqual([f['case']['name'] for f in verdict['unexpected']], ['fixture exit 1'])

    def test_a_changed_harness_matches_no_control(self):
        control = self.records(self.cases(self.evidence(1, FIXTURE_TRACEBACK), harness='0000000000'), 1)
        candidate = self.records(self.cases(self.evidence(1, FIXTURE_TRACEBACK)), 2)
        self.assertEqual([f['case']['name'] for f in CONTROLLER.compare_failures(candidate, control)['unexpected']],
                         ['fixture exit 1'])

    def test_fixture_that_died_before_a_case_finished_is_refused(self):
        log = log_lines([RED, GREEN]) + '{"case":"reading three","started":"t"}\n'
        self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, log=log)),
                         'native-reading: fixture died before the end')

    def test_a_log_that_disagrees_with_the_report_is_refused(self):
        self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, log=log_lines([RED, THIRD]))),
                         'native-reading: result log disagrees with report')

    def test_a_traceback_before_the_last_case_is_not_the_fixture_exit(self):
        log = log_lines([RED]) + FIXTURE_TRACEBACK + log_lines([GREEN])
        self.assertEqual(self.refused(self.evidence(1, 'Killed\n', log=log)),
                         'native-reading: fixture exit without its assertion')

    def test_a_fatal_tail_after_the_fixture_traceback_is_refused_and_named(self):
        for extra in ('TypeError: cannot read properties of null\n    at file:///fixture/tests/reader_persistence_native.mjs:1830:3\n',
                      'Error: unrelated fatal tail\n    at file:///fixture/tests/reader_persistence_native.mjs:1830:3\n',
                      'Error [ERR_UNHANDLED_REJECTION]: unrelated fatal tail\n',
                      'Segmentation fault: 11\n',
                      'the harness printed something else\n'):
            refusal = self.refused(self.evidence(1, FIXTURE_TRACEBACK + extra))
            self.assertTrue(refusal.startswith('native-reading: fixture exit is not the last failure: ' + extra.split('\n')[0]), refusal)

    def test_fixture_exit_without_its_assertion_is_refused(self):
        self.assertEqual(self.refused(self.evidence(1, 'Killed\n')), 'native-reading: fixture exit without its assertion')
        headless = FIXTURE_TRACEBACK.replace('AssertionError [ERR_ASSERTION]: Traceback', 'Traceback')
        self.assertEqual(self.refused(self.evidence(1, headless)), 'native-reading: fixture exit without its assertion')

    def test_fixture_exit_without_the_harness_source_is_refused(self):
        self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK), harness=None),
                         'native-reading: harness source unrecorded')

    def test_signalled_fixture_is_still_refused(self):
        self.assertEqual(self.refused(self.evidence(1, FIXTURE_TRACEBACK, signal='SIGKILL')),
                         'native-reading: fixture was signalled')

    def test_clean_fixture_exit_reads_as_before(self):
        self.assertEqual(self.cases(self.evidence(0, CONTROLLER.END_LINE + '\n')), [RED, GREEN])
        self.assertEqual(self.cases(self.evidence(0, CONTROLLER.END_LINE + '\n', completed=None), harness=None), [RED, GREEN])
        self.assertEqual(self.refused(self.evidence(0, 'no end line\n')), 'native-reading: harness did not reach end')


if __name__ == '__main__':
    unittest.main()

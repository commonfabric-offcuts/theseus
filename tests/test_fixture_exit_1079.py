from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


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
STEP = CONTROLLER.NATIVE['native-reading']
PROFILE = {name: 'fixture' for name in CONTROLLER.PROFILE_FIELDS}


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

    def evidence(self, exit_code, tail, rows=(RED, GREEN), signal=None, log_rows=None):
        rows = list(rows)
        report = {'results': rows, 'browserClosed': True, 'fixtureExitCode': exit_code, 'fixtureExitSignal': signal}
        (self.out / 'native' / STEP.name / STEP.results).write_text(json.dumps(report))
        log = ''.join('{"case":"%s","started":"t"}\n{"name":"%s","passed":%s}\n'
                      % (r['name'], r['name'], 'true' if r['passed'] else 'false') for r in rows)
        (self.out / 'native-reading.log').write_text((log if log_rows is None else log_rows) + tail)
        counts, good = CONTROLLER.native_counts(STEP, self.out / 'native' / STEP.name)
        return {'name': 'native-reading', 'passed': good, 'exit': 0 if good else 1, 'counts': counts}

    def records(self, rows, run_id):
        failures, _ = CONTROLLER.failure_records([('native-reading', rows, PROFILE, CHECKOUT)], self.repo, self.sha, run_id)
        return failures

    def test_fixture_exit_after_every_case_is_a_failure_the_step_carries(self):
        rows = CONTROLLER.cases(self.evidence(1, FIXTURE_TRACEBACK), self.out)
        self.assertEqual(rows[:2], [RED, GREEN])
        self.assertEqual(len(rows), 3)
        exit_row = rows[2]
        self.assertEqual((exit_row['name'], exit_row['passed']), ('fixture exit 1', False))
        self.assertTrue(exit_row['error'].startswith(MESSAGE + '\n'), exit_row['error'])
        fingerprint = CONTROLLER.fingerprint(exit_row['error'], CHECKOUT, self.repo, self.sha)
        self.assertEqual([frame['path'] for frame in fingerprint['chain']], [FIXTURE, FIXTURE])
        self.assertEqual([frame['text'] for frame in fingerprint['chain']],
                         ['main()', 'assert not item645_unrestored, "Item 645 comparison runtime was not restored"'])
        self.assertEqual(fingerprint['values'], MESSAGE)

    def test_fixture_exit_the_controls_share_is_known_and_one_they_do_not_is_new(self):
        rows = CONTROLLER.cases(self.evidence(1, FIXTURE_TRACEBACK), self.out)
        candidate = self.records(rows, 2)
        self.assertEqual([f['case']['name'] for f in candidate], ['reading one', 'fixture exit 1'])
        self.assertTrue(all('fingerprint' in f for f in candidate), candidate)
        shared = CONTROLLER.compare_failures(candidate, self.records(rows, 1))
        self.assertTrue(shared['passed'], shared)
        self.assertEqual([(f['case']['name'], f['matched_base_runs']) for f in shared['expected']],
                         [('reading one', [1]), ('fixture exit 1', [1])])
        clean_control = self.records(CONTROLLER.cases(self.evidence(0, CONTROLLER.END_LINE + '\n'), self.out), 1)
        new = CONTROLLER.compare_failures(candidate, clean_control)
        self.assertFalse(new['passed'])
        self.assertEqual([(f['case']['name'], f['reason']) for f in new['unexpected']],
                         [('fixture exit 1', 'not shown by recent base runs')])

    def test_fixture_that_died_before_a_case_finished_is_refused(self):
        step = self.evidence(1, FIXTURE_TRACEBACK)
        with (self.out / 'native-reading.log').open('a') as log:
            log.write('{"case":"reading three","started":"t"}\n')
        with self.assertRaises(CONTROLLER.Refused) as refused:
            CONTROLLER.cases(step, self.out)
        self.assertEqual(str(refused.exception), 'native-reading: fixture died before the end')

    def test_fixture_exit_without_its_assertion_is_refused(self):
        step = self.evidence(1, 'Killed\n')
        with self.assertRaises(CONTROLLER.Refused) as refused:
            CONTROLLER.cases(step, self.out)
        self.assertEqual(str(refused.exception), 'native-reading: fixture exit without its assertion')

    def test_signalled_fixture_is_still_refused(self):
        step = self.evidence(1, FIXTURE_TRACEBACK, signal='SIGKILL')
        with self.assertRaises(CONTROLLER.Refused) as refused:
            CONTROLLER.cases(step, self.out)
        self.assertEqual(str(refused.exception), 'native-reading: fixture was signalled')

    def test_clean_fixture_exit_reads_as_before(self):
        self.assertEqual(CONTROLLER.cases(self.evidence(0, CONTROLLER.END_LINE + '\n'), self.out), [RED, GREEN])
        step = self.evidence(0, 'no end line\n')
        with self.assertRaises(CONTROLLER.Refused) as refused:
            CONTROLLER.cases(step, self.out)
        self.assertEqual(str(refused.exception), 'native-reading: harness did not reach end')


if __name__ == '__main__':
    unittest.main()

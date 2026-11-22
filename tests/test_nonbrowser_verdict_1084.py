from __future__ import annotations

import ast
import copy
import hashlib
import json
from pathlib import Path
import unittest

from tests import test_step_controls_1070 as S

C = S.CONTROLLER
REFUSAL = "refused: the copy refused post: ReplayError: message.post was not committed: "
ERROR = {'code': 'DIVERGENCE_REASON_REQUIRED',
         'message': 'Reply in an existing dossier or supply a divergence reason for the new stack: Message 2 (m-' + 'a' * 32 + ')',
         'retryable': False, 'details': {'topic_revision': 1}}


def tap(failures=(), count=41):
    failed = set(failures)
    lines = []
    for n in range(count):
        name = 'retained unit %02d' % n
        lines.extend(('# Subtest: ' + name, '%s %d - %s' % ('not ok' if n in failed else 'ok', n + 1, name)))
    return '\n'.join(lines) + '\n# tests %d\n# pass %d\n# fail %d\n# cancelled 0\n# skipped 0\n# todo 0\n' % (count, count-len(failed), len(failed))


class NonbrowserVerdictCase(unittest.TestCase):
    git = S.StepControlsCase.git
    collect = S.StepControlsCase.collect
    known = S.StepControlsCase.known

    def setUp(self):
        S.StepControlsCase.setUp(self)
        self.required.append('wake-replay')
        self.plan = [{'name': n, 'steps': n} for n in self.required]
        p = self.repo / 'tools/release_check.py'
        p.write_text(p.read_text().replace("REQUIRED = ('python-units','node-units','native-reader')",
                                          "REQUIRED = ('python-units','node-units','native-reader','wake-replay')")
                     + "REPLAY_FILE = 'tests/traffic.json'\n")
        (self.repo / 'tests/traffic.json').write_text('{"routed":["fixture"]}')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'replay catalog')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        self.merge = {'sha': self.sha, 'tree': self.tree,
                      'first_parent': self.git('rev-parse', 'HEAD^').strip(), 'second_parent': None}

    def bundle(self, run_id, failures=(), replay=None, python=None):
        folder, run = S.StepControlsCase.bundle(self, run_id)
        for index, name in enumerate(self.required):
            out = folder / 'shards' / ('check-%d' % index)
            raw = json.loads((out / 'summary.json').read_text())
            step = raw['steps'][0]
            if name == 'node-units':
                log = tap(failures)
                (out / (name + '.log')).write_text(log)
                counts, good = C.node_counts(log)
                step = dict(step, counts=counts, passed=good, exit=0 if good else 1)
            elif name == 'python-units' and python:
                log = 'test_one (fixture.Test) ... %s\nRan 1 test in 0.01s\nFAILED (%s=1)\n' % (python, 'errors' if python == 'ERROR' else 'failures')
                (out / (name + '.log')).write_text(log)
                step = dict(step, counts=C.python_counts(log)[0], passed=False, exit=1)
            elif name == 'wake-replay':
                report = out / 'replay/candidate-1'
                report.mkdir(parents=True)
                counts = {'fixture': {'lost': [], 'wakes': 1, 'delays': [0.01], 'median': 0.01}}
                if replay is None:
                    (report / 'replay.json').write_text(json.dumps({'agents': counts}))
                    log, code, good = 'replay finished\n', 0, True
                else:
                    error = dict(ERROR, **replay)
                    log, code, good = REFUSAL + repr(error) + '\n', 2, False
                    counts = C.replay_counts(report)[0]
                (out / 'wake-replay-candidate-1.log').write_text(log)
                runs = [{'exit': code, 'passed': good, 'counts': counts,
                         'log': '/producer/wake-replay-candidate-1.log', 'started_at': 't1', 'finished_at': 't2'}]
                step = C.replay_step(runs, 't0')
            self.save_step(folder, index, step)
        return folder, run

    def save_step(self, folder, index, step):
        out = folder / 'shards' / ('check-%d' % index)
        raw = json.loads((out / 'summary.json').read_text())
        raw.update(steps=[step], passed=step['passed'], failed=[] if step['passed'] else [step['name']])
        (out / 'summary.json').write_text(json.dumps(raw))
        rp = out / 'run.json'
        receipt = json.loads(rp.read_text())
        receipt['summary_sha256'] = hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()
        rp.write_text(json.dumps(receipt))
        provenance = json.loads((folder / 'release-check/provenance.json').read_text())
        entry = next(x for x in provenance['shards'] if x['artifact'] == out.name)
        entry['receipt'] = receipt
        (folder / 'release-check/provenance.json').write_text(json.dumps(provenance))
        summary = json.loads((folder / 'release-check/summary.json').read_text())
        summary['steps'] = [json.loads((folder / 'shards' / ('check-%d' % i) / 'summary.json').read_text())['steps'][0]
                            for i in range(len(self.required))]
        summary['passed'] = all(s['passed'] for s in summary['steps'])
        summary['failed'] = sorted(s['name'] for s in summary['steps'] if not s['passed'])
        (folder / 'release-check/summary.json').write_text(json.dumps(summary))

    def read(self, pair, history=False):
        folder, run = pair
        return C.read_evidence(folder / 'release-check/summary.json', folder / 'release-check/provenance.json',
                               folder / 'shards', self.repo, self.sha, run, {'ref': None, 'sha': None},
                               self.merge, history=history)

    def compare(self, candidate, controls):
        known, records = self.known(self.collect([p[0] for p in controls]))
        observed, raw = self.read(candidate)
        failed, _ = C.failure_records(observed, self.repo, self.sha, 99)
        return C.compare_failures(failed, known, records), failed, raw

    def node_cases(self, result):
        return [r['case']['name'] for r in result if r['step'] == 'node-units']

    def test_same_forty_failures_are_inherited_and_raw_failure_is_preserved(self):
        result, failed, raw = self.compare(self.bundle(99, range(40)), [self.bundle(i, range(40)) for i in range(1, 4)])
        self.assertTrue(result['passed'], result)
        self.assertEqual(len(self.node_cases(result['expected'])), 40)
        self.assertFalse(raw['passed'])
        self.assertTrue(all(x['matched_base_runs'] == [1, 2, 3] for x in result['expected'] if x['step'] == 'node-units'))

    def test_forty_first_new_failure_is_named(self):
        result, _, _ = self.compare(self.bundle(99, range(41)), [self.bundle(i, range(40)) for i in range(1, 4)])
        self.assertFalse(result['passed'])
        self.assertEqual(self.node_cases(result['unexpected']), ['retained unit 40'])

    def test_one_control_disagreeing_prevents_inheritance(self):
        result, _, _ = self.compare(self.bundle(99, range(40)), [self.bundle(1, range(40)), self.bundle(2, range(39)), self.bundle(3, range(40))])
        self.assertEqual(self.node_cases(result['unexpected']), ['retained unit 39'])

    def test_green_candidate_with_red_controls_passes(self):
        result, _, _ = self.compare(self.bundle(99), [self.bundle(i, range(40)) for i in range(1, 4)])
        self.assertTrue(result['passed'], result)
        self.assertEqual(self.node_cases(result['unexpected']), [])

    def test_matching_terminal_replay_refusal_is_inherited(self):
        error = {'message': ERROR['message'].replace('a' * 32, 'b' * 32)}
        result, _, _ = self.compare(self.bundle(99, replay=error), [self.bundle(i, replay={}) for i in range(1, 4)])
        self.assertTrue(result['passed'], result)
        self.assertEqual(len([r for r in result['expected'] if r['step'] == 'wake-replay']), 1)

    def test_changed_replay_refusal_words_are_new(self):
        result, _, _ = self.compare(self.bundle(99, replay={'message': 'Different refusal'}), [self.bundle(i, replay={}) for i in range(1, 4)])
        self.assertEqual([r['step'] for r in result['unexpected']], ['wake-replay'])

    def test_green_replay_control_prevents_inheritance(self):
        result, _, _ = self.compare(self.bundle(99, replay={}), [self.bundle(1, replay={}), self.bundle(2), self.bundle(3, replay={})])
        self.assertEqual([r['step'] for r in result['unexpected']], ['wake-replay'])

    def test_python_assertion_failure_and_error_have_recorded_identities(self):
        for status in ('FAIL', 'ERROR'):
            with self.subTest(status=status):
                pair = self.bundle(90 if status == 'FAIL' else 91, python=status)
                observed, _ = self.read(pair)
                failed, _ = C.failure_records(observed, self.repo, self.sha, 99)
                self.assertEqual([x['case']['name'] for x in failed if x['step'] == 'python-units'], ['test_one (fixture.Test)'])

    def test_no_eligible_controls_does_not_clear_unit_failure(self):
        observed, _ = self.read(self.bundle(99, [0]))
        failures, _ = C.failure_records(observed, self.repo, self.sha, 99)
        verdict = C.compare_failures(failures, copy.deepcopy(failures), [])
        self.assertEqual(self.node_cases(verdict['unexpected']), ['retained unit 00'])

    def test_missing_unit_outcome_is_refused_on_candidate_and_control(self):
        pair = self.bundle(99, [0])
        p = pair[0] / 'shards/check-1/node-units.log'
        p.write_text(p.read_text().replace('not ok 1 - retained unit 00\n', ''))
        for history in (False, True):
            with self.subTest(history=history), self.assertRaises(C.Refused): self.read(pair, history)

    def test_forged_unit_counts_and_skipped_outcomes_refuse(self):
        for mode in ('counts', 'skip', 'duplicate', 'fatal-tail'):
            with self.subTest(mode=mode):
                pair = self.bundle(80 + ['counts', 'skip', 'duplicate', 'fatal-tail'].index(mode), [0])
                p = pair[0] / 'shards/check-1/node-units.log'
                original = p.read_text()
                changed = {'counts': original.replace('# fail 1', '# fail 0'),
                           'skip': original.replace('not ok 1 - retained unit 00', 'ok 1 - retained unit 00 # SKIP'),
                           'duplicate': original.replace('retained unit 01', 'retained unit 00'),
                           'fatal-tail': original + 'Error: unrelated process crash\n'}[mode]
                p.write_text(changed)
                with self.assertRaises(C.Refused): self.read(pair)

    def test_missing_replay_report_without_a_terminal_refusal_refuses(self):
        pair = self.bundle(99, replay={})
        p = pair[0] / 'shards/check-3/wake-replay-candidate-1.log'
        for text in ('', 'Killed\n', REFUSAL + '{broken\n', REFUSAL + repr(ERROR) + '\nError: fatal tail\n'):
            p.write_text(text)
            with self.subTest(text=text), self.assertRaises(C.Refused): self.read(pair)

    def test_refusal_cannot_hide_a_present_but_unreadable_replay_report(self):
        pair = self.bundle(99, replay={})
        (pair[0] / 'shards/check-3/replay/candidate-1/replay.json').write_text('{broken')
        with self.assertRaises(C.Refused): self.read(pair)

    def test_replay_summary_and_exit_still_bind_the_terminal_record(self):
        pair = self.bundle(99, replay={})
        p = pair[0] / 'shards/check-3/summary.json'
        step = json.loads(p.read_text())['steps'][0]
        step['counts']['pass'] = 1
        self.save_step(pair[0], 3, step)
        with self.assertRaises(C.Refused): self.read(pair)

    def test_source_and_digest_refusal_still_precede_comparison(self):
        pair = self.bundle(99, [0])
        p = pair[0] / 'shards/check-1/summary.json'
        p.write_text(p.read_text() + '\n')
        with self.assertRaisesRegex(C.Refused, 'original summary digest'): self.read(pair)

    def test_duplicate_passing_node_names_do_not_admit_an_ambiguous_failure(self):
        for number, failed in ((101, []), (102, [0])):
            pair = self.bundle(number, failed)
            path = pair[0] / 'shards/check-1/node-units.log'
            path.write_text(path.read_text().replace('retained unit 39', 'retained unit 38'))
            observed, _ = self.read(pair)
            failures, _ = C.failure_records(observed, self.repo, self.sha, number)
            self.assertEqual([f['case']['name'] for f in failures if f['step'] == 'node-units'],
                             ['retained unit 00'] if failed else [])


if __name__ == '__main__':
    unittest.main()

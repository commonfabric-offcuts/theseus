from __future__ import annotations

"""Bounded parser controls; frozen results are data, never new native passes.

SOURCE_READERS_FIXTURES must name the auditor's source-forms-8702 directory.
The extracted AST below executes the unchanged production raw-reader loop only;
missing controller/API facts are deliberately not stubbed into an admission.
"""
import ast
import copy
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

from tools import base_move as b, ci_known_reds as ci, continuation_envelope as ce, release_check as check


SEPARATOR = '\n' + '=' * 70 + '\n'
PINS = {
    45: ('bbdaccaa78029972d13a3d9704d91780cce0f1e73a1a52ab02f39e41ea418da2',
         'e2f3485d308cddc094306f06f7f2cccfc03347632fed83d23fd76e4eee1265e9'),
    46: ('63dc9fa5e9d23607f93fbf582019122469996a0ef3b1151733783845bf693ce7', '833f8242d15375fa25b1085f0ebd6f2b950b1fd654db1000158a05e9a15da08b'),
}


def reader_segment():
    """Compile actual nested readers and execution loop, without copying logic."""
    module = ast.parse(Path(ce.__file__).read_text())
    validate = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'validate')
    scope = next(n for n in validate.body if isinstance(n, ast.With))
    readers = [n for n in scope.body if isinstance(n, ast.FunctionDef) and n.name in ('read_bytes', 'read')]
    loops = [n for n in scope.body if isinstance(n, ast.For) and isinstance(n.target, ast.Tuple)
             and [x.id for x in n.target.elts] == ['step', 'out', 'folder', 'commit', 'origin', 'partitioned']]
    assert len(readers) == 2 and len(loops) == 1, 'unknown production reader structure'
    wrapper = ast.parse('def consume():\n    return reds, positions, raw_steps\n').body[0]
    wrapper.body = readers + loops + wrapper.body
    return compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])), ce.__file__, 'exec')


class PythonHeaders(unittest.TestCase):
    def parse(self, text, expected=None, step=None):
        with tempfile.TemporaryDirectory(prefix='source-headers-') as tmp:
            out = Path(tmp); (out / 'python-units.log').write_bytes(text.encode())
            if expected is None:
                expected = [r for r, _ in ci.unit_records(text.split(SEPARATOR, 1)[0])]
            if step is None:
                counts, passed = check.python_counts(text)
                step = dict(name='python-units', counts=counts, exit=0 if passed else 1, passed=passed)
            return b.unit_results(step, out, expected)

    def log(self, statuses=('FAIL', 'ERROR'), body=None):
        names = ['test_%d (fixture.Tests)' % i for i in range(len(statuses))]
        listing = ''.join('%s ... %s\n' % (n, s) for n, s in zip(names, statuses))
        blocks = ['%s: %s\n%s\n%s\n' % (s, n, '-' * (70 - i), body or 'Traceback (most recent call last):\nAssertionError: exact failure %d' % i)
                  for i, (n, s) in enumerate(zip(names, statuses)) if s != 'ok']
        counts = ', '.join('%s=%d' % (label, statuses.count(status))
                           for label, status in (('failures', 'FAIL'), ('errors', 'ERROR')) if status in statuses)
        return listing + (SEPARATOR + SEPARATOR.join(blocks) + SEPARATOR if blocks else '') + '\nRan %d tests in 0.1s\n\n%s\n' % (len(names), 'FAILED (' + counts + ')' if blocks else 'OK')

    def test_fail_and_error_preserve_distinct_exact_blocks(self):
        text = self.log(); rows = self.parse(text)
        self.assertEqual([x[1]['status'] for x in rows], ['FAIL', 'ERROR'])
        for i, (_, observed) in enumerate(rows):
            start = text.index(observed['status'] + ': test_%d' % i)
            end = text.index(SEPARATOR, start)
            self.assertEqual(observed['failure'].encode(), text[start:end].encode())
        self.assertIn('-' * 69 + '\n', rows[1][1]['failure'])

    def test_duplicate_missing_unknown_malformed_truncated_headers_refuse(self):
        text = self.log(); first = text[text.index('FAIL:'):text.index(SEPARATOR, text.index('FAIL:'))]
        variants = {
            'duplicate': text.replace('\nRan ', SEPARATOR + first + SEPARATOR + '\nRan ', 1),
            'missing': text.replace(first, ''),
            'unknown': text.replace('FAIL: test_0', 'FAIL: test_unknown'),
            'multiline': text.replace('FAIL: test_0', 'FAIL: bad\ntest_0'),
            'malformed-separator': text.replace('-' * 70 + '\n', 'broken\n', 1),
            'truncated-block': text[:text.index('ERROR:')] + '\nRan 2 tests in 0.1s\n\nFAILED (failures=1, errors=1)\n',
            'wrong-status': text.replace('FAIL: test_0', 'ERROR: test_0'),
        }
        for label, value in variants.items():
            with self.subTest(label=label), self.assertRaisesRegex(b.Refused, 'failure blocks differ'):
                self.parse(value)

    def test_traceback_looking_test_strings_are_not_listing_rows(self):
        body = "Traceback (most recent call last):\n+ (0, '')\ntest_fake (fixture.Tests) ... FAIL\nAssertionError: kept\n"
        rows = self.parse(self.log(body=body))
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(body in row[1]['failure'] for row in rows))

    def test_listing_identity_count_and_verdict_guards(self):
        text = self.log(); expected = [ci.identity({'name': 'test_0 (fixture.Tests)'})]
        with self.assertRaisesRegex(b.Refused, 'inventory differs'):
            self.parse(text, expected=expected)
        for label, value in [('count', text.replace('Ran 2 tests', 'Ran 3 tests')),
                             ('duplicate', text.replace('test_1 (fixture.Tests)', 'test_0 (fixture.Tests)'))]:
            with self.subTest(label=label), self.assertRaises(b.Refused):
                self.parse(value)
        counts, passed = check.python_counts(text)
        for label, step in [('exit', dict(name='python-units', counts=counts, passed=passed, exit=0)),
                            ('verdict', dict(name='python-units', counts=counts, passed=True, exit=1)),
                            ('counts', dict(name='python-units', counts=dict(counts, failures=9), passed=passed, exit=1))]:
            with self.subTest(label=label), self.assertRaises(b.Refused):
                self.parse(text, step=step)

    def test_old_green_and_single_failure(self):
        self.assertEqual(self.parse(self.log(('ok', 'ok'))), [])
        self.assertEqual(len(self.parse(self.log(('FAIL',)))), 1)


@unittest.skipUnless(os.environ.get('SOURCE_READERS_FIXTURES'), 'explicit frozen auditor fixture root required')
class FrozenReaders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(os.environ['SOURCE_READERS_FIXTURES'])
        cls.forms = {}; cls.reviews = {}; cls.inventories = {}; cls.audits = {}
        for train, pins in PINS.items():
            folder = cls.root / ('train%d' % train)
            review, form = [b.loads(b.artifact({'path': str(folder / name), 'sha256': pin}))
                            for name, pin in zip(('REVIEW.json', 'source-forms.json'), pins)]
            cls.forms[train] = form; cls.reviews[train] = review
            cls.inventories[train] = b.document(form['inventory']); cls.audits[train] = b.document(form['audit'])
            assert form['files'] == b.document(form['files_index'])
            assert cls.audits[train]['record'] == review['prior_judgment_record']
            assert 'controller' not in form, 'full-envelope facts unexpectedly changed'
        cls.segment = reader_segment()

    def step(self, train, folder, name):
        form = self.forms[train]
        path = folder + '/summary.json'
        raw = b.document(form['files'][path if path in form['files'] else 'release-check/summary.json'])
        return copy.deepcopy(next(s for s in raw['steps'] if s['name'] == name))

    def expected_units(self, train, folder, name):
        expected = self.inventories[train][name]
        if name == 'python-units':
            part = self.step(train, folder, name)['python_shard']
            # Partition by original plan files, independently of observed rows.
            modules = {Path(f).stem for f in part['files']}
            expected = [r for r in expected if r['name'].split(' (', 1)[1].split('.', 1)[0] in modules]
        return expected

    def unit(self, train, folder, name):
        form = self.forms[train]; log = b.artifact(form['files'][folder + '/' + name + '.log'])
        with tempfile.TemporaryDirectory(prefix='frozen-unit-') as tmp:
            out = Path(tmp); (out / (name + '.log')).write_bytes(log)
            return b.unit_results(self.step(train, folder, name), out, self.expected_units(train, folder, name))

    def test_actual45_two_failures_exact_audit_bytes(self):
        self.assert_actual_failures(45)

    def test_actual46_two_failures_exact_audit_bytes(self):
        self.assert_actual_failures(46)

    def assert_actual_failures(self, train):
        try:
            rows = self.unit(train, 'check-7', 'python-units')
        except b.Refused as error:
            self.fail('genuine two-block log must remain readable: ' + str(error))
        expected = [(r['case'], r['observed']) for r in self.audits[train]['reds'] if r['step'] == 'python-units']
        self.assertEqual([(ci.identity(r), o) for r, o in rows], expected)
        self.assertEqual(len(rows), 2)
        self.assertEqual([o['status'] for _, o in rows], ['FAIL', 'FAIL'])

    def test_genuine_old_green_units_and_node_red(self):
        for train in (45, 46):
            with self.subTest(train=train):
                self.assertEqual(self.unit(train, 'check-4', 'python-units'), [])
                self.assertEqual(self.unit(train, 'check-9', 'deploy-refusals'), [])
        rows = self.unit(45, 'check-8', 'node-units')
        expected = [(r['case'], r['observed']) for r in self.audits[45]['reds'] if r['step'] == 'node-units']
        self.assertEqual([(ci.identity(r), o) for r, o in rows], expected)
        self.assertEqual(self.unit(46, 'check-8', 'node-units'), [])

    def consume(self, train, selected=None, edit=None):
        """Actual loop, with byte-bound frozen input; no controller fabrication."""
        source = self.forms[train]; review = self.reviews[train]; inventory = self.inventories[train]
        with tempfile.TemporaryDirectory(prefix='source-reader-segment-') as tmp:
            root = Path(tmp); contents = {}
            # Only named indexed files; no directory traversal or ZIP extraction.
            for name, ref in source['files'].items():
                value = b.artifact(ref); contents[name] = value
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(value)
            executions = []
            for row in review['proof']:
                folder = row['artifact']; name = row['step']
                if selected is not None and name not in selected:
                    continue
                step = self.step(train, folder, name)
                self.assertEqual(step['counts'], row['counts'])
                executions.append((step, root / folder, folder, source['tested_merge']['sha'] if row['origin'] == 'original' else review['source_head'],
                                   row['origin'], 'python_shard' in step))
            if edit:
                edit(contents, root, executions)
            cache = {}
            def input_bytes(commit, path):
                key = (commit, path)
                if key not in cache:
                    cache[key] = subprocess.check_output(['git', '--git-dir=' + str(self.root / ('train%d' % train) / 'git'), 'show', commit + ':' + path])
                return cache[key]
            namespace = dict(vars(ce), source=source, inventory=inventory, contents=contents, root=root,
                             partials=review['partial_shards'], tested=source['tested_merge']['sha'], head=review['source_head'],
                             executions=executions, used=set(), reds=[], positions=[], raw_steps=[], input_bytes=input_bytes)
            exec(self.segment, namespace)
            return namespace['consume']()

    def test_actual45_replay_without_aggregate(self):
        self.assertNotIn('check-10/wake-replay.log', self.forms[45]['files'])
        reds, positions, failed = self.consume(45, {'wake-replay'})
        self.assertEqual(reds, []); self.assertEqual(failed, [])
        self.assertEqual(positions, [dict(step='wake-replay', origin='original', artifact='check-10')])

    def test_original_zip_replay_bytes_and_no_aggregate(self):
        env = b.document(self.forms[45]['continuation'])
        archive = next(r for r in env['original']['archives'] if r['name'] == 'check-10')
        with zipfile.ZipFile(io.BytesIO(b.artifact(archive['archive']))) as zipped:
            self.assertNotIn('wake-replay.log', zipped.namelist())
            candidates = [k for k in self.forms[45]['files'] if k.startswith('check-10/')]
            for name in candidates:
                self.assertEqual(zipped.read(name[len('check-10/'):]), b.artifact(self.forms[45]['files'][name]))
            self.assertEqual(len(self.step(45, 'check-10', 'wake-replay')['runs']), 1)

    def test_original_unit_zip_bytes_both_trains(self):
        for train in (45, 46):
            form = self.forms[train]; run = form['run']
            metadata = b.loads((self.root / ('%d-artifacts.json' % run)).read_bytes())
            meta = next(a for a in metadata['artifacts'] if a['name'] == 'check-7')
            archive = self.root.parent / ('train%d-full-%d' % (train, run)) / 'check-7.zip'
            raw = b.artifact({'path': str(archive), 'sha256': meta['digest'].removeprefix('sha256:')})
            self.assertEqual(meta['workflow_run']['id'], run)
            self.assertEqual(meta['workflow_run']['head_sha'], self.reviews[train]['source_head'])
            with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
                for name in ('python-units.log', 'summary.json', 'run.json'):
                    self.assertEqual(zipped.read(name), b.artifact(form['files']['check-7/' + name]))

    def test_genuine_unit_inventory_count_and_status_damage_refuses(self):
        for train in (45, 46):
            log = b.artifact(self.forms[train]['files']['check-7/python-units.log'])
            expected = self.expected_units(train, 'check-7', 'python-units')
            step = self.step(train, 'check-7', 'python-units')
            with tempfile.TemporaryDirectory(prefix='genuine-unit-negative-') as tmp:
                out = Path(tmp); (out / 'python-units.log').write_bytes(log)
                with self.subTest(train=train, damage='inventory'), self.assertRaisesRegex(b.Refused, 'inventory differs'):
                    b.unit_results(step, out, expected[:-1])
                bad = copy.deepcopy(step); bad['counts']['tests'] += 1
                with self.subTest(train=train, damage='count'), self.assertRaisesRegex(b.Refused, 'log/count mismatch'):
                    b.unit_results(bad, out, expected)
                bad = copy.deepcopy(step); bad.update(exit=0, passed=True)
                with self.subTest(train=train, damage='status'), self.assertRaisesRegex(b.Refused, 'exit/verdict differs'):
                    b.unit_results(bad, out, expected)

    def test_each_required_replay_file_missing_or_rewritten_refuses(self):
        names = ['check-10/replay/candidate-1/replay.json', 'check-10/wake-replay-candidate-1.log']
        for name in names:
            for changed in (False, True):
                def edit(contents, root, executions):
                    if changed:contents[name] += b'changed'
                    else:contents.pop(name)
                with self.subTest(name=name, rewritten=changed), self.assertRaisesRegex(b.Refused, 'missing source artifact|rewritten artifact'):
                    self.consume(45, {'wake-replay'}, edit)

    def test_other_step_generic_log_still_required(self):
        def edit(contents, root, executions):contents.pop('check-4/python-units.log')
        with self.assertRaisesRegex(b.Refused, 'missing source artifact check-4/python-units.log'):
            self.consume(45, {'python-units'}, edit)

    def test_actual52_step_red_reconciliation_both_trains(self):
        for train, red_count, browser_count in ((45, 171, 2483), (46, 200, 2655)):
            with self.subTest(train=train):
                reds, positions, failed = self.consume(train)
                coverage = ce.Counter(p['step'] for p in positions); coverage['python-units'] -= 3
                self.assertEqual(coverage, ce.Counter(check.REQUIRED))
                self.assertEqual(len(reds), red_count)
                self.assertEqual(sum(len(v) for k, v in self.inventories[train].items() if k in ci.NATIVE), browser_count)
                self.assertTrue(failed)
                b.audit_reds(self.forms[train], {'audit': self.reviews[train]['prior_judgment_record']},
                             self.reviews[train]['source_head'], reds)

    def test_replay_actor_count_exit_and_missing_record_guards(self):
        # Synthetic damage to byte-identical copies, calling the existing reader.
        form = self.forms[45]; prefix = 'check-10/'
        with tempfile.TemporaryDirectory(prefix='replay-negative-') as tmp:
            out = Path(tmp)
            record = 'replay/candidate-1/replay.json'; log = 'wake-replay-candidate-1.log'
            original = b.artifact(form['files'][prefix + record]); raw = b.loads(original)
            for name in (record, log):
                path = out / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b.artifact(form['files'][prefix + name]))
            step = self.step(45, 'check-10', 'wake-replay'); traffic = self.inventories[45]['wake-replay']
            self.assertEqual(b.replay_results(step, out, traffic), [])
            variants = {}
            absent = copy.deepcopy(raw); absent['agents'].pop(next(iter(absent['agents'])))
            variants['actor'] = absent
            count = copy.deepcopy(raw); next(iter(count['agents'].values()))['wakes'] += 1
            variants['count'] = count
            for label, value in variants.items():
                (out / record).write_bytes(b.canonical(value))
                with self.subTest(label=label), self.assertRaises(b.Refused):b.replay_results(step, out, traffic)
            (out / record).unlink()
            with self.assertRaisesRegex(b.Refused, 'missing actor results'):b.replay_results(step, out, traffic)
            (out / record).write_bytes(original)
            for label, change in [('exit', {'exit': 9}), ('status', {'passed': False})]:
                bad = copy.deepcopy(step); bad['runs'][0].update(change)
                with self.subTest(label=label), self.assertRaisesRegex(b.Refused, 'abnormal exit'):b.replay_results(bad, out, traffic)
            bad = copy.deepcopy(step); bad['series'][next(iter(bad['series']))]['wakes'] += 1
            with self.assertRaisesRegex(b.Refused, 'raw verdict differs'):b.replay_results(bad, out, traffic)

    def test_synthetic_three_candidates_each_record_and_log_required(self):
        # The genuine ZIP has one run. This constructed three-run control is
        # solely for indexed-candidate handling and is never a source fixture.
        form = self.forms[45]; step = self.step(45, 'check-10', 'wake-replay')
        traffic = self.inventories[45]['wake-replay']
        raw = b.artifact(form['files']['check-10/replay/candidate-1/replay.json'])
        with tempfile.TemporaryDirectory(prefix='synthetic-replay-three-') as tmp:
            out = Path(tmp); runs = []
            for index in (1, 2, 3):
                record = out / 'replay' / ('candidate-%d' % index) / 'replay.json'
                record.parent.mkdir(parents=True, exist_ok=True); record.write_bytes(raw)
                log = out / ('wake-replay-candidate-%d.log' % index); log.write_bytes(b'fixture replay log\n')
                runs.append(dict(step['runs'][0], log=str(log), counts=b.loads(raw)['agents']))
            synthetic = check.replay_step(runs, step['started_at'])
            self.assertEqual(b.replay_results(synthetic, out, traffic), [])
            for index in (1, 2, 3):
                for path in (out / 'replay' / ('candidate-%d' % index) / 'replay.json',
                             out / ('wake-replay-candidate-%d.log' % index)):
                    value = path.read_bytes(); path.unlink()
                    with self.subTest(candidate=index, file=path.name), self.assertRaises(b.Refused):
                        b.replay_results(synthetic, out, traffic)
                    path.write_bytes(value)
            with self.assertRaisesRegex(b.Refused, 'missing actor results'):
                b.replay_results(synthetic, out, {'routed': ['wrong-actor']})


if __name__ == '__main__':
    unittest.main()

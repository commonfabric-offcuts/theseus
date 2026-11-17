from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

from tools import release_check

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/checks.yml'


def script(name):
    section = WORKFLOW.read_text().split('      - name: ' + name + '\n', 1)[1]
    return textwrap.dedent(section.split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])


class UnitJobSummary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.shards = self.root / 'shards'
        self.shards.mkdir()
        self.sha = 'a' * 40
        self.merge = {'sha': self.sha, 'tree': 'b' * 40, 'first_parent': 'c' * 40}

    def shard(self, name, steps, required, partition=None):
        folder = self.shards / ('check-%d' % len(list(self.shards.iterdir())))
        folder.mkdir()
        doc = {'tool': release_check.TOOL, 'commit': self.sha, 'required': required,
               'steps': steps, 'tree_unchanged': True, 'tools': {},
               'started_at': '2026-11-17T00:00:00+00:00', 'finished_at': '2026-11-17T00:01:00+00:00'}
        if partition is not None:
            doc['python_shard'] = partition
        data = json.dumps(doc).encode()
        (folder / 'summary.json').write_bytes(data)
        receipt = {'run': {'id': '99', 'attempt': '1'}, 'merge': self.merge,
                   'shard': {'name': name, 'steps': [s['name'] for s in steps]},
                   'summary_sha256': hashlib.sha256(data).hexdigest()}
        (folder / 'run.json').write_text(json.dumps(receipt))

    def combine(self, plan):
        out = self.root / 'summary.json'
        env = dict(os.environ, GITHUB_RUN_ID='99', GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=self.sha,
                   GITHUB_EVENT_NAME='push', PLAN_SHARDS=json.dumps(plan))
        result = subprocess.run([sys.executable, '-I', '-S', '-c', script("Fold the shards' summaries into one"),
                                 str(self.shards), str(out)], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertTrue(out.exists(), result.stderr)
        return result, json.loads(out.read_text())

    def test_cut_off_units_job_names_all_three_missing_results(self):
        # Shape of 44044963750 / 44045149108: only browser/replay summaries survive;
        # the saved units log passes Python then is cancelled before summary.json.
        units = ['python-units', 'node-units', 'deploy-refusals']
        required = units + ['wake-replay']
        self.shard('wake replay', [{'name': 'wake-replay', 'passed': True}], required)
        result, combined = self.combine([{'name': 'units and deploy refusals', 'steps': ','.join(units)},
                                         {'name': 'wake replay', 'steps': 'wake-replay'}])
        self.assertEqual(combined.get('missing'), sorted(units))
        self.assertEqual(combined.get('missing_jobs'), ['units and deploy refusals'])
        self.assertFalse(combined['passed'])
        self.assertFalse(combined['quarantine']['green'])
        self.assertEqual(result.returncode, 1)

    def test_the_plan_names_missing_steps_even_when_survivors_do_not(self):
        self.shard('wake replay', [{'name': 'wake-replay', 'passed': True}], ['wake-replay'])
        result, combined = self.combine([{'name': 'units', 'steps': 'python-units,node-units,deploy-refusals'},
                                         {'name': 'wake replay', 'steps': 'wake-replay'}])
        self.assertEqual(combined.get('missing'), ['deploy-refusals', 'node-units', 'python-units'])
        self.assertFalse(combined['passed'])
        self.assertEqual(result.returncode, 1)


    def python_plan(self):
        return [{'name': 'python %s' % i, 'steps': 'python-units',
                 'python_shard': '%s/2' % i, 'files': ['tests/test_%s.py' % i]} for i in (1, 2)]

    def python_result(self, i, passed=True, files=None):
        partition = {'index': i, 'total': 2, 'files': files or ['tests/test_%s.py' % i]}
        step = {'name': 'python-units', 'exit': int(not passed), 'passed': passed,
                'counts': {'tests': i, 'status': 'OK' if passed else 'FAILED'},
                'timing': {'wall_seconds': i, 'slowest_tests': [{'test': 'test_%s' % i, 'seconds': i}]}}
        self.shard('python %s' % i, [step], ['python-units'], partition)

    def test_all_python_shards_make_one_step_with_the_whole_count(self):
        self.python_result(1)
        self.python_result(2)
        result, combined = self.combine(self.python_plan())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(combined['passed'])
        self.assertEqual(combined['missing'], [])
        self.assertEqual(combined['missing_jobs'], [])
        self.assertEqual([s['name'] for s in combined['steps']], ['python-units'])
        step = combined['steps'][0]
        self.assertEqual(step['counts']['tests'], 3)
        self.assertEqual(len(step['shards']), 2)
        self.assertEqual([j['name'] for j in combined['jobs']], ['python 1', 'python 2'])

    def test_missing_python_shard_cannot_be_passed_or_quarantined(self):
        self.python_result(1)
        result, combined = self.combine(self.python_plan())
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(combined['missing_jobs'], ['python 2'])
        self.assertEqual(combined['missing'], ['python-units'])
        self.assertFalse(combined['passed'])
        self.assertFalse(combined['quarantine']['green'])
        self.assertFalse(any(s['passed'] for s in combined['steps']))
        # The unchanged release/deploy reader still refuses the missing required step.
        path = self.root / 'combined.json'
        path.write_text(json.dumps(combined))
        reasons = release_check.verify_summary(path, self.sha)
        self.assertIn('the release check did not run python-units', reasons)

    def test_a_failed_python_shard_fails_the_single_step(self):
        self.python_result(1)
        self.python_result(2, passed=False)
        result, combined = self.combine(self.python_plan())
        self.assertEqual(result.returncode, 1)
        self.assertFalse(combined['steps'][0]['passed'])
        self.assertEqual(combined['missing'], [])

    def test_wrong_or_overlapping_file_coverage_is_refused(self):
        self.python_result(1)
        self.python_result(2, files=['tests/test_1.py'])
        result, combined = self.combine(self.python_plan())
        self.assertEqual(result.returncode, 1)
        self.assertFalse(combined['passed'])
        self.assertIn('python-units', combined['missing'])

    def test_no_summaries_still_names_every_missing_job(self):
        result, combined = self.combine(self.python_plan())
        self.assertEqual(result.returncode, 1)
        self.assertEqual(combined['missing_jobs'], ['python 1', 'python 2'])
        self.assertEqual(combined['missing'], ['python-units'])


class PythonReleaseAdapter(unittest.TestCase):
    def test_runner_keeps_each_process_bytecode_prefix(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'repo'
            (root / 'tests').mkdir(parents=True)
            (root / 'tests/test_bytecode.py').write_text(
                'import sys, unittest\nclass Case(unittest.TestCase):\n'
                ' def test_cache(self): self.assertIsNotNone(sys.pycache_prefix)\n')
            out = Path(tmp) / 'out'
            sha = 'a' * 40
            with mock.patch.object(release_check, 'preflight', return_value=sha), \
                    mock.patch.object(release_check, 'tools_of', return_value={}), \
                    mock.patch.object(release_check, 'tree', return_value=(sha, '')):
                summary = release_check.check(root, out, '/chrome', sys.executable, '/node', only=['python-units'])
            self.assertTrue(summary['passed'], (out / 'python-units.log').read_text())
            self.assertTrue(summary['steps'][0]['timing']['slowest_tests'])

    def test_release_summary_keeps_partition_wall_time_and_slowest_tests(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            telemetry = {'unit_shards': 1, 'tests': 2,
                         'python_shard': {'index': 1, 'total': 2, 'files': ['tests/test_a.py']},
                         'timing': {'wall_seconds': 4.5, 'slowest_tests': [{'test': 'test_one', 'seconds': 4.0}]}}
            log = out / 'python-units.log'
            log.write_text('Ran 2 tests in 4.5s\n\nOK\n' + json.dumps(telemetry) + '\n')
            result = {'name': 'python-units', 'passed': True, 'exit': 0,
                      'counts': {'tests': 2, 'status': 'OK'}, 'log': str(log)}
            sha = 'a' * 40
            with mock.patch.object(release_check, 'preflight', return_value=sha), \
                    mock.patch.object(release_check, 'tools_of', return_value={}), \
                    mock.patch.object(release_check, 'tree', return_value=(sha, '')), \
                    mock.patch.object(release_check, 'run_step', return_value=result) as runner:
                summary = release_check.check(ROOT, out, '/chrome', sys.executable, '/node',
                                              only=['python-units'], python_shard='1/2')
                self.assertEqual(summary['python_shard'], telemetry['python_shard'])
                self.assertEqual(summary['steps'][0]['timing'], telemetry['timing'])
                self.assertEqual(runner.call_args[0][1][-2:], ['--shard', '1/2'])
                with self.assertRaises(release_check.Refused):
                    release_check.check(ROOT, out, '/chrome', sys.executable, '/node',
                                        only=['node-units'], python_shard='1/2')


class PythonFileShards(unittest.TestCase):
    def package_run(self, additions, expected_tests, passed=True, invalid_name=False):
        from tools import unit_shards
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            case = ('import unittest\nclass Case(unittest.TestCase):\n'
                    ' def test_one(self): self.assertTrue(True)\n')
            sources = {'tests/test_%s.py' % name: case for name in ('a', 'b', 'c', 'd')}
            sources.update(additions)
            # Neither a non-package subtree nor an invalid module name is discovered.
            sources['tests/ignored/test_ignored.py'] = 'raise AssertionError("not a package")\n'
            if invalid_name:
                sources['tests/test_bad-name.py'] = 'raise AssertionError("not a module name")\n'
            for path, source in sources.items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(source)
            weights = {'units': {'python_minutes': {}, 'python_shards': 4, 'setup_minutes': 1,
                                 'minutes': {'node-units': 1, 'deploy-refusals': 1}}}
            plan = [job for job in unit_shards.jobs(root, weights) if job.get('python_shard')]

            def run(shard=None):
                answer = subprocess.run([sys.executable, '-I', str(ROOT / 'tools/unit_shards.py'),
                                         '--root', str(root)] + (['--shard', shard] if shard else []),
                                        capture_output=True, text=True)
                self.assertIn(answer.returncode, (0, 1), answer.stderr)
                evidence = json.loads(answer.stdout.splitlines()[-1])
                counts, good = release_check.python_counts(answer.stderr)
                step = {'name': 'python-units', 'exit': answer.returncode,
                        'passed': answer.returncode == 0 and good, 'counts': counts}
                return evidence, step

            whole, whole_step = run()
            baseline = subprocess.run([sys.executable, '-I', '-m', 'unittest', 'discover',
                                       '-s', str(root / 'tests'), '-p', 'test_*.py', '-v'],
                                      capture_output=True, text=True)
            self.assertEqual(whole_step['counts'], release_check.python_counts(baseline.stderr)[0])
            self.assertEqual(whole_step['exit'], baseline.returncode)
            self.assertEqual(whole['tests'], expected_tests)
            self.assertEqual(whole_step['passed'], passed)
            docs, receipts, names = [], [], []
            for job in plan:
                evidence, step = run(job['python_shard'])
                docs.append({'steps': [step], 'python_shard': evidence['python_shard']})
                receipts.append({'shard': {'name': job['name']}})
                names += [row['test'] for row in evidence['timing']['slowest_tests']]
            steps, required, jobs, missing_jobs, missing = release_check.combine_unit_results(docs, plan, receipts)
            self.assertEqual(missing, [], (plan, docs))
            self.assertEqual(missing_jobs, [])
            self.assertEqual(required, ['python-units'])
            self.assertEqual(len(steps), 1)
            self.assertEqual(steps[0]['passed'], passed)
            self.assertEqual(steps[0]['counts'], whole_step['counts'])
            self.assertEqual(len(names), len(set(names)))
            self.assertEqual(sorted(names), sorted(row['test'] for row in whole['timing']['slowest_tests']))
            expected_files = sorted(path for path in sources
                                    if path not in ('tests/ignored/test_ignored.py', 'tests/test_bad-name.py'))
            files = [path for job in plan for path in job['files']]
            self.assertEqual(sorted(files), expected_files)
            self.assertEqual(len(files), len(set(files)))

    def test_package_shards_match_discovery_and_combine(self):
        self.package_run({'tests/pkg/__init__.py': '',
                          'tests/pkg/test_nested.py': 'import unittest\nclass Nested(unittest.TestCase):\n'
                                                      ' def test_nested(self): pass\n'}, 5)

    def test_package_initializers_keep_their_discovery_owner(self):
        case = ('import unittest\nclass Initializer(unittest.TestCase):\n'
                ' def test_init(self): pass\n')
        self.package_run({'tests/pkg/__init__.py': case,
                          'tests/pkg/inner/__init__.py': '',
                          'tests/pkg/inner/test_nested.py': case}, 6)

    def test_package_hooks_keep_their_discovery_owner(self):
        # A load_tests hook may return tests with an arbitrary id or module;
        # they still belong to the file whose discovery produced that suite.
        hook = ('import unittest\nclass Hook(unittest.TestCase):\n'
                ' def test_hook(self): pass\n def id(self): return "custom-id"\n'
                'def load_tests(loader, tests, pattern):\n'
                ' return loader.loadTestsFromTestCase(Hook)\n')
        self.package_run({'tests/pkg/__init__.py': hook,
                          'tests/pkg/test_not_loaded.py': 'raise AssertionError("hook owns discovery")\n'}, 5)

    def test_inventory_ignores_invalid_module_names(self):
        self.package_run({}, 4, invalid_name=True)

    def test_discovery_errors_and_skips_keep_their_planned_file(self):
        for path in ('tests/pkg/test_nested.py', 'tests/pkg/__init__.py', 'tests/test_a.py'):
            for source, passed in (('raise ImportError("broken import")\n', False),
                                   ('import unittest\nraise unittest.SkipTest("module skipped")\n', True)):
                with self.subTest(path=path, passed=passed):
                    files = {'tests/pkg/__init__.py': '', path: source}
                    self.package_run(files, 5 if path != 'tests/test_a.py' else 4, passed)

    def test_shards_equal_one_process_and_print_timings_on_pass_and_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'tests').mkdir()
            for name in ('a', 'b', 'c'):
                (root / 'tests' / ('test_%s.py' % name)).write_text(
                    'import unittest\nclass Case(unittest.TestCase):\n'
                    ' def test_one(self): self.assertTrue(True)\n'
                    ' def test_two(self): self.assertTrue(True)\n')
            def run(*extra):
                answer = subprocess.run([sys.executable, '-I', str(ROOT / 'tools/unit_shards.py'),
                                         '--root', str(root)] + list(extra), capture_output=True, text=True)
                self.assertEqual(answer.returncode, 0, answer.stderr)
                timing = json.loads(answer.stdout.splitlines()[-1])
                self.assertGreater(timing['timing']['wall_seconds'], 0)
                self.assertTrue(timing['timing']['slowest_tests'])
                self.assertIn('Slowest 25 tests', answer.stderr)
                return timing
            whole = run()
            parts = [run('--shard', '%s/2' % i) for i in (1, 2)]
            self.assertEqual(sum(p['tests'] for p in parts), whole['tests'])
            self.assertEqual(whole['tests'], 6)
            names = [t['test'] for p in parts for t in p['timing']['slowest_tests']]
            self.assertEqual(len(names), len(set(names)))
            self.assertEqual(sorted(names), sorted(t['test'] for t in whole['timing']['slowest_tests']))
            (root / 'tests/test_a.py').write_text('import unittest\nclass Case(unittest.TestCase):\n def test_bad(self): self.fail("red")\n')
            bad = subprocess.run([sys.executable, '-I', str(ROOT / 'tools/unit_shards.py'), '--root', str(root)],
                                 capture_output=True, text=True)
            self.assertEqual(bad.returncode, 1)
            self.assertIn('Slowest 25 tests', bad.stderr)
            self.assertTrue(json.loads(bad.stdout.splitlines()[-1])['timing']['slowest_tests'])

    def test_measured_plan_deals_new_files_and_sets_independent_limits(self):
        from tools import unit_shards
        weights = json.loads((ROOT / '.github/check-weights.json').read_text())
        planned = unit_shards.jobs(ROOT, weights)
        python = [job for job in planned if job.get('python_shard')]
        expected = unit_shards.test_files(ROOT)
        files = [f for job in python for f in job['files']]
        self.assertEqual(sorted(files), expected)
        self.assertEqual(len(files), len(set(files)))
        self.assertTrue(all(job['files'] for job in python))
        self.assertEqual([j['steps'] for j in planned if not j.get('python_shard')], ['node-units', 'deploy-refusals'])
        import math
        config = weights['units']
        measured = config['python_minutes']
        fallback = sorted(measured.values())[len(measured) // 2]
        for job in planned:
            minutes = (sum(measured.get(f, fallback) for f in job['files']) if job.get('python_shard')
                       else config['minutes'][job['steps']])
            self.assertEqual(job['timeout'], math.ceil((minutes + config['setup_minutes']) * 1.5))
            if job.get('python_shard'):
                self.assertLess(minutes, 20)
        bins = unit_shards.deal(['a', 'b', 'c', 'new'], {'a': 10, 'b': 8, 'c': 2}, 2)
        self.assertEqual(sorted(f for b in bins for f in b['files']), ['a', 'b', 'c', 'new'])
        self.assertEqual(unit_shards.deal(['new', 'c', 'b', 'a'], {'a': 10, 'b': 8, 'c': 2}, 2), bins)

    def test_invalid_shards_refuse_before_running(self):
        for shard in ('0/2', '3/2', '1/0', 'x', '1/1/1'):
            answer = subprocess.run([sys.executable, '-I', str(ROOT / 'tools/unit_shards.py'), '--shard', shard],
                                    capture_output=True, text=True)
            self.assertEqual(answer.returncode, 2)
            self.assertIn('refused:', answer.stderr)
            self.assertNotIn('Ran ', answer.stderr)


if __name__ == '__main__':
    unittest.main()

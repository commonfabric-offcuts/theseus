from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from tests import test_verdict_history as H

C = H.CONTROLLER


class PartitionEvidenceCase(unittest.TestCase):
    git = H.VerdictHistoryCase.git

    def setUp(self):
        H.VerdictHistoryCase.setUp(self)
        for index in range(1, 5):
            (self.repo / ('tests/test_part%d.py' % index)).write_text(
                'from __future__ import annotations\nimport unittest\n'
                'class Part(unittest.TestCase):\n    def test_part%d(self):\n        self.assertTrue(True)\n' % index)
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'four source files')
        self.sha = self.git('rev-parse', 'HEAD').strip()

    def bundle(self, failed=None, empty=None, python_jobs=None, whole_python=False):
        folder = self.root / ('bundle-%d' % len(list(self.root.glob('bundle-*'))))
        shards = folder / 'shards'
        jobs = python_jobs if python_jobs is not None else [
            {'name': 'python units %d of 4' % i, 'steps': 'python-units',
             'python_shard': '%d/4' % i, 'files': ['tests/test_part%d.py' % i]} for i in range(1, 5)]
        self.plan = [{'name': 'ordinary', 'steps': 'node-units,native-reader'}] + copy.deepcopy(jobs)
        if whole_python:
            self.plan.append({'name': 'whole Python', 'steps': 'python-units'})
        self.run = {'id': 7, 'attempt': 1, 'workflow': 'Checks', 'event': 'push', 'repository': 'org/repo'}
        self.base = {'ref': None, 'sha': None}
        self.merge = {'sha': self.sha, 'tree': self.git('rev-parse', 'HEAD^{tree}').strip(),
                      'first_parent': self.git('rev-parse', 'HEAD^').strip(), 'second_parent': None}
        profile = {name: 'fixture' for name in C.PROFILE_FIELDS}
        tools = {'release_check': C.blob(C.source(self.repo, self.sha, 'tools/release_check.py')),
                 'harnesses': {'tests/reader.mjs': C.blob(C.source(self.repo, self.sha, 'tests/reader.mjs'))},
                 **{name: profile[name] for name in ('python', 'node', 'chrome')}}
        self.summary = {'tool': C.TOOL, 'commit': self.sha, 'required': self.required, 'tree_unchanged': True,
                        'tree_after': {'head': self.sha, 'changes': ''}, 'tools': tools, 'checkout': '/fixture',
                        'combined_from': ['check-%d/summary.json' % i for i in range(len(self.plan))]}
        self.provenance = {'run': dict(self.run, workflow_sha=self.sha,
                           workflow_ref='org/repo/.github/workflows/checks.yml@refs/heads/release/live73'),
                           'base': self.base, 'head': {'ref': 'refs/heads/release/live73', 'sha': self.sha},
                           'merge': self.merge, 'checked': {'commit': self.sha, 'tree_unchanged': True},
                           'required': self.required, 'plan': copy.deepcopy(self.plan), 'shards': []}
        self.raw = []
        parts = []
        ordinary = None
        for index, job in enumerate(self.plan):
            out = shards / ('check-%d' % index)
            out.mkdir(parents=True)
            if index == 0:
                native = out / 'native/reader'
                native.mkdir(parents=True)
                (native / 'native.json').write_text(json.dumps({'results': [{'name': 'fixture case', 'passed': True}],
                    'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None}))
                (out / 'native-reader.log').write_text('fixture case passed\n')
                log = '# Subtest: node\nok 1 - node\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                (out / 'node-units.log').write_text(log)
                ordinary = [{'name': 'node-units', 'exit': 0, 'passed': True, 'counts': C.node_counts(log)[0]},
                            {'name': 'native-reader', 'exit': 0, 'passed': True,
                             'counts': {'tests': 1, 'pass': 1, 'fail': 0, 'failed': [], 'browser_closed': True}}]
                steps = ordinary
            else:
                status = 'FAIL' if index == failed else 'ok'
                partitioned = 'python_shard' in job
                case_numbers = [i for i in range(1, 5) if not partitioned or
                                'tests/test_part%d.py' % i in job['files']]
                log = '' if index == empty else ''.join(
                    'test_part%d (part%d.Part) ... %s\n' % (i, i, status) for i in case_numbers)
                log += '\nRan %d tests in 0.01s\n\n%s\n' % (
                    0 if index == empty else len(case_numbers), 'FAILED (failures=1)' if index == failed else 'OK')
                (out / 'python-units.log').write_text(log)
                step = {'name': 'python-units', 'tool': 'unittest', 'exit': 1 if index == failed else 0,
                        'passed': index != failed, 'counts': C.python_counts(log)[0]}
                if partitioned:
                    number, total = map(int, job['python_shard'].split('/'))
                    metadata = {'index': number, 'total': total, 'files': job['files']}
                    step['python_shard'] = metadata
                    parts.append(dict(step, partition=metadata))
                steps = [step]
            raw = dict(self.summary, steps=steps, only=job['steps'].split(','), passed=all(s['passed'] for s in steps))
            if index and partitioned:
                raw['python_shard'] = metadata
            self.raw.append(raw)
            self.provenance['shards'].append({'artifact': 'check-%d' % index, 'commit': self.sha,
                'tree_unchanged': True, 'tools': tools, 'steps': raw['only'],
                'receipt': {'run': self.provenance['run'], 'base': self.base, 'head': self.provenance['head'],
                    'merge': self.merge, 'profile': profile, 'shard': {'steps': raw['only'], 'name': job['name']}}})
        counts = {'tests': sum(p['counts']['tests'] for p in parts), 'status': 'FAILED' if failed else 'OK'}
        if failed:
            counts['failures'] = 1
        self.summary.update(steps=ordinary + [{'name': 'python-units', 'tool': 'unittest', 'counts': counts,
            'exit': 1 if failed else 0, 'passed': failed is None, 'shards': parts}],
            passed=failed is None, failed=['python-units'] if failed else [])
        self.folder = folder
        self.save()
        return folder

    def save(self):
        self.provenance['plan'] = copy.deepcopy(self.plan)
        for index, raw in enumerate(self.raw):
            out = self.folder / 'shards' / ('check-%d' % index)
            (out / 'summary.json').write_text(json.dumps(raw))
            if index >= len(self.provenance['shards']):
                continue
            receipt = self.provenance['shards'][index]['receipt']
            receipt['summary_sha256'] = hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()
            (out / 'run.json').write_text(json.dumps(receipt))
        (self.folder / 'summary.json').write_text(json.dumps(self.summary))
        (self.folder / 'provenance.json').write_text(json.dumps(self.provenance))

    def read(self, history=False):
        return C.read_evidence(self.folder/'summary.json', self.folder/'provenance.json', self.folder/'shards',
                               self.repo, self.sha, self.run, self.base, self.merge, history=history)

    def select(self):
        api = {'id': 7, 'head_sha': self.sha}
        return C.history_missing_steps(self.folder/'summary.json', self.folder/'provenance.json',
                                       self.repo, api, 'release/live73', 'org/repo')

    def test_four_parts_admit_and_preserve_the_combined_receipt(self):
        self.bundle()
        for history in (False, True):
            with self.subTest(history=history):
                observed, summary = self.read(history)
                self.assertEqual(summary['steps'][-1]['counts'], {'tests': 4, 'status': 'OK'})
                self.assertEqual(len(summary['steps'][-1]['shards']), 4)
                self.assertEqual(len(observed), 1)

    def test_history_selector_recognizes_a_complete_partition_plan(self):
        self.bundle()
        self.assertEqual(self.select(), [])

    def test_three_of_four_plan_refuses_current_and_history(self):
        jobs = [{'name': 'python units %d of 4' % i, 'steps': 'python-units',
                 'python_shard': '%d/4' % i, 'files': ['tests/test_part%d.py' % i]} for i in range(1, 4)]
        # All source files are assigned; only the fourth partition is absent.
        jobs[-1]['files'].append('tests/test_part4.py')
        self.bundle(python_jobs=jobs)
        self.assertIsNot(self.plan, self.provenance['plan'])
        self.assertEqual(len(self.plan), len(self.provenance['shards']))
        self.assertEqual(len(self.plan), len(list((self.folder/'shards').iterdir())))
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(C.Refused, '^missing or duplicate Python partition$'):
                self.read(history)
        with self.assertRaisesRegex(C.Refused, '^missing or duplicate Python partition$'): self.select()

    def test_duplicated_whole_step_still_refuses(self):
        self.bundle()
        self.plan.append({'steps': 'node-units'})
        self.save()
        with self.assertRaises(C.Refused): self.read()
        with self.assertRaises(C.Refused): self.select()

    def test_unknown_and_duplicate_parts_refuse(self):
        for value in ('5/4', '0/4', '2/4', '1/3', '01/4', '1/0'):
            with self.subTest(part=value):
                self.bundle()
                self.plan[1]['python_shard'] = value
                self.save()
                with self.assertRaises(C.Refused): self.read()
                with self.assertRaises(C.Refused): self.select()

    def test_whole_python_and_partition_cannot_mix(self):
        self.bundle(whole_python=True)
        self.assertIsNot(self.plan, self.provenance['plan'])
        self.assertEqual(len(self.plan), len(self.provenance['shards']))
        self.assertEqual(len(self.plan), len(list((self.folder/'shards').iterdir())))
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(C.Refused, '^incomplete or duplicated shard plan$'):
                self.read(history)
        with self.assertRaisesRegex(C.Refused, '^incomplete or duplicated shard plan$'): self.select()

    def test_complete_indices_cannot_hide_an_omitted_source_file(self):
        self.bundle()
        self.plan.pop()
        self.provenance['shards'].pop()
        self.summary['combined_from'].pop()
        for index, job in enumerate(self.plan[1:], 1): job['python_shard'] = '%d/3' % index
        self.save()
        with self.assertRaises(C.Refused): self.select()

    def test_duplicate_or_unknown_source_files_refuse(self):
        for files in (['tests/test_part1.py'], ['tests/not-a-source.py'], ['../outside.py']):
            with self.subTest(files=files):
                self.bundle()
                self.plan[2]['files'] = files
                self.save()
                with self.assertRaises(C.Refused): self.select()

    def test_cancelled_partition_and_missing_artifact_refuse(self):
        self.bundle()
        self.provenance['cancelled_shards'] = [{'shard': self.plan[-1]['name']}]
        self.provenance['shards'].pop()
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_cancellation_cannot_be_hidden_behind_complete_green_summaries(self):
        self.bundle()
        self.provenance['cancelled_shards'] = [{'shard': self.plan[-1]['name']}]
        self.save()
        for history in (False, True):
            with self.subTest(history=history), self.assertRaises(C.Refused): self.read(history)

    def test_boolean_index_is_not_integer_partition_evidence(self):
        self.bundle()
        self.raw[1]['python_shard']['index'] = True
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_part_artifact_order_does_not_reorder_the_original_aggregate(self):
        self.bundle()
        self.provenance['shards'].reverse()
        (self.folder/'provenance.json').write_text(json.dumps(self.provenance))
        _, summary = self.read()
        self.assertEqual([p['partition']['index'] for p in summary['steps'][-1]['shards']], [1, 2, 3, 4])

    def test_a_forged_aggregate_count_refuses_after_part_logs(self):
        self.bundle()
        self.summary['steps'][-1]['counts']['tests'] = 99
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_a_forged_aggregate_part_body_refuses(self):
        self.bundle()
        self.summary['steps'][-1]['shards'][0]['exit'] = 7
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_wrong_part_metadata_refuses_even_with_a_fresh_digest(self):
        self.bundle()
        self.raw[2]['python_shard']['index'] = 1
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_changed_summary_digest_refuses(self):
        self.bundle()
        path = self.folder/'shards/check-2/summary.json'
        path.write_text(path.read_text()+' ')
        with self.assertRaises(C.Refused): self.read()

    def test_green_claim_cannot_hide_a_failed_part_log(self):
        self.bundle()
        path = self.folder/'shards/check-2/python-units.log'
        path.write_text(path.read_text().replace('... ok', '... FAIL'))
        with self.assertRaises(C.Refused): self.read()

    def test_empty_legacy_whole_step_still_refuses(self):
        self.bundle()
        out = self.folder/'legacy'
        out.mkdir()
        (out/'python-units.log').write_text('\nRan 0 tests in 0.01s\n\nOK\n')
        with self.assertRaises(C.Refused):
            C.unit_evidence({'name': 'python-units', 'counts': {'tests': 0, 'status': 'OK'}}, out)

    def test_zero_test_part_union_is_not_a_completed_python_step(self):
        self.bundle()
        for index, raw in enumerate(self.raw[1:], 1):
            (self.folder/('shards/check-%d/python-units.log' % index)).write_text('\nRan 0 tests in 0.01s\n\nOK\n')
            raw['steps'][0]['counts']['tests'] = 0
        self.summary['steps'][-1]['counts']['tests'] = 0
        self.summary['steps'][-1]['passed'] = False
        self.summary.update(passed=False, failed=['python-units'])
        self.save()
        with self.assertRaisesRegex(C.Refused, 'empty Python aggregate'): self.read()

    def test_missing_final_failure_union_refuses_history(self):
        self.bundle(failed=2)
        self.summary['failed'] = []
        self.save()
        with self.assertRaisesRegex(C.Refused, 'combined failure union differs'): self.read(history=True)

    def test_candidate_failure_refuses_but_complete_history_keeps_raw_failure(self):
        self.bundle(failed=2)
        with self.assertRaisesRegex(C.Refused, 'non-browser failure cannot be excepted'): self.read()
        _, summary = self.read(history=True)
        self.assertFalse(summary['passed'])
        self.assertEqual(summary['failed'], ['python-units'])
        self.assertEqual(summary['steps'][-1]['counts'], {'tests': 4, 'status': 'FAILED', 'failures': 1})

    def test_empty_validated_partition_keeps_positive_whole_coverage(self):
        self.bundle(empty=2)
        for history in (False, True):
            with self.subTest(history=history):
                _, summary = self.read(history)
                self.assertEqual(summary['steps'][-1]['counts']['tests'], 3)

    def test_no_tests_ran_is_not_a_supported_passing_empty_part(self):
        self.bundle(empty=2)
        path = self.folder/'shards/check-2/python-units.log'
        path.write_text('\nRan 0 tests in 0.01s\n\nNO TESTS RAN\n')
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(C.Refused, '^non-browser log/count mismatch$'):
                self.read(history)

    def test_empty_part_missing_its_ran_line_refuses(self):
        self.bundle(empty=2)
        (self.folder/'shards/check-2/python-units.log').write_text('OK\n')
        for history in (False, True):
            with self.subTest(history=history), self.assertRaisesRegex(C.Refused, '^non-browser log/count mismatch$'):
                self.read(history)

    def test_wrong_job_assignment_refuses(self):
        self.bundle()
        self.provenance['shards'][2]['receipt']['shard']['name'] = self.plan[1]['name']
        self.save()
        with self.assertRaises(C.Refused): self.read()

    def test_duplicate_test_identity_across_parts_refuses(self):
        self.bundle()
        path = self.folder/'shards/check-2/python-units.log'
        path.write_text(path.read_text().replace('test_part2 (part2.Part)', 'test_part1 (part1.Part)'))
        with self.assertRaises(C.Refused): self.read()

    def test_complete_part_plan_coexists_with_fresh_compose_groups(self):
        self.bundle()
        groups = [{'id': 'compose-unique', 'source': {'head': self.sha}}]
        plan = copy.deepcopy(self.plan)
        plan[0]['steps'] = 'node-units,native-reader'
        plan.append({'name': 'compose-unique', 'steps': 'native-compose', 'compose_group': groups[0]})
        C.f779_plan(plan, self.required+['native-compose'], groups)

    def add_inventory_names(self, names):
        self.git('config', 'core.quotePath', 'true')
        for name in names:
            path = self.repo/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('from __future__ import annotations\n')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'source-name inventory')
        self.sha = self.git('rev-parse', 'HEAD').strip()

    def test_complete_unicode_source_plan_admits_current_and_history(self):
        name = 'tests/test_é.py'
        self.add_inventory_names([name])
        self.bundle()
        self.plan[1]['files'].append(name)
        self.save()
        for history in (False, True):
            with self.subTest(history=history):
                _, summary = self.read(history)
                self.assertEqual(summary['steps'][-1]['counts']['tests'], 4)
        self.assertEqual(self.select(), [])

    def test_omitting_a_valid_unicode_source_refuses_current_and_history(self):
        self.add_inventory_names(['tests/test_é.py'])
        self.bundle()
        for history in (False, True):
            with self.subTest(history=history), self.assertRaises(C.Refused):
                self.read(history)
        with self.assertRaises(C.Refused): self.select()

    def test_uppercase_suffix_is_excluded_by_the_producer_glob(self):
        self.add_inventory_names(['tests/test_ignored.PY'])
        self.bundle()
        self.read()
        self.assertNotIn('tests/test_ignored.PY', C.python_source_files(self.repo, self.sha))
        self.assertEqual(self.select(), [])

    def test_inventory_keeps_package_rules_and_nul_path_boundaries(self):
        self.add_inventory_names([
            'tests/café/__init__.py', 'tests/café/test_é.py', 'tests/café/test_Upper.py',
            'tests/no_package/test_ignored.py', 'tests/test_not-module.py',
            'tests/test_upper.PY', 'tests/Test_prefixed.py',
            'tests/line\npackage/__init__.py', 'tests/line\npackage/test_child.py'])
        expected = {'tests/test_part%d.py' % i for i in range(1, 5)} | {
            'tests/café/__init__.py', 'tests/café/test_é.py', 'tests/café/test_Upper.py',
            'tests/line\npackage/__init__.py', 'tests/line\npackage/test_child.py'}
        self.assertEqual(C.python_source_files(self.repo, self.sha), expected)


if __name__ == '__main__':
    unittest.main()

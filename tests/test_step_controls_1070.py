from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('step_controls_controller', ROOT / 'tools/ci_known_reds.py')
CONTROLLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROLLER)


class StepControlsCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / 'source'
        (self.repo / 'tools').mkdir(parents=True)
        (self.repo / 'tests').mkdir()
        (self.repo / '.github/workflows').mkdir(parents=True)
        (self.repo / 'tools/release_check.py').write_text(
            "NATIVE_STEPS = (NativeStep('reader','tests/reader.mjs',(),'native.json'),)\n"
            "REQUIRED = ('python-units','node-units','native-reader')\n")
        (self.repo / 'tests/reader.mjs').write_text('assert.equal(1, 2)\n')
        (self.repo / '.github/workflows/checks.yml').write_text('isolated fixture producer\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'catalog')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        self.required = ['python-units', 'node-units', 'native-reader']
        self.plan = [{'name': name, 'steps': name} for name in self.required]
        self.merge = {'sha': self.sha, 'tree': self.tree, 'first_parent': None, 'second_parent': None}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def bundle(self, run_id, cancelled=()):
        folder = self.root / ('raw-%d' % run_id)
        shards = folder / 'shards'
        shards.mkdir(parents=True)
        run = {'id': run_id, 'attempt': 1, 'workflow': 'Checks', 'event': 'push', 'repository': 'org/repo'}
        source_run = dict(run, workflow_sha=self.sha,
                          workflow_ref='org/repo/.github/workflows/checks.yml@refs/heads/release/live73')
        base = {'ref': None, 'sha': None}
        head = {'ref': 'refs/heads/release/live73', 'sha': self.sha}
        profile = {name: 'fixture' for name in CONTROLLER.PROFILE_FIELDS}
        tools = {'release_check': CONTROLLER.blob((self.repo / 'tools/release_check.py').read_bytes()),
                 'harnesses': {'tests/reader.mjs': CONTROLLER.blob((self.repo / 'tests/reader.mjs').read_bytes())},
                 **{name: profile[name] for name in ('python', 'node', 'chrome')}}
        steps, entries = [], []
        for index, name in enumerate(self.required):
            if name in cancelled:
                continue
            out = shards / ('check-%d' % index)
            out.mkdir()
            if name == 'native-reader':
                native = out / 'native/reader'
                native.mkdir(parents=True)
                report = {'results': [{'name': 'known case', 'passed': False,
                                      'error': 'AssertionError: stable failure\n at /fixture/tests/reader.mjs:1:1'}],
                          'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None}
                (native / 'native.json').write_text(json.dumps(report))
                log = CONTROLLER.END_LINE + '\n'
                counts, good = CONTROLLER.native_counts(
                    CONTROLLER.NativeStep('reader', 'tests/reader.mjs', (), 'native.json'), native)
            elif name == 'python-units':
                log = 'test_one (fixture.Test) ... ok\nRan 1 test in 0.01s\nOK\n'
                counts, good = CONTROLLER.python_counts(log)
            else:
                log = '# Subtest: one\nok 1 - one\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                counts, good = CONTROLLER.node_counts(log)
            (out / (name + '.log')).write_text(log)
            step = {'name': name, 'passed': good, 'exit': 0 if good else 1, 'counts': counts}
            raw = {'tool': CONTROLLER.TOOL, 'commit': self.sha, 'required': self.required,
                   'tree_unchanged': True, 'tree_after': {'head': self.sha, 'changes': ''},
                   'passed': good, 'failed': [] if good else [name], 'only': [name],
                   'steps': [step], 'tools': tools, 'checkout': '/fixture'}
            (out / 'summary.json').write_text(json.dumps(raw))
            receipt = {'run': source_run, 'base': base, 'head': head, 'merge': self.merge,
                       'profile': profile, 'shard': {'name': name, 'steps': name},
                       'summary_sha256': hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()}
            (out / 'run.json').write_text(json.dumps(receipt))
            entries.append({'artifact': out.name, 'commit': self.sha, 'tree_unchanged': True,
                            'tools': tools, 'steps': [name], 'receipt': receipt})
            steps.append(step)
        cancelled_rows = [{'shard': name, 'job': run_id * 10 + self.required.index(name),
                           'cancelled_at': '2026-11-22T05:59:00Z', 'completed_steps': [],
                           'uncompleted_steps': [name]} for name in cancelled]
        summary = {'tool': CONTROLLER.TOOL, 'commit': self.sha, 'required': self.required,
                   'tree_unchanged': not bool(cancelled), 'tree_after': {'head': self.sha, 'changes': ''},
                   'passed': False, 'failed': sorted([s['name'] for s in steps if not s['passed']] + list(cancelled)),
                   'missing': list(cancelled), 'cancelled_shards': cancelled_rows,
                   'steps': steps, 'combined_from': [entry['artifact'] + '/summary.json' for entry in entries]}
        provenance = {'run': source_run, 'base': base, 'head': head, 'merge': self.merge,
                      'checked': {'commit': self.sha, 'tree_unchanged': not bool(cancelled)},
                      'required': self.required, 'plan': self.plan, 'shards': entries,
                      'cancelled_shards': cancelled_rows}
        combined = folder / 'release-check'
        combined.mkdir()
        (combined / 'summary.json').write_text(json.dumps(summary))
        (combined / 'provenance.json').write_text(json.dumps(provenance))
        return folder, run

    def collect(self, folders, omit_combined=()):
        history = self.root / 'history'
        producer = self.root / 'producer.json'
        producer.write_text(json.dumps({'producer': {'created_at': '2026-11-22T06:00:00Z', 'run_id': '99'},
                                       'merge': self.merge}))
        refusals = self.root / 'refusals'
        refusals.write_text('')
        runs, artifacts, archives = [], {}, {}
        for run_id, folder in enumerate(folders, 1):
            runs.append({'id': run_id, 'run_attempt': 1, 'head_sha': self.sha, 'head_branch': 'release/live73',
                         'event': 'push', 'status': 'completed', 'conclusion': 'cancelled' if run_id in omit_combined else 'failure', 'workflow_id': 123,
                         'path': '.github/workflows/checks.yml', 'head_repository': {'full_name': 'org/repo'},
                         'created_at': '2026-11-22T05:%02d:00Z' % (59 - run_id), 'html_url': 'run/%d' % run_id})
            artifacts[run_id] = []
            for index, directory in enumerate([folder / 'release-check', *sorted((folder / 'shards').iterdir())], 1):
                if directory.name == 'release-check' and run_id in omit_combined:
                    continue
                data = io.BytesIO()
                with zipfile.ZipFile(data, 'w') as zipped:
                    for path in sorted(directory.rglob('*')):
                        if path.is_file():
                            zipped.writestr(str(path.relative_to(directory)), path.read_bytes())
                artifact_id = run_id * 100 + index
                archives[artifact_id] = data.getvalue()
                artifacts[run_id].append({'id': artifact_id, 'name': directory.name, 'expired': False,
                                          'size_in_bytes': len(data.getvalue()),
                                          'digest': 'sha256:' + hashlib.sha256(data.getvalue()).hexdigest()})
        original_run = subprocess.run

        def api_run(command, **kwargs):
            if command[:2] != ['gh', 'api']:
                return original_run(command, **kwargs)
            endpoint = command[2]
            if '/git/ref/' in endpoint:
                value = {'object': {'sha': self.sha}}
            elif '/workflows/' in endpoint:
                value = {'total_count': len(runs), 'workflow_runs': runs}
            elif endpoint.endswith('/zip'):
                return subprocess.CompletedProcess(command, 0, archives[int(endpoint.split('/')[-2])], b'')
            else:
                listed = artifacts[int(endpoint.split('/runs/')[1].split('/')[0])]
                value = {'total_count': len(listed), 'artifacts': listed}
            return subprocess.CompletedProcess(command, 0, json.dumps(value).encode(), b'')

        section = (ROOT / '.github/workflows/verdict.yml').read_text().split(
            "      - name: The base's last three runs, by GitHub's record\n", 1)[1]
        script = textwrap.dedent(section.split("<<'PY' >> \"$GITHUB_OUTPUT\"\n", 1)[1].split('          PY\n', 1)[0])
        argv = ['selector', str(history), str(producer), str(refusals), str(self.repo), str(ROOT / 'tools/ci_known_reds.py')]
        env = dict(os.environ, GITHUB_REPOSITORY='org/repo', BASE_REF='release/live73',
                   PRODUCER_WORKFLOW_ID='123', PRODUCER_WORKFLOW_PATH='.github/workflows/checks.yml')
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, env), patch.object(subprocess, 'run', api_run), redirect_stdout(io.StringIO()):
            try:
                exec(compile(script, '<protected history selector>', 'exec'), {})
            except SystemExit as error:
                self.assertEqual(error.code, 0)
        self.assertEqual(refusals.read_text(), '')
        return history / 'known-runs.json'

    def test_cancelled_newest_shard_uses_three_whole_controls_per_step(self):
        folders = [self.bundle(i, ('python-units',) if i == 1 else ())[0] for i in range(1, 5)]
        manifest_path = self.collect(folders)
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest['step_runs'], {'python-units': [2, 3, 4],
                                               'node-units': [1, 2, 3], 'native-reader': [1, 2, 3]})
        known, records = CONTROLLER.known_base_failures(
            manifest_path, self.repo, {'ref': 'release/live73', 'sha': self.sha},
            {'created_at': '2026-11-22T06:00:00Z', 'head_repository': 'org/repo'})
        self.assertEqual([row['run_id'] for row in known], [1, 2, 3, 4])
        self.assertEqual(manifest['browser_window_runs'], {'native-reader': [1, 2, 3, 4]})
        self.assertEqual(records[0]['steps'], ['native-reader', 'node-units'])
        self.assertEqual(records[-1]['control_steps'], ['python-units'])
        self.assertEqual(records[-1]['browser_window_steps'], ['native-reader'])
        self.assertEqual(records[-1]['steps'], ['native-reader', 'python-units'])
        self.assertTrue(CONTROLLER.compare_failures([known[0]], known)['passed'])
        print(json.dumps({'step_runs': manifest['step_runs'], 'native_failure_controls': [r['run_id'] for r in known]}))

    def test_candidate_with_the_same_cancelled_bundle_still_refuses(self):
        folder, run = self.bundle(1, ('python-units',))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'cancelled shard'):
            CONTROLLER.read_evidence(folder / 'release-check/summary.json', folder / 'release-check/provenance.json',
                                     folder / 'shards', self.repo, self.sha, run,
                                     {'ref': None, 'sha': None}, self.merge)

    def known(self, path):
        return CONTROLLER.known_base_failures(
            path, self.repo, {'ref': 'release/live73', 'sha': self.sha},
            {'created_at': '2026-11-22T06:00:00Z', 'head_repository': 'org/repo'})

    def test_partial_history_still_refuses_inconsistent_combined_failure_union(self):
        folders = [self.bundle(i, ('python-units',) if i == 1 else ())[0] for i in range(1, 5)]
        summary_path = folders[0] / 'release-check/summary.json'
        summary = json.loads(summary_path.read_text())
        summary['failed'] = []
        summary_path.write_text(json.dumps(summary))
        path = self.collect(folders)
        with self.assertRaisesRegex(CONTROLLER.Refused, 'combined failure union'):
            self.known(path)

    def test_shortfall_is_disclosed_for_only_the_step_lacking_three_controls(self):
        path = self.collect([self.bundle(i, ('python-units',) if i == 1 else ())[0] for i in range(1, 4)])
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest['step_runs']['python-units'], [2, 3])
        self.assertEqual(manifest['step_runs']['native-reader'], [1, 2, 3])
        self.assertTrue(manifest['fewer_than_three'])
        self.assertEqual(manifest['fewer_than_three_steps'], ['python-units'])
        self.assertEqual([row['run_id'] for row in self.known(path)[0]], [1, 2, 3])

    def test_manifest_cannot_select_a_cancelled_step_by_relabeling_its_control_ids(self):
        path = self.collect([self.bundle(i, ('python-units',) if i == 1 else ())[0] for i in range(1, 5)])
        manifest = json.loads(path.read_text())
        manifest['step_runs']['python-units'] = [1, 2, 3]
        manifest['runs'] = manifest['runs'][:3]
        manifest['runs'][0]['steps'] = sorted(self.required)
        manifest['runs'][0]['control_steps'] = sorted(self.required)
        manifest['browser_window_runs']['native-reader'] = [1, 2, 3]
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'selected history step is incomplete'):
            self.known(path)

    def test_selected_partial_history_still_verifies_original_raw_summary_digest(self):
        folder, _ = self.bundle(1, ('python-units',))
        raw_path = folder / 'shards/check-1/summary.json'
        raw = json.loads(raw_path.read_text())
        raw['counts'] = {'invented': True}
        raw_path.write_text(json.dumps(raw))
        path = self.collect([folder, *[self.bundle(i)[0] for i in range(2, 5)]])
        with self.assertRaisesRegex(CONTROLLER.Refused, 'original summary digest differs'):
            self.known(path)

    def test_cancelled_run_without_combined_receipt_is_named_and_older_controls_fill_it(self):
        path = self.collect([self.bundle(i)[0] for i in range(1, 5)], omit_combined=(1,))
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest['step_runs'], {name: [2, 3, 4] for name in self.required})
        self.assertEqual(manifest['dropped'][0]['id'], 1)
        self.assertEqual(manifest['dropped'][0]['why'], 'combined receipt absent; no whole steps proved')
        self.assertEqual([row['run_id'] for row in self.known(path)[0]], [2, 3, 4])


class BaseBlindMode1124Case(unittest.TestCase):
    """Ordinary judge units: retained artifacts, no browser or live API."""
    setUp = StepControlsCase.setUp
    git = StepControlsCase.git
    known = StepControlsCase.known

    def bundle(self, run_id, zero=True, new_red=False):
        folder, run = StepControlsCase.bundle(self, run_id)
        out = folder / 'shards/check-2'
        report_path = out / 'native/reader/native.json'
        report = json.loads(report_path.read_text())
        error = 'Error: preparation refused\n    at /fixture/tests/reader.mjs:1:1'
        report.update(bodyCompleted=not zero, bodyError=error if zero else None, teardownError=None)
        if zero:
            report['results'] = []
            (out / 'native/reader/body-error.txt').write_text(error)
            (out / 'native-reader.log').write_text(error + '\n')
        elif new_red:
            report['results'][0]['name'] = 'new candidate failure'
        report_path.write_text(json.dumps(report))
        step = json.loads((out / 'summary.json').read_text())['steps'][0]
        step['counts'], step['passed'] = CONTROLLER.native_counts(
            CONTROLLER.NativeStep('reader', 'tests/reader.mjs', (), 'native.json'), out / 'native/reader')
        step['exit'] = 0 if step['passed'] else 1
        self.save_step(folder, 2, step)
        return folder, run

    def save_step(self, folder, index, step):
        out = folder / 'shards' / ('check-%d' % index)
        raw = json.loads((out / 'summary.json').read_text())
        raw.update(steps=[step], passed=step['passed'], failed=[] if step['passed'] else [step['name']])
        (out / 'summary.json').write_text(json.dumps(raw))
        receipt = json.loads((out / 'run.json').read_text())
        receipt['summary_sha256'] = hashlib.sha256((out / 'summary.json').read_bytes()).hexdigest()
        (out / 'run.json').write_text(json.dumps(receipt))
        provenance_path = folder / 'release-check/provenance.json'
        provenance = json.loads(provenance_path.read_text())
        next(e for e in provenance['shards'] if e['artifact'] == out.name)['receipt'] = receipt
        provenance_path.write_text(json.dumps(provenance))
        summary_path = folder / 'release-check/summary.json'
        summary = json.loads(summary_path.read_text())
        summary['steps'] = [json.loads((folder / 'shards' / ('check-%d' % i) / 'summary.json').read_text())['steps'][0]
                            for i in range(len(self.required))]
        summary['passed'] = all(s['passed'] for s in summary['steps'])
        summary['failed'] = sorted(s['name'] for s in summary['steps'] if not s['passed'])
        summary_path.write_text(json.dumps(summary))

    def manifest(self, bundles):
        ids = [run['id'] for _, run in bundles]
        runs = []
        for folder, run in bundles:
            runs.append(dict(id=run['id'], run_attempt=1, head_sha=self.sha,
                head_branch='release/live73', event='push', status='completed', conclusion='failure',
                created_at='2026-11-22T05:%02d:00Z' % (59 - run['id']), dir=folder.name,
                steps=self.required, control_steps=self.required, browser_window_steps=['native-reader'],
                artifacts=[dict(id=run['id'] * 10 + i, name=name, size_in_bytes=100)
                           for i, name in enumerate(('release-check', 'check-0', 'check-1', 'check-2'), 1)]))
        doc = dict(base_ref='release/live73', base_head=self.sha, query='fixture authenticated API response',
            runs=runs, step_runs={n:ids for n in self.required}, browser_window_runs={'native-reader':ids},
            fewer_than_three=len(ids) < 3, fewer_than_three_steps=self.required if len(ids) < 3 else [],
            fewer_than_five_browser_steps=['native-reader'], fewer_than_ten_browser_steps=['native-reader'])
        doc['fewer_than_three_steps'] = sorted(doc['fewer_than_three_steps'])
        path = self.root / 'known-runs.json'
        path.write_text(json.dumps(doc))
        return path

    def judge(self, candidate, controls):
        known, records = self.known(self.manifest(controls))
        excluded = CONTROLLER.base_blind_modes(records, self.required)
        folder, run = candidate
        modes = {}
        observed, summary = CONTROLLER.read_evidence(
            folder / 'release-check/summary.json', folder / 'release-check/provenance.json', folder / 'shards',
            self.repo, self.sha, run, {'ref':None, 'sha':None}, self.merge,
            allow_empty_modes=excluded, strict_modes=excluded, mode_records=modes)
        failed, _ = CONTROLLER.failure_records(observed, self.repo, self.sha, run['id'], window=True)
        return CONTROLLER.compare_with_exclusions(failed, known, records, excluded, modes), summary

    def controls(self, zero=True):
        return [self.bundle(i, zero) for i in range(1, 4)]

    def test_zero_candidate_is_excluded_with_raw_failure_and_run_identities(self):
        result, raw = self.judge(self.bundle(99), self.controls())
        self.assertTrue(result['passed'], result)
        observation = result['browser_windows']['native-reader']
        self.assertEqual(observation['mode'], 'excluded')
        self.assertEqual(observation['run_ids'], [1, 2, 3])
        self.assertEqual([r['head_sha'] for r in observation['base_runs']], [self.sha] * 3)
        self.assertIn('zero cases', observation['reason'])
        self.assertEqual(observation['candidate'][0]['counts']['tests'], 0)
        self.assertEqual(observation['candidate'][0]['exit'], 1)
        self.assertIn('preparation refused', observation['candidate'][0]['bodyError'])
        self.assertFalse(raw['passed'])
        self.assertEqual(result['expected'], [])
        self.assertEqual(result['unexpected'], [])

    def test_nonzero_candidate_red_is_reported_without_becoming_known_red(self):
        candidate = self.bundle(99, zero=False, new_red=True)
        result, raw = self.judge(candidate, self.controls())
        self.assertTrue(result['passed'], result)
        report = result['browser_windows']['native-reader']['candidate'][0]
        self.assertEqual(report['counts']['tests'], 1)
        self.assertEqual(report['counts']['fail'], 1)
        self.assertEqual(report['results'][0]['name'], 'new candidate failure')
        self.assertIn('stable failure', report['results'][0]['error'])
        self.assertFalse(report['raw_passed'])
        self.assertFalse(raw['passed'])
        self.assertEqual(result['expected'], [])
        self.assertEqual(result['unexpected'], [])

    def test_observed_base_still_refuses_zero_candidate(self):
        with self.assertRaisesRegex(CONTROLLER.Refused, 'missing case results'):
            self.judge(self.bundle(99), self.controls(False))

    def test_observed_base_still_rejects_new_candidate_red(self):
        result, _ = self.judge(self.bundle(99, False, True), self.controls(False))
        self.assertFalse(result['passed'])
        self.assertEqual(result['unexpected'][0]['case']['name'], 'new candidate failure')
        self.assertEqual(result['browser_windows'], {})

    def test_mixed_history_cannot_drop_zero_case_controls(self):
        controls = [self.bundle(1), self.bundle(2, False), self.bundle(3)]
        with self.assertRaisesRegex(CONTROLLER.Refused, 'mixed base history'):
            self.judge(self.bundle(99), controls)

    def test_empty_eligible_history_cannot_establish_exclusion(self):
        with self.assertRaisesRegex(CONTROLLER.Refused, 'missing case results'):
            self.judge(self.bundle(99), [])

    def test_absent_partial_and_corrupt_base_reports_refuse(self):
        controls = self.controls()
        path = controls[0][0] / 'shards/check-2/native/reader/native.json'
        original = path.read_text()
        for content in (None, '{}', '{', '[]'):
            with self.subTest(content=content):
                if content is None:
                    path.unlink()
                else:
                    path.write_text(content)
                with self.assertRaises(CONTROLLER.Refused):
                    self.known(self.manifest(controls))
                path.write_text(original)

    def test_wrong_source_or_receipt_cannot_establish_exclusion(self):
        controls = self.controls()
        folder = controls[0][0]
        path = folder / 'shards/check-2/run.json'
        receipt = json.loads(path.read_text())
        receipt['run']['id'] = 987
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'receipt'):
            self.known(self.manifest(controls))

    def test_missing_selected_artifact_refuses(self):
        controls = self.controls()
        path = self.manifest(controls)
        doc = json.loads(path.read_text())
        doc['runs'][0]['artifacts'] = doc['runs'][0]['artifacts'][:-1]
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'artifacts incomplete'):
            self.known(path)

    def test_wrong_shard_source_refuses(self):
        controls = self.controls()
        path = controls[0][0] / 'shards/check-2/summary.json'
        raw = json.loads(path.read_text())
        raw['commit'] = 'a' * 40
        path.write_text(json.dumps(raw))
        self.save_step(controls[0][0], 2, raw['steps'][0])
        with self.assertRaisesRegex(CONTROLLER.Refused, 'wrong shard source'):
            self.known(self.manifest(controls))

    def test_wrong_report_source_frame_refuses(self):
        controls = self.controls()
        folder = controls[0][0]
        path = folder / 'shards/check-2/native/reader/native.json'
        report = json.loads(path.read_text())
        report['bodyError'] = report['bodyError'].replace('/fixture/', '/foreign/')
        path.write_text(json.dumps(report))
        (path.parent / 'body-error.txt').write_text(report['bodyError'])
        (folder / 'shards/check-2/native-reader.log').write_text(report['bodyError'])
        with self.assertRaisesRegex(CONTROLLER.Refused, 'outside verified checkout'):
            self.known(self.manifest(controls))

    def test_failed_or_unattested_cleanup_refuses_on_base_and_candidate(self):
        controls, candidate = self.controls(), self.bundle(99)
        for pair in (controls[0], candidate):
            path = pair[0] / 'shards/check-2/native/reader/native.json'
            original = path.read_text()
            for field, value in (('browserClosed', False), ('fixtureExitCode', 2), ('teardownError', 'failed')):
                with self.subTest(side=pair[1]['id'], field=field):
                    report = json.loads(original)
                    report[field] = value
                    path.write_text(json.dumps(report))
                    with self.assertRaises(CONTROLLER.Refused):
                        self.judge(candidate, controls)
                    path.write_text(original)

    def test_counts_and_direct_exit_are_still_checked(self):
        controls, candidate = self.controls(), self.bundle(99)
        path = candidate[0] / 'shards/check-2/summary.json'
        original = json.loads(path.read_text())['steps'][0]
        for field, value in (('exit', 0), ('counts', {'tests':0})):
            with self.subTest(field=field):
                step = dict(original, **{field:value})
                self.save_step(candidate[0], 2, step)
                with self.assertRaises(CONTROLLER.Refused):
                    self.judge(candidate, controls)
                self.save_step(candidate[0], 2, original)

    def test_partial_body_or_missing_error_log_is_not_zero_case_proof(self):
        controls, candidate = self.controls(), self.bundle(99)
        path = candidate[0] / 'shards/check-2/native/reader/body-error.txt'
        path.unlink()
        with self.assertRaisesRegex(CONTROLLER.Refused, 'unreadable evidence log'):
            self.judge(candidate, controls)

    def test_nonzero_excluded_candidate_invalid_error_still_refuses(self):
        candidate, controls = self.bundle(99, False), self.controls()
        path = candidate[0] / 'shards/check-2/native/reader/native.json'
        report = json.loads(path.read_text())
        report['results'][0]['error'] = 'no verified source frame'
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(CONTROLLER.Refused, 'no verified test source frames'):
            self.judge(candidate, controls)

    def test_other_steps_keep_their_failures(self):
        candidate, controls = self.bundle(99), self.controls()
        out = candidate[0] / 'shards/check-1'
        log = '# Subtest: new node failure\nnot ok 1 - new node failure\n# tests 1\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n'
        (out / 'node-units.log').write_text(log)
        step = dict(name='node-units', exit=1, passed=False, counts=CONTROLLER.node_counts(log)[0])
        self.save_step(candidate[0], 1, step)
        result, _ = self.judge(candidate, controls)
        self.assertFalse(result['passed'])
        self.assertEqual([r['step'] for r in result['unexpected']], ['node-units'])
        self.assertEqual(result['browser_windows']['native-reader']['mode'], 'excluded')

    def test_other_browser_modes_keep_their_comparison(self):
        # The excluded mode cannot remove a new red in a different browser mode.
        row = dict(step='native-observed', case={'name':'new observed red'}, run_id=99,
                   raw_passed=False, fingerprint_problem='new unmatched assertion')
        result = CONTROLLER.compare_with_exclusions([row], [], [],
            {'native-reader':[dict(id=1, head_sha=self.sha, created_at='t')]}, {'native-reader':[]})
        self.assertFalse(result['passed'])
        self.assertEqual([r['step'] for r in result['unexpected']], ['native-observed'])
        self.assertEqual(result['unexpected'][0]['fingerprint_problem'], row['fingerprint_problem'])


if __name__ == '__main__':
    unittest.main()

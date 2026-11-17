from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from unittest import mock

from tools import check_plan, release_check

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/checks.yml'
LONG = {'native-reading', 'native-rail', 'native-webkit-reading', 'native-compose'}


def script(section):
    return textwrap.dedent(section.split("<<'PY'", 1)[1].split('\n', 1)[1].split('          PY\n', 1)[0])


class BrowserShards(unittest.TestCase):
    def setUp(self):
        self.workflow = WORKFLOW.read_text()
        self.measured = json.loads((ROOT / 'tests/fixtures/browser-step-minutes.json').read_text())['minutes']

    def plan(self, native=None, weights=None):
        count = re.search(r'^  BROWSER_SHARDS: (\d+)$', self.workflow, re.M).group(1)
        self.assertIn('python3 -I tools/check_plan.py --github-output', self.workflow)
        measured = json.loads((ROOT / '.github/check-weights.json').read_text())
        if weights is not None:
            measured['minutes'] = weights
        with mock.patch.object(release_check, 'NATIVE_STEPS', release_check.NATIVE_STEPS if native is None else native):
            return check_plan.plan(ROOT, 'push', {}, 'a' * 40, int(count), measured['minutes'], measured)['shards']

    def test_todays_required_steps_finish_within_five_minutes_of_four_way_split(self):
        plan = self.plan()
        ordinary = [n for shard in plan if not shard.get('python_shard') for n in shard['steps'].split(',')]
        self.assertEqual(sum(bool(shard.get('python_shard')) for shard in plan), 4)
        self.assertEqual(sorted(['python-units'] + ordinary), sorted(release_check.REQUIRED))
        browser = [shard for shard in plan if shard['name'].startswith('browser ')]
        loads = [round(sum(self.measured[n] for n in shard['steps'].split(',')), 1) for shard in browser]
        crowded = [shard['steps'] for shard in browser if len(LONG & set(shard['steps'].split(','))) > 1]
        print('measured browser minutes: %s; even split: %.3f; crowded long steps: %s' %
              (loads, sum(self.measured.values()) / 4, crowded))
        self.assertFalse(crowded, 'two of the four long steps share a shard')
        self.assertEqual(len(browser), 4)
        self.assertTrue(all(abs(load - sum(self.measured.values()) / 4) <= 5 for load in loads), loads)

    def test_timeout_is_longest_dealt_minutes_plus_half_and_used_by_runner(self):
        browser = [s for s in self.plan() if s['name'].startswith('browser ')]
        longest = max(sum(self.measured[n] for n in s['steps'].split(',')) for s in browser)
        expected = math.ceil(longest * 1.5)
        self.assertEqual([s.get('timeout_minutes') for s in browser], [expected] * len(browser))
        self.assertIn('timeout-minutes: ${{ matrix.timeout_minutes }}', self.workflow)
        self.assertTrue(all('longest' in s['timeout_source'] and '1.5' in s['timeout_source'] for s in browser))
        from tools import unit_shards
        jobs = unit_shards.jobs(ROOT, json.loads((ROOT / '.github/check-weights.json').read_text()))
        actual = {s['name']: s['timeout_minutes'] for s in self.plan()}
        self.assertTrue(all(actual[j['name']] == j['timeout'] for j in jobs))
        self.assertEqual(actual['wake replay'], 45)

    def test_weights_keep_each_measured_maximum_with_its_source(self):
        weights = json.loads((ROOT / '.github/check-weights.json').read_text())
        self.assertEqual({n: weights['minutes'].get(n) for n in self.measured}, self.measured)
        for name, minutes in self.measured.items():
            samples = weights['sources'][name]
            self.assertEqual(max(row['minutes'] for row in samples), minutes)
            self.assertTrue(all(row['run'] in ('44007172971', '44044963750', '44099688612') for row in samples))

    def test_an_unmeasured_step_is_dealt_at_the_upper_median_and_never_dropped(self):
        new = release_check.NativeStep('unmeasured', '', (), '')
        native = tuple(release_check.NATIVE_STEPS) + (new,)
        with mock.patch.object(release_check, 'REQUIRED', release_check.REQUIRED + ('native-unmeasured',)):
            plan = self.plan(native=native)
        dealt = [n for s in plan for n in s['steps'].split(',')]
        self.assertEqual(dealt.count('native-unmeasured'), 1)
        # A scoped selection goes through exactly the same deal; the upper median of [2, 8] is 8.
        selected = (release_check.NativeStep('measured', '', (), ''), new)
        required = release_check.UNIT_STEPS + (release_check.DEPLOY_REFUSALS, release_check.WAKE_REPLAY,
                                              'native-measured', 'native-unmeasured')
        with mock.patch.object(release_check, 'REQUIRED', required):
            scoped = self.plan(native=selected, weights={'native-measured': 2, 'native-other': 8})
        browser = [s for s in scoped if s['name'].startswith('browser ')]
        self.assertEqual(sum(s['minutes'] for s in browser), 10)
        self.assertEqual(sum(s['steps'].split(',').count('native-unmeasured') for s in browser), 1)

    def test_largest_first_uses_the_lightest_shard_even_for_a_fifth_long_step(self):
        native = tuple(release_check.NativeStep(n, '', (), '') for n in ('a', 'b', 'c', 'd', 'e'))
        weights = {'native-' + n: w for n, w in zip('abcde', (40, 35, 30, 25, 20))}
        required = release_check.UNIT_STEPS + (release_check.DEPLOY_REFUSALS, release_check.WAKE_REPLAY) + tuple(weights)
        with mock.patch.object(release_check, 'REQUIRED', required):
            browser = [s for s in self.plan(native=native, weights=weights) if s['name'].startswith('browser ')]
        self.assertIn('native-d,native-e', [s['steps'] for s in browser])
        self.assertEqual(sorted(s['minutes'] for s in browser), [30, 35, 40, 45])

    def combine(self, absent=(), refused=(), narrow=False, cancelled=None, plan=None, partial=False, event='push', scoped=None):
        plan = self.plan() if plan is None else plan
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shards = root / 'shards'
            shards.mkdir()
            for index, shard in enumerate(plan):
                if index in absent:
                    continue
                folder = shards / ('check-%d' % index)
                folder.mkdir()
                names = shard['steps'].split(',')
                doc = {'tool': release_check.TOOL, 'commit': 'a' * 40, 'checkout': '/fixture', 'tools': {},
                       'required': names if narrow else list(release_check.REQUIRED),
                       'steps': [{'name': n, 'passed': True, 'exit': 0} for n in names],
                       'tree_unchanged': True, 'tree_after': {}, 'passed': True,
                       'started_at': '2026-11-17T00:00:00Z', 'finished_at': '2026-11-17T00:01:00Z'}
                if shard.get('python_shard'):
                    part, total = map(int, shard['python_shard'].split('/'))
                    doc['python_shard'] = {'index': part, 'total': total, 'files': shard['files']}
                    doc['steps'][0]['counts'] = {'tests': 1, 'status': 'OK'}
                if partial and index == 0:
                    doc['steps'] = self.logged_results()
                if index in refused:
                    doc = {'refused': 'no browser', 'steps': [], 'passed': False}
                raw = json.dumps(doc)
                (folder / 'summary.json').write_text(raw)
                receipt = {'run': {'id': '44099688612', 'attempt': '1'}, 'merge': {'sha': 'a' * 40},
                           'summary_sha256': hashlib.sha256(raw.encode()).hexdigest()}
                receipt['shard'] = {'name': shard.get('name', shard['steps'])}
                if event == 'pull_request':
                    receipt['merge']['first_parent'] = 'b' * 40
                    receipt['base_at_run'] = {'ref': 'release/fixture', 'sha': 'b' * 40}
                (folder / 'run.json').write_text(json.dumps(receipt))
            if cancelled is not None:
                (shards / 'cancelled.json').write_text(json.dumps(cancelled))
            env = dict(os.environ, GITHUB_RUN_ID='44099688612', GITHUB_RUN_ATTEMPT='1', GITHUB_SHA='a' * 40,
                       GITHUB_EVENT_NAME=event, BASE_REF='release/fixture', BASE_SHA='b' * 40,
                       PLAN_SCOPE=json.dumps(scoped), PLAN_SHARDS=json.dumps(plan))
            out = root / 'summary.json'
            code = script(self.workflow.split("      - name: Fold the shards' summaries into one\n", 1)[1])
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(sys, 'argv', ['combine', str(shards), str(out)]), \
                    redirect_stdout(io.StringIO()) as printed, self.assertRaises(SystemExit) as ended:
                exec(compile(code, str(WORKFLOW), 'exec'), {})
            if not out.exists():
                return ended.exception.code, None, None, plan
            summary = json.loads(out.read_text())
            summary_path = root / 'judge.json'
            summary_path.write_text(json.dumps(summary))
            self.judged = release_check.judge_summary(summary_path, 'a' * 40)
            self.provenance = json.loads((root / 'provenance.json').read_text())
            return ended.exception.code, summary, json.loads(printed.getvalue()), plan

    def cancellation(self):
        return json.loads((ROOT / 'tests/fixtures/cancelled-browser-44099688612.json').read_text())

    def logged_results(self):
        return [json.loads(line.split(' ', 1)[1]) for line in self.cancellation()['log'].splitlines()
                if ' {"name":' in line]

    def cancellation_input(self):
        fixture = self.cancellation()
        return [{'run_id': fixture['run_id'], 'attempt': fixture['attempt'], 'head_sha': 'a' * 40,
                 'id': 1234, 'commit': 'a' * 40, 'name': fixture['name'], 'conclusion': 'cancelled',
                 'started_at': '2026-11-17T14:08:30Z', 'completed_at': '2026-11-17T15:23:40Z',
                 'log': fixture['log']}]

    def cancelled_plan(self):
        fixture = self.cancellation()
        return [{'name': fixture['name'], 'steps': ','.join(fixture['steps'])},
                {'name': 'remaining steps', 'steps': ','.join(n for n in release_check.REQUIRED if n not in fixture['steps'])}]

    def test_scoped_cancel_keeps_results_and_omissions_without_hiding_a_missing_python_partition(self):
        fixture = self.cancellation()
        units = [job for job in self.plan() if not job['name'].startswith('browser ')]
        plan = [{'name': fixture['name'], 'steps': ','.join(fixture['steps'])}] + units
        scoped = {'live': 'b' * 40, 'steps': fixture['steps'], 'changed': ['web/aim.css'],
                  'not_run': [n for n in release_check.REQUIRED if n.startswith('native-') and n not in fixture['steps']]}
        for missing_python in (False, True):
            with self.subTest(missing_python=missing_python):
                absent = (0, 2) if missing_python else (0,)
                code, summary, printed, _ = self.combine(absent=absent, narrow=True,
                    cancelled=self.cancellation_input(), plan=plan, event='pull_request', scoped=scoped)
                self.assertEqual(code, 1)
                self.assertEqual(summary['scoped'], scoped)
                self.assertEqual(summary['required'], sorted(release_check.REQUIRED))
                self.assertEqual(len(summary['cancelled_shards'][0]['recovered']), 6)
                missing = set(fixture['steps']) - {s['name'] for s in self.logged_results()}
                if missing_python:
                    missing.add('python-units')
                self.assertEqual(set(printed['missing']), missing)
                self.assertEqual(summary['missing_jobs'], [plan[i]['name'] for i in absent])
                python = [s for s in summary['steps'] if s['name'] == 'python-units']
                self.assertEqual(len(python), int(not missing_python))
                if python:
                    self.assertEqual(python[0]['counts']['tests'], 4)
                    self.assertEqual(len(python[0]['shards']), 4)
                self.assertFalse(summary['passed'])
                self.assertFalse(summary['quarantine']['green'])
                self.assertFalse(summary['tree_unchanged'])
                self.assertFalse(set(scoped['not_run']) & set(printed['missing']))

    def test_train_33_cancel_keeps_six_logged_results_with_shard_and_cancel_time(self):
        fixture = self.cancellation()
        for partial in (False, True):
            with self.subTest(partial_artifact=partial):
                code, summary, printed, _ = self.combine(absent=() if partial else (0,), narrow=True,
                    cancelled=self.cancellation_input(), plan=self.cancelled_plan(), partial=partial)
                kept = [s for s in summary['steps'] if s['name'] in fixture['steps']]
                self.assertEqual(len(kept), 6, 'train 33 lost six already logged results')
                for actual, logged in zip(kept, self.logged_results()):
                    self.assertEqual({k: actual[k] for k in logged}, logged)
                    self.assertEqual(actual['shard'], fixture['name'])
                    self.assertEqual(actual['cancelled_at'], fixture['cancelled_at'])
                    self.assertEqual(actual['result_source'], 'github-job-log')
                self.assertEqual(sum(s['passed'] for s in kept), 4)
                self.assertEqual(len(summary['cancelled_shards']), 1)
                self.assertEqual(self.provenance['cancelled_shards'], summary['cancelled_shards'])
                self.assertEqual(summary['finished_at'], fixture['cancelled_at'])

    def test_no_finished_summary_retains_cancelled_results_and_all_missing_steps(self):
        plan = self.cancelled_plan()
        # No artifacts, only refusals, and a mixture: none has a finished sibling to lend metadata.
        for absent, refused in (((0, 1), ()), ((), (0, 1)), ((0,), (1,))):
            for event in ('push', 'pull_request'):
                with self.subTest(absent=absent, refused=refused, event=event):
                    code, summary, printed, _ = self.combine(absent, refused, narrow=True,
                        cancelled=self.cancellation_input(), plan=plan, event=event)
                    self.assertIsNotNone(summary, 'cancelled evidence must not need a finished sibling: %s' % code)
                    self.assertEqual(len(summary['steps']), 6)
                    for actual, logged in zip(summary['steps'], self.logged_results()):
                        self.assertEqual({k: actual[k] for k in logged}, logged)
                        self.assertEqual(actual['shard'], self.cancellation()['name'])
                        self.assertEqual(actual['cancelled_at'], self.cancellation()['cancelled_at'])
                    missing = sorted(set(release_check.REQUIRED) - {s['name'] for s in self.logged_results()})
                    self.assertEqual(printed['missing'], missing)
                    self.assertEqual(summary['required'], sorted(release_check.REQUIRED))
                    self.assertEqual(set(summary['failed']), set(missing) | {s['name'] for s in self.logged_results() if not s['passed']})
                    self.assertEqual(summary['commit'], 'a' * 40)
                    self.assertEqual(summary['started_at'], self.cancellation_input()[0]['started_at'])
                    self.assertEqual(summary['finished_at'], self.cancellation()['cancelled_at'])
                    self.assertEqual(self.provenance['cancelled_shards'], summary['cancelled_shards'])
                    self.assertFalse(summary['tree_unchanged'])
                    self.assertFalse(summary['passed'])
                    self.assertFalse(summary['quarantine']['green'])
                    self.assertTrue(self.judged[0] or self.judged[1])
                    self.assertEqual(code, 1)
                    if not refused:
                        self.assertEqual(self.provenance['merge'], dict(sha='a' * 40, tree=None, first_parent=None, second_parent=None))
                        self.assertNotIn('base_at_run', self.provenance)

    def test_no_finished_summary_reports_missing_even_without_recoverable_logs(self):
        for absent, refused in (((0, 1), ()), ((), (0, 1))):
            for logs in ('unavailable', 'no cancelled jobs'):
                with self.subTest(absent=absent, refused=refused, logs=logs):
                    data = self.cancellation_input() if logs == 'unavailable' else []
                    if data:
                        data[0].update(log='', log_error='job logs unavailable')
                    code, summary, printed, _ = self.combine(absent, refused, narrow=True,
                        cancelled=data, plan=self.cancelled_plan())
                    self.assertIsNotNone(summary, 'missing-step evidence must survive without finished summaries: %s' % code)
                    self.assertEqual(summary['steps'], [])
                    self.assertEqual(summary['failed'], sorted(release_check.REQUIRED))
                    self.assertEqual(printed['missing'], sorted(release_check.REQUIRED))
                    self.assertFalse(summary['tree_unchanged'])
                    self.assertFalse(summary['passed'])
                    self.assertFalse(summary['quarantine']['green'])
                    self.assertTrue(self.judged[0] or self.judged[1])
                    self.assertEqual(code, 1)
                    if data:
                        self.assertEqual(summary['cancelled_shards'][0]['log_error'], 'job logs unavailable')
                        self.assertEqual(summary['finished_at'], data[0]['completed_at'])
                    else:
                        self.assertIsNone(summary['started_at'])
                        self.assertIsNone(summary['finished_at'])

    def test_cancelled_unreached_steps_stay_missing_and_results_never_make_a_sample(self):
        code, summary, printed, _ = self.combine(absent=(0,), narrow=True,
            cancelled=self.cancellation_input(), plan=self.cancelled_plan())
        missing = sorted(set(self.cancellation()['steps']) - {s['name'] for s in self.logged_results()})
        self.assertEqual(printed['missing'], missing)
        self.assertEqual(len(missing), 10)
        self.assertFalse(summary['passed'])
        self.assertFalse(summary['quarantine']['green'])
        self.assertEqual(code, 1)
        self.assertTrue(any('did not run native-webkit-pipeline' in reason for reason in self.judged[1]))

    def test_cancel_even_after_last_result_cannot_be_a_release_verdict(self):
        plan = self.cancelled_plan()
        plan[0]['steps'] = ','.join(s['name'] for s in self.logged_results())
        plan[1]['steps'] = ','.join(n for n in release_check.REQUIRED if n not in plan[0]['steps'].split(','))
        data = self.cancellation_input()
        # All logged results green still cannot prove the cancelled shard's checkout stayed unchanged.
        data[0]['log'] = data[0]['log'].replace('"passed": false', '"passed": true')
        code, summary, printed, _ = self.combine(absent=(0,), narrow=True, cancelled=data, plan=plan)
        self.assertEqual(printed['missing'], [])
        self.assertFalse(summary['passed'])
        self.assertFalse(summary['quarantine']['green'])
        self.assertTrue(self.judged[0] or self.judged[1])
        self.assertEqual(code, 1)

    def test_workflow_fetches_cancelled_logs_for_this_attempt_and_survives_unavailable_logs(self):
        self.assertIn('      - name: Recover cancelled browser jobs', self.workflow)
        section = self.workflow.split('      - name: Recover cancelled browser jobs\n', 1)[1]
        code = textwrap.dedent(section.split('          script: |\n', 1)[1].split("      - name: Fold the shards' summaries into one", 1)[0])
        jobs = self.cancellation_input()
        jobs += [dict(jobs[0], id=2345, name='unrelated', conclusion='success'),
                 dict(jobs[0], id=3456, name=self.cancellation()['name'], conclusion='timed_out')]
        harness = '''
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let written, requests = [];
const github = {rest: {actions: {listJobsForWorkflowRunAttempt: 'attempt-jobs', downloadJobLogsForWorkflowRun: 'job-logs'}},
  paginate: async (method, args) => { requests.push([method, args]); return input.jobs; },
  request: async (route, args) => { requests.push([route, args]);
    if (args.job_id === 3456) throw new Error('logs unavailable');
    return {data: input.jobs[0].log}; }};
const context = {repo: {owner:'owner', repo:'repo'}, runId:44099688612, sha:'a'.repeat(40),
  payload: {pull_request: {head: {sha: 'b'.repeat(40)}}}};
const core = {warning: () => {}};
const original = fs.writeFileSync;
fs.writeFileSync = (path, data) => { written = JSON.parse(data); };
(async () => { await new (Object.getPrototypeOf(async function(){}).constructor)('github','context','core',input.code)(github,context,core);
  fs.writeFileSync = original; process.stdout.write(JSON.stringify({written, requests})); })().catch(e=>{console.error(e);process.exit(1)});
'''
        jobs = [dict(job, head_sha='b' * 40) for job in jobs]
        answer = subprocess.run(['node', '-e', harness], input=json.dumps({'jobs': jobs, 'code': code}),
            capture_output=True, text=True, env=dict(os.environ, GITHUB_RUN_ATTEMPT='7', PLAN_SHARDS=json.dumps(self.cancelled_plan())))
        self.assertEqual(answer.returncode, 0, answer.stderr)
        result = json.loads(answer.stdout)
        self.assertEqual(result['requests'][0][1]['attempt_number'], 7)
        self.assertEqual(result['requests'][0][1]['run_id'], 44099688612)
        self.assertEqual([r[1]['job_id'] for r in result['requests'][1:]], [1234, 3456])
        self.assertEqual(result['written'][0]['log'], jobs[0]['log'])
        self.assertEqual(result['written'][0]['head_sha'], 'b' * 40)
        self.assertEqual(result['written'][0]['commit'], 'a' * 40)
        self.assertEqual(result['written'][0]['attempt'], '7')
        self.assertEqual(result['written'][1]['log'], '')
        self.assertIn('log_error', result['written'][1])
        self.assertIn('    permissions:\n      contents: read\n      actions: read', self.workflow)

    def test_cancel_recovery_refuses_another_attempt_commit_or_unplanned_shard(self):
        for field, value in (('attempt', '2'), ('run_id', '2'), ('commit', 'b' * 40), ('name', 'unknown')):
            with self.subTest(field=field):
                data = self.cancellation_input()
                data[0][field] = value
                code, summary, _, _ = self.combine(absent=(0,), narrow=True, cancelled=data, plan=self.cancelled_plan())
                self.assertIsNone(summary)
                self.assertIn('does not belong', code)

    def test_unavailable_cancelled_log_keeps_every_unrecovered_step_missing(self):
        data = self.cancellation_input()
        data[0].update(log='', log_error='job logs unavailable')
        code, summary, printed, _ = self.combine(absent=(0,), narrow=True, cancelled=data, plan=self.cancelled_plan())
        self.assertEqual(printed['missing'], sorted(self.cancellation()['steps']))
        self.assertEqual(summary['cancelled_shards'][0]['cancelled_at'], data[0]['completed_at'])
        self.assertEqual(summary['cancelled_shards'][0]['log_error'], 'job logs unavailable')
        self.assertEqual(code, 1)

    def test_cancel_log_does_not_invent_unplanned_or_partial_results(self):
        data = self.cancellation_input()
        stamp = '2026-11-17T15:23:30Z '
        data[0]['log'] += stamp + '{"name":"python-units","exit":0,"passed":true,"counts":{}}\n'
        data[0]['log'] += stamp + '{"name":"native-webkit-pipeline","passed":true}\n'
        data[0]['log'] += stamp + '{broken json}\n'
        code, summary, printed, _ = self.combine(absent=(0,), narrow=True, cancelled=data, plan=self.cancelled_plan())
        self.assertEqual(len(summary['cancelled_shards'][0]['recovered']), 6)
        self.assertIn('native-webkit-pipeline', printed['missing'])
        self.assertEqual(len([s for s in summary['steps'] if s['name'] == 'python-units']), 1)

    def test_combined_summary_keeps_all_required_steps_when_a_shard_reports_nothing(self):
        for absent, refused, narrow in (((), (), False), ((0,), (), False), ((), (0,), False),
                                       ((0,), (), True), ((), (0,), True)):
            with self.subTest(absent=absent, refused=refused, narrow=narrow):
                code, summary, printed, plan = self.combine(absent, refused, narrow)
                missing = sorted(plan[0]['steps'].split(',')) if absent or refused else []
                self.assertEqual(sorted(summary['required']), sorted(release_check.REQUIRED))
                self.assertEqual(printed['missing'], missing)
                self.assertEqual(sorted(summary['failed']), missing)
                self.assertEqual(summary['passed'], not missing)
                self.assertEqual(summary['quarantine']['green'], not missing)
                self.assertEqual(code, 1 if missing else 0)


if __name__ == '__main__':
    unittest.main()

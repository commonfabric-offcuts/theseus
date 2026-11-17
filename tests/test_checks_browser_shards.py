from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from unittest import mock

from tools import release_check

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
        code = script(self.workflow.split('      - id: plan\n', 1)[1])
        with mock.patch.object(sys, 'argv', ['plan', count]), \
                mock.patch.object(release_check, 'NATIVE_STEPS', release_check.NATIVE_STEPS if native is None else native), \
                redirect_stdout(io.StringIO()) as out:
            if weights is None:
                exec(compile(code, str(WORKFLOW), 'exec'), {})
            else:
                with mock.patch.object(json, 'load', return_value={'minutes': weights}):
                    exec(compile(code, str(WORKFLOW), 'exec'), {})
        return json.loads(out.getvalue().strip().split('shards=', 1)[1])

    def test_todays_required_steps_finish_within_five_minutes_of_four_way_split(self):
        plan = self.plan()
        self.assertEqual(sorted(n for shard in plan for n in shard['steps'].split(',')), sorted(release_check.REQUIRED))
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
        self.assertTrue(all(s['timeout_minutes'] == 45 for s in self.plan() if not s['name'].startswith('browser ')))

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

    def combine(self, absent=(), refused=(), narrow=False):
        plan = self.plan()
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
                if index in refused:
                    doc = {'refused': 'no browser', 'steps': [], 'passed': False}
                raw = json.dumps(doc)
                (folder / 'summary.json').write_text(raw)
                receipt = {'run': {'id': '1', 'attempt': '1'}, 'merge': {'sha': 'a' * 40},
                           'summary_sha256': hashlib.sha256(raw.encode()).hexdigest()}
                (folder / 'run.json').write_text(json.dumps(receipt))
            env = dict(os.environ, GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1', GITHUB_SHA='a' * 40,
                       GITHUB_EVENT_NAME='push', PLAN_SHARDS=json.dumps(plan))
            out = root / 'summary.json'
            code = script(self.workflow.split("      - name: Fold the shards' summaries into one\n", 1)[1])
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(sys, 'argv', ['combine', str(shards), str(out)]), \
                    redirect_stdout(io.StringIO()) as printed, self.assertRaises(SystemExit) as ended:
                exec(compile(code, str(WORKFLOW), 'exec'), {})
            return ended.exception.code, json.loads(out.read_text()), json.loads(printed.getvalue()), plan

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

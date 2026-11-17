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


if __name__ == '__main__':
    unittest.main()

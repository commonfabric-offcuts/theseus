from __future__ import annotations

import copy
from datetime import datetime
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools import unit_shards

ROOT = Path(__file__).resolve().parents[1]
OBSERVED = json.loads((ROOT / 'tests/fixtures/python_headroom_1016.json').read_text())


class PythonHeadroom(unittest.TestCase):
    def setUp(self):
        self.weights = json.loads((ROOT / '.github/check-weights.json').read_text())

    def test_published_plan_reserves_half_the_observed_job_time(self):
        # Actual GitHub intervals, including finalizers. The cancelled one is
        # only a lower bound: no completed suite time is inferred from it.
        intervals = [(datetime.fromisoformat(j['completed_at'].replace('Z', '+00:00')) -
                      datetime.fromisoformat(j['started_at'].replace('Z', '+00:00'))).total_seconds()
                     for j in OBSERVED['jobs']]
        self.assertEqual(intervals, [1164, 1133])
        self.assertEqual(OBSERVED['jobs'][0]['conclusion'], 'cancelled')
        self.assertTrue(all(s['conclusion'] == 'success' for s in OBSERVED['jobs'][0]['steps'][1:]))
        answer = subprocess.run([sys.executable, '-I', str(ROOT / 'tools/unit_shards.py'),
                                 '--plan', '--event-name', 'push', '--head', OBSERVED['source_base'],
                                 '--github-output'], capture_output=True, text=True,
                                env=dict(os.environ, GITHUB_EVENT_PATH=''))
        self.assertEqual(answer.returncode, 0, answer.stderr)
        shards = json.loads(next(line[len('shards='):] for line in answer.stdout.splitlines()
                                 if line.startswith('shards=')))
        python = [job for job in shards if job.get('python_shard')]
        self.assertEqual(len(python), 4)
        for job in python:
            self.assertGreaterEqual(job['timeout_minutes'] * 60, max(intervals) * 1.5,
                                    '%s has no headroom over the cancelled job' % job['name'])

    def test_timeout_change_preserves_file_coverage_and_other_job_caps(self):
        old = copy.deepcopy(self.weights)
        old['units'].pop('python_timeout_floor_minutes', None)
        before = unit_shards.jobs(ROOT, old)
        after = unit_shards.jobs(ROOT, self.weights)
        for left, right in zip(before, after):
            if right.get('python_shard'):
                left = dict(left, timeout=right['timeout'])
            self.assertEqual(left, right)
        files = [path for job in after if job.get('python_shard') for path in job['files']]
        self.assertEqual(sorted(files), unit_shards.test_files(ROOT))
        self.assertEqual(len(files), len(set(files)))
        self.assertEqual(len(before), len(after))

    def test_larger_measured_timeout_still_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'tests').mkdir()
            (root / 'tests/test_expensive.py').touch()
            self.weights['units']['python_shards'] = 1
            self.weights['units']['python_minutes'] = {'tests/test_expensive.py': 50}
            job = unit_shards.jobs(root, self.weights)[0]
            self.assertEqual(job['timeout'], math.ceil((50 + self.weights['units']['setup_minutes']) * 1.5))
            self.assertGreater(job['timeout'], 30)

    def test_workflow_consumes_the_matrix_timeout_and_keeps_always_finalizers(self):
        workflow = (ROOT / '.github/workflows/checks.yml').read_text()
        # This is the actual check-job timeout expression, not a test-side
        # evaluator that could agree while GitHub used a different value.
        self.assertIn("    timeout-minutes: ${{ startsWith(matrix.name, 'browser ') && 100 || matrix.timeout_minutes }}", workflow)
        for name in ("Write this shard's receipt", 'Keep the evidence'):
            section = workflow.split('      - name: ' + name + '\n', 1)[1].split('      - ', 1)[0]
            self.assertIn('        if: always()\n', section)


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

"""1071 budgets and actual shared Git/CLI/Core classification, scratch only."""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest

from aim_next.judgment import guarded, source_diff
from tools import unit_shards as sh
from test_gauntlet_source_987 import Binder987

ROOT = Path(__file__).resolve().parents[1]
PLANNING = ('tools/unit_shards.py', '.github/check-weights.json', 'tools/ci-input-reads.json')


class Cap1071(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'tests').mkdir()
        for name in ('a', 'b'):
            (self.root / ('tests/test_%s.py' % name)).write_text('')
        self.weights = {'units': {'python_shards': 2, 'setup_minutes': .5,
            'python_minutes': {'tests/test_a.py': 20.125, 'tests/test_b.py': 2},
            'minutes': {'node-units': 2, 'deploy-refusals': 1}}}

    def test_1071_python_ceil_counts_setup_once_and_keeps_other_unit_caps(self):
        jobs = sh.jobs(self.root, self.weights)
        python = [job for job in jobs if job.get('python_shard')]
        self.assertEqual([job['timeout'] for job in python], [42, 30])
        self.assertEqual([job['minutes'] for job in python], [20.125, 2])
        self.assertEqual([job['timeout'] for job in jobs if not job.get('python_shard')], [4, 3])
        self.assertEqual(sorted(p for job in python for p in job['files']), sh.test_files(self.root))
        self.assertEqual(len(set(p for job in python for p in job['files'])), 2)

    def test_1071_floor_applies_to_small_empty_and_exact_boundary_deals(self):
        for minutes, setup in ((0, 0), (14.5, .5), (.1, .5)):
            with self.subTest(minutes=minutes, setup=setup):
                weights = copy.deepcopy(self.weights)
                weights['units'].update(python_shards=3, setup_minutes=setup,
                    python_minutes={'tests/test_a.py': minutes, 'tests/test_b.py': 0})
                python = [job for job in sh.jobs(self.root, weights) if job.get('python_shard')]
                self.assertTrue(any(not job['files'] for job in python))
                self.assertEqual([job['timeout'] for job in python], [30, 30, 30])

    def test_1071_completed_plan_preserves_python_matrix_caps_and_workflow_consumes_them(self):
        planned = sh.plan(self.root, 'push', {}, 'a' * 40, weights=self.weights)
        python = [job for job in planned['shards'] if job.get('python_shard')]
        self.assertEqual([job['timeout_minutes'] for job in python], [42, 30])
        self.assertTrue(all('timeout' not in job for job in python))
        self.assertEqual(next(job['timeout_minutes'] for job in planned['shards']
                              if job['name'] == 'wake replay'), 45)
        workflow = (ROOT / '.github/workflows/checks.yml').read_text()
        timeout = [line.strip() for line in workflow.splitlines()
                   if line.strip().startswith('timeout-minutes:')]
        self.assertEqual(timeout, ["timeout-minutes: ${{ startsWith(matrix.name, 'browser ') && 100 || matrix.timeout_minutes }}"])
        self.assertIn('include: ${{ fromJSON(needs.plan.outputs.shards) }}', workflow)

    def test_1071_overflow_in_doubled_deal_is_refused(self):
        self.weights['units']['python_minutes']['tests/test_a.py'] = 1e308
        with self.assertRaisesRegex(ValueError, 'invalid_dealt_minutes'):
            sh.jobs(self.root, self.weights)


class Guard1071(Binder987):
    def test_1071_exact_planning_paths_record_ordinary_in_real_cli_core_and_peer_read(self):
        for path in PLANNING:
            with self.subTest(path=path):
                self.assertEqual(guarded([path]), [])
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('synthetic planning input')
        head = self.commit()
        self.assertEqual(source_diff(self.repo, self.base, head), sorted(PLANNING))
        piece = self.piece([1])
        answer = self.cli(piece, self.base, head)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)
        freeze = self.shown(piece)['freeze']
        self.assertFalse(freeze['judged'])
        self.assertEqual(freeze['files'], sorted(PLANNING))
        self.assertEqual((freeze['base_commit'], freeze['head_commit']), (self.base, head))
        peer = self.store.view('agent-b', 'pipeline', {'workspace_id': 'w1'})
        self.assertEqual(next(p for p in peer['pieces'] if p['id'] == piece)['freeze'], freeze)

    def test_1071_judge_deploy_controller_and_neighbours_remain_guarded(self):
        protected = ['aim_next/judgment.py', 'tools/deploy.py', 'tools/release_check.py',
            'tools/ci_known_reds.py', 'tools/ci_input_reads.py', 'aim_next/migrations.py',
            '.github/workflows/checks.yml', '.github/workflows/verdict.yml',
            '.github/check-weights.json/child', '.github/check-weights.json.bak',
            '.github/other/check-weights.json']
        self.assertEqual(guarded(list(PLANNING) + protected), protected)
        for path in protected:
            if '/child' in path:
                continue  # lexical neighbour policy, not a second real file under a JSON file
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('synthetic protected input')
        head = self.commit()
        piece = self.piece([1])
        answer = self.cli(piece, self.base, head)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)
        self.assertTrue(self.shown(piece)['freeze']['judged'])

    def test_1071_renaming_guarded_deploy_to_ordinary_planner_keeps_guarded_deletion(self):
        (self.repo / 'tools/deploy.py').rename(self.repo / 'tools/unit_shards.py')
        head = self.commit()
        paths = source_diff(self.repo, self.base, head)
        self.assertEqual(paths, ['tools/deploy.py', 'tools/unit_shards.py'])
        self.assertEqual(guarded(paths), ['tools/deploy.py'])
        piece = self.piece([1])
        answer = self.cli(piece, self.base, head)
        self.assertEqual(answer.returncode, 0, answer.stdout + answer.stderr)
        self.assertTrue(self.shown(piece)['freeze']['judged'])


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(cls(name) for cls in (Cap1071, Guard1071)
        for name in loader.getTestCaseNames(cls) if name.startswith('test_1071_') and name in cls.__dict__)

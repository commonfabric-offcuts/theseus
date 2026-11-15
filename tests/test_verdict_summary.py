from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/verdict.yml'


class VerdictSummaryCase(unittest.TestCase):
    def render(self, validation, train, refusals='missing required step\n', event='push'):
        # Exercise the actual publishing decision, including its conclusion.
        section = WORKFLOW.read_text().split('      - name: Decide, and write the check run to publish\n', 1)[1]
        script = textwrap.dedent(section.split("<<'PY' >> \"$GITHUB_OUTPUT\"\n", 1)[1].split('          PY\n', 1)[0])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            producer = {'producer': {'run_id': 43679959376, 'run_attempt': 1, 'url': 'producer-url',
                                    'workflow_path': '.github/workflows/checks.yml', 'workflow_id': 1,
                                    'event': event, 'comparison_base': {'ref': 'release/live73'},
                                    'pull_request': {'base_ref': 'release/live73'}},
                        'controller': {'workflow_ref': 'controller-ref', 'workflow_sha': '508ca346', 'url': 'controller-url'}}
            for name, value in [('producer', producer), ('validation', validation), ('train', train)]:
                if value is not None:
                    (root / (name + '.json')).write_text(json.dumps(value))
            (root / 'refusals').write_text(refusals)
            subprocess.run([sys.executable, '-I', '-S', '-c', script], cwd=root,
                           env=dict(os.environ, HEAD_SHA='a18e8b1e', APPROVED_BASES='release/live73'),
                           check=True, capture_output=True, text=True)
            return json.loads((root / 'check-run.json').read_text())

    def test_early_refusal_names_revert_from_git_without_shipping_claim(self):
        train = {'head': 'a18e8b1e', 'pull_request': 36, 'items': [], 'unread': [],
                 'commits': [{'sha': 'd62cd6f1458f', 'subject': "Train 5: revert 398/399 (the quiet scrollbar), on Tony's ruling",
                              'items': [], 'pipeline': []}]}
        result = self.render({'passed': False, 'refused': 'missing required step'}, train)
        summary = result['output']['summary']
        self.assertEqual(result['conclusion'], 'failure')
        self.assertIn('missing required step', summary)
        self.assertIn('Train (git-only; validator returned no train): pull request #36, merge commit a18e8b1e, d62cd6f1 Train 5: revert 398/399', summary)
        self.assertIn('Items named by Pipeline trailers (git-only, not a shipping verdict): none', summary)
        self.assertNotIn('Items shipped:', summary)

    def test_no_validator_output_still_names_git_items_and_keeps_refusal(self):
        result = self.render(None, {'head': 'head', 'pull_request': 39, 'items': [464], 'commits': [], 'unread': []})
        self.assertEqual(result['conclusion'], 'failure')
        self.assertIn('pull request #39', result['output']['summary'])
        self.assertIn('not a shipping verdict): 464', result['output']['summary'])

    def test_validator_train_remains_authoritative(self):
        result = self.render({'passed': True, 'train': {'pull_request': 36, 'items': [],
                             'display_items': ['Revert 398/399'], 'merge_commit': 'head', 'items_source': 'trailers'}},
                             {'head': 'head', 'pull_request': 36, 'items': [], 'commits': [], 'unread': []}, refusals='')
        self.assertEqual(result['conclusion'], 'success')
        self.assertIn('Train: pull request #36, reverts 398/399', result['output']['summary'])
        self.assertNotIn('Train (git-only', result['output']['summary'])

    def test_missing_git_reading_is_explicit(self):
        result = self.render({'passed': False}, None)
        self.assertEqual(result['conclusion'], 'failure')
        self.assertIn('Train: neither the validator nor git gave a reading', result['output']['summary'])

    def test_pr_does_not_use_push_fallback(self):
        result = self.render({'passed': False}, {'head': 'head', 'items': [464]}, event='pull_request')
        self.assertNotIn('Train (git-only', result['output']['summary'])


if __name__ == '__main__':
    unittest.main()

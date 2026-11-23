from __future__ import annotations

import json
from pathlib import Path
import re
import unittest

from tools import mutant

ROOT = Path(__file__).resolve().parents[1]


class CardBoundaryActs(unittest.TestCase):
    """The two item396 protections reach current code independently of old ledger failures."""

    def setUp(self):
        acts = json.loads((ROOT / 'tests/acts.json').read_text())['acts']
        self.arrow, = [a for a in acts if a['item'] == 396 and a['act'].startswith('← at the very start')]
        self.next, = [a for a in acts if a['item'] == 396 and a['act'].startswith('⌘Return while a card')]

    def plan(self, act):
        return mutant.plan([(str(ROOT / name), old, new) for name, old, new in act['break']])

    def test_arrow_break_applies_to_current_owner(self):
        try:
            self.assertTrue(self.plan(self.arrow))
        except mutant.Refused as error:
            self.fail(str(error))

    def test_command_return_break_applies_to_current_owner(self):
        self.assertTrue(self.plan(self.next))

    def test_either_applied_break_keeps_the_other_independent(self):
        for act, other in [(self.arrow, self.next), (self.next, self.arrow)]:
            with self.subTest(act=act['act']):
                try:
                    changed = {path: after for path, _before, after in self.plan(act)}
                except mutant.Refused as error:
                    self.fail(str(error))
                for name, needle, _replacement in other['break']:
                    path = (ROOT / name).resolve()
                    self.assertEqual(changed.get(path, path.read_bytes()).decode().count(needle), 1)

    def test_both_filters_select_the_real_shared_native_case(self):
        harness = (ROOT / 'tests/notebook_sheet_native.mjs').read_text()
        names = [s.replace("\\'", "'") for s in re.findall(r"await check\('((?:\\.|[^'\\])*)'", harness)]
        selected = []
        for act in [self.arrow, self.next]:
            self.assertEqual(act['check']['native'], 'notebook')
            matches = [name for name in names if re.search(act['check']['case'], name)]
            self.assertEqual(len(matches), 1, matches)
            selected.append(matches[0])
        self.assertEqual(*selected)
        self.assertIn('⌘Return', selected[0])


if __name__ == '__main__':
    unittest.main()

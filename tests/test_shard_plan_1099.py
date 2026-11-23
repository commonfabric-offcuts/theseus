"""1099: a shard's required inventory is compared with the run's aggregate as a set, not as an ordered list."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('shard_plan_controller', ROOT / 'tools/ci_known_reds.py')
ci = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(ci)
RETAINED = json.loads((ROOT / 'tests/fixtures/item1099_required_inventories.json').read_text())


class ShardPlan(unittest.TestCase):
    def test_links_retained_inventories_differ_only_in_order(self):
        self.assertEqual(RETAINED['producer_run'], 45072395285)
        self.assertEqual(RETAINED['first_shard'], 'check-0')
        self.assertNotEqual(RETAINED['aggregate_required'], RETAINED['shard_required'])
        self.assertCountEqual(RETAINED['aggregate_required'], RETAINED['shard_required'])

    def test_the_same_steps_in_another_order_pass(self):
        ci.shard_plan(RETAINED['shard_required'], RETAINED['aggregate_required'])

    def test_a_shard_that_omits_a_required_step_is_refused(self):
        shard = [step for step in RETAINED['shard_required'] if step != 'python-units']
        with self.assertRaisesRegex(ci.Refused, 'shard required plan differs'):
            ci.shard_plan(shard, RETAINED['aggregate_required'])

    def test_a_shard_that_adds_an_unknown_step_is_refused(self):
        with self.assertRaisesRegex(ci.Refused, 'shard required plan differs'):
            ci.shard_plan(RETAINED['shard_required'] + ['native-unknown'], RETAINED['aggregate_required'])

    def test_a_duplicated_step_is_refused_as_a_duplicate(self):
        with self.assertRaisesRegex(ci.Refused, 'duplicate shard required steps'):
            ci.shard_plan(RETAINED['shard_required'] + [RETAINED['shard_required'][0]], RETAINED['aggregate_required'])

    def test_a_non_list_inventory_is_refused(self):
        with self.assertRaisesRegex(ci.Refused, 'shard required steps is not a list'):
            ci.shard_plan('deploy-refusals', RETAINED['aggregate_required'])


if __name__ == '__main__':
    unittest.main()

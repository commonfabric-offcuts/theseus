from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from tools import release_check
from tools import ci_input_reads as scoped


def fixture():
    # Synthetic graph, not a retained train or native execution.
    return {
        'tools/release_check.py': b'UNIT_STEPS = ("python-units", "node-units")\nNATIVE_STEPS = (NativeStep("one", "tests/one_native.mjs", ()), NativeStep("two", "tests/two_native.mjs", ()))\n',
        'tools/ci-input-reads.json': b'{}',
        'tests/one_native.mjs': b'import { x } from "./shared.mjs";\n',
        'tests/two_native.mjs': b'await check("two", async () => {});\n',
        'tests/shared.mjs': b'export const x = 1;\n',
        'tests/shared.test.mjs': b'import { x } from "./shared.mjs";\n',
        'aim_next/store.py': b'from __future__ import annotations\n',
        'web/app.mjs': b'export const x = 1;\n',
    }


class Reachability(unittest.TestCase):
    def compute(self, before, after):
        self.assertIsNotNone(scoped, 'actual input reachability API must exist')
        return scoped.scope_trees(before, after)

    def test_shared_helper_selects_every_reader_and_proves_omission(self):
        before = fixture(); after = dict(before, **{'tests/shared.mjs': b'export const x = 2;\n'})
        result = self.compute(before, after)
        self.assertIn('native-one', result['steps'])
        self.assertIn('node-units', result['steps'])
        self.assertNotIn('native-two', result['steps'])
        self.assertEqual(result['coverage']['native-two']['changed_inputs'], [])

    def test_product_inputs_are_never_external_or_empty(self):
        before = fixture(); after = dict(before, **{'web/app.mjs': b'export const x = 2;\n'})
        result = self.compute(before, after)
        self.assertEqual(set(result['steps']), set(result['required']))
        self.assertTrue(all('web/app.mjs' in row['changed_inputs'] for row in result['coverage'].values()))

    def test_new_and_deleted_helpers_use_both_trees(self):
        before = fixture(); after = dict(before)
        after['tests/new.mjs'] = after.pop('tests/shared.mjs')
        after['tests/one_native.mjs'] = b'import { x } from "./new.mjs";\n'
        after['tests/shared.test.mjs'] = b'import { x } from "./new.mjs";\n'
        result = self.compute(before, after)
        self.assertIn('native-one', result['steps']); self.assertIn('node-units', result['steps'])
        self.assertEqual(set(result['changed']), {'tests/shared.mjs', 'tests/new.mjs', 'tests/one_native.mjs', 'tests/shared.test.mjs'})

    def test_unknown_and_undeclared_reads_refuse(self):
        self.assertIsNotNone(scoped)
        before = fixture(); after = dict(before, **{'opaque.txt': b'unknown'})
        with self.assertRaisesRegex(scoped.Refused, 'unknown readers'):
            scoped.scope_trees(before, after)
        after = dict(before, **{'tests/shared.mjs': b'const x = readFileSync(dynamic);'})
        with self.assertRaisesRegex(scoped.Refused, 'undeclared'):
            scoped.scope_trees(before, after)

    def test_changed_declarations_and_discovery_select_all(self):
        for path in ('tools/ci-input-reads.json', 'tools/ci_input_reads.py'):
            before = fixture(); before[path] = b'{}' if path.endswith('.json') else b'# old\n'
            after = dict(before); after[path] += b'\n'
            result = self.compute(before, after)
            self.assertEqual(result['steps'], result['required'])

    def test_dynamic_product_declaration_keeps_real_product_edges(self):
        self.assertIsNotNone(scoped)
        from tools import ci_input_reads
        before = fixture(); path = 'tests/shared.mjs'
        before[path] = b'const x = readFileSync(dynamic);'
        calls, _ = ci_input_reads.read_calls(path, before[path].decode())
        before['tools/ci-input-reads.json'] = json.dumps({path: {key: {'scope': 'generated/system/product', 'inputs': []} for key in calls}}).encode()
        after = dict(before, **{'web/app.mjs': b'changed'})
        result = self.compute(before, after)
        self.assertIn('web/app.mjs', result['coverage']['native-one']['changed_inputs'])

    def test_python_package_hooks_and_nested_discovery_are_real_readers(self):
        before = fixture()
        before.update({'tests/pkg/__init__.py': b'from . import helper\n',
                       'tests/pkg/helper.py': b'x = 1\n', 'tests/pkg/test_case.py': b'x = 1\n'})
        after = dict(before, **{'tests/pkg/helper.py': b'x = 2\n'})
        result = self.compute(before, after)
        self.assertIn('tests/pkg/helper.py', result['coverage']['python-units']['changed_inputs'])
        self.assertIn('tests/pkg/__init__.py', scoped.python_files(before))
        self.assertIn('tests/pkg/test_case.py', scoped.python_files(before))
        after = dict(before, **{'tools/unknown.data': b'opaque'})
        with self.assertRaisesRegex(scoped.Refused, 'unknown readers'):
            scoped.scope_trees(before, after)


if __name__ == '__main__':
    unittest.main()

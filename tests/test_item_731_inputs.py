from __future__ import annotations

"""Item 731: source-reading mutation controls cannot escape CI's declared read boundary."""
import json
from pathlib import Path
import unittest

from tools.ci_input_reads import discover, read_calls


class InputBoundaryCase(unittest.TestCase):
    def test_item_731_mutation_source_reads_are_declared_and_removing_a_declaration_fails(self):
        root = Path(__file__).resolve().parents[1]
        helper = 'tests/fixtures/item_731_mutants.py'
        files = {name: (root / name).read_bytes() for name in
                 [helper, 'aim_next/dossier_order.py', 'aim_next/conversation.py']}
        declarations = json.loads((root / 'tools/ci-input-reads.json').read_text())
        calls, _ = read_calls(helper, files[helper].decode())
        self.assertTrue(calls)
        _, errors = discover(files, declarations)
        self.assertEqual(errors, [])
        signature = next(iter(calls))
        del declarations[helper][signature]
        _, errors = discover(files, declarations)
        self.assertTrue(any('undeclared file read' in error for error in errors), errors)

    def test_item_731_original_archive_is_explicitly_bound_to_live94_and_every_public_byte(self):
        import hashlib
        import tarfile
        folder = Path(__file__).parent / 'fixtures'
        manifest = json.loads((folder / 'item_731_original_web.json').read_text())
        archive = folder / 'item_731_original_web.tar.gz'
        self.assertEqual(manifest['source'], 'a958f7cdebe3743b9a6ebf63c11564629d737bce')
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), manifest['archive_sha256'])
        with tarfile.open(str(archive), 'r:gz') as packed:
            actual = {m.name[4:]:hashlib.sha256(packed.extractfile(m).read()).hexdigest() for m in packed.getmembers() if m.isfile()}
        self.assertEqual(actual, manifest['files'])



if __name__ == '__main__':
    unittest.main()

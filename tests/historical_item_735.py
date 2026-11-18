from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parent / 'fixtures'))
from item_735_runtime import Item735Runtime
from aim_next import web_build
from test_stacks import StackCase


class Item735Case(StackCase):
    def test_core_destination_is_earliest_own_available_message_even_on_partial_page(self):
        root = self.post('Public dossier')
        self.participation('other-reader', True)
        hidden = self.post('Private reply', actor='other-reader', reply_to=root, whisper=True, addressees=['agent-a'])
        early = self.post('Earliest own star', reply_to=root)
        late = self.post('Later own star', reply_to=root)
        self.committed(self.star(hidden, actor='other-reader'))
        self.committed(self.star(root, actor='agent-a'))
        self.committed(self.star(late))
        self.committed(self.star(early))
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'direction': 'before', 'limit': 1})
        self.assertEqual([item['id'] for item in page['items']], [late])
        self.assertEqual(page['items'][0]['stack_position']['root_id'], root)
        self.assertEqual(page['items'][0]['stack_position']['starred'], [early, late])
        self.assertIn('error', self.store.view('owner', 'source', {'source_ref': {'kind': 'message', 'id': hidden}}))
        self.committed(self.star(root))
        self.assertEqual(self.store.view('owner', 'stack_positions', {'topic_id': 't1', 'message_ids': [root]})['items'][0]['stack_position']['starred'], [root, early, late])
        self.committed(self.star(root, on=False, revision=1))
        self.committed(self.star(early, on=False, revision=1))
        self.committed(self.star(late, on=False, revision=1))
        pos = self.store.view('owner', 'stack_positions', {'topic_id': 't1', 'message_ids': [root]})
        self.assertEqual(pos['items'][0]['stack_position']['starred'], [])

    def test_exact_base_real_mutants_and_all_byte_restoration_wrapper(self):
        root = self.path.parent / 'runtime-735'
        root.mkdir()
        build = web_build.load(Path(__file__).resolve().parents[1] / 'web')
        script_src = ' '.join(["'self'"] + ["'%s'" % digest for digest in build.script_hashes])
        server = SimpleNamespace(build=build, csp="default-src 'self';script-src " + script_src + ';style-src self;')
        runtime = Item735Runtime(server, root, 'isolated-735', 'fixture-reader')
        for phase in ('base', 'no-reveal', 'wrong-destination', 'no-scroll', 'touch-gate'):
            receipt = runtime.select(phase)
            self.assertNotEqual(receipt['stamp'], build.stamp)
            self.assertEqual(receipt['core_identity'], {'instance_id': 'isolated-735', 'actor': 'fixture-reader'})
            if phase != 'base':
                mutation = receipt['mutation']
                self.assertNotEqual(mutation['before_sha256'], mutation['after_sha256'])
                self.assertEqual(receipt['hashes'][mutation['file']], mutation['after_sha256'])
            restored = runtime.select('restored')
            self.assertTrue(restored['restored'])
            self.assertEqual(restored['hashes'], receipt['candidate_hashes'])
            self.assertIs(server.build, build)


if __name__ == '__main__':
    unittest.main()

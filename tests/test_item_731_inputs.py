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



class ConversationSeedCase(unittest.TestCase):
    def test_item_731_native_seed_uses_the_actual_conversation_answerer(self):
        import subprocess
        import sys
        self.assertTrue(sys.pycache_prefix)
        fixture = subprocess.Popen([sys.executable, '-X', 'pycache_prefix=' + sys.pycache_prefix,
                                    'tests/fixtures/ui_http.py', '--freshness', '--agent-colors'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        serial = 0
        def call(method, **args):
            nonlocal serial
            serial += 1
            fixture.stdin.write(json.dumps(dict(args, id=serial, method=method)) + '\n')
            fixture.stdin.flush()
            result = json.loads(fixture.stdout.readline())
            self.assertNotIn('failure', result, result)
            return result['answer']
        try:
            topic = call('coordinator', operation_id='731-seed-coordinator', coordinator='aim-core', team=['fixture-notebook-agent'])['topic_id']
            ids = {}
            def post(name, reply=None):
                ids[name] = call('agent_message', operation_id='731-seed-' + name, topic_id=topic, source='topic', sender='aim-core',
                                 addressees=['fixture-person'], body='Exact 731 ' + name,
                                 **({'reply_to':ids[reply]} if reply else {}))['result']['message_id']
            post('b'); post('b1','b'); post('a'); post('a1','a')
            def page():
                return call('agent_view', actor='fixture-person', name='topic_messages', args={'topic_id':topic,'direction':'before','limit':100})['items']
            before = {item['stack_position']['root_id']:item['stack_position']['order_key'] for item in page()}
            post('b2','b')
            after = page()
            self.assertEqual({item['stack_position']['root_id']:item['stack_position']['order_key'] for item in after}, before)
            self.assertGreater(before[ids['a']], before[ids['b']])
            record = next(item for item in after if item['id']==ids['b2'])
            self.assertEqual((record['topic_id'],record['body'],record['author_id']), (topic,'Exact 731 b2','aim-core'))
        finally:
            fixture.stdin.close()
            code = fixture.wait(timeout=15)
            errors = fixture.stderr.read()
            fixture.stdout.close(); fixture.stderr.close()
            self.assertEqual((code,errors),(0,''))


if __name__ == '__main__':
    unittest.main()

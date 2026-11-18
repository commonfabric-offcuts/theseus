from __future__ import annotations

from tests import own_receipt_fixtures as portable

"""Exact additive 717 binding; all positive receipt/API rows are SYNTHETIC.

Git source and the independent auditor facts are real read-only inputs. These
controls do not launch a native case or establish genuine own-case acceptance.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import unittest

from tests import test_tools_own_receipt_families as families
from tools import base_move as b, own_case_receipt as own

ASSEMBLY = 'e6f6e5ec30b553511a839252d3aff73bbc12819d'
TREE = 'cdc7364d9372c3453ee3d3dc3d706647d585664a'
TESTS_TREE = 'ed9493b450303989e6c12c560b38ee0c75101e52'
FACTS = portable.evidence() / 'train45-live96-e6f6e5ec/final-test-inputs.json'
FACTS_SHA256 = 'd970677dbda12ce88884c67bfcf4b976c1f286e6fe0aa61ad9761853b20267b5'


class AssemblyControls(families.FamilyControls):
    @classmethod
    def setUpClass(cls):
        cls.head, cls.tree = ASSEMBLY, TREE
        cls.wrapper = families.wrapper_for(cls.head, cls.step, cls.item)

    def test_selected_binding_and_all_source_pins(self):
        raw = FACTS.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), FACTS_SHA256)
        facts = json.loads(raw)
        self.assertEqual((facts['assembly'], facts['tree'], facts['tests_tree']),
                         (ASSEMBLY, TREE, TESTS_TREE))
        self.assertEqual(facts['prior_profile'], own.FAMILIES['717'])
        self.assertEqual(facts['source_changes'], ['tests/stack_native.mjs'])
        keys, derived = self.f.consume()
        self.assertEqual(keys, self.f.expected)
        self.assertEqual(derived['derived']['schema_binding'],
                         {'producer': ASSEMBLY, 'tests_tree': TESTS_TREE})
        self.assertEqual(derived['derived']['source_sha256'],
                         dict(facts['sources'], **{p: own.SOURCES[p] for p in
                              (own.WORKFLOW, 'tools/native.py', 'tools/release_check.py')}))
        for path, digest in facts['sources'].items():
            actual = subprocess.check_output(portable.git_command() + ['show', ASSEMBLY + ':' + path])
            self.assertEqual(hashlib.sha256(actual).hexdigest(), digest)

    def test_one_byte_change_to_each_pinned_input_refuses(self):
        # Keep the independently selected tests tree fixed: no source pin may
        # be bypassed by a matching tree or a raw report's self hash.
        for path in list(json.loads(FACTS.read_bytes())['sources']) + [
                own.WORKFLOW, 'tools/native.py', 'tools/release_check.py']:
            with self.subTest(path=path):
                self.source_change(path, lambda raw: raw + b'\n', 'source/command')

    def test_identity_changes_refuse(self):
        for key, path, value, reason in [
                ('run', ['run_attempt'], 2, 'run identity'),
                ('jobs', ['jobs', 0, 'run_attempt'], 2, 'job identity'),
                ('artifact', ['workflow_run', 'head_sha'], '0' * 40, 'artifact provenance')]:
            with self.subTest(key=key, path=path):
                before = b.document(self.f.binding['api'][key])
                old = before
                for part in path:
                    old = old[part]
                self.f.change_api(key, path, value)
                self.f.refuses(reason)
                self.f.change_api(key, path, old)

    def test_manifest_cannot_authorize_source(self):
        self.source_change(own.SPEC, lambda raw: json.dumps(dict(json.loads(raw),
                           sources={'tests/stack_native.mjs': '0' * 64})).encode(), 'invalid fields')

    def test_other_reviewed_family_tree_does_not_select_this_profile(self):
        from unittest import mock
        original = b.ask
        def changed(git, *args):
            if args == ('rev-parse', '--verify', self.wrapper + ':tests'):
                return own.FAMILIES['715']['tests_tree']
            return original(git, *args)
        with mock.patch.object(b, 'ask', side_effect=changed):
            self.f.refuses('independently bound tests schema')


class AssemblyReading717(AssemblyControls, unittest.TestCase):
    item, step = '717', 'reading'


class AssemblyWebkitReading717(AssemblyControls, unittest.TestCase):
    item, step = '717', 'webkit-reading'

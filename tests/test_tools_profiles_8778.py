from __future__ import annotations

"""Actual Git inputs with explicitly SYNTHETIC receipt/API/ZIP positives.

No native execution, source admission or independently authenticated pass.
"""
import copy
import hashlib
import json
import subprocess
import unittest
from unittest import mock

from tests import test_tools_own_receipt_families as families
from tools import base_move as b, own_case_receipt as own

PROFILES = {'715': {'head': 'd9b93adfabed0e960a14febf9975de294429248b',
         'tree': '4a26a9ec3d3770650bcf8e9eca36c5c23f403d50',
         'tests_tree': 'cc5a7e74dc16adf9c81fa633fd27b2047f40eb39',
         'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
                     'tests/webkit_native.mjs': '4db15fd3c3315c1fd0f47ec97263abda40cb42b3edaaa585ac4d43fe1a05e3ae',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
                     'tests/outcome_rail_native.mjs': '5835f965cf4035e56524fe37c627e7f1abb1d4de63c834c0bf9494cb6c00b9b8',
                     'tests/outline_stars_native.mjs': '6c196bb9fad58b3c506fed333cc4c5cafecc8efec70aeee391f10cdf967c0ee9',
                     'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}},
 '717': {'head': 'dddf00e171fa3924f12e9a1c4f20cac5a6602d3c',
         'tree': '231373687757f80fe495194157b39f6935b3b550',
         'tests_tree': 'aa3a1417a26e171e33d89e778c34edd16dd24ef4',
         'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
                     'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
                     'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
                     'tests/stack_native.mjs': '55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70',
                     'tests/dossier_promises_native.mjs': '1d2472157ec5f3cbeb4d3bb9c18c0336d08a1f7920fa1e52e5a669b14787b4a0'}}}
SNAPSHOTS = ['tests/dossier_promises_native.mjs', 'tests/topic_reading_native.mjs',
    'tests/reader_persistence_native.mjs', 'tests/webkit_native.mjs', 'web/index.html', 'web/aim.css',
    'web/layout.mjs', 'web/arrow-reach.mjs', 'web/message-menu.mjs', 'web/dossier-cover.mjs',
    'web/reader.mjs', 'web/stack-look.css', 'aim_next/cover_promises.py', 'aim_next/cover_values.py',
    'aim_next/covers.py', 'aim_next/cli_covers.py']


class ComposedControls(families.FamilyControls):
    @classmethod
    def setUpClass(cls):
        cls.head, cls.tree = PROFILES[cls.item]['head'], PROFILES[cls.item]['tree']
        cls.wrapper = families.wrapper_for(cls.head, cls.step, cls.item)

    def setUp(self):
        super().setUp()
        if self.item == '717':
            self.report['hashes'].update({p: hashlib.sha256(subprocess.check_output(
                ['git', 'show', self.head + ':' + p])).hexdigest() for p in SNAPSHOTS})
            self.sync()

    def test_exact_selected_binding_and_literals(self):
        profile = PROFILES[self.item]
        keys, facts = self.f.consume()
        self.assertEqual(keys, self.f.expected)
        self.assertEqual(facts['derived']['schema_binding'],
                         {'producer': self.head, 'tests_tree': profile['tests_tree']})
        self.assertEqual(facts['derived']['source_sha256'], dict(profile['sources'], **{
            p: own.SOURCES[p] for p in (own.WORKFLOW, 'tools/native.py', 'tools/release_check.py')}))
        for path, expected in profile['sources'].items():
            raw = subprocess.check_output(['git', 'show', self.head + ':' + path])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)

    def test_each_selected_source_byte_is_required(self):
        for path in list(PROFILES[self.item]['sources']) + [own.WORKFLOW, 'tools/native.py', 'tools/release_check.py']:
            with self.subTest(path=path):
                self.source_change(path, lambda raw: raw + b'\n', 'source/command')

    def test_sibling_family_tree_refuses(self):
        original = b.ask
        def changed(git, *args):
            if args == ('rev-parse', '--verify', self.wrapper + ':tests'):
                return PROFILES['715' if self.item == '717' else '717']['tests_tree']
            return original(git, *args)
        with mock.patch.object(b, 'ask', side_effect=changed):
            self.f.refuses('independently bound tests schema')

    def test_manifest_cannot_choose_adapter(self):
        self.source_change(own.SPEC, lambda raw: json.dumps(dict(json.loads(raw),
            sources=PROFILES[self.item]['sources'])).encode(), 'invalid fields')

    def test_exit_one_refuses(self):
        self.members['cases.json'] = json.dumps([{'case': 'item ' + self.item, 'exit': 1}]).encode()
        self.archive(); self.f.refuses('execution filter/exit')

    def test_no_716_support(self):
        self.source_change(own.SPEC, lambda raw: raw.replace(('item ' + self.item).encode(), b'item 716'), 'step/filter')


class FinalReading717(ComposedControls, unittest.TestCase):
    item, step = '717', 'reading'

    def test_every_supplemental_hash_is_validated(self):
        for path in SNAPSHOTS:
            with self.subTest(path=path):
                old = self.report['hashes'][path]
                self.report['hashes'][path] = '0' * 64
                self.sync(); self.f.refuses('native source hash differs')
                self.report['hashes'][path] = old


class FinalWebkit717(FinalReading717):
    item, step = '717', 'webkit-reading'


class ActualRail715(ComposedControls, unittest.TestCase):
    item, step = '715', 'rail'


class ActualWebkit715(ComposedControls, unittest.TestCase):
    item, step = '715', 'webkit-rail'

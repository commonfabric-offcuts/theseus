from __future__ import annotations

"""Synthetic parser controls against frozen 652 source, never a hosted receipt.

The API is an in-memory stub. No candidate program is imported or executed.
The genuine 651 controls remain in test_tools_own_receipt.
"""
import copy
import json
import subprocess
import tempfile
import unittest
from unittest import mock

from tests import test_tools_own_receipt as genuine
from tools import base_move as b, own_case_receipt as own

ASSEMBLY = '10c4ca6ecfa8e77e0986b0b16838c60a5a9cacc4'
TREE = '16d1cd391839b66e2cd2927200ecacaecca7542c'
HELPER = 'tests/card_editor_652.mjs'
COMPOSE = 'tests/reader_compose_native.mjs'


class Synthetic652(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # A local, unreferenced wrapper object. It is never pushed or executed.
        cls.temp = tempfile.TemporaryDirectory(prefix='synthetic-own-652-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.git = staticmethod(lambda *args: subprocess.run(['git'] + list(args), capture_output=True, text=True))
        workflow = own.source_bytes(cls.git, 'c4af1c667aeb54b193f483ac7f8385c6895eafb2', [own.WORKFLOW])[own.WORKFLOW]
        spec = json.dumps({'step': 'compose', 'cases': ['item 652'], 'label': 'synthetic652', 'snapshot': ASSEMBLY}).encode()
        # Explicit Git-only environment; no credential/profile/environment reads.
        git_env = {'PATH': '/usr/bin:/bin', 'GIT_INDEX_FILE': cls.temp.name + '/index',
                   'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
                   'GIT_AUTHOR_NAME': 'Synthetic parser fixture', 'GIT_AUTHOR_EMAIL': 'synthetic@example.invalid',
                   'GIT_COMMITTER_NAME': 'Synthetic parser fixture', 'GIT_COMMITTER_EMAIL': 'synthetic@example.invalid',
                   'GIT_AUTHOR_DATE': '2026-11-17T00:00:00Z', 'GIT_COMMITTER_DATE': '2026-11-17T00:00:00Z'}
        def git(*args, data=None):
            return subprocess.run(['git'] + list(args), input=data, capture_output=True, env=git_env, check=True).stdout.decode().strip()
        git('read-tree', ASSEMBLY)
        for path, data in [(own.WORKFLOW, workflow), (own.SPEC, spec)]:
            blob = git('hash-object', '-w', '--stdin', data=data)
            git('update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + path)
        tree = git('write-tree')
        cls.wrapper = git('commit-tree', tree, '-p', ASSEMBLY, data=b'SYNTHETIC parser fixture; not a Pool run\n')

    def setUp(self):
        self.f = genuine.GenuinePoolReceipt()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        f.assembly, f.tree = ASSEMBLY, TREE
        branch = 'pool/synthetic652-' + ASSEMBLY[:10]
        f.binding['wrapper'] = self.wrapper
        for key in ('run', 'jobs', 'artifact'):
            data = copy.deepcopy(b.document(f.binding['api'][key]))
            if key == 'run':
                data.update(head_sha=self.wrapper, head_branch=branch)
            elif key == 'jobs':
                data['jobs'][0].update(head_sha=self.wrapper, head_branch=branch, name=branch)
            else:
                data['workflow_run'].update(head_sha=self.wrapper, head_branch=branch)
            f.binding['api'][key] = f.save('synthetic-' + key + '.json', data)
            endpoint = {'run': 'actions/runs/44221559712', 'jobs': 'actions/runs/44221559712/attempts/1/jobs',
                        'artifact': 'actions/artifacts/14391686887'}[key]
            f.answers[endpoint] = data
        record = copy.deepcopy(b.document(f.binding['record']))
        record.update(branch=branch, pool_commit=self.wrapper, snapshot=ASSEMBLY)
        record['run'].update(headBranch=branch, headSha=self.wrapper)
        record['jobs'][0]['name'] = branch
        f.binding['record'] = f.save('synthetic-record.json', record)
        snap = copy.deepcopy(b.document(f.receipt['snapshot']))
        snap['commit'] = ASSEMBLY
        snap['tree_before']['head'] = snap['tree_after']['head'] = ASSEMBLY
        f.receipt['snapshot'] = f.save('synthetic-snapshot.json', snap)
        f.freeze()
        name = 'item 652 synthetic parser control'
        f.expected = [('native-compose', name, None, e) for e in ('chromium', 'webkit')]
        def change(m):
            report = json.loads(m['c1/evidence/native.json'])
            report.update(results=[{'name': e + ' ' + name, 'passed': True, 'ms': 1} for e in ('chromium', 'webkit')], shots=[])
            m['c1/evidence/native.json'] = json.dumps(report).encode()
            m['cases.json'] = b'[{"case":"item 652","exit":0}]'
            step = {'name': 'native-compose', 'exit': 0, 'passed': True,
                    'counts': {'tests': 2, 'pass': 2, 'fail': 0, 'failed': [], 'browser_closed': True}}
            m['c1.log'] = (json.dumps(step) + '\ncompose exit 0 /Users/runner/work/_temp/pool/c1\n').encode()
            m['c1/native-compose.log'] = ('\n'.join('PASS ' + r['name'] for r in report['results']) + '\n2 passed, 0 failed\n').encode()
        f.replace_archive(change)

    def source_change(self, path, transform, why):
        original = own.source_bytes
        def changed(git, head, paths):
            sources = original(git, head, paths)
            if path in sources:
                sources[path] = transform(sources[path])
            return sources
        with mock.patch.object(own, 'source_bytes', side_effect=changed):
            self.f.refuses(why)

    def test_synthetic_652_parser_control(self):
        keys, facts = self.f.consume()
        self.assertEqual(keys, self.f.expected)
        self.assertEqual(facts['derived']['command']['filter'], 'item 652')
        self.assertEqual(facts['derived']['source_sha256'][HELPER], '11b2e0570b7c6be12515a0551f75a49af593cd2c95cb84211e26b186f31716a6')
        self.assertEqual(facts['derived']['engine_counts'], {'chromium': 1, 'webkit': 1})
        self.assertEqual(facts['originals'], {k: self.f.receipt[k] for k in ('snapshot', 'step', 'report', 'log', 'pool')})

    def test_unknown_652_helper(self):
        self.source_change(HELPER, lambda v: v + b'// unknown convention\n', 'source/command.*card_editor_652')

    def test_unknown_652_compose(self):
        self.source_change(COMPOSE, lambda v: v.replace(b'`${engine} ${name}`', b'name'), 'source/command.*reader_compose')

    def test_652_source_cannot_select_651_filter(self):
        self.source_change(own.SPEC, lambda v: v.replace(b'item 652', b'item 651'), 'step/filter')

    def test_unknown_item_filter(self):
        self.source_change(own.SPEC, lambda v: v.replace(b'item 652', b'item 717'), 'step/filter')

    def test_broad_filter_refuses(self):
        self.source_change(own.SPEC, lambda v: v.replace(b'item 652', b'item 65'), 'step/filter')

    def test_filter_union_refuses(self):
        self.source_change(own.SPEC, lambda v: v.replace(b'item 652', b'item 652|item 651'), 'step/filter')

    def test_wrong_652_execution_filter(self):
        self.f.replace_archive(lambda m: m.update({'cases.json': b'[{"case":"item 651","exit":0}]'}))
        self.f.refuses('execution filter/exit')

    def test_652_rejects_caught_line_from_other_convention(self):
        self.f.replace_archive(lambda m: m.update({'c1/native-compose.log': b'CAUGHT item 652 invented\n' + m['c1/native-compose.log']}))
        self.f.refuses('raw PASS')

    def test_652_exact_item_boundary(self):
        self.f.report_change(lambda r: [x.update(name=x['name'].replace('item 652 ', 'item 6520 ')) for x in r['results']], sync=True)
        self.f.expected = [(s, n.replace('item 652 ', 'item 6520 '), p, e) for s, n, p, e in self.f.expected]
        self.f.refuses('case filter')

    def test_652_wrong_obligation_phase(self):
        self.f.expected = [(s, n, 'run', e) for s, n, p, e in self.f.expected]
        self.f.refuses('obligations differ')

    def test_652_missing_both_engines_identity(self):
        self.f.expected.extend([('native-compose', 'item 652 absent independently required case', None, e) for e in ('chromium', 'webkit')])
        self.f.refuses('obligations differ')

    def test_652_duplicate_identity(self):
        self.f.report_change(lambda r: r['results'].append(dict(r['results'][0])), sync=True)
        self.f.refuses('duplicate Pool case identity')

    def test_652_unknown_row_schema(self):
        self.f.report_change(lambda r: r['results'][0].update(engine='chromium'))
        self.f.refuses('invalid fields')

    def test_652_cleanup_refuses(self):
        self.f.report_change(lambda r: r.update(browserClosed=False))
        self.f.refuses('phase or teardown')

    def test_652_source_hashes_are_derived_from_frozen_bytes(self):
        _, facts = self.f.consume()
        for path, digest in facts['derived']['source_sha256'].items():
            self.assertEqual(b.digest(own.source_bytes(self.f.git, self.wrapper, [path])[path]), digest)
        for path, oid in facts['derived']['snapshot']['inputs'].items():
            self.assertEqual(b.ask(self.f.git, 'rev-parse', ASSEMBLY + ':' + path).strip(), oid)

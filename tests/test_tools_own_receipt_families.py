from __future__ import annotations

from tests import own_receipt_fixtures as portable

"""Narrow 717/715 parser controls. Positive Pool/API fixtures are SYNTHETIC.

Original full producer reports are used only as negative parsing evidence.
No candidate module, browser, fixture, Pool or network request is executed.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

from tests import test_tools_own_receipt as genuine
from tools import base_move as b, own_case_receipt as own

# Independent fixture constants, not read from the candidate adapter's claims.
PRODUCERS = {
    '717': ('f31e319994ecc96c5565828a53fde75c01bd3386', 'e2dfb9e663611cbf4303a52cd00578d3652c5347'),
    '715': ('5903d8b8fac63b8b4e6d191dbc8d59db5094d9b0', '8da417bd928698add7bbace7cc91f8b02799b6d9'),
}
EVIDENCE = portable.evidence()
ORIGINALS = {
    'reading': EVIDENCE / 'train45-full-44219718033/check-0/native/reading',
    'webkit-reading': EVIDENCE / 'train45-full-44219718033/check-2/native/webkit-reading',
    'rail': EVIDENCE / 'train46-full-44226768831/check-1/native/rail',
    'webkit-rail': EVIDENCE / 'train46-full-44226768831/check-3/native/webkit-rail',
}


def wrapper_for(head, step, item):
    """Local Git object only; never a real producer or pushed reference."""
    with tempfile.TemporaryDirectory(prefix='synthetic-family-index-') as temp:
        env = {'PATH': '/usr/bin:/bin', 'GIT_INDEX_FILE': temp + '/index',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
               'GIT_AUTHOR_NAME': 'Synthetic parser fixture', 'GIT_AUTHOR_EMAIL': 'synthetic@example.invalid',
               'GIT_COMMITTER_NAME': 'Synthetic parser fixture', 'GIT_COMMITTER_EMAIL': 'synthetic@example.invalid',
               'GIT_AUTHOR_DATE': '2026-11-17T00:00:00Z', 'GIT_COMMITTER_DATE': '2026-11-17T00:00:00Z'}
        def git(*args, data=None):
            return subprocess.run(portable.git_command() + list(args), input=data, capture_output=True, env=env, check=True).stdout.decode().strip()
        workflow = subprocess.check_output(portable.git_command() + ['show', 'c4af1c667aeb54b193f483ac7f8385c6895eafb2:' + own.WORKFLOW])
        spec = json.dumps({'step': step, 'cases': ['item ' + item], 'label': 'synthetic' + step, 'snapshot': head}).encode()
        git('read-tree', head)
        for path, raw in [(own.WORKFLOW, workflow), (own.SPEC, spec)]:
            blob = git('hash-object', '-w', '--stdin', data=raw)
            git('update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + path)
        return git('commit-tree', git('write-tree'), '-p', head, data=b'SYNTHETIC family parser fixture; not a Pool run\n')


class FamilyControls:
    @classmethod
    def setUpClass(cls):
        cls.head, cls.tree = PRODUCERS[cls.item]
        cls.wrapper = wrapper_for(cls.head, cls.step, cls.item)

    def setUp(self):
        self.f = genuine.GenuinePoolReceipt()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        f.assembly, f.tree = self.head, self.tree
        branch = 'pool/synthetic' + self.step + '-' + self.head[:10]
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
        record.update(branch=branch, pool_commit=self.wrapper, snapshot=self.head)
        record['run'].update(headBranch=branch, headSha=self.wrapper)
        record['jobs'][0]['name'] = branch
        f.binding['record'] = f.save('synthetic-record.json', record)
        snap = copy.deepcopy(b.document(f.receipt['snapshot']))
        snap['commit'] = self.head
        snap['tree_before']['head'] = snap['tree_after']['head'] = self.head
        f.receipt['snapshot'] = f.save('synthetic-snapshot.json', snap)
        self.webkit = self.step.startswith('webkit-')
        self.engine = 'webkit' if self.webkit else 'chromium'
        self.mode = self.step.replace('webkit-', '')
        self.harness = 'tests/webkit_native.mjs' if self.webkit else 'tests/reader_persistence_native.mjs'
        self.name = self.mode + ' item ' + self.item + ' synthetic parser control'
        self.log_member = 'c1/native-' + self.step + '.log'
        self.report = {'mode': '--' + self.mode, 'hashes': {self.harness: hashlib.sha256(subprocess.check_output(portable.git_command() + ['show',self.head+':'+self.harness])).hexdigest()},
                       'results': [{'name': self.name, 'passed': True}], 'observations': [],
                       'fixtureExitCode': 0, 'fixtureErrors': '', 'browserClosed': True}
        if self.webkit:
            self.report['results'][0].update(engine='webkit', ms=1)
            self.report.update(engine='webkit', webkitVersion='synthetic', chromeArgumentIgnored='/synthetic/chrome', qualifications=[], skipped={})
        else:
            self.report.update(baseline=False, legacyAdmission=False, finalHealth={'fatal': []}, teardown=[])
        self.phases = {'started': 1, 'fixtureReady': 2, 'browserReady': 3, 'reportingStarted': 8, 'reportingEnded': 9,
                       'cases': [{'name': self.name, 'started': 4, 'actionStarted': 5, 'actionEnded': 6, 'cleanupEnded': 7}]}
        f.expected = [('native-' + self.step, self.name, None, self.engine)]
        self.sync()

    def sync(self):
        rows = self.report['results']
        if self.webkit:
            logs = rows
        else:
            logs = []
            for row in rows:
                logs.extend([{'case': row['name'], 'started': '2026-11-17T00:00:00.000Z'},
                             dict(row, started='2026-11-17T00:00:00.000Z', finished='2026-11-17T00:00:01.000Z')])
        self.step_record = {'name': 'native-' + self.step, 'exit': 0, 'passed': True,
                            'counts': {'tests': len(rows), 'pass': len(rows), 'fail': 0, 'failed': [], 'browser_closed': True}}
        self.members = {'cases.json': json.dumps([{'case': 'item ' + self.item, 'exit': 0}]).encode(),
                        'c1.log': (json.dumps(self.step_record) + '\n' + self.step + ' exit 0 /Users/runner/work/_temp/pool/c1\n').encode(),
                        'c1/evidence/native.json': json.dumps(self.report).encode(),
                        self.log_member: ('\n'.join(json.dumps(r) for r in logs) + '\n').encode()}
        if not self.webkit:
            self.members['c1/evidence/phases.json'] = json.dumps(self.phases).encode()
        self.archive()

    def archive(self):
        f = self.f
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            for name, raw in self.members.items():
                z.writestr(name, raw)
        data = stream.getvalue()
        f.binding['artifact']['archive'] = f.save('SYNTHETIC.zip', data)
        f.change_api('artifact', ['digest'], 'sha256:' + hashlib.sha256(data).hexdigest())
        for key, name in [('step','c1.log'), ('report','c1/evidence/native.json'), ('log',self.log_member)]:
            f.receipt[key] = f.save('SYNTHETIC-' + key, self.members[name])
        f.freeze()

    def source_change(self, path, transform, why):
        original = own.source_bytes
        def changed(git, head, paths):
            data = original(git, head, paths)
            if path in data:
                data[path] = transform(data[path])
            return data
        with mock.patch.object(own, 'source_bytes', side_effect=changed):
            self.f.refuses(why)

    def test_synthetic_family_control(self):
        keys, facts = self.f.consume()
        self.assertEqual(keys, self.f.expected)
        self.assertEqual(facts['derived']['command'], {'driver':'tools/native.py', 'step':self.step, 'filter':'item '+self.item,
            'harness':self.harness, 'flags':['--'+self.mode],
            'dynamic_paths':'node/chrome/playwright from workflow environment; output RUNNER_TEMP/pool/c1'})
        self.assertEqual(facts['derived']['engine_counts'], {self.engine: 1})
        self.assertEqual(facts['derived']['schema_binding']['producer'], self.head)
        self.assertEqual(facts['originals'], {k:self.f.receipt[k] for k in ('snapshot','step','report','log','pool')})

    def test_frozen_tests_subtree_required(self):
        original = b.ask
        def changed(git, *args):
            if args == ('rev-parse','--verify',self.wrapper+':tests'):
                return '0'*40
            return original(git,*args)
        with mock.patch.object(b,'ask',side_effect=changed):
            self.f.refuses('independently bound tests schema')

    def test_reporter_bytes_required(self):
        self.source_change(self.harness,lambda raw:raw+b'// unknown reporter\n','source/command')

    def test_family_helper_bytes_required(self):
        helper = 'tests/dossier_promises_native.mjs' if self.item=='717' else 'tests/outline_stars_native.mjs'
        self.source_change(helper,lambda raw:raw+b'// unknown helper\n','source/command')

    def test_exact_filter_required(self):
        self.source_change(own.SPEC,lambda raw:raw.replace(('item '+self.item).encode(),b'item 71|item 652'),'step/filter')

    def test_step_cannot_cross_family(self):
        other = 'rail' if self.item=='717' else 'reading'
        self.source_change(own.SPEC,lambda raw:json.dumps(dict(json.loads(raw),step=other)).encode(),'independently bound tests schema')

    def test_raw_bytes_must_match_archive(self):
        self.f.receipt['report'] = self.f.save('drift',b'{}')
        self.f.refuses('raw report differs from archive')

    def test_wrong_execution_command(self):
        self.members['c1.log'] = self.members['c1.log'].replace((self.step+' exit').encode(),b'compose exit')
        self.archive(); self.f.refuses('native command/exit')

    def test_phase_cleanup_required(self):
        if self.webkit:
            self.report['browserClosed'] = False
        else:
            self.phases['cases'][0]['cleanupEnded'] = 100
        self.sync(); self.f.refuses('phase')

    def test_independent_obligations_required(self):
        self.f.expected.append(('native-'+self.step,self.name+' missing',None,self.engine))
        self.f.refuses('obligations differ')

    def test_raw_source_claims_are_verified(self):
        self.report['hashes'][self.harness] = '0'*64
        self.sync(); self.f.refuses('native source hash differs')

    def test_boundary_is_exact(self):
        self.report['results'][0]['name'] = self.name.replace('item '+self.item,'item '+self.item+'0')
        self.sync(); self.f.refuses('filter boundary')

    def test_unknown_engine_or_row_schema_refuses(self):
        self.report['results'][0]['engine'] = 'chromium' if self.webkit else 'webkit'
        self.sync(); self.f.refuses('engine|invalid fields')

    def test_ordered_log_required(self):
        self.members[self.log_member] = b''
        self.archive(); self.f.refuses('ordered')

    def test_expected_phase_is_not_invented(self):
        self.f.expected = [('native-'+self.step,self.name,'run',self.engine)]
        self.f.refuses('obligations differ')

    def test_original_mode_is_required(self):
        self.report['mode'] = '--compose'
        self.sync(); self.f.refuses('phase or teardown')

    def test_fixture_boolean_zero_refuses(self):
        self.report['fixtureExitCode'] = False
        self.sync(); self.f.refuses('phase or teardown')

    def test_failed_row_is_never_an_own_pass(self):
        self.report['results'][0]['passed'] = False
        self.sync(); self.f.refuses('raw case failed')

    def test_duplicate_execution_refuses(self):
        self.members['cases.json'] = json.dumps([{'case':'item '+self.item,'exit':0}]*2).encode()
        self.archive(); self.f.refuses('single execution')

    def test_additional_case_field_refuses(self):
        self.report['results'][0]['expectedFailure'] = True
        self.sync(); self.f.refuses('invalid fields')

    def test_raw_counts_refuse_boolean(self):
        self.step_record['counts']['tests'] = True
        self.members['c1.log'] = (json.dumps(self.step_record)+'\n'+self.step+' exit 0 /Users/runner/work/_temp/pool/c1\n').encode()
        self.archive(); self.f.refuses('raw count')

    def test_wrong_row_or_clock_type_refuses(self):
        if self.webkit:
            self.report['results'][0]['ms'] = True
        else:
            self.phases['cases'][0]['cleanupEnded'] = True
        self.sync(); self.f.refuses('duration|case/cleanup phases')

    def test_log_clock_or_result_must_agree(self):
        if self.webkit:
            self.members[self.log_member] = self.members[self.log_member].replace(b'"ms": 1',b'"ms": 2')
        else:
            self.members[self.log_member] = self.members[self.log_member].replace(b'2026-11-17T00:00:01.000Z',b'2026-11-16T00:00:01.000Z')
        self.archive(); self.f.refuses('ordered|timestamp')

    def test_original_genuine_red_report_refuses(self):
        # Original bytes in, no transformation or authentication claim. A full
        # producer red cannot stand in for the absent final-base own receipt.
        original = (ORIGINALS[self.step]/'native.json').read_bytes()
        report = json.loads(original)
        item_rows = [r for r in report['results'] if 'item '+self.item in r['name']]
        self.assertEqual(len(item_rows), 14 if self.item=='717' else 100)
        self.assertEqual(sum(r['passed'] is False for r in item_rows), (4 if self.webkit else 1) if self.item=='717' else 6)
        contents = {'c1/evidence/native.json': original}
        with self.assertRaisesRegex(b.Refused,'raw case failed'):
            own.family_results(contents, self.step_record, self.step, 'item '+self.item, self.f.expected)


class Reading717(FamilyControls, unittest.TestCase):
    item, step = '717', 'reading'


class WebkitReading717(FamilyControls, unittest.TestCase):
    item, step = '717', 'webkit-reading'


class Rail715(FamilyControls, unittest.TestCase):
    item, step = '715', 'rail'


class WebkitRail715(FamilyControls, unittest.TestCase):
    item, step = '715', 'webkit-rail'

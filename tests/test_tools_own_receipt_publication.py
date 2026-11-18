from __future__ import annotations

"""Bounded publication controls over genuine retained bytes; no native runs.

API variants are local negative/clock fixtures, never authenticated new runs.
The authentic corrected 652 package remains red, with its original ZIP intact.
"""
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import subprocess
import unittest

from tests import test_tools_own_receipt as genuine
from tools import base_move as b, own_case_receipt as own


class PublicationSkew(unittest.TestCase):
    def setUp(self):
        if not os.environ.get('OWN_RECEIPT_EVIDENCE'):
            self.fail('OWN_RECEIPT_EVIDENCE must name the genuine 651 package')
        self.f = genuine.GenuinePoolReceipt()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.upload = b.document(self.f.binding['api']['jobs'])['jobs'][0]['steps'][5]
        self.meta = b.document(self.f.binding['api']['artifact'])

    def created(self, offset):
        finished = datetime.fromisoformat(self.upload['completed_at'].replace('Z', '+00:00'))
        value = (finished + timedelta(seconds=offset)).isoformat().replace('+00:00', 'Z')
        self.f.change_api('artifact', ['created_at'], value)
        return value

    def test_normal_and_bounded_late_keep_raw_timestamps(self):
        for offset in (-1, 0, 1, 2):
            with self.subTest(seconds_after_completion=offset):
                created = self.created(offset)
                keys, facts = self.f.consume()
                self.assertEqual(keys, self.f.expected)
                self.assertEqual(len(keys), 586)
                publication = facts['derived']['publication']
                self.assertEqual(publication['artifact_created_at'], created)
                self.assertEqual(publication['upload_started_at'], self.upload['started_at'])
                self.assertEqual(publication['upload_completed_at'], self.upload['completed_at'])
                self.assertEqual(publication['max_late_seconds'], 2)
                self.assertEqual(publication['seconds_after_upload_completed'], offset)
                self.assertEqual(publication['within_upload'], offset <= 0)
                self.assertEqual(publication['not_before'], self.upload['started_at'])
                limit = datetime.fromisoformat(self.upload['completed_at'].replace('Z', '+00:00')) + timedelta(seconds=2)
                self.assertEqual(publication['not_after'], limit.isoformat())
                self.assertEqual(b.document(self.f.binding['api']['artifact'])['created_at'], created)
                self.assertEqual(b.document(self.f.binding['api']['jobs'])['jobs'][0]['steps'][5], self.upload)

    def test_three_seconds_late_refuses(self):
        self.created(3)
        self.f.refuses('attempt/upload differs')

    def test_fraction_beyond_two_seconds_refuses(self):
        self.created(2.000001)
        self.f.refuses('attempt/upload differs')

    def test_before_upload_started_refuses(self):
        self.f.change_api('artifact', ['created_at'], self.upload['started_at'])
        self.f.consume()  # Inclusive lower boundary remains valid.
        early = datetime.fromisoformat(self.upload['started_at'].replace('Z', '+00:00')) - timedelta(seconds=1)
        self.f.change_api('artifact', ['created_at'], early.isoformat())
        self.f.refuses('attempt/upload differs')

    def test_missing_malformed_and_naive_timestamps_refuse(self):
        for key, path in [('artifact', ['created_at']),
                          ('jobs', ['jobs', 0, 'steps', 5, 'started_at']),
                          ('jobs', ['jobs', 0, 'steps', 5, 'completed_at'])]:
            for value in (None, 1, '', 'not-a-time', '2026-02-30T05:32:29Z', '2026-11-18T05:32:29'):
                with self.subTest(key=key, path=path, value=value):
                    self.f.change_api('artifact', ['created_at'], self.meta['created_at'])
                    for field in ('started_at', 'completed_at'):
                        self.f.change_api('jobs', ['jobs', 0, 'steps', 5, field], self.upload[field])
                    self.f.change_api(key, path, value)
                    self.f.refuses('attempt/upload timestamps invalid')
            with self.subTest(key=key, missing=True):
                data = b.document(self.f.binding['api'][key])
                node = data
                for part in path[:-1]:
                    node = node[part]
                del node[path[-1]]
                self.f.binding['api'][key] = self.f.save('missing-' + key + '.json', data)
                endpoint = ('actions/artifacts/14391686887' if key == 'artifact'
                            else 'actions/runs/44221559712/attempts/1/jobs')
                self.f.answers[endpoint] = data
                self.f.freeze()
                self.f.refuses('attempt/upload timestamps invalid')
                self.f.change_api(key, path, self.meta['created_at'] if key == 'artifact' else self.upload[path[-1]])

    def test_reversed_upload_refuses(self):
        self.created(1)
        self.f.change_api('jobs', ['jobs', 0, 'steps', 5, 'started_at'],
                          b.document(self.f.binding['api']['artifact'])['created_at'])
        self.f.refuses('attempt/upload differs')

    def test_late_wrong_api_identity_refuses_at_identity(self):
        variants = [
            ('run', ['run_attempt'], 2, 'run identity'),
            ('run', ['head_sha'], '0' * 40, 'run identity'),
            ('run', ['repository', 'full_name'], 'wrong/repo', 'run identity'),
            ('run', ['head_repository', 'full_name'], 'wrong/repo', 'run identity'),
            ('workflow', ['path'], '.github/workflows/wrong.yml', 'workflow identity'),
            ('jobs', ['jobs', 0, 'run_attempt'], 2, 'job identity'),
            ('jobs', ['jobs', 0, 'head_branch'], 'wrong-branch', 'job identity'),
            ('jobs', ['jobs', 0, 'steps', 5, 'conclusion'], 'failure', 'steps incomplete'),
            ('artifact', ['name'], 'wrong', 'artifact provenance'),
            ('artifact', ['digest'], 'sha256:' + '0' * 64, 'artifact provenance'),
            ('artifact', ['workflow_run', 'id'], 1, 'artifact provenance'),
            ('artifact', ['workflow_run', 'head_sha'], '0' * 40, 'artifact provenance'),
            ('artifact', ['workflow_run', 'head_branch'], 'wrong', 'artifact provenance'),
            ('artifact', ['workflow_run', 'repository_id'], 1, 'artifact provenance'),
            ('artifact', ['workflow_run', 'head_repository_id'], 1, 'artifact provenance'),
        ]
        for key, path, value, why in variants:
            with self.subTest(key=key, path=path):
                self.created(1)
                original = b.document(self.f.binding['api'][key])
                node = original
                for part in path:
                    node = node[part]
                self.f.change_api(key, path, value)
                self.f.refuses(why)
                self.f.change_api(key, path, node)

    def test_late_wrong_branch_record_parent_tree_source_filter_and_hashes(self):
        # Existing provenance controls must fail at their own assertions even
        # with creation inside the late interval; no clock-based bypass.
        methods = ['test_wrong_wrapper_parent', 'test_wrong_wrapper_tree',
                   'test_wrong_spec_filter', 'test_wrong_spec_snapshot',
                   'test_wrong_command', 'test_wrong_native_source',
                   'test_wrong_compose_source', 'test_wrong_helper_source',
                   'test_wrong_release_source', 'test_archive_byte_digest',
                   'test_raw_report_digest', 'test_raw_report_not_archive',
                   'test_snapshot_dirty', 'test_snapshot_wrong_head',
                   'test_original_pool_record_digest', 'test_original_pool_record_snapshot',
                   'test_retained_api_differs', 'test_extra_execution_folder',
                   'test_duplicate_execution']
        for method in methods:
            with self.subTest(control=method):
                f = genuine.GenuinePoolReceipt()
                f.setUp()
                try:
                    finished = b.document(f.binding['api']['jobs'])['jobs'][0]['steps'][5]['completed_at']
                    late = (datetime.fromisoformat(finished.replace('Z', '+00:00')) + timedelta(seconds=1)).isoformat()
                    f.change_api('artifact', ['created_at'], late)
                    getattr(f, method)()
                finally:
                    f.doCleanups()

    def test_late_wrong_spec_branch_refuses(self):
        self.created(1)
        self.f.source_change(own.SPEC, lambda v: v.replace(b'"label": "', b'"label": "wrong-'), 'spec branch')

    def test_late_native_exit_one_refuses(self):
        self.created(1)
        self.f.test_wrong_exit()

    def test_late_wrong_raw_filter_refuses_before_timing(self):
        self.created(3)
        self.f.replace_archive(lambda m: m.update({'cases.json': b'[{"case":"item 652","exit":0}]'}))
        self.f.refuses('execution filter/exit')

    def test_candidate_window_refuses(self):
        self.created(3)
        self.f.binding['max_late_seconds'] = 999
        self.f.freeze()
        self.f.refuses('invalid fields')


class AuthenticCorrectedRed(unittest.TestCase):
    def test_authentic_red_advances_only_to_original_native_exit_refusal(self):
        root = Path('/Users/commonfabric/.local/share/theseus/fable-tools/coordinator-20261117/train44-corrected-own-read')
        receipt = b.loads((root / 'own-receipt.json').read_bytes())
        binding = b.document(receipt['pool'])
        archive = b.artifact(binding['artifact']['archive'])
        self.assertEqual(len(archive), 43346849)
        self.assertEqual(b.digest(archive), 'f8f821cea1615df2f0a10758c714a4d0f522d6438b8e30c7e196e29e1f24fa0f')
        expected = [(r['step'], r['case'], r['phase'], r['engine']) for r in
                    b.loads((root / 'own-obligations-PROPOSED.json').read_bytes())]
        answers = {key: b.document(ref) for key, ref in binding['api'].items()}
        paths = {'actions/runs/44243138904': 'run', 'actions/workflows/419227320': 'workflow',
                 'actions/runs/44243138904/attempts/1/jobs': 'jobs', 'actions/artifacts/14401261575': 'artifact'}
        class API:
            def get(self, path):
                return answers[paths[path[len('repos/' + genuine.REPOSITORY + '/'):]]]
        git = lambda *args: subprocess.run(['git', '--git-dir=' + str(root / 'git')] + list(args), capture_output=True, text=True)
        self.assertEqual(answers['artifact']['created_at'], '2026-11-18T05:32:29Z')
        self.assertEqual(answers['jobs']['jobs'][0]['steps'][5]['completed_at'], '2026-11-18T05:32:28Z')
        report = b.document(receipt['report'])
        self.assertEqual(len(report['results']), 456)
        self.assertEqual(sum(r['passed'] is True for r in report['results']), 455)
        with self.assertRaisesRegex(b.Refused, 'Pool execution filter/exit differs'):
            own.validate(receipt, git, API(), genuine.REPOSITORY,
                         '7c4e13ba506c9eb4443ebe70202d8ee490db7bcc',
                         'f21f186b7ee8482935844ee7142d87939590b04a', expected)

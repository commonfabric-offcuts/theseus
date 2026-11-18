from __future__ import annotations

"""Fully synthetic authenticated-fact controls: no hosted calls or deployment.

All API facts and archives are fabricated under one disposable root. The actual
retained49 read-only facts live in the external evidence, never in this fixture.
"""
import copy
import difflib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from tools import base_move as b, grouped_admission as g


class Fixture:
    head, tree, workflow = 'a' * 40, 'b' * 40, 'c' * 40
    repo = 'synthetic/offline'

    def __init__(self, root, partial=True, red=True):
        self.root = Path(root); self.serial = 0; self.answers = {}
        self.judgment = {'audit': 'synthetic-judgment'}
        self.product = {'head': self.head, 'tree': self.tree, 'parents': ['d' * 40]}
        self.inputs = {g.HARNESS: b'original harness\n'}
        self.wf = b'name: Checks\non:\n  workflow_dispatch:\n'
        self.inputs[g.ce.WORKFLOW] = self.wf
        self.rows = [{'phase': phase, 'engine': engine, 'name': engine + ' ' + name}
                     for phase, engine, name in [('runItem721', 'chromium', 'kept'), ('run', 'chromium', 'replayed'),
                                                 ('run', 'webkit', 'new')]]
        self.inventory = {'rows': self.rows, 'hashes': {g.HARNESS: b.digest(self.inputs[g.HARNESS])}}
        self.plan = g.collector.partition(self.inventory, self.product, retained=['runItem721:chromium'] if partial else [])
        self.anchor = {'run': 1, 'attempt': 1, 'tested_merge': {'sha': 'e' * 40, 'tree': self.tree,
                       'first_parent': 'd' * 40, 'second_parent': self.head},
                       'base_at_run': {'ref': 'synthetic-base', 'sha': 'd' * 40}, 'controller': {'immutable': 'synthetic'}}
        original = self.inputs[g.HARNESS]; patched = b'instrumented harness\n'
        delta = ''.join(difflib.unified_diff(original.decode().splitlines(True), patched.decode().splitlines(True),
                         fromfile='product/' + g.HARNESS, tofile='instrument/' + g.HARNESS)).encode()
        self.package = {'product_harness': self.file(original), 'patched_harness': self.file(patched),
                        'patch': self.file(delta), 'producer': {n: self.file(('synthetic-' + n).encode()) for n in g.PRODUCER},
                        'workflow': self.file(self.wf), 'workflow_head': self.workflow,
                        'commands': {x['id']: ['synthetic-python', 'synthetic-wrapper', x['id']] for x in self.plan['groups']}}
        self.package['review'] = self.review(self.package, 'source-patch', 'synthetic-patch-review')
        self.packet = {'version': 1, 'product': self.product, 'original_anchor': self.anchor,
                       'package': self.doc(self.package), 'partition': self.doc(self.plan), 'inventory': self.doc(self.inventory),
                       'originals': [], 'groups': []}
        self.packet['inventory_review'] = self.review({'product': self.product, 'inventory': self.packet['inventory']},
                                                     'source-inventory', 'synthetic-inventory-review')
        self.false_rows = []; self.receipts = []; self.members = {}
        if partial:
            self.anchor['partial_dispatch'] = {'checked_source': self.head, 'checked_tree': self.tree,
                'run': '20', 'attempt': '1', 'workflow_api_head': self.workflow,
                'original_source': 'f' * 40, 'original_run': 1, 'original_attempt':1, 'release_base':'d'*40,
                'version':1, 'requested_source':self.head, 'parents':self.product['parents'], 'workflow_sha':self.workflow,
                'workflow_ref':self.repo+'/'+g.ce.WORKFLOW+'@refs/heads/synthetic'}
            progress = [{'name': self.rows[0]['name'], 'passed': not red}, {'name': self.rows[1]['name'], 'passed': not red}]
            if red:
                for row in progress:
                    row.update(error='synthetic retained false', expectedFailure=True, mutationCaught=True)
            self.false_rows = [{'origin': 'original', 'row': r} for r in progress if r['passed'] is False]
            members = {'progress.jsonl': b'\n'.join(b.canonical(r) for r in progress) + b'\n',
                       'phases.json': b.canonical({'completedPhases': self.plan['retained_phases'], 'browserClosed': True, 'harnessCompleted': False, 'plannedPhases': list(dict.fromkeys(r['phase']+':'+r['engine'] for r in self.rows))}),
                       'later.log': b'synthetic later failures; no final closure',
                       'hashes.json': b.canonical(self.inventory['hashes']),
                       'dispatch.json': b.canonical(self.anchor['partial_dispatch'])}
            orig = self.archive(members, 20)
            retired = self.archive({'retired.json': b.canonical({'original_archive_sha256': orig['archive']['sha256'],
                        'producer_retired': True, 'browser_closed': True, 'fixtures_closed': True, 'source_restored': True})}, 21, job_name='retire-original-compose-779')
            self.packet['originals'] = [{'binding': orig, 'progress': 'progress.jsonl', 'phases': 'phases.json',
                'log': 'later.log', 'hashes': 'hashes.json', 'dispatch': 'dispatch.json',
                'retirement': {'binding': retired, 'member': 'retired.json'}}]
        for i, group in enumerate(self.plan['groups']):
            gid = group['id']; rows = [{'name': r['name'], 'passed': True} for r in group['cases']]
            engines = [{'engine': group['engine'], 'version': 'synthetic-1'}]
            binding = {'product': self.product, 'original_harness_sha256': b.digest(original),
                       'instrumented_harness_sha256': b.digest(patched),
                       'instrument_sha256': self.package['producer']['compose_deadline_775.mjs']['sha256'],
                       'supervisor_sha256': self.package['producer']['compose_worker_775.mjs']['sha256'],
                       'wrapper_sha256': self.package['producer']['run_compose_group.py']['sha256'],
                       'actual_runtime': {'browser_engines': engines}}
            phase = group['phase'] + ':' + group['engine'] + '/group:' + gid
            report = {'hashes': {g.HARNESS: b.digest(patched)}, 'harnessCompleted': False, 'scope775': {'originalWholeCompleted': False, 'groupCompleted': True,
                'group': gid, 'source': self.product, 'cases_sha256': group['cases_sha256'], 'runtime': engines,
                'completedCases': [r['name'] for r in group['cases']]}, 'plannedPhases': [phase], 'completedPhases': [phase],
                'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None,
                'shortFixture': {'exitCode': 0, 'exitSignal': None}, 'results': rows}
            receipt = {'group': gid, 'source': self.product, 'cases_sha256': group['cases_sha256'], 'complete': True,
                       'cleanup': True, 'results': [dict(r, phase=group['phase'], engine=group['engine']) for r in rows],
                       'planned_cases': group['cases'], 'exit': 0, 'passed': True, 'binding': binding}
            cert = {'version': 1, 'run': 30, 'attempt': 1, 'workflow_head': self.workflow,
                    'workflow_sha256': self.package['workflow']['sha256'], 'job': 300 + i, 'group': gid,
                    'product': self.product, 'package_sha256': b.digest(b.canonical(self.package)),
                    'command': self.package['commands'][gid], 'origins': ['http://127.0.0.1:%d' % (10000+i*2+j) for j in range(2)],
                    'checkout': str(self.root / ('checkout-%d' % i)), 'source_restored': True, 'producer_retired': True}
            report['originalPlannedPhases'] = list(dict.fromkeys(r['phase'] + ':' + r['engine'] for r in self.rows))
            report['scope775']['origins'] = cert['origins']
            binding['actual_runtime']['fixture_origins'] = cert['origins']
            binding['actual_runtime']['source_checkout'] = cert['checkout']
            members = {'admission779.json': b.canonical(cert), 'group.json': b.canonical(group),
                       'group-receipt.json': b.canonical(receipt), 'native.json': b.canonical(report),
                       'source-binding.json': b.canonical(binding), 'native-compose.log': ('%d passed, 0 failed\n' % len(rows)).encode()}
            entry = {'group': gid, 'binding': self.archive(members, 30, 300 + i, gid)}
            self.packet['groups'].append(entry); self.members[gid] = members; self.receipts.append(receipt)
        self.packet['collector'] = self.doc(g.collector.collect({'groups': self.plan['groups']}, self.receipts))
        self.dispositions = {'false_rows': self.false_rows, 'records': [self.doc({'reviewer': 'auditor',
                'record': 'synthetic-existing-disposition-%d' % i, 'ground': 'synthetic exact disposition',
                'category': 'expected-mutant', 'observed': r}) for i, r in enumerate(self.false_rows)]}
        self.packet['dispositions'] = self.doc(self.dispositions)

    def file(self, raw):
        self.serial += 1; p = self.root / ('file-%d' % self.serial); p.write_bytes(raw)
        return {'path': str(p), 'sha256': b.digest(raw)}

    def doc(self, value):
        return self.file(b.canonical(value))

    def review(self, value, kind, record):
        return self.doc({'version': 1, 'reviewer': 'auditor', 'record': record,
                         'kind': kind, 'body_sha256': b.digest(b.canonical(value))})

    def archive(self, members, run_id, job_id=200, job_name=None):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            for name, raw in members.items(): z.writestr(name, raw)
        raw = stream.getvalue(); ref = self.file(raw); artifact_id = self.serial + 1000
        run = {'id': run_id, 'run_attempt': 1, 'head_sha': self.workflow, 'head_branch': 'synthetic', 'event': 'workflow_dispatch',
               'name': 'Checks', 'path': g.ce.WORKFLOW, 'status': 'completed', 'conclusion': 'success', 'workflow_id': 99,
               'repository': {'full_name': self.repo, 'id': 7}, 'head_repository': {'full_name': self.repo, 'id': 7}}
        job = {'id': job_id, 'run_id': run_id, 'run_attempt': 1, 'head_sha': self.workflow, 'status': 'completed',
               'name': job_name or 'synthetic-job-%d' % job_id, 'conclusion': 'success', 'completed_at': '2026-01-01T00:03:00Z',
               'steps': [{'name': 'Keep the evidence', 'status': 'completed', 'conclusion': 'success', 'started_at': '2026-01-01T00:01:00Z'}]}
        self.answers['repos/%s/actions/runs/%d' % (self.repo, run_id)] = run
        jobs_path = 'repos/%s/actions/runs/%d/attempts/1/jobs?per_page=100' % (self.repo, run_id)
        jobs = self.answers.setdefault(jobs_path, {'total_count': 0, 'jobs': []})
        jobs['jobs'] = [j for j in jobs['jobs'] if j['id'] != job_id] + [job]; jobs['total_count'] = len(jobs['jobs'])
        self.answers['repos/%s/actions/workflows/99' % self.repo] = {'id': 99, 'name': 'Checks', 'path': g.ce.WORKFLOW}
        self.answers['repos/%s/actions/artifacts/%d' % (self.repo, artifact_id)] = {'id': artifact_id, 'name': 'check-%d' % job_id,
             'expired': False, 'size_in_bytes': len(raw), 'digest': 'sha256:' + b.digest(raw), 'created_at': '2026-01-01T00:02:00Z',
             'workflow_run': {'id': run_id, 'head_sha': self.workflow, 'head_branch': 'synthetic', 'repository_id': 7, 'head_repository_id': 7}}
        return {'run': run_id, 'attempt': 1, 'run_head': self.workflow, 'workflow_head': self.workflow, 'event': 'workflow_dispatch', 'job': job_id,
                'job_name': job['name'], 'id': artifact_id, 'name': 'check-%d' % job_id, 'archive': ref}

    def alter_group(self, member, change):
        entry = self.packet['groups'][0]; members = self.members[entry['group']]
        value = b.loads(members[member]); change(value); members[member] = b.canonical(value)
        entry['binding'] = self.archive(members, 30, 300, entry['group'])

    def validate(self, mode='continuation'):
        packet = copy.deepcopy(self.packet)
        packet['review'] = self.review(packet, 'compose-admission', 'synthetic-admission-review')
        with patch.object(g, 'enumerate_source', return_value=self.inventory), patch.object(g.b, 'tree', return_value=self.tree), \
             patch.object(g.b, 'parents', return_value=self.product['parents']), \
             patch.object(g.ce, 'git_bytes', side_effect=lambda git, head, path: self.inputs[path]):
            return g.validate(self.doc(packet), self.judgment, None, SimpleNamespace(get=lambda p: copy.deepcopy(self.answers[p])),
                              self.repo, self.head, self.anchor, mode)


class GroupedAdmission779(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='synthetic-admission779-'); self.addCleanup(self.tmp.cleanup)

    def fixture(self, **kw): return Fixture(self.tmp.name, **kw)

    def test_partial_false_rows_and_cleanup_uncertainty_survive_complete_union(self):
        got = self.fixture().validate()
        self.assertTrue(got['complete']); self.assertFalse(got['passed']); self.assertFalse(got['admitted'])
        self.assertEqual(len(got['raw_false']), 2); self.assertEqual(len(got['replay_overlap']), 1)
        self.assertFalse(got['original_cleanup'][0]['final_cleanup'])
        self.assertTrue(got['original_cleanup'][0]['phases']['browserClosed'])

    def test_future_fullchecks_binds_actual_775_collector(self):
        f = self.fixture(partial=False)
        f.anchor['tested_merge']['sha'] = f.head
        f.anchor['tested_merge']['second_parent'] = f.workflow
        f.anchor['run'] = 30
        for row in f.packet['groups']: row['binding']['event'] = 'pull_request'
        f.answers['repos/%s/actions/runs/30' % f.repo]['event'] = 'pull_request'
        self.assertTrue(f.validate('fullChecks')['complete'])
        bad = b.document(f.packet['collector']); bad['passed'] = False; f.packet['collector'] = f.doc(bad)
        with self.assertRaisesRegex(b.Refused, 'genuine 775 collector'): f.validate('fullChecks')

    def test_missing_duplicate_unknown_wrong_phase_engine_source_case_and_body_refuse(self):
        changes = [('missing', lambda p: p['groups'].pop()), ('duplicate', lambda p: p['groups'].append(p['groups'][0])),
                   ('unknown', lambda p: p['groups'][0].update(group='unknown'))]
        for name, change in changes:
            with self.subTest(name=name):
                f = self.fixture(); change(f.packet)
                with self.assertRaises(b.Refused): f.validate()
        for field, value in [('name', 'chromium unknown'), ('phase', 'wrong'), ('engine', 'webkit'), ('passed', False)]:
            with self.subTest(field=field):
                f = self.fixture(); f.alter_group('native.json', lambda v: v['results'][0].update({field: value}))
                with self.assertRaises(b.Refused): f.validate()

    def test_raw_cleanup_timeout_unretired_and_engine_forgery_refuse(self):
        changes = [('native.json', lambda v: v.update(browserClosed=False)),
                   ('native.json', lambda v: v['scope775'].update(groupCompleted=False)),
                   ('admission779.json', lambda v: v.update(producer_retired=False)),
                   ('admission779.json', lambda v: v.update(source_restored=False)),
                   ('admission779.json', lambda v: v.update(command=['forged'])),
                   ('admission779.json', lambda v: v.update(origins=['http://127.0.0.1:9991','http://127.0.0.1:9992'])),
                   ('source-binding.json', lambda v: v.update(original_harness_sha256='f'*64))]
        for member, change in changes:
            with self.subTest(member=member, change=str(change)):
                f = self.fixture(); f.alter_group(member, change)
                with self.assertRaises(b.Refused): f.validate()

    def test_provenance_run_attempt_api_body_and_upload_refuse(self):
        for field, value in [('digest', 'sha256:'+'0'*64), ('expired', True), ('name', 'wrong'), ('created_at', '2026-01-01T00:00:00Z')]:
            with self.subTest(field=field):
                f = self.fixture(); bind = f.packet['groups'][0]['binding']
                f.answers['repos/%s/actions/artifacts/%d' % (f.repo, bind['id'])][field] = value
                with self.assertRaises(b.Refused): f.validate()

    def test_false_rows_not_dropped_or_waived_without_existing_exact_disposition(self):
        f = self.fixture(); f.dispositions['false_rows'].pop(); f.packet['dispositions'] = f.doc(f.dispositions)
        with self.assertRaisesRegex(b.Refused, 'false rows'): f.validate()
        f = self.fixture(); f.dispositions['records'].pop(); f.packet['dispositions'] = f.doc(f.dispositions)
        with self.assertRaisesRegex(b.Refused, 'dispositions'): f.validate()

    def test_candidate_inventory_cannot_omit_source_case(self):
        f = self.fixture(); fake = copy.deepcopy(f.inventory); fake['rows'].pop(); f.packet['inventory'] = f.doc(fake)
        with self.assertRaisesRegex(b.Refused, 'independently enumerated'): f.validate()

    def test_source_anchor_and_review_body_are_not_equivalence(self):
        f = self.fixture(); f.packet['original_anchor'] = dict(f.anchor, run=999)
        with self.assertRaisesRegex(b.Refused, 'original/controller'): f.validate()
        f = self.fixture(); f.package['workflow_head'] = '0' * 40; f.packet['package'] = f.doc(f.package)
        with self.assertRaisesRegex(b.Refused, 'review body'): f.validate()

    def test_original_retirement_cannot_promote_stale_browser_checkpoint(self):
        f = self.fixture(); entry = f.packet['originals'][0]
        retired = {'original_archive_sha256': entry['binding']['archive']['sha256'], 'producer_retired': False,
                   'browser_closed': True, 'fixtures_closed': True, 'source_restored': True}
        entry['retirement']['binding'] = f.archive({'retired.json': b.canonical(retired)}, 21, job_name='retire-original-compose-779')
        with self.assertRaisesRegex(b.Refused, 'original cleanup/unretired'): f.validate()

    def test_finished_native_report_cannot_hide_timed_out_job(self):
        f = self.fixture(); bind = f.packet['groups'][0]['binding']
        jobs = f.answers['repos/%s/actions/runs/30/attempts/1/jobs?per_page=100' % f.repo]['jobs']
        next(j for j in jobs if j['id'] == bind['job'])['conclusion'] = 'timed_out'
        with self.assertRaisesRegex(b.Refused, 'timed-out/unretired'): f.validate()

    def test_original_phase_inventory_and_group_completed_case_ids_must_match(self):
        f = self.fixture(); f.alter_group('native.json', lambda v: v['originalPlannedPhases'].pop())
        with self.assertRaisesRegex(b.Refused, 'planned phase inventory'): f.validate()
        f = self.fixture(); f.alter_group('native.json', lambda v: v['scope775']['completedCases'].pop())
        with self.assertRaisesRegex(b.Refused, 'completed source cases'): f.validate()

    def test_record_retains_digest_and_raw_false_count_without_claiming_pass(self):
        proof = self.fixture().validate(); stored = g.record(proof)
        self.assertEqual(stored['raw_false_count'], 2)
        self.assertEqual(stored['raw_false_sha256'], b.digest(b.canonical(proof['raw_false'])))
        self.assertEqual(stored['evidence'], proof['evidence'])
        self.assertFalse(stored['admitted']); self.assertFalse(stored['passed'])

    def test_partition_cannot_invent_unbounded_case_or_producer_deadline(self):
        f = self.fixture(); f.plan['groups'][0]['wall_seconds'] = 999999
        f.packet['partition'] = f.doc(f.plan)
        with self.assertRaisesRegex(b.Refused, 'producer bound'): f.validate()

    def test_grouped_api_pages_are_complete_bounded_and_duplicate_checked(self):
        f = self.fixture()
        path = 'repos/%s/actions/runs/30/attempts/1/jobs?per_page=100' % f.repo
        first = copy.deepcopy(f.answers[path]['jobs'][0])
        jobs = [dict(first, id=1000+i) for i in range(126)]
        f.answers[path] = {'total_count':126,'jobs':jobs[:100]}
        f.answers[path+'&page=2'] = {'total_count':126,'jobs':jobs[100:]}
        api = SimpleNamespace(get=lambda p:copy.deepcopy(f.answers[p]))
        binding = f.packet['groups'][0]['binding']
        self.assertEqual(len(g.ce.run_fact(binding,api,f.repo,f.workflow,'workflow_dispatch',grouped=True)[1]),126)
        with self.assertRaisesRegex(b.Refused,'incomplete job page'):
            g.ce.run_fact(binding,api,f.repo,f.workflow,'workflow_dispatch')
        f.answers[path+'&page=2']['jobs'][0] = jobs[0]
        with self.assertRaisesRegex(b.Refused,'job identity'):
            g.ce.run_fact(binding,api,f.repo,f.workflow,'workflow_dispatch',grouped=True)
        f.answers[path+'&page=2']['jobs'].pop()
        with self.assertRaisesRegex(b.Refused,'incomplete subsequent'):
            g.ce.run_fact(binding,api,f.repo,f.workflow,'workflow_dispatch',grouped=True)

    def test_other_original_producer_cannot_be_relabelled_as_this_partial(self):
        f = self.fixture(); entry = f.packet['originals'][0]
        with zipfile.ZipFile(io.BytesIO(b.artifact(entry['binding']['archive']))) as z:
            members = {name:z.read(name) for name in z.namelist()}
        wrong = dict(f.anchor['partial_dispatch'], original_run=999)
        f.anchor['partial_dispatch'] = wrong
        members['dispatch.json'] = b.canonical(wrong)
        entry['binding'] = f.archive(members,20)
        retired = {'original_archive_sha256':entry['binding']['archive']['sha256'], 'producer_retired':True,
                   'browser_closed':True,'fixtures_closed':True,'source_restored':True}
        entry['retirement']['binding'] = f.archive({'retired.json':b.canonical(retired)},21,job_name='retire-original-compose-779')
        with self.assertRaisesRegex(b.Refused, 'original producer/base'):
            f.validate()

    def test_retirement_from_unreviewed_workflow_cannot_attest_original_cleanup(self):
        f = self.fixture(); binding = f.packet['originals'][0]['retirement']['binding']
        binding.update(workflow_head='9'*40, run_head='9'*40)
        f.answers['repos/%s/actions/runs/21' % f.repo]['head_sha']='9'*40
        for job in f.answers['repos/%s/actions/runs/21/attempts/1/jobs?per_page=100' % f.repo]['jobs']:
            job['head_sha']='9'*40
        f.answers['repos/%s/actions/artifacts/%d' % (f.repo,binding['id'])]['workflow_run']['head_sha']='9'*40
        with self.assertRaisesRegex(b.Refused,'reviewed original retirement producer'):
            f.validate()

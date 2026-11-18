from __future__ import annotations

"""Synthetic contract fixtures, never receipts of actual hosted executions."""
import copy
import io
import json
from pathlib import Path
import zipfile

from tools import base_move as b, continuation_envelope as envelope, release_check as check, ci_known_reds as ci
from test_tools_base_move import BaseMoveFixture, digest
from test_tools_train import REPOSITORY


class Continuation(BaseMoveFixture):
    MANUAL = (b'on:\n  workflow_dispatch:\n    inputs:\n      source_head:\n        required: true\n'
              b'jobs:\n  check:\n    strategy:\n      matrix:\n        include:\n'
              b'          - name: unfinished\n            steps: native-light\n'
              b'    steps:\n      - with:\n          ref: ${{ inputs.source_head }}\n'
              b'        run: dispatch-source.json --only "${{ matrix.steps }}"\n')
    def write(self, name, text):
        super().write(name, text)
        if name == 'tools/release_check.py':
            super().write(envelope.WORKFLOW, '# synthetic original workflow\n')

    def setUp(self):
        super().setUp()
        self.summary = b.document(self.files['release-check/summary.json'])
        self.provenance = b.document(self.files['release-check/provenance.json'])
        self.raw = b.document(self.files['check-0/summary.json'])
        self.receipt = b.document(self.files['check-0/run.json'])
        self.missing = 'native-light'
        self.finished = 'native-journal'
        self.plan = [{'name': 'complete', 'steps': ','.join(n for n in check.REQUIRED if n not in (self.finished, self.missing))},
                     {'name': 'cut', 'steps': self.finished + ',' + self.missing}]
        self.newplan = [{'name': 'unfinished', 'steps': [self.missing]}]
        self.git(self.work, 'checkout', '-q', '--detach', self.head)
        super().write(envelope.WORKFLOW, self.MANUAL.decode())
        self.wrapper = self.commit('Synthetic manual wrapper')
        self.git(self.live, 'fetch', '-q', str(self.work), self.wrapper)
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        self.auth = dict(reviewer='fixture independent reviewer', record='fixture authorization, not live approval',
                         source_head=self.head, source_tree=self.tree(self.head), original_run=101, original_attempt=1,
                         base_at_run=self.original_base, pr=31,
                         original_workflow=self.save('original.yml', b'# synthetic original workflow\n'),
                         workflow_head=self.wrapper, workflow=self.save('manual.yml', self.MANUAL),
                         plan=self.newplan)
        self.newraw = copy.deepcopy(self.raw)
        missing_step = next(s for s in self.raw['steps'] if s['name'] == self.missing)
        complete_steps = [s for s in self.raw['steps'] if s['name'] not in (self.missing, self.finished)]
        self.raw.update(steps=complete_steps, only=[s['name'] for s in complete_steps], passed=True)
        partial_step = copy.deepcopy(next(s for s in self.summary['steps'] if s['name'] == self.finished))
        partial_step.pop('argv')
        partial_step.update(result_source='github-job-log', github_job=402, shard='cut')
        self.summary.update(steps=complete_steps + [partial_step], missing=[self.missing], tree_unchanged=False,
                            passed=False, failed=[self.finished, self.missing])
        self.provenance.update(plan=self.plan, checked={'commit': self.tested, 'tree_unchanged': False})
        self.newraw.update(commit=self.head, tree_after={'head': self.head, 'changes': ''},
                           steps=[missing_step], only=[self.missing], passed=True)
        self.payloads = {'check-0': {}, 'check-1': {}, 'release-check': {}, 'completion/check-0': {}}
        self.archive_jobs = {'check-0': 401, 'check-1': 402, 'release-check': None, 'completion/check-0': 404}
        for path, ref in self.files.items():
            if path.startswith('check-0/') and not path.endswith(('summary.json', 'run.json')):
                tail = path[len('check-0/'):]
                target = ('completion/check-0' if tail == self.missing + '.log' or tail.startswith('native/light/') else
                          'check-1' if tail == self.finished + '.log' or tail.startswith('native/journal/') else 'check-0')
                self.payloads[target][tail] = b.artifact(ref)
        # Every native fixture now includes an actual archived source blob.
        for folder, members in self.payloads.items():
            for path, value in list(members.items()):
                if path.startswith('native/') and path.endswith(('/native.json', '/results.json')):
                    report = b.loads(value)
                    harness = ci.NATIVE['native-' + path.split('/')[1]].harness
                    report['hashes'] = {harness: digest(b'// frozen harness\n')}
                    members[path] = json.dumps(report).encode()
                    members[path.rsplit('/', 1)[0] + '/source/' + harness] = b'// frozen harness\n'
        self.payloads['check-0']['summary.json'] = b.canonical(self.raw)
        receipt = copy.deepcopy(self.receipt)
        receipt['shard'] = {'name': 'complete', 'steps': self.raw['only']}
        receipt['summary_sha256'] = digest(self.payloads['check-0']['summary.json'])
        self.payloads['check-0']['run.json'] = b.canonical(receipt)
        partial = copy.deepcopy(self.receipt)
        partial.update(summary_sha256=None, shard={'name': 'cut', 'steps': [self.finished, self.missing]})
        self.payloads['check-1']['run.json'] = b.canonical(partial)
        self.payloads['release-check']['summary.json'] = b.canonical(self.summary)
        self.payloads['release-check']['provenance.json'] = b.canonical(self.provenance)
        self.payloads['completion/check-0']['summary.json'] = b.canonical(self.newraw)
        newreceipt = copy.deepcopy(self.receipt)
        wfref = REPOSITORY + '/' + envelope.WORKFLOW + '@refs/heads/manual'
        newreceipt.update(summary_sha256=digest(self.payloads['completion/check-0']['summary.json']),
                          shard=self.newplan[0], base={'ref': None, 'sha': None}, base_at_run=None,
                          head={'ref': 'refs/heads/manual', 'sha': self.wrapper},
                          merge={'sha': self.head, 'tree': self.tree(self.head), 'first_parent': self.old, 'second_parent': None})
        newreceipt['run'].update(id='103', event='workflow_dispatch', workflow_sha=self.wrapper, workflow_ref=wfref)
        self.payloads['completion/check-0']['run.json'] = b.canonical(newreceipt)
        self.dispatch = dict(version=1, requested_source=self.head, checked_source=self.head, checked_tree=self.tree(self.head),
                             parents=[self.old], original_source=self.head, original_run=101, original_attempt=1,
                             release_base=self.old, workflow_api_head=self.wrapper, workflow_sha=self.wrapper,
                             workflow_ref=wfref, run='103', attempt='1', event='workflow_dispatch', source_changes='')
        self.payloads['completion/check-0']['dispatch-source.json'] = b.canonical(self.dispatch)
        self.env = dict(version=1, original={'run': 101, 'attempt': 1},
                        completion={'run': 103, 'attempt': 1, 'workflow_head': self.wrapper})
        self.api = self.github.answers
        self.oldrun = self.api['repos/' + REPOSITORY + '/actions/runs/101']
        self.oldrun.update(head_branch='train/source', workflow_id=1, repository={'id': 2, 'full_name': REPOSITORY},
                           head_repository={'id': 2, 'full_name': REPOSITORY},
                           pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': dict(self.original_base)}])
        self.newrun = dict(self.oldrun, id=103, head_sha=self.wrapper, head_branch='manual', event='workflow_dispatch', conclusion='success')
        self.api['repos/' + REPOSITORY + '/actions/runs/103'] = self.newrun
        self.api['repos/' + REPOSITORY + '/actions/workflows/1'] = {'id': 1, 'path': envelope.WORKFLOW, 'name': 'Checks'}
        self.jobs = {101: [self.job(401, 'complete', 101, self.head), self.job(402, 'cut', 101, self.head, 'cancelled'),
                           self.job(403, "the whole run's summary", 101, self.head)],
                     103: [self.job(404, 'manual missing mode', 103, self.wrapper)]}
        self.jobs[103][0]['steps'].append({'name': 'Release check, ' + self.missing, 'status': 'completed', 'conclusion': 'success'})
        for run, jobs in self.jobs.items():
            self.api['repos/%s/actions/runs/%d/attempts/1/jobs?per_page=100' % (REPOSITORY, run)] = {'total_count': len(jobs), 'jobs': jobs}
        self.refresh_provenance()
        self.freeze_envelope()

    def refresh_provenance(self):
        provenance = b.loads(self.payloads['release-check']['provenance.json'])
        shards = []
        for folder, members in self.payloads.items():
            if folder.startswith('check-') and 'summary.json' in members:
                raw = b.loads(members['summary.json'])
                shards.append({'artifact': folder, 'receipt': b.loads(members['run.json']), 'refused': None,
                               'commit': self.tested, 'tree_unchanged': True, 'tools': raw['tools'], 'steps': raw['only']})
        provenance['shards'] = shards
        self.payloads['release-check']['provenance.json'] = b.canonical(provenance)
        summary = b.loads(self.payloads['release-check']['summary.json'])
        summary['combined_from'] = [s['artifact'] + '/summary.json' for s in shards]
        self.payloads['release-check']['summary.json'] = b.canonical(summary)

    def job(self, id_, name, run, head, conclusion='success'):
        return dict(id=id_, name=name, run_id=run, run_attempt=1, head_sha=head, status='completed', conclusion=conclusion,
                    completed_at='2026-11-18T01:01:10Z',
                    steps=[{'name': "Keep the whole run's summary" if id_ == 403 else 'Keep the evidence', 'status': 'completed', 'conclusion': 'success',
                            'started_at': '2026-11-18T01:00:00Z', 'completed_at': '2026-11-18T01:01:00Z'}])

    def freeze_envelope(self):
        self.files.clear()
        old, new = [], []
        for index, (folder, members) in enumerate(self.payloads.items(), 501):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name, data in members.items():
                    archive.writestr(name, data)
                    self.files[folder + '/' + name] = self.save('envelope-files/' + folder + '/' + name, data)
            is_new = folder.startswith('completion/')
            run = self.newrun if is_new else self.oldrun
            name = folder.split('/')[-1]
            job = self.archive_jobs[folder]
            ref = {'id': index, 'name': name, 'job': job, 'archive': self.save('zip/' + folder + '.zip', stream.getvalue())}
            (new if is_new else old).append(ref)
            self.api['repos/%s/actions/artifacts/%d' % (REPOSITORY, index)] = {
                'id': index, 'name': name, 'expired': False, 'digest': 'sha256:' + digest(stream.getvalue()),
                'created_at': '2026-11-18T01:00:30Z', 'workflow_run': {'id': run['id'], 'head_sha': run['head_sha'],
                    'head_branch': run['head_branch'], 'repository_id': 2, 'head_repository_id': 2}}
        self.env['original']['archives'] = old; self.env['completion']['archives'] = new
        self.env['authorization'] = self.save('authorization.json', self.auth)
        self.evidence_body['source']['continuation'] = self.save('continuation.json', self.env)
        self.audit_reds[0]['evidence'] = [self.files['check-1/native/journal/native.json']]

    def freeze_audit(self):
        super().freeze_audit()
        source = self.evidence_body['source']
        audit = b.document(source['audit']); audit['continuation_sha256'] = source['continuation']['sha256']
        source['audit'] = self.save('audit.json', audit)

    def consume(self):
        self.freeze_audit()
        judgment = {'head': self.head, 'producer_runs': [self.oldrun],
                    'verdict_checks': [self.api['repos/' + REPOSITORY + '/check-runs/201']], 'audit': 'm-original-audit'}
        def git(*args):
            import subprocess
            return subprocess.run(['git', '-C', str(self.live), *args], capture_output=True, text=True)
        return b.full_source(self.evidence_body['source'], judgment, git, self.github, REPOSITORY, self.head)

    def refuses(self, why):
        with self.assertRaisesRegex((b.Refused, ci.Refused), why):
            self.consume()

    def change_json(self, folder, member, change):
        value = b.loads(self.payloads[folder][member]); change(value)
        self.payloads[folder][member] = b.canonical(value)
        self.freeze_envelope()

    def test_synthetic_union_keeps_original_red_and_partial_truth(self):
        observed = self.consume()
        self.assertEqual(observed['kind'], 'original-partial-plus-scoped-completion')
        self.assertTrue(observed['complete']); self.assertFalse(observed['passed'])
        self.assertEqual(observed['red_count'], 1)
        self.assertEqual(observed['partial_shards'], ['check-1'])
        self.assertEqual(observed['failed'], [self.finished])
        self.assertEqual(observed['controller']['refusals'], 'the base is not judged here\n')
        self.assertEqual(len(observed['positions']), len(check.REQUIRED))

    def test_dispatch_identity_negatives(self):
        for field, value in [('checked_source', self.old), ('checked_tree', 'a'*40), ('workflow_sha', self.head),
                             ('workflow_api_head', self.head), ('run', '999'), ('attempt', '2'),
                             ('original_run', 999), ('original_attempt', 2), ('release_base', self.L)]:
            with self.subTest(field=field):
                original = self.payloads['completion/check-0']['dispatch-source.json']
                self.change_json('completion/check-0', 'dispatch-source.json', lambda d: d.update({field: value}))
                self.refuses('dispatch source binding')
                self.payloads['completion/check-0']['dispatch-source.json'] = original
                self.freeze_envelope()

    def test_duplicate_extra_missing_and_reassigned_authorized_steps(self):
        for steps in [[self.missing, self.missing], [self.missing, self.finished], [], [self.finished]]:
            with self.subTest(steps=steps):
                self.auth['plan'] = [{'name': 'unfinished', 'steps': steps}]; self.freeze_envelope()
                self.refuses('workflow assignment|exact missing-only')

    def test_wrong_pr_base_run_attempt_and_workflow_api(self):
        changes = [(self.oldrun['pull_requests'][0], 'number', 32, 'PR/base'),
                   (self.oldrun['pull_requests'][0]['base'], 'sha', self.L, 'PR/base'),
                   (self.newrun, 'run_attempt', 2, 'run identity'),
                   (self.newrun, 'head_sha', self.head, 'run identity'),
                   (self.newrun, 'event', 'push', 'run identity'),
                   (self.newrun, 'path', '.github/workflows/other.yml', 'run identity')]
        for obj, key, value, why in changes:
            with self.subTest(key=key, why=why):
                old = obj[key]; obj[key] = value
                try:
                    self.refuses(why)
                finally:
                    obj[key] = old

    def test_api_digest_refuses_local_repackaging(self):
        self.api['repos/' + REPOSITORY + '/actions/artifacts/501']['digest'] = 'sha256:' + '0'*64
        self.refuses('artifact provenance')

    def test_wrong_archive_attempt_upload(self):
        self.api['repos/' + REPOSITORY + '/actions/artifacts/501']['created_at'] = '2026-11-18T01:02:00Z'
        self.refuses('attempt/upload')

    def test_artifact_finalization_within_uploading_job_is_authenticated(self):
        self.api['repos/' + REPOSITORY + '/actions/artifacts/501']['created_at'] = '2026-11-18T01:01:01Z'
        self.assertTrue(self.consume()['complete'])

    def test_pending_is_not_success(self):
        self.newrun.update(status='in_progress', conclusion=None); self.refuses('pending')

    def test_forged_partial_summary_is_rejected(self):
        self.payloads['check-1']['summary.json'] = b.canonical(self.raw); self.freeze_envelope()
        self.refuses('summary digest|shard provenance inventory')

    def test_missing_cleanup_is_rejected(self):
        self.change_json('check-1', 'native/journal/native.json', lambda r: r.update(browserClosed=False))
        self.refuses('cleanup|counts disagree')

    def test_missing_hash_and_archived_source_refuse(self):
        self.change_json('check-1', 'native/journal/native.json', lambda r: r.pop('hashes'))
        self.refuses('missing source hashes')

    def test_missing_archived_source_refuses(self):
        del self.payloads['check-1']['native/journal/source/' + ci.NATIVE[self.finished].harness]
        self.freeze_envelope(); self.refuses('missing source artifact')

    def test_omitted_completed_native_cannot_be_reassigned_to_continuation(self):
        # The authentic original output is still present: omitting its result
        # cannot make it a missing mode eligible to rerun.
        self.change_json('release-check', 'summary.json', lambda s: s.update(
            steps=[r for r in s['steps'] if r['name'] != self.finished]))
        self.refuses('omitted original completed report')

    def test_changed_completed_assignment_refuses(self):
        self.change_json('check-0', 'run.json', lambda r: r['shard']['steps'].append(self.finished))
        self.refuses('original shard binding')

    def test_extra_continuation_native_output_cannot_hide_behind_exact_summary(self):
        self.payloads['completion/check-0']['native/journal/native.json'] = self.payloads['check-1']['native/journal/native.json']
        self.freeze_envelope(); self.refuses('extra or missing native output')

    def test_local_rewritten_summary_refuses_even_with_new_local_digest(self):
        key = 'release-check/summary.json'
        value = b.document(self.files[key]); value['passed'] = True
        self.files[key] = self.save('locally-rewritten.json', value)
        self.refuses('local rewritten artifact')

    def test_original_combined_inventory_cannot_omit_complete_shard(self):
        self.change_json('release-check', 'summary.json', lambda s: s.update(combined_from=[]))
        self.refuses('shard provenance inventory')

    def test_wrong_source_archive_bytes_refuse(self):
        self.payloads['check-1']['native/journal/source/' + ci.NATIVE[self.finished].harness] = b'changed'
        self.freeze_envelope(); self.refuses('source hash/archive')

    def test_omitted_original_red_refuses(self):
        self.audit_reds.clear(); self.refuses('missing original red')

    def test_wrong_app_and_publication_stay_guarded(self):
        check_run = self.api['repos/' + REPOSITORY + '/check-runs/201']
        check_run['app']['id'] = 1; self.refuses('untrusted Verdict App')
        check_run['app']['id'] = b.VERDICT_APP['id']; self.published['external_id'] = '101-2'
        self.freeze_controller(); self.refuses('published Verdict binding')

    def test_envelope_survives_deploy_measurement_without_fabricated_summary(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        result = self.evidence_of('02-release')['record']['measurements']['train']['base_move']
        self.assertEqual(result['source']['continuation'], self.evidence_body['source']['continuation'])
        self.assertFalse(result['source_observed']['passed'])
        self.assertEqual(result['source_observed']['partial_shards'], ['check-1'])

    def test_unknown_envelope_shape_never_falls_back(self):
        self.env['invented_summary'] = True
        self.evidence_body['source']['continuation'] = self.save('bad-envelope.json', self.env)
        self.refuses('invalid fields')

    def partition_python(self):
        raw = b.loads(self.payloads['check-0']['summary.json'])
        unit = next(s for s in raw['steps'] if s['name'] == 'python-units')
        raw['steps'].remove(unit); raw['only'].remove('python-units')
        self.plan[0]['steps'] = ','.join(raw['only'])
        self.payloads['check-0']['summary.json'] = b.canonical(raw)
        receipt = b.loads(self.payloads['check-0']['run.json'])
        receipt['shard']['steps'] = raw['only']
        receipt['summary_sha256'] = digest(self.payloads['check-0']['summary.json'])
        self.payloads['check-0']['run.json'] = b.canonical(receipt)
        del self.payloads['check-0']['python-units.log']
        self.inventory['python-units'] = [{'name': 'test_one (test_alpha.Sample)'}, {'name': 'test_two (test_beta.Sample)'}]
        self.evidence_body['source']['inventory'] = self.save('partition-inventory.json', self.inventory)
        for index, (case, file) in enumerate(zip(self.inventory['python-units'], ['tests/test_alpha.py', 'tests/test_beta.py']), 1):
            folder = 'check-%d' % (index + 1)
            part = {'index': index, 'total': 2, 'files': [file]}
            shard = {'name': 'Python %d/2' % index, 'steps': 'python-units', 'python_shard': '%d/2' % index, 'files': [file]}
            self.plan.append(shard)
            step = dict(unit, python_shard=part)
            summary = dict(self.raw, steps=[step], only=['python-units'], python_shard=part, passed=True)
            run = copy.deepcopy(self.receipt)
            run['shard'] = {'name': shard['name'], 'steps': ['python-units']}
            run['summary_sha256'] = digest(b.canonical(summary))
            log = case['name'] + ' ... ok\n\nRan 1 test in 0.01s\n\nOK\n'
            log += json.dumps({'unit_shards': 1, 'tests': 1, 'python_shard': part}) + '\n'
            self.payloads[folder] = {'summary.json': b.canonical(summary), 'run.json': b.canonical(run), 'python-units.log': log.encode()}
            self.archive_jobs[folder] = 404 + index
            self.jobs[101].append(self.job(404 + index, shard['name'], 101, self.head))
        api_jobs = self.api['repos/%s/actions/runs/101/attempts/1/jobs?per_page=100' % REPOSITORY]
        api_jobs['total_count'] = len(self.jobs[101])
        aggregate = b.loads(self.payloads['release-check']['summary.json'])
        next(s for s in aggregate['steps'] if s['name'] == 'python-units')['counts']['tests'] = 2
        self.payloads['release-check']['summary.json'] = b.canonical(aggregate)
        provenance = b.loads(self.payloads['release-check']['provenance.json']); provenance['plan'] = self.plan
        self.payloads['release-check']['provenance.json'] = b.canonical(provenance)
        self.refresh_provenance()
        self.freeze_envelope()

    def test_python_partition_deduplication_keeps_complete_reviewed_inventory(self):
        self.partition_python()
        observed = self.consume()
        self.assertEqual(len(observed['positions']), len(check.REQUIRED) + 1)
        self.assertEqual(observed['red_count'], 1)

    def test_duplicate_python_case_in_other_partition_refuses(self):
        self.partition_python()
        self.payloads['check-3']['python-units.log'] = self.payloads['check-3']['python-units.log'].replace(
            b'test_two (test_beta.Sample)', b'test_one (test_alpha.Sample)')
        self.freeze_envelope(); self.refuses('duplicate Python partition')

    def test_missing_python_case_cannot_be_hidden_by_partition_totals(self):
        self.partition_python()
        self.payloads['check-3']['python-units.log'] = self.payloads['check-3']['python-units.log'].replace(
            b'test_two (test_beta.Sample)', b'test_other (test_beta.Sample)')
        self.freeze_envelope(); self.refuses('incomplete Python inventory')

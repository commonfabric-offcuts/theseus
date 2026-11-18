from __future__ import annotations

"""Synthetic mechanical controls only; none is PR86's admission or review."""
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

from tools import train, base_move, continuation_envelope as continuation, ci_known_reds as ci


class SourceCarry752(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-752-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def ref(self, name, value, raw=False):
        path = self.root / name
        path.write_bytes(value if raw else train.carry_canonical(value))
        return {'path': str(path), 'sha256': train.digest(path.read_bytes())}

    def test_canonical_non_ascii_bytes(self):
        self.assertEqual(train.carry_canonical({'é': '字'}), '{"é":"字"}'.encode())

    def test_candidate_record_does_not_authorize_its_inputs_or_decisions(self):
        for change in ('approve Python1', 'remove old red', 'select Reader inputs', 'omit qualification', 'skip control'):
            with self.subTest(change=change):
                ref = self.ref('untrusted.json', {'reviewer': 'auditor', 'decision': change})
                with self.assertRaisesRegex(train.Refused, 'independent carry body'):
                    train.carry_record(ref)

    def test_missing_and_wrong_ref_hash_refuse(self):
        ref = self.ref('body.json', {'a': 1})
        ref['sha256'] = '0' * 64
        with self.assertRaisesRegex(base_move.Refused, 'artifact digest'):
            train.carry_record(ref)
        with self.assertRaisesRegex(base_move.Refused, 'unreadable artifact'):
            train.carry_record({'path': str(self.root / 'missing'), 'sha256': train.CARRY_752_FILE})

    def synthetic_scopes(self):
        # Deliberately labelled synthetic: scope mechanics, not carry authority.
        carried = {'steps': [{'step': s, 'decision': 'carry-exact-recorded-scope'} for s in
                            train.release_check.REQUIRED if s not in ('python-units', 'node-units', 'deploy-refusals', 'native-compose')]}
        scopes = [s['step'] for s in carried['steps']] + [
            'python-1', 'python-2', 'python-3', 'python-4', 'node-units', 'deploy-refusals', 'native-compose']
        return carried, {'executions': [{'scope': s, 'archive': 'synthetic', 'step': {}} for s in scopes]}

    def test_synthetic_complete_scope_control(self):
        carried, data = self.synthetic_scopes()
        self.assertEqual(len(train.carry_scopes(data, carried)), 55)

    def test_each_pending_whole_step_and_compose_refuses(self):
        for missing in ('python-1', 'node-units', 'native-compose'):
            carried, data = self.synthetic_scopes()
            data['executions'] = [r for r in data['executions'] if r['scope'] != missing]
            with self.subTest(missing=missing), self.assertRaisesRegex(train.Refused, missing):
                train.carry_scopes(data, carried)

    def test_duplicate_missing_extra_scope_refuses(self):
        for kind in ('duplicate', 'missing', 'extra'):
            carried, data = self.synthetic_scopes()
            if kind == 'duplicate': data['executions'].append(data['executions'][0])
            elif kind == 'missing': data['executions'].pop()
            else: data['executions'].append({'scope': 'invented', 'archive': 'synthetic', 'step': {}})
            with self.subTest(kind=kind), self.assertRaisesRegex(train.Refused, 'scopes'):
                train.carry_scopes(data, carried)

    def test_complete_case_identity_requires_exact_phase_engine_and_control(self):
        rows = [{'name': 'synthetic original red', 'phase': 'green', 'engine': 'chromium', 'passed': False},
                {'name': 'synthetic caught control', 'phase': 'mutant', 'expectedFailure': True, 'passed': False}]
        train.carry_cases(rows, rows, 'synthetic')
        variants = [rows[:1], rows + rows[:1], rows + [{'name': 'extra'}],
                    [dict(rows[0], engine='webkit'), rows[1]], [dict(rows[0], phase='restored'), rows[1]],
                    [rows[0], dict(rows[1], expectedFailure=False)]]
        for expected in variants:
            with self.subTest(expected=expected), self.assertRaisesRegex(train.Refused, 'case inventory'):
                train.carry_cases(rows, expected, 'synthetic')

    def test_review_binds_whole_body_inventory_and_independent_attribution(self):
        data = {'inventory': self.ref('inventory.json', {'synthetic': 'all cases'}), 'executions': ['synthetic']}
        review = {'version': 1, 'reviewer': 'auditor', 'record': 'synthetic-independent-record',
                  'judgment_audit': 'synthetic-source-audit', 'body_sha256': train.digest(train.carry_canonical(data)),
                  'inventory_sha256': data['inventory']['sha256'], 'workflow_sha256': {}, 'obligations': []}
        data['review'] = self.ref('review.json', review)
        judgment = {'audit': 'synthetic-source-audit'}
        self.assertEqual(train.carry_review(data, judgment), review)
        for key, bad in [('reviewer', 'builder'), ('record', judgment['audit']), ('judgment_audit', 'stale'),
                         ('body_sha256', '0'*64), ('inventory_sha256', '0'*64)]:
            changed = dict(review, **{key: bad}); data['review'] = self.ref('bad-review.json', changed)
            with self.subTest(key=key), self.assertRaisesRegex(train.Refused, 'review'):
                train.carry_review(data, judgment)
        data['review'] = self.ref('review.json', review); data['executions'].append('omit old red')
        with self.assertRaisesRegex(train.Refused, 'body'):
            train.carry_review(data, judgment)

    def original_run(self, attempt=1):
        return {'id': 44284000276, 'run_attempt': attempt, 'head_sha': train.CARRY_752_OLD,
                'event': 'pull_request', 'name': 'Checks', 'path': continuation.WORKFLOW,
                'repository': {'full_name': 'commonfabric-offcuts/theseus'},
                'head_repository': {'full_name': 'commonfabric-offcuts/theseus'},
                'status': 'completed', 'conclusion': 'failure', 'workflow_id': 1,
                'pull_requests': [{'number': 86, 'head': {'sha': train.CARRY_752_OLD},
                                   'base': {'ref': 'release/live73', 'sha': train.CARRY_752_BASE}}]}

    def run_api(self, run):
        class API:
            def get(self, path):
                if '/workflows/' in path: return {'id': 1, 'path': continuation.WORKFLOW, 'name': 'Checks'}
                if '/jobs?' in path: return {'total_count': 0, 'jobs': []}
                return run
        return API()

    def binding(self, attempt=1):
        return {'run': 44284000276, 'attempt': attempt,
                'workflow_head': train.CARRY_752_OLD, 'source_head': train.CARRY_752_OLD}

    def test_synthetic_original_api_failure_conclusion_is_preserved(self):
        run, jobs = train.carry_run(self.binding(), self.run_api(self.original_run()), 'commonfabric-offcuts/theseus', None)
        self.assertEqual(run['conclusion'], 'failure')

    def test_wrong_source_workflow_attempt_apihead_and_base_refuse(self):
        for key in ('source_head', 'workflow_head', 'attempt', 'apihead', 'base', 'workflow', 'pending'):
            binding, run = self.binding(), self.original_run()
            if key in ('source_head', 'workflow_head'): binding[key] = 'a'*40
            elif key == 'attempt': binding['attempt'] = run['run_attempt'] = 2
            elif key == 'apihead': run['head_sha'] = 'a'*40
            elif key == 'base': run['pull_requests'][0]['base']['sha'] = 'a'*40
            elif key == 'workflow': run['path'] = '.github/workflows/fake.yml'
            else: run['status'] = 'in_progress'
            with self.subTest(key=key), self.assertRaises((train.Refused, base_move.Refused)):
                train.carry_run(binding, self.run_api(run), 'commonfabric-offcuts/theseus', None)

    def zip_fixture(self, members):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for key, value in members: archive.writestr(key, value)
        raw = stream.getvalue()
        run = {'id': 99, 'head_sha': 'a'*40, 'head_branch': 'synthetic', 'repository': {'id': 1}, 'head_repository': {'id': 1}}
        jobs = {9: {'completed_at': '2026-11-18T10:02:00Z', 'steps': [
            {'name': 'Keep the evidence', 'status': 'completed', 'conclusion': 'success', 'started_at': '2026-11-18T10:00:00Z'}]}}
        row = {'key': 'synthetic/check-0', 'run': 99, 'id': 77, 'name': 'check-0', 'job': 9,
               'archive': self.ref('synthetic.zip', raw, raw=True)}
        meta = {'id': 77, 'name': 'check-0', 'expired': False, 'size_in_bytes': len(raw),
                'digest': 'sha256:' + train.digest(raw), 'created_at': '2026-11-18T10:01:00Z',
                'workflow_run': {'id': 99, 'head_sha': 'a'*40, 'head_branch': 'synthetic', 'repository_id': 1, 'head_repository_id': 1}}
        return row, run, jobs, meta

    def test_synthetic_archive_reads_raw_bytes_and_indexes_opaque_members(self):
        row, run, jobs, meta = self.zip_fixture([('run.json', '{}'), ('native/red.log', 'exact failure\n'), ('pyc/opaque.pyc', b'opaque')])
        api = mock.Mock(); api.get.return_value = meta
        content, index = train.carry_archive(row, run, jobs, api, 'synthetic')
        self.assertEqual(content['native/red.log'], b'exact failure\n')
        self.assertEqual(index['pyc/opaque.pyc'], train.digest(b'opaque'))
        self.assertNotIn('pyc/opaque.pyc', content)

    def test_altered_zip_api_digest_raw_member_and_attempt_upload_refuse(self):
        for key in ('digest', 'id', 'name', 'size_in_bytes', 'head_sha', 'job', 'upload'):
            row, run, jobs, meta = self.zip_fixture([('run.json', '{}')])
            if key in ('digest', 'name'): meta[key] = 'altered'
            elif key in ('id', 'size_in_bytes'): meta[key] += 1
            elif key == 'head_sha': meta['workflow_run'][key] = 'b'*40
            elif key == 'job': row['job'] = 10
            else: meta['created_at'] = '2026-11-18T10:03:00Z'
            api = mock.Mock(); api.get.return_value = meta
            with self.subTest(key=key), self.assertRaisesRegex(train.Refused, 'ZIP|archive'):
                train.carry_archive(row, run, jobs, api, 'synthetic')
        row, run, jobs, meta = self.zip_fixture([('run.json', '{}')])
        Path(row['archive']['path']).write_bytes(b'altered ZIP')
        with self.assertRaisesRegex(base_move.Refused, 'artifact digest'):
            train.carry_archive(row, run, jobs, mock.Mock(), 'synthetic')

    def test_duplicate_and_unsafe_zip_paths_refuse(self):
        for members in [[('../escape.json', '{}')], [('run.json', '{}'), ('run.json', '{}')]]:
            row, run, jobs, meta = self.zip_fixture(members)
            api = mock.Mock(); api.get.return_value = meta
            with self.assertRaises((train.Refused, base_move.Refused)):
                train.carry_archive(row, run, jobs, api, 'synthetic')

    def test_skipped_control_and_partial_unit_log_refuse(self):
        text = 'test_case (synthetic.Case) ... ok\n\nRan 1 test in 0.001s\n\nOK\n'
        step = {'name': 'python-units', 'passed': True, 'exit': 0, 'counts': {'tests': 1, 'status': 'OK'}}
        (self.root / 'python-units.log').write_text(text)
        self.assertEqual(len(train.carry_unit(step, self.root, [{'name': 'test_case (synthetic.Case)'}], 'python-1')), 1)
        for raw in (text.replace('... ok', "... skipped 'unexecuted'").replace('OK\n', 'OK (skipped=1)\n'),
                    text.replace('test_case (synthetic.Case) ... ok\n', ''), text.replace('OK\n', 'FAILED (errors=1)\n')):
            (self.root / 'python-units.log').write_text(raw)
            with self.assertRaises((train.Refused, ci.Refused)):
                train.carry_unit(step, self.root, [{'name': 'test_case (synthetic.Case)'}], 'python-1')

    def test_train_opt_in_is_mutually_exclusive_and_never_ordinary(self):
        value = {'pr': 86, 'merge_commit': 'a'*40, 'merged_tree': 'b'*40,
                 'items': [{'item': 752, 'approved_head': 'c'*40, 'review': 'synthetic'}],
                 'kind': 'judged-first', 'hosted_run': None,
                 'judgment': {'producer_runs': [1], 'verdict_checks': [2], 'audit': 'synthetic'},
                 'source_carry': {'path': str(self.root / 'evidence'), 'sha256': 'd'*64}}
        self.assertEqual(train.load(self.ref('train.json', value)['path']), value)
        for change in ({'kind': 'ordinary'}, {'base_move': value['source_carry']}, {'scoped': value['source_carry']}):
            with self.subTest(change=change), self.assertRaises(train.Refused):
                train.load(self.ref('train.json', dict(value, **change))['path'])

    def test_unmerged_context_refuses_before_any_candidate_evidence_can_admit(self):
        # Exercise the real entry point with a synthetic authenticated-body
        # stand-in ONLY to isolate the real merged-PR check. No accepting result.
        data = {k: None for k in 'carry complete_union runs archives executions inventory history controller receipts review'.split()}
        data['version'] = 1
        with mock.patch.object(train, 'carry_record', return_value=({}, {})):
            with self.assertRaisesRegex(train.Refused, 'actual PR'):
                train.validate_source_carry(self.ref('env.json', data), {}, None, mock.Mock(get=lambda path: {'merged': False}),
                    'commonfabric-offcuts/theseus', train.CARRY_752_BASE, 'a'*40, [],
                    {'merged': False}, 86, 'release/live73')

    def test_dispatch_binds_source_tree_parents_base_attempt_and_full_diff(self):
        repository = 'commonfabric-offcuts/theseus'
        run = {'id': 44305214536, 'head_branch': 'synthetic'}
        binding = {'source_head': train.CARRY_752_HEAD, 'workflow_head': train.CARRY_752_RUNS[44305214536][0]}
        parent = 'e5e023ee2b6f746c2f65f851625b6a2a20bc2ef1'
        dispatch = {'version': 1, 'requested_source': train.CARRY_752_HEAD, 'checked_source': train.CARRY_752_HEAD,
                    'checked_tree': train.CARRY_752_TREE, 'parents': [parent], 'original_source': train.CARRY_752_OLD,
                    'original_run': 44284000276, 'original_attempt': 1, 'release_base': train.CARRY_752_BASE,
                    'workflow_api_head': binding['workflow_head'], 'workflow_sha': binding['workflow_head'],
                    'workflow_ref': repository + '/' + continuation.WORKFLOW + '@refs/heads/synthetic',
                    'run': '44305214536', 'attempt': '1', 'event': 'workflow_dispatch', 'source_changes': 'tests/changed.py'}
        def git(*args):
            value = train.CARRY_752_TREE if args[0] == 'rev-parse' else (
                train.CARRY_752_HEAD + ' ' + parent if args[0] == 'rev-list' else 'tests/changed.py\n')
            return subprocess.CompletedProcess(args, 0, value, '')
        content = {'dispatch-source.json': train.carry_canonical(dispatch)}
        self.assertEqual(train.carry_dispatch(content, binding, run, git, repository), dispatch)
        for key in ('checked_source', 'checked_tree', 'parents', 'release_base', 'attempt', 'workflow_api_head', 'workflow_ref',
                    'original_run', 'original_attempt', 'source_changes'):
            altered = dict(dispatch, **{key: [] if key == 'parents' else 'wrong'})
            with self.subTest(key=key), self.assertRaisesRegex(train.Refused, 'dispatch'):
                train.carry_dispatch({'dispatch-source.json': train.carry_canonical(altered)}, binding, run, git, repository)

    def test_repeated_unittest_terminal_is_not_a_complete_log(self):
        text = 'test_case (synthetic.Case) ... ok\nRan 1 test in 0.001s\nOK\n'
        with self.assertRaisesRegex(train.Refused, 'repeated unittest terminal'):
            train.carry_unit_listing(text + text)

    def test_original_single_source_and_ordinary_routes_keep_their_guards(self):
        head, base, merge, tree = 'a'*40, 'b'*40, 'c'*40, 'd'*40
        changed = ['web/reader.mjs']
        class API:
            def get(self, path):
                if '/compare/' in path:
                    return {'status': 'identical', 'behind_by': 0, 'merge_base_commit': {'sha': merge}}
                if '/pulls/' in path:
                    return {'number': 31, 'merged': True, 'merge_commit_sha': merge,
                            'base': {'ref': 'release/live73'}, 'head': {'sha': head}}
                return {'id': int(path.split('/')[-1]), 'name': 'Checks', 'head_sha': head,
                        'status': 'completed', 'conclusion': 'failure'}
        def git(*args):
            value = ''
            if args[0] == 'rev-list': value = merge + ' ' + base + ' ' + head
            elif args[0] == 'rev-parse': value = tree
            elif args[0] == 'diff': value = '\0'.join(changed) + '\0'
            return subprocess.CompletedProcess(args, 0, value, '')
        judgment = {'producer_runs': [1], 'verdict_checks': [2], 'audit': 'synthetic'}
        observed = train.before_merge(git, API(), 'synthetic', judgment, merge, tree)
        self.assertEqual(observed['head'], head)
        self.assertEqual(observed['verdict_checks'][0]['conclusion'], 'failure')
        value = {'pr': 31, 'merge_commit': merge, 'merged_tree': tree, 'items': [
            {'item': 1, 'approved_head': head, 'review': 'synthetic'}], 'kind': 'ordinary', 'hosted_run': None, 'judgment': None}
        ref = self.ref('ordinary.json', value)
        result = train.judge(ref['path'], merge, base, 'release/live73', 'synthetic', git, API())
        self.assertEqual(result['judgment'], 'pending')
        changed[:] = ['tools/train.py']
        with self.assertRaisesRegex(train.Refused, 'ordinary train cannot change'):
            train.judge(ref['path'], merge, base, 'release/live73', 'synthetic', git, API())
        with self.assertRaisesRegex(train.Refused, 'tree'):
            train.before_merge(git, API(), 'synthetic', judgment, merge, 'e'*40)
        # Explicit opt-in cannot skip the existing actual-merged-PR gate.
        class OpenAPI(API):
            def get(self, path):
                result = super().get(path)
                if '/pulls/' in path: result.update(merged=False, state='open')
                return result
        value.update(kind='judged-first', judgment=judgment,
                     source_carry={'path': str(self.root/'not-read.json'), 'sha256': 'e'*64})
        path = self.ref('open-train.json', value)['path']
        with mock.patch.object(train, 'validate_source_carry') as validator:
            with self.assertRaisesRegex(train.Refused, 'merged False'):
                train.judge(path, merge, base, 'release/live73', 'synthetic', git, OpenAPI())
            validator.assert_not_called()

    def test_new_head_compose_red_cannot_inherit_old_carry_authority(self):
        rows = [{'name': 'synthetic own case', 'passed': True},
                {'name': 'synthetic caught control', 'passed': False, 'expectedFailure': True, 'mutationCaught': True}]
        train.carry_compose_authority(rows)
        for changed in ([{'name': 'new item648 raw red', 'passed': False}],
                        [dict(rows[1], mutationCaught=False)]):
            with self.assertRaisesRegex(train.Refused, 'separate independent placement'):
                train.carry_compose_authority(changed)

from __future__ import annotations

"""Synthetic full_source controls: real temporary Git, canned API, no hosted runs.

The synthetic all-green Python log isolates partition handling. Genuine Train46
still refuses at the separately owned multiline FAIL-header reader.
"""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools import base_move as b, ci_known_reds as ci, release_check as rc
from test_tools_base_move import BaseMoveFixture
from test_tools_train import REPOSITORY


class CompletePartitions(unittest.TestCase):
    save = BaseMoveFixture.save
    log = BaseMoveFixture.log
    report = BaseMoveFixture.report
    bind_controller = BaseMoveFixture.bind_controller
    freeze_controller = BaseMoveFixture.freeze_controller
    freeze_audit = BaseMoveFixture.freeze_audit

    def git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='source-partitions-')
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name) / 'git'; self.work.mkdir()
        self.git(self.work, 'init', '-q')
        self.git(self.work, 'config', 'user.name', 'Synthetic fixture')
        self.git(self.work, 'config', 'user.email', 'fixture@example.invalid')
        paths = rc.harnesses() + ['tools/release_check.py', 'tools/unit_shards.py']
        self.python_files = ['tests/test_part_%d.py' % i for i in range(1, 5)]
        for path in paths + self.python_files:
            target = self.work / path; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('# frozen fixture\n')
        self.git(self.work, 'add', '.')
        self.git(self.work, 'commit', '-qm', 'synthetic base')
        self.old = self.git(self.work, 'rev-parse', 'HEAD')
        tree = self.git(self.work, 'rev-parse', 'HEAD^{tree}')
        self.head = self.git(self.work, 'commit-tree', tree, '-p', self.old, '-m', 'synthetic source')
        self.tested = self.git(self.work, 'commit-tree', tree, '-p', self.old, '-p', self.head, '-m', 'synthetic tested merge')
        self.L = self.old
        self.original_merge = dict(sha=self.tested, tree=tree, first_parent=self.old, second_parent=self.head)
        self.original_base = dict(ref='release/test', sha=self.old)
        self.inventory, self.files, self.payloads = {}, {}, {}
        self.plan, self.raws, self.receipts = [], [], []
        self.tools = {'release_check': self.git(self.work, 'rev-parse', self.tested + ':tools/release_check.py'),
                      'harnesses': {p: self.git(self.work, 'rev-parse', self.tested + ':' + p) for p in rc.harnesses()}}
        self.run = dict(id=101, attempt=1, repository=REPOSITORY, workflow='Checks', event='pull_request',
                        workflow_sha=self.tested, workflow_ref=REPOSITORY + '/.github/workflows/checks.yml@refs/pull/31/merge')
        steps = []
        for name in rc.REQUIRED:
            if name == 'python-units':
                continue
            step = dict(name=name, passed=True, exit=0)
            if name in ci.NATIVE:
                native = ci.NATIVE[name]; rows = [dict(name='original ' + name, passed=True)]
                self.inventory[name] = rows
                self.payloads['check-0/native/' + native.name + '/' + native.results] = self.report(rows)
                log = self.log(native, rows)
                step.update(argv=['node', native.harness, 'chrome', 'out'] + list(native.flags),
                            counts={})
                step['counts'] = {'tests': 1, 'pass': 1, 'fail': 0, 'failed': [], 'browser_closed': True}
            elif name in ci.UNITS:
                if name == 'node-units':
                    self.inventory[name] = [dict(name='one')]
                    log = '# Subtest: one\nok 1 - one\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                    step['counts'] = rc.node_counts(log)[0]
                else:
                    self.inventory[name] = [dict(name='test_one (test_refusal.Sample)')]
                    log = self.unit_log(self.inventory[name]); step['counts'] = rc.python_counts(log)[0]
            else:
                self.inventory[name] = dict(routed=['actor'])
                counts = {'actor': dict(lost=[], wakes=1, delays=[1], median=1)}
                self.payloads['check-0/replay/candidate-1/replay.json'] = dict(agents=counts)
                self.payloads['check-0/wake-replay-candidate-1.log'] = b'replay complete\n'
                run = dict(passed=True, exit=0, counts=counts, log='replay.log', started_at='1', finished_at='2')
                step = rc.replay_step([run], 'start'); step['runs'] = [run]
                log = 'replay complete\n'
            self.payloads['check-0/' + name + '.log'] = log.encode(); steps.append(step)
        self.add_shard(dict(name='non Python', steps=','.join(s['name'] for s in steps)), steps)
        self.inventory['python-units'] = []
        for index, path in enumerate(self.python_files, 1):
            rows = [dict(name='test_one (test_part_%d.Sample)' % index)]
            self.inventory['python-units'].extend(rows)
            part = dict(index=index, total=4, files=[path])
            log = self.unit_log(rows) + json.dumps(dict(unit_shards=1, python_shard=part, tests=1,
                        timing=dict(files={path: 0.01}))) + '\n'
            self.payloads['check-%d/python-units.log' % index] = log.encode()
            step = dict(name='python-units', tool='unittest', argv=['/usr/bin/python3', '/frozen/tools/unit_shards.py',
                        '--root', '/frozen', '--shard', '%d/4' % index], exit=0, passed=True,
                        counts=rc.python_counts(log)[0], python_shard=part, timing=dict(files={path: 0.01}))
            self.add_shard(dict(name='python units %d of 4' % index, steps='python-units',
                               python_shard='%d/4' % index, files=[path]), [step], part)
        self.aggregate = dict(name='python-units', tool='unittest', counts=dict(tests=4, status='OK'), exit=0, passed=True,
                              shards=[dict(r['steps'][0], partition=copy.deepcopy(r['python_shard'])) for r in self.raws[1:]])
        self.summary = dict(self.raws[0], steps=steps + [self.aggregate], passed=True, failed=[],
                            combined_from=['check-%d/summary.json' % i for i in range(5)])
        self.summary.pop('only')
        self.provenance = dict(run=self.run, merge=self.original_merge, required=list(rc.REQUIRED),
                               base=self.original_base, base_at_run=self.original_base,
                               head=dict(ref='train/source', sha=self.head),
                               checked=dict(commit=self.tested, tree_unchanged=True), plan=self.plan)
        self.evidence_body = dict(source=dict(run=101, attempt=1, tested_merge=self.original_merge,
                                  base_at_run=self.original_base, files=self.files))
        self.audit_reds = []
        self.judgment = dict(producer_runs=[dict(id=101, conclusion='failure')],
                             verdict_checks=[dict(id=201, conclusion='failure')], audit='m-original-audit')
        class API:
            def get(api, path):
                return api.answers[path]
        self.github = API()
        self.github.answers = {'repos/' + REPOSITORY + '/actions/runs/101': dict(id=101, head_sha=self.head,
              status='completed', conclusion='failure', run_attempt=1, path='.github/workflows/checks.yml',
              event='pull_request', name='Checks'), 'repos/' + REPOSITORY + '/check-runs/201': {}}
        self.bind_controller()

    @staticmethod
    def unit_log(rows):
        return ''.join(r['name'] + ' ... ok\n' for r in rows) + '\nRan %d tests in 0.01s\n\nOK\n' % len(rows)

    def add_shard(self, job, steps, part=None):
        raw = dict(tools=self.tools, tool=rc.TOOL, commit=self.tested, checkout='/frozen', tree_unchanged=True,
                   tree_after=dict(head=self.tested, changes=''), required=list(rc.REQUIRED), steps=steps,
                   passed=True, only=[s['name'] for s in steps])
        if part is not None:
            raw['python_shard'] = part
        self.plan.append(job); self.raws.append(raw)
        self.receipts.append(dict(run=self.run, merge=self.original_merge, base=self.original_base,
                                 base_at_run=self.original_base, head=dict(ref='train/source', sha=self.head),
                                 shard=dict(name=job['name'], steps=raw['only'])))

    def freeze(self):
        for name, value in self.payloads.items():
            self.files[name] = self.save('source/' + name, value)
        shards = []
        for i, (raw, receipt) in enumerate(zip(self.raws, self.receipts)):
            folder = 'check-%d' % i
            self.files[folder + '/summary.json'] = self.save('source/' + folder + '/summary.json', raw)
            receipt['summary_sha256'] = self.files[folder + '/summary.json']['sha256']
            self.files[folder + '/run.json'] = self.save('source/' + folder + '/run.json', receipt)
            shards.append(dict(artifact=folder, receipt=receipt, commit=self.tested, tools=raw['tools'],
                               tree_unchanged=True, steps=raw['only'], refused=None))
        self.provenance['shards'] = shards
        for tail, value in [('summary', self.summary), ('provenance', self.provenance)]:
            self.files['release-check/' + tail + '.json'] = self.save('source/release-check/' + tail + '.json', value)
        self.evidence_body['source']['inventory'] = self.save('inventory.json', self.inventory)
        self.freeze_audit()

    def consume(self):
        self.freeze()
        git = lambda *args: subprocess.run(['git', '-C', str(self.work), *args], capture_output=True, text=True)
        return b.full_source(self.evidence_body['source'], self.judgment, git, self.github, REPOSITORY, self.head, None)

    def refuse(self, reason):
        with self.assertRaisesRegex((b.Refused, ci.Refused), reason):
            self.consume()

    def test_partitioned_complete_source(self):
        self.assertEqual(self.consume()['red_count'], 0)
        self.assertTrue(self.consume()['passed'])

    def test_producer_sorted_aggregate_required(self):
        self.summary['required'] = sorted(rc.REQUIRED)
        self.assertTrue(self.consume()['passed'])

    def test_missing_raw_required_step(self):
        self.raws[1]['required'] = list(rc.REQUIRED)[1:]
        self.refuse('dirty or partial source shard')

    def test_unpartitioned_complete_source(self):
        rows = self.inventory['python-units']; log = self.unit_log(rows)
        step = dict(name='python-units', tool='unittest', passed=True, exit=0, counts=rc.python_counts(log)[0])
        self.raws[0]['steps'].append(step); self.raws[0]['only'].append('python-units')
        self.plan[0]['steps'] += ',python-units'
        self.payloads['check-0/python-units.log'] = log.encode()
        self.raws = self.raws[:1]; self.receipts = self.receipts[:1]; self.plan[:] = self.plan[:1]
        self.summary['steps'][-1] = step; self.summary['combined_from'] = ['check-0/summary.json']
        self.assertTrue(self.consume()['passed'])

    def one_python_red(self):
        key = 'check-1/python-units.log'
        name = self.inventory['python-units'][0]['name']
        block = 'FAIL: ' + name + '\n' + '-'*70 + '\nAssertionError: original red\n'
        old = self.payloads[key].decode(); meta = old[old.index('{"unit_shards":'):]
        log = (name + ' ... FAIL\n\n' + '='*70 + '\n' + block + '\n' + '-'*70 +
               '\nRan 1 tests in 0.01s\n\nFAILED (failures=1)\n' + meta)
        self.payloads[key] = log.encode()
        step = self.raws[1]['steps'][0]; step.update(counts=rc.python_counts(log)[0], passed=False, exit=1)
        self.raws[1]['passed'] = False
        self.aggregate['shards'][0].update(counts=step['counts'], passed=False, exit=1)
        self.aggregate.update(counts=dict(tests=4,status='FAILED',failures=1),passed=False,exit=1)
        self.summary.update(passed=False,failed=['python-units'])
        self.audit_reds.append(dict(step='python-units',case=ci.identity(dict(name=name)),
            observed=dict(status='FAIL',failure=block),attribution='synthetic original failure',
            ground='retained verbatim',evidence=[self.save('source/'+key,log.encode())]))

    def test_partitioned_red_is_retained(self):
        self.one_python_red()
        observed = self.consume()
        self.assertFalse(observed['passed']); self.assertEqual(observed['red_count'],1)
        self.assertEqual(observed['failed'],['python-units'])
        self.assertEqual(observed['steps'],[dict(name='python-units',passed=False,exit=1,
                                               counts=dict(tests=1,status='FAILED',failures=1))])

    def test_partitioned_red_cannot_be_dropped(self):
        self.one_python_red(); self.audit_reds.clear()
        self.refuse('source audit missing original red')

    def test_partitioned_failure_block_cannot_change(self):
        self.one_python_red(); self.audit_reds[0]['observed']['failure'] += 'rewritten'
        self.refuse('source audit red identity/failure differs')

    def test_disjoint_cases(self):
        old = self.inventory['python-units'][1]['name']; new = self.inventory['python-units'][0]['name']
        self.payloads['check-2/python-units.log'] = self.payloads['check-2/python-units.log'].replace(old.encode(), new.encode())
        self.inventory['python-units'].pop(1)
        self.refuse('duplicate Python partition')

    def test_disjoint_files(self):
        # Change every agreeing declaration; only cross-partition disjointness catches this.
        self.change_partition(2, lambda p: p['files'].append(self.python_files[0]))
        self.refuse('duplicate Python partition')

    def change_partition(self, index, update):
        part = self.raws[index]['python_shard']; update(part)
        self.raws[index]['steps'][0]['timing']['files'] = {path: 0.01 for path in part['files']}
        self.plan[index]['files'] = part['files']
        self.plan[index]['python_shard'] = '%d/%d' % (part['index'], part['total'])
        self.raws[index]['steps'][0]['argv'][-1] = self.plan[index]['python_shard']
        self.aggregate['shards'][index-1]['partition'] = copy.deepcopy(part)
        lines = self.payloads['check-%d/python-units.log' % index].decode().splitlines()
        meta = json.loads(lines[-1]); meta['python_shard'] = part; meta['timing'] = self.raws[index]['steps'][0]['timing']; lines[-1] = json.dumps(meta)
        self.payloads['check-%d/python-units.log' % index] = ('\n'.join(lines) + '\n').encode()

    def test_complete_case_union(self):
        self.inventory['python-units'].append(dict(name='test_missing (test_part_1.Sample)'))
        self.refuse('incomplete Python inventory')

    def test_complete_file_union(self):
        old = self.python_files[3]; new = 'tests/test_absent.py'
        self.change_partition(4, lambda p: p.update(files=[new]))
        self.payloads['check-4/python-units.log'] = self.payloads['check-4/python-units.log'].replace(old.encode(), new.encode())
        self.refuse('Python file inventory differs')

    def test_aggregate_count_identity(self):
        self.aggregate['counts']['tests'] += 1
        self.refuse('Python aggregate differs')

    def test_aggregate_status_identity(self):
        self.aggregate['counts']['status'] = 'FAILED'
        self.refuse('Python aggregate differs')

    def test_aggregate_partition_identity(self):
        self.aggregate['shards'][0]['argv'] = ['invented']
        self.refuse('Python aggregate differs')

    def test_unique_indices(self):
        self.change_partition(2, lambda p: p.update(index=1))
        self.refuse('duplicate Python partition')

    def test_complete_indices(self):
        self.change_partition(4, lambda p: p.update(total=5))
        self.refuse('incomplete Python inventory')

    def test_filtered_partition(self):
        self.raws[1]['steps'][0]['argv'].extend(['-k', 'one'])
        self.refuse('Python command differs')

    def test_log_metadata(self):
        self.change_partition(1, lambda p: p.update(index=True))
        self.refuse('Python partition differs')

    def test_raw_counts(self):
        self.raws[1]['steps'][0]['counts']['tests'] = 2
        self.refuse('Python log partition differs')

    def test_truncated_log(self):
        self.payloads['check-1/python-units.log'] = self.payloads['check-1/python-units.log'].replace(b'Ran 1 tests in 0.01s\n\nOK\n', b'')
        self.refuse('source Python log result differs')

    def test_duplicate_raw_result(self):
        key = 'check-1/python-units.log'
        self.payloads[key] += b'Ran 1 test in 0.01s\n\nOK\n'
        self.refuse('Python log result differs')

    def test_receipt_extra_metadata(self):
        self.receipts[1]['shard']['python_shard'] = 'wrong'
        self.refuse('Python receipt differs')

    def test_duplicate_partition_metadata(self):
        key = 'check-1/python-units.log'
        self.payloads[key] += self.payloads[key].splitlines()[-1] + b'\n'
        self.refuse('Python log partition differs')

    def test_empty_partition_retains_planned_file(self):
        self.inventory['python-units'].pop(0)
        part = self.raws[1]['python_shard']; step = self.raws[1]['steps'][0]
        step['counts'] = dict(tests=0, status='OK')
        self.aggregate['shards'][0]['counts'] = step['counts']; self.aggregate['counts']['tests'] = 3
        self.payloads['check-1/python-units.log'] = (self.unit_log([]) + json.dumps(dict(unit_shards=1,
                      python_shard=part, tests=0, timing=step['timing'])) + '\n').encode()
        self.assertTrue(self.consume()['passed'])

    def test_unlisted_case(self):
        old = self.inventory['python-units'][0]['name']
        self.payloads['check-1/python-units.log'] = self.payloads['check-1/python-units.log'].replace(old.encode(), b'test_extra (m.C)')
        self.refuse('incomplete Python inventory')

    def test_duplicate_case_within_partition(self):
        key = 'check-1/python-units.log'
        self.payloads[key] = (self.inventory['python-units'][0]['name'] + ' ... ok\n').encode() + self.payloads[key]
        self.refuse('source unit missing individual outcomes')

    def test_wrong_raw_status(self):
        self.raws[1]['steps'][0]['counts']['status'] = 'FAILED'
        self.aggregate['counts']['status'] = 'FAILED'
        self.refuse('source unit log/count mismatch')

    def test_wrong_raw_verdict(self):
        self.raws[1]['steps'][0]['passed'] = False; self.raws[1]['passed'] = False
        self.aggregate['passed'] = False; self.aggregate['shards'][0]['passed'] = False
        self.summary['passed'] = False; self.summary['failed'] = ['python-units']
        self.refuse('source unit exit/verdict differs')

    def test_missing_partition(self):
        self.raws.pop(); self.receipts.pop(); self.plan.pop(); self.summary['combined_from'].pop()
        self.refuse('incomplete Python inventory')

    def test_extra_partition(self):
        self.raws.append(copy.deepcopy(self.raws[-1])); self.receipts.append(copy.deepcopy(self.receipts[-1]))
        self.plan.append(copy.deepcopy(self.plan[-1])); self.summary['combined_from'].append('check-5/summary.json')
        self.payloads['check-5/python-units.log'] = self.payloads['check-4/python-units.log']
        self.refuse('duplicate Python partition')

    def test_missing_log_metadata(self):
        key = 'check-1/python-units.log'; self.payloads[key] = self.payloads[key].split(b'{"unit_shards":')[0]
        self.refuse('Python log partition differs')

    def test_summary_metadata_disagreement(self):
        self.raws[1]['python_shard'] = dict(index=2, total=4, files=self.python_files[:1])
        self.refuse('Python partition differs')

    def test_duplicate_files_within_partition(self):
        self.change_partition(1, lambda p: p['files'].append(p['files'][0]))
        self.refuse('duplicate Python partition')

    def test_timing_metadata_disagreement(self):
        self.raws[1]['steps'][0]['timing'] = dict(files={'unplanned': 1})
        self.refuse('Python timing differs')

    def test_other_step_cannot_repeat(self):
        self.plan[1]['steps'] += ',node-units'
        self.refuse('source shard plan differs')

    def test_partition_metadata_required(self):
        del self.plan[1]['python_shard']
        self.refuse('Python partition differs')

    def test_receipt_name(self):
        self.receipts[1]['shard']['name'] = 'another partition'
        self.refuse('Python receipt differs')

    def test_other_aggregate_step_stays_exact(self):
        self.summary['steps'][0] = dict(self.summary['steps'][0], extra='changed')
        self.refuse('source aggregate step differs')

    def test_source_hash_stays_bound(self):
        self.raws[1]['tools'] = dict(self.tools, release_check='0'*40)
        self.refuse('source release-check input hash differs')

    def test_continuation_dispatch_stays_explicit(self):
        from unittest.mock import patch
        from tools import continuation_envelope
        self.freeze(); source = dict(self.evidence_body['source'], continuation={'explicit': True})
        with patch.object(continuation_envelope, 'validate', return_value='sentinel') as validate:
            self.assertEqual(b.full_source(source, self.judgment, None, None, REPOSITORY, self.head, None), 'sentinel')
            validate.assert_called_once_with(source, self.judgment, None, None, REPOSITORY, self.head, None)


class OtherCorrectionBoundary(unittest.TestCase):
    def test_multiple_failure_headers_with_wrong_block_refuse(self):
        text = ('a (m.C) ... FAIL\nb (m.C) ... FAIL\n\n' + '='*70 + '\nFAIL: a (m.C)\n' + '-'*70 +
                '\none\n\n' + '='*70 + '\nFAIL: b (m.C)\n' + '-'*70 + '\ntwo\n\n' + '-'*70 +
                '\nRan 2 tests in 0.01s\n\nFAILED (failures=2)\n')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'python-units.log').write_text(text.replace('FAIL: b (m.C)', 'FAIL: absent (m.C)'))
            step = dict(name='python-units', passed=False, exit=1, counts=rc.python_counts(text)[0])
            with self.assertRaisesRegex(b.Refused, 'source unit failure blocks differ'):
                b.unit_results(step, root, [dict(name=n+' (m.C)') for n in ('a','b')])

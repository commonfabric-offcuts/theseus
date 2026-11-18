from __future__ import annotations

"""Focused retained-byte controls. Set OWN_RECEIPT_EVIDENCE to the frozen package."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools import base_move

ASSEMBLY = '5a522267fef5a9649d7301200badc9e32ee0fe8a'
TREE = 'ffa8f11f33748139b506659e2c524c2dc5652994'
REPOSITORY = 'commonfabric-offcuts/theseus'


class GenuinePoolReceipt(unittest.TestCase):
    def setUp(self):
        folder = os.environ.get('OWN_RECEIPT_EVIDENCE')
        if not folder:
            self.skipTest('named retained genuine receipt package required')
        self.folder = Path(folder)
        self.assembly, self.tree = ASSEMBLY, TREE
        self.receipt = json.loads((self.folder / 'receipt.json').read_bytes())
        self.expected = [tuple(r) for r in json.loads((self.folder / 'expected.json').read_bytes())]
        self.binding = base_move.document(self.receipt['pool'])
        self.answers = {'actions/runs/44221559712': base_move.document(self.binding['api']['run']),
                        'actions/runs/44221559712/attempts/1/jobs': base_move.document(self.binding['api']['jobs']),
                        'actions/workflows/419227320': base_move.document(self.binding['api']['workflow']),
                        'actions/artifacts/14391686887': base_move.document(self.binding['api']['artifact'])}
        answers = self.answers
        class API:
            def get(self, path):
                return answers[path[len('repos/' + REPOSITORY + '/'):]]
        self.api = API()
        self.temp = tempfile.TemporaryDirectory(prefix='own-receipt-negative-')
        self.addCleanup(self.temp.cleanup)
        self.git = lambda *args: subprocess.run(['git'] + list(args), capture_output=True, text=True)

    def save(self, name, data):
        path = Path(self.temp.name) / name
        path.write_bytes(data if isinstance(data, bytes) else json.dumps(data).encode())
        return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    def consume(self):
        return base_move.own_receipt(self.receipt, self.git, self.api, REPOSITORY, self.assembly, self.tree, self.expected)

    def test_genuine_651_control(self):
        keys, facts = self.consume()
        self.assertEqual(keys, self.expected)
        self.assertEqual(len(keys), 586)
        self.assertEqual(facts['derived']['engine_counts'], {'chromium': 293, 'webkit': 293})
        self.assertEqual(facts['raw']['counts']['tests'], 586)
        self.assertEqual(facts['run'], 44221559712)

    def test_installed_v4_refuses_actual_command_shape(self):
        receipt = dict(self.receipt)
        receipt['step'] = self.save('raw-step.json', (self.folder / 'legacy-raw-step-line.json').read_bytes())
        receipt['snapshot'] = self.save('snapshot.json', (self.folder / 'legacy-derived-snapshot.json').read_bytes())
        with self.assertRaisesRegex(base_move.Refused, 'own-case command/harness binding differs'):
            base_move.legacy_own_receipt(receipt, self.git, ASSEMBLY, TREE, self.expected)

    def freeze(self):
        self.receipt['pool'] = self.save('binding.json', self.binding)

    def change_api(self, key, path, value):
        data = base_move.document(self.binding['api'][key])
        node = data
        for item in path[:-1]:
            node = node[item]
        node[path[-1]] = value
        self.binding['api'][key] = self.save(key + '.json', data)
        endpoint = {'run': 'actions/runs/44221559712', 'jobs': 'actions/runs/44221559712/attempts/1/jobs',
                    'workflow': 'actions/workflows/419227320', 'artifact': 'actions/artifacts/14391686887'}[key]
        self.answers[endpoint] = data
        self.freeze()

    def refuses(self, why):
        with self.assertRaisesRegex(base_move.Refused, why):
            self.consume()

    def replace_archive(self, change):
        # Synthetic negatives only: original hosted ZIP is never rewritten.
        import io
        import zipfile
        from tools import own_case_receipt as own
        with zipfile.ZipFile(io.BytesIO(base_move.artifact(self.binding['artifact']['archive']))) as z:
            members = {n: z.read(n) for n in own.MEMBERS}
        change(members)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            for n, data in members.items():
                z.writestr(n, data)
        data = stream.getvalue()
        self.binding['artifact']['archive'] = self.save('synthetic.zip', data)
        self.change_api('artifact', ['digest'], 'sha256:' + hashlib.sha256(data).hexdigest())
        for key, member in [('step', 'c1.log'), ('report', 'c1/evidence/native.json'), ('log', 'c1/native-compose.log')]:
            if member in members:
                self.receipt[key] = self.save(key + '.raw', members[member])
        self.freeze()

    def report_change(self, change, sync=False):
        def mutate(m):
            report = json.loads(m['c1/evidence/native.json'])
            change(report)
            m['c1/evidence/native.json'] = json.dumps(report).encode()
            if sync:
                rows = report['results']
                old_log = m['c1/native-compose.log'].decode().splitlines()
                caught = [line for line in old_log if line.startswith('CAUGHT ')]
                lines = []
                for row in rows:
                    for line in caught:
                        _, _, _, engine, rest = line.split(' ', 4)
                        mutation = rest.split(':', 1)[0]
                        if row['name'] == '%s item 651 applied mutant %s and restored source' % (engine, mutation):
                            lines.append(line)
                    lines.append('PASS ' + row['name'])
                m['c1/native-compose.log'] = ('\n'.join(lines + ['%d passed, 0 failed' % len(rows)]) + '\n').encode()
                stdout = m['c1.log'].decode().splitlines()
                step = json.loads(stdout[0]); step['counts'].update(tests=len(rows), **{'pass': len(rows)})
                m['c1.log'] = (json.dumps(step) + '\n' + stdout[1] + '\n').encode()
        self.replace_archive(mutate)

    def source_change(self, path, transform, why):
        from unittest import mock
        from tools import own_case_receipt as own
        sources = own.source_bytes(self.git, self.binding['wrapper'], list(own.SOURCES) + [own.SPEC])
        sources[path] = transform(sources[path])
        with mock.patch.object(own, 'source_bytes', return_value=sources):
            self.refuses(why)

    def test_wrong_wrapper_parent(self):
        from unittest import mock
        with mock.patch.object(base_move, 'parents', return_value=['0' * 40]):
            self.refuses('wrapper parent')

    def test_wrong_wrapper_tree(self):
        from unittest import mock
        original = base_move.entries
        def changed(git, head):
            result = original(git, head)
            if head == self.binding['wrapper']:
                result['web/app.mjs'] = '100644 blob ' + '0' * 40
            return result
        with mock.patch.object(base_move, 'entries', side_effect=changed):
            self.refuses('wrapper tree')

    def test_wrong_spec_fields(self):
        self.source_change('.github/pool-run.json', lambda v: json.dumps(dict(json.loads(v), override=True)).encode(), 'invalid fields')

    def test_wrong_spec_step(self):
        self.source_change('.github/pool-run.json', lambda v: v.replace(b'compose', b'reader'), 'step/filter')

    def test_wrong_spec_filter(self):
        self.source_change('.github/pool-run.json', lambda v: v.replace(b'item 651', b'item 719'), 'step/filter')

    def test_wrong_spec_snapshot(self):
        self.source_change('.github/pool-run.json', lambda v: v.replace(ASSEMBLY.encode(), b'0' * 40), 'spec snapshot')

    def test_wrong_command(self):
        self.source_change('.github/workflows/pool.yml', lambda v: v.replace(b'tools/native.py', b'tools/mutant.py'), 'source/command')

    def test_wrong_native_source(self):
        self.source_change('tools/native.py', lambda v: v + b'\n# unknown source\n', 'source/command')

    def test_wrong_compose_source(self):
        self.source_change('tests/reader_compose_native.mjs', lambda v: v.replace(b'`${engine} ${name}`', b'name'), 'source/command')

    def test_wrong_helper_source(self):
        self.source_change('tests/thumbnail_open_native.mjs', lambda v: v + b'// changed\n', 'source/command')

    def test_wrong_release_source(self):
        self.source_change('tools/release_check.py', lambda v: v + b'# changed\n', 'source/command')

    def test_wrong_head(self):
        self.change_api('run', ['head_sha'], '0' * 40); self.refuses('run identity')

    def test_wrong_run(self):
        self.change_api('run', ['id'], 44221559713); self.refuses('run identity')

    def test_wrong_attempt(self):
        self.change_api('run', ['run_attempt'], 2); self.refuses('run identity')

    def test_wrong_workflow(self):
        self.change_api('workflow', ['path'], '.github/workflows/checks.yml'); self.refuses('workflow identity')

    def test_wrong_job(self):
        self.change_api('jobs', ['jobs', 0, 'head_sha'], '0' * 40); self.refuses('job identity')

    def test_missing_job_step(self):
        self.change_api('jobs', ['jobs', 0, 'steps'], []); self.refuses('steps incomplete')

    def test_wrong_artifact_digest(self):
        self.change_api('artifact', ['digest'], 'sha256:' + '0' * 64); self.refuses('artifact provenance')

    def test_wrong_artifact_run(self):
        self.change_api('artifact', ['workflow_run', 'id'], 1); self.refuses('artifact provenance')

    def test_wrong_artifact_attempt(self):
        self.change_api('artifact', ['created_at'], '2026-11-17T00:00:00Z'); self.refuses('attempt/upload')

    def test_retained_api_differs(self):
        self.answers['actions/runs/44221559712']['id'] = 1
        self.refuses('retained API run differs')

    def test_archive_byte_digest(self):
        self.binding['artifact']['archive']['sha256'] = '0' * 64; self.freeze(); self.refuses('artifact digest')

    def test_raw_report_digest(self):
        self.receipt['report']['sha256'] = '0' * 64; self.refuses('artifact digest')

    def test_raw_report_not_archive(self):
        report = base_move.document(self.receipt['report']); report['browserClosed'] = False
        self.receipt['report'] = self.save('different.json', report); self.refuses('raw report differs')

    def test_snapshot_dirty(self):
        snap = base_move.document(self.receipt['snapshot']); snap['tree_after']['changes'] = ' M web/app.mjs\n'
        self.receipt['snapshot'] = self.save('dirty.json', snap); self.refuses('snapshot differs or dirty')

    def test_snapshot_wrong_head(self):
        snap = base_move.document(self.receipt['snapshot']); snap['commit'] = '0' * 40
        self.receipt['snapshot'] = self.save('wrong.json', snap); self.refuses('snapshot differs or dirty')

    def test_wrong_phase(self):
        self.report_change(lambda r: r['completedPhases'].pop()); self.refuses('phase or teardown')

    def test_browser_cleanup(self):
        self.report_change(lambda r: r.update(browserClosed=False)); self.refuses('phase or teardown')

    def test_fixture_cleanup(self):
        self.report_change(lambda r: r.update(fixtureExitCode=1)); self.refuses('phase or teardown')

    def test_short_fixture_cleanup(self):
        self.report_change(lambda r: r['shortFixture'].update(exitSignal='SIGTERM')); self.refuses('short fixture teardown')

    def test_unknown_row_schema(self):
        self.report_change(lambda r: r['results'][0].update(engine='chromium')); self.refuses('invalid fields')

    def test_unknown_engine_prefix(self):
        self.report_change(lambda r: r['results'][0].update(name=r['results'][0]['name'].replace('chromium ', 'chrome ', 1)), sync=True)
        self.refuses('unknown engine prefix')

    def test_missing_engine_prefix(self):
        self.report_change(lambda r: r['results'][0].update(name=r['results'][0]['name'][9:]), sync=True)
        self.refuses('unknown engine prefix')

    def test_duplicate_identity(self):
        self.report_change(lambda r: r['results'].append(dict(r['results'][0])), sync=True)
        self.refuses('duplicate Pool case identity')

    def test_missing_identity(self):
        self.report_change(lambda r: r['results'].pop(0), sync=True); self.refuses('incomplete engine identities')

    def test_missing_both_engine_identity(self):
        self.report_change(lambda r: r.update(results=[x for x in r['results'] if 'topic and dossier thumbnails' not in x['name']]), sync=True)
        self.refuses('obligations differ')

    def test_missing_obligation(self):
        self.expected.pop(); self.refuses('obligations differ')

    def test_duplicate_obligation(self):
        self.expected.append(self.expected[0]); self.refuses('obligations differ')

    def test_failed_case(self):
        self.report_change(lambda r: r['results'][0].update(passed=False)); self.refuses('raw case failed')

    def test_wrong_count(self):
        def change(m):
            lines = m['c1.log'].decode().splitlines(); step = json.loads(lines[0]); step['counts']['tests'] = 585
            m['c1.log'] = (json.dumps(step) + '\n' + lines[1] + '\n').encode()
        self.replace_archive(change); self.refuses('raw count')

    def test_wrong_exit(self):
        self.replace_archive(lambda m: m.update({'cases.json': b'[{"case":"item 651","exit":1}]'})); self.refuses('filter/exit')

    def test_wrong_stdout_exit(self):
        self.replace_archive(lambda m: m.update({'c1.log': m['c1.log'].replace(b'"exit": 0', b'"exit": 1')})); self.refuses('raw step/exit')

    def test_duplicate_execution(self):
        self.replace_archive(lambda m: m.update({'cases.json': b'[{"case":"item 651","exit":0},{"case":"item 651","exit":0}]'})); self.refuses('single execution')

    def test_extra_execution_folder(self):
        self.replace_archive(lambda m: m.update({'c2.log': b'extra execution'})); self.refuses('execution archive inventory')

    def test_missing_report(self):
        self.replace_archive(lambda m: m.pop('c1/evidence/native.json')); self.refuses('execution archive inventory')

    def test_wrong_pass_line(self):
        self.replace_archive(lambda m: m.update({'c1/native-compose.log': m['c1/native-compose.log'].replace(b'PASS ', b'FAIL ', 1)})); self.refuses('raw PASS')

    def test_missing_caught_line(self):
        self.replace_archive(lambda m: m.update({'c1/native-compose.log': b'\n'.join(x for x in m['c1/native-compose.log'].splitlines() if not x.startswith(b'CAUGHT ')) + b'\n'})); self.refuses('raw PASS')

    def test_unknown_pool_fields_never_fall_back(self):
        self.binding['fallback'] = True; self.freeze(); self.refuses('invalid fields')

    def legacy_receipt(self):
        rows = [{'name': 'strict legacy case', 'phase': None, 'engine': e, 'passed': True} for e in ('chromium', 'webkit')]
        report = {'results': rows, 'browserClosed': True, 'harnessCompleted': True,
                  'plannedPhases': base_move.ci.PHASES, 'completedPhases': base_move.ci.PHASES,
                  'fixtureExitCode': 0, 'fixtureExitSignal': None}
        step = {'name': 'native-compose', 'exit': 0, 'passed': True, 'tool': 'tests/reader_compose_native.mjs',
                'argv': ['node', 'tests/reader_compose_native.mjs', 'chrome', 'out', 'strict legacy case'],
                'counts': {'tests': 2, 'pass': 2, 'fail': 0, 'failed': [], 'browser_closed': True}}
        return {'snapshot': self.save('legacy-snapshot.json', (self.folder / 'legacy-derived-snapshot.json').read_bytes()),
                'report': self.save('legacy-report.json', report), 'step': self.save('legacy-step.json', step),
                'log': self.save('legacy.log', b'PASS strict legacy case\n')}

    def test_strict_legacy_control(self):
        self.receipt = self.legacy_receipt()
        self.expected = [('native-compose', 'strict legacy case', None, e) for e in ('chromium', 'webkit')]
        keys, facts = self.consume()
        self.assertEqual(keys, self.expected)
        self.assertIsNone(facts)

    def test_strict_legacy_missing_command_refuses(self):
        self.receipt = self.legacy_receipt()
        step = base_move.document(self.receipt['step']); del step['argv']
        self.receipt['step'] = self.save('missing-command.json', step)
        self.refuses('command/harness binding')

    def test_strict_legacy_missing_engine_refuses(self):
        self.receipt = self.legacy_receipt()
        report = base_move.document(self.receipt['report']); del report['results'][0]['engine']
        self.receipt['report'] = self.save('missing-engine.json', report)
        self.refuses('engine differs from harness')

    def test_original_pool_record_digest(self):
        self.binding['record']['sha256'] = '0' * 64; self.freeze(); self.refuses('artifact digest')

    def test_original_pool_record_snapshot(self):
        record = base_move.document(self.binding['record']); record['snapshot'] = '0' * 40
        self.binding['record'] = self.save('wrong-record.json', record); self.freeze(); self.refuses('original record differs')

    def test_boolean_count(self):
        def change(m):
            lines = m['c1.log'].decode().splitlines(); step = json.loads(lines[0]); step['counts']['fail'] = False
            m['c1.log'] = (json.dumps(step) + '\n' + lines[1] + '\n').encode()
        self.replace_archive(change); self.refuses('raw count')

    def test_missing_row_field(self):
        self.report_change(lambda r: r['results'][0].pop('ms')); self.refuses('invalid fields')

    def test_unknown_planned_phases(self):
        self.report_change(lambda r: r['plannedPhases'].append('run:unknown')); self.refuses('phase or teardown')

    def test_missing_fixture_signal(self):
        self.report_change(lambda r: r.pop('fixtureExitSignal')); self.refuses('invalid fields')

    def test_duplicate_json_field(self):
        def change(m):
            m['c1/evidence/native.json'] = m['c1/evidence/native.json'].replace(b'"browserClosed": true', b'"browserClosed": true, "browserClosed": true', 1)
        self.replace_archive(change); self.refuses('duplicate field')

    def test_unknown_geometry_schema(self):
        self.report_change(lambda r: r.update(measured=[{'geometry': 1}])); self.refuses('unsupported measurement schema')

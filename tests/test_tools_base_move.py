from __future__ import annotations

import hashlib
import io
import zipfile
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import copy
import itertools

from tools import deploy, release_check, ci_known_reds as ci, base_move
from test_tools_train import TrainCase, listed, BRANCH, REPOSITORY


def digest(data):
    return hashlib.sha256(data).hexdigest()


class BaseMoveFixture(TrainCase):
    def save(self, name, value):
        path = Path(self.tmp.name) / 'proof' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value if isinstance(value, bytes) else json.dumps(value).encode())
        return {'path': str(path), 'sha256': digest(path.read_bytes())}

    def setUp(self):
        super().setUp()
        for path in release_check.harnesses() + ['tools/release_check.py']:
            self.write(path, '// frozen harness\n')
        self.old = self.L = self.commit('Harness input')
        self.head = self.branch('judged', self.old, [('tools/deploy.py', '# judged\n')])
        self.tested = self.git(self.work, 'commit-tree', self.tree(self.head), '-p', self.old, '-p', self.head,
                               '-m', 'GitHub PR test merge')
        base_changes = [('README', 'new live\n')]
        if getattr(self, 'OVERLAP', False):
            base_changes.append(('tools/deploy.py', '# base changed\n'))
        self.L = self.branch('new-live', self.old, base_changes)
        self.git(self.work, 'push', '-q', 'origin', self.L + ':refs/heads/' + BRANCH)
        self.git(self.live, 'fetch', '-q', 'origin')
        self.git(self.live, 'checkout', '-q', '--detach', self.L)
        self.git(self.work, 'checkout', '-q', 'judged')
        if getattr(self, 'OVERLAP', False):
            conflict = subprocess.run(['git', '-C', str(self.work), 'merge', '--no-commit', '--no-ff', self.L],
                                      capture_output=True, text=True)
            self.assertEqual(conflict.returncode, 1, conflict.stderr)
            self.write('tools/deploy.py', '# judged and base preserved by reviewed resolution\n')
            self.commit('Reviewed conflict resolution')
        else:
            self.git(self.work, 'merge', '-q', '--no-ff', '-m', 'base move', self.L)
        self.assembly = self.git(self.work, 'rev-parse', 'HEAD')
        self.merged = self.merge(self.assembly)
        self.git(self.live, 'fetch', '-q', str(self.work), self.tested)
        self.judgment = {'producer_runs': [101], 'verdict_checks': [201], 'audit': 'm-original-audit'}
        self.github = self.hub(runs=[dict(listed(101, self.head, conclusion='failure'), run_attempt=1,
                                         path='.github/workflows/checks.yml', name='Checks', event='pull_request')],
                               checks=[dict(listed(201, self.head, conclusion='failure'),
                                            details_url='https://github.com/' + REPOSITORY + '/actions/runs/202')])
        self.files, self.inventory = {}, {}
        steps = []
        def put(name, value):
            self.files[name] = self.save('source/' + name, value)
        for name in release_check.REQUIRED:
            step = {'name': name, 'passed': True, 'exit': 0}
            if name in ci.NATIVE:
                native = ci.NATIVE[name]
                rows = [{'name': 'original ' + name, 'passed': name != 'native-journal'}]
                if name == 'native-journal':
                    rows[0]['error'] = 'AssertionError: original fixture failure'
                self.inventory[name] = rows
                report = self.report(rows)
                counts = {'tests': 1, 'pass': int(rows[0]['passed']), 'fail': int(not rows[0]['passed']),
                          'failed': [] if rows[0]['passed'] else [rows[0]['name']], 'browser_closed': True}
                step.update(passed=rows[0]['passed'], exit=int(not rows[0]['passed']))
                step.update(counts=counts, argv=['node', native.harness, 'chrome', 'out'] + list(native.flags))
                put('check-0/native/' + native.name + '/' + native.results, report)
                log = self.log(native, rows)
                if not rows[0]['passed']:
                    log += ci.known_reds.END_LINE + '\n'
            elif name in ci.UNITS:
                row = {'name': 'test_one (test_sample.Sample)'}
                self.inventory[name] = [row]
                log = 'test_one (test_sample.Sample) ... ok\n\nRan 1 test in 0.01s\n\nOK\n'
                if name == 'node-units':
                    self.inventory[name] = [{'name': 'one'}]
                    log = '# Subtest: one\nok 1 - one\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                step['counts'] = (release_check.node_counts(log) if name == 'node-units' else release_check.python_counts(log))[0]
            else:
                traffic = {'routed': ['actor']}
                self.inventory[name] = traffic
                counts = {'actor': {'lost': [], 'wakes': 1, 'delays': [1], 'median': 1}}
                put('check-0/replay/candidate-1/replay.json', {'agents': counts})
                put('check-0/wake-replay-candidate-1.log', b'replay complete\n')
                run = {'passed': True, 'exit': 0, 'counts': counts, 'log': 'replay.log', 'started_at': '1', 'finished_at': '2'}
                step = release_check.replay_step([run], 'start')
                step['runs'] = [run]
                log = 'replay complete\n'
            put('check-0/' + name + '.log', log.encode())
            steps.append(step)
        tools = {'release_check': self.git(self.work, 'rev-parse', self.tested + ':tools/release_check.py'),
                 'harnesses': {p: self.git(self.work, 'rev-parse', self.tested + ':' + p) for p in release_check.harnesses()}}
        raw = {'tools': tools, 'tool': release_check.TOOL, 'commit': self.tested, 'tree_unchanged': True,
               'tree_after': {'head': self.tested, 'changes': ''}, 'required': list(release_check.REQUIRED),
               'steps': steps, 'passed': False, 'only': list(release_check.REQUIRED)}
        put('check-0/summary.json', raw)
        self.original_merge = {'sha': self.tested, 'tree': self.tree(self.tested), 'first_parent': self.old, 'second_parent': self.head}
        self.original_base = {'ref': 'train/previous', 'sha': self.old}
        receipt = {'run': {'id': '101', 'attempt': '1', 'repository': REPOSITORY, 'workflow': 'Checks',
                           'event': 'pull_request', 'workflow_sha': self.tested,
                           'workflow_ref': REPOSITORY + '/.github/workflows/checks.yml@refs/pull/31/merge'},
                   'merge': self.original_merge, 'base': self.original_base, 'base_at_run': self.original_base,
                   'head': {'ref': 'train/source', 'sha': self.head},
                   'summary_sha256': self.files['check-0/summary.json']['sha256'],
                   'shard': {'steps': list(release_check.REQUIRED)}}
        put('check-0/run.json', receipt)
        combined = dict(raw, skipped=None, failed=['native-journal'], combined_from=['check-0/summary.json'])
        del combined['only']
        put('release-check/summary.json', combined)
        put('release-check/provenance.json', {'run': receipt['run'], 'merge': receipt['merge'],
            'required': list(release_check.REQUIRED), 'base': self.original_base, 'base_at_run': self.original_base,
            'head': receipt['head'], 'checked': {'commit': self.tested, 'tree_unchanged': True},
            'plan': [{'name': 'all source steps', 'steps': ','.join(release_check.REQUIRED)}],
            'shards': [{'artifact': 'check-0', 'receipt': receipt, 'commit': self.tested, 'tools': tools,
                        'tree_unchanged': True, 'steps': list(release_check.REQUIRED), 'refused': None}]})
        native = ci.NATIVE['native-compose']
        self.obligations = [{'step': 'native-compose', 'case': 'own case', 'phase': None, 'engine': engine}
                            for engine in ('chromium', 'webkit')]
        self.receipts = []
        for engine in ('chromium', 'webkit'):
            for attempt in range(1):
                rows = [{'name': 'own case', 'phase': None, 'engine': engine, 'passed': True}]
                prefix = 'own/' + engine + str(attempt)
                report = self.save(prefix + '/native.json', self.report(rows))
                log = self.save(prefix + '/step.log', (self.log(native, rows) + str(attempt) + '\n').encode())
                step = {'name': 'native-compose', 'exit': 0, 'passed': True, 'tool': native.harness,
                        'argv': ['node', native.harness, 'chrome', 'out', 'own case'],
                        'counts': {'tests': 1, 'pass': 1, 'fail': 0, 'failed': [], 'browser_closed': True}}
                snapshot = {'head': self.assembly, 'tree': self.tree(self.assembly), 'changes': '',
                            'inputs': {'tests/reader_compose_native.mjs': self.git(self.work, 'rev-parse', self.assembly + ':tests/reader_compose_native.mjs')}}
                self.receipts.append({'step': self.save(prefix + '/step.json', step), 'report': report, 'log': log,
                                      'snapshot': self.save(prefix + '/snapshot.json', snapshot)})
        self.evidence_body = {'version': 4, 'source_head': self.head, 'original_base': self.old,
            'live_base': self.L, 'live_release': 19, 'assembly_head': self.assembly, 'assembly_tree': self.tree(self.assembly),
            'source': {'run': 101, 'attempt': 1, 'tested_merge': self.original_merge, 'base_at_run': self.original_base, 'files': self.files,
                       'inventory': self.save('inventory.json', self.inventory)}, 'receipts': self.receipts}
        self.audit_reds = [{'step': 'native-journal', 'case': ci.identity({'name': 'original native-journal'}),
                            'observed': {'name': 'original native-journal', 'passed': False, 'error': 'AssertionError: original fixture failure'},
                            'attribution': 'known fixture defect', 'ground': 'same fixture assertion on original base',
                            'evidence': [self.files['check-0/native/journal/native.json']]}]
        self.bind_controller()
        self.diff = subprocess.run(['git', '-C', str(self.work), 'diff', '--binary', '--full-index',
                                   '--no-ext-diff', '--no-textconv', self.head, self.assembly], capture_output=True, check=True).stdout
        self.review = {'reviewer': 'independent auditor', 'record': 'm-resolution-review',
                       'judgment_audit': 'm-original-audit', 'evidence_sha256': '',
                       'diff': self.save('resolution.diff', self.diff),
                       'conflict_paths': ['tools/deploy.py'] if getattr(self, 'OVERLAP', False) else [],
                       'obligations': self.obligations}

    def bind_controller(self):
        """Producer API head, tested merge, controller head and App check are separate."""
        self.controller_head = 'e' * 40
        url = 'https://github.com/' + REPOSITORY + '/actions/runs/202'
        self.github.answers['repos/' + REPOSITORY + '/actions/runs/202'] = dict(
            listed(202, self.controller_head, conclusion='success'), name='Verdict',
            path='.github/workflows/verdict.yml', run_attempt=1, event='workflow_run', head_branch='main')
        producer = {'run_id': '101', 'run_attempt': '1', 'event': 'pull_request', 'conclusion': 'failure',
                    'workflow_id': 123, 'workflow_path': '.github/workflows/checks.yml', 'workflow_name': 'Checks',
                    'head_sha': self.head, 'head_branch': 'train/source', 'head_repository': REPOSITORY,
                    'created_at': '2026-11-17T17:00:00Z',
                    'pull_request': {'number': 31, 'head_sha': self.head,
                                     'base_ref': BRANCH, 'base_sha': self.L}}
        controller = {'run_id': '202', 'run_attempt': '1', 'workflow_sha': self.controller_head,
                      'workflow_ref': REPOSITORY + '/.github/workflows/verdict.yml@refs/heads/main',
                      'sha': self.controller_head, 'ref': 'refs/heads/main', 'repository': REPOSITORY, 'url': url}
        self.controller_check = {'name': 'Verdict for ' + BRANCH, 'head_sha': self.head, 'status': 'completed', 'conclusion': 'failure',
                                'details_url': url, 'external_id': '101-1',
                                'output': {'title': 'refused', 'summary': 'Refused:\n- the base is not judged here\nProducer: run 101 attempt 1'}}
        self.published = {'check_run_id': 201, 'head_sha': self.head, 'name': 'Verdict for ' + BRANCH, 'base': BRANCH, 'external_id': '101-1',
                          'controller_run': '202', 'controller_attempt': '1', 'producer_run': '101', 'producer_attempt': '1'}
        self.controller_producer = {'producer': producer, 'controller': controller}
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201'].update(
            self.controller_check, id=201, app={'id': 5763648, 'slug': 'theseus-verdict'},
            pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': {'ref': BRANCH, 'sha': self.L}}])
        self.freeze_controller()

    def freeze_controller(self):
        refs = {}
        for kind, id_, members in [
            ('verdict', 301, {'producer.json': self.controller_producer, 'check-run.json': self.controller_check,
                              'refusals': b'the base is not judged here\n'}),
            ('published', 302, {'published.json': self.published})]:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name, value in members.items():
                    archive.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0)),
                                     value if isinstance(value, bytes) else json.dumps(value).encode())
            ref = self.save(kind + '.zip', stream.getvalue())
            self.github.answers['repos/' + REPOSITORY + '/actions/artifacts/' + str(id_)] = {
                'id': id_, 'name': kind + '-101-1-c1', 'digest': 'sha256:' + ref['sha256'],
                'workflow_run': {'id': 202, 'head_sha': self.controller_head}}
            refs[kind + '_artifact'] = {'id': id_, 'archive': ref}
        self.evidence_body['source']['controller'] = dict(run=202, attempt=1, current_base={'ref': BRANCH, 'sha': self.L}, **refs)

    def freeze_audit(self):
        source = self.evidence_body['source']
        audit = dict(version=1, reviewer='fixture independent auditor', record='m-original-audit', run=101, attempt=1,
                     source_head=self.head, tested_merge=self.original_merge, inventory=source['inventory'],
                     files_sha256=base_move.digest(base_move.canonical(self.files)),
                     summary_sha256=self.files['release-check/summary.json']['sha256'], reds=self.audit_reds)
        audit.update(getattr(self, 'audit_changes', {}))
        source['audit'] = self.save('audit.json', audit)

    def rewrite_source(self, update):
        raw = json.loads(Path(self.files['check-0/summary.json']['path']).read_text())
        receipt = json.loads(Path(self.files['check-0/run.json']['path']).read_text())
        provenance = json.loads(Path(self.files['release-check/provenance.json']['path']).read_text())
        combined = json.loads(Path(self.files['release-check/summary.json']['path']).read_text())
        update(raw, receipt, provenance, combined)
        self.files['check-0/summary.json'] = self.save('updated-source-summary.json', raw)
        receipt['summary_sha256'] = self.files['check-0/summary.json']['sha256']
        self.files['check-0/run.json'] = self.save('updated-source-run.json', receipt)
        provenance['shards'][0]['receipt'] = receipt
        if 'tools' in provenance['shards'][0]:
            provenance['shards'][0]['tools'] = raw['tools']
        self.files['release-check/provenance.json'] = self.save('updated-provenance.json', provenance)
        self.files['release-check/summary.json'] = self.save('updated-combined.json', combined)

    def distinct_tested_merge(self):
        tested = self.git(self.work, 'commit-tree', self.tree(self.head), '-p', self.old, '-p', self.head,
                          '-m', 'GitHub PR test merge')
        def update(raw, receipt, provenance, combined):
            for summary in (raw, combined):
                summary.update(commit=tested, tree_after={'head': tested, 'changes': ''})
            receipt['merge'] = dict(sha=tested, tree=self.tree(tested), first_parent=self.old, second_parent=self.head)
            provenance['merge'] = receipt['merge']
            provenance['checked'] = {'commit': tested, 'tree_unchanged': True}
        self.rewrite_source(update)
        return tested

    def original_unit_red(self):
        log = ('test_one (test_sample.Sample) ... FAIL\n\n'
               '======================================================================\n'
               'FAIL: test_one (test_sample.Sample)\n'
               '----------------------------------------------------------------------\n'
               'Traceback (most recent call last):\n  File "tests/test_sample.py", line 12, in test_one\n'
               '    self.assertTrue(cut_ok)\nAssertionError: False is not true\n\n'
               '----------------------------------------------------------------------\nRan 1 test in 0.01s\n\nFAILED (failures=1)\n')
        self.files['check-0/python-units.log'] = self.save('unit-red.log', log.encode())
        def update(raw, receipt, provenance, combined):
            for summary in (raw, combined):
                step = next(s for s in summary['steps'] if s['name'] == 'python-units')
                step.update(passed=False, exit=1, counts=release_check.python_counts(log)[0])
            combined['failed'].append('python-units')
        self.rewrite_source(update)

    def report(self, rows):
        return {'results': rows, 'closed': True, 'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None,
                'harnessCompleted': True, 'plannedPhases': ci.PHASES, 'completedPhases': ci.PHASES}

    def log(self, native, rows):
        if native.harness == release_check.PERSISTENCE:
            return ''.join(json.dumps({'case': r['name'], 'started': '1'}) + '\n' +
                           json.dumps(dict(r, started='1', finished='2')) + '\n' for r in rows)
        return json.dumps({'closed': True, 'results': rows}, indent=2) + '\n'

    def candidate(self):
        self.freeze_audit()
        self.review['evidence_sha256'] = digest(json.dumps(self.evidence_body, sort_keys=True, separators=(',', ':')).encode())
        body = dict(self.evidence_body, review=self.save('review.json', self.review))
        return self.train(self.merged, [self.head], kind='judged-first', judgment=self.judgment,
                          base_move=self.save('base-move.json', body))

    def refuse(self, words):
        self.refused_train(self.candidate(), self.merged, self.github, words)

class BaseMove(BaseMoveFixture):
    def test_deploy_records_source_failure_and_base_move_without_new_run(self):
        out = self.trained(self.host(), self.candidate(), self.merged, self.github)
        record = self.evidence_of('02-release')['record']['measurements']['train']
        self.assertEqual(record['judgment']['head'], self.head)
        self.assertEqual(record['judgment']['producer_runs'][0]['conclusion'], 'failure')
        self.assertEqual(record['base_move']['assembly_head'], self.assembly)
        self.assertEqual(record['base_move']['source']['run'], 101)
        self.assertEqual(self.evidence_of('00-train')['base_move'], record['base_move'])
        observed = record['base_move']['source_observed']
        self.assertEqual(observed['failed'], ['native-journal'])
        self.assertEqual(observed['steps'][0]['passed'], False)
        self.assertEqual(observed['steps'][0]['exit'], 1)
        self.assertEqual(observed['steps'][0]['counts']['fail'], 1)
        self.assertEqual(observed['controller']['head'], self.controller_head)
        self.assertEqual(observed['controller']['refusals'], 'the base is not judged here\n')
        self.assertIn('summary', record['base_move']['source'])
        self.assertIn('base move', out)

    def test_stale_base(self):
        self.evidence_body['live_base'] = self.old
        self.refuse('live base')

    def test_missing_engine_receipt(self):
        self.evidence_body['receipts'].pop()
        self.refuse('one passing receipt')

    def test_damaged_receipt(self):
        Path(self.receipts[0]['report']['path']).write_text('{}')
        self.refuse('digest')

    def test_absent_receipt(self):
        Path(self.receipts[0]['report']['path']).unlink()
        self.refuse('unreadable')

    def test_unknown_field(self):
        self.evidence_body['override'] = True
        self.refuse('fields')

    def test_resolution_diff_mismatch(self):
        self.review['diff'] = self.save('wrong.diff', b'wrong')
        self.refuse('resolution diff')

    def test_wrong_review_binding(self):
        path = self.candidate()
        body_ref = json.loads(path.read_text())['base_move']
        body = json.loads(Path(body_ref['path']).read_text())
        body['live_release'] = 20
        new = self.save('changed.json', body)
        train = json.loads(path.read_text()); train['base_move'] = new
        path.write_text(json.dumps(train))
        self.refused_train(path, self.merged, self.github, 'review binding')

    def test_duplicate_train_field(self):
        path = self.candidate()
        path.write_text(path.read_text()[:-1] + ', "pr": 31}')
        self.refused_train(path, self.merged, self.github, 'duplicate')

    def test_invalid_source_run_binding(self):
        self.evidence_body['source']['run'] = 102
        self.refuse('source run')

    def test_github_controller_archive_binds_to_original_attempt(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_github_controller_archive_of_another_attempt_refuses(self):
        self.published['producer_attempt'] = '2'
        self.freeze_controller()
        self.refuse('published attempt binding')

    def test_invalid_check_binding(self):
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['details_url'] += '0'
        self.refuse('check binding')

    def test_partial_source(self):
        ref = self.files['release-check/summary.json']
        raw = json.loads(Path(ref['path']).read_text()); raw['steps'].pop()
        self.files['release-check/summary.json'] = self.save('partial.json', raw)
        self.refuse('complete source')

    def test_missing_source_artifact(self):
        del self.files['check-0/run.json']
        self.refuse('source artifact')

    def test_wrong_release_number(self):
        self.evidence_body['live_release'] = 18
        with self.assertRaisesRegex(deploy.Refused, 'live release'):
            self.deployed(self.host(), self.candidate(), self.merged, self.github)
        self.assertEqual(self.kills, [])

    def test_dirty_snapshot(self):
        self.receipts[0]['snapshot'] = self.save('dirty.json', {'head': self.assembly, 'tree': self.tree(self.assembly),
                                                             'changes': ' M README', 'inputs': {}})
        self.refuse('clean snapshot')

    def test_ordinary_cannot_take_record(self):
        path = self.candidate(); raw = json.loads(path.read_text()); raw['kind'] = 'ordinary'
        path.write_text(json.dumps(raw))
        self.refused_train(path, self.merged, self.github, 'judged-first')

    def rewrite_receipt(self, key, update):
        ref = self.receipts[0][key]
        raw = json.loads(Path(ref['path']).read_text())
        update(raw)
        self.receipts[0][key] = self.save('altered-' + key + '.json', raw)

    def test_receipt_wrong_command(self):
        self.rewrite_receipt('step', lambda r: r.update(argv=['node', 'other-harness', 'chrome', 'out']))
        self.refuse('command/harness binding')

    def test_receipt_failed(self):
        self.rewrite_receipt('report', lambda r: r['results'][0].update(passed=False))
        self.refuse('did not pass')

    def test_receipt_browser_not_closed(self):
        self.rewrite_receipt('report', lambda r: r.update(browserClosed=False))
        self.rewrite_receipt('step', lambda r: r['counts'].update(browser_closed=False))
        self.refuse('cleanup')

    def test_receipt_fixture_not_closed(self):
        self.rewrite_receipt('report', lambda r: r.update(fixtureExitCode=1))
        self.refuse('cleanup')

    def test_receipt_wrong_case(self):
        self.rewrite_receipt('report', lambda r: r['results'][0].update(name='different'))
        self.refuse('wrong own case')

    def test_receipt_wrong_counts(self):
        self.rewrite_receipt('step', lambda r: r['counts'].update(tests=9))
        self.refuse('counts')

    def test_receipt_wrong_input_hash(self):
        self.rewrite_receipt('snapshot', lambda r: r['inputs'].update({'tests/reader_compose_native.mjs': 'a' * 40}))
        self.refuse('source input hash')

    def test_duplicate_receipt(self):
        self.evidence_body['receipts'][1] = self.receipts[0]
        self.refuse('duplicate own-case receipt')

    def test_partial_engine_obligations(self):
        self.review['obligations'].pop()
        self.refuse('partial engine')

    def test_duplicate_obligation(self):
        self.review['obligations'].append(self.obligations[0])
        self.refuse('duplicate own-case obligation')

    def test_absent_review(self):
        path = self.candidate()
        ref = json.loads(path.read_text())['base_move']
        body = json.loads(Path(ref['path']).read_text()); del body['review']
        raw = json.loads(path.read_text()); raw['base_move'] = self.save('no-review.json', body)
        path.write_text(json.dumps(raw))
        self.refused_train(path, self.merged, self.github, 'fields')

    def test_freeform_review_alone(self):
        self.review['record'] = self.judgment['audit']
        self.refuse('independent resolution review')

    def test_original_head_mismatch(self):
        self.evidence_body['source_head'] = self.old
        self.refuse('source judgment head')

    def test_wrong_assembly_tree(self):
        self.evidence_body['assembly_tree'] = self.tree(self.head)
        self.refuse('assembly tree')

    def test_unrelated_base(self):
        self.evidence_body['original_base'] = self.assembly
        self.refuse('unrelated heads')

    def test_unknown_source_field(self):
        self.evidence_body['source']['override'] = True
        self.refuse('fields')

    def test_malformed_record(self):
        self.evidence_body['version'] = True
        self.refuse('version')

    def test_source_missing_named_case(self):
        inventory = dict(self.inventory)
        inventory['native-journal'] = [{'name': 'never ran', 'passed': True}]
        self.evidence_body['source']['inventory'] = self.save('missing-case.json', inventory)
        self.refuse('case inventory')

    def test_no_explicit_record_keeps_old_guard(self):
        self.refused_train(self.train(self.merged, [self.head], kind='judged-first', judgment=self.judgment),
                           self.merged, self.github, 'which is not a parent')

    def replace_assembly(self, changes, parent=None):
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        for name, text in changes:
            self.write(name, text)
        tree = self.git(self.work, 'write-tree')
        assembled = self.git(self.work, 'commit-tree', tree, '-p', parent or self.head, '-p', self.L, '-m', 'assembly')
        self.git(self.work, 'reset', '--hard', assembled)  # only this test's temporary repository
        self.assembly = assembled
        self.evidence_body.update(assembly_head=assembled, assembly_tree=self.tree(assembled))
        # Rebuild the alternate release from the same live base, rather than
        # accidentally merging onto the previous candidate release.
        self.git(self.origin, 'update-ref', 'refs/heads/' + BRANCH, self.L)
        self.merged = self.merge(assembled)
        for index, receipt in enumerate(self.receipts):
            snap = json.loads(Path(receipt['snapshot']['path']).read_text())
            snap.update(head=assembled, tree=self.tree(assembled))
            receipt['snapshot'] = self.save('replacement-snapshot-%d.json' % index, snap)
        self.github = self.hub(runs=[dict(listed(101, self.head, conclusion='failure'), run_attempt=1,
                                         path='.github/workflows/checks.yml', name='Checks', event='pull_request')],
                               checks=[dict(listed(201, self.head, conclusion='failure'),
                                            details_url='https://github.com/' + REPOSITORY + '/actions/runs/202')])
        diff = subprocess.run(['git', '-C', str(self.work), 'diff', '--binary', '--full-index', '--no-ext-diff',
                               '--no-textconv', self.head, assembled], capture_output=True, check=True).stdout
        self.review['diff'] = self.save('updated.diff', diff)
        self.bind_controller()

    def test_scope_widening(self):
        self.replace_assembly([('feature.txt', 'new feature')])
        self.refuse('scope widening')

    def test_original_approved_changes_lost(self):
        self.replace_assembly([('tools/deploy.py', '# the deploy\n')])
        self.refuse('approved/base changes lost')

    def test_new_live_changes_lost(self):
        self.replace_assembly([('README', 'Theseus\n')])
        self.refuse('approved/base changes lost')

    def test_wrong_assembly_parents(self):
        extra = self.git(self.work, 'commit-tree', self.tree(self.head), '-p', self.head, '-m', 'intervening commit')
        self.replace_assembly([], parent=extra)
        self.refuse('assembly parents')


    def test_retry_check_without_attempt_binding_refuses(self):
        self.evidence_body['source']['attempt'] = 2
        self.github.answers['repos/' + REPOSITORY + '/actions/runs/101']['run_attempt'] = 2
        self.refuse('controller artifact provenance')

    def test_source_wrong_attempt(self):
        self.evidence_body['source']['attempt'] = 2
        self.refuse('source run identity')

    def test_duplicate_evidence_field(self):
        path = self.candidate()
        raw = json.loads(path.read_text()); ref = raw['base_move']
        data = Path(ref['path']).read_bytes()
        raw['base_move'] = self.save('duplicate.json', data[:-1] + b', "version": 2}')
        path.write_text(json.dumps(raw))
        self.refused_train(path, self.merged, self.github, 'duplicate field')

    def test_source_wrong_harness_hash(self):
        ref = self.files['check-0/summary.json']
        raw = json.loads(Path(ref['path']).read_text())
        raw['tools']['harnesses']['tests/reader_compose_native.mjs'] = '0' * 40
        self.files['check-0/summary.json'] = self.save('bad-source-input.json', raw)
        # Keep the receipt's summary digest consistent: hash validation alone
        # must not let the wrong measured source through.
        ref = self.files['check-0/run.json']
        receipt = json.loads(Path(ref['path']).read_text())
        receipt['summary_sha256'] = self.files['check-0/summary.json']['sha256']
        self.files['check-0/run.json'] = self.save('changed-source-run.json', receipt)
        ref = self.files['release-check/provenance.json']
        provenance = json.loads(Path(ref['path']).read_text()); provenance['shards'][0]['receipt'] = receipt
        self.files['release-check/provenance.json'] = self.save('changed-provenance.json', provenance)
        self.refuse('source harness input hash')


class ResolvedBaseMove(BaseMoveFixture):
    OVERLAP = True

    def test_reviewed_resolution_is_bound_to_actual_tree(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        record = self.evidence_of('02-release')['record']['measurements']['train']
        self.assertEqual(record['base_move']['assembly_tree'], self.tree(self.assembly))
        self.assertFalse(record['base_move']['source_observed']['passed'])

    def test_unreviewed_resolution_path(self):
        self.review['conflict_paths'] = []
        self.refuse('resolution path scope')

    def test_resolution_review_wrong_fields(self):
        self.review['override'] = True
        self.refuse('fields')


class FourFaultControls(BaseMoveFixture):
    """Hand-authored fact shapes; never copied from private operational files."""
    def test_pr_source_head_differs_from_actually_tested_merge(self):
        self.assertNotEqual(self.head, self.tested)
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_verdict_has_separate_controller_run(self):
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['details_url'] = (
            'https://github.com/' + REPOSITORY + '/actions/runs/202')
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_complete_original_python_red_is_preserved(self):
        self.original_unit_red()
        text = Path(self.files['check-0/python-units.log']['path']).read_text()
        failure = text[text.index('FAIL: '):text.index('\n----------------------------------------------------------------------\nRan')]
        self.audit_reds.append({'step': 'python-units', 'case': ci.identity({'name': 'test_one (test_sample.Sample)'}),
                               'observed': {'status': 'FAIL', 'failure': failure}, 'attribution': 'clock fixture',
                               'ground': 'same final-cut assertion on original base',
                               'evidence': [self.files['check-0/python-units.log']]})
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_one_passing_execution_per_engine_suffices(self):
        self.assertEqual(len(self.receipts), 2)
        self.trained(self.host(), self.candidate(), self.merged, self.github)


class V2Refusals(BaseMoveFixture):
    def test_tested_merge_cannot_be_replaced_by_pr_head(self):
        self.evidence_body['source']['tested_merge'] = dict(self.original_merge, sha=self.head)
        self.refuse('source merge binding')

    def test_tested_merge_tree_must_match(self):
        self.original_merge['tree'] = 'f' * 40
        def update(raw, receipt, provenance, combined):
            receipt['merge']['tree'] = 'f' * 40
            provenance['merge']['tree'] = 'f' * 40
        self.rewrite_source(update)
        self.refuse('source merge binding')

    def test_original_base_at_run_cannot_be_new_live(self):
        self.evidence_body['source']['base_at_run'] = {'ref': 'train/new', 'sha': self.L}
        self.refuse('source merge binding')

    def test_controller_artifact_from_another_run(self):
        self.github.answers['repos/' + REPOSITORY + '/actions/artifacts/301']['workflow_run']['id'] = 999
        self.refuse('controller artifact provenance')

    def test_controller_artifact_api_digest_must_match(self):
        self.github.answers['repos/' + REPOSITORY + '/actions/artifacts/301']['digest'] = 'sha256:' + '0' * 64
        self.refuse('controller artifact provenance')

    def test_wrong_verdict_app(self):
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['app']['id'] = 1
        self.refuse('untrusted Verdict App')

    def test_controller_head_is_not_producer_head(self):
        self.controller_producer['controller']['sha'] = self.head
        self.freeze_controller()
        self.refuse('protected controller identity')

    def test_controller_attempt_cannot_be_mixed(self):
        self.published['controller_attempt'] = '2'
        self.freeze_controller()
        self.refuse('published attempt binding')

    def test_refusal_actual_ground_is_preserved(self):
        self.controller_check['output']['summary'] = 'Refused:\n- another assertion\n'
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['output'] = self.controller_check['output']
        self.freeze_controller()
        self.refuse('refusal ground')

    def test_api_refusal_cannot_be_rewritten(self):
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['output'] = {
            'title': 'refused', 'summary': 'Refused: another ground'}
        self.refuse('Verdict output')

    def test_missing_original_red_audit(self):
        self.audit_reds.clear()
        self.refuse('audit missing original red')

    def test_changed_red_failure_audit(self):
        self.audit_reds[0]['observed'] = {'passed': False, 'error': 'different failure'}
        self.refuse('audit red identity/failure')

    def test_changed_red_identity_audit(self):
        self.audit_reds[0]['case']['phase'] = 'other phase'
        self.refuse('audit red identity/failure')

    def test_duplicate_red_audit(self):
        self.audit_reds.append(self.audit_reds[0])
        self.refuse('audit red identity/failure')

    def test_red_audit_requires_evidence(self):
        self.audit_reds[0]['evidence'] = []
        self.refuse('audit red evidence')

    def test_red_audit_binds_complete_inventory(self):
        self.audit_changes = {'inventory': self.save('wrong-inventory.json', {})}
        self.refuse('audit binding')

    def test_red_audit_binds_exact_attempt(self):
        self.audit_changes = {'attempt': True}
        self.refuse('audit binding')

    def test_red_audit_binds_artifact_inventory(self):
        self.audit_changes = {'files_sha256': '0' * 64}
        self.refuse('audit binding')

    def test_source_plan_cannot_omit_a_shard_step(self):
        self.rewrite_source(lambda raw, receipt, provenance, combined: provenance['plan'][0].update(steps='python-units'))
        self.refuse('source shard plan')

    def test_source_original_receipt_head_must_bind(self):
        self.rewrite_source(lambda raw, receipt, provenance, combined: receipt['head'].update(sha=self.old))
        self.refuse('source shard binding')

    def test_missing_python_result_cannot_be_audited_away(self):
        self.files['check-0/python-units.log'] = self.save('missing-unit.log', b'Ran 1 test in 0.01s\n\nOK\n')
        self.refuse('source unit missing individual outcomes')

    def test_duplicate_inventory_identity(self):
        self.inventory['native-journal'].append(self.inventory['native-journal'][0])
        self.evidence_body['source']['inventory'] = self.save('duplicate-inventory.json', self.inventory)
        self.refuse('duplicate or empty source inventory')

    def test_reported_teardown_error_refuses(self):
        self.rewrite_receipt_for_v2('report', lambda report: report.update(teardown=['page close failed']))
        self.refuse('teardown failure')

    def rewrite_receipt_for_v2(self, key, update):
        ref = self.receipts[0][key]
        raw = json.loads(Path(ref['path']).read_text()); update(raw)
        self.receipts[0][key] = self.save('v2-altered-' + key + '.json', raw)

    def test_boolean_receipt_count_is_not_an_integer_measurement(self):
        self.rewrite_receipt_for_v2('step', lambda step: step['counts'].update(tests=True))
        self.refuse('counts/status')

    def test_boolean_red_observation_cannot_be_retyped_as_number(self):
        self.audit_reds[0]['observed']['passed'] = 0
        self.refuse('audit red identity/failure')

    def test_extra_confidence_execution_refuses(self):
        receipt = dict(self.receipts[0])
        receipt['log'] = self.save('extra-run.log', Path(receipt['log']['path']).read_bytes() + b'extra run\n')
        self.receipts.append(receipt)
        self.refuse('one passing receipt')


class NativeSourceHashes(BaseMoveFixture):
    def source_hash(self, value):
        name = 'check-0/native/journal/native.json'
        raw = json.loads(Path(self.files[name]['path']).read_text())
        raw['hashes'] = {'tests/reader_persistence_native.mjs': value}
        self.files[name] = self.save('native-source-hashes.json', raw)

    def test_actual_claimed_source_hash_matches_tested_merge(self):
        self.source_hash(digest(b'// frozen harness\n'))
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_claimed_source_hash_must_not_be_invented(self):
        self.source_hash('0' * 64)
        self.refuse('native source hash differs')


class ControllerProvenance(unittest.TestCase):
    """Public contract only, synthetic bytes; archived38.py is separate real evidence.

    Network alone is replaced with an exact API-path table. No git/browser/deploy.
    """
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='controller-v4-')
        self.addCleanup(self.tmp.cleanup)
        self.head, self.old, self.current, self.controller_head = (c * 40 for c in 'abcd')
        self.current_base = {'ref': 'release/live73', 'sha': self.current}
        self.source = {'run': 101, 'attempt': 1, 'base_at_run': {'ref': 'train/35', 'sha': self.old},
                       'tested_merge': {'sha': 'e' * 40, 'tree': 'f' * 40,
                                        'first_parent': self.old, 'second_parent': self.head},
                       'controller': {'run': 202, 'attempt': 1, 'current_base': self.current_base}}
        self.url = 'https://github.com/' + REPOSITORY + '/actions/runs/202'
        self.binding = {'producer': {'run_id': '101', 'run_attempt': '1', 'head_sha': self.head,
            'head_repository': REPOSITORY, 'event': 'pull_request', 'workflow_name': 'Checks',
            'workflow_path': '.github/workflows/checks.yml', 'conclusion': 'failure', 'head_branch': 'train/source',
            'pull_request': {'number': 31, 'head_sha': self.head, 'base_ref': 'release/live73', 'base_sha': self.current}},
            'controller': {'run_id': '202', 'run_attempt': '1', 'repository': REPOSITORY, 'url': self.url,
            'sha': self.controller_head, 'workflow_sha': self.controller_head, 'ref': 'refs/heads/main',
            'workflow_ref': REPOSITORY + '/.github/workflows/verdict.yml@refs/heads/main'}}
        self.refusals = b'original refusal\n'
        self.check = {'name': 'Verdict for release/live73', 'head_sha': self.head, 'status': 'completed',
            'conclusion': 'failure', 'details_url': self.url, 'external_id': '101-1',
            'output': {'title': 'refused', 'summary': 'Refused:\n- original refusal\n'}}
        self.published = {'check_run_id': 201, 'head_sha': self.head, 'name': self.check['name'],
            'base': 'release/live73', 'external_id': '101-1', 'controller_run': '202',
            'controller_attempt': '1', 'producer_run': '101', 'producer_attempt': '1'}
        self.run = dict(id=202, run_attempt=1, name='Verdict', path='.github/workflows/verdict.yml',
                        event='workflow_run', status='completed', conclusion='success',
                        head_sha=self.controller_head, head_branch='main')
        self.raw = dict(copy.deepcopy(self.check), id=201, app=dict(base_move.VERDICT_APP),
                        pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': dict(self.current_base)}])
        self.api = {'actions/runs/202': self.run, 'check-runs/201': self.raw}
        self.judgment = {'producer_runs': [{'id': 101, 'conclusion': 'failure'}],
                         'verdict_checks': [{'id': 201, 'conclusion': 'failure'}]}
        api = self.api
        class Provider:
            def get(self, path):
                return api[path[len('repos/' + REPOSITORY + '/'):]]
        self.provider = Provider()
        self.freeze()

    def freeze(self):
        for kind, id_, members in [('verdict', 301, {'producer.json': self.binding, 'check-run.json': self.check,
                                                   'refusals': self.refusals}),
                                   ('published', 302, {'published.json': self.published})]:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name, value in members.items():
                    archive.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0)),
                                     value if isinstance(value, bytes) else json.dumps(value).encode())
            path = Path(self.tmp.name) / (kind + '.zip')
            data = stream.getvalue(); path.write_bytes(data)
            self.source['controller'][kind + '_artifact'] = {'id': id_, 'archive': {'path': str(path), 'sha256': digest(data)}}
            self.api['actions/artifacts/' + str(id_)] = {'id': id_, 'name': kind + '-101-1-c1',
                'digest': 'sha256:' + digest(data), 'workflow_run': {'id': 202, 'head_sha': self.controller_head}}

    def consume(self):
        return base_move.controller_binding(self.source, self.judgment, self.provider, REPOSITORY, self.head, None)

    def refuses(self, why):
        with self.assertRaisesRegex(base_move.Refused, why):
            self.consume()

    def test_retargeted_controller_preserves_original_failure(self):
        result = self.consume()
        self.assertEqual(result['current_base'], self.current_base)
        self.assertNotEqual(result['current_base'], self.source['base_at_run'])
        self.assertEqual(result['refusals'], 'original refusal\n')
        self.assertEqual(result['output'], self.check['output'])

    def test_missing_current_base(self):
        del self.source['controller']['current_base']; self.refuses('fields')

    def test_missing_original_base(self):
        del self.source['base_at_run']; self.refuses('fields')

    def test_missing_base_component(self):
        del self.current_base['sha']; self.refuses('fields')

    def test_unknown_base_component(self):
        self.current_base['override'] = True; self.refuses('fields')

    def test_wrong_current_ref(self):
        self.current_base['ref'] = 'release/unknown'; self.refuses('current PR binding')

    def test_wrong_archived_producer_base_sha(self):
        self.binding['producer']['pull_request']['base_sha'] = self.old
        self.freeze(); self.refuses('current PR binding')

    def test_wrong_archived_producer_base_ref(self):
        self.binding['producer']['pull_request']['base_ref'] = 'train/35'
        self.freeze(); self.refuses('current PR binding')

    def test_wrong_current_sha(self):
        self.current_base['sha'] = '0' * 40; self.refuses('current PR binding')

    def test_short_sha(self):
        self.current_base['sha'] = 'abc'; self.refuses('object digest')

    def test_invalid_branch_refs(self):
        for ref in ('', '../x', 'refs/heads/main', '-main', 'a@{x', 'a.lock', 'a b', 'a//b', 'a/', 'a.', '@', 'a\\b', 'a\nb'):
            with self.subTest(ref=ref):
                self.current_base['ref'] = ref; self.refuses('base ref')

    def test_original_first_parent(self):
        self.source['tested_merge']['first_parent'] = self.current; self.refuses('original merge binding')

    def test_original_second_parent(self):
        self.source['tested_merge']['second_parent'] = self.old; self.refuses('original merge binding')

    def test_original_base_sha(self):
        self.source['base_at_run']['sha'] = self.current; self.refuses('original merge binding')

    def test_archived_current_sha(self):
        self.raw['pull_requests'][0]['base']['sha'] = self.old; self.refuses('archived check current PR')

    def test_archived_current_ref(self):
        self.raw['pull_requests'][0]['base']['ref'] = 'train/35'; self.refuses('archived check current PR')

    def test_missing_archived_pr(self):
        self.raw['pull_requests'] = []; self.refuses('empty check association needs merged train context')

    def test_wrong_archived_pr_number(self):
        self.raw['pull_requests'][0]['number'] = 32; self.refuses('archived check current PR')

    def test_wrong_archived_pr_head(self):
        self.raw['pull_requests'][0]['head']['sha'] = self.old; self.refuses('archived check current PR')

    def test_wrong_source_run(self):
        self.binding['producer']['run_id'] = '102'; self.freeze()
        with self.assertRaises(ci.Refused): self.consume()

    def test_wrong_source_head(self):
        self.binding['producer']['head_sha'] = self.old; self.freeze(); self.refuses('producer binding')

    def test_wrong_source_attempt(self):
        self.binding['producer']['run_attempt'] = '2'; self.freeze()
        with self.assertRaises(ci.Refused): self.consume()

    def test_wrong_controller_attempt(self):
        self.run['run_attempt'] = 2; self.refuses('controller run identity')

    def test_wrong_controller_head(self):
        self.binding['controller']['sha'] = self.head; self.freeze(); self.refuses('protected controller identity')

    def test_wrong_controller_ref(self):
        self.binding['controller']['ref'] = 'refs/heads/other'
        self.binding['controller']['workflow_ref'] = REPOSITORY + '/.github/workflows/verdict.yml@refs/heads/other'
        self.freeze(); self.refuses('protected controller identity')

    def test_wrong_app(self):
        self.raw['app']['id'] = 1; self.refuses('untrusted Verdict App')

    def test_wrong_published_name(self):
        self.published['name'] = 'Verdict for release/live73 extra'; self.freeze(); self.refuses('published Verdict binding')

    def test_legacy_name_is_not_a_fallback(self):
        self.published['name'] = self.raw['name'] = self.check['name'] = 'Verdict'
        self.freeze(); self.refuses('published Verdict binding')

    def test_wrong_api_name(self):
        self.raw['name'] = 'Verdict for train/35'; self.refuses('source check binding')

    def test_wrong_archive_check_name(self):
        self.check['name'] = 'Verdict for train/35'; self.freeze(); self.refuses('source check binding')

    def test_wrong_published_base(self):
        self.published['base'] = 'train/35'; self.freeze(); self.refuses('published Verdict binding')

    def test_wrong_external_id(self):
        self.published['external_id'] = '101-2'; self.freeze(); self.refuses('published Verdict binding')

    def test_wrong_api_external_id(self):
        self.raw['external_id'] = '101-2'; self.refuses('source check binding')

    def test_wrong_published_attempt(self):
        self.published['controller_attempt'] = '2'; self.freeze(); self.refuses('published attempt binding')

    def test_wrong_refusal(self):
        self.refusals = b'altered refusal\n'; self.freeze(); self.refuses('refusal ground')

    def test_wrong_output(self):
        self.raw['output']['summary'] = 'rewritten'; self.refuses('Verdict output')

    def test_wrong_archive_hash(self):
        self.source['controller']['verdict_artifact']['archive']['sha256'] = '0' * 64
        self.refuses('artifact digest')

    def test_wrong_api_archive_hash(self):
        self.api['actions/artifacts/301']['digest'] = 'sha256:' + '0' * 64; self.refuses('artifact provenance')

    def test_wrong_archive_run(self):
        self.api['actions/artifacts/301']['workflow_run']['id'] = 101; self.refuses('artifact provenance')


class V4SourceBindings(BaseMoveFixture):
    def test_original_ref_still_binds_provenance(self):
        self.evidence_body['source']['base_at_run'] = dict(self.original_base, ref='train/unknown')
        self.refuse('source merge binding')

    def test_original_base_is_required(self):
        del self.evidence_body['source']['base_at_run']
        self.refuse('fields')

    def test_current_base_is_required(self):
        del self.evidence_body['source']['controller']['current_base']
        self.refuse('fields')

    def test_v3_envelope_is_not_v4(self):
        self.evidence_body['version'] = 3
        self.refuse('unknown version')


class PlainControllerProvenance(unittest.TestCase):
    """Synthetic public-contract isolates for the authentic early-refusal shape."""
    def setUp(self):
        self.f = ControllerProvenance()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        f.current_base.update(f.source['base_at_run'])
        f.binding['producer']['pull_request'].update(base_ref=f.current_base['ref'], base_sha=f.current_base['sha'])
        f.raw['pull_requests'][0]['base'] = dict(f.current_base)
        f.published.update(name='Verdict', base='')
        f.check['name'] = f.raw['name'] = 'Verdict'
        f.freeze()

    def test_plain_controller_preserves_original_failure(self):
        f = self.f; result = f.consume()
        self.assertEqual(result['current_base'], f.source['base_at_run'])
        self.assertEqual(result['refusals'], 'original refusal\n')
        self.assertEqual(result['output'], f.check['output'])

    def test_plain_cannot_take_branch_name(self):
        f = self.f
        f.published['name'] = f.check['name'] = f.raw['name'] = 'Verdict for ' + f.current_base['ref']
        f.freeze(); f.refuses('published Verdict binding')

    def test_plain_publication_base_is_exactly_empty(self):
        f = self.f; f.published['base'] = f.current_base['ref']
        f.freeze(); f.refuses('published Verdict binding')

    def test_plain_missing_publication_base(self):
        f = self.f; del f.published['base']; f.freeze(); f.refuses('published Verdict binding')

    def test_plain_missing_publication_name(self):
        f = self.f; del f.published['name']; f.freeze(); f.refuses('published Verdict binding')

    def test_same_sha_different_ref_is_retargeted(self):
        f = self.f
        f.source['base_at_run']['ref'] = 'train/another'
        f.refuses('published Verdict binding')

    def test_same_ref_different_sha_is_retargeted(self):
        f = self.f
        f.source['base_at_run']['sha'] = f.source['tested_merge']['first_parent'] = f.current
        f.refuses('published Verdict binding')

    def test_plain_authentic_field_negatives(self):
        # Each isolate starts from valid plain bytes. Archive mutations below
        # are explicitly synthetic, never changes to the operational receipts.
        rows = [
            ('producer', ('pull_request', 'base_ref'), 'train/wrong', 'current PR binding'),
            ('producer', ('pull_request', 'base_sha'), '0' * 40, 'current PR binding'),
            ('producer', ('pull_request', 'head_sha'), '0' * 40, 'current PR binding'),
            ('producer', ('head_sha',), '0' * 40, 'producer binding'),
            ('controller', ('sha',), '0' * 40, 'protected controller identity'),
            ('controller', ('ref',), 'refs/heads/wrong', 'protected controller identity'),
            ('published', ('external_id',), '101-2', 'published Verdict binding'),
            ('published', ('controller_attempt',), '2', 'published attempt binding'),
            ('published', ('producer_attempt',), '2', 'published attempt binding'),
            ('published', ('controller_run',), '203', 'published attempt binding'),
            ('published', ('producer_run',), '102', 'published attempt binding'),
            ('check', ('name',), 'Verdict extra', 'source check binding'),
            ('raw', ('name',), 'Verdict extra', 'source check binding'),
            ('raw', ('app', 'id'), 1, 'untrusted Verdict App'),
            ('raw', ('external_id',), '101-2', 'source check binding'),
            ('raw', ('pull_requests', 0, 'number'), 32, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'head', 'sha'), '0' * 40, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'base', 'sha'), '0' * 40, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'base', 'ref'), 'train/wrong', 'archived check current PR'),
            ('raw', ('output', 'summary'), 'fake pass', 'Verdict output')]
        for target, path, value, why in rows:
            with self.subTest(target=target, path=path):
                self.setUp(); f = self.f
                obj = f.binding[target] if target in ('producer', 'controller') else getattr(f, target)
                for key in path[:-1]: obj = obj[key]
                obj[path[-1]] = value
                f.freeze(); f.refuses(why)

    def test_plain_missing_current_fact(self):
        f = self.f; del f.current_base['sha']; f.refuses('fields')

    def test_plain_missing_producer_fact(self):
        f = self.f; del f.binding['producer']['pull_request']['base_sha']
        f.freeze(); f.refuses('current PR binding')

    def test_plain_missing_check_fact(self):
        f = self.f; del f.raw['pull_requests'][0]['base']['sha']; f.refuses('archived check current PR')

    def test_plain_wrong_source_attempt(self):
        f = self.f; f.source['attempt'] = 2; f.refuses('artifact provenance')

    def test_plain_wrong_archive_name(self):
        f = self.f; f.api['actions/artifacts/301']['name'] += '-extra'; f.refuses('artifact provenance')

    def test_plain_wrong_archive_digest(self):
        f = self.f; f.api['actions/artifacts/301']['digest'] = 'sha256:' + '0' * 64; f.refuses('artifact provenance')

    def test_plain_wrong_refusal(self):
        f = self.f; f.refusals = b'another refusal\n'; f.freeze(); f.refuses('refusal ground')


class BranchNamedSameBaseController(unittest.TestCase):
    """Same-base branch naming is a publication shape, not retargeting evidence."""
    def setUp(self):
        self.f = ControllerProvenance()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        f.source['base_at_run'] = dict(f.current_base)
        f.source['tested_merge']['first_parent'] = f.current

    def test_same_base_branch_receipt_preserves_original_failure(self):
        f = self.f; result = f.consume()
        self.assertEqual(result['current_base'], f.source['base_at_run'])
        self.assertEqual(result['output'], f.check['output'])
        self.assertEqual(result['refusals'], 'original refusal\n')
        self.assertEqual(f.check['conclusion'], 'failure')

    def test_crossed_publication_api_archive_names_and_base(self):
        branch = self.f.check['name']
        names = ('Verdict', branch, 'Verdict for other')
        for pub, api, archived, base in itertools.product(
                names, names, names, ('', 'release/live73', 'other')):
            if pub == api == archived == branch and base == 'release/live73':
                continue
            if pub == api == archived == 'Verdict' and base == '':
                continue
            with self.subTest(pub=pub, api=api, archived=archived, base=base):
                self.setUp(); f = self.f
                f.published.update(name=pub, base=base)
                f.raw['name'] = api; f.check['name'] = archived
                f.freeze()
                with self.assertRaises(base_move.Refused): f.consume()

    def test_missing_base_facts_and_publication_fields(self):
        rows = [('source', ('base_at_run',)), ('source', ('base_at_run', 'ref')),
                ('source', ('base_at_run', 'sha')), ('source', ('controller', 'current_base')),
                ('current_base', ('ref',)), ('current_base', ('sha',)),
                ('binding', ('producer', 'pull_request', 'base_ref')),
                ('binding', ('producer', 'pull_request', 'base_sha')),
                ('raw', ('pull_requests', 0, 'base', 'ref')),
                ('raw', ('pull_requests', 0, 'base', 'sha')),
                ('published', ('name',)), ('published', ('base',))]
        for target, path in rows:
            with self.subTest(target=target, path=path):
                self.setUp(); f = self.f; obj = getattr(f, target)
                for key in path[:-1]: obj = obj[key]
                del obj[path[-1]]
                f.freeze()
                with self.assertRaises(base_move.Refused): f.consume()

    def test_authenticated_field_negatives(self):
        rows = [
            ('source', ('base_at_run', 'sha'), '0' * 40, 'original merge binding'),
            ('current_base', ('ref',), 'other', 'current PR binding'),
            ('current_base', ('sha',), '0' * 40, 'current PR binding'),
            ('binding', ('producer', 'pull_request', 'base_ref'), 'other', 'current PR binding'),
            ('binding', ('producer', 'pull_request', 'base_sha'), '0' * 40, 'current PR binding'),
            ('binding', ('producer', 'pull_request', 'head_sha'), '0' * 40, 'current PR binding'),
            ('binding', ('producer', 'head_sha'), '0' * 40, 'producer binding'),
            ('binding', ('producer', 'head_repository'), 'other/repo', 'producer binding'),
            ('binding', ('controller', 'sha'), '0' * 40, 'protected controller identity'),
            ('binding', ('controller', 'ref'), 'refs/heads/other', 'protected controller identity'),
            ('source', ('controller', 'attempt'), 2, 'controller run identity'),
            ('run', ('head_sha',), '0' * 40, 'artifact provenance'),
            ('run', ('path',), '.github/workflows/other.yml', 'controller run identity'),
            ('published', ('check_run_id',), 999, 'published Verdict binding'),
            ('published', ('head_sha',), '0' * 40, 'published Verdict binding'),
            ('published', ('external_id',), '101-2', 'published Verdict binding'),
            ('published', ('controller_attempt',), '2', 'published attempt binding'),
            ('published', ('producer_attempt',), '2', 'published attempt binding'),
            ('published', ('controller_run',), '203', 'published attempt binding'),
            ('published', ('producer_run',), '102', 'published attempt binding'),
            ('raw', ('app', 'id'), 1, 'untrusted Verdict App'),
            ('raw', ('app', 'slug'), 'other', 'untrusted Verdict App'),
            ('raw', ('head_sha',), '0' * 40, 'source check binding'),
            ('raw', ('details_url',), 'other', 'source check binding'),
            ('raw', ('external_id',), '101-2', 'source check binding'),
            ('check', ('external_id',), '101-2', 'source check binding'),
            ('raw', ('conclusion',), 'success', 'source check binding'),
            ('raw', ('pull_requests', 0, 'number'), 32, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'head', 'sha'), '0' * 40, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'base', 'sha'), '0' * 40, 'archived check current PR'),
            ('raw', ('pull_requests', 0, 'base', 'ref'), 'other', 'archived check current PR'),
            ('raw', ('output', 'summary'), 'fake pass', 'Verdict output')]
        for target, path, value, why in rows:
            with self.subTest(target=target, path=path):
                self.setUp(); f = self.f; obj = getattr(f, target)
                for key in path[:-1]: obj = obj[key]
                obj[path[-1]] = value
                f.freeze(); f.refuses(why)

    def test_wrong_source_run_and_attempt(self):
        for key in ('run_id', 'run_attempt'):
            with self.subTest(key=key):
                self.setUp(); f = self.f
                f.binding['producer'][key] = '999'; f.freeze()
                with self.assertRaises(ci.Refused): f.consume()

    def test_wrong_refusal(self):
        f = self.f; f.refusals = b'changed refusal\n'; f.freeze(); f.refuses('refusal ground')

    def test_archive_metadata_identity_and_digest(self):
        rows = [(('name',), 'other'), (('digest',), 'sha256:' + '0' * 64),
                (('workflow_run', 'id'), 101), (('workflow_run', 'head_sha'), '0' * 40)]
        for artifact_id in (301, 302):
            for path, value in rows:
                with self.subTest(artifact=artifact_id, path=path):
                    self.setUp(); f = self.f; obj = f.api['actions/artifacts/' + str(artifact_id)]
                    for key in path[:-1]: obj = obj[key]
                    obj[path[-1]] = value
                    f.refuses('artifact provenance')
        for kind in ('verdict', 'published'):
            with self.subTest(kind=kind):
                self.setUp(); f = self.f
                f.source['controller'][kind + '_artifact']['archive']['sha256'] = '0' * 64
                f.refuses('artifact digest')


class PlainSourceBindings(BaseMoveFixture):
    def setUp(self):
        super().setUp()
        self.controller_producer['producer']['pull_request'].update(
            base_ref=self.original_base['ref'], base_sha=self.original_base['sha'])
        self.controller_check['name'] = self.published['name'] = 'Verdict'
        self.published['base'] = ''
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201'].update(
            name='Verdict', pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': dict(self.original_base)}])
        self.freeze_controller()
        self.evidence_body['source']['controller']['current_base'] = dict(self.original_base)

    def test_plain_full_source_preserves_original_red(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        measured = self.evidence_of('02-release')['record']['measurements']['train']['base_move']
        self.assertFalse(measured['source_observed']['passed'])
        self.assertEqual(measured['source_observed']['controller']['current_base'], self.original_base)
        self.assertNotEqual(measured['source']['tested_merge']['sha'], self.head)

    def test_plain_original_ref_still_binds_provenance(self):
        self.evidence_body['source']['base_at_run']['ref'] = 'train/wrong'
        self.evidence_body['source']['controller']['current_base']['ref'] = 'train/wrong'
        self.controller_producer['producer']['pull_request']['base_ref'] = 'train/wrong'
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['pull_requests'][0]['base']['ref'] = 'train/wrong'
        self.freeze_controller()
        self.evidence_body['source']['controller']['current_base'] = dict(ref='train/wrong', sha=self.old)
        self.refuse('source merge binding')


class BranchNamedSameBaseSourceBindings(BaseMoveFixture):
    def setUp(self):
        super().setUp()
        self.controller_producer['producer']['pull_request'].update(
            base_ref=self.original_base['ref'], base_sha=self.original_base['sha'])
        name = 'Verdict for ' + self.original_base['ref']
        self.controller_check['name'] = self.published['name'] = name
        self.published['base'] = self.original_base['ref']
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201'].update(
            name=name, pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': dict(self.original_base)}])
        self.freeze_controller()
        self.evidence_body['source']['controller']['current_base'] = dict(self.original_base)

    def test_branch_full_source_preserves_original_red(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        measured = self.evidence_of('02-release')['record']['measurements']['train']['base_move']
        self.assertFalse(measured['source_observed']['passed'])
        self.assertEqual(measured['source_observed']['controller']['current_base'], self.original_base)
        self.assertEqual(measured['source_observed']['controller']['refusals'], 'the base is not judged here\n')

    def test_branch_original_ref_still_binds_provenance(self):
        self.evidence_body['source']['base_at_run']['ref'] = 'train/wrong'
        self.controller_producer['producer']['pull_request']['base_ref'] = 'train/wrong'
        self.controller_check['name'] = self.published['name'] = 'Verdict for train/wrong'
        self.published['base'] = 'train/wrong'
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201'].update(
            name='Verdict for train/wrong',
            pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': dict(ref='train/wrong', sha=self.old)}])
        self.freeze_controller()
        self.evidence_body['source']['controller']['current_base'] = dict(ref='train/wrong', sha=self.old)
        self.refuse('source merge binding')

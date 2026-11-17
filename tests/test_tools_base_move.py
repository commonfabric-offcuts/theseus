from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess

from tools import deploy, release_check, ci_known_reds as ci
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
        self.judgment = {'producer_runs': [101], 'verdict_checks': [201], 'audit': 'm-original-audit'}
        self.github = self.hub(runs=[dict(listed(101, self.head, conclusion='failure'), run_attempt=1,
                                         path='.github/workflows/checks.yml', name='Checks')],
                               checks=[dict(listed(201, self.head, conclusion='failure'),
                                            details_url='https://github.com/' + REPOSITORY + '/actions/runs/101')])
        self.files, self.inventory = {}, {}
        steps = []
        def put(name, value):
            self.files[name] = self.save('source/' + name, value)
        for name in release_check.REQUIRED:
            step = {'name': name, 'passed': True, 'exit': 0}
            if name in ci.NATIVE:
                native = ci.NATIVE[name]
                rows = [{'name': 'original ' + name, 'passed': name != 'native-journal'}]
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
        tools = {'release_check': self.git(self.work, 'rev-parse', self.head + ':tools/release_check.py'),
                 'harnesses': {p: self.git(self.work, 'rev-parse', self.head + ':' + p) for p in release_check.harnesses()}}
        raw = {'tools': tools, 'tool': release_check.TOOL, 'commit': self.head, 'tree_unchanged': True,
               'tree_after': {'head': self.head, 'changes': ''}, 'required': list(release_check.REQUIRED),
               'steps': steps, 'passed': False, 'only': list(release_check.REQUIRED)}
        put('check-0/summary.json', raw)
        receipt = {'run': {'id': '101', 'attempt': '1', 'repository': REPOSITORY, 'workflow': 'Checks'},
                   'merge': {'sha': self.head, 'tree': self.tree(self.head), 'first_parent': self.old, 'second_parent': None},
                   'summary_sha256': self.files['check-0/summary.json']['sha256'],
                   'shard': {'steps': list(release_check.REQUIRED)}}
        put('check-0/run.json', receipt)
        combined = dict(raw, skipped=None, failed=['native-journal'], combined_from=['check-0/summary.json'])
        del combined['only']
        put('release-check/summary.json', combined)
        put('release-check/provenance.json', {'run': receipt['run'], 'merge': receipt['merge'],
            'required': list(release_check.REQUIRED), 'shards': [{'artifact': 'check-0', 'receipt': receipt}]})
        native = ci.NATIVE['native-compose']
        self.obligations = [{'step': 'native-compose', 'case': 'own case', 'phase': None, 'engine': engine}
                            for engine in ('chromium', 'webkit')]
        self.receipts = []
        for engine in ('chromium', 'webkit'):
            for attempt in range(3):
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
        self.evidence_body = {'version': 1, 'source_head': self.head, 'original_base': self.old,
            'live_base': self.L, 'live_release': 19, 'assembly_head': self.assembly, 'assembly_tree': self.tree(self.assembly),
            'source': {'run': 101, 'attempt': 1, 'files': self.files,
                       'inventory': self.save('inventory.json', self.inventory)}, 'receipts': self.receipts}
        self.diff = subprocess.run(['git', '-C', str(self.work), 'diff', '--binary', '--full-index',
                                   '--no-ext-diff', '--no-textconv', self.head, self.assembly], capture_output=True, check=True).stdout
        self.review = {'reviewer': 'independent auditor', 'record': 'm-resolution-review',
                       'judgment_audit': 'm-original-audit', 'evidence_sha256': '',
                       'diff': self.save('resolution.diff', self.diff),
                       'conflict_paths': ['tools/deploy.py'] if getattr(self, 'OVERLAP', False) else [],
                       'obligations': self.obligations}

    def report(self, rows):
        return {'results': rows, 'closed': True, 'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None,
                'harnessCompleted': True, 'plannedPhases': ci.PHASES, 'completedPhases': ci.PHASES}

    def log(self, native, rows):
        if native.harness == release_check.PERSISTENCE:
            return ''.join(json.dumps({'case': r['name'], 'started': '1'}) + '\n' +
                           json.dumps(dict(r, started='1', finished='2')) + '\n' for r in rows)
        return json.dumps({'closed': True, 'results': rows}, indent=2) + '\n'

    def candidate(self):
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
        self.assertIn('base move', out)

    def test_stale_base(self):
        self.evidence_body['live_base'] = self.old
        self.refuse('live base')

    def test_missing_engine_receipt(self):
        self.evidence_body['receipts'].pop()
        self.refuse('three passing receipts')

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

    def job_binding(self, check_id):
        self.github.answers['repos/' + REPOSITORY + '/check-runs/201']['details_url'] += '/job/301?pr=31'
        self.github.answers['repos/' + REPOSITORY + '/actions/runs/101/attempts/1/jobs?per_page=100&page=1'] = {
            'total_count': 1, 'jobs': [{'id': 301, 'check_run_url':
                'https://api.github.com/repos/' + REPOSITORY + '/check-runs/' + str(check_id)}]}

    def test_github_job_check_binds_to_original_attempt(self):
        self.job_binding(201)
        self.trained(self.host(), self.candidate(), self.merged, self.github)

    def test_github_job_check_of_another_attempt_refuses(self):
        self.job_binding(999)
        self.refuse('source check binding')

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
                                         path='.github/workflows/checks.yml', name='Checks')],
                               checks=[dict(listed(201, self.head, conclusion='failure'),
                                            details_url='https://github.com/' + REPOSITORY + '/actions/runs/101')])
        diff = subprocess.run(['git', '-C', str(self.work), 'diff', '--binary', '--full-index', '--no-ext-diff',
                               '--no-textconv', self.head, assembled], capture_output=True, check=True).stdout
        self.review['diff'] = self.save('updated.diff', diff)

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
        self.refuse('source check binding')

    def test_source_wrong_attempt(self):
        self.evidence_body['source']['attempt'] = 2
        self.refuse('source run identity')

    def test_duplicate_evidence_field(self):
        path = self.candidate()
        raw = json.loads(path.read_text()); ref = raw['base_move']
        data = Path(ref['path']).read_bytes()
        raw['base_move'] = self.save('duplicate.json', data[:-1] + b', "version": 1}')
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

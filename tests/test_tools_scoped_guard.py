from __future__ import annotations

"""Adversarial synthetic receipts, backed by real isolated Git objects.

These cases launch no browser/server and do not claim historical runs passed.
"""
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from unittest import mock

from tools import deploy, release_check, train as guard, ci_input_reads, train
import test_tools_release_check as fixtures

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'fixture/theseus'


class ScopedGuard(unittest.TestCase):
    def git(self, *args):
        return subprocess.run(['/usr/bin/git', '-C', str(self.repo), '-c', 'user.name=fixture',
                               '-c', 'user.email=fixture@example.invalid'] + list(args), capture_output=True, text=True)

    def ask(self, *args):
        result = self.git(*args); self.assertEqual(result.returncode, 0, result.stderr); return result.stdout.strip()

    def save(self, name, data):
        path = self.folder / name; path.parent.mkdir(parents=True, exist_ok=True)
        raw = data if isinstance(data, bytes) else guard.canonical(data)
        path.write_bytes(raw); return {'path': str(path), 'sha256': guard.digest(raw)}

    def archive(self, id_, name, members, run=101, head=None):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for path, value in members.items():
                archive.writestr(path, value if isinstance(value, bytes) else guard.canonical(value))
        ref = self.save(name + '.zip', stream.getvalue())
        self.answers['repos/%s/actions/artifacts/%d' % (REPOSITORY, id_)] = {
            'id': id_, 'name': name, 'digest': 'sha256:' + ref['sha256'],
            'workflow_run': {'id': run, 'head_sha': head or self.head}}
        return {'id': id_, 'name': name, 'archive': ref}

    def prepare_source(self):
        files = {p: 'import { x } from "./shared.mjs";\n' for p in release_check.harnesses()}
        files.update({'tests/shared.mjs': 'export const x = 1;\n', 'tools/ci-input-reads.json': '{}',
                      'tools/release_check.py': (ROOT / 'tools/release_check.py').read_text(),
                      release_check.REPLAY_FILE: '{"routed":["actor"]}'})
        self.base = fixtures.commit_files(self.repo, files)
        self.head = fixtures.commit_files(self.repo, {'tests/shared.mjs': 'export const x = 2;\n'})

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name); self.repo = self.folder / 'repo'; self.repo.mkdir()
        self.ask('init', '-q')
        self.prepare_source()
        self.tree = self.ask('rev-parse', self.head + '^{tree}')
        self.tested = self.ask('commit-tree', self.tree, '-p', self.base, '-p', self.head, '-m', 'synthetic tested merge')
        self.merge = self.ask('commit-tree', self.tree, '-p', self.base, '-p', self.head, '-m', 'synthetic release merge')
        self.scope = ci_input_reads.pr_record(self.repo, self.base, self.head)
        self.assertEqual(set(self.scope['selected']), set(release_check.REQUIRED))
        self.answers = {}; self.github = mock.Mock(); self.github.get.side_effect = self.answers.__getitem__
        self.judgment = {'head': self.head, 'producer_runs': [{'id': 101, 'conclusion': 'success'}],
                         'verdict_checks': [{'id': 201, 'conclusion': 'success'}], 'audit': 'synthetic-independent-review'}
        self.answers['repos/%s/actions/runs/101' % REPOSITORY] = {
            'id': 101, 'run_attempt': 1, 'head_sha': self.head, 'event': 'pull_request', 'name': 'Checks',
            'path': '.github/workflows/checks.yml', 'status': 'completed', 'conclusion': 'success', 'workflow_id': 123,
            'pull_requests': [{'number': 31, 'head': {'sha': self.head}, 'base': {'ref': 'release/live73', 'sha': self.base}}]}
        self.answers['repos/%s/actions/workflows/123' % REPOSITORY] = {'id': 123, 'path': '.github/workflows/checks.yml'}
        self.controller_head = 'e' * 40
        self.answers['repos/%s/actions/runs/202' % REPOSITORY] = {
            'id': 202, 'run_attempt': 1, 'head_sha': self.controller_head, 'head_branch': 'main', 'event': 'workflow_run',
            'name': 'Verdict', 'path': '.github/workflows/verdict.yml', 'status': 'completed', 'conclusion': 'success'}
        self.base_fact = {'ref': 'release/live73', 'sha': self.base}
        self.tested_merge = {'sha': self.tested, 'tree': self.tree, 'first_parent': self.base, 'second_parent': self.head}
        traffic = json.loads(self.ask('show', self.head + ':' + release_check.REPLAY_FILE))
        self.inventory, self.members, steps = {}, {}, []
        for name in self.scope['selected']:
            step = {'name': name, 'passed': True, 'exit': 0}
            if name in guard.ci.NATIVE:
                native = guard.ci.NATIVE[name]; rows = [{'name': 'synthetic ' + name, 'passed': True}]
                self.inventory[name] = [guard.ci.identity(rows[0])]
                report = {'results': rows, 'closed': True, 'browserClosed': True, 'fixtureExitCode': 0, 'fixtureExitSignal': None,
                          'harnessCompleted': True, 'plannedPhases': guard.ci.PHASES, 'completedPhases': guard.ci.PHASES}
                self.members['native/' + native.name + '/' + native.results] = report
                log = (''.join(json.dumps({'case': r['name'], 'started': '1'}) + '\n' + json.dumps(dict(r, started='1', finished='2')) + '\n' for r in rows)
                       if native.harness == release_check.PERSISTENCE else json.dumps({'closed': True, 'results': rows}, indent=2) + '\n')
                step.update(argv=['node', native.harness, 'chrome', 'out'] + list(native.flags),
                            counts={'tests': 1, 'pass': 1, 'fail': 0, 'failed': [], 'browser_closed': True})
            elif name in guard.ci.UNITS:
                log = 'test_one (synthetic.Sample) ... ok\n\nRan 1 test in 0.01s\n\nOK\n'
                self.inventory[name] = [guard.ci.identity({'name': 'test_one (synthetic.Sample)'})]
                if name == 'node-units':
                    log = '# Subtest: synthetic one\nok 1 - synthetic one\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
                    self.inventory[name] = [guard.ci.identity({'name': 'synthetic one'})]
                step['counts'] = (release_check.node_counts(log) if name == 'node-units' else release_check.python_counts(log))[0]
            else:
                counts = {actor: {'lost': [], 'wakes': 1, 'delays': [1], 'median': 1} for actor in traffic['routed']}
                self.members['replay/candidate-1/replay.json'] = {'agents': counts}
                self.members['wake-replay-candidate-1.log'] = b'synthetic replay complete\n'
                run = {'passed': True, 'exit': 0, 'counts': counts, 'log': 'replay.log', 'started_at': '1', 'finished_at': '2'}
                step = release_check.replay_step([run], 'start'); step['runs'] = [run]
                self.inventory[name] = traffic; log = 'synthetic replay complete\n'
            self.members[name + '.log'] = log.encode(); steps.append(step)
        tools = {'release_check': self.ask('rev-parse', self.tested + ':tools/release_check.py'),
                 'harnesses': {p: self.ask('rev-parse', self.tested + ':' + p) for p in release_check.harnesses()}}
        self.raw = {'tool': release_check.TOOL, 'tools': tools, 'commit': self.tested, 'tree_unchanged': True,
                    'tree_after': {'head': self.tested, 'changes': ''}, 'required': list(release_check.REQUIRED),
                    'steps': steps, 'passed': True, 'only': [s['name'] for s in steps]}
        self.receipt = {'run': {'id': '101', 'attempt': '1', 'repository': REPOSITORY, 'workflow': 'Checks', 'event': 'pull_request',
                        'workflow_sha': self.tested, 'workflow_ref': REPOSITORY + '/.github/workflows/checks.yml@refs/pull/31/merge'},
                        'merge': self.tested_merge, 'base': self.base_fact, 'base_at_run': self.base_fact,
                        'head': {'ref': 'synthetic/source', 'sha': self.head}, 'shard': {'steps': self.raw['only']}}
        self.combined = dict(self.raw, scoped=dict(self.scope, source=self.tested), failed=[], combined_from=['check-0/summary.json'])
        del self.combined['only']
        self.provenance = {'run': self.receipt['run'], 'merge': self.tested_merge, 'base': self.base_fact, 'base_at_run': self.base_fact,
                           'required': list(release_check.REQUIRED), 'head': self.receipt['head'],
                           'checked': {'commit': self.tested, 'tree_unchanged': True},
                           'plan': [{'steps': ','.join(self.scope['selected'])}], 'shards': []}
        url = 'https://github.com/' + REPOSITORY + '/actions/runs/202'
        check = {'id': 201, 'name': 'Verdict', 'head_sha': self.head, 'status': 'completed', 'conclusion': 'success',
                 'details_url': url, 'external_id': '101-1', 'output': {'title': 'green', 'summary': 'synthetic reviewed green'}}
        self.answers['repos/%s/check-runs/201' % REPOSITORY] = dict(check, app=guard.VERDICT_APP,
            pull_requests=[{'number': 31, 'head': {'sha': self.head}, 'base': self.base_fact}])
        producer = {'run_id': '101', 'run_attempt': '1', 'event': 'pull_request', 'conclusion': 'success', 'head_sha': self.head,
                    'head_branch': 'synthetic/source', 'head_repository': REPOSITORY, 'workflow_name': 'Checks',
                    'workflow_path': '.github/workflows/checks.yml', 'pull_request': {'number': 31, 'head_sha': self.head,
                    'base_ref': self.base_fact['ref'], 'base_sha': self.base}}
        controller = {'run_id': '202', 'run_attempt': '1', 'repository': REPOSITORY, 'url': url,
                      'sha': self.controller_head, 'workflow_sha': self.controller_head, 'ref': 'refs/heads/main',
                      'workflow_ref': REPOSITORY + '/.github/workflows/verdict.yml@refs/heads/main'}
        verdict = self.archive(301, 'verdict-101-1-c1', {'producer.json': {'producer': producer, 'controller': controller},
                              'check-run.json': check, 'refusals': b''}, 202, self.controller_head)
        published = self.archive(302, 'published-101-1-c1', {'published.json': {'check_run_id': 201, 'head_sha': self.head,
            'name': 'Verdict', 'base': '', 'external_id': '101-1', 'controller_run': '202', 'controller_attempt': '1',
            'producer_run': '101', 'producer_attempt': '1'}}, 202, self.controller_head)
        self.source = {'run': 101, 'attempt': 1, 'tested_merge': self.tested_merge, 'base_at_run': self.base_fact,
                       'workflow_head': self.tested, 'inventory': self.save('inventory.json', self.inventory),
                       'controller': {'run': 202, 'attempt': 1, 'current_base': self.base_fact,
                                      'verdict_artifact': {k: verdict[k] for k in ('id', 'archive')},
                                      'published_artifact': {k: published[k] for k in ('id', 'archive')}}}

    def freeze(self):
        self.receipt['summary_sha256'] = guard.digest(guard.canonical(self.raw))
        self.members.update({'summary.json': self.raw, 'run.json': self.receipt})
        self.provenance['shards'] = [{'artifact': 'check-0', 'receipt': self.receipt, 'commit': self.tested,
                                     'tree_unchanged': True, 'tools': self.raw['tools'], 'steps': self.raw['only']}]
        self.source['archives'] = [self.archive(401, 'check-0', self.members), self.archive(402, 'release-check', {
            'summary.json': self.combined, 'provenance.json': self.provenance})]
        audit = {'version': 2, 'reviewer': 'synthetic independent auditor', 'record': self.judgment['audit'],
                 'source_head': self.head, 'scope_sha256': guard.digest(guard.canonical(self.scope)),
                 'source_sha256': guard.digest(guard.canonical({k:v for k,v in self.source.items() if k != 'audit'})),
                 'inventory': self.source['inventory']}
        self.source['audit'] = self.save('audit.json', audit)
        return self.save('evidence.json', {'version': 2, 'live_base': self.base, 'source_head': self.head,
                                         'scope': self.scope, 'source': self.source})

    def validate(self, live=None):
        return guard.validate_scoped(self.freeze(), self.judgment, self.git, self.github, REPOSITORY,
                              live or self.base, self.merge, [{'approved_head': self.head}], 31)

    def test_complete_computed_scope_with_exact_evidence_is_admitted(self):
        result = self.validate()
        self.assertEqual(len(result['source']['steps']), len(release_check.REQUIRED))
        self.assertNotEqual(result['source']['workflow_head'], self.head)
        self.assertEqual(result['scope'], self.scope)

    def test_rejects_three_step_shortcut_and_missing_inventory(self):
        chosen = ['python-units', 'node-units', 'deploy-refusals', 'wake-replay',
                  'native-navigation', 'native-rail', 'native-webkit-rail']
        self.scope.update(selected=chosen, steps=[s for s in chosen if s.startswith('native-')],
                          not_run=[s for s in self.scope['required'] if s not in chosen])
        for step in self.scope['not_run']:
            self.scope['coverage'][step]['changed_inputs'] = []
        self.raw['steps'] = [s for s in self.raw['steps'] if s['name'] in chosen]
        self.raw['only'] = [s['name'] for s in self.raw['steps']]
        self.receipt['shard']['steps'] = self.raw['only']
        self.combined['steps'] = self.raw['steps']
        self.combined['scoped'] = dict(self.scope, source=self.tested)
        self.provenance['plan'] = [{'steps': ','.join(self.raw['only'])}]
        self.source['inventory'] = self.save('narrow-inventory.json', {k:v for k,v in self.inventory.items() if k in chosen})
        with self.assertRaisesRegex(guard.ScopedRefused, 'coverage differs'):
            self.validate()

    def test_missing_stale_live_head_base_controller_and_attempt_refuse(self):
        for key, value in (('head_sha', 'a'*40), ('run_attempt', 2), ('event', 'workflow_dispatch'), ('status', 'in_progress')):
            row = self.answers['repos/%s/actions/runs/101' % REPOSITORY]; old = row[key]; row[key] = value
            with self.assertRaises(guard.ScopedRefused, msg=key): self.validate()
            row[key] = old
        with self.assertRaisesRegex(guard.ScopedRefused, 'stale live'):
            self.validate('a'*40)
        check = self.answers['repos/%s/check-runs/201' % REPOSITORY]; check['app'] = {'id': 1, 'slug': 'other'}
        with self.assertRaisesRegex(guard.ScopedRefused, 'App'): self.validate()

    def test_dirty_partial_teardown_and_inventory_refuse_even_after_resealing(self):
        changes = [lambda: self.raw.update(tree_unchanged=False),
                   lambda: self.raw['steps'][4]['argv'].append('one case'),
                   lambda: self.members['native/journal/native.json'].update(teardown='failed'),
                   lambda: self.source.update(inventory=self.save('wrong-inventory.json', {}))]
        for change in changes:
            saved = copy.deepcopy((self.raw, self.members, self.source, self.receipt, self.combined))
            change()
            with self.assertRaises(guard.ScopedRefused): self.validate()
            self.raw, self.members, self.source, self.receipt, self.combined = saved

    def test_raw_unit_inventory_cannot_omit_or_rename_a_check(self):
        inventory = copy.deepcopy(self.inventory)
        inventory['node-units'] = [guard.ci.identity({'name': 'invented different check'})]
        self.source['inventory'] = self.save('renamed-unit-inventory.json', inventory)
        with self.assertRaisesRegex(guard.ScopedRefused, 'unit case inventory differs'):
            self.validate()

    def test_native_input_hash_must_match_the_exact_tested_source(self):
        self.members['native/journal/native.json']['hashes'] = {'tools/release_check.py': '0' * 64}
        with self.assertRaisesRegex(guard.ScopedRefused, 'input hash differs'):
            self.validate()

    def test_missing_archive_and_forged_digest_refuse(self):
        ref = self.freeze(); Path(self.source['archives'][0]['archive']['path']).write_bytes(b'changed')
        with self.assertRaisesRegex(guard.ScopedRefused, 'digest differs'):
            guard.validate_scoped(ref, self.judgment, self.git, self.github, REPOSITORY, self.base, self.merge, [{'approved_head': self.head}], 31)

    def test_judged_first_train_uses_the_owned_scoped_guard_and_keeps_its_refusal(self):
        # Only the pre-existing branch/judgment transport is stood in. The real
        # train loader, diff, scoped graph and raw evidence consumer run here.
        ref = self.freeze()
        data = {'pr': 31, 'merge_commit': self.merge, 'merged_tree': self.tree, 'kind': 'judged-first',
                'items': [{'item': 734, 'approved_head': self.head, 'review': 'synthetic review'}],
                'hosted_run': None, 'judgment': {'producer_runs': [101], 'verdict_checks': [201],
                'audit': self.judgment['audit']}, 'scoped': ref}
        path = self.save('judged-train.json', data)['path']
        with mock.patch.object(train, 'on_branch'), mock.patch.object(train, 'pull_merge'), \
                mock.patch.object(train, 'before_merge', return_value=self.judgment):
            admitted = train.judge(path, self.merge, self.base, 'release/live73', REPOSITORY, self.git, self.github)
            self.assertIn('scope', admitted['scoped'])
            self.assertEqual(admitted['scoped']['scope'], self.scope)
            check = self.answers['repos/%s/check-runs/201' % REPOSITORY]
            check['app'] = {'id': 1, 'slug': 'untrusted'}
            with self.assertRaisesRegex(train.Refused, 'untrusted Verdict App'):
                train.judge(path, self.merge, self.base, 'release/live73', REPOSITORY, self.git, self.github)

    def test_no_record_and_ordinary_train_cannot_use_scoped_exception(self):
        data = {'pr': 31, 'merge_commit': self.merge, 'merged_tree': self.tree, 'kind': 'ordinary',
                'items': [{'item': 734, 'approved_head': self.head, 'review': 'synthetic review'}], 'hosted_run': None,
                'judgment': None, 'scoped': self.freeze()}
        ref = self.save('train.json', data)
        with self.assertRaisesRegex(train.Refused, 'judged-first'):
            train.load(ref['path'])


    def test_scoped_and_base_move_are_exclusive_and_duplicate_keys_still_refuse(self):
        ref = self.freeze()
        data = {'pr': 31, 'merge_commit': self.merge, 'merged_tree': self.tree, 'kind': 'judged-first',
                'items': [{'item': 734, 'approved_head': self.head, 'review': 'synthetic review'}],
                'hosted_run': None, 'judgment': {'producer_runs': [101], 'verdict_checks': [201],
                'audit': self.judgment['audit']}, 'scoped': ref, 'base_move': ref}
        path = self.save('crossed-train.json', data)['path']
        with self.assertRaisesRegex(train.Refused, 'mutually exclusive'):
            train.load(path)
        del data['base_move']
        Path(path).write_text(json.dumps(data)[:-1] + ', "pr":31}')
        with self.assertRaisesRegex(train.Refused, 'duplicate'):
            train.load(path)

    def test_original_python_partition_compatibility_is_scoped_and_exact(self):
        # Complete synthetic receipts with one positive and one empty original
        # partition. No runner or hosted/native test executes here.
        nonpython = copy.deepcopy(self.raw)
        positive = copy.deepcopy(next(s for s in nonpython['steps'] if s['name'] == 'python-units'))
        nonpython['steps'] = [s for s in nonpython['steps'] if s['name'] != 'python-units']
        nonpython['only'] = [s['name'] for s in nonpython['steps']]
        self.inventory['python-units'] = [guard.ci.identity({'name': 'test_one (synthetic.Sample)'})]
        self.source['inventory'] = self.save('partition-inventory.json', self.inventory)
        docs = [nonpython]; content = [copy.deepcopy(self.members)]
        plan = [{'name': 'non Python', 'steps': ','.join(nonpython['only'])}]
        files = ci_input_reads.python_files(ci_input_reads.source_files(self.repo, self.tested))
        for i, count in ((1, 1), (2, 0)):
            part = {'index': i, 'total': 2, 'files': files if i == 1 else []}
            job = {'name': 'original Python %d' % i, 'steps': 'python-units',
                   'python_shard': '%d/2' % i, 'files': part['files']}
            step = dict(positive, tool='unittest', counts={'tests': count, 'status': 'OK'},
                        python_shard=part, timing={}, argv=['python', '/original/tools/unit_shards.py',
                        '--root', '/original', '--shard', job['python_shard']])
            raw = dict(self.raw, steps=[step], only=['python-units'], checkout='/original', python_shard=part)
            log = ('test_one (synthetic.Sample) ... ok\n' if count else '')
            log += '\nRan %d tests in 0.01s\n\nOK\n' % count
            log += json.dumps({'unit_shards': 1, 'python_shard': part, 'tests': count, 'timing': {}}) + '\n'
            docs.append(raw); content.append({'python-units.log': log.encode()}); plan.append(job)
        receipts = [dict(self.receipt, shard={'name': job['name'], 'steps': raw['only']}) for raw, job in zip(docs, plan)]
        combined_steps = guard.combine_scoped_units(docs, plan, receipts)[0]
        combined = dict(self.combined, steps=combined_steps,
                        combined_from=['check-%d/summary.json' % i for i in range(len(docs))])
        def freeze_parts():
            entries, archives = [], []
            for i, (raw, receipt, members) in enumerate(zip(docs, receipts, content)):
                name = 'check-%d' % i
                receipt['summary_sha256'] = guard.digest(guard.canonical(raw))
                members.update({'summary.json': raw, 'run.json': receipt})
                archives.append(self.archive(410+i, name, members))
                entries.append({'artifact': name, 'receipt': receipt, 'commit': self.tested,
                                'tree_unchanged': True, 'tools': raw['tools'], 'steps': raw['only']})
            provenance = dict(self.provenance, plan=plan, shards=entries)
            archives.append(self.archive(420, 'release-check', {'summary.json': combined, 'provenance.json': provenance}))
            self.source['archives'] = archives
            self.source['audit'] = self.save('partition-audit.json', {
                'version': 2, 'reviewer': 'synthetic auditor', 'record': self.judgment['audit'], 'source_head': self.head,
                'scope_sha256': guard.digest(guard.canonical(self.scope)),
                'source_sha256': guard.digest(guard.canonical({k:v for k,v in self.source.items() if k != 'audit'})),
                'inventory': self.source['inventory']})
            return self.save('partition-scoped.json', {'version': 2, 'live_base': self.base,
                            'source_head': self.head, 'scope': self.scope, 'source': self.source})
        def consume():
            return guard.validate_scoped(freeze_parts(), self.judgment, self.git, self.github, REPOSITORY,
                                         self.base, self.merge, [{'approved_head': self.head}], 31)
        self.assertEqual(len(consume()['source']['steps']), len(release_check.REQUIRED) + 1)
        for label, change in (
                ('filtered-command', lambda: docs[1]['steps'][0]['argv'].append('filtered')),
                ('log-metadata', lambda: content[2].update({'python-units.log': b'Ran 0 tests in 1s\nOK\n'})),
                ('summary-metadata', lambda: docs[1]['python_shard'].update(index=2)),
                ('missing-partition', lambda: plan.pop())):
            saved = copy.deepcopy((docs, receipts, content, plan))
            change()
            with self.subTest(label=label), self.assertRaises(guard.ScopedRefused):
                consume()
            docs[:], receipts[:], content[:], plan[:] = saved


class LiveRecheck(unittest.TestCase):
    def test_no_record_moved_record_stale_head_and_dirty_checkout_refuse(self):
        config = mock.Mock(live=Path('/synthetic-live'))
        row = {'release': 94, 'commit': 'a' * 40}
        trained = {'live': row['commit'], 'scoped_live_records': [row]}
        def result(value=''):
            return subprocess.CompletedProcess([], 0, value, '')
        with mock.patch.object(deploy, 'live_records', return_value=[row]), mock.patch.object(deploy, 'run', side_effect=[result(row['commit']), result()]):
            deploy.recheck_scoped_live(config, trained)
        for records, head, dirty in (([], row['commit'], ''), ([dict(row, release=95)], row['commit'], ''),
                                     ([row], 'b'*40, ''), ([row], row['commit'], ' M source.py')):
            with mock.patch.object(deploy, 'live_records', return_value=records), mock.patch.object(deploy, 'run', side_effect=[result(head), result(dirty)]):
                with self.assertRaises(deploy.Refused):
                    deploy.recheck_scoped_live(config, trained)


if __name__ == '__main__':
    unittest.main()

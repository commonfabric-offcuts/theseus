from __future__ import annotations

"""Inert effects around real admission/record/deploy owners; never a recovery implementation.

Construction is deferred until a test method runs. Every path/profile/database
belongs to the test's TemporaryDirectory. No real service or notification runs.
"""
import io
import json
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
from types import SimpleNamespace
from unittest import mock
from contextlib import ExitStack, redirect_stdout

from aim_next import Store, initialize, cli, admin
from aim_next.profile import write_profile
from aim_next.store import SCHEMA_VERSION
from tools import deploy, releases
import test_deterministic_admission_1131 as deterministic_fixture


def retain(case, root, extra=None):
    """Copy only synthetic evidence/logs, never a DB, authority or profile.

    The separately routed driver supplies one unused root per phase. Original
    paths stay in the manifest; copying never rewrites a judgment or raw log.
    """
    selected = os.environ.get('AIM_1137_EVIDENCE')
    if selected is None:
        return
    target = Path(selected)/case.id().rsplit('.', 1)[-1]
    target.mkdir(parents=True, exist_ok=False)
    manifest = {}
    for source in Path(root).rglob('*'):
        name = source.relative_to(root)
        if name.parts[0] in ('repo', 'instance', 'control') or not source.is_file():
            continue
        if source.suffix not in ('.json', '.log', '.py') and not source.name.startswith('raw-'):
            continue
        raw = source.read_bytes(); dest = target/name; dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        manifest[str(source)] = {'copy': str(name), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    (target/'retained-manifest.json').write_text(json.dumps({'files': manifest, 'trace': extra or {}}, indent=2))


class OpenPR:
    def __init__(self, world):
        self.world, self.asked = world, []
        self.pull = {'number': 1, 'state': 'open', 'merged': False,
                     'merge_commit_sha': None,
                     'base': {'sha': world.base, 'ref': world.branch,
                              'repo': {'full_name': world.repository}},
                     'head': {'sha': world.candidate, 'repo': {'full_name': world.repository}}}
        self.contained = world.base

    def get(self, path):
        self.asked.append(path)
        if '/compare/' in path:
            return {'status': 'identical', 'behind_by': 0,
                    'merge_base_commit': {'sha': self.contained}}
        if path.endswith('/pulls/1'):
            return self.pull
        raise deploy.train_check.Unreadable('isolated API has no such observation: '+path)


class PremergeWorld:
    def __init__(self, case):
        self.case = case
        self.fixture = deterministic_fixture.Deterministic1131()
        self.fixture.setUp()
        case.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        self.root = f.root.resolve()
        self.base, self.candidate, self.tree = f.base, f.head, f.tree
        self.branch, self.repository = 'release/scratch', 'scratch/release-machine1137'
        self.config = SimpleNamespace(**vars(f.config), outcome=None, release_branch=self.branch,
                                      repository=self.repository, server_profile=self.root/'operator.json')
        self.github = OpenPR(self)
        self.calls = []
        self.train = self.root/'train.json'; self.judgment = self.root/'judgment.json'
        self.write_inputs()
        case.addCleanup(lambda: retain(case, self.root, {'commands': self.calls,
                                                       'github_reads': self.github.asked}))

    def write_inputs(self):
        f = self.fixture
        self.train.write_text(json.dumps({'pr': 1, 'merge_commit': self.candidate,
            'merged_tree': self.tree, 'kind': 'judged-first',
            'items': [{'item': 1131, 'approved_head': f.source, 'review': 'scratch independent source approval'}],
            'hosted_run': None, 'judgment': f.value}))
        self.judgment.write_text(json.dumps(f.value))

    def run(self, argv, **kw):
        self.calls.append(list(argv))
        if argv[0] == 'git':
            return subprocess.run(argv, capture_output=True, text=True)
        if 'releases' in argv:
            row = {'release': 1, 'commit': self.base, 'items': [], 'previous': None,
                   'deployed_at': '2026-11-23T00:00:00+00:00', 'source': 'backfill',
                   'measurements': None, 'evidence': None}
            return subprocess.CompletedProcess(argv, 0, json.dumps({'items': [row]}), '')
        # The existing executable bound scratch adapter serves pipeline/source;
        # it does not open a live Core store or borrow another actor's profile.
        if argv[-1:] == ['binding'] or argv[-2:] == ['view', '-']:
            return subprocess.run(argv, capture_output=True, text=True, **kw)
        raise AssertionError('unexpected effect/read in isolated premerge port: %r' % argv)

    def prepare(self, name='evidence'):
        with mock.patch.object(deploy, 'run', self.run), \
                mock.patch.object(deploy, 'processes', side_effect=AssertionError('no process inspection')), \
                mock.patch.object(deploy, 'runner_policy', side_effect=AssertionError('no runner preparation')), \
                mock.patch.object(deploy.os, 'kill', side_effect=AssertionError('no process signal')), \
                mock.patch.object(deploy, 'start', side_effect=AssertionError('no process start')):
            return deploy.rehearse(self.config, self.candidate, self.root/name, self.train, self.judgment,
                                   number=2, github=self.github)


class Process:
    def __init__(self, pid):
        self.pid, self.returncode = pid, None

    def poll(self):
        return self.returncode


class MachineWorld:
    """Real owned Git/SQLite/profile facts, stubbed OS/network/notification ports.

    The server-schema Git blob declares the fake service port's supported schema.
    It is not a substitute for a production schema-compatibility check. The port
    refuses an incompatible start; it never performs recovery for the product.
    """
    def __init__(self, case, root, *, target_schema=None):
        self.case, self.root = case, Path(root).resolve()
        self.repo, self.instance = self.root/'repo', self.root/'instance'
        self.repo.mkdir(); self.instance.mkdir()
        self.db = self.instance/'data.sqlite3'
        init = initialize(self.db, 'machine1137', [{'id': 'owner', 'kind': 'human'},
            {'id': 'operator', 'kind': 'agent'}, {'id': 'runner', 'kind': 'agent'}],
            authority_path=self.root/'control'/'authority.json')
        self.binding = init['binding']
        self.store = Store(self.db, 'machine1137', expected_binding=self.binding)
        self.serial = 0
        for actor in ('operator', 'runner'):
            write_profile(self.instance/(actor+'.json'), str(self.db), 'machine1137', actor, binding=self.binding)
        self.command('workspace.create', {'id': 'w1', 'title': 'Isolated1137',
                     'team': ['operator', 'runner'], 'coordinator': 'operator'})
        self.command('pipeline.configure', {'enabled': True}, {'workspace_id': 'w1'},
                     {'pipeline_revision': 0})
        self.git('init', '-q'); self.git('config', 'user.name', 'Scratch1137')
        self.git('config', 'user.email', 'scratch1137@example.invalid')
        (self.repo/'aim_next').mkdir(); (self.repo/'aim_next/releases.py').write_text('# store keeps release records\n')
        (self.repo/'server-schema').write_text(SCHEMA_VERSION)
        (self.repo/'README').write_text('base\n')
        self.base = self.commit('base')
        (self.repo/'README').write_text('candidate\n')
        (self.repo/'server-schema').write_text(target_schema or SCHEMA_VERSION)
        self.candidate = self.commit('candidate\n\nPipeline: 1137')
        self.git('checkout', '-q', '--detach', self.base)
        self.store.record_release({'release': 1, 'commit': self.base, 'items': [], 'previous': None,
            'deployed_at': '2026-11-23T00:00:00+00:00', 'source': 'backfill'})
        for name, pid in (('server', 111), ('runner', 222)):
            folder = self.instance/('run-'+name+'-01'); folder.mkdir()
            (folder/'pid.json').write_text(json.dumps({'pid': pid}))
            if name == 'runner':
                (folder/'stdout.log').write_text('{"event":"acquired"}\n{"status":"stopped"}\n')
        (self.instance/'routes.json').write_text('{"routes":{}}')
        raw = {'live': str(self.repo), 'instance': str(self.instance), 'server_profile': 'operator.json',
               'runner_profile': 'runner.json', 'runner_id': 'scratch-runner1137', 'routes': 'routes.json',
               'port': 5192, 'pipeline_outcome': 'w1', 'pipeline_instance': 'machine1137',
               'pipeline_profile': str(self.instance/'operator.json')}
        path = self.root/'config.json'; path.write_text(json.dumps(raw)); self.config = deploy.load_config(path)
        self.active = {111: 'server', 222: 'runner'}
        self.process_argv = {111: deploy.server_argv(self.config), 222: deploy.runner_argv(self.config)}
        self.run_paths = {111: self.instance/'run-server-01', 222: self.instance/'run-runner-01'}
        self.identities = {111: 'owned1137-111', 222: 'owned1137-222'}
        self.calls, self.starts, self.notifications, self.producers, self.signals = [], [], [], [], []
        self.next_pid = 500
        self.backup_exit = 0; self.migration_exit = 0; self.fail_candidate_ready = False
        self.summary = self.root/'summary.json'; self.write_summary()
        case.addCleanup(lambda: retain(case, self.root, {'commands': self.calls, 'starts': self.starts,
            'signals': self.signals, 'active_stub_processes': self.active,
            'notifications': self.notifications, 'producer_requests': self.producers}))

    def command(self, kind, args, target=None, expected=None):
        self.serial += 1
        receipt = self.store.command('owner', {'v': 1, 'instance_id': 'machine1137',
            'operation_id': 'scratch1137-%d' % self.serial, 'kind': kind, 'args': args,
            'target': target or {}, 'expected': dict(expected or {}, authority={
                k: self.binding[k] for k in ('authority_id', 'authority_epoch')})})
        self.case.assertEqual(receipt.get('status'), 'committed', receipt)
        return receipt['result']

    def git(self, *args):
        done = subprocess.run(['git', '-C', str(self.repo)]+list(args), capture_output=True, text=True)
        self.case.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def commit(self, words):
        self.git('add', '.'); self.git('commit', '-qm', words)
        return self.git('rev-parse', 'HEAD')

    def schema(self):
        with sqlite3.connect(str(self.db)) as db:
            return db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]

    def write_summary(self, failure=None, note='retained completed evidence'):
        from tools import release_check
        steps = [{'name': n, 'exit': int(n == 'node-units' and failure is not None),
                  'passed': not (n == 'node-units' and failure is not None),
                  'counts': {'tests': 1, 'pass': int(failure is None), 'fail': int(failure is not None),
                             'failed': [failure] if failure else []}}
                 for n in release_check.REQUIRED]
        self.summary.write_text(json.dumps({'tool': release_check.TOOL, 'commit': self.candidate,
            'tree_unchanged': True, 'required': list(release_check.REQUIRED), 'steps': steps,
            'passed': failure is None, 'note': note}))

    def report(self, config, *args):
        answer = self.run([config.python, '-I', '-B', str(config.live/'bin/aim-next'),
                          '--profile', str(config.pipeline_profile), '--json']+list(args))
        rows = [json.loads(line) for line in answer.stdout.splitlines() if line.startswith('{')]
        self.case.assertEqual(answer.returncode, 0, answer.stderr)
        return rows[-1]['result']

    def run(self, argv, **kw):
        self.calls.append(list(argv))
        if argv[0] == 'git':
            return subprocess.run(argv, capture_output=True, text=True)
        if argv[:2] == ['ps', '-axo']:
            rows = []
            for pid, kind in self.active.items():
                rows.append('%d 1 %s' % (pid, ' '.join(self.process_argv[pid])))
            return subprocess.CompletedProcess(argv, 0, '\n'.join(rows), '')
        if '-c' in argv:
            return subprocess.CompletedProcess(argv, self.backup_exit, '{}', 'controlled backup refusal' if self.backup_exit else '')
        if 'migrate' in argv:
            if self.migration_exit:
                return subprocess.CompletedProcess(argv, self.migration_exit, '', json.dumps({
                    'code': 'MIGRATION_FAILED', 'message': 'The upgrade failed; nothing was changed',
                    'injected_port': 'post-fast-forward migration refusal; no production DDL or live backup used'}))
            target = self.git('show', self.candidate+':server-schema')
            with sqlite3.connect(str(self.db)) as db:
                db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (target,))
            return subprocess.CompletedProcess(argv, 0, json.dumps({'to': target}), '')
        if any(str(a).endswith('signal-fyi.sh') or a == 'notify' for a in argv):
            self.notifications.append(list(argv))  # Never deduplicate for the product.
            return subprocess.CompletedProcess(argv, 0, 'stub notification recorded', '')
        if any('release_check.py' in str(a) or 'unit_shards.py' in str(a) for a in argv):
            self.producers.append(list(argv))
            raise AssertionError('unchanged completed producer evidence must not be replayed')
        name = 'aim-next-admin' if any(str(a).endswith('/bin/aim-next-admin') for a in argv) else 'aim-next'
        marker = str(self.repo/'bin'/name)
        if marker in argv:
            out, err = io.StringIO(), io.StringIO()
            args = argv[argv.index(marker)+1:]
            if name == 'aim-next-admin':
                code = admin.main(args, stdout=out, stderr=err)
            else:
                source = io.BytesIO(kw.get('input', '').encode())
                code = cli.main(args, stdin=source, stdout=out, stderr=err)
            return subprocess.CompletedProcess(argv, code, out.getvalue(), err.getvalue())
        raise AssertionError('unexpected isolated effect port: %r' % argv)

    def signal(self, pid, sig):
        self.case.assertIn(pid, self.active, 'only owned simulated identities can be signalled')
        self.signals.append({'pid': pid, 'signal': sig, 'identity': self.identities[pid]})
        if self.active[pid] == 'runner':
            with (self.run_paths[pid]/'stdout.log').open('a') as out:
                out.write('{"status":"stopped"}\n')
        del self.active[pid]

    def start(self, config, revision, argv, run_dir, previous, source=None):
        supported = self.git('show', revision+':server-schema')
        self.case.assertEqual(supported, self.schema(), 'an incompatible tree must not start against the actual DB')
        kind = 'server' if any(str(a).endswith('/bin/aim-next-server') for a in argv) else 'runner'
        self.case.assertNotIn(kind, self.active.values(), 'duplicate owned service process')
        self.next_pid += 1; process = Process(self.next_pid)
        self.active[process.pid] = kind
        self.process_argv[process.pid] = list(argv)
        self.identities[process.pid] = 'owned1137-%d' % process.pid
        self.run_paths[process.pid] = run_dir
        self.starts.append({'pid': process.pid, 'kind': kind, 'revision': revision,
                            'schema': self.schema(), 'previous': previous, 'source': source, 'argv': list(argv)})
        run_dir.mkdir()
        (run_dir/'pid.json').write_text(json.dumps({'pid': process.pid}))
        return process

    def ready(self, path, process):
        kind = self.active[process.pid]
        if kind == 'server':
            line = json.dumps({'status': 'refused' if self.fail_candidate_ready else 'ready'})
        else:
            line = '{"event":"acquired"}'
        Path(path).write_text(line+'\n')
        return line

    def invoke(self, evidence, *, candidate=None, number=None, dry=False):
        with ExitStack() as stack:
            for owner, attr, value in ((deploy, 'run', self.run), (deploy, 'identity', lambda p: self.identities[p]),
                    (deploy.os, 'kill', self.signal), (deploy, 'wait_exit', lambda p: 'exited'),
                    (deploy, 'start', self.start), (deploy, 'wait_line', self.ready),
                    (deploy, 'as_reporter', self.report), (deploy.urllib.request, 'urlopen',
                        lambda *a, **k: SimpleNamespace(status=200, read=lambda: b'{"fixture":"1137"}'))):
                stack.enter_context(mock.patch.object(owner, attr, value))
            stack.enter_context(redirect_stdout(io.StringIO()))
            deploy.deploy(self.config, candidate or self.candidate, Path(evidence), self.summary, dry, number=number)

    def repair_items(self):
        page = self.store.view('operator', 'pipeline', {'workspace_id': 'w1', 'section': 'candidates', 'limit': 100})
        self.case.assertNotIn('error', page, page)
        return page['items']

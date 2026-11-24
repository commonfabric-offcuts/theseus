from __future__ import annotations

"""Real scratch Git, HTTP, Core and hosted stdio across deploy.

The app-server is the existing scripted subprocess fixture, not a model.
Only fault injection replaces a deploy command; successful cutovers use the
actual backup, fast-forward, migration, process signals and verification.
"""

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
import unittest
from unittest import mock
import urllib.request

from tools import deploy, release_check, runner_runtime
from test_codex_host import AGENT, HostCase, INSTANCE, ROOT


class Events:
    def __init__(self, case, process, directory):
        self.case, self.process, self.directory = case, process, directory
        self.events = []
        self.reader = (directory / 'stdout.log').open()
        self.watch = select.kqueue()
        self.watch.control([select.kevent(self.reader.fileno(), select.KQ_FILTER_VNODE,
                            select.KQ_EV_ADD | select.KQ_EV_CLEAR, select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND)], 0)
        case.addCleanup(self.watch.close)
        case.addCleanup(self.reader.close)

    def event(self, name, **fields):
        deadline = time.monotonic() + 60
        while True:
            line = self.reader.readline()
            if line:
                value = json.loads(line)
                self.events.append(value)
                if value.get('event') == name and all(value.get(k) == v for k, v in fields.items()):
                    return value
            else:
                left = deadline - time.monotonic()
                self.case.assertGreater(left, 0, 'missing %s; events=%r; stderr=%s' %
                                        (name, self.events[-8:], (self.directory / 'stderr.log').read_text()[-2000:]))
                self.case.assertIsNone(self.process.poll(), 'runner ended before ' + name)
                self.watch.control(None, 1, min(left, 5))


class DeployHost938Case(HostCase):
    turns = [{'hold': 'steer', 'reply': 'held writing kept', 'reply_to_delivery': True},
             {'hold': 'interrupt'}, {'reply': 'continued', 'reply_to_delivery': True}]

    def setUp(self):
        super().setUp()
        self.repo = self.root / 'checkout'
        self.repo.mkdir()
        # Export this checkout's actual runtime, including the policy under
        # construction, rather than embedding product bodies in the test.
        files = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z', 'aim_next', 'bin', 'web']).split(b'\0')
        for name in [os.fsdecode(value) for value in files if value] + ['tools/runner_runtime.py']:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(ROOT / name), str(target))
        self.git('init', '-q')
        self.git('config', 'user.name', 'Deploy fixture')
        self.git('config', 'user.email', 'deploy@example.invalid')
        self.base = self.commit('scratch runtime')
        self.instance = self.db.parent
        (self.instance / 'backups').mkdir(mode=0o700)
        # The fixture's explicitly bound CLI follows the scratch web checkout.
        self.cli.write_text('#!/usr/bin/python3 -I\nimport os,sys\nos.execv("/usr/bin/python3",'
                            '["/usr/bin/python3","-I",%r]+sys.argv[1:])\n' % str(self.repo / 'bin/aim-next'))
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        self.deploy_config = deploy.Config(self.repo, self.instance, '/usr/bin/python3', self.lead_profile,
                                           port, None, self.lead_profile, 'host-fixture', self.map,
                                           None, None, None, None)
        self.started = []
        self.addCleanup(self.cleanup_processes)
        self.server = self.launch(deploy.server_argv(self.deploy_config), 'server', 1)
        self.assertEqual(json.loads(deploy.wait_line(self.instance / 'run-server-01/stdout.log', self.server))['status'], 'ready')
        self.source = runner_runtime.prepare(self.deploy_config, self.base)
        self.host = self.launch(deploy.supervisor_argv(self.deploy_config, self.source), 'runner', 1, self.source)
        self.events = Events(self, self.host, self.instance / 'run-runner-01')
        self.events.event('acquired')

    def git(self, *args):
        done = subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def commit(self, message):
        self.git('add', '.')
        self.git('commit', '-qm', message)
        return self.git('rev-parse', 'HEAD')

    def candidate(self, name='web/index.html', suffix='\n<!-- scratch candidate -->\n'):
        with (self.repo / name).open('a') as handle:
            handle.write(suffix)
        target = self.commit('scratch candidate')
        self.git('reset', '--hard', self.base)
        return target

    def launch(self, argv, kind, number, source=None):
        directory = self.instance / ('run-%s-%02d' % (kind, number))
        process = deploy.start(self.deploy_config, self.base, argv, directory, {}, source=source)
        self.started.append(process)
        return process

    def cleanup_processes(self):
        for process in reversed(self.started):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        # deploy.start creates a session for each captured process. Its direct
        # exit can precede an in-flight Git child; wait for those owned groups
        # before HostCase's earlier TemporaryDirectory cleanup removes .git.
        groups = {process.pid for process in self.started}
        group_keys = {str(group) for group in groups}
        deadline = time.monotonic() + 5
        observations = []
        while True:
            rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,command='], text=True).splitlines()
            remaining = [row.strip() for row in rows if len(row.split(None, 2)) >= 2
                         and row.split(None, 2)[1] in group_keys]
            observations.append({'at': time.monotonic(), 'remaining': remaining})
            if not remaining or time.monotonic() >= deadline:
                break
            time.sleep(.05)
        print(json.dumps({'fixture_cleanup': 'deploy938', 'groups': sorted(groups), 'observations': observations}))
        self.assertEqual(remaining, [], 'owned deploy fixture group did not drain before directory cleanup')

    def perform(self, target, hook=None):
        summary = self.root / 'check.json'
        # As in test_tools_deploy, this is an input fixture for the deploy's
        # release-check contract, not a claim that broad suites ran here.
        summary.write_text(json.dumps({'tool': release_check.TOOL, 'commit': target,
            'tree_unchanged': True, 'passed': True, 'required': list(release_check.REQUIRED),
            'steps': [{'name': name, 'exit': 0, 'passed': True} for name in release_check.REQUIRED]}))
        real_start, real_run = deploy.start, deploy.run
        self.evidence = self.root / 'deploy-evidence'

        def start(*args, **kwargs):
            process = real_start(*args, **kwargs)
            self.started.append(process)
            return process

        def run(argv, **kwargs):
            return hook(real_run, argv, kwargs) if hook else real_run(argv, **kwargs)

        with mock.patch.object(deploy, 'start', start), mock.patch.object(deploy, 'run', run), \
                redirect_stdout(io.StringIO()):
            try:
                deploy.deploy(self.deploy_config, target, self.evidence, summary, False, number=1, no_items=True)
            except deploy.Refused:
                for stage in ('04-backup', '06-migrate', '07-server', '09-runner'):
                    path = self.evidence / (stage + '.json')
                    if path.exists():
                        print(path.read_text(), file=__import__('sys').stderr)
                raise

    def read_record(self, name):
        return json.loads((self.evidence / (name + '.json')).read_text())

    def test_held_turn_delivery_retry_and_stop_continue_across_real_compatible_cutover(self):
        self.open_topic('Keep this work through the web release')
        first = self.events.event('host_dispatch', outcome='handed', mode='start')
        before = self.turns_rows()[0]
        claim_owner = self.sql('SELECT runner_token,runner_id,guard_generation FROM runner_state')
        child = self.sql('SELECT pid FROM hosted_children WHERE exited_ms IS NULL')[0][0]
        self.act('draft.save', {'source_ref': {'kind': 'topic', 'id': 't1'}, 'topic_id': 't1',
                               'generation': 'writing-generation', 'body': 'literal unsent writing\n  kept',
                               'attachments': [], 'quotes': []}, {'draft_id': 'held-writing'}, {'draft_revision': 0})
        writing = self.sql('SELECT revision,generation,payload FROM drafts WHERE id=?', ('held-writing',))
        policy = deploy.runner_policy(self.deploy_config, self.base)
        owner = deploy.kept_runner(self.deploy_config, policy)
        target = self.candidate()
        self.perform(target)
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)
        self.assertEqual(self.read_record('00-plan')['runner_policy']['kind'], 'keep')
        self.assertEqual(set(self.read_record('03-stopped')), {'server', 'runner_final'})
        self.assertTrue(self.read_record('06-migrate')['skipped'])
        self.assertTrue(self.read_record('09-runner')['kept'])
        self.assertEqual(deploy.kept_runner(self.deploy_config, policy), owner)
        self.assertIsNone(self.host.poll())
        self.assertIsNotNone(self.server.poll())
        self.assertEqual(self.sql('SELECT pid FROM hosted_children WHERE exited_ms IS NULL'), [(child,)])
        after = self.turns_rows()[0]
        for key in ('recipient_id', 'thread_id', 'turn_id', 'attempt_id', 'client_id', 'announced_seq', 'final_status'):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(self.sql('SELECT runner_token,runner_id,guard_generation FROM runner_state'), claim_owner)
        self.assertIsNone(after['final_status'])
        self.assertEqual(self.sql('SELECT revision,generation,payload FROM drafts WHERE id=?', ('held-writing',)), writing)
        self.assertEqual([entry for entry in self.wire() if entry.get('in', {}).get('method') == 'turn/interrupt'], [])
        backups = list((self.instance / 'backups').glob('*/data.sqlite3'))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(str(backups[0])) as copied:
            self.assertEqual(copied.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
            self.assertEqual(copied.execute('SELECT generation FROM drafts WHERE id="held-writing"').fetchall(), [('writing-generation',)])
        request = {'v': 1, 'instance_id': INSTANCE, 'operation_id': 'cutover-retried-command', 'kind': 'message.post',
                   'target': {'topic_id': 't1'}, 'args': {'body': 'One delivery after cutover'},
                   'expected': {'authority': dict(self.pin)}}
        committed = self.store.command('lead', request)
        retried = self.store.command('lead', request)
        self.assertEqual(committed['status'], 'committed')
        self.assertEqual(retried['result'], committed['result'])
        second = self.events.event('host_dispatch', outcome='handed', mode='steer')
        self.events.event('host_turn_end', status='completed')
        self.assertNotEqual(first['attempt'], second['attempt'])
        self.assertEqual([body.split('\n\n')[-1] for body in self.replies()], ['held writing kept'])
        self.assertEqual(self.pending(), [])
        self.assertEqual(len(self.turn_rpcs()), 2)
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE body=?', ('One delivery after cutover',)), [(1,)])
        self.assertEqual(self.sql('SELECT count(*) FROM operations WHERE id=?', ('cutover-retried-command',)), [(1,)])
        self.assertEqual({row['thread_id'] for row in self.turns_rows()}, {self.thread})
        self.assertEqual({row['turn_id'] for row in self.turns_rows()}, {before['turn_id']})
        # A real operator stop after preservation still interrupts the held
        # next turn and leaves its delivery due for explicit continuation.
        self.post('A genuinely stopped job')
        self.events.event('host_dispatch', outcome='handed', mode='start')
        self.host.terminate()
        self.assertEqual(self.host.wait(timeout=20), 0)
        self.assertEqual(self.turns_rows()[-1]['final_status'], 'interrupted')
        self.assertEqual(len(self.pending()), 1)
        continued = self.launch(deploy.supervisor_argv(self.deploy_config), 'runner', 2, self.source)
        resumed = Events(self, continued, self.instance / 'run-runner-02')
        resumed.event('acquired')
        resumed.event('host_turn_end', status='completed')
        self.assertEqual([body.split('\n\n')[-1] for body in self.replies()], ['held writing kept', 'continued'])
        self.assertEqual(self.pending(), [])
        self.assertEqual([entry for entry in self.wire() if 'cli' in entry and entry['code'] != 0], [])
        continued.terminate()
        self.assertEqual(continued.wait(timeout=20), 0)
        self.assertEqual(self.sql('SELECT cleanup FROM hosted_children WHERE exited_ms IS NULL'), [])
        print(json.dumps({'case': '938 compatible', 'source': target, 'runner': owner, 'child': child,
                          'writing_kept': True, 'once': True, 'stop_continue': True}))

    def test_runtime_change_really_stops_and_restarts_host_and_migrates(self):
        target = self.candidate('aim_next/effects_runner.py', '\n# scratch runtime revision\n')
        self.perform(target)
        self.assertEqual(self.read_record('00-plan')['runner_policy']['kind'], 'restart')
        self.assertIn('runner', self.read_record('03-stopped'))
        self.assertEqual(self.read_record('06-migrate')['exit'], 0)
        self.assertIsNotNone(self.host.poll())
        new = self.read_record('09-runner')
        self.assertNotEqual(new['pid'], self.host.pid)
        self.assertEqual(runner_runtime.latest(self.deploy_config)['revision'], target)

    def legacy_host(self):
        self.host.terminate()
        self.assertEqual(self.host.wait(timeout=20), 0)
        self.host = self.launch(deploy.supervisor_argv(self.deploy_config, None), 'runner', 2)
        self.events = Events(self, self.host, self.instance / 'run-runner-02')
        self.events.event('acquired')
        self.assertIsNone(runner_runtime.latest(self.deploy_config))

    def test_legacy_candidate_without_policy_refuses_before_stopping_either_process(self):
        self.legacy_host()
        (self.repo / 'tools/runner_runtime.py').unlink()
        target = self.commit('scratch legacy candidate without policy')
        self.git('reset', '--hard', self.base)
        with self.assertRaisesRegex(deploy.Refused, 'runner source is incomplete'):
            self.perform(target)
        self.assertIsNone(self.server.poll())
        self.assertIsNone(self.host.poll())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.base)
        self.assertFalse((self.evidence / '03-stopped.json').exists())

    def test_legacy_symlink_instance_refuses_before_stopping_either_process(self):
        self.legacy_host()
        alias = self.root / 'instance-alias'
        alias.symlink_to(self.instance, target_is_directory=True)
        self.deploy_config = self.deploy_config._replace(instance=alias)
        target = self.candidate()
        with self.assertRaises(deploy.Refused):
            self.perform(target)
        self.assertIsNone(self.server.poll())
        self.assertIsNone(self.host.poll())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.base)
        self.assertFalse((self.evidence / '03-stopped.json').exists())

    def test_web_release_starts_a_new_runner_when_pinned_host_is_gone(self):
        self.host.terminate()
        self.assertEqual(self.host.wait(timeout=20), 0)
        target = self.candidate()
        self.perform(target)
        self.assertEqual(self.read_record('00-plan')['runner_policy']['kind'], 'restart')
        self.assertNotIn('runner', self.read_record('03-stopped'))
        self.assertEqual(self.read_record('06-migrate')['exit'], 0)
        launched = self.read_record('09-runner')
        self.assertNotEqual(launched['pid'], self.host.pid)
        self.assertTrue(self.read_record('10-verify')['runner_alive'])
        self.assertEqual(self.git('rev-parse', 'HEAD'), target)

    def test_failed_backup_keeps_host_alive_and_refuses_before_source_move(self):
        target = self.candidate()
        def failed(real, argv, kwargs):
            if '-c' in argv and 'recovery.backup' in argv[-1]:
                return subprocess.CompletedProcess(argv, 1, '', 'injected backup failure')
            return real(argv, **kwargs)
        with self.assertRaisesRegex(deploy.Refused, 'backup failed'):
            self.perform(target, failed)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.base)
        self.assertIsNone(self.host.poll())
        self.assertFalse((self.evidence / '05-fast-forward.json').exists())

    def test_schema_move_takes_full_stop_and_failed_migration_starts_nothing(self):
        path = self.repo / 'aim_next/store.py'
        old = 'SCHEMA_VERSION = "' + self.source['schema'] + '"'
        words = path.read_text()
        self.assertEqual(words.count(old), 1)
        # A proposed schema with no matching migration is a real invalid
        # candidate. The legacy migration must reject it after the full stop.
        path.write_text(words.replace(old, 'SCHEMA_VERSION = "' + str(int(self.source['schema']) + 1) + '"'))
        target = self.commit('scratch missing migration')
        self.git('reset', '--hard', self.base)
        with self.assertRaisesRegex(deploy.Refused, 'migration failed'):
            self.perform(target)
        self.assertEqual(self.read_record('00-plan')['runner_policy']['kind'], 'restart')
        self.assertIn('runner', self.read_record('03-stopped'))
        self.assertIsNotNone(self.host.poll())
        self.assertIsNotNone(self.server.poll())
        self.assertNotEqual(self.read_record('06-migrate')['exit'], 0)
        self.assertFalse((self.evidence / '07-server.json').exists())
        self.assertFalse((self.instance / 'run-runner-02').exists())

    def test_lost_lease_refuses_before_any_stop(self):
        target = self.candidate()
        pid = self.store.runner_status()['holder']['runner_pid']
        os.kill(pid, signal.SIGSTOP)
        try:
            with sqlite3.connect(str(self.db)) as record:
                record.execute('UPDATE runner_state SET lease_until_ms=0 WHERE id=1')
            self.assertTrue(self.store.runner_status()['lease_expired'])
            with self.assertRaisesRegex(deploy.Refused, 'owner cannot be confirmed|lost its lease'):
                self.perform(target)
        finally:
            os.kill(pid, signal.SIGCONT)
        self.assertIsNone(self.server.poll())
        self.assertIsNone(self.host.poll())
        self.assertFalse((self.evidence / '03-stopped.json').exists())


if __name__ == '__main__':
    unittest.main()

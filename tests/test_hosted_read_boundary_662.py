from __future__ import annotations

"""Credential denial and the real actor-bound CLI, in scratch stores only."""

import importlib
import io
import json
import os
from pathlib import Path
import subprocess
import socket
import select
import struct
import threading
import tempfile
from types import SimpleNamespace
import unittest
import uuid
from unittest import mock

from aim_next import cli
from aim_next import codex_host
from aim_next import broker_routes
from aim_next.contract import Refusal
from aim_next.profile import load_profile
from aim_next.route_pins import HOSTED_KIND
from test_agent_cli import AgentCLIBase
from test_codex_host import HostCase, AGENT


CODEX = Path('/Users/commonfabric/.local/share/theseus/runtimes/codex-0.167.0-alpha.3.2/bin/codex')
ROOT = Path(__file__).resolve().parents[1]


def write_native_policy(home, name, policy):
    table = '[features]\nnetwork_proxy=true\n[permissions.' + name + ']\nextends=":workspace"\n[permissions.' + name + '.filesystem]\n'
    table += ''.join(json.dumps(key) + '=' + json.dumps(value) + '\n' for key, value in policy['filesystem'].items())
    table += '[permissions.' + name + '.network]\nenabled=true\n[permissions.' + name + '.network.unix_sockets]\n'
    table += ''.join(json.dumps(path) + '="allow"\n' for path in policy['network']['unix_sockets'])
    (home / 'config.toml').write_text(table)


class HostedReadBoundary662Case(AgentCLIBase):
    def setUp(self):
        super().setUp()
        self.bridge_module = importlib.import_module('aim_next.hosted_cli')
        self.permissions = importlib.import_module('aim_next.hosted_permissions')
        self.work = Path(self.temp.name).resolve() / 'worktree'
        self.work.mkdir()
        self.home = Path(self.temp.name).resolve() / 'codex-home'
        self.home.mkdir(mode=0o700)
        self.destination = {'kind': HOSTED_KIND, 'protocol_version': 1,
                            'codex_home': str(self.home), 'thread_id': str(uuid.uuid4())}
        with self.store.runner_guard('662-provision') as guard:
            self.store.provision_route_pin(guard, 'agent-a', self.destination, owner_id='owner')
        self.profile = load_profile(self.profiles['agent-a'])
        self.outbox = Path(self.temp.name).resolve() / 'agent-a.outbox'
        self.outbox.mkdir(mode=0o700)
        self.config = SimpleNamespace(profile=self.profile, profile_path=str(self.profiles['agent-a']),
                                      destination=self.destination, cwd=str(self.work), writable_roots=(str(self.path.parent), str(self.outbox)),
                                      permission_mode='workspace', cli=str(ROOT / 'bin/aim-next'), model=None, reasoning_effort=None, instructions='')
        self.bridge = self.bridge_module.HostedCLI(self.config)
        self.addCleanup(self.bridge.close)

    def remote(self):
        return self.bridge_module.RemoteProfile.connect(self.bridge.path)

    def run_remote(self, *args):
        out, err = io.StringIO(), io.StringIO()
        result = cli.main(['--broker', self.bridge.path, *args], stdin=io.BytesIO(), stdout=out, stderr=err)
        return result, out.getvalue(), err.getvalue()

    def test_cli_publishes_as_only_bound_actor_and_keeps_exact_retry(self):
        words = ['post', 't1', '--tells', 'owner', '--divergence-reason', 'Synthetic broker check',
                 '--operation', '662-once', 'A scratch broker message']
        self.assertEqual(self.run_remote(*words)[0], 0)
        self.assertEqual(self.run_remote(*words)[0], 0)
        self.assertEqual(self.sql("SELECT author_id,body FROM messages WHERE body='A scratch broker message'"),
                         [('agent-a', 'A scratch broker message')])
        self.assertTrue((self.outbox / '662-once.request.json').is_file())
        self.assertTrue((self.outbox / '662-once.receipt.json').is_file())
        code, text, error = self.run_remote('read', 't1')
        self.assertEqual((code, error), (0, ''))
        self.assertIn('A scratch broker message', text)
        self.assertEqual(self.run_remote('watch', '--once')[0], 2)

    def test_binding_mismatch_and_path_requests_never_reach_core(self):
        remote = self.remote()
        request = {'method': 'view', 'binding': dict(remote.transport_binding, actor_id='agent-b'),
                   'name': 'deliveries', 'args': {}}
        before = self.sql('SELECT count(*) FROM operations')
        with self.assertRaises(Refusal) as raised:
            self.bridge_module.exchange(self.bridge.path, request)
        self.assertEqual(raised.exception.code, 'BINDING_MISMATCH')
        with self.assertRaises(Refusal):
            self.bridge_module.exchange(self.bridge.path, {'method': 'read_path', 'binding': remote.transport_binding, 'path': str(self.profiles['agent-b'])})
        self.assertEqual(self.sql('SELECT count(*) FROM operations'), before)

    def test_media_bytes_cross_transport_and_files_stay_in_client(self):
        source = self.work / 'sample.txt'
        source.write_text('Only scratch attachment bytes')
        code, text, error = self.run_remote('post', 't1', '--tells', 'owner', '--divergence-reason', 'Synthetic media check',
                                            '--attach', str(source), 'A scratch attachment')
        self.assertEqual((code, error), (0, ''), text)
        message = self.sql("SELECT id FROM messages WHERE body='A scratch attachment'")[0][0]
        media = self.sql('SELECT id FROM media_intents')[0][0]
        target = self.work / 'download.txt'
        code, text, error = self.run_remote('attachment', media, '--message', message, '--out', str(target))
        self.assertEqual((code, error), (0, ''), text)
        self.assertEqual(target.read_bytes(), source.read_bytes())

    def test_committed_command_lost_reply_retries_same_operation_once(self):
        remote = self.remote().store()
        envelope = self.envelope('message.post', {'topic_id': 't1'}, {'body': 'Lost reply scratch',
                                  'divergence_reason': 'Separate broker recovery check'}, op='662-lost')
        original = self.bridge._execute
        def lost(request, data):
            original(request, data)
            raise ConnectionResetError('Synthetic reply loss after Core committed')
        with mock.patch.object(self.bridge, '_execute', side_effect=lost):
            with self.assertRaises(OSError):
                remote.command('agent-a', envelope)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='Lost reply scratch'"), [(1,)])
        self.assertEqual(remote.command('agent-a', envelope)['status'], 'committed')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='Lost reply scratch'"), [(1,)])

    def test_stale_pin_fails_closed_and_close_removes_socket_and_worker(self):
        remote = self.remote().store()
        changed = dict(self.destination, thread_id=str(uuid.uuid4()))
        # A stale endpoint's expectation differs from Core's immutable pin.
        self.bridge.destination = changed
        with self.assertRaises(OSError):
            remote.view('agent-a', 'deliveries', {})
        path, worker = Path(self.bridge.path), self.bridge.worker
        self.bridge.close()
        self.assertFalse(path.exists())
        self.assertFalse(worker.is_alive())

    def test_oversize_frame_never_reaches_core_and_shutdown_reaps_partial_client(self):
        with mock.patch.object(self.bridge, '_execute', wraps=self.bridge._execute) as execute:
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(2)
                client.connect(self.bridge.path)
                client.sendall(struct.pack('!IQ', self.bridge_module.HEADER_LIMIT + 1, 0))
                self.assertEqual(client.recv(1), b'')
            execute.assert_not_called()
        started = threading.Event()
        receive = self.bridge_module._receive
        def partial(client):
            started.set()
            return receive(client)
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(2)
            with mock.patch.object(self.bridge_module, '_receive', side_effect=partial):
                client.connect(self.bridge.path)
                client.sendall(b'\x00')
                self.assertTrue(started.wait(2), 'an accepted partial frame is in flight')
                self.bridge.close()
            self.assertEqual(client.recv(1), b'')
        self.assertEqual(self.bridge.connections, set())
        self.assertFalse(self.bridge.worker.is_alive())
        self.assertFalse(Path(self.bridge.path).exists())

    def test_host_selects_exact_profile_and_refuses_missing_or_wider_echo(self):
        settings = codex_host.thread_settings(self.config, self.bridge.path)
        name = settings['permissions']
        self.assertNotIn('sandbox', settings)
        self.assertNotIn('sandbox_workspace_write', settings['config'])
        self.assertTrue(settings['config']['features']['network_proxy'])
        filesystem = settings['config']['permissions'][name]['filesystem']
        self.assertEqual(filesystem[str(self.profiles['agent-a'].parent)], 'deny')
        self.assertEqual(filesystem[str(self.path.resolve())], 'read')
        self.assertIn('--broker ' + self.bridge.path, settings['developerInstructions'])
        self.assertNotIn(str(self.profiles['agent-a']), settings['developerInstructions'])
        echo = dict(cwd=str(self.work), approvalPolicy='never', activePermissionProfile={'id':name,'extends':':workspace'},
                    sandbox={'type':'workspaceWrite','writableRoots':[str(self.outbox)],'networkAccess':True,
                             'excludeSlashTmp':True,'excludeTmpdirEnvVar':True})
        def accepted(value):
            return codex_host.settings_applied(value, str(self.work), self.config.writable_roots, permissions=name)
        self.assertTrue(accepted(echo))
        self.assertFalse(accepted(dict(echo, activePermissionProfile=None)))
        self.assertFalse(accepted(dict(echo, activePermissionProfile={'id':':workspace','extends':None})))
        self.assertFalse(accepted(dict(echo, sandbox=dict(echo['sandbox'], writableRoots=['/']))))
        self.assertFalse(accepted(dict(echo, sandbox=dict(echo['sandbox'], excludeSlashTmp=False))))
        self.assertFalse(accepted(dict(echo, sandbox=dict(echo['sandbox'], excludeTmpdirEnvVar=False))))
        self.config.permission_mode='full'
        full = codex_host.thread_settings(self.config)
        self.assertEqual(full['sandbox'], 'danger-full-access')
        self.assertNotIn('permissions', full)

    def test_work_directory_cannot_encompass_credentials(self):
        self.config.cwd = str(self.path.parent)
        with self.assertRaises(ValueError):
            self.permissions.permission_profile(self.config, self.bridge.path)
        self.config.cwd = str(Path(self.bridge.path).parent.parent)
        with self.assertRaises(ValueError):
            self.permissions.permission_profile(self.config, self.bridge.path)

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_actual_sandbox_denies_credentials_but_cli_and_readonly_store_work(self):
        name, policy = self.permissions.permission_profile(self.config, self.bridge.path)
        write_native_policy(self.home, name, policy)
        session = self.home / 'session-canary'
        session.write_text('Synthetic session')
        tool = self.work / 'tool.txt'; tool.write_text('Synthetic tool')
        env = dict(os.environ, CODEX_HOME=str(self.home))
        def run(profile, *command):
            return subprocess.run([str(CODEX), 'sandbox', '-P', profile, '-C', str(self.work), '--', *command],
                                  env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(run(':workspace', '/bin/cat', str(self.profiles['agent-a'])).returncode, 0, 'retained actual red')
        for path in (self.profiles['agent-a'], self.profiles['agent-b'], session):
            denied = run(name, '/bin/cat', str(path))
            self.assertNotEqual(denied.returncode, 0, str(path))
            self.assertIn('Operation not permitted', denied.stderr)
        alias = self.work / 'credential-alias'
        alias.symlink_to(self.profiles['agent-b'])
        for path in (str(alias), '../agent-a.json'):
            self.assertNotEqual(run(name, '/bin/cat', path).returncode, 0)
        future = self.profiles['agent-a'].parent / 'future.profile.json'
        process = subprocess.Popen([str(CODEX), 'sandbox', '-P', name, '-C', str(self.work), '--', '/usr/bin/python3', '-c',
                                    'import sys;print("ready",flush=True);sys.stdin.readline();open(sys.argv[1]).read()', str(future)],
                                   env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.assertTrue(select.select([process.stdout], [], [], 10)[0], 'sandbox startup is bounded')
            self.assertEqual(process.stdout.readline(), b'ready\n')
            future.write_text('Synthetic future credential')
            output, error = process.communicate(b'continue\n', timeout=10)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn(b'Operation not permitted', error)
        finally:
            if process.poll() is None:
                process.terminate(); process.wait(timeout=10)
        self.assertEqual(run(name, '/bin/cat', str(tool)).returncode, 0)
        writable = self.work / 'sandbox-created.txt'
        self.assertEqual(run(name, '/usr/bin/touch', str(writable)).returncode, 0)
        self.assertTrue(writable.is_file())
        with tempfile.TemporaryDirectory(prefix='core-lane8-662-excluded-') as excluded:
            excluded_temp = Path(excluded) / 'ungranted.txt'
            self.assertNotEqual(run(name, '/usr/bin/touch', str(excluded_temp)).returncode, 0)
            self.assertFalse(excluded_temp.exists())
        self.assertEqual(run(name, '/usr/bin/sqlite3', '-readonly', str(self.path), 'SELECT count(*) FROM actors;').returncode, 0)
        self.assertNotEqual(run(name, '/usr/bin/sqlite3', str(self.path), "UPDATE actors SET name='changed';").returncode, 0)
        connected = run(name, '/usr/bin/python3', '-c',
                        'import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); print("connected")', self.bridge.path)
        self.assertEqual(connected.returncode, 0, connected.stderr)
        with socket.socket(socket.AF_UNIX) as other_socket:
            other_path = str(Path(self.bridge.directory) / 'other.sock')
            other_socket.bind(other_path); other_socket.listen()
            denied = run(name, '/usr/bin/python3', '-c',
                         'import socket,sys;s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1])', other_path)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('Operation not permitted', denied.stderr, 'only this route socket is allowed')
        with socket.socket() as other:
            other.bind(('127.0.0.1', 0)); other.listen()
            denied = run(name, '/usr/bin/python3', '-c',
                         'import socket,sys;socket.create_connection(("127.0.0.1",int(sys.argv[1])),1)', str(other.getsockname()[1]))
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('Operation not permitted', denied.stderr)
        denied = run(name, '/usr/bin/python3', '-c',
                     'import os,urllib.request;urllib.request.build_opener(urllib.request.ProxyHandler({"http":os.environ["HTTP_PROXY"]})).open("http://denied.invalid",timeout=2)')
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('403', denied.stderr, 'the active proxy denies an unlisted hostname')
        posted = run(name, '/usr/bin/python3', '-I', str(ROOT / 'bin/aim-next'), '--broker', self.bridge.path,
                     'post', 't1', '--tells', 'owner', '--divergence-reason', 'Synthetic sandbox publication', 'Sandbox broker proof')
        self.assertEqual(posted.returncode, 0, posted.stderr)
        self.assertEqual(self.sql("SELECT author_id FROM messages WHERE body='Sandbox broker proof'"), [('agent-a',)])


class HostedBrokerLifecycle662Case(HostCase):
    turns = [{'hold': 'interrupt'}]

    def test_runner_selects_same_policy_on_resume_and_turn_and_reaps_broker(self):
        runner = self.runner()
        self.open_topic('A held scratch turn with protected CLI transport')
        runner.event('host_dispatch', outcome='handed', mode='start')
        requests = [entry['in'] for entry in self.wire() if 'in' in entry]
        resume = next(row['params'] for row in requests if row['method'] == 'thread/resume')
        turn = next(row['params'] for row in requests if row['method'] == 'turn/start')
        self.assertEqual(turn['permissions'], resume['permissions'])
        self.assertNotIn('sandboxPolicy', turn)
        self.assertNotIn('sandbox', resume)
        line = next(line for line in resume['developerInstructions'].splitlines() if line.startswith('Your CLI: '))
        endpoint = line.split('--broker ', 1)[1]
        self.assertNotIn(str(self.agent_profile), line)
        self.assertTrue(Path(endpoint).is_socket())
        self.stopped_cleanly(runner)
        self.assertFalse(Path(endpoint).exists())


class HostedBrokerReply662Case(HostCase):
    turns = [{'reply': 'A real broker-backed scratch reply', 'reply_to_delivery': True}]

    def test_hosted_cli_replies_and_acknowledges_as_bound_actor(self):
        runner = self.runner()
        opening = self.open_topic('Reply to this scratch request through the broker')
        runner.event('host_turn_end', status='completed')
        [body] = self.replies()
        self.assertTrue(body.endswith('A real broker-backed scratch reply'))
        self.assertEqual(self.sql('SELECT author_id,reply_to FROM messages WHERE author_id=?', (AGENT,)), [(AGENT, opening['message_id'])])
        self.assertEqual(self.pending(), [])
        self.stopped_cleanly(runner)


class NativeAuthorityLayout662Case(HostCase):
    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_native_app_server_selects_the_host_profile_without_a_model_turn(self):
        from aim_next.hosted_cli import HostedCLI
        config = broker_routes.load_hosted_config(self.config)
        bridge = HostedCLI(config)
        self.addCleanup(bridge.close)
        child = codex_host.Child(str(self.home), str(CODEX), subprocess.DEVNULL)
        sync = codex_host._Sync(child)
        try:
            result, error = sync.call('initialize', codex_host.initialize_params())
            self.assertIsNone(codex_host.initialized_refusal(result, error, str(self.home)))
            child.notify('initialized', {})
            params = dict(codex_host.thread_settings(config, bridge.path), ephemeral=False)
            result, error = sync.call('thread/start', params)
            self.assertIsNone(error)
            name = params['permissions']
            self.assertTrue(codex_host.settings_applied(result, config.cwd, config.writable_roots, permissions=name))
            self.assertTrue(result['sandbox']['excludeTmpdirEnvVar'])
            self.assertTrue(result['sandbox']['excludeSlashTmp'])
            persisted, error = sync.call('thread/inject_items', {'threadId': result['thread']['id'], 'items': [{
                'type': 'message', 'role': 'developer',
                'content': [{'type': 'input_text', 'text': 'Synthetic permission-selection setup; no work or model turn.'}]}]})
            self.assertEqual((persisted, error), ({}, None))
            resumed, error = sync.call('thread/resume', dict(codex_host.thread_settings(config, bridge.path),
                                                            threadId=result['thread']['id'], excludeTurns=True))
            self.assertIsNone(error)
            self.assertTrue(codex_host.settings_applied(resumed, config.cwd, config.writable_roots, permissions=name))
        finally:
            self.assertEqual(sync.close(), 0)
        self.assertIsNotNone(child.popen.poll())

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_authority_anchor_outside_profile_and_database_folders_is_denied(self):
        from aim_next.hosted_cli import HostedCLI
        from aim_next.hosted_permissions import permission_profile
        config = broker_routes.load_hosted_config(self.config)
        bridge = HostedCLI(config)
        self.addCleanup(bridge.close)
        name, policy = permission_profile(config, bridge.path)
        write_native_policy(self.home, name, policy)
        authority = str(config.profile.authority_path)
        result = subprocess.run([str(CODEX), 'sandbox', '-P', name, '-C', str(self.work), '--', '/bin/cat', authority],
                                env=dict(os.environ, CODEX_HOME=str(self.home)), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, 'the selected authority file is protected wherever it lives')
        self.assertIn('Operation not permitted', result.stderr)


if __name__ == '__main__':
    unittest.main()

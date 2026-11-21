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
import shutil
import struct
import threading
import tempfile
import time
from dataclasses import replace
from types import SimpleNamespace
import unittest
import uuid
from unittest import mock

from aim_next import cli
from aim_next import codex_host
from aim_next import broker_routes
from aim_next import effects_runner
from aim_next.contract import Refusal, StoreError
from aim_next.authority import AuthorityError
from aim_next.store import StoreOpenError
from aim_next.route_pins import RoutePinError
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

    def test_preflight_errors_keep_codes_and_retry_status_without_phantom_operation(self):
        for error in (StoreOpenError('DATABASE_BUSY', 'Scratch busy', retryable=True),
                      AuthorityError('AUTHORITY_CHANGED', 'Scratch authority changed'),
                      RoutePinError('DATABASE_BUSY', 'Scratch pin busy', retryable=True)):
            with self.subTest(code=error.code, kind=type(error).__name__):
                with mock.patch.object(type(self.profile), 'store', side_effect=error):
                    code, output, problem = self.run_remote('inbox')
                self.assertEqual(code, 75 if error.retryable else 2, (output, problem))
                self.assertIn(error.code, output + problem)
                self.assertNotIn('CLI_REQUEST_UNCONFIRMED', problem)
                self.assertNotIn('reconcile', problem)

    def test_failed_view_and_large_view_are_named_without_connection_loss(self):
        remote = self.remote().store()
        with mock.patch.object(type(self.store), 'view', side_effect=StoreError('Scratch unreadable view')):
            code, output, problem = self.run_remote('inbox')
            self.assertIn('STORE_UNAVAILABLE', output + problem)
            self.assertNotIn('reconcile', problem)
        with mock.patch.object(type(self.store), 'view', return_value={'body': 'x' * self.bridge_module.HEADER_LIMIT}):
            result = remote.view('agent-a', 'deliveries', {})
        self.assertEqual(result['error']['code'], 'RESPONSE_TOO_LARGE')

    def test_named_uncertain_command_preserves_the_real_operation_and_retries_once(self):
        original = self.bridge._execute
        def uncertain(request, data):
            result = original(request, data)
            if request['method'] == 'command':
                raise StoreError('Synthetic uncertainty after the commit')
            return result
        args = ['post', 't1', '--divergence-reason', 'Separate named-error recovery proof',
                '--operation', '662-named-uncertain', 'One named-error scratch publication']
        with mock.patch.object(self.bridge, '_execute', side_effect=uncertain):
            code, output, problem = self.run_remote(*args)
        self.assertEqual(code, 1)
        self.assertIn('STORE_REQUEST_UNCONFIRMED', problem)
        self.assertIn('retry 662-named-uncertain', problem)
        self.assertEqual(self.run_remote('retry', '662-named-uncertain')[0], 0)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='One named-error scratch publication'"), [(1,)])
        args = ['--json','post','t1','--divergence-reason','Separate JSON uncertainty proof',
                '--operation','r3-json-uncertain','One JSON uncertainty publication']
        with mock.patch.object(self.bridge,'_execute',side_effect=uncertain):
            code, output, problem = self.run_remote(*args)
        self.assertEqual(code,1)
        self.assertNotIn('"recorded":false',output)
        self.assertIn('retry r3-json-uncertain',problem)
        self.assertEqual(self.run_remote('retry','r3-json-uncertain')[0],0)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='One JSON uncertainty publication'"),[(1,)])

    def test_network_bit_and_named_profile_without_proxy_proof_are_refused(self):
        name = codex_host.thread_settings(self.config, self.bridge.path)['permissions']
        echo = dict(cwd=str(self.work), approvalPolicy='never', activePermissionProfile={'id':name,'extends':':workspace'},
                    sandbox={'type':'workspaceWrite','writableRoots':[str(self.outbox)],'networkAccess':True,
                             'excludeSlashTmp':True,'excludeTmpdirEnvVar':True})
        self.assertFalse(codex_host.settings_applied(echo, str(self.work), self.config.writable_roots, permissions=name),
                         'networkAccess and a name alone cannot prove a proxy is running')

    def test_typed_postcommit_readback_failure_preserves_recorded_note_and_exact_retry(self):
        source = self.work / 'note.txt'
        source.write_text('One exact note through a failed readback')
        original = self.bridge._execute
        def failed_readback(request, data):
            if request.get('method') == 'view' and request.get('name') == 'source':
                raise RoutePinError('DATABASE_BUSY', 'Synthetic postcommit readback busy', retryable=True)
            return original(request, data)
        with mock.patch.object(self.bridge, '_execute', side_effect=failed_readback):
            code, output, problem = self.run_remote('note','new','t1','--topic','--title','R3 readback note',str(source))
        self.assertEqual(code, 1, (output, problem))
        self.assertIn('READ_BACK_UNCONFIRMED', problem)
        self.assertNotIn('not recorded', problem)
        requests = list(self.outbox.glob('*.request.json'))
        self.assertEqual(len(requests), 1)
        operation = json.loads(requests[0].read_text())['command']['operation_id']
        self.assertEqual(self.run_remote('retry', operation)[0], 0)
        self.assertEqual(len(list(self.outbox.glob('*.request.json'))), 1)
        receipt = json.loads(next(self.outbox.glob('*.receipt.json')).read_text())
        self.assertTrue(receipt['recorded'])
        item = self.store.view('agent-a','memory_current',{'item_id':receipt['result']['item_id']})
        self.assertEqual(item['body'], source.read_text())
        self.assertEqual(item['current_revision'], 1)

    def test_typed_namer_failure_does_not_turn_a_committed_reply_into_a_retryable_post(self):
        parent = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        original = self.bridge._execute
        def failed_hint(request, data):
            if request.get('method') == 'view' and request.get('name') == 'stack_namer':
                raise AuthorityError('AUTHORITY_CHANGED', 'Synthetic postcommit hint failure')
            return original(request, data)
        args = ['reply',parent,'--without-quote','Synthetic naming-hint failure proof',
                '--operation','r3-namer-once','One reply despite a failed naming hint']
        with mock.patch.object(self.bridge, '_execute', side_effect=failed_hint):
            code, output, problem = self.run_remote(*args)
        self.assertEqual(code, 0, (output, problem))
        self.assertIn('NAMER_UNREAD', problem)
        self.assertEqual(self.run_remote('retry','r3-namer-once')[0], 0)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body LIKE '%One reply despite a failed naming hint'"), [(1,)])

    def test_typed_attachment_failures_use_the_existing_not_sent_contract(self):
        source = self.work / 'upload.txt'; source.write_text('Synthetic bytes')
        original = self.bridge._execute
        for stage in ('begin', 'publish'):
            def failure(request, data):
                if stage == 'begin' and request.get('method') == 'command' and request['envelope']['kind'] == 'media.begin':
                    raise RoutePinError('DATABASE_BUSY', 'Synthetic upload begin busy', retryable=True)
                if stage == 'publish' and request.get('method') == 'publish':
                    raise AuthorityError('AUTHORITY_CHANGED', 'Synthetic upload publication refusal')
                return original(request, data)
            with self.subTest(stage=stage), mock.patch.object(self.bridge,'_execute',side_effect=failure):
                code, output, problem = self.run_remote('post','t1','--divergence-reason','Synthetic attachment failure',
                                                       '--attach',str(source),'This message must not publish')
            self.assertEqual(code, 2, (output, problem))
            self.assertIn('ATTACHMENT_NOT_SENT', problem)
            self.assertIn('message or page was not sent', problem)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='This message must not publish'"), [(0,)])

    def test_absent_and_refused_broker_connections_are_named_before_any_send(self):
        self.bridge.close()
        stale = self.work / 'stale.sock'
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(str(stale))
        for path in (self.bridge.path, str(stale)):
            for verb in (['inbox'], ['post','t1','--divergence-reason','Synthetic no-send','Never sent']):
                with self.subTest(path=path, verb=verb[0]):
                    out, err = io.StringIO(), io.StringIO()
                    code = cli.main(['--broker',path,*verb], stdin=io.BytesIO(),stdout=out,stderr=err)
                    self.assertEqual(code, 75, err.getvalue())
                    self.assertIn('BROKER_UNAVAILABLE', out.getvalue()+err.getvalue())
                    self.assertNotIn('CLI_REQUEST_UNCONFIRMED',err.getvalue())
                    self.assertIn('nothing sent',out.getvalue()+err.getvalue())
        self.assertEqual(list(self.outbox.iterdir()), [])

    def test_empty_broker_path_is_a_usage_refusal(self):
        out, err = io.StringIO(), io.StringIO()
        code = cli.main(['--broker','','inbox'],stdin=io.BytesIO(),stdout=out,stderr=err)
        self.assertEqual(code, 2)

    def test_ninth_parallel_client_gets_a_named_busy_result(self):
        ready, release = threading.Event(), threading.Event()
        lock = threading.Lock()
        changed = threading.Condition(lock)
        admitted = []
        receive = self.bridge_module._receive
        def held(sock):
            if threading.current_thread() is threading.main_thread():
                return receive(sock)
            with changed:
                admitted.append(sock)
                changed.notify_all()
                if len(admitted) == 8:
                    ready.set()
            self.assertTrue(release.wait(5))
            return receive(sock)
        clients = []
        try:
            with mock.patch.object(self.bridge_module,'_receive',side_effect=held):
                for index in range(8):
                    client = socket.socket(socket.AF_UNIX); clients.append(client)
                    client.connect(self.bridge.path); client.sendall(b'\x00')
                    with changed:
                        self.assertTrue(changed.wait_for(lambda:len(admitted) >= index + 1,2))
                self.assertTrue(ready.wait(3))
                code, output, problem = self.run_remote('inbox')
                self.assertEqual(code, 75, (output,problem))
                self.assertIn('BROKER_BUSY',output+problem)
        finally:
            release.set()
            for client in clients:
                client.close()

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_peer_homes_and_runtime_home_are_denied_outside_instances(self):
        outside = tempfile.TemporaryDirectory(prefix='core-lane8-662-other-homes-')
        self.addCleanup(outside.cleanup)
        account = Path(outside.name).resolve() / 'synthetic-account'
        peer = Path(outside.name).resolve() / 'other-hosted-home'
        runtime_home = account / '.local/share/theseus/codex-home'
        for home in (peer, runtime_home):
            home.mkdir(parents=True)
            (home / 'auth.json').write_text('Synthetic auth only')
            (home / 'sessions').mkdir()
            (home / 'sessions/record.jsonl').write_text('Synthetic session only')
        self.config.protected_homes = (str(peer),)
        with mock.patch.object(self.permissions.pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=str(account))):
            name, policy = self.permissions.permission_profile(self.config, self.bridge.path)
        write_native_policy(self.home, name, policy)
        for home in (peer, runtime_home):
            for path in (home / 'auth.json', home / 'sessions/record.jsonl'):
                result = subprocess.run([str(CODEX), 'sandbox', '-P', name, '-C', str(self.work), '--', '/bin/cat', str(path)],
                                        env=dict(os.environ, CODEX_HOME=str(self.home)), capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0, str(path))
                self.assertIn('Operation not permitted', result.stderr)

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_raw_store_is_denied_and_authorized_core_read_remains_available(self):
        name, policy = self.permissions.permission_profile(self.config, self.bridge.path)
        write_native_policy(self.home, name, policy)
        result = subprocess.run([str(CODEX), 'sandbox', '-P', name, '-C', str(self.work), '--',
                                 '/usr/bin/sqlite3', '-readonly', str(self.path), 'SELECT count(*) FROM actors;'],
                                env=dict(os.environ, CODEX_HOME=str(self.home)), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, 'raw store reads bypass actor authority')
        self.assertEqual(self.run_remote('read', 't1')[0], 0)

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
        refused = remote.view('agent-a', 'deliveries', {})
        self.assertEqual(refused['error']['code'], 'ROUTE_PIN_MISMATCH')
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
        self.assertEqual(filesystem[str(self.path.resolve())], 'deny')
        self.assertIn('--broker ' + self.bridge.path, settings['developerInstructions'])
        self.assertNotIn(str(self.profiles['agent-a']), settings['developerInstructions'])
        echo = dict(cwd=str(self.work), approvalPolicy='never', activePermissionProfile={'id':name,'extends':':workspace'},
                    sandbox={'type':'workspaceWrite','writableRoots':[str(self.outbox)],'networkAccess':True,
                             'excludeSlashTmp':True,'excludeTmpdirEnvVar':True})
        def accepted(value):
            return codex_host.settings_applied(value, str(self.work), self.config.writable_roots, permissions=name, proxy_verified=True)
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
        self.assertNotEqual(run(name, '/usr/bin/sqlite3', '-readonly', str(self.path), 'SELECT count(*) FROM actors;').returncode, 0)
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

    def test_invalid_workspace_cwd_is_a_typed_route_refusal(self):
        value = json.loads(self.config.read_text())
        value['cwd'] = str(self.root)
        self.config.write_text(json.dumps(value))
        with self.assertRaises(broker_routes.BrokerConfigError) as raised:
            broker_routes.load_hosted_config(self.config)
        self.assertEqual(str(raised.exception), 'invalid_cwd')

    def test_missing_broker_directory_does_not_leave_an_owned_child_unreaped(self):
        config = broker_routes.load_hosted_config(self.config)
        bridge = importlib.import_module('aim_next.hosted_cli').HostedCLI(config)
        self.addCleanup(bridge.close)
        host = codex_host.Host({AGENT: config}, core=mock.Mock(), settle=mock.Mock(), watch=None,
                               log=mock.Mock(), monotonic=time.monotonic)
        thread = host.threads[config.destination['thread_id']]
        thread.bridge = bridge
        child = codex_host.Child(str(self.home), str(self.codex), subprocess.DEVNULL)
        host.children[child.home] = child
        host.by_pid[child.pid] = child
        host.by_fd[child.out] = child
        shutil.rmtree(bridge.directory)
        original = bridge.close
        def after_child():
            self.assertIsNotNone(child.popen.poll(), 'children exit before the broker is closed')
            return original()
        try:
            with mock.patch.object(bridge, 'close', side_effect=after_child):
                self.assertTrue(host.close())
            self.assertEqual(child.popen.returncode, 0)
            self.assertFalse(bridge.worker.is_alive())
        finally:
            child.close_input()
            child.popen.wait(timeout=5)
            if not child.popen.stdout.closed:
                child.popen.stdout.close()
            if not bridge.closed and not Path(bridge.directory).exists():
                Path(bridge.directory).mkdir()

    def test_full_to_workspace_edit_is_refused_before_turn_send(self):
        config = broker_routes.load_hosted_config(self.config)
        host = codex_host.Host({AGENT: replace(config, permission_mode='full')}, core=mock.Mock(
            return_value={'controls': {AGENT: {'desired':'running'}}}), settle=mock.Mock(), watch=None,
            log=mock.Mock(), monotonic=time.monotonic)
        thread = host.threads[config.destination['thread_id']]
        thread.attached, thread.status = True, 'idle'
        work = codex_host.Dispatch({'attempt_id':'scratch-mode-change'}, thread,
                                   {'input':[], 'additionalContext':None}, time.monotonic())
        thread.config = config
        host.current = work
        with mock.patch.object(host, '_request') as send:
            host._send(work)
        send.assert_not_called()
        self.assertTrue(work.settled)
        self.assertEqual(host.settle.call_args[0][0], 'unavailable')

    def test_host_inventory_includes_other_full_access_homes(self):
        config = broker_routes.load_hosted_config(self.config)
        other_home = self.root / 'peer-home'
        other_home.mkdir()
        other = replace(config, destination=dict(config.destination, codex_home=str(other_home), thread_id=str(uuid.uuid4())),
                        permission_mode='full')
        host = codex_host.Host({AGENT: config, 'peer': other}, core=mock.Mock(), settle=mock.Mock(), watch=None,
                               log=mock.Mock(), monotonic=time.monotonic)
        selected = host.threads[config.destination['thread_id']].config
        policy = importlib.import_module('aim_next.hosted_permissions').permission_profile(selected, '/private/tmp/synthetic662.sock')[1]
        self.assertEqual(policy['filesystem'][str(other_home)], 'deny')

    def refuse_proxy(self, flag):
        (self.home / 'fake-script.json').write_text(json.dumps({flag:True, 'turns':self.turns}))
        runner = self.runner()
        self.open_topic('The proxy must be proved before a scratch model turn')
        try:
            with mock.patch('test_codex_host.HANG_GUARD_SECONDS', 5):
                event = runner.event('host_dispatch')
            self.assertEqual((event.get('outcome'), event.get('reason')), ('unavailable', 'proxy_unverified'), event)
            self.assertFalse(any(entry.get('in', {}).get('method') in ('turn/start','turn/steer') for entry in self.wire()))
        finally:
            self.stopped_cleanly(runner)

    def test_ignored_proxy_configuration_refuses_without_a_model_turn(self):
        self.refuse_proxy('drop_proxy_override')

    def test_failed_active_proxy_probe_refuses_without_a_model_turn(self):
        self.refuse_proxy('proxy_probe_fails')

    def test_edit_from_full_during_an_active_turn_cannot_steer_new_work(self):
        value = json.loads(self.config.read_text())
        value.update(v=2, permission_mode='full', reasoning_effort=None, instructions='')
        self.config.write_text(json.dumps(value))
        runner = self.runner()
        self.open_topic('First full-access scratch turn')
        runner.event('host_dispatch', outcome='handed', mode='start')
        value['permission_mode'] = 'workspace'
        self.config.write_text(json.dumps(value))
        self.act('message.post', {'body':'Second scratch request after policy change',
                                 'divergence_reason':'Separate policy-change control'}, {'topic_id':'t1'})
        runner.event('host_dispatch', outcome='unavailable', reason='workspace_policy_not_attached')
        self.assertFalse(any(entry.get('in', {}).get('method') == 'turn/steer' for entry in self.wire()))
        self.stopped_cleanly(runner)

    def resume_fixture(self, mode='workspace'):
        config = replace(broker_routes.load_hosted_config(self.config), permission_mode=mode)
        failed = mock.Mock()
        host = codex_host.Host({AGENT: config}, core=mock.Mock(), settle=mock.Mock(), watch=None,
                               log=mock.Mock(), monotonic=time.monotonic)
        thread = host.threads[config.destination['thread_id']]
        thread.attaching = True
        thread.waiters = [(mock.Mock(), failed)]
        pending = []
        child = SimpleNamespace(home=thread.home,request=lambda *args:pending.append(args))
        self.addCleanup(lambda: thread.bridge.close() if thread.bridge is not None else None)
        return host, thread, child, pending, failed

    def test_resume_uses_immutable_request_settings_across_route_edits(self):
        for mode in ('full','workspace'):
            with self.subTest(mode=mode):
                host, thread, child, pending, failed = self.resume_fixture(mode)
                host._resume(child, thread)
                with mock.patch.object(codex_host,'proxy_configuration',return_value=True), mock.patch.object(codex_host,'proxy_result',return_value=True):
                    while pending[0][0] != 'thread/resume':
                        pending.pop(0)[2]({},None)
                method, params, answer = pending.pop(0)
                thread.config = replace(thread.config,permission_mode='workspace',cwd=str(self.root))
                answer({'thread':{'id':thread.id}},None)
                failed.assert_called_once_with('route_configuration_changed')
                self.assertFalse(thread.attaching)

    def test_broker_construction_oserror_refuses_only_the_waiting_route(self):
        host, thread, child, pending, failed = self.resume_fixture()
        with mock.patch.object(codex_host,'HostedCLI',side_effect=OSError('Synthetic endpoint bind failure')):
            host._resume(child, thread)
        failed.assert_called_once_with('broker_unavailable')
        self.assertEqual(pending, [])
        self.assertFalse(host.stopping)

    def test_gone_during_each_proxy_stage_preserves_successor_handoff(self):
        for stage in ('config/read','command/exec'):
            with self.subTest(stage=stage):
                host, thread, child, pending, failed = self.resume_fixture()
                host._resume(child, thread)
                if stage == 'command/exec':
                    with mock.patch.object(codex_host,'proxy_configuration',return_value=True):
                        pending.pop(0)[2]({},None)
                method, params, answer = pending.pop(0)
                self.assertEqual(method, stage)
                host.replacing = SimpleNamespace(home=thread.home,successors=[])
                answer(None,codex_host.GONE)
                self.assertEqual(host.replacing.successors, [thread])
                failed.assert_not_called()

    def test_bridge_cleanup_runs_when_child_cleanup_raises(self):
        host, thread, child, pending, failed = self.resume_fixture()
        host._resume(child,thread)
        endpoint = Path(thread.bridge.path)
        with mock.patch.object(host,'_close_children',side_effect=OSError('Synthetic child cleanup failure')):
            with self.assertRaisesRegex(OSError,'Synthetic child cleanup failure'):
                host.close()
        self.assertFalse(endpoint.exists())
        self.assertFalse(thread.bridge.worker.is_alive())


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
    def test_legacy_queue_home_in_the_same_runner_is_denied_natively(self):
        config = broker_routes.load_hosted_config(self.config)
        queue_home = self.root / 'legacy-queue-home'; queue_home.mkdir()
        canary = queue_home / 'auth.json'; canary.write_text('Synthetic queue auth')
        queue = SimpleNamespace(destination={'codex_home':str(queue_home)})
        with mock.patch.object(broker_routes,'preflight_hosted',return_value=config), mock.patch.object(
                broker_routes,'preflight_route',return_value=queue):
            loop = effects_runner.EffectsLoop(load_profile(self.lead_profile),self.store,None,mock.Mock(),
                       {AGENT:str(self.config),'queue-peer':'/synthetic-queue-route'},selected_executable='/synthetic-broker',
                       hosted=frozenset({AGENT}),host_log=mock.Mock())
        self.addCleanup(loop.host.close)
        selected = loop.host.threads[config.destination['thread_id']].config
        permissions = importlib.import_module('aim_next.hosted_permissions')
        name, policy = permissions.permission_profile(selected,'/private/tmp/synthetic662.sock')
        write_native_policy(self.home,name,policy)
        done = subprocess.run([str(CODEX),'sandbox','-P',name,'-C',str(self.work),'--','/bin/cat',str(canary)],
                               env=dict(os.environ,CODEX_HOME=str(self.home)),capture_output=True,text=True)
        self.assertNotEqual(done.returncode,0,'a legacy signed-in home must be protected too')
        self.assertIn('Operation not permitted',done.stderr)

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_native_app_server_selects_the_host_profile_without_a_model_turn(self):
        from aim_next.hosted_cli import HostedCLI
        from aim_next.hosted_permissions import permission_profile, startup_overrides, proxy_configuration, proxy_probe, proxy_result
        config = broker_routes.load_hosted_config(self.config)
        bridge = HostedCLI(config)
        self.addCleanup(bridge.close)
        name, policy = permission_profile(config, bridge.path)
        child = codex_host.Child(str(self.home), str(CODEX), subprocess.DEVNULL, overrides=startup_overrides({name: policy}))
        sync = codex_host._Sync(child)
        try:
            result, error = sync.call('initialize', codex_host.initialize_params())
            self.assertIsNone(codex_host.initialized_refusal(result, error, str(self.home)))
            child.notify('initialized', {})
            effective, error = sync.call('config/read', {'includeLayers': False, 'cwd': config.cwd})
            self.assertIsNone(error)
            self.assertTrue(proxy_configuration(effective, name, policy), effective['config'].get('permissions'))
            probe, error = sync.call('command/exec', proxy_probe(name, config.cwd))
            verified = proxy_result(probe, error)
            self.assertTrue(verified, (probe, error))
            params = dict(codex_host.thread_settings(config, bridge.path), ephemeral=False)
            result, error = sync.call('thread/start', params)
            self.assertIsNone(error)
            name = params['permissions']
            self.assertTrue(codex_host.settings_applied(result, config.cwd, config.writable_roots, permissions=name, proxy_verified=verified))
            self.assertTrue(result['sandbox']['excludeTmpdirEnvVar'])
            self.assertTrue(result['sandbox']['excludeSlashTmp'])
            persisted, error = sync.call('thread/inject_items', {'threadId': result['thread']['id'], 'items': [{
                'type': 'message', 'role': 'developer',
                'content': [{'type': 'input_text', 'text': 'Synthetic permission-selection setup; no work or model turn.'}]}]})
            self.assertEqual((persisted, error), ({}, None))
            resumed, error = sync.call('thread/resume', dict(codex_host.thread_settings(config, bridge.path),
                                                            threadId=result['thread']['id'], excludeTurns=True))
            self.assertIsNone(error)
            self.assertTrue(codex_host.settings_applied(resumed, config.cwd, config.writable_roots, permissions=name, proxy_verified=verified))
        finally:
            self.assertEqual(sync.close(), 0)
        self.assertIsNotNone(child.popen.poll())

    @unittest.skipUnless(CODEX.is_file(), 'Requires the reviewed native Codex runtime')
    def test_native_app_server_without_proxy_is_refused_before_any_model_turn(self):
        from aim_next.hosted_permissions import permission_profile, startup_overrides, proxy_configuration, proxy_probe, proxy_result
        config = broker_routes.load_hosted_config(self.config)
        name, policy = permission_profile(config, '/private/tmp/synthetic662.sock')
        overrides = (*startup_overrides({name:policy}), '-c', 'features.network_proxy=false')
        child = codex_host.Child(str(self.home), str(CODEX), subprocess.DEVNULL, overrides=overrides)
        sync = codex_host._Sync(child)
        try:
            result, error = sync.call('initialize', codex_host.initialize_params())
            self.assertIsNone(error)
            child.notify('initialized', {})
            effective, error = sync.call('config/read', {'includeLayers':False, 'cwd':config.cwd})
            self.assertIsNone(error)
            self.assertFalse(proxy_configuration(effective, name, policy))
            probe, error = sync.call('command/exec', proxy_probe(name, config.cwd))
            self.assertFalse(proxy_result(probe, error), (probe, error))
        finally:
            self.assertEqual(sync.close(), 0)

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

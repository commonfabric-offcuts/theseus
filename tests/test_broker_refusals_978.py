from __future__ import annotations

"""Real bounded sockets and saved CLI operations, all in isolated stores."""

from contextlib import contextmanager, nullcontext
import json
from pathlib import Path
import socket
import tempfile
import threading
from types import SimpleNamespace
from unittest import mock

from aim_next import cli, hosted_cli
from aim_next.store import Store
import test_codex_host as host_fixture
import test_hosted_read_boundary_662 as boundary_fixture
from test_wake_contract import own_cases


@own_cases
class BrokerRefusals978Case(boundary_fixture.HostedReadBoundary662Case):

    @contextmanager
    def occupied(self, count=8):
        receive = self.bridge_module._receive
        changed, release = threading.Condition(), threading.Event()
        admitted, clients = [], []

        def held(sock):
            with changed:
                hold = threading.current_thread() is not threading.main_thread() and len(admitted) < count
                if hold:
                    admitted.append(sock)
                    changed.notify_all()
            if hold:
                self.assertTrue(release.wait(8), 'owned capacity fixture did not release')
            return receive(sock)

        try:
            with mock.patch.object(self.bridge_module, '_receive', side_effect=held):
                for index in range(count):
                    client = socket.socket(socket.AF_UNIX)
                    clients.append(client)
                    client.connect(self.bridge.path)
                    client.sendall(b'\x00')
                    with changed:
                        self.assertTrue(changed.wait_for(lambda: len(admitted) > index, 2))
                yield
        finally:
            release.set()
            for client in clients:
                client.close()

    def test_large_ninth_command_gets_busy_without_core_execution_and_retries_once(self):
        # Binding succeeded before the other clients filled the slots: the real
        # race between the CLI's binding exchange and its command exchange.
        remote = self.remote()
        body = 'Large pending request ' + 'x' * 262144
        with self.occupied(), mock.patch.object(cli, '_selected_profile', return_value=remote), \
                mock.patch.object(self.bridge, '_execute', wraps=self.bridge._execute) as execute:
            code, output, problem = self.run_remote('--json', 'post', 't1', '--divergence-reason', 'Large busy proof', body)
            self.assertEqual(code, 75, (output, problem))
            self.assertIn('BROKER_BUSY', output)
            self.assertNotIn('UNCONFIRMED', problem)
            execute.assert_not_called()
        operation = json.loads(next(self.outbox.glob('*.request.json')).read_text())['command']['operation_id']
        self.assertEqual(self.run_remote('retry', operation)[0], 0)
        self.assertEqual(self.run_remote('retry', operation)[0], 0)
        self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE body=?', (body,)), [(1,)])

    def test_generated_json_receipt_keeps_identity_for_busy_and_unavailable_attempts(self):
        for mode in ('busy', 'unavailable'):
            with self.subTest(mode=mode):
                remote = self.remote()
                before = set(self.outbox.glob('*.request.json'))
                if mode == 'unavailable':
                    self.bridge.close()
                with (self.occupied() if mode == 'busy' else nullcontext()), \
                        mock.patch.object(cli, '_selected_profile', return_value=remote):
                    code, output, problem = self.run_remote('--json', 'post', 't1', '--divergence-reason',
                                                           'Generated id refusal proof', 'JSON ' + mode)
                self.assertEqual(code, 75, (output, problem))
                [request] = set(self.outbox.glob('*.request.json')) - before
                envelope = json.loads(request.read_text())['command']
                receipt = json.loads(output)
                self.assertEqual(receipt.get('operation_id'), envelope['operation_id'])
                self.assertEqual(receipt.get('kind'), envelope['kind'])
                self.assertEqual(receipt.get('status'), 'retryable')
                self.assertFalse(receipt['recorded'])
                self.assertIsNone(receipt['result'])
                self.assertEqual(receipt['affected'], [])
                self.assertEqual(receipt['error']['code'], 'BROKER_BUSY' if mode == 'busy' else 'BROKER_UNAVAILABLE')
                if mode == 'unavailable':
                    self.bridge = self.bridge_module.HostedCLI(self.config)
                    self.addCleanup(self.bridge.close)
                self.assertEqual(self.run_remote('retry', envelope['operation_id'])[0], 0)
                self.assertEqual(self.run_remote('retry', envelope['operation_id'])[0], 0)
                self.assertEqual(self.sql('SELECT count(*) FROM messages WHERE body=?', ('JSON ' + mode,)), [(1,)])

    def test_eighth_slot_still_executes_the_original_core_command(self):
        remote = self.remote()
        with self.occupied(7), mock.patch.object(cli, '_selected_profile', return_value=remote):
            code, output, problem = self.run_remote('post', 't1', '--divergence-reason', 'Eighth slot proof', 'Eighth slot')
        self.assertEqual(code, 0, (output, problem))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='Eighth slot'"), [(1,)])

    def test_changed_returned_pin_gets_a_typed_nothing_sent_frame(self):
        remote = self.remote()
        read_pin = Store.read_route_pin

        def changed(store, *args):
            pin = read_pin(store, *args)
            return dict(pin, destination=dict(pin['destination'], thread_id='changed-scratch-thread'))

        with mock.patch.object(Store, 'read_route_pin', changed), \
                mock.patch.object(Store, 'command', side_effect=AssertionError('Core must not execute')), \
                mock.patch.object(cli, '_selected_profile', return_value=remote):
            code, output, problem = self.run_remote('--json', 'post', 't1', '--divergence-reason',
                                                   'Changed pin proof', 'Must not reach Core')
        self.assertEqual(code, 2, (output, problem))
        receipt = json.loads(output)
        self.assertEqual(receipt['error']['code'], 'ROUTE_PIN_MISMATCH')
        self.assertIn('nothing sent', receipt['error']['message'])
        self.assertFalse(receipt['recorded'])
        self.assertEqual(receipt['status'], 'rejected')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE body='Must not reach Core'"), [(0,)])


class BrokerLifecycle978Case(host_fixture.HostCase):
    resume_fixture = boundary_fixture.HostedBrokerLifecycle662Case.resume_fixture

    def test_worker_start_runtime_error_cleans_partial_endpoint_and_refuses_only_that_route(self):
        mkdir = tempfile.mkdtemp
        for stage in ('resume', 'spawn'):
            with self.subTest(stage=stage):
                host, thread, child, pending, failed = self.resume_fixture()
                directories = []

                def made(*args, **kwargs):
                    result = mkdir(*args, **kwargs)
                    directories.append(Path(result))
                    return result

                with mock.patch('aim_next.hosted_cli.tempfile.mkdtemp', side_effect=made), \
                        mock.patch('aim_next.hosted_cli.threading.Thread.start', side_effect=RuntimeError('synthetic worker limit')):
                    if stage == 'resume':
                        host._resume(child, thread)
                        failed.assert_called_once_with('broker_unavailable')
                    else:
                        self.assertIsNone(host._spawn(thread.home))
                        host.log.write.assert_called_with('spawn_failed')
                self.assertEqual(len(directories), 1)
                self.assertTrue(all(not path.exists() for path in directories))
                self.assertEqual(pending, [])
                self.assertFalse(host.stopping)
                host.core.assert_not_called()

    def test_one_bridge_runtime_cleanup_failure_does_not_skip_the_other_owned_bridge(self):
        host, thread, child, pending, failed = self.resume_fixture()
        host._resume(child, thread)
        other = hosted_cli.HostedCLI(thread.config)
        self.addCleanup(other.close)
        host.threads['other-scratch'] = SimpleNamespace(id='other-scratch', bridge=other)
        with mock.patch.object(host, '_close_children', return_value=True), \
                mock.patch.object(thread.bridge, 'close', side_effect=RuntimeError('synthetic join failure')):
            self.assertFalse(host.close())
        self.assertFalse(other.worker.is_alive())
        self.assertFalse(Path(other.path).exists())
        host.log.write.assert_called_with('broker_cleanup_failed', thread=thread.id)

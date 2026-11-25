from __future__ import annotations

import importlib
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from aim_next import Store, initialize
from aim_next.route_pins import RoutePinError


class TransitionCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='theseus-convert-1221-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / 'data.sqlite3'
        self.binding = initialize(self.path, 'conversion-fixture', [
            {'id':'owner', 'kind':'human'}, {'id':'agent', 'kind':'agent'},
            {'id':'other', 'kind':'human'}], authority_path=self.root / 'authority.json')['binding']
        self.store = Store(self.path, 'conversion-fixture', expected_binding=self.binding)
        self.home = self.root / 'home'
        self.home.mkdir(mode=0o700)
        self.old = dict(kind='codex-queue-stdio', protocol_version=1,
                        codex_home=str(self.home), thread_id=str(uuid.uuid4()))
        self.new = dict(self.old, kind='codex-hosted-stdio', thread_id=str(uuid.uuid4()))
        self.guard = self.store.runner_guard('operator')
        self.guard.__enter__()
        self.addCleanup(self.guard.close)
        self.pin = self.store.provision_route_pin(self.guard, 'agent', self.old)['pin']
        self.request = dict(owner_id='owner', config=str(self.root / 'hosted.json'), settings='same')

    def transition(self, operation='convert-one', request=None, old=None):
        try:
            module = importlib.import_module('aim_next.queue_hosted')
        except ImportError:
            module = None
        self.assertIsNotNone(module, 'guarded queue-to-hosted conversion must exist')
        return module.Transition(self.store, 'agent', old or self.old, operation,
                                 self.request if request is None else request)

    def rows(self, sql, values=()):
        with sqlite3.connect(str(self.path)) as db:
            return db.execute(sql, values).fetchall()

    def refused(self, call, code):
        with self.assertRaises(Exception) as caught:
            call()
        self.assertEqual(getattr(caught.exception, 'code', None), code)

    def ready(self):
        t = self.transition()
        t.phase(self.guard, 'begin')
        t.phase(self.guard, 'creating')
        t.phase(self.guard, 'created', destination=self.new)
        t.phase(self.guard, 'prepared')
        return t

    def test_retirement_is_durable_and_fences_old_transport_without_changing_pin(self):
        t = self.transition()
        first = t.phase(self.guard, 'begin')
        self.assertEqual(first['phase'], 'retired')
        self.assertEqual(first['old_pin'], self.pin)
        self.assertEqual(first, self.transition().phase(self.guard, 'begin'))
        self.refused(lambda:self.store.read_route_pin('agent', self.old), 'QUEUE_PIN_RETIRED')
        self.assertEqual(json.loads(self.rows("SELECT value FROM metadata WHERE key LIKE 'route_pin.v1:%'")[0][0]), self.pin)
        self.assertEqual(t.phase(self.guard, 'read'), first)

    def test_changed_request_and_competing_operation_cannot_create_again(self):
        self.transition().phase(self.guard, 'begin')
        self.refused(lambda:self.transition(request=dict(self.request, settings='changed')).phase(self.guard, 'begin'),
                     'TRANSITION_REQUEST_MISMATCH')
        self.refused(lambda:self.transition('convert-two').phase(self.guard, 'begin'), 'TRANSITION_IN_PROGRESS')

    def test_creating_is_a_one_shot_and_unknown_creation_does_not_reset(self):
        t = self.transition()
        t.phase(self.guard, 'begin')
        self.assertEqual(t.phase(self.guard, 'creating')['phase'], 'creating')
        self.refused(lambda:t.phase(self.guard, 'creating'), 'TRANSITION_CREATION_UNCERTAIN')
        t.phase(self.guard, 'failed', reason='child_exited')
        self.assertEqual(self.transition().phase(self.guard, 'read')['phase'], 'uncertain')
        self.refused(lambda:t.phase(self.guard, 'creating'), 'TRANSITION_CREATION_UNCERTAIN')
        known = t.phase(self.guard, 'created', destination=self.new)
        self.assertEqual(known['destination'], self.new)
        self.refused(lambda:t.phase(self.guard, 'created', destination=dict(self.new, thread_id=str(uuid.uuid4()))),
                     'TRANSITION_THREAD_MISMATCH')

    def test_commit_retains_old_pin_and_control_and_exact_replay_is_read_only(self):
        t = self.ready()
        receipt = t.phase(self.guard, 'commit', config_sha256='a' * 64)
        self.assertEqual(receipt['phase'], 'committed')
        self.assertEqual(receipt['old_pin'], self.pin)
        self.assertEqual(self.store.read_route_pin('agent', self.new)['destination'], self.new)
        before = self.rows('SELECT key,value FROM metadata ORDER BY key')
        self.assertEqual(t.phase(self.guard, 'commit', config_sha256='a' * 64), receipt)
        self.assertEqual(before, self.rows('SELECT key,value FROM metadata ORDER BY key'))
        self.assertEqual(t.phase(self.guard, 'begin'), receipt)
        self.refused(lambda:self.store.read_route_pin('agent', self.old), 'QUEUE_PIN_RETIRED')
        control = json.loads(self.rows("SELECT value FROM metadata WHERE key='hosted_control.v1:agent'")[0][0])
        self.assertEqual((control['owner_id'], control['desired']), ('owner','running'))

    def test_actual_activation_failure_rolls_back_pin_and_can_restore_same_operation(self):
        t = self.ready()
        original = self.store._provision_hosted_owner
        applied = []
        def fail(db, actor, owner, now):
            applied.append(True)
            original(db, actor, owner, now)
            raise RuntimeError('applied activation fault')
        with mock.patch.object(self.store, '_provision_hosted_owner', fail):
            with self.assertRaisesRegex(RuntimeError, 'applied activation fault'):
                t.phase(self.guard, 'commit', config_sha256='a' * 64)
        self.assertEqual(applied, [True])
        self.assertEqual(t.phase(self.guard, 'read')['phase'], 'prepared')
        self.assertEqual(self.rows("SELECT value FROM metadata WHERE key='hosted_control.v1:agent'"), [])
        self.assertEqual(t.phase(self.guard, 'commit', config_sha256='a' * 64)['phase'], 'committed')

    def test_guard_owner_and_foreign_old_destination_fail_before_retirement(self):
        self.refused(lambda:self.transition().phase(object(), 'begin'), 'INVALID_GUARD')
        self.refused(lambda:self.transition(old=dict(self.old, thread_id=str(uuid.uuid4()))).phase(self.guard, 'begin'),
                     'ROUTE_PIN_MISMATCH')
        self.refused(lambda:self.transition(request=dict(self.request, owner_id='agent')).phase(self.guard, 'begin'),
                     'INVALID_OWNER')
        self.assertEqual(self.store.read_route_pin('agent', self.old)['destination'], self.old)

    def test_existing_stopped_control_is_preserved_and_never_implicitly_transferred(self):
        self.store._effect(self.guard, lambda db, now:(
            {'added':self.store._provision_hosted_owner(db, 'agent', 'owner', now)}, True))
        with sqlite3.connect(str(self.path)) as db:
            raw = json.loads(db.execute("SELECT value FROM metadata WHERE key='hosted_control.v1:agent'").fetchone()[0])
            raw.update(desired='stopped', revision=2)
            db.execute("UPDATE metadata SET value=? WHERE key='hosted_control.v1:agent'", (json.dumps(raw),))
        self.refused(lambda:self.transition(request=dict(self.request, owner_id='other')).phase(self.guard, 'begin'),
                     'HOSTED_OWNER_MISMATCH')
        self.ready().phase(self.guard, 'commit', config_sha256='a'*64)
        self.assertEqual(json.loads(self.rows("SELECT value FROM metadata WHERE key='hosted_control.v1:agent'")[0][0]), raw)

    def test_running_runner_record_refuses_even_with_a_new_guard(self):
        self.store.acquire_runner(self.guard)
        self.refused(lambda:self.transition().phase(self.guard, 'begin'), 'RUNNER_NOT_STOPPED')


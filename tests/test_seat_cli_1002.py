from __future__ import annotations

import io
import json
from pathlib import Path
import unittest
from unittest import mock

from aim_next import Store
from aim_next.cli import main
from aim_next.profile import write_profile
import test_store as fixture


class SeatCLI(unittest.TestCase):
    setUp_store = fixture.StoreCase.setUp
    command = fixture.StoreCase.command
    workspace = fixture.StoreCase.workspace
    sql = fixture.StoreCase.sql

    def setUp(self):
        self.setUp_store(); self.workspace()
        self.profiles = {}
        for actor in ('owner', 'agent-b'):
            path = Path(self.temp.name).resolve() / (actor + '.profile.json')
            write_profile(path, self.path, 'test-instance', actor, binding=self.binding)
            self.profiles[actor] = path

    def invoke(self, *args, actor='owner', role='Exact Δ role.\n\nKeep these spaces.  \n', as_json=True):
        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ['--profile', str(self.profiles[actor]), *(['--json'] if as_json else []), *args]
        code = main(argv, stdin=io.BytesIO(role.encode('utf-8')), stdout=stdout, stderr=stderr)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_cli_records_the_same_act_and_preserves_exact_stdin_role_without_starting_a_worker(self):
        role = 'Exact Δ role.\n\nKeep these spaces.  \n'
        code, out, error = self.invoke('seat-add', 'w1', 'Scribe', '--role', '-', role=role)
        self.assertEqual(code, 0, (out, error))
        rows = [json.loads(line) for line in out.splitlines()]
        receipt = next(row for row in rows if row.get('kind') == 'workspace.hosted_seat_add')
        self.assertEqual(receipt['status'], 'committed')
        self.assertEqual(rows[-1]['seat']['role'], role)
        self.assertEqual(self.sql('SELECT state,thread_id,first_message_id FROM hosted_seats'), [('pending', None, None)])
        saved = list((self.profiles['owner'].parent / 'owner.outbox').glob('*.request.json'))
        self.assertEqual(len(saved), 1)
        self.assertEqual(json.loads(saved[0].read_text())['command']['args'], {'name': 'Scribe', 'role': role})

    def test_repeating_a_named_operation_reuses_the_original_workspace_fence_and_rejects_changed_words(self):
        args = ('seat-add', 'w1', 'Scribe', '--role', '-', '--operation', 'seat-once')
        first = self.invoke(*args); self.assertEqual(first[0], 0, first)
        path = self.profiles['owner'].parent / 'owner.outbox' / 'seat-once.request.json'
        original = path.read_bytes()
        second = self.invoke(*args); self.assertEqual(second[0], 0, second)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])
        changed = self.invoke(*args, role='Another role')
        self.assertEqual(changed[0], 2, changed)
        self.assertIn('OPERATION_PAYLOAD_MISMATCH', changed[1] + changed[2])
        self.assertEqual(path.read_bytes(), original)

    def test_nonorganizer_is_refused_before_any_invitation_or_native_work(self):
        code, out, error = self.invoke('seat-add', 'w1', 'Scribe', '--role', '-', actor='agent-b')
        self.assertEqual(code, 2, (out, error))
        self.assertIn('FORBIDDEN', out + error)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM actors WHERE id='scribe'"), [(0,)])

    def test_a_status_read_names_the_recorded_refusal_step_and_cause(self):
        made = self.invoke('seat-add', 'w1', 'Scribe', '--role', '-')
        self.assertEqual(made[0], 0, made)
        with self.store.runner_guard('fixture-host') as guard:
            token = self.store.acquire_runner(guard)['runner_token']
            seat = self.store.hosted_seat_claim(guard, token)['seat']
            self.store.hosted_seat_step(guard, token, seat['id'], seat['version'], 'refused', {'reason': 'profile_write_failed'})
        code, out, error = self.invoke('seat-status', 'w1', seat['id'], as_json=False)
        self.assertEqual(code, 0, (out, error))
        self.assertIn('profile', out); self.assertIn('profile_write_failed', out); self.assertIn('refused', out)

    def test_readback_failure_keeps_the_committed_request_and_never_sends_a_second_invitation(self):
        original = Store.view
        def unavailable(store, actor, name, args):
            if name == 'hosted_seat':
                return {'instance_id': store.instance_id, 'error': {'code': 'DATABASE_BUSY', 'message': 'Scratch readback held', 'retryable': True}}
            return original(store, actor, name, args)
        with mock.patch.object(Store, 'view', unavailable):
            code, out, error = self.invoke('seat-add', 'w1', 'Scribe', '--role', '-', '--operation', 'readback-once')
        self.assertEqual(code, 1, (out, error))
        self.assertIn('READ_BACK_UNCONFIRMED', error); self.assertIn('readback-once', error)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])
        retried = self.invoke('retry', 'readback-once')
        self.assertEqual(retried[0], 0, retried)
        self.assertEqual(self.sql('SELECT count(*) FROM hosted_seats'), [(1,)])


if __name__ == '__main__':
    unittest.main()

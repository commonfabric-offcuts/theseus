from __future__ import annotations

import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from aim_next.seat_host import SeatHost


class Boundaries(unittest.TestCase):
    def test_idle_schedule_and_already_adopted_routes_never_poll_through_writes(self):
        loop = SimpleNamespace(watch=SimpleNamespace(stopped=False),
                               _core=Mock(side_effect=AssertionError('An idle seat read opened a guarded write')))
        seats = SeatHost(loop, directory='/scratch/seat-host')
        seats.read({'pending': False, 'ready_seq': 0})
        seats.route_cursor = 12
        seats.read({'pending': False, 'ready_seq': 12})
        loop._core.assert_not_called()

    def test_late_child_readiness_cannot_start_a_different_request(self):
        callbacks = []
        host = SimpleNamespace(executables={'/scratch/home': '/scratch/codex'}, threads={},
                               ensure_child=lambda home, ready, failed: callbacks.append((ready, failed)))
        loop = SimpleNamespace(host=host, clock=SimpleNamespace(monotonic=lambda: 1),
                               _core=Mock(side_effect=AssertionError('A late callback attempted a Core write for another request')), _event=Mock())
        seats = SeatHost(loop, directory='/scratch/seat-host')
        old = {'id': 'old-seat', 'version': 3, 'stage': 'thread', 'plan': {
            'codex_home': '/scratch/home', 'codex_executable': '/scratch/codex', 'permission_mode': 'full'}}
        seats.current = old
        seats._advance()
        seats.current = {'id': 'new-seat', 'version': 3}
        child = SimpleNamespace(request=Mock())
        callbacks[0][0](child); callbacks[0][1]('auth_missing')
        loop._core.assert_not_called(); child.request.assert_not_called()
        self.assertEqual(seats.current['id'], 'new-seat')

    def test_late_thread_answer_is_recorded_without_native_followup(self):
        loop = SimpleNamespace(_core=Mock(return_value={'status': 'ok'}), _event=Mock())
        seats = SeatHost(loop, directory='/scratch/seat-host')
        sent = {'id': 'old-seat', 'version': 4}
        identity = '11111111-2222-4333-8444-555555555555'
        seats._started(sent, {'thread': {'id': identity}}, None)
        loop._core.assert_called_once_with('hosted_seat_late_thread', 'old-seat', 4, identity)
        self.assertIsNone(seats.current)

    def test_a_native_receipt_for_an_existing_thread_never_injects_the_new_role(self):
        identity = '11111111-2222-4333-8444-555555555555'
        loop = SimpleNamespace(host=SimpleNamespace(threads={identity: object()}))
        seats = SeatHost(loop, directory='/scratch/seat-host')
        sent = {'id': 'new-seat', 'version': 4}
        seats.current = dict(sent)
        def step(stage, details=None):
            seats.current = dict(sent, version=5)
            return True
        seats._step = Mock(side_effect=step)
        seats._config = Mock(side_effect=AssertionError('An existing context was configured for another actor'))
        seats._started(sent, {'thread': {'id': identity}}, None)
        self.assertEqual(seats._step.call_args_list,
                         [unittest.mock.call('persist', {'thread_id': identity}), unittest.mock.call('refused', {'reason': 'route_conflict'})])
        seats._config.assert_not_called()

    def test_existing_private_bytes_are_never_replaced(self):
        from pathlib import Path
        from aim_next.seat_host import _write_same, SeatRefusal
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'route'
            _write_same(path, b'exact old route')
            with self.assertRaises(SeatRefusal):
                _write_same(path, b'another route')
            self.assertEqual(path.read_bytes(), b'exact old route')


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

"""Private extension of the existing scratch HTTP fixture, no product endpoint."""

import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import hashlib
from types import SimpleNamespace
from unittest import mock

root = Path(os.environ.get('AIM_1038_ROOT', str(Path(__file__).resolve().parents[2])))
sys.path[:0] = [str(root), str(root / 'tests')]
spec = importlib.util.spec_from_file_location('http1038', root / 'tests/fixtures/ui_http.py')
http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(http)
from aim_next.effects_runner import EffectsLoop

session = {}
original = http.item_757_control


def stop():
    if session.get('guard') is not None:
        try:
            session['store'].stop_runner(session['guard'], session['token'])
        finally:
            session['guard'].close()
            session.clear()


def control(factory, command, viewer, request):
    if request.get('action') != 'runner_fault_1038':
        return original(factory, command, viewer, request)
    core = factory()
    if request['step'] == 'pause':
        stop()
        guard = core.runner_guard('native-fault1038'); guard.__enter__()
        acquired = core.acquire_runner(guard, lease_ms=120000)
        assert acquired['status'] == 'acquired'
        session.update(store=core, guard=guard, token=acquired['runner_token'])
        events = []
        watch = SimpleNamespace(stopped=False, wait=lambda timeout: {'dirty': False})
        loop = EffectsLoop(SimpleNamespace(instance_id=core.instance_id), core, guard,
            watch, {}, selected_executable='/unused', emit=events.append)
        loop.token = acquired['runner_token']; loop.lease = acquired['lease_until_ms']
        # Inject before a Core schedule call opens a connection. The real loop
        # catches it; the actual Core pause transaction keeps its safe cause.
        error = (sqlite3.OperationalError('database is locked') if request['kind'] == 'sqlite'
                 else ValueError('Bearer PRIVATE_TOKEN /Users/private/body.txt PRIVATE_MESSAGE'))
        calls = []
        def fail_schedule(*args, **kwargs):
            calls.append(True)
            raise error
        with mock.patch.object(core, 'runner_schedule', side_effect=fail_schedule):
            result = loop.run()
        assert calls == [True], 'The intended real loop catch-all must be reached exactly once'
        assert result['status'] == 'paused', result
        answer = {'result': result, 'events': events}
    elif request['step'] == 'resume':
        version = core.runner_status()['version']
        session['guard'].close()
        guard = core.runner_guard('native-fault1038-resumed'); guard.__enter__()
        acquired = core.resume_runner(guard, version, lease_ms=120000)
        assert acquired['status'] == 'acquired'
        session.update(store=core, guard=guard, token=acquired['runner_token'])
        answer = {'status': acquired['status']}
    else:
        raise ValueError('Unknown private1038 fixture step')
    answer['health'] = core.view(viewer, 'health', {})
    files = ['aim_next/effects_runner.py', 'aim_next/runner.py', 'aim_next/health.py',
             'aim_next/pipeline.py', 'aim_next/source_item_covers.py', 'aim_next/runner_faults.py']
    answer['source_hashes'] = {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                              for name in files if (root / name).is_file()}
    return answer


http.item_757_control = control
directory = http.tempfile.TemporaryDirectory
class OwnedDirectory(directory):
    def __exit__(self, *args):
        # Close the guard while the root still exists, after HTTP cleanup.
        try:
            stop()
        finally:
            super().__exit__(*args)
try:
    # Override only this fixture module's binding; stdlib tempfile stays untouched.
    with mock.patch.object(http, 'tempfile', SimpleNamespace(TemporaryDirectory=OwnedDirectory)):
        http.main()
finally:
    stop()

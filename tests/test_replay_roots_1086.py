from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools import wake_replay

ROOT = Path(__file__).resolve().parents[1]


class ReplayCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.retain)

    def retain(self):
        target = os.environ.get('REPLAY_1086_EVIDENCE')
        if target:
            shutil.copytree(self.root, Path(target) / self._testMethodName)


class ReplayRoots(ReplayCase):
    def serve(self, **fields):
        directory = self.root / 'copy'
        directory.mkdir(mode=0o700)
        plan = {'dir': str(directory), 'people': ['person-1'], 'agents': ['writer', 'reader'],
                'routed': [], 'topics': [{'participants': ['person-1', 'writer', 'reader']}],
                'standin': str(ROOT / 'tools/wake_standin.py'), 'events': str(directory / 'unused')}
        plan_path = self.root / 'plan.json'
        plan_path.write_text(json.dumps(plan))
        request = dict(op='post', **{'from': 'writer'}, topic=0, kind='post', to=['reader'], index=0)
        request.update(fields)
        (self.root / 'request.json').write_text(json.dumps(request))
        output = io.StringIO()
        with patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n')), redirect_stdout(output):
            code = wake_replay.serve(ROOT, plan_path)
        (self.root / 'stdout.log').write_text(output.getvalue())
        self.assertEqual(code, 0)
        answer = json.loads(output.getvalue())
        with sqlite3.connect(str(directory / 'data.sqlite3')) as db:
            messages = db.execute("SELECT id,body,reply_to FROM messages WHERE author_id='writer'").fetchall()
            covers = db.execute("SELECT value FROM message_acts WHERE kind='cover' ORDER BY id").fetchall()
        return answer, messages, [json.loads(row[0]) for row in covers]

    def test_original_reason_commits_root_and_exact_cover(self):
        reason = "  wake's own café reason  "
        answer, messages, covers = self.serve(wake_id='original-wake', divergence_reason=reason)
        self.assertNotIn('error', answer, answer)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0][1:], ('Replayed message 1', None))
        self.assertEqual(covers[-1]['stands'], reason)

    def test_missing_reason_names_original_wake_id(self):
        answer, messages, covers = self.serve(wake_id='wake-42')
        self.assertNotIn('error', answer, answer)
        self.assertEqual(len(messages), 1)
        self.assertEqual(covers[-1]['stands'], 'wake replay wake-42')

    def test_legacy_traffic_uses_stable_replay_message_identity(self):
        answer, messages, covers = self.serve(index=7)
        self.assertNotIn('error', answer, answer)
        self.assertEqual(len(messages), 1)
        self.assertEqual(covers[-1]['stands'], 'wake replay replay-message-8')

    def test_null_reason_uses_default(self):
        answer, messages, covers = self.serve(wake_id='wake-null', divergence_reason=None)
        self.assertNotIn('error', answer, answer)
        self.assertEqual(covers[-1]['stands'], 'wake replay wake-null')

    def test_invalid_supplied_reason_is_not_replaced(self):
        answer, messages, covers = self.serve(wake_id='wake-invalid', divergence_reason='two\nlines')
        self.assertIn('INVALID_ARGUMENT', answer['error'])
        self.assertEqual(messages, [])
        self.assertEqual(covers, [])

    def test_copy_forwards_original_reason_and_identity(self):
        requests = []
        copy = object.__new__(wake_replay.Copy)
        copy.ask = lambda request: requests.append(request) or {'deliveries': []}
        item = {'from': 'writer', 'topic': 0, 'index': 4, 'wake_id': 'wake-5', 'divergence_reason': 'Original reason'}
        self.assertEqual(copy.post(item), [])
        self.assertEqual(requests[0]['wake_id'], 'wake-5')
        self.assertEqual(requests[0]['divergence_reason'], 'Original reason')

    def test_copy_uses_traffic_id_without_changing_operation_index(self):
        requests = []
        copy = object.__new__(wake_replay.Copy)
        copy.ask = lambda request: requests.append(request) or {'deliveries': []}
        copy.post({'from': 'writer', 'topic': 0, 'index': 4, 'id': 'captured-id'})
        self.assertEqual(requests[0]['wake_id'], 'captured-id')
        self.assertEqual(requests[0]['index'], 4)


class ReplayEntry(ReplayCase):
    def entry(self, reason=None):
        traffic = {'people': ['person-1'], 'agents': ['writer', 'reader'], 'routed': ['reader'],
                   'topics': [{'participants': ['person-1', 'writer', 'reader']}], 'turns': {},
                   'messages': [{'from': 'writer', 'topic': 0, 'kind': 'post', 'to': ['reader'],
                                 'at_ms': n * 100, 'wake_id': 'wake-%d' % n,
                                 **({'divergence_reason': reason} if reason is not None else {})} for n in range(2)]}
        file = self.root / 'traffic.json'
        file.write_text(json.dumps(traffic))
        out = self.root / 'out'
        command = ['/usr/bin/python3', '-I', '-B', str(ROOT / 'tools/wake_replay.py'),
                   'run', '--file', str(file), '--out', str(out), '--code', str(ROOT)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        (self.root / 'entry-command.json').write_text(json.dumps(command))
        (self.root / 'entry-stdout.log').write_text(result.stdout)
        (self.root / 'entry-stderr.log').write_text(result.stderr)
        (self.root / 'entry-exit.json').write_text(json.dumps({'exit': result.returncode}))
        return result, out

    def test_cli_entry_commits_agent_roots_and_retains_replay_json(self):
        result, out = self.entry()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((out / 'replay.json').read_text())
        self.assertEqual(report['agents']['reader']['wakes'], 2)
        self.assertEqual(report['agents']['reader']['lost'], [])
        self.assertNotIn('DIVERGENCE_REASON_REQUIRED', (out / 'serve.log').read_text())

    def test_cli_invalid_reason_keeps_exit_two_and_no_success_artifact(self):
        result, out = self.entry('invalid\nreason')
        self.assertEqual(result.returncode, 2)
        self.assertIn('INVALID_ARGUMENT', result.stderr)
        self.assertFalse((out / 'replay.json').exists())


if __name__ == '__main__':
    unittest.main()

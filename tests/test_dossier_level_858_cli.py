from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

from test_agent_cli import AgentCLIBase


class DossierLevelCLI858(AgentCLIBase):
    def test_858_real_bound_cli_keeps_one_choice_and_fresh_session_reads_it(self):
        root = self.committed(self.command('message.post', {'body': 'Isolated CLI dossier'},
            target={'topic_id': 't1'}, actor='agent-a'))['message_id']
        request = self.request('command', self.envelope('stack.level', {'message_id': root},
            {'level': 'folded'}, {'level_revision': 0}, op='858-cli-exact'))
        cache = Path(os.environ.get('PYTHONPYCACHEPREFIX', self.temp.name)) / 'cli858'
        argv = [sys.executable, '-I', '-X', 'pycache_prefix=' + str(cache),
                str(Path(__file__).resolve().parents[1] / 'bin' / 'aim-next'),
                '--profile', str(self.profiles['agent-a']), 'command', '-']
        answers = []
        for attempt in range(2):
            completed = subprocess.run(argv, input=json.dumps(request), text=True, capture_output=True,
                                       env=os.environ.copy())
            print(json.dumps({'argv': argv, 'request': request, 'attempt': attempt,
                              'stdout': completed.stdout, 'stderr': completed.stderr, 'exit': completed.returncode}))
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            self.assertEqual(completed.stderr, '')
            answers.append(json.loads(completed.stdout))
        self.assertEqual(answers[0], answers[1])
        self.assertEqual(answers[0]['status'], 'committed')
        self.assertEqual(answers[0]['result']['level_revision'], 1)
        code, read, err = self.invoke('view', {'name': 'stack_positions', 'args': {'topic_id': 't1', 'message_ids': [root]}})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(read['items'][0]['stack_position']['level'], 'folded')
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE kind='level'"), [(1,)])

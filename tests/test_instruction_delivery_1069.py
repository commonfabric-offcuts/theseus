from __future__ import annotations

"""Synthetic1069 transport: real host/runner, fake app-server, scratch Core only.

No real Codex/model/hosted seat is started. The wire is actual serialized
thread/start and thread/resume input received by the scripted fixture.
"""

import json
import os
from pathlib import Path

from aim_next import codex_host
from test_codex_host import HostCase


ROLE = 'Synthetic1069 standing role: keep this role after shared instructions.'


class SyntheticInstructionDelivery1069(HostCase):
    def provision(self, config=None, profile=None):
        result = codex_host.provision(
            runner_profile=str(self.lead_profile), runner_id='host-fixture',
            actor_profile=str(profile or self.agent_profile), codex_executable=str(self.codex),
            codex_home=str(self.home), cli=str(self.cli), cwd=str(self.work), model=None,
            config_path=str(config or self.config), instructions=ROLE)
        return dict(result, exit_code=0)

    def test_start_and_each_resume_deliver_shared_policy_before_the_unchanged_role(self):
        # Stop/restart only our captured synthetic runner; no real seat or model.
        for unused in range(2):
            runner = self.runner()
            self.assertEqual(runner.event('host_resume', thread=self.thread)['status'], 'idle')
            self.stopped_cleanly(runner)
        wire = self.wire()
        frames = [entry['in'] for entry in wire if entry.get('in', {}).get('method')
                  in ('thread/start', 'thread/resume')]
        output = os.environ.get('AIM_1069_EVIDENCE_DIR')
        if output:
            destination = Path(output)
            destination.mkdir(parents=True, exist_ok=True)
            (destination / 'synthetic-wire.json').write_text(json.dumps(wire, indent=2) + '\n')
            (destination / 'synthetic-host-events.json').write_text(json.dumps(self.host_events(), indent=2) + '\n')
            (destination / 'synthetic-runner-events.json').write_text(
                json.dumps([runner.events for runner in self.runners], indent=2) + '\n')
        self.assertEqual([frame['method'] for frame in frames],
                         ['thread/start', 'thread/resume', 'thread/resume'])
        self.assertFalse(any(entry.get('in', {}).get('method') == 'turn/start' for entry in wire))
        for frame in frames:
            with self.subTest(method=frame['method']):
                shared, role = frame['params']['developerInstructions'].split('\n\nStanding role:\n')
                self.assertEqual(role, ROLE)
                self.assertIn('demonstrably malformed raw read', shared)
                self.assertIn("inner binding, not the whole wrapper", shared)
                self.assertIn('This does not authorize replaying a write.', shared)
                self.assertIn('well-formed request, or an uncertain cause', shared)
                self.assertIn('Do not go silent on subsequent deliveries', shared)
                self.assertIn('acknowledge only handled', shared)
                self.assertIn('Never retrieve refused content through SQLite', shared)
                self.assertNotIn('If any CLI result reports a binding mismatch, stop;', shared)
                self.assertIn(' --broker ', shared)
                self.assertNotIn(str(self.agent_profile), shared)

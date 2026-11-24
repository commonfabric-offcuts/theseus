from __future__ import annotations

"""Repository-role selection and actual synthetic hosted startup/resume wire."""

import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from aim_next import codex_host
import test_codex_host as host_fixture
from test_wake_contract import own_cases


STALE = 'STALE_CONFIGURED_ROLE_1216: obsolete fixture assignment.'


class RoleSettings(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='theseus-role-1216-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cli = self.root / 'bin' / 'aim-next'
        self.cli.parent.mkdir()
        self.cli.write_text('isolated selected CLI fixture')
        self.work = self.root / 'other-worktree'
        self.work.mkdir()
        self.config = SimpleNamespace(
            cli=str(self.cli), profile_path=str(self.root / 'actor.profile.json'),
            profile=SimpleNamespace(actor_id='fixture-agent'), cwd=str(self.work),
            writable_roots=(str(self.work),), permission_mode='full',
            reasoning_effort='high', instructions=STALE, model='fixture-model')
        self.seat_file = self.root / 'docs' / 'seats' / 'fixture-agent.md'

    def seat(self, path=None):
        path = path or self.seat_file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('Repository fixture role; recover current board work.')
        return path

    def settings(self):
        return codex_host.thread_settings(self.config)

    def test_present_selected_file_omits_stale_role_and_keeps_bound_input(self):
        self.seat()
        result = self.settings()
        text = result['developerInstructions']
        self.assertIn(str(self.seat_file), text)
        self.assertIn(str(self.cli), text)
        self.assertIn(self.config.profile_path, text)
        self.assertIn('Theseus actor fixture-agent', text)
        self.assertNotIn(STALE, text)
        self.assertNotIn('Standing role:', text)
        self.assertEqual(self.config.instructions, STALE)
        self.assertEqual(result['model'], 'fixture-model')
        self.assertEqual(result['sandbox'], 'danger-full-access')
        self.assertEqual(result['config']['model_reasoning_effort'], 'high')

    def test_missing_file_keeps_the_exact_legacy_role(self):
        text = self.settings()['developerInstructions']
        self.assertIn(str(self.seat_file), text)
        self.assertTrue(text.endswith('\n\nStanding role:\n' + STALE))

    def test_cwd_decoy_cannot_replace_the_selected_cli_role(self):
        decoy = self.work / 'docs' / 'seats' / 'fixture-agent.md'
        self.seat(decoy)
        text = self.settings()['developerInstructions']
        self.assertIn(STALE, text)
        self.assertIn(str(self.seat_file), text)
        self.assertNotIn(str(decoy), text)

    def test_selected_cli_without_bin_uses_its_own_repository(self):
        self.config.cli = str(self.root / 'aim-next')
        self.seat()
        text = self.settings()['developerInstructions']
        self.assertIn(str(self.seat_file), text)
        self.assertNotIn(STALE, text)

    def test_unreadable_existing_file_does_not_restore_stale_role(self):
        self.seat().chmod(0)
        try:
            self.assertEqual(self.seat_file.stat().st_mode & 0o777, 0)
            text = self.settings()['developerInstructions']
            self.assertIn(str(self.seat_file), text)
            self.assertNotIn(STALE, text)
        finally:
            self.seat_file.chmod(0o600)

    def test_directory_is_not_a_repository_role_file(self):
        self.seat_file.mkdir(parents=True)
        self.assertIn(STALE, self.settings()['developerInstructions'])

    def test_later_file_removal_and_restoration_recheck_the_default(self):
        self.seat()
        original = self.seat_file.read_bytes()
        self.assertNotIn(STALE, self.settings()['developerInstructions'])
        self.seat_file.unlink()
        self.assertIn(STALE, self.settings()['developerInstructions'])
        self.seat_file.write_bytes(original)
        self.assertNotIn(STALE, self.settings()['developerInstructions'])


@own_cases
class RoleHost(host_fixture.HostCase):
    turns = [{'reply': 'Fixture fresh repository role response', 'reply_to_delivery': True}]

    def provision(self, config=None, profile=None):
        seat_file = self.root / 'docs' / 'seats' / (host_fixture.AGENT + '.md')
        seat_file.parent.mkdir(parents=True, exist_ok=True)
        seat_file.write_text('Synthetic repository seat role; use the current bound board.')
        result = codex_host.provision(
            runner_profile=str(self.lead_profile), runner_id='host-fixture',
            actor_profile=str(profile or self.agent_profile), codex_executable=str(self.codex),
            codex_home=str(self.home), cli=str(self.cli), cwd=str(self.work), model=None,
            config_path=str(config or self.config), instructions=STALE)
        return dict(result, exit_code=0)

    def assert_wire_roles(self, methods):
        frames = [r['in'] for r in self.wire() if r.get('in', {}).get('method') in methods]
        self.assertTrue(frames)
        seat_file = self.root / 'docs' / 'seats' / (host_fixture.AGENT + '.md')
        for frame in frames:
            with self.subTest(method=frame['method']):
                text = frame['params']['developerInstructions']
                self.assertIn(str(seat_file), text)
                self.assertIn(' --broker ', text)
                self.assertIn('retain the exact request and refusal', text)
                self.assertNotIn(STALE, text)
        return frames

    def test_real_provisioning_and_resume_omit_role_without_reconfiguration(self):
        configured, profile = self.config.read_bytes(), self.agent_profile.read_bytes()
        self.assertEqual(json.loads(configured)['instructions'], STALE)
        runner = self.runner()
        runner.event('host_resume', thread=self.thread)
        self.stopped_cleanly(runner)
        frames = self.assert_wire_roles(('thread/start', 'thread/resume'))
        self.assertEqual([f['method'] for f in frames], ['thread/start', 'thread/resume'])
        self.assertEqual(self.config.read_bytes(), configured)
        self.assertEqual(self.agent_profile.read_bytes(), profile)

    def test_real_refresh_and_later_resume_use_role_file_with_the_same_profile(self):
        self.open_topic('Pending work for the repository-role fixture')
        configured, profile = self.config.read_bytes(), self.agent_profile.read_bytes()
        state = self.store.view('lead', 'hosted_seat_refresh',
                                {'workspace_id': 'w1', 'actor_ids': [host_fixture.AGENT]})
        self.assertNotIn('error', state, state)
        seats = [{k: s[k] for k in ('actor_id', 'execution_revision', 'thread_id')}
                 for s in state['seats']]
        request = self.act('workspace.hosted_seat_refresh', {'seats': seats}, {'workspace_id': 'w1'},
                           {'workspace_revision': state['workspace_revision']})
        runner = self.runner()
        replaced = runner.event('host_thread_replaced')
        self.assertEqual(replaced['intent'], request['intents'][0]['id'])
        runner.event('host_turn_end', status='completed', thread=replaced['new_thread'])
        self.assertFalse(self.pending())
        self.stopped_cleanly(runner)
        resumed = self.runner()
        resumed.event('host_resume', thread=replaced['new_thread'])
        self.stopped_cleanly(resumed)
        frames = self.assert_wire_roles(('thread/start', 'thread/resume'))
        self.assertEqual(sum(f['method'] == 'thread/start' for f in frames), 2)
        self.assertEqual(len(self.fake_state()['threads']), 2)
        self.assertEqual(self.config.read_bytes(), configured)
        self.assertEqual(self.agent_profile.read_bytes(), profile)

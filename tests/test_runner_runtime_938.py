from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from tools import deploy, runner_runtime


class Runtime938Case(unittest.TestCase):
    """Actual Git/snapshot files in scratch directories, no installed profiles."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='host-source-938-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repo, self.instance = self.root / 'repo', self.root / 'instance'
        self.repo.mkdir(); self.instance.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "56"\n')
        self.write('aim_next/effects_runner.py', '# source fixture\n')
        self.write('bin/aim-next-runner', '# entry fixture\n', executable=True)
        self.write('bin/aim-next-codex-broker', '# broker fixture\n', executable=True)
        self.write('tools/runner_runtime.py', '# policy fixture\n')
        self.write('web/index.html', 'before')
        self.base = self.commit()
        route = self.instance / 'hosted.json'
        route.write_text(json.dumps({'kind': 'codex-hosted-stdio'}))
        mapping = self.instance / 'routes.json'
        mapping.write_text(json.dumps({'v': 1, 'routes': {'fixture-agent': str(route)}}))
        self.config = SimpleNamespace(live=self.repo, instance=self.instance, routes=mapping,
                                      python='/usr/bin/python3', runner_profile=self.instance / 'runner.json',
                                      runner_id='fixture-runner')

    def git(self, *args):
        result = subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def write(self, name, words, executable=False):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(words)
        path.chmod(0o700 if executable else 0o600)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'scratch source')
        return self.git('rev-parse', 'HEAD')

    def pinned(self):
        record = runner_runtime.prepare(self.config, self.base)
        run = self.instance / 'run-runner-01'
        run.mkdir()
        (run / 'source.json').write_text(json.dumps(record))
        (run / 'host-inputs.json').write_text(json.dumps(runner_runtime.inputs(self.config)))
        return record

    def test_legacy_host_keeps_existing_full_stop_path(self):
        self.assertEqual(runner_runtime.policy(self.config, self.base)['kind'], 'restart')

    def test_snapshot_is_independent_and_compatible_web_change_keeps_exact_file_list(self):
        record = self.pinned()
        self.write('web/index.html', 'after')
        candidate = self.commit()
        policy = runner_runtime.policy(self.config, candidate)
        self.assertEqual(policy['kind'], 'keep')
        self.assertEqual(policy['changed'], [])
        self.assertEqual(set(policy['files']), set(record['files']))
        self.write('aim_next/effects_runner.py', '# later working tree\n')
        self.assertEqual((Path(record['root']) / 'aim_next/effects_runner.py').read_text(), '# source fixture\n')
        self.assertFalse((Path(record['root']) / '.git').exists())
        self.assertFalse((Path(record['root']) / 'routes.json').exists())

    def test_added_runtime_module_and_policy_change_are_incompatible(self):
        self.pinned()
        for name in ('aim_next/new_runtime.py', 'tools/runner_runtime.py', 'bin/another-entry'):
            self.write(name, '# new source\n')
            policy = runner_runtime.policy(self.config, self.commit())
            self.assertEqual(policy['kind'], 'restart')
            self.assertIn(name, policy['changed'])

    def test_schema_change_is_incompatible(self):
        self.pinned()
        self.write('aim_next/store.py', 'SCHEMA_VERSION = "57"\n')
        self.assertEqual(runner_runtime.policy(self.config, self.commit())['kind'], 'restart')

    def test_changed_startup_route_map_takes_full_stop_without_copying_profiles(self):
        self.pinned()
        route = self.instance / 'hosted.json'
        route.write_text(json.dumps({'kind': 'codex-hosted-stdio', 'instructions': 'new'}))
        self.assertEqual(runner_runtime.policy(self.config, self.base)['kind'], 'restart')

    def test_startup_input_disappearing_after_classification_refuses(self):
        self.pinned()
        policy = deploy.runner_policy(self.config, self.base)
        (self.instance / 'hosted.json').unlink()
        with self.assertRaises(deploy.Refused):
            deploy.kept_runner(self.config, policy)

    def test_tampered_pin_or_manifest_refuses_without_rewriting_source(self):
        record = self.pinned()
        path = Path(record['root']) / 'aim_next/effects_runner.py'
        path.write_text('tampered')
        with self.assertRaises(runner_runtime.Refused):
            runner_runtime.policy(self.config, self.base)
        self.assertEqual(path.read_text(), 'tampered')

    def test_missing_runtime_source_and_symlink_refuse(self):
        record = self.pinned()
        path = Path(record['root']) / 'aim_next/effects_runner.py'
        path.unlink()
        with self.assertRaises(runner_runtime.Refused):
            runner_runtime.policy(self.config, self.base)
        path.symlink_to(self.repo / 'aim_next/effects_runner.py')
        with self.assertRaises(runner_runtime.Refused):
            runner_runtime.policy(self.config, self.base)

    def test_deleted_source_marker_does_not_masquerade_as_legacy_host(self):
        self.pinned()
        (self.instance / 'run-runner-01/source.json').unlink()
        with self.assertRaises(runner_runtime.Refused):
            runner_runtime.policy(self.config, self.base)

    def test_deploy_runner_argv_uses_the_verified_pin_and_preserves_explicit_broker(self):
        record = self.pinned()
        argv = deploy.runner_argv(self.config)
        self.assertEqual(argv[2], str(Path(record['root']) / 'bin/aim-next-runner'))
        self.assertEqual(argv[-2:], ['--broker-executable', str(self.repo / 'bin/aim-next-codex-broker')])

    def test_outer_launcher_can_classify_before_waiting_on_a_boundary(self):
        self.pinned()
        self.assertEqual(deploy.runner_policy(self.config, self.base)['kind'], 'keep')


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

SPEC = importlib.util.spec_from_file_location("destination_kit", Path(__file__).resolve().parents[1] / "tools/destination_kit.py")
kit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(kit)


class DestinationKit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / "source"
        self.source.mkdir()
        self.file = self.source / "tool.py"
        self.file.write_text("unchanged guard\n")
        self.dest = self.root / "destination"
        self.out = self.root / "pack"
        landing_paths = ["profile", "live", "instance", "work", "clone", "worktrees", "scratch", "coordinator", "ship", "posts"]
        landing = {k: str(self.dest / k) for k in landing_paths}
        landing.update(seat="warp", workspace="building-theseus", remote="https://example.invalid/repo", repo="owner/repo", release_branch="release/live73", guard="guard.json", cards_note="n-card", releases_topic="t-releases", dossier_tells="tony")
        deploy = dict(live=landing['live'], instance=landing['instance'], server_profile="server.json", runner_profile="runner.json", routes="routes.json", port=5192, runner_id="runner", release_branch="release/live73", repository="owner/repo", pipeline_instance="same-instance", pipeline_outcome="building-theseus", pipeline_profile=str(self.dest / "profile"), seat_template="core-lane7")
        identity = {k: landing[k] for k in ["seat", "workspace", "repo", "remote", "release_branch", "guard", "cards_note", "releases_topic", "dossier_tells"]}
        self.request = {"v": 1, "packet_id": str(uuid.uuid4()), "inventory": {"v": 1, "source_host": "source-host", "identity": identity, "source_head": "a" * 40, "guard_head": "b" * 40, "files": [{"path": str(self.file), "sha256": hashlib.sha256(self.file.read_bytes()).hexdigest()}]}, "destination": {"home": str(self.dest), "host": "destination-host", "landing": landing, "deploy": deploy}}

    def test_config_bytes_and_pending_authority_are_real_outputs(self):
        result = kit.prepare(self.request, self.out)
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(json.loads((self.out / "landing.json").read_text()), self.request['destination']['landing'])
        self.assertEqual(json.loads((self.out / "deploy.json").read_text()), self.request['destination']['deploy'])
        report = kit.preflight(self.out)
        self.assertEqual(report['mode'], 'report-only')
        self.assertFalse(report['authorized_for_effects'])
        self.assertIn('1306', ' '.join(report['pending']))
        self.assertEqual(self.file.read_text(), 'unchanged guard\n')

    def test_wrong_source_bytes_refuse_before_output(self):
        self.file.write_text('changed source')
        with self.assertRaisesRegex(kit.Refused, 'hash'):
            kit.prepare(self.request, self.out)
        self.assertFalse(self.out.exists())

    def test_changed_release_or_old_host_paths_refuse(self):
        for path, value in [('release_branch', 'wrong'), ('live', str(self.source))]:
            r = copy.deepcopy(self.request); r['destination']['landing'][path] = value
            with self.assertRaises(kit.Refused):
                kit.prepare(r, self.out)

    def test_partial_and_lost_response_resume_same_request(self):
        def interrupt(name):
            if name == 'landing.json':
                raise TimeoutError('retained timeout')
        with self.assertRaises(TimeoutError):
            kit.prepare(self.request, self.out, checkpoint=interrupt)
        with self.assertRaises(kit.Refused):
            kit.preflight(self.out)
        a = kit.prepare(self.request, self.out)
        before = {p.name: p.read_bytes() for p in self.out.iterdir()}
        self.assertEqual(kit.prepare(self.request, self.out), a)
        self.assertEqual({p.name: p.read_bytes() for p in self.out.iterdir()}, before)

    def test_changed_request_under_same_id_and_occupied_bytes_refuse(self):
        kit.prepare(self.request, self.out)
        r = copy.deepcopy(self.request);r['destination']['host'] = 'other-host'
        with self.assertRaises(kit.Refused):kit.prepare(r, self.out)
        (self.out / 'landing.json').write_text('{}')
        with self.assertRaises(kit.Refused):kit.prepare(self.request, self.out)
        with self.assertRaises(kit.Refused):kit.preflight(self.out)

    def test_private_modes_symlink_hardlink_and_owner_refusals(self):
        kit.prepare(self.request, self.out)
        (self.out / 'deploy.json').chmod(0o644)
        with self.assertRaisesRegex(kit.Refused, 'private'):kit.preflight(self.out)
        (self.out / 'deploy.json').chmod(0o600)
        os.link(self.out / 'deploy.json', self.root / 'duplicate')
        with self.assertRaisesRegex(kit.Refused, 'link'):kit.preflight(self.out)
        os.unlink(self.root / 'duplicate')
        link = self.root / 'link';link.symlink_to(self.out)
        with self.assertRaisesRegex(kit.Refused, 'symlink'):kit.preflight(link)

    def test_disabled_is_no_effect_and_activation_is_never_adopted(self):
        self.assertEqual(kit.prepare(self.request, self.out, disabled=True)['status'], 'disabled')
        self.assertFalse(self.out.exists())
        r = copy.deepcopy(self.request);r['activation'] = {'status': 'activated', 'durability_confirmed': True}
        with self.assertRaises(kit.Refused):kit.prepare(r, self.out)

    def test_unsafe_names_unknown_config_and_wrong_local_user_refuse(self):
        for key, value in [('server_profile', '../server.json'), ('port', True), ('routes', '/absolute/routes')]:
            r = copy.deepcopy(self.request);r['destination']['deploy'][key] = value
            with self.assertRaises(kit.Refused):kit.prepare(r, self.out)
        r = copy.deepcopy(self.request);r['destination']['uid'] = 501
        with self.assertRaises(kit.Refused):kit.prepare(r, self.out)

    def test_actual_local_owner_check_and_rewritten_manifest_refuse(self):
        kit.prepare(self.request, self.out)
        uid = os.getuid()
        with patch.object(kit.os, 'getuid', return_value=uid + 1):
            with self.assertRaisesRegex(kit.Refused, 'owner'):kit.preflight(self.out)
        receipt = json.loads((self.out / 'manifest.json').read_text())
        receipt['authorized_for_effects'] = True
        (self.out / 'manifest.json').write_bytes(kit.encoded(receipt))
        with self.assertRaisesRegex(kit.Refused, 'manifest/request'):kit.preflight(self.out)

    def test_inventory_verifies_real_guard_manifest_and_code(self):
        co = self.source / 'co';co.mkdir()
        (self.source / 'tools/landing').mkdir(parents=True)
        (self.source / 'tools/landing/kit.sh').write_text('unchanged kit')
        (co / 'approved.json').write_text('{}')
        (co / 'deploy-trains.json').write_text('{}')
        guard = {'head': 'b'*40, 'checkout': str(self.source), 'tool': str(self.file),
                 'tool_sha256': kit.sha(self.file.read_bytes()), 'source_manifest': str(co / 'approved.json'),
                 'source_manifest_sha256': kit.sha((co / 'approved.json').read_bytes()),
                 'verified_file_sha256': {'tool.py': kit.sha(self.file.read_bytes())}}
        (co / 'guard.json').write_text(json.dumps(guard))
        config = copy.deepcopy(self.request['destination']['landing'])
        config['coordinator'] = str(co);config['ship'] = str(self.file)
        source_config = self.source / 'landing.json';source_config.write_text(json.dumps(config))
        # Real file reads and hash verification; git HEAD is the only mocked dependency.
        with patch.object(kit.subprocess, 'check_output', return_value='a'*40+'\n'):
            value = kit.inventory(source_config, self.source)
            self.assertEqual(value['guard_head'], 'b'*40)
            self.assertIn(str(self.file), [x['path'] for x in value['files']])
            self.file.write_text('guard drift')
            with self.assertRaisesRegex(kit.Refused, 'hash'):kit.inventory(source_config, self.source)

    def test_empty_partial_and_symlink_parent_are_not_repaired_blindly(self):
        self.out.mkdir(mode=0o700)
        with self.assertRaisesRegex(kit.Refused, 'no request'):kit.prepare(self.request, self.out)
        self.assertFalse((self.out / 'manifest.json').exists())
        linked = self.root / 'linked';linked.symlink_to(self.root)
        with self.assertRaisesRegex(kit.Refused, 'symlink'):kit.prepare(self.request, linked / 'other')


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import uuid


TOOL = Path(os.environ.get('STAGE1304_SOURCE', str(Path(__file__).resolve().parents[1] / 'tools' / 'stage_destination.py')))
if os.environ.get('STAGE1304_CACHE_RECEIPT'):
    Path(os.environ['STAGE1304_CACHE_RECEIPT']).write_text(json.dumps({
        'pycache_prefix': sys.pycache_prefix, 'ignore_environment': sys.flags.ignore_environment,
        'isolated': sys.flags.isolated, 'executable': sys.executable, 'argv': sys.argv}) + '\n')


def python_argv(tag):
    result = [sys.executable, '-I']
    if sys.pycache_prefix:
        result += ['-X', 'pycache_prefix=' + str(Path(sys.pycache_prefix) / tag)]
    return result


spec = importlib.util.spec_from_file_location('stage1304', TOOL)
stage = importlib.util.module_from_spec(spec) if TOOL.exists() else None
if stage is not None:
    spec.loader.exec_module(stage)


class NewCommand(unittest.TestCase):
    def test_new_command_can_show_help_without_core_or_a_profile(self):
        p = subprocess.run(python_argv('help') + [str(TOOL), '--help'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('snapshot', p.stdout)


@unittest.skipIf(stage is None, 'new offline tool absent on old source; explicit body barrier')
class Staging(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / 'input'
        self.source.mkdir(mode=0o700)
        (self.source / 'original-request.json').write_bytes(b'{"old_binding":"unchanged"}\n')
        (self.source / 'original-request.json').chmod(0o600)
        (self.source / 'bin').mkdir(mode=0o700)
        (self.source / 'bin' / 'tool').write_bytes(b'#!/bin/sh\nexit 0\n')
        (self.source / 'bin' / 'tool').chmod(0o700)
        self.selection = {'v': 1, 'selection_id': str(uuid.uuid4()), 'roots': [
            {'label': 'opaque', 'path': str(self.source), 'private': True}]}
        self.manifest = stage.snapshot(self.selection)
        self.path = self.root / 'manifest.json'
        self.digest = stage.write_new(self.path, self.manifest)
        self.user = pwd.getpwuid(os.getuid()).pw_name
        self.target = self.root / 'stage'

    def copy(self):
        return stage.copy(self.manifest, self.digest, self.target, self.user, 0, 0)

    def test_two_copy_legs_keep_old_request_bytes_and_use_actual_destination_owner(self):
        self.copy()
        self.assertEqual(stage.verify(self.manifest, self.target)['manifest_digest'], self.digest)
        destination = self.root / 'local'
        # Model an ownership-ignored mount: historical source UID differs from
        # this caller's apparent/actual local UID. Real two-Mac access is separate.
        for row in self.manifest['entries']:
            row['source_uid'] = os.getuid() + 1000
        alternate = self.root / 'historical-source-manifest.json'
        digest = stage.write_new(alternate, self.manifest)
        receipt_path = self.target / 'complete.json'
        receipt = json.loads(receipt_path.read_bytes())
        receipt['manifest_digest'] = digest
        receipt_path.write_text(json.dumps(receipt))
        pinned, actual_digest = stage.read_json(alternate, digest)
        stage.verify(pinned, self.target, transport=True)
        with mock.patch.object(stage.os, 'chown', side_effect=AssertionError('numeric owner applied')):
            stage.copy(pinned, actual_digest, destination, self.user, 0, 0, self.target)
        copied = destination / 'data/opaque/original-request.json'
        self.assertEqual(copied.read_bytes(), b'{"old_binding":"unchanged"}\n')
        self.assertEqual(copied.stat().st_uid, os.getuid())
        self.assertEqual(copied.stat().st_mode & 0o777, 0o600)
        self.assertEqual((destination / 'data/opaque/bin/tool').stat().st_mode & 0o777, 0o700)

    def test_nonprivate_source_classification_still_creates_private_copy(self):
        (self.source / 'original-request.json').chmod(0o644)
        self.selection['roots'][0]['private'] = False
        self.manifest = stage.snapshot(self.selection)
        path = self.root / 'classified-manifest.json'
        self.digest = stage.write_new(path, self.manifest)
        self.copy()
        copied = self.target / 'data/opaque/original-request.json'
        self.assertEqual(copied.stat().st_mode & 0o777, 0o600)
        self.assertEqual(copied.stat().st_uid, os.getuid())

    def test_cli_manifest_and_copy_entrypoints(self):
        selection = self.root / 'selection.json'
        stage.write_new(selection, self.selection)
        out = self.root / 'cli-manifest.json'
        p = subprocess.run(python_argv('snapshot') + [str(TOOL), 'snapshot', '--selection', str(selection), '--manifest', str(out)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)['files'], 2)
        self.assertNotIn(str(self.source), p.stdout)
        self.assertEqual(hashlib.sha256(out.read_bytes()).hexdigest(), json.loads(p.stdout)['digest'])

    def test_changed_bytes_refuse_without_complete_marker(self):
        (self.source / 'original-request.json').write_bytes(b'changed')
        with self.assertRaisesRegex(stage.Refused, 'source bytes'):
            self.copy()
        self.assertFalse((self.target / 'complete.json').exists())

    def test_wrong_digest_refuses(self):
        with self.assertRaisesRegex(stage.Refused, 'digest'):
            stage.read_json(self.path, '0' * 64)

    def test_public_private_file_and_wrong_owner_refuse(self):
        (self.source / 'original-request.json').chmod(0o644)
        with self.assertRaisesRegex(stage.Refused, 'mode'):
            stage.snapshot(self.selection)
        with mock.patch.object(stage.os, 'getuid', return_value=os.getuid() + 1):
            with self.assertRaisesRegex(stage.Refused, 'owner'):
                stage.facts(self.source)

    def test_symlink_and_hardlink_refuse(self):
        (self.source / 'link').symlink_to(self.root)
        with self.assertRaises(stage.Refused):
            stage.snapshot(self.selection)
        (self.source / 'link').unlink()
        os.link(self.source / 'original-request.json', self.source / 'second')
        with self.assertRaisesRegex(stage.Refused, 'hardlink'):
            stage.snapshot(self.selection)

    def test_missing_selected_file_refuses(self):
        (self.source / 'original-request.json').unlink()
        with self.assertRaises(OSError):
            self.copy()
        self.assertFalse((self.target / 'complete.json').exists())

    def test_capacity_refuses_before_target_creation(self):
        with mock.patch.object(stage.shutil, 'disk_usage', return_value=mock.Mock(free=0)):
            with self.assertRaisesRegex(stage.Refused, 'capacity'):
                self.copy()
        self.assertFalse(self.target.exists())

    def test_interruption_preserves_partial_and_refuses_reuse(self):
        with mock.patch.object(stage.shutil, 'copyfileobj', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.copy()
        self.assertTrue(self.target.exists())
        self.assertFalse((self.target / 'complete.json').exists())
        with self.assertRaises(FileExistsError):
            self.copy()
        with self.assertRaises(stage.Refused):
            stage.verify(self.manifest, self.target)

    def test_verify_detects_tamper_extra_mode_and_lost_result(self):
        self.copy()
        self.assertEqual(stage.verify(self.manifest, self.target)['status'], 'staged_only')
        file = self.target / 'data/opaque/original-request.json'
        original = file.read_bytes()
        file.write_bytes(b'x' * len(original))
        with self.assertRaisesRegex(stage.Refused, 'bytes'):
            stage.verify(self.manifest, self.target)
        file.write_bytes(original)
        file.chmod(0o644)
        with self.assertRaisesRegex(stage.Refused, 'mode'):
            stage.verify(self.manifest, self.target)
        file.chmod(0o600)
        (self.target / 'extra').write_bytes(b'extra')
        with self.assertRaisesRegex(stage.Refused, 'extra'):
            stage.verify(self.manifest, self.target)

    def test_path_traversal_and_duplicate_manifest_entries_refuse(self):
        self.manifest['entries'][0]['path'] = '../outside'
        with self.assertRaises(stage.Refused):
            stage.validate_manifest(self.manifest)
        m = stage.snapshot(self.selection)
        m['entries'].append(m['entries'][0])
        with self.assertRaises(stage.Refused):
            stage.validate_manifest(m)

    def test_mount_identity_encryption_ownership_and_external_required(self):
        info = {'FilesystemType': 'apfs', 'Encryption': False, 'Locked': False,
                'Internal': False, 'WritableVolume': True, 'GlobalPermissionsEnabled': False,
                'MountPoint': '/Volumes/secretsky', 'VolumeUUID': stage.TRANSPORT_UUID}
        stage.mount_facts(info, Path('/Volumes/secretsky'), stage.TRANSPORT_UUID)
        for key, bad in [('Encryption', None), ('GlobalPermissionsEnabled', None),
                         ('GlobalPermissionsEnabled', True),
                         ('Internal', True), ('Locked', True), ('VolumeUUID', 'other'),
                         ('MountPoint', '/Volumes/other')]:
            with self.subTest(key=key), self.assertRaises(stage.Refused):
                stage.mount_facts(dict(info, **{key: bad}), Path('/Volumes/secretsky'), stage.TRANSPORT_UUID)

    def test_cli_copy_refuses_wrong_account_before_volume_or_target_access(self):
        p = subprocess.run(python_argv('refused-copy') + [str(TOOL), 'copy',
            '--manifest', str(self.path), '--digest', self.digest,
            '--destination', str(self.target), '--account', 'root',
            '--volume', '/Volumes/theseus-move', '--volume-uuid', 'observed',
            '--extra-bytes', '0', '--reserve-bytes', '0'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn('wrong executing account', p.stderr)
        self.assertFalse(self.target.exists())

    def test_copy_preflight_pins_selected_volume_and_refuses_same_device_import(self):
        args = mock.Mock(destination=str(self.target), volume=str(self.root),
                         volume_uuid='observed', account=self.user,
                         extra_bytes=0, reserve_bytes=0, from_directory=None)
        with mock.patch.object(stage, 'preflight', return_value={'checked': True}) as guard, mock.patch.object(stage, 'TRANSPORT_FOLDER', self.root):
            self.assertEqual(stage.copy_preflight(args, self.manifest), {'checked': True})
            guard.assert_called_once()
            args.destination = str(self.root.parent / 'outside-selected-folder')
            with self.assertRaisesRegex(stage.Refused, 'selected transport'):
                stage.copy_preflight(args, self.manifest)
            args.destination = str(self.target)
            args.volume = str(self.root)
            args.from_directory = str(self.source)
            with self.assertRaisesRegex(stage.Refused, 'local, not transport'):
                stage.copy_preflight(args, self.manifest)


if __name__ == '__main__':
    unittest.main(verbosity=2)

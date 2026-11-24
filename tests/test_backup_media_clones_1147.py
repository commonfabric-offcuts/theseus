from __future__ import annotations

import ctypes
import errno
import hashlib
import os
from pathlib import Path
import unittest
from unittest import mock

from aim_next import recovery_io as io
import test_recovery_activation as recovery_tests


class BackupMediaCloneCase(unittest.TestCase):
    def setUp(self):
        # Compose the existing isolated backup/restore fixture, without inheriting
        # or duplicating its test methods in this new file's inventory.
        self.fixture = recovery_tests.RecoveryActivationCase(methodName='runTest')
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.source = self.fixture.ready_media()
        self.expected = dict(size=self.source.stat().st_size,
                             sha256=hashlib.sha256(self.source.read_bytes()).hexdigest())

    def assert_independent(self, target):
        original = target.read_bytes()
        self.assertEqual(original, self.source.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertNotEqual((target.stat().st_dev, target.stat().st_ino),
                            (self.source.stat().st_dev, self.source.stat().st_ino))
        self.source.write_bytes(b'later source mutation in an owned fixture')
        self.assertEqual(target.read_bytes(), original)

    def test_backup_default_really_clones_and_isolates_later_source_writes(self):
        native = getattr(io, '_clone_file', None)
        results = []

        def observed(fd, dest):
            self.assertTrue(callable(native), 'clone implementation is present')
            result = native(fd, dest)
            results.append(result)
            return result

        # create=True lets the same behavioral check run on original367: the
        # old backup completes its byte copy, then fails the clone assertion.
        with mock.patch.object(io, '_clone_file', side_effect=observed, create=True):
            result = self.fixture.backup()
        self.assertEqual(results, [True], 'this Mac must earn an actual native clone success')
        bundle = Path(result['bundle_path'])
        self.assert_independent(bundle/'media'/self.source.name)
        manifest = self.fixture.api().inspect(str(bundle), expected_digest=result['bundle_digest'])
        self.assertEqual(manifest['media'], [dict(name=self.source.name, **self.expected)])

    def test_unavailable_clone_falls_back_to_independent_verified_bytes(self):
        with mock.patch.object(io, '_clone_file', return_value=False) as attempt:
            result = self.fixture.backup()
        attempt.assert_called_once()
        self.assert_independent(Path(result['bundle_path'])/'media'/self.source.name)
        self.fixture.api().inspect(result['bundle_path'], expected_digest=result['bundle_digest'])

    def test_native_syscall_failure_uses_the_exclusive_copy_fallback(self):
        target = self.fixture.root/'fallback'
        clone = mock.Mock(return_value=-1)
        library = mock.Mock(fclonefileat=clone)
        with mock.patch.object(ctypes, 'CDLL', return_value=library):
            io.copy_file(self.source, target, self.expected, clone=True)
        clone.assert_called_once()
        self.assertEqual(clone.call_args.args[2:], (b'fallback', 1 | 2))
        self.assert_independent(target)

    def test_existing_file_and_dangling_symlink_are_never_adopted(self):
        target = self.fixture.root/'occupied'
        target.write_bytes(b'original destination')
        target.chmod(0o600)
        link = self.fixture.root/'dangling'
        link.symlink_to(self.fixture.root/'absent')
        for dest in (target, link):
            with self.subTest(dest=dest.name):
                with self.assertRaises(OSError) as error:
                    io.copy_file(self.source, dest, self.expected, clone=True)
                self.assertEqual(error.exception.errno, errno.EEXIST)
        self.assertEqual(target.read_bytes(), b'original destination')
        self.assertTrue(link.is_symlink())
        self.assertFalse((self.fixture.root/'absent').exists())

    def test_failed_clone_cannot_adopt_or_overwrite_an_unexpected_partial_target(self):
        target = self.fixture.root/'partial'

        def failed(fd, dest):
            Path(dest).write_bytes(b'partial clone residue')
            Path(dest).chmod(0o600)
            return False

        with mock.patch.object(io, '_clone_file', side_effect=failed):
            with self.assertRaises(FileExistsError):
                io.copy_file(self.source, target, self.expected, clone=True)
        self.assertEqual(target.read_bytes(), b'partial clone residue')
        self.assertEqual(self.source.read_bytes(), b'private attachment\x00exact bytes')

    def test_destination_arriving_at_native_entry_is_never_followed_or_replaced(self):
        # Inject the arrival only after the product has opened/checked the
        # parent, then invoke the real syscall. This is not a mocked refusal.
        native = ctypes.CDLL(None, use_errno=True).fclonefileat
        native.argtypes = (ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32)
        native.restype = ctypes.c_int
        for kind in ('file', 'dangling'):
            target = self.fixture.root / ('arriving-' + kind)
            referent = self.fixture.root / ('absent-' + kind)
            self.assertFalse(target.exists())
            self.assertFalse(target.is_symlink())
            self.assertFalse(referent.exists())

            def arrive(source_fd, parent_fd, name, flags):
                if kind == 'dangling':
                    os.symlink(referent.name, name, dir_fd=parent_fd)
                else:
                    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=parent_fd)
                    try:
                        os.write(fd, b'owned competing destination')
                    finally:
                        os.close(fd)
                return native(source_fd, parent_fd, name, flags)

            entry = mock.Mock(side_effect=arrive)
            with self.subTest(kind=kind, check='exclusive-refusal'):
                with mock.patch.object(ctypes, 'CDLL', return_value=mock.Mock(fclonefileat=entry)):
                    with self.assertRaises(OSError) as error:
                        io.copy_file(self.source, target, self.expected, clone=True)
                entry.assert_called_once()
                self.assertEqual(error.exception.errno, errno.EEXIST)
            with self.subTest(kind=kind, check='no-destination-side-effect'):
                self.assertFalse(referent.exists())
                if kind == 'dangling':
                    self.assertTrue(target.is_symlink())
                    self.assertEqual(os.readlink(target), referent.name)
                else:
                    self.assertEqual(target.read_bytes(), b'owned competing destination')
            self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.expected['sha256'])

    def test_wrong_expected_hash_refuses_without_publishing_a_manifest(self):
        # Leave the immutable ready row/guards intact. Change only equal-length
        # bytes in this owned blob so backup reaches its real hash boundary.
        original = self.source.read_bytes()
        self.source.write_bytes(bytes([original[0] ^ 1]) + original[1:])
        self.assertEqual(self.source.stat().st_size, self.expected['size'])
        self.assertEqual(self.fixture.sql(self.fixture.path, 'SELECT sha256 FROM media_intents'),
                         [(self.expected['sha256'],)])
        with self.assertRaises(io.RecoveryError) as error:
            self.fixture.backup()
        self.assertEqual(error.exception.code, 'BUNDLE_INVALID')
        self.assertFalse((self.fixture.root/'bundle'/'manifest.json').exists())

    def test_source_change_during_clone_refuses_even_when_cloned_bytes_match(self):
        native = io._clone_file

        def changed(fd, dest):
            result = native(fd, dest)
            self.assertTrue(result)
            self.source.write_bytes(b'changed while backup is in progress')
            return result

        with mock.patch.object(io, '_clone_file', side_effect=changed):
            with self.assertRaises(io.RecoveryError) as error:
                self.fixture.backup()
        self.assertEqual(error.exception.code, 'BUNDLE_INVALID')
        self.assertFalse((self.fixture.root/'bundle'/'manifest.json').exists())

    def test_clone_full_flush_failure_cannot_publish_completion(self):
        with mock.patch.object(io, 'full_flush', side_effect=OSError('owned flush fault')):
            with self.assertRaises(io.RecoveryError) as error:
                self.fixture.backup()
        self.assertEqual(error.exception.code, 'BACKUP_UNCONFIRMED')
        self.assertFalse((self.fixture.root/'bundle'/'manifest.json').exists())

    def test_hard_link_claiming_clone_success_is_rejected(self):
        def hard_link(fd, dest):
            os.link(self.source, dest)
            return True

        with mock.patch.object(io, '_clone_file', side_effect=hard_link):
            with self.assertRaises(io.RecoveryError):
                self.fixture.backup()
        self.assertFalse((self.fixture.root/'bundle'/'manifest.json').exists())

    def test_restore_keeps_using_independent_byte_copies(self):
        result = self.fixture.backup()
        request = self.fixture.request(result)
        with mock.patch.object(io, '_clone_file', side_effect=AssertionError('restore must not clone')):
            activated = self.fixture.api().activate(request)
        self.assertTrue(activated['durability_confirmed'])
        media = Path(request['candidate_path']+'.media')/self.source.name
        self.assertEqual(media.read_bytes(), self.source.read_bytes())
        self.assertEqual(media.stat().st_nlink, 1)
        bundle_media = Path(result['bundle_path'])/'media'/self.source.name
        self.assertNotEqual(media.stat().st_ino, bundle_media.stat().st_ino)


if __name__ == '__main__':
    unittest.main()

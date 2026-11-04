from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from aim_next import initialize
from aim_next.profile import ProfileError, load_profile, write_profile


class BoundProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "instance.sqlite3"
        self.binding = initialize(self.db, "profile-test", [{"id": "test-owner", "kind": "human"}],
                                  authority_path=self.root / "authority.json")["binding"]
        self.path = self.root / "owner.json"
        self.value = dict(self.binding, v=2, instance_id="profile-test",
                          actor_id="test-owner", db_path=str(self.db))

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, **changes):
        self.path.write_text(json.dumps(dict(self.value, **changes)))
        self.path.chmod(0o600)

    def test_explicit_binding_reads_same_instance_and_known_actor(self):
        write_profile(self.path, self.db, "profile-test", "test-owner", binding=self.binding)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        profile = load_profile(self.path)
        self.assertEqual(profile.actor_id, "test-owner")
        self.assertEqual(profile.instance_id, "profile-test")
        self.assertEqual(profile.db_path, self.db.resolve())
        self.assertEqual(profile.binding, self.binding)
        capabilities = profile.store().view(profile.actor_id, "capabilities", {})
        self.assertEqual(capabilities["instance_id"], "profile-test")

    def test_missing_store_wrong_instance_unknown_actor_fail_without_creation(self):
        missing = self.root / "not-an-instance.sqlite3"
        for change in ({"db_path": str(missing)}, {"instance_id": "another-instance"},
                       {"actor_id": "not-registered"}):
            with self.subTest(change=change):
                self.put(**change)
                with self.assertRaises(ProfileError):
                    load_profile(self.path)
        self.assertFalse(missing.exists())

    def test_profile_rejects_ambiguous_shape_and_relative_paths(self):
        for change in ({"v": True}, {"actor_id": ""}, {"db_path": "instance.sqlite3"},
                       {"as": "other-person"}, {"instance_id": "bad\nidentity"}):
            with self.subTest(change=change):
                self.put(**change)
                with self.assertRaises(ProfileError):
                    load_profile(self.path)
        self.put()
        self.path.write_text(self.path.read_text().replace('"v": 2', '"v": 2, "v": 2'))
        with self.assertRaises(ProfileError):
            load_profile(self.path)

    def test_non_private_and_symlink_profiles_are_refused(self):
        self.put()
        self.path.chmod(0o644)
        with self.assertRaises(ProfileError):
            load_profile(self.path)
        self.path.chmod(0o600)
        alias = self.root / "alias.json"
        alias.symlink_to(self.path)
        with self.assertRaises(ProfileError):
            load_profile(alias)

    def test_exclusive_creation_does_not_replace_an_existing_binding(self):
        write_profile(self.path, self.db, "profile-test", "test-owner", binding=self.binding)
        before = self.path.read_bytes()
        with self.assertRaises(ProfileError):
            write_profile(self.path, self.db, "profile-test", "test-owner", binding=self.binding)
        self.assertEqual(before, self.path.read_bytes())
        invalid = self.root / "invalid.json"
        with self.assertRaises(ProfileError):
            write_profile(invalid, self.db, "profile-test", "absent", binding=self.binding)
        self.assertFalse(invalid.exists())

    def test_wrong_authority_binding_refuses_without_discovering_active_binding(self):
        before = self.db.read_bytes()
        for changed in ({"authority_id": "wrong-authority"}, {"authority_epoch": "stale-epoch"},
                        {"authority_path": str(self.root / "not-the-authority.json")}):
            with self.subTest(changed=changed):
                self.put(**changed)
                with self.assertRaises(ProfileError):
                    load_profile(self.path)
        self.assertEqual(self.db.read_bytes(), before)
        self.assertFalse((self.root / "not-the-authority.json").exists())

    def test_copying_database_and_profile_does_not_create_another_writable_instance(self):
        copied = self.root / "copied.sqlite3"
        shutil.copy2(self.db, copied)
        before = copied.read_bytes()
        self.put(db_path=str(copied))
        with self.assertRaises(ProfileError):
            load_profile(self.path)
        self.assertEqual(copied.read_bytes(), before)
        self.assertEqual(self.db.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aim_next.profile import ProfileError, load_profile, write_profile


class ProfileAuthorityContractTests(unittest.TestCase):
    """Profile boundary only; actual authority enforcement is checked with Store."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.path = self.root / "profile.json"
        self.binding = {"authority_path": str(self.root / "authority.json"),
                        "authority_id": "authority-original", "authority_epoch": "epoch-original"}
        self.value = dict(self.binding, v=2, instance_id="isolated-profile",
                          actor_id="test-human", db_path=str(self.root / "records.sqlite3"))
        self.patcher = patch("aim_next.profile.Store")
        self.store = self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.store.return_value.view.return_value = {
            "instance_id": self.value["instance_id"], "limits": {"test": 1}}

    def put(self, value):
        self.path.write_text(json.dumps(value))
        self.path.chmod(0o600)

    def test_legacy_profile_refused_before_store_open_even_if_instance_is_valid(self):
        self.put({key: self.value[key] for key in ("v", "instance_id", "actor_id", "db_path")})
        value = json.loads(self.path.read_text())
        value["v"] = 1
        self.put(value)
        with self.assertRaises(ProfileError):
            load_profile(self.path)
        self.store.assert_not_called()

    def test_binding_is_forwarded_exactly_and_cannot_adopt_a_later_profile(self):
        self.put(self.value)
        profile = load_profile(self.path)
        self.store.assert_called_once_with(Path(self.value["db_path"]), self.value["instance_id"],
                                           expected_binding=self.binding)
        self.put(dict(self.value, authority_epoch="epoch-replacement"))
        returned = profile.binding
        returned["authority_epoch"] = "mutated-copy"
        profile.store()
        self.assertEqual(self.store.call_args.kwargs["expected_binding"], self.binding)
        self.assertEqual(profile.binding, self.binding)

    def test_missing_ambiguous_and_invalid_bindings_never_open_store(self):
        changes = [{"v": 1}, {"v": True}, {"authority_id": ""}, {"authority_epoch": ""},
                   {"authority_epoch": "bad\nidentity"}, {"authority_epoch": ["epoch"]},
                   {"authority_path": "relative/authority.json"}, {"authority_path": "/bad\x00path"},
                   {"authority_path": None}, {"fallback": True}]
        values = [dict(self.value, **change) for change in changes]
        values += [{key: val for key, val in self.value.items() if key != missing}
                   for missing in self.binding]
        for value in values:
            with self.subTest(value=value):
                self.store.reset_mock()
                self.put(value)
                with self.assertRaises(ProfileError):
                    load_profile(self.path)
                self.store.assert_not_called()
        self.store.reset_mock()
        self.put(self.value)
        self.path.write_text(self.path.read_text().replace('"v": 2', '"v": 2, "v": 2'))
        with self.assertRaises(ProfileError):
            load_profile(self.path)
        self.store.assert_not_called()

    def test_writer_requires_exact_explicit_binding_and_preserves_existing_path(self):
        write_profile(self.path, self.value["db_path"], self.value["instance_id"],
                      self.value["actor_id"], binding=self.binding)
        self.assertEqual(json.loads(self.path.read_text()), self.value)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        before = self.path.read_bytes()
        with self.assertRaises(ProfileError):
            write_profile(self.path, self.value["db_path"], self.value["instance_id"],
                          self.value["actor_id"], binding=dict(self.binding, authority_epoch="other"))
        self.assertEqual(self.path.read_bytes(), before)
        for binding in (None, {}, dict(self.binding, actor_id="other"), dict(self.binding, v=1)):
            with self.subTest(binding=binding), self.assertRaises(ProfileError):
                write_profile(self.root / "refused.json", self.value["db_path"],
                              self.value["instance_id"], self.value["actor_id"], binding=binding)
        self.assertFalse((self.root / "refused.json").exists())


if __name__ == "__main__":
    unittest.main()

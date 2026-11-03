from __future__ import annotations

import json
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

from aim_next import initialize
from aim_next.profile import write_profile, ProfileError
from aim_next.serve import server_for_profile


class InstanceLauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "records.sqlite3"
        self.profile_path = self.root / "profile.json"
        self.web = self.root / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text('<meta name="aim-next-session" content="__AIM_SESSION_TOKEN__">')
        initialize(self.db, "launcher-test", [{"id": "test-human", "kind": "human"}])
        write_profile(self.profile_path, self.db, "launcher-test", "test-human")

    def tearDown(self):
        self.tmp.cleanup()

    def test_launch_binds_profile_and_backend_request_limit(self):
        server = server_for_profile(self.profile_path, 0, self.web)
        try:
            self.assertEqual(server.server_address[0], "127.0.0.1")
            self.assertEqual(server.actor, "test-human")
            self.assertEqual(server.instance_id, "launcher-test")
            capabilities = server.store_factory().view(server.actor, "capabilities", {})
            self.assertEqual(server.max_json_bytes, capabilities["limits"]["http_envelope_bytes"])
        finally:
            server.server_close()

    def test_wrong_instance_profile_refuses_before_bind(self):
        profile = json.loads(self.profile_path.read_text())
        profile["instance_id"] = "old-instance"
        self.profile_path.write_text(json.dumps(profile))
        with self.assertRaises(ProfileError):
            server_for_profile(self.profile_path, 0, self.web)

    def test_occupied_port_stays_owned_by_existing_listener(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaises(OSError):
                server_for_profile(self.profile_path, port, self.web)
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                accepted, _ = listener.accept()
                accepted.close()

    def test_missing_shell_and_invalid_port_do_not_launch(self):
        for port in (-1, 65536, True):
            with self.subTest(port=port), self.assertRaises(ValueError):
                server_for_profile(self.profile_path, port, self.web)
        with self.assertRaises(ValueError):
            server_for_profile(self.profile_path, 0, self.root / "missing-web")

    def test_cli_requires_explicit_profile_and_port_and_rejects_actor_override(self):
        for args in ([], ["--profile", str(self.profile_path)],
                     ["--profile", str(self.profile_path), "--port", "0", "--as", "other-person"]):
            with self.subTest(args=args):
                result = subprocess.run(["/usr/bin/python3", "-m", "aim_next.serve"] + args,
                                        capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("ready", result.stdout)


if __name__ == "__main__":
    unittest.main()

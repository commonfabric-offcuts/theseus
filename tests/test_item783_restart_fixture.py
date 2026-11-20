from __future__ import annotations

"""A real fixture restart resets its build baseline without hiding mutations."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


class RestartFixture(unittest.TestCase):
    def fixture(self):
        child = subprocess.Popen(
            [sys.executable, "tests/fixtures/ui_http.py"],
            cwd=Path(__file__).resolve().parents[1],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.close_if_open, child)
        return child

    @staticmethod
    def close_if_open(child):
        if child.poll() is None:
            child.communicate(timeout=15)

    def control(self, child, method, **args):
        child.stdin.write(json.dumps(dict(args, id=method, method=method)) + "\n")
        child.stdin.flush()
        line = child.stdout.readline()
        self.assertTrue(line, "Fixture ended before answering")
        return json.loads(line)

    def test_restarted_build_can_mutate_and_restore_before_clean_exit(self):
        child = self.fixture()
        self.assertIn("answer", self.control(child, "ready"))
        self.assertIn("answer", self.control(child, "server_stop"))
        self.assertIn("answer", self.control(child, "server_start"))
        changed = self.control(child, "item_783_runtime", phase="wrong-background")["answer"]
        self.assertNotEqual(changed["hashes"], changed["candidate_hashes"])
        restored = self.control(child, "item_783_runtime", phase="restored")["answer"]
        self.assertEqual(restored["hashes"], changed["candidate_hashes"])
        self.assertTrue(restored["restored"])
        _, errors = child.communicate(timeout=15)
        self.assertEqual(child.returncode, 0, errors)

    def test_restart_cannot_hide_an_unrestored_comparison(self):
        child = self.fixture()
        self.control(child, "ready")
        changed = self.control(child, "item_783_runtime", phase="wrong-background")["answer"]
        self.assertNotEqual(changed["hashes"], changed["candidate_hashes"])
        refused = self.control(child, "server_stop")
        self.assertIn("Restore Item 783 comparison runtime", refused["failure"])
        _, errors = child.communicate(timeout=15)
        self.assertNotEqual(child.returncode, 0, "Unrestored comparison must still fail cleanup")
        self.assertIn("Item 783 comparison runtime was not restored", errors)


if __name__ == "__main__":
    unittest.main()

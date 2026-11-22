from __future__ import annotations

"""Abort the actual requester; assess the fixture separately from its body error."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FixtureAbortTests(unittest.TestCase):
    def aborted(self, method, phase):
        evidence = os.environ.get("AIM_1089_EVIDENCE")
        parent = Path(evidence) if evidence else None
        if parent:
            parent.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix=method + "-", dir=str(parent) if parent else None))
        if not parent:
            import shutil
            self.addCleanup(shutil.rmtree, str(folder))
        env = dict(os.environ, PYTHONPYCACHEPREFIX=str(folder / "requester-pycache"))
        command = [sys.executable, "tests/reading_fixture_abort_1089.py", method, phase, str(folder)]
        result = subprocess.run(command, cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=60)
        (folder / "requester.stdout").write_text(result.stdout)
        (folder / "requester.stderr").write_text(result.stderr)
        (folder / "requester-command.json").write_text(json.dumps({"command": command, "exit": result.returncode,
                  "cachePrefix": env["PYTHONPYCACHEPREFIX"]}, indent=2) + "\n")
        report = json.loads((folder / "report.json").read_text())
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(report["bodyCompleted"])
        self.assertIn("requesting test aborted after applied", report["bodyError"])
        # Propagation adds the caller's frame above the saved inner traceback.
        self.assertTrue(result.stderr.endswith(report["bodyError"].split("\n", 1)[1]), result.stderr)
        self.assertNotEqual(report["selected"]["hashes"], report["candidate"]["hashes"])
        self.assertEqual(report["cleanupErrors"], [])
        self.assertTrue(report["fixtureEOF"])
        self.assertTrue(report["fixturePidAbsent"])
        self.assertTrue(report["tcpRefused"])
        self.assertEqual(report["fixtureExit"], 0, report["fixtureStderr"])
        self.assertEqual(report["fixtureStderr"], "")
        records = [json.loads(line) for line in (folder / "fixture-teardown.jsonl").read_text().splitlines()]
        restored = [row for row in records if row.get("event") == "runtime-restored" and row.get("needed")]
        self.assertTrue(restored, records)
        self.assertTrue(any(row["after"]["hashes"] == report["candidate"]["hashes"] for row in restored))
        self.assertTrue(any(row["after"]["csp_sha256"] == report["candidate"]["csp_sha256"] for row in restored))
        self.assertEqual(records[-1]["event"], "cleanup-complete")
        self.assertEqual(records[-1]["errors"], [])

    def test_645_abort_restores_exact_runtime_and_preserves_body_error(self):
        self.aborted("item_645_runtime", "original")

    def test_650_abort_restores_exact_runtime_and_preserves_body_error(self):
        self.aborted("item650_runtime", "baseline")

    def test_783_abort_restores_exact_runtime_and_preserves_body_error(self):
        self.aborted("item_783_runtime", "wrong-background")

    def test_674_abort_restores_shared_runtime(self):
        self.aborted("item_674_runtime", "original")

    def test_721_abort_restores_runtime_and_phase(self):
        self.aborted("item_721_runtime", "baseline")

    def test_731_abort_restores_shared_runtime(self):
        self.aborted("item_731_runtime", "original")

    def test_738_abort_restores_shared_runtime(self):
        self.aborted("item_738_runtime", "live")

    def test_785_abort_restores_optional_runtime(self):
        self.aborted("reading_785_runtime", "no-hold")


if __name__ == "__main__":
    unittest.main()

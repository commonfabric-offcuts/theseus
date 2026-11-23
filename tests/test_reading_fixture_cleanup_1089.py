from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests/fixtures"))
from fixture_teardown import FixtureCleanup, FixtureCleanupError


class CleanupErrors(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="cleanup1089-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "teardown.jsonl"

    def test_preexisting_evidence_is_refused_without_touching_bytes(self):
        self.path.write_bytes(b"existing original evidence\n")
        with self.assertRaises(FileExistsError):
            FixtureCleanup(self.path)
        self.assertEqual(self.path.read_bytes(), b"existing original evidence\n")

    def test_original_body_and_each_cleanup_error_survive_later_success(self):
        cleanup = FixtureCleanup(self.path)
        restored = []
        errors = io.StringIO()
        def fail_one():
            raise ValueError("first actual cleanup error")
        def fail_two():
            raise OSError("second actual cleanup error")
        with contextlib.redirect_stderr(errors):
            with self.assertRaisesRegex(RuntimeError, "original fixture body"):
                try:
                    raise RuntimeError("original fixture body")
                finally:
                    original = sys.exc_info()[1]
                    cleanup.attempt("first", fail_one)
                    cleanup.attempt("second", fail_two)
                    cleanup.attempt("remaining", lambda: restored.append(True))
                    cleanup.finish(original)
        self.assertEqual(restored, [True])
        self.assertIn("ValueError: first actual cleanup error", errors.getvalue())
        self.assertIn("OSError: second actual cleanup error", errors.getvalue())
        final = json.loads(self.path.read_text().splitlines()[-1])
        self.assertEqual([r["stage"] for r in final["errors"]], ["first", "second"])
        self.assertEqual(final["fixtureBodyError"]["message"], "original fixture body")

    def test_observation_write_failure_is_real_and_remaining_cleanup_runs(self):
        cleanup = FixtureCleanup(self.path)
        self.path.unlink()
        self.path.mkdir()
        later = []
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            cleanup.attempt("remaining-cleanup", lambda: later.append(True))
            with self.assertRaises(FixtureCleanupError):
                cleanup.finish()
        self.assertEqual(later, [True])
        self.assertIn("IsADirectoryError", errors.getvalue())
        self.assertTrue(all(r["stage"] == "evidence-write" for r in cleanup.errors))


class FixtureLifecycle(unittest.TestCase):
    def fixture(self, requests=(), raw_tail="", fault=False):
        parent = os.environ.get("AIM_1089_EVIDENCE")
        if parent:
            Path(parent).mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="lifecycle-", dir=parent))
        if not parent:
            import shutil
            self.addCleanup(shutil.rmtree, str(folder))
        destination = folder / "fixture-teardown.jsonl"
        args = ["tests/fixtures/ui_http.py", "--freshness", "--teardown-observations", str(destination)]
        command = [sys.executable] + args
        if fault:
            wrapper = '''import runpy,sys
sys.path.insert(0,'tests/fixtures')
from fixture_teardown import FixtureCleanup
restore=FixtureCleanup.restore_runtime
def failed_restore(*args,**kwargs):
    restore(*args,**kwargs)
    raise RuntimeError('applied restore verification fault')
FixtureCleanup.restore_runtime=failed_restore
ns=runpy.run_path('tests/fixtures/ui_http.py')
g=ns['main'].__globals__
create=g['create_server']
def create_fault(*args,**kwargs):
    server=create(*args,**kwargs)
    close=server.server_close
    def failed_close():
        close()
        raise OSError('applied HTTP close fault')
    server.server_close=failed_close
    return server
g['create_server']=create_fault
sys.argv=ARGS
ns['main']()
'''.replace("ARGS", repr(args))
            (folder / "applied-fault-wrapper.py").write_text(wrapper)
            command = [sys.executable, "-c", wrapper]
        env = dict(os.environ, PYTHONPYCACHEPREFIX=str(folder / "pycache"))
        child = subprocess.Popen(command, cwd=str(ROOT), env=env, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        lines = []
        def control(method, **more):
            request = dict(more, id=len(lines) + 1, method=method)
            child.stdin.write(json.dumps(request) + "\n"); child.stdin.flush()
            self.assertTrue(select.select([child.stdout], [], [], 30)[0], "fixture control bound")
            line = child.stdout.readline(); self.assertTrue(line, "fixture answered before EOF")
            lines.append({"request": request, "response": json.loads(line), "raw": line})
            return lines[-1]["response"]
        try:
            ready = control("ready", runtime_evidence=True)["answer"]
            self.assertEqual(ready["runtime_evidence"]["pycache_prefix"], env["PYTHONPYCACHEPREFIX"])
            for method, more in requests:
                control(method, **more)
            if raw_tail:
                child.stdin.write(raw_tail); child.stdin.flush()
        finally:
            tail, errors = child.communicate(timeout=30)
            (folder / "fixture.stdout").write_text("".join(row["raw"] for row in lines) + tail)
            (folder / "fixture.stderr").write_text(errors)
            records = [json.loads(line) for line in destination.read_text().splitlines()]
            report = {"command": command, "pid": child.pid, "exit": child.returncode, "stderr": errors,
                      "controls": lines, "records": records, "cachePrefix": env["PYTHONPYCACHEPREFIX"]}
            (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        with self.assertRaises(ProcessLookupError):
            os.kill(child.pid, 0)
        address = urlsplit(ready["origin"])
        with socket.socket() as probe:
            probe.settimeout(1)
            self.assertNotEqual(probe.connect_ex((address.hostname, address.port)), 0)
        return report

    def test_no_swap_records_completed_clean_noop(self):
        r = self.fixture()
        self.assertEqual((r["exit"], r["stderr"]), (0, ""))
        self.assertFalse(any(row.get("needed") for row in r["records"]))
        self.assertEqual(r["records"][-1], {"event": "cleanup-complete", "errors": [], "fixtureBodyError": None})

    def test_explicit_restoration_is_a_clean_noop_at_eof(self):
        r = self.fixture([("item_783_runtime", {"phase": "wrong-background"}), ("item_783_runtime", {"phase": "restored"})])
        self.assertEqual((r["exit"], r["stderr"]), (0, ""))
        self.assertFalse(any(row.get("needed") for row in r["records"]))

    def test_stopped_server_eof_does_not_dereference_none(self):
        r = self.fixture([("server_stop", {})])
        self.assertEqual((r["exit"], r["stderr"]), (0, ""))
        self.assertEqual(r["records"][-1]["errors"], [])

    def test_restarted_candidate_and_original_server_are_each_restored(self):
        r = self.fixture([("server_stop", {}), ("server_start", {}), ("item_783_runtime", {"phase": "wrong-background"})])
        self.assertEqual((r["exit"], r["stderr"]), (0, ""))
        restores = [row for row in r["records"] if row["event"] == "runtime-restored"]
        self.assertEqual([row["owner"] for row in restores], [0, 1])
        self.assertEqual([row["needed"] for row in restores], [False, True])
        self.assertEqual(restores[0]["after"]["hashes"], restores[1]["after"]["hashes"])

    def test_nested_650_unwinds_then_restores_the_outer_candidate(self):
        r = self.fixture([("item_783_runtime", {"phase": "wrong-background"}), ("item650_runtime", {"phase": "baseline"})])
        self.assertEqual((r["exit"], r["stderr"]), (0, ""))
        restores = [row for row in r["records"] if row["event"] == "runtime-restored"]
        self.assertEqual([row["owner"] for row in restores], ["650", 0])
        self.assertTrue(all(row["needed"] for row in restores))
        self.assertNotEqual(restores[0]["after"]["hashes"], restores[1]["after"]["hashes"])
        self.assertEqual(restores[1]["after"]["hashes"], r["controls"][1]["response"]["answer"]["candidate_hashes"])

    def test_applied_restore_close_faults_and_real_body_error_are_all_kept(self):
        r = self.fixture([("item_783_runtime", {"phase": "wrong-background"})], raw_tail="{broken\n", fault=True)
        self.assertEqual(r["exit"], 1)
        for failure in ["applied restore verification fault", "applied HTTP close fault", "JSONDecodeError"]:
            self.assertIn(failure, r["stderr"])
        final = r["records"][-1]
        self.assertEqual([row["stage"] for row in final["errors"]], ["public-runtime-0", "http-close"])
        self.assertEqual(final["fixtureBodyError"]["type"], "JSONDecodeError")
        self.assertTrue(any(row.get("stage") == "controls-health" and row.get("status") == "ok" for row in r["records"]))
        self.assertTrue(any(row.get("stage") == "http-thread" and row.get("status") == "ok" for row in r["records"]))


if __name__ == "__main__":
    unittest.main()

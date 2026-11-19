from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))
from aim_next import web_build
from item_650_runtime import BASE, TREE, Item650Runtime


class FullBaselineCase(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="item650-baseline-")
        self.addCleanup(self.folder.cleanup)
        self.runtime = Item650Runtime(ROOT, self.folder.name, web_build.load)
        self.candidate = web_build.load(ROOT / "web")
        scripts = " ".join(["'self'"] + ["'%s'" % d for d in self.candidate.script_hashes])
        self.csp = "default-src 'self'; script-src " + scripts + "; style-src 'self'; object-src 'none'"
        self.server = SimpleNamespace(build=self.candidate, csp=self.csp)

    def test_entire_git_tree_build_index_import_map_csp_and_restore(self):
        receipt = self.runtime.select(self.server, "baseline")
        self.assertEqual(receipt["commit"], BASE)
        self.assertEqual(receipt["tree"], TREE)
        self.assertEqual(receipt["candidate_csp_sha256"], hashlib.sha256(self.csp.encode()).hexdigest())
        self.assertEqual(receipt["csp_sha256"], hashlib.sha256(self.server.csp.encode()).hexdigest())
        self.assertEqual(receipt["index_sha256"], hashlib.sha256(self.server.build.index).hexdigest())
        rows = subprocess.check_output(["git", "ls-tree", "-rz", BASE, "--", "web/"], cwd=str(ROOT)).split(b"\0")
        names = [row.split(b"\t")[1].decode()[4:] for row in rows if row]
        self.assertEqual(set(names), set(receipt["files"]))
        baseline = self.server.build
        self.assertEqual(set(baseline.files), {n for n in names if web_build.public(n)})
        for name, actual in baseline.files.items():
            expected = subprocess.check_output(["git", "show", BASE + ":web/" + name], cwd=str(ROOT))
            self.assertEqual(actual, expected, name)
            self.assertEqual(hashlib.sha256(actual).hexdigest(), receipt["files"][name]["sha256"])
        self.assertNotIn(b"keepReplyVisible", baseline.files["reader.mjs"])
        self.assertNotIn(b"keepReplyVisible", baseline.files["app.mjs"])
        self.assertNotIn("composer-width.mjs", baseline.files)
        self.assertIn(("/b/" + baseline.stamp + "/app.mjs").encode(), baseline.index)
        self.assertIn(baseline.files["boot.js"], baseline.index)
        for digest in baseline.script_hashes:
            self.assertIn("'" + digest + "'", self.server.csp)
        self.assertIn("style-src 'self'; object-src 'none'", self.server.csp)
        for name, data in baseline.files.items():
            if name != "index.html":
                self.assertEqual(baseline.asset("/b/" + baseline.stamp + "/" + name), data)
                self.assertIsNone(baseline.asset("/b/" + self.candidate.stamp + "/" + name))
        receipt = self.runtime.select(self.server, "restored")
        self.assertTrue(receipt["restored"])
        self.assertEqual(receipt["csp_sha256"], hashlib.sha256(self.csp.encode()).hexdigest())
        self.assertTrue(self.server.build is self.candidate, "restores exact candidate Build")
        self.assertEqual(self.server.csp, self.csp)
        self.runtime.close()

    def test_invalid_transition_and_unrestored_cleanup_refuse(self):
        with self.assertRaisesRegex(AssertionError, "Unknown"):
            self.runtime.select(self.server, "current-ish")
        with self.assertRaisesRegex(AssertionError, "not active"):
            self.runtime.select(self.server, "restored")
        self.runtime.select(self.server, "baseline")
        with self.assertRaisesRegex(AssertionError, "already active"):
            self.runtime.select(self.server, "baseline")
        with self.assertRaisesRegex(AssertionError, "fixture changed"):
            self.runtime.select(SimpleNamespace(), "restored")
        with self.assertRaisesRegex(AssertionError, "not restored"):
            self.runtime.close()
        self.assertTrue(self.server.build is self.candidate, "restores exact candidate Build")
        self.assertEqual(self.server.csp, self.csp)


if __name__ == "__main__":
    unittest.main()

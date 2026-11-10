from __future__ import annotations

import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from tools import native, release_check

CHROME = "/x" + release_check.CHROME_SUFFIX
# A stand-in node harness: records its argv and writes a results file; the case named "bad" fails.
STUB = r'''#!%s
import json, os, sys
evidence = sys.argv[3]
open(os.path.join(evidence, "argv.json"), "w").write(json.dumps(sys.argv[1:]))
open(os.path.join(evidence, "playwright.json"), "w").write(json.dumps(os.environ.get("AIM_PLAYWRIGHT_CORE")))
bad = sys.argv[-1] == "bad"
open(os.path.join(evidence, "native.json"), "w").write(json.dumps(
    {"browserClosed": True, "results": [{"name": "case", "passed": not bad,
     "error": '{"kind": "focus", "at": "reader"}\n{"kind": "focus", "at": "reader"}'}]}))
sys.exit(int(bad))
'''


class Digest(unittest.TestCase):
    def test_lists_failed_cases_with_their_commonest_kinds(self):
        report = {"results": [
            {"name": "kept", "passed": True},
            {"name": "caught", "expectedFailure": True, "mutationCaught": True},
            {"name": "lost focus", "passed": False,
             "error": '{"kind": "focus", "at": "reader"}\nplain\n{"kind": "focus", "at": "reader"}\n{"kind": "scroll", "at": "list"}'},
            {"name": "crashed", "passed": False, "error": "Timed out: ready"},
            {"name": "escaped", "expectedFailure": True, "mutationCaught": False, "error": ""},
        ]}
        self.assertEqual(native.digest(report), [
            "FAILED lost focus", "    2 ('focus', 'reader')", "    1 ('scroll', 'list')",
            "FAILED crashed", "    Timed out: ready",
            "FAILED escaped", "    "])


class Main(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.node = self.base / "node"
        self.node.write_text(STUB % sys.executable)
        self.node.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def main(self, *args):
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(out), \
                mock.patch.object(release_check, "chrome_path", return_value=CHROME):
            code = native.main(["--node", str(self.node)] + list(args))
        return code, out.getvalue()

    def test_runs_one_mode_with_its_case_filter(self):
        out = self.base / "run"
        code, printed = self.main("--out", str(out), "colors", "rendering")
        self.assertEqual(code, 0, printed)
        argv = json.loads((out / "evidence" / "argv.json").read_text())
        self.assertEqual(argv, [release_check.PERSISTENCE, CHROME, str(out / "evidence"), "--colors", "rendering"])

    def test_a_webkit_mode_gets_playwright_core_and_a_chrome_mode_does_not(self):
        with mock.patch.dict(os.environ), \
                mock.patch.object(release_check, "playwright_path", return_value="/stub/playwright-core") as found:
            os.environ.pop("AIM_PLAYWRIGHT_CORE", None)
            out = self.base / "webkit"
            code, printed = self.main("--out", str(out), "--playwright", "/named", "webkit-colors")
            self.assertEqual(code, 0, printed)
            found.assert_called_once_with("/named")
            self.assertEqual(json.loads((out / "evidence" / "argv.json").read_text())[0], release_check.WEBKIT)
            self.assertEqual(json.loads((out / "evidence" / "playwright.json").read_text()), "/stub/playwright-core")
            out = self.base / "chrome"
            code, printed = self.main("--out", str(out), "--playwright", "/named", "colors")
            self.assertEqual(code, 0, printed)
            found.assert_called_once_with("/named")
            self.assertIsNone(json.loads((out / "evidence" / "playwright.json").read_text()))
            # The composer's checks load playwright-core for Chrome as well as WebKit.
            out = self.base / "compose"
            code, printed = self.main("--out", str(out), "--playwright", "/named", "compose", "bad")
            self.assertEqual(code, 1, printed)
            self.assertEqual(found.call_count, 2)
            self.assertEqual(json.loads((out / "evidence" / "argv.json").read_text()), [release_check.COMPOSE, CHROME, str(out / "evidence"), "bad"])
            self.assertEqual(json.loads((out / "evidence" / "playwright.json").read_text()), "/stub/playwright-core")

    def test_a_failed_case_exits_one_and_is_listed(self):
        code, printed = self.main("--out", str(self.base / "run"), "openings", "bad")
        self.assertEqual(code, 1)
        self.assertIn("FAILED case\n    2 ('focus', 'reader')", printed)

    def test_refusals(self):
        self.assertEqual(self.main("--out", "relative", "journal")[0], 2)
        (self.base / "used").mkdir()
        (self.base / "used" / "x").write_text("")
        self.assertEqual(self.main("--out", str(self.base / "used"), "journal")[0], 2)
        self.assertEqual(self.main("--out", str(self.base / "r"), "reader-keyboard", "a filter")[0], 2)
        self.assertFalse((self.base / "r").exists())


if __name__ == "__main__":
    unittest.main()

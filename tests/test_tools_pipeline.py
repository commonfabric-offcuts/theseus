from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

BUILDER = Path(__file__).resolve().parents[1] / "tools" / "pipeline" / "build_pipeline.py"


class PipelineBuilder(unittest.TestCase):
    def test_the_page_lists_every_item_once_under_its_stable_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "page.txt"
            built = subprocess.run([sys.executable, "-B", str(BUILDER), str(out)], cwd=tmp, capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            page = out.read_text()
            self.assertEqual(sorted(Path(tmp).iterdir()), [out])
        items = json.loads((BUILDER.parent / "items.json").read_text())["items"]
        numbers = [int(n) for n in re.findall(r"^\S+ (\d+)\. ", page, re.M)]
        # Numbers are stable and never reused: each from 1 to the highest appears exactly once.
        self.assertEqual(sorted(numbers), list(range(1, max(numbers) + 1)))
        self.assertGreaterEqual(max(numbers), len(items))
        self.assertTrue(page.startswith("Release pipeline\n"))


if __name__ == "__main__":
    unittest.main()

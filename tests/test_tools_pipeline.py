from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

BUILDER = Path(__file__).resolve().parents[1] / "tools" / "pipeline" / "build_pipeline.py"


def page(*records):
    return json.dumps({"instance_id": "i-1", "items": list(records), "next_cursor": None})


def release(number, items, at, commit):
    return {"release": number, "commit": commit * 40, "previous": None, "deployed_at": at, "deployed_ms": 0,
            "items": items, "measurements": None, "source": "deploy", "evidence": None, "recorded_ms": 0}


R18 = release(18, [1, 4], "2026-11-05T22:57:59-08:00", "7")
R19 = release(19, [87, 90, 2], "2026-11-06T05:28:35-08:00", "4")


class PipelineBuilder(unittest.TestCase):
    def build(self, records, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "page.txt"
            built = subprocess.run([sys.executable, "-B", str(BUILDER), "--releases", "-", str(out)] + list(extra),
                                   input=records, cwd=tmp, capture_output=True, text=True)
            if built.returncode:
                return None, built.stderr
            self.assertEqual(sorted(Path(tmp).iterdir()), [out])
            return out.read_text(), built.stderr

    def sections(self, page_text):
        """{section heading's first word: [item numbers under it]}."""
        found, current = {}, None
        for line in page_text.splitlines():
            heading = re.match(r"^(NOW|NEXT|LATER|CANDIDATES|SHIPPED)\b", line)
            if heading:
                current = heading.group(1)
            number = re.match(r"^\S+ (\d+)\. ", line)
            if number and current:
                found.setdefault(current, []).append(int(number.group(1)))
        return found

    def test_the_page_lists_every_item_once_under_its_stable_number(self):
        page_text, err = self.build(page(R19, R18))
        self.assertIsNotNone(page_text, err)
        items = json.loads((BUILDER.parent / "items.json").read_text())["items"]
        numbers = [int(n) for n in re.findall(r"^\S+ (\d+)\. ", page_text, re.M)]
        # Numbers are stable and never reused: each from 1 to the highest appears exactly once.
        self.assertEqual(sorted(numbers), list(range(1, max(numbers) + 1)))
        self.assertGreaterEqual(max(numbers), len(items))
        self.assertTrue(page_text.startswith("Release pipeline\n"))

    def test_an_item_a_release_record_names_is_shipped_under_that_release(self):
        page_text, err = self.build(page(R19) + "\n" + page(R18) + "\n")
        self.assertIsNotNone(page_text, err)
        sections = self.sections(page_text)
        self.assertEqual(sections["SHIPPED"], [87, 90, 2, 1, 4, 7])
        for name in ("NOW", "NEXT", "LATER", "CANDIDATES"):
            self.assertFalse({87, 90, 2, 1, 4} & set(sections.get(name, [])), name)
        # 3 shipped in no record here, so it is still in NOW.
        self.assertIn(3, sections["NOW"])
        shipped = page_text[page_text.index("\nSHIPPED\n"):]
        self.assertLess(shipped.index("Release 19, 5:28 AM Fri 6 November 2026\n✅ 87. "),
                        shipped.index("Release 18, 10:57 PM Thu 5 November 2026\n✅ 1. "))
        self.assertIn("\nChanged 5:28 AM Fri 6 November 2026: release 19 is live, so 87, 90, 2 moved to SHIPPED.\n", page_text)

    def test_an_item_two_records_name_is_refused(self):
        twice = release(20, [88, 2], "2026-11-07T05:28:35-08:00", "5")
        page_text, err = self.build(page(twice, R19, R18))
        self.assertIsNone(page_text)
        self.assertIn("item 2 is named by releases 19 and 20", err)

    def test_without_the_record_of_a_shipped_item_the_page_is_refused(self):
        # Release 18's 1 and 4 are in no section: the page cannot be built without its record.
        page_text, err = self.build(page(R19))
        self.assertIsNone(page_text)
        self.assertIn("AssertionError", err)
        page_text, err = self.build('{"instance_id":"i-1","error":{"code":"DATABASE_BUSY"}}\n')
        self.assertIsNone(page_text)
        self.assertIn("not a page of release records", err)


if __name__ == "__main__":
    unittest.main()

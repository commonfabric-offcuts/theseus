from __future__ import annotations

"""Skill and tool records (item 17; docs/skills-and-tools.md, section 2): every record in this repository reads
through the one parser, and the parser refuses each problem by file, so a malformed record can never pass a release
check. The parser's closed lists of the deploy's, the release check's and the tool step's own files are read here
from the code that guards each, so a file that starts being guarded there must be named in tool_records too."""

import json
from pathlib import Path
import tempfile
import unittest

from aim_next import tool_records
from tools import release_check, train
from test_tool_core import write_tools

ROOT = Path(__file__).resolve().parents[1]


class RepositoryCase(unittest.TestCase):
    def test_every_record_in_this_repository_reads_and_each_problem_is_named(self):
        records = tool_records.Records(ROOT)
        self.assertIsNone(records.error, records.error and "\n".join(records.error.problems))
        self.assertTrue(records.tools, "the five seeds are here")

    def test_the_closed_lists_are_the_files_the_deploy_the_release_check_and_the_step_guard(self):
        self.assertEqual(set(tool_records.DEPLOY_OWN), set(train.DEPLOY_TOOL) | set(train.MIGRATIONS))
        self.assertFalse(train.CONTROLLER.startswith(tool_records.ROOTS), "the controller is outside every place a tool's file may be")
        self.assertEqual(set(tool_records.RELEASE_CHECK_OWN), set(release_check.harnesses()) | {"tools/release_check.py"})
        self.assertEqual(set(tool_records.STEP_OWN), {"tools/tool_check.py", "tests/acts.json"})


class RecordsCase(unittest.TestCase):
    """The parser and the content id, from bytes and a listing given to them."""

    def read(self, records, files=("tools/kite.py", "tests/test_tools_kite.py")):
        data = {"skills/%s.json" % record["id"]: json.dumps(record).encode() for record in records}
        return tool_records.read(list(data) + list(files), data.__getitem__, lambda path: "file" if path in files else None)

    def tool(self, **fields):
        base = {"id": "kite-flyer", "kind": "tool", "name": "Kite flyer", "summary": "Flies a kite", "home": "w1",
                "files": ["tools/kite.py", "tests/test_tools_kite.py"], "check": {"python": "tests/test_tools_kite.py"}}
        base.update(fields)
        return base

    def test_a_good_record_reads_and_every_problem_is_named_by_file(self):
        records, problems = self.read([self.tool()])
        self.assertEqual((sorted(records), problems), (["kite-flyer"], []))
        cases = [
            (self.tool(files=["tools/deploy.py"], check=None),
             "skills/kite-flyer.json names tools/deploy.py, which is the deploy's own code; deploy and the release checks stay ordinary code."),
            (self.tool(files=["tests/test_tools_kite.py"], check={"python": "tests/test_tools_kite.py"}, colour="red"),
             "skills/kite-flyer.json: unknown key 'colour'"),
            (self.tool(files=["tools/kite.py"]), "the check tests/test_tools_kite.py is not one of kite-flyer's files."),
            (self.tool(id="Kite"), "skills/Kite.json: its id is not lowercase words joined by hyphens, at most 40 characters"),
            (self.tool(files=["tools/../kite.py"], check=None), "skills/kite-flyer.json: tools/../kite.py is not a plain repository path (no leading /, no empty, . or .. parts)"),
            (self.tool(files=["web/app.mjs"], check=None), "skills/kite-flyer.json: web/app.mjs is not under skills/, tools/ or tests/"),
            (self.tool(files=["tools/kite.py", "tools/kite.py", "tests/test_tools_kite.py"]), "skills/kite-flyer.json lists tools/kite.py twice"),
            (self.tool(files=["tools/tool_check.py"], check=None),
             "skills/kite-flyer.json names tools/tool_check.py, which is the tool step's own code; deploy and the release checks stay ordinary code."),
            (self.tool(files=["tests/reader_native.mjs"], check=None),
             "skills/kite-flyer.json names tests/reader_native.mjs, which is the release check's own code; deploy and the release checks stay ordinary code."),
            (self.tool(name=""), "skills/kite-flyer.json: its name is 1 to 60 characters on one line"),
            (self.tool(summary="two\nlines"), "skills/kite-flyer.json: its summary is 1 to 200 characters on one line"),
            (self.tool(check={"python": "tests/kite.py"}), "skills/kite-flyer.json: its python check is a tests/test_*.py module"),
        ]
        for record, problem in cases:
            with self.subTest(problem=problem):
                path = "skills/%s.json" % record["id"]
                data = {path: json.dumps(record).encode()}
                _, problems = tool_records.read(list(data), data.__getitem__, lambda path: "file")
                self.assertIn(problem, problems)

    def test_a_file_shared_by_two_records_and_a_file_not_there_are_refused(self):
        other = self.tool(id="act-keeper", name="Act keeper", files=["tools/kite.py"], check=None)
        _, problems = self.read([self.tool(), other])
        self.assertIn("tools/kite.py belongs to two tools: act-keeper and kite-flyer.", problems)
        _, problems = self.read([self.tool()], files=("tools/kite.py",))
        self.assertIn("skills/kite-flyer.json names tests/test_tools_kite.py, which is not a regular file here", problems)

    def test_the_content_id_is_one_function_of_the_paths_and_bytes(self):
        one = tool_records.content_id([("tools/a.py", b"x"), ("skills/a.json", b"{}")])
        self.assertEqual(one, tool_records.content_id([("skills/a.json", b"{}"), ("tools/a.py", b"x")]), "sorted by path")
        self.assertNotEqual(one, tool_records.content_id([("tools/a.py", b"y"), ("skills/a.json", b"{}")]), "a byte changes it")
        self.assertNotEqual(one, tool_records.content_id([("tools/b.py", b"x"), ("skills/a.json", b"{}")]), "a path changes it")

    def test_a_directory_that_cannot_be_read_is_unreadable_naming_the_file_never_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            root = write_tools(directory)
            (root / "skills" / "kite-guide.json").write_text("{not json")
            records = tool_records.Records(root)
            self.assertEqual((records.tools, records.error.path), ({}, "skills/kite-guide.json"))




class SeedsCase(unittest.TestCase):
    """The repository's records are the product: the five seeds and the start line (item 603), all homed in Building
    Theseus, five tools with a check, one written skill, and the first skill an outcome's agent made (1097)."""

    def test_the_five_seeds_and_the_start_line(self):
        records = tool_records.Records(ROOT)
        self.assertIsNone(records.error)
        self.assertEqual({tool_id: (record["kind"], record["home"], tool_records.check_path(record)) for tool_id, record in records.tools.items()}, {
            "mutant-runner": ("tool", "building-theseus", "tests/test_tools_mutant.py"),
            "act-ledger": ("tool", "building-theseus", "tests/test_tools_acts.py"),
            "native-step-runner": ("tool", "building-theseus", "tests/test_tools_native.py"),
            "pipeline-page-builder": ("tool", "building-theseus", "tests/test_tools_pipeline.py"),
            "start-line": ("tool", "building-theseus", "tests/test_tools_start_line.py"),
            "theseus-team-assessment": ("skill", "building-theseus", None),
            "precise-audio-clips": ("skill", "oldwell-personal", "tests/test_precise_audio_clips.py")})




if __name__ == "__main__":
    unittest.main()

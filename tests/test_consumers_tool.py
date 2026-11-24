from __future__ import annotations

"""Selection checks use inert source, including source-only regression cases."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools import consumers


def selected(files, changed, before=None):
    return consumers.discover(files if before is None else before, files, changed)


def paths(result):
    return {entry["path"] for entry in result["tests"]}


class ConsumerDiscoveryTests(unittest.TestCase):
    def test_python_helper_relative_and_package_initializers(self):
        files = {
            "aim_next/__init__.py": "FLAG = True",
            "aim_next/store.py": "VALUE = 1",
            "aim_next/owner.py": "from . import store",
            "tests/helper.py": "from aim_next import owner",
            "tests/test_owner.py": "from helper import fixture",
            "tests/test_unrelated.py": "import unittest",
        }
        self.assertEqual(paths(selected(files, ["aim_next/store.py"])),
                         {"tests/test_owner.py"})
        self.assertEqual(paths(selected(files, ["aim_next/__init__.py"])),
                         {"tests/test_owner.py"})
        chain = selected(files, ["aim_next/store.py"])["tests"][0]["chain"]
        self.assertEqual([edge["to"] for edge in chain],
                         ["tests/helper.py", "aim_next/owner.py", "aim_next/store.py"])

    def test_javascript_import_forms_and_transitive_helper(self):
        files = {"web/owner.mjs": "export const x = 1;"}
        forms = ["import '../web/owner.mjs';",
                 "import { x } from '../web/owner.mjs';",
                 "export { x } from '../web/owner.mjs';",
                 "const x = require('../web/owner.mjs');",
                 "const x = await import('../web/owner.mjs');",
                 "const x = await import(`../web/owner.mjs`);"]
        for index, form in enumerate(forms):
            files["tests/form%d.test.mjs" % index] = form
        files["tests/helper.mjs"] = forms[1]
        files["tests/helper_consumer.test.mjs"] = "import './helper.mjs';"
        self.assertEqual(len(paths(selected(files, ["web/owner.mjs"]))), 7)

    def test_literal_python_dynamic_import_and_visible_computed_import(self):
        files = {
            "aim_next/owner.py": "",
            "tests/test_dynamic.py": """
from importlib import import_module as load
module = load('aim_next.owner')
other = load(computed)
""",
        }
        result = selected(files, ["aim_next/owner.py"])
        self.assertEqual(paths(result), {"tests/test_dynamic.py"})
        self.assertEqual(result["unresolved"][0]["kind"], "computed-import")

    def test_source_only_1169_evaluated_author_consumer(self):
        files = {
            "web/app.mjs": "function paintCardAuthor() {}",
            "tests/ui_removal_page_151.test.mjs": """
import { readFile as readSource } from 'node:fs/promises';
const source = await readSource(new URL('../web/app.mjs', import.meta.url), 'utf8');
const paintCardAuthor = source.slice(source.indexOf('function paintCardAuthor'));
// The tool must select this without evaluating the extracted function.
throw new Error('must never execute test source');
""",
        }
        result = selected(files, ["web/app.mjs"])
        self.assertEqual(paths(result), {"tests/ui_removal_page_151.test.mjs"})
        self.assertEqual(result["tests"][0]["chain"][0]["kind"], "source-read")

    def test_source_only_1174_unread_helper_and_native_consumer(self):
        files = {
            "web/app.mjs": "function unreadLanding() {}",
            "tests/navigation_fixture.mjs": """
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('web/app.mjs', root), 'utf8');
""",
            "tests/ui_unread_landing_986.test.mjs": "import './navigation_fixture.mjs';",
            "tests/stack_native.mjs": "import './navigation_fixture.mjs';",
        }
        self.assertEqual(paths(selected(files, ["web/app.mjs"])),
                         {"tests/ui_unread_landing_986.test.mjs", "tests/stack_native.mjs"})

    def test_comment_apostrophe_does_not_hide_source_reader(self):
        files = {
            "web/app.mjs": "",
            "tests/ui_removal_page_151.test.mjs": """
// These checks do not execute app.mjs's startup or its generic integration file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
""",
        }
        self.assertEqual(paths(selected(files, ["web/app.mjs"])),
                         {"tests/ui_removal_page_151.test.mjs"})

    def test_split_paths_basename_lists_and_non_source_input(self):
        files = {
            "web/app.mjs": "",
            "web/style.css": None,
            "docs/contract.md": None,
            "tests/test_source.py": """
from pathlib import Path
from builtins import open as read_source
parts = ['web', 'app.mjs', 'style.css']
source = (Path(root) / parts[0] / parts[1]).read_text()
contract = read_source('docs/contract.md')
""",
        }
        for changed in ("web/app.mjs", "web/style.css", "docs/contract.md"):
            with self.subTest(changed=changed):
                self.assertEqual(paths(selected(files, [changed])), {"tests/test_source.py"})

    def test_784_reads_native_test_source_as_text(self):
        files = {
            "tests/stack_native.mjs": "// Core holds it for everyone",
            "tests/ui_visible_return_784_native.test.mjs": """
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./stack_native.mjs', import.meta.url), 'utf8');
assert.match(source, /Core holds it for everyone/);
""",
        }
        result = selected(files, ["tests/stack_native.mjs"])
        self.assertIn("tests/ui_visible_return_784_native.test.mjs", paths(result))
        reader = next(item for item in result["tests"]
                      if item["path"] == "tests/ui_visible_return_784_native.test.mjs")
        self.assertEqual(reader["chain"][0]["kind"], "source-read")
        self.assertEqual(reader["runner"], "node-unit")
        native = next(item for item in result["tests"] if item["path"] == "tests/stack_native.mjs")
        self.assertEqual(native["runner"], "browser-consumer")

    def test_known_read_does_not_hide_a_computed_read(self):
        files = {"web/app.mjs": "", "tests/reader.test.mjs": """
readFile('../web/app.mjs');
readFile(computedName);
"""}
        result = selected(files, ["web/app.mjs"])
        self.assertEqual(paths(result), {"tests/reader.test.mjs"})
        self.assertEqual(result["unresolved"][0]["expressions"], ["readFile(computedName)"])

    def test_removed_import_remains_a_base_consumer(self):
        before = {"web/owner.mjs": "", "tests/old.test.mjs": "import '../web/owner.mjs';"}
        after = {"web/owner.mjs": "", "tests/old.test.mjs": "// dependency removed"}
        result = selected(after, ["web/owner.mjs"], before)
        self.assertEqual(paths(result), {"tests/old.test.mjs"})
        self.assertEqual(result["tests"][0]["chain"][0]["version"], "base")
        removed = consumers.discover(before, {"web/owner.mjs": ""}, ["web/owner.mjs"])
        self.assertEqual(paths(removed), set())
        self.assertEqual(removed["removed_tests"][0]["path"], "tests/old.test.mjs")

    def test_unknowns_are_visible_and_cycles_terminate(self):
        files = {
            "web/a.mjs": "import './b.mjs';",
            "web/b.mjs": "import './a.mjs';",
            "tests/cycle.test.mjs": "import '../web/a.mjs';",
            "tests/opaque.test.mjs": "await import(name); readFile(computed);",
            "tests/concat.test.mjs": "await import('../web/' + name);",
            "tests/missing.test.mjs": "import '../web/missing.mjs';",
            "tests/test_broken.py": "def broken(:",
        }
        result = selected(files, ["web/b.mjs"])
        self.assertEqual(paths(result), {"tests/cycle.test.mjs"})
        kinds = {item["kind"] for item in result["unresolved"]}
        self.assertTrue({"computed-import", "unresolved-read", "missing-import", "parse-error"} <= kinds)
        self.assertEqual(result, selected(dict(reversed(list(files.items()))), ["web/b.mjs"]))

    def test_changed_test_is_selected_without_importing_it(self):
        files = {"tests/test_changed.py": "raise RuntimeError('never run me')"}
        result = selected(files, files)
        self.assertEqual(result["tests"][0]["chain"], [])
        self.assertEqual(paths(result), set(files))


class GitConsumerDiscoveryTests(unittest.TestCase):
    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root)] + list(args),
                              check=True, capture_output=True, env=self.env).stdout.decode().strip()

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="consumers-tool-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_AUTHOR_NAME="Consumer fixture", GIT_AUTHOR_EMAIL="fixture@invalid",
                        GIT_COMMITTER_NAME="Consumer fixture", GIT_COMMITTER_EMAIL="fixture@invalid")
        self.git("init", "--quiet")
        (self.root / "web").mkdir()
        (self.root / "tests").mkdir()
        (self.root / "web/owner.mjs").write_text("export const x = 1;\n")
        (self.root / "tests/old.test.mjs").write_text("import '../web/owner.mjs';\n")
        self.git("add", ".")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "base fixture")
        self.base = self.git("rev-parse", "HEAD")

    def invoke(self, *args):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = consumers.main(["--repo", str(self.root)] + list(args))
        return code, output.getvalue(), errors.getvalue()

    def test_worktree_untracked_deleted_and_committed_views(self):
        (self.root / "web/owner.mjs").write_text("export const x = 2;\n")
        (self.root / "tests/untracked.test.mjs").write_text("import '../web/owner.mjs';\n")
        (self.root / "tests/old.test.mjs").unlink()
        code, output, errors = self.invoke("--base", self.base, "--json")
        self.assertEqual(code, 0, errors)
        result = json.loads(output)
        self.assertEqual(paths(result), {"tests/untracked.test.mjs"})
        self.assertEqual(result["removed_tests"][0]["path"], "tests/old.test.mjs")
        self.git("add", ".")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "candidate fixture")
        head = self.git("rev-parse", "HEAD")
        (self.root / "tests/ignored_dirty.test.mjs").write_text("import '../web/owner.mjs';")
        code, output, errors = self.invoke("--base", self.base, "--head", head, "--json")
        self.assertEqual(code, 0, errors)
        self.assertEqual(paths(json.loads(output)), {"tests/untracked.test.mjs"})

    def test_bad_revision_and_unsafe_explicit_path_are_errors(self):
        for args in (("--base", "missing"), ("../outside.py",), ("missing.py",)):
            with self.subTest(args=args):
                code, output, errors = self.invoke(*args)
                self.assertEqual(code, 2)
                self.assertEqual(output, "")
                self.assertIn("could not read source", errors)

    def test_source_symlink_is_not_followed(self):
        (self.root / "tests/link.py").symlink_to(self.root / "web/owner.mjs")
        code, output, errors = self.invoke("--json")
        self.assertEqual(code, 2)
        self.assertIn("symlink", errors)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""tools/steps_for.py (item 608): which native steps a change's files touch, on small repositories in a temporary
directory, each rule read from the code at the head commit."""

import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from tools import steps_for

RELEASE_CHECK = '''import collections
NativeStep = collections.namedtuple("NativeStep", "name harness flags results")
PERSISTENCE = "tests/fake_native.mjs"
WEBKIT = "tests/webkit_native.mjs"
WEBKIT_MODES = ("alpha",)
UNIT_STEPS = ("python-units", "node-units")
NATIVE_STEPS = tuple([NativeStep(m, PERSISTENCE, ("--" + m,), "native.json") for m in ("alpha", "beta", "gamma")]
    + [NativeStep("webkit-" + m, WEBKIT, ("--" + m,), "native.json") for m in WEBKIT_MODES])


def run_step(name, argv):
    return {"name": name, "argv": argv}
'''

NATIVE_PY = '''from tools import release_check


def main(step):
    return release_check.run_step("native-" + step.name, [step.harness])
'''

HARNESS = '''import { alphaChecks } from './alpha_native.mjs';
import { betaChecks } from './beta_native.mjs';
import { gammaChecks } from './gamma_native.mjs';
const [chromePath, evidencePath, mode = '--alpha'] = process.argv.slice(2);
const hashes = {};
for (const filename of [...(mode==='--beta'?['web/beta-view.mjs']:[]), 'web/aim.css', 'web/index.html', 'web/app.mjs']) {
  hashes[filename] = filename;
}
const check = async (name, action) => {
  if (mode === '--alpha' && !name.startsWith('alpha ')) return;
  if (mode === '--beta' && !name.startsWith('beta ')) return;
  if (mode === '--gamma' && !name.startsWith('gamma ')) return;
  await action();
};
if (mode === '--alpha') {
  await alphaChecks({ check });
} else if (mode === '--beta') {
  await betaChecks({ check });
} else {
  await gammaChecks({ check });
}
'''

WEBKIT_HARNESS = '''import { alphaChecks } from './alpha_native.mjs';
const [chromePath, evidencePath, mode] = process.argv.slice(2);
const check = async (name, action) => { await action(); };
if (mode === '--alpha') await alphaChecks({ check });
'''

ALPHA = '''export async function alphaChecks({ check }) {
  await check('alpha the chip reads its words', async () => {
    await page.evaluate(`document.querySelector('.chip').textContent`);
  });
  await check('alpha New message opens the sheet and Escape puts it back', async () => {
    await press(page, '#new-message');
    await until(() => page.evaluate(`document.querySelector('#message-sheet').open`));
  });
  // A case no mode's filter lets through: it reads .stray, so .stray chooses nothing.
  await check('stray reads a stray class', async () => {
    await page.evaluate(`document.querySelector('.stray')`);
  });
}
'''

BETA = '''import { readBadge } from './badge-helper.mjs';
export async function betaChecks({ check }) {
  await check('beta the badge shows', async () => {
    await readBadge(page);
  });
}
'''

HELPER = '''export function readBadge(p) {
  return p.evaluate(`document.getElementById('badge')?.textContent`);
}
'''

GAMMA = '''export async function gammaChecks({ check }) {
  await check('gamma every button is as wide as its words', async () => {
    await page.evaluate(`[...document.querySelectorAll('button')].map(b => b.getBoundingClientRect().width)`);
  });
}
'''

COMPOSER = """export class Composer {
  constructor(doc) {
    this.sheet = doc.querySelector('#message-sheet');
    doc.querySelector('#new-message')?.addEventListener('click', () => this.pop());
    this.sheet?.addEventListener('close', () => {
      this.fold();
    });
  }
  pop() {
    this.sheet.showModal();
  }
  fold() { this.folded = true; }
}
"""

BASE_FILES = {
    "tools/release_check.py": RELEASE_CHECK,
    "tools/native.py": NATIVE_PY,
    "tools/other.py": "print('unrelated')\n",
    "tests/fake_native.mjs": HARNESS,
    "tests/webkit_native.mjs": WEBKIT_HARNESS,
    "tests/alpha_native.mjs": ALPHA,
    "tests/beta_native.mjs": BETA,
    "tests/badge-helper.mjs": HELPER,
    "tests/gamma_native.mjs": GAMMA,
    "web/aim.css": ".chip{color:red}\n.stray{color:blue}\n.plain{margin:0}\n",
    "web/index.html": "<main>\n  <p>hello</p>\n</main>\n",
    "web/app.mjs": "const total = 1;\nexport function draw(doc) { return total; }\n",
    "web/beta-view.mjs": "export const beta = 1;\n",
    "web/composer.mjs": COMPOSER,
}


def git(root, *args):
    subprocess.run(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@localhost"] + list(args),
                   check=True, capture_output=True)


class FakeRepo:
    """A git repo whose base commit holds BASE_FILES; change() makes HEAD."""

    def __init__(self, root):
        self.root = root
        git(root, "init", "-q")
        self.write(BASE_FILES)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "base")
        self.base = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()

    def write(self, files):
        for path, text in files.items():
            full = os.path.join(self.root, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w") as handle:
                handle.write(text)

    def change(self, files):
        self.write(files)
        git(self.root, "add", "-A")
        git(self.root, "commit", "-qm", "head")
        return steps_for.choose(steps_for.Repo(self.root, self.base))


def chosen(result):
    return {step["step"]: " | ".join(step["reasons"]) for step in result["steps"]}


class StepsForTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = FakeRepo(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_the_steps_from_native_steps(self):
        steps = steps_for.read_steps(RELEASE_CHECK)
        self.assertEqual([(s.name, s.harness, s.flags) for s in steps],
                         [("alpha", "tests/fake_native.mjs", ("--alpha",)), ("beta", "tests/fake_native.mjs", ("--beta",)),
                          ("gamma", "tests/fake_native.mjs", ("--gamma",)), ("webkit-alpha", "tests/webkit_native.mjs", ("--alpha",))])

    def test_a_changed_css_selector_chooses_the_steps_whose_cases_read_it_in_both_engines(self):
        result = self.repo.change({"web/aim.css": ".chip{color:green}\n.stray{color:blue}\n.plain{margin:0}\n"})
        steps = chosen(result)
        # Any CSS change is a control change too, so the generic checker's step comes along.
        self.assertEqual(set(steps), {"native-alpha", "native-webkit-alpha", "native-gamma"})
        self.assertNotIn(".chip", steps["native-gamma"])
        self.assertIn(".chip (web/aim.css changes) is read", steps["native-alpha"])
        self.assertIn("tests/alpha_native.mjs:3", steps["native-alpha"])
        self.assertIn("alpha the chip reads its words", steps["native-alpha"])
        self.assertIn(".chip", steps["native-webkit-alpha"])
        self.assertNotIn("native-beta", steps)

    def test_a_case_no_mode_filter_admits_chooses_nothing(self):
        result = self.repo.change({"web/aim.css": ".chip{color:red}\n.stray{color:teal}\n.plain{margin:0}\n"})
        steps = chosen(result)
        # .stray is read only by a case named "stray ...", which --alpha's prefix filter drops; only the
        # filterless WebKit harness runs it, and the CSS change still reaches the generic checker.
        self.assertNotIn("native-alpha", steps)
        self.assertNotIn("native-beta", steps)
        self.assertIn("native-webkit-alpha", steps)
        self.assertIn(".stray", steps["native-webkit-alpha"])

    def test_a_selector_read_through_a_helper_module_chooses_the_cases_that_call_it(self):
        result = self.repo.change({"web/index.html": '<main>\n  <p id="badge">hello</p>\n</main>\n'})
        steps = chosen(result)
        self.assertIn("native-beta", steps)
        self.assertIn("#badge (web/index.html adds) is read", steps["native-beta"])
        self.assertIn("tests/badge-helper.mjs:2 in readBadge", steps["native-beta"])
        self.assertNotIn("native-alpha", steps)
        self.assertNotIn("native-webkit-alpha", steps)

    def test_a_changed_control_chooses_every_generic_checker(self):
        result = self.repo.change({"web/app.mjs": "const total = 1;\nexport function draw(doc) { const b = doc.createElement('button'); return total; }\n"})
        steps = chosen(result)
        self.assertEqual(set(steps), {"native-gamma"})
        self.assertIn("[generic] checker tests/gamma_native.mjs reads every control", steps["native-gamma"])
        self.assertIn("web/app.mjs", steps["native-gamma"])
        self.assertTrue(any(c["selector"] == "button" and c["steps"] == ["native-gamma"] for c in result["checkers"]))

    def test_a_change_that_touches_no_control_runs_no_generic_checker(self):
        result = self.repo.change({"web/app.mjs": "const total = 2;\nexport function draw(doc) { return total; }\n"})
        self.assertEqual(chosen(result), {})
        self.assertTrue(any("web/app.mjs" in note for note in result["notes"]))

    def test_a_changed_handler_body_chooses_the_cases_that_drive_its_element(self):
        # No selector is added or removed: the close handler's body changes. The handler is attached to the
        # sheet (this.sheet, set from #message-sheet), and New message pops the sheet.
        result = self.repo.change({"web/composer.mjs": COMPOSER.replace("      this.fold();\n", "      const popped = this.popped; this.popped = false;\n      this.fold();\n")})
        steps = chosen(result)
        self.assertEqual(set(steps), {"native-alpha", "native-webkit-alpha"})
        self.assertIn("[behaviour] #message-sheet is wired by web/composer.mjs Composer.constructor", steps["native-alpha"])
        self.assertIn('alpha New message opens the sheet', steps["native-alpha"])
        self.assertNotIn("native-beta", steps)

    def test_a_changed_method_counts_with_the_statements_that_call_it(self):
        result = self.repo.change({"web/composer.mjs": COMPOSER.replace("this.sheet.showModal();", "this.sheet.showModal(); this.popped = true;")})
        steps = chosen(result)
        self.assertEqual(set(steps), {"native-alpha", "native-webkit-alpha"})
        self.assertIn("#new-message is wired by web/composer.mjs Composer.pop", steps["native-alpha"])

    def test_a_comment_change_drives_nothing(self):
        result = self.repo.change({"web/composer.mjs": COMPOSER.replace("  pop() {", "  // Pops the sheet.\n  pop() {")})
        self.assertEqual(chosen(result), {})

    def test_a_file_on_a_modes_own_file_list_chooses_that_mode(self):
        result = self.repo.change({"web/beta-view.mjs": "export const beta = 2;\n"})
        steps = chosen(result)
        self.assertEqual(set(steps), {"native-beta"})
        self.assertIn("web/beta-view.mjs is on the file list of --beta (tests/fake_native.mjs:6)", steps["native-beta"])

    def test_a_changed_test_module_chooses_the_steps_of_its_own_cases(self):
        result = self.repo.change({"tests/beta_native.mjs": BETA.replace("the badge shows", "the badge shows its count")})
        self.assertEqual(set(chosen(result)), {"native-beta"})
        self.assertIn("tests/beta_native.mjs changes its own cases", chosen(result)["native-beta"])

    def test_a_changed_harness_chooses_all_its_steps(self):
        result = self.repo.change({"tests/webkit_native.mjs": WEBKIT_HARNESS + "// a note\n"})
        self.assertEqual(set(chosen(result)), {"native-webkit-alpha"})

    def test_tools(self):
        result = self.repo.change({"tools/other.py": "print('still unrelated')\n"})
        self.assertEqual(chosen(result), {})
        self.assertTrue(any("touches tools/" in note and "tools/other.py" in note for note in result["notes"]))

    def test_tools_native_runs_every_step(self):
        result = self.repo.change({"tools/native.py": NATIVE_PY + "\n# changed\n"})
        self.assertEqual(set(chosen(result)), {"native-alpha", "native-beta", "native-gamma", "native-webkit-alpha"})

    def test_a_new_native_step_is_chosen(self):
        source = RELEASE_CHECK.replace('("alpha", "beta", "gamma")', '("alpha", "beta", "gamma", "delta")')
        result = self.repo.change({"tools/release_check.py": source})
        steps = chosen(result)
        self.assertIn("native-delta", steps)
        self.assertIn("adds this step", steps["native-delta"])
        self.assertNotIn("native-alpha", steps)

    def test_a_change_to_the_code_native_py_runs_steps_through_chooses_all(self):
        source = RELEASE_CHECK.replace('return {"name": name, "argv": argv}', 'return {"name": name, "argv": list(argv)}')
        result = self.repo.change({"tools/release_check.py": source})
        self.assertEqual(set(chosen(result)), {"native-alpha", "native-beta", "native-gamma", "native-webkit-alpha"})


class ConditionTest(unittest.TestCase):
    def harness(self, source, steps):
        return steps_for.Harness(steps_for.JS("tests/h.mjs", source), steps)

    def test_ternaries_and_includes_split_a_file_list_by_mode(self):
        source = "const live = ['--a','--b'].includes(mode);\nfor (const f of [...(live ? ['web/x.mjs', ...(mode === '--b' ? ['web/y.mjs'] : [])] : []), 'web/z.mjs']) {}\n"
        steps = [steps_for.Step(m, "tests/h.mjs", ("--" + m,)) for m in ("a", "b", "c")]
        lists = {path: names for path, _, names in self.harness(source, steps).lists}
        self.assertEqual(lists, {"web/x.mjs": {"a", "b"}, "web/y.mjs": {"b"}, "web/z.mjs": {"a", "b", "c"}})

    def test_deferred_cases_are_selected_by_slice(self):
        source = ("const cases = [];\nconst check = (name, action) => cases.push({ name, action });\n"
                  "check('one', f); check('two', f); check('three', f);\n"
                  "const selected = mode === '--first' ? cases.slice(0, 1) : cases.slice(1);\n")
        steps = [steps_for.Step("reader", "tests/h.mjs", ()), steps_for.Step("reader-first", "tests/h.mjs", ("--first",))]
        harness = self.harness(source, steps)
        one, two, _ = harness.case_list
        self.assertTrue(harness.runs("reader-first", one))
        self.assertFalse(harness.runs("reader-first", two))
        self.assertFalse(harness.runs("reader", one))
        self.assertTrue(harness.runs("reader", two))

    def test_a_skip_table_keeps_a_named_case_out_of_its_mode(self):
        source = ("const SKIPPED = { '--rail': { 'rail held': 'why' } }[mode] ?? {};\n"
                  "const check = async (name, action) => { if (name in SKIPPED) return; await action(); };\n"
                  "check('rail held', f); check('rail kept', f);\n")
        steps = [steps_for.Step("webkit-rail", "tests/h.mjs", ("--rail",)), steps_for.Step("webkit-colors", "tests/h.mjs", ("--colors",))]
        harness = self.harness(source, steps)
        held, kept = harness.case_list
        self.assertFalse(harness.runs("webkit-rail", held))
        self.assertTrue(harness.runs("webkit-rail", kept))
        self.assertTrue(harness.runs("webkit-colors", held))


class HeadAndGit(unittest.TestCase):
    """The deploy reads its live checkout, whose HEAD is the live commit: the head is named, git is the caller's, and a
    read git cannot make refuses rather than choosing fewer steps."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = FakeRepo(self.tmp.name)
        self.repo.write({"web/aim.css": ".chip{color:green}\n.stray{color:blue}\n.plain{margin:0}\n"})
        git(self.tmp.name, "add", "-A")
        git(self.tmp.name, "commit", "-qm", "head")
        self.head = subprocess.run(["git", "-C", self.tmp.name, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        # The checkout goes back to the base, as the live checkout sits at the live commit while the deploy reads ahead.
        git(self.tmp.name, "checkout", "-q", "--detach", self.repo.base)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_named_head_is_read_while_the_checkout_sits_at_the_base(self):
        self.assertEqual(chosen(steps_for.choose(steps_for.Repo(self.tmp.name, self.repo.base))), {},
                         "HEAD is the base: nothing changed")
        result = steps_for.choose(steps_for.Repo(self.tmp.name, self.repo.base, self.head))
        self.assertEqual(set(chosen(result)), {"native-alpha", "native-webkit-alpha", "native-gamma"})
        self.assertEqual((result["base"], result["head"]), (self.repo.base, self.head))

    def test_every_read_goes_through_the_callers_git(self):
        asked = []

        def recording(root, *args):
            asked.append(args[0])
            return steps_for.run_git(root, *args)
        steps_for.choose(steps_for.Repo(self.tmp.name, self.repo.base, self.head, recording))
        self.assertEqual(sorted(set(asked)), ["diff", "ls-tree", "rev-parse", "show"])

    def test_a_read_git_cannot_make_refuses_and_an_absent_file_is_none(self):
        repo = steps_for.Repo(self.tmp.name, self.repo.base, self.head)
        self.assertIsNone(repo.show(self.head, "web/never-there.mjs"))
        self.assertEqual(repo.show(self.head, "web/beta-view.mjs"), "export const beta = 1;\n")

        def failing_show(root, *args):
            if args[0] == "show":
                return subprocess.CompletedProcess(args, 128, "", "fatal: bad object")
            return steps_for.run_git(root, *args)
        with self.assertRaises(steps_for.Refused) as refused:
            steps_for.choose(steps_for.Repo(self.tmp.name, self.repo.base, self.head, failing_show))
        self.assertIn("fatal: bad object", str(refused.exception))
        with self.assertRaises(steps_for.Refused):
            steps_for.Repo(self.tmp.name, "f" * 40, self.head)

    def test_the_command_line_names_the_head_and_refuses_what_git_cannot_read(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            self.assertEqual(steps_for.main([self.tmp.name, self.repo.base, "--head", self.head, "--json"]), 0)
        self.assertEqual({step["step"] for step in json.loads(out.getvalue())["steps"]}, {"native-alpha", "native-webkit-alpha", "native-gamma"})
        with redirect_stdout(io.StringIO()), redirect_stderr(err):
            self.assertEqual(steps_for.main([self.tmp.name, "f" * 40]), 2)
            self.assertEqual(steps_for.main([self.tmp.name, self.repo.base, "--head"]), 2)
        self.assertIn("refused: git rev-parse", err.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)

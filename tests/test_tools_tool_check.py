from __future__ import annotations

"""The tool step (tools/tool_check.py; docs/skills-and-tools.md, section 4), on real git repositories made in a
temporary directory: a live commit L and a train's candidate C0 on it. The live CLI is a typed stand-in that records
each call and answers from a real Core (a fresh store whose tools are L's checkout, as the live server's are), so a
version that went back opens its topic in Core itself. Nothing in the standard library is replaced.

Every outcome, tool and item here is invented: outcome w1 ("Isolated test", coordinator agent-a) homes a kite flyer
(a tool with a check), a spool winder (another), and a kite guide (a written skill with no check)."""

import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from aim_next import Store, tool_words
import reader_fixture
from tools import tool_check

GIT = ("git", "-c", "user.name=Kite Builder", "-c", "user.email=kites@example.invalid", "-c", "commit.gpgsign=false",
       "-c", "init.defaultBranch=main")


def record(tool_id, name, files, check, kind="tool", home="w1"):
    return json.dumps({"id": tool_id, "kind": kind, "name": name, "summary": "%s for the fixture" % name, "home": home,
                       "files": files, "check": check}, indent=2) + "\n"


def ledger(rows):
    return json.dumps({"acts": rows}, indent=1, ensure_ascii=False) + "\n"


KITE = record("kite-flyer", "Kite flyer", ["tools/kite.py", "tests/test_tools_kite.py"], {"python": "tests/test_tools_kite.py"})
SPOOL = record("spool-winder", "Spool winder", ["tools/spool.py", "tests/test_tools_spool.py"], {"python": "tests/test_tools_spool.py"})
GUIDE = record("kite-guide", "Kite guide", ["skills/kite-guide/SKILL.md"], None, kind="skill")
KITE_PY = "def fly(n):\n    return n * 2\n"
KITE_TESTS = '''import json
import unittest

from tools import kite


class KiteCase(unittest.TestCase):
    def test_doubles_one(self):
        self.assertEqual(kite.fly(1), 2)

    def test_doubles_two(self):
        self.assertEqual(kite.fly(2), 4)

    def test_doubles_zero(self):
        self.assertEqual(kite.fly(0), 0)

    def test_limits_are_known(self):
        with open("tools/limits.json") as limits:
            self.assertEqual(json.load(limits)["most"], 10)
'''
SPOOL_PY = "def wind(n):\n    return n + 1\n"
SPOOL_TESTS = '''import unittest

from tools import spool


class SpoolCase(unittest.TestCase):
    def test_winds_one(self):
        self.assertEqual(spool.wind(1), 2)

    def test_winds_zero(self):
        self.assertEqual(spool.wind(0), 1)
'''
LIVE_ROW = {"item": 500, "act": "The kite flies twice as high", "break": [["tools/kite.py", "return n * 2", "return n"]],
            "check": {"python": "test_tools_kite.py"}}
LIVE = {"skills/kite-flyer.json": KITE, "tools/kite.py": KITE_PY, "tests/test_tools_kite.py": KITE_TESTS,
        "skills/spool-winder.json": SPOOL, "tools/spool.py": SPOOL_PY, "tests/test_tools_spool.py": SPOOL_TESTS,
        "skills/kite-guide.json": GUIDE, "skills/kite-guide/SKILL.md": "# Kite guide\n\nFold along the spar.\n",
        "tools/limits.json": '{"most": 10}\n', "tests/acts.json": ledger([LIVE_ROW]),
        "web/app.mjs": "export const label = 'Fly';\n", "web/aim.css": ".kite { color: blue; }\n", ".gitignore": "ignored/\n"}

# Item 531 breaks the kite flyer (two of its five tests fail), adds a test, changes a web label and adds two act rows;
# 532 is a good change to the spool winder; 533 is a colour fix.
BROKEN_KITE = "def fly(n):\n    return n * 3\n"
KITE_ROW_531 = {"item": 531, "act": "The kite flies three times as high", "break": [["tools/kite.py", "return n * 3", "return n"]],
                "check": {"python": "test_tools_kite.py"}}
WEB_ROW_531 = {"item": 531, "act": "The label says Fly high", "break": [["web/app.mjs", "'Fly high'", "'Fly'"]],
               "check": {"node": "tests/app.test.mjs"}}
ITEM_531 = {"tools/kite.py": BROKEN_KITE,
            "tests/test_tools_kite.py": KITE_TESTS + "\n    def test_triples(self):\n        self.assertEqual(kite.fly(3), 9)\n",
            "web/app.mjs": "export const label = 'Fly high';\n", "tests/acts.json": ledger([LIVE_ROW, KITE_ROW_531, WEB_ROW_531])}
ITEM_532 = {"tools/spool.py": SPOOL_PY + "\n\ndef unwind(n):\n    return n - 1\n",
            "tests/test_tools_spool.py": SPOOL_TESTS + "\n    def test_unwinds(self):\n        self.assertEqual(spool.unwind(1), 0)\n"}
ITEM_533 = {"web/aim.css": ".kite { color: red; }\n"}
GOOD_KITE = {"tools/kite.py": KITE_PY + "\n\ndef land(n):\n    return 0\n",
             "tests/test_tools_kite.py": KITE_TESTS + "\n    def test_lands(self):\n        self.assertEqual(kite.land(5), 0)\n"}


class Repo:
    """A git repository in a temporary directory, its work tree the train's checkout."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.mkdir()
        self.git("init", "--quiet")

    def git(self, *args, check=True):
        answer = subprocess.run(GIT + ("-C", str(self.path)) + args, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        if check and answer.returncode:
            raise AssertionError("git %s: %s" % (" ".join(args), answer.stderr))
        return answer.stdout.strip()

    def commit(self, files, message, parent=None, remove=()):
        if parent is not None:
            self.git("checkout", "--quiet", "--detach", parent)
        for path, words in files.items():
            (self.path / path).parent.mkdir(parents=True, exist_ok=True)
            (self.path / path).write_text(words)
        for path in remove:
            self.git("rm", "--quiet", path)
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", message)
        return self.git("rev-parse", "HEAD")

    def show(self, commit, path):
        return self.git("show", "%s:%s" % (commit, path))

    def unreachable_commits(self):
        return [line for line in self.git("fsck", "--unreachable", "--no-reflogs").splitlines() if "commit" in line]


class CoreCli:
    """The live CLI's typed stand-in: the four calls tool_check.LiveCli makes, answered by a real Core as agent-a."""

    def __init__(self, case, live, actor="agent-a", keeps_tools=True):
        self.case, self.live, self.actor_id, self.keeps_tools = case, live, actor, keeps_tools
        self.calls = []

    def actor(self):
        self.calls.append(("actor",))
        return self.actor_id

    def live_commit(self):
        self.calls.append(("live_commit",))
        if self.live is None:
            raise tool_check.Refused("the live release could not be read with the live CLI (exit 1)")
        return self.live

    def view(self, name, args):
        self.calls.append(("view", name, args))
        if name.startswith("tool") and not self.keeps_tools:
            return {"error": {"code": "UNKNOWN_VIEW", "message": "Unsupported view"}}
        return self.case.store.view(self.actor_id, name, args)

    def record(self, path):
        run = json.loads(Path(path).read_text())
        self.calls.append(("record", run))
        home = run.pop("home_workspace_id")
        return self.case.command("tool.record", {"run": run}, {"workspace_id": home}, actor=self.actor_id)

    def records(self):
        return [call[1] for call in self.calls if call[0] == "record"]


class StepCase(reader_fixture.ReaderCase):
    def setUp(self):
        super().setUp()
        self.place = Path(tempfile.mkdtemp(prefix="tool-check-case-"))
        self.addCleanup(shutil.rmtree, str(self.place), True)
        self.repo = Repo(self.place / "train")
        self.live = self.repo.commit(LIVE, "Release 84")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding, tools=self.checkout(self.live))
        self.outs = 0

    def checkout(self, commit):
        """The code a server runs: an exported copy of one commit, as a deploy leaves it."""
        target = self.place / ("code-" + commit[:12])
        if not target.exists():
            target.mkdir()
            archive = subprocess.run(["git", "-C", str(self.repo.path), "archive", commit], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(target)], input=archive, check=True)
        return target

    def item(self, files, number, remove=()):
        return {"item": number, "approved_head": self.repo.commit(files, "Item %d" % number, parent=self.live, remove=remove)}

    def candidate(self, files, items, remove=()):
        """The train's squash commit on L, checked out on a branch as the train's worktree has it."""
        head = self.repo.commit(files, "Squash\n\nPipeline: %s" % ", ".join(str(item["item"]) for item in items), parent=self.live, remove=remove)
        self.repo.git("checkout", "--quiet", "-B", "train", head)
        return head

    def step(self, cli=None, items=(), with_items=True, out=None):
        self.outs += 1
        out = out or self.place / ("out-%d" % self.outs)
        cli = cli or CoreCli(self, self.live)
        argv = ["--out", str(out), "--python", sys.executable]
        if with_items:
            path = self.place / ("items-%d.json" % self.outs)
            path.write_text(json.dumps(list(items)))
            argv += ["--items", str(path)]
        stdout, stderr = io.StringIO(), io.StringIO()
        unreachable = set(self.repo.unreachable_commits())
        code = tool_check.main(argv, cli=cli, root=self.repo.path, stdout=stdout, stderr=stderr)
        # The commits the step made that nothing refers to.
        self.made = set(self.repo.unreachable_commits()) - unreachable
        summary = json.loads((out / "summary.json").read_text()) if (out / "summary.json").exists() else None
        return code, summary, stdout.getvalue(), stderr.getvalue(), cli, out

    def word(self, commit, tool_id):
        store = Store(self.path, "test-instance", expected_binding=self.binding, tools=self.checkout(commit))
        return store.view("owner", "tool", {"tool_id": tool_id})


class TensionCase(StepCase):
    """Example 4: one release, one tool's check fails, everything else ships."""

    def test_the_broken_tool_goes_back_alone_its_item_is_taken_back_and_everything_else_ships(self):
        items = [self.item(ITEM_531, 531), self.item(ITEM_532, 532), self.item(ITEM_533, 533)]
        c0 = self.candidate(dict(ITEM_531, **ITEM_532, **ITEM_533), items)
        code, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual(code, 0, problems + said)
        c1 = summary["head_out"]
        self.assertNotEqual(c1, c0)
        self.assertEqual(self.repo.git("rev-parse", "HEAD"), c1, "the checkout is fast-forwarded")
        self.assertEqual(self.repo.git("rev-parse", c1 + "^"), c0, "one commit on top of the candidate")
        self.assertEqual((summary["back"], summary["items_back"], summary["rounds"], summary["changed"]),
                         (["kite-flyer"], [531], 2, ["kite-flyer", "spool-winder"]))
        # Files: the tool is its live version; the candidate's other changes are all there.
        self.assertEqual(self.repo.git("diff", self.live, c1, "--", "tools/kite.py", "tests/test_tools_kite.py", "skills/kite-flyer.json"), "")
        self.assertEqual(self.repo.show(c1, "web/app.mjs"), "export const label = 'Fly high';", "531's other change still ships")
        self.assertIn("def unwind", self.repo.show(c1, "tools/spool.py"))
        self.assertEqual(self.repo.show(c1, "web/aim.css"), ".kite { color: red; }")
        self.assertEqual(self.repo.git("log", "-1", "--format=%B", c1), "Tools back to their live versions: Kite flyer\n\n"
                         "Kite flyer: its check failed, 2 of 5 failed (tests/test_tools_kite.py).\n\nTrain-Item: Revert 531")
        self.assertEqual(self.repo.git("log", "-1", "--format=%an <%ae> %ad|%cn <%ce> %cd", "--date=raw", c1),
                         self.repo.git("log", "-1", "--format=%cn <%ce> %cd|%cn <%ce> %cd", "--date=raw", c0), "dated and signed as C0's committer")
        # The ledger: 531's act on the restored file left with it; its act on the web label and the live act stay.
        self.assertEqual(json.loads(self.repo.show(c1, "tests/acts.json"))["acts"], [LIVE_ROW, WEB_ROW_531])
        self.assertEqual(self.repo.show(c1, "tests/acts.json") + "\n", ledger([LIVE_ROW, WEB_ROW_531]), "edited as text, in the ledger's own layout")
        # What was recorded: the back run, the live run on C1, and the spool winder's new runs at C0 and C1.
        recorded = [(run["tool_id"], run["fate"], run["commit_sha"], run["result"], run["passed"], run["total"]) for run in cli.records()]
        self.assertEqual(recorded, [("kite-flyer", "back", c0, "failed", 3, 5), ("kite-flyer", "live", c1, "passed", 4, 4),
                                    ("spool-winder", "new", c0, "passed", 3, 3), ("spool-winder", "new", c1, "passed", 3, 3)])
        back = cli.records()[0]
        self.assertEqual((back["failing"], back["items_back"], back["first_version"], back["live_commit"]),
                         (["test_doubles_one", "test_doubles_two"], [531], 0, self.live))
        # Core: one topic in the home, to its coordinator, linked to the tool.
        topics = self.sql("SELECT id,workspace_id,title,creator_id FROM topics WHERE title LIKE 'Kite flyer%'")
        self.assertEqual([row[1:] for row in topics], [("w1", "Kite flyer went back to its live version", "agent-a")])
        message = self.sql("SELECT addressees,body FROM messages WHERE topic_id=?", (topics[0][0],))
        self.assertEqual(json.loads(message[0][0]), ["agent-a"])
        for words in ("2 of 5 failed (test_doubles_one, test_doubles_two), in tests/test_tools_kite.py", "The next release carries its live version.",
                      "Item 531 was taken back: its other changes still ship, and it goes back to building."):
            self.assertIn(words, message[0][1])
        self.assertEqual(self.sql("SELECT tool_id,linked FROM tool_links WHERE topic_id=?", (topics[0][0],)), [("kite-flyer", 1)])
        # The pages after the deploy of C1: the live word is the live run's real count; the version that went back is listed.
        page = self.word(c1, "kite-flyer")
        self.assertEqual(page["tool"]["word"]["words"], "Its check passed: 4 of 4")
        self.assertEqual([item["words"] for item in page["went_back"]["items"]],
                         ["A new version failed its check (2 of 5 failed: test_doubles_one, test_doubles_two) and went back to its live version"])
        self.assertEqual(self.word(c1, "spool-winder")["tool"]["word"]["words"], "Its check passed: 3 of 3")
        # Again at C0: the same C1, nothing recorded twice, no second topic.
        self.repo.git("reset", "--quiet", "--hard", c0)
        again, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual((again, summary["head_out"]), (0, c1), problems + said)
        self.assertEqual([receipt["recorded"] for receipt in summary["records"]], [False, False, False, False])
        self.assertEqual(len(self.sql("SELECT id FROM topics WHERE title LIKE 'Kite flyer%'")), 1)
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(4,)])


class GoodCase(StepCase):
    def test_a_good_tool_ships_new_at_head_with_one_new_row_and_reads_passed(self):
        items = [self.item(GOOD_KITE, 530)]
        c0 = self.candidate(GOOD_KITE, items)
        code, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual((code, summary["head_out"], summary["back"], summary["rounds"]), (0, c0, [], 1), problems)
        self.assertEqual(self.repo.git("rev-parse", "HEAD"), c0)
        self.assertEqual([(run["fate"], run["result"], run["passed"], run["total"], run["commit_sha"]) for run in cli.records()],
                         [("new", "passed", 5, 5, c0)])
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE title LIKE 'Kite flyer%'"), [(0,)])
        self.assertEqual(self.word(c0, "kite-flyer")["tool"]["word"]["words"], "Its check passed: 5 of 5")
        self.assertEqual(self.made, set(), "no commit is made")

    def test_a_changed_written_skill_runs_nothing_records_nothing_and_reads_not_evaluated(self):
        c0 = self.candidate({"skills/kite-guide/SKILL.md": "# Kite guide\n\nFold along the spar, then the keel.\n"}, [])
        code, summary, said, problems, cli, _ = self.step()
        self.assertEqual((code, summary["head_out"], summary["changed"], summary["runs"]), (0, c0, ["kite-guide"], []), problems)
        self.assertEqual(cli.records(), [])
        word = self.word(c0, "kite-guide")["tool"]["word"]
        self.assertEqual((word["state"], word["words"]), ("not_evaluated", "Not evaluated yet: it has no check"))

    def test_nothing_changed_runs_nothing(self):
        c0 = self.candidate(ITEM_533, [])
        code, summary, _, problems, cli, _ = self.step()
        self.assertEqual((code, summary["changed"], summary["head_out"], cli.records()), (0, [], c0, []), problems)


class FirstVersionCase(StepCase):
    def test_a_first_version_that_runs_no_tests_does_not_ship_and_its_topic_says_so(self):
        reel = {"skills/kite-reel.json": record("kite-reel", "Kite reel", ["tools/reel.py", "tests/test_tools_reel.py"],
                                                {"python": "tests/test_tools_reel.py"}),
                "tools/reel.py": "def reel(n):\n    return n\n",
                "tests/test_tools_reel.py": "import unittest\n\n\nclass ReelCase(unittest.TestCase):\n    pass\n"}
        items = [self.item(reel, 550), self.item(ITEM_533, 533)]
        c0 = self.candidate(dict(reel, **ITEM_533), items)
        code, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual(code, 0, problems + said)
        c1 = summary["head_out"]
        self.assertEqual((summary["back"], summary["items_back"]), (["kite-reel"], [550]))
        listed = self.repo.git("ls-tree", "-r", "--name-only", c1).splitlines()
        self.assertFalse({"skills/kite-reel.json", "tools/reel.py", "tests/test_tools_reel.py"} & set(listed), "none of its files ship")
        self.assertIn("web/aim.css", listed)
        self.assertEqual(self.repo.show(c1, "web/aim.css"), ".kite { color: red; }")
        [back] = cli.records()
        self.assertEqual((back["fate"], back["result"], back["why"], back["first_version"], back["passed"], back["total"], back["commit_sha"]),
                         ("back", "counted_nothing", tool_words.RAN_NO_TESTS, 1, None, None, c0))
        title, body = self.sql("SELECT t.title,m.body FROM topics t JOIN messages m ON m.topic_id=t.id WHERE t.title LIKE 'Kite reel%'")[0]
        self.assertEqual(title, "Kite reel did not ship")
        self.assertIn("ran no tests", body)
        self.assertIn("The next release does not carry it.", body)
        self.assertEqual(self.word(c1, "kite-reel")["error"]["code"], "TOOL_NOT_FOUND", "no page for a tool with no live record")


class StopsCase(StepCase):
    def test_a_tool_whose_live_check_fails_too_stops_the_release_with_nothing_made_or_recorded(self):
        files = {"tools/kite.py": KITE_PY + "# tidied\n", "tools/limits.json": '{"least": 1}\n'}
        items = [self.item(files, 545)]
        c0 = self.candidate(files, items)
        refs = self.repo.git("for-each-ref")
        code, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual(code, 1, said)
        self.assertEqual(problems.strip(), "tool_check: Kite flyer's check fails with it at its live version too: something else in this release "
                                           "breaks it (tests/test_tools_kite.py: test_limits_are_known). The release stops.")
        self.assertEqual((self.repo.git("rev-parse", "HEAD"), self.repo.git("status", "--porcelain"), self.repo.git("for-each-ref")), (c0, "", refs))
        self.assertEqual(self.made, set(), "no commit is made")
        self.assertEqual((cli.records(), self.sql("SELECT count(*) FROM tool_runs")), ([], [(0,)]))
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE title LIKE 'Kite flyer%'"), [(0,)])
        self.assertIsNone(summary["head_out"])


class CascadeCase(StepCase):
    def test_a_still_new_tool_that_needs_one_that_went_back_goes_back_too(self):
        files = {"tools/kite.py": BROKEN_KITE + "\n\ndef soar(n):\n    return n * 10\n",
                 "tools/spool.py": SPOOL_PY + "\n\ndef lift(n):\n    from tools import kite\n    return kite.soar(n)\n",
                 "tests/test_tools_spool.py": SPOOL_TESTS + "\n    def test_lifts(self):\n        self.assertEqual(spool.lift(1), 10)\n"}
        items = [self.item(files, 560)]
        c0 = self.candidate(files, items)
        code, summary, said, problems, cli, _ = self.step(items=items)
        self.assertEqual(code, 0, problems + said)
        self.assertEqual((summary["back"], summary["rounds"], summary["items_back"]), (["kite-flyer", "spool-winder"], 3, [560]))
        c2 = summary["head_out"]
        self.assertEqual(self.repo.git("diff", self.live, c2), "", "both tools are their live versions, and 560 changed nothing else")
        runs = [(run["tool_id"], run["fate"], run["result"]) for run in cli.records()]
        self.assertEqual(runs, [("kite-flyer", "back", "failed"), ("spool-winder", "back", "failed"),
                                ("kite-flyer", "live", "passed"), ("spool-winder", "live", "passed")])
        spool = cli.records()[1]
        self.assertNotEqual(spool["commit_sha"], c0, "the spool winder failed on the commit with the kite flyer restored")
        self.assertEqual(self.repo.git("rev-parse", spool["commit_sha"] + "^"), c0)
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE title LIKE '% went back to its live version'"), [(2,)])
        self.assertIn("Kite flyer, Spool winder", self.repo.git("log", "-1", "--format=%s", c2))


class RefusalsCase(StepCase):
    """Each refusal comes before any check runs or anything is written."""

    def refused(self, words, cli=None, items=(), with_items=True, out=None):
        before = (self.repo.git("rev-parse", "HEAD"), self.repo.git("for-each-ref"))
        code, summary, said, problems, cli, out = self.step(cli=cli, items=items, with_items=with_items, out=out)
        self.assertEqual(code, 2, said + problems)
        self.assertEqual(problems.splitlines()[0], "tool_check: refused: " + words)
        self.assertEqual((self.repo.git("rev-parse", "HEAD"), self.repo.git("for-each-ref")), before)
        self.assertEqual(cli.records(), [])
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])
        return said, out

    def assert_nothing_ran(self, said, out):
        self.assertNotIn("round", said, "no check ran")
        self.assertFalse(out.exists() and any(out.iterdir()), "nothing was written")

    def test_the_parsers_refusals(self):
        cases = [
            ({"skills/deploy.json": record("deploy", "Deploy", ["tools/deploy.py"], None), "tools/deploy.py": "print(1)\n"},
             "skills/deploy.json names tools/deploy.py, which is the deploy's own code; deploy and the release checks stay ordinary code."),
            ({"skills/act-keeper.json": record("act-keeper", "Act keeper", ["tools/kite.py"], None)},
             "tools/kite.py belongs to two tools: act-keeper and kite-flyer."),
            ({"skills/kite-flyer.json": record("kite-flyer", "Kite flyer", ["tools/kite.py"], {"python": "tests/test_tools_kite.py"})},
             "the check tests/test_tools_kite.py is not one of kite-flyer's files."),
            ({"skills/kite-flyer.json": KITE.replace('"home"', '"colour": "red",\n  "home"')}, "skills/kite-flyer.json: unknown key 'colour'"),
        ]
        for number, (files, words) in enumerate(cases):
            with self.subTest(words=words):
                self.candidate(dict(files, **GOOD_KITE), [])
                self.assert_nothing_ran(*self.refused(words))

    def test_the_checkout_the_out_directory_and_the_live_commit(self):
        self.candidate(GOOD_KITE, [])
        (self.repo.path / "stray.txt").write_text("left here\n")
        self.assert_nothing_ran(*self.refused("the checkout %s has tracked or untracked changes" % self.repo.path))
        (self.repo.path / "stray.txt").unlink()
        full = self.place / "full"
        full.mkdir()
        (full / "x").write_text("x")
        self.refused("--out %s is not a new, empty directory" % full, out=full)
        inside = self.repo.path / "logs"
        self.refused("--out %s is inside the checkout and not ignored" % inside, out=inside)
        self.refused("the live release could not be read with the live CLI (exit 1)", cli=CoreCli(self, None))
        aside = self.repo.commit({"web/aim.css": "aside\n"}, "Aside", parent=self.live)
        self.repo.git("checkout", "--quiet", "train")
        self.refused("the live release's commit %s is not an ancestor of HEAD %s" % (aside, self.repo.git("rev-parse", "HEAD")),
                     cli=CoreCli(self, aside))
        stderr = io.StringIO()
        self.assertEqual(tool_check.main(["--out", "relative/out"], cli=CoreCli(self, self.live), root=self.repo.path, stderr=stderr, stdout=io.StringIO()), 2)
        self.assertEqual(stderr.getvalue().splitlines()[0], "tool_check: refused: --out relative/out is not absolute")

    def test_an_ignored_place_inside_the_checkout_is_a_good_out(self):
        self.candidate(GOOD_KITE, [])
        code, summary, said, problems, *_ = self.step(out=self.repo.path / "ignored" / "out")
        self.assertEqual((code, summary["back"]), (0, []), problems)

    def test_a_home_the_actor_cannot_record_in_is_refused_before_anything_runs(self):
        self.candidate(GOOD_KITE, [])
        self.assert_nothing_ran(*self.refused("outsider cannot record in w1, a changed tool's home: No permission for this workspace",
                                              cli=CoreCli(self, self.live, actor="outsider")))

    def test_a_tool_that_goes_back_without_items_is_refused_with_no_commit_and_nothing_recorded(self):
        items = [self.item(ITEM_531, 531)]
        self.candidate(ITEM_531, items)
        said, _ = self.refused(tool_check.NO_ITEMS, with_items=False)
        self.assertIn("kite-flyer: round 1", said, "it ran the check and found the failure")
        self.assertEqual(self.made, set(), "no commit is made")


class LiveWithoutToolsCase(StepCase):
    """The release that brings the step: the live code has no tool.record."""

    def test_good_tools_go_on_and_say_nothing_was_recorded(self):
        c0 = self.candidate(GOOD_KITE, [])
        cli = CoreCli(self, self.live, keeps_tools=False)
        code, summary, _, problems, cli, _ = self.step(cli=cli)
        self.assertEqual((code, summary["head_out"], summary["recorded"], summary["why"], cli.records()),
                         (0, c0, False, "the live code has no tool.record", []), problems)

    def test_a_tool_that_would_go_back_is_refused_since_its_topic_cannot_open(self):
        items = [self.item(ITEM_531, 531)]
        c0 = self.candidate(ITEM_531, items)
        code, _, _, problems, cli, _ = self.step(cli=CoreCli(self, self.live, keeps_tools=False), items=items)
        self.assertEqual((code, self.repo.git("rev-parse", "HEAD"), cli.records()), (2, c0, []))
        self.assertIn("the live code has no tool.record, so its topic cannot open", problems)


class CountingCase(unittest.TestCase):
    """A run is read by the release check's own counters: a pass needs at least one test and no failure."""

    def test_python(self):
        cases = [
            ("test_a ... ok\n\n----\nRan 3 tests in 0.1s\n\nOK\n", 0, ("passed", 3, 3, [], None)),
            ("Ran 0 tests in 0.0s\n\nOK\n", 0, ("counted_nothing", None, None, [], tool_words.RAN_NO_TESTS)),
            ("Ran 0 tests in 0.0s\n\nNO TESTS RAN\n", 5, ("counted_nothing", None, None, [], "it exited 5 and printed no test count")),
            ("Ran 2 tests in 0.0s\n\nOK (skipped=2)\n", 0, ("counted_nothing", None, None, [], tool_words.RAN_NO_TESTS)),
            ("Ran 3 tests in 0.0s\n\nOK (skipped=1)\n", 0, ("passed", 2, 2, [], None)),
            ("ERROR: test_b (test_x.Case)\nFAIL: test_c (test_x.Case) [sub]\nFAIL: test_c (test_x.Case) [sub2]\nRan 4 tests in 0.1s\n\nFAILED (failures=2, errors=1)\n", 1,
             ("failed", 2, 4, ["test_b", "test_c"], None)),
            ("ERROR: test_kite (unittest.loader._FailedTest.test_kite)\nRan 1 test in 0.0s\n\nFAILED (errors=1)\n", 1,
             ("counted_nothing", None, None, [], "its module could not be loaded")),
            ("Traceback: boom\n", 1, ("counted_nothing", None, None, [], "it exited 1 and printed no test count")),
            ("Ran 3 tests in 0.1s\n\nOK\n", 1, ("counted_nothing", None, None, [], "it exited 1 and named no failing test")),
        ]
        for log, code, expected in cases:
            with self.subTest(log=log):
                self.assertEqual(tool_check.python_result(log, code), expected)

    def test_node(self):
        tap = ("not ok 2 - two fails\n    not ok 1 - inner fails\nnot ok 3 - group\n# tests 5\n# suites 0\n# pass 2\n# fail 3\n"
               "# cancelled 0\n# skipped 0\n# todo 0\n")
        self.assertEqual(tool_check.node_result(tap, 1), ("failed", 2, 5, ["two fails", "inner fails", "group"], None))
        self.assertEqual(tool_check.node_result("# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n", 0), ("passed", 2, 2, [], None))
        self.assertEqual(tool_check.node_result("# tests 1\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 1\n", 0),
                         ("counted_nothing", None, None, [], tool_words.RAN_NO_TESTS))
        self.assertEqual(tool_check.node_result("boom", 1)[0], "counted_nothing")

    def test_a_long_name_is_cut_at_a_characters_edge(self):
        log = "FAIL: test_%s (test_x.Case)\nRan 2 tests in 0.0s\n\nFAILED (failures=1)\n" % ("é" * 150)
        name = tool_check.python_result(log, 1)[3][0]
        self.assertLessEqual(len(name.encode("utf-8")), 200)
        self.assertTrue(name.startswith("test_é"))


if __name__ == "__main__":
    unittest.main()

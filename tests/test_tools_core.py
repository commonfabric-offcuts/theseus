from __future__ import annotations

"""Skills and tools in Core (item 17; docs/skills-and-tools.md): an outcome says it uses a tool, a topic is about a
tool, what a tool's own check found in a release, and the words every page reads from them.

Every outcome, person and tool here is invented: outcome w1 ("Isolated test": owner "owner", coordinator agent-a,
member agent-b, topic t1) homes the tools of a records directory made for each case; w2 ("Kite club") is another
outcome; "outsider" is an agent on neither."""

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from aim_next import Store
from aim_next.tools_core import valid_run
from aim_next import tool_records, tool_words
import reader_fixture

L, C0, C1 = "1" * 40, "2" * 40, "3" * 40
T0, T1 = "a" * 40, "b" * 40
X84, X531, X_NOTE = "8" * 64, "5" * 64, "9" * 64


def write_tools(root, home="w1", extra=()):
    """A records directory: a tool with a check, a written skill with none, and a third tool homed elsewhere."""
    root = Path(root)
    for path, text in (("tools/kite.py", "print('kite')\n"), ("tests/test_tools_kite.py", "import unittest\n"),
                       ("skills/kite-guide/SKILL.md", "# Kite guide\n"), ("tools/spool.py", "print('spool')\n"),
                       ("tests/test_tools_spool.py", "import unittest\n")):
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)
    records = [{"id": "kite-flyer", "kind": "tool", "name": "Kite flyer", "summary": "Flies a kite on a schedule", "home": home,
                "files": ["tools/kite.py", "tests/test_tools_kite.py"], "check": {"python": "tests/test_tools_kite.py"}},
               {"id": "kite-guide", "kind": "skill", "name": "Kite guide", "summary": "How to fold a kite", "home": home,
                "files": ["skills/kite-guide/SKILL.md"], "check": None},
               {"id": "spool-winder", "kind": "tool", "name": "Spool winder", "summary": "Winds the string back", "home": "w2",
                "files": ["tools/spool.py", "tests/test_tools_spool.py"], "check": {"python": "tests/test_tools_spool.py"}}] + list(extra)
    for record in records:
        (root / "skills" / (record["id"] + ".json")).write_text(json.dumps(record))
    return root


def run(**fields):
    base = {"tool_id": "kite-flyer", "name": "Kite flyer", "content_id": X531, "commit_sha": C0, "tree_sha": T0, "live_commit": L,
            "check_path": "tests/test_tools_kite.py", "result": "passed", "passed": 42, "total": 42, "failing": [], "failing_more": 0,
            "why": None, "fate": "new", "first_version": 0, "items_back": []}
    base.update(fields)
    return base


BACK = dict(result="failed", passed=39, total=42, failing=["test_reads_the_commit", "test_restores", "test_control_again"],
            fate="back", items_back=[531])


class ToolsCase(reader_fixture.ReaderCase):
    def setUp(self):
        super().setUp()
        self.tools_dir = tempfile.TemporaryDirectory(prefix="aim-next-tools-")
        self.addCleanup(self.tools_dir.cleanup)
        self.root = write_tools(self.tools_dir.name)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding, tools=self.root)
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Kite club", "purpose": "", "team": ["agent-b"],
                                                         "coordinator": "agent-b"}))

    def live_content(self, tool_id="kite-flyer"):
        return self.store.tool_records.content[tool_id]

    def view(self, name, args, actor="owner"):
        answer = self.store.view(actor, name, args)
        self.assertNotIn("error", answer, answer)
        return answer

    def use(self, tool, used=True, workspace="w2", actor="agent-b"):
        return self.command("tool.use", {"tool_id": tool, "used": used}, {"workspace_id": workspace}, actor=actor)

    def link(self, tool, linked=True, topic="t1", actor="owner"):
        return self.command("tool.link", {"tool_id": tool, "linked": linked}, {"topic_id": topic}, actor=actor)

    def record(self, fields, actor="agent-a", workspace="w1", op=None):
        return self.command("tool.record", {"run": fields}, {"workspace_id": workspace}, actor=actor, op=op)

    def used_by(self, tool="kite-flyer", actor="owner"):
        return [row["title"] for row in self.view("tool", {"tool_id": tool}, actor)["used_by"]]


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


class WordsCase(unittest.TestCase):
    """Every word in section 5, from the record and the rows; never "0 of 0", never a pass without a count."""

    RECORD = {"id": "kite-flyer", "check": {"python": "tests/test_tools_kite.py"}}

    def test_the_live_word_for_each_state(self):
        rows = [
            (None, "not_run", "Its check has not run on this version yet"),
            ({"result": "passed", "passed": 42, "total": 42, "recorded_ms": 5}, "passed", "Its check passed: 42 of 42"),
            ({"result": "failed", "passed": 39, "total": 42, "recorded_ms": 5}, "failed", "Its check failed on this version: 3 of 42 failed"),
            ({"result": "counted_nothing", "passed": None, "total": None, "recorded_ms": 5}, "counted_nothing", "Its check ran no tests on this version"),
            # A row that claims a pass with no count is never a pass.
            ({"result": "passed", "passed": 0, "total": 0, "recorded_ms": 5}, "counted_nothing", "Its check ran no tests on this version"),
        ]
        for row, state, words in rows:
            with self.subTest(state=state):
                word = tool_words.live_word(self.RECORD, row)
                self.assertEqual((word["state"], word["words"]), (state, words))
                self.assertNotIn("0 of 0", word["words"])
        word = tool_words.live_word({"id": "kite-guide", "check": None}, {"result": "passed", "passed": 1, "total": 1, "recorded_ms": 1})
        self.assertEqual((word["state"], word["words"]), ("not_evaluated", "Not evaluated yet: it has no check"))

    def test_a_version_that_went_back_and_its_topic(self):
        row = run(**BACK)
        self.assertEqual(tool_words.went_back_words(row), "A new version failed its check (3 of 42 failed: test_reads_the_commit, "
                                                          "test_restores, test_control_again) and went back to its live version")
        self.assertEqual(tool_words.topic_title(row), "Kite flyer went back to its live version")
        message = tool_words.topic_message(row)
        for words in ("3 of 42 failed (test_reads_the_commit, test_restores, test_control_again), in tests/test_tools_kite.py",
                      "The next release carries its live version.", "Item 531 was taken back: its other changes still ship, and it goes back to building.",
                      "Fix it and build it again; the next release checks it the same way."):
            self.assertIn(words, message)
        first = run(result="counted_nothing", passed=None, total=None, why=tool_words.RAN_NO_TESTS, fate="back", first_version=1, items_back=[550])
        self.assertEqual(tool_words.went_back_words(first), "A first version ran no tests and did not ship")
        self.assertEqual(tool_words.topic_title(first), "Kite flyer did not ship")
        self.assertIn("The next release does not carry it.", tool_words.topic_message(first))
        crashed = run(result="counted_nothing", passed=None, total=None, why="it exited 1 and printed no test count", fate="back")
        self.assertEqual(tool_words.went_back_words(crashed), "A new version could not run (it exited 1 and printed no test count) and went back to its live version")
        many = run(**dict(BACK, failing=["a", "b", "c", "d", "e"], failing_more=7, passed=30, total=42))
        self.assertIn("12 of 42 failed: a, b, c, d, e and 7 more", tool_words.went_back_words(many))


class UsesCase(ToolsCase):
    """R14: an outcome uses a tool only when it said so, and only until it says otherwise."""

    def test_only_an_outcome_that_said_so_is_listed_and_only_until_it_unsays_it(self):
        self.assertEqual(self.used_by(), [], "nothing has said it")
        # Running and linking say nothing about use: agent-a records a run and the home links a topic.
        self.committed(self.record(run()))
        self.committed(self.link("kite-flyer"))
        self.assertEqual(self.used_by(), [], "a run, a link and being the home make no user")
        said = self.committed(self.use("kite-flyer"))
        self.assertEqual((said["changed"], said["used"]), (True, True))
        self.assertEqual(self.used_by(actor="agent-b"), ["Kite club"])
        self.assertFalse(self.committed(self.use("kite-flyer"))["changed"], "the same answer writes nothing")
        self.assertEqual(self.sql("SELECT count(*) FROM tool_uses"), [(1,)])
        self.committed(self.use("kite-flyer", used=False))
        self.assertEqual(self.used_by(actor="agent-b"), [])
        self.assertEqual(self.sql("SELECT used FROM tool_uses ORDER BY seq"), [(1,), (0,)], "the past is kept")

    def test_a_reader_who_cannot_open_a_user_sees_it_counted_never_named(self):
        self.committed(self.use("kite-flyer"))
        answer = self.view("tool", {"tool_id": "kite-flyer"}, actor="outsider")
        self.assertEqual((answer["used_by"], answer["used_by_hidden"]), ([], 1))
        self.assertNotIn("Kite club", json.dumps(answer))

    def test_the_outcome_page_lists_its_own_tools_then_those_it_uses(self):
        self.committed(self.use("kite-flyer"))
        here = self.view("tools", {"workspace_id": "w2"}, actor="agent-b")
        self.assertEqual([item["tool_id"] for item in here["own"]], ["spool-winder"])
        self.assertEqual([item["tool_id"] for item in here["used"]], ["kite-flyer"])
        self.assertEqual([tool["tool_id"] for tool in here["offer"]], ["kite-guide"], "only tools homed elsewhere and not used here")
        home = self.view("tools", {"workspace_id": "w1"})
        self.assertEqual(([item["tool_id"] for item in home["own"]], home["used"]), (["kite-flyer", "kite-guide"], []))

    def test_refusals(self):
        self.rejected(self.use("no-such-tool"), "TOOL_NOT_FOUND")
        refused = self.use("kite-flyer", actor="outsider")
        self.rejected(refused, "FORBIDDEN")
        self.assertEqual(refused["error"]["message"], "Only someone on Kite club can say it uses a tool.")
        self.assertEqual(self.sql("SELECT count(*) FROM tool_uses"), [(0,)], "no row")
        version = self.view("workspace", {"workspace_id": "w2"}, actor="agent-b")["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w2"}, {"workspace_revision": version}))
        version = self.view("workspace", {"workspace_id": "w2"}, actor="agent-b")["workspace"]["version"]
        self.committed(self.command("outcome.reach", {"words": "The kites flew", "unmet_confirmed": True}, {"workspace_id": "w2"},
                                    {"workspace_revision": version}))
        self.rejected(self.use("kite-flyer"), "OUTCOME_REACHED")
        self.assertEqual(self.sql("SELECT count(*) FROM tool_uses"), [(0,)])


class LinksCase(ToolsCase):
    """R15: a topic is linked only in the tool's home, and unlinked anywhere."""

    def test_a_topic_in_the_home_links_and_unlinks_and_the_same_answer_writes_nothing(self):
        linked = self.committed(self.link("kite-flyer"))
        self.assertTrue(linked["changed"])
        self.assertFalse(self.committed(self.link("kite-flyer"))["changed"])
        topics = self.view("tool", {"tool_id": "kite-flyer"})["topics"]
        self.assertEqual([(topic["topic_id"], topic["reader_may_unlink"]) for topic in topics], [("t1", True)])
        self.assertEqual([tool["tool_id"] for tool in self.view("topic_tools", {"topic_id": "t1"})["linked"]], ["kite-flyer"])
        self.committed(self.link("kite-flyer", linked=False))
        self.assertEqual(self.view("tool", {"tool_id": "kite-flyer"})["topics"], [])
        self.assertEqual(self.sql("SELECT linked FROM tool_links ORDER BY seq"), [(1,), (0,)])

    def test_refusals_and_what_topic_settings_offers(self):
        self.rejected(self.link("no-such-tool"), "TOOL_NOT_FOUND")
        refused = self.link("spool-winder", actor="agent-a")
        self.rejected(refused, "TOPIC_NOT_IN_HOME")
        self.assertEqual(refused["error"]["message"], "A topic can be linked to a tool only in the tool's home.",
                         "the home is not named to a reader who is not on it")
        self.assertEqual(self.link("spool-winder")["error"]["message"], "A topic can be linked to a tool only in the tool's home, Kite club.",
                         "and is named to one who is")
        self.rejected(self.link("kite-flyer", actor="outsider"), "FORBIDDEN")
        conversation = self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")
        self.assertEqual(len(conversation), 1, "w1 has its Conversation")
        self.rejected(self.link("kite-flyer", topic=conversation[0][0]), "NOT_A_TOPIC")
        self.assertEqual(self.sql("SELECT count(*) FROM tool_links"), [(0,)])
        offered = self.view("topic_tools", {"topic_id": "t1"})
        self.assertEqual(([tool["tool_id"] for tool in offered["offered"]], offered["linked"]), (["kite-flyer", "kite-guide"], []))

    def test_a_link_left_where_the_home_moved_is_still_shown_and_can_be_taken_off(self):
        self.committed(self.link("kite-flyer"))
        moved = tempfile.TemporaryDirectory()
        self.addCleanup(moved.cleanup)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding, tools=write_tools(moved.name, home="w2"))
        self.assertEqual([topic["topic_id"] for topic in self.view("tool", {"tool_id": "kite-flyer"})["topics"]], ["t1"])
        self.rejected(self.link("kite-guide"), "TOPIC_NOT_IN_HOME")
        self.assertTrue(self.committed(self.link("kite-flyer", linked=False))["changed"])

    def test_a_link_to_a_tool_with_no_live_record_is_named_from_its_runs_and_can_be_taken_off(self):
        self.committed(self.record(run(**dict(BACK, tool_id="kite-reel", name="Kite reel", first_version=1, items_back=[550]))))
        topic = self.sql("SELECT topic_id FROM tool_runs")[0][0]
        linked = self.view("topic_tools", {"topic_id": topic}, actor="agent-a")["linked"]
        self.assertEqual(linked, [{"tool_id": "kite-reel", "kind": None, "name": "Kite reel", "home_workspace_id": "w1", "live": False}])
        self.rejected(self.store.view("owner", "tool", {"tool_id": "kite-reel"}) and
                      {"error": self.store.view("owner", "tool", {"tool_id": "kite-reel"})["error"]}, "TOOL_NOT_FOUND")
        self.assertTrue(self.committed(self.link("kite-reel", linked=False, topic=topic, actor="agent-a"))["changed"])


class RunsCase(ToolsCase):
    """What a tool's check found, recorded once; a version that went back opens one topic in its home."""

    def test_a_good_tool_reads_passed_with_its_count_and_opens_no_topic(self):
        recorded = self.committed(self.record(run(content_id=self.live_content())))
        self.assertTrue(recorded["recorded"])
        word = self.view("tool", {"tool_id": "kite-flyer"})["tool"]["word"]
        self.assertEqual((word["state"], word["words"], word["at_ms"]), ("passed", "Its check passed: 42 of 42", recorded["run"]["recorded_ms"]))
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id<>'t1' AND kind='topic'"), [(0,)])

    def test_with_no_row_for_the_live_content_it_reads_not_run_and_a_skill_with_no_check_not_evaluated(self):
        self.committed(self.record(run()))  # a row for another content id
        words = {item["tool_id"]: item["word"]["words"] for item in self.view("tools", {"workspace_id": "w1"})["own"]}
        self.assertEqual(words, {"kite-flyer": "Its check has not run on this version yet", "kite-guide": "Not evaluated yet: it has no check"})

    def test_a_version_that_went_back_opens_one_topic_addressed_linked_and_recorded_again_opens_none(self):
        receipt = self.committed(self.record(run(**BACK), op="back-1"))
        self.assertTrue(receipt["recorded"])
        topic = receipt["run"]["topic"]
        self.assertEqual(topic["title"], "Kite flyer went back to its live version")
        rows = self.sql("SELECT t.workspace_id,t.creator_id,m.author_id,m.addressees,m.body FROM topics t JOIN messages m ON m.topic_id=t.id WHERE t.id=?",
                        (topic["topic_id"],))
        self.assertEqual(len(rows), 1, "one topic, its first message")
        workspace, creator, author, addressees, body = rows[0]
        self.assertEqual((workspace, creator, author, json.loads(addressees)), ("w1", "agent-a", "agent-a", ["agent-a"]),
                         "in the home, by the recorder, to the coordinator (here the recorder)")
        self.assertEqual(body, tool_words.topic_message(run(**BACK)))
        self.assertEqual(self.sql("SELECT tool_id,linked,said_by FROM tool_links WHERE topic_id=?", (topic["topic_id"],)), [("kite-flyer", 1, "agent-a")])
        again = self.committed(self.record(run(**BACK), op="back-2"))
        self.assertFalse(again["recorded"])
        self.assertEqual(again["run"]["topic"]["topic_id"], topic["topic_id"])
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE title=?", (topic["title"],)), [(1,)], "no second topic")
        went_back = self.view("tool", {"tool_id": "kite-flyer"})["went_back"]["items"]
        self.assertEqual([item["words"] for item in went_back], [tool_words.went_back_words(run(**BACK))])

    def test_the_topic_goes_to_the_owner_when_the_home_has_no_coordinator(self):
        version = self.view("workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.coordinator_set", {"actor_id": None}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        topic = self.committed(self.record(run(**BACK), actor="agent-b"))["run"]["topic"]["topic_id"]
        self.assertEqual([json.loads(row[0]) for row in self.sql("SELECT addressees FROM messages WHERE topic_id=?", (topic,))], [["owner"]])

    def test_a_reader_who_cannot_read_the_topic_sees_the_line_without_its_title(self):
        self.committed(self.record(run(**BACK)))
        item = self.view("tool", {"tool_id": "kite-flyer"}, actor="outsider")["went_back"]["items"][0]
        self.assertEqual((item["topic"], item["topic_hidden"]), (None, True))
        self.assertNotIn("went back to its live version", json.dumps(item["topic"]))

    def test_went_back_pages_five_at_a_time_newest_first(self):
        for n in range(7):
            self.committed(self.record(run(**dict(BACK, tree_sha="%040x" % (n + 1)))))
        first = self.view("tool", {"tool_id": "kite-flyer"})["went_back"]
        self.assertEqual(len(first["items"]), 5)
        rest = self.view("tool", {"tool_id": "kite-flyer", "cursor": first["next_cursor"]})["went_back"]
        self.assertEqual((len(rest["items"]), rest["next_cursor"]), (2, None))
        trees = [item["tree_sha"] for item in first["items"] + rest["items"]]
        self.assertEqual(trees, ["%040x" % n for n in range(7, 0, -1)])

    def test_refusals_and_the_same_run_again(self):
        self.rejected(self.record(run(), actor="owner"), "FORBIDDEN")  # a person, though on the home
        self.rejected(self.record(run(), actor="outsider"), "FORBIDDEN")  # an agent not on the home
        self.committed(self.record(run()))
        self.rejected(self.record(run(passed=41, total=41)), "TOOL_RUN_EXISTS")
        self.assertFalse(self.committed(self.record(run()))["recorded"])
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(1,)])

    def test_every_field_is_checked_naming_it(self):
        bad = [
            (dict(passed=0, total=0), "run.total"), (dict(passed=41, total=42), "run.passed"),
            (dict(result="failed", passed=42, total=42, fate="back"), "run.passed"),
            (dict(result="counted_nothing", passed=None, total=None, fate="back"), "run.why"),
            (dict(fate="new", result="failed", passed=1, total=2), "run.fate"), (dict(content_id="x"), "run.content_id"),
            (dict(commit_sha="abc"), "run.commit_sha"), (dict(check_path="tools/kite.py"), "run.check_path"),
            (dict(failing=["x" * 201]), "run.failing"), (dict(items_back=[531]), "run.items_back"), (dict(colour="red"), "run.colour"),
            (dict(fate="live", first_version=1), "run.first_version"),
        ]
        for fields, named in bad:
            with self.subTest(named=named):
                refused = self.record(run(**fields))
                self.rejected(refused, "INVALID_ARGUMENT")
                self.assertTrue(refused["error"]["message"].startswith(named), refused)
        # A name cut to 200 bytes at a character's edge is a name.
        self.assertEqual(valid_run(run(**dict(BACK, failing=["é" * 100])))["failing"], ["é" * 100])
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])

    def test_a_reached_home_refuses_a_run_so_the_release_stops_rather_than_record_nothing(self):
        version = self.view("workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        version = self.view("workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.reach", {"words": "Done", "unmet_confirmed": True}, {"workspace_id": "w1"},
                                    {"workspace_revision": version}))
        self.rejected(self.record(run(**BACK)), "OUTCOME_REACHED")
        self.assertEqual(self.sql("SELECT count(*) FROM tool_runs"), [(0,)])

    def test_the_tables_keep_their_past(self):
        self.committed(self.record(run()))
        self.committed(self.use("kite-flyer"))
        self.committed(self.link("kite-flyer"))
        with sqlite3.connect(str(self.path)) as db:
            for statement in ("UPDATE tool_runs SET passed=1", "DELETE FROM tool_runs", "UPDATE tool_uses SET used=0", "DELETE FROM tool_uses",
                              "UPDATE tool_links SET linked=0", "DELETE FROM tool_links"):
                with self.subTest(statement=statement), self.assertRaises(sqlite3.DatabaseError):
                    db.execute(statement)


class UnreadableCase(ToolsCase):
    def test_records_that_cannot_be_read_refuse_every_view_and_verb_never_an_empty_list(self):
        (self.root / "skills" / "kite-guide.json").write_text('{"id": "kite-guide"}')
        self.store = Store(self.path, "test-instance", expected_binding=self.binding, tools=self.root)
        for name, args in (("tools", {"workspace_id": "w1"}), ("tool", {"tool_id": "kite-flyer"}), ("topic_tools", {"topic_id": "t1"})):
            with self.subTest(view=name):
                answer = self.store.view("owner", name, args)
                self.assertEqual(answer["error"]["code"], "TOOL_RECORDS_UNREADABLE")
                self.assertIn("skills/kite-guide.json", answer["error"]["message"])
        self.rejected(self.use("kite-flyer"), "TOOL_RECORDS_UNREADABLE")
        self.rejected(self.link("kite-flyer"), "TOOL_RECORDS_UNREADABLE")


class SeedsCase(unittest.TestCase):
    """The five seed records are the product: all homed in Building Theseus, four with a check, one written skill."""

    def test_the_five_seeds(self):
        records = tool_records.Records(Path(__file__).resolve().parents[1])
        self.assertIsNone(records.error)
        self.assertEqual({tool_id: (record["kind"], record["home"], tool_records.check_path(record)) for tool_id, record in records.tools.items()}, {
            "mutant-runner": ("tool", "building-theseus", "tests/test_tools_mutant.py"),
            "act-ledger": ("tool", "building-theseus", "tests/test_tools_acts.py"),
            "native-step-runner": ("tool", "building-theseus", "tests/test_tools_native.py"),
            "pipeline-page-builder": ("tool", "building-theseus", "tests/test_tools_pipeline.py"),
            "theseus-team-assessment": ("skill", "building-theseus", None)})


if __name__ == "__main__":
    unittest.main()

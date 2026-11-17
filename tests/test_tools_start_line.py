from __future__ import annotations

"""The start line (docs/tools.md, "Start line"): tools/start_line.py run as a coordinator runs it, through the real
`bin/aim-next` of this checkout against a temporary instance, with a stand-in brief-writer.

Every outcome, item and word here is invented: outcome w1 ("Isolated test") is owner's, agent-a its coordinator and
agent-b a member; its items are about a kite club's pages."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest

from aim_next.profile import write_profile
from test_agent_verbs import AgentVerbCase
from tools import start_line

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "start_line.py"
CLI = ROOT / "bin" / "aim-next"

# The stand-in brief-writer: each run leaves a folder of its own under RUNS, and it checks what it was given (the
# live checkout as its working directory, each expected word in its prompt; a word written "@N:words" is expected of
# its Nth run only, counting from 0), failing loudly (exit 4) when it was not; then it prints its line, or fails with
# the code it was told to.
WRITER = '''import os, sys
runs, surface, line, code = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
prompt = sys.stdin.read()
run = len(os.listdir(runs))
os.mkdir(os.path.join(runs, "run-%04d" % run))
if os.path.realpath(os.getcwd()) != os.path.realpath(surface):
    sys.stderr.write("ran in " + os.getcwd())
    sys.exit(4)
expected = [word.split(":", 1)[1] if word.startswith("@") else word for word in sys.argv[5:]
            if not word.startswith("@") or word.split(":", 1)[0] == "@%d" % run]
missing = [word for word in expected if word not in prompt]
if missing:
    sys.stderr.write("the prompt lacks " + repr(missing))
    sys.exit(4)
sys.stdout.write(line)
sys.exit(code)
'''
LINE = "The string page shows each kite's string length beside its name; the reel page stays as it is."
# The time is passed in, never read from the clock: a line opened at T0 stands open for the default 15 minutes, to
# 16:35:30, which the post states rounded up to the minute: 4:36 Pacific.
T0 = "2026-11-16T16:20:30-08:00"
ENDS = "2026-11-16T16:36-08:00"
BEFORE = "2026-11-16T16:35:59-08:00"
LATE = "2026-11-17T09:00:00-08:00"


def sentence(clock):
    return "a \U0001f44d, or nothing by %s, builds it as written; anything you write, I rewrite the line and post it again" % clock


def posted(line, number, title, clock, ends, kept=False, ask=False):
    """A start line's post as the owner reads it: the line, the sentence under it, what it is and when it ends. A line
    posted again for a 👎 asks "say what to change" between the line and the sentence."""
    return '%s\n\n%s%s\n\nStart line for %d, "%s": what its build will make.%s Its window ends %s.' % (
        line, "say what to change\n\n" if ask else "", sentence(clock), number, title,
        " Kept with the item's work; the owner is not told." if kept else "", ends)


# A writer that, while it writes, runs a second open of the same item, whose line is recorded first: two opens racing
# on one revision.
RACING_WRITER = '''import subprocess, sys
argv = sys.argv[1:]
sys.stdin.read()
inner = subprocess.run(argv, capture_output=True, text=True)
if inner.returncode != 0:
    sys.stderr.write("the racing open failed: " + inner.stderr)
    sys.exit(5)
sys.stdout.write("The slower line, never posted.")
'''


class StartLineCase(AgentVerbCase):
    def setUp(self):
        super().setUp()
        place = Path(self.temp.name).resolve()
        path = place / "owner.json"
        write_profile(path, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        self.profiles["owner"] = path
        self.surface = place / "live"
        (self.surface / "web").mkdir(parents=True)
        (self.surface / "web" / "strings.mjs").write_text("export const strings = [];\n")
        git = ["git", "-C", str(self.surface), "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"]
        for step in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "a kite club"]):
            subprocess.run(git + step, check=True, capture_output=True)
        self.writer = place / "writer.py"
        self.writer.write_text(WRITER)
        self.writer_runs = place / "writer-runs"
        self.writer_runs.mkdir()
        self.ok("pipeline-on", "w1")

    def ok(self, *argv, actor="agent-a", stdin=b""):
        code, out, err = self.run_cli(*argv, actor=actor, stdin=stdin)
        self.assertEqual((code, err), (0, ""), out)
        return out

    def add(self, title, words, actor="agent-a"):
        out = self.ok("add", "w1", "--title", title, "--section", "now", "--note", "from the kite club's list", "-",
                      actor=actor, stdin=words.encode("utf-8"))
        return int(out.split()[1])

    def tool(self, *argv, actor="agent-a"):
        answer = subprocess.run([sys.executable, "-I", "-B", str(TOOL)] + list(argv[:2]) + [
            "--cli", str(CLI), "--profile", str(self.profiles[actor]), "--python", sys.executable] + list(argv[2:]),
            capture_output=True, text=True)
        return answer.returncode, json.loads(answer.stdout) if answer.stdout.strip() else None, answer.stderr

    def open_line(self, number, *flags, line=LINE, code=0, topic="t1", expect=(), now=T0):
        return self.tool("open", "w1", str(number), "--topic", topic, "--surface", str(self.surface), "--now", now, *flags,
                         "--", sys.executable, "-I", str(self.writer), str(self.writer_runs), str(self.surface), line, str(code), *expect)

    def opened(self, number, *flags, line=LINE, expect=(), now=T0):
        code, result, err = self.open_line(number, *flags, line=line, expect=expect, now=now)
        self.assertEqual((code, err), (0, ""), result)
        return result

    def open_slowly(self, number, start, seconds, *flags, line=LINE, expect=()):
        """open as the coordinator runs it, with --now left out, in this process on a clock of the test's own: it reads
        start until the writer runs and moves on by seconds with each writer run, a writer that takes that long."""
        runs = self.runs()

        def clock():
            return datetime.fromisoformat(start) + timedelta(seconds=seconds * (self.runs() - runs))
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = start_line.main(["open", "w1", str(number), "--cli", str(CLI), "--profile", str(self.profiles["agent-a"]),
                                    "--python", sys.executable, "--topic", "t1", "--surface", str(self.surface)] + list(flags) + [
                                    "--", sys.executable, "-I", str(self.writer), str(self.writer_runs), str(self.surface), line, "0"]
                                   + list(expect), clock=clock)
        self.assertEqual((code, err.getvalue()), (0, ""), out.getvalue())
        return json.loads(out.getvalue())

    def cut(self, number, now=LATE):
        return self.tool("cut", "w1", str(number), "--now", now)

    def cut_ok(self, number, now=LATE):
        code, result, err = self.cut(number, now)
        self.assertEqual((code, err), (0, ""), result)
        return result

    def waiting(self, number, now, until):
        """The cut at now builds nothing and posts nothing: the newest line stands open until until."""
        before = self.count()
        code, result, err = self.cut(number, now)
        self.assertEqual((code, result, self.count()), (1, None, before), err)
        self.assertIn("refused: waiting until %s: start line " % until, err)

    def unworked(self, number, reply, now=LATE):
        """The cut at now builds nothing and posts nothing: the owner wrote reply, which no line works in yet."""
        before = self.count()
        code, result, err = self.cut(number, now)
        self.assertEqual((code, result, self.count()), (1, None, before), err)
        self.assertIn("refused: owner wrote %s under the start line of %d, a correction no line works in yet" % (reply, number), err)

    def runs(self):
        """How many times the writer ran."""
        return len(os.listdir(str(self.writer_runs)))

    def message(self, message_id):
        return self.sql("SELECT topic_id,author_id,body,addressees,intent,reply_to FROM messages WHERE id=?", (message_id,))[0]

    def told(self, message_id):
        """Who the message was delivered to by name; a topic's participants also get it as the topic's (subscription)."""
        return [row[0] for row in self.sql("SELECT DISTINCT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id "
                                           "WHERE d.message_id=? AND r.reason<>'subscription' ORDER BY d.recipient_id", (message_id,))]

    def count(self):
        return self.sql("SELECT count(*) FROM messages")[0][0]

    def reply(self, message_id, words, actor="owner"):
        self.ok("post", "t1", "--reply-to", message_id, "-", actor=actor, stdin=words.encode("utf-8"))
        return self.sql("SELECT id FROM messages ORDER BY seq DESC LIMIT 1")[0][0]

    def post(self, words, actor="agent-b"):
        self.ok("post", "t1", "-", actor=actor, stdin=words.encode("utf-8"))
        return self.sql("SELECT id FROM messages ORDER BY seq DESC LIMIT 1")[0][0]

    def hold(self, message_id, actor="owner"):
        """Its author opens the message in Edit, which holds it from agents until they leave the edit."""
        self.committed(self.command("message.edit_open", {"holder": "kite-laptop"}, target={"message_id": message_id}, actor=actor))
        return lambda: self.committed(self.command("message.edit_close", {"holder": "kite-laptop"}, target={"message_id": message_id}, actor=actor))

    def edit(self, number, **words):
        version = self.sql("SELECT version FROM pipeline_items WHERE number=?", (number,))[0][0]
        self.committed(self.command("pipeline.item_edit", words, target={"workspace_id": "w1", "number": number},
                                    expected={"item_revision": version}, actor="agent-a"))


class OpenCase(StartLineCase):
    def test_an_owners_item_gets_its_start_line_told_to_the_owner_in_the_pieces_topic_about_the_item(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        # The writer runs in the live checkout, asked with the item's words and where they came from: it fails otherwise.
        result = self.opened(number, expect=("String lengths on the string page", "Show how long each kite's string is.",
                                             "from the kite club's list"))
        self.assertEqual((result["owners_item"], result["to_owner"], result["posted"], result["brief"]), (True, True, True, LINE))
        topic, author, body, addressees, intent, _ = self.message(result["message_id"])
        self.assertEqual((topic, author, json.loads(addressees), intent), ("t1", "agent-a", ["owner"], "tell"))
        # The line, then the sentence under it with its window's end in Pacific time: T0 and 15 minutes, to the minute.
        self.assertEqual(body, posted(LINE, number, "String lengths on the string page", "4:36", ENDS))
        self.assertEqual(result["window_ends"], ENDS)
        self.assertEqual(self.told(result["message_id"]), ["owner"])
        self.assertEqual(self.sql("SELECT kind,ref FROM message_subjects WHERE message_id=?", (result["message_id"],)), [("item", str(number))])
        self.assertEqual(self.sql("SELECT kind FROM operations WHERE actor_id='agent-a' AND id=?", (result["operation_id"],)), [("message.post",)])
        self.assertEqual(result["operation_id"], "start-line-w1-%d-%s" % (number, result["revision"]))
        self.assertEqual(self.runs(), 1)
        # A writer that was not given what it needs (here, words the item does not have) refuses, and nothing more is posted.
        before = self.count()
        self.edit(number, description="Show how long each kite's string is, in metres.")
        code, refused, err = self.open_line(number, expect=("words this item does not have",))
        self.assertEqual((code, refused, self.count()), (1, None, before))
        self.assertIn("refused: the brief-writer exited 4: the prompt lacks", err)
        self.assertEqual(result["surface_commit"], subprocess.run(["git", "-C", str(self.surface), "rev-parse", "HEAD"],
                                                                  capture_output=True, text=True).stdout.strip())

    def test_an_item_from_the_owners_message_is_theirs_though_an_agent_raised_it(self):
        self.ok("post", "t1", "-", actor="owner", stdin=b"Could the reel page say which reel is out?")
        asked = self.sql("SELECT id FROM messages ORDER BY seq DESC LIMIT 1")[0][0]
        number = self.add("The reel page names the reel that is out", "Say which reel is out.")
        self.ok("add-source", "w1", str(number), "--from", asked)
        result = self.opened(number, expect=("Could the reel page say which reel is out?",))
        self.assertEqual((result["owners_item"], result["to_owner"]), (True, True))
        self.assertEqual(self.told(result["message_id"]), ["owner"])

    def test_an_item_from_someone_elses_message_is_not_the_owners_and_is_told_to_nobody(self):
        asked = self.post("The shelf check could count each kite once.")
        number = self.add("The shelf check counts each kite once", "Count each kite once.")
        self.ok("add-source", "w1", str(number), "--from", asked)
        result = self.opened(number, expect=("agent-b wrote", "The shelf check could count each kite once."))
        self.assertEqual((result["owners_item"], result["to_owner"]), (False, False))
        self.assertEqual(json.loads(self.message(result["message_id"])[3]), [])
        self.assertEqual(self.told(result["message_id"]), [], "a member's message does not make the item the owner's")

    def test_an_item_is_read_to_its_last_source_past_the_ones_a_page_shows(self):
        # A page of the pipeline shows an item's first 32 sources; the start line reads them all, so the owner's
        # message as the 33rd (after the note it was added with and 31 more) makes the item theirs and is in the
        # writer's prompt.
        number = self.add("Knot names on the string page", "Name each knot.")
        for n in range(31):
            self.ok("add-source", "w1", str(number), "--note", "kite club note %d" % n)
        asked = self.post("Could the string page name the knots too?", actor="owner")
        self.ok("add-source", "w1", str(number), "--from", asked)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_item_sources WHERE number=?", (number,)), [(33,)])
        result = self.opened(number, expect=("kite club note 30", "Could the string page name the knots too?"))
        self.assertEqual((result["owners_item"], result["to_owner"]), (True, True))
        self.assertEqual(self.told(result["message_id"]), ["owner"])

    def test_a_new_source_is_a_new_revision_with_a_start_line_of_its_own(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        first = self.opened(number)
        self.reply(first["message_id"], "Lengths in metres.")
        self.ok("add-source", "w1", str(number), "--from", self.post("The reel page could list strings too."))
        code, result, err = self.cut(number)
        self.assertEqual((code, result), (1, None), "the line and answer of the item without this source are not this one's")
        self.assertIn("refused: no start line for %d at its current words" % number, err)
        before = self.count()
        again = self.opened(number, line="The string and reel pages list each kite's string length.",
                            expect=("The reel page could list strings too.",))
        self.assertNotEqual((again["revision"], again["message_id"]), (first["revision"], first["message_id"]))
        self.assertEqual((again["posted"], again["rewrites"], self.count(), self.runs()), (True, [], before + 1, 2))
        self.assertEqual(self.cut_ok(number)["answer"], "window-ended")

    def test_two_opens_racing_on_one_revision_record_one_line_and_the_second_answers_with_it(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        before = self.count()
        racer = self.writer.parent / "racer.py"
        racer.write_text(RACING_WRITER)
        # Both opens share the fixture clock: the cut below uses fixed LATE, never the wall clock.
        inner = [sys.executable, "-I", "-B", str(TOOL), "open", "w1", str(number), "--cli", str(CLI), "--profile", str(self.profiles["agent-a"]),
                 "--python", sys.executable, "--topic", "t1", "--surface", str(self.surface), "--now", T0, "--", sys.executable, "-I", "-c",
                 "import sys; sys.stdin.read(); sys.stdout.write('The racing line.')"]
        code, result, err = self.tool("open", "w1", str(number), "--topic", "t1", "--surface", str(self.surface), "--now", T0,
                                      "--", sys.executable, "-I", str(racer), *inner)
        self.assertEqual((code, err), (0, ""), result)
        self.assertEqual((result["brief"], result["posted"], self.count()), ("The racing line.", False, before + 1))
        self.assertEqual(result["operation_id"], "start-line-w1-%d-%s" % (number, result["revision"]))
        self.assertEqual(self.told(result["message_id"]), ["owner"], "the owner is asked once")
        self.assertEqual(self.cut_ok(number)["brief"], "The racing line.")

    def test_a_source_message_its_author_has_open_in_edit_is_not_written_from_and_nothing_is_posted(self):
        asked = self.post("Could the reel page say which reel is out?", actor="owner")
        number = self.add("The reel page names the reel that is out", "Say which reel is out.")
        self.ok("add-source", "w1", str(number), "--from", asked)
        release = self.hold(asked)
        before = self.count()
        code, result, err = self.open_line(number)
        self.assertEqual((code, result, self.count(), self.runs()), (2, None, before, 0), err)
        self.assertIn("could not read: owner has %s open in Edit" % asked, err)
        release()
        result = self.opened(number, expect=("Could the reel page say which reel is out?",))
        self.assertEqual((result["posted"], self.count(), self.runs()), (True, before + 1, 1))

    def test_a_retry_of_the_same_revision_posts_nothing_and_never_runs_the_writer_again(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        other = self.add("Kite colours on the shelf page", "Show each kite's colour.", actor="owner")
        first = self.opened(number)
        before = self.count()
        again = self.opened(number, line="A different line the writer would write the second time.")
        self.assertEqual((again["message_id"], again["operation_id"], again["posted"], again["brief"]),
                         (first["message_id"], first["operation_id"], False, LINE))
        self.assertEqual((self.count(), self.runs()), (before, 1), "a retry posts nothing and runs no writer")
        # A move is not a new revision of its words: still the line already asked.
        self.ok("move", "w1", str(number), "--below", str(other), actor="owner")
        moved = self.opened(number, line="Yet another line.")
        self.assertEqual((moved["message_id"], moved["posted"], self.count(), self.runs()), (first["message_id"], False, before, 1))
        # New words are a new revision, so a new start line, asked once.
        self.edit(number, description="Show how long each kite's string is, in metres.")
        changed = self.opened(number, line="The string page shows each string's length in metres.")
        self.assertNotEqual((changed["message_id"], changed["operation_id"]), (first["message_id"], first["operation_id"]))
        self.assertEqual((changed["posted"], changed["brief"], self.count(), self.runs()),
                         (True, "The string page shows each string's length in metres.", before + 1, 2))

    def test_an_item_nobody_asks_the_owner_about_is_kept_with_its_work_and_told_to_nobody(self):
        number = self.add("The shelf check counts kites", "A check fix.")
        result = self.opened(number)
        self.assertEqual((result["owners_item"], result["to_owner"], result["posted"]), (False, False, True))
        topic, author, body, addressees, intent, _ = self.message(result["message_id"])
        self.assertEqual((topic, json.loads(addressees), intent), ("t1", [], None))
        self.assertEqual(body, posted(LINE, number, "The shelf check counts kites", "4:36", ENDS, kept=True))
        self.assertEqual(self.told(result["message_id"]), [], "the owner is not told")
        self.assertEqual(self.sql("SELECT kind,ref FROM message_subjects WHERE message_id=?", (result["message_id"],)), [("item", str(number))])
        # Should the owner write under it all the same, the line is worked again and posted to them.
        said = self.reply(result["message_id"], "Tell me about this one.")
        again = self.opened(number, expect=("Tell me about this one.",), now="2026-11-16T16:30:00-08:00")
        self.assertEqual((again["rewrites"][0]["reply"], self.told(again["message_id"]), self.message(again["message_id"])[5]),
                         (said, ["owner"], said))

    def test_the_switch_widens_it_to_every_user_facing_feature_and_only_those(self):
        cases = [((), False), (("--every-feature",), False), (("--user-facing",), False),
                 (("--every-feature", "--user-facing"), True), (("--owner-decides",), True)]
        for flags, told in cases:
            with self.subTest(flags=flags):
                number = self.add("Kite page %s" % "".join(flags), "Agent-found words.")
                result = self.opened(number, *flags)
                self.assertEqual((result["owners_item"], result["to_owner"]), (False, told))
                self.assertEqual(self.told(result["message_id"]), ["owner"] if told else [])

    def test_the_writer_must_write_one_line_or_nothing_is_posted(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        before = self.count()
        for line, code, said in (("A line.", 3, "the brief-writer exited 3"), ("  \n", 0, "the brief-writer wrote nothing"),
                                 ("One line.\nAnd a second.", 0, "the brief-writer wrote 2 lines; a start line is one"),
                                 ("x" * 301, 0, "the brief-writer wrote 301 characters; a start line is at most 300")):
            with self.subTest(said=said):
                answer, result, err = self.open_line(number, line=line, code=code)
                self.assertEqual((answer, result), (1, None))
                self.assertIn("refused: " + said, err)
                self.assertEqual(self.count(), before, "nothing is posted")
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id LIKE 'start-line-%'"), [(0,)])
        # A line of exactly the bound is one.
        self.assertEqual(self.opened(number, line="y" * 300)["brief"], "y" * 300)

    def test_a_start_line_theseus_did_not_record_asks_nobody_and_the_next_open_posts_it_once(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        before = self.count()
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        code, result, err = self.open_line(number)
        self.assertEqual((code, result), (2, None))
        self.assertIn("the start line was not recorded (DATABASE_BUSY", err)
        blocker.rollback()
        self.assertEqual(self.count(), before, "nobody was asked")
        again = self.opened(number, line="A second writing of the same start line.")
        self.assertEqual((again["posted"], again["brief"], self.count()), (True, "A second writing of the same start line.", before + 1))
        self.assertEqual(self.opened(number, line="A third.")["message_id"], again["message_id"])

    def test_a_start_line_theseus_refused_leaves_its_revision_free(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        before = self.count()
        code, result, err = self.open_line(number, topic="t-nowhere")
        self.assertEqual((code, result), (1, None))
        self.assertIn("refused: the start line was refused: ", err)
        self.assertEqual(self.count(), before)
        # The refusal asked nobody, so the piece's topic takes the line for that same revision, under its next
        # operation, once; and the cut reads it.
        line = self.opened(number)
        self.assertEqual((line["posted"], line["topic_id"], self.count()), (True, "t1", before + 1))
        self.assertEqual(line["operation_id"], "start-line-w1-%d-%s.2" % (number, line["revision"]))
        again = self.opened(number, line="Another line.")
        self.assertEqual((again["message_id"], again["posted"], self.count()), (line["message_id"], False, before + 1))
        cut = self.cut_ok(number)
        self.assertEqual((cut["message_id"], cut["operation_id"], cut["answer"]), (line["message_id"], line["operation_id"], "window-ended"))


class CutCase(StartLineCase):
    # A start line is a notice with a default, not a question (warp, codex #6643): the owner's 👍 on the newest line,
    # or that line's window ending with nothing written under it, builds it as written; anything they write is a
    # correction the writer works into the line, posted again with its window restarted.

    def test_the_window_ending_with_no_answer_builds_the_line_as_written(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        # Before the window ends, with no answer, the cut builds nothing and posts nothing.
        self.waiting(number, T0, "4:36")
        self.waiting(number, BEFORE, "4:36")
        # Someone else's 👍 or words are not the owner's: still waiting, and nothing is worked again.
        self.ok("thumb", opened["message_id"], actor="agent-b")
        self.reply(opened["message_id"], "Only the reel page instead.", actor="agent-b")
        self.waiting(number, BEFORE, "4:36")
        before = self.count()
        self.assertEqual((self.opened(number, now=BEFORE)["rewrites"], self.count(), self.runs()), ([], before, 1),
                         "a reply by someone else is worked into nothing")
        # The window ends: the line builds as written.
        cut = self.cut_ok(number, "2026-11-16T16:36:00-08:00")
        self.assertEqual((cut["answer"], cut["brief"], cut["message_id"], cut["revision"], cut["lines"], cut["window_ends"]),
                         ("window-ended", LINE, opened["message_id"], opened["revision"], 1, ENDS))

    def test_the_owners_thumbs_up_on_the_newest_line_builds_it_before_its_window_ends(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        self.ok("thumb", opened["message_id"], actor="owner")
        cut = self.cut_ok(number, T0)
        self.assertEqual((cut["answer"], cut["brief"], cut["message_id"]), ("thumbs-up", LINE, opened["message_id"]))
        self.ok("thumb", opened["message_id"], "--off", actor="owner")
        self.waiting(number, T0, "4:36")

    def test_a_worded_yes_posts_the_line_again_with_a_new_window_and_builds_only_at_its_end_or_on_a_thumbs_up(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        said = self.reply(opened["message_id"], "Yes, go ahead.")
        # Words are never read as a yes: before the rewrite, the cut builds nothing, in the window or after it.
        self.unworked(number, said, BEFORE)
        self.unworked(number, said, LATE)
        # The writer gets the line and his words; here it keeps the line as it was. It is posted again under his reply,
        # to him, with the window restarted from now: 16:25:10 and 15 minutes, 4:41.
        before = self.count()
        again = self.opened(number, now="2026-11-16T16:25:10-08:00", expect=("Yes, go ahead.", "The start line now reads:\n" + LINE))
        self.assertEqual((again["posted"], [rewrite["reply"] for rewrite in again["rewrites"]], again["brief"], self.count(), self.runs()),
                         (False, [said], LINE, before + 1, 2))
        topic, author, body, addressees, intent, reply_to = self.message(again["message_id"])
        self.assertEqual((topic, author, json.loads(addressees), intent, reply_to), ("t1", "agent-a", ["owner"], "tell", said))
        self.assertEqual(body, posted(LINE, number, "String lengths on the string page", "4:41", "2026-11-16T16:41-08:00"))
        self.assertEqual(self.sql("SELECT kind,ref FROM message_subjects WHERE message_id=?", (again["message_id"],)), [("item", str(number))])
        # His 👍 on the older line builds nothing now; the new line waits to its own end.
        self.ok("thumb", opened["message_id"], actor="owner")
        self.waiting(number, "2026-11-16T16:30:00-08:00", "4:41")
        self.waiting(number, "2026-11-16T16:40:59-08:00", "4:41")
        cut = self.cut_ok(number, "2026-11-16T16:41:00-08:00")
        self.assertEqual((cut["answer"], cut["brief"], cut["message_id"], cut["lines"], cut["revision"]),
                         ("window-ended", LINE, again["message_id"], 2, opened["revision"]))
        # Or his 👍 on the new line, earlier than its end.
        self.ok("thumb", again["message_id"], actor="owner")
        self.assertEqual(self.cut_ok(number, "2026-11-16T16:30:00-08:00")["answer"], "thumbs-up")

    def test_the_first_lines_deadline_passing_never_starts_the_build_once_a_reply_restarted_the_window(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        self.reply(opened["message_id"], "Sure thing")
        again = self.opened(number, now="2026-11-16T16:30:30-08:00")
        self.assertEqual(again["window_ends"], "2026-11-16T16:46-08:00")
        # 4:36, the first line's end, and every minute up to the new line's end: the build does not start.
        for now in ("2026-11-16T16:36:00-08:00", "2026-11-16T16:40:00-08:00", "2026-11-16T16:45:59-08:00"):
            self.waiting(number, now, "4:46")
        # At 4:46 it starts, once: from the newest line.
        cut = self.cut_ok(number, "2026-11-16T16:46:00-08:00")
        self.assertEqual((cut["answer"], cut["message_id"], cut["lines"]), ("window-ended", again["message_id"], 2))

    def test_off_for_now_is_worked_into_the_line_and_posted_again(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        said = self.reply(opened["message_id"], "Off for now")
        worked = "The string page can show each kite's string length beside its name, switched off for now."
        again = self.opened(number, line=worked, now="2026-11-16T16:24:00-08:00", expect=("Off for now", LINE))
        self.assertEqual((again["brief"], self.message(again["message_id"])[5]), (worked, said))
        self.assertEqual(self.message(again["message_id"])[2], posted(worked, number, "String lengths on the string page", "4:39",
                                                                      "2026-11-16T16:39-08:00"))
        self.waiting(number, "2026-11-16T16:38:00-08:00", "4:39")
        self.assertEqual(self.cut_ok(number)["brief"], worked)

    def test_whatever_the_owner_writes_is_worked_in_and_posted_again_never_built_or_lost(self):
        # The reviewer's replies of rounds one and two (B6, B7): worded assents, small-word corrections, a typed 👍, a
        # no, and a reply of more than one line. Each is a correction: no build until a line works it in.
        for n, words in enumerate(("Yes, go ahead.", "Yes, that's what I want", "Great work, ship it", "Makes sense", "Awesome",
                                   "Fine by me", "No problem, go ahead", "Sure thing", "Just for me", "Off for now", "On for all",
                                   "\U0001f44d", "No, not yet.", "Hmm, two things.\nFirst the reel page, then the shelf.")):
            with self.subTest(words=words):
                number = self.add("Kite page %d" % n, "Show kite page %d." % n, actor="owner")
                opened = self.opened(number)
                said = self.reply(opened["message_id"], words)
                self.unworked(number, said, LATE)
                before = self.count()
                worked = "Kite page %d, as worked by the writer." % n
                again = self.opened(number, line=worked, now="2026-11-16T16:22:00-08:00", expect=(words.strip(),))
                self.assertEqual(([rewrite["reply"] for rewrite in again["rewrites"]], self.count(), self.message(again["message_id"])[5]),
                                 ([said], before + 1, said))
                cut = self.cut_ok(number)
                self.assertEqual((cut["answer"], cut["brief"], cut["message_id"]), ("window-ended", worked, again["message_id"]))

    def test_a_retry_posts_each_line_once_and_never_runs_the_writer_again(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        said = self.reply(opened["message_id"], "Lengths in metres.")
        again = self.opened(number, line="The string page shows each kite's string length in metres.", now="2026-11-16T16:25:00-08:00")
        before, runs = self.count(), self.runs()
        retry = self.opened(number, line="A line the writer would write the second time.", now="2026-11-16T16:28:00-08:00")
        self.assertEqual((retry["message_id"], retry["operation_id"], retry["brief"], retry["rewrites"], self.count(), self.runs()),
                         (again["message_id"], again["operation_id"], again["brief"], [], before, runs))
        self.assertEqual(again["operation_id"], "start-line-w1-%d-%s-re-%s" % (number, again["revision"], said))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE reply_to=?", (said,)), [(1,)])

    def test_each_reply_gets_a_line_of_its_own_under_any_line_of_the_revision(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        first = self.reply(opened["message_id"], "Lengths in metres.")
        second = self.reply(opened["message_id"], "And on the reel page.")
        # One writer run for each reply, oldest first (runs 1 and 2, after the first line's run 0), each given the newest
        # line as it then stood and that reply.
        again = self.opened(number, line="A newer line.", now="2026-11-16T16:25:00-08:00", expect=(
            "@1:The start line now reads:\n%s\n\nowner wrote under it:\nLengths in metres.\n" % LINE,
            "@2:The start line now reads:\nA newer line.\n\nowner wrote under it:\nAnd on the reel page.\n"))
        self.assertEqual(self.runs(), 3)
        self.assertEqual([rewrite["reply"] for rewrite in again["rewrites"]], [first, second])
        lines = [rewrite["message_id"] for rewrite in again["rewrites"]]
        self.assertEqual([self.message(line)[5] for line in lines], [first, second])
        self.assertEqual(again["message_id"], lines[1])
        # A reply under an older line once a newer one stands is still his correction: worked into the newest line.
        late = self.reply(opened["message_id"], "Only lengths over ten metres.")
        self.unworked(number, late)
        newest = self.opened(number, line="The newest line.", now="2026-11-16T16:30:00-08:00",
                             expect=("Only lengths over ten metres.", "The start line now reads:\nA newer line."))
        self.assertEqual((newest["rewrites"][0]["reply"], self.message(newest["message_id"])[5]), (late, late))
        self.assertEqual((self.cut_ok(number)["brief"], self.cut_ok(number)["lines"]), ("The newest line.", 4))

    def test_a_reply_written_under_a_thumbed_up_line_is_still_a_correction(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        self.ok("thumb", opened["message_id"], actor="owner")
        self.assertEqual(self.cut_ok(number, T0)["answer"], "thumbs-up")
        said = self.reply(opened["message_id"], "Just for me")
        self.unworked(number, said, T0)
        again = self.opened(number, line="The string page shows string lengths, for the owner only.", now=BEFORE)
        self.waiting(number, BEFORE, "4:51")

    def test_a_reply_the_owner_has_open_in_edit_is_worked_in_once_they_leave_the_edit(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        corrected = self.reply(opened["message_id"], "Lengths in metres, on the reel page too.")
        release = self.hold(corrected)
        before, runs = self.count(), self.runs()
        code, result, err = self.open_line(number, now=BEFORE)
        self.assertEqual((code, result, self.count(), self.runs()), (2, None, before, runs), err)
        self.assertIn("could not read: owner has %s open in Edit; it is read once they save or leave the edit" % corrected, err)
        self.unworked(number, corrected)
        release()
        again = self.opened(number, now=BEFORE, expect=("Lengths in metres, on the reel page too.",))
        self.assertEqual((self.count(), self.message(again["message_id"])[5]), (before + 1, corrected))

    def test_the_cut_reads_the_owners_reply_past_the_first_page_of_the_topic(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        for n in range(105):
            self.post("Build note %d about the reel page." % n)
        corrected = self.reply(opened["message_id"], "Lengths in metres, on the reel page too.")
        start = self.sql("SELECT seq FROM messages WHERE id=?", (opened["message_id"],))[0][0]
        self.assertGreater(self.sql("SELECT count(*) FROM messages WHERE topic_id='t1' AND seq>?", (start,))[0][0], 100)
        self.unworked(number, corrected)
        again = self.opened(number, line="Lengths in metres on both pages.", now=BEFORE)
        self.assertEqual(self.message(again["message_id"])[5], corrected)
        self.assertEqual(self.cut_ok(number)["brief"], "Lengths in metres on both pages.")

    def test_the_cut_refuses_when_the_items_current_words_have_no_start_line(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        code, result, err = self.cut(number)
        self.assertEqual((code, result), (1, None))
        self.assertIn("refused: no start line for %d at its current words" % number, err)
        opened = self.opened(number)
        self.reply(opened["message_id"], "Lengths in metres.")
        self.edit(number, title="String lengths and knots on the string page")
        code, result, err = self.cut(number)
        self.assertEqual((code, result), (1, None), "a correction to older words is not read as one to these")
        self.assertIn("no start line for %d at its current words" % number, err)

    def test_the_window_is_a_parameter_and_the_time_names_its_offset(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number, "--window", "30")
        self.assertEqual(opened["window_ends"], "2026-11-16T16:51-08:00")
        self.assertIn(sentence("4:51"), self.message(opened["message_id"])[2])
        for now, said in (("2026-11-16T16:20:30", "--now names its offset"), ("tomorrow", "--now is an ISO 8601 time")):
            code, result, err = self.cut(number, now)
            self.assertEqual((code, result), (1, None))
            self.assertIn("refused: " + said, err)
        code, result, err = self.open_line(number + 1, "--window", "0")
        self.assertIn("refused: --window is a whole number of minutes, at least 1", err)
        # Times are Pacific, daylight time included: 9:50:10 UTC in July is 2:50:10 Pacific, and 15 minutes on, rounded
        # up to the minute, is 3:06.
        summer = self.add("Kite colours on the shelf page", "Show each kite's colour.", actor="owner")
        line = self.opened(summer, now="2026-07-04T09:50:10+00:00")
        self.assertEqual(line["window_ends"], "2026-07-04T03:06-07:00")
        self.assertIn(sentence("3:06"), self.message(line["message_id"])[2])


class PostedWindowCase(StartLineCase):
    # The window runs from the minute the line is posted, after the writer returns, and the sentence's H:MM is counted
    # from that, never from when open started (warp, codex #6896).

    def test_a_slow_writers_line_stands_open_for_its_whole_window_from_when_it_is_posted(self):
        # The reviewer's probe (rv3b): --window 1, a writer that takes 125 s, --now left out, the cut run right after.
        number = self.add("Kite wind page", "Show the wind.", actor="owner")
        opened = self.open_slowly(number, T0, 125, "--window", "1")
        # Open started at 16:20:30; the line was posted at 16:22:35, after the writer, and stands open to 16:23:35: 4:24.
        self.assertEqual(opened["window_ends"], "2026-11-16T16:24-08:00")
        self.assertEqual(self.message(opened["message_id"])[2], posted(LINE, number, "Kite wind page", "4:24", "2026-11-16T16:24-08:00"))
        self.waiting(number, "2026-11-16T16:22:36-08:00", "4:24")
        self.waiting(number, "2026-11-16T16:23:59-08:00", "4:24")
        self.assertEqual(self.cut_ok(number, "2026-11-16T16:24:00-08:00")["answer"], "window-ended")

    def test_each_line_posted_again_in_one_open_gets_its_own_posted_time(self):
        number = self.add("Kite wind page", "Show the wind.", actor="owner")
        opened = self.opened(number)
        first = self.reply(opened["message_id"], "Wind in knots.")
        second = self.reply(opened["message_id"], "And the gusts.")
        # One open works both in; each writer run takes 125 s from 16:23:00: the first line posted again at 16:25:05
        # stands open to 16:26:05 (4:27), the second, posted at 16:27:10, to 16:28:10 (4:29).
        again = self.open_slowly(number, "2026-11-16T16:23:00-08:00", 125, "--window", "1", line="Wind and gusts in knots.")
        self.assertEqual([rewrite["reply"] for rewrite in again["rewrites"]], [first, second])
        self.assertEqual([self.message(rewrite["message_id"])[2] for rewrite in again["rewrites"]],
                         [posted("Wind and gusts in knots.", number, "Kite wind page", clock, "2026-11-16T16:%s-08:00" % ends)
                          for clock, ends in (("4:27", "27"), ("4:29", "29"))])
        self.assertEqual(again["window_ends"], "2026-11-16T16:29-08:00")
        self.waiting(number, "2026-11-16T16:27:11-08:00", "4:29")
        self.assertEqual(self.cut_ok(number, "2026-11-16T16:29:00-08:00")["message_id"], again["message_id"])


class DossierCase(StartLineCase):
    # Any message of the owner's in the start line's dossier, its reply thread, after the line is a correction, his reply
    # under his own reply included; a plain top-level post in the topic is a new matter and is not read (warp, codex #6896).

    def test_a_reply_the_owner_writes_under_his_own_reply_is_a_correction_worked_in_and_posted_again(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        said = self.reply(opened["message_id"], "Lengths in metres.")
        metres = "The string page shows each kite's string length in metres."
        self.opened(number, line=metres, now="2026-11-16T16:25:00-08:00")
        # He writes again under his own reply, not under the line posted again: still his correction, never a silence.
        more = self.reply(said, "And in feet beside them.")
        self.unworked(number, more)
        before = self.count()
        feet = "The string page shows each kite's string length in metres and feet."
        third = self.opened(number, line=feet, now="2026-11-16T16:28:00-08:00",
                            expect=("owner wrote under it:\nAnd in feet beside them.", "The start line now reads:\n" + metres))
        self.assertEqual((third["rewrites"][0]["reply"], self.message(third["message_id"])[5], self.told(third["message_id"]), self.count()),
                         (more, more, ["owner"], before + 1))
        self.assertEqual(self.message(third["message_id"])[2], posted(feet, number, "String lengths on the string page", "4:43",
                                                                      "2026-11-16T16:43-08:00"))
        # Under a member's message in the dossier, too: the member's words are not his, his under them are.
        note = self.reply(third["message_id"], "I could put the feet behind a toggle.", actor="agent-b")
        toggle = self.reply(note, "No toggle: both, always.")
        self.unworked(number, toggle)
        fourth = self.opened(number, line="Metres and feet, both always shown.", now="2026-11-16T16:30:00-08:00",
                             expect=("No toggle: both, always.",))
        self.assertEqual([rewrite["reply"] for rewrite in fourth["rewrites"]], [toggle])
        cut = self.cut_ok(number)
        self.assertEqual((cut["brief"], cut["lines"]), ("Metres and feet, both always shown.", 4))

    def test_a_reply_under_his_own_reply_before_any_line_works_either_in_is_worked_in_after_it(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        said = self.reply(opened["message_id"], "Lengths in metres.")
        more = self.reply(said, "Rounded to the metre.")
        again = self.opened(number, line="Lengths in whole metres.", now="2026-11-16T16:25:00-08:00", expect=(
            "@1:owner wrote under it:\nLengths in metres.\n", "@2:owner wrote under it:\nRounded to the metre.\n"))
        self.assertEqual([rewrite["reply"] for rewrite in again["rewrites"]], [said, more])
        self.assertEqual(self.cut_ok(number)["lines"], 3)

    def test_the_owners_plain_post_in_the_topic_is_a_new_matter_and_is_not_read(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        # His top-level post in the topic, his reply under a message outside the dossier, and a member's reply in it.
        self.post("The shelf page could list the kites by colour.", actor="owner")
        outside = self.post("Build note: the reel page loads slowly.")
        self.reply(outside, "Look at the reel page next.")
        self.reply(opened["message_id"], "Only the reel page instead.", actor="agent-b")
        before, runs = self.count(), self.runs()
        again = self.opened(number, now=BEFORE)
        self.assertEqual((again["rewrites"], again["message_id"], self.count(), self.runs()), ([], opened["message_id"], before, runs))
        self.waiting(number, BEFORE, "4:36")
        cut = self.cut_ok(number, "2026-11-16T16:36:00-08:00")
        self.assertEqual((cut["answer"], cut["brief"], cut["lines"]), ("window-ended", LINE, 1))


class DissentCase(StartLineCase):
    # A 👎 is a correction, never a yes: the line is posted again with "say what to change" under it, and nothing builds
    # until a 👍 or the new window's end (warp, codex #6896). A reply with no letter or digit that holds a dissent mark
    # (👎 ❌ 🛑 ⛔ 🚫) is one; any other reply is worked in by the writer as before.

    def test_a_thumbs_down_is_posted_again_with_say_what_to_change_and_never_builds_as_a_yes(self):
        for n, words in enumerate(("\U0001f44e", "\u274c", "\U0001f6d1", "\U0001f44e\U0001f3fd", " \U0001f44e\U0001f44e ", "\u26d4\ufe0f")):
            with self.subTest(words=words):
                number = self.add("Kite page %d" % n, "Show kite page %d." % n, actor="owner")
                opened = self.opened(number)
                said = self.reply(opened["message_id"], words)
                self.unworked(number, said, LATE)
                before, runs = self.count(), self.runs()
                # The line as it stands, posted again under his reply, to him, with "say what to change" under it and a
                # window from its post: 16:22:00 and 15 minutes, 4:37. A 👎 has nothing to work in, so no writer runs.
                again = self.opened(number, line="A line the writer would write.", now="2026-11-16T16:22:00-08:00")
                topic, author, body, addressees, intent, reply_to = self.message(again["message_id"])
                self.assertEqual(body, posted(LINE, number, "Kite page %d" % n, "4:37", "2026-11-16T16:37-08:00", ask=True))
                self.assertEqual((json.loads(addressees), intent, reply_to, self.told(again["message_id"])), (["owner"], "tell", said, ["owner"]))
                self.assertEqual((again["brief"], again["rewrites"][0]["reply"], again["rewrites"][0]["dissent"], self.count(), self.runs()),
                                 (LINE, said, True, before + 1, runs))
                # Never a yes: nothing builds in the new window; its end or his 👍 on the new line builds it.
                self.waiting(number, "2026-11-16T16:36:59-08:00", "4:37")
                self.assertEqual(self.cut_ok(number, "2026-11-16T16:37:00-08:00")["answer"], "window-ended")
                self.ok("thumb", again["message_id"], actor="owner")
                self.assertEqual(self.cut_ok(number, "2026-11-16T16:23:00-08:00")["answer"], "thumbs-up")

    def test_a_typed_thumbs_up_and_other_replies_without_a_dissent_are_worked_in_by_the_writer_with_no_ask(self):
        for n, words in enumerate(("\U0001f44d", "?", "\U0001f44e not the reel page", "\u274c 2")):
            with self.subTest(words=words):
                number = self.add("Kite page %d" % n, "Show kite page %d." % n, actor="owner")
                opened = self.opened(number)
                said = self.reply(opened["message_id"], words)
                self.unworked(number, said, LATE)
                runs = self.runs()
                worked = "Kite page %d, as worked by the writer." % n
                again = self.opened(number, line=worked, now="2026-11-16T16:22:00-08:00", expect=("owner wrote under it:\n" + words.strip(),))
                self.assertEqual((self.message(again["message_id"])[2], self.message(again["message_id"])[5], self.runs()),
                                 (posted(worked, number, "Kite page %d" % n, "4:37", "2026-11-16T16:37-08:00"), said, runs + 1))
                self.waiting(number, "2026-11-16T16:36:59-08:00", "4:37")
                self.assertEqual(self.cut_ok(number)["brief"], worked)


if __name__ == "__main__":
    unittest.main()

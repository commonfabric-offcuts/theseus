from __future__ import annotations

"""The start line (docs/tools.md, "Start line"): tools/start_line.py run as a coordinator runs it, through the real
`bin/aim-next` of this checkout against a temporary instance, with a stand-in brief-writer.

Every outcome, item and word here is invented: outcome w1 ("Isolated test") is owner's, agent-a its coordinator and
agent-b a member; its items are about a kite club's pages."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest

from aim_next.profile import write_profile
from test_agent_verbs import AgentVerbCase

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "start_line.py"
CLI = ROOT / "bin" / "aim-next"

# The stand-in brief-writer: each run leaves a folder of its own under RUNS, and it checks what it was given (the
# live checkout as its working directory, each expected word in its prompt), failing loudly (exit 4) when it was not;
# then it prints its line, or fails with the code it was told to.
WRITER = '''import os, sys, uuid
runs, surface, line, code = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
prompt = sys.stdin.read()
os.mkdir(os.path.join(runs, "run-" + uuid.uuid4().hex))
if os.path.realpath(os.getcwd()) != os.path.realpath(surface):
    sys.stderr.write("ran in " + os.getcwd())
    sys.exit(4)
missing = [word for word in sys.argv[5:] if word not in prompt]
if missing:
    sys.stderr.write("the prompt lacks " + repr(missing))
    sys.exit(4)
sys.stdout.write(line)
sys.exit(code)
'''
LINE = "The string page shows each kite's string length beside its name; the reel page stays as it is."


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

    def open_line(self, number, *flags, line=LINE, code=0, topic="t1", expect=()):
        return self.tool("open", "w1", str(number), "--topic", topic, "--surface", str(self.surface), *flags,
                         "--", sys.executable, "-I", str(self.writer), str(self.writer_runs), str(self.surface), line, str(code), *expect)

    def opened(self, number, *flags, line=LINE, expect=()):
        code, result, err = self.open_line(number, *flags, line=line, expect=expect)
        self.assertEqual((code, err), (0, ""), result)
        return result

    def cut(self, number):
        return self.tool("cut", "w1", str(number))

    def cut_ok(self, number):
        code, result, err = self.cut(number)
        self.assertEqual((code, err), (0, ""), result)
        return result

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
        self.assertEqual(body.split("\n")[0], LINE)
        self.assertIn('Start line for %d, "String lengths on the string page"' % number, body)
        self.assertIn("👍 or no answer builds it as written; a reply of one line becomes what it builds.", body)
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
        self.assertIn("Kept with the item's work; nobody is asked.", body)
        self.assertNotIn("👍", body)
        self.assertEqual(self.told(result["message_id"]), [], "the owner is not told")
        self.assertEqual(self.sql("SELECT kind,ref FROM message_subjects WHERE message_id=?", (result["message_id"],)), [("item", str(number))])

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
        posted = self.opened(number)
        self.assertEqual((posted["posted"], posted["topic_id"], self.count()), (True, "t1", before + 1))
        self.assertEqual(posted["operation_id"], "start-line-w1-%d-%s.2" % (number, posted["revision"]))
        again = self.opened(number, line="Another line.")
        self.assertEqual((again["message_id"], again["posted"], self.count()), (posted["message_id"], False, before + 1))
        cut = self.cut_ok(number)
        self.assertEqual((cut["message_id"], cut["operation_id"], cut["answer"]), (posted["message_id"], posted["operation_id"], "silence"))


class CutCase(StartLineCase):
    def test_the_cut_builds_as_written_on_silence_and_on_the_owners_thumbs_up_only(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        cut = self.cut_ok(number)
        self.assertEqual((cut["answer"], cut["brief"], cut["written"], cut["message_id"], cut["revision"]),
                         ("silence", LINE, LINE, opened["message_id"], opened["revision"]))
        # Someone else's thumb or reply is not the owner's answer.
        self.ok("thumb", opened["message_id"], actor="agent-b")
        self.reply(opened["message_id"], "Only the reel page instead.", actor="agent-b")
        self.assertEqual((self.cut_ok(number)["answer"], self.cut_ok(number)["brief"]), ("silence", LINE))
        self.ok("thumb", opened["message_id"], actor="owner")
        self.assertEqual((self.cut_ok(number)["answer"], self.cut_ok(number)["brief"]), ("thumbs-up", LINE))
        self.ok("thumb", opened["message_id"], "--off", actor="owner")
        self.assertEqual(self.cut_ok(number)["answer"], "silence", "a thumb taken back is no answer")

    def test_an_owners_one_line_reply_becomes_the_brief_against_the_same_revision(self):
        number = self.add("String lengths on the string page", "Show how long each kite's string is.", actor="owner")
        opened = self.opened(number)
        self.reply(opened["message_id"], "👍")
        self.assertEqual((self.cut_ok(number)["answer"], self.cut_ok(number)["brief"]), ("thumbs-up", LINE))
        corrected = self.reply(opened["message_id"], "Lengths in metres, on the reel page too.")
        cut = self.cut_ok(number)
        self.assertEqual((cut["answer"], cut["brief"], cut["written"], cut["answer_message_id"], cut["revision"], cut["operation_id"]),
                         ("correction", "Lengths in metres, on the reel page too.", LINE, corrected, opened["revision"], opened["operation_id"]))
        self.assertEqual(self.message(corrected)[5], opened["message_id"], "his correction answers the start line of that revision")
        newer = self.reply(opened["message_id"], "Lengths in metres, on the string page only.")
        self.assertEqual((self.cut_ok(number)["brief"], self.cut_ok(number)["answer_message_id"]), ("Lengths in metres, on the string page only.", newer))
        longer = self.reply(opened["message_id"], "Hmm, two things.\nFirst the reel page, then the shelf.")
        code, result, err = self.cut(number)
        self.assertEqual((code, result), (1, None))
        self.assertIn("refused: owner's reply %s to the start line of %d is more than one line" % (longer, number), err)

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


if __name__ == "__main__":
    unittest.main()

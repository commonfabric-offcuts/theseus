from __future__ import annotations

"""The pipeline's agent verbs (docs/agent-cli.md, "The pipeline"): an agent turns
the pipeline on, adds and moves items, starts work on them, says what a message
is about, and reads it all back."""

from pathlib import Path
import json
import unittest
from unittest import mock

from aim_next import Store
from aim_next.profile import write_profile
from test_agent_verbs import AgentVerbCase


class PipelineVerbCase(AgentVerbCase):
    # w1 is owner's outcome; agent-a is its coordinator and agent-b a member.

    def setUp(self):
        super().setUp()
        path = Path(self.temp.name).resolve() / "owner.json"
        write_profile(path, str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        self.profiles["owner"] = path

    def ok(self, *argv, actor="agent-a", stdin=b""):
        code, out, err = self.run_cli(*argv, actor=actor, stdin=stdin)
        self.assertEqual((code, err), (0, ""), out)
        return out

    def test_the_coordinator_turns_it_on_adds_and_moves_and_the_listing_reads_it_back(self):
        self.assertEqual(self.ok("pipeline-on", "w1"), "pipeline w1 on\n")
        self.assertEqual(self.ok("add", "w1", "--title", "Say which release is live", "--section", "next", "--note", "the page", "--size", "small", "Words."),
                         "added 1 to w1\n")
        self.assertEqual(self.ok("add", "w1", "--title", "Second", "--section", "next", "--note", "n", "-"), "added 2 to w1\n")
        out = self.ok("move", "w1", "2", "--above", "1")
        self.assertRegex(out, r"^moved 2 to next \(event \d+\)\n$")
        self.assertEqual(self.ok("pipeline", "w1", "--section", "next"),
                         "NEXT\n2    Second  [next · next]\n     raised by agent-a\n     from n\n"
                         "1    Say which release is live  [next · next]\n     small · raised by agent-a\n     from the page\n")
        event = int(out.split("event ")[1].rstrip(")\n"))
        self.ok("move", "w1", "2", "--undo", str(event))
        self.assertEqual([line.split()[0] for line in self.ok("pipeline", "w1", "--section", "next").splitlines()[1::3]], ["1", "2"])
        record = self.ok("item", "w1", "1")
        self.assertIn("1    Say which release is live  [next · next]\n", record)
        self.assertIn("     Words.\n", record)
        self.assertRegex(record, r"event \d+: added by agent-a ")

    def test_the_coordinator_turns_it_off_and_only_the_owner_renames_it(self):
        self.ok("pipeline-on", "w1")
        code, out, err = self.run_cli("pipeline-on", "w1", "--title", "Release pipeline")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        self.assertEqual(self.ok("pipeline-on", "w1", "--title", "Release pipeline", actor="owner"), "pipeline w1 on\n")
        self.assertEqual(self.ok("pipeline-on", "w1", "--off"), "pipeline w1 off\n")
        self.assertEqual(self.sql("SELECT enabled,title FROM pipelines"), [(0, "Release pipeline")])
        code, out, err = self.run_cli("pipeline-on", "w1", actor="agent-b")
        self.assertEqual(code, 2)
        self.assertIn("FORBIDDEN", err)

    def test_a_post_names_what_it_is_about_and_an_ask_about_an_item_waits_on_the_one_asked(self):
        self.ok("pipeline-on", "w1")
        self.ok("add", "w1", "--title", "Decide me", "--section", "next", "--note", "n", "-")
        self.ok("post", "t1", "--asks", "owner", "--subject", "item:1", "Which way for 1?")
        self.assertEqual(self.sql("SELECT kind,ref FROM message_subjects"), [("item", "1")])
        self.assertIn("[next · waiting on you]", self.ok("pipeline", "w1", "--section", "next", actor="owner"))
        self.assertIn("     agent-a asked you ", self.ok("pipeline", "w1", "--section", "next", actor="owner"))
        self.assertIn("[next · next]", self.ok("pipeline", "w1", "--section", "next"))
        code, out, err = self.run_cli("post", "t1", "--subject", "item:9", "About nothing")
        self.assertEqual(code, 2)
        self.assertIn("NOT_FOUND", err)

    def test_stages_and_a_piece_of_work_move_along_from_the_command_line(self):
        self.ok("pipeline-on", "w1")
        stages = Path(self.temp.name) / "stages.json"
        stages.write_text(json.dumps([{"stage_id": "build", "name": "Build", "rounds": "split"}, {"stage_id": "review", "name": "Review"}]))
        self.assertEqual(self.ok("stages", "w1", "--set", str(stages)), "1 Build (build, split): \n2 Review (review, none): \n")
        self.ok("add", "w1", "--title", "Build me", "--section", "now", "--size", "medium", "--note", "n", "-")
        out = self.ok("piece", "w1", "1", "--topic", "t1", "--stage", "build")
        piece = out.split()[2]
        self.assertEqual(out, "started piece %s with 1 in build\n" % piece)
        self.assertEqual(self.ok("enter-stage", piece, "review", "--left", "approved"), "%s entered review, round 1\n" % piece)
        listing = self.ok("pipeline", "w1", "--section", "now")
        self.assertIn("1    Build me  [now · being built]\n", listing)
        self.assertRegex(listing, r"     Review since \d{4}-\d\d-\d\d \d\d:\d\d\n")
        self.assertEqual(self.ok("stage-note", piece, "Half read"), "noted on %s\n" % piece)
        self.assertEqual(self.ok("finish", piece), "%s finished\n" % piece)
        self.assertIn("1    Build me  [now · shipped]", self.ok("item", "w1", "1"))

    def test_move_with_a_note_sets_a_piece_aside_and_the_item_shows_its_stages_and_the_note(self):
        self.ok("pipeline-on", "w1")
        stages = Path(self.temp.name) / "stages.json"
        stages.write_text(json.dumps([{"stage_id": "build", "name": "Build"}, {"stage_id": "review", "name": "Review"}]))
        self.ok("stages", "w1", "--set", str(stages))
        for title in ("Build me", "And me"):
            self.ok("add", "w1", "--title", title, "--section", "now", "--size", "small", "--note", "n", "-")
        piece = self.ok("piece", "w1", "1,2", "--topic", "t1", "--stage", "build").split()[2]
        code, out, err = self.run_cli("move", "w1", "1", "--to", "later")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("NOTE_REQUIRED: 1 is being built now, so moving it to Later sets its piece aside, with 2: say why in a short note", err)
        code, out, err = self.run_cli("move", "w1", "1", "--to", "later", "--note", "Rethink the tests", actor="agent-b")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("FORBIDDEN", err)
        out = self.ok("move", "w1", "1", "--to", "later", "--note", "Rethink the tests")
        self.assertRegex(out, r"^moved 1 to later \(event \d+\), setting aside piece %s with 1 and 2\n$" % piece)
        self.assertEqual([line.split()[0] for line in self.ok("pipeline", "w1", "--section", "later").splitlines()[1::3]], ["1", "2"])
        record = self.ok("item", "w1", "2")
        self.assertRegex(record, r"\n     Build: \d{4}-\d\d-\d\d \d\d:\d\d to \d{4}-\d\d-\d\d \d\d:\d\d · set aside: Rethink the tests\n")
        self.assertRegex(record, r"event \d+: set aside to later by agent-a .*: Rethink the tests\n")

    def test_stages_set_whose_read_back_fails_says_the_stages_were_recorded(self):
        """`stages --set` reads the pipeline again after the write: a busy database
        there is not the write's failure, so it never asks for the write again."""
        self.ok("pipeline-on", "w1")
        stages = Path(self.temp.name) / "stages.json"
        stages.write_text(json.dumps([{"stage_id": "build", "name": "Build", "rounds": "split"}]))
        original, reads = Store.view, []

        def view(store, actor, name, args):
            reads.append(name)
            if name == "pipeline" and reads.count("pipeline") == 2:
                return {"recorded": False, "error": {"code": "DATABASE_BUSY", "message": "The database is busy", "retryable": True}}
            return original(store, actor, name, args)
        with mock.patch.object(Store, "view", view):
            code, out, err = self.run_cli("stages", "w1", "--set", str(stages))
        [operation] = [row[0] for row in self.sql("SELECT id FROM operations WHERE kind='pipeline.stages_set'")]
        self.assertEqual((code, out), (1, ""))
        self.assertEqual(err, "READ_BACK_UNCONFIRMED: the stages of w1's pipeline were recorded (pipeline.stages_set, operation %s), "
                              "but reading them back failed (DATABASE_BUSY: The database is busy); do not send them again: "
                              "`stages w1` lists them.\n" % operation)
        self.assertEqual(self.ok("stages", "w1"), "1 Build (build, split): \n")

    def test_combining_into_a_release_stage_on_the_owners_word_takes_an_ask(self):
        self.store.record_release({"release": 22, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [], "source": "backfill"})
        self.ok("pipeline-on", "w1", "--releases", actor="owner")
        stages = Path(self.temp.name) / "stages.json"
        stages.write_text(json.dumps([{"stage_id": "wait", "name": "Waits to combine"},
                                      {"stage_id": "approve", "name": "Approve", "scope": "release", "gate": {"owner": True}}]))
        self.ok("stages", "w1", "--set", str(stages), actor="owner")
        self.ok("add", "w1", "--title", "Ship me", "--section", "now", "--size", "small", "--note", "n", "-")
        piece = self.ok("piece", "w1", "1", "--topic", "t1", "--stage", "wait").split()[2]
        code, out, err = self.run_cli("combine", "w1", "--pieces", piece, "--topic", "t1")
        self.assertEqual(code, 2)
        self.assertIn("ASK_REQUIRED", err)
        self.ok("post", "t1", "--asks", "owner", "May release 23 go out?")
        ask = self.sql("SELECT id FROM messages WHERE intent='ask' ORDER BY seq DESC LIMIT 1")[0][0]
        self.assertRegex(self.ok("combine", "w1", "--release", "23", "--pieces", piece, "--topic", "t1", "--ask", ask),
                         r"^release 23 combined as p-\w+ with 1\n$")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""An outcome's kind and its end (D22, D41, D42; docs/targets.md): the start
record, the owner's change of kind, Reached in one step with its words, and the
guard that keeps a reached outcome final while a reader's own state still saves."""

import sqlite3
import unittest

from aim_next.outcome_kind import REACHED_EXEMPT
from aim_next.validation import COMMANDS
import test_targets


class KindCase(test_targets.TargetCase):
    """Outcome w1 (owner "owner", coordinator agent-a, member agent-b) with topic t1."""

    def version(self, workspace="w1"):
        return self.store.view("owner", "workspace", {"workspace_id": workspace})["workspace"]["version"]

    def kind_set(self, kind, actor="owner", workspace="w1"):
        return self.command("outcome.kind_set", {"kind": kind}, {"workspace_id": workspace}, {"workspace_revision": self.version(workspace)},
                            actor=actor)

    def reach(self, words="The deck went out to every investor", actor="owner", **args):
        return self.command("outcome.reach", dict({"words": words}, **args), {"workspace_id": "w1"}, {"workspace_revision": self.version()},
                            actor=actor)

    def kinds(self, workspace="w1"):
        return self.sql("SELECT seq,kind,origin,set_by FROM outcome_kinds WHERE workspace_id=? ORDER BY seq", (workspace,))

    def create(self, workspace, op=None, **args):
        return self.command("workspace.create", dict({"id": workspace, "title": "Outcome " + workspace, "purpose": "",
                                                      "team": ["agent-a"], "coordinator": "agent-a"}, **args), op=op)


class StartAndChangeCase(KindCase):
    def test_every_outcome_starts_with_one_start_record_of_its_kind(self):
        self.assertEqual(self.kinds(), [(1, "keep", "create", "owner")], "with no kind given it is to keep")
        self.committed(self.create("w2", kind="reach", op="make-w2"))
        self.assertEqual(self.kinds("w2"), [(1, "reach", "create", "owner")])
        self.committed(self.create("w2", kind="reach", op="make-w2"))
        self.assertEqual(self.kinds("w2"), [(1, "reach", "create", "owner")], "a retry writes no second start record")
        self.rejected(self.create("w3", kind="finish"), "INVALID_ARGUMENT")
        self.assertEqual((self.sql("SELECT count(*) FROM workspaces WHERE id='w3'"), self.kinds("w3")), ([(0,)], []))

    def test_only_the_owner_changes_the_kind_and_every_change_is_kept(self):
        self.rejected(self.kind_set("reach", actor="agent-a"), "FORBIDDEN")
        self.rejected(self.kind_set("finish"), "INVALID_ARGUMENT")
        self.assertTrue(self.committed(self.kind_set("reach"))["changed"])
        self.assertFalse(self.committed(self.kind_set("reach"))["changed"], "the same kind again changes nothing")
        self.assertTrue(self.committed(self.kind_set("keep"))["changed"])
        self.assertEqual(self.kinds(), [(1, "keep", "create", "owner"), (2, "reach", "change", "owner"), (3, "keep", "change", "owner")])
        self.assertEqual(self.store.view("owner", "workspaces", {})["items"][0]["kind"], "keep")

    def test_the_kinds_past_cannot_be_rewritten(self):
        with sqlite3.connect(str(self.path)) as db:
            for statement in ("INSERT INTO outcome_kinds VALUES ('w1',2,'reach','create','owner',1)",
                              "INSERT INTO outcome_kinds VALUES ('w1',1,'reach','change','owner',1)",
                              "UPDATE outcome_kinds SET kind='reach'", "DELETE FROM outcome_kinds"):
                with self.subTest(statement=statement), self.assertRaises(sqlite3.DatabaseError):
                    db.execute(statement)
        self.assertEqual(self.kinds(), [(1, "keep", "create", "owner")])

    def test_an_outcome_from_before_release_21_reads_to_keep_and_changes_from_there(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER kinds_stay_d")
            db.execute("DELETE FROM outcome_kinds")
        self.assertEqual(self.store.view("owner", "workspaces", {})["items"][0]["kind"], "keep")
        self.assertFalse(self.committed(self.kind_set("keep"))["changed"])
        self.committed(self.kind_set("reach"))
        self.assertEqual(self.kinds(), [(1, "reach", "change", "owner")])
        with sqlite3.connect(str(self.path)) as db, self.assertRaises(sqlite3.DatabaseError):
            db.execute("INSERT INTO outcome_kinds VALUES ('w1',2,'keep','create','owner',1)")


class ReachedCase(KindCase):
    def setUp(self):
        super().setUp()
        self.committed(self.kind_set("reach"))

    def test_only_the_owner_says_reached_in_his_own_words_and_only_for_an_outcome_to_reach(self):
        self.rejected(self.reach(actor="agent-a"), "FORBIDDEN")
        for words in ("", "  ", "x" * 501):
            self.rejected(self.reach(words, unmet_confirmed=True), "WHY_REQUIRED")
        self.committed(self.kind_set("keep"))
        self.rejected(self.reach(unmet_confirmed=True), "NOT_TO_REACH")
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_reached"), [(0,)])

    def test_with_nothing_met_he_confirms_first_and_the_checks_not_met_are_kept(self):
        self.rejected(self.reach(), "NOT_MET")
        self.committed(self.define(test_targets.UNITS))
        self.record_run(test_targets.SHA_NEW, "2026-11-03T05:00:00-08:00", [dict(test_targets.passed(), result="failed")])
        refused = self.reach()
        self.rejected(refused, "NOT_MET")
        self.assertIn("Unit checks", refused["error"]["message"])
        self.committed(self.reach(unmet_confirmed=True))
        self.assertEqual(self.sql("SELECT words,unmet,reached_by FROM outcome_reached"), [("The deck went out to every investor", '["units"]', "owner")])

    def test_when_every_check_is_met_no_confirm_is_needed(self):
        self.committed(self.define(test_targets.UNITS))
        self.record_run(test_targets.SHA_NEW, "2026-11-03T05:00:00-08:00", [test_targets.passed()])
        self.assertEqual(self.checks_view()["reach"]["offered"], True)
        self.committed(self.reach())
        self.assertEqual(self.sql("SELECT unmet FROM outcome_reached"), [("[]",)])

    def test_reached_closes_every_topic_clears_every_wait_and_folds_the_outcome_away(self):
        self.post("Is the deck ready to send?", addressees=["owner"], intent="ask")
        self.assertEqual([row[0] for row in self.waiting_on()], ["owner"])
        result = self.committed(self.reach(unmet_confirmed=True))
        self.assertEqual(result["topics_closed"], 1)
        self.assertEqual(self.sql("SELECT state,archived,state_note FROM topics WHERE id='t1'"), [("done", 1, "Closed when Isolated test was reached")])
        self.assertEqual(self.waiting_on(), [])
        listing = self.store.view("owner", "workspaces", {})
        self.assertEqual(([item["id"] for item in listing["items"]], listing["reached_count"]), ([], 1))
        reached = self.store.view("owner", "workspaces", {"reached": True})["items"]
        self.assertEqual([(item["id"], item["kind"], item["reached_ms"]) for item in reached], [("w1", "reach", result["reached_ms"])])
        self.assertEqual(self.checks_view()["word"], "reached")

    def test_a_reached_outcome_refuses_every_change_but_a_readers_own_state_saves(self):
        self.committed(self.reach(unmet_confirmed=True))
        self.rejected(self.reach(unmet_confirmed=True), "OUTCOME_REACHED")
        self.rejected(self.kind_set("keep"), "OUTCOME_REACHED")
        self.rejected(self.command("message.post", {"body": "One more thing"}, {"topic_id": "t1"}, actor="agent-a"), "OUTCOME_REACHED")
        self.rejected(self.propose("Later words", actor="owner"), "OUTCOME_REACHED")
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_target_revisions"), [(0,)])
        seq = self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]
        self.committed(self.command("topic.read_through", {"seq": seq}, {"topic_id": "t1"}, actor="agent-a"))
        # Another outcome is untouched by this one's end.
        self.committed(self.create("w2"))
        self.committed(self.kind_set("reach", workspace="w2"))
        with sqlite3.connect(str(self.path)) as db:
            for statement in ("UPDATE outcome_reached SET words='Changed'", "DELETE FROM outcome_reached"):
                with self.subTest(statement=statement), self.assertRaises(sqlite3.DatabaseError):
                    db.execute(statement)

    def test_in_a_reached_outcome_each_reader_still_keeps_their_own_place_marks_and_notes(self):
        # Two messages to agent-b wait for it when the owner says Reached.
        first = self.post("Is the deck ready?", addressees=["agent-b"], intent="tell")
        self.post("And the speaker notes?", addressees=["agent-b"], intent="tell")
        pending = [row[0] for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending' ORDER BY seq")]
        self.assertEqual(len(pending), 2)
        self.committed(self.reach(unmet_confirmed=True))
        # Its own acknowledgement and reading through still commit and clear what it was sent.
        self.assertTrue(self.committed(self.command("delivery.ack", {}, {"delivery_id": pending[0]}, actor="agent-b"))["acknowledged"])
        seq = self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]
        self.assertEqual(self.committed(self.command("topic.read_through", {"seq": seq}, {"topic_id": "t1"}, actor="agent-b"))["acknowledged"], 1)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"), [(0,)])
        # The owner's own mark and private note on a message there save.
        self.committed(self.command("message.mark", {"marked": True}, {"message_id": first}, {"mark_revision": 0}))
        self.assertEqual(self.sql("SELECT count(*) FROM message_marks WHERE actor_id='owner' AND message_id=?", (first,)), [(1,)])
        self.committed(self.command("note.save", {"source_ref": {"kind": "message", "id": first}, "body": "Sent on Friday"}, {"note_id": "n1"},
                                    {"note_revision": 0}))
        # While a word to the others there is still refused.
        self.rejected(self.command("message.post", {"body": "Reading it now"}, {"topic_id": "t1"}, actor="agent-b"), "OUTCOME_REACHED")

    def test_every_exempt_command_is_a_command(self):
        self.assertLessEqual(REACHED_EXEMPT, set(COMMANDS))
        self.assertNotIn("message.post", REACHED_EXEMPT)
        self.assertNotIn("topic.update", REACHED_EXEMPT)


if __name__ == "__main__":
    unittest.main()

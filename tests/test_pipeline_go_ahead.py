from __future__ import annotations

"""The owner's go-ahead (item 170; docs/pipeline.md, "Who changes what"): an item
the owner placed moves for the coordinator only when the move names, as
because_message_id, the owner's own word for it, newer than that placement, in a
topic of this outcome the mover can read, and never a whisper.

w1 is owner's outcome; agent-a is its coordinator and agent-b a member. t1 is
w1's topic, with agent-a in it. The clock is held and moved on by hand, so which
message is newer than a placement is exact."""

import json
import unittest
from unittest import mock

from aim_next.pipeline import _clock
from test_pipeline_steering import PipelineCase


class GoAheadCase(PipelineCase):
    def setUp(self):
        self.now = 1_800_000_000_000
        for name in ("pipeline", "conversation"):
            patch = mock.patch("aim_next.%s._now_ms" % name, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        super().setUp()
        self.committed(self.on())
        for n in (1, 2, 3):
            self.add("Next %d" % n, actor="agent-a")
            self.tick()
        # The owner puts 2 first: from here 2 is the owner's placement.
        self.placed = self.committed(self.move(2, above=1, actor="owner"))["event"]
        self.tick()

    def tick(self):
        self.now += 1000

    def placed_at(self):
        return _clock(self.sql("SELECT ms FROM pipeline_events WHERE seq=?", (self.placed,))[0][0])

    def say(self, body, actor="owner", **args):
        message = self.post(body, actor=actor, **args)
        self.tick()
        return message

    def refused(self, receipt, code, words):
        self.rejected(receipt, code)
        self.assertEqual(receipt["error"]["message"], words)

    def nothing_moved(self, before):
        self.assertEqual(self.section("next"), [2, 1, 3])
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'"), before)

    def outside(self, team, participants):
        """A topic tx in another outcome w2, opened by the owner with words that name 2 and Later."""
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "team": team}))
        source = {"kind": "new_topic", "id": "opening-tx", "workspace_id": "w2"}
        self.committed(self.save_draft("tx-draft", source, "tx", "Move 2 to Later",
                                       opening={"workspace_id": "w2", "title": "Topic tx", "participants": participants}))
        self.committed(self.prepare("tx-draft", "tx", submission="tx-sub", send_op="open-tx"))
        message = self.committed(self.command("topic.create_and_send", {"submission_id": "tx-sub"}, target={"topic_id": "tx"}, op="open-tx"))["message_id"]
        self.tick()
        return message

    def test_a_yes_to_a_proposal_to_move_the_item_there_moves_it_and_the_event_keeps_the_word(self):
        ask = self.say("Shall I move 2 to Later? It waits on 3.", actor="agent-a", addressees=["owner"], intent="ask")
        yes = self.say("Yes", reply_to=ask)
        moved = self.committed(self.move(2, section="later", actor="agent-a", because_message_id=yes))
        self.assertEqual(self.section("later"), [2])
        payload = json.loads(self.sql("SELECT payload FROM pipeline_events WHERE seq=?", (moved["event"],))[0][0])
        self.assertEqual((payload["because_message_id"], payload.get("go_ahead")), (yes, "owner"))
        placed = self.item(2)["placed"]
        self.assertEqual((placed["by"], placed["go_ahead"], placed["because"]["message_id"], placed["because"]["topic_id"]),
                         ("agent-a", "owner", yes, "t1"))
        shown = [event for event in self.item(2)["events"] if event["seq"] == moved["event"]][0]
        self.assertEqual({key: shown["because"][key] for key in ("message_id", "topic_id", "author", "readable")},
                         {"message_id": yes, "topic_id": "t1", "author": "owner", "readable": True})

    def test_the_owners_own_word_naming_the_item_moves_it_anywhere_by_number_or_by_subject(self):
        word = self.say("Go ahead with #2, wherever it fits.")
        self.committed(self.move(2, section="dropped", actor="agent-a", because_message_id=word))
        self.assertEqual(self.item(2)["section"], "dropped")
        # Placed again by the owner, then a word that names 2 only as its subject.
        self.committed(self.move(2, section="next", actor="owner"))
        self.tick()
        subject = self.say("This one can go below 3.", subjects=[{"kind": "item", "ref": 2}])
        self.committed(self.move(2, below=3, actor="agent-a", because_message_id=subject))
        self.assertEqual(self.section("next")[-1], 2)

    def test_a_word_that_is_not_the_owners_does_not_lift_it(self):
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        for author in ("agent-a", "agent-b"):
            with self.subTest(author=author):
                theirs = self.say("Move 2 to Later", actor=author)
                self.refused(self.move(2, section="later", actor="agent-a", because_message_id=theirs), "OWNER_PLACED",
                             "owner placed this item at %s, so it moves only on owner's word, and %s is not that: it is %s's message. Nothing moved."
                             % (self.placed_at(), theirs, author))
        self.nothing_moved(before)

    def test_a_word_older_than_the_owners_placement_does_not_lift_it(self):
        old = self.say("2 can go to Later")
        self.placed = self.committed(self.move(2, above=1, actor="owner"))["event"]
        self.tick()
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        self.refused(self.move(2, section="later", actor="agent-a", because_message_id=old), "OWNER_PLACED",
                     "owner placed this item at %s, so it moves only on owner's word, and %s is not that: it was written before that placement. Nothing moved."
                     % (self.placed_at(), old))
        self.nothing_moved(before)

    def test_a_word_that_does_not_name_the_item_or_this_move_does_not_lift_it(self):
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        other_item = self.say("Shall I move 3 to Later?", actor="agent-a")
        elsewhere = self.say("Shall I move 2 to Later?", actor="agent-a")
        cases = (
            ("a yes to moving another item", self.say("Yes", reply_to=other_item), "later"),
            ("a yes to moving it to another section", self.say("Yes", reply_to=elsewhere), "dropped"),
            ("a number that only contains it", self.say("Go ahead with 12 and 22, at 2:30."), "later"),
            ("a plain word", self.say("Go ahead"), "later"),
        )
        words = {"later": "Later", "dropped": "Dropped"}
        for name, message, section in cases:
            with self.subTest(name):
                self.refused(self.move(2, section=section, actor="agent-a", because_message_id=message), "OWNER_PLACED",
                             "owner placed this item at %s, so it moves only on owner's word, and %s is not that: "
                             "it does not name 2, nor reply to a message that proposes moving 2 to %s. Nothing moved."
                             % (self.placed_at(), message, words[section]))
        self.nothing_moved(before)

    def test_the_owners_whisper_counts_as_their_word_to_the_one_it_was_whispered_to(self):
        whisper = self.say("Move 2 to Later", addressees=["agent-a"], whisper=True)
        moved = self.committed(self.move(2, section="later", actor="agent-a", because_message_id=whisper))
        payload = json.loads(self.sql("SELECT payload FROM pipeline_events WHERE seq=?", (moved["event"],))[0][0])
        self.assertEqual(payload["because_message_id"], whisper)
        # Anyone else reading the item sees the move, never the word it was made on, nor its id.
        theirs = [event for event in self.item(2, actor="agent-b")["events"] if event["seq"] == moved["event"]][0]
        self.assertEqual(theirs["because"], {"readable": False})
        self.assertNotIn(whisper, json.dumps(self.item(2, actor="agent-b")))
        self.assertNotIn("Move 2 to Later", json.dumps(self.item(2, actor="agent-b")))

    def test_an_agents_whisper_never_counts_and_outside_a_whisper_it_is_a_message_you_cannot_read(self):
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        asked = self.say("Should 2 go to Later?", addressees=["agent-a"], whisper=True)
        answer = self.say("Move 2 to Later", actor="agent-a", addressees=["owner"], whisper=True, reply_to=asked)
        self.refused(self.move(2, section="later", actor="agent-a", because_message_id=answer), "WHISPER_STAYS_PRIVATE",
                     "%s is an agent's whisper, and it stays private: it is never the word a move is made on. Nothing moved." % answer)
        # To someone outside it, a whisper is a message they cannot read, as an unknown id is.
        to_b = self.say("Move 2 to Later", addressees=["agent-b"], whisper=True)
        for message in (to_b, "m-" + "0" * 32):
            with self.subTest(message=message):
                self.refused(self.move(2, section="later", actor="agent-a", because_message_id=message), "FORBIDDEN",
                             "You can't read a message %s, so it is not a word to move on. Nothing moved." % message)
        self.nothing_moved(before)

    def test_a_word_in_a_topic_the_mover_cannot_read_or_in_another_outcome_does_not_lift_it(self):
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        hidden = self.outside([], [])
        self.refused(self.move(2, section="later", actor="agent-a", because_message_id=hidden), "FORBIDDEN",
                     "You can't read a message %s, so it is not a word to move on. Nothing moved." % hidden)
        self.nothing_moved(before)

    def test_a_word_in_another_outcome_does_not_lift_it(self):
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        readable = self.outside(["agent-a"], ["agent-a"])
        self.refused(self.move(2, section="later", actor="agent-a", because_message_id=readable), "OWNER_PLACED",
                     "owner placed this item at %s, so it moves only on owner's word, and %s is not that: it is in another outcome. Nothing moved."
                     % (self.placed_at(), readable))
        self.nothing_moved(before)

    def test_only_a_steerer_moves_on_the_word_and_without_one_the_refusal_says_how(self):
        word = self.say("Move 2 to Later")
        before = self.sql("SELECT count(*) FROM pipeline_events WHERE kind='moved'")
        self.rejected(self.move(2, section="later", actor="agent-b", because_message_id=word), "FORBIDDEN")
        self.refused(self.move(2, section="later", actor="agent-a"), "OWNER_PLACED",
                     "owner placed this item at %s. Say so once in this outcome's conversation; Theseus does not move it back. "
                     "Once owner says go ahead, move it with that message as because." % self.placed_at())
        self.nothing_moved(before)
        # The owner's own move needs no go-ahead and records none.
        moved = self.committed(self.move(2, section="later", actor="owner", because_message_id=word))
        payload = json.loads(self.sql("SELECT payload FROM pipeline_events WHERE seq=?", (moved["event"],))[0][0])
        self.assertEqual((payload["because_message_id"], payload.get("go_ahead")), (word, None))

    def test_an_item_nobody_but_the_coordinator_placed_records_a_because_without_a_go_ahead(self):
        word = self.say("3 can go to Later", actor="agent-b")
        moved = self.committed(self.move(3, section="later", actor="agent-a", because_message_id=word))
        payload = json.loads(self.sql("SELECT payload FROM pipeline_events WHERE seq=?", (moved["event"],))[0][0])
        self.assertEqual((payload["because_message_id"], payload.get("go_ahead")), (word, None))
        asked = self.say("Can 1 go to Later?", addressees=["agent-a"], whisper=True)
        whisper = self.say("Move 1 to Later", actor="agent-a", addressees=["owner"], whisper=True, reply_to=asked)
        self.rejected(self.move(1, section="later", actor="agent-a", because_message_id=whisper), "WHISPER_STAYS_PRIVATE")
        self.committed(self.move(1, section="later", actor="agent-a", because_message_id=asked))

    def test_a_reader_who_cannot_open_the_word_a_move_was_made_on_sees_neither_it_nor_its_id(self):
        # The owner moves 2 on a word in an outcome of their own that agent-b is not in.
        hidden = self.outside([], [])
        moved = self.committed(self.move(2, section="later", actor="owner", because_message_id=hidden))
        mine = [event for event in self.item(2)["events"] if event["seq"] == moved["event"]][0]
        self.assertEqual((mine["because"]["readable"], mine["because"]["message_id"], mine["because"]["topic_title"]), (True, hidden, "Topic tx"))
        theirs = [event for event in self.item(2, actor="agent-b")["events"] if event["seq"] == moved["event"]][0]
        self.assertEqual(theirs["because"], {"readable": False})
        self.assertNotIn(hidden, json.dumps(self.item(2, actor="agent-b")))


    def test_a_go_ahead_naming_each_item_the_owner_placed_lets_the_coordinator_set_its_piece_aside(self):
        # Items 170 and 183 together: setting a piece aside moves every item of it, so the coordinator's go-ahead names
        # each item of the piece the owner placed; it lifts OWNER_PLACED, never the owner's word on a gated stage.
        self.stages({"stage_id": "build", "name": "Build", "rounds": "together"},
                    {"stage_id": "reads", "name": "Owner reads it", "gate": {"owner": True, "words": "Owner says when"}})
        theirs = self.add("The owner's", section="now", actor="owner", size="small")
        mine = self.add("The coordinator's", section="now", actor="agent-a", size="small")
        held = self.add("Held", section="now", actor="agent-a", size="small")
        self.tick()
        start = lambda numbers, topic: self.committed(self.command(
            "pipeline.piece_start", {"numbers": numbers, "topic_id": topic, "stage_id": "build"}, {"workspace_id": "w1"}, actor="agent-a"))["piece_id"]
        piece = start([mine, theirs], "t1")
        self.committed(self.save_draft("t2-draft", {"kind": "new_topic", "id": "opening-t2", "workspace_id": "w1"}, "t2", "Opening",
                                       opening={"workspace_id": "w1", "title": "Another", "participants": ["agent-a"]}))
        self.committed(self.prepare("t2-draft", "t2", submission="t2-sub", send_op="open-t2"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "t2-sub"}, target={"topic_id": "t2"}, op="open-t2"))
        gated = start([held], "t2")
        ask = self.say("Would you read it?", actor="agent-a", topic="t2", addressees=["owner"], intent="ask")
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "reads", "left_outcome": "approved", "ask_message_id": ask},
                                    {"piece_id": gated}, actor="agent-a"))
        placed = _clock(self.sql("SELECT ms FROM pipeline_events WHERE number=? AND kind='added'", (theirs,))[0][0])
        note = "Rethink the spec"
        state = lambda: (self.positions(), self.sql("SELECT left_outcome FROM pipeline_stage_entries ORDER BY seq"))
        before = state()
        refused = self.move(mine, section="later", note=note, actor="agent-a")
        self.refused(refused, "OWNER_PLACED", "owner placed %d, which is built with %d, at %s. Setting the piece aside moves it too: say so once "
                     "in this outcome's conversation. Once owner says go ahead, move it with that message as because." % (theirs, mine, placed))
        # A word naming only the coordinator's item is not the owner's word on theirs.
        only_mine = self.say("Set %d aside" % mine)
        self.refused(self.move(mine, section="later", note=note, actor="agent-a", because_message_id=only_mine), "OWNER_PLACED",
                     "owner placed %d at %s, so it moves only on owner's word, and %s is not that: it does not name %d, nor reply to a "
                     "message that proposes moving %d to Later. Nothing moved." % (theirs, placed, only_mine, theirs, theirs))
        # Nor does a go-ahead lift the owner's word on a gated stage.
        self.rejected(self.move(held, section="later", note=note, actor="agent-a", because_message_id=self.say("Set %d aside" % held)), "STAGE_GATED")
        self.assertEqual(state(), before, "nothing moved")
        self.assertEqual({shown["id"]: shown["you_set_aside"] for shown in self.store.view("agent-a", "pipeline", {"workspace_id": "w1"})["pieces"]},
                         {piece: False, gated: False}, "the page offers only what needs no go-ahead")
        word = self.say("Go ahead, set %d aside to Later" % theirs)
        moved = self.committed(self.move(mine, section="later", note=note, actor="agent-a", because_message_id=word))
        self.assertEqual(moved["set_aside"]["numbers"], [mine, theirs])
        self.assertEqual(self.section("later")[:2], [mine, theirs])
        for number in (mine, theirs):
            [event] = [event for event in self.item(number)["events"] if event["seq"] == moved["set_aside"]["events"][str(number)]]
            self.assertEqual((event["payload"].get("go_ahead"), event["payload"]["because_message_id"], event["payload"]["set_aside"]["note"]),
                             ("owner", word, note))
            self.assertEqual((self.item(number)["placed"].get("go_ahead"), self.item(number)["placed"]["set_aside"]["piece"]), ("owner", piece))
        self.assertEqual(self.sql("SELECT left_outcome,left_note,left_by FROM pipeline_stage_entries WHERE piece_id=?", (piece,)),
                         [("dropped", "Set aside: " + note, "agent-a")])

    def test_a_set_aside_on_a_word_records_no_go_ahead_where_the_owner_placed_nothing_or_moved_it_themselves(self):
        self.stages({"stage_id": "build", "name": "Build", "rounds": "together"})
        numbers = [self.add("Now %d" % n, section="now", actor="agent-a", size="small") for n in (1, 2)]
        start = lambda number: self.committed(self.command("pipeline.piece_start", {"numbers": [number], "topic_id": "t1", "stage_id": "build"},
                                                            {"workspace_id": "w1"}, actor="agent-a"))
        for number, actor in zip(numbers, ("agent-a", "owner")):
            with self.subTest(actor=actor):
                start(number)
                word = self.say("Set %d aside" % number)
                moved = self.committed(self.move(number, section="later", note="Later", actor=actor, because_message_id=word))
                payload = json.loads(self.sql("SELECT payload FROM pipeline_events WHERE seq=?", (moved["event"],))[0][0])
                self.assertEqual((payload["because_message_id"], payload.get("go_ahead"), payload["set_aside"]["numbers"]), (word, None, [number]))


if __name__ == "__main__":
    unittest.main()

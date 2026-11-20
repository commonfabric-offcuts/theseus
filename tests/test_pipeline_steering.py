from __future__ import annotations

"""An outcome's pipeline (item 84; docs/pipeline.md): turning it on, adding and
editing items, steering them, the owner's placements, and what each reader sees.

w1 is owner's outcome; agent-a is its coordinator and agent-b a member;
other-reader and outsider are on no team. t1 is w1's topic, with agent-a in it."""

import unittest

from reader_fixture import ReaderCase


class PipelineCase(ReaderCase):
    def build_topic(self, topic_id, title="Piece work"):
        # Reuse the public agent-opening fixture; a person's writing topic
        # stays separate from the topic a new piece is built in (632).
        from test_build_topics import BuildTopicsCase
        return BuildTopicsCase.topic(self, topic_id, title)

    def on(self, actor="owner", **settings):
        current = self.store.view(actor, "pipeline", {"workspace_id": "w1", "limit": 1}).get("pipeline")
        return self.command("pipeline.configure", dict({"enabled": True}, **settings), {"workspace_id": "w1"},
                            {"pipeline_revision": current["version"] if current else 0}, actor=actor)

    def add(self, title, section="next", actor="owner", sources=None, **args):
        receipt = self.command("pipeline.item_add", dict({"title": title, "section": section, "sources": sources or [{"note": "a test"}]}, **args),
                               {"workspace_id": "w1"}, actor=actor)
        return self.committed(receipt)["number"]

    def item(self, number, actor="owner"):
        answer = self.store.view(actor, "pipeline_item", {"workspace_id": "w1", "number": number})
        self.assertNotIn("error", answer, answer)
        return answer["item"]

    def move(self, number, actor="owner", **args):
        return self.command("pipeline.item_move", args, {"workspace_id": "w1", "number": number},
                            {"item_revision": self.item(number)["version"]}, actor=actor)

    def edit(self, number, actor="owner", **args):
        return self.command("pipeline.item_edit", args, {"workspace_id": "w1", "number": number},
                            {"item_revision": self.item(number)["version"]}, actor=actor)

    def section(self, name, actor="owner"):
        answer = self.store.view(actor, "pipeline", {"workspace_id": "w1", "section": name, "limit": 100})
        self.assertNotIn("error", answer, answer)
        return [item["number"] for item in answer["items"]]

    def positions(self):
        return self.sql("SELECT section,candidate_group,position,number FROM pipeline_items WHERE workspace_id='w1' ORDER BY section,candidate_group,position")

    def post(self, body, actor="agent-a", topic="t1", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), {"topic_id": topic}, actor=actor))["message_id"]

    def stages(self, *stages, actor="owner"):
        current = self.store.view(actor, "pipeline", {"workspace_id": "w1", "limit": 1})["pipeline"]
        return self.committed(self.command("pipeline.stages_set", {"stages": list(stages)}, {"workspace_id": "w1"},
                                           {"pipeline_revision": current["version"]}, actor=actor))


class TurningItOnCase(PipelineCase):
    def test_the_owner_turns_it_on_with_the_defaults_in_one_act(self):
        self.assertIsNone(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pipeline"])
        self.committed(self.on())
        shape = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pipeline"]
        self.assertEqual({key: shape[key] for key in ("enabled", "title", "unit_one", "unit_many", "sized", "ships_in_releases", "you_own", "you_steer")},
                         {"enabled": True, "title": "Pipeline", "unit_one": "item", "unit_many": "items", "sized": True,
                          "ships_in_releases": False, "you_own": True, "you_steer": True})
        self.assertEqual(self.store.view("owner", "pipeline_row", {"workspace_id": "w1"})["pipeline"]["title"], "Pipeline")

    def test_the_coordinator_turns_it_on_and_off_with_the_owner(self):
        # Tony, asked whether fable may steer the pipeline with him: the
        # coordinator turns it on or off too, and the settings stay the owner's.
        self.assertEqual(self.on(actor="agent-a")["status"], "committed", "the coordinator turns it on")
        self.assertEqual(self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pipeline"]["title"], "Pipeline")
        self.assertEqual(self.committed(self.on(actor="agent-a", enabled=False))["enabled"], False)
        self.assertIsNone(self.store.view("owner", "pipeline_row", {"workspace_id": "w1"})["pipeline"])
        # While it is off, the page and the outcome's line offer Turn on to whoever steers.
        answer = self.store.view("agent-a", "pipeline", {"workspace_id": "w1"})
        self.assertEqual((answer["pipeline"]["you_own"], answer["pipeline"]["you_steer"]), (False, True))
        self.assertEqual(self.store.view("agent-a", "pipeline_row", {"workspace_id": "w1"}).get("you_steer"), True)
        self.assertEqual(self.store.view("agent-b", "pipeline_row", {"workspace_id": "w1"}).get("you_steer"), False)

    def test_before_any_pipeline_exists_the_answer_says_who_may_turn_it_on(self):
        for actor, steer in (("owner", True), ("agent-a", True), ("agent-b", False)):
            with self.subTest(actor=actor):
                answer = self.store.view(actor, "pipeline", {"workspace_id": "w1"})
                self.assertEqual((answer["pipeline"], answer.get("you_steer")), (None, steer))
                self.assertEqual(self.store.view(actor, "pipeline_row", {"workspace_id": "w1"}).get("you_steer"), steer)

    def test_only_the_owner_changes_the_settings_and_a_member_does_neither(self):
        self.committed(self.on())
        before = self.sql("SELECT * FROM pipelines")
        for actor, settings in (("agent-a", {"title": "Renamed"}), ("agent-a", {"sized": False}),
                                ("agent-a", {"ships_in_releases": True}), ("agent-b", {}), ("agent-b", {"enabled": False})):
            with self.subTest(actor=actor, settings=settings):
                self.rejected(self.on(actor=actor, **settings), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT * FROM pipelines"), before)
        self.assertFalse(self.store.view("agent-b", "pipeline", {"workspace_id": "w1"})["pipeline"]["you_steer"])
        self.committed(self.on(title="Release pipeline", sized=False))
        self.assertEqual(self.sql("SELECT title,sized FROM pipelines"), [("Release pipeline", 0)])

    def test_a_stale_revision_is_refused_and_one_release_pipeline_per_instance(self):
        self.committed(self.on())
        self.rejected(self.command("pipeline.configure", {"enabled": True, "title": "Late"}, {"workspace_id": "w1"},
                                   {"pipeline_revision": 0}), "REVISION_CONFLICT")
        self.committed(self.on(ships_in_releases=True))
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second", "team": []}))
        self.rejected(self.command("pipeline.configure", {"enabled": True, "ships_in_releases": True}, {"workspace_id": "w2"},
                                   {"pipeline_revision": 0}), "RELEASES_TAKEN")


class AddingCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on())

    def test_numbers_count_up_and_are_never_used_again(self):
        self.assertEqual([self.add("Item %d" % n) for n in range(1, 6)], [1, 2, 3, 4, 5])
        self.committed(self.move(5, section="dropped"))
        self.assertEqual(self.add("After the drop"), 6)
        undo = self.item(5)["placed"]["event"]
        self.committed(self.move(5, undo_of=undo))
        self.assertEqual(self.section("next"), [1, 2, 3, 4, 5, 6], "Restore puts 5 back with its number")

    def test_an_item_says_where_it_came_from_and_a_message_names_who_raised_it(self):
        self.rejected(self.command("pipeline.item_add", {"title": "Nowhere", "sources": []}, {"workspace_id": "w1"}), "SOURCE_REQUIRED")
        message = self.post("Could the page say which release is live?", actor="agent-a")
        number = self.add("Say which release is live", section="candidates", sources=[{"message_id": message}], actor="owner")
        item = self.item(number)
        self.assertEqual(item["raised_by"], "agent-a", "the message's author raised it, not whoever added it")
        self.assertEqual(item["sources"]["shown"][0]["message_id"], message)
        self.assertEqual(self.item(self.add("From the page"))["raised_by"], "owner", "with only a note, whoever added it raised it")
        self.assertEqual(self.item(self.add("Found in review", raised_note="found in review"))["raised_by"], None)

    def test_a_size_is_optional_and_only_in_a_sized_pipeline(self):
        self.assertIsNone(self.item(self.add("Unsized for now"))["size"])
        self.assertEqual(self.item(self.add("Large one", size="large"))["size"], "large")
        self.rejected(self.command("pipeline.item_add", {"title": "Huge", "size": "huge", "sources": [{"note": "n"}]}, {"workspace_id": "w1"}), "INVALID_ARGUMENT")
        self.committed(self.on(sized=False))
        self.rejected(self.command("pipeline.item_add", {"title": "Sized", "size": "small", "sources": [{"note": "n"}]}, {"workspace_id": "w1"}), "INVALID_ARGUMENT")

    def test_any_member_adds_and_nobody_off_the_team_does_and_nothing_is_added_while_it_is_off(self):
        self.add("By a member", actor="agent-b")
        self.rejected(self.command("pipeline.item_add", {"title": "Outside", "sources": [{"note": "n"}]}, {"workspace_id": "w1"}, actor="outsider"), "FORBIDDEN")
        self.committed(self.on(enabled=False))
        self.rejected(self.command("pipeline.item_add", {"title": "Off", "sources": [{"note": "n"}]}, {"workspace_id": "w1"}), "PIPELINE_OFF")
        self.assertEqual(self.sql("SELECT number,title FROM pipeline_items"), [(1, "By a member")])

    def test_a_member_edits_words_and_size_and_only_the_steerers_change_who_raised_it(self):
        number = self.add("Words later", size="small")
        self.committed(self.edit(number, actor="agent-b", description="A sentence or two.", size=None))
        item = self.item(number)
        self.assertEqual((item["description"], item["size"]), ("A sentence or two.", None))
        self.rejected(self.edit(number, actor="agent-b", raised_by="agent-b"), "FORBIDDEN")
        self.committed(self.edit(number, actor="agent-a", raised_by="agent-b"))
        self.assertEqual(self.item(number)["raised_by"], "agent-b")
        edits = [event["payload"]["after"] for event in self.item(number)["events"] if event["kind"] == "edited"]
        self.assertEqual(edits, [{"description": "A sentence or two.", "size": None}, {"raised_by": "agent-b"}])

    def test_a_shipped_item_keeps_its_title_and_size(self):
        self.committed(self.on(ships_in_releases=True))
        number = self.add("Ships in 19")
        self.store.record_release({"release": 19, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [number], "source": "backfill"})
        self.rejected(self.edit(number, title="Renamed"), "ITEM_SHIPPED")
        self.rejected(self.move(number, section="later"), "ITEM_SHIPPED")
        self.assertEqual(self.item(number)["glyph"], "shipped")
        self.assertEqual(self.section("next"), [], "a shipped item leaves its section")


class SteeringCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on())

    def test_a_move_keeps_everyone_elses_order_and_touches_no_other_section(self):
        for n in range(1, 11):
            self.add("Next %d" % n)
        self.add("Later 11", section="later")
        later = [row for row in self.positions() if row[0] == "later"]
        self.committed(self.move(7, above=3))
        self.assertEqual(self.section("next"), [1, 2, 7, 3, 4, 5, 6, 8, 9, 10])
        self.committed(self.move(10, above=1))
        self.assertEqual(self.section("next"), [10, 1, 2, 7, 3, 4, 5, 6, 8, 9])
        self.committed(self.move(1, below=9))
        self.assertEqual(self.section("next"), [10, 2, 7, 3, 4, 5, 6, 8, 9, 1])
        positions = [row[2] for row in self.positions() if row[0] == "next"]
        self.assertEqual(len(positions), len(set(positions)), "no two items share a place")
        self.assertEqual([row for row in self.positions() if row[0] == "later"], later)
        self.committed(self.move(4, section="later"))
        self.assertEqual(self.section("later"), [11, 4], "a move to a section goes last in it")
        self.rejected(self.move(2, above=11), "INVALID_ARGUMENT")

    def test_undo_puts_it_back_once_and_never_after_a_later_move(self):
        for n in range(1, 5):
            self.add("Next %d" % n)
        event = self.committed(self.move(4, above=2))["event"]
        self.assertEqual(self.section("next"), [1, 4, 2, 3])
        self.committed(self.move(4, undo_of=event))
        self.assertEqual(self.section("next"), [1, 2, 3, 4])
        self.rejected(self.move(4, undo_of=event), "UNDO_STALE")
        first = self.committed(self.move(3, above=1))["event"]
        self.committed(self.move(3, section="later"))
        self.rejected(self.move(3, undo_of=first), "UNDO_STALE")
        self.assertEqual(self.section("later"), [3])

    def test_an_item_the_owner_placed_moves_only_when_the_owner_moves_it(self):
        for n in range(1, 4):
            self.add("Next %d" % n, actor="agent-a")
        self.committed(self.move(2, above=1, actor="owner"))
        # An edit does not place it: the owner's move is still the newest placement.
        self.committed(self.edit(2, actor="agent-a", description="Fable's words"))
        refused = self.move(2, below=3, actor="agent-a")
        self.rejected(refused, "OWNER_PLACED")
        self.assertIn("owner placed this item", refused["error"]["message"])
        self.assertIn("conversation", refused["error"]["message"])
        self.assertEqual(self.section("next"), [2, 1, 3])
        self.committed(self.move(3, above=1, actor="agent-a"))
        self.assertEqual(self.section("next"), [2, 3, 1])
        self.committed(self.move(2, below=1, actor="owner"))
        self.assertEqual(self.section("next"), [3, 1, 2])
        # An item the owner added is one the owner placed.
        mine = self.add("The owner's own", actor="owner")
        self.rejected(self.move(mine, section="later", actor="agent-a"), "OWNER_PLACED")
        self.rejected(self.move(mine, section="dropped", actor="agent-a"), "OWNER_PLACED")

    def test_only_the_owner_and_the_coordinator_steer(self):
        self.add("Next 1")
        self.add("Next 2", actor="agent-b")
        self.rejected(self.move(2, above=1, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.move(2, above=1, actor="outsider"), "FORBIDDEN")
        self.committed(self.move(2, above=1, actor="agent-a"))

    def test_dropping_an_item_being_built_asks_first_and_the_piece_ends_with_its_last_item(self):
        self.build_topic("piece-topic")
        self.stages({"stage_id": "build", "name": "Build"}, {"stage_id": "review", "name": "Review"})
        for n in range(1, 4):
            self.add("Now %d" % n, section="now", size="medium")
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1, 2, 3], "topic_id": "piece-topic", "stage_id": "build"},
                                            {"workspace_id": "w1"}))["piece_id"]
        refused = self.move(1, section="dropped")
        self.rejected(refused, "ITEM_UNDERWAY")
        self.assertEqual(self.item(1)["section"], "now")
        self.committed(self.move(1, section="dropped", underway_confirmed=True))
        self.assertEqual(self.item(1)["section"], "dropped")
        self.assertEqual(self.sql("SELECT stage_id,left_outcome FROM pipeline_stage_entries WHERE piece_id=?", (piece,)), [("build", None)],
                         "the piece goes on with the items it still holds")
        self.assertEqual((self.item(2)["piece"] or {}).get("id"), piece)
        self.assertEqual(self.sql("SELECT number FROM pipeline_piece_members WHERE piece_id=? AND left_ms IS NULL ORDER BY number", (piece,)), [(2,), (3,)])
        for number in (2, 3):
            self.committed(self.move(number, section="dropped", underway_confirmed=True))
        self.assertEqual(self.sql("SELECT stage_id,left_outcome FROM pipeline_stage_entries WHERE piece_id=?", (piece,)), [("build", "dropped")])


class WhatEachReaderSeesCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.add("Next 1")
        self.add("Next 2")

    def test_an_ask_about_an_item_waits_on_the_one_asked_until_they_answer(self):
        self.participation("agent-b", True)
        ask = self.post("@owner which first, 2 or 1?", actor="agent-a", addressees=["owner"], intent="ask",
                        subjects=[{"kind": "item", "ref": 2}])
        owner = self.store.view("owner", "pipeline", {"workspace_id": "w1"})
        self.assertEqual([(row["number"], row["message_id"], row["by"]) for row in owner["waiting"]], [(2, ask, "agent-a")])
        self.assertEqual({item["number"]: item["glyph"] for item in self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "next"})["items"]},
                         {1: "next", 2: "decide"})
        self.assertEqual(self.store.view("owner", "pipeline_row", {"workspace_id": "w1"})["pipeline"]["asks"], 1)
        # Someone else is not asked: the item is only Next to them.
        self.assertEqual([item["glyph"] for item in self.store.view("agent-b", "pipeline", {"workspace_id": "w1", "section": "next"})["items"]], ["next", "next"])
        self.assertEqual(self.store.view("agent-b", "pipeline", {"workspace_id": "w1"})["waiting"], [])
        # A tell about it asks nothing.
        self.post("2 is under way", actor="agent-a", addressees=["owner"], intent="tell", subjects=[{"kind": "item", "ref": 1}])
        self.assertEqual(self.item(1)["glyph"], "next")
        self.post("1 first", actor="owner", reply_to=ask)
        self.assertEqual(self.item(2)["glyph"], "next")
        self.assertEqual(self.store.view("owner", "pipeline_row", {"workspace_id": "w1"})["pipeline"]["asks"], 0)

    def test_a_subject_outside_the_pipeline_is_refused_and_no_message_is_written(self):
        count = self.sql("SELECT count(*) FROM messages")
        self.rejected(self.command("message.post", {"body": "About 99", "subjects": [{"kind": "item", "ref": 99}]}, {"topic_id": "t1"}, actor="agent-a"), "NOT_FOUND")
        self.rejected(self.command("message.post", {"body": "About a check", "subjects": [{"kind": "check", "ref": "x"}]}, {"topic_id": "t1"}, actor="agent-a"), "CHECK_UNKNOWN")
        self.rejected(self.command("message.post", {"body": "About a page", "subjects": [{"kind": "page", "ref": "x"}]}, {"topic_id": "t1"}, actor="agent-a"), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), count)
        self.assertEqual(self.sql("SELECT count(*) FROM message_subjects"), [(0,)])

    def test_a_source_in_a_topic_the_reader_cannot_open_shows_no_words(self):
        # The owner's second outcome, whose team is only the owner.
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Private", "team": []}))
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w2"}
        self.committed(self.save_draft("private-draft", source, "t2", "A private thought", opening={"workspace_id": "w2", "title": "Private topic", "participants": []}))
        self.committed(self.prepare("private-draft", "t2", submission="private", send_op="open-private"))
        message = self.committed(self.command("topic.create_and_send", {"submission_id": "private"}, target={"topic_id": "t2"}, op="open-private"))["message_id"]
        number = self.add("From a private thought", sources=[{"message_id": message}, {"note": "and a note"}])
        mine = self.item(number)["sources"]
        self.assertEqual([(s["kind"], s.get("readable"), s.get("topic_title")) for s in mine["shown"]], [("message", True, "Private topic"), ("note", None, None)])
        theirs = self.item(number, actor="agent-b")["sources"]
        self.assertEqual(theirs["shown"][0], {"kind": "message", "readable": False})
        self.assertEqual(theirs["topics"], [], "nor the name of its topic")
        self.assertEqual(theirs["count"], 2)
        # Nor can someone add a source they cannot open.
        self.rejected(self.command("pipeline.item_add", {"title": "Borrowed", "sources": [{"message_id": message}]}, {"workspace_id": "w1"}, actor="agent-a"), "FORBIDDEN")

    def test_each_message_source_is_shown_by_whether_the_reader_can_open_that_message(self):
        # Core grants reading per message: agent-b, taken out of a topic of
        # another outcome, still opens the one message that named them there,
        # and no other message in that topic, whichever comes first.
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "team": []}))
        source = {"kind": "new_topic", "id": "opening-tx", "workspace_id": "w2"}
        self.committed(self.save_draft("tx-draft", source, "tx", "Opening tx", opening={"workspace_id": "w2", "title": "Topic tx", "participants": ["agent-b"]}))
        self.committed(self.prepare("tx-draft", "tx", submission="tx-sub", send_op="open-tx"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "tx-sub"}, target={"topic_id": "tx"}, op="open-tx"))
        named = self.post("@agent-b this one is for you", actor="owner", topic="tx", addressees=["agent-b"])
        other = self.post("And this one is for nobody in particular", actor="owner", topic="tx")
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": False}, target={"topic_id": "tx"}))
        self.assertEqual(self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": named}})["source_ref"]["id"], named)
        self.assertIn("error", self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": other}}))
        for order in ((named, other), (other, named)):
            with self.subTest(first=order[0] == named and "named" or "other"):
                number = self.add("From tx", sources=[{"message_id": message} for message in order])
                shown = {entry.get("message_id"): entry for entry in self.item(number, actor="agent-b")["sources"]["shown"]}
                self.assertEqual(shown.get(named, {}).get("readable"), True, "the message that named agent-b is shown to them")
                self.assertEqual(set(shown), {named, None}, "the other is not, nor its id")
                self.assertEqual(shown[None], {"kind": "message", "readable": False})
        # And what the view shows is what Core lets agent-b take as a source.
        self.add("Named to b", sources=[{"message_id": named}], actor="agent-b")
        self.rejected(self.command("pipeline.item_add", {"title": "Not to b", "sources": [{"message_id": other}]}, {"workspace_id": "w1"}, actor="agent-b"), "FORBIDDEN")

    def test_the_outcome_light_reads_the_pipelines_now_items(self):
        lead = lambda: self.store.view("owner", "outcome_light", {"workspace_id": "w1"})["lead"]
        self.assertEqual(lead(), {"kind": "now_quiet", "of": 0, "ever": False}, "Next items alone are nothing under way")
        self.add("Now 3", section="now")
        self.add("Now 4", section="now")
        self.assertEqual(lead(), {"kind": "now_quiet", "of": 2, "ever": False})
        self.committed(self.on(enabled=False))
        self.assertEqual(lead()["kind"], "topics_quiet", "a pipeline turned off says nothing")

if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""A pipeline's stages and the pieces of work that move through them (item 84;
docs/pipeline.md): starting a piece, entering stages in rounds, a stage gated on
the owner's word, combining pieces into a release, finishing, and changing the
stages without losing past times."""

import unittest

from test_pipeline_steering import PipelineCase


STAGES = ({"stage_id": "build", "name": "Build", "rounds": "together"},
          {"stage_id": "review", "name": "Review", "rounds": "split"},
          {"stage_id": "wait", "name": "Wait"},
          {"stage_id": "tony-reads", "name": "Tony reads it", "gate": {"owner": True, "words": "Tony says when"}})


class StagesCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages(*STAGES)
        for n in range(1, 4):
            self.add("Now %d" % n, section="now", size=("small", "large", "medium")[n - 1])
        self.add("Next 4")

    def start(self, numbers=(1, 2), stage="build", topic="t1", actor="owner", **args):
        return self.command("pipeline.piece_start", dict({"numbers": list(numbers), "topic_id": topic, "stage_id": stage}, **args),
                            {"workspace_id": "w1"}, actor=actor)

    def enter(self, piece, stage, actor="owner", **args):
        return self.command("pipeline.stage_enter", dict({"stage_id": stage, "left_outcome": "approved"}, **args), {"piece_id": piece}, actor=actor)

    def entries(self, piece):
        return self.sql("SELECT stage_id,round,left_outcome,left_ms IS NOT NULL FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq", (piece,))

    def topic(self, topic_id, title="Another topic"):
        source = {"kind": "new_topic", "id": "opening-" + topic_id, "workspace_id": "w1"}
        self.committed(self.save_draft("draft-" + topic_id, source, topic_id, "Opening " + title,
                                       opening={"workspace_id": "w1", "title": title, "participants": ["agent-a"]}))
        self.committed(self.prepare("draft-" + topic_id, topic_id, submission="sub-" + topic_id, send_op="open-" + topic_id))
        self.committed(self.command("topic.create_and_send", {"submission_id": "sub-" + topic_id}, target={"topic_id": topic_id}, op="open-" + topic_id))

    def test_a_piece_starts_only_on_now_items_not_already_in_work_in_a_topic_of_this_outcome(self):
        before = self.sql("SELECT count(*) FROM pipeline_pieces")
        self.rejected(self.start(numbers=(1, 4)), "NOT_IN_NOW")
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_pieces"), before, "nothing written")
        self.rejected(self.start(stage="nowhere"), "STAGE_UNKNOWN")
        piece = self.committed(self.start())
        self.assertEqual((piece["numbers"], piece["stage_id"]), ([1, 2], "build"))
        self.rejected(self.start(numbers=(2, 3)), "ITEM_IN_PIECE")
        self.rejected(self.start(numbers=(3,)), "TOPIC_HAS_PIECE")
        # The piece is as large as its largest item, and Now shows it being built.
        now = self.store.view("owner", "pipeline", {"workspace_id": "w1"})
        [shown] = now["pieces"]
        self.assertEqual((shown["items"], shown["size"], shown["stage"]["name"], shown["ahead"]),
                         ([1, 2], "large", "Build, round 1", ["Review", "Wait", "Tony reads it"]))
        self.assertEqual({item["number"]: item["glyph"] for item in now["items"]}, {1: "building", 2: "building", 3: "idle"})
        self.assertEqual(now["facts"]["building"], {"items": [1, 2], "pieces": 1})

    def test_entering_a_stage_closes_the_last_one_in_the_same_act_and_rounds_follow_the_stage(self):
        piece = self.committed(self.start())["piece_id"]
        self.committed(self.enter(piece, "build", round=2, left_outcome="sent back"))
        self.rejected(self.enter(piece, "build", round=2), "INVALID_ARGUMENT")
        self.committed(self.enter(piece, "review"))
        self.committed(self.enter(piece, "review", round=2, left_outcome="sent back"))
        self.committed(self.enter(piece, "wait"))
        self.rejected(self.enter(piece, "wait", round=2), "INVALID_ARGUMENT")
        self.assertEqual(self.entries(piece), [("build", 1, "sent back", 1), ("build", 2, "approved", 1), ("review", 1, "sent back", 1),
                                               ("review", 2, "approved", 1), ("wait", 1, None, 0)])
        # Each round reads by its stage's setting: every round named, or only the later ones.
        names = [entry["name"] for entry in self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pieces"][0]["stages_so_far"]]
        self.assertEqual(names, ["Build, round 1", "Build, round 2", "Review", "Review, round 2"])
        self.rejected(self.enter(piece, "review", left_outcome="finished"), "INVALID_ARGUMENT")

    def test_a_stage_on_the_owners_word_needs_an_ask_and_only_the_owner_leaves_it(self):
        piece = self.committed(self.start())["piece_id"]
        self.rejected(self.enter(piece, "tony-reads", actor="agent-a"), "ASK_REQUIRED")
        tell = self.post("Ready for you", actor="agent-a", addressees=["owner"], intent="tell")
        self.rejected(self.enter(piece, "tony-reads", actor="agent-a", ask_message_id=tell), "ASK_REQUIRED")
        ask = self.post("@owner would you read 1 and 2?", actor="agent-a", addressees=["owner"], intent="ask")
        self.committed(self.enter(piece, "tony-reads", actor="agent-a", ask_message_id=ask))
        shown = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pieces"][0]["stage"]
        self.assertEqual((shown["owner_gate"], shown["you_leave_it"], shown["gate_words"]), (True, True, "Tony says when"))
        self.assertFalse(self.store.view("agent-a", "pipeline", {"workspace_id": "w1"})["pieces"][0]["stage"]["you_leave_it"])
        self.rejected(self.enter(piece, "wait", actor="agent-a", left_outcome="passed"), "STAGE_GATED")
        self.committed(self.enter(piece, "wait", actor="owner", left_outcome="passed"))
        self.assertEqual(self.entries(piece)[-2:], [("tony-reads", 1, "passed", 1), ("wait", 1, None, 0)])

    def test_only_the_owner_gives_or_takes_off_their_word_on_a_stage(self):
        # A stage that waits on the owner's word stays the owner's: the
        # coordinator steers the stages with them but cannot take the word
        # off a stage, remove such a stage, or give the owner's word to one.
        set_by = lambda actor, stages: self.command("pipeline.stages_set", {"stages": list(stages)}, {"workspace_id": "w1"}, actor=actor)
        piece = self.committed(self.start())["piece_id"]
        ask = self.post("@owner would you read 1 and 2?", actor="agent-a", addressees=["owner"], intent="ask")
        self.committed(self.enter(piece, "tony-reads", actor="agent-a", ask_message_id=ask))
        self.rejected(self.enter(piece, "wait", actor="agent-a", left_outcome="passed"), "STAGE_GATED")
        kept = lambda: self.sql("SELECT stage_id,position,gate FROM pipeline_stages ORDER BY stage_id")
        before = kept()
        without = dict(STAGES[3], gate={"owner": False, "words": "Tony says when"})
        for name, stages in (("the word taken off", STAGES[:3] + (without,)),
                             ("the stage removed", STAGES[:3]),
                             ("the word given to another stage", (STAGES[0], STAGES[1], dict(STAGES[2], gate={"owner": True}), STAGES[3])),
                             ("a new stage on the word", STAGES + ({"stage_id": "sign", "name": "Sign off", "gate": {"owner": True}},))):
            with self.subTest(name):
                refused = set_by("agent-a", stages)
                self.rejected(refused, "FORBIDDEN")
                self.assertIn("owner", refused["error"]["message"])
        self.assertEqual(kept(), before, "nothing changed")
        self.rejected(self.enter(piece, "wait", actor="agent-a", left_outcome="passed"), "STAGE_GATED")
        self.assertEqual(self.entries(piece)[-1], ("tony-reads", 1, None, 0), "the piece waits on the owner still")
        # The rest of the stages are the coordinator's to change: a name, the order, a new stage.
        self.committed(set_by("agent-a", (dict(STAGES[3], name="Tony reads"),) + STAGES[:3] + ({"stage_id": "polish", "name": "Polish"},)))
        # A stage the owner retired with a piece in it keeps the owner's word, and the coordinator cannot bring it back without.
        self.stages(*STAGES[:3])
        self.rejected(set_by("agent-a", STAGES[:3] + (without,)), "FORBIDDEN")
        self.rejected(self.enter(piece, "wait", actor="agent-a", left_outcome="passed"), "STAGE_GATED")
        # The owner gives and takes off their own word.
        self.stages(*STAGES[:3], without)
        self.committed(self.enter(piece, "wait", actor="agent-a", left_outcome="passed"))
        self.stages(*STAGES)
        self.assertEqual([stage["gate"].get("owner", False) for stage in self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pipeline"]["stages"]],
                         [False, False, False, True])

    def test_undo_that_would_drop_an_item_being_built_asks_first_like_any_drop(self):
        drop = self.committed(self.move(3, section="dropped"))["event"]
        restore = self.committed(self.move(3, undo_of=drop))["event"]
        self.assertEqual(self.item(3)["section"], "now")
        piece = self.committed(self.start(numbers=(3,)))["piece_id"]
        refused = self.move(3, undo_of=restore)
        self.rejected(refused, "ITEM_UNDERWAY")
        self.assertEqual((self.item(3)["section"], self.entries(piece)), ("now", [("build", 1, None, 0)]), "nothing changed")
        self.committed(self.move(3, undo_of=restore, underway_confirmed=True))
        self.assertEqual((self.item(3)["section"], self.entries(piece)), ("dropped", [("build", 1, "dropped", 1)]))

    def test_an_item_being_built_stays_in_now_until_it_is_dropped(self):
        # D26: Now always holds every piece's items, so the light's work in Now covers them.
        to_now = self.committed(self.move(4, section="now"))["event"]
        self.committed(self.start(numbers=(4,), size="small"))
        for section in ("next", "later", "candidates"):
            for confirmed in (False, True):
                with self.subTest(section=section, confirmed=confirmed):
                    refused = self.move(4, section=section, **({"underway_confirmed": True} if confirmed else {}))
                    self.rejected(refused, "ITEM_IN_PIECE")
                    self.assertIn("being built", refused["error"]["message"])
        self.rejected(self.move(4, undo_of=to_now), "ITEM_IN_PIECE")
        self.assertEqual((self.item(4)["section"], 4 in self.section("now"), self.section("next")), ("now", True, []))
        # It is still ordered within Now, and an item not being built still moves out.
        self.committed(self.move(4, above=1))
        self.committed(self.move(3, section="later"))
        self.assertEqual((self.section("now"), self.section("later")), ([4, 1, 2], [3]))

    def test_finishing_a_piece_marks_its_items_done_and_a_release_pipeline_finishes_by_its_record(self):
        piece = self.committed(self.start())["piece_id"]
        self.committed(self.command("pipeline.piece_finish", {"note": "done"}, {"piece_id": piece}))
        self.assertEqual(self.entries(piece), [("build", 1, "done", 1)])
        self.assertEqual(self.item(1)["glyph"], "shipped")
        self.assertEqual(self.section("now"), [3])
        done = self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "shipped"})["groups"]
        self.assertEqual([(group["label"], [item["number"] for item in group["items"]]) for group in done], [("Done", [1, 2])])
        self.rejected(self.command("pipeline.piece_finish", {}, {"piece_id": piece}), "PIECE_CLOSED")
        self.committed(self.on(ships_in_releases=True))
        other = self.committed(self.start(numbers=(3,)))["piece_id"]
        self.rejected(self.command("pipeline.piece_finish", {}, {"piece_id": other}), "RELEASE_PIPELINE_SHIPS_BY_RECORD")

    def test_combining_pieces_into_a_release_moves_their_items_and_keeps_their_topics_open(self):
        self.committed(self.on(ships_in_releases=True))
        self.stages(*STAGES, {"stage_id": "checks", "name": "Release checks", "scope": "release"})
        self.topic("t2")
        first = self.committed(self.start())["piece_id"]
        second = self.committed(self.start(numbers=(3,), topic="t2"))["piece_id"]
        release = self.committed(self.command("pipeline.combine", {"release_number": 23, "piece_ids": [first, second], "topic_id": "t1"}, {"workspace_id": "w1"}))
        self.assertEqual(release["numbers"], [1, 2, 3])
        self.assertEqual(self.entries(first), [("build", 1, "combined", 1)])
        self.assertEqual(self.entries(second), [("build", 1, "combined", 1)])
        self.assertEqual(self.entries(release["piece_id"]), [("checks", 1, None, 0)])
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id IN ('t1','t2') ORDER BY id"), [("active",), ("active",)])
        now = self.store.view("owner", "pipeline", {"workspace_id": "w1"})
        self.assertEqual((now["facts"]["next_release"]["release"], now["facts"]["next_release"]["items"]), (23, [1, 2, 3]))
        self.assertEqual(now["pieces"], [], "the work pieces are in the release now")
        # Once the release is recorded, its items have shipped and its piece is no longer open.
        self.store.record_release({"release": 23, "commit": "5" * 40, "deployed_at": "2026-11-07T05:28:35-08:00", "items": [1, 2, 3], "source": "deploy"})
        now = self.store.view("owner", "pipeline", {"workspace_id": "w1"})
        self.assertEqual((now["facts"]["next_release"], now["banner"]["release"], now["items"]), (None, 23, []))
        self.rejected(self.command("pipeline.combine", {"release_number": 23, "piece_ids": [first], "topic_id": "t1"}, {"workspace_id": "w1"}), "RELEASE_EXISTS")

    def test_changing_the_stages_keeps_past_entries_with_the_stage_they_were_in(self):
        piece = self.committed(self.start())["piece_id"]
        self.committed(self.enter(piece, "review"))
        renamed = [dict(STAGES[0], name="Make it"), dict(STAGES[1], name="Read it")] + list(STAGES[2:])
        self.stages(*renamed)
        shown = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pieces"][0]
        self.assertEqual(([entry["name"] for entry in shown["stages_so_far"]], shown["stage"]["name"]), (["Make it, round 1"], "Read it"))
        # Retiring a stage keeps the entries made in it, and a new piece cannot start there.
        self.stages(renamed[1], renamed[2])
        shown = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pieces"][0]
        self.assertEqual([entry["stage_id"] for entry in shown["stages_so_far"]], ["build"])
        self.topic("t2")
        self.rejected(self.start(numbers=(3,), stage="build", topic="t2"), "STAGE_UNKNOWN")
        self.committed(self.start(numbers=(3,), stage="wait", topic="t2"))
        events = self.sql("SELECT kind,by FROM pipeline_events WHERE kind='stages' ORDER BY seq")
        self.assertEqual(events, [("stages", "owner")] * 3)
        self.rejected(self.command("pipeline.stages_set", {"stages": []}, {"workspace_id": "w1"}), "INVALID_ARGUMENT")
        self.rejected(self.command("pipeline.stages_set", {"stages": [STAGES[0], STAGES[0]]}, {"workspace_id": "w1"}), "INVALID_ARGUMENT")
        self.rejected(self.command("pipeline.stages_set", {"stages": [STAGES[0]]}, {"workspace_id": "w1"}, actor="agent-b"), "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()

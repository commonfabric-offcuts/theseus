from __future__ import annotations

"""Now's pieces, nearest to live first (item 567; docs/pipeline.md, "Now's order"):
pieces waiting to combine, then in Review, then in Build, then any earlier
stage; within a stage, by when the piece started, earliest first. The pipeline
view sorts them once, and the page and the CLI draw that order. The item lists
keep their own placed order: Now's items not in a piece, Next and Later."""

import unittest
from unittest import mock

from aim_next import outcome_rules
from test_pipeline_steering import PipelineCase

MIN = 60000
STAGES = ({"stage_id": "build", "name": "Build", "rounds": "split"},
          {"stage_id": "review", "name": "Review", "rounds": "together"},
          {"stage_id": "wait", "name": "Waits to combine"})


class NowOrderRuleCase(unittest.TestCase):
    """The rule alone, on piece views as the pipeline view makes them."""

    @staticmethod
    def piece(name, stage, started):
        return {"id": name, "stage": {"stage_id": stage} if stage else None, "started": {"ms": started} if started is not None else None}

    def test_a_later_stage_comes_first_and_within_a_stage_the_earliest_start(self):
        pieces = [self.piece("build-old", "build", 1), self.piece("review-new", "review", 9), self.piece("wait", "wait", 5),
                  self.piece("review-old", "review", 3), self.piece("build-new", "build", 7)]
        self.assertEqual([piece["id"] for piece in outcome_rules.now_order(pieces, ["build", "review", "wait"])],
                         ["wait", "review-old", "review-new", "build-old", "build-new"])

    def test_a_stage_no_longer_in_the_list_comes_after_every_current_one_and_equal_starts_keep_the_order_given(self):
        # A retired stage's place is not known, so it is not read as near to live; two pieces started in the same
        # millisecond keep the order they were handed in (the pipeline view hands them in the order they were made).
        pieces = [self.piece("retired", "polish", 1), self.piece("first", "build", 4), self.piece("second", "build", 4),
                  self.piece("no-stage", None, None)]
        self.assertEqual([piece["id"] for piece in outcome_rules.now_order(pieces, ["build", "review"])],
                         ["first", "second", "retired", "no-stage"])
        self.assertEqual([piece["id"] for piece in outcome_rules.now_order(list(reversed(pieces[1:3])), ["build"])], ["second", "first"])


class NowOrderCase(PipelineCase):
    """Pieces started in the order Build, Waits to combine, Review, Review, through Core's commands at a held clock."""

    def setUp(self):
        super().setUp()
        self.clock = [1_800_000_000_000]
        patch = mock.patch("aim_next.pipeline._now_ms", side_effect=lambda: self.clock[0])
        patch.start()
        self.addCleanup(patch.stop)
        self.committed(self.on())
        self.stages(*STAGES)
        for topic in ("t2", "t3", "t4"):
            self.topic(topic)
        # Now: 1 to 4 will each be a piece, 5 sits between them and is never started.
        for title in ("Built first", "Waits", "Reviewed third", "Not started", "Reviewed fourth"):
            self.add(title, section="now", size="small")
        for title in ("Next 6", "Next 7", "Next 8"):
            self.add(title, section="next")
        for title in ("Later 9", "Later 10"):
            self.add(title, section="later")
        self.committed(self.move(8, above=6))
        self.committed(self.move(10, above=9))

    def topic(self, topic_id):
        source = {"kind": "new_topic", "id": "opening-" + topic_id, "workspace_id": "w1"}
        self.committed(self.save_draft("draft-" + topic_id, source, topic_id, "Opening " + topic_id,
                                       opening={"workspace_id": "w1", "title": "Topic " + topic_id, "participants": ["agent-a"]}))
        self.committed(self.prepare("draft-" + topic_id, topic_id, submission="sub-" + topic_id, send_op="open-" + topic_id))
        self.committed(self.command("topic.create_and_send", {"submission_id": "sub-" + topic_id}, target={"topic_id": topic_id}, op="open-" + topic_id))

    def at(self, minute, receipt_of):
        self.clock[0] = 1_800_000_000_000 + minute * MIN
        return self.committed(receipt_of())

    def start(self, number, topic):
        return self.command("pipeline.piece_start", {"numbers": [number], "topic_id": topic, "stage_id": "build"}, {"workspace_id": "w1"})

    def enter(self, piece, stage, **args):
        return self.command("pipeline.stage_enter", dict({"stage_id": stage, "left_outcome": "approved"}, **args), {"piece_id": piece})

    def now(self):
        return self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "now", "limit": 100})

    def test_now_lists_waits_to_combine_then_review_by_start_then_build_whenever_each_entered_its_stage(self):
        built = self.at(1, lambda: self.start(1, "t1"))["piece_id"]
        waits = self.at(2, lambda: self.start(2, "t2"))["piece_id"]
        third = self.at(3, lambda: self.start(3, "t3"))["piece_id"]
        fourth = self.at(4, lambda: self.start(5, "t4"))["piece_id"]
        self.at(5, lambda: self.enter(waits, "review"))
        self.at(6, lambda: self.enter(waits, "wait"))
        # The later-started piece enters Review first: within Review the order is by start, not by entering it.
        self.at(7, lambda: self.enter(fourth, "review"))
        self.at(8, lambda: self.enter(third, "review"))
        # The oldest piece is sent back after every other moved: it entered its current stage last, and stays last.
        self.at(9, lambda: self.enter(built, "build", round=2, left_outcome="sent back"))
        answer = self.now()
        self.assertEqual([(piece["id"], piece["stage"]["stage_id"]) for piece in answer["pieces"]],
                         [(waits, "wait"), (third, "review"), (fourth, "review"), (built, "build")])
        self.assertEqual([piece["started"]["ms"] for piece in answer["pieces"][1:3]], [1_800_000_000_000 + 3 * MIN, 1_800_000_000_000 + 4 * MIN])
        self.assertEqual(answer["facts"]["building"]["items"], [2, 3, 5, 1], "the head's Being built names them in the same order")
        # What must not move: Now's items keep their placed order (4 is not in a piece and keeps its place among them),
        # and Next and Later keep theirs.
        self.assertEqual([item["number"] for item in answer["items"]], [1, 2, 3, 4, 5])
        self.assertEqual(self.section("next"), [8, 6, 7])
        self.assertEqual(self.section("later"), [10, 9])


if __name__ == "__main__":
    unittest.main()

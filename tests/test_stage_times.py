from __future__ import annotations

"""How long a stage typically takes (item 84, D2): the median of the newest
finished visits of the same stage, size and round class in the same outcome,
and the words for too few."""

import sqlite3
import unittest

from aim_next import outcome_rules
from test_pipeline_steering import PipelineCase

MIN = 60000


class TypicalRuleCase(unittest.TestCase):
    def test_too_few_a_loose_number_and_a_number(self):
        self.assertEqual(outcome_rules.typical([10 * MIN, 20 * MIN], "size"), {"too_few": 2, "min": 3})
        self.assertEqual(outcome_rules.typical([30 * MIN, 10 * MIN, 20 * MIN], "size"), {"ms": 20 * MIN, "of": 3, "basis": "size", "loose": True})
        self.assertEqual(outcome_rules.typical([MIN * n for n in (5, 1, 4, 2, 3)], "release")["loose"], False)

    def test_only_the_newest_twenty_and_the_even_median_is_the_middle_twos_mean(self):
        newest_first = [100 * MIN] * 20 + [1 * MIN] * 5
        self.assertEqual(outcome_rules.typical(newest_first, "size"), {"ms": 100 * MIN, "of": 20, "basis": "size", "loose": False})
        self.assertEqual(outcome_rules.typical([10 * MIN, 20 * MIN, 30 * MIN, 41 * MIN], "outcome")["ms"], 25 * MIN)

    def test_a_stage_reads_by_its_rounds(self):
        self.assertEqual([outcome_rules.stage_name("Build", rounds, n) for rounds in ("none", "together", "split") for n in (1, 2)],
                         ["Build", "Build", "Build, round 1", "Build, round 2", "Build", "Build, round 2"])


class TypicalReadCase(PipelineCase):
    """Past visits written as finished entries: the ones that count, and the ones beside them that must not."""

    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages({"stage_id": "build", "name": "Build", "rounds": "split"}, {"stage_id": "review", "name": "Review", "rounds": "together"})
        self.add("Now 1", section="now", size="large")
        self.piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t1", "stage_id": "build"},
                                                 {"workspace_id": "w1"}))["piece_id"]
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second", "team": []}))
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO pipeline_pieces VALUES ('p-past','w1','piece','t1',NULL,NULL,1)")
            db.execute("INSERT INTO pipeline_pieces VALUES ('p-else','w2','piece','t1',NULL,NULL,1)")

    def past(self, minutes, stage="build", size="large", round_number=1, workspace="w1", outcome="approved"):
        piece = "p-past" if workspace == "w1" else "p-else"
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO pipeline_stage_entries(piece_id,workspace_id,stage_id,round,size,entered_ms,entered_by,left_ms,left_outcome) "
                       "VALUES (?,?,?,?,?,1000,'owner',?,?)", (piece, workspace, stage, round_number, size, 1000 + minutes * MIN, outcome))

    def typical(self):
        return self.store.view("owner", "pipeline", {"workspace_id": "w1"})["pieces"][0]["stage"]["typical"]

    def test_only_this_stage_size_round_class_and_outcome_count(self):
        self.assertEqual(self.typical(), {"too_few": 0, "min": 3})
        for minutes in (10, 20, 30):
            self.past(minutes)
        # Beside them: another size, another stage, a later round of a split stage, a drop, another outcome.
        self.past(500, size="small")
        self.past(500, stage="review")
        self.past(500, round_number=2)
        self.past(500, outcome="dropped")
        self.past(500, workspace="w2")
        self.assertEqual(self.typical(), {"ms": 20 * MIN, "of": 3, "basis": "size", "loose": True})
        rows = self.store.view("owner", "pipeline", {"workspace_id": "w1"})["stage_times"]["rows"]
        self.assertEqual([(row["label"], row["later_rounds"]) for row in rows],
                         [("Build", False), ("Build, each later round", True), ("Review, each round", False)])
        self.assertEqual(rows[0]["cells"]["large"]["ms"], 20 * MIN)
        self.assertEqual(rows[0]["cells"]["small"], {"too_few": 1, "min": 3})
        self.assertEqual(rows[1]["cells"]["large"], {"too_few": 1, "min": 3})


if __name__ == "__main__":
    unittest.main()

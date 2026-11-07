from __future__ import annotations

"""What the pipeline's records refuse whoever writes them (item 84; docs/pipeline.md):
an item keeps its number, an item is in one piece and a piece in one stage at a
time, a stage entry keeps its past, and events, sources, subjects and release
notes stay as written. Each is written directly, as a mistaken tool would."""

import sqlite3
import unittest

from test_pipeline_steering import PipelineCase


class RecordsCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages({"stage_id": "build", "name": "Build"})
        self.add("Now 1", section="now", size="small")
        self.add("Now 2", section="now", size="small")
        self.piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t1", "stage_id": "build"},
                                                 {"workspace_id": "w1"}))["piece_id"]
        self.message = self.post("About 2", actor="agent-a", subjects=[{"kind": "item", "ref": 2}])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO release_notes VALUES ('19',1,'A smaller change')")

    def refused(self, statement, params=(), words=None):
        db = sqlite3.connect(str(self.path))
        try:
            with self.assertRaises(sqlite3.DatabaseError) as raised:
                with db:
                    db.execute(statement, params)
        finally:
            db.close()
        if words:
            self.assertIn(words, str(raised.exception))

    def test_an_item_keeps_its_number(self):
        self.refused("DELETE FROM pipeline_items WHERE number=2", words="an item keeps its number")
        self.refused("INSERT INTO pipeline_items VALUES ('w1',2,'Again','','small',NULL,'','now','',9,'[]','',NULL,1)")

    def test_an_item_is_in_one_piece_and_a_piece_in_one_stage_at_a_time(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO pipeline_pieces VALUES ('p-other','w1','piece','t1',NULL,NULL,1)")
        self.refused("INSERT INTO pipeline_piece_members VALUES ('p-other','w1',1,NULL,NULL)")
        self.refused("INSERT INTO pipeline_stage_entries(piece_id,workspace_id,stage_id,round,size,entered_ms,entered_by) "
                     "VALUES (?,'w1','build',2,'small',1,'owner')", (self.piece,))

    def test_a_stage_entry_keeps_its_past(self):
        for statement in ("UPDATE pipeline_stage_entries SET entered_ms=entered_ms+1", "UPDATE pipeline_stage_entries SET entered_by='agent-a'",
                          "UPDATE pipeline_stage_entries SET round=2", "DELETE FROM pipeline_stage_entries"):
            with self.subTest(statement=statement):
                self.refused(statement, words="a stage entry keeps its past")
        # Leaving it, and its note while it is open, are what may change; once left, nothing does.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE pipeline_stage_entries SET note='going well'")
            db.execute("UPDATE pipeline_stage_entries SET left_ms=5,left_outcome='done'")
        self.refused("UPDATE pipeline_stage_entries SET left_ms=6", words="a stage entry keeps its past")
        self.refused("UPDATE pipeline_stage_entries SET note='later words'", words="a stage entry keeps its past")

    def test_events_sources_subjects_and_release_notes_stay_as_written(self):
        for statement, words in (("UPDATE pipeline_events SET by='agent-a'", "an event keeps its past"),
                                 ("DELETE FROM pipeline_events", "an event keeps its past"),
                                 ("DELETE FROM pipeline_item_sources", "an item keeps where it came from"),
                                 ("DELETE FROM message_subjects", "a message keeps its subjects"),
                                 ("UPDATE release_notes SET text='Other words'", "a release note keeps its words"),
                                 ("DELETE FROM release_notes", "a release note keeps its words")):
            with self.subTest(statement=statement):
                self.refused(statement, words=words)
        self.assertEqual(self.sql("SELECT message_id,kind,ref FROM message_subjects"), [(self.message, "item", "2")])

    def test_one_pipeline_per_instance_ships_in_its_releases(self):
        self.committed(self.on(ships_in_releases=True))
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second", "team": []}))
        self.refused("INSERT INTO pipelines VALUES ('w2',1,'Other','item','items',1,1,'{}',1)")


if __name__ == "__main__":
    unittest.main()

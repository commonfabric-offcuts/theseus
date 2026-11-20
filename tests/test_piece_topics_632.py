from __future__ import annotations

"""Public piece/cut boundary and durable repair, in isolated scratch stores."""

import io
import json
from pathlib import Path
import unittest
from unittest import mock

from aim_next import cli, Store
from aim_next.contract import Refusal
from aim_next.profile import write_profile
from test_build_topics import BuildTopicsCase
from test_pipeline_stages import StagesCase, STAGES
from test_pipeline_steering import PipelineCase


class PieceTopics632Case(PipelineCase):
    create_topic = BuildTopicsCase.create_topic
    topic = BuildTopicsCase.topic
    start = StagesCase.start

    def setUp(self):
        super().setUp()
        self.committed(self.on(ships_in_releases=False))
        self.stages(*STAGES)
        for number in range(1, 4):
            self.add("Work %d" % number, section="now", size="small")
        self.topic("human", "Person's writing", actor="owner")
        self.topic("destination", "Repair destination")
        self.profile = Path(self.temp.name) / "agent-a.json"
        write_profile(self.profile, str(self.path.resolve()), "test-instance", "agent-a", binding=self.binding)

    def cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        try:
            code = cli.main(["--profile", str(self.profile)] + list(args),
                            stdin=io.BytesIO(), stdout=out, stderr=err)
        except SystemExit as error:
            code = error.code
        return code, out.getvalue(), err.getvalue()

    def revision(self, piece):
        return self.sql("SELECT version FROM pipeline_pieces WHERE id=?", (piece,))[0][0]

    def move_piece(self, piece, topic="destination", actor="agent-a", revision=None, op=None):
        return self.command("pipeline.piece_move", {"topic_id": topic}, {"piece_id": piece},
                            {"piece_revision": self.revision(piece) if revision is None else revision}, actor=actor, op=op)

    def ids(self, **args):
        return [row["id"] for row in self.store.view("owner", "workspace_topics", dict(workspace_id="w1", **args))["items"]]

    def durable(self):
        return {table: self.sql("SELECT * FROM " + table + " ORDER BY rowid") for table in
                ("pipeline_pieces", "pipeline_piece_members", "pipeline_stage_entries", "pipeline_events",
                 "pipeline_facts", "pipelines", "topics", "changes")}

    def test_real_piece_cli_refuses_person_topic_without_starting_work(self):
        before = self.durable()
        code, out, err = self.cli("piece", "w1", "1", "--topic", "human", "--stage", "build")
        self.assertEqual(code, 2, (out, err))
        self.assertIn("PERSON_TOPIC", err)
        self.assertEqual(self.durable(), before)

    def test_real_piece_cli_accepts_agent_topic_and_move_cli_repairs_it(self):
        code, out, err = self.cli("piece", "w1", "1", "--topic", "t1", "--stage", "build")
        self.assertEqual((code, err), (0, ""), out)
        piece = self.sql("SELECT id FROM pipeline_pieces")[0][0]
        code, out, err = self.cli("move-piece", piece, "--topic", "destination", "--expected", str(self.revision(piece)))
        self.assertEqual((code, err), (0, ""), out)
        self.assertIn("destination", out)
        self.assertEqual(self.sql("SELECT topic_id FROM pipeline_pieces WHERE id=?", (piece,)), [("destination",)])

    def test_start_refuses_person_for_owner_and_agent_and_separate_conversation(self):
        for actor in ("owner", "agent-a"):
            self.rejected(self.start(topic="human", actor=actor), "PERSON_TOPIC")
        conversation = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["conversation_id"]
        self.rejected(self.start(topic=conversation), "PIECE_TOPIC_REQUIRED")
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_pieces"), [(0,)])

    def test_move_changes_both_durable_topics_and_only_piece_routing(self):
        piece = self.committed(self.start())["piece_id"]
        before = self.durable()
        untouched = {table: self.sql("SELECT * FROM " + table) for table in
                     ("messages", "topic_participants", "drafts", "pipeline_stage_entries", "pipeline_piece_members")}
        versions = dict(self.sql("SELECT id,version FROM topics WHERE id IN ('t1','destination')"))
        cursor = self.sql("SELECT max(seq) FROM changes")[0][0]
        result = self.committed(self.move_piece(piece))
        self.assertEqual((result["piece_id"], result["from_topic_id"], result["topic_id"]), (piece, "t1", "destination"))
        self.assertEqual(result["piece_revision"], self.revision(piece))
        for topic, version in versions.items():
            self.assertGreater(self.sql("SELECT version FROM topics WHERE id=?", (topic,))[0][0], version)
            self.assertTrue(self.sql("SELECT 1 FROM changes WHERE seq>? AND scope_id=?", (cursor, topic)), topic)
        self.assertIn("t1", self.ids(build=False))
        self.assertNotIn("t1", self.ids(build=True))
        self.assertIn("destination", self.ids(build=True))
        for table, rows in untouched.items():
            self.assertEqual(self.sql("SELECT * FROM " + table), rows, table)
        self.assertEqual(self.durable()["pipeline_facts"], before["pipeline_facts"])
        self.assertEqual(self.durable()["pipeline_events"], before["pipeline_events"])
        receipt = json.loads(self.sql("SELECT outcome FROM operations WHERE kind='pipeline.piece_move'")[0][0])
        self.assertEqual(receipt["result"], result, "the normal durable receipt retains both topics")

    def test_legacy_human_link_is_repaired_without_changing_person_writing_or_state(self):
        piece = self.committed(self.start())["piece_id"]
        # Existing pre-632 wrong link, only in this isolated scratch store.
        self.sql("UPDATE pipeline_pieces SET topic_id='human' WHERE id=?", (piece,))
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["agent-a"], "note": "Which date?"},
                                    {"topic_id": "human"}, {"topic_revision": self.store.view("owner", "topic", {"topic_id": "human"})["topic"]["version"]}))
        before = self.sql("SELECT * FROM messages WHERE topic_id='human'")
        self.committed(self.move_piece(piece))
        person = self.store.view("owner", "topic", {"topic_id": "human"})["topic"]
        self.assertEqual((person["state"], person["state_note"], person["waiting_on"]), ("waiting", "Which date?", ["agent-a"]))
        self.assertEqual(self.sql("SELECT * FROM messages WHERE topic_id='human'"), before)
        self.assertIn("human", self.ids(build=False))

    def test_only_owner_or_coordinator_repairs_and_refusals_are_atomic(self):
        piece = self.committed(self.start())["piece_id"]
        for actor, topic, code in (("agent-b", "destination", "FORBIDDEN"), ("outsider", "destination", "FORBIDDEN"),
                                   ("agent-a", "human", "PERSON_TOPIC"), ("owner", "missing", "FORBIDDEN")):
            before = self.durable()
            self.rejected(self.move_piece(piece, topic, actor=actor), code)
            self.assertEqual(self.durable(), before)
        self.committed(self.move_piece(piece, actor="owner"))

    def test_stale_revision_same_destination_noop_and_exact_retry(self):
        piece = self.committed(self.start())["piece_id"]
        revision = self.revision(piece)
        envelope = self.envelope("pipeline.piece_move", {"piece_id": piece}, {"topic_id": "destination"},
                                 {"piece_revision": revision}, op="move-once")
        first = self.store.command("agent-a", envelope)
        self.committed(first)
        after = self.durable()
        self.assertEqual(self.store.command("agent-a", envelope), first)
        self.assertEqual(self.durable(), after)
        self.rejected(self.move_piece(piece, "t1", revision=revision), "REVISION_CONFLICT")
        self.committed(self.move_piece(piece))
        self.assertEqual(self.durable(), after, "same destination is a no-op")
        self.rejected(self.command("pipeline.piece_move", {"topic_id": "t1"}, {"piece_id": piece}, actor="agent-a"), "INVALID_ARGUMENT")

    def test_destination_already_under_way_is_refused_and_member_cannot_move(self):
        first = self.committed(self.start(numbers=(1,)))["piece_id"]
        self.committed(self.start(numbers=(2,), topic="destination"))
        before = self.durable()
        self.rejected(self.move_piece(first), "TOPIC_HAS_PIECE")
        self.assertEqual(self.durable(), before)

    def test_outline_returns_only_after_last_current_link_moves_including_closed_history(self):
        first = self.committed(self.start(numbers=(1,)))["piece_id"]
        self.committed(self.command("pipeline.piece_finish", {}, {"piece_id": first}))
        second = self.committed(self.start(numbers=(2,)))["piece_id"]
        self.committed(self.move_piece(second))
        self.assertIn("t1", self.ids(build=True), "closed historical piece still currently names this topic")
        self.topic("other", "Closed history destination")
        self.committed(self.move_piece(first, "other"))
        self.assertIn("t1", self.ids(build=False))
        self.assertNotIn("t1", self.ids(build=True), "event history cannot keep it classified Build")
        restarted = Store(self.path, "test-instance", expected_binding=self.binding)
        ordinary = restarted.view("owner", "workspace_topics", {"workspace_id": "w1", "build": False})
        self.assertIn("t1", [row["id"] for row in ordinary["items"]])

    def test_failed_notification_rolls_back_routing_history_and_versions(self):
        piece = self.committed(self.start())["piece_id"]
        before = self.durable()
        with mock.patch.object(Store, "_build_moved", side_effect=Refusal("FIXTURE_FAILURE", "Scratch notification failure")):
            self.rejected(self.move_piece(piece), "FIXTURE_FAILURE")
        self.assertEqual(self.durable(), before)


if __name__ == "__main__":
    unittest.main()

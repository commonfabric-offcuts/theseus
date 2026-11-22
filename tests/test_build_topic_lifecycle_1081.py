from __future__ import annotations

"""1081's shared topic lifecycle through actual Core acts, records and CLI reads."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest

from aim_next.profile import write_profile
import test_build_topics as build_topics
from test_pipeline_steering import PipelineCase


class Lifecycle1081Case(PipelineCase):
    topic = build_topics.BuildTopicsCase.topic
    create_topic = build_topics.BuildTopicsCase.create_topic
    say = build_topics.BuildTopicsCase.say
    ids = build_topics.BuildTopicsCase.ids

    def setUp(self):
        super().setUp()
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"},
                    {"stage_id": "wait", "name": "Wait"},
                    {"stage_id": "checks", "name": "Checks", "scope": "release"})
        self.store.record_release({"release": 22, "commit": "a" * 40,
            "deployed_at": "2026-11-20T10:00:00-08:00", "items": [], "source": "backfill"})
        self.one = self.add("First scratch change", section="now", size="small")

    def start(self, numbers, topic="t1"):
        return self.committed(self.command("pipeline.piece_start", {
            "numbers": list(numbers), "topic_id": topic, "stage_id": "build"
        }, {"workspace_id": "w1"}))["piece_id"]

    def ship(self, release, numbers):
        record = {"release": release, "commit": ("%02x" % release) * 20,
            "deployed_at": "2026-11-20T11:00:00-08:00", "items": list(numbers), "source": "deploy"}
        receipt = self.store.record_release(record)
        print(json.dumps({"case": "1081 actual release record", "input": record, "receipt": receipt}))
        self.assertTrue(receipt["recorded"], receipt)
        return record

    def read_topic(self, topic="t1", actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": topic})
        self.assertNotIn("error", answer, answer)
        return answer["topic"]

    def test_actual_shipment_closes_for_a_member_who_never_opened_the_topic(self):
        self.start([self.one])
        # No read/visit act or topic view by agent-b precedes the actual record.
        self.ship(23, [self.one])
        for actor in ["agent-b", "owner", "agent-a"]:
            with self.subTest(actor=actor):
                topic = self.read_topic(actor=actor)
                self.assertEqual((topic["state"], topic["archived"], topic["state_by"]), ("done", False, None))
                self.assertNotIn("t1", self.ids(actor, build=True))
                self.assertIn("t1", self.ids(actor, done=True))
                self.assertEqual(topic["creator_id"], "agent-a")

    def test_candidate_and_later_archive_real_set_aside_bindings_then_start_reopens(self):
        for section in ["candidates", "later"]:
            with self.subTest(section=section):
                topic = "parked-" + section
                self.topic(topic)
                number = self.add("Park " + section, section="now", size="small")
                first = self.start([number], topic)
                self.committed(self.move(number, section=section, note="Keep the diagnostic and await a new sighting"))
                history = self.sql("SELECT entered_ms,left_ms,left_outcome,left_note FROM pipeline_stage_entries WHERE piece_id=?", (first,))
                self.assertIn("Keep the diagnostic", history[-1][3])
                self.assertEqual(self.read_topic(topic)["archived"], True)
                self.assertNotIn(topic, self.ids(build=True))
                self.assertIn(topic, self.ids(archived=True))
                self.committed(self.move(number, section="now"))
                self.start([number], topic)
                self.assertEqual((self.read_topic(topic)["archived"], self.read_topic(topic)["state"]), (False, "active"))
                self.assertIn(topic, self.ids(build=True))
                self.assertEqual(self.sql("SELECT entered_ms,left_ms,left_outcome,left_note FROM pipeline_stage_entries WHERE piece_id=?", (first,)), history)

    def test_a_partial_record_and_an_approval_do_not_close_ongoing_work(self):
        two = self.add("Second scratch change", section="now", size="small")
        piece = self.start([self.one, two])
        version = self.item(self.one)["piece"]["version"]
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "wait", "left_outcome": "approved"},
            {"piece_id": piece}, {"piece_revision": version}))
        self.assertEqual(self.read_topic()["state"], "active")
        self.ship(23, [self.one])
        self.assertEqual((self.read_topic()["state"], self.read_topic()["archived"]), ("active", False))
        self.assertIn("t1", self.ids(build=True))
        self.ship(24, [two])
        self.assertEqual(self.read_topic()["state"], "done")

    def test_a_combined_piece_stays_open_until_its_release_record(self):
        piece = self.start([self.one])
        version = self.item(self.one)["piece"]["version"]
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "wait", "left_outcome": "approved"},
            {"piece_id": piece}, {"piece_revision": version}))
        self.topic("release-topic")
        self.committed(self.command("pipeline.combine", {"piece_ids": [piece], "topic_id": "release-topic"}, {"workspace_id": "w1"}))
        self.assertEqual(self.read_topic()["state"], "active")
        self.assertIn("t1", self.ids(build=True))
        self.ship(23, [self.one])
        self.assertEqual(self.read_topic()["state"], "done")
        self.assertEqual(self.read_topic("release-topic")["state"], "done")

    def test_a_shipping_announcement_keeps_system_done_but_ordinary_done_reopens(self):
        self.start([self.one])
        self.ship(23, [self.one])
        self.post("The scratch change is live; here is what to try.", topic="t1")
        self.assertEqual(self.read_topic()["state"], "done")
        self.say("t1", state="done", note="A person's subsequent explicit Done")
        self.post("A new discussion after the person's own Done", topic="t1")
        self.assertEqual(self.read_topic()["state"], "active")
        self.assertIsNotNone(self.read_topic()["state_message_id"])
        self.topic("ordinary", "Ordinary writing", actor="owner")
        self.say("ordinary", state="done", note="A person's own end")
        self.post("A new ordinary discussion", topic="ordinary")
        ordinary = self.read_topic("ordinary")
        self.assertEqual(ordinary["state"], "active")
        self.assertIsNotNone(ordinary["state_message_id"])

    def test_starting_new_work_reopens_an_archived_completed_build_topic(self):
        self.start([self.one])
        self.ship(23, [self.one])
        self.say("t1", archived=True)
        before = self.sql("SELECT id,creator_id FROM topics WHERE id='t1'")
        two = self.add("New work, not a second start of the shipped item", section="now", size="small")
        self.start([two])
        self.assertEqual((self.read_topic()["state"], self.read_topic()["archived"]), ("active", False))
        self.assertEqual(self.sql("SELECT id,creator_id FROM topics WHERE id='t1'"), before)
        self.assertEqual(self.item(self.one)["shipped"]["release"], 23)

    def test_unbound_person_topics_manual_state_and_noop_versions_keep_their_meaning(self):
        self.topic("person", "Person's ongoing words", actor="owner")
        self.say("person", state="waiting", note="Keep my word", waiting_on=["agent-a"])
        person = self.sql("SELECT state,archived,state_note,state_by,state_ms,state_message_id FROM topics WHERE id='person'")
        self.start([self.one])
        self.ship(23, [self.one])
        self.assertEqual(self.sql("SELECT state,archived,state_note,state_by,state_ms,state_message_id FROM topics WHERE id='person'"), person)
        version = self.read_topic()["version"]
        self.topic("another")
        two = self.add("Unrelated actual pipeline transition", section="now", size="small")
        self.start([two], "another")
        self.assertEqual(self.read_topic()["version"], version, "synchronizing an unchanged held topic is a no-op")
        self.say("t1", state="active", note="Explicit follow-up after shipment")
        manual = self.sql("SELECT state,state_note,state_by,state_ms FROM topics WHERE id='t1'")
        self.topic("third")
        three = self.add("A further unrelated transition", section="now", size="small")
        self.start([three], "third")
        self.assertEqual(self.sql("SELECT state,state_note,state_by,state_ms FROM topics WHERE id='t1'"), manual)

    def test_an_unrelated_transition_does_not_sweep_unreviewed_parked_topics(self):
        first = self.start([self.one])
        self.committed(self.move(self.one, section="later", note="A retained diagnostic"))
        self.say("t1", archived=False)
        before = self.sql("SELECT state,archived,state_note,version FROM topics WHERE id='t1'")
        self.topic("other-parked")
        two = self.add("Separate parked work", section="now", size="small")
        self.start([two], "other-parked")
        self.committed(self.move(two, section="candidates", note="This transition owns only its own topic"))
        self.assertEqual(self.sql("SELECT state,archived,state_note,version FROM topics WHERE id='t1'"), before)
        self.assertEqual(self.read_topic("other-parked")["archived"], True)
        self.assertIn("A retained diagnostic", self.sql("SELECT left_note FROM pipeline_stage_entries WHERE piece_id=?", (first,))[0][0])

    def test_moving_an_open_piece_opens_its_archived_destination_without_changing_authorship(self):
        piece = self.start([self.one])
        self.topic("destination")
        self.say("destination", state="done", archived=True)
        before = self.sql("SELECT creator_id FROM topics WHERE id='destination'")
        version = self.item(self.one)["piece"]["version"]
        self.committed(self.command("pipeline.piece_move", {"topic_id": "destination"},
            {"piece_id": piece}, {"piece_revision": version}))
        self.assertEqual((self.read_topic("destination")["state"], self.read_topic("destination")["archived"]), ("active", False))
        self.assertEqual(self.sql("SELECT creator_id FROM topics WHERE id='destination'"), before)
        self.assertEqual(self.item(self.one)["piece"]["id"], piece)

    def test_a_retained_human_link_keeps_the_legacy_review_rule(self):
        piece = self.start([self.one])
        self.topic("legacy-human", actor="owner")
        # Pre-632 records can contain this link. Current public starts refuse
        # it (the separate refusal case); seed it only in this disposable DB.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE pipeline_pieces SET topic_id=? WHERE id=?", ("legacy-human", piece))
        self.ship(23, [self.one])
        person = self.read_topic("legacy-human")
        self.assertEqual((person["state"], person["creator_id"], person["build"]), ("review", "owner", False))

    def test_a_retained_conversation_link_is_neither_archived_nor_closed(self):
        piece = self.start([self.one])
        conversation = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["conversation_id"]
        # Retained pre-632 linkage, only in this disposable legacy fixture.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE pipeline_pieces SET topic_id=? WHERE id=?", (conversation, piece))
        self.committed(self.move(self.one, section="later", note="A retained diagnostic, not a completed outcome"))
        self.assertEqual((self.read_topic(conversation)["kind"], self.read_topic(conversation)["archived"]), ("conversation", False))
        self.ship(23, [self.one])
        self.assertEqual((self.read_topic(conversation)["state"], self.read_topic(conversation)["archived"]), ("active", False))

    def test_refused_start_cannot_partly_change_topic_or_archive(self):
        self.topic("human", "Human topic", actor="owner")
        self.say("human", archived=True)
        before = self.sql("SELECT state,archived,state_note,version FROM topics WHERE id='human'")
        refused = self.command("pipeline.piece_start", {"numbers": [self.one], "topic_id": "human", "stage_id": "build"}, {"workspace_id": "w1"})
        self.rejected(refused, "PERSON_TOPIC")
        self.assertEqual(self.sql("SELECT state,archived,state_note,version FROM topics WHERE id='human'"), before)
        self.assertEqual(self.read_topic("human")["archived"], True)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_pieces"), [(0,)])
        candidate = self.add("Not started", section="candidates", size="small")
        refused = self.command("pipeline.piece_start", {"numbers": [candidate], "topic_id": "t1", "stage_id": "build"}, {"workspace_id": "w1"})
        self.rejected(refused, "NOT_IN_NOW")
        self.assertEqual(self.read_topic()["state"], "active")

    def test_real_cli_reads_the_same_done_state_for_a_scratch_member(self):
        self.start([self.one])
        self.ship(23, [self.one])
        profile = Path(self.temp.name) / "scratch-agent-b.json"
        write_profile(profile, str(self.path.resolve()), "test-instance", "agent-b", binding=self.binding)
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([sys.executable, "-I", str(root / "bin" / "aim-next"),
            "--profile", str(profile), "--json", "read", "t1"], capture_output=True, text=True,
            env=dict(os.environ, PYTHONPYCACHEPREFIX=str(Path(self.temp.name) / "cli-cache")), timeout=20)
        print(json.dumps({"case": "1081 actual CLI shared Done", "argv": result.args,
            "child_exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}))
        self.assertEqual((result.returncode, result.stderr), (0, ""), result.stdout)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        topic = next(row["topic"] for row in rows if "topic" in row)
        self.assertEqual((topic["state"], topic["archived"]), ("done", False))
        self.assertEqual(self.read_topic(actor="agent-b")["state"], topic["state"])


if __name__ == "__main__":
    unittest.main()

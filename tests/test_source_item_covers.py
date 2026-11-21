from __future__ import annotations

"""Automatic source-item cover rows, through real synthetic Core commands."""

import unittest

from test_pipeline_steering import PipelineCase


WAIT = [{"text": "Choose the cabin", "default": "Keep the current booking"}]


class Fixture(PipelineCase):
    def post(self, body, actor="owner", topic="t1", **args):
        # Human reports have no agent divergence cover. Agent replies retain
        # the current explicit passage contract in this isolated fixture.
        if actor != "owner" and args.get("reply_to"):
            args.setdefault("reply_without_quote", "Synthetic source-cover fixture follow-up")
        return super().post(body, actor=actor, topic=topic, **args)

    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages({"stage_id": "build", "name": "Build"},
                    {"stage_id": "preview", "name": "Preview"},
                    {"stage_id": "review", "name": "Review"},
                    {"stage_id": "wait", "name": "Wait"})

    def cover(self, message, **fields):
        current = self.shown(message)
        return self.committed(self.command("stack.cover", fields,
                              {"message_id": current["root_id"]},
                              {"cover_revision": current["cover_revision"]}, actor="agent-a"))

    def shown(self, message, actor="owner"):
        result = self.store.view(actor, "dossier_cover", {"message_id": message})
        self.assertNotIn("error", result, result)
        return result

    def file(self, title, *messages):
        return self.add(title, section="now", size="small",
                        sources=[{"message_id": message} for message in messages])

    def topic(self, topic_id):
        return self.build_topic(topic_id, "Synthetic work topic")

    def start(self, number, topic=None, stage="build"):
        if topic is None:
            topic = "work-757-" + str(number)
            if not self.sql("SELECT 1 FROM topics WHERE id=?", (topic,)):
                self.topic(topic)
        return self.committed(self.command("pipeline.piece_start",
                              {"numbers": [number], "topic_id": topic, "stage_id": stage},
                              {"workspace_id": "w1"}))["piece_id"]


class ReaderFreshnessCase(Fixture):
    def fresh(self, source):
        answer = self.store.view("agent-b", "stack_positions", {"topic_id": "t1", "message_ids": [source]})
        self.assertNotIn("error", answer, answer)
        return answer["items"][0]["stack_position"]

    def projection(self, source, actor="agent-b"):
        # Compare every public field, including the fence, across actual writes.
        return {
            "cover": self.shown(source, actor),
            "page": self.store.view(actor, "topic_messages", {"topic_id": "t1", "limit": 100})["items"],
            "positions": self.store.view(actor, "stack_positions", {"topic_id": "t1", "message_ids": [source]}),
        }

    def test_hidden_and_unrelated_writes_leave_exact_public_projection_unchanged(self):
        source = self.post("A public source")
        before = self.projection(source)
        self.post("Hidden question", actor="owner", whisper=True, addressees=["agent-a"], reply_to=source)
        self.assertEqual(self.projection(source), before, "hidden whisper leaves exact public projection unchanged")
        self.topic("t-other-757")
        self.post("Unrelated topic work", topic="t-other-757")
        self.assertEqual(self.projection(source), before, "unrelated topic leaves exact public projection unchanged")
        self.committed(self.command("workspace.create", {"id": "private-757", "title": "Private destination", "team": []}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "private-757"}, {"pipeline_revision": 0}))
        number = self.committed(self.command("pipeline.item_add", {"title": "Private item", "sources": [{"message_id": source}]}, {"workspace_id": "private-757"}))["number"]
        self.assertEqual(self.projection(source), before, "unreadable destination filing leaves exact public projection unchanged")
        self.committed(self.command("pipeline.item_edit", {"title": "Private revision"}, {"workspace_id": "private-757", "number": number}, {"item_revision": 1}))
        self.assertEqual(self.projection(source), before, "private item edit leaves exact public projection unchanged")

    def test_visible_message_item_manual_and_lifecycle_changes_advance_fence(self):
        source = self.post("A public report")
        before = self.fresh(source)
        def advanced(label):
            nonlocal before
            after = self.fresh(source)
            self.assertGreater(after["cover_read_seq"], before["cover_read_seq"], label)
            before = after
        self.post("Visible follow-up", reply_to=source)
        advanced("visible message advances cover freshness")
        self.cover(source, stands="Cabin is booked", waiting=WAIT)
        advanced("manual cover advances freshness")
        number = self.file("Make the reader clearer", source)
        advanced("readable item filing advances freshness")
        self.committed(self.edit(number, title="A clearer reader"))
        advanced("visible item edit advances freshness")
        self.assertEqual(before["cover"]["items"][0]["title"], "A clearer reader")
        piece = self.start(number)
        advanced("piece start advances freshness")
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "review", "left_outcome": "passed"}, {"piece_id": piece}))
        advanced("committed lifecycle advances freshness")
        self.assertEqual(before["cover"]["items"][0]["state"], "Review")
        self.assertEqual(before["cover"]["waiting"], WAIT)

    def test_other_dossier_item_changes_leave_exact_source_position_unchanged(self):
        source = self.post("Report with its own dossier")
        other = self.post("Independent dossier in the same topic")
        before = self.fresh(source)
        number = self.file("Other work", other)
        self.assertEqual(self.fresh(source), before, "another dossier's item filing cannot move this exact projection")
        self.committed(self.edit(number, title="Other work revised"))
        self.assertEqual(self.fresh(source), before, "another dossier's item edit cannot move this exact projection")

    def test_split_advances_fence_when_newest_member_leaves(self):
        source = self.post("Original report")
        self.file("Original item", source)
        joined = self.post("Newer independent report")
        self.file("Other item", joined)
        self.committed(self.command("stack.join", {"into": source}, {"message_id": joined}, {"join_revision": 0}))
        before = self.fresh(source)
        self.committed(self.command("stack.join", {"into": None}, {"message_id": joined}, {"join_revision": 1}))
        after = self.fresh(source)
        self.assertGreater(after["cover_read_seq"], before["cover_read_seq"], "split advances despite fewer visible members")
        self.assertEqual(len(before["cover"]["items"]), 2)
        self.assertEqual(len(after["cover"]["items"]), 1)

    def test_destination_revocation_and_readmission_advance_redaction_fence(self):
        source = self.post("Public report")
        self.committed(self.command("workspace.create", {"id": "destination-757", "title": "Destination", "team": ["agent-b"]}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "destination-757"}, {"pipeline_revision": 0}))
        self.committed(self.command("pipeline.item_add", {"title": "Admitted item", "sources": [{"message_id": source}]}, {"workspace_id": "destination-757"}))
        before = self.fresh(source)
        self.assertEqual(before["cover"]["items"][0]["title"], "Admitted item")
        for present in (False, True):
            revision = self.store.view("owner", "workspace", {"workspace_id": "destination-757"})["workspace"]["version"]
            self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": present}, {"workspace_id": "destination-757"}, {"workspace_revision": revision}))
            after = self.fresh(source)
            self.assertGreater(after["cover_read_seq"], before["cover_read_seq"], "access change advances even when cover rows disappear")
            self.assertEqual(after["cover"] is not None, present)
            before = after


class SourceRowsCase(Fixture):
    def rows(self, message, actor="owner"):
        return (self.shown(message, actor)["cover"] or {}).get("items", [])

    def test_filing_derives_real_item_row_preserving_wait(self):
        source = self.post("File a clearer reader")
        self.cover(source, waiting=WAIT)
        number = self.file("A clearer reader", source)
        self.assertEqual(self.shown(source)["cover"]["waiting"], WAIT)
        rows = self.rows(source)
        self.assertEqual(len(rows), 1, "filing automatically projects one actual item row")
        self.assertEqual((rows[0]["workspace_id"], rows[0]["number"], rows[0]["title"], rows[0]["state"]),
                         ("w1", number, "A clearer reader", "Now"))
        self.assertEqual(rows[0]["sources"], [source])
        self.assertIsNone(rows[0]["piece_id"])

    def test_real_stage_change_derives_review_preserving_manual_fields(self):
        source = self.post("File a faster feed")
        self.cover(source, stands="Cabin is booked", waiting=WAIT,
                   payload={"text": "Cabin decision", "message_id": source})
        manual = self.shown(source)["cover"]
        number = self.file("A faster feed", source)
        piece = self.start(number)
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "review", "left_outcome": "passed"}, {"piece_id": piece}))
        self.assertEqual(self.item(number)["stage"]["name"], "Review")
        cover = self.shown(source)["cover"]
        for key in ("stands", "waiting", "payload", "by", "at_ms"):
            self.assertEqual(cover[key], manual[key])
        self.assertEqual([row["state"] for row in self.rows(source)], ["Review"], "cover follows the committed stage")


class ContractControls(Fixture):
    def test_same_source_can_hold_two_independent_stages_beside_manual_payload(self):
        root = self.post("Two independent improvements")
        answer = self.post("The agreed cabin decision", reply_to=root)
        self.cover(root, stands="Cabin is booked", waiting=WAIT,
                   payload={"text": "Cabin decision", "message_id": answer,
                            "link": "https://example.test/cabin", "kind": "decision"})
        before = self.shown(root)
        first = self.file("Make the reader clearer", root)
        second = self.file("Speed up the feed", root)
        self.assertNotEqual(first, second)
        self.assertEqual(self.sql("SELECT number,message_id FROM pipeline_item_sources ORDER BY number"),
                         [(first, root), (second, root)], "two actual items retain the same source")
        self.start(first)
        self.topic("t2")
        self.start(second, topic="t2", stage="review")
        self.assertEqual([self.item(n)["stage"]["name"] for n in (first, second)], ["Build", "Review"])
        after = self.shown(root)
        for key in before["cover"]:
            self.assertEqual(after["cover"][key], before["cover"][key], "manual fields are unchanged")
        self.assertEqual([row["state"] for row in after["cover"]["items"]], ["Build", "Review"])

    def test_joined_sources_share_one_cover_and_all_actual_sources_remain(self):
        root = self.post("First report")
        joined = self.post("Second report")
        unrelated = self.post("Third report in another dossier")
        self.cover(root, stands="Keep the existing summary", waiting=WAIT)
        self.committed(self.command("stack.join", {"into": root}, {"message_id": joined},
                                   {"join_revision": 0}))
        self.assertEqual(self.shown(joined)["root_id"], root, "joined source uses the actual root")
        self.assertEqual(self.shown(joined)["cover"], self.shown(root)["cover"])
        item = self.file("One item, three actual messages", root, joined, unrelated)
        self.assertEqual(self.sql("SELECT message_id FROM pipeline_item_sources WHERE number=? ORDER BY position", (item,)),
                         [(root,), (joined,), (unrelated,)], "every actual message source is retained")
        another = self.file("Another item from the joined message", joined)
        self.assertEqual(self.item(another)["sources"]["shown"][0]["message_id"], joined)
        self.assertEqual(self.shown(joined)["root_id"], root)

    def test_partial_cover_write_keeps_wait_default_and_existing_payload(self):
        source = self.post("A report")
        self.cover(source, waiting=WAIT, payload={"text": "Existing answer", "message_id": source})
        before = self.shown(source)["cover"]
        self.cover(source, stands="A new manual summary")
        after = self.shown(source)["cover"]
        self.assertEqual(after["waiting"], WAIT, "wait and its named default survive a partial cover write")
        self.assertEqual(after["payload"], before["payload"], "unrelated manual payload survives")

    def test_source_readers_need_not_read_destination_item(self):
        source = self.post("A source shared with the original team")
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Private destination", "team": []}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w2"}, {"pipeline_revision": 0}))
        number = self.committed(self.command("pipeline.item_add", {
            "title": "Confidential destination title", "sources": [{"message_id": source}]},
            {"workspace_id": "w2"}))["number"]
        self.shown(source, actor="agent-a")
        refused = self.store.view("agent-a", "pipeline_item", {"workspace_id": "w2", "number": number})
        self.assertEqual(refused.get("error", {}).get("code"), "FORBIDDEN", "source access grants no destination access")

    def test_filing_has_real_item_identity_before_any_work_topic_is_assigned(self):
        source = self.post("File this for later")
        number = self.file("A filed item", source)
        item = self.item(number)
        self.assertEqual(item["number"], number)
        self.assertIsNone(item["piece"])
        self.assertIsNone(item["stage"])
        self.assertEqual(item["pieces"], [])
        self.assertEqual(self.sql("SELECT id FROM pipeline_pieces"), [])


class IntegrationCase(Fixture):
    rows = SourceRowsCase.rows
    def enter(self, piece, stage, **args):
        return self.committed(self.command("pipeline.stage_enter", dict(stage_id=stage, left_outcome="passed", **args), {"piece_id": piece}))

    def state(self, source):
        return self.rows(source)[0]["state"]

    def test_joined_multiple_sources_deduplicate_items_keep_identities_and_split(self):
        root, joined, other = [self.post(s) for s in ("First source", "Joined source", "Separate source")]
        first = self.file("Same title", root, joined, other)
        second = self.file("Same title", joined)
        self.committed(self.command("stack.join", {"into": root}, {"message_id": joined}, {"join_revision": 0}))
        rows = self.rows(root)
        self.assertEqual([row["number"] for row in rows], [first, second])
        self.assertEqual(rows[0]["sources"], [root, joined], "joined cover retains all actual identities")
        self.assertEqual(rows[1]["sources"], [joined])
        self.assertEqual(self.rows(other)[0]["sources"], [other])
        self.assertEqual(self.rows(joined), rows)
        self.committed(self.command("stack.join", {"into": None}, {"message_id": joined}, {"join_revision": 1}))
        self.assertEqual([r["number"] for r in self.rows(root)], [first])
        self.assertEqual([r["number"] for r in self.rows(joined)], [first, second])
        # A source added later joins the readback immediately, no post or cover act.
        later = self.post("Later actual source")
        self.committed(self.command("pipeline.source_add", {"sources": [{"message_id": later}]}, {"workspace_id": "w1", "number": second}))
        self.assertEqual(self.rows(later)[0]["number"], second)
        self.assertIsNone(self.shown(root)["cover"]["by"], "generated rows invent no attributed writer")
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE kind='cover'"), [(0,)])

    def test_core_privacy_on_every_projection_and_access_revocation(self):
        import json
        source = self.post("Public source")
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Private destination", "team": ["agent-a"]}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w2"}, {"pipeline_revision": 0}))
        self.committed(self.command("pipeline.item_add", {"title": "Secret destination title", "sources": [{"message_id": source}]}, {"workspace_id": "w2"}))
        self.assertEqual(self.rows(source, "agent-a")[0]["title"], "Secret destination title")
        # Revoke destination membership, while source membership stays intact.
        rev = self.store.view("owner", "workspace", {"workspace_id": "w2"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False}, {"workspace_id": "w2"}, {"workspace_revision": rev}))
        self.assertEqual(self.rows(source, "agent-a"), [], "Core removes unreadable item fields before handing out a cover")
        for view, args in (("dossier_cover", {"message_id": source}),
                           ("topic_messages", {"topic_id": "t1"}),
                           ("message_acts", {"topic_id": "t1"}),
                           ("stack_positions", {"topic_id": "t1", "message_ids": [source]})):
            result = self.store.view("agent-a", view, args)
            self.assertNotIn("error", result)
            self.assertNotIn("Secret destination title", json.dumps(result), view)
            self.assertNotIn('"workspace_id": "w2"', json.dumps(result), view)
        self.assertEqual(len(self.rows(source)), 1, "owner still reads actual destination")

    def test_configured_rounds_renames_build_preview_review_wait(self):
        source = self.post("Status source")
        self.stages({"stage_id": "build", "name": "Build", "rounds": "together"},
                    {"stage_id": "preview", "name": "Preview"},
                    {"stage_id": "review", "name": "Review", "rounds": "split"},
                    {"stage_id": "wait", "name": "Wait"})
        number = self.file("An improvement", source)
        piece = self.start(number)
        self.assertEqual(self.state(source), "Build, round 1")
        self.enter(piece, "build", round=2)
        self.assertEqual(self.state(source), "Build, round 2")
        self.enter(piece, "preview")
        self.assertEqual(self.state(source), "Preview")
        self.enter(piece, "review", round=2)
        self.assertEqual(self.state(source), "Review, round 2")
        self.stages({"stage_id": "build", "name": "Making"}, {"stage_id": "preview", "name": "Try it"},
                    {"stage_id": "review", "name": "Read together", "rounds": "split"}, {"stage_id": "wait", "name": "Wait"})
        self.assertEqual(self.state(source), "Read together, round 2")
        self.enter(piece, "wait")
        self.assertEqual(self.state(source), "Wait")

    def test_set_aside_drop_undo_and_placements_are_not_open_stages(self):
        source = self.post("Placement source")
        number = self.file("An improvement", source)
        self.start(number)
        aside = self.committed(self.move(number, section="later", note="Other work first"))
        self.assertEqual(self.state(source), "Later · set aside")
        self.committed(self.move(number, undo_of=aside["event"]))
        self.assertEqual(self.state(source), "Now · set aside", "Undo never restarts the old piece")
        piece = self.start(number)
        self.assertEqual(self.state(source), "Build")
        drop = self.committed(self.move(number, section="dropped", underway_confirmed=True))
        self.assertEqual(self.state(source), "Dropped")
        self.committed(self.move(number, undo_of=drop["event"]))
        self.assertEqual(self.state(source), "Now")
        self.committed(self.move(number, section="candidates", candidate_group="Next year"))
        self.assertEqual(self.state(source), "Candidates · Next year")
        self.committed(self.move(number, section="next"))
        self.assertEqual(self.state(source), "Next")

    def test_nonrelease_done_and_actual_release_live_including_no_piece(self):
        source = self.post("Finish source")
        number = self.file("An improvement", source)
        piece = self.start(number)
        self.committed(self.command("pipeline.piece_finish", {}, {"piece_id": piece}))
        self.assertEqual(self.state(source), "Done", "non-release completion is not Live")
        self.committed(self.on(ships_in_releases=True))
        second_source = self.post("No work topic yet")
        second = self.file("Never started", second_source)
        record = {"release": 1, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [number, second], "source": "backfill"}
        self.assertTrue(self.store.record_release(record)["recorded"])
        before = self.records()
        self.assertFalse(self.store.record_release(record)["recorded"])
        self.assertEqual(self.records(), before, "release replay has no second generated effect")
        self.assertEqual(self.state(source), "Live · release 1")
        self.assertEqual(self.state(second_source), "Live · release 1")
        self.assertIsNone(self.rows(second_source)[0]["piece_id"])

    def test_combine_release_stages_and_record_overtaking_drop(self):
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"}, {"stage_id": "wait", "name": "Wait"},
                    {"stage_id": "checks", "name": "Check candidate", "scope": "release"},
                    {"stage_id": "deploy", "name": "Deploy", "scope": "release"})
        source = self.post("Release source")
        number = self.file("Ships together", source)
        piece = self.start(number, stage="wait")
        release = self.committed(self.command("pipeline.combine", {"piece_ids": [piece], "topic_id": "t1"}, {"workspace_id": "w1"}))["piece_id"]
        self.assertEqual((self.state(source), self.rows(source)[0]["piece_id"]), ("Check candidate", release))
        self.enter(release, "deploy")
        self.assertEqual(self.state(source), "Deploy", "deployment stage is not a Live record")
        self.committed(self.move(number, section="dropped", underway_confirmed=True))
        self.assertEqual(self.state(source), "Dropped")
        self.store.record_release({"release": 1, "commit": "5" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [number], "source": "backfill"})
        self.assertEqual(self.state(source), "Live · release 1", "actual record overtakes the drop")

    def test_filing_replay_refusal_and_failure_are_atomic(self):
        import sqlite3
        source = self.post("Retry source")
        args = {"title": "File exactly once", "sources": [{"message_id": source}]}
        first = self.command("pipeline.item_add", args, {"workspace_id": "w1"}, op="file-once")
        self.committed(first)
        before = self.records()
        self.assertEqual(self.command("pipeline.item_add", args, {"workspace_id": "w1"}, op="file-once"), first)
        self.assertEqual(self.records(), before)
        self.assertEqual(len(self.rows(source)), 1)
        self.assertEqual(self.records(), before, "cover reads write no records")
        self.rejected(self.command("pipeline.item_add", {"title": "Refused", "sources": [{"message_id": source}]}, {"workspace_id": "w1"}, actor="outsider"), "FORBIDDEN")
        self.assertEqual(len(self.rows(source)), 1)
        # Actual late-transaction failure after item/source/event writes: all
        # roll back, including opaque source refresh intent.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER fail_cover_intent BEFORE INSERT ON changes WHEN NEW.resource_kind='source_cover' BEGIN SELECT RAISE(ABORT,'fixture intent failure'); END")
        refused = self.command("pipeline.item_add", {"title": "Must roll back", "sources": [{"message_id": source}]}, {"workspace_id": "w1"}, op="retry-failure")
        self.rejected(refused, "INTERNAL_ERROR")
        self.assertFalse(refused["recorded"])
        self.assertEqual(self.sql("SELECT title FROM pipeline_items"), [("File exactly once",)])
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id='retry-failure'"), [(0,)])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER fail_cover_intent")
        self.committed(self.command("pipeline.item_add", {"title": "Must roll back", "sources": [{"message_id": source}]}, {"workspace_id": "w1"}, op="retry-failure"))
        self.assertEqual(len(self.rows(source)), 2)

    def test_invalidation_is_source_scoped_and_attributed_acts_untouched(self):
        source = self.post("Changed source")
        before = self.sql("SELECT * FROM message_acts")
        scope = {"kind": "actor", "id": "agent-a"}
        checkpoint = self.store.view("agent-a", "changes", {"scope": scope})["checkpoint"]
        number = self.file("Improvement", source)
        answer = self.store.view("agent-a", "changes", {"scope": scope, "cursor": checkpoint})
        keys = [key for key in answer["items"] if key["resource_kind"] == "source_cover"]
        self.assertEqual([(key["resource_id"], key["version"]) for key in keys], [("t1", 1)], "source refresh intent commits with filing")
        self.assertEqual(self.sql("SELECT * FROM message_acts"), before)
        position = self.store.view("agent-a", "stack_positions", {"topic_id": "t1", "message_ids": [source]})["items"][0]["stack_position"]
        self.assertEqual(position["cover"]["items"][0]["number"], number)
        self.assertIn("cover_read_seq", position)

    def test_read_cost_is_independent_of_unrelated_items_and_releases(self):
        import sqlite3
        from aim_next.source_item_covers import project
        from aim_next.store import _connect
        source = self.post("Relevant source")
        self.file("Relevant item", source)
        def cost():
            db, _ = _connect(self.path)
            steps = [0]
            def tick():
                steps[0] += 1
                return 0
            db.set_progress_handler(tick, 1)
            try:
                rows = project(db, "owner", source, None)["items"]
                self.assertEqual(len(rows), 1)
                return steps[0]
            finally:
                db.close()
        self.committed(self.on(ships_in_releases=True))
        before = cost()
        # Isolated fixture history, deliberately unrelated to the loaded cover.
        with sqlite3.connect(str(self.path)) as db:
            for n in range(2, 502):
                db.execute("INSERT INTO pipeline_items VALUES ('w1',?,?,'',NULL,NULL,'','later','',?,'[]','',NULL,1)", (n, "Unrelated", n))
                db.execute("INSERT INTO pipeline_item_sources VALUES ('w1',?,1,NULL,NULL,'unrelated','owner',1)", (n,))
        for n in range(1, 31):
            self.store.record_release({"release": n, "commit": "%040x" % n, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [1000+n], "source": "backfill"})
        after = cost()
        print("757 read-cost VM instructions: before=%d after=%d; 500 unrelated items + 30 releases" % (before, after))
        self.assertLessEqual(after, before + 50, "unrelated 500-item growth adds at most 50 SQLite VM instructions")
        with sqlite3.connect(str(self.path)) as db:
            plan = db.execute("EXPLAIN QUERY PLAN SELECT * FROM pipeline_item_sources INDEXED BY source_cover_items WHERE message_id=?", (source,)).fetchall()
        self.assertTrue(any("SEARCH" in row[3] and "source_cover_items" in row[3] for row in plan), "reverse source lookup must seek its index")

    def test_index_migration_backfills_existing_release_links_and_reverses(self):
        from aim_next.migrations import migrate
        record = {"release": 1, "commit": "6" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [777], "source": "backfill"}
        self.store.record_release(record)
        self.assertTrue(migrate(self.path, "test-instance", target="61", binding=self.binding)["migrated"])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='source_cover_releases'"), [])
        self.assertTrue(migrate(self.path, "test-instance", target="62", binding=self.binding)["migrated"])
        self.assertEqual(self.sql("SELECT item,release FROM source_cover_releases"), [(777, 1)])
        self.assertFalse(migrate(self.path, "test-instance", target="62", binding=self.binding)["migrated"])

    def test_private_source_membership_and_same_number_in_different_outcomes(self):
        source = self.post("Shared dossier")
        hidden = self.post("Owner's private source", actor="owner", whisper=True, addressees=["agent-a"], reply_to=source)
        number = self.file("Private source work", hidden)
        self.assertEqual(self.rows(source, "agent-a")[0]["sources"], [hidden])
        self.assertEqual(self.rows(source, "agent-b"), [], "unreadable source cannot contribute a generated item row")
        self.committed(self.command("workspace.create", {"id": "w0", "title": "Other outcome", "team": ["agent-a"]}))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w0"}, {"pipeline_revision": 0}))
        other = self.committed(self.command("pipeline.item_add", {"title": "Same number", "sources": [{"message_id": source}]}, {"workspace_id": "w0"}))["number"]
        self.assertEqual(other, number)
        self.assertEqual([(r["workspace_id"], r["number"]) for r in self.rows(source)], [("w0", 1), ("w1", 1)], "default ordering keeps actual outcome identities even when numbers coincide")
        self.assertEqual([(r["workspace_id"], r["number"]) for r in self.rows(source, "agent-b")], [])

    def test_release_record_failure_rolls_back_record_relation_intent_then_retries(self):
        import sqlite3
        self.committed(self.on(ships_in_releases=True))
        source = self.post("Release with no work piece")
        number = self.file("One actual record", source)
        record = {"release": 1, "commit": "7" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [number], "source": "backfill"}
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER fail_release_intent BEFORE INSERT ON changes WHEN NEW.resource_kind='source_cover' BEGIN SELECT RAISE(ABORT,'fixture release intent failure'); END")
        before = self.records()
        from aim_next.contract import StoreError
        with self.assertRaises(StoreError):
            self.store.record_release(record)
        self.assertEqual(self.records(), before, "release, normalized relationship and refresh intent roll back together")
        self.assertEqual(self.state(source), "Now")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER fail_release_intent")
        self.assertTrue(self.store.record_release(record)["recorded"])
        self.assertEqual(self.sql("SELECT item,release FROM source_cover_releases"), [(number, 1)])
        self.assertEqual(self.state(source), "Live · release 1")

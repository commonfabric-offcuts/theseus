from __future__ import annotations

import datetime
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

from aim_next import Store
from aim_next.contract import Refusal
from aim_next.profile import write_profile
import test_pipeline_steering as steering


class ClockCase(steering.PipelineCase):
    def setUp(self):
        super().setUp()
        self.now = 1_800_000_000_000
        for module in ("delivery", "pipeline", "conversation", "store"):
            patch = mock.patch("aim_next.%s._now_ms" % module, side_effect=lambda: self.now)
            patch.start(); self.addCleanup(patch.stop)
        if hasattr(self.store, "_clock_state"):
            patch = mock.patch("aim_next.piece_clock._now_ms", side_effect=lambda: self.now)
            patch.start(); self.addCleanup(patch.stop)
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build", "rounds": "split"}, {"stage_id": "review", "name": "Review"})
        self.build_topic("clock-work")
        self.add("Clock fixture", section="now", size="small")
        self.assignment = {"kind": "message", "id": self.post("Assign clock fixture", actor="agent-a"), "revision": 1}
        self.lane_source = {"kind": "message", "id": self.post("My explicit estimate", actor="agent-b"), "revision": 1}
        self.piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "clock-work", "stage_id": "build"}, {"workspace_id": "w1"}))["piece_id"]

    def clock(self, actor="owner", piece=None):
        result = self.store.view(actor, "pipeline_clock", {"piece_id": piece or self.piece})
        self.assertNotIn("error", result, result)
        return result

    def event(self, kind, actor="agent-b", revision=None, source=None, **fields):
        if revision is None:
            revision = self.clock()["record"]["revision"]
        return self.command("pipeline.clock_record", dict(kind=kind, source=source or self.lane_source, **fields),
                            {"piece_id": self.piece}, {"clock_revision": revision}, actor=actor)

    def bind(self, lane="agent-b", work_class="page"):
        return self.committed(self.event("lane", actor="agent-a", source=self.assignment, lane=lane, work_class=work_class))

    def forecast(self, id="live-one", milestone="live", deadline=None, anchor="build"):
        return self.committed(self.event("forecast", id=id, milestone=milestone, anchor=anchor,
                                           deadline_ms=self.now+60000 if deadline is None else deadline, reason="Own explicit forecast"))

    def push(self, occurred=None, id="push-one", head="4" * 40):
        return self.committed(self.event("push", id=id, head=head, occurred_ms=self.now if occurred is None else occurred,
                             receipt={"remote": "origin", "ref": "refs/heads/fixture", "observed_ms": self.now,
                                      "evidence": "isolated receipt", "uncertainty_ms": 0}))

    def live(self, numbers=(1,), number=1):
        moment = datetime.datetime.fromtimestamp(self.now/1000, datetime.timezone.utc).isoformat()
        return self.store.record_release({"release": number, "commit": str(number % 10) * 40, "deployed_at": moment,
                                          "items": list(numbers), "source": "backfill"})

    def cohort(self, pieces=None, **args):
        result = self.store.view("owner", "pipeline_predictions", dict(workspace_id="w1", piece_ids=pieces or [self.piece], **args))
        self.assertNotIn("error", result, result)
        return result

    def notices(self):
        return self.sql("SELECT id,body,addressees FROM messages WHERE author_id='theseus' AND body LIKE 'Forecast for piece %' ORDER BY seq")

    def test_missing_lane_estimate_and_original_are_explicit_without_guessing_the_creator(self):
        result = self.clock()
        self.assertIsNone(result["clock"]["lane"])
        self.assertEqual(result["clock"]["estimate_status"], "no estimate yet")
        self.assertEqual(result["clock"]["original_prediction_status"], "unavailable")
        self.assertEqual(result["clock"]["first_build"]["entered_ms"], self.now)
        self.assertIsNone(result["clock"]["first_push"])
        self.assertIsNone(result["clock"]["first_live"])
        self.assertNotIn("median", json.dumps(result).lower())

    def test_only_authenticated_steerers_bind_and_lane_history_survives_reassignment(self):
        self.rejected(self.event("lane", revision=0, lane="agent-b", work_class="core"), "FORBIDDEN")
        first = self.bind(work_class="core")
        self.rejected(self.event("segment", revision=0, id="stale", mode="source", start_ms=self.now), "REVISION_CONFLICT")
        self.now += 1000
        second = self.bind(lane="agent-a", work_class="core")
        self.assertEqual([r["lane"] for r in second["record"]["lanes"]], ["agent-b", "agent-a"])
        self.assertEqual(first["clock_revision"], 1)
        self.rejected(self.event("segment", actor="agent-b", id="old-lane", mode="resume", start_ms=self.now), "FORBIDDEN")
        self.committed(self.event("segment", actor="agent-a", id="new-lane", mode="resume", start_ms=self.now))
        self.assertEqual(self.store.view("outsider", "pipeline_clock", {"piece_id": self.piece})["error"]["code"], "FORBIDDEN")

    def test_same_operation_replay_keeps_the_complete_original_record_and_new_id_cannot_rewrite_an_event(self):
        self.bind()
        revision = self.clock()["record"]["revision"]
        envelope = self.envelope("pipeline.clock_record", {"piece_id": self.piece},
                                 {"kind": "segment", "id": "physical-source", "mode": "source", "start_ms": self.now, "source": self.lane_source},
                                 {"clock_revision": revision}, op="clock-original")
        first = self.store.command("agent-b", envelope)
        self.committed(first)
        self.now += 5000
        restored = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(restored.command("agent-b", envelope), first)
        self.assertEqual(self.clock()["record"]["revision"], revision+1)
        self.rejected(self.event("segment", id="physical-source", mode="source", start_ms=self.now), "CLOCK_EVENT_EXISTS")

    def test_atomic_build_prediction_is_original_and_revisions_keep_separate_accuracy(self):
        self.build_topic("atomic-clock")
        self.add("Atomic original", section="now", size="small")
        self.now += 1000
        start = self.now
        forecast = {"kind": "forecast", "id": "original-live", "milestone": "live", "anchor": "build", "deadline_ms": start+120000,
                    "reason": "Lane's original live estimate", "source": self.lane_source}
        original_piece = self.piece
        self.piece = self.committed(self.command("pipeline.piece_start", {
            "numbers": [2], "topic_id": "atomic-clock", "stage_id": "build",
            "clock": {"lane": "agent-b", "work_class": "page", "source": self.assignment, "forecasts": [forecast]}}, {"workspace_id": "w1"}))["piece_id"]
        self.now += 60000
        self.committed(self.event("revise", id="original-live", deadline_ms=start+240000, reason="Actual remaining work changed"))
        self.now = start+180000
        self.live(numbers=(2,))
        clock = self.clock()["clock"]
        self.assertEqual(clock["build_to_live_ms"], 180000)
        revisions = clock["original_live_prediction"]["revisions"]
        self.assertEqual([r["signed_error_ms"] for r in revisions], [60000, -60000])
        self.assertEqual([r["absolute_error_ms"] for r in revisions], [60000, 60000])
        self.assertEqual(revisions[0]["recorded_ms"], start)
        cohort = self.cohort([self.piece, original_piece])
        self.assertEqual(cohort["counts"]["prediction_scored"], 1)
        self.assertEqual(cohort["counts"]["prediction_within_target"], 1)

    def test_a_later_build_anchored_forecast_never_fills_missing_original_or_wins_the_denominator(self):
        self.bind()
        self.now += 1000
        self.forecast()
        self.now += 1000
        self.live()
        clock = self.clock()["clock"]
        self.assertEqual(clock["estimate_status"], "provided")
        self.assertIsNone(clock["original_live_prediction"])
        self.assertFalse(clock["forecasts"][0]["at_build"])
        counts = self.cohort()["counts"]
        self.assertEqual((counts["completed"], counts["prediction_eligible"], counts["prediction_scored"], counts["missing_original_prediction"]), (1, 1, 0, 1))
        self.assertEqual(counts["prediction_within_target"], 0)

    def test_coordinator_cannot_invent_the_lanes_build_entry_forecast_from_its_own_words(self):
        self.build_topic("bad-estimate")
        self.add("No invented estimate", section="now", size="small")
        result = self.command("pipeline.piece_start", {
            "numbers": [2], "topic_id": "bad-estimate", "stage_id": "build",
            "clock": {"lane": "agent-b", "work_class": "core", "source": self.assignment, "forecasts": [
                {"kind": "forecast", "id": "invented", "milestone": "live", "anchor": "build", "deadline_ms": self.now+60000,
                 "reason": "Coordinator substitute", "source": self.assignment}]}}, {"workspace_id": "w1"})
        self.rejected(result, "INVALID_CLOCK_SOURCE")
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_pieces WHERE topic_id='bad-estimate'"), [(0,)])

    def test_resumed_segments_and_stage_rounds_keep_the_first_machine_build(self):
        self.bind()
        start = self.now
        self.committed(self.event("segment", id="source-one", mode="source", start_ms=start))
        self.now += 60000
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "review", "left_outcome": "passed"}, {"piece_id": self.piece}, {"piece_revision": self.item(1)["piece"]["version"]}))
        self.now += 60000
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "build", "round": 2, "left_outcome": "passed"}, {"piece_id": self.piece}, {"piece_revision": self.item(1)["piece"]["version"]}))
        self.committed(self.event("segment", id="source-resume", mode="resume", start_ms=self.now))
        self.forecast(id="resumed", milestone="push", anchor="source-resume")
        clock = self.clock()
        self.assertEqual(clock["clock"]["first_build"]["entered_ms"], start)
        self.assertEqual(clock["clock"]["elapsed_since_build_ms"], 120000)
        self.assertEqual(clock["clock"]["forecasts"][0]["anchor"]["ms"], self.now)
        self.assertEqual([s["mode"] for s in clock["record"]["segments"]], ["source", "resume"])

    def test_late_push_receipt_keeps_occurrence_observation_and_recording_separate(self):
        self.bind()
        start = self.now
        self.now += 20000
        self.push(occurred=start+5000)
        self.now += 20000
        self.push(id="push-two", head="5"*40)
        self.now += 10000
        self.live()
        clock = self.clock()["clock"]
        self.assertEqual(clock["build_to_push_ms"], 5000)
        self.assertEqual(clock["push_to_live_ms"], 45000)
        self.assertEqual(clock["first_push"]["recorded_ms"], start+20000)
        self.assertEqual(clock["first_push"]["receipt"]["observed_ms"], start+20000)
        self.assertEqual(clock["first_push"]["head"], "4"*40)

    def test_a_wall_clock_rollback_on_resume_cannot_replace_the_first_build_event(self):
        self.bind()
        original = self.clock()["clock"]["first_build"]
        self.now += 1000
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "review", "left_outcome": "passed"},
                                   {"piece_id": self.piece}, {"piece_revision": self.item(1)["piece"]["version"]}))
        # Real public stage entry under an earlier wall reading; no immutable
        # row is edited and no private record is fabricated.
        self.now = original["entered_ms"]-1000
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "build", "round": 2, "left_outcome": "passed"},
                                   {"piece_id": self.piece}, {"piece_revision": self.item(1)["piece"]["version"]}))
        self.now = original["entered_ms"]+2000
        self.assertEqual(self.clock()["clock"]["first_build"], original)

    def test_a_verified_push_before_late_machine_build_is_retained_as_distinct_chronology(self):
        self.bind(work_class="core")
        build = self.now
        self.now += 2000
        self.push(occurred=build-5000)
        self.now += 1000
        self.live()
        clock = self.clock()["clock"]
        self.assertEqual(clock["first_build"]["entered_ms"], build)
        self.assertEqual(clock["first_push"]["occurred_ms"], build-5000)
        self.assertEqual(clock["build_to_push_ms"], -5000)
        self.assertTrue(clock["push_precedes_build"])
        self.assertEqual(clock["first_push"]["recorded_ms"], build+2000)

    def test_push_or_an_unrelated_release_cannot_mark_the_live_prediction_achieved(self):
        self.bind()
        self.forecast()
        self.push()
        self.now += 1000
        self.live(numbers=(99,))
        self.assertEqual(self.clock()["clock"]["forecasts"][0]["status"], "unfinished")
        self.live(numbers=(1,), number=2)
        self.assertEqual(self.clock()["clock"]["forecasts"][0]["status"], "achieved")

    def test_a_prior_release_is_reconciled_by_exact_number_without_backfilling_from_a_message(self):
        self.bind()
        self.now += 1000
        record = self.live()
        self.sql("SELECT number FROM releases WHERE number=1")
        # Model a release predating this capability by removing only its derived
        # exact-key index in this isolated store; immutable releases stay intact.
        import sqlite3
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM metadata WHERE key='piece_clock.v1:live:1'")
        self.assertIsNone(self.clock()["clock"]["first_live"])
        self.rejected(self.event("release", release=1), "FORBIDDEN")
        self.committed(self.event("release", actor="agent-a", release=1, source=self.assignment))
        self.assertEqual(self.clock()["clock"]["first_live"]["recorded_ms"], record["release"]["recorded_ms"])

    def test_interval_unions_preserve_overlaps_and_unclassified_time(self):
        self.bind()
        start = self.now
        self.now += 20000
        for id, phase, a, b in (("write", "writing", 0, 15000), ("fix", "repair", 5000, 12000), ("test-1", "test", 8000, 10000), ("hold", "wait", 0, 18000)):
            fields = {"imposed_by": "agent-a", "rule": "named fixture hold"} if phase == "wait" else {}
            self.committed(self.event("interval", id=id, phase=phase, start_ms=start+a, end_ms=start+b, terminal="complete", **fields))
        total = self.clock()["clock"]["timings"]
        self.assertEqual([total[k] for k in ("writing_ms", "repair_ms", "test_ms", "wait_ms")], [15000, 7000, 2000, 18000])
        self.assertEqual((total["classified_ms"], total["overlap_excess_ms"], total["unclassified_ms"]), (18000, 24000, 2000))
        self.assertFalse(self.clock()["clock"]["stage_chronology_is_labor"])

    def test_interrupted_attempt_remains_open_and_its_final_failure_cannot_be_replaced_with_pass(self):
        self.bind()
        start = self.now
        self.committed(self.event("interval", id="physical-1", phase="test", start_ms=start, end_ms=None))
        self.now += 2000
        self.assertEqual(self.clock()["clock"]["timings"]["incomplete_attempts"], ["physical-1"])
        self.committed(self.event("interval", id="physical-1", phase="test", start_ms=start, end_ms=self.now, terminal="cancelled"))
        self.rejected(self.event("interval", id="physical-1", phase="test", start_ms=start, end_ms=self.now, terminal="passed"), "CLOCK_EVENT_EXISTS")
        self.assertEqual(self.clock()["record"]["intervals"][0]["terminal"], "cancelled")

    def test_small_page_target_is_separate_from_core_and_cohort_window_is_explicit(self):
        self.bind(work_class="core")
        self.now += 60000
        self.live()
        cohort = self.cohort()
        self.assertEqual(cohort["counts"]["completed"], 1)
        self.assertEqual(cohort["counts"]["small_page_eligible"], 0)
        self.assertEqual(cohort["worst"]["piece_id"], self.piece)
        self.assertEqual(cohort["cohort"]["selection"], "explicit_pieces")
        self.assertEqual(self.cohort(until_ms=self.now)["counts"]["completed"], 0)
        self.assertEqual(self.cohort(work_class="page")["items"], [])

    def test_slip_is_strictly_over_one_hour_and_emitted_once_across_restart_and_revision(self):
        self.bind()
        deadline = self.now+1000
        self.forecast(deadline=deadline)
        self.now = deadline+3600000
        self.store.settle_health_due(self.now)
        self.assertEqual(self.notices(), [])
        self.now += 1
        self.store.settle_health_due(self.now)
        self.assertEqual(len(self.notices()), 1)
        self.assertEqual(json.loads(self.notices()[0][2]), ["owner"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.committed(self.event("revise", id="live-one", deadline_ms=self.now+1000, reason="Revised after original slip"))
        self.now += 7200000
        self.store.settle_health_due(self.now)
        self.assertEqual(len(self.notices()), 1)
        self.assertEqual(self.clock()["record"]["forecasts"][0]["notice"]["message_id"], self.notices()[0][0])

    def test_applied_publication_failure_rolls_back_the_message_then_restoration_publishes_once(self):
        self.bind()
        deadline = self.now+1000
        self.forecast(deadline=deadline)
        self.now = deadline+3600001
        publish = self.store._publish
        applied = []
        def fail_after_mutation(*args, **kwargs):
            result = publish(*args, **kwargs)
            if args[1] == "theseus" and args[4]["body"].startswith("Forecast for piece"):
                applied.append(result[0]["message_id"])
                raise Refusal("CLOCK_TEST_AFTER_PUBLICATION", "Applied isolated publication fault")
            return result
        with mock.patch.object(self.store, "_publish", side_effect=fail_after_mutation):
            self.store.settle_health_due(self.now)
        self.assertEqual(len(applied), 1, "the fault follows a real inserted message/delivery")
        self.assertEqual(self.notices(), [], "the whole notice and delivery effect rolled back")
        self.assertEqual(self.clock()["record"]["forecasts"][0]["notice_error"]["code"], "CLOCK_TEST_AFTER_PUBLICATION")
        self.now += 60000
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.store.settle_health_due(self.now)
        self.assertEqual(len(self.notices()), 1)
        self.assertIsNotNone(self.clock()["record"]["forecasts"][0]["notice"])

    def test_linked_previously_communicated_slip_prevents_an_automatic_duplicate(self):
        self.bind()
        deadline = self.now+1000
        self.forecast(deadline=deadline)
        said = self.post("The original forecast slipped; current cause retained.", actor="agent-b", addressees=["owner"], intent="tell")
        self.committed(self.event("notice_link", id="live-one", message_id=said, reason="Already communicated original slip"))
        self.now = deadline+7200000
        self.store.settle_health_due(self.now)
        self.assertEqual(self.notices(), [])
        self.assertEqual(self.clock()["record"]["forecasts"][0]["notice"]["message_id"], said)

    def test_clock_reads_are_exact_key_scoped_and_schema_does_not_change(self):
        before = self.sql("SELECT name,sql FROM sqlite_master ORDER BY name")
        self.bind()
        import aim_next.store as storage
        original, trace = storage._connect, []
        def traced(*args, **kwargs):
            db, settings = original(*args, **kwargs)
            db.set_trace_callback(trace.append)
            return db, settings
        with mock.patch.object(storage, "_connect", side_effect=traced):
            self.clock()
        metadata = [q for q in trace if "FROM metadata" in q]
        self.assertTrue(metadata)
        self.assertTrue(all("WHERE key" in q for q in metadata), metadata)
        self.assertFalse(any("FROM releases" in q and "WHERE number=" not in q for q in trace), trace)
        self.assertEqual(self.sql("SELECT name,sql FROM sqlite_master ORDER BY name"), before)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [("69",)])

    def cli(self, *args, actor="agent-b"):
        from aim_next.cli import main
        profile = Path(self.temp.name).resolve() / (actor + "-clock.json")
        if not profile.exists():
            write_profile(profile, str(self.path.resolve()), "test-instance", actor, binding=self.binding)
        out, err = io.StringIO(), io.StringIO()
        result = main(["--profile", str(profile)] + list(args), stdin=io.BytesIO(), stdout=out, stderr=err)
        return result, out.getvalue(), err.getvalue()

    def test_cli_records_reads_and_predictions_use_the_same_core_contract(self):
        event = Path(self.temp.name) / "lane-event.json"
        event.write_text(json.dumps({"kind": "lane", "lane": "agent-b", "work_class": "core", "source": self.assignment}))
        result, out, err = self.cli("clock-record", self.piece, "--expected", "0", str(event), actor="owner")
        self.assertEqual((result, err), (0, ""), out)
        self.assertIn("recorded clock revision1", out)
        code, out, err = self.cli("clock", self.piece)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("no estimate yet", out)
        self.assertIn("lane agent-b", out)
        code, out, err = self.cli("predictions", "w1", "--pieces", self.piece)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Explicit cohort", out)
        self.assertNotIn("median", out.lower())

    def test_clock_run_records_actual_child_effect_and_never_relaunches_the_same_physical_attempt(self):
        self.bind()
        marker = Path(self.temp.name) / "child-effect.txt"
        code = "from pathlib import Path\np=Path(%r)\np.write_text((p.read_text() if p.exists() else '')+'ran\\n')\n" % str(marker)
        args = ("clock-run", self.piece, "--attempt", "physical-child", "--source", self.lane_source["id"], "--source-revision", "1", "--argv", json.dumps([sys.executable, "-I", "-c", code]))
        with mock.patch("aim_next.cli_clock._ms", side_effect=lambda: self.now):
            status, out, err = self.cli(*args)
        self.assertEqual((status, err), (0, ""), out)
        self.assertEqual(marker.read_text(), "ran\n")
        self.assertEqual(self.clock()["record"]["intervals"][0]["terminal"], "exit:0")
        status, _, err = self.cli(*args)
        self.assertEqual(status, 2)
        self.assertIn("CLOCK_EVENT_EXISTS", err)
        self.assertEqual(marker.read_text(), "ran\n", "the same physical attempt did not run twice")

    def test_clock_source_rejects_future_and_stale_revisions_without_mutating(self):
        self.bind()
        before = self.clock()["record"]
        future = dict(self.lane_source, revision=999)
        self.rejected(self.event("segment", source=future, id="forged", mode="source", start_ms=self.now), "INVALID_CLOCK_SOURCE")
        self.assertEqual(self.clock()["record"], before)
        self.committed(self.command("message.edit", {"body": "My revised estimate source"},
                                   {"message_id": self.lane_source["id"]}, {"message_revision": 1}, actor="agent-b"))
        self.rejected(self.event("segment", id="stale-source", mode="source", start_ms=self.now), "INVALID_CLOCK_SOURCE")
        current = dict(self.lane_source, revision=2)
        self.committed(self.event("segment", source=current, id="current-source", mode="source", start_ms=self.now))
        self.assertEqual(self.clock()["record"]["segments"][0]["source"], current)

    def test_actual_live_without_a_build_stays_completed_with_a_missing_build_metric(self):
        self.build_topic("review-only")
        self.add("Missing historical Build", section="now", size="small")
        review = self.committed(self.command("pipeline.piece_start", {
            "numbers": [2], "topic_id": "review-only", "stage_id": "review"}, {"workspace_id": "w1"}))["piece_id"]
        self.now += 1000
        self.live(numbers=(2,))
        clock = self.clock(piece=review)["clock"]
        self.assertIsNone(clock["first_build"])
        self.assertEqual(clock["first_live"]["release"], 1)
        self.assertIsNone(clock["build_to_live_ms"])
        counts = self.cohort([review])["counts"]
        self.assertEqual((counts["completed"], counts["eligible"], counts["missing_build"]), (1, 0, 1))

    def test_restart_after_late_completion_keeps_one_notice_with_actual_elapsed(self):
        self.bind()
        start = self.now
        deadline = start+1000
        self.forecast(deadline=deadline)
        self.now = deadline+3600001
        # The actual release commits while notice settling is unavailable.
        with mock.patch.object(self.store, "_clock_settle_due", return_value=False):
            self.live()
        self.assertEqual(self.notices(), [])
        actual = self.now
        self.now += 7200000
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.store.settle_health_due(self.now)
        self.assertEqual(len(self.notices()), 1)
        self.assertIn("was more than one hour late", self.notices()[0][1])
        self.assertIn(str(actual-start)+"ms", self.notices()[0][1])
        self.assertEqual(self.clock()["clock"]["first_live"]["occurred_ms"], actual)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.now += 60000
        self.store.settle_health_due(self.now)
        self.assertEqual(len(self.notices()), 1)

    def test_timely_push_and_live_do_not_send_slips_on_a_later_restart(self):
        self.bind()
        deadline = self.now+1000
        self.forecast(id="timely-live", deadline=deadline)
        self.forecast(id="timely-push", milestone="push", deadline=deadline)
        self.now = deadline+3600000
        self.push()
        self.live()
        self.now += 7200000
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.store.settle_health_due(self.now)
        self.assertEqual(self.notices(), [])
        self.assertEqual([f["status"] for f in self.clock()["clock"]["forecasts"]], ["achieved", "achieved"])

    def test_invalid_event_and_cohort_types_refuse_before_any_clock_mutation(self):
        self.bind()
        before = self.clock()["record"]
        self.rejected(self.event([], id="bad"), "INVALID_ARGUMENT")
        result = self.store.view("owner", "pipeline_predictions", {"workspace_id": "w1", "piece_ids": [{}]})
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.clock()["record"], before)


if __name__ == "__main__":
    unittest.main()

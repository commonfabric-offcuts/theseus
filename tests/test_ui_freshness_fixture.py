from __future__ import annotations

import http.client
import hashlib
import importlib.util
import json
import select
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
from types import SimpleNamespace


class FixtureCase(unittest.TestCase):
    fixture_flags = ()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.process = subprocess.Popen([sys.executable, "tests/fixtures/ui_http.py", "--freshness", "--images"] + list(self.fixture_flags),
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr,
                                        text=True, bufsize=1)
        self.counter = 0
        self.expected_exit = 0
        self.ready = self.control("ready")
        self.pool = ThreadPoolExecutor(max_workers=3)

    def tearDown(self):
        # Private stdin EOF releases fixture-owned holds and closes its server.
        self.process.stdin.close()
        self.pool.shutdown(wait=True)
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, self.expected_exit)
        self.process.stdout.close()
        self.stderr.seek(0)
        errors = self.stderr.read()
        self.stderr.close()
        if self.expected_exit:
            self.assertIn("Private fixture hold", errors)
        else:
            self.assertEqual(errors, "")
        self.tmp.cleanup()

    def control(self, method, **args):
        self.counter += 1
        self.process.stdin.write(json.dumps(dict(args, method=method, id=self.counter)) + "\n")
        self.process.stdin.flush()
        self.assertTrue(select.select([self.process.stdout], [], [], 10)[0], "Fixture control timed out")
        answer = json.loads(self.process.stdout.readline())
        self.assertEqual(answer["id"], self.counter)
        self.assertNotIn("failure", answer)
        return answer["answer"]

    def view(self, name, args=None, read_class="foreground"):
        return self.http_request("/api/view", {"name": name, "args": args or {}}, read_class)

    def http_request(self, path, payload, read_class="foreground", method="POST", extra=None):
        url = urlsplit(self.ready["origin"])
        conn = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
        try:
            headers = {
                "Authorization": "Bearer " + self.ready["token"], "Origin": self.ready["origin"],
                "Content-Type": "application/json"}
            if read_class is not None:
                headers["X-AIM-Read-Class"] = read_class
            headers.update(extra or {})
            conn.request(method, path, payload if isinstance(payload, bytes) else json.dumps(payload), headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def events_until(self, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            events = self.control("admission_events", after=0)
            if predicate(events):
                return events
            time.sleep(0.005)
        self.fail("Expected fixture event did not arrive")


class FreshnessFixtureTests(FixtureCase):
    def test_editor_state_fault_targets_only_the_selected_source(self):
        modal = {"kind": "message", "id": self.ready["sources"][0]["id"]}
        body = {"error": {"code": "FORBIDDEN", "retryable": False}}
        self.control("read_fault", name="editor_state", source_ref=modal,
                     read_class="background", status=200, body=body, count=1)
        _, inline = self.view("editor_state", {"source_ref": {"kind": "topic", "id": "t1"}, "topic_id": "t1"}, "background")
        self.assertNotIn("error", inline, "a source-specific fault must not be consumed by the inline editor")
        _, refused = self.view("editor_state", {"source_ref": modal, "topic_id": "t1"}, "background")
        self.assertEqual(refused["error"]["code"], "FORBIDDEN")
        _, restored = self.view("editor_state", {"source_ref": modal, "topic_id": "t1"}, "background")
        self.assertNotIn("error", restored, "the selected fault is consumed exactly once")

    def test_timed_read_delay_holds_the_actual_admitted_permit(self):
        self.control("read_delay", name="topic", read_class="foreground", ms=120)
        pending = self.pool.submit(self.view, "topic", {"topic_id": "t1"})
        entered = self.events_until(lambda r: any(e["event"] == "delay-enter" for e in r["events"]))
        delay = next(e for e in entered["events"] if e["event"] == "delay-enter")
        self.assertIsNotNone(delay["request_id"])
        self.assertEqual(delay["read_class"], "foreground")
        held = entered["lanes"]["foreground"]["active"]
        was_pending = not pending.done()
        self.assertEqual(self.view("topic", {"topic_id": "t1"}, "background")[0], 200)
        self.assertEqual(pending.result(timeout=1)[0], 200)
        finished = self.events_until(lambda r: r["lanes"]["foreground"]["active"] == 0)
        events = [e for e in finished["events"] if e.get("request_id") == delay["request_id"]]
        start = next(e for e in events if e["event"] == "delay-enter")
        end = next(e for e in events if e["event"] == "delay-exit")
        self.assertGreaterEqual(end["at"] - start["at"], 0.110, "the delay actually runs inside the permit")
        self.assertEqual(held, 1)
        self.assertTrue(was_pending)
        order = [e["event"] for e in events]
        sequence = ["granted", "callback-enter", "delay-enter", "delay-exit", "callback-exit", "close-enter", "close-exit", "released"]
        self.assertEqual(sorted(sequence, key=order.index), sequence)
        self.assertFalse(any(e["event"] == "delay-enter" and e["read_class"] == "background" for e in finished["events"]))
        self.control("read_delay", ms=0)
        after = finished["next"]
        self.assertEqual(self.view("topic", {"topic_id": "t1"})[0], 200)
        self.assertFalse(any(e["event"] == "delay-enter" for e in self.control("admission_events", after=after)["events"]))

    def test_fixture_agent_commits_are_attributed_and_reads_do_not_ack(self):
        before = self.control("counts")
        receipt = self.control("agent_message", operation_id="fixture-new-message", body="Incoming exact body",
                               topic_id="t1", addressees=[])
        self.assertEqual(receipt["status"], "committed")
        status, source = self.view("source", {"source_ref": {"kind": "message", "id": receipt["result"]["message_id"]}})
        self.assertEqual(status, 200)
        self.assertEqual(source["author"], "fixture-notebook-agent")
        self.assertEqual(source["body"], "Incoming exact body")
        revised = self.control("memory_revise", operation_id="fixture-new-revision", item_id="fixture-notebook",
                               expected_revision=1, title="New title", body="New Notebook body")
        self.assertEqual(revised["status"], "committed")
        status, source = self.view("source", {"source_ref": {"kind": "memory", "id": "fixture-notebook", "revision": 2}})
        self.assertEqual((status, source["body"], source["current_revision"]), (200, "New Notebook body", 2))
        after = self.control("counts")
        self.assertEqual(after["messages"], before["messages"] + 1)
        self.assertEqual(after["operations"], before["operations"] + 4)
        self.assertEqual(after["http_commands"], 0)
        self.assertEqual(after["http_delivery_acks"], 0)
        self.assertEqual(after["acknowledged_deliveries"], before["acknowledged_deliveries"])
        seeded = self.control("seed", messages=31, memory_items=21, unrelated_records=1000)
        self.assertEqual(len(seeded["message_ids"]), 31)
        self.assertEqual(len(seeded["item_ids"]), 21)
        self.assertEqual(seeded["unrelated_changes"], 1000)
        self.assertEqual(self.control("counts")["messages"], after["messages"] + 31)

    def test_a_teammate_who_wrote_says_where_it_stands_and_hears_nothing_next(self):
        # The controls the native work check drives, without a browser.
        agent, participant = "fixture-planning-agent", "fixture-notebook-agent"
        refused = self.control("agent_state", operation_id="writer-early", sender=agent, args={"state": "review"})
        self.assertEqual(refused["status"], "rejected", refused)
        posted = self.control("agent_message", operation_id="writer-posts", sender=agent, member=True, body="I will take this one.")
        self.assertNotIn("joined", posted["result"])
        said = self.control("agent_state", operation_id="writer-says", sender=agent, args={"state": "review", "note": "Ready to read"})
        self.assertEqual(said["status"], "committed", said)
        self.assertEqual((said["result"]["state"], said["result"]["state_by"]), ("review", agent))
        _, topic = self.view("topic", {"topic_id": "t1"})
        self.assertNotIn(agent, [row["actor_id"] for row in topic["participants"]])
        before = self.control("deliveries_to", actors=[agent, participant])
        self.control("agent_message", operation_id="writer-next", sender="person", whole_topic=True, body="Reading it now.")
        after = self.control("deliveries_to", actors=[agent, participant])
        self.assertEqual((after[agent] - before[agent], after[participant] - before[participant]), (0, 1))

    def test_an_ask_in_another_outcome_waits_on_the_reader_there_until_they_answer(self):
        # The control the native rail check drives, without a browser.
        _, before = self.view("attention", {"workspace_id": "w1"})
        self.assertEqual(before["waiting_outcomes"], {"count": 0, "here": False})
        asked = self.control("elsewhere_ask", operation_id="rail-ask", body="Which deck do we send?")
        _, here = self.view("attention", {"workspace_id": "w1"})
        self.assertEqual(here["waiting_outcomes"], {"count": 1, "here": False})
        _, there = self.view("attention", {"workspace_id": asked["workspace_id"]})
        self.assertEqual(there["waiting_outcomes"], {"count": 1, "here": True})
        self.control("agent_message", operation_id="rail-answer", sender="person", topic_id=asked["topic_id"],
                     whole_topic=True, body="The short one.")
        _, after = self.view("attention", {"workspace_id": "w1"})
        self.assertEqual(after["waiting_outcomes"], {"count": 0, "here": False})

    def test_command_and_ack_counters_have_a_positive_control(self):
        self.control("agent_message", operation_id="counter-source", body="Counter control",
                     topic_id="t1", addressees=[self.ready["actor"]])
        before = self.control("counts")
        _, delivery = self.view("deliveries", {"limit": 5})
        _, capabilities = self.view("capabilities")
        self.assertEqual(self.control("counts")["acknowledged_deliveries"], before["acknowledged_deliveries"])
        authority = {key: capabilities["authority"][key] for key in ("authority_id", "authority_epoch")}
        status, receipt = self.http_request("/api/command", {
            "v": 1, "instance_id": self.ready["instance_id"], "operation_id": "counter-ack",
            "kind": "delivery.ack", "target": {"delivery_id": delivery["items"][0]["id"]},
            "expected": {"authority": authority}, "args": {}})
        self.assertEqual((status, receipt["status"]), (200, "committed"))
        after = self.control("counts")
        self.assertEqual(after["http_commands"], before["http_commands"] + 1)
        self.assertEqual(after["http_delivery_acks"], before["http_delivery_acks"] + 1)
        self.assertEqual(after["acknowledged_deliveries"], before["acknowledged_deliveries"] + 1)
        self.assertEqual(after["operations"], before["operations"] + 1)

    def test_callback_close_holds_faults_and_admission_observations(self):
        self.control("read_hold", hold_id="callback-hold", phase="callback", name="topic", read_class="background", count=1)
        self.control("read_hold", hold_id="close-hold", phase="close", name="topic", read_class="background", count=1)
        pending = self.pool.submit(self.view, "topic", {"topic_id": "t1"}, "background")
        entered = self.events_until(lambda r: any(e.get("hold_id") == "callback-hold" and e["event"] == "hold-enter" for e in r["events"]))
        request_id = next(e["request_id"] for e in entered["events"] if e.get("hold_id") == "callback-hold")
        self.assertEqual(entered["lanes"]["background"]["active"], 1)
        self.assertEqual(self.view("topic", {"topic_id": "t1"})[0], 200)

        self.assertFalse(pending.done())
        self.control("read_release", hold_id="callback-hold")
        closing = self.events_until(lambda r: any(e.get("hold_id") == "close-hold" and e["event"] == "hold-enter" for e in r["events"]))
        self.assertEqual(closing["lanes"]["background"]["active"], 1)
        self.assertEqual(self.view("topic", {"topic_id": "t1"})[0], 200)
        self.assertFalse(pending.done())
        self.control("read_release", hold_id="close-hold")
        self.assertEqual(pending.result(timeout=1)[0], 200)
        finished = self.events_until(lambda r: r["lanes"]["background"]["active"] == 0)
        sequence = [e["event"] for e in finished["events"] if e.get("request_id") == request_id]
        for a, b in (("granted", "callback-enter"), ("callback-exit", "close-enter"), ("close-exit", "released")):
            self.assertLess(sequence.index(a), sequence.index(b))
        for grant in (e for e in finished["events"] if e["event"] == "granted"):
            callback = next(e for e in finished["events"] if e["event"] == "callback-enter" and e["request_id"] == grant["request_id"])
            self.assertEqual(callback["read_class"], grant["read_class"])
        self.control("read_fault", name="topic", status=200, body={"error": {"code": "AUTHORITY_CHANGED", "retryable": False}}, count=1)
        status, body = self.view("topic", {"topic_id": "t1"})
        self.assertEqual((status, body["error"]["code"]), (200, "AUTHORITY_CHANGED"))
        self.control("read_fault", name="topic", status=503, body={"error": {"code": "SERVER_BUSY", "retryable": True}}, count=1)
        status, body = self.view("topic", {"topic_id": "t1"})
        self.assertEqual((status, body["error"]["code"]), (503, "SERVER_BUSY"))
        self.assertEqual(self.view("topic", {"topic_id": "t1"})[0], 200)

    def test_bootstrap_fault_uses_typed_store_refusal(self):
        self.control("read_fault", name="bootstrap", status=200,
                     body={"error": {"code": "AUTHORITY_CHANGED", "retryable": False}}, count=1)
        status, body = self.http_request("/api/bootstrap", {}, method="GET")
        self.assertEqual((status, body["error"]["code"]), (409, "AUTHORITY_CHANGED"))
        self.assertFalse(body["recorded"])

    def test_media_publication_counter_has_an_http_positive_control(self):
        _, capabilities = self.view("capabilities")
        authority = {key: capabilities["authority"][key] for key in ("authority_id", "authority_epoch")}
        content = b"Private fixture upload counter"
        envelope = {"v": 1, "instance_id": self.ready["instance_id"], "operation_id": "counter-media-begin",
                    "kind": "media.begin", "target": {"media_id": "counter-media"},
                    "expected": {"authority": authority, "media_revision": 0},
                    "args": {"name": "counter.txt", "content_type": "text/plain", "size_bytes": len(content),
                             "sha256": hashlib.sha256(content).hexdigest(), "publish_operation_id": "counter-media-publish"}}
        status, receipt = self.http_request("/api/command", envelope)
        self.assertEqual((status, receipt["status"]), (200, "committed"))
        before = self.control("counts")
        envelope.update(operation_id="counter-media-publish", kind="media.publish", args={},
                        expected={"authority": authority, "media_revision": 1})
        status, receipt = self.http_request("/api/media/upload", content,
                                           extra={"Content-Type": "application/octet-stream", "X-AIM-Command": json.dumps(envelope)})
        self.assertEqual((status, receipt["status"]), (200, "committed"))
        after = self.control("counts")
        self.assertEqual(after["http_commands"], before["http_commands"])
        self.assertEqual(after["http_media_publications"], before["http_media_publications"] + 1)
        self.assertEqual(after["operations"], before["operations"] + 1)

    def test_hold_timeout_is_fatal_to_fixture_even_if_http_returns_500(self):
        self.control("read_hold", hold_id="fatal-hold", phase="close", name="topic", read_class="foreground", count=1, timeout_ms=10)
        status, body = self.view("topic", {"topic_id": "t1"})
        self.assertEqual((status, body["error"]["code"]), (500, "REQUEST_UNCONFIRMED"))
        result = self.control("admission_events", after=0)
        self.assertEqual(result["fatal"], ["fatal-hold"])
        self.assertTrue(any(e["event"] == "hold-timeout" and e["hold_id"] == "fatal-hold" for e in result["events"]))
        self.expected_exit = 1

    def test_unconsumed_hold_is_fatal_even_when_released(self):
        self.control("read_hold", hold_id="never-engaged", phase="callback", name="topic", read_class="background")
        self.control("read_release", hold_id="never-engaged")
        self.expected_exit = 1

    def test_unclassified_hold_engages_both_actual_classes(self):
        self.assertEqual((self.ready["admission_mode"], self.ready["max_reads"]), ("partitioned", 2))
        self.control("read_hold", hold_id="any-class", phase="callback", name="topic", count=2)
        pending = [self.pool.submit(self.view, "topic", {"topic_id": "t1"}, read_class)
                   for read_class in ("foreground", "background")]
        result = self.events_until(lambda r: sum(e["event"] == "hold-enter" and e.get("hold_id") == "any-class" for e in r["events"]) == 2)
        held = [e for e in result["events"] if e["event"] == "hold-enter" and e.get("hold_id") == "any-class"]
        self.assertEqual({e["read_class"] for e in held}, {"foreground", "background"})
        self.assertEqual(len({e["request_id"] for e in held}), 2)
        self.assertTrue(all(not future.done() for future in pending))
        self.control("read_release", hold_id="any-class")
        self.assertTrue(all(future.result(timeout=1)[0] == 200 for future in pending))

    def test_explicit_cancel_withdraws_only_unconsumed_hold_count(self):
        self.control("read_hold", hold_id="partial", phase="callback", name="topic", read_class="foreground", count=2)
        pending = self.pool.submit(self.view, "topic", {"topic_id": "t1"})
        self.events_until(lambda r: any(e["event"] == "hold-enter" and e.get("hold_id") == "partial" for e in r["events"]))
        cancelled = self.control("read_cancel", hold_id="partial")
        self.assertEqual(cancelled["cancelled"], 1)
        self.assertFalse(pending.done(), "Canceling future matches must not release the active hold")
        self.control("read_release", hold_id="partial")
        self.assertEqual(pending.result(timeout=1)[0], 200)
        result = self.control("admission_events", after=0)
        self.assertTrue(any(e["event"] == "hold-cancel" and e.get("hold_id") == "partial" and e["cancelled"] == 1 for e in result["events"]))
        self.assertEqual(result["fatal"], [])


class WakesFixtureTests(FixtureCase):
    """The wakes control the native wakes check drives, read back through the real server."""

    def wakes(self):
        status, view = self.view("wakes", read_class="background")
        self.assertEqual(status, 200, view)
        return view

    def test_the_agent_parked_then_the_runner_killed_then_back(self):
        self.assertEqual(self.control("wakes", action="route")["status"], "provisioned")
        self.control("agent_message", operation_id="wakes-person-asks", body="Over to you", topic_id="t1",
                     sender="person", addressees=["fixture-notebook-agent"])
        live = self.control("wakes", action="runner_live")
        self.assertEqual(live["status"], "acquired", live)
        # The longest lease a runner may take: a slow browser start cannot let it lapse into "unrenewed"
        # before the native check has read the page.
        self.assertGreater(live["lease_until_ms"] - time.time() * 1000, 110000)
        self.assertEqual(self.wakes()["runner"], {"live": True})
        self.control("wakes", action="park")
        quiet = self.wakes()["quiet"]
        self.assertEqual([(q["actor_id"], q["why"]) for q in quiet], [("fixture-notebook-agent", "not_answering")])
        self.assertGreaterEqual(quiet[0]["waiting"], 1)
        self.assertEqual(self.control("wakes", action="runner_killed")["status"], "recorded")
        view = self.wakes()
        self.assertEqual((view["runner"]["state"], view["runner"]["reason"]), ("exited", "killed"))
        self.assertEqual(view["notice"], {"waiting_agents": 1})
        self.assertEqual([q["why"] for q in view["quiet"]], ["wakes_paused"])
        self.control("wakes", action="runner_live")
        self.assertNotIn("notice", self.wakes())


class PipelineFixtureTests(FixtureCase):
    """The pipeline control the native pipeline check drives, read back through the real server."""

    def pipeline(self, kind, target, args, **request):
        return self.control("pipeline", kind=kind, operation_id="fixture-%s-%d" % (kind, self.counter), target=target, args=args, **request)

    def test_the_owner_and_the_agent_act_each_at_the_revision_they_read(self):
        w1 = {"workspace_id": "w1"}
        self.assertEqual(self.pipeline("pipeline.configure", w1, {"enabled": True})["status"], "committed")
        self.pipeline("pipeline.stages_set", w1, {"stages": [{"stage_id": "build", "name": "Build"},
                                                             {"stage_id": "review", "name": "Review", "gate": {"owner": True}}]})
        number = self.pipeline("pipeline.item_add", w1, {"title": "Build me", "section": "now", "sources": [{"note": "n"}]})["result"]["number"]
        self.pipeline("pipeline.item_edit", dict(w1, number=number), {"size": "small"})
        piece = self.pipeline("pipeline.piece_start", w1, {"numbers": [number], "topic_id": "t1", "stage_id": "build"})["result"]["piece_id"]
        # An agent enters the owner-gated stage only after asking the person there.
        refused = self.pipeline("pipeline.stage_enter", {"piece_id": piece}, {"stage_id": "review", "left_outcome": "approved"}, sender="agent", refusable=True)
        self.assertEqual(refused["error"]["code"], "ASK_REQUIRED")
        entered = self.pipeline("pipeline.stage_enter", {"piece_id": piece}, {"stage_id": "review", "left_outcome": "approved"},
                                sender="agent", ask="Does the review read well?")
        self.assertEqual(entered["status"], "committed", entered)
        status, view = self.view("pipeline", {"workspace_id": "w1", "section": "now"})
        self.assertEqual(status, 200, view)
        self.assertEqual([(p["id"], p["stage"]["stage_id"], p["stage"]["you_leave_it"]) for p in view["pieces"]], [(piece, "review", True)])
        self.assertEqual([(i["number"], i["size"]) for i in view["items"]], [(number, "small")])


class LegacyObservationTests(FixtureCase):
    fixture_flags = ("--legacy-read-admission",)

    def test_legacy_http_observation_keeps_actual_single_slot_and_identity(self):
        self.assertEqual((self.ready["admission_mode"], self.ready["max_reads"]), ("legacy-observation", 1))
        status, bootstrap = self.http_request("/api/bootstrap", {}, method="GET", read_class=None)
        self.assertEqual(status, 200)
        self.assertNotIn("read_admission", bootstrap.get("transport", {}))
        self.control("read_hold", hold_id="old-client", phase="callback", name="topic")
        pending = self.pool.submit(self.view, "topic", {"topic_id": "t1"}, None)
        result = self.events_until(lambda r: any(e["event"] == "hold-enter" and e.get("hold_id") == "old-client" for e in r["events"]))
        event = next(e for e in result["events"] if e["event"] == "hold-enter" and e.get("hold_id") == "old-client")
        self.assertEqual((event["read_class"], event["admission_mode"]), ("foreground", "legacy-observation"))
        self.assertRegex(event["request_id"], r"^legacy-[1-9][0-9]*$")
        self.assertIsNone(result["lanes"])
        self.assertFalse(pending.done())
        self.assertEqual(self.view("topic", {"topic_id": "t1"}, None)[0], 503)
        self.control("read_release", hold_id="old-client")
        self.assertEqual(pending.result(timeout=1)[0], 200)


class FixtureFinalizerTests(unittest.TestCase):
    def test_cancel_does_not_set_the_active_hold_release_event(self):
        spec = importlib.util.spec_from_file_location("cancel_fixture", Path(__file__).parent / "fixtures/ui_http.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        controls = module.FreshnessControls()
        server = SimpleNamespace()
        controls.control({"method": "read_hold", "hold_id": "partial", "phase": "callback", "name": "topic", "count": 2}, server)
        with ThreadPoolExecutor(max_workers=1) as pool:
            active = pool.submit(controls.wait_hold, "topic", "callback")
            try:
                deadline = time.monotonic() + 1
                while not any(e["event"] == "hold-enter" for e in controls.events):
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.001)
                self.assertEqual(controls.control({"method": "read_cancel", "hold_id": "partial"}, server)["cancelled"], 1)
                self.assertFalse(controls.holds["partial"]["release"].is_set())
            finally:
                controls.control({"method": "read_release", "hold_id": "partial"}, server)
                active.result(timeout=1)
        controls.close()
        controls.assert_healthy()

    def test_close_hold_timeout_still_closes_the_underlying_store(self):
        from aim_next.server import Handler
        spec = importlib.util.spec_from_file_location("freshness_fixture", Path(__file__).parent / "fixtures/ui_http.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        controls = module.FreshnessControls()
        closed = []
        base = SimpleNamespace(view=lambda *args: {}, close=lambda: closed.append(True))
        server = SimpleNamespace(read_admission=None, RequestHandlerClass=Handler, instance_id="fixture")
        controls.install(server, lambda: base)
        controls.local.ticket = SimpleNamespace(number="fixture-ticket", read_class="foreground")
        store = server.store_factory()
        store.view("fixture-actor", "topic", {})
        controls.control({"method": "read_hold", "hold_id": "finalizer", "phase": "close", "name": "topic",
                          "read_class": "foreground", "timeout_ms": 1}, server)
        with self.assertRaises(AssertionError):
            store.close()
        self.assertEqual(closed, [True])
        self.assertEqual(controls.fatal, ["finalizer"])
        with self.assertRaises(AssertionError):
            controls.assert_healthy()


if __name__ == "__main__":
    unittest.main()

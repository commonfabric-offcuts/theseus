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


class FreshnessFixtureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.process = subprocess.Popen([sys.executable, "tests/fixtures/ui_http.py", "--freshness", "--images"],
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
            self.assertIn("Private fixture hold timeout", errors)
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
                "Content-Type": "application/json", "X-AIM-Read-Class": read_class}
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



class FixtureFinalizerTests(unittest.TestCase):
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

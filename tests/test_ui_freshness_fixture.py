from __future__ import annotations

import http.client
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


class FreshnessFixtureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stderr = open(Path(self.tmp.name) / "stderr.log", "w+")
        self.process = subprocess.Popen([sys.executable, "tests/fixtures/ui_http.py", "--freshness", "--images"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr,
                                        text=True, bufsize=1)
        self.counter = 0
        self.ready = self.control("ready")
        self.pool = ThreadPoolExecutor(max_workers=3)

    def tearDown(self):
        # Private stdin EOF releases fixture-owned holds and closes its server.
        self.process.stdin.close()
        self.pool.shutdown(wait=True)
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0)
        self.process.stdout.close()
        self.stderr.seek(0)
        errors = self.stderr.read()
        self.stderr.close()
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

    def http_request(self, path, payload, read_class="foreground"):
        url = urlsplit(self.ready["origin"])
        conn = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
        try:
            conn.request("POST", path, json.dumps(payload), {
                "Authorization": "Bearer " + self.ready["token"], "Origin": self.ready["origin"],
                "Content-Type": "application/json", "X-AIM-Read-Class": read_class})
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


if __name__ == "__main__":
    unittest.main()

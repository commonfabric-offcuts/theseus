from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path
import unittest
from unittest import mock

from aim_next import Store
from aim_next import hosted_notice
from aim_next.profile import write_profile
from test_cover_refresh import CoverRefreshCase


class RequestCase(CoverRefreshCase):
    def request(self, target_type="cover", op=None):
        return self.refresh(op=op) if target_type == "cover" else self.command(
            "message.refresh", target={"message_id": self.answer}, expected={"message_revision": 1}, op=op)

    def unchanged_message_effects(self):
        tables = ("messages", "message_addressees", "message_marks", "message_exposures", "reply_horizons",
                  "topic_waiting", "conversation_waits", "conversation_items", "conversation_takes", "dossier_order",
                  "ask_cover_links", "cover_waiting", "topics", "topic_participants")
        return {name: self.sql('SELECT * FROM "' + name + '" ORDER BY rowid') for name in tables}

    def delivery(self, refresh, actor="agent-b"):
        items = self.store.view(actor, "deliveries", {"limit": 100})["items"]
        found = [item for item in items if item.get("request", {}).get("id") == refresh["request_id"]]
        self.assertEqual(len(found), 1, "the addressed agent must have exactly one durable request delivery")
        return found[0]

    def test_failed_route_and_restart_keep_the_same_request_for_existing_runner_recovery(self):
        for actor in ("agent-a", "agent-b"):
            for item in self.store.view(actor, "deliveries", {"limit": 100})["items"]:
                self.committed(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor=actor))
        now = [2000000000000]
        with mock.patch("aim_next.delivery._now_ms", side_effect=lambda: now[0]):
            refresh = self.committed(self.refresh())["refresh"]
            delivery = self.delivery(refresh)
            with self.store.runner_guard("fixture-request829") as guard:
                acquired = self.store.acquire_runner(guard)
                self.assertEqual(acquired["status"], "acquired")
                token = acquired["runner_token"]
                self.assertEqual(self.store.claim_wakes(guard, token, ["agent-a"])["claims"], [])
                claims = self.store.claim_wakes(guard, token, ["agent-b"])["claims"]
                self.assertEqual(len(claims), 1)
                claim = claims[0]
                self.assertEqual((claim["recipient_id"], claim["captured_seq"]), ("agent-b", delivery["seq"]))
                self.assertNotIn(delivery["request"]["body"], json.dumps(claim))
                settled = self.store.finish_wake(guard, token, claim["claim_token"], "unavailable", reason="route_unavailable")
                self.assertEqual(settled["status"], "settled")
                self.assertGreater(settled["next_due_ms"], now[0])
                self.assertEqual(self.delivery(refresh), delivery)
                self.pending()
                now[0] = settled["next_due_ms"]
            self.store = Store(self.path, "test-instance", expected_binding=self.binding)
            with self.store.runner_guard("fixture-request829-restarted") as guard:
                token = self.store.acquire_runner(guard)["runner_token"]
                retry = self.store.claim_wakes(guard, token, ["agent-b"])["claims"]
                self.assertEqual(len(retry), 1)
                self.assertNotEqual(retry[0]["attempt_id"], claim["attempt_id"])
                self.assertEqual(retry[0]["captured_seq"], delivery["seq"])
                self.assertEqual(self.store.finish_wake(guard, token, claim["claim_token"], "accepted")["status"], "stale")
                self.assertEqual(self.delivery(refresh), delivery)
                self.committed(self.command("delivery.ack", target={"delivery_id": delivery["id"]}, actor="agent-b"))
                self.assertEqual(self.store.finish_wake(guard, token, retry[0]["claim_token"], "accepted")["status"], "settled")
                self.assertEqual(self.store.runner_schedule(["agent-b"])["next_due_ms"], None)
                self.pending()

    def test_both_commands_are_one_durable_request_without_message_side_effects(self):
        for kind in ("cover", "message"):
            with self.subTest(kind=kind):
                before = self.unchanged_message_effects()
                old_deliveries = self.sql("SELECT * FROM deliveries ORDER BY seq")
                receipt = self.request(kind, op="request-" + kind)
                refresh = self.committed(receipt)["refresh"]
                self.assertEqual(self.unchanged_message_effects(), before, "a refresh must not publish an attributed reply or its effects")
                self.assertNotIn("request_message_id", refresh)
                self.assertNotIn("body", refresh)
                item = self.delivery(refresh)
                request = item["request"]
                self.assertEqual((request["requester_id"], request["recipient_id"], request["root_id"], request["observed_revision"]),
                                 ("owner", "agent-b", self.root, 1))
                self.assertEqual(request["message_id"], self.root if kind == "cover" else self.answer)
                self.assertNotIn("message", item)
                self.assertIsNone(item["message_id"])
                self.assertEqual(item["reasons"], ["request"])
                self.assertEqual(self.sql("SELECT * FROM deliveries ORDER BY seq")[:-1], old_deliveries)
                self.assertEqual(self.request(kind, op="request-" + kind), receipt)
                self.assertEqual(self.committed(self.request(kind))["refresh"], refresh)
                self.assertEqual(self.sql("SELECT count(*) FROM refresh_requests WHERE id=?", (refresh["request_id"],)), [(1,)])
                self.store = Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertEqual(self.delivery(refresh), item)

    def test_instruction_words_are_exact_and_only_recipient_delivery_has_them(self):
        refresh = self.committed(self.refresh())["refresh"]
        item = self.delivery(refresh)
        expected = ("Please rewrite this dossier's cover from its latest facts. "
                    "Read the whole dossier and its current cover, retain source attribution, waits and defaults, "
                    "payload kind/link and the owner's Done record. Put current facts and numbers in a simple "
                    "table in plain language; fold log-like details under a details fold. "
                    "Use aim-next cover %s --expected N with the current cover revision. "
                    "This refresh observed revision 1; only a changed agent cover write "
                    "completes it, not a reply or acknowledgement." % self.root)
        self.assertEqual(item["request"]["body"], expected)
        for actor in ("owner", "agent-a", "other-reader", "outsider"):
            self.assertEqual(self.store.view(actor, "delivery", {"delivery_id": item["id"]})["error"]["code"], "FORBIDDEN")
            self.assertNotIn(expected, json.dumps(self.store.view(actor, "deliveries", {"limit": 100})))
            self.assertNotIn(expected, json.dumps(self.store.view(actor, "topic_messages", {"topic_id": "t1", "limit": 100})))
            self.assertNotIn(expected, json.dumps(self.read(actor=actor)))
        notice = hosted_notice.notice([item], None, "agent-b", "fixture-attempt")
        self.assertIn("request in topic", notice["input"][0]["text"])
        self.assertIn(self.root, notice["input"][0]["text"])
        self.assertIn(expected, next(iter(notice["additionalContext"].values()))["value"])
        self.assertEqual(notice["announced_seq"], item["seq"])
        self.assertNotIn("from owner, message", notice["input"][0]["text"])

    def test_request_and_delivery_act_receipt_rollback_together(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("CREATE TRIGGER reject_request_delivery BEFORE INSERT ON deliveries WHEN NEW.request_id IS NOT NULL "
                       "BEGIN SELECT RAISE(ABORT,'request delivery fixture'); END")
        before = self.records()
        failed = self.refresh(op="request-rollback")
        self.rejected(failed, "INTERNAL_ERROR")
        self.assertFalse(failed["recorded"])
        self.assertEqual(self.records(), before)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER reject_request_delivery")
        refresh = self.committed(self.refresh(op="request-rollback"))["refresh"]
        self.assertEqual(self.delivery(refresh)["state"], "pending")

    def test_ack_does_not_complete_and_next_real_write_keeps_request_identity(self):
        refresh = self.committed(self.refresh())["refresh"]
        item = self.delivery(refresh)
        ack = self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-b", op="request-ack")
        self.committed(ack)
        self.assertEqual(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-b", op="request-ack"), ack)
        self.pending()
        self.write({"stands": "Actually checked the changed road"})
        done = self.read()["refresh"]
        self.assertEqual(done["state"], "completed")
        self.assertEqual(done["request_id"], refresh["request_id"])
        self.assertEqual(done["completed_by"], "agent-b")
        self.assertGreaterEqual(done["completed_ms"], refresh["at_ms"])
        self.assertEqual(self.store.view("agent-b", "delivery", {"delivery_id": item["id"]})["item"]["state"], "acknowledged")

    def test_message_edit_only_completes_its_own_request_and_keeps_instructions(self):
        refresh = self.committed(self.request("message"))["refresh"]
        item = self.delivery(refresh)
        self.assertEqual(item["request"]["body"], (
            "Please bring your same message %s up to date with what has happened since it was written. "
            "Read that message and the later facts, then edit that message in place with aim-next edit %s "
            "--expected N using its current ordinary message revision. Keep source attribution and exact "
            "message identity; do not post a replacement. This request observed revision 1; only a new "
            "ordinary revision of that same message completes it, not a reply or acknowledgement." % (self.answer, self.answer)))
        self.write({"stands": "A cover is a different target"})
        self.assertEqual(self.source({"kind": "message", "id": self.answer})["acts"]["message_refresh"]["state"], "pending")
        body = self.source({"kind": "message", "id": self.answer})["body"].replace("The lake opens in May", "The lake now opens in June")
        self.committed(self.command("message.edit", {"body": body}, target={"message_id": self.answer},
                                    expected={"message_revision": 1}, actor="agent-b"))
        done = self.source({"kind": "message", "id": self.answer})["acts"]["message_refresh"]
        self.assertEqual((done["state"], done["request_id"], done["completed_revision"]), ("completed", refresh["request_id"], 2))
        self.assertEqual(self.delivery(refresh)["request"]["body"], item["request"]["body"])

    def test_private_request_has_no_subscriber_or_read_through_side_effect(self):
        private = self.post("Private cabin details", addressees=["agent-b"], whisper=True)
        self.write({"stands": "Private checked road"}, root=private)
        before = self.unchanged_message_effects()
        refresh = self.committed(self.refresh(root=private))["refresh"]
        self.assertEqual(self.unchanged_message_effects(), before)
        item = self.delivery(refresh)
        self.assertEqual(item["request"]["root_id"], private)
        for actor in ("owner", "agent-a", "outsider"):
            self.assertIn("error", self.store.view(actor, "delivery", {"delivery_id": item["id"]}))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE request_id=?", (refresh["request_id"],)), [(1,)])
        for actor in ("owner", "agent-b"):
            self.committed(self.command("topic.read_through", {"seq": 999999}, target={"topic_id": "t1"}, actor=actor))
        self.assertEqual(self.delivery(refresh)["state"], "pending")

    def test_actual_cli_inbox_watch_and_ack_keep_full_request_and_normal_delivery(self):
        for item in self.store.view("agent-b", "deliveries", {"limit": 100})["items"]:
            self.committed(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-b"))
        profile = Path(self.temp.name) / "request-agent.json"
        write_profile(profile, str(self.path.resolve()), "test-instance", "agent-b", binding=self.binding)
        observations = []
        def run(*args):
            cache = str(Path(self.temp.name) / ("cache-cli-" + uuid.uuid4().hex))
            argv = [sys.executable, "-I", "-X", "pycache_prefix=" + cache,
                    str(Path(__file__).resolve().parents[1] / "bin/aim-next"), "--profile", str(profile), *args]
            result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            observations.append({"argv": argv, "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
            self.assertEqual(result.returncode, 0, observations[-1])
            self.assertEqual(result.stderr, "", observations[-1])
            return result.stdout
        for kind in ("cover", "message"):
            refresh = self.committed(self.request(kind))["refresh"]
            item = self.delivery(refresh)
            for text in (run("inbox"), run("watch", "--once")):
                self.assertTrue(text.startswith('request "'), text)
                self.assertIn(" ".join(item["request"]["body"].split()), text)
                self.assertIn(self.root, text)
                self.assertIn("observed revision 1", text)
                self.assertEqual(len(text.splitlines()), 1)
                self.assertFalse(text.startswith(("acknowledged", "change", "watching", "Fast Trains")))
            self.assertIn("acknowledged", run("ack", item["id"]))
            self.assertEqual(run("inbox"), "inbox empty\n")
        ordinary = self.post("Ordinary words still arrive", addressees=["agent-b"], intent="tell")
        text = run("watch", "--once")
        self.assertTrue(text.startswith('delivery "'), text)
        self.assertIn("Ordinary words still arrive", text)
        self.assertTrue(self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (ordinary,)))
        print("CLI829_PROOF " + json.dumps(observations), flush=True)

    def test_new_cycle_keeps_history_and_delivery_keys_distinct_without_affecting_old_message(self):
        first = self.committed(self.refresh())["refresh"]
        first_delivery = self.delivery(first)
        self.write({"stands": "First completed write"})
        second = self.committed(self.refresh())["refresh"]
        second_delivery = self.delivery(second)
        self.assertNotEqual(first["request_id"], second["request_id"])
        self.assertNotEqual(first_delivery["id"], second_delivery["id"])
        self.assertGreater(second_delivery["seq"], first_delivery["seq"])
        self.assertEqual(self.sql("SELECT count(*) FROM refresh_requests WHERE message_id=?", (self.root,)), [(2,)])
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE message_id=? AND kind='cover_refresh'", (self.root,)), [(3,)])
        self.assertEqual(self.store.view("agent-b", "delivery", {"delivery_id": first_delivery["id"]})["item"], first_delivery)

    def test_lost_source_reach_hides_request_without_granting_new_reach(self):
        refresh = self.committed(self.refresh())["refresh"]
        item = self.delivery(refresh)
        self.participation("agent-b", False)
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-b'")
        # Existing source delivery may grant source reach; remove that fixture
        # row only, keeping the request as the subject of the permission check.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM delivery_reasons WHERE delivery_id IN (SELECT id FROM deliveries WHERE recipient_id='agent-b' AND message_id IS NOT NULL)")
            db.execute("DELETE FROM deliveries WHERE recipient_id='agent-b' AND message_id IS NOT NULL")
        self.assertNotIn(item["request"]["body"], json.dumps(self.store.view("agent-b", "deliveries", {"limit": 100})))
        direct = self.store.view("agent-b", "delivery", {"delivery_id": item["id"]})
        self.assertIn("error", direct)
        self.assertEqual(direct["error"]["code"], "FORBIDDEN")


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(RequestCase(name) for name in RequestCase.__dict__ if name.startswith("test_"))

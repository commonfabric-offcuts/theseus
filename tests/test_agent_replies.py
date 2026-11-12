from __future__ import annotations

import json
import sqlite3

from test_agent_verbs import AgentVerbCase


class ReplyVerbCase(AgentVerbCase):
    def post(self, body, topic="t1", actor="owner", **args):
        return self.committed(self.store.command(actor, self.envelope(
            "message.post", {"topic_id": topic}, dict(args, body=body))))["message_id"]

    def new_topic(self):
        self.committed(self.command("opening.save", {
            "workspace_id": "w1", "topic_id": "t2", "title": "Other work",
            "participants": ["agent-a"], "body": "Another request", "attachments": []},
            target={"opening_id": "o2"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"},
                                    expected={"opening_revision": 1}))

    def test_progress_and_completion_stay_with_exact_request_amid_other_work(self):
        request = self.post("First request", addressees=["agent-a"], intent="tell")
        other = self.post("Unrelated newer request")
        self.new_topic()
        newest = self.post("Newest request in another topic", topic="t2")
        for body in ("Working on the first request", "The first request is complete"):
            code, out, err = self.run_cli("reply", request, "--tells", "owner", body)
            self.assertEqual((code, err), (0, ""))
            message = self.latest("t1")
            self.assertEqual(message[3:], (body, '["owner"]', request))
            self.assertIn(message[0], out)
            self.assertEqual(self.latest("t2")[0], newest)
            self.assertNotEqual(message[5], other)
        delivery = self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id='agent-a'", (request,))
        self.assertEqual(delivery, [("pending",)])

    def test_follow_up_is_the_target_and_stdin_is_preserved_without_inferred_recipients(self):
        follow_up = self.post("A correction", reply_to=self.opening["id"])
        body = "  Working on the correction\n$literal `words` é 🪴\n"
        code, out, err = self.run_cli("reply", follow_up, "-", stdin=body.encode("utf-8"))
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.latest()[3:], (body, "[]", follow_up))

    def test_same_operation_repeats_once_and_changed_target_is_refused(self):
        first = self.post("First request")
        second = self.post("Second request")
        args = ("--operation", "explicit-reply", "Done")
        self.assertEqual(self.run_cli("reply", first, *args)[0], 0)
        message = self.latest()[0]
        before = self.records()
        self.assertEqual(self.run_cli("reply", first, *args)[0], 0)
        self.assertEqual(self.latest()[0], message)
        code, _, err = self.run_cli("reply", second, *args)
        self.assertEqual(code, 2)
        self.assertIn("OPERATION_PAYLOAD_MISMATCH", err)
        self.assertEqual(self.records(), before)

    def test_busy_retry_keeps_exact_topic_target_body_and_intent(self):
        request = self.post("Request")
        blocker = sqlite3.connect(str(self.path), isolation_level=None)
        self.addCleanup(blocker.close)
        blocker.execute("BEGIN IMMEDIATE")
        code, _, err = self.run_cli("reply", request, "--asks", "owner", "Which colour?")
        self.assertEqual(code, 75)
        self.assertIn("DATABASE_BUSY", err)
        [filename] = self.saved()
        operation = filename[:-len(".request.json")]
        saved = json.loads((self.outbox() / filename).read_text())["command"]
        self.assertEqual(saved["target"], {"topic_id": "t1"})
        self.assertEqual(saved["args"], {"body": "Which colour?", "addressees": ["owner"],
                                        "intent": "ask", "reply_to": request})
        blocker.rollback()
        self.assertEqual(self.run_cli("retry", operation)[0], 0)
        self.assertEqual(self.latest()[3:], ("Which colour?", '["owner"]', request))

    def test_missing_and_inaccessible_targets_send_nothing(self):
        for target, actor in (("m-missing", "agent-a"), (self.opening["id"], "outsider")):
            with self.subTest(target=target, actor=actor):
                before = self.records()
                code, out, err = self.run_cli("reply", target, "Do not send", actor=actor)
                self.assertEqual(code, 2)
                self.assertEqual(self.records(), before)
                self.assertEqual(self.saved(actor), [])

    def test_whisper_target_never_becomes_public_or_uploads_an_attachment(self):
        private = self.post("Private request", whisper=True, addressees=["agent-a"])
        before = self.records()
        code, _, err = self.run_cli("reply", private, "--tells", "owner", "--attach", "/missing/file.txt", "Private answer")
        self.assertEqual(code, 2)
        self.assertIn("WHISPER_STAYS_PRIVATE", err)
        self.assertIn("whisper", err)
        self.assertEqual(self.records(), before)
        self.assertEqual(self.saved(), [])

    def test_reply_cannot_override_topic_or_target(self):
        for extra in (("--reply-to", "m-other"), ("--topic", "t2")):
            before = self.records()
            self.assertEqual(self.run_cli("reply", self.opening["id"], *extra, "Words")[0], 2)
            self.assertEqual(self.records(), before)
            self.assertEqual(self.saved(), [])

    def test_delivery_id_is_explained_not_reinterpreted(self):
        before = self.records()
        code, _, err = self.run_cli("reply", "d-not-a-message", "Words")
        self.assertEqual(code, 2)
        self.assertIn("not a delivery id", err)
        self.assertIn("never replace the prefix", err)
        self.assertEqual(self.records(), before)
        self.assertEqual(self.saved(), [])

    def test_json_reply_receipt_names_actual_threaded_message(self):
        code, out, err = self.run_cli("--json", "reply", self.opening["id"], "Done")
        self.assertEqual((code, err), (0, ""))
        receipt = json.loads(out.splitlines()[-1])
        self.assertEqual(receipt["result"]["message_id"], self.latest()[0])
        self.assertEqual(self.latest()[5], self.opening["id"])

    def test_conversation_progress_stays_new_and_answerer_rules_still_hold(self):
        topic = self.store.view("agent-a", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        request = self.post("Build and verify", topic=topic, addressees=["agent-a"], intent="tell")
        code, _, err = self.run_cli("reply", request, "--part", "Building")
        self.assertEqual((code, err), (0, ""))
        items = self.store.view("agent-a", "topic_messages", {"topic_id": topic})["items"]
        self.assertEqual(next(item for item in items if item["id"] == request)["item"]["state"], "new")
        before = self.sql("SELECT count(*) FROM messages")
        code, _, err = self.run_cli("reply", request, "Not my job", actor="agent-b")
        self.assertEqual(code, 2)
        self.assertIn("NOT_THE_ANSWERER", err)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), before)
        self.assertEqual(self.run_cli("reply", request, "Built and verified")[0], 0)
        items = self.store.view("agent-a", "topic_messages", {"topic_id": topic})["items"]
        self.assertEqual(next(item for item in items if item["id"] == request)["item"]["state"], "settled")

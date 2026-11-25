from __future__ import annotations

import json
from unittest.mock import patch

from aim_next import Store
from reader_fixture import ReaderCase


class SendReceiptSequence(ReaderCase):
    def prepared(self, key="sequence-A"):
        self.committed(self.save_draft(key, self.opening, "t1", "Frozen sequence words"))
        prepared = self.committed(self.prepare(key, "t1", submission=key, send_op=key + "-send"))
        return key, prepared

    def publish(self, key):
        return self.command("message.send", {"submission_id": key}, target={"topic_id": "t1"}, op=key + "-send")

    def message_sequence(self, receipt):
        result = self.committed(receipt)
        actual = self.sql("SELECT seq FROM messages WHERE id=?", (result["message_id"],))[0][0]
        self.assertIs(type(result.get("seq")), int)
        self.assertEqual(result["seq"], actual)
        return actual

    def test_receipt_sequence_is_the_inserted_message_not_the_preparation(self):
        key, prepared = self.prepared()
        self.committed(self.command("message.post", {"body": "Interleaved publication"}, target={"topic_id": "t1"}))
        receipt = self.publish(key)
        sequence = self.message_sequence(receipt)
        self.assertNotEqual(sequence, prepared["seq"])
        source = self.source({"kind": "message", "id": receipt["result"]["message_id"]})
        self.assertEqual(source["seq"], sequence)
        self.assertEqual(receipt["result"]["submission_id"], key)

    def test_exact_replay_and_recovered_operation_keep_recorded_sequence_and_one_publication(self):
        key, _ = self.prepared()
        receipt = self.publish(key)
        self.message_sequence(receipt)
        stored = self.sql("SELECT outcome FROM operations WHERE actor_id='owner' AND id=?", (key + "-send",))[0][0]
        self.assertEqual(self.publish(key), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": key + "-send"}), receipt)
        self.assertEqual(json.loads(stored), receipt)
        self.assertEqual(self.sql("SELECT outcome FROM operations WHERE actor_id='owner' AND id=?", (key + "-send",))[0][0], stored)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id=?", (key + "-send",)), [(1,)])

    def test_historical_receipt_without_seq_is_not_enriched_by_replay_or_recovery(self):
        key, _ = self.prepared()
        publish = self.store._publish

        def historical(*args, **kwargs):
            result, affected = publish(*args, **kwargs)
            result.pop("seq", None)
            return result, affected

        # Produce a real durable old-shaped result, then restore the current
        # publisher. The immutable operations table is never rewritten.
        with patch.object(self.store, "_publish", side_effect=historical):
            receipt = self.publish(key)
        self.committed(receipt)
        self.assertNotIn("seq", receipt["result"])
        stored = self.sql("SELECT outcome FROM operations WHERE actor_id='owner' AND id=?", (key + "-send",))[0][0]
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.publish(key), receipt)
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": key + "-send"}), receipt)
        self.assertEqual(self.sql("SELECT outcome FROM operations WHERE actor_id='owner' AND id=?", (key + "-send",))[0][0], stored)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id=?", (key + "-send",)), [(1,)])

    def test_shared_publisher_opening_and_post_results_have_their_own_message_sequence(self):
        opening = self.store.view("owner", "operation", {"operation_id": "open-topic"})
        first = self.message_sequence(opening)
        posted = self.command("message.post", {"body": "Another public message"}, target={"topic_id": "t1"})
        self.assertGreater(self.message_sequence(posted), first)

    def test_changed_send_retry_cannot_replace_the_original_result(self):
        key, _ = self.prepared()
        receipt = self.publish(key)
        self.message_sequence(receipt)
        changed = self.command("message.send", {"submission_id": "different"}, target={"topic_id": "t1"}, op=key + "-send")
        self.rejected(changed, "OPERATION_PAYLOAD_MISMATCH")
        self.assertFalse(changed["recorded"])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": key + "-send"}), receipt)

    def test_wrong_binding_does_not_publish_or_invent_a_sequence(self):
        key, _ = self.prepared()
        envelope = self.envelope("message.send", {"topic_id": "t1"}, {"submission_id": key}, op=key + "-send")
        envelope["expected"]["authority"]["authority_epoch"] = "wrong-epoch"
        answer = self.store.command("owner", envelope)
        self.assertNotEqual(answer["status"], "committed")
        self.assertFalse(answer["recorded"])
        self.assertIsNone(answer.get("result"))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id=?", (key + "-send",)), [(0,)])
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": key + "-send"})["status"], "unknown")

    def test_prepared_and_unknown_send_do_not_claim_a_committed_message_sequence(self):
        key, prepared = self.prepared()
        self.assertIs(type(prepared["seq"]), int)
        pending = self.store.view("owner", "submission", {"submission_id": key})
        self.assertIsNone(pending["send_receipt"])
        answer = self.store.view("owner", "operation", {"operation_id": key + "-send"})
        self.assertEqual(answer["status"], "unknown")
        self.assertNotIn("result", answer)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id=?", (key + "-send",)), [(0,)])

    def test_other_actor_cannot_read_the_private_send_receipt(self):
        key, _ = self.prepared()
        receipt = self.publish(key)
        self.message_sequence(receipt)
        foreign = self.store.view("agent-a", "operation", {"operation_id": key + "-send"})
        self.assertEqual(foreign["status"], "unknown")
        self.assertNotIn("result", foreign)

    def test_human_whisper_receipt_keeps_its_actual_message_sequence(self):
        receipt = self.command("message.post", {"body": "Private fixture question", "whisper": True,
                               "addressees": ["agent-a"]}, target={"topic_id": "t1"})
        self.message_sequence(receipt)
        self.assertTrue(receipt["result"]["whisper"])

    def test_prepared_agent_whisper_early_return_has_sequence_without_shared_topic_changes(self):
        question = self.command("message.post", {"body": "Private fixture question", "whisper": True,
                                "addressees": ["agent-a"]}, target={"topic_id": "t1"})
        parent = self.committed(question)["message_id"]
        shared_before = self.sql("SELECT * FROM topic_summaries WHERE topic_id='t1'")
        topic_before = self.sql("SELECT version FROM topics WHERE id='t1'")
        saved = self.command("draft.save", {"source_ref": {"kind": "message", "id": parent}, "topic_id": "t1",
            "body": "Private fixture answer", "generation": "agent-generation", "attachments": [], "quotes": [],
            "addressees": ["owner"], "whisper": True, "reply_without_quote": "Answering this isolated private fixture question."},
            target={"draft_id": "agent-private"}, expected={"draft_revision": 0}, actor="agent-a")
        self.committed(saved)
        self.committed(self.command("submission.prepare", {"draft_id": "agent-private", "submission_id": "agent-private",
            "send_operation_id": "agent-private-send"}, target={"topic_id": "t1"}, expected={"draft_revision": 1}, actor="agent-a"))
        send = lambda: self.command("message.send", {"submission_id": "agent-private"}, target={"topic_id": "t1"},
                                    op="agent-private-send", actor="agent-a")
        receipt = send()
        sequence = self.message_sequence(receipt)
        self.assertEqual(send(), receipt)
        self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": "agent-private-send"}), receipt)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id='agent-private-send'"), [(1,)])
        self.assertEqual(self.sql("SELECT private_to,seq FROM messages WHERE id=?", (receipt["result"]["message_id"],)), [("owner", sequence)])
        self.assertEqual(self.sql("SELECT * FROM topic_summaries WHERE topic_id='t1'"), shared_before)
        self.assertEqual(self.sql("SELECT version FROM topics WHERE id='t1'"), topic_before)
        self.assertTrue(receipt["result"]["whisper"])
        self.assertEqual(self.store.view("agent-b", "source", {"kind": "message", "id": receipt["result"]["message_id"]})["error"]["code"], "FORBIDDEN")
        foreign = self.store.view("agent-b", "operation", {"operation_id": "agent-private-send"})
        self.assertEqual(foreign["status"], "unknown")
        self.assertNotIn("result", foreign)

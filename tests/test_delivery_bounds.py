from __future__ import annotations

import json
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import store as store_module
from test_delivery import DeliveryCase


def measured(operation):
    """Run one operation and count the SQLite VM instructions and statements it takes."""
    counts = {"vm_steps": 0, "statements": [], "group_query_vm_steps": 0}
    connect = store_module._connect

    def instrumented(path):
        db, runtime = connect(path)
        def step():
            counts["vm_steps"] += 1
            if counts["statements"] and counts["statements"][-1].startswith("SELECT id FROM delivery_groups"):
                counts["group_query_vm_steps"] += 1
            return 0
        db.set_progress_handler(step, 1)
        db.set_trace_callback(counts["statements"].append)
        return db, runtime

    started = time.monotonic()
    with mock.patch.object(store_module, "_connect", instrumented):
        result = operation()
    counts["seconds"] = time.monotonic() - started
    return result, counts


class DeliveryBoundsCase(DeliveryCase):
    def measured(self, operation):
        return measured(operation)

    def seed_pending(self, count, new_groups=False):
        # Bulk fixture only: the small tests exercise actual public sends. These
        # rows reproduce the exact indexed state without 30K draft/prepare ops.
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            group = db.execute("SELECT * FROM delivery_groups WHERE recipient_id='agent-a' AND kind='subscription' AND active=1").fetchone()
            for index in range(count):
                group_id = group["id"]
                topic_id = "t1"
                if new_groups:
                    topic_id = "bulk-topic-%s" % index
                    db.execute("INSERT INTO topics VALUES (?,'w1','Bulk topic','owner',1)", (topic_id,))
                    db.execute("INSERT INTO topic_participants VALUES (?,'agent-a',1,1,'')", (topic_id,))
                    group_id = db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES ('agent-a','subscription',?,1)", (topic_id,)).lastrowid
                mid, did = "bulk-message-%s" % index, "bulk-delivery-%s" % index
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) VALUES (?,?,'owner','Bulk body','[]','[]','[]',?)", (mid, topic_id, "bulk-op-%s" % index))
                seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES (?,?,'agent-a',?)", (did, mid, group_id)).lastrowid
                db.execute("INSERT INTO delivery_reasons VALUES (?,'subscription',?,?)", (did, topic_id, 1 if new_groups else group["participant_epoch"]))
                db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=COALESCE(first_pending_seq,?) WHERE id=?", (seq, group_id))
            db.execute("UPDATE recipient_schedule SET pending_count=pending_count+?,wake_generation=wake_generation+?,last_seq=(SELECT max(seq) FROM deliveries) WHERE recipient_id='agent-a'", (count, count))

    def test_ten_thousand_cancelled_rows_do_not_grow_first_page_or_removal_work(self):
        self.create_topic()
        _, baseline_read = self.measured(lambda: self.pending(limit=1))
        _, baseline_remove = self.measured(lambda: self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"}, expected={"topic_revision": 1}))
        self.command("participation.set", {"actor_id": "agent-a", "present": True}, target={"topic_id": "t1"})
        self.send_next("Before bulk")
        started = time.monotonic()
        self.seed_pending(10000)
        setup_seconds = time.monotonic() - started
        version = self.sql("SELECT version FROM topics WHERE id='t1'")[0][0]
        removed, bulk_remove = self.measured(lambda: self.command("participation.set", {"actor_id": "agent-a", "present": False}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.assertEqual(removed["status"], "committed", removed)
        self.command("participation.set", {"actor_id": "agent-a", "present": True}, target={"topic_id": "t1"})
        fresh = self.send_next("Fresh after ten thousand canceled")
        page, bulk_read = self.measured(lambda: self.pending(limit=1))
        self.assertEqual([item["message_id"] for item in page["items"]], [fresh], page)
        # Count VM instructions, not just elapsed wall time: a deliberately
        # regressed scan must fail even on a fast machine or a warm page cache.
        self.assertGreater(baseline_read["vm_steps"], 0)
        self.assertLess(bulk_read["vm_steps"], baseline_read["vm_steps"] + 250)
        self.assertLess(bulk_remove["vm_steps"], baseline_remove["vm_steps"] + 350)
        plans = self.sql("EXPLAIN QUERY PLAN SELECT id FROM delivery_groups INDEXED BY eligible_groups WHERE recipient_id='agent-a' AND active=1 AND pending_count>0 AND id>=0 ORDER BY id LIMIT 100")
        self.assertTrue(any("eligible_groups" in str(row) for row in plans), plans)
        print(json.dumps({"phase": "delivery_bounds", "setup_seconds": setup_seconds, "pages_to_fresh": 1,
            "baseline_read": baseline_read, "bulk_read": bulk_read, "baseline_remove": baseline_remove,
            "bulk_remove": bulk_remove, "query_plan": plans}, sort_keys=True))

    def test_one_hundred_fifty_groups_continue_and_new_early_group_work_is_found_on_restart(self):
        self.create_topic()
        self.send_next("First direct", ["agent-a"])
        self.seed_pending(150, new_groups=True)
        first_page, measured = self.measured(lambda: self.pending(limit=100))
        self.assertEqual(len(first_page["items"]), 100)
        self.assertGreater(measured["group_query_vm_steps"], 0)
        self.assertLessEqual(measured["group_query_vm_steps"], 750)
        seen, cursor, pages = [], None, 0
        while True:
            page = self.pending(limit=100, **({"cursor": cursor} if cursor is not None else {}))
            self.assertNotIn("error", page)
            seen.extend(row["id"] for row in page["items"])
            cursor, pages = page["next_cursor"], pages + 1
            self.assertLess(pages, 5)
            if cursor is None:
                break
        self.assertEqual(len(seen), 152)
        self.assertEqual(len(set(seen)), 152)
        # Use a real send for the arrival. The latest fixture source belongs to
        # another topic, so choose the last real message on t1 explicitly.
        source = {"kind": "message", "id": self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq DESC LIMIT 1")[0][0]}
        saved = self.command("draft.save", {"source_ref": source, "topic_id": "t1", "body": "New early-group work", "generation": "gA", "addressees": ["agent-a"]}, target={"draft_id": "restart"}, expected={"draft_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        self.prepare("restart", "t1", submission="restart", send_op="restart-send")
        sent = self.command("message.send", {"submission_id": "restart"}, target={"topic_id": "t1"}, op="restart-send")
        self.assertEqual(sent["status"], "committed", sent)
        self.assertIn(sent["result"]["message_id"], [row["message_id"] for row in self.pending(limit=100)["items"]])


for _name in list(DeliveryCase.__dict__):
    if _name.startswith("test_") and _name not in DeliveryBoundsCase.__dict__:
        setattr(DeliveryBoundsCase, _name, None)
del DeliveryCase


if __name__ == "__main__":
    unittest.main()

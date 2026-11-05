from __future__ import annotations

import json
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import store as store_module
from reader_fixture import ReaderCase


class ReaderBoundsCase(ReaderCase):
    def measured(self, callback):
        original, count = store_module._connect, [0]
        def connect(path):
            db, settings = original(path)
            def step():
                count[0] += 1
                return 0
            db.set_progress_handler(step, 1)
            return db, settings
        with mock.patch.object(store_module, "_connect", connect):
            result = callback()
        self.assertNotIn("error", result, result)
        self.assertGreater(count[0], 0)
        return result, count[0]

    def page(self, **args):
        return self.store.view("owner", "topic_messages", dict(topic_id="t1", audience="reader", **args))

    def test_sparse_neighbors_use_bounded_index_work_in_both_directions(self):
        first = self.send("First eligible", ["owner"])
        _, baseline_after = self.measured(lambda: self.page(cursor=first["seq"] - 1, limit=1))
        _, baseline_before = self.measured(lambda: self.page(direction="before", cursor=first["seq"] + 1, limit=1))
        started = time.perf_counter()
        with sqlite3.connect(str(self.path)) as db:
            # Bulk fixture represents exactly the send-maintained index; the
            # small public-send/duplicate/rollback tests prove maintenance.
            db.execute("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES ('unrelated','w1','Other','owner',0)")
            for index in range(10000):
                topic = "t1" if index < 5000 else "unrelated"
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) VALUES (?,?,'owner','Skip me','[]','[]','[\"agent-a\"]',?)",
                                 ("bulk-%s" % index, topic, "bulk-op-%s" % index)).lastrowid
                db.execute("INSERT INTO message_addressees VALUES (?,'agent-a',?)", (topic, seq))
            self.assertEqual(db.execute("SELECT count(*) FROM message_addressees WHERE actor_id='agent-a'").fetchone()[0], 10000)
        setup_seconds = time.perf_counter() - started
        last = self.send("Last eligible", ["owner"])
        after, after_work = self.measured(lambda: self.page(cursor=first["seq"], limit=1))
        before, before_work = self.measured(lambda: self.page(direction="before", cursor=last["seq"], limit=1))
        self.assertEqual([row["id"] for row in after["items"]], [last["id"]])
        self.assertEqual([row["id"] for row in before["items"]], [first["id"]])
        self.assertLess(after_work, baseline_after + 500)
        self.assertLess(before_work, baseline_before + 500)
        print(json.dumps({"phase": "reader_sparse_bounds", "setup_seconds": setup_seconds,
                          "baseline_vm": [baseline_after, baseline_before], "bulk_vm": [after_work, before_work]}))

    def test_notebook_list_work_does_not_grow_with_unrelated_items(self):
        self.committed(self.memory())
        args = {"owner_scope": {"kind": "topic", "id": "t1"}, "limit": 1}
        baseline, work = self.measured(lambda: self.store.view("owner", "memory_items", args))
        started = time.perf_counter()
        with sqlite3.connect(str(self.path)) as db:
            for index in range(5000):
                item = "unrelated-%s" % index
                db.execute("INSERT INTO memory_items(id,scope_kind,scope_id,creator_id,current_revision) VALUES (?,'workspace','w1','agent-a',1)", (item,))
                db.execute("INSERT INTO memory_revisions VALUES (?,1,'agent-a',?,'Title','Unrelated text','[]','[]')", (item, "fixture-" + item))
            self.assertEqual(db.execute("SELECT count(*) FROM memory_items WHERE scope_kind='workspace' AND scope_id='w1'").fetchone()[0], 5000)
        setup_seconds = time.perf_counter() - started
        result, bulk_work = self.measured(lambda: self.store.view("owner", "memory_items", args))
        self.assertEqual(result, baseline)
        self.assertLess(bulk_work, work + 150)
        print(json.dumps({"phase": "notebook_scope_bounds", "setup_seconds": setup_seconds,
                          "baseline_vm": work, "bulk_vm": bulk_work}))

    def test_byte_capped_pages_continue_in_traversal_direction_without_holes(self):
        addresses = ["owner"] + ["long-%s-" % index + "é" * 150 for index in range(31)]
        wanted = []
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", [(actor, actor) for actor in addresses[1:]])
            for index in range(40):
                item = "byte-message-%02d" % index
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) VALUES (?,'t1','owner',?,'[]','[]',?,?)",
                                 (item, "é" * 1024, json.dumps(addresses), "byte-op-%s" % index)).lastrowid
                db.executemany("INSERT INTO message_addressees VALUES ('t1',?,?)", [(actor, seq) for actor in addresses])
                wanted.append((seq, item))
        for direction in ("before", "after"):
            cursor = wanted[0][0] - 1 if direction == "after" else wanted[-1][0] + 1
            seen, pages = [], 0
            while True:
                page = self.page(direction=direction, cursor=cursor, limit=100)
                self.assertNotIn("error", page, page)
                self.assertLessEqual(self.json_size(page), 131072)
                self.assertGreater(len(page["items"]), 0)
                self.assertLess(len(page["items"]), 40)
                seqs = [row["seq"] for row in page["items"]]
                self.assertEqual(seqs, sorted(seqs))
                seen.extend(row["id"] for row in (page["items"] if direction == "after" else reversed(page["items"])) if row["id"].startswith("byte-message-"))
                pages += 1
                self.assertLess(pages, 10)
                next_cursor = page["next_cursor"]
                if next_cursor is None:
                    break
                self.assertEqual(next_cursor, min(seqs) if direction == "before" else max(seqs))
                self.assertNotEqual(cursor, next_cursor)
                cursor = next_cursor
            expected = [item for _, item in wanted]
            self.assertEqual(seen, expected if direction == "after" else expected[::-1])


del ReaderCase

if __name__ == "__main__":
    unittest.main()

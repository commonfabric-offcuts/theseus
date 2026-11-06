from __future__ import annotations

"""Which revision of each Notebook page each person last read.

Core keeps it, per person and page, so a page read earlier and revised since
shows as changed on every device until the person opens it again."""

import json
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import store as store_module
from reader_fixture import ReaderCase


OUTCOME = {"kind": "workspace", "id": "w1"}


class MemoryReadCase(ReaderCase):
    def read(self, revision, item="memory-one", actor="owner", op=None, **extra):
        return self.command("memory.read", dict({"revision": revision}, **extra), target={"item_id": item}, actor=actor, op=op)

    def listed(self, actor="owner", scope=OUTCOME):
        answer = self.store.view(actor, "memory_items", {"owner_scope": scope})
        self.assertNotIn("error", answer, answer)
        return {item["id"]: (item["revision"], item["read_revision"]) for item in answer["items"]}

    def reads(self, actor="owner"):
        return self.sql("SELECT actor_id,item_id,revision FROM memory_reads WHERE actor_id=? ORDER BY item_id", (actor,))

    def outcome_page(self, body="Revision one", revision=0, actor="agent-a"):
        return self.committed(self.memory(scope=OUTCOME, body=body, revision=revision, actor=actor))

    def test_a_page_never_read_lists_revision_zero_and_a_read_is_the_readers_own(self):
        self.outcome_page()
        self.assertEqual(self.listed(), {"memory-one": (1, 0)})
        result = self.committed(self.read(1))
        self.assertEqual(result, {"item_id": "memory-one", "previous_revision": 0, "current_revision": 1,
                                  "read_revision": 1, "changed": True})
        self.assertEqual(self.listed(), {"memory-one": (1, 1)})
        # Another person's list is their own: agent-b has read nothing.
        self.assertEqual(self.listed("agent-b"), {"memory-one": (1, 0)})
        # The read tells only the reader's own changes.
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE resource_kind='memory_read'"),
                         [("actor", "owner", "memory_read", "memory-one", 1)])

    def test_a_revision_after_a_read_lists_the_page_changed_until_it_is_read_again(self):
        self.outcome_page()
        self.committed(self.read(1))
        self.outcome_page(body="Revision two", revision=1)
        self.outcome_page(body="Revision three", revision=2)
        self.assertEqual(self.listed(), {"memory-one": (3, 1)}, "read at one, now at three")
        self.assertEqual(self.committed(self.read(3))["previous_revision"], 1)
        self.assertEqual(self.listed(), {"memory-one": (3, 3)})

    def test_a_read_only_moves_forward(self):
        self.outcome_page()
        self.outcome_page(body="Revision two", revision=1)
        self.committed(self.read(2))
        changes = self.sql("SELECT count(*) FROM changes")
        # An older revision opened later, or the same one again, changes nothing.
        for revision in (1, 2):
            with self.subTest(revision=revision):
                self.assertEqual(self.committed(self.read(revision)),
                                 {"item_id": "memory-one", "previous_revision": 2, "current_revision": 2,
                                  "read_revision": 2, "changed": False})
        self.assertEqual(self.reads(), [("owner", "memory-one", 2)])
        self.assertEqual(self.sql("SELECT count(*) FROM changes"), changes, "a read that moves nothing tells nobody")

    def test_reading_an_older_revision_first_leaves_the_page_changed(self):
        self.outcome_page()
        self.outcome_page(body="Revision two", revision=1)
        self.committed(self.read(1))
        self.assertEqual(self.listed(), {"memory-one": (2, 1)}, "the person read one; two is newer")

    def test_a_retry_with_the_same_operation_is_one_read(self):
        self.outcome_page()
        first = self.read(1, op="read-once")
        self.assertEqual(self.read(1, op="read-once"), first)
        self.assertEqual(self.reads(), [("owner", "memory-one", 1)])
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='memory_read'"), [(1,)])

    def test_only_a_readable_exact_revision_is_read(self):
        self.outcome_page()
        for revision in (0, -1, True, 1.0, "1", None):
            with self.subTest(revision=revision):
                self.rejected(self.read(revision), "INVALID_ARGUMENT")
        self.rejected(self.read(2), "FORBIDDEN")
        self.rejected(self.read(1, item="no-such-page"), "FORBIDDEN")
        # Someone outside the outcome cannot read its page, so cannot record reading it.
        self.rejected(self.read(1, actor="other-reader"), "FORBIDDEN")
        self.rejected(self.read(1, also="this"), "INVALID_ARGUMENT")
        self.rejected(self.command("memory.read", {"revision": 1}, target={"item_id": "memory-one", "extra": 1}), "INVALID_ARGUMENT")
        self.assertEqual(self.reads(), [])

    def test_whoever_writes_a_revision_has_read_it(self):
        self.outcome_page()
        self.assertEqual(self.listed("agent-a"), {"memory-one": (1, 1)}, "the creator read what they wrote")
        self.outcome_page(body="Revision two", revision=1, actor="agent-b")
        self.assertEqual(self.listed("agent-b"), {"memory-one": (2, 2)}, "the reviser read what they wrote")
        self.assertEqual(self.listed("agent-a"), {"memory-one": (2, 1)}, "for the creator it changed")
        self.assertEqual(self.listed(), {"memory-one": (2, 0)}, "someone who never read it is not told it changed")
        # Writing is its own change; the writer's feed is not told twice.
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='memory_read'"), [(0,)])
        # A writer who had read an earlier revision has read the one they write.
        self.outcome_page(body="Revision three", revision=2, actor="agent-a")
        self.assertEqual(self.listed("agent-a"), {"memory-one": (3, 3)}, "the creator's second edit is read by them")
        self.committed(self.read(3, actor="agent-b"))
        self.outcome_page(body="Revision four", revision=3, actor="agent-b")
        self.assertEqual(self.listed("agent-b"), {"memory-one": (4, 4)}, "a reader who then writes has read what they wrote")

    def test_a_topic_page_keeps_its_reads_the_same_way(self):
        self.committed(self.memory())
        self.committed(self.read(1))
        self.committed(self.memory(revision=1, body="Revised in the topic"))
        self.assertEqual(self.listed(scope={"kind": "topic", "id": "t1"}), {"memory-one": (2, 1)})

    def test_listing_work_does_not_grow_with_other_peoples_reads(self):
        self.outcome_page()
        args = {"owner_scope": OUTCOME, "limit": 1}

        def measured():
            count = [0]
            original = store_module._connect

            def connect(*a, **k):
                db, settings = original(*a, **k)

                def step():
                    count[0] += 1
                    return 0
                db.set_progress_handler(step, 1)
                return db, settings
            with mock.patch.object(store_module, "_connect", connect):
                result = self.store.view("owner", "memory_items", args)
            self.assertNotIn("error", result, result)
            return result, count[0]
        baseline, work = measured()
        started = time.perf_counter()
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'human',?)", [("reader-%d" % n, "Reader") for n in range(2000)])
            db.executemany("INSERT INTO memory_reads VALUES (?,'memory-one',1)", [("reader-%d" % n,) for n in range(2000)])
        result, bulk = measured()
        self.assertEqual(result, baseline)
        self.assertLess(bulk, work + 150)
        print(json.dumps({"phase": "notebook_read_bounds", "setup_seconds": time.perf_counter() - started,
                          "baseline_vm": work, "bulk_vm": bulk}))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Marked unread: a person's own durable reminder, counted once, cleared by message.mark (and by their own 👍 or
go-ahead answer, which read the message: tests/test_reactions.py)."""

import concurrent.futures
import sqlite3
import threading
import unittest
from unittest import mock

from aim_next import store as store_module

from test_agent_loop import AgentLoopCase


class MarkCase(AgentLoopCase):
    def mark(self, message_id, marked, expected, actor="owner", op=None):
        return self.command("message.mark", {"marked": marked}, target={"message_id": message_id},
                            expected={"mark_revision": expected}, actor=actor, op=op)

    def revision(self, message_id, actor="owner"):
        rows = self.sql("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?", (actor, message_id))
        return rows[0][0] if rows else 0

    def seq(self, message_id):
        return self.sql("SELECT seq FROM messages WHERE id=?", (message_id,))[0][0]

    def through(self, message_id, actor="owner", topic="t1"):
        # Only this message, as a Reader open of it reports.
        seq = self.seq(message_id)
        return self.command("topic.read_through", {"seq": seq, "from_seq": seq}, target={"topic_id": topic}, actor=actor)

    def counts(self, actor="owner"):
        """(topic page, outcome rows, (unread, addressed) totals, latest_addressed, attention.after)."""
        topics = self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})
        outcomes = self.store.view(actor, "workspaces", {})
        attention = self.store.view(actor, "attention", {})
        after = self.store.view(actor, "capabilities", {})["attention"]["after"]
        for answer in (topics, outcomes, attention):
            self.assertNotIn("error", answer, answer)
        return ({item["id"]: (item["unread"], item["addressed"]) for item in topics["items"]},
                {item["id"]: (item["unread"], item["addressed"]) for item in outcomes["items"]},
                (attention["unread"], attention["addressed"]), attention["latest_addressed"], after)

    def unread(self, actor):
        answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return answer["unread"]

    def read(self, body="Posted words", **args):
        """A message from agent-a that the owner has already read through."""
        message = self.committed(self.post(body=body, **args))["message_id"]
        self.committed(self.through(message))
        return message

    def editor_mark(self, message_id, actor="owner"):
        answer = self.store.view(actor, "editor_state", {"source_ref": {"kind": "message", "id": message_id}, "topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return answer["mark"]


class MarkCountCase(MarkCase):
    def test_a_mark_counts_one_unread_in_every_count_and_never_addressed(self):
        named = self.committed(self.post(body="Named, still waiting", addressees=["owner"]))["message_id"]
        message = self.read("Read already")
        before = self.counts()
        topics, outcomes, total, latest, after = before
        self.committed(self.mark(message, True, 0))
        marked = self.counts()
        self.assertEqual(marked[0]["t1"], (topics["t1"][0] + 1, topics["t1"][1]))
        self.assertEqual(marked[1]["w1"], (outcomes["w1"][0] + 1, outcomes["w1"][1]))
        self.assertEqual(marked[2], (total[0] + 1, total[1]))
        # A mark is never sent to anyone: nothing new is addressed or announced.
        self.assertEqual((marked[3], marked[4]), (latest, after))
        self.assertEqual([item["message_id"] for item in latest], [named])
        self.committed(self.mark(message, False, 1))
        self.assertEqual(self.counts(), before)

    def test_a_mark_on_your_own_message_counts_nowhere(self):
        # Your own message is never unread for you: a mark on one is held, but no
        # count, no list of marks, no Reader button and no New line shows it.
        own = self.committed(self.post(actor="owner", body="Mine"))["message_id"]
        theirs = self.read("Theirs, read already")
        before = self.counts()
        self.committed(self.mark(own, True, 0))
        self.assertEqual(self.counts(), before, "counts in the topic, the outcome and the totals")
        self.assertEqual(self.store.view("owner", "marks", {"topic_id": "t1"})["items"], [], "no Unread pill, no marks line")
        self.assertIsNone(self.editor_mark(own), "the Reader offers no Mark unread on your own message")
        self.assertIsNone(self.store.view("owner", "topic_unread", {"topic_id": "t1"})["oldest_unread"], "no New line")
        # Someone else's message marked the same way counts in each.
        self.committed(self.mark(theirs, True, 0))
        topics, outcomes, total = self.counts()[:3]
        self.assertEqual((topics["t1"][0], outcomes["w1"][0], total[0]), (before[0]["t1"][0] + 1, before[1]["w1"][0] + 1, before[2][0] + 1))
        self.assertEqual([item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t1"})["items"]], [theirs])
        self.assertEqual(self.editor_mark(theirs), {"marked": True, "mark_revision": 1})
        self.assertEqual(self.store.view("owner", "topic_unread", {"topic_id": "t1"})["oldest_unread"]["id"], theirs)
        # agent-a's own mark on its own message counts nowhere for it either.
        start = self.unread("agent-a")
        self.committed(self.mark(theirs, True, 0, actor="agent-a"))
        self.assertEqual(self.unread("agent-a"), start)

    def test_a_mark_changes_no_delivery_schedule_or_wake(self):
        message = self.read()
        self.committed(self.post(body="Waiting for the owner"))
        before, deliveries = self.public_state(), self.store.view("owner", "deliveries", {})
        agent = self.store.view("agent-a", "deliveries", {})
        self.committed(self.mark(message, True, 0))
        self.assertEqual((self.public_state(), self.store.view("owner", "deliveries", {})), (before, deliveries))
        self.committed(self.mark(message, False, 1))
        self.committed(self.mark(message, True, 2))
        self.assertEqual(self.public_state(), before)
        self.assertEqual(self.store.view("agent-a", "deliveries", {}), agent)
        self.consistent()

    def test_a_pending_delivery_and_its_mark_count_once_and_reading_keeps_the_mark(self):
        start = self.unread("owner")
        first = self.committed(self.post(body="First"))["message_id"]
        second = self.committed(self.post(body="Second", addressees=["owner"]))["message_id"]
        self.assertEqual(self.unread("owner"), start + 2)
        self.committed(self.mark(first, True, 0))
        self.committed(self.mark(second, True, 0))
        self.assertEqual(self.unread("owner"), start + 2, "a message with a pending delivery and a mark counts once")
        # Reading through settles the delivery; the mark stays and counts the message once.
        self.committed(self.through(first))
        self.assertEqual(self.unread("owner"), start + 2)
        [(delivery,)] = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='owner'", (second,))
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": delivery}))
        self.assertEqual(self.unread("owner"), start + 2)
        self.assertEqual((self.revision(first), self.revision(second)), (1, 1))
        self.assertEqual(self.store.view("owner", "attention", {})["addressed"], 0)
        self.committed(self.mark(first, False, 1))
        self.committed(self.mark(second, False, 1))
        self.assertEqual(self.unread("owner"), start)

    def test_a_pending_row_of_a_cancelled_subscription_does_not_hide_the_mark(self):
        # The owner leaves the topic but still reads it as the outcome's owner.
        message = self.committed(self.post(body="Before leaving"))["message_id"]
        start = self.unread("owner")
        self.participation("owner", False)
        self.assertEqual(self.unread("owner"), start - 1, "a cancelled subscription's pending row counts nowhere")
        self.committed(self.mark(message, True, 0))
        self.assertEqual(self.unread("owner"), start)
        self.assertEqual(self.counts()[0]["t1"][0], 1)

    def test_mark_leave_and_rejoin_counts_one_and_a_lost_topic_holds_its_mark_dormant(self):
        self.participation("other-reader", True)
        message = self.committed(self.post(body="For the room"))["message_id"]
        self.assertEqual(self.unread("other-reader"), 1)
        self.committed(self.mark(message, True, 0, actor="other-reader"))
        self.assertEqual(self.unread("other-reader"), 1)
        # Outside the outcome, leaving the topic loses it: the mark is kept and not counted.
        self.participation("other-reader", False)
        self.assertEqual(self.unread("other-reader"), 0)
        self.assertEqual(self.revision(message, "other-reader"), 1)
        self.participation("other-reader", True)
        self.assertEqual(self.unread("other-reader"), 1)
        self.consistent()

    def test_a_lost_topic_refuses_a_mark_even_on_a_message_sent_by_name(self):
        self.participation("other-reader", True)
        named = self.committed(self.post(body="For you by name", addressees=["other-reader"]))["message_id"]
        plain = self.committed(self.post(body="For the room"))["message_id"]
        self.committed(self.mark(plain, True, 0, actor="other-reader"))
        self.participation("other-reader", False)
        # Still readable by name, but a mark lives in a topic the person can open.
        self.assertNotIn("error", self.store.view("other-reader", "source", {"source_ref": {"kind": "message", "id": named}}))
        before = self.public_state(), self.sql("SELECT * FROM message_marks ORDER BY rowid")
        for message, marked, expected in ((named, True, 0), (plain, False, 1)):
            with self.subTest(message=message):
                receipt = self.mark(message, marked, expected, actor="other-reader")
                self.rejected(receipt, "FORBIDDEN")
                self.assertTrue(receipt["recorded"])
                self.assertNotIn("current_versions", receipt["error"], "a refusal names no revision to someone without the topic")
        self.assertEqual((self.public_state(), self.sql("SELECT * FROM message_marks ORDER BY rowid")), before)
        self.rejected(self.mark("m-missing", True, 0), "FORBIDDEN")

    def test_an_archived_topic_counts_its_marks_only_on_its_own_row(self):
        message = self.read()
        self.committed(self.mark(message, True, 0))
        topics, outcomes, total, _, _ = self.counts()
        self.assertEqual((topics["t1"][0], outcomes["w1"][0], total[0]), (1, 1, 1))
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"archived": True}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        topics, outcomes, total, _, _ = self.counts()
        self.assertEqual((outcomes["w1"], total), ((0, 0), (0, 0)))
        archived = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "archived": True})["items"]
        self.assertEqual([(item["id"], item["unread"]) for item in archived], [("t1", 1)])
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"archived": False}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        topics, outcomes, total, _, _ = self.counts()
        self.assertEqual((topics["t1"][0], outcomes["w1"][0], total[0]), (1, 1, 1))


class MarkCommandCase(MarkCase):
    def test_a_retry_returns_its_receipt_and_a_changed_payload_is_refused(self):
        message = self.read()
        receipt = self.mark(message, True, 0, op="mark-once")
        self.assertEqual(self.committed(receipt), {"message_id": message, "topic_id": "t1", "seq": self.seq(message),
                                                    "marked": True, "mark_revision": 1, "changed": True})
        self.assertEqual(receipt["affected"], [{"kind": "mark", "id": message, "version": 1}])
        before = self.records()
        self.assertEqual(self.mark(message, True, 0, op="mark-once"), receipt)
        self.assertEqual(self.records(), before)
        changed = self.mark(message, False, 0, op="mark-once")
        self.rejected(changed, "OPERATION_PAYLOAD_MISMATCH")
        self.assertFalse(changed["recorded"])
        self.assertEqual(self.records(), before)
        self.assertEqual(self.revision(message), 1)

    def test_a_clear_of_what_is_not_marked_changes_nothing_but_keeps_its_receipt(self):
        message = self.read()
        for revision in (0, 2):
            with self.subTest(revision=revision):
                if revision:
                    self.committed(self.mark(message, True, 0))
                    self.committed(self.mark(message, False, 1))
                marks, changes = self.sql("SELECT * FROM message_marks"), self.sql("SELECT * FROM changes")
                op = "clear-at-%d" % revision
                receipt = self.mark(message, False, revision, op=op)
                self.assertEqual(self.committed(receipt)["changed"], False)
                self.assertEqual((receipt["result"]["marked"], receipt["result"]["mark_revision"], receipt["affected"]),
                                 (False, revision, []))
                self.assertEqual((self.sql("SELECT * FROM message_marks"), self.sql("SELECT * FROM changes")), (marks, changes))
                # The receipt is stored, so a lost answer is replayed rather than guessed.
                self.assertEqual(self.store.view("owner", "operation", {"operation_id": op}), receipt)
        # The fence still holds: a clear that saw an older revision is refused.
        stale = self.mark(message, False, 1)
        self.rejected(stale, "REVISION_CONFLICT")
        self.assertEqual(stale["error"]["current_versions"], {"mark_revision": 2})

    def test_marking_what_is_marked_renews_it_so_an_older_open_cannot_clear_it(self):
        # aim-core's race: marked at 1, an open captured 1, another tab marks
        # again; the open's clear at 1 must not remove the newer reminder.
        message = self.read()
        self.committed(self.mark(message, True, 0))
        renewed = self.committed(self.mark(message, True, 1))
        self.assertEqual((renewed["marked"], renewed["mark_revision"], renewed["changed"]), (True, 3, True))
        stale = self.mark(message, False, 1)
        self.rejected(stale, "REVISION_CONFLICT")
        self.assertTrue(stale["recorded"])
        self.assertEqual(stale["error"]["current_versions"], {"mark_revision": 3})
        self.assertEqual((self.revision(message), self.unread("owner")), (3, 1))
        self.assertEqual(self.committed(self.mark(message, False, 3))["mark_revision"], 4)

    def test_a_stale_clear_after_a_mark_clear_and_mark_again_is_refused(self):
        message = self.read()
        self.committed(self.mark(message, True, 0))
        self.committed(self.mark(message, False, 1))
        self.committed(self.mark(message, True, 2))
        stale = self.mark(message, False, 1)
        self.rejected(stale, "REVISION_CONFLICT")
        self.assertEqual(stale["error"]["current_versions"], {"mark_revision": 3})
        self.assertEqual((self.revision(message), self.unread("owner")), (3, 1))

    def test_a_mark_that_arrives_late_cannot_bring_back_a_reminder_marked_and_cleared_meanwhile(self):
        # A sends mark at 0, but its request reaches Core late; meanwhile B marks and clears.
        message = self.read()
        self.committed(self.mark(message, True, 0, op="tab-b-mark"))
        self.committed(self.mark(message, False, 1, op="tab-b-clear"))
        late = self.mark(message, True, 0, op="tab-a-mark")
        self.rejected(late, "REVISION_CONFLICT")
        self.assertTrue(late["recorded"])
        self.assertEqual(late["error"]["current_versions"], {"mark_revision": 2})
        self.assertEqual((self.revision(message), self.unread("owner")), (2, 0))
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "tab-a-mark"}), late)

    def test_the_envelope_is_exact(self):
        message = self.read()
        for target, args, expected in (({"message_id": message, "topic_id": "t1"}, {"marked": True}, {"mark_revision": 0}),
                                       ({"message_id": message}, {"marked": 1}, {"mark_revision": 0}),
                                       ({"message_id": message}, {"marked": True, "note": "x"}, {"mark_revision": 0}),
                                       ({"message_id": message}, {"marked": True}, {})):
            with self.subTest(target=target, args=args, expected=expected):
                receipt = self.command("message.mark", args, target=target, expected=expected)
                self.rejected(receipt, "INVALID_ARGUMENT")
                self.assertFalse(receipt["recorded"])
        self.assertEqual(self.sql("SELECT count(*) FROM message_marks"), [(0,)])


class MarkReadCase(MarkCase):
    def test_editor_state_carries_the_mark_and_reading_it_writes_nothing(self):
        message = self.read()
        self.assertEqual(self.editor_mark(message), {"marked": False, "mark_revision": 0})
        self.committed(self.mark(message, True, 0))
        before = self.records()
        self.assertEqual(self.editor_mark(message), {"marked": True, "mark_revision": 1})
        self.assertEqual(self.editor_mark(message, "agent-b"), {"marked": False, "mark_revision": 0}, "a mark is the person's own")
        self.assertEqual(self.records(), before)
        self.committed(self.mark(message, False, 1))
        self.assertEqual(self.editor_mark(message), {"marked": False, "mark_revision": 2})
        topic = self.store.view("owner", "editor_state", {"source_ref": {"kind": "topic", "id": "t1"}, "topic_id": "t1"})
        self.assertIsNone(topic["mark"])

    def test_editor_state_offers_no_mark_where_the_person_cannot_mark(self):
        self.participation("other-reader", True)
        named = self.committed(self.post(body="For you by name", addressees=["other-reader"]))["message_id"]
        self.assertEqual(self.editor_mark(named, "other-reader"), {"marked": False, "mark_revision": 0})
        self.participation("other-reader", False)
        self.assertIsNone(self.editor_mark(named, "other-reader"))

    def test_changes_carry_each_mark_once(self):
        message = self.read()
        changes = lambda cursor: self.store.view("owner", "changes", {"scope": {"kind": "actor", "id": "owner"}, "cursor": cursor})
        topic_changes = lambda cursor: self.store.view("owner", "changes", {"scope": {"kind": "topic", "id": "t1"}, "cursor": cursor})
        baseline = self.store.view("owner", "changes", {"scope": {"kind": "actor", "id": "owner"}})["checkpoint"]
        topic_baseline = self.store.view("owner", "changes", {"scope": {"kind": "topic", "id": "t1"}})["checkpoint"]
        self.committed(self.mark(message, True, 0, op="mark"))
        clear = self.mark(message, False, 1, op="clear")
        self.committed(clear)
        self.assertEqual(self.mark(message, False, 1, op="clear"), clear)
        self.committed(self.mark(message, False, 2, op="clear-again"))
        answer = changes(baseline)
        self.assertEqual([(item["resource_kind"], item["resource_id"], item["version"]) for item in answer["items"]],
                         [("mark", message, 1), ("mark", message, 2)])
        self.assertEqual(topic_changes(topic_baseline)["items"], [], "a mark writes no topic key")

    def test_the_marks_view_lists_one_persons_marks_in_one_topic_oldest_first(self):
        messages = [self.read("Message %d" % n) for n in range(5)]
        for message in reversed(messages):
            self.committed(self.mark(message, True, 0))
        self.committed(self.mark(messages[2], False, 1))
        self.committed(self.mark(messages[0], True, 0, actor="agent-b"))
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Second",
                                                     "participants": ["agent-a"], "body": "Elsewhere", "attachments": []},
                                    target={"opening_id": "o2"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}))
        elsewhere = self.committed(self.post(topic="t2", body="Elsewhere, by agent-a"))["message_id"]
        self.committed(self.mark(elsewhere, True, 0))
        pages, cursor = [], None
        while True:
            args = {"topic_id": "t1", "limit": 2}
            if cursor is not None:
                args["cursor"] = cursor
            page = self.store.view("owner", "marks", args)
            self.assertNotIn("error", page, page)
            pages.append([(item["message_id"], item["seq"], item["mark_revision"]) for item in page["items"]])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        expected = [(message, self.seq(message), 1) for message in messages if message != messages[2]]
        self.assertEqual(pages, [expected[:2], expected[2:]])
        self.assertEqual([item["message_id"] for item in self.store.view("agent-b", "marks", {"topic_id": "t1"})["items"]], [messages[0]])
        self.assertEqual([item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t2"})["items"]], [elsewhere])
        self.assertEqual(self.store.view("outsider", "marks", {"topic_id": "t1"})["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.store.view("owner", "marks", {"topic_id": "t1", "actor": "agent-a"})["error"]["code"], "INVALID_ARGUMENT")


class MarkCostCase(MarkCase):
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
        return result, count[0]

    def test_counting_and_listing_follow_the_persons_own_marks_not_history(self):
        message = self.read()
        self.committed(self.mark(message, True, 0))
        reads = {"attention": lambda: self.store.view("owner", "attention", {}),
                 "topics": lambda: self.store.view("owner", "workspace_topics", {"workspace_id": "w1"}),
                 "outcomes": lambda: self.store.view("owner", "workspaces", {}),
                 "marks": lambda: self.store.view("owner", "marks", {"topic_id": "t1"})}
        before = {name: self.measured(read)[1] for name, read in reads.items()}
        # Two thousand messages in the topic, each marked by someone else and
        # marked then cleared by the reader.
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                           "VALUES (?,'t1','agent-a','Bulk','[]','[]','[]',?)", [("m-bulk-%04d" % n, "bulk-%d" % n) for n in range(2000)])
            rows = db.execute("SELECT id,seq FROM messages WHERE id LIKE 'm-bulk-%'").fetchall()
            db.executemany("INSERT INTO message_marks VALUES (?,?,'t1',?,?)",
                           [(actor, message_id, seq, revision) for message_id, seq in rows
                            for actor, revision in (("agent-a", 1), ("other-reader", 3), ("owner", 2))])
        for name, read in reads.items():
            with self.subTest(read=name):
                result, after = self.measured(read)
                self.assertLess(after, before[name] + 500, "%s grew from %d to %d steps" % (name, before[name], after))
        self.assertEqual(self.unread("owner"), 1)
        self.assertEqual(len(self.store.view("owner", "marks", {"topic_id": "t1"})["items"]), 1)



class MarkRaceAndRecoveryCase(MarkCase):
    """Concurrent, interrupted and reopened marks (cases from the server review)."""

    def concurrent(self, envelopes):
        barrier = threading.Barrier(len(envelopes))
        def call(envelope):
            other = store_module.Store(self.path, "test-instance", expected_binding=self.binding)
            barrier.wait()
            return other.command("owner", envelope)
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(envelopes)) as pool:
            return list(pool.map(call, envelopes))

    def test_distinct_concurrent_marks_have_one_winner_and_one_recorded_conflict(self):
        message = self.read()
        envelopes = [self.envelope("message.mark", {"message_id": message}, {"marked": True},
                                   {"mark_revision": 0}, op="race-"+str(n)) for n in range(2)]
        receipts = self.concurrent(envelopes)
        self.assertEqual(sum(r["status"] == "committed" for r in receipts), 1, receipts)
        loser = next(r for r in receipts if r["status"] != "committed")
        self.assertEqual(loser["error"]["code"], "REVISION_CONFLICT")
        self.assertTrue(loser["recorded"])
        self.assertEqual(self.revision(message), 1)
        for envelope, receipt in zip(envelopes, receipts):
            self.assertEqual(self.store.command("owner", envelope), receipt)

    def test_duplicate_concurrent_mark_has_one_receipt_one_change_and_survives_reopen(self):
        message = self.read()
        envelope = self.envelope("message.mark", {"message_id": message}, {"marked": True},
                                 {"mark_revision": 0}, op="duplicate-race")
        receipts = self.concurrent([envelope, envelope])
        self.assertEqual(receipts[0], receipts[1])
        self.committed(receipts[0])
        self.assertEqual(self.revision(message), 1)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE resource_kind='mark'"), [(1,)])
        self.store = store_module.Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.editor_mark(message), {"marked": True, "mark_revision": 1})
        self.assertEqual(self.store.command("owner", envelope), receipts[0])

    def test_failure_after_mark_write_rolls_back_and_exact_retry_can_commit(self):
        message = self.read()
        envelope = self.envelope("message.mark", {"message_id": message}, {"marked": True},
                                 {"mark_revision": 0}, op="interrupted-mark")
        before = self.records()
        def fail(db, *args):
            self.assertEqual(db.execute("SELECT revision FROM message_marks WHERE message_id=?", (message,)).fetchone()[0], 1)
            raise sqlite3.OperationalError("review injected write failure")
        with mock.patch.object(self.store, "_change", side_effect=fail):
            with self.assertRaises(store_module.StoreError):
                self.store.command("owner", envelope)
        self.assertEqual(self.records(), before)
        self.committed(self.store.command("owner", envelope))
        self.assertEqual(self.revision(message), 1)

    def test_archived_external_participant_mark_is_retained_without_global_unread(self):
        self.participation("other-reader", True)
        message = self.committed(self.post())["message_id"]
        self.committed(self.through(message, actor="other-reader"))
        self.committed(self.mark(message, True, 0, actor="other-reader"))
        self.assertEqual(self.unread("other-reader"), 1)
        self.committed(self.command("topic.update", {"archived": True}, target={"topic_id": "t1"},
                                    expected={"topic_revision": self.store.view("owner","topic",{"topic_id":"t1"})["topic"]["version"]}))
        self.assertEqual(self.unread("other-reader"), 0)
        self.assertEqual(self.store.view("other-reader","marks",{"topic_id":"t1"})["items"],
                         [{"message_id": message, "seq": self.seq(message), "mark_revision": 1}])
        self.assertEqual(self.revision(message, "other-reader"), 1)


if __name__ == "__main__":
    unittest.main()

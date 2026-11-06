from __future__ import annotations

import sqlite3
from unittest import mock

from aim_next import store as store_module
from reader_fixture import ReaderCase


class UnansweredCase(ReaderCase):
    """Where the red "New" line sits: just below the oldest message the reader has not replied to."""

    def post(self, actor, body, reply_to=None):
        args = {"body": body}
        if reply_to:
            args["reply_to"] = reply_to
        return self.committed(self.command("message.post", args, target={"topic_id": "t1"}, actor=actor))["message_id"]

    def boundary(self, actor="owner", **args):
        page = self.store.view(actor, "topic_messages", dict({"topic_id": "t1", "direction": "before", "limit": 30}, **args))
        self.assertNotIn("error", page, page)
        return page["unanswered"]

    def at(self, message_id):
        seq, sent_ms = self.sql("SELECT seq,sent_ms FROM messages WHERE id=?", (message_id,))[0]
        return {"seq": seq, "id": message_id, "sent_ms": sent_ms}

    def test_the_boundary_says_when_that_message_was_sent(self):
        first = self.post("agent-a", "First")
        self.post("agent-a", "Second")
        boundary = self.boundary()
        self.assertEqual(boundary["id"], first)
        self.assertIsInstance(boundary.get("sent_ms"), int, "the boundary says when its message was sent")
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 30})
        self.assertEqual(boundary["sent_ms"], next(item["sent_ms"] for item in page["items"] if item["id"] == first),
                         "the New line's time is the time its message's card shows")
        # A message from before times were kept has none: test_migrations reads it as null.

    def test_the_line_follows_the_oldest_message_the_reader_has_not_replied_to(self):
        self.assertIsNone(self.boundary(), "the opening is the reader's own")
        self.assertEqual(self.boundary("agent-a"), self.at(self.opening["id"]), "someone who never wrote has not replied to it")
        first = self.post("agent-a", "First")
        second = self.post("agent-a", "Second")
        third = self.post("agent-a", "Third")
        self.assertEqual(self.boundary(), self.at(first))
        self.post("owner", "To the third", reply_to=third)
        self.assertEqual(self.boundary(), self.at(first), "a reply to a newer message leaves the line under the oldest")
        self.post("owner", "To the first", reply_to=first)
        self.assertEqual(self.boundary(), self.at(second), "a reply to the oldest moves the line up to the next")
        self.post("owner", "To the second", reply_to=second)
        self.assertIsNone(self.boundary(), "replied to every one, there is no line")
        fourth = self.post("agent-a", "Fourth")
        self.assertEqual(self.boundary(), self.at(fourth))

    def test_a_post_to_the_whole_topic_answers_everything_before_it_and_nothing_after(self):
        self.post("agent-a", "Before")
        self.post("agent-a", "Also before")
        self.post("owner", "To everyone")
        self.assertIsNone(self.boundary())
        after = self.post("agent-a", "After")
        self.assertEqual(self.boundary(), self.at(after))
        # Someone else's replies are theirs: they answer nothing for this reader.
        self.post("agent-a", "agent-a answers itself", reply_to=after)
        self.assertEqual(self.boundary(), self.at(after))

    def test_reading_marking_and_paging_do_not_move_it(self):
        first = self.post("agent-a", "First")
        self.post("agent-a", "Second")
        expected = self.at(first)
        self.committed(self.command("topic.read_through", {"seq": 10 ** 6}, target={"topic_id": "t1"}))
        self.assertEqual(self.boundary(), expected, "reading through settles deliveries, not replies")
        self.committed(self.command("message.mark", {"marked": True}, target={"message_id": first}, expected={"mark_revision": 0}))
        self.assertEqual(self.boundary(), expected, "a message marked unread does not move the line")
        self.assertEqual(self.boundary(limit=1), expected, "every page says the same")
        self.assertEqual(self.boundary(direction="after", cursor=0, limit=1), expected)
        self.assertEqual(self.boundary(audience="reader"), expected)

    def measured(self, callback):
        original, count = store_module._connect, [0]
        def connect(path, *args, **kwargs):
            db, settings = original(path, *args, **kwargs)
            def step():
                count[0] += 1
                return 0
            db.set_progress_handler(step, 1)
            return db, settings
        with mock.patch.object(store_module, "_connect", connect):
            result = callback()
        self.assertNotIn("error", result, result)
        return result, count[0]

    def bulk(self, count, author, topic="t1"):
        with sqlite3.connect(str(self.path)) as db:
            if topic != "t1" and not db.execute("SELECT 1 FROM topics WHERE id=?", (topic,)).fetchone():
                db.row_factory = sqlite3.Row
                row = dict(db.execute("SELECT * FROM topics WHERE id='t1'").fetchone(), id=topic)
                db.execute("INSERT INTO topics(%s) VALUES (%s)" % (",".join(row), ",".join("?" * len(row))), list(row.values()))
            for index in range(count):
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                           "VALUES (?,?,?,'Bulk','[]','[]','[]',?)", ("bulk-%s-%s-%s" % (topic, author, index), topic, author, "bulk-op-%s-%s-%s" % (topic, author, index)))

    def test_finding_it_costs_the_same_however_many_messages_the_reader_has_answered(self):
        # Someone who answers every message with a reply never posts to the
        # whole topic; the line, and the reply that moves it, cost the same
        # after hundreds of answered messages as after a few.
        def answered(rounds):
            for index in range(rounds):
                self.post("owner", "Answer", reply_to=self.post("agent-a", "Question %d" % index))
            return self.post("agent-a", "Waiting")
        def page():
            return self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1})
        def reply(waiting):
            return lambda: self.command("message.post", {"body": "Answer", "reply_to": waiting}, target={"topic_id": "t1"})
        waiting = answered(3)
        short, short_page = self.measured(page)
        self.assertEqual(short["unanswered"], self.at(waiting))
        _, short_reply = self.measured(reply(waiting))
        waiting = answered(300)
        long, long_page = self.measured(page)
        self.assertEqual(long["unanswered"], self.at(waiting))
        _, long_reply = self.measured(reply(waiting))
        self.assertIsNone(self.boundary())
        print("unanswered work after answering: page %d -> %d, reply %d -> %d" % (short_page, long_page, short_reply, long_reply))
        self.assertLess(long_page, short_page + 200, (short_page, long_page))
        self.assertLess(long_reply, short_reply + 200, (short_reply, long_reply))

    def test_finding_it_skips_history_before_the_readers_last_post_and_in_other_topics(self):
        def scenario():
            # The reader replies to one message, leaves another unanswered.
            post = self.post("owner", "To everyone")
            answered = self.post("agent-a", "Answered")
            self.post("owner", "Reply", reply_to=answered)
            waiting = self.post("agent-a", "Waiting")
            self.post("agent-a", "Newest")
            return post, waiting
        _, waiting = scenario()
        short, short_work = self.measured(lambda: self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1}))
        self.assertEqual(short["unanswered"], self.at(waiting))
        # Thousands of earlier messages, by others and by the reader, all
        # before the reader's last post to the topic.
        self.bulk(3000, "agent-a")
        self.bulk(1000, "owner")
        _, waiting = scenario()
        # And thousands more since, in another topic, by others and by the reader.
        self.bulk(3000, "agent-a", topic="t2")
        self.bulk(1000, "owner", topic="t2")
        long, long_work = self.measured(lambda: self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 1}))
        self.assertEqual(long["unanswered"], self.at(waiting))
        print("unanswered work: short %d, long %d" % (short_work, long_work))
        self.assertLess(long_work, short_work + 200, (short_work, long_work))

    def test_the_query_reads_through_its_indexes(self):
        # The statement topic_messages actually ran, values filled in, as SQLite plans it.
        original, statements = store_module._connect, []
        def connect(path, *args, **kwargs):
            db, settings = original(path, *args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, settings
        with mock.patch.object(store_module, "_connect", connect):
            self.boundary()
        [query] = [sql for sql in statements if "NOT EXISTS (SELECT 1 FROM messages r" in sql]
        with sqlite3.connect(str(self.path)) as db:
            plan = " ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query))
        for index in ("topic_messages", "sqlite_autoindex_reply_horizons_1", "message_replies"):
            self.assertIn(index, plan)
        self.assertNotIn("SCAN ", plan)

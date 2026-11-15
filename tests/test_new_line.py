from __future__ import annotations

import sqlite3
from unittest import mock

from aim_next import store as store_module
from reader_fixture import ReaderCase


class NewLineCase(ReaderCase):
    """Where the red "New" line sits: just below the oldest message the reader has not read.

    Read is the state the unread counts hold: a message is unread while its
    delivery to the reader is pending in an active group, or while the reader
    has it marked unread. The reader's own messages never hold the line."""

    def post(self, actor, body, reply_to=None, **args):
        args = dict(args, body=body)
        if reply_to:
            args["reply_to"] = reply_to
        return self.committed(self.command("message.post", args, target={"topic_id": "t1"}, actor=actor))["message_id"]

    def line(self, actor="owner"):
        """The oldest unread message as topic_unread names it; every topic_messages page agrees."""
        answer = self.store.view(actor, "topic_unread", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        self.assertEqual(answer["topic_id"], "t1")
        commit = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        self.assertEqual(answer["commit_seq"], commit, "read in the same transaction as the commit it reflects")
        for args in ({"direction": "before", "limit": 30}, {"direction": "before", "limit": 1},
                     {"direction": "after", "cursor": 0, "limit": 1}, {"audience": "reader"}):
            # An agent's first read of a message records that it was handed (docs/message-edit.md), a commit of its own.
            commit = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
            page = self.store.view(actor, "topic_messages", dict({"topic_id": "t1"}, **args))
            self.assertNotIn("error", page, page)
            self.assertEqual((page["oldest_unread"], page["commit_seq"]), (answer["oldest_unread"], commit), args)
            self.assertNotIn("unanswered", page)
        return answer["oldest_unread"]

    def at(self, message_id):
        seq, sent_ms = self.sql("SELECT seq,sent_ms FROM messages WHERE id=?", (message_id,))[0]
        return {"seq": seq, "id": message_id, "sent_ms": sent_ms}

    def read(self, *message_ids, actor="owner"):
        for message_id in message_ids:
            seq = self.at(message_id)["seq"]
            self.committed(self.command("topic.read_through", {"from_seq": seq, "seq": seq}, target={"topic_id": "t1"}, actor=actor))

    def mark(self, message_id, marked, actor="owner"):
        revision = (self.sql("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?", (actor, message_id)) or [(0,)])[0][0]
        return self.committed(self.command("message.mark", {"marked": marked}, target={"message_id": message_id},
                                           expected={"mark_revision": revision}, actor=actor))

    def unread_count(self, actor="owner"):
        items = self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})["items"]
        return [item["unread"] for item in items if item["id"] == "t1"][0]

    def caught_up(self, actor="owner"):
        self.committed(self.command("topic.read_through", {"seq": 10 ** 6}, target={"topic_id": "t1"}, actor=actor))
        self.assertIsNone(self.line(actor))

    def test_the_line_says_when_its_message_was_sent(self):
        self.caught_up()
        first = self.post("agent-a", "First")
        self.post("agent-a", "Second")
        line = self.line()
        self.assertEqual(line["id"], first)
        self.assertIsInstance(line.get("sent_ms"), int, "the line says when its message was sent")
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 30})
        self.assertEqual(line["sent_ms"], next(item["sent_ms"] for item in page["items"] if item["id"] == first),
                         "the New line's time is the time its message's card shows")
        # A message marked unread holds the line with its time too.
        self.caught_up()
        self.mark(first, True)
        self.assertEqual(self.line(), self.at(first))
        self.assertIsInstance(self.line()["sent_ms"], int)
        # A message from before times were kept has none: test_migrations reads it as null.

    def test_the_line_sits_below_the_oldest_unread_message_as_reading_happens(self):
        self.caught_up()
        # Newest first: Unread 1, Unread 2, Unread 3, the line, Read 4.
        four = self.post("agent-a", "Four")
        three = self.post("agent-a", "Three")
        two = self.post("agent-a", "Two")
        one = self.post("agent-a", "One")
        self.read(four)
        self.assertEqual(self.line(), self.at(three))
        self.read(two)
        self.assertEqual(self.line(), self.at(three), "reading a newer message leaves the line below the oldest unread")
        self.read(three)
        self.assertEqual(self.line(), self.at(one), "with 2 and 3 read, the line sits below 1")
        self.assertEqual(self.unread_count(), 1, "the line and the count agree")
        self.read(one)
        self.assertIsNone(self.line(), "all read, no line")
        self.assertEqual(self.unread_count(), 0)

    def test_mark_unread_moves_the_line_down_and_reading_it_returns_the_line(self):
        self.caught_up()
        older = self.post("agent-a", "Older")
        newer = self.post("agent-a", "Newer")
        self.read(older, newer)
        self.assertIsNone(self.line())
        self.mark(older, True)
        self.assertEqual(self.line(), self.at(older), "marked unread: the line moves down to just below it")
        self.read(older)
        self.assertEqual(self.line(), self.at(older), "reading through settles deliveries; only opening it clears a mark")
        self.mark(older, False)
        self.assertIsNone(self.line(), "marked read again (or opened to read), the line returns")
        # A mark below a pending delivery holds the line at the older of the two.
        self.mark(older, True)
        newest = self.post("agent-a", "Newest")
        self.assertEqual(self.line(), self.at(older))
        self.mark(older, False)
        self.assertEqual(self.line(), self.at(newest))

    def test_a_message_arriving_while_caught_up_brings_the_line_just_below_it(self):
        self.caught_up()
        self.caught_up("agent-a")
        arrived = self.post("agent-a", "Arrived")
        self.assertEqual(self.line(), self.at(arrived))
        self.assertIsNone(self.line("agent-a"), "nor does it hold the line for its author")

    def test_an_ask_that_was_read_moves_past_the_line_and_still_waits(self):
        self.caught_up()
        ask = self.post("agent-a", "Will you look?", addressees=["owner"], intent="ask")
        self.assertEqual(self.line(), self.at(ask), "a message sent by name is unread until read")
        self.read(ask)
        self.assertIsNone(self.line(), "read, the ask moves past the line")
        attention = self.store.view("owner", "attention", {})
        self.assertEqual(attention["waiting_on_me"], 1, "Waiting on you still shows until it is answered")
        self.assertEqual(attention["latest_waiting"][0]["ask"]["message_id"], ask)

    def test_the_readers_own_messages_never_hold_the_line(self):
        self.caught_up()
        own = self.post("owner", "Mine")
        self.assertIsNone(self.line())
        self.mark(own, True)
        self.assertIsNone(self.line(), "not even marked unread")
        other = self.post("agent-a", "Theirs")
        self.assertEqual(self.line(), self.at(other))

    def test_a_reply_reads_the_message_it_answers_and_no_other(self):
        self.caught_up()
        first = self.post("agent-a", "First")
        second = self.post("agent-a", "Second")
        named = self.post("agent-a", "To you", addressees=["owner"], intent="tell")
        # A reply prepared in the Reader (a draft whose source is the newest message) reads it.
        self.send("Answered from the Reader")
        self.assertEqual(self.line(), self.at(first))
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id='owner'", (named,)), [("acknowledged",)])
        self.post("owner", "To the first", reply_to=first)
        self.assertEqual(self.line(), self.at(second), "a reply reads what it answers, not what is newer")
        self.post("owner", "To the second", reply_to=second)
        self.assertIsNone(self.line())
        # Someone else's reply reads nothing for this reader.
        later = self.post("agent-a", "Later")
        self.post("agent-b", "agent-b answers", reply_to=later)
        self.assertEqual(self.line(), self.at(later))

    def test_a_reply_to_a_read_message_settles_nothing_else(self):
        self.caught_up()
        read = self.post("agent-a", "Already read")
        self.read(read)
        before = self.sql("SELECT count(*) FROM changes")[0][0]
        self.post("owner", "Late answer", reply_to=read)
        kinds = [row[0] for row in self.sql("SELECT resource_kind FROM changes WHERE seq>? AND scope_id='owner'", (before,))]
        self.assertNotIn("delivery", kinds, "nothing pending, nothing settled")

    def test_messages_left_pending_by_leaving_the_topic_do_not_hold_the_line(self):
        # agent-a is on the outcome's team, so it can still read the topic after leaving it.
        self.post("owner", "While agent-a is here")
        self.assertIsNotNone(self.line("agent-a"))
        self.participation("agent-a", False)
        self.assertIsNone(self.line("agent-a"), "a cancelled subscription's pending rows are not unread, as the counts say")
        self.participation("agent-a", True)
        arrived = self.post("owner", "After rejoining")
        self.assertEqual(self.line("agent-a"), self.at(arrived))

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

    def bulk(self, count, topic, state, addressed=False, cancelled=False):
        """count messages by agent-a in topic, each delivered to the owner in state.

        cancelled: by a subscription the owner left, whose group is inactive and
        whose pending rows stay pending for good."""
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            if not db.execute("SELECT 1 FROM topics WHERE id=?", (topic,)).fetchone():
                row = dict(db.execute("SELECT * FROM topics WHERE id='t1'").fetchone(), id=topic)
                db.execute("INSERT INTO topics(%s) VALUES (%s)" % (",".join(row), ",".join("?" * len(row))), list(row.values()))
            key = ("owner", "direct", "", 0) if addressed else ("owner", "subscription", topic, 0 if cancelled else 1)
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch,active) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
                       key + (0 if cancelled else 1,))
            group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? AND participant_epoch=?", key).fetchone()[0]
            for index in range(count):
                message = "bulk-%s-%s-%s-%s-%d" % (topic, state, addressed, cancelled, index)
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                                 "VALUES (?,?,'agent-a','Bulk','[]','[]',?,?)", (message, topic, '["owner"]' if addressed else "[]", "op-" + message)).lastrowid
                if addressed:
                    db.execute("INSERT INTO message_addressees VALUES (?,?,?)", (topic, "owner", seq))
                db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,state,topic_id) VALUES (?,?,?,?,?,?)",
                           ("d-" + message, message, "owner", group, state, topic))
            if state == "pending":
                db.execute("UPDATE delivery_groups SET pending_count=pending_count+?,first_pending_seq=coalesce(first_pending_seq,"
                           "(SELECT min(seq) FROM deliveries WHERE group_id=? AND state='pending')) WHERE id=?", (count, group, group))

    def test_finding_it_costs_the_same_whatever_the_history(self):
        self.caught_up()
        waiting = self.post("agent-a", "Waiting")
        view = lambda: self.store.view("owner", "topic_unread", {"topic_id": "t1"})
        short, short_work = self.measured(view)
        self.assertEqual(short["oldest_unread"], self.at(waiting))
        self.read(waiting)
        # Thousands of messages read in this topic, by subscription and by name;
        # and thousands still pending in another topic, by subscription and by name.
        self.bulk(3000, "t1", "acknowledged")
        self.bulk(2000, "t1", "acknowledged", addressed=True)
        self.bulk(3000, "t2", "pending")
        self.bulk(2000, "t2", "pending", addressed=True)
        waiting = self.post("agent-a", "Waiting after the history")
        long, long_work = self.measured(view)
        self.assertEqual(long["oldest_unread"], self.at(waiting))
        print("oldest unread work: short %d, long %d" % (short_work, long_work))
        self.assertLess(long_work, short_work + 200, (short_work, long_work))

    def test_rows_a_left_subscription_left_pending_cost_nothing(self):
        # Leaving a topic cancels the subscription's group and leaves its pending
        # rows pending for good; the line passes over none of them, one by one.
        self.caught_up()
        waiting = self.post("agent-a", "Waiting")
        view = lambda: self.store.view("owner", "topic_unread", {"topic_id": "t1"})
        short, short_work = self.measured(view)
        self.assertEqual(short["oldest_unread"], self.at(waiting))
        self.read(waiting)
        # 5,000 rows a cancelled subscription left pending in this topic, older
        # than what now waits, by subscription and by name.
        self.bulk(5000, "t1", "pending", cancelled=True)
        waiting = self.post("agent-a", "Waiting after the stale rows")
        named = self.post("agent-a", "Named after the stale rows", addressees=["owner"], intent="tell")
        long, long_work = self.measured(view)
        self.assertEqual(long["oldest_unread"], self.at(waiting))
        self.read(waiting)
        self.assertEqual(self.line(), self.at(named), "the one direct group is probed too")
        print("oldest unread work with stale rows: short %d, long %d" % (short_work, long_work))
        self.assertLess(long_work, short_work + 200, (short_work, long_work))

    def test_the_queries_read_through_their_indexes(self):
        # The statements topic_unread actually ran, values filled in, as SQLite plans them.
        self.post("agent-a", "Waiting")
        self.post("agent-a", "Named", addressees=["owner"], intent="tell")
        original, statements = store_module._connect, []
        def connect(path, *args, **kwargs):
            db, settings = original(path, *args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, settings
        with mock.patch.object(store_module, "_connect", connect):
            self.line()
        # The first view's statements: the subscription group, the direct group, a probe of each, the marks.
        first = statements[:next(index for index, sql in enumerate(statements) if "FROM message_marks k INDEXED BY reader_marks" in sql) + 1]
        groups = [sql for sql in first if "FROM topic_participants p CROSS JOIN delivery_groups g" in sql]
        deliveries = [sql for sql in first if "pending_group_topic_deliveries" in sql]
        marks = [sql for sql in first if "FROM message_marks k INDEXED BY reader_marks" in sql]
        self.assertEqual((len(groups), len(deliveries), len(marks)), (1, 2, 1), first)
        with sqlite3.connect(str(self.path)) as db:
            for query, indexes in ((groups[0], ("SEARCH p USING", "sqlite_autoindex_delivery_groups_1")),
                                   (deliveries[0], ("pending_group_topic_deliveries", "sqlite_autoindex_messages_1")),
                                   (deliveries[1], ("pending_group_topic_deliveries", "sqlite_autoindex_messages_1")),
                                   (marks[0], ("reader_marks", "sqlite_autoindex_messages_1"))):
                plan = " ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query))
                print("plan:", plan)
                for index in indexes:
                    self.assertIn(index, plan)
                self.assertNotIn("SCAN ", plan)
                self.assertNotIn("TEMP B-TREE", plan)

    def test_every_new_delivery_names_its_topic(self):
        # The line is found by each delivery's topic: a row without one would
        # never hold it, so the store refuses it at insert, whatever writes it.
        self.post("agent-a", "Waiting")
        message, group = self.sql("SELECT message_id,group_id FROM deliveries WHERE recipient_id='owner' LIMIT 1")[0]
        with self.assertRaisesRegex(sqlite3.IntegrityError, "a delivery names its topic"):
            self.sql("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES ('d-headless',?,'agent-b',?)", (message, group))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL"), [(0,)])

    def test_it_needs_the_topic(self):
        answer = self.store.view("outsider", "topic_unread", {"topic_id": "t1"})
        self.assertEqual(answer["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.store.view("owner", "topic_unread", {"topic_id": "t1", "extra": 1})["error"]["code"], "INVALID_ARGUMENT")

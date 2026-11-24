from __future__ import annotations

import sqlite3
from unittest import mock

from aim_next import store as store_module
from reader_fixture import ReaderCase
from tests.historical_fixture import post_fields


class NewLineCase(ReaderCase):
    """Where the red "New" line sits: just below the oldest message the reader has not read.

    Read is the state the unread counts hold: a message is unread while its
    delivery to the reader is pending in an active group, or while the reader
    has it marked unread. The reader's own messages never hold the line."""

    def post(self, actor, body, reply_to=None, **args):
        args = dict(args, body=body)
        if reply_to:
            args["reply_to"] = reply_to
        return self.committed(self.command("message.post", post_fields(self, actor, args), target={"topic_id": "t1"}, actor=actor))["message_id"]

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
        # The first view's statements: the reader's unread groups, the subscription and the direct one, by the counts'
        # own rule (topic_reading.SUBSCRIBED, ADDRESSED; item 613), a probe of each, the marks.
        first = statements[:next(index for index, sql in enumerate(statements) if "FROM message_marks k INDEXED BY reader_marks" in sql) + 1]
        groups = [sql for sql in first if "FROM delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 WHERE" in sql]
        deliveries = [sql for sql in first if "pending_group_topic_deliveries" in sql]
        marks = [sql for sql in first if "FROM message_marks k INDEXED BY reader_marks" in sql]
        self.assertEqual((len(groups), len(deliveries), len(marks)), (1, 2, 1), first)
        with sqlite3.connect(str(self.path)) as db:
            for query, indexes in ((groups[0], ("sqlite_autoindex_delivery_groups_1",)),
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


class CountLeadsThereCase(ReaderCase):
    """Item 613: a topic's unread count leads to the oldest message still unread for the reader, and counts nothing
    that press cannot reach (docs/attention.md, "In the browser").

    The page counts what `workspace_topics` counts for the topic, and a press on that count opens the topic at
    `oldest_unread`, read in page by page however far back it is (web/app.mjs, landOnUnread). So the two must be one
    rule: while the count is above nought, `oldest_unread` names a message the reader's own pages of the topic
    reach; at nought it names none. Each shape below is checked by that one property, the deep dossier of the live
    defect (a pending delivery 19 replies deep, 118 messages up) and the negatives: nothing unread, another reader's
    pending delivery, a whisper not to the reader and a topic the reader left."""

    post, line, at, read, unread_count, caught_up = (NewLineCase.post, NewLineCase.line, NewLineCase.at, NewLineCase.read,
                                                    NewLineCase.unread_count, NewLineCase.caught_up)

    def leads_there(self, actor="owner"):
        """The topic's count for actor and the message its press leads to, after asserting they agree."""
        count, oldest = self.unread_count(actor), self.line(actor)
        self.assertEqual(count > 0, oldest is not None, "a count leads somewhere, and nothing unread leads nowhere: %s %s" % (count, oldest))
        if oldest is not None:
            cursor, pages = None, 0
            while True:
                page = self.store.view(actor, "topic_messages", dict({"topic_id": "t1", "audience": "all", "direction": "before", "limit": 30},
                                                                     **({"cursor": cursor} if cursor is not None else {})))
                pages += 1
                if any(item["id"] == oldest["id"] for item in page["items"]):
                    break
                cursor = page["next_cursor"]
                self.assertIsNotNone(cursor, "the reader's own pages of the topic reach the message its count leads to")
            oldest = dict(oldest, pages=pages)
        return count, oldest

    def test_a_pending_delivery_deep_in_a_dossier_far_up_the_topic_is_counted_and_led_to_until_it_is_read(self):
        self.caught_up()
        self.post("agent-b", "The seed trays went out this morning.", addressees=["agent-a"], intent="tell")
        root = previous = self.post("agent-a", "A plan for the spring beds", addressees=["owner"], intent="tell")
        for depth in range(1, 19):
            author = "owner" if depth % 2 else "agent-a"
            previous = self.post(author, "Bed %d: more compost" % depth, reply_to=previous,
                                 **({} if author == "owner" else {"addressees": ["owner"], "intent": "tell"}))
            # Other talk between agents lands between the dossier's replies, as it does in a busy topic.
            self.post("agent-b", "Watering rota note %d" % depth, addressees=["agent-a"], intent="tell")
        target = self.post("agent-a", "The 9:58 note: the tomatoes go in the south bed.", reply_to=previous, addressees=["owner"], intent="tell")
        newer = previous = target
        for n in range(118):
            if n % 2:
                newer = self.post("agent-b", "Rota line %d" % n, addressees=["agent-a"], intent="tell")
            else:
                # The reader's own replies answer the agent's, never the note itself, which a reply would settle.
                author = "owner" if n % 4 == 2 else "agent-a"
                previous = self.post(author, "Later reply %d" % n, reply_to=previous,
                                     **({} if author == "owner" else {"addressees": ["owner"], "intent": "tell"}))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE topic_id='t1' AND seq>(SELECT seq FROM messages WHERE id=?)", (target,)), [(118,)])
        # Everything else is read; the 9:58 note alone waits for the reader.
        seq = self.at(target)["seq"]
        self.committed(self.command("topic.read_through", {"from_seq": 0, "seq": seq - 1}, target={"topic_id": "t1"}))
        self.committed(self.command("topic.read_through", {"from_seq": seq + 1, "seq": 10 ** 6}, target={"topic_id": "t1"}))
        positions = self.store.view("owner", "stack_positions", {"topic_id": "t1", "message_ids": [target]})["items"]
        self.assertEqual(positions[0]["stack_position"]["root_id"], root, "the note is in the dossier the plan began, 19 replies down")
        count, oldest = self.leads_there()
        self.assertEqual((count, oldest["id"]), (1, target))
        self.assertGreaterEqual(oldest["pages"], 4, "it is further up the topic than the first three pages of thirty reach")
        self.read(target)
        self.assertEqual(self.leads_there(), (0, None), "read, nothing is counted and the count leads nowhere")

    def test_what_the_reader_cannot_reach_or_is_not_theirs_is_never_counted(self):
        self.caught_up()
        self.assertEqual(self.leads_there(), (0, None), "nothing unread shows no count")
        # Another reader's pending delivery is theirs: a message by name to them is between others for this reader.
        self.participation("other-reader", True)
        theirs = self.post("agent-a", "Your seedlings are ready", addressees=["other-reader"], intent="tell")
        self.assertEqual(self.leads_there(), (0, None), "another reader's pending delivery is not counted for this one")
        self.assertEqual(self.store.view("other-reader", "topic_unread", {"topic_id": "t1"})["oldest_unread"]["id"], theirs)
        # A whisper not to the reader: they cannot see it, so it is never theirs to count.
        self.committed(self.command("message.post", {"body": "Between us: the shed key", "addressees": ["agent-a"], "whisper": True},
                                    target={"topic_id": "t1"}, actor="other-reader"))
        self.assertEqual(self.leads_there(), (0, None), "a whisper between others is not counted")
        # A topic the reader left: what waited for them by subscription is no longer counted, and nothing leads there.
        self.post("agent-a", "To the whole topic: frost tonight")
        self.assertEqual(self.leads_there()[0], 1, "a message to the whole topic waits for its participant")
        self.participation("owner", False)
        self.assertEqual(self.leads_there(), (0, None), "having left, what waited by subscription is not counted")
        # A message sent to them by name since still reaches them, in a topic they can still read: counted, and led to.
        named = self.post("agent-a", "Owner, the frost cloth is in the shed", addressees=["owner"], intent="tell")
        count, oldest = self.leads_there()
        self.assertEqual((count, oldest["id"]), (1, named))

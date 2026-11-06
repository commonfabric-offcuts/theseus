from __future__ import annotations

"""An outcome's topics are listed latest activity first, the done ones apart (docs/topic-list.md)."""

import unittest
from unittest import mock

from aim_next import store as store_module

import reader_fixture as fixtures


class TopicOrderCase(fixtures.ReaderCase):
    # w1 is owner's outcome; t1 (created in setUp) has agent-a taking part.

    def setUp(self):
        self.now = 1000
        # Messages and states take their time from one clock the case moves.
        for name in ("aim_next.conversation._now_ms", "aim_next.topic_state._now_ms"):
            patch = mock.patch(name, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        super().setUp()

    def open_topic(self, topic, title):
        self.now += 10
        source = {"kind": "new_topic", "id": "opening-" + topic, "workspace_id": "w1"}
        self.committed(self.save_draft("draft-" + topic, source, topic, "Opening " + topic,
                                       opening={"workspace_id": "w1", "title": title, "participants": ["agent-a"]}))
        self.committed(self.prepare("draft-" + topic, topic, submission="submission-" + topic, send_op="open-" + topic))
        self.committed(self.command("topic.create_and_send", {"submission_id": "submission-" + topic},
                                    target={"topic_id": topic}, op="open-" + topic))

    def post(self, topic, body="More", actor="owner"):
        self.now += 10
        return self.committed(self.command("message.post", {"body": body}, target={"topic_id": topic}, actor=actor))

    def update(self, topic, args, actor="owner"):
        self.now += 10
        version = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        return self.committed(self.command("topic.update", args, target={"topic_id": topic},
                                           expected={"topic_revision": version}, actor=actor))

    def page(self, actor="owner", **args):
        answer = self.store.view(actor, "workspace_topics", dict({"workspace_id": "w1"}, **args))
        self.assertNotIn("error", answer, answer)
        return answer

    def order(self, **args):
        return [item["id"] for item in self.page(**args)["items"]]

    def walk(self, limit, **args):
        """Every page of a list, limit rows at a time: the ids in order, and the cursors."""
        ids, cursors, cursor = [], [], None
        while True:
            answer = self.page(limit=limit, **(dict(args, cursor=cursor) if cursor else args))
            ids += [item["id"] for item in answer["items"]]
            cursor = answer["next_cursor"]
            if cursor is None:
                return ids, cursors
            cursors.append(cursor)

    def test_topics_are_listed_latest_activity_first_and_a_new_message_brings_one_to_the_top(self):
        self.open_topic("t2", "Second")
        self.open_topic("t3", "Third")
        self.assertEqual(self.order(), ["t3", "t2", "t1"])
        self.post("t1")
        self.assertEqual(self.order(), ["t1", "t3", "t2"])
        items = self.page()["items"]
        self.assertEqual([item["activity_ms"] for item in items], [self.now, self.now - 10, self.now - 20])

    def test_saying_where_a_topic_stands_is_activity_and_renaming_or_archiving_is_not(self):
        self.open_topic("t2", "Second")
        self.assertEqual(self.order(), ["t2", "t1"])
        self.update("t1", {"state": "review", "note": "Look"}, actor="agent-a")
        self.assertEqual(self.order(), ["t1", "t2"])
        self.assertEqual(self.page()["items"][0]["activity_ms"], self.now)
        self.update("t2", {"title": "Renamed"})
        self.update("t2", {"archived": True})
        self.update("t2", {"archived": False})
        self.assertEqual(self.order(), ["t1", "t2"])

    def test_activity_never_goes_back_when_a_later_act_reads_an_earlier_clock(self):
        self.post("t1")
        high = self.now
        for act in (lambda: self.update("t1", {"state": "review"}), lambda: self.post("t1")):
            self.now = high - 500
            act()
            self.assertEqual(self.page()["items"][0]["activity_ms"], high)

    def test_done_topics_are_listed_apart_and_counted_and_archived_ones_are_listed_alone(self):
        for topic in ("t2", "t3", "t4"):
            self.open_topic(topic, topic)
        self.update("t2", {"state": "done"})
        self.update("t3", {"state": "done"})
        self.update("t4", {"archived": True})
        answer = self.page()
        self.assertEqual([item["id"] for item in answer["items"]], ["t1"])
        self.assertEqual(answer["groups"], {"done": 2, "archived": 1})
        self.assertEqual(self.order(done=True), ["t3", "t2"])
        self.assertEqual(self.page(done=True)["groups"], {"done": 2, "archived": 1})
        # An archived topic leaves the done list too; the archived list holds the
        # rest first, then the done ones, each latest first.
        self.update("t2", {"archived": True})
        self.post("t4")
        self.assertEqual(self.order(done=True), ["t3"])
        self.assertEqual(self.order(archived=True), ["t4", "t2"])
        self.assertEqual(self.page()["groups"], {"done": 1, "archived": 2})

    def test_paging_walks_each_list_in_order_and_across_the_done_ones_of_the_archived_list(self):
        for topic in ("t2", "t3", "t4", "t5"):
            self.open_topic(topic, topic)
        self.update("t2", {"state": "done"})
        self.update("t4", {"state": "done"})
        whole = self.order()
        self.assertEqual(whole, ["t5", "t3", "t1"])
        self.assertEqual(self.walk(1)[0], whole)
        self.assertEqual(self.walk(2)[0], whole)
        for topic in ("t1", "t2", "t3", "t4", "t5"):
            self.update(topic, {"archived": True})
        archived, cursors = self.walk(1, archived=True)
        self.assertEqual(archived, ["t5", "t3", "t1", "t4", "t2"])
        self.assertEqual(cursors[2].split(":")[0], "0")
        self.assertEqual(cursors[3].split(":")[0], "1", "the cursor says the walk is among the done ones")
        self.assertEqual(self.walk(2, archived=True)[0], archived)
        self.assertEqual(self.walk(100, archived=True)[0], archived)

    def test_topics_with_the_same_activity_time_keep_one_order_across_pages(self):
        for topic in ("t2", "t3"):
            self.open_topic(topic, topic)
        self.now += 10
        for topic in ("t1", "t2", "t3"):
            self.committed(self.command("message.post", {"body": "Same moment"}, target={"topic_id": topic}))
        self.assertEqual(self.order(), ["t3", "t2", "t1"])
        self.assertEqual(self.walk(1)[0], ["t3", "t2", "t1"])

    def test_a_cursor_that_is_not_one_the_list_gave_and_done_with_archived_are_refused(self):
        for cursor in ("t1", " ", "2:1:t1", "0:-1:t1", "0:01:t1", "0:1:", "0:x:t1", 7, "0:1:t\x01"):
            with self.subTest(cursor=cursor):
                answer = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "cursor": cursor})
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)
        for args in ({"archived": True, "done": True}, {"done": 1}, {"done": None}):
            with self.subTest(args=args):
                answer = self.store.view("owner", "workspace_topics", dict({"workspace_id": "w1"}, **args))
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)
        self.assertEqual(self.store.view("outsider", "workspace_topics", {"workspace_id": "w1", "done": True})["error"]["code"], "FORBIDDEN")
        # An empty cursor is the start, as for the other lists.
        self.assertEqual(self.order(cursor=""), self.order())

    def test_each_list_reads_its_page_and_counts_from_the_activity_index_without_sorting(self):
        statements = []
        real = store_module._connect

        def connect(*args, **kwargs):
            db, runtime = real(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, runtime

        with mock.patch("aim_next.store._connect", connect):
            for args in ({}, {"done": True}, {"archived": True}, {"archived": True, "cursor": "0:1:t1"}):
                self.page(**args)
        listing = [statement for statement in statements if "FROM topics" in statement and "workspace_id=" in statement]
        self.assertGreaterEqual(len(listing), 9, statements)
        db, _ = real(self.path)
        try:
            for statement in listing:
                plan = [row[-1] for row in db.execute("EXPLAIN QUERY PLAN " + statement)]
                self.assertTrue(any("workspace_topic_order" in line for line in plan), (statement, plan))
                self.assertFalse(any("TEMP B-TREE" in line or line.startswith("SCAN") for line in plan), (statement, plan))
        finally:
            db.close()

class ReopenCase(TopicOrderCase):
    """A new message in a done topic brings it back among the active ones."""

    def test_a_message_in_a_done_topic_makes_it_active_again_in_the_same_act_and_says_who_and_why(self):
        self.open_topic("t2", "Second")
        self.update("t1", {"state": "done", "note": "Shipped"}, actor="agent-a")
        self.assertEqual(self.order(), ["t2"])
        before = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        result = self.post("t1", "One more thing", actor="agent-a")
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        sent = self.sql("SELECT sent_ms FROM messages WHERE id=?", (result["message_id"],))[0][0]
        self.assertEqual((topic["state"], topic["state_by"], topic["state_ms"], topic["state_note"], topic["state_message_id"]),
                         ("active", "agent-a", sent, "Reopened by a new message", result["message_id"]))
        # One act: the send's own topic version carries the state.
        self.assertEqual((result["topic"]["version"], topic["version"]), (before + 1, before + 1))
        self.assertEqual(self.order(), ["t1", "t2"])
        self.assertEqual(self.order(done=True), [])
        self.assertEqual(self.page()["groups"]["done"], 0)
        # Saying where it stands again replaces the reason.
        self.update("t1", {"state": "review"}, actor="agent-a")
        self.assertIsNone(self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["state_message_id"])

    def test_the_next_word_on_where_a_reopened_topic_stands_replaces_the_whole_reopen_record(self):
        for args in ({"state": "active"}, {"waiting_on": []}, {"state": "waiting", "waiting_on": ["agent-a"]}):
            self.update("t1", {"state": "done", "note": "Shipped"}, actor="agent-a")
            self.post("t1", "One more thing", actor="agent-a")
            self.update("t1", args)
            topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
            self.assertEqual((topic["state_note"], topic["state_by"], topic["state_message_id"]), ("", "owner", None), args)
        # A note someone said stays while the state does, as before.
        self.update("t1", {"state": "review", "note": "Look"}, actor="agent-a")
        self.update("t1", {"waiting_on": []})
        self.assertEqual(self.sql("SELECT state,state_note,state_by FROM topics WHERE id='t1'"), [("review", "Look", "owner")])

    def test_a_message_reopens_only_a_done_topic_and_a_refused_post_reopens_nothing(self):
        self.update("t1", {"state": "waiting", "note": "Which name?", "waiting_on": ["owner"]}, actor="agent-a")
        self.post("t1", "A thought", actor="agent-b")
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual((topic["state"], topic["state_note"], topic["state_by"], topic["state_message_id"]),
                         ("waiting", "Which name?", "agent-a", None))
        self.update("t1", {"state": "done"}, actor="agent-a")
        refused = self.command("message.post", {"body": "Reply", "reply_to": "m-not-here"}, target={"topic_id": "t1"})
        self.rejected(refused, "INVALID_REPLY")
        self.assertEqual(self.sql("SELECT state,state_message_id FROM topics WHERE id='t1'"), [("done", None)])
        self.assertEqual(self.order(done=True), ["t1"])

    def test_a_prepared_send_reopens_a_done_topic_as_a_post_does(self):
        self.update("t1", {"state": "done"}, actor="agent-a")
        sent = self.send("Picked back up")
        self.assertEqual(self.sql("SELECT state,state_by,state_message_id FROM topics WHERE id='t1'"), [("active", "owner", sent["id"])])


# The reopen cases share the clock and helpers, not the listing cases.
for _name in list(vars(TopicOrderCase)):
    if _name.startswith("test_"):
        setattr(ReopenCase, _name, None)


if __name__ == "__main__":
    unittest.main()

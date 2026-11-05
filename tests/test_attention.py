from __future__ import annotations

"""Unread and addressed counts: what waits for a reader, by topic, by outcome, and in total."""

import sqlite3
import unittest
from unittest import mock

from aim_next import store as store_module

from test_agent_loop import AgentLoopCase


class AttentionCase(AgentLoopCase):
    def counts(self, actor="owner"):
        topics = self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})
        outcomes = self.store.view(actor, "workspaces", {})
        attention = self.store.view(actor, "attention", {})
        for answer in (topics, outcomes, attention):
            self.assertNotIn("error", answer, answer)
        return ({item["id"]: (item["unread"], item["addressed"]) for item in topics["items"]},
                {item["id"]: (item["unread"], item["addressed"]) for item in outcomes["items"]},
                (attention["unread"], attention["addressed"]), attention["latest_addressed"])

    def through(self, seq, actor="owner", topic="t1"):
        return self.command("topic.read_through", {"seq": seq}, target={"topic_id": topic}, actor=actor)

    def seq(self, message_id):
        return self.sql("SELECT seq FROM messages WHERE id=?", (message_id,))[0][0]

    def test_counts_follow_pending_deliveries_by_topic_outcome_and_total(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Second",
                                                     "participants": ["agent-a"], "body": "Second opening", "attachments": []},
                                    target={"opening_id": "o2"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}))
        topics, outcomes, total, latest = self.counts()
        start, t1, t2 = total, topics.get("t1", (0, 0)), topics.get("t2", (0, 0))
        first = self.committed(self.post(body="One"))["message_id"]
        self.committed(self.post(body="Two"))
        direct = self.committed(self.post(body="For you by name", addressees=["owner"]))["message_id"]
        self.committed(self.post(body="For agent-b by name", addressees=["agent-b"]))
        self.committed(self.post(topic="t2", body="Elsewhere", addressees=["owner"]))
        topics, outcomes, total, latest = self.counts()
        self.assertEqual(topics["t1"], (t1[0] + 4, t1[1] + 1))
        self.assertEqual(topics["t2"], (t2[0] + 1, t2[1] + 1))
        self.assertEqual(outcomes["w1"], (topics["t1"][0] + topics["t2"][0], 2))
        self.assertEqual(total, (start[0] + 5, start[1] + 2))
        # Newest first, each naming its place, author and words.
        self.assertEqual([(item["message"]["body"], item["topic"]["id"], item["message"]["author_id"]) for item in latest],
                         [("Elsewhere", "t2", "agent-a"), ("For you by name", "t1", "agent-a")])
        self.assertTrue(all("addressed" in item["reasons"] for item in latest))
        # The author's own words wait for nobody's attention on their side.
        self.assertEqual(self.counts("agent-a")[0].get("t1", (0, 0))[1], 0)
        # Reading through the first message settles it and only it.
        self.committed(self.through(self.seq(first), actor="owner"))
        after = self.counts()
        self.assertEqual(after[0]["t1"][1], 1)
        self.assertLess(after[0]["t1"][0], topics["t1"][0])
        # Reading through the addressed one clears it from the addressed counts and the latest list.
        self.committed(self.through(self.seq(direct), actor="owner"))
        after = self.counts()
        self.assertEqual(after[0]["t1"][1], 0)
        self.assertEqual(after[2][1], 1)
        self.assertEqual([item["message"]["body"] for item in after[3]], ["Elsewhere"])

    def test_leaving_a_topic_drops_its_unread_count(self):
        # A topic participant outside the outcome sees only the totals.
        self.participation("other-reader", True)
        self.committed(self.post(body="Waiting"))
        self.assertEqual(self.store.view("other-reader", "attention", {})["unread"], 1)
        self.participation("other-reader", False)
        self.assertEqual(self.store.view("other-reader", "attention", {})["unread"], 0)

    def test_latest_addressed_is_bounded_to_five(self):
        for n in range(7):
            self.committed(self.post(body="Named %d" % n, addressees=["owner"]))
        latest = self.counts()[3]
        self.assertEqual([item["message"]["body"] for item in latest], ["Named %d" % n for n in range(6, 1, -1)])

    def test_a_message_sent_by_name_to_someone_who_then_lost_the_topic_is_cleared_by_acknowledging_it(self):
        # other-reader works in t1 without belonging to its outcome; once they
        # leave, they still read the message sent to them by name, but cannot
        # open the topic to read through it.
        self.participation("other-reader", True)
        self.committed(self.post(body="Before you left", addressees=["other-reader"]))
        self.committed(self.post(body="For the owner", addressees=["owner"]))
        self.assertEqual(self.store.view("other-reader", "attention", {})["latest_addressed"][0]["topic_readable"], True)
        self.participation("other-reader", False)
        answer = self.store.view("other-reader", "attention", {})
        self.assertEqual((answer["unread"], answer["addressed"]), (1, 1))
        [item] = answer["latest_addressed"]
        self.assertEqual((item["message"]["body"], item["topic_readable"]), ("Before you left", False))
        self.assertEqual(self.counts()[3][0]["topic_readable"], True)
        self.rejected(self.through(self.seq(item["message_id"]), actor="other-reader"), "FORBIDDEN")
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": item["id"]}, actor="other-reader"))
        answer = self.store.view("other-reader", "attention", {})
        self.assertEqual((answer["unread"], answer["addressed"], answer["latest_addressed"]), (0, 0, []))

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

    def test_a_list_page_counts_its_own_topics_without_walking_the_readers_other_unread_topics(self):
        self.committed(self.post(body="On the page"))
        page = lambda: self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "limit": 1})
        outcomes = lambda: self.store.view("owner", "workspaces", {"limit": 1})
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO workspaces VALUES ('w-elsewhere','owner','Elsewhere','',NULL,0)")
            db.execute("INSERT INTO workspace_members VALUES ('w-elsewhere','owner')")
            db.executemany("INSERT INTO topics(id,workspace_id,title,creator_id,version) VALUES (?,'w-elsewhere','Bulk','owner',0)",
                           [("zz-%04d" % n,) for n in range(2000)])
        _, topics_before = self.measured(page)
        _, outcomes_before = self.measured(outcomes)
        # Now each of those topics has unread work for the reader.
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch,pending_count,first_pending_seq) "
                           "VALUES ('owner','subscription',?,1,1,1)", [("zz-%04d" % n,) for n in range(2000)])
        topics, topics_after = self.measured(page)
        listed, outcomes_after = self.measured(outcomes)
        self.assertEqual([item["id"] for item in topics["items"]], ["t1"])
        self.assertEqual([item["id"] for item in listed["items"]], ["w-elsewhere"])
        self.assertEqual(listed["items"][0]["unread"], 2000)
        self.assertLess(topics_after, topics_before + 500)
        # The outcome page still walks the reader's pending groups, but only those in its outcomes count.
        self.assertGreater(outcomes_after, outcomes_before)

    def archive(self, archived, topic="t1"):
        version = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        self.committed(self.command("topic.update", {"archived": archived}, target={"topic_id": topic},
                                    expected={"topic_revision": version}))

    def test_an_archived_topic_counts_only_on_its_own_row_in_the_archived_list(self):
        self.committed(self.post(body="Plain"))
        self.committed(self.post(body="By name", addressees=["owner"]))
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]}, target={"topic_id": "t1"},
                                    expected={"topic_revision": version}, actor="agent-a"))
        topics, outcomes, total, latest = self.counts()
        listed = topics["t1"]
        self.assertEqual(outcomes["w1"], listed)
        self.assertEqual(total, listed)
        self.assertEqual([item["topic"]["id"] for item in latest], ["t1"])
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1)
        self.archive(True)
        topics, outcomes, total, latest = self.counts()
        # Nothing the reader cannot find in a list counts toward the outcome or the total.
        self.assertNotIn("t1", topics)
        self.assertEqual((outcomes["w1"], total, latest), ((0, 0), (0, 0), []))
        attention = self.store.view("owner", "attention", {})
        self.assertEqual((attention["waiting_on_me"], attention["latest_waiting"]), (0, []))
        # The archived list still shows the topic's own count, and nothing was settled.
        archived = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "archived": True})["items"]
        self.assertEqual([(item["id"], item["unread"], item["addressed"], item["waiting_on"]) for item in archived],
                         [("t1", listed[0], listed[1], ["owner"])])
        self.archive(False)
        topics, outcomes, total, latest = self.counts()
        self.assertEqual((topics["t1"], outcomes["w1"], total), (listed, listed, listed))
        self.assertEqual([item["topic"]["id"] for item in latest], ["t1"])
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 1)

    def test_archiving_keeps_a_message_sent_by_name_for_someone_who_lost_the_topic(self):
        # No list holds the topic for someone who lost it, so attention is where
        # they read and settle what was sent to them by name, archived or not. A
        # reader who can still open the topic finds it in the archived list instead.
        self.participation("other-reader", True)
        self.committed(self.post(body="Before you left", addressees=["other-reader"]))
        self.committed(self.post(body="For the owner", addressees=["owner"]))
        self.participation("other-reader", False)
        self.archive(True)
        answer = self.store.view("other-reader", "attention", {})
        self.assertEqual((answer["unread"], answer["addressed"]), (1, 1))
        [item] = answer["latest_addressed"]
        self.assertEqual((item["message"]["body"], item["topic_readable"]), ("Before you left", False))
        owner = self.store.view("owner", "attention", {})
        self.assertEqual((owner["unread"], owner["addressed"], owner["latest_addressed"]), (0, 0, []))
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": item["id"]}, actor="other-reader"))
        answer = self.store.view("other-reader", "attention", {})
        self.assertEqual((answer["unread"], answer["addressed"], answer["latest_addressed"]), (0, 0, []))

    def test_a_topic_set_waiting_while_archived_waits_without_counting(self):
        self.archive(True)
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]}, target={"topic_id": "t1"},
                                    expected={"topic_revision": version}, actor="agent-a"))
        attention = self.store.view("owner", "attention", {})
        self.assertEqual((attention["waiting_on_me"], attention["latest_waiting"]), (0, []))
        self.archive(False)
        attention = self.store.view("owner", "attention", {})
        self.assertEqual((attention["waiting_on_me"], [item["id"] for item in attention["latest_waiting"]]), (1, ["t1"]))

    def test_a_page_starts_from_the_newest_message_by_name_already_waiting(self):
        # The page learns this number when it opens, so a delivery listed later
        # with a larger number arrived after it opened, whatever reads failed.
        after = lambda actor="owner": self.store.view(actor, "capabilities", {})["attention"]["after"]
        self.assertEqual(after(), 0)
        self.committed(self.post(body="Not by name"))
        self.committed(self.post(body="For agent-b by name", addressees=["agent-b"]))
        self.assertEqual(after(), 0, "only deliveries that name this reader count")
        self.committed(self.post(body="First by name", addressees=["owner"]))
        self.committed(self.post(body="Second by name", addressees=["owner"]))
        latest = self.counts()[3]
        start = after()
        self.assertEqual(start, latest[0]["seq"])
        self.committed(self.post(body="After the page opened", addressees=["owner"]))
        newer = [item["message"]["body"] for item in self.counts()[3] if item["seq"] > start]
        self.assertEqual(newer, ["After the page opened"])
        # Once everything is read, nothing waits to start from.
        self.committed(self.through(self.seq(self.counts()[3][0]["message_id"])))
        self.assertEqual((self.counts()[3], after()), ([], 0))

    def test_attention_takes_no_arguments(self):
        refused = self.store.view("owner", "attention", {"limit": 3})
        self.assertEqual(refused["error"]["code"], "INVALID_ARGUMENT")


if __name__ == "__main__":
    unittest.main()

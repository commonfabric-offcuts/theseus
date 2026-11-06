from __future__ import annotations

"""Work observed: one rule for whether anyone is seen working on a topic."""

import unittest
from unittest import mock

from aim_next import work
from aim_next.work import WORK_WINDOW_MS
import test_hosted_schedule as hosted


class WorkRuleCase(unittest.TestCase):
    def test_recent_activity_or_a_wait_is_observed_work_and_nothing_else_is(self):
        now = 10 * WORK_WINDOW_MS
        self.assertTrue(work.observed(now, False, now))
        self.assertTrue(work.observed(now - WORK_WINDOW_MS, False, now))
        self.assertFalse(work.observed(now - WORK_WINDOW_MS - 1, False, now))
        self.assertFalse(work.observed(None, False, now))
        # A wait is work however old the activity, or with none at all.
        self.assertTrue(work.observed(None, True, now))
        self.assertTrue(work.observed(0, True, now))
        # The seam for the pipeline's NOW list.
        self.assertTrue(work.observed(None, False, now, in_now=True))


class WorkObservedCase(hosted.HostedCase):
    """agent-a is a hosted agent in t1; the owner also has t2, where agent-a takes part."""

    def setUp(self):
        self.now = 1000
        # Messages take their time from the same clock as the runner.
        patch = mock.patch("aim_next.conversation._now_ms", side_effect=lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        super().setUp()

    def running(self):
        """The runner holds its lease: an hour passes in these cases, and a lapsed lease is taken again."""
        if self.store.renew_runner(self.hosting, self.runner)["status"] != "renewed":
            self.runner = self.token(self.hosting)

    def claim_now(self):
        self.running()
        return self.claim(self.hosting, self.runner)

    def end(self, status, turn_id="turn-1", **args):
        self.running()
        return super().end(status, turn_id, **args)

    def topic_two(self, participants=("agent-a",)):
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w1"}
        self.assertEqual(self.save_draft("opening-two", source, "t2", "Second topic",
                                         opening={"workspace_id": "w1", "title": "Two", "participants": list(participants)})["status"], "committed")
        self.assertEqual(self.prepare("opening-two", "t2", submission="opening-2", send_op="open-two")["status"], "committed")
        created = self.command("topic.create_and_send", {"submission_id": "opening-2"}, target={"topic_id": "t2"}, op="open-two")
        self.assertEqual(created["status"], "committed", created)

    def listed(self, actor="owner"):
        return {item["id"]: item["work"] for item in self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})["items"]}

    def seen(self, topic="t1"):
        found = self.listed()[topic]
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": topic})["topic"]["work"], found, "the topic and its row say the same")
        return (found["observed"], found["seen_ms"], found["by"], found["how"], found["waits"])

    def test_a_post_is_observed_work_for_an_hour_then_no_activity_is_seen_since_it(self):
        self.now = 5000
        self.send_next("A post")
        self.assertEqual(self.seen(), (True, 5000, "owner", "posted", False))
        self.now += WORK_WINDOW_MS
        self.assertEqual(self.seen(), (True, 5000, "owner", "posted", False))
        self.now += 1
        self.assertEqual(self.seen(), (False, 5000, "owner", "posted", False))

    def test_a_hosted_turn_is_work_in_the_topics_it_was_handed_and_no_other(self):
        self.topic_two(participants=())
        self.send_next("For the agent")
        self.now += WORK_WINDOW_MS + 1
        claim = self.claim_now()
        # A delivery that arrives after the claim is not in the turn the claim hands.
        self.now += 10
        self.assertEqual(self.command("participation.set", {"actor_id": "agent-a", "present": True}, {"topic_id": "t2"})["status"], "committed")
        self.command("message.post", {"body": "Later, in t2"}, target={"topic_id": "t2"})
        self.assertEqual(len(self.pending()["items"]), 3, "agent-a has the t2 message too")
        posted_in_two = self.now
        self.now += 10
        self.hand(claim)
        self.assertEqual(self.seen("t1"), (True, self.now, "agent-a", "turn", False))
        self.assertEqual(self.seen("t2"), (True, posted_in_two, "owner", "posted", False))

    def test_a_completed_turn_is_activity_when_it_ends_and_one_that_was_lost_is_not(self):
        self.now += 10
        self.hand(self.claim_now(), turn_id="turn-lost")
        handed = self.now
        self.now += WORK_WINDOW_MS + 1
        self.assertEqual(self.end("lost", turn_id="turn-lost")["status"], "ended")
        self.assertEqual(self.seen(), (False, handed, "agent-a", "turn", False))
        self.now += 1000
        self.hand(self.claim_now(), turn_id="turn-done")
        self.now += WORK_WINDOW_MS + 1
        self.assertEqual(self.seen()[0], False)
        self.assertEqual(self.end("completed", turn_id="turn-done")["status"], "ended")
        self.assertEqual(self.seen(), (True, self.now, "agent-a", "turn", False))

    def test_a_topic_that_waits_on_someone_is_observed_however_old_its_activity(self):
        self.command("message.post", {"body": "Which day?", "addressees": ["owner"], "intent": "ask"},
                     target={"topic_id": "t1"}, actor="agent-a")
        asked = self.now
        self.now += 3 * WORK_WINDOW_MS
        self.assertEqual(self.seen(), (True, asked, "agent-a", "posted", True))
        # The answer ends the wait; the answer itself is then the activity.
        self.command("message.post", {"body": "Thursday"}, target={"topic_id": "t1"})
        answered = self.now
        self.now += WORK_WINDOW_MS + 1
        self.assertEqual(self.seen(), (False, answered, "owner", "posted", False))

    def test_a_page_of_topics_reads_one_indexed_row_per_topic(self):
        self.topic_two()
        plans = []
        real = work.work_by_topic
        def traced(db, waits):
            # Every statement the rule runs for the page, planned as SQLite would run it.
            statements = []
            db.set_trace_callback(statements.append)
            try:
                found = real(db, waits)
            finally:
                db.set_trace_callback(None)
            for statement in statements:
                plans.extend(row[-1] for row in db.execute("EXPLAIN QUERY PLAN " + statement))
            return found
        with mock.patch("aim_next.store.work_by_topic", traced):
            self.assertEqual(set(self.listed()), {"t1", "t2"})
        # Each fact is a keyed search per topic on the page; only the page's own list is walked.
        self.assertEqual([line for line in plans if line.startswith("SCAN") and "json_each" not in line], [], plans)
        for table in ("topic_summaries", "messages", "topic_turns"):
            self.assertTrue(any(line.startswith("SEARCH") and table in line for line in plans), (table, plans))


# Do not rerun the inherited hosted schedule cases.
for _name in list(vars(hosted.HostedCase)) + list(vars(hosted.runner_tests.RunnerCase)):
    if _name.startswith("test_") and _name not in WorkObservedCase.__dict__:
        setattr(WorkObservedCase, _name, None)


if __name__ == "__main__":
    unittest.main()

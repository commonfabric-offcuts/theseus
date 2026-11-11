from __future__ import annotations

"""A shipped piece's topic waits for the person's Done (Tony, 10 Nov; docs/pipeline.md, "A topic the pipeline holds
shipped"): the release record that ships a piece's last work sets its topic Ready for review, said by nobody, "Live in
release N since <its deployed time>". The person marks it Done; the pipeline never does. Its review is its own word only
while nobody has said otherwise, so a person's Done or any later word stands, and only the pipeline's own state goes
back to active when work for the topic appears again. A message in the topic (the shipping agent's "what to try")
leaves the pipeline's review as it is; a message in a done topic still reopens it."""

import sqlite3
import unittest

from test_pipeline_steering import PipelineCase


LIVE_24 = "Live in release 24 since 9:05 AM Tue Nov 10"


class ShippedTopicCase(PipelineCase):
    def setUp(self):
        super().setUp()
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"})
        # Release 23 is live with nothing in it, so the next record is release 24.
        self.assertTrue(self.store.record_release({"release": 23, "commit": "c" * 40, "deployed_at": "2026-11-09T08:00:00-08:00",
                                                   "items": [], "source": "backfill"})["recorded"])
        self.one, self.two = (self.add("Item %d" % n, section="now", size="small") for n in (1, 2))
        self.start([self.one], "t1")
        self.start([self.two], self.topic("t-two"))

    def topic(self, topic_id):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": topic_id, "title": "Work " + topic_id,
                                                     "participants": ["agent-a"], "body": "work", "attachments": []},
                                    {"opening_id": "o-" + topic_id}, {"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, {"opening_id": "o-" + topic_id}, {"opening_revision": 1}))
        return topic_id

    def start(self, numbers, topic_id):
        return self.committed(self.command("pipeline.piece_start", {"numbers": list(numbers), "topic_id": topic_id, "stage_id": "build"},
                                           {"workspace_id": "w1"}, actor="agent-a"))["piece_id"]

    def ship(self, release, items, at="2026-11-10T09:05:00-08:00"):
        self.assertTrue(self.store.record_release({"release": release, "commit": ("%x" % release) * 20, "deployed_at": at,
                                                   "items": list(items), "source": "deploy"})["recorded"])

    def say(self, topic_id, actor="agent-a", **args):
        version = self.store.view(actor, "topic", {"topic_id": topic_id})["topic"]["version"]
        return self.committed(self.command("topic.update", args, {"topic_id": topic_id}, {"topic_revision": version}, actor=actor))

    def stands(self, *ids):
        return self.sql("SELECT id,state,state_note,state_by,state_message_id IS NOT NULL FROM topics WHERE id IN (%s) ORDER BY id"
                        % ",".join("?" * len(ids)), ids)

    def test_a_record_shipping_a_piece_sets_its_topic_ready_for_review_with_when_it_went_live(self):
        self.ship(24, [self.one])
        # t1's piece has shipped: Ready for review, by nobody, never Done. t-two still builds item 2.
        self.assertEqual(self.stands("t-two", "t1"), [("t-two", "active", "", None, 0), ("t1", "review", LIVE_24, None, 0)])
        # The time is the release's own, as the deploy wrote it, whatever its zone.
        self.ship(25, [self.two], at="2026-11-10T23:30:00+00:00")
        self.assertEqual(self.stands("t-two"), [("t-two", "review", "Live in release 25 since 11:30 PM Tue Nov 10", None, 0)])

    def test_a_topic_a_person_marked_done_or_changed_keeps_their_word(self):
        self.say("t1", state="done", note="Wrapped up early")
        self.say("t-two", state="waiting", waiting_on=["owner"])
        self.ship(24, [self.one, self.two])
        # A Done stands; any other word gives way to the pipeline's when it starts to hold the topic, as before.
        self.assertEqual(self.stands("t-two", "t1"), [("t-two", "review", LIVE_24, None, 0), ("t1", "done", "Wrapped up early", "agent-a", 0)])
        # Said since the pipeline's review, a word is the person's: work appearing again leaves it as they said it.
        self.say("t-two", state="active", note="Trying it")
        self.start([self.add("Item 3", section="now", size="small")], "t-two")
        self.start([self.add("Item 4", section="now", size="small")], "t1")
        self.assertEqual(self.stands("t-two", "t1"), [("t-two", "active", "Trying it", "agent-a", 0), ("t1", "done", "Wrapped up early", "agent-a", 0)])

    def test_work_appearing_again_puts_only_the_pipelines_own_review_back_to_active(self):
        self.ship(24, [self.one, self.two])
        self.say("t-two", state="review", note="Mine to look at")
        self.assertEqual(self.stands("t-two", "t1"), [("t-two", "review", "Mine to look at", "agent-a", 0), ("t1", "review", LIVE_24, None, 0)])
        self.start([self.add("Item 3", section="now", size="small")], "t1")
        self.start([self.add("Item 4", section="now", size="small")], "t-two")
        self.assertEqual(self.stands("t-two", "t1"), [("t-two", "review", "Mine to look at", "agent-a", 0), ("t1", "active", "", None, 0)])

    def test_a_done_the_pipeline_said_before_review_stays_done_and_still_goes_back_to_active_with_new_work(self):
        # Topics it held Done before 10 Nov are not moved to review; they are still its own word.
        self.ship(24, [self.one])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topics SET state='done',state_note='Shipped in release 24' WHERE id='t1'")
        self.ship(25, [self.two])
        self.assertEqual(self.stands("t1"), [("t1", "done", "Shipped in release 24", None, 0)])
        self.start([self.add("Item 3", section="now", size="small")], "t1")
        self.assertEqual(self.stands("t1"), [("t1", "active", "", None, 0)])

    def test_a_message_leaves_the_pipelines_review_while_a_message_in_a_done_topic_reopens_it(self):
        self.ship(24, [self.one, self.two])
        self.post("What to try: open the page and press the new button.", topic="t1")
        self.assertEqual(self.stands("t1"), [("t1", "review", LIVE_24, None, 0)])
        # Still the pipeline's own after the message: new work puts it back to active.
        self.start([self.add("Item 3", section="now", size="small")], "t1")
        self.assertEqual(self.stands("t1"), [("t1", "active", "", None, 0)])
        # The person's Done; a message after it reopens the topic.
        self.say("t-two", actor="owner", state="done", keep_note=True)
        self.assertEqual(self.stands("t-two"), [("t-two", "done", LIVE_24, "owner", 0)])
        self.post("One more thing.", topic="t-two")
        self.assertEqual(self.stands("t-two"), [("t-two", "active", "Reopened by a new message", "agent-a", 1)])


if __name__ == "__main__":
    unittest.main()

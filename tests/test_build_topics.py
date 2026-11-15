from __future__ import annotations

"""Build topics shown once, in the right rail (item 297; docs/rails.md, docs/topic-list.md).

On an outcome whose pipeline is on, a topic some piece is built in is a Build
topic: `workspace_topics` says so on each item, and lists those topics apart
from the outcome's other open topics (`build: true`), or leaves them out
(`build: false`), so the outline and the right rail each show one of the two.
A Build topic Done is in the done list as any topic is, and an archived one in
the archived list; an outcome with no pipeline on has no Build topics."""

import unittest

import test_pipeline_stages as stages
from test_pipeline_steering import PipelineCase


class BuildTopicsCase(PipelineCase):
    start = stages.StagesCase.start
    topic = stages.StagesCase.topic

    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages({"stage_id": "build", "name": "Build"})
        self.add("Now 1", section="now", size="small")

    def ids(self, actor="owner", **args):
        answer = self.store.view(actor, "workspace_topics", dict({"workspace_id": "w1"}, **args))
        self.assertNotIn("error", answer, answer)
        return [item["id"] for item in answer["items"]]

    def flags(self, **args):
        answer = self.store.view("owner", "workspace_topics", dict({"workspace_id": "w1"}, **args))
        return {item["id"]: item["build"] for item in answer["items"]}

    def say(self, topic, **args):
        version = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        self.committed(self.command("topic.update", args, target={"topic_id": topic}, expected={"topic_revision": version}))

    def test_a_topic_a_piece_is_built_in_is_listed_apart_from_the_others_while_the_pipeline_is_on(self):
        self.topic("t2", "Plain talk")
        self.assertEqual(self.ids(build=True), [], "no piece yet, so no Build topic")
        self.assertEqual(sorted(self.ids(build=False)), ["t1", "t2"])
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.assertEqual(self.ids(build=True), ["t1"], "the topic the piece is built in")
        self.assertEqual(self.ids(build=False), ["t2"], "and the others, without it")
        self.assertEqual(sorted(self.ids()), ["t1", "t2"], "with neither, every open topic, as before")
        self.assertEqual(self.flags(), {"t1": True, "t2": False}, "each item says whether it is a Build topic")
        self.assertEqual([self.store.view("owner", "topic", {"topic_id": t})["topic"]["build"] for t in ("t1", "t2")], [True, False])
        # Every member reads it the same way.
        self.assertEqual(self.ids("agent-b", build=True), ["t1"])
        # Off, the outcome has no pipeline to show them in: no topic is a Build topic.
        self.committed(self.on(enabled=False))
        self.assertEqual(self.ids(build=True), [])
        self.assertEqual(sorted(self.ids(build=False)), ["t1", "t2"])
        self.assertEqual(self.flags(), {"t1": False, "t2": False})
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["build"], False)
        self.committed(self.on())
        self.assertEqual(self.ids(build=True), ["t1"], "on again, it is again")

    def test_a_build_topic_ready_for_review_stays_apart_until_done_then_is_in_the_done_list(self):
        self.topic("t2", "Plain talk")
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.say("t1", state="review", note="Live in release 3")
        self.assertEqual(self.ids(build=True), ["t1"], "Ready for review, it stays apart")
        self.say("t1", state="done")
        self.assertEqual(self.ids(build=True), [], "Done, it leaves the Build topics")
        self.assertEqual(self.ids(build=False), ["t2"], "and does not come back among the open ones")
        self.assertEqual(self.ids(done=True), ["t1"], "it is in the done list, as any done topic")
        self.assertEqual(self.flags(done=True), {"t1": True})
        self.say("t1", state="active")
        self.assertEqual(self.ids(build=True), ["t1"], "reopened, it is apart again")
        self.say("t1", archived=True)
        self.assertEqual((self.ids(build=True), self.ids(build=False), self.ids(archived=True)), ([], ["t2"], ["t1"]),
                         "archived, it is in the archived list alone")

    def test_pages_without_the_build_topics_skip_them_and_keep_the_order(self):
        for topic in ("t2", "t3", "t4"):
            self.topic(topic, "Topic " + topic)
        self.committed(self.start(numbers=(1,), topic="t3"))
        everything = self.ids()
        apart = [topic for topic in everything if topic != "t3"]
        seen, cursor = [], ""
        while True:
            answer = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": False, "limit": 1, "cursor": cursor})
            seen += [item["id"] for item in answer["items"]]
            cursor = answer["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(seen, apart, "a page at a time, in the list's order, never the Build topic")
        self.assertEqual(self.ids(build=True, limit=1), ["t3"])

    def test_build_is_true_or_false_and_only_among_the_open_topics(self):
        for args in ({"build": "yes"}, {"build": 1}, {"build": True, "done": True}, {"build": False, "archived": True}):
            with self.subTest(args=args):
                answer = self.store.view("owner", "workspace_topics", dict({"workspace_id": "w1"}, **args))
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)
                # Refused for what build may be, not as an argument the view does not know.
                self.assertIn("build", answer["error"]["message"].lower(), answer)

    def build_count(self, actor="owner"):
        items = self.store.view(actor, "workspaces", {})["items"]
        return next(item for item in items if item["id"] == "w1")["build"]

    def test_the_outcomes_list_and_the_build_list_count_what_is_new_in_the_open_build_topics_apart(self):
        # The outline shows no Build topic's row (docs/rails.md, "Counts"), so the outcome's item says what they hold.
        self.topic("t2", "Plain talk")
        self.topic("t3", "Built too")
        self.add("Now 2", section="now", size="small")
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.committed(self.start(numbers=(2,), topic="t3"))
        self.post("Built the first part", topic="t1")
        self.post("This one is for you", topic="t1", addressees=["owner"], intent="tell")
        self.post("Built the other part", topic="t3")
        self.post("Plain words", topic="t2")
        item = next(item for item in self.store.view("owner", "workspaces", {})["items"] if item["id"] == "w1")
        self.assertEqual(item["build"], {"unread": 3, "addressed": 1}, "the Build topics' three, one sent by name")
        self.assertGreaterEqual(item["unread"], 4, "the outcome's own count holds them all, the plain topic's too")
        # The right rail's list carries the same, for all the open Build topics, not only its page.
        answer = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True, "limit": 1})
        self.assertEqual((len(answer["items"]), answer["builds"]), (1, {"unread": 3, "addressed": 1}))
        self.assertNotIn("builds", self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": False}), "the outline's list counts its own rows")
        # Each reader their own: agent-b was sent nothing.
        self.assertEqual(self.build_count("agent-b")["addressed"], 0)
        # Done, the topic is in the outline's Done list, and its messages are no Build topic's.
        self.say("t1", state="done")
        self.assertEqual(self.build_count(), {"unread": 1, "addressed": 0}, "only the other Build topic's")
        self.say("t1", state="active")
        self.assertEqual(self.build_count(), {"unread": 3, "addressed": 1}, "reopened, they are again")
        self.committed(self.on(enabled=False))
        self.assertEqual(self.build_count(), {"unread": 0, "addressed": 0}, "off, no topic is a Build topic")
        self.committed(self.on())
        self.say("t1", archived=True)
        self.assertEqual(self.build_count(), {"unread": 1, "addressed": 0}, "archived, it is under Archived")

    def test_an_outcome_without_a_pipeline_lists_its_topics_as_before(self):
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.committed(self.on(enabled=False))
        self.assertEqual((self.ids(build=True), self.ids(build=False), self.ids()), ([], ["t1"], ["t1"]))

    def version(self, topic):
        return self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]

    def test_turning_the_pipeline_off_or_on_moves_each_build_topic_on_so_a_page_reading_it_reads_it_again(self):
        # A page holds its topic as it last read it, and reads it again when the topic's version moves (item 297): its
        # topic's build flag decides whether the outline or the right rail lists it, so the flag never changes unseen.
        self.topic("t2", "Plain talk")
        self.committed(self.start(numbers=(1,), topic="t1"))
        before = {topic: self.version(topic) for topic in ("t1", "t2")}
        self.committed(self.on(enabled=False))
        after = {topic: self.version(topic) for topic in ("t1", "t2")}
        self.assertGreater(after["t1"], before["t1"], "off, t1 is no Build topic any more: its version moves")
        self.assertEqual(after["t2"], before["t2"], "t2 never was one: nothing moves")
        self.assertTrue(self.sql("SELECT 1 FROM changes WHERE scope_kind='topic' AND scope_id='t1' AND resource_kind='topic' AND version=?", (after["t1"],)),
                        "and the topic's own feed says so")
        self.committed(self.on(enabled=False, title="Renamed while off"))
        self.assertEqual(self.version("t1"), after["t1"], "settings changed while it stays off move no topic")
        self.committed(self.on())
        self.assertGreater(self.version("t1"), after["t1"], "on again, t1 is a Build topic again: its version moves")
        self.assertEqual(self.version("t2"), before["t2"])

    def test_a_topics_first_piece_moves_it_on_and_a_later_piece_does_not(self):
        self.topic("t2", "Plain talk")
        self.add("Now 2", section="now", size="small")
        before = self.version("t2")
        piece = self.committed(self.start(numbers=(1,), topic="t2"))["piece_id"]
        self.assertGreater(self.version("t2"), before, "its first piece makes t2 a Build topic: its version moves")
        self.assertTrue(self.store.view("owner", "topic", {"topic_id": "t2"})["topic"]["build"])
        self.committed(self.command("pipeline.piece_finish", {}, {"piece_id": piece}))
        before = self.version("t2")
        self.committed(self.start(numbers=(2,), topic="t2"))
        self.assertEqual(self.version("t2"), before, "a later piece in it changes nothing about it: it already was one")

    def test_a_release_moves_its_topic_on_when_it_is_the_topics_first_piece_and_not_when_the_topic_is_already_one(self):
        self.store.record_release({"release": 22, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [], "source": "backfill"})
        self.committed(self.on(ships_in_releases=True))
        self.stages({"stage_id": "build", "name": "Build"}, {"stage_id": "checks", "name": "Release checks", "scope": "release"})
        self.topic("t3", "Release")
        self.add("Now 2", section="now", size="small")
        first = self.committed(self.start(numbers=(1,), topic="t1"))["piece_id"]
        before = {topic: self.version(topic) for topic in ("t1", "t3")}
        self.committed(self.command("pipeline.combine", {"piece_ids": [first], "topic_id": "t3"}, {"workspace_id": "w1"}))
        self.assertGreater(self.version("t3"), before["t3"], "the release is t3's first piece: t3 is a Build topic now")
        self.assertTrue(self.store.view("owner", "topic", {"topic_id": "t3"})["topic"]["build"])
        self.assertEqual(self.version("t1"), before["t1"], "t1, combined, already was one: nothing about it moved")

    def test_the_build_list_carries_every_open_build_topic_holding_a_piece_under_way_whatever_page_it_is_on(self):
        # The right rail's Now has a row for each piece under way, its topic's (item 297): its marks come from here, not
        # from the page of Build topics it reads, where a quiet topic falls past the first 20.
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.post("Which one ships first?", topic="t1", addressees=["owner"], intent="ask")
        for n in range(3):
            topic = "t-%d" % n
            self.topic(topic, "Built %d" % n)
            piece = self.committed(self.start(numbers=(self.add("Item %d" % n, section="now", size="small"),), topic=topic))["piece_id"]
            self.committed(self.command("pipeline.piece_finish", {}, {"piece_id": piece}))
        answer = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True, "limit": 1})
        self.assertEqual([item["id"] for item in answer["items"]], ["t-2"], "the page holds the newest Build topic alone")
        [now] = answer["building"]
        self.assertEqual((now["id"], now["unread"], now["addressed"], [ask["actor_id"] for ask in now["asks"]], now["build"]), ("t1", 1, 1, ["owner"], True),
                         "t1, with what its row carries")
        later = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True, "limit": 1, "cursor": answer["next_cursor"]})
        self.assertEqual([item["id"] for item in later["building"]], ["t1"], "on every page")
        self.assertNotIn("building", self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": False}), "the outline's list has no Now")
        # A finished piece's topic is no row of Now; a Done topic is the outline's, its piece under way or not.
        self.say("t1", state="done")
        self.assertEqual(self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True})["building"], [])
        self.say("t1", state="active")
        self.assertEqual([item["id"] for item in self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True})["building"]], ["t1"])
        self.say("t1", archived=True)
        self.assertEqual(self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True})["building"], [], "nor an archived one")
        self.say("t1", archived=False)
        self.committed(self.on(enabled=False))
        self.assertEqual(self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "build": True})["building"], [], "off, nothing is being built here")


if __name__ == "__main__":
    unittest.main()

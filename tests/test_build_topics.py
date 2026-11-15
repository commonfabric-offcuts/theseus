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

    def test_an_outcome_without_a_pipeline_lists_its_topics_as_before(self):
        self.committed(self.start(numbers=(1,), topic="t1"))
        self.committed(self.on(enabled=False))
        self.assertEqual((self.ids(build=True), self.ids(build=False), self.ids()), ([], ["t1"], ["t1"]))


if __name__ == "__main__":
    unittest.main()

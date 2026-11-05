from __future__ import annotations

"""Where a topic stands: state, note, who it waits on, rename and archive."""

import unittest

import reader_fixture as fixtures


class TopicStateCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating;
    # agent-b can read it as a member but does not work in it.

    def update(self, args, actor="owner", topic="t1", expected=None):
        if expected is None:
            expected = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        return self.command("topic.update", args, target={"topic_id": topic},
                            expected={"topic_revision": expected}, actor=actor)

    def topic(self, actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return answer["topic"]

    def listed(self, archived=None, actor="owner"):
        args = {"workspace_id": "w1"} if archived is None else {"workspace_id": "w1", "archived": archived}
        answer = self.store.view(actor, "workspace_topics", args)
        self.assertNotIn("error", answer, answer)
        return {item["id"]: item for item in answer["items"]}

    def waiting_on(self, actor):
        answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return answer["waiting_on_me"], [item["id"] for item in answer["latest_waiting"]]

    def test_a_participant_says_the_topic_waits_on_someone_and_they_see_it(self):
        result = self.committed(self.update({"state": "waiting", "note": "Which name do we ship?", "waiting_on": ["owner"]}, actor="agent-a"))
        self.assertEqual((result["state"], result["note"], result["waiting_on"], result["state_by"]),
                         ("waiting", "Which name do we ship?", ["owner"], "agent-a"))
        self.assertIsInstance(result["state_ms"], int)
        topic = self.topic()
        self.assertEqual((topic["state"], topic["state_note"], topic["waiting_on"], topic["state_by"], topic["state_ms"]),
                         ("waiting", "Which name do we ship?", ["owner"], "agent-a", result["state_ms"]))
        item = self.listed()["t1"]
        self.assertEqual((item["state"], item["state_note"], item["waiting_on"], item["archived"]),
                         ("waiting", "Which name do we ship?", ["owner"], False))
        self.assertEqual(self.waiting_on("owner"), (1, ["t1"]))
        self.assertEqual(self.waiting_on("agent-a"), (0, []))
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        # The person it waits on learns of it in their own change scope.
        self.assertEqual(self.sql("SELECT resource_kind,resource_id FROM changes WHERE scope_kind='actor' AND scope_id='owner' AND resource_kind='waiting'"),
                         [("waiting", "t1")])

    def test_a_new_state_starts_with_its_own_note_and_stops_waiting(self):
        self.committed(self.update({"state": "waiting", "note": "Need a decision", "waiting_on": ["owner", "agent-b"]}, actor="agent-a"))
        # Changing only who it waits on keeps the note.
        self.committed(self.update({"waiting_on": ["owner"]}, actor="agent-a"))
        self.assertEqual((self.topic()["state_note"], self.listed()["t1"]["waiting_on"]), ("Need a decision", ["owner"]))
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        # Moving on clears the note and who it waited on, unless a new note is given.
        self.committed(self.update({"state": "review"}, actor="agent-a"))
        self.assertEqual((self.topic()["state"], self.topic()["state_note"], self.listed()["t1"]["waiting_on"]), ("review", "", []))
        self.assertEqual(self.waiting_on("owner"), (0, []))
        self.committed(self.update({"state": "done", "note": "Shipped"}, actor="owner"))
        self.assertEqual((self.topic()["state"], self.topic()["state_note"], self.topic()["state_by"]), ("done", "Shipped", "owner"))
        # Everyone it stopped waiting on was told.
        self.assertEqual(self.sql("SELECT scope_id FROM changes WHERE scope_kind='actor' AND resource_kind='waiting' ORDER BY seq"),
                         [("agent-b",), ("owner",), ("agent-b",), ("owner",), ("owner",)])

    def test_only_those_who_work_in_the_topic_say_where_it_stands(self):
        # agent-b reads the topic as an outcome member but does not work in it.
        self.rejected(self.update({"state": "done"}, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.update({"state": "done"}, actor="outsider"), "FORBIDDEN")
        self.participation("agent-b", True)
        self.committed(self.update({"state": "review"}, actor="agent-b"))
        self.participation("agent-b", False)
        self.rejected(self.update({"state": "done"}, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.topic()["state"], "review")

    def test_renaming_and_archiving_stay_with_the_owner_and_creator(self):
        for args in ({"title": "Renamed"}, {"archived": True}):
            with self.subTest(args=args):
                self.rejected(self.update(args, actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.topic()["title"], "Topic")
        self.committed(self.update({"title": "Naming the release"}))
        self.assertEqual((self.topic()["title"], self.listed()["t1"]["title"]), ("Naming the release", "Naming the release"))
        self.rejected(self.update({"title": "  "}), "EMPTY_TITLE")
        # A rename does not say where the topic stands.
        self.assertIsNone(self.topic()["state_by"])

    def test_an_archived_topic_leaves_the_list_and_keeps_where_it_stands(self):
        self.committed(self.update({"state": "done", "note": "Finished"}, actor="agent-a"))
        self.committed(self.update({"archived": True}))
        self.assertNotIn("t1", self.listed())
        self.assertNotIn("t1", self.listed(archived=False))
        item = self.listed(archived=True)["t1"]
        self.assertEqual((item["archived"], item["state"], item["state_note"]), (True, "done", "Finished"))
        # Still readable by those who could read it.
        self.assertEqual((self.topic("agent-b")["archived"], self.topic("agent-b")["state"]), (True, "done"))
        self.committed(self.update({"archived": False}))
        self.assertIn("t1", self.listed())
        self.assertNotIn("t1", self.listed(archived=True))

    def test_waiting_names_only_people_and_agents_who_can_read_the_topic(self):
        self.rejected(self.update({"state": "waiting", "waiting_on": ["outsider"]}, actor="agent-a"), "INVALID_RECIPIENT")
        self.rejected(self.update({"state": "waiting", "waiting_on": ["nobody-here"]}, actor="agent-a"), "INVALID_RECIPIENT")
        # agent-b can read it as a member, and other-reader once they participate.
        self.committed(self.update({"state": "waiting", "waiting_on": ["agent-b"]}, actor="agent-a"))
        self.participation("other-reader", True)
        self.committed(self.update({"waiting_on": ["agent-b", "other-reader"]}, actor="agent-a"))
        self.assertEqual(self.waiting_on("other-reader"), (1, ["t1"]))
        # A reader who loses access no longer sees it waiting on them.
        self.participation("other-reader", False)
        self.assertEqual(self.waiting_on("other-reader"), (0, []))
        self.assertEqual(self.waiting_on("agent-b"), (1, ["t1"]))

    def test_invalid_updates_change_nothing(self):
        before = self.topic()
        for args, code in (({}, "INVALID_ARGUMENT"),
                           ({"state": "paused"}, "INVALID_ARGUMENT"),
                           ({"state": "archived"}, "INVALID_ARGUMENT"),
                           ({"state": "review", "waiting_on": ["owner"]}, "INVALID_ARGUMENT"),
                           ({"waiting_on": ["owner"]}, "INVALID_ARGUMENT"),
                           ({"archived": "yes"}, "INVALID_ARGUMENT"),
                           ({"priority": 1}, "INVALID_ARGUMENT"),
                           ({"note": "x" * 1025}, "BODY_TOO_LARGE"),
                           ({"state": "waiting", "waiting_on": "owner"}, "INVALID_ARGUMENT")):
            with self.subTest(args=args):
                self.rejected(self.update(args), code)
        self.rejected(self.update({"state": "done"}, expected=before["version"] - 1), "REVISION_CONFLICT")
        self.assertEqual(self.topic(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])

    def test_a_note_at_the_limit_and_a_bare_reassertion_are_kept(self):
        self.committed(self.update({"state": "active", "note": "é" * 512}))
        first = self.topic()
        self.assertEqual(len(first["state_note"].encode("utf-8")), 1024)
        self.committed(self.update({"state": "active"}, actor="agent-a"))
        again = self.topic()
        self.assertEqual((again["state_note"], again["state_by"]), (first["state_note"], "agent-a"))
        self.assertGreaterEqual(again["state_ms"], first["state_ms"])

    def test_attention_lists_the_newest_waiting_topics_first_and_bounds_them(self):
        for n in range(7):
            topic = "tw%d" % n
            self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": topic, "title": "Waiting %d" % n,
                                                         "participants": ["agent-a"], "body": "Opening", "attachments": []},
                                        target={"opening_id": "o-" + topic}, expected={"opening_revision": 0}))
            self.committed(self.command("opening.publish", {}, target={"opening_id": "o-" + topic}, expected={"opening_revision": 1}))
            self.committed(self.update({"state": "waiting", "waiting_on": ["owner"]}, actor="agent-a", topic=topic,
                                       expected=self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]))
            self.sql("UPDATE topics SET state_ms=? WHERE id=?", (1000 + n, topic))
        count, latest = self.waiting_on("owner")
        self.assertEqual((count, latest), (7, ["tw6", "tw5", "tw4", "tw3", "tw2"]))


if __name__ == "__main__":
    unittest.main()

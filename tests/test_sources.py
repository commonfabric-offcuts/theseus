from __future__ import annotations

"""Topics started from a message: the source is kept, listed, and a second start must have seen the first."""

import json
import unittest

import reader_fixture as fixtures


class SourcesCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating.

    def setUp(self):
        super().setUp()
        self.message = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]

    def save(self, opening, topic, actor="owner", revision=0, workspace="w1", **extra):
        args = {"workspace_id": workspace, "topic_id": topic, "title": "Answering " + topic, "participants": [],
                "body": "Picking this up", "attachments": []}
        args.update(extra)
        return self.command("opening.save", args, target={"opening_id": opening},
                            expected={"opening_revision": revision}, actor=actor)

    def publish(self, opening, actor="owner", revision=1, seen=None, op=None):
        return self.command("opening.publish", {} if seen is None else {"seen": seen}, target={"opening_id": opening},
                            expected={"opening_revision": revision}, actor=actor, op=op)

    def started(self, actor="owner", **args):
        answer = self.store.view(actor, "source_topics", dict({"message_id": self.message}, **args))
        self.assertNotIn("error", answer, answer)
        return [item["id"] for item in answer["items"]]

    def test_a_second_start_from_the_same_message_is_shown_the_first_and_can_still_go_ahead(self):
        self.committed(self.save("o1", "t-first", source_message_id=self.message))
        self.committed(self.publish("o1"))
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t-first"})["topic"]["source_message_id"], self.message)
        answer = self.store.view("agent-a", "source_topics", {"message_id": self.message})
        self.assertEqual(answer["message_id"], self.message)
        [item] = answer["items"]
        self.assertEqual({key: item[key] for key in ("id", "workspace_id", "title", "creator_id", "state", "archived", "message_count")},
                         {"id": "t-first", "workspace_id": "w1", "title": "Answering t-first", "creator_id": "owner",
                          "state": "active", "archived": False, "message_count": 1})
        # A second person starting from the same message without having seen the first is refused,
        # recorded, and the refusal names it; nothing is created and the opening stays open.
        self.committed(self.save("o2", "t-second", actor="agent-a", source_message_id=self.message))
        before = self.sql("SELECT count(*) FROM topics")
        refused = self.publish("o2", actor="agent-a")
        self.rejected(refused, "ALREADY_STARTED")
        self.assertTrue(refused["recorded"])
        self.assertIn("t-first", refused["error"]["message"])
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), before)
        self.assertEqual(self.store.view("agent-a", "opening", {"opening_id": "o2"})["opening"]["state"], "open")
        # Naming it as seen, they still go ahead.
        self.committed(self.publish("o2", actor="agent-a", seen=["t-first"]))
        self.assertEqual(self.started("agent-b"), ["t-first", "t-second"])
        # A topic started from nothing names no source and is listed under none.
        self.committed(self.save("o3", "t-plain"))
        self.committed(self.publish("o3"))
        self.assertIsNone(self.store.view("owner", "topic", {"topic_id": "t-plain"})["topic"]["source_message_id"])
        self.assertEqual(self.started(), ["t-first", "t-second"])

    def test_two_people_saving_from_the_same_message_meet_at_the_second_publish(self):
        # Both openings were saved before either was sent, as two pages open seconds apart.
        self.committed(self.save("o1", "t-one", source_message_id=self.message))
        self.committed(self.save("o2", "t-two", actor="agent-a", source_message_id=self.message))
        self.committed(self.publish("o1"))
        self.rejected(self.publish("o2", actor="agent-a"), "ALREADY_STARTED")
        self.assertEqual(self.started(), ["t-one"])
        # Seeing some but not all is not enough.
        self.committed(self.save("o3", "t-three", source_message_id=self.message))
        self.committed(self.publish("o2", actor="agent-a", seen=["t-one"], op="o2-seen"))
        self.rejected(self.publish("o3", seen=["t-one"]), "ALREADY_STARTED")
        self.committed(self.publish("o3", seen=["t-one", "t-two"], op="o3-seen"))

    def test_only_topics_the_person_can_read_count_or_are_listed(self):
        # The owner answers the message in a private outcome of their own.
        self.committed(self.command("workspace.create", {"id": "w-private", "title": "Private", "team": []},
                                    expected={"workspace_revision": 0}))
        self.committed(self.save("o1", "t-private", workspace="w-private", source_message_id=self.message))
        self.committed(self.publish("o1"))
        self.assertEqual(self.started(), ["t-private"])
        self.assertEqual(self.started("agent-a"), [], "agent-a cannot open the private topic")
        self.committed(self.save("o2", "t-shared", actor="agent-a", source_message_id=self.message))
        self.committed(self.publish("o2", actor="agent-a"))
        # The owner can read both, so their next start must have seen both.
        self.committed(self.save("o3", "t-third", source_message_id=self.message))
        self.rejected(self.publish("o3", seen=["t-private"]), "ALREADY_STARTED")

    def test_only_a_readable_message_can_be_answered_or_asked_about(self):
        self.committed(self.command("workspace.create", {"id": "w-out", "title": "Outside", "team": []},
                                    expected={"workspace_revision": 0}, actor="outsider"))
        self.rejected(self.save("o1", "t-out", actor="outsider", workspace="w-out", source_message_id=self.message), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT count(*) FROM openings WHERE actor_id='outsider'"), [(0,)])
        answer = self.store.view("outsider", "source_topics", {"message_id": self.message})
        self.assertEqual(answer["error"]["code"], "FORBIDDEN")
        self.rejected(self.save("o2", "t-nowhere", source_message_id="m-missing"), "FORBIDDEN")

    def test_an_opening_keeps_the_message_it_answers(self):
        self.committed(self.save("o1", "t-kept", source_message_id=self.message))
        # A later save that leaves it out keeps it, as a page from before this field would.
        self.committed(self.save("o1", "t-kept", revision=1, body="Changed words"))
        self.assertEqual(self.store.view("owner", "opening", {"opening_id": "o1"})["opening"]["source_message_id"], self.message)
        self.committed(self.save("o1", "t-kept", revision=2, body="Again", source_message_id=self.message))
        other = self.send("Another message to answer")["id"]
        for changed in (other, None):
            with self.subTest(changed=changed):
                self.rejected(self.save("o1", "t-kept", revision=3, source_message_id=changed), "INVALID_ARGUMENT")
        payload = json.loads(self.sql("SELECT payload FROM openings WHERE id='o1'")[0][0])
        self.assertEqual((payload["source_message_id"], payload["body"]), (self.message, "Again"))
        # An opening that answers nothing keeps answering nothing.
        self.committed(self.save("o2", "t-none"))
        self.rejected(self.save("o2", "t-none", revision=1, source_message_id=self.message), "INVALID_ARGUMENT")
        self.assertNotIn("source_message_id", json.loads(self.sql("SELECT payload FROM openings WHERE id='o2'")[0][0]))

    def test_seen_is_only_for_an_opening_that_answers_a_message_and_is_a_bounded_list(self):
        self.committed(self.save("o1", "t-plain"))
        self.rejected(self.publish("o1", seen=["t1"]), "INVALID_ARGUMENT")
        self.committed(self.save("o2", "t-from", source_message_id=self.message))
        for args in ({"seen": "t1"}, {"seen": ["t1"] * 101}, {"seen": [7]}, {"seen": [], "body": "x"}):
            with self.subTest(args=args):
                self.rejected(self.command("opening.publish", args, target={"opening_id": "o2"},
                                           expected={"opening_revision": 1}), "INVALID_ARGUMENT")
        # Discard still carries nothing.
        self.rejected(self.command("opening.discard", {"seen": []}, target={"opening_id": "o2"},
                                   expected={"opening_revision": 1}), "INVALID_ARGUMENT")
        # An empty list, or naming a topic that did not start from it, is harmless.
        self.committed(self.publish("o2", seen=["t1"]))


if __name__ == "__main__":
    unittest.main()

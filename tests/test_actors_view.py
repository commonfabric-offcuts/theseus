from __future__ import annotations

"""The actors view: the registered, enabled people and agents anyone in the instance can pick from."""

import unittest

import reader_fixture as fixtures


class ActorsViewCase(fixtures.ReaderCase):
    def page(self, actor="owner", **args):
        answer = self.store.view(actor, "actors", args)
        self.assertNotIn("error", answer, answer)
        return answer

    def test_everyone_in_the_instance_lists_every_enabled_actor_in_id_order(self):
        everyone = [row[0] for row in self.sql("SELECT id FROM actors WHERE enabled=1 ORDER BY id")]
        for actor in ("owner", "agent-a", "outsider"):
            with self.subTest(actor=actor):
                answer = self.page(actor)
                self.assertEqual([item["id"] for item in answer["items"]], everyone)
                self.assertIsNone(answer["next_cursor"])
        item = next(item for item in self.page()["items"] if item["id"] == "agent-a")
        self.assertEqual(set(item), {"id", "kind", "name", "name_truncated"})
        self.assertEqual(item["kind"], "agent")

    def test_pages_follow_the_cursor_and_kind_narrows_the_list(self):
        everyone = [row[0] for row in self.sql("SELECT id FROM actors WHERE enabled=1 ORDER BY id")]
        seen, cursor = [], None
        while True:
            answer = self.page(limit=2, **({} if cursor is None else {"cursor": cursor}))
            self.assertLessEqual(len(answer["items"]), 2)
            seen += [item["id"] for item in answer["items"]]
            cursor = answer["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(seen, everyone)
        agents = [row[0] for row in self.sql("SELECT id FROM actors WHERE enabled=1 AND kind='agent' ORDER BY id")]
        self.assertEqual([item["id"] for item in self.page(kind="agent")["items"]], agents)
        self.assertNotEqual(agents, everyone)

    def test_a_disabled_actor_is_not_offered(self):
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.assertNotIn("agent-b", [item["id"] for item in self.page()["items"]])

    def test_invalid_arguments_are_refused(self):
        for args in ({"kind": "robot"}, {"cursor": 3}, {"limit": 0}, {"workspace_id": "w1"}):
            with self.subTest(args=args):
                self.assertEqual(self.store.view("owner", "actors", args)["error"]["code"], "INVALID_ARGUMENT")

    def test_a_topics_participants_say_whether_each_is_a_person_or_an_agent(self):
        self.participation("outsider", True)
        participants = self.store.view("owner", "topic", {"topic_id": "t1"})["participants"]
        kinds = dict(self.sql("SELECT id,kind FROM actors"))
        self.assertIn("outsider", [row["actor_id"] for row in participants])
        self.assertEqual({row["actor_id"]: row["kind"] for row in participants}, {row["actor_id"]: kinds[row["actor_id"]] for row in participants})
        self.assertEqual(next(row for row in participants if row["actor_id"] == "outsider")["kind"], "agent")


if __name__ == "__main__":
    unittest.main()

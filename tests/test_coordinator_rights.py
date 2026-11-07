from __future__ import annotations

"""An outcome's coordinator organises it beside its owner; only the owner hands it on."""

import unittest

import reader_fixture as fixtures


class CoordinatorCase(fixtures.ReaderCase):
    # w1 is owner's outcome; agent-a is its coordinator and agent-b a plain
    # member. Its topic t1 was created by owner, with agent-a taking part.

    def version(self, workspace="w1"):
        return self.sql("SELECT version FROM workspaces WHERE id=?", (workspace,))[0][0]

    def member_set(self, member, present, actor):
        return self.command("workspace.member_set", {"actor_id": member, "present": present}, {"workspace_id": "w1"},
                            {"workspace_revision": self.version()}, actor=actor)

    def owner_set(self, owner_id, actor, workspace="w1"):
        return self.command("workspace.owner_set", {"owner_id": owner_id}, {"workspace_id": workspace},
                            {"workspace_revision": self.version(workspace)}, actor=actor)

    def update(self, args, actor):
        return self.command("topic.update", args, target={"topic_id": "t1"},
                            expected={"topic_revision": self.topic()["version"]}, actor=actor)

    def take_part(self, member, present, actor):
        return self.command("participation.set", {"actor_id": member, "present": present}, target={"topic_id": "t1"}, actor=actor)

    def topic(self, actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return answer["topic"]

    def test_the_coordinator_changes_the_team_but_never_removes_or_replaces_the_owner(self):
        self.committed(self.member_set("outsider", True, actor="agent-a"))
        self.assertEqual(self.sql("SELECT actor_id FROM workspace_members WHERE workspace_id='w1' ORDER BY actor_id"),
                         [("agent-a",), ("agent-b",), ("outsider",), ("owner",)])
        self.committed(self.member_set("outsider", False, actor="agent-a"))
        self.rejected(self.member_set("owner", False, actor="agent-a"), "OWNER_REQUIRED")
        self.rejected(self.owner_set("agent-b", actor="agent-a"), "FORBIDDEN")
        # A plain member organises nothing.
        self.rejected(self.member_set("outsider", True, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT owner_id,coordinator_id FROM workspaces WHERE id='w1'"), [("owner", "agent-a")])

    def test_the_coordinator_organises_a_topic_they_neither_made_nor_work_in(self):
        self.participation("agent-a", False)
        self.assertEqual(self.sql("SELECT count(*) FROM reply_horizons WHERE topic_id='t1' AND actor_id='agent-a'"), [(0,)])
        # A plain member who has not written in it may do none of this.
        for args in ({"title": "Renamed"}, {"archived": True}, {"state": "review"}):
            with self.subTest(args=args):
                self.rejected(self.update(args, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.take_part("agent-b", True, actor="agent-b"), "FORBIDDEN")
        self.assertIs(self.topic("agent-b")["reader_may_say"], False)
        # The coordinator may.
        self.assertIs(self.topic("agent-a")["reader_may_say"], True)
        self.committed(self.take_part("agent-b", True, actor="agent-a"))
        self.assertEqual(self.committed(self.update({"title": "Renamed"}, actor="agent-a"))["title"], "Renamed")
        self.assertIs(self.committed(self.update({"archived": True}, actor="agent-a"))["archived"], True)
        self.assertIs(self.committed(self.update({"archived": False}, actor="agent-a"))["archived"], False)
        self.assertEqual(self.committed(self.update({"state": "review", "note": "Ready"}, actor="agent-a"))["state_by"], "agent-a")
        self.committed(self.take_part("agent-b", False, actor="agent-a"))

    def test_a_cleared_coordinator_falls_back_to_the_owner_alone(self):
        self.committed(self.member_set("agent-a", False, actor="owner"))
        self.committed(self.member_set("agent-a", True, actor="owner"))
        self.assertEqual(self.sql("SELECT coordinator_id FROM workspaces WHERE id='w1'"), [(None,)])
        self.assertIsNone(self.topic()["coordinator_id"])
        self.rejected(self.member_set("outsider", True, actor="agent-a"), "FORBIDDEN")
        self.rejected(self.update({"title": "Renamed"}, actor="agent-a"), "FORBIDDEN")
        self.rejected(self.take_part("agent-b", True, actor="agent-a"), "FORBIDDEN")
        self.committed(self.member_set("outsider", True, actor="owner"))

    def test_being_coordinator_grants_no_reading(self):
        # Commands keep the coordinator on the team; a record edited by hand need
        # not, and then the coordinator reads only what a non-member reads.
        self.participation("agent-a", False)
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='agent-a'")
        for name, args in (("workspace", {"workspace_id": "w1"}), ("workspace_members", {"workspace_id": "w1"}),
                           ("workspace_topics", {"workspace_id": "w1"}), ("topic", {"topic_id": "t1"})):
            with self.subTest(view=name):
                self.rejected(self.store.view("agent-a", name, args), "FORBIDDEN")
        self.assertEqual(self.store.view("agent-a", "workspaces", {})["items"], [])

    def test_after_a_handover_the_new_owner_and_the_coordinator_organise_and_the_former_owner_does_not(self):
        # owner hands w1 to agent-b, and agent-a stays its coordinator: the
        # shape of handing an outcome to a person while an agent coordinates.
        self.committed(self.owner_set("agent-b", actor="owner"))
        topic = self.topic("agent-a")
        self.assertEqual((topic["owner_id"], topic["coordinator_id"], topic["creator_id"]), ("agent-b", "agent-a", "owner"))
        self.committed(self.member_set("outsider", True, actor="agent-a"))
        self.committed(self.member_set("outsider", False, actor="agent-b"))
        self.rejected(self.member_set("outsider", True, actor="owner"), "FORBIDDEN")
        self.rejected(self.member_set("agent-b", False, actor="agent-a"), "OWNER_REQUIRED")
        self.rejected(self.owner_set("agent-a", actor="agent-a"), "FORBIDDEN")
        self.committed(self.update({"title": "By the coordinator"}, actor="agent-a"))
        self.committed(self.update({"title": "By the new owner"}, actor="agent-b"))
        # The former owner made t1, so it still manages that topic as its creator.
        self.committed(self.update({"title": "By its creator"}, actor="owner"))


if __name__ == "__main__":
    unittest.main()

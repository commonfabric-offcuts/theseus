from __future__ import annotations

"""workspace.owner_set: the owner of an outcome hands it to another member."""

import unittest

import test_store as fixtures


class OwnerCase(fixtures.StoreCase):
    # w1 is owner's outcome; agent-a (its coordinator) and agent-b are members;
    # outsider is registered but belongs to nothing.

    def setUp(self):
        super().setUp()
        self.create_topic()
        self.base = self.version()
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Outside fixture agent')")

    def version(self):
        return self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]

    def owner_set(self, owner_id, actor="owner", revision=None):
        return self.command("workspace.owner_set", {"owner_id": owner_id}, {"workspace_id": "w1"},
                            {"workspace_revision": self.version() if revision is None else revision}, actor=actor)

    def refused(self, receipt, code, recorded=True):
        self.assertEqual((receipt["status"], receipt.get("error", {}).get("code"), receipt["recorded"]), ("rejected", code, recorded), receipt)

    def state(self):
        return (self.sql("SELECT * FROM workspace_members ORDER BY workspace_id,actor_id"),
                self.sql("SELECT * FROM workspaces"), self.sql("SELECT * FROM changes ORDER BY seq"))

    def owners(self, actor):
        return [(item["id"], item["owner_id"]) for item in self.store.view(actor, "workspaces", {})["items"]]

    def member_set(self, member, present, actor):
        return self.command("workspace.member_set", {"actor_id": member, "present": present}, {"workspace_id": "w1"},
                            {"workspace_revision": self.version()}, actor=actor)

    def test_the_owner_hands_the_outcome_to_a_member_and_stays_on_the_team(self):
        seq = self.sql("SELECT max(seq) FROM changes")[0][0]
        receipt = self.owner_set("agent-b")
        version = self.base + 1
        self.assertEqual((receipt["status"], receipt["recorded"]), ("committed", True), receipt)
        self.assertEqual(receipt["result"], {"workspace_id": "w1", "owner_id": "agent-b", "previous_owner_id": "owner", "version": version})
        self.assertEqual(receipt["affected"], [{"kind": "workspace", "id": "w1", "version": version}])
        # One version, the coordinator unchanged, the old owner still a member.
        self.assertEqual(self.sql("SELECT owner_id,coordinator_id,version FROM workspaces WHERE id='w1'"), [("agent-b", "agent-a", version)])
        self.assertEqual(self.sql("SELECT actor_id FROM workspace_members WHERE workspace_id='w1' ORDER BY actor_id"),
                         [("agent-a",), ("agent-b",), ("owner",)])
        # Open outcome pages and both owners' own lists learn of it.
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE seq>? ORDER BY seq", (seq,)),
                         [("workspace", "w1", "workspace", "w1", version), ("outcome", "w1", "workspace", "w1", version),
                          ("actor", "agent-b", "workspace", "w1", version), ("actor", "owner", "workspace", "w1", version)])
        self.assertEqual(self.owners("owner"), [("w1", "agent-b")])
        self.assertEqual(self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["owner_id"], "agent-b")
        # What only the owner may do moves with it.
        self.refused(self.member_set("outsider", True, actor="owner"), "FORBIDDEN")
        self.refused(self.owner_set("owner", actor="owner"), "FORBIDDEN")
        self.assertEqual(self.member_set("outsider", True, actor="agent-b")["status"], "committed")
        self.assertEqual(self.member_set("owner", False, actor="agent-b")["status"], "committed",
                         "the former owner is an ordinary member the new owner may remove")
        self.refused(self.member_set("agent-b", False, actor="agent-b"), "OWNER_REQUIRED")

    def test_the_old_owner_is_put_back_on_the_team_when_absent(self):
        # Commands always keep the owner on the team; a hand-edited record need not.
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w1' AND actor_id='owner'")
        self.assertEqual(self.owner_set("agent-a")["status"], "committed")
        self.assertEqual(self.sql("SELECT actor_id FROM workspace_members WHERE workspace_id='w1' ORDER BY actor_id"),
                         [("agent-a",), ("agent-b",), ("owner",)])
        self.assertEqual(self.sql("SELECT owner_id,coordinator_id FROM workspaces WHERE id='w1'"), [("agent-a", "agent-a")])

    def test_only_the_owner_hands_it_on_and_only_to_an_enabled_member(self):
        before = self.state()
        self.refused(self.owner_set("agent-b", actor="agent-a"), "FORBIDDEN")  # a member, and its coordinator
        self.refused(self.owner_set("outsider", actor="outsider"), "FORBIDDEN")
        self.refused(self.owner_set("outsider"), "NOT_A_MEMBER")
        self.refused(self.owner_set("nobody"), "INVALID_RECIPIENT")
        self.refused(self.owner_set("agent-b", revision=self.base - 1), "REVISION_CONFLICT")
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.refused(self.owner_set("agent-b"), "INVALID_RECIPIENT")
        for args in ({}, {"owner_id": "agent-a", "extra": 1}, {"actor_id": "agent-a"}, {"owner_id": 7}):
            with self.subTest(args=args):
                receipt = self.command("workspace.owner_set", args, {"workspace_id": "w1"}, {"workspace_revision": self.base})
                self.assertEqual(receipt.get("error", {}).get("code"), "INVALID_ARGUMENT", receipt)
        # No revision is refused before anything is looked up, whoever asks.
        for actor in ("owner", "agent-a"):
            self.refused(self.command("workspace.owner_set", {"owner_id": "agent-b"}, {"workspace_id": "w1"}, actor=actor),
                         "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.state(), before)

    def test_being_on_another_outcomes_team_is_not_being_on_this_one(self):
        self.assertEqual(self.command("workspace.create", {"id": "w2", "title": "Other", "team": ["outsider"]})["status"], "committed")
        before = self.state()
        self.refused(self.owner_set("outsider"), "NOT_A_MEMBER")
        self.assertEqual(self.state(), before)

    def test_an_unexpected_expected_field_is_refused_unrecorded(self):
        before = self.state()
        self.refused(self.command("workspace.owner_set", {"owner_id": "agent-b"}, {"workspace_id": "w1"},
                                  {"workspace_revision": self.base, "topic_revision": 1}), "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE kind='workspace.owner_set'"), [(0,)])

    def test_handing_it_to_the_owner_is_an_answer_not_a_change(self):
        before = self.state()
        receipt = self.owner_set("owner")
        self.assertEqual((receipt["status"], receipt["affected"]), ("committed", []), receipt)
        self.assertEqual(receipt["result"], {"workspace_id": "w1", "owner_id": "owner", "previous_owner_id": "owner", "version": self.base})
        self.assertEqual(self.state(), before)


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in OwnerCase.__dict__:
        setattr(OwnerCase, _name, None)


if __name__ == "__main__":
    unittest.main()

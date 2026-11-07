from __future__ import annotations

import unittest

from aim_next.contract import LIMITS
import test_store as fixtures


class MembershipCase(fixtures.StoreCase):
    def setUp(self):
        super().setUp()
        self.create_topic()
        self.base = self.version()
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('outsider','agent','Outside fixture agent')")

    def version(self):
        return self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]

    def member_set(self, member, present, actor="owner", revision=None, op=None):
        return self.command("workspace.member_set", {"actor_id": member, "present": present}, {"workspace_id": "w1"},
                            {"workspace_revision": self.version() if revision is None else revision}, actor=actor, op=op)

    def members(self, actor="owner", **args):
        return self.store.view(actor, "workspace_members", dict(args, workspace_id="w1"))

    def refused(self, receipt, code, recorded=True):
        self.assertEqual((receipt["status"], receipt["error"]["code"], receipt["recorded"]), ("rejected", code, recorded), receipt)

    def state(self):
        return (self.sql("SELECT * FROM workspace_members ORDER BY workspace_id,actor_id"),
                self.sql("SELECT * FROM workspaces"), self.sql("SELECT * FROM changes ORDER BY seq"))

    def workspace_ids(self, actor):
        return [item["id"] for item in self.store.view(actor, "workspaces", {})["items"]]

    def test_owner_adds_a_member_who_then_sees_the_workspace(self):
        self.assertEqual(self.workspace_ids("outsider"), [])
        self.assertEqual(self.members("outsider")["error"]["code"], "FORBIDDEN")
        receipt = self.member_set("outsider", True)
        version = self.base + 1
        self.assertEqual(receipt["result"], {"workspace_id": "w1", "actor_id": "outsider", "present": True, "version": version})
        self.assertEqual(receipt["affected"], [{"kind": "workspace", "id": "w1", "version": version}])
        self.assertEqual(self.version(), version)
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes "
                                  "WHERE resource_kind='workspace' ORDER BY seq"),
                         [("workspace", "w1", "workspace", "w1", 1), ("workspace", "w1", "workspace", "w1", version),
                          ("actor", "outsider", "workspace", "w1", version)])
        self.assertEqual(self.workspace_ids("outsider"), ["w1"])
        listing = self.members("outsider")
        self.assertEqual(listing["relevant_versions"], {"workspace": version})
        self.assertEqual(listing["items"], [
            {"actor_id": "agent-a", "kind": "agent", "name": "agent-a", "name_truncated": False, "enabled": True},
            {"actor_id": "agent-b", "kind": "agent", "name": "agent-b", "name_truncated": False, "enabled": True},
            {"actor_id": "outsider", "kind": "agent", "name": "Outside fixture agent", "name_truncated": False, "enabled": True},
            {"actor_id": "owner", "kind": "human", "name": "owner", "name_truncated": False, "enabled": True}])

    def test_removal_ends_workspace_access_but_keeps_topic_participation(self):
        self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a'"), [(1,)])
        self.committed_set("agent-a", False, self.base + 1)
        self.committed_set("agent-b", False, self.base + 2)
        self.assertEqual(self.workspace_ids("agent-a"), [])
        self.assertEqual(self.store.view("agent-a", "workspace", {"workspace_id": "w1"})["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.store.view("agent-b", "topic", {"topic_id": "t1"})["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.store.view("agent-a", "topic", {"topic_id": "t1"})["topic"]["id"], "t1")
        self.assertEqual(self.sql("SELECT active FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a'"), [(1,)])

    def test_removing_the_coordinator_clears_it_and_no_one_else_does(self):
        coordinator = lambda: self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["coordinator_id"]
        self.assertEqual(coordinator(), "agent-a")
        self.committed_set("agent-b", False, self.base + 1)
        self.committed_set("outsider", True, self.base + 2)
        self.assertEqual(coordinator(), "agent-a", "other membership changes keep the coordinator")
        self.committed_set("agent-a", False, self.base + 3)
        self.assertIsNone(coordinator())
        self.assertEqual(self.sql("SELECT coordinator_id,version FROM workspaces WHERE id='w1'"), [(None, self.base + 3)])
        self.committed_set("agent-a", True, self.base + 4)
        self.assertIsNone(coordinator(), "returning as a member does not make them coordinator again")

    def committed_set(self, member, present, version):
        receipt = self.member_set(member, present)
        self.assertEqual((receipt["status"], receipt["result"]["version"]), ("committed", version), receipt)

    def test_only_the_owner_changes_membership_and_cannot_be_removed(self):
        # agent-b is a plain member; what the coordinator agent-a may do is in test_coordinator_rights.
        before = self.state()
        self.refused(self.member_set("outsider", True, actor="agent-b"), "FORBIDDEN")
        self.refused(self.member_set("agent-a", False, actor="agent-b"), "FORBIDDEN")
        self.refused(self.member_set("outsider", True, actor="outsider"), "FORBIDDEN")
        self.refused(self.member_set("owner", False), "OWNER_REQUIRED")
        self.refused(self.member_set("outsider", True, revision=self.base - 1), "REVISION_CONFLICT")
        self.refused(self.member_set("nobody", True), "INVALID_RECIPIENT")
        self.sql("UPDATE actors SET enabled=0 WHERE id='outsider'")
        self.refused(self.member_set("outsider", True), "INVALID_RECIPIENT")
        for args in ({"actor_id": "outsider", "present": 1}, {"actor_id": "outsider"},
                     {"actor_id": "outsider", "present": True, "extra": 1}):
            with self.subTest(args=args):
                self.refused(self.command("workspace.member_set", args, {"workspace_id": "w1"},
                                          {"workspace_revision": self.base}), "INVALID_ARGUMENT", recorded=False)
        self.refused(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False},
                                  {"workspace_id": "w1"}), "INVALID_ARGUMENT", recorded=False)
        self.assertEqual(self.state(), before)

    def test_no_op_returns_current_state_and_advances_nothing(self):
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        before = self.state()
        for member, present in (("agent-a", True), ("outsider", False), ("owner", True)):
            with self.subTest(member=member, present=present):
                receipt = self.member_set(member, present)
                self.assertEqual(receipt["result"], {"workspace_id": "w1", "actor_id": member, "present": present, "version": self.base})
                self.assertEqual(receipt["affected"], [])
        self.assertEqual(self.state(), before)
        # A disabled member can still be removed.
        self.committed_set("agent-b", False, self.base + 1)

    def test_adding_respects_the_member_limit(self):
        extra = ["m-%03d" % number for number in range(LIMITS["workspace_members"] - 3)]
        self.sql("INSERT INTO actors(id,kind,name) VALUES " + ",".join("('%s','agent','m')" % m for m in extra))
        self.sql("INSERT INTO workspace_members VALUES " + ",".join("('w1','%s')" % m for m in extra))
        before = self.state()
        self.refused(self.member_set("outsider", True), "TOO_MANY_WORKSPACE_MEMBERS")
        self.assertEqual(self.state(), before)
        # A full workspace still answers a no-op with its current state.
        receipt = self.member_set("agent-a", True)
        self.assertEqual((receipt["status"], receipt["affected"], receipt["result"]), ("committed", [], {
            "workspace_id": "w1", "actor_id": "agent-a", "present": True, "version": self.base}), receipt)
        self.assertEqual(self.state(), before)
        self.committed_set("m-000", False, self.base + 1)
        self.committed_set("outsider", True, self.base + 2)

    def test_member_list_pages_and_bounds(self):
        first = self.members(limit=2)
        self.assertEqual(([item["actor_id"] for item in first["items"]], first["next_cursor"]), (["agent-a", "agent-b"], "agent-b"))
        second = self.members(limit=2, cursor=first["next_cursor"])
        self.assertEqual(([item["actor_id"] for item in second["items"]], second["next_cursor"]), (["owner"], None))
        self.sql("UPDATE actors SET name=? WHERE id='agent-a'", ("界" * 400,))
        named = self.members(limit=1)["items"][0]
        self.assertEqual((named["name"], named["name_truncated"]), ("界" * 341, True))
        for args in ({"cursor": 1}, {"cursor": None}, {"limit": 0}, {"limit": LIMITS["page_max"] + 1}, {"owner": "owner"}):
            with self.subTest(args=args):
                self.assertEqual(self.members(**args)["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.store.view("owner", "workspace_members", {})["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.store.view("owner", "workspace_members", {"workspace_id": "w-missing"})["error"]["code"], "FORBIDDEN")


# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in MembershipCase.__dict__:
        setattr(MembershipCase, _name, None)


if __name__ == "__main__":
    unittest.main()

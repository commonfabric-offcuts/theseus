from __future__ import annotations

"""The order a person keeps their outcomes and topics in: theirs alone, fenced on its revision,
naming only what they can place, and read back on every outcome list and topic list."""

import unittest

import test_store as fixtures


class OutlineOrderCase(fixtures.StoreCase):
    # Three outcomes the owner made (agent-a on the first two) and three topics in the first.
    def world(self):
        for workspace, title, team in (("w1", "First", ["agent-a"]), ("w2", "Second", ["agent-a"]), ("w3", "Third", [])):
            self.committed(self.command("workspace.create", {"id": workspace, "title": title, "purpose": "", "team": team}))
        for topic in ("t1", "t2", "t3"):
            self.topic(topic)

    def topic(self, topic_id, workspace="w1"):
        prefix = "topic-" + topic_id
        self.committed(self.command("draft.save", {
            "source_ref": {"kind": "new_topic", "id": prefix, "workspace_id": workspace}, "topic_id": topic_id,
            "generation": prefix + "-g", "body": "Opening " + topic_id,
            "opening": {"workspace_id": workspace, "title": "Topic " + topic_id, "participants": []}},
            {"draft_id": prefix + "-d"}, {"draft_revision": 0}))
        self.committed(self.command("submission.prepare", {"draft_id": prefix + "-d", "submission_id": prefix + "-s", "send_operation_id": prefix + "-send"},
                                    {"topic_id": topic_id}, {"draft_revision": 1}))
        self.committed(self.command("topic.create_and_send", {"submission_id": prefix + "-s"}, {"topic_id": topic_id}, op=prefix + "-send"))

    def place(self, ids, expected, workspace=None, actor="owner", op=None):
        return self.command("outline.order_set", {"ids": ids}, target={"workspace_id": workspace} if workspace else {},
                            expected={"order_revision": expected}, actor=actor, op=op)

    def committed(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        return receipt["result"]

    def refused(self, receipt, code):
        self.assertEqual(receipt.get("error", {}).get("code"), code, receipt)
        self.assertNotEqual(receipt.get("status"), "committed", receipt)
        return receipt["error"]

    def outcomes(self, actor="owner"):
        answer = self.store.view(actor, "workspaces", {"limit": 100})
        self.assertNotIn("error", answer, answer)
        return answer

    def topics(self, workspace="w1", actor="owner", **args):
        answer = self.store.view(actor, "workspace_topics", dict(args, workspace_id=workspace, limit=100))
        self.assertNotIn("error", answer, answer)
        return answer

    def test_an_outcome_order_is_the_placers_own_and_every_outcome_list_carries_it(self):
        self.world()
        self.assertEqual(self.outcomes()["order"], {"ids": [], "revision": 0}, "nothing placed yet")
        result = self.committed(self.place(["w3", "w1", "w2"], 0))
        self.assertEqual(result, {"workspace_id": None, "ids": ["w3", "w1", "w2"], "order_revision": 1, "changed": True})
        listed = self.outcomes()
        self.assertEqual(listed["order"], {"ids": ["w3", "w1", "w2"], "revision": 1})
        self.assertEqual([item["id"] for item in listed["items"]], ["w1", "w2", "w3"], "Core's own list keeps its order; the page places them")
        # Every page of the list carries it, so whichever page a client reads first knows it.
        first = self.store.view("owner", "workspaces", {"limit": 1})
        self.assertEqual(first["order"], listed["order"])
        self.assertEqual(self.store.view("owner", "workspaces", {"limit": 1, "cursor": first["next_cursor"]})["order"], listed["order"])
        # Another viewer on the same outcomes keeps their own.
        self.assertEqual(self.outcomes("agent-a")["order"], {"ids": [], "revision": 0})
        self.committed(self.place(["w2", "w1"], 0, actor="agent-a"))
        self.assertEqual(self.outcomes("agent-a")["order"]["ids"], ["w2", "w1"])
        self.assertEqual(self.outcomes()["order"]["ids"], ["w3", "w1", "w2"], "one viewer's order never moves another's")
        # Each tells only its own placer's scope, and nothing to an outcome's or topic's.
        self.assertEqual(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE resource_kind IN ('outcome_order','topic_order') ORDER BY seq"),
                         [("actor", "owner", "outcome_order", "owner", 1), ("actor", "agent-a", "outcome_order", "agent-a", 1)])

    def test_a_topic_order_is_per_outcome_and_the_topic_list_carries_it(self):
        self.world()
        self.assertEqual(self.topics()["order"], {"ids": [], "revision": 0})
        self.committed(self.place(["t1", "t3", "t2"], 0, workspace="w1"))
        for args in ({}, {"done": True}, {"archived": True}):
            with self.subTest(args=args):
                self.assertEqual(self.topics(**args)["order"], {"ids": ["t1", "t3", "t2"], "revision": 1}, "every list of the outcome carries it")
        self.assertEqual([item["id"] for item in self.topics()["items"]], ["t3", "t2", "t1"], "the list itself stays latest activity first")
        self.assertEqual(self.topics("w2")["order"], {"ids": [], "revision": 0}, "another outcome's topics keep their own")
        self.assertEqual(self.outcomes()["order"], {"ids": [], "revision": 0}, "and the outcomes theirs")
        self.assertEqual(self.topics(actor="agent-a")["order"], {"ids": [], "revision": 0}, "and another viewer theirs")

    def test_an_order_naming_an_outcome_the_viewer_is_not_on_is_refused(self):
        self.world()
        # agent-b is on none of them; agent-a is not on w3.
        error = self.refused(self.place(["w1"], 0, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(error["message"], "You can only place the outcomes you are on")
        self.refused(self.place(["w1", "w3"], 0, actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.refused(self.place(["w1", "nowhere"], 0), "FORBIDDEN")["message"], error["message"],
                         "an outcome that does not exist reads the same, so the refusal tells nobody it does")
        # Topics: only those of the named outcome, which the viewer must be able to read.
        self.topic("t9", workspace="w2")
        self.refused(self.place(["t1", "t9"], 0, workspace="w1"), "INVALID_ARGUMENT")
        self.refused(self.place(["t1"], 0, workspace="w3", actor="agent-a"), "FORBIDDEN")
        self.refused(self.place(["t1"], 0, workspace="w1", actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT count(*) FROM outline_orders"), [(0,)], "a refused order keeps nothing")

    def test_only_a_list_of_distinct_ids_within_the_limit_is_taken(self):
        self.world()
        for ids in (["w1", "w1"], "w1", {"ids": ["w1"]}, [1], [""], ["w\n1"], ["w" * 201], [None]):
            with self.subTest(ids=ids):
                self.refused(self.place(ids, 0), "INVALID_ARGUMENT")
        self.refused(self.place(["w%d" % n for n in range(501)], 0), "INVALID_ARGUMENT")
        # However few, never more bytes than leave every list that carries it room for its items.
        self.refused(self.place(["%03d" % n + "é" * 196 for n in range(100)], 0), "INVALID_ARGUMENT")
        self.refused(self.command("outline.order_set", {"ids": ["w1"], "more": True}, expected={"order_revision": 0}), "INVALID_ARGUMENT")
        self.refused(self.command("outline.order_set", {"ids": ["w1"]}, target={"topic_id": "t1"}, expected={"order_revision": 0}), "INVALID_ARGUMENT")
        self.refused(self.command("outline.order_set", {"ids": ["w1"]}), "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM outline_orders"), [(0,)])

    def test_a_late_order_never_undoes_a_newer_one_and_a_retry_is_one_order(self):
        self.world()
        first = self.place(["w2", "w1"], 0, op="once")
        self.assertEqual(self.place(["w2", "w1"], 0, op="once"), first, "the same operation is answered as it was recorded")
        self.committed(self.place(["w1", "w2", "w3"], 1, op="other-device"))
        error = self.refused(self.place(["w3", "w2"], 1, op="late"), "REVISION_CONFLICT")
        self.assertEqual(error["current_versions"], {"order_revision": 2})
        self.assertEqual(self.outcomes()["order"], {"ids": ["w1", "w2", "w3"], "revision": 2})
        self.assertEqual(self.committed(self.place(["w1", "w2", "w3"], 2)), {"workspace_id": None, "ids": ["w1", "w2", "w3"], "order_revision": 2, "changed": False},
                         "the same order changes nothing")
        # An emptied order places nothing, and its revision keeps growing.
        self.assertEqual(self.committed(self.place([], 2))["order_revision"], 3)
        self.assertEqual(self.outcomes()["order"], {"ids": [], "revision": 3})

    def test_what_the_viewer_can_no_longer_place_drops_out_as_it_is_read(self):
        self.world()
        self.committed(self.place(["w3", "w2", "w1"], 0, actor="owner"))
        self.committed(self.place(["w2", "w1"], 0, actor="agent-a"))
        self.committed(self.place(["t3", "t2", "t1"], 0, workspace="w1"))
        # agent-a leaves w2: its order no longer names w2, in the order it kept.
        version = self.store.view("owner", "workspace", {"workspace_id": "w2"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False}, {"workspace_id": "w2"}, {"workspace_revision": version}))
        self.assertEqual(self.outcomes("agent-a")["order"], {"ids": ["w1"], "revision": 1})
        # So the order a client reads is one Core takes back as it is.
        self.committed(self.place(self.outcomes("agent-a")["order"]["ids"], 1, actor="agent-a"))
        # An archived topic is still one of the outcome's: it stays placed, in the archived list's order.
        self.committed(self.command("topic.update", {"archived": True}, {"topic_id": "t2"},
                                    {"topic_revision": self.store.view("owner", "topic", {"topic_id": "t2"})["topic"]["version"]}))
        self.assertEqual(self.topics(archived=True)["order"]["ids"], ["t3", "t2", "t1"])

    def test_placing_changes_no_count_light_or_topic(self):
        self.world()
        before = (self.outcomes()["items"], self.topics()["items"], self.sql("SELECT id,version,activity_ms FROM topics ORDER BY id"),
                  self.sql("SELECT id,version FROM workspaces ORDER BY id"))
        self.committed(self.place(["w3", "w2", "w1"], 0))
        self.committed(self.place(["t2", "t1", "t3"], 0, workspace="w1"))
        after = (self.outcomes()["items"], self.topics()["items"], self.sql("SELECT id,version,activity_ms FROM topics ORDER BY id"),
                 self.sql("SELECT id,version FROM workspaces ORDER BY id"))
        self.assertEqual(after, before)
        self.assertEqual(self.sql("SELECT count(*) FROM changes WHERE scope_kind IN ('topic','workspace','outcome') AND seq>(SELECT max(seq)-2 FROM changes)"), [(0,)])

    def test_the_command_is_recorded_once_in_the_ledger(self):
        self.world()
        self.committed(self.place(["w1"], 0, op="ledger"))
        self.assertEqual(self.sql("SELECT actor_id,id,kind FROM operations WHERE id='ledger'"), [("owner", "ledger", "outline.order_set")])


# The store fixture's own checks run once, from test_store, not again here.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in OutlineOrderCase.__dict__:
        setattr(OutlineOrderCase, _name, None)


if __name__ == "__main__":
    unittest.main()

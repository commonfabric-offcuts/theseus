from __future__ import annotations

import json
import unittest
from unittest import mock

import reader_fixture as fixtures
from aim_next.contract import LIMITS


FIELDS = {"id", "unread", "addressed", "build", "cover_waiting", "light", "color", "color_revision"}


class OutlineCountsCase(fixtures.ReaderCase):
    def counts(self, actor="owner", ids=None):
        answer = self.store.view(actor, "workspace_counts", {"workspace_ids": ids or ["w1"]})
        self.assertNotIn("error", answer, answer)
        self.assertEqual(set(answer), {"instance_id", "items"})
        for item in answer["items"]:
            self.assertEqual(set(item), FIELDS)
        return answer["items"]

    def test_delivery_waiting_ack_and_mark_follow_the_existing_count_rules(self):
        before = self.counts()[0]
        posted = self.committed(self.command("message.post", {
            "body": "Isolated delivery", "addressees": ["owner"], "intent": "tell",
        }, target={"topic_id": "t1"}, actor="agent-a"))
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]},
                                    target={"topic_id": "t1"}, expected={"topic_revision": version}))
        arrived = self.counts()[0]
        self.assertEqual((arrived["unread"], arrived["addressed"]), (before["unread"] + 1, before["addressed"] + 1))
        self.assertEqual(arrived["light"]["light"], "waiting")
        self.assertEqual(arrived["light"]["short"]["count"], 1)
        listed = self.store.view("owner", "workspaces", {})["items"][0]
        self.assertEqual(arrived, {key: listed[key] for key in FIELDS})
        message = posted["message_id"]
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0]
        self.committed(self.command("topic.read_through", {"from_seq": seq, "seq": seq}, target={"topic_id": "t1"}))
        read = self.counts()[0]
        self.assertEqual((read["unread"], read["addressed"]), (before["unread"], before["addressed"]))
        self.committed(self.command("message.mark", {"marked": True}, target={"message_id": message}, expected={"mark_revision": 0}))
        marked = self.counts()[0]
        self.assertEqual((marked["unread"], marked["addressed"]), (read["unread"] + 1, read["addressed"]))
        self.committed(self.command("message.mark", {"marked": False}, target={"message_id": message}, expected={"mark_revision": 1}))
        self.assertEqual(self.counts()[0], read)
        # The agent's subscription/addressing is its own; the owner's mark is private.
        agent = self.counts("agent-a")[0]
        listed_agent = self.store.view("agent-a", "workspaces", {})["items"][0]
        self.assertEqual(agent, {key: listed_agent[key] for key in FIELDS})

    def test_named_scope_reads_no_global_list_or_unrelated_outcome(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Unrelated", "team": ["agent-a"]}))
        before = self.records()
        with mock.patch.object(self.store, "_view_workspaces", side_effect=AssertionError("global list read")), \
                mock.patch.object(self.store, "_unread", wraps=self.store._unread) as unread, \
                mock.patch.object(self.store, "_outcome_stands", wraps=self.store._outcome_stands) as stands:
            self.assertEqual([item["id"] for item in self.counts(ids=["w1"])], ["w1"])
            self.assertEqual(unread.call_args.kwargs["workspaces"], ["w1"])
            self.assertEqual([call.args[2]["id"] for call in stands.call_args_list], ["w1"])
        self.assertEqual(self.records(), before, "counts read records nothing")

    def test_private_unknown_and_revoked_outcomes_refuse_without_partial_counts(self):
        for ident in ("unknown", "w1"):
            answer = self.store.view("other-reader", "workspace_counts", {"workspace_ids": [ident]})
            self.assertEqual(answer.get("error", {}).get("code"), "FORBIDDEN", answer)
            self.assertNotIn("items", answer)
        self.committed(self.command("workspace.create", {"id": "private", "title": "Private"}, actor="agent-b"))
        answer = self.store.view("owner", "workspace_counts", {"workspace_ids": ["w1", "private"]})
        self.assertEqual(answer.get("error", {}).get("code"), "FORBIDDEN", answer)
        self.assertNotIn("items", answer)
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        answer = self.store.view("agent-a", "workspace_counts", {"workspace_ids": ["w1"]})
        self.assertEqual(answer.get("error", {}).get("code"), "FORBIDDEN", answer)
        self.assertNotIn("items", answer)

    def test_invalid_or_oversize_requests_never_fall_back_to_all_outcomes(self):
        invalid = [{}, {"workspace_ids": []}, {"workspace_ids": "w1"}, {"workspace_ids": ["w1", "w1"]},
                   {"workspace_ids": [None]}, {"workspace_ids": ["bad\n"]},
                   {"workspace_ids": ["w%s" % n for n in range(LIMITS["page_max"] + 1)]},
                   {"workspace_ids": ["w1"], "actor": "agent-a"}]
        for args in invalid:
            with self.subTest(args=args):
                answer = self.store.view("owner", "workspace_counts", args)
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)

    def test_response_has_no_titles_order_or_bodies_and_keeps_summary_bound(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "secret-title" * 10000}))
        answer = self.store.view("owner", "workspace_counts", {"workspace_ids": ["w2", "w1"]})
        self.assertEqual({item["id"] for item in answer.get("items", [])}, {"w1", "w2"}, answer)
        encoded = json.dumps(answer, ensure_ascii=False).encode("utf-8")
        self.assertLessEqual(len(encoded), LIMITS["summary_utf8_bytes"])
        self.assertNotIn(b"secret-title", encoded)
        for item in answer["items"]:
            self.assertEqual(set(item), FIELDS)

    def test_cover_waiting_counts_use_the_current_readers_authority(self):
        root = self.opening["id"]
        self.committed(self.command("stack.cover", {"waiting": [{"text": "Review isolated result?", "default": "Kept pending"}]},
                                    target={"message_id": root}, expected={"cover_revision": 0}, actor="agent-a"))
        self.assertEqual(self.counts()[0]["cover_waiting"], 1)
        self.assertEqual(self.counts("agent-a")[0]["cover_waiting"], 0, "the cover asks the owner")
        self.committed(self.command("stack.cover", {"waiting": []}, target={"message_id": root},
                                    expected={"cover_revision": 1}, actor="agent-a"))
        self.assertEqual(self.counts()[0]["cover_waiting"], 0)


if __name__ == "__main__":
    unittest.main()

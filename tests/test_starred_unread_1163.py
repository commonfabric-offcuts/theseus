from __future__ import annotations

"""1163: public commands and real views on a fresh, isolated Core store."""

import sqlite3
from unittest import mock

from aim_next import store as store_module
from test_stacks import StackCase
import test_new_line as new_line_fixtures


class StarredUnread1163(StackCase):
    def post(self, body="Words", actor="agent-a", topic="t1", **args):
        if args.get("reply_to") and not ({"reply_passage", "reply_without_quote"} & args.keys()):
            args["reply_without_quote"] = "This fixture exercises dossier unread state without quoting the parent words."
        return super().post(body, actor=actor, topic=topic, **args)

    def scoped(self, actor="owner", **args):
        answer = self.store.view(actor, "stars", dict(topic_id="t1", **args))
        self.assertNotIn("error", answer, answer)
        return answer

    def at(self, message):
        seq, sent = self.sql("SELECT seq,sent_ms FROM messages WHERE id=?", (message,))[0]
        return {"id": message, "seq": seq, "sent_ms": sent}

    def read(self, message, actor="owner"):
        seq = self.at(message)["seq"]
        self.committed(self.command("topic.read_through", {"from_seq": seq, "seq": seq},
                                    target={"topic_id": "t1"}, actor=actor))

    def mark(self, message, on, actor="owner"):
        rows = self.sql("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?", (actor, message))
        self.committed(self.command("message.mark", {"marked": on}, target={"message_id": message},
                                    expected={"mark_revision": rows[0][0] if rows else 0}, actor=actor))

    def root(self, words="The orchard plan"):
        root = self.post(words, actor="owner")
        self.committed(self.star(root))
        return root

    def counted(self, root):
        return next(row["dossier"] for row in self.scoped()["items"] if row["dossier"]["id"] == root)

    def test_unstarred_nested_replies_count_only_in_their_dossier_and_name_the_reachable_oldest(self):
        root = self.root()
        first = self.post("Plant the pear trees", reply_to=root,
                          reply_without_quote="This fixture exercises reply routing without quoting the parent words.")
        second = self.post("Keep the path clear", actor="agent-b", reply_to=first,
                           reply_without_quote="This fixture exercises nested routing without quoting the parent words.")
        self.post("A different dossier")
        dossier = self.counted(root)
        self.assertEqual(dossier.get("unread"), 2, "both unstarred replies belong to the starred dossier")
        self.assertEqual(dossier["oldest_unread"], self.at(first))
        position = self.store.view("owner", "stack_positions", {"topic_id": "t1", "message_ids": [first]})
        self.assertEqual(position["items"][0]["stack_position"]["root_id"], root)
        self.read(first)
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (1, self.at(second)))

    def test_every_star_page_has_the_complete_count_and_joins_and_splits_use_current_roots(self):
        first, second = self.root("Pear trees"), self.root("Apple trees")
        a, b = self.post("Pear reply", reply_to=first), self.post("Apple reply", reply_to=second)
        self.committed(self.star(a))
        before = self.scoped(limit=1)
        self.assertEqual((before["items"][0]["dossier"]["unread"], before["items"][0]["dossier"]["oldest_unread"]), (1, self.at(a)))
        self.committed(self.join(second, first))
        cursor, seen = None, []
        while True:
            page = self.scoped(limit=1, **({"cursor": cursor} if cursor is not None else {}))
            seen.extend(page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(len(seen), 3)
        self.assertTrue(all((s["dossier"]["id"], s["dossier"]["unread"], s["dossier"]["oldest_unread"]) ==
                            (first, 2, self.at(a)) for s in seen))
        self.committed(self.join(second, None, revision=1))
        self.assertEqual((self.counted(first)["unread"], self.counted(second)["oldest_unread"]), (1, self.at(b)))

    def test_pending_plus_mark_counts_once_and_reading_keeps_the_independent_mark(self):
        root = self.root()
        reply = self.post("Prune in February", reply_to=root)
        self.mark(reply, True)
        self.mark(root, True)  # Own writing remains ineligible even when marked.
        self.assertEqual(self.counted(root)["unread"], 1)
        self.read(reply)
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (1, self.at(reply)))
        self.mark(reply, False)
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (0, None))

    def test_leaving_deactivates_old_subscription_but_a_new_direct_delivery_still_counts(self):
        root = self.root()
        stale = self.post("The old subscription", reply_to=root)
        self.participation("owner", False)
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (0, None))
        self.mark(stale, True)
        self.assertEqual(self.counted(root)["oldest_unread"], self.at(stale), "an inactive delivery does not hide a mark")
        self.mark(stale, False)
        named = self.post("A direct note after leaving", reply_to=root, addressees=["owner"], intent="tell")
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (1, self.at(named)))
        self.participation("owner", True)
        self.assertEqual(self.counted(root)["unread"], 1, "rejoining does not revive the cancelled group's rows")

    def test_other_readers_marks_invisible_whispers_and_own_writing_never_add_to_the_count(self):
        root = self.root()
        reply = self.post("Public reply", reply_to=root)
        self.read(reply)
        self.mark(reply, True, actor="agent-b")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.participation("other-reader", True)
        private = self.post("Private question", actor="other-reader", reply_to=root, addressees=["agent-a"], whisper=True)
        self.post("Private between the agents", actor="agent-a", reply_to=private, addressees=["other-reader"], whisper=True)
        self.post("My own update", actor="owner", reply_to=root)
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (0, None))
        self.assertNotIn("Private between the agents", str(self.scoped()))

    def test_access_revocation_refuses_the_scoped_projection_without_erasing_its_star(self):
        root = self.root()
        self.committed(self.star(root, actor="agent-b"))
        self.post("For the whole topic", reply_to=root)
        self.assertEqual(self.scoped(actor="agent-b")["items"][0]["dossier"]["unread"], 0,
                         "team membership alone is not an active topic subscription")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.assertEqual(self.store.view("agent-b", "stars", {"topic_id": "t1"})["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.sql("SELECT count(*) FROM message_acts WHERE message_id=? AND owner='agent-b' AND kind='star'", (root,)), [(1,)])

    def test_zero_default_and_read_only_projection_change_no_record_or_unscoped_shape(self):
        root = self.root()
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (0, None))
        reply = self.post("Retain the independent reminder", reply_to=root)
        self.mark(reply, True)
        before = self.records()
        self.assertEqual(self.counted(root)["unread"], 1)
        self.assertEqual(self.records(), before, "the human scoped read changes no table")
        self.assertNotIn("dossier", self.store.view("owner", "stars", {})["items"][0])
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "completed"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": version}))
        self.assertEqual(self.counted(root)["oldest_unread"], self.at(reply))

    def test_an_agent_correction_is_not_a_second_unread_message(self):
        root = self.root()
        self.committed(self.star(root, actor="agent-a"))
        reply = self.post("Original calendar", actor="owner", reply_to=root)
        self.read(root, actor="agent-a")
        self.read(reply, actor="agent-a")
        self.source({"kind": "message", "id": reply}, actor="agent-a")
        self.committed(self.command("message.edit", {"body": "Corrected calendar"},
                                    target={"message_id": reply}, expected={"message_revision": 1}))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                                  "WHERE d.recipient_id='agent-a' AND d.message_id=? AND d.state='pending' AND g.kind='correction'", (reply,)), [(1,)])
        self.assertEqual(self.scoped(actor="agent-a")["items"][0]["dossier"]["unread"], 0)

    def test_an_unsent_reply_disappears_from_its_starred_dossier_count(self):
        root = self.root()
        self.participation("other-reader", True)
        reply = self.post("Not yet handed to anyone", actor="other-reader", reply_to=root)
        self.committed(self.command("message.unsend", {}, target={"message_id": reply}, actor="other-reader"))
        self.assertEqual((self.counted(root)["unread"], self.counted(root)["oldest_unread"]), (0, None))

    def test_unrelated_history_and_cancelled_rows_do_not_increase_scoped_view_work(self):
        root = self.root()
        reply = self.post("A single live reminder", reply_to=root)
        view = lambda: self.store.view("owner", "stars", {"topic_id": "t1"})
        short, short_steps = new_line_fixtures.NewLineCase.measured(self, view)
        new_line_fixtures.NewLineCase.bulk(self, 1000, "t1", "acknowledged")
        new_line_fixtures.NewLineCase.bulk(self, 1000, "t2", "pending", addressed=True)
        new_line_fixtures.NewLineCase.bulk(self, 1000, "t1", "pending", cancelled=True)
        long, long_steps = new_line_fixtures.NewLineCase.measured(self, view)
        self.assertEqual(long["items"][0]["dossier"]["oldest_unread"], self.at(reply))
        self.assertEqual(short["items"][0]["dossier"]["unread"], long["items"][0]["dossier"]["unread"])
        self.assertLess(long_steps, short_steps + 1000, (short_steps, long_steps))

    def test_scoped_candidate_queries_use_group_topic_and_reader_mark_indexes(self):
        root = self.root()
        reply = self.post("By subscription", reply_to=root)
        self.post("By name", reply_to=root, addressees=["owner"], intent="tell")
        self.mark(reply, True)
        original, statements = store_module._connect, []
        def connect(path, *args, **kwargs):
            db, settings = original(path, *args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, settings
        with mock.patch.object(store_module, "_connect", connect):
            self.assertEqual(self.counted(root)["unread"], 2)
        candidates = [q for q in statements if "pending_group_topic_deliveries" in q or "FROM message_marks k INDEXED BY reader_marks" in q]
        self.assertEqual(len(candidates), 3, candidates)
        with sqlite3.connect(str(self.path)) as db:
            for query in candidates:
                plan = " ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query))
                self.assertIn("SEARCH", plan)
                self.assertNotIn("SCAN ", plan)
                self.assertIn("pending_group_topic_deliveries" if "pending_group_topic_deliveries" in query else "reader_marks", plan)

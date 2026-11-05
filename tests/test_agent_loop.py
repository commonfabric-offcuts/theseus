from __future__ import annotations

"""Core acts of the everyday agent loop: post, read through, and deliveries that name their place."""

import json
import unittest

import reader_fixture as fixtures
import test_openings


class AgentLoopCase(fixtures.ReaderCase):
    media = test_openings.OpeningsCase.media

    def post(self, actor="agent-a", topic="t1", op=None, **args):
        args.setdefault("body", "Posted words")
        return self.command("message.post", args, target={"topic_id": topic}, actor=actor, op=op)

    def pending(self, actor):
        return self.sql("SELECT d.id,m.topic_id,m.seq FROM deliveries d JOIN messages m ON m.id=d.message_id "
                        "WHERE d.recipient_id=? AND d.state='pending' ORDER BY d.seq", (actor,))

    def consistent(self):
        # Group and schedule counters agree with the delivery rows they summarize.
        self.assertEqual(self.sql("SELECT g.id,g.pending_count,g.first_pending_seq FROM delivery_groups g WHERE g.active=1 ORDER BY g.id"),
                         self.sql("SELECT g.id,(SELECT count(*) FROM deliveries d WHERE d.group_id=g.id AND d.state='pending'),"
                                  "(SELECT min(seq) FROM deliveries d WHERE d.group_id=g.id AND d.state='pending') "
                                  "FROM delivery_groups g WHERE g.active=1 ORDER BY g.id"))
        self.assertEqual(self.sql("SELECT recipient_id,pending_count FROM recipient_schedule ORDER BY recipient_id"),
                         self.sql("SELECT s.recipient_id,(SELECT coalesce(sum(pending_count),0) FROM delivery_groups g "
                                  "WHERE g.recipient_id=s.recipient_id AND g.active=1) FROM recipient_schedule s ORDER BY s.recipient_id"))


class MessagePostCase(AgentLoopCase):
    def test_post_publishes_once_with_the_send_receipt_and_deliveries(self):
        self.participation("other-reader", True)
        receipt = self.post(body="Hello from the loop", addressees=["agent-b"], op="post-one")
        result = self.committed(receipt)
        self.assertEqual(set(result), {"message_id", "topic", "delivery"})
        self.assertEqual(result["topic"]["id"], "t1")
        self.assertEqual(result["delivery"], {"queued": 3, "unavailable_subscribers": []})
        message = self.source({"kind": "message", "id": result["message_id"]})
        self.assertEqual((message["author"], message["body"], message["addressees"]), ("agent-a", "Hello from the loop", ["agent-b"]))
        delivered = self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? ORDER BY recipient_id", (result["message_id"],))
        self.assertEqual(delivered, [("agent-b",), ("other-reader",), ("owner",)])
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"], result["topic"]["version"])
        before = self.records()
        self.assertEqual(self.post(body="Hello from the loop", addressees=["agent-b"], op="post-one"), receipt)
        self.assertEqual(self.records(), before)
        changed = self.post(body="Different words", addressees=["agent-b"], op="post-one")
        self.rejected(changed, "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.records(), before)

    def test_post_shares_the_publication_rules(self):
        first = self.committed(self.post(body="First"))["message_id"]
        reply = self.committed(self.post(actor="owner", body="Reply", reply_to=first,
                                         quotes=[{"source": {"kind": "message", "id": first}, "excerpt": "Fir"}]))
        self.assertEqual(self.source({"kind": "message", "id": reply["message_id"]})["reply_to"], first)
        before = self.public_state()
        for args, code in (({"addressees": ["outsider"]}, "REPLY_PATH_UNAVAILABLE"),
                           ({"body": "  "}, "EMPTY_MESSAGE"),
                           ({"quotes": [{"source": {"kind": "message", "id": first}, "excerpt": "Not there"}]}, "INVALID_QUOTE"),
                           ({"attachments": [self.media("unready", ready=False, actor="agent-a")]}, "ATTACHMENT_NOT_READY"),
                           ({"attachments": [self.media("owned-by-owner")]}, "FORBIDDEN")):
            with self.subTest(code=code):
                op = "refused-" + code
                receipt = self.post(op=op, **args)
                self.rejected(receipt, code)
                self.assertTrue(receipt["recorded"])
                self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": op}), receipt)
        self.assertEqual(self.public_state(), before)
        # A reply context outside the destination is a recorded refusal: the
        # same request can only be refused again.
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Elsewhere",
                                                     "participants": ["agent-a"], "body": "Elsewhere", "attachments": []},
                                    target={"opening_id": "o2"}, expected={"opening_revision": 0}))
        elsewhere = self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"},
                                                expected={"opening_revision": 1}))["message_id"]
        before = self.public_state()
        for parent in ("m-missing", elsewhere):
            with self.subTest(reply_to=parent):
                op = "reply-to-" + parent
                receipt = self.post(op=op, reply_to=parent)
                self.rejected(receipt, "INVALID_REPLY")
                self.assertTrue(receipt["recorded"])
                self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": op}), receipt)
        malformed = self.post(op="malformed-quote", quotes=["not a dict"])
        self.rejected(malformed, "INVALID_ARGUMENT")
        self.assertFalse(malformed["recorded"])
        self.assertEqual(self.public_state(), before)
        ready = self.media("ready-media", actor="agent-a")
        attached = self.committed(self.post(body="", attachments=[ready]))
        self.assertEqual(self.source({"kind": "message", "id": attached["message_id"]})["attachments"][0]["id"], "ready-media")
        outsider = self.post(actor="outsider")
        self.rejected(outsider, "FORBIDDEN")

    def test_post_shape_is_exact_and_unrecorded_when_malformed(self):
        for target, args in (({"topic_id": "t1"}, {}), ({"topic_id": "t1"}, {"body": "x", "exchange_id": "e"}),
                             ({"topic_id": "t1", "extra": 1}, {"body": "x"}), ({"topic_id": "t1"}, {"body": 7}),
                             ({"topic_id": "t1"}, {"body": "x", "addressees": "agent-b"}),
                             ({"topic_id": "t1"}, {"body": "x", "reply_to": {"id": "m"}})):
            with self.subTest(target=target, args=args):
                receipt = self.command("message.post", args, target=target, actor="agent-a", op="malformed")
                self.rejected(receipt, "INVALID_ARGUMENT")
                self.assertFalse(receipt["recorded"])
        self.assertEqual(self.sql("SELECT count(*) FROM operations WHERE id='malformed'"), [(0,)])


class ReadThroughCase(AgentLoopCase):
    def setUp(self):
        super().setUp()
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))
        # A second topic in the same outcome; agent-a takes part in both.
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Second",
                                                     "participants": ["agent-a"], "body": "Second opening", "attachments": []},
                                    target={"opening_id": "o2"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}))

    def through(self, seq, actor="agent-a", topic="t1", op=None, **args):
        return self.command("topic.read_through", dict(args, seq=seq), target={"topic_id": topic}, actor=actor, op=op)

    def test_read_through_settles_only_this_actors_earlier_work_in_this_topic(self):
        self.committed(self.post(actor="owner", body="Subscribed one"))
        self.committed(self.post(actor="agent-b", body="Addressed one", addressees=["agent-a"]))
        self.committed(self.post(actor="owner", topic="t2", body="Other topic, earlier sequence"))
        self.committed(self.post(actor="owner", topic="t2", body="Other topic addressed", addressees=["agent-a"]))
        cut = self.committed(self.post(actor="owner", body="Cut here"))["message_id"]
        cut_seq = self.sql("SELECT seq FROM messages WHERE id=?", (cut,))[0][0]
        self.committed(self.post(actor="agent-b", body="Later addressed", addressees=["agent-a"]))
        self.committed(self.post(actor="owner", body="Later"))
        others_before = self.pending("agent-b")
        mine = self.pending("agent-a")
        receipt = self.through(cut_seq, op="through-one")
        result = self.committed(receipt)
        expected = [row for row in mine if row[1] == "t1" and row[2] <= cut_seq]
        self.assertEqual(len(expected), 4, mine)  # opening, two subscribed, one addressed
        self.assertEqual(result, {"topic_id": "t1", "seq": cut_seq, "acknowledged": len(expected)})
        self.assertEqual(self.pending("agent-a"), [row for row in mine if row not in expected])
        self.assertEqual(self.pending("agent-b"), others_before)
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE id IN (%s)" % ",".join("?" * len(expected)),
                                  [row[0] for row in expected]), [("acknowledged",)] * len(expected))
        self.consistent()
        changed = self.sql("SELECT resource_id FROM changes WHERE scope_kind='actor' AND scope_id='agent-a' "
                           "AND resource_kind='delivery' AND version=2 ORDER BY seq")
        self.assertEqual(sorted(row[0] for row in changed), sorted(row[0] for row in expected))
        # Each delivery is now settled; the inbox shows only what remains.
        self.assertEqual(sorted(item["id"] for item in self.store.view("agent-a", "deliveries", {})["items"]),
                         sorted(row[0] for row in mine if row not in expected))
        before = self.records()
        self.assertEqual(self.through(cut_seq, op="through-one"), receipt)
        self.assertEqual(self.records(), before)
        again = self.committed(self.through(cut_seq))
        self.assertEqual(again["acknowledged"], 0)
        everything = self.committed(self.through(10 ** 9))
        self.assertEqual(everything["acknowledged"], 2)
        self.assertEqual([row[1] for row in self.pending("agent-a")], ["t2", "t2", "t2"])
        self.consistent()

    def test_read_through_refuses_without_access_and_malformed_input(self):
        self.committed(self.post(actor="owner", body="Pending"))
        operations = self.sql("SELECT count(*) FROM operations")[0][0]
        refused = self.through(10 ** 9, actor="outsider")
        self.rejected(refused, "FORBIDDEN")
        self.assertTrue(refused["recorded"])
        for target, args in (({"topic_id": "t1"}, {"seq": -1}), ({"topic_id": "t1"}, {"seq": True}),
                             ({"topic_id": "t1"}, {"seq": "3"}), ({"topic_id": "t1"}, {}),
                             ({"topic_id": "t1"}, {"seq": 1, "more": 1}), ({}, {"seq": 1})):
            with self.subTest(target=target, args=args):
                receipt = self.command("topic.read_through", args, target=target, actor="agent-a", op="bad-through")
                self.rejected(receipt, "INVALID_ARGUMENT")
                self.assertFalse(receipt["recorded"])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='acknowledged'"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM operations")[0][0], operations + 1)  # the outsider's recorded refusal

    def test_read_through_from_seq_leaves_earlier_work_pending(self):
        self.committed(self.post(actor="owner", body="Below the page"))
        self.committed(self.post(actor="agent-b", body="Addressed below the page", addressees=["agent-a"]))
        loaded = self.committed(self.post(actor="owner", body="First on the page"))["message_id"]
        self.committed(self.post(actor="agent-b", body="Addressed on the page", addressees=["agent-a"]))
        start = self.sql("SELECT seq FROM messages WHERE id=?", (loaded,))[0][0]
        mine = [row for row in self.pending("agent-a") if row[1] == "t1"]
        result = self.committed(self.through(10 ** 9, op="ranged", **{"from_seq": start}))
        self.assertEqual(result, {"topic_id": "t1", "seq": 10 ** 9, "from_seq": start, "acknowledged": 2})
        self.assertEqual([row for row in self.pending("agent-a") if row[1] == "t1"], [row for row in mine if row[2] < start])
        self.assertEqual(len([row for row in mine if row[2] < start]), 3)  # opening, subscribed and addressed below
        self.consistent()
        for seq, start in ((3, 4), (3, -1), (3, True)):
            with self.subTest(seq=seq, from_seq=start):
                receipt = self.through(seq, op="bad-range", from_seq=start)
                self.rejected(receipt, "INVALID_ARGUMENT")
                self.assertFalse(receipt["recorded"])

    def test_cancelled_subscription_is_not_settled_by_read_through(self):
        self.committed(self.post(actor="owner", body="Before leaving"))
        self.participation("agent-a", False)
        self.participation("agent-a", True)
        self.committed(self.post(actor="owner", body="After rejoining"))
        result = self.committed(self.through(10 ** 9))
        self.assertEqual(result["acknowledged"], 1)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                                  "WHERE d.recipient_id='agent-a' AND d.state='pending' AND g.active=0"), [(2,)])
        self.consistent()


class DeliveryNoticeCase(AgentLoopCase):
    def test_deliveries_name_the_message_sequence_and_topic_title(self):
        posted = self.committed(self.post(actor="owner", body="Notice me"))["message_id"]
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (posted,))[0][0]
        items = self.store.view("agent-a", "deliveries", {})["items"]
        item = [entry for entry in items if entry["message_id"] == posted][0]
        self.assertEqual(item["message"]["seq"], seq)
        self.assertEqual(item["topic"], {"id": "t1", "title": "Topic", "title_truncated": False})
        self.assertEqual(self.store.view("agent-a", "delivery", {"delivery_id": item["id"]}),
                         {"instance_id": "test-instance", "item": item})
        self.rejected(self.store.view("agent-b", "delivery", {"delivery_id": item["id"]}), "FORBIDDEN")
        self.rejected(self.store.view("agent-a", "delivery", {"delivery_id": "d-missing"}), "FORBIDDEN")

    def test_delivery_view_is_readable_only_while_its_message_is(self):
        self.participation("other-reader", True)
        secret = self.committed(self.post(actor="owner", body="Secret plan for the team"))["message_id"]
        direct = self.committed(self.post(actor="owner", body="For you alone", addressees=["other-reader"]))["message_id"]
        reader = dict(self.sql("SELECT message_id,id FROM deliveries WHERE recipient_id='other-reader'"))
        member = dict(self.sql("SELECT message_id,id FROM deliveries WHERE recipient_id='agent-a'"))[secret]
        self.assertEqual(self.store.view("other-reader", "delivery", {"delivery_id": reader[secret]})["item"]["state"], "pending")
        # other-reader takes part in t1 without being a member of w1; agent-a is a member.
        self.participation("other-reader", False)
        self.participation("agent-a", False)
        self.rejected(self.store.view("other-reader", "source", {"source_ref": {"kind": "message", "id": secret}}), "FORBIDDEN")
        refused = self.store.view("other-reader", "delivery", {"delivery_id": reader[secret]})
        self.rejected(refused, "FORBIDDEN")
        self.assertNotIn("Secret plan", json.dumps(refused))
        self.assertNotIn("Topic", json.dumps(refused))
        # An addressed delivery keeps exactly its own message readable.
        kept = self.store.view("other-reader", "delivery", {"delivery_id": reader[direct]})["item"]
        self.assertEqual((kept["message"]["body"], kept["state"], kept["reasons"]), ("For you alone", "pending", ["addressed"]))
        # A member still reads the topic, but a cancelled subscription is never pending again.
        item = self.store.view("agent-a", "delivery", {"delivery_id": member})["item"]
        self.assertEqual((item["message"]["body"], item["state"]), ("Secret plan for the team", "cancelled"))
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE id=?", (member,)), [("pending",)])

    def test_long_titles_are_cut_to_a_bounded_prefix(self):
        title = "é" * 600
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-long", "title": title,
                                                     "participants": ["agent-a"], "body": "Long title", "attachments": []},
                                    target={"opening_id": "o-long"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o-long"}, expected={"opening_revision": 1}))
        item = [entry for entry in self.store.view("agent-a", "deliveries", {})["items"] if entry["message"]["topic_id"] == "t-long"][0]
        self.assertEqual(item["topic"]["title"], "é" * 512)
        self.assertTrue(item["topic"]["title_truncated"])

    def test_workspace_topics_carry_latest_activity(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t0", "title": "Quiet",
                                                     "participants": [], "body": "Quiet start", "attachments": []},
                                    target={"opening_id": "o0"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o0"}, expected={"opening_revision": 1}))
        latest = self.committed(self.post(body="Newest in t1"))["message_id"]
        items = {item["id"]: item for item in self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"]}
        self.assertEqual(items["t1"]["latest_seq"], self.sql("SELECT seq FROM messages WHERE id=?", (latest,))[0][0])
        self.assertEqual(items["t1"]["message_count"], 2)
        self.assertEqual(items["t0"]["message_count"], 1)
        self.assertLess(items["t0"]["latest_seq"], items["t1"]["latest_seq"])


if __name__ == "__main__":
    unittest.main()

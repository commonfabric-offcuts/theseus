from __future__ import annotations

import unittest

from reader_fixture import ReaderCase


class ReaderSteppingCase(ReaderCase):
    def page(self, actor="owner", **args):
        result = self.store.view(actor, "topic_messages", dict(topic_id="t1", **args))
        self.assertNotIn("error", result, result)
        return result

    def test_reader_means_explicit_current_caller_or_unaddressed_in_both_directions(self):
        rows = [self.send("Nobody", []), self.send("Other human", ["other-reader"]),
                self.send("Agents", ["agent-a"]), self.send("Current reader", ["owner"]),
                self.send("Current plus other", ["owner", "other-reader"])]
        after = self.page(audience="reader", direction="after", cursor=rows[0]["seq"] - 1)
        wanted = [rows[index]["id"] for index in (0, 3, 4)]
        self.assertEqual([item["id"] for item in after["items"]], wanted)
        before = self.page(audience="reader", direction="before", cursor=rows[-1]["seq"] + 1)
        self.assertEqual([item["id"] for item in before["items"] if item["seq"] >= rows[0]["seq"]], wanted)
        all_rows = self.page(cursor=rows[0]["seq"] - 1)
        self.assertEqual([item["id"] for item in all_rows["items"]], [row["id"] for row in rows])
        self.assertEqual(all_rows["items"][1]["addressees"], ["other-reader"])

    def test_direct_open_seq_finds_nearest_neighbor_and_before_cursor_traverses_backwards(self):
        rows = [self.send("row %s" % index) for index in range(5)]
        middle = self.source({"kind": "message", "id": rows[2]["id"]})
        self.assertIn("seq", middle, "Direct-open message sources need their stored sequence")
        self.assertEqual(middle["seq"], rows[2]["seq"])
        for direction, expected in (("before", rows[1]), ("after", rows[3])):
            page = self.page(audience="reader", direction=direction, cursor=middle["seq"], limit=1)
            self.assertEqual([item["id"] for item in page["items"]], [expected["id"]])
        page = self.page(audience="reader", direction="before", limit=2)
        self.assertEqual([item["id"] for item in page["items"]], [row["id"] for row in rows[-2:]])
        self.assertEqual(page["next_cursor"], rows[-2]["seq"])
        older = self.page(audience="reader", direction="before", cursor=page["next_cursor"], limit=2)
        self.assertEqual([item["id"] for item in older["items"]], [row["id"] for row in rows[1:3]])
        self.assertFalse(set(item["id"] for item in page["items"]) & set(item["id"] for item in older["items"]))

    def test_caller_identity_is_not_inferred_from_kind_body_quote_or_subscription(self):
        plain = self.send("owner and agent-a are just words")
        other = self.send("Explicit agent", ["agent-a"])
        quoted = self.send("Body says owner", ["other-reader"], quotes=[{
            "source": {"kind": "message", "id": plain["id"]}, "excerpt": "owner"}])
        current = self.page(audience="reader", cursor=plain["seq"] - 1)
        self.assertEqual([item["id"] for item in current["items"]], [plain["id"]])
        agent = self.page(actor="agent-a", audience="reader", cursor=plain["seq"] - 1)
        self.assertEqual([item["id"] for item in agent["items"]], [plain["id"], other["id"]])
        self.assertNotIn(quoted["id"], [item["id"] for item in agent["items"]])
        self.assertIn("error", self.store.view("owner", "topic_messages", {
            "topic_id": "t1", "audience": "reader", "actor_id": "agent-a"}))

    def test_duplicate_send_does_not_duplicate_navigation_or_change_read_state(self):
        sent = self.send("One indexed entry", ["owner"])
        again = self.command("message.send", {"submission_id": sent["submission"]},
                             target={"topic_id": "t1"}, op=sent["receipt"]["operation_id"])
        self.assertEqual(again, sent["receipt"])
        before = self.records()
        page = self.page(audience="reader", cursor=sent["seq"] - 1)
        self.assertEqual([item["id"] for item in page["items"]], [sent["id"]])
        self.assertIsNone(page["next_cursor"])
        self.assertEqual(self.records(), before)

    def test_filter_does_not_grant_topic_access_and_invalid_modes_refuse(self):
        sent = self.send("Only delivered source", ["outsider"])
        self.assertEqual(self.source({"kind": "message", "id": sent["id"]}, actor="outsider")["body"], "Only delivered source")
        result = self.store.view("outsider", "topic_messages", {"topic_id": "t1", "audience": "reader"})
        self.rejected(result, "FORBIDDEN")
        for args in ({"audience": "human"}, {"direction": "next"}, {"cursor": True}, {"limit": 101}):
            with self.subTest(args=args):
                result = self.store.view("owner", "topic_messages", dict(topic_id="t1", **args))
                self.rejected(result, "INVALID_ARGUMENT")


del ReaderCase

if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""What an agent is handed of a person's message, and what it is not (item 452, docs/message-edit.md, slice 2).

Group 1: while M's author has it open in Edit, every agent view leaves M's words out (withheld) and no read records M.
Group 7: an edit corrects exactly the agents that were handed the old words: the boundary records each message whose
words left the store in an agent's answer, at the revision they were, and nothing else. M, D and the runner are
test_message_hold's: owner's ask "Deploy at 5" to agent-a in t1, and agent-a's delivery of it.
"""

import io
import json
import unittest

from aim_next.contract import Refusal
from aim_next.contract import LIMITS
from unittest import mock
import test_blocking_asks
import test_message_edit
import test_message_hold
import test_targets
import test_topic_images


class HeldTopicCase(test_message_hold.HoldCase):
    """Group 1(a): the topic t1."""

    ready = test_topic_images.TopicImagesCase.ready

    def exposures(self, message=None):
        return self.sql("SELECT actor_id,message_id,revision FROM message_exposures" + (" WHERE message_id=?" if message else "") + " ORDER BY actor_id,message_id",
                        (message,) if message else ())

    def commit_seq(self):
        return int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])

    def world(self):
        """M with its inline image, starred by agent-a; R, owner's reply to M; the rest acked, keeping D and R's delivery."""
        self.ready("png-m", "one.png")
        self.m = self.post("Deploy at 5", addressees=["agent-a"], intent="ask", attachments=[{"id": "png-m"}])
        self.d = self.delivery("agent-a", self.m)
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": self.m}, expected={"star_revision": 0}, actor="agent-a"))
        self.r = self.post("Which timezone?", reply_to=self.m)
        self.rd = self.delivery("agent-a", self.r)
        self.ack_the_rest(keep=(self.d, self.rd))
        self.member("other-reader", True)

    def topic_items(self, actor, **form):
        page = self.store.view(actor, "topic_messages", dict({"topic_id": "t1"}, **form))
        self.assertNotIn("error", page, page)
        return {item["id"]: item for item in page["items"]}

    def no_record_of_m(self):
        self.assertEqual(self.exposures(self.m), [], "no read recorded the held message")

    def test_every_agent_view_withholds_m_and_no_read_records_it(self):
        self.world()
        self.open()
        for actor in ("agent-a", "agent-b"):
            for form in ({}, {"message_ids": [self.m]}):
                with self.subTest(actor=actor, form=form):
                    items = self.topic_items(actor, **form)
                    m = items[self.m]
                    self.assertEqual((m["withheld"], m["body"], m["preview"], m["attachments"]), (True, "", False, []))
                    self.assertEqual(m["seq"], self.sql("SELECT seq FROM messages WHERE id=?", (self.m,))[0][0])
                    if self.r in items:
                        r = items[self.r]
                        self.assertEqual((r["reply_to_excerpt"], r["reply_to_withheld"], r["reply_to_author"], r["withheld"]), (None, True, "owner", False))
                    for other in items.values():
                        if other["id"] not in (self.m, self.r):
                            self.assertEqual((other["withheld"], other["reply_to_withheld"]), (False, False))
                    self.no_record_of_m()
        reader = self.topic_items("agent-a", audience="reader")[self.m]
        self.assertEqual((reader["withheld"], reader["body"]), (True, ""))
        self.assertNotIn(self.m, self.topic_items("agent-b", audience="reader"), "addressed to agent-a")
        for actor in ("agent-a", "agent-b"):
            with self.subTest(actor=actor, view="source"):
                before = self.commit_seq()
                held = self.saw(actor)
                self.assertEqual((held["withheld"], held["body"], held["attachments"], held["quotes"]), (True, "", [], []))
                self.assertEqual(self.commit_seq(), before, "it handed nothing")
                self.no_record_of_m()
        self.assertNotIn(self.d, [item["id"] for item in self.listed("agent-a")])
        self.assertIn(self.rd, [item["id"] for item in self.listed("agent-a")])
        before = self.commit_seq()
        self.assertEqual(self.store.view("agent-a", "delivery", {"delivery_id": self.d}).get("error", {}).get("code"), "MESSAGE_HELD")
        self.assertEqual(self.commit_seq(), before)
        self.assertNotIn(self.d, [item["id"] for item in self.store.view("agent-a", "attention", {})["latest_addressed"]])
        [star] = [item for item in self.store.view("agent-a", "stars", {})["items"] if item["message_id"] == self.m]
        self.assertEqual((star["excerpt"], star["withheld"]), ("", True))
        self.assertNotIn("png-m", [item["attachment"]["id"] for item in self.store.view("agent-a", "topic_images", {"topic_id": "t1"})["items"]])
        ref = {"kind": "message", "id": self.m}
        self.assertEqual(self.store.view("agent-a", "media", {"media_id": "png-m", "source_ref": ref}).get("error", {}).get("code"), "MESSAGE_HELD")
        with self.assertRaises(Refusal) as refused:
            self.store.open_media("agent-a", {"media_id": "png-m", "source_ref": ref})
        self.assertEqual(refused.exception.code, "MESSAGE_HELD")
        self.no_record_of_m()
        [claim] = self.claims()["claims"]
        text = self.notice(claim)
        self.assertIn(self.rd, text)
        self.assertNotIn(self.d, text)
        self.no_record_of_m()

    def test_with_r_acked_too_nothing_is_claimed_or_noticed(self):
        self.world()
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": self.rd}, actor="agent-a"))
        self.open()
        attempts = self.attempts()
        self.assertEqual(self.claims()["claims"], [])
        self.assertEqual(self.attempts(), attempts)
        self.assertIsNone(test_message_hold.hosted_notice.notice(self.listed("agent-a"), None, "agent-a", "attempt-1"))

    def test_a_person_reads_every_view_with_the_words(self):
        self.world()
        self.open()
        for form in ({}, {"message_ids": [self.m]}):
            items = self.topic_items("other-reader", **form)
            self.assertEqual((items[self.m]["withheld"], items[self.m]["body"], len(items[self.m]["attachments"])), (False, "Deploy at 5", 1))
            if self.r in items:
                self.assertEqual((items[self.r]["reply_to_excerpt"], items[self.r]["reply_to_withheld"]), ("Deploy at 5", False))
        source = self.saw("other-reader")
        self.assertEqual((source["withheld"], source["body"]), (False, "Deploy at 5"))
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": self.m}, expected={"star_revision": 0}, actor="other-reader"))
        [star] = [item for item in self.store.view("other-reader", "stars", {})["items"] if item["message_id"] == self.m]
        self.assertEqual((star["excerpt"], star["withheld"]), ("Deploy at 5", False))
        self.assertIn("png-m", [item["attachment"]["id"] for item in self.store.view("other-reader", "topic_images", {"topic_id": "t1"})["items"]])
        self.assertNotIn("error", self.store.view("other-reader", "media", {"media_id": "png-m", "source_ref": {"kind": "message", "id": self.m}}))
        self.assertEqual(self.exposures(), [], "a person's read records nothing")

    def test_before_the_open_an_agents_read_records_what_it_was_handed(self):
        self.world()
        before = self.commit_seq()
        self.assertEqual(self.saw("agent-b")["body"], "Deploy at 5")
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)])
        self.assertEqual(self.commit_seq(), before + 1)
        self.assertEqual(self.saw("agent-b")["body"], "Deploy at 5")
        self.assertEqual(self.commit_seq(), before + 1, "read again, nothing grows and nothing is written")


class HandedCase(test_message_hold.HoldCase):
    """Group 7 on EditCase: exactly the agents handed the words are corrected."""

    exposures, commit_seq = HeldTopicCase.exposures, HeldTopicCase.commit_seq

    def corrected(self, agent, message=None):
        return [row[2] for row in self.corrections(agent, message or self.m) if row[3] in ("pending", "held")]

    def test_an_agents_read_of_another_agents_message_is_recorded_and_of_its_own_writes_nothing(self):
        # An agent edits its own words (item 614), so another agent's read of them is recorded, in one write, as a
        # read of a person's words is; its read of its own words records nothing and writes nothing.
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1"})
        theirs = self.post("Agent words on the plan", actor="agent-a")
        before = self.commit_seq()
        self.assertEqual(self.saw("agent-b", theirs)["body"], "Agent words on the plan")
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1"})
        self.assertEqual((self.exposures(theirs), self.commit_seq()), ([("agent-b", theirs, 1)], before + 1), "one record, one write")
        before = self.commit_seq()
        self.saw("agent-a", theirs)
        self.assertEqual((self.exposures(theirs), self.commit_seq()), ([("agent-b", theirs, 1)], before), "its own read: nothing")
        # A person's message, read the same way, is recorded, in one write.
        mine = self.post("Owner words on the plan")
        before = self.commit_seq()
        self.saw("agent-b", mine)
        self.assertEqual((self.exposures(mine), self.commit_seq()), ([("agent-b", mine, 1)], before + 1))

    def test_a_long_quote_counts_by_its_first_lines_head_in_a_reply_line(self):
        # The reply line holds 120 characters: the quote's whole excerpt is not in it, but its first line's head is.
        first = "Ship the cache change on Thursday after the p95 check"
        excerpt = first + "\nThen tell the on-call rota and update the runbook with the new limits and owners."
        m = self.post(excerpt)
        m2 = self.post(excerpt + "\n\nAgreed.", quotes=[{"source": {"kind": "message", "id": m, "revision": 1}, "excerpt": excerpt}])
        reply = self.post("On it", reply_to=m2)
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [reply]})
        self.assertEqual(self.exposures(m), [("agent-b", m, 1)], "the reply line holds the quote's first-line head")
        # A quote whose first line is not in the line counts for nothing.
        other = self.post("Something else entirely")
        m3 = self.post("Unrelated words " * 10, quotes=[{"source": {"kind": "message", "id": other, "revision": 1}, "excerpt": "Something else entirely"}])
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [self.post("Noted", reply_to=m3)]})
        self.assertEqual(self.exposures(other), [])

    def test_a_never_handed_agent_gets_no_correction_and_reads_the_new_words(self):
        self.ask_m()
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrected("agent-b"), [])
        self.assertEqual(self.corrected("agent-a"), [], "sent, never read")
        self.assertEqual(self.saw("agent-b")["body"], "Deploy at 6")

    def test_a_preview_or_the_hosted_notice_hands_the_words(self):
        for way in ("deliveries", "notice"):
            with self.subTest(way=way):
                self.ask_m("Deploy at 5 via %s" % way)
                if way == "deliveries":
                    self.listed("agent-a")
                else:
                    [claim] = self.claims()["claims"]
                    self.assertIn(self.d, self.notice(claim))
                    self.hand(claim, turn="turn-%s" % way)
                    self.end_turn(turn="turn-%s" % way)
                self.assertEqual(self.exposures(self.m), [("agent-a", self.m, 1)])
                self.committed(self.save("Deploy at 6 via %s" % way, holder=None))
                self.assertEqual(self.corrected("agent-a"), [2])

    def test_stored_quotes_record_their_source(self):
        self.ask_m()
        quote = [{"source": {"kind": "message", "id": self.m, "revision": 1}, "excerpt": "Deploy at 5"}]
        m2 = self.post("Agreed: Deploy at 5", quotes=quote)
        m3 = self.post("Agreed.", quotes=quote)
        self.saw("agent-b", m2)
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)], "the quote's marker")
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrected("agent-b"), [2])

    def test_a_quote_in_a_message_that_does_not_hold_its_head_records_nothing_on_the_page(self):
        self.ask_m()
        quote = [{"source": {"kind": "message", "id": self.m, "revision": 1}, "excerpt": "Deploy at 5"}]
        m3 = self.post("Agreed.", quotes=quote)
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [m3]})
        self.assertEqual(self.exposures(self.m), [], "M3's words do not hold the quote")
        self.saw("agent-b", m3)
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)], "its source carries the quote itself")
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrected("agent-b"), [2])

    def test_a_topic_page_with_the_quoting_message_records_the_quote(self):
        self.ask_m()
        quote = [{"source": {"kind": "message", "id": self.m, "revision": 1}, "excerpt": "Deploy at 5"}]
        m2 = self.post("Agreed: Deploy at 5", quotes=quote)
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [m2]})
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)], "M2's fragment holds the quote's head")

    def test_a_held_quote_source_is_withheld_in_the_quote_and_recorded_after(self):
        self.ask_m()
        quote = [{"source": {"kind": "message", "id": self.m, "revision": 1}, "excerpt": "Deploy at 5"}]
        m3 = self.post("Agreed.", quotes=quote)
        self.open()
        held = self.saw("agent-b", m3)
        self.assertEqual([(q["excerpt"], q.get("withheld")) for q in held["quotes"]], [("", True)])
        self.assertEqual(self.exposures(self.m), [])
        self.committed(self.save("Deploy at 6"))
        after = self.saw("agent-b", m3)
        self.assertEqual([(q["excerpt"], "withheld" in q) for q in after["quotes"]], [("Deploy at 5", False)])
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)])

    def test_reply_lines_record_only_what_the_line_reaches(self):
        self.ask_m()
        quote = [{"source": {"kind": "message", "id": self.m, "revision": 1}, "excerpt": "Deploy at 5"}]
        m4 = self.post("q" * 130 + "\n> Deploy at 5", quotes=quote)
        m2 = self.post("Agreed: Deploy at 5", quotes=quote)
        reply4 = self.post("Replying to the long one", reply_to=m4)
        reply2 = self.post("Replying to the short one", reply_to=m2)
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [reply4]})
        self.assertIn(("agent-b", m4, 1), self.exposures())
        self.assertEqual(self.exposures(self.m), [], "the 120-character line does not reach the quote")
        self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [reply2]})
        self.assertIn(("agent-b", m2, 1), self.exposures())
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)])

    def test_a_topic_started_from_m_hands_its_words(self):
        self.ask_m()
        writing = {"workspace_id": "w1", "topic_id": "t-from-m", "title": "From M", "participants": [], "body": "", "attachments": [],
                   "source_message_id": self.m}
        self.committed(self.command("opening.save", writing, {"opening_id": "o-m"}, {"opening_revision": 0}))
        published = self.committed(self.command("opening.publish", {}, {"opening_id": "o-m"}, {"opening_revision": 1}))
        self.assertEqual(self.exposures(self.m), [])
        self.saw("agent-b", published["message_id"])
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 1)], "its first message quotes M")
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrected("agent-b"), [2])

    def test_handed_twice_is_one_correction_and_a_second_edit_settles_the_first(self):
        self.ask_m()
        self.store.view("agent-a", "topic_messages", {"topic_id": "t1"})
        self.listed("agent-a")
        self.assertEqual(self.exposures(self.m), [("agent-a", self.m, 1)])
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrected("agent-a"), [2])
        self.committed(self.save("Deploy at 7", revision=2, holder=None))
        self.assertEqual([row[2:] for row in self.corrections("agent-a", self.m)], [(2, "acknowledged"), (3, "pending")])

    def test_an_exposed_agent_removed_before_the_edit_gets_none(self):
        self.ask_m()
        self.saw("agent-b")
        self.member("agent-b", False)
        self.committed(self.save("Deploy at 6", holder=None))
        self.assertEqual(self.corrections("agent-b"), [])

    def test_a_message_at_or_below_the_horizon_corrects_every_agent_reader(self):
        self.ask_m()
        self.sql("UPDATE message_edit_horizon SET seq=(SELECT max(seq) FROM messages)")
        later = self.post("After the upgrade")
        # A person among the readers counts as handed too, and is never sent a correction.
        self.member("other-reader", True)
        self.assertEqual(self.committed(self.save("Deploy at 6", holder=None))["corrections"], 2)
        self.assertEqual((self.corrected("agent-a"), self.corrected("agent-b")), ([2], [2]))
        self.assertEqual(self.corrections("other-reader"), [], "people are never corrected")
        self.committed(self.command("message.edit", {"body": "After the upgrade, fixed"}, target={"message_id": later}, expected={"message_revision": 1}))
        self.assertEqual(self.corrections(message=later), [], "a message above it needs a read")

    def test_horizon_revision_1_reads_record_nothing_but_a_later_revision_does(self):
        self.ask_m()
        self.sql("UPDATE message_edit_horizon SET seq=(SELECT max(seq) FROM messages)")
        before = self.commit_seq()
        self.saw("agent-b")
        self.assertEqual((self.exposures(self.m), self.commit_seq()), ([], before), "revision 1 at or below the horizon counts as handed")
        self.committed(self.save("Deploy at 6", holder=None))
        self.saw("agent-b")
        self.assertEqual(self.exposures(self.m), [("agent-b", self.m, 2)])

    def test_a_deliveries_page_that_drops_an_item_records_only_what_it_returned(self):
        first = self.post("First thing for agent-a, " + "f" * 600, addressees=["agent-a"], intent="tell")
        second = self.post("Second thing for agent-a, " + "s" * 600, addressees=["agent-a"], intent="tell")
        self.ack_the_rest(keep=(self.delivery("agent-a", first), self.delivery("agent-a", second)))
        listed = self.listed("agent-a")
        self.assertEqual(len(listed), 2)
        # A limit that one item fits and two do not (as tests/test_delivery.py:102 lowers it).
        budget = len(json.dumps(self.store.view("agent-a", "deliveries", {"limit": 1}), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 40
        other = self.post("Third, for agent-b, " + "t" * 600, addressees=["agent-b"], intent="tell")
        another = self.post("Fourth, for agent-b, " + "u" * 600, addressees=["agent-b"], intent="tell")
        self.ack_the_rest("agent-b", keep=(self.delivery("agent-b", other), self.delivery("agent-b", another)))
        with mock.patch.dict(LIMITS, {"summary_utf8_bytes": budget}):
            page = self.store.view("agent-b", "deliveries", {})
        self.assertEqual([item["message_id"] for item in page["items"]], [other], page)
        self.assertEqual((self.exposures(other), self.exposures(another)), ([("agent-b", other, 1)], []))
        for message, body in ((other, "Third, fixed"), (another, "Fourth, fixed")):
            self.committed(self.command("message.edit", {"body": body}, target={"message_id": message}, expected={"message_revision": 1}))
        self.assertEqual((self.corrected("agent-b", other), self.corrected("agent-b", another)), ([2], []))

    def test_pipeline_row_counts_an_ask_and_hands_nothing(self):
        self.ask_m()
        self.store.view("agent-a", "pipeline_row", {"workspace_id": "w1"})
        self.assertEqual(self.exposures(self.m), [])

    def test_identity_not_text(self):
        a = self.post("Yes", addressees=["agent-b"], intent="tell")
        r = self.post("Sure", addressees=["agent-b"], intent="tell", reply_to=a)
        c = self.post("Noted", addressees=["agent-b"], intent="tell")
        b = self.post("Yes", addressees=["agent-b"], intent="tell")
        page = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 2, "direction": "before"})
        self.assertEqual([item["id"] for item in page["items"]], [c, b])
        recorded = {row[1] for row in self.exposures() if row[0] == "agent-b"}
        self.assertEqual((b in recorded, c in recorded, a in recorded, r in recorded), (True, True, False, False))
        self.committed(self.command("message.edit", {"body": "Yes, fixed"}, target={"message_id": a}, expected={"message_revision": 1}))
        self.assertEqual(self.corrections("agent-b", a), [], "A's words equal B's, and A was never handed")
        self.committed(self.command("message.edit", {"body": "Yes, B fixed"}, target={"message_id": b}, expected={"message_revision": 1}))
        self.assertEqual(self.corrected("agent-b", b), [2])

    def test_identity_not_text_negatives(self):
        a = self.post("Yes", addressees=["agent-b"], intent="tell")
        r = self.post("Sure", addressees=["agent-b"], intent="tell", reply_to=a)
        c = self.post("Noted", addressees=["agent-b"], intent="tell")
        b = self.post("Yes", addressees=["agent-b"], intent="tell")
        page = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 3, "direction": "before"})
        self.assertEqual([item["id"] for item in page["items"]], [r, c, b])
        self.assertIn(("agent-b", a, 1), self.exposures(a), "A through R's reply line")
        self.committed(self.command("message.edit", {"body": "Yes, fixed"}, target={"message_id": a}, expected={"message_revision": 1}))
        self.assertEqual(self.corrected("agent-b", a), [2])
        page = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 5, "direction": "before"})
        self.assertTrue({a, r, c, b} <= {item["id"] for item in page["items"]})
        self.assertTrue({a, r, c, b} <= {row[1] for row in self.exposures() if row[0] == "agent-b"})


class HeldOutcomeCase(test_blocking_asks.BlockingCase):
    """Groups 1(b), 1(c) and 7(c): an ask in the outcome's conversation, and a check ask, with the views that show
    them in a line."""

    define = test_targets.TargetCase.define
    member = test_message_edit.EditCase.member

    def world(self):
        self.piece = self.committed(self.start())["piece_id"]
        self.conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        self.mc = self.asked("Hold the piece until the schema lands", blocks={"kind": "piece", "ref": self.piece}, to=("agent-a",), actor="owner",
                             topic=self.conversation, subjects=[{"kind": "item", "ref": 1}])
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": self.mc}, expected={"star_revision": 0}, actor="agent-a"))
        self.member("other-reader", True)
        self.topic("t2")
        # Mi asks about item 2 in t2 (a topic waits on one ask per reader) and holds nothing, so only the pipeline's asks show it.
        self.mi = self.asked("Is item two still small?", to=("agent-a",), actor="owner", topic="t2", subjects=[{"kind": "item", "ref": 2}])
        self.committed(self.define(test_targets.UNITS))
        self.mk = self.asked("Measure p95 after the cache change", to=("owner",), actor="other-reader", topic="t2",
                             subjects=[{"kind": "check", "ref": "units"}])
        # Nothing is pending, so no preview or notice hands either ask: only the view under test does.
        for delivery, recipient in self.sql("SELECT id,recipient_id FROM deliveries WHERE recipient_id IN ('agent-a','agent-b') AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": delivery}, actor=recipient))

    def edit_open(self, message, actor="owner"):
        return self.committed(self.command("message.edit_open", {"holder": "h-laptop"}, {"message_id": message}, actor=actor))

    def exposures(self, message):
        return self.sql("SELECT actor_id,revision FROM message_exposures WHERE message_id=? ORDER BY actor_id", (message,))

    def view(self, actor, name, args):
        answer = self.store.view(actor, name, args)
        self.assertNotIn("error", answer, answer)
        return answer

    def wait_of(self, actor):
        [wait] = [item for item in self.view(actor, "conversation", {"workspace_id": "w1"})["conversation"]["waits"] if item["ask_message_id"] == self.mc]
        return wait["excerpt"], wait["withheld"]

    def blocking_of(self, actor):
        [item] = [item for item in self.view(actor, "attention", {})["blocking"] if item["message_id"] == self.mc]
        return item["line"], item["withheld"]

    def held_line_of(self, actor):
        now = self.view(actor, "pipeline", {"workspace_id": "w1", "section": "now"})
        [found] = [p for p in now["pieces"] + ([now["release_piece"]] if now["release_piece"] else []) if p["id"] == self.piece]
        [held] = [held for held in found["held"] if held["message_id"] == self.mc]
        return held["line"], held["withheld"]

    def item_ask_of(self, actor, which="mc"):
        now = self.view(actor, "pipeline", {"workspace_id": "w1", "section": "now"})
        asks = [ask for item in now["items"] for ask in item.get("asks", []) if ask["message_id"] == getattr(self, which)]
        self.assertEqual(len(asks), 1, now)
        return asks[0]["excerpt"], asks[0]["withheld"]

    def star_of(self, actor):
        [star] = [item for item in self.view(actor, "stars", {})["items"] if item["message_id"] == self.mc]
        return star["excerpt"], star["withheld"]

    def check_ask_of(self, actor, name):
        answer = self.view(actor, name, {"workspace_id": "w1"})
        checks = answer["checks"] if name == "check_readings" else [check for group in answer["groups"] for check in group["checks"]]
        [check] = [check for check in checks if check["check_id"] == "units"]
        return check["waiting"]["excerpt"], check["waiting"]["withheld"]

    def open_item_of(self, actor):
        page = self.view(actor, "topic_messages", {"topic_id": self.conversation, "items": "open"})
        [item] = [item for item in page["items"] if item["id"] == self.mc]
        return item["body"], item["withheld"]

    def test_held_asks_are_withheld_in_every_line_and_recorded_nowhere(self):
        self.world()
        self.edit_open(self.mc)
        self.committed(self.command("message.edit_open", {"holder": "h-desk"}, {"message_id": self.mk}, actor="other-reader"))
        self.edit_open(self.mi)
        for read in (lambda: self.open_item_of("agent-a"), lambda: self.wait_of("agent-a"), lambda: self.item_ask_of("agent-a"),
                     lambda: self.item_ask_of("agent-a", "mi"), lambda: self.star_of("agent-a"),
                     lambda: self.blocking_of("agent-a"), lambda: self.held_line_of("agent-a"), lambda: self.held_line_of("agent-b"),
                     lambda: self.check_ask_of("agent-a", "outcome_checks"), lambda: self.check_ask_of("agent-a", "check_readings")):
            self.assertEqual(read(), ("", True))
            self.assertEqual((self.exposures(self.mc), self.exposures(self.mk), self.exposures(self.mi)), ([], [], []))
        light = self.view("agent-a", "outcome_light", {"workspace_id": "w1"})
        self.assertNotIn("Hold the piece", json.dumps(light))

    def test_a_person_reads_every_line_with_its_words(self):
        self.world()
        self.edit_open(self.mc)
        self.committed(self.command("message.edit_open", {"holder": "h-desk"}, {"message_id": self.mk}, actor="other-reader"))
        self.assertEqual(self.held_line_of("other-reader"), ("Hold the piece until the schema lands", False))
        self.assertEqual(self.open_item_of("other-reader"), ("Hold the piece until the schema lands", False))
        self.assertEqual(self.wait_of("other-reader")[1], False)
        self.assertEqual(self.check_ask_of("owner", "outcome_checks"), ("Measure p95 after the cache change", False))

    def producers(self):
        return {"conversation waits": ("agent-a", lambda: self.wait_of("agent-a"), "mc"),
                "pipeline asks": ("agent-a", lambda: self.item_ask_of("agent-a", "mi"), "mi"),
                "stars": ("agent-a", lambda: self.star_of("agent-a"), "mc"),
                "attention blocking": ("agent-a", lambda: self.blocking_of("agent-a"), "mc"),
                "held line": ("agent-b", lambda: self.held_line_of("agent-b"), "mc"),
                "check asks (outcome_checks)": ("agent-a", lambda: self.check_ask_of("agent-a", "outcome_checks"), "mk"),
                "check asks (check_readings)": ("agent-a", lambda: self.check_ask_of("agent-a", "check_readings"), "mk")}

    def hands(self, name):
        """The one line read alone hands its ask to its reader, who alone is corrected for it."""
        agent, read, which = self.producers()[name]
        self.world()
        message = getattr(self, which)
        self.assertEqual(self.exposures(message), [])
        self.assertNotEqual(read()[0], "")
        self.assertEqual(self.exposures(message), [(agent, 1)])
        editor = "other-reader" if which == "mk" else "owner"
        self.committed(self.command("message.edit", {"body": "Changed: " + name}, {"message_id": message}, expected={"message_revision": 1},
                                    actor=editor))
        self.assertEqual([row[0] for row in self.sql("SELECT d.recipient_id FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                                                     "WHERE g.kind='correction' AND d.message_id=?", (message,))], [agent])

    def test_conversation_waits_hand_the_ask(self):
        self.hands("conversation waits")

    def test_pipeline_asks_hand_the_ask(self):
        self.hands("pipeline asks")

    def test_stars_hand_the_message(self):
        self.hands("stars")

    def test_attention_blocking_hands_the_ask(self):
        self.hands("attention blocking")

    def test_the_held_line_hands_the_ask(self):
        self.hands("held line")

    def test_check_asks_through_outcome_checks_hand_the_ask(self):
        self.hands("check asks (outcome_checks)")

    def test_check_asks_through_check_readings_hand_the_ask(self):
        self.hands("check asks (check_readings)")

    def test_without_a_read_no_line_corrects_anyone_and_the_light_hands_nothing(self):
        self.world()
        self.view("agent-a", "outcome_light", {"workspace_id": "w1"})
        self.view("agent-b", "topic", {"topic_id": "t1"})
        self.view("agent-a", "pipeline_row", {"workspace_id": "w1"})
        self.assertEqual((self.exposures(self.mc), self.exposures(self.mk)), ([], []))
        self.committed(self.command("message.edit", {"body": "Changed"}, {"message_id": self.mc}, expected={"message_revision": 1}))
        self.committed(self.command("message.edit", {"body": "Changed"}, {"message_id": self.mk}, expected={"message_revision": 1}, actor="other-reader"))
        self.assertEqual(self.sql("SELECT count(*) FROM delivery_groups g JOIN deliveries d ON d.group_id=g.id WHERE g.kind='correction'"), [(0,)])
        self.view("agent-b", "check_readings", {"workspace_id": "w1"})
        self.assertEqual(self.exposures(self.mk), [("agent-b", 2)])


class HeldAccountCase(test_targets.WorseAndAcceptedCase):
    """Group 1(c)'s check account, on test_targets' fixture: owner writes the account, and opens it."""

    def account(self, reader):
        return self.checks_view(reader)["loop"]["candidate"]["account"]

    def world(self):
        base = {"commit": test_targets.SHA_19, "started_at": "2026-11-04T04:00:00-08:00", "finished_at": "2026-11-04T04:00:00-08:00",
                "tools": test_targets.TOOLS, "steps": [], "note": "rerun",
                "readings": [test_targets.passed(), test_targets.measured("duration", 17), test_targets.measured("replay", 3)]}
        self.store.record_checks({"outcome": "w1", "commit": "4" * 40, "started_at": "2026-11-04T05:00:00-08:00",
                                  "finished_at": "2026-11-04T05:00:00-08:00", "tools": test_targets.TOOLS, "steps": [], "note": "", "base": base,
                                  "readings": [test_targets.passed(), dict(test_targets.measured("duration", 25), fix_topic_id="t1"),
                                               test_targets.measured("replay", 3)]}, "agent-a")
        return self.post("The wake path now waits on a second read.", actor="owner", subjects=[{"kind": "check", "ref": "duration"}])

    def test_a_held_account_is_withheld_and_recorded_nowhere(self):
        said = self.world()
        self.committed(self.command("message.edit_open", {"holder": "h-laptop"}, {"message_id": said}))
        account = self.account("agent-b")
        self.assertEqual((account["message_id"], account["excerpt"], account["withheld"]), (said, "", True))
        self.assertEqual(self.sql("SELECT count(*) FROM message_exposures WHERE message_id=?", (said,)), [(0,)])
        self.assertEqual((self.account("owner")["excerpt"], self.account("owner")["withheld"]), ("The wake path now waits on a second read.", False))

    def test_the_account_hands_its_words_and_its_reader_is_corrected_once(self):
        said = self.world()
        self.assertEqual(self.account("agent-b")["excerpt"], "The wake path now waits on a second read.")
        self.assertEqual(self.sql("SELECT actor_id,revision FROM message_exposures WHERE message_id=?", (said,)), [("agent-b", 1)])
        self.committed(self.command("message.edit", {"body": "It waits on a second read."}, {"message_id": said}, expected={"message_revision": 1}))
        self.assertEqual(self.sql("SELECT d.recipient_id FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE g.kind='correction' "
                                  "AND d.message_id=?", (said,)), [("agent-b",)])

    def test_without_the_read_the_account_corrects_nobody(self):
        said = self.world()
        self.committed(self.command("message.edit", {"body": "It waits on a second read."}, {"message_id": said}, expected={"message_revision": 1}))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE g.kind='correction' "
                                  "AND d.message_id=?", (said,)), [(0,)])


# Each case runs its own tests only, not those of the fixtures it borrows.
for _case in (HeldTopicCase, HandedCase, HeldOutcomeCase, HeldAccountCase):
    for _name in dir(_case):
        if _name.startswith("test_") and _name not in vars(_case):
            setattr(_case, _name, None)
# Unbound, or the loader collects the last case twice: once by its name and once as _case.
del _case, _name


if __name__ == "__main__":
    unittest.main()

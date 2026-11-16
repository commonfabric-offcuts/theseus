from __future__ import annotations

"""Group 11 (item 452, docs/message-edit.md, "Exposure"): marking is invisible, and only marked words leave.

The seeded world is test_message_exposure's outcome world (an ask in the conversation that blocks a piece, an ask about
an item, a check ask, a star), none of it held, with three more things: Ml, a long ask in the conversation to agent-a
that also blocks the piece and starts "@agent-a "; a message carrying a stored quote; and tTight, a topic whose page
fits the size bound with less room than one marker takes. Every view in validation.VIEWS but capabilities and
operation (which return before the boundary) is swept, as agent-a, as agent-b and, for "nothing escapes", as owner.
"""

import json
import re
import unittest
from unittest import mock

from aim_next import message_edit
from aim_next.contract import LIMITS, StoreError, _json
from aim_next.validation import VIEWS
import test_message_exposure


SKIPPED = {"capabilities", "operation"}
LEAK = re.compile("[0-9a-f]{8}[0-9]")


class SweepCase(test_message_exposure.HeldOutcomeCase):

    def seed(self):
        self.world()
        self.ml = self.asked("@agent-a check the schema\n" + "x" * 1074, blocks={"kind": "piece", "ref": self.piece}, to=("agent-a",), actor="owner",
                             topic=self.conversation)
        self.assertEqual(len(self.sql("SELECT body FROM messages WHERE id=?", (self.ml,))[0][0]), 1100)
        quote = [{"source": {"kind": "message", "id": self.mc, "revision": 1}, "excerpt": "Hold the piece"}]
        self.quoting = self.committed(self.command("message.post", {"body": "Agreed: Hold the piece", "quotes": quote}, {"topic_id": self.conversation}))["message_id"]
        self.tight()

    def tight(self):
        """tTight, pending deliveries and stars for agent-a, and for each of those pages the limit at which the whole
        page fits with no byte to spare, measured unmarked: one marker more, if it were measured, would not fit."""
        self.topic("tTight", "Tight")
        for n in range(6):
            sent = self.committed(self.command("message.post", {"body": "Tight words number %d, " % n + "t" * 300,
                                                                "addressees": ["agent-a"], "intent": "tell"}, {"topic_id": "tTight"}))["message_id"]
            self.committed(self.command("message.star", {"starred": True}, target={"message_id": sent}, expected={"star_revision": 0}, actor="agent-a"))
        self.tight_limits = {}
        for name, args, key in (("topic_messages", {"topic_id": "tTight"}, "items"), ("deliveries", {}, "items"), ("stars", {}, "items")):
            whole = len(self.store._view("agent-a", name, args, marks=False)[key])
            self.assertGreater(whole, 3)
            low, high = 1024, LIMITS["summary_utf8_bytes"]
            while low < high:
                middle = (low + high) // 2
                with mock.patch.dict(LIMITS, {"summary_utf8_bytes": middle}):
                    fits = len(self.store._view("agent-a", name, args, marks=False).get(key, [])) == whole
                low, high = (low, middle) if fits else (middle + 1, high)
            self.tight_limits[(name, _json(args))] = low

    def calls(self, actor):
        """Every view, with arguments drawn from the world."""
        messages = [row[0] for row in self.sql("SELECT id FROM messages ORDER BY seq")]
        topics = ["t1", "t2", self.conversation, "tTight"]
        deliveries = [row[0] for row in self.sql("SELECT id FROM deliveries WHERE recipient_id=? ORDER BY seq", (actor,))]
        calls = [("assessment", {"assessment_id": "a-none"}), ("changes", {}), ("workspace", {"workspace_id": "w1"}), ("workspaces", {}),
                 ("outcome_light", {"workspace_id": "w1"}), ("workspace_topics", {"workspace_id": "w1"}), ("topic_images", {"topic_id": "t1"}),
                 ("memory_items", {"owner_scope": {"kind": "topic", "id": "t1"}}), ("memory_current", {"item_id": "memory-none"}),
                 ("media", {"media_id": "media-none"}), ("editor_state", {"topic_id": "t1"}), ("submission", {"submission_id": "s-none"}),
                 ("submissions", {"topic_id": "t1"}), ("deliveries", {}), ("deliveries", {"limit": 1}), ("opening", {"opening_id": "o-none"}),
                 ("openings", {"workspace_id": "w1"}), ("workspace_members", {"workspace_id": "w1"}), ("attention", {}),
                 ("attention", {"workspace_id": "w1"}), ("actors", {}), ("colors", {}), ("wakes", {}), ("health", {}), ("health_light", {}),
                 ("releases", {}), ("conversation", {"workspace_id": "w1"}), ("pipeline_row", {"workspace_id": "w1"}),
                 ("outcome_checks", {"workspace_id": "w1"}), ("check_readings", {"workspace_id": "w1"}), ("outcome_live", {"workspace_id": "w1"}),
                 ("stars", {}), ("tools", {"workspace_id": "w1"}), ("tool", {"tool_id": "act-ledger"})]
        calls += [("pipeline", {"workspace_id": "w1", "section": section}) for section in ("now", "next", "later", "candidates")]
        calls += [("pipeline_item", {"workspace_id": "w1", "number": number}) for number in (1, 2, 3)]
        for topic in topics:
            calls += [("topic", {"topic_id": topic}), ("topic_messages", {"topic_id": topic}), ("topic_messages", {"topic_id": topic, "direction": "before"}),
                      ("topic_messages", {"topic_id": topic, "audience": "reader"}), ("marks", {"topic_id": topic}), ("topic_unread", {"topic_id": topic}),
                      ("message_acts", {"topic_id": topic}), ("assessments", {"topic_id": topic}), ("topic_tools", {"topic_id": topic})]
        calls.append(("topic_messages", {"topic_id": self.conversation, "items": "open"}))
        for message in messages:
            calls += [("source", {"source_ref": {"kind": "message", "id": message}}), ("reactions", {"message_id": message}),
                      ("source_topics", {"message_id": message})]
        calls.append(("stack_positions", {"topic_id": "t1", "message_ids": [message for message in messages
                                                                           if self.sql("SELECT topic_id FROM messages WHERE id=?", (message,))[0][0] == "t1"][:5]}))
        calls += [("stack_namer", {"message_id": message}) for message in messages
                  if self.sql("SELECT topic_id FROM messages WHERE id=?", (message,))[0][0] == "t1"][:5]
        calls += [("delivery", {"delivery_id": delivery}) for delivery in deliveries]
        return calls

    def test_the_sweep_covers_every_view(self):
        self.seed()
        self.assertEqual({name for name, _ in self.calls("agent-a")}, set(VIEWS) - SKIPPED, "a new view joins the sweep")

    def test_marking_is_invisible(self):
        self.seed()
        # Views that say what time it is read Core's one clock, held still so the two runs read the same millisecond.
        clock = mock.patch("aim_next.delivery._now_ms", return_value=int(self.sql("SELECT max(sent_ms) FROM messages")[0][0]) + 1000)
        clock.start()
        self.addCleanup(clock.stop)
        for actor in ("agent-a", "agent-b"):
            for name, args in self.calls(actor):
                tight = self.tight_limits.get((name, _json(args)))
                for limit in (LIMITS["summary_utf8_bytes"],) + ((tight,) if tight else ()):
                    with self.subTest(actor=actor, view=name, args=args, limit=limit), mock.patch.dict(LIMITS, {"summary_utf8_bytes": limit}):
                        unmarked = self.store._view(actor, name, args, marks=False)
                        marked = self.store._view(actor, name, args, marks=True)
                        self.assertEqual(_json(marked), _json(unmarked))

    def test_each_tight_page_fits_with_less_room_than_a_marker(self):
        self.seed()
        for (name, args), limit in self.tight_limits.items():
            with self.subTest(view=name):
                args = json.loads(args)
                with mock.patch.dict(LIMITS, {"summary_utf8_bytes": limit - 1}):
                    short = self.store._view("agent-a", name, args, marks=False)["items"]
                with mock.patch.dict(LIMITS, {"summary_utf8_bytes": limit}):
                    whole = self.store._view("agent-a", name, args)["items"]
                self.assertEqual(len(short) + 1, len(whole), "one byte less and the last item does not fit")

    def test_nothing_escapes(self):
        self.seed()
        for actor in ("agent-a", "agent-b", "owner"):
            for name, args in self.calls(actor):
                with self.subTest(actor=actor, view=name, args=args):
                    self.assertIsNone(LEAK.search(_json(self.store.view(actor, name, args))))

    def test_plain_stays_inside(self):
        self.seed()
        with mock.patch.object(message_edit, "PLAIN_PROBE", True):
            for actor in ("agent-a", "agent-b"):
                for name, args in self.calls(actor):
                    with self.subTest(actor=actor, view=name, args=args):
                        self.assertNotIn("", _json(self.store.view(actor, name, args)))

    def test_a_persons_own_characters_survive_and_are_recorded(self):
        self.seed()
        first = self.committed(self.command("message.post", {"body": "Deploy at 6 "}, {"topic_id": "t1"}))["message_id"]
        second = self.committed(self.command("message.post", {"body": "abc"}, {"topic_id": "t1"}))["message_id"]
        for actor in ("agent-a", "owner"):
            with self.subTest(actor=actor):
                items = {item["id"]: item["body"] for item in self.view(actor, "topic_messages", {"topic_id": "t1"})["items"]}
                self.assertEqual((items[first], items[second]), ("Deploy at 6 ", "abc"))
                self.assertEqual((self.view(actor, "source", {"source_ref": {"kind": "message", "id": first}})["body"],
                                  self.view(actor, "source", {"source_ref": {"kind": "message", "id": second}})["body"]), ("Deploy at 6 ", "abc"))
        self.assertEqual(self.sql("SELECT message_id,revision FROM message_exposures WHERE actor_id='agent-a' AND message_id IN (?,?) ORDER BY message_id",
                                  (first, second)), sorted([(first, 1), (second, 1)]))

    def test_a_cut_marker_is_never_returned(self):
        self.seed()

        def cut(db, actor, args):
            return {"text": message_edit.mark(self.mc, 1, "Hold the piece")[:10]}
        self.store._view_colors = cut
        with self.assertRaises(StoreError):
            self.store.view("agent-a", "colors", {})
        self.assertEqual(self.exposures(self.mc), [])
        self.assertEqual(self.store.view("owner", "colors", {}), {"text": "Hold the piece"[:10]}, "a person's run marks nothing, so nothing is cut")


for _name in dir(SweepCase):
    if _name.startswith("test_") and _name not in vars(SweepCase):
        setattr(SweepCase, _name, None)


if __name__ == "__main__":
    unittest.main()

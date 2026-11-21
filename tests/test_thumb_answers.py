from __future__ import annotations

"""A person's 👍 on an ask that waits on them answers it yes (item 239, docs/thumbs.md).

The fixture outcome w1 is owned by owner (a person), with agent-a (its
coordinator) and agent-b on its team; its topic t1 has owner and agent-a taking
part, and other-reader, a second person, joins the team here. Each rule is
checked both ways: the 👍 that should clear a wait clears it, and the 👍 that
should not leaves every wait as it was; taking a 👍 back puts back only the
wait it cleared, and only while nothing else answered it.
"""

import sqlite3
import unittest
from unittest import mock

import test_pipeline_stages
import test_pipeline_steering
import test_targets


class ThumbAnswerCase(test_targets.TargetCase):
    def setUp(self):
        super().setUp()
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]

    def ask(self, body="Shall I take the copy?", to=("owner",), actor="agent-a", topic="t1", **args):
        return self.post(body, actor=actor, topic=topic, addressees=list(to), intent="ask", **args)

    def thumbed(self, message, on=True, actor="owner"):
        """The receipt of a thumb sent from the revision the actor reads now."""
        revision = self.store.view(actor, "reactions", {"message_id": message})["reactions"]["thumb_revision"]
        return self.command("message.thumb", {"thumbed": on}, target={"message_id": message}, expected={"thumb_revision": revision}, actor=actor)

    def thumb(self, message, on=True, actor="owner"):
        return self.committed(self.thumbed(message, on, actor))

    def asks(self, topic="t1", actor="owner"):
        """The topic's open asks as its page reads them: (who, ask)."""
        return [(ask["actor_id"], ask["message_id"]) for ask in self.store.view(actor, "topic", {"topic_id": topic})["topic"]["asks"]]

    def waits(self, actor="owner"):
        """The conversation's open asks as its page and its agents read them: (ask, on)."""
        found = self.store.view(actor, "conversation", {"workspace_id": "w1"})["conversation"]["waits"]
        return [(wait["ask_message_id"], wait["on"]) for wait in found]

    def waiting_on_me(self, actor="owner"):
        """The rail's Waiting on you: (count, topics), newest wait first."""
        attention = self.store.view(actor, "attention", {})
        return attention["waiting_on_me"], [item["id"] for item in attention["latest_waiting"]]

    def outcomes_waiting(self, actor="owner"):
        """How many outcomes the rail's outcome light counts as waiting on the person."""
        return self.store.view(actor, "attention", {})["waiting_outcomes"]["count"]

    def hold_clock(self, now):
        """Hold Core's clock at self.now (set it before each act), so each wait's order time is known."""
        self.now = now
        for name in ("delivery", "conversation", "topic_state", "standing_conversation", "reactions", "store"):
            patch = mock.patch("aim_next.%s._now_ms" % name, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)

    def whisper(self, body, actor="owner", to="agent-a", topic="t1", **args):
        return self.post(body, actor=actor, topic=topic, addressees=[to], whisper=True, **args)

    def told_waiting(self, member, topic):
        return self.sql("SELECT count(*) FROM changes WHERE scope_kind='actor' AND scope_id=? AND resource_kind='waiting' AND resource_id=?",
                        (member, topic))[0][0]

    def sql_write(self, *statements):
        with sqlite3.connect(str(self.path)) as db:
            for statement in statements:
                db.execute(statement)

    def topic_version(self, topic="t1"):
        return self.sql("SELECT version FROM topics WHERE id=?", (topic,))[0][0]


class ConversationThumbCase(ThumbAnswerCase):
    def test_a_thumb_by_the_person_asked_answers_the_ask_and_taking_it_back_puts_the_wait_back(self):
        item = self.post("Where does the launch stand?", actor="owner", topic=self.conversation)
        ask = self.ask("@owner to which day?", topic=self.conversation, reply_to=item)
        self.assertEqual(self.waits(), [(ask, "owner")])
        self.assertEqual(self.waiting_on_me(), (1, [self.conversation]))
        told, version = self.told_waiting("owner", self.conversation), self.topic_version(self.conversation)
        receipt = self.thumbed(ask)
        given = self.committed(receipt)
        self.assertTrue(given.get("answered"), "the thumb answers the ask yes")
        self.assertEqual(self.waits(), [], "the conversation's waits, as an agent reads them, no longer hold it")
        self.assertEqual(self.waiting_on_me(), (0, []), "nor does Waiting on you")
        self.assertEqual(self.waiting_on(self.conversation), [])
        self.assertGreater(self.topic_version(self.conversation), version, "open pages read the conversation again")
        self.assertGreater(self.told_waiting("owner", self.conversation), told, "and the person's rail hears it")
        self.assertIn({"kind": "topic", "id": self.conversation, "version": self.topic_version(self.conversation)}, receipt["affected"])
        told, version = self.told_waiting("owner", self.conversation), self.topic_version(self.conversation)
        back = self.thumb(ask, on=False)
        self.assertFalse(back.get("answered"))
        self.assertEqual(self.waits(), [(ask, "owner")], "taking it back puts the wait back")
        self.assertEqual(self.waiting_on_me(), (1, [self.conversation]))
        self.assertGreater(self.topic_version(self.conversation), version, "open pages read it again")
        self.assertGreater(self.told_waiting("owner", self.conversation), told, "and the rail hears it")
        self.thumb(ask)
        self.assertEqual(self.waits(), [], "and a thumb again answers it again")

    def test_a_thumb_by_anyone_else_on_an_ask_to_someone_else_or_on_a_message_that_asks_nothing_changes_no_wait(self):
        ask = self.ask("@owner may I?", topic=self.conversation)
        theirs = self.ask("@other-reader may I?", to=("other-reader",), topic=self.conversation)
        tell = self.post("@owner it shipped", topic=self.conversation, addressees=["owner"], intent="tell")
        before = self.waits()
        self.assertEqual(before, [(ask, "owner"), (theirs, "other-reader")])
        version = self.topic_version(self.conversation)
        self.assertFalse(self.thumb(ask, actor="other-reader").get("answered"), "another person's thumb answers nobody's ask")
        self.assertFalse(self.thumb(ask, actor="agent-b").get("answered"), "nor does an agent's")
        self.assertFalse(self.thumb(theirs).get("answered"), "an ask to someone else is theirs to answer")
        self.assertFalse(self.thumb(tell).get("answered"), "a message that asks nothing has nothing to answer")
        self.assertEqual(self.waits(), before)
        self.assertEqual(self.topic_version(self.conversation), version, "and the conversation is not touched")
        self.thumb(theirs, on=False)
        self.thumb(ask, on=False, actor="other-reader")
        self.assertEqual(self.waits(), before, "taking back a thumb that answered nothing puts nothing back")

    def test_one_persons_thumb_answers_only_their_own_part_of_an_ask_to_two(self):
        ask = self.ask("@owner @other-reader which day?", to=("owner", "other-reader"), topic=self.conversation)
        self.thumb(ask)
        self.assertEqual(self.waits(), [(ask, "other-reader")])
        self.assertEqual(self.waiting_on_me("other-reader"), (1, [self.conversation]))
        self.thumb(ask, actor="other-reader")
        self.assertEqual(self.waits(), [])

    def test_an_agents_thumb_is_its_got_it_and_answers_nothing(self):
        ask = self.ask("@agent-b can you check the copy?", to=("agent-b",), topic=self.conversation, actor="owner")
        self.assertFalse(self.thumb(ask, actor="agent-b").get("answered"))
        self.assertEqual(self.waits(), [(ask, "agent-b")], "it still owes the check")

    def test_taking_it_back_after_a_reply_answered_the_ask_puts_nothing_back(self):
        ask = self.ask("@owner to which day?", topic=self.conversation)
        self.thumb(ask)
        self.post("Friday.", actor="owner", topic=self.conversation, reply_to=ask)
        self.thumb(ask, on=False)
        self.assertEqual(self.waits(), [], "the reply answered it")
        self.assertEqual(self.waiting_on(self.conversation), [])

    def test_a_whispered_reply_answers_the_ask_only_when_it_goes_to_whoever_asked(self):
        ask = self.ask("@owner to which day?", topic=self.conversation)
        # A whisper to another agent, who cannot read the answer, leaves the ask waiting, and taking a 👍 back brings it back.
        self.whisper("Is Friday too soon?", to="agent-b", topic=self.conversation, reply_to=ask)
        self.assertEqual(self.waits(), [(ask, "owner")], "a whisper to someone else answers no ask")
        self.assertTrue(self.thumb(ask).get("answered"))
        self.whisper("Friday it is.", to="agent-b", topic=self.conversation, reply_to=ask)
        self.thumb(ask, on=False)
        self.assertEqual(self.waits(), [(ask, "owner")], "only a reply that reaches the asker has answered it since")
        self.assertEqual(self.waiting_on_me(), (1, [self.conversation]))
        # A whisper to whoever asked is the person's reply, as a Tell is.
        self.whisper("Friday.", topic=self.conversation, reply_to=ask)
        self.assertEqual(self.waits(), [], "a whisper to the asker answers it")
        self.assertEqual(self.waiting_on_me(), (0, []))

    def test_taking_the_thumb_back_after_a_whispered_reply_to_whoever_asked_puts_nothing_back(self):
        ask = self.ask("@owner to which day?", topic=self.conversation)
        self.thumb(ask)
        self.whisper("Friday.", topic=self.conversation, reply_to=ask)
        self.thumb(ask, on=False)
        self.assertEqual(self.waits(), [], "the whispered reply answered it")

    def test_writing_that_does_not_reply_to_the_ask_leaves_taking_the_thumb_back_to_put_it_back(self):
        ask = self.ask("@owner to which day?", topic=self.conversation)
        other = self.ask("@owner and which room?", topic=self.conversation)
        self.thumb(ask)
        self.post("The blue room.", actor="owner", topic=self.conversation, reply_to=other)
        self.post("And a new thought.", actor="owner", topic=self.conversation)
        self.thumb(ask, on=False)
        self.assertEqual(self.waits(), [(ask, "owner")], "in a conversation only a reply to the ask answers it")

    def test_taking_back_a_thumb_that_found_no_wait_puts_none_back(self):
        ask = self.ask("@other-reader which day?", to=("other-reader",), topic=self.conversation)
        for present in (False, True):
            version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
            self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": present},
                                        target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.assertEqual(self.waits(), [], "leaving the team ended the wait, and coming back does not restore it")
        self.assertFalse(self.thumb(ask, actor="other-reader").get("answered"))
        self.thumb(ask, on=False, actor="other-reader")
        self.assertEqual(self.waits(), [])

    def test_a_go_ahead_ask_waits_for_its_go_ahead_and_a_thumb_leaves_it_waiting(self):
        ask = self.ask("@owner may I deploy?", topic=self.conversation, go_ahead=True)
        self.assertFalse(self.thumb(ask).get("answered"))
        self.assertEqual(self.waits(), [(ask, "owner")], "a go-ahead is answered by ✅ or 🚫")
        self.committed(self.command("message.answer", {"answer": "yes"}, target={"message_id": ask}, expected={"answer_revision": 0}))
        self.assertEqual(self.waits(), [])
        self.thumb(ask, on=False)
        self.assertEqual(self.waits(), [], "and taking the thumb back does not undo the go-ahead")

    def test_taking_it_back_after_leaving_the_team_puts_back_no_wait_they_cannot_read(self):
        ask = self.ask("@other-reader which day?", to=("other-reader",), topic=self.conversation)
        self.thumb(ask, actor="other-reader")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.thumb(ask, on=False, actor="other-reader")
        self.assertEqual((self.waits(), self.waiting_on(self.conversation)), ([], []))


class TopicThumbCase(ThumbAnswerCase):
    def wait_heads(self):
        """These cases assert the durable compact wait heads and their movement.

        Item 372 expands the reader's topic asks; that complete navigation set
        is checked in test_waiting_questions_372, separately from these heads.
        """
        return self.sql("SELECT actor_id,ask_message_id FROM topic_waiting "
                        "WHERE topic_id='t1' AND ask_message_id IS NOT NULL ORDER BY actor_id")

    def test_a_thumb_by_the_person_asked_answers_the_ask_and_taking_it_back_puts_the_wait_back(self):
        ask = self.ask()
        self.assertEqual(self.asks(), [("owner", ask)])
        self.assertEqual(self.waiting_on_me(), (1, ["t1"]))
        told, version = self.told_waiting("owner", "t1"), self.topic_version()
        self.assertTrue(self.thumb(ask).get("answered"))
        self.assertEqual(self.asks(), [], "the topic no longer waits on the person")
        self.assertEqual(self.waiting_on_me(), (0, []))
        self.assertEqual(self.waiting_on(), [])
        self.assertGreater(self.topic_version(), version)
        self.assertGreater(self.told_waiting("owner", "t1"), told)
        told, version = self.told_waiting("owner", "t1"), self.topic_version()
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [("owner", ask)], "taking it back puts the wait back")
        self.assertEqual(self.waiting_on_me(), (1, ["t1"]))
        self.assertGreater(self.topic_version(), version, "open pages read it again")
        self.assertGreater(self.told_waiting("owner", "t1"), told, "and the rail hears it")

    def test_a_thumb_answers_only_the_ask_it_is_on_and_the_wait_moves_to_the_next_one(self):
        first = self.ask("Which day?")
        second = self.ask("Which hour?")
        self.assertEqual(self.wait_heads(), [("owner", first)], "the topic waits from the oldest open ask")
        self.thumb(second)
        self.assertEqual(self.wait_heads(), [("owner", first)], "the older ask still waits")
        self.thumb(first)
        self.assertEqual(self.wait_heads(), [], "both are answered")
        third = self.ask("And the room?")
        self.thumb(first, on=False)
        self.assertEqual(self.wait_heads(), [("owner", first)], "the oldest open ask again")
        self.thumb(first)
        self.assertEqual(self.wait_heads(), [("owner", third)], "past the answered second ask, to the third")
        self.thumb(second, on=False)
        self.assertEqual(self.wait_heads(), [("owner", second)], "the second ask, older than the third, waits again")
        self.thumb(third)
        self.thumb(second)
        self.assertEqual(self.wait_heads(), [])

    def test_the_wait_moves_to_the_oldest_ask_after_it_and_never_to_a_tell(self):
        first = self.ask("Which day?")
        self.post("It shipped", addressees=["owner"], intent="tell")
        second = self.ask("Which hour?")
        third = self.ask("And the room?")
        self.thumb(first)
        self.assertEqual(self.wait_heads(), [("owner", second)], "the next ask, past the tell and before the third")
        self.thumb(second)
        self.assertEqual(self.wait_heads(), [("owner", third)])

    def test_another_persons_yes_on_a_later_ask_to_both_leaves_it_waiting_on_the_person(self):
        # Review r3: the wait moved past an ask anyone had thumbed yes, so the owner's question dropped off their rail.
        first = self.ask("Which day?")
        both = self.ask("Which room, both of you?", to=("owner", "other-reader"))
        self.assertTrue(self.thumb(both, actor="other-reader").get("answered"), "it answers the other reader's part")
        self.assertTrue(self.thumb(first).get("answered"))
        self.assertEqual(self.asks(), [("owner", both)], "the owner has not answered the second ask")
        self.assertEqual((self.waiting_on_me(), self.outcomes_waiting()), ((1, ["t1"]), 1))

    def test_the_wait_moves_only_to_a_later_ask_to_the_person_in_this_topic_that_their_own_thumb_has_not_answered(self):
        """Every ask the move passes over, and the one it lands on, each by the rule that decides it."""
        self.open_topic("t2", "w1")
        self.ask("Which colour?")
        self.post("Blue.", actor="owner")
        first = self.ask("Which day?")
        theirs = self.ask("Which room, other reader?", to=("other-reader",))
        self.ask("Which venue?", topic="t2")
        taken_back = self.ask("Which hour?")
        legacy = self.ask("Which caterer?")
        last = self.ask("Which band?")
        self.thumb(taken_back)
        self.thumb(taken_back, on=False)
        # A 👍 from before item 239 holds `up`: it answered nothing.
        self.sql_write("INSERT INTO message_reactions(actor_id,message_id,kind,topic_id,value,at_ms,revision) "
                       "VALUES ('owner','%s','thumb','t1','up',1,1)" % legacy)
        self.assertEqual(self.wait_heads(), [("other-reader", theirs), ("owner", first)])
        self.thumb(first)
        self.assertEqual(self.wait_heads()[1:], [("owner", taken_back)],
                         "not the ask writing answered, another person's, another topic's, nor one whose 👍 was taken back")
        self.thumb(taken_back)
        self.assertEqual(self.wait_heads()[1:], [("owner", legacy)], "a 👍 that answered nothing leaves its ask waiting")
        self.thumb(legacy, on=False)
        self.thumb(legacy)
        self.assertEqual(self.wait_heads()[1:], [("owner", last)])
        self.thumb(last)
        self.assertEqual(self.wait_heads()[1:], [])

    def test_a_thumb_that_moves_no_wait_touches_nothing_open_pages_read(self):
        first = self.ask("Which day?")
        second = self.ask("Which hour?")
        version, told = self.topic_version(), self.told_waiting("owner", "t1")
        self.assertTrue(self.thumb(second).get("answered"), "it answers the second ask")
        self.thumb(second, on=False)
        self.assertEqual(self.wait_heads(), [("owner", first)])
        self.assertEqual((self.topic_version(), self.told_waiting("owner", "t1")), (version, told), "the wait, from the first ask, never changed")
        self.thumb(first)
        self.assertGreater(self.topic_version(), version, "and a thumb that moves it does")

    def test_a_thumb_by_anyone_else_on_an_ask_to_someone_else_or_on_a_message_that_asks_nothing_changes_no_wait(self):
        ask = self.ask()
        theirs = self.ask("May I, other reader?", to=("other-reader",))
        tell = self.post("It shipped", addressees=["owner"], intent="tell")
        before, version = self.waiting_on(), self.topic_version()
        self.assertEqual(before, [("other-reader", theirs), ("owner", ask)])
        self.assertFalse(self.thumb(ask, actor="other-reader").get("answered"))
        self.assertFalse(self.thumb(ask, actor="agent-b").get("answered"))
        self.assertFalse(self.thumb(theirs).get("answered"))
        self.assertFalse(self.thumb(tell).get("answered"))
        self.assertEqual((self.waiting_on(), self.topic_version()), (before, version))
        theirs_to_agent = self.ask("Can you check it?", to=("agent-b",), actor="owner")
        self.assertFalse(self.thumb(theirs_to_agent, actor="agent-b").get("answered"), "an agent's thumb is its got it")
        self.assertIn(("agent-b", theirs_to_agent), self.waiting_on())

    def test_taking_it_back_after_writing_in_the_topic_puts_nothing_back(self):
        ask = self.ask()
        self.thumb(ask)
        self.post("On it.", actor="owner")
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [], "writing in the topic answered it")

    def test_a_whisper_to_another_agent_answers_no_ask_so_a_thumb_still_answers_and_taking_it_back_restores(self):
        ask = self.ask()
        self.whisper("Is the copy final?", to="agent-b", reply_to=ask)
        self.assertEqual(self.asks(), [("owner", ask)], "a whisper to someone else answers no ask, even replying to it")
        self.assertTrue(self.thumb(ask).get("answered"), "so the thumb answers it")
        self.assertEqual(self.asks(), [])
        self.whisper("And the date?", to="agent-b", reply_to=ask)
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [("owner", ask)], "and taking it back puts the wait back")

    def test_a_whisper_replying_to_the_ask_to_whoever_asked_answers_it_and_one_replying_to_nothing_does_not(self):
        # Item 307: a person's whisper answers the ask it replies to, as their reply in the topic would; a whisper
        # to the asker that replies to no ask answers nothing, so a thumb still answers and taking it back restores.
        ask = self.ask()
        self.whisper("About the copy.")
        self.assertEqual(self.asks(), [("owner", ask)], "a whisper replying to no ask answers nothing")
        self.whisper("Take it.", reply_to=ask)
        self.assertEqual(self.asks(), [], "the whispered reply to the asker answered it")
        again = self.ask("And the images?")
        self.thumb(again)
        self.whisper("Those, I mean.")
        self.thumb(again, on=False)
        self.assertEqual(self.asks(), [("owner", again)], "a whisper replying to nothing answered nothing, so the wait comes back")
        self.thumb(again)
        self.whisper("Those too.", reply_to=again)
        self.thumb(again, on=False)
        self.assertEqual(self.asks(), [], "taking the thumb back after a whispered reply to the ask puts nothing back")

    def test_only_the_asked_persons_own_writing_after_the_ask_answers_it(self):
        self.post("Before the ask.", actor="owner")
        ask = self.ask()
        self.post("Someone else writes.", actor="other-reader")
        self.post("The agent writes.", actor="agent-a")
        self.assertTrue(self.thumb(ask).get("answered"), "writing before the ask, or by others, answered nothing")
        self.post("Still someone else.", actor="other-reader")
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [("owner", ask)])

    def test_a_repeated_thumb_reports_what_the_thumb_on_the_message_does(self):
        ask = self.ask()
        tell = self.post("It shipped", addressees=["owner"], intent="tell")
        self.thumb(ask)
        self.thumb(tell)
        again = lambda message, on=True: (lambda result: (result["changed"], result["answered"]))(self.thumb(message, on))
        self.assertEqual(again(ask), (False, True), "the 👍 already there answered the ask")
        self.assertEqual(again(tell), (False, False), "and one on a message that asks nothing answered nothing")
        self.thumb(ask, on=False)
        self.assertEqual(again(ask, on=False), (False, False), "a taken-back 👍 answers nothing")

    def test_the_rail_orders_a_wait_by_the_ask_it_waits_from(self):
        self.hold_clock(1000)
        first = self.ask("Which day?")
        self.now = 2000
        self.open_topic("t2", "w1")
        self.now = 3000
        self.ask("Which room?", topic="t2")
        self.now = 4000
        second = self.ask("Which hour?")
        self.now = 5000
        self.assertEqual(self.waiting_on_me(), (2, ["t2", "t1"]), "t1 waits from its first ask, older than t2's")
        self.thumb(first)
        self.assertEqual(self.waiting_on_me(), (2, ["t1", "t2"]), "it waits from the second now, newer than t2's")
        self.thumb(second)
        self.assertEqual(self.waiting_on_me(), (1, ["t2"]))
        self.thumb(first, on=False)
        self.assertEqual(self.waiting_on_me(), (2, ["t2", "t1"]), "taken back, it waits from the first ask again")
        self.thumb(second, on=False)
        self.thumb(first)
        self.assertEqual(self.waiting_on_me(), (2, ["t1", "t2"]))
        self.thumb(first, on=False)
        self.assertEqual(self.waiting_on_me(), (2, ["t2", "t1"]), "the first ask, older than the one it waits from, again")

    def test_a_said_wait_keeps_its_own_order_time_when_a_thumb_moves_or_restores_its_ask(self):
        self.hold_clock(1000)
        first = self.ask("Which day?")
        self.now = 2000
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]}, target={"topic_id": "t1"},
                                    expected={"topic_revision": self.topic_version()}))
        self.now = 3000
        self.open_topic("t2", "w1")
        self.ask("Which room?", topic="t2")
        self.now = 4000
        second = self.ask("Which hour?")
        self.now = 5000
        self.assertEqual(self.waiting_on_me(), (2, ["t2", "t1"]), "t1 was said to wait before t2's ask")
        for message, on, asks in ((first, True, [("owner", second)]), (second, True, []), (second, False, [("owner", second)]),
                                  (first, False, [("owner", first)])):
            self.thumb(message, on)
            self.assertEqual(self.wait_heads(), asks)
            self.assertEqual(self.waiting_on_me(), (2, ["t2", "t1"]), "said, t1 is ordered by when it was said")

    def test_taking_it_back_in_an_archived_topic_puts_the_wait_back_archived(self):
        ask = self.ask()
        self.assertEqual((self.waiting_on_me(), self.outcomes_waiting()), ((1, ["t1"]), 1))
        self.committed(self.command("topic.update", {"archived": True}, target={"topic_id": "t1"},
                                    expected={"topic_revision": self.topic_version()}))
        self.assertEqual((self.asks(), self.waiting_on_me(), self.outcomes_waiting()), ([("owner", ask)], (0, []), 0),
                         "an archived topic still waits, but not on the rail or its outcome light")
        self.thumb(ask)
        self.thumb(ask, on=False)
        self.assertEqual((self.asks(), self.waiting_on_me(), self.outcomes_waiting()), ([("owner", ask)], (0, []), 0),
                         "the wait put back is still archived")

    def test_a_thumb_on_an_ask_already_answered_by_writing_answers_nothing(self):
        ask = self.ask()
        self.post("Friday.", actor="owner")
        self.assertFalse(self.thumb(ask).get("answered"))
        later = self.ask("And the hour?")
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [("owner", later)])

    def test_a_said_wait_stays_when_a_thumb_answers_the_ask(self):
        ask = self.ask()
        self.committed(self.command("topic.update", {"state": "waiting", "waiting_on": ["owner"]}, target={"topic_id": "t1"},
                                    expected={"topic_revision": self.topic_version()}))
        self.thumb(ask)
        view = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual((view["waiting_on"], view["asks"]), (["owner"], []), "someone said it waits on the person; only saying otherwise ends that")
        self.thumb(ask, on=False)
        self.assertEqual(self.asks(), [("owner", ask)])

    def test_an_ask_a_record_answers_is_never_answered_by_a_thumb(self):
        self.committed(self.propose("First words."))
        proposed = self.committed(self.propose("Other words.", ask={"topic_id": "t1", "body": "Use these words?"}))
        ask = proposed["ask_message_id"]
        self.assertFalse(self.thumb(ask).get("answered"), "the owner settles the words")
        self.assertEqual(self.waiting_on(), [("owner", ask)])
        self.committed(self.command("target.settle", {"revision": proposed["revision"], "outcome": "accepted"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        self.thumb(ask, on=False)
        self.thumb(ask)
        later = self.ask("Which day?")
        self.thumb(later)
        self.thumb(ask, on=False)
        self.assertEqual(self.waiting_on(), [], "a settled record's ask never waits again")

    def test_the_wait_moves_past_a_settled_records_ask_and_onto_one_a_record_still_holds(self):
        self.committed(self.propose("First words."))
        first = self.ask("Which day?")
        held = self.committed(self.propose("Other words.", ask={"topic_id": "t1", "body": "Use these words?"}))
        between = self.ask("Which room?")
        self.thumb(first)
        self.assertEqual(self.waiting_on(), [("owner", held["ask_message_id"])], "the proposal, older than the next plain ask, still waits on the owner")
        self.thumb(between)
        self.committed(self.command("target.settle", {"revision": held["revision"], "outcome": "declined"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        self.assertEqual(self.waiting_on(), [])
        second = self.ask("Which hour?")
        settled = self.committed(self.propose("Third words.", ask={"topic_id": "t1", "body": "Or these?"}))
        self.committed(self.command("target.settle", {"revision": settled["revision"], "outcome": "declined"}, {"workspace_id": "w1"},
                                    {"target_revision": self.revision()}))
        self.assertEqual(self.waiting_on(), [("owner", second)])
        self.thumb(second)
        self.assertEqual(self.waiting_on(), [], "a settled proposal's ask is not one to wait on")

    def test_the_wait_moves_to_a_plain_ask_older_than_the_one_a_record_holds(self):
        self.committed(self.propose("First words."))
        first = self.ask("Which day?")
        between = self.ask("Which room?")
        held = self.committed(self.propose("Other words.", ask={"topic_id": "t1", "body": "Use these words?"}))
        self.thumb(first)
        self.assertEqual(self.waiting_on(), [("owner", between)], "the plain ask comes first")
        self.thumb(between)
        self.assertEqual(self.waiting_on(), [("owner", held["ask_message_id"])], "then the proposal")

    def test_taking_it_back_in_a_reached_outcome_puts_back_no_wait_and_is_not_refused(self):
        ask = self.ask()
        self.thumb(ask)
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.reach", {"words": "Shipped", "unmet_confirmed": True}, {"workspace_id": "w1"},
                                    {"workspace_revision": version}))
        self.thumb(ask, on=False)
        self.assertEqual(self.waiting_on(), [], "a reached outcome's topics wait on nobody")

    def test_taking_it_back_in_a_topic_the_conversation_replaced_puts_back_no_wait(self):
        self.sql_write("INSERT INTO workspaces VALUES ('w-old','owner','Older','',NULL,1)",
                       "INSERT INTO workspace_members VALUES ('w-old','owner')", "INSERT INTO workspace_members VALUES ('w-old','agent-a')")
        self.open_topic("t-old", "w-old")
        ask = self.ask(topic="t-old")
        self.thumb(ask)
        self.assertEqual(self.waiting_on("t-old"), [])
        self.store.start_conversation("w-old", None, ["t-old"])
        self.thumb(ask, on=False)
        self.assertEqual(self.waiting_on("t-old"), [], "a replaced topic waits on nobody")

    def test_taking_it_back_after_losing_the_topic_puts_back_no_wait_they_cannot_read(self):
        ask = self.ask("Which day, other reader?", to=("other-reader",))
        self.thumb(ask, actor="other-reader")
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": False},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.thumb(ask, on=False, actor="other-reader")
        self.assertEqual(self.waiting_on(), [])

    def test_an_agent_reads_who_answered_by_a_thumb(self):
        ask = self.ask()
        plain = self.post("Words")
        self.thumb(ask)
        self.thumb(plain)
        thumbs = {message: self.store.view("agent-a", "reactions", {"message_id": message})["reactions"]["thumbs"] for message in (ask, plain)}
        self.assertEqual([thumb.get("answered") for thumb in thumbs[ask]], [True])
        self.assertEqual([thumb.get("answered") for thumb in thumbs[plain]], [None])


class StageThumbCase(test_pipeline_steering.PipelineCase):
    """An owner-gated stage's ask (D24) is settled by the owner leaving the stage, never by a 👍."""

    def setUp(self):
        super().setUp()
        self.committed(self.on())
        self.stages(*test_pipeline_stages.STAGES)
        self.add("Now 1", section="now", size="small")

    def test_a_gated_stages_ask_is_never_answered_by_a_thumb_open_or_settled(self):
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t1", "stage_id": "build"},
                                            {"workspace_id": "w1"}))["piece_id"]
        enter = lambda stage, actor, **args: self.committed(self.command(
            "pipeline.stage_enter", dict({"stage_id": stage, "left_outcome": "approved"}, **args), {"piece_id": piece}, actor=actor))
        ask = self.post("@owner would you read 1?", addressees=["owner"], intent="ask")
        enter("tony-reads", "agent-a", ask_message_id=ask)
        waiting = lambda: self.sql("SELECT actor_id,ask_message_id FROM topic_waiting WHERE topic_id='t1'")
        thumb = lambda on: self.committed(self.command("message.thumb", {"thumbed": on}, target={"message_id": ask}, expected={
            "thumb_revision": self.store.view("owner", "reactions", {"message_id": ask})["reactions"]["thumb_revision"]}))
        self.assertFalse(thumb(True).get("answered"), "the owner's word is leaving the stage")
        self.assertEqual(waiting(), [("owner", ask)])
        enter("wait", "owner", left_outcome="passed")
        thumb(False)
        self.assertFalse(thumb(True).get("answered"), "nor once the stage is left")
        self.assertIn(("owner", ask), waiting())

    def test_a_gated_stages_open_ask_is_never_answered_by_a_whispered_reply(self):
        # Item 307: a whisper replying to an ask answers it as a reply in the topic would, and a reply never answers what
        # an open record still needs: the owner's word is leaving the stage.
        piece = self.committed(self.command("pipeline.piece_start", {"numbers": [1], "topic_id": "t1", "stage_id": "build"},
                                            {"workspace_id": "w1"}))["piece_id"]
        ask = self.post("@owner would you read 1?", addressees=["owner"], intent="ask")
        self.committed(self.command("pipeline.stage_enter", {"stage_id": "tony-reads", "left_outcome": "approved", "ask_message_id": ask},
                                    {"piece_id": piece}, actor="agent-a"))
        told = lambda: self.sql("SELECT count(*) FROM changes WHERE scope_kind='actor' AND scope_id='owner' AND resource_kind='waiting'")[0][0]
        before = told()
        self.post("Read it: looks right.", actor="owner", addressees=["agent-a"], whisper=True, reply_to=ask)
        self.assertEqual(self.sql("SELECT actor_id,ask_message_id FROM topic_waiting WHERE topic_id='t1'"), [("owner", ask)])
        self.assertEqual(told(), before, "and the owner is not told a wait moved")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Thumbs-up and go-ahead answers on a message, in Core (docs/thumbs.md, items 25 and 124).

The fixture outcome w1 is owned by owner (the one person), with agent-a and
agent-b on its team; its topic t1 has owner and agent-a taking part. A
reaction is fenced on the revision its sender saw, settles the reactor's own
delivery, and tells everyone who reads the message, and nobody else, that
the message's reactions changed. An answer to a go-ahead ask is also said to
the asker as a short reply.
"""

import unittest

import reader_fixture as fixtures
from tests.historical_fixture import post_fields


class ReactionCase(fixtures.ReaderCase):
    def post(self, body="Words", actor="agent-a", **args):
        return self.committed(self.command("message.post", post_fields(self, actor, dict({"body": body}, **args)), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def ask(self, body="May I ship the copy?"):
        return self.post(body, addressees=["owner"], intent="ask", go_ahead=True)

    def thumb(self, message, on=True, revision=0, actor="owner", op=None):
        return self.command("message.thumb", {"thumbed": on}, target={"message_id": message},
                            expected={"thumb_revision": revision}, actor=actor, op=op)

    def answer(self, message, answer="yes", revision=0, actor="owner", op=None):
        return self.command("message.answer", {"answer": answer}, target={"message_id": message},
                            expected={"answer_revision": revision}, actor=actor, op=op)

    def whispered(self):
        """agent-a's whisper to owner, answering owner's whisper to it (an agent whispers only back)."""
        asked = self.post("Between us?", actor="owner", addressees=["agent-a"], whisper=True)
        return self.post("Between us", addressees=["owner"], whisper=True, reply_to=asked)

    def reactions(self, message, actor="owner"):
        view = self.store.view(actor, "reactions", {"message_id": message})
        self.assertNotIn("error", view, view)
        return view["reactions"]

    def told(self, message):
        """Who was sent a `reaction` change for the message, each once."""
        return sorted({row[0] for row in self.sql("SELECT scope_id FROM changes WHERE resource_kind='reaction' AND resource_id=?", (message,))})

    def replies(self, message):
        return self.sql("SELECT author_id,body,addressees,intent FROM messages WHERE reply_to=? ORDER BY seq", (message,))


class ThumbCase(ReactionCase):
    def test_a_thumb_is_taken_back_and_given_again_and_each_revision_is_new(self):
        message = self.post()
        given = self.committed(self.thumb(message))
        self.assertEqual((given["thumbed"], given["thumb_revision"], given["changed"]), (True, 1, True))
        self.assertEqual([thumb["actor_id"] for thumb in self.reactions(message)["thumbs"]], ["owner"])
        again = self.committed(self.thumb(message, revision=1))
        self.assertEqual((again["thumb_revision"], again["changed"]), (1, False), "thumbing a thumbed message changes nothing")
        back = self.committed(self.thumb(message, on=False, revision=1))
        self.assertEqual((back["thumbed"], back["thumb_revision"], back["changed"]), (False, 2, True))
        self.assertEqual(self.reactions(message)["thumbs"], [], "a thumb taken back is not shown")
        self.assertEqual(self.committed(self.thumb(message, revision=2))["thumb_revision"], 3)
        self.assertEqual(self.reactions(message)["version"], 3, "the message's reaction version only grows")

    def test_a_late_thumb_never_undoes_a_newer_one_and_nothing_changes(self):
        message = self.post()
        self.committed(self.thumb(message))
        self.committed(self.thumb(message, on=False, revision=1))
        before = self.sql("SELECT * FROM message_reactions"), self.sql("SELECT count(*) FROM changes")
        late = self.thumb(message, on=True, revision=0)
        self.rejected(late, "REVISION_CONFLICT")
        self.assertEqual(late["error"]["current_versions"], {"thumb_revision": 2})
        self.assertEqual((self.sql("SELECT * FROM message_reactions"), self.sql("SELECT count(*) FROM changes")), before)

    def test_a_thumb_is_for_someone_elses_message_and_a_message_the_actor_can_read(self):
        own = self.post(actor="owner")
        self.rejected(self.thumb(own), "INVALID_ARGUMENT")
        whisper = self.whispered()
        self.rejected(self.thumb(whisper, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.sql("SELECT count(*) FROM message_reactions"), [(0,)])

    def test_a_thumb_is_reading_it_settles_the_reactors_own_delivery_and_no_one_elses(self):
        message = self.post("Both of you", addressees=["owner", "agent-b"], intent="tell")
        pending = "SELECT recipient_id,state FROM deliveries WHERE message_id=? ORDER BY recipient_id"
        self.assertEqual(self.sql(pending, (message,)), [("agent-b", "pending"), ("owner", "pending")])
        self.committed(self.thumb(message))
        self.assertEqual(self.sql(pending, (message,)), [("agent-b", "pending"), ("owner", "acknowledged")])

    def test_a_thumb_reads_that_one_message_at_once_and_taking_it_back_leaves_it_read(self):
        # Item 327: three messages to owner, all unread. A thumb on the middle one reads it alone: the count drops
        # by one, the oldest unread is still the first, and the result says it settled. Taking the thumb back, and
        # thumbing again, read and unread nothing.
        first, middle, last = [self.post("Message %d" % n, addressees=["owner"], intent="tell") for n in range(3)]
        oldest = lambda: (self.store.view("owner", "topic_unread", {"topic_id": "t1"})["oldest_unread"] or {}).get("id")
        unread = lambda: self.store.view("owner", "attention", {})["unread"]
        pending = lambda: [row[0] for row in self.sql("SELECT message_id FROM deliveries WHERE recipient_id='owner' AND state='pending' ORDER BY seq")]
        before = unread()
        self.assertEqual((oldest(), pending()), (first, [first, middle, last]))
        given = self.committed(self.thumb(middle))
        self.assertEqual(given["settled"], True, "the thumb read the message")
        self.assertEqual((unread(), oldest(), pending()), (before - 1, first, [first, last]), "only that message is read")
        back = self.committed(self.thumb(middle, on=False, revision=1))
        self.assertEqual(back["settled"], False)
        self.assertEqual((unread(), pending()), (before - 1, [first, last]), "taking the thumb back leaves it read")
        again = self.committed(self.thumb(middle, revision=2))
        self.assertEqual((again["changed"], again["settled"]), (True, False), "a thumb on a message already read reads nothing")
        self.assertEqual(self.committed(self.thumb(middle, revision=3))["settled"], False, "an unchanged thumb reads nothing")
        self.assertEqual(self.committed(self.thumb(first))["settled"], True)
        self.assertEqual((unread(), oldest(), pending()), (before - 2, last, [last]))

    def mark(self, message, marked=True, actor="owner"):
        revision = (self.sql("SELECT revision FROM message_marks WHERE actor_id=? AND message_id=?", (actor, message)) or [(0,)])[0][0]
        return self.committed(self.command("message.mark", {"marked": marked}, target={"message_id": message},
                                           expected={"mark_revision": revision}, actor=actor))

    def test_a_thumb_given_on_a_message_marked_unread_clears_the_mark_so_it_reads_at_once(self):
        # Item 327: unread is a pending delivery OR a mark (docs/attention.md). The person reads a message, marks it
        # unread, then gives it a 👍 from the feed without opening it: the 👍 reads it, mark and all, in one act.
        read_then_marked, pending_and_marked, other = [self.post("Message %d" % n, addressees=["owner"], intent="tell") for n in range(3)]
        unread = lambda: self.store.view("owner", "attention", {})["unread"]
        marks = lambda: [item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t1"})["items"]]
        self.committed(self.command("topic.read_through", {"seq": self.sql("SELECT seq FROM messages WHERE id=?", (read_then_marked,))[0][0]},
                                    target={"topic_id": "t1"}))
        self.mark(read_then_marked)
        self.mark(pending_and_marked)
        self.mark(other)
        before = unread()
        changes = lambda: self.sql("SELECT resource_id,version FROM changes WHERE scope_id='owner' AND resource_kind='mark' ORDER BY seq")
        told = len(changes())
        given = self.thumb(read_then_marked)
        self.committed(given)
        self.assertEqual((given["result"]["settled"], given["result"].get("mark_revision")), (True, 2), "the 👍 read it: its mark is cleared")
        self.assertIn({"kind": "mark", "id": read_then_marked, "version": 2}, given["affected"])
        self.assertEqual(changes()[told:], [(read_then_marked, 2)], "the person's pages hear the mark change")
        self.assertEqual((unread(), marks()), (before - 1, [pending_and_marked, other]), "only that message is read; the other marks stay")
        # A pending delivery and a mark on the same message: one 👍 settles both, and the message counts no more.
        both = self.committed(self.thumb(pending_and_marked))
        self.assertEqual((both["settled"], both.get("mark_revision")), (True, 2))
        self.assertEqual((unread(), marks()), (before - 2, [other]))
        # Taking a 👍 back reads nothing and clears nothing: marked again, then the 👍 taken back, the mark stays.
        self.mark(read_then_marked)
        back = self.committed(self.thumb(read_then_marked, on=False, revision=1))
        self.assertEqual(back["settled"], False)
        self.assertNotIn("mark_revision", back)
        self.assertEqual(marks(), [read_then_marked, other], "a 👍 taken back leaves the mark")
        # A 👍 on a message neither pending nor marked clears nothing and writes no mark change.
        told = len(changes())
        plain = self.committed(self.thumb(self.post("Read already", addressees=["owner"], intent="tell")))
        self.assertEqual(changes()[told:], [], "nothing was marked, so no mark changes")
        self.assertNotIn("mark_revision", plain)
        # Someone else's 👍 leaves the person's mark.
        self.committed(self.thumb(other, actor="agent-b"))
        self.assertEqual(marks(), [read_then_marked, other], "another's 👍 clears none of the person's marks")

    def test_a_reaction_tells_every_reader_of_the_message_and_only_them(self):
        message = self.post()
        self.committed(self.thumb(message))
        self.assertEqual(self.told(message), ["agent-a", "agent-b", "owner"], "the topic's readers")
        whisper = self.whispered()
        self.committed(self.thumb(whisper))
        self.assertEqual(self.told(whisper), ["agent-a", "owner"], "a whisper's two people only")

    def test_someone_who_reads_a_message_only_by_name_is_told_its_reactions_change(self):
        # agent-b reads t1 only as a member of the outcome; once off the team it
        # still reads the message sent to it by name, so it hears its reactions.
        message = self.post("For you", addressees=["agent-b"], intent="tell")
        self.member_set("agent-b", False)
        self.source({"kind": "message", "id": message}, actor="agent-b")
        self.committed(self.thumb(message))
        self.assertIn("agent-b", self.told(message))
        self.assertEqual([thumb["actor_id"] for thumb in self.reactions(message, actor="agent-b")["thumbs"]], ["owner"])
        other = self.post("Not for agent-b")
        self.committed(self.thumb(other))
        self.assertNotIn("agent-b", self.told(other), "a message it cannot read tells it nothing")

    def member_set(self, member, present):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        return self.committed(self.command("workspace.member_set", {"actor_id": member, "present": present},
                                           target={"workspace_id": "w1"}, expected={"workspace_revision": version}))


class AnswerCase(ReactionCase):
    def test_a_go_ahead_goes_on_an_ask(self):
        self.rejected(self.command("message.post", {"body": "Shipping", "addressees": ["owner"], "intent": "tell", "go_ahead": True},
                                   target={"topic_id": "t1"}, actor="agent-a"), "INVALID_ARGUMENT")
        self.rejected(self.command("message.post", {"body": "Shipping", "go_ahead": "yes"}, target={"topic_id": "t1"}, actor="agent-a"),
                      "INVALID_ARGUMENT")
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE go_ahead=1"), [(0,)])

    def test_the_person_asked_answers_and_the_asker_is_told_in_a_reply(self):
        ask = self.ask()
        said = self.committed(self.answer(ask))
        self.assertEqual((said["answer"], said["answer_revision"], said["changed"]), ("yes", 1, True))
        self.assertEqual(self.replies(ask), [("owner", "✅ Go ahead", '["agent-a"]', "tell")])
        self.assertEqual([(entry["actor_id"], entry["answer"]) for entry in self.reactions(ask)["answers"]], [("owner", "yes")])
        same = self.committed(self.answer(ask, revision=1))
        self.assertEqual(same["changed"], False)
        self.assertEqual(len(self.replies(ask)), 1, "the same answer again says nothing new")
        changed = self.committed(self.answer(ask, "no", revision=1))
        self.assertEqual((changed["answer"], changed["answer_revision"]), ("no", 2))
        self.assertEqual(self.replies(ask)[-1][1], "🚫 Don't (I changed my answer)")
        self.assertEqual([(entry["actor_id"], entry["answer"]) for entry in self.reactions(ask)["answers"]], [("owner", "no")])

    def test_an_answer_on_a_go_ahead_marked_unread_clears_the_mark_as_a_thumb_does(self):
        # Item 327's class: ✅ or 🚫 is given from the feed without opening the ask, so it reads it, mark and all.
        message = self.ask()
        revision = self.committed(self.command("message.mark", {"marked": True}, target={"message_id": message},
                                               expected={"mark_revision": 0}))["mark_revision"]
        marks = lambda: [item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t1"})["items"]]
        self.assertEqual(marks(), [message])
        given = self.answer(message)
        self.committed(given)
        self.assertEqual(given["result"].get("mark_revision"), revision + 1)
        self.assertIn({"kind": "mark", "id": message, "version": revision + 1}, given["affected"])
        self.assertEqual(marks(), [], "the answer read the ask")
        unread = self.sql("SELECT count(*) FROM deliveries WHERE message_id=? AND recipient_id='owner' AND state='pending'", (message,))
        self.assertEqual(unread, [(0,)])
        # Changing the answer once the ask is read again by a mark clears that mark too; with none, nothing.
        self.committed(self.command("message.mark", {"marked": True}, target={"message_id": message}, expected={"mark_revision": revision + 1}))
        changed = self.committed(self.answer(message, "no", revision=1))
        self.assertEqual((changed.get("mark_revision"), marks()), (revision + 3, []))
        self.assertNotIn("mark_revision", self.committed(self.answer(message, "yes", revision=2)))

    def test_an_answer_sent_twice_by_one_operation_says_it_once(self):
        ask = self.ask()
        first = self.answer(ask, op="answer-once")
        second = self.answer(ask, op="answer-once")
        self.assertEqual(self.committed(second)["reply_id"], self.committed(first)["reply_id"])
        self.assertEqual(len(self.replies(ask)), 1)

    def test_only_a_person_a_go_ahead_asks_can_answer_it(self):
        ask = self.ask()
        plain = self.post("Just words", addressees=["owner"], intent="ask")
        self.rejected(self.answer(plain), "NOT_A_GO_AHEAD")
        self.rejected(self.answer(ask, actor="agent-b"), "NOT_ASKED")
        other = self.post("May I?", addressees=["agent-b"], intent="ask", go_ahead=True, actor="agent-a")
        self.rejected(self.answer(other), "NOT_ASKED")
        self.rejected(self.answer(other, actor="agent-b"), "NOT_ASKED")
        self.rejected(self.answer(ask, "maybe"), "INVALID_ARGUMENT")
        self.assertEqual((self.sql("SELECT count(*) FROM message_reactions"), self.replies(ask)), ([(0,)], []))

    def test_a_late_answer_never_undoes_a_newer_one(self):
        ask = self.ask()
        self.committed(self.answer(ask))
        late = self.answer(ask, "no", revision=0)
        self.rejected(late, "REVISION_CONFLICT")
        self.assertEqual(late["error"]["current_versions"], {"answer_revision": 1})
        self.assertEqual([entry["answer"] for entry in self.reactions(ask)["answers"]], ["yes"])
        self.assertEqual(len(self.replies(ask)), 1)

    def test_a_page_of_messages_carries_reactions_and_the_go_ahead(self):
        ask, plain = self.ask(), self.post()
        self.committed(self.thumb(plain))
        items = {item["id"]: item for item in self.store.view("owner", "topic_messages", {"topic_id": "t1", "limit": 20})["items"]}
        self.assertEqual((items[ask].get("go_ahead"), "reactions" in items[ask]), (True, False))
        self.assertEqual((items[plain].get("go_ahead"), items[plain]["reactions"]["thumb_revision"]), (None, 1))
        self.assertEqual(self.source({"kind": "message", "id": ask})["go_ahead"], True)


if __name__ == "__main__":
    unittest.main()

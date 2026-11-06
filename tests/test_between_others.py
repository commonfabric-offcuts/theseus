from __future__ import annotations

from reader_fixture import ReaderCase


class BetweenOthersCase(ReaderCase):
    """A message between others is never unread for a person.

    For a person, a message sent by name to others (addressees not empty, the
    person not among them, not a reply to the person's own message) is not
    for them: it is delivered already settled, so no count, no New line and
    no notification waits on it. An agent's deliveries are its work and are
    unchanged. A person who marks such a message unread has it counted and
    holding the line, like any mark."""

    def setUp(self):
        super().setUp()
        for actor in ("agent-b", "other-reader"):
            self.participation(actor, True)
        self.committed(self.command("topic.read_through", {"seq": 10 ** 6}, target={"topic_id": "t1"}))
        self.committed(self.command("topic.read_through", {"seq": 10 ** 6}, target={"topic_id": "t1"}, actor="other-reader"))

    def post(self, actor, body, **args):
        if args.get("addressees"):
            args.setdefault("intent", "tell")
        return self.committed(self.command("message.post", dict(args, body=body), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def state(self, message_id, actor="owner"):
        return self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id=?", (message_id, actor))[0][0]

    def seen(self, actor="owner"):
        """(topic row unread, outcome row unread, total unread, the New line) for actor.

        A participant from outside the outcome has no list of its topics or
        outcome row; those read as None."""
        topics = self.store.view(actor, "workspace_topics", {"workspace_id": "w1"}).get("items")
        outcomes = self.store.view(actor, "workspaces", {})["items"]
        line = self.store.view(actor, "topic_unread", {"topic_id": "t1"})["oldest_unread"]
        return (None if topics is None else [item["unread"] for item in topics if item["id"] == "t1"][0],
                ([item["unread"] for item in outcomes if item["id"] == "w1"] or [None])[0],
                self.store.view(actor, "attention", {})["unread"], line and line["id"])

    def test_a_message_between_others_is_never_unread_for_a_person(self):
        between = self.post("agent-a", "agent-a to agent-b: the wake check fails", addressees=["agent-b"])
        self.assertEqual(self.seen(), (0, 0, 0, None), "counted nowhere, and no New line")
        self.assertEqual(self.seen("other-reader"), (None, None, 0, None), "for a participant from outside the outcome too")
        for person in ("owner", "other-reader"):
            self.assertEqual(self.state(between, person), "acknowledged", person + ": delivered settled")
        # The schedule and the group counters agree: nothing is pending for the owner.
        self.assertEqual(self.sql("SELECT coalesce((SELECT pending_count FROM recipient_schedule WHERE recipient_id='owner'),0)"), [(0,)])
        self.assertEqual(self.sql("SELECT coalesce(sum(pending_count),0) FROM delivery_groups WHERE recipient_id='owner' AND active=1"), [(0,)])
        # The agent it names has it as work, as before.
        self.assertEqual(self.state(between, "agent-b"), "pending")

    def test_what_is_for_the_person_stays_unread(self):
        own = self.post("owner", "The owner asks the topic")
        named = self.post("agent-a", "To the owner by name", addressees=["owner"])
        everyone = self.post("agent-a", "To everyone in the topic")
        both = self.post("agent-a", "To the owner and agent-b", addressees=["owner", "agent-b"])
        answer = self.post("agent-a", "agent-a answers the owner, telling agent-b", addressees=["agent-b"], reply_to=own)
        for message in (named, everyone, both, answer):
            self.assertEqual(self.state(message), "pending", message)
        self.assertEqual(self.seen()[0], 4)
        self.assertEqual(self.seen()[3], named, "the oldest of them holds the line")
        # The reply to the owner is between others for other-reader.
        self.assertEqual((self.state(answer, "other-reader"), self.state(everyone, "other-reader")), ("acknowledged", "pending"))

    def test_an_agent_subscribed_to_the_topic_still_gets_it_as_work(self):
        self.participation("outsider", True)
        between = self.post("agent-a", "agent-a to agent-b", addressees=["agent-b"])
        self.assertEqual(self.state(between, "outsider"), "pending", "an agent's queue and wakes are unchanged")

    def test_a_person_who_marks_it_unread_has_it_counted_and_holding_the_line_until_cleared(self):
        between = self.post("agent-a", "agent-a to agent-b", addressees=["agent-b"])
        later = self.post("agent-a", "agent-a to agent-b again", addressees=["agent-b"])
        revision = lambda: (self.sql("SELECT revision FROM message_marks WHERE actor_id='owner' AND message_id=?", (between,)) or [(0,)])[0][0]
        mark = lambda marked: self.committed(self.command("message.mark", {"marked": marked}, target={"message_id": between},
                                                          expected={"mark_revision": revision()}))
        mark(True)
        self.assertEqual(self.seen(), (1, 1, 1, between), "marked unread: it counts and holds the line")
        self.assertEqual([item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t1"})["items"]], [between])
        # Reading through the topic settles deliveries only; the mark stays.
        self.committed(self.command("topic.read_through", {"seq": 10 ** 6}, target={"topic_id": "t1"}))
        self.assertEqual(self.seen(), (1, 1, 1, between))
        mark(False)
        self.assertEqual(self.seen(), (0, 0, 0, None), "cleared, it counts nowhere again")
        self.assertEqual(self.state(later), "acknowledged")

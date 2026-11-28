from __future__ import annotations

from test_conversation import ConversationCase


class TargetAskWaitsCase(ConversationCase):
    def setUp(self):
        super().setUp()
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        self.participation("other-reader", True)

    def propose(self, words, **args):
        version = self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})["relevant_versions"]["checks"]
        return self.committed(self.command("target.propose", dict(text=words, **args),
                                           target={"workspace_id": "w1"}, expected={"target_revision": version},
                                           actor="agent-a"))

    def settle(self, proposal, outcome="accepted"):
        return self.committed(self.command("target.settle", {"revision": proposal["revision"], "outcome": outcome},
                                           target={"workspace_id": "w1"},
                                           expected={"target_revision": proposal["target_revision"]}))

    def asked(self, topic="t1"):
        view = self.store.view("owner", "topic", {"topic_id": topic})["topic"]
        return [ask["message_id"] for ask in view["asks"] if ask["actor_id"] == "owner"]

    def target(self, topic="t1"):
        self.propose("Initial target.")
        extra = {"reply_to": self.opening["id"]} if topic == "t1" else {}
        question = self.posted("Use this target?", topic=topic, actor="agent-a", intent="ask",
                               addressees=["owner"], **extra)
        return question, self.propose("Proposed target.", ask_message_id=question)

    def other_ask(self, topic="t1"):
        return self.posted("Can you check the other file?", topic=topic, actor="other-reader", intent="ask",
                           addressees=["owner"])

    def test_settling_a_target_keeps_a_separate_person_to_person_ask(self):
        held, proposal = self.target()
        other = self.other_ask()
        self.posted("I am reading the proposal.", topic="t1", reply_to=held)
        self.assertEqual(self.asked(), [held, other])
        self.settle(proposal)
        self.assertEqual(self.asked(), [other])
        target, remaining = [self.source({"kind": "message", "id": mid})["question"] for mid in (held, other)]
        self.assertEqual(target["state"], "answered")
        self.assertEqual(remaining["waiting_on"], ["owner"])
        self.assertEqual(self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id=? AND actor_id=?",
                                 ("t1", "owner")), [(other,)])

    def test_declining_a_target_does_not_revive_an_already_answered_ask(self):
        held, proposal = self.target()
        other = self.other_ask()
        self.posted("The other file is checked.", topic="t1", reply_to=other)
        self.assertEqual(self.asked(), [held])
        self.settle(proposal, outcome="declined")
        self.assertEqual(self.asked(), [])
        self.assertEqual(self.source({"kind": "message", "id": other})["question"]["state"], "answered")

    def test_settling_a_target_keeps_a_separate_ask_in_the_conversation(self):
        held, proposal = self.target(self.conversation)
        other = self.other_ask(self.conversation)
        self.assertEqual(self.asked(self.conversation), [held, other])
        self.settle(proposal)
        self.assertEqual(self.asked(self.conversation), [other])
        self.assertEqual(self.source({"kind": "message", "id": held})["question"]["state"], "answered")
        self.assertEqual([wait["ask_message_id"] for wait in self.found()["waits"]], [other])

    def test_last_target_releases_to_an_older_plain_ask(self):
        held, _ = self.target()
        other = self.other_ask()
        replacement = self.posted("Use the newer target?", topic="t1", actor="agent-a", intent="ask",
                                  addressees=["owner"])
        proposal = self.propose("Replacement target.", ask_message_id=replacement)
        self.assertEqual(self.asked(), [other, replacement])
        self.assertEqual(self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id=? AND actor_id=?",
                                 ("t1", "owner")), [(replacement,)])
        self.settle(proposal)
        self.assertEqual(self.asked(), [other])
        self.assertEqual(self.source({"kind": "message", "id": held})["question"]["state"], "answered")

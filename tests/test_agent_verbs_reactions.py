from __future__ import annotations

"""An agent's thumbs-up and go-ahead asks from its command line (docs/thumbs.md, items 25 and 124).

`thumb MESSAGE` says read and understood without posting a message, and
`--off` takes it back; `post TOPIC --asks A --go-ahead` asks for a go-ahead;
`read` names who thumbed each message up and what each person answered. The
fixture's owner is the one person, and agent-a and agent-b are agents.
"""

import unittest

import test_agent_verbs


class ReactionVerbCase(test_agent_verbs.AgentVerbCase):
    def post(self, actor, body, **args):
        if args.get("addressees"):
            args.setdefault("intent", "tell")
        return self.committed(self.store.command(actor, self.envelope("message.post", {"topic_id": "t1"}, dict(args, body=body))))["message_id"]

    def thumbs(self, message, actor="owner"):
        view = self.store.view(actor, "reactions", {"message_id": message})
        self.assertNotIn("error", view, view)
        return [thumb["actor_id"] for thumb in view["reactions"]["thumbs"]]

    def test_thumb_says_read_and_understood_and_off_takes_it_back(self):
        message = self.post("owner", "Please read the plan.", addressees=["agent-a"])
        code, out, err = self.run_cli("thumb", message)
        self.assertEqual((code, out, err), (0, "thumbed up %s\n" % message, ""))
        self.assertEqual(self.thumbs(message), ["agent-a"])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE topic_id='t1' AND author_id='agent-a'"), [(0,)],
                         "a thumbs-up posts no message")
        code, out, _ = self.run_cli("thumb", message)
        self.assertEqual((code, out), (0, "thumbed up %s (already so)\n" % message))
        code, out, _ = self.run_cli("thumb", message, "--off")
        self.assertEqual((code, out), (0, "took back the thumbs-up on %s\n" % message))
        self.assertEqual(self.thumbs(message), [])
        code, out, _ = self.run_cli("thumb", message, "--off")
        self.assertEqual((code, out), (0, "took back the thumbs-up on %s (already so)\n" % message))
        # An agent's own message is not one it thumbs up.
        own = self.post("agent-a", "My own words.")
        code, out, err = self.run_cli("thumb", own)
        self.assertNotEqual(code, 0)
        self.assertIn("INVALID_ARGUMENT", err)
        self.assertEqual(self.thumbs(own), [])

    def test_post_asks_for_a_go_ahead_only_with_go_ahead_and_only_as_an_ask(self):
        code, out, err = self.run_cli("post", "t1", "--asks", "owner", "--go-ahead", "May I ship the copy?")
        self.assertEqual((code, err), (0, ""))
        ask = self.latest()
        self.assertEqual(self.sql("SELECT body,intent,go_ahead FROM messages WHERE id=?", (ask[0],)), [("May I ship the copy?", "ask", 1)])
        self.run_cli("post", "t1", "--asks", "owner", "Which colour?")
        plain = self.latest()
        self.assertEqual(self.sql("SELECT intent,go_ahead FROM messages WHERE id=?", (plain[0],)), [("ask", 0)])
        code, out, err = self.run_cli("post", "t1", "--tells", "owner", "--go-ahead", "Shipping now.")
        self.assertNotEqual(code, 0)
        self.assertIn("INVALID_ARGUMENT", err)
        self.assertEqual(self.latest()[0], plain[0], "a tell that asks for a go-ahead is refused and nothing is posted")

    def test_read_names_who_thumbed_a_message_up_and_what_each_person_answered(self):
        plain = self.post("agent-a", "The copy is drafted.", addressees=["owner"])
        self.committed(self.store.command("owner", self.envelope("message.thumb", {"message_id": plain}, {"thumbed": True},
                                                                  {"thumb_revision": 0})))
        self.committed(self.store.command("agent-b", self.envelope("message.thumb", {"message_id": plain}, {"thumbed": True},
                                                                    {"thumb_revision": 0})))
        answered = self.post("agent-a", "May I ship the copy?", addressees=["owner"], intent="ask", go_ahead=True)
        self.committed(self.store.command("owner", self.envelope("message.answer", {"message_id": answered}, {"answer": "yes"},
                                                                  {"answer_revision": 0})))
        waiting = self.post("agent-a", "May I deploy it too?", addressees=["owner"], intent="ask", go_ahead=True)
        quiet = self.post("agent-a", "Nothing to say about this one.")
        code, out, _ = self.run_cli("read", "t1")
        self.assertEqual(code, 0)
        blocks = {block.split("\n")[0].split(" ")[1]: block for block in out.split("\n\n")[1:]}
        self.assertIn("\n  (👍 owner, agent-b)\n", blocks[plain] + "\n")
        self.assertIn("\n  (asks for a go-ahead: owner ✅ go ahead)\n", blocks[answered] + "\n")
        self.assertIn("\n  (asks for a go-ahead; not answered yet)\n", blocks[waiting] + "\n")
        for message in (plain, quiet):
            self.assertNotIn("go-ahead", blocks[message])
        for message in (answered, waiting, quiet):
            self.assertNotIn("👍", blocks[message])


if __name__ == "__main__":
    unittest.main()

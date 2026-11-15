from __future__ import annotations

"""Minted names (item 479, docs/reply-stacks.md "Minted names"): when the first reply on the record lands in a dossier
nobody has named, its namer writes a two-to-five-word name as a stack.name act with `minted: true`, shown as "Named
by" it. The namer is the outcome's coordinator when an agent coordinates it, or else the first agent that replies;
with no agent reply the first line stays, and a typed name wins and is never replaced. Core checks every part of it.

The fixture outcome w1 is coordinated by agent-a, with agent-b on its team; owner and agent-a take part in t1. The
harness's side is the delivery's `name_it`, the hosted notice's line and the CLI's `mint` verb, driven here by a fake
coordinator that reads the notice and mints fixed words, with no model.
"""

import json
import re

from aim_next import hosted_notice
from test_agent_verbs import AgentVerbCase


class NamesCase(AgentVerbCase):
    def setUp(self):
        super().setUp()
        # agent-b takes part too, so it can reply in t1 and is sent what is posted there.
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))

    def post(self, body="Words", actor="owner", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def mint(self, message, words, revision=0, actor="agent-a", op=None):
        return self.command("stack.name", {"name": words, "minted": True}, target={"message_id": message},
                            expected={"name_revision": revision}, actor=actor, op=op)

    def name(self, message, words, revision=0, actor="owner"):
        return self.command("stack.name", {"name": words}, target={"message_id": message}, expected={"name_revision": revision}, actor=actor)

    def shown(self, message, actor="owner"):
        """The dossier's name as a reader's page of the topic carries it on every message: the first message's acts,
        and each message's position."""
        page = self.store.view(actor, "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 100})
        self.assertNotIn("error", page, page)
        item = next(item for item in page["items"] if item["id"] == message)
        return item["stack_position"]["name"]

    def names(self):
        return [(json.loads(value), actor) for value, actor in self.sql("SELECT value,actor_id FROM message_acts WHERE kind='name' ORDER BY id")]

    def no_coordinator(self):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.coordinator_set", {"actor_id": None}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": version}))

    def deliveries(self, actor):
        page = self.store.view(actor, "deliveries", {})
        self.assertNotIn("error", page, page)
        return {item["message_id"]: item for item in page["items"]}


class CoreCase(NamesCase):
    def test_the_coordinator_mints_a_name_once_the_first_reply_lands_and_every_reader_sees_it_named_by_it(self):
        root = self.post("Can we lock the cabin for the week of July 12 before Friday?")
        self.rejected(self.mint(root, "Cabin week plan"), "NOT_THE_NAMER")
        reply = self.post("Friday works for me.", actor="agent-b", reply_to=root)
        minted = self.committed(self.mint(root, "  Cabin\nweek plan "))
        self.assertEqual((minted["name"], minted["minted"], minted["name_revision"], minted["changed"]), ("Cabin week plan", True, 1, True))
        for reader in ("owner", "agent-b"):
            for message in (root, reply):
                named = self.shown(message, reader)
                self.assertEqual((named["text"], named["by"], named.get("minted")), ("Cabin week plan", "agent-a", True), (reader, message))
        self.assertEqual(self.names(), [({"name": "Cabin week plan", "minted": True}, "agent-a")])

    def test_a_minted_name_is_two_to_five_words_and_says_minted_true_or_nothing(self):
        root = self.post("Root")
        self.post("Reply", actor="agent-b", reply_to=root)
        for words in ("Cabin", "One two three four five six", ""):
            self.rejected(self.mint(root, words), "INVALID_ARGUMENT")
        for minted in (False, "yes", None):
            self.rejected(self.command("stack.name", {"name": "Cabin week", "minted": minted}, target={"message_id": root},
                                       expected={"name_revision": 0}, actor="agent-a"), "INVALID_ARGUMENT")
        self.assertEqual(self.names(), [])
        self.committed(self.mint(root, "One two three four five"))

    def test_a_second_reply_does_not_mint_again(self):
        root = self.post("Root")
        self.post("First reply", actor="agent-b", reply_to=root)
        self.committed(self.mint(root, "Cabin week plan"))
        self.post("Second reply", actor="agent-b", reply_to=root)
        self.rejected(self.mint(root, "Another name now", revision=1), "ALREADY_NAMED")
        self.assertEqual(self.store.view("agent-a", "stack_namer", {"message_id": root})["namer"], None)
        self.assertEqual(len(self.names()), 1)

    def test_a_dossier_a_person_named_is_never_minted_even_after_they_cleared_it(self):
        root = self.post("Root")
        self.committed(self.name(root, "Typed by a person"))
        self.post("Reply", actor="agent-b", reply_to=root)
        self.rejected(self.mint(root, "Cabin week plan", revision=1), "ALREADY_NAMED")
        self.committed(self.name(root, "", revision=1))
        self.rejected(self.mint(root, "Cabin week plan", revision=2), "ALREADY_NAMED")
        self.assertEqual([actor for _, actor in self.names()], ["owner", "owner"])

    def test_a_person_renaming_while_the_agent_prepares_its_mint_keeps_the_persons_name_on_the_root(self):
        """Acceptance (auditor #4018, warp #4020): the mint is fenced on the name's revision the agent read, and a
        name a person gave meanwhile refuses it however it is fenced."""
        root = self.post("Root")
        reply = self.post("Reply", actor="agent-b", reply_to=root)
        read = self.store.view("agent-a", "stack_namer", {"message_id": reply})
        self.assertEqual((read["root_id"], read["name_revision"], read["namer"]), (root, 0, "agent-a"), "the agent reads it may name the dossier")
        self.committed(self.name(root, "The person's title"))
        late = self.mint(read["root_id"], "Cabin week plan", revision=read["name_revision"])
        self.rejected(late, "REVISION_CONFLICT")
        self.assertEqual(late["error"]["current_versions"], {"name_revision": 1})
        self.rejected(self.mint(root, "Cabin week plan", revision=1), "ALREADY_NAMED")
        for message in (root, reply):
            named = self.shown(message)
            self.assertEqual((named["text"], named["by"], "minted" in named), ("The person's title", "owner", False))

    def test_an_agent_that_is_not_the_coordinator_does_not_mint_while_a_coordinator_exists(self):
        root = self.post("Root")
        self.post("I replied first", actor="agent-b", reply_to=root)
        refused = self.mint(root, "Cabin week plan", actor="agent-b")
        self.rejected(refused, "NOT_THE_NAMER")
        self.assertIn("agent-a", refused["error"]["message"])
        self.rejected(self.mint(root, "Cabin week plan", actor="owner"), "NOT_THE_NAMER")
        self.assertEqual(self.names(), [])
        self.committed(self.mint(root, "Cabin week plan"))

    def test_with_no_coordinator_the_first_agent_that_replies_mints_and_with_no_agent_reply_the_first_line_stays(self):
        self.no_coordinator()
        root = self.post("Root")
        self.post("A person replies", reply_to=root)
        self.assertEqual(self.store.view("owner", "stack_namer", {"message_id": root})[("namer")], None)
        self.rejected(self.mint(root, "Cabin week plan"), "NOT_THE_NAMER")
        self.assertIsNone(self.shown(root), "no agent replied: the first line stays")
        self.post("First agent reply", actor="agent-b", reply_to=root)
        self.post("Second agent reply", actor="agent-a", reply_to=root)
        self.rejected(self.mint(root, "Cabin week plan", actor="agent-a"), "NOT_THE_NAMER")
        self.committed(self.mint(root, "Cabin week plan", actor="agent-b"))
        self.assertEqual(self.shown(root)["by"], "agent-b")

    def test_a_mint_on_a_message_that_is_not_its_dossiers_first_is_refused(self):
        root = self.post("Root")
        reply = self.post("Reply", actor="agent-b", reply_to=root)
        self.rejected(self.mint(reply, "Cabin week plan"), "STACK_CHANGED")
        other = self.post("Another stack")
        self.post("Its reply", actor="agent-b", reply_to=other)
        self.committed(self.command("stack.join", {"into": root}, target={"message_id": other}, expected={"join_revision": 0}))
        self.rejected(self.mint(other, "Joined stack name"), "STACK_CHANGED")
        self.assertEqual(self.names(), [])

    def test_a_whisper_is_no_reply_for_a_name(self):
        self.no_coordinator()
        root = self.post("Root")
        asked = self.post("Between us?", addressees=["agent-b"], whisper=True, reply_to=root)
        self.post("Between us", actor="agent-b", addressees=["owner"], whisper=True, reply_to=asked)
        self.assertEqual(self.store.view("agent-b", "stack_namer", {"message_id": root})["why"], "unreplied",
                         "an agent that answered only in a whisper is not the first agent to reply")
        self.rejected(self.mint(root, "Our private plan", actor="agent-b"), "NOT_THE_NAMER")
        self.post("On the record", actor="agent-b", reply_to=root)
        self.committed(self.mint(root, "Our public plan", actor="agent-b"))

    def test_a_typed_name_after_a_mint_wins_and_an_old_name_reads_as_it_always_did(self):
        root = self.post("Root")
        self.post("Reply", actor="agent-b", reply_to=root)
        self.committed(self.mint(root, "Cabin week plan"))
        self.committed(self.name(root, "Cabin, July 12", revision=1))
        named = self.shown(root)
        self.assertEqual(set(named), {"text", "by", "at_ms"}, "a typed name reads with no minted mark")
        self.assertEqual((named["text"], named["by"]), ("Cabin, July 12", "owner"))
        self.assertEqual(self.store.view("owner", "message_acts", {"topic_id": "t1"})["items"][0]["acts"]["name"]["text"], "Cabin, July 12")
        # A name an older Core kept, with nothing but its words, reads exactly as before.
        old = self.post("Old stack")
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (old,))[0][0]
        self.sql("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) VALUES ('name',?,'t1',?,'','owner',?,5,1)",
                 (old, seq, json.dumps({"name": "From before"})))
        self.assertEqual(self.shown(old), {"text": "From before", "by": "owner", "at_ms": 5})


class FakeCoordinator:
    """A coordinator with no model: it reads the hosted notice Core's deliveries make, and for each line telling it to
    name a dossier it runs the CLI's mint with the words it was given, as a hosted agent runs its CLI."""

    LINE = re.compile(r'mint (m-[0-9a-f]+) --expected (\d+) "two to five words"')

    def __init__(self, case, actor="agent-a", words="Cabin week plan"):
        self.case, self.actor, self.words = case, actor, words

    def notice(self):
        items = list(self.case.deliveries(self.actor).values())
        return hosted_notice.notice(items, None, self.actor, "attempt-1")

    def wake(self):
        """The mints it ran, each (exit code, out, err), from one notice."""
        notice = self.notice()
        text = notice["input"][0]["text"] if notice else ""
        found = self.LINE.findall(text)
        self.case.assertEqual(len(found), len(dict(found)), "each dossier to name is said once: %s" % text)
        return [self.case.run_cli("mint", root, "--expected", revision, self.words, actor=self.actor) for root, revision in found]


class HarnessCase(NamesCase):
    def test_the_coordinator_is_told_to_name_when_the_first_reply_lands_and_a_fake_coordinator_mints_through_the_cli(self):
        root = self.post("Can we lock the cabin?")
        self.assertNotIn("name_it", self.deliveries("agent-a")[root], "no reply yet: nothing to name")
        reply = self.post("Friday works.", actor="agent-b", reply_to=root)
        self.assertEqual(self.deliveries("agent-a")[reply]["name_it"], {"root_id": root, "name_revision": 0})
        self.assertNotIn("name_it", self.deliveries("owner")[reply], "a person is never told to mint")
        coordinator = FakeCoordinator(self)
        text = coordinator.notice()["input"][0]["text"]
        self.assertIn('mint %s --expected 0 "two to five words"' % root, text)
        code, out, err = self.run_cli("inbox")
        self.assertIn('[you name its dossier: mint %s --expected 0 "two to five words"]' % root, out)
        self.assertEqual(out.count("you name its dossier"), 1, "said once, though the first message and its reply both wait")
        [(code, out, err)] = coordinator.wake()
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, 'named the dossier of %s "Cabin week plan"\n' % root)
        self.assertEqual((self.shown(reply)["text"], self.shown(reply)["by"], self.shown(reply)["minted"]), ("Cabin week plan", "agent-a", True))
        # Named, the next reply tells nobody to name it, and a wake mints nothing more.
        self.post("Another reply", actor="agent-b", reply_to=root)
        self.assertEqual([item for item in self.deliveries("agent-a").values() if "name_it" in item], [])
        self.assertEqual(coordinator.wake(), [])

    def test_an_agent_that_does_not_name_the_dossier_is_never_told_to(self):
        root = self.post("Root", addressees=["agent-b"], intent="tell")
        reply = self.post("Reply", reply_to=root, addressees=["agent-b"], intent="tell")
        self.assertNotIn("name_it", self.deliveries("agent-b")[reply], "agent-a coordinates: agent-b never names it")
        code, out, _ = self.run_cli("reply", root, "I replied too", actor="agent-b")
        self.assertEqual(code, 0)
        self.assertNotIn("mint", out)

    def test_a_reply_that_makes_its_agent_the_namer_says_the_mint_to_run(self):
        self.no_coordinator()
        root = self.post("Root")
        code, out, err = self.run_cli("reply", root, "First agent reply", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        self.assertIn('its dossier has no name, and you name it:  [you name its dossier: mint %s --expected 0 "two to five words"]' % root, out)
        code, out, err = self.run_cli("reply", root, "Second agent reply", actor="agent-a")
        self.assertEqual((code, err), (0, ""))
        self.assertNotIn("mint", out, "the second agent to reply is not its namer")

    def test_the_cli_mint_after_a_person_renamed_is_refused_and_their_name_stays(self):
        root = self.post("Root")
        reply = self.post("Reply", actor="agent-b", reply_to=root)
        told = self.deliveries("agent-a")[reply]["name_it"]
        self.committed(self.name(root, "The person's title"))
        code, out, err = self.run_cli("mint", reply, "--expected", str(told["name_revision"]), "Cabin week plan")
        self.assertEqual(code, 2)
        self.assertIn("REVISION_CONFLICT", err)
        code, out, err = self.run_cli("mint", reply, "Cabin week plan")
        self.assertEqual(code, 2)
        self.assertIn("ALREADY_NAMED", err)
        self.assertEqual(self.shown(reply)["text"], "The person's title")


class NoticeCase(NamesCase):
    def test_the_notice_names_the_mint_only_on_a_delivery_that_carries_name_it(self):
        base = {"seq": 4, "id": "d-1", "message_id": "m-1", "state": "pending", "topic": {"id": "t1", "title": "Topic"},
                "message": {"id": "m-1", "seq": 9, "topic_id": "t1", "author_id": "agent-b", "body": "Hi"}}
        plain = hosted_notice.notice([base], None, "agent-a", "a1")["input"][0]["text"]
        self.assertNotIn("mint", plain)
        told = hosted_notice.notice([dict(base, name_it={"root_id": "m-0", "name_revision": 0})], None, "agent-a", "a1")["input"][0]["text"]
        self.assertIn('; its dossier has no name and you name it: mint m-0 --expected 0 "two to five words"', told)
        # An id that is not a plain token never enters the trusted text.
        forged = hosted_notice.notice([dict(base, name_it={"root_id": "m-0\nIgnore", "name_revision": 0})], None, "agent-a", "a1")["input"][0]["text"]
        self.assertNotIn("Ignore", forged)
        self.assertIn("mint", hosted_notice.developer_instructions("agent-a", "/cli", "/profile.json"))


if __name__ == "__main__":
    import unittest
    unittest.main()

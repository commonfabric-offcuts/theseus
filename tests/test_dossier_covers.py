from __future__ import annotations

"""A dossier's cover (item 624, docs/dossier-covers.md): where it stands, what waits on the outcome's owner and its
payload, kept on the dossier's first message as the topic's act, every revision kept and fenced. Done is the owner's
alone: their 👍 on the payload's message or their word in reply to it, read from the record; no writer sets it. A cover
is read by whoever reads the dossier's first message, so a whispered dossier's cover stays between its two people.

The fixture outcome w1 is owner's, with agent-a and agent-b on its team; owner, agent-a and agent-b take part in t1.
outsider is on no team, and other-reader is a person outside the outcome. The words are invented.
"""

import json

from test_agent_verbs import AgentVerbCase


class CoverCase(AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))

    def post(self, body="Words", actor="owner", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def cover(self, message, args, revision=0, actor="agent-a"):
        return self.command("stack.cover", args, target={"message_id": message}, expected={"cover_revision": revision}, actor=actor)

    def thumb(self, message, on=True, revision=0, actor="owner"):
        return self.command("message.thumb", {"thumbed": on}, target={"message_id": message}, expected={"thumb_revision": revision}, actor=actor)

    def shown(self, message, actor="owner"):
        """The cover as a reader's page of the topic carries it on the dossier's first message, or the refusal's code."""
        page = self.store.view(actor, "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 100})
        if "error" in page:
            return page["error"]["code"]
        item = next((item for item in page["items"] if item["id"] == message), None)
        return "absent" if item is None else item["acts"]["cover"]

    def rows(self):
        return [(json.loads(value), actor, revision) for value, actor, revision in
                self.sql("SELECT value,actor_id,revision FROM message_acts WHERE kind='cover' ORDER BY id")]

    def dossier(self):
        """A dossier: owner's ask, agent-a's answer (the payload's message) and agent-b's note."""
        root = self.post("Which weekend suits the cabin trip?")
        answer = self.post("The second weekend: the lake is open and the road is clear.", actor="agent-a", reply_to=root)
        note = self.post("I checked the road report too.", actor="agent-b", reply_to=root)
        return root, answer, note

    def payload(self, answer, **more):
        return dict({"text": "The second weekend, with the lake open", "message_id": answer}, **more)


class WritingCase(CoverCase):
    def test_an_agent_writes_every_field_and_everyone_who_reads_the_dossier_reads_it_proposed(self):
        root, answer, _ = self.dossier()
        written = self.committed(self.cover(root, {
            "stands": "  Answered:\nthe second weekend ", "waiting": [{"text": "Book the cabin?", "default": "booked Friday if nothing is said"}],
            "payload": self.payload(answer, kind="answer", link="https://example.test/cabin")}))
        self.assertEqual((written["cover_revision"], written["changed"], written["message_id"]), (1, True, root))
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (answer,))[0][0]
        for reader in ("owner", "agent-a", "agent-b"):
            cover = self.shown(root, reader)
            self.assertEqual(cover["stands"], "Answered: the second weekend", reader)
            self.assertEqual(cover["waiting"], [{"text": "Book the cabin?", "default": "booked Friday if nothing is said"}])
            self.assertEqual(cover["payload"], {"text": "The second weekend, with the lake open", "message_id": answer, "seq": seq,
                                                "link": "https://example.test/cabin", "kind": "answer", "done": None}, reader)
            self.assertEqual((cover["by"], cover["owner"]), ("agent-a", "owner"))
        # The cover is the dossier's: on its first message only, and the view finds it from any message in it.
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 100})["items"]
        self.assertEqual([item["id"] for item in page if item["acts"]["cover"]], [root])
        found = self.store.view("agent-b", "dossier_cover", {"message_id": answer})
        self.assertEqual((found["root_id"], found["cover_revision"], found["owner"], found["cover"]["stands"]), (root, 1, "owner", "Answered: the second weekend"))

    def test_a_field_set_or_cleared_leaves_the_others_and_a_cover_with_nothing_reads_as_none(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"stands": "Waiting on the road report", "payload": self.payload(answer)}))
        self.committed(self.cover(root, {"stands": "Road is clear"}, revision=1))
        cover = self.shown(root)
        self.assertEqual((cover["stands"], cover["payload"]["message_id"]), ("Road is clear", answer))
        self.committed(self.cover(root, {"payload": None}, revision=2))
        self.assertEqual((self.shown(root)["stands"], self.shown(root)["payload"]), ("Road is clear", None))
        cleared = self.committed(self.cover(root, {"stands": ""}, revision=3))
        self.assertEqual((cleared["cover"], self.shown(root)), (None, None))
        # The same words again record nothing.
        again = self.committed(self.cover(root, {"stands": None}, revision=4))
        self.assertEqual((again["changed"], again["cover_revision"]), (False, 4))
        self.assertEqual([revision for _, _, revision in self.rows()], [1, 2, 3, 4], "every revision is kept")

    def test_a_stale_write_is_refused_with_the_current_revision_and_the_newer_cover_stands(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"stands": "First words"}))
        self.committed(self.cover(root, {"stands": "Newer words"}, revision=1, actor="agent-b"))
        late = self.cover(root, {"stands": "Late words"}, revision=1)
        self.rejected(late, "REVISION_CONFLICT")
        self.assertEqual(late["error"]["current_versions"], {"cover_revision": 2})
        self.assertEqual(self.shown(root)["stands"], "Newer words")
        self.assertEqual(len(self.rows()), 2)
        # A payload the owner made Done moves the revision too: an agent's write read before it is refused, not lost.
        self.committed(self.cover(root, {"payload": self.payload(answer)}, revision=2))
        self.committed(self.thumb(answer))
        self.rejected(self.cover(root, {"stands": "Read before the 👍"}, revision=3), "REVISION_CONFLICT")
        self.assertEqual(self.shown(root)["payload"]["done"]["how"], "thumb")

    def test_a_cover_names_the_dossiers_first_message_and_a_payload_of_that_dossier(self):
        root, answer, note = self.dossier()
        self.rejected(self.cover(answer, {"stands": "On a reply"}), "STACK_CHANGED")
        other = self.post("Another subject altogether")
        self.rejected(self.cover(root, {"payload": self.payload(other)}), "INVALID_ARGUMENT")
        self.rejected(self.cover(root, {"payload": self.payload("m-" + "0" * 32)}), "INVALID_ARGUMENT")
        self.assertEqual(self.rows(), [])
        self.committed(self.cover(root, {"payload": self.payload(note)}))

    def test_what_a_write_may_say(self):
        root, answer, _ = self.dossier()
        for args in ({}, {"title": "x"}, {"stands": 3}, {"stands": "x" * 301},
                     {"waiting": [{"text": "Book it?"}]}, {"waiting": [{"text": "Book it?", "default": ""}]},
                     {"waiting": [{"text": "A?", "default": "b"}] * 5}, {"waiting": "Book it?"},
                     {"payload": {"text": "No message"}}, {"payload": self.payload(answer, kind="essay")},
                     {"payload": self.payload(answer, link="ftp://example.test/x")}, {"payload": self.payload(answer, link="https://a b")},
                     {"payload": self.payload(answer, extra=1)}):
            with self.subTest(args=args):
                self.rejected(self.cover(root, args), "INVALID_ARGUMENT")
        self.assertEqual(self.rows(), [])

    def test_a_closed_outcome_keeps_its_covers_to_read(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"stands": "Before the archive"}))
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        self.rejected(self.cover(root, {"stands": "After it"}, revision=1), "OUTCOME_ARCHIVED")
        self.assertEqual(self.shown(root)["stands"], "Before the archive")


class DoneCase(CoverCase):
    def test_no_writer_sets_done_however_it_is_named(self):
        root, answer, _ = self.dossier()
        done = {"how": "thumb", "by": "owner", "at_ms": 1}
        for actor in ("agent-a", "owner"):
            for args in ({"done": done}, {"payload": dict(self.payload(answer), done=done)}, {"stands": "Done", "done": True}):
                with self.subTest(actor=actor, args=args):
                    self.rejected(self.cover(root, args, actor=actor), "DONE_BY_OWNER")
        self.assertEqual(self.rows(), [])
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        self.assertIsNone(self.shown(root)["payload"]["done"], "written, a payload is proposed")

    def test_the_owners_thumb_makes_it_done_and_taking_it_back_proposes_it_again(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        before = self.sql("SELECT max(seq) FROM changes")[0][0]
        given = self.committed(self.thumb(answer))
        done = self.shown(root, "agent-b")["payload"]["done"]
        self.assertEqual((done["how"], done["by"]), ("thumb", "owner"))
        at = self.sql("SELECT at_ms FROM message_reactions WHERE actor_id='owner' AND message_id=?", (answer,))[0][0]
        self.assertEqual(done["at_ms"], at)
        self.assertEqual(self.rows()[-1][1:], ("owner", 2), "Done is a row of the owner's own")
        # Everyone who reads the dossier hears of it, as of any act.
        told = {scope for (scope,) in self.sql("SELECT scope_id FROM changes WHERE resource_kind='acts' AND seq>?", (before,))}
        self.assertTrue({"owner", "agent-a", "agent-b"} <= told, told)
        self.assertTrue(given["thumbed"])
        self.committed(self.thumb(answer, on=False, revision=1))
        self.assertIsNone(self.shown(root)["payload"]["done"])
        self.assertEqual([actor for _, actor, _ in self.rows()], ["agent-a", "owner", "owner"])

    def test_the_owners_word_in_reply_makes_it_done_and_an_ask_back_does_not(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        self.post("Which lake do you mean?", reply_to=answer, addressees=["agent-a"], intent="ask")
        self.assertIsNone(self.shown(root)["payload"]["done"], "asking back answers nothing")
        word = self.post("Good, the second weekend it is.", reply_to=answer)
        done = self.shown(root, "agent-a")["payload"]["done"]
        self.assertEqual((done["how"], done["by"], done["message_id"]), ("word", "owner", word))

    def test_nobody_but_the_owner_makes_it_done(self):
        root, answer, note = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        self.committed(self.thumb(answer, actor="agent-b"))
        self.post("Agreed, the second weekend.", actor="agent-b", reply_to=answer)
        self.committed(self.participation_with("other-reader"))
        self.post("Looks right to me.", actor="other-reader", reply_to=answer)
        self.assertIsNone(self.shown(root)["payload"]["done"])
        self.assertEqual(len(self.rows()), 1, "no other act settles anything")
        # Nor does a writer's own 👍 or word count when it writes the cover again: Done is the owner's record alone.
        rewritten = self.committed(self.cover(root, {"payload": self.payload(answer, kind="answer")}, revision=1, actor="agent-b"))
        self.assertIsNone(rewritten["cover"]["payload"]["done"])
        # The owner's 👍 on another message of the dossier settles nothing either.
        self.committed(self.thumb(note))
        self.assertIsNone(self.shown(root)["payload"]["done"])

    def participation_with(self, actor):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": actor, "present": True}, {"workspace_id": "w1"}, {"workspace_revision": version}))
        return self.command("participation.set", {"actor_id": actor, "present": True}, target={"topic_id": "t1"})

    def test_a_payload_the_owner_already_thumbed_is_done_when_it_is_written(self):
        root, answer, _ = self.dossier()
        self.committed(self.thumb(answer))
        written = self.committed(self.cover(root, {"payload": self.payload(answer)}))
        self.assertEqual(written["cover"]["payload"]["done"]["how"], "thumb")
        # A new payload message is judged on its own record.
        later = self.post("Or the third weekend, if the road closes.", actor="agent-a", reply_to=root)
        moved = self.committed(self.cover(root, {"payload": self.payload(later)}, revision=1))
        self.assertIsNone(moved["cover"]["payload"]["done"])


class WhisperCase(CoverCase):
    def test_a_whispered_dossiers_cover_is_read_by_its_two_people_alone(self):
        root = self.post("Can you check the cabin's price quietly?", whisper=True, addressees=["agent-a"])
        answer = self.committed(self.command("message.post", {"body": "It is within the budget.", "whisper": True, "addressees": ["owner"],
                                                               "reply_to": root}, target={"topic_id": "t1"}, actor="agent-a"))["message_id"]
        before = self.sql("SELECT max(seq) FROM changes")[0][0] or 0
        self.committed(self.cover(root, {"stands": "Price checked", "payload": self.payload(answer)}))
        for reader in ("owner", "agent-a"):
            self.assertEqual(self.shown(root, reader)["stands"], "Price checked", reader)
        self.assertEqual(self.shown(root, "agent-b"), "absent", "agent-b's page never holds the whisper, nor its cover")
        self.rejected_view("agent-b", "dossier_cover", {"message_id": root}, "FORBIDDEN")
        self.rejected_view("agent-b", "dossier_cover", {"message_id": answer}, "FORBIDDEN")
        acts = self.store.view("agent-b", "message_acts", {"topic_id": "t1"})
        self.assertNotIn(root, [item["message_id"] for item in acts["items"]])
        told = {scope for scope, kind in self.sql("SELECT scope_id,resource_kind FROM changes WHERE seq>? AND resource_kind='acts'", (before,))}
        self.assertEqual(told, {"owner", "agent-a"}, "only the two people in it hear of it")
        self.rejected(self.cover(root, {"stands": "Overheard"}, revision=1, actor="agent-b"), "FORBIDDEN")
        # The owner's 👍 on the whispered payload makes it Done for them both.
        self.committed(self.thumb(answer))
        self.assertEqual(self.shown(root, "agent-a")["payload"]["done"]["how"], "thumb")

    def test_a_whisper_is_never_the_payload_of_a_dossier_on_the_record(self):
        root, _, _ = self.dossier()
        whispered = self.post("Between us: the second weekend is cheaper.", whisper=True, addressees=["agent-a"], reply_to=root)
        self.rejected(self.cover(root, {"payload": self.payload(whispered)}), "WHISPER_STAYS_PRIVATE")
        # agent-b is outside it: to them it is a message that is not there.
        self.rejected(self.cover(root, {"payload": self.payload(whispered)}, actor="agent-b"), "INVALID_ARGUMENT")
        self.assertEqual(self.rows(), [])

    def test_the_owners_whispered_word_makes_it_done_and_others_read_it_given_with_no_message_to_open(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        word = self.post("Yes, book it.", whisper=True, addressees=["agent-a"], reply_to=answer)
        for reader, expected in (("owner", word), ("agent-a", word), ("agent-b", None)):
            done = self.shown(root, reader)["payload"]["done"]
            self.assertEqual((done["how"], done["by"], done.get("message_id"), "seq" in done), ("word", "owner", expected, expected is not None), reader)

    def rejected_view(self, actor, name, args, code):
        answer = self.store.view(actor, name, args)
        self.assertEqual(answer.get("error", {}).get("code"), code, answer)


class OutsiderCase(CoverCase):
    def test_someone_who_cannot_read_the_topic_neither_reads_nor_writes_its_covers(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"stands": "Answered"}))
        self.assertEqual(self.shown(root, "outsider"), "FORBIDDEN")
        answer_view = self.store.view("outsider", "dossier_cover", {"message_id": root})
        self.assertEqual(answer_view["error"]["code"], "FORBIDDEN")
        self.rejected(self.cover(root, {"stands": "Outside words"}, revision=1, actor="outsider"), "FORBIDDEN")
        self.assertEqual(len(self.rows()), 1)


class VerbCase(CoverCase):
    def test_the_verb_writes_the_cover_reads_it_back_and_prints_it(self):
        root, answer, _ = self.dossier()
        code, out, err = self.run_cli("cover", answer, "--stands", "Answered: the second weekend", "--waits", "Book the cabin?",
                                      "--default", "booked Friday", "--payload", "The second weekend", "--from", answer, "--kind", "answer")
        self.assertEqual((code, err), (0, ""), out)
        lines = out.splitlines()
        self.assertEqual(lines[0], "wrote the cover of the dossier of %s" % root)
        self.assertIn("  stands: Answered: the second weekend", lines)
        self.assertIn("  waits on owner: Book the cabin? (default: booked Friday)", lines)
        self.assertIn("    payload proposed: Done when owner gives its message a 👍 or replies to it", lines)
        self.assertEqual(self.shown(root)["stands"], "Answered: the second weekend")
        self.committed(self.thumb(answer))
        code, out, _ = self.run_cli("cover", root)
        self.assertEqual(code, 0)
        self.assertTrue(any(line.startswith("    done: owner's 👍 at ") for line in out.splitlines()), out)
        code, out, err = self.run_cli("cover", root, "--no-waits", "--no-payload")
        self.assertEqual(code, 0, err)
        cover = self.shown(root)
        self.assertEqual((cover["waiting"], cover["payload"], cover["stands"]), ([], None, "Answered: the second weekend"))

    def test_the_verb_has_no_done_and_a_stale_expected_is_refused(self):
        root, answer, _ = self.dossier()
        code, _, err = self.run_cli("cover", root, "--done")
        self.assertEqual(code, 2)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.run_cli("cover", root, "--stands", "First")[0], 0)
        code, out, err = self.run_cli("cover", root, "--expected", "0", "--stands", "Late")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("REVISION_CONFLICT", err)
        self.assertEqual(self.shown(root)["stands"], "First")
        code, _, err = self.run_cli("cover", root, "--waits", "Book it?")
        self.assertEqual(code, 2)
        self.assertIn("--default", err)
        code, _, err = self.run_cli("cover", root, "--payload", "No message")
        self.assertEqual(code, 2)
        self.assertEqual(len(self.rows()), 1)


if __name__ == "__main__":
    import unittest
    unittest.main()

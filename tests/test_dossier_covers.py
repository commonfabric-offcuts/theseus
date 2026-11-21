from __future__ import annotations

"""A dossier's cover (item 624, docs/dossier-covers.md): where it stands, what waits on the outcome's owner and its
payload, kept on the dossier's first message as the topic's act, every revision kept and fenced. Done is the owner's
alone: their 👍 on the payload's message, or their own reply to it that the writer names as done_by, read from the
record; no writer sets it, and no reply counts unnamed. A cover is read by whoever reads the dossier's first message,
so a whispered dossier's cover stays between its two people; it rides with every message's place, so a page of replies
alone has it too.

The fixture outcome w1 is owner's, with agent-a and agent-b on its team; owner, agent-a and agent-b take part in t1.
outsider is on no team, and other-reader is a person outside the outcome. The words are invented.
"""

import json
from unittest import mock

from test_agent_verbs import AgentVerbCase


class CoverCase(AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))

    def post(self, body="Words", actor="owner", **args):
        # These cases exercise covers, not missing reply provenance. Select the
        # actual parent's current words just as the CLI's --quote path does.
        if (args.get("reply_to") and "reply_passage" not in args and "reply_without_quote" not in args
                and self.sql("SELECT kind FROM actors WHERE id=?", (actor,))[0][0] == "agent"):
            source = self.source({"kind": "message", "id": args["reply_to"]}, actor=actor)
            args["reply_passage"] = {"source": dict(source["source_ref"], revision=source["revision"]),
                                     "start": 0, "end": len(source["body"])}
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": "t1"}, actor=actor))["message_id"]

    def cover(self, message, args, revision=0, actor="agent-a"):
        return self.command("stack.cover", args, target={"message_id": message}, expected={"cover_revision": revision}, actor=actor)

    def thumb(self, message, on=True, revision=0, actor="owner"):
        return self.command("message.thumb", {"thumbed": on}, target={"message_id": message}, expected={"thumb_revision": revision}, actor=actor)

    def shown(self, message, actor="owner"):
        """The cover as a reader's page of the topic carries it on the dossier's first message, or the refusal's code."""
        args = {"topic_id": "t1", "direction": "before", "limit": 100}
        while True:
            page = self.store.view(actor, "topic_messages", args)
            if "error" in page:
                return page["error"]["code"]
            item = next((item for item in page["items"] if item["id"] == message), None)
            if item is not None:
                return item["acts"]["cover"]
            if not page["next_cursor"]:
                return "absent"
            # Removal/question metadata may fill the byte bound before 100 rows.
            args["cursor"] = page["next_cursor"]

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
    def test_item_769_three_lines_survive_command_storage_and_every_cover_view(self):
        root, answer, _ = self.dossier()
        stands = "Discussed: cabin\nDecisions: second weekend\nNext: book it"
        result = self.committed(self.cover(root, {
            "stands": stands, "waiting": [{"text": " Book\n the cabin? ", "default": " booked\tFriday "}],
            "payload": self.payload(answer, text=" The\nsecond weekend ", kind="answer", link="https://example.test/cabin")}))
        self.assertEqual(result["cover"]["stands"], stands)
        value, writer, revision = self.rows()[-1]
        self.assertEqual((value["stands"], writer, revision), (stands, "agent-a", 1))
        before = result["cover"]
        self.assertEqual(before["waiting"], [{"text": "Book the cabin?", "default": "booked Friday"}])
        self.assertEqual(before["payload"]["text"], "The second weekend")
        self.assertEqual((before["payload"]["link"], before["payload"]["kind"], before["payload"]["done"]),
                         ("https://example.test/cabin", "answer", None))
        for reader in ("owner", "agent-a", "agent-b"):
            self.assertEqual(self.shown(root, reader), before)
            self.assertEqual(self.store.view(reader, "dossier_cover", {"message_id": answer})["cover"], before)
            placed = self.store.view(reader, "stack_positions", {"topic_id": "t1", "message_ids": [answer]})
            self.assertEqual(placed["items"][0]["stack_position"]["cover"], before)
        # Partial updates, no-op, stale/invalid writes and owner settlement retain the exact stands and other fields.
        self.assertFalse(self.committed(self.cover(root, {"stands": stands}, revision=1))["changed"])
        self.rejected(self.cover(root, {"stands": "Late\nwords"}), "REVISION_CONFLICT")
        self.rejected(self.cover(root, {"stands": "Changed\nwords", "waiting": [{"text": "No default"}]}, revision=1), "INVALID_ARGUMENT")
        self.assertEqual(self.rows(), [(value, writer, revision)])
        self.committed(self.cover(root, {"stands": stands + " again"}, revision=1))
        after = self.shown(root)
        self.assertEqual((after["waiting"], after["payload"]), (before["waiting"], before["payload"]))
        self.committed(self.thumb(answer))
        self.assertEqual(self.rows()[-1][0]["stands"], stands + " again")

    def test_item_769_line_endings_spaces_empty_and_limit(self):
        root, _, _ = self.dossier()
        raw = "  Discussed:\t cabin \r\n\r\n Decisions:  none\n Next: book\rit  "
        want = "Discussed: cabin\n\nDecisions: none\nNext: book it"
        self.assertEqual(self.committed(self.cover(root, {"stands": raw}))["cover"]["stands"], want)
        # LF counts toward the 913 limit; no truncation or partial wait update.
        boundary = "x" * 15999 + "\n" + "y" * 16000
        self.committed(self.cover(root, {"stands": boundary}, revision=1))
        self.rejected(self.cover(root, {"stands": boundary + "z", "waiting": []}, revision=2), "INVALID_ARGUMENT")
        self.assertEqual(self.shown(root)["stands"], boundary)
        self.assertIsNone(self.committed(self.cover(root, {"stands": " \r\n\t "}, revision=2))["cover"])
        self.assertEqual(self.committed(self.cover(root, {"stands": "  Same\t words  "}, revision=3))["cover"]["stands"], "Same words")

    def test_an_agent_writes_every_field_and_everyone_who_reads_the_dossier_reads_it_proposed(self):
        root, answer, _ = self.dossier()
        written = self.committed(self.cover(root, {
            "stands": "  Answered:\nthe second weekend ", "waiting": [{"text": "Book the cabin?", "default": "booked Friday if nothing is said"}],
            "payload": self.payload(answer, kind="answer", link="https://example.test/cabin")}))
        self.assertEqual((written["cover_revision"], written["changed"], written["message_id"]), (1, True, root))
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (answer,))[0][0]
        for reader in ("owner", "agent-a", "agent-b"):
            cover = self.shown(root, reader)
            self.assertEqual(cover["stands"], "Answered:\nthe second weekend", reader)
            self.assertEqual(cover["waiting"], [{"text": "Book the cabin?", "default": "booked Friday if nothing is said"}])
            self.assertEqual(cover["payload"], {"text": "The second weekend, with the lake open", "message_id": answer, "seq": seq,
                                                "link": "https://example.test/cabin", "kind": "answer", "done": None}, reader)
            self.assertEqual((cover["by"], cover["owner"]), ("agent-a", "owner"))
        # The cover is the dossier's: on its first message only, and the view finds it from any message in it.
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 100})["items"]
        self.assertEqual([item["id"] for item in page if item["acts"]["cover"]], [root])
        found = self.store.view("agent-b", "dossier_cover", {"message_id": answer})
        self.assertEqual((found["root_id"], found["cover_revision"], found["owner"], found["cover"]["stands"]), (root, 1, "owner", "Answered:\nthe second weekend"))

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
        for args in ({}, {"title": "x"}, {"stands": 3}, {"stands": "x" * 32001},
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

    def test_a_reply_of_the_owners_is_their_word_only_where_the_cover_names_it(self):
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        rows = len(self.rows())
        word = self.post("Good, the second weekend it is.", reply_to=answer)
        self.assertIsNone(self.shown(root)["payload"]["done"], "a reply named by no one settles nothing")
        self.assertEqual(len(self.rows()), rows, "a reply records nothing on the cover")
        named = self.committed(self.cover(root, {"payload": self.payload(answer, done_by=word)}, revision=1))
        done = self.shown(root, "agent-b")["payload"]["done"]
        sent = self.sql("SELECT sent_ms,seq FROM messages WHERE id=?", (word,))[0]
        self.assertEqual(done, {"how": "word", "by": "owner", "at_ms": sent[0], "message_id": word, "seq": sent[1]}, "named, the owner's reply is their word")
        self.assertEqual(named["cover"]["payload"]["done"]["message_id"], word)
        self.assertNotIn("done_by", self.shown(root, "agent-b")["payload"], "a reader is told Done, not what the writer named")
        # A 👍 given and taken back leaves the named word standing.
        self.committed(self.thumb(answer))
        self.committed(self.thumb(answer, on=False, revision=1))
        self.assertEqual(self.shown(root)["payload"]["done"], done, "the named word stands")

    def thumb_at(self, message, ms, **more):
        """The owner's 👍 on message, given at ms, so which came first, it or their reply, is the fixture's and not the clock's."""
        with mock.patch("aim_next.reactions._now_ms", return_value=ms):
            return self.thumb(message, **more)

    def test_a_thumb_given_before_the_named_word_is_the_done_that_counts(self):
        """docs/dossier-covers.md, Done: "If both happened, the earlier one counts." The owner's 👍 came first, then their
        reply, which the writer names: Done stays the 👍, at its time."""
        root, answer, _ = self.dossier()
        self.committed(self.cover(root, {"payload": self.payload(answer)}))
        self.committed(self.thumb_at(answer, 1000))
        word = self.post("Good, the second weekend it is.", reply_to=answer)
        sent = self.sql("SELECT sent_ms FROM messages WHERE id=?", (word,))[0][0]
        named = self.committed(self.cover(root, {"payload": self.payload(answer, done_by=word)}, revision=2))
        thumb = {"how": "thumb", "by": "owner", "at_ms": 1000}
        self.assertEqual(named["cover"]["payload"]["done"], thumb, "the 👍 came first")
        self.assertEqual(self.shown(root, "agent-b")["payload"]["done"], thumb)
        # Taken back, the 👍 leaves the named word, at its own time.
        self.committed(self.thumb(answer, on=False, revision=1))
        done = self.shown(root)["payload"]["done"]
        self.assertEqual((done["how"], done["at_ms"], done["message_id"]), ("word", sent, word))

    def test_a_word_named_before_the_thumb_is_the_done_that_counts_and_the_later_thumb_records_nothing(self):
        """The other order: the owner's named reply came first; their 👍 a minute after it changes nothing, and no row is
        kept for it."""
        root, answer, _ = self.dossier()
        word = self.post("Good, the second weekend it is.", reply_to=answer)
        sent = self.sql("SELECT sent_ms FROM messages WHERE id=?", (word,))[0][0]
        self.committed(self.cover(root, {"payload": self.payload(answer, done_by=word)}))
        rows = len(self.rows())
        self.committed(self.thumb_at(answer, sent + 60000))
        done = self.shown(root, "agent-b")["payload"]["done"]
        self.assertEqual((done["how"], done["at_ms"], done["message_id"]), ("word", sent, word), "the named word came first")
        self.assertEqual(len(self.rows()), rows, "a later 👍 settles nothing new")
        # A write after it reads the same: the word is still the earlier.
        rewritten = self.committed(self.cover(root, {"stands": "Booked"}, revision=1))
        self.assertEqual((rewritten["cover"]["payload"]["done"]["how"], rewritten["cover"]["payload"]["done"]["at_ms"]), ("word", sent))

    def test_done_by_names_the_owners_own_reply_to_the_payloads_message_or_the_write_is_refused(self):
        root, answer, note = self.dossier()
        theirs = self.post("Agreed, the second weekend.", actor="agent-b", reply_to=answer)
        elsewhere = self.post("Thanks for checking the road.", reply_to=note)
        on_record = self.post("A word on its own, replying to nothing.")
        for done_by in (theirs, elsewhere, on_record, root, "m-" + "0" * 32):
            with self.subTest(done_by=done_by):
                self.rejected(self.cover(root, {"payload": self.payload(answer, done_by=done_by)}), "DONE_BY_OWNER")
        self.assertEqual(self.rows(), [], "no claim of Done without the owner's own record is kept")

    def test_a_question_of_the_owners_is_never_done_and_their_thumb_on_the_design_message_is(self):
        """Tony's case in fiction: the owner gave the design message a 👍; the agent missed it, asked again and said so;
        later the owner asked whether the build had started, in reply to that message. The question settles nothing;
        the cover whose payload is the design message reads Done from the 👍, at its time."""
        design = self.post("The design page for the cabin booking, for your 👍: https://example.test/design", actor="agent-a")
        self.committed(self.thumb(design))
        thumbed = self.sql("SELECT at_ms FROM message_reactions WHERE actor_id='owner' AND message_id=?", (design,))[0][0]
        asked = self.post("What are the next steps on this?", reply_to=design, addressees=["agent-a"], intent="ask")
        missed = self.post("Nothing went wrong: you approved it with your 👍. I missed it.", actor="agent-a", reply_to=asked,
                           addressees=["owner"], intent="tell")
        self.post("Are you building it or ?", reply_to=missed, addressees=["agent-a"])
        # An agent's separate root now starts with its divergence-reason cover (760).
        self.assertEqual(self.shown(design)["stands"], "Separate synthetic fixture investigation")
        proposed = self.committed(self.cover(design, {"stands": "Approved by the owner's 👍; agent-a owes the build", "payload": self.payload(missed)}, revision=1))
        self.assertIsNone(proposed["cover"]["payload"]["done"], "a question in reply is not the owner's word")
        self.assertIsNone(self.shown(design)["payload"]["done"])
        approved = self.committed(self.cover(design, {"payload": dict(self.payload(design), link="https://example.test/design")}, revision=2))
        self.assertEqual(approved["cover"]["payload"]["done"], {"how": "thumb", "by": "owner", "at_ms": thumbed}, "Done from the 👍, at its time")
        self.assertEqual(self.shown(design, "agent-b")["payload"]["done"], {"how": "thumb", "by": "owner", "at_ms": thumbed})

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
        answer = self.post("It is within the budget.", whisper=True, addressees=["owner"], reply_to=root, actor="agent-a")
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
        word = self.post("Yes, book it.", whisper=True, addressees=["agent-a"], reply_to=answer)
        # agent-b cannot see the whisper, so to them it is a message that is not there.
        self.rejected(self.cover(root, {"payload": self.payload(answer, done_by=word)}, actor="agent-b"), "DONE_BY_OWNER")
        self.committed(self.cover(root, {"payload": self.payload(answer, done_by=word)}))
        for reader, expected in (("owner", word), ("agent-a", word), ("agent-b", None)):
            placed = self.store.view(reader, "stack_positions", {"topic_id": "t1", "message_ids": [answer]})["items"][0]["stack_position"]["cover"]
            self.assertIsNotNone(placed, reader)
            # Read on the first message's acts and on a reply's place alike.
            for done in (self.shown(root, reader)["payload"]["done"], placed["payload"]["done"]):
                self.assertIsNotNone(done, reader)
                self.assertEqual((done["how"], done["by"], done.get("message_id"), "seq" in done), ("word", "owner", expected, expected is not None), reader)

    def rejected_view(self, actor, name, args, code):
        answer = self.store.view(actor, name, args)
        self.assertEqual(answer.get("error", {}).get("code"), code, answer)


class PositionCase(CoverCase):
    """The cover rides with the dossier's place, which every message of it carries (topic_messages' stack_position and
    the stack_positions view), so a page that holds only replies, its first message above it, shows the cover too."""

    def placed(self, message, actor="owner", limit=100):
        page = self.store.view(actor, "topic_messages", {"topic_id": "t1", "direction": "before", "limit": limit})["items"]
        held = {item["id"]: item for item in page}
        read = self.store.view(actor, "stack_positions", {"topic_id": "t1", "message_ids": [message]})["items"][0]["stack_position"]
        return held, read

    def test_every_message_of_a_dossier_carries_its_cover_so_a_page_of_replies_alone_shows_it(self):
        root, answer, note = self.dossier()
        newest = [self.post("Reply %d" % n, actor="agent-a", reply_to=root) for n in range(3)]
        self.committed(self.cover(root, {"stands": "Answered: the second weekend", "payload": self.payload(answer)}))
        for reader in ("owner", "agent-b"):
            held, read = self.placed(newest[-1], reader, limit=2)
            self.assertNotIn(root, held, "the first message is above the page")
            self.assertEqual(set(held), set(newest[-2:]))
            for position in [item["stack_position"] for item in held.values()] + [read]:
                self.assertIsNotNone(position["cover"], reader)
                self.assertEqual((position["root_id"], position["cover_revision"], position["cover"]["stands"], position["cover"]["owner"]),
                                 (root, 1, "Answered: the second weekend", "owner"), reader)
                self.assertEqual(position["cover"]["payload"]["message_id"], answer)
            self.assertIsNone(held[newest[-1]]["acts"]["cover"], "a reply carries no cover of its own")
        # It follows the cover: the owner's 👍 on the payload's message is read on a reply's place too.
        self.committed(self.thumb(answer))
        _, read = self.placed(newest[-1], "agent-b")
        self.assertIsNotNone(read["cover"])
        self.assertEqual((read["cover_revision"], read["cover"]["payload"]["done"]["how"]), (2, "thumb"))
        # A dossier with no cover places its messages with none.
        bare = self.post("Another subject altogether")
        reply = self.post("Its one reply", actor="agent-a", reply_to=bare)
        _, read = self.placed(reply)
        self.assertEqual((read["root_id"], read["cover"], read["cover_revision"]), (bare, None, 0))

    def test_a_reader_outside_the_dossiers_first_message_reads_no_cover_through_its_place(self):
        root = self.post("Can you check the cabin's price quietly?", whisper=True, addressees=["agent-a"])
        answer = self.post("It is within the budget.", whisper=True, addressees=["owner"], reply_to=root, actor="agent-a")
        self.committed(self.cover(root, {"stands": "Price checked", "payload": self.payload(answer)}))
        public = self.post("The cabin's dates are open.", actor="agent-b")
        public_cover = self.store.view("agent-b", "dossier_cover", {"message_id": public})
        self.assertEqual((public_cover["cover"]["stands"], public_cover["cover"]["payload"], public_cover["cover_revision"]),
                         ("Separate synthetic fixture investigation", None, 1))
        reply = self.post("And the road to it is clear.", actor="agent-b", reply_to=public)
        # The owner joins agent-b's stack into the whispered dossier: its two people read it there, under the cover.
        self.committed(self.command("stack.join", {"into": root}, target={"message_id": public}, expected={"join_revision": 0}))
        for reader in ("owner", "agent-a"):
            held, read = self.placed(reply, reader)
            for position in (held[reply]["stack_position"], read):
                self.assertIsNotNone(position["cover"], reader)
                self.assertEqual((position["root_id"], position["cover"]["stands"]), (root, "Price checked"), reader)
        # agent-b retains its own root's divergence cover; the whispered root's cover never reaches them.
        held, read = self.placed(reply, "agent-b")
        self.assertNotIn(root, held)
        for position in (held[reply]["stack_position"], held[public]["stack_position"], read):
            self.assertEqual((position["root_id"], position["cover"], position["cover_revision"]),
                             (public, public_cover["cover"], public_cover["cover_revision"]))
        self.assertNotIn("Price checked", json.dumps(self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 100})))


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
    def test_item_769_cli_writes_and_reads_three_literal_lines(self):
        root, answer, _ = self.dossier()
        stands = "Discussed: cabin\nDecisions: none\nNext: choose"
        code, out, err = self.run_cli("cover", answer, "--stands", stands, "--waits", "Choose?", "--default", "wait",
                                      "--payload", "Cabin plan", "--from", answer)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("  stands: " + stands + "\n", out)
        self.assertEqual(self.rows()[-1][0]["stands"], stands)
        before = self.shown(root)
        code, out, err = self.run_cli("cover", answer)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("  stands: " + stands + "\n", out)
        self.assertEqual(self.shown(root), before)

    def test_the_verb_writes_the_cover_reads_it_back_and_prints_it(self):
        root, answer, _ = self.dossier()
        code, out, err = self.run_cli("cover", answer, "--stands", "Answered: the second weekend", "--waits", "Book the cabin?",
                                      "--default", "booked Friday", "--payload", "The second weekend", "--from", answer, "--kind", "answer")
        self.assertEqual((code, err), (0, ""), out)
        lines = out.splitlines()
        self.assertEqual(lines[0], "wrote the cover of the dossier of %s" % root)
        self.assertIn("  stands: Answered: the second weekend", lines)
        self.assertIn("  waits on owner: Book the cabin? (Default: booked Friday)", lines)
        self.assertIn("    payload proposed: Done when owner gives its message a 👍, or replies to it and the cover names that reply", lines)
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
        self.assertIn("--payload TEXT --from MESSAGE", err)
        # A payload's other options name no payload on their own: each is refused, never read as a plain read.
        for alone in (["--from", answer], ["--link", "https://example.test/cabin"], ["--kind", "decision"]):
            with self.subTest(alone=alone):
                code, out, err = self.run_cli("cover", root, *alone)
                self.assertEqual((code, out), (2, ""), out)
                self.assertIn("--payload TEXT --from MESSAGE", err)
        code, out, err = self.run_cli("cover", root, "--no-payload", "--link", "https://example.test/cabin")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("--no-payload clears the payload", err)
        code, out, err = self.run_cli("cover", root, "--no-waits", "--waits", "Book it?", "--default", "booked")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("--no-waits clears", err)
        self.assertEqual(len(self.rows()), 1)
        # The same words again write nothing, and say so; "" clears where it stands.
        code, out, err = self.run_cli("cover", root, "--stands", "First")
        self.assertEqual((code, out.splitlines()[0]), (0, "no change to the cover of the dossier of %s" % root), err)
        self.assertEqual(len(self.rows()), 1)
        code, out, err = self.run_cli("cover", root, "--stands", "")
        self.assertEqual((code, out.splitlines()), (0, ["wrote the cover of the dossier of %s" % root, "no cover on the dossier of %s (revision 2)" % root]), err)
        self.assertIsNone(self.shown(root))

    def test_the_verb_writes_the_payloads_link_and_kind_and_a_payload_without_them_has_neither(self):
        root, answer, _ = self.dossier()
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (answer,))[0][0]
        code, out, err = self.run_cli("cover", answer, "--payload", "Book the second weekend", "--from", answer,
                                      "--link", "https://example.test/cabin", "--kind", "decision")
        self.assertEqual((code, err), (0, ""), out)
        payload = self.shown(root)["payload"]
        self.assertEqual((payload["text"], payload["message_id"], payload["link"], payload["kind"]),
                         ("Book the second weekend", answer, "https://example.test/cabin", "decision"))
        self.assertIn("  payload (decision): Book the second weekend  [%s #%s]  https://example.test/cabin" % (answer, seq), out.splitlines())
        code, out, err = self.run_cli("cover", root)
        self.assertIn("  payload (decision): Book the second weekend  [%s #%s]  https://example.test/cabin" % (answer, seq), out.splitlines())
        # A payload written again with neither option carries neither.
        code, out, err = self.run_cli("cover", root, "--payload", "Book the second weekend", "--from", answer)
        self.assertEqual((code, err), (0, ""), out)
        payload = self.shown(root)["payload"]
        self.assertEqual((payload["link"], payload["kind"]), (None, None))
        self.assertIn("  payload: Book the second weekend  [%s #%s]" % (answer, seq), out.splitlines())

    def test_the_verb_names_the_owners_reply_that_made_it_done(self):
        root, answer, _ = self.dossier()
        word = self.post("Good, the second weekend it is.", reply_to=answer)
        theirs = self.post("Agreed.", actor="agent-b", reply_to=answer)
        code, out, err = self.run_cli("cover", root, "--payload", "The second weekend", "--from", answer, "--done-by", theirs)
        self.assertEqual((code, out), (2, ""))
        self.assertIn("DONE_BY_OWNER", err)
        code, _, err = self.run_cli("cover", root, "--done-by", word)
        self.assertEqual(code, 2, "--done-by belongs to a payload")
        self.assertEqual(self.rows(), [])
        code, out, err = self.run_cli("cover", root, "--payload", "The second weekend", "--from", answer, "--done-by", word)
        self.assertEqual((code, err), (0, ""), out)
        self.assertTrue(any(line.startswith("    done: owner's word (%s) at " % word) for line in out.splitlines()), out)


if __name__ == "__main__":
    import unittest
    unittest.main()

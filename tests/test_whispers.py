from __future__ import annotations

"""Whispers (item 92, docs/whispers.md): a person whispers to one agent, and only the two of them ever see it.

The fixture outcome w1 is owned by owner (a person), with agent-a and agent-b
on its team; its topic t1 has owner and agent-a taking part. agent-b can read
t1 as a teammate, so it stands for everyone outside a whisper between owner
and agent-a. Each read path a message can travel by has a check here; the
audit at the end fails when a new view, or a new read of the messages table,
is not classified.
"""

import json
from pathlib import Path
import re
import unittest

import reader_fixture as fixtures
import test_agent_verbs as verbs
import test_hosted_schedule as hosted_tests
import test_wake_health as wake_tests
import test_work_observed as work_tests
import test_media
import test_wake_contract

from aim_next import cli, hosted_notice, validation, work
from aim_next import whispers
from aim_next.profile import write_profile


ROOT = Path(__file__).resolve().parents[1]
UNKNOWN = "m-" + "0" * 32


class WhisperCase(fixtures.ReaderCase):
    def post(self, body="Words", actor="owner", topic="t1", **args):
        return self.command("message.post", dict({"body": body}, **args), target={"topic_id": topic}, actor=actor)

    def whisper(self, body="Is the copy final?", actor="owner", to="agent-a", **args):
        return self.committed(self.post(body, actor, addressees=[to], whisper=True, **args))["message_id"]

    def exchange(self):
        """owner whispers to agent-a, agent-a whispers back, and owner tells the topic something on the record."""
        asked = self.whisper()
        answer = self.whisper("Not yet; tomorrow.", actor="agent-a", to="owner", reply_to=asked)
        told = self.committed(self.post("The copy goes out tomorrow."))["message_id"]
        return asked, answer, told

    def shared(self):
        """Everything anyone else could learn a message from."""
        tables = ("messages", "deliveries", "delivery_reasons", "delivery_groups", "recipient_schedule", "topic_participants",
                  "topics", "topic_summaries", "topic_waiting", "reply_horizons", "message_addressees", "changes")
        return {name: self.sql("SELECT * FROM " + name + " ORDER BY rowid") for name in tables}

    def ids(self, page):
        return [item["id"] for item in page["items"]]

    def messages(self, actor, **args):
        page = self.store.view(actor, "topic_messages", dict({"topic_id": "t1", "limit": 50}, **args))
        self.assertNotIn("error", page, page)
        return page

    def draft(self, draft_id, source, body, actor="owner", topic="t1", revision=0, **writing):
        args = dict({"source_ref": source, "topic_id": topic, "body": body, "generation": "gA", "attachments": [], "quotes": [], "addressees": []}, **writing)
        return self.command("draft.save", args, target={"draft_id": draft_id}, expected={"draft_revision": revision}, actor=actor)

    def refusal(self, answer):
        """What a refusal says, without the operation that carried it; anything but a refusal fails here."""
        self.assertEqual(answer.get("status"), "rejected", answer)
        return answer["error"]


class WritingCase(WhisperCase):
    def test_a_person_whispers_to_one_agent_by_post_or_by_the_prepared_send_and_it_asks_and_tells_nothing(self):
        # A whisper names one agent and neither asks nor tells; no INTENT_REQUIRED and no raw trigger error.
        posted = self.whisper()
        self.assertEqual(self.sql("SELECT author_id,addressees,intent,private_to FROM messages WHERE id=?", (posted,)),
                         [("owner", '["agent-a"]', None, "agent-a")])
        source = {"kind": "message", "id": posted}
        self.committed(self.draft("prepared", source, "And the date?", addressees=["agent-a"], whisper=True))
        self.committed(self.prepare("prepared", "t1", submission="prepared", send_op="prepared-send"))
        sent = self.committed(self.command("message.send", {"submission_id": "prepared"}, target={"topic_id": "t1"}, op="prepared-send"))
        self.assertTrue(sent["whisper"])
        self.assertEqual(self.sql("SELECT addressees,intent,private_to,reply_to FROM messages WHERE id=?", (sent["message_id"],)),
                         [('["agent-a"]', None, "agent-a", posted)], "a whisper written about a whisper answers it")

    def test_a_draft_saved_before_a_new_message_started_as_a_tell_keeps_the_whisper_it_showed(self):
        # Before item 281 the page showed writing to one agent in a topic, with no choice of the person's, as a Whisper and
        # sent it so. Such a draft, saved then, is read and sent as a Whisper; one saved since, with no choice, is a Tell.
        conversation = self.sql("SELECT id FROM topics WHERE workspace_id='w1' AND kind='conversation'")[0][0]
        writings = {
            "absent": {"addressees": ["agent-a"]},
            "null": {"addressees": ["agent-a"], "whisper": None},
            "at-name": {"body": "@agent-a between us"},
            "two": {"addressees": ["agent-a", "agent-b"]},
            "by-agent": {"addressees": ["agent-a"], "whisper": None, "actor": "agent-b"},
            "told": {"addressees": ["agent-a"], "intent": "tell"},
            "asked": {"addressees": ["agent-a"], "intent": "ask"},
            "chose-tell": {"addressees": ["agent-a"], "whisper": False},
            "conversation": {"addressees": ["agent-a"]},
            "since": {"addressees": ["agent-a"]},
        }
        places = {}
        for name, writing in writings.items():
            # Each is a reply to its own message in t1, but the conversation's, which is its composer's.
            if name == "conversation":
                places[name] = ({"kind": "topic", "id": conversation}, conversation)
            else:
                places[name] = ({"kind": "message", "id": self.committed(self.post("About " + name, actor="agent-b"))["message_id"]}, "t1")
            writing = dict(writing)
            actor = writing.pop("actor", "owner")
            self.committed(self.draft("d-" + name, places[name][0], writing.pop("body", "Between us"), actor=actor, topic=places[name][1], **writing))
        # Release 56 kept each draft's writing alone: take away whatever a save adds to it now, but from the one saved since.
        for draft_id, payload in self.sql("SELECT id,payload FROM drafts WHERE id LIKE 'd-%' AND id<>'d-since'"):
            writing = {key: value for key, value in json.loads(payload).items()
                       if key in ("source_ref", "body", "attachments", "quotes", "addressees", "intent", "whisper")}
            self.sql("UPDATE drafts SET payload=? WHERE id=?", (json.dumps(writing), draft_id))

        def shown(name):
            source, topic = places[name]
            actor = writings[name].get("actor", "owner")
            return self.store.view(actor, "editor_state", {"source_ref": source, "topic_id": topic})["draft"].get("whisper")
        self.assertEqual({name: shown(name) for name in writings},
                         {"absent": True, "null": True, "at-name": True, "two": None, "by-agent": None, "told": None, "asked": None,
                          "chose-tell": False, "conversation": None, "since": None}, "only what showed as a Whisper is read as one")

        def sent(name):
            topic = places[name][1]
            self.committed(self.prepare("d-" + name, topic, submission="s-" + name, send_op="send-" + name))
            message = self.committed(self.command("message.send", {"submission_id": "s-" + name}, target={"topic_id": topic}, op="send-" + name))
            return self.sql("SELECT intent,private_to FROM messages WHERE id=?", (message["message_id"],))[0]
        self.assertEqual({name: sent(name) for name in ("absent", "at-name", "conversation", "since")},
                         {"absent": (None, "agent-a"), "at-name": (None, "agent-a"), "conversation": ("tell", None), "since": ("tell", None)},
                         "sent as it showed: a Whisper in a topic, a Tell in the conversation, and a Tell when saved since")

    def test_every_wrong_shape_is_refused_in_its_own_words_and_nothing_is_sent(self):
        asked = self.whisper()
        told = self.committed(self.post("On the record", addressees=["agent-a"], intent="tell"))["message_id"]
        before = self.shared()
        cases = (
            ("two names", "owner", {"addressees": ["agent-a", "agent-b"], "whisper": True}, "WHISPER_SHAPE", whispers.TO_ONE),
            ("nobody", "owner", {"whisper": True}, "WHISPER_SHAPE", whispers.TO_ONE),
            ("to a person", "owner", {"addressees": ["other-reader"], "whisper": True}, "WHISPER_SHAPE", whispers.TO_AGENT),
            ("to oneself", "owner", {"addressees": ["owner"], "whisper": True}, "WHISPER_SHAPE", whispers.TO_AGENT),
            ("an agent starts one", "agent-a", {"addressees": ["owner"], "whisper": True}, "WHISPER_SHAPE", whispers.ANSWER_ONLY),
            ("an agent answers a Tell", "agent-a", {"addressees": ["owner"], "whisper": True, "reply_to": told}, "WHISPER_SHAPE", whispers.ANSWER_ONLY),
            ("an agent answers to someone else", "agent-a", {"addressees": ["other-reader"], "whisper": True, "reply_to": asked}, "WHISPER_SHAPE", whispers.ANSWER_ONLY),
            ("another pair", "owner", {"addressees": ["agent-b"], "whisper": True, "reply_to": asked}, "WHISPER_SHAPE", whispers.SAME_PAIR),
            ("with an ask", "owner", {"addressees": ["agent-a"], "whisper": True, "intent": "ask"}, "WHISPER_SHAPE", whispers.NO_INTENT),
            ("with a tell", "owner", {"addressees": ["agent-a"], "whisper": True, "intent": "tell"}, "WHISPER_SHAPE", whispers.NO_INTENT),
            ("a record reply to a whisper", "owner", {"addressees": ["agent-a"], "intent": "tell", "reply_to": asked}, "WHISPER_STAYS_PRIVATE", whispers.REPLY_PRIVATE),
            ("an agent's record reply to one", "agent-a", {"reply_to": asked}, "WHISPER_STAYS_PRIVATE", whispers.REPLY_PRIVATE),
            ("not a boolean", "owner", {"addressees": ["agent-a"], "whisper": "yes"}, "INVALID_ARGUMENT", "whisper is true, false or null"),
        )
        for name, actor, args, code, words in cases:
            with self.subTest(case=name):
                receipt = self.post("Words", actor, **args)
                self.rejected(receipt, code)
                self.assertEqual(receipt["error"]["message"], words)
                if code != "INVALID_ARGUMENT":
                    self.assertTrue(receipt["recorded"], "recorded like other state refusals")
                    self.assertTrue(words.endswith("nothing was sent"))
                self.assertEqual(self.shared(), before, "nothing was sent")

    def test_a_reply_the_writer_cannot_see_is_refused_as_one_that_does_not_exist(self):
        asked = self.whisper()
        before = self.shared()
        for args in ({"whisper": True, "addressees": ["owner"]}, {}):
            with self.subTest(args=args):
                hidden = self.post("Me too", "agent-b", reply_to=asked, **args)
                absent = self.post("Me too", "agent-b", reply_to=UNKNOWN, **args)
                self.rejected(hidden, "INVALID_REPLY")
                self.assertEqual(self.refusal(hidden), self.refusal(absent), "the refusal never says a whisper is there")
        self.assertEqual(self.shared(), before)

    def test_a_whisper_never_opens_a_topic_by_any_writing_that_opens_one(self):
        message = self.whisper()
        before = self.shared()
        opening = {"workspace_id": "w1", "title": "Whispered", "participants": ["agent-a"]}
        new_topic = {"kind": "new_topic", "id": "opening-whisper", "workspace_id": "w1"}
        cases = (
            ("a new topic's draft", lambda: self.draft("w-new", new_topic, "Hello", topic="t9", addressees=["agent-a"], whisper=True, opening=opening)),
            ("a new topic's draft without an opening", lambda: self.draft("w-new2", new_topic, "Hello", topic="t9", addressees=["agent-a"], whisper=True)),
            ("a Reader draft that opens one", lambda: self.draft("w-reader", {"kind": "message", "id": message}, "Hello",
                                                                      addressees=["agent-a"], whisper=True, opening=opening)),
            ("an opening", lambda: self.command("opening.save", {"workspace_id": "w1", "topic_id": "t9", "title": "Whispered", "participants": [],
                                                                 "body": "Hello", "attachments": [], "whisper": True},
                                                target={"opening_id": "o-whisper"}, expected={"opening_revision": 0})),
        )
        for name, save in cases:
            with self.subTest(case=name):
                receipt = save()
                self.rejected(receipt, "WHISPER_SHAPE")
                self.assertEqual(receipt["error"]["message"], whispers.NEEDS_TOPIC)
        self.assertEqual(self.sql("SELECT count(*) FROM drafts WHERE id IN ('w-new','w-new2','w-reader')"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id='t9'"), [(0,)])
        self.assertEqual(self.shared(), before)

    def test_a_tell_written_about_a_whisper_goes_on_the_record_answering_nothing_and_quotes_only_what_was_chosen(self):
        asked = self.whisper()
        answer = self.whisper("Not yet; tomorrow.", actor="agent-a", to="owner", reply_to=asked)
        quote = [{"source": {"kind": "message", "id": answer}, "excerpt": "tomorrow"}]
        source = {"kind": "message", "id": answer}
        self.committed(self.draft("tell", source, "> tomorrow\n\nThe copy goes out tomorrow.", addressees=["agent-a"], intent="tell", quotes=quote))
        following = self.committed(self.prepare("tell", "t1", submission="tell", send_op="tell-send"))["next_draft"]
        sent = self.committed(self.command("message.send", {"submission_id": "tell"}, target={"topic_id": "t1"}, op="tell-send"))
        self.assertNotIn("whisper", sent)
        self.assertEqual(self.sql("SELECT reply_to,private_to,intent FROM messages WHERE id=?", (sent["message_id"],)), [(None, None, "tell")])
        outside = self.source({"kind": "message", "id": sent["message_id"]}, actor="agent-b")
        self.assertEqual(outside["quotes"], [{"source": None, "excerpt": "tomorrow"}], "the excerpt is on the record, the whisper's id is not")
        self.assertEqual(self.source({"kind": "message", "id": sent["message_id"]})["quotes"], quote, "its person still sees where it came from")
        # The same editor written again as a whisper keeps answering the whisper.
        self.committed(self.draft("tell", source, "Thanks", revision=following["revision"], generation=following["generation"],
                                  addressees=["agent-a"], whisper=True))
        self.committed(self.prepare("tell", "t1", revision=following["revision"] + 1, submission="again", send_op="again-send"))
        again = self.committed(self.command("message.send", {"submission_id": "again"}, target={"topic_id": "t1"}, op="again-send"))
        self.assertEqual(self.sql("SELECT reply_to,private_to FROM messages WHERE id=?", (again["message_id"],)), [(answer, "agent-a")])

    def test_only_the_person_in_a_whisper_quotes_it_into_a_tell_and_its_two_into_another_whisper(self):
        asked = self.whisper("The launch copy is final?")
        quote = [{"source": {"kind": "message", "id": asked}, "excerpt": "launch copy"}]
        self.committed(self.post("> launch copy\n\nOn the record now", quotes=quote))
        before = self.shared()
        self.rejected(self.post("Repeating it", "agent-a", quotes=quote), "WHISPER_STAYS_PRIVATE")
        self.rejected(self.post("To agent-b", addressees=["agent-b"], whisper=True, quotes=quote), "WHISPER_STAYS_PRIVATE")
        self.rejected(self.post("Repeating it", "agent-b", quotes=quote), "FORBIDDEN")
        self.assertEqual(self.shared(), before)
        self.whisper("Quoting you back", actor="agent-a", to="owner", reply_to=asked, quotes=quote)

    def test_a_persons_whisper_may_be_notebook_evidence_or_a_topics_source_to_its_two_people_and_an_agents_never(self):
        asked = self.whisper()
        answer = self.whisper("Not yet; tomorrow.", actor="agent-a", to="owner", reply_to=asked)
        reference = {"kind": "message", "id": asked}
        # Only agents write the Notebook: the agent in a person's whisper may cite it, as it may cite their Tell.
        self.committed(self.memory(item="evidence-a", actor="agent-a", references=[reference]))
        # Its own whisper stays an answer and nothing more.
        receipt = self.memory(item="evidence-own", actor="agent-a", references=[{"kind": "message", "id": answer}])
        self.rejected(receipt, "WHISPER_STAYS_PRIVATE")
        self.assertEqual(receipt["error"]["message"], whispers.AGENT_PRIVATE)
        # An agent outside it is told it does not exist.
        workspace = {"kind": "workspace", "id": "w1"}
        hidden = self.memory(item="evidence-b", actor="agent-b", scope=workspace, references=[reference])
        absent = self.memory(item="evidence-c", actor="agent-b", scope=workspace, references=[{"kind": "message", "id": UNKNOWN}])
        self.assertEqual(self.refusal(hidden), self.refusal(absent))
        opening = {"workspace_id": "w1", "topic_id": "t9", "title": "From a whisper", "participants": [], "body": "Picking it up", "attachments": []}
        self.rejected(self.command("opening.save", dict(opening, source_message_id=answer), target={"opening_id": "o0"},
                                   expected={"opening_revision": 0}), "WHISPER_STAYS_PRIVATE")
        self.committed(self.command("opening.save", dict(opening, source_message_id=asked), target={"opening_id": "o1"},
                                    expected={"opening_revision": 0}))
        self.assertEqual(self.refusal(self.command("opening.save", dict(opening, source_message_id=asked), target={"opening_id": "o2"},
                                                   expected={"opening_revision": 0}, actor="agent-b")),
                         self.refusal(self.command("opening.save", dict(opening, source_message_id=UNKNOWN), target={"opening_id": "o3"},
                                                   expected={"opening_revision": 0}, actor="agent-b")))
        self.assertEqual(self.store.view("agent-b", "source_topics", {"message_id": asked})["error"],
                         self.store.view("agent-b", "source_topics", {"message_id": UNKNOWN})["error"])
        # Its two people see the topics started from it; an agent's whisper starts none, so even its people are told so.
        for actor in ("owner", "agent-a"):
            self.assertNotIn("error", self.store.view(actor, "source_topics", {"message_id": asked}))
            self.assertEqual(self.store.view(actor, "source_topics", {"message_id": answer})["error"]["code"], "WHISPER_STAYS_PRIVATE")

    def test_a_persons_whisper_may_be_where_a_pipeline_item_came_from_and_outside_it_shows_as_a_message_you_cannot_open(self):
        # The pipeline page is read by the whole outcome: a source or a thread still gathering shows to anyone outside a whisper
        # as a message they cannot open, never its id, words or topic.
        asked, answer, told = self.exchange()
        seq, answer_seq = (self.sql("SELECT seq FROM messages WHERE id=?", (message,))[0][0] for message in (asked, answer))
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}, {"pipeline_revision": 0}))
        add = lambda actor, op, **args: self.command("pipeline.item_add", dict({"title": "From a message", "section": "candidates"}, **args),
                                                     {"workspace_id": "w1"}, actor=actor, op=op)
        before = self.sql("SELECT count(*) FROM pipeline_items")
        for name, args in (("by id", {"sources": [{"message_id": answer}]}), ("by number", {"sources": [{"message_seq": answer_seq}]}),
                           ("as still gathering", {"sources": [{"note": "a test"}], "gathering": {"message_id": answer}})):
            with self.subTest(source=name):
                receipt = add("owner", "pipeline-whisper-" + name.replace(" ", "-"), **args)
                self.rejected(receipt, "WHISPER_STAYS_PRIVATE")
                self.assertEqual(receipt["error"]["message"], whispers.AGENT_PRIVATE)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_items"), before, "an agent's whisper is never where an item came from")
        numbers = [self.committed(add(actor, "pipeline-person-%s-%d" % (actor, index), **args))["number"] for index, (actor, args) in enumerate((
            ("owner", {"sources": [{"message_id": asked}]}), ("agent-a", {"sources": [{"message_seq": seq}]}),
            ("agent-a", {"sources": [{"note": "a test"}], "gathering": {"message_id": asked}})))]
        self.assertEqual(self.sql("SELECT raised_by FROM pipeline_items WHERE number=?", (numbers[0],)), [("owner",)], "the person raised it")
        number = self.committed(add("owner", "pipeline-record", sources=[{"message_id": told}]))["number"]
        version = self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": number})["item"]["version"]
        self.rejected(self.command("pipeline.source_add", {"sources": [{"message_id": answer}]}, {"workspace_id": "w1", "number": number},
                                   {"item_revision": version}), "WHISPER_STAYS_PRIVATE")
        self.committed(self.command("pipeline.source_add", {"sources": [{"message_id": asked}]}, {"workspace_id": "w1", "number": number},
                                    {"item_revision": version}))
        self.assertEqual(self.sql("SELECT message_id FROM pipeline_item_sources WHERE number=? ORDER BY position", (number,)), [(told,), (asked,)])
        item = lambda actor, number: self.store.view(actor, "pipeline_item", {"workspace_id": "w1", "number": number})["item"]
        self.assertEqual(item("agent-b", numbers[0])["sources"]["shown"], [{"kind": "message", "readable": False}])
        self.assertEqual(item("agent-b", numbers[2])["gathering"], {"kind": "thread", "readable": False})
        self.assertEqual(item("owner", numbers[0])["sources"]["shown"][0]["message_id"], asked)
        for shown in (item("agent-b", n) for n in numbers + [number]):
            self.assertNotIn(asked, json.dumps(shown))
            self.assertNotIn("Is the copy final?", json.dumps(shown))
        # Someone outside the whisper is told no more than for a message that does not exist.
        self.assertEqual(self.refusal(add("agent-b", "pipeline-hidden", sources=[{"message_id": asked}])),
                         self.refusal(add("agent-b", "pipeline-absent", sources=[{"message_id": UNKNOWN}])))


class ReadPathCase(WhisperCase):
    def test_topic_pages_hold_a_whisper_for_its_two_people_alone_in_every_audience_and_direction(self):
        opening = self.opening["id"]
        asked, answer, told = self.exchange()
        for direction in ("after", "before"):
            for audience in ("all", "reader"):
                with self.subTest(direction=direction, audience=audience):
                    self.assertEqual(sorted(self.ids(self.messages("agent-b", direction=direction, audience=audience))), sorted([opening, told]))
        for actor in ("owner", "agent-a"):
            page = {item["id"]: item for item in self.messages(actor)["items"]}
            self.assertEqual(set(page), {opening, asked, answer, told})
            self.assertEqual((page[asked]["whisper"], page[asked]["private_to"]), (True, "agent-a"))
            self.assertEqual((page[answer]["whisper"], page[answer]["private_to"]), (True, "owner"))
            self.assertEqual(page[told]["whisper"], False)
            self.assertNotIn("private_to", page[told])
        # The reader audience never holds a reader's own messages to others.
        self.assertEqual(set(self.ids(self.messages("agent-a", audience="reader"))), {opening, asked, told})
        self.assertEqual(set(self.ids(self.messages("owner", audience="reader"))), {opening, answer, told})

    def test_a_page_of_one_never_stalls_on_whispers_between_others(self):
        told = self.committed(self.post("On the record"))["message_id"]
        for number in range(3):
            self.whisper("Whisper %d" % number)
        for direction in ("before", "after"):
            with self.subTest(direction=direction):
                seen, cursor = [], None
                for _ in range(5):
                    page = self.messages("agent-b", direction=direction, limit=1, **({} if cursor is None else {"cursor": cursor}))
                    seen += self.ids(page)
                    cursor = page["next_cursor"]
                    if cursor is None:
                        break
                self.assertIsNone(cursor, "the pages reach the end")
                expected = [self.opening["id"], told]
                self.assertEqual(seen, expected if direction == "after" else expected[::-1])

    def test_a_reply_says_how_its_parent_begins_only_to_a_reader_who_may_see_the_parent(self):
        asked = self.whisper("Secret words")
        answer = self.whisper("Answer", actor="agent-a", to="owner", reply_to=asked)
        item = {entry["id"]: entry for entry in self.messages("owner")["items"]}[answer]
        self.assertEqual((item["reply_to_author"], item["reply_to_excerpt"]), ("owner", "Secret words"))
        # agent-b never sees the answer, and a page with a hidden parent of an on-record reply says nothing of it.
        self.assertNotIn(answer, self.ids(self.messages("agent-b")))

    def test_one_delivery_reaches_the_one_other_person_and_nobody_elses_counts_move(self):
        unread_b, deliveries_b = self.store.view("agent-b", "topic_unread", {"topic_id": "t1"}), self.store.view("agent-b", "deliveries", {"limit": 100})
        asked = self.whisper()
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=?", (asked,)), [("agent-a",)])
        self.assertEqual(self.sql("SELECT reason FROM delivery_reasons r JOIN deliveries d ON d.id=r.delivery_id WHERE d.message_id=?", (asked,)), [("addressed",)])
        before_owner = self.store.view("owner", "topic_unread", {"topic_id": "t1"})["oldest_unread"]
        answer = self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        self.assertEqual(self.sql("SELECT recipient_id FROM deliveries WHERE message_id=?", (answer,)), [("owner",)])
        self.assertIsNone(before_owner)
        self.assertEqual(self.store.view("owner", "topic_unread", {"topic_id": "t1"})["oldest_unread"]["id"], answer, "the person's New line moves to the answer")
        for name, before in (("topic_unread", unread_b), ("deliveries", deliveries_b)):
            after = self.store.view("agent-b", name, {"topic_id": "t1"} if name == "topic_unread" else {"limit": 100})
            self.assertEqual({k: v for k, v in after.items() if k != "commit_seq"}, {k: v for k, v in before.items() if k != "commit_seq"})

    def test_a_persons_whisper_counts_as_their_writing_in_the_topic_and_moves_nothing_that_points_at_it(self):
        # In a done topic, from someone not taking part: as a Tell would, it reopens the topic, moves it up the list and makes
        # its writer someone who has written there; the count, latest message and preview stay as they were.
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done", "note": "Shipped"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.participation("owner", False)
        summary = lambda: self.sql("SELECT message_count,latest_message_id,other_message_id FROM topic_summaries WHERE topic_id='t1'")
        before, activity = summary(), self.sql("SELECT activity_ms FROM topics WHERE id='t1'")[0][0]
        outside = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 50})["items"]
        horizon = self.sql("SELECT seq FROM reply_horizons WHERE topic_id='t1' AND actor_id='owner'")
        result = self.committed(self.post("Still there?", addressees=["agent-a"], whisper=True))
        topic = self.store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual(result["topic"]["version"], topic["version"])
        self.assertGreater(topic["version"], version, "the topic's version moved")
        self.assertEqual((topic["state"], topic["state_by"]), ("active", "owner"), "a done topic is open again, by its writer")
        self.assertEqual(summary(), before, "count, latest message and the latest by someone else never point at a whisper")
        self.assertGreaterEqual(self.sql("SELECT activity_ms FROM topics WHERE id='t1'")[0][0], activity)
        self.assertEqual(self.sql("SELECT seq FROM reply_horizons WHERE topic_id='t1' AND actor_id='owner'"),
                         [(self.sql("SELECT seq FROM messages WHERE id=?", (result["message_id"],))[0][0] + 1,)], "writing in the topic")
        self.assertNotEqual(horizon, self.sql("SELECT seq FROM reply_horizons WHERE topic_id='t1' AND actor_id='owner'"))
        self.assertEqual(self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 50})["items"], outside,
                         "nobody else reads a word of it")

    def test_a_topic_names_the_whisper_that_reopened_or_started_it_only_to_its_two_people(self):
        # The owner whispers to agent-a in a done topic, which reopens it; agent-b, outside it, reads only that it was reopened.
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done", "note": "Shipped"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        reopened = self.whisper("Secret words here")
        started = self.whisper("Make a topic of this")
        opening = {"workspace_id": "w1", "topic_id": "t9", "title": "From a whisper", "participants": ["agent-b"], "body": "Picking it up",
                   "attachments": [], "source_message_id": started}
        self.committed(self.command("opening.save", opening, target={"opening_id": "o1"}, expected={"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o1"}, expected={"opening_revision": 1}))

        def seen(actor):
            listed = {item["id"]: item for item in self.store.view(actor, "workspace_topics", {"workspace_id": "w1"})["items"]}
            topics = {topic_id: self.store.view(actor, "topic", {"topic_id": topic_id})["topic"] for topic_id in ("t1", "t9")}
            return ((topics["t1"]["state_message_id"], listed["t1"]["state_message_id"]),
                    (topics["t9"]["source_message_id"], listed["t9"]["source_message_id"]),
                    (topics["t1"]["state"], topics["t1"]["state_note"]))
        for actor in ("owner", "agent-a"):
            self.assertEqual(seen(actor), ((reopened, reopened), (started, started), ("active", "Reopened by a new message")), actor)
        self.assertEqual(seen("agent-b"), ((None, None), (None, None), ("active", "Reopened by a new message")),
                         "outside it, the topic says it was reopened and was started from a message, and names neither")
        for name, args in (("topic", {"topic_id": "t1"}), ("topic", {"topic_id": "t9"}), ("workspace_topics", {"workspace_id": "w1"})):
            view = json.dumps(self.store.view("agent-b", name, args))
            self.assertNotIn(reopened, view, name)
            self.assertNotIn(started, view, name)
        # A topic.update's answer says the topic as it stands, to whoever made it: a coordinator outside the whisper renames t1.
        workspace = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        version = self.store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["version"]
        renamed = self.committed(self.command("topic.update", {"title": "Launch, again"}, target={"topic_id": "t1"},
                                              expected={"topic_revision": version}, actor="agent-b"))
        self.assertIsNone(renamed["state_message_id"])
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        renamed = self.committed(self.command("topic.update", {"title": "Launch"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.assertEqual(renamed["state_message_id"], reopened)
        # A message on the record that reopens a topic is named to everyone.
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        told = self.committed(self.post("On the record"))["message_id"]
        self.assertEqual(self.store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["state_message_id"], told)

    def test_an_agents_whisper_leaves_every_shared_fact_alone(self):
        asked = self.whisper()
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done", "note": "Shipped"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.committed(self.post("Can you confirm?", "owner", addressees=["agent-a"], intent="ask"))
        reads = lambda actor: {name: self.store.view(actor, name, args) for name, args in (
            ("topic", {"topic_id": "t1"}), ("workspace_topics", {"workspace_id": "w1", "done": True}), ("workspace_topics", {"workspace_id": "w1"}),
            ("workspaces", {}), ("attention", {}), ("outcome_light", {"workspace_id": "w1"}))}
        strip = lambda value: json.loads(re.sub(r'"commit_seq": \d+', '"commit_seq": 0', json.dumps(value)))
        before = {actor: strip(reads(actor)) for actor in ("agent-b", "owner")}
        horizons, waiting = self.sql("SELECT * FROM reply_horizons ORDER BY rowid"), self.sql("SELECT * FROM topic_waiting ORDER BY rowid")
        result = self.committed(self.post("Not yet", "agent-a", addressees=["owner"], whisper=True, reply_to=asked))
        self.assertEqual(result["topic"]["version"], self.store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["version"], "the topic's version is unchanged")
        after = {actor: strip(reads(actor)) for actor in ("agent-b", "owner")}
        self.assertEqual(after["agent-b"], before["agent-b"], "nothing anyone else reads moved")
        self.assertEqual(after["owner"]["topic"], before["owner"]["topic"], "still asked, the summary as it was")
        self.assertEqual(self.sql("SELECT * FROM reply_horizons ORDER BY rowid"), horizons, "an agent's whisper is not writing in the topic")
        self.assertEqual(self.sql("SELECT * FROM topic_waiting ORDER BY rowid"), waiting, "and answers no ask on the agent")

    def test_a_persons_whisper_answers_only_the_asks_of_the_agent_it_goes_to(self):
        ask = self.committed(self.post("Can you confirm?", "agent-b", addressees=["owner"], intent="ask"))["message_id"]
        waits = lambda: {actor: {key: self.store.view(actor, "topic", {"topic_id": "t1"})["topic"][key] for key in ("waiting_on", "asks")}
                         for actor in ("owner", "agent-b")}
        told = lambda: self.sql("SELECT count(*) FROM changes WHERE scope_kind='actor' AND scope_id='owner' AND resource_kind='waiting'")[0][0]
        waiting, asked_of, changes = self.store.view("owner", "attention", {}), waits(), told()
        self.assertEqual(waiting["waiting_on_me"], 1)
        # A whisper to another agent, who cannot read the answer, leaves agent-b's ask waiting, even replying to it.
        self.whisper("Which date did agent-b mean?")
        self.whisper("Which date did agent-b mean here?", reply_to=ask)
        after = self.store.view("owner", "attention", {})
        self.assertEqual((after["waiting_on_me"], after["latest_waiting"]), (waiting["waiting_on_me"], waiting["latest_waiting"]))
        self.assertEqual((waits(), told()), (asked_of, changes))
        # A whisper replying to the ask, to whoever asked, answers it, as a Tell would, and the person is told the wait moved.
        self.whisper("Which date did you mean?", to="agent-b", reply_to=ask)
        self.assertEqual(self.store.view("owner", "attention", {})["waiting_on_me"], 0)
        self.assertEqual(self.sql("SELECT actor_id FROM topic_waiting WHERE topic_id='t1'"), [])
        self.assertEqual(waits()["agent-b"]["asks"], [], "agent-b sees the ask end, and nothing of why")
        self.assertEqual(told(), changes + 1)
        # An answer to the person by whisper is theirs to see among what was sent to them.
        asked = self.whisper()
        answer = self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        latest = self.store.view("owner", "attention", {})["latest_addressed"]
        self.assertEqual([(item["message_id"], item["message"]["whisper"]) for item in latest if item["message_id"] == answer], [(answer, True)])
        self.assertFalse({asked, answer} & {item["message_id"] for item in self.store.view("agent-b", "attention", {})["latest_addressed"]})

    def test_when_the_wait_is_from_the_ask_a_whisper_replies_to_it_moves_to_the_next_ask_nobody_has_answered(self):
        first = self.committed(self.post("Can you confirm?", "agent-a", addressees=["owner"], intent="ask"))["message_id"]
        whispered = self.committed(self.post("And the room?", "agent-b", addressees=["owner"], intent="ask"))["message_id"]
        later = self.committed(self.post("And the time?", "agent-b", addressees=["owner"], intent="ask"))["message_id"]
        ask_of = lambda: self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id='t1' AND actor_id='owner'")
        self.assertEqual(ask_of(), [(first,)])
        # agent-b's room ask is answered by a whispered reply to it; the wait stays on agent-a's, the oldest.
        self.whisper("The blue room.", to="agent-b", reply_to=whispered)
        self.assertEqual(ask_of(), [(first,)])
        # Answering agent-a's by a whispered reply moves the wait past the room ask, answered, to agent-b's time ask.
        self.whisper("Confirmed.", reply_to=first)
        self.assertEqual(ask_of(), [(later,)], whispered)
        self.whisper("At noon.", to="agent-b", reply_to=later)
        self.assertEqual(ask_of(), [])
        # And with an ask from agent-b still open after agent-a's, answering agent-a moves the wait to it.
        again = self.committed(self.post("Confirm once more?", "agent-a", addressees=["owner"], intent="ask"))["message_id"]
        open_b = self.committed(self.post("And the date?", "agent-b", addressees=["owner"], intent="ask"))["message_id"]
        self.assertEqual(ask_of(), [(again,)])
        self.whisper("Confirmed again.", reply_to=again)
        self.assertEqual(ask_of(), [(open_b,)])

    def test_an_agents_whisper_never_answers_an_ask_on_the_agent(self):
        asked = self.whisper()
        ask = self.committed(self.post("Can you check it?", "owner", addressees=["agent-a"], intent="ask"))["message_id"]
        self.whisper("Checked.", actor="agent-a", to="owner", reply_to=asked)
        self.assertEqual(self.sql("SELECT actor_id,ask_message_id FROM topic_waiting WHERE topic_id='t1'"), [("agent-a", ask)])

    def test_the_changes_feed_names_a_whisper_only_in_its_two_peoples_own_scopes(self):
        def checkpoint(actor, scope):
            return self.store.view(actor, "changes", {"scope": scope})["checkpoint"]
        topic, workspace = {"kind": "topic", "id": "t1"}, {"kind": "workspace", "id": "w1"}
        marks = {(actor, json.dumps(scope)): checkpoint(actor, scope) for actor, scope in (
            ("agent-b", topic), ("agent-b", workspace), ("agent-b", {"kind": "actor", "id": "agent-b"}),
            ("owner", {"kind": "actor", "id": "owner"}), ("agent-a", {"kind": "actor", "id": "agent-a"}))}
        asked = self.whisper()
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        middle = {key: checkpoint(key[0], json.loads(key[1])) for key in marks}
        for (actor, scope), cursor in marks.items():
            items = self.store.view(actor, "changes", {"scope": json.loads(scope), "cursor": cursor})["items"]
            kinds = [(item["resource_kind"], item["resource_id"], item["version"]) for item in items if item["resource_kind"] == "whisper"]
            with self.subTest(actor=actor, scope=scope):
                if actor == "agent-b":
                    # A person's whisper counts as their writing, so the topic moves (its activity) as it would for a Tell;
                    # nothing names the whisper or its message.
                    self.assertEqual([(item["resource_kind"], item["resource_id"], item["version"]) for item in items],
                                     [] if scope.endswith('"agent-b"}') else [("topic", "t1", version)])
                    self.assertNotIn(asked, json.dumps(items))
                else:
                    self.assertEqual(kinds, [("whisper", "t1", seq)])
        # An agent's whisper moves nothing anyone else reads, not even the topic.
        answer = self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        answer_seq = self.sql("SELECT seq FROM messages WHERE id=?", (answer,))[0][0]
        for (actor, scope), cursor in middle.items():
            items = self.store.view(actor, "changes", {"scope": json.loads(scope), "cursor": cursor})["items"]
            with self.subTest(actor=actor, scope=scope, answer=True):
                if actor == "agent-b":
                    self.assertEqual(items, [], "nothing in any scope agent-b reads")
                else:
                    self.assertEqual([(item["resource_kind"], item["resource_id"], item["version"]) for item in items if item["resource_kind"] == "whisper"],
                                     [("whisper", "t1", answer_seq)])

    def test_outside_a_whisper_every_read_by_its_id_is_refused_exactly_as_an_unknown_id(self):
        asked = self.whisper()
        hidden, absent = {"kind": "message", "id": asked}, {"kind": "message", "id": UNKNOWN}
        self.assertEqual(self.store.view("agent-b", "source", {"source_ref": hidden})["error"], self.store.view("agent-b", "source", {"source_ref": absent})["error"])
        # What the Reader reads beside the source to open a message, as a link to it does (docs/links.md).
        self.assertEqual(self.store.view("agent-b", "editor_state", {"source_ref": hidden, "topic_id": "t1"})["error"],
                         self.store.view("agent-b", "editor_state", {"source_ref": absent, "topic_id": "t1"})["error"])
        self.assertEqual(self.store.view("agent-b", "editor_state", {"source_ref": hidden, "topic_id": "t1"})["error"]["code"], "FORBIDDEN")
        self.assertEqual(self.refusal(self.draft("hidden", hidden, "Hello", actor="agent-b")),
                         self.refusal(self.draft("absent", absent, "Hello", actor="agent-b")))
        self.assertEqual(self.store.view("agent-b", "media", {"media_id": "media-x", "source_ref": hidden})["error"],
                         self.store.view("agent-b", "media", {"media_id": "media-x", "source_ref": absent})["error"])
        for actor in ("owner", "agent-a"):
            seen = self.source(hidden, actor=actor)
            self.assertEqual((seen["whisper"], seen["private_to"], seen["body"]), (True, "agent-a", "Is the copy final?"))
            self.committed(self.draft("draft-" + actor, hidden, "Hello", actor=actor, whisper=True,
                                           addressees=["owner" if actor == "agent-a" else "agent-a"]))

    def test_marks_treat_a_whisper_someone_is_outside_as_an_unknown_message(self):
        asked = self.whisper()
        answer = self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        mark = lambda actor, message: self.command("message.mark", {"marked": True}, target={"message_id": message}, expected={"mark_revision": 0}, actor=actor)
        self.assertEqual(self.refusal(mark("agent-b", asked)), self.refusal(mark("agent-b", UNKNOWN)))
        self.assertEqual(self.refusal(mark("agent-b", asked))["message"], "No permission for this message")
        self.committed(mark("owner", answer))
        self.assertIn(answer, [item["message_id"] for item in self.store.view("owner", "marks", {"topic_id": "t1"})["items"]])
        self.assertNotIn(asked, json.dumps(self.store.view("agent-b", "marks", {"topic_id": "t1"})))


class WhisperAnswersAskCase(WhisperCase):
    """Item 307: a person's whisper that replies to a question asked of them, sent to whoever asked it, answers that
    question, as their reply in the topic or their 👍 would: the ask stops waiting on them and "Waiting on you" goes
    out. The whisper stays between its two; only the wait clears. A whisper that replies to no ask of theirs, or goes
    to someone other than the asker, answers nothing."""

    def ask(self, body="Can you confirm the date?", actor="agent-a", to=("owner",)):
        return self.committed(self.post(body, actor, addressees=list(to), intent="ask"))["message_id"]

    def asks_on(self, actor="owner"):
        return self.sql("SELECT ask_message_id FROM topic_waiting WHERE topic_id='t1' AND actor_id=?", (actor,))

    def told(self, actor="owner"):
        return self.sql("SELECT count(*) FROM changes WHERE scope_kind='actor' AND scope_id=? AND resource_kind='waiting'", (actor,))[0][0]

    def waiting_on_me(self, actor="owner"):
        attention = self.store.view(actor, "attention", {})
        return attention["waiting_on_me"], [item["id"] for item in attention["latest_waiting"]]

    def test_a_whisper_replying_to_an_ask_answers_it_and_waiting_on_you_goes_out_while_its_words_stay_private(self):
        ask = self.ask()
        self.assertEqual(self.waiting_on_me(), (1, ["t1"]))
        told = self.told()
        answer = self.whisper("The fourth, at noon.", reply_to=ask)
        self.assertEqual(self.waiting_on_me(), (0, []), "Waiting on you goes out")
        self.assertEqual(self.asks_on(), [], "the ask stops waiting on them")
        self.assertEqual(self.told(), told + 1, "the person's pages are told the wait went")
        for actor in ("owner", "agent-a", "agent-b"):
            self.assertEqual(self.store.view(actor, "topic", {"topic_id": "t1"})["topic"]["asks"], [], actor + " sees the ask end")
        # Only the wait clears: everyone outside the whisper reads the ask ended, never the whisper or its words.
        for actor in ("agent-b", "other-reader"):
            seen = json.dumps([self.store.view(actor, "topic_messages", {"topic_id": "t1", "limit": 50}),
                               self.store.view(actor, "topic", {"topic_id": "t1"}), self.store.view(actor, "attention", {})])
            self.assertNotIn(answer, seen, actor)
            self.assertNotIn("The fourth, at noon.", seen, actor)
        self.assertEqual(self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": answer}})["error"],
                         self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": UNKNOWN}})["error"])
        self.assertIn(answer, self.ids(self.messages("agent-a")), "the agent it answers reads it")

    def test_a_whisper_that_replies_to_no_ask_of_theirs_answers_nothing(self):
        ask = self.ask()
        tell = self.committed(self.post("The venue is booked.", "agent-a", addressees=["owner"], intent="tell"))["message_id"]
        mine = self.whisper("Is the copy final?")
        theirs = self.whisper("Not yet.", actor="agent-a", to="owner", reply_to=mine)
        before, told = (self.asks_on(), self.waiting_on_me(), self.store.view("agent-a", "topic", {"topic_id": "t1"})["topic"]["asks"]), self.told()
        self.assertEqual(before[0], [(ask,)])
        # A whisper to the agent that asked, replying to nothing, to its Tell, or to its whispered answer, answers no ask.
        self.whisper("One more thing.")
        self.whisper("Thanks.", reply_to=tell)
        self.whisper("Then tomorrow.", reply_to=theirs)
        self.assertEqual((self.asks_on(), self.waiting_on_me(), self.store.view("agent-a", "topic", {"topic_id": "t1"})["topic"]["asks"]), before)
        self.assertEqual(self.told(), told, "and nobody is told a wait moved")

    def test_a_whisper_to_someone_elses_ask_answers_nothing_for_the_asker_or_the_one_asked(self):
        mine = self.ask()
        theirs = self.ask("Can you check the copy?", to=("agent-b",))
        before = {actor: self.asks_on(actor) for actor in ("owner", "agent-b")}
        self.assertEqual(before, {"owner": [(mine,)], "agent-b": [(theirs,)]})
        told = self.told()
        # Replying to an ask of agent-b's, by whisper to the agent that asked it, answers neither that ask nor the person's own.
        self.whisper("I can check it instead.", reply_to=theirs)
        # Replying to the person's own ask by whisper to another agent, who did not ask and cannot show the asker, answers nothing.
        self.whisper("Which date did agent-a mean?", to="agent-b", reply_to=mine)
        self.assertEqual({actor: self.asks_on(actor) for actor in ("owner", "agent-b")}, before)
        self.assertEqual((self.waiting_on_me(), self.told()), ((1, ["t1"]), told))

    def test_a_whisper_answers_the_one_ask_it_replies_to_and_the_wait_moves_to_the_next_open_one(self):
        first = self.ask("Can you confirm the date?")
        second = self.ask("And the room?")
        third = self.ask("And the time?")
        self.assertEqual(self.asks_on(), [(first,)])
        # The reply to the second answers it alone: the wait stays on the first, the oldest still open.
        self.whisper("The blue room.", reply_to=second)
        self.assertEqual(self.asks_on(), [(first,)])
        # The reply to the first moves the wait past the second, which its whisper answered, to the third.
        self.whisper("The fourth.", reply_to=first)
        self.assertEqual(self.asks_on(), [(third,)])
        self.assertEqual(self.waiting_on_me(), (1, ["t1"]))
        self.whisper("At noon.", reply_to=third)
        self.assertEqual((self.asks_on(), self.waiting_on_me()), ([], (0, [])))

    def test_a_reply_in_the_topic_and_a_thumbs_up_still_answer_an_ask(self):
        ask = self.ask()
        self.committed(self.post("The fourth works.", "owner", addressees=["agent-a"], intent="tell"))
        self.assertEqual((self.asks_on(), self.waiting_on_me()), ([], (0, [])), "writing in the topic answers it")
        again = self.ask("And the room?")
        self.assertEqual(self.asks_on(), [(again,)])
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": again}, expected={"thumb_revision": 0}, actor="owner"))
        self.assertEqual((self.asks_on(), self.waiting_on_me()), ([], (0, [])), "a 👍 answers it")


class AttachmentCase(WhisperCase):
    begin, publish, ready = test_media.MediaCase.begin, test_media.MediaCase.publish, test_media.MediaCase.ready

    def test_a_whispers_attachment_opens_for_its_two_people_alone(self):
        self.ready("media-secret", b"private bytes")
        asked = self.whisper("See attached", attachments=[{"id": "media-secret"}])
        hidden = {"media_id": "media-secret", "source_ref": {"kind": "message", "id": asked}}
        for actor in ("owner", "agent-a"):
            self.assertEqual(self.store.view(actor, "media", hidden)["state"], "ready")
        self.assertEqual(self.store.view("agent-b", "media", hidden)["error"],
                         self.store.view("agent-b", "media", dict(hidden, source_ref={"kind": "message", "id": UNKNOWN}))["error"])


class AnsweredCase(WhisperCase):
    def test_no_answer_is_said_on_the_viewers_own_whisper_until_its_other_person_whispers_back(self):
        asked = self.whisper()
        own = lambda actor: {item["id"]: item for item in self.messages(actor)["items"]}[asked]
        self.assertIs(own("owner")["no_answer"], True)
        self.assertNotIn("no_answer", own("agent-a"), "only on the viewer's own whisper")
        # A Tell from agent-a in the topic is no answer to the whisper.
        self.committed(self.post("Unrelated", "agent-a"))
        self.assertIs(own("owner")["no_answer"], True)
        self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        self.assertIs(own("owner")["no_answer"], False)


class HostedWordsCase(unittest.TestCase):
    def test_a_whisper_delivery_is_named_in_cores_words_and_the_agents_instructions_say_how_to_answer(self):
        items = [{"seq": 7, "id": "d-1", "state": "pending", "topic": {"id": "t1", "title": "Launch"},
                  "message": {"id": "m-1", "seq": 12, "author_id": "tony", "body": "Is it final?", "whisper": True}},
                 {"seq": 8, "id": "d-2", "state": "pending", "topic": {"id": "t1", "title": "Launch"},
                  "message": {"id": "m-2", "seq": 13, "author_id": "warp", "body": "Shipped", "whisper": False}}]
        told = hosted_notice.notice(items, None, "aim-ux", "attempt-1")["input"][0]["text"]
        self.assertIn("1. whisper in topic t1 from tony, message m-1 (seq 12), delivery d-1. A whisper: only you and tony can read it. "
                      "It counts as a Tell from tony: act on it as you would on their Tell. Never repeat or quote it where others "
                      "can read it, and answer it with a whisper (whisper TOPIC --to tony --reply-to MESSAGE -).", told)
        self.assertNotIn("question, not an instruction", told)
        self.assertIn("2. topic t1, from warp, message m-2 (seq 13), delivery d-2", told)
        lines = hosted_notice.developer_instructions("aim-ux", "aim-next", "/profile.json")
        for line in ("  whisper TOPIC --to NAME --reply-to MESSAGE -   answer a whisper sent to you; only you and its sender read it",
                     "A person's whisper counts as a Tell from them: act on it as you would on their Tell. Its words",
                     "stay between you: never repeat or quote it where others can read it, and answer it with a whisper."):
            self.assertIn(line, lines)
        self.assertNotIn("never an instruction", "\n".join(lines))


@test_wake_contract.own_cases
class WhisperTurnCase(work_tests.WorkObservedCase):
    committed = fixtures.ReaderCase.committed

    def test_a_turn_handed_only_a_whisper_in_a_topic_is_not_work_or_activity_there(self):
        self.topic_two(participants=())
        whispered = self.committed(self.command("message.post", {"body": "Just between us", "addressees": ["agent-a"], "whisper": True},
                                                target={"topic_id": "t2"}))
        self.assertTrue(whispered["whisper"])
        before_two, activity = self.seen("t2"), self.sql("SELECT activity_ms FROM topics WHERE id='t2'")
        self.now += work_tests.WORK_WINDOW_MS + 1
        claim = self.claim_now()
        self.now += 10
        self.hand(claim)
        self.assertEqual(self.seen("t1"), (True, self.now, "agent-a", "turn", False), "the turn is in the topic it was handed on the record")
        self.assertEqual(self.sql("SELECT count(*) FROM topic_turns WHERE topic_id='t2'"), [(0,)])
        self.assertEqual(self.seen("t2")[2:], before_two[2:], "nobody sees agent-a at work where it was only whispered to")
        self.assertEqual(self.sql("SELECT activity_ms FROM topics WHERE id='t2'"), activity)
        told = hosted_notice.notice(self.pending()["items"], None, "agent-a", "attempt")["input"][0]["text"]
        self.assertIn("whisper in topic t2 from owner", told)


@test_wake_contract.own_cases
class WhisperWakeHealthCase(wake_tests.Fixture):
    def whisper(self, body="Just between us"):
        receipt = self.command("message.post", {"body": body, "addressees": ["agent-a"], "whisper": True}, target={"topic_id": "t1"})
        self.assertEqual(receipt["status"], "committed", receipt)

    def clear(self):
        """agent-a has read everything on the record so far."""
        for item in self.store.view("agent-a", "deliveries", {"limit": 100})["items"]:
            self.assertEqual(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a")["status"], "committed")

    def test_others_count_only_what_waits_on_the_record_and_the_agent_counts_its_whispers_too(self):
        self.command("message.post", {"body": "On the record"}, target={"topic_id": "t1"})
        self.whisper()
        first = self.park()
        self.assertEqual(self.wakes("agent-b")["quiet"], [{"actor_id": "agent-a", "waiting": 2, "since_ms": first, "why": "not_answering"}])
        # The person who whispered counts their own whisper, as they would their Tell.
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 3, "since_ms": first, "why": "not_answering"}])
        self.assertEqual(self.wakes("agent-a")["quiet"], [{"actor_id": "agent-a", "waiting": 3, "since_ms": first, "why": "not_answering"}])

    def test_an_agent_with_only_a_whisper_waiting_is_parked_but_shown_to_nobody_else(self):
        self.clear()
        self.whisper()
        first = self.park()
        self.assertEqual(self.claims(), [], "parked by its own schedule")
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}],
                         "the person who whispered sees it waiting")
        self.assertEqual(self.wakes("agent-b")["quiet"], [])
        self.assertEqual(self.wakes("agent-a")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}])

    def test_the_time_a_whispers_wake_went_unanswered_is_never_shown_to_anyone_else(self):
        self.clear()
        self.whisper()
        first = self.park()
        self.now += 1800000
        self.command("message.post", {"body": "On the record, later"}, target={"topic_id": "t1"})
        sent = self.sql("SELECT max(sent_ms) FROM messages WHERE private_to IS NULL")[0][0]
        self.assertGreater(sent, first)
        self.assertEqual(self.wakes("agent-b")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": sent, "why": "not_answering"}])
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 2, "since_ms": first, "why": "not_answering"}])
        self.assertEqual(self.wakes("agent-a")["quiet"][0]["since_ms"], first)

    def leave_and_come_back(self, back=True):
        """agent-a leaves t1 with its delivery there unread; the subscription it had is over, so that delivery waits on nobody."""
        for present in (False, True) if back else (False,):
            receipt = self.command("participation.set", {"actor_id": "agent-a", "present": present}, target={"topic_id": "t1"})
            self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE recipient_id='agent-a' AND state='pending'"), [(1,)])

    def test_a_delivery_left_unread_in_a_topic_the_agent_left_never_shows_its_whispers_wake(self):
        self.leave_and_come_back(back=False)
        self.now += 600000
        self.whisper()
        first = self.park()
        self.assertEqual(self.wakes("agent-b")["quiet"], [])
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}])
        self.assertEqual(self.wakes("agent-a")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}])

    def test_everyone_counts_what_waits_on_the_record_as_the_agent_does_after_it_left_and_came_back(self):
        self.leave_and_come_back()
        self.command("message.post", {"body": "On the record, after it came back"}, target={"topic_id": "t1"})
        first = self.park()
        for reader in ("agent-a", "agent-b", "owner"):
            self.assertEqual(self.wakes(reader)["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}], reader)


@test_wake_contract.own_cases
class WhisperPausedWakesCase(hosted_tests.HostedCase):
    """agent-a has a route pin; no runner is sending wakes once its lease runs out."""

    def test_the_person_who_whispered_sees_the_agent_waiting_on_it_and_is_told_so_and_nobody_else_is(self):
        for item in self.store.view("agent-a", "deliveries", {"limit": 100})["items"]:
            self.assertEqual(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a")["status"], "committed")
        receipt = self.command("message.post", {"body": "Just between us", "addressees": ["agent-a"], "whisper": True}, target={"topic_id": "t1"})
        self.assertEqual(receipt["status"], "committed", receipt)
        self.now += 31000
        owner = self.store.view("owner", "wakes", {})
        self.assertFalse(owner["runner"]["live"])
        self.assertEqual((owner["quiet"], owner.get("notice")), ([{"actor_id": "agent-a", "waiting": 1, "why": "wakes_paused"}], {"waiting_agents": 1}))
        other = self.store.view("agent-b", "wakes", {})
        self.assertEqual((other["quiet"], other.get("notice")), ([], None))
        waiting = lambda actor: [(item["waiting"], item["waiting_since_ms"] is not None)
                                 for item in self.store.view(actor, "health", {})["agents"] if item["actor_id"] == "agent-a"]
        self.assertEqual(waiting("owner"), [(1, True)])
        self.assertEqual(waiting("agent-b"), [(0, False)])

    def test_the_owner_is_told_of_work_in_their_outcome_only_from_what_they_can_read(self):
        # reader-two, a person on w1's team, whispers to agent-a in the owner's t1; agent-a also has a delivery the owner
        # can read, in w2, an outcome reader-two owns. The owner sees agent-a waiting on that one, and is told of nothing
        # waiting in an outcome they own, since all that waits there is a whisper between others.
        def done(receipt):
            self.assertEqual(receipt["status"], "committed", receipt)
            return receipt.get("result")
        for item in self.store.view("agent-a", "deliveries", {"limit": 100})["items"]:
            done(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a"))
        self.sql("INSERT INTO actors(id,kind,name) VALUES ('reader-two','human','Reader Two')")
        workspace = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        done(self.command("workspace.member_set", {"actor_id": "reader-two", "present": True}, {"workspace_id": "w1"},
                          {"workspace_revision": workspace}))
        done(self.command("message.post", {"body": "Just between us", "addressees": ["agent-a"], "whisper": True}, target={"topic_id": "t1"},
                          actor="reader-two"))
        done(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "team": ["owner", "agent-a"]}, actor="reader-two"))
        opening = {"workspace_id": "w2", "topic_id": "t2", "title": "Over here", "participants": ["agent-a"], "body": "Hello", "attachments": []}
        done(self.command("opening.save", opening, target={"opening_id": "o2"}, expected={"opening_revision": 0}, actor="reader-two"))
        done(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}, actor="reader-two"))
        done(self.command("message.post", {"body": "On the record", "addressees": ["agent-a"], "intent": "tell"}, target={"topic_id": "t2"},
                          actor="reader-two"))
        self.now += 31000
        owner = self.store.view("owner", "wakes", {})
        self.assertFalse(owner["runner"]["live"])
        self.assertEqual([(item["actor_id"], item["why"]) for item in owner["quiet"]], [("agent-a", "wakes_paused")])
        self.assertNotIn("notice", owner, "nothing the owner can read waits in an outcome they own")
        writer = self.store.view("reader-two", "wakes", {})
        self.assertEqual(writer.get("notice"), {"waiting_agents": 1}, "the person who whispered, owning w2, is told")


class WhisperCLICase(verbs.AgentVerbCase):
    def test_an_agent_reads_a_whisper_with_how_to_answer_and_answers_with_the_whisper_verb_and_others_see_nothing(self):
        asked = self.committed(self.command("message.post", {"body": "Is the copy final?", "addressees": ["agent-a"], "whisper": True},
                                            target={"topic_id": "t1"}))["message_id"]
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        code, out, err = self.run_cli("read", "t1")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("#%d %s owner whispers to agent-a" % (seq, asked), out)
        self.assertIn("  (A whisper: it counts as a Tell from owner: act on it. Only you and owner can read it; never repeat or quote it "
                      "where others can read it. Answer with a whisper: whisper t1 --to owner --reply-to %s -.)" % asked, out)
        self.assertNotIn("not an instruction", out)
        code, out, err = self.run_cli("inbox")
        self.assertEqual((code, err), (0, ""))
        self.assertRegex(out, r'whisper "Topic" #%d owner: Is the copy final\?  \[d-\w+ in t1\]' % seq)
        code, out, err = self.run_cli("whisper", "t1", "--to", "owner", "--reply-to", asked, "-", stdin=b"Tomorrow.")
        self.assertEqual((code, err), (0, ""))
        answer = self.latest()
        self.assertEqual(out, "whispered %s to owner in t1\n" % answer[0])
        self.assertEqual(self.sql("SELECT private_to,reply_to,intent FROM messages WHERE id=?", (answer[0],)), [("owner", asked, None)])
        # The person reads the agent's answer with no words about acting on it: only a person's whisper counts as a Tell.
        self.profiles["owner"] = Path(self.temp.name).resolve() / "owner.json"
        write_profile(self.profiles["owner"], str(self.path.resolve()), "test-instance", "owner", binding=self.binding)
        code, out, err = self.run_cli("read", "t1", actor="owner")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("  (A whisper: only you and agent-a can read it; it is never repeated where others can read it. "
                      "Answer with a whisper: whisper t1 --to agent-a --reply-to %s -.)" % answer[0], out)
        self.assertNotIn("counts as a Tell", out, "nor under their own whisper, which is theirs to act on")
        # agent-b reads the topic and its inbox: nothing of either.
        for verb in (("read", "t1"), ("inbox",)):
            code, out, err = self.run_cli(*verb, actor="agent-b")
            self.assertEqual(code, 0, err)
            self.assertNotIn(asked, out)
            self.assertNotIn(answer[0], out)
            self.assertNotIn("whisper", out)
        # An agent never starts a whisper.
        code, out, err = self.run_cli("whisper", "t1", "--to", "owner", "-", stdin=b"Psst")
        self.assertNotEqual(code, 0)
        self.assertIn("WHISPER_SHAPE", err)

    def test_a_watch_says_a_whisper_by_its_delivery_and_skips_the_bare_change(self):
        said = []
        agent = type("Spy", (), {"notice": lambda self, watch, value, line: said.append(line)})()
        cli.Agent.report(agent, None, {"resource_kind": "whisper", "resource_id": "t1", "version": 9})
        self.assertEqual(said, [])
        line = cli.Agent.delivery_line({"id": "d-1", "topic": {"title": "Topic"},
                                        "message": {"seq": 9, "author_id": "owner", "body": "Psst", "topic_id": "t1", "whisper": True}})
        self.assertEqual(line, 'whisper "Topic" #9 owner: Psst  [d-1 in t1]')


# Every view, and how a whisper is kept from anyone outside it (spec §6). A new
# view is classified here before it ships; until then this audit fails.
VIEW_PATHS = {
    "assessment": "request/report metadata scoped by readable topic; all cited messages validated public in that topic",
    "assessments": "paged readable-topic or own-assessor metadata; private citations refused before recording",
    "topic_messages": "VISIBLE in each of its queries; a hidden parent's excerpt is blanked",
    "topic_images": "VISIBLE in its window over each topic's newest messages",
    "source": "_message_access applies visible(); quotes are redacted",
    "media": "goes through _source",
    "editor_state": "the reader's own drafts; a whisper source goes through _message_access",
    "submission": "the reader's own", "submissions": "the reader's own",
    "deliveries": "the reader's own deliveries; a whisper is delivered to its one other person",
    "delivery": "the reader's own delivery",
    "attention": "the reader's own deliveries; a whisper never waits",
    "topic_unread": "the reader's own deliveries",
    "marks": "visible() before a mark; the reader's own marks",
    "changes": "a whisper writes only to its two people's actor scopes",
    "topic": "summaries, waits and participation are untouched by a whisper; the message that reopened or started it through redact_topic",
    "workspace_topics": "summaries, activity, order and waits are untouched by a whisper; each topic's reopening and source through redact_topic",
    "workspaces": "per-reader delivery counts",
    "outcome_light": "reads asks and summaries, which a whisper never writes",
    "source_topics": "_message_access applies visible()",
    "reactions": "visible() on the message before its reactions",
    "message_acts": "only acts on messages the reader may see: the whisper rule on each row's message in the query, and in its version",
    "stack_positions": "each message named through _acted_message, which applies visible(); its dossier's root, members, newest message and the "
                       "topic's newest act under the whisper rule, so a whisper never moves a position anyone outside it reads; its name and cover "
                       "(item 624) are the root's, which the reader can see, so a whispered first message's cover never reaches a reader "
                       "outside it",
    "stack_namer": "the message named through _acted_message, which applies visible(); its root walked up through parents each "
                   "checked by visible(), and its name under the whisper rule; its namer found from replies on the record only, "
                   "so a whisper never names one",
    "dossier_cover": "the message named through _acted_message, which applies visible(); its dossier's root walked up through parents "
                     "each checked by visible(), and the root's cover as message_acts reads it, under the whisper rule; a word that made "
                     "its payload Done shows its message only to a reader who may see it",
    "stars": "the reader's own stars on messages they may see: the whisper rule and READABLE in the query",
    "tools": "no message words: the records, what each check found and which outcomes said they use each",
    "tool": "no message words; a went-back line names its topic's title only when READABLE to the reader",
    "topic_tools": "no message words: the tools a topic _topic lets the reader open is about",
    "wakes": "on_record_wake_health for every reader but the agent",
    "health": "each agent's waiting work on the record for every reader but that agent, as wakes; what is red counts the record only",
    "health_light": "the keys of what is red, counted on the record only",
    "memory_items": "Notebook revisions; a whisper is refused as evidence",
    "memory_current": "a Notebook page as it stands, read as the source view reads a revision; a whisper is refused as evidence",
    "capabilities": "no message", "operation": "the reader's own operation", "workspace": "no message",
    "opening": "the reader's own opening", "openings": "the reader's own openings", "workspace_members": "no message",
    "actors": "no message", "colors": "no message", "releases": "no message",
    "conversation": "counts items and lists asks, and a whisper is never an item or an ask; unread from the reader's own deliveries",
    "pipeline": "items, stages and asks about items, and a whisper is never an ask or an item's source",
    "pipeline_item": "each source and what it is still gathering through _message_access; a whisper is refused as either",
    "pipeline_row": "asks about items and work in Now pieces' topics, which a whisper never writes",
    "outcome_checks": "held asks, which a whisper never is; each problem's message through _message_access, and a whisper is refused as "
                      "one; the loop's account is a message on the record",
    "check_readings": "readings and their fix topics, and check asks (through _check_view), which a whisper never is",
    "outcome_live": "checks, readings, fix topics and the release; no message",
}
# Each read of the messages table outside the visibility rule, and why it shows no whisper to anyone outside it.
MESSAGE_READS = {
    "aim_next/dossier_order.py": ("position reads use a canonical root already checked by visible(); publication touches only its "
                                 "message readers, and its numeric topic ceiling returns no message identity or words; the explicit "
                                 "migration enumerates readers internally, groups messages under VISIBLE and resolves only visible roots; return detection uses MEMBERS under VISIBLE", 7),
    "aim_next/hosted_control.py": ("waiting and pending work filtered by VISIBLE and topic/addressed access before LIMIT, then _message_access checks the link again", 2),
    "aim_next/delivery.py": ("migration backfill or settling, before any whisper exists or of the reader's own deliveries", 8),
    "aim_next/conversation.py": ("the topic page and its images to pick (VISIBLE, open items included), the reader's own deliveries, a reply checked by visible(), migrations, "
                                 "and the messages a page names to refresh, each reached through _message_access and read under VISIBLE; "
                                 "the newly published root read by id to record its initial cover inside the same command transaction, never shown", 23),
    "aim_next/root_posts.py": ("candidate roots in the destination topic under VISIBLE before LIMIT; effective parent existence "
                               "in that same topic checked for visibility (public, author or private recipient) before suppressing a root; "
                               "only readable current root ids, sequences and bounded names are returned, no bodies or hidden counts", 2),
    "aim_next/message_edit.py": ("one message's words, a revision of them or every revision, and its attachments, each read for a message "
                                 "the caller reached through _message_access; the horizon the version 41 step sets, a number; the stored "
                                 "quotes of messages whose marked words an answer already carries, read only to record what was handed; "
                                 "the author kind and sequence of messages so marked, to record an exposure; and an edited message's "
                                 "sequence and its author's kind against the horizon or the first post recording agents' messages; "
                                 "and, for an agent's edit (item 614), the edited message's addressees and the author of the message it "
                                 "answers, to leave a message between others as it was; none of them shown", 10),
    "aim_next/standing_conversation.py": ("a conversation's items and asks, which a whisper never is, the about links of a page already read through VISIBLE, "
                                          "a pipeline item's message sources, which _source_rows read through _message_access, the message a person's "
                                          "whisper replies to, to see that it goes to that message's author, and an answer take's reply, "
                                          "shown through visible()", 10),
    "aim_next/marks.py": ("the reader's own marks, or a row checked by visible()", 4),
    "aim_next/reactions.py": ("a row checked by visible() before a reaction or its view, the occupied probe, and go-ahead flags of messages the caller checked; "
                              "for a thumb that answers an ask (item 239): the asked person's replies, on the record or whispered to "
                              "whoever asked, and their writing on the record, their next ask and the whispered replies that answered one "
                              "(item 307), never shown, and the asks topic_waiting and held_ask name, which a whisper never is", 10),
    "aim_next/outcome_light.py": ("an ask's message; a whisper never asks", 1),
    "aim_next/blocking.py": ("the message just posted, and asks that name what they block, which only an ask can and a whisper never is", 3),
    "aim_next/store.py": ("the latest message on the record from topic_summaries", 1),
    "aim_next/topic_reading.py": ("the reader's own replies (author_id is the reader) to messages on a page already read through VISIBLE; "
                                  "whether the reader's own prepared reply was sent, an EXISTS over their own messages by the send's "
                                  "operation id that shows nothing of any message", 2),
    "aim_next/topic_state.py": ("asks, an ask an open record still holds, the ask a wait is from when its person writes, the message a "
                                "person's whisper replies to (its author and place, never shown), "
                                "the conversation asks to someone who can no longer read it, and the latest message on the record", 7),
    "aim_next/checks.py": ("held asks and the owner's ask about the target, which a whisper never is; a problem's message, refused "
                           "when it is an agent's whisper, and shown through _message_access; the loop's account on the record only", 7),
    "aim_next/outcome_asks.py": ("asks an open target or owner-gated stage still holds, which a whisper never is", 4),
    "aim_next/outcome_kind.py": ("the conversation's asks, cleared when the outcome is reached", 1),
    "aim_next/sources.py": ("the latest message on the record from topic_summaries", 1),
    "aim_next/wake_health.py": ("on the record, or the reader's own whispers (whispers.READ_BY)", 1),
    "aim_next/health.py": ("on the record or the reader's own whispers (whispers.READ_BY), but an agent's own count for that agent, as wakes; "
                           "the step back's check for Theseus's notices, which are never whispers; and the upgrade's "
                           "reads of when an agent wrote, its own acts, of which only a time is kept, as live keeps any act", 5),
    "aim_next/stacks.py": ("a message acted on, and a join's message, checked by visible() before anything is recorded; a reply's parent "
                           "id, read only to refuse a join that would loop, never shown; the message a person's reply or thumbs-up "
                           "folds for them, checked by visible() before the fold is recorded; the acts and stars views, under the whisper rule; "
                           "a dossier's root, walked up from a message the reader sees through parents each checked by visible(); its "
                           "members, its newest message and the topic's newest message and act, each under VISIBLE, so a whisper "
                           "someone is outside never moves a position or a sequence they read; whether a message of the reader's own still waits for a "
                           "reply (item 475): replies to it under VISIBLE, the newest message on the record by anyone else from the "
                           "topic's summary, and messages naming the reader on the record only (private_to IS NULL); a dossier's namer (item 479), from "
                           "its root's outcome and the replies among its members on the record only, walked as no one, so a "
                           "whisper never makes its author a namer; and the members a fold through folds, under the same VISIBLE, "
                           "so it never folds a whisper the reader is outside; the reader's own starred messages of a topic, under "
                           "VISIBLE, which keep a dossier above More for them (item 635); and the root of the dossier their star brings "
                           "back, found by the same walk, read only to record their Bring back, never shown; the reader's own places (item 550) under VISIBLE; and the source dossier first message; the scoped stars canonical-root SELECT reads the first message and attachment names only after StackRoots.root walks ancestry checked by visible(), within the readable topic; the outcome owner of a cleared cover with pending refresh, by the exact already-visible message id passed to current_acts (no message content or wider scan)", 29),
    "aim_next/reply_passages.py": ("immutable reply-basis receipt lookup by message author/operation; source and topic reads "
                                 "have already checked the message's visibility, and for_reader additionally checks "
                                 "the parent through _message_access and withholds its basis during an edit hold; "
                                 "keep_on_edit runs only after ownership/access checks", 1),
    "aim_next/whispers.py": ("the rule itself, and the message a topic names, read to apply visible()", 6),
    "aim_next/covers.py": ("a cover's payload message, read under VISIBLE as its writer reads it, then refused as a whisper unless the "
                           "dossier is a whisper between the same two people; the owner's reply a payload names as done_by, read under "
                           "VISIBLE as its writer reads it, refused as DONE_BY_OWNER otherwise, so no refusal names a whisper; and a "
                           "cover's root, read under VISIBLE as the owner reads it before the owner's 👍 settles Done (item 624)", 3),
    "aim_next/cover_values.py": ("the owner's own reply to a payload's message, by its author: one the owner wrote, which they always "
                                 "read, its writer's reach checked by covers.py; its id is shown only to a reader the next read finds it "
                                 "VISIBLE to (item 624)", 2),
    "aim_next/work.py": ("summaries on the record, and turn_handed on the record only", 6),
    "aim_next/pipeline.py": ("an owner's gate needs an ask, and asks about items, which a whisper never is; a source found by its "
                             "number then read through _message_access; sources and gathering shown through _message_access; "
                             "the operator's import of the hand-kept page, which refuses an agent's whisper and a person's outside it; "
                             "the word a move is made on (item 170), read after _because refused an agent's whisper, the message it replies to read on the record "
                             "only, and its place shown through _message_access; that word's parent id, read only to refuse a move on a "
                             "held message, never shown", 10),
}


class PathAuditCase(unittest.TestCase):
    def test_every_view_is_classified_for_whispers(self):
        self.assertEqual(sorted(validation.VIEWS), sorted(VIEW_PATHS), "a view was added or removed: classify how it keeps a whisper private")

    def test_every_read_of_messages_is_one_this_file_classifies(self):
        found = {}
        for path in sorted((ROOT / "aim_next").glob("*.py")):
            if path.name == "migrations.py":
                continue
            count = len(re.findall(r"\b(?:FROM|JOIN) messages\b", path.read_text()))
            if count:
                found["aim_next/" + path.name] = count
        self.assertEqual(found, {name: count for name, (_, count) in MESSAGE_READS.items()},
                         "a read of the messages table was added or moved: apply whispers.VISIBLE or visible(), then classify it here")


if __name__ == "__main__":
    unittest.main()

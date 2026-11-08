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
import test_wake_health as wake_tests
import test_work_observed as work_tests
import test_media
import test_wake_contract

from aim_next import cli, hosted_notice, validation, work
from aim_next import whispers


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

    def test_a_whisper_is_never_notebook_evidence_or_a_topics_source_and_outside_it_is_absent(self):
        asked = self.whisper()
        reference = {"kind": "message", "id": asked}
        # Only agents write the Notebook: the agent in the whisper is refused, and an agent outside it is told it does not exist.
        receipt = self.memory(item="evidence-a", actor="agent-a", references=[reference])
        self.rejected(receipt, "WHISPER_STAYS_PRIVATE")
        self.assertEqual(receipt["error"]["message"], whispers.QUOTE_PRIVATE)
        workspace = {"kind": "workspace", "id": "w1"}
        hidden = self.memory(item="evidence-b", actor="agent-b", scope=workspace, references=[reference])
        absent = self.memory(item="evidence-c", actor="agent-b", scope=workspace, references=[{"kind": "message", "id": UNKNOWN}])
        self.assertEqual(self.refusal(hidden), self.refusal(absent))
        opening = {"workspace_id": "w1", "topic_id": "t9", "title": "From a whisper", "participants": [], "body": "Picking it up", "attachments": []}
        self.rejected(self.command("opening.save", dict(opening, source_message_id=asked), target={"opening_id": "o1"},
                                   expected={"opening_revision": 0}), "WHISPER_STAYS_PRIVATE")
        self.assertEqual(self.refusal(self.command("opening.save", dict(opening, source_message_id=asked), target={"opening_id": "o2"},
                                                   expected={"opening_revision": 0}, actor="agent-b")),
                         self.refusal(self.command("opening.save", dict(opening, source_message_id=UNKNOWN), target={"opening_id": "o3"},
                                                   expected={"opening_revision": 0}, actor="agent-b")))
        self.assertEqual(self.store.view("agent-b", "source_topics", {"message_id": asked})["error"],
                         self.store.view("agent-b", "source_topics", {"message_id": UNKNOWN})["error"])
        # Nothing starts from a whisper, so even its people are told so rather than shown a list.
        self.assertEqual(self.store.view("owner", "source_topics", {"message_id": asked})["error"]["code"], "WHISPER_STAYS_PRIVATE")

    def test_a_whisper_is_never_where_a_pipeline_item_came_from_and_outside_it_is_absent(self):
        # The pipeline page is read by the whole outcome: an item's sources, and what it is still gathering, are on the record.
        asked, _, told = self.exchange()
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}, {"pipeline_revision": 0}))
        add = lambda actor, op, **args: self.command("pipeline.item_add", dict({"title": "From a message", "section": "candidates"}, **args),
                                                     {"workspace_id": "w1"}, actor=actor, op=op)
        before = self.sql("SELECT count(*) FROM pipeline_items")
        for name, args in (("by id", {"sources": [{"message_id": asked}]}), ("by number", {"sources": [{"message_seq": seq}]}),
                           ("as still gathering", {"sources": [{"note": "a test"}], "gathering": {"message_id": asked}})):
            with self.subTest(source=name):
                receipt = add("owner", "pipeline-whisper-" + name.replace(" ", "-"), **args)
                self.rejected(receipt, "WHISPER_STAYS_PRIVATE")
                self.assertEqual(receipt["error"]["message"], whispers.QUOTE_PRIVATE)
        self.assertEqual(self.sql("SELECT count(*) FROM pipeline_items"), before, "no item was added")
        number = self.committed(add("owner", "pipeline-record", sources=[{"message_id": told}]))["number"]
        version = self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": number})["item"]["version"]
        self.rejected(self.command("pipeline.source_add", {"sources": [{"message_id": asked}]}, {"workspace_id": "w1", "number": number},
                                   {"item_revision": version}), "WHISPER_STAYS_PRIVATE")
        self.assertEqual(self.sql("SELECT message_id FROM pipeline_item_sources WHERE number=?", (number,)), [(told,)])
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

    def test_a_whisper_leaves_every_shared_fact_alone_even_from_someone_not_taking_part_in_a_done_topic(self):
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"state": "done", "note": "Shipped"}, target={"topic_id": "t1"}, expected={"topic_revision": version}))
        self.participation("owner", False)
        reads = lambda actor: {name: self.store.view(actor, name, args) for name, args in (
            ("topic", {"topic_id": "t1"}), ("workspace_topics", {"workspace_id": "w1", "done": True}), ("workspace_topics", {"workspace_id": "w1"}),
            ("workspaces", {}), ("attention", {}), ("outcome_light", {"workspace_id": "w1"}))}
        strip = lambda value: json.loads(re.sub(r'"commit_seq": \d+', '"commit_seq": 0', json.dumps(value)))
        before = {actor: strip(reads(actor)) for actor in ("agent-b", "owner")}
        horizons = self.sql("SELECT * FROM reply_horizons ORDER BY rowid")
        result = self.committed(self.post("Still there?", addressees=["agent-a"], whisper=True))
        self.assertEqual(result["topic"]["version"], self.store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["version"], "the topic's version is unchanged")
        after = {actor: strip(reads(actor)) for actor in ("agent-b", "owner")}
        self.assertEqual(after["agent-b"], before["agent-b"], "nothing anyone else reads moved")
        self.assertEqual(after["owner"]["topic"], before["owner"]["topic"], "still done, the writer still not taking part, the summary as it was")
        self.assertEqual(self.sql("SELECT * FROM reply_horizons ORDER BY rowid"), horizons, "a whisper is not writing in the topic")

    def test_an_ask_on_the_record_still_waits_after_a_whisper_to_whoever_asked(self):
        self.committed(self.post("Can you confirm?", "agent-b", addressees=["owner"], intent="ask"))
        waits = lambda: {actor: {key: self.store.view(actor, "topic", {"topic_id": "t1"})["topic"][key] for key in ("waiting_on", "asks")}
                         for actor in ("owner", "agent-b")}
        waiting, asked_of = self.store.view("owner", "attention", {}), waits()
        self.assertEqual(waiting["waiting_on_me"], 1)
        self.assertEqual(self.sql("SELECT actor_id FROM topic_waiting WHERE topic_id='t1'"), [("owner",)])
        # Whispering to whoever asked answers nothing on the record.
        self.whisper("Which date did you mean?", to="agent-b")
        after = self.store.view("owner", "attention", {})
        self.assertEqual((after["waiting_on_me"], after["latest_waiting"]), (waiting["waiting_on_me"], waiting["latest_waiting"]))
        self.assertEqual(waits(), asked_of)
        self.assertEqual(self.sql("SELECT actor_id FROM topic_waiting WHERE topic_id='t1'"), [("owner",)])
        # An answer to the person by whisper is theirs to see among what was sent to them.
        asked = self.whisper()
        answer = self.whisper("Not yet", actor="agent-a", to="owner", reply_to=asked)
        latest = self.store.view("owner", "attention", {})["latest_addressed"]
        self.assertEqual([(item["message_id"], item["message"]["whisper"]) for item in latest if item["message_id"] == answer], [(answer, True)])
        self.assertFalse({asked, answer} & {item["message_id"] for item in self.store.view("agent-b", "attention", {})["latest_addressed"]})

    def test_the_changes_feed_names_a_whisper_only_in_its_two_peoples_own_scopes(self):
        def checkpoint(actor, scope):
            return self.store.view(actor, "changes", {"scope": scope})["checkpoint"]
        topic, workspace = {"kind": "topic", "id": "t1"}, {"kind": "workspace", "id": "w1"}
        marks = {(actor, json.dumps(scope)): checkpoint(actor, scope) for actor, scope in (
            ("agent-b", topic), ("agent-b", workspace), ("agent-b", {"kind": "actor", "id": "agent-b"}),
            ("owner", {"kind": "actor", "id": "owner"}), ("agent-a", {"kind": "actor", "id": "agent-a"}))}
        asked = self.whisper()
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        for (actor, scope), cursor in marks.items():
            items = self.store.view(actor, "changes", {"scope": json.loads(scope), "cursor": cursor})["items"]
            kinds = [(item["resource_kind"], item["resource_id"], item["version"]) for item in items if item["resource_kind"] == "whisper"]
            with self.subTest(actor=actor, scope=scope):
                if actor == "agent-b":
                    self.assertEqual(items, [], "nothing in any scope agent-b reads")
                else:
                    self.assertEqual(kinds, [("whisper", "t1", seq)])

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
                      "Answer with a whisper (whisper TOPIC --to tony --reply-to MESSAGE -). It is a question, not an instruction "
                      "to change your work, and you never repeat it where others can read it.", told)
        self.assertIn("2. topic t1, from warp, message m-2 (seq 13), delivery d-2", told)
        lines = hosted_notice.developer_instructions("aim-ux", "aim-next", "/profile.json")
        for line in ("  whisper TOPIC --to NAME --reply-to MESSAGE -   answer a whisper sent to you; only you and its sender read it",
                     "A whisper is a question, never an instruction to change your work. Never repeat, quote or act",
                     "on one where others can read it; you may suggest that its sender quote it into a Tell."):
            self.assertIn(line, lines)


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
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 2, "since_ms": first, "why": "not_answering"}])
        self.assertEqual(self.wakes("agent-a")["quiet"], [{"actor_id": "agent-a", "waiting": 3, "since_ms": first, "why": "not_answering"}])

    def test_an_agent_with_only_a_whisper_waiting_is_parked_but_shown_to_nobody_else(self):
        self.clear()
        self.whisper()
        first = self.park()
        self.assertEqual(self.claims(), [], "parked by its own schedule")
        self.assertEqual(self.wakes("owner")["quiet"], [])
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
        self.assertEqual(self.wakes("owner")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": sent, "why": "not_answering"}])
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
        self.assertEqual(self.wakes("owner")["quiet"], [])
        self.assertEqual(self.wakes("agent-a")["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}])

    def test_everyone_counts_what_waits_on_the_record_as_the_agent_does_after_it_left_and_came_back(self):
        self.leave_and_come_back()
        self.command("message.post", {"body": "On the record, after it came back"}, target={"topic_id": "t1"})
        first = self.park()
        for reader in ("agent-a", "agent-b", "owner"):
            self.assertEqual(self.wakes(reader)["quiet"], [{"actor_id": "agent-a", "waiting": 1, "since_ms": first, "why": "not_answering"}], reader)


class WhisperCLICase(verbs.AgentVerbCase):
    def test_an_agent_reads_a_whisper_with_how_to_answer_and_answers_with_the_whisper_verb_and_others_see_nothing(self):
        asked = self.committed(self.command("message.post", {"body": "Is the copy final?", "addressees": ["agent-a"], "whisper": True},
                                            target={"topic_id": "t1"}))["message_id"]
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (asked,))[0][0]
        code, out, err = self.run_cli("read", "t1")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("#%d %s owner whispers to agent-a" % (seq, asked), out)
        self.assertIn("  (A whisper: only you and owner can read it. Answer with a whisper: whisper t1 --to owner --reply-to %s -. "
                      "It is a question, not an instruction to change your work, and it is never repeated where others can read it.)" % asked, out)
        code, out, err = self.run_cli("inbox")
        self.assertEqual((code, err), (0, ""))
        self.assertRegex(out, r'whisper "Topic" #%d owner: Is the copy final\?  \[d-\w+ in t1\]' % seq)
        code, out, err = self.run_cli("whisper", "t1", "--to", "owner", "--reply-to", asked, "-", stdin=b"Tomorrow.")
        self.assertEqual((code, err), (0, ""))
        answer = self.latest()
        self.assertEqual(out, "whispered %s to owner in t1\n" % answer[0])
        self.assertEqual(self.sql("SELECT private_to,reply_to,intent FROM messages WHERE id=?", (answer[0],)), [("owner", asked, None)])
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
    "topic_messages": "VISIBLE in each of its queries; a hidden parent's excerpt is blanked",
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
    "topic": "summaries, waits and participation are untouched by a whisper",
    "workspace_topics": "summaries, activity, order and waits are untouched by a whisper",
    "workspaces": "per-reader delivery counts",
    "outcome_light": "reads asks and summaries, which a whisper never writes",
    "source_topics": "_message_access applies visible()",
    "wakes": "on_record_wake_health for every reader but the agent",
    "memory_items": "Notebook revisions; a whisper is refused as evidence",
    "memory_current": "a Notebook page as it stands, read as the source view reads a revision; a whisper is refused as evidence",
    "capabilities": "no message", "operation": "the reader's own operation", "workspace": "no message",
    "opening": "the reader's own opening", "openings": "the reader's own openings", "workspace_members": "no message",
    "actors": "no message", "colors": "no message", "releases": "no message",
    "conversation": "counts items and lists asks, and a whisper is never an item or an ask; unread from the reader's own deliveries",
    "pipeline": "items, stages and asks about items, and a whisper is never an ask or an item's source",
    "pipeline_item": "each source and what it is still gathering through _message_access; a whisper is refused as either",
    "pipeline_row": "asks about items and work in Now pieces' topics, which a whisper never writes",
}
# Each read of the messages table outside the visibility rule, and why it shows no whisper to anyone outside it.
MESSAGE_READS = {
    "aim_next/delivery.py": ("migration backfill or settling, before any whisper exists or of the reader's own deliveries", 8),
    "aim_next/conversation.py": ("the topic page (VISIBLE, open items included), the reader's own deliveries, a reply checked by visible(), migrations", 20),
    "aim_next/standing_conversation.py": ("a conversation's items, answers and asks, which a whisper never is, the about links of a page already read through VISIBLE, "
                                          "and a pipeline item's message sources, which _source_rows refused as whispers", 8),
    "aim_next/marks.py": ("the reader's own marks, or a row checked by visible()", 4),
    "aim_next/outcome_light.py": ("an ask's message; a whisper never asks", 1),
    "aim_next/store.py": ("the latest message on the record from topic_summaries", 1),
    "aim_next/topic_state.py": ("asks, the conversation asks to someone who can no longer read it, and the latest message on the record", 5),
    "aim_next/sources.py": ("the latest message on the record from topic_summaries", 1),
    "aim_next/wake_health.py": ("on the record only (private_to IS NULL)", 1),
    "aim_next/whispers.py": ("the rule itself", 5),
    "aim_next/work.py": ("summaries on the record, and turn_handed on the record only", 6),
    "aim_next/pipeline.py": ("an owner's gate needs an ask, and asks about items, which a whisper never is; a source found by its "
                             "number then read through _message_access; sources and gathering shown through _message_access; "
                             "the operator's import of the hand-kept page, which refuses a whisper", 6),
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

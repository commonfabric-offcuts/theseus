from __future__ import annotations

"""An outcome's conversation (item 82, docs/conversation.md).

The fixture outcome w1 is owned by owner (a person), with agent-a and agent-b
on its team and agent-a its coordinator; its topic t1 has owner and agent-a
taking part. Every outcome has its conversation from the moment it is made,
so w1's is there before any check runs.
"""

import json
import sqlite3
import unittest

import test_agent_verbs as verbs

from aim_next import standing_conversation as standing


class ConversationCase(verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        found = self.found()
        self.assertIsNotNone(found, "every outcome has its conversation from the moment it is made")
        self.conversation = found["topic_id"]

    def found(self, actor="owner"):
        answer = self.store.view(actor, "conversation", {"workspace_id": "w1"})
        self.assertNotIn("error", answer, answer)
        return answer["conversation"]

    def post(self, body="Where does the launch stand?", actor="owner", topic=None, **args):
        return self.command("message.post", dict({"body": body}, **args), target={"topic_id": topic or self.conversation}, actor=actor)

    def posted(self, body="Where does the launch stand?", actor="owner", topic=None, **args):
        return self.committed(self.post(body, actor, topic, **args))["message_id"]

    def page(self, actor="owner", **args):
        answer = self.store.view(actor, "topic_messages", dict({"topic_id": self.conversation, "limit": 50}, **args))
        self.assertNotIn("error", answer, answer)
        return {item["id"]: item for item in answer["items"]}

    def item(self, message_id, actor="owner"):
        return self.page(actor)[message_id]["item"]

    def participants(self):
        return [row[0] for row in self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? AND active=1 ORDER BY actor_id",
                                           (self.conversation,))]

    def waiting(self):
        return self.sql("SELECT actor_id,ask_message_id FROM topic_waiting WHERE topic_id=? ORDER BY actor_id", (self.conversation,))

    def refusal(self, receipt, code):
        self.rejected(receipt, code)
        return receipt["error"]["message"]

    def versions(self):
        return (self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0],
                self.sql("SELECT version FROM topics WHERE id=?", (self.conversation,))[0][0])


class WhoIsInItCase(ConversationCase):
    def test_a_new_outcome_starts_its_conversation_with_its_people_and_coordinator_and_lists_it_apart(self):
        self.assertEqual(self.sql("SELECT kind,title,state,archived FROM topics WHERE id=?", (self.conversation,)),
                         [("conversation", standing.TITLE, "active", 0)])
        self.assertEqual(self.participants(), ["agent-a", "owner"], "the people and the coordinator, not the rest of the team")
        listed = [item["id"] for item in self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"]]
        self.assertEqual(listed, ["t1"], "the open list leaves the conversation to its own row")
        self.assertEqual(self.found()["coordinator"], {"actor_id": "agent-a", "kind": "agent"})
        created = self.command("workspace.create", {"id": "w2", "title": "Second"}, op="second")
        self.assertEqual(self.committed(created)["conversation_id"],
                         self.sql("SELECT id FROM topics WHERE workspace_id='w2' AND kind='conversation'")[0][0])
        self.assertEqual(self.command("workspace.create", {"id": "w2", "title": "Second"}, op="second"), created, "a retry is the first receipt")
        self.assertEqual(self.sql("SELECT version FROM workspaces WHERE id='w2'"), [(1,)], "a new outcome is at version 1")
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE workspace_id='w2'"), [(1,)])
        light = self.store.view("owner", "outcome_light", {"workspace_id": "w2"})
        self.assertEqual((light["light"]["light"], light["lead"]), ("quiet", {"kind": "no_topics"}), "its conversation is not one of its topics")

    def test_the_outcome_says_whether_it_has_a_conversation_so_a_page_knows_before_reading_it(self):
        self.assertEqual(self.store.view("agent-b", "workspace", {"workspace_id": "w1"})["workspace"]["conversation_id"], self.conversation)
        # An outcome made before version 28 has none until the operator starts it.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO workspaces VALUES ('w-old','owner','Older','',NULL,1)")
            db.execute("INSERT INTO workspace_members VALUES ('w-old','owner')")
        self.assertIsNone(self.store.view("owner", "workspace", {"workspace_id": "w-old"})["workspace"]["conversation_id"])
        self.assertIsNone(self.store.view("owner", "conversation", {"workspace_id": "w-old"})["conversation"])
        self.store.start_conversation("w-old", None, [])
        self.assertEqual(self.store.view("owner", "workspace", {"workspace_id": "w-old"})["workspace"]["conversation_id"],
                         self.store.view("owner", "conversation", {"workspace_id": "w-old"})["conversation"]["topic_id"])

    def test_changing_the_coordinator_moves_who_is_in_it_once_and_the_old_one_still_owes_its_asks(self):
        ask = self.posted("Can you check the copy?", addressees=["agent-a"], intent="ask")
        self.assertEqual(self.waiting(), [("agent-a", ask)])
        workspace, topic = self.versions()
        self.committed(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.participants(), ["agent-b", "owner"])
        self.assertEqual(self.versions(), (workspace + 1, topic + 1), "one act, one step of each version")
        # Still on the team, the old coordinator reads the conversation and can reply; only that, or leaving, clears it.
        self.assertEqual(self.waiting(), [("agent-a", ask)], "the old coordinator's open ask there still waits on it")
        self.assertEqual([(wait["ask_message_id"], wait["on"]) for wait in self.found()["waits"]], [(ask, "agent-a")])
        self.assertEqual(self.found()["coordinator"]["actor_id"], "agent-b")
        self.posted("Checked; it reads well.", actor="agent-a", reply_to=ask)
        self.assertEqual((self.waiting(), self.found()["waits"]), ([], []), "its reply to that ask clears it")
        # Choosing the same coordinator again changes nothing.
        workspace, topic = self.versions()
        self.committed(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.versions(), (workspace, topic))
        refused = self.command("workspace.coordinator_set", {"actor_id": "outsider"}, target={"workspace_id": "w1"},
                               expected={"workspace_revision": workspace})
        self.rejected(refused, "INVALID_RECIPIENT")
        self.rejected(self.command("workspace.coordinator_set", {"actor_id": "agent-a"}, target={"workspace_id": "w1"},
                                   expected={"workspace_revision": workspace}, actor="agent-a"), "FORBIDDEN")
        self.committed(self.command("workspace.coordinator_set", {"actor_id": None}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.participants(), ["owner"])
        self.assertIsNone(self.found()["coordinator"])

    def test_a_person_joining_the_team_joins_it_and_an_agent_joining_does_not(self):
        workspace, topic = self.versions()
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.participants(), ["agent-a", "other-reader", "owner"])
        self.assertEqual(self.versions(), (workspace + 1, topic + 1))
        workspace, topic = self.versions()
        self.committed(self.command("workspace.member_set", {"actor_id": "outsider", "present": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.participants(), ["agent-a", "other-reader", "owner"], "an agent is in it only as coordinator")
        self.assertEqual(self.versions(), (workspace + 1, topic), "nobody moved, so the conversation did not")
        workspace, topic = self.versions()
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": False}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.participants(), ["agent-a", "owner"])

    def deliveries(self, message_id):
        return [row[0] for row in self.sql("SELECT recipient_id FROM deliveries WHERE message_id=? ORDER BY recipient_id", (message_id,))]

    def pending_for(self, actor, message_id):
        return self.sql("SELECT g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.message_id=? AND d.recipient_id=?",
                        (message_id, actor))

    def test_the_coordinator_choice_is_the_owners_alone_fenced_by_revision_and_ends_the_old_ones_deliveries(self):
        pending = self.posted("Before the change")
        self.assertEqual(self.pending_for("agent-a", pending), [(1,)])
        workspace = self.versions()[0]
        self.rejected(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                   expected={"workspace_revision": workspace - 1}), "REVISION_CONFLICT")
        # The coordinator organises the outcome, yet only the owner chooses who answers.
        self.rejected(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                   expected={"workspace_revision": workspace}, actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.participants(), ["agent-a", "owner"])
        self.committed(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        self.assertEqual(self.pending_for("agent-a", pending), [(0,)], "the old coordinator's waiting delivery there is cancelled")
        later = self.posted("After the change")
        self.assertEqual(self.deliveries(later), ["agent-b"])

    def test_who_is_delivered_a_message_there_is_its_people_its_coordinator_and_whoever_it_names(self):
        unnamed = self.posted("Status?")
        self.assertEqual(self.deliveries(unnamed), ["agent-a"], "the coordinator, not the rest of the team")
        named = self.posted("@agent-b, the build?", addressees=["agent-b"], intent="ask")
        self.assertEqual(self.deliveries(named), ["agent-a", "agent-b"])
        self.posted("Green.", actor="agent-b", reply_to=named)
        self.assertEqual(self.participants(), ["agent-a", "owner"], "writing there makes no agent a participant")
        self.assertIn(unnamed, self.page("agent-b"), "every member reads it")
        by_agent = self.posted("I noticed the build is slow.", actor="agent-b")
        self.assertEqual(self.deliveries(by_agent), ["agent-a", "owner"])
        self.assertIsNotNone(self.item(by_agent), "an agent's new post is an item for the coordinator")

    def test_leaving_the_team_ends_a_place_in_it_with_its_waits_and_joining_brings_the_next_message(self):
        workspace = self.versions()[0]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": workspace}))
        joined = self.posted("Welcome")
        self.assertEqual(self.deliveries(joined), ["agent-a", "other-reader"])
        ask = self.posted("@other-reader can you review?", actor="agent-a", addressees=["other-reader"], intent="ask")
        self.assertEqual(self.waiting(), [("other-reader", ask)])
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": False}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual(self.waiting(), [], "their open asks there go with them")
        self.assertEqual(self.found()["waits"], [])
        # The coordinator leaving the team leaves the outcome with nobody answering.
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-a", "present": False}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual(self.sql("SELECT coordinator_id FROM workspaces WHERE id='w1'"), [(None,)])
        self.assertEqual(self.participants(), ["owner"])
        self.assertEqual(self.deliveries(self.posted("Anyone?")), [])

    def test_an_outcome_of_forty_people_has_all_of_them_in_it_and_the_topic_view_lists_every_one(self):
        people = ["person-%02d" % number for number in range(39)]
        self.sql("INSERT INTO actors(id,kind,name) VALUES " + ",".join("(?,'human',?)" for _ in people),
                 tuple(value for person in people for value in (person, person)))
        for person in people:
            self.committed(self.command("workspace.member_set", {"actor_id": person, "present": True}, target={"workspace_id": "w1"},
                                        expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual(len(self.participants()), 41)
        listed = self.store.view("owner", "topic", {"topic_id": self.conversation})
        self.assertEqual(len(listed["participants"]), 41)
        self.assertEqual(listed["topic"]["kind"], "conversation")
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["kind"], "topic")

    def test_it_never_ends_and_follows_the_team_and_every_other_topic_still_does_what_it_did(self):
        version = self.versions()[1]
        cases = (
            ({"title": "Renamed"}, standing.NEVER_ENDS), ({"archived": True}, standing.NEVER_ENDS),
            ({"state": "done"}, standing.NEVER_ENDS), ({"state": "waiting", "waiting_on": ["agent-a"]}, standing.ITEMS_SAY),
            ({"note": "Blocked on copy"}, standing.ITEMS_SAY),
        )
        for args, words in cases:
            with self.subTest(args=args):
                receipt = self.command("topic.update", args, target={"topic_id": self.conversation}, expected={"topic_revision": version})
                self.assertEqual(self.refusal(receipt, standing.RULE), words)
        receipt = self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": self.conversation})
        self.assertEqual(self.refusal(receipt, standing.RULE), standing.FOLLOWS_TEAM)
        self.assertEqual(self.participants(), ["agent-a", "owner"])
        ordinary = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.committed(self.command("topic.update", {"title": "Renamed"}, target={"topic_id": "t1"}, expected={"topic_revision": ordinary}))
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": True}, target={"topic_id": "t1"}))


class ItemsCase(ConversationCase):
    def test_what_people_and_named_agents_post_is_an_item_and_what_answers_is_not(self):
        asked = self.posted()
        coordinator = self.posted("Status: on track.", actor="agent-a")
        answer = self.posted("On track for Friday.", actor="agent-a", reply_to=asked)
        named = self.posted("@agent-b what did the test say?", addressees=["agent-b"], intent="ask")
        reply = self.posted("It passed.", actor="agent-b", reply_to=named)
        items = self.page()
        self.assertEqual({key: items[key]["item"] is not None for key in (asked, coordinator, answer, named, reply)},
                         {asked: True, coordinator: False, answer: False, named: True, reply: False})
        self.assertEqual(items[asked]["item"]["state"], "settled")
        [take] = items[asked]["item"]["takes"]
        self.assertEqual((take["kind"], take["ref"], take["actor_id"], take["part"]), ("answer", answer, "agent-a", False))
        # The reply to the ask answered the ask and the item it is.
        self.assertEqual(items[named]["item"]["state"], "settled")
        self.assertEqual(self.found()["new_items"], 0)
        # In an ordinary topic nothing is an item.
        self.posted("Ordinary words", topic="t1")
        page = self.store.view("owner", "topic_messages", {"topic_id": "t1", "limit": 50})
        self.assertTrue(all("item" not in item for item in page["items"]))

    def test_with_two_agents_named_either_answers_the_first_settles_it_and_the_second_adds_a_line(self):
        named = self.posted("@agent-a @agent-b who has the release?", addressees=["agent-a", "agent-b"], intent="ask")
        first = self.posted("I do.", actor="agent-b", reply_to=named)
        self.assertEqual(self.item(named)["state"], "settled")
        second = self.posted("Agreed, agent-b has it.", actor="agent-a", reply_to=named)
        self.assertEqual([take["ref"] for take in self.item(named)["takes"]], [first, second])

    def test_whispers_answers_and_replies_to_an_ask_are_not_items_and_a_follow_up_is(self):
        asked = self.posted("Is the copy final?")
        answer = self.posted("Yes.", actor="agent-a", reply_to=asked)
        follow = self.posted("And the images?", reply_to=answer)
        whisper = self.posted("Between us: is it late?", addressees=["agent-a"], whisper=True)
        back = self.posted("@owner which copy?", actor="agent-a", reply_to=follow, addressees=["owner"], intent="ask")
        reply = self.posted("The launch copy.", reply_to=back)
        items = self.page()
        self.assertEqual({key: items[key]["item"] is not None for key in (follow, back, reply)}, {follow: True, back: False, reply: False})
        self.assertEqual(self.sql("SELECT count(*) FROM conversation_items WHERE message_id=?", (whisper,)), [(0,)])

    def test_every_take_and_every_wait_touches_the_conversation_for_its_open_pages(self):
        def touches():
            return self.sql("SELECT count(*) FROM changes WHERE scope_kind='topic' AND scope_id=? AND resource_kind='topic'", (self.conversation,))[0][0]
        asked = self.posted("One thing")
        before, version = touches(), self.versions()[1]
        writing = {"workspace_id": "w1", "topic_id": "t-taken", "title": "Taken", "participants": ["agent-a"],
                   "body": "Opening", "attachments": [], "source_message_id": asked}
        self.committed(self.command("opening.save", writing, {"opening_id": "o-taken"}, {"opening_revision": 0}, actor="agent-a"))
        self.assertEqual(touches(), before, "saving the opening takes nothing yet")
        self.committed(self.command("opening.publish", {}, {"opening_id": "o-taken"}, {"opening_revision": 1}, actor="agent-a"))
        self.assertEqual(touches(), before + 1)
        self.assertEqual(self.versions()[1], version + 1)

    def test_only_who_answers_an_item_may_reply_to_it_and_elsewhere_any_agent_may(self):
        asked = self.posted()
        named = self.posted("@agent-b, is the build green?", addressees=["agent-b"], intent="ask")
        before = self.sql("SELECT count(*) FROM messages")
        words = self.refusal(self.post("Me too", actor="agent-b", reply_to=asked), standing.NOT_THE_ANSWERER)
        self.assertEqual(words, "agent-a answers this one; you answer here only when you are named")
        words = self.refusal(self.post("It is", actor="agent-a", reply_to=named), standing.NOT_THE_ANSWERER)
        self.assertEqual(words, "agent-b answers this one; you answer here only when you are named")
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), before, "nothing was sent")
        self.posted("It is green.", actor="agent-b", reply_to=named)
        # A person may always reply, and an agent may reply to what is not an item.
        self.posted("Thanks", reply_to=asked)
        status = self.posted("Status line", actor="agent-a")
        self.posted("Noted", actor="agent-b", reply_to=status, addressees=["agent-a"], intent="tell")
        # Nobody coordinating: no agent answers an item that names none.
        self.committed(self.command("workspace.coordinator_set", {"actor_id": None}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        later = self.posted("Anyone?")
        words = self.refusal(self.post("Me", actor="agent-a", reply_to=later), standing.NOT_THE_ANSWERER)
        self.assertEqual(words, "Nobody yet answers this one; you answer here only when you are named")
        opening = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        self.posted("In a topic anyone answers", actor="agent-b", topic="t1", reply_to=opening, addressees=["owner"], intent="tell")

    def test_an_answer_to_part_keeps_the_item_new_until_an_answer_to_all_of_it(self):
        asked = self.posted("Two things: the copy, and the date.")
        self.posted("The copy is final.", actor="agent-a", reply_to=asked, part=True)
        state = self.item(asked)
        self.assertEqual((state["state"], [take["part"] for take in state["takes"]]), ("new", [True]))
        self.assertEqual(self.found()["new_items"], 1)
        self.posted("The date is Friday.", actor="agent-a", reply_to=asked)
        state = self.item(asked)
        self.assertEqual((state["state"], [take["part"] for take in state["takes"]]), ("settled", [True, False]))
        # part belongs only to an answerer's reply to an item.
        other = self.posted("Another")
        cases = (("in a topic", "agent-a", {"topic": "t1"}), ("no item", "agent-a", {}),
                 ("a person", "owner", {"reply_to": other}))
        for name, actor, args in cases:
            with self.subTest(case=name):
                self.refusal(self.post("Part", actor=actor, part=True, **args), "INVALID_ARGUMENT")
        self.refusal(self.post("Part", actor="agent-b", part=True, reply_to=other), standing.NOT_THE_ANSWERER)
        self.refusal(self.post("Part", actor="agent-a", reply_to=other, part="yes"), "INVALID_ARGUMENT")

    def test_open_items_are_the_ones_not_settled_and_only_a_conversation_has_them(self):
        settled = self.posted("First")
        self.posted("Done", actor="agent-a", reply_to=settled)
        waiting = self.posted("Second")
        partial = self.posted("Third")
        self.posted("Half", actor="agent-a", reply_to=partial, part=True)
        self.assertEqual(list(self.page(items="open")), [waiting, partial])
        self.assertEqual(self.found()["new_items"], 2)
        refused = self.store.view("owner", "topic_messages", {"topic_id": "t1", "items": "open"})
        self.assertEqual(refused["error"]["code"], "INVALID_ARGUMENT")
        refused = self.store.view("owner", "topic_messages", {"topic_id": self.conversation, "items": "all"})
        self.assertEqual(refused["error"]["code"], "INVALID_ARGUMENT")

    def test_a_topic_started_from_an_item_says_so_under_it_and_part_keeps_it_new(self):
        whole = self.posted("Can we redo the onboarding?")
        part = self.posted("Two asks: pricing, and the FAQ.")
        cases = ((whole, False, "settled"), (part, True, "new"))
        for index, (source, partial, state) in enumerate(cases):
            with self.subTest(partial=partial):
                topic = "t-from-%d" % index
                writing = {"workspace_id": "w1", "topic_id": topic, "title": "Topic %d" % index, "participants": ["agent-a"],
                           "body": "Opening", "attachments": [], "source_message_id": source}
                if partial:
                    writing["part"] = True
                self.committed(self.command("opening.save", writing, {"opening_id": "o%d" % index}, {"opening_revision": 0}, actor="agent-a"))
                self.committed(self.command("opening.publish", {}, {"opening_id": "o%d" % index}, {"opening_revision": 1}, actor="agent-a"))
                found = self.item(source)
                self.assertEqual(found["state"], state)
                [take] = found["takes"]
                self.assertEqual((take["kind"], take["ref"], take["title"], take["readable"], take["part"]),
                                 ("topic", topic, "Topic %d" % index, True, partial))
        # A topic started from an ordinary topic's message records no take, and part needs a source.
        opening = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        writing = {"workspace_id": "w1", "topic_id": "t-plain", "title": "Plain", "participants": ["agent-a"],
                   "body": "Opening", "attachments": [], "source_message_id": opening}
        self.committed(self.command("opening.save", writing, {"opening_id": "o-plain"}, {"opening_revision": 0}))
        self.committed(self.command("opening.publish", {}, {"opening_id": "o-plain"}, {"opening_revision": 1}))
        self.assertEqual(self.sql("SELECT count(*) FROM conversation_takes WHERE ref='t-plain'"), [(0,)])
        writing = dict(writing, topic_id="t-none", part=True)
        del writing["source_message_id"]
        self.refusal(self.command("opening.save", writing, {"opening_id": "o-none"}, {"opening_revision": 0}), "INVALID_ARGUMENT")

    def test_an_item_put_on_the_pipeline_says_so_under_it_and_part_keeps_it_new(self):
        self.committed(self.command("pipeline.configure", {"enabled": True}, target={"workspace_id": "w1"}, expected={"pipeline_revision": 0}))

        def add(source, actor="agent-a", **args):
            receipt = self.command("pipeline.item_add", dict({"title": "From the conversation", "sources": [{"message_id": source}]}, **args),
                                   target={"workspace_id": "w1"}, actor=actor)
            return self.committed(receipt)["number"]

        def pipeline_takes(message_id):
            return [(take["numbers"], take["added"], take["actor_id"], take["part"]) for take in self.item(message_id)["takes"]]

        whole = self.posted("Can the page load faster?")
        part = self.posted("Two asks: dark mode, and the FAQ.")
        version = self.versions()[1]
        number = add(whole)
        self.assertEqual(self.item(whole)["state"], "settled")
        self.assertEqual(pipeline_takes(whole), [([number], False, "agent-a", False)])
        self.assertEqual(self.item(whole)["takes"][0]["kind"], "pipeline")
        self.assertEqual(self.versions()[1], version + 1, "the conversation's open pages see the new line")
        # Taking part of an item keeps it new; adding the rest of it to an item as a source settles it.
        partial = add(part, part=True)
        self.assertEqual((self.item(part)["state"], pipeline_takes(part)), ("new", [([partial], False, "agent-a", True)]))
        revision = self.store.view("owner", "pipeline_item", {"workspace_id": "w1", "number": number})["item"]["version"]
        self.committed(self.command("pipeline.source_add", {"sources": [{"message_id": part}]}, target={"workspace_id": "w1", "number": number},
                                    expected={"item_revision": revision}, actor="agent-a"))
        self.assertEqual((self.item(part)["state"], pipeline_takes(part)),
                         ("settled", [([partial], False, "agent-a", True), ([number], True, "agent-a", False)]))
        # A message that is no item here, or another outcome's item, records no take; part must be true or false.
        takes = self.sql("SELECT count(*) FROM conversation_takes")
        opening = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        add(opening)
        coordinator = self.posted("Status: on track.", actor="agent-a")
        add(coordinator)
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere"}, op="w2"))
        elsewhere = self.posted("An item of w2", topic=self.sql("SELECT id FROM topics WHERE workspace_id='w2'")[0][0])
        add(elsewhere, actor="owner")
        self.assertEqual(self.sql("SELECT count(*) FROM conversation_takes"), takes)
        later = self.posted("And the footer?")
        self.refusal(self.command("pipeline.item_add", {"title": "Footer", "sources": [{"message_id": later}], "part": "yes"},
                                  target={"workspace_id": "w1"}, actor="agent-a"), "INVALID_ARGUMENT")
        self.refusal(self.command("pipeline.source_add", {"sources": [{"note": "a note"}], "part": True},
                                  target={"workspace_id": "w1", "number": number}, actor="agent-a"), "INVALID_ARGUMENT")
        self.assertEqual(self.item(later), {"state": "new", "takes": []})

    def test_writing_about_another_topics_message_into_the_conversation_links_back_to_it(self):
        opening = self.opening
        self.committed(self.save_draft("about", opening, self.conversation, "This one needs a decision"))
        self.committed(self.prepare("about", self.conversation, submission="about-send", send_op="about-send"))
        sent = self.committed(self.command("message.send", {"submission_id": "about-send"}, target={"topic_id": self.conversation},
                                           op="about-send"))["message_id"]
        self.assertEqual(self.sql("SELECT reply_to,about_id FROM messages WHERE id=?", (sent,)), [(None, opening["id"])])
        about = self.page()[sent]["about"]
        self.assertEqual(about, {"message_id": opening["id"], "topic_id": "t1", "topic_title": "Topic", "author_id": "owner"})
        self.assertIsNotNone(self.page()[sent]["item"], "it is an item like any other post")
        # The same writing sent to an ordinary topic links nothing.
        self.create_second_topic()
        self.committed(self.save_draft("elsewhere", opening, "t2", "This one too"))
        self.committed(self.prepare("elsewhere", "t2", submission="elsewhere-send", send_op="elsewhere-send"))
        other = self.committed(self.command("message.send", {"submission_id": "elsewhere-send"}, target={"topic_id": "t2"},
                                            op="elsewhere-send"))["message_id"]
        self.assertEqual(self.sql("SELECT reply_to,about_id FROM messages WHERE id=?", (other,)), [(None, None)])

    def test_an_about_the_reader_cannot_open_shows_as_hidden_and_a_whisper_is_never_written_about(self):
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere"}, op="w2"))
        elsewhere = self.sql("SELECT id FROM topics WHERE workspace_id='w2'")[0][0]
        private = self.posted("Not for w1", topic=elsewhere)
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        linked = self.posted("About something")
        # No path writes an about to another outcome's message; the read refuses it all the same.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER immutable_messages_update")
            db.execute("UPDATE messages SET about_id=? WHERE id=?", (private, linked))
        self.assertEqual(self.page("other-reader")[linked]["about"], {"hidden": True})
        self.assertEqual(self.page("owner")[linked]["about"]["topic_id"], elsewhere)
        whisper = self.posted("Is it late?", topic="t1", addressees=["agent-a"], whisper=True)
        source = {"kind": "message", "id": whisper}
        self.committed(self.save_draft("whispered", source, self.conversation, "From a whisper"))
        self.committed(self.prepare("whispered", self.conversation, submission="whispered-send", send_op="whispered-send"))
        sent = self.command("message.send", {"submission_id": "whispered-send"}, target={"topic_id": self.conversation}, op="whispered-send")
        # As anywhere else, writing from a whisper links nothing to it, so the whisper stays between its two.
        self.assertEqual(self.sql("SELECT about_id,reply_to FROM messages WHERE id=?", (self.committed(sent)["message_id"],)), [(None, None)])

    def create_second_topic(self):
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w1"}
        self.committed(self.save_draft("opening-two", source, "t2", "Second opening",
                                       opening={"workspace_id": "w1", "title": "Second", "participants": ["agent-a"]}))
        self.committed(self.prepare("opening-two", "t2", submission="opening-two", send_op="open-two"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "opening-two"}, target={"topic_id": "t2"}, op="open-two"))


class WaitsCase(ConversationCase):
    def test_an_ask_waits_on_each_person_until_they_reply_to_that_ask(self):
        first = self.posted("@agent-b which build?", addressees=["agent-b"], intent="ask")
        second = self.posted("@agent-b and which branch?", addressees=["agent-b"], intent="ask")
        self.assertEqual(self.waiting(), [("agent-b", first)])
        # Writing elsewhere in the conversation answers no ask there.
        self.posted("Unrelated news.", actor="agent-b", addressees=["owner"], intent="tell")
        self.assertEqual(self.waiting(), [("agent-b", first)])
        self.posted("Build 12.", actor="agent-b", reply_to=first)
        self.assertEqual(self.waiting(), [("agent-b", second)], "the oldest open ask is the one the topic waits on")
        waits = self.found()["waits"]
        self.assertEqual([(wait["ask_message_id"], wait["on"], wait["by"], wait["item_id"], wait["excerpt"]) for wait in waits],
                         [(second, "agent-b", "owner", None, "and which branch?")])
        self.posted("main.", actor="agent-b", reply_to=second)
        self.assertEqual(self.waiting(), [])
        self.assertEqual(self.found()["waits"], [])

    def test_an_answerers_ask_back_on_an_item_waits_on_its_author_and_leaves_the_item_new(self):
        asked = self.posted("Can you move the launch?")
        back = self.posted("@owner to which day?", actor="agent-a", reply_to=asked, addressees=["owner"], intent="ask")
        self.assertEqual(self.item(asked), {"state": "new", "takes": []})
        [wait] = self.found()["waits"]
        self.assertEqual((wait["ask_message_id"], wait["on"], wait["item_id"]), (back, "owner", asked))
        self.posted("Friday.", reply_to=back)
        self.assertEqual(self.found()["waits"], [])
        self.assertEqual(self.item(asked)["state"], "new", "the person answering the ask back did not answer the item")

    def test_the_coordinators_asks_on_two_items_wait_apart_and_a_new_post_clears_neither(self):
        item_a, item_b = self.posted("Item A"), self.posted("Item B")
        self.posted("A is done.", actor="agent-a", reply_to=item_a)
        ask_a = self.posted("@owner is A right?", actor="agent-a", reply_to=item_a, addressees=["owner"], intent="ask")
        ask_b = self.posted("@owner which B?", actor="agent-a", reply_to=item_b, addressees=["owner"], intent="ask")
        self.assertEqual(self.waiting(), [("owner", ask_a)])
        self.posted("Item C")
        self.assertEqual(self.waiting(), [("owner", ask_a)], "a new post answers no ask")
        self.assertEqual([wait["ask_message_id"] for wait in self.found()["waits"]], [ask_a, ask_b])
        state = self.item(item_a)
        self.assertEqual((state["state"], [take["kind"] for take in state["takes"]]), ("settled", ["answer"]))
        self.assertEqual([wait["item_id"] for wait in self.found()["waits"]], [item_a, item_b], "item A is Answered and Waiting together")
        self.posted("Yes.", reply_to=ask_a)
        self.assertEqual(self.waiting(), [("owner", ask_b)])
        self.posted("The second.", reply_to=ask_b)
        self.assertEqual(self.waiting(), [])

    def test_an_agent_asked_there_that_leaves_the_team_is_waited_on_no_more_and_rejoining_brings_nothing_back(self):
        # agent-b is on the team, so it reads the conversation, but it is not a participant there.
        ask = self.posted("@agent-b which build?", addressees=["agent-b"], intent="ask")
        mine = self.posted("@owner is the copy final?", actor="agent-a", addressees=["owner"], intent="ask")
        self.assertNotIn("agent-b", self.participants())
        self.assertEqual(self.waiting(), [("agent-b", ask), ("owner", mine)])
        topic = self.versions()[1]
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": False}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual(self.waiting(), [("owner", mine)], "the conversation no longer waits on someone who cannot read it")
        self.assertEqual(self.sql("SELECT ask_id,actor_id FROM conversation_waits ORDER BY actor_id"), [(mine, "owner")],
                         "its open ask there goes with it; the ask on the owner stays")
        self.assertEqual([(wait["ask_message_id"], wait["on"]) for wait in self.found()["waits"]], [(mine, "owner")])
        self.assertGreater(self.versions()[1], topic, "open conversation pages learn the wait went")
        self.assertIn(("actor", "agent-b", "waiting", self.conversation),
                      set(self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id FROM changes")), "its attention learns it too")
        self.committed(self.command("workspace.member_set", {"actor_id": "agent-b", "present": True}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": self.versions()[0]}))
        self.assertEqual(self.waiting(), [("owner", mine)], "rejoining does not bring the old ask back")
        self.assertEqual([wait["on"] for wait in self.found()["waits"]], ["owner"], "the page and the attention list agree")

    def test_the_waiting_words_are_the_asks_first_sentence_without_its_names(self):
        self.assertEqual(standing.excerpt("@agent-b, @owner: Is it ready? And more."), "Is it ready?")
        self.assertEqual(standing.excerpt("No sentence end\nhere"), "No sentence end here")
        long = "x" * 200
        self.assertEqual(standing.excerpt(long), "x" * 159 + "…")


class CliCase(ConversationCase):
    def test_an_agent_reads_the_conversation_and_what_became_of_each_item(self):
        asked = self.posted("Where does the launch stand?")
        self.posted("On track.", actor="agent-a", reply_to=asked)
        open_item = self.posted("@agent-b check the build?", addressees=["agent-b"], intent="ask")
        code, out, err = self.run_cli("conversation", "w1")
        self.assertEqual((code, err), (0, ""))
        lines = out.splitlines()
        self.assertEqual(lines[0], 'conversation %s in "Isolated test": agent-a answers; 1 new' % self.conversation)
        self.assertIn("  [answered] by %s (agent-a, " % self.sql(
            "SELECT id FROM messages WHERE reply_to=?", (asked,))[0][0], out)
        self.assertIn("  [new] nothing taken yet", out)
        self.assertRegex(out, r"  \[waiting\] on agent-b .*\(ask %s\): check the build\?" % open_item)
        code, out, err = self.run_cli("conversation", "w1", "--new")
        self.assertEqual(code, 0)
        self.assertNotIn(asked, out)
        self.assertIn(open_item, out)
        code, out, err = self.run_cli("topics", "w1")
        self.assertEqual(out.splitlines()[0], "conversation %s (agent-a answers; 1 new)" % self.conversation)

    def test_the_owner_chooses_the_coordinator_and_an_answerer_posts_part_of_an_answer(self):
        asked = self.posted("Copy and date?")
        code, out, err = self.run_cli("post", self.conversation, "--reply-to", asked, "--part", "Copy is final.")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.item(asked)["state"], "new")
        code, out, err = self.run_cli("coordinator", "w1", "agent-b")
        self.assertEqual(code, 2, "only the owner chooses")
        code, out, err = self.run_cli("coordinator", "w1", "agent-b", "--none")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("Name the coordinator, or --none for nobody", err)


if __name__ == "__main__":
    unittest.main()

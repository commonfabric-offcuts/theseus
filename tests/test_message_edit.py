from __future__ import annotations

"""Editing a message in Core (item 228, docs/message-edit.md).

The fixture outcome w1 is owned by owner (a person), with agent-a and agent-b on
its team; its topic t1 has owner and agent-a taking part, so agent-a is sent
the topic's messages and agent-b reads them without being sent them.
other-reader is a person and outsider an agent, neither on the team. An edit
appends a revision; every agent that can read the message, other than the
editor, is sent one correction in a group of its own; every reader is told
with an `edit` change.
"""

import io
import json
import sqlite3
import types
import unittest

from aim_next import cli, hosted_notice
from aim_next.profile import load_profile
import reader_fixture as fixtures
import test_agent_verbs


class EditCase(fixtures.ReaderCase):
    def post(self, body="Words", actor="owner", topic="t1", **args):
        return self.committed(self.command("message.post", dict({"body": body}, **args), target={"topic_id": topic}, actor=actor))["message_id"]

    def edit(self, message, body, revision=1, actor="owner", op=None):
        return self.command("message.edit", {"body": body}, target={"message_id": message},
                            expected={"message_revision": revision}, actor=actor, op=op)

    def corrections(self, agent=None, message=None):
        """(recipient, message, revision, state) of every correction, oldest first."""
        return self.sql("SELECT d.recipient_id,d.message_id,d.revision,d.state FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                        "WHERE g.kind='correction'" + (" AND d.recipient_id=?" if agent else "") + (" AND d.message_id=?" if message else "")
                        + " ORDER BY d.seq", tuple(x for x in (agent, message) if x))

    def pending(self, agent, message):
        return [row[2] for row in self.corrections(agent, message) if row[3] == "pending"]

    def item(self, message, actor="owner"):
        page = self.store.view(actor, "topic_messages", {"topic_id": "t1", "message_ids": [message]})
        self.assertNotIn("error", page, page)
        self.assertEqual([item["id"] for item in page["items"]], [message])
        return page["items"][0]

    def listed(self, agent):
        page = self.store.view(agent, "deliveries", {})
        self.assertNotIn("error", page, page)
        return page["items"]

    def schedule(self, agent):
        rows = self.sql("SELECT pending_count,next_due_ms IS NOT NULL FROM recipient_schedule WHERE recipient_id=?", (agent,))
        return rows[0] if rows else (0, 0)

    def told(self, message):
        """Who was sent an `edit` change for the message, at which revision."""
        return self.sql("SELECT scope_id,version FROM changes WHERE scope_kind='actor' AND resource_kind='edit' AND resource_id=? ORDER BY scope_id,version",
                        (message,))

    def saw(self, agent, message):
        """The agent is handed the message's words (it reads its source), so an edit of it corrects that agent (slice 2:
        only an agent handed the words is corrected)."""
        return self.source({"kind": "message", "id": message}, actor=agent)

    def member(self, actor, present):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": actor, "present": present}, target={"workspace_id": "w1"},
                                    expected={"workspace_revision": version}))


class AppendCase(EditCase):
    """Acceptance 1 and 9: an edit appends a revision, and every read shows the latest words."""

    def test_an_edit_appends_revision_2_and_the_message_row_stays_byte_identical(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.saw("agent-b", message)
        row = self.sql("SELECT * FROM messages WHERE id=?", (message,))
        result = self.committed(self.edit(message, "Opening message, fixed"))
        self.assertEqual((result["message_id"], result["revision"], result["corrections"]), (message, 2, 2))
        self.assertIsInstance(result["edited_ms"], int)
        self.assertEqual(self.sql("SELECT * FROM messages WHERE id=?", (message,)), row, "the message's own row never changes")
        self.assertEqual(self.sql("SELECT message_id,revision,author_id,body,edited_ms FROM message_revisions"),
                         [(message, 2, "owner", "Opening message, fixed", result["edited_ms"])])
        for statement in ("UPDATE messages SET body='x' WHERE id=?", "DELETE FROM messages WHERE id=?",
                          "UPDATE message_revisions SET body='x' WHERE message_id=?", "DELETE FROM message_revisions WHERE message_id=?"):
            with self.subTest(statement=statement), self.assertRaises(sqlite3.IntegrityError):
                self.sql(statement, (message,))
        receipt = self.store.view("owner", "operation", {"operation_id": "op-%d" % self.serial})
        self.assertEqual(receipt["affected"], [{"kind": "message", "id": message, "version": 2}])

    def test_topic_messages_source_and_the_reply_line_read_revision_1_then_the_latest_words(self):
        message = self.opening["id"]
        reply = self.post("Answering", actor="agent-a", reply_to=message)
        before = self.item(message)
        self.assertEqual((before["revision"], before["edited_ms"], before["body"]), (1, None, "Opening message"))
        self.assertEqual(self.item(reply)["reply_to_excerpt"], "Opening message")
        edited = self.committed(self.edit(message, "Opening message, fixed " + "x" * 200))
        after = self.item(message)
        self.assertEqual((after["revision"], after["edited_ms"], after["body"][:22]), (2, edited["edited_ms"], "Opening message, fixed"))
        self.assertEqual(self.item(reply)["reply_to_excerpt"], ("Opening message, fixed " + "x" * 200)[:120], "a reply's line is the latest words")
        for form in ({}, {"audience": "reader"}, {"direction": "before"}):
            with self.subTest(form=form):
                page = self.store.view("agent-b", "topic_messages", dict({"topic_id": "t1"}, **form))
                found = next(item for item in page["items"] if item["id"] == message)
                self.assertEqual((found["revision"], found["edited_ms"]), (2, edited["edited_ms"]))
                unedited = next(item for item in page["items"] if item["id"] == reply)
                self.assertEqual((unedited["revision"], unedited["edited_ms"]), (1, None))
        source = self.source({"kind": "message", "id": message}, actor="agent-b")
        self.assertEqual((source["body"][:22], source["revision"], source["edited_ms"], source["version"], source["current_revision"]),
                         ("Opening message, fixed", 2, edited["edited_ms"], 2, 2))

    def test_message_ids_returns_those_items_in_page_shape_and_refuses_what_the_reader_cannot_see(self):
        first, second = self.opening["id"], self.post("Second")
        whisper = self.post("Between us", addressees=["agent-a"], whisper=True)
        page = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [second, first, second]})
        self.assertEqual([item["id"] for item in page["items"]], [first, second], "each once, in sequence order")
        full = self.store.view("agent-b", "topic_messages", {"topic_id": "t1"})["items"]
        self.assertEqual(page["items"], [item for item in full if item["id"] in (first, second)], "the page's own shape")
        unknown = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": ["m-nobody"]})
        hidden = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [whisper]})
        self.assertEqual(hidden.get("error"), unknown.get("error"), "a whisper outside the reader is refused as an unknown id")
        self.assertEqual(hidden.get("error", {}).get("code"), "FORBIDDEN")
        self.assertEqual([item["id"] for item in self.store.view("agent-a", "topic_messages", {"topic_id": "t1", "message_ids": [whisper]})["items"]],
                         [whisper])
        for ids in ([], ["m-%d" % n for n in range(101)], "m-1", [1]):
            with self.subTest(ids=ids):
                self.assertEqual(self.store.view("owner", "topic_messages", {"topic_id": "t1", "message_ids": ids}).get("error", {}).get("code"), "INVALID_ARGUMENT")

    def test_excerpt_reads_show_the_latest_words(self):
        message = self.opening["id"]
        self.committed(self.command("message.star", {"starred": True}, target={"message_id": message}, expected={"star_revision": 0}))
        self.committed(self.edit(message, "Starred and fixed"))
        [star] = self.store.view("owner", "stars", {})["items"]
        self.assertEqual(star["excerpt"], "Starred and fixed")


class CorrectionCase(EditCase):
    """Acceptance 2 and 3: who is sent a correction, and that it is only a correction."""

    def test_every_agent_that_reads_it_gets_exactly_one_correction_and_is_woken_and_a_person_never_does(self):
        self.member("other-reader", True)
        message = self.opening["id"]
        for reader in ("agent-a", "agent-b", "other-reader"):
            self.saw(reader, message)
        self.assertEqual(self.schedule("agent-b"), (0, 0), "agent-b is sent nothing until the edit")
        self.committed(self.edit(message, "Fixed"))
        self.assertEqual(sorted(row[:3] for row in self.corrections()), [("agent-a", message, 2), ("agent-b", message, 2)],
                         "the agent sent it and the agent that only reads it; no person, and not the editor")
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE revision>1 AND recipient_id IN ('owner','other-reader','outsider')"), [(0,)])
        self.assertEqual(self.schedule("agent-b"), (1, 1), "agent-b now has its correction pending and is due")
        handed = self.sql("SELECT d.seq FROM deliveries d WHERE d.recipient_id='agent-a' AND d.revision=1")[0][0]
        correction = self.sql("SELECT seq,id FROM deliveries WHERE recipient_id='agent-a' AND revision=2")[0]
        self.assertGreater(correction[0], handed)
        self.assertEqual([item["id"] for item in self.listed("agent-a") if item.get("correction")], [correction[1]])
        self.assertEqual(self.told(message), [("agent-a", 2), ("agent-b", 2), ("other-reader", 2), ("owner", 2)],
                         "every reader, people and agents, the editor included, and nobody else")
        self.assertIn(("agent-b", "delivery"), self.sql("SELECT scope_id,resource_kind FROM changes WHERE resource_kind='delivery' AND scope_id='agent-b'"))

    def test_no_agent_that_was_never_handed_the_words_gets_a_correction_and_every_reader_is_told(self):
        self.member("other-reader", True)
        message = self.opening["id"]
        self.assertEqual(self.committed(self.edit(message, "Fixed"))["corrections"], 0)
        self.assertEqual(self.corrections(), [], "agent-a was sent it but never read it; agent-b never read it")
        self.assertEqual(self.schedule("agent-b"), (0, 0))
        self.assertEqual(self.told(message), [("agent-a", 2), ("agent-b", 2), ("other-reader", 2), ("owner", 2)])
        self.assertEqual(self.source({"kind": "message", "id": message}, actor="agent-b")["body"], "Fixed")

    def test_a_newer_correction_settles_the_older_one_and_previews_its_own_revision(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.saw("agent-b", message)
        self.committed(self.edit(message, "Second words"))
        [older] = [item for item in self.listed("agent-b") if item.get("correction")]
        self.assertEqual((older["correction"], older["message"]["body"], older["message"]["revision"]), ({"revision": 2}, "Second words", 2))
        self.committed(self.edit(message, "Third words", revision=2))
        self.assertEqual([row[2:] for row in self.corrections("agent-b", message)], [(2, "acknowledged"), (3, "pending")])
        [newer] = [item for item in self.listed("agent-b") if item.get("correction")]
        self.assertEqual((newer["correction"], newer["message"]["body"], newer["reasons"]), ({"revision": 3}, "Third words", ["correction"]))
        self.assertEqual(self.schedule("agent-b")[0], 1, "one correction pending, never two")
        settled = self.store.view("agent-b", "delivery", {"delivery_id": older["id"]})
        self.assertEqual((settled["item"]["state"], settled["item"]["message"]["body"], settled["item"]["message"]["revision"]),
                         ("acknowledged", "Second words", 2), "a correction previews its own revision, not the latest")
        ordinary = [item for item in self.listed("agent-a") if not item.get("correction")]
        self.assertEqual([(item["message"]["body"], item["message"]["revision"]) for item in ordinary if item["message_id"] == message],
                         [("Third words", 3)], "an ordinary delivery previews the latest words")

    def test_a_correction_moves_no_count_wait_or_ask_and_only_its_own_ack_settles_it(self):
        ask = self.post("Can you check it?", addressees=["agent-a"], intent="ask")
        # Two later Tells keep more pending direct rows than the read-through's addressed walk holds, so that walk
        # answers it (conversation._pending_addressed) and must leave the correction out by itself.
        self.post("Also this", addressees=["agent-a"], intent="tell")
        self.post("And this", addressees=["agent-a"], intent="tell")
        attention = self.store.view("agent-a", "attention", {})
        summary = self.sql("SELECT * FROM topic_summaries")
        topic = self.sql("SELECT version FROM topics WHERE id='t1'")
        waiting = self.sql("SELECT * FROM topic_waiting ORDER BY topic_id,actor_id")
        unread = self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})
        self.committed(self.edit(ask, "Can you check it today?"))
        after = self.store.view("agent-a", "attention", {})
        self.assertEqual({key: after[key] for key in ("unread", "addressed")}, {key: attention[key] for key in ("unread", "addressed")})
        self.assertEqual([item["id"] for item in after["latest_addressed"]], [item["id"] for item in attention["latest_addressed"]])
        self.assertEqual(self.store.view("agent-a", "capabilities", {})["attention"]["after"],
                         max(item["seq"] for item in attention["latest_addressed"]), "_addressed_after ignores corrections")
        self.assertEqual((self.sql("SELECT * FROM topic_summaries"), self.sql("SELECT version FROM topics WHERE id='t1'"),
                          self.sql("SELECT * FROM topic_waiting ORDER BY topic_id,actor_id")), (summary, topic, waiting))
        self.assertEqual(self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})["oldest_unread"], unread["oldest_unread"])
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (ask,))[0][0]
        self.committed(self.command("topic.read_through", {"seq": seq}, target={"topic_id": "t1"}, actor="agent-a"))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": ask}, expected={"thumb_revision": 0}, actor="agent-a"))
        self.assertEqual(self.pending("agent-a", ask), [2], "read-through and a thumb leave it pending")
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE message_id=? AND recipient_id='agent-a' AND revision=1", (ask,)), [("acknowledged",)])
        self.assertEqual(self.sql("SELECT r.reason FROM delivery_reasons r JOIN deliveries d ON d.id=r.delivery_id WHERE d.revision=2 AND d.recipient_id='agent-a'"),
                         [("correction",)], "never `addressed`")
        correction = self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-a' AND revision=2", (ask,))[0][0]
        self.committed(self.command("delivery.ack", {}, target={"delivery_id": correction}, actor="agent-a"))
        self.assertEqual(self.pending("agent-a", ask), [])


class AccessCase(EditCase):
    """Acceptance 4: an edit never widens who reads a message."""

    def test_an_agent_removed_before_the_edit_gets_nothing(self):
        self.member("agent-b", False)
        self.committed(self.edit(self.opening["id"], "Fixed"))
        self.assertEqual(self.corrections("agent-b"), [])
        self.assertEqual([row for row in self.told(self.opening["id"]) if row[0] == "agent-b"], [])

    def test_losing_the_message_settles_its_correction_and_leaves_no_preview_count_or_wake(self):
        message = self.opening["id"]
        self.saw("agent-b", message)
        self.committed(self.edit(message, "Words agent-b may no longer read"))
        self.assertEqual(self.schedule("agent-b"), (1, 1))
        correction = self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND revision=2")[0][0]
        self.member("agent-b", False)
        self.assertEqual(self.listed("agent-b"), [], "no preview in the inbox")
        self.assertEqual(self.store.view("agent-b", "delivery", {"delivery_id": correction}).get("error", {}).get("code"), "FORBIDDEN")
        self.assertEqual(self.schedule("agent-b"), (0, 0), "no stale pending count and nothing due, so no wake")
        self.assertIsNone(hosted_notice.notice(self.listed("agent-b"), None, "agent-b", "attempt-1"))
        # A second edit sends it nothing either.
        self.committed(self.edit(message, "Third words", revision=2))
        self.assertEqual([row[2:] for row in self.corrections("agent-b")], [(2, "acknowledged")])
        self.assertEqual(self.schedule("agent-b"), (0, 0))
        self.assertNotIn(("agent-b", 3), self.told(message))

    def test_a_correction_whose_message_is_no_longer_readable_is_never_listed_even_unsettled(self):
        # Access lost by a write that settles nothing (here the team row is removed by hand): every read of pending
        # corrections leaves it out by itself.
        message = self.opening["id"]
        self.saw("agent-b", message)
        self.committed(self.edit(message, "Words agent-b may no longer read"))
        correction = self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND revision=2")[0][0]
        self.sql("DELETE FROM workspace_members WHERE actor_id='agent-b'")
        self.assertEqual(self.pending("agent-b", message), [2], "nothing settled it")
        self.assertEqual(self.listed("agent-b"), [])
        self.assertEqual(self.store.view("agent-b", "delivery", {"delivery_id": correction}).get("error", {}).get("code"), "FORBIDDEN")
        self.assertIsNone(hosted_notice.notice(self.listed("agent-b"), None, "agent-b", "attempt-1"))

    def test_a_page_reads_on_past_corrections_it_leaves_out(self):
        # Two corrections agent-b can no longer read come before one it can; a one-item page still finds that one.
        lost = [self.opening["id"], self.post("Second")]
        kept = self.post("For you", addressees=["agent-b"], intent="tell")
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))
        for message in lost + [kept]:
            self.saw("agent-b", message)
            self.committed(self.edit(message, "Fixed words"))
        self.sql("DELETE FROM workspace_members WHERE actor_id='agent-b'")
        page = self.store.view("agent-b", "deliveries", {"limit": 1})
        self.assertEqual([(item["message_id"], item["correction"]) for item in page.get("items", [])], [(kept, {"revision": 2})], page)
        if page["next_cursor"]:
            self.assertEqual(self.store.view("agent-b", "deliveries", {"limit": 1, "cursor": page["next_cursor"]})["items"], [])

    def test_leaving_the_topic_settles_a_correction_only_where_the_message_is_lost(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.committed(self.edit(message, "Fixed"))
        # agent-a leaves t1 but stays on the team, so it still reads the message: its correction stays.
        self.participation("agent-a", False)
        self.assertEqual(self.pending("agent-a", message), [2])
        self.assertEqual([item["correction"] for item in self.listed("agent-a") if item.get("correction")], [{"revision": 2}])

    def test_a_topic_only_reader_that_leaves_has_its_correction_settled_with_no_count_or_wake(self):
        message = self.opening["id"]
        self.participation("outsider", True)
        self.saw("outsider", message)
        self.committed(self.edit(message, "Fixed"))
        self.assertEqual(self.pending("outsider", message), [2])
        self.participation("outsider", False)
        self.assertEqual(self.pending("outsider", message), [])
        self.assertEqual((self.listed("outsider"), self.schedule("outsider")), ([], (0, 0)))
        self.assertIsNone(hosted_notice.notice(self.listed("outsider"), None, "outsider", "attempt-1"))

    def test_a_message_sent_by_name_stays_readable_so_its_correction_stays(self):
        message = self.post("For you", addressees=["agent-b"], intent="tell")
        self.member("agent-b", False)
        self.source({"kind": "message", "id": message}, actor="agent-b")
        self.committed(self.edit(message, "For you, fixed"))
        self.assertEqual(self.pending("agent-b", message), [2])
        [item] = [item for item in self.listed("agent-b") if item.get("correction")]
        self.assertEqual(item["message"]["body"], "For you, fixed")

    def test_a_whisper_edit_reaches_only_its_agent_and_its_notice_keeps_it_private(self):
        whisper = self.post("Between us", addressees=["agent-a"], whisper=True)
        self.saw("agent-a", whisper)
        self.committed(self.edit(whisper, "Between us, fixed"))
        self.assertEqual([row[0] for row in self.corrections(message=whisper)], ["agent-a"])
        self.assertEqual(self.told(whisper), [("agent-a", 2), ("owner", 2)])
        items = [item for item in self.listed("agent-a") if item.get("correction")]
        notice = hosted_notice.notice(items, None, "agent-a", "attempt-1")
        text = notice["input"][0]["text"]
        delivery = items[0]["id"]
        self.assertIn("correction: message %s by owner was edited to revision 2; not a new ask, Tell or reply; read it, act on its "
                      "latest words, then ack delivery %s. A whisper: only you and owner can read it." % (whisper, delivery), text)
        self.assertNotIn("counts as a Tell", text)
        self.assertNotIn("Between us, fixed", text, "the words go to the untrusted context only")
        self.assertIn("Between us, fixed", json.dumps(notice["additionalContext"], ensure_ascii=False))


class NoticeCase(EditCase):
    def test_the_hosted_notice_names_a_correction_in_cores_words(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.committed(self.edit(message, "Fixed words"))
        items = self.listed("agent-a")
        correction = next(item for item in items if item.get("correction"))
        text = hosted_notice.notice(items, None, "agent-a", "attempt-1")["input"][0]["text"]
        self.assertIn("correction: message %s by owner was edited to revision 2; not a new ask, Tell or reply; read it, act on its latest "
                      "words, then ack delivery %s." % (message, correction["id"]), text)
        self.assertNotIn("A whisper", text)
        self.assertIn("A correction says its author edited a message you were sent", hosted_notice.developer_instructions("agent-a", "cli", "p"))


class RefusalCase(EditCase):
    """Acceptance 6 and 7."""

    def test_the_same_operation_gives_the_same_receipt_one_revision_and_one_correction_each(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.saw("agent-b", message)
        first = self.edit(message, "Fixed", op="o-1")
        self.committed(first)
        # The answer was lost: the operation says what happened, and sending it again gives the same receipt.
        self.assertEqual(self.store.view("owner", "operation", {"operation_id": "o-1"}), first)
        self.assertEqual(self.edit(message, "Fixed", op="o-1"), first)
        self.assertEqual(self.sql("SELECT count(*) FROM message_revisions"), [(1,)])
        self.assertEqual(sorted(row[0] for row in self.corrections()), ["agent-a", "agent-b"])
        mismatch = self.edit(message, "Other words", op="o-1")
        self.assertEqual((mismatch.get("error", {}).get("code"), mismatch["recorded"]), ("OPERATION_PAYLOAD_MISMATCH", False))

    def test_a_stale_base_is_a_recorded_conflict_that_the_same_operation_returns_again(self):
        message = self.opening["id"]
        self.saw("agent-a", message)
        self.committed(self.edit(message, "Phone words", op="o-2"))
        stale = self.edit(message, "Laptop words", op="o-3")
        self.assertEqual((stale.get("error", {}).get("code"), stale["recorded"], stale.get("error", {}).get("current_versions")),
                         ("REVISION_CONFLICT", True, {"message_revision": 2}))
        self.assertEqual(self.edit(message, "Laptop words", op="o-3"), stale)
        self.committed(self.edit(message, "Laptop words", revision=2, op="o-4"))
        self.assertEqual([row[2:] for row in self.corrections("agent-a")], [(2, "acknowledged"), (3, "pending")])

    def test_refusals_change_nothing(self):
        mine, theirs = self.opening["id"], self.post("Agent words", actor="agent-a")
        self.member("other-reader", True)
        person = self.post("Someone else's words", actor="other-reader")
        whisper = self.post("Between us", addressees=["agent-a"], whisper=True)
        before = self.sql("SELECT count(*) FROM message_revisions"), self.sql("SELECT count(*) FROM deliveries")
        cases = [
            (self.edit(mine, "   "), "EMPTY_MESSAGE", True),
            (self.edit(person, "Not mine"), "FORBIDDEN", True),
            (self.edit(theirs, "Not mine"), "FORBIDDEN", True),
            # An agent edits only its own words (item 614): agent-b's edit of agent-a's message is refused.
            (self.edit(theirs, "Agent words, fixed", actor="agent-b"), "FORBIDDEN", True),
            (self.edit(mine, "Opening message"), "INVALID_ARGUMENT", False),
            (self.command("message.edit", {"body": "No base"}, target={"message_id": mine}), "INVALID_ARGUMENT", False),
            (self.command("message.edit", {"body": "x", "extra": 1}, target={"message_id": mine}, expected={"message_revision": 1}), "INVALID_ARGUMENT", False),
        ]
        for receipt, code, recorded in cases:
            with self.subTest(code=code, receipt=receipt):
                self.assertEqual((receipt.get("error", {}).get("code"), receipt["recorded"]), (code, recorded))
        self.assertEqual(cases[3][0].get("error", {}).get("message"), "Only whoever wrote a message edits it")
        self.assertEqual(cases[1][0].get("error", {}).get("message"), "Only whoever wrote a message edits it")
        for actor in ("agent-b", "other-reader"):
            with self.subTest(actor=actor):
                hidden, unknown = self.edit(whisper, "Mine now", actor=actor), self.edit("m-nobody", "Mine now", actor=actor)
                self.assertEqual(hidden.get("error"), unknown.get("error"), "a whisper outside them is refused exactly as an unknown id")
        self.assertEqual((self.sql("SELECT count(*) FROM message_revisions"), self.sql("SELECT count(*) FROM deliveries")), before)

    def test_a_reached_outcome_refuses_an_edit(self):
        self.sql("INSERT INTO outcome_reached VALUES ('w1','Done','[]','owner',1)")
        refused = self.edit(self.opening["id"], "Too late")
        self.assertEqual((refused.get("error", {}).get("code"), refused["recorded"]), ("OUTCOME_REACHED", True))
        self.assertEqual(self.sql("SELECT count(*) FROM message_revisions"), [(0,)])

    def test_an_answered_ask_stays_editable(self):
        ask = self.post("May I ship?", actor="agent-a", addressees=["owner"], intent="ask", go_ahead=True)
        self.committed(self.command("message.answer", {"answer": "yes"}, target={"message_id": ask}, expected={"answer_revision": 0}))
        reply = self.sql("SELECT id FROM messages WHERE reply_to=? AND author_id='owner'", (ask,))[0][0]
        self.assertEqual(self.committed(self.edit(reply, "✅ Go ahead, after the review"))["revision"], 2)


class QuoteCase(EditCase):
    """Acceptance 8: a quote names the revision it quoted, and is checked against it."""

    def quoting(self, excerpt, **source):
        ref = dict({"kind": "message", "id": self.opening["id"]}, **source)
        return [{"source": ref, "excerpt": excerpt}]

    def send_quote(self, excerpt, **source):
        # Each draft replies to a message of its own, so each is a new editor.
        replying = self.post("Something to answer")
        key = "quote-%d" % (self.serial + 1)
        self.committed(self.command("draft.save", {
            "source_ref": {"kind": "message", "id": replying}, "topic_id": "t1", "generation": "gA", "body": "Quoting",
            "attachments": [], "quotes": self.quoting(excerpt, **source), "addressees": []}, target={"draft_id": key}, expected={"draft_revision": 0}))
        prepared = self.prepare(key, "t1", submission=key, send_op=key + "-send")
        if prepared.get("status") != "committed":
            return prepared
        return self.command("message.send", {"submission_id": key}, target={"topic_id": "t1"}, op=key + "-send")

    def stored(self, receipt):
        return json.loads(self.sql("SELECT quotes FROM messages WHERE id=?", (receipt["result"]["message_id"],))[0][0])

    def test_a_quote_of_revision_1_words_sends_after_the_edit_and_records_revision_1(self):
        self.committed(self.edit(self.opening["id"], "Rewritten entirely"))
        sent = self.send_quote("Opening", revision=1)
        self.committed(sent)
        self.assertEqual(self.stored(sent)[0]["source"]["revision"], 1)
        newer = self.send_quote("Rewritten", revision=2)
        self.assertEqual(self.stored(self.committed(newer) and newer)[0]["source"]["revision"], 2)

    def test_a_quote_records_the_revision_it_names_even_when_a_later_one_has_the_same_words(self):
        self.committed(self.edit(self.opening["id"], "Opening message, fixed"))
        for revision in (1, 2):
            with self.subTest(revision=revision):
                sent = self.send_quote("Opening message", revision=revision)
                self.committed(sent)
                self.assertEqual(self.stored(sent)[0]["source"], {"kind": "message", "id": self.opening["id"], "revision": revision})

    def test_a_quote_must_be_in_the_revision_it_names(self):
        self.committed(self.edit(self.opening["id"], "Rewritten entirely"))
        for excerpt, revision in (("Rewritten", 1), ("Opening", 2), ("Opening", 3), ("Opening", True)):
            with self.subTest(excerpt=excerpt, revision=revision):
                self.rejected(self.send_quote(excerpt, revision=revision), "INVALID_QUOTE")

    def test_an_unversioned_quote_may_quote_any_revision_and_records_none(self):
        self.committed(self.edit(self.opening["id"], "Rewritten entirely"))
        for excerpt in ("Opening", "Rewritten"):
            with self.subTest(excerpt=excerpt):
                sent = self.send_quote(excerpt)
                self.committed(sent)
                self.assertNotIn("revision", self.stored(sent)[0]["source"], "Core never fills in the newest")
        self.rejected(self.send_quote("In no revision"), "INVALID_QUOTE")

    def test_stored_quotes_are_unchanged_by_an_edit(self):
        sent = self.send_quote("Opening", revision=1)
        self.committed(sent)
        quotes = self.sql("SELECT quotes FROM messages WHERE id=?", (sent["result"]["message_id"],))
        self.committed(self.edit(self.opening["id"], "Rewritten entirely"))
        self.assertEqual(self.sql("SELECT quotes FROM messages WHERE id=?", (sent["result"]["message_id"],)), quotes)


class RaceCase(EditCase):
    """Acceptance 8 (slice 2): an agent's read and a person's Save, on two connections, in either order. A read that
    hands words not yet recorded records them in a write of its own (the boundary), so it either commits before the
    Save, and is corrected, or after it, and reads the new words; it never answers with words it did not record."""

    def envelope(self, body, op):
        return {"v": 1, "instance_id": "test-instance", "operation_id": op, "kind": "message.edit",
                "target": {"message_id": self.opening["id"]}, "expected": {"message_revision": 1, "authority": dict(self.pin)},
                "args": {"body": body}}

    def read(self, **seams):
        page = self.store._view("agent-b", "topic_messages", {"topic_id": "t1"}, **seams)
        self.assertNotIn("error", page, page)
        return next(item for item in page["items"] if item["id"] == self.opening["id"])

    def exposure(self):
        return self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-b' AND message_id=?", (self.opening["id"],))

    def commit_seq(self):
        return int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])

    def test_a_read_inside_the_saves_write_is_busy_hands_nothing_and_the_save_commits(self):
        seen = []

        def effect(db, actor, envelope):
            # The edit is written but not committed; the read is a second connection, whose record waits on the write.
            result = self.store._command_message_edit(db, actor, envelope)
            seen.append(self.store.view("agent-b", "topic_messages", {"topic_id": "t1"}))
            return result
        receipt = self.store._execute_command("owner", self.envelope("Fixed words", "race-1"), effect=effect)
        self.committed(receipt)
        self.assertEqual(seen[0], {"instance_id": "test-instance", "error": {"code": "DATABASE_BUSY", "message": "Read is temporarily unavailable",
                                                                             "retryable": True}}, "no words")
        self.assertEqual(self.exposure(), [], "no exposure")
        self.assertEqual(self.pending("agent-b", self.opening["id"]), [], "and so no correction")
        self.assertEqual(self.read()["body"], "Fixed words", "read again, it reads the Save's words")

    def test_a_read_committed_before_the_save_is_corrected_once(self):
        self.assertEqual(self.read()["body"], "Opening message")
        self.assertEqual(self.exposure(), [(1,)])
        self.committed(self.store.command("owner", self.envelope("Fixed words", "race-2")))
        self.assertEqual(self.pending("agent-b", self.opening["id"]), [2])

    def test_a_read_after_the_save_gets_the_new_words_and_no_correction(self):
        self.committed(self.store.command("owner", self.envelope("Fixed words", "race-3")))
        item = self.read()
        self.assertEqual((item["revision"], item["body"]), (2, "Fixed words"))
        self.assertEqual(self.pending("agent-b", self.opening["id"]), [])
        self.assertEqual(self.exposure(), [(2,)])

    def test_an_edit_between_the_two_runs_is_read_by_the_second(self):
        def between():
            self.committed(self.store.command("owner", self.envelope("Fixed words", "race-4")))
        item = self.read(between=between)
        self.assertEqual((item["revision"], item["body"]), (2, "Fixed words"), "the second run's words, not the first's")
        self.assertEqual(self.exposure(), [(2,)])
        self.assertEqual(self.pending("agent-b", self.opening["id"]), [])

    def test_the_same_record_between_the_two_runs_grows_nothing_and_writes_once(self):
        before = self.commit_seq()

        def between():
            self.read()
        item = self.read(between=between)
        self.assertEqual(item["body"], "Opening message")
        self.assertEqual(self.exposure(), [(1,)])
        self.assertEqual(self.commit_seq(), before + 1, "only the read between committed")


class CliCase(test_agent_verbs.WatchReadingCase):
    """The agent's CLI: watch --once prints the correction line in the edit's commit, inbox lists it as one, and read
    marks an edited message."""

    def edit(self, message, body, revision=1):
        return self.committed(self.command("message.edit", {"body": body}, target={"message_id": message},
                                           expected={"message_revision": revision}))

    def test_watch_once_prints_the_correction_line_as_the_edit_commits(self):
        message = self.sql("SELECT id,seq FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0]
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))
        self.assertNotIn("error", self.store.view("agent-b", "source", {"source_ref": {"kind": "message", "id": message[0]}}))
        agent = self.agent()
        watch = test_agent_verbs.FakeWatch()

        def wait(timeout):
            if timeout == 0:
                return dict(dirty=False, stop=False)
            self.edit(message[0], "Opening message, fixed")
            return dict(dirty=True, stop=False)
        watch.wait = wait
        agent.watch_changes(watch, once=True)
        correction = self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND revision=2")[0][0]
        self.assertEqual(self.stdout.getvalue(), 'correction "Topic" #%s owner edited %s to revision 2: Opening message, fixed  [%s in t1]\n'
                         % (message[1], message[0], correction))
        code, out, _ = self.run_cli("inbox", actor="agent-b")
        self.assertEqual(out, self.stdout.getvalue())
        code, out, _ = self.run_cli("read", "t1", actor="agent-b")
        self.assertIn("#%s %s owner (edited, revision 2)\n  Opening message, fixed\n" % (message[1], message[0]), out)


class HeldCliCase(test_agent_verbs.WatchReadingCase):
    """Slice 2's CLI (docs/agent-cli.md): a held message prints as held, watch waits for its release, ack prints the
    refusal."""

    def ask(self, body="Deploy at 5", topic="t1"):
        message = self.committed(self.command("message.post", {"body": body, "addressees": ["agent-b"], "intent": "ask"},
                                              target={"topic_id": topic}))["message_id"]
        return message, self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id='agent-b'", (message,))[0][0]

    def session(self, verb, message):
        return self.committed(self.command("message.edit_" + verb, {"holder": "h-laptop"}, target={"message_id": message}))

    def quiet(self):
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))

    def test_watch_once_waits_through_the_hold_and_prints_the_released_delivery(self):
        self.quiet()
        agent = self.agent()
        watch = test_agent_verbs.FakeWatch()
        steps = []

        def wait(timeout):
            if timeout == 0:
                return dict(dirty=False, stop=False)
            if not steps:
                steps.append(self.ask())
                self.session("open", steps[0][0])
            else:
                self.session("close", steps[0][0])
            return dict(dirty=True, stop=False)
        watch.wait = wait
        agent.watch_changes(watch, once=True)
        message, delivery = steps[0]
        self.assertNotIn("held", self.stdout.getvalue())
        self.assertEqual(self.stdout.getvalue().count(delivery), 1, "printed once, as it was released")
        self.assertIn("Deploy at 5  [%s in t1]" % delivery, self.stdout.getvalue())

    def test_watch_reports_a_held_delivery_and_then_its_release(self):
        self.quiet()
        agent = self.agent()
        steps = []

        def wait(timeout):
            if timeout == 0:
                return dict(dirty=False, stop=False)
            if not steps:
                steps.append(self.ask())
                self.session("open", steps[0][0])
                return dict(dirty=True, stop=False)
            if len(steps) == 1:
                steps.append(self.session("close", steps[0][0]))
                return dict(dirty=True, stop=False)
            return dict(dirty=False, stop=True)
        watch = test_agent_verbs.FakeWatch()
        watch.wait = wait
        agent.watch_changes(watch)
        message, delivery = steps[0]
        out = self.stdout.getvalue()
        self.assertIn("delivery held while its author edits it  [%s]\n" % delivery, out)
        self.assertIn("Deploy at 5  [%s in t1]\n" % delivery, out)
        self.assertLess(out.index("delivery held"), out.index("Deploy at 5  ["))

    def test_read_prints_a_held_message_without_its_words(self):
        message, _ = self.ask("Deploy at 5, the long way " + "x" * 2000)
        self.session("open", message)
        code, out, _ = self.run_cli("read", "t1", actor="agent-b")
        self.assertEqual(code, 0)
        self.assertIn("%s owner asks agent-b\n  (held: its author is editing it)\n" % message, out)
        self.assertNotIn("the long way", out)
        self.session("close", message)
        code, out, _ = self.run_cli("read", "t1", actor="agent-b")
        self.assertIn("Deploy at 5, the long way", out)
        self.assertNotIn("held: its author", out)

    def test_ack_prints_the_refusal(self):
        message, delivery = self.ask()
        self.session("open", message)
        code, out, err = self.run_cli("ack", delivery, actor="agent-b")
        self.assertNotEqual(code, 0)
        self.assertIn("MESSAGE_HELD", out + err)
        self.assertIn("is being edited by its author and is held until they save or leave the edit (at most 2 minutes). Nothing was done.", out + err)
        self.session("close", message)
        code, out, _ = self.run_cli("ack", delivery, actor="agent-b")
        self.assertEqual((code, out), (0, "acknowledged %s\n" % delivery))

    def test_a_held_wait_prints_held(self):
        conversation = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        message, _ = self.ask("Deploy at 5 in the conversation", topic=conversation)
        self.session("open", message)
        code, out, _ = self.run_cli("conversation", "w1", actor="agent-b")
        self.assertEqual(code, 0, out)
        self.assertIn("[waiting] on agent-b", out)
        self.assertIn("(ask %s): (held)\n" % message, out)
        self.session("close", message)
        code, out, _ = self.run_cli("conversation", "w1", actor="agent-b")
        self.assertIn("(ask %s): Deploy at 5 in the conversation\n" % message, out)


# Each case runs its own tests only, not those of the fixtures it borrows.
for _name in list(vars(test_agent_verbs.WatchReadingCase)) + list(vars(test_agent_verbs.AgentVerbCase)):
    if _name.startswith("test_") and _name not in vars(CliCase):
        setattr(CliCase, _name, None)
for _name in dir(HeldCliCase):
    if _name.startswith("test_") and _name not in vars(HeldCliCase):
        setattr(HeldCliCase, _name, None)


if __name__ == "__main__":
    unittest.main()


import test_blocking_asks  # noqa: E402


class HeldAskCase(test_blocking_asks.BlockingCase):
    """A person's ask that holds a piece shows its latest first line in the pipeline's row and in Waiting on you."""

    def test_an_edited_held_ask_shows_its_latest_first_line(self):
        piece = self.committed(self.start())["piece_id"]
        ask = self.asked("Shall I ship it?\nDetails below.", blocks={"kind": "piece", "ref": piece}, to=("agent-a",), actor="owner")
        self.committed(self.command("message.edit", {"body": "Shall I ship it today?\nDetails below."}, {"message_id": ask},
                                    expected={"message_revision": 1}))
        self.assertEqual(self.held(piece, "agent-a"), [(ask, ["agent-a"], "Shall I ship it today?")])
        [item] = [item for item in self.store.view("agent-a", "attention", {})["blocking"] if item["message_id"] == ask]
        self.assertEqual(item["line"], "Shall I ship it today?")


class JoinCase(EditCase):
    """The join pass's cases (contract revision 5): topic_messages {message_ids} goes alone and never says a message
    exists that the reader cannot see; BODY_TOO_LARGE is recorded; every bad quote revision is INVALID_QUOTE; the wake's
    claim settles a correction whose message its agent can no longer read before it hands any work; and each way an
    agent reads M gets it a correction."""

    def other_topic(self):
        """t2, in an outcome other-reader owns alone: nobody in w1 reads it. Returns its first message."""
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Elsewhere", "purpose": "Out of reach", "team": []},
                                    actor="other-reader"))
        source = {"kind": "new_topic", "id": "opening-two", "workspace_id": "w2"}
        self.committed(self.command("draft.save", dict(source_ref=source, topic_id="t2", body="Not yours to see", generation="gA", attachments=[],
                                                       quotes=[], addressees=[], opening={"workspace_id": "w2", "title": "Elsewhere", "participants": []}),
                                    target={"draft_id": "opening-two"}, expected={"draft_revision": 0}, actor="other-reader"))
        self.committed(self.command("submission.prepare", {"draft_id": "opening-two", "submission_id": "opening-two", "send_operation_id": "open-two"},
                                    target={"topic_id": "t2"}, expected={"draft_revision": 1}, actor="other-reader"))
        return self.committed(self.command("topic.create_and_send", {"submission_id": "opening-two"}, target={"topic_id": "t2"},
                                           op="open-two", actor="other-reader"))["message_id"]

    def test_message_ids_goes_only_with_topic_id(self):
        message = self.opening["id"]
        for extra in ({"cursor": 0}, {"direction": "before"}, {"limit": 1}, {"items": "open"}, {"audience": "reader"}):
            with self.subTest(extra=extra):
                answer = self.store.view("owner", "topic_messages", dict({"topic_id": "t1", "message_ids": [message]}, **extra))
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)
        self.assertEqual([item["id"] for item in self.item(message) and self.store.view(
            "owner", "topic_messages", {"topic_id": "t1", "message_ids": [message]})["items"]], [message], "alone it answers")

    def test_a_named_message_in_a_topic_the_reader_cannot_read_is_refused_as_an_unknown_id(self):
        elsewhere = self.other_topic()
        unknown = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": ["m-nobody"]})
        hidden = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "message_ids": [elsewhere]})
        self.assertEqual(unknown.get("error", {}).get("code"), "FORBIDDEN")
        self.assertEqual(hidden.get("error"), unknown.get("error"), "its existence never shows")
        # One the reader can read, in another topic, is the wrong topic.
        self.member("other-reader", True)
        mixed = self.store.view("other-reader", "topic_messages", {"topic_id": "t1", "message_ids": [elsewhere]})
        self.assertEqual(mixed.get("error", {}).get("code"), "INVALID_ARGUMENT", mixed)

    def test_body_too_large_is_a_recorded_refusal_the_same_operation_returns_again(self):
        from aim_next.contract import LIMITS
        message = self.opening["id"]
        body = "x" * (LIMITS["body_utf8_bytes"] + 1)
        refused = self.edit(message, body, op="too-long")
        self.assertEqual((refused.get("error", {}).get("code"), refused["recorded"]), ("BODY_TOO_LARGE", True), {k: v for k, v in refused.items() if k != "args"})
        self.assertEqual(self.sql("SELECT kind FROM operations WHERE id='too-long'"), [("message.edit",)], "recorded")
        self.assertEqual(self.edit(message, body, op="too-long"), refused, "the same operation id returns it again")
        self.assertEqual(self.sql("SELECT count(*) FROM message_revisions"), [(0,)])
        self.assertEqual(self.corrections(), [])
        # Other words go as a new operation.
        self.assertEqual(self.committed(self.edit(message, "Shorter words", op="shorter"))["revision"], 2)

    def test_every_bad_quote_revision_is_invalid_quote_and_a_good_one_is_recorded_as_supplied(self):
        self.committed(self.edit(self.opening["id"], "Rewritten entirely"))
        for revision in ("1", 0, -1, 1.0, 2.5, None, [1], {"n": 1}, False, 99):
            with self.subTest(revision=revision):
                self.rejected(self.send_quote("Opening", revision=revision), "INVALID_QUOTE")
        sent = self.send_quote("Rewritten", revision=2)
        self.committed(sent)
        self.assertEqual(self.stored(sent)[0]["source"], {"kind": "message", "id": self.opening["id"], "revision": 2})

    quoting, send_quote, stored = QuoteCase.quoting, QuoteCase.send_quote, QuoteCase.stored

    def claims(self, agent):
        """One claim of the agent's due wake, by this case's one runner."""
        if not hasattr(self, "runner"):
            guard = self.store.runner_guard("edit-runner")
            guard.__enter__()
            self.addCleanup(guard.close)
            self.runner = (guard, self.store.acquire_runner(guard)["runner_token"])
        return self.store.claim_wakes(*self.runner, [agent])

    def test_the_wake_claim_settles_and_skips_a_correction_its_agent_can_no_longer_read(self):
        message = self.opening["id"]
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))
        self.saw("agent-b", message)
        self.committed(self.edit(message, "Words agent-b may no longer read"))
        self.assertEqual(self.schedule("agent-b"), (1, 1))
        # A route removed by a write that settles nothing (a stand-in for any future one: today member_set,
        # participation.set and the conversation sync each settle by themselves).
        self.sql("DELETE FROM workspace_members WHERE actor_id='agent-b'")
        claimed = self.claims("agent-b")
        self.assertEqual(claimed["claims"], [], "no work is handed for a correction it cannot read")
        self.assertEqual(self.pending("agent-b", message), [], "the claim settled it")
        self.assertEqual(self.schedule("agent-b"), (0, 0), "no stale count, and nothing due again")
        self.assertEqual(self.claims("agent-b")["claims"], [], "no repeated wake")

    def test_the_wake_claim_hands_a_correction_its_agent_still_reads(self):
        message = self.opening["id"]
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))
        self.saw("agent-b", message)
        self.committed(self.edit(message, "Words agent-b still reads"))
        [claim] = self.claims("agent-b")["claims"]
        self.assertEqual(claim["recipient_id"], "agent-b")
        self.assertEqual(self.pending("agent-b", message), [2], "the claim settles nothing it may read")

    def test_an_agent_that_reads_it_only_as_the_topics_creator_gets_a_correction(self):
        # agent-b starts t3, then leaves the team and the topic: it reads t3 only as its creator.
        source = {"kind": "new_topic", "id": "opening-three", "workspace_id": "w1"}
        self.committed(self.command("draft.save", dict(source_ref=source, topic_id="t3", body="agent-b's topic", generation="gA", attachments=[],
                                                       quotes=[], addressees=[], opening={"workspace_id": "w1", "title": "Started by agent-b", "participants": []}),
                                    target={"draft_id": "opening-three"}, expected={"draft_revision": 0}, actor="agent-b"))
        self.committed(self.command("submission.prepare", {"draft_id": "opening-three", "submission_id": "opening-three", "send_operation_id": "open-three"},
                                    target={"topic_id": "t3"}, expected={"draft_revision": 1}, actor="agent-b"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "opening-three"}, target={"topic_id": "t3"}, op="open-three", actor="agent-b"))
        message = self.post("A person's words in agent-b's topic", topic="t3")
        self.member("agent-b", False)
        if self.sql("SELECT 1 FROM topic_participants WHERE topic_id='t3' AND actor_id='agent-b' AND active=1"):
            self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": False}, target={"topic_id": "t3"}))
        self.assertEqual(self.sql("SELECT count(*) FROM workspace_members WHERE actor_id='agent-b'"), [(0,)])
        self.assertEqual(self.sql("SELECT creator_id FROM topics WHERE id='t3'"), [("agent-b",)])
        self.saw("agent-b", message)
        self.committed(self.edit(message, "A person's words, fixed"))
        self.assertEqual(self.pending("agent-b", message), [2], "the creator reads it, so it is told")
        self.assertEqual(self.schedule("agent-b")[1], 1, "and is woken")
        self.assertEqual(self.pending("outsider", message), [], "an agent outside its readers is not")

    def test_an_agent_that_reads_it_only_as_the_outcomes_owner_gets_a_correction(self):
        # outsider owns w4 alone; the person on its team writes in its topic.
        self.committed(self.command("workspace.create", {"id": "w4", "title": "Owned by an agent", "purpose": "Reach by ownership",
                                                         "team": ["owner"], "coordinator": "owner"}, actor="outsider"))
        source = {"kind": "new_topic", "id": "opening-four", "workspace_id": "w4"}
        self.committed(self.command("draft.save", dict(source_ref=source, topic_id="t4", body="The person's words", generation="gA", attachments=[],
                                                       quotes=[], addressees=[], opening={"workspace_id": "w4", "title": "Owned", "participants": []}),
                                    target={"draft_id": "opening-four"}, expected={"draft_revision": 0}))
        self.committed(self.command("submission.prepare", {"draft_id": "opening-four", "submission_id": "opening-four", "send_operation_id": "open-four"},
                                    target={"topic_id": "t4"}, expected={"draft_revision": 1}))
        message = self.committed(self.command("topic.create_and_send", {"submission_id": "opening-four"}, target={"topic_id": "t4"}, op="open-four"))["message_id"]
        # Every command keeps an outcome's owner on its team (creation, member_set, owner_set), so ownership is its only
        # route only once that row is gone some other way: removed here by hand.
        self.sql("DELETE FROM workspace_members WHERE workspace_id='w4' AND actor_id='outsider'")
        self.assertEqual(self.sql("SELECT count(*) FROM topic_participants WHERE topic_id='t4' AND actor_id='outsider' AND active=1"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE message_id=? AND recipient_id='outsider'", (message,)), [(0,)])
        self.saw("outsider", message)
        self.committed(self.edit(message, "The person's words, fixed"))
        self.assertEqual(self.pending("outsider", message), [2], "the outcome's owner reads it, so it is told")
        self.assertEqual(self.schedule("outsider")[1], 1, "and is woken")
        self.assertEqual(self.pending("agent-b", message), [], "an agent of another outcome is not")

    def test_a_disabled_agent_keeps_its_correction_pending_and_is_woken_once_enabled(self):
        message = self.opening["id"]
        for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'"):
            self.committed(self.command("delivery.ack", {}, target={"delivery_id": row[0]}, actor="agent-b"))
        self.saw("agent-b", message)
        self.sql("UPDATE actors SET enabled=0 WHERE id='agent-b'")
        self.committed(self.edit(message, "Fixed while agent-b was off"))
        self.assertEqual(self.pending("agent-b", message), [2], "a disabled reader is a reader: its correction waits")
        self.assertEqual(self.claims("agent-b")["claims"], [], "it is not woken while disabled")
        self.sql("UPDATE actors SET enabled=1 WHERE id='agent-b'")
        [claim] = self.claims("agent-b")["claims"]
        self.assertEqual(claim["recipient_id"], "agent-b", "enabled again, it is woken")
        [item] = [item for item in self.listed("agent-b") if item.get("correction")]
        self.assertEqual((item["message_id"], item["correction"], item["message"]["body"]), (message, {"revision": 2}, "Fixed while agent-b was off"))
        self.assertTrue(cli.Agent.delivery_line(item).startswith('correction "Topic" #'), cli.Agent.delivery_line(item))

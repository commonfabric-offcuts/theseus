from __future__ import annotations

"""Who may write a Notebook (items 371 and 383): in a topic's, its active
participants, its owner (who started it) and its outcome's owner; in an
outcome's, its team, the owner among them. Core enforces the one rule and
answers it as `reader_may_write`, so a page offers its pencil and its writing
only to someone Core will let write."""

import sqlite3

from reader_fixture import ReaderCase


class WriteRuleCase(ReaderCase):
    # w1 is owner's outcome, its team agent-a and agent-b and the person
    # "teammate". teammate starts t2 in it with agent-b taking part, then
    # steps out of it: teammate owns t2 without taking part, owner owns its
    # outcome without taking part or having started it, agent-b takes part,
    # and agent-a is on the team only. other-reader and outsider are on
    # nothing.

    def setUp(self):
        super().setUp()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('teammate','human','A person on the team')")
        self.committed(self.command("workspace.member_set", {"actor_id": "teammate", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": self.version()}))
        source = {"kind": "new_topic", "id": "t2-opening", "workspace_id": "w1"}
        self.committed(self.command("draft.save", {"source_ref": source, "topic_id": "t2", "generation": "g2", "body": "Started by the teammate",
                                                   "attachments": [], "quotes": [], "addressees": [],
                                                   "opening": {"workspace_id": "w1", "title": "The teammate's topic", "participants": ["agent-b"]}},
                                    target={"draft_id": "t2-draft"}, expected={"draft_revision": 0}, actor="teammate"))
        self.committed(self.command("submission.prepare", {"draft_id": "t2-draft", "submission_id": "t2-submission", "send_operation_id": "t2-send"},
                                    target={"topic_id": "t2"}, expected={"draft_revision": 1}, actor="teammate"))
        self.committed(self.command("topic.create_and_send", {"submission_id": "t2-submission"}, target={"topic_id": "t2"},
                                    op="t2-send", actor="teammate"))
        self.committed(self.command("participation.set", {"actor_id": "teammate", "present": False}, target={"topic_id": "t2"}, actor="teammate"))
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id='t2' AND active=1"), [("agent-b",)])
        self.assertEqual(self.sql("SELECT creator_id FROM topics WHERE id='t2'"), [("teammate",)])

    def version(self):
        return self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]

    def may_write(self, actor, scope):
        answer = self.store.view(actor, "memory_items", {"owner_scope": scope})
        self.assertNotIn("error", answer, answer)
        return answer["reader_may_write"]

    def page(self, actor, item):
        answer = self.store.view(actor, "memory_current", {"item_id": item})
        self.assertNotIn("error", answer, answer)
        return answer

    def revisions(self, item):
        return self.sql("SELECT revision,author_id,body FROM memory_revisions WHERE item_id=? ORDER BY revision", (item,))

    def test_the_topics_owner_and_its_outcomes_owner_write_its_pages_without_taking_part(self):
        topic = {"kind": "topic", "id": "t2"}
        # The topic's owner, who stepped out of it, starts a page and revises it.
        self.committed(self.memory(item="owners-page", actor="teammate", scope=topic, body="The topic's owner"))
        self.committed(self.memory(item="owners-page", actor="teammate", revision=1, body="Revised by the topic's owner"))
        # The outcome's owner, who neither started the topic nor takes part in it, does both.
        self.committed(self.memory(item="outcome-owners-page", actor="owner", scope=topic, body="The outcome's owner"))
        self.committed(self.memory(item="owners-page", actor="owner", revision=2, body="Revised by the outcome's owner"))
        # And a participant, as before.
        self.committed(self.memory(item="owners-page", actor="agent-b", revision=3, body="Revised by a participant"))
        self.assertEqual(self.revisions("owners-page"), [(1, "teammate", "The topic's owner"), (2, "teammate", "Revised by the topic's owner"),
                                                         (3, "owner", "Revised by the outcome's owner"), (4, "agent-b", "Revised by a participant")])
        self.assertEqual(self.revisions("outcome-owners-page"), [(1, "owner", "The outcome's owner")])
        for actor in ("teammate", "owner", "agent-b"):
            with self.subTest(actor=actor):
                self.assertIs(self.may_write(actor, topic), True)
                self.assertIs(self.page(actor, "owners-page")["reader_may_write"], True)

    def test_a_reader_with_none_of_these_is_refused_and_told_so_before_writing(self):
        topic = {"kind": "topic", "id": "t2"}
        self.committed(self.memory(item="page", actor="agent-b", scope=topic, body="A participant's page"))
        pages = "SELECT id,current_revision FROM memory_items ORDER BY id"
        before = self.sql(pages)
        # agent-a reads t2 as one of the outcome's team, and takes no part in it.
        self.assertIs(self.may_write("agent-a", topic), False)
        self.assertIs(self.page("agent-a", "page")["reader_may_write"], False)
        self.rejected(self.memory(item="page", actor="agent-a", revision=1, body="Not theirs"), "FORBIDDEN")
        self.rejected(self.memory(item="new-page", actor="agent-a", scope=topic, body="Not theirs"), "FORBIDDEN")
        # A participant who steps out loses it; someone off the team reads nothing at all.
        self.committed(self.command("participation.set", {"actor_id": "agent-b", "present": False}, target={"topic_id": "t2"}, actor="teammate"))
        self.assertIs(self.may_write("agent-b", topic), False)
        self.rejected(self.memory(item="page", actor="agent-b", revision=1, body="After leaving"), "FORBIDDEN")
        for actor in ("other-reader", "outsider"):
            with self.subTest(actor=actor):
                self.rejected(self.store.view(actor, "memory_items", {"owner_scope": topic}), "FORBIDDEN")
                self.rejected(self.memory(item="page", actor=actor, revision=1, body="Not theirs"), "FORBIDDEN")
        self.assertEqual(self.sql(pages), before, "nothing refused was written")
        self.assertEqual(self.revisions("page"), [(1, "agent-b", "A participant's page")])

    def test_what_the_page_is_told_is_what_core_does_for_everyone_in_either_notebook(self):
        # The pencil's answer is the rule Core enforces: for each reader of each
        # Notebook, reader_may_write says exactly whether a new page is written.
        for scope in ({"kind": "topic", "id": "t2"}, {"kind": "topic", "id": "t1"}, {"kind": "workspace", "id": "w1"}):
            for actor in ("owner", "teammate", "agent-a", "agent-b"):
                with self.subTest(scope=scope, actor=actor):
                    told = self.may_write(actor, scope)
                    receipt = self.memory(item="probe-%s-%s" % (scope["id"], actor), actor=actor, scope=scope, body="A probe")
                    self.assertEqual(receipt.get("status") == "committed", told, receipt)
        # On t2: everyone but agent-a; on t1, which owner started with agent-a, everyone but agent-b and the teammate;
        # on the outcome, its whole team.
        made = self.sql("SELECT id FROM memory_items ORDER BY id")
        self.assertEqual([row[0] for row in made], [
            "probe-t1-agent-a", "probe-t1-owner", "probe-t2-agent-b", "probe-t2-owner", "probe-t2-teammate",
            "probe-w1-agent-a", "probe-w1-agent-b", "probe-w1-owner", "probe-w1-teammate"])

    def test_nobody_writes_in_a_reached_outcome_and_the_page_is_told_so(self):
        topic = {"kind": "topic", "id": "t2"}
        self.assertIs(self.may_write("owner", topic), True)
        self.committed(self.command("outcome.kind_set", {"kind": "reach"}, {"workspace_id": "w1"}, {"workspace_revision": self.version()}))
        self.committed(self.command("outcome.reach", {"words": "Done", "unmet_confirmed": True}, {"workspace_id": "w1"},
                                    {"workspace_revision": self.version()}))
        for scope in (topic, {"kind": "workspace", "id": "w1"}):
            with self.subTest(scope=scope):
                self.assertIs(self.may_write("owner", scope), False)
                self.rejected(self.memory(item="late-" + scope["id"], actor="owner", scope=scope, body="Too late"), "OUTCOME_REACHED")

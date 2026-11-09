from __future__ import annotations

"""Everyone on an outcome's team edits its Notebook pages, people as well as
agents, and every revision is kept; a topic's own pages are its active
participants' to edit, whoever they are."""

import sqlite3

from reader_fixture import ReaderCase

OUTCOME = {"kind": "workspace", "id": "w1"}


class TeamEditCase(ReaderCase):
    def setUp(self):
        super().setUp()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('teammate','human','A person on the team')")
        revision = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "teammate", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": revision}))

    def revisions(self, item):
        return self.sql("SELECT revision,author_id,body FROM memory_revisions WHERE item_id=? ORDER BY revision", (item,))

    def test_people_on_the_outcomes_team_revise_its_pages_and_every_revision_is_kept(self):
        self.committed(self.memory(item="plan", scope=OUTCOME, body="The agent's plan"))
        # The outcome's owner, a person, revises the agent's page, and a person
        # on its team revises it again.
        self.committed(self.memory(item="plan", actor="owner", revision=1, body="The owner's plan"))
        self.committed(self.memory(item="plan", actor="teammate", revision=2, body="The teammate's plan"))
        self.assertEqual(self.revisions("plan"), [(1, "agent-a", "The agent's plan"), (2, "owner", "The owner's plan"),
                                                  (3, "teammate", "The teammate's plan")])
        self.assertEqual([(page["author"], page["body"]) for page in (self.source(self.memory_ref("plan", n)) for n in (1, 2, 3))],
                         [("agent-a", "The agent's plan"), ("owner", "The owner's plan"), ("teammate", "The teammate's plan")])
        # A person makes a page of their own, which an agent on the team revises.
        self.committed(self.memory(item="notes", actor="teammate", scope=OUTCOME, body="A person's page"))
        self.committed(self.memory(item="notes", actor="agent-b", revision=1, body="An agent's revision"))
        self.assertEqual(self.revisions("notes"), [(1, "teammate", "A person's page"), (2, "agent-b", "An agent's revision")])

    def test_a_person_in_a_topic_edits_its_pages_and_leaving_it_ends_that(self):
        # The topic's creator, a person, takes part in it.
        self.committed(self.memory(item="topic-page", actor="owner", body="The owner's topic page"))
        self.committed(self.memory(item="topic-page", revision=1, body="The agent's revision"))
        self.committed(self.command("participation.set", {"actor_id": "owner", "present": False}, target={"topic_id": "t1"}))
        self.rejected(self.memory(item="topic-page", actor="owner", revision=2, body="After leaving"), "FORBIDDEN")
        self.assertEqual(self.revisions("topic-page"), [(1, "owner", "The owner's topic page"), (2, "agent-a", "The agent's revision")])

    def test_someone_off_the_team_still_cannot_and_nothing_is_written(self):
        self.committed(self.memory(item="plan", scope=OUTCOME, body="The agent's plan"))
        pages = "SELECT id,current_revision FROM memory_items ORDER BY id"
        before = (self.sql(pages), self.public_state())
        # A person who reads nothing of the outcome, and an agent off its team.
        for actor in ("other-reader", "outsider"):
            with self.subTest(actor=actor):
                self.rejected(self.memory(item="plan", actor=actor, revision=1, body="Not theirs"), "FORBIDDEN")
                self.rejected(self.memory(item="new-" + actor, actor=actor, scope=OUTCOME, body="Not theirs"), "FORBIDDEN")
        # A person on the outcome's team who does not take part in the topic.
        self.rejected(self.memory(item="topic-page", actor="teammate", body="Not in the topic"), "FORBIDDEN")
        self.assertEqual((self.sql(pages), self.public_state()), before)
        self.assertEqual(self.revisions("plan"), [(1, "agent-a", "The agent's plan")])

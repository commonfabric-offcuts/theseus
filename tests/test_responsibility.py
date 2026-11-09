from __future__ import annotations

"""What each participant is responsible for: their own note, shown on the topic, fenced on its own revision."""

import re
import unittest

import reader_fixture as fixtures


class ResponsibilityCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating;
    # agent-b reads it as a member but does not take part.

    def note(self, note, expected, actor="agent-a", topic="t1", op=None):
        return self.command("responsibility.set", {"note": note}, target={"topic_id": topic},
                            expected={"responsibility_revision": expected}, actor=actor, op=op)

    def notes(self, actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return {item["actor_id"]: (item["responsibility"], item["responsibility_revision"]) for item in answer["participants"]}

    def test_a_participant_says_what_they_do_and_every_reader_sees_it_on_the_topic(self):
        before = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        result = self.committed(self.note("Drafts the release notes", 0))
        self.assertEqual(result, {"topic_id": "t1", "actor_id": "agent-a", "note": "Drafts the release notes",
                                  "responsibility_revision": 1, "changed": True, "version": before + 1})
        for reader in ("owner", "agent-a", "agent-b"):
            with self.subTest(reader=reader):
                self.assertEqual(self.notes(reader), {"owner": ("", 0), "agent-a": ("Drafts the release notes", 1)})
        # The topic's own change scope carries it, so an open page follows it.
        self.assertEqual(self.sql("SELECT scope_kind,resource_kind,resource_id,version FROM changes WHERE scope_kind='topic' ORDER BY seq DESC LIMIT 1"),
                         [("topic", "topic", "t1", before + 1)])
        # The same note again changes nothing and moves nothing.
        self.assertEqual(self.committed(self.note("Drafts the release notes", 1)),
                         {"topic_id": "t1", "actor_id": "agent-a", "note": "Drafts the release notes",
                          "responsibility_revision": 1, "changed": False, "version": before + 1})
        self.committed(self.note("", 1))
        self.assertEqual(self.notes()["agent-a"], ("", 2))

    def test_only_someone_taking_part_sets_a_note_and_only_their_own(self):
        before = self.records()
        # agent-b reads the topic as a member but does not take part; outsider cannot read it.
        for actor in ("agent-b", "outsider"):
            with self.subTest(actor=actor):
                self.rejected(self.note("Mine now", 0, actor=actor), "FORBIDDEN")
        # The note names no one else: it is always the sender's own.
        self.rejected(self.command("responsibility.set", {"note": "x", "actor_id": "owner"}, target={"topic_id": "t1"},
                                   expected={"responsibility_revision": 0}, actor="agent-a"), "INVALID_ARGUMENT")
        self.assertEqual(self.notes(), {"owner": ("", 0), "agent-a": ("", 0)})
        # Refusals record their operation and nothing else; what is red is kept with the commit
        # number (docs/health.md), so only that number moves with it.
        after = self.records()
        kept = lambda lines: [re.sub(r'"seq":\d+', '"seq":N', line) if "'health_light'" in line else line
                              for line in lines if "INSERT INTO \"operations\"" not in line and "commit_" not in line]
        self.assertEqual(kept(after), kept(before))
        self.participation("agent-b", True)
        self.committed(self.note("Reviews the copy", 0, actor="agent-b"))
        self.participation("agent-b", False)
        self.rejected(self.note("Still here?", 1, actor="agent-b"), "FORBIDDEN")
        # Someone who rejoins finds their note as they left it.
        self.participation("agent-b", True)
        self.assertEqual(self.notes()["agent-b"], ("Reviews the copy", 1))

    def test_a_late_request_never_undoes_a_newer_note_and_a_message_does_not_refuse_one(self):
        self.committed(self.note("First", 0))
        self.committed(self.note("Second", 1))
        error = self.note("Late", 1)
        self.rejected(error, "REVISION_CONFLICT")
        self.assertEqual(error["error"]["current_versions"], {"responsibility_revision": 2})
        self.assertEqual(self.notes()["agent-a"], ("Second", 2))
        # A message moves the topic on, not the note: the note still saves at its own revision.
        self.send("Meanwhile, in the topic")
        self.committed(self.note("Third", 2))
        self.assertEqual(self.notes()["agent-a"], ("Third", 3))

    def test_a_note_set_for_someone_takes_a_new_revision(self):
        self.committed(self.note("Mine", 0))
        result = self.committed(self.command("participation.set", {"actor_id": "agent-a", "present": True,
                                                                    "responsibility": "Owner says: ship it"},
                                             target={"topic_id": "t1"}))
        self.assertEqual((result["responsibility"], result["responsibility_revision"]), ("Owner says: ship it", 2))
        self.rejected(self.note("Mine again", 1), "REVISION_CONFLICT")
        self.assertEqual(self.notes()["agent-a"], ("Owner says: ship it", 2))
        # Leaving and joining without a note keeps it and its revision.
        self.participation("agent-a", False)
        self.participation("agent-a", True)
        self.assertEqual(self.notes()["agent-a"], ("Owner says: ship it", 2))

    def test_a_note_is_bounded_and_refused_whole_rather_than_cut(self):
        self.rejected(self.note("x" * 1025, 0), "BODY_TOO_LARGE")
        self.rejected(self.note(None, 0), "INVALID_ARGUMENT")
        self.committed(self.note("é" * 512, 0))
        self.assertEqual(self.notes()["agent-a"], ("é" * 512, 1))
        self.rejected(self.command("participation.set", {"actor_id": "agent-a", "present": True, "responsibility": "x" * 1025},
                                   target={"topic_id": "t1"}), "BODY_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()

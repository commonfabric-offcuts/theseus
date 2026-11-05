from __future__ import annotations

"""Where a topic stands: state, note, who it waits on, rename and archive."""

import sqlite3
import unittest
from unittest import mock

from aim_next import store as store_module, topic_state
import reader_fixture as fixtures


class TopicStateCase(fixtures.ReaderCase):
    # The fixture outcome w1 is owned by owner, with agent-a and agent-b as
    # members. Its topic t1 was created by owner, with agent-a participating;
    # agent-b can read it as a member but does not work in it.

    def update(self, args, actor="owner", topic="t1", expected=None):
        if expected is None:
            expected = self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]
        return self.command("topic.update", args, target={"topic_id": topic},
                            expected={"topic_revision": expected}, actor=actor)

    def topic(self, actor="owner"):
        answer = self.store.view(actor, "topic", {"topic_id": "t1"})
        self.assertNotIn("error", answer, answer)
        return answer["topic"]

    def listed(self, archived=None, actor="owner"):
        args = {"workspace_id": "w1"} if archived is None else {"workspace_id": "w1", "archived": archived}
        answer = self.store.view(actor, "workspace_topics", args)
        self.assertNotIn("error", answer, answer)
        return {item["id"]: item for item in answer["items"]}

    def waiting_on(self, actor):
        answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return answer["waiting_on_me"], [item["id"] for item in answer["latest_waiting"]]

    def test_a_participant_says_the_topic_waits_on_someone_and_they_see_it(self):
        result = self.committed(self.update({"state": "waiting", "note": "Which name do we ship?", "waiting_on": ["owner"]}, actor="agent-a"))
        self.assertEqual((result["state"], result["note"], result["waiting_on"], result["state_by"]),
                         ("waiting", "Which name do we ship?", ["owner"], "agent-a"))
        self.assertIsInstance(result["state_ms"], int)
        topic = self.topic()
        self.assertEqual((topic["state"], topic["state_note"], topic["waiting_on"], topic["state_by"], topic["state_ms"]),
                         ("waiting", "Which name do we ship?", ["owner"], "agent-a", result["state_ms"]))
        item = self.listed()["t1"]
        self.assertEqual((item["state"], item["state_note"], item["waiting_on"], item["archived"]),
                         ("waiting", "Which name do we ship?", ["owner"], False))
        self.assertEqual(self.waiting_on("owner"), (1, ["t1"]))
        self.assertEqual(self.waiting_on("agent-a"), (0, []))
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        # The person it waits on learns of it in their own change scope.
        self.assertEqual(self.sql("SELECT resource_kind,resource_id FROM changes WHERE scope_kind='actor' AND scope_id='owner' AND resource_kind='waiting'"),
                         [("waiting", "t1")])

    def test_a_new_state_starts_with_its_own_note_and_stops_waiting(self):
        self.committed(self.update({"state": "waiting", "note": "Need a decision", "waiting_on": ["owner", "agent-b"]}, actor="agent-a"))
        # Changing only who it waits on keeps the note.
        self.committed(self.update({"waiting_on": ["owner"]}, actor="agent-a"))
        self.assertEqual((self.topic()["state_note"], self.listed()["t1"]["waiting_on"]), ("Need a decision", ["owner"]))
        self.assertEqual(self.waiting_on("agent-b"), (0, []))
        # Moving on clears the note and who it waited on, unless a new note is given.
        self.committed(self.update({"state": "review"}, actor="agent-a"))
        self.assertEqual((self.topic()["state"], self.topic()["state_note"], self.listed()["t1"]["waiting_on"]), ("review", "", []))
        self.assertEqual(self.waiting_on("owner"), (0, []))
        self.committed(self.update({"state": "done", "note": "Shipped"}, actor="owner"))
        self.assertEqual((self.topic()["state"], self.topic()["state_note"], self.topic()["state_by"]), ("done", "Shipped", "owner"))
        # Everyone it stopped waiting on was told.
        self.assertEqual(self.sql("SELECT scope_id FROM changes WHERE scope_kind='actor' AND resource_kind='waiting' ORDER BY seq"),
                         [("agent-b",), ("owner",), ("agent-b",), ("owner",), ("owner",)])

    def test_only_those_who_work_in_the_topic_say_where_it_stands(self):
        # agent-b reads the topic as an outcome member but does not work in it.
        self.rejected(self.update({"state": "done"}, actor="agent-b"), "FORBIDDEN")
        self.rejected(self.update({"state": "done"}, actor="outsider"), "FORBIDDEN")
        self.participation("agent-b", True)
        self.committed(self.update({"state": "review"}, actor="agent-b"))
        self.participation("agent-b", False)
        self.rejected(self.update({"state": "done"}, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.topic()["state"], "review")

    def test_renaming_and_archiving_stay_with_the_owner_and_creator(self):
        for args in ({"title": "Renamed"}, {"archived": True}):
            with self.subTest(args=args):
                self.rejected(self.update(args, actor="agent-a"), "FORBIDDEN")
        self.assertEqual(self.topic()["title"], "Topic")
        self.committed(self.update({"title": "Naming the release"}))
        self.assertEqual((self.topic()["title"], self.listed()["t1"]["title"]), ("Naming the release", "Naming the release"))
        self.rejected(self.update({"title": "  "}), "EMPTY_TITLE")
        # A rename does not say where the topic stands.
        self.assertIsNone(self.topic()["state_by"])

    def test_an_archived_topic_leaves_the_list_and_keeps_where_it_stands(self):
        self.committed(self.update({"state": "done", "note": "Finished"}, actor="agent-a"))
        self.committed(self.update({"archived": True}))
        self.assertNotIn("t1", self.listed())
        self.assertNotIn("t1", self.listed(archived=False))
        item = self.listed(archived=True)["t1"]
        self.assertEqual((item["archived"], item["state"], item["state_note"]), (True, "done", "Finished"))
        # Still readable by those who could read it.
        self.assertEqual((self.topic("agent-b")["archived"], self.topic("agent-b")["state"]), (True, "done"))
        self.committed(self.update({"archived": False}))
        self.assertIn("t1", self.listed())
        self.assertNotIn("t1", self.listed(archived=True))

    def test_waiting_names_only_people_and_agents_who_can_read_the_topic(self):
        self.rejected(self.update({"state": "waiting", "waiting_on": ["outsider"]}, actor="agent-a"), "INVALID_RECIPIENT")
        self.rejected(self.update({"state": "waiting", "waiting_on": ["nobody-here"]}, actor="agent-a"), "INVALID_RECIPIENT")
        # agent-b can read it as a member, and other-reader once they participate.
        self.committed(self.update({"state": "waiting", "waiting_on": ["agent-b"]}, actor="agent-a"))
        self.participation("other-reader", True)
        self.committed(self.update({"waiting_on": ["agent-b", "other-reader"]}, actor="agent-a"))
        self.assertEqual(self.waiting_on("other-reader"), (1, ["t1"]))
        # A reader who loses access no longer sees it waiting on them.
        self.participation("other-reader", False)
        self.assertEqual(self.waiting_on("other-reader"), (0, []))
        self.assertEqual(self.waiting_on("agent-b"), (1, ["t1"]))

    def test_invalid_updates_change_nothing(self):
        before = self.topic()
        for args, code in (({}, "INVALID_ARGUMENT"),
                           ({"state": "paused"}, "INVALID_ARGUMENT"),
                           ({"state": "archived"}, "INVALID_ARGUMENT"),
                           ({"state": "review", "waiting_on": ["owner"]}, "INVALID_ARGUMENT"),
                           ({"waiting_on": ["owner"]}, "INVALID_ARGUMENT"),
                           ({"archived": "yes"}, "INVALID_ARGUMENT"),
                           ({"priority": 1}, "INVALID_ARGUMENT"),
                           ({"note": "x" * 1025}, "BODY_TOO_LARGE"),
                           ({"state": "waiting", "waiting_on": "owner"}, "INVALID_ARGUMENT")):
            with self.subTest(args=args):
                self.rejected(self.update(args), code)
        self.rejected(self.update({"state": "done"}, expected=before["version"] - 1), "REVISION_CONFLICT")
        self.assertEqual(self.topic(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])

    def test_a_note_at_the_limit_and_a_bare_reassertion_are_kept(self):
        self.committed(self.update({"state": "active", "note": "é" * 512}))
        first = self.topic()
        self.assertEqual(len(first["state_note"].encode("utf-8")), 1024)
        self.committed(self.update({"state": "active"}, actor="agent-a"))
        again = self.topic()
        self.assertEqual((again["state_note"], again["state_by"]), (first["state_note"], "agent-a"))
        self.assertGreaterEqual(again["state_ms"], first["state_ms"])

    def changes_since(self, seq):
        return self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id,version FROM changes WHERE seq>? ORDER BY seq", (seq,))

    def head(self):
        return self.sql("SELECT coalesce(max(seq),0) FROM changes")[0][0]

    def test_someone_who_leaves_the_topic_is_no_longer_waited_on(self):
        self.participation("other-reader", True)
        self.committed(self.update({"state": "waiting", "note": "Need both", "waiting_on": ["agent-b", "other-reader"]}, actor="agent-a"))
        before, mark = self.topic()["version"], self.head()
        self.participation("other-reader", False)
        # The topic stops waiting on them, and says so to its readers and to them.
        topic = self.topic()
        self.assertEqual((topic["waiting_on"], self.listed()["t1"]["waiting_on"]), (["agent-b"], ["agent-b"]))
        self.assertEqual(topic["version"], before + 1)
        self.assertIn(("actor", "other-reader", "waiting", "t1", topic["version"]), self.changes_since(mark))
        self.assertIn(("topic", "t1", "topic", "t1", topic["version"]), self.changes_since(mark))
        # An update that names nobody is not refused for a name its caller never gave.
        self.committed(self.update({"note": "Still need it"}, actor="agent-a"))
        self.committed(self.update({"state": "waiting"}, actor="agent-a"))
        self.assertEqual((self.topic()["state_note"], self.topic()["waiting_on"]), ("Still need it", ["agent-b"]))
        # Coming back does not bring the waiting back with it.
        self.participation("other-reader", True)
        self.assertEqual((self.topic()["waiting_on"], self.waiting_on("other-reader")), (["agent-b"], (0, [])))
        # Leaving a topic you can still read as a member of its outcome keeps you on the list.
        self.participation("agent-b", True)
        self.participation("agent-b", False)
        self.assertEqual(self.topic()["waiting_on"], ["agent-b"])

    def member_set(self, member, present):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        return self.committed(self.command("workspace.member_set", {"actor_id": member, "present": present},
                                           target={"workspace_id": "w1"}, expected={"workspace_revision": version}))

    def test_someone_removed_from_the_outcome_is_no_longer_waited_on(self):
        # agent-b reads t1 only as a member; agent-a also works in it.
        self.committed(self.update({"state": "waiting", "waiting_on": ["agent-a", "agent-b"]}, actor="agent-a"))
        before, mark = self.topic()["version"], self.head()
        result = self.member_set("agent-b", False)
        topic = self.topic()
        self.assertEqual((topic["waiting_on"], self.listed()["t1"]["waiting_on"]), (["agent-a"], ["agent-a"]))
        self.assertEqual(topic["version"], before + 1)
        changes = self.changes_since(mark)
        self.assertIn(("actor", "agent-b", "waiting", "t1", topic["version"]), changes)
        self.assertIn(("topic", "t1", "topic", "t1", topic["version"]), changes)
        self.assertIn(("workspace", "w1", "topic", "t1", topic["version"]), changes)
        # The removal's own version is the outcome's current one.
        self.assertEqual(result["version"], self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"])
        self.committed(self.update({"note": "Still need it"}, actor="agent-a"))
        self.member_set("agent-b", True)
        self.assertEqual(self.topic()["waiting_on"], ["agent-a"])
        # Someone who still works in the topic stays on the list when they leave the outcome.
        self.member_set("agent-a", False)
        self.assertEqual(self.topic()["waiting_on"], ["agent-a"])

    def attention_statements(self, actor):
        """The reads of topic_waiting that one attention view runs, with their values."""
        original, statements = store_module._connect, []

        class Connection:
            def __init__(self, db): self.db = db
            def __getattr__(self, name): return getattr(self.db, name)
            def execute(self, sql, values=()):
                if "topic_waiting" in sql:
                    statements.append((sql, values))
                return self.db.execute(sql, values)

        def connect(path):
            db, facts = original(path)
            return Connection(db), facts
        with mock.patch.object(store_module, "_connect", connect):
            answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return answer, statements

    def test_attention_reads_what_waits_on_the_reader_in_index_order(self):
        self.committed(self.update({"state": "waiting", "waiting_on": ["owner"]}, actor="agent-a"))
        answer, statements = self.attention_statements("owner")
        self.assertEqual((answer["waiting_on_me"], [item["id"] for item in answer["latest_waiting"]]), (1, ["t1"]))
        self.assertTrue(statements)
        with sqlite3.connect(str(self.path)) as db:
            for sql, values in statements:
                plan = " | ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + sql, values))
                with self.subTest(sql=sql):
                    # Neither a sort of every waiting row nor a readability check per row.
                    self.assertNotIn("TEMP B-TREE", plan)
                    self.assertNotIn("CORRELATED", plan)
                    self.assertIn("USING COVERING INDEX" if sql.startswith("SELECT count(*)") else "USING INDEX", plan)

    def test_waiting_on_is_bounded_as_given_before_any_name_is_looked_up(self):
        # The limit applies to the list as sent, so an unknown 33rd name is never looked up.
        self.rejected(self.update({"state": "waiting", "waiting_on": ["owner"] * 32 + ["nobody-here"]}, actor="agent-a"), "TOO_MANY_RECIPIENTS")
        self.rejected(self.update({"state": "waiting", "waiting_on": ["owner", "agent-b"] * 20}, actor="agent-a"), "TOO_MANY_RECIPIENTS")
        # Repeats within the limit name each reader once.
        self.assertEqual(self.committed(self.update({"state": "waiting", "waiting_on": ["owner", "owner"]}, actor="agent-a"))["waiting_on"], ["owner"])

    def test_more_than_the_limit_of_distinct_readers_is_refused(self):
        readers = ["reader-%02d" % n for n in range(33)]
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,'agent',?)", [(reader, reader) for reader in readers])
            db.executemany("INSERT INTO workspace_members VALUES ('w1',?)", [(reader,) for reader in readers])
        self.rejected(self.update({"state": "waiting", "waiting_on": readers}, actor="agent-a"), "TOO_MANY_RECIPIENTS")
        self.assertEqual(self.committed(self.update({"state": "waiting", "waiting_on": readers[:32]}, actor="agent-a"))["waiting_on"], readers[:32])

    def test_the_owner_says_where_a_topic_stands_after_leaving_it(self):
        self.participation("owner", False)
        self.committed(self.update({"state": "review", "note": "Over to me"}))
        self.assertEqual((self.topic()["state"], self.topic()["state_by"]), ("review", "owner"))

    def test_the_owner_renames_and_archives_a_topic_someone_else_created(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "t2", "title": "Theirs",
                                                     "participants": [], "body": "Opening", "attachments": []},
                                    target={"opening_id": "o2"}, expected={"opening_revision": 0}, actor="agent-a"))
        self.committed(self.command("opening.publish", {}, target={"opening_id": "o2"}, expected={"opening_revision": 1}, actor="agent-a"))
        self.assertEqual(self.store.view("owner", "topic", {"topic_id": "t2"})["topic"]["creator_id"], "agent-a")
        self.committed(self.update({"title": "Renamed by the owner"}, topic="t2"))
        self.committed(self.update({"archived": True}, topic="t2"))
        # Another member who did not create it cannot.
        self.rejected(self.update({"archived": False}, topic="t2", actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.listed(archived=True)["t2"]["title"], "Renamed by the owner")

    def test_the_topic_list_takes_archived_only_as_true_or_false(self):
        for value in ("yes", 1, None):
            with self.subTest(value=value):
                answer = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "archived": value})
                self.assertEqual(answer.get("error", {}).get("code"), "INVALID_ARGUMENT", answer)

    def test_attention_lists_the_newest_waiting_topics_first_and_bounds_them(self):
        for n in range(7):
            topic = "tw%d" % n
            self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": topic, "title": "Waiting %d" % n,
                                                         "participants": ["agent-a"], "body": "Opening", "attachments": []},
                                        target={"opening_id": "o-" + topic}, expected={"opening_revision": 0}))
            self.committed(self.command("opening.publish", {}, target={"opening_id": "o-" + topic}, expected={"opening_revision": 1}))
            # Later topics are said to wait earlier, so the order is by when, not by name or creation.
            with mock.patch.object(topic_state, "_now_ms", return_value=2000 - n):
                self.committed(self.update({"state": "waiting", "waiting_on": ["owner"]}, actor="agent-a", topic=topic,
                                           expected=self.store.view("owner", "topic", {"topic_id": topic})["topic"]["version"]))
        count, latest = self.waiting_on("owner")
        self.assertEqual((count, latest), (7, ["tw0", "tw1", "tw2", "tw3", "tw4"]))
        # Saying it again makes a topic the newest.
        with mock.patch.object(topic_state, "_now_ms", return_value=3000):
            self.committed(self.update({"note": "Still waiting"}, actor="agent-a", topic="tw6",
                                       expected=self.store.view("owner", "topic", {"topic_id": "tw6"})["topic"]["version"]))
        self.assertEqual(self.waiting_on("owner"), (7, ["tw6", "tw0", "tw1", "tw2", "tw3"]))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

"""Archive or complete an outcome, and bring it back (item 404; docs/targets.md, "Archived and completed").

The owner archives an outcome he is no longer pursuing, or completes one that
is done, of either kind; Bring back undoes either. The act archives every topic
of the outcome not already archived and records which (outcome_ends), Bring
back unarchives exactly those, and while it is archived or completed the
outcome is kept to read: every write in it is refused as in a reached outcome,
with the same exemptions. The ten worked examples of the spec (404-r1) are the
first ten cases, each named for its example, with fictional names."""

import json
import sqlite3
import time
import unittest

import test_outcome_kinds


def day(ms):
    return time.strftime("%b %-d", time.localtime(ms / 1000.0))


class EndCase(test_outcome_kinds.KindCase):
    """Outcome w1, "Isolated test": owner "owner", coordinator agent-a, member agent-b, topic t1 and its Conversation."""

    def end(self, state, actor="owner", workspace="w1", expected=None):
        revision = self.version(workspace) if expected is None else expected
        return self.command("outcome.end_set", {"state": state}, {"workspace_id": workspace}, {"workspace_revision": revision}, actor=actor)

    def ends(self, workspace="w1"):
        return [(seq, state, json.loads(topics), by) for seq, state, topics, by in
                self.sql("SELECT seq,state,topics,set_by FROM outcome_ends WHERE workspace_id=? ORDER BY seq", (workspace,))]

    def conversation(self, workspace="w1"):
        return self.sql("SELECT id FROM topics WHERE workspace_id=? AND kind='conversation'", (workspace,))[0][0]

    def archived(self, *topics):
        return [self.sql("SELECT archived FROM topics WHERE id=?", (topic,))[0][0] for topic in topics]

    def topic_versions(self, workspace="w1"):
        return dict(self.sql("SELECT id,version FROM topics WHERE workspace_id=?", (workspace,)))

    def attention(self, actor="owner"):
        answer = self.store.view(actor, "attention", {})
        self.assertNotIn("error", answer, answer)
        return {key: answer[key] for key in ("unread", "addressed", "waiting_on_me")} | {
            "waiting_outcomes": answer["waiting_outcomes"], "latest": [item["message_id"] for item in answer["latest_addressed"]]}

    def listing(self, actor="owner", **args):
        answer = self.store.view(actor, "workspaces", args)
        self.assertNotIn("error", answer, answer)
        return answer

    def changes_since(self, seq):
        return self.sql("SELECT scope_kind,scope_id,resource_kind,resource_id FROM changes WHERE seq>? ORDER BY seq", (seq,))

    def head(self):
        return self.sql("SELECT coalesce(max(seq),0) FROM changes")[0][0]

    def unchanged(self):
        """What a refused act must leave as it was: the end rows, the topics, the waits, the messages and deliveries,
        the outcome's version and the change log."""
        return (self.ends(), self.sql("SELECT id,archived,state,version FROM topics ORDER BY id"),
                self.sql("SELECT topic_id,actor_id,archived FROM topic_waiting ORDER BY 1,2"),
                self.sql("SELECT count(*) FROM messages"), self.sql("SELECT count(*) FROM deliveries"),
                self.version(), self.head())

    def hand_archived_topic(self):
        """t2, archived on its own by the owner before any end."""
        self.open_topic("t2", "w1")
        self.committed(self.command("topic.update", {"archived": True}, {"topic_id": "t2"},
                                    {"topic_revision": self.sql("SELECT version FROM topics WHERE id='t2'")[0][0]}))


class WorkedExamplesCase(EndCase):
    def test_example_1_the_owner_archives_a_keep_outcome_and_it_leaves_every_list_and_count(self):
        conversation = self.conversation()
        self.hand_archived_topic()
        # What the outcome holds for its owner: an ask waiting on him in t1, and a message sent to him by name.
        ask = self.post("Is the plan ready?", addressees=["owner"], intent="ask")
        before = self.attention()
        self.assertEqual((before["waiting_on_me"], before["waiting_outcomes"]["count"]), (1, 1))
        self.assertIn(ask, before["latest"])
        t2_version = self.topic_versions()["t2"]
        revision, seq = self.version(), self.head()
        result = self.committed(self.end("archived"))
        # Each topic archived advances the outcome, as any topic change does, and the act once more (revision + 3).
        self.assertEqual(result, {"workspace_id": "w1", "state": "archived", "changed": True, "topics": 2, "workspace_revision": revision + 3})
        self.assertEqual(self.version(), revision + 3)
        self.assertEqual(self.ends(), [(1, "archived", sorted([conversation, "t1"]), "owner")], "t2, archived by hand before, is not listed")
        self.assertEqual(self.archived(conversation, "t1", "t2"), [1, 1, 1])
        self.assertEqual(self.topic_versions()["t2"], t2_version, "t2 is not touched")
        self.assertEqual(self.sql("SELECT actor_id,archived FROM topic_waiting WHERE topic_id='t1'"), [("owner", 1)], "the wait is kept, archived")
        changes = self.changes_since(seq)
        self.assertIn(("actor", "owner", "waiting", "t1"), changes, "the waiter's Waiting on you reads again")
        for scope in (("workspace", "w1"), ("outcome", "w1"), ("actor", "owner"), ("actor", "agent-a"), ("actor", "agent-b")):
            self.assertIn(scope + ("workspace", "w1"), changes, scope)
        # It leaves the list for a reached outcome's place beside it, and its counts go with its topics.
        listing = self.listing()
        self.assertEqual(([item["id"] for item in listing["items"]], listing["ended_count"], listing["reached_count"]), ([], 1, 0))
        ended = self.listing(ended=True)
        self.assertEqual([(item["id"], item["end"]["state"], item["end"]["by"]) for item in ended["items"]], [("w1", "archived", "owner")])
        after = self.attention()
        self.assertEqual((after["unread"], after["addressed"], after["waiting_on_me"], after["latest"], after["waiting_outcomes"]["count"]),
                         (0, 0, 0, [], 0))
        self.assertGreater(before["unread"], 0)
        # His own messages still read there, among the outcome's archived topics.
        archived = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "archived": True})
        self.assertEqual(sorted(item["id"] for item in archived["items"]), sorted([conversation, "t1", "t2"]))
        self.assertIn(ask, [item["id"] for item in self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 20})["items"]])

    def test_example_2_bring_back_restores_exactly_what_the_act_archived(self):
        conversation = self.conversation()
        self.hand_archived_topic()
        ask = self.post("Is the plan ready?", addressees=["owner"], intent="ask")
        before, waits = self.attention(), self.waiting_on()
        self.committed(self.end("archived"))
        revision, seq = self.version(), self.head()
        result = self.committed(self.end("open"))
        self.assertEqual(result, {"workspace_id": "w1", "state": "open", "changed": True, "topics": 2, "workspace_revision": revision + 3})
        self.assertEqual(self.ends()[1], (2, "open", [], "owner"))
        self.assertEqual(self.archived(conversation, "t1", "t2"), [0, 0, 1], "only the listed topics come back; t2 stays archived")
        self.assertEqual((self.attention(), self.waiting_on()), (before, waits), "every count and wait, with its ask, is as it was")
        self.assertEqual(self.waiting_on(), [("owner", ask)])
        self.assertIn(("actor", "owner", "waiting", "t1"), self.changes_since(seq))
        listing = self.listing()
        self.assertEqual(([item["id"] for item in listing["items"]], listing["ended_count"]), (["w1"], 0))
        self.assertIsNone(listing["items"][0]["end"])
        # The same again changes nothing and writes nothing.
        unchanged = self.unchanged()
        self.assertEqual(self.committed(self.end("open"))["changed"], False)
        self.assertEqual(self.unchanged(), unchanged)

    def test_example_3_complete_on_a_reach_outcome_records_no_reached_and_bring_back_undoes_it(self):
        conversation = self.conversation()
        self.committed(self.kind_set("reach"))
        word = self.checks_view()["word"]
        self.committed(self.end("completed"))
        self.assertEqual(self.ends(), [(1, "completed", sorted([conversation, "t1"]), "owner")])
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_reached"), [(0,)], "Complete is not Reached")
        view = self.checks_view()
        self.assertEqual((view["word"], view["reached"], view["reach"], view["kind"]["you_change"]), (word, None, None, False))
        self.assertEqual((view["end"]["state"], view["end"]["by"]), ("completed", "owner"))
        light = self.store.view("owner", "outcome_light", {"workspace_id": "w1"})
        self.assertEqual((light["light"]["light"], light["light"]["short"]["kind"], light["lead"]["kind"], light["lead"]["by"], light["facts"], light["also"]),
                         ("done", "completed", "completed", "owner", [], []))
        self.assertEqual(self.sql("SELECT state FROM topics WHERE id='t1'"), [("active",)], "no topic closes")
        self.committed(self.end("open"))
        self.assertEqual(self.archived(conversation, "t1"), [0, 0])
        self.assertIsNone(self.checks_view()["end"])
        self.assertTrue(self.checks_view()["kind"]["you_change"])

    def test_example_4_switching_between_archived_and_completed_carries_the_list(self):
        conversation = self.conversation()
        self.committed(self.end("archived"))
        versions = self.topic_versions()
        result = self.committed(self.end("completed"))
        self.assertEqual((result["changed"], result["topics"]), (True, 0))
        self.assertEqual(self.ends(), [(1, "archived", sorted([conversation, "t1"]), "owner"), (2, "completed", sorted([conversation, "t1"]), "owner")])
        self.assertEqual(self.topic_versions(), versions, "no topic is touched")
        self.assertEqual(self.listing(ended=True)["items"][0]["end"]["state"], "completed")
        self.assertEqual(self.committed(self.end("open"))["topics"], 2)
        self.assertEqual(self.archived(conversation, "t1"), [0, 0], "Bring back reads the completed row's carried list")

    def test_example_5_a_coordinator_who_is_not_the_owner_is_refused(self):
        unchanged = self.unchanged()
        refused = self.end("archived", actor="agent-a")
        self.rejected(refused, "FORBIDDEN")
        self.assertEqual(refused["error"]["message"], "Only owner, this outcome's owner, archives, completes or brings it back")
        self.assertEqual(self.unchanged(), unchanged)

    def test_example_6_a_message_to_a_completed_outcome_is_refused_in_plain_words_and_an_ack_still_commits(self):
        self.post("Is the plan ready?", addressees=["agent-b"], intent="tell")
        [pending] = [row[0] for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'")]
        self.committed(self.end("completed"))
        when = day(self.sql("SELECT set_ms FROM outcome_ends WHERE workspace_id='w1'")[0][0])
        unchanged = self.unchanged()
        refused = self.command("message.post", {"body": "One more thing"}, {"topic_id": "t1"}, actor="agent-b")
        self.rejected(refused, "OUTCOME_COMPLETED")
        self.assertEqual(refused["error"]["message"], "Isolated test was completed on %s; owner, its owner, can bring it back." % when)
        self.assertEqual(self.unchanged(), unchanged, "no message, delivery or wait; the topic stays archived")
        own = self.command("message.post", {"body": "One more thing"}, {"topic_id": "t1"})
        self.assertEqual(own["error"]["message"], "Isolated test was completed on %s; bring it back to change anything in it." % when, "the owner is told he can")
        self.assertTrue(self.committed(self.command("delivery.ack", {}, {"delivery_id": pending}, actor="agent-b"))["acknowledged"])

    def test_example_7_a_reached_outcome_cannot_be_archived_or_completed(self):
        self.committed(self.kind_set("reach"))
        reached = self.committed(self.reach(unmet_confirmed=True))
        unchanged = self.unchanged()
        for state in ("completed", "archived", "open"):
            with self.subTest(state=state):
                refused = self.end(state)
                self.rejected(refused, "OUTCOME_REACHED")
                self.assertEqual(refused["error"]["message"], "Isolated test was reached on %s; Reached is final, and its topics are kept to read."
                                 % day(reached["reached_ms"]))
        self.assertEqual(self.unchanged(), unchanged)
        self.assertEqual((self.listing(reached=True)["items"][0]["id"], self.listing(ended=True)["items"]), ("w1", []), "never in both lists")

    def test_example_8_a_stale_page_is_refused_with_the_current_revision(self):
        stale = self.version()
        self.committed(self.end("archived"))
        unchanged = self.unchanged()
        refused = self.end("completed", expected=stale)
        self.rejected(refused, "REVISION_CONFLICT")
        self.assertEqual(refused["error"]["current_versions"], {"workspace_revision": self.version()})
        self.assertGreater(self.version(), stale)
        self.assertEqual(self.unchanged(), unchanged)
        self.assertEqual(self.ends()[-1][1], "archived", "one press did not turn the archive into a completion")

    def test_example_9_reached_on_an_archived_outcome_is_refused_before_anything_else(self):
        self.committed(self.kind_set("reach"))
        self.committed(self.end("archived"))
        unchanged = self.unchanged()
        refused = self.reach("We finished the work", unmet_confirmed=True)
        self.rejected(refused, "OUTCOME_ARCHIVED")
        self.assertEqual(refused["error"]["message"], "Isolated test is archived; bring it back to say it is reached.")
        self.assertEqual(self.unchanged(), unchanged)
        self.assertEqual(self.sql("SELECT count(*) FROM outcome_reached"), [(0,)])
        # The end check comes right after the reached check: on an outcome to keep it refuses before NOT_TO_REACH.
        self.committed(self.end("open"))
        self.committed(self.kind_set("keep"))
        self.committed(self.end("completed"))
        refused = self.reach("We finished the work", unmet_confirmed=True)
        self.rejected(refused, "OUTCOME_COMPLETED")
        self.assertEqual(refused["error"]["message"], "Isolated test was completed on %s; bring it back to say it is reached."
                         % day(self.sql("SELECT max(set_ms) FROM outcome_ends")[0][0]))

    def test_example_10_someone_not_on_the_team_is_refused_without_learning_whether_it_exists(self):
        unchanged = self.unchanged()
        for workspace in ("w1", "w-unknown"):
            with self.subTest(workspace=workspace):
                refused = self.command("outcome.end_set", {"state": "archived"}, {"workspace_id": workspace}, {"workspace_revision": 1}, actor="outsider")
                self.rejected(refused, "FORBIDDEN")
                self.assertEqual(refused["error"]["message"], "No permission for this workspace")
        self.assertEqual(self.unchanged(), unchanged)


class GuardCase(EndCase):
    """While archived or completed, an outcome is kept to read: every write in it is refused, the reader's own state saves."""

    def guarded(self, state):
        self.committed(self.memory(scope={"kind": "workspace", "id": "w1"}))
        self.committed(self.end(state))
        code = "OUTCOME_ARCHIVED" if state == "archived" else "OUTCOME_COMPLETED"
        unchanged, notebook = self.unchanged(), self.sql("SELECT count(*) FROM memory_revisions")
        topic_revision = self.sql("SELECT version FROM topics WHERE id='t1'")[0][0]
        source = {"kind": "new_topic", "id": "opening-late", "workspace_id": "w1"}
        self.committed(self.save_draft("draft-late", source, "t-late", "A late topic", opening={"workspace_id": "w1", "title": "Late", "participants": []}))
        self.committed(self.prepare("draft-late", "t-late", submission="submission-late", send_op="open-late"))
        unchanged = self.unchanged()
        writes = {
            "message.post": self.command("message.post", {"body": "One more thing"}, {"topic_id": "t1"}, actor="agent-a"),
            "topic.create_and_send": self.command("topic.create_and_send", {"submission_id": "submission-late"}, {"topic_id": "t-late"}, op="open-late"),
            "topic.update": self.command("topic.update", {"state": "done"}, {"topic_id": "t1"}, {"topic_revision": topic_revision}),
            "memory.revise": self.memory(revision=1, body="Later words"),
            "pipeline.configure": self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}, {"pipeline_revision": 0}),
            "outcome.kind_set": self.kind_set("reach"),
        }
        for kind, receipt in writes.items():
            with self.subTest(kind=kind, state=state):
                self.rejected(receipt, code)
        self.assertEqual(self.unchanged(), unchanged, "no row, delivery or change")
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions"), notebook)
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE id='t-late'"), [(0,)])

    def test_the_guard_refuses_every_write_in_an_archived_outcome(self):
        self.guarded("archived")

    def test_the_guard_refuses_every_write_in_a_completed_outcome(self):
        self.guarded("completed")

    def test_a_readers_own_state_still_saves(self):
        first = self.post("Is the plan ready?", addressees=["agent-b"], intent="tell")
        [pending] = [row[0] for row in self.sql("SELECT id FROM deliveries WHERE recipient_id='agent-b' AND state='pending'")]
        self.committed(self.end("archived"))
        self.assertTrue(self.committed(self.command("delivery.ack", {}, {"delivery_id": pending}, actor="agent-b"))["acknowledged"])
        seq = self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]
        self.committed(self.command("topic.read_through", {"seq": seq}, {"topic_id": "t1"}, actor="agent-a"))
        self.committed(self.command("note.save", {"source_ref": {"kind": "message", "id": first}, "body": "Kept for later"}, {"note_id": "n1"},
                                    {"note_revision": 0}))
        self.committed(self.save_draft("draft-kept", {"kind": "message", "id": first}, "t1", "Words kept while it is archived"))
        self.assertIn("Words kept while it is archived", json.dumps(self.sql("SELECT * FROM drafts WHERE id='draft-kept'")))

    def test_another_outcome_is_untouched_by_this_ones_end(self):
        self.committed(self.end("archived"))
        self.committed(self.create("w2"))
        self.committed(self.kind_set("reach", workspace="w2"))
        self.assertEqual([item["id"] for item in self.listing()["items"]], ["w2"])

    def test_the_shape_and_the_state_are_checked_and_nothing_is_written(self):
        unchanged = self.unchanged()
        shape = "Name one outcome and whether it is archived, completed or open"
        for args, target in (({}, {"workspace_id": "w1"}), ({"state": "archived", "why": "x"}, {"workspace_id": "w1"}),
                             ({"state": "archived"}, {"workspace_id": "w1", "topic_id": "t1"})):
            with self.subTest(args=args, target=target):
                refused = self.command("outcome.end_set", args, target, {"workspace_revision": self.version()})
                self.assertEqual((refused["error"]["code"], refused["error"]["message"]), ("INVALID_ARGUMENT", shape))
        refused = self.end("finished")
        self.assertEqual((refused["error"]["code"], refused["error"]["message"]), ("INVALID_ARGUMENT", "An outcome is archived, completed or open"))
        self.assertEqual(self.unchanged(), unchanged)

    def test_the_ends_past_cannot_be_rewritten(self):
        self.committed(self.end("archived"))
        with sqlite3.connect(str(self.path)) as db:
            for statement in ("UPDATE outcome_ends SET state='open'", "DELETE FROM outcome_ends",
                              "INSERT INTO outcome_ends VALUES ('w1',2,'finished','[]','owner',1)"):
                with self.subTest(statement=statement), self.assertRaises(sqlite3.DatabaseError):
                    db.execute(statement)
        self.assertEqual([row[:2] for row in self.ends()], [(1, "archived")])

    def test_the_lists_are_asked_for_one_at_a_time(self):
        refused = self.store.view("owner", "workspaces", {"reached": True, "ended": True})
        self.assertEqual(refused["error"], {"code": "INVALID_ARGUMENT", "message": "List reached or ended outcomes, one at a time", "retryable": False})
        self.assertEqual(self.store.view("owner", "workspaces", {"ended": "yes"})["error"]["message"], "ended is true or false")
        self.assertEqual(self.store.view("owner", "workspaces", {"reached": "yes"})["error"]["message"], "reached is true or false")
        self.assertEqual(self.listing(ended=False)["ended_count"], 0)

    def test_ended_count_counts_an_outcome_by_its_latest_end_only(self):
        self.committed(self.create("w2"))
        self.committed(self.end("archived"))
        self.committed(self.end("open"))
        self.committed(self.end("completed", workspace="w2"))
        listing = self.listing()
        self.assertEqual(([item["id"] for item in listing["items"]], listing["ended_count"]), (["w1"], 1), "w1 has rows but is open again")
        self.assertEqual([item["id"] for item in self.listing(ended=True)["items"]], ["w2"])

    def test_bring_back_unarchives_only_this_outcomes_listed_topics_still_archived(self):
        """A row's list is the act's own; even an id from another outcome on it never reaches outside this one."""
        self.committed(self.create("w2"))
        self.open_topic("t9", "w2")
        self.committed(self.command("topic.update", {"archived": True}, {"topic_id": "t9"},
                                    {"topic_revision": self.sql("SELECT version FROM topics WHERE id='t9'")[0][0]}))
        self.committed(self.end("archived"))
        listed = self.ends()[0][2]
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO outcome_ends VALUES ('w1',2,'completed',?,'owner',1)", (json.dumps(listed + ["t9"]),))
        result = self.committed(self.end("open"))
        self.assertEqual(result["topics"], len(listed))
        self.assertEqual(self.archived("t9", *listed), [1] + [0] * len(listed), "t9 is w2's and stays archived")

    def test_the_workspace_and_its_readers_carry_the_end(self):
        self.assertIsNone(self.store.view("agent-b", "workspace", {"workspace_id": "w1"})["workspace"]["end"])
        self.committed(self.end("archived"))
        end = self.store.view("agent-b", "workspace", {"workspace_id": "w1"})["workspace"]["end"]
        self.assertEqual((sorted(end), end["state"], end["by"]), (["by", "ms", "state"], "archived", "owner"))
        light = self.store.view("agent-b", "outcome_light", {"workspace_id": "w1"})
        self.assertEqual((light["light"]["light"], light["light"]["short"], light["lead"]),
                         ("quiet", {"kind": "archived", "ms": end["ms"]}, {"kind": "archived", "by": "owner", "ms": end["ms"]}))
        self.assertEqual(self.checks_view(actor="agent-b")["end"], end)


class AroundTheEndCase(EndCase):
    """What a person does about the outcome while it is ended holds when it comes back."""

    def test_a_reorder_made_while_it_is_archived_keeps_its_place_when_it_comes_back(self):
        for workspace in ("w2", "w3"):
            self.committed(self.create(workspace))
        self.committed(self.end("archived"))
        self.assertEqual([item["id"] for item in self.listing()["items"]], ["w2", "w3"])
        # The page saves the order with the ids it does not show kept in it (web/outline-order.mjs toSave).
        order = self.listing()["order"]
        self.committed(self.command("outline.order_set", {"ids": ["w3", "w1", "w2"]}, {}, {"order_revision": order["revision"]}))
        self.committed(self.end("open"))
        listing = self.listing()
        self.assertEqual((sorted(item["id"] for item in listing["items"]), listing["order"]["ids"]), (["w1", "w2", "w3"], ["w3", "w1", "w2"]))

    def test_an_agent_invited_while_it_is_archived_is_refused_and_can_be_invited_once_it_is_back(self):
        import os
        from pathlib import Path
        from aim_next.invite import invite
        folder = Path(self.temp.name).resolve() / "profiles"
        folder.mkdir(mode=0o700)

        def envelope(op):
            return {"v": 1, "instance_id": "test-instance", "operation_id": op, "kind": "workspace.agent_invite",
                    "target": {"workspace_id": "w1"}, "args": {"name": "Release scribe", "harness": "codex"},
                    "expected": {"workspace_revision": self.version(), "authority": dict(self.pin)}}
        self.committed(self.end("archived"))
        unchanged = self.unchanged()
        refused = invite(self.store, "owner", envelope("invite-1"), folder)
        self.rejected(refused, "OUTCOME_ARCHIVED")
        self.assertEqual(self.unchanged(), unchanged)
        self.assertEqual((self.sql("SELECT count(*) FROM actors WHERE name='Release scribe'"), os.listdir(folder)), ([(0,)], []))
        self.committed(self.end("open"))
        receipt = invite(self.store, "owner", envelope("invite-2"), folder)
        self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(receipt["result"]["agent"]["name"], "Release scribe", "the name was never taken by the refused invitation")
        self.assertTrue(receipt["sign_in"]["written"])


class KeptToReadCase(EndCase):
    """The other places that ask whether an outcome is kept to read (docs/targets.md): each answers for an archived one too."""

    def test_no_notebook_pencil_no_edit_no_stack_name_and_no_thumb_answer_while_archived(self):
        # His own message first: writing in a topic answers every ask there to him that came before it.
        mine = self.post("My own words", actor="owner")
        ask = self.post("Is the plan ready?", addressees=["owner"], intent="ask")
        self.assertEqual(self.waiting_on(), [("owner", ask)])
        scope = {"owner_scope": {"kind": "workspace", "id": "w1"}}
        self.assertTrue(self.store.view("agent-a", "memory_items", scope)["reader_may_write"])
        self.committed(self.end("archived"))
        self.assertFalse(self.store.view("agent-a", "memory_items", scope)["reader_may_write"], "no pencil")
        edit = self.command("message.edit", {"body": "Changed words"}, {"message_id": mine}, {"message_revision": 1})
        self.rejected(edit, "OUTCOME_ARCHIVED")
        name = self.command("stack.name", {"name": "Plans"}, {"message_id": ask}, {"name_revision": 0})
        self.rejected(name, "OUTCOME_ARCHIVED")
        thumb = self.command("message.thumb", {"thumbed": True}, {"message_id": ask}, {"thumb_revision": 0})
        self.committed(thumb)
        self.committed(self.end("open"))
        self.assertEqual(self.waiting_on(), [("owner", ask)], "a thumb given while archived answered no ask")


if __name__ == "__main__":
    unittest.main()

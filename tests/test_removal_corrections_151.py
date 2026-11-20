from __future__ import annotations

"""Warp12318's first bounded correction group; all stores are temporary."""

from contextlib import contextmanager
from unittest import mock

from aim_next import conversation, message_edit, store as store_module
from aim_next.topic_state import REOPENED_NOTE
import reader_fixture as fixtures
import test_message_removal_151 as removal_fixtures


class CorrectionFixture(fixtures.ReaderCase):
    post = removal_fixtures.RemovalCase.post
    remove = removal_fixtures.RemovalCase.remove
    source_view = removal_fixtures.RemovalCase.source_view

    @contextmanager
    def traced(self):
        statements = []
        original = store_module._connect

        def connect(*args, **kwargs):
            db, runtime = original(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db, runtime

        with mock.patch.object(store_module, "_connect", connect):
            yield statements

    def no_write(self, statements):
        writes = [sql for sql in statements if sql.lstrip().upper().startswith(
            ("BEGIN IMMEDIATE", "INSERT", "UPDATE", "DELETE", "COMMIT"))]
        self.assertEqual(writes, [], "a no-disclosure/no-growth read must remain read-only")


class ExposureCorrectionCase(CorrectionFixture):
    def test_own_note_and_draft_reference_does_not_expose_source_or_write(self):
        message = self.post("Source not fetched by the agent")
        ref = {"kind": "message", "id": message}
        self.committed(self.command("note.save", {"source_ref": ref, "body": "Private note words"},
                                    target={"note_id": "private-note"}, expected={"note_revision": 0}, actor="agent-a"))
        self.committed(self.command("draft.save", {
            "source_ref": ref, "topic_id": "t1", "generation": "private-generation",
            "body": "Private draft words", "attachments": [], "quotes": [], "addressees": [],
        }, target={"draft_id": "private-draft"}, expected={"draft_revision": 0}, actor="agent-a"))
        before = self.records()
        with self.traced() as statements:
            reply = self.store.view("agent-a", "editor_state", {"source_ref": ref, "topic_id": "t1"})
            note = self.store.view("agent-a", "editor_state", {"source_ref": ref})
        self.assertNotIn("error", reply, reply)
        self.assertNotIn("error", note, note)
        self.assertEqual(reply["draft"]["body"], "Private draft words")
        self.assertEqual(note["note"]["body"], "Private note words")
        self.assertEqual(self.sql("SELECT * FROM message_first_exposures WHERE message_id=?", (message,)), [],
                         "private writing does not disclose the referenced author's words")
        self.assertEqual(self.sql("SELECT * FROM message_exposures WHERE message_id=?", (message,)), [])
        self.no_write(statements)
        self.assertEqual(self.records(), before)
        self.assertEqual(self.source_view(message)["removal_action"], "unsend")

    def test_agent_authored_words_do_not_create_151_first_exposure(self):
        message = self.post("An agent's ordinary words", actor="agent-a", addressees=["owner"])
        before = self.records()
        with self.traced() as statements:
            source = self.source_view(message)
        self.assertEqual(source["body"], "An agent's ordinary words")
        self.assertEqual(self.sql("SELECT * FROM message_first_exposures WHERE message_id=?", (message,)), [],
                         "151 only records first exposure of person-authored removable messages")
        self.no_write(statements)
        self.assertEqual(self.records(), before)

    def test_human_words_have_no_agent_marker_and_keep_prewrite_commit_seq(self):
        self.participation("other-reader", True)
        message = self.post("Person's literal words \ue000 \ue001")
        before = int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0])
        changed_for_human = []
        human_calls = []
        original = message_edit.mark

        def observe(identity, revision, text):
            result = original(identity, revision, text)
            context = message_edit.reading.get()
            if context is not None and not context.agent:
                human_calls.append(identity)
                if result != text:
                    changed_for_human.append(identity)
            return result

        with mock.patch.object(message_edit, "mark", observe), mock.patch.object(conversation, "mark", observe):
            page = self.store.view("other-reader", "topic_messages", {"topic_id": "t1"})
        self.assertNotIn("error", page, page)
        self.assertEqual(next(row["body"] for row in page["items"] if row["id"] == message), "Person's literal words \ue000 \ue001")
        self.assertIn(message, human_calls, "observe the actual Conversation mark owner, not an unused module binding")
        self.assertEqual(changed_for_human, [], "word marks remain an agent-only mechanism")
        self.assertEqual(page["commit_seq"], before, "a view keeps its pre-exposure snapshot sequence")
        self.assertGreater(int(self.sql("SELECT value FROM metadata WHERE key='commit_seq'")[0][0]), before)
        self.assertEqual(self.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (message,)), [("other-reader",)])

    def test_first_human_exposure_and_each_agents_revision_exposure_share_existing_boundary(self):
        self.participation("other-reader", True)
        message = self.post()
        with self.traced() as statements:
            self.assertEqual(self.source_view(message, "other-reader")["body"], "Removal fixture exact words")
        self.assertEqual(statements.count("BEGIN IMMEDIATE"), 1)
        self.assertEqual(statements.count("COMMIT"), 1)
        for agent in ("agent-a", "agent-b"):
            with self.subTest(agent=agent):
                with self.traced() as statements:
                    self.assertEqual(self.source_view(message, agent)["body"], "Removal fixture exact words")
                self.assertEqual(statements.count("BEGIN IMMEDIATE"), 1)
                self.assertEqual(statements.count("COMMIT"), 1)
        self.assertEqual(self.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (message,)), [("other-reader",)])
        self.assertEqual(self.sql("SELECT actor_id,revision FROM message_exposures WHERE message_id=? ORDER BY actor_id", (message,)),
                         [("agent-a", 1), ("agent-b", 1)])
        self.committed(self.command("message.edit", {"body": "A later revision"}, target={"message_id": message},
                                    expected={"message_revision": 1}))
        self.assertEqual(self.source_view(message, "agent-b")["body"], "A later revision")
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE message_id=? AND actor_id='agent-b'", (message,)), [(2,)])
        self.assertEqual(self.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (message,)), [("other-reader",)])

    def test_already_exposed_and_own_content_take_no_write_transaction(self):
        self.participation("other-reader", True)
        message = self.post()
        self.source_view(message, "other-reader")
        self.source_view(message, "agent-a")
        before = self.records()
        with self.traced() as statements:
            for actor in ("owner", "other-reader", "agent-a"):
                self.assertEqual(self.source_view(message, actor)["body"], "Removal fixture exact words")
        self.no_write(statements)
        self.assertEqual(self.records(), before)


class HistoricalFreezeCase(CorrectionFixture):
    def test_real48_freeze_keeps_whispers_join_ancestry_and_personal_places(self):
        from aim_next.migrations import migrate, MigrationError
        first = self.post("Public first dossier")
        joined = self.post("Public joined dossier", actor="agent-a", addressees=["owner"])
        self.post("Another public dossier")
        reply = self.post("The author's ordinary reply", reply_to=first)
        private = self.post("Private root stays between two", whisper=True, intent=None)
        self.committed(self.command("stack.join", {"into": first}, target={"message_id": joined},
                                    expected={"join_revision": 0}))
        self.committed(self.command("stack.place", {"key": 9000}, target={"message_id": first},
                                    expected={"place_revision": 0}))
        messages = self.sql("SELECT * FROM messages ORDER BY seq")
        acts = self.sql("SELECT * FROM message_acts ORDER BY id")
        reply_seq = self.sql("SELECT seq FROM messages WHERE id=?", (reply,))[0][0]
        # Only the derived ordering index is cleared, in this temporary store,
        # as in the existing47→48 fixture. The real DOWN reaches exact48.
        self.sql("DELETE FROM dossier_order")
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "48")["schema_version"], "48")
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name IN ('dossier_order','message_removals')"), [])
        try:
            upgraded = migrate(self.path, "test-instance", self.binding)
        except MigrationError as error:
            self.fail("the historical48 freeze must work before removal tables exist: " + str(error))
        self.assertEqual(upgraded["schema_version"], "59")
        self.assertEqual(self.sql("SELECT key FROM dossier_order WHERE topic_id='t1' AND actor_id='owner' AND root_id=?", (first,)), [(9000,)])
        self.assertEqual(self.sql("SELECT key FROM dossier_order WHERE topic_id='t1' AND actor_id='agent-b' AND root_id=?", (first,)), [(reply_seq,)])
        self.assertEqual(self.sql("SELECT root_id FROM dossier_order WHERE topic_id='t1' AND root_id=?", (joined,)), [])
        self.assertEqual(self.sql("SELECT root_id FROM dossier_order WHERE actor_id='agent-b' AND root_id=?", (private,)), [])
        self.assertEqual(self.sql("SELECT count(*) FROM dossier_order WHERE actor_id='owner' AND root_id=?", (private,)), [(1,)])
        self.assertEqual(self.sql("SELECT * FROM messages ORDER BY seq"), messages)
        self.assertEqual(self.sql("SELECT * FROM message_acts ORDER BY id"), acts)


class RemovalActivityCase(CorrectionFixture):
    def setUp(self):
        self.now = 1000
        for name in ("aim_next.conversation._now_ms", "aim_next.topic_state._now_ms", "aim_next.openings._now_ms",
                     "aim_next.standing_conversation._now_ms", "aim_next.delivery._now_ms"):
            patch = mock.patch(name, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        super().setUp()

    def topic_state(self, topic="t1"):
        fields = ("state", "state_note", "state_by", "state_ms", "state_message_id", "activity_ms")
        return dict(zip(fields, self.sql("SELECT " + ",".join(fields) + " FROM topics WHERE id=?", (topic,))[0]))

    def update_state(self, state, note, topic="t1"):
        version = self.sql("SELECT version FROM topics WHERE id=?", (topic,))[0][0]
        return self.committed(self.command("topic.update", {"state": state, "note": note}, target={"topic_id": topic},
                                           expected={"topic_revision": version}))

    def done(self, at=2000):
        self.now = at
        self.update_state("done", "Exact completed note — retained")
        return self.topic_state()

    def post_at(self, topic, body):
        return self.committed(self.command("message.post", {"body": body}, target={"topic_id": topic}))["message_id"]

    def quiet_topic(self, topic, workspace="w1", participants=None):
        opening = "opening-" + topic
        self.committed(self.command("opening.save", {
            "workspace_id": workspace, "topic_id": topic, "title": "Quiet " + topic,
            "participants": list(participants or []), "body": "", "attachments": [],
        }, target={"opening_id": opening}, expected={"opening_revision": 0}))
        result = self.committed(self.command("opening.publish", target={"opening_id": opening}, expected={"opening_revision": 1}))
        self.assertIsNone(result["message_id"])

    def test_unsend_clears_its_reopen_reason_and_keeps_active_time_and_activity(self):
        self.done()
        self.now = 3000
        message = self.post()
        before = self.topic_state()
        self.assertEqual(before["state_message_id"], message)
        self.assertEqual(before["state_note"], REOPENED_NOTE)
        self.committed(self.remove(message))
        self.assertEqual(self.topic_state(), dict(before, state_message_id=None, state_by=None, state_note=""),
                         "12367 keeps the topic active and timestamps raised, with no gone-message attribution")
        self.assertEqual(self.topic_state()["state"], "active")
        self.assertEqual((self.topic_state()["state_ms"], self.topic_state()["activity_ms"]), (3000, 3000))

    def test_later_explicit_state_is_untouched_including_clock_regression(self):
        for index, state in enumerate(("review", "done")):
            with self.subTest(state=state):
                start = index * 10000
                self.done(start + 2000)
                self.now = start + 3000
                message = self.post()
                self.now = start + 2500
                self.update_state(state, "Later explicit state, earlier clock")
                before = self.topic_state()
                self.assertIsNone(before["state_message_id"])
                self.committed(self.remove(message))
                self.assertEqual(self.topic_state(), before, "Unsend does not replace a later explicit state act")
                self.assertEqual(self.topic_state()["activity_ms"], start + 3000)

    def test_later_publication_is_not_promoted_as_reopen_reason(self):
        self.done()
        self.now = 3000
        first = self.post("First unseen post")
        self.now = 4000
        second = self.post("Second independent post")
        before = self.topic_state()
        self.assertEqual(before["state_message_id"], first)
        self.committed(self.remove(first))
        cleared = dict(before, state_message_id=None, state_by=None, state_note="")
        self.assertEqual(self.topic_state(), cleared, "12367 clears the old reason without inventing a new reopening")
        self.assertEqual(self.source_view(second)["body"], "Second independent post")
        self.committed(self.remove(second))
        self.assertEqual(self.topic_state(), cleared, "activity remains raised even after both unseen posts are gone")

    def test_another_current_reopener_and_a_retracted_reason_remain_untouched(self):
        self.done()
        self.now = 3000
        first = self.post("First independent message")
        self.now = 4000
        self.update_state("done", "Done again")
        self.now = 5000
        second = self.post("The current reopener")
        before = self.topic_state()
        self.assertEqual(before["state_message_id"], second)
        self.committed(self.remove(first))
        self.assertEqual(self.topic_state(), before, "only the exact current reopening message owns its reason")
        self.committed(self.remove(second, "retract"))
        self.assertEqual(self.topic_state(), before, "Retract retains a readable message and is not this Unsend rule")

    def test_moved_reopener_loses_original_topic_attribution_only(self):
        self.now = 1500
        self.quiet_topic("t-destination", participants=["agent-a"])
        destination = self.topic_state("t-destination")
        self.done()
        self.now = 3000
        message = self.post()
        before = self.topic_state()
        self.committed(self.command("stack.move", {"topic_id": "t-destination"}, target={"message_id": message},
                                    expected={"source_topic_id": "t1", "move_revision": 0}))
        self.assertEqual(self.sql("SELECT topic_id FROM messages WHERE id=?", (message,)), [("t-destination",)])
        self.committed(self.remove(message))
        self.assertEqual(self.topic_state(), dict(before, state_message_id=None, state_by=None, state_note=""),
                         "the original topic must no longer name the gone message after its dossier moved")
        self.assertEqual(self.topic_state("t-destination"), destination)
        plan = self.sql("EXPLAIN QUERY PLAN SELECT id FROM topics WHERE state_message_id=?", (message,))
        self.assertTrue(any("topic_reopen_message" in row[3] for row in plan), plan)

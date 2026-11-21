from __future__ import annotations

import unittest
from unittest import mock

from aim_next import message_edit
from aim_next import store as store_module
import reader_fixture as fixtures


class LatestTopicCase(fixtures.ReaderCase):
    def post(self, body, actor="owner", **extra):
        return self.committed(self.command("message.post", dict(body=body, **extra),
                                           target={"topic_id": "t1"}, actor=actor))["message_id"]

    def latest(self, actor="owner", **args):
        page = self.store.view(actor, "workspace_topics", dict(workspace_id="w1", **args))
        self.assertNotIn("error", page, page)
        return next(item for item in page["items"] if item["id"] == "t1")["latest_message"]

    def test_newest_public_author_words_time_and_edit_revision(self):
        with mock.patch("aim_next.conversation._now_ms", return_value=123456):
            message = self.post("Reply without a quote:\n\n> Excluded quoted words\n\n**Newest** opening words.")
        item = self.latest()
        self.assertEqual((item["id"], item["author_id"], item["author_kind"], item["sent_ms"]),
                         (message, "owner", "human", 123456))
        self.assertEqual(item["opening"], "Newest opening words.")
        self.assertFalse(item["truncated"])
        self.committed(self.command("message.edit", {"body": "Changed newest words"},
                                    target={"message_id": message}, expected={"message_revision": 1}))
        self.assertEqual((self.latest()["opening"], self.latest()["revision"]), ("Changed newest words", 2))

    def test_whisper_never_replaces_public_preview_for_any_reader(self):
        public = self.post("Public latest")
        self.post("Private secret", whisper=True, addressees=["agent-a"])
        for actor in ("owner", "agent-a", "agent-b"):
            item = self.latest(actor)
            self.assertEqual((item["id"], item["opening"]), (public, "Public latest"))

    def test_unsend_falls_back_and_retraction_hides_words(self):
        public = self.post("Earlier public")
        unsent = self.post("Unsent secret")
        self.committed(self.command("message.unsend", target={"message_id": unsent}))
        self.assertEqual(self.latest()["id"], public)
        self.committed(self.command("message.retract", target={"message_id": public}))
        item = self.latest()
        self.assertEqual(item["opening"], "")
        self.assertTrue(item["removed"])

    def test_long_quotes_do_not_hide_opening_and_unicode_output_is_bounded(self):
        self.post("> " + "quoted " * 2000 + "\n\n" + "🚀" * 181)
        item = self.latest()
        self.assertEqual(item["opening"], "🚀" * 180)
        self.assertTrue(item["truncated"])

    def test_agent_held_words_are_withheld_and_visible_preview_records_exposure(self):
        message = self.post("Never hand an editing draft to the agent")
        self.committed(self.command("message.edit_open", {"holder": "960-holder"}, target={"message_id": message}))
        item = self.latest("agent-a")
        self.assertEqual(item["opening"], "")
        self.assertTrue(item["withheld"])
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-a' AND message_id=?", (message,)), [])
        self.assertEqual(self.latest()["opening"], "Never hand an editing draft to the agent")

    def test_agent_latest_author_and_current_revision_exposure(self):
        message = self.post("Agent opening words", actor="agent-a")
        item = self.latest("agent-b")
        self.assertEqual((item["author_id"], item["author_kind"], item["revision"]), ("agent-a", "agent", 1))
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-b' AND message_id=?", (message,)), [(1,)])
        self.committed(self.command("message.edit", {"body": "Revised agent opening"}, actor="agent-a",
                                    target={"message_id": message}, expected={"message_revision": 1}))
        self.assertEqual(self.latest("agent-b")["opening"], "Revised agent opening")
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-b' AND message_id=?", (message,)), [(2,)])

    def test_human_preview_counts_as_seen_before_unsend(self):
        version = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target={"workspace_id": "w1"}, expected={"workspace_revision": version}))
        message = self.post("Words another person reads on the outcome")
        self.assertEqual(self.latest("other-reader")["opening"], "Words another person reads on the outcome")
        self.assertEqual(self.sql("SELECT by FROM message_first_exposures WHERE message_id=?", (message,)), [("other-reader",)])
        self.rejected(self.command("message.unsend", target={"message_id": message}), "MESSAGE_SEEN")

    def test_image_markdown_has_identity_without_inventing_prose(self):
        message = self.post("![image label](https://example.invalid/picture.png)")
        item = self.latest()
        self.assertEqual((item["id"], item["opening"], item["truncated"]), (message, "", False))

    def test_empty_topic_has_no_latest_message(self):
        self.committed(self.command("message.unsend", target={"message_id": self.opening["id"]}))
        self.assertIsNone(self.latest())

    def test_unauthorized_outcome_does_not_return_preview_words(self):
        self.post("Private outcome opening")
        page = self.store.view("outsider", "workspace_topics", {"workspace_id": "w1"})
        self.assertEqual(page["error"]["code"], "FORBIDDEN")
        self.assertNotIn("items", page)

    def test_edit_hold_between_exposure_phases_discards_first_preview(self):
        message = self.post("Do not return a stale first-phase preview")

        def between():
            self.committed(self.command("message.edit_open", {"holder": "960-between"}, target={"message_id": message}))

        page = self.store._view("agent-a", "workspace_topics", {"workspace_id": "w1"}, between=between)
        item = next(item for item in page["items"] if item["id"] == "t1")["latest_message"]
        self.assertEqual((item["id"], item["opening"], item["withheld"]), (message, "", True))
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-a' AND message_id=?", (message,)), [])

    def test_unsend_between_exposure_phases_returns_surviving_latest(self):
        message = self.post("Remove before the preview is handed over")

        def between():
            self.committed(self.command("message.unsend", target={"message_id": message}))

        page = self.store._view("agent-a", "workspace_topics", {"workspace_id": "w1"}, between=between)
        item = next(item for item in page["items"] if item["id"] == "t1")["latest_message"]
        self.assertEqual(item["id"], self.opening["id"])
        self.assertNotIn("Remove before", str(page))
        self.assertEqual(self.sql("SELECT revision FROM message_exposures WHERE actor_id='agent-a' AND message_id=?", (message,)), [])

    def test_preview_exposure_causes_exact_revision_correction(self):
        message = self.post("Original preview words", actor="agent-a")
        self.latest("agent-b")
        self.committed(self.command("message.edit", {"body": "Changed preview words"}, actor="agent-a",
                                    target={"message_id": message}, expected={"message_revision": 1}))
        corrections = self.sql("SELECT d.revision FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                               "WHERE d.message_id=? AND d.recipient_id='agent-b' AND g.kind='correction'", (message,))
        self.assertEqual(corrections, [(2,)])

    def test_preview_marks_are_invisible_and_plain_probe_never_escapes(self):
        self.post("Marked latest preview")
        normal = self.latest("agent-a")
        with mock.patch.object(message_edit, "PLAIN_PROBE", True):
            probed = self.latest("agent-a")
        self.assertEqual(probed, normal)
        self.assertNotIn(message_edit.PROBE, str(probed))

    def test_only_returned_latest_bodies_are_read_in_one_batch(self):
        # History and an off-page latest body must never be handed to the
        # preview shaper. All records are made through the public commands.
        for number in range(12):
            self.post("Off-page history %d" % number)
        self.committed(self.save_draft("second-draft", {"kind": "new_topic", "id": "second-opening", "workspace_id": "w1"},
                                       "t2", "Returned newest opening", opening={"workspace_id": "w1", "title": "Second", "participants": []}))
        self.committed(self.prepare("second-draft", "t2", submission="second-send", send_op="second-send"))
        newest = self.committed(self.command("topic.create_and_send", {"submission_id": "second-send"},
                                             target={"topic_id": "t2"}, op="second-send"))["message_id"]
        seen, statements = [], []
        connect = store_module._connect

        def observed(*args, **kwargs):
            db, runtime = connect(*args, **kwargs)
            db.set_trace_callback(statements.append)

            def observed_words(identity, revision, text, chars, plain):
                seen.append(identity)
                return message_edit.marked_words(identity, revision, text, chars, plain)

            db.create_function("marked_words", 5, observed_words)
            return db, runtime

        with mock.patch.object(store_module, "_connect", observed):
            page = self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "limit": 1})
        self.assertNotIn("error", page)
        self.assertEqual([item["id"] for item in page["items"]], ["t2"])
        self.assertEqual(page["items"][0]["latest_message"]["id"], newest)
        self.assertEqual(seen, [newest])
        self.assertEqual(len([sql for sql in statements if "FROM topic_summaries s JOIN messages m" in sql]), 1)


if __name__ == "__main__":
    unittest.main()

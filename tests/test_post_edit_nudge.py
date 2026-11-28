from __future__ import annotations

import json
from unittest import mock

from aim_next import Store, hosted_notice
import test_agent_verbs


class PostEditNudgeCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.now = 1_000_000
        for where in ("aim_next.conversation._now_ms", "aim_next.delivery._now_ms"):
            patch = mock.patch(where, side_effect=lambda: self.now)
            patch.start()
            self.addCleanup(patch.stop)
        self.root = self.owner_post("Which cabin is available?")
        self.other = self.owner_post("When is dinner?")

    def owner_post(self, body, **args):
        return self.committed(self.command("message.post", dict(body=body, **args),
                                           target={"topic_id": "t1"}))["message_id"]

    def reply(self, root, body, *flags):
        return self.run_cli("reply", root, "--without-quote", "Fixture answers the request.", *flags, body)

    def assert_hint(self, out, mid, revision=1):
        self.assertIn("to add or correct: aim-next edit %s --expected %d -" % (mid, revision), out)

    def test_plain_reply_suggests_latest_editable_own_post_in_same_dossier(self):
        code, out, err = self.reply(self.root, "Looking up the cabin.")
        self.assertEqual((code, err), (0, ""), (out, err))
        first, _, _, body, _, _ = self.latest()
        self.assert_hint(out, first)
        self.assertIn("birth " + first, out)
        self.assertEqual(0, self.run_cli("edit", first, "--expected", "1", body.replace("Looking up", "Checking"))[0])
        self.assertEqual(0, self.reply(self.other, "Checking dinner.")[0])
        self.now += 30_000
        code, out, err = self.reply(self.root, "The cabin is ready.")
        self.assertEqual(code, 0, (out, err))
        self.assertIn("edit %s --expected 2 - instead?" % first, err)
        self.assert_hint(out, self.latest()[0])

    def test_unrelated_older_and_structured_posts_keep_their_format(self):
        code, out, err = self.reply(self.root, "The first answer.")
        self.assertEqual((code, err), (0, ""), (out, err))
        code, out, err = self.reply(self.other, "Another dossier.")
        self.assertEqual((code, err), (0, ""), (out, err))
        self.now += 120_001
        code, out, err = self.reply(self.root, "A later update.")
        self.assertEqual((code, err), (0, ""), (out, err))
        code, out, err = self.run_cli("--json", "reply", self.root,
                                      "--without-quote", "Fixture answers the request.", "Structured update.")
        self.assertEqual((code, err), (0, ""), (out, err))
        replies = [json.loads(line) for line in out.splitlines()]
        self.assertEqual(len(replies), 2, replies)
        self.assertEqual(replies[-1]["status"], "committed")
        self.assertEqual(replies[-1]["result"]["message_id"], self.latest()[0])

    def test_post_success_and_same_operation_after_edit_use_the_current_fence(self):
        args = ("post", "t1", "--divergence-reason", "Another topic in this room.",
                "--operation", "edit-nudge-post", "Release notes.")
        code, out, err = self.run_cli(*args)
        self.assertEqual((code, err), (0, ""), (out, err))
        first = self.latest()[0]
        self.assert_hint(out, first)
        self.assertEqual(0, self.run_cli("edit", first, "--expected", "1", "Updated release notes.")[0])
        code, out, err = self.run_cli(*args)
        self.assertEqual((code, err), (0, ""), (out, err))
        self.assert_hint(out, first, 2)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id='edit-nudge-post'"), [(1,)])

    def test_optional_read_failure_leaves_a_successful_send_successful(self):
        original = Store.view

        def offline(store, actor, name, args):
            if name == "post_edit_hint":
                return {"error": {"code": "DATABASE_BUSY", "retryable": True}}
            return original(store, actor, name, args)

        with mock.patch.object(Store, "view", offline):
            code, out, err = self.reply(self.root, "The answer still sends.")
        self.assertEqual((code, err), (0, ""), (out, err))
        self.assertIn("posted " + self.latest()[0], out)

    def test_private_post_gets_its_own_fence_and_stays_out_of_public_nudges(self):
        private = self.owner_post("Private facts", addressees=["agent-a"], whisper=True)
        code, out, err = self.run_cli("whisper", "t1", "--to", "owner", "--reply-to", private,
                                      "--without-quote", "A private reply.", "Checking privately.")
        self.assertEqual((code, err), (0, ""), (out, err))
        answer = self.latest()[0]
        self.assert_hint(out, answer)
        code, result, err = self.view_cli("post_edit_hint", {"message_id": answer}, actor="agent-b",
                                          binding=self.captured_for("agent-b"))
        self.assertEqual((code, err, result["edit"]), (0, "", None))
        code, result, err = self.view_cli("post_edit_hint", {"topic_id": "t1", "reply_to": private})
        self.assertEqual((code, err, result["edit"]), (0, "", None))
        code, out, err = self.reply(self.root, "The public answer.")
        self.assertEqual((code, err), (0, ""), (out, err))

    def test_shared_seat_guidance(self):
        instructions = hosted_notice.developer_instructions("agent-a", "/cli", "/profile")
        self.assertIn("The board is a set of documents, not a chat. Maintain the cover; messages are for asks and "
                      "changes; revise your own message rather than stacking.", instructions)

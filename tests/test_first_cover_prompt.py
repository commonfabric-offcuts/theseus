from __future__ import annotations

from unittest import mock

from aim_next import Store
from aim_next import hosted_notice
from aim_next.contract import StoreError
import test_agent_verbs


class FirstCoverPromptCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.participation("agent-b", True)
        self.root = self.post("Which cabin is available?", addressees=["agent-a"], intent="tell")

    def post(self, body, **args):
        return self.committed(self.command("message.post", dict(body=body, **args),
                                           target={"topic_id": "t1"}))["message_id"]

    def reply(self, actor="agent-a"):
        code, out, err = self.run_cli("reply", self.root, "--without-quote", "Fixture measures the first cover prompt.",
                                      "Checking cabin availability.", actor=actor)
        self.assertEqual((code, err), (0, ""), (code, out, err))
        return self.latest()[0], out

    def test_actual_reply_prompts_birth_and_pinned_retry_returns_original_result(self):
        reply, out = self.reply()
        self.assertIn("birth %s --root %s --expected-name 0 --expected-cover 0" % (reply, self.root), out)
        self.assertIn("--name", out)
        self.assertIn("same turn", out)
        self.assertIn("mint %s --expected 0" % self.root, out)
        args = ("birth", reply, "--root", self.root, "--expected-name", "0", "--expected-cover", "0",
                "--operation", "first-cover-fixture", "--name", "Cabin availability", "--nature", "Decision",
                "--done-when", "Owner confirms cabin", "--stands", "-")
        code, written, err = self.run_cli(*args, stdin=b"Check the cabin.\nConfirm the dates.")
        self.assertEqual((code, err), (0, ""), (code, written, err))
        self.assertIn("name revision 1", written)
        self.assertEqual(self.run_cli(*args, stdin=b"Check the cabin.\nConfirm the dates."), (0, written, ""))
        cover = self.store.view("owner", "dossier_cover", {"message_id": self.root})
        self.assertEqual(cover["cover"]["birth"], {"nature": "Decision", "done_when": "Owner confirms cabin"})
        self.assertEqual(cover["cover"]["stands"], "Check the cabin.\nConfirm the dates.")
        self.assertNotIn(" --root ", self.run_cli("birth", reply)[1])
        self.assertNotIn(" --root ", self.reply()[1])
        self.assertIn("Owner confirms cabin", self.run_cli("cover", self.root)[1])

    def test_other_first_responder_gets_cover_prompt_and_coordinator_gets_mint(self):
        reply, out = self.reply("agent-b")
        self.assertIn("birth %s --root" % reply, out)
        self.assertNotIn("--name", out)
        later, out = self.reply()
        self.assertIn("mint %s --expected 0" % self.root, out)
        self.assertNotIn("birth %s" % later, out)

    def test_typed_name_race_requires_explicit_reread(self):
        reply, out = self.reply()
        self.assertIn("--name", out)
        self.committed(self.command("stack.name", {"name": "My cabin plan"}, target={"message_id": self.root},
                                   expected={"name_revision": 0}))
        args = ("birth", reply, "--root", self.root, "--expected-cover", "0", "--nature", "Decision")
        code, _, err = self.run_cli(*args, "--expected-name", "0")
        self.assertEqual(code, 2, err)
        self.assertIn("REVISION_CONFLICT", err)
        code, out, err = self.run_cli("birth", reply)
        self.assertEqual((code, err), (0, ""), (code, out, err))
        self.assertIn("--expected-name 1", out)
        self.assertNotIn("--name", out)
        self.assertEqual(self.run_cli(*args, "--expected-name", "1")[0], 0)
        name = self.store.view("owner", "stack_namer", {"message_id": self.root})["name"]
        self.assertEqual(name["text"], "My cabin plan")

    def test_hosted_public_notice_and_recovery_guide_first_cover_without_leaking_whispers(self):
        items = self.store.view("agent-a", "deliveries", {})["items"]
        [delivery] = [item for item in items if item["message_id"] == self.root]

        def notice(item):
            return hosted_notice.notice([item], None, "agent-a", "fixture")["input"][0]["text"]

        self.assertIn("first public agent reply", notice(delivery))
        reply, _ = self.reply()
        recovered = dict(delivery, answer_recovery={"state": "answered", "source_revision": 1,
                                                   "message_id": reply, "seq": self.latest()[1]})
        self.assertIn("aim-next birth " + reply, notice(recovered))
        self.assertNotIn("aim-next birth", notice(dict(recovered, message=dict(delivery["message"], whisper=True))))
        self.assertNotIn("first public agent reply", notice(dict(delivery, message=dict(delivery["message"], whisper=True))))
        self.assertIn("birth REPLY", hosted_notice.developer_instructions("agent-a", "/cli", "/profile"))

    def test_whisper_reply_never_offers_shared_cover(self):
        private = self.post("Between the two of us", addressees=["agent-a"], whisper=True, reply_to=self.root)
        code, out, err = self.run_cli("whisper", "t1", "--to", "owner", "--reply-to", private,
                                      "--without-quote", "A private fixture.", "Checking privately.")
        self.assertEqual((code, err), (0, ""), (code, out, err))
        self.assertNotIn("birth", out)
        code, out, err = self.run_cli("birth", self.latest()[0])
        self.assertEqual((code, err), (0, ""), (code, out, err))
        self.assertNotIn(" --root ", out)

    def test_failed_post_commit_hint_read_can_recover_without_sending_another_reply(self):
        original = Store.view

        def blocked(store, actor, name, args):
            if name == "stack_namer":
                raise StoreError("Fixture interrupts the read after posting")
            return original(store, actor, name, args)

        with mock.patch.object(Store, "view", blocked):
            code, out, err = self.run_cli("reply", self.root, "--without-quote", "Fixture recovery.",
                                          "Checking the cabin.")
        self.assertEqual(code, 0, (out, err))
        reply = self.latest()[0]
        self.assertIn("posted " + reply, out)
        self.assertIn("aim-next birth " + reply, err)
        code, out, err = self.run_cli("birth", reply)
        self.assertEqual((code, err), (0, ""), (code, out, err))
        self.assertIn("--root " + self.root, out)
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE reply_to=?", (self.root,)), [(1,)])

    def test_nonretryable_hint_read_refusal_retains_the_code_and_reason(self):
        original = Store.view
        reason = "Binding changed: activate a recovery copy at a new path"

        def refused(store, actor, name, args):
            if name == "stack_namer":
                return {"error": {"code": "AUTHORITY_CHANGED", "message": reason, "retryable": False}}
            return original(store, actor, name, args)

        with mock.patch.object(Store, "view", refused):
            code, out, err = self.run_cli("reply", self.root, "--without-quote", "Fixture checks the bound read.",
                                          "Checking the cabin.")
        self.assertEqual(code, 0, (out, err))
        self.assertIn("posted " + self.latest()[0], out)
        self.assertIn("AUTHORITY_CHANGED", err)
        self.assertIn(reason, err)
        self.assertNotIn("aim-next birth", err)

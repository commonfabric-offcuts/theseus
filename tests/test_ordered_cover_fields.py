from __future__ import annotations

import json

from aim_next import Store
import test_agent_verbs


class OrderedCoverCase(test_agent_verbs.AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.root = self.post("Weekend planting")
        self.answer = self.post("The north beds are ready", actor="agent-a", reply_to=self.root,
                                reply_without_quote="Fixture records the delivered plan.")

    def post(self, body, actor="owner", **args):
        return self.committed(self.command("message.post", dict(body=body, **args),
                                          target={"topic_id": "t1"}, actor=actor))["message_id"]

    def write(self, args, revision=0, root=None, actor="agent-a"):
        return self.command("stack.cover", args, target={"message_id": root or self.root},
                            expected={"cover_revision": revision}, actor=actor)

    def read(self, root=None, actor="owner"):
        return self.store.view(actor, "dossier_cover", {"message_id": root or self.root})

    def test_ordered_section_patch_keeps_the_existing_cover_and_owner_acceptance(self):
        self.committed(self.write({"stands": "Existing cover", "waiting": [{"text": "Plant?", "default": "Saturday"}],
                                   "payload": {"text": "The north beds", "message_id": self.answer, "kind": "answer"}}))
        owner_name = self.sql("SELECT name FROM actors WHERE id='owner'")[0][0]
        proposed = self.read()["cover"]
        self.assertEqual(proposed["owner_name"], owner_name)
        self.assertIsNone(proposed["payload"]["done"])
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.answer},
                                   expected={"thumb_revision": 0}))
        old = self.read()["cover"]
        self.assertNotIn("sections", old)
        self.assertEqual(old["payload"]["done"]["by"], "owner")

        self.committed(self.write({"sections": {"where": "North beds", "who": "Garden crew", "when": "Saturday",
                                               "how": "Water before planting", "what": "Two beds\r\n\r\nSix trays",
                                               "why": "Prepare for winter"}}, revision=2))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        found = self.read()["cover"]
        self.assertEqual(found["owner_name"], owner_name)
        self.assertEqual(found["sections"], [{"key": key, "text": text} for key, text in [
            ("why", "Prepare for winter"), ("what", "Two beds\n\nSix trays"), ("how", "Water before planting"),
            ("when", "Saturday"), ("who", "Garden crew"), ("where", "North beds")]])
        for field in ("stands", "waiting", "payload"):
            self.assertEqual(found[field], old[field])
        positions = self.store.view("owner", "stack_positions", {"topic_id": "t1",
                                                                 "message_ids": [self.root, self.answer]})
        for item in positions["items"]:
            self.assertEqual(item["stack_position"]["cover"]["sections"], found["sections"])
        self.committed(self.write({"sections": {"what": "Four beds", "where": None}}, revision=3))
        final = self.read()["cover"]
        self.assertEqual(final["sections"][1], {"key": "what", "text": "Four beds"})
        self.assertEqual([item["key"] for item in final["sections"]], ["why", "what", "how", "when", "who"])

    def test_section_writes_respect_revision_shape_and_aggregate_length(self):
        self.committed(self.write({"sections": {"why": "Care for the beds"}}))
        before = self.read()
        for args, revision, expected in [
            ({"sections": {"who": "The crew"}}, 0, "REVISION_CONFLICT"),
            ({"sections": {"note": "Not a section"}}, 1, "INVALID_ARGUMENT"),
            ({"sections": []}, 1, "INVALID_ARGUMENT"),
            ({"sections": {"why": False}}, 1, "INVALID_ARGUMENT"),
            ({"sections": {"what": "a" * 32000}}, 1, "INVALID_ARGUMENT"),
        ]:
            with self.subTest(code=expected, revision=revision):
                self.rejected(self.write(args, revision), expected)
        self.assertEqual(self.read(), before)
        self.assertFalse(self.committed(self.write({"sections": {"why": "Care for the beds"}}, 1))["changed"])
        self.committed(self.write({"sections": {"why": ""}}, 1))
        self.assertIsNone(self.read()["cover"])

    def test_whisper_sections_are_visible_only_to_the_whisper_readers(self):
        root = self.post("Between us", addressees=["agent-a"], whisper=True)
        words = "Private planting plan"
        self.committed(self.write({"sections": {"what": words}}, root=root))
        self.assertEqual(self.read(root, actor="agent-a")["cover"]["sections"], [{"key": "what", "text": words}])
        self.assertEqual(self.read(root)["cover"]["sections"], [{"key": "what", "text": words}])
        self.assertEqual(self.read(root, actor="agent-b")["error"]["code"], "FORBIDDEN")
        public = self.store.view("agent-b", "topic_messages", {"topic_id": "t1", "limit": 20})
        self.assertNotIn(words, json.dumps(public))

    def test_cli_reads_sections_in_order_and_sets_each_field_on_the_cover_root(self):
        code, out, err = self.run_cli("cover", self.answer, "--expected", "0", "--where", "North beds",
                                      "--why", "Water before planting", "--what", "Two beds\nSix trays", "--log", "Checked Tuesday")
        self.assertEqual((code, err), (0, ""), (code, out, err))
        expected = ("  Why: Water before planting", "  What: Two beds", "  Where: North beds", "  Log: Checked Tuesday")
        self.assertEqual(sorted(expected, key=out.index), list(expected))
        self.assertNotIn("Six trays", out)
        receipt = self.read()
        self.assertEqual(receipt["root_id"], self.root)
        self.assertEqual(receipt["cover_revision"], 1)
        self.assertEqual(receipt["cover"]["sections"][1]["text"], "Two beds\nSix trays")
        code, raw, err = self.run_cli("--json", "cover", self.root)
        self.assertEqual((code, err), (0, ""), (code, raw, err))
        self.assertEqual(json.loads(raw)["cover"]["sections"], receipt["cover"]["sections"])

    def test_short_markdown_is_preserved_and_log_is_optional_and_last(self):
        text = "- First step  \r\n    - Nested step\r\n\r\n| Bed | Status |\r\n| --- | --- |\r\n| North | Ready |"
        self.committed(self.write({"sections": {"log": "Earlier plan", "where": "North garden", "what": text,
                                               "who": " \n \t"}}))
        self.assertEqual(self.read()["cover"]["sections"], [
            {"key": "what", "text": text.replace("\r\n", "\n")},
            {"key": "where", "text": "North garden"},
            {"key": "log", "text": "Earlier plan"}])
        self.committed(self.write({"sections": {"log": ""}}, 1))
        self.assertEqual([part["key"] for part in self.read()["cover"]["sections"]], ["what", "where"])

    def test_acceptance_keeps_its_display_attribution_after_an_owner_transfer(self):
        self.committed(self.write({"payload": {"text": "The north beds", "message_id": self.answer}}))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": self.answer},
                                   expected={"thumb_revision": 0}))
        before = self.read()["cover"]
        target = {"workspace_id": "w1"}
        revision = self.store.view("owner", "workspace", target)["workspace"]["version"]
        self.committed(self.command("workspace.member_set", {"actor_id": "other-reader", "present": True},
                                    target=target, expected={"workspace_revision": revision}))
        revision = self.store.view("owner", "workspace", target)["workspace"]["version"]
        self.committed(self.command("workspace.owner_set", {"owner_id": "other-reader"}, target=target,
                                    expected={"workspace_revision": revision}))
        after = self.read()["cover"]
        self.assertEqual((after["owner"], after["owner_name"]), ("other-reader", "Other fixture reader"))
        self.assertEqual(after["payload"]["done"], before["payload"]["done"])
        self.assertEqual(after["accepted_by_name"], before["owner_name"])

    def test_sections_only_complete_a_refresh_when_there_are_still_cover_words(self):
        self.committed(self.write({"sections": {"what": "Plant Saturday"}}))
        self.committed(self.command("stack.cover_refresh", target={"message_id": self.root},
                                    expected={"cover_revision": 1}))
        self.assertEqual(self.read()["cover_revision"], 1)
        self.committed(self.write({"sections": {"what": None}}, 1))
        cleared = self.read()
        self.assertEqual(cleared["refresh"]["state"], "pending")
        self.assertNotIn("sections", cleared["cover"])
        self.committed(self.write({"sections": {"when": "Sunday"}}, 2))
        self.assertEqual(self.read()["refresh"]["state"], "completed")

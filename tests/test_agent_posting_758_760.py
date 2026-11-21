from __future__ import annotations

import json
import unittest

from reader_fixture import ReaderCase


class AgentPostingCarryCase(ReaderCase):
    """Current publication boundaries without synthetic root input defaults."""

    def post(self, actor, args, op=None):
        return self.store.command(actor, self.envelope(
            "message.post", {"topic_id": "t1"}, args, op=op))

    def public(self):
        return {table: self.sql("SELECT * FROM " + table) for table in
                ("messages", "message_acts", "deliveries", "ask_cover_links", "dossier_order")}

    def root(self):
        return self.opening["id"]

    def wait(self, root):
        return {"root_id": root, "cover_revision": 0, "questions": [{
            "actor_id": "owner", "text": "Proceed with this separate investigation?",
            "options": ["Proceed", "Hold"], "default": "Hold", "reason": None}]}

    def test_agent_reply_missing_passage_refuses_without_side_effects(self):
        before = self.public()
        receipt = self.post("agent-a", {"body": "Answer", "reply_to": self.root()}, "missing-passage")
        self.rejected(receipt, "REPLY_PASSAGE_REQUIRED")
        self.assertEqual(self.public(), before)
        self.assertEqual(self.post("agent-a", {"body": "Answer", "reply_to": self.root()}, "missing-passage"), receipt)

    def test_agent_root_missing_reason_refuses_without_side_effects(self):
        before = self.public()
        receipt = self.post("agent-a", {"body": "Another subject"}, "missing-reason")
        self.rejected(receipt, "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual(self.public(), before)
        self.assertEqual([r["root_id"] for r in receipt["error"]["details"]["candidates"]], [self.root()])

    def test_human_reply_without_passage_keeps_exact_writing(self):
        body = "  Human reply\n**unchanged** 🪴\n"
        mid = self.committed(self.post("owner", {"body": body, "reply_to": self.root()}))["message_id"]
        source = self.source({"kind": "message", "id": mid})
        self.assertEqual((source["body"], source["quotes"], source.get("reply_basis")), (body, [], None))

    def test_human_root_without_reason_keeps_exact_writing_and_no_cover(self):
        body = "  Human new subject\nunchanged\n"
        mid = self.committed(self.post("owner", {"body": body}))["message_id"]
        self.assertEqual(self.sql("SELECT body,reply_to FROM messages WHERE id=?", (mid,)), [(body, None)])
        self.assertEqual(self.sql("SELECT value FROM message_acts WHERE message_id=? AND kind='cover'", (mid,)), [])

    def test_new_agent_root_ask_keeps_reason_and_wait_in_one_atomic_send(self):
        args = {"body": "A separate question", "divergence_reason": "A different investigation",
                "addressees": ["owner"], "intent": "ask", "go_ahead": False, "ask_wait": self.wait(None)}
        first = self.post("agent-a", args, "root-question")
        mid = self.committed(first)["message_id"]
        cover = self.store.view("owner", "dossier_cover", {"message_id": mid})
        self.assertEqual(cover["cover"]["stands"], args["divergence_reason"])
        self.assertEqual(cover["cover"]["waiting"][0]["ask_id"], mid)
        self.assertEqual(cover["cover"]["waiting"][0]["default"], "Hold")
        history = self.sql("SELECT revision,value FROM message_acts WHERE message_id=? AND kind='cover' ORDER BY revision", (mid,))
        self.assertEqual([r[0] for r in history], [1, 2])
        self.assertEqual(json.loads(history[0][1])["waiting"], [])
        before = self.public()
        self.assertEqual(self.post("agent-a", args, "root-question"), first)
        self.assertEqual(self.public(), before)

    def test_agent_reply_ask_keeps_selected_passage_and_current_wait_contract(self):
        args = {"body": "Question about the opening", "reply_to": self.root(),
                "reply_passage": {"source": {"kind": "message", "id": self.root(), "revision": 1}, "start": 0, "end": 7},
                "addressees": ["owner"], "intent": "ask", "go_ahead": False, "ask_wait": self.wait(self.root())}
        first = self.post("agent-a", args, "quoted-question")
        mid = self.committed(first)["message_id"]
        source = self.source({"kind": "message", "id": mid})
        self.assertEqual(source["body"], "> Opening\n\nQuestion about the opening")
        self.assertEqual(source["reply_basis"]["excerpt"], "Opening")
        cover = self.store.view("owner", "dossier_cover", {"message_id": self.root()})["cover"]
        self.assertEqual(cover["waiting"][0]["ask_id"], mid)
        self.assertEqual(cover["waiting"][0]["default"], "Hold")
        self.assertEqual(self.post("agent-a", args, "quoted-question"), first)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(AgentPostingCarryCase(name) for name in loader.getTestCaseNames(AgentPostingCarryCase)
                              if name in AgentPostingCarryCase.__dict__)

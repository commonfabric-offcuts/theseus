from __future__ import annotations

from test_dossier_covers import CoverCase


class CoverQuoteCase(CoverCase):
    def quote(self, root, part, body, excerpt, revision=1):
        start = body.index(excerpt)
        return {"source": {"kind": "cover", "id": root, "revision": revision, "part": part},
                "start": start, "end": start + len(excerpt), "excerpt": excerpt, "section": "Decision"}

    def send_quote(self, root, quote, actor="owner"):
        return self.command("message.post", {"body": "> " + quote["excerpt"] + "\n\nReply.",
                                             "reply_to": root, "quotes": [quote]},
                            target={"topic_id": "t1"}, actor=actor)

    def test_quote_keeps_unicode_offsets_from_the_selected_historical_revision(self):
        root = self.post("Dossier with cover.")
        body = "## Decision\n\n👋 Keep **these** exact words."
        self.committed(self.cover(root, {"stands": body}))
        quote = self.quote(root, "stands", body, "Keep **these** exact words.")
        self.committed(self.cover(root, {"stands": "New standing."}, revision=1))
        result = self.committed(self.send_quote(root, quote))
        source = self.source({"kind": "message", "id": result["message_id"]}, actor="owner")
        self.assertEqual(source["quotes"], [quote])
        self.assertEqual(source["reply_to"], root)
        shown = self.store.view("owner", "topic_messages", {"topic_id": "t1", "message_ids": [result["message_id"]]})
        self.assertEqual(shown["items"][0]["reply_cover_section"], "Decision")

    def test_quote_rejects_wrong_root_revision_coordinates_excerpt_or_generated_field(self):
        root = self.post("One dossier.")
        another = self.post("Another dossier.")
        body = "The cover's precise words."
        self.committed(self.cover(root, {"stands": body}))
        quote = self.quote(root, "stands", body, "precise")
        cases = [
            (another, quote),
            (root, dict(quote, source=dict(quote["source"], revision=2))),
            (root, dict(quote, source=dict(quote["source"], part="owner"))),
            (root, dict(quote, start=quote["start"] - 1)),
            (root, dict(quote, excerpt="different")),
            (root, dict(quote, section="Wrong\nlabel")),
        ]
        for target, value in cases:
            with self.subTest(target=target, value=value):
                receipt = self.send_quote(target, value)
                self.assertEqual(receipt["error"]["code"], "INVALID_QUOTE")

    def test_quote_uses_the_authored_wait_default_and_payload_fields(self):
        root = self.post("A dossier.")
        payload = self.post("A result.", reply_to=root)
        cover = {"waiting": [{"text": "Which choice?", "default": "Wait until morning"}],
                 "payload": {"text": "The actual result", "message_id": payload}}
        self.committed(self.cover(root, cover))
        for part, body, excerpt in [
            ("wait.0", "Which choice?", "Which"),
            ("default.0", "Wait until morning", "until morning"),
            ("payload", "The actual result", "actual result"),
        ]:
            with self.subTest(part=part):
                quote = self.quote(root, part, body, excerpt)
                result = self.committed(self.send_quote(root, quote))
                read = self.source({"kind": "message", "id": result["message_id"]}, actor="owner")
                self.assertEqual(read["quotes"], [quote])

    def test_wait_quote_keeps_its_stored_position_after_an_earlier_wait_closes(self):
        root = self.post("Dossier with two choices.")
        ask = self.post("Earlier question", actor="agent-a", reply_to=root, intent="ask", addressees=["agent-b"])
        body = "Which later choice?"
        cover = {"waiting": [{"text": "Earlier choice?", "default": "First option", "message_id": ask},
                             {"text": body, "default": "Second option"}]}
        self.committed(self.cover(root, cover))
        self.committed(self.command("message.withdraw", target={"message_id": ask}, actor="agent-a"))
        shown = self.shown(root)
        self.assertEqual(shown["revision"], 1)
        self.assertEqual(shown["waiting"], [cover["waiting"][1]])
        self.assertEqual(shown["quote_wait_indices"], [1])
        quote = self.quote(root, "wait.1", body, "later choice")
        result = self.committed(self.send_quote(root, quote))
        source = self.source({"kind": "message", "id": result["message_id"]}, actor="owner")
        self.assertEqual(source["quotes"], [quote])

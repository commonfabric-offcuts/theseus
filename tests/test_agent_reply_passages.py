from __future__ import annotations

import json
from test_store import StoreCase


class ReplyPassageCase(StoreCase):
    def test_internal_health_root_notice_keeps_existing_publication_path(self):
        import sqlite3
        from aim_next.contract import Refusal
        self.create_topic()
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            db.execute("INSERT INTO actors(id,kind,name,enabled) VALUES ('theseus','agent','Theseus',0)")
            topic = db.execute("SELECT * FROM topics WHERE id='t1'").fetchone()
            try:
                result, _ = self.store._publish(db, "theseus", "synthetic-health-root", "t1",
                    {"body": "Health: isolated root notice", "attachments": [], "quotes": [], "addressees": []},
                    topic=topic, settled_for={"owner", "agent-a"})
            except Refusal as error:
                self.fail("Existing internal root notice was refused: " + str(error))
            message_id = result["message_id"]
        self.assertEqual(self.sql("SELECT body FROM messages WHERE id=?", (message_id,)),
                         [("Health: isolated root notice",)])
        self.assertEqual(self.sql("SELECT enabled FROM actors WHERE id='theseus'"), [(0,)])

    def test_agent_new_topic_prepares_before_the_topic_exists(self):
        self.workspace()
        args = {"source_ref": {"kind": "new_topic", "id": "agent-opening", "workspace_id": "w1"},
                "topic_id": "agent-topic", "generation": "synthetic-generation", "body": "Agent root opening",
                "opening": {"workspace_id": "w1", "title": "Agent's isolated topic", "participants": ["owner"]}}
        self.committed(self.command("draft.save", args, {"draft_id": "agent-opening"},
                                    {"draft_revision": 0}, actor="agent-a"))
        self.committed(self.command("submission.prepare", {"draft_id": "agent-opening", "submission_id": "opening",
                    "send_operation_id": "opening-send"}, {"topic_id": "agent-topic"},
                    {"draft_revision": 1}, actor="agent-a"))
        self.assertEqual(self.sql("SELECT id FROM topics WHERE id='agent-topic'"), [])
        result = self.committed(self.command("topic.create_and_send", {"submission_id": "opening"},
                                            {"topic_id": "agent-topic"}, actor="agent-a", op="opening-send"))
        self.assertEqual(self.sql("SELECT body FROM messages WHERE id=?", (result["message_id"],)), [(args["body"],)])

    def test_human_preparation_keeps_original_frozen_fields_and_send_resolves_parent(self):
        parent = self.parent()
        args = {"source_ref": {"kind": "message", "id": parent}, "topic_id": "t1", "generation": "human-generation",
                "body": "Manual unchanged", "attachments": [], "quotes": [], "addressees": []}
        self.committed(self.command("draft.save", args, {"draft_id": "human"}, {"draft_revision": 0}))
        self.committed(self.command("submission.prepare", {"draft_id": "human", "submission_id": "human",
                    "send_operation_id": "human-send"}, {"topic_id": "t1"}, {"draft_revision": 1}))
        self.assertNotIn("reply_to", self.store.view("owner", "submission", {"submission_id": "human"}))
        sent = self.committed(self.command("message.send", {"submission_id": "human"}, {"topic_id": "t1"}, op="human-send"))
        source = self.store.view("owner", "source", {"kind": "message", "id": sent["message_id"]})
        self.assertEqual((source["body"], source["reply_to"], source["reply_basis"]), (args["body"], parent, None))

    def parent(self, text="  **answer** 🪴 é\r\nsecond\tline\n"):
        source = self.create_topic()
        self.command("message.edit", {"body": text}, target={"message_id": source["id"]},
                     expected={"message_revision": 1})
        self.parent_ref = dict(source, revision=2)
        self.parent_text = text
        return source["id"]

    def post(self, parent, **args):
        return self.command("message.post", dict(body="My answer\n", reply_to=parent, **args),
                            target={"topic_id": "t1"}, actor="agent-a")

    def test_missing_passage_refuses_without_publication(self):
        parent = self.parent()
        before = self.sql("SELECT id,body,quotes FROM messages")
        deliveries = self.sql("SELECT id,state FROM deliveries")
        result = self.post(parent)
        self.assertEqual(result["status"], "rejected", result)
        self.assertEqual(result["error"]["code"], "REPLY_PASSAGE_REQUIRED")
        self.assertEqual(self.sql("SELECT id,body,quotes FROM messages"), before)
        self.assertEqual(self.sql("SELECT id,state FROM deliveries"), deliveries)

    def passage(self, start=2, end=17):
        return {"source": self.parent_ref, "start": start, "end": end}

    def committed(self, result):
        self.assertEqual(result["status"], "committed", result)
        return result["result"]

    def test_exact_raw_span_inserted_once_and_retained_after_source_edit(self):
        parent = self.parent()
        passage = self.passage(0, len(self.parent_text))
        args = dict(body="  Literal $ `answer`\n", reply_to=parent, reply_passage=passage)
        before = self.sql("SELECT count(*) FROM messages")[0][0]
        first = self.command("message.post", args, {"topic_id": "t1"}, actor="agent-a", op="exact")
        result = self.committed(first)
        self.assertEqual(self.command("message.post", args, {"topic_id": "t1"}, actor="agent-a", op="exact"), first)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(before + 1,)])
        body, raw_quotes = self.sql("SELECT body,quotes FROM messages WHERE id=?", (result["message_id"],))[0]
        expected = ">   **answer** 🪴 é\r\n> second\tline\n> \n\n  Literal $ `answer`\n"
        self.assertEqual(body, expected)
        quote = json.loads(raw_quotes)
        self.assertEqual(len(quote), 1)
        self.assertEqual(quote[0], dict(passage, excerpt=self.parent_text))
        self.assertEqual(result["reply_basis"]["author_id"], "owner")
        self.command("message.edit", {"body": "New source"}, {"message_id": parent}, {"message_revision": 2})
        source = self.store.view("owner", "source", {"id": result["message_id"], "kind": "message"})
        self.assertEqual(source["body"], expected)
        self.assertEqual(source["reply_basis"], result["reply_basis"])
        items = self.store.view("owner", "topic_messages", {"topic_id": "t1"})["items"]
        self.assertEqual(items[-1]["reply_basis"], result["reply_basis"])
        self.assertEqual(self.command("message.post", args, {"topic_id": "t1"}, actor="agent-a", op="exact"), first)

    def test_forged_excerpt_wrong_source_stale_and_bad_offsets_refuse(self):
        parent = self.parent()
        for passage, code in [
            (dict(self.passage(), excerpt="asserted text"), "INVALID_REPLY_PASSAGE"),
            (dict(self.passage(), source=dict(self.parent_ref, id="m-wrong")), "INVALID_REPLY_PASSAGE"),
            (dict(self.passage(), source=dict(self.parent_ref, revision=1)), "REPLY_SOURCE_CHANGED"),
            (self.passage(-1, 3), "INVALID_REPLY_PASSAGE"),
            (self.passage(0, 99999), "INVALID_REPLY_PASSAGE"),
            (self.passage(3, 3), "INVALID_REPLY_PASSAGE"),
            (self.passage(False, 3), "INVALID_REPLY_PASSAGE"),
        ]:
            with self.subTest(passage=passage):
                before = self.sql("SELECT id FROM messages")
                result = self.post(parent, reply_passage=passage)
                self.assertEqual(result["error"]["code"], code, result)
                self.assertEqual(self.sql("SELECT id FROM messages"), before)
        # Caller-authored legacy quote metadata cannot satisfy the requirement.
        result = self.post(parent, quotes=[{"source": self.parent_ref, "excerpt": self.parent_text}])
        self.assertEqual(result["error"]["code"], "REPLY_PASSAGE_REQUIRED")

    def test_exception_is_visible_durable_and_cannot_be_removed_by_edit(self):
        parent = self.parent()
        reason = "  Answer concerns the attachment,\nnot a passage. 🪴\n"
        result = self.committed(self.post(parent, reply_without_quote=reason))
        self.assertEqual(result["reply_basis"]["reason"], reason)
        row = self.sql("SELECT body,quotes FROM messages WHERE id=?", (result["message_id"],))[0]
        self.assertEqual(row, (">   Answer concerns the attachment,\n> not a passage. 🪴\n> \n\nMy answer\n", "[]"))
        refused = self.command("message.edit", {"body": "Hide the reason"}, {"message_id": result["message_id"]},
                               {"message_revision": 1}, actor="agent-a")
        self.assertEqual(refused.get("error", {}).get("code"), "REPLY_BASIS_REQUIRED", refused)
        self.committed(self.command("message.edit", {"body": row[0] + "Correction"}, {"message_id": result["message_id"]},
                                    {"message_revision": 1}, actor="agent-a"))
        for extra in ({"reply_without_quote": "  \n"},
                      {"reply_without_quote": reason, "reply_passage": self.passage()}):
            self.assertEqual(self.post(parent, **extra)["error"]["code"], "INVALID_REPLY_PASSAGE")

    def test_human_manual_reply_and_agent_root_keep_existing_contract(self):
        parent = self.parent()
        result = self.committed(self.command("message.post", {"body": "Manual", "reply_to": parent}, {"topic_id": "t1"}))
        self.assertNotIn("reply_basis", result)
        result = self.committed(self.command("message.post", {"body": "New root"}, {"topic_id": "t1"}, actor="agent-a"))
        self.assertNotIn("reply_basis", result)
        self.assertEqual(self.post(None, reply_passage=self.passage())["error"]["code"], "INVALID_REPLY_PASSAGE")

    def test_visibility_whisper_and_edit_hold_precede_span_checks(self):
        parent = self.parent()
        private = self.committed(self.command("message.post", {"body": "private", "whisper": True,
                    "addressees": ["agent-a"]}, {"topic_id": "t1"}))["message_id"]
        public = self.post(private, reply_passage=self.passage())
        self.assertEqual(public["error"]["code"], "WHISPER_STAYS_PRIVATE")
        for identity in (private, "m-absent"):
            result = self.command("message.post", {"body": "Don't leak", "reply_to": identity,
                                  "reply_passage": self.passage()}, {"topic_id": "t1"}, actor="agent-b")
            self.assertEqual(result["error"]["code"], "INVALID_REPLY")
        result = self.committed(self.post(private, whisper=True, addressees=["owner"],
                                reply_passage={"source": {"kind": "message", "id": private, "revision": 1}, "start": 0, "end": 7}))
        self.assertTrue(result["whisper"])
        self.assertEqual(result["reply_basis"]["excerpt"], "private")
        other = self.store.view("agent-b", "source", {"kind": "message", "id": result["message_id"]})
        self.assertEqual(other.get("error", {}).get("code"), "FORBIDDEN", other)
        opened = self.command("message.edit_open", {"holder": "synthetic-holder"}, {"message_id": parent})
        self.committed(opened)
        for extra in ({"reply_passage": self.passage()}, {"reply_without_quote": "No passage"}):
            self.assertEqual(self.post(parent, **extra)["error"]["code"], "MESSAGE_HELD")

    def test_prepared_inferred_reply_checks_before_rotating_then_rechecks_at_send(self):
        parent = self.parent()
        saved = dict(source_ref={"kind": "message", "id": parent}, topic_id="t1", body="Prepared answer",
                     generation="synthetic-g", attachments=[], quotes=[], addressees=[])
        self.committed(self.command("draft.save", saved, {"draft_id": "reply"}, {"draft_revision": 0}, actor="agent-a"))
        def prepare(op, submission, revision=1):
            return self.command("submission.prepare", {"draft_id": "reply", "submission_id": submission, "send_operation_id": "send-" + submission},
                                {"topic_id": "t1"}, {"draft_revision": revision}, actor="agent-a", op=op)
        before = self.sql("SELECT revision,payload FROM drafts WHERE id='reply'")
        refused = prepare("no-passage", "bad")
        self.assertEqual(refused.get("error", {}).get("code"), "REPLY_PASSAGE_REQUIRED", refused)
        self.assertEqual(self.sql("SELECT revision,payload FROM drafts WHERE id='reply'"), before)
        saved["reply_passage"] = self.passage()
        self.committed(self.command("draft.save", saved, {"draft_id": "reply"}, {"draft_revision": 1}, actor="agent-a"))
        frozen = self.committed(prepare("prepare", "good", revision=2))
        send = self.command("message.send", {"submission_id": "good"}, {"topic_id": "t1"}, actor="agent-a", op="send-good")
        result = self.committed(send)
        self.assertEqual(result["reply_basis"]["excerpt"], self.parent_text[2:17])
        self.assertEqual(self.command("message.send", {"submission_id": "good"}, {"topic_id": "t1"}, actor="agent-a", op="send-good"), send)
        # A different prepared act is refused if its selected source changes before send.
        next_draft = frozen["next_draft"]
        saved["generation"] = next_draft["generation"]
        self.committed(self.command("draft.save", saved, {"draft_id": "reply"}, {"draft_revision": next_draft["revision"]}, actor="agent-a"))
        self.committed(prepare("prepare-stale", "stale", revision=next_draft["revision"] + 1))
        self.command("message.edit", {"body": "changed"}, {"message_id": parent}, {"message_revision": 2})
        before = self.sql("SELECT id FROM messages")
        stale = self.command("message.send", {"submission_id": "stale"}, {"topic_id": "t1"}, actor="agent-a", op="send-stale")
        self.assertEqual(stale["error"]["code"], "REPLY_SOURCE_CHANGED")
        self.assertEqual(self.sql("SELECT id FROM messages"), before)


    def test_late_refusal_rolls_back_publication_and_routing(self):
        parent = self.parent()
        before = {table: self.sql("SELECT * FROM " + table) for table in
                  ("messages", "deliveries", "changes", "topic_summaries", "message_acts")}
        result = self.post(parent, reply_passage=self.passage(), addressees=["owner"], intent="ask",
                           ask_wait={"root_id": parent, "cover_revision": 0, "questions": [{
                               "actor_id": "owner", "text": "May this synthetic piece proceed?",
                               "options": ["Proceed", "Hold"], "default": "Hold", "reason": None}]},
                           blocks={"kind": "piece", "ref": "p-missing"})
        self.assertEqual(result["status"], "rejected", result)
        self.assertTrue(result["recorded"])
        self.assertEqual(result["error"]["code"], "BLOCKS_UNKNOWN")
        for table, rows in before.items():
            self.assertEqual(self.sql("SELECT * FROM " + table), rows, table)

    def test_cli_reply_post_whisper_forward_span_and_reason_without_profile_reads(self):
        import io
        from types import SimpleNamespace
        from aim_next import cli
        parent = self.parent()
        profile = SimpleNamespace(instance_id="test-instance", actor_id="agent-a", db_path=self.path,
                                  authority_id=self.pin["authority_id"], authority_epoch=self.pin["authority_epoch"],
                                  store=lambda: self.store)
        def run(*args):
            options = cli._parser().parse_args(["--profile", "/synthetic-not-opened.json", "--outbox",
                                               str(Path(self.temp.name) / "outbox")] + list(args))
            output, errors = io.StringIO(), io.StringIO()
            agent = cli.Agent(profile, options, io.BytesIO(b""), cli.Lines(output, errors, False))
            try:
                getattr(agent, "do_" + options.verb)()
                return 0, output.getvalue(), errors.getvalue()
            except cli.Failed as error:
                return error.code, output.getvalue(), errors.getvalue()
        from pathlib import Path
        self.assertEqual(run("reply", parent, "Missing")[0], 2)
        self.assertEqual(run("post", "t1", "--reply-to", parent, "--attach", "/synthetic-missing-file",
                             "--quote-revision", "1", "--quote-start", "0", "--quote-end", "3", "Stale")[0], 2)
        self.assertEqual(self.sql("SELECT count(*) FROM media_intents"), [(0,)])
        flags = ("--quote-revision", "2", "--quote-start", "2", "--quote-end", "17", "--operation", "cli-span")
        code, out, err = run("reply", parent, *flags, "CLI answer")
        self.assertEqual((code, err), (0, ""))
        before = self.sql("SELECT id,body,quotes FROM messages")
        self.assertEqual(run("reply", parent, *flags, "CLI answer")[0], 0)
        self.assertEqual(self.sql("SELECT id,body,quotes FROM messages"), before)
        request = json.loads((Path(self.temp.name) / "outbox" / "cli-span.request.json").read_text())
        self.assertEqual(request["command"]["args"]["reply_passage"], self.passage())
        self.assertEqual(run("post", "t1", "--reply-to", parent, "--without-quote", "Answers the attachment", "Post answer")[0], 0)
        private = self.committed(self.command("message.post", {"body": "private", "whisper": True,
                    "addressees": ["agent-a"]}, {"topic_id": "t1"}))["message_id"]
        self.assertEqual(run("whisper", "t1", "--to", "owner", "--reply-to", private,
                             "--quote-revision", "1", "--quote-start", "0", "--quote-end", "7", "Private answer")[0], 0)

    def quote_cli(self, *args):
        import io
        from pathlib import Path
        from types import SimpleNamespace
        from aim_next import cli
        profile = SimpleNamespace(instance_id="test-instance", actor_id="agent-a", db_path=self.path,
                                  authority_id=self.pin["authority_id"], authority_epoch=self.pin["authority_epoch"],
                                  store=lambda: self.store)
        options = cli._parser().parse_args(["--profile", "/synthetic-not-opened.json", "--outbox",
                                           str(Path(self.temp.name) / "quote-outbox")] + list(args))
        output, errors = io.StringIO(), io.StringIO()
        agent = cli.Agent(profile, options, io.BytesIO(b""), cli.Lines(output, errors, False))
        try:
            getattr(agent, "do_" + options.verb)()
            return 0, output.getvalue(), errors.getvalue()
        except cli.Failed as error:
            return error.code, output.getvalue(), errors.getvalue()

    def quote_request(self, operation):
        from pathlib import Path
        return json.loads((Path(self.temp.name) / "quote-outbox" / (operation + ".request.json")).read_text())["command"]["args"]

    def test_cli_quote_text_matches_first_exact_unicode_occurrence_and_whisper(self):
        text = "🪴 **chosen** é\nnext"
        parent = self.parent("prefix " + text + " again " + text)
        code, out, err = self.quote_cli("reply", parent, "--quote", text, "--operation", "text-first", "Answer")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.quote_request("text-first")["reply_passage"], self.passage(7, 7 + len(text)))
        private = self.committed(self.command("message.post", {"body": "private words", "whisper": True,
                    "addressees": ["agent-a"]}, {"topic_id": "t1"}))["message_id"]
        code, out, err = self.quote_cli("whisper", "t1", "--to", "owner", "--reply-to", private,
                                      "--quote", "words", "Private answer")
        self.assertEqual((code, err), (0, ""))
        quotes = json.loads(self.sql("SELECT quotes FROM messages WHERE author_id='agent-a' ORDER BY seq DESC LIMIT 1")[0][0])
        self.assertEqual({key: quotes[-1][key] for key in ("source", "start", "end")},
                         {"source": {"kind": "message", "id": private, "revision": 1}, "start": 8, "end": 13})

    def test_cli_quote_text_missing_refuses_before_upload_or_send(self):
        parent = self.parent("exact raw **words**")
        before = {table: self.sql("SELECT * FROM " + table) for table in
                  ("messages", "deliveries", "media_intents", "operations")}
        code, out, err = self.quote_cli("post", "t1", "--reply-to", parent, "--quote", "Exact raw words",
                                      "--attach", "/synthetic-missing-file", "Answer")
        self.assertEqual(code, 2)
        self.assertIn("That text isn't in the message you're replying to", err)
        for table, rows in before.items():
            self.assertEqual(self.sql("SELECT * FROM " + table), rows, table)
        for flags in [("--quote", ""), ("--quote", "words", "--without-quote", "reason"),
                      ("--quote", "words", "--quote-revision", "2", "--quote-start", "12", "--quote-end", "17")]:
            self.assertEqual(self.quote_cli("reply", parent, *flags, "Answer")[0], 2)

    def test_cli_quote_text_sent_passage_equals_explicit_offset_form(self):
        parent = self.parent()
        text = self.parent_text[2:17]
        for operation, flags in [("text-form", ("--quote", text)),
                                 ("offset-form", ("--quote-revision", "2", "--quote-start", "2", "--quote-end", "17"))]:
            code, out, err = self.quote_cli("post", "t1", "--reply-to", parent, *flags,
                                          "--operation", operation, "Same answer")
            self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.quote_request("text-form"), self.quote_request("offset-form"))
        messages = self.sql("SELECT id,body,quotes FROM messages WHERE author_id='agent-a' ORDER BY seq")
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0][1:], messages[1][1:])
        bases = [self.store.view("agent-a", "source", {"kind": "message", "id": row[0]})["reply_basis"] for row in messages]
        self.assertEqual(bases[0], bases[1])
        self.assertEqual(bases[0]["excerpt"], text)

    def test_generated_body_limit_refuses_without_truncation_or_message(self):
        from aim_next.contract import LIMITS
        parent = self.parent()
        before = self.sql("SELECT id FROM messages")
        result = self.command("message.post", dict(body="x" * LIMITS["body_utf8_bytes"], reply_to=parent,
                              reply_passage=self.passage()), {"topic_id": "t1"}, actor="agent-a")
        self.assertEqual(result["error"]["code"], "BODY_TOO_LARGE")
        self.assertEqual(self.sql("SELECT id FROM messages"), before)

    def test_http_command_handler_uses_bound_actor_and_core_refusal_without_a_server(self):
        from types import SimpleNamespace
        from aim_next.server import Handler
        parent = self.parent()
        handler = Handler.__new__(Handler)
        handler.path = "/api/command"
        handler.server = SimpleNamespace(actor="agent-a", read_through_slots=None)
        handler._authorize = lambda **kwargs: None
        handler._store_call = lambda action, **kwargs: action(self.store)
        responses = []
        handler._json_response = lambda status, result: responses.append((status, result))
        def call(operation, **extra):
            envelope = {"v": 1, "instance_id": "test-instance", "operation_id": operation, "kind": "message.post",
                        "expected": {"authority": self.pin}, "target": {"topic_id": "t1"},
                        "args": dict(body="HTTP answer", reply_to=parent, **extra)}
            handler._body = lambda: envelope
            handler._post()
            self.assertEqual(responses[-1][0], 200)
            return responses[-1][1]
        self.assertEqual(call("http-refuse")["error"]["code"], "REPLY_PASSAGE_REQUIRED")
        result = self.committed(call("http-correct", reply_passage=self.passage()))
        self.assertEqual(result["reply_basis"]["excerpt"], self.parent_text[2:17])
        self.assertEqual(self.sql("SELECT author_id FROM messages WHERE id=?", (result["message_id"],)), [("agent-a",)])

    def test_assessment_report_requires_choice_and_dispatch_readback_preserves_fingerprint(self):
        import uuid
        from types import SimpleNamespace
        from aim_next.assessment_dispatch import Core
        parent = self.parent()
        request = self.committed(self.command("assessment.request", dict(assessor_id="agent-b", team=["agent-a"],
                    assignment="Inspect synthetic artifact", source_message_ids=[parent], operator_id="owner"), {"topic_id": "t1"}))
        identity, thread = request["assessment_id"], str(uuid.uuid4())
        self.committed(self.command("assessment.attach", {"thread_id": thread, "runtime_digest": "a" * 64},
                                    {"assessment_id": identity}, actor="agent-b"))
        args = dict(thread_id=thread, body="Synthetic assessment", recommendation="continue", evidence_message_ids=[parent],
                    next_checkpoint="After preview")
        missing = self.command("assessment.finish", args, {"assessment_id": identity}, actor="agent-b")
        self.assertEqual(missing["error"]["code"], "REPLY_PASSAGE_REQUIRED")
        args["reply_passage"] = self.passage()
        result = self.committed(self.command("assessment.finish", args, {"assessment_id": identity}, actor="agent-b"))
        self.assertEqual(result["reply_basis"]["excerpt"], self.parent_text[2:17])
        core = Core(SimpleNamespace(store=lambda: self.store, actor_id="agent-b", instance_id="test-instance"))
        readback = core.readback(core.record(identity))
        self.assertTrue(readback["body"].endswith("Synthetic assessment"))


def load_tests(loader, tests, pattern):
    import unittest
    return unittest.TestSuite(ReplyPassageCase(name) for name in loader.getTestCaseNames(ReplyPassageCase)
                              if name in ReplyPassageCase.__dict__)

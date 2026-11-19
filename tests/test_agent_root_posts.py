from __future__ import annotations

import json

from reader_fixture import ReaderCase


class AgentRootPostsCase(ReaderCase):
    def post(self, body="Separate investigation", actor="agent-a", op=None, topic="t1", **extra):
        extra.setdefault("divergence_reason", None)  # This case deliberately tests missing-reason requests.
        return self.command("message.post", dict(body=body, **extra),
                            target={"topic_id": topic}, actor=actor, op=op)

    def test_root_without_reason_refuses_current_readable_singleton(self):
        root = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        before = self.public_state()
        receipt = self.post(op="refused-root")
        self.rejected(receipt, "DIVERGENCE_REASON_REQUIRED")
        self.assertTrue(receipt["recorded"], receipt)
        self.assertEqual(self.public_state(), before)
        self.assertEqual([r["root_id"] for r in receipt["error"]["details"]["candidates"]], [root])
        self.assertEqual(self.post(op="refused-root"), receipt)
        self.assertEqual(self.public_state(), before)

    def root(self):
        return self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]

    def covers(self):
        return self.sql("SELECT message_id,revision,value FROM message_acts WHERE kind='cover' ORDER BY id")

    def test_exact_reason_atomic_cover_and_immutable_retry(self):
        value = "  Separate  café investigation — caller's words  "
        body = "Exact writing\nwith a second line.  "
        receipt = self.post(body, op="corrected-root", divergence_reason=value)
        mid = self.committed(receipt)["message_id"]
        self.assertEqual(self.sql("SELECT body FROM messages WHERE id=?", (mid,)), [(body,)])
        self.assertEqual(self.covers(), [(mid, 1, json.dumps({"stands": value, "waiting": [], "payload": None}, separators=(",", ":"), ensure_ascii=False))])
        cover = self.store.view("owner", "dossier_cover", {"message_id": mid})
        self.assertEqual((cover["root_id"], cover["cover_revision"], cover["cover"]["stands"]), (mid, 1, value))
        before = self.records()
        self.assertEqual(self.post(body, op="corrected-root", divergence_reason=value), receipt)
        self.assertEqual(self.records(), before)
        self.rejected(self.post(body, op="corrected-root", divergence_reason="Another reason"), "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.store.view("agent-a", "operation", {"operation_id": "corrected-root"}), receipt)
        self.rejected(self.command("stack.cover", {"stands": "Later status"}, target={"message_id": mid},
                                   expected={"cover_revision": 0}, actor="agent-a"), "REVISION_CONFLICT")
        self.committed(self.command("stack.cover", {"stands": "Later status"}, target={"message_id": mid},
                                    expected={"cover_revision": 1}, actor="agent-a"))
        self.assertEqual(json.loads(self.covers()[0][2])["stands"], value)

    def test_refused_identity_cannot_be_corrected_and_claimed_as_new(self):
        original = self.post(op="refused-root")
        self.rejected(original, "DIVERGENCE_REASON_REQUIRED")
        self.rejected(self.post(op="refused-root", divergence_reason="Different subject"), "OPERATION_PAYLOAD_MISMATCH")
        self.assertEqual(self.post(op="refused-root"), original)
        self.committed(self.post(op="fresh-root", divergence_reason="Different subject"))

    def test_same_transaction_rolls_back_message_cover_and_deliveries(self):
        from unittest import mock
        from aim_next import Store
        from aim_next.contract import Refusal
        record = Store._record_act
        applied = []
        def fail_after_cover(store, db, kind, message, *args, **kwargs):
            result = record(store, db, kind, message, *args, **kwargs)
            if kind == "cover":
                applied.append(db.execute("SELECT value FROM message_acts WHERE id=?", (result,)).fetchone()[0])
                raise Refusal("TEST_INTERRUPTION", "Synthetic interruption after actual cover insertion")
            return result
        before, covers = self.public_state(), self.covers()
        with mock.patch.object(Store, "_record_act", fail_after_cover):
            self.rejected(self.post(divergence_reason="Atomic new direction"), "TEST_INTERRUPTION")
        self.assertEqual(len(applied), 1)
        self.assertEqual(json.loads(applied[0])["stands"], "Atomic new direction")
        self.assertEqual(self.public_state(), before)
        self.assertEqual(self.covers(), covers)
        self.committed(self.post(divergence_reason="Atomic new direction"))

    def test_privacy_current_joins_splits_and_no_held_words(self):
        first = self.root()
        second = self.committed(self.post("Second dossier body", actor="owner"))["message_id"]
        private = self.committed(self.post("SECRET BODY", actor="owner", addressees=["agent-b"], whisper=True))["message_id"]
        for mid, name in ((first, "Visible investigation"), (private, "SECRET NAME")):
            self.committed(self.command("stack.name", {"name": name}, target={"message_id": mid}, expected={"name_revision": 0}))
        self.committed(self.command("stack.join", {"into": first}, target={"message_id": second}, expected={"join_revision": 0}))
        refused = self.post()
        self.rejected(refused, "DIVERGENCE_REASON_REQUIRED")
        roots = refused["error"]["details"]["candidates"]
        self.assertEqual([r["root_id"] for r in roots], [first])
        self.assertEqual(roots[0]["name"], "Visible investigation")
        self.assertNotIn("SECRET", json.dumps(refused))
        self.assertNotIn(private, json.dumps(refused))
        self.assertNotIn("Opening message", json.dumps(refused))
        self.committed(self.command("stack.join", {"into": None}, target={"message_id": second}, expected={"join_revision": 1}))
        roots = self.post()["error"]["details"]["candidates"]
        self.assertEqual([r["root_id"] for r in roots], [first, second])
        self.assertEqual(roots[1]["join_revision"], 2)
        # A denied topic refuses before it reads or exposes any candidate.
        denied = self.post(actor="outsider")
        self.rejected(denied, "FORBIDDEN")
        self.assertNotIn("candidates", json.dumps(denied))
        # Holding the root's words cannot leak them through a command refusal.
        self.committed(self.command("message.edit_open", {"holder": "fixture-holder"}, target={"message_id": first},
                                    expected={}))
        self.assertNotIn("Opening message", json.dumps(self.post()))

    def test_accepted_payload_with_wait_and_personal_below_more_still_counts(self):
        mid = self.root()
        answer = self.committed(self.post("Accepted answer", reply_to=mid,
            reply_passage={"source": {"kind": "message", "id": mid, "revision": 1}, "start": 0, "end": 7}))["message_id"]
        self.committed(self.command("stack.cover", {"payload": {"text": "Answer accepted", "message_id": answer},
                                    "waiting": [{"text": "Next choice", "default": "Keep the answer"}]},
                                    target={"message_id": mid}, expected={"cover_revision": 0}, actor="agent-a"))
        self.committed(self.command("message.thumb", {"thumbed": True}, target={"message_id": answer}, expected={"thumb_revision": 0}))
        self.assertIsNotNone(self.store.view("agent-a", "dossier_cover", {"message_id": mid})["cover"]["payload"]["done"])
        seq = self.sql("SELECT seq FROM messages WHERE id=?", (mid,))[0][0]
        self.committed(self.command("stack.aside", {"through": seq}, target={"message_id": mid}, expected={"aside_revision": 0}, actor="agent-a"))
        refusal = self.post()
        self.rejected(refusal, "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual([r["root_id"] for r in refusal["error"]["details"]["candidates"]], [mid])
        for word in ("waiting", "closed", "accepted", "open stack"):
            self.assertNotIn(word, refusal["error"]["message"])

    def test_candidates_are_bounded_and_do_not_claim_total(self):
        from aim_next.contract import LIMITS
        for index in range(LIMITS["root_post_candidates"] + 2):
            self.committed(self.post("Other direction %d" % index, actor="owner"))
        receipt = self.post()
        roots = receipt["error"]["details"]["candidates"]
        self.assertEqual(len(roots), LIMITS["root_post_candidates"])
        self.assertLess(len(json.dumps(receipt).encode("utf-8")), 20000)
        self.assertEqual(set(receipt["error"]["details"]), {"topic_revision", "candidates"})

    def test_replies_and_human_writing_do_not_gain_reason_cover(self):
        self.committed(self.post("Human root\nexact", actor="owner"))
        reply = self.committed(self.post("Agent reply\nexact", reply_to=self.root(),
            reply_passage={"source": {"kind": "message", "id": self.root(), "revision": 1}, "start": 0, "end": 7}))["message_id"]
        self.assertEqual(self.sql("SELECT reply_to,body FROM messages WHERE id=?", (reply,)), [(self.root(), "> Opening\n\nAgent reply\nexact")])
        self.assertEqual(self.covers(), [])
        self.rejected(self.post(reply_to="missing"), "INVALID_REPLY")
        self.rejected(self.post(whisper=True, addressees=["owner"]), "WHISPER_SHAPE")

    def save_agent(self, reason=None, ref=None, revision=0, **extra):
        generation = self.sql("SELECT generation FROM drafts WHERE actor_id='agent-a' AND id='agent-draft'")
        fields = {"source_ref": ref or {"kind": "topic", "id": "t1"}, "topic_id": "t1", "generation": generation[0][0] if generation else "g-root",
                  "body": "Frozen exact writing\n", "divergence_reason": reason, **extra}
        return self.command("draft.save", fields, target={"draft_id": "agent-draft"}, expected={"draft_revision": revision}, actor="agent-a")

    def prepare_agent(self, revision=1, **extra):
        return self.command("submission.prepare", dict(draft_id="agent-draft", submission_id="agent-submission",
                            send_operation_id="agent-send", **extra), target={"topic_id": "t1"},
                            expected={"draft_revision": revision}, actor="agent-a")

    def send_agent(self, topic="t1"):
        return self.command("message.send", {"submission_id": "agent-submission"}, target={"topic_id": topic}, actor="agent-a", op="agent-send")

    def test_prepared_root_freezes_reason_and_preserves_newer_writing(self):
        value = "  A separate  direction  "
        self.committed(self.save_agent(value))
        self.rejected(self.prepare_agent(divergence_reason="Late replacement"), "REVISION_CONFLICT")
        self.committed(self.prepare_agent())
        snapshot = json.loads(self.sql("SELECT snapshot FROM submissions WHERE actor_id='agent-a'")[0][0])
        self.assertEqual(snapshot["divergence_reason"], value)
        # prepare rotates the private draft; newer writing remains after send.
        revision = self.sql("SELECT revision FROM drafts WHERE actor_id='agent-a'")[0][0]
        self.committed(self.save_agent("Newer retained reason", revision=revision))
        before = self.sql("SELECT * FROM drafts WHERE actor_id='agent-a'")
        receipt = self.send_agent()
        mid = self.committed(receipt)["message_id"]
        self.assertEqual(self.sql("SELECT * FROM drafts WHERE actor_id='agent-a'"), before)
        self.assertEqual(self.sql("SELECT body FROM messages WHERE id=?", (mid,)), [("Frozen exact writing\n",)])
        self.assertEqual(self.store.view("owner", "dossier_cover", {"message_id": mid})["cover"]["stands"], value)
        self.assertEqual(self.send_agent(), receipt)

    def test_prepared_root_without_reason_is_refused_at_send_and_keeps_snapshot(self):
        self.committed(self.save_agent())
        self.committed(self.prepare_agent())
        before = self.sql("SELECT * FROM submissions WHERE actor_id='agent-a'")
        public = self.public_state()
        self.rejected(self.send_agent(), "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual(self.public_state(), public)
        self.assertEqual(self.sql("SELECT * FROM submissions WHERE actor_id='agent-a'"), before)

    def test_prepared_source_derived_reply_needs_no_reason(self):
        self.committed(self.save_agent(ref={"kind": "message", "id": self.root()},
            reply_passage={"source": {"kind": "message", "id": self.root(), "revision": 1}, "start": 0, "end": 7}))
        self.committed(self.prepare_agent())
        mid = self.committed(self.send_agent())["message_id"]
        self.assertEqual(self.sql("SELECT reply_to FROM messages WHERE id=?", (mid,)), [(self.root(),)])
        self.assertEqual(self.covers(), [])

    def test_reason_validation_preserves_accepted_bytes(self):
        for value in ("", "   ", "two\nlines", "tab\there", "a" * 301, 123, "bad\x1bcontrol"):
            self.rejected(self.post(divergence_reason=value), "INVALID_ARGUMENT")
        self.committed(self.post(divergence_reason="a" * 300))

    def test_cli_post_and_reply_use_shared_core_without_profile_access(self):
        import io
        from pathlib import Path
        from aim_next import cli
        agent = cli.Agent.__new__(cli.Agent)
        agent.actor, agent.store, agent.binding = "agent-a", self.store, dict(self.binding)
        output, error = io.StringIO(), io.StringIO()
        agent.out = cli.Lines(output, error, False)
        directory = Path(self.temp.name) / "synthetic-outbox"
        directory.mkdir()
        agent.outbox = lambda: directory
        agent.envelope = lambda kind, target, args, expected=None, operation=None: self.envelope(kind, target, args, expected, op=operation)
        # Only parser/verb/retained request dispatch execute: no profile loader.
        def options(*args):
            return cli._parser().parse_args(["--profile", "/never-opened", *args])
        agent.options = options("post", "t1", "--operation", "cli-refusal", "A separate line")
        with self.assertRaises(cli.Failed) as failed:
            agent.do_post()
        self.assertEqual(failed.exception.code, 2)
        self.assertIn("supply a divergence reason", error.getvalue())
        self.assertIn(self.root(), error.getvalue())
        saved = json.loads((directory / "cli-refusal.request.json").read_text())
        refused = json.loads((directory / "cli-refusal.receipt.json").read_text())
        self.assertEqual(self.store.command("agent-a", saved["command"]), refused)
        value = "  Different  direction  "
        agent.options = options("post", "t1", "--operation", "cli-corrected", "--divergence-reason", value, "Exact CLI body\n")
        agent.do_post()
        receipt = json.loads((directory / "cli-corrected.receipt.json").read_text())
        mid = self.committed(receipt)["message_id"]
        self.assertEqual(self.store.view("owner", "dossier_cover", {"message_id": mid})["cover"]["stands"], value)
        agent.options = options("reply", mid, "--operation", "cli-reply",
            "--quote-revision", "1", "--quote-start", "0", "--quote-end", "5", "Exact CLI reply")
        agent.do_reply()
        reply = json.loads((directory / "cli-reply.receipt.json").read_text())
        self.assertEqual(self.sql("SELECT reply_to FROM messages WHERE id=?", (reply["result"]["message_id"],)), [(mid,)])
        self.assertEqual(len(self.covers()), 1)

    def test_http_command_adapter_passes_shared_refusal_without_listener(self):
        from types import SimpleNamespace
        from aim_next.server import Handler
        handler = Handler.__new__(Handler)
        handler.path = "/api/command"
        handler.server = SimpleNamespace(actor="agent-a")
        handler._authorize = lambda **kwargs: None
        handler._body = lambda: self.envelope("message.post", {"topic_id": "t1"}, {"body": "HTTP root"}, op="http-refusal")
        handler._store_call = lambda act, **kwargs: act(self.store)
        response = []
        handler._json_response = lambda status, value: response.append((status, value))
        handler._post()
        status, receipt = response.pop()
        self.assertEqual(status, 200)
        self.rejected(receipt, "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual(receipt, self.store.view("agent-a", "operation", {"operation_id": "http-refusal"}))

    def test_prepared_destination_revision_and_source_fences_remain(self):
        self.committed(self.save_agent("New direction"))
        self.rejected(self.prepare_agent(revision=0), "REVISION_CONFLICT")
        self.committed(self.prepare_agent())
        self.rejected(self.send_agent(topic="different-topic"), "OPERATION_PAYLOAD_MISMATCH")
        self.committed(self.send_agent())
        # A new private generation cannot change the source of existing writing.
        ref = {"kind": "message", "id": self.root()}
        revision = self.sql("SELECT revision FROM drafts WHERE actor_id='agent-a'")[0][0]
        self.rejected(self.save_agent("Retained reason", ref=ref, revision=revision), "REVISION_CONFLICT")

    def test_initial_agent_opening_is_allowed_without_existing_dossier(self):
        self.committed(self.command("opening.save", {"workspace_id": "w1", "topic_id": "agent-topic", "title": "Synthetic agent opening",
                       "body": "Opening words", "participants": [], "attachments": []}, target={"opening_id": "agent-opening"},
                       expected={"opening_revision": 0}, actor="agent-a"))
        receipt = self.command("opening.publish", {}, target={"opening_id": "agent-opening"},
                               expected={"opening_revision": 1}, actor="agent-a")
        self.committed(receipt)
        self.assertEqual(self.covers(), [])

    def test_initial_reason_keeps_cover_root_fence_after_join(self):
        mid = self.committed(self.post(divergence_reason="Separate direction"))["message_id"]
        self.committed(self.command("stack.join", {"into": self.root()}, target={"message_id": mid},
                                    expected={"join_revision": 0}, actor="agent-a"))
        self.rejected(self.command("stack.cover", {"stands": "Overwrite from stale root"}, target={"message_id": mid},
                                   expected={"cover_revision": 1}, actor="agent-a"), "STACK_CHANGED")
        self.assertEqual(json.loads(self.covers()[0][2])["stands"], "Separate direction")

    def test_reason_only_writing_keeps_selected_notebook_revision(self):
        self.committed(self.memory(body="First selected revision"))
        ref = self.memory_ref()
        args = {"source_ref": ref, "topic_id": "t1", "generation": "reason-only", "body": "",
                "divergence_reason": "Caller has begun a different line of thought"}
        self.committed(self.command("draft.save", args, target={"draft_id": "reason-only"},
                                    expected={"draft_revision": 0}, actor="agent-a"))
        self.committed(self.memory(body="Second revision", revision=1))
        before = self.sql("SELECT payload FROM drafts WHERE id='reason-only'")
        args["source_ref"] = self.memory_ref(revision=2)
        self.rejected(self.command("draft.save", args, target={"draft_id": "reason-only"},
                                  expected={"draft_revision": 1}, actor="agent-a"), "REVISION_CONFLICT")
        self.assertEqual(self.sql("SELECT payload FROM drafts WHERE id='reason-only'"), before)

    def test_shared_root_fixture_authors_fixed_reason_but_explicit_missing_reason_stays_refused(self):
        args = {"body": "A separate synthetic fixture root"}
        sent = self.command("message.post", args, target={"topic_id": "t1"}, actor="agent-a", op="fixture-root")
        mid = self.committed(sent)["message_id"]
        self.assertEqual(args, {"body": "A separate synthetic fixture root"}, "fixture must not mutate caller arguments")
        cover = self.store.view("owner", "dossier_cover", {"message_id": mid})["cover"]
        self.assertEqual((cover["stands"], cover["waiting"], cover["payload"]),
                         ("Separate synthetic fixture investigation", [], None))
        self.assertEqual(self.command("message.post", args, target={"topic_id": "t1"}, actor="agent-a", op="fixture-root"), sent)
        before = self.public_state()
        missing = dict(args, divergence_reason=None)
        refused = self.command("message.post", missing, target={"topic_id": "t1"}, actor="agent-a", op="fixture-missing")
        self.rejected(refused, "DIVERGENCE_REASON_REQUIRED")
        self.assertEqual(self.public_state(), before)
        self.assertEqual(self.command("message.post", missing, target={"topic_id": "t1"}, actor="agent-a", op="fixture-missing"), refused)
        self.rejected(self.command("message.post", args, target={"topic_id": "t1"}, actor="agent-a", op="fixture-missing"), "OPERATION_PAYLOAD_MISMATCH")
        self.rejected(self.command("message.post", args, target={"topic_id": "t1"}, actor="outsider"), "FORBIDDEN")
        self.assertEqual(self.public_state(), before)

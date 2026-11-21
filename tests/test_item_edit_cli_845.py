from __future__ import annotations

"""Item 845: real member edits, revision fences and durable CLI outcomes."""

import json
import os
from pathlib import Path
import subprocess
import sys
from unittest import mock

from aim_next import Store
from aim_next.contract import LIMITS, StoreError
from test_agent_verbs import AgentVerbCase


ROOT = Path(__file__).resolve().parents[1]


class ItemEditCLICase(AgentVerbCase):
    def setUp(self):
        super().setUp()
        self.committed(self.command("pipeline.configure", {"enabled": True},
                                    target={"workspace_id": "w1"}, expected={"pipeline_revision": 0}))
        for title in ("Original item", "Other item"):
            self.committed(self.command("pipeline.item_add", {
                "title": title, "description": "Original words", "size": "small",
                "candidate_group": "Original group", "section": "candidates",
                "sources": [{"note": "Isolated CLI fixture"}],
            }, target={"workspace_id": "w1"}))
        self.target = {"workspace_id": "w1", "number": 1}

    def item(self, number=1):
        return self.store.view("owner", "pipeline_item", dict(self.target, number=number))["item"]

    def edit(self, *args, **kwargs):
        return self.run_cli("item-edit", "w1", "1", *args, actor="agent-b", **kwargs)

    def requests(self):
        return [json.loads((self.outbox("agent-b") / name).read_text())
                for name in self.saved("agent-b") if name.endswith(".request.json")]

    def test_real_cli_member_edits_all_fields_and_prints_durable_readback(self):
        words = "  Literal 🪴 words\n\n`code` and $(not-a-command)  \n"
        path = Path(self.temp.name) / "words.txt"
        path.write_text(words, encoding="utf-8")
        before, other = self.item(), self.item(2)
        prefix = os.environ.get("PYTHONPYCACHEPREFIX")
        interpreter = [sys.executable, "-I"] + (["-X", "pycache_prefix=" + prefix] if prefix else [])
        ran = subprocess.run(interpreter + [str(ROOT / "bin/aim-next"),
            "--profile", str(self.profiles["agent-b"]), "item-edit", "w1", "1",
            "--title", "Corrected item", "--size", "medium", "--group", "New group",
            "--words", str(path)], capture_output=True, timeout=30)
        self.assertEqual(ran.returncode, 0, ran.stderr.decode())
        self.assertEqual(ran.stderr, b"")
        after = self.item()
        self.assertEqual([after[k] for k in ("title", "description", "size", "candidate_group")],
                         ["Corrected item", words, "medium", "New group"])
        self.assertEqual(after["version"], before["version"] + 1)
        self.assertEqual(after["section"], before["section"])
        self.assertEqual(after["raised_by"], before["raised_by"])
        self.assertEqual(self.item(2), other)
        edits = [event for event in after["events"] if event["kind"] == "edited"]
        self.assertEqual([event["by"] for event in edits], ["agent-b"])
        code, out, err = self.run_cli("item", "w1", "1", actor="agent-b")
        self.assertEqual((code, err, ran.stdout.decode()), (0, "", out))
        # The ordinary item printer escapes control characters for terminal safety.
        self.assertIn(words.replace("\n", r"\x0a"), out)

    def test_stdin_changes_only_words_and_empty_file_clears_fields(self):
        before = self.item()
        words = "First\n  literal café\nLast"
        self.assertEqual(self.edit("--words", "-", stdin=words.encode())[0], 0)
        after = self.item()
        self.assertEqual(after["description"], words)
        for key in ("title", "size", "candidate_group", "section", "raised_by"):
            self.assertEqual(after[key], before[key])
        path = Path(self.temp.name) / "empty.txt"
        path.write_bytes(b"")
        code, out, err = self.edit("--words", str(path), "--size", "none", "--group", "")
        self.assertEqual((code, err), (0, ""), out)
        self.assertEqual([self.item()[k] for k in ("description", "size", "candidate_group")], ["", None, ""])

    def test_json_has_committed_receipt_then_named_readback(self):
        code, out, err = self.run_cli("--json", "item-edit", "w1", "1", "--title", "JSON edit", actor="agent-b")
        self.assertEqual((code, err), (0, ""))
        rows = [json.loads(line) for line in out.splitlines()]
        self.assertEqual(rows[0]["item"]["title"], "Original item")
        self.assertEqual((rows[1]["kind"], rows[1]["status"], rows[1]["recorded"]),
                         ("pipeline.item_edit", "committed", True))
        self.assertEqual(rows[2]["item"], self.item())

    def test_readback_prints_current_record_instead_of_echoing_submitted_title(self):
        original = Store.command
        def later_edit(store, actor, envelope):
            result = original(store, actor, envelope)
            if actor == "agent-b" and envelope["kind"] == "pipeline.item_edit":
                later = self.envelope("pipeline.item_edit", self.target, {"title": "Later durable title"},
                                      {"item_revision": self.item()["version"]})
                self.committed(original(self.store, "owner", later))
            return result
        with mock.patch.object(Store, "command", later_edit):
            code, out, err = self.edit("--title", "Submitted title")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Later durable title", out)
        self.assertNotIn("Submitted title", out)

    def test_no_options_and_bad_words_never_save_a_request(self):
        before = self.item()
        directory = Path(self.temp.name)
        bad = directory / "bad-utf8.txt"
        bad.write_bytes(b"\xff")
        large = directory / "too-large.txt"
        large.write_bytes(b"x" * (LIMITS["body_utf8_bytes"] + 1))
        cases = [((), b""), (("--words", str(directory / "absent")), b""),
                 (("--words", str(directory)), b""), (("--words", str(bad)), b""),
                 (("--words", str(large)), b""), (("--words", "-"), b"\xff"),
                 (("--words", "-"), b"x" * (LIMITS["body_utf8_bytes"] + 1))]
        for args, words in cases:
            with self.subTest(args=args, bytes=len(words)):
                self.assertEqual(self.edit(*args, stdin=words)[0], 2)
                self.assertEqual(self.requests(), [])
                self.assertEqual(self.item(), before)

    def test_nonmember_cannot_edit_and_member_cannot_move_or_reattribute(self):
        before = self.item()
        code, out, err = self.run_cli("item-edit", "w1", "1", "--title", "Outside", actor="outsider")
        self.assertEqual(code, 2)
        self.assertEqual(self.saved("outsider"), [])
        self.assertEqual(self.item(), before)
        code, out, err = self.run_cli("move", "w1", "1", "--to", "now", actor="agent-b")
        self.assertEqual(code, 2)
        self.assertIn("FORBIDDEN", err)
        self.rejected(self.command("pipeline.item_edit", {"raised_by": "agent-b"}, target=self.target,
                                   expected={"item_revision": before["version"]}, actor="agent-b"), "FORBIDDEN")
        self.assertEqual(self.item(), before)

    def test_core_text_limits_refuse_without_replacing_the_item(self):
        words = "é" * 8192  # Core's existing 16,384-byte words boundary.
        self.assertEqual(self.edit("--words", "-", stdin=words.encode())[0], 0)
        before = self.item()
        for args, stdin in ((("--words", "-"), (words + "x").encode()), (("--title", "  "), b"")):
            with self.subTest(args=args):
                code, out, err = self.edit(*args, stdin=stdin)
                self.assertEqual(code, 2)
                self.assertIn("INVALID_ARGUMENT", err)
                self.assertEqual(self.item(), before)

    def test_reads_current_revision_after_an_earlier_edit(self):
        self.committed(self.command("pipeline.item_edit", {"description": "Earlier change"}, target=self.target,
                                    expected={"item_revision": self.item()["version"]}))
        revision = self.item()["version"]
        self.assertGreater(revision, 1)
        code, out, err = self.edit("--title", "Later change")
        self.assertEqual((code, err), (0, ""), out)
        self.assertEqual(self.item()["description"], "Earlier change")
        self.assertEqual(self.item()["version"], revision + 1)
        self.assertEqual(self.requests()[0]["command"]["expected"]["item_revision"], revision)

    def test_concurrent_edit_is_refused_without_overwriting_or_retrying(self):
        original = Store.command
        sent = []
        def race(store, actor, envelope):
            if actor == "agent-b" and envelope["kind"] == "pipeline.item_edit":
                sent.append(envelope)
                competing = self.envelope("pipeline.item_edit", self.target, {"title": "Concurrent title"},
                                          {"item_revision": self.item()["version"]})
                self.committed(original(self.store, "owner", competing))
            return original(store, actor, envelope)
        with mock.patch.object(Store, "command", race):
            code, out, err = self.edit("--title", "Stale title")
        self.assertEqual(code, 2)
        self.assertIn("REVISION_CONFLICT", err)
        self.assertEqual(len(sent), 1)
        self.assertEqual(self.item()["title"], "Concurrent title")
        self.assertEqual(len([e for e in self.item()["events"] if e["kind"] == "edited"]), 1)

    def test_committed_edit_with_failed_readback_is_not_reported_as_unsent(self):
        original = Store.view
        for failure in (StoreError("lost"), {"error": {"code": "DATABASE_BUSY", "message": "Busy", "retryable": True}}):
            with self.subTest(failure=type(failure).__name__):
                calls = []
                def view(store, actor, name, args):
                    if actor == "agent-b" and name == "pipeline_item":
                        calls.append(name)
                        if len(calls) == 2:
                            if isinstance(failure, Exception):
                                raise failure
                            return failure
                    return original(store, actor, name, args)
                before = self.item()["version"]
                with mock.patch.object(Store, "view", view):
                    code, out, err = self.edit("--title", "Recorded edit")
                self.assertEqual((code, out), (1, ""))
                self.assertIn("READ_BACK_UNCONFIRMED", err)
                self.assertIn("pipeline.item_edit", err)
                self.assertIn("item w1 1", err)
                self.assertIn("do not send", err)
                self.assertEqual(self.item()["title"], "Recorded edit")
                self.assertEqual(self.item()["version"], before + 1)

    def test_unknown_receipt_retry_keeps_one_edit_and_original_words(self):
        original = Store.command
        def uncertain(store, actor, envelope):
            result = original(store, actor, envelope)
            if envelope["kind"] == "pipeline.item_edit":
                self.assertEqual(result["status"], "committed")
                raise StoreError("lost receipt")
            return result
        before = self.item()["version"]
        with mock.patch.object(Store, "command", uncertain):
            code, out, err = self.edit("--words", "-", stdin=b"Exactly once")
        self.assertEqual((code, out), (1, ""))
        [request] = self.requests()
        operation = request["command"]["operation_id"]
        self.assertIn("retry " + operation, err)
        code, out, err = self.run_cli("retry", operation, actor="agent-b")
        self.assertEqual((code, err), (0, ""), out)
        self.assertEqual(self.item()["description"], "Exactly once")
        self.assertEqual(self.item()["version"], before + 1)
        self.assertEqual(len([e for e in self.item()["events"] if e["kind"] == "edited"]), 1)

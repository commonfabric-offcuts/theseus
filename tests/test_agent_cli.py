from __future__ import annotations

"""Standalone local-agent contract, with temporary profiles and records only."""

import copy
import hashlib
import importlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import unittest
from unittest import mock

from aim_next import Store, initialize
from aim_next.contract import LIMITS
from aim_next.profile import load_profile, write_profile
import reader_fixture as fixtures


class AgentCLIBase(fixtures.ReaderCase):
    def setUp(self):
        super().setUp()
        self.profiles = {}
        for actor in ("agent-a", "agent-b", "outsider"):
            path = Path(self.temp.name).resolve() / (actor + ".json")
            write_profile(path, str(self.path.resolve()), "test-instance", actor,
                          binding=self.binding)
            self.profiles[actor] = path
        self.captured = self.captured_for("agent-a")

    def captured_for(self, actor):
        return {"instance_id": "test-instance", "actor_id": actor,
                "db_path": str(self.path.resolve()), "authority_id": self.pin["authority_id"],
                "authority_epoch": self.pin["authority_epoch"]}

    def request(self, verb, value, binding=None):
        return {"v": 1, "binding": dict(self.captured if binding is None else binding), verb: value}

    def invoke(self, verb, value=None, *, binding=None, actor="agent-a", raw=None,
               source=None, output=None, request_path=None, extra=()):
        # Explicit absence assertion produces a meaningful missing-feature red;
        # fixture initialization and health are checked independently below.
        self.assertIsNotNone(importlib.util.find_spec("aim_next.cli"), "Standalone CLI is missing")
        cli = importlib.import_module("aim_next.cli")
        if source is None:
            payload = raw if raw is not None else json.dumps(
                self.request(verb, value, binding), ensure_ascii=False).encode("utf-8")
            source = io.BytesIO(payload)
        stdout = output if output is not None else io.StringIO()
        stderr = io.StringIO()
        argv = ["--profile", str(self.profiles[actor])] + list(extra) + [verb]
        if verb != "binding":
            argv.append(str(request_path) if request_path is not None else "-")
        try:
            code = cli.main(argv, stdin=source, stdout=stdout, stderr=stderr)
        except SystemExit as error:
            code = error.code
        text = stdout.getvalue() if hasattr(stdout, "getvalue") else ""
        result = json.loads(text) if text else None
        return code, result, stderr.getvalue()

    def view_cli(self, name, args=None, **kwargs):
        return self.invoke("view", {"name": name, "args": args or {}}, **kwargs)

    def memory_command(self, operation="cli-memory", item="cli-item"):
        return self.envelope("memory.create", {"item_id": item,
            "owner_scope": {"kind": "workspace", "id": "w1"}},
            {"title": "CLI fixture", "body": "Literal agent work", "attachments": [], "references": []},
            {"item_revision": 0}, op=operation)

    def reply_commands(self, body=" Exact reply\n  @outsider $(literal) 'quoted' 🪴\n"):
        save = self.envelope("draft.save", {"draft_id": "cli-reply"}, {
            "source_ref": self.opening, "topic_id": "t1", "generation": "original-generation",
            "body": body, "attachments": [], "quotes": [{"source": self.opening, "excerpt": "Opening message"}],
            "addressees": ["owner"], "reply_to": self.opening["id"]},
            {"draft_revision": 0}, op="cli-save")
        prepare = self.envelope("submission.prepare", {"topic_id": "t1"}, {
            "draft_id": "cli-reply", "submission_id": "cli-frozen", "send_operation_id": "cli-send"},
            {"draft_revision": 1}, op="cli-prepare")
        send = self.envelope("message.send", {"topic_id": "t1"},
                             {"submission_id": "cli-frozen"}, op="cli-send")
        return save, prepare, send


class AgentCLIFixtureHealth(AgentCLIBase):
    def test_isolated_profiles_and_existing_store_contract_are_healthy(self):
        before = self.records()
        for actor, path in self.profiles.items():
            profile = load_profile(path)
            self.assertEqual(profile.actor_id, actor)
            self.assertEqual(profile.instance_id, "test-instance")
            self.assertEqual(profile.binding, self.binding)
        self.assertTrue(self.store.view("agent-a", "deliveries", {})["items"])
        self.assertEqual(self.store.view("agent-b", "deliveries", {})["items"], [])
        self.assertEqual(self.records(), before)


class AgentCLICase(AgentCLIBase):
    def test_binding_capture_is_read_only_and_never_reads_stdin(self):
        class NoInput:
            def read(self, *args):
                raise AssertionError("Binding capture must not consume stdin")
        before = self.records()
        code, result, _ = self.invoke("binding", source=NoInput())
        self.assertEqual(code, 0)
        self.assertEqual(result, {"v": 1, "binding": self.captured})
        self.assertEqual(self.records(), before)

    def test_populated_actor_binding_is_assertion_not_an_override(self):
        # Both agents are legitimate workspace Notebook authors: a missing
        # adapter comparison cannot be masked by a downstream permission gate.
        before = self.records()
        command = self.memory_command()
        code, result, _ = self.invoke("command", command, actor="agent-b")
        self.assertEqual(code, 2)
        self.assertEqual(result["error"]["code"], "BINDING_MISMATCH")
        self.assertFalse(result["recorded"])
        self.assertEqual(self.records(), before)
        code, result, _ = self.invoke("command", command, actor="agent-b",
                                      binding=self.captured_for("agent-b"))
        self.assertEqual(code, 0)
        self.committed(result)
        self.assertEqual(self.source({"kind": "memory", "id": "cli-item", "revision": 1})["author"], "agent-b")

    def test_replaced_profile_cannot_change_actor_of_retained_request(self):
        request = self.request("command", self.memory_command())
        original = self.profiles["agent-a"]
        original.write_bytes(self.profiles["agent-b"].read_bytes())
        before = self.records()
        code, result, _ = self.invoke("command", raw=json.dumps(request).encode("utf-8"))
        self.assertEqual((code, result["error"]["code"]), (2, "BINDING_MISMATCH"))
        self.assertEqual(self.records(), before)

    def test_other_populated_instance_cannot_receive_original_request(self):
        root = Path(self.temp.name).resolve() / "second"
        root.mkdir(mode=0o700)
        other_path = root / "other.sqlite3"
        other = initialize(other_path, "other-instance", [{"id": "agent-a", "kind": "agent"}],
                           authority_path=root / "authority.json")
        other_store = Store(other_path, "other-instance", expected_binding=other["binding"])
        pin = {key: other["binding"][key] for key in ("authority_id", "authority_epoch")}
        self.committed(other_store.command("agent-a", {"v": 1, "instance_id": "other-instance",
            "operation_id": "other-workspace", "kind": "workspace.create", "target": {},
            "expected": {"authority": pin}, "args": {"id": "w1", "title": "Populated other"}}))
        other_profile = root / "agent.json"
        write_profile(other_profile, str(other_path), "other-instance", "agent-a", binding=other["binding"])
        self.profiles["agent-a"] = other_profile
        before = other_path.read_bytes()
        code, result, _ = self.invoke("view", {"name": "workspace", "args": {"workspace_id": "w1"}})
        self.assertEqual((code, result["error"]["code"]), (2, "BINDING_MISMATCH"))
        self.assertEqual(other_path.read_bytes(), before)

    def test_every_captured_field_is_checked_exactly_before_dispatch(self):
        for key in self.captured:
            binding = dict(self.captured)
            binding[key] += "-different"
            with self.subTest(field=key):
                before = self.records()
                code, result, _ = self.view_cli("capabilities", binding=binding)
                self.assertEqual((code, result.get("error", {}).get("code")), (2, "BINDING_MISMATCH"))
                self.assertEqual(self.records(), before)

    def test_real_claim_binding_passes_unchanged_through_symlinked_database_directory(self):
        root = Path(self.temp.name).resolve()
        alias = root / "directory-alias"
        alias.symlink_to(self.path.parent.resolve(), target_is_directory=True)
        linked_db = alias / self.path.name
        profile_path = root / "claim-profile.json"
        write_profile(profile_path, str(linked_db), "test-instance", "agent-a", binding=self.binding)
        self.profiles["agent-a"] = profile_path
        claim_store = Store(linked_db, "test-instance", expected_binding=self.binding)
        with claim_store.runner_guard("cli-fixture-runner") as guard:
            owner = claim_store.acquire_runner(guard)
            self.assertEqual(owner["status"], "acquired")
            claims = claim_store.claim_wakes(guard, owner["runner_token"], limit=1)
            self.assertEqual(claims["status"], "ok")
            self.assertEqual(len(claims["claims"]), 1)
            binding = claims["claims"][0]["route_binding"]
            self.assertEqual(binding["actor_id"], "agent-a")
            self.assertEqual(binding["db_path"], str(self.path.resolve()))
            captured_bytes = json.dumps(binding, separators=(",", ":")).encode("utf-8")
            before = self.records()
            code, page, _ = self.view_cli("deliveries", {"limit": 1}, binding=binding)
            self.assertEqual(code, 0)
            self.assertTrue(page["items"])
            self.assertEqual(json.dumps(binding, separators=(",", ":")).encode("utf-8"), captured_bytes)
            self.assertEqual(self.records(), before)

    def test_current_wrapper_never_fills_or_refreshes_inner_command_pin(self):
        for pin in (None, dict(self.pin, authority_epoch="old-epoch")):
            act = self.memory_command()
            if pin is None:
                act["expected"].pop("authority")
            else:
                act["expected"]["authority"] = pin
            before = self.records()
            code, result, _ = self.invoke("command", act)
            self.assertEqual(code, 2)
            self.assertFalse(result["recorded"])
            self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT" if pin is None else "AUTHORITY_CHANGED")
            self.assertEqual(self.records(), before)

    def test_delivery_pages_and_exact_source_reads_never_ack_or_wake(self):
        self.send("Second pending", addressees=["agent-a"])
        before = self.records()
        with mock.patch("socket.socket", side_effect=AssertionError("CLI must not use a server")), \
                mock.patch.object(Store, "runner_guard", side_effect=AssertionError("Read cannot start a runner")):
            code, first, _ = self.view_cli("deliveries", {"limit": 1})
            self.assertEqual(code, 0)
            self.assertEqual(len(first["items"]), 1)
            self.assertIsInstance(first["next_cursor"], str)
            code, second, _ = self.view_cli("deliveries", {"limit": 1, "cursor": first["next_cursor"]})
            self.assertEqual(code, 0)
            self.assertEqual(len(second["items"]), 1)
            self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
            ref = first["items"][0]["source_ref"]
            code, source, _ = self.view_cli("source", {"source_ref": ref})
            self.assertEqual(code, 0)
            self.assertEqual(source, self.source(ref, actor="agent-a"))
        self.assertEqual(self.records(), before)

    def test_addressed_source_does_not_grant_topic_history(self):
        sent = self.send("Only this source", addressees=["outsider"])
        kwargs = {"actor": "outsider", "binding": self.captured_for("outsider")}
        code, source, _ = self.view_cli("source", {"source_ref": {"kind": "message", "id": sent["id"]}}, **kwargs)
        self.assertEqual(code, 0)
        self.assertEqual(source["body"], "Only this source")
        code, result, _ = self.view_cli("topic_messages", {"topic_id": "t1"}, **kwargs)
        self.assertEqual((code, result["error"]["code"]), (2, "FORBIDDEN"))

    def test_notebook_revision_forwarding_retains_old_words_quote_and_private_note(self):
        self.committed(self.memory(body="Exact old @outsider words"))
        old_ref = self.memory_ref()
        self.committed(self.memory(revision=1, body="Changed revision two"))
        code, source, _ = self.view_cli("source", {"source_ref": old_ref})
        self.assertEqual(code, 0)
        self.assertEqual(source["source_ref"], old_ref)
        self.assertEqual(source["body"], "Exact old @outsider words")
        self.assertEqual(source["current_revision"], 2)
        act = self.envelope("note.save", {"note_id": "cli-note"},
                            {"source_ref": old_ref, "body": "Keep revision one"}, {"note_revision": 0})
        code, result, _ = self.invoke("command", act)
        self.assertEqual(code, 0)
        self.committed(result)
        _, editor, _ = self.view_cli("editor_state", {"source_ref": self.memory_ref(revision=2)})
        self.assertEqual(editor["note"]["source_ref"], old_ref)
        self.assertEqual(editor["note"]["body"], "Keep revision one")
        save, prepare, send = self.reply_commands()
        save["args"]["source_ref"] = old_ref
        save["args"]["quotes"] = [{"source": old_ref, "excerpt": "Exact old @outsider words"}]
        for act in (save, prepare, send):
            code, receipt, _ = self.invoke("command", act)
            self.assertEqual(code, 0)
            self.committed(receipt)
        sent = self.source({"kind": "message", "id": receipt["result"]["message_id"]})
        self.assertEqual(sent["quotes"], save["args"]["quotes"])
        self.assertEqual(sent["addressees"], ["owner"])

    def test_explicit_reply_is_literal_once_and_newer_private_draft_survives(self):
        before_pending = self.store.view("agent-a", "deliveries", {})
        save, prepare, send = self.reply_commands()
        for act in (save, prepare):
            code, receipt, _ = self.invoke("command", act)
            self.assertEqual(code, 0)
            self.committed(receipt)
        successor = receipt["result"]["next_draft"]
        saved_b = self.envelope("draft.save", {"draft_id": "cli-reply"}, {
            "source_ref": self.opening, "topic_id": "t1", "generation": successor["generation"],
            "body": "Newer private B", "attachments": [], "quotes": [], "addressees": []},
            {"draft_revision": successor["revision"]}, op="cli-save-b")
        self.assertEqual(self.invoke("command", saved_b)[0], 0)
        code, receipt, _ = self.invoke("command", send)
        self.assertEqual(code, 0)
        result = self.committed(receipt)
        self.assertEqual(self.invoke("command", send)[:2], (0, receipt))
        source = self.source({"kind": "message", "id": result["message_id"]})
        self.assertEqual(source["author"], "agent-a")
        self.assertEqual(source["body"], save["args"]["body"])
        self.assertEqual(source["quotes"], save["args"]["quotes"])
        self.assertEqual(source["addressees"], ["owner"])
        self.assertEqual(source["reply_to"], self.opening["id"])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE operation_id='cli-send'"), [(1,)])
        self.assertEqual(self.store.view("agent-a", "deliveries", {}), before_pending)
        _, editor, _ = self.view_cli("editor_state", {"source_ref": self.opening, "topic_id": "t1"})
        self.assertEqual(editor["draft"]["body"], "Newer private B")
        self.assertEqual(editor["draft"]["generation"], successor["generation"])

    def test_ack_is_separate_exact_identity_and_duplicate_is_same_receipt(self):
        pending = self.store.view("agent-a", "deliveries", {})["items"][0]
        messages = self.sql("SELECT * FROM messages")
        topics = self.sql("SELECT * FROM topics")
        act = self.envelope("delivery.ack", {"delivery_id": pending["id"]}, {}, op="cli-ack")
        code, receipt, _ = self.invoke("command", act)
        self.assertEqual(code, 0)
        self.assertTrue(receipt["result"]["acknowledged"])
        self.assertEqual(self.invoke("command", act)[:2], (0, receipt))
        self.assertEqual(self.sql("SELECT * FROM messages"), messages)
        self.assertEqual(self.sql("SELECT * FROM topics"), topics)
        self.assertEqual(self.view_cli("deliveries")[1]["items"], [])

    def test_unknown_lookup_and_recorded_refusal_keep_distinct_truth(self):
        code, result, _ = self.view_cli("operation", {"operation_id": "absent"})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "unknown")
        self.assertFalse(result["recorded"])
        act = self.envelope("workspace.create", {},
                            {"id": "refused-workspace", "title": "No", "team": ["missing"]}, op="cli-refused")
        code, receipt, _ = self.invoke("command", act)
        self.assertEqual(code, 2)
        self.assertTrue(receipt["recorded"])
        self.assertEqual(receipt["error"]["code"], "INVALID_RECIPIENT")
        self.assertEqual(self.view_cli("operation", {"operation_id": "cli-refused"})[:2], (0, receipt))

    def test_changed_retry_cannot_replace_the_original_operation_result(self):
        act = self.memory_command()
        code, original, _ = self.invoke("command", act)
        self.assertEqual(code, 0)
        changed = copy.deepcopy(act)
        changed["args"]["body"] = "Different act under the same identity"
        code, refusal, _ = self.invoke("command", changed)
        self.assertEqual((code, refusal["error"]["code"]), (2, "OPERATION_PAYLOAD_MISMATCH"))
        self.assertFalse(refusal["recorded"])
        self.assertEqual(self.view_cli("operation", {"operation_id": act["operation_id"]})[1], original)

    def test_busy_attempt_preserves_original_id_for_deliberate_retry(self):
        act = self.memory_command()
        db = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            db.execute("BEGIN IMMEDIATE")
            code, result, _ = self.invoke("command", act)
            self.assertEqual(code, 75)
            self.assertFalse(result["recorded"])
            self.assertTrue(result["error"]["retryable"])
        finally:
            db.rollback()
            db.close()
        self.assertEqual(self.view_cli("operation", {"operation_id": act["operation_id"]})[1]["status"], "unknown")
        code, receipt, _ = self.invoke("command", act)
        self.assertEqual(code, 0)
        self.assertEqual(receipt["operation_id"], act["operation_id"])

    def test_lost_output_is_unconfirmed_and_reconciles_original_committed_act(self):
        class BrokenOutput:
            calls = 0
            def write(self, value):
                self.calls += 1
                raise BrokenPipeError("Owned fixture output closed")
            def flush(self):
                pass
        act = self.memory_command()
        output = BrokenOutput()
        code, result, error = self.invoke("command", act, output=output)
        self.assertEqual(code, 1)
        self.assertIsNone(result)
        self.assertEqual(output.calls, 1, "Do not manufacture a second stdout verdict")
        self.assertIn("CLI_OUTPUT_UNCONFIRMED", error)
        original = self.store.view("agent-a", "operation", {"operation_id": act["operation_id"]})
        self.committed(original)
        self.assertEqual(self.invoke("command", act)[:2], (0, original))
        self.assertEqual(self.sql("SELECT count(*) FROM memory_revisions WHERE item_id='cli-item'"), [(1,)])

        class FlushFailure(io.StringIO):
            def __init__(self):
                super().__init__()
                self.flush_calls = 0
            def flush(self):
                self.flush_calls += 1
                raise BrokenPipeError("Owned fixture flush failed")
        output = FlushFailure()
        second = self.memory_command(operation="flush-commit", item="flush-item")
        code, result, error = self.invoke("command", second, output=output)
        self.assertEqual(code, 1)
        self.assertEqual(output.flush_calls, 1)
        self.assertIn("CLI_OUTPUT_UNCONFIRMED", error)
        original = self.store.view("agent-a", "operation", {"operation_id": "flush-commit"})
        self.committed(original)
        self.assertEqual(result, original)  # Exactly one attempted JSON value.
        self.assertEqual(self.invoke("command", second)[:2], (0, original))

    def test_cancelled_input_does_not_ack_save_or_send(self):
        class CancelledInput:
            def read(self, count):
                raise KeyboardInterrupt()
        before = self.records()
        code, _, _ = self.invoke("command", source=CancelledInput())
        self.assertEqual(code, 130)
        self.assertEqual(self.records(), before)

    def test_launcher_closed_stdout_is_unconfirmed_after_commit(self):
        root = Path(fixtures.__file__).resolve().parents[1]
        launcher = root / "bin" / "aim-next"
        act = self.memory_command(operation="closed-pipe", item="closed-pipe")
        payload = json.dumps(self.request("command", act)).encode()
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        try:
            process = subprocess.run(["/usr/bin/python3", str(launcher), "--profile",
                str(self.profiles["agent-a"]), "command", "-"], input=payload, stdout=write_fd,
                stderr=subprocess.PIPE, timeout=5)
        finally:
            os.close(write_fd)
        self.assertEqual(process.returncode, 1, process.stderr.decode())
        self.assertIn(b"CLI_OUTPUT_UNCONFIRMED", process.stderr)
        self.assertNotIn(b"Exception ignored", process.stderr)
        original = self.store.view("agent-a", "operation", {"operation_id": "closed-pipe"})
        self.committed(original)
        self.assertEqual(self.invoke("command", act)[:2], (0, original))

    def test_duplicate_nonfinite_extra_and_actor_override_inputs_refuse(self):
        valid = self.request("command", self.memory_command())
        raw = json.dumps(valid, separators=(",", ":")).encode("utf-8")
        cases = [raw.replace(b'"v":1', b'"v":1,"v":1', 1), b'[]',
                 json.dumps(dict(valid, actor="agent-b")).encode("utf-8")]
        nonfinite = copy.deepcopy(valid)
        nonfinite["command"]["args"]["body"] = float("nan")
        cases.append(json.dumps(nonfinite).encode("utf-8"))
        missing = copy.deepcopy(valid)
        missing.pop("binding")
        cases.append(json.dumps(missing).encode("utf-8"))
        for payload in cases:
            with self.subTest(payload=payload[:50]):
                before = self.records()
                code, result, _ = self.invoke("command", raw=payload)
                self.assertEqual(code, 2)
                self.assertFalse(result["recorded"])
                self.assertEqual(self.records(), before)
        code, result, _ = self.view_cli("deliveries", {"actor_id": "agent-b"})
        self.assertEqual((code, result["error"]["code"]), (2, "INVALID_ARGUMENT"))

    def test_input_is_bounded_before_reading_or_parsing_all_bytes(self):
        cap = LIMITS["http_envelope_bytes"] + 8192
        class OverLimit:
            requests = []
            def read(self, count=-1):
                self.requests.append(count)
                return b" " * (cap + 1)
        source = OverLimit()
        before = self.records()
        code, result, _ = self.invoke("command", source=source)
        self.assertEqual(code, 2)
        self.assertFalse(result["recorded"])
        self.assertTrue(source.requests)
        self.assertTrue(all(0 < count <= cap + 1 for count in source.requests))
        self.assertEqual(self.records(), before)

        payload = json.dumps(self.request("view", {"name": "deliveries", "args": {"limit": 1}})).encode("utf-8")
        class FragmentedInput:
            def __init__(self, data, piece_size=7):
                self.data, self.position, self.requests = data, 0, []
                self.piece_size = piece_size
            def read(self, count=-1):
                self.requests.append(count)
                if count <= 0:
                    raise AssertionError("Input reads must be explicitly bounded")
                piece = self.data[self.position:self.position + min(self.piece_size, count)]
                self.position += len(piece)
                return piece
        valid = FragmentedInput(payload)
        code, page, _ = self.invoke("view", source=valid)
        self.assertEqual(code, 0)
        self.assertTrue(page["items"])
        self.assertGreater(len(valid.requests), 1)
        self.assertEqual(valid.position, len(payload))
        self.assertEqual(self.records(), before)

        over = FragmentedInput(b" " * (cap + 20), piece_size=4096)
        code, result, _ = self.invoke("command", source=over)
        self.assertEqual(code, 2)
        self.assertFalse(result["recorded"])
        self.assertLessEqual(over.position, cap + 1, "Cumulative input must stop at cap+1")
        self.assertEqual(self.records(), before)

    def test_invalid_selected_profile_never_falls_back_to_other_valid_profiles(self):
        original = self.profiles["agent-a"]
        invalid = original.with_name("invalid-selected.json")
        invalid.write_text('{"v":2,"v":2}')
        invalid.chmod(0o600)
        self.profiles["agent-a"] = invalid
        before = self.records()
        code, result, _ = self.invoke("command", self.memory_command())
        self.assertEqual(code, 2)
        self.assertFalse(result["recorded"])
        self.assertEqual(result["error"]["code"], "PROFILE_UNAVAILABLE")
        self.assertEqual(self.records(), before)

    def test_request_file_preserves_same_retained_act_as_stdin(self):
        act = self.memory_command()
        path = Path(self.temp.name) / "request.json"
        payload = json.dumps(self.request("command", act), ensure_ascii=False).encode("utf-8")
        path.write_bytes(payload)
        path.chmod(0o600)
        code, result, _ = self.invoke("command", request_path=path)
        self.assertEqual(code, 0)
        self.assertEqual(self.invoke("command", act)[:2], (0, result))
        self.assertEqual(path.read_bytes(), payload)

    def test_transport_shape_and_finite_utf8_refuse_before_dispatch(self):
        valid = self.request("command", self.memory_command())
        missing = copy.deepcopy(valid)
        missing["command"].pop("target")
        extra = copy.deepcopy(valid)
        extra["command"]["actor_id"] = "agent-b"
        cases = [b'\xff', b'{"number":1e999}', b'{"text":"\\ud800"}',
                 json.dumps(missing).encode(), json.dumps(extra).encode(),
                 json.dumps(dict(valid, v=True)).encode(),
                 json.dumps(self.request("view", {"name": "capabilities"})).encode()]
        for text in ('NaN', '1e999', '"\\ud800"'):
            malformed = copy.deepcopy(valid)
            malformed["command"]["args"]["body"] = "INVALID_JSON_TEXT"
            cases.append(json.dumps(malformed).replace('"INVALID_JSON_TEXT"', text).encode())
        before = self.records()
        for payload in cases:
            with self.subTest(payload=payload[:50]):
                code, result, _ = self.invoke("command", raw=payload)
                self.assertEqual((code, result["error"]["code"]), (2, "INVALID_REQUEST"))
                self.assertFalse(result["recorded"])
                self.assertEqual(self.records(), before)
        code, result, _ = self.invoke("view", request_path=Path(self.temp.name))
        self.assertEqual((code, result["error"]["code"]), (2, "INVALID_REQUEST"))

    def test_profile_is_loaded_once_before_input_and_keeps_established_actor(self):
        payload = json.dumps(self.request("command", self.memory_command())).encode()
        original = self.profiles["agent-a"]
        replacement = self.profiles["agent-b"].read_bytes()
        class ChangingInput(io.BytesIO):
            def read(self, count):
                original.write_bytes(replacement)
                return super().read(count)
        code, result, _ = self.invoke("command", source=ChangingInput(payload))
        self.assertEqual(code, 0)
        self.committed(result)
        self.assertEqual(self.source({"kind": "memory", "id": "cli-item", "revision": 1})["author"], "agent-a")

    def test_unknown_core_operations_and_json_media_keep_core_errors(self):
        code, result, _ = self.view_cli("no-such-view")
        self.assertEqual((code, result["error"]["code"]), (2, "UNKNOWN_VIEW"))
        command = self.envelope("no-such-command", {}, {}, op="unknown-kind")
        code, result, _ = self.invoke("command", command)
        self.assertEqual((code, result["error"]["code"]), (2, "UNKNOWN_COMMAND"))
        self.assertTrue(result["recorded"])
        self.committed(self.command("media.begin", {"name": "fixture.txt", "content_type": "text/plain",
            "size_bytes": 0, "sha256": hashlib.sha256(b"").hexdigest(), "publish_operation_id": "json-media"},
            target={"media_id": "json-media"}, expected={"media_revision": 0}, actor="agent-a"))
        command = self.envelope("media.publish", {"media_id": "json-media"}, {},
                                {"media_revision": 1}, op="json-media")
        code, result, _ = self.invoke("command", command)
        self.assertEqual((code, result["error"]["code"]), (2, "MEDIA_BYTES_REQUIRED"))

    def test_storage_or_interrupt_after_commit_preserves_uncertainty(self):
        from aim_next.contract import StoreError
        real_command = Store.command
        for error, expected_code, name in [(StoreError("fixture storage failure"), 1, "storage"),
                                          (KeyboardInterrupt(), 130, "interrupt")]:
            with self.subTest(name=name):
                act = self.memory_command(operation=name, item=name)
                def uncertain(store, actor, envelope):
                    real_command(store, actor, envelope)
                    raise error
                with mock.patch.object(Store, "command", uncertain):
                    code, result, diagnostic = self.invoke("command", act)
                self.assertEqual(code, expected_code)
                self.assertIsNone(result, "Uncertainty must not invent a recorded refusal")
                self.assertIn("reconcile", diagnostic.lower())
                committed = self.store.view("agent-a", "operation", {"operation_id": name})
                self.committed(committed)
                self.assertEqual(self.invoke("command", act)[:2], (0, committed))

    def test_typed_profile_error_keeps_code_and_retryability(self):
        from aim_next.profile import ProfileError
        self.assertIsNotNone(importlib.util.find_spec("aim_next.cli"), "Standalone CLI is missing")
        cli = importlib.import_module("aim_next.cli")
        before = self.records()
        with mock.patch.object(cli, "load_profile", side_effect=ProfileError(
                "Owned fixture authority busy", code="AUTHORITY_BUSY", retryable=True)):
            code, result, _ = self.invoke("binding")
        self.assertEqual((code, result["error"]["code"]), (75, "AUTHORITY_BUSY"))
        self.assertFalse(result["recorded"])
        self.assertTrue(result["error"]["retryable"])
        self.assertEqual(self.records(), before)

    def test_launcher_requires_profile_and_works_from_unrelated_directory_without_server(self):
        root = Path(fixtures.__file__).resolve().parents[1]
        launcher = root / "bin" / "aim-next"
        self.assertTrue(launcher.is_file(), "Standalone executable entry point is missing")
        (Path(self.temp.name) / "profile.json").write_bytes(self.profiles["agent-b"].read_bytes())
        env = dict(os.environ, AIM_NEXT_PROFILE=str(self.profiles["agent-b"]))
        before = self.records()
        missing = subprocess.run(["/usr/bin/python3", str(launcher), "binding"],
            cwd=self.temp.name, env=env, capture_output=True, timeout=5)
        self.assertEqual(missing.returncode, 2)
        self.assertFalse(missing.stdout)
        relative = subprocess.run(["/usr/bin/python3", str(launcher), "--profile", "agent-a.json", "binding"],
            cwd=self.temp.name, capture_output=True, timeout=5)
        self.assertEqual(relative.returncode, 2)
        self.assertFalse(relative.stdout)
        process = subprocess.run(["/usr/bin/python3", str(launcher), "--profile",
            str(self.profiles["agent-a"]), "binding"], cwd=self.temp.name,
            capture_output=True, timeout=5)
        self.assertEqual(process.returncode, 0, process.stderr.decode("utf-8"))
        self.assertEqual(json.loads(process.stdout), {"v": 1, "binding": self.captured})
        override = subprocess.run(["/usr/bin/python3", str(launcher), "--profile",
            str(self.profiles["agent-a"]), "--actor", "agent-b", "binding"],
            cwd=self.temp.name, capture_output=True, timeout=5)
        self.assertEqual(override.returncode, 2)
        self.assertEqual(self.records(), before)

    def test_worked_usage_block_runs_exact_local_agent_sequence(self):
        root = Path(fixtures.__file__).resolve().parents[1]
        documentation = root / "docs" / "agent-cli.md"
        self.assertTrue(documentation.is_file(), "Worked CLI usage is missing")
        blocks = re.findall(r"```python\n(.*?)\n```", documentation.read_text(), re.S)
        self.assertEqual(len(blocks), 1, "One actual worked example, no parallel fixture implementation")
        self.committed(self.memory(body="Selected revision one"))
        self.committed(self.memory(revision=1, body="New revision two"))
        selected = self.memory_ref()
        namespace = {}
        exec(compile(blocks[0], str(documentation), "exec"), namespace)
        output = namespace["agent_example"](root / "bin" / "aim-next", self.profiles["agent-a"],
            Path(self.temp.name) / "example-requests", selected, "doc-act", "Exact documented reply", ["owner"])
        self.assertTrue(output["exits"])
        self.assertTrue(all(code == 0 for code in output["exits"].values()), output["exits"])
        self.assertEqual(output["selected"]["source_ref"], selected)
        self.assertEqual(output["selected"]["body"], "Selected revision one")
        message = self.source({"kind": "message", "id": output["sent"]["result"]["message_id"]})
        self.assertEqual(message["author"], "agent-a")
        self.assertEqual(message["body"], "Exact documented reply")
        self.assertEqual(message["quotes"], [{"source": selected, "excerpt": "Selected revision one"}])
        self.assertEqual(message["addressees"], ["owner"])
        self.assertTrue(output["pending_before_ack"]["items"])
        self.assertEqual(output["ack"]["operation_id"], "doc-act-ack")
        self.assertEqual(output["sent"]["operation_id"], "doc-act-send")
        self.assertEqual(self.store.view("agent-a", "deliveries", {})["items"], [])


if __name__ == "__main__":
    unittest.main()

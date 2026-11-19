from __future__ import annotations

"""Focused Build/control checks, without a server, browser, profile or real store."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aim_next.web_build import load
from aim_next import Store, initialize

MODULE_PATH = ROOT / "tests/fixtures/reading_785_runtime.py"


def module_at(path):
    spec = importlib.util.spec_from_file_location("reading785_control", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def control(module, destination):
    Path(destination).mkdir(parents=True, exist_ok=True)
    candidate = load(ROOT / "web")
    original_csp = "default-src 'self';script-src 'self';img-src 'self';"
    server = SimpleNamespace(build=candidate, csp=original_csp)
    runtime = module.Reading785Runtime(server, destination, load)
    original_hashes = module.hashes(candidate)
    for phase, (name, old, new) in module.MUTATIONS.items():
        receipt = runtime.select(phase)
        assert not receipt["restored"] and receipt["stamp"] != candidate.stamp
        expected = candidate.files[name].replace(old.encode(), new.encode())
        assert server.build.files[name] == expected != candidate.files[name], "actual served mutant bytes"
        assert all(server.build.files[n] == data for n, data in candidate.files.items() if n != name), "unrelated Build bytes"
        assert ("/b/%s/app.mjs" % receipt["stamp"]).encode() in server.build.index, "generated page selects mutant Build"
        assert all(digest in server.csp for digest in server.build.script_hashes), "CSP binds generated Build"
        restored = runtime.select("restored")
        assert restored["hashes"] == original_hashes and server.build is candidate, "byte exact Build restoration"
        assert server.csp == original_csp, "CSP restoration"
        print({"phase": phase, "applied": receipt["hashes"][name], "restored": restored["hashes"][name],
               "stamp": receipt["stamp"], "control": True, "cache_prefix": sys.pycache_prefix}, flush=True)
    runtime.close()


class Reading785BuildCase(unittest.TestCase):
    def test_real_core_wrong_source_refusal_and_topic_commit_readback(self):
        # Execute the actual nested fixture helper without main(), HTTP or server.
        tree = ast.parse((ROOT / "tests/fixtures/ui_http.py").read_text())
        helper = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "agent_message")
        with tempfile.TemporaryDirectory(prefix="reading785-core-") as folder:
            path = Path(folder).resolve() / "isolated.sqlite3"
            instance, actor, sender = "reading785-core", "fixture-viewer", "fixture-outside"
            binding = initialize(path, instance, [{"id": actor, "kind": "human"},
                {"id": sender, "kind": "agent"}], authority_path=Path(folder).resolve() / "authority.json")["binding"]
            core = Store(path, instance, expected_binding=binding)
            commands = []

            def command(kind, operation, args, target=None, expected=None, sender=actor):
                envelope = {"v": 1, "instance_id": instance, "operation_id": operation, "kind": kind,
                    "target": target or {}, "expected": dict(expected or {}, authority={
                        k: binding[k] for k in ("authority_id", "authority_epoch")}), "args": args}
                answer = core.command(sender, envelope)
                self.assertEqual(answer["status"], "committed", answer)
                commands.append((sender, envelope, answer))
                return answer

            command("workspace.create", "workspace", {"id": "w1", "title": "Isolated", "team": []})
            source = {"kind": "new_topic", "id": "private-opening", "workspace_id": "w1"}
            command("draft.save", "seed-save", {"source_ref": source, "topic_id": "private-topic",
                "generation": "seed-generation", "body": "Private seed words", "opening": {
                    "workspace_id": "w1", "title": "Private source", "participants": []}},
                {"draft_id": "seed-draft"}, {"draft_revision": 0})
            command("submission.prepare", "seed-prepare", {"draft_id": "seed-draft", "submission_id": "seed-sub",
                "send_operation_id": "seed-send"}, {"topic_id": "private-topic"}, {"draft_revision": 1})
            seed = command("topic.create_and_send", "seed-send", {"submission_id": "seed-sub"}, {"topic_id": "private-topic"})
            command("draft.save", "topic-save", {"source_ref": {"kind": "new_topic", "id": "arrival-opening", "workspace_id": "w1"},
                "topic_id": "arrival-topic", "generation": "arrival-generation", "body": "Arrival topic seed", "opening": {
                    "workspace_id": "w1", "title": "Arrival", "participants": [sender]}},
                {"draft_id": "arrival-draft"}, {"draft_revision": 0})
            command("submission.prepare", "topic-prepare", {"draft_id": "arrival-draft", "submission_id": "arrival-sub",
                "send_operation_id": "topic-send"}, {"topic_id": "arrival-topic"}, {"draft_revision": 1})
            command("topic.create_and_send", "topic-send", {"submission_id": "arrival-sub"}, {"topic_id": "arrival-topic"})
            namespace = {"actor": actor, "store": lambda: core, "command": command,
                "sources": [{"kind": "message", "id": seed["result"]["message_id"]}],
                "published": lambda operation, attachments, sender: []}
            exec(compile(ast.Module(body=[helper], type_ignores=[]), "actual-fixture-agent-message", "exec"), namespace)
            request = {"operation_id": "outside-arrival", "topic_id": "arrival-topic", "sender": sender,
                "addressees": [actor], "body": "Exact outside words.\nSecond line."}
            before = len(commands)
            with self.assertRaisesRegex(AssertionError, "No readable source"):
                namespace["agent_message"](request)
            self.assertEqual(len(commands), before, "wrong-source refusal precedes any mutation")
            receipt = namespace["agent_message"](dict(request, source="topic"))
            self.assertEqual(receipt["status"], "committed")
            sender_id, envelope, answer = commands[-1]
            self.assertEqual(core.command(sender_id, envelope), answer, "same send operation is exactly once")
            rows = [r for r in core.view(actor, "topic_messages", {"topic_id": "arrival-topic", "direction": "before", "limit": 10})["items"] if r["author_id"] == sender]
            self.assertEqual([(r["id"], r["author_id"], r["body"]) for r in rows],
                [(receipt["result"]["message_id"], sender, request["body"])])
            print({"core785": "wrong source refused; topic committed; exact readback once; retry unchanged",
                "cache_prefix": sys.pycache_prefix}, flush=True)

    def test_build_controls(self):
        with tempfile.TemporaryDirectory(prefix="reading785-build-") as destination:
            control(module_at(MODULE_PATH), destination)

    def test_unrestored_runtime_refuses_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="reading785-close-") as destination:
            module = module_at(MODULE_PATH)
            server = SimpleNamespace(build=load(ROOT / "web"), csp="script-src 'self';")
            runtime = module.Reading785Runtime(server, destination, load)
            runtime.select("no-hold")
            with self.assertRaisesRegex(AssertionError, "not restored"):
                runtime.close()
            self.assertIs(server.build, runtime.candidate)

    def test_fixture_compiles(self):
        compile((ROOT / "tests/fixtures/ui_http.py").read_text(), "ui_http.py", "exec")


if __name__ == "__main__":
    # This narrow runner also verifies faults in the instrumentation itself. Each
    # invocation gets a separate effective CPython cache prefix from its caller.
    if len(sys.argv) == 2 and sys.argv[1] in ("mutant-write", "mutant-csp", "restored-write", "restored-csp"):
        phase = sys.argv.pop()
        original = MODULE_PATH.read_bytes()
        variant = original
        if phase == "mutant-write":
            old = b"path.write_bytes(changed if filename == name else data)"
            assert original.count(old) == 1
            variant = original.replace(old, b"path.write_bytes(data)")
        elif phase == "mutant-csp":
            old = b"self.server.build, self.server.csp = self.candidate, self.csp"
            assert original.count(old) == 1
            variant = original.replace(old, b"self.server.build = self.candidate")
        with tempfile.TemporaryDirectory(prefix="reading785-instrument-") as folder:
            path = Path(folder) / "runtime.py"
            path.write_bytes(variant)
            assert path.read_bytes() == variant
            print({"phase": phase, "original_sha256": hashlib.sha256(original).hexdigest(),
                   "applied_sha256": hashlib.sha256(variant).hexdigest(), "cache_prefix": sys.pycache_prefix}, flush=True)
            if phase.startswith("mutant"):
                assert variant != original
                try:
                    control(module_at(path), Path(folder) / "builds")
                except AssertionError as error:
                    expected = "copied public mutant changes Build stamp" if phase == "mutant-write" else "exact candidate Build and CSP restored"
                    assert str(error) == expected, (phase, str(error))
                    print({"caught": phase, "error": str(error)}, flush=True)
                else:
                    raise AssertionError("instrument mutant escaped")
                path.write_bytes(original)
                assert path.read_bytes() == original
                print({"byte_restored": hashlib.sha256(path.read_bytes()).hexdigest()}, flush=True)
            else:
                assert variant == original
                control(module_at(path), Path(folder) / "builds")
    else:
        unittest.main()

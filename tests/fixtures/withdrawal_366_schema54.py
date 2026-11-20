from __future__ import annotations

"""Seed/read a disposable store using the actual release146 source, in its own process."""

import json
from pathlib import Path
import sqlite3
import sys

source, root, mode = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
assert sys.flags.isolated and sys.pycache_prefix
assert root.is_dir() and root.name.startswith("fixture-")
sys.path[:0] = [str(source), str(source / "tests")]
from aim_next import Store, initialize
from aim_next.store import SCHEMA_VERSION
from aim_next.store import StoreOpenError
from reader_fixture import ReaderCase

assert SCHEMA_VERSION == "54", SCHEMA_VERSION
assert Path(sys.modules["aim_next"].__file__).resolve().is_relative_to(source)
case = ReaderCase()
case.path = root / "instance.sqlite3"
if mode == "seed":
    case.binding = initialize(case.path, "test-instance", [
        {"id": "owner", "kind": "human"}, {"id": "agent-a", "kind": "agent"},
        {"id": "agent-b", "kind": "agent"}], authority_path=root / "control" / "authority.json")["binding"]
else:
    case.binding = json.loads((root / "seed.json").read_text())["binding"]
case.pin = {key: case.binding[key] for key in ("authority_id", "authority_epoch")}
if mode == "newer":
    try:
        Store(case.path, "test-instance", expected_binding=case.binding)
    except StoreOpenError as refusal:
        assert refusal.code == "SCHEMA_MISMATCH", refusal.code
        with sqlite3.connect(str(case.path)) as db:
            print(json.dumps({"schema": db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0],
                              "messages": db.execute("SELECT count(*) FROM messages").fetchone()[0],
                              "mode": mode, "cache": sys.pycache_prefix,
                              "error": {"code": refusal.code, "message": str(refusal)}}))
        sys.exit(0)
    raise AssertionError("Actual schema54 source admitted the newer schema55 store")
case.store = Store(case.path, "test-instance", expected_binding=case.binding)
case.serial = 0
if mode == "seed":
    opening = case.create_topic()["id"]
    case.committed(case.command("stack.cover", {"stands": "Original schema54 cover", "waiting": [
        {"text": "Unrelated explicit wait", "default": "Keep"}]}, target={"message_id": opening},
        expected={"cover_revision": 0}, actor="agent-a"))
    asks = []
    for number in range(2):
        revision = case.store.view("owner", "dossier_cover", {"message_id": opening})["cover_revision"]
        asks.append(case.committed(case.command("message.post", {
            "body": "Existing schema54 question %d" % number, "reply_to": opening,
            "reply_without_quote": "About the complete synthetic opening", "intent": "ask", "go_ahead": False,
            "addressees": ["owner"], "ask_wait": {"root_id": opening, "cover_revision": revision,
            "questions": [{"actor_id": "owner", "text": "Question %d" % number, "options": [], "default": None,
                           "reason": "This synthetic question has no preset choices"}]}},
            target={"topic_id": "t1"}, actor="agent-a"))["message_id"])
    case.committed(case.command("message.post", {"body": "Private original words", "whisper": True,
        "addressees": ["agent-b"]}, target={"topic_id": "t1"}))
    (root / "seed.json").write_text(json.dumps({"binding": case.binding, "root": opening, "asks": asks}))
answer = case.store.view("owner", "topic_messages", {"topic_id": "t1"})
assert "error" not in answer and len(answer["items"]) == 4, answer
with sqlite3.connect(str(case.path)) as db:
    print(json.dumps({"schema": db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0],
                      "messages": db.execute("SELECT count(*) FROM messages").fetchone()[0],
                      "mode": mode, "cache": sys.pycache_prefix, "error": answer.get("error")}))

from __future__ import annotations

"""Seed/read only a disposable fixture using archived actual153/schema55 code."""

import json
from pathlib import Path
import sqlite3
import sys

source, root, mode = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
assert sys.flags.isolated and sys.pycache_prefix and sys.version_info[:2] == (3, 9)
assert root.is_dir() and root.name.startswith("fixture-")
sys.path[:0] = [str(source), str(source / "tests")]
from aim_next import Store, initialize
from aim_next.store import SCHEMA_VERSION, StoreOpenError
from reader_fixture import ReaderCase

assert SCHEMA_VERSION == "55", SCHEMA_VERSION
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
    except StoreOpenError as error:
        assert error.code == "SCHEMA_MISMATCH"
        print(json.dumps({"mode": mode, "cache": sys.pycache_prefix, "error": error.code}))
        sys.exit(0)
    raise AssertionError("Actual153/schema55 source admitted schema56")
case.store = Store(case.path, "test-instance", expected_binding=case.binding)
case.serial = 0
if mode == "seed":
    opening = case.create_topic()["id"]
    case.committed(case.command("stack.cover", {"stands": "Original153 cover"}, target={"message_id": opening},
                               expected={"cover_revision": 0}, actor="agent-a"))
    legacy = case.committed(case.command("stack.cover_refresh", target={"message_id": opening},
                                        expected={"cover_revision": 1}))["refresh"]
    case.committed(case.command("stack.cover", {"stands": "Legacy request completed"}, target={"message_id": opening},
                               expected={"cover_revision": 1}, actor="agent-a"))
    # Keep an acknowledged old delivery beside pending records and an unused
    # sequence high-water: the rebuild must preserve all three facts.
    items = case.store.view("agent-a", "deliveries", {"limit": 100})["items"]
    case.committed(case.command("delivery.ack", target={"delivery_id": items[0]["id"]}, actor="agent-a"))
    with sqlite3.connect(str(case.path)) as db:
        db.execute("UPDATE sqlite_sequence SET seq=500 WHERE name='deliveries'")
    (root / "seed.json").write_text(json.dumps({"binding": case.binding, "root": opening,
                                               "legacy_request": legacy["request_message_id"]}))
with sqlite3.connect(str(case.path)) as db:
    print(json.dumps({"schema": db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0],
                      "messages": db.execute("SELECT count(*) FROM messages").fetchone()[0],
                      "deliveries": db.execute("SELECT count(*) FROM deliveries").fetchone()[0],
                      "mode": mode, "cache": sys.pycache_prefix}))

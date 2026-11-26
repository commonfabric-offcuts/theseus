"""Isolated Core control for archived stars inside and outside the loaded history."""
import json
from pathlib import Path
import sys
from time import perf_counter
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root), str(root / "tests")]
from aim_next import store as core
from fixtures.scale_1250 import Seed

for count in (100, 30000):
    seed = Seed(Path(sys.argv[1]) / str(count), count)
    old_reply = next(row["id"] for row in seed.ledger if row["topic_id"] == "target" and row["id"] != seed.first)
    hidden = seed.post("target", "An archive below the loaded history")
    ordinary = seed.post("target", "An ordinary archive with a loaded reply")
    for n in range(32):
        seed.post("target", f"Recent reply {n}", seed.first)
    displayed = seed.post("target", "The ordinary dossier is represented", ordinary)
    through = seed.ledger[-1]["seq"]
    seed.command("message.star", {"starred": True}, {"message_id": old_reply}, {"star_revision": 0}, actor="reader")
    start = perf_counter()
    for message in (seed.first, hidden, ordinary):
        seed.command("stack.aside", {"through": through}, {"message_id": message}, {"aside_revision": 0}, actor="reader")
    archive_ms = round((perf_counter() - start) * 1000, 2)

    steps = [0]
    connect = core._connect

    def instrumented(*args, **kwargs):
        db, runtime = connect(*args, **kwargs)
        db.set_progress_handler(lambda: steps.__setitem__(0, steps[0] + 1) or 0, 1)
        return db, runtime

    with patch.object(core, "_connect", instrumented):
        answer = seed.view("topic_messages", {"topic_id": "target", "direction": "before", "limit": 30})
    archive = {row["stack_position"]["root_id"]: row["stack_position"]
               for row in answer["items"] if row["stack_position"]["below"]}
    assert set(archive) == {seed.first, ordinary}
    assert old_reply not in {row["id"] for row in answer["items"]}
    assert old_reply in archive[seed.first]["starred"]
    assert not archive[ordinary]["starred"]
    other = seed.store.view("owner", "stack_positions", {"topic_id": "target", "message_ids": [displayed]})
    assert not other["items"][0]["stack_position"]["below"]
    print(json.dumps({"history": count, "requests": 1, "returned_rows": len(answer["items"]),
                      "represented_archives": len(archive), "core_vm_steps": steps[0],
                      "archive_3_commands_ms": archive_ms}), flush=True)

from __future__ import annotations

import json
import fcntl
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from aim_next import Store, initialize


# JSON-lines bridge to the real Store. Each process owns and removes its own
# fixture; no server, browser, live identity or existing database is involved.
with tempfile.TemporaryDirectory(prefix="aim-ux-controller-") as directory:
    path = Path(directory).resolve() / "instance.sqlite3"
    initialized = initialize(path, "ux-fixture", [{"id": "fixture-person", "kind": "human"}],
                             authority_path=path.parent / "control" / "authority.json")
    binding = initialized["binding"]
    store = Store(path, "ux-fixture", expected_binding=binding)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["method"] == "epoch":
                # Controlled test history boundary, not a runtime activation API.
                # Only this process's fresh temporary authority is ever changed.
                anchor = Path(binding["authority_path"])
                fd = os.open(str(anchor) + ".lock", os.O_RDWR)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    record = json.loads(anchor.read_text())
                    record["epoch"] = request.get("epoch", record["epoch"])
                    record["recovery"] = {"history_complete": request.get("complete", False)}
                    with sqlite3.connect(str(path)) as db:
                        db.execute("UPDATE metadata SET value=? WHERE key='authority_epoch'", (record["epoch"],))
                        if request.get("drop_private"):
                            db.execute("DELETE FROM drafts")
                            db.execute("DELETE FROM notes")
                        if request.get("restore_draft"):
                            # Rewind this fixture's actual earlier row so receipt
                            # identities really collide across the test epochs.
                            draft = dict(request["restore_draft"])
                            draft_id = draft.pop("id")
                            revision = draft.pop("revision")
                            generation = draft.pop("generation")
                            changed = db.execute("UPDATE drafts SET revision=?,generation=?,payload=? WHERE actor_id=? AND id=?",
                                                 (revision, generation, json.dumps(draft), "fixture-person", draft_id))
                            assert changed.rowcount == 1
                    anchor.write_text(json.dumps(record))
                    binding = dict(binding, authority_epoch=record["epoch"])
                finally:
                    os.close(fd)
                store = Store(path, "ux-fixture", expected_binding=binding)
                answer = store.view("fixture-person", "capabilities", {})
            elif request["method"] == "command":
                answer = store.command("fixture-person", request["envelope"])
            else:
                answer = store.view("fixture-person", request["name"], request["args"])
            print(json.dumps({"id": request["id"], "answer": answer}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request["id"], "failure": str(error)}), flush=True)

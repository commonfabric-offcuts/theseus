from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from aim_next import Store, initialize
from aim_next.server import create_server


# Isolated wiring fixture. Actual Store and HTTP; stdin is a private fixture
# control channel, never a product endpoint. EOF shuts down this server only.
def main():
    with tempfile.TemporaryDirectory(prefix="aim-ux-http-") as directory:
        root = Path(directory).resolve()
        path = root / "instance.sqlite3"
        instance, actor = "ux-http-fixture", "fixture-person"
        binding = initialize(path, instance, [{"id": actor, "kind": "human"}],
                             authority_path=root / "control" / "authority.json")["binding"]

        def store():
            return Store(path, instance, expected_binding=dict(binding))

        def command(kind, operation, args, target=None, expected=None):
            envelope = {"v": 1, "instance_id": instance, "kind": kind,
                        "operation_id": operation, "target": target or {},
                        "expected": dict(expected or {}, authority={
                            key: binding[key] for key in ("authority_id", "authority_epoch")}),
                        "args": args}
            answer = store().command(actor, envelope)
            assert answer["status"] == "committed", answer
            return answer

        command("workspace.create", "fixture-workspace", {
            "id": "w1", "title": "Isolated wiring", "team": []})
        sources = []
        for number in range(2):
            draft, generation = "seed-draft-%d" % number, "seed-generation-%d" % number
            source = ({"kind": "new_topic", "id": "fixture-opening", "workspace_id": "w1"}
                      if number == 0 else sources[0])
            args = {"source_ref": source, "topic_id": "t1", "generation": generation,
                    "body": ("Source %d exact passage. " % number) * 100}
            if number == 0:
                args["opening"] = {"workspace_id": "w1", "title": "Read here", "participants": []}
            command("draft.save", "seed-save-%d" % number, args,
                    {"draft_id": draft}, {"draft_revision": 0})
            command("submission.prepare", "seed-prepare-%d" % number,
                    {"draft_id": draft, "submission_id": "seed-submission-%d" % number,
                     "send_operation_id": "seed-send-%d" % number},
                    {"topic_id": "t1"}, {"draft_revision": 1})
            result = command("topic.create_and_send" if number == 0 else "message.send",
                             "seed-send-%d" % number,
                             {"submission_id": "seed-submission-%d" % number}, {"topic_id": "t1"})
            sources.append({"kind": "message", "id": result["result"]["message_id"]})

        server = create_server(store, instance, actor, Path(__file__).resolve().parents[2] / "web")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for line in sys.stdin:
                request = json.loads(line)
                try:
                    if request["method"] == "ready":
                        answer = {"origin": server.origin, "token": server.session_token,
                                  "instance_id": instance, "actor": actor, "topic_id": "t1",
                                  "sources": sources}
                    elif request["method"] == "epoch":
                        # Test-only controlled history boundary. No activation
                        # claim: the real runtime cutover is lead-owned.
                        anchor = Path(binding["authority_path"])
                        fd = os.open(str(anchor) + ".lock", os.O_RDWR)
                        try:
                            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            record = json.loads(anchor.read_text())
                            record["epoch"] = request["epoch"]
                            record["recovery"] = {"history_complete": request.get("complete", False)}
                            with sqlite3.connect(str(path)) as db:
                                db.execute("UPDATE metadata SET value=? WHERE key='authority_epoch'", (record["epoch"],))
                                if request.get("drop_private"):
                                    db.execute("DELETE FROM drafts")
                                    db.execute("DELETE FROM notes")
                            anchor.write_text(json.dumps(record))
                            binding = dict(binding, authority_epoch=record["epoch"])
                        finally:
                            os.close(fd)
                        answer = store().view(actor, "capabilities", {})
                    else:
                        raise ValueError("Unknown private fixture control")
                    print(json.dumps({"id": request["id"], "answer": answer}), flush=True)
                except Exception as error:
                    print(json.dumps({"id": request["id"], "failure": str(error)}), flush=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)
            assert not thread.is_alive(), "Owned HTTP fixture did not close"


if __name__ == "__main__":
    main()

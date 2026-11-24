from __future__ import annotations

"""All public-command construction for 1169, usable without a test body.

The caller supplies a new scratch directory. No live records, adapters, SQL
inserts, reply fixtures, or assertions are used. Refused construction stops.
"""

from pathlib import Path

from aim_next import Store, initialize


def construct(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=False)
    path = root / "instance.sqlite3"
    binding = initialize(path, "changes-1169", [
        {"id": "owner", "kind": "human"}, {"id": "unread", "kind": "human"},
        {"id": "writer", "kind": "agent"}, {"id": "observer", "kind": "agent"},
    ], authority_path=root / "control" / "authority.json")["binding"]
    store = Store(path, "changes-1169", expected_binding=binding)
    log = []

    def command(kind, args=None, target=None, expected=None, actor="owner"):
        envelope = {"v": 1, "instance_id": "changes-1169", "operation_id": "fixture-%d" % (len(log) + 1),
                    "kind": kind, "args": args or {}, "target": target or {},
                    "expected": dict(expected or {}, authority={key: binding[key] for key in ("authority_id", "authority_epoch")})}
        receipt = store.command(actor, envelope)
        log.append({"actor": actor, "request": envelope, "receipt": receipt})
        if receipt.get("status") != "committed":
            raise RuntimeError("1169 fixture refused: %r" % log[-1])
        return receipt["result"]

    command("workspace.create", {"id": "w", "title": "1169 scratch", "team": ["writer", "observer", "unread"], "coordinator": "writer"})
    command("opening.save", {"workspace_id": "w", "topic_id": "t", "title": "Scratch changes",
                            "participants": ["writer", "unread"], "body": "", "attachments": []},
            {"opening_id": "opening"}, {"opening_revision": 0})
    command("opening.publish", target={"opening_id": "opening"}, expected={"opening_revision": 1})
    old = "🚀 Rate 0.4%, ship today."
    new = "🚀 Rate 0.3%, ship today."
    message = command("message.post", {"body": old, "divergence_reason": "Isolated numeric edit fixture"}, {"topic_id": "t"}, actor="writer")["message_id"]

    def source(actor):
        value = store.view(actor, "source", {"source_ref": {"kind": "message", "id": message}})
        if "error" in value:
            raise RuntimeError("1169 fixture source refused: %r" % value)
        return value

    first = source("owner")
    command("topic.read_through", {"seq": first["seq"]}, {"topic_id": "t"})
    command("message.edit", {"body": new}, {"message_id": message}, {"message_revision": 1}, "writer")
    page = store.view("owner", "topic_messages", {"topic_id": "t", "message_ids": [message]})
    if "error" in page:
        raise RuntimeError("1169 fixture page refused: %r" % page)
    snapshots = {"source": source("owner"), "page": page, "unread": source("unread"), "agent": source("observer")}
    command("topic.read_through", {"seq": first["seq"]}, {"topic_id": "t"})
    snapshots["read_again"] = source("owner")
    command("message.edit", {"body": new + " Added words."}, {"message_id": message}, {"message_revision": 2}, "writer")
    snapshots["addition"] = source("owner")
    return {"path": path, "store": store, "binding": binding, "message": message, "snapshots": snapshots, "commands": log}

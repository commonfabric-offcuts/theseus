from __future__ import annotations

import json
import sqlite3
import unittest

import test_store as fixtures


class ReaderCase(unittest.TestCase):
    """Public-command fixture; every actor and record is in a temporary DB."""

    command = fixtures.StoreCase.command
    workspace = fixtures.StoreCase.workspace
    sql = fixtures.StoreCase.sql
    save_draft = fixtures.StoreCase.save_draft
    prepare = fixtures.StoreCase.prepare
    create_topic = fixtures.StoreCase.create_topic

    def setUp(self):
        fixtures.StoreCase.setUp(self)
        with sqlite3.connect(str(self.path)) as db:
            db.executemany("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", [
                ("other-reader", "human", "Other fixture reader"),
                ("outsider", "agent", "Outside fixture agent"),
            ])
        self.opening = self.create_topic()

    def committed(self, receipt):
        self.assertEqual(receipt.get("status"), "committed", receipt)
        self.assertTrue(receipt.get("recorded"), receipt)
        return receipt["result"]

    def participation(self, actor, present):
        self.committed(self.command("participation.set", {"actor_id": actor, "present": present},
                                    target={"topic_id": "t1"}))

    def rejected(self, receipt, code):
        self.assertEqual(receipt.get("error", {}).get("code"), code, receipt)
        self.assertNotEqual(receipt.get("status"), "committed", receipt)

    def source(self, ref, actor="owner"):
        result = self.store.view(actor, "source", {"source_ref": ref})
        self.assertNotIn("error", result, result)
        return result

    def envelope(self, kind, target, args, expected=None, op=None):
        self.serial += 1
        return {"v": 1, "instance_id": "test-instance",
                "operation_id": op or "reader-op-%s" % self.serial,
                "kind": kind, "target": target,
                "expected": dict(expected or {}, authority=dict(self.pin)), "args": args}

    def send(self, body, addressees=None, quotes=None, attachments=None):
        # A distinct source for each reply avoids manufacturing duplicate
        # private editors for the same actor/source/destination key.
        source = {"kind": "message", "id": self.sql(
            "SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq DESC LIMIT 1")[0][0]}
        key = "reader-draft-%s" % (self.serial + 1)
        self.committed(self.command("draft.save", {
            "source_ref": source, "topic_id": "t1", "generation": "gA", "body": body,
            "attachments": attachments or [], "quotes": quotes or [], "addressees": addressees or [],
        }, target={"draft_id": key}, expected={"draft_revision": 0}))
        self.committed(self.prepare(key, "t1", submission=key, send_op=key + "-send"))
        receipt = self.command("message.send", {"submission_id": key},
                               target={"topic_id": "t1"}, op=key + "-send")
        result = self.committed(receipt)
        return {"id": result["message_id"], "seq": self.sql(
            "SELECT seq FROM messages WHERE id=?", (result["message_id"],))[0][0],
                "receipt": receipt, "submission": key}

    def memory(self, item="memory-one", actor="agent-a", scope=None,
               body="Original Notebook words", revision=0, title="Notebook", **extra):
        target = {"item_id": item}
        if revision == 0:
            target["owner_scope"] = scope or {"kind": "topic", "id": "t1"}
        args = {"title": title, "body": body, "attachments": [], "references": []}
        args.update(extra)
        return self.command("memory.create" if revision == 0 else "memory.revise", args,
                            target=target, expected={"item_revision": revision}, actor=actor)

    def memory_ref(self, item="memory-one", revision=1):
        return {"kind": "memory", "id": item, "revision": revision}

    def public_state(self):
        # Memory/media/private work cannot send, enroll or settle work as a
        # side effect. Snapshot existing authoritative tables, not a UI count.
        tables = ("messages", "deliveries", "delivery_reasons", "topic_participants",
                  "delivery_groups", "recipient_schedule", "topics", "workspaces")
        return {name: self.sql("SELECT * FROM " + name + " ORDER BY rowid") for name in tables}

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            return tuple(db.iterdump())

    def json_size(self, value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

from __future__ import annotations

"""Disposable scale seeds. Public commands keep all maintained publication state.

Only construction batches commits: every command still runs Store.command and
its real validation/effects/receipt path. Nothing patches a measured read.
"""
import contextlib
import hashlib
import itertools
import json
from pathlib import Path
import sqlite3
from unittest import mock
import uuid

from aim_next import Store, initialize
from aim_next import store as core


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Lease:
    def __init__(self, db, name):
        self.db, self.name, self.active = db, name, False

    def __getattr__(self, key):
        return getattr(self.db, key)

    @property
    def in_transaction(self):
        return self.active

    def execute(self, sql, *args):
        if sql in ("BEGIN", "BEGIN IMMEDIATE"):
            self.active = True
            return self.db.execute("SAVEPOINT " + self.name)
        return self.db.execute(sql, *args)

    def commit(self):
        self.db.execute("RELEASE " + self.name)
        self.active = False

    def rollback(self):
        if self.active:
            self.db.execute("ROLLBACK TO " + self.name)
            self.db.execute("RELEASE " + self.name)
            self.active = False

    def close(self):
        self.rollback()


@contextlib.contextmanager
def construction_batch(path):
    original = core._connect
    db, runtime = original(path, write=True)
    serial = [0]
    def connect(selected, *args, **kwargs):
        if Path(selected).resolve() != Path(path).resolve():
            raise AssertionError("Seed construction reached a different database")
        serial[0] += 1
        return Lease(db, "seed_%d" % serial[0]), runtime
    db.execute("BEGIN IMMEDIATE")
    try:
        with mock.patch.object(core, "_connect", connect):
            yield
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


class Seed:
    def __init__(self, root, count=100, dossiers=300, batched=True):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=False)
        self.path = self.root / "instance.sqlite3"
        self.instance = "scale-1250"
        initial = initialize(self.path, self.instance, [
            {"id": "owner", "kind": "human"}, {"id": "reader", "kind": "human"},
            {"id": "worker", "kind": "agent"}], authority_path=self.root / "control/authority.json")
        self.binding = initial["binding"]
        self.store = Store(self.path, self.instance, expected_binding=self.binding, tools=self.root / "empty-tools")
        self.serial, self.ledger = 0, []
        self.count, self.dossiers = count, dossiers
        scope = construction_batch(self.path) if batched else contextlib.nullcontext()
        identities = itertools.count(1)
        with scope, mock.patch.object(uuid, "uuid4", side_effect=lambda: uuid.UUID(int=next(identities))):
            self.command("workspace.create", {"id": "w", "title": "Scale fixture", "team": ["reader", "worker"]})
            self.first = self.topic("target")
            for n in range(1, count):
                body = ("Visible release %02d" % (n - count + 30) if n >= count - 30
                        else "Historical release event %d" % (n % 3))
                self.post("target", body, self.first,
                          ["reader"] if n >= count - 5 else [])
            self.topic("surrounding")
            for n in range(dossiers - 2):
                self.post("surrounding", "Surrounding dossier %03d" % n)
            self.command("participation.set", {"actor_id": "worker", "present": True}, {"topic_id": "target"},
                         {"topic_revision": self.view("topic", {"topic_id": "target"})["topic"]["version"]})
            self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w"}, {"pipeline_revision": 0})
            for n in range(3):
                self.command("pipeline.item_add", {"title": "Linked item %d" % n, "section": "now",
                             "sources": [{"message_id": self.first}]}, {"workspace_id": "w"})
            self.command("stack.cover", {"stands": "## Done {folded}\nFixed cover words", "waiting": [], "payload": None},
                         {"message_id": self.first}, {"cover_revision": 0}, actor="worker")
            self.command("message.star", {"starred": True}, {"message_id": self.first}, {"star_revision": 0}, actor="reader")
            target = [row for row in self.ledger if row["topic_id"] == "target"]
            surrounding = [row for row in self.ledger if row["topic_id"] == "surrounding"]
            self.command("topic.read_through", {"seq": target[-31]["seq"]}, {"topic_id": "target"}, actor="reader")
            self.command("topic.read_through", {"seq": surrounding[-1]["seq"]}, {"topic_id": "surrounding"}, actor="reader")
        self.save()

    def command(self, kind, args, target=None, expected=None, actor="owner"):
        self.serial += 1
        operation = "scale-op-%08d" % self.serial
        envelope = {"v": 1, "instance_id": self.instance, "operation_id": operation,
                    "kind": kind, "target": target or {}, "args": args,
                    "expected": dict(expected or {}, authority={k: self.binding[k] for k in ("authority_id", "authority_epoch")})}
        result = self.store.command(actor, envelope)
        if result.get("status") != "committed":
            raise AssertionError((kind, result))
        return result["result"]

    def view(self, name, args):
        answer = self.store.view("reader", name, args)
        if "error" in answer:
            raise AssertionError((name, answer))
        return answer

    def remember(self, topic, body, result, parent=None, addressees=None):
        self.ledger.append({"id": result["message_id"], "seq": result["seq"], "topic_id": topic,
                            "body": body, "reply_to": parent, "addressees": addressees or []})
        return result["message_id"]

    def topic(self, name):
        source = {"kind": "new_topic", "id": "opening-" + name, "workspace_id": "w"}
        self.command("draft.save", {"source_ref": source, "topic_id": name, "generation": "seed",
                     "body": "Opening " + name, "attachments": [], "quotes": [], "addressees": [],
                     "opening": {"workspace_id": "w", "title": name, "participants": ["reader"]}},
                     {"draft_id": name}, {"draft_revision": 0})
        send_op = "open-" + name
        self.command("submission.prepare", {"draft_id": name, "submission_id": name, "send_operation_id": send_op},
                     {"topic_id": name}, {"draft_revision": 1})
        # The prepared operation identity is part of the public send contract.
        envelope = {"v": 1, "instance_id": self.instance, "operation_id": send_op,
                    "kind": "topic.create_and_send", "target": {"topic_id": name},
                    "expected": {"authority": {k: self.binding[k] for k in ("authority_id", "authority_epoch")}},
                    "args": {"submission_id": name}}
        receipt = self.store.command("owner", envelope)
        if receipt.get("status") != "committed":
            raise AssertionError(receipt)
        return self.remember(name, "Opening " + name, receipt["result"])

    def post(self, topic, body, parent=None, addressees=None):
        args = {"body": body, "reply_to": parent, "addressees": addressees or []}
        if addressees:
            args["intent"] = "tell"
        return self.remember(topic, body, self.command("message.post", args, {"topic_id": topic}), parent, addressees)

    def save(self):
        data = {"version": 1, "instance_id": self.instance, "binding": self.binding, "count": self.count,
                "dossiers": self.dossiers, "first": self.first, "messages": self.ledger}
        (self.root / "ledger.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        (self.root / "owned-scale-fixture.json").write_text(json.dumps({"kind": "scale1250-disposable", "ledger_sha256": digest(self.root / "ledger.json")}))


def open_seed(root):
    root = Path(root).resolve()
    owned = json.loads((root / "owned-scale-fixture.json").read_text())
    if owned != {"kind": "scale1250-disposable", "ledger_sha256": digest(root / "ledger.json")}:
        raise AssertionError("Fixture ledger provenance changed")
    ledger = json.loads((root / "ledger.json").read_text())
    store = Store(root / "instance.sqlite3", ledger["instance_id"], expected_binding=ledger["binding"], tools=root / "empty-tools")
    return store, ledger


def verify(root):
    store, ledger = open_seed(root)
    with sqlite3.connect(str(store.path)) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        actual = db.execute("SELECT id,seq,topic_id,body,reply_to,addressees FROM messages WHERE topic_id IN ('target','surrounding') ORDER BY seq").fetchall()
        expected = [(m["id"], m["seq"], m["topic_id"], m["body"], m["reply_to"], json.dumps(m["addressees"], separators=(",", ":"))) for m in ledger["messages"]]
        assert actual == expected, "Full message/source ledger differs"
        target = [m for m in ledger["messages"] if m["topic_id"] == "target"]
        assert len(target) == ledger["count"]
        roots = {m["id"] for m in ledger["messages"] if m["reply_to"] is None}
        assert len(roots) == ledger["dossiers"]
        for topic in ("target", "surrounding"):
            rows = [m for m in ledger["messages"] if m["topic_id"] == topic]
            assert db.execute("SELECT message_count,latest_message_id FROM topic_summaries WHERE topic_id=?", (topic,)).fetchone() == (len(rows), rows[-1]["id"])
        for group, pending in db.execute("SELECT id,pending_count FROM delivery_groups"):
            assert pending == db.execute("SELECT count(*) FROM deliveries WHERE group_id=? AND state='pending'", (group,)).fetchone()[0]
        assert {row[0] for row in db.execute("SELECT recipient_id FROM recipient_schedule")} == {"reader"}, "Expected recipient schedule identities are missing"
        assert {row[0] for row in db.execute("SELECT DISTINCT recipient_id FROM deliveries")} == {"reader"}, "Expected delivery recipient is missing"
        assert {tuple(row) for row in db.execute("SELECT DISTINCT recipient_id,kind,topic_id FROM delivery_groups")} == {("reader", "subscription", "target"), ("reader", "subscription", "surrounding"), ("reader", "direct", "")}, "Expected delivery group identities differ"
        for actor, pending in db.execute("SELECT recipient_id,pending_count FROM recipient_schedule"):
            assert pending == db.execute("SELECT coalesce(sum(pending_count),0) FROM delivery_groups WHERE recipient_id=? AND active=1", (actor,)).fetchone()[0]
        assert db.execute("SELECT count(*) FROM pipeline_item_sources WHERE message_id=?", (ledger["first"],)).fetchone() == (3,)
    answer = store.view("reader", "topic_messages", {"topic_id": "target", "direction": "before", "limit": 30})
    assert "error" not in answer, answer
    assert [m["id"] for m in answer["items"]] == [m["id"] for m in target[-30:]]
    assert [m["body"] for m in answer["items"]] == [m["body"] for m in target[-30:]]
    return {"messages": len(actual), "target": len(target), "dossiers": len(roots), "frontier": [m["id"] for m in target[-30:]], "verified": True}


def verify_unread(root):
    """One fixed-frontier stratum; id/seq come from the independent ledger.

    Time and commit are canonical offline snapshot metadata, not ledger-derived.
    The normal full fixture verification still holds before this extra oracle.
    """
    verify(root)
    store, ledger = open_seed(root)
    target = [m for m in ledger["messages"] if m["topic_id"] == "target"]
    first = target[-30]
    with sqlite3.connect(str(store.path)) as db:
        pending = dict(db.execute(
            "SELECT g.kind,count(*) FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
            "WHERE g.recipient_id='reader' AND g.active=1 AND d.topic_id='target' "
            "AND d.state='pending' GROUP BY g.kind").fetchall())
        assert pending == {"subscription": 25, "direct": 5}, "Unread pending frontier changed: %r" % pending
        assert db.execute("SELECT count(*) FROM message_marks WHERE actor_id='reader'").fetchone() == (0,), "Unread marks changed"
        sent_ms = db.execute("SELECT sent_ms FROM messages WHERE id=?", (first["id"],)).fetchone()[0]
        commit = int(db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0])
    expected = {"instance_id": ledger["instance_id"], "topic_id": "target", "commit_seq": commit,
                "oldest_unread": {"id": first["id"], "seq": first["seq"], "sent_ms": sent_ms}}
    assert store.view("reader", "topic_unread", {"topic_id": "target"}) == expected, "Unread frontier differs from ledger"
    return expected

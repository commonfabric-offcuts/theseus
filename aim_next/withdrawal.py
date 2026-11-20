from __future__ import annotations

"""Asker-only withdrawal, separate from words, replies and cover waits (item 366)."""

import json

from .contract import Refusal
from .delivery import _now_ms
from .standing_conversation import is_conversation

WITHDRAWAL_SCHEMA = [
    "CREATE TABLE message_withdrawals (message_id TEXT PRIMARY KEY REFERENCES messages(id), "
    "by TEXT NOT NULL REFERENCES actors(id), at_ms INTEGER NOT NULL)",
    "CREATE TRIGGER withdrawals_stay_u BEFORE UPDATE ON message_withdrawals BEGIN SELECT RAISE(ABORT, 'immutable withdrawal'); END",
    "CREATE TRIGGER withdrawals_stay_d BEFORE DELETE ON message_withdrawals BEGIN SELECT RAISE(ABORT, 'immutable withdrawal'); END",
]
WITHDRAWAL_DOWN = ("DROP TABLE message_withdrawals",)
WITHDRAWAL_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_withdrawals)"


def withdrawn(db, message_id):
    row = db.execute("SELECT by,at_ms FROM message_withdrawals WHERE message_id=?", (message_id,)).fetchone()
    return dict(row) if row else None


class Withdrawal:
    def _withdrawal_value(self, db, message_id):
        return withdrawn(db, message_id)

    def _command_message_withdraw(self, db, actor, envelope):
        if set(envelope["target"]) != {"message_id"} or envelope["args"]:
            raise Refusal("INVALID_ARGUMENT", "Withdraw one question, without changing its words")
        # Same author/read/open-outcome authority as editing, for people and agents.
        message = self._editable(db, actor, envelope["target"]["message_id"], people=False)
        # _editable has already checked canonical source reach, authorship and
        # the open outcome. Wait routing needs no words or attachment metadata.
        ask = db.execute("SELECT id,topic_id,seq,author_id,intent,addressees,private_to FROM messages WHERE id=?",
                         (message["id"],)).fetchone()
        if ask["intent"] != "ask" or ask["private_to"] is not None:
            raise Refusal("NOT_A_QUESTION", "Only a question can be withdrawn")
        existing = withdrawn(db, ask["id"])
        result = {"message_id": ask["id"], "topic_id": ask["topic_id"], "withdrawal": existing, "changed": False}
        if existing is not None:
            return result, []
        topic = self._topic(db, actor, ask["topic_id"])
        value = {"by": actor, "at_ms": _now_ms()}
        db.execute("INSERT INTO message_withdrawals VALUES (?,?,?)", (ask["id"], actor, value["at_ms"]))
        members = [member for member in json.loads(ask["addressees"]) if member != actor]
        affected = []
        for member in members:
            affected.extend(self._set_linked_wait(db, member, ask["id"], False, by=actor))
        if is_conversation(topic):
            db.execute("DELETE FROM conversation_waits WHERE ask_id=?", (ask["id"],))
            self._sync_waits(db, topic, members)
        else:
            for member in members:
                self._topic_ask_answered(db, topic, member, ask)
                self._sync_linked_attention(db, topic, member)
        version = self._touch_topic(db, topic)
        for reader in self._message_readers(db, ask, actor):
            self._change(db, "actor", reader, "withdrawal", ask["id"], 1)
        for member in members:
            self._change(db, "actor", member, "waiting", topic["id"], version)
        return dict(result, withdrawal=value, changed=True), affected + [{"kind": "topic", "id": topic["id"], "version": version}]

    def _withdrawal_fields(self, db, items):
        ids = [item["id"] for item in items]
        if not ids:
            return
        values = {row["message_id"]: {"by": row["by"], "at_ms": row["at_ms"]} for row in db.execute(
            "SELECT * FROM message_withdrawals WHERE message_id IN (%s)" % ",".join("?" * len(ids)), ids)}
        for item in items:
            item["withdrawal"] = values.get(item["id"])

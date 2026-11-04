from __future__ import annotations

import base64
import json
import time
import uuid

from .contract import LIMITS, Refusal, _identifier, _json, _page_size


DELIVERY_SCHEMA = [
    "CREATE TABLE delivery_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id TEXT NOT NULL REFERENCES actors(id), kind TEXT NOT NULL, topic_id TEXT NOT NULL, participant_epoch INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0), first_pending_seq INTEGER, UNIQUE(recipient_id,kind,topic_id,participant_epoch))",
    "CREATE INDEX eligible_groups ON delivery_groups(recipient_id,id) WHERE active=1 AND pending_count>0",
    "CREATE INDEX eligible_heads ON delivery_groups(recipient_id,first_pending_seq) WHERE active=1 AND pending_count>0",
    "CREATE TABLE recipient_schedule (recipient_id TEXT PRIMARY KEY REFERENCES actors(id), enabled INTEGER NOT NULL, pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0), wake_generation INTEGER NOT NULL DEFAULT 0, last_seq INTEGER NOT NULL DEFAULT 0, next_due_ms INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, captured_generation INTEGER, captured_seq INTEGER, claim_token TEXT, claim_until_ms INTEGER)",
    "CREATE INDEX due_recipients ON recipient_schedule(next_due_ms,recipient_id) WHERE enabled=1 AND pending_count>0",
    "CREATE TRIGGER recipient_enabled AFTER UPDATE OF enabled ON actors BEGIN UPDATE recipient_schedule SET enabled=NEW.enabled WHERE recipient_id=NEW.id; END",
]


def _now_ms():
    return int(time.time() * 1000)


def _cursor(group, seq):
    return "e1." + base64.urlsafe_b64encode(_json([group, seq]).encode("ascii")).decode("ascii")


def _position(cursor):
    if cursor is None:
        return 0, 0
    try:
        if not isinstance(cursor, str) or not cursor.startswith("e1.") or len(cursor) > 128:
            raise ValueError()
        value = json.loads(base64.b64decode(cursor[3:].encode("ascii"), altchars=b"-_", validate=True))
        if (not isinstance(value, list) or len(value) != 2
                or any(type(n) is not int or not 0 <= n <= 9223372036854775807 for n in value)
                or _cursor(*value) != cursor):
            raise ValueError()
        return tuple(value)
    except (ValueError, TypeError, UnicodeError):
        raise Refusal("INVALID_ARGUMENT", "Invalid delivery page cursor")


class Delivery:
    def _pending_head(self, db, actor):
        row = db.execute("SELECT first_pending_seq FROM delivery_groups INDEXED BY eligible_heads WHERE recipient_id=? AND active=1 AND pending_count>0 ORDER BY first_pending_seq LIMIT 1", (actor,)).fetchone()
        return row[0] if row else None

    def _eligibility_changed(self, db, actor, delta, last_seq=None):
        old = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id=?", (actor,)).fetchone()
        pending = old["pending_count"] + delta
        due, retry = old["next_due_ms"], old["retry_count"]
        captured_done = old["captured_seq"] is not None and (self._pending_head(db, actor) or old["captured_seq"] + 1) > old["captured_seq"]
        if pending == 0:
            due, retry = None, 0
        elif old["pending_count"] == 0 or captured_done:
            due, retry = _now_ms(), 0
        db.execute("UPDATE recipient_schedule SET pending_count=?,wake_generation=wake_generation+1,last_seq=?,next_due_ms=?,retry_count=? WHERE recipient_id=?",
                   (pending, last_seq if last_seq is not None else old["last_seq"], due, retry, actor))

    def _queue_delivery(self, db, message_id, recipient, topic_id, reasons):
        direct = any(reason != "subscription" for reason in reasons)
        key = (recipient, "direct" if direct else "subscription", "" if direct else topic_id, 0 if direct else reasons["subscription"])
        db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", key)
        group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? AND participant_epoch=?", key).fetchone()[0]
        delivery_id = "d-" + uuid.uuid4().hex
        seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES (?,?,?,?)", (delivery_id, message_id, recipient, group)).lastrowid
        db.executemany("INSERT INTO delivery_reasons VALUES (?,?,?,?)", [(delivery_id, reason, topic_id, epoch) for reason, epoch in reasons.items()])
        db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=COALESCE(first_pending_seq,?) WHERE id=?", (seq, group))
        db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) SELECT id,enabled FROM actors WHERE id=? ON CONFLICT DO NOTHING", (recipient,))
        self._eligibility_changed(db, recipient, 1, seq)
        return delivery_id

    def _cancel_subscription(self, db, actor, topic_id, epoch):
        group = db.execute("SELECT id,pending_count FROM delivery_groups WHERE recipient_id=? AND kind='subscription' AND topic_id=? AND participant_epoch=? AND active=1", (actor, topic_id, epoch)).fetchone()
        if group is not None:
            db.execute("UPDATE delivery_groups SET active=0 WHERE id=?", (group["id"],))
            self._eligibility_changed(db, actor, -group["pending_count"])

    def _command_delivery_ack(self, db, actor, envelope):
        if set(envelope["target"]) != {"delivery_id"} or envelope["args"]:
            raise Refusal("INVALID_ARGUMENT", "Acknowledge exactly one delivery identity")
        delivery_id = _identifier(envelope["target"]["delivery_id"], "delivery_id")
        row = db.execute("SELECT d.*,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.id=? AND d.recipient_id=?", (delivery_id, actor)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No readable delivery")
        result = {"delivery_id": delivery_id, "acknowledged": row["state"] == "acknowledged"}
        if result["acknowledged"]:
            return dict(result, already_acknowledged=True), []
        if not row["active"]:
            return dict(result, reason="not_pending"), []
        db.execute("UPDATE deliveries SET state='acknowledged' WHERE id=?", (delivery_id,))
        head = db.execute("SELECT seq FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' ORDER BY seq LIMIT 1", (row["group_id"],)).fetchone()
        db.execute("UPDATE delivery_groups SET pending_count=pending_count-1,first_pending_seq=? WHERE id=?", (head[0] if head else None, row["group_id"]))
        self._eligibility_changed(db, actor, -1)
        self._change(db, "actor", actor, "delivery", delivery_id, 2)
        return dict(result, acknowledged=True, already_acknowledged=False), [{"kind": "delivery", "id": delivery_id, "version": 2}]

    def _view_deliveries(self, db, actor, args):
        limit = _page_size(args)
        start_group, start_seq = _position(args.get("cursor"))
        groups = db.execute("SELECT id FROM delivery_groups INDEXED BY eligible_groups WHERE recipient_id=? AND active=1 AND pending_count>0 AND id>=? ORDER BY id LIMIT 100", (actor, start_group)).fetchall()
        answer = {"instance_id": self.instance_id, "items": [], "next_cursor": None}
        last = (start_group, start_seq)
        for group in groups:
            group_id = group["id"]
            seq = start_seq if group_id == start_group else 0
            rows = db.execute("SELECT * FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' AND seq>? ORDER BY seq LIMIT ?", (group_id, seq, limit - len(answer["items"]) + 1)).fetchall()
            for row in rows:
                if len(answer["items"]) == limit:
                    answer["next_cursor"] = _cursor(*last)
                    return answer
                message = dict(db.execute("SELECT id,topic_id,author_id,substr(body,1,256) AS body,length(body)>256 AS preview FROM messages WHERE id=?", (row["message_id"],)).fetchone())
                message["preview"] = bool(message["preview"])
                item = {key: row[key] for key in ("seq", "id", "message_id", "recipient_id", "state")}
                item.update(reasons=self._effective_reasons(db, row), message=message, source_ref={"kind": "message", "id": row["message_id"]})
                candidate = dict(answer, items=answer["items"] + [item], next_cursor=_cursor(group_id, row["seq"]))
                if len(_json(candidate).encode("utf-8")) > LIMITS["summary_utf8_bytes"]:
                    if not answer["items"]:
                        raise Refusal("SUMMARY_ITEM_TOO_LARGE", "This preview exceeds the configured response limit")
                    answer["next_cursor"] = _cursor(*last)
                    return answer
                answer["items"].append(item)
                last = (group_id, row["seq"])
            # A previous page may have ended at this group's last row. Advance
            # the continuation even if all its pending rows precede that cursor.
            last = (group_id, rows[-1]["seq"] if rows else seq)
        if len(groups) == 100:
            answer["next_cursor"] = _cursor(*last)
        return answer

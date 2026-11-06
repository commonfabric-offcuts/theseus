from __future__ import annotations

import base64
import json
import time
import uuid

from .contract import LIMITS, Refusal, _identifier, _json, _page_size, _prefix
from .marks import MARKED


DELIVERY_SCHEMA = [
    "CREATE TABLE delivery_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id TEXT NOT NULL REFERENCES actors(id), kind TEXT NOT NULL, topic_id TEXT NOT NULL, participant_epoch INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0), first_pending_seq INTEGER, UNIQUE(recipient_id,kind,topic_id,participant_epoch))",
    "CREATE INDEX eligible_groups ON delivery_groups(recipient_id,id) WHERE active=1 AND pending_count>0",
    "CREATE INDEX eligible_heads ON delivery_groups(recipient_id,first_pending_seq) WHERE active=1 AND pending_count>0",
    "CREATE TABLE recipient_schedule (recipient_id TEXT PRIMARY KEY REFERENCES actors(id), enabled INTEGER NOT NULL, pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0), wake_generation INTEGER NOT NULL DEFAULT 0, last_seq INTEGER NOT NULL DEFAULT 0, next_due_ms INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, captured_generation INTEGER, captured_seq INTEGER, claim_token TEXT, claim_until_ms INTEGER)",
    "CREATE INDEX due_recipients ON recipient_schedule(next_due_ms,recipient_id) WHERE enabled=1 AND pending_count>0",
    "CREATE TRIGGER recipient_enabled AFTER UPDATE OF enabled ON actors BEGIN UPDATE recipient_schedule SET enabled=NEW.enabled WHERE recipient_id=NEW.id; END",
]

# Version 18 keeps each delivery's topic, copied from its message (which never
# changes), so the reader's oldest unread message in a topic is one index probe
# on (recipient, topic, delivery) over the pending rows, whatever the history.
DELIVERY_TOPIC_SCHEMA = [
    "ALTER TABLE deliveries ADD COLUMN topic_id TEXT",
    "CREATE INDEX pending_topic_deliveries ON deliveries(recipient_id,topic_id,seq) WHERE state='pending'",
]
DELIVERY_TOPIC_BACKFILL = ["UPDATE deliveries SET topic_id=(SELECT m.topic_id FROM messages m WHERE m.id=deliveries.message_id)"]
DELIVERY_TOPIC_DOWN = ("DROP INDEX pending_topic_deliveries", "ALTER TABLE deliveries DROP COLUMN topic_id")

# Version 19 indexes the pending deliveries by group, topic and delivery instead,
# so the line is found in the reader's live groups alone: the current
# subscription group of the topic and the one direct group, one row each. Rows
# that a subscription cancelled by leaving left pending are never walked. A new
# delivery must name its topic.
DELIVERY_GROUP_TOPIC_SCHEMA = [
    "CREATE INDEX pending_group_topic_deliveries ON deliveries(group_id,topic_id,seq) WHERE state='pending'",
    "CREATE TRIGGER delivery_topic_required BEFORE INSERT ON deliveries WHEN NEW.topic_id IS NULL "
    "BEGIN SELECT RAISE(ABORT, 'a delivery names its topic'); END",
]
DELIVERY_GROUP_TOPIC_UP = ("DROP INDEX pending_topic_deliveries",) + tuple(DELIVERY_GROUP_TOPIC_SCHEMA)
DELIVERY_GROUP_TOPIC_DOWN = ("DROP TRIGGER delivery_topic_required", "DROP INDEX pending_group_topic_deliveries", DELIVERY_TOPIC_SCHEMA[1])
# A fresh instance has the column and the version-19 index and trigger.
DELIVERY_TOPIC_FRESH = DELIVERY_TOPIC_SCHEMA[:1] + DELIVERY_GROUP_TOPIC_SCHEMA

# A message sent by name in an archived topic still waits in the attention view for
# a recipient who has no list of the outcome's topics (neither its owner nor a
# member: a participant from outside it, or someone who lost the topic), so there
# is nowhere else to read it or mark it read. Read with deliveries d and topics t.
NAMED_OUTSIDE_LISTS = ("(t.archived=0 OR NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id=t.workspace_id AND "
                       "(w.owner_id=d.recipient_id OR EXISTS (SELECT 1 FROM workspace_members m "
                       "WHERE m.workspace_id=w.id AND m.actor_id=d.recipient_id))))")


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
        due, retry, handed = old["next_due_ms"], old["retry_count"], old["handed_seq"]
        captured_done = old["captured_seq"] is not None and (self._pending_head(db, actor) or old["captured_seq"] + 1) > old["captured_seq"]
        # Work handed to a running turn stays quiet until something newer arrives.
        arrived_after_handing = handed is not None and last_seq is not None and last_seq > handed
        if pending == 0:
            due, retry, handed = None, 0, None
        elif old["pending_count"] == 0 or captured_done or arrived_after_handing:
            due, retry = _now_ms(), 0
        if pending and old["claim_token"] is not None and old["claim_until_ms"] > _now_ms():
            due = old["claim_until_ms"]
        db.execute("UPDATE recipient_schedule SET pending_count=?,wake_generation=wake_generation+1,last_seq=?,next_due_ms=?,retry_count=?,handed_seq=? WHERE recipient_id=?",
                   (pending, last_seq if last_seq is not None else old["last_seq"], due, retry, handed, actor))

    def _queue_delivery(self, db, message_id, recipient, topic_id, reasons):
        direct = any(reason != "subscription" for reason in reasons)
        key = (recipient, "direct" if direct else "subscription", "" if direct else topic_id, 0 if direct else reasons["subscription"])
        db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", key)
        group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? AND participant_epoch=?", key).fetchone()[0]
        delivery_id = "d-" + uuid.uuid4().hex
        seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id) VALUES (?,?,?,?,?)",
                         (delivery_id, message_id, recipient, group, topic_id)).lastrowid
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
        self._acknowledge(db, actor, row)
        return dict(result, acknowledged=True, already_acknowledged=False), [{"kind": "delivery", "id": delivery_id, "version": 2}]

    def _acknowledge(self, db, actor, row):
        """Settle one pending delivery of an active group; every acknowledgment shares this path."""
        db.execute("UPDATE deliveries SET state='acknowledged' WHERE id=?", (row["id"],))
        head = db.execute("SELECT seq FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' ORDER BY seq LIMIT 1", (row["group_id"],)).fetchone()
        db.execute("UPDATE delivery_groups SET pending_count=pending_count-1,first_pending_seq=? WHERE id=?", (head[0] if head else None, row["group_id"]))
        self._eligibility_changed(db, actor, -1)
        self._change(db, "actor", actor, "delivery", row["id"], 2)

    def _unread(self, db, actor, topics=None, workspaces=None):
        """{topic_id: [unread, addressed, workspace_id]} for this actor's pending deliveries and marks.

        Unread is what has not been acknowledged, which for a person means not
        yet seen on screen; addressed is the part sent to them by name. The
        subscription groups carry their own counters; the one direct group per
        recipient spans topics, so its pending rows are counted by topic. A
        list view passes the topics or outcomes on its page: their subscription
        groups are found by index, and only the direct group's pending rows are
        walked whatever the page.

        A page of topics, archived or not, counts each of its own. Outcome and
        total counts leave archived topics out, as the outcome's list does, so
        no count points at a topic the reader cannot find in a list; nothing is
        settled, and the counts return when the topic is unarchived. A message
        sent by name to someone outside the outcome (neither its owner nor a
        member) still counts: no list ever held it for them.

        A message the actor marked unread adds one to unread, never to
        addressed, unless an eligible delivery (pending in an active group)
        already counts it; a mark in a topic the actor cannot read lies
        dormant. Its rows are read from the actor's marked index, so that part
        follows the actor's marks.
        """
        counts, scope, direct_scope, mark_scope, values = {}, "", "", "", ()
        if topics == [] or workspaces == []:
            return counts
        if topics is not None:
            places = ",".join("?" * len(topics))
            scope, direct_scope, values = " AND g.topic_id IN (%s)" % places, " AND m.topic_id IN (%s)" % places, tuple(topics)
            mark_scope = " AND k.topic_id IN (%s)" % places
        elif workspaces is not None:
            scope = direct_scope = mark_scope = " AND t.workspace_id IN (%s)" % ",".join("?" * len(workspaces))
            values = tuple(workspaces)
        if topics is None:
            scope, direct_scope = scope + " AND t.archived=0", direct_scope + " AND " + NAMED_OUTSIDE_LISTS
            mark_scope += " AND t.archived=0"
        if topics is not None:
            subscriptions = db.execute("SELECT g.topic_id,t.workspace_id,SUM(g.pending_count) AS pending "
                                       "FROM delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 CROSS JOIN topics t ON t.id=g.topic_id "
                                       "WHERE g.recipient_id=? AND g.kind='subscription' AND g.active=1 AND g.pending_count>0" + scope + " GROUP BY g.topic_id",
                                       (actor,) + values)
        else:
            subscriptions = db.execute("SELECT g.topic_id,t.workspace_id,SUM(g.pending_count) AS pending FROM delivery_groups g INDEXED BY eligible_groups "
                                       "CROSS JOIN topics t ON t.id=g.topic_id "
                                       "WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 AND g.kind='subscription'" + scope + " GROUP BY g.topic_id",
                                       (actor,) + values)
        for row in subscriptions:
            counts[row["topic_id"]] = [row["pending"], 0, row["workspace_id"]]
        for row in db.execute("SELECT m.topic_id,t.workspace_id,COUNT(*) AS pending FROM delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 "
                              "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                              "CROSS JOIN messages m ON m.id=d.message_id CROSS JOIN topics t ON t.id=m.topic_id "
                              "WHERE g.recipient_id=? AND g.kind='direct' AND g.topic_id='' AND g.participant_epoch=0 AND g.active=1 AND g.pending_count>0"
                              + direct_scope + " GROUP BY m.topic_id",
                              (actor,) + values):
            entry = counts.setdefault(row["topic_id"], [0, 0, row["workspace_id"]])
            entry[0] += row["pending"]
            entry[1] += row["pending"]
        for row in db.execute("SELECT k.topic_id,t.workspace_id,COUNT(*) AS marked FROM message_marks k INDEXED BY reader_marks "
                              "CROSS JOIN topics t ON t.id=k.topic_id CROSS JOIN workspaces w ON w.id=t.workspace_id "
                              "WHERE k.actor_id=? AND " + MARKED + mark_scope + " GROUP BY k.topic_id",
                              (actor,) + values):
            counts.setdefault(row["topic_id"], [0, 0, row["workspace_id"]])[0] += row["marked"]
        return counts

    def _oldest_unread(self, db, actor, topic_id):
        """The oldest message in one topic that is unread for this actor, as {seq, id}, or None.

        Unread is what the counts hold (_unread): a delivery pending in an
        active group, or a mark. A delivery left pending by a subscription the
        actor's leaving cancelled is not unread, and the actor's own messages,
        which are never delivered to them, do not count even when marked.

        Deliveries are queued in the transaction that writes their message, so
        delivery order is message order. The actor's pending deliveries that
        count are in two groups at most: the topic's subscription group of the
        actor's current participation, and the actor's one direct group. Each
        is found by its key, and its first pending row in the topic, in the
        (group, topic, delivery) index, is its oldest; rows a cancelled
        subscription left pending are in other groups and never read. The
        marks are read through the actor's marked index in sequence order,
        stopping at the first row, past only the actor's marks on their own
        messages; the topic's history and other topics are never read."""
        groups = [row[0] for row in db.execute(
            "SELECT g.id FROM topic_participants p CROSS JOIN delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 "
            "ON g.recipient_id=p.actor_id AND g.kind='subscription' AND g.topic_id=p.topic_id AND g.participant_epoch=p.epoch "
            "WHERE p.topic_id=? AND p.actor_id=? AND p.active=1 AND g.active=1", (topic_id, actor))]
        direct = self._addressed_group(db, actor)
        groups += [direct["id"]] if direct is not None else []
        rows = [db.execute("SELECT m.id,m.seq FROM deliveries d INDEXED BY pending_group_topic_deliveries "
                           "CROSS JOIN messages m ON m.id=d.message_id "
                           "WHERE d.group_id=? AND d.topic_id=? AND d.state='pending' ORDER BY d.seq LIMIT 1",
                           (group, topic_id)).fetchone() for group in groups]
        rows.append(db.execute("SELECT k.seq,k.message_id AS id FROM message_marks k INDEXED BY reader_marks "
                           "CROSS JOIN messages m ON m.id=k.message_id "
                           "WHERE k.actor_id=? AND k.topic_id=? AND k.revision%2=1 AND m.author_id<>? ORDER BY k.seq LIMIT 1",
                           (actor, topic_id, actor)).fetchone())
        found = [row for row in rows if row is not None]
        if not found:
            return None
        row = min(found, key=lambda row: row["seq"])
        return {"seq": row["seq"], "id": row["id"]}

    def _new_line(self, db, actor, topic_id):
        """Where the New line sits: the oldest unread message, and the commit it is as of.

        A view reads in one transaction, so commit_seq is the commit the answer
        reflects; reading, marks and replies change no topic version, and a
        page keeps the answer of the latest commit it has read."""
        commit = db.execute("SELECT value FROM metadata WHERE key='commit_seq'").fetchone()[0]
        return {"oldest_unread": self._oldest_unread(db, actor, topic_id), "commit_seq": int(commit)}

    def _view_topic_unread(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        return dict({"instance_id": self.instance_id, "topic_id": topic["id"]}, **self._new_line(db, actor, topic["id"]))

    def _view_attention(self, db, actor, args):
        """What waits for this actor: unread and addressed totals, the newest addressed
        deliveries, and the topics that say they wait on this actor, archived topics left out.

        Each delivery says whether its topic can be opened: a person sent a
        message by name keeps reading it after they lose the topic, archived or
        not, and then acknowledges it directly rather than by reading through the topic.
        """
        counts = self._unread(db, actor)
        waiting, waiting_topics = self._waiting_on_reader(db, actor)
        group = self._addressed_group(db, actor)
        # Newest first in index order, passing over messages in archived topics the
        # outcome's list holds for the reader, as the totals do.
        rows = [] if group is None else db.execute(
            "SELECT d.* FROM deliveries d INDEXED BY pending_group_deliveries CROSS JOIN messages m ON m.id=d.message_id "
            "CROSS JOIN topics t ON t.id=m.topic_id WHERE d.group_id=? AND d.state='pending' AND " + NAMED_OUTSIDE_LISTS + " ORDER BY d.seq DESC LIMIT 5",
            (group["id"],)).fetchall()
        items = []
        for row in rows:
            item = self._delivery_item(db, row)
            try:
                self._topic(db, actor, item["topic"]["id"])
                item["topic_readable"] = True
            except Refusal:
                item["topic_readable"] = False
            items.append(item)
        return {"instance_id": self.instance_id,
                "unread": sum(entry[0] for entry in counts.values()),
                "addressed": sum(entry[1] for entry in counts.values()),
                "latest_addressed": items,
                "waiting_on_me": waiting, "latest_waiting": waiting_topics}

    def _addressed_group(self, db, actor):
        return db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind='direct' AND topic_id='' AND participant_epoch=0 AND active=1",
                          (actor,)).fetchone()

    def _addressed_after(self, db, actor):
        """The newest delivery naming this actor that waits now, or 0.

        Delivery numbers only grow, so a page that opens with this number knows
        that a listed delivery above it arrived after the page opened. One read
        through the pending index, whatever the history.
        """
        group = self._addressed_group(db, actor)
        row = None if group is None else db.execute(
            "SELECT seq FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' ORDER BY seq DESC LIMIT 1",
            (group["id"],)).fetchone()
        return row[0] if row else 0

    def _delivery_item(self, db, row, active=True):
        # The message's own sequence and its topic's title prefix let an inbox
        # line or a wake notice name the place without another read.
        message = dict(db.execute("SELECT m.id,m.seq,m.topic_id,m.author_id,m.intent,substr(m.body,1,256) AS body,length(m.body)>256 AS preview,"
                                  "substr(CAST(t.title AS BLOB),1,1025) AS title_prefix FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?",
                                  (row["message_id"],)).fetchone())
        message["preview"] = bool(message["preview"])
        title, truncated = _prefix(message.pop("title_prefix"))
        item = {key: row[key] for key in ("seq", "id", "message_id", "recipient_id", "state")}
        if row["state"] == "pending" and not active:
            # A pending row of a cancelled subscription can never be settled.
            item["state"] = "cancelled"
        item.update(reasons=self._effective_reasons(db, row), message=message, source_ref={"kind": "message", "id": row["message_id"]},
                    topic={"id": message["topic_id"], "title": title, "title_truncated": truncated})
        return item

    def _view_delivery(self, db, actor, args):
        delivery_id = _identifier(args.get("delivery_id"), "delivery_id")
        row = db.execute("SELECT d.*,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.id=? AND d.recipient_id=?",
                         (delivery_id, actor)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No readable delivery")
        # The item carries the message and its topic, so it is readable only
        # while the message itself is: topic access, or an addressed delivery.
        try:
            self._message_access(db, actor, row["message_id"])
        except Refusal:
            raise Refusal("FORBIDDEN", "No readable delivery")
        return {"instance_id": self.instance_id, "item": self._delivery_item(db, row, active=bool(row["active"]))}

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
                item = self._delivery_item(db, row)
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

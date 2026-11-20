from __future__ import annotations

import base64
import json
import time
import uuid

from .contract import LIMITS, Refusal, StoreError, _identifier, _json, _page_size, _prefix
from .marks import MARKED
from .topic_reading import ADDRESSED, SUBSCRIBED, unread_groups
from .message_edit import current_words, held_refusal, holding, is_held, mark, plain, words_at


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

# Version 25 indexes the pending deliveries by group, topic and delivery instead,
# so the line is found in the reader's live groups alone: the current
# subscription group of the topic and the one direct group, one row each. Rows
# that a subscription cancelled by leaving left pending are never walked. A new
# delivery must name its topic, and one kept with none (the column alone
# allowed it) is given its message's topic first.
DELIVERY_GROUP_TOPIC_SCHEMA = [
    "CREATE INDEX pending_group_topic_deliveries ON deliveries(group_id,topic_id,seq) WHERE state='pending'",
    "CREATE TRIGGER delivery_topic_required BEFORE INSERT ON deliveries WHEN NEW.topic_id IS NULL "
    "BEGIN SELECT RAISE(ABORT, 'a delivery names its topic'); END",
]
DELIVERY_GROUP_TOPIC_UP = (DELIVERY_TOPIC_BACKFILL[0] + " WHERE topic_id IS NULL", "DROP INDEX pending_topic_deliveries") + tuple(DELIVERY_GROUP_TOPIC_SCHEMA)
DELIVERY_GROUP_TOPIC_DOWN = ("DROP TRIGGER delivery_topic_required", "DROP INDEX pending_group_topic_deliveries", DELIVERY_TOPIC_SCHEMA[1])
# Version 25 also settles what earlier versions left pending for a person in a
# message between others: sent by name to others, not to them, and not answering
# a message of theirs. Such a message is never unread for a person
# (Conversation._publish records it settled), so the counters of each person's
# live groups and schedule are worked out again from their pending rows. An
# agent's deliveries are its work and are left as they are.
HUMANS = "(SELECT id FROM actors WHERE kind='human')"
BETWEEN_OTHERS_SETTLE = (
    "UPDATE deliveries SET state='acknowledged' WHERE seq IN (SELECT d.seq FROM deliveries d "
    "CROSS JOIN delivery_groups g ON g.id=d.group_id CROSS JOIN messages m ON m.id=d.message_id "
    "WHERE d.state='pending' AND g.active=1 AND d.recipient_id IN " + HUMANS + " AND m.addressees<>'[]' "
    "AND NOT EXISTS (SELECT 1 FROM delivery_reasons r WHERE r.delivery_id=d.id AND r.reason='addressed') "
    "AND NOT EXISTS (SELECT 1 FROM messages p WHERE p.id=m.reply_to AND p.author_id=d.recipient_id))",
    "UPDATE delivery_groups SET pending_count=(SELECT count(*) FROM deliveries d WHERE d.group_id=delivery_groups.id AND d.state='pending'),"
    "first_pending_seq=(SELECT min(d.seq) FROM deliveries d WHERE d.group_id=delivery_groups.id AND d.state='pending') "
    "WHERE active=1 AND recipient_id IN " + HUMANS,
    "UPDATE recipient_schedule SET pending_count=(SELECT coalesce(sum(g.pending_count),0) FROM delivery_groups g "
    "WHERE g.recipient_id=recipient_schedule.recipient_id AND g.active=1) WHERE recipient_id IN " + HUMANS,
    # A person left with nothing pending is as reading the last of it leaves them
    # (_eligibility_changed): nothing due or handed, and no wake left unanswered.
    "UPDATE recipient_schedule SET next_due_ms=NULL,retry_count=0,handed_seq=NULL,unanswered_wakes=0,unanswered_since_ms=NULL "
    "WHERE pending_count=0 AND recipient_id IN " + HUMANS,
)
DELIVERY_GROUP_TOPIC_UP += BETWEEN_OTHERS_SETTLE
# A fresh instance has the column and the version-25 index and trigger.
DELIVERY_TOPIC_FRESH = DELIVERY_TOPIC_SCHEMA[:1] + DELIVERY_GROUP_TOPIC_SCHEMA

# A message sent by name in an archived topic still waits in the attention view for
# a recipient who has no list of the outcome's topics (neither its owner nor a
# member: a participant from outside it, or someone who lost the topic), so there
# is nowhere else to read it or mark it read. Read with deliveries d and topics t.
NAMED_OUTSIDE_LISTS = ("(t.archived=0 OR NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id=t.workspace_id AND "
                       "(w.owner_id=d.recipient_id OR EXISTS (SELECT 1 FROM workspace_members m "
                       "WHERE m.workspace_id=w.id AND m.actor_id=d.recipient_id))))")


# How long work a recipient was told of, and left pending, waits before it is
# named again: after an accepted notice, and after a hosted turn completed.
REWAKE_MS = 60000


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

    def _pending_above(self, db, actor, seq):
        """True if a delivery newer than seq is still pending in one of the actor's active groups."""
        return db.execute("SELECT 1 FROM delivery_groups g INDEXED BY eligible_groups CROSS JOIN deliveries d INDEXED BY pending_group_deliveries "
                          "ON d.group_id=g.id AND d.state='pending' AND d.seq>? WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 LIMIT 1",
                          (seq, actor)).fetchone() is not None

    def _eligibility_changed(self, db, actor, delta, last_seq=None):
        old = db.execute("SELECT * FROM recipient_schedule WHERE recipient_id=?", (actor,)).fetchone()
        pending = old["pending_count"] + delta
        due, retry, handed = old["next_due_ms"], old["retry_count"], old["handed_seq"]
        captured_done = old["captured_seq"] is not None and (self._pending_head(db, actor) or old["captured_seq"] + 1) > old["captured_seq"]
        # Work handed to a running turn stays quiet until something newer arrives.
        arrived_after_handing = handed is not None and last_seq is not None and last_seq > handed
        if pending == 0:
            due, retry, handed = None, 0, None
            # Nothing waits, so nothing is left unanswered.
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=0,unanswered_since_ms=NULL WHERE recipient_id=? AND unanswered_wakes>0", (actor,))
        elif old["pending_count"] == 0 or captured_done or arrived_after_handing:
            due, retry = _now_ms(), 0
        elif delta < 0 and handed is not None and not self._pending_above(db, actor, handed):
            # The running turn handled what arrived after it was handed its
            # work: only work it already holds is left, so no follow-up.
            due = None
        if pending and old["claim_token"] is not None and old["claim_until_ms"] > _now_ms():
            due = old["claim_until_ms"]
        db.execute("UPDATE recipient_schedule SET pending_count=?,wake_generation=wake_generation+1,last_seq=?,next_due_ms=?,retry_count=?,handed_seq=? WHERE recipient_id=?",
                   (pending, last_seq if last_seq is not None else old["last_seq"], due, retry, handed, actor))

    def _queue_delivery(self, db, message_id, recipient, topic_id, reasons, settled=False, revision=1, request_id=None):
        """Queue one delivery of a message; settled, it is recorded already acknowledged and waits on nobody.

        A correction (reason `correction`, docs/message-edit.md) delivers the message again at a later revision,
        in the recipient's one correction group, which nothing counts as unread or addressed."""
        direct = any(reason != "subscription" for reason in reasons)
        kind = "request" if request_id is not None else "correction" if "correction" in reasons else "direct" if direct else "subscription"
        key = (recipient, kind, "" if direct else topic_id, 0 if direct else reasons["subscription"])
        db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", key)
        group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? AND participant_epoch=?", key).fetchone()[0]
        delivery_id = "d-" + uuid.uuid4().hex
        # A message its author has open in Edit is holding (docs/message-edit.md): an agent's unsettled delivery of it
        # waits in the state 'held', counted nowhere, and its release counts it as an arrival. The one session row's
        # primary key answers whether it is holding.
        held = request_id is None and not settled and holding(db, message_id) and db.execute("SELECT kind FROM actors WHERE id=?", (recipient,)).fetchone()[0] == "agent"
        seq = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id,state,revision,request_id) VALUES (?,?,?,?,?,?,?,?)",
                         (delivery_id, message_id, recipient, group, topic_id, "acknowledged" if settled else "held" if held else "pending", revision, request_id)).lastrowid
        db.executemany("INSERT INTO delivery_reasons VALUES (?,?,?,?)", [(delivery_id, reason, topic_id, epoch) for reason, epoch in reasons.items()])
        if held:
            # Its release counts it and reads the recipient's schedule, so the schedule row exists from now (it counts nothing).
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) SELECT id,enabled FROM actors WHERE id=? ON CONFLICT DO NOTHING", (recipient,))
        if settled or held:
            return delivery_id
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
        if row["state"] == "held":
            # Its message is open in Edit (docs/message-edit.md): held is not pending, and is never acknowledged. A hold
            # that has lapsed is released first, in this transaction, and the row is pending again.
            now = _now_ms()
            if is_held(db, row["message_id"], now):
                raise held_refusal(row["message_id"])
            self._release(db, row["message_id"], now)
            row = db.execute("SELECT d.*,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.id=?", (delivery_id,)).fetchone()
            if row["state"] != "pending":
                raise StoreError("A held delivery's message is not holding")
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
                                       "WHERE " + SUBSCRIBED + " AND g.pending_count>0" + scope + " GROUP BY g.topic_id",
                                       (actor,) + values)
        else:
            subscriptions = db.execute("SELECT g.topic_id,t.workspace_id,SUM(g.pending_count) AS pending FROM delivery_groups g INDEXED BY eligible_groups "
                                       "CROSS JOIN topics t ON t.id=g.topic_id "
                                       "WHERE " + SUBSCRIBED + " AND g.pending_count>0" + scope + " GROUP BY g.topic_id",
                                       (actor,) + values)
        for row in subscriptions:
            counts[row["topic_id"]] = [row["pending"], 0, row["workspace_id"]]
        for row in db.execute("SELECT m.topic_id,t.workspace_id,COUNT(*) AS pending FROM delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 "
                              "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                              "CROSS JOIN messages m ON m.id=d.message_id CROSS JOIN topics t ON t.id=m.topic_id "
                              "WHERE " + ADDRESSED + " AND g.pending_count>0"
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
        """The oldest message in one topic that is unread for this actor, as {seq, id, sent_ms}, or None.

        sent_ms is when it was sent, so the New line can say so before its card
        is loaded; null for a message from before times were kept.

        Unread is what the counts hold (_unread), by the same rule read from
        the same place (topic_reading.SUBSCRIBED and ADDRESSED, marks.MARKED):
        a delivery pending in an active group, or a mark. So a topic whose
        count is above nought always has a message here for its count to lead
        to (item 613). A delivery left pending by a subscription the actor's
        leaving cancelled is not unread, and the actor's own messages, which
        are never delivered to them, do not count even when marked.

        Deliveries are queued in the transaction that writes their message, so
        delivery order is message order. The actor's pending deliveries that
        count are in two groups at most: the topic's active subscription group,
        which is their current participation's, and the actor's one direct
        group. Each is found by its key, and its first pending row in the
        topic, in the (group, topic, delivery) index, is its oldest; rows a
        cancelled subscription left pending are in other groups and never read.
        The marks are read through the actor's marked index in sequence order,
        stopping at the first one counted, past only marks the counts leave
        out (on the actor's own messages, or on a message a delivery above
        counts already); the topic's history and other topics are never read."""
        groups = unread_groups(db, actor, topic_id)
        rows = [db.execute("SELECT m.id,m.seq,m.sent_ms FROM deliveries d INDEXED BY pending_group_topic_deliveries "
                           "CROSS JOIN messages m ON m.id=d.message_id "
                           "WHERE d.group_id=? AND d.topic_id=? AND d.state='pending' ORDER BY d.seq LIMIT 1",
                           (group, topic_id)).fetchone() for group in groups]
        # The marks the counts count (MARKED): one whose message a pending delivery counts already is found above.
        rows.append(db.execute("SELECT k.seq,k.message_id AS id,m.sent_ms FROM message_marks k INDEXED BY reader_marks "
                           "CROSS JOIN topics t ON t.id=k.topic_id CROSS JOIN workspaces w ON w.id=t.workspace_id "
                           "CROSS JOIN messages m ON m.id=k.message_id "
                           "WHERE k.actor_id=? AND k.topic_id=? AND " + MARKED + " ORDER BY k.seq LIMIT 1",
                           (actor, topic_id)).fetchone())
        found = [row for row in rows if row is not None]
        if not found:
            return None
        row = min(found, key=lambda row: row["seq"])
        return {"seq": row["seq"], "id": row["id"], "sent_ms": row["sent_ms"]}

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
        here_id = args.get("workspace_id")
        if here_id is not None:
            _identifier(here_id, "workspace_id")
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
                "waiting_on_me": waiting, "latest_waiting": waiting_topics,
                # The asks that hold a piece or a release, listed first (item 259, blocking.py).
                "blocking": self._blocking_on(db, actor)[:5],
                "waiting_outcomes": self._waiting_outcomes(db, actor, here_id)}

    def _addressed_group(self, db, actor):
        return db.execute("SELECT g.id FROM delivery_groups g WHERE " + ADDRESSED, (actor,)).fetchone()

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
        if row["request_id"] is not None:
            return self._request_delivery_item(db, row)
        # The message's own sequence and its topic's title prefix let an inbox
        # line or a wake notice name the place without another read.
        message = dict(db.execute("SELECT m.id,m.seq,m.topic_id,m.author_id,m.intent,m.private_to IS NOT NULL AS whisper,"
                                  "substr(CAST(t.title AS BLOB),1,1025) AS title_prefix FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?",
                                  (row["message_id"],)).fetchone())
        # A delivery shows the message's latest words; a correction shows the words of its own revision (message_edit.py).
        # The words are read plain and cut, and only the cut is marked as handed (the boundary, message_edit.py).
        if row["revision"] == 1:
            body, message["revision"], message["edited_ms"] = current_words(db, row["message_id"], plain=True)
        else:
            (body, message["edited_ms"]), message["revision"] = words_at(db, row["message_id"], row["revision"], plain=True), row["revision"]
        message["body"], message["preview"], message["whisper"] = (mark(row["message_id"], message["revision"], body[:256]), len(body) > 256,
                                                                   bool(message["whisper"]))
        message["withdrawal"] = self._withdrawal_value(db, row["message_id"])
        message["question"] = self._question_value(db, row["recipient_id"], row["message_id"]) if message["intent"] == "ask" else None
        title, truncated = _prefix(message.pop("title_prefix"))
        item = {key: row[key] for key in ("seq", "id", "message_id", "recipient_id", "state")}
        if row["revision"] != 1:
            item["correction"] = {"revision": row["revision"]}
        if row["state"] == "pending" and not active:
            # A pending row of a cancelled subscription can never be settled.
            item["state"] = "cancelled"
        item.update(reasons=self._effective_reasons(db, row), message=message, source_ref={"kind": "message", "id": row["message_id"]},
                    topic={"id": message["topic_id"], "title": title, "title_truncated": truncated})
        # An agent that names the message's dossier, which nobody has named, is told so with the work (item 479).
        if row["state"] == "pending" and row["revision"] == 1 and not message["whisper"] and self._actor_kind(db, row["recipient_id"]) == "agent":
            name_it = self._name_it(db, row["recipient_id"], row["message_id"])
            if name_it is not None:
                item["name_it"] = name_it
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
            if row["request_id"] is not None:
                if not self._request_readable(db, actor, row):
                    raise Refusal("FORBIDDEN", "No readable delivery")
            else:
                self._message_access(db, actor, row["message_id"])
        except Refusal:
            raise Refusal("FORBIDDEN", "No readable delivery")
        if row["state"] == "held":
            # Its message is open in Edit: the delivery comes back once its author saves or leaves it (docs/message-edit.md).
            raise held_refusal(row["message_id"])
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
            while True:
                wanted = limit - len(answer["items"]) + 1
                rows = db.execute("SELECT * FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' AND seq>? ORDER BY seq LIMIT ?",
                                  (group_id, seq, wanted)).fetchall()
                for row in rows:
                    if len(answer["items"]) == limit:
                        answer["next_cursor"] = _cursor(*last)
                        return answer
                    if ((row["request_id"] is not None and not self._request_readable(db, actor, row))
                            or not self._correction_readable(db, actor, row)):
                        # A correction of a message the actor can no longer read is never shown, even in a preview.
                        last = (group_id, row["seq"])
                        continue
                    item = self._delivery_item(db, row)
                    candidate = dict(answer, items=answer["items"] + [item], next_cursor=_cursor(group_id, row["seq"]))
                    if len(_json(plain(candidate)).encode("utf-8")) > LIMITS["summary_utf8_bytes"]:
                        if not answer["items"]:
                            raise Refusal("SUMMARY_ITEM_TOO_LARGE", "This preview exceeds the configured response limit")
                        answer["next_cursor"] = _cursor(*last)
                        return answer
                    answer["items"].append(item)
                    last = (group_id, row["seq"])
                # A previous page may have ended at this group's last row. Advance
                # the continuation even if all its pending rows precede that cursor.
                seq = rows[-1]["seq"] if rows else seq
                last = (group_id, seq)
                # Rows left out above leave room on the page: read on in this group until it is done.
                if len(rows) < wanted:
                    break
        if len(groups) == 100:
            answer["next_cursor"] = _cursor(*last)
        return answer

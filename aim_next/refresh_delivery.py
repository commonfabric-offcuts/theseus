from __future__ import annotations

"""Typed refresh requests in the existing delivery queue (docs/refresh-requests-829.md)."""

from .contract import Refusal, _prefix
from .message_edit import DELIVERY_INDEXES, DELIVERIES_40


REQUEST_TABLE = [
    "CREATE TABLE refresh_requests (id TEXT PRIMARY KEY, act_id INTEGER NOT NULL UNIQUE REFERENCES message_acts(id), "
    "message_id TEXT NOT NULL REFERENCES messages(id), root_id TEXT NOT NULL REFERENCES messages(id), "
    "topic_id TEXT NOT NULL REFERENCES topics(id), kind TEXT NOT NULL CHECK(kind IN ('cover_refresh','message_refresh')), "
    "requester_id TEXT NOT NULL REFERENCES actors(id), recipient_id TEXT NOT NULL REFERENCES actors(id), "
    "observed_revision INTEGER NOT NULL CHECK(observed_revision>=0), body TEXT NOT NULL, created_ms INTEGER NOT NULL)",
    "CREATE TRIGGER refresh_request_kept_u BEFORE UPDATE ON refresh_requests BEGIN SELECT RAISE(ABORT,'a request keeps its words'); END",
    "CREATE TRIGGER refresh_request_kept_d BEFORE DELETE ON refresh_requests BEGIN SELECT RAISE(ABORT,'a request is kept'); END",
]
REQUEST_DELIVERIES = (
    "CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, "
    "message_id TEXT REFERENCES messages(id), recipient_id TEXT NOT NULL REFERENCES actors(id), "
    "group_id INTEGER NOT NULL REFERENCES delivery_groups(id), state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, "
    "revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), request_id TEXT REFERENCES refresh_requests(id), "
    "UNIQUE(message_id,recipient_id,revision), UNIQUE(request_id), "
    "CHECK((message_id IS NOT NULL)+(request_id IS NOT NULL)=1), CHECK(request_id IS NULL OR revision=1))")
REQUEST_GUARD = [
    "CREATE TRIGGER request_delivery_recipient BEFORE INSERT ON deliveries WHEN NEW.request_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM refresh_requests r JOIN actors a ON a.id=r.recipient_id JOIN delivery_groups g ON g.id=NEW.group_id "
    "WHERE r.id=NEW.request_id AND r.recipient_id=NEW.recipient_id AND r.topic_id=NEW.topic_id AND a.kind='agent' "
    "AND g.recipient_id=NEW.recipient_id AND g.kind='request') "
    "BEGIN SELECT RAISE(ABORT,'a request belongs to its addressed agent'); END",
]


def _delivery_variant(table):
    # Keep the old unique key, row ids, sequence high-water, reasons, indexes
    # and trigger verbatim. Existing deliveries gain only a null request_id.
    columns = "seq,id,message_id,recipient_id,group_id,state,topic_id,revision"
    return [
        "CREATE TABLE deliveries_829_kept AS SELECT " + columns + " FROM deliveries",
        "CREATE TABLE reasons_829_kept AS SELECT delivery_id,reason,topic_id,participant_epoch FROM delivery_reasons",
        "CREATE TABLE sequence_829_kept AS SELECT seq FROM sqlite_sequence WHERE name='deliveries'",
        "DELETE FROM delivery_reasons", "DROP TABLE deliveries", table,
        "INSERT INTO deliveries(" + columns + ") SELECT " + columns + " FROM deliveries_829_kept ORDER BY seq",
        "DELETE FROM sqlite_sequence WHERE name='deliveries'",
        "INSERT INTO sqlite_sequence(name,seq) SELECT 'deliveries',seq FROM sequence_829_kept",
        "INSERT INTO delivery_reasons SELECT * FROM reasons_829_kept",
        "DROP TABLE sequence_829_kept", "DROP TABLE reasons_829_kept", "DROP TABLE deliveries_829_kept",
    ] + DELIVERY_INDEXES


REQUEST_UP = REQUEST_TABLE + _delivery_variant(REQUEST_DELIVERIES) + REQUEST_GUARD
REQUEST_DOWN = _delivery_variant(DELIVERIES_40) + ["DROP TABLE refresh_requests"]
REQUEST_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM refresh_requests)"


class RefreshDelivery:
    def _request_readable(self, db, actor, row):
        request = db.execute("SELECT recipient_id,message_id FROM refresh_requests WHERE id=?", (row["request_id"],)).fetchone()
        if request is None or request["recipient_id"] != actor or self._actor_kind(db, actor) != "agent":
            return False
        try:
            self._acted_message(db, actor, {"message_id": request["message_id"]})
        except Refusal:
            return False
        return True

    def _request_delivery_item(self, db, row):
        # Recipient filtering is repeated here: neither a broad queue read nor
        # a direct delivery lookup can substitute another reader's identity.
        if not self._request_readable(db, row["recipient_id"], row):
            raise Refusal("FORBIDDEN", "No readable delivery")
        request = dict(db.execute(
            "SELECT id,message_id,root_id,topic_id,kind,requester_id,recipient_id,observed_revision,body,created_ms "
            "FROM refresh_requests WHERE id=? AND recipient_id=?", (row["request_id"], row["recipient_id"])).fetchone())
        title = db.execute("SELECT substr(CAST(title AS BLOB),1,1025) FROM topics WHERE id=?", (request["topic_id"],)).fetchone()[0]
        title, truncated = _prefix(title)
        return {"seq": row["seq"], "id": row["id"], "message_id": None, "recipient_id": row["recipient_id"],
                "state": row["state"], "reasons": ["request"], "request": request,
                "source_ref": {"kind": "message", "id": request["message_id"]},
                "topic": {"id": request["topic_id"], "title": title, "title_truncated": truncated}}

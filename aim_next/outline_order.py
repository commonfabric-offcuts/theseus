from __future__ import annotations

"""The order a person keeps their outcomes in, and each outcome's topics, for themselves alone
(docs/outline-order.md).

The outline lists outcomes in the order Core gives them and each outcome's
topics newest stable position first. A person may move a row up or down; what they
placed is kept here, not in a browser, so it follows them to every page and
device, and nobody else sees it. One order for their outcomes, and one for the
topics of each outcome they can read.

An order is a list of ids. Reading it, Core leaves out what the person can no
longer place (an outcome they left, a topic gone from the outcome), so a client
never sends back what it would be refused. What a client shows is worked out
there: the ids placed keep their order, and anything the person never placed
follows its stable position relative to them (web/outline-order.mjs).

An order changes no message, topic, outcome, count or light: it writes one
actor-scoped change, and nothing to a topic's or outcome's scope. Its revision
only grows and rows are never deleted, so a late request never undoes a newer
order made on another device.
"""

import json

from .contract import LIMITS, Refusal, _identifier


ORDER_SCHEMA = [
    "CREATE TABLE outline_orders (actor_id TEXT NOT NULL REFERENCES actors(id), within TEXT NOT NULL, "
    "ids TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(actor_id,within))",
]
ORDER_DOWN = ("DROP TABLE outline_orders",)
# Any row, an emptied one included: dropping it would restart its revisions at 0.
ORDER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM outline_orders)"
# The outcomes' own order is kept under the empty name; an outcome's id is never empty.
OUTCOMES = ""


# Derive the default order from the first recorded topic change. Future topics get a monotonic position in
# their creation transaction, never from activity or a browser's observations.
TOPIC_POSITION_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN list_position INTEGER NOT NULL DEFAULT 0",
    "WITH ranked AS (SELECT t.id,row_number() OVER (ORDER BY coalesce((SELECT c.seq FROM changes c "
    "WHERE c.scope_kind='topic' AND c.scope_id=t.id AND c.resource_kind='topic' AND c.resource_id=t.id ORDER BY c.seq LIMIT 1),0),t.id) AS position FROM topics t) "
    "UPDATE topics SET list_position=(SELECT position FROM ranked WHERE ranked.id=topics.id)",
    "CREATE TABLE topic_position_clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value INTEGER NOT NULL)",
    "INSERT INTO topic_position_clock SELECT 1,1000000000 FROM topics",
    "CREATE TRIGGER topic_position_insert AFTER INSERT ON topics BEGIN "
    "UPDATE topic_position_clock SET value=value-1 WHERE singleton=1; "
    "UPDATE topics SET list_position=(SELECT value FROM topic_position_clock WHERE singleton=1) WHERE id=NEW.id; END",
    "DROP INDEX workspace_topic_order",
    "CREATE INDEX workspace_topic_order ON topics(workspace_id,archived,state='done',list_position DESC,id DESC)",
]
TOPIC_POSITION_DOWN = (
    "DROP TRIGGER topic_position_insert", "DROP TABLE topic_position_clock", "DROP INDEX workspace_topic_order",
    "ALTER TABLE topics DROP COLUMN list_position",
    "CREATE INDEX workspace_topic_order ON topics(workspace_id,archived,state='done',activity_ms DESC,id DESC)",
)
TOPIC_POSITION_OCCUPIED = None  # Rebuilt from the retained creation changes; saved orders are separate records.


class OutlineOrder:
    def _order_row(self, db, actor, within):
        """The person's own row for one scope, or None while they have placed nothing there."""
        return db.execute("SELECT ids,revision FROM outline_orders WHERE actor_id=? AND within=?", (actor, within)).fetchone()

    def _outline_order(self, db, actor, within=OUTCOMES):
        """{ids, revision}: the person's order, without what they can no longer place, in order."""
        row = self._order_row(db, actor, within)
        if row is None:
            return {"ids": [], "revision": 0}
        if within == OUTCOMES:
            ids = db.execute("SELECT j.value FROM json_each(?) AS j JOIN workspace_members AS m ON m.workspace_id=j.value AND m.actor_id=? "
                             "ORDER BY j.key", (row["ids"], actor)).fetchall()
        else:
            ids = db.execute("SELECT j.value FROM json_each(?) AS j JOIN topics AS t ON t.id=j.value AND t.workspace_id=? "
                             "ORDER BY j.key", (row["ids"], within)).fetchall()
        return {"ids": [value for (value,) in ids], "revision": row["revision"]}

    def _command_outline_order_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) - {"workspace_id"} or set(args) != {"ids"} or not isinstance(args["ids"], list):
            raise Refusal("INVALID_ARGUMENT", "Name the outcome whose topics these are, or none for your outcomes, and the ids in order")
        ids = args["ids"]
        if len(ids) > LIMITS["order_ids"]:
            raise Refusal("INVALID_ARGUMENT", "An order holds at most %d places" % LIMITS["order_ids"])
        for value in ids:
            _identifier(value, "id")
        if len(set(ids)) != len(ids):
            raise Refusal("INVALID_ARGUMENT", "Each place in an order is named once")
        if len(json.dumps(ids, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > LIMITS["order_utf8_bytes"]:
            raise Refusal("INVALID_ARGUMENT", "An order holds at most %d bytes" % LIMITS["order_utf8_bytes"])
        within = OUTCOMES
        if "workspace_id" in target:
            workspace = self._workspace(db, actor, target["workspace_id"])
            within = workspace["id"]
            known = {value for (value,) in db.execute("SELECT t.id FROM json_each(?) AS j JOIN topics AS t ON t.id=j.value AND t.workspace_id=?",
                                                      (json.dumps(ids), within))}
            if len(known) != len(ids):
                raise Refusal("INVALID_ARGUMENT", "Each topic in this order must be one of this outcome's")
        else:
            on = {value for (value,) in db.execute("SELECT m.workspace_id FROM json_each(?) AS j JOIN workspace_members AS m "
                                                   "ON m.workspace_id=j.value AND m.actor_id=?", (json.dumps(ids), actor))}
            if len(on) != len(ids):
                # The same words for an outcome that does not exist, so a refusal tells nobody it does.
                raise Refusal("FORBIDDEN", "You can only place the outcomes you are on")
        row = self._order_row(db, actor, within)
        current, revision = (json.loads(row["ids"]), row["revision"]) if row else ([], 0)
        # Fenced on the revision its sender read, so a late request never undoes a newer order.
        expected = envelope["expected"].get("order_revision")
        if isinstance(expected, bool) or not isinstance(expected, int):
            raise Refusal("INVALID_ARGUMENT", "An explicit order_revision is required")
        if expected != revision:
            raise Refusal("REVISION_CONFLICT", "This order changed since it was read; nothing was changed", {"order_revision": revision})
        result = {"workspace_id": within or None, "ids": ids}
        if ids == current:
            return dict(result, order_revision=revision, changed=False), []
        revision += 1
        db.execute("INSERT INTO outline_orders(actor_id,within,ids,revision) VALUES (?,?,?,?) "
                   "ON CONFLICT(actor_id,within) DO UPDATE SET ids=excluded.ids,revision=excluded.revision",
                   (actor, within, json.dumps(ids, separators=(",", ":")), revision))
        kind, key = ("topic_order", within) if within else ("outcome_order", actor)
        self._change(db, "actor", actor, kind, key, revision)
        return dict(result, order_revision=revision, changed=True), [{"kind": kind, "id": key, "version": revision}]

from __future__ import annotations

"""Atomic current dossier membership, with unchanged message identities (docs/dossier-move-774.md)."""

import json

from .contract import READABLE, Refusal, _identifier, _page_size
from .delivery import _now_ms
from .stacks import MEMBERS, StackRoots
from .reactions import answered_yes
from .whispers import VISIBLE, visible
from .removal import VISIBLE as NOT_UNSENT

MAX_MEMBERS = 1000
MAX_DELIVERIES = 4000
# Visibility is admission for a reader, never a definition of stored membership.
ALL_MEMBERS = MEMBERS.replace(VISIBLE, "1").replace("\n        )", "\n          LIMIT %d\n        )" % (MAX_MEMBERS + 1))
MESSAGE_COLUMNS = "seq,id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id,sent_ms,intent,private_to,about_id,go_ahead"


def _immutable_except_topic(table, trigger, columns, identity):
    unchanged = " AND ".join("NEW.%s IS OLD.%s" % (c, c) for c in columns.split(","))
    return ("CREATE TRIGGER %s BEFORE UPDATE ON %s WHEN NOT ((%s) AND EXISTS "
            "(SELECT 1 FROM dossier_move_members p JOIN dossier_moves d ON d.id=p.move_id "
            "WHERE p.message_id=OLD.%s AND d.from_topic_id=OLD.topic_id AND d.topic_id=NEW.topic_id "
            "AND d.id=(SELECT max(q.move_id) FROM dossier_move_members q WHERE q.message_id=p.message_id))) "
            "BEGIN SELECT RAISE(ABORT, 'immutable content; membership needs a recorded move'); END" %
            (trigger, table, unchanged, identity))


MOVE_SCHEMA = [
    "CREATE TABLE dossier_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, root_id TEXT NOT NULL REFERENCES messages(id), "
    "from_topic_id TEXT NOT NULL REFERENCES topics(id), topic_id TEXT NOT NULL REFERENCES topics(id), actor_id TEXT NOT NULL REFERENCES actors(id), "
    "operation_id TEXT NOT NULL, revision INTEGER NOT NULL, at_ms INTEGER NOT NULL, UNIQUE(root_id,revision))",
    "CREATE INDEX moves_from_topic ON dossier_moves(from_topic_id,id)",
    "CREATE INDEX moves_to_topic ON dossier_moves(topic_id,id)",
    "CREATE TABLE dossier_move_members (move_id INTEGER NOT NULL REFERENCES dossier_moves(id), message_id TEXT NOT NULL REFERENCES messages(id), PRIMARY KEY(move_id,message_id))",
    "CREATE INDEX member_moves ON dossier_move_members(message_id,move_id)",
    "DROP TRIGGER immutable_messages_update",
    _immutable_except_topic("messages", "immutable_messages_update", MESSAGE_COLUMNS, "id"),
    "DROP TRIGGER blocks_stay_u",
    _immutable_except_topic("message_blocks", "blocks_stay_u", "message_id,workspace_id,seq,kind,ref", "message_id"),
] + ["CREATE TRIGGER %s_%s BEFORE %s ON %s BEGIN SELECT RAISE(ABORT, 'immutable move'); END" %
     (table, suffix, action, table) for table in ("dossier_moves", "dossier_move_members")
     for suffix, action in (("kept_u", "UPDATE"), ("kept_d", "DELETE"))]
MOVE_DOWN = ["DROP TRIGGER immutable_messages_update",
             "CREATE TRIGGER immutable_messages_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'immutable message'); END",
             "DROP TRIGGER blocks_stay_u",
             "CREATE TRIGGER blocks_stay_u BEFORE UPDATE ON message_blocks BEGIN SELECT RAISE(ABORT, 'a message keeps what it blocks'); END",
             "DROP TABLE dossier_move_members", "DROP TABLE dossier_moves"]
MOVE_OCCUPIED = "SELECT EXISTS(SELECT 1 FROM dossier_moves)"


def members(db, root):
    return db.execute(ALL_MEMBERS + " SELECT m.id,m.seq,m.topic_id,m.author_id,m.private_to,m.addressees,m.intent,m.sent_ms "
                      "FROM members p CROSS JOIN messages m ON m.id=p.id ORDER BY m.seq", {"root": root}).fetchall()


def revision(db, root):
    return db.execute("SELECT coalesce(max(revision),0) FROM dossier_moves WHERE root_id=?", (root,)).fetchone()[0]


def move_fields(db, actor, root):
    row = db.execute("SELECT t.id,t.archived,t.kind,t.replaced_by,w.owner_id,w.id AS workspace_id FROM messages m "
                     "JOIN topics t ON t.id=m.topic_id JOIN workspaces w ON w.id=t.workspace_id WHERE m.id=?", (root,)).fetchone()
    allowed = False
    closed = row and (db.execute("SELECT 1 FROM outcome_reached WHERE workspace_id=?", (row["workspace_id"],)).fetchone()
                      or db.execute("SELECT state FROM outcome_ends WHERE workspace_id=? ORDER BY seq DESC LIMIT 1", (row["workspace_id"],)).fetchone())
    ended = closed is not None and (len(closed) == 1 and closed[0] != "open")
    if row and not ended and not row["archived"] and row["kind"] != "conversation" and row["replaced_by"] is None:
        if row["owner_id"] == actor:
            allowed = True
        elif db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()[0] == "agent":
            found = members(db, root)
            if len(found) <= MAX_MEMBERS:
                agents = {r["author_id"] for r in found if db.execute("SELECT kind FROM actors WHERE id=?", (r["author_id"],)).fetchone()[0] == "agent"}
                allowed = next((r["author_id"] for r in found if r["author_id"] in agents), None) == actor
    return {"can_move": allowed, "move_revision": revision(db, root)}


def membership_revision(db, topic, actor):
    # Historical membership matters even when its current destination is unreadable:
    # a reader must remove formerly visible cards and reject late pre-move pages.
    # Whisper visibility is immutable; an invisible private move changes no fence.
    return db.execute("SELECT coalesce(max(d.id),0) FROM dossier_moves d "
                      "WHERE (d.from_topic_id=:topic OR d.topic_id=:topic) AND EXISTS "
                      "(SELECT 1 FROM dossier_move_members p JOIN messages m ON m.id=p.message_id "
                      "WHERE p.move_id=d.id AND " + VISIBLE + ")",
                      {"topic": topic, "actor": actor}).fetchone()[0]


def readers(db, topic):
    return {r[0] for r in db.execute("SELECT w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?1 "
                                   "UNION SELECT creator_id FROM topics WHERE id=?1 "
                                   "UNION SELECT m.actor_id FROM topics t JOIN workspace_members m ON m.workspace_id=t.workspace_id WHERE t.id=?1 "
                                   "UNION SELECT actor_id FROM topic_participants WHERE topic_id=?1 AND active=1", (topic,))}


class DossierMove:
    def _move_root(self, db, actor, message_id):
        message, topic = self._acted_message(db, actor, {"message_id": message_id})
        root = StackRoots(db, actor).root(message["id"])
        # Do not offer an operation on a partial/reader-relative root whose hidden parent could be left behind.
        first = db.execute("SELECT m.reply_to,(SELECT json_extract(value,'$.into') FROM message_acts a "
                           "WHERE a.message_id=m.id AND a.kind='join' AND a.owner='' ORDER BY revision DESC LIMIT 1) AS joined "
                           "FROM messages m WHERE m.id=?", (root,)).fetchone()
        parent = first["joined"] or first["reply_to"]
        if parent and db.execute("SELECT 1 FROM messages WHERE id=? AND topic_id=?", (parent, topic["id"])).fetchone():
            raise Refusal("STACK_CHANGED", "Read the whole dossier before moving it; nothing was moved")
        fields = move_fields(db, actor, root)
        if not fields["can_move"]:
            raise Refusal("FORBIDDEN", "Only the outcome's owner or this dossier's agent can move it")
        return message, topic, root, fields

    def _command_stack_move(self, db, actor, envelope):
        if set(envelope["target"]) != {"message_id"} or set(envelope["args"]) != {"topic_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name a dossier's first message and its new topic")
        message, source, root, fields = self._move_root(db, actor, envelope["target"]["message_id"])
        if message["id"] != root or envelope["expected"].get("source_topic_id") != source["id"]:
            raise Refusal("STACK_CHANGED", "This dossier moved or joined another; read it again before moving it")
        if envelope["expected"]["move_revision"] != fields["move_revision"]:
            raise Refusal("REVISION_CONFLICT", "This dossier moved since it was read; nothing was moved", {"move_revision": fields["move_revision"]})
        destination = self._topic(db, actor, envelope["args"]["topic_id"])
        if destination["id"] == source["id"] or destination["workspace_id"] != source["workspace_id"]:
            raise Refusal("INVALID_ARGUMENT", "Choose another topic in this outcome")
        if any(t["archived"] or t["kind"] == "conversation" or t["replaced_by"] is not None for t in (source, destination)):
            raise Refusal("MOVE_TOPIC_UNAVAILABLE", "Choose an open topic in this outcome; nothing was moved")
        closed = self._closed(db, source["workspace_id"])
        if closed is not None:
            raise self._closed_refusal(db, actor, source["workspace_id"], closed)
        found = members(db, root)
        if len(found) > MAX_MEMBERS:
            raise Refusal("DOSSIER_TOO_LARGE", "This dossier is too large to move in one act; nothing was moved")
        before, after = readers(db, source["id"]), readers(db, destination["id"])
        if not after <= before:
            raise Refusal("MOVE_WOULD_EXPAND_ACCESS", "People in that topic could not read this dossier here; nothing was moved")
        for item in found:
            required = {item["author_id"]} | set(json.loads(item["addressees"]))
            if not required <= after:
                raise Refusal("MOVE_REPLY_PATH_UNAVAILABLE", "Someone in this dossier could not reply in that topic; nothing was moved")
        ids = [item["id"] for item in found]
        delivery_count = db.execute("SELECT count(*) FROM (SELECT 1 FROM deliveries WHERE message_id IN (%s) LIMIT ?)" % ",".join("?" * len(ids)), ids + [MAX_DELIVERIES + 1]).fetchone()[0]
        if delivery_count > MAX_DELIVERIES:
            raise Refusal("DOSSIER_TOO_LARGE", "This dossier has too many delivery records to move in one act; nothing was moved")
        waiting = db.execute("SELECT q.*,m.seq AS ask_seq FROM topic_waiting q JOIN messages m ON m.id=q.ask_message_id WHERE q.topic_id=?", (source["id"],)).fetchall()
        next_revision = fields["move_revision"] + 1
        move = db.execute("INSERT INTO dossier_moves(root_id,from_topic_id,topic_id,actor_id,operation_id,revision,at_ms) VALUES (?,?,?,?,?,?,?)",
                          (root, source["id"], destination["id"], actor, envelope["operation_id"], next_revision, _now_ms())).lastrowid
        db.executemany("INSERT INTO dossier_move_members VALUES (?,?)", [(move, item["id"]) for item in found])
        # Every following write is covered by Store's effect savepoint and BEGIN IMMEDIATE, including the receipt.
        ids = [item["id"] for item in found]
        marks = ",".join("?" * len(ids))
        removed = {row[0]: row[1] for row in db.execute(
            "SELECT message_id,kind FROM message_removals WHERE message_id IN (%s)" % marks, ids)}
        for table, key in (("messages", "id"), ("message_acts", "message_id"), ("message_marks", "message_id"),
                           ("message_blocks", "message_id"), ("message_reactions", "message_id"), ("message_addressees", "seq")):
            values = [item["seq"] for item in found] if key == "seq" else ids
            db.execute("UPDATE %s SET topic_id=? WHERE %s IN (%s)" % (table, key, marks), [destination["id"]] + values)
        # Preserve each reader's personal position with the dossier. The root
        # identity stays the same; a previous visit's dormant row is replaced.
        db.execute("INSERT INTO dossier_order SELECT actor_id,?,root_id,key,entry_key,tie FROM dossier_order "
                   "WHERE topic_id=? AND root_id IN (%s) "
                   "ON CONFLICT(actor_id,topic_id,root_id) DO UPDATE SET key=excluded.key,entry_key=excluded.entry_key,tie=excluded.tie" % marks,
                   [destination["id"], source["id"]] + ids)
        db.execute("DELETE FROM dossier_order WHERE topic_id=? AND root_id IN (%s)" % marks, [source["id"]] + ids)
        self._move_deliveries(db, ids, destination)
        db.execute("UPDATE ask_cover_links SET topic_id=? WHERE ask_id IN (%s)" % marks,
                   [destination["id"]] + ids)
        # Cover waits follow their messages in this same transaction. Their
        # immutable cover acts remain the source for rebuilding the index.
        db.execute("UPDATE cover_waiting SET topic_id=?,workspace_id=? WHERE message_id IN (%s)" % marks,
                   [destination["id"], destination["workspace_id"]] + ids)
        self._move_waits(db, found, source, destination, waiting, removed)
        # Membership retains unsent history, while shared summaries count only
        # readable public messages. Retractions remain readable original words.
        public = sum(item["private_to"] is None and removed.get(item["id"]) != "unsent" for item in found)
        for topic, delta in ((source, -public), (destination, public)):
            latest = db.execute("SELECT m.id,m.author_id FROM messages m WHERE m.topic_id=? AND m.private_to IS NULL AND " + NOT_UNSENT + " ORDER BY m.seq DESC LIMIT 1", (topic["id"],)).fetchone()
            other = db.execute("SELECT m.id FROM messages m WHERE m.topic_id=? AND m.private_to IS NULL AND m.author_id<>? AND " + NOT_UNSENT + " ORDER BY m.seq DESC LIMIT 1",
                               (topic["id"], latest["author_id"])).fetchone() if latest else None
            db.execute("UPDATE topic_summaries SET message_count=message_count+?,latest_message_id=?,other_message_id=? WHERE topic_id=?",
                       (delta, latest["id"] if latest else None, other[0] if other else None, topic["id"]))
            # A private dossier never advertises its move on a shared scope.
            if message["private_to"] is None:
                self._touch_topic(db, topic)
            for reader in before | after:
                if message["private_to"] is None or reader in (message["author_id"], message["private_to"]):
                    self._change(db, "actor", reader, "dossier_move", topic["id"], move)
        for item in found:
            if item["private_to"] is None or db.execute("SELECT kind FROM actors WHERE id=?", (item["author_id"],)).fetchone()[0] == "human":
                db.execute("INSERT INTO reply_horizons VALUES (?,?,?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET seq=max(seq,excluded.seq)",
                           (destination["id"], item["author_id"], item["seq"] + 1))
        return {"root_id": root, "from_topic_id": source["id"], "topic_id": destination["id"],
                "move_revision": next_revision, "changed": True}, []

    def _move_deliveries(self, db, ids, destination):
        marks = ",".join("?" * len(ids))
        rows = db.execute("SELECT d.*,g.kind,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                          "WHERE d.message_id IN (%s)" % marks, ids).fetchall()
        for row in rows:
            group = row["group_id"]
            if row["kind"] == "subscription":
                participant = db.execute("SELECT epoch FROM topic_participants WHERE topic_id=? AND actor_id=? AND active=1",
                                         (destination["id"], row["recipient_id"])).fetchone()
                if participant and row["active"]:
                    key = (row["recipient_id"], destination["id"], participant[0])
                    db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES (?,'subscription',?,?) ON CONFLICT DO NOTHING", key)
                    group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind='subscription' AND topic_id=? AND participant_epoch=?", key).fetchone()[0]
                    if row["state"] == "pending":
                        db.execute("UPDATE deliveries SET group_id=? WHERE id=?", (group, row["id"]))
                        for gid in (row["group_id"], group):
                            db.execute("UPDATE delivery_groups SET pending_count=(SELECT count(*) FROM deliveries WHERE group_id=? AND state='pending'),"
                                       "first_pending_seq=(SELECT min(seq) FROM deliveries WHERE group_id=? AND state='pending') WHERE id=?", (gid, gid, gid))
                    db.execute("UPDATE delivery_reasons SET participant_epoch=? WHERE delivery_id=? AND reason='subscription'", (participant[0], row["id"]))
                elif row["state"] == "pending" and row["active"]:
                    self._acknowledge(db, row["recipient_id"], row)
                elif row["state"] == "held":
                    db.execute("UPDATE deliveries SET state='acknowledged' WHERE id=?", (row["id"],))
            if row["kind"] in ("correction", "answer") and row["state"] == "pending" and row["active"] and not self._correction_readable(db, row["recipient_id"], row):
                self._acknowledge(db, row["recipient_id"], row)
            db.execute("UPDATE deliveries SET topic_id=?,group_id=? WHERE id=?", (destination["id"], group, row["id"]))
            db.execute("UPDATE delivery_reasons SET topic_id=? WHERE delivery_id=?", (destination["id"], row["id"]))
            self._change(db, "actor", row["recipient_id"], "delivery", row["id"], row["revision"])

    def _move_waits(self, db, found, source, destination, waiting, removed):
        ids = {item["id"] for item in found}
        open_questions = [item for item in found if item['intent'] == 'ask' and item['id'] not in removed
                          and not self._question_closed(db, item['id']) and not self._withdrawal_value(db, item['id'])]
        for row in waiting:
            member = row["actor_id"]
            candidates = [item for item in open_questions if item["seq"] >= row["ask_seq"]
                          and member != item["author_id"] and member in json.loads(item["addressees"])
                          and not self._reaction_row(db, member, item["id"], "answer")
                          and not answered_yes(self._reaction_row(db, member, item["id"], "thumb"))]
            # The original open wait is authoritative even for a held/go-ahead ask.
            original = next((item for item in open_questions if item['id'] == row['ask_message_id']), None)
            if original is not None:
                if not any(item["id"] == original["id"] for item in candidates): candidates.append(original)
            if candidates:
                ask = min(candidates, key=lambda item: item["seq"])
                self._topic_ask_unthumbed(db, destination, member, ask)
            if row["ask_message_id"] in ids:
                following = self._next_open_ask(db, source, member, row["ask_seq"])
                if following:
                    self._wait_from(db, source, member, following)
                elif row["said"]:
                    db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (source["id"], member))
                else:
                    db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (source["id"], member))
            if candidates or row["ask_message_id"] in ids:
                for topic in (source, destination):
                    self._change(db, "actor", member, "waiting", topic["id"], topic["version"] + 1)

    def _view_dossier_move_targets(self, db, actor, args):
        _, source, root, fields = self._move_root(db, actor, _identifier(args.get("message_id")))
        # One owner of the rail's list, paging and personal order. Leave the raw
        # page intact; the picker omits its source after arranging the topics.
        page = self._view_workspace_topics(db, actor, {
            "workspace_id": source["workspace_id"],
            **{key: args[key] for key in ("limit", "cursor", "build") if key in args}})
        return {**page, "workspace_id": source["workspace_id"], "root_id": root, "topic_id": source["id"], **fields}

    def _view_topic_membership(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        ids = args.get("message_ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(mid, str) for mid in ids):
            raise Refusal("INVALID_ARGUMENT", "Name up to one page of messages")
        rows = db.execute("SELECT m.id FROM messages m WHERE m.topic_id=:topic AND m.id IN (%s) AND " % ",".join(":i%d" % n for n in range(len(ids))) + VISIBLE,
                          dict({"topic": topic["id"], "actor": actor}, **{"i%d" % n: mid for n, mid in enumerate(ids)})).fetchall()
        return {"instance_id": self.instance_id, "topic_id": topic["id"], "message_ids": [r[0] for r in rows], "membership_revision": membership_revision(db, topic["id"], actor)}

    def _view_dossier_moves(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = _page_size(args)
        # Admission precedes paging: neither an empty page nor its cursor may reveal hidden moves.
        rows = db.execute("SELECT d.id,d.root_id,d.actor_id,d.at_ms,m.topic_id,m.seq,m.author_id,m.private_to,t.title,"
                          "(SELECT json_extract(a.value,'$.name') FROM message_acts a "
                          "WHERE a.message_id=d.root_id AND a.kind='name' AND a.owner='' "
                          "ORDER BY a.revision DESC LIMIT 1) AS name FROM dossier_moves d "
                          "JOIN messages m ON m.id=d.root_id JOIN topics t ON t.id=m.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                          "WHERE (d.from_topic_id=:topic OR d.topic_id=:topic) AND d.id>:cursor "
                          "AND d.id=(SELECT max(q.id) FROM dossier_moves q WHERE q.root_id=d.root_id AND (q.from_topic_id=:topic OR q.topic_id=:topic)) "
                          "AND " + VISIBLE + " AND " + READABLE +
                          " ORDER BY d.id LIMIT :limit", {"topic": topic["id"], "cursor": args.get("cursor", 0), "limit": limit + 1, "actor": actor}).fetchall()
        items, arrivals = [], []
        for row in rows[:limit]:
            if not visible(row, actor):
                continue
            try:
                self._topic(db, actor, row["topic_id"])
                self._message_access(db, actor, row["root_id"])
            except Refusal:
                continue
            if row["topic_id"] == topic["id"]:
                arrivals.append({"root_id": row["root_id"], "seq": row["seq"]})
            else:
                # Metadata only: an unnamed root does not disclose its words through this pointer read.
                items.append({"id": row["id"], "root_id": row["root_id"], "topic_id": row["topic_id"], "title": row["title"],
                              "actor_id": row["actor_id"], "at_ms": row["at_ms"], "name": row["name"] or None})
        return {"instance_id": self.instance_id, "topic_id": topic["id"], "items": items, "arrivals": arrivals, "membership_revision": membership_revision(db, topic["id"], actor),
                "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None}

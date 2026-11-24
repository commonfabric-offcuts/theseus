from __future__ import annotations

"""Durable refresh intent, using typed requests in the existing delivery queue.

The state is a topic-owned message act, separate from the untouched cover.
Only a changed agent cover write completes it. See docs/cover-refresh.md.
"""

from .contract import Refusal
from .delivery import _now_ms
import uuid


WRITER_SCHEMA = [
    "CREATE TABLE cover_writers (message_id TEXT PRIMARY KEY REFERENCES messages(id), "
    "actor_id TEXT NOT NULL REFERENCES actors(id), revision INTEGER NOT NULL)",
]
# Automatic Done settlement changes only payload.done. Reconstruct the latest
# actual content writer without treating that owner attribution as the writer.
WRITER_BACKFILL = [
    "INSERT INTO cover_writers(message_id,actor_id,revision) "
    "WITH content AS (SELECT message_id,actor_id,revision, "
    "json_remove(value,'$.payload.done') AS value, "
    "lag(json_remove(value,'$.payload.done')) OVER (PARTITION BY message_id ORDER BY revision) AS previous "
    "FROM message_acts WHERE kind='cover' AND owner=''), "
    "changed AS (SELECT *,row_number() OVER (PARTITION BY message_id ORDER BY revision DESC) AS newest "
    "FROM content WHERE previous IS NULL OR value<>previous) "
    "SELECT message_id,actor_id,revision FROM changed WHERE newest=1",
]


class CoverRefresh:
    def _refresh_recipient(self, db, actor, message, topic, *, first=False):
        from .stacks import MEMBERS, StackRoots
        writer = db.execute("SELECT actor_id FROM cover_writers WHERE message_id=?", (message["id"],)).fetchone()
        candidates = []
        if first:
            # Current requester-visible membership, including joins; an agent
            # opening alone or a newer human reply does not choose the writer.
            latest = db.execute(MEMBERS + " SELECT m.author_id FROM members p JOIN messages m ON m.id=p.id "
                                "JOIN actors a ON a.id=m.author_id WHERE m.id<>:root AND m.reply_to IS NOT NULL "
                                "AND a.kind='agent' ORDER BY m.seq DESC LIMIT 1",
                                {"root": message["id"], "actor": actor}).fetchone()
            if latest:
                candidates.append(latest[0])
        candidates.extend([writer[0] if writer else None, topic["coordinator_id"]])
        for recipient in dict.fromkeys(candidates):
            row = db.execute("SELECT kind,enabled FROM actors WHERE id=?", (recipient,)).fetchone()
            if row is None or row["kind"] != "agent" or not row["enabled"]:
                continue
            try:
                self._acted_message(db, recipient, {"message_id": message["id"]})
                if StackRoots(db, recipient).root(message["id"]) != message["id"]:
                    continue
            except Refusal:
                continue
            if recipient == actor:
                raise Refusal("COVER_WRITER_IS_YOU", "You are this cover's writer; update the cover directly")
            return recipient
        raise Refusal("COVER_WRITER_UNAVAILABLE", "No available cover writer or coordinator can read this dossier; the cover is kept")

    def _command_stack_cover_refresh(self, db, actor, envelope):
        return self._refresh_request(db, actor, envelope, "cover")

    def _command_message_refresh(self, db, actor, envelope):
        return self._refresh_request(db, actor, envelope, "message")

    def _refresh_request(self, db, actor, envelope, target_type):
        """One request door: adapters select a target, delivery/activity stay shared."""
        from .stacks import EMPTY, StackRoots, current_acts
        from .message_edit import current_words
        message, topic = self._acted_message(db, actor, envelope["target"])
        is_cover = target_type == "cover"
        kind = "cover_refresh" if is_cover else "message_refresh"
        revision_field = "cover_revision" if is_cover else "message_revision"
        if envelope["args"]:
            raise Refusal("INVALID_ARGUMENT", "An update request takes no writing")
        if is_cover and StackRoots(db, actor).root(message["id"]) != message["id"]:
            raise Refusal("STACK_CHANGED", "This dossier changed; read its cover again")
        closed = self._closed(db, topic["workspace_id"])
        if closed is not None:
            raise self._closed_refusal(db, actor, topic["workspace_id"], closed)
        if not is_cover:
            author = db.execute("SELECT kind,enabled FROM actors WHERE id=?", (message["author_id"],)).fetchone()
            if author["kind"] != "agent" or message["author_id"] == actor:
                raise Refusal("UPDATE_AUTHOR_REQUIRED", "Ask for update is only for another agent's message")
            if not author["enabled"]:
                raise Refusal("UPDATE_AUTHOR_UNAVAILABLE", "This message's author is unavailable; the message is kept")
            # No coordinator fallback and no grant of topic or private reach.
            self._acted_message(db, message["author_id"], {"message_id": message["id"]})
        acts = current_acts(db, actor, [message["id"]]).get(message["id"], EMPTY)
        pending = acts.get(kind)
        result = {"message_id": message["id"], "topic_id": message["topic_id"]}
        if pending and pending["state"] == "pending":
            return dict(result, refresh=pending, refresh_revision=acts[kind + "_revision"], coalesced=True), []
        current = acts["cover_revision"] if is_cover else current_words(db, message["id"], plain=True)[1]
        if envelope["expected"][revision_field] != current:
            raise Refusal("REVISION_CONFLICT", "This changed; read it again before asking for an update", {revision_field: current})
        if is_cover:
            cover = acts["cover"]
            written = cover and (cover['by'] is not None or cover['stands'] or cover['payload'])
            recipient = self._refresh_recipient(db, actor, message, topic, first=not written)
            opening = ("Please write this dossier's first cover from its latest facts. "
                       if not written else "Please rewrite this dossier's cover from its latest facts. ")
            body = (opening +
                    "Read the whole dossier and its current cover, retain source attribution, waits and defaults, "
                    "payload kind/link and the owner's Done record. Use aim-next cover %s --expected N with the "
                    "current cover revision. This refresh observed revision %d; only a changed agent cover write "
                    "completes it, not a reply or acknowledgement." % (message["id"], current))
        else:
            recipient = message["author_id"]
            body = ("Please bring your same message %s up to date with what has happened since it was written. "
                    "Read that message and the later facts, then edit that message in place with aim-next edit %s "
                    "--expected N using its current ordinary message revision. Keep source attribution and exact "
                    "message identity; do not post a replacement. This request observed revision %d; only a new "
                    "ordinary revision of that same message completes it, not a reply or acknowledgement."
                    % (message["id"], message["id"], current))
        request_id, at_ms = "rq-" + uuid.uuid4().hex, _now_ms()
        root_id = StackRoots(db, actor).root(message["id"])
        value = {"state": "pending", "operation_id": envelope["operation_id"], "by": actor,
                 "observed_revision": current, "recipient": recipient, "request_id": request_id,
                 "root_id": root_id, "at_ms": at_ms, "completed_revision": None}
        next_revision = acts.get(kind + "_revision", 0) + 1
        version = self._record_act(db, kind, message, "", actor, value, next_revision)
        db.execute("INSERT INTO refresh_requests(id,act_id,message_id,root_id,topic_id,kind,requester_id,recipient_id,observed_revision,body,created_ms) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (request_id, version, message["id"], root_id, topic["id"], kind,
                                                      actor, recipient, current, body, at_ms))
        delivery_id = self._queue_delivery(db, None, recipient, topic["id"], {"request": None}, request_id=request_id)
        self._change(db, "actor", recipient, "delivery", delivery_id, 1)
        return dict(result, refresh=value, refresh_revision=next_revision, coalesced=False), [
            {"kind": "acts", "id": topic["id"], "version": version}, {"kind": "delivery", "id": delivery_id, "version": 1}]

    def _complete_refresh(self, db, actor, message, kind, revision, version=None):
        pending = self._act_value(db, message["id"], kind, "")
        if (not pending or pending["state"] != "pending" or revision <= pending["observed_revision"]
                or self._actor(db, actor)["kind"] != "agent"):
            return version
        # message.edit reads a minimal access row; acts also need its immutable sequence.
        message = db.execute("SELECT id,topic_id,seq,author_id,private_to FROM messages WHERE id=?", (message["id"],)).fetchone()
        completed = dict(pending, state="completed", completed_revision=revision, completed_by=actor, completed_ms=_now_ms())
        return self._record_act(db, kind, message, "", actor, completed,
                                self._act_revision(db, message["id"], kind, "") + 1)

    def _cover_refreshed(self, db, actor, message, before, value, revision, version):
        def content(cover):
            payload = cover["payload"]
            return dict(cover, payload={key: item for key, item in payload.items() if key != "done"} if payload else None)
        if content(before) == content(value):
            return version
        # Record writer separately so the owner's automatic Done never steals it.
        db.execute("INSERT INTO cover_writers(message_id,actor_id,revision) VALUES (?,?,?) "
                   "ON CONFLICT(message_id) DO UPDATE SET actor_id=excluded.actor_id,revision=excluded.revision",
                   (message["id"], actor, revision))
        if not (value["stands"] or value["waiting"] or value["payload"]):
            return version
        return self._complete_refresh(db, actor, message, "cover_refresh", revision, version)

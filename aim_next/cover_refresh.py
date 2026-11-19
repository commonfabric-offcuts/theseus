from __future__ import annotations

"""Durable cover-refresh intent, using ordinary addressed messages and wakes.

The state is a topic-owned message act, separate from the untouched cover.
Only a changed agent cover write completes it. See docs/cover-refresh.md.
"""

from .contract import Refusal
from .delivery import _now_ms


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
    def _refresh_recipient(self, db, actor, message, topic):
        from .stacks import StackRoots
        writer = db.execute("SELECT actor_id FROM cover_writers WHERE message_id=?", (message["id"],)).fetchone()
        candidates = [writer[0] if writer else None, topic["coordinator_id"]]
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
        from .stacks import EMPTY, StackRoots, current_acts
        message, topic = self._acted_message(db, actor, envelope["target"])
        if envelope["args"]:
            raise Refusal("INVALID_ARGUMENT", "A cover refresh takes no writing")
        if StackRoots(db, actor).root(message["id"]) != message["id"]:
            raise Refusal("STACK_CHANGED", "This dossier changed; read its cover again")
        closed = self._closed(db, topic["workspace_id"])
        if closed is not None:
            raise self._closed_refusal(db, actor, topic["workspace_id"], closed)
        acts = current_acts(db, actor, [message["id"]]).get(message["id"], EMPTY)
        pending = acts.get("cover_refresh")
        result = {"message_id": message["id"], "topic_id": message["topic_id"]}
        # One durable prompt per pending dossier, even across tabs/actors and
        # an intervening owner Done revision. No new delivery on another tap.
        if pending and pending["state"] == "pending":
            return dict(result, refresh=pending, refresh_revision=acts["cover_refresh_revision"], coalesced=True), []
        current = acts["cover_revision"]
        if envelope["expected"]["cover_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This cover changed; read it again before refreshing", {"cover_revision": current})
        if acts["cover"] is None:
            raise Refusal("COVER_MISSING", "There is no cover to refresh")
        recipient = self._refresh_recipient(db, actor, message, topic)
        body = ("Please rewrite this dossier's cover from its latest facts. "
                "Read the whole dossier and its current cover, retain source attribution, waits and defaults, "
                "payload kind/link and the owner's Done record. Use aim-next cover %s --expected N with the "
                "current cover revision. This refresh observed revision %d; only a changed agent cover write "
                "completes it, not a reply or acknowledgement." % (message["id"], current))
        private = message["private_to"] is not None
        snapshot = self._writing({"body": body, "addressees": [recipient], "reply_to": message["id"],
                                  "intent": None if private else "ask", "whisper": private})
        posted, affected = self._publish(db, actor, envelope["operation_id"], topic["id"], snapshot)
        value = {"state": "pending", "operation_id": envelope["operation_id"], "by": actor,
                 "observed_revision": current, "recipient": recipient, "request_message_id": posted["message_id"],
                 "at_ms": _now_ms(), "completed_revision": None}
        version = self._record_act(db, "cover_refresh", message, "", actor, value, acts.get("cover_refresh_revision", 0) + 1)
        return dict(result, refresh=value, refresh_revision=acts.get("cover_refresh_revision", 0) + 1, coalesced=False), affected + [{"kind": "acts", "id": topic["id"], "version": version}]

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
        pending = self._act_value(db, message["id"], "cover_refresh", "")
        if (not pending or pending["state"] != "pending" or revision <= pending["observed_revision"]
                or self._actor(db, actor)["kind"] != "agent"
                or not (value["stands"] or value["waiting"] or value["payload"])):
            return version
        completed = dict(pending, state="completed", completed_revision=revision, completed_by=actor, completed_ms=_now_ms())
        return self._record_act(db, "cover_refresh", message, "", actor, completed,
                                self._act_revision(db, message["id"], "cover_refresh", "") + 1)

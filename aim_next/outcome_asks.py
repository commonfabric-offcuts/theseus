from __future__ import annotations

"""Held asks (6.6 of the outcome-page plan; docs/targets.md).

An ask that an open record still needs stays waiting after its reader writes in
the topic: a target wording still proposed to the owner (D8), or an open entry
of an owner-gated stage (D24). A reply leaves a record-owned Ask open.
The target or stage decision clears the wait that belongs to that record.
"""

import json

from .standing_conversation import is_conversation


def held_ask(db, topic_id, writer):
    """The id of an ask in topic_id to writer that an open record still needs, or None."""
    rows = db.execute(
        "SELECT r.ask_message_id FROM outcome_target_revisions r INDEXED BY held_target_asks "
        "JOIN messages m ON m.id=r.ask_message_id WHERE r.outcome IS NULL AND r.ask_message_id IS NOT NULL AND m.topic_id=? "
        "UNION ALL SELECT e.ask_message_id FROM pipeline_stage_entries e INDEXED BY held_stage_asks "
        "JOIN messages m ON m.id=e.ask_message_id WHERE e.ask_message_id IS NOT NULL AND e.left_ms IS NULL AND m.topic_id=?",
        (topic_id, topic_id)).fetchall()
    for (message_id,) in rows:
        addressees = db.execute("SELECT addressees FROM messages WHERE id=?", (message_id,)).fetchone()[0]
        if writer in json.loads(addressees) and db.execute(
                "SELECT 1 FROM message_withdrawals WHERE message_id=? UNION ALL SELECT 1 FROM message_removals WHERE message_id=?", (message_id, message_id)).fetchone() is None:
            return message_id
    return None


def record_ask(db, message_id, workspace_id, topic_id):
    """Whether a record names message_id as its ask, open or settled: a target wording's (D8) or an
    owner-gated stage entry's (D24). Its record answers it, so a thumbs-up never does (item 239).

    A target's revisions are read by their outcome; a stage entry's ask is in its piece's topic, so only
    the entries of that topic's pieces are read."""
    return db.execute(
        "SELECT 1 FROM outcome_target_revisions WHERE workspace_id=? AND ask_message_id=? "
        "UNION ALL SELECT 1 FROM pipeline_pieces p CROSS JOIN pipeline_stage_entries e INDEXED BY piece_entries ON e.piece_id=p.id "
        "WHERE p.workspace_id=? AND e.ask_message_id=? LIMIT 1", (workspace_id, message_id, workspace_id, message_id)).fetchone() is not None


def release_held(store, db, message_id):
    """Release a record-owned Ask and keep the other waits in its topic."""
    for link in db.execute("SELECT actor_id FROM ask_cover_links WHERE ask_id=? AND active=1", (message_id,)).fetchall():
        store._set_linked_wait(db, link["actor_id"], message_id, False)
    topic = db.execute("SELECT t.* FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?", (message_id,)).fetchone()
    if topic is None:
        return
    topic_id = topic["id"]
    if is_conversation(topic):
        actors = [row["actor_id"] for row in db.execute("SELECT actor_id FROM conversation_waits WHERE ask_id=?", (message_id,))]
        db.execute("DELETE FROM conversation_waits WHERE ask_id=?", (message_id,))
        store._sync_waits(db, topic, actors)
    else:
        rows = db.execute("SELECT actor_id,said FROM topic_waiting WHERE topic_id=? AND ask_message_id=?",
                          (topic_id, message_id)).fetchall()
        actors = [row["actor_id"] for row in rows]
        for row in rows:
            actor = row["actor_id"]
            still = held_ask(db, topic_id, actor)
            if still is not None:
                # Keep the existing priority of a proposal or stage that still needs a decision.
                db.execute("UPDATE topic_waiting SET ask_message_id=?,state_ms=(SELECT sent_ms FROM messages WHERE id=?) "
                           "WHERE topic_id=? AND actor_id=?", (still, still, topic_id, actor))
            else:
                # A record can have moved this pointer past an older Ask. Find
                # its replacement in this recipient's indexed topic history.
                following = store._next_open_ask(db, topic, actor, 0)
                if following is not None:
                    store._wait_from(db, topic, actor, following)
                elif row["said"]:
                    db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (topic_id, actor))
                else:
                    db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic_id, actor))
            store._sync_linked_attention(db, topic, actor)
    if actors:
        version = store._touch_topic(db, topic)
        for actor in actors:
            store._change(db, "actor", actor, "waiting", topic_id, version)

from __future__ import annotations

"""Held asks (6.6 of the outcome-page plan; docs/targets.md).

An ask that an open record still needs stays waiting after its reader writes in
the topic: a target wording still proposed to the owner (D8), or an open entry
of an owner-gated stage (D24). TopicState._answered calls held_ask() first, so
a reply that does not decide never leaves a proposal or a gated stage unlit;
target.settle and the stage_enter that leaves the gated stage clear it.
"""

import json


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
        if writer in json.loads(addressees):
            return message_id
    return None


def release_held(store, db, message_id):
    """Clear the wait an ask kept once its record is settled, when nothing else holds it; the owner's change is written."""
    rows = db.execute("SELECT topic_id,actor_id,said FROM topic_waiting WHERE ask_message_id=?", (message_id,)).fetchall()
    for row in rows:
        if row["said"]:
            db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (row["topic_id"], row["actor_id"]))
        else:
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (row["topic_id"], row["actor_id"]))
        topic = db.execute("SELECT * FROM topics WHERE id=?", (row["topic_id"],)).fetchone()
        version = store._touch_topic(db, topic)
        store._change(db, "actor", row["actor_id"], "waiting", row["topic_id"], version)

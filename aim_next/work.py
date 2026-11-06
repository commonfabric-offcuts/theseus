from __future__ import annotations

"""Work observed: the one rule for whether anyone is seen working on a topic.

Work is observed on a topic when someone posted in it or took a hosted turn
in it within the last WORK_WINDOW_MS, or when the topic waits on someone.
Nothing here can see work that leaves no trace in Theseus, so the rule never
says that nobody is working: a topic without observed work shows "no activity
seen since" its last activity. The topic list, the pipeline and the outcome
light all read this one rule.

The facts it reads, each one indexed row per topic, so a page of topics costs
one lookup per topic on the page:
- the topic's latest message, through topic_summaries (who posted, and when);
- the latest hosted turn in it, in topic_turns: a turn is in a topic when it
  was handed deliveries from that topic, and its activity is when it was
  handed and when it completed;
- whether anyone is waited on, from topic_waiting.
"""

import json

from . import delivery


WORK_WINDOW_MS = 60 * 60 * 1000

# Schema 15: the latest hosted turn per topic, and the topics each handed turn holds.
WORK_SCHEMA = [
    "CREATE TABLE topic_turns (topic_id TEXT PRIMARY KEY REFERENCES topics(id), turn_ms INTEGER NOT NULL, turn_by TEXT NOT NULL REFERENCES actors(id))",
    "CREATE TABLE hosted_turn_topics (attempt_id TEXT NOT NULL REFERENCES wake_attempts(id), topic_id TEXT NOT NULL REFERENCES topics(id), PRIMARY KEY(attempt_id,topic_id))",
]
WORK_DOWN = ("DROP TABLE hosted_turn_topics", "DROP TABLE topic_turns")
WORK_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM topic_turns) OR EXISTS (SELECT 1 FROM hosted_turn_topics)"


def observed(seen_ms, waits, now_ms, in_now=False):
    """Whether work is observed on a topic: recent activity, or someone waited on.

    in_now is the seam for the pipeline's NOW list (item 84): a topic that is
    in NOW counts as observed. Until NOW is a record, every caller passes False."""
    return bool(waits or in_now or (seen_ms is not None and now_ms - seen_ms <= WORK_WINDOW_MS))


def _turn_in(db, topic_ids, attempt_id, recipient_id, now):
    for topic_id in topic_ids:
        if attempt_id is not None:
            db.execute("INSERT OR IGNORE INTO hosted_turn_topics VALUES (?,?)", (attempt_id, topic_id))
        db.execute("INSERT INTO topic_turns VALUES (?,?,?) ON CONFLICT(topic_id) DO UPDATE SET "
                   "turn_ms=excluded.turn_ms,turn_by=excluded.turn_by WHERE excluded.turn_ms>=topic_turns.turn_ms",
                   (topic_id, now, recipient_id))


def turn_handed(db, attempt_id, recipient_id, after_seq, through_seq, now):
    """A hosted turn was handed the recipient's pending deliveries in (after_seq, through_seq]:
    it is in each of their topics from now."""
    topics = [row[0] for row in db.execute(
        "SELECT DISTINCT m.topic_id FROM deliveries d INDEXED BY recipient_deliveries JOIN messages m ON m.id=d.message_id "
        "WHERE d.recipient_id=? AND d.state='pending' AND d.seq>? AND d.seq<=? ORDER BY m.topic_id",
        (recipient_id, after_seq or 0, through_seq))]
    _turn_in(db, topics, attempt_id, recipient_id, now)


def turn_completed(db, attempt_id, recipient_id, now):
    """A hosted turn finished its work: its topics saw activity now."""
    topics = [row[0] for row in db.execute("SELECT topic_id FROM hosted_turn_topics WHERE attempt_id=? ORDER BY topic_id", (attempt_id,))]
    _turn_in(db, topics, None, recipient_id, now)


def work_by_topic(db, waits):
    """{topic_id: {observed, seen_ms, by, how, waits}} for the topics in waits ({topic_id: (said, asks)}).

    how is "posted" or "turn", whichever was later; seen_ms and by are None
    for a topic with neither."""
    now = delivery._now_ms()
    work = {}
    rows = db.execute("SELECT s.topic_id,m.sent_ms,m.author_id,t.turn_ms,t.turn_by FROM topic_summaries s "
                      "LEFT JOIN messages m ON m.id=s.latest_message_id LEFT JOIN topic_turns t ON t.topic_id=s.topic_id "
                      "WHERE s.topic_id IN (SELECT value FROM json_each(?))", (json.dumps(sorted(waits)),)).fetchall()
    facts = {row[0]: row for row in rows}
    for topic_id, (said, asks) in waits.items():
        _, posted_ms, author, turn_ms, turn_by = facts.get(topic_id, (topic_id, None, None, None, None))
        seen = max(((ms, by, how) for ms, by, how in ((posted_ms, author, "posted"), (turn_ms, turn_by, "turn")) if ms is not None),
                   default=(None, None, None), key=lambda fact: fact[0])
        waiting = bool(said or asks)
        work[topic_id] = {"observed": observed(seen[0], waiting, now),
                          "seen_ms": seen[0], "by": seen[1], "how": seen[2], "waits": waiting}
    return work

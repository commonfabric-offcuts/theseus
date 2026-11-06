from __future__ import annotations

"""Work observed: the one rule for whether anyone is seen working on a topic.

Work is observed on a topic by a viewer when someone other than the viewer
posted in it or took a hosted turn in it within the last WORK_WINDOW_MS, or
when the topic waits on someone. The viewer's own activity is never work they
observe: it would read as news they have not seen. Nothing here can see work
that leaves no trace in Theseus, so the rule never says that nobody is
working: a topic without observed work shows "no activity seen since" the last
activity by others. Every view that shows observed work (the topic list and
the topic) reads this one rule for its reader.

The facts it reads, each one indexed row per topic, so a page of topics costs
one lookup per topic on the page, however many times the viewer posted in a row:
- the topic's latest message, and the latest one by someone other than its
  author, through topic_summaries (who posted, and when);
- the latest hosted turn in it, and the latest by someone other than whoever
  took that one, in topic_turns: a turn is in a topic when it was handed
  deliveries from that topic, and its activity is when it was handed and when
  it completed;
- whether anyone is waited on, from topic_waiting.
Of each pair, the first is the latest by others unless the viewer did it;
then the second is, as it is by someone else.
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

# Schema 24: beside each topic's latest message and latest turn, the latest by
# anyone other than its author, so a viewer's own activity is never what they see.
OTHERS_SCHEMA = [
    "ALTER TABLE topic_summaries ADD COLUMN other_message_id TEXT",
    "ALTER TABLE topic_turns ADD COLUMN other_ms INTEGER",
    "ALTER TABLE topic_turns ADD COLUMN other_by TEXT",
]
# The upgrade works both out from what is kept: the messages, and each handed
# turn's topics, with when the turn was handed and, if it completed, ended.
OTHERS_BACKFILL = [
    "UPDATE topic_summaries SET other_message_id=(SELECT m.id FROM messages m WHERE m.topic_id=topic_summaries.topic_id "
    "AND m.author_id<>(SELECT l.author_id FROM messages l WHERE l.id=topic_summaries.latest_message_id) ORDER BY m.seq DESC LIMIT 1)",
    "UPDATE topic_turns SET (other_ms,other_by)=(SELECT ms,recipient_id FROM (SELECT h.recipient_id,"
    "CASE WHEN h.final_status='completed' AND h.finished_ms>h.handed_ms THEN h.finished_ms ELSE h.handed_ms END AS ms "
    "FROM hosted_turn_topics t JOIN hosted_turns h ON h.attempt_id=t.attempt_id "
    "WHERE t.topic_id=topic_turns.topic_id AND h.recipient_id<>topic_turns.turn_by) ORDER BY ms DESC LIMIT 1)",
]
OTHERS_DOWN = ("ALTER TABLE topic_turns DROP COLUMN other_by", "ALTER TABLE topic_turns DROP COLUMN other_ms",
               "ALTER TABLE topic_summaries DROP COLUMN other_message_id")
# Both are worked out from what stays, so stepping back loses no record.
OTHERS_OCCUPIED = "SELECT 0"
# Run with the summary's update for a new message by ?1: the latest message
# before it becomes the latest by someone else unless ?1 wrote that one too.
# SQLite reads the row's old values on the right of SET.
OTHER_MESSAGE = ("other_message_id=CASE WHEN (SELECT author_id FROM messages WHERE id=topic_summaries.latest_message_id) IS ?1 "
                 "THEN other_message_id ELSE latest_message_id END")


def observed(seen_ms, waits, now_ms, in_now=False):
    """Whether work is observed on a topic: recent activity, or someone waited on.

    in_now is the seam for the pipeline's NOW list (item 84): a topic that is
    in NOW counts as observed. Until NOW is a record, every caller passes False."""
    return bool(waits or in_now or (seen_ms is not None and now_ms - seen_ms <= WORK_WINDOW_MS))


def _latest_pair(facts):
    """Of (ms, by) facts, the latest, and the latest by someone other than whoever did that; either may be None."""
    facts = [fact for fact in facts if fact[0] is not None]
    # A later fact wins a tie, as the newest record of it.
    latest = max(reversed(facts), key=lambda fact: fact[0], default=None)
    other = max(reversed([fact for fact in facts if latest is not None and fact[1] != latest[1]]), key=lambda fact: fact[0], default=None)
    return latest, other


def _turn_in(db, topic_ids, attempt_id, recipient_id, now):
    for topic_id in topic_ids:
        if attempt_id is not None:
            db.execute("INSERT OR IGNORE INTO hosted_turn_topics VALUES (?,?)", (attempt_id, topic_id))
        row = db.execute("SELECT turn_ms,turn_by,other_ms,other_by FROM topic_turns WHERE topic_id=?", (topic_id,)).fetchone()
        # The kept latest beat the kept other on any tie, so it goes after it, as if recorded later.
        kept = [(row[2], row[3]), (row[0], row[1])] if row else []
        latest, other = _latest_pair(kept + [(now, recipient_id)])
        db.execute("INSERT INTO topic_turns VALUES (?,?,?,?,?) ON CONFLICT(topic_id) DO UPDATE SET "
                   "turn_ms=excluded.turn_ms,turn_by=excluded.turn_by,other_ms=excluded.other_ms,other_by=excluded.other_by",
                   (topic_id, latest[0], latest[1], *(other or (None, None))))


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


def work_by_topic(db, waits, viewer):
    """{topic_id: {observed, seen_ms, by, how, waits}} as viewer sees the topics in waits ({topic_id: (said, asks)}).

    seen_ms, by and how are the latest activity by anyone but the viewer: how
    is "posted" or "turn", whichever was later, and all three are None when
    nobody else has done either."""
    now = delivery._now_ms()
    work = {}
    rows = db.execute("SELECT s.topic_id,m.sent_ms,m.author_id,o.sent_ms,o.author_id,t.turn_ms,t.turn_by,t.other_ms,t.other_by "
                      "FROM topic_summaries s LEFT JOIN messages m ON m.id=s.latest_message_id "
                      "LEFT JOIN messages o ON o.id=s.other_message_id LEFT JOIN topic_turns t ON t.topic_id=s.topic_id "
                      "WHERE s.topic_id IN (SELECT value FROM json_each(?))", (json.dumps(sorted(waits)),)).fetchall()
    facts = {row[0]: row[1:] for row in rows}
    for topic_id, (said, asks) in waits.items():
        fact = facts.get(topic_id, (None,) * 8)
        # Posts before turns, so a post wins a tie.
        candidates = [(fact[i], fact[i + 1], how) for i, how in ((0, "posted"), (2, "posted"), (4, "turn"), (6, "turn"))]
        seen = max((candidate for candidate in candidates if candidate[0] is not None and candidate[1] != viewer),
                   default=(None, None, None), key=lambda candidate: candidate[0])
        waiting = bool(said or asks)
        work[topic_id] = {"observed": observed(seen[0], waiting, now),
                          "seen_ms": seen[0], "by": seen[1], "how": seen[2], "waits": waiting}
    return work

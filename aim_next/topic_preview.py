from __future__ import annotations

"""Newest public words for a returned page of topics (960).

Topic summaries choose the message; the edit helper chooses its current words
and protects held drafts. No history or per-topic query is needed.
"""

import json
import re

from . import removal
from .message_edit import mark, revision, withheld, words


OPENING_CHARS = 180


def opening(text):
    """Opening prose, without quoted passages, reply prefaces or Markdown marks."""
    prose = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(">") or line.lower().startswith("reply without a quote:"):
            continue
        # A picture is not prose; a link's label is. Leave punctuation inside
        # words intact (underscores in names, for example).
        line = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)
        line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)
        line = re.sub(r"^\s*(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)", "", line)
        line = re.sub(r"[`*~]", "", line)
        line = re.sub(r"(?<!\w)_+|_+(?!\w)", "", line)
        prose.append(line)
    text = " ".join(" ".join(prose).split())
    return text[:OPENING_CHARS], len(text) > OPENING_CHARS


def latest_by_topic(db, topic_ids):
    """One indexed batch of newest public messages, only for these returned IDs.

    Stream the cursor: only one current message body is materialized at a time,
    and the returned page contains at most 180 code points per opening.
    """
    if not topic_ids:
        return {}
    rows = db.execute(
        "SELECT s.topic_id,m.id,m.author_id,a.kind AS author_kind,m.sent_ms,"
        + revision("m") + " AS revision,r.kind AS removed,"
        + "CASE WHEN r.kind='retracted' THEN '' ELSE " + words("m", plain=True) + " END AS body "
        "FROM topic_summaries s JOIN messages m ON m.id=s.latest_message_id "
        "JOIN actors a ON a.id=m.author_id LEFT JOIN message_removals r ON r.message_id=m.id "
        "WHERE s.topic_id IN (SELECT value FROM json_each(?)) AND m.private_to IS NULL AND " + removal.VISIBLE,
        (json.dumps(topic_ids),))
    latest = {}
    for row in rows:
        text, truncated = opening(row["body"])
        latest[row["topic_id"]] = {
            "id": row["id"], "revision": row["revision"],
            "author_id": row["author_id"], "author_kind": row["author_kind"],
            "sent_ms": row["sent_ms"],
            "opening": mark(row["id"], row["revision"], text),
            "truncated": truncated, "withheld": withheld(row["id"]),
            "removed": row["removed"] == "retracted",
        }
    return latest

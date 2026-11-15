"""What one page of a topic's messages says of how the reader stands with each.

Two facts per message, both read for the page's own messages only, through
indexes keyed by message, so a page never reads the topic's history:

- `unread`: the message waits in one of the reader's unread groups (the
  topic's subscription group of their current participation, or their direct
  group), as the counts and the New line read it. Marks are the page's own
  (`marks`), so they are not folded in here.
- `replied`: the reader's newest reply to the message, `{id, sent_ms}`, or
  null. A reply is always in its parent's topic and the reader always sees
  their own messages, whispers included, so it never names a message the
  reader cannot read.

`yours` says what the reader has written privately on each message (item 127),
from their own rows only, keyed by the message as a source:

- `note`: the reader's private note on the message holds words.
- `reply`: the reader's saved reply from the message holds words or an image
  and is not on its way: a reply prepared to send leaves its draft empty.
- `version`: grows with every save of either (writing_version), so a page
  keeps the newer of two reads.
"""
from __future__ import annotations

import json

from .contract import _json


def unread_groups(db, actor, topic_id, direct):
    """The groups whose pending deliveries are unread for actor in one topic."""
    groups = [row[0] for row in db.execute(
        "SELECT g.id FROM topic_participants p CROSS JOIN delivery_groups g INDEXED BY sqlite_autoindex_delivery_groups_1 "
        "ON g.recipient_id=p.actor_id AND g.kind='subscription' AND g.topic_id=p.topic_id AND g.participant_epoch=p.epoch "
        "WHERE p.topic_id=? AND p.actor_id=? AND p.active=1 AND g.active=1", (topic_id, actor))]
    return groups + ([direct["id"]] if direct is not None else [])


def reading_fields(db, actor, groups, items):
    """Add `unread` and `replied` to every item of one page."""
    ids = [item["id"] for item in items]
    unread, replied = set(), {}
    if ids:
        marks = ",".join("?" * len(ids))
        if groups:
            unread = {row[0] for row in db.execute(
                "SELECT message_id FROM deliveries WHERE recipient_id=? AND state='pending' AND message_id IN (%s) AND group_id IN (%s)"
                % (marks, ",".join("?" * len(groups))), [actor] + ids + groups)}
        for row in db.execute("SELECT reply_to,id,sent_ms FROM messages INDEXED BY message_reply_links "
                              "WHERE reply_to IN (%s) AND author_id=? ORDER BY seq" % marks, ids + [actor]):
            replied[row["reply_to"]] = {"id": row["id"], "sent_ms": row["sent_ms"]}
    for item in items:
        item["unread"] = item["id"] in unread and item["author_id"] != actor
        item["replied"] = replied.get(item["id"])


def message_key(message_id):
    """A message's key as a source of private writing (drafts._source_key)."""
    return _json(["message", message_id])


def writing_fields(db, actor, items):
    """Add `yours` to every item of one page."""
    keys = {message_key(item["id"]): item["id"] for item in items}
    found = {mid: {"note": False, "reply": False, "version": 0} for mid in keys.values()}
    if keys:
        marks = ",".join("?" * len(keys))
        for table, field in (("notes", "note"), ("drafts", "reply")):
            for row in db.execute("SELECT source_key,revision,payload FROM %s WHERE actor_id=? AND source_key IN (%s)" % (table, marks), [actor] + list(keys)):
                payload, yours = json.loads(row["payload"]), found[keys[row["source_key"]]]
                yours["version"] += row["revision"]
                # A note is its words; a reply is its words and its images.
                if payload.get("body", "").strip() or field == "reply" and payload.get("attachments"):
                    yours[field] = True
    for item in items:
        item["yours"] = found[item["id"]]


def writing_version(db, actor, message_id):
    """A version of the reader's private writing on a message that grows with every save to it: the note's
    revision and every draft's from the message added up. Neither is ever removed and each save raises one."""
    key = message_key(message_id)
    return db.execute("SELECT COALESCE((SELECT revision FROM notes WHERE actor_id=? AND source_key=?),0)+"
                      "COALESCE((SELECT SUM(revision) FROM drafts WHERE actor_id=? AND source_key=?),0)", (actor, key, actor, key)).fetchone()[0]

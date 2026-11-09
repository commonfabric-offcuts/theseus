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
"""
from __future__ import annotations


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

from __future__ import annotations

"""Read a page of personal archived dossiers without loading the feed."""

import json

from .contract import Refusal, _page_size
from .message_edit import words
from .stacks import StackRoots, _dossier_totals, starred_in, starred_unread
from .whispers import VISIBLE


def _cursor(args):
    value = args.get("cursor")
    if value is None:
        return (2, 0, 0, 0)
    if (not isinstance(value, list) or len(value) != 4 or type(value[0]) is not int or value[0] not in (0, 1)
            or type(value[1]) not in (int, float) or not -1e300 < value[1] < 1e300
            or any(type(part) is not int or not 0 <= part < 2**63 for part in value[2:])):
        raise Refusal("INVALID_ARGUMENT", "Invalid Archived cursor")
    return value


def _key(row):
    return [row["starred"], row["rank"], row["tie"], row["seq"]]


def archive_page(db, actor, topic, instance, args):
    limit = min(_page_size(args), 40)
    tier, rank, tie, seq = _cursor(args)
    roots = StackRoots(db, actor)
    stars = starred_in(db, actor, topic, roots)
    budget = limit * 4
    params = {"actor": actor, "topic": topic, "stars": json.dumps(list(stars)),
              "tier": tier, "rank": rank, "tie": tie, "seq": seq, "budget": budget + 1}
    # Only this reader's Archive acts and their order keys participate in the
    # sort. The cursor ends at the last inspected candidate, including when
    # older acts survive but their dossiers have already returned.
    candidates = db.execute(
        "WITH ranked AS ("
        " SELECT a.message_id, a.revision, json_extract(a.value,'$.through') AS through,"
        " m.seq, m.author_id, author.kind AS author_kind,"
        " coalesce(o.key,m.seq) AS rank, coalesce(o.tie,m.seq) AS tie, coalesce(o.entry_key,m.seq) AS entry_key,"
        " (a.message_id IN (SELECT value FROM json_each(:stars))) AS starred"
        " FROM message_acts a INDEXED BY reader_stars JOIN messages m ON m.id=a.message_id"
        " JOIN actors author ON author.id=m.author_id"
        " LEFT JOIN dossier_order o ON o.actor_id=:actor AND o.topic_id=:topic AND o.root_id=a.message_id"
        " WHERE a.owner=:actor AND a.kind='aside' AND a.topic_id=:topic AND m.topic_id=:topic"
        " AND json_extract(a.value,'$.through') IS NOT NULL AND " + VISIBLE +
        " AND a.revision=(SELECT max(b.revision) FROM message_acts b"
        " WHERE b.message_id=a.message_id AND b.kind='aside' AND b.owner=:actor)"
        " AND coalesce((SELECT json_extract(b.value,'$.trashed') FROM message_acts b"
        " WHERE b.message_id=a.message_id AND b.kind='trash' AND b.owner=:actor ORDER BY b.revision DESC LIMIT 1),0)=0"
        ") SELECT * FROM ranked WHERE (starred,rank,tie,seq)<(:tier,:rank,:tie,:seq)"
        " ORDER BY starred DESC,rank DESC,tie DESC,seq DESC LIMIT :budget", params).fetchall()
    items, at = [], 0
    for row in candidates[:budget]:
        at += 1
        root = row["message_id"]
        if roots.root(root) != root:
            continue
        latest, other, count = _dossier_totals(db, actor, root)
        if other is not None and other > row["through"]:
            continue
        detail = db.execute(
            "SELECT " + words("m", chars=160) + " AS excerpt,"
            " (SELECT json_extract(n.value,'$.name') FROM message_acts n"
            " WHERE n.message_id=m.id AND n.kind='name' AND n.owner='' ORDER BY n.revision DESC LIMIT 1) AS name"
            " FROM messages m WHERE m.id=?", (root,)).fetchone()
        items.append({
            "message_id": root, "seq": row["seq"], "author_id": row["author_id"], "author_kind": row["author_kind"],
            "excerpt": detail["excerpt"], "name": detail["name"] or "", "count": count,
            "starred": bool(row["starred"]), "through": row["through"], "aside_revision": row["revision"],
            "order_key": row["rank"], "order_tie": row["tie"], "order_entry_key": row["entry_key"], "latest": latest,
        })
        if len(items) == limit:
            break
    unread = starred_unread(db, actor, topic, roots, {item["message_id"] for item in items})
    for item in items:
        item.update(unread[item["message_id"]])
    return {"instance_id": instance, "topic_id": topic, "items": items,
            "next_cursor": _key(candidates[at - 1]) if at < len(candidates) else None}

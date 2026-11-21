from __future__ import annotations

"""Caller-written divergence on agent roots (item 760, ruling 9197)."""

from .contract import LIMITS, Refusal
from .cover_values import STANDS_CHARS
from .stacks import EMPTY, current_acts
from .whispers import VISIBLE


def reason(value):
    if value is None:
        return None
    if (not isinstance(value, str) or not value.strip() or len(value) > STANDS_CHARS
            or any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in '\u2028\u2029' for c in value)):
        raise Refusal("INVALID_ARGUMENT", "A divergence reason is one nonblank line of at most %d characters" % STANDS_CHARS)
    return value


def candidates(db, actor, topic_id):
    # A current root has no readable effective parent: latest join, else reply,
    # just as StackRoots resolves it. Scope by topic_messages, never by history
    # in other topics. A private ancestor terminates the reader's dossier.
    rows = db.execute(
        "SELECT m.id,m.seq FROM messages m INDEXED BY topic_messages WHERE m.topic_id=:topic AND " + VISIBLE +
        " AND NOT EXISTS (SELECT 1 FROM messages p WHERE p.id=coalesce("
        "(SELECT json_extract(a.value,'$.into') FROM message_acts a WHERE a.message_id=m.id "
        "AND a.kind='join' AND a.owner='' ORDER BY a.revision DESC LIMIT 1),m.reply_to) "
        "AND p.topic_id=m.topic_id AND (p.private_to IS NULL OR p.author_id=:actor OR p.private_to=:actor)) "
        "ORDER BY m.seq LIMIT :limit", {"topic": topic_id, "actor": actor, "limit": LIMITS["root_post_candidates"]}).fetchall()
    acts = current_acts(db, actor, [row["id"] for row in rows], source_items=False)
    return [{"root_id": row["id"], "seq": row["seq"],
             "name": ((acts.get(row["id"], EMPTY)["name"] or {}).get("text") or "Message %d" % row["seq"])[:100],
             "name_revision": acts.get(row["id"], EMPTY)["name_revision"],
             "join_revision": acts.get(row["id"], EMPTY)["join_revision"]} for row in rows]


def check(db, actor, topic, snapshot):
    value = reason(snapshot.get("divergence_reason"))
    if snapshot.get("reply_to"):
        return None
    if value is None:
        roots = candidates(db, actor, topic["id"])
        if roots:
            names = "; ".join('%s (%s)' % (row["name"], row["root_id"]) for row in roots)
            raise Refusal("DIVERGENCE_REASON_REQUIRED",
                          "Reply in an existing dossier or supply a divergence reason for the new stack: " + names,
                          details={"topic_revision": topic["version"], "candidates": roots})
    return value

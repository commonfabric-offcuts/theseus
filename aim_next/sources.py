from __future__ import annotations

"""Topics started from a message: one question, one topic.

A new topic may name the message it answers, its source. Whoever starts
another topic from the same message sees the first ones before sending: the
`source_topics` view lists them, and publishing an opening whose source
already started a topic the person can read is refused until they say they
have seen it (`seen` on opening.publish). They can still go ahead; Core only
makes sure they knew. Two people starting a topic from the same message
seconds apart meet the same refusal, because the check runs where the topic
is created, in the publish's own transaction.

Only topics the person can read count and are listed: a topic they cannot
open is not one they could continue in.
"""

from .contract import LIMITS, READABLE, Refusal, _bounded_page, _identifier, _page_size, _prefix


# Version 18 keeps the message each topic was started from.
SOURCE_SCHEMA = [
    "ALTER TABLE topics ADD COLUMN source_message_id TEXT REFERENCES messages(id)",
    "CREATE INDEX topic_sources ON topics(source_message_id,id) WHERE source_message_id IS NOT NULL",
]
SOURCE_DOWN = ("DROP INDEX topic_sources", "ALTER TABLE topics DROP COLUMN source_message_id")
# A topic that names its source, or an unfinished opening that will.
SOURCE_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM topics WHERE source_message_id IS NOT NULL) "
                   "OR EXISTS (SELECT 1 FROM openings WHERE state='open' AND json_extract(payload,'$.source_message_id') IS NOT NULL)")
# How many unseen topics a refusal names; the view lists them all.
NAMED = 5

FROM_SOURCE = ("FROM topics t INDEXED BY topic_sources JOIN workspaces w ON w.id=t.workspace_id "
               "WHERE t.source_message_id=:message AND " + READABLE)


def seen_topics(args):
    """The topics a publish says its author has seen, from `args.seen`; () when not given."""
    if set(args) - {"seen"}:
        raise Refusal("INVALID_ARGUMENT", "The saved revision is the content; a publish names only the topics seen")
    seen = args.get("seen", [])
    if not isinstance(seen, list) or len(seen) > LIMITS["page_max"]:
        raise Refusal("INVALID_ARGUMENT", "Seen is a list of at most %d topics" % LIMITS["page_max"])
    return [_identifier(topic, "seen topic") for topic in seen]


class Sources:
    def _source_message(self, db, actor, message_id):
        """A source the actor can read, by its id."""
        return self._message_access(db, actor, _identifier(message_id, "source_message_id"))["id"]

    def _unseen_from_source(self, db, actor, message_id, seen):
        """(count, first few ids) of readable topics started from message_id that seen does not name."""
        values = dict({"message": message_id, "actor": actor}, **{"seen%d" % index: topic for index, topic in enumerate(seen)})
        clause = FROM_SOURCE + (" AND t.id NOT IN (%s)" % ",".join(":seen%d" % index for index in range(len(seen))) if seen else "")
        count = db.execute("SELECT count(*) " + clause, values).fetchone()[0]
        named = [row[0] for row in db.execute("SELECT t.id " + clause + " ORDER BY t.id LIMIT %d" % NAMED, values)]
        return count, named

    def _view_source_topics(self, db, actor, args):
        message_id = self._source_message(db, actor, args.get("message_id"))
        limit = _page_size(args)
        rows = db.execute("SELECT t.id,t.workspace_id,t.creator_id,t.state,t.archived,substr(CAST(t.title AS BLOB),1,1025) AS title_prefix,"
                          "s.message_count,m.seq AS latest_seq " + FROM_SOURCE.replace("WHERE", "LEFT JOIN topic_summaries s ON s.topic_id=t.id "
                          "LEFT JOIN messages m ON m.id=s.latest_message_id WHERE", 1) + " AND t.id>:cursor ORDER BY t.id LIMIT :limit",
                          {"message": message_id, "actor": actor, "cursor": args.get("cursor", ""), "limit": limit + 1}).fetchall()

        def item(row):
            title, truncated = _prefix(row["title_prefix"])
            return {"id": row["id"], "workspace_id": row["workspace_id"], "title": title, "title_truncated": truncated,
                    "creator_id": row["creator_id"], "state": row["state"], "archived": bool(row["archived"]),
                    "message_count": row["message_count"] or 0, "latest_seq": row["latest_seq"]}
        return _bounded_page({"instance_id": self.instance_id, "message_id": message_id}, rows, limit, item, "id")

from __future__ import annotations

"""Whispers: a message between one person and one agent, seen by those two only.

A whisper is a message whose `private_to` names the one other person in it.
Everything that reads a message for someone other than its author applies the
one rule below, VISIBLE in SQL (alias m) or visible() on a row already read;
there is no other copy of it. A refusal for a message the reader cannot see is
the refusal for a message that does not exist, so no refusal tells anyone a
whisper exists.

What a whisper counts for depends on who wrote it. A person's whisper counts as
their Tell: it is writing in the topic, answers the asks of the agent it goes
to, reopens a done topic and moves it up the list, settles an item it answers
for its coordinator, and may be a source, evidence or the owner's word
(private_source_refused). Only who can read it stays private: it never moves
the topic's count, latest message or latest by someone else, since those point
at the message itself. An agent's whisper answers a person's whisper and
nothing more: Conversation._publish returns before every shared fact for it.
Either reaches its one other person as an addressed delivery, and each of the
two gets an actor-scoped `whisper` change naming the topic.
"""

from .contract import Refusal
from .removal import VISIBLE as NOT_UNSENT


# Version 27: the one other person a whisper is between (NULL for every message
# on the record), an index that finds the replies to a message, and a trigger
# that keeps a whisper's shape whatever code inserts it.
WHISPER_SCHEMA = [
    "ALTER TABLE messages ADD COLUMN private_to TEXT",
    "CREATE INDEX message_reply_links ON messages(reply_to,seq) WHERE reply_to IS NOT NULL",
    "CREATE TRIGGER whisper_shape BEFORE INSERT ON messages WHEN NEW.private_to IS NOT NULL "
    "AND (NEW.addressees <> json_array(NEW.private_to) OR NEW.intent IS NOT NULL OR NEW.private_to = NEW.author_id) "
    "BEGIN SELECT RAISE(ABORT, 'whisper shape'); END",
]
WHISPER_DOWN = ("DROP TRIGGER whisper_shape", "DROP INDEX message_reply_links", "ALTER TABLE messages DROP COLUMN private_to")
# Release 22's code would show every whisper to every reader, so once one exists
# the step back is refused and a bad release is fixed forward.
WHISPER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM messages WHERE private_to IS NOT NULL)"

# A message is visible to a reader when it is on the record, or the reader is in the whisper.
VISIBLE = "(m.private_to IS NULL OR m.author_id = :actor OR m.private_to = :actor) AND " + NOT_UNSENT


# A delivery to an agent a reader may count (wake health): one on the record, or the reader's own whisper to it. A
# delivery's message is never the agent's own, so this is VISIBLE for the one reader bound as the next parameter.
READ_BY = "(m.private_to IS NULL OR m.author_id=?)"


def visible(row, actor):
    """The same rule for a row already read (it carries author_id and private_to)."""
    return row["private_to"] is None or actor in (row["author_id"], row["private_to"])


SHAPE = "WHISPER_SHAPE"
STAYS = "WHISPER_STAYS_PRIVATE"
TO_ONE = "A whisper goes to one agent. With more than one name, choose Tell or Ask; nothing was sent"
TO_AGENT = "A whisper goes to an agent; nothing was sent"
ANSWER_ONLY = ("An agent whispers only to answer a whisper sent to it: reply with --reply-to that whisper; "
               "nothing was sent")
SAME_PAIR = "A whisper answers a whisper only between the same two; nothing was sent"
NO_INTENT = "A whisper neither asks nor tells; send it without --asks or --tells; nothing was sent"
NEEDS_TOPIC = "A whisper goes in a topic that already exists. Start the topic first; nothing was sent"
REPLY_PRIVATE = "A reply to a whisper is a whisper. To put it on the record, quote it into a Tell; nothing was sent"
QUOTE_PRIVATE = ("A whisper stays between the two people in it. Only the person in it can quote it into a Tell; "
                 "nothing was sent")
AGENT_PRIVATE = ("An agent's whisper stays between the two people in it: it is never a source, evidence or where a problem "
                 "was found. Quote it into a Tell, or cite the person's whisper it answers; nothing was changed")


def whispering(writing):
    """Whether writing (a post's args, a draft or a frozen snapshot) is a whisper; null is not, and anything else but a boolean is refused."""
    value = writing.get("whisper")
    if value is None:
        return False
    if not isinstance(value, bool):
        raise Refusal("INVALID_ARGUMENT", "whisper is true, false or null")
    return value


def refuse_opening(writing):
    """Writing that opens a topic cannot be a whisper: the topic would start with no message anyone else sees."""
    if whispering(writing):
        raise Refusal(SHAPE, NEEDS_TOPIC)


def actor_kind(db, actor):
    """An actor's kind ("human" or "agent"), or None for nobody."""
    row = db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()
    return row["kind"] if row else None


def check_publish(db, actor, snapshot, parent):
    """Refuse writing whose whisper shape is wrong; return the whisper's other person, or None on the record.

    parent is the visible message the writing replies to (with author_id and
    private_to), or None. A parent the writer cannot see was already refused
    as absent, so nothing here names a whisper to someone outside it."""
    if not whispering(snapshot):
        if parent is not None and parent["private_to"] is not None:
            raise Refusal(STAYS, REPLY_PRIVATE)
        return None
    if snapshot.get("intent") is not None:
        raise Refusal(SHAPE, NO_INTENT)
    if snapshot.get("opening") is not None:
        raise Refusal(SHAPE, NEEDS_TOPIC)
    addressees = snapshot.get("addressees") or []
    if len(addressees) != 1:
        raise Refusal(SHAPE, TO_ONE)
    other = addressees[0]
    if actor_kind(db, actor) == "human":
        if other == actor or actor_kind(db, other) != "agent":
            raise Refusal(SHAPE, TO_AGENT)
        if parent is not None and parent["private_to"] is not None and {parent["author_id"], parent["private_to"]} != {actor, other}:
            raise Refusal(SHAPE, SAME_PAIR)
        return other
    # An agent never starts a whisper: it answers one sent to it, to the person who sent it.
    if parent is None or parent["private_to"] != actor or parent["author_id"] != other:
        raise Refusal(SHAPE, ANSWER_ONLY)
    return other


def quote_allowed(db, actor, source, private_to):
    """Refuse a quote of a whisper outside it (D3).

    source is the quoted message as _source returns it; private_to is the
    destination's other person when the writing is a whisper, else None. A
    whisper may be quoted into a message on the record by the person in it, or
    into another whisper between the same two."""
    if not source.get("whisper"):
        return
    pair = {source["author"], source["private_to"]}
    if private_to is not None:
        if pair == {actor, private_to}:
            return
    elif actor in pair and actor_kind(db, actor) == "human":
        return
    raise Refusal(STAYS, QUOTE_PRIVATE)


def private_source_refused(db, actor, message_id, words=AGENT_PRIVATE):
    """Refuse a whisper as a topic's source, as Notebook evidence, as where an item or problem came from or as the word a
    move is made on, unless a person wrote it and actor is one of its two people: a person's whisper counts as their Tell.
    Callers that read by id have already refused a message actor cannot see as absent; an import by number has not."""
    row = db.execute("SELECT m.author_id,m.private_to,a.kind FROM messages m JOIN actors a ON a.id=m.author_id WHERE m.id=?",
                     (message_id,)).fetchone()
    if row is None or row["private_to"] is None:
        return
    if row["kind"] != "human":
        raise Refusal(STAYS, words)
    if not visible(row, actor):
        raise Refusal(STAYS, QUOTE_PRIVATE)


def redact_quotes(db, actor, quotes):
    """A message's quotes as actor may read them: a quoted whisper keeps its excerpt, which its
    person chose to put on the record, but loses its source for anyone outside it."""
    result = []
    for quote in quotes:
        source = quote.get("source") if isinstance(quote, dict) else None
        if isinstance(source, dict) and source.get("kind") == "message":
            row = db.execute("SELECT author_id,private_to FROM messages WHERE id=?", (source.get("id"),)).fetchone()
            if row is not None and not visible(row, actor):
                quote = dict(quote, source=None)
        result.append(quote)
    return result


# The message a topic names: the one that reopened it, and the one it was started from.
TOPIC_MESSAGES = ("state_message_id", "source_message_id")


def redact_topic(db, actor, topic):
    """A topic (a row or dict with TOPIC_MESSAGES) as actor may read it: each message it names stays named only to a
    reader who may see that message. Anyone outside a person's whisper that reopened or started the topic reads null,
    so the topic says it was reopened (its note) or started from something, and names nothing."""
    topic = dict(topic)
    from .removal import unsent
    for field in TOPIC_MESSAGES:
        if topic.get(field) is not None:
            row = db.execute("SELECT author_id,private_to FROM messages WHERE id=?", (topic[field],)).fetchone()
            if row is not None and (not visible(row, actor) or unsent(db, topic[field])):
                topic[field] = None
    return topic


def no_answer(db, message):
    """Whether the viewer's own whisper (message: id, author_id, private_to) has no whisper reply from its other person."""
    return db.execute("SELECT 1 FROM messages INDEXED BY message_reply_links WHERE reply_to=? AND author_id=? AND private_to=? LIMIT 1",
                      (message["id"], message["private_to"], message["author_id"])).fetchone() is None


def on_record_wake_health(db, reader, quiet):
    """Wake health as reader sees it (34): for every agent but the reader, only deliveries the reader can read count,
    those on the record and the reader's own whispers to it.

    An agent whose pending work is others' whispers alone is left out, and the
    time its wakes have gone unanswered is never earlier than its oldest pending
    delivery the reader can read, so a whisper's wake is never shown to anyone
    outside it. The agent's own view, and its parking, still count its whispers.
    A delivery counts only in a live group, as the agent's own count does: one
    left pending by a subscription that ended waits on nobody."""
    shown = []
    for item in quiet:
        if item["actor_id"] == reader:
            shown.append(item)
            continue
        row = db.execute("SELECT count(*),min(m.sent_ms) FROM delivery_groups g INDEXED BY eligible_groups "
                         "CROSS JOIN deliveries d INDEXED BY pending_group_deliveries ON d.group_id=g.id AND d.state='pending' "
                         "JOIN messages m ON m.id=d.message_id WHERE g.recipient_id=? AND g.active=1 AND g.pending_count>0 AND " + READ_BY,
                         (item["actor_id"], reader)).fetchone()
        if not row[0]:
            continue
        item = dict(item, waiting=row[0])
        if item.get("since_ms") is not None and row[1] is not None:
            item["since_ms"] = max(item["since_ms"], row[1])
        shown.append(item)
    return shown


def whisper_fields(row):
    """What a message item says of a whisper: whether it is one, and who it is to."""
    if row["private_to"] is None:
        return {"whisper": False}
    return {"whisper": True, "private_to": row["private_to"]}


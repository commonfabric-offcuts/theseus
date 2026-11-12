from __future__ import annotations

"""Who writing from the page goes to when it starts with @names (docs/reader.md,
"Naming who a message is to").

Writing saved by the page's composers (the topic's composer and the Reader's
reply) that starts with one or more @names, each naming a member of its
topic, goes to exactly those members, in place of whoever the page offered
or named. Core decides this when the writing is frozen to be sent
(Drafts._command_submission_prepare), so the addressees on the record are
always those its words name; the page shows the same rule as the person types
(web/at-names.mjs, the one other copy of it, which must agree word for word).

A member is someone the topic's messages can be sent to: an active
participant or one of the outcome's team, switched on, other than the
writer. An @name names a member by their actor id or their name, either in
any case; an id wins over a name, and a name two members share names nobody.
The names are read from the start, after any spaces: each is "@" and a word
of letters, digits, "_", "." and "-" (a "." ending it is not part of it),
followed by the end of the writing, a space or one of , : ; ! ? and the run
stops at the first word that names no member. Such an @word is plain text.
The words stay in the message as written. Messages posted through
message.post (an agent's CLI) keep the addressees they name.
"""

import re

# The spaces both copies of the rule agree on (JavaScript's \s and Python's differ).
_SPACE = " \t\n\r\f\v "
_LEAD = re.compile("[" + _SPACE + "]*")
_WORD = re.compile(r"@([A-Za-z0-9_.\-]+)(?=[" + _SPACE + r",:;!?]|\Z)[" + _SPACE + r",:;]*")


def leading_names(body, members):
    """The ids of the members the writing's leading @names name, in order, each once.

    members: (actor_id, name) pairs; name may be None."""
    by_id, by_name = {}, {}
    for actor_id, name in members:
        by_id.setdefault(actor_id.lower(), actor_id)
        if name:
            by_name.setdefault(name.lower(), set()).add(actor_id)
    named, at = [], _LEAD.match(body).end()
    while True:
        word = _WORD.match(body, at)
        if word is None:
            return named
        key = word.group(1).rstrip(".").lower()
        shared = by_name.get(key, ())
        member = by_id.get(key) or (next(iter(shared)) if len(shared) == 1 else None)
        if member is None:
            return named
        if member not in named:
            named.append(member)
        at = word.end()


def topic_members(db, topic_id, writer):
    """Who writing in the topic can be sent to by name: its active participants and the
    outcome's team, switched on, without the writer; (actor_id, name) pairs."""
    # Both sets are bounded (LIMITS topic_participants and workspace_members) and read by their keys.
    return [(row[0], row[1]) for row in db.execute(
        "SELECT a.id,a.name FROM (SELECT actor_id FROM topic_participants WHERE topic_id=?1 AND active=1 UNION "
        "SELECT actor_id FROM workspace_members WHERE workspace_id=(SELECT workspace_id FROM topics WHERE id=?1)) p "
        "JOIN actors a ON a.id=p.actor_id WHERE a.enabled=1 AND a.id<>?2 ORDER BY a.id", (topic_id, writer))]


def addressed(db, topic_id, writer, writing):
    """The addressees page writing is sent to: the members its leading @names name, else
    those it was saved with."""
    named = leading_names(writing.get("body") or "", topic_members(db, topic_id, writer))
    return named or writing.get("addressees", [])

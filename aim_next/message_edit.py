from __future__ import annotations

"""Editing a message (items 228, 452 and 614, docs/message-edit.md).

A message's row never changes. An edit by its author, a person or an agent,
appends the message's next revision to `message_revisions`; revision 1 is the
row's own words. Every read of a message's words, whole or as a preview or excerpt,
goes through the one words helper below (words, words_at, current_words), so
everything that shows a message shows its latest words, and
tests/test_message_words.py fails on any other read of messages.body.

The helper is also where an agent view marks the words it hands out: the
boundary (Store._hand_over) takes the marks out and records, per agent, the
highest revision of each message by someone else it was handed (message_exposures).
An edit sends a correction only to an agent reader that was handed the words
before (or any agent reader of a message sent before exposures were kept):
a delivery of the message at the new revision, in a delivery group of its own
kind ('correction'), so it is never unread, addressed, read through or
thumbed away. Only an ack of its own id, a newer correction of the same
message, or the agent losing the message settles it. People never get one.
Every reader, people and agents, gets an actor-scoped `edit` change keyed by
the message at its new revision.

An agent's edit (item 614) also keeps, for each person who had read the
message (their delivery of it settled), the revision they had read, in the
same table (message_exposures, a person's row), and makes the message unread
for them again where their delivery counts (not a message between others, nor
a subscription closed since). A view then gives that person, and nobody else, the words they
had read and no longer stand (`struck`), so their page shows them struck
through beside the new words. A person's edit does neither.

While its author has it open in Edit (its one edit session), a message is
held from agents: their views show it without its words, and their
unsettled deliveries of it wait in the state 'held' until the holder saves
or closes the edit, or the hold lapses.
"""

import contextvars
import json
import re

from .contract import Refusal, _body, _identifier, _revision


# Version 40: each later revision of a message's words, and each delivery's
# revision, so one message can be delivered to one agent again at a later
# revision. Rows of message_revisions never change.
MESSAGE_REVISIONS_SCHEMA = [
    "CREATE TABLE message_revisions (message_id TEXT NOT NULL REFERENCES messages(id), revision INTEGER NOT NULL CHECK(revision>1), "
    "author_id TEXT NOT NULL REFERENCES actors(id), operation_id TEXT NOT NULL, body TEXT NOT NULL, edited_ms INTEGER NOT NULL, "
    "PRIMARY KEY(message_id,revision), UNIQUE(author_id,operation_id))",
    "CREATE TRIGGER immutable_message_revision_update BEFORE UPDATE ON message_revisions BEGIN SELECT RAISE(ABORT, 'immutable message revision'); END",
    "CREATE TRIGGER immutable_message_revision_delete BEFORE DELETE ON message_revisions BEGIN SELECT RAISE(ABORT, 'immutable message revision'); END",
]

DELIVERY_COLUMNS = "seq,id,message_id,recipient_id,group_id,state,topic_id"
# The deliveries table as version 39 keeps it (its topic column was added by version 18), and as version 40 builds it.
DELIVERIES_39 = ("CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), "
                 "recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), "
                 "state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, UNIQUE(message_id,recipient_id))")
DELIVERIES_40 = ("CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), "
                 "recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), "
                 "state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), "
                 "UNIQUE(message_id,recipient_id,revision))")
# What dropping the table drops with it, made again after its rows are back.
DELIVERY_INDEXES = [
    "CREATE INDEX recipient_deliveries ON deliveries(recipient_id,state,seq)",
    "CREATE INDEX pending_group_deliveries ON deliveries(group_id,seq) WHERE state='pending'",
    "CREATE INDEX pending_group_topic_deliveries ON deliveries(group_id,topic_id,seq) WHERE state='pending'",
    "CREATE TRIGGER delivery_topic_required BEFORE INSERT ON deliveries WHEN NEW.topic_id IS NULL "
    "BEGIN SELECT RAISE(ABORT, 'a delivery names its topic'); END",
]


def _rebuilt_deliveries(table):
    """Build deliveries again as table, keeping every row, its id and seq, where the next seq goes on from
    (sqlite_sequence), its indexes and trigger. delivery_reasons refers to deliveries, so its rows are kept
    aside first and put back after."""
    return ["CREATE TABLE deliveries_kept AS SELECT %s FROM deliveries" % DELIVERY_COLUMNS,
            "CREATE TABLE delivery_reasons_kept AS SELECT delivery_id,reason,topic_id,participant_epoch FROM delivery_reasons",
            "CREATE TABLE deliveries_sequence AS SELECT seq FROM sqlite_sequence WHERE name='deliveries'",
            "DELETE FROM delivery_reasons",
            "DROP TABLE deliveries", table,
            "INSERT INTO deliveries(%s) SELECT %s FROM deliveries_kept ORDER BY seq" % (DELIVERY_COLUMNS, DELIVERY_COLUMNS),
            "DELETE FROM sqlite_sequence WHERE name='deliveries'",
            "INSERT INTO sqlite_sequence(name,seq) SELECT 'deliveries',seq FROM deliveries_sequence",
            "INSERT INTO delivery_reasons(delivery_id,reason,topic_id,participant_epoch) SELECT delivery_id,reason,topic_id,participant_epoch "
            "FROM delivery_reasons_kept",
            "DROP TABLE deliveries_sequence", "DROP TABLE delivery_reasons_kept", "DROP TABLE deliveries_kept"] + DELIVERY_INDEXES


MESSAGE_EDIT_UP = MESSAGE_REVISIONS_SCHEMA + _rebuilt_deliveries(DELIVERIES_40)
MESSAGE_EDIT_DOWN = ["DROP TRIGGER immutable_message_revision_delete", "DROP TRIGGER immutable_message_revision_update",
                     "DROP TABLE message_revisions"] + _rebuilt_deliveries(DELIVERIES_39)
# Once any message is edited, version 39 would show its first words and lose the corrections' revisions.
MESSAGE_EDIT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_revisions)"

# Version 41 (item 452, slice 2): each message's one edit session, which keeps the person's draft in Core and holds the
# message from agents while it is open; what each agent was handed of a person's message (its exposure); and the
# horizon, the last message sent before exposures were kept, so every message at or below it counts as handed at
# revision 1 to every agent reader. A held delivery is a delivery in the state 'held': deliveries.state has no CHECK,
# so that is a new value, not a new constraint, and every pending index leaves held rows out as it does acknowledged ones.
EDIT_SESSION_UP = [
    "CREATE TABLE message_edit_sessions (message_id TEXT PRIMARY KEY REFERENCES messages(id), actor_id TEXT NOT NULL REFERENCES actors(id), "
    "holder TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), base_revision INTEGER NOT NULL CHECK(base_revision>0), draft TEXT NOT NULL, "
    "state TEXT NOT NULL CHECK(state IN ('open','saved','closed')), renewed_ms INTEGER NOT NULL, released_ms INTEGER)",
    "CREATE INDEX held_sessions ON message_edit_sessions(renewed_ms) WHERE state='open' AND released_ms IS NULL",
    "CREATE INDEX released_sessions ON message_edit_sessions(released_ms) WHERE released_ms IS NOT NULL",
    "CREATE TABLE message_exposures (actor_id TEXT NOT NULL REFERENCES actors(id), message_id TEXT NOT NULL REFERENCES messages(id), "
    "revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(actor_id,message_id))",
    "CREATE TRIGGER exposure_only_grows BEFORE UPDATE ON message_exposures WHEN NEW.revision<OLD.revision "
    "BEGIN SELECT RAISE(ABORT,'an exposure only grows'); END",
    "CREATE TRIGGER exposure_kept BEFORE DELETE ON message_exposures BEGIN SELECT RAISE(ABORT,'an exposure is kept'); END",
    "CREATE TABLE message_edit_horizon (seq INTEGER NOT NULL)",
    "INSERT INTO message_edit_horizon SELECT coalesce(max(seq),0) FROM messages",
]
EDIT_SESSION_DOWN = ["DROP TRIGGER exposure_kept", "DROP TRIGGER exposure_only_grows", "DROP INDEX released_sessions", "DROP INDEX held_sessions",
                     "DROP TABLE message_edit_horizon", "DROP TABLE message_exposures", "DROP TABLE message_edit_sessions"]
# An open session, held or lapsed, carries the person's Core draft; a held delivery has no meaning at version 40.
# Exposures are not counted: the next step up sets the horizon again, so every earlier message counts as handed.
EDIT_SESSION_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM message_edit_sessions WHERE state='open') "
                         "OR EXISTS (SELECT 1 FROM deliveries WHERE state='held')")


# What an agent view is reading (item 452). Store.view sets it around each run of a view handler (the boundary,
# Store._hand_over), so the words helper below knows whether it serves an agent, which messages are held now, and the
# run's random nonce; commands and open_media run with none. marks maps each token number this run handed out to the
# (message_id, revision) whose words follow it.
class Reading:
    __slots__ = ("agent", "now", "held", "nonce", "marks", "marking")

    def __init__(self, agent, now, held, nonce, marking=True):
        self.agent, self.now, self.held, self.nonce, self.marks, self.marking = agent, now, held, nonce, {}, marking


reading = contextvars.ContextVar("reading", default=None)
# Group 11's test mode: plain reads come back wrapped in U+E002, and mark takes the wrapper off, so a plain read that
# leaves a view without passing through mark shows.
PLAIN_PROBE = False
OPEN, CLOSE, PROBE = "\ue000", "\ue001", "\ue002"


def _hold_ms():
    from .contract import LIMITS
    return LIMITS["edit_hold_ms"]


# Item 614: agents edit their own words, so an agent's message handed to another agent is recorded too. The first post
# of a release that holds it says where that record begins (as stacks.record_wait_start does for item 475): an agent's
# message before it counts as handed at revision 1 to every agent reader, as a message at or below the horizon does.
AGENT_FROM_KEY = "agent_exposure_from_seq.614"


def record_agent_exposure_start(db, seq):
    """Called by every post (Conversation._publish) with its message's sequence: the first one says where agents'
    messages begin to be recorded as handed; every later one leaves it as it is."""
    db.execute("INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)", (AGENT_FROM_KEY, str(seq)))


def _counted_handed(kind, seq, horizon, agent_from):
    """Whether revision 1 of a message counts as handed to every agent reader with no record: a person's message at or
    below the horizon (version 41), or an agent's message from before AGENT_FROM_KEY (or with none yet)."""
    if kind == "human":
        return seq <= horizon
    return agent_from is None or seq < agent_from


def _agent_from(db):
    row = db.execute("SELECT value FROM metadata WHERE key=?", (AGENT_FROM_KEY,)).fetchone()
    return int(row[0]) if row else None


def held_ids(db, now):
    """The ids of every message held now: its session is open and not released, and was renewed within edit_hold_ms."""
    return {row[0] for row in db.execute("SELECT message_id FROM message_edit_sessions INDEXED BY held_sessions "
                                         "WHERE state='open' AND released_ms IS NULL AND renewed_ms>?", (now - _hold_ms(),))}


def is_held(db, message_id, now):
    """Whether one message is held now (the clock rule), by its session's primary key."""
    return db.execute("SELECT 1 FROM message_edit_sessions WHERE message_id=? AND state='open' AND released_ms IS NULL AND renewed_ms>?",
                      (message_id, now - _hold_ms())).fetchone() is not None


def holding(db, message_id):
    """Whether one message is holding (the data rule): its session is open and not released, lapsed or not."""
    return db.execute("SELECT 1 FROM message_edit_sessions WHERE message_id=? AND state='open' AND released_ms IS NULL",
                      (message_id,)).fetchone() is not None


def held_refusal(message_id):
    """The refusal an agent's act on a held message meets: nothing done, nothing recorded."""
    return Refusal("MESSAGE_HELD", "%s is being edited by its author and is held until they save or leave the edit (at most %d minutes). "
                   "Nothing was done." % (message_id, _hold_ms() // 60000), recorded=False)


def withheld(message_id):
    """True only inside an agent view, for a message held when the view began."""
    current = reading.get()
    return current is not None and current.agent and message_id in current.held


def mark(message_id, revision, text):
    """text, marked as the words of message_id at revision when an agent view hands it out; unchanged otherwise."""
    current = reading.get()
    if current is not None and PLAIN_PROBE and isinstance(text, str):
        text = text.replace(PROBE, "")
    if current is None or not current.agent or not current.marking or not text:
        return text
    number = len(current.marks)
    current.marks[number] = (message_id, revision)
    return OPEN + current.nonce + str(number) + CLOSE + text


def _plain_read(text):
    current = reading.get()
    if PLAIN_PROBE and current is not None and isinstance(text, str):
        return PROBE + text + PROBE
    return text


def marked_words(message_id, number, text, chars, plain):
    """The SQL function behind words(): a held message's words are "" in an agent view; otherwise the text, cut to chars
    characters (as substr(x,1,chars) keeps), plain for a read that measures or decides, marked for one handed out."""
    current = reading.get()
    if current is not None and current.agent and message_id in current.held:
        return ""
    if text is not None and chars is not None:
        text = text[:chars]
    if plain or current is None:
        return _plain_read(text)
    return mark(message_id, number, text)


def register(db):
    """Give one connection the words helper's SQL function. No schema object names it, so a connection without it
    (backup's, recovery's) still opens and reads the schema."""
    db.create_function("marked_words", 5, marked_words, deterministic=False)


def _marker():
    current = reading.get()
    return re.compile(re.escape(OPEN + current.nonce) + r"(\d+)" + re.escape(CLOSE)) if current is not None else None


def plain(value):
    """value with this view's complete markers taken out of every string, keys included: what a size bound measures."""
    current = reading.get()
    if current is None or not current.marks:
        return value
    pattern = _marker()

    def walk(item):
        if isinstance(item, str):
            return pattern.sub(lambda found: "" if int(found.group(1)) in current.marks else found.group(0), item) if OPEN in item else item
        if isinstance(item, dict):
            return {walk(key): walk(entry) for key, entry in item.items()}
        if isinstance(item, (list, tuple)):
            return [walk(entry) for entry in item]
        return item
    return walk(value)


def _collapsed(text):
    return " ".join(text.split())


def _head(excerpt):
    """A stored quote's head: its first non-empty line, whitespace collapsed, cut to 40 characters."""
    for line in excerpt.splitlines():
        if line.strip():
            return _collapsed(line)[:40]
    return ""


def handed(db, current, answer):
    """The boundary's walk of one run's answer: (the answer with exactly this run's complete markers taken out of every
    string, dict keys included, depth first; the (message_id, revision) pairs it handed).

    Each complete marker of this run's nonce with a token number this run handed out gives its pair, and the text from
    it to the next such marker or the string's end is its fragment. A message's own stored quotes whose head that
    fragment holds give their source too (one level), at the revision the quote names, or 1. Anything else that
    begins with U+E000 and this run's nonce is a cut or rewritten marker, which no view may return: StoreError."""
    from .contract import StoreError
    pattern = re.compile(re.escape(OPEN + current.nonce) + r"(\d+)" + re.escape(CLOSE))
    leftover = OPEN + current.nonce
    found = []

    def walk(item):
        if isinstance(item, str):
            if OPEN not in item:
                return item
            spots = [spot for spot in pattern.finditer(item) if int(spot.group(1)) in current.marks]
            for number, spot in enumerate(spots):
                end = spots[number + 1].start() if number + 1 < len(spots) else len(item)
                found.append(current.marks[int(spot.group(1))] + (item[spot.end():end],))
            kept, start = [], 0
            for spot in spots:
                kept.append(item[start:spot.start()])
                start = spot.end()
            kept.append(item[start:])
            stripped = "".join(kept)
            if leftover in stripped:
                raise StoreError("A view's answer kept a cut or rewritten words marker; nothing was returned")
            return stripped
        if isinstance(item, dict):
            return {walk(key): walk(value) for key, value in item.items()}
        if isinstance(item, list):
            return [walk(value) for value in item]
        if isinstance(item, tuple):
            return tuple(walk(value) for value in item)
        return item
    answer = walk(answer)
    pairs = [(message_id, number) for message_id, number, _ in found]
    if found:
        ids = sorted({message_id for message_id, _, _ in found})
        stored = dict(db.execute("SELECT m.id,m.quotes FROM messages m WHERE m.id IN (SELECT value FROM json_each(?))", (json.dumps(ids),)).fetchall())
        for message_id, _, fragment in found:
            text = _collapsed(fragment)
            for quote in json.loads(stored.get(message_id) or "[]"):
                source = quote.get("source") if isinstance(quote, dict) else None
                if not isinstance(source, dict) or source.get("kind") != "message" or not isinstance(quote.get("excerpt"), str):
                    continue
                head = _head(quote["excerpt"])
                if head and head in text:
                    number = source.get("revision")
                    pairs.append((source.get("id"), number if isinstance(number, int) and not isinstance(number, bool) and number > 0 else 1))
    return answer, pairs


def growing(db, actor, pairs):
    """The pairs that grow what the actor is known to have been handed, one per message at its highest revision: the
    message is someone else's, the revision is above the one recorded (0 when none), and it is not revision 1 of a
    message that counts as handed already (_counted_handed: a person's at or below the horizon, an agent's from before
    agents' messages were recorded)."""
    if not pairs:
        return []
    highest = {}
    for message_id, number in pairs:
        if isinstance(message_id, str):
            highest[message_id] = max(number, highest.get(message_id, 0))
    horizon = db.execute("SELECT coalesce(max(seq),0) FROM message_edit_horizon").fetchone()[0]
    agent_from = _agent_from(db)
    rows = db.execute("SELECT m.id,m.seq,m.author_id,a.kind,coalesce(e.revision,0) AS known FROM messages m JOIN actors a ON a.id=m.author_id "
                      "LEFT JOIN message_exposures e ON e.actor_id=? AND e.message_id=m.id WHERE m.id IN (SELECT value FROM json_each(?))",
                      (actor, json.dumps(sorted(highest)))).fetchall()
    return [(row["id"], highest[row["id"]]) for row in rows
            if row["author_id"] != actor and highest[row["id"]] > row["known"]
            and not (highest[row["id"]] == 1 and _counted_handed(row["kind"], row["seq"], horizon, agent_from))]


# The words helper. Each is SQL for the messages row named alias: its current words, their revision (1 when never
# edited) and when they were written by an edit (NULL when never edited). words() reads through marked_words, so an
# agent view gets a held message's words as "" and every other message's words marked with their revision; chars
# cuts them before they are marked, and plain reads them unmarked to measure or decide.
def words(alias="m", chars=None, plain=False):
    return ("marked_words(%s.id,%s,coalesce((SELECT r.body FROM message_revisions r WHERE r.message_id=%s.id ORDER BY r.revision DESC LIMIT 1),%s.body),%s,%d)"
            % (alias, revision(alias), alias, alias, "NULL" if chars is None else int(chars), 1 if plain else 0))


def revision(alias="m"):
    return "coalesce((SELECT max(r.revision) FROM message_revisions r WHERE r.message_id=%s.id),1)" % alias


def edited(alias="m"):
    return "(SELECT r.edited_ms FROM message_revisions r WHERE r.message_id=%s.id ORDER BY r.revision DESC LIMIT 1)" % alias


def current_words(db, message_id, shape=None, plain=False):
    """(words, revision, edited_ms) of one message as it reads now: shaped (shape applied to the plain words), and
    marked in an agent view unless plain. A held message's words are "" in an agent view."""
    row = db.execute("SELECT " + words(plain=True) + "," + revision() + "," + edited() + " FROM messages m WHERE m.id=?", (message_id,)).fetchone()
    if row is None:
        return (None, None, None)
    text = row[0] if shape is None else shape(row[0])
    return (text if plain else mark(message_id, row[1], text), row[1], row[2])


def words_at(db, message_id, number, shape=None, plain=False):
    """(words, edited_ms) of one revision of one message, or None when it has no such revision; shaped, held and
    marked with that revision as current_words does."""
    if number == 1:
        row = db.execute("SELECT marked_words(m.id,1,m.body,NULL,1),NULL FROM messages m WHERE m.id=?", (message_id,)).fetchone()
    else:
        row = db.execute("SELECT marked_words(r.message_id,r.revision,r.body,NULL,1),r.edited_ms FROM message_revisions r WHERE r.message_id=? AND r.revision=?",
                         (message_id, number)).fetchone()
    if row is None:
        return None
    text = row[0] if shape is None else shape(row[0])
    return (text if plain else mark(message_id, number, text), row[1])


def every_revision(db, message_id):
    """{revision: words} of one message, every revision it has had, read plain (a command's decision)."""
    found = {1: db.execute("SELECT marked_words(m.id,1,m.body,NULL,1) FROM messages m WHERE m.id=?", (message_id,)).fetchone()[0]}
    found.update(db.execute("SELECT r.revision,marked_words(r.message_id,r.revision,r.body,NULL,1) FROM message_revisions r WHERE r.message_id=?",
                            (message_id,)).fetchall())
    return found


def quoted_revision(db, message_id, quote_source, excerpt):
    """Check a quote's excerpt against the message it quotes. The source names the revision it quoted when the
    writer's page knew it: the excerpt must be in that revision. A quote naming none (written before edits
    existed) may quote any revision, and records none. Refuses INVALID_QUOTE."""
    texts = every_revision(db, message_id)
    if "revision" in quote_source:
        number = quote_source["revision"]
        if isinstance(number, bool) or not isinstance(number, int) or number not in texts or excerpt not in texts[number]:
            raise Refusal("INVALID_QUOTE", "The excerpt must preserve the words of the revision it quotes")
        return
    if not any(excerpt in text for text in texts.values()):
        raise Refusal("INVALID_QUOTE", "The excerpt must preserve the referenced source's words")


# What a person who had read a message sees once its agent author edits it (item 614): the words they had read that the
# latest words no longer hold, each placed where it stood. Words are runs of letters and digits, and each other mark
# stands alone, so "85," becoming "86," strikes "85" and keeps the comma; a change of spacing alone shows nothing. The
# words compared are what lies between the two texts' common start and end, by the shortest edit (Myers), which costs
# little for a correction of a few words. Bounded, since a message's words reach a megabyte: a middle part of more than
# STRUCK_TOKENS words, or one that needs more than STRUCK_EDITS words changed, is one change; at most STRUCK_CUTS places
# are given, and each place's words are cut to STRUCK_CHARS characters.
TOKENS = re.compile(r"\s+|\w+|[^\w\s]")
STRUCK_TOKENS = 20000
STRUCK_EDITS = 400
STRUCK_CUTS = 50
STRUCK_CHARS = 1000


def _units(text):
    """text's length as a page counts it, in UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


def _runs(a, b):
    """[(i1, i2, j)]: each run of a[i1:i2] that the shortest edit from a to b takes away, j the place in b where it
    stood; None when it needs more than STRUCK_EDITS words changed."""
    n, m = len(a), len(b)
    frontier, trace = {1: 0}, []
    for d in range(min(n + m, STRUCK_EDITS) + 1):
        trace.append(dict(frontier))
        for k in range(-d, d + 1, 2):
            x = frontier[k + 1] if k == -d or (k != d and frontier[k - 1] < frontier[k + 1]) else frontier[k - 1] + 1
            y = x - k
            while x < n and y < m and a[x] == b[y]:
                x, y = x + 1, y + 1
            frontier[k] = x
            if x >= n and y >= m:
                return _walk_back(trace, n, m)
    return None


def _walk_back(trace, x, y):
    """The runs taken away, from the edit's trace, walked back from its end."""
    taken = []
    for d in range(len(trace) - 1, -1, -1):
        frontier, k = trace[d], x - y
        before = k + 1 if k == -d or (k != d and frontier[k - 1] < frontier[k + 1]) else k - 1
        px = frontier[before]
        py = px - before
        while x > px and y > py:
            x, y = x - 1, y - 1
        if d > 0 and x != px:
            taken.append((px, py))
        x, y = px, py
    # Words taken away one after another in a are one change: only words put in can lie between them in b.
    runs = []
    for i, j in reversed(taken):
        if runs and runs[-1][1] == i:
            runs[-1] = (runs[-1][0], i + 1, runs[-1][2])
        else:
            runs.append((i, i + 1, j))
    return runs


def struck_words(old, new):
    """[{at, words}]: each run of old's words that new no longer holds, where it stood in new. at is a place in new,
    counted in UTF-16 code units as a page counts its text: the struck words go just before the character there (at
    new's length: after its end). In order of at, never two at one place."""
    a, b = TOKENS.findall(old), TOKENS.findall(new)
    start = 0
    while start < len(a) and start < len(b) and a[start] == b[start]:
        start += 1
    end = 0
    while end < len(a) - start and end < len(b) - start and a[len(a) - 1 - end] == b[len(b) - 1 - end]:
        end += 1
    middle_a, middle_b = a[start:len(a) - end], b[start:len(b) - end]
    runs = None if len(middle_a) + len(middle_b) > STRUCK_TOKENS else _runs(middle_a, middle_b)
    if runs is None:
        runs = [(0, len(middle_a), 0)] if middle_a else []
    places = [_units("".join(b[:start]))]
    for token in middle_b:
        places.append(places[-1] + _units(token))
    cuts = []
    for i1, i2, j in runs:
        words = "".join(middle_a[i1:i2]).strip()
        if not words:
            continue
        if len(words) > STRUCK_CHARS:
            words = words[:STRUCK_CHARS] + "\u2026"
        if cuts and cuts[-1]["at"] == places[j]:
            cuts[-1]["words"] += " " + words
        else:
            cuts.append({"at": places[j], "words": words})
    return cuts[:STRUCK_CUTS]


def struck(db, actor, message_id, revision_now, words_now, shown=None):
    """What one reader sees struck through on one message, or None: for a person whose row of message_exposures (written
    by the message's agent author's edit, item 614) names a revision they had read below the latest, {revision, cuts}
    with cuts from struck_words; shown, when the reader is given only the first words (a card's excerpt), keeps the
    cuts that fall within them. None for an agent, a message never edited, or a person with no such row."""
    if revision_now <= 1:
        return None
    row = db.execute("SELECT e.revision FROM message_exposures e JOIN actors a ON a.id=e.actor_id AND a.kind='human' "
                     "WHERE e.actor_id=? AND e.message_id=?", (actor, message_id)).fetchone()
    if row is None or row[0] >= revision_now:
        return None
    before = words_at(db, message_id, row[0], plain=True)
    if before is None:
        return None
    cuts = struck_words(before[0], words_now)
    if shown is not None:
        cuts = [cut for cut in cuts if cut["at"] < _units(shown)]
    return {"revision": row[0], "cuts": cuts} if cuts else None


EDIT_ARGUMENTS = "Name one message and its new words"
SESSION_ARGUMENTS = "Name one message and this edit's holder"
DRAFT_ARGUMENTS = "Name one message, this edit's holder, its words and the revision they start from"
# Only a person opens a message in Edit, which holds it from agents while they write; an agent saves its new words
# at once (message.edit), and so opens no session (item 614).
ONLY_PEOPLE = "Only people open a message in Edit; an agent saves its new words with message.edit"
ONLY_AUTHOR = "Only whoever wrote a message edits it"
UNCHANGED = "These are the message's words already; nothing was edited"
EMPTY = "A message needs writing or an attachment"
TAKEN = "This edit is open on another device"
CLOSED = "This edit is no longer open; its words are kept on this device"
BASE = "base_revision is one of the message's revisions"


class MessageEdit:
    def _editable(self, db, actor, message_id, reached=True, people=True):
        """The checks after the words' size, in order: the actor reaches the message (a whisper outside them, or a
        message they cannot read, is refused as an unknown id), is a person when people is true (an edit session's
        commands; message.edit passes False, item 614), wrote it, and its outcome is not kept to read (skipped by
        message.edit_close, so a hold can always be ended)."""
        message = self._message_access(db, actor, _identifier(message_id, "message_id"))
        if people and self._actor(db, actor)["kind"] != "human":
            raise Refusal("FORBIDDEN", ONLY_PEOPLE)
        if message["author_id"] != actor:
            raise Refusal("FORBIDDEN", ONLY_AUTHOR)
        if reached:
            # An edit writes only actor-scoped changes, which the guard passes: refused here in an outcome kept to
            # read, reached, archived or completed (item 404).
            self._refuse_if_closed(db, actor, db.execute("SELECT workspace_id FROM topics WHERE id=?", (message["topic_id"],)).fetchone()[0])
        return message

    def _command_message_edit(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) not in ({"body"}, {"body", "holder"}):
            raise Refusal("INVALID_ARGUMENT", EDIT_ARGUMENTS)
        body = _body(args["body"])
        holder = _identifier(args["holder"], "holder") if "holder" in args else None
        # 2-4. Reach, the author (a person or an agent, item 614), an outcome not reached.
        message = self._editable(db, actor, target["message_id"], people=False)
        # 5. Fenced on the revision the editor started from.
        now_words, current, _ = current_words(db, message["id"], plain=True)
        _revision(envelope["expected"], "message_revision", current)
        # 6-7. Words or an attachment, and words that differ.
        attachments = json.loads(db.execute("SELECT attachments FROM messages WHERE id=?", (message["id"],)).fetchone()[0])
        if not body.strip() and not attachments:
            raise Refusal("EMPTY_MESSAGE", EMPTY)
        if body == now_words:
            raise Refusal("INVALID_ARGUMENT", UNCHANGED)
        from . import delivery
        number, edited_ms = current + 1, delivery._now_ms()
        db.execute("INSERT INTO message_revisions(message_id,revision,author_id,operation_id,body,edited_ms) VALUES (?,?,?,?,?,?)",
                   (message["id"], number, actor, envelope["operation_id"], body, edited_ms))
        # The holder's Save ends the edit session and releases the hold before any correction is queued, so released
        # deliveries are pending again when the corrections run. Any other Save leaves the session as it is.
        session = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=?", (message["id"],)).fetchone()
        closed = holder is not None and session is not None and session["state"] == "open" and session["holder"] == holder
        result = {"message_id": message["id"], "revision": number, "edited_ms": edited_ms, "session_closed": closed}
        if closed:
            result["session_revision"] = self._end_session(db, message, session, "saved")
            self._release(db, message["id"], edited_ms)
        readers = self._message_readers(db, message, actor)
        reader_agents = [reader for reader in readers if reader != actor and self._actor_kind(db, reader) == "agent"]
        # Only an agent that was handed the old words is corrected: one with an exposure of the message, or any reader
        # of a message that counts as handed with no record (a person's at or below the horizon, before exposures were
        # kept; an agent's from before agents' messages were recorded, item 614).
        sent = db.execute("SELECT m.seq,a.kind FROM messages m JOIN actors a ON a.id=m.author_id WHERE m.id=?", (message["id"],)).fetchone()
        below = _counted_handed(sent["kind"], sent["seq"],
                                db.execute("SELECT coalesce(max(seq),0) FROM message_edit_horizon").fetchone()[0], _agent_from(db))
        exposed = [agent for agent in reader_agents if below or db.execute(
            "SELECT 1 FROM message_exposures WHERE actor_id=? AND message_id=?", (agent, message["id"])).fetchone()]
        for agent in exposed:
            # A newer correction settles the agent's older one, pending or held.
            for row in self._pending_corrections(db, agent, message["id"]):
                self._acknowledge(db, agent, row)
            self._settle_held_corrections(db, agent, message["id"])
            delivery_id = self._queue_delivery(db, message["id"], agent, message["topic_id"], {"correction": None}, revision=number)
            if db.execute("SELECT state FROM deliveries WHERE id=?", (delivery_id,)).fetchone()[0] == "pending":
                # A correction queued held is announced when it is released.
                self._change(db, "actor", agent, "delivery", delivery_id, 1)
        # An agent that can no longer read the message keeps no correction of it; an unexposed reader keeps its own.
        for row in db.execute("SELECT d.* FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                              "WHERE d.message_id=? AND d.state='pending' AND g.kind='correction' AND g.active=1", (message["id"],)).fetchall():
            if row["recipient_id"] not in reader_agents:
                self._acknowledge(db, row["recipient_id"], row)
        for row in db.execute("SELECT DISTINCT d.recipient_id FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                              "WHERE d.message_id=? AND d.state='held' AND g.kind='correction'", (message["id"],)).fetchall():
            if row[0] not in reader_agents:
                self._settle_held_corrections(db, row[0], message["id"])
        # An agent's edit makes the message unread again for each person who had read it, and keeps what they had
        # read, so their page shows it struck through beside the new words (item 614). A person's edit does neither.
        unread_again = self._unread_again(db, message, readers, current) if self._actor_kind(db, actor) == "agent" else 0
        for reader in readers:
            self._change(db, "actor", reader, "edit", message["id"], number)
        refresh_version = self._complete_refresh(db, actor, message, "message_refresh", number)
        return (dict(result, corrections=len(exposed), unread_again=unread_again),
                [{"kind": "message", "id": message["id"], "version": number}] +
                ([{"kind": "acts", "id": message["topic_id"], "version": refresh_version}] if refresh_version else []))

    def _unread_again(self, db, message, readers, revision):
        """For each person among the readers who had read the message when its agent author edited it (item 614):
        their delivery of its first revision is settled (by reading it on screen, a read-through, a reply, a 👍 or an
        ack; a message between others, sent by name to others and not answering theirs, was settled for them when it
        was sent). Keeps the revision they had read (a person's row of message_exposures, which only grows), so they
        see the words it took away struck through. Where that delivery counts, it is made pending again, as an
        arrival, so the message is unread for them and the New line finds it; a message between others counts nowhere
        for them, nor does a delivery in a subscription closed since, so those stay settled. The editor is an agent,
        and agents are never among them. Returns how many people it made unread again."""
        row = db.execute("SELECT m.addressees,p.author_id AS answers FROM messages m LEFT JOIN messages p ON p.id=m.reply_to WHERE m.id=?",
                         (message["id"],)).fetchone()
        addressees = json.loads(row["addressees"])
        count = 0
        for reader in readers:
            if self._actor_kind(db, reader) != "human":
                continue
            delivery = db.execute("SELECT d.id,d.seq,d.group_id,d.state,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                                  "WHERE d.message_id=? AND d.recipient_id=? AND d.revision=1", (message["id"], reader)).fetchone()
            if delivery is None or delivery["state"] != "acknowledged":
                continue
            db.execute("INSERT INTO message_exposures(actor_id,message_id,revision) VALUES (?,?,?) "
                       "ON CONFLICT(actor_id,message_id) DO UPDATE SET revision=max(revision,excluded.revision)", (reader, message["id"], revision))
            between = bool(addressees) and reader not in addressees and reader != row["answers"]
            if between or not delivery["active"]:
                continue
            db.execute("UPDATE deliveries SET state='pending' WHERE id=?", (delivery["id"],))
            db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=min(coalesce(first_pending_seq,?),?) WHERE id=?",
                       (delivery["seq"], delivery["seq"], delivery["group_id"]))
            self._eligibility_changed(db, reader, 1)
            self._change(db, "actor", reader, "delivery", delivery["id"], 1)
            count += 1
        return count

    def _settle_held_corrections(self, db, agent, message_id):
        """Settle the agent's corrections of a message that are held (it is still open in Edit on another device). A held
        row is counted nowhere, so settling it is its state alone, with the change an acknowledgment writes."""
        for (delivery_id,) in db.execute("SELECT d.id FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id WHERE d.message_id=? "
                                         "AND d.recipient_id=? AND d.state='held' AND g.kind='correction'", (message_id, agent)).fetchall():
            db.execute("UPDATE deliveries SET state='acknowledged' WHERE id=?", (delivery_id,))
            self._change(db, "actor", agent, "delivery", delivery_id, 2)

    # Edit sessions (docs/message-edit.md, slice 2) ----------------------------------------------------------------------

    def _session_change(self, db, message, revision):
        """The actor-scope change a page hears when the session of its author's message moves."""
        self._change(db, "actor", message["author_id"], "edit_session", message["id"], revision)

    def _end_session(self, db, message, session, state):
        """End an open session as saved or closed: its draft goes; returns its new revision."""
        revision = session["revision"] + 1
        db.execute("UPDATE message_edit_sessions SET state=?,draft='',revision=? WHERE message_id=?", (state, revision, message["id"]))
        self._session_change(db, message, revision)
        return revision

    def _command_message_edit_open(self, db, actor, envelope):
        """Open the message's one edit session on this device's holder, or take it over from another device, and hold
        the message from agents. A session that was saved or closed starts again from the current words; an open one,
        held or lapsed, keeps its draft and base, so any device resumes it. Only a person opens one (ONLY_PEOPLE)."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) != {"holder"}:
            raise Refusal("INVALID_ARGUMENT", SESSION_ARGUMENTS)
        holder = _identifier(args["holder"], "holder")
        message = self._editable(db, actor, target["message_id"])
        from . import delivery
        now = delivery._now_ms()
        words_now, current, _ = current_words(db, message["id"], plain=True)
        session = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=?", (message["id"],)).fetchone()
        if session is None or session["state"] != "open":
            revision, taken = (session["revision"] + 1 if session else 1), False
            db.execute("INSERT INTO message_edit_sessions(message_id,actor_id,holder,revision,base_revision,draft,state,renewed_ms,released_ms) "
                       "VALUES (?,?,?,?,?,?,'open',?,NULL) ON CONFLICT(message_id) DO UPDATE SET actor_id=excluded.actor_id,holder=excluded.holder,"
                       "revision=excluded.revision,base_revision=excluded.base_revision,draft=excluded.draft,state='open',"
                       "renewed_ms=excluded.renewed_ms,released_ms=NULL",
                       (message["id"], actor, holder, revision, current, words_now, now))
            self._hold(db, message["id"])
        else:
            revision, taken = session["revision"] + 1, session["holder"] != holder
            db.execute("UPDATE message_edit_sessions SET holder=?,renewed_ms=?,revision=?,released_ms=NULL WHERE message_id=?",
                       (holder, now, revision, message["id"]))
            if session["released_ms"] is not None:
                # A lapse that was released: open again, it holds again.
                self._hold(db, message["id"])
        self._session_change(db, message, revision)
        row = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=?", (message["id"],)).fetchone()
        base_words = words_at(db, message["id"], row["base_revision"], plain=True)[0]
        return {"message_id": message["id"], "session_revision": revision, "holder": holder, "taken": taken,
                "base_revision": row["base_revision"], "base_words": base_words, "draft": row["draft"], "revision": current,
                "words": words_now, "renewed_ms": now, "hold_ms": _hold_ms()}, []

    def _command_message_edit_draft(self, db, actor, envelope):
        """Keep the edit's draft in Core; each save renews the hold, and one after a released lapse holds again."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) != {"holder", "body", "base_revision"}:
            raise Refusal("INVALID_ARGUMENT", DRAFT_ARGUMENTS)
        # 1. The size refusal is recorded, before access, as message.edit's is.
        body = _body(args["body"])
        holder = _identifier(args["holder"], "holder")
        message = self._editable(db, actor, target["message_id"])
        session = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=?", (message["id"],)).fetchone()
        if session is None or session["state"] != "open":
            raise Refusal("EDIT_CLOSED", CLOSED, recorded=False)
        if session["holder"] != holder:
            raise Refusal("EDIT_TAKEN", TAKEN, recorded=False)
        _revision(envelope["expected"], "session_revision", session["revision"])
        _, current, _ = current_words(db, message["id"], plain=True)
        base = args["base_revision"]
        if isinstance(base, bool) or not isinstance(base, int) or not 1 <= base <= current:
            raise Refusal("INVALID_ARGUMENT", BASE)
        from . import delivery
        now = delivery._now_ms()
        revision = session["revision"] + 1
        db.execute("UPDATE message_edit_sessions SET draft=?,base_revision=?,renewed_ms=?,revision=?,released_ms=NULL WHERE message_id=?",
                   (body, base, now, revision, message["id"]))
        if session["released_ms"] is not None:
            self._hold(db, message["id"])
        self._session_change(db, message, revision)
        return {"message_id": message["id"], "session_revision": revision, "renewed_ms": now}, []

    def _command_message_edit_close(self, db, actor, envelope):
        """End the edit without saving, by its holder, and release the hold. With no open session nothing changes."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"message_id"} or set(args) != {"holder"}:
            raise Refusal("INVALID_ARGUMENT", SESSION_ARGUMENTS)
        holder = _identifier(args["holder"], "holder")
        message = self._editable(db, actor, target["message_id"], reached=False)
        session = db.execute("SELECT * FROM message_edit_sessions WHERE message_id=?", (message["id"],)).fetchone()
        if session is None or session["state"] != "open":
            return {"message_id": message["id"], "closed": False}, []
        if session["holder"] != holder:
            # The other device still holds the message: nothing is released.
            raise Refusal("EDIT_TAKEN", TAKEN, recorded=False)
        from . import delivery
        revision = self._end_session(db, message, session, "closed")
        self._release(db, message["id"], delivery._now_ms())
        return {"message_id": message["id"], "closed": True, "session_revision": revision}, []

    def _hold(self, db, message_id):
        """Holding begins: every unsettled agent delivery of the message moves from 'pending' to 'held', the same row,
        uncounted as an acknowledgment uncounts it. It is not an acknowledgment: no change, no operation, nothing
        settled or read through, no wake answered. To the scheduler it is a departure (_eligibility_changed)."""
        for row in db.execute("SELECT d.id,d.recipient_id,d.group_id,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                              "JOIN actors a ON a.id=d.recipient_id WHERE d.message_id=? AND d.state='pending' AND a.kind='agent' ORDER BY d.seq",
                              (message_id,)).fetchall():
            db.execute("UPDATE deliveries SET state='held' WHERE id=?", (row["id"],))
            if row["active"]:
                head = db.execute("SELECT seq FROM deliveries INDEXED BY pending_group_deliveries WHERE group_id=? AND state='pending' ORDER BY seq LIMIT 1",
                                  (row["group_id"],)).fetchone()
                db.execute("UPDATE delivery_groups SET pending_count=pending_count-1,first_pending_seq=? WHERE id=?",
                           (head[0] if head else None, row["group_id"]))
                self._eligibility_changed(db, row["recipient_id"], -1)

    def _release(self, db, message_id, now):
        """Holding ends (the holder's Save or close, or a lapse a write observed): each held delivery of the message is
        the same row again, pending, counted as an arrival, and handed back: a turn that was told of it before the hold
        is told again, and it is due now, or when a live claim ends. Returns how many rows it released."""
        if db.execute("UPDATE message_edit_sessions SET released_ms=? WHERE message_id=? AND released_ms IS NULL", (now, message_id)).rowcount == 0:
            return 0
        rows = db.execute("SELECT d.id,d.seq,d.recipient_id,d.group_id,g.active FROM deliveries d JOIN delivery_groups g ON g.id=d.group_id "
                          "WHERE d.message_id=? AND d.state='held' ORDER BY d.seq", (message_id,)).fetchall()
        lowest = {}
        for row in rows:
            db.execute("UPDATE deliveries SET state='pending' WHERE id=?", (row["id"],))
            if row["active"]:
                db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=min(coalesce(first_pending_seq,?),?) WHERE id=?",
                           (row["seq"], row["seq"], row["group_id"]))
                self._eligibility_changed(db, row["recipient_id"], 1)
                lowest[row["recipient_id"]] = min(row["seq"], lowest.get(row["recipient_id"], row["seq"]))
            self._change(db, "actor", row["recipient_id"], "delivery", row["id"], 1)
        for recipient, seq in sorted(lowest.items()):
            db.execute("UPDATE recipient_schedule SET handed_seq=CASE WHEN handed_seq>=? THEN NULL ELSE handed_seq END,named_seq=NULL,retry_count=0,"
                       "next_due_ms=CASE WHEN claim_token IS NOT NULL AND claim_until_ms>? THEN claim_until_ms ELSE ? END "
                       "WHERE recipient_id=? AND pending_count>0", (seq, now, now, recipient))
        return len(rows)

    def _release_lapsed(self, db, now):
        """Release every session that is holding and has lapsed by now. Returns how many it released."""
        lapsed = db.execute("SELECT message_id FROM message_edit_sessions INDEXED BY held_sessions WHERE state='open' AND released_ms IS NULL "
                            "AND renewed_ms<=? ORDER BY renewed_ms,message_id", (now - _hold_ms(),)).fetchall()
        for (message_id,) in lapsed:
            self._release(db, message_id, now)
        return len(lapsed)

    def _actor_kind(self, db, actor):
        row = db.execute("SELECT kind FROM actors WHERE id=?", (actor,)).fetchone()
        return row["kind"] if row else None

    def _pending_corrections(self, db, agent, message_id=None):
        """The agent's pending corrections in its active correction group, of one message or of every one."""
        return db.execute("SELECT d.* FROM delivery_groups g CROSS JOIN deliveries d INDEXED BY pending_group_deliveries "
                          "ON d.group_id=g.id AND d.state='pending' WHERE g.recipient_id=? AND g.kind='correction' AND g.active=1"
                          + (" AND d.message_id=?" if message_id is not None else ""),
                          (agent,) + ((message_id,) if message_id is not None else ())).fetchall()

    def _correction_readable(self, db, actor, row):
        """Whether the actor may be shown this delivery: any delivery but a correction, and a correction of a message
        the actor can read now."""
        if row["revision"] == 1:
            return True
        try:
            self._message_access(db, actor, row["message_id"])
        except Refusal:
            return False
        return True

    def _settle_unreadable_corrections(self, db, actor):
        """In the write that takes a message from the actor, settle its corrections of messages it can no longer read,
        so no count, wake or notice keeps them; the wake's claim does the same before it hands work (runner.py).
        The walk is the actor's own pending corrections. Returns how many it settled."""
        settled = 0
        for row in self._pending_corrections(db, actor):
            if not self._correction_readable(db, actor, row):
                self._acknowledge(db, actor, row)
                settled += 1
        return settled

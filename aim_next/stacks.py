from __future__ import annotations

"""What people record about messages as they read a topic in reply stacks (docs/reply-stacks.md).

A message never changes. Each act about one is a new row here, with who did it
and when, so nothing is overwritten and anyone can see and take back a shared
change:

- `star` (message.star): the reader keeps the message for themselves. Theirs
  alone; it holds on every device and never folds.
- `deal` (message.deal): the reader dealt with the stack as far as this message
  (by replying in it or a thumbs-up), so it folds to its newest reply the next
  time they come to it. Theirs alone.
- `fold` (message.fold): the reader folded this message to one line, on every
  device and after reloads, until they unfold it. Theirs alone.
- `place` (stack.place): where the reader keeps the stack this message heads in
  their own order of the topic's stacks, as a number to sort by, or none to let
  new replies move it again. Theirs alone.
- `name` (stack.name): the short name of the dossier this message is the first
  message of; a name typed anywhere in a dossier lands there. The topic's:
  anyone who reads it may rename it, everyone sees it, and it says who typed
  it. Empty gives the stack back its first line.
- `join` (stack.join): the stack this message heads is joined to the end of
  another stack (`into`, a message of that stack), or split back out (none).
  The topic's, wiki style, with who did it.

A personal row belongs to its reader (`owner` is their id); a shared row has the
empty owner. An act's revision counts its rows for that message, kind and owner,
so the newest row is the act as it stands, and every act is fenced on the
revision its sender read: a late request never undoes a newer one.

Who hears of it: a personal act only its reader, a shared act everyone who reads
the message (Reactions._message_readers), each through an actor-scoped change
`acts` keyed by the topic, at the act's row id, which only grows. Nothing is
written to a topic's or outcome's scope, so no count, light, activity time or
"new" moves.
"""

import json
import math

from .contract import READABLE, Refusal, _bounded_page, _identifier, _page_size
from .delivery import _now_ms
from .whispers import VISIBLE, visible
from .message_edit import words, withheld


def _act_table(kinds):
    return ("CREATE TABLE message_acts (id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "kind TEXT NOT NULL CHECK(kind IN (%s)), "
            "message_id TEXT NOT NULL REFERENCES messages(id), topic_id TEXT NOT NULL REFERENCES topics(id), seq INTEGER NOT NULL, "
            "owner TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), value TEXT NOT NULL, at_ms INTEGER NOT NULL, "
            "revision INTEGER NOT NULL CHECK(revision>0), UNIQUE(message_id,kind,owner,revision))" % ",".join("'%s'" % kind for kind in kinds))


ACT_INDEXES = ["CREATE INDEX topic_acts ON message_acts(topic_id,seq)", "CREATE INDEX reader_stars ON message_acts(owner,kind,id)"]
# Version 35's table, which the stacks' step makes; version 37 adds the fold.
ACT_SCHEMA = [_act_table(("star", "deal", "place", "name", "join"))] + ACT_INDEXES
FOLD_SCHEMA = [_act_table(("star", "deal", "fold", "place", "name", "join"))] + ACT_INDEXES
ASIDE_INDEXES = ["CREATE INDEX stack_replies ON messages(reply_to,topic_id)",
                 "CREATE INDEX stack_joins ON message_acts(json_extract(value,'$.into')) WHERE kind='join'"]
ACT_FRESH = [_act_table(("star", "deal", "fold", "place", "name", "join", "aside"))] + ACT_INDEXES + ASIDE_INDEXES
ACT_DOWN = ("DROP INDEX reader_stars", "DROP INDEX topic_acts", "DROP TABLE message_acts")
# Any row: dropping one would restart its revisions, and a late request could then undo a newer act.
ACT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_acts)"


def _rebuilt(table):
    """The statements that build message_acts again as table, keeping every row, its id, and where
    the next id goes on from (sqlite_sequence), which a dropped table would lose: a change to the
    acts is announced at its row id, which only grows."""
    columns = "id,kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision"
    return ["CREATE TABLE message_acts_kept AS SELECT %s FROM message_acts" % columns,
            "CREATE TABLE message_acts_sequence AS SELECT seq FROM sqlite_sequence WHERE name='message_acts'",
            "DROP TABLE message_acts", table,
            "INSERT INTO message_acts(%s) SELECT %s FROM message_acts_kept ORDER BY id" % (columns, columns),
            "DELETE FROM sqlite_sequence WHERE name='message_acts'",
            "INSERT INTO sqlite_sequence(name,seq) SELECT 'message_acts',seq FROM message_acts_sequence",
            "DROP TABLE message_acts_sequence", "DROP TABLE message_acts_kept"] + ACT_INDEXES


# Version 37 lets the table hold a fold. SQLite changes a CHECK only by building the table again.
FOLD_UP = _rebuilt(FOLD_SCHEMA[0])
FOLD_DOWN = _rebuilt(ACT_SCHEMA[0])
# Any fold, even one taken back: version 36 cannot hold its rows, and dropping them would restart its revisions.
FOLD_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_acts WHERE kind='fold')"

ASIDE_UP = _rebuilt(ACT_FRESH[0]) + ASIDE_INDEXES
ASIDE_DOWN = ["DROP INDEX stack_replies"] + _rebuilt(FOLD_SCHEMA[0])
ASIDE_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_acts WHERE kind='aside')"

PERSONAL = {"star", "deal", "fold", "place", "aside"}
# The command for each act, and the revision its sender read.
KINDS = {"message.star": ("star", "star_revision"), "message.deal": ("deal", "deal_revision"),
         "message.fold": ("fold", "fold_revision"), "stack.place": ("place", "place_revision"), "stack.name": ("name", "name_revision"),
         "stack.join": ("join", "join_revision"), "stack.aside": ("aside", "aside_revision")}
# A short name is one line of at most this many characters; the page ends a long one in "…".
NAME_CHARS = 200
# A place is a number to sort by; this bound keeps it exact as JSON in every client.
PLACE_BOUND = 1e15
# The longest chain of joins and replies a join is checked through for a loop.
JOIN_DEPTH = 10000
# What an act stands at before anyone has made it.
NONE = {"aside": {"through": None}, "star": {"starred": False}, "deal": {"dealt": False}, "fold": {"folded": False}, "place": {"key": None}, "name": {"name": ""}, "join": {"into": None}}
EMPTY = {"aside": None, "aside_revision": 0, "starred": False, "star_revision": 0, "dealt": False, "deal_revision": 0, "folded": False, "fold_revision": 0,
         "placed": None, "place_revision": 0,
         "name": None, "name_revision": 0, "joined": None, "join_revision": 0}


def _flag(args, name, words):
    if set(args) != {name} or not isinstance(args[name], bool):
        raise Refusal("INVALID_ARGUMENT", words)
    return {name: args[name]}


def _value(kind, args):
    """The act's stored value, from its command's args, or a refusal saying what it takes."""
    if kind == "aside":
        through = args.get("through", False) if set(args) == {"through"} else False
        if through is not None and (isinstance(through, bool) or not isinstance(through, int) or through < 1):
            raise Refusal("INVALID_ARGUMENT", "Name the last observed message sequence, or none to bring the dossier back")
        return {"through": through}
    if kind == "star":
        return _flag(args, "starred", "Name one message and whether it is starred")
    if kind == "deal":
        return _flag(args, "dealt", "Name one message and whether its stack is dealt with")
    if kind == "fold":
        return _flag(args, "folded", "Name one message and whether it is folded")
    if kind == "place":
        key = args.get("key") if set(args) == {"key"} else False
        if key is not None and (isinstance(key, bool) or not isinstance(key, (int, float)) or not math.isfinite(key) or abs(key) > PLACE_BOUND):
            raise Refusal("INVALID_ARGUMENT", "Name one stack and the number it is kept at, or none to let new replies move it")
        return {"key": key}
    if kind == "name":
        name = args.get("name") if set(args) == {"name"} else None
        if not isinstance(name, str):
            raise Refusal("INVALID_ARGUMENT", "Name one stack and its short name, or an empty name for its first line")
        name = " ".join(name.split())
        if len(name) > NAME_CHARS:
            raise Refusal("INVALID_ARGUMENT", "A short name is at most %d characters" % NAME_CHARS)
        return {"name": name}
    into = args.get("into", False) if set(args) == {"into"} else False
    if into is not None:
        if into is False:
            raise Refusal("INVALID_ARGUMENT", "Name the stack to join and a message of the stack it joins, or none to split it back out")
        _identifier(into, "into")
    return {"into": into}


def _shown(kind, row):
    """An act's row as a reader reads it, in the item's `acts` fields."""
    value = json.loads(row["value"])
    if kind == "aside":
        return {"aside": value["through"]}
    if kind == "star":
        return {"starred": value["starred"]}
    if kind == "deal":
        return {"dealt": value["dealt"]}
    if kind == "fold":
        return {"folded": value["folded"]}
    if kind == "place":
        return {"placed": value["key"]}
    if kind == "name":
        return {"name": {"text": value["name"], "by": row["actor_id"], "at_ms": row["at_ms"]} if value["name"] else None}
    return {"joined": {"into": value["into"], "by": row["actor_id"], "at_ms": row["at_ms"]} if value["into"] else None}


def current_acts(db, actor, message_ids):
    """{message_id: acts} for each message with any act as it stands for actor: their own and the topic's."""
    found = {}
    if not message_ids:
        return found
    marks = ",".join("?" * len(message_ids))
    rows = db.execute(
        "SELECT a.* FROM message_acts a WHERE a.message_id IN (%s) AND a.owner IN ('',?) AND a.revision="
        "(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=a.message_id AND b.kind=a.kind AND b.owner=a.owner)" % marks,
        list(message_ids) + [actor]).fetchall()
    for row in rows:
        kind = row["kind"]
        acts = found.setdefault(row["message_id"], dict(EMPTY))
        acts.update(_shown(kind, row))
        acts[kind + "_revision"] = row["revision"]
    return found


def act_fields(db, actor, items):
    """Add `acts` to every item of one page of a topic's messages."""
    found = current_acts(db, actor, [item["id"] for item in items])
    for item in items:
        item["acts"] = found.get(item["id"], dict(EMPTY))
    positions = stack_positions(db, actor, items)
    for item in items:
        item["stack_position"] = positions[item["id"]]


# Where the rule of a message waiting for a reply begins (item 475, docs/topic-reading.md, "Waiting for a reply"):
# the sequence of the first message posted by a release that holds it, written once, by that post, and never moved.
# A message before it was in the store when the rule shipped and never waits, so nothing already there starts
# pulsing; a store no such release has posted to has none, and no message there waits.
WAIT_FROM_KEY = "reply_wait_from_seq"


def record_wait_start(db, seq):
    """Called by every post (Conversation._publish) with its message's sequence: the first one records where the
    rule of waiting for a reply begins; every later one leaves it as it is."""
    db.execute("INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)", (WAIT_FROM_KEY, str(seq)))


def awaiting_fields(db, actor, topic, items):
    """Add `awaiting_reply` to every item of one page, after act_fields has placed each in its dossier (item 475,
    docs/topic-reading.md, "Waiting for a reply"). True on a message of the reader's own, on the record (not a
    whisper), posted from where the rule begins (WAIT_FROM_KEY), in a topic that is not an outcome's conversation,
    that an agent received (a delivery of its first revision to an agent: one it was addressed to, or one taking part
    and switched on when it was sent), until the first reply from anyone else. A reply is what Theseus already reads
    as answering a message: a message by someone else the reader can see after it in its dossier, one whose reply_to
    names it wherever it is stacked (as the Conversation's Answered reads an answer), a message on the record by
    someone else after it that names the reader (an Ask or a Tell to them), or an agent's thumbs-up on it, its "got
    it" (one given counts after it is taken back: the first reply was made). False on every other message. It is read
    from what is stored, never stored: showing it changes nothing."""
    start = db.execute("SELECT value FROM metadata WHERE key=?", (WAIT_FROM_KEY,)).fetchone()
    own = [item for item in items if item["author_id"] == actor and not item.get("whisper")
           and start is not None and item["seq"] >= int(start[0])]
    received, answered, named = set(), set(), None
    if own and topic["kind"] != "conversation":
        ids = [item["id"] for item in own]
        marks = ",".join("?" * len(ids))
        received = {row[0] for row in db.execute(
            "SELECT DISTINCT d.message_id FROM deliveries d JOIN actors a ON a.id=d.recipient_id "
            "WHERE d.message_id IN (%s) AND d.revision=1 AND a.kind='agent'" % marks, ids)}
        answered = {row[0] for row in db.execute(
            "SELECT DISTINCT m.reply_to FROM messages m INDEXED BY message_reply_links WHERE m.reply_to IN (%s) "
            "AND m.author_id<>:actor AND %s" % (",".join(":m%d" % n for n in range(len(ids))), VISIBLE),
            dict({"actor": actor}, **{"m%d" % n: mid for n, mid in enumerate(ids)}))}
        answered |= {row[0] for row in db.execute(
            "SELECT DISTINCT r.message_id FROM message_reactions r JOIN actors a ON a.id=r.actor_id "
            "WHERE r.message_id IN (%s) AND r.kind='thumb' AND a.kind='agent'" % marks, ids)}
        # The newest message on the record by anyone but the reader, from the topic's summary (work.py: the latest
        # message, or the latest by someone other than its author): a message naming the reader can be no newer, so
        # what is read below lies between the reader's oldest message here and it, however the topic grows after.
        newest = db.execute("SELECT CASE WHEN l.author_id<>:actor THEN l.seq ELSE o.seq END FROM topic_summaries s "
                            "LEFT JOIN messages l ON l.id=s.latest_message_id LEFT JOIN messages o ON o.id=s.other_message_id "
                            "WHERE s.topic_id=:topic", {"actor": actor, "topic": topic["id"]}).fetchone()
        lowest = min(item["seq"] for item in own)
        if newest is not None and newest[0] is not None and newest[0] > lowest:
            named = db.execute("SELECT max(n.seq) FROM message_addressees n CROSS JOIN messages m ON m.seq=n.seq "
                               "WHERE n.topic_id=? AND n.actor_id=? AND n.seq>? AND n.seq<=? AND m.author_id<>? AND m.private_to IS NULL",
                               (topic["id"], actor, lowest, newest[0], actor)).fetchone()[0]
    others = {}
    for item in items:
        item["awaiting_reply"] = False
        if item["id"] not in received or item["id"] in answered or named is not None and named > item["seq"]:
            continue
        root = item["stack_position"]["root_id"]
        if root not in others:
            others[root] = _dossier(db, actor, root)[1]
        item["awaiting_reply"] = others[root] is None or others[root] < item["seq"]


class StackRoots:
    def __init__(self, db, actor):
        self.db, self.actor, self.roots = db, actor, {}

    def root(self, mid):
        path, seen, at = [], set(), mid
        for _ in range(JOIN_DEPTH):
            if at in self.roots:
                at = self.roots[at]
                break
            if at in seen:
                raise Refusal("STACK_CHANGED", "This dossier has a cyclic join; read it again")
            path.append(at); seen.add(at)
            row = self.db.execute("SELECT m.id,m.topic_id,m.reply_to,(SELECT json_extract(a.value,'$.into') FROM message_acts a WHERE a.message_id=m.id AND a.kind='join' AND a.owner='' ORDER BY revision DESC LIMIT 1) AS joined FROM messages m WHERE m.id=?", (at,)).fetchone()
            parent = row["joined"] or row["reply_to"]
            if not parent:
                break
            above = self.db.execute("SELECT id,topic_id,author_id,private_to FROM messages WHERE id=?", (parent,)).fetchone()
            if not above or above["topic_id"] != row["topic_id"] or not visible(above, self.actor):
                break
            at = parent
        else:
            raise Refusal("STACK_CHANGED", "This dossier's ancestry is too deep")
        for seen in path:
            self.roots[seen] = at
        return at


def _dossier(db, actor, root):
    """(the newest message, the newest by someone else) the reader can see in root's dossier, as sequences or None.
    Both recursive arms seek indexed children of the current member. The join
    arm accepts only the latest act; a nonempty join overrides reply ancestry."""
    row = db.execute("""
        WITH RECURSIVE members(id) AS (
          SELECT :root
          UNION
          SELECT m.id FROM members p JOIN messages m ON m.reply_to=p.id
          JOIN messages parent ON parent.id=p.id AND parent.topic_id=m.topic_id
          WHERE """ + VISIBLE + """
            AND coalesce((SELECT json_extract(a.value,'$.into') FROM message_acts a
              WHERE a.message_id=m.id AND a.kind='join' AND a.owner='' ORDER BY revision DESC LIMIT 1),'')=''
          UNION
          SELECT m.id FROM members p JOIN message_acts a ON json_extract(a.value,'$.into')=p.id AND a.kind='join'
          JOIN messages m ON m.id=a.message_id JOIN messages parent ON parent.id=p.id AND parent.topic_id=m.topic_id
          WHERE a.owner='' AND a.revision=(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=a.message_id AND b.kind='join' AND b.owner='')
            AND """ + VISIBLE + """
        ) SELECT max(m.seq), max(CASE WHEN m.author_id<>:actor THEN m.seq END) FROM members p JOIN messages m ON m.id=p.id
        """, {"root": root, "actor": actor}).fetchone()
    return row[0], row[1]


def _seen_seq(db, actor, topic):
    """The newest sequence in the topic the reader can see: a whisper they are outside never moves it."""
    row = db.execute("SELECT m.seq FROM messages m INDEXED BY topic_messages WHERE m.topic_id=:topic AND " + VISIBLE +
                     " ORDER BY m.seq DESC LIMIT 1", {"topic": topic, "actor": actor}).fetchone()
    return row[0] if row else 0


def _seen_acts(db, actor, topic):
    """The newest act in the topic the reader hears of: their own and the topic's, on messages they can see."""
    return db.execute("SELECT coalesce(max(a.id),0) FROM message_acts a INDEXED BY topic_acts JOIN messages m ON m.id=a.message_id "
                      "WHERE a.topic_id=:topic AND a.owner IN ('',:actor) AND " + VISIBLE, {"topic": topic, "actor": actor}).fetchone()[0]


def stack_positions(db, actor, items):
    """{message id: its dossier's position for the reader}. `at` is the snapshot it was read at: for a dossier put
    aside, the newest message in it the reader can see (0 for one that is not, which no message moves), and the
    newest act in the topic they hear of. A whisper the reader is outside moves neither, nor does a message outside
    the dossier, so a page of earlier messages reads the same however the topic grows."""
    roots, acts_at, positions, result = StackRoots(db, actor), {}, {}, {}
    for item in items:
        topic = item["topic_id"]
        if topic not in acts_at:
            acts_at[topic] = _seen_acts(db, actor, topic)
        root = roots.root(item["id"])
        if root not in positions:
            acts = current_acts(db, actor, [root]).get(root, EMPTY)
            through = acts["aside"]
            latest, others = _dossier(db, actor, root) if through is not None else (0, None)
            positions[root] = {"root_id": root, "through": through, "aside_revision": acts["aside_revision"],
                               "name": acts["name"], "name_revision": acts["name_revision"],
                               "below": through is not None and (others is None or others <= through),
                               "at": {"messages": latest, "acts": acts_at[topic]}}
        result[item["id"]] = positions[root]
    return result


class Stacks:
    def _acted_message(self, db, actor, target):
        """The message an act names, read only by someone who reads its topic; refused as unknown otherwise."""
        if set(target) != {"message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one message")
        message_id = _identifier(target["message_id"], "message_id")
        message = db.execute("SELECT id,topic_id,seq,author_id,private_to,reply_to,addressees FROM messages WHERE id=?", (message_id,)).fetchone()
        # A whisper someone is not in is refused as an unknown message.
        if message is None or not visible(message, actor):
            raise Refusal("FORBIDDEN", "No permission for this message")
        # Acts live in a topic the person reads; a message read only because it was sent to them by name has none.
        topic = self._topic(db, actor, message["topic_id"])
        return message, topic

    def _act_revision(self, db, message_id, kind, owner):
        row = db.execute("SELECT max(revision) FROM message_acts WHERE message_id=? AND kind=? AND owner=?", (message_id, kind, owner)).fetchone()
        return row[0] or 0

    def _act_value(self, db, message_id, kind, owner):
        row = db.execute("SELECT value FROM message_acts WHERE message_id=? AND kind=? AND owner=? ORDER BY revision DESC LIMIT 1",
                         (message_id, kind, owner)).fetchone()
        return json.loads(row[0]) if row else None

    def _join_loop(self, db, message, into):
        """Whether joining message into the stack of `into` would put a stack inside itself: the chain from `into`,
        through each message's join or else what it answers in the topic, reaches message."""
        at, seen = into, set()
        for _ in range(JOIN_DEPTH):
            if at == message["id"]:
                return True
            if at in seen:
                return False
            seen.add(at)
            joined = self._act_value(db, at, "join", "")
            if joined and joined["into"]:
                at = joined["into"]
                continue
            row = db.execute("SELECT p.id FROM messages m JOIN messages p ON p.id=m.reply_to AND p.topic_id=m.topic_id WHERE m.id=?", (at,)).fetchone()
            if row is None:
                return False
            at = row[0]
        raise Refusal("INVALID_ARGUMENT", "This stack is joined too deep to join again")

    def _command_stack_act(self, db, actor, envelope):
        kind, expected_name = KINDS[envelope["kind"]]
        message, topic = self._acted_message(db, actor, envelope["target"])
        value = _value(kind, envelope["args"])
        # A dossier is put aside and named as a whole, on its first message as this reader's Core finds it.
        if kind in ("aside", "name") and StackRoots(db, actor).root(message["id"]) != message["id"]:
            raise Refusal("STACK_CHANGED", "This is not the first message of its dossier now; read it again")
        if kind == "aside":
            if value["through"] is not None and value["through"] > _seen_seq(db, actor, message["topic_id"]):
                raise Refusal("INVALID_ARGUMENT", "The observed sequence is ahead of this topic")
        personal = kind in PERSONAL
        if not personal:
            # A reached outcome's topics are kept to read: its stacks keep their names and joins.
            if db.execute("SELECT 1 FROM outcome_reached WHERE workspace_id=?", (topic["workspace_id"],)).fetchone():
                raise Refusal("OUTCOME_REACHED", "This outcome was reached; its topics are kept to read.")
        if kind == "join" and value["into"] is not None:
            into = db.execute("SELECT id,topic_id,author_id,private_to FROM messages WHERE id=?", (value["into"],)).fetchone()
            if into is None or not visible(into, actor) or into["topic_id"] != message["topic_id"]:
                raise Refusal("INVALID_ARGUMENT", "A stack joins another stack in its own topic")
            if into["id"] == message["id"] or self._join_loop(db, message, into["id"]):
                raise Refusal("INVALID_ARGUMENT", "A stack cannot join a stack inside itself")
        owner = actor if personal else ""
        current = self._act_revision(db, message["id"], kind, owner)
        if envelope["expected"][expected_name] != current:
            raise Refusal("REVISION_CONFLICT", "This changed since it was read; nothing was changed", {expected_name: current})
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"]}
        if (self._act_value(db, message["id"], kind, owner) or NONE[kind]) == value:
            return dict(result, **value, **{expected_name: current, "changed": False}), []
        revision = current + 1
        version = self._record_act(db, kind, message, owner, actor, value, revision)
        return dict(result, **value, **{expected_name: revision, "changed": True, "acts_version": version}), [
            {"kind": "acts", "id": message["topic_id"], "version": version}]

    def _record_act(self, db, kind, message, owner, actor, value, revision):
        """Records an act as its next row and tells who hears of it: a personal act its reader, a shared one
        everyone who reads the message. Returns the row's id, the version the change is announced at."""
        version = db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?,?,?)",
                             (kind, message["id"], message["topic_id"], message["seq"], owner, actor,
                              json.dumps(value, separators=(",", ":"), ensure_ascii=False), _now_ms(), revision)).lastrowid
        for reader in [actor] if owner else self._message_readers(db, message, actor):
            self._change(db, "actor", reader, "acts", message["topic_id"], version)
        return version

    _command_message_star = _command_message_deal = _command_message_fold = _command_stack_place = _command_stack_name = _command_stack_join = _command_stack_aside = _command_stack_act

    def _view_stack_positions(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        ids = args.get("message_ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(mid, str) for mid in ids):
            raise Refusal("INVALID_ARGUMENT", "Name one to 100 message ids")
        rows = []
        for mid in dict.fromkeys(ids):
            row, _ = self._acted_message(db, actor, {"message_id": mid})
            if row["topic_id"] != topic["id"]:
                raise Refusal("INVALID_ARGUMENT", "Messages must be in the named topic")
            rows.append(row)
        found = stack_positions(db, actor, rows)
        return {"instance_id": self.instance_id, "topic_id": topic["id"],
                "items": [{"message_id": row["id"], "stack_position": found[row["id"]]} for row in rows]}

    def _fold_answered(self, db, actor, message_id):
        """A person who replies to a message (its reply_to names it) or gives it a thumbs-up has dealt with it: it
        folds for them, as their own message.fold would, in the same transaction as the reply or the thumb, so
        every page, device and the CLI agree (item 377). Their fold only. A starred message never folds this way,
        one already folded stays, an agent's reply or thumb folds nothing, and a message read only because it was
        sent to them by name (no topic they read) has no acts. Returns what it affected."""
        if self._actor(db, actor)["kind"] != "human":
            return []
        message = db.execute("SELECT id,topic_id,seq,author_id,private_to FROM messages WHERE id=?", (message_id,)).fetchone()
        if not (message and visible(message, actor)):
            return []
        try:
            self._topic(db, actor, message["topic_id"])
        except Refusal:
            return []
        if (self._act_value(db, message_id, "star", actor) or NONE["star"])["starred"]:
            return []
        if (self._act_value(db, message_id, "fold", actor) or NONE["fold"])["folded"]:
            return []
        version = self._record_act(db, "fold", message, actor, actor, {"folded": True}, self._act_revision(db, message_id, "fold", actor) + 1)
        return [{"kind": "acts", "id": message["topic_id"], "version": version}]

    def _view_message_acts(self, db, actor, args):
        """The acts as they stand for the reader on one topic's messages, newest message first, paged by sequence:
        only messages with any, and only messages the reader may see. `version` is the newest act the reader hears of."""
        topic = self._topic(db, actor, args.get("topic_id"))
        limit = _page_size(args)
        cursor = args.get("cursor", 9223372036854775807)
        if isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0:
            raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
        rows = db.execute("SELECT DISTINCT a.message_id AS id,a.seq FROM message_acts a INDEXED BY topic_acts JOIN messages m ON m.id=a.message_id "
                          "WHERE a.topic_id=:topic AND a.seq<:cursor AND a.owner IN ('',:actor) AND (m.private_to IS NULL OR m.author_id=:actor OR m.private_to=:actor) "
                          "ORDER BY a.seq DESC LIMIT :limit", {"topic": topic["id"], "cursor": cursor, "actor": actor, "limit": limit + 1}).fetchall()
        found = current_acts(db, actor, [row["id"] for row in rows[:limit]])
        return _bounded_page({"instance_id": self.instance_id, "topic_id": topic["id"], "version": _seen_acts(db, actor, topic["id"])}, rows, limit,
                             lambda row: {"message_id": row["id"], "seq": row["seq"], "acts": found.get(row["id"], dict(EMPTY))}, "seq")

    def _view_stars(self, db, actor, args):
        """The reader's starred messages, wherever they can still read them, the newest star first, paged by star."""
        limit = _page_size(args)
        cursor = args.get("cursor", 9223372036854775807)
        if isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0:
            raise Refusal("INVALID_ARGUMENT", "Invalid cursor")
        rows = db.execute(
            "SELECT a.id AS star,a.at_ms AS starred_ms,a.revision,m.id,m.topic_id,m.seq,m.author_id,m.sent_ms," + words("m", chars=160) + " AS excerpt,"
            "t.title AS topic_title,t.kind AS topic_kind,t.workspace_id FROM message_acts a INDEXED BY reader_stars "
            "JOIN messages m ON m.id=a.message_id JOIN topics t ON t.id=m.topic_id JOIN workspaces w ON w.id=t.workspace_id "
            "WHERE a.owner=:actor AND a.kind='star' AND a.id<:cursor AND json_extract(a.value,'$.starred')=1 "
            "AND a.revision=(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=a.message_id AND b.kind='star' AND b.owner=a.owner) "
            "AND (m.private_to IS NULL OR m.author_id=:actor OR m.private_to=:actor) AND " + READABLE +
            " ORDER BY a.id DESC LIMIT :limit", {"actor": actor, "cursor": cursor, "limit": limit + 1}).fetchall()
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, lambda row: {
            "message_id": row["id"], "topic_id": row["topic_id"], "seq": row["seq"], "author_id": row["author_id"],
            "sent_ms": row["sent_ms"], "excerpt": row["excerpt"], "withheld": withheld(row["id"]), "topic_title": row["topic_title"],
            "conversation": row["topic_kind"] == "conversation", "workspace_id": row["workspace_id"],
            "starred_ms": row["starred_ms"], "star_revision": row["revision"], "star": row["star"]}, "star")

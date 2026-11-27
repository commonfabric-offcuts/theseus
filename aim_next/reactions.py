from __future__ import annotations

"""Thumbs-up and go-ahead answers on a message (docs/thumbs.md).

A reaction belongs to one actor, one message and one kind:

- `thumb`: "I read it and I understand", never "do it". Its revision is its
  whole state, as a mark's is: odd means thumbed, even means taken back. On
  an ask that waits on the person who gives it, it also answers yes (item 239,
  `_thumb_answer`): its value is then `yes` rather than `up`.
- `answer`: a person's ✅ (`yes`, go ahead) or 🚫 (`no`, don't) to a message
  that asks them for a go-ahead (`messages.go_ahead`, an Ask an agent marks
  with --go-ahead). Its value is the answer; its revision counts the changes.

Every change advances the row's revision and rows are never deleted, so a
revision is never reused, and the sum of a message's revisions (its reaction
version) only grows. Renewing a thumb for edited words advances its odd revision
by two and leaves any answer it gave in place. A thumb given and an answer read the message for the
reactor, as opening it does: they settle the reactor's own pending delivery
of it and clear their mark on it (marks.py), in the same act; neither changes
topic state or order, and only a thumb that answers an ask, or is taken back
from one, changes a wait. A thumb's result says whether it read the message
(`settled`: it was unread for the reactor, by a pending delivery or a mark,
and is read now), and a result whose act cleared a mark carries the mark's
new revision (`mark_revision`). Taking a thumb back settles nothing, clears
nothing and unsettles nothing: what was read stays read, and a mark stays.

An answer is also said where the asker reads it: the same act posts a short
reply from the person to the agent (`✅ Go ahead` or `🚫 Don't`), so the agent
is told through its delivery, the topic stops waiting on the person for that
ask, and an agent needs nothing new to hear it.

Who sees a reaction is who sees the message: everyone who can read the topic
and everyone it was sent to by name, or, on a whisper, its two people
(whispers.visible). Each of them gets an
actor-scoped change `reaction` keyed by the message at its new reaction
version; nothing is written to the topic's scope, whose keys open pages check
strictly (web/freshness.mjs), so a page from an earlier release never sees an
unknown key.
"""

import json

from .whispers import visible
from .contract import READABLE, Refusal, _identifier, _revision
from .delivery import _now_ms
from .message_edit import edited, revision
from .outcome_asks import held_ask, record_ask
from .standing_conversation import is_conversation
from .removal import value as removal_value


# The version after 29 (provisional; the release train renumbers).
REACTION_SCHEMA = [
    "CREATE TABLE message_reactions (actor_id TEXT NOT NULL REFERENCES actors(id), message_id TEXT NOT NULL REFERENCES messages(id), "
    "kind TEXT NOT NULL CHECK(kind IN ('thumb','answer')), topic_id TEXT NOT NULL REFERENCES topics(id), "
    "value TEXT CHECK(value IS NULL OR value IN ('up','yes','no')), at_ms INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), "
    "PRIMARY KEY(actor_id,message_id,kind))",
    "CREATE INDEX message_reaction_rows ON message_reactions(message_id)",
    "ALTER TABLE messages ADD COLUMN go_ahead INTEGER NOT NULL DEFAULT 0 CHECK(go_ahead IN (0,1))",
]
REACTION_DOWN = ("ALTER TABLE messages DROP COLUMN go_ahead", "DROP INDEX message_reaction_rows", "DROP TABLE message_reactions")
# Any row, taken-back thumbs included (dropping one would restart its
# revisions), and any message that asks for a go-ahead.
REACTION_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM message_reactions) OR EXISTS (SELECT 1 FROM messages WHERE go_ahead=1)"

EMPTY = {"version": 0, "thumbs": [], "answers": [], "thumb_revision": 0, "answer_revision": 0}
ANSWERS = {"yes": "✅ Go ahead", "no": "🚫 Don't"}
GO_AHEAD_NEEDS_ASK = "--go-ahead goes on an Ask: name who you ask with --asks; nothing was sent"


def answered_yes(thumb):
    """Whether a thumb row answered its ask yes (item 239): the one reading of a thumb's `value`, for
    the wait a later 👍 moves, the thumb's readers and the person taking it back alike."""
    return thumb is not None and thumb["value"] == "yes"


def go_ahead_flag(args):
    """message.post's go_ahead: true, false or absent; anything else is refused."""
    value = args.get("go_ahead", False)
    if not isinstance(value, bool):
        raise Refusal("INVALID_ARGUMENT", "go_ahead is true or false")
    return value


class Reactions:
    def _reaction_row(self, db, actor, message_id, kind):
        return db.execute("SELECT value,revision,at_ms FROM message_reactions WHERE actor_id=? AND message_id=? AND kind=?",
                          (actor, message_id, kind)).fetchone()

    def _reacted_message(self, db, actor, target, *, with_revision=False):
        if set(target) != {"message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one message")
        message_id = _identifier(target["message_id"], "message_id")
        # The same reach as reading it: a topic the actor reads, or a message
        # sent to them by name; a whisper they are not in is refused as unknown.
        self._message_access(db, actor, message_id)
        edit = ", " + revision() + " AS message_revision, " + edited() + " AS edited_ms" if with_revision else ""
        return db.execute("SELECT id,topic_id,seq,author_id,private_to,addressees,go_ahead,intent,sent_ms" + edit +
                          " FROM messages m WHERE id=?",
                          (message_id,)).fetchone()

    def _react(self, db, actor, message, kind, value, revision, now, reads):
        """Records the reaction and tells its readers: (reaction version, read, cleared mark revision or None).

        reads: the act reads the message for the reactor (a thumb given, an answer). Unread is a pending delivery or a
        mark (docs/attention.md), so reading clears the reactor's mark as well as settling their delivery, here, for
        every reaction alike; a thumb taken back clears no mark."""
        db.execute("INSERT INTO message_reactions(actor_id,message_id,kind,topic_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?) "
                   "ON CONFLICT(actor_id,message_id,kind) DO UPDATE SET value=excluded.value,at_ms=excluded.at_ms,revision=excluded.revision",
                   (actor, message["id"], kind, message["topic_id"], value, now, revision))
        # Reacting is reading: the reactor's own pending delivery is settled.
        pending = db.execute("SELECT d.* FROM deliveries d CROSS JOIN delivery_groups g ON g.id=d.group_id "
                             "WHERE d.message_id=? AND d.recipient_id=? AND d.revision=1 AND d.state='pending' AND g.active=1",
                             (message["id"], actor)).fetchone()
        if pending is not None:
            self._acknowledge(db, actor, pending)
        cleared = self._clear_mark(db, actor, message) if reads else None
        version = db.execute("SELECT SUM(revision) FROM message_reactions WHERE message_id=?", (message["id"],)).fetchone()[0]
        for reader in self._message_readers(db, message, actor):
            self._change(db, "actor", reader, "reaction", message["id"], version)
        # Whether this act read the message for the reactor: a page places its New line afresh only then.
        return version, pending is not None or cleared is not None, cleared

    def _clear_mark(self, db, actor, message):
        """Clears actor's mark on message, as message.mark clearing it does (the next revision, a `mark` change), and
        returns its new revision; None when it is not marked."""
        current = self._mark_revision(db, actor, message["id"])
        if current % 2 == 0:
            return None
        db.execute("UPDATE message_marks SET revision=? WHERE actor_id=? AND message_id=?", (current + 1, actor, message["id"]))
        self._change(db, "actor", actor, "mark", message["id"], current + 1)
        return current + 1

    @staticmethod
    def _read_by(result, affected, message, cleared):
        """A reaction's result and affected, with the mark it cleared when it cleared one."""
        if cleared is None:
            return result, affected
        return dict(result, mark_revision=cleared), affected + [{"kind": "mark", "id": message["id"], "version": cleared}]

    def _message_readers(self, db, message, actor):
        """Everyone who sees the message's reactions, by the reach of reading it (_message_access): its whisper's
        two people, or whoever reads its topic and whoever it was sent to by name, and the reactor."""
        if message["private_to"] is not None:
            return list(dict.fromkeys([message["author_id"], message["private_to"], actor]))
        rows = db.execute("SELECT w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?1 "
                          "UNION SELECT creator_id FROM topics WHERE id=?1 "
                          "UNION SELECT m.actor_id FROM topics t JOIN workspace_members m ON m.workspace_id=t.workspace_id WHERE t.id=?1 "
                          "UNION SELECT actor_id FROM topic_participants WHERE topic_id=?1 AND active=1 "
                          "UNION SELECT d.recipient_id FROM deliveries d JOIN delivery_reasons r ON r.delivery_id=d.id "
                          "WHERE d.message_id=?2 AND r.reason='addressed'", (message["topic_id"], message["id"])).fetchall()
        return list(dict.fromkeys([row[0] for row in rows] + [actor]))

    def _command_message_thumb(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(args) != {"thumbed"} or not isinstance(args["thumbed"], bool):
            raise Refusal("INVALID_ARGUMENT", "Name one message and whether it is thumbed up")
        thumbed, expected = args["thumbed"], envelope["expected"]
        renew = "message_revision" in expected
        if renew and not thumbed:
            raise Refusal("INVALID_ARGUMENT", "A message revision is for giving a thumbs-up to edited words")
        message = self._reacted_message(db, actor, target, with_revision=renew)
        if message["author_id"] == actor:
            raise Refusal("INVALID_ARGUMENT", "A thumbs-up is for someone else's message")
        row = self._reaction_row(db, actor, message["id"], "thumb")
        current = row["revision"] if row else 0
        # Fenced on the revision its sender saw, so a late request never undoes a newer act.
        if expected["thumb_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This thumbs-up changed since it was read; nothing was changed", {"thumb_revision": current})
        if renew:
            _revision(expected, "message_revision", message["message_revision"])
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"]}
        if thumbed == (current % 2 == 1):
            if renew and message["edited_ms"] is not None and row["at_ms"] < message["edited_ms"]:
                # Renew the same thumb and keep its answer and odd revision.
                current += 2
                now = max(_now_ms(), message["edited_ms"])
                version, settled, cleared = self._react(db, actor, message, "thumb", row["value"], current, now, True)
                return self._read_by(dict(result, thumbed=True, thumb_revision=current, reaction_version=version,
                                          answered=answered_yes(row) and removal_value(db, message['id']) is None,
                                          changed=True, settled=settled),
                                     [{"kind": "reaction", "id": message["id"], "version": version}], message, cleared)
            # Unchanged, it reports what the thumb on the message does: a 👍 that answered an ask holds `yes`, a taken-back one nothing.
            return dict(result, thumbed=thumbed, thumb_revision=current, answered=answered_yes(row) and removal_value(db, message['id']) is None, changed=False, settled=False), []
        value, waits = self._thumb_answer(db, actor, message, thumbed, answered_yes(row))
        # A thumb given reads the message; one taken back reads and clears nothing.
        now = max(_now_ms(), message["edited_ms"] or 0) if renew else _now_ms()
        version, settled, cleared = self._react(db, actor, message, "thumb", value, current + 1, now, thumbed)
        if value == 'yes':
            self._record_answer_receipt(db, actor, message, 'thumb', current + 1, value)
        # A thumb reads/answers the message, leaving the person's fold choice
        # alone (1244). Replies still use Stacks._fold_answered.
        # The owner's 👍 on a cover's payload makes it Done, and taking it back takes Done back (Covers._cover_settle).
        covered = self._cover_settle(db, actor, message["id"])
        return self._read_by(dict(result, thumbed=thumbed, thumb_revision=current + 1, reaction_version=version, answered=value == "yes",
                                  changed=True, settled=settled), waits + [
            {"kind": "reaction", "id": message["id"], "version": version}] + covered, message, cleared)

    # A thumb that answers an ask (item 239) -----------------------------------

    def _thumb_answer(self, db, actor, message, thumbed, answered_before):
        """What a thumb does to the waits: (its row's value, affected). The one rule, for topics and conversations alike.

        A person's 👍 on an ask that waits on them answers it yes, as their reply
        would: the wait clears where it is kept (conversation_waits in an outcome's
        conversation, topic_waiting in a topic) and the row's value is `yes`. Taking
        that 👍 back puts back the wait it cleared, unless they have answered the ask
        since (a reply to it in a conversation, any writing in a topic) or the wait
        could no longer stand. Nothing else a thumb is on changes a wait: a 👍 by
        anyone else or by an agent (its "got it"), on a message that asks nothing, on
        an ask to someone else, on a go-ahead (answered by ✅ or 🚫) or on an ask a
        record answers (outcome_asks.record_ask)."""
        if not thumbed and not answered_before:
            return None, []
        topic = self._thumb_ask_topic(db, actor, message)
        if topic is None:
            return ("up" if thumbed else None), []
        link = db.execute("SELECT active FROM ask_cover_links WHERE ask_id=? AND actor_id=?", (message["id"], actor)).fetchone()
        covered = []
        if link is not None and not self._answered_since(db, topic, actor, message):
            covered = self._set_linked_wait(db, actor, message["id"], not thumbed)
        if is_conversation(topic):
            if thumbed:
                answered = changed = db.execute("DELETE FROM conversation_waits WHERE ask_id=? AND actor_id=?", (message["id"], actor)).rowcount > 0
            else:
                # The 👍 took the wait away, so unless a reply answered the ask since, it comes back.
                answered = False
                changed = not self._answered_since(db, topic, actor, message)
                if changed:
                    db.execute("INSERT OR IGNORE INTO conversation_waits(ask_id,actor_id) VALUES (?,?)", (message["id"], actor))
            if changed:
                self._sync_waits(db, topic, [actor])
        else:
            # Unless their writing has answered the ask since, the 👍 answers it, and taking the 👍 back unanswers it.
            answered = not self._answered_since(db, topic, actor, message)
            changed = answered and (self._topic_ask_answered if thumbed else self._topic_ask_unthumbed)(db, topic, actor, message)
        self._sync_linked_attention(db, topic, actor)
        affected = covered
        if changed or covered:
            version = self._touch_topic(db, topic)
            self._change(db, "actor", actor, "waiting", topic["id"], version)
            affected.append({"kind": "topic", "id": topic["id"], "version": version})
        return ("yes" if answered else "up") if thumbed else None, affected

    def _answered_since(self, db, topic, actor, message):
        """Whether actor, a person, has answered message, an ask in topic, by writing since it was sent: a reply to it,
        on the record or by whisper to whoever asked, the one who can read it (StandingConversation._conversation_record,
        TopicState._answered); and in a topic any writing there on the record, which answers every ask there to its
        writer for legacy asks only. Linked asks always require the exact reply. A whisper replying to anything else, or to anyone else, answers nothing."""
        if db.execute("SELECT 1 FROM messages m INDEXED BY message_reply_links WHERE reply_to=? AND author_id=? "
                      "AND (private_to IS NULL OR private_to=?) AND NOT EXISTS (SELECT 1 FROM message_removals r WHERE r.message_id=m.id) LIMIT 1", (message["id"], actor, message["author_id"])).fetchone():
            return True
        linked = db.execute("SELECT 1 FROM ask_cover_links WHERE ask_id=? AND actor_id=?", (message["id"], actor)).fetchone()
        return not linked and not is_conversation(topic) and db.execute(
            "SELECT 1 FROM messages m INDEXED BY public_actor_writing WHERE topic_id=? AND seq>? AND author_id=? AND private_to IS NULL "
            "AND NOT EXISTS (SELECT 1 FROM message_removals r WHERE r.message_id=m.id) LIMIT 1",
            (topic["id"], message["seq"], actor)).fetchone() is not None

    def _thumb_ask_topic(self, db, actor, message):
        """The topic whose wait a thumb by actor on message would answer, or None: the message is a plain
        ask (no go-ahead, no record's) to actor, a person, in a topic they read that still keeps its waits
        (not replaced by a conversation, its outcome not reached, archived or completed). A whisper never asks (whispers.py's
        whisper_shape), and message.thumb refuses a thumb on one's own message, so neither is asked here."""
        if (message["intent"] != "ask" or self._question_closed(db, message["id"]) is not None or self._withdrawal_value(db, message["id"]) is not None or removal_value(db, message["id"]) is not None or message["go_ahead"] or actor not in json.loads(message["addressees"])
                or self._actor(db, actor)["kind"] != "human"):
            return None
        topic = db.execute("SELECT t.*,w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=:topic AND t.replaced_by IS NULL "
                           "AND " + READABLE, {"topic": message["topic_id"], "actor": actor}).fetchone()
        # An outcome kept to read (reached, archived or completed, item 404) keeps its waits as they are.
        if topic is None or self._closed(db, topic["workspace_id"]) is not None or record_ask(db, message["id"], topic["workspace_id"], topic["id"]):
            return None
        return topic

    def _topic_ask_answered(self, db, topic, member, message):
        """Member answered message, an open ask to them in topic, alone: by their 👍 on it, or their whisper replying
        to it (TopicState._answered). When the topic's wait on them is from it, the wait moves to their next open ask
        there, else ends (a wait someone said stays). Whether the wait changed."""
        row = db.execute("SELECT said,ask_message_id FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic["id"], member)).fetchone()
        if row is None or row["ask_message_id"] != message["id"]:
            return False
        following = self._next_open_ask(db, topic, member, message["seq"])
        if following is not None:
            self._wait_from(db, topic, member, following)
        elif row["said"]:
            db.execute("UPDATE topic_waiting SET ask_message_id=NULL WHERE topic_id=? AND actor_id=?", (topic["id"], member))
        else:
            db.execute("DELETE FROM topic_waiting WHERE topic_id=? AND actor_id=?", (topic["id"], member))
        return True

    def _topic_ask_unthumbed(self, db, topic, member, message):
        """The 👍 that answered message is taken back and nothing answered it since: the topic waits on member from it
        again when it is older than the ask the wait is from now, or the wait has none. Whether the wait changed."""
        row = db.execute("SELECT m.seq FROM topic_waiting q LEFT JOIN messages m ON m.id=q.ask_message_id "
                         "WHERE q.topic_id=? AND q.actor_id=?", (topic["id"], member)).fetchone()
        if row is None or row["seq"] is None:
            # No ask holds the wait (someone may have said it): it waits from this ask as when it was asked.
            self._ask(db, topic, message["author_id"], message["id"], message["sent_ms"], [member])
        elif row["seq"] > message["seq"]:
            self._wait_from(db, topic, member, message)
        else:
            return False
        return True

    def _wait_from(self, db, topic, member, ask):
        """The topic's wait on member, which an ask holds, is from ask ({id, sent_ms}) now: ordered on the rail by
        it, unless someone said the topic waits on them, which keeps the time they said it (TopicState)."""
        db.execute("UPDATE topic_waiting SET ask_message_id=?,state_ms=CASE WHEN said=1 THEN state_ms ELSE ? END WHERE topic_id=? AND actor_id=?",
                   (ask["id"], ask["sent_ms"], topic["id"], member))

    def _next_open_ask(self, db, topic, member, after_seq):
        """The oldest ask to member in topic after after_seq that nothing has answered, or that a record holds open
        (outcome_asks.held_ask): {id, seq, sent_ms}, or None. Member has not written on the record there since
        after_seq, or the topic would not be waiting on them from that ask, so none of these asks is theirs; a whisper
        never asks. Member's whisper replying to an ask, to whoever asked, answered it (TopicState._answered).

        Each ask is judged by the rule that decides it, never restated here: whether member's own 👍 answered it is
        their thumb row, read by the key message.thumb fences on (_reaction_row) and read as every reader reads it
        (answered_yes); whether a record answers it is outcome_asks.record_ask."""
        found = None
        for row in db.execute("SELECT m.id,m.seq,m.sent_ms,m.author_id FROM message_addressees a CROSS JOIN messages m ON m.seq=a.seq "
                              "WHERE a.topic_id=? AND a.actor_id=? AND a.seq>? AND m.intent='ask' AND NOT EXISTS (SELECT 1 FROM question_closures c WHERE c.message_id=m.id) AND NOT EXISTS (SELECT 1 FROM message_removals r WHERE r.message_id=m.id) AND NOT EXISTS (SELECT 1 FROM message_withdrawals x WHERE x.message_id=m.id) AND NOT EXISTS (SELECT 1 FROM messages w "
                              "INDEXED BY message_reply_links WHERE w.reply_to=m.id AND w.author_id=a.actor_id "
                              "AND w.private_to=m.author_id AND NOT EXISTS (SELECT 1 FROM message_removals r WHERE r.message_id=w.id)) ORDER BY a.seq",
                              (topic["id"], member, after_seq)):
            linked = db.execute("SELECT active FROM ask_cover_links WHERE ask_id=? AND actor_id=?", (row["id"], member)).fetchone()
            if linked is not None and not linked["active"]:
                continue
            if self._answered_since(db, topic, member, row):
                continue
            if not (answered_yes(self._reaction_row(db, member, row["id"], "thumb"))
                    or record_ask(db, row["id"], topic["workspace_id"], topic["id"])):
                found = row
                break
        held = held_ask(db, topic["id"], member)
        if held is not None:
            held = db.execute("SELECT id,seq,sent_ms FROM messages WHERE id=?", (held,)).fetchone()
            if found is None or held["seq"] < found["seq"]:
                found = held
        return found

    def _command_message_answer(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(args) != {"answer"} or args["answer"] not in ANSWERS:
            raise Refusal("INVALID_ARGUMENT", "Name one message and answer yes (go ahead) or no (don't)")
        message = self._reacted_message(db, actor, target)
        if not message["go_ahead"]:
            raise Refusal("NOT_A_GO_AHEAD", "This message does not ask for a go-ahead; reply to it instead")
        if actor not in json.loads(message["addressees"]) or self._actor(db, actor)["kind"] != "human":
            raise Refusal("NOT_ASKED", "Only a person this message asks can answer it")
        if self._withdrawal_value(db, message["id"]) is not None or removal_value(db, message["id"]) is not None:
            raise Refusal("QUESTION_WITHDRAWN", "This question was withdrawn; reply in words instead", recorded=False)
        if self._question_closed(db, message["id"]) is not None:
            raise Refusal("QUESTION_CLOSED", "This question is closed; reply in words instead", recorded=False)
        row = self._reaction_row(db, actor, message["id"], "answer")
        current = row["revision"] if row else 0
        if envelope["expected"]["answer_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This answer changed since it was read; nothing was changed", {"answer_revision": current})
        answer = args["answer"]
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"], "answer": answer}
        if row is not None and row["value"] == answer:
            return dict(result, answer_revision=current, changed=False), []
        version, _settled, cleared = self._react(db, actor, message, "answer", answer, current + 1, _now_ms(), True)
        # The asker is told as a reply is: a short message from the person to
        # the agent, answering the ask, which also clears the topic's wait.
        body = ANSWERS[answer] + (" (I changed my answer)" if row is not None and row["value"] is not None else "")
        said, affected = self._publish(db, actor, envelope["operation_id"], message["topic_id"], {
            "body": body, "attachments": [], "quotes": [], "addressees": [message["author_id"]],
            "reply_to": message["id"], "intent": "tell"})
        self._record_answer_receipt(db, actor, message, 'answer', current + 1, answer, said['message_id'])
        return self._read_by(dict(result, answer_revision=current + 1, reaction_version=version, reply_id=said["message_id"], changed=True), affected + [
            {"kind": "reaction", "id": message["id"], "version": version}], message, cleared)

    def _reactions_of(self, db, actor, ids):
        """{message_id: reactions} for the messages in ids that have any; the caller has checked each is visible."""
        found = {}
        if not ids:
            return found
        marks = ",".join("?" * len(ids))
        for row in db.execute("SELECT message_id,actor_id,kind,value,at_ms,revision FROM message_reactions INDEXED BY message_reaction_rows "
                              "WHERE message_id IN (%s) ORDER BY message_id,at_ms,actor_id" % marks, list(ids)):
            entry = found.setdefault(row["message_id"], {"version": 0, "thumbs": [], "answers": [], "thumb_revision": 0, "answer_revision": 0})
            entry["version"] += row["revision"]
            if row["actor_id"] == actor:
                entry[row["kind"] + "_revision"] = row["revision"]
            if row["kind"] == "thumb" and row["revision"] % 2 == 1:
                thumb = {"actor_id": row["actor_id"], "at_ms": row["at_ms"]}
                # A thumb that answered an ask yes says so (item 239).
                entry["thumbs"].append(dict(thumb, answered=True) if answered_yes(row) and removal_value(db, row['message_id']) is None else thumb)
            elif row["kind"] == "answer" and row['value'] is not None and removal_value(db, row['message_id']) is None:
                entry["answers"].append({"actor_id": row["actor_id"], "answer": row["value"], "at_ms": row["at_ms"]})
        return found

    def _reaction_fields(self, db, actor, items):
        """Add `reactions` (when there are any) and `go_ahead` (when asked) to each message item of one page."""
        ids = [item["id"] for item in items]
        found = self._reactions_of(db, actor, ids)
        asks = set()
        if ids:
            asks = {row[0] for row in db.execute("SELECT id FROM messages WHERE id IN (%s) AND go_ahead=1" % ",".join("?" * len(ids)), ids)}
        for item in items:
            if item["id"] in found:
                item["reactions"] = found[item["id"]]
            if item["id"] in asks:
                item["go_ahead"] = True

    def _source_reactions(self, db, actor, row):
        """The reactions a message's source view carries (the Reader's thumbs-up reads its revision there)."""
        return {"go_ahead": bool(row["go_ahead"]), "reactions": self._reactions_of(db, actor, [row["id"]]).get(row["id"], dict(EMPTY))}

    def _view_reactions(self, db, actor, args):
        """One message's reactions, for a page that learned they changed (a `reaction` change)."""
        message_id = _identifier(args.get("message_id"), "message_id")
        self._message_access(db, actor, message_id)
        row = db.execute("SELECT id,topic_id,author_id,private_to,go_ahead FROM messages WHERE id=?", (message_id,)).fetchone()
        if row is None or not visible(row, actor):
            raise Refusal("FORBIDDEN", "No readable source")
        return {"instance_id": self.instance_id, "message_id": row["id"], "topic_id": row["topic_id"], "go_ahead": bool(row["go_ahead"]),
                "reactions": self._reactions_of(db, actor, [row["id"]]).get(row["id"], dict(EMPTY))}

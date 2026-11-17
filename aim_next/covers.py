from __future__ import annotations

"""A dossier's cover (item 624, docs/dossier-covers.md): the folder's face, written by the agent working the dossier and
read by everyone who reads its first message.

`stack.cover` sets or clears the cover's fields on a dossier's first message, as a `cover` act (message_acts, the
topic's), fenced on `cover_revision`, so a write sent on a revision someone has moved past is refused, never lost.
Its payload names the message in the dossier that delivered it. Done is never written: it is read from the outcome
owner's record (cover_values.done_of) when a cover is written, from their 👍 on the payload's message or their own
reply to it that the writer names as done_by, and settled again, as a new row of the owner's own, whenever the owner
gives or takes back that 👍 (_cover_settle). A reply nobody names settles nothing. The cover is
shown to whoever reads its first message and to nobody else, so a whispered dossier's cover stays between its two
people, as its messages do.

`dossier_cover` reads the cover of the dossier a message is in, with its first message and the revision a write is
fenced on.
"""

from .contract import Refusal
from .cover_values import DONE_REFUSED, done_of, owners_word, shown, stored_value, written
from .stacks import EMPTY, MEMBERS, StackRoots, current_acts
from .whispers import STAYS, VISIBLE


class Covers:
    def _cover_owner(self, db, topic_id):
        """The owner of the topic's outcome: the one whose 👍 or word gives a payload Done."""
        return db.execute("SELECT w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?", (topic_id,)).fetchone()[0]

    def _cover_payload(self, db, actor, root, message_id):
        """The message a payload names, as its writer reads it: one of the dossier root heads, which everyone who reads
        the cover can read. Refused as one that is not there otherwise, so no refusal names a whisper."""
        message = db.execute("SELECT m.id,m.seq,m.topic_id,m.author_id,m.private_to FROM messages m WHERE m.id=:id AND " + VISIBLE,
                             {"id": message_id, "actor": actor}).fetchone()
        member = message is not None and message["topic_id"] == root["topic_id"] and db.execute(
            MEMBERS + " SELECT 1 FROM members WHERE id=:payload", {"root": root["id"], "actor": actor, "payload": message_id}).fetchone()
        if not member:
            raise Refusal("INVALID_ARGUMENT", "A payload names a message of this dossier; nothing was changed")
        # A cover is read by everyone who reads the dossier's first message: a whisper is a payload only on a whispered
        # dossier between the same two people.
        if message["private_to"] is not None and (root["private_to"] is None or
                                                  {message["author_id"], message["private_to"]} != {root["author_id"], root["private_to"]}):
            raise Refusal(STAYS, "A whisper stays between the two people in it: it is never a cover's payload on the record; nothing was changed")
        return message

    def _cover_done_by(self, db, actor, owner, payload):
        """A payload's done_by, checked: the owner's own reply to the payload's message, as its writer reads it.
        Anything else claims Done without the owner's record, and is refused as such; a whisper the writer is outside
        is refused the same way, so no refusal names it."""
        if payload["done_by"] is None:
            return
        word = owners_word(db, owner, payload["message_id"], payload["done_by"])
        seen = word is not None and db.execute("SELECT 1 FROM messages m WHERE m.id=:id AND " + VISIBLE,
                                               {"id": word["id"], "actor": actor}).fetchone()
        if not seen:
            raise Refusal("DONE_BY_OWNER", DONE_REFUSED)

    def _command_stack_cover(self, db, actor, envelope):
        message, topic = self._acted_message(db, actor, envelope["target"])
        fields = written(envelope["args"])
        # A cover is the dossier's, on its first message as the writer's Core finds it.
        if StackRoots(db, actor).root(message["id"]) != message["id"]:
            raise Refusal("STACK_CHANGED", "This is not the first message of its dossier now; read it again")
        closed = self._closed(db, topic["workspace_id"])
        if closed is not None:
            raise self._closed_refusal(db, actor, topic["workspace_id"], closed)
        current = self._act_revision(db, message["id"], "cover", "")
        if envelope["expected"]["cover_revision"] != current:
            raise Refusal("REVISION_CONFLICT", "This cover changed since it was read; nothing was changed", {"cover_revision": current})
        before = stored_value(self._act_value(db, message["id"], "cover", ""))
        value = dict(before, **fields)
        owner = self._cover_owner(db, message["topic_id"])
        if value["payload"] is not None:
            payload = value["payload"]
            if "payload" in fields:
                payload = dict(payload, seq=self._cover_payload(db, actor, message, payload["message_id"])["seq"])
                self._cover_done_by(db, actor, owner, payload)
            # Done is the owner's record, read now, whoever writes: never what the writer says.
            value["payload"] = dict(payload, done=done_of(db, owner, payload["message_id"], payload.get("done_by")))
        result = {"message_id": message["id"], "topic_id": message["topic_id"], "seq": message["seq"]}
        if value == before:
            acts = current_acts(db, actor, [message["id"]]).get(message["id"], EMPTY)
            return dict(result, cover=acts["cover"], cover_revision=current, changed=False), []
        version = self._record_act(db, "cover", message, "", actor, value, current + 1)
        cover = current_acts(db, actor, [message["id"]])[message["id"]]["cover"]
        return dict(result, cover=cover, cover_revision=current + 1, changed=True, acts_version=version), [
            {"kind": "acts", "id": message["topic_id"], "version": version}]

    def _cover_settle(self, db, actor, message_id):
        """The owner gave or took back a 👍 on message_id: each cover whose payload it delivered takes Done as the
        owner's record now gives it, as a new row of the owner's own, in the same transaction, and everyone who reads it
        is told. Anyone else's 👍 settles nothing. Returns what it affected."""
        rows = db.execute(
            "SELECT a.message_id,a.topic_id,a.seq,a.value,a.revision FROM message_acts a INDEXED BY cover_payloads "
            "WHERE json_extract(a.value,'$.payload.message_id')=? AND a.kind='cover' AND a.owner='' "
            "AND a.revision=(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=a.message_id AND b.kind='cover' AND b.owner='')",
            (message_id,)).fetchall()
        affected = []
        for row in rows:
            if self._cover_owner(db, row["topic_id"]) != actor:
                continue
            value = stored_value(row["value"])
            done = done_of(db, actor, message_id, value["payload"].get("done_by"))
            if value["payload"].get("done") == done:
                continue
            value["payload"] = dict(value["payload"], done=done)
            # The cover is on its dossier's first message, which the owner reads to have acted on its payload.
            root = db.execute("SELECT m.id,m.topic_id,m.seq,m.author_id,m.private_to FROM messages m WHERE m.id=:id AND " + VISIBLE,
                              {"id": row["message_id"], "actor": actor}).fetchone()
            if root is None:
                continue
            version = self._record_act(db, "cover", root, "", actor, value, row["revision"] + 1)
            affected.append({"kind": "acts", "id": row["topic_id"], "version": version})
        return affected

    def _view_dossier_cover(self, db, actor, args):
        """The cover of the dossier a message is in, for the agent about to write it: the dossier's first message, its
        cover as the reader reads it (None when none is written), the revision a write is fenced on, and the outcome's
        owner, whose 👍 or word gives Done."""
        message, _ = self._acted_message(db, actor, {"message_id": args.get("message_id")})
        root = StackRoots(db, actor).root(message["id"])
        acts = current_acts(db, actor, [root]).get(root, EMPTY)
        return {"instance_id": self.instance_id, "message_id": message["id"], "topic_id": message["topic_id"], "root_id": root,
                "cover": acts["cover"], "cover_revision": acts["cover_revision"], "owner": self._cover_owner(db, message["topic_id"])}

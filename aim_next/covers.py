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

import json
import re

from .contract import Refusal
from .cover_values import COVER_SECTIONS, DONE_REFUSED, STANDS_CHARS, _line, done_of, owners_word, shown, stored_value, written
from .stacks import EMPTY, MEMBERS, NOT_THE_NAMER, StackRoots, _value, current_acts, dossier_namer, first_public_agent_reply
from .whispers import STAYS, VISIBLE


COVER_WAIT_SCHEMA = [
    "CREATE TABLE cover_waiting (message_id TEXT PRIMARY KEY REFERENCES messages(id), topic_id TEXT NOT NULL REFERENCES topics(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id))",
    "CREATE INDEX outcome_cover_waiting ON cover_waiting(workspace_id,topic_id,message_id)",
    "CREATE INDEX topic_cover_waiting ON cover_waiting(topic_id,message_id)",
]
COVER_WAIT_BACKFILL = [
    "INSERT INTO cover_waiting SELECT a.message_id,a.topic_id,t.workspace_id FROM message_acts a JOIN topics t ON t.id=a.topic_id "
    "WHERE a.kind='cover' AND a.owner='' AND json_array_length(a.value,'$.waiting')>0 "
    "AND a.revision=(SELECT max(b.revision) FROM message_acts b WHERE b.message_id=a.message_id AND b.kind='cover' AND b.owner='')"
]
COVER_WAIT_DOWN = ["DROP TABLE cover_waiting"]


class Covers:
    def _validate_cover_quote(self, db, actor, topic_id, reply_to, quote, private_to):
        from .whispers import quote_allowed

        ref = quote["source"]
        revision, part = ref.get("revision"), ref.get("part")
        if (set(ref) != {"kind", "id", "revision", "part"} or not reply_to or ref["id"] != reply_to
                or type(revision) is not int or not 1 <= revision <= 2**63 - 1
                or not isinstance(part, str)):
            raise Refusal("INVALID_QUOTE", "Name this reply's dossier cover, revision and field")
        message, _ = self._acted_message(db, actor, {"message_id": reply_to})
        if message["topic_id"] != topic_id or StackRoots(db, actor).root(reply_to) != reply_to:
            raise Refusal("INVALID_QUOTE", "The cover must belong to this reply's dossier")
        row = db.execute("SELECT value FROM message_acts "
                         "WHERE message_id=? AND kind='cover' AND owner='' AND revision=?",
                         (reply_to, revision)).fetchone()
        if row is None:
            raise Refusal("INVALID_QUOTE", "No such cover revision")
        value = stored_value(row["value"])
        if part == "stands":
            body = value["stands"]
        elif part == "payload":
            body = (value["payload"] or {}).get("text")
        elif part == "done_when":
            body = (value.get("birth") or {}).get("done_when")
        elif part.startswith("section.") and part[8:] in COVER_SECTIONS:
            body = value.get("sections", {}).get(part[8:])
        else:
            wait = re.fullmatch(r"(wait|default)\.(0|[1-9][0-9]{0,5})", part)
            if not wait:
                raise Refusal("INVALID_QUOTE", "Name an authored cover field")
            index = int(wait[2])
            waiting = value["waiting"]
            body = waiting[index].get("text" if wait[1] == "wait" else "default") if index < len(waiting) else None
        start, end = quote.get("start"), quote.get("end")
        section = quote.get("section")
        if (not isinstance(section, str) or not 1 <= len(section) <= 160 or section != " ".join(section.split())):
            raise Refusal("INVALID_QUOTE", "Name the quoted cover section in one short line")
        if (not isinstance(body, str) or type(start) is not int or type(end) is not int
                or not 0 <= start < end <= len(body) or body[start:end] != quote.get("excerpt")
                or not body[start:end].strip()):
            raise Refusal("INVALID_QUOTE", "The excerpt must match the selected words of the cover revision")
        quote_allowed(db, actor, {"author": message["author_id"], "private_to": message["private_to"],
                                 "whisper": message["private_to"] is not None}, private_to)

    def _index_cover_wait(self, db, message, value):
        """One current candidate per cover, changed with its immutable act, never from a read."""
        db.execute("DELETE FROM cover_waiting WHERE message_id=?", (message["id"],))
        if value.get("waiting"):
            db.execute("INSERT INTO cover_waiting SELECT ?,id,workspace_id FROM topics WHERE id=?",
                       (message["id"], message["topic_id"]))

    def _cover_wait_counts(self, db, actor, workspace_id=None, topics=None):
        """Only current candidates of one listed outcome or a bounded topic page, never act history.
        The owner is read now so handing an outcome on cannot leave another reader's count behind."""
        if topics is not None and not topics:
            return {}
        scope = "c.workspace_id=:workspace" if topics is None else "c.topic_id IN (SELECT value FROM json_each(:topics))"
        params = {"actor": actor, "workspace": workspace_id, "topics": json.dumps(topics)}
        rows = db.execute("SELECT c.message_id,c.topic_id FROM cover_waiting c "
                          + ("INDEXED BY outcome_cover_waiting " if topics is None else "INDEXED BY topic_cover_waiting ")
                          + "CROSS JOIN topics t ON t.id=c.topic_id JOIN workspaces w ON w.id=t.workspace_id "
                          "JOIN messages m ON m.id=c.message_id WHERE " + scope + " AND t.archived=0 AND EXISTS ("
                          "SELECT 1 FROM json_each((SELECT a.value FROM message_acts a WHERE a.message_id=c.message_id "
                          "AND a.kind='cover' AND a.owner='' ORDER BY a.revision DESC LIMIT 1), '$.waiting') wait "
                          "WHERE coalesce(json_extract(wait.value,'$.actor_id'),w.owner_id)=:actor) AND " + VISIBLE,
                          params)
        counts, roots = {}, StackRoots(db, actor)
        for row in rows:
            if roots.root(row["message_id"]) == row["message_id"]:
                counts[row["topic_id"]] = counts.get(row["topic_id"], 0) + 1
        return counts

    def _cover_owner(self, db, topic_id):
        """The owner of the topic's outcome: the one whose 👍 or word gives a payload Done."""
        return db.execute("SELECT w.owner_id FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=?", (topic_id,)).fetchone()[0]

    def _cover_payload(self, db, actor, root, message_id, what="payload"):
        """The message a payload names, as its writer reads it: one of the dossier root heads, which everyone who reads
        the cover can read. Refused as one that is not there otherwise, so no refusal names a whisper."""
        message = db.execute("SELECT m.id,m.seq,m.topic_id,m.author_id,m.private_to FROM messages m WHERE m.id=:id AND " + VISIBLE,
                             {"id": message_id, "actor": actor}).fetchone()
        member = message is not None and message["topic_id"] == root["topic_id"] and db.execute(
            MEMBERS + " SELECT 1 FROM members WHERE id=:payload", {"root": root["id"], "actor": actor, "payload": message_id}).fetchone()
        if not member:
            raise Refusal("INVALID_ARGUMENT", "A %s names a message of this dossier; nothing was changed" % what)
        # A cover is read by everyone who reads the dossier's first message: a whisper is a payload only on a whispered
        # dossier between the same two people.
        if message["private_to"] is not None and (root["private_to"] is None or
                                                  {message["author_id"], message["private_to"]} != {root["author_id"], root["private_to"]}):
            raise Refusal(STAYS, "A whisper stays between the two people in it: it is never a cover's %s on the record; nothing was changed" % what)
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

    def _command_stack_birth(self, db, actor, envelope):
        root, topic = self._acted_message(db, actor, envelope["target"])
        args, expected = envelope["args"], envelope["expected"]
        if "reply_id" not in args or set(args) - {"reply_id", "name", "nature", "done_when", "stands"}:
            raise Refusal("INVALID_ARGUMENT", "Name the first reply and optional name, nature, completion criterion and rough cover")
        if "cover_revision" not in expected:
            raise Refusal("INVALID_ARGUMENT", "An explicit cover_revision is required")
        reply, _ = self._acted_message(db, actor, {"message_id": args["reply_id"]})
        if root["private_to"] is not None or reply["private_to"] is not None:
            raise Refusal(STAYS, "Birth facts require a dossier and reply on the record")
        roots = StackRoots(db, actor)
        if roots.root(root["id"]) != root["id"] or roots.root(reply["id"]) != root["id"]:
            raise Refusal("STACK_CHANGED", "This reply's dossier changed; read its root again")
        closed = self._closed(db, topic["workspace_id"])
        if closed is not None:
            raise self._closed_refusal(db, actor, topic["workspace_id"], closed)
        revisions = {kind + "_revision": self._act_revision(db, root["id"], kind, "") for kind in ("name", "cover")}
        if any(expected[key] != revision for key, revision in revisions.items()):
            raise Refusal("REVISION_CONFLICT", "The name or cover changed; read both again", revisions)

        before = stored_value(self._act_value(db, root["id"], "cover", ""))
        if before.get("birth"):
            raise Refusal("BIRTH_RECORDED", "The dossier already has its birth facts")
        if reply["author_id"] != actor or first_public_agent_reply(db, root["id"]) != reply["id"]:
            raise Refusal("NOT_FIRST_RESPONDER", "The first agent to reply on the record writes the birth facts")

        birth = {"reply_id": reply["id"]}
        for field, label, limit in (("nature", "The dossier's nature", 200), ("done_when", "What counts as completion", 500)):
            if field in args:
                birth[field] = _line(args[field], label, limit)
        stands = written({"stands": args["stands"]})["stands"] if "stands" in args else None
        if len(birth) == 1 and stands is None:
            raise Refusal("INVALID_ARGUMENT", "Supply a nature, completion criterion or rough cover")
        value = dict(before, birth=birth, stands=before["stands"] or stands)

        if "name" in args and revisions["name_revision"] == 0:
            namer, why = dossier_namer(db, root["id"])
            if namer != actor:
                code, words = NOT_THE_NAMER[why]
                raise Refusal(code, words % namer if "%s" in words else words)
            name = _value("name", {"name": args["name"], "minted": True})
            self._record_act(db, "name", root, "", actor, name, 1, tell=False)
            revisions["name_revision"] = 1
        revisions["cover_revision"] += 1
        version = self._record_act(db, "cover", root, "", actor, value, revisions["cover_revision"])
        version = self._cover_refreshed(db, actor, root, before, value, revisions["cover_revision"], version)
        cover = current_acts(db, actor, [root["id"]])[root["id"]]["cover"]
        return dict(revisions, message_id=root["id"], topic_id=root["topic_id"], cover=cover, acts_version=version), [
            {"kind": "acts", "id": root["topic_id"], "version": version}]

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
        if "waiting" in fields:
            fields["waiting"] += [w for w in before["waiting"] if w.get("ask_id")]
        section_patch = fields.pop("sections", None)
        value = dict(before, **fields)
        if section_patch is not None:
            combined = dict(before.get("sections", {}), **section_patch)
            sections = {key: combined[key] for key in COVER_SECTIONS if combined.get(key)}
            if sum(map(len, sections.values())) > STANDS_CHARS:
                raise Refusal("INVALID_ARGUMENT", "Cover sections are at most %d characters together" % STANDS_CHARS)
            if sections:
                value["sections"] = sections
            else:
                value.pop("sections", None)
        if "waiting" in fields:
            for wait in fields["waiting"]:
                if wait.get("message_id") is not None:
                    self._cover_payload(db, actor, message, wait["message_id"], what="wait source")
        owner = self._cover_owner(db, message["topic_id"])
        # A section patch leaves the stored acceptance in place unless it also sets the payload.
        if value["payload"] is not None and (section_patch is None or "payload" in fields):
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
        version = self._cover_refreshed(db, actor, message, before, value, current + 1, version)
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
                "cover": acts["cover"], "cover_revision": acts["cover_revision"], "owner": self._cover_owner(db, message["topic_id"]),
                "refresh": acts.get("cover_refresh"), "refresh_revision": acts.get("cover_refresh_revision", 0)}

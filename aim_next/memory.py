from __future__ import annotations

import json

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _revision
from .conversation import _preview
from .whispers import actor_kind, private_source_refused


MEMORY_SCHEMA = [
    "CREATE TABLE memory_items (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, creator_id TEXT NOT NULL REFERENCES actors(id), current_revision INTEGER NOT NULL)",
    "CREATE INDEX scoped_memory_items ON memory_items(scope_kind,scope_id,seq)",
    "CREATE TABLE memory_revisions (item_id TEXT NOT NULL REFERENCES memory_items(id), revision INTEGER NOT NULL, author_id TEXT NOT NULL REFERENCES actors(id), operation_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, attachments TEXT NOT NULL, refs TEXT NOT NULL, PRIMARY KEY(item_id,revision), UNIQUE(author_id,operation_id))",
    "CREATE TABLE memory_notebooks (scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(scope_kind,scope_id))",
    "CREATE TRIGGER immutable_memory_revision_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT, 'immutable Notebook revision'); END",
    "CREATE TRIGGER immutable_memory_revision_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT, 'immutable Notebook revision'); END",
    "CREATE TRIGGER immutable_memory_identity BEFORE UPDATE ON memory_items WHEN NEW.seq!=OLD.seq OR NEW.id!=OLD.id OR NEW.scope_kind!=OLD.scope_kind OR NEW.scope_id!=OLD.scope_id OR NEW.creator_id!=OLD.creator_id BEGIN SELECT RAISE(ABORT, 'immutable Notebook identity'); END",
    "CREATE TRIGGER immutable_memory_item_delete BEFORE DELETE ON memory_items BEGIN SELECT RAISE(ABORT, 'immutable Notebook identity'); END",
]
# The revision of each Notebook page each person last read. It only grows, and
# no row means the person has not read the page. A page read earlier and
# revised since is one that changed since they read it.
MEMORY_READ_SCHEMA = [
    "CREATE TABLE memory_reads (actor_id TEXT NOT NULL REFERENCES actors(id), item_id TEXT NOT NULL REFERENCES memory_items(id), "
    "revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(actor_id,item_id))",
]
MEMORY_READ_DOWN = ("DROP TABLE memory_reads",)
MEMORY_READ_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM memory_reads)"
# Version 39: whether a revision's writer marked the page a draft
# (docs/notebook-pages.md, "A draft page"). While a page's latest revision is
# marked, no agent is given its words. Earlier code would give them, so once
# any revision has been marked the step back is refused.
MEMORY_DRAFT_SCHEMA = ["ALTER TABLE memory_revisions ADD COLUMN draft INTEGER NOT NULL DEFAULT 0"]
MEMORY_DRAFT_DOWN = ("ALTER TABLE memory_revisions DROP COLUMN draft",)
MEMORY_DRAFT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM memory_revisions WHERE draft<>0)"

DRAFT_KEPT = ("This page is a draft: its writer keeps it from agents until the draft mark is cleared, so an agent "
              "neither reads, writes nor marks it; nothing was written")

# Who may write pages in a Notebook, the one rule Core enforces and every page reads (reader_may_write): in a
# topic's, its active participants, its owner (who started it) and its outcome's owner; in an outcome's, its team,
# the owner always among them. People and agents alike; every revision is kept.
WRITERS = {
    "topic": "SELECT 1 FROM topics t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=:scope AND (t.creator_id=:actor "
             "OR w.owner_id=:actor OR EXISTS (SELECT 1 FROM topic_participants p WHERE p.topic_id=t.id AND p.actor_id=:actor AND p.active=1))",
    "workspace": "SELECT 1 FROM workspace_members WHERE workspace_id=:scope AND actor_id=:actor",
}


class Memory:
    def _memory_scope(self, db, actor, scope, write=False):
        if not isinstance(scope, dict) or set(scope) != {"kind", "id"} or scope["kind"] not in ("topic", "workspace"):
            raise Refusal("INVALID_ARGUMENT", "A topic or workspace Notebook scope is required")
        scope_id = _identifier(scope["id"], "owner_scope.id")
        if scope["kind"] == "topic":
            self._topic(db, actor, scope_id)
        else:
            self._workspace(db, actor, scope_id)
        if write and not self._notebook_writer(db, actor, scope["kind"], scope_id):
            raise Refusal("FORBIDDEN", "Only those taking part in this topic, its owner and its outcome's owner write its Notebook"
                          if scope["kind"] == "topic" else "Only this outcome's team writes its Notebook")
        return {"kind": scope["kind"], "id": scope_id}

    def _notebook_writer(self, db, actor, kind, scope_id):
        return db.execute(WRITERS[kind], {"scope": scope_id, "actor": actor}).fetchone() is not None

    def _reader_may_write(self, db, actor, kind, scope_id, draft=False):
        """What a page is told before it offers a pencil or writing: whether Core would take a revision from this
        reader here. The writers' rule, in an outcome not yet reached, and never an agent on a draft page."""
        if not self._notebook_writer(db, actor, kind, scope_id) or (draft and actor_kind(db, actor) == "agent"):
            return False
        workspace = scope_id if kind == "workspace" else db.execute("SELECT workspace_id FROM topics WHERE id=?", (scope_id,)).fetchone()[0]
        return db.execute("SELECT 1 FROM outcome_reached WHERE workspace_id=?", (workspace,)).fetchone() is None

    def _memory_identity(self, db, actor, item_id, write=False):
        row = db.execute("SELECT * FROM memory_items WHERE id=?", (_identifier(item_id, "item_id"),)).fetchone()
        if row is None:
            raise Refusal("FORBIDDEN", "No readable Notebook item")
        self._memory_scope(db, actor, {"kind": row["scope_kind"], "id": row["scope_id"]}, write=write)
        return row

    def _memory_ref(self, db, actor, ref):
        if (not isinstance(ref, dict) or set(ref) != {"kind", "id", "revision"}
                or ref.get("kind") != "memory" or type(ref.get("revision")) is not int
                or not 1 <= ref["revision"] <= 9223372036854775807):
            raise Refusal("INVALID_ARGUMENT", "An exact positive Notebook revision is required")
        identity = self._memory_identity(db, actor, ref["id"])
        if not db.execute("SELECT 1 FROM memory_revisions WHERE item_id=? AND revision=?", (ref["id"], ref["revision"])).fetchone():
            raise Refusal("FORBIDDEN", "No readable Notebook revision")
        return identity

    def _memory_content(self, db, actor, args, retained=()):
        # draft is optional: a revision that leaves it out keeps the page's mark.
        if set(args) - {"draft"} != {"title", "body", "attachments", "references"}:
            raise Refusal("INVALID_ARGUMENT", "Supply a complete Notebook revision")
        if "draft" in args and not isinstance(args["draft"], bool):
            raise Refusal("INVALID_ARGUMENT", "A page's draft mark is true or false")
        title, body = _body(args["title"]), _body(args["body"])
        attachments, refs = args["attachments"], args["references"]
        if not isinstance(attachments, list) or not isinstance(refs, list):
            raise Refusal("INVALID_ARGUMENT", "Attachments and references must be lists")
        if len(refs) > LIMITS["memory_references"]:
            raise Refusal("INVALID_ARGUMENT", "Too many Notebook evidence references")
        for ref in refs:
            if isinstance(ref, dict) and ref.get("kind") == "memory":
                self._memory_ref(db, actor, ref)
            elif isinstance(ref, dict) and set(ref) == {"kind", "id"} and ref["kind"] == "message":
                self._message_access(db, actor, ref["id"])
                # An agent's whisper is never Notebook evidence; a person's may be, cited by id only its two people can open.
                private_source_refused(db, actor, ref["id"])
            else:
                raise Refusal("INVALID_ARGUMENT", "Evidence must name an exact message or Notebook revision")
        attachments = self._attachment_refs(db, actor, attachments, ready=True, retained=retained)
        return title, body, attachments, refs, args.get("draft")

    def _command_memory_create(self, db, actor, envelope):
        return self._write_memory(db, actor, envelope, creating=True)

    def _command_memory_revise(self, db, actor, envelope):
        return self._write_memory(db, actor, envelope, creating=False)

    def _write_memory(self, db, actor, envelope, creating):
        target = envelope["target"]
        if set(target) != ({"item_id", "owner_scope"} if creating else {"item_id"}):
            raise Refusal("INVALID_ARGUMENT", "Notebook ownership is fixed at creation")
        item_id = _identifier(target["item_id"], "item_id")
        if creating:
            scope = self._memory_scope(db, actor, target["owner_scope"], write=True)
            old = db.execute("SELECT * FROM memory_items WHERE id=?", (item_id,)).fetchone()
            if old is not None:
                self._memory_identity(db, actor, item_id, write=True)
            revision = old["current_revision"] if old else 0
            _revision(envelope["expected"], "item_revision", revision)
            if old is not None:
                raise Refusal("REVISION_CONFLICT", "This Notebook identity already exists")
        else:
            old = self._memory_identity(db, actor, item_id, write=True)
            scope = {"kind": old["scope_kind"], "id": old["scope_id"]}
            revision = old["current_revision"]
            _revision(envelope["expected"], "item_revision", revision)
        current = None if creating else db.execute("SELECT attachments,draft FROM memory_revisions WHERE item_id=? AND revision=?",
                                                   (item_id, revision)).fetchone()
        retained = [] if creating else [ref["id"] for ref in json.loads(current["attachments"])]
        title, body, attachments, refs, draft = self._memory_content(db, actor, envelope["args"], retained=retained)
        was = bool(current and current["draft"])
        draft = was if draft is None else draft
        # Only a person marks a page or clears its mark, and no agent writes a page it is not given to read.
        if (was or draft) and actor_kind(db, actor) == "agent":
            raise Refusal("FORBIDDEN", DRAFT_KEPT)
        if creating:
            db.execute("INSERT INTO memory_items(id,scope_kind,scope_id,creator_id,current_revision) VALUES (?,?,?,?,1)",
                       (item_id, scope["kind"], scope["id"], actor))
        else:
            db.execute("UPDATE memory_items SET current_revision=? WHERE id=?", (revision + 1, item_id))
        db.execute("INSERT INTO memory_revisions(item_id,revision,author_id,operation_id,title,body,attachments,refs,draft) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", (item_id, revision + 1, actor, envelope["operation_id"], title, body,
                                                   _json(attachments), _json(refs), int(draft)))
        # Whoever writes a revision has read it, so their own edit never marks
        # the page changed for them. The write is already its own change.
        db.execute("INSERT INTO memory_reads(actor_id,item_id,revision) VALUES (?,?,?) "
                   "ON CONFLICT(actor_id,item_id) DO UPDATE SET revision=excluded.revision", (actor, item_id, revision + 1))
        db.execute("INSERT INTO memory_notebooks VALUES (?,?,1) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET version=version+1", (scope["kind"], scope["id"]))
        notebook_version = db.execute("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?", (scope["kind"], scope["id"])).fetchone()[0]
        self._change(db, scope["kind"], scope["id"], "memory", item_id, revision + 1)
        ref = {"kind": "memory", "id": item_id, "revision": revision + 1}
        return {"item_id": item_id, "owner_scope": scope, "revision": revision + 1,
                "source_ref": ref, "notebook_version": notebook_version}, [
                    {"kind": "memory", "id": item_id, "version": revision + 1},
                    {"kind": "notebook", "id": scope["id"], "scope_kind": scope["kind"], "version": notebook_version}]

    def _memory_read(self, db, actor, item_id):
        row = db.execute("SELECT revision FROM memory_reads WHERE actor_id=? AND item_id=?", (actor, item_id)).fetchone()
        return row[0] if row else 0

    def _command_memory_read(self, db, actor, envelope):
        """The reader has read this exact revision of a Notebook page they can read.

        A read only moves forward: reading an older revision, or the same one
        again, leaves the later one in place, so a late request never makes a
        page look changed again."""
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"item_id"} or set(args) != {"revision"}:
            raise Refusal("INVALID_ARGUMENT", "Name one Notebook page and the revision read")
        item = self._memory_ref(db, actor, {"kind": "memory", "id": target["item_id"], "revision": args["revision"]})
        previous = self._memory_read(db, actor, item["id"])
        result = {"item_id": item["id"], "previous_revision": previous, "current_revision": item["current_revision"]}
        if args["revision"] <= previous:
            return dict(result, read_revision=previous, changed=False), []
        db.execute("INSERT INTO memory_reads(actor_id,item_id,revision) VALUES (?,?,?) "
                   "ON CONFLICT(actor_id,item_id) DO UPDATE SET revision=excluded.revision", (actor, item["id"], args["revision"]))
        self._change(db, "actor", actor, "memory_read", item["id"], args["revision"])
        return dict(result, read_revision=args["revision"], changed=True), [
            {"kind": "memory_read", "id": item["id"], "version": args["revision"]}]

    def _memory_source(self, db, actor, ref):
        """One revision of a page. While the page is a draft an agent gets it with no words: no body, attachments or
        evidence (withheld), whichever revision it names, so neither a read, a link nor a quote carries them."""
        item = self._memory_ref(db, actor, ref)
        row = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?", (ref["id"], ref["revision"])).fetchone()
        # The page is a draft while its latest revision is marked; an agent is then given its title alone.
        draft_now = bool(db.execute("SELECT draft FROM memory_revisions WHERE item_id=? AND revision=?",
                                    (item["id"], item["current_revision"])).fetchone()[0])
        withheld = draft_now and actor_kind(db, actor) == "agent"
        return {"instance_id": self.instance_id, "source_ref": dict(ref),
                "owner_scope": {"kind": item["scope_kind"], "id": item["scope_id"]},
                "topic_id": item["scope_id"] if item["scope_kind"] == "topic" else None,
                "author": row["author_id"], "creator": item["creator_id"], "title": row["title"],
                "body": "" if withheld else row["body"], "attachments": [] if withheld else json.loads(row["attachments"]),
                "references": [] if withheld else json.loads(row["refs"]), "version": row["revision"],
                "draft": bool(row["draft"]), "withheld": withheld,
                "reader_may_write": self._reader_may_write(db, actor, item["scope_kind"], item["scope_id"], draft_now),
                "current_revision": item["current_revision"], "allowed_actions": ["quote", "note.save"]}

    def _view_memory_current(self, db, actor, args):
        """A Notebook page as it stands, at the revision its answer's source_ref names.
        A source_ref without a revision never reads the latest one; this is asked for by name."""
        item = self._memory_identity(db, actor, args.get("item_id"))
        return self._memory_source(db, actor, {"kind": "memory", "id": item["id"], "revision": item["current_revision"]})

    def _view_memory_items(self, db, actor, args):
        """A Notebook's pages, and whether the reader may write in it (reader_may_write), which a page reads before it
        offers its pencil. A draft page is listed to an agent with its title and its mark and no words (withheld)."""
        scope = self._memory_scope(db, actor, args.get("owner_scope"))
        limit = _page_size(args)
        agent = actor_kind(db, actor) == "agent"
        rows = db.execute("SELECT i.*,r.author_id,r.draft,substr(r.title,1,256) AS title,substr(r.body,1,1024) AS body,length(CAST(r.body AS BLOB)) AS body_bytes,"
                          "coalesce(k.revision,0) AS read_revision FROM memory_items i JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision "
                          "LEFT JOIN memory_reads k ON k.actor_id=? AND k.item_id=i.id WHERE i.scope_kind=? AND i.scope_id=? AND i.seq>? ORDER BY i.seq LIMIT ?",
                          (actor, scope["kind"], scope["id"], args.get("cursor", 0), limit + 1)).fetchall()
        items, size = [], 1024
        for row in rows[:limit]:
            withheld = bool(row["draft"]) and agent
            body = "" if withheld else _preview(row["body"])
            item = {"id": row["id"], "seq": row["seq"], "owner_scope": scope,
                    "title": _preview(row["title"], 256), "body": body,
                    "preview": not withheld and len(body.encode("utf-8")) < row["body_bytes"],
                    "draft": bool(row["draft"]), "withheld": withheld,
                    "source_ref": {"kind": "memory", "id": row["id"], "revision": row["current_revision"]},
                    "revision": row["current_revision"], "read_revision": row["read_revision"],
                    "author": row["author_id"], "allowed_actions": ["quote", "note.save"]}
            encoded = len(_json(item).encode("utf-8")) + 1
            if size + encoded > LIMITS["summary_utf8_bytes"]:
                break
            items.append(item)
            size += encoded
        version = db.execute("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?", (scope["kind"], scope["id"])).fetchone()
        return {"instance_id": self.instance_id, "items": items,
                "reader_may_write": self._reader_may_write(db, actor, scope["kind"], scope["id"]),
                "next_cursor": items[-1]["seq"] if len(rows) > len(items) else None,
                "relevant_versions": {"notebook": version[0] if version else 0}}

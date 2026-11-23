from __future__ import annotations

import json

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _revision, _bounded_page
from .conversation import _preview
from .whispers import actor_kind, private_source_refused
from .memory_transfer import MemoryTransfers


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

# A separately named candidate step from actual schema 47, not a reservation of 757's 48.
MEMORY_ACTION_SCHEMA = [
    "ALTER TABLE memory_revisions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))",
    "CREATE TABLE memory_star_acts (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES actors(id), item_id TEXT NOT NULL REFERENCES memory_items(id), scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, starred INTEGER NOT NULL CHECK(starred IN (0,1)))",
    "CREATE INDEX memory_star_latest ON memory_star_acts(actor_id,item_id,id DESC)",
    "CREATE INDEX memory_star_scope ON memory_star_acts(actor_id,scope_kind,scope_id,id DESC)",
    "CREATE TRIGGER memory_star_update BEFORE UPDATE ON memory_star_acts BEGIN SELECT RAISE(ABORT, 'immutable page star'); END",
    "CREATE TRIGGER memory_star_delete BEFORE DELETE ON memory_star_acts BEGIN SELECT RAISE(ABORT, 'immutable page star'); END",
]
MEMORY_ACTION_DOWN = ("DROP TABLE memory_star_acts", "ALTER TABLE memory_revisions DROP COLUMN deleted")
MEMORY_ACTION_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM memory_star_acts) OR EXISTS (SELECT 1 FROM memory_revisions WHERE deleted=1)"

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


class _Carried:
    """The images a revise may keep though the writer did not upload them: those the revision it follows carries, and
    any other one of the page's revisions carried (Undo after × in a card, docs/decks.md "Images in a card"), since
    whoever may read the page reads it at that revision already. The history is looked up only for an image the
    revision it follows does not carry, and only for that image, so an ordinary edit reads that revision alone."""

    def __init__(self, db, item_id, current):
        self.db, self.item_id, self.current = db, item_id, {ref["id"] for ref in current}

    def __contains__(self, media_id):
        return media_id in self.current or self.db.execute(
            "SELECT 1 FROM memory_revisions AS r, json_each(r.attachments) AS a WHERE r.item_id=? AND json_extract(a.value,'$.id')=? LIMIT 1",
            (self.item_id, media_id)).fetchone() is not None


class Memory(MemoryTransfers):
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
        reader here. The writers' rule, in an outcome not reached, archived or completed, and never an agent on a draft page."""
        if not self._notebook_writer(db, actor, kind, scope_id) or (draft and actor_kind(db, actor) == "agent"):
            return False
        workspace = scope_id if kind == "workspace" else db.execute("SELECT workspace_id FROM topics WHERE id=?", (scope_id,)).fetchone()[0]
        # Not in an outcome kept to read: reached, archived or completed (item 404).
        return self._closed(db, workspace) is None

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
        if self._memory_deleted(db, identity):
            raise Refusal("PAGE_DELETED", "This Notebook page was deleted. Its history is kept; its writer or outcome owner can undo the deletion.")
        return identity

    def _memory_deleted(self, db, item):
        return bool(db.execute("SELECT deleted FROM memory_revisions WHERE item_id=? AND revision=?",
                               (item["id"], item["current_revision"])).fetchone()[0])

    def _memory_may_delete(self, db, actor, item, draft=False):
        workspace = item["scope_id"] if item["scope_kind"] == "workspace" else db.execute(
            "SELECT workspace_id FROM topics WHERE id=?", (item["scope_id"],)).fetchone()[0]
        owner = db.execute("SELECT owner_id FROM workspaces WHERE id=?", (workspace,)).fetchone()[0]
        return (actor in (item["creator_id"], owner) and self._closed(db, workspace) is None
                and not (draft and actor_kind(db, actor) == "agent"))

    def _memory_changed(self, db, item_id, scope, revision):
        db.execute("INSERT INTO memory_notebooks VALUES (?,?,1) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET version=version+1",
                   (scope["kind"], scope["id"]))
        version = db.execute("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?",
                             (scope["kind"], scope["id"])).fetchone()[0]
        self._change(db, scope["kind"], scope["id"], "memory", item_id, revision)
        return {"item_id": item_id, "owner_scope": scope, "revision": revision,
                "source_ref": {"kind": "memory", "id": item_id, "revision": revision}, "notebook_version": version}, [
                    {"kind": "memory", "id": item_id, "version": revision},
                    {"kind": "notebook", "id": scope["id"], "scope_kind": scope["kind"], "version": version}]

    def _command_memory_delete(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"item_id"} or set(args) != {"deleted"} or type(args["deleted"]) is not bool:
            raise Refusal("INVALID_ARGUMENT", "Name a page and whether it is deleted")
        item = self._memory_identity(db, actor, target["item_id"])
        current = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?",
                             (item["id"], item["current_revision"])).fetchone()
        if not self._memory_may_delete(db, actor, item, bool(current["draft"])):
            raise Refusal("FORBIDDEN", "Only this page's writer or its outcome's owner can delete or restore it in an open outcome")
        _revision(envelope["expected"], "item_revision", item["current_revision"])
        if bool(current["deleted"]) == args["deleted"]:
            raise Refusal("REVISION_CONFLICT", "This page's deletion state changed; nothing was changed")
        revision = item["current_revision"] + 1
        db.execute("INSERT INTO memory_revisions(item_id,revision,author_id,operation_id,title,body,attachments,refs,draft,deleted) VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (item["id"], revision, actor, envelope["operation_id"], current["title"], current["body"], current["attachments"], current["refs"], current["draft"], int(args["deleted"])))
        db.execute("UPDATE memory_items SET current_revision=? WHERE id=?", (revision, item["id"]))
        result, affected = self._memory_changed(db, item["id"], {"kind": item["scope_kind"], "id": item["scope_id"]}, revision)
        return dict(result, deleted=args["deleted"]), affected

    def _memory_star(self, db, actor, item_id):
        row = db.execute("SELECT id,starred FROM memory_star_acts WHERE actor_id=? AND item_id=? ORDER BY id DESC LIMIT 1",
                         (actor, item_id)).fetchone()
        return {"star_revision": row["id"] if row else 0, "starred": bool(row and row["starred"])}

    def _command_memory_star(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"item_id"} or set(args) != {"starred"} or type(args["starred"]) is not bool:
            raise Refusal("INVALID_ARGUMENT", "Name a page and whether it is starred")
        item = self._memory_identity(db, actor, target["item_id"])
        if self._memory_deleted(db, item):
            raise Refusal("PAGE_DELETED", "This Notebook page was deleted; nothing was changed")
        state = self._memory_star(db, actor, item["id"])
        _revision(envelope["expected"], "star_revision", state["star_revision"])
        cursor = db.execute("INSERT INTO memory_star_acts(actor_id,item_id,scope_kind,scope_id,starred) VALUES (?,?,?,?,?)",
                            (actor, item["id"], item["scope_kind"], item["scope_id"], int(args["starred"])))
        revision = cursor.lastrowid
        self._change(db, "actor", actor, "memory_star", item["id"], revision)
        return {"item_id": item["id"], "starred": args["starred"], "star_revision": revision}, [
            {"kind": "memory_star", "id": item["id"], "version": revision}]

    def _view_memory_stars(self, db, actor, args):
        topic = self._topic(db, actor, args.get("topic_id"))
        scopes = [("topic", topic["id"])]
        if topic["kind"] == "conversation":
            # Outcome readability is checked separately; topic access grants no implicit outcome read.
            try:
                self._workspace(db, actor, topic["workspace_id"])
                scopes.append(("workspace", topic["workspace_id"]))
            except Refusal as error:
                if error.code != "FORBIDDEN":
                    raise
        limit = _page_size(args)
        rows = sorted([row for kind, scope in scopes for row in db.execute(
            "SELECT a.id AS star,a.item_id,i.scope_kind,i.scope_id,i.current_revision,r.title FROM memory_star_acts a "
            "JOIN memory_items i ON i.id=a.item_id JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision "
            "WHERE a.actor_id=? AND i.scope_kind=? AND i.scope_id=? AND a.id<? AND a.starred=1 AND r.deleted=0 "
            "AND NOT EXISTS (SELECT 1 FROM memory_star_acts n WHERE n.actor_id=a.actor_id AND n.item_id=a.item_id AND n.id>a.id) "
            "ORDER BY a.id DESC LIMIT ?", (actor, kind, scope, args.get("cursor", 9223372036854775807), limit+1)).fetchall()],
            key=lambda row: -row["star"])[:limit+1]
        return _bounded_page({"instance_id": self.instance_id, "topic_id": topic["id"]}, rows, limit,
                             lambda row: {"star": row["star"], "item_id": row["item_id"], "topic_id": topic["id"],
                                          "owner_scope": {"kind": row["scope_kind"], "id": row["scope_id"]},
                                          "title": _preview(row["title"], 256), "revision": row["current_revision"]}, "star")

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
            if self._memory_deleted(db, old):
                raise Refusal("PAGE_DELETED", "This Notebook page was deleted; your writing was not changed")
            scope = {"kind": old["scope_kind"], "id": old["scope_id"]}
            revision = old["current_revision"]
            _revision(envelope["expected"], "item_revision", revision)
        current = None if creating else db.execute("SELECT attachments,draft FROM memory_revisions WHERE item_id=? AND revision=?",
                                                   (item_id, revision)).fetchone()
        retained = () if creating else _Carried(db, item_id, json.loads(current["attachments"]))
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
        return self._memory_changed(db, item_id, scope, revision + 1)

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

    def _memory_source(self, db, actor, ref, current=False):
        """One revision of a page. While the page is a draft an agent gets it with no words: no body, attachments or
        evidence (withheld), whichever revision it names, so neither a read, a link nor a quote carries them."""
        item = self._memory_identity(db, actor, ref["id"]) if current else self._memory_ref(db, actor, ref)
        row = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?", (ref["id"], ref["revision"])).fetchone()
        # The page is a draft while its latest revision is marked; an agent is then given its title alone.
        draft_now = bool(db.execute("SELECT draft FROM memory_revisions WHERE item_id=? AND revision=?",
                                    (item["id"], item["current_revision"])).fetchone()[0])
        deleted = self._memory_deleted(db, item)
        withheld = deleted or (draft_now and actor_kind(db, actor) == "agent")
        from .removal import unsent
        references = [ref for ref in json.loads(row['refs']) if not (ref.get('kind') == 'message' and unsent(db, ref.get('id')))]
        return {"instance_id": self.instance_id, "source_ref": dict(ref),
                "owner_scope": {"kind": item["scope_kind"], "id": item["scope_id"]},
                "topic_id": item["scope_id"] if item["scope_kind"] == "topic" else None,
                "author": row["author_id"], "creator": item["creator_id"], "title": row["title"],
                "body": "" if withheld else row["body"], "attachments": [] if withheld else json.loads(row["attachments"]),
                "references": [] if withheld else references, "version": row["revision"],
                "draft": bool(row["draft"]), "withheld": withheld, "deleted": deleted,
                **self._memory_star(db, actor, item["id"]),
                "reader_may_delete": self._memory_may_delete(db, actor, item, draft_now),
                "reader_may_write": not deleted and self._reader_may_write(db, actor, item["scope_kind"], item["scope_id"], draft_now),
                "current_revision": item["current_revision"], "allowed_actions": [] if deleted else ["quote", "note.save"]}

    def _view_memory_status(self, db, actor, args):
        item = self._memory_identity(db, actor, args.get("item_id"))
        row = db.execute("SELECT draft,deleted FROM memory_revisions WHERE item_id=? AND revision=?",
                         (item["id"], item["current_revision"])).fetchone()
        return {"instance_id": self.instance_id, "source_ref": {"kind": "memory", "id": item["id"], "revision": item["current_revision"]},
                "deleted": bool(row["deleted"]), **self._memory_star(db, actor, item["id"]),
                "reader_may_delete": self._memory_may_delete(db, actor, item, bool(row["draft"])),
                "reader_may_write": not row["deleted"] and self._reader_may_write(db, actor, item["scope_kind"], item["scope_id"], bool(row["draft"]))}

    def _view_memory_current(self, db, actor, args):
        """A Notebook page as it stands, at the revision its answer's source_ref names.
        A source_ref without a revision never reads the latest one; this is asked for by name."""
        item = self._memory_identity(db, actor, args.get("item_id"))
        return self._memory_source(db, actor, {"kind": "memory", "id": item["id"], "revision": item["current_revision"]}, current=True)

    def _view_memory_items(self, db, actor, args):
        """A Notebook's pages, and whether the reader may write in it (reader_may_write), which a page reads before it
        offers its pencil. A draft page is listed to an agent with its title and its mark and no words (withheld)."""
        scope = self._memory_scope(db, actor, args.get("owner_scope"))
        limit = _page_size(args)
        agent = actor_kind(db, actor) == "agent"
        rows = db.execute("SELECT i.*,r.author_id,r.draft,substr(r.title,1,256) AS title,substr(r.body,1,1024) AS body,length(CAST(r.body AS BLOB)) AS body_bytes,"
                          "coalesce(k.revision,0) AS read_revision FROM memory_items i JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision "
                          "LEFT JOIN memory_reads k ON k.actor_id=? AND k.item_id=i.id WHERE i.scope_kind=? AND i.scope_id=? AND r.deleted=0 AND i.seq>? ORDER BY i.seq LIMIT ?",
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

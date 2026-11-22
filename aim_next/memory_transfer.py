from __future__ import annotations

"""Atomic Notebook relocation and its exact, attributed inverse (1060)."""

import json
from urllib.parse import urlencode

from .contract import Refusal, _body, _identifier, _revision
from .delivery import _now_ms
from .message_edit import is_held
from .whispers import actor_kind, private_source_refused


# Two pages can receive one act (copy and its inverse). Keep the real parent
# operation on both revisions, with at most one revision per page per act.
# Nothing references memory_revisions by FK; rebuild without rewriting a value.
def _revision_layout(per_page):
    return [
        "DROP TRIGGER immutable_memory_revision_update",
        "DROP TRIGGER immutable_memory_revision_delete",
        "ALTER TABLE memory_revisions RENAME TO memory_revisions_transfer",
        "CREATE TABLE memory_revisions (item_id TEXT NOT NULL REFERENCES memory_items(id), revision INTEGER NOT NULL, "
        "author_id TEXT NOT NULL REFERENCES actors(id), operation_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, "
        "attachments TEXT NOT NULL, refs TEXT NOT NULL, draft INTEGER NOT NULL DEFAULT 0, "
        "deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), PRIMARY KEY(item_id,revision), "
        "UNIQUE(author_id,operation_id%s))" % (",item_id" if per_page else ""),
        "INSERT INTO memory_revisions SELECT * FROM memory_revisions_transfer",
        "DROP TABLE memory_revisions_transfer",
        "CREATE TRIGGER immutable_memory_revision_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT, 'immutable Notebook revision'); END",
        "CREATE TRIGGER immutable_memory_revision_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT, 'immutable Notebook revision'); END",
    ]


TRANSFER_IDENTITY = (
    "CREATE TRIGGER immutable_memory_identity BEFORE UPDATE ON memory_items WHEN NEW.seq!=OLD.seq OR NEW.id!=OLD.id "
    "OR NEW.creator_id!=OLD.creator_id OR ((NEW.scope_kind!=OLD.scope_kind OR NEW.scope_id!=OLD.scope_id) AND NOT EXISTS "
    "(SELECT 1 FROM memory_transfer_acts a WHERE a.item_id=OLD.id AND a.kind IN ('move','undo_move') "
    "AND a.before_revision=OLD.current_revision AND a.after_revision=NEW.current_revision AND NEW.current_revision=OLD.current_revision+1 "
    "AND a.from_kind=OLD.scope_kind AND a.from_id=OLD.scope_id AND a.to_kind=NEW.scope_kind AND a.to_id=NEW.scope_id)) "
    "BEGIN SELECT RAISE(ABORT, 'immutable Notebook identity'); END"
)
MEMORY_TRANSFER_SCHEMA = _revision_layout(True) + [
    "CREATE TABLE memory_transfer_acts (actor_id TEXT NOT NULL REFERENCES actors(id), id TEXT NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('move','copy','undo_move','undo_copy')), item_id TEXT NOT NULL REFERENCES memory_items(id), "
    "copy_id TEXT REFERENCES memory_items(id), from_kind TEXT NOT NULL, from_id TEXT NOT NULL, to_kind TEXT NOT NULL, to_id TEXT NOT NULL, "
    "before_revision INTEGER NOT NULL, after_revision INTEGER NOT NULL, copy_before_revision INTEGER, copy_after_revision INTEGER, "
    "undo_of TEXT, PRIMARY KEY(actor_id,id), UNIQUE(actor_id,undo_of), FOREIGN KEY(actor_id,undo_of) REFERENCES memory_transfer_acts(actor_id,id))",
    "CREATE INDEX memory_scope_transfers ON memory_transfer_acts(item_id,after_revision)",
    "CREATE TRIGGER immutable_memory_transfer_update BEFORE UPDATE ON memory_transfer_acts BEGIN SELECT RAISE(ABORT, 'immutable Notebook transfer'); END",
    "CREATE TRIGGER immutable_memory_transfer_delete BEFORE DELETE ON memory_transfer_acts BEGIN SELECT RAISE(ABORT, 'immutable Notebook transfer'); END",
    "DROP TRIGGER immutable_memory_identity",
    TRANSFER_IDENTITY,
]
MEMORY_TRANSFER_DOWN = [
    "DROP TRIGGER immutable_memory_identity",
    "DROP TABLE memory_transfer_acts",
    "CREATE TRIGGER immutable_memory_identity BEFORE UPDATE ON memory_items WHEN NEW.seq!=OLD.seq OR NEW.id!=OLD.id "
    "OR NEW.scope_kind!=OLD.scope_kind OR NEW.scope_id!=OLD.scope_id OR NEW.creator_id!=OLD.creator_id "
    "BEGIN SELECT RAISE(ABORT, 'immutable Notebook identity'); END",
] + _revision_layout(False)
MEMORY_TRANSFER_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM memory_transfer_acts)"


def _scope(item):
    return {"kind": item["scope_kind"], "id": item["scope_id"]}


def _link(label, scope, item_id):
    return "[%s](?%s)\n\n" % (label, urlencode([(scope["kind"], scope["id"]), ("page", item_id)]))


class MemoryTransfers:
    def _transfer_page(self, db, actor, item_id, expected):
        item = self._memory_identity(db, actor, item_id, write=True)
        _revision(expected, "item_revision", item["current_revision"])
        current = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?",
                             (item["id"], item["current_revision"])).fetchone()
        if current["deleted"]:
            raise Refusal("PAGE_DELETED", "This Notebook page was deleted; nothing was changed")
        if current["draft"] and actor_kind(db, actor) == "agent":
            raise Refusal("FORBIDDEN", "This draft page is kept from agents; nothing was changed")
        self._refuse_if_closed(db, actor, self._transfer_workspace(db, _scope(item)))
        return item, current

    def _transfer_workspace(self, db, scope):
        return scope["id"] if scope["kind"] == "workspace" else db.execute(
            "SELECT workspace_id FROM topics WHERE id=?", (scope["id"],)).fetchone()[0]

    def _transfer_destination(self, db, actor, scope):
        try:
            scope = self._memory_scope(db, actor, scope, write=True)
            if scope["kind"] == "topic" and not self._may_say(db, self._topic(db, actor, scope["id"]), actor):
                raise Refusal("FORBIDDEN", "No destination posting permission")
        except Refusal as error:
            if error.code == "FORBIDDEN":
                raise Refusal("FORBIDDEN", "You cannot write in that destination Notebook; nothing was changed") from error
            raise
        self._refuse_if_closed(db, actor, self._transfer_workspace(db, scope))
        return scope

    def _transfer_audience(self, db, scope):
        workspace = self._transfer_workspace(db, scope)
        candidates = "SELECT owner_id AS actor FROM workspaces WHERE id=:workspace UNION SELECT actor_id FROM workspace_members WHERE workspace_id=:workspace"
        if scope["kind"] == "topic":
            candidates += " UNION SELECT creator_id FROM topics WHERE id=:topic UNION SELECT actor_id FROM topic_participants WHERE topic_id=:topic AND active=1"
        rows = db.execute("SELECT a.id FROM actors a JOIN (" + candidates + ") c ON c.actor=a.id WHERE a.enabled=1",
                          {"workspace": workspace, "topic": scope["id"]}).fetchall()
        for row in rows:
            # The existing Core rule remains authoritative if its readers change.
            try:
                self._memory_scope(db, row[0], scope)
            except Refusal:
                continue
            yield row[0]

    def _transfer_references(self, db, item, current, destination, history):
        refs = db.execute("SELECT DISTINCT j.value FROM memory_revisions r, json_each(r.refs) j WHERE r.item_id=?" +
                          ("" if history else " AND r.revision=?"),
                          (item["id"],) if history else (item["id"], current["revision"])).fetchall()
        if not refs:
            return
        for reader in self._transfer_audience(db, destination):
            # A draft exposes no quoted words to agents, including its history.
            if current["draft"] and actor_kind(db, reader) == "agent":
                continue
            for (encoded,) in refs:
                ref = json.loads(encoded)
                try:
                    if ref["kind"] == "memory":
                        # The moved page's own history will be readable at its new scope.
                        source = item if history and ref["id"] == item["id"] else self._memory_ref(db, reader, ref)
                        mark = db.execute("SELECT draft FROM memory_revisions WHERE item_id=? AND revision=?",
                                          (source["id"], source["current_revision"])).fetchone()[0]
                        if mark and actor_kind(db, reader) == "agent":
                            raise Refusal("FORBIDDEN", "Draft evidence is withheld")
                    else:
                        self._message_access(db, reader, ref["id"])
                        private_source_refused(db, reader, ref["id"])
                        if actor_kind(db, reader) == "agent" and is_held(db, ref["id"], _now_ms()):
                            raise Refusal("FORBIDDEN", "Evidence is held in Edit")
                except Refusal as error:
                    raise Refusal("NOTEBOOK_AUDIENCE_CONFLICT",
                                  "A source quoted in this page is not readable by everyone in that destination; nothing was changed") from error

    def _transfer_pipeline(self, db, item_id, destination):
        if db.execute("SELECT 1 FROM pipeline_item_sources WHERE memory_item_id=? AND workspace_id<>? LIMIT 1",
                      (item_id, self._transfer_workspace(db, destination))).fetchone():
            raise Refusal("NOTEBOOK_SOURCE_OUTCOME_CONFLICT",
                          "This page is a pipeline item's source; keep it in that item's outcome or copy it instead. Nothing was changed")

    def _transfer_revision(self, db, actor, operation, item_id, revision, current, title=None, body=None, deleted=0):
        db.execute("INSERT INTO memory_revisions(item_id,revision,author_id,operation_id,title,body,attachments,refs,draft,deleted) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?)", (item_id, revision, actor, operation,
                   current["title"] if title is None else title, current["body"] if body is None else body,
                   current["attachments"], current["refs"], current["draft"], deleted))
        db.execute("UPDATE memory_items SET current_revision=? WHERE id=?", (revision, item_id))
        db.execute("INSERT INTO memory_reads VALUES (?,?,?) ON CONFLICT(actor_id,item_id) DO UPDATE SET revision=excluded.revision",
                   (actor, item_id, revision))

    def _transfer_record(self, db, actor, operation, kind, item, destination, copy_id=None, copy_before=None, copy_after=None, undo_of=None):
        db.execute("INSERT INTO memory_transfer_acts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (actor, operation, kind, item["id"], copy_id, item["scope_kind"], item["scope_id"],
                    destination["kind"], destination["id"], item["current_revision"], item["current_revision"] + 1,
                    copy_before, copy_after, undo_of))

    def _transfer_changed(self, db, pages, old_scope):
        scopes = {(old_scope["kind"], old_scope["id"])} | {(scope["kind"], scope["id"]) for _, _, scope in pages}
        versions, affected, results = {}, [], []
        for kind, scope_id in sorted(scopes):
            db.execute("INSERT INTO memory_notebooks VALUES (?,?,1) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET version=version+1", (kind, scope_id))
            version = db.execute("SELECT version FROM memory_notebooks WHERE scope_kind=? AND scope_id=?", (kind, scope_id)).fetchone()[0]
            versions[(kind, scope_id)] = version
            affected.append({"kind": "notebook", "id": scope_id, "scope_kind": kind, "version": version})
        for item_id, revision, scope in pages:
            self._change(db, scope["kind"], scope["id"], "memory", item_id, revision)
            affected.append({"kind": "memory", "id": item_id, "version": revision})
            results.append({"item_id": item_id, "revision": revision, "owner_scope": scope,
                            "source_ref": {"kind": "memory", "id": item_id, "revision": revision},
                            "notebook_version": versions[(scope["kind"], scope["id"]) ]})
        if old_scope != pages[0][2]:
            self._change(db, old_scope["kind"], old_scope["id"], "memory", pages[0][0], pages[0][1])
        return results, affected

    def _command_memory_move(self, db, actor, envelope):
        return self._transfer(db, actor, envelope, copying=False)

    def _command_memory_copy(self, db, actor, envelope):
        return self._transfer(db, actor, envelope, copying=True)

    def _transfer(self, db, actor, envelope, copying):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"item_id"} or set(args) != ({"owner_scope", "copy_id"} if copying else {"owner_scope"}):
            raise Refusal("INVALID_ARGUMENT", "Name a page, destination Notebook and, for a copy, its kept new id")
        item, current = self._transfer_page(db, actor, target["item_id"], envelope["expected"])
        destination = self._transfer_destination(db, actor, args["owner_scope"])
        old_scope = _scope(item)
        if not copying and destination == old_scope:
            raise Refusal("INVALID_ARGUMENT", "This page is already in that Notebook; nothing was changed")
        copy_id = None
        if copying:
            copy_id = _identifier(args["copy_id"], "copy_id")
            _revision(envelope["expected"], "copy_revision", 0)
            if db.execute("SELECT 1 FROM memory_items WHERE id=?", (copy_id,)).fetchone():
                raise Refusal("REVISION_CONFLICT", "That copy identity already exists; nothing was changed")
            title = _body(current["title"] + " copy")
            source_body = _body(_link("Copy", destination, copy_id) + current["body"])
            copy_body = _body(_link("Original", old_scope, item["id"]) + current["body"])
        else:
            self._transfer_pipeline(db, item["id"], destination)
        self._transfer_references(db, item, current, destination, history=not copying)
        operation, revision = envelope["operation_id"], item["current_revision"] + 1
        if copying:
            db.execute("INSERT INTO memory_items(id,scope_kind,scope_id,creator_id,current_revision) VALUES (?,?,?,?,1)",
                       (copy_id, destination["kind"], destination["id"], actor))
        self._transfer_record(db, actor, operation, "copy" if copying else "move", item, destination,
                              copy_id, 0 if copying else None, 1 if copying else None)
        if copying:
            self._transfer_revision(db, actor, operation, item["id"], revision, current, body=source_body)
            self._transfer_revision(db, actor, operation, copy_id, 1, current, title=title, body=copy_body)
            pages = [(item["id"], revision, old_scope), (copy_id, 1, destination)]
        else:
            db.execute("UPDATE memory_items SET scope_kind=?,scope_id=?,current_revision=? WHERE id=?",
                       (destination["kind"], destination["id"], revision, item["id"]))
            self._transfer_revision(db, actor, operation, item["id"], revision, current)
            pages = [(item["id"], revision, destination)]
        results, affected = self._transfer_changed(db, pages, old_scope)
        result = dict(results[0], transfer_id=operation, committed_ms=_now_ms(), from_scope=old_scope, to_scope=destination)
        if copying:
            result["copy"] = results[1]
        return result, affected

    def _command_memory_transfer_undo(self, db, actor, envelope):
        if set(envelope["target"]) != {"transfer_id"} or envelope["args"]:
            raise Refusal("INVALID_ARGUMENT", "Name the kept Notebook transfer to undo")
        forward_id = _identifier(envelope["target"]["transfer_id"], "transfer_id")
        forward = db.execute("SELECT * FROM memory_transfer_acts WHERE actor_id=? AND id=? AND kind IN ('move','copy')", (actor, forward_id)).fetchone()
        if forward is None:
            raise Refusal("FORBIDDEN", "No Notebook transfer of yours to undo")
        if db.execute("SELECT 1 FROM memory_transfer_acts WHERE actor_id=? AND undo_of=?", (actor, forward_id)).fetchone():
            raise Refusal("REVISION_CONFLICT", "This Notebook transfer was already undone; nothing was changed")
        _revision(envelope["expected"], "item_revision", forward["after_revision"])
        item, current = self._transfer_page(db, actor, forward["item_id"], envelope["expected"])
        copying = forward["kind"] == "copy"
        destination = self._transfer_destination(db, actor, {"kind": forward["from_kind"], "id": forward["from_id"]})
        if copying:
            _revision(envelope["expected"], "copy_revision", forward["copy_after_revision"])
            clone, copied = self._transfer_page(db, actor, forward["copy_id"], {"item_revision": envelope["expected"].get("copy_revision")})
            before = db.execute("SELECT * FROM memory_revisions WHERE item_id=? AND revision=?", (item["id"], forward["before_revision"])).fetchone()
        else:
            if "copy_revision" in envelope["expected"]:
                raise Refusal("INVALID_ARGUMENT", "A move has no copy revision")
            self._transfer_pipeline(db, item["id"], destination)
            self._transfer_references(db, item, current, destination, history=True)
        operation, revision = envelope["operation_id"], item["current_revision"] + 1
        self._transfer_record(db, actor, operation, "undo_copy" if copying else "undo_move", item, destination,
                              forward["copy_id"], forward["copy_after_revision"] if copying else None,
                              forward["copy_after_revision"] + 1 if copying else None, forward_id)
        if copying:
            self._transfer_revision(db, actor, operation, item["id"], revision, before)
            self._transfer_revision(db, actor, operation, clone["id"], clone["current_revision"] + 1, before, title=copied["title"], deleted=1)
            pages = [(item["id"], revision, _scope(item)), (clone["id"], clone["current_revision"] + 1, _scope(clone))]
        else:
            db.execute("UPDATE memory_items SET scope_kind=?,scope_id=?,current_revision=? WHERE id=?", (destination["kind"], destination["id"], revision, item["id"]))
            self._transfer_revision(db, actor, operation, item["id"], revision, current)
            pages = [(item["id"], revision, destination)]
        results, affected = self._transfer_changed(db, pages, _scope(item))
        result = dict(results[0], transfer_id=operation, committed_ms=_now_ms(), undo_of=forward_id, from_scope=_scope(item), to_scope=destination)
        if copying:
            result["copy"] = dict(results[1], deleted=True)
        return result, affected

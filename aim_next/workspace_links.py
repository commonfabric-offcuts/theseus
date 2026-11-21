from __future__ import annotations

"""Outcome-owned Links and title/removal overrides for message previews (1021)."""

from urllib.parse import quote, urlsplit, urlunsplit

from .contract import LIMITS, Refusal, _bounded_page, _page_size, _revision
from .delivery import _now_ms


LINK_SCHEMA = [
    "CREATE TABLE workspace_links (seq INTEGER PRIMARY KEY AUTOINCREMENT, "
    "workspace_id TEXT NOT NULL REFERENCES workspaces(id), url TEXT NOT NULL, title TEXT NOT NULL, "
    "revision INTEGER NOT NULL CHECK(revision>0), removed INTEGER NOT NULL CHECK(removed IN (0,1)), "
    "by_actor TEXT NOT NULL REFERENCES actors(id), ms INTEGER NOT NULL, UNIQUE(workspace_id,url))",
    "CREATE INDEX workspace_link_pages ON workspace_links(workspace_id,seq DESC)",
]
LINK_DOWN = ("DROP TABLE workspace_links",)
LINK_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM workspace_links)"


def canonical_url(value):
    if (not isinstance(value, str) or not value or len(value.encode("utf-8")) > LIMITS["link_url_utf8_bytes"]
            or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in value)):
        raise Refusal("INVALID_ARGUMENT", "Use a bounded HTTP or HTTPS address without spaces or control characters")
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError()
        host = parsed.hostname.encode("idna").decode("ascii").lower()
        port = parsed.port
        if any(c in host for c in "/?#@%"):
            raise ValueError()
        if ":" in host:
            host = "[" + host + "]"
        scheme = parsed.scheme.lower()
        netloc = host + (":" + str(port) if port is not None and (scheme, port) not in (("http", 80), ("https", 443)) else "")
        safe = "/%:@!$&'()*+,;=-._~"
        result = urlunsplit((scheme, netloc, quote(parsed.path or "/", safe=safe),
                            quote(parsed.query, safe=safe + "?"), quote(parsed.fragment, safe=safe + "?")))
    except (ValueError, UnicodeError):
        raise Refusal("INVALID_ARGUMENT", "Use an HTTP or HTTPS address without a username or password")
    if len(result.encode("utf-8")) > LIMITS["link_url_utf8_bytes"]:
        raise Refusal("INVALID_ARGUMENT", "The address is too long")
    return result


def link_item(row):
    return {"seq": row["seq"], "url": row["url"], "title": row["title"], "revision": row["revision"],
            "removed": bool(row["removed"]), "by": row["by_actor"], "ms": row["ms"]}


class WorkspaceLinks:
    def _view_workspace_links(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        limit = _page_size(args)
        cursor = args.get("cursor")
        rows = db.execute("SELECT * FROM workspace_links WHERE workspace_id=?" +
                          (" AND seq<?" if cursor is not None else "") + " ORDER BY seq DESC LIMIT ?",
                          (workspace["id"],) + ((cursor,) if cursor is not None else ()) + (limit + 1,)).fetchall()
        return _bounded_page({"instance_id": self.instance_id, "workspace_id": workspace["id"],
                              "reader_may_write": self._closed(db, workspace["id"]) is None,
                              "relevant_versions": {"workspace": workspace["version"]}},
                             rows, limit, link_item, "seq")

    def _command_workspace_link_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"url", "title", "removed"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome, address, title and removal choice")
        workspace = self._workspace(db, actor, target["workspace_id"])
        self._refuse_if_closed(db, actor, workspace["id"])
        url = canonical_url(args["url"])
        title = args["title"]
        if (not isinstance(title, str) or not title.strip() or "\0" in title
                or len(title.encode("utf-8")) > LIMITS["link_title_utf8_bytes"] or type(args["removed"]) is not bool):
            raise Refusal("INVALID_ARGUMENT", "A link needs a bounded title and a true or false removal choice")
        title = title.strip()
        old = db.execute("SELECT * FROM workspace_links WHERE workspace_id=? AND url=?", (workspace["id"], url)).fetchone()
        revision = old["revision"] if old else 0
        _revision(envelope["expected"], "link_revision", revision)
        if old and (old["title"], bool(old["removed"])) == (title, args["removed"]):
            return {"workspace_id": workspace["id"], "link": link_item(old), "changed": False}, []
        if old is None and db.execute("SELECT count(*) FROM workspace_links WHERE workspace_id=?", (workspace["id"],)).fetchone()[0] >= LIMITS["workspace_links"]:
            raise Refusal("TOO_MANY_LINKS", "This outcome has reached its saved Links limit, including removed preview overrides")
        db.execute("INSERT INTO workspace_links(workspace_id,url,title,revision,removed,by_actor,ms) VALUES (?,?,?,?,?,?,?) "
                   "ON CONFLICT(workspace_id,url) DO UPDATE SET title=excluded.title,revision=excluded.revision,"
                   "removed=excluded.removed,by_actor=excluded.by_actor,ms=excluded.ms",
                   (workspace["id"], url, title, revision + 1, int(args["removed"]), actor, _now_ms()))
        db.execute("UPDATE workspaces SET version=version+1 WHERE id=?", (workspace["id"],))
        self._outcome_change(db, workspace["id"], workspace["version"] + 1)
        row = db.execute("SELECT * FROM workspace_links WHERE workspace_id=? AND url=?", (workspace["id"], url)).fetchone()
        return {"workspace_id": workspace["id"], "link": link_item(row), "changed": True}, [
            {"kind": "workspace", "id": workspace["id"], "version": workspace["version"] + 1}]

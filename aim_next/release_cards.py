from __future__ import annotations

"""A typed release's current truth and immutable history (docs/release-card-1248.md)."""

import contextvars
import json
from urllib.parse import urlsplit

from .contract import Refusal, _bounded_page, _identifier, _json, _page_size
from .delivery import _now_ms
from .message_edit import mark
from .releases import _commit, _moment

FORMAT = "release-card-v1"
editing = contextvars.ContextVar("release_card_edit", default=False)
SCHEMA = [
    "CREATE TABLE release_cards (message_id TEXT PRIMARY KEY REFERENCES messages(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), "
    "release INTEGER NOT NULL CHECK(release>0), writer_id TEXT NOT NULL REFERENCES actors(id), UNIQUE(workspace_id,release))",
    "CREATE TABLE release_card_revisions (message_id TEXT NOT NULL REFERENCES release_cards(message_id), revision INTEGER NOT NULL CHECK(revision>0), "
    "payload TEXT NOT NULL, recorded_ms INTEGER NOT NULL, operation_id TEXT NOT NULL, PRIMARY KEY(message_id,revision))",
    "CREATE TRIGGER release_card_identity_u BEFORE UPDATE ON release_cards BEGIN SELECT RAISE(ABORT,'immutable release card identity'); END",
    "CREATE TRIGGER release_card_identity_d BEFORE DELETE ON release_cards BEGIN SELECT RAISE(ABORT,'immutable release card identity'); END",
    "CREATE TRIGGER release_card_revision_u BEFORE UPDATE ON release_card_revisions BEGIN SELECT RAISE(ABORT,'immutable release card revision'); END",
    "CREATE TRIGGER release_card_revision_d BEFORE DELETE ON release_card_revisions BEGIN SELECT RAISE(ABORT,'immutable release card revision'); END",
]
DOWN = ("DROP TABLE release_card_revisions", "DROP TABLE release_cards")
OCCUPIED = "SELECT EXISTS (SELECT 1 FROM release_cards)"
STATES = ("going_out", "live", "measured", "failed", "unknown")
FIELDS = {"release", "commit", "attempt_id", "state", "title", "forecasts", "summary", "evidence"}
REQUIRED = FIELDS - {"summary", "evidence"}


def invalid(words):
    raise Refusal("INVALID_ARGUMENT", words)


def validate(value):
    if not isinstance(value, dict) or set(value) - FIELDS or REQUIRED - set(value):
        invalid("Use the release-card-v1 fields")
    if type(value["release"]) is not int or not 1 <= value["release"] <= 2 ** 31:
        invalid("A release number is a positive whole number")
    _commit(value["commit"], "commit")
    _identifier(value["attempt_id"], "attempt_id")
    if value["state"] not in STATES:
        invalid("A release card names going_out, live, measured, failed or unknown")
    for key, maximum, empty in (("title", 256, False), ("summary", 2048, True)):
        text = value.get(key, "")
        if not isinstance(text, str) or len(text) > maximum or (not empty and not text.strip()):
            invalid("%s is bounded text" % key)
    forecasts = value["forecasts"]
    if not isinstance(forecasts, dict) or set(forecasts) != {"push_at", "live_at"}:
        invalid("forecasts supplies push_at and live_at, each an offset time or null")
    for when in forecasts.values():
        if when is not None:
            _moment(when)
    links = value.get("evidence", [])
    if not isinstance(links, list) or len(links) > 8:
        invalid("evidence contains at most eight links")
    for link in links:
        if not isinstance(link, str) or not 1 <= len(link) <= 2048 or any(ord(c) < 32 for c in link):
            invalid("An evidence link is bounded HTTP(S)")
        try:
            parts = urlsplit(link)
        except ValueError:
            invalid("An evidence link is bounded HTTP(S)")
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.username is not None or parts.password is not None:
            invalid("An evidence link is bounded HTTP(S)")
    if value["state"] == "measured" and (not links or not value.get("summary", "").strip()):
        invalid("Measured names its actual result and evidence")
    if len(_json(value).encode("utf-8")) > 8192:
        invalid("A typed release payload is at most 8192 bytes")
    # Keep caller defaults stable: omitted optional fields stay omitted.
    return json.loads(_json(value))


def verified(db, value):
    if value["state"] not in ("live", "measured"):
        return None
    row = db.execute("SELECT commit_sha,deployed_at,deployed_ms FROM releases WHERE number=?", (value["release"],)).fetchone()
    if row is None:
        raise Refusal("RELEASE_NOT_VERIFIED", "This release has no verified Live record")
    if row["commit_sha"] != value["commit"]:
        raise Refusal("RELEASE_SOURCE_MISMATCH", "The verified release records another source")
    return row


def render(value, revision, live):
    labels = {"going_out": "Going out", "live": "Live", "measured": "Measured", "failed": "Failed", "unknown": "Unknown"}
    lines = ["Release %d: %s" % (value["release"], value["title"]), "", labels[value["state"]]]
    if live is not None:
        lines[-1] += " at " + live["deployed_at"]
    lines += ["Source: " + value["commit"], "Attempt: " + value["attempt_id"]]
    for key, label in (("push_at", "Push forecast"), ("live_at", "Live forecast")):
        if value["forecasts"][key] is not None:
            lines.append(label + ": " + value["forecasts"][key])
    if value.get("summary"):
        lines += ["", value["summary"]]
    lines += ["", "Evidence: " + " · ".join(value["evidence"])] if value.get("evidence") else []
    lines += ["", "Update %d" % revision]
    return "\n".join(lines)


def append_revision(db, message_id, revision, value, operation_id):
    db.execute("INSERT INTO release_card_revisions VALUES (?,?,?,?,?)",
               (message_id, revision, _json(value), _now_ms(), operation_id))


def card_value(db, message_id, revision=None):
    card = db.execute("SELECT * FROM release_cards WHERE message_id=?", (message_id,)).fetchone()
    if card is None:
        return None
    row = db.execute("SELECT * FROM release_card_revisions WHERE message_id=?" +
                     (" ORDER BY revision DESC LIMIT 1" if revision is None else " AND revision=?"),
                     (message_id,) if revision is None else (message_id, revision)).fetchone()
    if row is None:
        raise Refusal("RELEASE_CARD_REVISION_UNKNOWN", "That release card revision is unavailable")
    value = json.loads(row["payload"])
    first = json.loads(db.execute("SELECT payload FROM release_card_revisions WHERE message_id=? AND revision=1", (message_id,)).fetchone()[0])
    live = verified(db, value)
    return {"format": FORMAT, "message_id": message_id, "workspace_id": card["workspace_id"], "writer_id": card["writer_id"],
            "revision": row["revision"], "recorded_ms": row["recorded_ms"], "payload": value, "original_forecasts": first["forecasts"],
            "deployed_at": None if live is None else live["deployed_at"], "deployed_ms": None if live is None else live["deployed_ms"]}


def enrich(db, items):
    # Only the bounded requested page is visited. No per-topic history scan.
    for item in items:
        if item.get("withheld") or item.get("removal"):
            continue
        value = card_value(db, item.get("id", item.get("source_ref", {}).get("id")))
        if value is not None:
            item["release_card"] = value


class ReleaseCards:
    def _command_release_card_create(self, db, actor, envelope):
        args, target = envelope["args"], envelope["target"]
        if set(target) != {"topic_id"} or set(args) != {"payload", "divergence_reason"}:
            invalid("Create a release card in one topic with payload and divergence_reason")
        topic = self._topic(db, actor, target["topic_id"])
        self._refuse_if_closed(db, actor, topic["workspace_id"])
        value = validate(args["payload"])
        live = verified(db, value)
        if db.execute("SELECT 1 FROM release_cards WHERE workspace_id=? AND release=?", (topic["workspace_id"], value["release"])).fetchone():
            raise Refusal("RELEASE_CARD_EXISTS", "This workspace already keeps that release in one card")
        posted = dict(envelope, args={"body": render(value, 1, live), "divergence_reason": args["divergence_reason"]})
        result, affected = self._command_message_post(db, actor, posted)
        mid = result["message_id"]
        db.execute("INSERT INTO release_cards VALUES (?,?,?,?)", (mid, topic["workspace_id"], value["release"], actor))
        append_revision(db, mid, 1, value, envelope["operation_id"])
        return dict(result, revision=1, release_card=card_value(db, mid)), affected

    def _command_release_card_update(self, db, actor, envelope):
        args, target = envelope["args"], envelope["target"]
        if set(target) != {"message_id"} or set(args) != {"payload"}:
            invalid("Update one release card with its payload")
        mid = _identifier(target["message_id"], "message_id")
        token = editing.set(True)
        try:
            # Ordinary edit owns reach, author, closed, removal, revision and correction semantics.
            self._editable(db, actor, mid, people=False)
            old = card_value(db, mid)
            if old is None:
                raise Refusal("RELEASE_CARD_UNKNOWN", "This message is not a typed release card")
            value = validate(args["payload"])
            if value["release"] != old["payload"]["release"]:
                raise Refusal("RELEASE_CARD_IDENTITY", "A release card keeps its release number")
            previous = old["payload"]
            if previous["state"] in ("live", "measured") and (value["state"] not in ("live", "measured")
                    or value["commit"] != previous["commit"] or value["attempt_id"] != previous["attempt_id"]
                    or previous["state"] == "measured" and value["state"] != "measured"):
                raise Refusal("RELEASE_STATE_REGRESSION", "Verified Live and measured history cannot regress or change attempt")
            live = verified(db, value)
            revision = old["revision"] + 1
            result, affected = self._command_message_edit(db, actor, dict(envelope, args={"body": render(value, revision, live)}))
            append_revision(db, mid, revision, value, envelope["operation_id"])
        finally:
            editing.reset(token)
        return dict(result, release_card=card_value(db, mid)), affected

    def _release_card_access(self, db, actor, args):
        if "message_id" in args:
            if set(args) & {"workspace_id", "release"}:
                invalid("Choose a message identity or workspace and release")
            mid = _identifier(args["message_id"], "message_id")
        else:
            workspace = self._workspace(db, actor, _identifier(args.get("workspace_id"), "workspace_id"))
            number = args.get("release")
            if type(number) is not int or not 1 <= number <= 2 ** 31:
                invalid("Name a positive release number")
            row = db.execute("SELECT message_id FROM release_cards WHERE workspace_id=? AND release=?", (workspace["id"], number)).fetchone()
            if row is None:
                raise Refusal("RELEASE_CARD_UNKNOWN", "No readable release card has that identity")
            mid = row[0]
        source = self._source(db, actor, {"kind": "message", "id": mid})
        if source["withheld"]:
            raise Refusal("MESSAGE_HELD", "Its author is editing this message")
        if source.get("removal"):
            raise Refusal("MESSAGE_REMOVED", "This message was removed; its history is kept")
        if "release_card" not in source:
            raise Refusal("RELEASE_CARD_UNKNOWN", "This message is not a typed release card")
        return mid

    def _view_release_card(self, db, actor, args):
        mid = self._release_card_access(db, actor, args)
        revision = args.get("revision")
        if revision is not None and (type(revision) is not int or revision < 1):
            invalid("A card revision is a positive whole number")
        value = card_value(db, mid, revision)
        return {"instance_id": self.instance_id, "release_card": value,
                "body": mark(mid, value["revision"], render(value["payload"], value["revision"], verified(db, value["payload"]))) }

    def _view_release_card_history(self, db, actor, args):
        if "message_id" not in args:
            invalid("History names one message")
        mid = self._release_card_access(db, actor, args)
        limit = _page_size(args)
        cursor = args.get("cursor", 9223372036854775807)
        if type(cursor) is not int or cursor < 1:
            invalid("History cursor is a positive revision")
        rows = db.execute("SELECT revision FROM release_card_revisions WHERE message_id=? AND revision<? ORDER BY revision DESC LIMIT ?",
                          (mid, cursor, limit + 1)).fetchall()
        def item(row):
            value = card_value(db, mid, row["revision"])
            return dict(value, body=mark(mid, value["revision"], render(value["payload"], value["revision"], verified(db, value["payload"]))))
        return _bounded_page({"instance_id": self.instance_id, "message_id": mid}, rows, limit, item, "revision")

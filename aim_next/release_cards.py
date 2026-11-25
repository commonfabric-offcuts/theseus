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
PREFIX = "release_card.v1:"

def message_key(mid):
    return PREFIX + "message:" + mid

def identity_key(workspace, release):
    return PREFIX + "identity:" + _json([workspace, release])

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
    # Immutable command outcomes and message revisions retain old states. Only
    # this exact current-state index changes; there is no growing metadata list.
    key = message_key(message_id)
    row = db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
    current = json.loads(row[0])
    live = verified(db, value)
    kept = dict(current, revision=revision, payload=value, recorded_ms=_now_ms(),
                deployed_at=None if live is None else live["deployed_at"],
                deployed_ms=None if live is None else live["deployed_ms"])
    if revision == 1:
        kept["original_forecasts"] = value["forecasts"]
    db.execute("UPDATE metadata SET value=? WHERE key=?", (_json(kept), key))


def card_value(db, message_id):
    row = db.execute("SELECT value FROM metadata WHERE key=?", (message_key(message_id),)).fetchone()
    return None if row is None else json.loads(row[0])


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
        if db.execute("SELECT 1 FROM metadata WHERE key=?", (identity_key(topic["workspace_id"], value["release"]),)).fetchone():
            raise Refusal("RELEASE_CARD_EXISTS", "This workspace already keeps that release in one card")
        posted = dict(envelope, args={"body": render(value, 1, live), "divergence_reason": args["divergence_reason"]})
        result, affected = self._command_message_post(db, actor, posted)
        mid = result["message_id"]
        db.execute("INSERT INTO metadata VALUES (?,?)", (identity_key(topic["workspace_id"], value["release"]), _json(mid)))
        db.execute("INSERT INTO metadata VALUES (?,?)", (message_key(mid), _json({"format": FORMAT, "message_id": mid,
                   "workspace_id": topic["workspace_id"], "writer_id": actor})))
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
            row = db.execute("SELECT value FROM metadata WHERE key=?", (identity_key(workspace["id"], number),)).fetchone()
            if row is None:
                raise Refusal("RELEASE_CARD_UNKNOWN", "No readable release card has that identity")
            mid = json.loads(row[0])
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
        value = card_value(db, mid)
        return {"instance_id": self.instance_id, "release_card": value,
                "body": mark(mid, value["revision"], render(value["payload"], value["revision"], verified(db, value["payload"])))}

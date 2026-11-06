from __future__ import annotations

"""Release records: which commit each deploy put live, when, which pipeline items it shipped, and its measurements.

docs/releases.md is the contract. tools/deploy.py writes one record when a
deploy's verify has passed, through `bin/aim-next-admin record-release`; the
same verb records an older release retroactively. A record is the instance's
own fact about itself, so every member of the instance reads it, through the
`releases` view and `bin/aim-next releases`.

A record never changes once written: rows cannot be updated or deleted. The
same record written again (a retried deploy step, a backfill run twice) is
the record already there, not a second one; a different record for a number
or commit already recorded is refused, and so is an item an earlier record
already shipped.
"""

import datetime
import json
import re

from .contract import Refusal, _bounded_page, _json, _page_size


RELEASE_SCHEMA = [
    "CREATE TABLE releases (number INTEGER PRIMARY KEY CHECK(number>0), commit_sha TEXT NOT NULL UNIQUE, "
    "previous_sha TEXT, deployed_at TEXT NOT NULL, deployed_ms INTEGER NOT NULL, items TEXT NOT NULL, "
    "measurements TEXT, source TEXT NOT NULL CHECK(source IN ('deploy','backfill')), evidence TEXT, "
    "recorded_ms INTEGER NOT NULL)",
    "CREATE TRIGGER immutable_releases_update BEFORE UPDATE ON releases BEGIN SELECT RAISE(ABORT, 'immutable release'); END",
    "CREATE TRIGGER immutable_releases_delete BEFORE DELETE ON releases BEGIN SELECT RAISE(ABORT, 'immutable release'); END",
]
RELEASE_DOWN = ("DROP TABLE releases",)
RELEASE_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM releases)"

FIELDS = ("release", "commit", "previous", "deployed_at", "items", "measurements", "source", "evidence")
REQUIRED = ("commit", "deployed_at", "items", "source")
MAX_ITEMS = 500
MAX_ITEM = 99999
MAX_MEASUREMENTS_BYTES = 16384
MAX_EVIDENCE_BYTES = 1024
COMMIT = re.compile(r"[0-9a-f]{40}")


def _refuse(message):
    raise Refusal("INVALID_ARGUMENT", message)


def _number(value, name, top):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= top:
        _refuse("%s is a whole number from 1 to %d" % (name, top))
    return value


def _commit(value, name):
    if not isinstance(value, str) or not COMMIT.fullmatch(value):
        _refuse("%s is a full 40-character lowercase commit" % name)
    return value


def _moment(value):
    """(the time as written, epoch milliseconds); the time must name its offset from UTC.

    Only a string fromisoformat parses is stored, so its length is bounded by that format."""
    if not isinstance(value, str):
        _refuse("deployed_at is an ISO 8601 time with its offset")
    try:
        moment = datetime.datetime.fromisoformat(value)
    except ValueError:
        _refuse("deployed_at is an ISO 8601 time with its offset")
    if moment.utcoffset() is None:
        _refuse("deployed_at names its offset from UTC, so the time is not ambiguous")
    return value, int(round(moment.timestamp() * 1000))


def release_row(record):
    """The stored form of one record, or a refusal naming what is wrong. Pure: tools/deploy.py checks a record
    with it before stopping anything."""
    if not isinstance(record, dict):
        _refuse("A release record is a JSON object")
    unknown, missing = sorted(set(record) - set(FIELDS)), [key for key in REQUIRED if key not in record]
    if unknown or missing:
        _refuse("A release record has unknown fields %s or lacks %s" % (unknown, missing))
    number = record.get("release")
    if number is not None:
        _number(number, "release", 2 ** 31)
    previous = record.get("previous")
    items = record["items"]
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        _refuse("items is a list of at most %d pipeline item numbers" % MAX_ITEMS)
    for item in items:
        _number(item, "A pipeline item", MAX_ITEM)
    if len(set(items)) != len(items):
        _refuse("items names each pipeline item once")
    measurements = record.get("measurements")
    if measurements is not None and (not isinstance(measurements, dict)
                                     or len(_json(measurements).encode("utf-8")) > MAX_MEASUREMENTS_BYTES):
        _refuse("measurements is a JSON object of at most %d bytes, or null" % MAX_MEASUREMENTS_BYTES)
    if record["source"] not in ("deploy", "backfill"):
        _refuse("source is deploy or backfill")
    evidence = record.get("evidence")
    if evidence is not None and (not isinstance(evidence, str) or not evidence
                                 or len(evidence.encode("utf-8")) > MAX_EVIDENCE_BYTES):
        _refuse("evidence is a path of at most %d bytes, or null" % MAX_EVIDENCE_BYTES)
    deployed_at, deployed_ms = _moment(record["deployed_at"])
    return {"number": number, "commit_sha": _commit(record["commit"], "commit"),
            "previous_sha": None if previous is None else _commit(previous, "previous"),
            "deployed_at": deployed_at, "deployed_ms": deployed_ms, "items": _json(items),
            "measurements": None if measurements is None else _json(measurements),
            "source": record["source"], "evidence": evidence}


def release_item(row):
    """A stored row as the view and the admin verb show it."""
    return {"release": row["number"], "commit": row["commit_sha"], "previous": row["previous_sha"],
            "deployed_at": row["deployed_at"], "deployed_ms": row["deployed_ms"], "items": json.loads(row["items"]),
            "measurements": None if row["measurements"] is None else json.loads(row["measurements"]),
            "source": row["source"], "evidence": row["evidence"], "recorded_ms": row["recorded_ms"]}


SAME = ("commit_sha", "previous_sha", "deployed_at", "deployed_ms", "items", "measurements", "source", "evidence")


def write_release(db, record, now_ms):
    """Insert one record in the caller's write transaction: (the record, whether it was written now).

    A record without a number follows the latest; the first record names its own."""
    row = release_row(record)
    existing = db.execute("SELECT * FROM releases WHERE commit_sha=?", (row["commit_sha"],)).fetchone()
    if existing is not None:
        if all(existing[key] == row[key] for key in SAME) and row["number"] in (None, existing["number"]):
            return release_item(existing), False
        raise Refusal("RELEASE_EXISTS", "Release %d already records commit %s differently; a record never changes"
                      % (existing["number"], row["commit_sha"]))
    number = row["number"]
    if number is None:
        latest = db.execute("SELECT max(number) FROM releases").fetchone()[0]
        if latest is None:
            raise Refusal("RELEASE_NUMBER_REQUIRED", "This instance has no release records yet; the first one names its number")
        number = latest + 1
    elif db.execute("SELECT 1 FROM releases WHERE number=?", (number,)).fetchone():
        raise Refusal("RELEASE_EXISTS", "Release %d is already recorded for another commit" % number)
    shipped = {item: earlier for earlier, items in db.execute("SELECT number, items FROM releases")
               for item in json.loads(items)}
    for item in json.loads(row["items"]):
        if item in shipped:
            raise Refusal("ITEM_SHIPPED", "Pipeline item %d shipped in release %d; an item ships in one release"
                          % (item, shipped[item]))
    db.execute("INSERT INTO releases(number,commit_sha,previous_sha,deployed_at,deployed_ms,items,measurements,source,evidence,"
               "recorded_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (number, row["commit_sha"], row["previous_sha"], row["deployed_at"], row["deployed_ms"], row["items"],
                row["measurements"], row["source"], row["evidence"], now_ms))
    return release_item(db.execute("SELECT * FROM releases WHERE number=?", (number,)).fetchone()), True


class Releases:
    def _view_releases(self, db, actor, args):
        """The instance's release records, newest first; cursor is the last number a page showed."""
        limit = _page_size(args)
        cursor = args.get("cursor")
        rows = db.execute("SELECT * FROM releases" + (" WHERE number<?" if cursor is not None else "")
                          + " ORDER BY number DESC LIMIT ?", (() if cursor is None else (cursor,)) + (limit + 1,)).fetchall()
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, release_item, "release")

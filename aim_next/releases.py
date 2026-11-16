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

A release deployed from an ordinary merged train (items 481, 482), or on the
run of another commit whose tree is its own (item 588), says its hosted
judgment is pending. Once GitHub's judgment of its commit lands, the
operator attaches it (`bin/aim-next-admin attach-judgment`): a separate fact
beside the record, written once, which the record's view shows as
`hosted_judgment`; the record itself stays as it was written. A release deployed
on a scoped run (item 608), a small fix checked on only the browser steps its
files touch, says its full run is pending the same way, and takes that run's
judgment beside its record once it lands.
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
# Version 42: the hosted judgment attached to a release whose record says it is pending, once, never changed.
JUDGMENT_SCHEMA = [
    "CREATE TABLE release_judgments (number INTEGER PRIMARY KEY REFERENCES releases(number), judgment TEXT NOT NULL, "
    "recorded_ms INTEGER NOT NULL)",
    "CREATE TRIGGER immutable_judgments_update BEFORE UPDATE ON release_judgments BEGIN SELECT RAISE(ABORT, 'immutable judgment'); END",
    "CREATE TRIGGER immutable_judgments_delete BEFORE DELETE ON release_judgments BEGIN SELECT RAISE(ABORT, 'immutable judgment'); END",
]
JUDGMENT_DOWN = ("DROP TABLE release_judgments",)
JUDGMENT_OCCUPIED = "SELECT EXISTS (SELECT 1 FROM release_judgments)"
# Every record with the judgment attached to it, if any.
RECORDS = ("SELECT releases.*, release_judgments.judgment AS hosted_judgment FROM releases "
           "LEFT JOIN release_judgments ON release_judgments.number=releases.number")
JUDGMENT_FIELDS = ("head", "producer_runs", "verdict_checks", "audit")

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
    """A stored row, read through RECORDS, as the view and the admin verb show it."""
    return {"release": row["number"], "commit": row["commit_sha"], "previous": row["previous_sha"],
            "deployed_at": row["deployed_at"], "deployed_ms": row["deployed_ms"], "items": json.loads(row["items"]),
            "measurements": None if row["measurements"] is None else json.loads(row["measurements"]),
            "source": row["source"], "evidence": row["evidence"], "recorded_ms": row["recorded_ms"],
            "hosted_judgment": None if row["hosted_judgment"] is None else json.loads(row["hosted_judgment"])}


SAME = ("commit_sha", "previous_sha", "deployed_at", "deployed_ms", "items", "measurements", "source", "evidence")


def write_release(db, record, now_ms):
    """Insert one record in the caller's write transaction: (the record, whether it was written now).

    A record without a number follows the latest; the first record names its own."""
    row = release_row(record)
    existing = db.execute(RECORDS + " WHERE releases.commit_sha=?", (row["commit_sha"],)).fetchone()
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
    return release_item(db.execute(RECORDS + " WHERE releases.number=?", (number,)).fetchone()), True


def _judged(entries, name, commit):
    if not isinstance(entries, list) or not entries:
        _refuse("%s lists at least one run" % name)
    for entry in entries:
        if not isinstance(entry, dict) or isinstance(entry.get("id"), bool) or not isinstance(entry.get("id"), int):
            _refuse("each of %s is a JSON object with GitHub's id" % name)
        if entry.get("head_sha") != commit:
            raise Refusal("JUDGMENT_OF_ANOTHER_COMMIT", "%s %s names %r as its head, not the release's commit %s"
                          % (name, entry["id"], entry.get("head_sha"), commit))


def judgment_pending(measurements):
    """Whether a record's measurements say a judgment is attached afterwards: its own commit's hosted judgment, for an
    ordinary merged train's release (items 481, 482, "judgment": "pending") or one deployed on the run of another commit
    with its tree (`judged_tree`, item 588, "judgment": "pending"); or the full run of a release deployed on a scoped run
    (item 608, "full_judgment": "pending")."""
    measured = measurements if isinstance(measurements, dict) else {}
    train, judged, scoped = measured.get("train"), measured.get("judged_tree"), measured.get("scoped")
    return ((isinstance(train, dict) and train.get("kind") == "ordinary" and train.get("judgment") == "pending")
            or (isinstance(judged, dict) and judged.get("judgment") == "pending")
            or (isinstance(scoped, dict) and scoped.get("full_judgment") == "pending"))


def write_judgment(db, number, judgment, now_ms):
    """Attach the hosted judgment to release number, in the caller's write transaction: (the record, whether it was
    attached now). Only a release whose record says its judgment is pending (judgment_pending) takes one, and only of
    its own commit;
    the same judgment again is the one already attached, and another is refused."""
    _number(number, "release", 2 ** 31)
    row = db.execute(RECORDS + " WHERE releases.number=?", (number,)).fetchone()
    if row is None:
        raise Refusal("RELEASE_UNKNOWN", "No release %d is recorded" % number)
    if not judgment_pending(json.loads(row["measurements"]) if row["measurements"] is not None else None):
        raise Refusal("JUDGMENT_NOT_PENDING", "Release %d's record does not say its hosted judgment is pending; only an "
                      "ordinary merged train's release, one deployed on another commit's run with its tree, or one "
                      "deployed on a scoped run, takes one afterwards" % number)
    if not isinstance(judgment, dict) or set(judgment) != set(JUDGMENT_FIELDS):
        _refuse("A judgment is a JSON object with exactly %s" % ", ".join(JUDGMENT_FIELDS))
    commit = row["commit_sha"]
    if judgment["head"] != commit:
        raise Refusal("JUDGMENT_OF_ANOTHER_COMMIT", "The judgment is of %r, not release %d's commit %s"
                      % (judgment["head"], number, commit))
    _judged(judgment["producer_runs"], "producer_runs", commit)
    _judged(judgment["verdict_checks"], "verdict_checks", commit)
    if not isinstance(judgment["audit"], str) or not judgment["audit"].strip():
        _refuse("A judgment names its audit")
    stored = _json(judgment)
    if len(stored.encode("utf-8")) > MAX_MEASUREMENTS_BYTES:
        _refuse("A judgment is at most %d bytes" % MAX_MEASUREMENTS_BYTES)
    if row["hosted_judgment"] is not None:
        if row["hosted_judgment"] == stored:
            return release_item(row), False
        raise Refusal("RELEASE_JUDGED", "Release %d already has its hosted judgment; a judgment never changes" % number)
    db.execute("INSERT INTO release_judgments(number,judgment,recorded_ms) VALUES (?,?,?)", (number, stored, now_ms))
    return release_item(db.execute(RECORDS + " WHERE releases.number=?", (number,)).fetchone()), True


class Releases:
    def _view_releases(self, db, actor, args):
        """The instance's release records, newest first; cursor is the last number a page showed."""
        limit = _page_size(args)
        cursor = args.get("cursor")
        rows = db.execute(RECORDS + (" WHERE releases.number<?" if cursor is not None else "")
                          + " ORDER BY releases.number DESC LIMIT ?", (() if cursor is None else (cursor,)) + (limit + 1,)).fetchall()
        return _bounded_page({"instance_id": self.instance_id}, rows, limit, release_item, "release")

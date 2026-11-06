from __future__ import annotations

"""Explicit operator schema upgrades. Reads, commands and the server never migrate."""

from pathlib import Path
import sqlite3

from .authority import Authority, AuthorityError, GuardBusy
from .contract import StoreError, _identifier
from .openings import OPENING_SCHEMA
from .runner import HOSTED_DOWN, HOSTED_OCCUPIED, HOSTED_SCHEMA
from .topic_state import (ACTIVITY_DOWN, ACTIVITY_OCCUPIED, ACTIVITY_SCHEMA, ASK_WAIT_DOWN, ASK_WAIT_OCCUPIED, ASK_WAIT_SCHEMA,
                          TOPIC_STATE_DOWN, TOPIC_STATE_OCCUPIED, TOPIC_STATE_SCHEMA,
                          WAITING_ORDER_DOWN, WAITING_ORDER_SCHEMA)
from .conversation import (MESSAGE_INTENT_DOWN, MESSAGE_INTENT_OCCUPIED, MESSAGE_INTENT_SCHEMA,
                           MESSAGE_TIME_DOWN, MESSAGE_TIME_OCCUPIED, MESSAGE_TIME_SCHEMA,
                           UNANSWERED_BACKFILL, UNANSWERED_DOWN, UNANSWERED_OCCUPIED, UNANSWERED_SCHEMA,
                           WRITTEN_DOWN, WRITTEN_UPGRADE)
from .delivery import DELIVERY_TOPIC_BACKFILL, DELIVERY_TOPIC_DOWN, DELIVERY_TOPIC_SCHEMA
from .marks import MARK_DOWN, MARK_OCCUPIED, MARK_SCHEMA
from .work import WORK_DOWN, WORK_OCCUPIED, WORK_SCHEMA
from .colors import COLOR_DOWN, COLOR_OCCUPIED, COLOR_SCHEMA


# Ordered steps between adjacent stored versions: the upgrade, the step back,
# and a query that is true while the step back would drop someone's records.
STEPS = (
    ("8", "9", OPENING_SCHEMA, ("DROP TABLE openings",),
     "SELECT EXISTS (SELECT 1 FROM openings)"),
    ("9", "10", HOSTED_SCHEMA, HOSTED_DOWN, HOSTED_OCCUPIED),
    ("10", "11", TOPIC_STATE_SCHEMA, TOPIC_STATE_DOWN, TOPIC_STATE_OCCUPIED),
    # Version 12 times each message and orders what waits on each reader.
    ("11", "12", MESSAGE_TIME_SCHEMA + WAITING_ORDER_SCHEMA, WAITING_ORDER_DOWN + MESSAGE_TIME_DOWN, MESSAGE_TIME_OCCUPIED),
    # Version 13 keeps the messages each person marked unread.
    ("12", "13", MARK_SCHEMA, MARK_DOWN, MARK_OCCUPIED),
    # Version 14 records whether a message to someone asks or tells, and makes a topic wait on whoever it asks.
    ("13", "14", MESSAGE_INTENT_SCHEMA + ASK_WAIT_SCHEMA, ASK_WAIT_DOWN + MESSAGE_INTENT_DOWN,
     "SELECT (%s) OR (%s)" % (MESSAGE_INTENT_OCCUPIED, ASK_WAIT_OCCUPIED)),
    # Version 15 keeps the latest hosted turn in each topic, so a topic shows whether work is observed on it.
    ("14", "15", WORK_SCHEMA, WORK_DOWN, WORK_OCCUPIED),
    # Version 16 keeps where each reader's unanswered messages begin in each
    # topic, worked out from the messages, and indexes each message's replies.
    ("15", "16", UNANSWERED_SCHEMA + UNANSWERED_BACKFILL, UNANSWERED_DOWN, UNANSWERED_OCCUPIED),
    # Version 17 keeps the color each person chose for an agent.
    ("16", "17", COLOR_SCHEMA, COLOR_DOWN, COLOR_OCCUPIED),
    # Version 18 places the New line by what each reader has read: it keeps each
    # delivery's topic and indexes the pending ones by reader and topic. It
    # drops the reply index, which nothing reads any more, and keeps the reply
    # horizons as the record of who has written in each topic. Both are worked
    # out from the messages, so stepping back loses no record and works the
    # horizons out again.
    ("17", "18", WRITTEN_UPGRADE + tuple(DELIVERY_TOPIC_SCHEMA + DELIVERY_TOPIC_BACKFILL),
     DELIVERY_TOPIC_DOWN + WRITTEN_DOWN, "SELECT 0"),
    # Version 19 keeps each topic's activity time, so an outcome lists its topics
    # latest first, and the message that reopened a done topic.
    ("18", "19", ACTIVITY_SCHEMA, ACTIVITY_DOWN, ACTIVITY_OCCUPIED),
)


def unfinished(db, stored):
    """The statements that finish a step the stored stamp claims but the layout lacks, or ().

    The first form of the 11->12 step timed messages without ordering what waits
    on each reader, and stamped its databases 12 all the same. Such a database is
    known by its missing reader_waiting index; migrate finishes the step before
    moving it anywhere, and the store refuses it until then."""
    if stored == "12" and not db.execute("SELECT EXISTS (SELECT 1 FROM sqlite_master "
                                         "WHERE type='index' AND name='reader_waiting')").fetchone()[0]:
        return WAITING_ORDER_SCHEMA
    return ()


class MigrationError(AuthorityError):
    """A refused upgrade. Nothing was committed."""


def _busy(error):
    return isinstance(error, sqlite3.OperationalError) and ("locked" in str(error).lower() or "busy" in str(error).lower())


def _unconfirmed(error):
    return StoreError("The upgrade could not be confirmed; read schema_version, or run migrate again, which reports a completed upgrade")


def _versions():
    return [STEPS[0][0]] + [upgraded for _, upgraded, _, _, _ in STEPS]


def upgradable(stored):
    """Whether this code can move a database stored at that version up to its own."""
    from .store import SCHEMA_VERSION
    versions = _versions()
    return stored in versions and versions.index(stored) < versions.index(SCHEMA_VERSION)


def newer(stored):
    """Whether stored is a well-formed schema version later than this code's own."""
    from .store import SCHEMA_VERSION
    return (isinstance(stored, str) and stored.isascii() and stored.isdigit() and stored[0] != "0"
            and len(stored) <= 9 and int(stored) > int(SCHEMA_VERSION))


def _plan(stored, target):
    """The (statements, refusing query) pairs that move stored to target, in order."""
    versions = _versions()
    if stored not in versions or target not in versions or stored == target:
        raise MigrationError("SCHEMA_UNSUPPORTED", "This stored schema version has no path to the target; nothing was changed")
    start, end = versions.index(stored), versions.index(target)
    # One direction only: an older target never passes through a newer version.
    if start < end:
        return [(up, None) for _, _, up, _, _ in STEPS[start:end]]
    return [(down, occupied) for _, _, _, down, occupied in reversed(STEPS[end:start])]


def migrate(db_path, instance_id, binding, target=None):
    """Move one bound instance to target (default SCHEMA_VERSION) in a single transaction.

    A step back runs only while the newer version holds no records the older
    one cannot keep; the commit sequence still advances, never rewinds."""
    from .store import SCHEMA_VERSION, Store, _connect, commit_identity_intact
    _identifier(instance_id, "instance_id")
    target = SCHEMA_VERSION if target is None else target
    authority = Authority(Path(db_path).resolve(), instance_id, binding)
    try:
        # Holding the guard also keeps a runner from starting mid-upgrade.
        guard = authority.runner_guard("schema-migration").__enter__()
    except GuardBusy as error:
        raise MigrationError("RUNNER_GUARD_HELD", "A runner holds this authority; stop it before upgrading") from error
    db, committing = None, False
    try:
        db, _ = _connect(authority.db_path)
        db.execute("BEGIN IMMEDIATE")
        guard.verify()
        metadata = dict(db.execute("SELECT key,value FROM metadata WHERE key IN "
                                   "('instance_id','schema_version','commit_seq','commit_id','authority_id','authority_path','authority_epoch')"))
        if metadata.get("instance_id") != instance_id:
            raise MigrationError("INSTANCE_MISMATCH", "The selected instance does not match")
        # The same order as opening a store and as recovery: the version, then
        # the commit identity, then the binding, so one database gets one remedy.
        stored = metadata.get("schema_version")
        if newer(stored):
            raise MigrationError("SCHEMA_UNSUPPORTED", "This database is at schema version %s, which this code (version %s) "
                                 "cannot read or migrate; run code that reads version %s. Nothing was changed" % (stored, SCHEMA_VERSION, stored))
        # Advancing a damaged sequence would rewind it; such a database moves nowhere.
        if not commit_identity_intact(metadata):
            raise MigrationError("SCHEMA_UNSUPPORTED", "The stored commit identity is damaged; nothing was changed")
        if any(metadata.get(key) != value for key, value in authority.binding.items()):
            raise MigrationError("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")
        result = {"instance_id": instance_id, "from_version": stored, "schema_version": target}
        finish = unfinished(db, stored)
        if stored == target and not finish:
            return dict(result, migrated=False)
        for statements, occupied in [(finish, None)] + (_plan(stored, target) if stored != target else []):
            if occupied is not None and db.execute(occupied).fetchone()[0]:
                raise MigrationError("RECORDS_WOULD_BE_LOST", "The older version cannot hold records that exist; nothing was changed")
            for statement in statements:
                db.execute(statement)
        if db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (target,)).rowcount != 1:
            raise MigrationError("SCHEMA_UNSUPPORTED", "The stored schema version could not be replaced")
        Store._advance_commit_seq(db)
        # SQLite can report a failure after its commit point, so from here a
        # non-busy error leaves the outcome unconfirmed, never "nothing changed".
        committing = True
        db.commit()
        return dict(result, migrated=True)
    except AuthorityError:
        raise
    except (sqlite3.Error, StoreError) as error:
        if _busy(error):
            # A busy COMMIT has not reached its commit point; the rollback below undoes it.
            raise MigrationError("DATABASE_BUSY", "The instance is busy; nothing was changed", retryable=True) from error
        if committing:
            raise _unconfirmed(error) from error
        raise MigrationError("MIGRATION_FAILED", "The upgrade failed; nothing was changed") from error
    finally:
        try:
            if db is not None:
                if db.in_transaction:
                    db.rollback()
                db.close()
        except sqlite3.Error as error:
            raise _unconfirmed(error) from error
        finally:
            guard.close()

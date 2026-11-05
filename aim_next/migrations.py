from __future__ import annotations

"""Explicit operator schema upgrades. Reads, commands and the server never migrate."""

from pathlib import Path
import sqlite3

from .authority import Authority, AuthorityError, GuardBusy
from .contract import StoreError, _identifier
from .openings import OPENING_SCHEMA
from .runner import HOSTED_DOWN, HOSTED_OCCUPIED, HOSTED_SCHEMA
from .topic_state import TOPIC_STATE_DOWN, TOPIC_STATE_OCCUPIED, TOPIC_STATE_SCHEMA, WAITING_ORDER_DOWN, WAITING_ORDER_SCHEMA
from .conversation import MESSAGE_TIME_DOWN, MESSAGE_TIME_OCCUPIED, MESSAGE_TIME_SCHEMA


# Ordered steps between adjacent stored versions: the upgrade, the step back,
# and a query that is true while the step back would drop someone's records.
STEPS = (
    ("8", "9", OPENING_SCHEMA, ("DROP TABLE openings",),
     "SELECT EXISTS (SELECT 1 FROM openings)"),
    ("9", "10", HOSTED_SCHEMA, HOSTED_DOWN, HOSTED_OCCUPIED),
    ("10", "11", TOPIC_STATE_SCHEMA, TOPIC_STATE_DOWN, TOPIC_STATE_OCCUPIED),
    # Version 12 times each message and orders what waits on each reader.
    ("11", "12", MESSAGE_TIME_SCHEMA + WAITING_ORDER_SCHEMA, WAITING_ORDER_DOWN + MESSAGE_TIME_DOWN, MESSAGE_TIME_OCCUPIED),
)


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
    from .store import SCHEMA_VERSION, Store, _connect
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
                                   "('instance_id','schema_version','authority_id','authority_path','authority_epoch')"))
        if metadata.get("instance_id") != instance_id:
            raise MigrationError("INSTANCE_MISMATCH", "The selected instance does not match")
        if any(metadata.get(key) != value for key, value in authority.binding.items()):
            raise MigrationError("AUTHORITY_CHANGED", "Binding changed: activate a recovery copy at a new path")
        stored = metadata.get("schema_version")
        result = {"instance_id": instance_id, "from_version": stored, "schema_version": target}
        if stored == target:
            return dict(result, migrated=False)
        for statements, occupied in _plan(stored, target):
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

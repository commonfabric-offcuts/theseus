from __future__ import annotations

"""Explicit operator schema upgrades. Reads, commands and the server never migrate."""

from pathlib import Path
import sqlite3

from .authority import Authority, AuthorityError, GuardBusy
from .contract import StoreError, _identifier
from .openings import OPENING_SCHEMA


# Ordered steps; each upgrades exactly one stored version to the next.
STEPS = (
    ("8", "9", OPENING_SCHEMA),
)


class MigrationError(AuthorityError):
    """A refused upgrade. Nothing was committed."""


def _busy(error):
    return isinstance(error, sqlite3.OperationalError) and ("locked" in str(error).lower() or "busy" in str(error).lower())


def _unconfirmed(error):
    return StoreError("The upgrade could not be confirmed; read schema_version, or run migrate again, which reports a completed upgrade")


def _plan(stored):
    from .store import SCHEMA_VERSION
    plan, version = [], stored
    for source, target, statements in STEPS:
        if source == version:
            plan.append(statements)
            version = target
    if not plan or version != SCHEMA_VERSION:
        raise MigrationError("SCHEMA_UNSUPPORTED", "This stored schema version has no upgrade path; nothing was changed")
    return plan


def migrate(db_path, instance_id, binding):
    """Upgrade one bound instance to SCHEMA_VERSION in a single transaction."""
    from .store import SCHEMA_VERSION, Store, _connect
    _identifier(instance_id, "instance_id")
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
        result = {"instance_id": instance_id, "from_version": stored, "schema_version": SCHEMA_VERSION}
        if stored == SCHEMA_VERSION:
            return dict(result, migrated=False)
        for statements in _plan(stored):
            for statement in statements:
                db.execute(statement)
        if db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (SCHEMA_VERSION,)).rowcount != 1:
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

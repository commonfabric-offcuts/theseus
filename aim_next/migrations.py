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
from .delivery import (DELIVERY_GROUP_TOPIC_DOWN, DELIVERY_GROUP_TOPIC_UP, DELIVERY_TOPIC_BACKFILL, DELIVERY_TOPIC_DOWN,
                       DELIVERY_TOPIC_SCHEMA)
from .marks import MARK_DOWN, MARK_OCCUPIED, MARK_SCHEMA
from .work import (OTHERS_BACKFILL, OTHERS_DOWN, OTHERS_OCCUPIED, OTHERS_SCHEMA, TURN_ACTIVITY_BACKFILL, TURN_ACTIVITY_DOWN,
                   TURN_ACTIVITY_OCCUPIED, WORK_DOWN, WORK_OCCUPIED, WORK_SCHEMA)
from .colors import COLOR_DOWN, COLOR_OCCUPIED, COLOR_SCHEMA
from .memory import (MEMORY_DRAFT_DOWN, MEMORY_DRAFT_OCCUPIED, MEMORY_DRAFT_SCHEMA, MEMORY_READ_DOWN, MEMORY_READ_OCCUPIED,
                     MEMORY_READ_SCHEMA)
from .responsibility import RESPONSIBILITY_DOWN, RESPONSIBILITY_OCCUPIED, RESPONSIBILITY_SCHEMA
from .sources import SOURCE_DOWN, SOURCE_OCCUPIED, SOURCE_SCHEMA
from .wake_health import WAKE_HEALTH_DOWN, WAKE_HEALTH_OCCUPIED, WAKE_HEALTH_SCHEMA
from .releases import RELEASE_DOWN, RELEASE_OCCUPIED, RELEASE_SCHEMA
from .whispers import WHISPER_DOWN, WHISPER_OCCUPIED, WHISPER_SCHEMA
from .standing_conversation import SETTLE_ASKED_BACK, STANDING_DOWN, STANDING_OCCUPIED, STANDING_SCHEMA
from .pipeline import (PIPELINE_DECIDED_AGAIN_DOWN, PIPELINE_DECIDED_AGAIN_UP, PIPELINE_DOWN, PIPELINE_FACTS_BACKFILL, PIPELINE_FACTS_COUNT,
                       PIPELINE_FACTS_DOWN, PIPELINE_FACTS_SCHEMA, PIPELINE_OCCUPIED, PIPELINE_SCHEMA)
from .checks import CHECKS_DOWN, CHECKS_OCCUPIED, CHECKS_SCHEMA, PROBLEMS_SCHEMA
from .outcome_kind import KINDS_DOWN, KINDS_SCHEMA
from .health import HEALTH_BACKFILL, HEALTH_DOWN, HEALTH_OCCUPIED, HEALTH_SCHEMA
from .reactions import REACTION_DOWN, REACTION_OCCUPIED, REACTION_SCHEMA
from .outline_order import ORDER_DOWN, ORDER_OCCUPIED, ORDER_SCHEMA
from .stacks import ACT_DOWN, ACT_OCCUPIED, ACT_SCHEMA, FOLD_DOWN, FOLD_OCCUPIED, FOLD_UP, ASIDE_UP, ASIDE_DOWN, ASIDE_OCCUPIED
from .blocking import BLOCKS_DOWN, BLOCKS_OCCUPIED, BLOCKS_SCHEMA


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
    # Version 20 keeps the revision of each Notebook page each person last read.
    ("19", "20", MEMORY_READ_SCHEMA, MEMORY_READ_DOWN, MEMORY_READ_OCCUPIED),
    # Version 21 gives each participant's responsibility note a revision, and keeps the message each topic was started from.
    ("20", "21", RESPONSIBILITY_SCHEMA + SOURCE_SCHEMA, SOURCE_DOWN + RESPONSIBILITY_DOWN,
     "SELECT (%s) OR (%s)" % (RESPONSIBILITY_OCCUPIED, SOURCE_OCCUPIED)),
    # Version 22 counts the wakes each recipient left unanswered, so a silent agent stops being woken.
    ("21", "22", WAKE_HEALTH_SCHEMA, WAKE_HEALTH_DOWN, WAKE_HEALTH_OCCUPIED),
    # Version 23 keeps a record of each release: its commit, time, pipeline items and measurements.
    ("22", "23", RELEASE_SCHEMA, RELEASE_DOWN, RELEASE_OCCUPIED),
    # Version 24 keeps, beside each topic's latest message and turn, the latest
    # by someone else, so nobody's own activity is work they see.
    ("23", "24", OTHERS_SCHEMA + OTHERS_BACKFILL, OTHERS_DOWN, OTHERS_OCCUPIED),
    # Version 25 indexes the pending deliveries by group and topic, so the New
    # line reads only the reader's live groups, and refuses a delivery with no
    # topic. It settles each person's pending delivery of a message between
    # others, which is never unread for them. Stepping back puts the version-24
    # index back; what was settled stays settled, and nothing is lost.
    ("24", "25", DELIVERY_GROUP_TOPIC_UP, DELIVERY_GROUP_TOPIC_DOWN, "SELECT 0"),
    # Version 26 counts a hosted turn as activity in its topic, as a post is, so
    # the topic list, the work ring and the outcome light read the same
    # activity. Activity times are worked out from what is kept, so stepping
    # back loses nothing.
    ("25", "26", TURN_ACTIVITY_BACKFILL, TURN_ACTIVITY_DOWN, TURN_ACTIVITY_OCCUPIED),
    # Version 27 lets a person whisper to one agent: a message seen by those two
    # only. Once a whisper exists the step back is refused, since release 22
    # would show it to everyone.
    ("26", "27", WHISPER_SCHEMA, WHISPER_DOWN, WHISPER_OCCUPIED),
    # Version 28 gives each outcome its conversation: a topic of kind
    # `conversation`, its items and what became of each, and its open asks.
    # Older outcomes get theirs from the operator (conversation-start). Once a
    # conversation exists the step back is refused: release 22 would show it as
    # an ordinary topic and lose what became of its items.
    ("27", "28", STANDING_SCHEMA, STANDING_DOWN, STANDING_OCCUPIED),
    # Version 29 keeps each outcome's pipeline: its stages and numbered items,
    # where each came from, its pieces of work and their stage entries, every
    # placement and edit, the messages whose subject is an item, and the release
    # notes written by hand. Stepping back is refused once any of them exists.
    ("28", "29", PIPELINE_SCHEMA, PIPELINE_DOWN, PIPELINE_OCCUPIED),
    # Version 30 keeps each outcome's target and its checks, every run of them
    # and what it measured, the owner's allowances, the problems found before
    # a check caught them, and the outcome's kind and Reached (docs/targets.md).
    # It also keeps each outcome's pipeline facts, written from version 29's
    # pieces, moves and release records, from which what pieces hold, how each
    # ended and which topics the pipeline holds Done are derived (docs/pipeline.md,
    # "The derived state"); a piece's end can be decided again when a release
    # record overtakes a drop or a return to building. Stepping back keeps every
    # end and topic as it stands. Stepping back is refused once any of the rest
    # exists.
    ("29", "30", CHECKS_SCHEMA + PROBLEMS_SCHEMA + KINDS_SCHEMA + list(PIPELINE_DECIDED_AGAIN_UP) + PIPELINE_FACTS_SCHEMA
     + [PIPELINE_FACTS_BACKFILL, PIPELINE_FACTS_COUNT],
     list(PIPELINE_FACTS_DOWN) + list(PIPELINE_DECIDED_AGAIN_DOWN) + list(KINDS_DOWN) + list(CHECKS_DOWN), CHECKS_OCCUPIED),
    # Version 31 settles each conversation item an answerer answered by asking
    # its author back, which before it wrote no take and so stayed New. It
    # changes no layout; stepping back keeps the takes, which version 30 reads.
    ("30", "31", SETTLE_ASKED_BACK, (), "SELECT 0"),
    # Version 32 keeps, per recipient, when a wake last got through, how
    # many have not since and why the latest did not, and how the runner's
    # previous run ended, for the Health page (health.py). They are worked out
    # from settlements and exits, so stepping back loses no record; it is
    # refused once Theseus has posted a health notice.
    ("31", "32", HEALTH_SCHEMA + HEALTH_BACKFILL, HEALTH_DOWN, HEALTH_OCCUPIED),
    # Version 33 keeps each thumbs-up and go-ahead answer on a message, and
    # whether a message asks for a go-ahead. Stepping back is refused once any
    # of them exists.
    ("32", "33", REACTION_SCHEMA, REACTION_DOWN, REACTION_OCCUPIED),
    # Version 34 keeps the order each person placed their outcomes in, and
    # each outcome's topics, for themselves. Stepping back is refused once
    # anyone has placed one.
    ("33", "34", ORDER_SCHEMA, ORDER_DOWN, ORDER_OCCUPIED),
    # Version 35 keeps what people record about messages as they read them in
    # reply stacks: their own stars, stacks dealt with and stack order, and
    # each stack's short name and joins, which are everyone's. Stepping back is
    # refused once anyone has recorded one.
    ("34", "35", ACT_SCHEMA, ACT_DOWN, ACT_OCCUPIED),
    # Version 36 keeps what an ask blocks: the one pipeline piece or release
    # that cannot go on until it is answered. A message keeps it as written,
    # so stepping back is refused once any ask has named one.
    ("35", "36", BLOCKS_SCHEMA, BLOCKS_DOWN, BLOCKS_OCCUPIED),
    # Version 37 lets a reader fold a message for themselves, so the acts
    # about messages take a sixth kind. The table is built again with every
    # act, its id and where the next id goes on from. Stepping back is
    # refused once anyone has folded a message, even one unfolded since.
    ("36", "37", FOLD_UP, FOLD_DOWN, FOLD_OCCUPIED),
    ("37", "38", ASIDE_UP, ASIDE_DOWN, ASIDE_OCCUPIED),
    # Version 39 keeps whether each Notebook revision's writer marked the page a
    # draft, which no agent is given the words of. Stepping back is refused once
    # any revision has been marked, since version 38 would give agents its words.
    ("38", "39", MEMORY_DRAFT_SCHEMA, MEMORY_DRAFT_DOWN, MEMORY_DRAFT_OCCUPIED),
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
                if callable(statement):
                    # A step that works facts out by a rule in Python (health.py's backfill) passes the rule itself.
                    statement(db)
                else:
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

from __future__ import annotations

import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import time
import unittest
from unittest import mock

from aim_next import admin, conversation, migrations, recovery_io
from aim_next import standing_conversation as standing
from aim_next import store as store_module
from aim_next.authority import Authority, AuthorityError
from aim_next.contract import StoreError, _json
from aim_next.invite import invite
from aim_next.migrations import MigrationError, migrate as migrate_store
from aim_next.profile import load_profile, write_profile
from aim_next.store import SCHEMA_VERSION, Store, StoreOpenError
from aim_next.validation import _command_envelope
import test_store as fixtures


def migrate(path, instance, binding, target=None):
    """Historical-step fixtures explicitly discard 731 positions before testing older downgrade rules.

    The real 49 downgrade refusal and preserved ordering are checked, without
    this fixture preparation, in test_dossier_order.py. No product gate is bypassed.
    """
    result = migrate_store(path, instance, binding, target)
    if result['schema_version'] == '49':
        with sqlite3.connect(str(path)) as db:
            if db.execute("SELECT 1 FROM dossier_order LIMIT 1").fetchone():
                db.execute("DELETE FROM dossier_order")
    return result


SCHEMA_8 = (Path(__file__).parent / "fixtures" / "schema_8.sql").read_text().splitlines()
SCHEMA_9 = (Path(__file__).parent / "fixtures" / "schema_9.sql").read_text().splitlines()
SCHEMA_10 = (Path(__file__).parent / "fixtures" / "schema_10.sql").read_text().splitlines()
SCHEMA_11 = (Path(__file__).parent / "fixtures" / "schema_11.sql").read_text().splitlines()
# Version 12 as its step first stood: messages timed, what waits on each reader not yet ordered.
SCHEMA_12_EARLY = (Path(__file__).parent / "fixtures" / "schema_12_early.sql").read_text().splitlines()
SCHEMA_12 = (Path(__file__).parent / "fixtures" / "schema_12.sql").read_text().splitlines()
SCHEMA_13 = (Path(__file__).parent / "fixtures" / "schema_13.sql").read_text().splitlines()
SCHEMA_14 = (Path(__file__).parent / "fixtures" / "schema_14.sql").read_text().splitlines()
SCHEMA_15 = (Path(__file__).parent / "fixtures" / "schema_15.sql").read_text().splitlines()
SCHEMA_16 = (Path(__file__).parent / "fixtures" / "schema_16.sql").read_text().splitlines()
SCHEMA_17 = (Path(__file__).parent / "fixtures" / "schema_17.sql").read_text().splitlines()
SCHEMA_18 = (Path(__file__).parent / "fixtures" / "schema_18.sql").read_text().splitlines()
SCHEMA_19 = (Path(__file__).parent / "fixtures" / "schema_19.sql").read_text().splitlines()
SCHEMA_20 = (Path(__file__).parent / "fixtures" / "schema_20.sql").read_text().splitlines()
SCHEMA_21 = (Path(__file__).parent / "fixtures" / "schema_21.sql").read_text().splitlines()
SCHEMA_22 = (Path(__file__).parent / "fixtures" / "schema_22.sql").read_text().splitlines()
SCHEMA_23 = (Path(__file__).parent / "fixtures" / "schema_23.sql").read_text().splitlines()
SCHEMA_24 = (Path(__file__).parent / "fixtures" / "schema_24.sql").read_text().splitlines()
SCHEMA_25 = (Path(__file__).parent / "fixtures" / "schema_25.sql").read_text().splitlines()
# Release 22's layout, read from a fresh instance of its code: version 26 changed no layout.
SCHEMA_26 = (Path(__file__).parent / "fixtures" / "schema_26.sql").read_text().splitlines()
# Whispers' layout, read from a fresh instance of its code (3c7730f).
SCHEMA_27 = (Path(__file__).parent / "fixtures" / "schema_27.sql").read_text().splitlines()
# The pipeline's step (item 84): the version it starts from and the one it makes,
# named here once, so a renumbering of the step changes only these two and the
# fixture's file name. It follows the conversation's step, so the layout before
# it is version 28's, read from a fresh instance of the conversation's code (32d5e0e).
BEFORE_PIPELINE, PIPELINE_VERSION = "28", "29"
SCHEMA_BEFORE_PIPELINE = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_PIPELINE)).read_text().splitlines()
# The step of an outcome's target, checks, kind and Reached (items 14, 104, 12),
# named the same way: the version it starts from (the pipeline's) and the one it
# makes. A renumbering of the step changes only these two and the fixture's file name.
BEFORE_CHECKS, CHECKS_VERSION = PIPELINE_VERSION, "30"
SCHEMA_BEFORE_CHECKS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_CHECKS)).read_text().splitlines()
# The step that settles each conversation item an answerer's asking reply left
# New: the version it starts from and the one it makes, named here once, so a
# renumbering of the step changes only these two and the fixture's file name.
# It changes no layout, so the layout before it is the checks', read from a
# fresh instance of release 27's code (63521cd).
BEFORE_SETTLE, SETTLE_VERSION = CHECKS_VERSION, "31"
SCHEMA_BEFORE_SETTLE = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_SETTLE)).read_text().splitlines()
# The Health page's step keeps wake facts, the hosted turns still running and the
# runner's previous end. It follows the settling step, which changes no layout, so
# the layout before it is the settling step's.
BEFORE_HEALTH, HEALTH_VERSION = SETTLE_VERSION, str(int(SETTLE_VERSION) + 1)
SCHEMA_BEFORE_HEALTH = SCHEMA_BEFORE_SETTLE
# The reactions' step (thumbs-up and go-ahead answers on a message) follows the
# Health page's, so the layout before it is version 32's, read from a fresh
# instance of release 31's code (e1879db). Named here once, so a renumbering of
# the step changes only these two and the fixture's file name.
BEFORE_REACTIONS, REACTION_VERSION = HEALTH_VERSION, str(int(HEALTH_VERSION) + 1)
SCHEMA_BEFORE_REACTIONS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_REACTIONS)).read_text().splitlines()
# The step of each person's own order of their outcomes and topics follows the
# reactions', so the layout before it is version 33's, read from a fresh
# instance of release 34's code (801085f). Named here once, so a renumbering of
# the step changes only these two and the fixture's file name.
BEFORE_ORDER, ORDER_VERSION = REACTION_VERSION, str(int(REACTION_VERSION) + 1)
SCHEMA_BEFORE_ORDER = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_ORDER)).read_text().splitlines()
# The step of what people record about messages in reply stacks follows the
# order's, so the layout before it is version 34's, read from a fresh instance
# of the order's code (e2d0b79).
BEFORE_STACKS, STACKS_VERSION = ORDER_VERSION, str(int(ORDER_VERSION) + 1)
SCHEMA_BEFORE_STACKS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_STACKS)).read_text().splitlines()
# The step that keeps what an ask blocks (item 259) follows the stacks', so the
# layout before it is version 35's, read from a fresh instance of release 45's
# code (876b8c0). Named here once, so a renumbering of the step changes only
# these two and the fixture's file name.
BEFORE_BLOCKS, BLOCKS_VERSION = STACKS_VERSION, str(int(STACKS_VERSION) + 1)
SCHEMA_BEFORE_BLOCKS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_BLOCKS)).read_text().splitlines()
# The step that lets a reader fold a message for themselves (item 356) follows
# the blocks', so the layout before it is version 36's, read from a fresh
# instance of release 56's code (89560d9). It widens the kinds message_acts
# takes, which SQLite changes only by building the table again. Named here
# once, so a renumbering of the step changes only these two and the fixture's
# file name.
BEFORE_FOLD, FOLD_VERSION = BLOCKS_VERSION, str(int(BLOCKS_VERSION) + 1)
SCHEMA_BEFORE_FOLD = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_FOLD)).read_text().splitlines()
# Version 37 layout from approved 356 (a75954a), carried unchanged in 7e2aaae.
SCHEMA_37 = (Path(__file__).parent / "fixtures" / "schema_37.sql").read_text().splitlines()
# The step that marks a Notebook revision a draft (items 371, 383, 391) follows
# 355's step (37->38, a reader's dossier set aside below More), so the layout
# before it is version 38's, read from a fresh instance of release 69's
# integration (ecb692d4). Named here once, so a renumbering of the step changes
# only these two and the fixture's file name.
BEFORE_DRAFT, DRAFT_VERSION = str(int(FOLD_VERSION) + 1), str(int(FOLD_VERSION) + 2)
SCHEMA_BEFORE_DRAFT = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_DRAFT)).read_text().splitlines()
# The step that lets a person edit their own message (item 228) follows the draft's, so the layout before it is
# version 39's, read from a fresh instance of release 71's code (7d706c7d). Named here once, so a renumbering of the
# step changes only these two and the fixture's file name.
BEFORE_EDIT, EDIT_VERSION = DRAFT_VERSION, str(int(DRAFT_VERSION) + 1)
SCHEMA_BEFORE_EDIT = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_EDIT)).read_text().splitlines()
# The step that keeps each message's edit session, what agents were handed and the horizon (item 452) follows the
# edit's, so the layout before it is version 40's, read from a fresh instance of release 72's code (ee7e51e6).
BEFORE_SESSION, SESSION_VERSION = EDIT_VERSION, str(int(EDIT_VERSION) + 1)
SCHEMA_BEFORE_SESSION = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_SESSION)).read_text().splitlines()
# The step that keeps the hosted judgment attached to a release (items 481, 482) follows the session's, so the
# layout before it is version 41's, read from a fresh instance of the live code at release/live73's 1795a758. Named
# here once, so a renumbering of the step changes only these two and the fixture's file name.
BEFORE_JUDGMENT, JUDGMENT_VERSION = SESSION_VERSION, str(int(SESSION_VERSION) + 1)
SCHEMA_BEFORE_JUDGMENT = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_JUDGMENT)).read_text().splitlines()
# The step that keeps who invited each agent into which outcome (item 525) follows the judgment's, so the layout
# before it is version 42's, read from a fresh instance of release 81's code (e73e6e1e), where 324 went live.
BEFORE_INVITES, INVITES_VERSION = JUDGMENT_VERSION, str(int(JUDGMENT_VERSION) + 1)
SCHEMA_BEFORE_INVITES = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_INVITES)).read_text().splitlines()
# The step that keeps what is said about skills and tools (item 17) follows the invitations', so the layout before it is
# version 43's, read from a fresh instance of train 21's code (756c298e), the base 17 was built on.
BEFORE_TOOLS, TOOLS_VERSION = INVITES_VERSION, str(int(INVITES_VERSION) + 1)
SCHEMA_BEFORE_TOOLS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_TOOLS)).read_text().splitlines()
TOOL_TABLES = ("tool_uses", "tool_links", "tool_runs")
# The step that keeps each outcome's ends, archived, completed or brought back (item 404), was built on 43 beside the
# tools' step and landed after it, so it follows the tools' step: the layout before it is version 44's, read from a
# fresh instance of train 27's code (bd9f2f9c), where the tools' step is live.
BEFORE_ENDS, ENDS_VERSION = TOOLS_VERSION, str(int(TOOLS_VERSION) + 1)
SCHEMA_BEFORE_ENDS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_ENDS)).read_text().splitlines()
# The step that lets the acts about messages hold a dossier's cover (item 624) follows the ends', so the layout before it
# is version 45's, read from a fresh instance of train 28's code (d8857386), the base 624 was built on.
BEFORE_COVERS, COVERS_VERSION = ENDS_VERSION, str(int(ENDS_VERSION) + 1)
SCHEMA_BEFORE_COVERS = (Path(__file__).parent / "fixtures" / ("schema_%s.sql" % BEFORE_COVERS)).read_text().splitlines()
# Version 45's acts table, then its indexes, as the fixture keeps them.
ACTS_BEFORE_COVERS = sorted((line.rstrip(";") for line in SCHEMA_BEFORE_COVERS if line.startswith("CREATE TABLE message_acts ")
                             or " ON message_acts(" in line), key=lambda line: not line.startswith("CREATE TABLE"))
DELIVERIES_BEFORE_EDIT = ("CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL REFERENCES messages(id), "
                          "recipient_id TEXT NOT NULL REFERENCES actors(id), group_id INTEGER NOT NULL REFERENCES delivery_groups(id), "
                          "state TEXT NOT NULL DEFAULT 'pending', topic_id TEXT, UNIQUE(message_id,recipient_id))")
OLD_ACTS = ("CREATE TABLE message_acts (id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "kind TEXT NOT NULL CHECK(kind IN ('star','deal','place','name','join')), "
            "message_id TEXT NOT NULL REFERENCES messages(id), topic_id TEXT NOT NULL REFERENCES topics(id), seq INTEGER NOT NULL, "
            "owner TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), value TEXT NOT NULL, at_ms INTEGER NOT NULL, "
            "revision INTEGER NOT NULL CHECK(revision>0), UNIQUE(message_id,kind,owner,revision))")
TABLES = ("actors", "workspaces", "workspace_members", "topics", "topic_participants", "topic_summaries",
          "messages", "deliveries", "delivery_reasons", "delivery_groups", "operations", "changes",
          "drafts", "submissions", "metadata")


def schema(path):
    with sqlite3.connect(str(path)) as db:
        return sorted(row[0] for row in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))


def frozen(statements):
    return sorted(statement.rstrip(";") for statement in statements)


SCHEMA_46 = (Path(__file__).parent / "fixtures" / "schema_46.sql").read_text().splitlines()
SCHEMA_47 = (Path(__file__).parent / "fixtures" / "schema_47.sql").read_text().splitlines()
SCHEMA_48 = (Path(__file__).parent / "fixtures" / "schema_48.sql").read_text().splitlines()


def step_back_by_hand(path, version):
    """Recover an older stored layout from a fresh instance with plain SQL, independent of migrations.py.

    "12-early" is the layout the first form of the 11->12 step left, stamped 12."""
    with sqlite3.connect(str(path)) as db:
        # 1002's tables are empty here and absent from every frozen historical
        # layout. Its real upgrade and occupied downgrade have separate checks.
        db.execute("DROP TABLE hosted_seat_events")
        db.execute("DROP TABLE hosted_seats")
        # 987's append-only freeze table is absent from every historical layout
        # this fixture reconstructs (48 and earlier). Its real 60<->61 migration
        # and occupied-table refusal are exercised in test_gauntlet_987.py.
        db.execute("DROP TABLE pipeline_piece_freezes")
        db.execute("DROP TABLE dossier_order")
        if version == "48":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Item 738 adds the 48th step. Recover 47's act constraint using the
        # independently frozen schema-46 definition (unchanged in 47), retaining
        # every old act and its next ID. No production migration is called here.
        db.execute("DROP TABLE cover_writers")
        sequence = db.execute("SELECT seq FROM sqlite_sequence WHERE name='message_acts'").fetchone()
        db.execute("CREATE TEMP TABLE kept_refresh_acts AS SELECT * FROM message_acts")
        db.execute("DROP TABLE message_acts")
        db.execute(next(sql for sql in SCHEMA_46 if sql.startswith("CREATE TABLE message_acts ")))
        db.execute("INSERT INTO message_acts SELECT * FROM kept_refresh_acts")
        db.execute("DROP TABLE kept_refresh_acts")
        db.execute("DELETE FROM sqlite_sequence WHERE name='message_acts'")
        if sequence:
            db.execute("INSERT INTO sqlite_sequence(name,seq) VALUES ('message_acts',?)", sequence)
        for statement in SCHEMA_46:
            if statement.startswith("CREATE INDEX ") and " ON message_acts(" in statement:
                db.execute(statement)
        if version == "47":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 47 keeps derived stable topic positions, independently checked below.
        db.execute("DROP TRIGGER topic_position_insert")
        db.execute("DROP TABLE topic_position_clock")
        db.execute("DROP INDEX workspace_topic_order")
        db.execute("ALTER TABLE topics DROP COLUMN list_position")
        db.execute("CREATE INDEX workspace_topic_order ON topics(workspace_id,archived,state='done',activity_ms DESC,id DESC)")
        if version == "46":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The covers' version lets message_acts hold a dossier's cover, and finds the covers a message delivered the
        # payload of: before it, the table names seven kinds.
        db.execute("DROP TABLE message_acts")
        for statement in ACTS_BEFORE_COVERS:
            db.execute(statement)
        if version == BEFORE_COVERS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The ends' version keeps each outcome's ends: before it, every outcome is open.
        db.execute("DROP TABLE outcome_ends")
        if version == BEFORE_ENDS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The tools' version keeps what is said about skills and tools: before it, nothing is.
        for table in reversed(TOOL_TABLES):
            db.execute("DROP TABLE " + table)
        if version == BEFORE_TOOLS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The invitations' version keeps who invited each agent into which outcome: before it, no one is known to have.
        db.execute("DROP TABLE agent_invitations")
        if version == BEFORE_INVITES:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The judgment's version keeps the hosted judgment attached to a release beside its record.
        db.execute("DROP TABLE release_judgments")
        if version == BEFORE_JUDGMENT:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The session's version keeps each message's edit session, what each agent was handed of a person's message,
        # and the horizon: before it, none of them exists.
        db.execute("DROP TABLE message_edit_sessions")
        db.execute("DROP TABLE message_exposures")
        db.execute("DROP TABLE message_edit_horizon")
        if version == BEFORE_SESSION:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The edit's version keeps each message's later revisions and each delivery's revision: before it, a
        # message is delivered to someone once.
        db.execute("DROP TABLE message_revisions")
        db.execute("CREATE TABLE kept AS SELECT seq,id,message_id,recipient_id,group_id,state,topic_id FROM deliveries")
        db.execute("CREATE TABLE kept_sequence AS SELECT seq FROM sqlite_sequence WHERE name='deliveries'")
        db.execute("DROP TABLE deliveries")
        db.execute(DELIVERIES_BEFORE_EDIT)
        db.execute("INSERT INTO deliveries SELECT * FROM kept")
        db.execute("DELETE FROM sqlite_sequence WHERE name='deliveries'")
        db.execute("INSERT INTO sqlite_sequence(name,seq) SELECT 'deliveries',seq FROM kept_sequence")
        db.execute("DROP TABLE kept")
        db.execute("DROP TABLE kept_sequence")
        db.execute("CREATE INDEX recipient_deliveries ON deliveries(recipient_id,state,seq)")
        db.execute("CREATE INDEX pending_group_deliveries ON deliveries(group_id,seq) WHERE state='pending'")
        db.execute("CREATE INDEX pending_group_topic_deliveries ON deliveries(group_id,topic_id,seq) WHERE state='pending'")
        db.execute("CREATE TRIGGER delivery_topic_required BEFORE INSERT ON deliveries WHEN NEW.topic_id IS NULL "
                   "BEGIN SELECT RAISE(ABORT, 'a delivery names its topic'); END")
        if version == BEFORE_EDIT:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The draft's version marks a Notebook revision a draft: before it, a revision has no mark.
        db.execute("ALTER TABLE memory_revisions DROP COLUMN draft")
        if version == BEFORE_DRAFT:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        db.execute("DROP INDEX IF EXISTS stack_replies")
        # The fold's version lets message_acts hold a fold: before it, the table names five kinds.
        db.execute("DROP TABLE message_acts")
        db.execute(OLD_ACTS)
        db.execute("CREATE INDEX topic_acts ON message_acts(topic_id,seq)")
        db.execute("CREATE INDEX reader_stars ON message_acts(owner,kind,id)")
        if version == BEFORE_FOLD:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The blocks' version keeps what an ask blocks.
        db.execute("DROP TABLE message_blocks")
        if version == BEFORE_BLOCKS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The stacks' version keeps each star, short name, join, place and dealt-with mark.
        db.execute("DROP TABLE message_acts")
        if version == BEFORE_STACKS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The order's version keeps each person's own order of their outcomes and topics.
        db.execute("DROP TABLE outline_orders")
        if version == BEFORE_ORDER:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The reactions' version keeps each thumbs-up and go-ahead answer, and
        # whether a message asks for a go-ahead.
        db.execute("ALTER TABLE messages DROP COLUMN go_ahead")
        db.execute("DROP INDEX message_reaction_rows")
        db.execute("DROP TABLE message_reactions")
        if version == BEFORE_REACTIONS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The Health page's version keeps each recipient's wake facts and its hosted turns
        # still running, the runner's previous end, what Theseus last announced and its own member.
        db.execute("DROP TABLE runner_prior")
        db.execute("DROP TABLE wake_turns")
        db.execute("DROP TABLE wake_facts")
        db.execute("DELETE FROM metadata WHERE key IN ('health_announced','health_due')")
        db.execute("DELETE FROM actors WHERE id='theseus'")
        if version == BEFORE_HEALTH:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The settling step changes no layout and keeps every row.
        if version == BEFORE_SETTLE:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The checks' version keeps each outcome's target, its checks, their runs and
        # readings, the owner's allowances, the problems found, and each outcome's kind and Reached.
        for table in ("outcome_reached", "outcome_kinds", "found_problems", "check_allowances", "check_readings", "check_runs",
                      "outcome_checks", "outcome_target_revisions", "outcome_targets"):
            db.execute("DROP TABLE " + table)
        # It also keeps each outcome's pipeline facts and the topics the pipeline holds Done, lets a record overtaking
        # a drop decide a piece's end again, and lets a record leave a stage on the owner's word; before it, a left entry
        # kept everything and only the owner left such a stage.
        db.execute("DROP TRIGGER entries_leave_by_the_owner")
        db.execute("CREATE TRIGGER entries_leave_by_the_owner BEFORE UPDATE OF left_ms ON pipeline_stage_entries "
                   "WHEN NEW.left_ms IS NOT NULL "
                   "AND (SELECT json_extract(gate,'$.owner') FROM pipeline_stages WHERE workspace_id=OLD.workspace_id AND stage_id=OLD.stage_id) "
                   "AND NEW.left_by IS NOT (SELECT owner_id FROM workspaces WHERE id=OLD.workspace_id) "
                   "BEGIN SELECT RAISE(ABORT, 'STAGE_GATED'); END")
        db.execute("DROP TABLE pipeline_done_topics")
        db.execute("DROP TABLE pipeline_facts")
        db.execute("DROP TRIGGER entries_keep_their_past")
        db.execute("CREATE TRIGGER entries_keep_their_past BEFORE UPDATE ON pipeline_stage_entries "
                   "WHEN OLD.left_ms IS NOT NULL OR NEW.seq IS NOT OLD.seq OR NEW.piece_id IS NOT OLD.piece_id OR NEW.stage_id IS NOT OLD.stage_id "
                   "OR NEW.round IS NOT OLD.round OR NEW.size IS NOT OLD.size OR NEW.entered_ms IS NOT OLD.entered_ms OR NEW.entered_by IS NOT OLD.entered_by "
                   "OR NEW.ask_message_id IS NOT OLD.ask_message_id BEGIN SELECT RAISE(ABORT, 'a stage entry keeps its past'); END")
        if version == BEFORE_CHECKS:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # The pipeline's version keeps each outcome's pipeline, its stages, items,
        # pieces and their entries, every event, message subjects and release notes.
        for table in ("release_notes", "pipeline_events", "pipeline_item_sources", "message_subjects", "pipeline_stage_entries",
                      "pipeline_piece_members", "pipeline_pieces", "pipeline_items", "pipeline_stages", "pipelines"):
            db.execute("DROP TABLE " + table)
        if version == BEFORE_PIPELINE:
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 28 gives each outcome its conversation. No outcome had one before, so the
        # conversation each outcome starts with today goes, with every row about it.
        conversations = [row[0] for row in db.execute("SELECT id FROM topics WHERE kind='conversation'")]
        for table in [row[0] for row in db.execute("SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c "
                                                   "WHERE m.type='table' AND c.name='topic_id'")]:
            db.executemany("DELETE FROM " + table + " WHERE topic_id=?", [(topic,) for topic in conversations])
        db.executemany("DELETE FROM changes WHERE resource_id=? OR scope_id=?", [(topic, topic) for topic in conversations])
        db.executemany("DELETE FROM topics WHERE id=?", [(topic,) for topic in conversations])
        db.execute("DROP TABLE conversation_waits")
        db.execute("DROP TABLE conversation_takes")
        db.execute("DROP TABLE conversation_items")
        db.execute("ALTER TABLE messages DROP COLUMN about_id")
        db.execute("ALTER TABLE topics DROP COLUMN replaced_by")
        db.execute("DROP INDEX outcome_conversation")
        db.execute("ALTER TABLE topics DROP COLUMN kind")
        if version == "27":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 27 lets a person whisper to one agent: who a message is private to,
        # the index of each message's replies, and the trigger that keeps a whisper's shape.
        db.execute("DROP TRIGGER whisper_shape")
        db.execute("DROP INDEX message_reply_links")
        db.execute("ALTER TABLE messages DROP COLUMN private_to")
        # Version 26 counts a hosted turn as activity in its topic; the layout is version 25's.
        if version in ("26", "25"):
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 25 indexes the pending deliveries by group and topic instead of
        # by reader and topic, and refuses a delivery with no topic.
        db.execute("DROP TRIGGER delivery_topic_required")
        db.execute("DROP INDEX pending_group_topic_deliveries")
        db.execute("CREATE INDEX pending_topic_deliveries ON deliveries(recipient_id,topic_id,seq) WHERE state='pending'")
        if version == "24":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 24 keeps the latest message and turn by someone else beside each topic's latest.
        db.execute("ALTER TABLE topic_turns DROP COLUMN other_by")
        db.execute("ALTER TABLE topic_turns DROP COLUMN other_ms")
        db.execute("ALTER TABLE topic_summaries DROP COLUMN other_message_id")
        if version == "23":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 23 keeps a record of each release.
        db.execute("DROP TABLE releases")
        if version == "22":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 22 counts the wakes each recipient left unanswered, and keeps when the runner stopped.
        db.execute("ALTER TABLE runner_state DROP COLUMN ended_ms")
        db.execute("ALTER TABLE recipient_schedule DROP COLUMN named_seq")
        db.execute("ALTER TABLE recipient_schedule DROP COLUMN unanswered_since_ms")
        db.execute("ALTER TABLE recipient_schedule DROP COLUMN unanswered_wakes")
        if version == "21":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 21 gives each participant's responsibility note a revision, and keeps the message each topic was started from.
        db.execute("DROP INDEX topic_sources")
        db.execute("ALTER TABLE topics DROP COLUMN source_message_id")
        db.execute("ALTER TABLE topic_participants DROP COLUMN responsibility_revision")
        if version == "20":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 20 keeps the revision of each Notebook page each person last read.
        db.execute("DROP TABLE memory_reads")
        if version == "19":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 19 keeps each topic's activity time and the message that reopened it.
        db.execute("DROP INDEX workspace_topic_order")
        db.execute("CREATE INDEX workspace_listed_topics ON topics(workspace_id,archived,id)")
        db.execute("ALTER TABLE topics DROP COLUMN state_message_id")
        db.execute("ALTER TABLE topics DROP COLUMN activity_ms")
        if version == "18":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 18 keeps each delivery's topic and indexes the pending ones by
        # reader and topic, and drops the index of each message's replies that
        # version 16 added (its reply horizons stay).
        db.execute("DROP INDEX pending_topic_deliveries")
        db.execute("ALTER TABLE deliveries DROP COLUMN topic_id")
        db.execute("CREATE INDEX message_replies ON messages(reply_to,author_id) WHERE reply_to IS NOT NULL")
        if version == "17":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 17 keeps the color each person chose for an agent.
        db.execute("DROP TABLE color_choices")
        if version == "16":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 16 keeps each reader's reply horizon and indexes each message's replies.
        db.execute("DROP TABLE reply_horizons")
        db.execute("DROP INDEX message_replies")
        if version == "15":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 15 keeps the latest hosted turn in each topic.
        db.execute("DROP TABLE hosted_turn_topics")
        db.execute("DROP TABLE topic_turns")
        if version == "14":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 14 records whether a message to someone asks or tells, and what waits on whoever it asks.
        db.execute("ALTER TABLE topic_waiting DROP COLUMN ask_message_id")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN said")
        db.execute("ALTER TABLE messages DROP COLUMN intent")
        if version == "13":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 13 adds the messages each person marked unread.
        db.execute("DROP TABLE message_marks")
        if version == "12":
            db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
            return
        # Version 12 orders what waits on each reader; the earlier form of its step,
        # which also stamped 12, did not.
        db.execute("DROP INDEX reader_waiting")
        db.execute("CREATE INDEX actor_waiting ON topic_waiting(actor_id,topic_id)")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN archived")
        db.execute("ALTER TABLE topic_waiting DROP COLUMN state_ms")
        if version != "12-early":
            # Version 12 adds when each message was sent.
            db.execute("ALTER TABLE messages DROP COLUMN sent_ms")
        if version in ("8", "9", "10"):
            # Version 11 adds where each topic stands: its state, archive flag, note, and who it waits on.
            db.execute("DROP TABLE topic_waiting")
            db.execute("DROP INDEX workspace_listed_topics")
            for column in ("state_ms", "state_by", "state_note", "archived", "state"):
                db.execute("ALTER TABLE topics DROP COLUMN " + column)
        if version in ("8", "9"):
            # Version 10 adds the hosted turn records and handed_seq (on the schedule and on each attempt).
            db.execute("DROP TABLE hosted_children")
            db.execute("DROP TABLE hosted_turns")
            db.execute("ALTER TABLE wake_attempts DROP COLUMN handed_seq")
            db.execute("ALTER TABLE recipient_schedule DROP COLUMN handed_seq")
        if version == "8":
            # Version 9 only adds the openings table.
            db.execute("DROP INDEX open_openings")
            db.execute("DROP TABLE openings")
        db.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version.split("-")[0],))


class MigrationCase(fixtures.StoreCase):
    """A schema-8 instance holding records written by the unchanged legacy commands."""

    VERSION, FIXTURE = "8", SCHEMA_8
    LAYOUT = None  # the hand-built layout, when it is not simply VERSION

    def setUp(self):
        # This file tests pre-731 schema steps. Keep later admission records
        # out of these fixtures; the real publication/migration is tested in
        # test_dossier_order.py, without these fixture-only patches.
        patcher = mock.patch('aim_next.dossier_order.published')
        patcher.start()
        self.addCleanup(patcher.stop)
        super().setUp()
        self.create_topic()
        self.assertEqual(self.command("participation.set", {"actor_id": "agent-b", "present": True},
                                      {"topic_id": "t1"})["status"], "committed")
        # The exact stored layout of the older version, proven against its frozen DDL.
        step_back_by_hand(self.path, self.LAYOUT or self.VERSION)
        self.assertEqual(schema(self.path), frozen(self.FIXTURE))
        self.profile = Path(self.temp.name) / "owner.json"
        fd = os.open(str(self.profile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(dict(self.binding, v=2, instance_id="test-instance", actor_id="owner",
                           db_path=str(self.path.resolve())), stream)

    def records(self):
        with sqlite3.connect(str(self.path)) as db:
            # Topics, messages, deliveries, participants and summaries are compared on the columns every
            # version has: version 11 adds where each topic stands, version 12 when each message was sent,
            # version 18 each delivery's topic (copied from its message), version 21 each responsibility
            # note's revision, and version 24 the latest message by someone else, worked out from the messages.
            columns = {"topics": "id,workspace_id,title,creator_id,version",
                       "topic_summaries": "topic_id,message_count,latest_message_id",
                       "deliveries": "seq,id,message_id,recipient_id,group_id,state",
                       "topic_participants": "topic_id,actor_id,active,epoch,responsibility",
                       "messages": "seq,id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,exchange_id,operation_id"}
            return {table: db.execute("SELECT " + columns.get(table, "*") + " FROM " + table + " ORDER BY rowid").fetchall()
                    for table in TABLES}

    def metadata(self):
        return dict(self.sql("SELECT key,value FROM metadata"))

    def unchanged(self):
        return self.path.read_bytes(), self.records()

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding)

    def migrate_command(self):
        return self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))

    def admin(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = admin.main(list(argv), stdout=out, stderr=err)
        return code, json.loads(out.getvalue()) if out.getvalue() else None, err.getvalue()

    def test_reads_and_opening_never_migrate(self):
        before = self.unchanged()
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("owner", "workspace", {"workspace_id": "w1"})["error"]["code"], "SCHEMA_MISMATCH")
        self.assertEqual(self.command("workspace.create", {"id": "w2", "title": "After"})["error"]["code"], "SCHEMA_MISMATCH")
        self.assertEqual(self.unchanged(), before)

    def test_a_version_mismatch_names_both_versions_and_the_command(self):
        from aim_next import cli, serve
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        for text in ("version 8", "version " + SCHEMA_VERSION, "aim-next-admin migrate"):
            self.assertIn(text, str(raised.exception))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "binding"], stdout=out, stderr=err), 2)
        error = json.loads(out.getvalue())["error"]
        self.assertEqual(error["code"], "SCHEMA_MISMATCH")
        self.assertIn("aim-next-admin migrate", error["message"])
        with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(serve.main(["--profile", str(self.profile), "--port", "0"]), 2)
        self.assertIn("SCHEMA_MISMATCH: This database is at schema version 8", stderr.getvalue())
        # A sound version with damaged commit identity keeps the plain refusal.
        self.upgrade()
        self.sql("UPDATE metadata SET value='x' WHERE key='commit_seq'")
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))

    def test_a_database_newer_than_this_code_names_the_code_and_never_moves(self):
        from aim_next import cli
        self.upgrade()
        self.sql("UPDATE metadata SET value='99' WHERE key='schema_version'")
        before = self.unchanged()
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        for text in ("version 99", "version " + SCHEMA_VERSION, "run code that reads version 99"):
            self.assertIn(text, str(raised.exception))
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(cli.main(["--profile", str(self.profile), "binding"], stdout=out, stderr=err), 2)
        self.assertIn("run code that reads version 99", json.loads(out.getvalue())["error"]["message"])
        # An agent's own commands carry the same advice, as text and as JSON.
        for verb in ("outcomes", "inbox"):
            out, err = io.StringIO(), io.StringIO()
            self.assertEqual(cli.main(["--profile", str(self.profile), verb], stdout=out, stderr=err), 2)
            self.assertIn("run code that reads version 99", out.getvalue() + err.getvalue())
            out, err = io.StringIO(), io.StringIO()
            self.assertEqual(cli.main(["--profile", str(self.profile), "--json", verb], stdout=out, stderr=err), 2)
            error = [json.loads(line) for line in out.getvalue().splitlines() if line.strip()][-1]["error"]
            self.assertEqual(error["code"], "SCHEMA_MISMATCH")
            self.assertIn("run code that reads version 99", error["message"])
        # Following migrate anyway, from this code, moves nothing.
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)

    def test_a_missing_or_malformed_version_is_unsupported_not_newer(self):
        self.upgrade()
        # Not ASCII digits, padded, fractional, ten digits, binary.
        for value in (None, "-1", "", " 99", "099", "9.5", "1" * 10, b"99", "\u0669\u0669", "\uff19\uff19", "\u00b2"):
            with self.subTest(value=value):
                if value is None:
                    self.sql("DELETE FROM metadata WHERE key='schema_version'")
                else:
                    db = sqlite3.connect(str(self.path))
                    with db:
                        db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)", (value,))
                    db.close()
                with self.assertRaises(store_module.StoreOpenError) as raised:
                    Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
                self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
                self.assertNotIn("run code that reads", str(raised.exception))
                self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        # An older version this code cannot upgrade is damage too, not newer
        # code; "7" sorts above "10" as text, so the comparison is numeric.
        for value in ("1", "7"):
            with self.subTest(value=value):
                self.sql("UPDATE metadata SET value='%s' WHERE key='schema_version'" % value)
                with self.assertRaises(store_module.StoreOpenError) as raised:
                    Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
        # Nine digits is the longest version read as newer code.
        self.sql("UPDATE metadata SET value='999999999' WHERE key='schema_version'")
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertIn("run code that reads version 999999999", str(raised.exception))

    def test_damaged_commit_identity_is_unsupported_at_any_version_and_migrate_never_moves_it(self):
        # At an upgradable version: no migrate advice, and migrate refuses
        # rather than restart the sequence.
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_seq'")
        before = self.unchanged()
        with self.assertRaises(store_module.StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))
        self.assertNotIn("aim-next-admin migrate", str(raised.exception))
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        # At this code's own version too: migrate refuses rather than report nothing to do.
        self.sql("UPDATE metadata SET value='5' WHERE key='commit_seq'")
        self.upgrade()
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_seq'")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        # A damaged commit_id alone is damage as well, and migrate never replaces it.
        self.sql("UPDATE metadata SET value='5' WHERE key='commit_seq'")
        self.sql("UPDATE metadata SET value='garbage' WHERE key='commit_id'")
        self.sql("UPDATE metadata SET value='8' WHERE key='schema_version'")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)

    def test_one_database_gets_one_remedy_from_the_store_and_from_migrate(self):
        newer = str(int(SCHEMA_VERSION) + 1)
        def remedies():
            with self.assertRaises(store_module.StoreOpenError) as opened:
                Store(self.path, "test-instance", expected_binding=self.binding)
            with self.assertRaises(MigrationError) as moved:
                migrate(self.path, "test-instance", self.binding)
            return str(opened.exception), moved.exception.code, str(moved.exception)
        # A database this code is too old for is told so first, even when its
        # identity is laid out in a way this code does not know.
        self.sql("UPDATE metadata SET value=? WHERE key='schema_version'", (newer,))
        self.sql("DELETE FROM metadata WHERE key='commit_id'")
        self.sql("UPDATE metadata SET value='e2' WHERE key='authority_epoch'")
        opened, code, moved = remedies()
        self.assertIn("run code that reads version %s" % newer, opened)
        self.assertEqual(code, "SCHEMA_UNSUPPORTED")
        self.assertIn("run code that reads version %s" % newer, moved)
        # Damage comes before a changed binding in both: recovery cannot carry it either.
        self.sql("UPDATE metadata SET value='8' WHERE key='schema_version'")
        opened, code, moved = remedies()
        self.assertIn("unsupported; no automatic migration was attempted", opened)
        self.assertEqual(code, "SCHEMA_UNSUPPORTED")
        self.assertIn("commit identity is damaged", moved)

    def test_upgrade_keeps_every_record_and_fences_old_versions(self):
        before, metadata = self.records(), self.metadata()
        self.assertGreater(len(before["messages"]), 0)
        self.assertGreater(len(before["operations"]), 0)
        result = self.upgrade()
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": "8", "schema_version": SCHEMA_VERSION, "migrated": True})
        after = self.records()
        moved = self.metadata()
        self.assertEqual(moved["schema_version"], SCHEMA_VERSION)
        self.assertEqual(int(moved["commit_seq"]), int(metadata["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], metadata["commit_id"])
        for key in ("instance_id", "authority_id", "authority_path", "authority_epoch"):
            self.assertEqual(moved[key], metadata[key])
        self.assertEqual({k: v for k, v in after.items() if k != "metadata"}, {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        # The ordinary store opens the upgraded instance, reads old records and starts openings.
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(store.view("agent-b", "topic", {"topic_id": "t1"})["topic"]["id"], "t1")
        self.store = store
        saved = self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-after", "title": "After upgrade",
                                              "participants": ["agent-a"], "body": "New", "attachments": []},
                             {"opening_id": "o1"}, {"opening_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        published = self.command("opening.publish", {}, {"opening_id": "o1"}, {"opening_revision": 1})
        self.assertEqual(published["status"], "committed", published)
        self.assertEqual(self.sql("SELECT count(*) FROM messages"), [(len(before["messages"]) + 1,)])

    def test_backup_and_recovery_validation_accept_only_the_current_version(self):
        with self.assertRaises(recovery_io.RecoveryError) as raised:
            recovery_io.read_metadata(self.path)
        self.assertEqual(raised.exception.code, "CANDIDATE_INVALID")
        self.upgrade()
        self.assertEqual(recovery_io.read_metadata(self.path)["schema_version"], SCHEMA_VERSION)

    def test_rerun_at_the_current_version_changes_nothing(self):
        self.upgrade()
        before = self.unchanged()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": SCHEMA_VERSION, "migrated": False})
        self.assertEqual(self.unchanged(), before)

    def test_unknown_and_newer_versions_refuse(self):
        for version in ("7", str(int(SCHEMA_VERSION) + 1), "", "8 "):
            with self.subTest(version=version):
                self.sql("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.upgrade()
                self.assertEqual(raised.exception.code, "SCHEMA_UNSUPPORTED")
                self.assertEqual(self.unchanged(), before)

    def test_refuses_while_the_runner_guard_is_held(self):
        before = self.unchanged()
        with Authority(self.path.resolve(), "test-instance", self.binding).runner_guard("runner"):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
            self.assertEqual(raised.exception.code, "RUNNER_GUARD_HELD")
            code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                         "--binding", str(self.profile))
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (2, "RUNNER_GUARD_HELD", False))
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])

    def test_wrong_instance_or_binding_refuses(self):
        before = self.unchanged()
        self.sql("UPDATE metadata SET value='other' WHERE key='instance_id'")
        changed = self.unchanged()
        with self.assertRaises(AuthorityError):
            migrate(self.path, "other", self.binding)
        with self.assertRaises(MigrationError) as raised:
            self.upgrade()
        self.assertEqual(raised.exception.code, "INSTANCE_MISMATCH")
        self.assertEqual(self.unchanged(), changed)
        self.sql("UPDATE metadata SET value='test-instance' WHERE key='instance_id'")
        self.assertEqual(self.unchanged()[1], before[1])
        with self.assertRaises(AuthorityError):
            migrate(self.path, "test-instance", dict(self.binding, authority_epoch="e-other"))
        self.assertEqual(self.metadata()["schema_version"], "8")

    def test_a_failure_mid_upgrade_commits_nothing(self):
        before = self.unchanged()
        failing = (("8", "9", migrations.OPENING_SCHEMA + ["CREATE TABLE openings (id TEXT)"]) + migrations.STEPS[0][3:],) + migrations.STEPS[1:]
        with mock.patch.object(migrations, "STEPS", failing):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
        self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
        self.assertEqual(self.unchanged(), before)
        # A Core check that fails before the commit is a failure that changed nothing, not an unconfirmed one.
        with mock.patch.object(Store, "_advance_commit_seq", side_effect=StoreError("commit identity unavailable")):
            with self.assertRaises(MigrationError) as raised:
                self.upgrade()
            self.assertEqual(raised.exception.code, "MIGRATION_FAILED")
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (2, "MIGRATION_FAILED", False))
        self.assertEqual(self.unchanged(), before)
        self.assertNotIn("openings", "".join(schema(self.path)))
        self.assertTrue(self.upgrade()["migrated"])

    def test_a_commit_error_after_the_commit_point_is_unconfirmed(self):
        connect = store_module._connect

        class LandsThenFails:
            # SQLite can fail the directory sync after deleting the journal, its commit point.
            def __init__(self, db):
                self.db = db

            def __getattr__(self, name):
                return getattr(self.db, name)

            def commit(self):
                self.db.commit()
                raise sqlite3.OperationalError("disk I/O error")

        def landing(path):
            db, actual = connect(path)
            return LandsThenFails(db), actual
        with mock.patch.object(store_module, "_connect", landing):
            code, result, _ = self.migrate_command()
        self.assertEqual((code, result["ok"], result["error"]["code"], result["error"]["retryable"]), (1, False, "UNCONFIRMED", False))
        self.assertNotIn("nothing was changed", result["error"]["message"])
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
        code, result, _ = self.migrate_command()
        self.assertEqual((code, result["migrated"]), (0, False), "running migrate again reports the landed upgrade")

    def test_busy_refusals_are_retryable_and_change_nothing(self):
        before = self.unchanged()
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (75, "DATABASE_BUSY", True))
        finally:
            writer.close()
        self.assertEqual(self.unchanged(), before)
        # A recovery activation or cutover holds the authority lock exclusively.
        fd = os.open(str(Authority(self.path.resolve(), "test-instance", self.binding).path) + ".lock", os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code, result, _ = self.migrate_command()
            self.assertEqual((code, result["error"]["code"], result["error"]["retryable"]), (75, "AUTHORITY_BUSY", True))
        finally:
            os.close(fd)
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.migrate_command()[0], 0)

    def test_step_back_restores_version_8_while_no_opening_exists(self):
        self.upgrade()
        upgraded, records = self.metadata(), self.records()
        result = migrate(self.path, "test-instance", self.binding, "8")
        self.assertEqual(result, {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": "8", "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_8))
        moved = self.metadata()
        self.assertEqual(moved["schema_version"], "8")
        # The commit lineage moves forward: a stale v8 copy can never pass as this instance.
        self.assertEqual(int(moved["commit_seq"]), int(upgraded["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], upgraded["commit_id"])
        for key in ("instance_id", "authority_id", "authority_path", "authority_epoch"):
            self.assertEqual(moved[key], upgraded[key])
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        # Current code is fenced again, and the step is repeatable.
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        before = self.unchanged()
        self.assertFalse(migrate(self.path, "test-instance", self.binding, "8")["migrated"])
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(int(self.metadata()["commit_seq"]), int(moved["commit_seq"]) + 1)

    def test_step_back_refuses_while_any_opening_exists(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        saved = self.command("opening.save", {"workspace_id": "w1", "topic_id": "t-kept", "title": "Kept",
                                              "participants": ["agent-a"], "body": "Words", "attachments": []},
                             {"opening_id": "o1"}, {"opening_revision": 0})
        self.assertEqual(saved["status"], "committed", saved)
        for state in ("open", "published", "discarded"):
            with self.subTest(state=state):
                self.sql("UPDATE openings SET state=?", (state,))
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    migrate(self.path, "test-instance", self.binding, "8")
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                             "--binding", str(self.profile), "--to", "8")
                self.assertEqual((code, result["error"]["code"]), (2, "RECORDS_WOULD_BE_LOST"))
                self.assertEqual(self.unchanged(), before)

    def test_step_back_is_fenced_like_an_upgrade(self):
        self.upgrade()
        before = self.unchanged()
        with Authority(self.path.resolve(), "test-instance", self.binding).runner_guard("runner"):
            with self.assertRaises(MigrationError) as raised:
                migrate(self.path, "test-instance", self.binding, "8")
            self.assertEqual(raised.exception.code, "RUNNER_GUARD_HELD")
        writer = sqlite3.connect(str(self.path), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            with self.assertRaises(MigrationError) as raised:
                migrate(self.path, "test-instance", self.binding, "8")
            self.assertEqual(raised.exception.code, "DATABASE_BUSY")
        finally:
            writer.close()
        for target in ("7", str(int(SCHEMA_VERSION) + 1), "", "8 "):
            with self.subTest(target=target):
                with self.assertRaises(MigrationError) as raised:
                    migrate(self.path, "test-instance", self.binding, target)
                self.assertEqual(raised.exception.code, "SCHEMA_UNSUPPORTED")
        self.assertEqual(self.unchanged(), before)
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance",
                                     "--binding", str(self.profile), "--to", "8")
        self.assertEqual((code, result["ok"], result["schema_version"], result["migrated"]), (0, True, "8", True))

    def test_admin_migrates_then_registers_an_actor(self):
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "other", "--binding", str(self.profile))
        self.assertEqual((code, result["error"]["code"]), (2, "BINDING_MISMATCH"))
        code, result, _ = self.admin("add-actor", "--profile", str(self.profile), "--id", "new", "--kind", "agent", "--name", "N")
        self.assertEqual(code, 2)
        self.assertEqual(self.metadata()["schema_version"], "8")
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))
        self.assertEqual((code, result["ok"], result["migrated"], result["schema_version"]), (0, True, True, SCHEMA_VERSION))
        code, result, _ = self.admin("migrate", "--db", str(self.path), "--instance", "test-instance", "--binding", str(self.profile))
        self.assertEqual((code, result["migrated"]), (0, False))
        sequence = int(self.metadata()["commit_seq"])
        code, result, _ = self.admin("add-actor", "--profile", str(self.profile), "--id", "new-agent", "--kind", "agent",
                                     "--name", "New agent")
        self.assertEqual((code, result["actor"]), (0, {"id": "new-agent", "kind": "agent", "name": "New agent", "enabled": True}))
        self.assertEqual(self.sql("SELECT kind,name,enabled FROM actors WHERE id='new-agent'"), [("agent", "New agent", 1)])
        self.assertEqual(int(self.metadata()["commit_seq"]), sequence + 1)
        before = self.unchanged()
        for argv, expected in ((("--id", "new-agent", "--kind", "human", "--name", "Again"), "ACTOR_EXISTS"),
                               (("--id", "owner", "--kind", "agent", "--name", "Owner"), "ACTOR_EXISTS"),
                               (("--id", "robot", "--kind", "robot", "--name", "Robot"), "INVALID_ARGUMENT"),
                               (("--id", "blank", "--kind", "agent", "--name", " "), "INVALID_ARGUMENT")):
            with self.subTest(argv=argv):
                code, result, _ = self.admin("add-actor", "--profile", str(self.profile), *argv)
                self.assertEqual((code, result["error"]["code"]), (2, expected))
        self.assertEqual(self.unchanged(), before)
        # A registered actor can be bound with the ordinary profile writer.
        self.store = load_profile(str(self.profile)).store()
        added = self.command("workspace.create", {"id": "w-new", "title": "Theirs"}, actor="new-agent")
        self.assertEqual(added["status"], "committed", added)
        code, _, err = self.admin("migrate", "--db", "relative.sqlite3", "--instance", "x", "--binding", str(self.profile))
        self.assertEqual(code, 2)
        self.assertIn("usage", err)
        code, _, err = self.admin("vacuum")
        self.assertEqual(code, 2)


HOSTED_THREAD = "12345678-1234-4234-8234-123456789abc"


class CommitIdentityCase(fixtures.StoreCase):
    """The commit identity a store accepts is exactly the one it writes."""

    def refused(self, statement, params=()):
        self.sql(statement, params)
        with self.assertRaises(StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertIn("unsupported; no automatic migration was attempted", str(raised.exception))

    def test_each_damaged_form_is_refused(self):
        cases = {
            "padded past nineteen digits": ("UPDATE metadata SET value=? WHERE key='commit_seq'", ("0" * 20 + "5",)),
            "at SQLite's largest integer": ("UPDATE metadata SET value='9223372036854775807' WHERE key='commit_seq'", ()),
            "a commit_id one character too long": ("UPDATE metadata SET value=value||'a' WHERE key='commit_id'", ()),
            "a commit_seq stored as bytes": ("UPDATE metadata SET value=x'35' WHERE key='commit_seq'", ()),
            "a missing commit_seq": ("DELETE FROM metadata WHERE key='commit_seq'", ()),
        }
        for name, (statement, params) in cases.items():
            with self.subTest(name):
                saved = self.sql("SELECT key,value FROM metadata WHERE key IN ('commit_seq','commit_id')")
                self.refused(statement, params)
                self.sql("DELETE FROM metadata WHERE key IN ('commit_seq','commit_id')")
                for key, value in saved:
                    self.sql("INSERT INTO metadata VALUES (?,?)", (key, value))
                Store(self.path, "test-instance", expected_binding=self.binding)

    def test_the_sequence_stops_where_the_store_would_stop_accepting_it(self):
        self.sql("UPDATE metadata SET value='9223372036854775805' WHERE key='commit_seq'")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.workspace()["status"], "committed")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("9223372036854775806",)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        with self.assertRaises(StoreError):
            self.command("workspace.create", {"id": "w2", "title": "One more", "purpose": "", "team": []})
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='commit_seq'"), [("9223372036854775806",)])
        self.assertEqual(self.sql("SELECT count(*) FROM workspaces WHERE id='w2'"), [(0,)])
        Store(self.path, "test-instance", expected_binding=self.binding)


class Schema9Case(MigrationCase):
    """A schema-9 instance: version 10 adds handed_seq, hosted_turns and hosted_children."""

    VERSION, FIXTURE = "9", SCHEMA_9

    def hosted_pin(self, store, guard):
        home = Path(self.temp.name) / "codex-home"
        home.mkdir(exist_ok=True)
        return store.provision_route_pin(guard, "agent-a", {"kind": "codex-hosted-stdio", "protocol_version": 1,
                                                            "codex_home": str(home.resolve()), "thread_id": HOSTED_THREAD})

    def hand_a_turn(self):
        """Settle agent-a's due wake as handed to a hosted turn, through the ordinary Core acts."""
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        with store.runner_guard("hosting") as guard:
            self.assertEqual(self.hosted_pin(store, guard)["status"], "provisioned")
            token = store.acquire_runner(guard)["runner_token"]
            claim = store.claim_wakes(guard, token, ["agent-a"])["claims"][0]
            result = store.finish_wake(guard, token, claim["claim_token"], "handed", turn={
                "thread_id": HOSTED_THREAD, "turn_id": "turn-1", "mode": "start",
                "client_id": "theseus:" + claim["attempt_id"], "announced_seq": claim["captured_seq"]})
        self.assertEqual((result["status"], result["wake_status"]), ("settled", "handed"), result)
        return store, result

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "9")

    def refused(self):
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)

    def test_upgrade_from_9_keeps_records_matches_a_fresh_instance_and_hosts(self):
        before, metadata = self.records(), self.metadata()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "9", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(int(self.metadata()["commit_seq"]), int(metadata["commit_seq"]) + 1)
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"}, {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE handed_seq IS NOT NULL"), [(0,)])
        self.assertGreater(self.sql("SELECT count(*) FROM recipient_schedule")[0][0], 0)
        _, result = self.hand_a_turn()
        self.assertEqual(self.sql("SELECT handed_seq FROM recipient_schedule WHERE recipient_id='agent-a'"), [(result["handed_seq"],)])
        self.assertEqual(self.sql("SELECT mode,turn_id FROM hosted_turns"), [("start", "turn-1")])

    def test_step_back_to_9_restores_its_frozen_layout_while_nothing_is_hosted(self):
        self.upgrade()
        upgraded, records = self.metadata(), self.records()
        self.assertEqual(self.step_back(), {"instance_id": "test-instance", "from_version": SCHEMA_VERSION, "schema_version": "9", "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_9))
        moved = self.metadata()
        self.assertEqual(int(moved["commit_seq"]), int(upgraded["commit_seq"]) + 1)
        self.assertNotEqual(moved["commit_id"], upgraded["commit_id"])
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        with self.assertRaises(StoreError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        before = self.unchanged()
        self.assertFalse(self.step_back()["migrated"])
        self.assertEqual(self.unchanged(), before)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(0,)])

    def test_step_back_refuses_while_a_handed_seq_is_set(self):
        self.upgrade()
        self.sql("UPDATE recipient_schedule SET handed_seq=1 WHERE recipient_id='agent-a'")
        self.refused()

    def test_step_back_refuses_while_a_hosted_turn_exists(self):
        self.upgrade()
        store, _ = self.hand_a_turn()
        # The agent acknowledges its work, so handed_seq clears and only the turn row remains.
        self.store = store
        for item in store.view("agent-a", "deliveries", {})["items"]:
            self.assertEqual(self.command("delivery.ack", target={"delivery_id": item["id"]}, actor="agent-a")["status"], "committed")
        self.assertEqual(self.sql("SELECT count(*) FROM recipient_schedule WHERE handed_seq IS NOT NULL"), [(0,)])
        self.assertEqual(self.sql("SELECT count(*) FROM hosted_turns"), [(1,)])
        # Remove the hosted pin by hand, so the turn row is the only hosted record left.
        self.sql("DELETE FROM metadata WHERE key LIKE 'route_pin.v1:%'")
        self.refused()

    def test_step_back_refuses_while_a_hosted_child_is_recorded(self):
        self.upgrade()
        self.sql("INSERT INTO hosted_children(id,runner_token,codex_home,pid,started_at,spawned_ms) VALUES ('h1','r-x','/h',1,'s',1)")
        self.refused()

    def test_step_back_refuses_while_a_hosted_route_pin_exists(self):
        self.upgrade()
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        with store.runner_guard("provision") as guard:
            self.hosted_pin(store, guard)
        self.refused()

    def test_step_back_refuses_while_an_attempt_carries_a_handed_seq(self):
        self.upgrade()
        self.sql("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms,handed_seq) "
                 "VALUES ('a-1','c-1','r-x','agent-a',1,1,1,2,1)")
        self.refused()

    def test_a_queue_route_pin_does_not_hold_the_step_back(self):
        self.upgrade()
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        home = Path(self.temp.name) / "queue-home"
        home.mkdir()
        with store.runner_guard("provision") as guard:
            store.provision_route_pin(guard, "agent-a", {"kind": "codex-queue-stdio", "protocol_version": 1,
                                                          "codex_home": str(home.resolve()), "thread_id": HOSTED_THREAD})
        self.assertTrue(self.step_back()["migrated"])

    def test_a_step_back_never_runs_an_upgrade_step(self):
        # 9 -> 8 is one step back; it must not pass through 10 on the way.
        broken = migrations.STEPS[:1] + (("9", "10", ["CREATE TABLE openings (id TEXT)"]) + migrations.STEPS[1][3:],) + migrations.STEPS[2:]
        with mock.patch.object(migrations, "STEPS", broken):
            self.assertTrue(migrate(self.path, "test-instance", self.binding, "8")["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_8))


class Schema10Case(MigrationCase):
    """A schema-10 instance: version 11 adds where each topic stands."""

    VERSION, FIXTURE = "10", SCHEMA_10

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "10")

    def update(self, args, actor="owner"):
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        version = store.view(actor, "topic", {"topic_id": "t1"})["topic"]["version"]
        self.store = store
        return self.command("topic.update", args, {"topic_id": "t1"}, {"topic_revision": version}, actor=actor)

    def refused(self):
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)

    def test_upgrade_from_10_keeps_records_matches_a_fresh_instance_and_states_topics(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "10", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Every existing topic keeps its columns and starts active, listed, with no note.
        self.assertEqual(self.sql("SELECT id,workspace_id,title,creator_id,version,state,archived,state_note,state_by,state_ms FROM topics"),
                         [tuple(row) + ("active", 0, "", None, None) for row in before["topics"]])
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting"), [(0,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.update({"state": "waiting", "waiting_on": ["agent-b"], "note": "Needs a decision"})["status"], "committed")

    def test_step_back_to_10_restores_its_frozen_layout_while_no_topic_says_where_it_stands(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_10))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        self.assertEqual(self.sql("SELECT * FROM topics"), [tuple(row) for row in records["topics"]])

    def test_step_back_refuses_while_any_topic_says_where_it_stands(self):
        for args, actor in (({"state": "done"}, "owner"), ({"note": "Halfway"}, "owner"), ({"archived": True}, "owner"),
                            ({"state": "active"}, "owner")):
            with self.subTest(args=args):
                self.setUp()
                self.upgrade()
                self.assertEqual(self.update(args, actor)["status"], "committed")
                self.refused()


class Schema11Case(MigrationCase):
    """A schema-11 instance: version 12 records when each message is sent."""

    VERSION, FIXTURE = "11", SCHEMA_11

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "11")

    def send(self):
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        source = {"kind": "topic", "id": "t1"}
        self.assertEqual(self.save_draft("after", source, "t1", "After the upgrade")["status"], "committed")
        self.assertEqual(self.prepare("after", "t1", submission="after", send_op="send-after")["status"], "committed")
        return self.command("message.send", {"submission_id": "after"}, target={"topic_id": "t1"}, op="send-after")

    def test_upgrade_from_11_keeps_records_matches_a_fresh_instance_and_times_new_messages(self):
        before = self.records()
        self.assertTrue(before["messages"], "the fixture holds messages sent before times were kept")
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "11", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Earlier messages have no time to show.
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE sent_ms IS NOT NULL"), [(0,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        start = int(time.time() * 1000)
        self.assertEqual(self.send()["status"], "committed")
        [(sent,)] = self.sql("SELECT sent_ms FROM messages WHERE body='After the upgrade'")
        self.assertGreaterEqual(sent, start)
        self.assertLessEqual(sent, int(time.time() * 1000))

    def wait_at_11(self):
        """t1, archived, waits on agent-b and on someone who lost it before version 12 pruned such rows."""
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('gone','agent','Lost the topic')")
            db.execute("UPDATE topics SET state='waiting',state_by='owner',state_ms=1234,archived=1 WHERE id='t1'")
            db.executemany("INSERT INTO topic_waiting VALUES ('t1',?)", [("agent-b",), ("gone",)])

    def test_upgrade_from_11_orders_what_waits_and_drops_who_cannot_read_it(self):
        self.wait_at_11()
        self.upgrade()
        self.assertEqual(self.sql("SELECT topic_id,actor_id,state_ms,archived FROM topic_waiting"), [("t1", "agent-b", 1234, 1)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # An archived topic waits without counting; unarchived, it counts again.
        self.assertEqual(self.store.view("agent-b", "attention", {})["waiting_on_me"], 0)
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.assertEqual(self.command("topic.update", {"archived": False}, {"topic_id": "t1"}, {"topic_revision": version})["status"], "committed")
        attention = self.store.view("agent-b", "attention", {})
        self.assertEqual((attention["waiting_on_me"], [item["id"] for item in attention["latest_waiting"]]), (1, ["t1"]))

    def test_step_back_to_11_keeps_who_a_topic_waits_on(self):
        self.wait_at_11()
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b")])

    def test_step_back_to_11_restores_its_frozen_layout_while_no_message_has_a_time(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_message_has_a_time(self):
        self.upgrade()
        self.assertEqual(self.send()["status"], "committed")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class EarlySchema12Case(Schema11Case):
    """A database stamped 12 by the earlier form of that step, which timed messages
    but did not order what waits on each reader. Its stamp says current; its shape does not."""

    VERSION, FIXTURE, LAYOUT = "12", SCHEMA_12_EARLY, "12-early"

    def test_opening_refuses_it_and_names_migrate(self):
        before = self.unchanged()
        with self.assertRaises(StoreOpenError) as raised:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(raised.exception.code, "SCHEMA_MISMATCH")
        self.assertIn("aim-next-admin migrate", str(raised.exception))
        self.assertEqual(self.unchanged(), before)

    def test_migrate_finishes_the_step_and_orders_what_waits(self):
        self.wait_at_11()
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "12", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT topic_id,actor_id,state_ms,archived FROM topic_waiting"), [("t1", "agent-b", 1234, 1)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("agent-b", "attention", {})["waiting_on_me"], 0)
        self.assertEqual(self.upgrade()["migrated"], False)

    def test_step_back_to_11_finishes_the_step_first(self):
        self.wait_at_11()
        # Only a database whose messages carry no time can step back; messages are immutable.
        self.sql("ALTER TABLE messages DROP COLUMN sent_ms")
        self.sql("ALTER TABLE messages ADD COLUMN sent_ms INTEGER")
        self.assertEqual(schema(self.path), frozen(SCHEMA_12_EARLY))
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_11))
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b")])


class Schema12Case(MigrationCase):
    """A schema-12 instance: version 13 keeps the messages each person marked unread."""

    VERSION, FIXTURE = "12", SCHEMA_12

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "12")

    def mark(self, marked, revision, actor="owner"):
        message = self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]
        return self.command("message.mark", {"marked": marked}, target={"message_id": message},
                            expected={"mark_revision": revision}, actor=actor)

    def test_upgrade_from_12_keeps_records_matches_a_fresh_instance_and_marks(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "12", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # The one message is the owner's, and a mark on your own counts nowhere: agent-b marks it.
        self.assertEqual(self.mark(True, 0, actor="agent-b")["result"]["mark_revision"], 1)
        self.assertEqual(self.store.view("agent-b", "attention", {})["unread"], 1)

    def test_step_back_to_12_restores_its_frozen_layout_while_no_mark_exists(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_12))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_while_any_mark_exists_cleared_or_not(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for marked, revision in ((True, 0), (False, 1)):
            with self.subTest(marked=marked):
                self.assertEqual(self.mark(marked, revision)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema13Case(MigrationCase):
    """A schema-13 instance: version 14 records whether a message to someone asks or tells."""

    VERSION, FIXTURE = "13", SCHEMA_13

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "13")

    def post(self, **args):
        return self.command("message.post", dict({"body": "For agent-b", "addressees": ["agent-b"]}, **args),
                            target={"topic_id": "t1"})

    def test_upgrade_from_13_keeps_records_matches_a_fresh_instance_and_records_intent(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "13", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Messages sent before the upgrade said neither.
        self.assertEqual(self.sql("SELECT DISTINCT intent FROM messages"), [(None,)])
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.post(intent="ask")["status"], "committed")
        self.assertEqual(self.sql("SELECT intent FROM messages ORDER BY seq DESC LIMIT 1"), [("ask",)])

    def test_step_back_to_13_restores_its_frozen_layout_while_no_message_says_ask_or_tell(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_13))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_a_wait_said_before_the_upgrade_stays_said_and_survives_a_step_back(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topics SET state='waiting',state_by='owner',state_ms=1234 WHERE id='t1'")
            db.execute("INSERT INTO topic_waiting(topic_id,actor_id,state_ms,archived) VALUES ('t1','agent-b',1234,0)")
        self.upgrade()
        self.assertEqual(self.sql("SELECT topic_id,actor_id,said,ask_message_id FROM topic_waiting"), [("t1", "agent-b", 1, None)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        topic = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]
        self.assertEqual((topic["waiting_on"], topic["asks"]), (["agent-b"], []))
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(self.sql("SELECT * FROM topic_waiting"), [("t1", "agent-b", 1234, 0)])

    def test_step_back_refuses_once_a_message_asks_or_tells(self):
        for intent in ("tell", "ask"):
            with self.subTest(intent=intent):
                self.upgrade()
                self.store = Store(self.path, "test-instance", expected_binding=self.binding)
                self.assertEqual(self.post(intent=intent)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
                self.setUp()


class Schema14Case(MigrationCase):
    """A schema-14 instance: version 15 keeps the latest hosted turn in each topic."""

    VERSION, FIXTURE = "14", SCHEMA_14

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "14")

    def test_upgrade_from_14_keeps_records_matches_a_fresh_instance_and_reads_work(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "14", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # A topic from before the upgrade has its posts as its activity, and no turn: the
        # owner's, as anyone else sees them.
        work = self.store.view("agent-a", "topic", {"topic_id": "t1"})["topic"]["work"]
        self.assertEqual((work["by"], work["how"]), ("owner", "posted"))

    def test_step_back_to_14_restores_its_frozen_layout_while_no_turn_is_recorded(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_14))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_turn_in_a_topic_is_recorded(self):
        self.upgrade()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO topic_turns(topic_id,turn_ms,turn_by) VALUES ('t1',1234,'agent-a')")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema15Case(MigrationCase):
    """A schema-15 instance: version 16 indexes what each reader has not replied to."""

    VERSION, FIXTURE = "15", SCHEMA_15

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "15")

    def reply(self, actor, parent, key):
        self.committed_post(actor, {"body": "Answer " + key, "reply_to": parent}, key)

    def committed_post(self, actor, args, key):
        receipt = self.command("message.post", args, target={"topic_id": "t1"}, actor=actor, op="post-" + key)
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]["message_id"]

    def horizons(self):
        return dict(((topic, actor), seq) for topic, actor, seq in self.sql("SELECT topic_id,actor_id,seq FROM reply_horizons"))

    def test_upgrade_from_15_keeps_records_and_matches_a_fresh_instance(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "15", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))

    def test_upgrade_to_16_works_out_where_each_readers_unanswered_messages_begin(self):
        # Written at version 15, before any horizon was kept: agent-a asks, the
        # owner posts to the whole topic, agent-a asks twice more, and the owner
        # answers the first of those. Version 17 code reads these horizons.
        with sqlite3.connect(str(self.path)) as db:
            def post(key, author, reply_to=None):
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,operation_id) "
                           "VALUES (?,'t1',?,'Body','[]','[]','[]',?,?)", (key, author, reply_to, "op-" + key))
                return db.execute("SELECT seq FROM messages WHERE id=?", (key,)).fetchone()[0]
            post("m-before", "agent-a")
            post("m-everyone", "owner")
            answered = post("m-answered", "agent-a")
            waiting = post("m-waiting", "agent-a")
            answer = post("m-answer", "owner", "m-answered")
        self.assertTrue(migrate(self.path, "test-instance", self.binding, "16")["migrated"])
        horizons = self.horizons()
        self.assertEqual(horizons[("t1", "owner")], waiting, "the post to everyone answered what came before; the reply answered one")
        self.assertEqual(horizons[("t1", "agent-a")], answer, "the owner's answer came after agent-a's last post to the topic")
        self.assertLess(answered, waiting)

    def test_step_back_to_15_restores_its_frozen_layout_even_with_replies(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        opening = self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]
        self.reply("agent-a", opening, "a")
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_15))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})


class Schema16Case(MigrationCase):
    """A schema-16 instance: version 17 keeps the color each person chose for an agent."""

    VERSION, FIXTURE = "16", SCHEMA_16

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "16")

    def choose(self, color, revision):
        return self.command("color.set", {"color": color}, target={"actor_id": "agent-a"},
                            expected={"color_revision": revision})

    def test_upgrade_from_16_keeps_records_matches_a_fresh_instance_and_keeps_choices(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "16", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.choose("rose", 0)["result"]["color_revision"], 1)
        self.assertEqual(self.store.view("owner", "colors", {})["items"], [{"actor_id": "agent-a", "color": "rose", "color_revision": 1}])

    def test_upgrade_makes_no_earlier_writer_a_participant(self):
        # A member who wrote in t1 without taking part: having written lets them
        # say where it stands, and wakes them for nothing that follows.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('writer','agent','writer')")
            db.execute("INSERT INTO workspace_members(workspace_id,actor_id) VALUES ('w1','writer')")
            seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                             "VALUES ('m-16','t1','writer','Written','[]','[]','[]','op-16')").lastrowid
            # Version 16 gave every writer a horizon with each message.
            db.execute("INSERT INTO reply_horizons VALUES ('t1','writer',?)", (seq + 1,))
        # Compared on the columns version 16 has; version 21 adds each note's revision.
        rows = "SELECT topic_id,actor_id,active,epoch,responsibility FROM topic_participants ORDER BY rowid"
        participants = self.sql(rows)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql(rows), participants)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        version = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        self.assertEqual(self.command("topic.update", {"state": "review"}, target={"topic_id": "t1"},
                                      expected={"topic_revision": version}, actor="writer")["status"], "committed")

    def test_step_back_to_16_restores_its_frozen_layout_while_no_choice_exists(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_16))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_while_any_choice_exists_reset_or_not(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for color, revision in (("rose", 0), (None, 1)):
            with self.subTest(color=color):
                self.assertEqual(self.choose(color, revision)["status"], "committed")
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema17Case(MigrationCase):
    """A schema-17 instance: version 18 places the New line by what each reader has read."""

    VERSION, FIXTURE = "17", SCHEMA_17

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "17")

    def horizons(self):
        return sorted(self.sql("SELECT topic_id,actor_id,seq FROM reply_horizons"))

    def test_upgrade_from_17_keeps_records_matches_a_fresh_instance_and_finds_the_oldest_unread(self):
        # agent-a has the opening pending (a delivery from before the upgrade, with no topic of its own yet).
        opening = self.sql("SELECT id,seq,sent_ms FROM messages ORDER BY seq LIMIT 1")[0]
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "17", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL OR topic_id<>"
                                  "(SELECT topic_id FROM messages WHERE id=deliveries.message_id)"), [(0,)],
                         "every delivery's topic is copied from its message")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        answer = self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})
        self.assertEqual(answer["oldest_unread"], {"seq": opening[1], "id": opening[0], "sent_ms": opening[2]})

    def test_step_back_to_17_restores_its_frozen_layout_and_works_out_the_horizons_again(self):
        # Horizons as version 17 kept them, after replies and posts to the whole topic.
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        def post(actor, key, **args):
            receipt = self.command("message.post", dict(args, body=key), target={"topic_id": "t1"}, actor=actor, op="post-" + key)
            self.assertEqual(receipt["status"], "committed", receipt)
            return receipt["result"]["message_id"]
        asked = post("agent-a", "asked")
        post("agent-a", "waiting")
        post("owner", "answer", reply_to=asked)
        # The owner's reply folded the ask for them (item 377), an act no version before 35 holds, so the
        # step back would refuse; this check is of the horizons, so the fold is taken out first, as an
        # instance from before replies folded what they answer would never have had it.
        self.assertEqual(self.sql("SELECT kind,message_id,owner FROM message_acts"), [("fold", asked, "owner")])
        self.sql("DELETE FROM message_acts")
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_17))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        stepped = self.horizons()
        # The same horizons the 15->16 step works out from the same messages.
        self.sql("DELETE FROM reply_horizons")
        from aim_next.conversation import UNANSWERED_BACKFILL
        for statement in UNANSWERED_BACKFILL:
            self.sql(statement)
        self.assertEqual(stepped, self.horizons())
        waiting = self.sql("SELECT seq FROM messages WHERE body='waiting'")[0][0]
        self.assertIn(("t1", "owner", waiting), stepped, "the owner answered the ask, not the message after it")
        # And it moves up again, keeping who has written where.
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name IN ('reply_horizons','message_replies')"), [("reply_horizons",)])
        self.assertEqual(self.horizons(), self.newest_plus_one())

    def newest_plus_one(self):
        return sorted(self.sql("SELECT topic_id,author_id,max(seq)+1 FROM messages GROUP BY topic_id,author_id"))

    def test_upgrade_from_17_keeps_who_has_written_in_each_topic(self):
        # Written at version 17: agent-a asks twice and the owner answers the
        # first, so agent-a's horizon sits below its newest message.
        with sqlite3.connect(str(self.path)) as db:
            def post(key, author, reply_to=None):
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,operation_id) "
                           "VALUES (?,'t1',?,'Body','[]','[]','[]',?,?)", (key, author, reply_to, "op-" + key))
            post("m-asked", "agent-a")
            post("m-waiting", "agent-a")
            post("m-answer", "owner", "m-asked")
            # agent-a has left the topic.
            db.execute("UPDATE topic_participants SET active=0 WHERE topic_id='t1' AND actor_id='agent-a'")
            db.execute("DELETE FROM reply_horizons")
            from aim_next.conversation import UNANSWERED_BACKFILL
            for statement in UNANSWERED_BACKFILL:
                db.execute(statement)
        at_17 = self.horizons()
        self.assertNotEqual(at_17, self.newest_plus_one(), "version 17's horizons are not one past each newest message")
        self.upgrade()
        self.assertEqual(self.horizons(), self.newest_plus_one(), "every writer keeps a row, one past their newest message")
        self.assertEqual([row[:2] for row in self.horizons()], [row[:2] for row in at_17], "and only writers have one")
        # agent-a wrote in t1 at version 17 and is no participant: it may still say where t1 stands.
        self.assertEqual(self.sql("SELECT count(*) FROM topic_participants WHERE topic_id='t1' AND actor_id='agent-a' AND active=1"), [(0,)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        revision = self.store.view("owner", "topic", {"topic_id": "t1"})["topic"]["version"]
        receipt = self.command("topic.update", {"state": "review"}, target={"topic_id": "t1"}, actor="agent-a",
                               expected={"topic_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)
        # A post at version 18 moves the writer's row past it.
        posted = self.command("message.post", {"body": "More"}, target={"topic_id": "t1"}, actor="agent-a", op="post-more")
        self.assertEqual(posted["status"], "committed", posted)
        self.assertEqual(self.horizons(), self.newest_plus_one())


class Schema18Case(MigrationCase):
    """A schema-18 instance: version 19 orders each outcome's topics by activity."""

    VERSION, FIXTURE = "18", SCHEMA_18

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "18")

    def test_upgrade_from_18_keeps_records_and_activity_but_orders_by_stable_creation(self):
        # Written at version 18: t2's newest message is later than its state, t3
        # has only a state, t4 has neither, and t1 has its opening message.
        with sqlite3.connect(str(self.path)) as db:
            for topic, state_ms in (("t2", 3000), ("t3", 7000), ("t4", None)):
                db.execute("INSERT INTO topics(id,workspace_id,title,creator_id,version,state_ms) VALUES (?,'w1',?,'owner',1,?)",
                           (topic, topic, state_ms))
                db.execute("INSERT INTO topic_summaries VALUES (?,0,NULL)", (topic,))
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                       "VALUES ('m-t2','t2','owner','Body','[]','[]','[]','op-m-t2',5000)")
            db.execute("UPDATE topic_summaries SET message_count=1,latest_message_id='m-t2' WHERE topic_id='t2'")
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "18", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        opened = self.sql("SELECT m.sent_ms FROM messages m WHERE m.topic_id='t1' ORDER BY seq DESC LIMIT 1")[0][0]
        self.assertEqual(dict(self.sql("SELECT id,activity_ms FROM topics")), {"t1": opened, "t2": 5000, "t3": 7000, "t4": 0})
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        listed = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})
        self.assertEqual([item["id"] for item in listed["items"]], ["t1", "t4", "t3", "t2"], "641: topics lacking a creation change use id as a stable fallback")

    def test_step_back_to_18_restores_its_frozen_layout_while_no_topic_was_reopened(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_18))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_message_reopened_a_topic(self):
        self.upgrade()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topics SET state_message_id=(SELECT id FROM messages ORDER BY seq LIMIT 1) WHERE id='t1'")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema19Case(MigrationCase):
    """A schema-19 instance: version 20 keeps the revision of each Notebook page each person last read."""

    VERSION, FIXTURE = "19", SCHEMA_19

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "19")

    def page(self):
        return self.command("memory.create", {"title": "Page", "body": "Words", "attachments": [], "references": []},
                            target={"item_id": "page", "owner_scope": {"kind": "workspace", "id": "w1"}},
                            expected={"item_revision": 0}, actor="agent-a")

    def read(self):
        return self.command("memory.read", {"revision": 1}, target={"item_id": "page"})

    def test_upgrade_from_19_keeps_records_matches_a_fresh_instance_and_keeps_reads(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "19", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.page()["status"], "committed")
        self.assertEqual(self.read()["result"]["read_revision"], 1)
        listed = self.store.view("owner", "memory_items", {"owner_scope": {"kind": "workspace", "id": "w1"}})["items"]
        self.assertEqual([(item["id"], item["read_revision"]) for item in listed], [("page", 1)])

    def test_step_back_to_19_restores_its_frozen_layout_while_nobody_has_read_a_page(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_19))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_while_anyone_has_read_a_page(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # Writing a page reads it for its writer; the owner then reads it too.
        self.assertEqual(self.page()["status"], "committed")
        self.assertEqual(self.read()["status"], "committed")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema20Case(MigrationCase):
    """A schema-20 instance: version 21 gives each participant's responsibility note a revision,
    and keeps the message each topic was started from."""

    VERSION, FIXTURE = "20", SCHEMA_20

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "20")

    def note(self, note, revision):
        return self.command("responsibility.set", {"note": note}, target={"topic_id": "t1"},
                            expected={"responsibility_revision": revision}, actor="agent-b")

    def test_upgrade_from_20_keeps_records_and_notes_matches_a_fresh_instance_and_fences_notes(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE topic_participants SET responsibility='Set before' WHERE actor_id='agent-b'")
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "20", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        # Every note is kept, at revision 0.
        self.assertEqual(self.sql("SELECT actor_id,responsibility,responsibility_revision FROM topic_participants WHERE topic_id='t1' ORDER BY actor_id"),
                         [("agent-a", "", 0), ("agent-b", "Set before", 0), ("owner", "", 0)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.note("Set after", 0)["result"]["responsibility_revision"], 1)

    def test_step_back_to_20_restores_its_frozen_layout_while_no_note_has_a_revision(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_20))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def start_from(self, opening, topic, publish):
        source = self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]
        self.assertEqual(self.command("opening.save", {"workspace_id": "w1", "topic_id": topic, "title": "From a message", "participants": [],
                                                       "body": "Answering", "attachments": [], "source_message_id": source},
                                      target={"opening_id": opening}, expected={"opening_revision": 0})["status"], "committed")
        if publish:
            self.assertEqual(self.command("opening.publish", {}, target={"opening_id": opening},
                                          expected={"opening_revision": 1})["status"], "committed")

    def test_step_back_refuses_once_a_topic_or_an_open_opening_names_its_message(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for opening, topic, publish in (("o-open", "t-open", False), ("o-done", "t-done", True)):
            with self.subTest(publish=publish):
                if publish:
                    # Only the published topic still names it once the open opening is discarded.
                    self.assertEqual(self.command("opening.discard", {}, target={"opening_id": "o-open"},
                                                  expected={"opening_revision": 1})["status"], "committed")
                self.start_from(opening, topic, publish)
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)

    def test_step_back_refuses_once_a_note_has_a_revision(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.note("Reviews", 0)["status"], "committed")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema21Case(MigrationCase):
    """A schema-21 instance: version 22 counts the wakes each recipient left unanswered."""

    VERSION, FIXTURE = "21", SCHEMA_21

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "21")

    def test_upgrade_from_21_keeps_records_matches_a_fresh_instance_and_counts_from_zero(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "21", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.assertEqual(self.sql("SELECT DISTINCT unanswered_wakes,unanswered_since_ms,named_seq FROM recipient_schedule"), [(0, None, None)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("owner", "wakes", {})["quiet"], [])

    def test_step_back_to_21_restores_its_frozen_layout_while_every_wake_is_answered(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_21))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_to_21_says_a_stopped_runner_is_idle(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        with self.store.runner_guard("stepping-back") as guard:
            self.store.stop_runner(guard, self.store.acquire_runner(guard)["runner_token"])
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_21))
        self.assertEqual(self.sql("SELECT state,reason_code FROM runner_state"), [("idle", None)])

    def test_step_back_to_21_drops_the_unanswered_counts_which_are_nobodys_records(self):
        self.upgrade()
        records = self.records()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=1,unanswered_since_ms=5,named_seq=1 WHERE recipient_id='agent-a'")
        # The count is derived from wakes, not anyone's record: stepping back must not be refused for it.
        try:
            stepped = self.step_back()
        except MigrationError as refused:
            self.fail("step back refused: " + refused.code)
        self.assertTrue(stepped["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_21))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})


class Schema22Case(MigrationCase):
    """A schema-22 instance: version 23 keeps a record of each release."""

    VERSION, FIXTURE = "22", SCHEMA_22
    RECORD = {"release": 19, "commit": "4" * 40, "deployed_at": "2026-11-06T05:28:35-08:00", "items": [87],
              "source": "backfill"}

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "22")

    def test_upgrade_from_22_keeps_records_matches_a_fresh_instance_and_records_releases(self):
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "22", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertTrue(self.store.record_release(self.RECORD)["recorded"])
        self.assertEqual([item["release"] for item in self.store.view("owner", "releases", {})["items"]], [19])

    def test_step_back_to_22_restores_its_frozen_layout_while_no_release_is_recorded(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_22))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})

    def test_step_back_refuses_once_a_release_is_recorded(self):
        self.upgrade()
        Store(self.path, "test-instance", expected_binding=self.binding).record_release(self.RECORD)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class Schema23Case(MigrationCase):
    """A schema-23 instance: version 24 keeps the latest activity by someone else beside each topic's latest."""

    VERSION, FIXTURE = "23", SCHEMA_23

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "23")

    TURNS = (("a1", "agent-b", 100, "completed", 200), ("a2", "agent-b", 250, "failed", 260), ("a3", "agent-a", 280, "completed", 300))

    def written_at_23(self, turns=TURNS):
        """agent-b posts, then agent-a, then the owner twice; then the hosted turns, by default agent-b's
        that completes and one that fails, then agent-a's. Each turn is (attempt, recipient, handed, status,
        finished), its times after the last message."""
        with sqlite3.connect(str(self.path)) as db:
            base = db.execute("SELECT max(sent_ms) FROM messages").fetchone()[0]
            for key, author, ms in (("m-agent-b", "agent-b", base + 5), ("m-agent", "agent-a", base + 10),
                                    ("m-own-1", "owner", base + 20), ("m-own-2", "owner", base + 30)):
                db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                           "VALUES (?,'t1',?,'Body','[]','[]','[]',?,?)", (key, author, "op-" + key, ms))
            db.execute("UPDATE topic_summaries SET message_count=message_count+4,latest_message_id='m-own-2' WHERE topic_id='t1'")
            for attempt, recipient, handed, status, finished in turns:
                db.execute("INSERT INTO hosted_turns(attempt_id,recipient_id,thread_id,turn_id,mode,client_id,announced_seq,handed_ms,final_status,finished_ms) "
                           "VALUES (?,?,'thread','turn-'||?,'start','theseus:'||?,1,?,?,?)", (attempt, recipient, attempt, attempt, base + handed, status, base + finished))
                db.execute("INSERT INTO hosted_turn_topics VALUES (?,'t1')", (attempt,))
            db.execute("INSERT INTO topic_turns VALUES ('t1',?,'agent-a')", (base + 300,))
        return base

    def test_upgrade_from_23_keeps_records_matches_a_fresh_instance_and_works_out_the_others(self):
        base = self.written_at_23()
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "23", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        # The latest by someone else: agent-a's post, behind the owner's two and ahead of agent-b's; and
        # agent-b's failed turn, counted when it was handed, behind agent-a's.
        self.assertEqual(self.sql("SELECT other_message_id FROM topic_summaries WHERE topic_id='t1'"), [("m-agent",)])
        self.assertEqual(self.sql("SELECT other_ms,other_by FROM topic_turns WHERE topic_id='t1'"), [(base + 250, "agent-b")])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        def seen(actor):
            work = self.store.view(actor, "topic", {"topic_id": "t1"})["topic"]["work"]
            return work["seen_ms"], work["by"], work["how"]
        self.assertEqual(seen("owner"), (base + 300, "agent-a", "turn"))
        self.assertEqual(seen("agent-a"), (base + 250, "agent-b", "turn"))

    def test_upgrade_counts_a_completed_turn_by_someone_else_from_when_it_ended(self):
        # agent-b's only turn was handed at 100 and completed at 200, behind agent-a's.
        base = self.written_at_23(turns=(("a1", "agent-b", 100, "completed", 200), ("a3", "agent-a", 280, "completed", 300)))
        self.upgrade()
        self.assertEqual(self.sql("SELECT other_ms,other_by FROM topic_turns WHERE topic_id='t1'"), [(base + 200, "agent-b")])

    def test_step_back_to_23_restores_its_frozen_layout_with_activity_recorded(self):
        self.written_at_23()
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_23))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})


def everything(path):
    """Every pre-48 retained record, excluding derived placement and the additive writer table.

    Item 738 checks writer reconstruction/history separately in test_cover_refresh.py."""
    with sqlite3.connect(str(path)) as db:
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        rows = {}
        for table in tables:
            if table in ("metadata", "topic_position_clock", "cover_writers", "dossier_order"):
                continue
            columns = [row[1] for row in db.execute("PRAGMA table_info(" + table + ")") if row[1] != "list_position"]
            rows[table] = sorted(db.execute("SELECT " + ",".join(columns) + " FROM " + table).fetchall(), key=repr)
        return rows


def horizon_taken(upgraded, stored):
    """Takes the session step's horizon out of an upgraded store's rows: the one row a step up writes, the last
    message sequence the older version had (0 with none), so every agent reader of those messages counts as handed
    them (docs/message-edit.md, "What counts as handed"). The invitations' step after it adds a table, and no row for
    records that hold no invitation; the ends' step adds a table and no row, since every outcome is open; and the
    tools' step's tables are taken by tools_taken."""
    sequences = [row[0] for row in stored.get("messages", [])]
    assert upgraded.pop("message_edit_horizon") == [(max(sequences, default=0),)], "the horizon is the last message"
    assert upgraded.pop("agent_invitations") == [], "no invitation is on these records, so none is filled in"
    assert upgraded.pop("outcome_ends") == [], "no outcome had ended before the ends' step"
    return tools_taken(upgraded)


def tools_taken(upgraded):
    """Takes the tools' step's tables out of an upgraded store's rows: it adds them, and fills none."""
    for table in TOOL_TABLES:
        assert upgraded.pop(table) == [], "the tools' step adds %s empty" % table
    return upgraded


def fresh_schema(directory):
    fresh = Path(directory) / "fresh"
    fresh.mkdir(exist_ok=True)
    fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
    return schema(fresh / "fresh.sqlite3")


# Release 19 stores schema 17; release 20 takes it to SCHEMA_VERSION through
# every step in between, each with its own frozen layout.
RELEASE_20_LADDER = (("17", SCHEMA_17), ("18", SCHEMA_18), ("19", SCHEMA_19), ("20", SCHEMA_20),
                     ("21", SCHEMA_21), ("22", SCHEMA_22), ("23", SCHEMA_23), ("24", SCHEMA_24),
                     ("25", SCHEMA_25), ("26", SCHEMA_26), ("27", SCHEMA_27), (BEFORE_PIPELINE, SCHEMA_BEFORE_PIPELINE),
                     (BEFORE_CHECKS, SCHEMA_BEFORE_CHECKS),
                     (BEFORE_SETTLE, SCHEMA_BEFORE_SETTLE),
                     (BEFORE_HEALTH, SCHEMA_BEFORE_HEALTH),
                     (BEFORE_REACTIONS, SCHEMA_BEFORE_REACTIONS),
                     (BEFORE_ORDER, SCHEMA_BEFORE_ORDER),
                     (BEFORE_STACKS, SCHEMA_BEFORE_STACKS),
                     (BEFORE_BLOCKS, SCHEMA_BEFORE_BLOCKS),
                     (BEFORE_FOLD, SCHEMA_BEFORE_FOLD), ("37", SCHEMA_37),
                     (BEFORE_DRAFT, SCHEMA_BEFORE_DRAFT), (BEFORE_EDIT, SCHEMA_BEFORE_EDIT),
                     (BEFORE_SESSION, SCHEMA_BEFORE_SESSION), (BEFORE_JUDGMENT, SCHEMA_BEFORE_JUDGMENT),
                     (BEFORE_INVITES, SCHEMA_BEFORE_INVITES), (BEFORE_TOOLS, SCHEMA_BEFORE_TOOLS), (BEFORE_ENDS, SCHEMA_BEFORE_ENDS),
                     (BEFORE_COVERS, SCHEMA_BEFORE_COVERS), ("46", SCHEMA_46), ("47", SCHEMA_47), ("48", SCHEMA_48))


class Release19ChainCase(MigrationCase):
    """A release-19 instance (schema 17): release 20's whole chain, one step at a time and at once, up and down."""

    VERSION, FIXTURE = "17", SCHEMA_17

    def test_the_whole_chain_runs_up_and_down_from_release_19(self):
        self.assertEqual([version for version, _ in RELEASE_20_LADDER] + [SCHEMA_VERSION],
                         [str(n) for n in range(17, int(SCHEMA_VERSION) + 1)], "one chain, 17 to the head, nothing skipped")
        stored, records, fresh = everything(self.path), self.records(), fresh_schema(self.temp.name)
        layouts = [frozen(layout) for _, layout in RELEASE_20_LADDER] + [fresh]
        versions = [version for version, _ in RELEASE_20_LADDER] + [SCHEMA_VERSION]
        for here, there, layout in zip(versions, versions[1:], layouts[1:]):
            with self.subTest(up=there):
                moved = migrate(self.path, "test-instance", self.binding, there)
                self.assertEqual((moved["from_version"], moved["schema_version"], moved["migrated"]), (here, there, True))
                self.assertEqual(schema(self.path), layout)
                self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                                 {k: v for k, v in records.items() if k != "metadata"})
        at_head = everything(self.path)
        for here, there, layout in zip(versions[::-1], versions[-2::-1], layouts[-2::-1]):
            with self.subTest(down=there):
                moved = migrate(self.path, "test-instance", self.binding, there)
                self.assertEqual((moved["from_version"], moved["schema_version"], moved["migrated"]), (here, there, True))
                self.assertEqual(schema(self.path), layout)
        self.assertEqual(everything(self.path), stored, "stepping all the way back gives release 19 every row it had")
        # And in one move each way.
        self.assertEqual(self.upgrade()["from_version"], "17")
        self.assertEqual(schema(self.path), fresh)
        self.assertEqual(everything(self.path), at_head, "one move up gives what the steps gave")
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "17")["schema_version"], "17")
        self.assertEqual(schema(self.path), frozen(SCHEMA_17))
        self.assertEqual(everything(self.path), stored)
        # Head code will not open what it stepped back; release 19's code would.
        with self.assertRaises(StoreOpenError) as refused:
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(refused.exception.code, "SCHEMA_MISMATCH")


class LiveShapedChainCase(MigrationCase):
    """A copy of a release-19 instance shaped like the live one: about 530 messages and their deliveries
    across two outcomes, most acknowledged, read-throughs, marks, waits, asks, a done, a review and an
    archived topic, a chosen colour and Notebook pages. Release 20 takes the copy up, back and up again."""

    VERSION, FIXTURE = "17", SCHEMA_17
    TOPICS, POSTS = 20, 26

    def setUp(self):
        # Historical migration fixtures exercise their own records. Item 731's
        # publication/rank migration is independently checked in test_dossier_order.
        patcher = mock.patch('aim_next.dossier_order.published')
        patcher.start()
        self.addCleanup(patcher.stop)
        fixtures.StoreCase.setUp(self)
        self.write_like_the_live_instance()
        # The layout release 19 wrote, with its reply horizons worked out the way release 19 works them.
        step_back_by_hand(self.path, "17")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM reply_horizons")
            for statement in conversation.UNANSWERED_BACKFILL:
                db.execute(statement)
            # Release 19 queued a message between others to the person pending like any other, so
            # what they have not read through of those is pending still, and counted.
            between = [row for row in db.execute(
                "SELECT d.id,m.topic_id,m.seq,m.sent_ms FROM deliveries d CROSS JOIN messages m ON m.id=d.message_id "
                "WHERE d.recipient_id='owner' AND m.addressees<>'[]' "
                "AND NOT EXISTS (SELECT 1 FROM delivery_reasons r WHERE r.delivery_id=d.id AND r.reason='addressed') "
                "AND NOT EXISTS (SELECT 1 FROM messages p WHERE p.id=m.reply_to AND p.author_id='owner')")]
            self.between = {key for key, topic, seq, _ in between if seq > self.through.get(topic, 0)}
            db.executemany("UPDATE deliveries SET state='pending' WHERE id=?", [(key,) for key in self.between])
            db.execute("UPDATE delivery_groups SET pending_count=(SELECT count(*) FROM deliveries d WHERE d.group_id=delivery_groups.id AND d.state='pending'),"
                       "first_pending_seq=(SELECT min(d.seq) FROM deliveries d WHERE d.group_id=delivery_groups.id AND d.state='pending') "
                       "WHERE recipient_id='owner' AND active=1")
            db.execute("UPDATE recipient_schedule SET pending_count=(SELECT sum(pending_count) FROM delivery_groups WHERE recipient_id='owner' AND active=1),"
                       "next_due_ms=coalesce(next_due_ms,?) WHERE recipient_id='owner'", (min(sent for *_, sent in between),))
        self.assertEqual(schema(self.path), frozen(SCHEMA_17))
        # The fixture is kept aside as it is; the check migrates a copy of it, put into the
        # instance's own bound file, since the binding names that file.
        self.fixture = self.path.with_name("live-shaped-17.sqlite3")
        with sqlite3.connect(str(self.path)) as instance, sqlite3.connect(str(self.fixture)) as kept:
            instance.backup(kept)
        with sqlite3.connect(str(self.fixture)) as kept, sqlite3.connect(str(self.path)) as instance:
            kept.backup(instance)
        self.fixture_bytes = self.fixture.read_bytes()

    def committed(self, receipt):
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt.get("result")

    def settled(self, rows):
        """rows (from records or everything) as version 25 leaves them: the person's deliveries between others
        settled, and the person's counters, which are worked out again, left to counted() to check."""
        def row(table, values):
            if table == "deliveries" and values[1] in self.between:
                return tuple("acknowledged" if value == "pending" else value for value in values)
            return values
        mine = {"delivery_groups": 1, "recipient_schedule": 0}
        return {table: [row(table, values) for values in kept if table not in mine or values[mine[table]] != "owner"]
                for table, kept in rows.items()}

    def counted(self):
        """Every live group and schedule counts exactly its pending rows."""
        self.assertEqual(self.sql("SELECT g.id FROM delivery_groups g WHERE g.active=1 AND (g.pending_count<>(SELECT count(*) FROM deliveries d "
                                  "WHERE d.group_id=g.id AND d.state='pending') OR g.first_pending_seq IS NOT (SELECT min(seq) "
                                  "FROM deliveries d WHERE d.group_id=g.id AND d.state='pending'))"), [])
        self.assertEqual(self.sql("SELECT s.recipient_id FROM recipient_schedule s WHERE s.pending_count<>(SELECT coalesce(sum(g.pending_count),0) "
                                  "FROM delivery_groups g WHERE g.recipient_id=s.recipient_id AND g.active=1)"), [])

    def open_topic(self, topic, workspace, title):
        source = {"kind": "new_topic", "id": "opening-" + topic, "workspace_id": workspace}
        self.committed(self.save_draft("draft-" + topic, source, topic, "Opening " + title,
                                       opening={"workspace_id": workspace, "title": title, "participants": ["agent-a", "agent-b"]}))
        self.committed(self.prepare("draft-" + topic, topic, submission="submission-" + topic, send_op="open-" + topic))
        self.committed(self.command("topic.create_and_send", {"submission_id": "submission-" + topic}, target={"topic_id": topic}, op="open-" + topic))

    def write_like_the_live_instance(self):
        self.workspace()
        self.committed(self.command("workspace.create", {"id": "w2", "title": "Second outcome", "purpose": "Another line of work",
                                                         "team": ["agent-a", "agent-b"], "coordinator": "agent-b"}))
        authors = ("owner", "agent-a", "agent-b")
        for n in range(1, self.TOPICS + 1):
            topic = "t%d" % n
            self.open_topic(topic, "w1" if n % 2 else "w2", "Topic %d" % n)
            previous = None
            for k in range(self.POSTS - 1):
                author = authors[k % 3]
                others = [who for who in authors if who != author]
                args = {"body": "Post %d in %s by %s. " % (k, topic, author) + "Words " * (k % 7)}
                if k % 4 == 3 and previous:
                    args["reply_to"] = previous
                if k % 5 == 4:
                    args.update(addressees=[others[k % 2]], intent="ask" if k % 10 == 4 else "tell")
                previous = self.committed(self.command("message.post", args, target={"topic_id": topic}, actor=author,
                                                       op="post-%s-%d" % (topic, k)))["message_id"]
            # Two agents write to each other by name, as on live, which is between others for the person.
            for k, (author, to) in enumerate((("agent-a", "agent-b"), ("agent-b", "agent-a"))):
                self.committed(self.command("message.post", {"body": "Between agents %d in %s." % (k, topic), "addressees": [to], "intent": "tell"},
                                            target={"topic_id": topic}, actor=author, op="between-%s-%d" % (topic, k)))
        # Agents acknowledge what they were handed in all but the last four topics.
        for agent in ("agent-a", "agent-b"):
            pending = self.sql("SELECT d.id FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE d.recipient_id=? "
                               "AND d.state='pending' AND m.topic_id NOT IN ('t17','t18','t19','t20') ORDER BY d.seq", (agent,))
            for (delivery_id,) in pending:
                self.committed(self.command("delivery.ack", {}, target={"delivery_id": delivery_id}, actor=agent))
        # The person reads most topics through, some only part way.
        self.through = {}
        for n in range(1, 16):
            seqs = [seq for (seq,) in self.sql("SELECT seq FROM messages WHERE topic_id=? ORDER BY seq", ("t%d" % n,))]
            through = self.through["t%d" % n] = seqs[-1] if n % 3 else seqs[len(seqs) // 2]
            self.committed(self.command("topic.read_through", {"seq": through}, target={"topic_id": "t%d" % n}, op="through-%d" % n))
        for message_id, in self.sql("SELECT id FROM messages WHERE topic_id IN ('t2','t4') AND author_id='agent-a' ORDER BY seq LIMIT 2"):
            self.committed(self.command("message.mark", {"marked": True}, target={"message_id": message_id}, expected={"mark_revision": 0}))
        def update(topic, args, actor="owner"):
            version = self.store.view(actor, "topic", {"topic_id": topic})["topic"]["version"]
            self.committed(self.command("topic.update", args, target={"topic_id": topic}, expected={"topic_revision": version}, actor=actor))
        update("t3", {"state": "waiting", "waiting_on": ["owner"]}, actor="agent-a")
        update("t5", {"state": "done"})
        update("t7", {"state": "review"}, actor="agent-b")
        update("t9", {"archived": True})
        self.committed(self.command("color.set", {"color": "green"}, target={"actor_id": "agent-a"}, expected={"color_revision": 0}))
        for n in range(3):
            self.committed(self.command("memory.create", {"title": "Page %d" % n, "body": "Words " * 40, "attachments": [], "references": []},
                                        target={"item_id": "page-%d" % n, "owner_scope": {"kind": "workspace", "id": "w1"}},
                                        expected={"item_revision": 0}, actor="agent-a"))

    def test_a_copy_of_a_live_shaped_release_19_instance_goes_up_back_and_up_again(self):
        counts = dict((table, self.sql("SELECT count(*) FROM " + table)[0][0]) for table in ("messages", "deliveries", "topics", "reply_horizons"))
        self.assertGreaterEqual(counts["messages"], 520)
        self.assertGreaterEqual(counts["deliveries"], 1000)
        self.assertGreater(self.sql("SELECT count(*) FROM deliveries WHERE state='pending'")[0][0], 100)
        self.assertGreaterEqual(len(self.between), 20, "the person has messages between others still unread")
        unread = self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='owner'")[0][0]
        self.counted()
        stored, records = everything(self.path), self.records()
        started = time.monotonic()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "17", "schema_version": SCHEMA_VERSION, "migrated": True})
        upgraded_in = time.monotonic() - started
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        self.assertEqual({k: v for k, v in self.settled(self.records()).items() if k != "metadata"},
                         {k: v for k, v in self.settled(records).items() if k != "metadata"})
        # The person's messages between others are settled, and their counts lose exactly those.
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='pending' AND id IN (SELECT value FROM json_each(?))",
                                  (json.dumps(sorted(self.between)),)), [(0,)])
        self.counted()
        self.assertEqual(self.sql("SELECT pending_count FROM recipient_schedule WHERE recipient_id='owner'"), [(unread - len(self.between),)])
        # What the steps work out from the messages, checked against the messages themselves.
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE d.topic_id IS NOT m.topic_id"), [(0,)])
        written = dict(((topic, author), seq + 1) for topic, author, seq in
                       self.sql("SELECT topic_id,author_id,max(seq) FROM messages GROUP BY topic_id,author_id"))
        horizons = dict(((topic, actor), seq) for topic, actor, seq in self.sql("SELECT topic_id,actor_id,seq FROM reply_horizons"))
        self.assertEqual({key: horizons.get(key) for key in written}, written, "everyone who wrote in a topic has written there")
        for topic, other in self.sql("SELECT topic_id,other_message_id FROM topic_summaries"):
            rows = self.sql("SELECT id,author_id FROM messages WHERE topic_id=? ORDER BY seq DESC", (topic,))
            expected = next((key for key, author in rows if author != rows[0][1]), None)
            self.assertEqual(other, expected, topic)
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE activity_ms IS NULL"), [(0,)])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        listed = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})
        self.assertNotIn("error", listed, listed)
        self.assertTrue(all(not item["work"]["by"] or item["work"]["by"] != "owner" for item in listed["items"]), "the person's own posts are not work they see")
        after_up = everything(self.path)
        # Back to release 19: the layout it knows, and every row it had, but for what was settled,
        # which stays settled.
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "17")["schema_version"], "17")
        self.assertEqual(schema(self.path), frozen(SCHEMA_17))
        self.assertEqual(self.settled(everything(self.path)), self.settled(stored))
        self.counted()
        # And up again, to exactly what the first upgrade gave.
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(everything(self.path), after_up)
        self.assertEqual(self.fixture.read_bytes(), self.fixture_bytes, "the fixture itself was never touched")
        self.assertLess(upgraded_in, 60, "the upgrade of %d messages took %.1f s" % (counts["messages"], upgraded_in))

    def test_once_a_whisper_exists_on_the_live_shaped_copy_no_step_back_runs(self):
        self.assertTrue(self.upgrade()["migrated"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.committed(self.command("message.post", {"body": "Only for you", "addressees": ["agent-a"], "whisper": True},
                                    target={"topic_id": "t20"}, op="live-shaped-whisper"))
        before, layout = everything(self.path), schema(self.path)
        # Not to release 22's version, and not past it to release 19's.
        for target in ("26", "17"):
            with self.subTest(target=target):
                with self.assertRaises(MigrationError) as refused:
                    migrate(self.path, "test-instance", self.binding, target)
                self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(everything(self.path), before)
                self.assertEqual(schema(self.path), layout)
        self.assertEqual(self.fixture.read_bytes(), self.fixture_bytes, "the fixture itself was never touched")

    def test_day_one_on_the_live_shaped_copy_closes_the_replaced_topics_and_no_step_back_runs_after(self):
        self.assertTrue(self.upgrade()["migrated"])
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # Topics that end Done and archived; t3 waits on the person, and that wait goes with it.
        self.assertEqual(self.sql("SELECT actor_id FROM topic_waiting WHERE topic_id='t3'"), [("owner",)])
        listed = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"]
        others = self.store.view("owner", "workspace_topics", {"workspace_id": "w2"})["items"]
        before = self.sql("SELECT max(seq) FROM changes")[0][0]
        result = self.store.start_conversation("w1", "agent-b", ["t1", "t3"])
        conversation = result["conversation_id"]
        self.assertEqual(self.sql("SELECT id,state,archived,state_note,state_by,replaced_by FROM topics WHERE id IN ('t1','t3') ORDER BY id"),
                         [(topic, "done", 1, "Replaced by the conversation", None, conversation) for topic in ("t1", "t3")])
        self.assertEqual(self.sql("SELECT count(*) FROM topic_waiting WHERE topic_id='t3'"), [(0,)])
        # Its people and the coordinator (agent-b), and no other agent.
        self.assertEqual(self.sql("SELECT actor_id FROM topic_participants WHERE topic_id=? AND active=1 ORDER BY actor_id", (conversation,)),
                         [("agent-b",), ("owner",)])
        self.assertEqual(self.sql("SELECT coordinator_id FROM workspaces WHERE id='w1'"), [("agent-b",)])
        # Pages repaint: the replaced topics, the conversation and the outcome each have their change rows.
        keys = set(self.sql("SELECT scope_kind,scope_id,resource_id FROM changes WHERE seq>?", (before,)))
        for topic in ("t1", "t3"):
            self.assertIn(("topic", topic, topic), keys)
        self.assertIn(("workspace", "w1", "w1"), keys)
        self.assertIn(("topic", conversation, conversation), keys)
        # w1's list loses exactly the two replaced topics and never lists the conversation; w2 is untouched.
        after = self.store.view("owner", "workspace_topics", {"workspace_id": "w1"})["items"]
        self.assertEqual([item["id"] for item in after], [item["id"] for item in listed if item["id"] not in ("t1", "t3")])
        self.assertEqual(self.store.view("owner", "workspace_topics", {"workspace_id": "w2"})["items"], others)
        held = everything(self.path)
        for target in ("27", "17"):
            with self.subTest(target=target):
                with self.assertRaises(MigrationError) as refused:
                    migrate(self.path, "test-instance", self.binding, target)
                self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(everything(self.path), held)
        self.assertEqual(self.fixture.read_bytes(), self.fixture_bytes, "the fixture itself was never touched")


    def test_a_live_shaped_copy_takes_the_pipelines_step_up_and_back_and_holds_once_a_pipeline_is_kept(self):
        self.assertEqual(migrate(self.path, "test-instance", self.binding, BEFORE_PIPELINE)["schema_version"], BEFORE_PIPELINE)
        before = everything(self.path)
        self.assertEqual(migrate(self.path, "test-instance", self.binding, PIPELINE_VERSION)["schema_version"], PIPELINE_VERSION)
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_CHECKS))
        self.assertEqual({k: v for k, v in everything(self.path).items() if k in before}, before)
        self.assertEqual(migrate(self.path, "test-instance", self.binding, BEFORE_PIPELINE)["schema_version"], BEFORE_PIPELINE)
        self.assertEqual(everything(self.path), before, "an empty pipeline step steps back to every row it had")
        self.upgrade()
        # The live shape's outcome turns its pipeline on and takes items from its own messages.
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}))
        messages = [key for (key,) in self.sql("SELECT m.id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE t.workspace_id='w1' ORDER BY m.seq LIMIT 40")]
        for n, message_id in enumerate(messages):
            self.committed(self.command("pipeline.item_add", {"title": "Item from post %d" % n, "section": ("now", "next", "later", "candidates")[n % 4],
                                                              "sources": [{"message_id": message_id}]}, {"workspace_id": "w1"}, actor="agent-a"))
        read = self.store.view("owner", "pipeline", {"workspace_id": "w1", "section": "next"})
        self.assertNotIn("error", read, read)
        self.assertEqual([item["number"] for item in read["items"]], list(range(2, 41, 4)))
        stored = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding, BEFORE_PIPELINE)
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), stored)


    def test_a_live_shaped_copy_takes_the_checks_step_up_and_back_and_holds_once_a_target_is_kept(self):
        self.assertEqual(migrate(self.path, "test-instance", self.binding, BEFORE_CHECKS)["schema_version"], BEFORE_CHECKS)
        before = everything(self.path)
        self.assertEqual(migrate(self.path, "test-instance", self.binding, CHECKS_VERSION)["schema_version"], CHECKS_VERSION)
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_HEALTH))
        self.assertEqual({k: v for k, v in everything(self.path).items() if k in before}, before)
        self.assertEqual(migrate(self.path, "test-instance", self.binding, BEFORE_CHECKS)["schema_version"], BEFORE_CHECKS)
        self.assertEqual(everything(self.path), before, "an empty checks step steps back to every row it had")
        self.upgrade()
        # Both live-shaped outcomes read to keep, with no target; the coordinator of the second writes its first words.
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        for workspace in ("w1", "w2"):
            read = self.store.view("owner", "outcome_checks", {"workspace_id": workspace})
            self.assertNotIn("error", read, read)
            self.assertEqual((read["kind"]["kind"], read["target"], read["word"]), ("keep", None, None))
        self.committed(self.command("target.propose", {"text": "Every topic keeps its place."}, {"workspace_id": "w2"},
                                    expected={"target_revision": 0}, actor="agent-b"))
        self.assertEqual(self.store.view("owner", "outcome_checks", {"workspace_id": "w2"})["target"]["text"], "Every topic keeps its place.")
        stored = self.unchanged()
        with self.assertRaises(MigrationError) as refused:
            migrate(self.path, "test-instance", self.binding, BEFORE_CHECKS)
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), stored)


class Schema24Case(MigrationCase):
    """A schema-24 instance: version 25 finds the New line in the reader's live groups alone."""

    VERSION, FIXTURE = "24", SCHEMA_24

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "24")

    def headless(self):
        """Queues a delivery to agent-b with no topic, as the table alone allows."""
        with sqlite3.connect(str(self.path)) as db:
            message, group = db.execute("SELECT m.id,d.group_id FROM messages m JOIN deliveries d ON d.message_id=m.id LIMIT 1").fetchone()
            db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id) VALUES ('d-headless',?,'owner',?)", (message, group))

    def test_upgrade_from_24_keeps_records_matches_a_fresh_instance_and_needs_a_topic(self):
        opening = self.sql("SELECT id,seq,sent_ms FROM messages ORDER BY seq LIMIT 1")[0]
        before = self.records()
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "24", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        fresh = Path(self.temp.name) / "fresh"
        fresh.mkdir()
        fixtures.initialize(fresh / "fresh.sqlite3", "fresh", [{"id": "owner"}], authority_path=fresh.resolve() / "control" / "a.json")
        self.assertEqual(schema(self.path), schema(fresh / "fresh.sqlite3"))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("agent-a", "topic_unread", {"topic_id": "t1"})["oldest_unread"], {"seq": opening[1], "id": opening[0], "sent_ms": opening[2]})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "a delivery names its topic"):
            self.headless()
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL"), [(0,)])

    def test_upgrade_gives_a_delivery_version_24_kept_with_no_topic_its_message_topic(self):
        self.headless()
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT d.topic_id=m.topic_id FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE d.id='d-headless'"), [(1,)])
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE topic_id IS NULL"), [(0,)])

    def test_upgrade_settles_what_version_24_left_pending_for_a_person_between_others(self):
        # As version 24 queued them: every delivery pending, counted in its group and schedule.
        with sqlite3.connect(str(self.path)) as db:
            group = lambda actor, kind: db.execute("SELECT id FROM delivery_groups WHERE recipient_id=? AND kind=? AND topic_id=? "
                                                   "AND active=1", (actor, kind, "" if kind == "direct" else "t1")).fetchone()[0]
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) VALUES ('owner','direct','',0),('agent-b','direct','',0) ON CONFLICT DO NOTHING")
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) SELECT actor_id,'subscription',topic_id,epoch "
                       "FROM topic_participants WHERE topic_id='t1' AND actor_id IN ('owner','agent-b') AND active=1 ON CONFLICT DO NOTHING")
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('owner',1),('agent-b',1) ON CONFLICT DO NOTHING")
            def message(key, addressees, reply_to=None):
                seq = db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,reply_to,operation_id) "
                                 "VALUES (?,'t1','agent-a',?,'[]','[]',?,?,?)", (key, key, json.dumps(addressees), reply_to, "op-" + key)).lastrowid
                db.executemany("INSERT INTO message_addressees VALUES ('t1',?,?)", [(actor, seq) for actor in addressees])
                for actor, reason in (("owner", "addressed" if "owner" in addressees else "subscription"),
                                      ("agent-b", "addressed" if "agent-b" in addressees else "subscription")):
                    kind = "direct" if reason == "addressed" else "subscription"
                    delivery = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id) VALUES (?,?,?,?,'t1')",
                                          ("d-%s-%s" % (key, actor), key, actor, group(actor, kind))).lastrowid
                    db.execute("INSERT INTO delivery_reasons VALUES (?,?,'t1',?)", ("d-%s-%s" % (key, actor), reason, None if kind == "direct" else 1))
                    db.execute("UPDATE delivery_groups SET pending_count=pending_count+1,first_pending_seq=coalesce(first_pending_seq,?) WHERE id=?",
                               (delivery, group(actor, kind)))
                    db.execute("UPDATE recipient_schedule SET pending_count=pending_count+1,next_due_ms=1 WHERE recipient_id=?", (actor,))
            opening = db.execute("SELECT id FROM messages WHERE author_id='owner' ORDER BY seq LIMIT 1").fetchone()[0]
            message("between", ["agent-b"])
            message("named", ["owner"])
            message("answer", ["agent-b"], reply_to=opening)
            message("everyone", [])
        state = lambda key, actor="owner": self.sql("SELECT state FROM deliveries WHERE id=?", ("d-%s-%s" % (key, actor),))[0][0]
        self.upgrade()
        self.assertEqual([state(key) for key in ("between", "named", "answer", "everyone")], ["acknowledged", "pending", "pending", "pending"])
        self.assertEqual([state(key, "agent-b") for key in ("between", "named", "answer", "everyone")], ["pending"] * 4, "an agent's work is left as it was")
        # Every live group and schedule of a person counts exactly its pending rows.
        self.assertEqual(self.sql("SELECT g.id FROM delivery_groups g WHERE g.active=1 AND (g.pending_count<>(SELECT count(*) FROM deliveries d "
                                  "WHERE d.group_id=g.id AND d.state='pending') OR coalesce(g.first_pending_seq,0)<>coalesce((SELECT min(seq) "
                                  "FROM deliveries d WHERE d.group_id=g.id AND d.state='pending'),0))"), [])
        self.assertEqual(self.sql("SELECT pending_count,next_due_ms FROM recipient_schedule WHERE recipient_id='owner'"), [(3, 1)],
                         "a person with something still unread keeps their schedule")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.store.view("owner", "attention", {})["unread"], 3, "named, the answer to the owner, and the message to everyone")

    def test_a_person_whose_only_unread_was_between_others_is_left_with_nothing_due(self):
        # As version 24 left it: the person's one pending delivery is of a message between two
        # agents, and their schedule is due, backing off, and counting a wake left unanswered.
        with sqlite3.connect(str(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM deliveries WHERE recipient_id='owner' AND state='pending'").fetchone(), (0,))
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id) "
                       "VALUES ('between','t1','agent-a','To b','[]','[]','[\"agent-b\"]','op-between')")
            seq = db.execute("SELECT seq FROM messages WHERE id='between'").fetchone()[0]
            db.execute("INSERT INTO message_addressees VALUES ('t1','agent-b',?)", (seq,))
            db.execute("INSERT INTO delivery_groups(recipient_id,kind,topic_id,participant_epoch) SELECT actor_id,'subscription',topic_id,epoch "
                       "FROM topic_participants WHERE topic_id='t1' AND actor_id='owner' AND active=1 ON CONFLICT DO NOTHING")
            group = db.execute("SELECT id FROM delivery_groups WHERE recipient_id='owner' AND kind='subscription' AND topic_id='t1' AND active=1").fetchone()[0]
            delivery = db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,topic_id) VALUES ('d-between','between','owner',?,'t1')",
                                  (group,)).lastrowid
            db.execute("INSERT INTO delivery_reasons VALUES ('d-between','subscription','t1',1)")
            db.execute("UPDATE delivery_groups SET pending_count=1,first_pending_seq=? WHERE id=?", (delivery, group))
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('owner',1) ON CONFLICT DO NOTHING")
            db.execute("UPDATE recipient_schedule SET pending_count=1,next_due_ms=1,retry_count=2,handed_seq=?,unanswered_wakes=1,unanswered_since_ms=5 "
                       "WHERE recipient_id='owner'", (delivery,))
        self.upgrade()
        self.assertEqual(self.sql("SELECT state FROM deliveries WHERE id='d-between'"), [("acknowledged",)])
        # What reading the last unread message leaves (Delivery._eligibility_changed): nothing due,
        # no back-off, nothing handed, and no wake left unanswered.
        self.assertEqual(self.sql("SELECT pending_count,next_due_ms,retry_count,handed_seq,unanswered_wakes,unanswered_since_ms "
                                  "FROM recipient_schedule WHERE recipient_id='owner'"), [(0, None, 0, None, 0, None)])

    def test_step_back_to_24_restores_its_frozen_layout(self):
        self.upgrade()
        records = self.records()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_24))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in records.items() if k != "metadata"})
        self.headless()
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")


class Schema25Case(MigrationCase):
    """A schema-25 instance (release 20): version 26 counts a hosted turn as activity in its topic (item 86, D20)."""

    VERSION, FIXTURE = "25", SCHEMA_25

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "25")

    def written_at_25(self, turn=500, other=100):
        """t1's last post at base, and a hosted turn in it at base+turn, the latest by someone else at
        base+other. Returns base."""
        with sqlite3.connect(str(self.path)) as db:
            base = db.execute("SELECT max(sent_ms) FROM messages WHERE topic_id='t1'").fetchone()[0]
            # Version 25's rule, from messages and state changes only.
            db.execute("UPDATE topics SET activity_ms=max(coalesce(state_ms,0),coalesce((SELECT m.sent_ms FROM topic_summaries s "
                       "JOIN messages m ON m.id=s.latest_message_id WHERE s.topic_id=topics.id),0))")
            db.execute("INSERT INTO topic_turns VALUES ('t1',?,'agent-a',?,'agent-b')", (base + turn, base + other))
        return base

    def activity(self):
        return self.sql("SELECT activity_ms FROM topics WHERE id='t1'")[0][0]

    def test_upgrade_from_25_matches_a_fresh_instance_and_raises_activity_to_the_latest_turn(self):
        base = self.written_at_25()
        before, rows = self.records(), everything(self.path)
        self.assertEqual(self.activity(), base)
        # Version 26's own step; version 27 adds a column to every message, checked in Schema26Case.
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "26"),
                         {"instance_id": "test-instance", "from_version": "25", "schema_version": "26", "migrated": True})
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        self.assertEqual(schema(self.path), frozen(SCHEMA_26))
        # The turn is newer than the last post, so the turn orders the topic.
        self.assertEqual(self.activity(), base + 500)
        changed = everything(self.path)
        # Later steps add tables of their own, which start empty.
        self.assertEqual({k: v for k, v in changed.items() if k != "topics" and (k in rows or v)}, {k: v for k, v in rows.items() if k != "topics"},
                         "only the activity time moves")

    def test_upgrade_keeps_a_post_newer_than_the_latest_turn(self):
        base = self.written_at_25(turn=-300, other=-400)
        self.upgrade()
        self.assertEqual(self.activity(), base)

    def test_step_back_to_25_works_activity_out_again_by_its_rule_with_turns_recorded(self):
        base = self.written_at_25()
        stored = everything(self.path)
        self.upgrade()
        self.assertEqual(self.activity(), base + 500)
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_25))
        self.assertEqual(self.activity(), base)
        self.assertEqual(everything(self.path), stored, "stepping back gives version 25 every row it had")


class Schema26Case(MigrationCase):
    """A schema-26 instance (release 22): version 27 lets a person whisper to one agent (item 92)."""

    VERSION, FIXTURE = "26", SCHEMA_26

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "26")

    def whisper(self):
        """The person whispers to agent-a in t1 (participants owner, agent-a, agent-b), at the head code."""
        store = Store(self.path, "test-instance", expected_binding=self.binding)
        receipt = store.command("owner", {"v": 1, "instance_id": "test-instance", "operation_id": "whisper-1", "kind": "message.post",
                                          "target": {"topic_id": "t1"}, "expected": {"authority": dict(self.pin)},
                                          "args": {"body": "Just between us", "addressees": ["agent-a"], "whisper": True}})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]["message_id"]

    def test_upgrade_from_26_matches_whispers_layout_and_keeps_every_row(self):
        before, rows = self.records(), everything(self.path)
        # Version 27's own step; version 28 adds the conversation, checked in Schema27Case.
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "27"),
                         {"instance_id": "test-instance", "from_version": "26", "schema_version": "27", "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_27))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Every message is on the record: nobody's message became private.
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE private_to IS NOT NULL"), [(0,)])
        self.assertGreater(self.sql("SELECT count(*) FROM messages")[0][0], 0)
        self.assertEqual({table: [row[:-1] if table == "messages" else row for row in kept] for table, kept in everything(self.path).items()},
                         rows, "only the new empty column is added to each message")

    def test_step_back_without_a_whisper_gives_26_its_layout_and_every_row_and_up_again_is_the_same(self):
        stored = everything(self.path)
        self.upgrade()
        at_head = schema(self.path)
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_26))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(schema(self.path), at_head)

    def test_step_back_is_refused_once_a_whisper_exists_and_changes_nothing(self):
        self.upgrade()
        self.whisper()
        before = everything(self.path)
        with self.assertRaises(MigrationError) as refused:
            self.step_back()
        self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(everything(self.path), before, "nothing changed")
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [(SCHEMA_VERSION,)])
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))

    def test_the_trigger_refuses_a_whisper_of_the_wrong_shape_whatever_code_inserts_it(self):
        self.upgrade()
        row = self.sql("SELECT id,topic_id,seq FROM messages ORDER BY seq DESC LIMIT 1")[0]
        columns = "id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms,intent,private_to"

        def insert(key, author, addressees, intent, private_to):
            with sqlite3.connect(str(self.path)) as db:
                db.execute("INSERT INTO messages(" + columns + ") VALUES (?,?,?,?,'[]','[]',?,?,1,?,?)",
                           ("m-" + key, row[1], author, "words", json.dumps(addressees), "op-" + key, intent, private_to))
        # Each clause of the shape: two names, an intent, a whisper to oneself.
        for key, case in (("two", ("owner", ["agent-a", "agent-b"], None, "agent-a")),
                          ("intent", ("owner", ["agent-a"], "tell", "agent-a")),
                          ("self", ("agent-a", ["agent-a"], None, "agent-a")),
                          ("other", ("owner", ["agent-b"], None, "agent-a"))):
            with self.subTest(case=key):
                with self.assertRaises(sqlite3.IntegrityError) as refused:
                    insert(key, *case)
                self.assertIn("whisper shape", str(refused.exception))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE private_to IS NOT NULL"), [(0,)])
        # The one shape it keeps: one other person, named alone, neither asking nor telling.
        insert("good", "owner", ["agent-a"], None, "agent-a")
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE private_to='agent-a'"), [(1,)])



class Schema27Case(MigrationCase):
    """A schema-27 instance (whispers): version 28 gives each outcome its conversation (item 82)."""

    VERSION, FIXTURE = "27", SCHEMA_27

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, "27")

    def start(self, *argv):
        """The operator's verb, as the day-one runbook runs it."""
        code, result, err = self.admin("conversation-start", "--profile", str(self.profile), "--outcome", "w1", *argv)
        self.assertEqual(code, 0, err)
        return result

    def test_upgrade_from_27_matches_a_fresh_instance_keeps_every_row_and_starts_no_conversation(self):
        before, rows = self.records(), everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": "27", "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        self.assertEqual({k: v for k, v in self.records().items() if k != "metadata"},
                         {k: v for k, v in before.items() if k != "metadata"})
        # Every topic stays an ordinary topic, replacing nothing; an older outcome's conversation
        # comes from the operator, never from the upgrade.
        self.assertEqual(self.sql("SELECT kind,replaced_by,count(*) FROM topics GROUP BY kind,replaced_by"), [("topic", None, 1)])
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE about_id IS NOT NULL"), [(0,)])
        # Messages gain what they are about, and the reactions' step whether they ask for a go-ahead; deliveries
        # gain their revision (the edit's step).
        widened = {"messages": 2, "topics": 2, "deliveries": 1}
        self.assertEqual({table: [row[:-widened[table]] if table in widened else row for row in kept]
                          for table, kept in everything(self.path).items() if table in rows},
                         rows, "only the new columns are added, to messages and topics")
        # The tables this step and the later ones add (the pipeline's among them) start empty, but for the horizon.
        for table, kept in horizon_taken(everything(self.path), rows).items():
            if table not in rows:
                self.assertEqual(kept, [], table)
        for table in ("conversation_items", "conversation_takes", "conversation_waits"):
            self.assertEqual(self.sql("SELECT count(*) FROM " + table), [(0,)], table)

    def test_step_back_without_a_conversation_gives_27_its_layout_and_every_row_and_up_again_is_the_same(self):
        stored = everything(self.path)
        self.upgrade()
        at_head = schema(self.path)
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_27))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(schema(self.path), at_head)

    def test_step_back_is_refused_once_a_conversation_exists_and_changes_nothing(self):
        self.upgrade()
        started = self.start("--coordinator", "agent-a", "--replaces", "t1")
        self.assertEqual(self.sql("SELECT kind FROM topics WHERE id=?", (started["conversation_id"],)), [("conversation",)])
        before, layout = everything(self.path), schema(self.path)
        for target in ("27", "26"):
            with self.subTest(target=target):
                with self.assertRaises(MigrationError) as refused:
                    migrate(self.path, "test-instance", self.binding, target)
                self.assertEqual(refused.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(everything(self.path), before, "nothing changed")
                self.assertEqual(schema(self.path), layout)
        self.assertEqual(self.sql("SELECT value FROM metadata WHERE key='schema_version'"), [(SCHEMA_VERSION,)])


class PipelineStepCase(MigrationCase):
    """An instance at the version before the pipeline: the pipeline's step adds
    each outcome's pipeline and its records, and steps back only while none is kept."""

    VERSION, FIXTURE = BEFORE_PIPELINE, SCHEMA_BEFORE_PIPELINE

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, PIPELINE_VERSION)

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_PIPELINE)

    def at_head(self):
        # The pipeline's commands run at the head, which keeps every pipeline record the step made.
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], SCHEMA_VERSION)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)

    def committed(self, receipt):
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_is_the_pipelines_and_the_checks_step_follows_it(self):
        self.assertIn((BEFORE_PIPELINE, PIPELINE_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((PIPELINE_VERSION, CHECKS_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_its_frozen_layout_and_the_pipeline_works(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_PIPELINE,
                                          "schema_version": PIPELINE_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_CHECKS))
        upgraded = everything(self.path)
        self.assertEqual({k: v for k, v in upgraded.items() if k in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new tables start empty")
        self.at_head()
        self.committed(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": "w1"}))
        added = self.committed(self.command("pipeline.item_add", {"title": "First", "sources": [{"note": "a test"}]}, {"workspace_id": "w1"}))
        self.assertEqual(added["number"], 1)

    def test_step_back_restores_the_frozen_layout_and_every_row_while_no_pipeline_is_kept(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_PIPELINE))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_while_any_pipeline_record_is_kept_and_changes_nothing(self):
        # Each kind of record the step keeps, alone, holds the instance at its version.
        writes = {
            "a pipeline": ("INSERT INTO pipelines VALUES ('w1',0,'Pipeline','item','items',1,0,'{}',1)",),
            "a message's subject": ("INSERT INTO message_subjects SELECT id,'w1','item','1' FROM messages LIMIT 1",),
            "a release note": ("INSERT INTO release_notes VALUES ('19',1,'A smaller change')",),
        }
        for name, statements in writes.items():
            with self.subTest(kept=name):
                self.upgrade()
                with sqlite3.connect(str(self.path)) as db:
                    db.execute("PRAGMA foreign_keys=OFF")
                    for statement in statements:
                        db.execute(statement)
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], PIPELINE_VERSION)
                # Cleared by hand (the records refuse a DELETE by trigger), the step back goes through.
                with sqlite3.connect(str(self.path)) as db:
                    for table in ("pipelines", "message_subjects", "release_notes"):
                        db.execute("DROP TRIGGER IF EXISTS %s" % {"message_subjects": "subjects_stay", "release_notes": "release_notes_stay_d"}.get(table, "none"))
                        db.execute("DELETE FROM " + table)
                self.assertTrue(self.step_back()["migrated"])

    def test_step_back_refuses_once_the_pipeline_is_turned_on_through_its_command(self):
        self.at_head()
        self.committed(self.command("pipeline.configure", {"enabled": False}, {"workspace_id": "w1"}))
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)


class HealthStepCase(MigrationCase):
    """An instance at the version before the Health page: its step works out each
    recipient's wake facts from the settlements kept, and steps back while Theseus
    has posted no notice."""

    VERSION, FIXTURE = BEFORE_HEALTH, SCHEMA_BEFORE_HEALTH

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, HEALTH_VERSION)

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_HEALTH)

    def settled(self, outcomes, recipient="agent-a"):
        """Settlements the older version kept: one attempt and result per outcome, a minute apart."""
        with sqlite3.connect(str(self.path)) as db:
            for n, outcome in enumerate(outcomes):
                attempt = "a-%s-%d" % (recipient, n)
                db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                           "VALUES (?,?,?,?,1,1,?,?)", (attempt, "c-" + attempt, "r-1", recipient, 60000 * n, 60000 * n + 20000))
                db.execute("INSERT INTO wake_results VALUES (?,?,?)", (attempt, outcome, 60000 * n + 1000))

    def test_the_step_follows_the_settling_steps_and_the_reactions_step_follows_it(self):
        self.assertIn((BEFORE_HEALTH, HEALTH_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((HEALTH_VERSION, REACTION_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_works_out_the_wake_facts(self):
        self.settled(["accepted", "error", "accepted", "error", "busy", "unavailable"])
        self.settled(["handed", "handed", "handed"], recipient="agent-b")
        self.settled(["handed"], recipient="owner")
        with sqlite3.connect(str(self.path)) as db:
            # A handed wake settles with its turn's end: agent-b's first turn completed, its second
            # Codex failed, and its third still runs; the owner's turn runs too.
            db.executemany("INSERT INTO hosted_turns(attempt_id,recipient_id,thread_id,turn_id,mode,client_id,announced_seq,handed_ms,final_status,error_code,finished_ms) "
                           "VALUES (?,?,'thread-1',?,'start',?,1,?,?,?,?)",
                           [("a-agent-b-0", "agent-b", "turn-0", "theseus:a-agent-b-0", 1000, "completed", None, 30000),
                            ("a-agent-b-1", "agent-b", "turn-1", "theseus:a-agent-b-1", 61000, "failed", "serverOverloaded", 90000),
                            ("a-agent-b-2", "agent-b", "turn-2", "theseus:a-agent-b-2", 121000, None, None, None),
                            ("a-owner-0", "owner", "turn-3", "theseus:a-owner-0", 1000, None, None, None)])
            # The scheduler's count of wakes left unanswered is the only record of them. It counted
            # agent-b's first and third turns (the failed one it took back); the owner acted after its turn began.
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('agent-b',1) ON CONFLICT DO NOTHING")
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('owner',1) ON CONFLICT DO NOTHING")
            # Each turn still running holds the work it was handed (handed_seq).
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=2,unanswered_since_ms=1000,handed_seq=1 WHERE recipient_id='agent-b'")
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=0,unanswered_since_ms=NULL,handed_seq=1 WHERE recipient_id='owner'")
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_HEALTH,
                                          "schema_version": HEALTH_VERSION, "migrated": True})
        # The layout a fresh instance of the Health page's release has (the reactions' step follows it).
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_REACTIONS))
        upgraded = everything(self.path)
        self.assertEqual({k: v for k, v in upgraded.items() if k in stored}, stored, "every row the older version had is kept")
        # The three wakes since the last that got through did not; why was never recorded. A turn's
        # end keeps Codex's code, and a turn still running is counted by the rule when it completes.
        # The owner acted after its running turn's wake began (its claim, at 0): the scheduler's count says
        # so, and so does the latest message it wrote.
        # The first message it wrote after then is when its wake got through.
        wrote = self.sql("SELECT min(sent_ms) FROM messages WHERE author_id='owner' AND sent_ms>=0")[0][0]
        self.assertEqual(sorted(upgraded["wake_facts"]), [("agent-a", 121000, 3, 181000, 301000, "unavailable", None, 0, None, None),
                                                            ("agent-b", 30000, 1, 90000, 90000, "failed", "serverOverloaded", 1, 1000, None),
                                                            ("owner", wrote, 0, None, None, None, None, 0, None, None)])
        # Each turn still running is kept as one attempt, from its claim, acted in or not.
        self.assertEqual(sorted(upgraded["wake_turns"]), [("thread-1", "turn-2", "agent-b", 120000, 121000, 1, 0),
                                                           ("thread-1", "turn-3", "owner", 0, 1000, 1, 1)])
        self.assertEqual(upgraded["runner_prior"], [])
        self.assertNotIn("theseus", [row[0] for row in upgraded["actors"]], "Theseus's member comes with its first notice")

    def turns(self, recipient, turns):
        """Hosted turns the older version kept, each a list of hands (mode, handed_ms, seen_ms) and how it
        ended (status, error_code, finished_ms, or Nones while it runs); each hand's claim began 500 ms before it."""
        with sqlite3.connect(str(self.path)) as db:
            for number, (hands, (status, code, finished)) in enumerate(turns):
                for index, (mode, handed, seen) in enumerate(hands):
                    attempt = "a-%s-t%d-%d" % (recipient, number, index)
                    db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                               "VALUES (?,?,?,?,1,1,?,?)", (attempt, "c-" + attempt, "r-1", recipient, handed - 500, handed + 20000))
                    db.execute("INSERT INTO wake_results VALUES (?,'handed',?)", (attempt, handed))
                    db.execute("INSERT INTO hosted_turns(attempt_id,recipient_id,thread_id,turn_id,mode,client_id,announced_seq,handed_ms,seen_ms,final_status,error_code,finished_ms) "
                               "VALUES (?,?,?,?,?,?,1,?,?,?,?,?)", (attempt, recipient, "thread-" + recipient, "turn-%d" % number, mode,
                                                                    "theseus:" + attempt, handed, seen, status, code, finished))

    def posted(self, author, sent_ms):
        """A message the older version kept, by author at sent_ms: one of the agent's acts with its time."""
        with sqlite3.connect(str(self.path)) as db:
            topic = db.execute("SELECT topic_id FROM messages LIMIT 1").fetchone()[0]
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                       "VALUES (?,?,?,'Done','[]','[]','[]',?,?)", ("m-%s-%d" % (author, sent_ms), topic, author, "op-%d" % sent_ms, sent_ms))

    def test_upgrade_counts_one_wake_per_turn_whatever_was_steered_into_it_and_a_turn_the_agent_acted_in_got_through(self):
        # agent-b: a turn that completed with two steers it never read; one Codex failed with a steer it read;
        # one Codex failed in which agent-b posted (an act Core kept the time of); one lost, with a steer it read.
        self.turns("agent-b", [([("start", 1000, None), ("steer", 2000, None), ("steer", 3000, None)], ("completed", None, 30000)),
                               ([("start", 61000, None), ("steer", 62000, 62500)], ("failed", "serverOverloaded", 90000)),
                               ([("start", 121000, None)], ("failed", "serverOverloaded", 150000)),
                               ([("start", 181000, None), ("steer", 182000, 182500)], ("lost", None, 210000))])
        self.posted("agent-b", 130000)
        # owner: three turns Codex failed, each with two steers, and nothing posted: three wakes, not nine.
        self.turns("owner", [([("start", 1000 + 60000 * n, None), ("steer", 2000 + 60000 * n, 2500 + 60000 * n),
                               ("steer", 3000 + 60000 * n, None)], ("failed", "serverOverloaded", 30000 + 60000 * n)) for n in range(3)])
        self.posted("owner", 100)  # before any of its wakes began
        # agent-a: a claim that got through, then one found expired, which is its own why; and a turn still
        # running that holds no work (the scheduler handed it back), which the scheduler's one unanswered
        # wake therefore does not include.
        self.settled(["accepted", "expired"], recipient="agent-a")
        self.turns("agent-a", [([("start", 300000, None)], (None, None, None))])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES ('agent-a',1) ON CONFLICT DO NOTHING")
            db.execute("UPDATE recipient_schedule SET unanswered_wakes=1,unanswered_since_ms=1000,handed_seq=NULL WHERE recipient_id='agent-a'")
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT unanswered_wakes,unanswered_since_ms FROM wake_facts WHERE recipient_id='agent-a'"), [(1, 1000)])
        self.assertEqual(self.sql("SELECT thread_id,turn_id,began_ms,handed_ms,carried FROM wake_turns"), [("thread-agent-a", "turn-0", 299500, 300000, 0)])
        # agent-b's post got its third turn through then, so that turn's failure adds nothing.
        self.assertEqual(sorted(self.sql("SELECT recipient_id,reached_ms,failed_wakes,failing_since_ms,failed_outcome,failed_reason FROM wake_facts")),
                         [("agent-a", 1000, 1, 61000, "expired", "expired"), ("agent-b", 130000, 1, 210000, "lost", None),
                          ("owner", None, 3, 30000, "failed", "serverOverloaded")])

    def claims(self, recipient, claims):
        """Claims the older version kept that settled other than handed: (outcome, finished_ms, runner_token),
        each begun 500 ms before it settled."""
        with sqlite3.connect(str(self.path)) as db:
            for outcome, finished, runner in claims:
                attempt = "a-%s-c%d" % (recipient, finished)
                db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                           "VALUES (?,?,?,?,1,1,?,?)", (attempt, "c-" + attempt, runner, recipient, finished - 500, finished + 20000))
                db.execute("INSERT INTO wake_results VALUES (?,?,?)", (attempt, outcome, finished))

    def test_upgrade_counts_every_claim_it_kept_as_its_own_since_which_turn_one_came_from_was_never_kept(self):
        # agent-a: a turn r-1 started at 61000 and Codex lost at 90000, and r-1's late steer into it. Every
        # claim before, during and after it, of either run, is its own attempt: which turn one came from was
        # never kept. The one found expired happened when its lease ended.
        self.turns("agent-a", [([("start", 61000, None)], ("lost", None, 90000))])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                       "VALUES ('a-late','c-late','r-1','agent-a',1,1,94500,115000)")
            db.execute("INSERT INTO wake_results VALUES ('a-late','handed',95000)")
            db.execute("INSERT INTO hosted_turns(attempt_id,recipient_id,thread_id,turn_id,mode,client_id,announced_seq,handed_ms,final_status,finished_ms) "
                       "VALUES ('a-late','agent-a','thread-agent-a','turn-0','steer','theseus:a-late',1,95000,'lost',95000)")
        self.claims("agent-a", [("error", 30000, "r-1"), ("busy", 62000, "r-1"), ("unavailable", 63000, "r-1"), ("unavailable", 64000, "r-2"),
                                ("error", 65000, "r-1"), ("error", 91000, "r-1"), ("busy", 96000, "r-1")])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                       "VALUES ('a-gone','c-gone','r-1','agent-a',1,1,66000,86000)")
            db.execute("INSERT INTO wake_results VALUES ('a-gone','expired',97000)")
        # agent-b: a turn r-1 started at 1000 still runs, and r-1's and r-2's busy claims while it runs.
        self.turns("agent-b", [([("start", 1000, None)], (None, None, None))])
        self.claims("agent-b", [("busy", 2000, "r-1"), ("busy", 3000, "r-2")])
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(sorted(self.sql("SELECT recipient_id,failed_wakes,failing_since_ms,failed_ms,failed_outcome FROM wake_facts")),
                         [("agent-a", 9, 30000, 96000, "busy"), ("agent-b", 2, 2000, 3000, "busy")])

    def test_upgrade_dates_a_turn_the_agent_wrote_in_by_its_message_so_its_late_end_clears_no_failure_after_it(self):
        # agent-a's turn began at 500 and it posted at 2000; three claims failed after that, and the turn
        # ended lost at 6000 (its process exited). It got through at 2000, before the failures.
        self.turns("agent-a", [([("start", 1000, None)], ("lost", None, 6000))])
        self.posted("agent-a", 2000)
        self.claims("agent-a", [("unavailable", 3000, "r-1"), ("unavailable", 4000, "r-1"), ("unavailable", 5000, "r-1")])
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT reached_ms,failed_wakes,failing_since_ms,failed_outcome FROM wake_facts WHERE recipient_id='agent-a'"),
                         [(2000, 3, 3000, "unavailable")])

    def test_upgrade_folds_a_claim_that_began_before_an_act_and_failed_after_it_after_the_act(self):
        # agent-a's turn began at 500 and it posted at 2000; a claim begun at 1500 settled busy at 3000.
        # It happened at 3000, after the act got a wake through, so it is a failure since then.
        self.turns("agent-a", [([("start", 1000, None)], ("lost", None, 6000))])
        self.posted("agent-a", 2000)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO wake_attempts(id,claim_token,runner_token,recipient_id,wake_generation,captured_seq,started_ms,lease_until_ms) "
                       "VALUES ('a-busy','c-busy','r-1','agent-a',1,1,1500,21500)")
            db.execute("INSERT INTO wake_results VALUES ('a-busy','busy',3000)")
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT reached_ms,failed_wakes,failing_since_ms,failed_outcome FROM wake_facts WHERE recipient_id='agent-a'"),
                         [(2000, 1, 3000, "busy")])

    def test_upgrade_takes_the_schedulers_count_as_an_act_in_the_turns_it_left_out(self):
        # Each agent has one turn still running that was handed work, and wrote nothing since its wake
        # began. The scheduler counted agent-b's as unanswered; agent-a's count is lower than the turns
        # it would have counted, so agent-a acted while its turn ran and that turn got through.
        self.turns("agent-a", [([("start", 300000, None)], (None, None, None))])
        self.turns("agent-b", [([("start", 300000, None)], (None, None, None))])
        with sqlite3.connect(str(self.path)) as db:
            for recipient, count in [("agent-a", 0), ("agent-b", 1)]:
                db.execute("INSERT INTO recipient_schedule(recipient_id,enabled) VALUES (?,1) ON CONFLICT DO NOTHING", (recipient,))
                db.execute("UPDATE recipient_schedule SET unanswered_wakes=?,unanswered_since_ms=?,handed_seq=1 WHERE recipient_id=?",
                           (count, 300000 if count else None, recipient))
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE author_id IN ('agent-a','agent-b') AND sent_ms>=299500"), [(0,)])
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT recipient_id,carried,acted FROM wake_turns ORDER BY recipient_id"),
                         [("agent-a", 1, 1), ("agent-b", 1, 0)])

    def test_step_back_restores_the_frozen_layout_and_every_row_while_no_notice_is_posted(self):
        self.settled(["error", "error", "error"])
        stored = everything(self.path)
        self.upgrade()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO metadata VALUES ('health_announced','{}')")
            db.execute("INSERT INTO metadata VALUES ('health_due','5')")
            db.execute("INSERT INTO runner_prior VALUES (1,'stopped',NULL,5)")
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_HEALTH))
        self.assertEqual(everything(self.path), stored)
        self.assertEqual(self.sql("SELECT count(*) FROM metadata WHERE key IN ('health_announced','health_due')"), [(0,)])
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_theseus_has_posted_a_notice_and_changes_nothing(self):
        self.upgrade()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name,enabled) VALUES ('theseus','agent','Theseus',0)")
            db.execute("INSERT INTO messages(id,topic_id,author_id,body,attachments,quotes,addressees,operation_id,sent_ms) "
                       "VALUES ('m-notice','t1','theseus','Health: a notice','[]','[]','[]','health-1',1)")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)


class ChecksStepCase(MigrationCase):
    """An instance at the pipeline's version: the checks' step adds each outcome's target,
    its checks and their readings, the owner's allowances, the problems found before a
    check, and each outcome's kind and Reached; it steps back only while none is kept."""

    VERSION, FIXTURE = BEFORE_CHECKS, SCHEMA_BEFORE_CHECKS

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, CHECKS_VERSION)

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_CHECKS)

    def committed(self, receipt):
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def at_head(self):
        # Outcomes' checks are read at the head, which keeps every record the step made.
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], SCHEMA_VERSION)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)

    def test_the_step_follows_the_pipelines_and_the_settling_step_follows_it(self):
        self.assertIn((BEFORE_CHECKS, CHECKS_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((CHECKS_VERSION, SETTLE_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_its_frozen_layout_and_the_new_tables_start_empty(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_CHECKS,
                                          "schema_version": CHECKS_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_SETTLE))
        upgraded = everything(self.path)
        self.assertEqual({k: v for k, v in upgraded.items() if k in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new tables start empty")
        # An outcome made before the step has no kind record and reads to keep, with no start time.
        self.at_head()
        read = self.store.view("owner", "outcome_checks", {"workspace_id": "w1"})
        self.assertNotIn("error", read, read)
        self.assertEqual((read["kind"]["kind"], read["kind"]["started_ms"], read["word"]), ("keep", None, None))

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nothing_is_kept(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_CHECKS))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_while_any_record_of_the_step_is_kept_and_changes_nothing(self):
        # Each kind of record the step keeps, alone, holds the instance at its version.
        writes = {
            "a target": ("INSERT INTO outcome_targets VALUES ('w1',0)",),
            "a found problem": ("INSERT INTO found_problems(id,workspace_id,what,kind,found_by,note,found_ms,version) "
                                "VALUES ('fp-1','w1','A slip','defect','owner','in a note',1,1)",),
            "an allowance": ("INSERT INTO check_allowances VALUES ('w1','units','%s','fewer',3,NULL,'Fewer on purpose',NULL,'owner',1)" % ("a" * 40),),
            "a kind": ("INSERT INTO outcome_kinds VALUES ('w1',1,'reach','change','owner',1)",),
            "a Reached": ("INSERT INTO outcome_reached VALUES ('w1','Done','[]','owner',1)",),
        }
        tables = ("outcome_targets", "found_problems", "check_allowances", "outcome_kinds", "outcome_reached")
        for name, statements in writes.items():
            with self.subTest(kept=name):
                self.upgrade()
                with sqlite3.connect(str(self.path)) as db:
                    db.execute("PRAGMA foreign_keys=OFF")
                    for statement in statements:
                        db.execute(statement)
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], CHECKS_VERSION)
                # Cleared by hand (the records refuse a DELETE by trigger), the step back goes through.
                with sqlite3.connect(str(self.path)) as db:
                    for trigger in ("problems_stay", "kept_allowance_d", "kinds_stay_d", "reached_stays_d"):
                        db.execute("DROP TRIGGER " + trigger)
                    for table in tables:
                        db.execute("DELETE FROM " + table)
                self.assertTrue(self.step_back()["migrated"])

    def test_upgrade_writes_the_pipeline_as_facts_and_the_first_write_after_it_derives_the_state(self):
        # Version 29: an outcome shipping in releases, whose piece p-1 (topic t1) took items 3 and 4; item 4 was dropped,
        # then release 1's record named item 3. Version 29 never ended a piece by a record, so p-1 is still under way.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("PRAGMA foreign_keys=OFF")
            db.execute("INSERT INTO pipelines VALUES ('w1',1,'Pipeline','item','items',1,1,'{}',1)")
            db.execute("INSERT INTO pipeline_stages VALUES ('w1','build',1,'Build','','{}','none','piece','')")
            db.executemany("INSERT INTO pipeline_items(workspace_id,number,title,description,section,position,version) VALUES ('w1',?,?,'',?,?,1)",
                           [(3, "Three", "now", 1), (4, "Four", "dropped", 1)])
            db.executemany("INSERT INTO pipeline_events(workspace_id,number,kind,by,ms,payload) VALUES ('w1',?,?,'owner',?,?)",
                           [(None, "configured", 1000, json.dumps({"before": None, "after": {"enabled": True, "ships_in_releases": True}})),
                            (4, "moved", 3000, json.dumps({"before": {"section": "now"}, "after": {"section": "dropped"}})),
                            (3, "moved", 3500, json.dumps({"before": {"section": "now"}, "after": {"section": "now"}}))])
            db.execute("INSERT INTO pipeline_pieces VALUES ('p-1','w1','piece','t1',NULL,NULL,1)")
            db.executemany("INSERT INTO pipeline_piece_members VALUES ('p-1','w1',?,?,?)", [(3, None, None), (4, 3000, "dropped")])
            db.execute("INSERT INTO pipeline_stage_entries(piece_id,workspace_id,stage_id,round,entered_ms,entered_by) VALUES ('p-1','w1','build',1,2000,'owner')")
            db.execute("INSERT INTO releases VALUES (1,?,NULL,'2026-11-01T00:00:00Z',4000,'[3]',NULL,'backfill',NULL,4000)", ("a" * 40,))
        self.assertTrue(self.upgrade()["migrated"])
        with sqlite3.connect(str(self.path)) as db:
            facts = [(kind, ms, by, json.loads(payload)) for kind, ms, by, payload in db.execute("SELECT kind,ms,by,payload FROM pipeline_facts ORDER BY seq")]
        self.assertEqual(facts, [("ships", 1000, "owner", {"on": True}),
                                 ("start", 2000, "owner", {"piece": "p-1", "numbers": [3, 4], "from_release": None}),
                                 ("drop", 3000, "owner", {"number": 4}),
                                 ("record", 4000, None, {"release": 1})])
        # The first pipeline write after the upgrade, the next deploy's record, writes the state the facts derive: release
        # 1 shipped item 3 after item 4 was dropped, so p-1 has shipped, ended by that record, and t1 is ready for review.
        self.at_head()
        self.assertTrue(self.store.record_release({"release": 2, "commit": "b" * 40, "deployed_at": "2026-11-02T00:00:00-08:00", "items": [],
                                                   "source": "deploy"})["recorded"])
        with sqlite3.connect(str(self.path)) as db:
            self.assertEqual(db.execute("SELECT left_outcome,left_note,left_ms,left_by FROM pipeline_stage_entries WHERE piece_id='p-1'").fetchall(),
                             [("shipped", "Shipped in release 1", 4000, None)])
            self.assertEqual(db.execute("SELECT state,state_note,state_by FROM topics WHERE id='t1'").fetchone(), ("review", "Live in release 1 since 12:00 AM Sun Nov 1", None))

    def test_step_back_refuses_once_an_outcome_is_started_or_given_a_target_through_its_commands(self):
        self.upgrade()
        self.at_head()
        self.committed(self.command("workspace.create", {"id": "w9", "title": "Started at the new version"}))
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST", "its start record is kept")
        self.assertEqual(self.unchanged(), before)

class SettleStepCase(MigrationCase):
    """An instance at the version before the settling step, holding conversation
    items as releases 24 to 27 left them: an answerer's reply that asked the item's
    author back wrote no take, so the item stayed New after the author replied.
    The step writes the answer take each such reply would write today."""

    VERSION, FIXTURE = BEFORE_SETTLE, SCHEMA_BEFORE_SETTLE

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, SETTLE_VERSION)

    def create_topic(self):
        source = super().create_topic()
        self.write_as_release_24_left()
        return source

    def posted(self, body, actor="owner", **args):
        topic = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]["topic_id"]
        receipt = self.command("message.post", dict({"body": body}, **args), {"topic_id": topic}, actor=actor)
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]["message_id"]

    def write_as_release_24_left(self):
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES ('reader-two','human','Reader Two')")
        workspace = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.assertEqual(self.command("workspace.member_set", {"actor_id": "reader-two", "present": True}, {"workspace_id": "w1"},
                                      {"workspace_revision": workspace})["status"], "committed")
        self.stuck = self.posted("Can you move the launch?")
        self.back = self.posted("@owner to which day?", "agent-a", reply_to=self.stuck, addressees=["owner"], intent="ask")
        self.posted("Friday.", reply_to=self.back)
        # Asked back by agent-a while it coordinated; agent-b coordinates now.
        self.earlier = self.posted("Is the copy final?")
        self.earlier_back = self.posted("@owner which copy?", "agent-a", reply_to=self.earlier, addressees=["owner"], intent="ask")
        workspace = self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["version"]
        self.assertEqual(self.command("workspace.coordinator_set", {"actor_id": "agent-b"}, {"workspace_id": "w1"},
                                      {"workspace_revision": workspace})["status"], "committed")
        # Never answered; asked back only by a person who does not answer it; answered in part.
        self.quiet = self.posted("What about the press kit?")
        self.other = self.posted("Who books the venue?")
        self.other_back = self.posted("@owner which venue?", "reader-two", reply_to=self.other, addressees=["owner"], intent="ask")
        self.partly = self.posted("Two things: pricing, and the FAQ.")
        self.posted("Pricing is set.", "agent-b", reply_to=self.partly, part=True)
        # Release 24 wrote no take for an answerer's reply that asked the item's author back.
        trigger = next(statement for statement in standing.STANDING_SCHEMA if "immutable_takes_delete" in statement)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DROP TRIGGER immutable_takes_delete")
            db.execute("DELETE FROM conversation_takes WHERE ref IN (?,?)", (self.back, self.earlier_back))
            db.execute("UPDATE conversation_items SET settled=0 WHERE message_id IN (?,?)", (self.stuck, self.earlier))
            db.execute(trigger)

    def items(self):
        return {key: (settled, self.sql("SELECT kind,ref,actor_id,part,at_ms FROM conversation_takes WHERE item_id=? ORDER BY id", (key,)))
                for key, settled in self.sql("SELECT message_id,settled FROM conversation_items")}

    def sent(self, message_id):
        return self.sql("SELECT sent_ms FROM messages WHERE id=?", (message_id,))[0][0]

    def test_the_step_settles_and_the_health_pages_step_follows_it(self):
        self.assertIn((BEFORE_SETTLE, SETTLE_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((SETTLE_VERSION, HEALTH_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_answers_each_item_an_answerer_asked_its_author_back_on_and_leaves_the_rest_as_they_were(self):
        before, stored = self.items(), everything(self.path)
        self.assertEqual({key: before[key] for key in (self.stuck, self.earlier)}, {self.stuck: (0, []), self.earlier: (0, [])},
                         "release 24 left them New with no take")
        self.assertEqual(migrate(self.path, "test-instance", self.binding, SETTLE_VERSION)["schema_version"], SETTLE_VERSION)
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_SETTLE), "no layout changes")
        after = self.items()
        self.assertEqual(after[self.stuck], (1, [("answer", self.back, "agent-a", 0, self.sent(self.back))]),
                         "the item reads Answered, by the asking reply, at the time it was sent")
        self.assertEqual(after[self.earlier], (1, [("answer", self.earlier_back, "agent-a", 0, self.sent(self.earlier_back))]),
                         "an agent's reply to an item was its answerer's, whoever coordinates now")
        self.assertEqual({key: value for key, value in after.items() if key not in (self.stuck, self.earlier)},
                         {key: value for key, value in before.items() if key not in (self.stuck, self.earlier)},
                         "an unanswered item, one a person who does not answer it asked back, and one answered in part stay as they were")
        self.assertEqual([after[key][0] for key in (self.quiet, self.other, self.other_back, self.partly)], [0, 0, 0, 0])
        changed = {table for table, rows in everything(self.path).items() if rows != stored[table]}
        self.assertEqual(changed, {"conversation_takes", "conversation_items", "sqlite_sequence"}, "nothing but them and the takes' counter")
        # The conversation is read at the head, which keeps what the step wrote.
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], SCHEMA_VERSION)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        found = self.store.view("owner", "conversation", {"workspace_id": "w1"})["conversation"]
        self.assertEqual(found["new_items"], 4)
        page = {item["id"]: item["item"] for item in self.store.view("owner", "topic_messages", {"topic_id": found["topic_id"], "limit": 50})["items"]}
        self.assertEqual((page[self.stuck]["state"], [take["ref"] for take in page[self.stuck]["takes"]]), ("settled", [self.back]))

    def test_the_step_runs_again_without_writing_twice_and_steps_back_keeping_what_it_wrote(self):
        self.upgrade()
        settled = everything(self.path)
        up = next(step[2] for step in migrations.STEPS if step[:2] == (BEFORE_SETTLE, SETTLE_VERSION))
        with sqlite3.connect(str(self.path)) as db:
            for statement in up:
                db.execute(statement)
        self.assertEqual(everything(self.path), settled, "run again, it writes nothing")
        self.assertTrue(migrate(self.path, "test-instance", self.binding, BEFORE_SETTLE)["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_SETTLE))
        self.assertEqual(everything(self.path), settled, "stepping back keeps the takes, which the older code reads as any take")
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(everything(self.path), settled, "and up again writes no second take")


class ReactionStepCase(MigrationCase):
    """An instance at the Health page's version: the reactions' step adds each
    thumbs-up and go-ahead answer, and whether a message asks for one, and steps
    back only while none is kept."""

    VERSION, FIXTURE = BEFORE_REACTIONS, SCHEMA_BEFORE_REACTIONS

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_REACTIONS)

    def thumb(self, thumbed, revision):
        message = self.sql("SELECT id FROM messages WHERE topic_id='t1' AND author_id='owner' ORDER BY seq LIMIT 1")[0][0]
        receipt = self.command("message.thumb", {"thumbed": thumbed}, {"message_id": message}, {"thumb_revision": revision}, actor="agent-b")
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_health_page_and_the_order_step_follows_it(self):
        self.assertIn((BEFORE_REACTIONS, REACTION_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((REACTION_VERSION, ORDER_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_a_thumb_is_kept(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_REACTIONS,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        upgraded = horizon_taken(everything(self.path), stored)
        # Each message gains whether it asks for a go-ahead, and none does.
        self.assertEqual([row[-1] for row in upgraded["messages"]], [0] * len(stored["messages"]))
        # Each delivery also gains its revision (the edit's step), the last column.
        self.assertEqual({table: [row[:-1] for row in kept] if table in ("messages", "deliveries") else kept
                          for table, kept in upgraded.items() if table in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new table starts empty")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual((self.thumb(True, 0)["thumb_revision"], self.sql("SELECT actor_id,kind,value FROM message_reactions")),
                         (1, [("agent-b", "thumb", "up")]))

    def test_step_back_restores_the_frozen_layout_and_every_row_while_none_is_kept(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_REACTIONS))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_while_a_reaction_or_a_go_ahead_ask_is_kept_and_changes_nothing(self):
        # A thumbs-up taken back still holds the instance: its revisions would restart.
        def thumbed_and_taken_back():
            self.store = Store(self.path, "test-instance", expected_binding=self.binding)
            self.thumb(True, 0)
            self.thumb(False, 1)

        def asks_for_a_go_ahead():
            self.store = Store(self.path, "test-instance", expected_binding=self.binding)
            receipt = self.command("message.post", {"body": "May I merge it?", "addressees": ["owner"], "intent": "ask", "go_ahead": True},
                                   {"topic_id": "t1"}, actor="agent-b")
            self.assertEqual(receipt["status"], "committed", receipt)

        for name, keep in (("a thumbs-up taken back", thumbed_and_taken_back), ("a message asking for a go-ahead", asks_for_a_go_ahead)):
            with self.subTest(kept=name):
                self.upgrade()
                keep()
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
                # Cleared by hand (a message refuses an UPDATE by trigger, kept as it was), the step back goes through.
                with sqlite3.connect(str(self.path)) as db:
                    db.execute("DELETE FROM message_reactions")
                    trigger = db.execute("SELECT sql FROM sqlite_master WHERE name='immutable_messages_update'").fetchone()[0]
                    db.execute("DROP TRIGGER immutable_messages_update")
                    db.execute("UPDATE messages SET go_ahead=0")
                    db.execute(trigger)
                self.assertTrue(self.step_back()["migrated"])

class OrderStepCase(MigrationCase):
    """An instance at the reactions' version: the order's step adds each person's own
    order of their outcomes and topics, and steps back only while nobody has placed one."""

    VERSION, FIXTURE = BEFORE_ORDER, SCHEMA_BEFORE_ORDER

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_ORDER)

    def place(self, ids, revision):
        receipt = self.command("outline.order_set", {"ids": ids}, {}, {"order_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_reactions_and_the_stacks_step_follows_it(self):
        self.assertIn((BEFORE_ORDER, ORDER_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((ORDER_VERSION, STACKS_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_an_order_is_kept(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_ORDER,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        upgraded = horizon_taken(everything(self.path), stored)
        # Each delivery gains its revision (the edit's step), the last column.
        self.assertEqual({table: [row[:-1] for row in kept] if table == "deliveries" else kept
                          for table, kept in upgraded.items() if table in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new table starts empty")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        workspace = self.sql("SELECT workspace_id FROM workspace_members WHERE actor_id='owner' ORDER BY workspace_id LIMIT 1")[0][0]
        self.assertEqual(self.place([workspace], 0)["order_revision"], 1)
        self.assertEqual(self.sql("SELECT actor_id,within,ids,revision FROM outline_orders"), [("owner", "", '["%s"]' % workspace, 1)])

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nobody_has_placed_an_order(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_ORDER))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_an_order_is_kept_even_emptied_and_changes_nothing(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        workspace = self.sql("SELECT workspace_id FROM workspace_members WHERE actor_id='owner' ORDER BY workspace_id LIMIT 1")[0][0]
        self.place([workspace], 0)
        # Emptied, it still holds the instance: its revisions would restart.
        self.place([], 1)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM outline_orders")
        self.assertTrue(self.step_back()["migrated"])


class StacksStepCase(MigrationCase):
    """An instance at the order's version: the stacks' step adds what people record about
    messages as they read in reply stacks, and steps back only while nothing is recorded."""

    VERSION, FIXTURE = BEFORE_STACKS, SCHEMA_BEFORE_STACKS

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_STACKS)

    def star(self):
        message = self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]
        receipt = self.command("message.star", {"starred": True}, {"message_id": message}, {"star_revision": 0})
        self.assertEqual(receipt["status"], "committed", receipt)
        return message

    def test_the_step_follows_the_order_and_the_blocks_step_follows_it(self):
        self.assertIn((BEFORE_STACKS, STACKS_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((STACKS_VERSION, BLOCKS_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_a_star_is_kept(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_STACKS,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        upgraded = horizon_taken(everything(self.path), stored)
        # Each delivery gains its revision (the edit's step), the last column.
        self.assertEqual({table: [row[:-1] for row in kept] if table == "deliveries" else kept
                          for table, kept in upgraded.items() if table in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new table starts empty")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        message = self.star()
        self.assertEqual(self.sql("SELECT message_id,kind,owner,revision FROM message_acts"), [(message, "star", "owner", 1)])

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nothing_is_recorded(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_STACKS))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_anything_is_recorded_and_changes_nothing(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.star()
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
        with sqlite3.connect(str(self.path)) as db:
            db.execute("DELETE FROM message_acts")
        self.assertTrue(self.step_back()["migrated"])


class BlocksStepCase(MigrationCase):
    """An instance at the stacks' version: the blocks' step keeps what an ask blocks, and steps
    back only while no ask has named a piece or release it holds."""

    VERSION, FIXTURE = BEFORE_BLOCKS, SCHEMA_BEFORE_BLOCKS

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_BLOCKS)

    def blocking_ask(self):
        """A piece being built in t1 and an ask to the owner that holds it, through real commands."""
        def done(receipt):
            self.assertEqual(receipt["status"], "committed", receipt)
            return receipt["result"]
        workspace = self.sql("SELECT workspace_id FROM topics WHERE id='t1'")[0][0]
        done(self.command("pipeline.configure", {"enabled": True}, {"workspace_id": workspace}, {"pipeline_revision": 0}))
        revision = self.store.view("owner", "pipeline", {"workspace_id": workspace, "limit": 1})["pipeline"]["version"]
        done(self.command("pipeline.stages_set", {"stages": [{"stage_id": "build", "name": "Build"}]}, {"workspace_id": workspace},
                          {"pipeline_revision": revision}))
        number = done(self.command("pipeline.item_add", {"title": "Held", "section": "now", "sources": [{"note": "a test"}]},
                                   {"workspace_id": workspace}))["number"]
        piece = done(self.command("pipeline.piece_start", {"numbers": [number], "topic_id": "t1", "stage_id": "build", "size": "small"},
                                  {"workspace_id": workspace}))["piece_id"]
        asker = self.sql("SELECT actor_id FROM workspace_members WHERE workspace_id=? AND actor_id<>'owner' ORDER BY actor_id LIMIT 1",
                         (workspace,))[0][0]
        return done(self.command("message.post", {"body": "Restart it?", "addressees": ["owner"], "intent": "ask",
                                                  "blocks": {"kind": "piece", "ref": piece}}, {"topic_id": "t1"}, actor=asker))

    def test_the_step_is_the_blocks_and_the_folds_step_follows_it(self):
        self.assertIn((BEFORE_BLOCKS, BLOCKS_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((BLOCKS_VERSION, FOLD_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_older_asks_hold_nothing(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_BLOCKS,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        upgraded = horizon_taken(everything(self.path), stored)
        # Each delivery gains its revision (the edit's step), the last column.
        self.assertEqual({table: [row[:-1] for row in kept] if table == "deliveries" else kept
                          for table, kept in upgraded.items() if table in stored}, stored, "every row the older version had is kept")
        self.assertEqual({k: v for k, v in upgraded.items() if k not in stored and v}, {}, "and the new table starts empty")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        # A message from before reads as it did: it names nothing it blocks, and nothing waits as blocking.
        items = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 50})["items"]
        self.assertTrue(items and not any("blocks" in item for item in items))
        self.assertEqual(self.store.view("owner", "attention", {})["blocking"], [])
        posted = self.blocking_ask()
        self.assertEqual(posted["blocks"]["kind"], "piece")
        self.assertEqual(self.sql("SELECT message_id,kind FROM message_blocks"), [(posted["message_id"], "piece")])

    def test_step_back_restores_the_frozen_layout_and_every_row_while_no_ask_blocks_anything(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_BLOCKS))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_an_ask_blocks_something_and_changes_nothing(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.blocking_ask()
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class FoldStepCase(MigrationCase):
    """An instance at the blocks' version: the fold's step lets message_acts hold a reader's
    fold, keeping every act and where its ids go on, and steps back only while nobody has
    folded a message."""

    VERSION, FIXTURE = BEFORE_FOLD, SCHEMA_BEFORE_FOLD

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_FOLD)

    def acted(self):
        """Two acts recorded at version 36, and a third whose row is gone, so the table's ids
        have gone further than its rows: a rebuilt table must go on from there."""
        with sqlite3.connect(str(self.path)) as db:
            message, topic, seq = db.execute("SELECT id,topic_id,seq FROM messages ORDER BY seq LIMIT 1").fetchone()
            for kind, owner, value in (("star", "owner", '{"starred":true}'), ("name", "", '{"name":"Ours"}'), ("deal", "owner", '{"dealt":true}')):
                db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?,?,1)",
                           (kind, message, topic, seq, owner, "owner", value, 5))
            db.execute("DELETE FROM message_acts WHERE kind='deal'")
        return message

    def fold(self, message, folded=True, revision=0):
        receipt = self.command("message.fold", {"folded": folded}, {"message_id": message}, {"fold_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_blocks_and_the_head_is_its_version(self):
        self.assertIn((BEFORE_FOLD, FOLD_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((FOLD_VERSION, "38"), [step[:2] for step in migrations.STEPS])

    def test_before_the_step_a_fold_cannot_be_kept(self):
        message = self.acted()
        with sqlite3.connect(str(self.path)) as db, self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) "
                       "SELECT 'fold',id,topic_id,seq,'owner','owner','{\"folded\":true}',5,1 FROM messages WHERE id=?", (message,))

    def test_upgrade_keeps_every_act_and_its_ids_matches_a_fresh_instance_and_a_fold_is_kept(self):
        message = self.acted()
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_FOLD,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        upgraded = horizon_taken(everything(self.path), stored)
        # Each delivery gains its revision (the edit's step), the last column, and the edit's table starts empty.
        upgraded["deliveries"] = [row[:-1] for row in upgraded["deliveries"]]
        self.assertEqual(upgraded.pop("message_revisions"), [])
        # The session step's tables start empty too.
        self.assertEqual((upgraded.pop("message_edit_sessions"), upgraded.pop("message_exposures")), ([], []))
        # The judgment's table starts empty too.
        self.assertEqual(upgraded.pop("release_judgments"), [])
        self.assertEqual(upgraded, stored, "every row is kept, sqlite_sequence's place for the acts included")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        folded = self.fold(message)
        self.assertEqual((folded["folded"], folded["fold_revision"], folded["acts_version"]), (True, 1, 4), "the next act's id follows the gone one")
        acts = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 50})["items"]
        mine = next(item["acts"] for item in acts if item["id"] == message)
        self.assertEqual((mine["starred"], mine["name"]["text"], mine["folded"]), (True, "Ours", True))

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nothing_is_folded(self):
        self.acted()
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_FOLD))
        self.assertEqual(everything(self.path), stored, "every act and the acts' place in sqlite_sequence come back")
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_a_message_is_folded_and_changes_nothing(self):
        message = self.acted()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.fold(message)
        self.fold(message, folded=False, revision=1)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST", "an unfolded message still holds its fold's rows")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class DraftStepCase(MigrationCase):
    """An instance at 355's version: the draft's step gives each Notebook revision a draft
    mark, every revision kept unmarked, and steps back only while no revision is marked."""

    VERSION, FIXTURE = BEFORE_DRAFT, SCHEMA_BEFORE_DRAFT

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_DRAFT)

    def written(self):
        """A page written at version 38, revised once."""
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO memory_items(id,scope_kind,scope_id,creator_id,current_revision) VALUES ('page','topic','t1','owner',2)")
            for revision, body in ((1, "Words"), (2, "More words")):
                db.execute("INSERT INTO memory_revisions(item_id,revision,author_id,operation_id,title,body,attachments,refs) "
                           "VALUES ('page',?,'owner',?,'Page',?,'[]','[]')", (revision, "op-%d" % revision, body))

    def revise(self, revision, draft):
        receipt = self.command("memory.revise", {"title": "Page", "body": "Words", "attachments": [], "references": [], "draft": draft},
                               {"item_id": "page"}, {"item_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)

    def test_the_step_follows_355s_and_the_edits_step_follows_it(self):
        self.assertIn((BEFORE_DRAFT, DRAFT_VERSION), [step[:2] for step in migrations.STEPS])
        self.assertIn((DRAFT_VERSION, EDIT_VERSION), [step[:2] for step in migrations.STEPS])

    def test_upgrade_keeps_every_revision_unmarked_and_matches_a_fresh_instance(self):
        self.written()
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_DRAFT,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        after = horizon_taken(everything(self.path), stored)
        self.assertEqual(after["memory_revisions"], sorted((row + (0,) for row in stored["memory_revisions"]), key=repr))
        # Each delivery gains its revision (the edit's step), the last column.
        self.assertEqual(after.pop("deliveries"), sorted((row + (1,) for row in stored.pop("deliveries")), key=repr))
        # The edit's, the session step's and the judgment step's tables start empty.
        self.assertEqual([after.pop(table) for table in ("message_revisions", "message_edit_sessions", "message_exposures",
                                                         "release_judgments")], [[], [], [], []])
        self.assertEqual({k: v for k, v in after.items() if k != "memory_revisions"},
                         {k: v for k, v in stored.items() if k != "memory_revisions"})
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        page = self.store.view("agent-a", "memory_current", {"item_id": "page"})
        self.assertEqual((page["body"], page["draft"], page["withheld"]), ("More words", False, False))

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nothing_is_marked(self):
        self.written()
        stored = everything(self.path)
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.revise(2, False)
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_DRAFT))
        back = everything(self.path)
        self.assertEqual(back["memory_revisions"][:2], stored["memory_revisions"])
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_a_revision_is_marked_and_changes_nothing(self):
        self.written()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.revise(2, True)
        self.revise(3, False)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST", "a cleared page still keeps the revision that marked it")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class EditStepCase(MigrationCase):
    """An instance at the draft's version holding a message delivered to an agent: the edit's step keeps
    every delivery, its id and seq and where the next goes on from, matches a fresh instance, and steps back
    only while no message has been edited."""

    VERSION, FIXTURE = BEFORE_EDIT, SCHEMA_BEFORE_EDIT

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_EDIT)

    def delivered(self):
        """The topic's first message, from owner, with agent-a's delivery of it, and a delivery whose row is gone,
        so the table's seq has gone further than its rows: a rebuilt table must go on from there."""
        with sqlite3.connect(str(self.path)) as db:
            message, topic = db.execute("SELECT id,topic_id FROM messages ORDER BY seq LIMIT 1").fetchone()
            group = db.execute("SELECT group_id FROM deliveries WHERE recipient_id='agent-a' ORDER BY seq LIMIT 1").fetchone()[0]
            db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,state,topic_id) VALUES ('d-gone',?,'agent-b',?,'acknowledged',?)",
                       (message, group, topic))
            db.execute("DELETE FROM deliveries WHERE id='d-gone'")
            return message

    def edit(self, message, body, revision):
        receipt = self.command("message.edit", {"body": body}, {"message_id": message}, {"message_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_drafts_and_comes_just_before_the_sessions(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertIn((BEFORE_EDIT, EDIT_VERSION), steps)
        self.assertEqual(steps[steps.index((BEFORE_EDIT, EDIT_VERSION)) + 1], (EDIT_VERSION, SESSION_VERSION),
                         "39->40 is the step before 40->41")

    def test_upgrade_keeps_every_delivery_its_seq_and_reasons_and_matches_a_fresh_instance(self):
        message = self.delivered()
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_EDIT,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        after = everything(self.path)
        self.assertEqual(after.pop("deliveries"), sorted((row + (1,) for row in stored.pop("deliveries")), key=repr),
                         "every delivery keeps its seq and id, at revision 1")
        for table in ("message_revisions", "message_edit_sessions", "message_exposures", "message_edit_horizon", "agent_invitations", "outcome_ends"):
            after.pop(table)
        tools_taken(after)
        self.assertEqual(after.pop("release_judgments"), [], "the judgment's step adds an empty table")
        self.assertEqual({k: v for k, v in after.items() if k != "metadata"}, {k: v for k, v in stored.items() if k != "metadata"},
                         "every reason and sqlite_sequence's place for the deliveries are kept")
        with sqlite3.connect(str(self.path)) as db, self.assertRaisesRegex(sqlite3.IntegrityError, "a delivery names its topic"):
            db.execute("INSERT INTO deliveries(id,message_id,recipient_id,group_id,state,revision) SELECT 'd-x',message_id,recipient_id,group_id,state,9 "
                       "FROM deliveries LIMIT 1")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        gone = self.sql("SELECT seq FROM sqlite_sequence WHERE name='deliveries'")[0][0]
        self.assertEqual(self.edit(message, "Fixed words", 1)["revision"], 2)
        self.assertGreater(self.sql("SELECT min(seq) FROM deliveries WHERE revision=2")[0][0], gone, "the next seq follows the gone one")
        self.assertEqual(self.sql("SELECT recipient_id,revision,state FROM deliveries WHERE message_id=? ORDER BY recipient_id,revision", (message,)),
                         [("agent-a", 1, "pending"), ("agent-a", 2, "pending"), ("agent-b", 2, "pending")],
                         "a message from before the step is corrected to each agent that reads it, delivered before or not")

    def test_step_back_restores_the_frozen_layout_and_every_row_while_nothing_is_edited(self):
        self.delivered()
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_EDIT))
        self.assertEqual(everything(self.path), stored, "every delivery, reason and the deliveries' place in sqlite_sequence come back")
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_a_message_is_edited_and_changes_nothing(self):
        message = self.delivered()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.edit(message, "Fixed words", 1)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class JudgmentStepCase(MigrationCase):
    """An instance at the session's version (41) holding a release record: the judgment's step (41->42) keeps every
    row, matches a fresh instance, takes a judgment of a pending release, and steps back only while no judgment is
    attached."""

    VERSION, FIXTURE = BEFORE_JUDGMENT, SCHEMA_BEFORE_JUDGMENT

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_JUDGMENT)

    def recorded(self):
        """Release 20, deployed from an ordinary merged train at version 41, its hosted judgment pending."""
        measured = {"train": {"pr": 31, "kind": "ordinary", "merge_commit": "a" * 40, "judgment": "pending"}}
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO releases(number,commit_sha,previous_sha,deployed_at,deployed_ms,items,measurements,source,"
                       "evidence,recorded_ms) VALUES (20,?,NULL,'2026-11-14T20:00:00-08:00',1,'[481]',?,'deploy',NULL,1)",
                       ("a" * 40, json.dumps(measured)))

    def attach(self):
        found = {"id": 1, "name": "Checks", "head_sha": "a" * 40, "status": "completed", "conclusion": "success", "kind": "run"}
        return self.store.attach_judgment(20, {"head": "a" * 40, "producer_runs": [found], "verdict_checks": [dict(found, kind="check")],
                                               "audit": "m-audit"})

    def test_the_step_follows_the_sessions_and_the_invitations_step_follows_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertIn((BEFORE_JUDGMENT, JUDGMENT_VERSION), steps)
        self.assertEqual(steps[steps.index((BEFORE_SESSION, SESSION_VERSION)) + 1], (BEFORE_JUDGMENT, JUDGMENT_VERSION),
                         "40->41 is the step before 41->42")
        self.assertEqual([step for step in steps if step[0] == BEFORE_JUDGMENT or step[1] == JUDGMENT_VERSION],
                         [(BEFORE_JUDGMENT, JUDGMENT_VERSION)], "one step leaves 41 and one reaches 42")
        self.assertEqual(steps[steps.index((BEFORE_JUDGMENT, JUDGMENT_VERSION)) + 1], (BEFORE_INVITES, INVITES_VERSION),
                         "the invitations' step follows it")

    def test_upgrade_keeps_an_open_edit_session_and_what_agents_were_handed_and_the_session_stays_live(self):
        """A store at 41 with an edit session open, its delivery held, an exposure and the horizon: the step up keeps
        each of them as it was, adds the judgment's table, and the session is still its holder's to close."""
        message, author = self.sql("SELECT id,author_id FROM messages ORDER BY seq LIMIT 1")[0]
        now = store_module._delivery._now_ms()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("UPDATE message_edit_horizon SET seq=(SELECT max(seq) FROM messages)")
            db.execute("INSERT INTO message_edit_sessions VALUES (?,?,'h-laptop',1,1,'The person''s Core draft','open',?,NULL)",
                       (message, author, now))
            db.execute("INSERT INTO message_exposures VALUES ('agent-a',?,1)", (message,))
            held = db.execute("UPDATE deliveries SET state='held' WHERE message_id=? AND recipient_id='agent-a' AND state='pending'",
                              (message,)).rowcount
        self.assertEqual(held, 1, "agent-a's delivery of the message is held")
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_JUDGMENT,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        after = everything(self.path)
        self.assertEqual(after.pop("release_judgments"), [], "the judgment's table exists, empty")
        self.assertEqual(after.pop("agent_invitations"), [], "and the invitations' step after it fills none")
        tools_taken(after)
        self.assertEqual(after.pop("outcome_ends"), [], "nor the ends' step after that")
        for table in ("message_edit_sessions", "message_exposures", "message_edit_horizon", "deliveries"):
            self.assertEqual(after[table], stored[table], "%s is kept as it was" % table)
        self.assertEqual(after, stored, "every row of every table is kept")
        # Stepping back to 40 is still refused for the open session, and changes nothing.
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            migrate(self.path, "test-instance", self.binding, BEFORE_SESSION)
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        # The session is its holder's: closing it ends the hold.
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        closed = self.command("message.edit_close", {"holder": "h-laptop"}, {"message_id": message})
        self.assertEqual(closed["status"], "committed", closed)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='held'"), [(0,)])

    def test_upgrade_keeps_every_row_matches_a_fresh_instance_and_takes_a_judgment(self):
        self.recorded()
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_JUDGMENT,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        after = everything(self.path)
        self.assertEqual((after.pop("release_judgments"), after.pop("agent_invitations"), after.pop("outcome_ends")), ([], [], []))
        self.assertEqual(tools_taken(after), stored, "every row is kept")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertTrue(self.attach()["attached"])

    def test_step_back_restores_the_frozen_layout_and_every_row_while_no_judgment_is_attached(self):
        self.recorded()
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_JUDGMENT))
        self.assertEqual(everything(self.path), stored)
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_a_judgment_is_attached_and_changes_nothing(self):
        self.recorded()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.attach()
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class SessionStepCase(MigrationCase):
    """An instance at the edit's version (40) holding a person's messages delivered to agents, an edited one and a
    correction: the session's step (40->41) keeps every row, sets the horizon to the last message at the upgrade,
    matches a fresh instance (and names no SQL function in the schema), and steps back only while no edit session is
    open and no delivery is held (item 452, docs/message-edit.md)."""

    VERSION, FIXTURE = BEFORE_SESSION, SCHEMA_BEFORE_SESSION

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_SESSION)

    def first(self):
        return self.sql("SELECT id FROM messages ORDER BY seq LIMIT 1")[0][0]

    def session(self, verb, message, holder="h-laptop", **args):
        receipt = self.command("message.edit_" + verb, dict({"holder": holder}, **args), {"message_id": message}, args.pop("expected", None))
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_edits_and_the_judgments_step_follows_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertIn((BEFORE_SESSION, SESSION_VERSION), steps)
        self.assertEqual(steps[steps.index((BEFORE_SESSION, SESSION_VERSION)) + 1], (BEFORE_JUDGMENT, JUDGMENT_VERSION))

    def test_upgrade_keeps_every_row_sets_the_horizon_and_matches_a_fresh_instance(self):
        stored = everything(self.path)
        top = self.sql("SELECT max(seq) FROM messages")[0][0]
        self.assertGreater(top, 0)
        # Upgraded to the head, through the invitations' step, which adds a table and no row.
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_SESSION,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        self.assertFalse([sql for sql in schema(self.path) if "marked_words" in sql], "no schema object names the SQL function")
        after = everything(self.path)
        self.assertEqual(after.pop("message_edit_horizon"), [(top,)], "the horizon is the last message at the upgrade")
        self.assertEqual((after.pop("message_edit_sessions"), after.pop("message_exposures"), after.pop("agent_invitations"), after.pop("outcome_ends")),
                         ([], [], [], []))
        self.assertEqual(after.pop("release_judgments"), [], "the judgment's step, run next, adds an empty table")
        self.assertEqual(tools_taken(after), stored, "every row of every table is kept")
        # A fresh instance has horizon 0.
        fresh = Path(self.temp.name) / "fresh"
        with sqlite3.connect(str(fresh / "fresh.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT seq FROM message_edit_horizon").fetchall(), [(0,)])
        # Each schema object and trigger refuses what it should.
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO message_exposures VALUES ('agent-a',?,2)", (self.first(),))
            for statement, text in (("UPDATE message_exposures SET revision=1", "an exposure only grows"),
                                    ("DELETE FROM message_exposures", "an exposure is kept")):
                with self.subTest(statement=statement), self.assertRaisesRegex(sqlite3.IntegrityError, text):
                    db.execute(statement)
            db.execute("UPDATE message_exposures SET revision=3")
            self.assertEqual(db.execute("SELECT revision FROM message_exposures").fetchall(), [(3,)], "it grows")

    def test_step_back_is_refused_while_a_session_is_open_held_or_lapsed_or_a_delivery_is_held(self):
        message = self.first()
        stored = everything(self.path)
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.session("open", message)
        self.assertTrue(self.sql("SELECT count(*) FROM deliveries WHERE state='held'")[0][0], "agent-a's delivery is held")
        for state, statement in (("held", None), ("lapsed", "UPDATE message_edit_sessions SET renewed_ms=renewed_ms-1000000"),
                                 ("lapsed and released", "UPDATE message_edit_sessions SET released_ms=renewed_ms")):
            with self.subTest(state=state):
                if statement:
                    self.sql(statement)
                before = self.unchanged()
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual(self.unchanged(), before)
                self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)
        # The open session is ended by its holder (a released lapse is not holding, so nothing is moved by the close).
        self.sql("UPDATE message_edit_sessions SET released_ms=NULL,renewed_ms=?", (store_module._delivery._now_ms(),))
        self.assertEqual(self.session("close", message)["closed"], True)
        self.assertEqual(self.sql("SELECT count(*) FROM deliveries WHERE state='held'"), [(0,)], "with every session ended, no row is held")
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_SESSION))
        back = everything(self.path)
        # The session commands write their operations and changes, and the hold and its release move the schedule
        # (its generation and when it is due); every other row comes back as it was, every delivery the same row.
        written = ("changes", "operations", "recipient_schedule", "sqlite_sequence")
        self.assertEqual({k: v for k, v in back.items() if k not in written}, {k: v for k, v in stored.items() if k not in written},
                         "every row the session commands did not write comes back as it was")
        self.assertEqual([row for row in back["sqlite_sequence"] if row[0] != "changes"], [row for row in stored["sqlite_sequence"] if row[0] != "changes"])
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_a_saved_or_closed_session_does_not_hold_the_step_back_and_a_held_row_alone_does(self):
        message = self.first()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.session("open", message)
        self.session("close", message)
        self.assertEqual(self.sql("SELECT state FROM message_edit_sessions"), [("closed",)])
        # A held delivery with no open session is outside the invariant; the step back still refuses it.
        self.sql("UPDATE deliveries SET state='held' WHERE id=(SELECT id FROM deliveries WHERE recipient_id='agent-a' ORDER BY seq LIMIT 1)")
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.sql("UPDATE deliveries SET state='pending' WHERE state='held'")
        self.sql("UPDATE message_edit_sessions SET state='saved'")
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_SESSION))

    def test_the_horizon_is_set_again_by_the_next_step_up(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        later = self.command("message.post", {"body": "After the first upgrade"}, {"topic_id": "t1"})
        self.assertEqual(later["status"], "committed", later)
        self.assertTrue(self.step_back()["migrated"])
        self.assertTrue(self.upgrade()["migrated"])
        self.assertEqual(self.sql("SELECT seq FROM message_edit_horizon"), self.sql("SELECT max(seq) FROM messages"),
                         "every message before the second upgrade counts as handed: over-correcting, never missing one")

class InviteStepCase(MigrationCase):
    """An instance at the judgment's version (42), as release 81 leaves it, where agents are invited from an outcome's
    page (item 324) and no one's invitation is kept: the invitations' step (42->43) keeps every row, matches a fresh
    instance, and steps back only while no one has been invited (item 525, docs/agents.md "Inviting an agent")."""

    VERSION, FIXTURE = BEFORE_INVITES, SCHEMA_BEFORE_INVITES

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_INVITES)

    def invite(self, name):
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        receipt = self.command("workspace.agent_invite", {"name": name, "harness": "codex"}, {"workspace_id": "w1"}, {"workspace_revision": version})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def recorded_at_42(self, actor, op, envelope, receipt):
        """A receipt among the operations as release 81's Store.command records it, under its request's fingerprint."""
        fingerprint = hashlib.sha256(_json(_command_envelope(envelope)).encode("utf-8")).hexdigest()
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO operations VALUES (?,?,?,?,?)", (actor, op, fingerprint, envelope["kind"], _json(receipt)))

    def envelope(self, name, op):
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        return {"v": 1, "instance_id": "test-instance", "operation_id": op, "kind": "workspace.agent_invite",
                "target": {"workspace_id": "w1"}, "expected": {"workspace_revision": version, "authority": dict(self.pin)},
                "args": {"name": name, "harness": "codex"}}

    def invited_at_42(self, name, agent, op="invite-at-42", actor="owner"):
        """actor invites an agent from the page as release 81 does it (item 324): the agent registered under the ID
        324's rule gave it, on w1's team, the outcome's version advanced and the committed receipt recorded, and no
        invitation row, since version 42 keeps none. Returns the request, for sending again."""
        envelope = self.envelope(name, op)
        version = envelope["expected"]["workspace_revision"] + 1
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO actors(id,kind,name) VALUES (?,?,?)", (agent, "agent", name))
            db.execute("INSERT INTO workspace_members VALUES ('w1',?)", (agent,))
            db.execute("UPDATE workspaces SET version=? WHERE id='w1'", (version,))
        self.recorded_at_42(actor, op, envelope, {
            "instance_id": "test-instance", "operation_id": op, "kind": "workspace.agent_invite", "status": "committed",
            "recorded": True, "result": {"workspace_id": "w1", "title": "Isolated test", "version": version, "harness": "codex",
                                         "agent": {"id": agent, "name": name, "kind": "agent"}},
            "affected": [{"kind": "workspace", "id": "w1", "version": version}]})
        return envelope

    def refused_at_42(self, actor, name, op, code):
        """A refused invitation as release 81 records it: no result, nothing registered."""
        envelope = self.envelope(name, op)
        self.recorded_at_42(actor, op, envelope, {
            "instance_id": "test-instance", "operation_id": op, "kind": "workspace.agent_invite", "status": "rejected",
            "recorded": True, "result": None, "affected": [], "error": {"code": code, "message": "Refused.", "retryable": False}})

    def folder(self):
        folder = Path(self.temp.name).resolve() / "profiles"
        folder.mkdir(mode=0o700, exist_ok=True)
        return folder

    def test_an_agent_invited_at_42_is_given_back_to_its_inviter_after_the_upgrade_with_its_sign_in(self):
        # 324 live: the owner invites Late scribe; the answer is lost, or the sign-in file is not written; a reload forgets
        # the request. Release 81 refuses the name typed again (NAME_TAKEN) and no sign-in file exists. After the upgrade
        # the same person typing it in the same outcome gets that agent back, and its sign-in file is written.
        self.invited_at_42("Late scribe", "late-scribe")
        # The coordinator invites one too: the receipt says who invited it, not the outcome's owner.
        self.invited_at_42("Night watch", "night-watch", op="coordinator-invites", actor="agent-a")
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        folder, actors = self.folder(), self.sql("SELECT * FROM actors ORDER BY id")
        receipt = invite(self.store, "owner", self.envelope("Late scribe", "retyped"), folder)
        self.assertEqual(receipt["status"], "committed", receipt)
        self.assertEqual(self.sql("SELECT agent_id,workspace_id,inviter_id FROM agent_invitations ORDER BY agent_id"),
                         [("late-scribe", "w1", "owner"), ("night-watch", "w1", "agent-a")], "the upgrade filled each invitation from its receipt")
        self.assertEqual(receipt["result"]["agent"], {"id": "late-scribe", "name": "Late scribe", "kind": "agent"})
        self.assertTrue(receipt["sign_in"]["written"], receipt)
        self.assertEqual(load_profile(folder / "late-scribe.profile.json").actor_id, "late-scribe")
        self.assertEqual(self.sql("SELECT * FROM actors ORDER BY id"), actors, "no one is registered again")
        # Anyone else typing that name is still refused: the coordinator, though it organises the outcome.
        refused = invite(self.store, "agent-a", self.envelope("Late scribe", "coordinator-types-it"), folder)
        self.assertEqual((refused["status"], refused["error"]["code"]), ("rejected", "NAME_TAKEN"), refused)
        # Night watch is the coordinator's to have back, and the owner typing it is refused.
        refused = invite(self.store, "owner", self.envelope("Night watch", "owner-types-it"), folder)
        self.assertEqual((refused["status"], refused["error"]["code"]), ("rejected", "NAME_TAKEN"), refused)
        self.assertEqual(sorted(os.listdir(folder)), ["late-scribe.profile.json"])
        given = invite(self.store, "agent-a", self.envelope("Night watch", "coordinator-retypes"), folder)
        self.assertEqual(given["status"], "committed", given)
        self.assertEqual((given["result"]["agent"]["id"], given["sign_in"]["written"]), ("night-watch", True), given)
        self.assertEqual(self.sql("SELECT * FROM actors ORDER BY id"), actors, "no one is registered again")

    def test_a_name_invited_under_324s_id_rule_is_given_back_under_its_id_not_checked_at_the_new_rules_place(self):
        # 324 cut IDs as [a-z0-9] without taking accents off, so Søren was registered s-ren; 525's rule makes soren. The
        # server finds the agent through its invitation, so what is at soren.profile.json (here the coordinator's own
        # sign-in file) is not looked at, retyped as a new request or the same request sent again after a lost answer.
        sent = self.invited_at_42("Søren", "s-ren")
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        folder = self.folder()
        # Someone else typing Søren is refused, and nothing is written.
        refused = invite(self.store, "agent-a", self.envelope("Søren", "coordinator-types-it"), folder)
        self.assertEqual((refused["status"], refused["error"]["code"]), ("rejected", "NAME_TAKEN"), refused)
        self.assertEqual(os.listdir(folder), [])
        theirs = folder / "soren.profile.json"
        write_profile(theirs, self.path, "test-instance", "agent-a", binding=self.binding)
        held, actors = theirs.read_bytes(), self.sql("SELECT * FROM actors ORDER BY id")
        for envelope in (self.envelope("Søren", "retyped"), sent):
            receipt = invite(self.store, "owner", envelope, folder)
            self.assertEqual(receipt["status"], "committed", receipt)
            self.assertEqual((receipt["result"]["agent"], receipt["sign_in"]["written"], receipt["sign_in"]["path"]),
                             ({"id": "s-ren", "name": "Søren", "kind": "agent"}, True, str(folder / "s-ren.profile.json")))
        self.assertEqual(load_profile(folder / "s-ren.profile.json").actor_id, "s-ren")
        self.assertEqual((theirs.read_bytes(), self.sql("SELECT * FROM actors ORDER BY id")), (held, actors), "kept, and no one registered")
        # New names get IDs by 525's rule and the old ID stands: Bjørn is bjorn, and Soren, a name of its own, is soren.
        theirs.unlink()
        for name, agent in (("Bjørn", "bjorn"), ("Soren", "soren")):
            fresh = invite(self.store, "owner", self.envelope(name, "fresh-" + agent), folder)
            self.assertEqual(fresh["status"], "committed", fresh)
            self.assertEqual(fresh["result"]["agent"]["id"], agent)
        self.assertEqual(self.sql("SELECT id,name FROM actors WHERE id IN ('s-ren','soren','bjorn') ORDER BY id"),
                         [("bjorn", "Bjørn"), ("s-ren", "Søren"), ("soren", "Soren")])
        # With soren taken by another agent, the inviter typing Søren still gets s-ren back, found by its invitation.
        again = invite(self.store, "owner", self.envelope("Søren", "retyped-again"), folder)
        self.assertEqual(again["status"], "committed", again)
        self.assertEqual((again["result"]["agent"]["id"], again["sign_in"]["written"]), ("s-ren", True), again)

    def test_someone_elses_file_at_the_invited_agents_own_place_is_refused_before_core_is_asked(self):
        # The place checked before Core is asked is the invited agent's own, s-ren.profile.json, under 324's ID.
        self.invited_at_42("Søren", "s-ren")
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        folder = self.folder()
        write_profile(folder / "s-ren.profile.json", self.path, "test-instance", "agent-a", binding=self.binding)
        operations = self.sql("SELECT count(*) FROM operations")
        receipt = invite(self.store, "owner", self.envelope("Søren", "retyped"), folder)
        self.assertEqual((receipt["status"], receipt["recorded"], (receipt.get("error") or {}).get("code")), ("rejected", False, "SIGN_IN_TAKEN"), receipt)
        self.assertIn("s-ren.profile.json", receipt["error"]["message"])
        self.assertEqual(self.sql("SELECT count(*) FROM operations"), operations, "Core was not asked")

    def test_a_fresh_soren_invited_after_the_upgrade_gets_525s_id(self):
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        folder = self.folder()
        receipt = invite(self.store, "owner", self.envelope("Søren", "fresh"), folder)
        self.assertEqual((receipt["result"]["agent"]["id"], receipt["sign_in"]["path"]), ("soren", str(folder / "soren.profile.json")), receipt)
        self.assertEqual(load_profile(folder / "soren.profile.json").actor_id, "soren")

    def test_a_receipt_that_never_committed_fills_no_invitation_and_the_step_keeps_every_row(self):
        self.refused_at_42("agent-b", "Sneaky helper", "refused-forbidden", "FORBIDDEN")
        self.refused_at_42("owner", "agent-a", "refused-taken", "NAME_TAKEN")
        stored = everything(self.path)
        self.assertEqual(self.upgrade()["migrated"], True)
        after = everything(self.path)
        self.assertEqual(after.pop("agent_invitations"), [], "a refusal registered no one, so it invited no one")
        self.assertEqual(after.pop("outcome_ends"), [], "and the ends' step after it finds no outcome ended")
        self.assertEqual(tools_taken(after), stored, "every row of every table is kept")

    def test_the_step_follows_the_judgments_and_the_tools_step_follows_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertEqual(steps[-6:-3], [(BEFORE_JUDGMENT, JUDGMENT_VERSION), (BEFORE_INVITES, INVITES_VERSION), (BEFORE_TOOLS, TOOLS_VERSION)])
        self.assertEqual([step for step in steps if step[0] == BEFORE_INVITES or step[1] == INVITES_VERSION],
                         [(BEFORE_INVITES, INVITES_VERSION)], "one step leaves 42 and one reaches 43")
        self.assertEqual((BEFORE_INVITES, INVITES_VERSION), ("42", "43"))
        self.assertEqual(steps[-3], (BEFORE_ENDS, ENDS_VERSION), "the ends' step follows the tools'")

    def test_a_store_release_81_left_at_42_gains_the_invitations_once_upgraded(self):
        # Release 81 (324 live) stores version 42 without agent_invitations: the upgrade must still create it, so a
        # step numbered from 41 again, which a store at 42 never runs, leaves the live store without it.
        self.assertEqual((self.metadata()["schema_version"], schema(self.path)), ("42", frozen(SCHEMA_BEFORE_INVITES)))
        migrate(self.path, "test-instance", self.binding)
        with sqlite3.connect(str(self.path)) as db:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        self.assertIn("agent_invitations", tables, "the invitations' step ran on a store release 81 left at 42")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.invite("Late scribe")["agent"]["id"], "late-scribe")
        self.assertEqual(self.sql("SELECT agent_id,workspace_id,inviter_id FROM agent_invitations"), [("late-scribe", "w1", "owner")])

    def test_upgrade_keeps_every_row_knows_no_invitation_and_matches_a_fresh_instance(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_INVITES,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        after = everything(self.path)
        self.assertEqual(after.pop("agent_invitations"), [], "no agent is known to have been invited before the step")
        self.assertEqual(after.pop("outcome_ends"), [], "and the ends' step after it finds no outcome ended")
        self.assertEqual(tools_taken(after), stored, "every row of every table is kept")

    def test_step_back_is_refused_once_an_agent_is_invited_and_restores_the_layout_while_none_is(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"], "nothing invited yet")
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_INVITES))
        self.assertEqual(everything(self.path), stored)
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.invite("Late scribe")
        self.assertEqual(self.sql("SELECT agent_id,workspace_id,inviter_id FROM agent_invitations"), [("late-scribe", "w1", "owner")])
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class ToolsStepCase(MigrationCase):
    """An instance at the invitations' version (43), as train 21 leaves it: the tools' step (43->44, item 17,
    docs/skills-and-tools.md) adds three append-only tables, empty, keeps every row, matches its frozen layout (44's, a
    fresh instance's before the ends' step), and steps back only while each is empty."""

    VERSION, FIXTURE = BEFORE_TOOLS, SCHEMA_BEFORE_TOOLS

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, TOOLS_VERSION)

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_TOOLS)

    def test_the_step_follows_the_invitations_and_the_ends_step_follows_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertEqual(steps[-5:-2], [(BEFORE_INVITES, INVITES_VERSION), (BEFORE_TOOLS, TOOLS_VERSION), (BEFORE_ENDS, ENDS_VERSION)])
        self.assertEqual([step for step in steps if step[0] == BEFORE_TOOLS or step[1] == TOOLS_VERSION],
                         [(BEFORE_TOOLS, TOOLS_VERSION)], "one step leaves 43 and one reaches 44")
        self.assertEqual((BEFORE_TOOLS, TOOLS_VERSION), ("43", "44"))

    def test_upgrade_keeps_every_row_adds_the_tables_empty_and_matches_a_fresh_instance(self):
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_TOOLS,
                                          "schema_version": TOOLS_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_ENDS), "tables, indexes and triggers match a fresh instance at 44")
        self.assertEqual(tools_taken(everything(self.path)), stored, "every row of every table is kept")

    def test_step_back_restores_the_layout_while_nothing_is_said_and_is_refused_once_anything_is(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"], "nothing said yet")
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_TOOLS))
        self.assertEqual(everything(self.path), stored)
        rows = {"tool_uses": "INSERT INTO tool_uses VALUES ('w1','kite-flyer',1,1,'owner',1)",
                "tool_links": "INSERT INTO tool_links VALUES ('t1','kite-flyer',1,1,'owner',1)",
                "tool_runs": "INSERT INTO tool_runs(id,tool_id,name,home_workspace_id,content_id,commit_sha,tree_sha,live_commit,check_path,"
                             "result,passed,total,failing,failing_more,why,fate,first_version,items_back,topic_id,recorded_by,recorded_ms) "
                             "VALUES ('tr-1','kite-flyer','Kite flyer','w1','%s','%s','%s','%s','tests/test_tools_kite.py','passed',1,1,'[]',0,"
                             "NULL,'live',0,'[]',NULL,'owner',1)" % ("5" * 64, "1" * 40, "2" * 40, "3" * 40)}
        for table, insert in rows.items():
            with self.subTest(kept=table):
                self.upgrade()
                with sqlite3.connect(str(self.path)) as db:
                    db.execute(insert)
                before = self.unchanged(), everything(self.path)
                with self.assertRaises(MigrationError) as raised:
                    self.step_back()
                self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
                self.assertEqual((self.unchanged(), everything(self.path)), before, "the refusal changes nothing")
                self.assertEqual(self.metadata()["schema_version"], TOOLS_VERSION)
                # Each table is append-only, so a fresh copy of the 43 store goes on to the next table.
                with sqlite3.connect(str(self.path)) as db:
                    db.execute("DROP TRIGGER %s_stay_d" % table)
                    db.execute("DELETE FROM " + table)
                    db.execute("CREATE TRIGGER %s_stay_d BEFORE DELETE ON %s BEGIN SELECT RAISE(ABORT, 'kept'); END" % (table, table))
                self.assertTrue(self.step_back()["migrated"])


class EndsStepCase(MigrationCase):
    """An instance at the tools' version (44), as train 27 leaves it: the ends' step (44->45) keeps
    every row, matches a fresh instance, reads every outcome as open, and steps back only while no outcome has been
    archived or completed (item 404, docs/targets.md "Archived and completed")."""

    VERSION, FIXTURE = BEFORE_ENDS, SCHEMA_BEFORE_ENDS

    def upgrade(self):
        return migrate(self.path, "test-instance", self.binding, ENDS_VERSION)

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_ENDS)

    def end(self, state):
        version = self.sql("SELECT version FROM workspaces WHERE id='w1'")[0][0]
        receipt = self.command("outcome.end_set", {"state": state}, {"workspace_id": "w1"}, {"workspace_revision": version})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_tools_and_the_covers_step_follows_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertEqual(steps[-4:-2], [(BEFORE_TOOLS, TOOLS_VERSION), (BEFORE_ENDS, ENDS_VERSION)])
        self.assertEqual([step for step in steps if step[0] == BEFORE_ENDS or step[1] == ENDS_VERSION],
                         [(BEFORE_ENDS, ENDS_VERSION)], "one step leaves 44 and one reaches 45")
        self.assertEqual((BEFORE_ENDS, ENDS_VERSION), ("44", "45"))
        self.assertEqual(steps[-2], (BEFORE_COVERS, COVERS_VERSION), "the covers' step follows the ends'")

    def test_upgrade_keeps_every_row_reads_every_outcome_open_and_matches_a_fresh_instance(self):
        self.assertEqual((self.metadata()["schema_version"], schema(self.path)), (BEFORE_ENDS, frozen(SCHEMA_BEFORE_ENDS)))
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_ENDS,
                                          "schema_version": ENDS_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_COVERS), "tables, indexes and triggers match a fresh instance at 45")
        after = everything(self.path)
        self.assertEqual(after.pop("outcome_ends"), [], "no outcome is archived or completed before the step")
        self.assertEqual(after, stored, "every row of every table is kept")
        migrate(self.path, "test-instance", self.binding)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        listing = self.store.view("owner", "workspaces", {})
        self.assertEqual(([item["id"] for item in listing["items"]], [item["end"] for item in listing["items"]], listing["ended_count"]),
                         (["w1"], [None], 0), "every outcome reads as open, and nothing is listed as ended")
        self.assertIsNone(self.store.view("owner", "workspace", {"workspace_id": "w1"})["workspace"]["end"])
        self.assertEqual(self.end("archived")["changed"], True, "the act works on an upgraded store")

    def test_step_back_is_refused_once_an_outcome_has_ended_even_brought_back_and_restores_the_layout_while_none_has(self):
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"], "nothing ended yet")
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_ENDS))
        self.assertEqual(everything(self.path), stored)
        migrate(self.path, "test-instance", self.binding)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.end("archived")
        self.end("open")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)


class CoverStepCase(MigrationCase):
    """An instance at the ends' version (45), as train 28 leaves it: the covers' step (45->46) lets message_acts hold a
    dossier's cover, keeping every act, its id and where the ids go on, matches a fresh instance, and steps back only
    while no cover was ever written (item 624, docs/dossier-covers.md)."""

    VERSION, FIXTURE = BEFORE_COVERS, SCHEMA_BEFORE_COVERS

    def step_back(self):
        return migrate(self.path, "test-instance", self.binding, BEFORE_COVERS)

    def acted(self):
        """Two acts recorded at version 45, and a third whose row is gone, so the table's ids have gone further than
        its rows: a rebuilt table must go on from there."""
        with sqlite3.connect(str(self.path)) as db:
            message, topic, seq = db.execute("SELECT id,topic_id,seq FROM messages ORDER BY seq LIMIT 1").fetchone()
            for kind, owner, value in (("star", "owner", '{"starred":true}'), ("name", "", '{"name":"Ours"}'), ("join", "", '{"into":null}')):
                db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) VALUES (?,?,?,?,?,?,?,?,1)",
                           (kind, message, topic, seq, owner, "owner", value, 5))
            db.execute("DELETE FROM message_acts WHERE kind='join'")
        return message

    def cover(self, message, args, revision=0):
        receipt = self.command("stack.cover", args, {"message_id": message}, {"cover_revision": revision})
        self.assertEqual(receipt["status"], "committed", receipt)
        return receipt["result"]

    def test_the_step_follows_the_ends_and_topic_positions_follow_it(self):
        steps = [step[:2] for step in migrations.STEPS if int(step[1]) <= 47]
        self.assertEqual(steps[-3:], [(BEFORE_ENDS, ENDS_VERSION), (BEFORE_COVERS, COVERS_VERSION), ("46", "47")])
        self.assertEqual([step for step in steps if step[0] == BEFORE_COVERS or step[1] == COVERS_VERSION],
                         [(BEFORE_COVERS, COVERS_VERSION)], "one step leaves 45 and one reaches 46")
        self.assertEqual((BEFORE_COVERS, COVERS_VERSION, SCHEMA_VERSION), ("45", "46", "49"))

    def test_item_641_covers_45_to_46_precedes_positions_46_to_47(self):
        message = self.acted()
        stored = everything(self.path)
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "46")["schema_version"], "46")
        self.assertEqual(schema(self.path), frozen(SCHEMA_46))
        self.assertEqual(everything(self.path), stored, "the cover rebuild keeps every act and its next id")
        self.assertEqual(self.sql("SELECT count(*) FROM pragma_table_info('topics') WHERE name='list_position'"), [(0,)])
        with sqlite3.connect(str(self.path)) as db:
            db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) "
                       "SELECT 'cover',id,topic_id,seq,'','owner','{}',5,1 FROM messages WHERE id=?", (message,))
        stored = everything(self.path)
        self.assertEqual(migrate(self.path, "test-instance", self.binding)["schema_version"], SCHEMA_VERSION)
        self.assertEqual(everything(self.path), stored, "positions preserve the cover and every retained record")
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        self.assertEqual(self.sql("SELECT count(*) FROM topics WHERE list_position>0"), [(2,)])
        self.assertEqual(migrate(self.path, "test-instance", self.binding, "46")["schema_version"], "46")
        self.assertEqual(everything(self.path), stored, "topic rollback does not remove covers")
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            migrate(self.path, "test-instance", self.binding, "45")
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST")
        self.assertEqual(self.unchanged(), before)

    def test_before_the_step_a_cover_cannot_be_kept(self):
        message = self.acted()
        with sqlite3.connect(str(self.path)) as db, self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO message_acts(kind,message_id,topic_id,seq,owner,actor_id,value,at_ms,revision) "
                       "SELECT 'cover',id,topic_id,seq,'','owner','{}',5,1 FROM messages WHERE id=?", (message,))

    def test_upgrade_keeps_every_act_and_its_ids_matches_a_fresh_instance_and_a_cover_is_kept(self):
        message = self.acted()
        stored = everything(self.path)
        self.assertEqual(self.upgrade(), {"instance_id": "test-instance", "from_version": BEFORE_COVERS,
                                          "schema_version": SCHEMA_VERSION, "migrated": True})
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name), "tables, indexes and triggers match a fresh instance")
        self.assertEqual(everything(self.path), stored, "every row is kept, sqlite_sequence's place for the acts included")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        covered = self.cover(message, {"stands": "Kept across the step"})
        self.assertEqual((covered["cover_revision"], covered["acts_version"]), (1, 4), "the next act's id follows the gone one")
        acts = self.store.view("owner", "topic_messages", {"topic_id": "t1", "direction": "before", "limit": 50})["items"]
        mine = next(item["acts"] for item in acts if item["id"] == message)
        self.assertEqual((mine["starred"], mine["name"]["text"], mine["cover"]["stands"]), (True, "Ours", "Kept across the step"))

    def test_step_back_restores_the_frozen_layout_and_every_row_while_no_cover_was_written(self):
        self.acted()
        stored = everything(self.path)
        self.upgrade()
        self.assertTrue(self.step_back()["migrated"])
        self.assertEqual(schema(self.path), frozen(SCHEMA_BEFORE_COVERS))
        self.assertEqual(everything(self.path), stored, "every act and the acts' place in sqlite_sequence come back")
        self.assertTrue(self.upgrade()["migrated"], "and it moves up again")

    def test_step_back_refuses_once_a_cover_was_written_even_cleared_and_changes_nothing(self):
        message = self.acted()
        self.upgrade()
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.cover(message, {"stands": "Written"})
        self.cover(message, {"stands": None}, revision=1)
        before = self.unchanged()
        with self.assertRaises(MigrationError) as raised:
            self.step_back()
        self.assertEqual(raised.exception.code, "RECORDS_WOULD_BE_LOST", "a cleared cover still holds its rows")
        self.assertEqual(self.unchanged(), before)
        self.assertEqual(self.metadata()["schema_version"], SCHEMA_VERSION)

# Do not rerun the inherited StoreCase tests during module discovery.
for _name in list(fixtures.StoreCase.__dict__):
    if _name.startswith("test_") and _name not in MigrationCase.__dict__:
        setattr(MigrationCase, _name, None)
# The schema-8 cases already run once, from MigrationCase.
for _name in list(MigrationCase.__dict__):
    if _name.startswith("test_") and _name not in Release19ChainCase.__dict__:
        setattr(Release19ChainCase, _name, None)
    if _name.startswith("test_") and _name not in LiveShapedChainCase.__dict__:
        setattr(LiveShapedChainCase, _name, None)
    if _name.startswith("test_") and _name not in Schema9Case.__dict__:
        setattr(Schema9Case, _name, None)
    if _name.startswith("test_") and _name not in Schema10Case.__dict__:
        setattr(Schema10Case, _name, None)
    if _name.startswith("test_") and _name not in Schema11Case.__dict__:
        setattr(Schema11Case, _name, None)
    if _name.startswith("test_") and _name not in Schema12Case.__dict__:
        setattr(Schema12Case, _name, None)
    if _name.startswith("test_") and _name not in Schema13Case.__dict__:
        setattr(Schema13Case, _name, None)
    if _name.startswith("test_") and _name not in Schema14Case.__dict__:
        setattr(Schema14Case, _name, None)
    if _name.startswith("test_") and _name not in Schema15Case.__dict__:
        setattr(Schema15Case, _name, None)
    if _name.startswith("test_") and _name not in Schema16Case.__dict__:
        setattr(Schema16Case, _name, None)
    if _name.startswith("test_") and _name not in Schema17Case.__dict__:
        setattr(Schema17Case, _name, None)
    if _name.startswith("test_") and _name not in Schema18Case.__dict__:
        setattr(Schema18Case, _name, None)
    if _name.startswith("test_") and _name not in Schema19Case.__dict__:
        setattr(Schema19Case, _name, None)
    if _name.startswith("test_") and _name not in Schema25Case.__dict__:
        setattr(Schema25Case, _name, None)
    if _name.startswith("test_") and _name not in Schema26Case.__dict__:
        setattr(Schema26Case, _name, None)
    if _name.startswith("test_") and _name not in Schema27Case.__dict__:
        setattr(Schema27Case, _name, None)
    if _name.startswith("test_") and _name not in PipelineStepCase.__dict__:
        setattr(PipelineStepCase, _name, None)
    if _name.startswith("test_") and _name not in HealthStepCase.__dict__:
        setattr(HealthStepCase, _name, None)
    if _name.startswith("test_") and _name not in ChecksStepCase.__dict__:
        setattr(ChecksStepCase, _name, None)
    if _name.startswith("test_") and _name not in SettleStepCase.__dict__:
        setattr(SettleStepCase, _name, None)
    if _name.startswith("test_") and _name not in ReactionStepCase.__dict__:
        setattr(ReactionStepCase, _name, None)
    if _name.startswith("test_") and _name not in OrderStepCase.__dict__:
        setattr(OrderStepCase, _name, None)
    if _name.startswith("test_") and _name not in StacksStepCase.__dict__:
        setattr(StacksStepCase, _name, None)
    if _name.startswith("test_") and _name not in BlocksStepCase.__dict__:
        setattr(BlocksStepCase, _name, None)
    if _name.startswith("test_") and _name not in FoldStepCase.__dict__:
        setattr(FoldStepCase, _name, None)
    if _name.startswith("test_") and _name not in DraftStepCase.__dict__:
        setattr(DraftStepCase, _name, None)
    if _name.startswith("test_") and _name not in EditStepCase.__dict__:
        setattr(EditStepCase, _name, None)
    if _name.startswith("test_") and _name not in SessionStepCase.__dict__:
        setattr(SessionStepCase, _name, None)
    if _name.startswith("test_") and _name not in InviteStepCase.__dict__:
        setattr(InviteStepCase, _name, None)
    if _name.startswith("test_") and _name not in ToolsStepCase.__dict__:
        setattr(ToolsStepCase, _name, None)
    if _name.startswith("test_") and _name not in EndsStepCase.__dict__:
        setattr(EndsStepCase, _name, None)
    if _name.startswith("test_") and _name not in CoverStepCase.__dict__:
        setattr(CoverStepCase, _name, None)
    if _name.startswith("test_") and _name not in JudgmentStepCase.__dict__:
        setattr(JudgmentStepCase, _name, None)
    if _name.startswith("test_") and _name not in Schema20Case.__dict__:
        setattr(Schema20Case, _name, None)
    if _name.startswith("test_") and _name not in Schema21Case.__dict__:
        setattr(Schema21Case, _name, None)
    if _name.startswith("test_") and _name not in Schema22Case.__dict__:
        setattr(Schema22Case, _name, None)
    if _name.startswith("test_") and _name not in Schema23Case.__dict__:
        setattr(Schema23Case, _name, None)
    if _name.startswith("test_") and _name not in Schema24Case.__dict__:
        setattr(Schema24Case, _name, None)
for _name in list(Schema11Case.__dict__):
    if _name.startswith("test_") and _name not in EarlySchema12Case.__dict__:
        setattr(EarlySchema12Case, _name, None)


class TopicPositionStepCase(unittest.TestCase):
    """Item 641: the train35 46->47 step preserves facts and saved orders; default positions are durable."""
    def setUp(self):
        patcher = mock.patch('aim_next.dossier_order.published')
        patcher.start()
        self.addCleanup(patcher.stop)
        fixtures.StoreCase.setUp(self)
    command = fixtures.StoreCase.command
    sql = fixtures.StoreCase.sql
    workspace = fixtures.StoreCase.workspace
    save_draft = fixtures.StoreCase.save_draft
    prepare = fixtures.StoreCase.prepare
    create_topic = fixtures.StoreCase.create_topic

    def topic(self, tid):
        source = {"kind": "new_topic", "id": tid, "workspace_id": "w1"}
        saved = self.save_draft("draft-" + tid, source, tid, "Opening " + tid,
                                opening={"workspace_id": "w1", "title": tid, "participants": []})
        self.assertEqual(saved["status"], "committed", saved)
        self.assertEqual(self.prepare("draft-" + tid, tid, submission=tid, send_op="open-" + tid)["status"], "committed")
        self.assertEqual(self.command("topic.create_and_send", {"submission_id": tid}, {"topic_id": tid}, op="open-" + tid)["status"], "committed")

    def listed(self):
        return self.store.view("owner", "workspace_topics", {"workspace_id": "w1", "limit": 100})

    def test_item_641_upgrade_reads_never_migrate_and_keeps_saved_orders_and_creation_positions(self):
        self.create_topic()
        self.topic("t2")
        self.assertEqual(self.command("outline.order_set", {"ids": ["t1", "t2"]}, {"workspace_id": "w1"}, {"order_revision": 0})["status"], "committed")
        self.assertEqual(self.command("message.post", {"body": "Latest in the oldest"}, {"topic_id": "t1"})["status"], "committed")
        self.assertEqual(self.command("stack.cover", {"stands": "Kept through topic placement"},
                                      {"message_id": self.sql("SELECT id FROM messages WHERE topic_id='t1' ORDER BY seq LIMIT 1")[0][0]}, {"cover_revision": 0})["status"], "committed")
        step_back_by_hand(self.path, "46")
        self.assertEqual(schema(self.path), frozen(SCHEMA_46), "the exact train35 schema")
        stored, before = everything(self.path), self.path.read_bytes()
        with self.assertRaises(StoreOpenError):
            Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual(self.path.read_bytes(), before, "a read cannot migrate")
        self.assertEqual(migrations.STEPS[-3][:2], ("46", "47"), "no migration-number collision with the base")
        self.assertTrue(migrate(self.path, "test-instance", self.binding)["migrated"])
        self.assertEqual(everything(self.path), stored, "all pre-existing records, including saved orders and revisions, survive")
        self.assertEqual(schema(self.path), fresh_schema(self.temp.name))
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual([x["id"] for x in self.listed()["items"]], ["t2", "t1"], "creation, never recent activity")
        self.assertEqual(self.listed()["order"], {"ids": ["t1", "t2"], "revision": 1})
        # An id that sorts below old ids still enters first, and a backward clock cannot move it.
        self.topic("aa-new")
        want = ["aa-new", "t2", "t1"]
        self.assertEqual([x["id"] for x in self.listed()["items"]], want)
        positions = self.sql("SELECT id,list_position FROM topics ORDER BY id")
        self.assertEqual(len({n for _, n in positions}), len(positions), "each topic gets one position")
        self.assertEqual(self.command("message.post", {"body": "More in the oldest"}, {"topic_id": "t1"})["status"], "committed")
        with sqlite3.connect(str(self.path)) as db:
            db.execute("VACUUM")
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual([x["id"] for x in self.listed()["items"]], want, "restart and VACUUM preserve the order")
        self.assertEqual(self.sql("SELECT id,list_position FROM topics ORDER BY id"), positions, "activity changes no default position")
        before_order = self.listed()["order"]
        migrate(self.path, "test-instance", self.binding, "46")
        migrate(self.path, "test-instance", self.binding)
        self.store = Store(self.path, "test-instance", expected_binding=self.binding)
        self.assertEqual([x["id"] for x in self.listed()["items"]], want, "the retained creation facts rebuild the same order")
        self.assertEqual(self.listed()["order"], before_order)

    def test_item_641_an_empty_instance_steps_back_and_up_without_inventing_topics(self):
        migrate(self.path, "test-instance", self.binding, "46")
        self.assertEqual(schema(self.path), frozen(SCHEMA_46))
        migrate(self.path, "test-instance", self.binding)
        self.assertEqual(self.sql("SELECT * FROM topic_position_clock"), [(1, 0)])
        self.assertEqual(self.sql("SELECT count(*) FROM topics"), [(0,)])


if __name__ == "__main__":
    unittest.main()

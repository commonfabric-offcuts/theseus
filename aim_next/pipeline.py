from __future__ import annotations

"""An outcome's pipeline as records (item 84; docs/pipeline.md).

An outcome may turn on a pipeline: numbered items, each with where it came
from, in sections (Now, Next, Later, Candidates, Dropped); pieces of work that
move through the outcome's own stages; and every placement, edit and change of
stages kept as an event. Nothing here stores what another record already says:
shipped is read from the release records (releases.py), who placed an item
from its newest added or moved event, when a piece started from its first
stage entry.

A whisper is never where an item came from (private_source_refused).

Every path that changes what a piece holds or whether its items shipped (a release record, any move of an item,
a return to building, piece_start, combine, finish) changes only those facts and then asks one rule, _settle,
whether each piece the items were ever in has ended (shipped, dropped, or held as an emptied release) and
whether its topic is Done (D1). The rule reads the facts alone, so the same facts end a piece the same way in
any order. A release piece ships only by the record of its own number, the next one (_ship_release, which
record-release calls); the number itself is _the_release's.
"""

import json
import re
import sqlite3
import uuid

from .contract import LIMITS, Refusal, _body, _identifier, _json, _page_size, _prefix
from .delivery import _now_ms
from . import outcome_rules
from .work import work_by_topic
from .standing_conversation import partial
from .whispers import private_source_refused


# A stage entry keeps its past: once left, nothing in it changes, but (version 30) the end _settle wrote on a piece's last
# entry when a record overtakes a drop: a piece of work's `dropped` or `shipped`, or an emptied release's `held` or
# `dropped`, decided again as `shipped`, or as `held` saying what took the release's items. When and by whom it was left stay.
_KEEPS_ITS_PAST = (
    "CREATE TRIGGER entries_keep_their_past BEFORE UPDATE ON pipeline_stage_entries "
    "WHEN %s OR NEW.seq IS NOT OLD.seq OR NEW.piece_id IS NOT OLD.piece_id OR NEW.stage_id IS NOT OLD.stage_id "
    "OR NEW.round IS NOT OLD.round OR NEW.size IS NOT OLD.size OR NEW.entered_ms IS NOT OLD.entered_ms OR NEW.entered_by IS NOT OLD.entered_by "
    "OR NEW.ask_message_id IS NOT OLD.ask_message_id BEGIN SELECT RAISE(ABORT, 'a stage entry keeps its past'); END")
_DECIDED_AGAIN = (
    "(OLD.left_ms IS NOT NULL AND NOT (NEW.left_ms IS OLD.left_ms AND NEW.left_by IS OLD.left_by AND NEW.note IS OLD.note "
    "AND NEW.progress IS OLD.progress AND NOT EXISTS (SELECT 1 FROM pipeline_stage_entries e WHERE e.piece_id=OLD.piece_id AND e.seq>OLD.seq) "
    "AND (((SELECT kind FROM pipeline_pieces WHERE id=OLD.piece_id)='piece' AND OLD.left_outcome IN ('dropped','shipped') "
    "AND NEW.left_outcome='shipped') OR ((SELECT kind FROM pipeline_pieces WHERE id=OLD.piece_id)='release' "
    "AND OLD.left_outcome IN ('dropped','held') AND NEW.left_outcome IN ('held','shipped')))))")
PIPELINE_DECIDED_AGAIN_UP = ("DROP TRIGGER entries_keep_their_past", _KEEPS_ITS_PAST % _DECIDED_AGAIN)
PIPELINE_DECIDED_AGAIN_DOWN = ("DROP TRIGGER entries_keep_their_past", _KEEPS_ITS_PAST % "OLD.left_ms IS NOT NULL")
PIPELINE_SCHEMA = [
    "CREATE TABLE pipelines (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), "
    "enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), title TEXT NOT NULL, unit_one TEXT NOT NULL, unit_many TEXT NOT NULL, "
    "sized INTEGER NOT NULL CHECK(sized IN (0,1)), ships_in_releases INTEGER NOT NULL CHECK(ships_in_releases IN (0,1)), "
    "section_words TEXT NOT NULL, version INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX one_release_pipeline ON pipelines(ships_in_releases) WHERE ships_in_releases=1",
    "CREATE TABLE pipeline_stages (workspace_id TEXT NOT NULL REFERENCES pipelines(workspace_id), stage_id TEXT NOT NULL, "
    "position INTEGER, name TEXT NOT NULL, done_when TEXT NOT NULL, gate TEXT NOT NULL, "
    "rounds TEXT NOT NULL CHECK(rounds IN ('none','together','split')), scope TEXT NOT NULL CHECK(scope IN ('piece','release')), "
    "added_note TEXT NOT NULL DEFAULT '', PRIMARY KEY(workspace_id, stage_id))",
    "CREATE TABLE pipeline_items (workspace_id TEXT NOT NULL REFERENCES pipelines(workspace_id), "
    "number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 99999), title TEXT NOT NULL, description TEXT NOT NULL, "
    "size TEXT CHECK(size IN ('small','medium','large')), raised_by TEXT REFERENCES actors(id), raised_note TEXT NOT NULL DEFAULT '', "
    "section TEXT NOT NULL CHECK(section IN ('now','next','later','candidates','dropped')), candidate_group TEXT NOT NULL DEFAULT '', "
    "position INTEGER NOT NULL, needs TEXT NOT NULL DEFAULT '[]', finished_note TEXT NOT NULL DEFAULT '', gathering TEXT, "
    "version INTEGER NOT NULL, PRIMARY KEY(workspace_id, number))",
    "CREATE INDEX pipeline_order ON pipeline_items(workspace_id, section, candidate_group, position, number)",
    "CREATE TRIGGER items_stay BEFORE DELETE ON pipeline_items BEGIN SELECT RAISE(ABORT, 'an item keeps its number'); END",
    "CREATE TABLE pipeline_pieces (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES pipelines(workspace_id), "
    "kind TEXT NOT NULL CHECK(kind IN ('piece','release')), topic_id TEXT NOT NULL REFERENCES topics(id), "
    "release_number INTEGER, commit_sha TEXT, version INTEGER NOT NULL)",
    "CREATE TABLE pipeline_piece_members (piece_id TEXT NOT NULL REFERENCES pipeline_pieces(id), workspace_id TEXT NOT NULL, "
    "number INTEGER NOT NULL, left_ms INTEGER, left_reason TEXT CHECK(left_reason IN ('combined','dropped','returned')), "
    "PRIMARY KEY(piece_id, number))",
    "CREATE UNIQUE INDEX one_piece_per_item ON pipeline_piece_members(workspace_id, number) WHERE left_ms IS NULL",
    "CREATE INDEX item_pieces ON pipeline_piece_members(workspace_id, number, piece_id)",
    "CREATE TABLE pipeline_stage_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, piece_id TEXT NOT NULL REFERENCES pipeline_pieces(id), "
    "workspace_id TEXT NOT NULL, stage_id TEXT NOT NULL, round INTEGER NOT NULL CHECK(round >= 1), size TEXT, "
    "entered_ms INTEGER NOT NULL, entered_by TEXT NOT NULL REFERENCES actors(id), ask_message_id TEXT REFERENCES messages(id), "
    "note TEXT NOT NULL DEFAULT '', progress TEXT, left_ms INTEGER, "
    "left_outcome TEXT CHECK(left_outcome IN ('approved','sent back','passed','held','shipped','done','combined','dropped')), "
    "left_note TEXT NOT NULL DEFAULT '', left_by TEXT REFERENCES actors(id))",
    "CREATE UNIQUE INDEX one_open_entry ON pipeline_stage_entries(piece_id) WHERE left_ms IS NULL",
    "CREATE INDEX piece_entries ON pipeline_stage_entries(piece_id, seq)",
    "CREATE INDEX open_entries ON pipeline_stage_entries(workspace_id, piece_id) WHERE left_ms IS NULL",
    "CREATE INDEX stage_history ON pipeline_stage_entries(workspace_id, stage_id, size, round > 1, left_ms DESC) WHERE left_ms IS NOT NULL",
    "CREATE INDEX held_stage_asks ON pipeline_stage_entries(ask_message_id) WHERE ask_message_id IS NOT NULL AND left_ms IS NULL",
    _KEEPS_ITS_PAST % "OLD.left_ms IS NOT NULL",
    "CREATE TRIGGER entries_stay BEFORE DELETE ON pipeline_stage_entries BEGIN SELECT RAISE(ABORT, 'a stage entry keeps its past'); END",
    # D24: a stage that waits on the owner's word is entered only with an ask to the
    # owner by whoever enters it, in the piece's topic, and left only by the owner.
    # The rule is kept where every entry is opened and closed, so no command (a
    # stage change, a finish, a drop, a combine, or one not written yet) steps around it.
    "CREATE TRIGGER entries_enter_on_an_ask BEFORE INSERT ON pipeline_stage_entries "
    "WHEN (SELECT json_extract(gate,'$.owner') FROM pipeline_stages WHERE workspace_id=NEW.workspace_id AND stage_id=NEW.stage_id) "
    "AND NOT EXISTS (SELECT 1 FROM messages m, pipeline_pieces p, workspaces w WHERE m.id=NEW.ask_message_id AND p.id=NEW.piece_id "
    "AND w.id=p.workspace_id AND m.topic_id=p.topic_id AND m.author_id=NEW.entered_by AND m.intent='ask' "
    "AND EXISTS (SELECT 1 FROM json_each(m.addressees) a WHERE a.value=w.owner_id)) "
    "BEGIN SELECT RAISE(ABORT, 'ASK_REQUIRED'); END",
    "CREATE TRIGGER entries_leave_by_the_owner BEFORE UPDATE OF left_ms ON pipeline_stage_entries "
    "WHEN NEW.left_ms IS NOT NULL "
    "AND (SELECT json_extract(gate,'$.owner') FROM pipeline_stages WHERE workspace_id=OLD.workspace_id AND stage_id=OLD.stage_id) "
    "AND NEW.left_by IS NOT (SELECT owner_id FROM workspaces WHERE id=OLD.workspace_id) "
    "BEGIN SELECT RAISE(ABORT, 'STAGE_GATED'); END",
    "CREATE TABLE message_subjects (message_id TEXT NOT NULL REFERENCES messages(id), workspace_id TEXT NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('item','check')), ref TEXT NOT NULL, PRIMARY KEY(message_id, kind, ref))",
    "CREATE INDEX subject_ref ON message_subjects(workspace_id, kind, ref, message_id)",
    "CREATE TRIGGER subjects_stay BEFORE DELETE ON message_subjects BEGIN SELECT RAISE(ABORT, 'a message keeps its subjects'); END",
    "CREATE TABLE pipeline_item_sources (workspace_id TEXT NOT NULL, number INTEGER NOT NULL, position INTEGER NOT NULL, "
    "message_id TEXT REFERENCES messages(id), memory_item_id TEXT REFERENCES memory_items(id), note TEXT, "
    "added_by TEXT NOT NULL REFERENCES actors(id), added_ms INTEGER NOT NULL, "
    "CHECK((message_id IS NOT NULL) + (memory_item_id IS NOT NULL) + (note IS NOT NULL) = 1), "
    "PRIMARY KEY(workspace_id, number, position), FOREIGN KEY(workspace_id, number) REFERENCES pipeline_items(workspace_id, number))",
    "CREATE TRIGGER sources_stay BEFORE DELETE ON pipeline_item_sources BEGIN SELECT RAISE(ABORT, 'an item keeps where it came from'); END",
    "CREATE TABLE pipeline_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, number INTEGER, "
    "kind TEXT NOT NULL CHECK(kind IN ('added','edited','moved','stages','configured')), by TEXT NOT NULL REFERENCES actors(id), "
    "ms INTEGER NOT NULL, payload TEXT NOT NULL)",
    "CREATE INDEX item_events ON pipeline_events(workspace_id, number, seq DESC)",
    "CREATE INDEX pipeline_recent ON pipeline_events(workspace_id, seq DESC)",
    "CREATE TRIGGER events_stay_u BEFORE UPDATE ON pipeline_events BEGIN SELECT RAISE(ABORT, 'an event keeps its past'); END",
    "CREATE TRIGGER events_stay_d BEFORE DELETE ON pipeline_events BEGIN SELECT RAISE(ABORT, 'an event keeps its past'); END",
    "CREATE TABLE release_notes (release_label TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, "
    "PRIMARY KEY(release_label, position))",
    "CREATE TRIGGER release_notes_stay_u BEFORE UPDATE ON release_notes BEGIN SELECT RAISE(ABORT, 'a release note keeps its words'); END",
    "CREATE TRIGGER release_notes_stay_d BEFORE DELETE ON release_notes BEGIN SELECT RAISE(ABORT, 'a release note keeps its words'); END",
]
PIPELINE_DOWN = (
    "DROP TABLE release_notes", "DROP TABLE pipeline_events", "DROP TABLE pipeline_item_sources", "DROP TABLE message_subjects",
    "DROP TABLE pipeline_stage_entries", "DROP TABLE pipeline_piece_members", "DROP TABLE pipeline_pieces",
    "DROP TABLE pipeline_items", "DROP TABLE pipeline_stages", "DROP TABLE pipelines",
)
PIPELINE_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM pipelines) OR EXISTS (SELECT 1 FROM message_subjects) "
                     "OR EXISTS (SELECT 1 FROM release_notes)")

SECTIONS = ("now", "next", "later", "candidates")
SECTION_WORDS = {"now": "Now", "next": "Next", "later": "Later", "candidates": "Candidates"}
SIZES = ("small", "medium", "large")
LEFT = ("approved", "sent back", "passed", "held")
# What the database's D24 triggers refuse, in words naming the owner.
_OWNERS_WORD = {"ASK_REQUIRED": "This stage waits on %s: ask them first, in a message of your own in this piece's topic",
                "STAGE_GATED": "Only %s leaves this stage"}
ROUNDS = ("none", "together", "split")
_TEXT_MAX = 16384


def _text(value, name, required=True, limit=_TEXT_MAX):
    if not isinstance(value, str) or (required and not value.strip()) or len(value.encode("utf-8")) > limit:
        raise Refusal("INVALID_ARGUMENT", "%s is %stext of at most %d bytes" % (name, "non-empty " if required else "", limit))
    return value


def _flag(value, name):
    if not isinstance(value, bool):
        raise Refusal("INVALID_ARGUMENT", "%s is true or false" % name)
    return value


def _number(value, name="number"):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 99999:
        raise Refusal("INVALID_ARGUMENT", "%s is a whole number from 1 to 99999" % name)
    return value


def _slug(value, name):
    _identifier(value, name)
    if not all(c.isalnum() or c in "-_" for c in value) or len(value) > 64:
        raise Refusal("INVALID_ARGUMENT", "%s is a short slug of letters, digits, - and _" % name)
    return value


def _loads(text, default):
    return json.loads(text) if text else default


# The facts _settle reads, each about one member row m (piece p) of the outcome. Member rows leave once, and records and
# kept events are never taken back, so each fact, once true, stays true; the one row that comes back is one the record of
# its own release overtook (_OVERTAKEN, _ship_release), and it comes back named. :ships is whether the outcome ships in
# releases: only then do the records, which name bare item numbers, name its items.
_NAMED = "(:ships AND m.number IN (SELECT j.value FROM releases r, json_each(r.items) j))"
# An item a piece combined into a release, dropped since (from the release, or once it went back to building), has left
# that piece's work for good: putting it back starts new work, not the old piece's.
_DROPPED_SINCE = ("EXISTS (SELECT 1 FROM pipeline_events v INDEXED BY item_events WHERE v.workspace_id=m.workspace_id AND v.number=m.number "
                  "AND v.kind='moved' AND v.ms>=m.left_ms AND json_extract(v.payload,'$.after.section')='dropped')")
# Put back since the row left: moved out of Dropped, so whatever builds it now is new work.
_PUT_BACK_SINCE = ("EXISTS (SELECT 1 FROM pipeline_events v INDEXED BY item_events WHERE v.workspace_id=m.workspace_id AND v.number=m.number "
                   "AND v.kind='moved' AND v.ms>=m.left_ms AND json_extract(v.payload,'$.before.section')='dropped' "
                   "AND json_extract(v.payload,'$.after.section')<>'dropped')")
# A record overtakes a drop (D25): it names an item dropped from the row's piece and not put back since. The deploy takes a
# record's items from its commits, so a record can name an item already dropped; the item shipped, and since a shipped
# item is never dropped, the drop counts for nothing, as if the record had come first.
_OVERTAKEN = "(m.left_reason='dropped' AND " + _NAMED + " AND NOT " + _PUT_BACK_SINCE + ")"
# Work left to ship (D1): an item still in the piece, or combined from it into a release and not dropped since, that no
# record names.
_LEFT = "(m.left_ms IS NULL OR (m.left_reason='combined' AND NOT " + _DROPPED_SINCE + ")) AND NOT " + _NAMED
# What a piece shipped: each item a record names that it holds, or, for a piece of work, that it ever held and that was not
# put back since it left: combined into a release (or dropped since, the record overtaking the drop), shipped while it was
# under way (`returned`), or dropped from it (overtaken). A release shipped only what it holds: an item it returned went
# back to building or shipped in another release. With the record naming it, newest first.
_SHIPPED_FROM = ("SELECT max(r.number) FROM pipeline_pieces p JOIN pipeline_piece_members m ON m.piece_id=p.id, releases r, json_each(r.items) j "
                 "WHERE j.value=m.number AND :ships AND (m.left_ms IS NULL OR (p.kind='piece' AND NOT " + _PUT_BACK_SINCE + "))")
# A piece's last entry that _settle wrote when the piece ended, and decides again when a record overtakes a drop: a piece of
# work's `shipped` or `dropped`, an emptied release's `held` or `dropped`. A release left `shipped`, by its record, is final.
_DECIDED = {"piece": ("shipped", "dropped"), "release": ("held", "dropped")}


class Pipeline:
    """Store mixin: pipeline commands (4.1), the `pipeline`, `pipeline_item` and `pipeline_row` views (5.1)."""

    # ---- reading the records -------------------------------------------------

    def _pipeline_row(self, db, workspace_id):
        return db.execute("SELECT * FROM pipelines WHERE workspace_id=?", (workspace_id,)).fetchone()

    def _pipeline_on(self, db, workspace_id):
        row = self._pipeline_row(db, workspace_id)
        if row is None or not row["enabled"]:
            raise Refusal("PIPELINE_OFF", "This outcome's pipeline is off")
        return row

    def _steerer(self, db, actor, workspace_id, coordinator=True):
        """The workspace, when the actor is its owner (or, with coordinator, its coordinator)."""
        workspace = self._workspace(db, actor, workspace_id)
        if workspace["owner_id"] != actor and not (coordinator and workspace["coordinator_id"] == actor):
            raise Refusal("FORBIDDEN", "Only this outcome's owner%s may do this" % (" or coordinator" if coordinator else ""))
        return workspace

    def _steers(self, workspace, actor):
        """Whether the actor steers this outcome's pipeline: its owner or its coordinator."""
        return actor in (workspace["owner_id"], workspace["coordinator_id"])

    def _stages(self, db, workspace_id, current=True):
        rows = db.execute("SELECT * FROM pipeline_stages WHERE workspace_id=?" + (" AND position IS NOT NULL" if current else "")
                          + " ORDER BY position IS NULL, position, stage_id", (workspace_id,)).fetchall()
        return [dict(row, gate=_loads(row["gate"], {})) for row in rows]

    def _item_row(self, db, workspace_id, number):
        row = db.execute("SELECT * FROM pipeline_items WHERE workspace_id=? AND number=?", (workspace_id, _number(number))).fetchone()
        if row is None:
            raise Refusal("NOT_FOUND", "No item %d in this pipeline" % number)
        return row

    def _shipped_numbers(self, db):
        """{number: {release, deployed_ms}} from the release records, which alone say what shipped."""
        shipped = {}
        for row in db.execute("SELECT r.number,r.deployed_ms,j.value FROM releases r, json_each(r.items) j"):
            shipped[row[2]] = {"release": row[0], "deployed_ms": row[1]}
        return shipped

    def _shipped(self, db, workspace, item, releases):
        """Whether and how an item is finished: its release record, the import's note, or its piece's last entry left done."""
        if workspace["ships_in_releases"] and item["number"] in releases:
            return dict(releases[item["number"]])
        if item["finished_note"]:
            return {"note": item["finished_note"]}
        done = db.execute("SELECT e.left_ms FROM pipeline_piece_members m JOIN pipeline_stage_entries e ON e.piece_id=m.piece_id "
                          "WHERE m.workspace_id=? AND m.number=? AND e.left_outcome='done' ORDER BY e.seq DESC LIMIT 1",
                          (item["workspace_id"], item["number"])).fetchone()
        return {"done_ms": done[0]} if done else None

    def _next_release(self, db):
        """The number the next release ships as: one past the last a release record names (1 before any). A number is spent
        only when a deploy records it, so a release piece that ended or was emptied never held one."""
        return db.execute("SELECT coalesce(max(number),0)+1 FROM releases").fetchone()[0]

    def _the_release(self, db, workspace_id):
        """THE RELEASE (3.4): the outcome's open release piece, with its open entry, and as its release_number the number it
        ships as (_next_release); None without one. A release piece is open until the event that ends it closes its entry
        (every item gone from it, or its own record written: _settle, from _ship_release), so nothing here reads records or
        settings: combine makes one only while there is none, and configure keeps the pipeline on and shipping in releases
        while there is one. Every reader and writer of "the release" asks here."""
        row = db.execute("SELECT p.*,e.stage_id,e.round,e.progress,e.entered_ms FROM pipeline_stage_entries e INDEXED BY open_entries "
                         "JOIN pipeline_pieces p ON p.id=e.piece_id WHERE e.workspace_id=? AND e.left_ms IS NULL AND p.kind='release' "
                         "ORDER BY p.rowid LIMIT 1", (workspace_id,)).fetchone()
        return dict(row, release_number=self._next_release(db)) if row else None

    def _ship_release(self, db, release, next_number):
        """7.2 step 11, in the transaction that writes a release record; next_number is _next_release as it was before it.

        The record changes what pieces hold, then _settle decides every end. It ships an outcome's release only when its
        number is the next one: the release open (_the_release), or, with none open, a release emptied by drops this record
        overtakes (_overtaken_release), which would still be open had the record come before them. An item that release dropped and the record names comes back into it (_OVERTAKEN: what shipped in a release
        stays in it); an item it holds that no record names has not shipped and goes back to building (`returned`); and the
        release ends `shipped`, "Shipped in release N", whatever stage it is in. What the record names leaves every other
        piece under way (_shipped_leave). Only the outcome that ships in releases has its items named by records."""
        ms, number, named = release["recorded_ms"], release["release"], list(release["items"])
        for (workspace_id,) in db.execute("SELECT workspace_id FROM pipelines WHERE ships_in_releases=1").fetchall():
            piece = self._the_release(db, workspace_id) or self._overtaken_release(db, workspace_id, number)
            shipping, numbers = None, list(named)
            if piece is not None and number == next_number:
                db.execute("UPDATE pipeline_piece_members SET left_ms=NULL,left_reason=NULL WHERE rowid IN (SELECT m.rowid FROM "
                           "pipeline_piece_members m WHERE m.piece_id=:piece AND " + _OVERTAKEN + ")", {"piece": piece["id"], "ships": 1})
                db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='returned' WHERE piece_id=? AND left_ms IS NULL "
                           "AND number NOT IN (SELECT j.value FROM releases r, json_each(r.items) j)", (ms, piece["id"]))
                shipping = (piece["id"], number)
                numbers += [row[0] for row in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=?", (piece["id"],))]
            self._shipped_leave(db, workspace_id, named, ms, shipping and shipping[0])
            self._settle(db, workspace_id, numbers, None, ms, decided=named, shipping=shipping)

    def _overtaken_release(self, db, workspace_id, number):
        """The release a record of this number would have shipped had it come before the drops that emptied it: the first
        release piece left `dropped` or `held` that would have shipped as this number (one past the last record written
        before it ended), one of whose drops the record overtakes (_OVERTAKEN). None without one. Asked only while no
        release is open, so the release a deploy puts out is always the one it ships."""
        row = db.execute("SELECT p.* FROM pipeline_pieces p JOIN pipeline_stage_entries e INDEXED BY piece_entries ON e.piece_id=p.id "
                         "WHERE p.workspace_id=:workspace AND p.kind='release' AND e.left_outcome IN ('held','dropped') "
                         "AND e.seq=(SELECT max(seq) FROM pipeline_stage_entries WHERE piece_id=p.id) "
                         "AND (SELECT coalesce(max(r.number),0)+1 FROM releases r WHERE r.recorded_ms<=e.left_ms AND r.number<>:number)=:number "
                         "AND EXISTS (SELECT 1 FROM pipeline_piece_members m WHERE m.piece_id=p.id AND " + _OVERTAKEN + ") "
                         "ORDER BY p.rowid LIMIT 1", {"workspace": workspace_id, "number": number, "ships": 1}).fetchone()
        return dict(row) if row else None

    def _shipped_leave(self, db, workspace_id, named, ms, shipping=None):
        """What a record names has shipped wherever it is still being built: it leaves every piece under way (`returned`),
        but the release that record ships, so no piece under way holds a shipped item and combine carries none."""
        under_way = db.execute(
            "SELECT DISTINCT p.* FROM pipeline_stage_entries e INDEXED BY open_entries JOIN pipeline_pieces p ON p.id=e.piece_id "
            "JOIN pipeline_piece_members m ON m.piece_id=p.id AND m.left_ms IS NULL WHERE e.workspace_id=? AND e.left_ms IS NULL "
            "AND p.id IS NOT ? AND m.number IN (SELECT value FROM json_each(?))", (workspace_id, shipping, _json(named))).fetchall()
        for building in under_way:
            db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='returned' WHERE piece_id=? AND left_ms IS NULL "
                       "AND number IN (SELECT value FROM json_each(?))", (ms, building["id"], _json(named)))
            db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (building["id"],))
            self._bump(db, workspace_id, building["id"])

    def _settle(self, db, workspace_id, numbers, actor, ms, decided=(), shipping=None):
        """THE END OF A PIECE (3.4, D1, D25): the one rule. Every path that changes what a piece holds or whether its items
        shipped calls it, in its own transaction, with the items it touched; it decides, for every piece those items were ever
        in, whether the piece has ended and how, and whether its topic is Done, from the facts alone: what each piece holds
        and held, the release records, and the drops. So the same facts give the same ends in any order. A drop is refused
        once a record names its item, so a record that names an item already dropped overtakes the drop (_OVERTAKEN): the end
        is what it would have been had the record come first.

        - A piece still open ends once none of its work is left to ship (_LEFT). A piece of work has then shipped if it
          shipped any item, "Shipped in release N" with N the newest record naming one (_SHIPPED_FROM), and was dropped if
          not. A release ships only by the record of its own number (shipping: its id and that number, from _ship_release);
          emptied any other way it ends `dropped` when every item was dropped, else `held`, saying what took its items, and
          since no record spent its number the work combined next is that same release.
        - An end this rule wrote (_DECIDED) is decided again from the facts while the outcome ships in releases, and
          rewritten when they now say it shipped, or say what took an emptied release's items differently: only a record
          overtaking a drop changes them. When it ended and who left it stay; every other end stays as written.
        - A topic is Done (D1), by nobody, "Shipped in release N", once none of its pieces has work left and one of them
          shipped an item (N the newest record naming one, or the release the record ships there), unless it is the
          outcome's conversation, which never ends, or someone has said where it stands since. It is asked when one of
          its pieces ends here, or when this call decided what became of an item one of its pieces held (decided: shipped or
          dropped), the only facts that end a closed piece's work; a later word on the topic stands otherwise.

        actor is whoever's act this is (None for a record): the database keeps the owner's word on leaving a stage (D24)."""
        pipeline = self._pipeline_row(db, workspace_id)
        facts = {"ships": int(bool(pipeline and pipeline["ships_in_releases"]))}
        pieces = db.execute("SELECT DISTINCT p.* FROM pipeline_piece_members m INDEXED BY item_pieces JOIN pipeline_pieces p ON p.id=m.piece_id "
                            "WHERE m.workspace_id=? AND m.number IN (SELECT value FROM json_each(?))",
                            (workspace_id, _json(sorted(set(numbers))))).fetchall()
        asked = {shipping[0]} if shipping else set()
        asked |= {row[0] for row in db.execute("SELECT DISTINCT m.piece_id FROM pipeline_piece_members m INDEXED BY item_pieces "
                                               "WHERE m.workspace_id=? AND m.number IN (SELECT value FROM json_each(?))",
                                               (workspace_id, _json(sorted(set(decided)))))}
        for piece in pieces:
            entry = self._open_entry(db, piece["id"])
            ended = None if entry is not None else db.execute("SELECT * FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq DESC LIMIT 1",
                                                              (piece["id"],)).fetchone()
            if shipping and piece["id"] == shipping[0]:
                outcome, note = "shipped", "Shipped in release %d" % shipping[1]
            elif (ended is not None and not (facts["ships"] and ended["left_outcome"] in _DECIDED[piece["kind"]])) or db.execute(
                    "SELECT 1 FROM pipeline_piece_members m WHERE m.piece_id=:piece AND " + _LEFT, dict(facts, piece=piece["id"])).fetchone():
                continue
            else:
                outcome, note = self._emptied(db, piece, facts)
            if ended is None:
                self._leave(db, actor, entry, outcome, ms, note)
            elif outcome in ("shipped", "held") and (outcome, note) != (ended["left_outcome"], ended["left_note"]):
                self._entry_write(db, workspace_id, "UPDATE pipeline_stage_entries SET left_outcome=?,left_note=? WHERE seq=?",
                                  (outcome, note, ended["seq"]))
            else:
                continue
            db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (piece["id"],))
            self._bump(db, workspace_id, piece["id"])
            asked.add(piece["id"])
        shipped_here = {piece["topic_id"]: shipping[1] for piece in pieces if shipping and piece["id"] == shipping[0]}
        for topic_id in dict.fromkeys(piece["topic_id"] for piece in pieces if piece["id"] in asked):
            topic = db.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
            # Done by nobody is this rule's own word, decided again as an end is; anyone's word since stands.
            if topic["kind"] != "topic" or (topic["state"] == "done" and (topic["state_by"] is not None or topic["state_message_id"] is not None)) or db.execute(
                    "SELECT 1 FROM pipeline_pieces p JOIN pipeline_piece_members m ON m.piece_id=p.id WHERE p.topic_id=:topic AND " + _LEFT,
                    dict(facts, topic=topic_id)).fetchone():
                continue
            shipped = [n for n in (db.execute(_SHIPPED_FROM + " AND p.topic_id=:topic", dict(facts, topic=topic_id)).fetchone()[0],
                                   shipped_here.get(topic_id)) if n]
            if shipped and (topic["state"], topic["state_note"]) != ("done", "Shipped in release %d" % max(shipped)):
                self._set_topic_state(db, topic, None, {"state": "done", "note": "Shipped in release %d" % max(shipped)})

    def _emptied(self, db, piece, facts):
        """How a piece with no work left ended, when no record of its own release shipped it (_settle)."""
        if piece["kind"] == "piece":
            shipped = db.execute(_SHIPPED_FROM + " AND p.id=:piece", dict(facts, piece=piece["id"])).fetchone()[0]
            return ("shipped", "Shipped in release %d" % shipped) if shipped else ("dropped", "")
        # A release: each item went back to building or shipped in an older release (`returned`), or was dropped.
        # An item dropped from it that a record names shipped there instead, the record overtaking the drop (_OVERTAKEN).
        went_back = shipped = dropped = None
        for reason, number, overtaken in db.execute("SELECT m.left_reason, (SELECT max(r.number) FROM releases r, json_each(r.items) j "
                                                    "WHERE :ships AND j.value=m.number), " + _OVERTAKEN + " FROM pipeline_piece_members m "
                                                    "WHERE m.piece_id=:piece", dict(facts, piece=piece["id"])):
            if reason == "dropped" and not overtaken:
                dropped = True
            elif number is None:
                went_back = True
            else:
                shipped = max(shipped or 0, number)
        if not (went_back or shipped):
            return "dropped", ""
        if not dropped and not shipped:
            return "held", "Every item went back to building"
        if not dropped and not went_back:
            return "held", "Its last items shipped in release %d" % shipped
        took = [words for words, said in (("went back to building", went_back), ("shipped in release %d" % (shipped or 0), shipped),
                                          ("were dropped", dropped)) if said]
        return "held", "Its items " + ", ".join(took[:-1]) + " or " + took[-1]

    def _open_piece_of(self, db, workspace_id, number):
        """The piece an item is in (3.4): its member row that has not left, open or closed. An item that shipped in a release,
        or finished in a piece, stays in it."""
        return db.execute("SELECT p.* FROM pipeline_piece_members m JOIN pipeline_pieces p ON p.id=m.piece_id "
                          "WHERE m.workspace_id=? AND m.number=? AND m.left_ms IS NULL", (workspace_id, number)).fetchone()

    def _moving_entry(self, db, piece):
        entry = self._open_entry(db, piece["id"])
        if entry is None:
            raise Refusal("PIECE_CLOSED", "This piece of work has finished")
        return entry

    def _open_entry(self, db, piece_id):
        return db.execute("SELECT * FROM pipeline_stage_entries WHERE piece_id=? AND left_ms IS NULL", (piece_id,)).fetchone()

    def _members(self, db, piece_id):
        return [row[0] for row in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? AND left_ms IS NULL ORDER BY rowid",
                                             (piece_id,))]

    # ---- writing --------------------------------------------------------------

    def _bump(self, db, workspace_id, record):
        db.execute("UPDATE pipelines SET version=version+1 WHERE workspace_id=?", (workspace_id,))
        version = db.execute("SELECT version FROM pipelines WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        self._change(db, "workspace", workspace_id, "pipeline", str(record), version)
        return version

    def _event(self, db, workspace_id, number, kind, actor, payload, ms=None):
        cursor = db.execute("INSERT INTO pipeline_events(workspace_id,number,kind,by,ms,payload) VALUES (?,?,?,?,?,?)",
                            (workspace_id, number, kind, actor, _now_ms() if ms is None else ms, _json(payload)))
        return cursor.lastrowid

    def _touch_item(self, db, workspace_id, number):
        db.execute("UPDATE pipeline_items SET version=version+1 WHERE workspace_id=? AND number=?", (workspace_id, number))

    def _check_revision(self, envelope, name, current):
        expected = envelope["expected"].get(name)
        if expected is not None and expected != current:
            raise Refusal("REVISION_CONFLICT", "This changed since it was read", {name: current})

    def _source_rows(self, db, actor, workspace_id, sources, allow_empty=False):
        """Validated sources: each a readable message, a Notebook page of a scope the actor can read, or a note."""
        if not isinstance(sources, list) or (not sources and not allow_empty):
            raise Refusal("SOURCE_REQUIRED", "Say where this came from: a message, a Notebook page or a note")
        if len(sources) > 256:
            raise Refusal("INVALID_ARGUMENT", "At most 256 sources at once")
        rows = []
        for source in sources:
            if not isinstance(source, dict) or len(source) != 1:
                raise Refusal("INVALID_ARGUMENT", "A source is {message_id}, {message_seq}, {memory_item_id} or {note}")
            if "message_seq" in source:
                # A message by its number, as people say it ("What's live #461").
                seq = source["message_seq"]
                row = db.execute("SELECT id FROM messages WHERE seq=?", (seq,)).fetchone() if isinstance(seq, int) and not isinstance(seq, bool) else None
                if row is None:
                    raise Refusal("FORBIDDEN", "No readable source")
                source = {"message_id": row[0]}
            if "message_id" in source:
                message = self._message_access(db, actor, source["message_id"])
                # A whisper is never where an item came from: the whole outcome reads the pipeline.
                private_source_refused(db, message["id"])
                rows.append((message["id"], None, None, message["author_id"]))
            elif "memory_item_id" in source:
                item = db.execute("SELECT * FROM memory_items WHERE id=?", (_identifier(source["memory_item_id"], "memory_item_id"),)).fetchone()
                if item is None:
                    raise Refusal("FORBIDDEN", "No readable source")
                try:
                    self._memory_scope(db, actor, {"kind": item["scope_kind"], "id": item["scope_id"]})
                except Refusal:
                    raise Refusal("FORBIDDEN", "No readable source")
                rows.append((None, item["id"], None, None))
            elif "note" in source:
                rows.append((None, None, _text(source["note"], "A source note", limit=1024), None))
            else:
                raise Refusal("INVALID_ARGUMENT", "A source is {message_id}, {memory_item_id} or {note}")
        return rows

    def _part(self, args, rows):
        """Whether an item takes only part of the conversation items it comes from; part needs a message."""
        part = partial(args)
        if part and not any(row[0] for row in rows):
            raise Refusal("INVALID_ARGUMENT", "part names a message the item takes from; give a message source")
        return part

    def _add_sources(self, db, actor, workspace_id, number, rows, ms):
        start = db.execute("SELECT coalesce(max(position),0) FROM pipeline_item_sources WHERE workspace_id=? AND number=?",
                           (workspace_id, number)).fetchone()[0]
        for offset, (message_id, memory_item_id, note, _) in enumerate(rows, 1):
            db.execute("INSERT INTO pipeline_item_sources VALUES (?,?,?,?,?,?,?,?)",
                       (workspace_id, number, start + offset, message_id, memory_item_id, note, actor, ms))

    def _gathering(self, db, actor, value):
        if value is None:
            return None
        if not isinstance(value, dict) or len(value) != 1 or not ({"message_id", "memory_item_id"} & set(value)):
            raise Refusal("INVALID_ARGUMENT", "Still gathering is {message_id} or {memory_item_id}")
        self._source_rows(db, actor, None, [value])
        return _json(value)

    def _needs(self, value):
        if not isinstance(value, list) or len(value) > 64:
            raise Refusal("INVALID_ARGUMENT", "needs is a list of item numbers")
        return _json(sorted({_number(number, "a needed item") for number in value}))

    def _place(self, db, workspace_id, number, section, group, above=None, below=None):
        """The position that puts an item above or below another in its section, or last; shifts what follows."""
        def neighbour(other):
            row = self._item_row(db, workspace_id, other)
            if row["section"] != section or (section == "candidates" and row["candidate_group"] != group):
                raise Refusal("INVALID_ARGUMENT", "Item %d is not in that section" % other)
            if row["number"] == number:
                raise Refusal("INVALID_ARGUMENT", "An item is not placed beside itself")
            return row
        if above is not None or below is not None:
            if above is not None and below is not None:
                raise Refusal("INVALID_ARGUMENT", "Place an item above one item or below one, not both")
            other = neighbour(above if above is not None else below)
            position = other["position"] + (0 if above is not None else 1)
            db.execute("UPDATE pipeline_items SET position=position+1 WHERE workspace_id=? AND section=? AND candidate_group=? "
                       "AND position>=? AND number<>?", (workspace_id, section, group, position, number))
            return position
        last = db.execute("SELECT max(position) FROM pipeline_items WHERE workspace_id=? AND section=? AND candidate_group=? AND number<>?",
                          (workspace_id, section, group, number)).fetchone()[0]
        return 1 if last is None else last + 1

    def _neighbours(self, db, item):
        """The items just above and below an item where it is now, for an event's words and its Undo."""
        rows = db.execute("SELECT number FROM pipeline_items WHERE workspace_id=? AND section=? AND candidate_group=? "
                          "ORDER BY position, number", (item["workspace_id"], item["section"], item["candidate_group"])).fetchall()
        numbers = [row[0] for row in rows]
        at = numbers.index(item["number"]) if item["number"] in numbers else -1
        return {"section": item["section"], "group": item["candidate_group"], "position": item["position"],
                "above": numbers[at + 1] if 0 <= at < len(numbers) - 1 else None,
                "below": numbers[at - 1] if at > 0 else None}

    # ---- commands (4.1) ---------------------------------------------------------

    def _command_pipeline_configure(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one outcome")
        # The owner and the coordinator steer together: either turns the pipeline
        # on or off; its settings are the owner's alone.
        workspace = self._steerer(db, actor, target["workspace_id"])
        current = self._pipeline_row(db, workspace["id"])
        self._check_revision(envelope, "pipeline_revision", current["version"] if current else 0)
        allowed = {"enabled", "title", "unit_one", "unit_many", "sized", "ships_in_releases", "section_words"}
        if set(args) - allowed or "enabled" not in args:
            raise Refusal("INVALID_ARGUMENT", "A pipeline is turned on or off, with its title, units, sizes, releases and section words")
        if actor != workspace["owner_id"] and set(args) != {"enabled"}:
            raise Refusal("FORBIDDEN", "Only this outcome's owner changes its pipeline's settings; its coordinator turns it on or off")
        before = dict(current) if current else None
        settings = {
            "enabled": _flag(args["enabled"], "enabled"),
            "title": _text(args.get("title", current["title"] if current else "Pipeline"), "The title", limit=200),
            "unit_one": _text(args.get("unit_one", current["unit_one"] if current else "item"), "unit_one", limit=64),
            "unit_many": _text(args.get("unit_many", current["unit_many"] if current else "items"), "unit_many", limit=64),
            "sized": _flag(args.get("sized", bool(current["sized"]) if current else True), "sized"),
            "ships_in_releases": _flag(args.get("ships_in_releases", bool(current["ships_in_releases"]) if current else False), "ships_in_releases"),
        }
        words = args.get("section_words", _loads(current["section_words"], SECTION_WORDS) if current else SECTION_WORDS)
        if not isinstance(words, dict) or set(words) - set(SECTION_WORDS):
            raise Refusal("INVALID_ARGUMENT", "section_words names now, next, later and candidates")
        words = dict(SECTION_WORDS, **{key: _text(value, "A section's words", limit=64) for key, value in words.items()})
        if settings["ships_in_releases"] and db.execute("SELECT 1 FROM pipelines WHERE ships_in_releases=1 AND workspace_id<>?",
                                                        (workspace["id"],)).fetchone():
            raise Refusal("RELEASES_TAKEN", "Another outcome's pipeline already ships in this instance's releases")
        release = self._the_release(db, workspace["id"]) if not (settings["enabled"] and settings["ships_in_releases"]) else None
        if release is not None:
            # 3.4: what is in the release is a fact of the release, so what it rests on does not change under it.
            raise Refusal("RELEASE_OPEN", "Release %d is still being put together; the pipeline stays on and ships in releases "
                          "until it ships or every item has left it" % release["release_number"])
        values = (int(settings["enabled"]), settings["title"], settings["unit_one"], settings["unit_many"], int(settings["sized"]),
                  int(settings["ships_in_releases"]), _json(words))
        if current is None:
            db.execute("INSERT INTO pipelines VALUES (?,?,?,?,?,?,?,?,0)", (workspace["id"],) + values)
        else:
            db.execute("UPDATE pipelines SET enabled=?,title=?,unit_one=?,unit_many=?,sized=?,ships_in_releases=?,section_words=? "
                       "WHERE workspace_id=?", values + (workspace["id"],))
            if current["ships_in_releases"] != settings["ships_in_releases"]:
                # Whether the records name this outcome's items is what shipping in releases means: it decides, for every
                # item a piece here holds or held, whether it shipped. Turned on, what the records name leaves the pieces
                # under way as a record's items do (no release is open: combine needs releases on).
                ms = _now_ms()
                if settings["ships_in_releases"]:
                    self._shipped_leave(db, workspace["id"], [row[0] for row in db.execute("SELECT DISTINCT j.value FROM releases r, json_each(r.items) j")], ms)
                held = [row[0] for row in db.execute("SELECT DISTINCT number FROM pipeline_piece_members WHERE workspace_id=?", (workspace["id"],))]
                self._settle(db, workspace["id"], held, actor, ms, decided=held)
        self._event(db, workspace["id"], None, "configured", actor, {"before": before, "after": dict(settings, section_words=words)})
        version = self._bump(db, workspace["id"], "configured")
        return {"workspace_id": workspace["id"], "pipeline_revision": version, "enabled": settings["enabled"]}, [
            {"kind": "pipeline", "id": workspace["id"], "version": version}]

    def _command_pipeline_stages_set(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"stages"} or not isinstance(args["stages"], list):
            raise Refusal("INVALID_ARGUMENT", "Give the whole ordered list of stages")
        workspace = self._steerer(db, actor, target["workspace_id"])
        pipeline = self._pipeline_row(db, workspace["id"])
        if pipeline is None:
            raise Refusal("PIPELINE_OFF", "This outcome has no pipeline")
        self._check_revision(envelope, "pipeline_revision", pipeline["version"])
        stages = args["stages"]
        if not stages or len(stages) > outcome_rules.STAGES_MAX:
            raise Refusal("INVALID_ARGUMENT", "An outcome has from 1 to %d stages" % outcome_rules.STAGES_MAX)
        before = self._stages(db, workspace["id"])
        # D24, as the owner agreed: a stage that waits on the owner's word stays the owner's.
        # Only the owner gives a stage their word or takes it off, by its gate or by removing
        # the stage; a stage kept from before (retired ones too) keeps the word it had.
        waits = {stage["stage_id"]: bool(stage["gate"].get("owner")) for stage in self._stages(db, workspace["id"], current=False)}
        seen, listed = set(), {}
        db.execute("UPDATE pipeline_stages SET position=NULL WHERE workspace_id=?", (workspace["id"],))
        for position, stage in enumerate(stages, 1):
            if not isinstance(stage, dict) or set(stage) - {"stage_id", "name", "done_when", "gate", "rounds", "scope", "added_note"}:
                raise Refusal("INVALID_ARGUMENT", "A stage is its stage_id, name, done_when, gate, rounds, scope and added_note")
            stage_id = _slug(stage.get("stage_id"), "stage_id")
            if stage_id in seen:
                raise Refusal("INVALID_ARGUMENT", "Stage %s is listed twice" % stage_id)
            seen.add(stage_id)
            gate = stage.get("gate", {})
            if not isinstance(gate, dict) or set(gate) - {"checks", "owner", "words"}:
                raise Refusal("INVALID_ARGUMENT", "A gate is {checks, owner, words}")
            checks = gate.get("checks", [])
            if not isinstance(checks, list) or len(checks) > 16:
                raise Refusal("INVALID_ARGUMENT", "A gate names at most 16 checks")
            gate = {"checks": [_slug(check, "a check") for check in checks], "owner": _flag(gate.get("owner", False), "gate.owner"),
                    "words": _text(gate.get("words", ""), "The gate's words", required=False, limit=1024)}
            listed[stage_id] = gate["owner"]
            rounds, scope = stage.get("rounds", "none"), stage.get("scope", "piece")
            if rounds not in ROUNDS or scope not in ("piece", "release"):
                raise Refusal("INVALID_ARGUMENT", "rounds is none, together or split; scope is piece or release")
            if scope == "release" and not pipeline["ships_in_releases"]:
                raise Refusal("INVALID_ARGUMENT", "Only a pipeline that ships in releases has release stages")
            db.execute("INSERT INTO pipeline_stages VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,stage_id) DO UPDATE SET "
                       "position=excluded.position,name=excluded.name,done_when=excluded.done_when,gate=excluded.gate,"
                       "rounds=excluded.rounds,scope=excluded.scope,added_note=excluded.added_note",
                       (workspace["id"], stage_id, position, _text(stage.get("name"), "A stage's name", limit=200),
                        _text(stage.get("done_when", ""), "done when", required=False, limit=2048), _json(gate), rounds, scope,
                        _text(stage.get("added_note", ""), "added_note", required=False, limit=1024)))
        if actor != workspace["owner_id"] and (any(owner != waits.get(stage_id, False) for stage_id, owner in listed.items())
                                               or any(waits[stage["stage_id"]] and stage["stage_id"] not in listed for stage in before)):
            raise Refusal("FORBIDDEN", "Only %s gives a stage their word or takes it off, or removes a stage that waits on it"
                          % workspace["owner_id"])
        self._event(db, workspace["id"], None, "stages", actor, {"before": before, "after": self._stages(db, workspace["id"])})
        version = self._bump(db, workspace["id"], "stages")
        return {"workspace_id": workspace["id"], "pipeline_revision": version, "stages": len(stages)}, [
            {"kind": "pipeline", "id": workspace["id"], "version": version}]

    def _command_pipeline_item_add(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        allowed = {"title", "description", "size", "section", "candidate_group", "raised_by", "raised_note", "needs", "sources",
                   "gathering", "after", "part"}
        if set(target) != {"workspace_id"} or set(args) - allowed:
            raise Refusal("INVALID_ARGUMENT", "An item has a title, words, size, section, who raised it, what it needs and where it came from")
        workspace = self._workspace(db, actor, target["workspace_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        sources = self._source_rows(db, actor, workspace["id"], args.get("sources"))
        part = self._part(args, sources)
        size = args.get("size")
        # A size is optional: an item can be added by its title alone and sized later.
        if pipeline["sized"]:
            if size is not None and size not in SIZES:
                raise Refusal("INVALID_ARGUMENT", "An item in this pipeline is small, medium or large, or has no size yet")
        elif size is not None:
            raise Refusal("INVALID_ARGUMENT", "This pipeline's items have no size")
        section = args.get("section", "candidates")
        if section not in SECTIONS:
            raise Refusal("INVALID_ARGUMENT", "An item starts in now, next, later or candidates")
        group = _text(args.get("candidate_group", ""), "candidate_group", required=False, limit=200) if section == "candidates" else ""
        raised_note = _text(args.get("raised_note", ""), "raised_note", required=False, limit=200)
        raised_by = args.get("raised_by")
        if raised_by is not None:
            self._actor(db, raised_by)
        elif not raised_note:
            # With a message and no "raised by", the message's author raised it.
            raised_by = next((row[3] for row in sources if row[3]), actor)
        number = db.execute("SELECT coalesce(max(number),0)+1 FROM pipeline_items WHERE workspace_id=?", (workspace["id"],)).fetchone()[0]
        position = self._place(db, workspace["id"], number, section, group,
                               below=args["after"] if args.get("after") is not None else None)
        ms = _now_ms()
        db.execute("INSERT INTO pipeline_items VALUES (?,?,?,?,?,?,?,?,?,?,?,'',?,1)",
                   (workspace["id"], number, _text(args.get("title"), "The title", limit=500),
                    _text(args.get("description", ""), "The words", required=False), size, raised_by, raised_note, section, group,
                    position, self._needs(args.get("needs", [])), self._gathering(db, actor, args.get("gathering"))))
        self._add_sources(db, actor, workspace["id"], number, sources, ms)
        self._take_into_pipeline(db, actor, workspace["id"], [row[0] for row in sources if row[0]], number, part, added=False)
        self._event(db, workspace["id"], number, "added", actor, {"section": section, "group": group}, ms)
        version = self._bump(db, workspace["id"], number)
        return {"workspace_id": workspace["id"], "number": number, "pipeline_revision": version}, [
            {"kind": "pipeline_item", "id": "%s:%d" % (workspace["id"], number), "version": 1}]

    def _command_pipeline_source_add(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id", "number"} or set(args) - {"sources", "part"}:
            raise Refusal("INVALID_ARGUMENT", "Name the item and the sources to add")
        workspace = self._workspace(db, actor, target["workspace_id"])
        self._pipeline_on(db, workspace["id"])
        item = self._item_row(db, workspace["id"], target["number"])
        self._check_revision(envelope, "item_revision", item["version"])
        rows = self._source_rows(db, actor, workspace["id"], args.get("sources"))
        part = self._part(args, rows)
        self._add_sources(db, actor, workspace["id"], item["number"], rows, _now_ms())
        self._take_into_pipeline(db, actor, workspace["id"], [row[0] for row in rows if row[0]], item["number"], part, added=True)
        self._touch_item(db, workspace["id"], item["number"])
        version = self._bump(db, workspace["id"], item["number"])
        return {"workspace_id": workspace["id"], "number": item["number"], "pipeline_revision": version}, []

    def _command_pipeline_item_edit(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        allowed = {"title", "description", "size", "candidate_group", "raised_by", "raised_note", "needs", "gathering"}
        if set(target) != {"workspace_id", "number"} or not args or set(args) - allowed:
            raise Refusal("INVALID_ARGUMENT", "Change an item's title, words, size, group, who raised it, what it needs or where it gathers")
        workspace = self._workspace(db, actor, target["workspace_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        item = self._item_row(db, workspace["id"], target["number"])
        self._check_revision(envelope, "item_revision", item["version"])
        if ("raised_by" in args or "raised_note" in args) and actor not in (workspace["owner_id"], workspace["coordinator_id"]):
            raise Refusal("FORBIDDEN", "Only the owner or the coordinator changes who raised an item")
        if ({"title", "size"} & set(args)) and self._shipped(db, pipeline, item, self._shipped_numbers(db)):
            raise Refusal("ITEM_SHIPPED", "A shipped item keeps its title and size")
        changes = {}
        if "title" in args:
            changes["title"] = _text(args["title"], "The title", limit=500)
        if "description" in args:
            changes["description"] = _text(args["description"], "The words", required=False)
        if "size" in args:
            if (args["size"] is not None and args["size"] not in SIZES) if pipeline["sized"] else (args["size"] is not None):
                raise Refusal("INVALID_ARGUMENT", "An item in this pipeline is small, medium or large, or has no size yet" if pipeline["sized"] else "No size here")
            changes["size"] = args["size"]
        if "candidate_group" in args:
            changes["candidate_group"] = _text(args["candidate_group"], "candidate_group", required=False, limit=200)
        if "raised_by" in args:
            if args["raised_by"] is not None:
                self._actor(db, args["raised_by"])
            changes["raised_by"] = args["raised_by"]
        if "raised_note" in args:
            changes["raised_note"] = _text(args["raised_note"], "raised_note", required=False, limit=200)
        if "needs" in args:
            changes["needs"] = self._needs(args["needs"])
        if "gathering" in args:
            changes["gathering"] = self._gathering(db, actor, args["gathering"])
        before = {key: item[key] for key in changes}
        db.execute("UPDATE pipeline_items SET " + ",".join("%s=?" % key for key in changes) + ",version=version+1 WHERE workspace_id=? AND number=?",
                   tuple(changes.values()) + (workspace["id"], item["number"]))
        self._event(db, workspace["id"], item["number"], "edited", actor, {"before": before, "after": changes})
        version = self._bump(db, workspace["id"], item["number"])
        return {"workspace_id": workspace["id"], "number": item["number"], "pipeline_revision": version}, []

    def _command_pipeline_item_move(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id", "number"} or set(args) - {"section", "above", "below", "underway_confirmed", "undo_of",
                                                                    "because_message_id", "candidate_group"}:
            raise Refusal("INVALID_ARGUMENT", "Move an item to a section, above or below another, or undo a move")
        workspace = self._steerer(db, actor, target["workspace_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        item = self._item_row(db, workspace["id"], target["number"])
        self._check_revision(envelope, "item_revision", item["version"])
        number = item["number"]
        placed = db.execute("SELECT seq,by,ms FROM pipeline_events WHERE workspace_id=? AND number=? AND kind IN ('added','moved') "
                            "ORDER BY seq DESC LIMIT 1", (workspace["id"], number)).fetchone()
        owner = workspace["owner_id"]
        # D3: what the owner placed stays where the owner put it.
        if actor != owner and placed is not None and placed["by"] == owner:
            raise Refusal("OWNER_PLACED", "%s placed this item at %s. Say so once in this outcome's conversation; "
                          "Theseus does not move it back." % (owner, _clock(placed["ms"])))
        if self._shipped(db, pipeline, item, self._shipped_numbers(db)):
            raise Refusal("ITEM_SHIPPED", "A shipped item stays where it shipped")
        before = self._neighbours(db, item)
        undo_of = args.get("undo_of")
        if undo_of is not None:
            if isinstance(undo_of, bool) or not isinstance(undo_of, int) or placed is None or placed["seq"] != undo_of:
                raise Refusal("UNDO_STALE", "This item has moved since; nothing was undone")
            event = db.execute("SELECT * FROM pipeline_events WHERE seq=? AND kind='moved'", (undo_of,)).fetchone()
            if event is None:
                raise Refusal("UNDO_STALE", "Only a move can be undone")
            back = json.loads(event["payload"])["before"]
            section, group = back["section"], back.get("group", "")
            # Back where it was: above the item it was above, else below the one it was below, else last.
            above = back.get("above") if back.get("above") is not None and self._in_place(db, workspace["id"], back["above"], section, group) else None
            below = back.get("below") if above is None and back.get("below") is not None and self._in_place(db, workspace["id"], back["below"], section, group) else None
        else:
            section = args.get("section", item["section"])
            if section not in SECTIONS + ("dropped",):
                raise Refusal("INVALID_ARGUMENT", "Move an item to now, next, later, candidates or dropped")
            group = (_text(args.get("candidate_group", item["candidate_group"] if item["section"] == "candidates" else ""),
                           "candidate_group", required=False, limit=200) if section == "candidates" else "")
            above, below = args.get("above"), args.get("below")
        piece = self._open_piece_of(db, workspace["id"], number)
        entry = self._open_entry(db, piece["id"]) if piece is not None else None
        # An item being built stays in Now (D26), whether it is moved by section or by an Undo:
        # it leaves only by being dropped, which stops work under way and so is confirmed (D3).
        if section != item["section"] and entry is not None:
            if section != "dropped":
                raise Refusal("ITEM_IN_PIECE", "%d is being built now, so it stays in %s until it is dropped or its piece is done"
                              % (number, item["section"].capitalize()))
            if args.get("underway_confirmed") is not True:
                raise Refusal("ITEM_UNDERWAY", "%d is being built now, so dropping it stops work under way. Confirm to drop it." % number)
        because = args.get("because_message_id")
        if because is not None:
            because = self._message_access(db, actor, because)["id"]
        ms = _now_ms()
        position = self._place(db, workspace["id"], number, section, group, above, below)
        db.execute("UPDATE pipeline_items SET section=?,candidate_group=?,position=?,version=version+1 WHERE workspace_id=? AND number=?",
                   (section, group, position, workspace["id"], number))
        if section == "dropped" and entry is not None:
            # D25: the item leaves the piece under way. A finished piece keeps it.
            db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='dropped' WHERE piece_id=? AND number=?",
                       (ms, piece["id"], number))
        moved = self._item_row(db, workspace["id"], number)
        after = self._neighbours(db, moved)
        relative = {"above": above} if above is not None else {"below": below} if below is not None else None
        seq = self._event(db, workspace["id"], number, "moved", actor,
                          {"before": before, "after": after, "relative": relative, "undo_of": undo_of, "because_message_id": because}, ms)
        # Any move, Undo included, once its event is kept: a drop decides what became of the item, wherever it was or had
        # been combined from.
        self._settle(db, workspace["id"], [number], actor, ms, decided=[number] if section == "dropped" and item["section"] != "dropped" else ())
        version = self._bump(db, workspace["id"], number)
        return {"workspace_id": workspace["id"], "number": number, "section": section, "event": seq, "pipeline_revision": version}, []

    def _in_place(self, db, workspace_id, number, section, group):
        row = db.execute("SELECT section,candidate_group FROM pipeline_items WHERE workspace_id=? AND number=?", (workspace_id, number)).fetchone()
        return row is not None and row["section"] == section and row["candidate_group"] == group

    def _stage(self, db, workspace_id, stage_id, current=True):
        _slug(stage_id, "stage_id")
        row = db.execute("SELECT * FROM pipeline_stages WHERE workspace_id=? AND stage_id=?", (workspace_id, stage_id)).fetchone()
        if row is None or (current and row["position"] is None):
            raise Refusal("STAGE_UNKNOWN", "This outcome has no stage %s" % stage_id)
        return dict(row, gate=_loads(row["gate"], {}))

    def _entry_write(self, db, workspace_id, sql, values):
        """Every stage entry is opened and closed here; the database keeps the owner's word (D24)."""
        try:
            db.execute(sql, values)
        except sqlite3.IntegrityError as error:
            if str(error) not in _OWNERS_WORD:
                raise
            owner = db.execute("SELECT owner_id FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0]
            raise Refusal(str(error), _OWNERS_WORD[str(error)] % owner)

    def _enter(self, db, actor, piece, stage, round_number, size, ms, ask=None, note=""):
        """Opens a piece's entry in a stage; one that waits on the owner keeps the ask that entered it."""
        ask = _identifier(ask, "ask_message_id") if ask is not None and stage["gate"].get("owner") else None
        self._entry_write(db, piece["workspace_id"],
                          "INSERT INTO pipeline_stage_entries(piece_id,workspace_id,stage_id,round,size,entered_ms,entered_by,ask_message_id,note) "
                          "VALUES (?,?,?,?,?,?,?,?,?)", (piece["id"], piece["workspace_id"], stage["stage_id"], round_number, size, ms, actor, ask, note))

    def _leave(self, db, actor, entry, outcome, ms, note=""):
        """Closes an open entry, saying who left it and how."""
        self._entry_write(db, entry["workspace_id"], "UPDATE pipeline_stage_entries SET left_ms=?,left_outcome=?,left_note=?,left_by=? WHERE seq=?",
                          (ms, outcome, note, actor, entry["seq"]))

    def _command_pipeline_piece_start(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) - {"numbers", "size", "topic_id", "stage_id", "round", "ask_message_id", "from_release"}:
            raise Refusal("INVALID_ARGUMENT", "A piece names its items, its topic and its first stage")
        workspace = self._workspace(db, actor, target["workspace_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        numbers = args.get("numbers")
        if not isinstance(numbers, list) or not numbers or len(numbers) > 64:
            raise Refusal("INVALID_ARGUMENT", "A piece holds from 1 to 64 items")
        items = [self._item_row(db, workspace["id"], number) for number in dict.fromkeys(numbers)]
        shipped = self._shipped_numbers(db) if pipeline["ships_in_releases"] else {}
        for item in items:
            if item["number"] in shipped:
                # The records alone say what shipped: an item a release shipped is never built again (3.4).
                raise Refusal("ITEM_SHIPPED", "%d shipped in release %d; it is not built again" % (item["number"], shipped[item["number"]]["release"]))
        if args.get("from_release"):
            # D35: items of a held release go back to building; the rest is checked again as the next candidate.
            if actor not in (workspace["owner_id"], workspace["coordinator_id"]):
                raise Refusal("FORBIDDEN", "Only the owner or the coordinator takes items back from a release")
            release = self._the_release(db, workspace["id"])
            held = release is not None and self._release_held(db, workspace["id"])
            ms = _now_ms()
            for item in items:
                piece = self._open_piece_of(db, workspace["id"], item["number"])
                if not held or piece is None or piece["id"] != release["id"]:
                    raise Refusal("RELEASE_NOT_HELD", "%d is not in a release the checks stopped" % item["number"])
                db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='returned' WHERE piece_id=? AND number=?",
                           (ms, release["id"], item["number"]))
            db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (release["id"],))
        for item in items:
            if item["section"] != "now":
                raise Refusal("NOT_IN_NOW", "Move %d to Now before starting work on it" % item["number"])
            if self._open_piece_of(db, workspace["id"], item["number"]) is not None:
                raise Refusal("ITEM_IN_PIECE", "%d is already in a piece of work" % item["number"])
        topic = self._topic(db, actor, args.get("topic_id"))
        if topic["workspace_id"] != workspace["id"]:
            raise Refusal("TOPIC_OUTSIDE_OUTCOME", "The topic doing the work belongs to this outcome")
        if db.execute("SELECT 1 FROM pipeline_pieces p JOIN pipeline_stage_entries e ON e.piece_id=p.id AND e.left_ms IS NULL WHERE p.topic_id=?",
                      (topic["id"],)).fetchone():
            raise Refusal("TOPIC_HAS_PIECE", "That topic already holds a piece of work under way")
        stage = self._stage(db, workspace["id"], args.get("stage_id"))
        if stage["scope"] != "piece":
            raise Refusal("STAGE_UNKNOWN", "A piece starts in one of the stages a piece goes through")
        size = args.get("size")
        if pipeline["sized"]:
            size = size or max((item["size"] for item in items), key=lambda value: SIZES.index(value) if value in SIZES else -1)
            if size not in SIZES:
                raise Refusal("INVALID_ARGUMENT", "A piece is small, medium or large")
        else:
            size = None
        round_number = args.get("round", 1)
        if isinstance(round_number, bool) or not isinstance(round_number, int) or round_number < 1:
            raise Refusal("INVALID_ARGUMENT", "round is a whole number from 1")
        piece_id = "p-" + uuid.uuid4().hex[:24]
        ms = _now_ms()
        db.execute("INSERT INTO pipeline_pieces VALUES (?,?,?,?,NULL,NULL,1)", (piece_id, workspace["id"], "piece", topic["id"]))
        db.executemany("INSERT INTO pipeline_piece_members VALUES (?,?,?,NULL,NULL)", [(piece_id, workspace["id"], item["number"]) for item in items])
        self._enter(db, actor, {"id": piece_id, "workspace_id": workspace["id"]}, stage, round_number, size, ms, args.get("ask_message_id"))
        # A return to building (D35) empties a release; the rule ends it.
        self._settle(db, workspace["id"], [item["number"] for item in items], actor, ms)
        version = self._bump(db, workspace["id"], piece_id)
        return {"piece_id": piece_id, "numbers": [item["number"] for item in items], "stage_id": stage["stage_id"], "pipeline_revision": version}, []

    def _piece(self, db, actor, piece_id):
        row = db.execute("SELECT * FROM pipeline_pieces WHERE id=?", (_identifier(piece_id, "piece_id"),)).fetchone()
        if row is None:
            raise Refusal("NOT_FOUND", "No such piece of work")
        workspace = self._workspace(db, actor, row["workspace_id"])
        return row, workspace

    def _command_pipeline_stage_enter(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"piece_id"} or set(args) - {"stage_id", "round", "note", "left_outcome", "left_note", "ask_message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name the stage entered and how the last one was left")
        piece, workspace = self._piece(db, actor, target["piece_id"])
        self._pipeline_on(db, workspace["id"])
        self._check_revision(envelope, "piece_revision", piece["version"])
        entry = self._moving_entry(db, piece)
        leaving = self._stage(db, workspace["id"], entry["stage_id"], current=False)
        stage = self._stage(db, workspace["id"], args.get("stage_id"))
        if stage["scope"] != ("release" if piece["kind"] == "release" else "piece"):
            raise Refusal("INVALID_ARGUMENT", "A %s moves through %s stages" % (piece["kind"], piece["kind"]))
        if args.get("left_outcome") not in LEFT:
            raise Refusal("INVALID_ARGUMENT", "Say how the stage was left: approved, sent back, passed or held")
        round_number = args.get("round", 1)
        if isinstance(round_number, bool) or not isinstance(round_number, int) or round_number < 1:
            raise Refusal("INVALID_ARGUMENT", "round is a whole number from 1")
        if stage["stage_id"] == entry["stage_id"] and (stage["rounds"] == "none" or round_number != entry["round"] + 1):
            raise Refusal("INVALID_ARGUMENT", "Entering the same stage again is its next round, in a stage that has rounds")
        # D18 holds a piece in a gated stage; its next round there (D35: a new candidate after a stop) is not leaving it.
        if stage["stage_id"] != entry["stage_id"] and not self._gate_open(db, piece, leaving):
            raise Refusal("STAGE_GATED", "This stage's checks have not passed")
        ms = _now_ms()
        self._leave(db, actor, entry, args["left_outcome"], ms, _text(args.get("left_note", ""), "left_note", required=False, limit=1024))
        self._enter(db, actor, piece, stage, round_number, entry["size"], ms, args.get("ask_message_id"),
                    _text(args.get("note", ""), "note", required=False, limit=2048))
        db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (piece["id"],))
        version = self._bump(db, workspace["id"], piece["id"])
        return {"piece_id": piece["id"], "stage_id": stage["stage_id"], "round": round_number, "pipeline_revision": version}, []

    def _command_pipeline_stage_note(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"piece_id"} or "note" not in args or set(args) - {"note", "progress"}:
            raise Refusal("INVALID_ARGUMENT", "A stage note is its words, and a release stage's progress")
        piece, workspace = self._piece(db, actor, target["piece_id"])
        self._check_revision(envelope, "piece_revision", piece["version"])
        entry = self._moving_entry(db, piece)
        progress = args.get("progress")
        if progress is not None:
            stage = self._stage(db, workspace["id"], entry["stage_id"], current=False)
            if stage["scope"] != "release" or not isinstance(progress, dict) or set(progress) - {"steps_total", "steps", "running", "commit"}:
                raise Refusal("INVALID_ARGUMENT", "Progress is a release stage's steps so far")
            progress = _json(progress)
        db.execute("UPDATE pipeline_stage_entries SET note=?,progress=? WHERE seq=?",
                   (_text(args["note"], "note", required=False, limit=2048), progress if progress is not None else entry["progress"], entry["seq"]))
        db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (piece["id"],))
        version = self._bump(db, workspace["id"], piece["id"])
        return {"piece_id": piece["id"], "pipeline_revision": version}, []

    def _command_pipeline_combine(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) - {"release_number", "commit_sha", "piece_ids", "topic_id", "ask_message_id"}:
            raise Refusal("INVALID_ARGUMENT", "Combining names the release, its pieces and its topic")
        workspace = self._workspace(db, actor, target["workspace_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        if not pipeline["ships_in_releases"]:
            raise Refusal("NOT_A_RELEASE_PIPELINE", "This pipeline does not ship in releases")
        open_release = self._the_release(db, workspace["id"])
        if open_release is not None:
            # 3.4: one release at a time, so "the release" is one piece; approved work waits until it ships or ends.
            raise Refusal("RELEASE_OPEN", "Release %d is still being put together (%s); combine once it ships or every item has left it"
                          % (open_release["release_number"], self._stage(db, workspace["id"], open_release["stage_id"], current=False)["name"]))
        release = self._next_release(db)
        if args.get("release_number") is not None and _number(args["release_number"], "release_number") != release:
            raise Refusal("RELEASE_NUMBER", "The next release is %d, one past the last one shipped" % release)
        topic = self._topic(db, actor, args.get("topic_id"))
        if topic["workspace_id"] != workspace["id"]:
            raise Refusal("TOPIC_OUTSIDE_OUTCOME", "The release's topic belongs to this outcome")
        stages = self._stages(db, workspace["id"])
        first = next((stage for stage in stages if stage["scope"] == "release"), None)
        if first is None:
            raise Refusal("STAGE_UNKNOWN", "This pipeline has no release stages")
        # 3.4: a piece is combined once it is approved, waiting in the last stage a piece goes through.
        waiting = [stage for stage in stages if stage["scope"] == "piece"][-1:]
        piece_ids = args.get("piece_ids")
        if not isinstance(piece_ids, list) or not piece_ids:
            raise Refusal("INVALID_ARGUMENT", "Name the approved pieces to combine")
        ms = _now_ms()
        release_id = "p-" + uuid.uuid4().hex[:24]
        # No number is stored: the release's number is _next_release's while it is the release (3.4).
        db.execute("INSERT INTO pipeline_pieces VALUES (?,?,'release',?,NULL,?,1)",
                   (release_id, workspace["id"], topic["id"], args.get("commit_sha")))
        numbers = []
        for piece_id in dict.fromkeys(piece_ids):
            piece, _ = self._piece(db, actor, piece_id)
            entry = self._open_entry(db, piece["id"])
            if piece["workspace_id"] != workspace["id"] or piece["kind"] != "piece" or entry is None:
                raise Refusal("PIECE_CLOSED", "Piece %s is not open in this outcome" % piece_id)
            if not waiting or entry["stage_id"] != waiting[0]["stage_id"]:
                raise Refusal("PIECE_NOT_APPROVED", "Piece %s is in %s; a piece is combined once it waits in %s"
                              % (piece_id, self._stage(db, workspace["id"], entry["stage_id"], current=False)["name"],
                                 waiting[0]["name"] if waiting else "the last stage a piece goes through"))
            self._leave(db, actor, entry, "combined", ms)
            for number in self._members(db, piece["id"]):
                db.execute("UPDATE pipeline_piece_members SET left_ms=?,left_reason='combined' WHERE piece_id=? AND number=?", (ms, piece["id"], number))
                db.execute("INSERT INTO pipeline_piece_members VALUES (?,?,?,NULL,NULL)", (release_id, workspace["id"], number))
                numbers.append(number)
        self._enter(db, actor, {"id": release_id, "workspace_id": workspace["id"]}, first, 1, None, ms, args.get("ask_message_id"))
        self._settle(db, workspace["id"], numbers, actor, ms)
        version = self._bump(db, workspace["id"], release_id)
        return {"piece_id": release_id, "release_number": release, "numbers": numbers, "pipeline_revision": version}, []

    def _command_pipeline_piece_finish(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"piece_id"} or set(args) - {"note"}:
            raise Refusal("INVALID_ARGUMENT", "Name the piece that is done")
        piece, workspace = self._piece(db, actor, target["piece_id"])
        pipeline = self._pipeline_on(db, workspace["id"])
        self._check_revision(envelope, "piece_revision", piece["version"])
        if pipeline["ships_in_releases"]:
            raise Refusal("RELEASE_PIPELINE_SHIPS_BY_RECORD", "This pipeline's items finish when a release record ships them")
        entry = self._open_entry(db, piece["id"])
        if entry is None:
            raise Refusal("PIECE_CLOSED", "This piece of work has finished")
        ms = _now_ms()
        self._leave(db, actor, entry, "done", ms, _text(args.get("note", ""), "note", required=False, limit=1024))
        self._settle(db, workspace["id"], self._members(db, piece["id"]), actor, ms)
        db.execute("UPDATE pipeline_pieces SET version=version+1 WHERE id=?", (piece["id"],))
        version = self._bump(db, workspace["id"], piece["id"])
        return {"piece_id": piece["id"], "pipeline_revision": version}, []

    def _record_subjects(self, db, workspace_id, message_id, subjects):
        """A post's subjects (3.6), written with the post: items of its outcome's pipeline, or its checks."""
        if not isinstance(subjects, list) or len(subjects) > 16:
            raise Refusal("INVALID_ARGUMENT", "subjects is a list of at most 16 {kind, ref}")
        for subject in subjects:
            if not isinstance(subject, dict) or set(subject) != {"kind", "ref"} or subject["kind"] not in ("item", "check"):
                raise Refusal("INVALID_ARGUMENT", "A subject is {kind: item, ref: number} or {kind: check, ref: check id}")
            if subject["kind"] == "check":
                if not isinstance(subject["ref"], str) or not db.execute(
                        "SELECT 1 FROM outcome_checks WHERE workspace_id=? AND check_id=?", (workspace_id, subject["ref"])).fetchone():
                    raise Refusal("CHECK_UNKNOWN", "No check %s in this outcome" % subject["ref"])
                db.execute("INSERT OR IGNORE INTO message_subjects VALUES (?,?,?,?)", (message_id, workspace_id, "check", subject["ref"]))
                continue
            ref = _number(int(subject["ref"]) if isinstance(subject["ref"], str) and subject["ref"].isdigit() else subject["ref"], "subject")
            self._item_row(db, workspace_id, ref)
            db.execute("INSERT OR IGNORE INTO message_subjects VALUES (?,?,?,?)", (message_id, workspace_id, "item", str(ref)))

    # ---- views (5.1) -------------------------------------------------------------

    def _asks_about(self, db, actor, workspace_id):
        """{number: [ask]} open asks to the reader whose subject is an item of this outcome."""
        rows = db.execute("SELECT s.ref,q.topic_id,q.ask_message_id,m.author_id,m.sent_ms,m.seq,substr(m.body,1,240) AS excerpt,"
                          "substr(CAST(t.title AS BLOB),1,257) AS title_prefix FROM topic_waiting q "
                          "JOIN message_subjects s ON s.message_id=q.ask_message_id AND s.kind='item' "
                          "JOIN messages m ON m.id=q.ask_message_id JOIN topics t ON t.id=q.topic_id "
                          "WHERE q.actor_id=? AND q.archived=0 AND s.workspace_id=? ORDER BY m.sent_ms DESC", (actor, workspace_id)).fetchall()
        asks = {}
        for row in rows:
            title, _ = _prefix(row["title_prefix"], 256)
            asks.setdefault(int(row["ref"]), []).append({
                "message_id": row["ask_message_id"], "seq": row["seq"], "topic_id": row["topic_id"], "topic_title": title,
                "by": row["author_id"], "since_ms": row["sent_ms"], "excerpt": row["excerpt"]})
        return asks

    def _typical(self, db, workspace_id, stage, size, round_number, cache):
        key = (stage["stage_id"], size, round_number > 1 if stage["rounds"] == "split" else None)
        if key not in cache:
            sql = ("SELECT left_ms-entered_ms FROM pipeline_stage_entries INDEXED BY stage_history WHERE workspace_id=? AND stage_id=? "
                   "AND size IS ? AND left_ms IS NOT NULL AND left_outcome<>'dropped'")
            values = [workspace_id, stage["stage_id"], size]
            if key[2] is not None:
                sql += " AND (round > 1)=?"
                values.append(int(key[2]))
            sql += " ORDER BY left_ms DESC LIMIT ?"
            values.append(outcome_rules.TYPICAL_WINDOW)
            durations = [row[0] for row in db.execute(sql, values)]
            basis = "release" if stage["scope"] == "release" else "size" if size else "outcome"
            cache[key] = outcome_rules.typical(durations, basis)
        return cache[key]

    def _piece_view(self, db, actor, workspace, piece, stages, work, cache, titles):
        entries = db.execute("SELECT * FROM pipeline_stage_entries WHERE piece_id=? ORDER BY seq", (piece["id"],)).fetchall()
        by_id = {stage["stage_id"]: stage for stage in self._stages(db, workspace["id"], current=False)}
        order = [stage["stage_id"] for stage in stages]

        def entry_view(entry):
            stage = by_id.get(entry["stage_id"], {"name": entry["stage_id"], "rounds": "none", "gate": {}, "scope": "piece", "stage_id": entry["stage_id"]})
            return {"stage_id": entry["stage_id"], "name": outcome_rules.stage_name(stage["name"], stage["rounds"], entry["round"]),
                    "round": entry["round"], "entered_ms": entry["entered_ms"], "entered_by": entry["entered_by"],
                    "left_ms": entry["left_ms"], "left_outcome": entry["left_outcome"], "left_note": entry["left_note"],
                    "note": entry["note"], "progress": _loads(entry["progress"], None)}
        current = next((entry for entry in entries if entry["left_ms"] is None), None)
        members = self._members(db, piece["id"])
        view = {"id": piece["id"], "kind": piece["kind"], "release_number": piece["release_number"],
                "commit": self._release_commit(db, piece) if piece["kind"] == "release" else None,
                "size": entries[0]["size"] if entries else None, "items": members,
                "titles": {str(number): titles.get(number) for number in members},
                "started": {"by": entries[0]["entered_by"], "ms": entries[0]["entered_ms"]} if entries else None,
                "stages_so_far": [entry_view(entry) for entry in entries if entry["left_ms"] is not None],
                "stage": None, "ahead": [], "ahead_ids": [], "version": piece["version"]}
        topic = db.execute("SELECT id,substr(CAST(title AS BLOB),1,257) AS title_prefix,state FROM topics WHERE id=?", (piece["topic_id"],)).fetchone()
        if topic is not None:
            title, _ = _prefix(topic["title_prefix"], 256)
            view["topic"] = {"id": topic["id"], "title": title, "state": topic["state"], "work": work.get(topic["id"])}
        if current is not None:
            stage = by_id.get(current["stage_id"])
            line = entry_view(current)
            line["gate_words"] = stage["gate"].get("words", "") if stage else ""
            line["gate_checks"] = stage["gate"].get("checks", []) if stage else []
            line["owner_gate"] = bool(stage and stage["gate"].get("owner"))
            line["you_leave_it"] = line["owner_gate"] and actor == workspace["owner_id"]
            line["typical"] = self._typical(db, workspace["id"], stage, current["size"], current["round"], cache) if stage else None
            view["stage"] = line
            if current["stage_id"] in order:
                view["ahead"] = [by_id[stage_id]["name"] for stage_id in order[order.index(current["stage_id"]) + 1:]]
                view["ahead_ids"] = order[order.index(current["stage_id"]) + 1:]
        return view

    def _sources_view(self, db, actor, workspace_id, number, limit):
        rows = db.execute("SELECT s.*,m.seq,m.author_id,m.topic_id,substr(CAST(t.title AS BLOB),1,257) AS title_prefix,"
                          "substr(CAST(r.title AS BLOB),1,257) AS page_prefix FROM pipeline_item_sources s "
                          "LEFT JOIN messages m ON m.id=s.message_id LEFT JOIN topics t ON t.id=m.topic_id "
                          "LEFT JOIN memory_items i ON i.id=s.memory_item_id LEFT JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision "
                          "WHERE s.workspace_id=? AND s.number=? ORDER BY s.position", (workspace_id, number)).fetchall()
        shown, topics, messages, notes, yours = [], [], 0, 0, 0
        for row in rows:
            if row["message_id"] is not None:
                messages += 1
                # Core grants reading per message (an addressed message stays readable
                # to someone taken out of its topic), so each one is asked on its own.
                try:
                    self._message_access(db, actor, row["message_id"])
                    readable = True
                except Refusal:
                    readable = False
                if readable:
                    title, _ = _prefix(row["title_prefix"], 256)
                    yours += row["author_id"] == actor
                    if title not in topics:
                        topics.append(title)
                    entry = {"kind": "message", "message_id": row["message_id"], "seq": row["seq"], "topic_id": row["topic_id"],
                             "topic_title": title, "author": row["author_id"], "readable": True}
                else:
                    entry = {"kind": "message", "readable": False}
            elif row["memory_item_id"] is not None:
                title, _ = _prefix(row["page_prefix"] or b"", 256)
                entry = {"kind": "page", "memory_item_id": row["memory_item_id"], "title": title}
            else:
                notes += 1
                entry = {"kind": "note", "text": row["note"]}
            if len(shown) < limit:
                shown.append(entry)
        return {"count": len(rows), "messages": messages, "notes": notes, "yours": yours, "topics": topics, "shown": shown}

    def _gathering_view(self, db, actor, text):
        value = _loads(text, None)
        if not value:
            return None
        if "message_id" in value:
            try:
                row = self._message_access(db, actor, value["message_id"])
            except Refusal:
                return {"kind": "thread", "readable": False}
            seq, title, topic = db.execute("SELECT m.seq,t.title,t.id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?", (row["id"],)).fetchone()
            return {"kind": "thread", "message_id": row["id"], "seq": seq, "topic_id": topic, "topic_title": title, "author": row["author_id"], "readable": True}
        row = db.execute("SELECT r.title FROM memory_items i JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision WHERE i.id=?",
                         (value["memory_item_id"],)).fetchone()
        return {"kind": "page", "memory_item_id": value["memory_item_id"], "title": row[0] if row else ""}

    def _placed(self, db, actor, workspace_id, number):
        row = db.execute("SELECT * FROM pipeline_events WHERE workspace_id=? AND number=? AND kind IN ('added','moved') ORDER BY seq DESC LIMIT 1",
                         (workspace_id, number)).fetchone()
        if row is None:
            return None
        payload = json.loads(row["payload"])
        because = None
        if payload.get("because_message_id"):
            try:
                message = self._message_access(db, actor, payload["because_message_id"])
                title = db.execute("SELECT title FROM topics WHERE id=?", (message["topic_id"],)).fetchone()[0]
                because = {"message_id": message["id"], "topic_title": title, "author": message["author_id"]}
            except Refusal:
                because = None
        return {"kind": row["kind"], "by": row["by"], "ms": row["ms"], "relative": payload.get("relative"), "event": row["seq"],
                "section": (payload.get("after") or {}).get("section", payload.get("section")),
                "from_section": (payload.get("before") or {}).get("section"), "undo_of": payload.get("undo_of"),
                "progress": payload.get("progress"), "because": because}

    def _item_view(self, db, actor, workspace, pipeline, row, releases, asks, pieces, cache, full=False):
        number = row["number"]
        shipped = self._shipped(db, pipeline, row, releases)
        piece = pieces.get(number)
        in_stage = piece is not None and piece.get("stage") is not None
        open_asks = asks.get(number, [])
        needs = [{"number": need, "shipped": need in releases} for need in json.loads(row["needs"])]
        placed = self._placed(db, actor, workspace["id"], number)
        item = {"number": number, "title": row["title"], "description": row["description"], "size": row["size"],
                "raised_by": row["raised_by"], "raised_note": row["raised_note"], "section": row["section"],
                "candidate_group": row["candidate_group"],
                "glyph": outcome_rules.glyph(row["section"], shipped, open_asks, in_stage),
                "piece": {"id": piece["id"], "kind": piece["kind"]} if piece else None,
                "stage": piece["stage"] if piece else None,
                "needs": needs, "asks": open_asks,
                "sources": self._sources_view(db, actor, workspace["id"], number, 10 ** 6 if full else outcome_rules.SOURCES_SHOWN),
                "gathering": self._gathering_view(db, actor, row["gathering"]),
                "placed": placed, "shipped": shipped,
                "dropped": ({"by": placed["by"], "ms": placed["ms"], "event": placed["event"]}
                            if row["section"] == "dropped" and placed else None),
                "version": row["version"]}
        if full:
            item["events"] = [dict(kind=event["kind"], by=event["by"], ms=event["ms"], seq=event["seq"], payload=json.loads(event["payload"]))
                              for event in db.execute("SELECT * FROM pipeline_events WHERE workspace_id=? AND number=? ORDER BY seq",
                                                      (workspace["id"], number))]
            item["pieces"] = []
            for other in db.execute("SELECT DISTINCT piece_id FROM pipeline_piece_members WHERE workspace_id=? AND number=?", (workspace["id"], number)):
                prow = db.execute("SELECT * FROM pipeline_pieces WHERE id=?", (other[0],)).fetchone()
                item["pieces"].append(self._piece_view(db, actor, workspace, prow, self._stages(db, workspace["id"]), {}, cache, {}))
            if piece:
                item["piece"] = piece
        return item

    def _pipeline_context(self, db, actor, workspace):
        """What every pipeline read shares: its row, stages, the release records, asks to the reader and the open pieces."""
        pipeline = self._pipeline_row(db, workspace["id"])
        stages = self._stages(db, workspace["id"]) if pipeline else []
        releases = self._shipped_numbers(db) if pipeline and pipeline["ships_in_releases"] else {}
        asks = self._asks_about(db, actor, workspace["id"]) if pipeline else {}
        open_rows = db.execute("SELECT p.* FROM pipeline_stage_entries e INDEXED BY open_entries JOIN pipeline_pieces p ON p.id=e.piece_id "
                               "WHERE e.workspace_id=? AND e.left_ms IS NULL ORDER BY e.entered_ms DESC", (workspace["id"],)).fetchall() if pipeline else []
        # The release (3.4) shown with the number it ships as.
        release = self._the_release(db, workspace["id"]) if pipeline else None
        release_id = release["id"] if release else None
        open_rows = [release if row["id"] == release_id else row for row in open_rows if row["kind"] == "piece" or row["id"] == release_id]
        topic_ids = sorted({row["topic_id"] for row in open_rows})
        work = work_by_topic(db, self._waits_by_topic(db, topic_ids), actor) if topic_ids else {}
        titles = {}
        for row in open_rows:
            for number, title in db.execute("SELECT i.number,i.title FROM pipeline_piece_members m JOIN pipeline_items i "
                                            "ON i.workspace_id=m.workspace_id AND i.number=m.number WHERE m.piece_id=? AND m.left_ms IS NULL", (row["id"],)):
                titles[number] = title
        cache = {}
        pieces = [self._piece_view(db, actor, workspace, row, stages, work, cache, titles) for row in open_rows]
        by_item = {}
        for piece in pieces:
            for number in piece["items"]:
                by_item[number] = piece
        return pipeline, stages, releases, asks, pieces, by_item, cache

    def _pipeline_head(self, db, actor, workspace, pipeline, stages, releases, asks, pieces, cache):
        live = db.execute("SELECT number,deployed_ms,items FROM releases ORDER BY number DESC LIMIT 1").fetchone() if pipeline["ships_in_releases"] else None
        release_piece = next((piece for piece in pieces if piece["kind"] == "release"), None)
        work_pieces = [piece for piece in pieces if piece["kind"] == "piece"]
        last_piece_stage = None
        if pipeline["ships_in_releases"]:
            piece_stages = [stage for stage in stages if stage["scope"] == "piece"]
            last_piece_stage = piece_stages[-1]["stage_id"] if piece_stages else None
        approved = [number for piece in work_pieces if piece["stage"] and piece["stage"]["stage_id"] == last_piece_stage
                    and len(stages) > 1 for number in piece["items"]]
        banner = None
        if live is not None and not db.execute("SELECT 1 FROM pipeline_stage_entries WHERE workspace_id=? AND entered_ms>? LIMIT 1",
                                               (workspace["id"], live["deployed_ms"])).fetchone():
            banner = {"release": live["number"], "deployed_ms": live["deployed_ms"], "items": json.loads(live["items"])}
        waiting = []
        for number, rows in asks.items():
            item = db.execute("SELECT title FROM pipeline_items WHERE workspace_id=? AND number=?", (workspace["id"], number)).fetchone()
            for ask in rows:
                waiting.append({"topic_id": ask["topic_id"], "topic_title": ask["topic_title"], "number": number,
                                "item_title": item[0] if item else "", "by": ask["by"], "since_ms": ask["since_ms"], "message_id": ask["message_id"]})
        waiting.sort(key=lambda ask: -(ask["since_ms"] or 0))
        stage_rows = []
        sizes = list(SIZES) if pipeline["sized"] else [None]
        for stage in stages:
            if stage["scope"] == "release":
                stage_rows.append({"stage_id": stage["stage_id"], "label": stage["name"],
                                   "release": self._typical(db, workspace["id"], stage, None, 1, cache)})
                continue
            classes = [(stage["name"] + (", each round" if stage["rounds"] == "together" else ""), 1, False)]
            if stage["rounds"] == "split":
                classes.append((stage["name"] + ", each later round", 2, True))
            for label, round_number, later in classes:
                stage_rows.append({"stage_id": stage["stage_id"], "later_rounds": later, "label": label,
                                   "cells": {size or "all": self._typical(db, workspace["id"], stage, size, round_number, cache) for size in sizes}})
        return {
            "facts": {"live": {"release": live["number"], "deployed_ms": live["deployed_ms"]} if live else None,
                      "next_release": ({"release": release_piece["release_number"], "piece_id": release_piece["id"],
                                        "stage": release_piece["stage"], "items": release_piece["items"]} if release_piece else None),
                      "approved_waiting": approved,
                      "building": {"items": [number for piece in work_pieces for number in piece["items"]], "pieces": len(work_pieces)},
                      "done": db.execute("SELECT count(DISTINCT m.number) FROM pipeline_piece_members m JOIN pipeline_stage_entries e "
                                         "ON e.piece_id=m.piece_id AND e.left_outcome='done' WHERE m.workspace_id=?", (workspace["id"],)).fetchone()[0]},
            "banner": banner, "release_piece": release_piece, "waiting": waiting, "pieces": work_pieces,
            "stage_times": {"min": outcome_rules.TYPICAL_MIN, "sized": bool(pipeline["sized"]), "rows": stage_rows},
        }

    def _pipeline_shape(self, workspace, pipeline, stages, actor):
        return {"enabled": bool(pipeline["enabled"]), "title": pipeline["title"], "unit_one": pipeline["unit_one"],
                "unit_many": pipeline["unit_many"], "sized": bool(pipeline["sized"]), "ships_in_releases": bool(pipeline["ships_in_releases"]),
                "section_words": _loads(pipeline["section_words"], SECTION_WORDS), "coordinator": workspace["coordinator_id"],
                "owner": workspace["owner_id"], "you_steer": self._steers(workspace, actor),
                "you_own": actor == workspace["owner_id"],
                "stages": [{"stage_id": stage["stage_id"], "name": stage["name"], "done_when": stage["done_when"], "gate": stage["gate"],
                            "rounds": stage["rounds"], "scope": stage["scope"], "added_note": stage["added_note"],
                            "you_leave_it": bool(stage["gate"].get("owner")) and actor == workspace["owner_id"]} for stage in stages],
                "version": pipeline["version"]}

    def _view_pipeline(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        pipeline, stages, releases, asks, pieces, by_item, cache = self._pipeline_context(db, actor, workspace)
        answer = {"instance_id": self.instance_id, "workspace_id": workspace["id"], "workspace_title": workspace["title"]}
        if pipeline is None:
            return dict(answer, pipeline=None, you_own=actor == workspace["owner_id"], you_steer=self._steers(workspace, actor), items=[], next_cursor=None,
                        relevant_versions={"pipeline": 0, "workspace": workspace["version"]})
        answer["pipeline"] = self._pipeline_shape(workspace, pipeline, stages, actor)
        answer["relevant_versions"] = {"pipeline": pipeline["version"], "workspace": workspace["version"]}
        section = args.get("section", "now")
        if section not in SECTIONS + ("dropped", "shipped"):
            raise Refusal("INVALID_ARGUMENT", "section is now, next, later, candidates, dropped or shipped")
        offset = args.get("cursor", 0)
        limit = _page_size(args)
        if section == "now":
            answer.update(self._pipeline_head(db, actor, workspace, pipeline, stages, releases, asks, pieces, cache))
        answer["counts"] = {name: count for name, count in db.execute(
            "SELECT section,count(*) FROM pipeline_items WHERE workspace_id=? GROUP BY section", (workspace["id"],))}
        if section == "shipped":
            return dict(answer, **self._shipped_groups(db, actor, workspace, pipeline, releases, offset, limit))
        rows = db.execute("SELECT * FROM pipeline_items INDEXED BY pipeline_order WHERE workspace_id=? AND section=? "
                          "ORDER BY candidate_group, position, number", (workspace["id"], section)).fetchall()
        # What shipped is listed under its release, a dropped item a record overtook too, never in its section.
        rows = [row for row in rows if not self._shipped(db, pipeline, row, releases)]
        items, size = [], 1024
        for row in rows[offset:offset + limit]:
            item = self._item_view(db, actor, workspace, pipeline, row, releases, asks, by_item, cache)
            encoded = len(_json(item).encode("utf-8")) + 1
            if size + encoded > LIMITS["summary_utf8_bytes"] and items:
                break
            items.append(item)
            size += encoded
        answer["items"] = items
        answer["next_cursor"] = offset + len(items) if offset + len(items) < len(rows) else None
        return answer

    def _shipped_groups(self, db, actor, workspace, pipeline, releases, offset, limit):
        """Shipped groups newest first: each release record's items, then what finished before releases were numbered."""
        groups = []
        if pipeline["ships_in_releases"]:
            for row in db.execute("SELECT number,deployed_ms,items FROM releases ORDER BY number DESC"):
                groups.append({"label": "Release %d" % row["number"], "record": row["number"], "deployed_ms": row["deployed_ms"],
                               "numbers": json.loads(row["items"]), "notes_label": str(row["number"])})
        notes = {}
        for row in db.execute("SELECT DISTINCT finished_note FROM pipeline_items WHERE workspace_id=? AND finished_note<>''", (workspace["id"],)):
            label = row[0].split(",")[0]
            groups.append({"label": "Before releases were numbered, %s" % label, "record": None, "deployed_ms": None,
                           "numbers": [r[0] for r in db.execute("SELECT number FROM pipeline_items WHERE workspace_id=? AND finished_note=? "
                                                                "ORDER BY position, number", (workspace["id"], row[0]))],
                           "notes_label": label})
        if not pipeline["ships_in_releases"]:
            done = [r[0] for r in db.execute("SELECT DISTINCT m.number FROM pipeline_piece_members m JOIN pipeline_stage_entries e "
                                             "ON e.piece_id=m.piece_id AND e.left_outcome='done' WHERE m.workspace_id=? ORDER BY e.left_ms DESC",
                                             (workspace["id"],))]
            if done:
                groups.append({"label": "Done", "record": None, "deployed_ms": None, "numbers": done, "notes_label": None})
        page = groups[offset:offset + limit]
        for group in page:
            items = []
            for number in group.pop("numbers"):
                row = db.execute("SELECT * FROM pipeline_items WHERE workspace_id=? AND number=?", (workspace["id"], number)).fetchone()
                items.append({"number": number, "title": row["title"] if row else "(not in this pipeline)",
                              "sources": self._sources_view(db, actor, workspace["id"], number, 8) if row else None})
            group["items"] = items
            label = group.pop("notes_label")
            group["notes"] = [r[0] for r in db.execute("SELECT text FROM release_notes WHERE release_label=? ORDER BY position", (label,))] if label else []
        return {"groups": page, "next_cursor": offset + len(page) if offset + len(page) < len(groups) else None}

    def _view_pipeline_item(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        pipeline, stages, releases, asks, pieces, by_item, cache = self._pipeline_context(db, actor, workspace)
        if pipeline is None:
            raise Refusal("PIPELINE_OFF", "This outcome has no pipeline")
        row = self._item_row(db, workspace["id"], args.get("number"))
        item = self._item_view(db, actor, workspace, pipeline, row, releases, asks, by_item, cache, full=True)
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "workspace_title": workspace["title"],
                "pipeline": self._pipeline_shape(workspace, pipeline, stages, actor), "item": item,
                "relevant_versions": {"pipeline": pipeline["version"]}}

    def _view_pipeline_row(self, db, actor, args):
        """The rail's Pipeline row (D19): title, Waiting on you, and the newest work seen in a Now piece's topic."""
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        pipeline = self._pipeline_row(db, workspace["id"])
        if pipeline is None or not pipeline["enabled"]:
            return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "pipeline": None,
                    "you_own": actor == workspace["owner_id"], "you_steer": self._steers(workspace, actor),
                    "relevant_versions": {"pipeline": pipeline["version"] if pipeline else 0}}
        asks = self._asks_about(db, actor, workspace["id"])
        topics = [row[0] for row in db.execute("SELECT DISTINCT p.topic_id FROM pipeline_stage_entries e INDEXED BY open_entries "
                                               "JOIN pipeline_pieces p ON p.id=e.piece_id WHERE e.workspace_id=? AND e.left_ms IS NULL",
                                               (workspace["id"],))]
        work = work_by_topic(db, self._waits_by_topic(db, topics), actor) if topics else {}
        seen = max((value for value in work.values() if value["observed"]), key=lambda value: value["seen_ms"] or 0, default=None)
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"],
                "pipeline": {"title": pipeline["title"], "asks": sum(len(rows) for rows in asks.values()), "work": seen},
                "you_own": actor == workspace["owner_id"], "you_steer": self._steers(workspace, actor),
                "relevant_versions": {"pipeline": pipeline["version"]}}

    def _pipeline_light_facts(self, db, actor, workspace_id):
        """The outcome light's pipeline facts (86, D4): None while the pipeline is off."""
        pipeline = self._pipeline_row(db, workspace_id)
        if pipeline is None or not pipeline["enabled"]:
            return None
        releases = self._shipped_numbers(db) if pipeline["ships_in_releases"] else {}
        rows = db.execute("SELECT * FROM pipeline_items WHERE workspace_id=? AND section<>'dropped'", (workspace_id,)).fetchall()
        now, topics, shipped, unshipped = [], {}, 0, 0
        for row in rows:
            if self._shipped(db, pipeline, row, releases):
                shipped += 1
                continue
            unshipped += 1
            if row["section"] != "now":
                continue
            piece = self._open_piece_of(db, workspace_id, row["number"])
            topics[row["number"]] = piece["topic_id"] if piece else None
            now.append(row)
        topic_ids = sorted({topic for topic in topics.values() if topic})
        work = work_by_topic(db, self._waits_by_topic(db, topic_ids), actor) if topic_ids else {}
        empty = {"observed": False, "seen_ms": None, "by": None, "how": None, "waits": False}
        names = {topic_id: db.execute("SELECT title FROM topics WHERE id=?", (topic_id,)).fetchone()[0] for topic_id in topic_ids}
        items = [{"number": row["number"], "title": row["title"], "topic_id": topics[row["number"]],
                  "topic_title": names.get(topics[row["number"]]), "work": work.get(topics[row["number"]], empty)} for row in now]
        seen = [item for item in items if item["work"].get("seen_ms") is not None]
        last = max(seen, key=lambda item: item["work"]["seen_ms"]) if seen else None
        newest = db.execute("SELECT max(deployed_ms) FROM releases").fetchone()[0] if pipeline["ships_in_releases"] else None
        return {"now": items, "all_shipped": unshipped == 0,
                "shipped": {"count": shipped, "last_release_ms": newest} if shipped else None,
                "last_now_work": ({"by": last["work"]["by"], "how": last["work"]["how"], "item": last["number"],
                                   "title": last["title"], "topic_title": last["topic_title"], "ms": last["work"]["seen_ms"]} if last else None)}

def _words(text):
    return set(re.findall(r"[a-z0-9']+", text.lower().replace("\u2019", "'")))


def _clock(ms):
    import time
    return time.strftime("%-I:%M %p %a %b %-d", time.localtime(ms / 1000.0))


def import_seed(store, db, seed, actor, now_ms):
    """Move a reviewed seed into an outcome's pipeline, in one transaction (docs/pipeline.md, "The import").

    Refuses when the outcome already has a pipeline (the same seed again changes
    nothing), when the Notebook page has a revision newer than the seed's
    (SEED_STALE), when a source names a message that is not in the topic the
    page said or is a whisper, and when the page and the release records disagree on what
    shipped. Returns its report."""
    workspace_id = _identifier(seed.get("workspace_id"), "workspace_id")
    workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
    if workspace is None:
        raise Refusal("NOT_FOUND", "No outcome %s" % workspace_id)
    store._actor(db, actor)
    if db.execute("SELECT 1 FROM pipelines WHERE workspace_id=?", (workspace_id,)).fetchone():
        if db.execute("SELECT 1 FROM pipeline_items WHERE workspace_id=? LIMIT 1", (workspace_id,)).fetchone():
            return {"imported": False, "workspace_id": workspace_id}
        raise Refusal("PIPELINE_EXISTS", "This outcome already has a pipeline that is not the seed's")
    built = seed.get("built_from") or {}
    if built.get("memory_item_id"):
        current = db.execute("SELECT current_revision FROM memory_items WHERE id=?", (built["memory_item_id"],)).fetchone()
        if current is not None and current[0] > built.get("revision", 0):
            raise Refusal("SEED_STALE", "The page is at revision %d and the seed was built from %d; build the seed again"
                          % (current[0], built.get("revision", 0)))
    settings = seed["pipeline"]
    if settings.get("ships_in_releases") and db.execute("SELECT 1 FROM pipelines WHERE ships_in_releases=1").fetchone():
        raise Refusal("RELEASES_TAKEN", "Another outcome's pipeline already ships in this instance's releases")
    db.execute("INSERT INTO pipelines VALUES (?,1,?,?,?,?,?,?,1)",
               (workspace_id, settings["title"], settings.get("unit_one", "item"), settings.get("unit_many", "items"),
                int(bool(settings.get("sized", True))), int(bool(settings.get("ships_in_releases", False))), _json(SECTION_WORDS)))
    store._event(db, workspace_id, None, "configured", actor, {"before": None, "after": dict(settings, enabled=True), "imported": True}, now_ms)
    for position, stage in enumerate(seed.get("stages", []), 1):
        db.execute("INSERT INTO pipeline_stages VALUES (?,?,?,?,?,?,?,?,?)",
                   (workspace_id, _slug(stage["stage_id"], "stage_id"), position, stage["name"], stage.get("done_when", ""),
                    _json(stage.get("gate", {})), stage.get("rounds", "none"), stage.get("scope", "piece"), stage.get("added_note", "")))
    store._event(db, workspace_id, None, "stages", actor, {"before": [], "after": seed.get("stages", []), "imported": True}, now_ms)
    releases = {}
    for row in db.execute("SELECT r.number,j.value FROM releases r, json_each(r.items) j"):
        releases[row[1]] = row[0]
    positions, counts, actors = {}, {}, {row[0] for row in db.execute("SELECT id FROM actors")}
    disagree = []
    for item in seed["items"]:
        number = _number(item["number"])
        if item.get("shipped_in") is not None and releases.get(number) != item["shipped_in"]:
            disagree.append(number)
        key = (item["section"], item.get("candidate_group", ""))
        positions[key] = positions.get(key, 0) + 1
        raised_by = item.get("raised_by")
        raised_note = item.get("raised_note", "")
        if raised_by is not None and raised_by not in actors:
            raised_by, raised_note = None, "raised by %s" % raised_by
        db.execute("INSERT INTO pipeline_items VALUES (?,?,?,?,?,?,?,?,?,?,'[]',?,NULL,1)",
                   (workspace_id, number, item["title"], item.get("description", ""), item.get("size"), raised_by, raised_note,
                    item["section"], item.get("candidate_group", ""), positions[key], item.get("finished_note", "")))
        for offset, source in enumerate(item.get("sources", []), 1):
            if "seq" in source:
                row = db.execute("SELECT m.id,t.title FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.seq=?", (source["seq"],)).fetchone()
                # The page names a topic in short ("Evaluation first baseline"): every word it uses is in the title.
                if row is None or not _words(source["topic"]) <= _words(row[1]):
                    raise Refusal("SEED_SOURCE", "Item %d's source %s #%d is not a message in that topic" % (number, source["topic"], source["seq"]))
                # A whisper is never where an item came from, here as in _source_rows.
                private_source_refused(db, row[0])
                values = (row[0], None, None)
            else:
                values = (None, None, source["note"])
            db.execute("INSERT INTO pipeline_item_sources VALUES (?,?,?,?,?,?,?,?)", (workspace_id, number, offset) + values + (actor, now_ms))
        payload = {"section": item["section"], "group": item.get("candidate_group", ""), "imported": True}
        if item.get("progress"):
            payload["progress"] = item["progress"]
        store._event(db, workspace_id, number, "added", actor, payload, now_ms)
        shown = "shipped" if item.get("shipped_in") is not None or item.get("finished_note") else item["section"]
        counts[shown] = counts.get(shown, 0) + 1
    if disagree:
        raise Refusal("SEED_DISAGREES", "The page and the release records disagree on what shipped: %s" % ", ".join(map(str, disagree)))
    for label, notes in (seed.get("release_notes") or {}).items():
        for position, text in enumerate(notes, 1):
            db.execute("INSERT OR IGNORE INTO release_notes VALUES (?,?,?)", (label, position, text))
    store._change(db, "workspace", workspace_id, "pipeline", "imported", 1)
    return {"imported": True, "workspace_id": workspace_id, "items": len(seed["items"]), "by_section": counts,
            "ask_again": [item["number"] for item in seed["items"] if item.get("ask_on_page")],
            "unsourced": seed.get("unsourced", [])}

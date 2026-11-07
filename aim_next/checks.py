from __future__ import annotations

"""An outcome's target, its checks, their readings by release, and the improvement loop
(items 14, 12 and 104; docs/targets.md).

A target is a few sentences saying what done looks like; its checks prove it.
Every check is a list of revisions (the newest is current), every run of the
checks keeps what it measured, and nothing stores what another record already
says: a reading's release is the release whose record names its commit, and a
run is a candidate's while no record names it. The target's word is worked out
from the readings and the outcome's kind (outcome_kind.py); nobody sets it.

Seams until the rest of release 21 lands, each in one place:
- 92's whisper rule is absent: the topic access check alone decides who sees a
  message these views show;
- skills (17) is absent: readings carry no skill versions, so tools_words is
  empty, and no tool rows are drawn under the measures.
"""

import hashlib
import json
import uuid

from .contract import Refusal, _identifier, _json, _prefix
from .delivery import _now_ms
from . import check_reading, outcome_rules
from .outcome_asks import release_held
from .work import work_by_topic


CHECKS_SCHEMA = [
    "CREATE TABLE outcome_targets (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), version INTEGER NOT NULL)",
    "CREATE TABLE outcome_target_revisions (workspace_id TEXT NOT NULL REFERENCES outcome_targets(workspace_id), revision INTEGER NOT NULL, "
    "text TEXT NOT NULL, origin_note TEXT NOT NULL DEFAULT '', proposed_by TEXT NOT NULL REFERENCES actors(id), proposed_ms INTEGER NOT NULL, "
    "ask_message_id TEXT REFERENCES messages(id), outcome TEXT CHECK(outcome IN ('accepted','declined')), "
    "settled_by TEXT REFERENCES actors(id), settled_ms INTEGER, PRIMARY KEY(workspace_id, revision))",
    "CREATE INDEX held_target_asks ON outcome_target_revisions(ask_message_id) WHERE outcome IS NULL",
    "CREATE TRIGGER target_words_stay BEFORE UPDATE ON outcome_target_revisions "
    "WHEN OLD.outcome IS NOT NULL OR NEW.text IS NOT OLD.text OR NEW.proposed_by IS NOT OLD.proposed_by "
    "OR NEW.proposed_ms IS NOT OLD.proposed_ms OR NEW.ask_message_id IS NOT OLD.ask_message_id "
    "BEGIN SELECT RAISE(ABORT, 'a target keeps its words'); END",
    "CREATE TRIGGER target_revisions_stay BEFORE DELETE ON outcome_target_revisions BEGIN SELECT RAISE(ABORT, 'a target keeps its words'); END",
    "CREATE TABLE outcome_checks (workspace_id TEXT NOT NULL REFERENCES outcome_targets(workspace_id), check_id TEXT NOT NULL, "
    "revision INTEGER NOT NULL, group_name TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('pass','measure')), source TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', "
    "better TEXT CHECK(better IN ('lower','higher')), target_value REAL, target_words TEXT NOT NULL DEFAULT '', tolerance REAL, "
    "repeats INTEGER NOT NULL DEFAULT 1 CHECK(repeats BETWEEN 1 AND 4), counted_since_ms INTEGER, explain TEXT NOT NULL DEFAULT '', "
    "pending_words TEXT NOT NULL DEFAULT '', record_memory_item_id TEXT REFERENCES memory_items(id), "
    "left_by_topic_id TEXT REFERENCES topics(id), retired_why TEXT, defined_by TEXT NOT NULL REFERENCES actors(id), "
    "defined_ms INTEGER NOT NULL, PRIMARY KEY(workspace_id, check_id, revision))",
    "CREATE TRIGGER definitions_stay_u BEFORE UPDATE ON outcome_checks BEGIN SELECT RAISE(ABORT, 'a definition keeps its words'); END",
    "CREATE TRIGGER definitions_stay_d BEFORE DELETE ON outcome_checks BEGIN SELECT RAISE(ABORT, 'a definition keeps its words'); END",
    "CREATE TABLE check_runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES outcome_targets(workspace_id), commit_sha TEXT, "
    "source TEXT NOT NULL CHECK(source IN ('release-check','skill-check','reported')), started_ms INTEGER NOT NULL, "
    "finished_ms INTEGER NOT NULL, tools TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', "
    "base_for_commit TEXT, trial_of TEXT, without TEXT, recorded_by TEXT NOT NULL REFERENCES actors(id), "
    "CHECK((trial_of IS NULL) = (without IS NULL)), CHECK(base_for_commit IS NULL OR trial_of IS NULL))",
    "CREATE INDEX runs_by_commit ON check_runs(workspace_id, commit_sha, started_ms DESC)",
    "CREATE INDEX runs_by_time ON check_runs(workspace_id, started_ms DESC)",
    "CREATE INDEX runs_base ON check_runs(workspace_id, base_for_commit) WHERE base_for_commit IS NOT NULL",
    "CREATE INDEX runs_trials ON check_runs(workspace_id, trial_of) WHERE trial_of IS NOT NULL",
    "CREATE TABLE check_readings (run_id TEXT NOT NULL REFERENCES check_runs(id), workspace_id TEXT NOT NULL, check_id TEXT NOT NULL, "
    "result TEXT NOT NULL CHECK(result IN ('passed','failed','measured')), value REAL, words TEXT NOT NULL, "
    "detail TEXT NOT NULL DEFAULT '{}', piece_id TEXT REFERENCES pipeline_pieces(id), fix_topic_id TEXT REFERENCES topics(id), "
    "PRIMARY KEY(run_id, check_id))",
    "CREATE INDEX readings_by_check ON check_readings(workspace_id, check_id, run_id)",
    "CREATE INDEX readings_by_piece ON check_readings(piece_id, check_id, run_id) WHERE piece_id IS NOT NULL",
    "CREATE TRIGGER runs_stay_u BEFORE UPDATE ON check_runs BEGIN SELECT RAISE(ABORT, 'a run keeps what it measured'); END",
    "CREATE TRIGGER runs_stay_d BEFORE DELETE ON check_runs BEGIN SELECT RAISE(ABORT, 'a run keeps what it measured'); END",
    "CREATE TRIGGER readings_stay_u BEFORE UPDATE ON check_readings BEGIN SELECT RAISE(ABORT, 'a reading keeps what it measured'); END",
    "CREATE TRIGGER readings_stay_d BEFORE DELETE ON check_readings BEGIN SELECT RAISE(ABORT, 'a reading keeps what it measured'); END",
    "CREATE TABLE check_allowances (workspace_id TEXT NOT NULL REFERENCES workspaces(id), check_id TEXT NOT NULL, commit_sha TEXT NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('fewer','worse')), allowed_count REAL, run_id TEXT REFERENCES check_runs(id), why TEXT NOT NULL, "
    "change_id TEXT, allowed_by TEXT NOT NULL REFERENCES actors(id), allowed_ms INTEGER NOT NULL, "
    "CHECK((kind='fewer') = (allowed_count IS NOT NULL)), CHECK((kind='worse') = (run_id IS NOT NULL)), "
    "PRIMARY KEY(workspace_id, check_id, commit_sha, kind))",
    "CREATE TRIGGER kept_allowance_u BEFORE UPDATE ON check_allowances BEGIN SELECT RAISE(ABORT, 'an allowance stays'); END",
    "CREATE TRIGGER kept_allowance_d BEFORE DELETE ON check_allowances BEGIN SELECT RAISE(ABORT, 'an allowance stays'); END",
]
PROBLEMS_SCHEMA = [
    "CREATE TABLE found_problems (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), "
    "what TEXT NOT NULL CHECK(length(what) BETWEEN 1 AND 500), kind TEXT NOT NULL CHECK(kind IN ('defect','design_miss')), "
    "found_by TEXT NOT NULL REFERENCES actors(id), message_id TEXT REFERENCES messages(id), note TEXT, found_ms INTEGER NOT NULL, "
    "cover_item INTEGER, cover_words TEXT NOT NULL DEFAULT '', cover_test TEXT, closed_ms INTEGER, closed_commit TEXT, closed_proof TEXT, "
    "version INTEGER NOT NULL, CHECK((message_id IS NOT NULL) + (note IS NOT NULL) = 1))",
    "CREATE INDEX problems_by_time ON found_problems(workspace_id, found_ms DESC)",
    "CREATE TRIGGER problem_keeps_what_was_found BEFORE UPDATE ON found_problems "
    "WHEN NEW.what IS NOT OLD.what OR NEW.kind IS NOT OLD.kind OR NEW.found_by IS NOT OLD.found_by "
    "OR NEW.message_id IS NOT OLD.message_id OR NEW.note IS NOT OLD.note OR NEW.found_ms IS NOT OLD.found_ms OR OLD.closed_ms IS NOT NULL "
    "BEGIN SELECT RAISE(ABORT, 'a found problem keeps what was found'); END",
    "CREATE TRIGGER problems_stay BEFORE DELETE ON found_problems BEGIN SELECT RAISE(ABORT, 'a found problem keeps what was found'); END",
]
CHECKS_DOWN = ("DROP TABLE found_problems", "DROP TABLE check_allowances", "DROP TABLE check_readings", "DROP TABLE check_runs",
               "DROP TABLE outcome_checks", "DROP TABLE outcome_target_revisions", "DROP TABLE outcome_targets")
CHECKS_OCCUPIED = ("SELECT EXISTS (SELECT 1 FROM outcome_targets) OR EXISTS (SELECT 1 FROM found_problems) "
                   "OR EXISTS (SELECT 1 FROM check_allowances) OR EXISTS (SELECT 1 FROM outcome_kinds) OR EXISTS (SELECT 1 FROM outcome_reached)")

SOURCES = ("release-check:units", "release-check:native", "release-check:deploy-refusals", "release-check:duration",
           "release-check:wake-replay", "found-problems", "reported")
CHECK_FIELDS = ("check_id", "group_name", "position", "name", "kind", "source", "unit", "better", "target_value", "target_words",
                "tolerance", "repeats", "counted_since_ms", "explain", "pending_words", "record_memory_item_id", "left_by_topic_id",
                "retired_why")
RULE_FIELDS = ("tolerance", "repeats", "better", "target_value", "source")
STEP_GROUPS = (("units", "Unit checks"), ("measures", "Measures"), ("browser", "Browser checks, one at a time"))


def _loads(text, default):
    return json.loads(text) if text else default


def _text(value, name, required=True, limit=16384):
    if not isinstance(value, str) or (required and not value.strip()) or len(value.encode("utf-8")) > limit:
        raise Refusal("INVALID_ARGUMENT", "%s is %stext of at most %d bytes" % (name, "non-empty " if required else "", limit))
    return value


def _ms(value, name):
    """An ISO time from a tool, or epoch milliseconds, as epoch milliseconds."""
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    if isinstance(value, str):
        import datetime
        try:
            moment = datetime.datetime.fromisoformat(value)
        except ValueError:
            moment = None
        if moment is not None and moment.tzinfo is not None:
            return int(moment.timestamp() * 1000)
    raise Refusal("INVALID_ARGUMENT", "%s is a time with its offset, or epoch milliseconds" % name)


def run_id(workspace_id, commit, started_ms, source, base_for=None, trial_of=None, without=None):
    """A run's id from its identity (3.5): the same run written again is the same row."""
    key = _json([workspace_id, commit, started_ms, source, base_for, trial_of, without])
    return "r-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def step_group(name):
    if name in ("python-units", "node-units", "deploy-refusals"):
        return "units"
    if name.startswith("native-"):
        return "browser"
    return "measures"


class Checks:
    """Store mixin: target and check commands (4.2), problems (4.4), and the `outcome_checks` and `check_readings` views (5.2, 5.4)."""

    # ---- reading the records ---------------------------------------------------

    def _targets_row(self, db, workspace_id):
        return db.execute("SELECT * FROM outcome_targets WHERE workspace_id=?", (workspace_id,)).fetchone()

    def _ensure_targets(self, db, workspace_id):
        db.execute("INSERT OR IGNORE INTO outcome_targets VALUES (?,0)", (workspace_id,))

    def _bump_checks(self, db, workspace_id, record):
        self._ensure_targets(db, workspace_id)
        db.execute("UPDATE outcome_targets SET version=version+1 WHERE workspace_id=?", (workspace_id,))
        version = db.execute("SELECT version FROM outcome_targets WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        self._change(db, "workspace", workspace_id, "checks", str(record), version)
        return version

    def _current_checks(self, db, workspace_id, retired=False):
        rows = db.execute("SELECT c.* FROM outcome_checks c WHERE c.workspace_id=? AND c.revision=(SELECT max(revision) FROM outcome_checks "
                          "WHERE workspace_id=c.workspace_id AND check_id=c.check_id) ORDER BY c.position, c.check_id", (workspace_id,)).fetchall()
        return [dict(row) for row in rows if retired or not row["retired_why"]]

    def _checks_at(self, db, workspace_id, ms):
        """Each check's definition current at a moment (D31: the trade he accepted is worked out under them)."""
        rows = db.execute("SELECT c.* FROM outcome_checks c WHERE c.workspace_id=? AND c.revision=(SELECT max(revision) FROM outcome_checks "
                          "WHERE workspace_id=c.workspace_id AND check_id=c.check_id AND defined_ms<=?) ORDER BY c.position", (workspace_id, ms)).fetchall()
        return [dict(row) for row in rows if not row["retired_why"]]

    def _current_target(self, db, workspace_id):
        return db.execute("SELECT * FROM outcome_target_revisions WHERE workspace_id=? AND outcome='accepted' "
                          "ORDER BY settled_ms DESC, revision DESC LIMIT 1", (workspace_id,)).fetchone()

    def _releases(self, db):
        return [dict(row) for row in db.execute("SELECT number,commit_sha,deployed_ms,items FROM releases ORDER BY number")]

    def _ships_in_releases(self, db, workspace_id):
        row = db.execute("SELECT ships_in_releases,enabled FROM pipelines WHERE workspace_id=?", (workspace_id,)).fetchone()
        return bool(row and row["ships_in_releases"])

    def _release_piece_number(self, db, workspace_id, commit):
        row = db.execute("SELECT release_number FROM pipeline_pieces WHERE workspace_id=? AND kind='release' AND commit_sha=? "
                         "ORDER BY rowid DESC LIMIT 1", (workspace_id, commit)).fetchone()
        return row[0] if row else None

    def _place_run(self, db, workspace_id, run, releases):
        """(release, candidate, label) for a run: its commit's release, a candidate's planned number, or the release live then."""
        by_commit = {release["commit_sha"]: release["number"] for release in releases}
        live = releases[-1]["number"] if releases else None
        if run["commit_sha"] is not None:
            if run["commit_sha"] in by_commit:
                number = by_commit[run["commit_sha"]]
                return number, False, "Release %d" % number
            number = self._release_piece_number(db, workspace_id, run["commit_sha"]) or ((live or 0) + 1)
            return number, True, "Release %d candidate" % number
        then = [release["number"] for release in releases if release["deployed_ms"] <= run["started_ms"]]
        number = then[-1] if then else None
        note = run["note"] or "live code"
        return number, False, note[:1].upper() + note[1:]

    def _runs(self, db, workspace_id, limit=400):
        return [dict(row, tools=_loads(row["tools"], {}), steps=_loads(row["steps"], []), without=_loads(row["without"], None))
                for row in db.execute("SELECT * FROM check_runs INDEXED BY runs_by_time WHERE workspace_id=? AND source<>'skill-check' "
                                      "ORDER BY started_ms DESC LIMIT ?", (workspace_id, limit))]

    def _readings_of(self, db, run_ids):
        readings = {}
        if not run_ids:
            return readings
        for row in db.execute("SELECT * FROM check_readings WHERE run_id IN (SELECT value FROM json_each(?))", (_json(list(run_ids)),)):
            readings.setdefault(row["run_id"], {})[row["check_id"]] = dict(row, detail=_loads(row["detail"], {}))
        return readings

    def _reading(self, run, row, place):
        release, candidate, label = place
        return {"run_id": run["id"], "release": release, "candidate": candidate, "commit": run["commit_sha"], "label": label,
                "at_ms": run["finished_ms"], "result": row["result"], "value": row["value"], "words": row["words"], "detail": row["detail"],
                "tools": run["tools"], "tools_changed": [], "steps": run["steps"], "tools_words": [], "note": run["note"],
                "fix_topic_id": row["fix_topic_id"], "source": run["source"], "base": None, "compared": None, "accepted": None,
                "since_before": None}

    def _checks_context(self, db, actor, workspace):
        """Everything the outcome's checks say, read once: definitions, readings by check, statuses and the word."""
        workspace_id = workspace["id"]
        checks = self._current_checks(db, workspace_id)
        releases = self._releases(db)
        runs = self._runs(db, workspace_id)
        readings = self._readings_of(db, [run["id"] for run in runs])
        places = {run["id"]: self._place_run(db, workspace_id, run, releases) for run in runs}
        main_runs = [run for run in runs if run["base_for_commit"] is None and run["trial_of"] is None]
        by_check = {check["check_id"]: [] for check in checks}
        for run in main_runs:
            for check_id, row in readings.get(run["id"], {}).items():
                if check_id in by_check:
                    by_check[check_id].append(self._reading(run, row, places[run["id"]]))
        bases = {run["base_for_commit"]: run for run in runs if run["base_for_commit"] is not None}
        for check_id, items in by_check.items():
            for older, newer in zip(items[1:], items[:-1]):
                newer["tools_changed"] = outcome_rules.tools_changed(older["tools"], newer["tools"])
            for item in items:
                base_run = bases.get(item["commit"]) if item["candidate"] else None
                if base_run is not None and check_id in readings.get(base_run["id"], {}):
                    base = self._reading(base_run, readings[base_run["id"]][check_id], places[base_run["id"]])
                    base["label"] = "Release %s, rerun" % (releases[-1]["number"] if releases else "live")
                    item["base"] = base
                    item["compared"] = outcome_rules.comparable(base, item)
        problems = self._problems_facts(db, actor, workspace_id, checks, releases)
        for check in checks:
            if check["source"] == "found-problems" and problems:
                by_check[check["check_id"]] = problems["readings"]
        ships = self._ships_in_releases(db, workspace_id)
        asks = self._check_asks(db, workspace)
        statuses, rounds = [], {}
        for check in checks:
            items = by_check[check["check_id"]]
            settled = [item for item in items if not item["candidate"]]
            if ships:
                seen, per_release = set(), []
                for item in settled:
                    if item["release"] is not None and item["release"] not in seen:
                        seen.add(item["release"])
                        per_release.append(item)
                rounds[check["check_id"]] = per_release
            else:
                rounds[check["check_id"]] = settled
            statuses.append(outcome_rules.check_status(check, rounds[check["check_id"]], items[0] if items else None,
                                                       check["check_id"] in asks))
        # The word at the previous round: the same checks, without the candidates' readings (D17).
        previous = []
        for check in checks:
            settled = rounds[check["check_id"]]
            previous.append(outcome_rules.check_status(check, settled, settled[0] if settled else None, check["check_id"] in asks))
        return {"checks": checks, "statuses": statuses, "previous": previous, "readings": by_check, "rounds": rounds, "runs": runs,
                "readings_by_run": readings, "places": places, "releases": releases, "asks": asks, "ships": ships, "problems": problems}

    def _check_asks(self, db, workspace):
        """{check_id: ask} open asks to the owner whose subject is one of this outcome's checks."""
        rows = db.execute("SELECT s.ref,q.topic_id,q.ask_message_id,m.author_id,m.sent_ms,m.seq,substr(m.body,1,280) AS excerpt,"
                          "substr(CAST(t.title AS BLOB),1,257) AS title_prefix FROM topic_waiting q "
                          "JOIN message_subjects s ON s.message_id=q.ask_message_id AND s.kind='check' "
                          "JOIN messages m ON m.id=q.ask_message_id JOIN topics t ON t.id=q.topic_id "
                          "WHERE q.actor_id=? AND s.workspace_id=? ORDER BY m.sent_ms", (workspace["owner_id"], workspace["id"])).fetchall()
        asks = {}
        for row in rows:
            title, _ = _prefix(row["title_prefix"], 256)
            asks.setdefault(row["ref"], {"message_id": row["ask_message_id"], "seq": row["seq"], "topic_id": row["topic_id"],
                                         "topic_title": title, "by": row["author_id"], "since_ms": row["sent_ms"], "excerpt": row["excerpt"]})
        return asks

    def _check_statuses(self, db, actor, workspace):
        context = self._checks_context(db, actor, workspace)
        return context["checks"], context["statuses"]

    def _target_word(self, db, actor, workspace, context=None, kind_facts=None):
        context = context or self._checks_context(db, actor, workspace)
        facts = kind_facts or self._kind_facts(db, workspace)
        target = self._current_target(db, workspace["id"])
        has_target = target is not None or bool(context["checks"])
        word = outcome_rules.target_word(facts["kind"], facts["reached"], has_target, context["statuses"])
        previous = outcome_rules.target_word(facts["kind"], facts["reached"], has_target, context["previous"])
        return word, previous

    # ---- the outcome light's facts (86) ----------------------------------------

    def _done_facts(self, db, workspace_id):
        """D5, D43: the kind, Reached, the target word and how many checks there are, for the light."""
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        facts = self._kind_facts(db, workspace)
        if facts["reached"]:
            return {"reached": facts["reached"], "kind": facts["kind"], "target_word": "reached", "checks": None}
        context = self._checks_context(db, workspace["owner_id"], workspace)
        word, _ = self._target_word(db, workspace["owner_id"], workspace, context, facts)
        runs = [run for run in context["runs"] if run["base_for_commit"] is None and run["trial_of"] is None]
        checks = {"count": len(context["checks"]), "last_run_ms": runs[0]["finished_ms"] if runs else None} if context["checks"] else None
        return {"reached": None, "kind": facts["kind"], "target_word": word, "checks": checks}

    def _created(self, db, workspace):
        """D22: who started the outcome and when, from its start record; before release 21, the owner with no time."""
        start = self._kind_facts(db, workspace)["start"]
        return start if start else {"by": workspace["owner_id"], "ms": None}

    # ---- a gate that names checks (D18) ------------------------------------------

    def _gate_open(self, db, piece, stage):
        """Leaving a stage whose gate names checks needs each one's latest reading for the piece (or at its commit) to pass."""
        checks = stage["gate"].get("checks") or []
        for check_id in checks:
            if piece["kind"] == "release":
                if not piece["commit_sha"]:
                    return False
                row = db.execute("SELECT r.result FROM check_readings r JOIN check_runs u ON u.id=r.run_id WHERE u.workspace_id=? "
                                 "AND u.commit_sha=? AND u.base_for_commit IS NULL AND u.trial_of IS NULL AND r.check_id=? "
                                 "ORDER BY u.started_ms DESC LIMIT 1", (piece["workspace_id"], piece["commit_sha"], check_id)).fetchone()
            else:
                row = db.execute("SELECT r.result FROM check_readings r INDEXED BY readings_by_piece JOIN check_runs u ON u.id=r.run_id "
                                 "WHERE r.piece_id=? AND r.check_id=? ORDER BY u.started_ms DESC LIMIT 1", (piece["id"], check_id)).fetchone()
            if row is None or row[0] != "passed":
                return False
        return True

    def _release_held(self, db, workspace_id, piece):
        """D35: a release piece is held when its newest candidate run has a worse reading."""
        if not piece["commit_sha"]:
            return False
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        loop = self._loop(db, workspace["owner_id"], workspace, self._checks_context(db, workspace["owner_id"], workspace))
        return bool(loop and loop["candidate"] and loop["candidate"]["state"] == "stopped")

    # ---- commands (4.2) -----------------------------------------------------------

    def _steering(self, db, actor, workspace_id):
        workspace = self._workspace(db, actor, workspace_id)
        if actor not in (workspace["owner_id"], workspace["coordinator_id"]):
            raise Refusal("FORBIDDEN", "Only this outcome's owner or coordinator may do this")
        return workspace

    def _owner_ask_in_outcome(self, db, actor, workspace, message_id):
        if message_id is None:
            raise Refusal("ASK_REQUIRED", "A change to the target's words is an ask to %s: ask in this outcome first" % workspace["owner_id"])
        row = db.execute("SELECT m.author_id,m.intent,m.addressees,t.workspace_id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?",
                         (_identifier(message_id, "ask_message_id"),)).fetchone()
        if (row is None or row["author_id"] != actor or row["intent"] != "ask" or row["workspace_id"] != workspace["id"]
                or workspace["owner_id"] not in json.loads(row["addressees"])):
            raise Refusal("ASK_REQUIRED", "The ask must be yours, to %s, in this outcome" % workspace["owner_id"])

    def _target_revision(self, db, workspace_id):
        row = self._targets_row(db, workspace_id)
        return row["version"] if row else 0

    def _command_target_propose(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or "text" not in args or set(args) - {"text", "origin_note", "ask_message_id"}:
            raise Refusal("INVALID_ARGUMENT", "A target is its words, where they came from, and the ask to the owner")
        workspace = self._steering(db, actor, target["workspace_id"])
        self._check_revision(envelope, "target_revision", self._target_revision(db, workspace["id"]))
        text = _text(args["text"], "The target's words", limit=4096)
        current = self._current_target(db, workspace["id"])
        self._ensure_targets(db, workspace["id"])
        revision = db.execute("SELECT coalesce(max(revision),0)+1 FROM outcome_target_revisions WHERE workspace_id=?", (workspace["id"],)).fetchone()[0]
        ms = _now_ms()
        # D8: the first wording, and the owner's own, are current at once; anyone else's later wording asks the owner.
        at_once = current is None or actor == workspace["owner_id"]
        ask = None
        if not at_once:
            ask = args.get("ask_message_id")
            self._owner_ask_in_outcome(db, actor, workspace, ask)
        for (older, older_ask) in db.execute("SELECT revision,ask_message_id FROM outcome_target_revisions WHERE workspace_id=? AND "
                                             "proposed_by=? AND outcome IS NULL", (workspace["id"], actor)).fetchall():
            db.execute("UPDATE outcome_target_revisions SET outcome='declined',settled_by=?,settled_ms=? WHERE workspace_id=? AND revision=?",
                       (actor, ms, workspace["id"], older))
            if older_ask and older_ask != ask:
                release_held(self, db, older_ask)
        db.execute("INSERT INTO outcome_target_revisions VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (workspace["id"], revision, text, _text(args.get("origin_note", ""), "origin_note", required=False, limit=500), actor, ms,
                    ask, "accepted" if at_once else None, actor if at_once else None, ms if at_once else None))
        version = self._bump_checks(db, workspace["id"], "target")
        return {"workspace_id": workspace["id"], "revision": revision, "current": at_once, "target_revision": version}, []

    def _command_target_settle(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"revision", "outcome"} or args["outcome"] not in ("accepted", "declined"):
            raise Refusal("INVALID_ARGUMENT", "Settle one proposed revision: accepted or declined")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if actor != workspace["owner_id"]:
            raise Refusal("FORBIDDEN", "Only %s, this outcome's owner, settles its target's words" % workspace["owner_id"])
        self._check_revision(envelope, "target_revision", self._target_revision(db, workspace["id"]))
        row = db.execute("SELECT * FROM outcome_target_revisions WHERE workspace_id=? AND revision=?", (workspace["id"], args["revision"])).fetchone()
        if row is None or row["outcome"] is not None:
            raise Refusal("NOT_PROPOSED", "That wording is not waiting on you")
        db.execute("UPDATE outcome_target_revisions SET outcome=?,settled_by=?,settled_ms=? WHERE workspace_id=? AND revision=?",
                   (args["outcome"], actor, _now_ms(), workspace["id"], row["revision"]))
        if row["ask_message_id"]:
            release_held(self, db, row["ask_message_id"])
        version = self._bump_checks(db, workspace["id"], "target")
        return {"workspace_id": workspace["id"], "revision": row["revision"], "outcome": args["outcome"], "target_revision": version}, []

    def _definition(self, db, workspace_id, check, current):
        """A check definition from args, filled from the current one; refuses what no check may be."""
        if not isinstance(check, dict) or set(check) - set(CHECK_FIELDS):
            raise Refusal("INVALID_ARGUMENT", "A check is %s" % ", ".join(CHECK_FIELDS))
        base = dict(current) if current else {"group_name": "", "position": 1, "unit": "", "better": None, "target_value": None,
                                               "target_words": "", "tolerance": None, "repeats": 1, "counted_since_ms": None, "explain": "",
                                               "pending_words": "", "record_memory_item_id": None, "left_by_topic_id": None}
        base["retired_why"] = None
        base.update(check)
        if not isinstance(base.get("check_id"), str) or not base["check_id"] or len(base["check_id"]) > 64 or not all(
                c.isalnum() or c in "-_" for c in base["check_id"]):
            raise Refusal("INVALID_ARGUMENT", "check_id is a short slug")
        if base.get("kind") not in ("pass", "measure"):
            raise Refusal("INVALID_ARGUMENT", "A check is a pass check or a measure")
        if base.get("source") not in SOURCES:
            raise Refusal("INVALID_ARGUMENT", "A check's source is one of %s" % ", ".join(SOURCES))
        if base.get("better") not in (None, "lower", "higher"):
            raise Refusal("INVALID_ARGUMENT", "better is lower or higher")
        for name in ("target_value", "tolerance"):
            if base.get(name) is not None and (isinstance(base[name], bool) or not isinstance(base[name], (int, float)) or base[name] < 0):
                raise Refusal("INVALID_ARGUMENT", "%s is a number" % name)
        if isinstance(base.get("repeats"), bool) or not isinstance(base.get("repeats"), int) or not 1 <= base["repeats"] <= 4:
            raise Refusal("INVALID_ARGUMENT", "repeats is 1 to 4")
        if isinstance(base.get("position"), bool) or not isinstance(base.get("position"), int):
            raise Refusal("INVALID_ARGUMENT", "position is a whole number")
        for name in ("group_name", "name"):
            _text(base.get(name), name, limit=500)
        for name in ("unit", "target_words", "explain", "pending_words"):
            _text(base.get(name) or "", name, required=False, limit=4096)
        if base["kind"] == "measure" and base["source"].startswith("release-check:") and base.get("tolerance") is None:
            raise Refusal("TOLERANCE_REQUIRED", "A machine-read measure needs its tolerance: how far it may move before it counts as worse")
        if "retired_why" in check and check["retired_why"] is not None:
            if not isinstance(check["retired_why"], str) or not check["retired_why"].strip():
                raise Refusal("WHY_REQUIRED", "Say why the check is retired")
            if current is None:
                raise Refusal("CHECK_UNKNOWN", "No check %s to retire" % base["check_id"])
        return base

    def _command_check_define(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"check"}:
            raise Refusal("INVALID_ARGUMENT", "Define one check")
        workspace = self._steering(db, actor, target["workspace_id"])
        self._check_revision(envelope, "checks_revision", self._target_revision(db, workspace["id"]))
        check_id = args["check"].get("check_id") if isinstance(args["check"], dict) else None
        current = db.execute("SELECT * FROM outcome_checks WHERE workspace_id=? AND check_id=? ORDER BY revision DESC LIMIT 1",
                             (workspace["id"], check_id)).fetchone() if isinstance(check_id, str) else None
        current = dict(current) if current else None
        definition = self._definition(db, workspace["id"], args["check"], current)
        loosened = outcome_rules.loosens(current, definition)
        # D30: only the owner loosens a check, retiring included.
        if loosened and actor != workspace["owner_id"]:
            raise Refusal("OWNER_LOOSENS", "Only %s loosens a check (%s), sending it himself" % (workspace["owner_id"], ", ".join(loosened)))
        self._ensure_targets(db, workspace["id"])
        revision = (current["revision"] + 1) if current else 1
        db.execute("INSERT INTO outcome_checks VALUES (%s)" % ",".join("?" * 22),
                   (workspace["id"], definition["check_id"], revision, definition["group_name"], definition["position"], definition["name"],
                    definition["kind"], definition["source"], definition["unit"] or "", definition["better"], definition["target_value"],
                    definition["target_words"] or "", definition["tolerance"], definition["repeats"], definition["counted_since_ms"],
                    definition["explain"] or "", definition["pending_words"] or "", definition["record_memory_item_id"],
                    definition["left_by_topic_id"], definition.get("retired_why"), actor, _now_ms()))
        version = self._bump_checks(db, workspace["id"], definition["check_id"])
        return {"workspace_id": workspace["id"], "check_id": definition["check_id"], "revision": revision, "checks_revision": version}, []

    def _write_run(self, db, actor, workspace_id, run, readings, source, base_for=None):
        """One run and its readings, immutable: the same run again is the stored one; a different one with its identity is refused."""
        commit = run.get("commit_sha", run.get("commit"))
        if commit is not None and (not isinstance(commit, str) or len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit)):
            raise Refusal("INVALID_ARGUMENT", "A run's commit is a full 40-character commit")
        started = _ms(run.get("started_at", run.get("started_ms")), "started_at")
        finished = _ms(run.get("finished_at", run.get("finished_ms")), "finished_at")
        tools, steps = run.get("tools", {}), run.get("steps", [])
        if not isinstance(tools, dict) or not isinstance(steps, list) or len(steps) > 64:
            raise Refusal("INVALID_ARGUMENT", "A run's tools is an object and its steps a list")
        trial_of, without = run.get("trial_of"), run.get("without")
        identity = run_id(workspace_id, commit, started, source, base_for, trial_of, _json(without) if without is not None else None)
        current = {row["id"]: row for row in db.execute("SELECT id FROM check_runs WHERE id=?", (identity,))}
        definitions = {check["check_id"]: check for check in self._current_checks(db, workspace_id)}
        values = []
        for reading in readings:
            if not isinstance(reading, dict) or set(reading) - {"check_id", "result", "value", "words", "detail", "piece_id", "fix_topic_id"}:
                raise Refusal("INVALID_ARGUMENT", "A reading is {check_id, result, value, words, detail, piece_id, fix_topic_id}")
            check = definitions.get(reading.get("check_id"))
            if check is None:
                raise Refusal("CHECK_UNKNOWN", "No check %s in this outcome" % reading.get("check_id"))
            if source == "reported" and check["source"] != "reported":
                raise Refusal("SOURCE_NOT_REPORTED", "%s is read by the release check, not reported" % check["check_id"])
            if reading.get("result") not in ("passed", "failed", "measured"):
                raise Refusal("INVALID_ARGUMENT", "A reading passed, failed or measured")
            value = reading.get("value")
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
                raise Refusal("INVALID_ARGUMENT", "A reading's value is a number")
            piece = reading.get("piece_id")
            if piece is not None and not db.execute("SELECT 1 FROM pipeline_pieces WHERE id=? AND workspace_id=?", (piece, workspace_id)).fetchone():
                raise Refusal("INVALID_ARGUMENT", "piece_id is a piece of this outcome")
            values.append((identity, workspace_id, check["check_id"], reading["result"], value, _text(reading.get("words"), "words", limit=2048),
                           _json(reading.get("detail", {})), piece, reading.get("fix_topic_id")))
        row = (identity, workspace_id, commit, source, started, finished, _json(tools), _json(steps), run.get("note", "") or "", base_for,
               trial_of, _json(without) if without is not None else None, actor)
        if current:
            stored = db.execute("SELECT * FROM check_runs WHERE id=?", (identity,)).fetchone()
            same = (stored["tools"], stored["steps"], stored["note"], stored["finished_ms"]) == (row[6], row[7], row[8], row[5])
            kept = {r["check_id"]: (r["result"], r["value"], r["words"]) for r in db.execute("SELECT * FROM check_readings WHERE run_id=?", (identity,))}
            same = same and kept == {v[2]: (v[3], v[4], v[5]) for v in values}
            if not same:
                raise Refusal("RUN_EXISTS", "A different run with this identity is already recorded")
            return identity, False
        db.execute("INSERT INTO check_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
        db.executemany("INSERT INTO check_readings VALUES (?,?,?,?,?,?,?,?,?)", values)
        return identity, True

    def _command_check_report(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) != {"run", "readings"} or not isinstance(args["run"], dict) or not isinstance(args["readings"], list):
            raise Refusal("INVALID_ARGUMENT", "A report is one run and its readings")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if not self._targets_row(db, workspace["id"]):
            raise Refusal("NO_CHECKS", "This outcome has no checks")
        run = dict(args["run"])
        if set(run) - {"commit_sha", "started_at", "finished_at", "tools", "steps", "note", "trial_of", "without", "base"}:
            raise Refusal("INVALID_ARGUMENT", "A run is its commit, times, tools, steps, note, and for a trial what it left out and its base")
        trial = run.get("trial_of")
        if (trial is None) != (run.get("without") is None):
            raise Refusal("INVALID_ARGUMENT", "A trial names the candidate it was run from and what it left out")
        source = "release-check" if trial else "reported"
        base = run.pop("base", None)
        identity, written = self._write_run(db, actor, workspace["id"], run, args["readings"], source)
        if base is not None and trial:
            self._write_run(db, actor, workspace["id"], {key: value for key, value in base.items() if key != "readings"},
                            base.get("readings", []), "release-check", base_for=run.get("commit_sha"))
        version = self._bump_checks(db, workspace["id"], identity) if written else self._target_revision(db, workspace["id"])
        return {"workspace_id": workspace["id"], "run_id": identity, "recorded": written, "checks_revision": version}, []

    def _command_check_accept_worse(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id", "check_id"} or set(args) != {"run_id", "why"}:
            raise Refusal("INVALID_ARGUMENT", "Accept one check's worse result at one run, in your own words")
        workspace = self._workspace(db, actor, target["workspace_id"])
        if actor != workspace["owner_id"]:
            raise Refusal("FORBIDDEN", "Only %s, this outcome's owner, accepts a worse result, sending it himself" % workspace["owner_id"])
        self._check_revision(envelope, "checks_revision", self._target_revision(db, workspace["id"]))
        if not isinstance(args["why"], str) or not args["why"].strip():
            raise Refusal("WHY_REQUIRED", "Say why, in your own words; they are kept beside the result")
        context = self._checks_context(db, actor, workspace)
        check = next((check for check in context["checks"] if check["check_id"] == target["check_id"]), None)
        run = next((run for run in context["runs"] if run["id"] == args["run_id"]), None)
        if check is None or check["kind"] != "measure" or run is None or run["commit_sha"] is None:
            raise Refusal("NOT_WORSE", "Only a measure's worse result at a candidate can be accepted")
        found = self._run_regressions(db, workspace["id"], context, run)
        if not any(item["check_id"] == check["check_id"] and item["kind"] == "failed" for item in found["all"]):
            raise Refusal("NOT_WORSE", "That run's reading of %s is not worse" % check["name"])
        db.execute("INSERT INTO check_allowances VALUES (?,?,?,'worse',NULL,?,?,NULL,?,?)",
                   (workspace["id"], check["check_id"], run["commit_sha"], run["id"], _text(args["why"].strip(), "why", limit=2000), actor, _now_ms()))
        version = self._bump_checks(db, workspace["id"], check["check_id"])
        return {"workspace_id": workspace["id"], "check_id": check["check_id"], "run_id": run["id"], "checks_revision": version}, []

    # ---- problems found before a check (4.4, D39) -----------------------------------

    def _command_problem_file(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id"} or set(args) - {"what", "kind", "message_id", "note", "found_by"}:
            raise Refusal("INVALID_ARGUMENT", "A problem is what was found, its kind, and where: a message or a note")
        workspace = self._workspace(db, actor, target["workspace_id"])
        what = _text(args.get("what"), "What was found", limit=500)
        kind = args.get("kind")
        if kind not in ("defect", "design_miss"):
            raise Refusal("INVALID_ARGUMENT", "A problem is a defect or a design miss")
        message, note = args.get("message_id"), args.get("note")
        if (message is None) == (note is None):
            raise Refusal("SOURCE_REQUIRED", "Say where it was found: a message, or a note")
        found_by, found_ms = actor, _now_ms()
        if message is not None:
            if isinstance(message, int) and not isinstance(message, bool):
                row = db.execute("SELECT id FROM messages WHERE seq=?", (message,)).fetchone()
                if row is None:
                    raise Refusal("FORBIDDEN", "No readable source")
                message = row[0]
            row = self._message_access(db, actor, message)
            found_by = row["author_id"]
            found_ms = db.execute("SELECT sent_ms FROM messages WHERE id=?", (row["id"],)).fetchone()[0]
            message = row["id"]
        else:
            note = _text(note, "A note", limit=500)
        if args.get("found_by") is not None:
            found_by = self._actor(db, args["found_by"])["id"]
        problem_id = "fp-" + uuid.uuid4().hex[:24]
        db.execute("INSERT INTO found_problems(id,workspace_id,what,kind,found_by,message_id,note,found_ms,version) VALUES (?,?,?,?,?,?,?,?,1)",
                   (problem_id, workspace["id"], what, kind, found_by, message, note, found_ms))
        version = self._bump_checks(db, workspace["id"], problem_id)
        return {"workspace_id": workspace["id"], "problem_id": problem_id, "checks_revision": version}, []

    def _command_problem_cover(self, db, actor, envelope):
        target, args = envelope["target"], envelope["args"]
        if set(target) != {"workspace_id", "problem_id"} or "words" not in args or set(args) - {"words", "item", "test", "commit", "proof"}:
            raise Refusal("INVALID_ARGUMENT", "Say what covers the problem: its words, an item, a test, and with proof, the commit")
        workspace = self._workspace(db, actor, target["workspace_id"])
        row = db.execute("SELECT * FROM found_problems WHERE id=? AND workspace_id=?", (_identifier(target["problem_id"], "problem_id"), workspace["id"])).fetchone()
        if row is None:
            raise Refusal("NOT_FOUND", "No such problem in this outcome")
        self._check_revision(envelope, "problem_revision", row["version"])
        if row["closed_ms"] is not None:
            raise Refusal("PROBLEM_CLOSED", "This problem is closed")
        item = args.get("item", row["cover_item"])
        if item is not None and not db.execute("SELECT 1 FROM pipeline_items WHERE workspace_id=? AND number=?", (workspace["id"], item)).fetchone():
            raise Refusal("INVALID_ARGUMENT", "No item %s in this outcome's pipeline" % item)
        test = args.get("test", row["cover_test"])
        words = _text(args["words"], "words", required=False, limit=500)
        closed = (None, None, None)
        proof = args.get("proof")
        if proof is not None:
            # D39: closed only with a mutant runner report in which the cover test's assertion failed and its control passed.
            if (not isinstance(proof, dict) or not test or proof.get("test") != test or proof.get("killed") is not True
                    or not isinstance(proof.get("failed"), str) or "FAIL" not in proof["failed"].upper() or proof.get("control") != "passed"
                    or not isinstance(args.get("commit"), str)):
                raise Refusal("PROOF_REQUIRED", "Closing needs the mutant runner's report: the covering test failed with the fix removed, and its control passed")
            closed = (_now_ms(), args["commit"], _json(proof))
        db.execute("UPDATE found_problems SET cover_item=?,cover_words=?,cover_test=?,closed_ms=?,closed_commit=?,closed_proof=?,version=version+1 WHERE id=?",
                   (item, words, test) + closed + (row["id"],))
        version = self._bump_checks(db, workspace["id"], row["id"])
        return {"workspace_id": workspace["id"], "problem_id": row["id"], "closed": closed[0] is not None, "checks_revision": version}, []

    def _problems_facts(self, db, actor, workspace_id, checks, releases):
        """5.4: problems by the release live when each was found, for the charted releases and the candidate."""
        check = next((check for check in checks if check["source"] == "found-problems"), None)
        if check is None:
            return None
        since = check["counted_since_ms"] or 0
        rows = db.execute("SELECT p.*,m.seq,m.topic_id,substr(CAST(t.title AS BLOB),1,257) AS title_prefix,i.title AS item_title "
                          "FROM found_problems p INDEXED BY problems_by_time LEFT JOIN messages m ON m.id=p.message_id "
                          "LEFT JOIN topics t ON t.id=m.topic_id LEFT JOIN pipeline_items i ON i.workspace_id=p.workspace_id AND i.number=p.cover_item "
                          "WHERE p.workspace_id=? ORDER BY p.found_ms DESC LIMIT 500", (workspace_id,)).fetchall()
        live = releases[-1] if releases else None
        shown = releases[-outcome_rules.CHART_RELEASES:]
        out, readings = [], []
        candidate = (live["number"] + 1) if live else None
        if candidate is not None:
            out.append({"release": candidate, "state": "candidate"})
        for position, release in reversed(list(enumerate(shown))):
            following = releases[releases.index(release) + 1]["deployed_ms"] if release is not live else None
            if following is not None and following <= since:
                out.append({"release": release["number"], "state": "not_counted"})
                continue
            mine = [row for row in rows if row["found_ms"] >= release["deployed_ms"] and (following is None or row["found_ms"] < following)]
            counts = {"defect": sum(row["kind"] == "defect" for row in mine), "design_miss": sum(row["kind"] == "design_miss" for row in mine)}
            problems = []
            for row in mine:
                readable = False
                if row["message_id"]:
                    try:
                        self._message_access(db, actor, row["message_id"])
                        readable = True
                    except Refusal:
                        readable = False
                title, _ = _prefix(row["title_prefix"] or b"", 256)
                source = ({"kind": "message", "message_id": row["message_id"] if readable else None, "seq": row["seq"] if readable else None,
                           "topic_id": row["topic_id"] if readable else None, "topic_title": title if readable else None, "readable": readable}
                          if row["message_id"] else {"kind": "note", "text": row["note"]})
                cover = None
                if row["cover_item"] is not None or row["cover_words"] or row["cover_test"]:
                    cover = {"item": {"number": row["cover_item"], "title": row["item_title"]} if row["cover_item"] is not None else None,
                             "words": row["cover_words"], "test": row["cover_test"]}
                problems.append({"id": row["id"], "what": row["what"], "kind": row["kind"], "found_by": row["found_by"], "found_ms": row["found_ms"],
                                 "source": source, "cover": cover,
                                 "closed": {"ms": row["closed_ms"], "commit": row["closed_commit"], "test": row["cover_test"]} if row["closed_ms"] else None,
                                 "version": row["version"]})
            entry = {"release": release["number"], "state": "live" if release is live else "shipped", "counts": counts,
                     "closed": sum(1 for row in mine if row["closed_ms"]), "problems": problems}
            out.append(entry)
            total = counts["defect"] + counts["design_miss"]
            readings.append({"run_id": None, "release": release["number"], "candidate": False, "commit": release["commit_sha"],
                             "label": "Release %d" % release["number"] + (", so far" if release is live else ""),
                             "at_ms": release["deployed_ms"], "result": "measured", "value": total,
                             "words": "%d found" % total, "detail": {"parts": counts}, "tools": {}, "tools_changed": [], "steps": [],
                             "tools_words": [], "note": "", "fix_topic_id": None, "source": "found-problems", "base": None,
                             "compared": None, "accepted": None, "since_before": None})
        return {"counting_since_ms": check["counted_since_ms"], "releases": out, "readings": readings}

    # ---- views (5.2) ----------------------------------------------------------------

    def _topic_ref(self, db, actor, topic_id, work=True):
        if not topic_id:
            return None
        row = db.execute("SELECT id,substr(CAST(title AS BLOB),1,257) AS title_prefix,state FROM topics WHERE id=?", (topic_id,)).fetchone()
        if row is None:
            return None
        title, _ = _prefix(row["title_prefix"], 256)
        answer = {"id": row["id"], "title": title, "state": row["state"]}
        if work:
            answer["work"] = work_by_topic(db, self._waits_by_topic(db, [row["id"]]), actor)[row["id"]]
        return answer

    def _since_before(self, db, workspace_id, older, newer, releases):
        if older is None or newer is None or older.get("release") is None or newer.get("release") is None:
            return None
        between = [release for release in releases if older["release"] < release["number"] <= newer["release"]]
        return {"releases": [release["number"] for release in between],
                "items": [number for release in between for number in json.loads(release["items"])]}

    def _check_view(self, db, actor, workspace, check, status, context, shown=outcome_rules.READINGS_SHOWN):
        items = context["readings"][check["check_id"]]
        settled = [item for item in items if not item["candidate"]]
        live = settled[0] if settled else None
        candidate = items[0] if items and items[0]["candidate"] else None
        for older, newer in zip(items[1:], items[:-1]):
            newer["since_before"] = self._since_before(db, workspace["id"], older, newer, context["releases"])
        allowances = {(row["commit_sha"], row["check_id"]): row for row in db.execute(
            "SELECT * FROM check_allowances WHERE workspace_id=? AND check_id=? AND kind='worse'", (workspace["id"], check["check_id"]))}
        for item in items:
            row = allowances.get((item["commit"], check["check_id"]))
            if row is not None:
                item["accepted"] = {"by": row["allowed_by"], "ms": row["allowed_ms"], "why": row["why"],
                                    "trade": self._accepted_trade(db, workspace["id"], context, row)}
        rule = None
        if check["kind"] == "measure":
            setter = db.execute("SELECT defined_by,defined_ms,tolerance,repeats,better,target_value,source FROM outcome_checks "
                                "WHERE workspace_id=? AND check_id=? ORDER BY revision", (workspace["id"], check["check_id"])).fetchall()
            set_by, set_ms, previous = None, None, None
            for row in setter:
                values = tuple(row[name] for name in RULE_FIELDS)
                if values != previous:
                    set_by, set_ms, previous = row["defined_by"], row["defined_ms"], values
            rule = {"repeats": check["repeats"], "tolerance": check["tolerance"], "better": check["better"], "set_by": set_by, "set_ms": set_ms,
                    "target_value": check["target_value"]}
        fix = next((item["fix_topic_id"] for item in items if item["fix_topic_id"]), None)
        ask = context["asks"].get(check["check_id"])
        valued = [item for item in items if item["value"] is not None or item["words"]]
        chart_rows = {item["release"] for item in valued if not item["candidate"] and item["value"] is not None}
        chart = len(chart_rows) >= 2 or (len(chart_rows) >= 1 and candidate is not None and candidate["value"] is not None)
        record_page = None
        if check["record_memory_item_id"]:
            title = db.execute("SELECT r.title FROM memory_items i JOIN memory_revisions r ON r.item_id=i.id AND r.revision=i.current_revision "
                               "WHERE i.id=?", (check["record_memory_item_id"],)).fetchone()
            record_page = {"memory_item_id": check["record_memory_item_id"], "title": title[0] if title else ""}
        return {"check_id": check["check_id"], "name": check["name"], "kind": check["kind"], "source": check["source"], "unit": check["unit"],
                "status": status, "latest": items[0] if items else None, "live": live, "candidate": candidate,
                "streak": outcome_rules.streak(check, context["rounds"][check["check_id"]]) if status in ("holding", "passing") else None,
                "pending_words": check["pending_words"], "explain": check["explain"], "target_words": check["target_words"],
                "left_by_topic": self._topic_ref(db, actor, check["left_by_topic_id"], work=False),
                "record_page": record_page, "fix_topic": self._topic_ref(db, actor, fix), "waiting": ask, "rule": rule,
                "chart": chart, "readings": items[:shown], "more_readings": len(items) > shown}

    def _accepted_trade(self, db, workspace_id, context, allowance):
        run = next((run for run in context["runs"] if run["id"] == allowance["run_id"]), None)
        if run is None:
            return None
        checks = self._checks_at(db, workspace_id, allowance["allowed_ms"])
        now = context["readings_by_run"].get(run["id"], {})
        base_run = next((other for other in context["runs"] if other["base_for_commit"] == run["commit_sha"]), None)
        base = context["readings_by_run"].get(base_run["id"], {}) if base_run else {}
        return outcome_rules.trade(checks, {k: dict(v) for k, v in base.items()}, {k: dict(v) for k, v in now.items()})

    def _live_baseline(self, context):
        """6.7: per check, its reading in the newest release-check run at the live release's commit, neither a rerun nor a trial."""
        if not context["releases"]:
            return None, {}
        live = context["releases"][-1]
        for run in context["runs"]:
            if (run["commit_sha"] == live["commit_sha"] and run["source"] == "release-check" and run["base_for_commit"] is None
                    and run["trial_of"] is None):
                return run, context["readings_by_run"].get(run["id"], {})
        return None, {}

    def _run_regressions(self, db, workspace_id, context, run):
        _, base = self._live_baseline(context)
        rerun_run = next((other for other in context["runs"] if other["base_for_commit"] == run["commit_sha"]), None)
        rerun = {}
        if rerun_run is not None:
            rerun = {check_id: dict(row, tools=rerun_run["tools"]) for check_id, row in context["readings_by_run"].get(rerun_run["id"], {}).items()}
        now = {check_id: dict(row, tools=run["tools"]) for check_id, row in context["readings_by_run"].get(run["id"], {}).items()}
        allowances = [dict(row) for row in db.execute("SELECT * FROM check_allowances WHERE workspace_id=? AND commit_sha=?",
                                                      (workspace_id, run["commit_sha"]))]
        return outcome_rules.regressions(context["checks"], {k: dict(v) for k, v in base.items()}, now, allowances, rerun, run["commit_sha"])

    def _loop(self, db, actor, workspace, context):
        """LOOP (5.2, D34 to D36, D40): the newest candidate no release record names, beside the live release."""
        if not context["checks"]:
            return None
        releases = context["releases"]
        live_release = releases[-1] if releases else None
        live_run, live_readings = self._live_baseline(context)
        names = {check["check_id"]: check["name"] for check in context["checks"]}
        by_commit = {release["commit_sha"] for release in releases}
        candidates = [run for run in context["runs"] if run["source"] == "release-check" and run["base_for_commit"] is None
                      and run["trial_of"] is None and run["commit_sha"] and run["commit_sha"] not in by_commit
                      and (live_release is None or run["started_ms"] >= live_release["deployed_ms"])]
        pipeline = db.execute("SELECT * FROM pipelines WHERE workspace_id=? AND enabled=1", (workspace["id"],)).fetchone()
        piece = None
        if pipeline is not None and pipeline["ships_in_releases"]:
            piece = db.execute("SELECT p.*,e.stage_id,e.round,e.progress,e.entered_ms FROM pipeline_pieces p JOIN pipeline_stage_entries e "
                               "ON e.piece_id=p.id AND e.left_ms IS NULL WHERE p.workspace_id=? AND p.kind='release' ORDER BY e.entered_ms DESC LIMIT 1",
                               (workspace["id"],)).fetchone()
            if piece is not None and piece["release_number"] in {release["number"] for release in releases}:
                piece = None
        progress = _loads(piece["progress"], None) if piece is not None and piece["stage_id"] == "checks" else None
        run = candidates[0] if candidates else None
        if progress and (run is None or progress.get("commit") != run["commit_sha"]):
            run = None
        previous = releases[-2] if len(releases) > 1 else None
        previous_readings = {}
        if previous is not None:
            for other in context["runs"]:
                if other["commit_sha"] == previous["commit_sha"] and other["base_for_commit"] is None and other["trial_of"] is None:
                    previous_readings = context["readings_by_run"].get(other["id"], {})
                    break
        behind = outcome_rules.left_behind(context["checks"], live_readings, previous_readings) if live_release else None
        if behind is not None:
            behind = dict(behind, release=live_release["number"], from_release=previous["number"])
        answer = {"candidate": None, "live": {"release": live_release["number"], "run_id": live_run["id"] if live_run else None} if live_release else None,
                  "left_behind": behind}
        if run is None and not progress:
            return answer
        commit = run["commit_sha"] if run else progress.get("commit")
        number = (piece["release_number"] if piece is not None else None) or self._release_piece_number(db, workspace["id"], commit) or (
            (live_release["number"] if live_release else 0) + 1)
        live_steps = {step["name"]: step for step in (live_run["steps"] if live_run else [])}
        if run is not None:
            now_steps = [dict(step, state="landed") for step in run["steps"]]
            total = len(now_steps)
        else:
            now_steps = [dict(step, state="landed") for step in progress.get("steps", [])]
            if progress.get("running"):
                now_steps.append({"name": progress["running"].get("name"), "state": "running", "since_ms": progress["running"].get("since_ms")})
            total = progress.get("steps_total") or len(now_steps)
        steps = []
        named = {step["name"] for step in now_steps}
        for step in now_steps:
            landed = step["state"] == "landed"
            live = live_steps.get(step["name"])
            compare = outcome_rules.step_compare(live, step) if landed else None
            note = ""
            if compare == "more":
                note = "%d more, all pass" % (step.get("pass", 0) - (live or {}).get("pass", 0))
            elif compare == "new":
                note = "New step"
            steps.append({"name": step["name"], "label": step["name"].replace("native-", ""), "group": step_group(step["name"]),
                          "state": step["state"], "since_ms": step.get("since_ms"),
                          "now": {"pass": step.get("pass"), "total": step.get("total"), "ms": step.get("ms"), "passed": step.get("passed"),
                                  "values": step.get("values")} if landed else None,
                          "live": {"pass": live.get("pass"), "total": live.get("total"), "ms": live.get("ms")} if live else None,
                          "compare": compare, "note": note})
        for name, live in live_steps.items():
            if name not in named and run is None:
                steps.append({"name": name, "label": name.replace("native-", ""), "group": step_group(name), "state": "waiting",
                              "since_ms": None, "now": None, "live": {"pass": live.get("pass"), "total": live.get("total"), "ms": live.get("ms")},
                              "compare": None, "note": ""})
        candidate = {"label": "Release %d candidate" % number, "release": number, "commit": commit,
                     "items": [row[0] for row in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY rowid",
                                                            (piece["id"],))] if piece is not None else None,
                     "state": "running", "started_ms": run["started_ms"] if run else (piece["entered_ms"] if piece is not None else None),
                     "finished_ms": run["finished_ms"] if run else None, "tools_words": [], "steps_total": total, "steps": steps,
                     "worse": [], "tools_same_as_base": None, "trials": [], "likely_cause": None, "account": None, "after": None,
                     "trade": None, "you_accept": False, "run_id": run["id"] if run else None, "tools": run["tools"] if run else {}}
        if run is not None:
            found = self._run_regressions(db, workspace["id"], context, run)
            readings = context["readings_by_run"].get(run["id"], {})
            worse = []
            for item in found["all"]:
                if item.get("allowed_by"):
                    continue
                fix = readings.get(item["check_id"], {}).get("fix_topic_id")
                accepted = None
                if item.get("accepted_by"):
                    row = db.execute("SELECT * FROM check_allowances WHERE workspace_id=? AND check_id=? AND commit_sha=? AND kind='worse'",
                                     (workspace["id"], item["check_id"], run["commit_sha"])).fetchone()
                    accepted = {"by": row["allowed_by"], "ms": row["allowed_ms"], "why": row["why"]} if row else None
                worse.append(dict(item, name=names.get(item["check_id"], item["check_id"]), fix_topic=self._topic_ref(db, actor, fix), accepted=accepted))
            candidate["worse"] = worse
            open_worse = [item for item in worse if not item.get("accepted")]
            candidate["state"] = "stopped" if open_worse else ("accepted" if worse else "passed")
            rerun_run = next((other for other in context["runs"] if other["base_for_commit"] == run["commit_sha"]), None)
            candidate["tools_same_as_base"] = outcome_rules.comparable(rerun_run, run) if rerun_run else None
            trials = []
            for trial in [other for other in context["runs"] if other["trial_of"] == run["commit_sha"]]:
                trial_found = self._run_regressions(db, workspace["id"], context, dict(trial, commit_sha=trial["commit_sha"]))
                trial_worse = sorted({item["check_id"] for item in trial_found["worse"]})
                values = {check_id: row["value"] for check_id, row in context["readings_by_run"].get(trial["id"], {}).items()}
                trials.append({"run_id": trial["id"], "without": (trial["without"] or {}).get("items", []), "worse_checks": trial_worse,
                               "worse": bool(trial_worse), "values": values,
                               "tools_same": outcome_rules.comparable(rerun_run, trial) if rerun_run else None})
            candidate["trials"] = trials
            stopped_ids = [item["check_id"] for item in open_worse]
            candidate["likely_cause"] = outcome_rules.likely_cause(stopped_ids, trials) if open_worse else None
            fix_topics = sorted({item["fix_topic"]["id"] for item in worse if item.get("fix_topic")})
            if fix_topics:
                account = db.execute("SELECT m.id,m.topic_id,m.author_id,m.sent_ms,substr(m.body,1,400) AS excerpt FROM message_subjects s "
                                     "JOIN messages m ON m.id=s.message_id WHERE s.workspace_id=? AND s.kind='check' AND m.topic_id IN "
                                     "(SELECT value FROM json_each(?)) ORDER BY m.seq DESC LIMIT 1", (workspace["id"], _json(fix_topics))).fetchone()
                if account is not None:
                    candidate["account"] = {"message_id": account["id"], "topic_id": account["topic_id"], "by": account["author_id"],
                                            "ms": account["sent_ms"], "excerpt": account["excerpt"]}
            if piece is not None:
                returned = []
                for (number,) in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? AND left_reason='returned'", (piece["id"],)):
                    other = self._open_piece_of(db, workspace["id"], number)
                    returned.append({"number": number, "topic": self._topic_ref(db, actor, other["topic_id"]) if other else None})
                rechecking = None
                if piece["stage_id"] == "checks" and piece["round"] > 1:
                    rechecking = {"round": piece["round"], "commit": (progress or {}).get("commit"),
                                  "items": [row[0] for row in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? AND left_ms IS NULL",
                                                                         (piece["id"],))]}
                if returned or rechecking:
                    candidate["after"] = {"returned": returned, "rechecking": rechecking}
            if actor == workspace["owner_id"] and any(item.get("member") is not None or _is_measure(context["checks"], item["check_id"])
                                                      for item in open_worse if item["kind"] == "failed"):
                base = {check_id: dict(row) for check_id, row in context["readings_by_run"].get(rerun_run["id"], {}).items()} if rerun_run else {}
                candidate["trade"] = outcome_rules.trade(context["checks"], base, {k: dict(v) for k, v in readings.items()})
                candidate["you_accept"] = True
        answer["candidate"] = candidate
        return answer

    def _view_outcome_checks(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        facts = self._kind_facts(db, workspace)
        context = self._checks_context(db, actor, workspace)
        word, previous = self._target_word(db, actor, workspace, context, facts)
        target_row = self._current_target(db, workspace["id"])
        target = None
        proposed = db.execute("SELECT * FROM outcome_target_revisions WHERE workspace_id=? AND outcome IS NULL ORDER BY revision DESC LIMIT 1",
                              (workspace["id"],)).fetchone()
        if target_row is not None or proposed is not None:
            earlier = [] if target_row is None else [
                {"revision": row["revision"], "text": row["text"], "settled_ms": row["settled_ms"], "by": row["proposed_by"]}
                for row in db.execute("SELECT * FROM outcome_target_revisions WHERE workspace_id=? AND outcome='accepted' AND revision<>? "
                                      "ORDER BY settled_ms DESC", (workspace["id"], target_row["revision"]))]
            target = {"revision": target_row["revision"] if target_row else None, "text": target_row["text"] if target_row else None,
                      "origin_note": target_row["origin_note"] if target_row else "",
                      "written_by": target_row["proposed_by"] if target_row else None,
                      "written_ms": target_row["settled_ms"] if target_row else None, "changed_since": bool(earlier),
                      "proposed": ({"revision": proposed["revision"], "text": proposed["text"], "by": proposed["proposed_by"],
                                    "ask_message_id": proposed["ask_message_id"]} if proposed else None),
                      "earlier": earlier}
        checks, statuses = context["checks"], context["statuses"]
        views = [self._check_view(db, actor, workspace, check, status, context) for check, status in zip(checks, statuses)]
        counts = {name: statuses.count(name) for name in outcome_rules.STATUSES}
        counts["total"] = len(statuses)
        groups, order = {}, []
        for view, check in zip(views, checks):
            if check["group_name"] not in groups:
                groups[check["group_name"]] = []
                order.append(check["group_name"])
            groups[check["group_name"]].append(view)
        group_views = []
        for name in order:
            members = groups[name]
            group_counts = {status: sum(member["status"] == status for member in members) for status in outcome_rules.STATUSES}
            group_views.append({"name": name, "open": any(member["status"] in ("failing", "waiting") for member in members),
                                "counts": group_counts, "checks": members})
        failing = outcome_rules.target_failing(checks, statuses, previous) if word == "not_on_target" else None
        failing_view = None
        if failing is not None:
            view = next(view for view in views if view["check_id"] == failing["check_id"])
            failing_view = {"check_id": failing["check_id"], "name": failing["name"], "label": (view["latest"] or {}).get("label")}
        reach = None
        if facts["kind"] == "reach" and not facts["reached"] and actor == workspace["owner_id"]:
            offered, unmet = outcome_rules.reach_offered(checks, statuses)
            reach = {"offered": offered, "unmet": unmet, "blocking_tools": []}
        problems = context["problems"]
        if problems is not None:
            problems = {key: value for key, value in problems.items() if key != "readings"}
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "workspace_title": workspace["title"],
                "owner": workspace["owner_id"], "coordinator": workspace["coordinator_id"], "you_own": actor == workspace["owner_id"],
                "you_steer": actor in (workspace["owner_id"], workspace["coordinator_id"]),
                "target": target,
                "kind": {"kind": facts["kind"], "started_by": facts["start"]["by"] if facts["start"] else workspace["owner_id"],
                         "started_ms": facts["start"]["ms"] if facts["start"] else None, "you_change": actor == workspace["owner_id"]},
                "word": word, "failing_check": failing_view, "reached": facts["reached"], "reach": reach,
                "rounds": outcome_rules.rounds_of(context["ships"]), "counts": counts, "groups": group_views,
                "loop": self._loop(db, actor, workspace, context), "problems": problems,
                "releases": [{"number": release["number"], "deployed_ms": release["deployed_ms"]} for release in context["releases"][-outcome_rules.CHART_RELEASES:]],
                "relevant_versions": {"checks": self._target_revision(db, workspace["id"]), "workspace": workspace["version"]}}

    def _view_check_readings(self, db, actor, args):
        """The Measurements page: every check's readings by release, newest first, paged by release number."""
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        context = self._checks_context(db, actor, workspace)
        wanted = args.get("check_id")
        limit = args.get("limit", 8)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise Refusal("INVALID_ARGUMENT", "limit is 1 to 50 releases")
        before = args.get("cursor")
        checks = []
        oldest = None
        for check, status in zip(context["checks"], context["statuses"]):
            if wanted is not None and check["check_id"] != wanted:
                continue
            items = context["readings"][check["check_id"]]
            view = self._check_view(db, actor, workspace, check, status, context, shown=10 ** 6)
            kept = [item for item in items if before is None or (item["release"] is not None and item["release"] < before and not item["candidate"])]
            numbers = sorted({item["release"] for item in kept if item["release"] is not None}, reverse=True)[:limit]
            page = [item for item in kept if item["release"] in numbers or (item["release"] is None and before is None)]
            if numbers:
                oldest = numbers[-1] if oldest is None else min(oldest, numbers[-1])
            view["readings"] = page
            checks.append(dict(view, group_name=check["group_name"]))
        more = oldest is not None and any(item["release"] is not None and item["release"] < oldest and not item["candidate"]
                                          for check in context["checks"] for item in context["readings"][check["check_id"]])
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "workspace_title": workspace["title"],
                "checks": checks, "next_cursor": oldest if more else None,
                "relevant_versions": {"checks": self._target_revision(db, workspace["id"])}}

    def _outcome_target_line(self, db, actor, workspace_id):
        """D10: the topic view's closed target line, or None when the outcome has no target and no checks (to keep)."""
        workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        facts = self._kind_facts(db, workspace)
        context = self._checks_context(db, actor, workspace)
        target = self._current_target(db, workspace_id)
        if facts["kind"] == "keep" and target is None and not context["checks"]:
            return None
        word, _ = self._target_word(db, actor, workspace, context, facts)
        counts = {name: context["statuses"].count(name) for name in outcome_rules.STATUSES}
        counts["total"] = len(context["statuses"])
        return {"kind": facts["kind"], "word": word, "counts": counts, "text": target["text"] if target else None,
                "workspace_id": workspace_id, "workspace_title": workspace["title"]}

    # ---- the deploy's read (7.2) and its operator write (7.3) ------------------------

    def _view_outcome_live(self, db, actor, args):
        """What the deploy reads before it measures: the checks, the coordinator, the live baseline and the owner's allowances bearing on SHA."""
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        context = self._checks_context(db, actor, workspace)
        run, readings = self._live_baseline(context)
        commit = args.get("commit")
        allowances = []
        if commit is not None:
            allowances = [dict(row) for row in db.execute("SELECT * FROM check_allowances WHERE workspace_id=? AND (kind='fewer' OR commit_sha=?)",
                                                          (workspace["id"], commit))]
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "coordinator": workspace["coordinator_id"],
                "members": [row[0] for row in db.execute("SELECT actor_id FROM workspace_members WHERE workspace_id=?", (workspace["id"],))],
                "checks": context["checks"], "live": {"run_id": run["id"], "commit": run["commit_sha"], "tools": run["tools"]} if run else None,
                "readings": readings, "allowances": allowances,
                "fix_topics": {check_id: self._open_fix_topic(db, workspace["id"], check_id) for check_id in (c["check_id"] for c in context["checks"])}}

    def _open_fix_topic(self, db, workspace_id, check_id):
        row = db.execute("SELECT r.fix_topic_id FROM check_readings r JOIN check_runs u ON u.id=r.run_id JOIN topics t ON t.id=r.fix_topic_id "
                         "WHERE r.workspace_id=? AND r.check_id=? AND r.fix_topic_id IS NOT NULL AND t.state<>'done' "
                         "ORDER BY u.started_ms DESC LIMIT 1", (workspace_id, check_id)).fetchone()
        return row[0] if row else None


def _is_measure(checks, check_id):
    return any(check["check_id"] == check_id and check["kind"] == "measure" for check in checks)


def record_checks(store, db, run, actor):
    """The deploy's operator act (7.3): one release-check run, and its base rerun, in one transaction."""
    workspace_id = _identifier(run.get("outcome"), "outcome")
    if not db.execute("SELECT 1 FROM workspaces WHERE id=?", (workspace_id,)).fetchone():
        raise Refusal("NOT_FOUND", "No outcome %s" % workspace_id)
    if not db.execute("SELECT 1 FROM outcome_targets WHERE workspace_id=?", (workspace_id,)).fetchone():
        raise Refusal("NO_CHECKS", "This outcome has no checks")
    if run.get("source", "release-check") != "release-check":
        raise Refusal("INVALID_ARGUMENT", "The deploy records release-check runs")
    body = {key: run.get(key) for key in ("commit", "started_at", "finished_at", "tools", "steps", "note")}
    identity, written = store._write_run(db, actor, workspace_id, body, run.get("readings", []), "release-check")
    base = run.get("base")
    if base:
        body = {key: base.get(key) for key in ("commit", "started_at", "finished_at", "tools", "steps", "note")}
        store._write_run(db, actor, workspace_id, body, base.get("readings", []), "release-check", base_for=run.get("commit"))
    if written:
        store._bump_checks(db, workspace_id, identity)
    return {"run_id": identity, "recorded": written}


def import_checks(store, db, seed, actor, now_ms):
    """8.2 step 6: the target, the checks, the seed's found problems and readings, then one run from each release record with measurements."""
    workspace_id = seed["workspace_id"]
    if db.execute("SELECT 1 FROM outcome_targets WHERE workspace_id=?", (workspace_id,)).fetchone():
        return {"checks_imported": False}
    store._ensure_targets(db, workspace_id)
    target = seed.get("target")
    if target:
        db.execute("INSERT INTO outcome_target_revisions VALUES (?,1,?,?,?,?,NULL,'accepted',?,?)",
                   (workspace_id, target["text"], target.get("origin_note", ""), target.get("by", actor), target.get("ms", now_ms),
                    target.get("by", actor), target.get("ms", now_ms)))
    for check in seed.get("checks", []):
        definition = store._definition(db, workspace_id, check, None)
        db.execute("INSERT INTO outcome_checks VALUES (%s)" % ",".join("?" * 22),
                   (workspace_id, definition["check_id"], 1, definition["group_name"], definition["position"], definition["name"],
                    definition["kind"], definition["source"], definition["unit"] or "", definition["better"], definition["target_value"],
                    definition["target_words"] or "", definition["tolerance"], definition["repeats"], definition["counted_since_ms"],
                    definition["explain"] or "", definition["pending_words"] or "", definition["record_memory_item_id"],
                    definition["left_by_topic_id"], None, check.get("defined_by", actor), check.get("defined_ms", now_ms)))
    for reading_run in seed.get("runs", []):
        commit = reading_run.get("commit")
        if commit is None and reading_run.get("release") is not None:
            row = db.execute("SELECT commit_sha FROM releases WHERE number=?", (reading_run["release"],)).fetchone()
            commit = row[0] if row else None
        store._write_run(db, actor, workspace_id, dict(reading_run, commit=commit), reading_run["readings"],
                         reading_run.get("source", "reported"))
    runs = 0
    checks = store._current_checks(db, workspace_id)
    for release in db.execute("SELECT * FROM releases WHERE measurements IS NOT NULL ORDER BY number").fetchall():
        measurements = json.loads(release["measurements"])
        steps = check_reading.steps_of_measurements(measurements)
        timing = measurements.get("release_check") or {}
        started = _ms(timing["started_at"], "started_at") if timing.get("started_at") else release["deployed_ms"]
        finished = _ms(timing["finished_at"], "finished_at") if timing.get("finished_at") else release["deployed_ms"]
        found = check_reading.readings(checks, steps)
        if not found:
            continue
        run = {"commit": release["commit_sha"], "started_ms": started, "finished_ms": finished, "tools": {}, "steps": steps,
               "note": "from release %d's record" % release["number"]}
        store._write_run(db, actor, workspace_id, run, found, "release-check")
        runs += 1
    problems = 0
    for problem in seed.get("problems", []):
        message = None
        if problem.get("seq") is not None:
            row = db.execute("SELECT id,author_id,sent_ms FROM messages WHERE seq=?", (problem["seq"],)).fetchone()
            if row is None:
                raise Refusal("SEED_SOURCE", "Problem %r names message #%s, which is not here" % (problem["what"], problem["seq"]))
            message = row
        problem_id = "fp-" + hashlib.sha256(problem["what"].encode("utf-8")).hexdigest()[:24]
        db.execute("INSERT INTO found_problems(id,workspace_id,what,kind,found_by,message_id,note,found_ms,cover_item,cover_words,version) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,1)",
                   (problem_id, workspace_id, problem["what"], problem["kind"], problem.get("found_by") or (message["author_id"] if message else actor),
                    message["id"] if message else None, None if message else problem["note"],
                    message["sent_ms"] if message else problem["found_ms"], problem.get("cover_item"), problem.get("cover_words", "")))
        problems += 1
    store._bump_checks(db, workspace_id, "imported")
    return {"checks_imported": True, "checks": len(seed.get("checks", [])), "release_runs": runs, "problems": problems}

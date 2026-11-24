from __future__ import annotations

"""Authenticated piece clocks; docs/piece-clock-1199.md. No DDL or scheduler."""

import copy
import json
import re

from .contract import Refusal, StoreError, _identifier, _json
from .delivery import _now_ms

PREFIX = "piece_clock.v1:"
DUE = PREFIX + "due"
STATE_BYTES = 256 * 1024
QUEUE_LIMIT = 256
HOUR = 3600000
PHASES = ("writing", "wait", "test", "repair", "command")
CLASSES = ("page", "core", "database")
SHA = re.compile(r"[0-9a-f]{40}\Z")


def moment(value, name):
    if type(value) is not int or not 0 <= value <= 9007199254740991:
        raise Refusal("INVALID_ARGUMENT", name + " is an epoch millisecond integer")
    return value


def words(value, name, limit=1024):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > limit:
        raise Refusal("INVALID_ARGUMENT", name + " is bounded nonempty text")
    return value


def read(db, key, default):
    row = db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
    if row is None:
        return copy.deepcopy(default)
    try:
        return json.loads(row[0])
    except (ValueError, TypeError) as error:
        raise StoreError("The selected clock record is unreadable") from error


def put(db, key, value):
    encoded = _json(value)
    if len(encoded.encode("utf-8")) > STATE_BYTES:
        raise Refusal("CLOCK_CAPACITY", "Clock history is full; no retained event was removed")
    db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, encoded))


def empty(piece_id):
    return {"v": 1, "piece_id": piece_id, "revision": 0, "lane": None,
            "work_class": None, "lanes": [], "segments": [], "forecasts": [],
            "intervals": [], "pushes": [], "events": []}


def union(intervals):
    result, end = 0, None
    for start, stop in sorted(intervals):
        result += max(0, stop - max(start, end if end is not None else start))
        end = max(stop, end if end is not None else stop)
    return result


def timings(intervals, start, stop):
    if start is None:
        return {"available": False, "reason": "No immutable Build entry"}
    stop = max(start, stop)
    clipped = {phase: [] for phase in PHASES}
    for row in intervals:
        a, b = max(start, row["start_ms"]), min(stop, row["end_ms"] if row["end_ms"] is not None else stop)
        if b > a:
            clipped[row["phase"]].append((a, b))
    every = [pair for rows in clipped.values() for pair in rows]
    totals = {phase + "_ms": union(rows) for phase, rows in clipped.items()}
    classified = union(every)
    return dict(totals, available=True, window_start_ms=start, window_end_ms=stop,
                elapsed_ms=stop-start, classified_ms=classified,
                overlap_excess_ms=sum(totals.values())-classified,
                unclassified_ms=stop-start-classified,
                incomplete_attempts=[r["id"] for r in intervals if r["end_ms"] is None])


class PieceClock:
    def _clock_state(self, db, piece_id):
        value = read(db, PREFIX + piece_id, empty(piece_id))
        if not isinstance(value, dict) or value.get("v") != 1 or value.get("piece_id") != piece_id:
            raise StoreError("The selected clock record has an unsupported shape")
        return value

    def _clock_source(self, db, actor, workspace, ref, author=None):
        if (not isinstance(ref, dict) or set(ref) != {"kind", "id", "revision"}
                or ref["kind"] != "message" or type(ref["revision"]) is not int or ref["revision"] < 1):
            raise Refusal("INVALID_ARGUMENT", "A clock source names a public message and its revision")
        source = self._source(db, actor, ref)
        if source["current_revision"] != ref["revision"]:
            raise Refusal("INVALID_CLOCK_SOURCE", "Read and name the source message's current revision")
        identity = db.execute("SELECT m.private_to,t.workspace_id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?", (ref["id"],)).fetchone()
        if (identity["private_to"] is not None or identity["workspace_id"] != workspace["id"]
                or source.get("withheld") or (author is not None and source["author"] != author)):
            raise Refusal("INVALID_CLOCK_SOURCE", "The source must be public in this outcome and authored by the named lane when carrying its estimate")
        return dict(ref)

    def _clock_save(self, db, workspace_id, state, event):
        state["revision"] += 1
        state["events"].append(dict(event, revision=state["revision"]))
        put(db, PREFIX + state["piece_id"], state)
        self._change(db, "workspace", workspace_id, "piece_clock", state["piece_id"], state["revision"])

    def _clock_build(self, db, piece):
        # Item history follows its indexed memberships, including a returned
        # incarnation. A resumed/new piece cannot reset an item's first Build.
        rows = db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (piece["id"],)).fetchall()
        candidates = []
        for row in rows:
            found = db.execute("SELECT e.seq,e.piece_id,e.entered_ms,e.entered_by,e.size FROM pipeline_piece_members m INDEXED BY item_pieces "
                               "JOIN pipeline_stage_entries e INDEXED BY piece_entries ON e.piece_id=m.piece_id "
                               "WHERE m.workspace_id=? AND m.number=? AND e.stage_id='build' ORDER BY e.seq LIMIT 1", (piece["workspace_id"], row[0])).fetchone()
            if found is not None:
                candidates.append(dict(found))
        return min(candidates, key=lambda r: r["seq"]) if candidates else None

    def _clock_live(self, db, piece, build):
        pipeline = self._pipeline_row(db, piece["workspace_id"])
        if pipeline is None or not pipeline["ships_in_releases"]:
            return None
        numbers = [row[0] for row in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (piece["id"],))]
        if not numbers:
            return None
        receipts = []
        for number in numbers:
            index = read(db, PREFIX + "live:" + str(number), None)
            if index is None:
                return None
            row = db.execute("SELECT number,commit_sha,deployed_ms,recorded_ms,items FROM releases WHERE number=?", (index["release"],)).fetchone()
            if (row is None or number not in json.loads(row["items"])
                    or (build is not None and row["deployed_ms"] < build["entered_ms"])):
                return None
            receipts.append(dict(row))
        last = max(receipts, key=lambda r: (r["deployed_ms"], r["number"]))
        return {"release": last["number"], "head": last["commit_sha"], "occurred_ms": last["deployed_ms"],
                "recorded_ms": last["recorded_ms"], "items": numbers,
                "receipts": sorted({r["number"] for r in receipts})}

    def _clock_record_release(self, db, record):
        # Called by the existing release recorder, in that same transaction.
        # An explicit reconciliation uses this path for pre-capability records.
        for number in record["items"]:
            key = PREFIX + "live:" + str(number)
            previous = read(db, key, None)
            if previous is not None and previous["release"] != record["release"]:
                raise Refusal("CLOCK_RELEASE_CONFLICT", "An item retains its first actual release")
            put(db, key, {"release": record["release"]})

    def _clock_anchor(self, db, piece, state, anchor):
        if anchor == "build":
            build = self._clock_build(db, piece)
            if build is None:
                raise Refusal("CLOCK_ANCHOR_MISSING", "This piece has no immutable Build entry")
            return {"kind": "build", "id": str(build["seq"]), "ms": build["entered_ms"]}
        if anchor == "freeze":
            row = db.execute("SELECT seq,ms FROM pipeline_piece_freezes WHERE piece_id=? ORDER BY seq LIMIT 1", (piece["id"],)).fetchone()
            if row is None:
                raise Refusal("CLOCK_ANCHOR_MISSING", "This piece has no recorded freeze")
            return {"kind": "freeze", "id": str(row["seq"]), "ms": row["ms"]}
        for segment in state["segments"]:
            if segment["id"] == anchor:
                return {"kind": "segment", "id": anchor, "ms": segment["start_ms"]}
        raise Refusal("CLOCK_ANCHOR_MISSING", "Name Build, freeze or a recorded source/resume segment")

    def _clock_queue(self, db, state):
        queue = [r for r in read(db, DUE, []) if r["piece_id"] != state["piece_id"]]
        for forecast in state["forecasts"]:
            if forecast.get("notice") is None:
                queue.append({"piece_id": state["piece_id"], "forecast_id": forecast["id"],
                              "due_ms": forecast["revisions"][0]["deadline_ms"] + HOUR + 1})
        if len(queue) > QUEUE_LIMIT:
            raise Refusal("CLOCK_CAPACITY", "At most256 pending named forecasts; no retained forecast was removed")
        put(db, DUE, sorted(queue, key=lambda r: (r["due_ms"], r["piece_id"], r["forecast_id"])))

    def _clock_event(self, db, actor, piece, workspace, state, args, operation_id, at_build=False):
        args = dict(args)
        kind = args.get("kind")
        schemas = {
            "lane": {"kind", "lane", "work_class", "source"},
            "segment": {"kind", "id", "start_ms", "mode", "source"},
            "forecast": {"kind", "id", "milestone", "anchor", "deadline_ms", "reason", "source"},
            "revise": {"kind", "id", "deadline_ms", "reason", "source"},
            "interval": {"kind", "id", "phase", "start_ms", "end_ms", "terminal", "source", "imposed_by", "rule"},
            "push": {"kind", "id", "head", "occurred_ms", "receipt", "source"},
            "notice_link": {"kind", "id", "message_id", "reason", "source"},
            "release": {"kind", "release", "source"},
        }
        if not isinstance(kind, str) or kind not in schemas or set(args) - schemas[kind]:
            raise Refusal("INVALID_ARGUMENT", "Name one supported clock event with its own fields")
        now = _now_ms()
        if kind in ("lane", "release"):
            if not self._steers(workspace, actor):
                raise Refusal("FORBIDDEN", "Only the outcome owner or coordinator binds lanes or reconciles releases")
        elif actor != state["lane"] and not self._steers(workspace, actor):
            raise Refusal("FORBIDDEN", "Only the bound lane, owner or coordinator records this piece's clock")
        source = self._clock_source(db, actor, workspace, args.get("source"),
                                    author=state["lane"] if at_build and kind == "forecast" else None)
        source_author = db.execute("SELECT author_id FROM messages WHERE id=?", (source["id"],)).fetchone()[0]
        event = {"kind": kind, "by": actor, "recorded_ms": now, "source": source, "source_author": source_author, "operation_id": operation_id}
        if kind == "lane":
            lane = _identifier(args.get("lane"), "lane")
            self._actor(db, lane)
            self._workspace(db, lane, workspace["id"])
            if args.get("work_class") not in CLASSES:
                raise Refusal("INVALID_ARGUMENT", "The work class is page, core or database")
            state["lanes"].append(dict(event, lane=lane, previous=state["lane"], work_class=args["work_class"]))
            state["lane"], state["work_class"] = lane, args["work_class"]
        elif kind == "segment":
            identity = _identifier(args.get("id"), "segment id")
            if any(r["id"] == identity for r in state["segments"]):
                raise Refusal("CLOCK_EVENT_EXISTS", "A source/resume segment keeps its original start")
            start = moment(args.get("start_ms"), "start_ms")
            if start > now or args.get("mode") not in ("source", "resume"):
                raise Refusal("INVALID_ARGUMENT", "A source/resume start is an observed past moment")
            state["segments"].append(dict(event, id=identity, start_ms=start, mode=args["mode"]))
        elif kind in ("forecast", "revise"):
            identity = _identifier(args.get("id"), "forecast id")
            deadline = moment(args.get("deadline_ms"), "deadline_ms")
            reason = words(args.get("reason"), "forecast reason")
            forecast = next((r for r in state["forecasts"] if r["id"] == identity), None)
            if kind == "forecast":
                if forecast is not None:
                    raise Refusal("CLOCK_EVENT_EXISTS", "Revise the existing forecast; its first deadline stays")
                if len(state["forecasts"]) >= 64 or args.get("milestone") not in ("push", "live"):
                    raise Refusal("INVALID_ARGUMENT", "At most64 forecasts, each targeting push or live")
                anchor = self._clock_anchor(db, piece, state, args.get("anchor"))
                forecast = dict(event, id=identity, milestone=args["milestone"], anchor=anchor,
                                at_build=bool(at_build and anchor["kind"] == "build"), revisions=[], notice=None)
                state["forecasts"].append(forecast)
            elif forecast is None:
                raise Refusal("NOT_FOUND", "No forecast with that ID in this piece")
            forecast["revisions"].append(dict(event, revision=len(forecast["revisions"])+1, deadline_ms=deadline, reason=reason))
            event.update(id=identity, deadline_ms=deadline)
        elif kind == "interval":
            identity = _identifier(args.get("id"), "physical interval id")
            phase = args.get("phase")
            start = moment(args.get("start_ms"), "start_ms")
            stop = args.get("end_ms")
            if stop is not None:
                moment(stop, "end_ms")
            if phase not in PHASES or start > now or (stop is not None and not start <= stop <= now):
                raise Refusal("INVALID_ARGUMENT", "An observed interval has a supported phase and ordered past endpoints")
            if args.get("terminal") is not None:
                words(args["terminal"], "terminal", 128)
            if phase == "wait":
                self._actor(db, args.get("imposed_by"))
                words(args.get("rule"), "wait rule or lock")
            existing = next((r for r in state["intervals"] if r["id"] == identity), None)
            interval = dict(event, id=identity, phase=phase, start_ms=start, end_ms=stop,
                            terminal=args.get("terminal"), imposed_by=args.get("imposed_by"), rule=args.get("rule"))
            if existing is not None:
                if existing["end_ms"] is not None or any(existing[k] != interval[k] for k in ("phase", "start_ms", "imposed_by", "rule")):
                    raise Refusal("CLOCK_EVENT_EXISTS", "A physical attempt keeps its original interval and terminal")
                if stop is None:
                    raise Refusal("CLOCK_EVENT_EXISTS", "This attempt already began; reconcile it instead of launching it again")
                existing.update(end_ms=stop, terminal=args.get("terminal"), completion=event)
            else:
                state["intervals"].append(interval)
        elif kind == "push":
            identity = _identifier(args.get("id"), "push receipt id")
            receipt = args.get("receipt")
            occurred = moment(args.get("occurred_ms"), "occurred_ms")
            if (not isinstance(args.get("head"), str) or not SHA.fullmatch(args["head"])
                    or occurred > now or not isinstance(receipt, dict)
                    or set(receipt) != {"remote", "ref", "observed_ms", "evidence", "uncertainty_ms"}):
                raise Refusal("INVALID_ARGUMENT", "A push names a full head and its structured remote receipt")
            for key in ("remote", "ref", "evidence"):
                words(receipt[key], "push " + key)
            observed = moment(receipt["observed_ms"], "observed_ms")
            uncertainty = moment(receipt["uncertainty_ms"], "uncertainty_ms")
            if not occurred <= observed <= now:
                raise Refusal("INVALID_ARGUMENT", "Push occurrence precedes observation and recording")
            if any(r["id"] == identity for r in state["pushes"]):
                raise Refusal("CLOCK_EVENT_EXISTS", "A push receipt keeps its identity and original time")
            state["pushes"].append(dict(event, id=identity, head=args["head"], occurred_ms=occurred,
                                        receipt=dict(receipt), uncertainty_ms=uncertainty))
        elif kind == "notice_link":
            forecast = next((r for r in state["forecasts"] if r["id"] == args.get("id")), None)
            if forecast is None:
                raise Refusal("NOT_FOUND", "No named forecast")
            message = self._message_access(db, actor, args.get("message_id"))
            row = db.execute("SELECT t.workspace_id,m.private_to,m.addressees FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?", (message["id"],)).fetchone()
            if row["workspace_id"] != workspace["id"] or row["private_to"] is not None or workspace["owner_id"] not in json.loads(row["addressees"]):
                raise Refusal("INVALID_ARGUMENT", "The earlier communication must publicly address this outcome's owner")
            if forecast.get("notice") is not None:
                raise Refusal("CLOCK_EVENT_EXISTS", "This forecast already retains its notice")
            forecast["notice"] = dict(event, message_id=message["id"], linked=True, reason=words(args.get("reason"), "notice reason"))
        elif kind == "release":
            number = args.get("release")
            if type(number) is not int or number <= 0:
                raise Refusal("INVALID_ARGUMENT", "Name an actual release number")
            row = db.execute("SELECT number,items FROM releases WHERE number=?", (number,)).fetchone()
            numbers = {r[0] for r in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=?", (piece["id"],))}
            pipeline = self._pipeline_row(db, workspace["id"])
            if row is None or not pipeline["ships_in_releases"] or not numbers.intersection(json.loads(row["items"])):
                raise Refusal("CLOCK_RELEASE_MISMATCH", "This actual release must ship an item of this piece")
            self._clock_record_release(db, {"release": row["number"], "items": sorted(numbers.intersection(json.loads(row["items"])))})
            event["release"] = number
        self._clock_save(db, workspace["id"], state, event)
        self._clock_queue(db, state)
        # Leave space for automatic notices when explicit history reaches its
        # limit; capacity cannot prevent unrelated Core commands from working.
        if len(_json(state).encode("utf-8")) > STATE_BYTES - 65536:
            raise Refusal("CLOCK_CAPACITY", "Explicit clock history is full; retained history stays intact")
        return event

    def _command_pipeline_clock_record(self, db, actor, envelope):
        if set(envelope["target"]) != {"piece_id"}:
            raise Refusal("INVALID_ARGUMENT", "Name one piece")
        piece, workspace = self._piece(db, actor, envelope["target"]["piece_id"])
        if piece["kind"] != "piece":
            raise Refusal("INVALID_ARGUMENT", "Record an item piece's clock, not a release train")
        state = self._clock_state(db, piece["id"])
        self._check_revision(envelope, "clock_revision", state["revision"])
        event = self._clock_event(db, actor, piece, workspace, state, envelope["args"], envelope["operation_id"])
        return {"piece_id": piece["id"], "clock_revision": state["revision"], "event": event, "record": state}, []

    def _command_pipeline_piece_start(self, db, actor, envelope):
        clock = envelope["args"].get("clock")
        if clock is None:
            return super()._command_pipeline_piece_start(db, actor, envelope)
        workspace = self._steerer(db, actor, envelope["target"].get("workspace_id"))
        if not isinstance(clock, dict) or set(clock) != {"lane", "work_class", "source", "forecasts"} or not isinstance(clock["forecasts"], list) or len(clock["forecasts"]) > 8:
            raise Refusal("INVALID_ARGUMENT", "An initial clock names lane, class, assignment source and at most8 forecasts")
        reduced = dict(envelope, args={k: v for k, v in envelope["args"].items() if k != "clock"})
        result, affected = super()._command_pipeline_piece_start(db, actor, reduced)
        piece, _ = self._piece(db, actor, result["piece_id"])
        state = empty(piece["id"])
        self._clock_event(db, actor, piece, workspace, state,
                          {"kind": "lane", "lane": clock["lane"], "work_class": clock["work_class"], "source": clock["source"]}, envelope["operation_id"])
        for forecast in clock["forecasts"]:
            if not isinstance(forecast, dict) or forecast.get("kind") != "forecast":
                raise Refusal("INVALID_ARGUMENT", "Initial forecasts are typed forecast events")
            self._clock_event(db, actor, piece, workspace, state, forecast, envelope["operation_id"], at_build=True)
        return dict(result, clock_revision=state["revision"], clock=state), affected

    def _clock_summary(self, db, actor, piece, state, now):
        build = self._clock_build(db, piece)
        live = self._clock_live(db, piece, build)
        push = state["pushes"][0] if state["pushes"] else None
        start = build["entered_ms"] if build else None
        forecasts = []
        for forecast in state["forecasts"]:
            actual = push["occurred_ms"] if forecast["milestone"] == "push" and push else live["occurred_ms"] if forecast["milestone"] == "live" and live else None
            revisions = [dict(r, signed_error_ms=None if actual is None else actual-r["deadline_ms"],
                              absolute_error_ms=None if actual is None else abs(actual-r["deadline_ms"])) for r in forecast["revisions"]]
            forecasts.append({"id": forecast["id"], "milestone": forecast["milestone"], "anchor": forecast["anchor"],
                              "at_build": forecast["at_build"], "original": revisions[0], "current": revisions[-1], "revisions": revisions,
                              "notice": forecast.get("notice"), "notice_error": forecast.get("notice_error"),
                              "status": "achieved" if live else "milestone_recorded" if actual is not None else "unfinished",
                              "open_overdue": actual is None and now > revisions[-1]["deadline_ms"]})
        original = next((r for r in forecasts if r["at_build"] and r["milestone"] == "live"), None)
        elapsed = None if start is None else (live["occurred_ms"] if live else now)-start
        return {"capability_version": 1, "piece_id": piece["id"], "workspace_id": piece["workspace_id"],
                "clock_revision": state["revision"], "lane": state["lane"], "work_class": state["work_class"],
                "items": [r[0] for r in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (piece["id"],))],
                "first_build": build, "first_push": push, "first_live": live,
                "estimate_status": "provided" if any(f["revisions"][0].get("source_author") == state["lane"] for f in state["forecasts"]) else "no estimate yet",
                "original_live_prediction": original, "original_prediction_status": "provided" if original else "unavailable",
                "build_to_push_ms": None if start is None or push is None else push["occurred_ms"]-start,
                "push_precedes_build": bool(start is not None and push is not None and push["occurred_ms"] < start),
                "push_to_live_ms": None if live is None or push is None else live["occurred_ms"]-push["occurred_ms"],
                "build_to_live_ms": elapsed if live else None, "elapsed_since_build_ms": elapsed,
                "forecasts": forecasts, "timings": timings(state["intervals"], start, live["occurred_ms"] if live else now),
                "stage_chronology_is_labor": False}

    def _view_pipeline_clock(self, db, actor, args):
        if set(args) != {"piece_id"}:
            raise Refusal("INVALID_ARGUMENT", "Read one exact piece clock")
        piece, workspace = self._piece(db, actor, args["piece_id"])
        state = self._clock_state(db, piece["id"])
        return {"instance_id": self.instance_id, "record": state,
                "clock": self._clock_summary(db, actor, piece, state, _now_ms())}

    def _piece_clock_context(self, db, actor, piece_id):
        piece, _ = self._piece(db, actor, piece_id)
        state = self._clock_state(db, piece_id)
        summary = self._clock_summary(db, actor, piece, state, _now_ms())
        return {k: summary[k] for k in ("capability_version", "piece_id", "clock_revision", "lane", "estimate_status",
                                        "original_prediction_status", "elapsed_since_build_ms")}

    def _view_pipeline_predictions(self, db, actor, args):
        workspace = self._workspace(db, actor, args.get("workspace_id"))
        selected = args.get("piece_ids")
        if (not isinstance(selected, list) or not 1 <= len(selected) <= 50
                or any(not isinstance(p, str) for p in selected) or len(set(selected)) != len(selected)):
            raise Refusal("INVALID_ARGUMENT", "A cohort names1to50 distinct piece IDs")
        since, until = args.get("from_ms", 0), args.get("until_ms", _now_ms()+1)
        moment(since, "from_ms"); moment(until, "until_ms")
        if until <= since or args.get("work_class") not in (None,) + CLASSES:
            raise Refusal("INVALID_ARGUMENT", "Name an ordered cohort window and known work class")
        now, rows = _now_ms(), []
        for piece_id in selected:
            piece, _ = self._piece(db, actor, piece_id)
            if piece["workspace_id"] != workspace["id"] or piece["kind"] != "piece":
                raise Refusal("FORBIDDEN", "Every selected piece belongs to this outcome")
            state = self._clock_state(db, piece_id)
            summary = self._clock_summary(db, actor, piece, state, now)
            if args.get("work_class") is not None and state["work_class"] != args["work_class"]:
                continue
            live = summary["first_live"]
            if live and not since <= live["occurred_ms"] < until:
                continue
            # The cohort retains per-piece diagnostic values, not full activity
            # history multiplied by its size. The exact clock has that history.
            rows.append({k: v for k, v in summary.items() if k != "timings"})
        completed = [r for r in rows if r["first_live"] is not None]
        eligible = [r for r in completed if r["first_build"] is not None]
        pages = [r for r in eligible if r["work_class"] == "page" and r["first_build"]["size"] == "small"]
        original = [r for r in eligible if r["original_live_prediction"] is not None]
        correct = [r for r in original if r["original_live_prediction"]["original"]["absolute_error_ms"] <= 900000]
        worst = max(eligible, key=lambda r: r["build_to_live_ms"]) if eligible else None
        rows.sort(key=lambda r: (r["first_live"] is not None, r["piece_id"]))
        return {"instance_id": self.instance_id, "workspace_id": workspace["id"], "items": rows,
                "cohort": {"selection": "explicit_pieces", "piece_ids": selected, "from_ms": since, "until_ms": until, "work_class": args.get("work_class")},
                "counts": {"completed": len(completed), "eligible": len(eligible), "missing_build": len(completed)-len(eligible),
                           "small_page_eligible": len(pages), "small_page_within_target": sum(r["build_to_live_ms"] < 2700000 for r in pages),
                           "prediction_eligible": len(eligible), "prediction_scored": len(original), "prediction_within_target": len(correct),
                           "missing_original_prediction": len(eligible)-len(original),
                           "open_overdue_pieces": sum(any(f["open_overdue"] for f in r["forecasts"]) for r in rows if r["first_live"] is None)},
                "worst": None if worst is None else {"piece_id": worst["piece_id"], "items": worst["items"], "build_to_live_ms": worst["build_to_live_ms"]}}

    def _clock_next_due(self, db):
        queue = read(db, DUE, [])
        return queue[0]["due_ms"] if queue else None

    def _clock_settle_due(self, db, now):
        queue = read(db, DUE, [])
        if not queue or queue[0]["due_ms"] > now:
            return False
        remaining, changed, processed = [], False, 0
        for entry in queue:
            if entry["due_ms"] > now or processed >= 8:
                remaining.append(entry)
                continue
            processed += 1
            state = self._clock_state(db, entry["piece_id"])
            forecast = next((r for r in state["forecasts"] if r["id"] == entry["forecast_id"]), None)
            if forecast is None or forecast.get("notice") is not None:
                changed = True
                continue
            piece = db.execute("SELECT * FROM pipeline_pieces WHERE id=?", (entry["piece_id"],)).fetchone()
            if piece is None:
                raise StoreError("A due clock refers to a missing piece")
            build = self._clock_build(db, piece)
            live = self._clock_live(db, piece, build)
            actual = state["pushes"][0] if forecast["milestone"] == "push" and state["pushes"] else live
            first, current = forecast["revisions"][0], forecast["revisions"][-1]
            if actual is not None and actual["occurred_ms"] <= first["deadline_ms"] + HOUR:
                changed = True
                continue
            workspace = db.execute("SELECT * FROM workspaces WHERE id=?", (piece["workspace_id"],)).fetchone()
            conversation = self._conversation_of(db, workspace["id"])
            db.execute("SAVEPOINT clock_notice")
            try:
                if conversation is None or not self._health_author(db):
                    raise Refusal("CLOCK_NOTICE_UNAVAILABLE", "The outcome has no usable notice destination")
                numbers = [r[0] for r in db.execute("SELECT number FROM pipeline_piece_members WHERE piece_id=? ORDER BY number", (piece["id"],))]
                elapsed = (actual["occurred_ms"] if actual is not None else now) - forecast["anchor"]["ms"]
                text = ("Forecast for piece %s (%s), %s, %s more than one hour late. Original deadline %d; "
                        "elapsed from its original anchor %dms. Current revision%d, deadline%d: %s. "
                        "This is one notice; the original forecast and every revision remain on the clock.") % (
                            piece["id"], ",".join(str(n) for n in numbers), forecast["milestone"],
                            "was" if actual is not None else "is", first["deadline_ms"],
                            elapsed, current["revision"], current["deadline_ms"], current["reason"])
                result, _ = self._publish(db, "theseus", "clock-slip:" + piece["id"] + ":" + forecast["id"], conversation["id"],
                                          {"body": text, "attachments": [], "quotes": [], "addressees": [workspace["owner_id"]], "intent": "tell"},
                                          topic=conversation)
                forecast["notice"] = {"message_id": result["message_id"], "recorded_ms": now, "linked": False}
                forecast.pop("notice_error", None)
                self._clock_save(db, workspace["id"], state, {"kind": "slip_notice", "forecast_id": forecast["id"], "recorded_ms": now, "message_id": result["message_id"]})
            except Refusal as error:
                db.execute("ROLLBACK TO clock_notice")
                # Publication was rolled back. Keep the due intent and bounded
                # failure category; no delivered claim and no history growth.
                state = self._clock_state(db, entry["piece_id"])
                forecast = next(r for r in state["forecasts"] if r["id"] == entry["forecast_id"])
                forecast["notice_error"] = {"code": error.code, "attempted_ms": now}
                put(db, PREFIX + state["piece_id"], state)
                remaining.append(dict(entry, due_ms=now+60000))
            finally:
                db.execute("RELEASE clock_notice")
            changed = True
        if changed:
            put(db, DUE, sorted(remaining, key=lambda r: (r["due_ms"], r["piece_id"], r["forecast_id"])))
        return changed

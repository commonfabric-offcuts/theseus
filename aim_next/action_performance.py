from __future__ import annotations

"""Bounded private observations, never authority for an action's outcome."""
import json
import hashlib
import math
import re

from .contract import Refusal, _json

HOUR = 3600000
MAX_RECORDS = 256
MAX_PHASES = 32
MAX_BYTES = 4096
PREFIX = "tab_performance:"
KINDS = {"thumb", "send", "reply_open", "idle"}
OUTCOMES = {"running", "complete", "failed", "incomplete"}
FAILURES = {None, "transport", "storage", "refused", "retired", "timeout", "unsupported", "cancelled", "unknown"}
PHASES = {"input", "session_queue", "journal_queue", "journal_put", "journal_transaction", "api_queue",
          "fetch_dispatch", "response_headers", "response_decoded", "api_busy_wait", "journal_backend", "server_admission", "server_store",
          "thumb_pending_dom", "thumb_confirmed_dom", "send_pending_dom", "send_canonical_dom", "composer_settled",
          "reply_focused", "frame1", "frame2", "followup_read", "action_end", "idle_gap", "resource_stall"}
IDENTITY = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
BUILD = re.compile(r"[A-Za-z0-9_.-]{1,128}\Z")


def require(ok):
    if not ok:
        raise Refusal("INVALID_ARGUMENT", "Use a bounded private action timing record")


def number(value, maximum=HOUR, optional=False):
    return optional and value is None or type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def identity(value, optional=False):
    return optional and value is None or type(value) is str and IDENTITY.fullmatch(value) is not None


def validate(row):
    fields = {"v", "id", "tab", "sequence", "kind", "build", "started_ms", "elapsed_ms", "outcome", "operations", "submission",
              "burden", "phases", "support", "overhead_ms", "dropped_phases", "lost_records", "report_failures", "counts", "long_tasks", "idle", "failure"}
    require(type(row) is dict and set(row) == fields)
    require(type(row["v"]) is int and row["v"] == 1 and identity(row["id"]) and identity(row["tab"]))
    require(type(row["sequence"]) is int and 0 < row["sequence"] < 2147483648)
    require(type(row["kind"]) is str and row["kind"] in KINDS and type(row["outcome"]) is str and row["outcome"] in OUTCOMES)
    require(type(row["build"]) is str and BUILD.fullmatch(row["build"]) is not None)
    require(type(row["started_ms"]) is int and 0 <= row["started_ms"] < 100000000000000)
    require(number(row["elapsed_ms"]) and number(row["overhead_ms"]))
    require(type(row["dropped_phases"]) is int and 0 <= row["dropped_phases"] <= 10000000)
    require(all(type(row[k]) is int and 0 <= row[k] <= 10000000 for k in ("lost_records", "report_failures")))
    require(type(row["failure"]) in (str, type(None)) and row["failure"] in FAILURES)
    require(type(row["operations"]) is list and len(row["operations"]) <= 8 and all(identity(v) for v in row["operations"]))
    require(len(set(row["operations"])) == len(row["operations"]) and identity(row["submission"], optional=True))
    burden = row["burden"]
    require(type(burden) is dict and set(burden) == {"loaded_messages", "retained_messages", "rendered_cards", "window_limit"})
    require(all(type(v) is int and 0 <= v <= 10000000 for v in burden.values()))
    support = row["support"]
    require(type(support) is dict and set(support) == {"long_tasks", "resource_timing", "frames"} and all(type(v) is bool for v in support.values()))
    counts = row["counts"]
    require(type(counts) is dict and set(counts) == {"backend_puts", "journal_writes", "journal_transactions", "requests", "retries"})
    require(all(type(v) is int and 0 <= v <= 10000000 for v in counts.values()))
    tasks, idle = row["long_tasks"], row["idle"]
    require(type(tasks) is dict and set(tasks) == {"count", "duration_ms"} and type(tasks["count"]) is int and 0 <= tasks["count"] <= 10000000 and number(tasks["duration_ms"]))
    require(type(idle) is dict and set(idle) == {"samples", "maximum_gap_ms"} and type(idle["samples"]) is int and 0 <= idle["samples"] <= 10000000 and number(idle["maximum_gap_ms"], optional=True))
    require(type(row["phases"]) is list and len(row["phases"]) <= MAX_PHASES)
    for phase in row["phases"]:
        require(type(phase) is dict and set(phase) == {"name", "at_ms", "duration_ms", "request", "operation", "clock"})
        require(type(phase["name"]) is str and phase["name"] in PHASES and phase["clock"] in ("browser", "server"))
        require(number(phase["at_ms"]) and number(phase["duration_ms"], optional=True))
        require(identity(phase["request"], optional=True) and identity(phase["operation"], optional=True))
    require(len(_json(row).encode("utf-8")) <= MAX_BYTES)
    return json.loads(_json(row))


def state(db, actor):
    saved = db.execute("SELECT value FROM metadata WHERE key=?", (PREFIX + actor + ":index",)).fetchone()
    return json.loads(saved[0]) if saved else {"records": [], "cap_dropped": 0, "expired": 0}


def current(value, now):
    kept = [row for row in value["records"] if now - HOUR <= row["received_ms"] <= now]
    return dict(value, records=kept, expired=value["expired"] + len(value["records"]) - len(kept))


def health(db, actor, now):
    value = current(state(db, actor), now)
    rows = []
    for ref in value["records"]:
        saved = db.execute("SELECT value FROM metadata WHERE key=?", (PREFIX + actor + ":row:" + ref["key"],)).fetchone()
        if saved is not None:
            rows.append(json.loads(saved[0]))
    counts = {key: sum(row["outcome"] == key for row in rows) for key in sorted(OUTCOMES)}
    tabs = {}
    for row in rows:
        tab = tabs.setdefault(row["tab"], {"lost_records": 0, "report_failures": 0})
        for key in tab:
            tab[key] = max(tab[key], row[key])
    return dict(local_lost=sum(v["lost_records"] for v in tabs.values()), report_failures=sum(v["report_failures"] for v in tabs.values()),
                by_kind={kind: sum(r["kind"] == kind for r in rows) for kind in sorted(KINDS)}, counts=counts, retained=len(rows), cap_dropped=value["cap_dropped"], expired=value["expired"],
                window_start_ms=min((r["received_ms"] for r in rows), default=None), window_end_ms=now,
                retention_ms=HOUR, record_limit=MAX_RECORDS, source="own-tab observations",
                slowest=sorted(rows, key=lambda r: (-r["elapsed_ms"], r["tab"], r["id"]))[:5],
                unfinished=sorted((r for r in rows if r["outcome"] in ("running", "incomplete")), key=lambda r: -r["received_ms"])[:5])


class ActionPerformance:
    def _command_performance_record(self, db, actor, envelope):
        from .delivery import _now_ms
        require(envelope["target"] == {} and set(envelope["args"]) == {"records"})
        records = envelope["args"]["records"]
        require(type(records) is list and 1 <= len(records) <= 16)
        records = [validate(row) for row in records]  # Validate the entire batch before any write.
        require(len({(r["tab"], r["id"]) for r in records}) == len(records))
        now = _now_ms()
        original = state(db, actor)
        value = current(original, now)
        refs = {ref["key"]: ref for ref in value["records"]}
        accepted = 0
        for row in records:
            key = hashlib.sha256(_json([row["tab"], row["id"]]).encode("utf-8")).hexdigest()
            old = refs.get(key)
            if old is None or row["sequence"] > old["sequence"]:
                db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           (PREFIX + actor + ":row:" + key, _json(dict(row, received_ms=now))))
                refs[key] = dict(key=key, sequence=row["sequence"], received_ms=now)
                accepted += 1
        ordered = sorted(refs.values(), key=lambda ref: (ref["received_ms"], ref["key"]))
        value["cap_dropped"] += max(0, len(ordered) - MAX_RECORDS)
        value["records"] = ordered[-MAX_RECORDS:]
        kept = {ref["key"] for ref in value["records"]}
        discarded = ({ref["key"] for ref in original["records"]} | set(refs)) - kept
        for key in discarded:
            db.execute("DELETE FROM metadata WHERE key=?", (PREFIX + actor + ":row:" + key,))
        if accepted or value != original:
            db.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (PREFIX + actor + ":index", _json(value)))
        return {"accepted": accepted, "retained": len(value["records"])}, []

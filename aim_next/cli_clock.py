from __future__ import annotations

"""Bound CLI clock adapters; recording and reading share the public Core ABI."""

import json
import subprocess
import time


def register(verb):
    verb("clock").add_argument("piece")
    record = verb("clock-record")
    record.add_argument("piece")
    record.add_argument("--expected", type=int, required=True)
    record.add_argument("--operation")
    record.add_argument("file")
    predictions = verb("predictions")
    predictions.add_argument("outcome")
    predictions.add_argument("--pieces", required=True)
    predictions.add_argument("--from-ms", type=int)
    predictions.add_argument("--until-ms", type=int)
    predictions.add_argument("--work-class", choices=("page", "core", "database"))
    run = verb("clock-run")
    run.add_argument("piece")
    run.add_argument("--attempt", required=True)
    run.add_argument("--source", required=True)
    run.add_argument("--source-revision", required=True, type=int)
    run.add_argument("--phase", choices=("test", "command"), default="test")
    run.add_argument("--timeout", type=int, default=1800)
    run.add_argument("--argv", required=True, help="JSON array of command arguments; no shell")


def _ms():
    return int(time.time() * 1000)


class ClockVerbs:
    def do_clock(self):
        answer = self.view("pipeline_clock", {"piece_id": self.options.piece})
        clock = answer["clock"]
        self.out.plain("%s · %s · lane %s · clock revision%d" % (self.options.piece, clock["estimate_status"], clock["lane"] or "unassigned", answer["record"]["revision"]))
        for key, label in (("first_build", "first Build"), ("first_push", "first push"), ("first_live", "recorded live")):
            value = clock[key]
            self.out.plain("  %s: %s" % (label, "unavailable" if value is None else value.get("entered_ms", value.get("occurred_ms"))))
        self.out.plain("  original Build-entry live prediction: " + clock["original_prediction_status"])
        for forecast in clock["forecasts"]:
            self.out.plain("  %s %s: original%d, current%d (%s)" % (forecast["id"], forecast["milestone"],
                           forecast["original"]["deadline_ms"], forecast["current"]["deadline_ms"], forecast["status"]))

    def do_clock_record(self):
        try:
            event = json.loads(self.read_file(self.options.file, 65536))
        except (ValueError, UnicodeError):
            self.refuse("INVALID_ARGUMENT", "A clock event is one JSON object")
        if not isinstance(event, dict):
            self.refuse("INVALID_ARGUMENT", "A clock event is one JSON object")
        result = self.command("pipeline.clock_record", {"piece_id": self.options.piece}, event,
                              {"clock_revision": self.options.expected}, operation=self.operation_of())
        self.read_back("pipeline_clock", {"piece_id": self.options.piece}, result,
                       lambda answer: answer["record"]["revision"] >= result["clock_revision"])
        self.out.plain("recorded clock revision%d" % result["clock_revision"])

    def do_predictions(self):
        options = self.options
        args = {"workspace_id": options.outcome, "piece_ids": options.pieces.split(",")}
        for name in ("from_ms", "until_ms", "work_class"):
            if getattr(options, name) is not None:
                args[name] = getattr(options, name)
        answer = self.view("pipeline_predictions", args)
        self.out.plain("Explicit cohort: %s" % ", ".join(args["piece_ids"]))
        for item in answer["items"]:
            self.out.plain("%s: %s; Build→live %s; original live prediction %s" % (
                item["piece_id"], item["estimate_status"], item["build_to_live_ms"] if item["build_to_live_ms"] is not None else "unavailable",
                item["original_prediction_status"]))
        self.out.plain(json.dumps(answer["counts"], sort_keys=True))
        if answer["worst"]:
            self.out.plain("Worst piece: %s (%dms)" % (answer["worst"]["piece_id"], answer["worst"]["build_to_live_ms"]))

    def do_clock_run(self):
        options = self.options
        try:
            argv = json.loads(options.argv)
        except (ValueError, TypeError):
            self.refuse("INVALID_ARGUMENT", "--argv is a JSON array; no shell is used")
        if (not isinstance(argv, list) or not 1 <= len(argv) <= 64
                or any(not isinstance(a, str) or not a or len(a) > 4096 or "\0" in a for a in argv)
                or not 1 <= options.timeout <= 3600):
            self.refuse("INVALID_ARGUMENT", "Name a bounded direct command and timeout1to3600seconds")
        current = self.view("pipeline_clock", {"piece_id": options.piece})
        if any(r["id"] == options.attempt for r in current["record"]["intervals"]):
            self.refuse("CLOCK_EVENT_EXISTS", "This physical attempt already exists; reconcile its interval and saved operations, without launching another child")
        event = {"kind": "interval", "id": options.attempt, "phase": options.phase, "start_ms": _ms(), "end_ms": None,
                 "source": {"kind": "message", "id": options.source, "revision": options.source_revision}}
        # The durable start precedes spawning. A lost start answer stops here.
        # An interrupted wrapper leaves an open interval and never auto-replays.
        self.command("pipeline.clock_record", {"piece_id": options.piece}, event,
                     {"clock_revision": current["record"]["revision"]})
        code = 1
        try:
            result = subprocess.run(argv, timeout=options.timeout, check=False)
            code, terminal = result.returncode, "exit:%d" % result.returncode
        except subprocess.TimeoutExpired:
            code, terminal = 124, "timeout"
        except OSError:
            code, terminal = 127, "spawn_failed"
        current = self.view("pipeline_clock", {"piece_id": options.piece})
        self.command("pipeline.clock_record", {"piece_id": options.piece}, dict(event, end_ms=_ms(), terminal=terminal),
                     {"clock_revision": current["record"]["revision"]})
        self.out.plain("physical attempt %s: %s; direct-child wrapper interval recorded" % (options.attempt, terminal))
        self.exit = code if code >= 0 else 128-code

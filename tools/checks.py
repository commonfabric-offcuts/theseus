#!/usr/bin/python3 -I
from __future__ import annotations

"""A release check's summary as a run of an outcome's checks, and what it made worse (items 12 and 104; docs/targets.md).

Usage: tools/checks.py run --summary SUMMARY.json --live LIVE.json [--base BASE_SUMMARY.json] [--note TEXT] > RUN.json
       tools/checks.py worse --run RUN.json --live LIVE.json

LIVE.json is the outcome's `outcome_live` view (the deploy reads it from the
live instance): its checks, the live baseline and the owner's allowances for
the commit. `run` prints the run the deploy records with
`bin/aim-next-admin record-checks`; `worse` prints what got worse against the
live baseline and exits 1 when anything not allowed or accepted did. One rule,
outcome_rules.regressions(), decides it, as it does on the outcome page.
"""

import argparse
import datetime
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aim_next import check_reading, outcome_rules


def _ms(text):
    return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)


def tools_of(summary):
    """The tools that produced a summary's readings, as far as the summary names them."""
    tools = {"release-check": summary.get("tool") or "theseus-release-check"}
    if summary.get("chrome"):
        tools["chrome"] = Path(summary["chrome"]).parent.parent.parent.name or summary["chrome"]
    return tools


def run_from_summary(summary, checks, outcome, note=""):
    steps = check_reading.steps_of(summary)
    started, finished = _ms(summary["started_at"]), _ms(summary["finished_at"])
    return {"outcome": outcome, "commit": summary["commit"], "started_at": summary["started_at"], "finished_at": summary["finished_at"],
            "tools": tools_of(summary), "steps": steps, "note": note,
            "readings": check_reading.readings(checks, steps, started, finished)}


def fix_title(item):
    """The fix topic's title for one worse result (D16): the check and what happened."""
    return "%s: %s" % (item.get("name") or item["check_id"], item["why"])


def worse(run, live):
    """What the run made worse against the live baseline, with the owner's allowances."""
    checks = live["checks"]
    now = {reading["check_id"]: dict(reading, tools=run.get("tools") or {}) for reading in run.get("readings", [])}
    base = {check_id: dict(reading, tools=(live.get("live") or {}).get("tools") or {}) for check_id, reading in (live.get("readings") or {}).items()}
    rerun = {}
    if run.get("base"):
        rerun = {reading["check_id"]: dict(reading, tools=run["base"].get("tools") or {}) for reading in run["base"].get("readings", [])}
    names = {check["check_id"]: check["name"] for check in checks}
    found = outcome_rules.regressions(checks, base, now, live.get("allowances") or [], rerun, run.get("commit"))
    return [dict(item, name=names.get(item["check_id"], item["check_id"])) for item in found["worse"]]


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tools/checks.py")
    verbs = parser.add_subparsers(dest="verb", required=True)
    make = verbs.add_parser("run")
    make.add_argument("--summary", required=True)
    make.add_argument("--live", required=True)
    make.add_argument("--base")
    make.add_argument("--note", default="")
    judge = verbs.add_parser("worse")
    judge.add_argument("--run", required=True)
    judge.add_argument("--live", required=True)
    options = parser.parse_args(argv)
    live = json.loads(Path(options.live).read_text(encoding="utf-8"))
    if options.verb == "run":
        run = run_from_summary(json.loads(Path(options.summary).read_text(encoding="utf-8")), live["checks"], live["workspace_id"], options.note)
        if options.base:
            base = run_from_summary(json.loads(Path(options.base).read_text(encoding="utf-8")), live["checks"], live["workspace_id"], "rerun of the live release")
            run["base"] = {key: base[key] for key in ("commit", "started_at", "finished_at", "tools", "steps", "note", "readings")}
        sys.stdout.write(json.dumps(run, indent=1) + "\n")
        return 0
    found = worse(json.loads(Path(options.run).read_text(encoding="utf-8")), live)
    sys.stdout.write(json.dumps({"worse": found, "titles": [fix_title(item) for item in found]}, indent=1) + "\n")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/python3 -I
from __future__ import annotations

"""Run one native browser mode, optionally only the cases a filter selects, and summarise its failures.

Usage: tools/native.py --out ABSOLUTE_DIR [--chrome PATH] [--node PATH] STEP [CASE_FILTER]

STEP is a native step name from tools/release_check.py (journal, live, colors,
openings, reader-keyboard, ...). This is for development; a release runs
every step through tools/release_check.py.
"""

import collections
import json
from pathlib import Path
import shutil
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import release_check


def digest(report):
    """Each failed case with its most common failure kinds, from a harness results file."""
    lines = []
    for result in report.get("results") or []:
        if result.get("mutationCaught") if result.get("expectedFailure") else result.get("passed"):
            continue
        lines.append("FAILED %s" % str(result.get("name"))[:70])
        error = str(result.get("error") or result.get("instrumentError") or "")
        kinds = collections.Counter()
        for line in error.split("\n"):
            if line.startswith("{"):
                try:
                    fact = json.loads(line)
                except ValueError:
                    continue
                if isinstance(fact, dict):
                    kinds[(fact.get("kind"), str(fact.get("at", ""))[:80])] += 1
        lines.extend("    %d %s" % (count, kind) for kind, count in kinds.most_common(8))
        if not kinds:
            lines.append("    " + error[:500])
    return lines


def main(argv=None):
    import argparse
    steps = {step.name: step for step in release_check.NATIVE_STEPS}
    parser = argparse.ArgumentParser(description="Run one native browser mode.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--chrome")
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("step", choices=sorted(steps))
    parser.add_argument("case_filter", nargs="?")
    args = parser.parse_args(argv)
    step = steps[args.step]
    try:
        chrome = release_check.chrome_path(args.chrome)
        if not args.out.is_absolute() or (args.out.exists() and any(args.out.iterdir())):
            raise release_check.Refused("--out must be a fresh absolute directory: %s" % args.out)
        if args.case_filter is not None and step.harness == release_check.READER:
            raise release_check.Refused("%s takes no case filter" % step.harness)
    except release_check.Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 2
    evidence = args.out / "evidence"
    evidence.mkdir(parents=True)
    argv = [args.node, step.harness, chrome, str(evidence)] + list(step.flags)
    if args.case_filter is not None:
        argv.append(args.case_filter)
    result = release_check.run_step(
        "native-" + step.name, argv, release_check.REPO, args.out,
        lambda text: release_check.native_counts(step, evidence), step.harness)
    try:
        report = json.loads((evidence / step.results).read_text())
    except (OSError, ValueError):
        report = {}
    for line in digest(report):
        print(line)
    print("%s exit %s %s" % (step.name, result["exit"], args.out))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

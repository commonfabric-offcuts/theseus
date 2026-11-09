#!/usr/bin/python3 -I
from __future__ import annotations

"""Show that every act in an act ledger has a check that fails when the act breaks.

Usage: tools/acts.py LEDGER --evidence ABSOLUTE_DIR [--only REGEX]

A ledger (tests/acts.json) lists the acts a release shipped, each with the
item it came from, a break that stops the act at the code that does it, and
the check that must then fail: a node test file, a Python test file, or a
native browser mode with a case filter. Each act goes through
tools/mutant.py: the break is applied, the check runs and must fail on an
assertion (a browser case on a FAILED line), the files are restored, and the
check runs again and must pass. --only runs the acts whose item number or
words match. Exit 0 when every act's break was caught; 1 when one survived,
its control failed or its break no longer applies (named on its line).
"""

import json
import os
from pathlib import Path
import re
import shutil
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import mutant

REPO = Path(__file__).resolve().parents[1]
# A browser case fails as tools/native.py reports it: a "FAILED <case>" line.
NATIVE_KILLED_BY = r"^FAILED "


def command(check, evidence, node=None, python=None):
    """The check's command and the line that counts as its failure."""
    if set(check) == {"node"}:
        return [node or shutil.which("node") or "node", "--test", check["node"]], mutant.KILLED_BY
    if set(check) == {"python"}:
        return [python or sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", check["python"]], mutant.KILLED_BY
    if set(check) == {"native", "case"}:
        # tools/native.py takes a fresh output folder for each run, and the mutant and its control are two runs.
        run = 'out=$(mktemp -d "$1/native.XXXXXX") && exec "$2" tools/native.py --out "$out/run" "$3" "$4"'
        return ["/bin/sh", "-c", run, "native", str(evidence), python or sys.executable, check["native"], check["case"]], NATIVE_KILLED_BY
    raise ValueError("a check is {node}, {python} or {native, case}, not %r" % sorted(check))


def run(ledger, evidence, only=None, node=None, python=None, root=REPO):
    """(act, verdict or refusal words) for each act the filter selects, in the ledger's order, as each is done.

    Each break names its file from root, where the checks run."""
    acts = json.loads(Path(ledger).read_text())["acts"]
    chosen = [act for act in acts if not only or re.search(only, "%s %s" % (act["item"], act["act"]))]
    for number, act in enumerate(chosen, 1):
        place = Path(evidence) / ("%02d-item-%s" % (number, act["item"]))
        place.mkdir(parents=True, exist_ok=True)
        argv, killed_by = command(act["check"], place, node, python)
        try:
            verdict = mutant.mutate([(str(Path(root) / name), old, new) for name, old, new in act["break"]], argv, place,
                                    name="item %s: %s" % (act["item"], act["act"]), killed_by=killed_by)
        except mutant.Refused as refusal:
            verdict = "refused: %s" % refusal
        yield act, verdict


def line(act, verdict):
    if isinstance(verdict, str):
        said = verdict
    elif verdict["ok"]:
        said = "caught: " + verdict["failed_line"]
    elif not verdict["killed"]:
        said = "SURVIVED"
    else:
        said = "caught, but %s" % ("not restored" if not verdict["restored"] else "the check fails without the break")
    return "item %s  %s  %s" % (act["item"], act["act"], said)


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Show that every act in an act ledger has a check that fails when it breaks.")
    parser.add_argument("ledger")
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--only")
    parser.add_argument("--node")
    args = parser.parse_args(argv)
    if not args.evidence.is_absolute():
        print("refused: --evidence must be an absolute folder", file=sys.stderr)
        return 2
    os.chdir(str(REPO))
    results = []
    for act, verdict in run(args.ledger, args.evidence, args.only, args.node):
        print(line(act, verdict), flush=True)
        results.append((act, verdict))
    caught = sum(1 for _, verdict in results if not isinstance(verdict, str) and verdict["ok"])
    print("%d of %d acts caught; evidence in %s" % (caught, len(results), args.evidence))
    return 0 if results and caught == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/python3 -I
from __future__ import annotations

"""Apply a mutant, run the named tests, require a FAILED line, restore, and rerun the tests as a control.

Usage: tools/mutant.py [--name NAME] [--killed-by REGEX] [--evidence DIR]
                       --replace FILE OLD NEW [--replace FILE OLD NEW ...] -- COMMAND [ARG ...]

Each OLD must occur exactly once in its FILE, or nothing is changed. The
command runs with the mutant applied and its own PYTHONPYCACHEPREFIX; it kills
the mutant only by exiting non-zero AND printing a line that matches
--killed-by. The files are then restored byte for byte, and the command runs
again with a fresh PYTHONPYCACHEPREFIX and must pass. Exit 0 means killed,
restored and the control passed; 1 means the mutant survived or the control
failed; 2 means refused before anything changed. Run it in a worktree no one
else is editing: restoring writes the files back as they were at the start.
"""

import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile

# unittest's "FAILED (failures=1)", node's TAP "not ok", and node's spec reporter's cross.
KILLED_BY = r"^\s*(FAILED\b|not ok\b|✖ )"


class Refused(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def plan(replacements):
    """[(path, original bytes, mutated bytes)], or Refused if any OLD is not exactly once in its file."""
    changes, seen = [], {}
    for name, old, new in replacements:
        path = Path(name).resolve()
        if old == new:
            raise Refused("the mutant for %s changes nothing" % name)
        original = seen[path] if path in seen else path.read_bytes() if path.is_file() else None
        if original is None:
            raise Refused("no such file: %s" % name)
        count = original.decode().count(old)
        if count != 1:
            raise Refused("%r occurs %d times in %s, not once" % (old, count, name))
        seen[path] = original.decode().replace(old, new).encode()
        changes.append(path)
    originals = {path: path.read_bytes() for path in dict.fromkeys(changes)}
    return [(path, originals[path], seen[path]) for path in originals]


def run(command, log, cache):
    env = dict(os.environ, PYTHONPYCACHEPREFIX=cache)
    with open(log, "wb") as handle:
        try:
            code = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT,
                                  env=env).returncode
        except OSError as error:
            handle.write(("could not start %r: %s\n" % (command, error)).encode())
            code = None
    return code, Path(log).read_text(errors="replace")


def mutate(replacements, command, evidence, name="mutant", killed_by=KILLED_BY):
    """The verdict as a dict; the files are restored before it returns, whatever happened."""
    changes = plan(replacements)
    evidence = Path(evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    for index, (path, original, _) in enumerate(changes):
        # A copy on disk in case this process is killed before it restores.
        (evidence / ("original-%d-%s" % (index, path.name))).write_bytes(original)
    verdict = {"name": name, "command": command, "files": [str(path) for path, _, _ in changes],
               "started_at": datetime.datetime.now().astimezone().isoformat()}
    previous = signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(128 + signum))
    try:
        for path, original, mutated in changes:
            path.write_bytes(mutated)
        verdict["applied"] = all(path.read_bytes() == mutated for path, _, mutated in changes)
        code, output = run(command, evidence / "mutant.log", tempfile.mkdtemp(prefix="pyc-mutant-", dir=str(evidence)))
    finally:
        for path, original, _ in changes:
            path.write_bytes(original)
        signal.signal(signal.SIGTERM, previous)
    verdict["restored"] = all(digest(path.read_bytes()) == digest(original) for path, original, _ in changes)
    lines = [line for line in output.splitlines() if re.search(killed_by, line)]
    verdict.update(mutant_exit=code, failed_line=lines[0] if lines else None,
                   killed=verdict["applied"] and code not in (0, None) and bool(lines))
    control_code, _ = run(command, evidence / "control.log", tempfile.mkdtemp(prefix="pyc-control-", dir=str(evidence)))
    verdict.update(control_exit=control_code, control_passed=control_code == 0)
    verdict["ok"] = verdict["killed"] and verdict["restored"] and verdict["control_passed"]
    (evidence / "verdict.json").write_text(json.dumps(verdict, indent=1) + "\n")
    return verdict


def main(argv=None):
    import argparse
    argv = sys.argv[1:] if argv is None else argv
    if "--" not in argv:
        print("refused: give the test command after --", file=sys.stderr)
        return 2
    split = argv.index("--")
    parser = argparse.ArgumentParser(description="Apply a mutant, require a FAILED line, restore, rerun.")
    parser.add_argument("--replace", nargs=3, action="append", required=True, metavar=("FILE", "OLD", "NEW"))
    parser.add_argument("--name", default="mutant")
    parser.add_argument("--killed-by", default=KILLED_BY)
    parser.add_argument("--evidence")
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if not command:
        print("refused: give the test command after --", file=sys.stderr)
        return 2
    evidence = args.evidence or tempfile.mkdtemp(prefix="mutant-%s-" % re.sub(r"[^\w-]", "_", args.name))
    try:
        verdict = mutate(args.replace, command, evidence, args.name, args.killed_by)
    except Refused as refusal:
        print("refused: %s" % refusal, file=sys.stderr)
        return 2
    print(json.dumps({key: verdict[key] for key in ("name", "killed", "failed_line", "mutant_exit", "restored",
                                                     "control_exit", "ok")}))
    print("evidence: %s" % evidence)
    return 0 if verdict["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

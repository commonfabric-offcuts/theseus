from __future__ import annotations

"""What a deploy ships, for its release record: the pipeline items its commits name, and the release check's counts.

docs/releases.md is the contract. A change names the items it delivers in a
`Pipeline: 87, 2` trailer of its commit message, read by git's own trailer
rules (the last paragraph, the key in any case); tools/deploy.py reads every
commit between the live HEAD and the commit it deploys, merges included.
"""

import re

NUMBER = re.compile(r"[1-9][0-9]*")
# Release records the repository keeps for releases recorded afterwards (docs/releases.md).
KEPT = "tools/pipeline/releases"
# Fields of one commit in `git log --format`, each Pipeline trailer's value, and the end of each commit.
FIELD, VALUE, END = "\x1f", "\x1d", "\x1e"
LOG_FORMAT = "--format=%H%x1f%s%x1f%(trailers:key=Pipeline,valueonly,separator=%x1d)%x1e"


class Malformed(ValueError):
    """A Pipeline trailer that does not name item numbers."""


def trailer_items(values):
    """The item numbers one commit's Pipeline trailer values name, in order; [] when it has none."""
    items = []
    for value in values.split(VALUE) if values else ():
        parts = [part.strip() for part in value.split(",")]
        if not all(NUMBER.fullmatch(part) for part in parts):
            raise Malformed("Pipeline: %s" % value.strip())
        items.extend(int(part) for part in parts)
    return items


def log_argv(checkout, head, sha):
    """Every commit the deploy ships, oldest first, merges and the commits they bring in included."""
    return ["git", "-C", str(checkout), "log", "--reverse", LOG_FORMAT, "%s..%s" % (head, sha)]


def shipped(log_text):
    """(each item once in the order its commits came, [{commit, subject, items}]) from log_argv's output.

    Raises Malformed naming the commit whose Pipeline trailer does not name item numbers."""
    commits, items = [], []
    for entry in log_text.split(END):
        entry = entry.strip("\n")
        if not entry:
            continue
        commit, subject, values = entry.split(FIELD, 2)
        try:
            named = trailer_items(values)
        except Malformed as error:
            raise Malformed("commit %s (%s) has a trailer %r that does not name pipeline item numbers"
                            % (commit[:12], subject, str(error)))
        commits.append({"commit": commit, "subject": subject, "items": named})
        items.extend(item for item in named if item not in items)
    return items, commits


def measurements(summary):
    """The release check's counts for one release record (docs/releases.md)."""
    steps = {step.get("name"): step.get("counts") or {} for step in summary.get("steps") or [] if isinstance(step, dict)}
    native = {name[len("native-"):]: {"pass": counts.get("pass", 0), "total": counts.get("tests", 0)}
              for name, counts in steps.items() if name.startswith("native-")}
    return {"release_check": {key: summary.get(key) for key in ("commit", "started_at", "finished_at")},
            "python_units": {"tests": steps.get("python-units", {}).get("tests", 0)},
            "node_units": {"tests": steps.get("node-units", {}).get("tests", 0),
                           "pass": steps.get("node-units", {}).get("pass", 0)},
            "native": {"pass": sum(step["pass"] for step in native.values()),
                       "total": sum(step["total"] for step in native.values()), "steps": native}}

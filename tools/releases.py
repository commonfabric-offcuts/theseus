from __future__ import annotations

"""What a deploy ships, for its release record: the pipeline items its commits name, and the release check's counts.

docs/releases.md is the contract. A change names the items it delivers in a
`Pipeline: 87, 2` line of its commit message; tools/deploy.py reads every
commit between the live HEAD and the commit it deploys, merges included.
"""

import re

TRAILER = re.compile(r"^Pipeline:(.*)$", re.M)
NUMBER = re.compile(r"[1-9][0-9]*")
# Fields of one commit in `git log --format`, and the end of each commit.
FIELD, END = "\x1f", "\x1e"
LOG_FORMAT = "--format=%H" + "%x1f" + "%s" + "%x1f" + "%B" + "%x1e"


class Malformed(ValueError):
    """A Pipeline line that does not name item numbers."""


def trailer_items(message):
    """The item numbers every `Pipeline:` line of one commit message names, in order; [] when it has none."""
    items = []
    for value in TRAILER.findall(message):
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

    Raises Malformed naming the commit whose Pipeline line does not name item numbers."""
    commits, items = [], []
    for entry in log_text.split(END):
        entry = entry.strip("\n")
        if not entry:
            continue
        commit, subject, message = entry.split(FIELD, 2)
        try:
            named = trailer_items(message)
        except Malformed as error:
            raise Malformed("commit %s (%s) has a line %r that does not name pipeline item numbers"
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

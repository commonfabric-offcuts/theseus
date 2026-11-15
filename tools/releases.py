from __future__ import annotations

"""What a deploy ships, for its release record: the pipeline items its commits name, and the release check's counts.

docs/releases.md is the contract. A change names the items it delivers in a
`Pipeline: 87, 2` trailer of its commit message, read by git's own trailer
rules (the last paragraph, the key in any case); tools/deploy.py reads every
commit between the live HEAD and the commit it deploys, merges included.

A commit that takes an item back out carries `Train-Item: Revert 412` the same
way. Within the range an item's revert cancels its earlier Pipeline claim, so the
release does not say it shipped and a later release can ship it; a Pipeline
claim after the revert ships it again. Other Train-Item values are display only.
"""

import re

NUMBER = re.compile(r"[1-9][0-9]*")
# Release records the repository keeps for releases recorded afterwards (docs/releases.md).
KEPT = "tools/pipeline/releases"
# Fields of one commit in `git log --format`, each Pipeline (then Train-Item) trailer's value, and the end of each commit.
FIELD, VALUE, END = "\x1f", "\x1d", "\x1e"
LOG_FORMAT = ("--format=%H%x1f%s%x1f%(trailers:key=Pipeline,valueonly,separator=%x1d)"
              "%x1f%(trailers:key=Train-Item,valueonly,separator=%x1d)%x1e")
REVERT = re.compile(r"revert(?:\s+(.*)|$)", re.I | re.S)


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


def trailer_reverts(values):
    """The item numbers one commit's `Train-Item: Revert N, M` trailers name; [] when none does."""
    reverts = []
    for value in values.split(VALUE) if values else ():
        said = REVERT.fullmatch(value.strip())
        if said:
            if not (said.group(1) or "").strip():
                raise Malformed("Train-Item: %s" % value.strip())
            reverts.extend(trailer_items(said.group(1)))
    return reverts


def log_argv(checkout, head, sha):
    """Every commit the deploy ships, oldest first, merges and the commits they bring in included."""
    return ["git", "-C", str(checkout), "log", "--reverse", LOG_FORMAT, "%s..%s" % (head, sha)]


def shipped(log_text):
    """(each item once in the order its commits came, less those a later commit reverts, [{commit, subject, items,
    reverts}]) from log_argv's output.

    Raises Malformed naming the commit whose Pipeline or Train-Item: Revert trailer does not name item numbers."""
    commits, items = [], []
    for entry in log_text.split(END):
        entry = entry.strip("\n")
        if not entry:
            continue
        commit, subject, values, *rest = entry.split(FIELD, 3)
        try:
            named, reverts = trailer_items(values), trailer_reverts(rest[0] if rest else "")
        except Malformed as error:
            raise Malformed("commit %s (%s) has a trailer %r that does not name pipeline item numbers"
                            % (commit[:12], subject, str(error)))
        commits.append({"commit": commit, "subject": subject, "items": named, "reverts": reverts})
        items.extend(item for item in named if item not in items)
        items = [item for item in items if item not in reverts]
    return items, commits


def reverted(commits, flagged=()):
    """[{item, commit, by}]: each revert in the range, by its trailer, then each one the deploy names with --revert
    for a revert made before the trailer rule (commit None)."""
    return ([{"item": item, "commit": commit["commit"], "by": "trailer"} for commit in commits for item in commit["reverts"]]
            + [{"item": item, "commit": None, "by": "flag"} for item in flagged])


def measurements(summary, known_reds=(), reverts=()):
    """The release check's counts for one release record (docs/releases.md), and the known reds the deploy accepted
    (item 178: failed cases the live commit fails too, still counted as failed)."""
    steps = {step.get("name"): step.get("counts") or {} for step in summary.get("steps") or [] if isinstance(step, dict)}
    native = {name[len("native-"):]: {"pass": counts.get("pass", 0), "total": counts.get("tests", 0)}
              for name, counts in steps.items() if name.startswith("native-")}
    return {"release_check": {key: summary.get(key) for key in ("commit", "started_at", "finished_at")},
            "python_units": {"tests": steps.get("python-units", {}).get("tests", 0)},
            "node_units": {"tests": steps.get("node-units", {}).get("tests", 0),
                           "pass": steps.get("node-units", {}).get("pass", 0)},
            "native": {"pass": sum(step["pass"] for step in native.values()),
                       "total": sum(step["total"] for step in native.values()), "steps": native},
            # Item 166: a release whose check skipped the browser modes and the replay says so beside their empty counts.
            **({"skipped": {key: summary["skipped"].get(key) for key in ("live", "why")}} if isinstance(summary.get("skipped"), dict) else {}),
            **({"known_reds": [{key: red[key] for key in ("step", "case", "live_summary", "live_commit", "why")} for red in known_reds]}
               if known_reds else {}),
            # A revert in the range, by trailer or by --revert, with the commit that made it when the trailer says.
            **({"reverts": list(reverts)} if reverts else {})}

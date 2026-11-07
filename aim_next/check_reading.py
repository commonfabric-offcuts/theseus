from __future__ import annotations

"""What a release check measured, as readings of an outcome's checks (3.5; docs/targets.md).

One rule, used by the deploy (tools/checks.py) for a summary it just made and by
the import for the release records written before release 21. A summary missing
a step yields no reading for the checks that read it, so "did not run" sees it.
"""

import datetime


def _ms(text):
    if not text:
        return None
    return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)


def _thousands(number):
    return "{:,}".format(int(number))


def steps_of(summary):
    """The run's steps from a summary: name, cases passed and run, milliseconds, passed."""
    steps = []
    for step in summary.get("steps") or []:
        if not isinstance(step, dict) or not step.get("name"):
            continue
        counts = step.get("counts") or {}
        started, finished = _ms(step.get("started_at")), _ms(step.get("finished_at"))
        entry = {"name": step["name"], "passed": bool(step.get("passed")),
                 "ms": (finished - started) if started is not None and finished is not None else None}
        if isinstance(counts.get("tests"), int):
            entry["total"] = counts["tests"]
            entry["pass"] = counts.get("pass", counts["tests"] if step.get("passed") else 0)
        if isinstance(counts.get("failed"), list) and counts["failed"]:
            entry["failed"] = counts["failed"]
        if isinstance(step.get("series"), dict):
            entry["values"] = step["series"]
        steps.append(entry)
    return steps


def steps_of_measurements(measurements):
    """A release record's measurements (docs/releases.md) as steps; times were not recorded then."""
    steps = []
    python = (measurements.get("python_units") or {}).get("tests")
    if isinstance(python, int):
        steps.append({"name": "python-units", "passed": True, "total": python, "pass": python, "ms": None})
    node = measurements.get("node_units") or {}
    if isinstance(node.get("tests"), int):
        steps.append({"name": "node-units", "passed": node.get("pass", node["tests"]) == node["tests"], "total": node["tests"],
                      "pass": node.get("pass", node["tests"]), "ms": None})
    for name, counts in sorted(((measurements.get("native") or {}).get("steps") or {}).items()):
        steps.append({"name": "native-" + name, "passed": counts.get("pass") == counts.get("total"), "total": counts.get("total"),
                      "pass": counts.get("pass"), "ms": None})
    return steps


def readings(checks, steps, started_ms=None, finished_ms=None):
    """{check_id: reading} for the machine-read checks among `checks`, from a run's steps."""
    by_name = {step["name"]: step for step in steps}
    out = []
    for check in checks:
        source = check["source"]
        if source == "release-check:units":
            python, node = by_name.get("python-units"), by_name.get("node-units")
            if python is None or node is None:
                continue
            passed = python["passed"] and node["passed"]
            out.append({"check_id": check["check_id"], "result": "passed" if passed else "failed",
                        "value": (python.get("total") or 0) + (node.get("total") or 0),
                        "words": "%s server and %s browser-side" % (_thousands(python.get("total") or 0), _thousands(node.get("total") or 0)),
                        "detail": {"parts": {"server": python.get("total"), "browser-side": node.get("total")}}})
        elif source == "release-check:native":
            native = [step for step in steps if step["name"].startswith("native-")]
            if not native:
                continue
            passed = sum(step.get("pass") or 0 for step in native)
            total = sum(step.get("total") or 0 for step in native)
            failed = {step["name"]: step["failed"] for step in native if step.get("failed")}
            every = all(step["passed"] for step in native)
            out.append({"check_id": check["check_id"], "result": "passed" if every else "failed", "value": passed,
                        "words": "%s of %s pass" % (_thousands(passed), _thousands(total)) if every else "%d failing" % (total - passed),
                        "detail": {"pass": passed, "total": total, "failed": failed}})
        elif source == "release-check:deploy-refusals":
            step = by_name.get("deploy-refusals")
            if step is None:
                continue
            out.append({"check_id": check["check_id"], "result": "passed" if step["passed"] else "failed", "value": step.get("pass"),
                        "words": "Refuses every case" if step["passed"] else "A refusal case failed", "detail": {"pass": step.get("pass")}})
        elif source == "release-check:duration":
            if started_ms is None or finished_ms is None:
                continue
            minutes = round((finished_ms - started_ms) / 60000.0, 1)
            out.append({"check_id": check["check_id"], "result": "measured", "value": minutes, "words": "%s minutes" % minutes, "detail": {}})
        elif source == "release-check:wake-replay":
            step = by_name.get("wake-replay")
            if step is None or not isinstance(step.get("values"), dict):
                continue
            series = step["values"]
            lost = sorted(agent for agent, values in series.items() if values.get("lost"))
            worst = max((values.get("median") or 0 for values in series.values()), default=None)
            out.append({"check_id": check["check_id"], "result": "failed" if lost else "measured", "value": worst,
                        "words": ("a wake never came for %s" % ", ".join(lost)) if lost else "slowest agent %.1f s" % (worst or 0),
                        "detail": {"series": series}})
    return out

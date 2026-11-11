from __future__ import annotations

"""Where an outcome stands, for one reader: the outcome light (item 86).

Pure functions of values, with no database: the store reads the facts with
bounded queries (aim_next/outcome_light.py) and hands them in. The server
sends kinds and numbers; the web and the CLI turn them into words
(docs/outcome-light.md).

Four lights, in this order: Waiting on you, Being worked on, Done, Quiet. Only
Waiting on you is lit. No light ever says that nobody is working: Quiet says
since when Theseus last saw something, and that someone may be working on it
outside Theseus.
"""

# How many facts the peek shows, and how many items are named before
# "and N more" (D4's facts, mockup 86).
FACTS_SHOWN = 3
# How many topics past the last hour the scan for "Quiet since" reads before it
# stops and says "Quiet" with no time, rather than a time that may be too early.
LAST_SCAN_MAX = 100
# An outcome made before release 21 has no kind record and reads "to keep"
# until its owner chooses (D41).
KIND_BEFORE_R21 = "keep"

LABELS = {"waiting": "Waiting on you", "built": "Being worked on", "done": "Done", "quiet": "Quiet"}


def _newest(values):
    values = [value for value in values if value is not None]
    return max(values) if values else None


def _light(name, short, unreadable=False):
    return {"light": name, "label": LABELS[name], "short": short, "unreadable": unreadable}


def _topic_work_fact(topic):
    work = topic["work"]
    return {"kind": "topic_work", "topic_id": topic["topic_id"], "title": topic["title"],
            "by": work.get("by"), "how": work.get("how"), "ms": work.get("seen_ms")}


def _by_newest(rows, ms):
    # Newest first; rows with no time last, in the order they came.
    return sorted(rows, key=lambda row: -(ms(row) or 0))


def unreadable(asks, blocking=()):
    """The light when a read after the asks failed: Waiting on you still shows, else no light."""
    if asks:
        answer = stands(asks, None, [], [], {}, True, None, None, blocking)
        answer["light"]["unreadable"] = True
        return answer
    return {"light": {"light": None, "label": None, "short": None, "unreadable": True},
            "lead": {"kind": "unreadable"}, "facts": [], "also": []}


def stands(asks, pipeline, talk, waits, done_facts, has_topics, last, created, blocking=()):
    """The light, its lead, its facts and its also-lines (docs/outcome-light.md).

    asks: [{topic_id, title, by, ms}] open questions to the reader in this
      outcome, newest first.
    pipeline: None while the outcome's pipeline is off; else
      {"now": [{number, title, topic_id, topic_title, work}], "all_shipped",
       "shipped": {count, last_release_ms}, "last_now_work": {...} | None}.
    talk: [{topic_id, title, work}] the outcome's open topics active in the
      last hour, each with its work for this reader (work.py).
    waits: the same, for its open topics that wait on anyone.
    done_facts: {"reached": {by, ms, words} | None, "kind": "keep" | "reach",
      "target_word": "on_target" | ... | None, "checks": {count, last_run_ms} | None}.
    has_topics: whether the outcome has any topic.
    last: {by, how, topic_id, topic_title, title_truncated, ms} the newest activity by others in its
      open topics, or None (none seen, or the scan stopped on its cap).
    created: {by, ms | None}, who started the outcome and when.
    blocking: [{topic_id, blocks: {kind}, ...}] the asks among them that hold a
      piece or a release and still wait on the reader, in the one order
      (blocking.order: a release's first, newest first within each). Waiting
      on you then says what the first blocks, and its topics' questions come
      first, in that order.
    """
    reached = done_facts.get("reached")
    if reached:
        # Reached is final, and closed every topic and wait in it (D42).
        return {"light": _light("done", {"kind": "reached", "ms": reached["ms"]}),
                "lead": dict(reached, kind="reached"), "facts": [], "also": []}

    now = pipeline["now"] if pipeline else []
    now_worked = _by_newest([item for item in now if item["work"]["observed"]], lambda item: item["work"].get("seen_ms"))
    now_topics = {item.get("topic_id") for item in now}
    open_topics = {topic["topic_id"]: topic for topic in waits + talk}
    worked_topics = _by_newest([topic for topic in open_topics.values() if topic["work"]["observed"]],
                               lambda topic: topic["work"].get("seen_ms"))
    outside_now = [topic for topic in _by_newest([topic for topic in talk if topic["work"]["observed"]],
                                                 lambda topic: topic["work"].get("seen_ms"))
                   if topic["topic_id"] not in now_topics]

    if asks:
        also = []
        if pipeline and now_worked:
            also.append({"kind": "also_built", "seen": len(now_worked), "of": len(now)})
        short = {"kind": "asks", "count": len(asks)}
        facts = [dict(ask, kind="ask") for ask in asks]
        if blocking:
            # What it blocks rides on the same kind, so a page that knows no more says Waiting on you as before.
            # Its topics' questions come first in blocking's own order (blocking.order), the one the lead names first,
            # so "the first" on the card is the question whose kind the lead says; the rest stay newest first.
            short["blocking"] = blocking[0]["blocks"]["kind"]
            by_topic = {fact["topic_id"]: fact for fact in facts}
            held = {}
            for ask in blocking:
                held.setdefault(ask["topic_id"], ask["blocks"])
            facts = ([dict(by_topic[topic], blocking=blocks) for topic, blocks in held.items() if topic in by_topic]
                     + [fact for fact in facts if fact["topic_id"] not in held])
        return {"light": _light("waiting", short), "lead": dict(short), "facts": facts, "also": also}

    if pipeline and now_worked:
        facts = [{"kind": "item_work", "item": item["number"], "title": item["title"], "by": item["work"].get("by"),
                  "how": item["work"].get("how"), "ms": item["work"].get("seen_ms")} for item in now_worked[:FACTS_SHOWN]]
        if len(now_worked) > FACTS_SHOWN:
            facts.append({"kind": "more_items", "numbers": sorted(item["number"] for item in now_worked[FACTS_SHOWN:])})
        also = []
        if outside_now:
            work = outside_now[0]["work"]
            also.append({"kind": "outside_now", "by": work.get("by"), "how": work.get("how"),
                         "topic_title": outside_now[0]["title"], "ms": work.get("seen_ms")})
        unshipped = [item["number"] for item in now]
        if (done_facts.get("kind") == "keep" and done_facts.get("target_word") == "on_target"
                and done_facts.get("checks") and pipeline.get("shipped")):
            also.append({"kind": "done_again_when", "shipped": pipeline["shipped"]["count"],
                         "checks": done_facts["checks"]["count"], "waiting_on": sorted(unshipped)})
        return {"light": _light("built", {"kind": "seen", "ms": _newest(item["work"].get("seen_ms") for item in now_worked)}),
                "lead": {"kind": "now_work", "seen": len(now_worked), "of": len(now)}, "facts": facts, "also": also}

    if not pipeline and worked_topics:
        return {"light": _light("built", {"kind": "seen", "ms": _newest(topic["work"].get("seen_ms") for topic in worked_topics)}),
                "lead": {"kind": "topics_work"}, "facts": [_topic_work_fact(topic) for topic in worked_topics], "also": []}

    # Done means one thing per kind (D43): an outcome to keep is Done on target
    # with everything shipped; an outcome to reach only when Reached, above.
    if (done_facts.get("kind") == "keep" and done_facts.get("target_word") == "on_target"
            and (not pipeline or pipeline.get("all_shipped"))):
        facts = []
        if pipeline and pipeline.get("shipped"):
            facts.append({"kind": "all_shipped", "count": pipeline["shipped"]["count"],
                          "last_release_ms": pipeline["shipped"].get("last_release_ms")})
        if done_facts.get("checks"):
            facts.append({"kind": "checks_pass", "count": done_facts["checks"]["count"],
                          "last_run_ms": done_facts["checks"].get("last_run_ms")})
        return {"light": _light("done", {"kind": "checks_pass"}), "lead": {"kind": "done", "pipeline": bool(pipeline)},
                "facts": facts, "also": []}

    if not has_topics:
        return {"light": _light("quiet", {"kind": "no_topics"}), "lead": {"kind": "no_topics"},
                "facts": [dict(created, kind="created")], "also": []}

    stalled = {"kind": "may_be_stalled"}
    if pipeline:
        last_now = pipeline.get("last_now_work")
        since_ms = last_now["ms"] if last_now else None
        if outside_now:
            work = outside_now[0]["work"]
            also = ([dict(last_now, kind="last_now_work")] if last_now else []) + [stalled]
            return {"light": _light("quiet", {"kind": "talk", "ms": work.get("seen_ms"), "how": work.get("how"), "since_ms": since_ms}),
                    "lead": {"kind": "now_quiet_talk", "of": len(now), "since_ms": since_ms,
                             "talk_ms": work.get("seen_ms"), "how": work.get("how")},
                    "facts": [_topic_work_fact(topic) for topic in outside_now], "also": also}
        return {"light": _light("quiet", {"kind": "since", "ms": since_ms}),
                "lead": {"kind": "now_quiet", "of": len(now), "ever": last_now is not None},
                "facts": [dict(last_now, kind="last_now_work")] if last_now else [], "also": [stalled]}

    return {"light": _light("quiet", {"kind": "since", "ms": last["ms"] if last else None}),
            "lead": {"kind": "topics_quiet"},
            "facts": [dict(last, kind="last_activity")] if last else [], "also": [stalled]}


# ---------------------------------------------------------------------------
# The pipeline (item 84; docs/pipeline.md): an item's glyph, a stage's words
# and a stage's typical time, each a function of values.

# How far back "typical" looks, and how few past visits are too few (D2).
TYPICAL_WINDOW = 20
TYPICAL_MIN = 3
TYPICAL_LOOSE_BELOW = 5
# How many of an item's sources a page carries; the record shows them all.
SOURCES_SHOWN = 32
# How many stages one outcome may define.
STAGES_MAX = 16

GLYPHS = ("building", "next", "idle", "decide", "shipped", "dropped")


def glyph(section, shipped, open_asks, in_stage):
    """An item's glyph for one reader (6.1): shipped, dropped, a question to the
    reader about it, being built (its piece is in a stage), next, or idle. A
    record naming an item already dropped overtakes the drop, so shipped wins."""
    if shipped:
        return "shipped"
    if section == "dropped":
        return "dropped"
    if open_asks:
        return "decide"
    if in_stage:
        return "building"
    if section == "next":
        return "next"
    return "idle"


def stage_name(name, rounds, round_number):
    """A stage as a person reads it: "Build", "Build, round 2", "Review, round 1" (6.2)."""
    if rounds == "together":
        return "%s, round %d" % (name, round_number)
    if rounds == "split" and round_number > 1:
        return "%s, round %d" % (name, round_number)
    return name


def median(values):
    """The median; of an even count, the mean of the middle two, rounded to the minute."""
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return int(round((ordered[middle - 1] + ordered[middle]) / 2.0 / 60000.0)) * 60000


def typical(durations_newest_first, basis):
    """A stage's typical time from the newest finished visits (6.3, D2)."""
    window = list(durations_newest_first[:TYPICAL_WINDOW])
    if len(window) < TYPICAL_MIN:
        return {"too_few": len(window), "min": TYPICAL_MIN}
    return {"ms": median(window), "of": len(window), "basis": basis, "loose": len(window) < TYPICAL_LOOSE_BELOW}


# ---------------------------------------------------------------------------
# Targets and checks (item 14), worse (item 12) and the improvement loop (item
# 104; docs/targets.md). Each a function of values: the store reads the
# readings with bounded queries and hands them in.

# A measure counts once it met its target this many rounds in a row (D9).
HOLDING_RELEASES = 2
# How many releases a streak is counted over (5.2).
STREAK_MAX = 50
# How many readings a check carries on the outcome page; Measurements pages further.
READINGS_SHOWN = 8
# Charts: how many on the outcome page, and how many releases each shows (D37).
CHARTS_SHOWN = 6
CHART_RELEASES = 4
# The wake replay cuts idle gaps to this (D33).
REPLAY_IDLE_MAX_MS = 5000
# The words of the four steps every change goes through (D40).
LOOP_STEPS = ("A change is proposed", "It runs this outcome's checks", "Each result lands here, beside release {live}'s",
              "Worse stops it. Otherwise it ships and leaves its checks behind")
KINDS = ("reach", "keep")
STATUSES = ("passing", "failing", "measured", "holding", "not_run", "waiting")


def within(check, value):
    """Whether a measure's value meets its target (lower or higher is better)."""
    target = check.get("target_value")
    if target is None or value is None:
        return None
    return value <= target if check.get("better", "lower") == "lower" else value >= target


def check_status(check, rounds, latest, open_ask):
    """A check's status (6.5).

    rounds: the check's readings one per round, newest first (releases, or runs
      for an outcome without releases), candidates left out.
    latest: the newest reading, a candidate's included, or None.
    open_ask: whether an ask about this check waits on the owner."""
    if open_ask:
        return "waiting"
    if latest is None:
        return "not_run"
    if check["kind"] == "pass":
        return "passing" if latest["result"] == "passed" else "failing"
    if latest["result"] == "failed":
        return "failing"
    if check.get("target_value") is None:
        return "measured"
    if within(check, latest.get("value")) is False:
        return "failing"
    recent = rounds[:HOLDING_RELEASES]
    if len(recent) == HOLDING_RELEASES and all(within(check, reading.get("value")) for reading in recent):
        return "holding"
    return "measured"


def streak(check, rounds):
    """How a holding check has held (5.2): {releases, since_release, every_release_since_first_pass} or None."""
    rounds = rounds[:STREAK_MAX]
    if not rounds:
        return None
    if check["kind"] == "pass":
        held = []
        for reading in rounds:
            if reading["result"] != "passed":
                break
            held.append(reading)
        if not held:
            return None
        ever_failed = len(held) < len(rounds)
        return {"releases": len(held), "since_release": held[-1].get("release"),
                "every_release_since_first_pass": not ever_failed}
    held = []
    for reading in rounds:
        if not within(check, reading.get("value")):
            break
        held.append(reading)
    if len(held) < HOLDING_RELEASES:
        return None
    return {"releases": len(held), "since_release": held[-1].get("release"), "every_release_since_first_pass": False}


def target_word(kind, reached, has_target, statuses):
    """The target's word (6.5, D41): reached, not_there, on_target, not_on_target, or None (no target or no checks, to keep)."""
    if reached:
        return "reached"
    if kind == "reach":
        return "not_there"
    if not has_target or not statuses:
        return None
    if all(status in ("passing", "holding") for status in statuses):
        return "on_target"
    return "not_on_target"


def target_failing(checks, statuses, previous_word):
    """D17: the first failing check by position, named only when the outcome read On target at its previous round."""
    if previous_word != "on_target":
        return None
    for check, status in zip(checks, statuses):
        if status == "failing":
            return check
    return None


def reach_offered(checks, statuses):
    """(offered, unmet) for an outcome to reach (6.5, D42): unmet names each check not met and why."""
    unmet = []
    for check, status in zip(checks, statuses):
        if status == "not_run":
            why = "not_run"
        elif status == "waiting":
            why = "waiting"
        elif status == "failing":
            why = "failing"
        elif check["kind"] == "measure" and check.get("target_value") is None:
            why = "no_target"
        else:
            continue
        unmet.append({"check_id": check["check_id"], "name": check["name"], "why": why})
    return bool(checks) and not unmet, unmet


def rounds_of(ships_in_releases):
    """D9: a round is a release for an outcome whose pipeline ships in releases, else one of its runs."""
    return "releases" if ships_in_releases else "runs"


# ---- worse (6.7, 6.8) --------------------------------------------------------

def slower_in_every_run(base_runs, now_runs, tolerance, better):
    """D29: every candidate run worse than every base run by more than the tolerance; equal to the bound is not worse."""
    if not base_runs or not now_runs:
        return False
    if better == "higher":
        return max(now_runs) < min(base_runs) * (1 - tolerance)
    return min(now_runs) > max(base_runs) * (1 + tolerance)


def comparable(base, now):
    """D32: a base and a reading compare only when the same tools produced them (the deploy's own version aside).

    A key missing on either side is unknown, never a difference."""
    if base is None or now is None:
        return False
    left = {key: value for key, value in (base.get("tools") or {}).items() if key != "deploy"}
    right = {key: value for key, value in (now.get("tools") or {}).items() if key != "deploy"}
    if not left or not right:
        return False
    return left == right


def tools_changed(before, after):
    """The tool keys whose versions differ between two readings; a key missing on either side is not a change."""
    left, right = before or {}, after or {}
    return sorted(key for key in set(left) & set(right) if left[key] != right[key])


def _members(reading):
    series = (reading.get("detail") or {}).get("series")
    if isinstance(series, dict) and series:
        return {member: values for member, values in series.items() if isinstance(values, dict)}
    return None


def _counts(reading):
    detail = reading.get("detail") or {}
    if isinstance(detail.get("pass"), (int, float)):
        return detail["pass"]
    return reading.get("value")


def regressions(checks, base, now, allowances=(), rerun=None, commit=None):
    """What got worse at a candidate (D16, D29, D31, D32).

    checks: current definitions; base: {check_id: reading} the live baseline;
    now: {check_id: reading} the candidate's; rerun: {check_id: reading} the
    base rerun beside the candidate; allowances: the owner's check_allowances
    rows bearing on this candidate. Returns {"worse": [...], "all": [...]}, each
    {check_id, kind ("failed" | "fewer"), why, cases?, missing?, member?, now?, base?, unit?} with
    allowed_by or accepted_by on what an allowance covers."""
    found = []
    rerun = rerun or {}
    for check in checks:
        if check.get("retired_why") or check["source"] in ("found-problems", "reported"):
            continue
        check_id, name = check["check_id"], check["name"]
        before, after = base.get(check_id), now.get(check_id)
        if check["kind"] == "pass":
            if before is None:
                continue
            if after is None:
                found.append({"check_id": check_id, "kind": "fewer", "why": "%s did not run" % name, "missing": True})
            elif before["result"] == "passed" and after["result"] != "passed":
                failed = (after.get("detail") or {}).get("failed") or {}
                cases = [case for names in failed.values() for case in names] if isinstance(failed, dict) else list(failed)
                found.append({"check_id": check_id, "kind": "failed", "why": "a passing check now fails", "cases": cases})
            elif _counts(before) is not None and _counts(after) is not None and _counts(after) < _counts(before):
                found.append({"check_id": check_id, "kind": "fewer", "why": "%s passing, %s at the live release"
                              % (_counts(after), _counts(before)), "now": _counts(after), "base": _counts(before)})
            continue
        # A measure compares only with a base measured by the same tools (D32).
        if after is None:
            if before is not None:
                found.append({"check_id": check_id, "kind": "fewer", "why": "%s did not run" % name, "missing": True})
            continue
        if after["result"] == "failed":
            found.append({"check_id": check_id, "kind": "failed", "why": "%s did not finish: a wake never came" % name})
            continue
        against = rerun.get(check_id)
        if not comparable(against, after):
            found.append({"check_id": check_id, "kind": "fewer", "why": "not compared: measured with other tools than the live release's"})
            continue
        better, tolerance, repeats = check.get("better") or "lower", check.get("tolerance") or 0.0, check.get("repeats") or 1
        members_now, members_base = _members(after), _members(against)
        if members_now and members_base:
            for member in sorted(members_now):
                runs_now, runs_base = members_now[member].get("runs") or [], (members_base.get(member) or {}).get("runs") or []
                if len(runs_now) < repeats or len(runs_base) < repeats:
                    found.append({"check_id": check_id, "kind": "fewer", "member": member,
                                  "why": "%s ran %d of %d times" % (member, min(len(runs_now), len(runs_base)), repeats)})
                elif slower_in_every_run(runs_base, runs_now, tolerance, better):
                    found.append({"check_id": check_id, "kind": "failed", "member": member, "now": _median(runs_now),
                                  "base": _median(runs_base), "unit": check.get("unit", ""),
                                  "why": "%s got worse in every run" % member})
            continue
        value_now, value_base = after.get("value"), against.get("value")
        if value_now is None or value_base is None:
            continue
        if within(check, value_base) and within(check, value_now) is False:
            found.append({"check_id": check_id, "kind": "failed", "now": value_now, "base": value_base, "unit": check.get("unit", ""),
                          "why": "outside its target, where it was inside"})
        elif slower_in_every_run([value_base], [value_now], tolerance, better):
            found.append({"check_id": check_id, "kind": "failed", "now": value_now, "base": value_base, "unit": check.get("unit", ""),
                          "why": "moved the wrong way by more than its rule allows"})
    for item in found:
        for allowance in allowances:
            if allowance["check_id"] != item["check_id"]:
                continue
            if allowance["kind"] == "fewer" and item["kind"] == "fewer" and (item.get("now") is None or item["now"] >= allowance["allowed_count"]):
                item["allowed_by"] = allowance["allowed_by"]
            if (allowance["kind"] == "worse" and item["kind"] == "failed" and commit is not None and allowance["commit_sha"] == commit
                    and _measure(checks, item["check_id"])):
                item["accepted_by"] = allowance["allowed_by"]
    return {"worse": [item for item in found if not item.get("allowed_by") and not item.get("accepted_by")], "all": found}


def _measure(checks, check_id):
    return any(check["check_id"] == check_id and check["kind"] == "measure" for check in checks)


def _median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0


def loosens(before, after):
    """D30: the fields a new definition loosens against the current one; retiring loosens."""
    if before is None:
        return []
    fields = []
    if after.get("retired_why") and not before.get("retired_why"):
        fields.append("retired")
    if (after.get("tolerance") or 0) > (before.get("tolerance") or 0):
        fields.append("tolerance")
    if (after.get("repeats") or 1) < (before.get("repeats") or 1):
        fields.append("repeats")
    if (before.get("better") or None) != (after.get("better") or None) and before.get("better") is not None:
        fields.append("better")
    if before.get("kind") == "measure" and before.get("source", "").startswith("release-check:") and after.get("source") != before.get("source"):
        fields.append("source")
    old, new = before.get("target_value"), after.get("target_value")
    if old is not None:
        better = before.get("better") or "lower"
        if new is None or (new > old if better == "lower" else new < old):
            fields.append("target_value")
    return fields


def trade(checks, base, now):
    """D31: what got worse, and every measure member that moved the right way by more than its own tolerance."""
    worse, better_list = [], []
    for check in checks:
        if check["kind"] != "measure":
            continue
        before, after = base.get(check["check_id"]), now.get(check["check_id"])
        if before is None or after is None:
            continue
        direction, tolerance = check.get("better") or "lower", check.get("tolerance") or 0.0
        pairs = []
        members_now, members_base = _members(after), _members(before)
        if members_now and members_base:
            for member in sorted(members_now):
                runs_now, runs_base = members_now[member].get("runs") or [], (members_base.get(member) or {}).get("runs") or []
                if runs_now and runs_base:
                    pairs.append((member, runs_base, runs_now))
        elif after.get("value") is not None and before.get("value") is not None:
            pairs.append((None, [before["value"]], [after["value"]]))
        for member, runs_base, runs_now in pairs:
            entry = {"check_id": check["check_id"], "name": check["name"], "member": member, "now": _median(runs_now),
                     "base": _median(runs_base), "unit": check.get("unit", "")}
            if slower_in_every_run(runs_base, runs_now, tolerance, direction):
                worse.append(entry)
            elif slower_in_every_run(runs_now, runs_base, tolerance, direction):
                better_list.append(entry)
    return {"worse": worse, "better": better_list}


def likely_cause(stopped_check_ids, trials):
    """D34: the trial with the fewest left-out items that is not worse on any stopped check; ties the earliest."""
    if not trials:
        return None
    clearing = [trial for trial in trials if not (set(trial.get("worse_checks") or []) & set(stopped_check_ids))]
    if not clearing:
        return {"none": True, "tried": [trial["without"] for trial in trials]}
    best = min(enumerate(clearing), key=lambda pair: (len(pair[1]["without"]), pair[0]))[1]
    return {"items": best["without"], "run_id": best["run_id"]}


def step_compare(live_step, now_step):
    """D36: a candidate's step beside the live release's same step."""
    if now_step is None:
        return None
    if not now_step.get("passed", True):
        return "failed"
    if live_step is None:
        return "new"
    live_pass, now_pass = live_step.get("pass"), now_step.get("pass")
    if live_pass is None or now_pass is None or now_pass == live_pass:
        return "same"
    return "more" if now_pass > live_pass else "fewer"


def left_behind(checks, live_readings, previous_readings):
    """D40: the first pass check by position whose case count grew from the release before to the live one."""
    for check in checks:
        if check["kind"] != "pass":
            continue
        now, before = live_readings.get(check["check_id"]), previous_readings.get(check["check_id"])
        if now is None or before is None:
            continue
        if _counts(now) is not None and _counts(before) is not None and _counts(now) > _counts(before):
            return {"check_id": check["check_id"], "name": check["name"], "now": _counts(now), "before": _counts(before)}
    return None


def fraction_words(tolerance):
    """A tolerance in words, never a percentage (9)."""
    words = {0.2: "a fifth", 0.25: "a quarter", 0.5: "a half", 0.1: "a tenth", 0.75: "three quarters"}
    for value, word in words.items():
        if abs(tolerance - value) < 1e-9:
            return word
    tenths = round(tolerance * 10)
    if abs(tolerance * 10 - tenths) < 1e-9 and tenths > 0:
        return "%d tenths" % tenths
    hundredths = round(tolerance * 100)
    return "%d hundredths" % hundredths

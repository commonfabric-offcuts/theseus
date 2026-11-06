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


def unreadable(asks):
    """The light when a read after the asks failed: Waiting on you still shows, else no light."""
    if asks:
        answer = stands(asks, None, [], [], {}, True, None, None)
        answer["light"]["unreadable"] = True
        return answer
    return {"light": {"light": None, "label": None, "short": None, "unreadable": True},
            "lead": {"kind": "unreadable"}, "facts": [], "also": []}


def stands(asks, pipeline, talk, waits, done_facts, has_topics, last, created):
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
    last: {by, how, topic_title, ms} the newest activity by others in its
      open topics, or None (none seen, or the scan stopped on its cap).
    created: {by, ms | None}, who started the outcome and when.
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
        return {"light": _light("waiting", {"kind": "asks", "count": len(asks)}),
                "lead": {"kind": "asks", "count": len(asks)},
                "facts": [dict(ask, kind="ask") for ask in asks], "also": also}

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

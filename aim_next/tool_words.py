from __future__ import annotations

"""Every word about a skill or tool's check (item 17; docs/skills-and-tools.md, "States and words"), built once from
the record and the recorded runs. Pure: the views, the CLI and the topic a version that went back opens all say the
same thing in the same words. Times are not in these words: each reader shows them in its own local time."""

# What a run that counted nothing ran: the step's own why for a check that ran but counted no test.
RAN_NO_TESTS = "it ran no tests"


def counts(passed, total):
    return "%d of %d" % (passed, total)


def live_word(record, row):
    """{state, passed, total, at_ms, words}: what the live version's check found, from the newest recorded run whose
    content id is the live content id (row, or None when none is recorded). A pass needs a recorded count of at least
    one, all passed; anything else is never a pass."""
    if not record.get("check"):
        return {"state": "not_evaluated", "passed": None, "total": None, "at_ms": None, "words": "Not evaluated yet: it has no check"}
    if row is None:
        return {"state": "not_run", "passed": None, "total": None, "at_ms": None, "words": "Its check has not run on this version yet"}
    result, passed, total, at = row["result"], row["passed"], row["total"], row["recorded_ms"]
    if result == "passed" and isinstance(total, int) and total >= 1 and passed == total:
        return {"state": "passed", "passed": passed, "total": total, "at_ms": at, "words": "Its check passed: " + counts(passed, total)}
    if result == "failed" and isinstance(total, int) and total >= 1 and isinstance(passed, int) and 0 <= passed < total:
        return {"state": "failed", "passed": passed, "total": total, "at_ms": at,
                "words": "Its check failed on this version: %s failed" % counts(total - passed, total)}
    return {"state": "counted_nothing", "passed": None, "total": None, "at_ms": at, "words": "Its check ran no tests on this version"}


def failing_names(row):
    """Up to five failing tests by name, then "and N more": "test_a, test_b, test_c"."""
    names = ", ".join(row.get("failing") or [])
    more = row.get("failing_more") or 0
    return names + (" and %d more" % more if more else "")


def found(row):
    """What a check that did not pass found: "3 of 42 failed: test_a, test_b, test_c"."""
    names = failing_names(row)
    return "%s failed" % counts(row["total"] - row["passed"], row["total"]) + (": " + names if names else "")


def what_happened(row):
    """The middle of a went-back line: "failed its check (…)", "ran no tests" or "could not run (why)"."""
    if row["result"] == "failed":
        return "failed its check (%s)" % found(row)
    if row.get("why") == RAN_NO_TESTS:
        return "ran no tests"
    return "could not run (%s)" % row.get("why")


def went_back_words(row):
    """One version that went back: "A new version failed its check (…) and went back to its live version", or for a
    first version "A first version failed its check (…) and did not ship"."""
    if row.get("first_version"):
        return "A first version %s and did not ship" % what_happened(row)
    return "A new version %s and went back to its live version" % what_happened(row)


def topic_title(row):
    return ("%s did not ship" if row.get("first_version") else "%s went back to its live version") % row["name"]


def _items(numbers):
    numbers = [str(number) for number in numbers]
    if len(numbers) == 1:
        return "Item %s was taken back: its other changes still ship, and it goes back to building." % numbers[0]
    listed = ", ".join(numbers[:-1]) + " and " + numbers[-1]
    return "Items %s were taken back: their other changes still ship, and they go back to building." % listed


def topic_message(row):
    """The first message of the topic a version that went back opens, built from the row's fields alone."""
    name, module = row["name"], row["check_path"]
    if row["result"] == "failed":
        names = failing_names(row)
        lines = ["%s's check failed in the release being put together: %s failed%s, in %s." % (
            name, counts(row["total"] - row["passed"], row["total"]), " (%s)" % names if names else "", module)]
    elif row.get("why") == RAN_NO_TESTS:
        lines = ["%s's check ran no tests in the release being put together (%s)." % (name, module)]
    else:
        lines = ["%s's check could not run in the release being put together: %s (%s)." % (name, row.get("why"), module)]
    lines.append("The next release does not carry it." if row.get("first_version") else "The next release carries its live version.")
    if row.get("items_back"):
        lines.append(_items(row["items_back"]))
    lines.append("Fix it and build it again; the next release checks it the same way.")
    return "\n\n".join(lines)

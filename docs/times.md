# Times on the page

Every time the web page shows says it by the viewer's own calendar day, in
their own time zone:

| when it was | shown as |
| --- | --- |
| today | `4:40 AM` |
| yesterday | `Yesterday 9:12 PM` |
| any other day, a later one included | `7:41 AM Thu Nov 5` |

The red New line in a topic says the time of the oldest message the reader
has not replied to in the same form: "New · 4:40 AM" (docs/attention.md).

Today and yesterday are calendar days, not spans of 24 hours: on a day the
clocks change, yesterday is 23 or 25 hours long and still ends at midnight.

One module, `web/times.mjs`, formats every time. A shown time is a `<time>`
element with the instant in `datetime` and the dated form in its `title`. A
title or screen-reader text that carries a time, such as a topic row's
"Activity seen" title or an ask's "since", always uses the dated form, since it
may be read on another day than it was painted.

The words change when the day does. The page sets one timer for the next local
midnight, repaints every shown time when it runs, and sets the next one. That
timer is a wake for an instant known in advance, not a repeated check: nothing
runs between midnights. A machine asleep at midnight runs the timer late, and
the clock or the time zone can change under it, so the page also compares the
day whenever it comes back into view (`visibilitychange`), gains focus, or is
shown again (`pageshow`), and repaints at once when the day has changed.

The CLI (`bin/aim-next`) is for agents and keeps absolute local times, such as
`since 2026-11-05 22:10`: an agent reading a line has no "today" to resolve,
and a log line read later must not change meaning.

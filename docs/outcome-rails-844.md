# Outcome pages keep the shared rails (844)

An outcome home uses the same shell-owned OutlineRail and ThingsRail as a
topic page, including their phone drawers. Its main column keeps the 842
order. The duplicate folded More from this outcome section is removed.

The home supplies its current outcome, API, live feed, Notebook creation and
navigation handles to the shared shell. The outline reads its own topic list
on a home; it must not adopt or remove the topic list in the middle column.
Its current outcome must not be skipped merely because topic pages supply
their own adoptable list.

Existing navigation and writing guards stay in force: entering or leaving an
outcome home still uses the existing document navigation. Topic-to-topic
navigation continues to preserve the shell in place. No new commands, views,
stored state or schema changes. The home has no message feed and therefore
does not supply the feed's optional Unstar action.

Validation is a focused comparison against release 129, with an actual red
check for the shared rail handoff and current-outcome topic read. No browser,
native gesture, full-suite or CI run is claimed.

The selected twelve-family comparison passed 349/349 on actual release 129
and 351/351 on this candidate, with no failures or skips. The two added checks
cover the shell's responsive rail activation without changing navigation, and
the shared outline's own read of the home outcome's topics. Existing outcome
order/reference checks now use the actual right rail, including its image
reader, permission loss and recovery. Old hidden-rail expectations were updated.

Six applied mutations each failed their behavior assertion and each restored
control passed: shell activation, current-outcome topic reads, outline route
admission, page-to-shell handoff, things-rail route admission, and the revoked
access fence. Evidence is in `844-mutations.json`, its script and per-case TAP
files under the auditor evidence directory. The first red run's rails-file
import failed before its assertions; the later actual source mutations cover
those assertions. The first candidate still expected Pipeline to be omitted
from the embedded section; that obsolete expectation now includes the rail's
Pipeline section. All raw runs are retained.

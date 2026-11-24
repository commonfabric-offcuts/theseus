# Moved dossiers panel (1170)

Initial source preparation used release 384, `0e3ce8152ff512db4bbeb8633d17be76844c4e6c`.
The first review packets used release 385,
`8a7383a176f9ea7bd3c83c34dbbe5bf4224cd740`; the original 384 and 385
worktrees and unentered packets are kept. The current unexecuted packet uses
release 386, `baab48753ab43fda5f3dbabbea30073236ca0fc1`, after Warp 21504.
Its only shared-path change is four Notebook title CSS lines appended at the
end of `aim.css`; those remain intact beside our older-rule deletion. All
other prepared paths transferred byte for byte before this metadata update.
No execution evidence or grant transfers from either earlier packet.
All six tracked preimages were identical between those bases, and all twelve
own source/case files transferred byte for byte before this metadata update.
The original twelve-path transfer preceded Warp 21453's source review.
That review approved the runs with one source addition: remove the obsolete
moved-link cleanup loop in `app.mjs` and its `.dossier-moved-pointer` rule in
`aim.css`. The current thirteen-path source includes only that legacy-rule
removal in the stylesheet; the shipped 385 angle-link styles remain intact.
The full app imports those 385 owners, so no 384 execution evidence is implied.
The existing item is Now/Build1, piece `p-4904103a894f43a09dca27b6`, in
topic `t-40a833a41c71740a0fe1a9faaab2fca6` (Fable 21362/21365).

## Selected design and defaults

The default is the designer's **second take**, selected by Tony as forwarded
by Warp 20266. This attribution does not claim a read of the original designer
or Tony messages. The actual local `take2.html` and `take2.png` were read before
code; the served HTML at
`http://100.85.219.84:5195/designer/moved-dossiers/take2.html` equals the local
11,361-byte file, SHA-256
`f753df98f9621d7ba28e7eea65df3e6938a1740e09679c2a35b3d79e80d725b1`.

One `Moved elsewhere N` panel replaces the old individual destination links
where those links already appear. It groups pointers by destination topic,
in first-seen Core order, keeping Core's order within each group. The topic
chip opens that topic; a dossier row opens that moved root in its destination
using the existing topic navigation route and writing guards.

Each row has the Archive shelf's small folder and sheet, its current recorded
dossier name, and the mover and time. Desktop metadata is at the right; at
phone widths it is below the name, with a row at least 44px tall. The panel
uses the theme tokens and the pencil sheet's chip proportions. A group of
four or fewer shows every row. A group of five or more initially shows three
and an `N more` button. Expanding is local to this page and survives a pointer
refresh; reloading returns to the selected design's collapsed default.

An unnamed root is labelled **Unnamed dossier**. The pointer read supplies a
recorded shared name only, never root body excerpts as a fallback. This keeps
the existing pointer read a metadata read rather than making it disclose or
record first exposure to message words. The release must name that limitation.
The mover uses the existing actor directory's display label, falling back to
the actor identifier as other attribution does. Time uses the existing
`timeNode` and its viewer-local calendar and dated tooltip.

## Core contract and authority

`DossierMove._view_dossier_moves` remains the sole owner of the paged pointer
read. Each existing `items[]` row keeps `id`, `root_id`, `topic_id` and the
destination `title`, and gains:

* `actor_id`: the actor of that stored move, not the root author;
* `at_ms`: the same stored move's timestamp;
* `name`: the latest shared `stack.name` words for that root, or null after
  a cleared/missing name.

Names are read only for the already admitted pointer page. The current SQL
`VISIBLE`/`READABLE` predicates, subsequent `_topic`/`_message_access` checks,
latest relevant move selection, return-to-source suppression, arrival records,
membership revision and cursor retain their existing semantics. No new topic,
reader, operation, write, source-body disclosure, move command or schema step
is introduced. A hidden destination or private root provides no row, name,
mover, time or count to an unauthorized reader.

The page consumes only these admitted pointers. Counts never count a hidden
row or an unreturned page. Existing `TopicViews.readMoved` still owns paging
and membership reconciliation. The panel does not fetch message bodies,
write marks or move a dossier. Its DOM is keyed by destination and root so
ordinary refresh does not recreate an expanded group's controls or focused
links. A removed permission/pointer removes its row and empty group.
Names and mover/time are sampled by the existing pointer refresh. This change
does not add a destination-rename subscription or broaden the refresh scope.

## Current owners and source boundary

Core: `aim_next/dossier_move.py`; stored schema and authority are already here.
Page: the moved-pointer block in `web/app.mjs`; pointer acquisition stays in
`web/topic-views.mjs`. A small `web/moved-dossiers.mjs` view and its stylesheet
own this panel. The Archive shelf, actor directory, time formatter and existing
navigation remain their current owners; none is replaced. Shared app changes
are limited to one import, one panel instance and the old pointer block.
The isolated `ui_http.py` controller gains a `stack.move` branch in its existing
`stack_act` control, reading the real source/move fences before that command.
The reading harness registers one new case and retains its added source owners.

## Proposed checks; none executed during source preparation

Core cases use only a temporary `ReaderCase` store and real move commands:
recorded mover/time/name, rename and clear after a move, latest destination and
return, pagination, whispered root privacy and lost destination membership.
The red must fail on missing pointer metadata in the unchanged base; the same
case set is then run on the prepared source. Authority assertions are kept in
both controls.

Node cases exercise the actual panel with the existing minimal DOM: grouping,
three/four/five thresholds, exact row/chip routes, expansion through refresh,
removal after a permission refresh, time/name text and hostile literal labels.
These are modelled DOM checks, not geometry or native gestures.

One separately admitted Chromium cell will use an isolated scratch fixture and
Chrome for Testing, select only the named 1170 case, exercise actual panel
expansion and topic/dossier navigation, preserve unsent writing through the
existing guard, and check desktop/phone widths and both themes. It will retain
the actual selected source/runtime inputs, raw results, direct exit and owned
fixture/Browser.close cleanup. It proves neither physical-device nor WebKit
behaviour. No browser, fixture, helper, Core or Node entry is authorized here.

The browser case uses a cooperative 180-second action budget checked between
the existing bounded operations: CDP calls 10 seconds, screenshots 60 seconds,
fixture calls/exits 60 seconds and polling 8 seconds. Its four view variants
and at most 80 native Tab keys per laptop variant are fixed. Cleanup is the
existing `Browser.close`, Chrome exit, fixture end/exit path. The action budget
is not a promise for total caller wall time including cleanup.

The handoff supplies literal vectors, case counts, source/import/runtime maps,
phase limits and the cumulative ledger before Fable admits any execution.
Current cumulative starts are zero in every category. This Core read change
is routed as a separate judged release unless a later ruling changes that
disposition. Fable owns stage changes and carry; Warp owns independent review
and the landing route.

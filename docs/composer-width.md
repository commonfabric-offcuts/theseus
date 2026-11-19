# Composer width (item 650)

Settled start line: “Drag either side of the composer to set its width; it grows
and shrinks symmetrically, left and right only, and stays centred.” Tony's
original words (Fast Trains #6795, read through the item broker): “drag the
composer's left or right edge to set its width; it grows and shrinks
symmetrically, only left and right, and stays centred.”

The Reader (stacked and Wide) and the New message sheet offer their left and
right outer edges. Moving either edge changes both sides by the same amount
around the window's centre. Height and vertical position keep their existing
rules. Returning to the starting position during one held drag restores the
starting width, including movements back through the origin. The initial size is unchanged. The page clips neither side: width is
bounded by the existing maximum and the window; the minimum leaves room for
the existing composer controls. Width is only a presentation choice in the
open page, never writing, a destination, a send or a private-note action.
Tony #8665 approves the drag feel at 58523903; Warp #8667 requires separate
stacked and Wide widths before shipping and waives another preview. Each
Reader layout keeps its own last chosen outer width for that element's page
lifetime. Switching layouts restores that layout's choice; an unchosen layout
uses its existing default. Close/reopen keeps both choices. New message owns
its separate width. Reload recreates all three choices at their defaults:
at viewport <=760px, viewport width; above it, min(72rem, viewport - 48px)
for stacked/New message and min(100rem, viewport - 48px) for Wide. Existing
mode preference and Wide writing share (.45) retain their separate owners.
There is no Core migration, durable width preference or new preference UI.
The topic's composer resting in the feed and Notebook pages keep their existing
layout; these are not new floating composer surfaces.
The shared Reader reply bar inside a message card (721) also keeps its card's
width. Its edges are hidden, outside Tab order and inactive while embedded.
Returning the same Reader to its full surface restores its edges and chosen
width for that layout without changing writing or ownership.

Each edge has an accessible name, tooltip, visible neutral grip, and a 44px
hit target. Tab reaches both edges (Option-Tab in Safari); Left/Right on the
edge reached through that focus order moves it as dragging would.
A click alone, vertical dragging, and keys other than Left/Right leave width
alone. Closing, losing capture or cancelling a pointer ends a drag. Opening a
Notebook page in the New message sheet offers no composer edges.

Phone hit ownership correction (9636): the stacked Reader's edge targets sit
beside the reading pane, rather than halfway down the whole dialog where growing
writing can put them over +. Observe the reading pane as well as the dialog so
writing growth and keyboard viewport changes reposition both 44px targets. Their
bottom never extends into the writing pane; width, centring, separator values,
keys and the other surfaces keep their existing rules. The four authenticated
phone tap failures at bed0a0d are the retained native red, not executions of
this branch. Focused geometry/adapter contracts supplement that evidence; native
reach and drag on this correction remain unrun until separately allocated.

Historical declarations in `tests/composer_width_native.mjs` are retained;
every own case includes “item 650”. This source composition keeps the current
base's `tests/reader_compose_native.mjs` without the650 import/registration and
keeps its act ledger and CI inputs unchanged. These are unrun source declarations,
not current-head proof. Each
state is a separate case at 320, 375, 390 and laptop, light and dark, in both
engines; Wide is laptop only, as the actual Reader supports it there only.
States are derived from the adapters and `writingState`: empty, writing,
saving a draft, preparing a send, refused image with Attach as download and
Remove, adopting/read-only, error notice, unavailable access with Retry access,
unconfirmed access, access checking, conflict with Review versions, invalid
composition/read-only, saved-copy discovery/read-only, blocked and ready
runtime-authority recovery with Review versions, and a private note. New
message has topic access and the same review/recovery branches, but no private
note. Authority recovery blocks Send and adding images while keeping local
typing available; discovery with no local version and invalid composition are
distinct read-only branches. Each review case opens Review versions by a native
press, reads the exact writing and authority controls, then closes back to the
composer before resizing it.
Busy and saving use held real requests. Image refusal, adopting and source
unavailability are seeded on the real owner/state objects, and their actual
DOM adapters paint the controls; the image refusal does not claim to test file
selection or durable Blob capture. New message startup error uses a refused
editor-state read, with no owner or writing; a Reader error is its notice.
The gesture under test always comes from native input, never a handler call.
Chromium narrow cases use native CDP touch; WebKit's public touchscreen API
only offers taps, so its narrow drags use native mouse input, with the same
44px target checks. Physical WebKit finger dragging remains device evidence.

Applied served-source mutants break each side, symmetry, centring, height,
keyboard adjustment and preservation of writing. Additional mutants restore
the origin-discarding guard, remove the edges from Tab order, and disable an
edge in each added access/review state. Each native mutant case requires its
own failed assertion and a fresh original-source control in the same state.
The revised refused-image and startup-error setup also proves the missing-edge red on the base
application sources in the same hosted call, with source bytes read from the
named base commit, not from another checkout.

All measured geometry assertions use named tolerances: 2px for CSS geometry,
0.5px for touch targets. Edge movements are 16px (32px width difference), so
these bounds cannot hide a missing or asymmetric resize. Red-before shots
come from the base application with the new cases only; no before shot is
manufactured. Source snapshots accompany the screenshots.

The historical correction declarations include native mode/default/close/reopen/
reload roundtrips and wrong-mode, undersize and drift mutants with restored
controls. Fifteen actual native starts remain spent, three remain, zero new.
The976 pair remains bound to1e462; the phone hit correction has source approval,
not new native acceptance. The disabled340/240/412 plan remains unrun.
This composition under Warp10353 is source-only: no new test, syntax/module/
product execution or runtime proof. The complete historical limits remain in
the650-fix9636 REPORT/SPEC; the returned650-compose10353 packet records conflicts
and omissions. Landing721 then650 waits731; root reconciles that later base.

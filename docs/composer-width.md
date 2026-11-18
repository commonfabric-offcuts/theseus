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

Each edge has an accessible name, tooltip, visible neutral grip, and a 44px
hit target. Tab reaches both edges (Option-Tab in Safari); Left/Right on the
edge reached through that focus order moves it as dragging would.
A click alone, vertical dragging, and keys other than Left/Right leave width
alone. Closing, losing capture or cancelling a pointer ends a drag. Opening a
Notebook page in the New message sheet offers no composer edges.

Checks: `tests/reader_compose_native.mjs` (`native-compose`) imports
`tests/composer_width_native.mjs`; every own case includes “item 650”. Each
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

The correction adds native mode/default/close/reopen/reload roundtrips and
wrong-mode, undersize and drift mutants with exact restored controls. Revised
B1 held reversal, B2 native Tab reach and B3 recovery cases require fresh
proof; historical 358/358 is not that proof. Six historical starts remain spent.
The 8667 correction allows at most six compose, two Python and two Node starts,
sequentially, with two remaining unallocated under the whole-piece ceiling 18.
Current run evidence belongs in the 650-correction-8667 report.

When the existing Reader is embedded in a reply card (721), its floating resize controls are hidden, removed from the tab order and inactive. Returning to a floating Reader restores those controls without changing either mode’s retained width. The shared adapter has a red-first combined check with separately caught visibility and activity mutations; the existing 721 normal native cases record hidden/tab-stop state at the combined source.

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

Review correction status: the held-origin adapter regression is red before
and green after locally. The added native traversal/state cases and mutants
are UNRUN: the piece used all six configured starts before this review (four
compose, one Python, one Node). A hosted red-before call and a hosted corrected
own-set call, including mutants/restored controls and new screenshots, require
two additional compose starts to be authorized/configured. The overall ceiling
of 18 leaves 12 numerically unused starts; this is not permission to use them.

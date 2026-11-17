# Composer width (item 650)

Settled start line: “Drag either side of the composer to set its width; it grows
and shrinks symmetrically, left and right only, and stays centred.” Tony's
original words (Fast Trains #6795, read through the item broker): “drag the
composer's left or right edge to set its width; it grows and shrinks
symmetrically, only left and right, and stays centred.”

The Reader (stacked and Wide) and the New message sheet offer their left and
right outer edges. Moving either edge changes both sides by the same amount
around the window's centre. Height and vertical position keep their existing
rules. The initial size is unchanged. The page clips neither side: width is
bounded by the existing maximum and the window; the minimum leaves room for
the existing composer controls. Width is only a presentation choice in the
open page, never writing, a destination, a send or a private-note action.
The topic's composer resting in the feed and Notebook pages keep their existing
layout; these are not new floating composer surfaces.

Each edge has an accessible name, tooltip, visible neutral grip, and a 44px
hit target. Left/Right on a focused edge moves that edge as dragging would.
A click alone, vertical dragging, and keys other than Left/Right leave width
alone. Closing, losing capture or cancelling a pointer ends a drag. Opening a
Notebook page in the New message sheet offers no composer edges.

Checks: `tests/reader_compose_native.mjs` (`native-compose`) imports
`tests/composer_width_native.mjs`; every own case includes “item 650”. Each
state is a separate case at 320, 375, 390 and laptop, light and dark, in both
engines; Wide is laptop only, as the actual Reader supports it there only.
States are derived from the adapters and `writingState`: empty, writing,
saving a draft, preparing a send, refused image with Attach as download and
Remove, adopting/read-only, error notice, unavailable source with Retry
access, and a private note. New message has no source access or private note.
Busy and saving use held real requests, image refusal uses a corrupt PNG file;
adopting, source unavailability and error are seeded on the real adapters.
The gesture under test always comes from native input, never a handler call.
Chromium narrow cases use native CDP touch; WebKit's public touchscreen API
only offers taps, so its narrow drags use native mouse input, with the same
44px target checks. Physical WebKit finger dragging remains device evidence.

Applied served-source mutants break each side, symmetry, centring, height,
keyboard adjustment and preservation of writing. Each is caught by the same
native gesture proof, then a fresh page receives the original source and passes.
The revised refused-image setup also proves the missing-edge red on the base
application sources in the same hosted call, with source bytes read from the
named base commit, not from another checkout.

All measured geometry assertions use named tolerances: 2px for CSS geometry,
0.5px for touch targets. Edge movements are 16px (32px width difference), so
these bounds cannot hide a missing or asymmetric resize. Red-before shots
come from the base application with the new cases only; no before shot is
manufactured. Source snapshots accompany the screenshots.

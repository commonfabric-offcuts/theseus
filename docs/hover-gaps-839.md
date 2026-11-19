# Continuous hover across display-only paragraph breaks (839)

Tony’s Releases11273 and Warp11280 ask that a topic card’s hover highlight
cover the vertical spaces created by Break out paragraphs, as the composer
sheet does. The display rule remains off by default, and Off is unchanged.

The formatter marks each displayed part as continuing or ending its authored
paragraph. The paint layer joins adjacent selected parts only, over their
shared horizontal extent. It preserves real paragraph boundaries, separate
list items, unselected parts and blocks such as code and table cells. The
existing background host still owns clipping and scrolling. No text, source
position, passage boundary, layout, spacing, input or stored record changes.
Copy and Quote continue to use the original authored characters.

The change is in message-format.mjs and lit-field.mjs, on actual release126
d5c46e3fd3696be586585d9765bfd821049eb461. The four new checks fail against that
live source and pass after the change. They combine actual formatted drawing
with explicit synthetic line geometry, checking gap coverage, source mapping,
Off, authored breaks, list boundaries, selected adjacency, horizontal overlap
and scrolled coordinates. They are geometry/model evidence, not browser pixels.
The focused current-live comparison is 331/331 versus 335/335, zero failures
or skips, covering message format, 768 drawing/correction, inline wiring,
dossier selection/Quote and 785 reading. No browser, preview or full suite ran.
Tony tests the release on live under the current Ship now instruction.

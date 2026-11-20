# The card-stack drawing (870)

Tony picked B at11711: three cards slightly fanned, with the pencil's line
and no heart. The exact approved path, cropped viewBox `3 15 56 39` and
stroke width `1.6` belong to `glyphs.mjs` as `stack`. Its hidden edges are
removed from the path, so it has no fill.

`notebookDocument` is the one tile-picture owner. Cards uses that shared
glyph, at full tile width and natural aspect ratio, resting at the bottom
of the existing tile box. The old three offset spans and their styling go.
Text keeps its existing four line spans and styling. Outcome references
continue using the same renderer, including when the saved view changes.

Checks exercise the actual renderer and view change, the approved SVG
attributes and the bottom-alignment declarations. The Cards assertion
fails on release145 first. An applied mutation must lose that drawing or
alignment, fail its assertion, and restore byte-for-byte with green controls.
This is renderer/source evidence, not native-browser geometry acceptance.

# A message header shows that it folds (1167)

Tony's selected default from designer/fold-header/spec.md and try.html is a
full-width ink7% band with no line below it. An open header shows its drawn
chevron only on hover, press or keyboard focus. A folded message keeps the
chevron muted at half strength, turned right, and lights it on hover/focus.

The eligibility is the existing headerClick context: the card's own author
header in a multi-message dossier outside Only new. Singleton and Only new
headers retain their prior presentation. The band reaches the card edges by
balancing negative margins with its existing padding; it moves no author
fragment or body text. The noninteractive, aria-hidden SVG sits absolutely in
that padding, persists across the existing folded/open repaint, and turns
through CSS. Existing card hover feedback is unchanged. Earlier-message rows
keep their existing presentation until opened whole.

reply-stacks.mjs shares the dossier context predicate between headerClick and
the affordance painter. The painter adds only classes and one SVG per eligible
card, after its contents, so first-author-fragment styling still applies. It
removes its own furniture when a redraw makes the card ineligible. No new fold
fact, command, focus stop, keyboard handler or event listener is introduced.
The existing header handler, folded-row handler, x key and menu still reach
StackFeed.setFold and its saved Core projection, refusals and Undo.

Selected unit proof paints the actual renderer, routes headers/rows/x/menu
through existing handlers against isolated record doubles, checks singleton
and Only new transitions, existing control exceptions, repeated redraws and
fresh views. CSS source checks hold the selected default and scope; they do
not claim native hit testing, layout, pixels, touch, timing or animation proof.
The seven unchanged 1101/1146 cases retain their fold/reveal boundaries.
Ordinary-page browser waived by Warp20514. Source preparation starts no test;
the pinned old-red/green pair requires Fable's exact grant before entry.

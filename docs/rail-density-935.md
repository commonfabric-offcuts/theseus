# Compact and Roomy rail (935)

Carry the accepted designer handoff relayed in Theseus13283, corrected13379,
onto live205 (`6e5d2098`). The rail belongs to OutlineRail and TopicRail; KeyTree owns
arrow movement. Keep901's persistent shell,923's dirty-panel reads, and904's
outcomes-key and933 count interfaces. No server change (936).

On fine pointers above760px, Compact is the default: one26px outcome line,
24px topic lines, aligned counts, whole titles on hover, quiet ink and the
accepted lights/pencils. Roomy retains existing heights/status lines with the
shallower indent. Phone/coarse layouts keep their current CSS. Density and
200–480px width are per-device localStorage choices; unavailable storage holds
them for this page. The separator supports native drag,16px left/right steps,
and double-click reset. Both controls must survive901 navigation, whose shell
clones the rail foot and restores page parts; reinstall their handlers per run.

Release retains an inert, aria-hidden, id-free copy of the adopted topic list
until the outline's own read settles. Adoption removes that copy, so late reads
cannot remove the new list or reveal duplicate rows. Held rows never enter the
keyboard tree. Keep the existing scoped load path. Per-outcome pencils are
`byRight`: up/down skip them, right reaches them; up from a pencil returns to
its outcome. The heading New outcome pencil's existing Up behavior remains
unchanged pending Tony's open ruling.

Checks: retain actual red output before carrying the patch; test delayed
release, quick return and failed reads below the browser. Use isolated native
Chrome for Testing for both themes/densities, narrow/coarse unchanged controls,
real pointer/key width persistence/reset and controls after in-place moves.
Measure actual rail geometry and pixels at30,120,300,700,1500ms after a native
cross-outcome click, plus quick return with no duplicate rows or reload. These
are fixture observations, not universal production timing guarantees.
Native geometry is exact. Static outgoing-rail screenshots mask the expected
selected source row and allow at most1/255 per RGB channel for raster rounding;
native07's strict hash failure was entirely one-level differences. The pixel
oracle also detects an eight-level single-pixel negative control. Native06's
43px legend jump remains a product red, fixed by class-based hidden styling.
At1280px and1512px, docked Notebook and New message sheet boundaries use the
actual rail width in Compact and after a drag; Roomy's default keeps aim.css.

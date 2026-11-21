# Rail rows keep their paint (976)

Contract before product changes, base release252 / 3d8756b464971dd16b064591e4d6693564768fd5.
Tony14242/14249 reports underlined green topic links during rail navigation;
his14297 frames isolate the current outcome while other outcomes stay styled.
Warp14318 assigns976, followed separately by980 and981.

A visible retained topic row keeps its rail styling through every browser paint
of an in-place navigation. The old page becomes inert, its IDs cannot shadow
fresh page IDs, and its callbacks remain scoped to its retired elements (945).
The next page's TopicRail keeps existing reads, actual Live keys and scoped
outline counts (904/923/933). No new stylesheet request or duplicate sheet,
ordering change, footer change, storage change or Core change is intended.

First reproduce on untouched252 with native Chrome for Testing: real clicks
between topics, animation-frame computed-style samples for both outcomes,
request counts and screenshots. A held real bootstrap request can expose the
existing between-run period; no DOM/class fault is injected to manufacture red.
Record normal and held-response observations separately. Test selected/current,
other outcome, Conversation/outcome navigation and final settled look. Cover
Compact/Roomy and both looks, with WebKit as a second desktop engine. These
checks prove observed frames, not a universal timing or physical-phone claim.

Read the actual OutlineRail.begin/adopt/release, Shell.move/retiredIds and CSS
owners before editing. Use a small owner regression for retained style identity
and fresh-ID/retired-callback isolation, plus meaningful native before/after.
Freeze on green, push only the exact own branch and submit HEAD/tree/base and
actual failures/passes for Warp. Coordinator owns piece/stages and Warp landing.


## Evidence and result

Untouched252 reproduces Tony's frame on an ordinary native click and with a
real bootstrap response held for two animation frames. Only the adopted
current outcome has idless lists with no styling class: computed green
rgb(95,174,150), underline and16px. Other outcomes stay styled. All stylesheet
links stay loaded and no CSS request occurs during either navigation. Both
settled controls pass. `red252-final` retains frames and the held screenshot;
its Browser.close and fixture EOF0/PID/profile/port checks are complete.

OutlineRail.begin now gives the retiring `#topics` list the existing shared
`.topic-list` styling identity before removing the ID, as release already does
for its still copy. This is the only product change: four inserted lines and
one removed line, no CSS, HTML, Core, read or navigation behavior changes.

Owner commands:

```
node --test tests/ui_rail_first_paint_976.test.mjs tests/ui_outcome_navigation_901.test.mjs tests/ui_rail_density_935.test.mjs tests/ui_outline_disclosure_902.test.mjs tests/ui_outline_order.test.mjs tests/ui_rail_dimming_973.test.mjs
node tests/rail_first_paint_976_native.mjs EVIDENCE_DIRECTORY
```

The native harness uses AIM_PLAYWRIGHT_CORE; Chromium also uses AIM_CHROME;
AIM_ENGINE=webkit selects the second desktop engine. AIM_976_BASELINE=1 selects
the two original red cases. It seeds only isolated scratch records. An actual
stale-ID mutation is applied to the product, fails fresh lookup, and restores
byte-for-byte before final checks. Raw evidence is retained outside source at
`/Users/commonfabric/aim-worktrees/core-lane7-976-evidence`.

Two initial incomplete harness attempts hit a route-interception cleanup
error. Their observations are retained separately in red252/red252-complete;
no complete run claim uses them. Both Chrome processes exited, fixture ports
closed and residual owned profiles were removed. The corrected harness awaits
held routes and writes initial ownership; red252-final and later final runs
have explicit Browser.close plus fixture EOF0 and owned cleanup receipts.

Final owner cohort55/55 passes. Native Chrome32/32 and WebKit32/32 pass at1280px
in Bookends/Paper × light/dark × Compact/Roomy, across normal same-outcome,
held same-outcome, held other-outcome and held outcome-home navigation. Every
observed retained frame keeps font, line height, display and box size; settled
non-selected rows also keep color and decoration. No page errors or new CSS
requests. Both final runs verify Browser.close, all observed owned PIDs and
profiles absent, fixture EOF/exit0/PID absent and port closed. No physical-phone
or universal frame-rate guarantee is claimed.

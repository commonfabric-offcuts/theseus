# 1030 verification

The Images ring now stays visible after native Right moves from the entry
tile to its picture. Only product change: one thumbnail focus selector and
its comment in `web/rails.css`. Actual focus remains on IMG, retaining its
Return/new-tab and existing menu/Escape owner. No JavaScript or Core change.

Base is original assigned308 `46d4de292c663a2dee710394d0ab0b596ec5b128`.
The diagnostic phase deliberately retains that source after310 landed;
Fable15468/15546 and Warp15534 confirm the phase/scope.1034's broader Safari
rail keys belong to Page6.1033 follows this item;1016 stays frozen separately.
The exact review HEAD/tree are supplied with this report in its delivery.

## Observed cause and pre-edit red

ThingsRail, KeyTree and image-pick are byte-identical from293 to308. No later
release is blamed. Feed Right lands the enclosing A, whose own outline is
visible. The next native Right correctly focuses the adjacent IMG and is
consumed by the grid's capture owner. The IMG's computed2px outline/2px
offset lies wholly outside its enclosing tile's hidden overflow. The ring
has zero area left after ancestor clipping. The entry tile has682.25px².
The first test's computed-outline oracle missed this; screenshots revealed
it. Its passing controls are preserved with that limitation.

Actual pristine308 paint checks: Chromium0/4 and WebKit0/4, both looks at
1280/390. The browser measures actual outline bands, intersects them with
the viewport and clipping ancestors, and asserts some band remains for the
chosen picture. Native entry/after-Right screenshots visibly show the loss.
Raw `chromium-paint-red-308` and `webkit-paint-red-308` retain focus, clipping,
key capture/bubble traces, served hashes, failures and cleanup.

The repair puts the ring on the tile while its image is focus-visible. Its
own overflow does not clip its own outer outline. The picture still owns
focus. Existing1007 row-edge holds stay: the conditional short-row routing
hypothesis was not the defect. Fable15546 explicitly confirms that distinction.

## Kept native checks and actual applied control

`tests/images_second_right_1030_native.mjs`:

| Final phase | Chromium | WebKit |
| --- | ---: | ---: |
| Five pictures, both looks/themes,1280/390 | 8/8 | 8/8 |
| Two pictures, both looks,1280/390 | 4/4 | 4/4 |
| Three pictures, both looks,1280/390 | 4/4 | 4/4 |

Feed-to-tile entry precedes two uninterrupted Rights with no intermediate
focus reset. Phone grid entry is direct because its open drawer covers the
feed; arrows intentionally never open a closed drawer. The actual picture
identity and unclipped outline are checked after continued Rights. Existing
Left/Up/Down, partial/final rows, controlled actual2/4-column layouts, menu
Shift-F10/Escape, Return and native click/tap blob-tab openings remain checked.
Each popup closes through Page.close; the owned browser closes through
Browser.close. No handler invocation is described as a native key.

The final producer's focused preflight passed1/1. Actual removal of the new
CSS rule failed0/1 on the outline clipping assertion. Exact original CSS
bytes were restored before the green final matrices. Earlier applied/removal
and restored controls are also retained. No unrelated assertion was weakened.
`chrome-final-entry-applied-removal`, its load/hash record and the saved
original/mutated CSS retain the applied evidence. `final-phase-summary.json`
indexes all final phases.

Separate same-product diagnostic probes pass1/1 per engine through an actual
retained topic route round trip and Notebook dock open/feed-Right/close at
1280x520. The dock hides Images and takes feed Right by its existing contract.
Those lifecycle screenshots retain an incidental Notebook hover preview, so
visual acceptance uses the unobscured normal probes instead:1/1 per engine
in `chromium-paint-final-visible` and `webkit-paint-final-visible`. Both actual
post-Right screenshots were inspected and show the ring on the next tile.
The diagnostic producer is retained in the evidence bundle, outside the
product checkout; replay it from the checkout's tests directory.

## Cohort, identities and cleanup

The13-file CSS-reader plus grid/rail/tree/image/menu/opening cohort passes
130/130 on pristine308 and130/130 on candidate. Complete node SPEC output
matches after exact owned-root paths and timing values only; normalized diff
is empty. Exact file list is `cohort-files.json`; full raw `.spec.txt` and
normalized records remain. There are no inherited failures in this cohort.
No broad-suite or timing-improvement claim is made.

Every final cell fetches and verifies13 actual served module/style hashes;
each launch record binds the producer hash, supplied hashes and fresh load.
Engines: Chrome for Testing156.0.8078.47; existing WebKit2359/26.6 via its
installed pw_run.sh with Playwright1.63. No installation change. The native
harness is invoked manually; release-controller registration is unchanged.
Use AIM_PLAYWRIGHT_CORE, AIM_CHROME or AIM_ENGINE=webkit/AIM_WEBKIT,
AIM_1030_SOURCE_HASHES JSON and AIM_1030_SOURCE_SHA256, then run
`node tests/images_second_right_1030_native.mjs EVIDENCE`.
AIM_1030_COUNT=2/3 with AIM_1030_BASELINE=1 selects each short-row phase.

All phases verify Browser.close/disconnection, all observed owned PIDs and
profile processes absent, profile removed, fixture EOF/exit0/PID/children
absent, empty fixture errors and closed port before the next engine. All
final page-error lists are empty. No owned browser or fixture remains.
Physical phones, the Safari application and unrelated wider rail cursoring
are not proven by installed headless engines. No live records were used.

Earlier fixture errors remain separate: initial unsupported import before any
browser; feed entry reaching inline links; hidden outline route link; Notebook
anchor queried with its superseded link role. Corrected source-matched phases
are named independently. The computed-only controls and their producer bytes
remain; no passing run is relabelled as the accepted red.

Raw evidence, producer snapshots, served hashes, PNGs and cleanup:
`/Users/commonfabric/.local/share/theseus/core-lane8/evidence/1030`.
The review bundle includes these records with a per-file SHA256 manifest.
Fable owns canonical freeze/classification/stages; Warp owns independent
read/carry/landing. No shipping claim is made by this source delivery.

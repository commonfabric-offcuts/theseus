# Fine pointer scrollbars: evidence (1050)

The product appends the designer’s exact four-line `@media (pointer:fine)`
rule to `web/rails.css`. Both `html` and `#things` receive scrollbar-width:none
and display:none for their WebKit scrollbar pseudo-element. Coarse pointers
keep their existing window and rail scrollbar styles. No overflow, layout,
Core, storage, feed map, or pane/key JavaScript changes.

Intake/base is actual release320
`d12c3c1f1654ab50e3dacdbf0f8bbfc18c1c427f`, tree
`fd2637ea0bfcbe314fae8624d9e171744474b46f`, schema65. Own branch is
`page-lane6/1050-scrollbars-320-16033`. The final exact head/tree and file
hashes are in the published manifest. Later ordinary releases321–325 are
separate carry facts; this source was not silently rebased. Page5’s1052
Notebook empty-body selector must be retained independently during carry.
The short contract preceded the product edit.

## Actual checks

The standalone producer is `tests/fine_pointer_scrollbars_1050_native.mjs`.
It creates real isolated Core/HTTP records:16 Notebook pages,12 long messages,
and12 PR/preview links. Both the actual window and right rail overflow.
Installed Chrome for Testing156.0.8078.47 runs with its inherited
`--hide-scrollbars` flag explicitly removed; installed WebKit is26.6.
Each engine’s12 cases are1280 fine,390 fine and390 coarse, crossed with
Bookends/Paper and light/dark. Actual pointer media is asserted, not inferred
from viewport width.

Unchanged-source baseline matrices complete12 cases per engine. All eight
fine cases per engine have both expected style failures (16 failed assertions);
all four coarse cases pass. Native wheel and PageDown scroll both actual
surfaces, the rail wheel retains window place, native Right from the Notebook
heading reaches its disclosure, and Left returns to the feed. Focus setup
before PageDown uses DOM focus; it is not native Tab reach. The final producer
also asserts the actual disclosure class and visible native keyboard focus.

Both initial candidate matrices pass12/12. The actual scope control then
changes the media rule to include coarse pointers: each engine’s390 coarse
case fails both intended scrollbar assertions, while its gestures still finish.
The candidate CSS is restored byte for byte (SHA256
`24907a3684267b8b6afba1aa072f0f62e6b4e6ac71dcb7247614da800900e411`).
Final restored Chrome and WebKit matrices each pass12/12 with the strengthened
producer and zero page errors. All24 corresponding page maxima and rail client/
scroll heights match their unchanged-source baselines; transient input animation
offsets are not equated. The phase index retains the actual outcomes.
No old assertions are weakened and no product body is copied into a test.

The direct owner cohort has17 existing test files for rails CSS,
ThingsRail/pane/key owners. Baseline and restored candidate each report244
tests,238 pass and the same six failures in `ui_unread_landing.test.mjs`.
Their complete TAP output is identical after replacing only the own absolute
worktree root and elapsed duration_ms values. Raw logs, normalized logs,
all six full failure diagnostics, exact file list/command and the empty full
diff are retained. These failures are unwaived; this is not a whole-suite
or whole-release green claim. No existing test file is edited.

## Retained failures, identities and limits

Earlier producer failures are retained under their original phase names:
three rail target/sequence preflights, narrow rail lazy-read setup in the first
and third matrix attempts, and a window wheel that landed on an independently
scrolling message in the second attempt. Corrections target the visible rail
row before window gestures, open the narrow rail before awaiting its lazy
rows, and use main padding for window input. They do not change product code
or remove the intended style assertions. A post-run manual result printer
also raised a missing-key error after cleanup; the current helper reads the
optional field safely. These failed attempts are not counted as completed
matrix proof.

Every native phase retains all11 measured local source bodies plus source.json,
producer/fixture hashes and actual HTTP response bodies for the seven measured
loaded owner URLs. The index is a selected owner measurement, not a claim to
capture the entire application import graph or installed browser binary.
The archive membership checker enumerates every measured path without an
extension filter, verifies actual served bytes, and checks every payload hash.
Source HEAD in a native result remains320; each phase’s recorded byte hashes
identify its actual candidate/fault/restored working tree, not an already
committed release. Final source hashes are reconciled before publication.

All phases verify Browser.close/disconnection, absence of every observed owned
PID and profile process, owned-profile removal, fixture EOF/exit0/absence,
empty fixture errors and closed port. Only isolated headless profiles and
scratch records are used, sequentially with load below12 on18 cores. No
Tony browser, OS input, installation, runner or live source/data action.

Protocol wheel/key input is trusted browser input, not physical trackpad,
phone/finger, hardware keyboard or OS-preference proof. macOS overlay gutters
measure zero; no persistent reserved-gutter claim is made. A retained Chrome
rail screenshot draws its native rail bar. Chrome’s later window screenshot
shows a native window bar against a blank content capture even after two
animation frames; that capture is not proof of content paint. WebKit’s
window capture contains the actual page. Computed/pseudo styles and actual
scroll/focus receipts support the narrow rule; the screenshot limitation is
retained, not suppressed. No synthetic DOM timing claim.

Fable owns canonical freeze/stages. Warp owns independent review, approval,
carry, landing/runtime and Tony announcements. No owner Done is claimed.

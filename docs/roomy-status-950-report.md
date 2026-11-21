# 950 verification

Own source branch/worktree `page-lane5/950-roomy-status-live236`, base236
`96b286654ed3029af8c9c4bdf8afdc3af186aa6c`. The13899 resume ruling superseded
the earlier220-now option; that separate own220 intake tree remains untouched.
Only product change is one scoped CSS rule plus its comment in rail-dense.css.
On fine pointers above760px with Roomy selected, standing words and the
question-only control are invisible, retaining layout space. Lights, counts,
names, disclosure and pencils remain visible. Compact/phone/coarse are unchanged,
including stored Roomy on phone/coarse. No data, DOM, routing or preference edit.

- 35/35 Node checks pass: tests/ui_rail_density_935.test.mjs,
  tests/ui_outline_stars.test.mjs, tests/ui_outline_disclosure_902.test.mjs,
  tests/ui_whisper_outline.test.mjs. Zero failures, cancellations or skips.
- tests/roomy_status_950_native.mjs: 46/46 final native checks pass, zero page
  errors/failures. Fourteen cells cover light/dark, Roomy1280/1512, Compact1280,
  phone390 and coarse1280, also saved Roomy on phone/coarse. Actual density
  choice and outcome-name clicks work. All rail/control rectangles match the
  unchanged236 baseline (recorded to0.001 CSS px); lights/counts/visibility and
  protected-mode presentation match too.
- Actual unchanged236 baseline: eight expected failures, visible Roomy words
  and question-only control in four desktop cells;24 other checks pass.
  No product assertion or unrelated check was weakened. git diff --check passes.

Raw evidence is outside the repository in the page_lane5 seat's artifacts:
950-node-owners.tap, 950-native/red236-current-ask/results.json and screenshots,
950-native/final236/results.json and screenshots. Both final baseline/candidate
runs close through Browser.close, verify all seven owned PIDs absent and the
profile removed, then fixture EOF exit0/PID absence/closed port. Baseline6402,
port54419; final9912, port64996.

Harness diagnostics retained separately: first220 setup lacked divergence_reason
(fixture998/60305), first236 setup lacked current ask_wait metadata
(6251/53122); both exited0 before Chrome launched. First candidate has32 feature
checks green and14 comparison failures caused solely by per-store generated
Conversation ids. All actual rectangles already matched; comparison now retains
child count/order and rectangles while excluding those allocated ids. It also
compares stable status presentation rather than independently generated clock
words. Candidate8916/59443 and its seven browser PIDs/profile cleaned up before
the corrected run. These are fixture diagnostics, not product reds.

Native limits: Chromium only, emulated phone/coarse pointer, no physical-phone,
Safari, timing or full-app pixel claim. CSS preserves Roomy space deliberately
to meet the item's nothing-else-moves requirement. Status words remain in source
but hidden controls do not leave an invisible interactive target. Coordinator
retains Build, carry and deployment; exact frozen HEAD/tree are in the receipt.

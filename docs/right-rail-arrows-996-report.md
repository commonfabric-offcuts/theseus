# 996 verification

Base: release279 `dcadf50639526784964ad3260029a5bb1b6e6eab`.
Fable14714 binds medium Build1 `p-05904224fbea4a6894b52efb` in
`t-01a7a34306f74e479bf443aff98a7127` under Warp14654/14670.

Only product owners changed: `web/things-rail.mjs` and `web/rails.css`.
Plain Left uses the existing things-to-feed handoff for rows, headings and inset
controls. Each heading has its own shared-glyph disclosure: Return/Space toggle
once, Up/Down walk the rail, Right can reach the Notebook pencil. Native heading
clicks and saved folds remain. New disclosures have 44px targets on narrow or
coarse-pointer screens. Shared PANES, arrowReach, KeyTree and967 are unchanged.
The998 imageSection/menu seam and372 topic-open handler are separate owners.

## Actual failures and controls

- Actual279, new owner file: **0/11 pass,11 fail** before product changes.
  Concise raw evidence: `owner-red279-concise.tap`; the first verbose raw run is
  also retained, without substituting a simulated baseline.
- Actual279 native Chromium: **0/1 pass**, Notebook page Left lands on its
  header rather than the feed (`chrome-red279/results.json`).
- Applied the actual prior stepOut/fold routing to the candidate: **4/11 pass,
  7 fail**, one routing failure for each of the seven sections. Captured mutated
  bytes and original bytes, then restored SHA256 byte for byte. Restored owner
  plus967 and shared-arrow controls: **24/24 pass**.
- Candidate's first new phone check measured **25.59375px** rather than44px;
  retained `chrome-touch-red/results.json`. Added the narrow/coarse CSS rule.
- Earlier candidate preflight reloaded before asynchronous toggle saved its
  fold. The oracle now waits on the actual stored fold before reload; no product
  delay was added. Retained `chrome-preflight` and its same-source green control.
- First WebKit phone bounds caught the moving drawer: two heights were
  43.999969482421875px while its translate animation ran. Wait for the actual
  computed transform to become none before measuring. No assertion tolerance or
  product change; retained `webkit-final` diagnostic and final settled runs.

## Final checks

`tests/ui_right_rail_arrows_996.test.mjs` tests actual builder/actions with
bounded DOM/pane ports; these checks make no native gesture or layout claim.

```
node --test tests/ui_right_rail_arrows_996.test.mjs \
  tests/ui_notebook_arrows_967.test.mjs tests/ui_arrow_reach.test.mjs
```

**24/24 pass**, including new11/11. Native driver:
`tests/right_rail_arrows_996_native.mjs`, using isolated
`tests/fixtures/ui_http.py --freshness --live --images --media`.

Final Chromium **156.0.8078.47:12/12** and WebKit **26.6:12/12**. Per engine:
1280/1600 × Bookends/Paper × light/dark (8 keyboard/pointer cases), plus390 ×
both looks/themes (4 actual emulated-touch cases). Desktop verifies Notebook
row/header/pencil Left→feed without folding; separate disclosure Enter/Space,
Up/Down, pointer header/chevron and saved fold across reload; Images/PRs/Previews
row/header Left and explicit disclosure. Phone taps verify44px targets, one
fold/open per tap, heading taps, and no horizontal overflow. All page errors and
fixture fatal events empty. Inspected actual desktop and phone screenshots.

Both final runs fetched and compared exact served bytes:

- `web/things-rail.mjs` SHA256
  `66516187445173acadc3c34d9036acf2a083e411043d6a6ba898fa34ea8ad800`
- `web/rails.css` SHA256
  `a71d247e14ca1e311b974cb198f7fc98e4f458abaf4385e321034ca7347cb16a`

Each engine verified Browser.close, all observed owned PIDs absent, profile
processes absent and profile removed, fixture EOF/exit0/PID absent, all observed
fixture children absent and port closed. One own workload at a time; one-minute
load below12 on18cores at launches. No owned browser or workload remains.

Affected client cohort (eight existing files plus the new file):

- Candidate: **147 total,146 pass,1 fail**.
- Pristine279: **136 total,135 pass,1 fail**.
- Full normalized failure diagnostics match exactly (only source root and
  test duration normalized). Existing844 fixture fails in
  `OutlineRail.ready`, missing `bind`, `tests/ui_rails.test.mjs:748`; neither
  its owner nor assertion changed.

Existing cohort files: `ui_rails`, `ui_arrow_reach`, `ui_notebook_arrows_967`,
`things_opening_968`, `ui_rail_drawer`, `ui_outline_order`,
`ui_topic_notebook_menus_862`, `ui_state` (all `tests/*.test.mjs`).
`git diff --check` and module syntax checks pass.

## Evidence and limits

Raw TAP/XML/JSON, actual original/mutant bytes, final observations/screenshots
and cleanup facts are retained in
`/Users/commonfabric/aim-worktrees/core-lane7-996-evidence`.
Final directories: `chrome-final-settled`, `webkit-final-settled`.
`routing-mutation.json` and `cohort-comparison.json` record controls/comparison.
The attached review bundle contains the concise reds, mutations, cohorts and
both complete final native records plus representative screenshots.

Native desktop checks cover the four actually populated sections; bounded
owner checks cover all seven. Phone checks use desktop engines with touch and
mobile emulation at390; physical phone/tablet hardware and software keyboards
are unrun. No Core/schema/server change. This source is based on279; later
ordinary-head integration and the separate998/372 changes belong to Warp.
Fable owns stages and Tony owns acceptance. Freeze for one independent read.

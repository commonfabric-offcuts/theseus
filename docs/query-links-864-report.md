# 864 verification

Built on release 220, `73d3c2b34da8b6d69e1d541833ebd7be88cee189`, in
`page-lane5/864-query-links-live220`. A fresh fetch before freeze confirmed
`origin/release/live73` still names that commit. Source is frozen for Warp's
one diff/test read; the review receipt names its exact HEAD and tree.

Explicit authored query links now use the shared written-link gate. The
resolver uses scoped, paged existing metadata, current-outcome priority and
the page's actual Notebook owner. Unknown, duplicate, interrupted and
superseded destinations cannot become a guessed navigation. Canonical ids,
Copy Link addresses, writing guards and literal writing retain their paths.
Cover stands and item descriptions preserve surrounding literal text.

## Checks

- 281/281 Node tests passed, zero failures, cancellations or skips:
  `tests/ui_topic_link_route_864.test.mjs`, `tests/ui_links.test.mjs`,
  `tests/ui_dossier_cover.test.mjs`, `tests/ui_message_format.test.mjs`,
  `tests/ui_topic_navigation.test.mjs`, `tests/ui_pipeline.test.mjs` and
  `tests/ui_app.test.mjs`.
- `tests/query_links_864_native.mjs`: 44/44 passed in isolated headless Chrome
  for Testing at widths 1280 and 390, with actual mouse clicks and touch taps.
  Seven rendered source surfaces open the recorded owner page: message,
  Reader, item record, cover, Notebook Reader, Cards and Notebook sheet.
  Missing/duplicate refusal, existing id links, case-insensitive names,
  Cards context priority, visible sheet/Cards errors and literal Text writing
  passed. No page errors.
- The same native fixture on an own detached exact-220 baseline reproduced
  seven missing-anchor failures; the literal Text writing check passed.
  Renderer/cover and item-header unit reds were also retained before changes.
- Actual current-outcome-priority mutation applied: resolver SHA-256 changed
  from `bbe5353a1e7c593db1e695ec10e160b5af8e5ca5a64aa357d813fdf37fb68e03`
  to `8f37ec9df23ec98c001084efe885a7e7928ed673cd8bfa3251752e0c47c5855b`;
  7/13 resolver checks failed. Exact-byte restoration returned the first
  hash and 13/13 passed before the final 281-test run.
- `git diff --check` passed. No unrelated assertion was relaxed.

Raw TAP, mutation facts, screenshots and browser/fixture cleanup are outside
the repository under the page_lane5 seat's `artifacts/864-tests` and
`artifacts/864-native`. Final files are `affected-final-restored.tap`,
`current-outcome-mutation.json`, `current-outcome-mutation.tap`,
`current-outcome-restored.tap`, `final-red220/results.json` and
`final-candidate/results.json`.

Both final browser runs closed through Browser.close, verified all seven
owned PIDs absent and the temporary profile removed, then ended the fixture
by stdin EOF, exit 0, absent PID and closed port. Baseline fixture PID 70917,
port 53644; candidate PID 71103, port 55138. No test records touched live data.

## Scope and limits

Notebook Text is an editing textarea and intentionally retains exact source;
rendered Notebook text is checked through Reader, Cards and sheets. Earlier
evidence retains an incorrect textarea-anchor expectation and a loading-body
race as harness diagnostics, followed by the corrected paired runs above.
The new item-header test adapts mini_dom's own-text replacement to native
replaceChildren semantics; its native check also passes.

Name lookup reads complete metadata afresh and may need every readable
outcome when no local title matches. It does not read message history or add
a Core view/cache. Native checks cover Chromium only, with an emulated touch
viewport; no physical-phone, Safari or timing claim. Core/schema, pipeline
stage changes and carry/deploy are outside this source branch.

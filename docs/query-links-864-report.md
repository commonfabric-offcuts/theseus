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

## First-freeze checks

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

## First review correction

Warp13790 identified missing imports in the extracted 780 fixture. The fixture
now supplies the actual topicLinkNeedsLookup/resolveTopicLink bindings and
the app's cancellation/context/topic-view dependencies. Its original assertions
are unchanged. Real bindings exposed one unnecessary current-topic read;
the lookup gate now accepts the already-open topic id as known. Other readable
short ids are still confirmed by the topic view.

The captured first-freeze run has the missing-import failures. With actual
bindings, 22/23 pass and the unchanged read-count assertion fails on the extra
topic read. After the known-id bypass, 36/36 combined 780/resolver checks pass.
Actually removing the bypass fails that assertion again; exact-byte restoration
passes 23/23. Raw `review780-*` TAP and mutation JSON are beside earlier evidence.

Final correction verification: 304/304 Node tests pass, zero failures,
cancellations or skips. This is the seven first-freeze files plus
`tests/ui_dossier_landing_780.test.mjs`; all 23 original 780 checks pass.
The complete test bodies match release220 byte-for-byte (SHA-256
`4cb90caea1c0f42548ddf80849355343e7750369b27b9a94dc271f10018abbe8`).
`review-final304.tap` and `review780-assertions.json` retain those results.

The same native script reran 44/44 successfully on the correction, with zero
page errors or failures. `review-candidate/results.json` records Browser.close,
all seven owned PIDs absent, the temporary profile removed, and scratch fixture
78652 exiting0 after EOF with its PID absent and port59749 closed.
The review mutation changed app.mjs SHA-256 from
`9caba2956d1e7f1a0d3b6383d37e0f51fbc8b058893c8f5c1cf29c8789600bfe`
to `ef93e26d27bf273eeb3083629d9fddde3f78eff893c3f7e5cd15a8060aec2cb8`;
restoration returned the first hash before the final304/native run. A fresh
release/live73 fetch still names the original220 base. No rebase or assertion
weakening was needed.

## Round-three correction

Warp13815's seven additional failures reproduce on 811e5eb2; all seven pass
on an own detached unchanged220 baseline. The cause was lookup applied to
ordinary routes, plus an extra startup await before the existing early color
read. Authored query links now carry explicit provenance through the real link
opener; only those clicks request name lookup. Ordinary internal, rail,
notification and full-address routes retain their existing path. An unconfirmed
lookup keeps the original route and its writing/validation guards; explicit
unknown/duplicate names retain their visible refusal. Startup begins colors
independently and retains its parsed route after an empty or failed lookup.

All original ui_inline_wiring source/assertions remain a byte-for-byte prefix
of that file; four appended actual-app checks cover empty/error startup
fallback, zero lookups for ordinary routes and dirty-writing protection for an
unconfirmed authored query. Five focused checks, including opener provenance,
pass. Applying actual811e5eb2 app bytes makes all four app checks fail;
exact restoration returns all five green. App SHA-256 restored to
`47a0b8e1b4cfd2d9a6dd81a4c3e5be06cdc2a5c0af2c90f8d44879b85f96563b`.
Raw `round3-red811e5eb2.tap`, `round3-seven-baseline220.tap`,
`round3-previous-app-mutation.tap`, `round3-previous-app-restored.tap` and
`round3-previous-app-mutation.json` retain the actual observations.

Final round-three verification: 827/827 Node tests pass with zero failures,
cancellations or skips (`round3-final827.tap`). The first eight files plus
ui_inline_wiring, ui_dossier_heads_886 and ui_outcome_navigation_901 are the
eleven-file cohort; all original assertions remain. Native46/46 passes with
zero page errors/failures, including direct named-page startup at both widths.
`864-native/round3-candidate/results.json` records Browser.close, seven owned
PIDs absent, temporary profile removed and scratch fixture91167 EOF exit0,
absent PID and closed port63772. No new workload follows the13831 deploy hold.
The same220 base was freshly fetched before this freeze; source remains on
its exact own branch for review after seats resume.

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

# 827 verification on release210

Branch `page-lane6/827-notebook-menu-live210` starts at exact210
`9808c5171eaeea5ab1bcd0b4bd9ec34e6d20849a`. Item827 had no piece or Build;
its topic is `t-2a035d3a1f9fc2e7735fe722c4801ece`. The source receipt names
the frozen HEAD/tree. Product and Core bytes are unchanged from210.

Tony's report10943 describes a release113 failure. It does not reproduce on210
in the tested scopes. Keep the shipped792 shared menu and NotebookWriting
revision/journal owner, and878's Private Draft/current-writer guard. This change
adds regression coverage without a duplicate product fix or schema change.

`notebook_menu_draft_827_native.mjs` checks 16 scopes:390/1280px, light/dark,
sheet/full-page and Text/Cards. Each scope exercises both Draft states with
actual native Star/Unstar, Rename cancel/save, menu close and explicit Draft
controls. Core confirms exact title/body/attachments/references/Draft, no content
revision for stars/cancel, one complete rename revision, and persistence after
actual reload/reopen. Only explicit Private Draft changes the flag. Input is
emulated phone touch or desktop pointer/keyboard, without a physical-device,
Safari-app or timing claim.

Final checks:

- Chrome for Testing156:8/8 sheet scopes in `chrome-matrix/native.json`, then
  8/8 full-page scopes in `chrome-full-corrected/native.json`.
- WebKit26.6:16/16 in `webkit-matrix/native.json`.
- Node121/121, zero failures/skips in `final-node.tap`: `ui_notebook_writing`,
  `ui_notebook_owners_871_873`, `ui_notebook_toggle_878`,
  `ui_topic_notebook_menus_862`, `ui_notebook_revision`,
  `ui_notebook_card_merges`, `ui_notebook_lock_849` (all `.test.mjs`).

The first Chrome matrix also retains eight full-page test-selector failures:
the title editor is in `#topic-title`, outside `#deck-page`. The corrected
full-page run passes every failed identity. Other initial test setup errors
remain separately recorded: a topic page link cannot carry `view`, the menu
must wait for its actual saved content, the sheet's title field is in its fixed
header, and arrival consumes a topic's `page` link. Reopening that saved link
after a real feed reload uses the current navigation contract. These are test
errors, not evidence of a product Draft failure or a waived behavioral check.

A deliberately applied Star→Draft-toggle routing mutation fails the native
Draft check (`true` instead of `false`). `mutation-verdict.json` records actual
application and exact restoration of `web/notebook-page.mjs`:
`acec6469333809762a84f56d47a81a48344de31d8770dc8823a667de7427afb2`
before/after, with the altered digest and raw failing record retained. Final
green checks use those original210 product bytes.

Both native runners repair their existing malformed four-dot spread token and
record owned cleanup details, as the approved800 test repairs do. The Notebook
suite passes observations/engine to the new isolated checks. No installed tool,
live runner, live records, stage, carry or deployment changed.

Evidence root:
`/Users/commonfabric/.local/share/theseus/page-lane6/evidence/827/`.
Browsers closed through their APIs, fixtures reached EOF exit0 with empty
stderr, captured owned PIDs are absent, ports58013/63643/50022 are closed and
Chrome profiles removed (`final-cleanup.json`, `chrome-cleanup.json`).

Reproduce the new native cases with the usual harness paths:

```sh
node tests/reader_persistence_native.mjs "$CHROME_FOR_TESTING" "$EVIDENCE/chrome" --notebook '^notebook item 827 '
AIM_PLAYWRIGHT_CORE="$PLAYWRIGHT_CORE" node tests/webkit_native.mjs unused "$EVIDENCE/webkit" --notebook '^notebook item 827 '
```

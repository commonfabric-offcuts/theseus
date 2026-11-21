# 1018 source and evidence

The pencil sheet now uses physical Option-N/Option-M while typing. Option-N
opens or switches to Note, preserving writing, selection and the selected
Notebook page. Option-M switches the existing composer to Message; when the
sheet is closed it remains inline. Plain Return after clicking Note or
Message uses the existing Send path. Return with a text caret remains a
newline, and Command-Return in the writing still sends. This is the named
shipping default from15156/15157, not a new choice awaiting approval.

Base: live302 `962fb5912fc5efb7c6ff8bbb0db40904e7c6e01f`.
Branch: `page-lane5/1018-pencil-keys-302`.
Worktree: `/Users/commonfabric/aim-worktrees/page-lane5-1018-pencil-keys-302`.
The delivered message and evidence manifest name the exact frozen HEAD.

`web/pencil-keys.mjs` handles only the main pencil's keys. The six added lines
in `inline-composer.mjs` import, install and dispose that handler. Card reply
instances do not install it. `InlineComposer.send` and `finishPage` are byte
unchanged from302: Page6 owns979's publication/close continuation; the designer
owns the separate animation lines. Warp reconciles the shared file during
carry. Fable owns binding/stages/readbacks; Warp owns independent review and
carry/landing. No Core, schema, persistence, styles or phone controls change.
The Keys legend, app guide and `docs/interaction.md` name the behavior.

The existing Send guards still handle empty, busy, read-only or unavailable
writing. A select or nested naming dialog retains its Return. Other modal
reading/editing surfaces retain their keys; composition, other modifiers,
held keys and disposed/unavailable composers have focused controls.

## Verification

- Final native harness `tests/pencil_keys_1018_native.mjs`: Chrome52/52 and
  WebKit52/52, both Bookends/Paper and light/dark at1280px. Native keys preserve
  selected writing, switch modes with the sheet open or closed, retain the
  chosen Notebook page, send from modal and inline mode buttons, and keep
  newline/Command-Return and picker behavior. Each engine records20 real
  committed publications and exact Core source readbacks. Four actually
  served module hashes match the tested source in every matrix cell.
- `tests/ui_pencil_keys_1018.test.mjs`:23/23. The physical-key mutation was
  actually applied: replacing `event.code` with `event.key` fails both
  Dead/µ spelling controls; exact byte restoration returns23/23.
- Six-file Node cohort579 tests,569 pass/10 fail; unchanged302 has556 tests,
  546 pass/the same10 fail. The complete failure diagnostics and every stack
  match after only own source-root paths and per-test durations are
  normalized. No existing assertion was changed or excluded. The files are
  `ui_pencil_keys_1018`, `ui_arrow_reach`, `ui_inline_send_937`,
  `ui_quoted_inline_send_941`, `ui_inline_reply_838` and `ui_inline_wiring`,
  all under `tests/` with `.test.mjs` suffixes. The10 failures are the existing
  outcome read/outline cases,923 reads, and894's retired wrapping expectation.
- `git diff --check` passes. Meaningful checks are complete; source freezes
  for Warp's one independent read, with no broad-suite green claim.

## Retained phases and cleanup

Absolute artifact root:
`/Users/commonfabric/.local/share/theseus/fable-tools/coordinator-20261117/hosted-seats13216/work/page_lane5/artifacts/1018-build`.

`manifest.json` identifies every phase and hash. `red302` retains the original
four native failures before product edits. Its original harness was not
separately snapshotted before later harness-only edits; this limitation stays
named. `red302-exact-harness` separately repeats the same four failures on
pristine302, retaining its exact harness and the three original product hashes
read from actual responses. Neither is relabeled as candidate evidence.

`chrome-candidate` is40/48: all eight failed Note readbacks omitted the exact
Notebook revision; committed receipts and Core's exact-revision refusals are
retained. The corrected oracle reads receipt.source_ref. `destination-red.log`
is the additional actual failure before preserving the chosen page.
`chrome-final` is52/52 with the earlier reused-page harness. `webkit-final`
is10/52: access-control page errors carried across repeated navigations through
one error array. Those failed diagnostics remain. Fresh pages isolate each
case without removing any error assertion; final same-harness evidence is
`chrome-isolated-final` and `webkit-isolated-final`,52/52 each. Final cases
retain full error stacks and request failures as well as source receipts.
The two exact harness snapshots remain under `phase-harness/`.

Every browser phase verifies Browser.close, absence of every observed owned
PID and any process bearing its profile, profile removal, fixture EOF/exit0,
fixture absence and closed port. Final Chrome observed9 owned PIDs, WebKit2;
none remained. All records and origins are scratch fixtures. No browser or
fixture remains; no Tony browser, real record or live installation was used.

Run Node with `node --test` and the six files above. For native runs, set
`AIM_PLAYWRIGHT_CORE` to the installed Playwright-core module and `AIM_CHROME`
to Chrome for Testing, then run
`node tests/pencil_keys_1018_native.mjs ABSOLUTE_EVIDENCE_DIRECTORY`.
For WebKit set `AIM_ENGINE=webkit` and its `PLAYWRIGHT_BROWSERS_PATH`.
`--baseline` runs only the four original cases and expects them to fail on302.

These are desktop engine proofs. The Dead/µ and composition guards are
focused handler controls, not a physical Mac layout/IME demonstration. No
installed Safari, physical phone, software keyboard, latency, Tony acceptance,
deployment or whole hosted-gauntlet result is claimed.

# Pencil sheet keys and pills: source and evidence (1023)

Option-M now opens the sheet in Message mode, as Option-N opens Note. Mode
shortcuts are consumed in this pencil's own fields before busy, admission and
nested-dialog guards decide whether a mode change may proceed. Held changes
stay held, with writing and selection kept. Command-Return from either mode
pill now reaches the existing Send owner; plain Return already did in the
retained native control. The named default is Return = newline inside text,
Command-Return = the existing text Send, and either chord = Send on a mode pill.
Composition, already-owned events, repeated keys and unrelated controls keep
their existing behavior.

Assignment: Warp15320, Fable15331; piece `p-abbdf76f28644b6384b7b04c`.
Branch: `core-lane7/1023-pencil-keys-306`.
Source base: assigned live306 `5ccd5432284200e823c123c5689383d13f1c8fb7`.
This names the tested predecessor, not a claim about the latest live release.
The review return and FINAL-SOURCE.json name the exact frozen HEAD and tree.

Only `web/pencil-keys.mjs`, the Keys legend and guide change in the product.
The document capture handler recognizes the existing pill nodes, so no edit
to `inline-composer.mjs` or `compose-bar.mjs` is needed. Core, schema, writing,
submission, receipt, recovery and authority owners are unchanged. The Landing
notice15337 preceded work and15359 records this narrower implementation.

## Retained red and meaningful checks

- New focused controls on unchanged306: 12 tests, 5 pass and 7 fail. They
  expose Message opening, owned-text shortcut fallthrough under guards and
  Command-Return on both pills. The final new12 plus existing1018's23 pass
  35/35. The old Option-M opening assertion is intentionally changed to the
  new1023 contract; its selection/destination and other guard assertions stay.
- Actual native unchanged306 Chrome baseline: 11 cases, 5 pass and 6 fail.
  Option-M stays inline from page/text; both native Alt keys escape the
  pencil-owned naming-dialog guard; each pill's Command-Return yields no
  publication receipt. Plain pill Return, text newline/Command-Return and
  empty-Send refusal are passing controls. All four served product hashes
  equal306. The exact baseline harness, events, successful receipts and failed
  screenshots are retained. The closed-sheet failure image was visually read.
- Final `tests/pencil_keys_1023_native.mjs`: Chrome148.0.7778.96 48/48 and
  WebKit26.6 48/48, identical product and harness bytes. Bookends/Paper,
  light/dark, laptop1280px, with390px nested naming-dialog controls. Each case
  verifies actual HTTP-served bytes of four measured modules. Each engine
  retains20 actual committed message/Note operations and exact Core source
  readbacks, one publication envelope per Send. Native mode-pill clicks leave
  focus on the pill before Return/Command-Return. The actual guard events have
  `defaultPrevented:true`, with the dialog and held mode kept.
- Existing affected17-file importer cohort: 730 tests on both306 and head,
  717 pass and the same13 fail. The **entire TAP output** is byte-equal after
  only exact own source-root paths and per-test/total durations are normalized.
  Full raw logs, file list, comparison and empty normalized diff are retained.
  These are unwaived baseline failures, not broad green. They concern outcome
  refresh/read scoping, the894 wrap expectation, line-writer inventory and
  refresh-word inventory. The new12 tests are reported separately above.
- Three actual source mutations restore the prior Message opening, drop
  owned-key consumption, or decline pill Command-Return. Each fails the new
  controls; exact byte restoration passes12/12 and restores the same source
  hash. Mutant bytes and both raw results are retained for every mutation.
- `git diff --check` passes. The historical1018 native assertion that
  Option-M stays inline is updated to the new sheet-opening contract; that
  old entire52-case harness is not newly claimed as run.

## Evidence and cleanup

Raw root: `/Users/commonfabric/aim-worktrees/core-lane7-1023-evidence`.
The repository evidence manifest identifies producers and retained phase bytes.

`red306/node.log` and `red306/chrome` retain the actual red. Its separately
saved `red306/harness.mjs` predates product edits. The final harness adds one
guide/legend case per look/appearance and browser-version metadata; all11 red
cases remain in it. No old phase is relabeled as a final-source result.
`green/focused-node.log`, `cohort/`, `mutations/`, `chrome-final/` and
`webkit-final/` hold the completed controls. Each final phase retains its
exact harness snapshot and launch record.

Every native phase verifies Browser.close, absence of all observed owned PIDs
and profile processes, profile removal, fixture EOF/exit0, fixture absence,
empty fixture stderr and closed port. Baseline observed8 owned Chrome PIDs;
final Chrome7 and WebKit2. No browser, profile, fixture or port remains.
Only isolated scratch HTTP/Core origins and records were used.

## Limits and ownership

Native automation emits its actual `n`/`m` key spelling; separate handler
controls exercise the Mac `Dead`/`µ` spellings and composition exclusion.
This proves controlled native routing and publication, not Tony's physical
Mac layout/IME or the exact physical field trigger he reported. Warp15321
already requested that field clarification. Do not claim that the baseline's
passing plain-Return control reproduced his physical plain-Return failure.
No physical phone, software keyboard, timing, installed Safari, live repair,
deployment, Tony acceptance or hosted-gauntlet green result is claimed.

Fable records the exact freeze/stages; Warp owns the one independent read,
carry and landing. Actual classification comes from the frozen diff. The
15393 landing-only hold leaves this source available for review. Conditional
next items1024/1026 are separate assignments, not additions to this change.
